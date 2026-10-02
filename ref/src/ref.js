/*
 * Crows Playtest 2 Ref Screen — application logic.
 * Plain browser JavaScript (no build step, no network). Depends on REF (ref-data.js) and REF_RULES (rules-text.js).
 * All campaign state lives in one object, autosaved to localStorage and exportable as a .json file.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'crows-pt2-ref-campaign';
  var TAB_KEY = 'crows-pt2-ref-tab';
  var TABS = [['session', 'Session'], ['encounters', 'Encounters'], ['travel', 'Travel'], ['village', 'Village'], ['party', 'Party'], ['world', 'World'], ['bestiary', 'Bestiary'], ['tables', 'Tables'], ['rules', 'Rules']];
  var SIZES = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge' };
  var EB_LABELS = [[-2, 'DB'], [-1, 'Bane'], [0, '—'], [1, 'Edge'], [2, 'DE']];
  var state, tab, uid = 1;
  var ui = { dice: null, tables: {}, beastQ: '', beastType: '', rulesQ: '', lastEnc: null, travelEnc: null, alarmFired: false, encSrc: '', encDraft: null, encFilter: 'open', encOpen: {}, encFocus: null, encEnd: null };

  // ------------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), val, chk;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') val = v;
      else if (k === 'checked') chk = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    if (val !== undefined) n.value = val;
    if (chk !== undefined) n.checked = !!chk;
    return n;
  }
  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function int(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }
  function nid() { return 'i' + Date.now().toString(36) + (uid++); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function lookup(rows, n) { for (var i = 0; i < rows.length; i++) if (n >= rows[i][0] && n <= rows[i][1]) return rows[i]; return rows[rows.length - 1]; }
  function nowStamp() { var t = new Date(); return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); }
  function today() { var t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function beast(name) { for (var i = 0; i < REF.BESTIARY.length; i++) if (REF.BESTIARY[i].n === name) return REF.BESTIARY[i]; return null; }
  function plural(n, w) { return n + ' ' + (n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(ch|sh|s|x)$/.test(w) ? w + 'es' : w + 's'); }

  /* Roll "NdM", "NdM+K", "NdM x K" or a plain number. */
  function rollDice(expr) {
    if (typeof expr === 'number') return { total: expr, detail: String(expr) };
    var m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*(?:[x*]\s*([\d,]+))?\s*$/i.exec(expr);
    if (!m) { var k = int(expr, 0); return { total: k, detail: String(k) }; }
    var n = int(m[1] || '1', 1), s = int(m[2], 6), rolls = [], sum = 0;
    n = clamp(n, 1, 100);
    for (var i = 0; i < n; i++) { var r = d(s); rolls.push(r); sum += r; }
    if (m[3]) sum += (m[3] === '-' ? -1 : 1) * int(m[4], 0);
    if (m[5]) sum *= int(m[5].replace(/,/g, ''), 1);
    return { total: sum, detail: expr.replace(/\s+/g, '') + ' [' + rolls.join(', ') + ']' };
  }
  /* Roll every dice expression inside a sentence, e.g. "gem worth 10d10 gc" -> "gem worth 10d10 (= 57) gc". */
  function rollInText(text) {
    return text.replace(/\b(\d+)d(\d+)(\s*\+\s*\d+)?(\s*x\s*[\d,]+)?/g, function (all) { return all + ' (= ' + fmt(rollDice(all.replace(/\s+/g, '')).total) + ')'; });
  }

  /* A test: 2d10 + mod with net edges (-2..2). Returns nat, total, tier, crit, doom. */
  function test(mod, net, critMin, dice) {
    var a = dice ? dice[0] : d(10), b = dice ? dice[1] : d(10), nat = a + b;
    var total = nat + mod + (net === 1 ? 2 : net === -1 ? -2 : 0);
    var tier = total <= 11 ? 1 : total <= 16 ? 2 : 3;
    if (net === 2) tier = Math.min(3, tier + 1);
    if (net === -2) tier = Math.max(1, tier - 1);
    var crit = nat >= (critMin || 19), doom = nat <= 3;
    if (crit) tier = 3;
    if (doom) tier = 1;
    return { dice: [a, b], nat: nat, mod: mod, net: net, total: total, tier: tier, crit: crit, doom: doom };
  }
  function netEdges(edges, banes) { return Math.min(2, edges) - Math.min(2, banes); }
  function ebWord(net) { return net === 2 ? 'double edge' : net === 1 ? 'edge' : net === -1 ? 'bane' : net === -2 ? 'double bane' : ''; }
  function testLine(r) {
    return '2d10 [' + r.dice.join(', ') + ']' + (r.mod ? ' ' + signed(r.mod) : '') + (r.net ? ' with ' + ebWord(r.net) : '') + ' = ' + r.total +
      (r.crit ? ' (crit!)' : r.doom ? ' (doom!)' : '');
  }
  function tierChip(r) { return el('span', { class: 'tier t' + r.tier, text: 'Tier ' + r.tier + (r.crit ? ' · crit' : r.doom ? ' · doom' : '') }); }

  // ------------------------------------------------------------------ state
  function freshVillage() {
    return { name: '', prosperity: 0, cycle: 1, day: 1, upgrades: 0, spent10k: false, event: '', saleMod: 0, note: '',
      inst: REF.STARTING_INSTITUTIONS.map(function (t) { return { id: nid(), type: t, level: 1, pending: 0, isNew: false, steward: '', notes: '', closed: false }; }),
      boons: [] };
  }
  function freshState() {
    return {
      v: 1, name: '',
      session: { n: 1, title: '', date: today(), dt: 1, dtLen: 30, mode: 'timer', rooms: 0, roomsDone: 0, running: false, endAt: 0, remain: 30 * 60000,
        sound: true, autoNext: true, place: '', table: 'Blood Creatures', crowded: false, chaos: false, enAdj: 0, firstVisit: true, pending: null,
        rest: { active: false, where: 'dungeon', seclude: false, half: false, applyXP: true },
        combat: { round: 0, list: [], encId: null, surprise: 'none', first: null, feed: [], acts: [], prompts: [], assists: [], auto: true, autoMon: true, showSt: false, items: [], given: [] } },
      log: [],
      travel: { day: 1, pace: 'Normal', speed: 5, road: false, water: 'none', weather: '', beacon: false, strong: false, hexAdj: 0, enAdj: 0, restEnAdj: 0,
        climate: 'Fall & Spring', habitat: 'Forest', nearby: 'Undead', lost: false, miasmaMod: 0, inMiasma: true },
      village: freshVillage(),
      party: [], xpLog: [], hirelings: [], ledger: [], places: [], npcs: [], encounters: [], notes: '', hooks: '', history: [],
      dice: { mod: 0, net: 0, expr: '3d6', ud: 1 }
    };
  }
  function withDefaults(base, s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return base;
    Object.keys(base).forEach(function (k) {
      if (!(k in s) || s[k] === null && base[k] !== null) s[k] = base[k];
      else if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) s[k] = withDefaults(base[k], s[k]);
      else if (Array.isArray(base[k]) && !Array.isArray(s[k])) s[k] = base[k];
    });
    return s;
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    if (state.session && state.session.combat) { releaseGrabs(); dropFromFallen(); }
    if (window.CrowsCloud) { window.CrowsCloud.changed(); liveChanged(); }
  }
  function startNew() { if (window.CrowsCloud) window.CrowsCloud.startNew(); }
  function isCampaign(s) { return !!(s && typeof s === 'object' && s.v === 1 && s.session && typeof s.session === 'object'); }
  function load() {
    try { var raw = localStorage.getItem(STORAGE_KEY); if (raw) { var s = JSON.parse(raw); if (s && s.v === 1) return repairObjects(withDefaults(freshState(), s)); } } catch (e) { /* ignore */ }
    return null;
  }
  function S() { return state.session; }
  /* Older server copies turned empty {} into []; named keys on an array are dropped when saved. */
  function repairObjects(s) {
    (s.session && s.session.combat && s.session.combat.list || []).forEach(function (c) {
      ['conds', 'used'].forEach(function (k) { if (!c[k] || typeof c[k] !== 'object' || Array.isArray(c[k])) c[k] = {}; });
    });
    return s;
  }

  // ------------------------------------------------------------------ log
  function log(kind, text) {
    state.log.push({ t: nowStamp(), k: kind || '', s: text });
    if (state.log.length > 800) state.log.splice(0, state.log.length - 800);
    save();
  }
  /* Render "**bold**" segments safely. */
  function rich(text) {
    var frag = document.createDocumentFragment();
    String(text).split('**').forEach(function (part, i) { frag.appendChild(i % 2 ? el('b', { text: part }) : document.createTextNode(part)); });
    return frag;
  }
  function logItem(e) { return el('li', { class: 'k-' + e.k }, [el('span', { class: 'log-t', text: e.t }), rich(e.s)]); }

  // ------------------------------------------------------------------ bound inputs
  function inp(obj, key, attrs, opts) {
    opts = opts || {}; attrs = attrs || {};
    var isNum = attrs.type === 'number';
    var a = { class: attrs.class || 'in', type: attrs.type || 'text', value: obj[key] == null ? '' : obj[key] };
    Object.keys(attrs).forEach(function (k) { if (k !== 'class') a[k] = attrs[k]; });
    var n = el('input', a);
    n.addEventListener(isNum ? 'change' : 'input', function () {
      if (isNum) {
        var v = int(this.value, opts.dflt != null ? opts.dflt : 0);
        if (attrs.min != null) v = Math.max(+attrs.min, v);
        if (attrs.max != null) v = Math.min(+attrs.max, v);
        obj[key] = v; this.value = v;
      } else obj[key] = this.value;
      save();
      if (opts.on) opts.on(obj[key]);
      if (opts.re) render();
    });
    if (!isNum && opts.re) n.addEventListener('change', function () { render(); });
    return n;
  }
  function area(obj, key, attrs) {
    var n = el('textarea', Object.assign({ rows: 3 }, attrs || {}));
    n.value = obj[key] || '';
    n.addEventListener('input', function () { obj[key] = this.value; save(); });
    return n;
  }
  function sel(obj, key, options, opts) {
    opts = opts || {};
    var n = el('select', { class: opts.class || 'in', 'aria-label': opts.label || null, disabled: opts.disabled || null }, options.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return el('option', { value: String(v), text: l });
    }));
    n.value = String(obj[key]);
    n.addEventListener('change', function () {
      var v = this.value; obj[key] = opts.num ? int(v, 0) : v; save();
      if (opts.on) opts.on(obj[key]);
      if (opts.re !== false) render();
    });
    return n;
  }
  function chk(obj, key, label, opts) {
    opts = opts || {};
    var box = el('input', { type: 'checkbox', checked: !!obj[key] });
    box.addEventListener('change', function () { obj[key] = this.checked; save(); if (opts.on) opts.on(obj[key]); if (opts.re !== false) render(); });
    return el('label', { class: 'check', title: opts.title || null }, [box, label]);
  }
  function field(label, control, cls) { return el('label', { class: 'field' + (cls ? ' ' + cls : '') }, [label, control]); }
  function segEB(obj, key, onchange) {
    return el('div', { class: 'seg', role: 'group', 'aria-label': 'Edges and banes' }, EB_LABELS.map(function (p) {
      return el('button', { type: 'button', class: obj[key] === p[0] ? 'on' : '', 'aria-pressed': obj[key] === p[0] ? 'true' : 'false',
        onclick: function () { obj[key] = p[0]; save(); if (onchange) onchange(); else render(); }, text: p[1] });
    }));
  }
  function btn(text, onclick, cls, title) { return el('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: onclick, title: title || null, text: text }); }
  function card(id, title, kids) {
    var c = $(id); c.innerHTML = '';
    if (title) c.appendChild(typeof title === 'string' ? el('h2', { text: title }) : title);
    (kids || []).forEach(function (k) { if (k) c.appendChild(k); });
    return c;
  }
  function more(summary, kids, open) { return el('details', { class: 'more', open: open || null }, [el('summary', { text: summary })].concat(kids)); }
  function rowsTable(rows, dieLabel, hit, fmtRow) {
    return el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [
      el('thead', null, [el('tr', null, [el('th', { text: dieLabel }), el('th', { text: 'Result' })])]),
      el('tbody', null, rows.map(function (r) {
        var range = r[0] === r[1] ? String(r[0]) : r[0] <= -99 ? r[1] + ' or less' : r[1] >= 999 ? r[0] + '+' : r[0] + '–' + r[1];
        return el('tr', { class: hit != null && hit >= r[0] && hit <= r[1] ? 'hit' : '' }, [el('td', { class: 'n', text: range }), el('td', { text: fmtRow ? fmtRow(r) : r[2] })]);
      }))
    ])]);
  }

  // ------------------------------------------------------------------ derived values
  function currentPlace() { for (var i = 0; i < state.places.length; i++) if (state.places[i].id === S().place) return state.places[i]; return null; }
  function dungeonEN() {
    var s = S(), p = currentPlace(), base = p && p.en ? p.en : 9;
    var en = base - (s.crowded ? 1 : 0) - (s.chaos ? 1 : 0) + (s.enAdj || 0);
    if (s.rest.active && s.rest.seclude) en += 1;
    return clamp(en, 2, 10);
  }
  function travelCalc() {
    var t = state.travel, p = REF.PACES[t.pace] || REF.PACES.Normal, hex = p.hex, en = p.en, notes = [];
    if (t.speed <= 3) { hex -= 1; notes.push('slow group -1 hex'); }
    else if (t.speed >= 10) { hex += 2; notes.push('fast group +2 hexes'); }
    else if (t.speed >= 7) { hex += 1; notes.push('quick group +1 hex'); }
    if (t.road) { hex += 1; en -= 1; notes.push('road +1 hex, EN -1'); }
    if (t.water === 'against') { hex -= 1; notes.push('crossing water / upstream -1 hex'); }
    if (t.water === 'down') { hex += 1; notes.push('downstream +1 hex'); }
    if (t.weather && REF.WEATHER[t.weather] && REF.WEATHER[t.weather].hex) { hex += REF.WEATHER[t.weather].hex; notes.push(t.weather + ' ' + REF.WEATHER[t.weather].hex + ' hex'); }
    hex += t.hexAdj || 0; en += t.enAdj || 0;
    var restEn = clamp(p.en + (t.road ? -1 : 0) + (t.restEnAdj || 0) + (S().rest.seclude ? 1 : 0), 2, 10);
    return { hex: Math.max(0, hex), en: clamp(en, 2, 10), restEn: restEn, notes: notes, paceNote: p.note };
  }
  function greedBonus() { var s = S(); return s.firstVisit && s.dt <= 3 ? [30, 20, 10][s.dt - 1] : 0; }
  function activePCs() { return state.party.filter(function (p) { return p.status === 'active'; }); }
  function salePct() {
    var p = state.village.prosperity, base = lookup(REF.SALE_PCT, p)[2];
    return base + (state.village.saleMod || 0);
  }
  function esBonusCount(txp) {
    var n = 0; REF.ES_ADV.forEach(function (t) { if (txp >= t) n++; });
    if (txp >= 60000) n += Math.floor((txp - 30000) / 30000);
    return n;
  }
  function nextES(txp) {
    for (var i = 0; i < REF.ES_ADV.length; i++) if (txp < REF.ES_ADV[i]) return REF.ES_ADV[i];
    return 30000 * (Math.floor(txp / 30000) + 1);
  }
  function charBonusCount(txp) { var n = 0; REF.CHAR_ADV.forEach(function (t) { if (txp >= t) n++; }); if (txp >= 60000) n += Math.floor((txp - 30000) / 30000); return n; }

  // ------------------------------------------------------------------ dungeon turn timer
  function remainMs() { var s = S(); return s.running ? s.endAt - Date.now() : s.remain; }
  function clockText(ms) { var t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
  function startTimer() { var s = S(); if (s.running) return; if (s.remain <= 0) s.remain = s.dtLen * 60000; s.endAt = Date.now() + s.remain; s.running = true; ui.alarmFired = false; save(); render(); }
  function pauseTimer() { var s = S(); if (!s.running) return; s.remain = Math.max(0, s.endAt - Date.now()); s.running = false; save(); render(); }
  function resetTimer() { var s = S(); s.running = false; s.remain = s.dtLen * 60000; ui.alarmFired = false; save(); }
  function beep() {
    if (!S().sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      var ctx = beep.ctx || (beep.ctx = new Ctx());
      [0, .35, .7].forEach(function (off) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 660; o.type = 'triangle'; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(.0001, ctx.currentTime + off); g.gain.exponentialRampToValueAtTime(.3, ctx.currentTime + off + .02);
        g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + off + .28);
        o.start(ctx.currentTime + off); o.stop(ctx.currentTime + off + .3);
      });
    } catch (e) { /* audio unavailable */ }
  }
  function tick() {
    var s = S(), ms = remainMs(), total = s.dtLen * 60000;
    var cls = s.mode !== 'timer' ? '' : ms <= 0 ? 'out' : ms <= 5 * 60000 ? 'low' : '';
    document.querySelectorAll('[data-clock]').forEach(function (n) {
      n.textContent = s.mode === 'timer' ? clockText(ms) : s.roomsDone + ' / ' + (s.rooms || '?') + ' rooms';
      n.className = 'clock ' + cls;
    });
    document.querySelectorAll('[data-meter]').forEach(function (n) {
      var pct = s.mode === 'timer' ? clamp(ms / total, 0, 1) : s.rooms ? clamp(1 - s.roomsDone / s.rooms, 0, 1) : 1;
      n.className = 'meter ' + cls; n.firstChild.style.width = (pct * 100) + '%';
    });
    if (s.mode === 'timer' && s.running && ms <= 0 && !ui.alarmFired) {
      ui.alarmFired = true; beep(); toast('Dungeon turn ' + s.dt + ' is over. End the DT.');
      log('dt', '**Timer ran out** for DT ' + s.dt + '.');
      renderSideLog();
    }
  }

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
      setTab('session');
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
      setTab('session');
    }, cls || 'btn-small btn-primary', 'Only add its creatures to the combat tracker in the Session tab');
  }

  /*
   * Running an encounter: its creatures (and the active crows) go into the combat tracker, tagged with the
   * encounter's id, and the Encounters tab shows the fight. Ending it writes the result into the encounter's notes.
   */
  var ENC_OUTCOMES = [['won', 'The crows won'], ['foesFled', 'The foes fled or surrendered'], ['fled', 'The crows fled'], ['avoided', 'Talked, traded, or sneaked past'], ['other', 'Something else']];
  function runningEnc() { var id = S().combat.encId; return id ? findEncounter(id) : null; }
  function runEncounter(e) {
    var s = S(), c = s.combat, cur = runningEnc();
    if (cur === e) { setTab('encounters'); return; }
    if (cur && !confirm((cur.name || 'Another encounter') + ' is still running. Switch to ' + (e.name || 'this one') + '? Creatures already in the tracker stay there.')) return;
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
    save(); setTab('encounters');
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
  function endEncounter(e, outcome, resolve) {
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
    save(); openEncounter(e.id); toast('The result is in the encounter\'s notes.');
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

  // ------------------------------------------------------------------ dungeon turns
  function endDT() {
    var s = S(), place = currentPlace(), cleared = [];
    if (s.rest.active) { toast('Finish or cancel the rest first.'); return; }
    log('dt', '**End of DT ' + s.dt + '**' + (place ? ' at ' + place.name : '') + '. Roll usage dice (lights, spells, backlashes, DT items); DT effects end.');
    s.combat.list.forEach(function (c) { REF.END_OF_DT_CONDITIONS.forEach(function (k) { if (c.conds[k]) { delete c.conds[k]; cleared.push(c.name + ' ' + k.toLowerCase()); } }); });
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

  // ------------------------------------------------------------------ combat
  /* Creatures added while an encounter is running (from anywhere) join that encounter. */
  function addCombatant(name, count, side, encId) {
    var b = beast(name), list = S().combat.list;
    if (encId === undefined) encId = S().combat.encId || null;
    for (var i = 0; i < (count || 1); i++) {
      var same = list.filter(function (c) { return c.cref === name; }).length;
      list.push({ id: nid(), kind: side === 'ally' ? 'ally' : 'foe', cref: name, name: name + ' ' + (same + 1), st: b ? b.st : 10, stMax: b ? b.st : 10,
        ad: b ? b.ad : 0, adMax: b ? b.ad : 0, wounds: 0, conds: {}, used: {}, dead: false, note: '', enc: encId });
    }
    save();
  }
  function addPartyToCombat() {
    var added = addParty();
    save(); render();
    toast(added ? 'Added ' + plural(added, 'crow') + '.' : 'No active crows to add (see the Party tab).');
  }
  /* Put the active crows not yet in combat into the tracker; returns how many were added. */
  function addParty() {
    var list = S().combat.list, added = 0;
    activePCs().forEach(function (p) {
      if (list.some(function (c) { return c.pcId === p.id; })) return;
      var x = { id: nid(), kind: 'pc', pcId: p.id, cref: '', name: p.name || 'Crow', st: p.st, stMax: p.stMax, ad: p.ad || 0, adMax: p.ad || 0, wounds: p.wounds || 0,
        conds: clone(p.conds || {}), used: {}, dead: false, note: '' };
      list.push(x);
      pullVitals(x);   // a linked crow's own AD (armor and parry weapons) and conditions, from its sheet
      added++;
    });
    return added;
  }
  /* Round 1 of a fight that began with surprise: the surprised side takes no turn, and attacks against it get +1. */
  function surprised(c) {
    var cb = S().combat;
    return cb.round === 1 && (cb.surprise === 'crows' ? c.kind !== 'foe' : cb.surprise === 'foes' && c.kind === 'foe');
  }
  function slotsOf(c) { var b = beast(c.cref); return c.kind === 'pc' ? 10 : b && (b.t === 'Human' || b.t === 'Animal') ? b.sl : 0; }
  function byId(id) { return id ? S().combat.list.filter(function (x) { return x.id === id; })[0] || null : null; }
  var SIZE_ORDER = 'TSMLH';
  function sizeOf(x) { var b = beast(x && x.cref); return !x || x.kind === 'pc' || !b ? 'M' : b.sz; }
  /* x is `than`'s size or smaller (than: a creature or a size letter). */
  function noBigger(x, than) { return SIZE_ORDER.indexOf(sizeOf(x)) <= SIZE_ORDER.indexOf(typeof than === 'string' ? than : sizeOf(than)); }
  /* Set or clear a condition; on a crow it goes onto the player's sheet too. Losing Grabbed ends the grab. */
  function setCond(x, k, on) {
    if (k === 'Grabbed' && !on) delete x.grabbedBy;
    if (!!x.conds[k] === !!on) return;
    if (on) x.conds[k] = true; else delete x.conds[k];
    var p = pcOf(x);
    if (p) { var o = { cond: {} }; o.cond[k] = !!on; sheetOp(p, o); }
  }
  /*
   * Damage through AD, Stamina, and wounds. A linked crow takes it on its own sheet (its worn armor and parry weapons,
   * the way Take damage works there), and the result is read back; the sheet as it was comes back for Undo.
   * opts: { from: who dealt it, quiet: no save/render (the caller does it) }. Returns { sheet: before } for a sheet hit.
   */
  function damage(c, amount, piercing, opts) {
    opts = opts || {};
    var p = pcOf(c), w = p && p.link && cloudOn() ? sheetWin(p) : null, out = null;
    if (w) {
      var o = { hit: amount, piercing: !!piercing, from: opts.from || '' };
      sheetOp(p, o);   // the frame is ready, so it's dealt now and o.result says how
      if (o.result) {
        pullVitals(c);
        var dead = c.wounds >= 10;
        log('', '**' + c.name + '** takes ' + o.result.total + (piercing ? ' piercing' : '') + ' damage on their sheet (' + o.result.parts.join(', ') + ')' + (dead ? ' — all backpack slots wounded: dead.' : '.'));
        feed('**' + c.name + '** takes ' + o.result.total + (piercing ? ' piercing' : '') + ' damage (' + o.result.parts.join(', ') + ')' + (dead ? ' — dead.' : '.'));
        if (!opts.quiet) { save(); render(); }
        return { sheet: o.result.before };
      }
    }
    var parts = [], total = amount, st0 = c.st, w0 = c.wounds;
    if (c.conds.Vulnerable) { var v = d(6); total += v; parts.push('vulnerable +' + v); }
    var left = total;
    if (!piercing && c.ad > 0) { var absorbed = Math.min(c.ad, left); c.ad -= absorbed; left -= absorbed; parts.push(absorbed + ' to AD'); }
    if (left > 0) { var st = Math.min(c.st, left); c.st -= st; left -= st; if (st) parts.push(st + ' to Stamina'); }
    var slots = slotsOf(c);
    if (left > 0 && slots) { var wn = Math.min(slots - c.wounds, left); c.wounds += wn; left -= wn; if (wn) parts.push(plural(wn, 'wound')); }
    if (c.conds.Unconscious && total > 0) { delete c.conds.Unconscious; parts.push('wakes up'); }   // any damage wakes a sleeper
    var fate = '';
    if (c.kind === 'pc') { if (c.wounds >= 10) fate = ' — all backpack slots wounded: dead.'; }
    else if (c.st <= 0) {
      var b = beast(c.cref);
      if (!slots) { c.dead = true; fate = ' — dies (0 Stamina).'; }
      else if (c.wounds >= slots) { c.dead = true; fate = ' — dead (every slot wounded).'; }
      else fate = b && b.t === 'Human' ? ' — at 0 Stamina: a lone human flees; a group reduced by half flees.' : ' — at 0 Stamina: animals flee.';
    }
    // A linked crow whose sheet isn't open here yet gets the hit itself when it opens (its own armor decides); others get the change.
    if (p && p.link && cloudOn()) sheetOp(p, { hit: amount, piercing: !!piercing, from: opts.from || '' });
    else if (c.kind === 'pc') syncPC(c, st0, w0);
    log('', '**' + c.name + '** takes ' + total + (piercing ? ' piercing' : '') + ' damage (' + (parts.join(', ') || 'no effect') + ')' + fate);
    // Players see where a foe's damage went only when the Ref shows them foes' Stamina.
    feed('**' + c.name + '** takes ' + total + (piercing ? ' piercing' : '') + ' damage' + (c.kind !== 'foe' || S().combat.showSt ? ' (' + (parts.join(', ') || 'no effect') + ')' : '') + (fate || '.'));
    if (!opts.quiet) { save(); render(); }
    return out;
  }
  function heal(c, amount, opts) {
    var st0 = c.st; c.st = Math.min(c.stMax, c.st + amount);
    if (c.st > 0 && c.kind !== 'pc' && !slotsOf(c)) c.dead = false;
    if (c.kind === 'pc') syncPC(c, st0, c.wounds);
    log('', c.name + ' regains ' + amount + ' Stamina (' + c.st + '/' + c.stMax + ').'); feed('**' + c.name + '** regains ' + amount + ' Stamina.');
    if (!(opts && opts.quiet)) { save(); render(); }
  }
  /* A crow's combat entry changed from (st0, w0): pass the change on to the party entry and its sheet. */
  function syncPC(c, st0, w0) {
    var p = pcOf(c);
    if (p && (c.st !== st0 || c.wounds !== w0)) sheetOp(p, { st: c.st - st0, wounds: c.wounds - w0 });
  }
  /* A linked crow's vitals as its sheet has them (Stamina, AD from its armor and parry weapons, wounds, conditions). */
  function pullVitals(x) {
    var p = pcOf(x), w = p && p.link && cloudOn() ? sheetWin(p) : null;
    if (!w || !w.CrowsPlay.vitals) return false;
    var v = w.CrowsPlay.vitals(), was = JSON.stringify([x.st, x.stMax, x.ad, x.adMax, x.wounds, x.conds]);
    x.st = v.st; x.stMax = v.stMax; x.ad = v.ad; x.adMax = v.adMax; x.wounds = v.wounds; x.conds = v.conds;
    if (!x.conds.Grabbed) delete x.grabbedBy;
    p.st = v.st; p.wounds = v.wounds; p.conds = clone(v.conds);
    return was !== JSON.stringify([x.st, x.stMax, x.ad, x.adMax, x.wounds, x.conds]);
  }
  /* Keep linked crows in the tracker in step with their sheets (the player may drink a potion, stand up, change armor). */
  setInterval(function () {
    if (!state || !cloudOn() || window.CrowsCloud.typing) return;
    var changed = false;
    S().combat.list.forEach(function (x) { if (x.kind === 'pc' && pullVitals(x)) changed = true; });
    if (changed) { save(); render(); }
  }, 2000);

  // ---- targets, reactions, grabs, taunts
  /* Who a creature in the tracker can attack: the other side (crows and allies for a foe, foes for an ally), still up. */
  function targetsFor(c) {
    return S().combat.list.filter(function (x) { return x !== c && !x.dead && (c.kind === 'foe' ? x.kind !== 'foe' : x.kind === 'foe'); });
  }
  /* The creature's chosen target (n = 2: its second target, for attacks on 2 targets), while it can still be attacked. */
  function targetOf(c, n) { var id = n === 2 ? c.tgt2 : c.tgt, t = id && targetsFor(c).filter(function (x) { return x.id === id; })[0]; return t || null; }
  function twoTargets(a) { return /2 targets/.test(a[5] || ''); }
  /* Reactions: 1 a round (more for some creatures); counters and opportunity attacks use them. */
  function rxMax(x) { var b = beast(x.cref); return x.kind === 'pc' ? 1 : (b && b.rx) || 1; }
  function rxLeft(x) { var r = S().combat.round; return rxMax(x) - (x.rx && x.rx.r === r ? x.rx.n : 0); }
  function useRx(x) { var r = S().combat.round; if (!x.rx || x.rx.r !== r) x.rx = { r: r, n: 0 }; x.rx.n++; }
  /* A grab ends when the grabber is gone, dead, prone, or unconscious. Called from save(). */
  function releaseGrabs() {
    var list = S().combat.list;
    list.forEach(function (x) {
      if (!x.grabbedBy) return;
      var g = byId(x.grabbedBy);
      if (g && !g.dead && !g.conds.Prone && !g.conds.Unconscious && x.conds.Grabbed) return;
      delete x.grabbedBy;
      if (x.conds.Grabbed) { setCond(x, 'Grabbed', false); feed('**' + x.name + '** is no longer grabbed' + (g ? ' (' + g.name + (g.dead ? ' is dead' : g.conds.Prone ? ' is prone' : g.conds.Unconscious ? ' is unconscious' : ' let go') + ').' : '.')); }
    });
  }
  function grabbing(c) { return S().combat.list.filter(function (x) { return x.grabbedBy === c.id; }); }
  /* Taunt: until the start of the taunter's next turn, attacks by the taunted creature that don't include the taunter take a bane. */
  function tauntOn(x) { var t = x.taunt; return !!(t && byId(t.by) && !byId(t.by).dead); }
  /* A new round: taunts run out at the start of the taunter's next turn, reaction prompts and unused assists lapse. */
  function newRound(c) {
    c.list.forEach(function (x) {
      var t = x.taunt;
      if (t && (c.round > t.round + 1 || (c.round === t.round + 1 && c.first === 'crows'))) delete x.taunt;
    });
    c.prompts = (c.prompts || []).filter(function (p) { return p.round >= c.round; });
    c.assists = (c.assists || []).filter(function (a) { return a.round >= c.round - 1; });
  }
  /* Modifiers on a creature's roll against a target: its own conditions, the target's state, and the battlefield (ui.sit). */
  function rollMods(att, t, melee, a) {
    var dice = state.dice, sit = ui.sit || {}, b = beast(att.cref), x = (b && b.x) || '', note = (a && a[5]) || '';
    var m = { e: 0, b: 0, bonus: 0, why: [], autoT3: false };
    if (dice.net > 0) m.e += dice.net; if (dice.net < 0) m.b -= dice.net;
    if (att.conds.Weakened) { m.b++; m.why.push('weakened'); }
    if (att.conds.Blessed) { m.e++; m.why.push('blessed'); }
    if (att.conds.Prone && melee) { m.b++; m.why.push('prone'); }
    if (att.hidden) { m.e++; m.why.push('hidden'); }
    if (tauntOn(att) && (!t || t.id !== att.taunt.by)) { m.b++; m.why.push('taunted by ' + att.taunt.name); }
    if (t) {
      if (surprised(t)) { m.bonus++; m.why.push('+1 vs surprised'); }
      if (t.conds.Prone) { if (melee) { m.e++; m.why.push('target prone'); } else { m.b++; m.why.push('target prone (ranged)'); } }
      if (t.conds.Grabbed) { m.e++; m.why.push('target grabbed'); }
      if (t.squeeze) { m.bonus++; m.why.push('+1 vs squeezing'); }
      if (t.conds.Unconscious) { m.autoT3 = true; m.why.push('target unconscious: tier 3'); }
    } else if (S().combat.round === 1 && (S().combat.surprise === 'crows' && att.kind === 'foe' || S().combat.surprise === 'foes' && att.kind === 'ally')) { m.bonus++; m.why.push('+1 vs surprised'); }
    if (sit.flank && melee) { m.e++; m.why.push('flanking'); }
    if (sit.high) { m.e++; m.why.push('high ground'); }
    if (sit.cover && !/ignores cover/.test(note)) { m.b++; m.why.push('cover'); }
    if (sit.dark && !/◐/.test(x)) { m.b += 2; m.why.push('darkness'); }
    else if (sit.dim && !/[⌂◐]/.test(x)) { m.b++; m.why.push('dim light'); }
    if (sit.adj && !melee) { m.b++; m.why.push('ranged vs adjacent'); }
    if (sit.far > 0 && !melee) { m.bonus -= 2 * sit.far; m.why.push('-' + (2 * sit.far) + ' beyond range'); }
    return m;
  }
  /* What a creature's attack does on top of damage, read from its notes: conditions by tier (with a size limit), grabs. */
  function tierFx(c, a, t, r) {
    var note = (a[5] || '').toLowerCase(), out = { conds: {}, grab: false, notes: [] };
    if (!t || r.tier < 2) return out;
    var gate = /vs (tiny|small|medium|large|huge) or smaller/.exec(note), fits = !gate || noBigger(t, gate[1][0].toUpperCase());
    note.split(';').forEach(function (part) {
      var m = /t([23])(?: vs \w+ or smaller)?:? ([a-z ,]+)/.exec(part.trim()), any = /^damage: (\w+)/.exec(part.trim());
      var words = m && +m[1] <= r.tier ? m[2] : any ? any[1] : '';
      if (!words || (m && gate && !fits)) return;
      ['weakened', 'vulnerable', 'prone', 'blessed'].forEach(function (k) { if (words.indexOf(k) >= 0) out.conds[k[0].toUpperCase() + k.slice(1)] = true; });
      if (words.indexOf('grabbed') >= 0) out.grab = true;
    });
    if (gate && !fits && /grabbed|prone/.test(note)) out.notes.push(t.name + ' is too big for the ' + /grabbed|prone/.exec(note)[0] + ' on tier 3');
    if (/lacerate/.test(note) && (r.tier === 3 || /any hit/.test(note))) out.notes.push('Lacerate: ' + t.name + ' takes 1 piercing for each laceration whenever they move and act in a turn, until they regain Stamina');
    return out;
  }
  /* The damage a creature's hit deals (crit damage, blessed, bonuses against what it has grabbed). */
  function hitDamage(c, a, t, r) {
    var b = beast(c.cref), note = a[5] || '', n = r.tier === 2 ? a[3] : a[4], parts = [];
    var cd = r.crit && /crit = (\d+) damage/.exec(note);
    if (cd) { n = +cd[1]; parts.push('crit'); }
    if (c.conds.Blessed && b) { var bl = Math.max(b.c[0], b.c[2]); n += bl; parts.push('+' + bl + ' blessed'); }
    var g = /\+(\d+) (?:melee )?damage vs (?:a creature it has )?grabbed/.exec(note);
    if (g && t && t.grabbedBy === c.id) { n += +g[1]; parts.push('+' + g[1] + ' vs grabbed'); }
    var any = /\+(\d+) while it has anyone grabbed/.exec(note);
    if (any && grabbing(c).length) { n += +any[1]; parts.push('+' + any[1] + ' while grabbing'); }
    // From its stat line: hurt beasts hit harder ("At 15 Stamina or less: +2 damage"), and a charge (the Ref's "Charged 4+" button).
    var x = (b && b.x) || '', low = /At (\d+) Stamina(?: or less)?: \+(\d+) damage/.exec(x), ch = /^Charge:[^+]*\+(\d+) damage/m.exec(x.replace(/\. /g, '.\n'));
    if (low && c.st <= +low[1]) { n += +low[2]; parts.push('+' + low[2] + ' hurt'); }
    if (ch && (ui.sit || {}).charge) { n += +ch[1]; parts.push('+' + ch[1] + ' charge'); }
    return { n: n, parts: parts };
  }
  /* A test with these dice (one roll for every target of an attack; each target's modifiers apply on their own). */
  function testWith(dice, mod, net, critMin) {
    var r = test(mod, net, critMin, dice);
    return r;
  }
  /* A creature's own melee attack, for counters and opportunity attacks. */
  function meleeAtk(c) { var b = beast(c.cref); return b ? b.atk.filter(function (a) { return /^M/.test(a[2]); })[0] || null : null; }
  /*
   * A creature's attack, at its target(s) if the Ref picked them: one roll, each target's modifiers on their own. A hit
   * deals damage (crit damage, blessed, grab bonuses) and the attack's tier effects (weakened, prone, grabbed...) to the
   * target unless the Ref turned that off; Undo takes it back. A melee miss lets the target counter (a crow's player is
   * asked on their Play page). A crit regains a used X/Rest feature. opts.rxn: an opportunity attack (uses a reaction).
   */
  function monsterAttack(c, a, opts) {
    opts = opts || {};
    var cb = S().combat, melee = /^M/.test(a[2]), crit = /crits on 18-20/.test(a[5] || '') ? 18 : 19;
    var t1 = targetOf(c), t2 = twoTargets(a) ? targetOf(c, 2) : null, tgts = [t1].concat(t2 && t2 !== t1 ? [t2] : []).filter(Boolean);
    var dice = [d(10), d(10)], lines = [], act = { who: c.name, label: a[0], items: [], applied: false }, counters = [];
    (tgts.length ? tgts : [null]).forEach(function (t) {
      var m = rollMods(c, t, melee, a), r = testWith(dice, a[1] + m.bonus, netEdges(m.e, m.b), crit);
      if (m.autoT3 && !r.doom) r.tier = 3;
      var line = (t ? '→ **' + t.name + '**: ' : '') + testLine(r) + ' → T' + r.tier, dm = null, fx = null;
      if (r.tier > 1) {
        dm = hitDamage(c, a, t, r); fx = tierFx(c, a, t, r);
        line += ', ' + dm.n + ' damage' + (dm.parts.length ? ' (' + dm.parts.join(', ') + ')' : '');
        var cn = Object.keys(fx.conds);
        if (cn.length) line += ', ' + cn.join(' and ').toLowerCase();
        if (fx.grab) line += ', grabbed';
        if (fx.notes.length) line += '. ' + fx.notes.join('. ');
        if (t) act.items.push({ id: t.id, damage: dm.n, conds: fx.conds, grab: fx.grab ? c.id : null });
      } else {
        line += ' miss';
        if (melee && t) {
          if (t.kind === 'pc') { prompt(t, c, r.doom, 'a melee attack'); line += ' (' + t.name + ' may counter)'; }
          else if (meleeAtk(t)) counters.push({ by: t, vs: c, doom: r.doom });
        }
      }
      if (m.why.length) line += ' [' + m.why.join(', ') + ']';
      lines.push({ r: r, text: line, t: t, dm: dm });
    });
    var r0 = lines[0].r;
    if (opts.rxn) useRx(c);
    if (c.hidden) { c.hidden = false; lines[0].text += '. ' + c.name + ' is no longer hidden'; }
    if (r0.crit) {
      var b = beast(c.cref), back = b && b.uses.filter(function (u) { return c.used[u[0]] > 0; })[0];
      if (back) { c.used[back[0]]--; lines[0].text += '. Crit: regains a use of ' + back[0]; }
    }
    ui.sit = {};   // the battlefield modifiers were for this roll
    ui.dice = { label: c.name + ': ' + a[0] + (opts.rxn ? ' (opportunity attack)' : '') + (tgts.length ? ' → ' + tgts.map(function (t) { return t.name; }).join(', ') : ''), r: r0,
      dmg: lines.map(function (l) { return (l.t ? l.t.name + ': ' : '') + (l.r.tier === 1 ? 'miss' : l.dm.n + ' damage'); }).join(' · '),
      hit: act.items.length ? act : null, counters: counters,
      note: [a[5] || ''].concat(lines.length > 1 || lines[0].text.indexOf('[') >= 0 ? lines.map(function (l) { return l.text.replace(/\*\*/g, ''); }) : []).filter(Boolean).join('; ') };
    log('', '**' + c.name + '** ' + a[0] + ' (' + a[2] + ')' + (opts.rxn ? ', opportunity attack' : '') + (tgts.length ? ' ' : ': ') + lines.map(function (l) { return l.text; }).join('; ') + (r0.crit ? '. Crit: extra action.' : ''));
    feed('**' + c.name + '** ' + a[0] + (opts.rxn ? ' (opportunity attack)' : '') + ': ' + lines.map(function (l) { return (l.t ? '→ **' + l.t.name + '** ' : '') + 'tier ' + l.r.tier + (l.r.crit ? ' (crit)' : '') + (l.r.tier === 1 ? ', a miss' : ', ' + l.dm.n + ' damage'); }).join('; ') + '.');
    if (act.items.length && cb.autoMon !== false) applyAct(act);
    save(); render();
  }
  /* A crow may counter (its player is asked on their Play page, until the end of the round). */
  function prompt(crow, by, doom, what) {
    var cb = S().combat;
    (cb.prompts = cb.prompts || []).push({ id: nid(), to: crow.id, from: by.id, fromName: by.name, doom: !!doom, round: cb.round, what: what });
  }
  /*
   * A creature's maneuver: Grab or Knockback against its target (its size or smaller), or Escape Grab. 2d10 + S
   * (Escape: A or S). Grab: T2 grabbed (push 1 or shift), T3 grabbed. Knockback: push 1 / 2. Escape: T2 free (the grabber
   * may counter), T3 free and move 1. A tier 1 Grab or Knockback lets the target counter.
   */
  function monsterManeuver(c, kind) {
    var b = beast(c.cref), cb = S().combat, t = kind === 'escape' ? byId(c.grabbedBy) : targetOf(c);
    if (!t) { toast(kind === 'escape' ? c.name + ' isn’t grabbed.' : 'Pick ' + c.name + '’s target first.'); return; }
    if (kind !== 'escape' && !noBigger(t, c)) { toast(t.name + ' is bigger than ' + c.name + ': it can only grab or knock back its size or smaller.'); return; }
    var x = (b && b.x) || '', tx = (beast(t.cref) || {}).x || '', m = { e: 0, b: 0, bonus: 0, why: [] }, net = state.dice.net;
    if (net > 0) m.e += net; if (net < 0) m.b -= net;
    if (c.conds.Weakened) { m.b++; m.why.push('weakened'); }
    if (c.conds.Blessed) { m.e++; m.why.push('blessed'); }
    var ch = b ? (kind === 'escape' ? Math.max(b.c[0], b.c[2]) : b.c[2]) : 0;
    if (kind === 'grab' && /E to grab/.test(x)) { m.e++; m.why.push('good grabber'); }
    if (kind === 'escape' && /B (to escape|for others to escape)/.test(tx)) { m.b++; m.why.push(t.name + ' holds tight'); }
    var r = test(ch + m.bonus, netEdges(m.e, m.b), 19), name = kind === 'grab' ? 'Grab' : kind === 'knockback' ? 'Knockback' : 'Escape Grab';
    var act = { who: c.name, label: name, items: [], applied: false }, res, counters = [];
    if (kind === 'escape') {
      res = r.tier === 1 ? 'still grabbed' : r.tier === 2 ? 'breaks free, but ' + t.name + ' may counter' : 'breaks free and moves 1 square';
      if (r.tier > 1) act.items.push({ id: c.id, conds: { Grabbed: false } });
      if (r.tier === 2) { if (t.kind === 'pc') prompt(t, c, false, 'an escape from your grab'); else if (meleeAtk(t)) counters.push({ by: t, vs: c, doom: false }); }
    } else {
      res = r.tier === 1 ? 'fails; ' + t.name + ' may counter' : kind === 'grab' ? (r.tier === 2 ? 'grabbed (push 1 or ' + c.name + ' shifts)' : 'grabbed') : 'pushed ' + (r.tier === 2 ? 1 : 2) + ' square' + (r.tier === 2 ? '' : 's');
      if (r.tier > 1 && kind === 'grab') act.items.push({ id: t.id, grab: c.id });
      if (r.tier === 1) { if (t.kind === 'pc') prompt(t, c, r.doom, 'a ' + name); else if (meleeAtk(t)) counters.push({ by: t, vs: c, doom: r.doom }); }
    }
    var line = '**' + c.name + '** ' + name + (kind === 'escape' ? ' from **' + t.name + '**' : ' → **' + t.name + '**') + ': ' + testLine(r) + ' → T' + r.tier + ', ' + res + (m.why.length ? ' [' + m.why.join(', ') + ']' : '') + '.';
    ui.sit = {};
    ui.dice = { label: c.name + ': ' + name + ' (' + (kind === 'escape' ? 'from ' : '→ ') + t.name + ')', r: r, dmg: res, hit: act.items.length ? act : null, counters: counters, note: m.why.length ? 'auto: ' + m.why.join(', ') : '' };
    log('', line); feed(line);
    if (act.items.length && cb.autoMon !== false) applyAct(act);
    save(); render();
  }

  // ---- applying and undoing effects
  /* What an action does to whom: [{ id, damage, piercing, heal, ad, wounds (healed), conds: { name: on }, grab: grabber id }]. */
  function fxItems(act) { return act.items || (act.target && act.damage ? [{ id: act.target, damage: act.damage, piercing: act.piercing }] : []); }
  /* Deal an action's effects (remembering everyone as they were, for Undo). */
  function applyAct(act) {
    if (act.applied) return;
    var before = {};
    fxItems(act).forEach(function (f) {
      var x = byId(f.id);
      if (!x) return;
      var b = before[f.id] = { st: x.st, ad: x.ad, adMax: x.adMax, wounds: x.wounds, dead: !!x.dead, conds: clone(x.conds), grabbedBy: x.grabbedBy || null };
      if (f.damage > 0) { var r = damage(x, f.damage, f.piercing, { from: act.who, quiet: true }); if (r && r.sheet) b.sheet = r.sheet; }
      if (f.heal > 0) heal(x, f.heal, { quiet: true });
      if (f.ad > 0) { x.ad += f.ad; x.adMax = Math.max(x.adMax, x.ad); log('', x.name + ' gains ' + f.ad + ' AD (' + act.who + ').'); feed('**' + x.name + '** gains ' + f.ad + ' AD.'); }
      if (f.wounds > 0 && x.wounds) {
        var n = Math.min(f.wounds, x.wounds), w0 = x.wounds; x.wounds -= n;
        if (x.kind === 'pc') syncPC(x, x.st, w0);
        log('', x.name + ' heals ' + plural(n, 'wound') + ' (' + act.who + ').'); feed('**' + x.name + '** heals ' + plural(n, 'wound') + '.');
      }
      if (f.conds) Object.keys(f.conds).forEach(function (k) { setCond(x, k, f.conds[k]); });
      if (f.grab) { x.grabbedBy = f.grab; setCond(x, 'Grabbed', true); }
    });
    act.before = before; act.applied = true;
    save(); render();
  }
  function undoAct(act) {
    if (!act.applied || !act.before) return;
    var names = [];
    Object.keys(act.before).forEach(function (id) {
      var x = byId(id), b = act.before[id], p = x && pcOf(x);
      if (!x) return;
      var st0 = x.st, w0 = x.wounds;
      if (b.sheet && p) sheetOp(p, { restore: b.sheet });
      x.st = b.st; x.ad = b.ad; x.adMax = b.adMax; x.wounds = b.wounds; x.dead = b.dead;
      REF.CONDITIONS.forEach(function (k) { setCond(x, k[0], !!b.conds[k[0]]); });
      if (b.grabbedBy) x.grabbedBy = b.grabbedBy; else delete x.grabbedBy;
      if (x.kind === 'pc' && !b.sheet) syncPC(x, st0, w0);
      if (p && b.sheet) { p.st = b.st; p.wounds = b.wounds; }
      names.push(x.name);
    });
    act.applied = false; delete act.before;
    log('', 'Undid ' + act.who + '’s ' + (act.label || 'action') + ' on ' + names.join(', ') + '.');
    feed('The Ref undid **' + act.who + '**’s ' + (act.label || 'action') + ' on **' + names.join(', ') + '**.');
    save(); render();
  }
  /* A creature counters (a reaction): its melee attack's tier 2 damage, tier 3 if the one it counters rolled a doom. */
  function counterDamage(t, doom) {
    var m = meleeAtk(t);
    return m ? { n: doom ? m[4] : m[3], with: m[0] } : null;
  }
  function counterAct(by, victim, doom) {
    var cd = counterDamage(by, doom);
    if (!cd) return null;
    useRx(by);
    var act = { who: by.name, label: 'counter', items: [{ id: victim.id, damage: cd.n }], applied: false };
    log('', '**' + by.name + '** counters **' + victim.name + '** with ' + cd.with + (doom ? ' (doom: tier 3 damage)' : '') + '.');
    feed('**' + by.name + '** counters **' + victim.name + '**: ' + cd.n + ' damage.');
    applyAct(act);
    return act;
  }

  // ------------------------------------------------------------------ live combat with the players
  /*
   * On the accounts site the fight in the combat tracker is shared with the players of the linked crows in it.
   * Their Play pages show the round, who acts first, every combatant (how hurt foes look, or their Stamina and AD if
   * the Ref shows them; conditions, grabs, taunts, who's attacking whom), reaction prompts, assists, and a feed. From
   * there players attack and cast at targets they pick, make maneuvers (Grab, Knockback, Escape Grab, Stand Up, Jump...),
   * Taunt, Ready, Assist, react (counters, opportunity attacks), and say when they're done for the round. Those actions
   * arrive here; their effects are applied at once unless the Ref turns that off, and can be undone. The rules' options
   * after a miss, a doom, or a crit (counters, stray shots, backlash, dismember) are buttons on the action.
   * See "live combat" in server/app/api.php.
   */
  var live = { sent: null, cid: null, timer: null, busy: false, again: false, off: false, fetching: false };
  /* A line for the players' combat feed (only while there's a fight). */
  function feed(text) {
    var c = S().combat;
    if (!c.list.length) return;
    (c.feed = c.feed || []).push({ t: Date.now(), s: text });
    if (c.feed.length > 40) c.feed.splice(0, c.feed.length - 40);
  }
  function clearCombat(c) { c.list = []; c.round = 0; c.encId = null; c.surprise = 'none'; c.first = null; c.feed = []; c.acts = []; c.prompts = []; c.assists = []; c.items = []; c.given = []; }

  // ------------------------------------------------------------------ unattended items
  /*
   * The items in an encounter that no one holds (c.items), and those foes and allies hold (x.items). Crows drop what's
   * in their hands, or dump their backpack, and pick items up (Pick Up Item: a maneuver that needs a free hand) from
   * their Play page; those arrive as actions (takeAction). A pickup goes to the first crow to ask while the item is
   * still there: one of it leaves the ground and is handed over in c.given, which that crow's page adds to its sheet,
   * once. The Ref makes creatures pick items up and drop them (a creature that dies drops what it held), hides items
   * from the players (they don't see or reach them), and creates new ones. Each change goes in the log and, unless
   * the item is hidden, the players' feed.
   */
  function itemName(it) { return it.key + (it.qty > 1 ? ' ×' + it.qty : ''); }
  function itemsText(list) { return list.map(itemName).join(', '); }
  function newItem(key, qty, hidden, src) {
    var it = { id: nid(), key: String(key).trim().slice(0, 80), qty: clamp(int(qty, 1), 1, 999), hidden: !!hidden };
    ['ud', 'dmg', 'ammo'].forEach(function (k) { if (src && typeof src[k] === 'number') it[k] = src[k]; });
    return it;
  }
  function onGround() { var c = S().combat; return c.items || (c.items = []); }
  /* A line for the log, and for the players' feed when they can see it (a hidden item stays out of it). */
  function itemNews(text, open) { log('', text); if (open) feed(text); }
  function putDown(list, by) {
    list.forEach(function (it) { if (by) it.by = by; onGround().push(it); });
    if (onGround().length > 100) onGround().splice(0, onGround().length - 100);
  }
  function creaturePickUp(x, it) {
    var g = onGround(), i = g.indexOf(it);
    if (i < 0) return;
    g.splice(i, 1); delete it.by;
    (x.items = x.items || []).push(it);
    itemNews('**' + x.name + '** picks up ' + (it.hidden ? itemName(it) + ' (hidden).' : '**' + itemName(it) + '**.'), !it.hidden);
  }
  function creatureDrop(x, list, why) {
    if (!list.length) return;
    x.items = (x.items || []).filter(function (it) { return list.indexOf(it) < 0; });
    putDown(list, x.name);
    var open = list.filter(function (it) { return !it.hidden; });
    log('', '**' + x.name + '** ' + (why || 'drops') + ' ' + itemsText(list) + '.');
    if (open.length) feed('**' + x.name + '** ' + (why || 'drops') + ' **' + itemsText(open) + '**.');
  }
  /*
   * A creature that died leaves what it held on the ground. Checked from save(), like releaseGrabs, but done once the
   * change being saved is finished, so the feed tells of the death before the drop.
   */
  var dropQueued = false;
  function dropFromFallen() {
    if (dropQueued || !S().combat.list.some(function (x) { return x.dead && x.kind !== 'pc' && x.items && x.items.length; })) return;
    dropQueued = true;
    Promise.resolve().then(function () {
      dropQueued = false;
      S().combat.list.forEach(function (x) { if (x.dead && x.kind !== 'pc' && x.items && x.items.length) creatureDrop(x, x.items.slice(), 'falls and drops'); });
      save();
      if (!(window.CrowsCloud && window.CrowsCloud.typing)) render();
    });
  }
  function groundText() {
    var g = onGround();
    return g.length ? 'Left on the ground: ' + g.map(function (it) { return itemName(it) + (it.hidden ? ' (hidden)' : ''); }).join(', ') + '.' : '';
  }
  /* The Combat card's list of unattended items, with what the Ref can do to them. */
  function itemsPanel() {
    var c = S().combat, g = onGround(), ni = ui.newItem || (ui.newItem = { key: '', qty: 1, hidden: false, to: '' });
    var hands = c.list.filter(function (x) { return x.kind !== 'pc' && !x.dead; });
    if (!hands.some(function (x) { return x.id === ni.to; })) ni.to = '';
    function add() {
      var key = ni.key.trim();
      if (!key) { name.focus(); return; }
      var it = newItem(key, ni.qty, ni.hidden), x = ni.to ? byId(ni.to) : null;
      if (x) { (x.items = x.items || []).push(it); itemNews('**' + x.name + '** has ' + (it.hidden ? itemName(it) + ' (hidden).' : '**' + itemName(it) + '**.'), !it.hidden); }
      else { putDown([it]); itemNews((it.hidden ? 'Hidden on the ground: ' + itemName(it) : 'On the ground: **' + itemName(it) + '**') + '.', !it.hidden); }
      ni.key = ''; ni.qty = 1; ni.hidden = false;   // the next one starts visible
      save(); render();
      var again = $('ref-item-name'); if (again) again.focus();
    }
    var name = el('input', { id: 'ref-item-name', class: 'in', list: 'ref-item-list', value: ni.key, placeholder: 'Any item: pick one or type a name', 'aria-label': 'New item',
      oninput: function () { ni.key = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    var qty = el('input', { type: 'number', class: 'tiny', min: 1, max: 999, value: ni.qty, 'aria-label': 'How many', oninput: function () { ni.qty = clamp(int(this.value, 1), 1, 999); } });
    var to = el('select', { class: 'in mini', 'aria-label': 'Where it goes', title: 'On the ground, or held by a creature', onchange: function () { ni.to = this.value; } },
      [el('option', { value: '', text: 'On the ground' })].concat(hands.map(function (x) { return el('option', { value: x.id, text: 'Held by ' + x.name }); })));
    to.value = ni.to;
    var hid = el('label', { class: 'check', title: 'Players don’t see it, or reach it, until you show it' }, [
      el('input', { type: 'checkbox', checked: !!ni.hidden, onchange: function () { ni.hidden = this.checked; } }), 'Hidden']);
    var rows = g.map(function (it) {
      var who = el('select', { class: 'in mini', 'aria-label': 'Who picks up ' + it.key }, hands.map(function (x) { return el('option', { value: x.id, text: x.name }); }));
      return el('li', { class: 'item-li' + (it.hidden ? ' hid' : '') }, [
        el('span', { class: 'grow' }, [el('b', { text: itemName(it) }), it.by ? el('span', { class: 'fine', text: ' · dropped by ' + it.by }) : null,
          typeof it.ammo === 'number' ? el('span', { class: 'fine', text: ' · ' + it.ammo + ' shots' }) : null]),
        el('button', { type: 'button', class: 'cond' + (it.hidden ? ' on' : ''), 'aria-pressed': it.hidden ? 'true' : 'false', text: it.hidden ? 'Hidden' : 'Visible',
          title: it.hidden ? 'Players can’t see it. Click to show it to them' : 'Players see it and can pick it up. Click to hide it from them',
          onclick: function () { it.hidden = !it.hidden; log('', itemName(it) + (it.hidden ? ' is hidden from the players.' : ' is shown to the players.')); save(); render(); } }),
        el('button', { type: 'button', class: 'pm', text: '−', 'aria-label': 'One fewer ' + it.key, title: 'One fewer', onclick: function () { if (it.qty > 1) it.qty--; else g.splice(g.indexOf(it), 1); save(); render(); } }),
        el('button', { type: 'button', class: 'pm', text: '+', 'aria-label': 'One more ' + it.key, title: 'One more', onclick: function () { it.qty = Math.min(999, it.qty + 1); save(); render(); } }),
        hands.length ? el('span', { class: 'tgt-pick' }, [who, btn('Picks up', function () { var x = byId(who.value); if (x) { creaturePickUp(x, it); save(); render(); } }, 'btn-small btn-ghost', 'That creature picks it up')]) : null,
        el('button', { type: 'button', class: 'x', text: '×', title: 'Remove it from the encounter (destroyed, or carried off)', 'aria-label': 'Remove ' + it.key,
          onclick: function () { g.splice(g.indexOf(it), 1); log('', itemName(it) + ' is gone from the encounter.'); save(); render(); } })
      ]);
    });
    return el('div', { class: 'items-box' }, [
      el('div', { class: 'row center' }, [el('b', { text: 'Unattended items' }),
        el('span', { class: 'fine grow', text: g.length ? plural(g.length, 'item') + ' on the ground' + (g.some(function (it) { return it.hidden; }) ? ' (' + g.filter(function (it) { return it.hidden; }).length + ' hidden from the players)' : '') + '.' :
          'Nothing on the ground. What crows drop lands here, and they can pick up what’s visible (a maneuver, with a free hand).' })]),
      el('datalist', { id: 'ref-item-list' }, Object.keys(CROWS.ITEMS).sort().map(function (k) { return el('option', { value: k }); })),
      el('div', { class: 'row center items-add' }, [field('New item', name, 'grow'), field('How many', qty), field('Where', to), hid, btn('Add item', add, 'btn-small')]),
      rows.length ? el('ul', { class: 'items-list' }, rows) : null
    ]);
  }
  function pcOf(x) { return x && x.kind === 'pc' ? state.party.filter(function (p) { return p.id === x.pcId; })[0] || null : null; }
  function healthWord(x) {
    if (x.dead) return 'dead';
    if (x.st <= 0) return 'down';
    var f = x.st / (x.stMax || 1);
    return f >= 1 ? (x.ad < x.adMax ? 'armor dented' : 'unhurt') : f > 0.5 ? 'hurt' : 'badly hurt';
  }
  /* The fight as the players see it, or null when there's none. */
  function publicCombat() {
    var c = S().combat, run = runningEnc();
    if (!c.list.length) return null;
    return { active: true, round: c.round || 0, first: c.first || null, surprise: c.surprise || 'none', name: run ? run.name || '' : '', showSt: !!c.showSt,
      list: c.list.map(function (x) {
        var b = beast(x.cref), pc = x.kind === 'pc', g = byId(x.grabbedBy), o = { id: x.id, kind: x.kind, name: x.name, health: healthWord(x), dead: !!x.dead,
          conds: Object.keys(x.conds || {}).filter(function (k) { return x.conds[k]; }), surprised: surprised(x), sz: sizeOf(x) };
        if (b && !pc) {
          o.type = b.t; o.size = SIZES[b.sz] || b.sz;
          var t = targetOf(x), t2 = targetOf(x, 2);
          if (t) { o.tgt = t.id; o.tgtName = t.name; }
          if (t2 && t2 !== t) { o.tgt2 = t2.id; o.tgt2Name = t2.name; }
        }
        if (g) { o.grabbedBy = g.id; o.grabbedByName = g.name; }
        if (tauntOn(x)) { o.tauntBy = x.taunt.by; o.tauntName = x.taunt.name; }
        if (x.hidden) o.hidden = true;
        if (x.squeeze) o.squeeze = true;
        if (pc || x.kind === 'ally' || c.showSt) { o.st = x.st; o.stMax = x.stMax; o.ad = x.ad; o.adMax = x.adMax; }
        if (pc) { var p = pcOf(x); o.wounds = x.wounds; o.link = p && p.link || null; o.done = !!c.round && x.done === c.round; o.rxLeft = rxLeft(x); }
        else o.acted = !!c.round && x.acted === c.round;
        var holds = (x.items || []).filter(function (it) { return !it.hidden; });
        if (!pc && holds.length) o.holds = holds.map(itemName);
        return o;
      }),
      items: onGround().filter(function (it) { return !it.hidden; }).map(function (it) {
        var o = { id: it.id, key: it.key, qty: it.qty };
        if (it.by) o.by = it.by;
        return o;
      }),
      given: (c.given || []).slice(-30),
      prompts: (c.prompts || []).filter(function (p) { return !p.done && p.round === c.round; }),
      assists: c.assists || [],
      feed: (c.feed || []).slice(-25) };
  }
  /* Called from save(): publish the fight soon after it changes. */
  function liveChanged() {
    if (live.off || !cloudOn() || !window.CrowsCloud.recordId) return;
    clearTimeout(live.timer);
    live.timer = setTimeout(publish, 250);
  }
  function publish() {
    live.timer = null;
    var cid = window.CrowsCloud.recordId;
    if (!cid) return;
    if (live.busy) { live.again = true; return; }
    var pub = publicCombat(), json = JSON.stringify(pub);
    if (cid === live.cid && json === live.sent) return;
    var members = pub ? pub.list.filter(function (o) { return o.link; }).map(function (o) { return o.link; }) : [];
    live.busy = true; live.again = false;
    window.CrowsCloud.api('POST', 'combat.publish', '', { campaign: cid, combat: pub, members: members }).then(function (j) {
      live.sent = json; live.cid = cid;
      var c = S().combat;
      if (typeof c.lastAct !== 'number') { c.lastAct = j.actions.latest; save(); }   // anything older belongs to an earlier fight
      window.CrowsCloud.watch('cacts', j.actions.watch, c.lastAct, fetchActions);
      if (j.actions.latest > c.lastAct) fetchActions();
    }, function (e) {
      if (e.noApi || e.status === 404 && /Unknown action/.test(e.message)) { live.off = true; return; }   // no server, or an older one
      if (e.status === 404 || e.status === 403 || e.status === 401) return;   // the campaign is gone, or the login is
      setTimeout(liveChanged, 5000);
    }).then(function () { live.busy = false; if (live.again) liveChanged(); });
  }
  /* Bring in the actions players sent since the last one handled here. */
  function fetchActions() {
    var cid = window.CrowsCloud.recordId;
    if (!cid || live.fetching) return;
    live.fetching = true;
    return window.CrowsCloud.api('GET', 'combat.actions', 'campaign=' + cid + '&after=' + (S().combat.lastAct || 0)).then(function (j) {
      if (window.CrowsCloud.recordId !== cid) return;
      var c = S().combat;
      j.items.forEach(function (it) { if (it.id > (c.lastAct || 0)) { c.lastAct = it.id; takeAction(it); } });
      if (j.items.length < 100) c.lastAct = Math.max(c.lastAct || 0, j.latest);
      window.CrowsCloud.watch('cacts', j.watch, c.lastAct, fetchActions);
      if (j.items.length) { save(); if (!window.CrowsCloud.typing) render(); }
    }).then(function () { live.fetching = false; }, function () { live.fetching = false; });
  }
  var MANEUVER_NOTES = { 'Move': 'moves', 'Shift': 'shifts (no opportunity attacks)', 'Stand Up': 'stands up', 'Draw From Belt': 'draws from their belt',
    'Draw From Pack': 'draws from their pack', 'Pick Up Item': 'picks up an item', 'Dump Backpack': 'dumps their backpack', 'Reload': 'reloads',
    'Command Pet': 'commands their pet', 'Jump': 'jumps' };
  function takeAction(it) {
    var a = it.action || {}, c = S().combat;
    var p = it.link ? state.party.filter(function (x) { return x.link === it.link; })[0] : null;
    var me = p ? c.list.filter(function (x) { return x.kind === 'pc' && x.pcId === p.id; })[0] : null;
    if (!me) return;   // not in this fight (any more)
    var who = me.name;
    if (a.type === 'done' || a.type === 'undone') {
      me.done = a.type === 'done' ? c.round : 0;
      feed('**' + who + '** ' + (a.type === 'done' ? 'is done for round ' + c.round + '.' : 'isn’t done yet.'));
      return;
    }
    if (a.type === 'assistUsed') { c.assists = (c.assists || []).filter(function (x) { return x.id !== a.text; }); return; }
    if (a.type === 'drop') {
      var put = (a.items || []).map(function (x) { return newItem(x.key, x.qty, false, x); });
      putDown(put, who);
      itemNews('**' + who + '** ' + (a.dump ? 'dumps their backpack: ' : 'drops ') + '**' + itemsText(put) + '**.', true);
      return;
    }
    if (a.type === 'pickup') {
      var gi = onGround().filter(function (x) { return x.id === a.item && !x.hidden; })[0];
      if (!gi) { itemNews('**' + who + '** reaches for ' + (a.itemName || 'an item') + ', but it’s not there any more.', true); return; }
      var one = { id: 'g' + it.id, to: p.link, item: gi.id, key: gi.key, qty: 1 };   // it.id: this action's id, unique on the server
      ['ud', 'dmg', 'ammo'].forEach(function (k) { if (typeof gi[k] === 'number') one[k] = gi[k]; });
      if (gi.qty > 1) gi.qty--; else onGround().splice(onGround().indexOf(gi), 1);
      (c.given = c.given || []).push(one);
      if (c.given.length > 30) c.given.splice(0, c.given.length - 30);
      itemNews('**' + who + '** picks up **' + gi.key + '**' + (onGround().indexOf(gi) >= 0 ? ' (' + gi.qty + ' left on the ground)' : '') + '.', true);
      return;
    }
    var tlist = (a.targets && a.targets.length ? a.targets : a.target ? [{ id: a.target, name: a.targetName }] : [])
      .map(function (t) { var x = byId(t.id); return x ? { x: x, name: x.name } : { x: null, name: t.name || '' }; });
    var tgt = tlist[0] && tlist[0].x, tname = tlist.map(function (t) { return t.name; }).filter(Boolean).join(', ');
    var act = { id: it.id, who: who, type: a.type, target: tgt ? tgt.id : null, tname: tname, round: c.round, applied: false, text: a.text || '', from: me.id,
      label: a.label || a.name || '', tier: a.tier, crit: !!a.crit, doom: !!a.doom, rxn: !!a.rxn }, line;
    if (a.rxn) useRx(me);
    if (a.prompt) (c.prompts || []).forEach(function (q) { if (q.id === a.prompt) q.done = true; });
    if (a.type === 'attack') {
      act.damage = a.damage; act.piercing = !!a.piercing; act.melee = !!a.melee; act.ranged = !!a.ranged; act.allyDamage = a.allyDamage || 0;
      act.allyDamage2 = a.allyDamage2 || 0; act.rank = a.rank || 0; act.backlash = !!a.backlash; act.dismember = !!a.dismember;
      act.items = tlist.filter(function (t) { return t.x; }).map(function (t) {
        var f = { id: t.x.id, damage: a.damage || 0, piercing: !!a.piercing, heal: a.heal || 0, ad: a.ad || 0, wounds: a.healWounds || 0, conds: {} };
        (a.conds || []).forEach(function (k) { if (k !== 'Prone' || !a.condMaxSize || noBigger(t.x, a.condMaxSize)) f.conds[k] = true; });
        return f;
      });
      var effects = [a.damage ? a.damage + (a.piercing ? ' piercing' : '') + ' damage' : '', a.heal ? 'regains ' + a.heal + ' Stamina' : '', a.ad ? '+' + a.ad + ' AD' : '',
        a.healWounds ? 'heals ' + plural(a.healWounds, 'wound') : '', (a.conds || []).length ? (a.conds || []).join(' and ').toLowerCase() : '', a.push ? 'push ' + a.push : ''].filter(Boolean);
      line = '**' + who + '**' + (a.rxn ? ' (reaction)' : '') + ': ' + (a.label || 'attack') + (tname ? ' → **' + tname + '**' : '') + ': tier ' + a.tier + (a.crit ? ' (crit)' : a.doom ? ' (doom)' : '') +
        (effects.length ? ', ' + effects.join(', ') + '.' : a.tier === 1 && !a.cast ? ', a miss.' : '.') + (a.text ? ' ' + a.text : '');
      if (!act.items.some(function (f) { return f.damage || f.heal || f.ad || f.wounds || Object.keys(f.conds).length; })) act.items = [];
    } else if (a.type === 'maneuver') {
      var n = a.name || 'Maneuver', rolled = a.tier > 0, res = '';
      act.label = n; act.items = [];
      if (n === 'Grab' && tgt) {
        if (!noBigger(tgt, 'M')) res = tgt.name + ' is too big to grab';
        else if (a.tier > 1) { res = a.tier === 2 ? 'grabbed (push 1 or ' + who + ' shifts)' : 'grabbed'; act.items.push({ id: tgt.id, grab: me.id }); }
        else { res = 'fails; ' + tgt.name + ' may counter'; act.counterable = true; }
      } else if (n === 'Knockback' && tgt) {
        if (!noBigger(tgt, 'M')) res = tgt.name + ' is too big to knock back';
        else if (a.tier > 1) res = tgt.name + ' pushed ' + (a.tier === 2 ? '1 square' : '2 squares');
        else { res = 'fails; ' + tgt.name + ' may counter'; act.counterable = true; }
      } else if (n === 'Escape Grab') {
        var g = byId(me.grabbedBy);
        if (a.tier > 1) { res = a.tier === 2 ? 'breaks free' + (g ? ', but ' + g.name + ' may counter' : '') : 'breaks free and moves 1 square'; act.items.push({ id: me.id, conds: { Grabbed: false } }); }
        else res = 'still grabbed';
        if (a.tier === 2 && g) { act.target = g.id; act.tname = g.name; act.counterable = true; }
      } else if (n === 'Stand Up') { act.items.push({ id: me.id, conds: { Prone: false } }); res = 'stands up'; }
      else if (n === 'Jump') res = a.tier === 1 ? 'jumps 0 squares' : a.tier === 2 ? 'jumps up to 2 squares (1 high)' : 'jumps up to ' + (a.jump || 3) + ' squares (1 high)';
      else res = MANEUVER_NOTES[n] || 'acts';
      line = '**' + who + '** ' + n + (tgt && n !== 'Escape Grab' ? ' → **' + tgt.name + '**' : '') + (rolled ? ' (tier ' + a.tier + (a.crit ? ', crit' : a.doom ? ', doom' : '') + ')' : '') + ': ' + res + '.' + (a.text ? ' ' + a.text : '');
    } else if (a.type === 'taunt' && tgt) {
      tgt.taunt = { by: me.id, name: who, round: c.round };
      line = '**' + who + '** taunts **' + tgt.name + '**: until ' + who + '’s next turn, its attacks that don’t include ' + who + ' take a bane.';
    } else if (a.type === 'assist') {
      var to = byId(a.assistTo);
      if (to) (c.assists = c.assists || []).push({ id: 'as' + it.id, to: to.id, toName: to.name, from: me.id, fromName: who, bonus: a.bonus | 0, round: c.round });
      line = '**' + who + '** assists **' + (to ? to.name : 'an ally') + '** (tier ' + a.tier + '): ' + signed(a.bonus | 0) + ' to their next test this turn.' + (a.text ? ' ' + a.text : '');
    } else if (a.type === 'ready') line = '**' + who + '** readies an action: ' + (a.text || '(no trigger given)') + '.';
    else line = '**' + who + '**' + (tname ? ' → **' + tname + '**' : '') + ': ' + (a.text || 'acts.');
    c.acts = (c.acts || []).concat([act]).slice(-30);
    log('', line); feed(line);
    if (act.items && act.items.length && c.auto !== false) applyAct(act);
  }
  /*
   * What the rules let happen after a player's action, as buttons on it: the target counters a melee miss or a failed
   * Grab/Knockback (its melee attack's tier 2 damage, tier 3 on a doom; it needs a reaction left), the grabber counters an
   * escape at tier 2, a ranged miss next to allies may hit one (odd on any die: the weapon's tier 2 damage; a doom: tier
   * 3), a doom casting or chaos roll of 1 is a backlash (d100 + the spell's rank), and a crit with a Dismember weapon
   * takes a limb (d6). Each hit can be undone like any other.
   */
  function doomOptions(a) {
    var c = S().combat, out = [], tgt = byId(a.target), crow = byId(a.from);
    if (a.type !== 'attack' && a.type !== 'maneuver') return out;
    if (a.counter) out.push(el('span', { class: 'fine', text: 'Counter:' }), hitControls(a.counter));
    else if (((a.type === 'attack' && a.melee && a.tier === 1) || a.counterable) && tgt && !tgt.dead && crow && tgt.kind !== 'pc') {
      var cd = counterDamage(tgt, a.doom);
      if (cd) out.push(rxLeft(tgt) > 0 ? btn(tgt.name + ' counters (' + cd.n + ')', function () { a.counter = counterAct(tgt, crow, a.doom); save(); render(); },
        'btn-small', 'A counter (reaction): its melee attack’s tier 2 damage, tier 3 on a doom') : el('span', { class: 'fine', text: tgt.name + ' has no reaction left to counter.' }));
    }
    if (a.stray) out.push(el('span', { class: 'fine', text: 'Stray shot:' }), hitControls(a.stray));
    else if (a.type === 'attack' && a.ranged && a.tier === 1 && (a.doom ? a.allyDamage : a.allyDamage2) && !a.strayRolled) {
      var allies = c.list.filter(function (x) { return !x.dead && x.kind !== 'foe' && x.id !== a.from; });
      if (allies.length) out.push(btn(a.doom ? 'Hit a random ally (' + a.allyDamage + ')' : 'Ally next to the target? Roll (odd: ' + a.allyDamage2 + ')', function () {
        var roll = a.doom ? 1 : d(6);
        if (!(roll % 2)) { a.strayRolled = 'd6 = ' + roll + ': even, no ally is hit.'; log('', a.who + '’s miss: ' + a.strayRolled); save(); render(); return; }
        var hit = pick(allies), n = a.doom ? a.allyDamage : a.allyDamage2;
        a.stray = { who: a.who, label: 'stray shot', items: [{ id: hit.id, damage: n }], applied: false };
        log('', (a.doom ? 'Ranged doom' : 'Ranged miss, d6 = ' + roll) + ': **' + a.who + '** hits **' + hit.name + '** instead (random ally next to the target).');
        feed('**' + a.who + '**’s shot hits **' + hit.name + '** instead: ' + n + ' damage.');
        applyAct(a.stray);
      }, 'btn-small', 'A ranged miss with allies next to the target: odd on any die hits a random one for the weapon’s tier 2 damage; a doom hits one for tier 3. You decide who was adjacent.'));
    }
    if (a.strayRolled) out.push(el('span', { class: 'fine', text: a.strayRolled }));
    if (a.backlashText) out.push(el('span', { class: 'fine', text: a.backlashText }));
    else if (a.backlash) out.push(btn('Roll backlash (d100 + ' + a.rank + ')', function () {
      var r = d100().total, n = r + a.rank, what = rollInText(lookup(REF.BACKLASH, n)[2]);   // rolled once, shown everywhere
      a.backlashText = 'Backlash ' + r + ' + ' + a.rank + ' = ' + n + ': ' + what;
      ui.dice = { label: a.who + ': backlash', text: a.backlashText };
      log('', '**' + a.who + '** suffers a backlash: d100 ' + r + ' + rank ' + a.rank + ' = ' + n + '. ' + what);
      feed('**' + a.who + '** suffers a backlash: ' + what);
      save(); render();
    }, 'btn-small btn-primary', REF.BACKLASH_RULES));
    if (a.limbText) out.push(el('span', { class: 'fine', text: a.limbText }));
    else if (a.dismember && a.crit && tgt) out.push(btn('Dismember (d6)', function () {
      var r = d(6), limb = r <= 2 ? 'an arm (' + a.who + ' picks): it drops what it held, lets go of grabs, and attacks with it deal 1 less damage' :
        r <= 4 ? 'a leg: its speed drops in proportion (no legs: speed 0, can’t stand)' : r === 5 ? 'an arm or a leg (' + a.who + '’s choice)' : 'its head: it dies';
      a.limbText = 'Dismember d6 = ' + r + ': ' + tgt.name + ' loses ' + limb + '.';
      if (r === 6) { tgt.dead = true; tgt.st = 0; }
      log('', a.limbText); feed('**' + tgt.name + '** loses ' + limb.replace(/ \(.*?\)/, '') + '.');
      save(); render();
    }, 'btn-small btn-primary', 'Dismember: a crit removes a limb. Creatures with no clear anatomy take double crit damage instead (your call).'));
    if (a.doom && !out.length) out.push(el('span', { class: 'fine', text: 'Doom: tier 1 and a major setback (your call).' }));
    return out;
  }
  /* Under the combat tracker: who sees the fight, the players' latest actions, open reaction prompts, and assists. */
  function livePanel() {
    if (!cloudOn()) return null;
    var c = S().combat, crows = c.list.filter(function (x) { var p = pcOf(x); return p && p.link; }).length, acts = (c.acts || []).slice(-8).reverse();
    var open = (c.prompts || []).filter(function (p) { return !p.done && p.round === c.round; });
    return el('div', { class: 'live-box' }, [
      el('div', { class: 'row center' }, [
        el('b', { text: 'Players' }),
        el('span', { class: 'fine grow', text: !c.list.length ? 'Players see the fight on their Play page once their linked crows are in the tracker.' :
          crows ? plural(crows, 'linked crow') + ' in this fight: their players see it live and act from their Play page.' : 'No linked crows in this fight, so no player sees it. Link crows in the Party tab.' }),
        chk(c, 'auto', 'Apply their actions automatically', { title: 'Off: each hit, heal, grab, or condition waits here until you apply it' }),
        chk(c, 'showSt', 'Show foes’ Stamina and AD', { title: 'Off: players only see how hurt each foe looks' })]),
      open.length ? el('div', { class: 'fine' }, ['Waiting on reactions: ' + open.map(function (p) { var to = byId(p.to); return (to ? to.name : 'a crow') + ' may counter ' + p.fromName; }).join('; ') + ' (until the end of the round).']) : null,
      (c.assists || []).length ? el('div', { class: 'fine' }, ['Assists: ' + c.assists.map(function (x) { return x.fromName + ' → ' + x.toName + ' ' + signed(x.bonus); }).join('; ') + '.']) : null,
      acts.length ? el('ul', { class: 'live-acts' }, acts.map(function (a) {
        var items = fxItems(a), what = a.type === 'attack' ? 'tier ' + a.tier + (a.damage ? ', ' + a.damage + (a.piercing ? ' piercing' : '') + ' damage' : '') :
          a.type === 'maneuver' ? (a.tier ? 'tier ' + a.tier : '') + (a.text ? ' ' + a.text : '') : a.text;
        return el('li', null, [
          el('span', { class: 'log-t', text: a.round ? 'R' + a.round : '' }),
          el('span', { class: 'grow' }, [rich('**' + a.who + '**' + (a.label ? ': ' + a.label : a.type === 'taunt' ? ': Taunt' : a.type === 'assist' ? ': Assist' : '') + (a.tname ? ' → ' + a.tname : '') + (what ? ' · ' + what : '') + (a.rxn ? ' (reaction)' : ''))]),
          a.doom ? el('span', { class: 'chip warn', text: 'doom' }) : a.crit ? el('span', { class: 'chip ok', text: 'crit' }) : null,
          items.length ? hitControls(a) : null].concat(doomOptions(a)));
      })) : null
    ]);
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
    s.combat.list.forEach(function (c) { REF.END_OF_DT_CONDITIONS.forEach(function (k) { if (c.conds[k]) { delete c.conds[k]; cleared.push(c.name + ' ' + k.toLowerCase()); } }); });
    activePCs().forEach(function (p) { sheetOp(p, { endConds: true }); });   // and on linked crows' sheets
    log('', 'Rest halfway: effects lasting to the end of the DT, and DT-rolled usage-dice effects, end.' + (cleared.length ? ' Ended: ' + cleared.join(', ') + '.' : ''));
    save(); render();
  }
  function finishRest() {
    var s = S(), applied = [];
    activePCs().forEach(function (p) {
      var xp = s.rest.applyXP && p.pending;
      if (xp) applied.push((p.name || 'Crow') + ' +' + fmt(p.pending));
      sheetOp(p, { full: true, wounds: p.wounds > 0 ? -1 : 0, apply: !!xp, endConds: true, dt: s.dt });   // the rest used up DT s.dt
    });
    s.combat.list.forEach(function (c) { c.used = {}; if (c.kind === 'pc') { var p = state.party.filter(function (x) { return x.id === c.pcId; })[0]; if (p) { c.st = p.st; c.wounds = p.wounds; } } });
    log('dt', '**Rest complete.** Crows regain all Stamina, heal 1 wound, and regain expertise uses' + (s.rest.where === 'outdoors' && state.travel.inMiasma ? ' (NOT in the Miasma: no expertise uses; roll Miasma RRs)' : '') +
      '. Spellbook UD restored. Each crow ate a ration (or takes a starvation wound).' + (applied.length ? ' XP applied: ' + applied.join(', ') + '.' : ''));
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

  // ------------------------------------------------------------------ import a character file from the character generator
  function importCharacter(s) {
    var pc = pcFromSave(s);
    var existing = state.party.filter(function (p) { return p.name && p.name === pc.name; })[0];
    if (existing) {
      pc.id = existing.id; pc.miasma = existing.miasma || []; pc.ad = existing.ad || 0;
      if (existing.link) { pc.link = existing.link; pc.owner = existing.owner; }
      state.party[state.party.indexOf(existing)] = pc;
      return pc.name + ' (updated)';
    }
    state.party.push(pc);
    return pc.name || 'a crow';
  }
  /* A party entry built from a Character Generator save. */
  function pcFromSave(s) {
    if (!s || s.v !== 1 || typeof s.bg !== 'number' || !REF.BACKGROUNDS[s.bg]) throw new Error('not a Crows character file');
    var bg = REF.BACKGROUNDS[s.bg], two = bg[1].indexOf(s.twoChar) >= 0 ? s.twoChar : bg[1][0];
    var others = REF.CHARS.filter(function (c) { return c !== two; });
    var high = others.indexOf(s.highChar) >= 0 ? s.highChar : others[0], low = others[0] === high ? others[1] : others[0];
    var v = {}; v[two] = 2;
    if (s.pattern === 'm12') { v[high] = 2; v[low] = -1; } else { v[high] = 1; v[low] = 0; }
    var extra = 0;
    (s.charBonus || []).forEach(function (c) { if (!c) return; if (REF.CHARS.every(function (k) { return v[k] >= 4; })) { extra += 2; return; } if (v[c] < 4) v[c]++; });
    var stMax = bg[2] + extra;
    (s.esBonus || []).forEach(function (o) { if (o === 'stamina') stMax += 2; else if (o === 'mix') stMax += 1; });
    var play = s.play || {};
    var pc = { id: nid(), name: s.name || '', player: s.player || '', bg: bg[0], feature: s.feature || '', A: v.Agility, M: v.Mind, S: v.Strength,
      stMax: stMax, st: typeof play.stamina === 'number' ? clamp(play.stamina, 0, stMax) : stMax, ad: 0,
      wounds: play.wounds ? Object.keys(play.wounds).length : 0, cruelty: play.cruelty | 0, txp: s.txp | 0, pending: play.pendingXP | 0,
      status: 'active', conn: s.connName || '', rel: s.connRel || '', benefit: s.connBenefit || '', miasma: [], notes: s.notes || '',
      conds: play.conds && typeof play.conds === 'object' && !Array.isArray(play.conds) ? clone(play.conds) : {} };
    return pc;
  }

  // ------------------------------------------------------------------ crows linked to a player's account
  /*
   * A player can share a character with a link (from their character list). Added here, the crow stays tied
   * to the player's sheet: Party status shows its live vitals, "Open sheet" shows the whole thing, where the Ref
   * can change the vitals, equipment, and notes, and the party entry refreshes from the sheet about a second
   * after the player changes it. Combat, rests, Miasma RRs, and XP awards here reach the sheet too (sheetOp).
   * Needs the Ref to be logged in on the hosted site.
   */
  function cloudOn() { return !!(window.CrowsCloud && window.CrowsCloud.active); }
  function linkToken(text) { var m = /(?:share=|addlink=)?([0-9a-f]{64})/.exec(String(text || '').trim()); return m ? m[1] : null; }
  /* Add or refresh a linked crow from the server's copy. Ref-side bookkeeping (status, AD, Miasma, Ref notes) is kept. */
  function linkPC(item) {
    var pc = pcFromSave(item.data), existing = state.party.filter(function (p) { return p.link === item.id; })[0];
    pc.link = item.id; pc.owner = item.owner || '';
    if (existing) {
      ['id', 'status', 'ad', 'miasma', 'notes', 'owed'].forEach(function (k) { if (k in existing) pc[k] = existing[k]; });
      (pc.owed || []).forEach(function (o) { applyOp(pc, o); });
      // A crow already in the combat tracker picks up the sheet's Stamina and wounds.
      if (S() && S().combat) S().combat.list.forEach(function (c) {
        if (c.kind !== 'pc' || c.pcId !== pc.id) return;
        c.st = Math.min(pc.st, c.stMax); c.wounds = pc.wounds; c.conds = clone(pc.conds || {});
        if (!c.conds.Grabbed) delete c.grabbedBy;
      });
      state.party[state.party.indexOf(existing)] = pc;
      if (S() && S().combat) S().combat.list.forEach(function (c) { if (c.kind === 'pc' && c.pcId === pc.id) pullVitals(c); });
    } else state.party.push(pc);
    watchLinked(item);
    return pc;
  }
  /* Refresh the party entry soon after the player's sheet changes (not while the Ref is typing). */
  function watchLinked(item) {
    var C = window.CrowsCloud, key = 'link-' + item.id;
    if (!C || !C.watch) return;
    C.watch(key, item.watch, item.version, function () {
      var p = state.party.filter(function (x) { return x.link === item.id; })[0];
      if (!p) { C.watch(key, null); return; }
      if (C.typing) return;
      return refreshLinked(p, true);
    });
  }
  function addFromLink(text) {
    var tok = linkToken(text);
    if (!tok) { toast('That doesn\'t look like a character link. Ask the player to copy it again from their character list.'); return Promise.resolve(); }
    return window.CrowsCloud.api('POST', 'link.redeem', '', { token: tok }).then(function (j) {
      var pc = linkPC(j.item);
      log('', 'Added ' + (pc.name || 'a crow') + ' (' + pc.owner + '\u2019s character) to the party.');
      save(); render(); toast('Added ' + (pc.name || 'the crow') + '.');
    }, function (e) { toast(e.message); });
  }
  function refreshLinked(p, quiet) {
    return window.CrowsCloud.api('GET', 'link.get', 'id=' + p.link).then(function (j) {
      linkPC(j.item); save(); render(); if (!quiet) toast('Updated ' + (j.item.name || 'the crow') + ' from the sheet.');
    }, function (e) {
      if (e.status === 404) window.CrowsCloud.watch('link-' + p.link, null);
      if (!quiet || e.status === 404) toast((p.name || 'A crow') + ': ' + e.message);
    });
  }
  function unlinkPC(p, quietly) {
    var id = p.link;
    if (window.CrowsCloud) window.CrowsCloud.watch('link-' + id, null);
    delete p.link; delete p.owner; save(); render();
    if (cloudOn()) window.CrowsCloud.api('POST', 'link.remove', '', { id: id }).then(function () { if (!quietly) toast('Unlinked. The crow stays in the party as a copy.'); }, function () { /* already gone */ });
  }
  /*
   * The Ref changing a crow's sheet numbers (XP, Stamina, wounds, cruelty, the end of a DT or a rest; see CrowsPlay.refChange): the party
   * entry changes at once, and a linked crow's change goes onto the player's sheet through its Party status frame.
   * If that frame isn't loaded yet, the change waits in p.owed and is delivered as soon as the frame reports in;
   * until then it's replayed over each refresh from the sheet, so it doesn't flicker away.
   */
  function applyOp(p, o) {
    if (o.xp) p.pending = (p.pending || 0) + o.xp;
    if (o.apply) { p.txp = (p.txp || 0) + (p.pending || 0); p.pending = 0; }
    if (o.full) p.st = p.stMax;
    if (o.st) p.st = clamp((p.st || 0) + o.st, 0, p.stMax);
    if (o.wounds) p.wounds = clamp((p.wounds || 0) + o.wounds, 0, 10);
    if (o.cruelty) p.cruelty = Math.max(0, (p.cruelty || 0) + o.cruelty);
    if (typeof o.setCruelty === 'number') p.cruelty = o.setCruelty;
    if (o.cond) { p.conds = p.conds || {}; Object.keys(o.cond).forEach(function (k) { if (o.cond[k]) p.conds[k] = true; else delete p.conds[k]; }); }
  }
  function sheetWin(p) {
    var f = p.link && statusFrames[p.link];
    // Only once the player's character is in the frame (before that it holds this browser's own character).
    try { var w = f && f.frame.contentWindow; return w && w.CrowsPlay && w.CrowsPlay.refChange && w.CrowsRefView && w.CrowsRefView.loaded ? w : null; } catch (e) { return null; }
  }
  function sheetOp(p, o) {
    applyOp(p, o);
    if (!p.link || !cloudOn()) return;
    (p.owed = p.owed || []).push(o);
    flushOps(p);
  }
  function flushOps(p) {
    var w = sheetWin(p);
    if (!w || !p.owed || !p.owed.length) return;
    p.owed.forEach(function (o) { w.CrowsPlay.refChange(o); });
    delete p.owed; save();
  }
  function openSheet(p) { window.open('play?link=' + encodeURIComponent(p.link), '_blank', 'noopener'); }
  /* Play a linked crow yourself, as if its player had handed it to you (they're told, and can take it back). */
  function takeControl(p) {
    if (!confirm('Take control of ' + (p.name || 'this crow') + '? You can open, edit, and play the whole sheet until ' + (p.owner || 'the player') +
      ' takes it back. They\u2019re told. Hand it back from Handed to you in My characters.')) return;
    var w = window.open('', '_blank');   // opened now, while the click still counts, so it isn't blocked as a pop-up
    window.CrowsCloud.api('POST', 'control.claim', '', { id: p.link }).then(function (j) {
      if (w) w.location.href = new URL('play?id=' + j.characterId, location.href).href; else toast('You have control of ' + (p.name || 'the crow') + '. Open it from My characters.');
    }, function (e) { if (w) w.close(); toast(e.message); });
  }
  function takeBtn(p) { return btn('Take control', function () { takeControl(p); }, 'btn-small btn-ghost', 'Play this crow yourself, say for a session its player will miss'); }
  function newPC() { return { id: nid(), name: '', player: '', bg: '', feature: '', A: 0, M: 0, S: 0, stMax: 7, st: 7, ad: 0, wounds: 0, cruelty: 0, txp: 0, pending: 0, status: 'active', conn: '', rel: '', benefit: '', miasma: [], notes: '' }; }

  // ================================================================== RENDERING
  function setTab(t) { tab = t; document.body.setAttribute('data-tab', t); if (window.CrowsLayout) window.CrowsLayout.apply(); try { localStorage.setItem(TAB_KEY, t); } catch (e) { /* ignore */ } render(); window.scrollTo(0, 0); }
  function renderTabbar() {
    var bar = $('tabbar'); bar.innerHTML = '';
    TABS.forEach(function (t) {
      var badge = null;
      if (t[0] === 'session' && (S().pending || S().combat.list.some(function (c) { return !c.dead && c.kind === 'foe'; }))) badge = el('span', { class: 'badge', text: S().pending ? '!' : '⚔' });
      if (t[0] === 'encounters' && runningEnc()) badge = el('span', { class: 'badge', text: '⚔', title: 'An encounter is running' });
      if (t[0] === 'party' && inv.requests.length && inv.id === (window.CrowsCloud && window.CrowsCloud.recordId)) badge = el('span', { class: 'badge', text: String(inv.requests.length), title: 'Join requests waiting' });
      bar.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': tab === t[0] ? 'true' : 'false', onclick: function () { setTab(t[0]); } }, [t[1], badge]));
    });
    $('camp-name').textContent = state.name || state.village.name || '';
  }
  var layoutFitQueued = false;
  function render() {
    // A fight with linked crows needs their sheets loaded (Party status), whichever tab is open: hits land there.
    if (tab !== 'party' && cloudOn() && S().combat.list.some(function (x) { var p = pcOf(x); return p && p.link; })) renderStatus();
    renderTabbar();
    renderSide();
    if (window.CrowsLayout && !layoutFitQueued) { layoutFitQueued = true; requestAnimationFrame(function () { layoutFitQueued = false; window.CrowsLayout.fit(); }); }
    ({ session: renderSession, encounters: renderEncounters, travel: renderTravel, village: renderVillage, party: renderParty, world: renderWorld, bestiary: renderBestiary, tables: renderTables, rules: renderRules })[tab]();
    tick();
  }

  // ------------------------------------------------------------------ sidebar
  function renderSide() {
    var s = S();
    $('side-timer').innerHTML = '';
    $('side-timer').appendChild(el('div', null, [
      el('h3', { text: (s.rest.active ? 'Resting · ' : '') + 'Dungeon turn ' + s.dt + (greedBonus() ? ' · greed +' + greedBonus() + '%' : '') }),
      el('div', { class: 'row center' }, [el('div', { 'data-clock': '1', class: 'clock' }), el('span', { class: 'spacer' }),
        s.mode === 'timer' ? (s.running ? btn('Pause', pauseTimer, 'btn-small') : btn('Start', startTimer, 'btn-small btn-primary')) : btn('+1 room', function () { s.roomsDone++; save(); render(); }, 'btn-small'),
        btn('End DT', endDT, 'btn-small', 'Roll usage dice, end DT conditions, and make the encounter check')]),
      el('div', { class: 'meter', 'data-meter': '1' }, [el('span')]),
      s.pending ? el('div', { class: 'pending' }, [el('b', { text: 'Encounter due this DT: ' }), pendingText(s.pending)]) : null
    ]));

    var dc = state.dice, box = $('side-dice'); box.innerHTML = '';
    var res = null;
    if (ui.dice) {
      var r = ui.dice;
      res = el('div', { class: 'result' }, [el('div', { class: 'r-head', text: r.label }),
        r.r ? el('div', null, [el('div', { class: 'r-roll', text: testLine(r.r) }), tierChip(r.r), r.dmg ? el('div', null, [el('b', { text: r.dmg })]) : null, r.note ? el('div', { class: 'fine', text: r.note }) : null, hitControls(r.hit)].concat((r.counters || []).map(function (k) {
            if (k.act) return el('div', null, [el('span', { class: 'fine', text: k.by.name + '\u2019s counter: ' }), hitControls(k.act)]);
            var cd = counterDamage(k.by, k.doom);
            return cd && rxLeft(k.by) > 0 && !k.by.dead ? btn(k.by.name + ' counters ' + k.vs.name + ' (' + cd.n + ')', function () { k.act = counterAct(k.by, k.vs, k.doom); save(); render(); }, 'btn-small', 'A counter (reaction): its melee attack\u2019s tier 2 damage, tier 3 on a doom') : null;
          })))
          : el('div', null, [el('b', { text: r.text })])]);
    }
    box.appendChild(el('div', null, [
      el('h3', { text: 'Dice' }),
      el('div', { class: 'row center' }, [field('Bonus', inp(dc, 'mod', { type: 'number', min: -10, max: 20, class: 'tiny' }, { dflt: 0 })), segEB(dc, 'net')]),
      el('div', { class: 'btn-row' }, [
        el('button', { type: 'button', class: 'btn btn-primary', style: 'grid-column: span 2', text: 'Test 2d10', onclick: function () {
          var r = test(dc.mod, dc.net); ui.dice = { label: 'Test' + (dc.mod ? ' ' + signed(dc.mod) : ''), r: r };
          log('', 'Test: ' + testLine(r) + ' → **T' + r.tier + '**.'); render();
        } }),
        diceBtn('d6', '1d6'), diceBtn('d10', '1d10'), diceBtn('2d6', '2d6'), diceBtn('3d6', '3d6'), diceBtn('d100', 'd100'),
        el('button', { type: 'button', class: 'btn', text: 'Initiative', title: 'Each round a player rolls 1d10: 6+ means crows and allies act first', onclick: rollInitiative })
      ]),
      el('div', { class: 'row center', style: 'margin-top:.4rem' }, [
        inp(dc, 'expr', { class: 'in', style: 'width:7rem', 'aria-label': 'Dice expression' }),
        btn('Roll', function () { var r = rollDice(dc.expr || '1d6'); ui.dice = { label: dc.expr, text: r.detail + ' = ' + r.total }; log('', 'Rolled ' + r.detail + ' = **' + r.total + '**.'); render(); }, 'btn-small'),
        inp(dc, 'ud', { type: 'number', min: 1, max: 12, class: 'tiny', 'aria-label': 'Usage dice count', title: 'Usage dice' }, { dflt: 1 }),
        btn('UD', function () {
          var rolls = [], keep = 0; for (var i = 0; i < dc.ud; i++) { var x = d(6); rolls.push(x); if (x > 2) keep++; }
          ui.dice = { label: 'Usage dice ×' + dc.ud, text: '[' + rolls.join(', ') + '] → ' + keep + ' UD left' + (keep ? '' : ' (effect ends / item used up)') };
          log('', 'Usage dice ' + dc.ud + ' [' + rolls.join(', ') + '] → **' + keep + ' left**.'); render();
        }, 'btn-small', 'Roll usage dice: each 1-2 is removed')
      ]),
      res
    ]));
    renderSideLog();
    renderInvite();
  }
  /* What an action does, in words: "5 damage, prone", "regains 4 Stamina", "grabbed". */
  function fxText(items) {
    var f = items[0] || {}, parts = [];
    if (f.damage) parts.push(f.damage + (f.piercing ? ' piercing' : '') + ' damage');
    if (f.heal) parts.push('+' + f.heal + ' Stamina');
    if (f.ad) parts.push('+' + f.ad + ' AD');
    if (f.wounds) parts.push('heal ' + plural(f.wounds, 'wound'));
    if (f.conds) Object.keys(f.conds).forEach(function (k) { parts.push((f.conds[k] ? '' : 'not ') + k.toLowerCase()); });
    if (f.grab) parts.push('grabbed');
    return parts.join(', ') || 'effect';
  }
  /* An action's effects (an attack, a counter, a stray shot, a heal, a grab): dealt, with Undo, or waiting for Apply. */
  function hitControls(h) {
    var items = h ? fxItems(h).filter(function (f) { return byId(f.id); }) : [];
    if (!items.length) return null;
    var names = items.map(function (f) { return byId(f.id).name; }).join(', '), what = fxText(items);
    return el('span', { class: 'row center hit-ctl' }, h.applied ? [el('span', { class: 'chip ok', text: what + ' \u2192 ' + names }), btn('Undo', function () { undoAct(h); }, 'btn-small btn-ghost', 'Put ' + names + ' back as they were (Stamina, AD, wounds, conditions)')]
      : [btn('Apply ' + what + ' \u2192 ' + names, function () { applyAct(h); }, 'btn-small btn-primary', 'Deal it (damage goes through AD first, then Stamina, then wounds)')]);
  }
  function diceBtn(label, expr) {
    return btn(label, function () {
      var r = expr === 'd100' ? d100() : rollDice(expr);
      ui.dice = { label: label, text: r.detail + ' = ' + r.total }; log('', 'Rolled ' + r.detail + ' = **' + r.total + '**.'); render();
    });
  }
  function d100() { var a = d(10), b = d(10), v = (a % 10) * 10 + (b % 10); if (v === 0) v = 100; return { total: v, detail: 'd100 [' + (a % 10) + ', ' + (b % 10) + ']' }; }
  function rollInitiative() {
    var r = d(10), first = r >= 6;
    var c = S().combat, fresh = !c.round; c.round = (c.round || 0) + (c.round ? 0 : 1); c.first = first ? 'crows' : 'foes'; if (fresh) newRound(c);
    feed('Initiative for round ' + c.round + ': **' + (first ? 'crows and allies first' : 'enemies first') + '**.');
    ui.dice = { label: 'Initiative (round ' + c.round + ')', text: '1d10 = ' + r + ': ' + (first ? 'crows and allies act first' : 'enemies act first') };
    log('', 'Initiative for round ' + c.round + ': 1d10 = ' + r + ' → **' + (first ? 'crows and allies first' : 'enemies first') + '**.');
    save(); render();
  }
  function renderSideLog() {
    var box = $('side-log'); box.innerHTML = '';
    var list = el('ol'), recent = state.log.slice(-14).reverse();
    recent.forEach(function (e) { list.appendChild(logItem(e)); });
    box.appendChild(el('div', null, [el('div', { class: 'row center' }, [el('h3', { text: 'Log' }), el('span', { class: 'spacer' }), el('a', { href: '#', class: 'fine', onclick: function (e) { e.preventDefault(); setTab('session'); setTimeout(function () { $('sec-log').scrollIntoView(); }, 0); }, text: 'full log' })]),
      recent.length ? list : el('p', { class: 'fine', text: 'Rolls and events appear here.' })]));
  }

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
    renderCombat();
    renderRest();
    renderLogCard();
    card('sec-quick', 'Quick Reference', [el('dl', { class: 'kv' }, REF.QUICK.reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, [])),
      more('Conditions', [el('dl', { class: 'kv' }, REF.CONDITIONS.reduce(function (a, q) { return a.concat([el('dt', { text: q[0] }), el('dd', { text: q[1] })]); }, []))])]);
  }

  function renderCombat() {
    var c = S().combat, living = c.list.filter(function (x) { return !x.dead && x.kind === 'foe'; }), run = runningEnc();
    card('sec-combat', el('h2', null, ['Combat', el('small', { text: living.length ? plural(living.length, 'foe') + ' standing' : 'tracker' })]), [
      run ? el('div', { class: 'pending run-note' }, [el('b', { text: 'Running encounter: ' }), encLink(run.id, run.name || 'untitled'), '. End it from the Encounters tab to save the result.']) : null
    ].concat(combatUI(false)));
  }
  /* The combat tracker's controls and list, for the Session tab and for a running encounter (inRun). */
  function combatUI(inRun) {
    var s = S(), c = s.combat, addSel = { name: ui.addName || 'Blood Creature A', n: ui.addN || 1, side: ui.addSide || 'foe' };
    var select = beastSelect(addSel.name, function (v) { ui.addName = v; });
    var count = el('input', { type: 'number', class: 'tiny', min: 1, max: 30, value: addSel.n, 'aria-label': 'How many', onchange: function () { ui.addN = clamp(int(this.value, 1), 1, 30); } });
    var side = el('select', { class: 'in mini', 'aria-label': 'Side', onchange: function () { ui.addSide = this.value; } }, [el('option', { value: 'foe', text: 'Foe' }), el('option', { value: 'ally', text: 'Ally' })]);
    side.value = addSel.side;
    var sit = ui.sit || (ui.sit = {});
    function sitBtn(key, label, title) {
      return el('button', { type: 'button', class: 'cond' + (sit[key] ? ' on' : ''), 'aria-pressed': sit[key] ? 'true' : 'false', title: title, text: label, onclick: function () { sit[key] = !sit[key]; render(); } });
    }
    return [
      el('div', { class: 'round-box' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'lbl', text: 'Round' }), el('div', { class: 'val', text: String(c.round || '—') })]),
        btn(c.round ? 'Next round + initiative' : 'Start combat + initiative', function () { c.round = (c.round || 0) + 1; var r = d(10); c.first = r >= 6 ? 'crows' : 'foes'; newRound(c); ui.dice = { label: 'Initiative (round ' + c.round + ')', text: '1d10 = ' + r + ': ' + (r >= 6 ? 'crows and allies act first' : 'enemies act first') };
          var sur = c.round === 1 && c.surprise !== 'none' ? ' ' + (c.surprise === 'crows' ? 'The crows and their allies are' : 'The foes are') + ' surprised: no turn this round, and attacks against them get +1.' : '';
          log('', '**Round ' + c.round + '.** Initiative 1d10 = ' + r + ' → ' + (r >= 6 ? 'crows and allies first.' : 'enemies first.') + sur);
          feed('**Round ' + c.round + '.** ' + (r >= 6 ? 'Crows and allies act first.' : 'Enemies act first.') + sur); save(); render(); }, 'btn-primary'),
        btn('Add party', addPartyToCombat),
        btn('Clear dead', function () { c.list = c.list.filter(function (x) { return !x.dead; }); save(); render(); }, 'btn-ghost'),
        inRun ? null : btn('End combat', function () {
          var dead = c.list.filter(function (x) { return x.dead; }).map(function (x) { return x.name; });
          if (runningEnc() && !confirm('End the fight without saving a result to ' + (runningEnc().name || 'the running encounter') + '? (It stays open.)')) return;
          log('', '**Combat ends** after ' + plural(c.round || 0, 'round') + '.' + (dead.length ? ' Fallen: ' + dead.join(', ') + '.' : '') + (groundText() ? ' ' + groundText() : ''));
          c.list.forEach(function (x) { if (x.kind === 'pc') syncPC(x); });
          clearCombat(c); save(); render();
        }, 'btn-ghost btn-danger')
      ]),
      el('div', { class: 'row', style: 'margin-top:.6rem' }, [field('Add creature', select, 'grow'), field('How many', count), field('Side', side),
        btn('Add', function () { addCombatant(select.value, int(count.value, 1), side.value); log('', 'Added ' + int(count.value, 1) + ' × ' + select.value + ' to combat.'); render(); })]),
      el('div', { class: 'row center' }, [chk(c, 'autoMon', 'Deal creatures’ hits to their target automatically', { title: 'Off: a hit on a target waits in the Dice panel until you apply it' })]),
      el('div', { class: 'sit-row' }, [el('span', { class: 'fine', text: 'Next creature roll:' }),
        sitBtn('flank', 'Flanking', 'An ally of the attacker is on the opposite side of the target: edge on melee attacks'),
        sitBtn('high', 'High ground', '1+ square above the target: edge on attacks'),
        sitBtn('cover', 'Cover', 'The target is half behind something solid: bane on attacks (not for attacks that ignore cover)'),
        sitBtn('dim', 'Dim light', 'Dim light or light concealment: bane (not for creatures marked ⌂ or ◐)'),
        sitBtn('dark', 'Darkness', 'Darkness, heavy concealment, or an invisible target: double bane (not for ◐); against a silent mover, guess its square'),
        sitBtn('adj', 'Ranged vs adjacent', 'A ranged attack against a creature next to the attacker: bane'),
        sitBtn('charge', 'Charged 4+', 'It moved 4+ squares before attacking: a charging creature (big cat, wildcat, deer) deals its charge damage'),
        el('label', { class: 'fine', title: 'Squares beyond the attack’s range: -2 each' }, ['Beyond range ', el('input', { type: 'number', class: 'tiny', min: 0, max: 10, value: sit.far || '', 'aria-label': 'Squares beyond range',
          onchange: function () { sit.far = clamp(int(this.value, 0), 0, 10); } })])]),
      el('p', { class: 'fine', text: 'Pick each creature’s target (⚄ picks one at random) and its attacks and maneuvers go at it. Its own conditions (weakened, blessed, prone, hidden, taunted) and the target’s (surprised, prone, grabbed, squeezing, unconscious) apply automatically, with the edge/bane set in the Dice panel and the battlefield buttons above (they reset after each roll). ' +
        'A hit deals its damage and tier effects (weakened, prone, grabbed...) through AD, Stamina, and wounds, onto a crow’s own sheet (its worn armor and parry weapons absorb first), and can be undone from the Dice panel. A melee miss lets the target counter: a crow’s player is asked on their Play page.' }),
      el('div', { class: 'combat-list' }, c.list.length ? c.list.map(combatRow) : [el('p', { class: 'hint', text: 'No one in combat. Add creatures here, from the Bestiary, or from an encounter roll.' })]),
      itemsPanel(),
      livePanel()
    ];
  }
  function combatRow(c) {
    var b = beast(c.cref), cb = S().combat, amt = el('input', { type: 'number', class: 'tiny', min: 0, max: 200, value: '', placeholder: 'dmg', 'aria-label': 'Amount' });
    function amount() { return clamp(int(amt.value, 0), 0, 999); }
    var slots = slotsOf(c), linked = c.kind === 'pc' && pcOf(c) && pcOf(c).link && cloudOn(), g = byId(c.grabbedBy), holds = grabbing(c);
    var head = el('div', { class: 'cbt-top' }, [
      el('div', { class: 'cbt-name' }, [inp(c, 'name', { 'aria-label': 'Name' }),
        el('div', { class: 'cbt-meta', text: c.kind === 'pc' ? 'Crow' + (linked ? ' · vitals from their sheet' : '') : b ? b.t + ' · ' + b.sz + ' · P' + b.p + ' · speed ' + b.spd + ' · A ' + signed(b.c[0]) + ' M ' + signed(b.c[1]) + ' S ' + signed(b.c[2]) + (b.rx > 1 ? ' · ' + b.rx + ' reactions' : '') : '' })]),
      el('span', { class: 'pool' }, [el('span', { class: 'lbl', text: 'Stam' }), btnPM('−', function () { var s0 = c.st; c.st = Math.max(0, c.st - 1); if (c.kind === 'pc') syncPC(c, s0, c.wounds); save(); render(); }), el('b', { text: String(c.st) }), el('span', { class: 'of', text: '/' + c.stMax }), btnPM('+', function () { var s0 = c.st; c.st = Math.min(c.stMax, c.st + 1); if (c.kind === 'pc') syncPC(c, s0, c.wounds); save(); render(); })]),
      el('span', { class: 'pool', title: linked ? 'From the crow’s worn armor and parry weapons (change it on their sheet)' : null }, [el('span', { class: 'lbl', text: 'AD' }), linked ? null : btnPM('−', function () { c.ad = Math.max(0, c.ad - 1); save(); render(); }), el('b', { text: String(c.ad) }), el('span', { class: 'of', text: '/' + c.adMax }), linked ? null : btnPM('+', function () { c.ad = c.ad + 1; c.adMax = Math.max(c.adMax, c.ad); save(); render(); })]),
      slots ? el('span', { class: 'pool' }, [el('span', { class: 'lbl', text: 'Wounds' }), btnPM('−', function () { var w0 = c.wounds; c.wounds = Math.max(0, c.wounds - 1); if (c.kind === 'pc') syncPC(c, c.st, w0); save(); render(); }), el('b', { text: String(c.wounds) }), el('span', { class: 'of', text: '/' + slots })]) : null,
      surprised(c) ? el('span', { class: 'chip warn', title: 'No turn in round 1; attacks against them get +1', text: 'surprised' }) : null,
      c.kind === 'pc' && cb.round && c.done === cb.round ? el('span', { class: 'chip ok', title: 'The player marked this crow done for the round', text: 'done' }) : null,
      c.kind !== 'pc' && cb.round ? el('button', { type: 'button', class: 'cond' + (c.acted === cb.round ? ' on' : ''), 'aria-pressed': c.acted === cb.round ? 'true' : 'false', title: 'Mark that it has taken its turn this round', text: c.acted === cb.round ? 'acted ✓' : 'acted',
        onclick: function () { c.acted = c.acted === cb.round ? 0 : cb.round; save(); render(); } }) : null,
      !c.dead ? el('span', { class: 'chip' + (rxLeft(c) > 0 ? '' : ' warn'), title: 'Reactions left this round (counters, opportunity attacks, readied actions)', text: 'rxn ' + Math.max(0, rxLeft(c)) + '/' + rxMax(c) }) : null,
      el('button', { type: 'button', class: 'x', title: 'Remove', 'aria-label': 'Remove ' + c.name, text: '×', onclick: function () { S().combat.list = S().combat.list.filter(function (x) { return x !== c; }); save(); render(); } })
    ]);
    var tags = [g ? el('span', { class: 'chip warn', text: 'grabbed by ' + g.name }) : null,
      holds.length ? el('span', { class: 'chip', text: 'grabbing ' + holds.map(function (x) { return x.name; }).join(', ') }) : null,
      holds.length ? btn('Let go', function () { holds.forEach(function (x) { setCond(x, 'Grabbed', false); }); log('', c.name + ' lets go.'); feed('**' + c.name + '** lets go.'); save(); render(); }, 'btn-small btn-ghost') : null,
      tauntOn(c) ? el('span', { class: 'chip warn', title: 'Its attacks that don’t include ' + c.taunt.name + ' take a bane, until ' + c.taunt.name + '’s next turn', text: 'taunted by ' + c.taunt.name }) : null]
      .concat(c.kind === 'pc' ? [] : (c.items || []).map(function (it) {
        return el('span', { class: 'chip held' + (it.hidden ? ' hid' : ''), title: it.hidden ? 'Hidden from the players' : 'Players see it holding this' }, ['holds ' + itemName(it) + ' ',
          el('button', { type: 'button', class: 'chip-x', text: 'drop', title: c.name + ' drops it on the ground', 'aria-label': c.name + ' drops ' + it.key,
            onclick: function () { creatureDrop(c, [it]); save(); render(); } })]);
      })).filter(Boolean);
    var mid = el('div', { class: 'cbt-mid' }, [amt,
      btn('Damage', function () { if (amount()) damage(c, amount(), false); }, 'btn-small'),
      btn('Piercing', function () { if (amount()) damage(c, amount(), true); }, 'btn-small'),
      btn('Heal', function () { if (amount()) heal(c, amount()); }, 'btn-small btn-ghost'),
      c.dead ? btn('Revive', function () { c.dead = false; c.st = Math.max(1, c.st); save(); render(); }, 'btn-small btn-ghost') : btn('Mark dead', function () { c.dead = true; log('', c.name + ' is dead.'); feed('**' + c.name + '** is dead.'); save(); render(); }, 'btn-small btn-ghost'),
      el('div', { class: 'conds' }, REF.CONDITIONS.map(function (k) {
        return el('button', { type: 'button', class: 'cond' + (c.conds[k[0]] ? ' on' : ''), title: k[1], 'aria-pressed': c.conds[k[0]] ? 'true' : 'false', text: k[0],
          onclick: function () { setCond(c, k[0], !c.conds[k[0]]); save(); render(); } });
      }).concat([['hidden', 'Hidden', 'Hidden: edge on its attacks; any aggressive action reveals it'], ['squeeze', 'Squeezing', 'Squeezing through a tight space: speed halved, attacks against it get +1']].map(function (k) {
        return el('button', { type: 'button', class: 'cond st8' + (c[k[0]] ? ' on' : ''), title: k[2], 'aria-pressed': c[k[0]] ? 'true' : 'false', text: k[1],
          onclick: function () { c[k[0]] = !c[k[0]]; save(); render(); } });
      })))
    ].concat(tags));
    var atks = null;
    if (b && c.kind !== 'pc') {
      var tgts = !c.dead ? targetsFor(c) : [], two = b.atk.some(twoTargets);
      var pick1 = function (key, label) {
        return el('select', { class: 'in mini', 'aria-label': c.name + '’s ' + label, title: 'Who ' + c.name + '’s attacks and maneuvers go at', onchange: function () { c[key] = this.value || null; save(); render(); } },
          [el('option', { value: '', text: label === 'target' ? 'Target: none' : '2nd target: none' })].concat(tgts.map(function (x) { return el('option', { value: x.id, text: '→ ' + x.name, selected: targetOf(c, key === 'tgt2' ? 2 : 1) === x || null }); })));
      };
      var pickTgt = tgts.length ? el('span', { class: 'tgt-pick' }, [pick1('tgt', 'target'),
        el('button', { type: 'button', class: 'pm', text: '⚄', title: 'Pick a random ' + (c.kind === 'foe' ? 'crow or ally' : 'foe'), 'aria-label': 'Random target for ' + c.name,
          onclick: function () { c.tgt = pick(tgts).id; save(); render(); } }), two ? pick1('tgt2', 'second target') : null]) : null;
      var t = targetOf(c), m = meleeAtk(c), canMove = !c.dead && !c.conds.Unconscious;
      atks = el('div', { class: 'atk-btns' }, [pickTgt].concat(b.atk.map(function (a) {
        return btn(a[0] + ' ' + signed(a[1]) + ' ' + a[2] + ' · ' + a[3] + '/' + a[4], function () { monsterAttack(c, a); }, 'btn-small atk-btn', a[5] || null);
      })).concat(canMove ? [
        m && t && rxLeft(c) > 0 ? btn('Opportunity attack', function () { monsterAttack(c, m, { rxn: true }); }, 'btn-small btn-ghost', 'Reaction: ' + t.name + ' leaves its reach; it attacks with ' + m[0]) : null,
        t && noBigger(t, c) ? btn('Grab', function () { monsterManeuver(c, 'grab'); }, 'btn-small btn-ghost', 'Maneuver, 2d10 + S against ' + t.name + ' (its size or smaller): T1 they may counter; T2 grabbed (push 1 or shift); T3 grabbed') : null,
        t && noBigger(t, c) ? btn('Knockback', function () { monsterManeuver(c, 'knockback'); }, 'btn-small btn-ghost', 'Maneuver, 2d10 + S against ' + t.name + ' (its size or smaller): T1 they may counter; T2 push 1; T3 push 2') : null,
        g ? btn('Escape Grab', function () { monsterManeuver(c, 'escape'); }, 'btn-small btn-ghost', 'Maneuver, 2d10 + A or S: T1 still grabbed; T2 free, but ' + g.name + ' may counter; T3 free and move 1') : null] : []).concat(b.uses.map(function (u) {
        var used = c.used[u[0]] || 0;
        return el('span', { class: 'chip', title: u[1] + ' per ' + u[2].toLowerCase() + ' (a crit regains one)' }, [u[0] + ' ', el('span', { class: 'use-pips' }, Array.apply(null, Array(u[1])).map(function (_, i) {
          return el('button', { type: 'button', class: 'upip' + (i < used ? ' used' : ''), 'aria-label': u[0] + ' use ' + (i + 1), onclick: function () { c.used[u[0]] = i < used ? i : i + 1; save(); render(); } });
        })), ' /' + u[2]]);
      })));
    }
    return el('div', { class: 'cbt ' + (c.kind === 'pc' ? 'pc' : c.kind === 'ally' ? 'ally' : '') + (c.dead ? ' dead' : '') }, [head, mid, atks,
      b && b.x && c.kind !== 'pc' ? el('div', { class: 'cbt-x', text: b.x }) : null]);
  }
  function btnPM(t, fn) { return el('button', { type: 'button', class: 'pm', text: t, onclick: fn, 'aria-label': t === '+' ? 'increase' : 'decrease' }); }

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
  function renderLogCard() {
    var note = { t: '' };
    var list = el('ol', { class: 'log-list' }, state.log.slice().reverse().map(logItem));
    var noteIn = inp(note, 't', { placeholder: 'Add a note to the log…', 'aria-label': 'Log note' });
    noteIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && note.t.trim()) { log('note', note.t.trim()); render(); } });
    card('sec-log', el('h2', null, ['Session Log', el('small', { text: 'Session ' + S().n })]), [
      el('div', { class: 'grid2' }, [field('Session title', inp(S(), 'title', { placeholder: 'e.g. Into the Blood Library' })), field('Date', inp(S(), 'date', { type: 'date' }))]),
      el('div', { class: 'row', style: 'margin:.6rem 0' }, [el('div', { class: 'grow' }, [noteIn]), btn('Add', function () { if (note.t.trim()) { log('note', note.t.trim()); render(); } }),
        btn('Export text', function () { download(logText(S().n, S().title, S().date, state.log), 'Crows_Session_' + S().n + '.txt', 'text/plain'); }, 'btn-ghost'),
        btn('End session & archive', function () {
          if (!confirm('Archive this session\'s log to the World tab and start session ' + (S().n + 1) + '?')) return;
          state.history.push({ n: S().n, title: S().title, date: S().date, log: state.log });
          state.log = []; S().n += 1; S().title = ''; S().date = today(); S().pending = null; ui.lastEnc = null;
          save(); render(); toast('Session archived.');
        }, 'btn-ghost')]),
      state.log.length ? list : el('p', { class: 'hint', text: 'Nothing logged yet this session.' })
    ]);
  }
  function logText(n, title, date, entries) {
    return 'Crows session ' + n + (title ? ': ' + title : '') + (date ? ' (' + date + ')' : '') + '\n\n' + entries.map(function (e) { return e.t + '  ' + e.s.replace(/\*\*/g, ''); }).join('\n') + '\n';
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

  // ------------------------------------------------------------------ Party tab
  // ------------------------------------------------------------------ inviting players
  /*
   * The Ref makes an invite link for this campaign and sends it to the players. A player who opens it asks to
   * join with one of their crows; the request appears here within a second or two (through the change signal
   * the server writes for each new request). Accepting links the crow, just as a character link would.
   * The Ref can also list the campaign in Find a campaign, with a short note, so players can ask without a link.
   */
  var inv = { id: null, loading: false, hasLink: false, link: '', listed: false, note: '', draft: null, requests: [], latest: 0, at: 0 };
  function loadInvites() {
    var id = window.CrowsCloud && window.CrowsCloud.recordId;
    if (!cloudOn() || !id || inv.loading) return Promise.resolve();
    inv.loading = true;
    return window.CrowsCloud.api('GET', 'invite.get', 'id=' + id).then(function (j) {
      var known = inv.id === id ? inv.requests.map(function (r) { return r.id; }) : null;
      if (inv.id !== id) { inv.link = ''; inv.draft = null; }
      inv.id = id; inv.hasLink = j.hasLink; inv.listed = !!j.listed; inv.note = j.note || ''; inv.requests = j.requests; inv.latest = j.latest; inv.at = Date.now();
      var fresh = known ? j.requests.filter(function (r) { return known.indexOf(r.id) < 0; }) : [];
      if (fresh.length) toast(fresh.map(function (r) { return r.player + ' asks to join with ' + (r.name || 'a crow'); }).join('. ') + '. See the Party tab.');
      window.CrowsCloud.watch('requests', j.watch, j.latest, function () { if (!window.CrowsCloud.typing) return loadInvites(); });
      render();
    }, function (e) { inv.at = Date.now(); if (e.status !== 404) toast(e.message); }).then(function () { inv.loading = false; });
  }
  function answerRequest(r, accept) {
    window.CrowsCloud.api('POST', accept ? 'join.accept' : 'join.decline', '', { id: r.id }).then(function (j) {
      inv.requests = inv.requests.filter(function (x) { return x.id !== r.id; });
      if (accept) {
        var pc = linkPC(j.item);
        log('', (pc.name || 'A crow') + ' (' + pc.owner + '\u2019s character) joined the party.');
        toast((pc.name || 'The crow') + ' joined the party.');
      } else toast('Declined ' + r.player + '\u2019s request.');
      save(); render();
    }, function (e) { toast(e.message); loadInvites(); });
  }
  function setListing(id, listed, note) {
    window.CrowsCloud.api('POST', 'invite.list', '', { id: id, listed: listed, note: note || '' }).then(function () {
      var was = inv.listed;
      inv.listed = listed; inv.note = listed ? (note || '') : inv.note; inv.draft = null; render();
      toast(!listed ? 'Taken out of Find a campaign. Waiting requests stay here.' : was ? 'Note saved.' : 'Listed: players can find this campaign and ask to join.');
    }, function (e) { toast(e.message); render(); });
  }
  /* The switch for Find a campaign, and the note players see there while it's listed. */
  function listBox(id) {
    var box = el('input', { type: 'checkbox', checked: inv.listed });
    box.addEventListener('change', function () { setListing(id, this.checked, inv.draft !== null ? inv.draft : inv.note); });
    var kids = [el('label', { class: 'check', title: 'Any player with an account can find this campaign and ask to join. You still accept or decline each request.' },
      [box, 'List in Find a campaign'])];
    if (inv.listed) {
      var text = inv.draft !== null ? inv.draft : inv.note;
      var ta = el('textarea', { rows: 2, maxlength: 255, placeholder: 'A note for players: who you\u2019re looking for, when you play\u2026', 'aria-label': 'Note for players' });
      ta.value = text;
      var saveBtn = btn('Save note', function () { setListing(id, true, ta.value); }, 'btn-small', 'Show this note with the campaign in Find a campaign');
      saveBtn.disabled = text === inv.note;
      ta.addEventListener('input', function () { inv.draft = this.value; saveBtn.disabled = this.value === inv.note; });
      kids.push(ta, el('div', { class: 'row center' }, [saveBtn, el('span', { class: 'fine', text: 'Players see the name, summary, this note, and your username.' })]));
    }
    return el('div', { class: 'invite-list' }, kids);
  }
  /* A compact block at the foot of the side column, on the Party tab only (the tab's badge and a toast flag new requests). */
  function renderInvite() {
    var box = $('side-invite'), id = window.CrowsCloud && window.CrowsCloud.recordId, on = cloudOn() && tab === 'party';
    box.hidden = !on; box.innerHTML = '';
    if (!on) return;
    var head = el('div', { class: 'row center' }, [el('h3', { text: 'Invite players' }), el('span', { class: 'spacer' }),
      inv.requests.length ? el('span', { class: 'badge', text: String(inv.requests.length), title: plural(inv.requests.length, 'request') + ' waiting' }) : null]);
    if (!id) { box.appendChild(head); box.appendChild(el('p', { class: 'fine', text: 'Saving the campaign to your account first…' })); setTimeout(function () { if (tab === 'party') render(); }, 1500); return; }
    if (inv.id !== id || Date.now() - inv.at > 60000) loadInvites();   // also catches requests withdrawn meanwhile
    var linkBox = null;
    if (inv.link) {
      var input = el('input', { type: 'text', class: 'in', readonly: true, value: inv.link, 'aria-label': 'Invite link', onfocus: function () { this.select(); } });
      linkBox = el('div', { class: 'invite-link' }, [input,
        el('div', { class: 'row center' }, [btn('Copy link', function () {
          input.select();
          (navigator.clipboard ? navigator.clipboard.writeText(inv.link) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { document.execCommand('copy'); toast('Link copied.'); });
        }, 'btn-small btn-primary')]),
        el('p', { class: 'fine', text: 'Shown only now; make a new one if you lose it. Keep it private: anyone with an account who has it can ask to join.' })]);
    }
    [head,
      el('p', { class: 'fine', text: 'Players open the link (or find the campaign, if it\u2019s listed), pick a crow, and ask to join. Accepted crows join the party, tied to their sheets.' }),
      el('div', { class: 'row center' }, [
        btn(inv.hasLink ? 'New link' : 'Make a link', function () {
          if (inv.hasLink && !confirm('Make a new link? The old one stops working. Requests already made stay here.')) return;
          window.CrowsCloud.api('POST', 'invite.create', '', { id: id }).then(function (j) { inv.hasLink = true; inv.link = j.link; render(); }, function (e) { toast(e.message); });
        }, 'btn-small'),
        inv.hasLink ? btn('Turn off', function () {
          window.CrowsCloud.api('POST', 'invite.disable', '', { id: id }).then(function () { inv.hasLink = false; inv.link = ''; render(); toast('The invite link no longer works. Waiting requests stay here.'); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost', 'Turn off the invite link') : null,
        inv.hasLink && !inv.link ? el('span', { class: 'fine', text: 'Link is on.' }) : null]),
      linkBox,
      listBox(id),
      inv.requests.length ? el('ul', { class: 'join-reqs' }, inv.requests.map(function (r) {
        return el('li', null, [el('div', null, [el('b', { text: r.name || 'Unnamed crow' }), el('div', { class: 'fine', text: r.player + (r.summary ? ' · ' + r.summary : '') })]),
          el('div', { class: 'row center' }, [btn('Accept', function () { answerRequest(r, true); }, 'btn-small btn-primary', 'Add this crow to the party, tied to the player’s sheet'),
            btn('Decline', function () { answerRequest(r, false); }, 'btn-small btn-ghost')])]);
      })) : null
    ].forEach(function (k) { if (k) box.appendChild(k); });
  }

  // ------------------------------------------------------------------ Party status
  /*
   * A condensed, live view of every crow in play. A crow linked to a player's sheet shows that sheet's own Vitals
   * card (the generator at &view=status in a frame), so its buttons work exactly as they do for the player, with
   * the whole character behind them (armor soaking damage, wounds filling backpack slots, the log), and save to
   * the player's sheet within a second. Frames are kept, not rebuilt, across renders (reloading one would lose
   * a second or two and anything half-typed), and they're laid out with CSS order instead of being moved.
   * Crows added by hand or from a file get simple buttons for the numbers kept here.
   */
  var statusFrames = {};   // link id -> { tile, frame, head }
  function statusPCs() { return state.party.filter(function (p) { return p.status === 'active' || p.status === 'away'; }); }
  function statusHead(p) {
    return el('div', { class: 'st-head' }, [el('b', { class: 'grow', text: p.name || 'Unnamed crow' }),
      p.status === 'away' ? el('span', { class: 'chip', text: 'sitting out' }) : null,
      p.owner ? el('span', { class: 'fine', text: p.owner }) : null]);
  }
  function localTile(p) {
    function bump(k, n, lo, hi) { p[k] = Math.max(lo, Math.min(hi, (p[k] || 0) + n)); save(); render(); }
    function pm(k, lo, hi, what) { return [btn('\u2212', function () { bump(k, -1, lo, hi); }, 'btn-small', 'Lower ' + what), btn('+', function () { bump(k, 1, lo, hi); }, 'btn-small', 'Raise ' + what)]; }
    var max = p.stMax || 0, st = Math.min(p.st || 0, max);
    return el('div', { class: 'st-tile' }, [statusHead(p),
      el('div', { class: 'st-stam' }, [el('span', { class: 'lbl', text: 'Stamina' }), el('b', { text: st + ' / ' + max }),
        el('div', { class: 'meter' }, [el('span', { style: 'width:' + (max ? Math.round(st / max * 100) : 0) + '%' })])]),
      el('div', { class: 'row center' }, [btn('\u22125', function () { bump('st', -5, 0, max); }, 'btn-small'), btn('\u22121', function () { bump('st', -1, 0, max); }, 'btn-small'),
        btn('+1', function () { bump('st', 1, 0, max); }, 'btn-small'), btn('+5', function () { bump('st', 5, 0, max); }, 'btn-small'),
        btn('Full', function () { p.st = max; save(); render(); }, 'btn-small btn-ghost')]),
      el('div', { class: 'st-nums' }, [
        el('span', { class: p.wounds >= 7 ? 'bad' : null }, ['Wounds ', el('b', { text: (p.wounds || 0) + '/10' })].concat(pm('wounds', 0, 10, 'wounds'))),
        el('span', null, ['AD ', el('b', { text: String(p.ad || 0) })].concat(pm('ad', 0, 99, 'AD'))),
        el('span', null, ['Cruelty ', el('b', { text: String(p.cruelty || 0) })].concat(pm('cruelty', 0, 20, 'cruelty')))]),
      el('div', { class: 'fine', text: 'Kept on this screen only. Link the player\u2019s sheet to see and change everything live.' })]);
  }
  function renderStatus() {
    var box = $('sec-status'), live = cloudOn();
    if (!box.firstChild) {
      box.appendChild(el('h2', null, ['Party status', el('small', { text: 'live from the players\u2019 sheets' })]));
      box.appendChild(el('p', { class: 'hint', text: 'Each linked crow shows its own sheet\u2019s vitals: the buttons work just as they do for the player and save to their sheet at once, ' +
        'and their changes show up here within a second. Damage goes through worn armor and parry weapons first, as on the sheet.' }));
      box.appendChild(el('div', { class: 'row', style: 'margin-bottom:.6rem' }, [btn('Everyone to full Stamina', function () {
        activePCs().forEach(function (p) { sheetOp(p, { full: true }); });   // linked crows: on their sheets
        save(); render();
      }, 'btn-small btn-ghost', 'Every active crow back to full Stamina (linked crows on their own sheets)')]));
      box.appendChild(el('div', { class: 'st-grid', id: 'st-grid' }));
      box.appendChild(el('p', { class: 'hint', id: 'st-empty', text: 'No crows in play. Add some below.' }));
    }
    var grid = $('st-grid'), pcs = statusPCs(), keep = {};
    $('st-empty').style.display = pcs.length ? 'none' : '';
    Array.prototype.forEach.call(grid.querySelectorAll('.st-tile.local'), function (n) { n.remove(); });
    pcs.forEach(function (p, i) {
      if (p.link && live) {
        keep[p.link] = true;
        var f = statusFrames[p.link];
        if (!f) {
          f = statusFrames[p.link] = { head: el('div'), frame: el('iframe', { class: 'st-frame', title: 'Vitals of ' + (p.name || 'a linked crow'),
            src: 'Crows_Character_Generator.html?link=' + encodeURIComponent(p.link) + '&view=status' }) };
          f.tile = el('div', { class: 'st-tile linked' }, [f.head, f.frame]);
          grid.appendChild(f.tile);
        }
        f.head.replaceWith(f.head = el('div', { class: 'row center' }, [statusHead(p), btn('Open sheet', function () { openSheet(p); }, 'btn-small btn-ghost', 'See the whole sheet'), takeBtn(p)]));
        f.tile.style.order = i;
      } else {
        var t = localTile(p); t.className += ' local'; t.style.order = i;
        grid.appendChild(t);
      }
    });
    Object.keys(statusFrames).forEach(function (id) { if (!keep[id]) { statusFrames[id].tile.remove(); delete statusFrames[id]; } });
  }
  // A frame reports its height whenever it changes; size it to fit, so there's no inner scrollbar.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.crowsStatus) return;
    Object.keys(statusFrames).forEach(function (id) {
      var fr = statusFrames[id].frame;
      if (fr.contentWindow !== e.source) return;
      fr.style.height = Math.max(60, Math.min(4000, +e.data.h || 0)) + 'px';
      if (e.data.loaded) state.party.forEach(function (p) { if (String(p.link) === id && p.owed) flushOps(p); });
    });
  });

  function renderParty() {
    renderStatus();
    var fileIn = el('input', { type: 'file', accept: '.json,application/json', multiple: true, onchange: function () {
      var files = Array.prototype.slice.call(this.files || []), input = this, done = [];
      if (!files.length) return;
      var left = files.length;
      files.forEach(function (f) {
        var rd = new FileReader();
        rd.onload = function () {
          try { done.push(importCharacter(JSON.parse(rd.result))); } catch (e) { toast(f.name + ': ' + e.message); }
          if (--left === 0) { input.value = ''; save(); render(); if (done.length) { toast('Imported ' + done.join(', ') + '.'); log('', 'Imported crows: ' + done.join(', ') + '.'); } }
        };
        rd.readAsText(f);
      });
    } });
    card('sec-party', el('h2', null, ['The Crows', el('small', { text: plural(activePCs().length, 'active crow') })]), [
      el('p', { class: 'hint', text: 'Keep the party\'s key numbers at hand. Import the .json save files from the Character Generator (Save file), or add crows by hand. Importing a crow with the same name updates it.' +
        (cloudOn() ? ' Players can also send you a link to their character: added that way, the crow stays tied to their sheet. Its vitals show live under Party status, and you can open the sheet to change equipment and notes too.' : '') }),
      cloudOn() ? el('div', { class: 'row', style: 'margin-bottom:.5rem' }, [
        (ui.linkIn = el('input', { type: 'url', class: 'in grow', placeholder: 'Paste a player\u2019s character link', 'aria-label': 'Character link', value: ui.linkText || '',
          oninput: function () { ui.linkText = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') { addFromLink(this.value); ui.linkText = ''; } } })),
        btn('Add from link', function () { addFromLink(ui.linkIn.value); ui.linkText = ''; }, 'btn-primary', 'The crow stays tied to the player\u2019s sheet')]) : null,
      el('div', { class: 'row', style: 'margin-bottom:.7rem' }, [btn('Add crow', function () { state.party.push(newPC()); save(); render(); }, 'btn-primary'),
        el('label', { class: 'btn file-btn' }, ['Import character files', fileIn])]),
      state.party.length ? el('div', { class: 'pc-list' }, [pcHead()].concat(state.party.map(pcCard))) : el('p', { class: 'hint', text: 'No crows yet.' })
    ]);

    var aw = ui.award || (ui.award = { gc: 0, greed: greedBonus(), players: activePCs().length || 1, what: '' });
    var total = Math.round(aw.gc * (1 + aw.greed / 100)), each = aw.players ? Math.floor(total / aw.players) : 0;
    card('sec-xp', el('h2', null, ['Experience', el('small', { text: 'XP = treasure value / number of players' })]), [
      el('p', { class: 'hint', text: 'XP comes from treasure and equipment recovered outside a village (not bought, crafted by the group, taken from an innocent human, or originally an ally\'s). Unique items give the XP on their card. XP can be spent, and bonuses gained, only after finishing a rest.' }),
      el('div', { class: 'grid3' }, [
        field('Treasure value (gc) or card XP', inp(aw, 'gc', { type: 'number', min: 0, max: 9999999 }, { re: true })),
        field('Greed bonus', sel(aw, 'greed', [[0, 'none'], [10, '+10% (DT 3)'], [20, '+20% (DT 2)'], [30, '+30% (DT 1)']], { num: true })),
        field('Number of players', inp(aw, 'players', { type: 'number', min: 1, max: 20 }, { re: true, dflt: 1 })),
        field('What was it?', inp(aw, 'what', { placeholder: 'e.g. jade mask, 538 gc chest' }), 'span2')
      ]),
      el('div', { class: 'row center', style: 'margin-top:.6rem' }, [el('span', null, ['Total ', el('b', { text: fmt(total) + ' gc' }), ' → ', el('b', { text: fmt(each) + ' XP' }), ' per crow']),
        btn('Award as pending XP', function () {
          if (!each) return;
          activePCs().forEach(function (p) { sheetOp(p, { xp: each, desc: aw.what || 'Treasure', gc: total, n: aw.players }); });
          state.xpLog.push({ date: today(), session: S().n, what: aw.what, gc: total, each: each });
          log('', 'XP: ' + (aw.what || 'treasure') + ' worth ' + fmt(total) + ' gc → **' + fmt(each) + ' XP** each (applies after the next rest).');
          ui.award = null; save(); render();
        }, 'btn-primary'),
        btn('Apply all pending XP now', function () { activePCs().forEach(function (p) { sheetOp(p, { apply: true }); }); log('', 'Pending XP applied.'); save(); render(); }, 'btn-ghost')]),
      state.xpLog.length ? more('XP history (' + state.xpLog.length + ')', [el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [
        el('thead', null, [el('tr', null, ['Date', 'Session', 'What', 'Value', 'Each'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', null, state.xpLog.slice().reverse().map(function (x) { return el('tr', null, [el('td', { text: x.date }), el('td', { text: String(x.session) }), el('td', { text: x.what || '' }), el('td', { class: 'n', text: fmt(x.gc) }), el('td', { class: 'n', text: fmt(x.each) })]); }))
      ])])]) : null,
      more('Advancement thresholds', [el('p', { text: 'Expertise & Stamina bonuses at TXP 100, 500, 1,250, 2,250, 3,500, 5,000, 10,000, 20,000, 30,000, then every +30,000. Each: +3 expertise uses, or +2 Stamina max, or +1 use and +1 Stamina max. Characteristic bonus (+1, max 4) at 5,000, 15,000, 30,000, then every +30,000. Traits cost 500/1,000/1,500/2,000 XP by row.' }),
        el('p', { text: 'New crow after a death: roll backgrounds 1 + (the dead crow\'s number of E&S bonuses) times and pick any. Starting With More: if all other crows have 5,000+ TXP, a new crow may start at the lowest party TXP with half that in gc for equipment. Retirement at 60,000+ TXP gives the village a benefit (2 at 100,000+).' })])
    ]);

    card('sec-hirelings', el('h2', null, ['Hirelings', el('small', { text: 'daily pay power × 10 gc (min 10) + food' })]), [
      el('p', { class: 'hint', text: 'Paid at the start of each day. If one dies in service, the crows owe its family its equipment (or equal value), wages due, and power × 500 gc on returning to the hiring village. Unpaid hirelings leave; with debts unpaid, no hireling will work for those crows. Players control them; the Ref may take over for out-of-character or suicidal orders. No XP.' }),
      el('div', { class: 'list' }, state.hirelings.map(function (h) {
        var pw = h.power || 0;
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(h, 'name', { placeholder: 'Name' }), sel(h, 'block', [['', 'Stat block…']].concat(REF.BESTIARY.filter(function (b) { return b.t === 'Human' || b.t === 'Animal'; }).map(function (b) { return [b.n, b.n + ' (P' + b.p + ')']; })), { on: function (n) { var b = beast(n); if (b) h.power = b.p; } }),
            inp(h, 'employer', { placeholder: 'Employer' })]),
          el('div', { class: 'li-row' }, [el('label', { class: 'check' }, ['Power ', inp(h, 'power', { type: 'number', min: 0, max: 20, class: 'tiny' }, { re: true })]),
            el('span', { class: 'fine', text: 'Pay ' + Math.max(10, pw * 10) + ' gc/day + food · death debt ' + fmt(pw * 500) + ' gc + gear' }), inp(h, 'notes', { placeholder: 'Notes (lent gear, days owed…)' })])
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove hireling', onclick: function () { state.hirelings = state.hirelings.filter(function (x) { return x !== h; }); save(); render(); } })]);
      })),
      el('div', { class: 'row' }, [btn('Add hireling', function () { state.hirelings.push({ id: nid(), name: '', block: '', power: 0, employer: '', notes: '' }); save(); render(); }),
        state.hirelings.length ? btn('Pay a day', function () { var tot = state.hirelings.reduce(function (a, h) { return a + Math.max(10, (h.power || 0) * 10); }, 0); log('', 'Hirelings paid for the day: ' + fmt(tot) + ' gc + a day\'s food each.'); render(); }, 'btn-ghost') : null])
    ]);

    card('sec-ledger', el('h2', null, ['Ledger', el('small', { text: 'loans, credits, bets, debts, promises' })]), [
      el('div', { class: 'list' }, state.ledger.map(function (l) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [el('div', { class: 'li-row' }, [inp(l, 'who', { placeholder: 'Who' }), inp(l, 'what', { placeholder: 'What (Money Bags loan, 100 gc credit, rival bet…)' }),
          el('label', { class: 'check' }, ['gc ', inp(l, 'gc', { type: 'number', min: -999999, max: 999999, class: 'tiny', style: 'width:6rem' })]), inp(l, 'due', { placeholder: 'Due / expires' })])]),
          el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove entry', onclick: function () { state.ledger = state.ledger.filter(function (x) { return x !== l; }); save(); render(); } })]);
      })),
      btn('Add entry', function () { state.ledger.push({ id: nid(), who: '', what: '', gc: 0, due: '' }); save(); render(); })
    ]);
  }
  /*
   * One crow as a single row of what matters at the table (name, status, characteristics, Stamina, AD, wounds,
   * cruelty, pending XP), under the column heads from pcHead(). The rest (background, XP and bonuses, connection,
   * Miasma, notes, and a linked crow's sheet actions) is under "More", which stays open across renders.
   */
  var PC_STATUSES = [['active', 'Active'], ['away', 'Sitting out'], ['dead', 'Dead'], ['retired', 'Retired'], ['lost', 'Lost to the Miasma']];
  function pcHead() {
    return el('div', { class: 'pc-head', 'aria-hidden': 'true' }, ['Crow', 'A', 'M', 'S', 'Stamina', 'AD', 'Wounds', 'Cruelty', 'Pending XP', ''].map(function (t) { return el('span', { text: t }); }));
  }
  function pcCard(p) {
    // A linked crow's sheet fields are refreshed from the player's sheet, so they're shown but not edited here.
    function ro(a) { a = a || {}; if (p.link) { a.disabled = true; a.title = 'From the player’s sheet'; } return a; }
    function cell(label, control, cls) { return el('label', { class: 'c' + (cls ? ' ' + cls : '') }, [el('span', { class: 'l', text: label }), control]); }
    function num(key, min, max, opts, own) { return inp(p, key, (own ? function (a) { return a; } : ro)({ type: 'number', min: min, max: max, class: 'in n', 'aria-label': key }), opts); }
    var benefit = REF.CONNECTION_BENEFITS.filter(function (b) { return b[0] === p.benefit; })[0];
    var es = esBonusCount(p.txp || 0), cb = charBonusCount(p.txp || 0);
    ui.pcOpen = ui.pcOpen || {};
    var more = el('details', { class: 'pc-more', open: ui.pcOpen[p.id] || null, ontoggle: function () { ui.pcOpen[p.id] = this.open; } }, [
      el('summary', { text: 'More' }),
      p.link && cloudOn() ? el('div', { class: 'row center pc-link' }, [
        el('span', { class: 'fine grow', text: 'Linked to ' + (p.owner ? p.owner + '’s' : 'the player’s') + ' sheet: its numbers come from there.' }),
        btn('Update from sheet', function () { refreshLinked(p); }, 'btn-small', 'Refresh name, characteristics, Stamina, wounds, and XP from the sheet'),
        p.status === 'active' || p.status === 'away' ? takeBtn(p) : null,
        btn('Unlink', function () { if (confirm('Unlink ' + (p.name || 'this crow') + ' from the player’s sheet? You keep this copy, but lose access to the sheet.')) unlinkPC(p); }, 'btn-small btn-ghost')
      ]) : null,
      el('div', { class: 'grid3' }, [field('Player', inp(p, 'player', ro())), field('Background', inp(p, 'bg', ro({ list: 'bg-list' }))),
        field('Total XP', inp(p, 'txp', ro({ type: 'number', min: 0, max: 9999999 }), { re: true }))]),
      el('div', { class: 'pc-sum', text: plural(es, 'E&S bonus') + ', ' + plural(cb, 'characteristic bonus') + ' · next E&S bonus at ' + fmt(nextES(p.txp || 0)) + ' TXP' + ((p.txp || 0) >= 60000 ? ' · may retire' : '') }),
      p.miasma && p.miasma.length ? el('div', { class: 'pc-sum', text: 'Miasma: ' + p.miasma.map(function (k) { return lookup(REF.MIASMA_EFFECTS, k)[2].split(':')[0]; }).join(', ') }) : null,
      el('div', { class: 'grid3' }, [field('Connection', inp(p, 'conn', ro({ placeholder: 'NPC name' }))), field('Relationship', inp(p, 'rel', ro())),
        field('Connection benefit', sel(p, 'benefit', [['', '—']].concat(REF.CONNECTION_BENEFITS.map(function (b) { return b[0]; })), { disabled: !!p.link }))]),
      benefit ? el('div', { class: 'fine', text: benefit[1] }) : null,
      field('Notes', area(p, 'notes', { rows: 2, placeholder: 'Feature, goals, debts, secrets…' }))
    ]);
    return el('div', { class: 'pc-row ' + (p.status || 'active') }, [
      el('div', { class: 'pc-main' }, [
        el('div', { class: 'c who' }, [
          inp(p, 'name', ro({ placeholder: 'Crow name', 'aria-label': 'Name', class: 'in pc-name' })),
          el('div', { class: 'row center sub' }, [sel(p, 'status', PC_STATUSES, { class: 'in mini', label: 'Status' }),
            el('span', { class: 'fine', text: [p.player, p.bg].filter(Boolean).join(' · ') + (p.link ? (p.player || p.bg ? ' · ' : '') + 'linked' : '') })])]),
        cell('A', num('A', -5, 5)), cell('M', num('M', -5, 5, { re: true })), cell('S', num('S', -5, 5)),
        el('div', { class: 'c stam' }, [el('span', { class: 'l', text: 'Stamina' }), num('st', 0, 999), el('span', { class: 'of', text: '/' }), num('stMax', 1, 999)]),
        cell('AD', num('ad', 0, 99, null, true)), cell('Wounds', num('wounds', 0, 10)), cell('Cruelty', num('cruelty', 0, 20, { re: true })),
        cell('Pending XP', num('pending', 0, 9999999)),
        el('div', { class: 'c acts' }, [
          p.link && cloudOn() ? btn('Sheet', function () { openSheet(p); }, 'btn-small', 'Open the player’s whole sheet') : null,
          el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Delete crow', onclick: function () {
            if (!confirm('Delete ' + (p.name || 'this crow') + ' from the party?')) return;
            if (p.link) unlinkPC(p, true);
            state.party = state.party.filter(function (x) { return x !== p; }); save(); render();
          } })])
      ]),
      more
    ]);
  }

  // ------------------------------------------------------------------ World tab
  function renderWorld() {
    card('sec-places', el('h2', null, ['Places', el('small', { text: 'dungeons, points of interest, villages' })]), [
      el('p', { class: 'hint', text: 'A dungeon\'s greed bonus applies only on the players\' first visit. "Run here" sets the Session tab\'s location, EN, and monster table.' }),
      el('div', { class: 'list' }, state.places.map(function (p) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(p, 'name', { placeholder: 'Name' }), sel(p, 'kind', ['Dungeon', 'POI', 'Village', 'Region', 'Other'], { class: 'in mini' }), inp(p, 'hex', { placeholder: 'Hex / location' })]),
          el('div', { class: 'li-row' }, [el('label', { class: 'check' }, ['Base EN ', inp(p, 'en', { type: 'number', min: 2, max: 10, class: 'tiny' }, { dflt: 9 })]),
            sel(p, 'table', [['Blood Creatures', 'Blood creatures'], ['Undead', 'Undead'], ['Travel', 'Travel table'], ['none', 'Ref\'s choice']], { class: 'in mini' }),
            chk(p, 'visited', 'Visited (no greed bonus)'),
            btn('Run here', function () { var s = S(); s.place = p.id; s.table = p.table === 'Travel' ? 'Travel' : REF.DUNGEON_TABLES[p.table] ? p.table : 'none'; s.firstVisit = !p.visited; s.enAdj = 0; s.crowded = false; s.chaos = false; log('', 'The crows head into ' + (p.name || 'a place') + '.'); save(); setTab('session'); }, 'btn-small btn-primary')]),
          area(p, 'notes', { rows: 2, placeholder: 'Rooms, hooks, loot left behind, monsters killed…' })
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove place', onclick: function () { if (confirm('Remove ' + (p.name || 'this place') + '?')) { state.places = state.places.filter(function (x) { return x !== p; }); save(); render(); } } })]);
      })),
      el('div', { class: 'row' }, [btn('Add place', function () { state.places.push({ id: nid(), name: '', kind: 'Dungeon', hex: '', en: 9, table: 'none', visited: false, notes: '' }); save(); render(); }),
        btn('Add the Dungeons book locations', function () {
          REF.SAMPLE_PLACES.forEach(function (sp) { if (!state.places.some(function (p) { return p.name === sp.name; })) state.places.push({ id: nid(), name: sp.name, kind: sp.kind, hex: '', en: sp.en, table: sp.table, visited: false, notes: sp.notes }); });
          save(); render();
        }, 'btn-ghost')])
    ]);

    card('sec-npcs', el('h2', null, ['NPCs', el('small', { text: state.npcs.length ? String(state.npcs.length) : '' })]), [
      el('div', { class: 'list' }, state.npcs.map(function (n) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(n, 'name', { placeholder: 'Name' }), inp(n, 'role', { placeholder: 'Role (steward, connection, rival crow…)' }), inp(n, 'where', { placeholder: 'Where' })]),
          area(n, 'notes', { rows: 2, placeholder: 'Wants, knows, owes…' })
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove NPC', onclick: function () { state.npcs = state.npcs.filter(function (x) { return x !== n; }); save(); render(); } })]);
      })),
      el('div', { class: 'row' }, [btn('Add NPC', function () { state.npcs.push({ id: nid(), name: '', role: '', where: '', notes: '' }); save(); render(); }),
        btn('Random NPC', function () { var n = randomNPC(); state.npcs.push({ id: nid(), name: n.name, role: '', where: '', notes: n.notes }); log('', 'New NPC: ' + n.name + ', ' + n.notes + '.'); save(); render(); }, 'btn-ghost')])
    ]);

    card('sec-notes', 'Campaign Notes', [
      el('div', { class: 'grid2' }, [field('Hooks, rumors & threads', area(state, 'hooks', { rows: 8, placeholder: 'Maps from corpses, gossip from NPC crows, passing merchants…' })),
        field('Notes', area(state, 'notes', { rows: 8, placeholder: 'Anything else worth remembering between sessions.' }))])
    ]);

    card('sec-history', el('h2', null, ['Session History', el('small', { text: plural(state.history.length, 'archived session') })]), [
      state.history.length ? el('div', null, state.history.slice().reverse().map(function (h) {
        return more('Session ' + h.n + (h.title ? ': ' + h.title : '') + (h.date ? ' (' + h.date + ')' : '') + ' — ' + plural(h.log.length, 'entry'), [
          el('ol', { class: 'log-list' }, h.log.map(logItem)),
          el('div', { class: 'row' }, [btn('Export text', function () { download(logText(h.n, h.title, h.date, h.log), 'Crows_Session_' + h.n + '.txt', 'text/plain'); }, 'btn-small'),
            btn('Delete', function () { if (confirm('Delete the archived log of session ' + h.n + '?')) { state.history = state.history.filter(function (x) { return x !== h; }); save(); render(); } }, 'btn-small btn-ghost btn-danger')])
        ]);
      })) : el('p', { class: 'hint', text: 'Archive a session from the Session tab\'s log to keep it here.' })
    ]);
  }
  function randomNPC() {
    return { name: pick(REF.NAMES.first) + ' ' + pick(REF.NAMES.last), notes: pick(REF.NAMES.trait) + '; ' + pick(REF.NAMES.want) };
  }

  // ------------------------------------------------------------------ Bestiary tab
  function renderBestiary() {
    var q = ui.beastQ.toLowerCase(), types = ['Animal', 'Human', 'Blood Creature', 'Undead', 'Unique'];
    var list = REF.BESTIARY.filter(function (b) {
      return (!ui.beastType || b.t === ui.beastType) && (!q || (b.n + ' ' + b.x + ' ' + b.atk.map(function (a) { return a[0]; }).join(' ')).toLowerCase().indexOf(q) >= 0);
    });
    var search = el('input', { type: 'search', class: 'in', placeholder: 'Search creatures…', value: ui.beastQ, 'aria-label': 'Search creatures', oninput: function () { ui.beastQ = this.value; var pos = this.selectionStart; renderBestiary(); var n = $('beast-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } });
    search.id = 'beast-q';
    card('sec-bestiary', el('h2', null, ['Bestiary', el('small', { text: list.length + ' of ' + REF.BESTIARY.length })]), [
      el('div', { class: 'row' }, [el('div', { class: 'grow' }, [search]),
        el('div', { class: 'seg' }, [['', 'All']].concat(types.map(function (t) { return [t, t === 'Blood Creature' ? 'Blood' : t]; })).map(function (t) {
          return el('button', { type: 'button', class: ui.beastType === t[0] ? 'on' : '', text: t[1], onclick: function () { ui.beastType = t[0]; renderBestiary(); } });
        }))]),
      more('How Ref creatures work', REF.MONSTER_RULES.map(function (r) { return el('p', { text: r }); }).concat(types.map(function (t) { return REF.TYPE_NOTES[t] ? el('p', null, [el('b', { text: t + 's: ' }), REF.TYPE_NOTES[t]]) : null; }))),
      el('div', { class: 'beast-list' }, list.map(beastCard))
    ]);
  }
  function beastCard(b) {
    var n = { k: 1 };
    return el('div', { class: 'beast t-' + b.t.split(' ')[0] }, [
      el('div', { class: 'b-head' }, [el('span', { class: 'b-name', text: b.n }), el('span', { class: 'chip', text: b.t + ' · P' + b.p })]),
      el('div', { class: 'b-stats', text: SIZES[b.sz] + ' · Stamina ' + b.st + (b.ad ? ' · AD ' + b.ad : '') + ' · Speed ' + b.spd + (b.sl ? ' · ' + b.sl + ' slots' : '') + (b.rx > 1 ? ' · ' + b.rx + ' reactions' : '') }),
      el('div', { class: 'b-stats', text: 'A ' + signed(b.c[0]) + ' · M ' + signed(b.c[1]) + ' · S ' + signed(b.c[2]) }),
      el('ul', { class: 'b-atk' }, b.atk.map(function (a) { return el('li', null, [el('b', { text: a[0] + ' (' + signed(a[1]) + ') ' }), a[2] + ': ' + a[3] + ' / ' + a[4] + ' dam' + (a[5] ? '; ' + a[5] : '')]); })),
      b.uses.length ? el('div', { class: 'fine', text: b.uses.map(function (u) { return u[0] + ' ' + u[1] + '/' + u[2]; }).join(' · ') }) : null,
      b.x ? el('div', { class: 'b-x', text: b.x }) : null,
      el('div', { class: 'row' }, [inp(n, 'k', { type: 'number', min: 1, max: 30, class: 'tiny', 'aria-label': 'How many' }, { dflt: 1 }),
        btn('Add to combat', function () { addCombatant(b.n, clamp(n.k, 1, 30), 'foe'); log('', 'Added ' + n.k + ' × ' + b.n + ' to combat.'); toast('Added ' + n.k + ' × ' + b.n + '.'); render(); }, 'btn-small'),
        b.t === 'Animal' ? el('span', { class: 'fine', text: 'Pet price ' + fmt(REF.PET_PRICES[Math.min(10, b.p)]) + ' gc' }) : null])
    ]);
  }

  // ------------------------------------------------------------------ Tables tab
  function renderTables() {
    var tv = ui.tables;
    function tcard(key, title, controls, roll, tableView) {
      var res = tv[key];
      return el('div', { class: 'tcard' }, [el('h4', { text: title }),
        el('div', { class: 'row' }, (controls || []).concat([btn('Roll', function () { var r = roll(); tv[key] = r; log(r.enc ? 'enc' : '', title + ': ' + r.log); render(); }, 'btn-small btn-primary')])),
        res ? el('div', { class: 'result' }, [el('div', { class: 'r-roll', text: res.roll }), el('div', null, [rich(res.text)]), res.adds && res.adds.length ? addToCombatBtn(res.adds) : null]) : null,
        tableView ? more('Show table', [tableView(res ? res.n : null)]) : null]);
    }
    function simple(rows, dieLabel, n, dice) { var row = lookup(rows, n); var text = dice ? rollInText(row[2]) : row[2]; return { n: n, roll: dieLabel + ' = ' + n, text: text, log: dieLabel + ' ' + n + ' → ' + text }; }
    var o = ui.topts || (ui.topts = { rank: 0, cruelty: 1, prosperity: state.village.prosperity, habitat: state.travel.habitat, dtab: 'Undead', size: 'Medium', climate: state.travel.climate });

    card('sec-tables', el('h2', null, ['Tables', el('small', { text: 'every roll is logged' })]), [el('div', { class: 'table-grid' }, [
      tcard('travel', 'Travel encounter (d100)', [], function () { var r = rollTravelEncounter(); return { n: r.roll, roll: 'd100 = ' + r.roll + ' (' + state.travel.habitat + ', ' + state.travel.climate + ')', text: '**' + r.kind + '.** ' + r.lines.join(' '), adds: r.adds, log: r.summary, enc: true }; },
        function (n) { return rowsTable(REF.TRAVEL_ENCOUNTERS, 'd100', n); }),
      tcard('dungeon', 'Dungeon encounter', [sel(o, 'dtab', Object.keys(REF.DUNGEON_TABLES), { class: 'in' })], function () {
        var e = rollDungeonTable(o.dtab); return { n: e.roll, roll: 'd' + e.die + ' = ' + e.roll, text: e.text + ' → **' + addsText(e.adds) + '**', adds: e.adds, log: e.text + ' → ' + addsText(e.adds) };
      }, function (n) { var t = REF.DUNGEON_TABLES[o.dtab]; return el('div', null, [rowsTable(t.rows, 'd' + t.die, n), t.note ? el('p', { class: 'fine', text: t.note }) : null]); }),
      tcard('anymon', 'Any monster type (d10)', [], function () {
        var m = d(10), row = lookup(REF.ANY_MONSTER, m), e = row[3] ? rollDungeonTable(row[3]) : null;
        return { n: m, roll: 'd10 = ' + m, text: row[2] + (e ? ': ' + e.text + ' → **' + addsText(e.adds) + '**' : ''), adds: e ? e.adds : [], log: row[2] + (e ? ': ' + addsText(e.adds) : '') };
      }, function (n) { return rowsTable(REF.ANY_MONSTER, 'd10', n); }),
      tcard('minor', 'Minor Interesting Things (d100)', [], function () { return simple(REF.MINOR_THINGS, 'd100', d100().total, true); }, function (n) { return rowsTable(REF.MINOR_THINGS, 'd100', n); }),
      tcard('major', 'Major Interesting Things (d100)', [], function () { return simple(REF.MAJOR_THINGS, 'd100', d100().total, true); }, function (n) { return rowsTable(REF.MAJOR_THINGS, 'd100', n); }),
      tcard('backlash', 'Backlash (d100 + spell rank)', [el('label', { class: 'check' }, ['Rank ', inp(o, 'rank', { type: 'number', min: 0, max: 5, class: 'tiny' })])], function () {
        var r = d100().total, n = r + o.rank, row = lookup(REF.BACKLASH, n), text = rollInText(row[2]);
        return { n: n, roll: 'd100 ' + r + ' + rank ' + o.rank + ' = ' + n, text: text, log: n + ' → ' + text };
      }, function (n) { return el('div', null, [el('p', { class: 'fine', text: REF.BACKLASH_RULES }), rowsTable(REF.BACKLASH, 'd100+rank', n)]); }),
      tcard('miasma', 'Miasma effect (1d10 + cruelty)', [el('label', { class: 'check' }, ['Cruelty ', inp(o, 'cruelty', { type: 'number', min: 0, max: 20, class: 'tiny' })])], function () {
        var r = d(10), n = r + o.cruelty, row = lookup(REF.MIASMA_EFFECTS, n);
        return { n: n, roll: '1d10 ' + r + ' + cruelty ' + o.cruelty + ' = ' + n, text: '**' + row[2] + '** ' + row[3], log: n + ' → ' + row[2] + ' ' + row[3] };
      }, function (n) { return rowsTable(REF.MIASMA_EFFECTS, '1d10+cruelty', n, function (r) { return r[2] + ' + ' + r[3]; }); }),
      tcard('village', 'Village event (d10 + Prosperity)', [el('label', { class: 'check' }, ['Prosperity ', inp(o, 'prosperity', { type: 'number', min: -10, max: 10, class: 'tiny' })])], function () {
        var r = d(10), n = r + o.prosperity, row = lookup(REF.VILLAGE_EVENTS, n);
        return { n: n, roll: 'd10 ' + r + ' + Prosperity ' + o.prosperity + ' = ' + n, text: row[2], log: n + ' → ' + row[2] };
      }, function (n) { return rowsTable(REF.VILLAGE_EVENTS, 'd10+P', n); }),
      tcard('animal', 'Wild animal + reaction', [sel(o, 'habitat', Object.keys(REF.HABITATS), { class: 'in' })], function () {
        var w = rollWildAnimal(o.habitat); return { n: null, roll: o.habitat, text: w.lines.join(' '), adds: w.adds, log: w.lines.join(' ') };
      }, function () { var h = REF.HABITATS[o.habitat]; return el('div', null, [rowsTable(h.rows, 'd' + h.die, null), el('h3', { text: 'Reaction (d100)' }), rowsTable(REF.ANIMAL_REACTION, 'd100', null)]); }),
      tcard('weather', 'Bad weather', [sel(o, 'climate', Object.keys(REF.WEATHER_BY_CLIMATE), { class: 'in', re: false })], function () {
        var w = rollWeather(o.climate); return { n: null, roll: o.climate, text: w.text, log: w.text };
      }, function () { return el('dl', { class: 'kv' }, Object.keys(REF.WEATHER).reduce(function (a, k) { return a.concat([el('dt', { text: k }), el('dd', { text: REF.WEATHER[k].txt })]); }, [])); }),
      tcard('merchant', 'Merchant caravan', [], function () { var m = rollMerchant(); return { n: null, roll: 'd100 + guards', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return rowsTable(REF.MERCHANT_SALES, 'd100', null); }),
      tcard('mtouched', 'Miasma-touched humans', [], function () { var m = rollMiasmaTouched(); return { n: null, roll: '1d6 humans + d100', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return rowsTable(REF.MIASMA_TOUCHED, 'd100', null); }),
      tcard('travelers', 'Travelers', [], function () { var m = rollTravelers(); return { n: null, roll: '1d10 humans + d10 + d6', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return el('div', null, [rowsTable(REF.TRAVELER_ENCOUNTERS, 'd10', null), el('h3', { text: 'Rewards (d6)' }), rowsTable(REF.TRAVELER_REWARDS, 'd6', null)]); }),
      tcard('dismember', 'Dismember (weapon crit)', [], function () { return simple(REF.DISMEMBER, 'd6', d(6)); }, function (n) { return rowsTable(REF.DISMEMBER, 'd6', n); }),
      tcard('harvest', 'Harvest a corpse (monster parts)', [sel(o, 'size', Object.keys(REF.HARVEST), { class: 'in', re: false })], function () {
        var r = rollDice(REF.HARVEST[o.size]); return { n: null, roll: r.detail, text: o.size + ' corpse: **' + plural(r.total, 'part') + '**', log: o.size + ' corpse → ' + r.total + ' parts' };
      }),
      tcard('auction', 'Auction house price', [], function () {
        var a = d(6), b = d(6), pct = a % 2 === 0 ? -b * 10 : b * 10, sell = d(10) * (10 + state.village.prosperity);
        return { n: null, roll: 'die ' + a + (a % 2 === 0 ? ' (even: discount)' : ' (odd: markup)') + ', 1d6 ' + b + '; sell 1d10 × (10 + Prosperity)', text: 'Buying: **' + (pct > 0 ? '+' : '') + pct + '%** of value. Selling: **' + sell + '%** of value (must sell once committed).', log: 'buy ' + (pct > 0 ? '+' : '') + pct + '%, sell ' + sell + '%' };
      }),
      tcard('lost', 'Lost: secret direction (d6)', [], function () { var r = d(6); return { n: r, roll: 'd6 = ' + r, text: 'They actually enter the hex to the **' + REF.DIRECTIONS[r] + '**.', log: '(Ref only) ' + REF.DIRECTIONS[r] }; }),
      tcard('npc', 'Random NPC', [], function () { var n = randomNPC(); return { n: null, roll: 'name, trait, want', text: '**' + n.name + '**: ' + n.notes, log: n.name + ', ' + n.notes }; })
    ])]);
  }

  // ------------------------------------------------------------------ Rules tab
  var RULES = null;
  function parseRules() {
    if (RULES) return RULES;
    var blocks = [], h2 = '', h3 = '', n = 0;
    String(typeof REF_RULES === 'string' ? REF_RULES : '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        var lvl = m[1].length, id = 'r' + (n++);
        if (lvl === 1) { blocks.push({ t: 'h1', s: m[2], id: id }); return; }
        if (lvl === 2) { h2 = id; h3 = ''; } else h3 = id;
        blocks.push({ t: 'h' + lvl, s: m[2], id: id, h2: h2 }); return;
      }
      blocks.push({ t: 'p', s: line, h2: h2, h3: h3 });
    });
    RULES = blocks; return blocks;
  }
  function renderRules() {
    var blocks = parseRules(), c = $('sec-rules');
    if (!blocks.length) { card('sec-rules', 'Rules', [el('p', { class: 'hint', text: 'The rules text wasn\'t built into this copy. Rebuild with ref/build/build.py (it reads docs/CROWS_PT2_RULES.md).' })]); return; }
    if (!c.querySelector('#rules-q')) {
      var search = el('input', { type: 'search', id: 'rules-q', class: 'in', placeholder: 'Search the rules (e.g. grab, lantern, backlash, Prosperity)…', 'aria-label': 'Search the rules',
        oninput: function () { ui.rulesQ = this.value; clearTimeout(renderRules._t); renderRules._t = setTimeout(renderRulesBody, 120); } });
      var jump = el('select', { class: 'in', 'aria-label': 'Jump to section', onchange: function () { var t = document.getElementById(this.value); if (t) t.scrollIntoView({ block: 'start' }); this.value = ''; } },
        [el('option', { value: '', text: 'Jump to a section…' })].concat(blocks.filter(function (b) { return b.t === 'h2' || b.t === 'h3'; }).map(function (b) { return el('option', { value: b.id, text: (b.t === 'h3' ? '   ' : '') + b.s.replace(/ L:.*$/, '') }); })));
      card('sec-rules', el('h2', null, ['Rules Reference', el('small', { text: 'Playtest 2 rules summary' })]), [
        el('div', { class: 'rules-tools' }, [el('div', { class: 'row' }, [el('div', { class: 'grow' }, [search]), el('div', { style: 'flex:0 1 260px' }, [jump])]),
          el('div', { class: 'rules-toc' }, blocks.filter(function (b) { return b.t === 'h2'; }).map(function (b) { return el('a', { href: '#' + b.id, text: b.s, onclick: function (e) { e.preventDefault(); document.getElementById(b.id).scrollIntoView({ block: 'start' }); } }); })),
          el('div', { class: 'fine', id: 'rules-count' })]),
        el('div', { class: 'rules-body', id: 'rules-body' })
      ]);
      search.value = ui.rulesQ;
    }
    renderRulesBody();
  }
  function renderRulesBody() {
    var blocks = parseRules(), q = ui.rulesQ.trim().toLowerCase(), body = $('rules-body');
    if (!body) return;
    body.innerHTML = '';
    var re = q ? new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig') : null;
    var hitH2 = {}, hitH3 = {}, hits = 0;
    if (q) blocks.forEach(function (b) { if (b.t === 'p' && b.s.toLowerCase().indexOf(q) >= 0) { hitH2[b.h2] = true; if (b.h3) hitH3[b.h3] = true; hits++; } else if ((b.t === 'h2' || b.t === 'h3') && b.s.toLowerCase().indexOf(q) >= 0) { hitH2[b.h2] = true; if (b.t === 'h3') hitH3[b.id] = 'all'; if (b.t === 'h2') hitH2[b.id] = 'all'; hits++; } });
    function mark(text) {
      if (!re) return document.createTextNode(text);
      var frag = document.createDocumentFragment();
      text.split(re).forEach(function (part, i) { frag.appendChild(i % 2 ? el('mark', { text: part }) : document.createTextNode(part)); });
      return frag;
    }
    var frag = document.createDocumentFragment();
    blocks.forEach(function (b) {
      if (b.t === 'h1') { if (!q) frag.appendChild(el('p', { class: 'fine', text: b.s })); return; }
      var show = !q;
      if (q) {
        if (b.t === 'h2') show = !!hitH2[b.id];
        else if (b.t === 'h3') show = !!hitH3[b.id] || hitH2[b.h2] === 'all';
        else show = b.s.toLowerCase().indexOf(q) >= 0 || hitH2[b.h2] === 'all' || (b.h3 && hitH3[b.h3] === 'all');
      }
      if (!show) return;
      var n = el(b.t === 'p' ? 'p' : b.t, { id: b.t === 'p' ? null : b.id }, [mark(b.s)]);
      frag.appendChild(n);
    });
    body.appendChild(frag);
    $('rules-count').textContent = q ? (hits ? plural(hits, 'match') + ' (whole sections shown when a heading matches)' : 'No matches.') : '';
  }

  // ------------------------------------------------------------------ files
  function download(text, name, type) {
    var blob = new Blob([text], { type: type }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileBase() { return (state.name || state.village.name || 'Crows').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Crows'; }

  // ------------------------------------------------------------------ init
  function init() {
    state = load() || freshState();
    try { tab = localStorage.getItem(TAB_KEY) || 'session'; } catch (e) { tab = 'session'; }
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'session';
    document.body.setAttribute('data-tab', tab);
    // Rearrangeable pages (src/layout.js): each tab is a page of its cards plus the sidebar (timer, dice, log).
    if (window.CrowsLayout) {
      var pages = {};
      TABS.forEach(function (t) {
        var ids = Array.prototype.map.call(document.querySelectorAll('#page-' + t[0] + ' > section'), function (n) { return n.id; });
        pages['ref-' + t[0]] = { blocks: ids.concat('side'), cols: [ids, ['side']], colClass: 'page' };
      });
      window.CrowsLayout.init({ pages: pages, containers: ['main.layout > .pages'], current: function () { return 'ref-' + tab; },
        narrow: 'clamp(320px, 22vw, 420px)', breakpoint: 1080, nav: document.querySelector('.masthead .actions'),
        titles: { side: 'Timer, dice & log', 'sec-enc-run': 'Running encounter' } });
    }

    var dl = el('datalist', { id: 'bg-list' }, REF.BACKGROUNDS.map(function (b) { return el('option', { value: b[0] }); }));
    document.body.appendChild(dl);

    $('btn-save').addEventListener('click', function () { download(JSON.stringify(state, null, 1), fileBase() + '_Crows_Campaign.json', 'application/json'); toast('Campaign saved to a file.'); });
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Start a new campaign? Save the current one to a file first if you want to keep it.')) return;
      startNew(); state = freshState(); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render();
    });
    $('file-load').addEventListener('change', function () {
      var f = this.files && this.files[0], input = this;
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (s && s.v === 1 && typeof s.bg === 'number') throw new Error('that is a character file: import it in the Party tab');
          if (!s || s.v !== 1 || !s.session) throw new Error('not a Crows campaign file');
          startNew(); state = withDefaults(freshState(), s); ui.lastEnc = null; ui.dice = null; save(); render(); toast('Loaded ' + (state.name || state.village.name || 'campaign') + '.');
        } catch (e) { toast('Could not load that file: ' + e.message); }
        input.value = '';
      };
      rd.readAsText(f);
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === ' ' && tab === 'session' && S().mode === 'timer' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (S().running) pauseTimer(); else startTimer(); }
    });
    render();
    setInterval(tick, 250);
    if (window.CrowsCloud) window.CrowsCloud.attach({
      kind: 'campaigns',
      getData: function () { return state; },
      valid: isCampaign,
      apply: function (data) { state = repairObjects(withDefaults(freshState(), clone(data))); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render(); },
      fresh: function () { state = freshState(); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render(); },
      name: function (c) { return c.name || (c.village && c.village.name) || 'Untitled campaign'; },
      onReady: function () {
        loadInvites();   // join requests (and the badge) show whichever tab is open
        liveChanged();   // share the fight in the tracker (if any) with the players
        // Refresh crows tied to players' sheets, then add one passed from the home page (#addlink=<token>).
        state.party.filter(function (p) { return p.link; }).forEach(function (p) { refreshLinked(p, true); });
        var tok = linkToken((/addlink=([0-9a-f]{64})/.exec(location.hash) || [])[1]);
        if (tok) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
          addFromLink(tok).then(function () { setTab('party'); });
        }
      },
      summary: function (c) {
        var crows = (c.party || []).length;
        return ['Session ' + ((c.session && c.session.n) || 1), crows ? crows + (crows === 1 ? ' crow' : ' crows') : '',
          c.village && c.village.name ? c.village.name : ''].filter(Boolean).join(' · ');
      }
    });
  }

  window.CrowsRef = { get state() { return state; }, rollTravelEncounter: rollTravelEncounter, endDT: endDT, test: test, importCharacter: function (s) { var r = importCharacter(s); save(); render(); return r; } };
  init();
})();
