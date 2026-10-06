/*
 * Ref Screen: encounter checks and monster tables, saved encounters (run, end, outcomes), and the Encounters tab. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), addCombatant = f('addCombatant'), addParty = f('addParty'), area = f('area'), beast = f('beast'),
      beastCard = f('beastCard'), btn = f('btn'), card = f('card'), chk = f('chk'), clamp = f('clamp'), clearCombat = f('clearCombat'),
      combatUI = f('combatUI'), currentPlace = f('currentPlace'), dungeonEN = f('dungeonEN'), field = f('field'), greedBonus = f('greedBonus'),
      groundText = f('groundText'), inp = f('inp'), int = f('int'), log = f('log'), lookup = f('lookup'), more = f('more'), nid = f('nid'),
      nowStamp = f('nowStamp'), render = f('render'), renderCombat = f('renderCombat'), rollMerchant = f('rollMerchant'), rollMiasmaTouched = f('rollMiasmaTouched'),
      rollTravelEncounter = f('rollTravelEncounter'), rollTravelers = f('rollTravelers'), rollWildAnimal = f('rollWildAnimal'), S = f('S'),
      save = f('save'), sel = f('sel'), setTab = f('setTab'), test = f('test'), testLine = f('testLine'), today = f('today'),
      travelResultBox = f('travelResultBox');
  var $ = A.$, clone = A.clone, d = A.d, el = A.el, plural = A.plural, rollDice = A.rollDice, signed = A.signed, SIZES = A.SIZES, toast = A.toast,
      ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ encounters
  function rollAdds(adds) {
    return (adds || []).map(function (a) { var r = rollDice(a[1]); return [a[0], r.total, typeof a[1] === 'string' ? a[1] : null]; });
  }
  function addsText(adds) { return adds.map(function (a) { return a[1] + ' × ' + a[0] + (a[2] ? ' (' + a[2] + ')' : ''); }).join(', '); }
  function rollDungeonTable(name) {
    var t = REF.DUNGEON_TABLES[name]; if (!t) return null;
    var n = d(t.die), row = lookup(t.rows, n), adds = rollAdds(row[3]);
    return { roll: n, die: t.die, text: row[2], adds: adds };
  }
  function encounterCheck(reason, en, table) {
    var r = d(10), hit = r >= en, res = { reason: reason, roll: r, en: en, hit: hit, immediate: hit && r === 10, table: table, t: nowStamp() };
    if (hit && table && REF.DUNGEON_TABLES[table]) res.enc = rollDungeonTable(table);
    else if (hit && table === 'Travel') res.travel = rollTravelEncounter();
    var line = reason + ': encounter check 1d10 = ' + r + ' vs EN ' + en + ' → ';
    if (!hit) line += 'no encounter.';
    else {
      line += '**ENCOUNTER' + (res.immediate ? ' — right now!' : ' — give a sign; it happens during the next DT.') + '**';
      if (res.enc) line += ' ' + table + ' d' + res.enc.die + ' = ' + res.enc.roll + ': ' + res.enc.text + ' → ' + addsText(res.enc.adds) + '.';
      if (res.travel) line += ' ' + res.travel.summary;
      if (!res.enc && !res.travel) line += ' (Roll on the monster table of the dungeon type.)';
      res.encId = saveCheckEncounter(res).id;
      line += ' Saved to Encounters.';
    }
    log(hit ? 'enc' : '', line);
    return res;
  }
  function encounterResultBox(res, onResolve) {
    if (!res) return null;
    var kids = [el('div', { class: 'r-head' }, [res.reason + ': ', res.hit ? el('b', { text: res.immediate ? 'Encounter — right now!' : 'Encounter — sign now, it arrives during the next DT' }) : 'no encounter']),
      el('div', { class: 'r-roll', text: '1d10 = ' + res.roll + ' vs EN ' + res.en + ' · ' + res.t })];
    if (res.enc) {
      kids.push(el('div', null, [res.table + ' (d' + res.enc.die + ' = ' + res.enc.roll + '): ', el('b', { text: addsText(res.enc.adds) })]));
      kids.push(addToCombatBtn(res.enc.adds));
    }
    if (res.travel) kids.push(travelResultBox(res.travel));
    if (res.hit && !res.enc && !res.travel) kids.push(el('div', { class: 'muted', text: 'No table picked: choose creatures from the Bestiary.' }));
    if (res.encId && findEncounter(res.encId)) kids.push(el('div', { class: 'row center' }, [runEncBtn(findEncounter(res.encId)), encLink(res.encId, 'Open in Encounters')]));
    else if (res.enc || res.travel) kids.push(btn('Save to Encounters', function () {
      var e = newEncounter({ name: encName(res.reason, res), src: res.table || 'Travel', roll: res.reason, text: res.enc ? res.table + ' (d' + res.enc.die + ' = ' + res.enc.roll + '): ' + res.enc.text : res.travel.summary.replace(/\*\*/g, ''),
        adds: res.enc ? res.enc.adds : res.travel.adds });
      res.encId = e.id; save(); render(); toast('Saved to Encounters.');
    }, 'btn-small'));
    if (onResolve) kids.push(btn('Dismiss', onResolve, 'btn-small btn-ghost'));
    return el('div', { class: 'result' }, kids);
  }
  function addToCombatBtn(adds) {
    if (!adds || !adds.length) return null;
    return btn('Add to combat', function () {
      adds.forEach(function (a) { addCombatant(a[0], a[1], 'foe'); });
      log('', 'Added to combat: ' + addsText(adds) + '.');
      toast('Added to the combat tracker.');
      setTab('encounters');
    }, 'btn-small btn-primary');
  }

  // ------------------------------------------------------------------ saved encounters (Encounters tab)
  /*
   * A saved encounter: creatures [{ n: bestiary name, k: count, side: 'foe' | 'ally' }] plus text the Ref can edit.
   * Every encounter check that hits saves one, and the Dungeon Turn notice links to it.
   */
  function newEncounter(o) {
    var place = currentPlace();
    var e = { id: nid(), name: o.name || 'New encounter', src: o.src || 'Manual', made: today() + ' ' + nowStamp(), session: S().n, dt: S().dt,
      where: o.where != null ? o.where : place ? place.name : '', roll: o.roll || '', text: o.text || '',
      creatures: (o.adds || []).map(function (a) { return { n: a[0], k: a[1], side: 'foe' }; }), notes: '', done: false };
    state.encounters.unshift(e);
    return e;
  }
  function findEncounter(id) { for (var i = 0; i < state.encounters.length; i++) if (state.encounters[i].id === id) return state.encounters[i]; return null; }
  function encName(reason, res) { return reason + ': ' + (res.enc ? addsText(res.enc.adds) : res.travel ? res.travel.kind : 'Ref\'s choice'); }
  function encSummary(e) { return e.creatures.map(function (c) { return c.k + ' × ' + c.n + (c.side === 'ally' ? ' (ally)' : ''); }).join(', '); }
  function saveCheckEncounter(res) {
    return newEncounter({ name: encName(res.reason, res), src: res.table || 'Ref\'s choice', where: res.table === 'Travel' ? 'Travel day ' + state.travel.day : undefined,
      roll: res.reason + ': 1d10 = ' + res.roll + ' vs EN ' + res.en + (res.immediate ? ' (right now)' : ' (sign now, arrives during the next DT)'),
      text: res.enc ? res.table + ' (d' + res.enc.die + ' = ' + res.enc.roll + '): ' + res.enc.text : res.travel ? res.travel.summary.replace(/\*\*/g, '') : 'No table picked: choose creatures from the Bestiary.',
      adds: res.enc ? res.enc.adds : res.travel ? res.travel.adds : [] });
  }
  function pendingFrom(res) {
    if (!res.hit || res.immediate) return null;
    return { dt: S().dt, text: res.enc ? addsText(res.enc.adds) : res.travel ? res.travel.kind : 'Ref\'s choice', adds: res.enc ? res.enc.adds : res.travel ? res.travel.adds : [], encId: res.encId || null };
  }
  function pendingEnc() { var p = S().pending; return p && p.encId ? findEncounter(p.encId) : null; }
  /* The pending encounter's description, as a link to it in the Encounters tab when it's saved there. */
  function pendingText(p) { var e = p.encId && findEncounter(p.encId); return e ? encLink(e.id, encSummary(e) || e.name) : p.text; }
  function encLink(id, text) {
    return el('a', { href: '#enc-' + id, class: 'enc-link', title: 'Open in the Encounters tab', onclick: function (ev) { ev.preventDefault(); openEncounter(id); } }, [text]);
  }
  function openEncounter(id, editName) {
    var e = findEncounter(id);
    if (!e) { toast('That encounter was deleted.'); return; }
    ui.encOpen[id] = true; ui.encFocus = id;
    if (ui.encFilter !== 'all' && (ui.encFilter === 'done') !== !!e.done) ui.encFilter = 'all';
    setTab('encounters');
    var n = $('enc-' + id);
    if (n) { n.scrollIntoView({ block: 'start' }); if (editName) { var i = n.querySelector('input'); if (i) i.select(); } }
    clearTimeout(openEncounter._t); openEncounter._t = setTimeout(function () { ui.encFocus = null; }, 2000);
  }
  function encCombatBtn(e, cls) {
    return btn('Add to combat', function () {
      if (!e.creatures.length) { toast('This encounter has no creatures yet.'); return; }
      e.creatures.forEach(function (c) { addCombatant(c.n, clamp(int(c.k, 1), 1, 30), c.side); });
      log('', 'Encounter **' + (e.name || 'untitled') + '** joins combat: ' + encSummary(e) + '.');
      toast('Added to the combat tracker.');
      setTab('encounters');
    }, cls || 'btn-small btn-primary', 'Only add its creatures to the combat tracker (on this tab, and on the Tabletop)');
  }

  /*
   * Running an encounter: its creatures (and the active crows) go into the combat tracker, tagged with the
   * encounter's id, and the Encounters tab shows the fight. Ending it writes the result into the encounter's notes.
   */
  var ENC_OUTCOMES = [['won', 'The crows won'], ['foesFled', 'The foes fled or surrendered'], ['fled', 'The crows fled'], ['avoided', 'Talked, traded, or sneaked past'], ['other', 'Something else']];
  function runningEnc() { var id = S().combat.encId; return id ? findEncounter(id) : null; }
  /* stay: start it without leaving the tab (the Tabletop loads encounters onto the map). Returns whether it is running. */
  function runEncounter(e, stay) {
    var s = S(), c = s.combat, cur = runningEnc();
    if (cur === e) { if (!stay) setTab('encounters'); return true; }
    if (cur && !confirm((cur.name || 'Another encounter') + ' is still running. Switch to ' + (e.name || 'this one') + '? Creatures already in the tracker stay there.')) return false;
    var others = c.list.filter(function (x) { return x.kind !== 'pc' && x.enc !== e.id; });
    if (others.length && confirm('The combat tracker still has ' + plural(others.length, 'creature') + ' in it. Remove them before this encounter starts?\n\nCancel keeps them in the fight.')) {
      c.list = c.list.filter(function (x) { return others.indexOf(x) < 0; });
      others = [];
    }
    if (!others.length) { c.round = 0; c.first = null; c.feed = []; c.acts = []; }
    c.encId = e.id; c.surprise = 'none'; ui.encEnd = null;
    if (!c.list.some(function (x) { return x.enc === e.id; })) e.creatures.forEach(function (cr) { addCombatant(cr.n, clamp(int(cr.k, 1), 1, 30), cr.side, e.id); });
    addParty();
    if (s.pending && s.pending.encId === e.id) s.pending = null;
    log('enc', '**Encounter begins: ' + (e.name || 'untitled') + '**' + (e.where ? ' at ' + e.where : '') + (e.creatures.length ? ' (' + encSummary(e) + ')' : '') + '.');
    save(); if (stay) render(); else setTab('encounters');
    return true;
  }
  function runEncBtn(e, cls) {
    return runningEnc() === e ? btn('Go to the fight', function () { setTab('encounters'); }, 'btn-small ' + (cls || ''))
      : btn('Run encounter', function () { runEncounter(e); }, 'btn-small ' + (cls || 'btn-primary'), 'Put its creatures and the party in the combat tracker and run it here');
  }
  /* Stop running without a result: its creatures leave the tracker; the encounter stays open. */
  function cancelRun(e) {
    var c = S().combat;
    if (!confirm('Stop running ' + (e.name || 'this encounter') + '? Its creatures leave the combat tracker, and the encounter stays open.')) return;
    c.list = c.list.filter(function (x) { return x.enc !== e.id; });
    if (!c.list.some(function (x) { return x.kind !== 'pc'; })) clearCombat(c);
    c.encId = null; c.surprise = 'none'; ui.encEnd = null;
    log('', 'Stopped running ' + (e.name || 'the encounter') + ' (no result).');
    save(); render();
  }
  function tally(list) {
    var n = {}; list.forEach(function (x) { var k = x.cref || x.name; n[k] = (n[k] || 0) + 1; });
    return Object.keys(n).map(function (k) { return n[k] + ' × ' + k; }).join(', ');
  }
  /* stay: end it without leaving the tab (the Tabletop ends fights on the map). */
  function endEncounter(e, outcome, resolve, stay) {
    var s = S(), c = s.combat, label = ENC_OUTCOMES.filter(function (o) { return o[0] === outcome; })[0][1];
    var them = c.list.filter(function (x) { return x.kind !== 'pc'; }), fallen = them.filter(function (x) { return x.dead; }),
      standing = them.filter(function (x) { return !x.dead && x.kind === 'foe'; }), allies = them.filter(function (x) { return !x.dead && x.kind === 'ally'; });
    var crows = c.list.filter(function (x) { return x.kind === 'pc'; }).map(function (x) { return x.name + ' ' + x.st + '/' + x.stMax + (x.wounds ? ', ' + plural(x.wounds, 'wound') : ''); });
    var corpses = {};
    fallen.forEach(function (x) { var b = beast(x.cref), sz = b && SIZES[b.sz]; if (sz) corpses[sz] = (corpses[sz] || 0) + 1; });
    var harvest = Object.keys(corpses).map(function (sz) { return corpses[sz] + ' ' + sz + ' (' + REF.HARVEST[sz] + ' parts each)'; });
    var lines = ['Session ' + s.n + ', DT ' + s.dt + ': ' + label + (c.round ? ' after ' + plural(c.round, 'round') : '') + '.'];
    if (fallen.length) lines.push('Fallen: ' + tally(fallen) + '.');
    if (standing.length) lines.push('Foes still standing: ' + tally(standing) + '.');
    if (allies.length) lines.push('Allies: ' + tally(allies) + '.');
    if (crows.length) lines.push('Crows: ' + crows.join('; ') + '.');
    if (harvest.length) lines.push('Corpses to harvest: ' + harvest.join(', ') + '.');
    if (groundText()) lines.push(groundText());
    e.notes = (e.notes ? e.notes.replace(/\s+$/, '') + '\n\n' : '') + lines.join('\n');
    e.outcome = label;
    if (resolve) { e.done = true; if (s.pending && s.pending.encId === e.id) s.pending = null; }
    log('enc', '**Encounter ends: ' + (e.name || 'untitled') + '.** ' + lines.join(' '));
    clearCombat(c); ui.encEnd = null;
    save(); if (stay) render(); else openEncounter(e.id); toast('The result is in the encounter\'s notes.');
  }
  /* A monster's "suspicious like or hate" check (Bestiary rules): 2d10 + the highest Mind among the monsters. */
  function likeHateCheck(foes) {
    var m = Math.max.apply(null, foes.map(function (x) { return beast(x.cref).c[1]; }));
    var r = test(m, 0), what = ['approach unsuspecting', 'investigate the oddities first', 'withdraw nearby and prepare an ambush or gather allies'][r.tier - 1];
    ui.dice = { label: 'Like/hate check (M ' + signed(m) + ')', r: r, dmg: 'They ' + what + '.' };
    log('', 'Like/hate check 2d10 ' + signed(m) + ': ' + testLine(r) + ' → T' + r.tier + ': they ' + what + '.');
    render();
  }

  function beastSelect(value, onchange) {
    var groups = {};
    REF.BESTIARY.forEach(function (b) { (groups[b.t] = groups[b.t] || []).push(b.n); });
    var n = el('select', { class: 'in', 'aria-label': 'Creature', onchange: function () { onchange(this.value); } },
      Object.keys(groups).map(function (g) { return el('optgroup', { label: g }, groups[g].map(function (b) { return el('option', { value: b, text: b }); })); }));
    if (value && !beast(value)) n.insertBefore(el('option', { value: value, text: value }), n.firstChild);
    n.value = value;
    return n;
  }

  // ------------------------------------------------------------------ Encounters tab
  var ENC_SOURCES = [['Blood Creatures', 'Blood creatures (d6)'], ['Undead', 'Undead (d10)'], ['Any', 'Any monster type (d10)'], ['Travel', 'Travel encounter (d100)'],
    ['Animal', 'Wild animal (habitat + reaction)'], ['Travelers', 'Travelers'], ['Miasma-touched', 'Miasma-touched humans'], ['Merchant', 'Merchant caravan']];
  function rollEncounterDraft(src) {
    var t = state.travel, r;
    if (REF.DUNGEON_TABLES[src]) { r = rollDungeonTable(src); return { name: src + ': ' + addsText(r.adds), roll: src + ' d' + r.die + ' = ' + r.roll, lines: [r.text], adds: r.adds }; }
    if (src === 'Any') {
      var m = d(10), row = lookup(REF.ANY_MONSTER, m), e = row[3] ? rollDungeonTable(row[3]) : null;
      return { name: e ? row[2] + ': ' + addsText(e.adds) : row[2].replace(/ \(.*$/, ''), roll: 'Any monster d10 = ' + m + (e ? ', ' + row[3] + ' d' + e.die + ' = ' + e.roll : ''),
        lines: [row[2] + (e ? ': ' + e.text : '')], adds: e ? e.adds : [] };
    }
    if (src === 'Travel') { r = rollTravelEncounter(); return { name: 'Travel: ' + r.kind, roll: 'Travel d100 = ' + r.roll + ' (' + t.habitat + ', ' + t.climate + ')', lines: r.lines, adds: r.adds }; }
    if (src === 'Animal') { r = rollWildAnimal(t.habitat); return { name: 'Wild animal: ' + addsText(r.adds), roll: t.habitat, lines: r.lines, adds: r.adds }; }
    r = src === 'Travelers' ? rollTravelers() : src === 'Merchant' ? rollMerchant() : rollMiasmaTouched();
    return { name: src === 'Travelers' ? 'Travelers' : src === 'Merchant' ? 'Merchant caravan' : 'Miasma-touched humans', roll: src, lines: r.lines, adds: r.adds };
  }
  function renderEncounters() {
    renderEncRun();
    renderCombat();
    if (!ui.encSrc) ui.encSrc = REF.DUNGEON_TABLES[S().table] ? S().table : 'Travel';
    var dr = ui.encDraft;
    function srcLabel() { return ENC_SOURCES.filter(function (o) { return o[0] === ui.encSrc; })[0][1]; }
    function roll() { var r = rollEncounterDraft(ui.encSrc); r.src = srcLabel(); ui.encDraft = r; log('', 'Rolled an encounter (' + r.src + '): ' + r.name + '. ' + r.lines.join(' ')); render(); }
    card('sec-enc-new', el('h2', null, ['New Encounter', el('small', { text: 'roll one or build your own' })]), [
      el('p', { class: 'hint', text: 'Roll on a table, look it over, and save the ones you want to keep and edit. Travel, wild animal, and nearest-dungeon rolls use the Travel tab\'s climate, habitat, and nearest dungeon. Encounter checks that hit (End DT, loud noise, rests, travel) are saved here on their own.' }),
      el('div', { class: 'row' }, [field('Table', sel(ui, 'encSrc', ENC_SOURCES, { label: 'Encounter table' }), 'grow'),
        btn('Roll encounter', roll, 'btn-primary'),
        btn('Create encounter manually', function () { var e = newEncounter({ src: 'Manual', where: '' }); save(); openEncounter(e.id, true); }, 'btn-ghost')]),
      dr ? el('div', { class: 'result' }, [
        el('div', { class: 'r-head', text: dr.name }), el('div', { class: 'r-roll', text: dr.roll }),
        el('ul', null, dr.lines.map(function (l) { return el('li', { text: l }); })),
        dr.adds.length ? el('div', null, ['Creatures: ', el('b', { text: addsText(dr.adds) })]) : el('div', { class: 'muted', text: 'No creatures from this roll; add them after saving if you need any.' }),
        el('div', { class: 'row' }, [
          btn('Save encounter', function () {
            var e = newEncounter({ name: dr.name, src: dr.src, roll: dr.roll, text: dr.lines.join('\n'), adds: dr.adds });
            ui.encDraft = null; log('', 'Saved encounter: ' + e.name + '.'); save(); openEncounter(e.id);
          }, 'btn-small btn-primary'),
          btn('Reroll', roll, 'btn-small'),
          btn('Discard', function () { ui.encDraft = null; render(); }, 'btn-small btn-ghost')])
      ]) : null
    ]);

    var open = state.encounters.filter(function (e) { return !e.done; }).length, resolved = state.encounters.length - open;
    var list = state.encounters.filter(function (e) { return ui.encFilter === 'all' || (ui.encFilter === 'done') === !!e.done; });
    card('sec-enc-list', el('h2', null, ['Saved Encounters', el('small', { text: open + ' open · ' + resolved + ' resolved' })]), [
      el('div', { class: 'row center' }, [
        el('div', { class: 'seg' }, [['open', 'Open'], ['all', 'All'], ['done', 'Resolved']].map(function (o) {
          return el('button', { type: 'button', class: ui.encFilter === o[0] ? 'on' : '', 'aria-pressed': ui.encFilter === o[0] ? 'true' : 'false', text: o[1], onclick: function () { ui.encFilter = o[0]; render(); } });
        })),
        el('span', { class: 'spacer' }),
        resolved ? btn('Delete resolved', function () {
          if (!confirm('Delete ' + plural(resolved, 'resolved encounter') + '?')) return;
          state.encounters = state.encounters.filter(function (e) { return !e.done; }); save(); render();
        }, 'btn-small btn-ghost btn-danger') : null]),
      list.length ? el('div', { class: 'enc-list' }, list.map(encCard))
        : el('p', { class: 'hint', text: state.encounters.length ? 'No ' + (ui.encFilter === 'done' ? 'resolved' : 'open') + ' encounters.' : 'No saved encounters yet. Roll or create one above, or make an encounter check in the Session tab.' })
    ]);
  }
  /* The running encounter: what's going on, surprise, morale cues, the combat tracker, creature notes, and the wrap-up. */
  function renderEncRun() {
    var e = runningEnc(), box = $('sec-enc-run');
    box.hidden = !e;
    if (!e) { box.innerHTML = ''; return; }
    var c = S().combat, them = c.list.filter(function (x) { return x.kind === 'foe'; }), up = them.filter(function (x) { return !x.dead && x.st > 0; });
    var cues = [], kinds = {};
    them.forEach(function (x) { var b = beast(x.cref); if (b) kinds[b.t] = true; });
    var humans = them.filter(function (x) { var b = beast(x.cref); return b && b.t === 'Human'; }), humansDown = humans.filter(function (x) { return x.dead || x.st <= 0; }).length;
    if (them.length && !up.length) cues.push(['ok', 'Every foe is down. End the encounter below.']);
    else {
      if (humans.length > 1 && humansDown * 2 >= humans.length && humansDown < humans.length) cues.push(['warn', 'Half the human foes are down: the group flees (Ref\'s call).']);
      if (humans.length === 1 && humansDown === 1) cues.push(['warn', 'The lone human is at 0 Stamina: they flee.']);
      them.forEach(function (x) { var b = beast(x.cref); if (b && b.t === 'Animal' && !x.dead && x.st <= 0) cues.push(['warn', x.name + ' is at 0 Stamina: animals flee.']); });
      if (them.length > 2 && up.length * 2 <= them.length && (kinds['Blood Creature'] || kinds.Undead)) cues.push(['', 'Half the monsters are down: monsters flee losing fights (weak ones stay with the pack).']);
    }
    var monsters = them.filter(function (x) { var b = beast(x.cref); return b && /Blood Creature|Undead|Unique/.test(b.t); });
    var types = Object.keys(kinds), beasts = [];
    them.concat(c.list.filter(function (x) { return x.kind === 'ally'; })).forEach(function (x) { var b = beast(x.cref); if (b && beasts.indexOf(b) < 0) beasts.push(b); });
    var end = ui.encEnd || (ui.encEnd = { outcome: 'won', resolve: true });

    card('sec-enc-run', el('h2', null, ['Running: ' + (e.name || 'untitled'), el('small', { text: c.round ? 'round ' + c.round : 'not started' })]), [
      el('div', { class: 'fine', text: [e.where, e.src, e.roll].filter(Boolean).join(' · ') }),
      e.text ? el('div', { class: 'run-text', text: e.text }) : null,
      c.round ? null : el('div', { class: 'row center run-setup' }, [
        el('span', { class: 'fine', text: 'Surprise:' }),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Surprise' }, [['none', 'No one'], ['crows', 'Crows surprised'], ['foes', 'Foes surprised']].map(function (o) {
          return el('button', { type: 'button', class: c.surprise === o[0] ? 'on' : '', 'aria-pressed': c.surprise === o[0] ? 'true' : 'false', text: o[1], onclick: function () { c.surprise = o[0]; save(); render(); } });
        })),
        monsters.length ? btn('Like/hate check (2d10+M)', function () { likeHateCheck(monsters); }, 'btn-small btn-ghost', 'When a like or hate is in an odd or dangerous place: T1 they approach unsuspecting, T2 they investigate it first, T3 they withdraw and set an ambush or gather allies') : null,
        el('span', { class: 'fine', text: 'A surprised side takes no turn in round 1, and attacks against it get +1.' })]),
      cues.length ? el('div', { class: 'run-cues' }, cues.map(function (q) { return el('div', { class: 'cue ' + q[0], text: q[1] }); })) : null,
      el('div', { class: 'row center', style: 'margin:.4rem 0' }, [
        el('span', { class: 'fine', text: them.length ? up.length + ' of ' + plural(them.length, 'foe') + ' standing' : 'No foes in the tracker.' }),
        el('span', { class: 'spacer' }),
        btn('Encounter check (loud noise, EN ' + dungeonEN() + ')', function () {
          var s = S(), res = encounterCheck('Loud noise during ' + (e.name || 'the encounter'), dungeonEN(), s.table === 'none' ? null : s.table);
          ui.lastEnc = res; if (res.hit && !res.immediate) s.pending = pendingFrom(res);
          if (res.hit) toast(res.immediate ? 'More creatures arrive now: see the Session tab.' : 'Something else is coming: see the Session tab.');
          save(); render();
        }, 'btn-small btn-ghost', 'Encounters can happen even mid-combat')])
    ].concat(combatUI(true), [
      beasts.length ? more('Creature notes (likes, hates, how they fight)', types.map(function (t) { return REF.TYPE_NOTES[t] ? el('p', null, [el('b', { text: t + 's: ' }), REF.TYPE_NOTES[t]]) : null; })
        .concat([el('div', { class: 'beast-list' }, beasts.map(beastCard))])) : null,
      field('Ref notes', area(e, 'notes', { rows: 2, placeholder: 'Tactics, loot, how it went…' })),
      el('div', { class: 'run-end' }, [
        el('h4', { text: 'End the encounter' }),
        el('div', { class: 'row center' }, [
          field('How it ended', sel(end, 'outcome', ENC_OUTCOMES, { re: false })),
          chk(end, 'resolve', 'Mark it resolved', { re: false }),
          el('span', { class: 'spacer' }),
          btn('End encounter', function () { endEncounter(e, end.outcome, end.resolve); }, 'btn-primary', 'Write the result into the encounter\'s notes and clear the combat tracker'),
          btn('Award treasure XP', function () { ui.award = { gc: 0, greed: greedBonus(), players: activePCs().length || 1, what: e.name || '' }; setTab('party'); setTimeout(function () { $('sec-xp').scrollIntoView(); }, 0); }, 'btn-ghost', 'Open the Experience card in the Party tab for this encounter\'s treasure'),
          btn('Stop without a result', function () { cancelRun(e); }, 'btn-ghost btn-danger')]),
        el('p', { class: 'fine', text: 'Ending writes the outcome, the rounds, who fell, who\'s still standing, the crows\' Stamina and wounds, and the corpses to harvest into the notes, then clears the tracker.' })])
    ]));
  }
  function encCard(e) {
    var s = S(), due = !!(s.pending && s.pending.encId === e.id);
    var creatures = e.creatures.map(function (c) {
      return el('div', { class: 'li-row' }, [beastSelect(c.n, function (v) { c.n = v; save(); }),
        inp(c, 'k', { type: 'number', min: 1, max: 30, class: 'tiny', 'aria-label': 'How many' }, { dflt: 1 }),
        sel(c, 'side', [['foe', 'Foe'], ['ally', 'Ally']], { class: 'in mini', label: 'Side', re: false }),
        el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove ' + c.n, onclick: function () { e.creatures = e.creatures.filter(function (x) { return x !== c; }); save(); render(); } })]);
    });
    return el('details', { class: 'enc' + (e.done ? ' done' : '') + (due ? ' due' : '') + (ui.encFocus === e.id ? ' focus' : ''), id: 'enc-' + e.id, open: ui.encOpen[e.id] || null,
      ontoggle: function () { ui.encOpen[e.id] = this.open; } }, [
      el('summary', null, [
        el('span', { class: 'enc-name', text: e.name || 'Untitled encounter' }),
        runningEnc() === e ? el('span', { class: 'chip warn', text: 'running' }) : null,
        due ? el('span', { class: 'chip accent', text: 'due this DT' }) : null,
        e.done ? el('span', { class: 'chip ok', text: 'resolved' + (e.outcome ? ': ' + e.outcome.toLowerCase() : '') }) : null,
        el('span', { class: 'enc-sum', text: [encSummary(e), e.where, 'session ' + e.session + (e.dt ? ', DT ' + e.dt : '')].filter(Boolean).join(' · ') })]),
      runningEnc() === e ? el('div', { class: 'enc-body' }, [el('p', { class: 'fine' }, ['Running now: its notes and creatures are in the card at the top of this tab. ',
        el('a', { href: '#sec-enc-run', class: 'enc-link', onclick: function (ev) { ev.preventDefault(); $('sec-enc-run').scrollIntoView({ block: 'start' }); }, text: 'Go to the fight' })])]) :
      el('div', { class: 'enc-body' }, [
        el('div', { class: 'li-row' }, [inp(e, 'name', { placeholder: 'Name', 'aria-label': 'Encounter name' }, { re: true }), inp(e, 'where', { placeholder: 'Where (place, hex, room)', 'aria-label': 'Where' }, { re: true })]),
        el('div', { class: 'fine', text: e.src + ' · ' + (e.roll || 'made ' + e.made) }),
        field('What happens', area(e, 'text', { rows: 3, placeholder: 'Set-up, signs of their approach, what they want…' })),
        el('h4', { text: 'Creatures' }),
        creatures.length ? el('div', { class: 'enc-cre' }, creatures) : el('p', { class: 'fine', text: 'No creatures yet.' }),
        el('div', { class: 'row' }, [btn('Add creature', function () { e.creatures.push({ n: ui.addName || 'Blood Creature A', k: 1, side: 'foe' }); save(); render(); }, 'btn-small btn-ghost')]),
        field('Ref notes', area(e, 'notes', { rows: 2, placeholder: 'Tactics, loot, how it went…' })),
        el('div', { class: 'row' }, [runEncBtn(e), encCombatBtn(e, 'btn-small btn-ghost'),
          due || e.done ? null : btn('Make it due this DT', function () {
            s.pending = { dt: s.dt, text: encSummary(e) || e.name, adds: e.creatures.map(function (c) { return [c.n, c.k, null]; }), encId: e.id };
            log('enc', 'Encounter due this DT: **' + (e.name || 'untitled') + '**.'); save(); render(); toast('Shown in the Dungeon Turn block.');
          }, 'btn-small', 'Show it in the Dungeon Turn block as the encounter due this DT'),
          btn(e.done ? 'Reopen' : 'Mark resolved', function () {
            e.done = !e.done; if (e.done && due) s.pending = null; save(); render();
          }, 'btn-small btn-ghost'),
          btn('Duplicate', function () {
            var c = clone(e); c.id = nid(); c.name = (e.name || 'Encounter') + ' (copy)'; c.done = false; delete c.outcome; c.made = today() + ' ' + nowStamp();
            state.encounters.splice(state.encounters.indexOf(e), 0, c); ui.encOpen[c.id] = true; save(); render();
          }, 'btn-small btn-ghost'),
          btn('Delete', function () {
            if (!confirm('Delete ' + (e.name || 'this encounter') + '?')) return;
            state.encounters = state.encounters.filter(function (x) { return x !== e; }); if (due) s.pending.encId = null;
            if (s.combat.encId === e.id) { s.combat.encId = null; s.combat.surprise = 'none'; }
            save(); render();
          }, 'btn-small btn-ghost btn-danger')])
      ])
    ]);
  }

  A.add({ rollAdds: rollAdds, addsText: addsText, rollDungeonTable: rollDungeonTable, encounterCheck: encounterCheck,
      encounterResultBox: encounterResultBox, addToCombatBtn: addToCombatBtn, newEncounter: newEncounter, findEncounter: findEncounter,
      encName: encName, encSummary: encSummary, saveCheckEncounter: saveCheckEncounter, pendingFrom: pendingFrom, pendingEnc: pendingEnc,
      pendingText: pendingText, encLink: encLink, openEncounter: openEncounter, encCombatBtn: encCombatBtn, runningEnc: runningEnc,
      runEncounter: runEncounter, runEncBtn: runEncBtn, cancelRun: cancelRun, tally: tally, endEncounter: endEncounter, likeHateCheck: likeHateCheck,
      beastSelect: beastSelect, rollEncounterDraft: rollEncounterDraft, renderEncounters: renderEncounters, renderEncRun: renderEncRun,
      encCard: encCard, ENC_OUTCOMES: ENC_OUTCOMES, ENC_SOURCES: ENC_SOURCES });
})();
