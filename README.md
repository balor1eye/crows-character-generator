# The Nest

The Nest is a character creator, Ref Screen, and accounts site. It's a character creator for the MCDM **Crows** public playtest 2 (August–September 2026), built from the
Rules, Characters, and Ref books and the playtest inventory cards.

**Use it online: https://joshuaramsey.com/crows/**

## Using it

Open the link above in any browser, including on a phone (log in, or continue as a guest). To use it offline, open
**`dist/Crows_Character_Generator.html`** in any modern browser (Chrome, Edge, Firefox, Safari)
on Windows, macOS, or Linux. It's one self-contained file: no installs, plugins, server, or internet
connection needed. You can copy it anywhere (USB stick, cloud drive, email) and double-click it.

What it does:

1. **Background**: roll 2d6 on the backgrounds table or pick one of the 36 backgrounds.
2. **Characteristics & expertises**: the background's 2, plus a 1 and a 0 or a -1 and a 2 for the other two. Below them,
   the expertises and Stamina from the background (read-only; bonus uses from advancement are assigned in step 7).
3. **Name & feature**: type them in or use the random ideas.
4. **Traits**: the starting trait, plus a browser for all 23 trait trees. With XP you can buy traits;
   prerequisites follow the connecting lines printed in the book.
5. **Equipment & inventory**: the standard kit, background gear, and 3d6 gc, auto-arranged into
   hand, belt, and backpack slots. Click or drag cards to rearrange them, add items from the full card
   list, and set gear aside. Stacking, multi-slot, and two-handed rules are enforced. Play mode's Items card is the
   same grid, with usage dice, ammo, and the fight's ground added.
6. **Village & NPC connection**, including the 10 connection benefits.
7. **Advancement** (optional): enter Total XP for Expertise & Stamina bonuses (and assign the extra expertise uses),
   characteristic bonuses, and trait purchases (for the "Starting With More" rule).
8. **Notes**.

A progress bar over the steps shows which are ready (click one to jump to it; each card ends with a Next button), and the
checklist of what's left stays visible on a phone too.

**Play mode** (the *Play* tab in the header) turns the app into a character manager for the table. A sticky
**vitals strip** (Stamina, AD, wounds, speed, active conditions) stays visible at the top, and the page is split
into sub-tabs: **Now** (combat, Vitals, Attacks & spells), **Rest & turns**, **Items**, **Growth** (Experience,
Expertise & Stamina bonuses, and trait buying), and **Log**. On the accounts site, a crow in a Ref's campaign also
gets a **session bar** above the strip, live from the Ref Screen: the dungeon turn, the DT timer counting down (or rooms
left), the greed bonus, Resting, and Encounter signalled.

- **Vitals**: current Stamina, AD of worn armor, shields, and parry weapons, speed (with wound and
  condition penalties), wounds, cruelty, coins, and the six conditions. **Take damage** runs it through
  AD, then Stamina, then wounds (piercing skips AD, vulnerable adds 1d6); click backpack slots to move
  or heal wounds.
- **Dice**: tests (2d10 + characteristic) with edges/banes, crits, dooms, and tiers; conditions apply
  automatically. After a roll it offers to spend a matching expertise use for +1 tier (never on a doom).
  Also Miasma RRs (with cruelty), initiative, draw from pack, and plain dice. The result shows inline under
  Attacks & spells as well as in the dice sidebar (desktop only).
- **Attacks & spells**: one-click attacks with wielded weapons (damage by tier, brutal crits, ammo
  used, the light-weapon bonus for two light weapons or an empty hand, -1 for a parry weapon at 0 AD),
  throws with Melee/Ranged weapons, and castings of wielded spellbooks (the book's usage die, and a
  chaos roll only once a tier 1 result is final). Ranged misses offer the roll to see if a nearby ally
  is hit.
- **Village**: set Prosperity in Build > Village; the Caretaker connection heals 3 wounds at 6+.
  Surgical kits add a wound healed to Tend Wounds, and ticking "2+ items here" on a magic item slot
  blocks resting and deals 1d6 wounds at the end of each dungeon turn.
- **Live combat** (accounts site): when the Ref runs a fight with your linked crow in the Ref Screen's combat
  tracker, a **Combat** card appears at the top of Play within a second or two. It offers every option the combat
  rules give at that moment: your turn (an action and a maneuver, or two maneuvers; a crit adds an action; one
  reaction a round), maneuvers (Move, Shift with Disengage, Stand Up, Draw From Belt/Pack, Pick Up Item, Dump Backpack,
  Reload, Command Pet, and the rolled Grab, Knockback, Escape Grab, and Jump), the actions Taunt, Ready, and Assist,
  counters when a creature misses you in melee (offered on the card), opportunity attacks, several targets for spells
  that take them, healing and blessing allies or yourself, and the modifiers for the target's state and the battlefield
  (flanking, high ground, hidden, cover, dim light, darkness, ranged against an adjacent creature, beyond range). It shows the round, who acts first,
  surprise, the enemies (how hurt each looks, or their Stamina and AD if the Ref shows them), the allies and crows,
  and a feed of what happens. Pick a target, then attack or cast from Attacks & spells: once the roll is final (after
  any expertise use or chaos roll) it goes to the Ref with its tier and damage, and the Ref Screen deals the damage
  to that target (attacks on a surprised target get +1). You can also send any other action in words and mark your
  crow **Done for this round**. A creature attacking your crow is marked "attacking you".
- **Dungeon turns & rest**: the Ref ends each DT from the Ref Screen; on a linked crow's sheet that rolls
  usage dice of lights in hand and ends blessed/vulnerable/weakened. **Rest** eats a ration (or gives a starvation wound), restores Stamina, heals wounds
  (hearty ration, Tend Wounds, Caretaker), restores expertise uses outside the Miasma, recharges
  spellbooks, handles repair armor and lore book study, feeds pets, and applies pending XP. When the Ref finishes the
  party's rest in the Ref Screen, a linked crow's sheet does all of that itself; the Rest card then says the crow rested
  with the party and only asks for the rest activity and any extra healing (a crow that already rested from its own
  sheet that dungeon turn isn't rested twice). While the Ref's party rest is under way, the Rest card says so and sends
  your food and rest activity (and healing from others) to the Ref Screen, which applies them when it finishes the rest.
- **Expertise uses**, **carried items** (usage dice, refuelling, ammo, healing potions, using up
  consumables), **magic item slots**, **pet Stamina**, and a **session log**.
- **Growth**: log recovered treasure (XP = gc / players), which applies after the next rest, and see the next
  bonus thresholds; choose new Expertise & Stamina and characteristic bonuses, and buy traits, right there (the
  same bonus and trait-tree UI as Build > Advancement/Traits). In a campaign the Ref awards XP: logging treasure
  sends the Ref a claim instead, which they use for the award (or dismiss) on the Party tab.

**Download PDF** builds a fillable, editable PDF:

- **Page 1**: Character Record: identity, characteristics, Stamina, AD, coins, conditions,
  expertises with checkboxes for spent uses, XP, magic item slots, traits, pets, connection, and notes.
- **Page 2**: the official playtest **Inventory Sheet**, with each item's card text in its slot and
  a checkbox in every backpack slot's "Wound ( )".
- **Pages 3–5**: a 3-page player cheat sheet covering tests, damage, conditions, inventory, combat,
  dungeon turns, resting, spellcasting, crafting, travel, the Miasma, and advancement.

The PDF also records the play state: current Stamina and AD, cruelty, ticked conditions, spent
expertise uses, wounds, and magic item slots.

**Save file / Load file** stores the character (including play state) as a small `.json` file. The page also autosaves to
the browser's local storage.

**Layout**: the 🔒 Layout button in the header unlocks the page (Build, Play, and each Ref Screen tab) so you can drag its
blocks anywhere, between columns too: the other blocks slide out of the way as you drag, and a block takes the width of
the column it's over (scaled down if it's too wide for it). Pick the columns (wide + narrow, narrow + wide, two equal,
three, or one) or Reset, then lock the page again. The arrangement is kept per page in your account when you're logged
in, and in the browser otherwise. Keyboard: focus a block and use the arrow keys; on a phone, press and hold first.

**Theme**: the ◐ button in the header switches between Auto (follows your device), Light, and Dark. The
choice is remembered and shared by the Character Generator, the Ref Screen, and the accounts site.

## Ref Screen (for the Ref)

A separate, self-contained app for running sessions and keeping the campaign between them:
on the accounts site (Ref accounts only), or offline as
**`dist/Crows_Ref_Screen.html`** (one file, works offline, autosaves in the browser; **Save campaign /
Load campaign** writes a `.json` file). The tabs come in three groups: **Run** (Session, Encounters, Travel),
**Campaign** (Party, Village, World), and **Reference** (Bestiary, Maps, Tables, Rules). The sidebar keeps the timer, the dice,
and the session log (the last 14 entries, or Show all, with a box for notes).

- **Session**: Start session and End session (ending one fills in the XP award from the players' claims, with the greed
  bonus, and reminds you of the village cycle; starting the next archives the log), the shared dungeon-turn timer (60/30/20 minutes or every 1d6 rooms), Encounter Number with
  crowded/chaos adjustments, greed bonus, End DT (ends DT conditions, rolls the encounter check and the monster
  table, tracks signalled encounters, and ends the DT on each linked crow's sheet; rests do the same), a combat tracker shared live with the players' Play pages (their attacks land on the targets they pick with one click, and can be undone; damage is never dealt automatically: a hit waits as a pending hit, so a crow's player can tell the Ref how they defend (their Play page shows the incoming hit, with Sacrifice Armor / Break the Blade when they have them, a readied action, or anything in words) and the Ref can lower or negate the damage, or spend an enemy's reaction, before applying it; after a player's miss or doom, buttons for the counter, the stray shot at a random ally, or the backlash roll), creatures that attack a target the Ref picks (or a random one), with each hit waiting to be applied and undoable (initiative, Stamina/AD/wounds, conditions, one-click
  monster attacks, X/Rest uses), and the rest procedure. While an encounter is running its tracker is on the Encounters
  tab, and the Session tab shows a summary with a link to it.
- **Travel**: hexes and EN from pace, speed, roads, water, and weather; travel encounters with every sub-table;
  the secret lost-direction roll; Miasma RRs and effects for each crow; the travel roles.
- **Village**: Prosperity, sale percentage, cycles and village events, institutions with levels and stewards,
  crypt boons, and the sample village Gadwick.
- **Party**: Party status (each crow's vitals at a glance; a linked crow's from its sheet), the crows (import the
  character generator's save files), inviting players, XP awards with the greed bonus, hirelings, and a ledger for
  loans, credits, and bets.
- **World**: places (with the Dungeons book's locations), NPCs, campaign notes, and archived session logs.
- **Bestiary** (cards for Blood Creatures and Undead show a thumbnail of the MCDM art; click it for the full-size picture), **Maps** (Cornath, Floating Manor, Blood Library, plus the dungeon entrance art, in a zoomable pop-up; the pictures are in `dist/art/`, made by `ref/build/make_art.py`; the single-file copy shows only the thumbnails). Refs can add their own maps (Maps tab, **Add a map…**) and art for any creature (**Add art** on its card, or **Replace art** in the pop-up); these are kept in the Ref's account, so they follow them to every device (logged out, the offline file keeps them in that browser, and moves them into the account at the next login), **Tables** (every rollable table), and a searchable **Rules** reference.

Source is in `ref/src/`; rebuild with `python ref/build/build.py` (plain Python 3, no packages). The build reads
`docs/CROWS_PT2_RULES.md` for the Rules tab, so the built file contains that text, and writes to `dist/`.

## Accounts (optional)

The apps are also hosted with accounts at **https://joshuaramsey.com/crows/**. Log in to keep your characters
(and, for Refs, campaigns) on the server with autosave, or continue as a guest. A new crow is saved to your account at once as a
*draft*; press **Finish crow** when it's ready to play. There, Start over, Save file, and Load file sit in a **⋯ More** menu. The portal's **Crows** page lists your crows with a status (Draft, Ready, in a campaign) and one main button for each (Continue building, or Play); Share, Copy, Download, and the rest are under **More**. Home shows your top crows and, for Refs, your campaigns. An admin marks accounts as
players or Refs, and only Refs can open the Ref Screen there. Players can share a character with their Ref by link, or ask to join a campaign from the Ref's invite link. The Ref adds it to a campaign (or accepts the request), works the
crow's vitals on the Party tab (Stamina, damage through its armor, wounds, conditions, cruelty: the Ref Screen makes the
change on the player's sheet with the same rules the sheet uses), opens the sheet to change equipment and notes too,
and both see each other's changes within a second or two. The server code and deploy steps are in
[`server/README.md`](server/README.md). The offline files work as before, with no account.

## Project layout

```
dist/Crows_Character_Generator.html   the finished single-file app (this is what you share)
dist/Crows_Ref_Screen.html            the Ref Screen (built from ref/src by ref/build/build.py)
src/index.html, app.css              the app's page (the dev version loads the files below separately)
src/state.js                          the character: helpers, traits, advancement, derived numbers, new/random/save/load
src/inventory.js                      the inventory slot rules, starting gear, auto-arrange
src/inventory-ui.js                   the one inventory grid (Build's step 5 and Play's Items card)
src/build-view.js                     the Build page: each step's card, the inventory slots, the Crow summary, its controls
src/pdf.js                            the fillable PDF
src/app.js                            window.CrowsApp (for Play mode), account saving, start-up
src/shared/                           shared by both apps (and dom.js, tokens.css by the accounts site): page helpers
                                      (dom.js), dice and tests (dice.js), advancement and damage rules (rules.js), colours (tokens.css)
src/play.js                           Play mode: vitals, dice, rests, usage dice, XP tracking
src/cloud.js                          account autosave, live sync, and merging for both apps (inactive without the accounts server)
src/refview.js                        the Ref's limited view of a player's shared character
src/combat.js                         Play mode's live Combat card (targets, attacks sent to the Ref Screen)
src/layout.js                         rearranging the blocks on a page (both apps), saved to the account
server/                               the accounts site: PHP API, portal pages, deploy script
ref/src/                              the Ref Screen: ref-core.js (state, timer, tab bar, sidebar), one file per area (encounters,
                                      travel, session, combat, village, party, reference), and ref.js (files, start-up)
ref/test/                             browser tests: combat, layout, and live play between the two apps (see ref/test/README.md)
src/game-data.js                      backgrounds, expertises, item cards, tables
src/traits-data.js                    all 23 trait trees + their connection lines (extracted from the book)
src/template-data.js                  generated: base64 PDF template + field positions
build/make_template.py                draws the record + cheat sheet, appends the official inventory sheet
build/build.py                        builds the template and inlines everything into dist/
assets/                               the official playtest inventory sheet PDF
vendor/pdf-lib.min.js                 pdf-lib 1.17.1 (MIT), inlined to build the PDF in the browser
```

## Rebuilding

You only need to rebuild after changing the source. It requires Python 3.8+:

```
python -m pip install -r build/requirements.txt
python build/build.py
```

This works the same on Windows, macOS, and Linux. `src/index.html` can also be opened directly for
development after a build has produced `src/template-data.js`.

After changing the Ref Screen, rebuild it and run the combat encounter test (needs Firefox and geckodriver; see
`ref/test/README.md`):

```
python ref/build/build.py
python3 ref/test/run_combat_test.py
```

## Notes

- This is an unofficial fan tool. Crows, its rules, and the inventory sheet are © MCDM Productions LLC.
  The playtest rules may change.
- The playtest gives no stat sheet; the book says to record your stats on paper. The Character Record
  page provides one, drawn to match the official inventory sheet.
- Obvious rulebook typos were corrected (for example, the Keraunomancer's "Blacksmith" expertise is
  recorded as Blacksmithing, and the Transmuter's "repair take, shape" as the Repair and Take Shape books).
