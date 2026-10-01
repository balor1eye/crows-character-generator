# The Nest

The Nest is a character creator, Ref Screen, and accounts site. It's a character creator for the MCDM **Crows** public playtest 2 (August–September 2026), built from the
Rules, Characters, and Ref books and the playtest inventory cards.

**Use it online: https://balor1eye.github.io/crows-character-generator/**

## Using it

Open the link above in any browser, including on a phone. To use it offline, open
**`dist/Crows_Character_Generator.html`** in any modern browser (Chrome, Edge, Firefox, Safari)
on Windows, macOS, or Linux. It's one self-contained file: no installs, plugins, server, or internet
connection needed. You can copy it anywhere (USB stick, cloud drive, email) and double-click it.

What it does:

1. **Background**: roll 2d6 on the backgrounds table or pick one of the 36 backgrounds.
2. **Characteristics**: the background's 2, plus a 1 and a 0 or a -1 and a 2 for the other two.
3. **Name & feature**: type them in or use the random ideas.
4. **Expertises & Stamina**: filled in from the background.
5. **Traits**: the starting trait, plus a browser for all 23 trait trees. With XP you can buy traits;
   prerequisites follow the connecting lines printed in the book.
6. **Equipment & inventory**: the standard kit, background gear, and 3d6 gc, auto-arranged into
   hand, belt, and backpack slots. Click or drag cards to rearrange them, add items from the full card
   list, and set gear aside. Stacking, multi-slot, and two-handed rules are enforced.
7. **Village & NPC connection**, including the 10 connection benefits.
8. **Advancement** (optional): enter Total XP for Expertise & Stamina bonuses, characteristic
   bonuses, and trait purchases (for the "Starting With More" rule).

**Play mode** (the *Play* tab in the header) turns the app into a character manager for the table:

- **Vitals**: current Stamina, AD of worn armor, shields, and parry weapons, speed (with wound and
  condition penalties), wounds, cruelty, coins, and the six conditions. **Take damage** runs it through
  AD, then Stamina, then wounds (piercing skips AD, vulnerable adds 1d6); click backpack slots to move
  or heal wounds.
- **Dice**: tests (2d10 + characteristic) with edges/banes, crits, dooms, and tiers; conditions apply
  automatically. After a roll it offers to spend a matching expertise use for +1 tier (never on a doom).
  Also Miasma RRs (with cruelty), initiative, draw from pack, and plain dice.
- **Attacks & spells**: one-click attacks with wielded weapons (damage by tier, brutal crits, ammo
  used, the light-weapon bonus for two light weapons or an empty hand, -1 for a parry weapon at 0 AD),
  throws with Melee/Ranged weapons, and castings of wielded spellbooks (the book's usage die, and a
  chaos roll only once a tier 1 result is final). Ranged misses offer the roll to see if a nearby ally
  is hit.
- **Village**: set Prosperity in Build > Village; the Caretaker connection heals 3 wounds at 6+.
  Surgical kits add a wound healed to Tend Wounds, and ticking "2+ items here" on a magic item slot
  blocks resting and deals 1d6 wounds at the end of each dungeon turn.
- **Dungeon turns & rest**: the Ref ends each DT from the Ref Screen; on a linked crow's sheet that rolls
  usage dice of lights in hand and ends blessed/vulnerable/weakened. **Rest** eats a ration (or gives a starvation wound), restores Stamina, heals wounds
  (hearty ration, Tend Wounds, Caretaker), restores expertise uses outside the Miasma, recharges
  spellbooks, handles repair armor and lore book study, feeds pets, and applies pending XP.
- **Expertise uses**, **carried items** (usage dice, refuelling, ammo, healing potions, using up
  consumables), **magic item slots**, **pet Stamina**, and a **session log**.
- **Experience**: log recovered treasure (XP = gc / players), which applies after the next rest, and
  see the next bonus thresholds. New bonuses and trait purchases are chosen in Build > Advancement.

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

**Theme**: the ◐ button in the header switches between Auto (follows your device), Light, and Dark. The
choice is remembered and shared by the Character Generator, the Ref Screen, and the accounts site.

## Ref Screen (for the Ref)

A separate, self-contained app for running sessions and keeping the campaign between them:
**https://balor1eye.github.io/crows-character-generator/Crows_Ref_Screen.html**, or offline as
**`dist/Crows_Ref_Screen.html`** (one file, works offline, autosaves in the browser; **Save campaign /
Load campaign** writes a `.json` file).

- **Session**: the shared dungeon-turn timer (60/30/20 minutes or every 1d6 rooms), Encounter Number with
  crowded/chaos adjustments, greed bonus, End DT (ends DT conditions, rolls the encounter check and the monster
  table, tracks signalled encounters, and ends the DT on each linked crow's sheet; rests do the same), a combat tracker (initiative, Stamina/AD/wounds, conditions, one-click
  monster attacks, X/Rest uses), the rest procedure, and the session log.
- **Travel**: hexes and EN from pace, speed, roads, water, and weather; travel encounters with every sub-table;
  the secret lost-direction roll; Miasma RRs and effects for each crow; the travel roles.
- **Village**: Prosperity, sale percentage, cycles and village events, institutions with levels and stewards,
  crypt boons, and the sample village Gadwick.
- **Party**: the crows (import the character generator's save files), XP awards with the greed bonus,
  hirelings, and a ledger for loans, credits, and bets.
- **World**: places (with the Dungeons book's locations), NPCs, campaign notes, and archived session logs.
- **Bestiary**, **Tables** (every rollable table), and a searchable **Rules** reference.

Source is in `ref/src/`; rebuild with `python ref/build/build.py` (plain Python 3, no packages). The build reads
`docs/CROWS_PT2_RULES.md` for the Rules tab, so the built file contains that text, and writes to `dist/`,
which GitHub Pages publishes.

## Accounts (optional)

The apps are also hosted with accounts at **https://joshuaramsey.com/crows/**. Log in to keep your characters
(and, for Refs, campaigns) on the server with autosave, or continue as a guest. An admin marks accounts as
players or Refs, and only Refs can open the Ref Screen there. Players can share a character with their Ref by link, or ask to join a campaign from the Ref's invite link. The Ref adds it to a campaign (or accepts the request), works the
crow's live vitals on the Party tab with the sheet's own buttons (Stamina, damage, wounds, conditions…), opens the
sheet to change equipment and notes too, and both see each other's changes live. The server code and deploy steps are in
[`server/README.md`](server/README.md). The offline files and the GitHub Pages copy work as before, with no
account.

## Project layout

```
dist/Crows_Character_Generator.html   the finished single-file app (this is what you share)
dist/Crows_Ref_Screen.html            the Ref Screen (built from ref/src by ref/build/build.py)
dist/index.html                       redirects the site root to the app (for GitHub Pages)
.github/workflows/pages.yml           publishes dist/ to GitHub Pages
src/index.html, app.css, app.js       the app (dev version loads the files below separately)
src/play.js                           Play mode: vitals, dice, rests, usage dice, XP tracking
src/cloud.js                          account autosave, live sync, and merging for both apps (inactive without the accounts server)
src/refview.js                        the Ref's limited view of a player's shared character
server/                               the accounts site: PHP API, portal pages, deploy script
src/game-data.js                      backgrounds, expertises, item cards, tables
src/traits-data.js                    all 23 trait trees + their connection lines (extracted from the book)
src/template-data.js                  generated: base64 PDF template + field positions
build/make_template.py                draws the record + cheat sheet, appends the official inventory sheet
build/build.py                        builds the template and inlines everything into dist/
assets/                               the official playtest inventory sheet PDF
vendor/pdf-lib.min.js                 pdf-lib 1.17.1 (MIT), inlined to build the PDF in the browser
```

## Publishing on GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the `dist/` folder whenever a push to `main`
changes it. `dist/index.html` sends visitors on to the app, so the site's address opens it directly.

One-time setup:

1. Create a GitHub repository and push this project to it (`main` branch).
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push a change under `dist/`, or run the workflow from the **Actions** tab. The site appears at
   `https://<your-user>.github.io/<repo-name>/` (this project's is
   https://balor1eye.github.io/crows-character-generator/).

To update the site, rebuild (`python build/build.py`), commit `dist/`, and push.

On a free GitHub plan, Pages only works for public repositories, so the whole project (including
the official inventory sheet in `assets/`) becomes publicly visible.

## Rebuilding

You only need to rebuild after changing the source. It requires Python 3.8+:

```
python -m pip install -r build/requirements.txt
python build/build.py
```

This works the same on Windows, macOS, and Linux. `src/index.html` can also be opened directly for
development after a build has produced `src/template-data.js`.

## Notes

- This is an unofficial fan tool. Crows, its rules, and the inventory sheet are © MCDM Productions LLC.
  The playtest rules may change.
- The playtest gives no stat sheet; the book says to record your stats on paper. The Character Record
  page provides one, drawn to match the official inventory sheet.
- Obvious rulebook typos were corrected (for example, the Keraunomancer's "Blacksmith" expertise is
  recorded as Blacksmithing, and the Transmuter's "repair take, shape" as the Repair and Take Shape books).
