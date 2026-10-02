/*
 * Crows Playtest 2 Ref Screen: the core, loaded first. Plain browser JavaScript (no build step). Depends on REF (ref-data.js),
 * REF_RULES (rules-text.js), CROWS (src/game-data.js), and src/shared/. All campaign state lives in one object, autosaved to
 * localStorage (and the account, src/cloud.js) and exportable as a .json file.
 *
 * The Ref Screen is split by tab: ref-core.js (helpers, campaign state, the bound inputs, the dungeon turn timer, the tab bar and
 * sidebar), ref-encounters.js, ref-travel.js, ref-session.js, ref-combat.js, ref-village.js, ref-party.js, ref-reference.js (World,
 * Bestiary, Tables, Rules), and ref.js (files and start-up), loaded in that order. They share window.CrowsRefApp (A below).
 */
(function () {
  'use strict';
  // Shared by this app's files: their functions and constants (add), calls to another file's functions (fwd), and
  // the variables more than one file reassigns, kept in step in every file (share, set).
  var watch = {};
  var A = window.CrowsRefApp = {
    fwd: function (name) { return function () { return A[name].apply(this, arguments); }; },
    add: function (o) { Object.keys(o).forEach(function (k) { A[k] = o[k]; }); },
    share: function (name, fn) { (watch[name] = watch[name] || []).push(fn); },
    set: function (name, v) { A[name] = v; (watch[name] || []).forEach(function (fn) { fn(v); }); return v; }
  }, f = A.fwd;
  // From the other files (each call goes to the function there).
  var allClaims = f('allClaims'), applyAct = f('applyAct'), byId = f('byId'), cloudOn = f('cloudOn'), counterAct = f('counterAct'),
      counterDamage = f('counterDamage'), dropFromFallen = f('dropFromFallen'), endDT = f('endDT'), feed = f('feed'), fxItems = f('fxItems'),
      heal = f('heal'), liveChanged = f('liveChanged'), newRound = f('newRound'), pcOf = f('pcOf'), pendingText = f('pendingText'),
      releaseGrabs = f('releaseGrabs'), renderBestiary = f('renderBestiary'), renderEncounters = f('renderEncounters'),
      renderInvite = f('renderInvite'), renderParty = f('renderParty'), renderRules = f('renderRules'), renderSession = f('renderSession'),
      renderStatus = f('renderStatus'), renderTables = f('renderTables'), renderTravel = f('renderTravel'), renderVillage = f('renderVillage'),
      renderWorld = f('renderWorld'), runningEnc = f('runningEnc'), rxLeft = f('rxLeft'), undoAct = f('undoAct');
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  var STORAGE_KEY = 'crows-pt2-ref-campaign';
  var TAB_KEY = 'crows-pt2-ref-tab';
  var TABS = [['session', 'Session'], ['encounters', 'Encounters'], ['travel', 'Travel'], ['village', 'Village'], ['party', 'Party'], ['world', 'World'], ['bestiary', 'Bestiary'], ['tables', 'Tables'], ['rules', 'Rules']];
  var SIZES = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge' };
  var EB_LABELS = [[-2, 'DB'], [-1, 'Bane'], [0, '—'], [1, 'Edge'], [2, 'DE']];
  var uid = 1;   // state (the campaign) and tab (the open tab) are shared: A.set('state', ...)
  var ui = { dice: null, tables: {}, beastQ: '', beastType: '', rulesQ: '', lastEnc: null, travelEnc: null, alarmFired: false, encSrc: '', encDraft: null, encFilter: 'open', encOpen: {}, encFocus: null, encEnd: null };

  // ------------------------------------------------------------------ helpers
  var Dom = window.CrowsDom, Dice = window.CrowsDice, Rules = window.CrowsRules;   // src/shared/
  var $ = Dom.$, el = Dom.el, fmt = Dom.fmt, signed = Dom.signed, clone = Dom.clone, plural = Dom.plural, toast = Dom.toast;
  var d = Dice.d, pick = Dice.pick, rollDice = Dice.rollDice, d100 = Dice.d100, netEdges = Dice.netEdges, ebWord = Dice.ebWord;
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function int(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }
  function nid() { return 'i' + Date.now().toString(36) + (uid++); }
  function lookup(rows, n) { for (var i = 0; i < rows.length; i++) if (n >= rows[i][0] && n <= rows[i][1]) return rows[i]; return rows[rows.length - 1]; }
  function nowStamp() { var t = new Date(); return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); }
  function today() { var t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function beast(name) { for (var i = 0; i < REF.BESTIARY.length; i++) if (REF.BESTIARY[i].n === name) return REF.BESTIARY[i]; return null; }

  /* Roll every dice expression inside a sentence, e.g. "gem worth 10d10 gc" -> "gem worth 10d10 (= 57) gc". */
  function rollInText(text) {
    return text.replace(/\b(\d+)d(\d+)(\s*\+\s*\d+)?(\s*x\s*[\d,]+)?/g, function (all) { return all + ' (= ' + fmt(rollDice(all.replace(/\s+/g, '')).total) + ')'; });
  }

  /* A test: 2d10 + mod with net edges (-2..2) (CrowsDice.test). Returns dice, nat, mod, net, total, tier, crit, doom. */
  function test(mod, net, critMin, dice) { return Dice.test(mod, net, { critMin: critMin, dice: dice }); }
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
  function btn(text, onclick, cls, title) { return Dom.btn(text, onclick, cls, title); }
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
  var esBonusCount = Rules.esBonusCount, charBonusCount = Rules.charBonusCount;
  function nextES(txp) { return Rules.nextBonusAt(txp).es; }

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

  var inv = { id: null, loading: false, hasLink: false, link: '', listed: false, note: '', draft: null, requests: [], latest: 0, at: 0 };
  // ================================================================== RENDERING
  function setTab(t) { A.set('tab', t); document.body.setAttribute('data-tab', t); if (window.CrowsLayout) window.CrowsLayout.apply(); try { localStorage.setItem(TAB_KEY, t); } catch (e) { /* ignore */ } render(); window.scrollTo(0, 0); }
  function renderTabbar() {
    var bar = $('tabbar'); bar.innerHTML = '';
    TABS.forEach(function (t) {
      var badge = null;
      if (t[0] === 'session' && (S().pending || S().combat.list.some(function (c) { return !c.dead && c.kind === 'foe'; }))) badge = el('span', { class: 'badge', text: S().pending ? '!' : '⚔' });
      if (t[0] === 'encounters' && runningEnc()) badge = el('span', { class: 'badge', text: '⚔', title: 'An encounter is running' });
      if (t[0] === 'party' && inv.requests.length && inv.id === (window.CrowsCloud && window.CrowsCloud.recordId)) badge = el('span', { class: 'badge', text: String(inv.requests.length), title: 'Join requests waiting' });
      else if (t[0] === 'party' && allClaims().length) badge = el('span', { class: 'badge', text: 'XP', title: plural(allClaims().length, 'XP claim') + ' from players waiting' });
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

  A.add({ clamp: clamp, int: int, nid: nid, lookup: lookup, nowStamp: nowStamp, today: today, beast: beast, rollInText: rollInText, test: test,
      testLine: testLine, tierChip: tierChip, freshVillage: freshVillage, freshState: freshState, withDefaults: withDefaults, save: save,
      startNew: startNew, isCampaign: isCampaign, load: load, S: S, repairObjects: repairObjects, log: log, rich: rich, logItem: logItem, inp: inp,
      area: area, sel: sel, chk: chk, field: field, segEB: segEB, btn: btn, card: card, more: more, rowsTable: rowsTable, currentPlace: currentPlace,
      dungeonEN: dungeonEN, travelCalc: travelCalc, greedBonus: greedBonus, activePCs: activePCs, salePct: salePct, nextES: nextES,
      remainMs: remainMs, clockText: clockText, startTimer: startTimer, pauseTimer: pauseTimer, resetTimer: resetTimer, beep: beep, tick: tick,
      setTab: setTab, renderTabbar: renderTabbar, render: render, renderSide: renderSide, fxText: fxText, hitControls: hitControls, diceBtn: diceBtn,
      rollInitiative: rollInitiative, renderSideLog: renderSideLog, STORAGE_KEY: STORAGE_KEY, TAB_KEY: TAB_KEY, TABS: TABS, SIZES: SIZES,
      EB_LABELS: EB_LABELS, ui: ui, Dom: Dom, Dice: Dice, Rules: Rules, $: $, el: el, fmt: fmt, signed: signed, clone: clone, plural: plural,
      toast: toast, d: d, pick: pick, rollDice: rollDice, d100: d100, netEdges: netEdges, ebWord: ebWord, esBonusCount: esBonusCount,
      charBonusCount: charBonusCount, inv: inv, layoutFitQueued: layoutFitQueued });
})();
