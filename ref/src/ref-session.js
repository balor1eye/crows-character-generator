/*
 * Ref Screen: ending dungeon turns, rests and the Miasma, and the Session tab (timer, rest, log). See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), addsText = f('addsText'), addToCombatBtn = f('addToCombatBtn'), allClaims = f('allClaims'), btn = f('btn'), card = f('card'), chk = f('chk'),
      currentPlace = f('currentPlace'), download = f('download'), dungeonEN = f('dungeonEN'), encounterCheck = f('encounterCheck'),
      encounterResultBox = f('encounterResultBox'), field = f('field'), greedBonus = f('greedBonus'), inp = f('inp'), log = f('log'),
      logItem = f('logItem'), lookup = f('lookup'), more = f('more'), nowStamp = f('nowStamp'), pauseTimer = f('pauseTimer'),
      pendingEnc = f('pendingEnc'), pendingFrom = f('pendingFrom'), pendingText = f('pendingText'), render = f('render'),
      renderCombat = f('renderCombat'), resetTimer = f('resetTimer'), rollDungeonTable = f('rollDungeonTable'), runEncBtn = f('runEncBtn'),
      S = f('S'), save = f('save'), sel = f('sel'), setTab = f('setTab'), sheetOp = f('sheetOp'), startTimer = f('startTimer'), today = f('today'),
      travelCalc = f('travelCalc');
  var $ = A.$, d = A.d, el = A.el, fmt = A.fmt, plural = A.plural, Rules = A.Rules, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ dungeon turns
  function endDT() {
    var s = S(), place = currentPlace(), cleared = [];
    if (s.rest.active) { toast('Finish or cancel the rest first.'); return; }
    log('dt', '**End of DT ' + s.dt + '**' + (place ? ' at ' + place.name : '') + '. Roll usage dice (lights, spells, backlashes, DT items); DT effects end.');
    s.combat.list.forEach(function (c) { Rules.DT_CONDITIONS.forEach(function (k) { if (c.conds[k]) { delete c.conds[k]; cleared.push(c.name + ' ' + k.toLowerCase()); } }); });
    if (cleared.length) log('', 'Conditions ended: ' + cleared.join(', ') + '.');
    activePCs().forEach(function (p) { sheetOp(p, { endDT: s.dt }); });   // linked crows: lights, conditions, overloaded slots on their sheets
    if (s.pending) log('enc', '**Reminder:** the encounter signalled during DT ' + s.pending.dt + ' was due this DT (' + (pendingEnc() ? pendingEnc().name : s.pending.text) + ').');
    var res = encounterCheck('End of DT ' + s.dt, dungeonEN(), s.table === 'none' ? null : s.table);
    ui.lastEnc = res;
    s.pending = pendingFrom(res);
    if (place) place.visited = true;
    var wasRunning = s.running;
    s.dt += 1;
    resetTimer();
    if (s.mode === 'rooms') { s.rooms = d(6); s.roomsDone = 0; log('dt', 'DT ' + s.dt + ' begins: it ends after ' + plural(s.rooms, 'room') + ' explored (1d6).'); }
    else log('dt', 'DT ' + s.dt + ' begins.' + (greedBonus() ? ' Greed bonus: treasure found +' + greedBonus() + '%.' : ''));
    if (wasRunning && s.autoNext && s.mode === 'timer') { s.endAt = Date.now() + s.remain; s.running = true; }
    save(); render();
  }
  function setDTLen(mins) {
    var s = S();
    if (mins === 'rooms') { s.mode = 'rooms'; s.running = false; if (!s.rooms) { s.rooms = d(6); s.roomsDone = 0; log('dt', 'DT ends every 1d6 rooms: this DT ends after ' + plural(s.rooms, 'room') + '.'); } }
    else { s.mode = 'timer'; s.dtLen = mins; resetTimer(); }
    save(); render();
  }

  // ------------------------------------------------------------------ rest & Miasma
  function startRest() {
    var s = S();
    if (s.running) { s.remain = Math.max(0, s.endAt - Date.now()); s.running = false; }
    s.rest.active = true; s.rest.half = false;
    log('dt', '**Rest begins** (' + s.rest.where + (s.rest.seclude ? ', secluded camp' : '') + '). DT ' + s.dt + ' ends without an encounter check.');
    save(); render();
  }
  function restEN() { return S().rest.where === 'outdoors' ? travelCalc().restEn : dungeonEN(); }
  function restHalf() {
    var s = S(), cleared = [];
    s.rest.half = true;
    s.combat.list.forEach(function (c) { Rules.DT_CONDITIONS.forEach(function (k) { if (c.conds[k]) { delete c.conds[k]; cleared.push(c.name + ' ' + k.toLowerCase()); } }); });
    activePCs().forEach(function (p) { sheetOp(p, { endConds: true }); });   // and on linked crows' sheets
    log('', 'Rest halfway: effects lasting to the end of the DT, and DT-rolled usage-dice effects, end.' + (cleared.length ? ' Ended: ' + cleared.join(', ') + '.' : ''));
    save(); render();
  }
  function finishRest() {
    var s = S(), applied = [];
    activePCs().forEach(function (p) {
      var xp = s.rest.applyXP && p.pending;
      if (xp) applied.push((p.name || 'Crow') + ' +' + fmt(p.pending));
      // The whole rest on each sheet (food, Stamina, a wound, expertise uses, recharges, XP); the rest used up DT s.dt.
      sheetOp(p, { rest: { dt: s.dt, miasma: s.rest.where === 'outdoors' && !!state.travel.inMiasma, xp: !!s.rest.applyXP } });
    });
    s.combat.list.forEach(function (c) { c.used = {}; if (c.kind === 'pc') { var p = state.party.filter(function (x) { return x.id === c.pcId; })[0]; if (p) { c.st = p.st; c.wounds = p.wounds; } } });
    log('dt', '**Rest complete.** Crows regain all Stamina, heal 1 wound, and regain expertise uses' + (s.rest.where === 'outdoors' && state.travel.inMiasma ? ' (NOT in the Miasma: no expertise uses; roll Miasma RRs)' : '') +
      '. Spellbook UD restored. Each crow ate a ration (or takes a starvation wound).' + (applied.length ? ' XP applied: ' + applied.join(', ') + '.' : '') +
      (activePCs().some(function (p) { return p.link; }) ? ' Linked crows\u2019 sheets did all of this (a crow that already rested from its own sheet this DT is skipped).' : ''));
    s.rest.active = false; s.rest.half = false; s.dt += 1; resetTimer();
    if (s.mode === 'rooms') { s.rooms = d(6); s.roomsDone = 0; }
    log('dt', 'DT ' + s.dt + ' begins.');
    save(); render();
    if (s.rest.where === 'outdoors' && state.travel.inMiasma) toast('Rested in the Miasma: roll each human\'s Miasma RR.');
  }
  function miasmaOutcome(p, tier, detail) {
    var msg = (p.name || 'Crow') + ' Miasma RR' + (detail ? ' ' + detail : '') + ': T' + tier;
    if (tier === 1) {
      sheetOp(p, { cruelty: 1 });
      var tries = 0, n, row;
      do { n = d(10) + p.cruelty; row = lookup(REF.MIASMA_EFFECTS, n); tries++; } while (tries < 20 && row[0] < 13 && p.miasma.indexOf(row[0]) >= 0);
      if (p.miasma.indexOf(row[0]) < 0) p.miasma.push(row[0]);
      msg += ' → **gains 1 cruelty (now ' + p.cruelty + ')** and a Miasma effect (1d10+cruelty = ' + n + '): **' + row[2] + '** ' + row[3];
      if (row[0] >= 13) { p.status = 'lost'; msg += ' ' + (p.name || 'The crow') + ' becomes a Ref NPC.'; }
    } else if (tier === 2) msg += ' → no effect.';
    else msg += ' → may remove all their cruelty, or improve another human\'s result by 1 tier.';
    log(tier === 1 ? 'enc' : '', msg);
    save(); render();
  }
  function clearCruelty(p) { sheetOp(p, { setCruelty: 0 }); p.miasma = []; log('', (p.name || 'Crow') + ' loses all cruelty and Miasma effects.'); save(); render(); }

  // ------------------------------------------------------------------ Session tab
  function renderSession() {
    var s = S(), place = currentPlace();
    var placeOpts = [['', '— none / free text —']].concat(state.places.map(function (p) { return [p.id, p.name + (p.kind ? ' (' + p.kind + ')' : '')]; }));
    var clock = el('div', { class: 'clock-box' }, [
      el('div', { class: 'lbl', text: (s.rest.active ? 'Resting — ' : '') + 'Dungeon turn ' + s.dt }),
      el('div', { 'data-clock': '1', class: 'clock' }),
      el('div', { class: 'meter', 'data-meter': '1' }, [el('span')]),
      el('div', { class: 'row center' }, s.mode === 'timer' ? [
        s.running ? btn('Pause', pauseTimer) : btn('Start timer', startTimer, 'btn-primary'),
        btn('Reset', function () { resetTimer(); render(); }, 'btn-ghost'),
        btn('+5 min', function () { if (s.running) s.endAt += 300000; else s.remain += 300000; ui.alarmFired = false; save(); render(); }, 'btn-ghost btn-small'),
        btn('-5 min', function () { if (s.running) s.endAt -= 300000; else s.remain = Math.max(0, s.remain - 300000); save(); render(); }, 'btn-ghost btn-small')
      ] : [btn('+1 room explored', function () { s.roomsDone++; save(); if (s.roomsDone >= s.rooms) toast('That was the last room of this DT: end the DT.'); render(); }, 'btn-primary'),
        btn('-1', function () { s.roomsDone = Math.max(0, s.roomsDone - 1); save(); render(); }, 'btn-ghost btn-small')]),
      el('div', { class: 'row center', style: 'margin-top:.5rem' }, [
        el('div', { class: 'seg' }, [[60, '60 min'], [30, '30 min'], [20, '20 min'], ['rooms', '1d6 rooms']].map(function (o) {
          var on = o[0] === 'rooms' ? s.mode === 'rooms' : s.mode === 'timer' && s.dtLen === o[0];
          return el('button', { type: 'button', class: on ? 'on' : '', text: o[1], onclick: function () { setDTLen(o[0]); } });
        })),
        chk(s, 'sound', 'Chime'), chk(s, 'autoNext', 'Auto-start next DT', { title: 'When you end a DT while the timer runs, start the next one immediately' })
      ])
    ]);
    var en = dungeonEN(), g = greedBonus();
    var settings = el('div', null, [
      el('div', { class: 'grid2' }, [
        field('Location', sel(s, 'place', placeOpts, { on: function (id) {
          var p = currentPlace(); if (p) { s.table = p.table === 'Travel' ? 'Travel' : REF.DUNGEON_TABLES[p.table] ? p.table : 'none'; s.firstVisit = !p.visited; s.enAdj = 0; }
        } })),
        field('Monster table', sel(s, 'table', [['Blood Creatures', 'Blood creatures (d6)'], ['Undead', 'Undead (d10)'], ['Travel', 'Travel encounters (outdoors)'], ['none', 'Ref\'s choice (no roll)']]))
      ]),
      el('div', { class: 'checks' }, [
        chk(s, 'crowded', 'Crowded (20+ creatures on the level)'), chk(s, 'chaos', 'Crows left chaos (trail of bodies)'),
        chk(s, 'firstVisit', 'First visit (greed bonus)')
      ]),
      el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'Other EN adjustment (e.g. bloodstained crows)' }), inp(s, 'enAdj', { type: 'number', min: -5, max: 5, class: 'tiny' }, { re: true })]),
      el('div', { class: 'stat-row', style: 'margin-top:.6rem' }, [
        el('div', { class: 'stat hot' }, [el('div', { class: 'lbl', text: 'Encounter #' }), el('div', { class: 'val', text: String(en) })]),
        el('div', { class: 'stat' }, [el('div', { class: 'lbl', text: 'Greed bonus' }), el('div', { class: 'val', text: g ? '+' + g + '%' : '—' })]),
        el('div', { class: 'stat' }, [el('div', { class: 'lbl', text: 'Session' }), el('div', { class: 'val', text: String(s.n) })])
      ]),
      place && place.notes ? el('p', { class: 'fine', text: place.name + ': ' + place.notes }) : null
    ]);
    card('sec-dt', el('h2', null, ['Dungeon Turns', el('small', { text: 'shared timer, encounter checks, greed bonus' })]), [
      el('div', { class: 'dt-grid' }, [clock, settings]),
      el('div', { class: 'row', style: 'margin-top:.8rem' }, [
        btn('End dungeon turn', endDT, 'btn-primary', 'Usage dice, end-of-DT conditions, encounter check'),
        btn('Encounter check (loud noise)', function () { var res = encounterCheck('Loud noise', dungeonEN(), s.table === 'none' ? null : s.table); ui.lastEnc = res; if (res.hit && !res.immediate) s.pending = pendingFrom(res); save(); render(); }),
        btn('Roll on monster table', function () {
          if (!REF.DUNGEON_TABLES[s.table]) { toast('Pick the blood creature or undead table first.'); return; }
          var e = rollDungeonTable(s.table); ui.lastEnc = { reason: 'Monster table', roll: '—', en: '—', hit: true, immediate: false, table: s.table, enc: e, t: nowStamp() };
          log('', s.table + ' table d' + e.die + ' = ' + e.roll + ': ' + addsText(e.adds) + '.'); render();
        }, 'btn-ghost')
      ]),
      s.pending ? el('div', { class: 'pending' }, [el('b', { text: 'Encounter signalled during DT ' + s.pending.dt + ': ' }), pendingText(s.pending), '. It arrives any time this DT.',
        el('div', { class: 'row' }, [pendingEnc() ? runEncBtn(pendingEnc()) : addToCombatBtn(s.pending.adds), btn('It happened / cancel', function () { s.pending = null; save(); render(); }, 'btn-small btn-ghost')])]) : null,
      ui.lastEnc ? encounterResultBox(ui.lastEnc, function () { ui.lastEnc = null; render(); }) : null,
      more('End of each DT (checklist)', [el('ol', null, [
        el('li', { text: 'Roll usage dice for lights and anything tagged DT; spell and backlash durations in UD.' }),
        el('li', { text: 'Blessed, vulnerable, weakened, and "until the end of the DT" effects end.' }),
        el('li', { text: 'Encounter check: 1d10 ≥ EN. A 10: now. 9 or less: give a sign; it happens during the next DT.' }),
        el('li', { text: 'Greed bonus steps down (DT 1 +30%, DT 2 +20%, DT 3 +10%, first visit only).' }),
        el('li', { text: 'Outside dungeons, 2 in-game hours = 1 DT.' })
      ])])
    ]);
    renderSessionCard();
    renderCombat();
    renderRest();
    card('sec-quick', 'Quick Reference', [el('dl', { class: 'kv' }, REF.QUICK.reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, [])),
      more('Conditions', [el('dl', { class: 'kv' }, REF.CONDITIONS.reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, []))])]);
  }

  function renderRest() {
    var s = S(), r = s.rest;
    var kids = [
      el('div', { class: 'grid2' }, [
        field('Where', sel(r, 'where', [['dungeon', 'In a dungeon (dungeon EN)'], ['outdoors', 'Outdoors (travel rest EN)'], ['town', 'In a village (no encounters)']])),
        el('div', { class: 'checks' }, [chk(r, 'seclude', 'Seclude Camp (EN +1)'), chk(r, 'applyXP', 'Apply pending XP at the end')])
      ]),
      el('div', { class: 'row', style: 'margin-top:.6rem' }, r.active ? [
        btn('Rest encounter check (EN ' + restEN() + ')', function () {
          if (r.where === 'town') { toast('No encounters in a village.'); return; }
          ui.lastEnc = encounterCheck('Rest', restEN(), r.where === 'outdoors' ? 'Travel' : s.table === 'none' ? null : s.table);
          if (ui.lastEnc.hit) log('', 'Combat or strenuous activity interrupts the rest: it must restart.');
          save(); render();
        }, 'btn-primary'),
        r.half ? null : btn('Halfway (DT effects end)', restHalf),
        btn('Finish rest', finishRest, 'btn-primary'),
        btn('Interrupted: restart', function () { r.half = false; log('', 'The rest was interrupted and restarts.'); save(); render(); }, 'btn-ghost'),
        btn('Cancel rest', function () { r.active = false; save(); render(); }, 'btn-ghost')
      ] : [btn('Start rest', startRest, 'btn-primary'), el('span', { class: 'fine', text: 'Starting a rest ends the current DT without an encounter check.' })]),
      r.active && ui.lastEnc && ui.lastEnc.reason === 'Rest' ? encounterResultBox(ui.lastEnc, function () { ui.lastEnc = null; render(); }) : null,
      more('Rest rules and activities', [
        el('p', { text: 'Rest: 6 uninterrupted hours in one place, no strenuous activity, 4+ hours asleep, eat 1 ration (pets eat too). At the end: all Stamina, lose 1 wound (their choice), all expertise uses (not in the Miasma), spellbook UD restored. One rest activity each:' }),
        el('dl', { class: 'kv' }, [['Craft Equipment', '1 crafting roll.'], ['Harvest', 'Destroy a corpse for parts: Medium or smaller 1d6, Large 2d6, Huge 3d6, Holy Shit 4d6.'], ['Identify Item', 'Learn a magic item\'s properties.'],
          ['Prepare for Task', 'A specific, intimately known task and place that needs a test: +2 on it until the next rest.'], ['Repair Armor', '1 armor or shield back to full AD (needs a repair kit, included with armor).'],
          ['Seclude Camp', 'EN +1 during the rest; 1 per group; works even if the rest is interrupted.'], ['Tend Wounds', 'Another creature with 2+ wounds loses 2 wounds instead of 1 (1 benefit per creature per rest).'],
          ['In town', 'No encounters. Up to 4 activities a day without resting, about 2 hours each; Tend Wounds once a day, benefit after 4 hours of sleep.']
        ].reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, []))
      ])
    ];
    card('sec-rest', el('h2', null, ['Rest', r.active ? el('span', { class: 'chip accent', text: r.half ? 'second half' : 'in progress' }) : null]), kids);
  }
  // ------------------------------------------------------------------ sessions
  /*
   * A session runs from Start session to End session. Starting the next one archives the last one's log (World tab, Session
   * History). session.live: true while one runs, false after End session; a campaign from before these buttons has neither,
   * and counts as running once anything is logged.
   */
  function running() { var s = S(); return s.live === true || (s.live === undefined && state.log.length > 0); }
  function startSession() {
    var s = S();
    if (state.log.length) {   // the last session's log goes to the history, and this is the next one
      state.history.push({ n: s.n, title: s.title, date: s.date, log: state.log });
      state.log = []; s.n += 1; s.title = '';
    }
    s.date = today(); s.pending = null; s.live = true; delete s.ended; ui.lastEnc = null;
    log('dt', '**Session ' + s.n + ' begins.**');
    save(); render(); toast('Session ' + s.n + ' started.' + (state.history.length ? ' The last session\u2019s log is in World, Session History.' : ''));
  }
  /* The players' open XP claims as one award (the Experience card, Party tab), with this DT's greed bonus. */
  function claimsAward() {
    var claims = allClaims(), treasures = [];
    claims.forEach(function (x) {   // a treasure several crows claimed counts once
      var t = treasures.filter(function (y) { return y.desc.toLowerCase() === x.c.desc.toLowerCase() && y.gc === x.c.gc; })[0];
      if (!t) treasures.push(t = { desc: x.c.desc, gc: x.c.gc, n: x.c.n });
    });
    var splits = treasures.map(function (t) { return t.n; }).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
    return { gc: treasures.reduce(function (t, x) { return t + x.gc; }, 0), greed: greedBonus(), what: treasures.map(function (t) { return t.desc; }).join(', '),
      players: splits.length === 1 ? splits[0] : activePCs().length || 1, claims: claims.map(function (x) { return { pc: x.p.id, id: x.c.id }; }), n: treasures.length };
  }
  function endSession() {
    var s = S(), aw = claimsAward();
    if (!confirm('End session ' + s.n + '?' + (aw.n ? ' The XP award for the players\u2019 ' + plural(aw.n, 'claim') + ' is filled in on the Party tab, ready to check and award.' : ''))) return;
    if (s.running) pauseTimer();
    s.live = false; s.ended = s.n;
    if (aw.n) ui.award = { gc: aw.gc, greed: aw.greed, players: aw.players, what: aw.what, claims: aw.claims };
    log('dt', '**Session ' + s.n + ' ends.**' + (aw.n ? ' XP award ready for ' + plural(aw.n, 'claimed treasure') + ' (' + fmt(aw.gc) + ' gc).' : ''));
    save(); render();
  }
  function goToAward() { setTab('party'); setTimeout(function () { $('sec-xp').scrollIntoView(); }, 0); }
  function renderSessionCard() {
    var s = S(), live = running(), next = state.log.length ? s.n + 1 : s.n, claims = allClaims().length;
    card('sec-sess', el('h2', null, ['Session ' + s.n, el('small', { text: live ? 'in progress' : s.ended === s.n ? 'ended' : 'not started' })]), [
      el('div', { class: 'grid2' }, [field('Session title', inp(s, 'title', { placeholder: 'e.g. Into the Blood Library' })), field('Date', inp(s, 'date', { type: 'date' }))]),
      s.ended === s.n && !live ? el('div', { class: 'pending' }, [el('b', { text: 'Session ' + s.n + ' ended.' }),
        el('ul', null, [
          el('li', null, [claims ? plural(claims, 'XP claim') + ' from players: the award is filled in on the Party tab. ' : 'XP: award any treasure on the Party tab. ',
            btn('Go to the XP award', goToAward, 'btn-small')]),
          el('li', null, ['Did the crows go back to the village? End the village cycle on the Village tab. ',
            btn('Go to the village', function () { setTab('village'); }, 'btn-small btn-ghost')])])]) : null,
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [
        live ? btn('End session ' + s.n, endSession, 'btn-primary', 'Fill in the XP award from the players\u2019 claims (with the greed bonus), and see what\u2019s left to do')
          : btn('Start session ' + next, function () {
            if (state.log.length && !confirm('Start session ' + next + '? Session ' + s.n + '\u2019s log moves to World, Session History.')) return;
            startSession();
          }, 'btn-primary', state.log.length ? 'Archive this log to World, Session History, and start a new one' : 'Start the session log'),
        btn('Export log', function () { download(logText(s.n, s.title, s.date, state.log), 'Crows_Session_' + s.n + '.txt', 'text/plain'); }, 'btn-ghost', 'This session\u2019s log as a text file')])
    ]);
  }
  function logText(n, title, date, entries) {
    return 'Crows session ' + n + (title ? ': ' + title : '') + (date ? ' (' + date + ')' : '') + '\n\n' + entries.map(function (e) { return e.t + '  ' + e.s.replace(/\*\*/g, ''); }).join('\n') + '\n';
  }

  A.add({ endDT: endDT, setDTLen: setDTLen, startRest: startRest, restEN: restEN, restHalf: restHalf, finishRest: finishRest,
      miasmaOutcome: miasmaOutcome, clearCruelty: clearCruelty, renderSession: renderSession, renderRest: renderRest, running: running, startSession: startSession, claimsAward: claimsAward,
      endSession: endSession, goToAward: goToAward, renderSessionCard: renderSessionCard,
      logText: logText });
})();
