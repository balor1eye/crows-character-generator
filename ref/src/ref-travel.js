/*
 * Ref Screen: travel encounters (weather, merchants, travelers, wild animals) and the Travel tab, with Miasma RRs. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), addsText = f('addsText'), addToCombatBtn = f('addToCombatBtn'), btn = f('btn'), card = f('card'), chk = f('chk'),
      clamp = f('clamp'), clearCruelty = f('clearCruelty'), encounterCheck = f('encounterCheck'), encounterResultBox = f('encounterResultBox'),
      field = f('field'), inp = f('inp'), log = f('log'), lookup = f('lookup'), miasmaOutcome = f('miasmaOutcome'), more = f('more'),
      render = f('render'), rollAdds = f('rollAdds'), rollDungeonTable = f('rollDungeonTable'), rollInText = f('rollInText'),
      rowsTable = f('rowsTable'), S = f('S'), save = f('save'), segEB = f('segEB'), sel = f('sel'), setTab = f('setTab'), test = f('test'),
      testLine = f('testLine'), travelCalc = f('travelCalc');
  var d = A.d, el = A.el, rollDice = A.rollDice, signed = A.signed, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  function rollTravelEncounter() {
    var t = state.travel, n = d(100), kind = lookup(REF.TRAVEL_ENCOUNTERS, n)[2], out = { roll: n, kind: kind, lines: [], adds: [] };
    if (kind === 'Any Monster') {
      var m = d(10), row = lookup(REF.ANY_MONSTER, m);
      out.lines.push('Monster type (d10 = ' + m + '): ' + row[2]);
      if (row[3]) { var e = rollDungeonTable(row[3]); out.lines.push(row[3] + ' table (d' + e.die + ' = ' + e.roll + '): ' + e.text); out.adds = e.adds; }
    } else if (kind === 'Monster from Nearby') {
      if (REF.DUNGEON_TABLES[t.nearby]) { var e2 = rollDungeonTable(t.nearby); out.lines.push('Nearest dungeon: ' + t.nearby + ' (d' + e2.die + ' = ' + e2.roll + '): ' + e2.text); out.adds = e2.adds; }
      else out.lines.push('Use the monster table of the closest dungeon\'s type.');
    } else if (kind === 'Bad Weather') {
      var w = rollWeather(); out.lines.push(w.text);
    } else if (kind === 'Merchant') {
      var mc = rollMerchant(); out.lines = out.lines.concat(mc.lines); out.adds = mc.adds;
    } else if (kind === 'Miasma-Touched') {
      var mt = rollMiasmaTouched(); out.lines = out.lines.concat(mt.lines); out.adds = mt.adds;
    } else if (kind === 'Strong Miasma') {
      out.lines.push(REF.STRONG_MIASMA);
    } else if (kind === 'Traveler') {
      var tr = rollTravelers(); out.lines = out.lines.concat(tr.lines); out.adds = tr.adds;
    } else if (kind === 'Wild Animal') {
      var wa = rollWildAnimal(t.habitat); out.lines = out.lines.concat(wa.lines); out.adds = wa.adds;
    }
    out.summary = 'Travel encounter (d100 = ' + n + '): **' + kind + '**. ' + out.lines.join(' ');
    return out;
  }
  function travelResultBox(r) {
    return el('div', null, [el('div', null, ['Travel encounter (d100 = ' + r.roll + '): ', el('b', { text: r.kind })]),
      el('ul', null, r.lines.map(function (l) { return el('li', { text: l }); })), addToCombatBtn(r.adds)]);
  }
  function rollWeather(climate) {
    climate = climate || state.travel.climate;
    var pair = REF.WEATHER_BY_CLIMATE[climate], r = d(6), w = pair[r % 2 === 1 ? 0 : 1];
    return { name: w, text: 'Bad weather for 24 hours (' + climate + ', die ' + r + '): ' + w + '. ' + REF.WEATHER[w].txt };
  }
  function rollMerchant() {
    var lines = [], adds = [], picks = [], guard = 0;
    function one() { var n = d(100); return { n: n, row: lookup(REF.MERCHANT_SALES, n) }; }
    var first = one();
    if (first.n >= 99) {
      var prev = null, cur;
      while (guard++ < 50) { cur = one(); if (cur.n >= 99) continue; var inst = cur.row[2].split(' ')[0]; if (prev && prev.row[2].split(' ')[0] !== inst) { picks = [prev, cur]; break; } prev = cur; }
      lines.push('Merchant sales d100 = ' + first.n + ': rerolled until two different institutions in a row.');
    } else picks = [first];
    picks.forEach(function (p) {
      var key = /^General Store/.test(p.row[2]) ? 'General Store' : p.row[2].split(' ')[0];
      lines.push('Caravan acts as: ' + p.row[2] + ' (d100 = ' + p.n + '). Merchant NPC: ' + (REF.MERCHANT_NPC[key] || 'Commoner') + '.');
      adds.push([REF.MERCHANT_NPC[key] || 'Commoner', 1, null]);
    });
    var pcs = Math.max(1, activePCs().length), g = rollDice(pcs + 'd6').total, counts = {};
    for (var i = 0; i < g; i++) { var gname = REF.MERCHANT_GUARDS[d(10) - 1]; counts[gname] = (counts[gname] || 0) + 1; }
    Object.keys(counts).forEach(function (k) { adds.push([k, counts[k], null]); });
    lines.push('Guards: ' + g + ' (1d6 per crow; place only if needed): ' + Object.keys(counts).map(function (k) { return counts[k] + ' × ' + k; }).join(', ') + '.');
    lines.push('The caravan buys goods at 1d10% of value (rolled: ' + d(10) + '%).');
    return { lines: lines, adds: adds };
  }
  function tallyHumans(list, count) {
    var counts = {};
    for (var i = 0; i < count; i++) { var h = list[Math.floor((d(100) - 1) / 4)]; counts[h] = (counts[h] || 0) + 1; }
    return Object.keys(counts).map(function (k) { return [k, counts[k], null]; });
  }
  function rollMiasmaTouched() {
    var n = d(6), adds = tallyHumans(REF.HUMANS_MIASMA, n), e = d(100);
    return { adds: adds, lines: ['Miasma-touched humans (1d6 = ' + n + '; wicked but self-preserving): ' + addsText(adds) + '.', 'Encounter (d100 = ' + e + '): ' + rollInText(lookup(REF.MIASMA_TOUCHED, e)[2])] };
  }
  function rollTravelers() {
    var n = d(10), adds = tallyHumans(REF.HUMANS_TRAVELER, n), e = d(10), rw = d(6);
    return { adds: adds, lines: ['Travelers (1d10 = ' + n + '; cautious, guarded until the crows show kindness): ' + addsText(adds) + '.',
      'Encounter (d10 = ' + e + '): ' + rollInText(lookup(REF.TRAVELER_ENCOUNTERS, e)[2]),
      'Reward if earned (d6 = ' + rw + '): ' + rollInText(lookup(REF.TRAVELER_REWARDS, rw)[2]) + '.'] };
  }
  function rollWildAnimal(habitat) {
    var h = REF.HABITATS[habitat] || REF.HABITATS.Forest, n = d(h.die), row = lookup(h.rows, n), adds = rollAdds(row[3]), r = d(100);
    return { adds: adds, lines: [habitat + ' (d' + h.die + ' = ' + n + '): ' + row[2] + ' → ' + addsText(adds) + '.', 'Reaction (d100 = ' + r + '): ' + lookup(REF.ANIMAL_REACTION, r)[2]] };
  }

  // ------------------------------------------------------------------ Travel tab
  function renderTravel() {
    var t = state.travel, calc = travelCalc();
    card('sec-travel-day', el('h2', null, ['Overland Travel', el('small', { text: 'day ' + t.day })]), [
      el('p', { class: 'hint', text: 'Each day: set the pace; role tests (supporters, guides, scouts, trackers); encounter check; explore the destination or a POI in DTs; rest; each human rolls a Miasma RR after resting. Hexes are 5 miles.' }),
      el('div', { class: 'grid3' }, [
        field('Pace', sel(t, 'pace', Object.keys(REF.PACES).map(function (k) { return [k, k + ' (' + REF.PACES[k].hex + ' hex, EN ' + REF.PACES[k].en + ')']; }))),
        field('Slowest speed in the group', inp(t, 'speed', { type: 'number', min: 0, max: 20 }, { re: true, dflt: 5 })),
        field('Water', sel(t, 'water', [['none', 'None'], ['against', 'Crossing major water / upstream (-1 hex)'], ['down', 'Downstream (+1 hex)']])),
        field('Weather today', sel(t, 'weather', [['', 'Fair']].concat(Object.keys(REF.WEATHER).map(function (w) { return [w, w]; })))),
        field('Hex adjustment (roles)', inp(t, 'hexAdj', { type: 'number', min: -5, max: 5 }, { re: true })),
        field('Travel EN adjustment (roles)', inp(t, 'enAdj', { type: 'number', min: -5, max: 5 }, { re: true })),
        field('Rest EN adjustment (roles)', inp(t, 'restEnAdj', { type: 'number', min: -5, max: 5 }, { re: true })),
        el('div', { class: 'checks span2' }, [chk(t, 'road', 'On a road all day'), chk(t, 'inMiasma', 'In the Miasma'), chk(t, 'beacon', 'Only beacon-protected hexes'), chk(t, 'strong', 'Strong Miasma today')])
      ]),
      el('div', { class: 'stat-row', style: 'margin-top:.7rem' }, [
        el('div', { class: 'stat big hot' }, [el('div', { class: 'lbl', text: 'Hexes today' }), el('div', { class: 'val', text: String(calc.hex) })]),
        el('div', { class: 'stat big' }, [el('div', { class: 'lbl', text: 'Travel EN' }), el('div', { class: 'val', text: String(calc.en) })]),
        el('div', { class: 'stat big' }, [el('div', { class: 'lbl', text: 'Rest EN' }), el('div', { class: 'val', text: String(calc.restEn) })])
      ]),
      el('p', { class: 'fine', text: [calc.paceNote ? t.pace + ' pace: ' + calc.paceNote : ''].concat(calc.notes).filter(Boolean).join(' · ') + (t.weather ? ' · ' + REF.WEATHER[t.weather].txt : '') }),
      t.strong ? el('div', { class: 'banner warn', text: 'Strong Miasma: ' + REF.STRONG_MIASMA }) : null,
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [
        btn('Travel encounter check (EN ' + calc.en + ')', function () { ui.travelEnc = encounterCheck('Travel day ' + t.day, calc.en, 'Travel'); save(); render(); }, 'btn-primary'),
        btn('Next day', function () {
          log('dt', '**Travel day ' + t.day + ' ends.** ' + calc.hex + ' hexes at a ' + t.pace.toLowerCase() + ' pace' + (t.weather ? ', ' + t.weather.toLowerCase() : '') + '.');
          t.day += 1; t.hexAdj = 0; t.enAdj = 0; t.restEnAdj = 0; t.weather = ''; t.strong = false; save(); render();
        }),
        btn('Set up an outdoor rest', function () { S().rest.where = 'outdoors'; save(); setTab('session'); }, 'btn-ghost')
      ]),
      ui.travelEnc ? encounterResultBox(ui.travelEnc, function () { ui.travelEnc = null; render(); }) : null,
      el('h3', { text: 'Lost?' }),
      el('div', { class: 'row center' }, [chk(t, 'lost', 'The group is lost (secret)'),
        t.lost ? btn('They leave a hex: roll secret direction', function () {
          var r = d(6); ui.lostDir = 'd6 = ' + r + ': they actually enter the hex to the ' + REF.DIRECTIONS[r] + '.';
          log('secret', '(Ref only) Lost: they enter the hex to the ' + REF.DIRECTIONS[r] + ' (d6 = ' + r + ').'); render();
        }) : null]),
      t.lost && ui.lostDir ? el('div', { class: 'result', text: ui.lostDir }) : null,
      el('p', { class: 'fine', text: 'While lost, the Ref tracks the group secretly. Each hex they leave, roll 1d6 counting clockwise from north (1 N, 2 NE, 3 SE, 4 S, 5 SW, 6 NW). A guide can try Back on Track at the start of a day; a map, a recognizable place, or an NPC\'s directions also help.' })
    ]);

    card('sec-travel-enc', el('h2', null, ['Travel Encounters', el('small', { text: 'd100, any time in the travel day' })]), [
      el('div', { class: 'grid3' }, [
        field('Climate / season', sel(t, 'climate', Object.keys(REF.WEATHER_BY_CLIMATE))),
        field('Habitat', sel(t, 'habitat', Object.keys(REF.HABITATS))),
        field('Nearest dungeon type', sel(t, 'nearby', [['Undead', 'Undead'], ['Blood Creatures', 'Blood creatures'], ['other', 'Other (Ref\'s choice)']]))
      ]),
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [
        btn('Roll travel encounter', function () { var r = rollTravelEncounter(); ui.travelRoll = r; log('enc', r.summary); render(); }, 'btn-primary'),
        btn('Bad weather', function () { var w = rollWeather(); ui.travelRoll = { roll: '—', kind: 'Bad Weather', lines: [w.text], adds: [] }; t.weather = w.name; log('', w.text); save(); render(); }),
        btn('Wild animal', function () { var w = rollWildAnimal(t.habitat); ui.travelRoll = { roll: '—', kind: 'Wild Animal', lines: w.lines, adds: w.adds }; log('', 'Wild animal: ' + w.lines.join(' ')); render(); }),
        btn('Travelers', function () { var w = rollTravelers(); ui.travelRoll = { roll: '—', kind: 'Traveler', lines: w.lines, adds: w.adds }; log('', 'Travelers: ' + w.lines.join(' ')); render(); }),
        btn('Miasma-touched', function () { var w = rollMiasmaTouched(); ui.travelRoll = { roll: '—', kind: 'Miasma-Touched', lines: w.lines, adds: w.adds }; log('', 'Miasma-touched: ' + w.lines.join(' ')); render(); }),
        btn('Merchant', function () { var w = rollMerchant(); ui.travelRoll = { roll: '—', kind: 'Merchant', lines: w.lines, adds: w.adds }; log('', 'Merchant: ' + w.lines.join(' ')); render(); })
      ]),
      ui.travelRoll ? el('div', { class: 'result' }, [travelResultBox(ui.travelRoll)]) : null,
      more('The travel encounter table', [rowsTable(REF.TRAVEL_ENCOUNTERS, 'd100', ui.travelRoll && typeof ui.travelRoll.roll === 'number' ? ui.travelRoll.roll : null),
        el('p', { class: 'fine', text: 'Check after role tests; the Ref picks the time and may add more checks. POIs are explored in DTs using the day\'s EN.' })])
    ]);

    renderMiasma('sec-miasma');

    card('sec-travel-roles', 'Travel Roles', [
      el('p', { class: 'hint', text: 'Any role may be vacant; up to 3 per role doing different tasks (guide only 1); others may assist. Resolve in order: supporters, guides, scouts, trackers.' }),
      el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [
        el('thead', null, [el('tr', null, ['Role', 'Task', 'Test', 'Tier 1', 'Tier 2', 'Tier 3'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', null, REF.TRAVEL_ROLES.map(function (r) { return el('tr', null, r.map(function (x, i) { return el('td', { class: i === 0 ? 'n' : '', text: x }); })); }))
      ])])
    ]);
  }
  function renderMiasma(id) {
    var t = state.travel, pcs = activePCs();
    card(id, el('h2', null, ['Miasma', el('small', { text: 'RRs after each rest in the Miasma' })]), [
      el('p', { class: 'hint', text: REF.MIASMA_RULES }),
      el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'Modifier for today\'s RRs (Fight the Miasma: edge / double edge; Strong Miasma: bane)' }), segEB(t, 'miasmaMod')]),
      pcs.length ? el('div', { class: 'list' }, pcs.map(function (p) {
        var net = t.miasmaMod + (t.strong ? -1 : 0);
        net = clamp(net, -2, 2);
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', null, [el('b', { text: p.name || 'Crow' }), ' · M ' + signed(p.M) + ' · cruelty ' + (p.cruelty || 0) + ' (RR ' + signed(p.M - (p.cruelty || 0)) + ')']),
          p.miasma.length ? el('div', { class: 'fine', text: p.miasma.map(function (k) { var row = lookup(REF.MIASMA_EFFECTS, k); return row[2].split(':')[0] + ' / ' + row[3]; }).join(' · ') }) : null
        ]), el('div', { class: 'li-row' }, [
          btn('Roll RR', function () { var r = test(p.M - (p.cruelty || 0), net); miasmaOutcome(p, r.tier, '(' + testLine(r) + ')'); }, 'btn-small btn-primary'),
          btn('T1', function () { miasmaOutcome(p, 1); }, 'btn-small', 'Player rolled tier 1'),
          btn('T2', function () { miasmaOutcome(p, 2); }, 'btn-small', 'Player rolled tier 2'),
          btn('T3', function () { miasmaOutcome(p, 3); }, 'btn-small', 'Player rolled tier 3'),
          btn('Clear cruelty', function () { clearCruelty(p); }, 'btn-small btn-ghost', 'Rested without Miasma, or a T3 removed it')
        ])]);
      })) : el('p', { class: 'hint', text: 'Add crows in the Party tab to roll their Miasma RRs here.' }),
      more('Miasma effects table (1d10 + cruelty)', [rowsTable(REF.MIASMA_EFFECTS, '1d10+cruelty', null, function (r) { return r[2] + ' + ' + r[3]; })])
    ]);
  }

  A.add({ rollTravelEncounter: rollTravelEncounter, travelResultBox: travelResultBox, rollWeather: rollWeather, rollMerchant: rollMerchant,
      tallyHumans: tallyHumans, rollMiasmaTouched: rollMiasmaTouched, rollTravelers: rollTravelers, rollWildAnimal: rollWildAnimal,
      renderTravel: renderTravel, renderMiasma: renderMiasma });
})();
