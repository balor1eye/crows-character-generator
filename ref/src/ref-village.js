/*
 * Ref Screen: the village cycle and the Village tab (Prosperity, institutions, the crypt). See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var area = f('area'), btn = f('btn'), card = f('card'), chk = f('chk'), clamp = f('clamp'), field = f('field'), inp = f('inp'), int = f('int'),
      log = f('log'), lookup = f('lookup'), more = f('more'), nid = f('nid'), render = f('render'), rowsTable = f('rowsTable'),
      salePct = f('salePct'), save = f('save'), sel = f('sel');
  var $ = A.$, d = A.d, el = A.el, fmt = A.fmt, pick = A.pick, plural = A.plural, signed = A.signed;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ village cycle
  function instDef(type) { return REF.INSTITUTIONS[type] || { found: 0, up: [], roles: '', txt: '' }; }
  function maxLevel(type) { return instDef(type).up.length + 1; }
  function randomInst(role) {
    var list = state.village.inst.filter(function (i) { return !role || instDef(i.type).roles.indexOf(role) >= 0; });
    return list.length ? pick(list).type : null;
  }
  function endCycle() {
    var v = state.village, before = v.prosperity, change = 0, notes = [];
    if (v.upgrades > 0) { change += v.upgrades; notes.push(v.upgrades + ' founded/upgraded'); }
    if (v.spent10k) { change += 1; notes.push('10,000+ gc spent at merchants'); }
    if (!change) { change = -1; notes.push('nothing raised it'); }
    v.prosperity = clamp(before + change, -10, 10);
    var opened = [];
    v.inst.forEach(function (i) { if (i.pending) { i.level = Math.min(maxLevel(i.type), i.level + i.pending); i.pending = 0; opened.push(i.type + (i.isNew ? ' opens' : ' reaches level ' + i.level)); } i.isNew = false; i.closed = false; });
    var r = d(10), total = r + v.prosperity, ev = lookup(REF.VILLAGE_EVENTS, total)[2], who = [];
    if (/merchant/i.test(ev)) { var m = randomInst('merchant'); if (m) who.push('merchant: ' + m); }
    if (/artisan/i.test(ev)) { var a = randomInst('artisan'); if (a) who.push('artisan: ' + a); }
    if (/institution/i.test(ev) && !/institution the crows/.test(ev)) { var ii = randomInst(''); if (ii) who.push('institution: ' + ii); }
    if (/crow's quarters/.test(ev) && activePCs().length) who.push('crow: ' + (pick(activePCs()).name || 'a crow'));
    v.saleMod = 0;
    if (/Sale percentage -5%/.test(ev)) v.saleMod = -5;
    if (/Sale percentage \+5%/.test(ev)) v.saleMod = 5;
    v.event = 'Cycle ' + (v.cycle + 1) + ' event (d10 ' + r + ' + Prosperity ' + v.prosperity + ' = ' + total + '): ' + ev + (who.length ? ' (' + who.join('; ') + ')' : '');
    log('dt', '**End of village cycle ' + v.cycle + '.** Prosperity ' + before + ' → ' + v.prosperity + ' (' + notes.join(', ') + ').' + (opened.length ? ' ' + opened.join('; ') + '.' : '') + ' Merchants restock. ' + v.event);
    v.cycle += 1; v.day = 1; v.upgrades = 0; v.spent10k = false;
    save(); render();
  }

  // ------------------------------------------------------------------ Village tab
  function renderVillage() {
    var v = state.village, p = v.prosperity;
    var perks = [
      ['Sale percentage', salePct() + '% of base cost' + (v.saleMod ? ' (event ' + signed(v.saleMod) + '%)' : '')],
      ['Money Bags loan', 'up to ' + fmt(Math.max(100, 100 * p)) + ' gc'],
      ['Foodie', plural(Math.max(1, Math.floor(p / 2)), 'ration') + ' per cycle'],
      ['Magic Enthusiast', plural(Math.max(1, p), 'item') + ' identified per day'],
      ['Caretaker / Animal Lover', (p >= 6 ? 3 : 2) + ' extra wounds healed'],
      ['Inn max bet', 'L1 ' + (15 + p) + ' gc … L5 ' + (60 + p) + ' gc']
    ];
    card('sec-village', el('h2', null, ['Village', el('small', { text: 'cycle ' + v.cycle + ', day ' + v.day + ' of 10' })]), [
      el('div', { class: 'grid3' }, [
        field('Village name', inp(v, 'name', { placeholder: 'Named by the group' }, { on: function () { $('camp-name').textContent = state.name || v.name; } })),
        field('Prosperity (-10 to 10)', inp(v, 'prosperity', { type: 'number', min: -10, max: 10 }, { re: true })),
        field('Campaign name', inp(state, 'name', { placeholder: 'optional' }, { on: function () { $('camp-name').textContent = state.name || v.name; } }))
      ]),
      el('div', { class: 'stat-row', style: 'margin-top:.7rem' }, [
        el('div', { class: 'stat big hot' }, [el('div', { class: 'lbl', text: 'Prosperity' }), el('div', { class: 'val', text: signed(p) })]),
        el('div', { class: 'stat big' }, [el('div', { class: 'lbl', text: 'Cycle' }), el('div', { class: 'val', text: String(v.cycle) })]),
        el('div', { class: 'stat big' }, [el('div', { class: 'lbl', text: 'Day' }), el('div', { class: 'val', text: v.day + '/10' })]),
        el('div', { class: 'stat big' }, [el('div', { class: 'lbl', text: 'Sale %' }), el('div', { class: 'val', text: salePct() + '%' })])
      ]),
      el('div', { class: 'row', style: 'margin-top:.7rem' }, [
        btn('Next day', function () { if (v.day >= 10) { if (confirm('Day 10 is the last day of the cycle. End the cycle now?')) endCycle(); return; } v.day += 1; log('', 'Village day ' + v.day + ' of cycle ' + v.cycle + '.'); save(); render(); }),
        btn('End cycle', function () { if (confirm('End cycle ' + v.cycle + '? This adjusts Prosperity, opens pending institutions, and rolls the next village event.')) endCycle(); }, 'btn-primary'),
        el('span', { class: 'fine', text: 'This cycle: ' + plural(v.upgrades, 'institution') + ' founded/upgraded.' }),
        chk(v, 'spent10k', '10,000+ gc spent at merchants this cycle')
      ]),
      v.event ? el('div', { class: 'banner ok' }, [el('b', { text: 'Village event: ' }), v.event]) : null,
      el('dl', { class: 'kv' }, perks.reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, [])),
      field('Village notes', area(v, 'note', { rows: 2, placeholder: 'The ruin it lives in, gossip, grudges, festivals…' })),
      more('Village rules', [
        el('p', { text: 'Cycle = 10 days: events, founding and upgrades take effect, merchants restock. Prosperity +1 per institution founded or upgraded, +1 if 10,000+ gc was spent at merchant institutions in a cycle (max 10); a cycle with nothing raising it: -1 (min -10). Home: free secure housing and food.' }),
        el('p', { text: 'Trade: buy at listed price if a merchant supplies it at its level; sell to an appropriate merchant for the sale percentage. Artisan crafting: give materials + the item\'s full price; the artisan makes 1 crafting roll a day with bonus = level (pay double for 2 rolls a day).' }),
        el('p', { text: 'Other villages: the Ref sets their Prosperity and institutions; no investing. Founding a new village in a ruin: 15,000 gc and 10 days; it becomes home.' }),
        rowsTable(REF.SALE_PCT, 'Prosperity', p, function (r) { return r[2] + '%'; }),
        el('h3', { text: 'Village events (d10 + Prosperity)' }),
        rowsTable(REF.VILLAGE_EVENTS, 'd10+P', null)
      ])
    ]);

    var have = {}; v.inst.forEach(function (i) { have[i.type] = true; });
    var missing = Object.keys(REF.INSTITUTIONS).filter(function (k) { return !have[k]; });
    var addState = { t: missing[0] || '' };
    card('sec-institutions', el('h2', null, ['Institutions', el('small', { text: v.inst.length + ' in ' + (v.name || 'the village') })]), [
      el('p', { class: 'hint', text: 'Every village starts with a blacksmith, crypt, general store, inn, and temple, plus 1 institution the group picks, all at level 1. Level-ups and new institutions take effect next cycle; each one raises Prosperity by 1.' }),
      el('div', null, v.inst.map(instRow)),
      missing.length ? el('div', { class: 'row', style: 'margin-top:.7rem' }, [
        field('Institution', sel(addState, 't', missing.map(function (k) { return [k, k + ' (founding ' + fmt(REF.INSTITUTIONS[k].found) + ' gc)']; }), { re: false }), 'grow'),
        btn('Found (opens next cycle)', function () { v.inst.push({ id: nid(), type: addState.t, level: 0, pending: 1, isNew: true, steward: '', notes: '', closed: false }); v.upgrades++; log('', 'Founded a ' + addState.t + ' (' + fmt(REF.INSTITUTIONS[addState.t].found) + ' gc); it opens next cycle.'); save(); render(); }, 'btn-primary'),
        btn('Add as existing', function () { v.inst.push({ id: nid(), type: addState.t, level: 1, pending: 0, isNew: false, steward: '', notes: '', closed: false }); save(); render(); }, 'btn-ghost')
      ]) : null,
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [btn('Load the sample village Gadwick', function () {
        if (!confirm('Replace the village with Gadwick from the Dungeons book?')) return;
        var g = REF.GADWICK; v.name = g.name; v.prosperity = g.prosperity; v.note = g.note;
        v.inst = g.inst.map(function (x) { return { id: nid(), type: x[0], level: x[1], pending: 0, isNew: false, steward: x[2], notes: '', closed: false }; });
        v.boons = g.boons.map(function (b) { return { id: nid(), boon: b[0], crow: '', holder: '', level: b[1] }; });
        save(); render();
      }, 'btn-ghost')])
    ]);

    var crypt = v.inst.filter(function (i) { return i.type === 'Crypt'; })[0];
    var cl = crypt ? crypt.level : 1;
    card('sec-crypt', el('h2', null, ['Crypt Boons', el('small', { text: crypt ? 'crypt level ' + cl : 'no crypt' })]), [
      el('p', { class: 'hint', text: REF.INSTITUTIONS.Crypt.txt }),
      el('div', { class: 'list' }, v.boons.map(function (b) {
        var def = REF.CRYPT_BOONS.filter(function (x) { return x[0] === b.boon; })[0];
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [sel(b, 'boon', REF.CRYPT_BOONS.map(function (x) { return x[0]; }), { class: 'in' }), inp(b, 'crow', { placeholder: 'Interred crow' }), inp(b, 'holder', { placeholder: 'Current holder' })]),
          def ? el('div', { class: 'fine', text: def[1].replace(/level/g, 'level (' + (cl >= 5 && state.village.prosperity >= 10 ? 6 : cl) + ')') }) : null
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove boon', onclick: function () { v.boons = v.boons.filter(function (x) { return x !== b; }); save(); render(); } })]);
      })),
      btn('Add boon', function () { v.boons.push({ id: nid(), boon: 'Rescue', crow: '', holder: '' }); save(); render(); })
    ]);
  }
  function instRow(i) {
    var v = state.village, def = instDef(i.type), max = maxLevel(i.type), next = i.level + i.pending;
    var cost = next < max ? def.up[next - 1] : null;
    return el('div', { class: 'inst' }, [
      el('div', { class: 'inst-top' }, [
        el('span', { class: 'inst-name', text: i.type }),
        el('span', { class: 'lvl', title: 'Level ' + i.level + (i.pending ? ' (+' + i.pending + ' next cycle)' : '') }, Array.apply(null, Array(max)).map(function (_, k) {
          return el('span', { class: k < i.level ? 'on' : k < i.level + i.pending ? 'pend' : '' });
        })),
        el('span', { class: 'fine', text: i.isNew ? 'opens next cycle' : 'level ' + i.level + (i.pending ? ' → ' + next + ' next cycle' : '') }),
        def.roles ? el('span', { class: 'chip', text: def.roles }) : null,
        i.closed ? el('span', { class: 'chip warn', text: 'closed' }) : null,
        el('span', { class: 'spacer' }),
        cost ? btn('Upgrade (' + fmt(cost) + ' gc)', function () { i.pending += 1; v.upgrades++; log('', i.type + ' upgraded to level ' + (i.level + i.pending) + ' (' + fmt(cost) + ' gc); takes effect next cycle.'); save(); render(); }, 'btn-small') : el('span', { class: 'fine', text: 'max level' }),
        el('button', { type: 'button', class: 'x', text: '×', title: 'Remove (destroyed)', 'aria-label': 'Remove ' + i.type, onclick: function () { if (confirm('Remove the ' + i.type + '?')) { v.inst = v.inst.filter(function (x) { return x !== i; }); log('', 'The ' + i.type + ' is gone.'); save(); render(); } } })
      ]),
      el('div', { class: 'li-row', style: 'margin-top:.35rem' }, [inp(i, 'steward', { placeholder: 'Steward' }), inp(i, 'notes', { placeholder: 'Notes (stock, credit, grudges…)' }),
        el('label', { class: 'check' }, ['Level ', el('input', { type: 'number', class: 'tiny', min: 0, max: max, value: i.level, onchange: function () { i.level = clamp(int(this.value, 1), 0, max); save(); render(); } })]),
        chk(i, 'closed', 'Closed')]),
      more('What it offers', [el('p', { text: def.txt }), el('p', { class: 'fine', text: 'Founding ' + fmt(def.found) + ' gc. Level-up prices: ' + def.up.map(function (c, k) { return 'L' + (k + 2) + ' ' + fmt(c); }).join(', ') + ' gc.' })])
    ]);
  }

  A.add({ instDef: instDef, maxLevel: maxLevel, randomInst: randomInst, endCycle: endCycle, renderVillage: renderVillage, instRow: instRow });
})();
