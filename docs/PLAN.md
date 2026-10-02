# UX streamlining plan (remaining phases)

Done: phase 0 (party rests and XP claims on linked sheets) and phase 1 (src/shared/, split app.js and ref.js), in 658e657.
Each phase ships on its own. After each: rebuild dist/, `server/deploy.sh`, then on the test instance run `test_instance.py smoke`,
`ref/test/run_live_rest_test.py`, `ref/test/run_live_combat_test.py`, and `run_combat_test.py --test-instance`. Run them in the
background with `python3 -u`, never piped. Promote to production only when asked (CLAUDE.md).
Order: 2, 5, 6, 3, 4.

## Phase 2: Play mode by situation (src/play.js, src/combat.js, src/app.css)
- A sticky vitals strip (Stamina, AD, wounds, speed, conditions, quick ±) plus four sub-tabs:
  - **Now**: live combat, or attacks and dice.
  - **Rest & turns**: rest choices, DT, magic slots, pets.
  - **Items**: one inventory screen.
  - **Growth**: XP, bonuses, buying traits.
  
  Keep src/layout.js blocks working inside each sub-tab.
- Show a roll's result inline under the button that rolled it, with the expertise and chaos follow-ups there too. On mobile the sidebar
  roller goes (app.css puts .summary at order:-1 under 1000px).
- Move bonus choices and trait buying into Growth, reusing build-view.js (renderAdvance, renderTraits). Drop the gotoBuild links.
- Phone order: vitals strip, then the sub-tab. The Crow summary becomes a collapsible header.

## Phase 5: Ref Screen (ref/src/)
- Group the tabs:
  - **Run**: Session, Encounters, Travel.
  - **Campaign**: Party, Village, World.
  - **Reference**: Bestiary, Tables, Rules, behind one search.
  
  TABS is in ref-core.js.
- One combat tracker: it lives in the running encounter. Session shows a "Fight in progress" link instead of the second combatUI.
- Sidebar: timer, dice, recent log. Remove the Session log card. Move the invite link (renderInvite) to the Party tab.
- Replace the Party status iframes (renderStatus, statusFrames, sheetOp via sheetWin) with tiles drawn from link.get data. Changes still
  go through refChange ops: apply them by loading the sheet only when needed, or move refChange's logic into src/shared/ so the Ref
  Screen can apply ops to the data and save with link.save itself. Load the full sheet only on Open sheet.
- Start session (number +1, archive the log) and End session (award XP from claims and the greed bonus, prompt the village cycle).

## Phase 6: session state on the player's page
- Publish a `session` part with the fight (combat.publish, publicCombat in ref-combat.js): DT, timer end time, greed bonus, rest
  active, signalled encounter. combat.js shows it as a bar in Play.
- When the Ref starts a rest, linked players get a rest prompt (food, activity, Tend Wounds). Their choices go with the rest op, or
  defaults apply. doRest(o) in play.js already takes these choices.

## Phase 3: Build flow (src/build-view.js, src/index.html)
- A guided flow: progress across the top, a checklist that also shows on mobile (it's hidden under 1000px), Next buttons. Fold step 4
  (Expertises & Stamina, all derived) into steps 1–2 as a read-only display.
- One inventory component (the slot grid) for both Build and Play. Play adds usage dice, ammo, and the ground.
- A new crow autosaves as a draft in the account (cloud.js manualNew/hold: add a draft flag on the server). "Save character" becomes
  "Finish crow".
- Header: on the accounts site, move Save file/Load file/Start over into a "⋯" menu.

## Phase 4: Portal (server/public/portal.js)
- Merge My characters and Play into one Crows list. Each card shows a status (draft / ready / in *campaign* / handed to …) and one main
  button: Continue building, Play, or Open. Everything else goes in a menu.
- Home: your crows and your campaigns, with News at the top.

## Code notes
- Split files share a namespace: window.CrowsGen (src/state.js first, app.js last) and window.CrowsRefApp (ref-core.js first, ref.js
  last). Each file ends with A.add({...}). Calls into another file go through `f('name')` forwarders at the top. A top-level function
  used by another file must be in its A.add, plus a forwarder in the file that uses it. state (and tab in the Ref Screen) change only
  through A.set('state', v).
- What a Ref may write on a linked sheet: SHARED_FIELDS (server/app/api.php) and LINK_FIELDS (src/cloud.js), which must match. The
  Ref only adds to play.claimsAnswered; only the player's sheet changes play.xpClaims.
- Never type test passwords into a browser: use server/test_instance.py.
