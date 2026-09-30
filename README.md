# Crows Playtest Character Generator

A character creator for the MCDM **Crows** public playtest 2 (August–September 2026), built from the
Rules, Characters, and Ref books and the playtest inventory cards.

## Using it

Open **`dist/Crows_Character_Generator.html`** in any modern browser (Chrome, Edge, Firefox, Safari)
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
- **Dungeon turns & rest**: ending a DT rolls usage dice of lights in hand and ends blessed/vulnerable/
  weakened. **Rest** eats a ration (or gives a starvation wound), restores Stamina, heals wounds
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

## Project layout

```
dist/Crows_Character_Generator.html   the finished single-file app (this is what you share)
dist/index.html                       redirects the site root to the app (for GitHub Pages)
.github/workflows/pages.yml           publishes dist/ to GitHub Pages
src/index.html, app.css, app.js       the app (dev version loads the files below separately)
src/play.js                           Play mode: vitals, dice, rests, usage dice, XP tracking
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
   `https://<your-user>.github.io/<repo-name>/`.

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
