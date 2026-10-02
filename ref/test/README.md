# Ref Screen tests

## Full combat encounter (`combat_encounter.js`, run by `run_combat_test.py`)

An end-to-end test of running a fight from the Encounters tab with a party of four players. It drives the real
Ref Screen in headless Firefox the way a Ref would (clicking, typing, importing files) and checks both what's on
screen and what the app saved.

```bash
python3 ref/build/build.py                          # rebuild dist/ first after changing ref/src/
python3 ref/test/run_combat_test.py                 # the local build, in a fresh browser profile
python3 ref/test/run_combat_test.py --test-instance # the deployed test instance, as test_ref
```

Options: `--seed N` repeats a run with the same dice (default 1), `--headed` shows the browser, and `--keep`
leaves the test campaign in test_ref's account instead of deleting it.

It prints one `ok` line per check and ends with `PASSED` (exit 0) or `FAILED` (exit 1). A failure names the
first check that didn't hold, and the run stops there.

### What it covers

1. **Empty campaign.** The tab bar shows its groups (Run, Campaign, Reference). It names the campaign and checks that
   it starts empty.
2. **Four players.** It imports four Character Generator save files through the Party tab's file input: Ash
   (Bodyguard, 9 Stamina), Briar (Archer, 7), Corvin (Acolyte of the Warrior, 9), and Dove (Assassin, 5).
3. **Builds the encounter by hand.** In the Encounters tab it creates "Ambush at the ford" with a place, set-up
   text, and 2 × Undead A, 1 × Undead B, and 2 × Thief (P3).
4. **Runs it.** The Running card appears, and all four crows and five foes are in the tracker, with the foes
   tagged with the encounter. The ⚔ badge shows, and the log notes the start. The saved card points to the
   fight instead of showing a second set of editors.
5. **Surprise and the like/hate check.** The crows are surprised. The like/hate check uses the monsters' best
   Mind (-2). Round 1 tags only the crows as surprised.
6. **Round 1.** A foe's attack on surprised crows gets +1 (Claws +2 rolls at +3). Dove takes 7 damage: 5
   Stamina, then 2 wounds, and Dove's party entry follows. Ash is weakened.
7. **Round 2 and a reinforcement.** Nobody is surprised any more, and there's no +1. A Sword Warrior added as
   an ally joins the running encounter.
8. **Morale.** One thief at 0 Stamina gives the "half the human foes are down" cue. Then the undead die and
   the other thief is marked dead, giving "every foe is down" and "0 of 5 foes standing".
9. **The Session tab** shows that an encounter is running, as a summary (round, foes standing) instead of a second
   tracker, and "Go to the fight" opens the Encounters tab.
10. **Treasure XP.** Notes typed during the fight are kept. "Award treasure XP" opens the Party tab labelled
    with the encounter, and 400 gc gives each of the four crows 100 pending XP.
11. **Ending it** ("The crows won"). The tracker clears, and the encounter is resolved and shown. Its notes get
    the summary: rounds, fallen, foes still standing, allies, each crow's Stamina and wounds, and corpses to
    harvest. The crows keep their wounds, and no confirmation dialog came up.
12. **The sidebar log and the next session.** The sidebar log shows the last 14 entries, or all of them. Two crows
    claim the same treasure; End session fills in the XP award from it once (split four ways, answering both claims)
    and reminds the Ref of the village cycle, and Start session 2 archives session 1's log and starts a new one.
13. **Reload.** The campaign is the same after reloading the page.

With `--test-instance` it also checks the campaign record the page autosaved to the server, through the API:
its name, the four crows and their pending XP, Dove's wounds, the encounter's summary, and the cleared tracker.

### How it works

- `run_combat_test.py` speaks WebDriver to `geckodriver` over plain HTTP (Python standard library only, nothing
  to install). The Ubuntu Firefox snap includes `geckodriver`. Elsewhere, install Firefox and geckodriver
  from Mozilla and put geckodriver on the PATH.
- **Locally** it serves `dist/` on a random localhost port. Each run gets a new Firefox profile, so the
  campaign starts empty and nothing touches your own browser's saved campaign.
- **On the test instance** it logs in as `test_ref` with `server/test_instance.py` (password and TOTP over the
  API, so the ssh-agent needs the site key). It hands that session cookie to the test browser and opens
  `ref.php?new=1`, which makes a new campaign in test_ref's account. When the run ends, it deletes that campaign
  (unless `--keep`). It never runs against production.
- `combat_encounter.js` runs inside the page as a WebDriver async script. It replaces `Math.random` with a
  seeded generator and `confirm()` with "yes" (the test fails if any confirmation is asked). It reads the
  app's saved state from `localStorage` (`crows-pt2-ref-campaign`).
- The Firefox snap only takes signals from inside the snap, so the runner stops geckodriver with
  `snap run --shell firefox -c "kill <pid>"` when a plain terminate is refused.

### Updating it

The scenario finds things the way a person would: buttons by their label, inputs by their `aria-label` or
placeholder, and combat rows by creature name. If a button's wording changes, update the label in
`combat_encounter.js`. Each `check(condition, 'what it means')` adds one line to the report. When adding steps,
re-query elements after anything that re-renders (most clicks do), because the old nodes are replaced.

## The combat tracker's rules (`combat_engine.js`, run by `run_engine_test.py`)

Creatures fight allied NPCs in the local build with the dice forced for each roll (no accounts or server), checking
tier effects (grabbed, weakened and vulnerable, size limits), grabs ending when the grabber dies, Undo putting damage
and conditions back, counters after a melee miss and reactions running out, attacks on 2 targets, fixed crit damage,
"at 15 Stamina or less" bonuses, the target's state (prone, unconscious), battlefield buttons, hidden attackers,
opportunity attacks, and the Grab, Knockback, and Escape Grab maneuvers.

```bash
python3 ref/test/run_engine_test.py
```

## Rearranging pages (`layout_test.js`, run by `run_layout_test.py`)

Drags blocks with pointer events in both local builds: unlocking, the placeholder and animations during a drag, the
dragged block taking the target column's width, keyboard moves, a wide block scaled to fit a narrow column, the column
presets, Reset, Build/Play and each Ref Screen tab keeping their own arrangements, and everything surviving a reload.
`--test-instance` also checks that test_player's arrangement is saved to (and comes back from) the account.

```bash
python3 ref/test/run_layout_test.py [--test-instance]
```

## Portal (`run_portal_test.py`)

Test instance only. As test_player it makes a draft and a finished crow through the API, then checks the Crows list (status
chips, main button, More menu, `#play` as an alias) and Home's Your crows in headless Firefox, and deletes them.

```bash
python3 -u ref/test/run_portal_test.py
```

## Live combat with a player (`run_live_combat_test.py`)

Runs on the test instance only, in two headless Firefoxes: test_ref in the Ref Screen and test_player on the Play
page. The player shares a new crow, the Ref adds it to a new campaign and starts a fight with two Blood Creature A.
It checks that the fight shows on the Play page (foes' health words, not their Stamina), that an attack on the
chosen target lands on that creature in the Ref Screen and comes back in the player's feed, that a described action
and "done for this round" reach the Ref, that with automatic hits off a hit waits for Apply and Undo reverses it, and
that a creature given the crow as its target hits it (and Undo takes that back), that a melee doom lets the target counter at tier 3, that a ranged doom hits the one other ally for the weapon's tier 3 damage, that a doom casting rolls a backlash the player sees, that the crow's AD comes from its own armor and a hit on it lands on the sheet, dealt by the Ref Screen itself with no iframe (and Undo restores it there), that a monster's miss offers the player a counter with their sword, that a player's Grab, Taunt, healing spell, two-target spell, and reaction attack do what the rules say in the Ref Screen, that conditions go both ways (prone from the Ref, Stand Up from the player), that unattended items work (a dropped sword, the Ref's hidden and visible items, a creature picking one up and dropping it when it dies, a pickup into a free hand and a two-handed one refused, Dump Backpack, and what's left behind logged at the end), and that ending the fight removes the Combat card. Everything it made is deleted afterwards (`--keep` leaves it).

```bash
python3 ref/test/run_live_combat_test.py            # after server/deploy.sh; --headed shows both browsers
```

## Rests and XP claims with a player (`run_live_rest_test.py`)

Also on the test instance only, set up the same way. The player's crow starts hurt with an expertise use spent. The
Ref finishing a rest must do the whole rest on the player's sheet (a ration eaten, Stamina full, a wound healed, the
use back, the dungeon turn recorded), and the Rest card must say the crow rested with the party. After the player rests
from their own sheet, the Ref's next rest that dungeon turn must skip the crow (no second ration). The Play page must
show the Ref Screen's session bar (the dungeon turn, a timer counting down, Resting), and when the Ref starts a rest the
player's choices (a Hearty Ration and Repair Armor) must reach the Ref Screen's Rest card and apply on the sheet when
the Ref finishes it, without the Rest card asking for the activity again. In the campaign, the
player's treasure becomes an XP claim: it must show on the Ref's Experience card (with a badge on the Party tab), and
using it for the award must give the player the pending XP and take the claim off both lists. Last, a hit dealt
from the crow's Party status tile must land on the player's sheet and in its log, with no iframe on the Ref Screen,
and leave nothing waiting to save.

```bash
python3 ref/test/run_live_rest_test.py              # after server/deploy.sh; --headed shows both browsers
```

Scripts sent over WebDriver run with their own globals, so a test that fixes the dice has to replace
`window.Math.random` (the page's), not `Math.random`.
