# UX streamlining plan (remaining phases)

Done: phase 0 (party rests and XP claims on linked sheets) and phase 1 (src/shared/, split app.js and ref.js), in 658e657;
phase 2; phase 5. Remaining phases, in this order: **6, 3, 4**. Do one phase per session, then commit (see Workflow). Tick its boxes here and
commit this file with it.

## Workflow (every phase)

1. **Find code** with `graft grep "<name>"` or `graft ask "<question>" --source`. Function names below are current; line numbers drift.
2. **Build** after any change to src/ or ref/src/. The system python lacks the build deps, so use a venv:
   ```bash
   python3 -m venv /tmp/crows-venv && /tmp/crows-venv/bin/pip install -q -r build/requirements.txt   # once per machine
   /tmp/crows-venv/bin/python build/build.py && /tmp/crows-venv/bin/python ref/build/build.py
   ```
3. **Local tests** (headless Firefox via the snap geckodriver). Run them with the Bash sandbox disabled, in the background,
   output to a log file, `python3 -u`, never piped through grep or tail:
   ```bash
   python3 -u ref/test/run_engine_test.py; python3 -u ref/test/run_combat_test.py; python3 -u ref/test/run_layout_test.py
   ```
4. **Look at it**: create `.claude/launch.json` with an http server on `dist/` (`python3 -m http.server 8765 --directory dist`), open
   it with the browser pane's preview_start, and click through what changed. Check the console for errors. Delete launch.json afterwards.
5. **Deploy to the test instance only**: `server/deploy.sh`. Then run, in the background as above:
   ```bash
   python3 -u server/test_instance.py smoke && python3 -u ref/test/run_live_rest_test.py && \
   python3 -u ref/test/run_live_combat_test.py && python3 -u ref/test/run_combat_test.py --test-instance
   ```
   Each live test takes about 8 minutes. Afterwards, `pgrep -af geckodriver` must be empty; kill leftovers with
   `snap run --shell firefox -c "kill <pid>"`.
6. **Commit** on a branch, then merge into main when the user agrees. Don't push or promote unless asked. Never run `server/promote.sh`
   or `deploy.sh --production` on your own (CLAUDE.md). Never type test passwords into a browser: use `server/test_instance.py`.
7. **Docs**: update README.md (the user-facing feature list) and ref/test/README.md if tests changed.

## How the code is put together

- **Character Generator**: src/index.html loads, in order: shared/dom.js, dice.js, rules.js, sheet.js (window.CrowsDom, CrowsDice,
  CrowsRules, CrowsSheet), cloud.js, refview.js, layout.js, then state.js, inventory.js, build-view.js, pdf.js, app.js (namespace
  **window.CrowsGen**), then play.js and combat.js. play.js and combat.js use `window.CrowsApp.core`, which app.js sets.
- **Ref Screen**: ref/src/index.html loads the same shared files, then ref-core.js, ref-encounters.js, ref-travel.js,
  ref-session.js, ref-combat.js, ref-village.js, ref-party.js, ref-reference.js, ref.js (namespace **window.CrowsRefApp**).
- **Rules for the split files**:
  - Each file is an IIFE: `var A = window.<NS>, f = A.fwd;`, then a `var x = f('x')` forwarder for each function it calls from
    another file, then `var C = A.C` for constants from earlier files. It ends with `A.add({...})` exporting its top-level names.
  - A new function used across files goes in its file's A.add, plus a forwarder in each file that calls it.
  - `state` (and `tab` in the Ref Screen) are reassigned only through `A.set('state', v)`. Every file keeps its own copy via `A.share`.
  - Run `node --check <file>` after editing.
- **Rendering**: everything re-renders from state (`C.render()` / ref-core `render()`).
  - play.js: `render()` calls `renderVitals`, `renderTime`, `renderAttacks`, `renderExp`, `renderItems`, `renderAdvance`,
    `renderGear`, `renderLog`, `renderRoller`, each filling a `<section id="play-…">` through `card(id, title, kids)`.
  - Ref Screen: `render()` in ref-core.js dispatches on `tab`; `renderTabbar`/`setTab` are there too.
  - Pages are blocks that src/layout.js can rearrange: section ids are block ids, and new sections need entries there (see
    `layoutSync` in play.js, and `CrowsLayout.init` in ref.js).
- **Sheet math**: src/shared/sheet.js (window.CrowsSheet) does a crow's derived numbers and the Ref's changes on a character object
  (the saved form). state.js and play.js run it on the open crow; the Ref Screen runs it on linked crows.
- **Ref → player sheet**: `sheetOp(p, op)` (ref-party.js). A linked crow: the Ref Screen keeps the player's character from
  `link.get` (`sheets[link]`, `sheetOf(p)`), makes the change with `CrowsSheet.applyRefChange`, queues the op in `p.owed`, and saves
  the shared fields with `link.save` (`sendSheet`, `CrowsCloud.linkDiff`); on a 409 the queued ops are redone on the player's
  copy. Otherwise `applyOp` changes the party entry. The fields a Ref may write are SHARED_FIELDS in server/app/api.php and
  LINK_FIELDS in src/cloud.js, and the two must match.
- **Live fight**: the Ref Screen publishes with `publicCombat()`/`publish()` (ref-combat.js → `combat.publish`). The player reads
  `combat.mine` in src/combat.js (`load`, `renderView`, `renderAct`, `targetBar`) and sends `combat.act`.

## Phase 2: Play mode by situation (src/play.js, src/combat.js, src/index.html, src/app.css)

- [x] Add a sticky **vitals strip** at the top of `.play-main`: Stamina with ±1 and Full, AD now/max, wounds/10, speed, active
  conditions as chips. Reuse the logic from `renderVitals`; the full Vitals card stays.
- [x] Add **sub-tabs** in Play: Now (`play-combat`, `play-vitals`, `play-attacks`, the dice), Rest & turns (`play-time`,
  `play-gear`), Items (`play-items`, `play-exp`), Growth (`play-advance` and the new trait/bonus block), Log (`play-log`).
  - Store the tab in localStorage, like MODE_KEY. Sections outside the tab get `hidden`.
  - layout.js must treat each sub-tab as its own page: add a page id per sub-tab in the `CrowsLayout.init` call, and have
    `current()` return it.
- [x] Show **roll results inline**: `renderRoller` builds the result box (`.roll-result`). Make it a function `resultBox(r)` and
  render it under the Attacks card (and the dice buttons) when the roll came from there. Keep the sidebar box on desktop only (CSS
  under 1000px). combat.js `rollNote(r)` must still attach to it.
- [x] Do **Growth in Play**: the bonus choices and trait buying live in `sec-advance`/`sec-traits` (Build's step 2/5 cards), shared
  with Play's Growth sub-tab the same way `summary` is already shared between Build and Play — `CrowsLayout`'s page definitions list
  those block ids for the Growth page too, so they physically move there instead of being rebuilt. No new render path needed:
  build-view.js's `render()` already renders them unconditionally every pass. Removed the `gotoBuild` links (and `gotoBuild` itself,
  now unused) from play.js's own Experience card.
- [x] **Phone**: under 700px, the summary column (`.summary`) collapses into a header (hides `.sum-stats`, now redundant with the
  strip). Order: vitals strip, then the sub-tab.
- [x] Tests:
  - run_live_combat_test.py needed no changes: every interaction goes through raw DOM JS (`.click()`, `textContent`) via
    WebDriver's `execute/sync`, not real input-gated clicks, so hidden (off-tab) elements still work. Confirmed by running it live.
  - Added a reload-persistence check for the sub-tab choice to run_layout_test.py, and fixed its `--test-instance` branch, which
    had `"gen-play"` hardcoded as the saved-layout page id — now `"gen-play-now"` since Play's layout pages are per-sub-tab.

## Phase 5: Ref Screen (ref/src/)

- [x] **Tab groups**: TABS in ref-core.js becomes groups — Run (session, encounters, travel), Campaign (party, village, world),
  Reference (bestiary, tables, rules). Show the group labels in the tab bar (`renderTabbar`); tab ids stay the same.
- [x] **One combat tracker**: `renderCombat` (Session) shows only a summary line and a "Go to the fight" button when an encounter is
  running (`runningEnc()`). Otherwise it keeps the full `combatUI(false)`. Don't remove `combatUI`: `renderEncRun` uses it.
- [x] **Sidebar**: drop the `sec-log` card (`renderLogCard`) from Session, and give the sidebar log (`renderSideLog`) a "Show all"
  toggle in its place (its "full log" link points at `sec-log` now: repoint it). Move
  `renderInvite` output from `#side-invite` into a new `sec-invite` card on the Party page (index.html + layout block lists).
- [x] **Party status without iframes**:
  - Move the body of `CrowsPlay.refChange` (play.js) and the sheet math it needs into a shared function that works on a character
    object: `applyRefChange(char, op)` in a new src/shared/sheet.js, used by play.js and the Ref Screen.
  - The Ref Screen then applies ops to `link.get` data and saves with `link.save` (fields as `flushLinked` in cloud.js does,
    including the 409 merge).
  - Draw lightweight tiles from that data, replacing the iframes in `renderStatus`.
  - Biggest task; keep the iframe path until the live tests pass on the new one.
- [x] **Sessions**: a Start session button (session `n` +1, archive the log the way the History card does) and End session
  (pre-filled XP award from open claims (`allClaims()`) with the greed bonus, and a reminder to end the village cycle).
- [x] Tests: run_combat_test.py and run_live_*.py click tabs by name (`button('Party', q('#tabbar'))`), so keep the button labels.
  Add live-test checks that a Ref's hit lands on the sheet without an iframe.
- Done as described, plus: the iframe path is gone (refview.js `&view=status`, `CrowsPlay.refChange` and the `refOps` redo queue in
  play.js/app.js/cloud.js, and `frame-src` in the Ref Screen's CSP). The Session tab's log card became the **Session** card
  (`sec-sess`: title, date, Start/End session, Export log); the note box moved to the sidebar log. End session fills `ui.award`
  from the claims (a treasure several crows claimed counts once) and goes no further: the Ref checks it and presses Award.

## Phase 6: session state for players (ref-combat.js, src/combat.js, src/play.js)

- [ ] Add `session: { dt, endAt, running, greed, rest: active, pending }` to what `publicCombat()` returns. It's published even
  with no fight: today an inactive fight is `{active:false}`, so extend that, and check `a_combat_publish`/`a_combat_mine` in
  server/app/api.php still accept it (size limit COMBAT_MAX_BYTES).
- [ ] In combat.js, show a session bar at the top of Play: DT number, time left (count down from `endAt`), greed bonus,
  "Resting" / "Encounter signalled".
- [ ] **Rest prompt**: when `session.rest` is active, the Play Rest card shows "The party is resting" with the food/activity
  choices. The player sends them with `combat.act` type `rest` (add it to ACTION_TYPES and clean_action in api.php). The Ref
  Screen's `finishRest` (ref-session.js) puts each crow's choices into its `{ rest: {...} }` op, and `refRest` → `doRest(o)` in
  play.js already accepts food, activity, repair, study, useKit, tended, tendedKit, caretaker.
- [ ] Tests: extend run_live_rest_test.py (the player picks Hearty Ration and Repair Armor, then the Ref finishes the rest, and
  both apply).

## Phase 3: Build flow (src/build-view.js, src/index.html, src/app.css, src/cloud.js, server/app/api.php)

- [ ] **Steps**: a progress bar over the step cards (sections `sec-background` … `sec-notes`), "Next" buttons, and the checklist
  (`checklist()` in build-view.js) visible on mobile too (app.css hides `.summary .checklist` under 1000px).
- [ ] Fold step 4 (`sec-expertise`, `renderExpertise`) into a read-only part of step 2. Bonus allocation moves to Growth (phase 2).
- [ ] **One inventory component**: Play's Items card (`renderItems`/`itemRow` in play.js) and Build's slot grid
  (`renderInventory`) become one renderer with a `mode` ('build' | 'play'). Play adds usage dice, ammo, and the ground zone.
- [ ] **Drafts**:
  - A new crow saves to the account at once as a draft. Add a `draft` column to `characters` in server/app/schema.sql (additive,
    via install.php) and return it from list.
  - cloud.js `manualNew`/`hold`/`saveNow` becomes "save as draft, then Finish crow".
  - The portal shows drafts (phase 4).
- [ ] **Header**: on the accounts site (`CrowsCloud.server`), put Save file, Load file, and Start over in a "⋯" menu.

## Phase 4: Portal (server/public/portal.js, portal.css)

- [ ] Merge `viewCharacters` and `viewPlay` into one "Crows" list (`listPage('characters', …)`). Each row shows its status chip
  (draft / ready / in *campaign*, from `characters.campaigns` / handed to …) and one main button by status: Continue building
  (`?id=N&mode=build`), Play (`play?id=N`), or Open. The other buttons go in a "More" menu. Keep `#play` working as an alias.
- [ ] Home (`viewHome`): News, then "Your crows" (the top few, plus a link to all), then "Your campaigns" for Refs, then tiles for
  Find a campaign and Admin.
- [ ] Tests: the smoke test only checks the API. Check the portal in the browser pane (it's already logged in on the test instance
  as test_player; don't log in with passwords).
