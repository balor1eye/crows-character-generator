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

1. **Empty campaign.** It names the campaign and checks that it starts empty.
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
9. **The Session tab** shows that an encounter is running.
10. **Treasure XP.** Notes typed during the fight are kept. "Award treasure XP" opens the Party tab labelled
    with the encounter, and 400 gc gives each of the four crows 100 pending XP.
11. **Ending it** ("The crows won"). The tracker clears, and the encounter is resolved and shown. Its notes get
    the summary: rounds, fallen, foes still standing, allies, each crow's Stamina and wounds, and corpses to
    harvest. The crows keep their wounds, and no confirmation dialog came up.
12. **Reload.** The campaign is the same after reloading the page.

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
