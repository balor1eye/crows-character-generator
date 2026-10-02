/*
 * Crows Playtest 2 Character Generator — application logic.
 * Plain browser JavaScript (no build step, no network). Depends on:
 *   PDFLib (pdf-lib), CROWS (game-data.js), CROWS_TRAIT_TREES (traits-data.js),
 *   CROWS_TEMPLATE_B64 / CROWS_FIELDS (template-data.js).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'crows-pt2-character';
  var AREAS = { hand: 2, belt: 4, pack: 10 };
  var state;
  var selectedId = null;
  var uid = 1;

  // ------------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function bg() { return CROWS.BACKGROUNDS[state.bg]; }
  function item(key) { return CROWS.ITEMS[key] || { cat: 'misc', st: 1, sl: 1, gc: 0, txt: '' }; }

  // ------------------------------------------------------------------ trait lookups
  var TREE_BY_NAME = {};
  CROWS_TRAIT_TREES.forEach(function (t) { TREE_BY_NAME[t.tree] = t; });
  function findTrait(tree, name) {
    var t = TREE_BY_NAME[tree];
    if (!t) return null;
    for (var i = 0; i < t.traits.length; i++) if (norm(t.traits[i].n) === norm(name)) return t.traits[i];
    return null;
  }
  function traitId(tree, name) { return tree + '|' + name; }
  function startingTraitId() {
    var b = bg(); var t = findTrait(b.trait[0], b.trait[1]);
    return traitId(b.trait[0], t ? t.n : b.trait[1]);
  }
  function ownedTraitIds() { return [startingTraitId()].concat(state.traits.filter(function (id) { return id !== startingTraitId(); })); }
  function connected(treeName, a, b) {
    var t = TREE_BY_NAME[treeName];
    return t.edges.some(function (e) {
      return (e[0][0] === a.r && e[0][1] === a.c && e[1][0] === b.r && e[1][1] === b.c) ||
             (e[1][0] === a.r && e[1][1] === a.c && e[0][0] === b.r && e[0][1] === b.c);
    });
  }
  function canLearn(treeName, trait, owned) {
    if (trait.r === 0) return true;
    return owned.some(function (id) {
      var p = id.split('|'); if (p[0] !== treeName) return false;
      var o = findTrait(p[0], p[1]); return o && connected(treeName, o, trait);
    });
  }
  // Drop purchased traits that no longer connect (e.g. after the background changes).
  function pruneTraits() {
    var changed = true;
    while (changed) {
      changed = false;
      var owned = ownedTraitIds();
      state.traits = state.traits.filter(function (id) {
        if (id === startingTraitId()) { changed = true; return false; }
        var p = id.split('|'); var t = findTrait(p[0], p[1]);
        if (!t) { changed = true; return false; }
        var others = owned.filter(function (o) { return o !== id; });
        var ok = canLearn(p[0], t, others);
        if (!ok) changed = true;
        return ok;
      });
    }
  }
  function traitXP() {
    return state.traits.reduce(function (s, id) { var p = id.split('|'); var t = findTrait(p[0], p[1]); return s + (t ? t.x : 0); }, 0);
  }

  // ------------------------------------------------------------------ advancement math
  function esBonusCount(txp) {
    var n = 0;
    CROWS.ES_ADV.forEach(function (r) { if (txp >= r[0]) n++; });
    if (txp >= 60000) n += Math.floor((txp - 30000) / 30000);
    return n;
  }
  function maxUses(txp) {
    var m = 2;
    CROWS.ES_ADV.forEach(function (r) { if (txp >= r[0]) m = r[1]; });
    return m;
  }
  function charBonusCount(txp) {
    var n = 0;
    CROWS.CHAR_ADV.forEach(function (t) { if (txp >= t) n++; });
    if (txp >= 60000) n += Math.floor((txp - 30000) / 30000);
    return n;
  }
  function syncBonusArrays() {
    var n = esBonusCount(state.txp);
    while (state.esBonus.length < n) state.esBonus.push('uses');
    state.esBonus.length = n;
    var c = charBonusCount(state.txp);
    while (state.charBonus.length < c) state.charBonus.push('');
    state.charBonus.length = c;
    // trim expertise allocations beyond the pool
    var pool = usePool(), total = allocTotal();
    if (total > pool) {
      Object.keys(state.esAlloc).reverse().forEach(function (k) {
        while (total > pool && state.esAlloc[k] > 0) { state.esAlloc[k]--; total--; }
        if (!state.esAlloc[k]) delete state.esAlloc[k];
      });
    }
  }
  function usePool() {
    return state.esBonus.reduce(function (s, o) { return s + (o === 'uses' ? 3 : o === 'mix' ? 1 : 0); }, 0);
  }
  function allocTotal() { return Object.keys(state.esAlloc).reduce(function (s, k) { return s + state.esAlloc[k]; }, 0); }

  // ------------------------------------------------------------------ derived character
  function characteristics() {
    var b = bg();
    var two = b.two.indexOf(state.twoChar) >= 0 ? state.twoChar : b.two[0];
    var others = CROWS.CHARS.filter(function (c) { return c !== two; });
    var high = others.indexOf(state.highChar) >= 0 ? state.highChar : others[0];
    var low = others[0] === high ? others[1] : others[0];
    var v = {};
    v[two] = 2;
    if (state.pattern === 'm12') { v[high] = 2; v[low] = -1; } else { v[high] = 1; v[low] = 0; }
    var base = clone(v), extraStamina = 0;
    state.charBonus.forEach(function (c) {
      if (!c) return;
      if (CROWS.CHARS.every(function (k) { return v[k] >= 4; })) { extraStamina += 2; return; }
      if (v[c] < 4) v[c]++;
    });
    return { values: v, base: base, two: two, high: high, low: low, extraStamina: extraStamina };
  }
  function expertiseUses() {
    var out = {}, b = bg();
    Object.keys(b.exp).forEach(function (k) { out[k] = b.exp[k]; });
    Object.keys(state.esAlloc).forEach(function (k) { out[k] = (out[k] || 0) + state.esAlloc[k]; });
    return out;
  }
  function staminaMax() {
    var s = bg().stamina;
    state.esBonus.forEach(function (o) { if (o === 'stamina') s += 2; else if (o === 'mix') s += 1; });
    return s + characteristics().extraStamina;
  }
  function curStamina() {
    var m = staminaMax(), p = state.play.stamina;
    return p === null ? m : Math.max(0, Math.min(m, p));
  }
  function adMax(card) {
    var it = item(card.key), m = /Parry (\d+)/.exec(it.txt);
    return it.ad || (m ? +m[1] : 0);
  }
  function adNow(card) { return Math.max(0, adMax(card) - (card.dmg || 0)); }
  function woundCount() { return Object.keys(state.play.wounds).length; }
  function armorInfo() {
    var worn = null, shield = null;
    state.inv.forEach(function (c) {
      var it = item(c.key);
      if (it.cat === 'armor' && c.area === 'pack' && (!worn || it.ad > item(worn.key).ad)) worn = c;
      if (it.cat === 'shield' && c.area === 'hand') shield = c;
    });
    var parts = [], total = 0;
    if (worn) { parts.push(item(worn.key).ad + ' ' + worn.key.replace(' Armor', '').toLowerCase()); total += item(worn.key).ad; }
    if (shield) { parts.push(item(shield.key).ad + ' shield'); total += item(shield.key).ad; }
    return { total: total, text: parts.length ? parts.join(' + ') : '0', worn: worn, shield: shield };
  }

  // ------------------------------------------------------------------ inventory model
  function newCard(key, qty) { return { id: uid++, key: key, qty: qty, area: 'none', idx: 0 }; }
  function spanOf(card, area) {
    var it = item(card.key);
    if (area === 'hand' && it.hands === 2) return 2;
    return it.sl;
  }
  function beltSize() {
    var extra = ownedTraitIds().filter(function (id) { return CROWS.EXTRA_BELT_TRAITS[id.split('|')[1]]; }).length;
    return AREAS.belt + Math.min(extra, 1);
  }
  function areaSize(area) { return area === 'belt' ? beltSize() : AREAS[area]; }
  function occupancy() {
    var occ = { hand: [null, null], belt: [], pack: [] };
    for (var i = 0; i < beltSize(); i++) occ.belt.push(null);
    for (i = 0; i < 10; i++) occ.pack.push(null);
    state.inv.forEach(function (c) {
      if (c.area === 'none') return;
      var s = spanOf(c, c.area);
      for (var k = 0; k < s; k++) if (occ[c.area] && c.idx + k < occ[c.area].length) occ[c.area][c.idx + k] = c.id;
    });
    return occ;
  }
  function fits(card, area, idx, occ) {
    if (area === 'none') return true;
    var s = spanOf(card, area), size = areaSize(area);
    if (idx < 0 || idx + s > size) return false;
    if (area === 'pack' && s > 1 && Math.floor(idx / 5) !== Math.floor((idx + s - 1) / 5)) return false; // keep on one sheet row
    for (var k = 0; k < s; k++) { var o = occ[area][idx + k]; if (o !== null && o !== card.id) return false; }
    return true;
  }
  function firstFit(card, area, occ) {
    for (var i = 0; i < areaSize(area); i++) if (fits(card, area, i, occ)) return i;
    return -1;
  }
  function place(card, area, idx) {
    card.area = area; card.idx = idx;
  }
  function cardById(id) { for (var i = 0; i < state.inv.length; i++) if (state.inv[i].id === id) return state.inv[i]; return null; }

  // Build stacked cards from the kit + background gear.
  function startingCards() {
    var totals = {}, order = [];
    CROWS.STANDARD_KIT.concat(bg().gear).forEach(function (g) {
      if (!(g[0] in totals)) { totals[g[0]] = 0; order.push(g[0]); }
      totals[g[0]] += g[1];
    });
    var cards = [];
    order.forEach(function (k) {
      var q = totals[k], st = item(k).st;
      while (q > 0) { var n = Math.min(q, st); cards.push(newCard(k, n)); q -= n; }
    });
    return cards;
  }

  var PACK_ORDER = ['spell', 'consumable', 'light', 'weapon', 'ammo', 'shield', 'tool', 'trap', 'misc', 'magic', 'food', 'book', 'purse', 'bulky', 'armor'];
  function weaponScore(key) {
    var it = item(key);
    if (it.cat !== 'weapon') return -1;
    if (it.wt === 'Bow') return 2;
    if (key === 'Knife') return 1;
    if (it.sl === 2) return 5;
    return /Light/.test(it.txt) ? 3 : 4;
  }
  function autoArrange() {
    // merge identical stacks first
    var merged = {}, order = [], live = {};
    state.inv.forEach(function (c) {
      if (!(c.key in merged)) { merged[c.key] = 0; order.push(c.key); live[c.key] = liveProps(c, {}); }
      merged[c.key] += c.qty;
    });
    var cards = [];
    order.forEach(function (k) {
      var q = merged[k], st = item(k).st, first = true;
      while (q > 0) { var n = Math.min(q, st), nc = newCard(k, n); if (first) liveProps(live[k], nc); first = false; cards.push(nc); q -= n; }
    });
    state.inv = cards;
    var occ = occupancy();
    function put(c, area, idx) { place(c, area, idx); occ = occupancy(); }
    function takeOne(c) { // split a single item off a stack for a hand
      if (c.qty <= 1) return c;
      c.qty--; var n = newCard(c.key, 1); state.inv.push(n); return n;
    }
    var chars = characteristics().values;

    // Hands
    var weapons = cards.filter(function (c) { return weaponScore(c.key) >= 0; })
      .sort(function (a, b) { return weaponScore(b.key) - weaponScore(a.key); });
    var main = weapons[0] || null;
    var atkBook = cards.filter(function (c) { return item(c.key).atk; })[0];
    if (atkBook && (!main || weaponScore(main.key) <= 1) && chars.Mind >= 1) main = atkBook;
    if (main) { var m = takeOne(main); put(m, 'hand', 0); }
    var handFree = occ.hand[1] === null;
    if (handFree) {
      var off = cards.filter(function (c) { return item(c.key).cat === 'shield' && c.area === 'none'; })[0] ||
        cards.filter(function (c) { return item(c.key).cat === 'light' && c.key !== 'Candle' && c.area === 'none'; })[0] ||
        cards.filter(function (c) { return c.key === 'Knife' && c.area === 'none'; })[0];
      if (off) { var o = takeOne(off); if (fits(o, 'hand', 1, occ)) put(o, 'hand', 1); else o.area = 'none'; }
    }
    // Belt: quick-draw things
    var beltPri = ['light', 'weapon', 'ammo', 'shield', 'consumable', 'spell'];
    var pending = state.inv.filter(function (c) { return c.area === 'none'; });
    beltPri.forEach(function (cat) {
      pending.filter(function (c) { return item(c.key).cat === cat && c.area === 'none' && item(c.key).sl === 1; })
        .sort(function (a, b) { return (item(b.key).atk ? 1 : 0) - (item(a.key).atk ? 1 : 0); })
        .forEach(function (c) {
          var i = firstFit(c, 'belt', occ); if (i >= 0) put(c, 'belt', i);
        });
    });
    // Backpack: most useful first (low slot numbers are easiest to draw), armor last.
    pending = state.inv.filter(function (c) { return c.area === 'none'; });
    pending.sort(function (a, b) {
      var pa = PACK_ORDER.indexOf(item(a.key).cat), pb = PACK_ORDER.indexOf(item(b.key).cat);
      return (pa < 0 ? 8 : pa) - (pb < 0 ? 8 : pb);
    });
    pending.forEach(function (c) {
      var i = firstFit(c, 'pack', occ);
      if (i < 0 && item(c.key).sl === 1) i = -1;
      if (i >= 0) put(c, 'pack', i);
    });
    // Anything still unplaced: try the belt
    state.inv.filter(function (c) { return c.area === 'none'; }).forEach(function (c) {
      var i = firstFit(c, 'belt', occ); if (i >= 0) put(c, 'belt', i);
    });
  }

  function moveCard(card, area, idx) {
    var occ = occupancy();
    if (area === 'none') { card.area = 'none'; card.idx = 0; return true; }
    if (area === 'hand' && card.qty > 1) {
      var single = newCard(card.key, 1);
      if (!fits(single, 'hand', idx, occ)) return false;
      card.qty--; state.inv.push(single); place(single, 'hand', idx); return true;
    }
    // Stack onto an existing matching card?
    var targetId = occ[area] ? occ[area][idx] : null;
    if (targetId !== null && targetId !== card.id) {
      var tgt = cardById(targetId);
      if (tgt && tgt.key === card.key && area !== 'hand') {
        var room = item(card.key).st - tgt.qty;
        if (room > 0) {
          var n = Math.min(room, card.qty); tgt.qty += n; card.qty -= n;
          if (card.qty <= 0) state.inv = state.inv.filter(function (c) { return c !== card; });
          return true;
        }
      }
      // Swap two single-slot cards
      if (tgt && spanOf(tgt, area) === 1 && spanOf(card, area) === 1 && card.area !== 'none' &&
          spanOf(tgt, card.area) === 1 && !(card.area === 'hand' && tgt.qty > 1)) {
        var a = card.area, i = card.idx;
        place(card, area, idx); place(tgt, a, i); return true;
      }
      return false;
    }
    if (!fits(card, area, idx, occ)) return false;
    place(card, area, idx);
    return true;
  }

  // ------------------------------------------------------------------ state lifecycle
  function freshState(bgIndex) {
    var b = CROWS.BACKGROUNDS[bgIndex];
    var others = CROWS.CHARS.filter(function (c) { return c !== b.two[0]; });
    return {
      v: 1, bg: bgIndex, twoChar: b.two[0], pattern: '10', highChar: others[0],
      name: '', player: '', feature: '', village: '', institution: '', prosperity: 0,
      coins: 0, coinDice: null, bgDice: null,
      txp: 0, esBonus: [], esAlloc: {}, charBonus: [], traits: [],
      inv: [], connName: '', connRel: '', connBenefit: '', notes: '', pets: (b.pets || []).slice(),
      play: freshPlay()
    };
  }
  // Live, at-the-table state (Play mode). stamina null = at maximum; wounds maps backpack slot index -> 'w' or 's' (starvation).
  function freshPlay() {
    return { stamina: null, cruelty: 0, conds: {}, spent: {}, temp: {}, wounds: {}, dt: 0, miasma: false,
      pendingXP: 0, xpLog: [], log: [], magic: {}, magicMulti: {}, petStam: {} };
  }
  function normalizePlay(p) {
    var base = freshPlay();
    if (!p || typeof p !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (base[k] === null) return;
      if (!(k in p) || typeof p[k] !== typeof base[k] || Array.isArray(p[k]) !== Array.isArray(base[k]) || p[k] === null) p[k] = base[k];
    });
    if (p.stamina !== null && typeof p.stamina !== 'number') p.stamina = null;
    return p;
  }
  // Per-card live values kept across saves: ud = usage dice left, dmg = AD lost, ammo = shots left,
  // thrown = 1 while a thrown weapon is out of hand (Play mode: Recover clears it).
  var CARD_LIVE = ['ud', 'dmg', 'ammo', 'thrown'];
  function liveProps(src, dst) {
    CARD_LIVE.forEach(function (k) { if (typeof src[k] === 'number' && isFinite(src[k])) dst[k] = Math.max(0, Math.floor(src[k])); });
    return dst;
  }
  function rollCoins() {
    var r = [d(6), d(6), d(6)];
    state.coinDice = r;
    state.coins = r[0] + r[1] + r[2] + (bg().gc || 0);
  }
  function resetGear() {
    state.inv = startingCards();
    state.pets = (bg().pets || []).slice();
    autoArrange();
  }
  function setBackground(i, keepChars) {
    state.bg = i;
    var b = bg();
    if (b.two.indexOf(state.twoChar) < 0 || !keepChars) state.twoChar = b.two[0];
    var others = CROWS.CHARS.filter(function (c) { return c !== state.twoChar; });
    if (others.indexOf(state.highChar) < 0) state.highChar = others[0];
    pruneTraits();
    resetGear();
    rollCoins();
  }
  function randomName() { return pick(CROWS.NAME_IDEAS.first) + ' ' + pick(CROWS.NAME_IDEAS.last); }
  function randomCrow() {
    var r1 = d(6), r2 = d(6);
    var idx = CROWS.BACKGROUNDS.findIndex(function (b) { return b.d[0] === r1 && b.d[1] === r2; });
    var keep = { player: state ? state.player : '', village: state ? state.village : '', institution: state ? state.institution : '', prosperity: state ? state.prosperity : 0 };
    state = freshState(idx);
    state.bgDice = [r1, r2];
    var b = bg();
    state.twoChar = pick(b.two);
    var others = CROWS.CHARS.filter(function (c) { return c !== state.twoChar; });
    state.pattern = Math.random() < 0.5 ? '10' : 'm12';
    state.highChar = pick(others);
    state.name = randomName();
    state.feature = pick(CROWS.NAME_IDEAS.feature);
    state.connBenefit = pick(CROWS.CONNECTION_BENEFITS)[0];
    state.player = keep.player; state.village = keep.village; state.institution = keep.institution; state.prosperity = keep.prosperity || 0;
    resetGear();
    rollCoins();
  }
  var refView = !!(window.CrowsCloud && window.CrowsCloud.linked);   // a Ref looking at a player's shared character
  var lastRemote = 0;   // when a change made elsewhere was last brought in
  function save() {
    // In the Ref view this is someone else's character: don't overwrite the Ref's own copy in this browser.
    if (!refView) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
    if (window.CrowsCloud) window.CrowsCloud.changed();
  }
  function startNew() { if (window.CrowsCloud) window.CrowsCloud.startNew(); }
  /* The character as written to a save file (and to the player's account). */
  function exportState() {
    var data = clone(state);
    data.inv = data.inv.map(function (c) { return liveProps(c, { key: c.key, qty: c.qty, area: c.area, idx: c.idx }); });
    return data;
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { var s = JSON.parse(raw); if (validState(s)) return s; }
    } catch (e) { /* ignore */ }
    return null;
  }
  function validState(s) {
    return s && typeof s === 'object' && s.v === 1 && typeof s.bg === 'number' && CROWS.BACKGROUNDS[s.bg] && Array.isArray(s.inv);
  }
  function dice(v, n) {
    return Array.isArray(v) && v.length === n && v.every(function (x) { return x === (x | 0) && x >= 1 && x <= 6; }) ? v.slice() : null;
  }
  function adopt(s) {
    var base = freshState(s.bg);
    Object.keys(base).forEach(function (k) { if (!(k in s)) s[k] = base[k]; });
    s.inv = s.inv.filter(function (c) { return c && CROWS.ITEMS[c.key]; }).map(function (c) {
      return liveProps(c, { id: uid++, key: c.key, qty: Math.max(1, Math.min(item(c.key).st, c.qty | 0)), area: AREAS[c.area] ? c.area : 'none', idx: c.idx | 0 });
    });
    s.play = normalizePlay(s.play);
    // Older server copies turned an empty {} into []; named keys on an array would be dropped when saved.
    if (!s.esAlloc || typeof s.esAlloc !== 'object' || Array.isArray(s.esAlloc)) s.esAlloc = {};
    s.prosperity = typeof s.prosperity === 'number' && isFinite(s.prosperity) ? Math.max(-10, Math.min(10, Math.round(s.prosperity))) : 0;
    // Dice shown as markup: only real d6 rolls (a file or a shared sheet could hold anything here).
    s.bgDice = dice(s.bgDice, 2);
    s.coinDice = dice(s.coinDice, 3);
    state = s;
    syncBonusArrays();
    pruneTraits();
    // Drop any overlapping placements from hand-edited files.
    var seen = { hand: {}, belt: {}, pack: {} };
    state.inv.forEach(function (c) {
      if (c.area === 'none') return;
      var s2 = spanOf(c, c.area), ok = c.idx + s2 <= areaSize(c.area);
      for (var k = 0; ok && k < s2; k++) if (seen[c.area][c.idx + k]) ok = false;
      if (!ok) { c.area = 'none'; return; }
      for (k = 0; k < s2; k++) seen[c.area][c.idx + k] = true;
    });
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    syncBonusArrays();
    renderBackground();
    renderChars();
    renderIdentity();
    renderExpertise();
    renderTraits();
    renderInventory();
    renderVillage();
    renderAdvance();
    renderSummary();
    if (window.CrowsPlay) window.CrowsPlay.render();
    save();
  }

  function renderBackground() {
    var b = bg();
    $('bg-select').value = String(state.bg);
    $('bg-dice').innerHTML = state.bgDice ? 'Rolled <b>' + DIE[state.bgDice[0]] + ' ' + DIE[state.bgDice[1]] + '</b> (' + state.bgDice[0] + ', ' + state.bgDice[1] + ')' : '';
    var st = findTrait(b.trait[0], b.trait[1]);
    var gear = b.gear.map(function (g) { return g[0] + (g[1] > 1 ? ' (' + g[1] + ')' : ''); });
    if (b.pets) gear = gear.concat(b.pets.map(function (p) { return p + ' (pet)'; }));
    if (b.gc) gear.push(b.gc + ' extra gc');
    var box = $('bg-details');
    box.innerHTML = '';
    box.appendChild(el('p', { class: 'blurb', text: b.blurb }));
    var dl = el('dl');
    function row(k, v) { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
    row('Roll', b.d[0] + ', ' + b.d[1]);
    row('Characteristic at 2', b.two.length === 3 ? 'Any' : b.two.join(' or '));
    row('Stamina', String(b.stamina));
    row('Starting trait', b.trait[0] + ': ' + (st ? st.n : b.trait[1]));
    row('Expertises', Object.keys(b.exp).map(function (k) { return k + (b.exp[k] > 1 ? ' (' + b.exp[k] + ' uses)' : ''); }).join(', '));
    row('Equipment', gear.join(', '));
    box.appendChild(dl);
  }

  function renderChars() {
    var b = bg(), ch = characteristics();
    var sel = $('char-two'); sel.innerHTML = '';
    b.two.forEach(function (c) { sel.appendChild(el('option', { value: c, text: c })); });
    sel.value = ch.two; sel.disabled = b.two.length === 1;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pattern]'), function (r) { r.checked = r.value === state.pattern; });
    var hs = $('char-high'); hs.innerHTML = '';
    CROWS.CHARS.filter(function (c) { return c !== ch.two; }).forEach(function (c) {
      hs.appendChild(el('option', { value: c, text: c + (state.pattern === 'm12' ? ' (2, other gets -1)' : ' (1, other gets 0)') }));
    });
    hs.value = ch.high;
    var disp = $('char-display'); disp.innerHTML = '';
    CROWS.CHARS.forEach(function (c) {
      var v = ch.values[c], bonus = v - ch.base[c];
      disp.appendChild(el('div', { class: 'stat' + (c === ch.two ? ' two' : '') }, [
        el('div', { class: 'lbl', text: c + ' (' + CROWS.CHAR_ABBR[c] + ')' }),
        el('div', { class: 'val', text: String(v) }),
        bonus ? el('div', { class: 'lbl', text: '+' + bonus + ' from TXP' }) : null
      ]));
    });
  }

  function renderIdentity() {
    [['in-name', 'name'], ['in-player', 'player'], ['in-feature', 'feature']].forEach(function (p) {
      if (document.activeElement !== $(p[0])) $(p[0]).value = state[p[1]];
    });
  }

  function renderExpertise() {
    var uses = expertiseUses(), mx = maxUses(state.txp), pool = usePool(), used = allocTotal(), b = bg();
    var ds = $('derived-stats'); ds.innerHTML = '';
    var ai = armorInfo();
    [['Stamina', staminaMax()], ['Speed', CROWS.BASE_SPEED], ['Armor AD', ai.text], ['Max uses', mx]].forEach(function (p) {
      ds.appendChild(el('div', { class: 'stat' }, [el('div', { class: 'lbl', text: p[0] }), el('div', { class: 'val', text: String(p[1]) })]));
    });
    var ban = $('alloc-banner');
    if (pool > 0) {
      ban.hidden = false;
      ban.className = 'banner ' + (used === pool ? 'ok' : 'warn');
      ban.textContent = 'Advancement: ' + used + ' of ' + pool + ' bonus expertise uses assigned. Use + / - to assign them (max ' + mx + ' uses per expertise).';
    } else ban.hidden = true;
    var grid = $('exp-grid'); grid.innerHTML = '';
    Object.keys(CROWS.EXPERTISES).forEach(function (cat) {
      var col = el('div', { class: 'exp-col' }, [el('h3', { text: cat })]);
      CROWS.EXPERTISES[cat].forEach(function (e) {
        var n = e[0], u = uses[n] || 0, baseU = b.exp[n] || 0, extra = state.esAlloc[n] || 0;
        var pips = el('span', { class: 'pips', title: u + ' use' + (u === 1 ? '' : 's') });
        for (var i = 0; i < Math.max(u, 0); i++) pips.appendChild(el('span', { class: 'pip ' + (i < baseU ? 'on' : 'bonus') }));
        var kids = [el('span', { text: n, title: e[1] }), pips];
        if (pool > 0) {
          kids.push(el('span', { class: 'pips' }, [
            el('button', { type: 'button', class: 'pm', text: '−', 'aria-label': 'Remove a use of ' + n, disabled: extra <= 0, onclick: function () { state.esAlloc[n]--; if (!state.esAlloc[n]) delete state.esAlloc[n]; render(); } }),
            el('button', { type: 'button', class: 'pm', text: '+', 'aria-label': 'Add a use of ' + n, disabled: used >= pool || u >= mx, onclick: function () { state.esAlloc[n] = extra + 1; render(); } })
          ]));
        }
        col.appendChild(el('div', { class: 'exp-row ' + (u ? 'has' : 'none'), title: e[1] }, kids));
      });
      grid.appendChild(col);
    });
  }

  function traitCard(id, bought) {
    var p = id.split('|'), t = findTrait(p[0], p[1]);
    if (!t) return null;
    var head = el('div', { class: 't-head' }, [
      el('span', {}, [el('span', { class: 't-name', text: t.n }), ' ', el('span', { class: 't-tree', text: p[0] + (bought ? ' · ' + fmt(t.x) + ' XP' : ' · starting trait from background') })])
    ]);
    if (bought) head.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Remove', onclick: function () {
      state.traits = state.traits.filter(function (x) { return x !== id; }); pruneTraits(); render();
    } }));
    return el('div', { class: 'trait' + (bought ? ' bought' : '') }, [head, el('p', { text: t.d })]);
  }

  function renderTraits() {
    var list = $('trait-list'); list.innerHTML = '';
    list.appendChild(traitCard(startingTraitId(), false));
    state.traits.forEach(function (id) { var c = traitCard(id, true); if (c) list.appendChild(c); });
    var unspent = state.txp - traitXP();
    $('xp-chip').textContent = fmt(Math.max(unspent, 0)) + ' XP unspent';
    var ts = $('tree-select');
    if (!ts.options.length) CROWS_TRAIT_TREES.forEach(function (t) { ts.appendChild(el('option', { value: t.tree, text: t.tree })); });
    if (!ts.value) ts.value = bg().trait[0];
    var tree = TREE_BY_NAME[ts.value];
    $('tree-sub').textContent = tree.sub;
    var grid = $('tree-grid'); grid.innerHTML = '';
    var owned = ownedTraitIds();
    var sorted = tree.traits.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    sorted.forEach(function (t) {
      var id = traitId(tree.tree, t.n), has = owned.indexOf(id) >= 0;
      var learnable = !has && canLearn(tree.tree, t, owned);
      var afford = unspent >= t.x;
      var btn = null;
      if (has) btn = el('span', { class: 'chip', text: id === startingTraitId() ? 'Starting trait' : 'Owned' });
      else btn = el('button', { type: 'button', class: 'btn btn-small', disabled: !(learnable && afford),
        title: !learnable ? 'Not connected to a trait you own' : !afford ? 'Not enough unspent XP' : 'Buy this trait',
        text: 'Buy (' + fmt(t.x) + ' XP)', onclick: function () { state.traits.push(id); render(); } });
      grid.appendChild(el('div', { class: 'tnode' + (has ? ' owned' : learnable ? '' : ' locked') }, [
        el('span', { class: 'n', text: t.n }),
        el('span', { class: 'c', text: fmt(t.x) + ' XP' + (t.r === 0 ? ' (starting)' : '') }),
        el('p', { text: t.d }), btn
      ]));
    });
  }

  // ---- inventory rendering + interaction
  var dragId = null;
  function cardEl(c) {
    var it = item(c.key);
    var meta = [];
    if (it.st > 1) meta.push(c.qty + ' / ' + it.st);
    if (it.sl > 1) meta.push(it.sl + ' slots');
    if (it.hands === 2) meta.push('2 hands');
    var n = el('div', { class: 'inv-card cat-' + it.cat + (selectedId === c.id ? ' sel' : ''), draggable: 'true', tabindex: '0', role: 'button',
      'aria-label': c.key + (c.qty > 1 ? ' x' + c.qty : ''), 'data-id': c.id }, [
      el('span', { class: 'ic-name', text: c.key + (c.qty > 1 ? ' ×' + c.qty : '') }),
      meta.length ? el('span', { class: 'ic-meta', text: meta.join(' · ') }) : null,
      el('span', { class: 'ic-txt', text: it.txt })
    ]);
    n.addEventListener('click', function (e) { e.stopPropagation(); selectedId = selectedId === c.id ? null : c.id; renderInventory(); });
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.click(); } });
    n.addEventListener('dragstart', function (e) { dragId = c.id; try { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ } });
    n.addEventListener('dragend', function () { dragId = null; });
    return n;
  }
  function dropTarget(node, area, idx) {
    node.addEventListener('dragover', function (e) { if (dragId !== null) { e.preventDefault(); node.classList.add('drop-ok'); } });
    node.addEventListener('dragleave', function () { node.classList.remove('drop-ok'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault(); node.classList.remove('drop-ok');
      var c = cardById(dragId); dragId = null;
      if (c) attemptMove(c, area, idx);
    });
    node.addEventListener('click', function () {
      if (selectedId === null) return;
      var c = cardById(selectedId);
      if (c) attemptMove(c, area, idx);
    });
  }
  function attemptMove(c, area, idx) {
    if (moveCard(c, area, idx)) { selectedId = null; render(); }
    else toast(area === 'hand' ? 'That won\'t fit in your hands.' : 'Not enough adjacent free slots there.');
  }

  function slotLabel(word, num) {
    return el('span', { class: 's-lbl' }, [el('span', { class: 's-word', text: word + ' ' }), num]);
  }
  function renderInventory() {
    var inv = $('inventory'); inv.innerHTML = '';
    var occ = occupancy();
    var sel = selectedId !== null ? cardById(selectedId) : null;
    function rowEl(label, area, count, cellsTotal) {
      inv.appendChild(el('div', { class: 'inv-row-label', text: label }));
      var row = el('div', { class: 'inv-row' });
      var i = 0;
      var base = area === 'pack2' ? 5 : 0;
      var realArea = area === 'pack2' ? 'pack' : area;
      while (i < cellsTotal) {
        var slotIdx = base + i;
        if (i >= count) {
          row.appendChild(el('div', { class: 'slot disabled', 'aria-hidden': 'true' }, [el('span', { class: 's-lbl', text: realArea === 'belt' ? 'Extra (trait)' : '' })]));
          i++; continue;
        }
        var cid = occ[realArea][slotIdx];
        var c = cid !== null ? cardById(cid) : null;
        var word = realArea === 'hand' ? 'Hand' : realArea === 'belt' ? 'Belt' : 'Backpack';
        var lbl = word + ' ' + (slotIdx + 1);
        if (c && c.idx === slotIdx) {
          var sp = spanOf(c, realArea);
          var cell = el('div', { class: 'slot', style: sp > 1 ? 'grid-column: span ' + sp : null }, [slotLabel(word, (slotIdx + 1) + (sp > 1 ? '\u2013' + (slotIdx + sp) : '')), cardEl(c)]);
          dropTarget(cell, realArea, slotIdx);
          row.appendChild(cell);
          i += sp;
        } else if (c) {
          i++; // covered by a spanning card that started in the previous row (shouldn't happen)
        } else {
          var canHere = sel ? fits(sel.qty > 1 && realArea === 'hand' ? { id: -1, key: sel.key, qty: 1 } : sel, realArea, slotIdx, occ) : false;
          var empty = el('div', { class: 'slot empty' + (canHere ? ' target' : ''), tabindex: sel ? '0' : null, role: sel ? 'button' : null, 'aria-label': lbl + ' (empty)' },
            [slotLabel(word, String(slotIdx + 1))]);
          dropTarget(empty, realArea, slotIdx);
          empty.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); } });
          row.appendChild(empty);
          i++;
        }
      }
      inv.appendChild(row);
    }
    rowEl('Hands (equipped, not stackable)', 'hand', 2, 5);
    rowEl('Belt', 'belt', beltSize(), 5);
    rowEl('Backpack', 'pack', 5, 5);
    rowEl('', 'pack2', 5, 5);

    var tray = $('tray'); tray.innerHTML = '';
    var loose = state.inv.filter(function (c) { return c.area === 'none'; });
    if (!loose.length) tray.appendChild(el('span', { class: 'tray-empty', text: 'Nothing set aside.' }));
    loose.forEach(function (c) { tray.appendChild(cardEl(c)); });
    if (!tray._wired) { dropTarget(tray, 'none', 0); tray._wired = true; }

    // warnings
    var warns = [];
    if (loose.length) warns.push(loose.length + ' item card' + (loose.length > 1 ? 's are' : ' is') + ' not carried. Only carried items go in the inventory on your sheet.');
    var ai = armorInfo();
    state.inv.forEach(function (c) { if (item(c.key).cat === 'armor' && c.area !== 'pack' && c.area !== 'none') warns.push(c.key + ' only protects you when worn from your backpack.'); });
    var coinCap = state.inv.filter(function (c) { return c.key === 'Coin Purse' && c.area !== 'none'; }).length * 500;
    if (state.coins > coinCap) warns.push('You carry ' + fmt(state.coins) + ' gc but your purses hold ' + fmt(coinCap) + '. Loose coins take a slot per 250.');
    var wb = $('inv-warnings'); wb.hidden = !warns.length; wb.textContent = warns.join(' ');
    void ai;

    // detail panel
    var det = $('card-detail');
    if (!sel) { det.hidden = true; }
    else {
      det.hidden = false; det.innerHTML = '';
      var it = item(sel.key);
      det.appendChild(el('h3', { text: sel.key }));
      det.appendChild(el('p', { text: it.txt }));
      det.appendChild(el('p', { class: 'fine', text: 'Stack ' + it.st + ' · ' + it.sl + ' slot' + (it.sl > 1 ? 's' : '') + (it.gc ? ' · ' + fmt(it.gc) + ' gc' : '') + ' · Now: ' +
        (sel.area === 'none' ? 'not carried' : sel.area === 'hand' ? 'hand ' + (sel.idx + 1) : sel.area === 'belt' ? 'belt ' + (sel.idx + 1) : 'backpack ' + (sel.idx + 1)) +
        '. Click a highlighted slot to move it.' }));
      var ctr = el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn btn-small', text: '− 1', disabled: sel.qty <= 1, onclick: function () { sel.qty--; render(); } }),
        el('span', { text: 'Qty ' + sel.qty }),
        el('button', { type: 'button', class: 'btn btn-small', text: '+ 1', disabled: sel.qty >= it.st || sel.area === 'hand', onclick: function () { sel.qty++; render(); } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Set aside', disabled: sel.area === 'none', onclick: function () { moveCard(sel, 'none', 0); render(); } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Delete card', onclick: function () {
          state.inv = state.inv.filter(function (x) { return x !== sel; }); selectedId = null; render();
        } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Done', onclick: function () { selectedId = null; renderInventory(); } })
      ]);
      det.appendChild(ctr);
    }

    // pets
    var pets = $('pets'); pets.innerHTML = '';
    if (state.pets.length) {
      pets.appendChild(el('h3', { text: 'Pets' }));
      state.pets.forEach(function (p) { pets.appendChild(el('div', { class: 'pet', text: CROWS.PETS[p] || p })); });
    }
    if (document.activeElement !== $('in-coins')) $('in-coins').value = state.coins;
    $('coin-dice').innerHTML = state.coinDice ? '<b>' + state.coinDice.map(function (x) { return DIE[x]; }).join(' ') + '</b> = ' + (state.coinDice[0] + state.coinDice[1] + state.coinDice[2]) + (bg().gc ? ' + ' + bg().gc : '') : '';
  }

  function renderVillage() {
    [['in-village', 'village'], ['in-conn-name', 'connName'], ['in-conn-rel', 'connRel'], ['in-notes', 'notes']].forEach(function (p) {
      if (document.activeElement !== $(p[0])) $(p[0]).value = state[p[1]];
    });
    $('in-institution').value = state.institution;
    if (document.activeElement !== $('in-prosperity')) $('in-prosperity').value = state.prosperity;
    $('in-conn-benefit').value = state.connBenefit;
    var b = CROWS.CONNECTION_BENEFITS.filter(function (x) { return x[0] === state.connBenefit; })[0];
    $('conn-benefit-text').textContent = b ? b[1] : '';
  }

  function renderAdvance() {
    if (document.activeElement !== $('in-txp')) $('in-txp').value = state.txp;
    var spent = traitXP(), unspent = state.txp - spent;
    $('xp-summary').innerHTML = 'Traits bought: <b>' + fmt(spent) + ' XP</b> · Unspent: <b style="color:' + (unspent < 0 ? 'var(--bad)' : 'inherit') + '">' + fmt(unspent) + ' XP</b> · Max uses per expertise: <b>' + maxUses(state.txp) + '</b>';
    var list = $('bonus-list'); list.innerHTML = '';
    state.esBonus.forEach(function (o, i) {
      var s = el('select', { 'aria-label': 'Expertise and Stamina bonus ' + (i + 1), onchange: function () { state.esBonus[i] = this.value; render(); } }, [
        el('option', { value: 'uses', text: '+3 expertise uses' }),
        el('option', { value: 'stamina', text: '+2 Stamina maximum' }),
        el('option', { value: 'mix', text: '+1 expertise use and +1 Stamina' })
      ]);
      s.value = o;
      list.appendChild(el('div', { class: 'bonus' }, [el('b', { text: ordinal(i + 1) + ' Expertise & Stamina bonus' }), s]));
    });
    state.charBonus.forEach(function (o, i) {
      var s = el('select', { 'aria-label': 'Characteristic bonus ' + (i + 1), onchange: function () { state.charBonus[i] = this.value; render(); } },
        [el('option', { value: '', text: 'Choose a characteristic (+1, max 4)' })].concat(CROWS.CHARS.map(function (c) { return el('option', { value: c, text: c + ' +1' }); })));
      s.value = o;
      list.appendChild(el('div', { class: 'bonus' }, [el('b', { text: ordinal(i + 1) + ' Characteristic bonus' }), s]));
    });
    if (!state.esBonus.length && !state.charBonus.length) list.appendChild(el('p', { class: 'hint', text: 'No bonuses yet. The first Expertise & Stamina bonus arrives at 100 TXP; the first characteristic bonus at 5,000 TXP.' }));
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function checklist() {
    var items = [];
    items.push([state.name.trim() ? 'ok' : 'todo', state.name.trim() ? 'Named' : 'Give your crow a name']);
    items.push([state.feature.trim() ? 'ok' : 'todo', state.feature.trim() ? 'Distinguishing feature' : 'Pick a distinguishing feature']);
    items.push([state.connName.trim() && state.connBenefit ? 'ok' : 'todo', state.connName.trim() && state.connBenefit ? 'NPC connection' : 'Make an NPC connection and pick a benefit']);
    var loose = state.inv.filter(function (c) { return c.area === 'none'; }).length;
    items.push([loose ? 'todo' : 'ok', loose ? loose + ' item(s) not carried' : 'All gear carried']);
    var pool = usePool(), used = allocTotal();
    if (pool) items.push([used === pool ? 'ok' : 'err', used === pool ? 'Bonus expertise uses assigned' : 'Assign ' + (pool - used) + ' more bonus expertise use(s)']);
    if (state.charBonus.some(function (c) { return !c; })) items.push(['err', 'Choose characteristic bonus(es)']);
    if (state.txp - traitXP() < 0) items.push(['err', 'Traits cost more XP than you have']);
    return items;
  }

  function renderSummary() {
    var ch = characteristics().values, ai = armorInfo();
    var body = $('summary-body'); body.innerHTML = '';
    body.appendChild(el('div', { class: 'sum-name', text: state.name || 'Unnamed crow' }));
    body.appendChild(el('div', { class: 'sum-bg', text: bg().name + (state.feature ? ' · ' + state.feature : '') }));
    var g = el('div', { class: 'sum-stats' });
    CROWS.CHARS.forEach(function (c) { g.appendChild(el('div', {}, [el('b', { text: String(ch[c]) }), el('span', { text: c })])); });
    [['Stamina', staminaMax()], ['Speed', CROWS.BASE_SPEED], ['AD', ai.total]].forEach(function (p) {
      g.appendChild(el('div', {}, [el('b', { text: String(p[1]) }), el('span', { text: p[0] })]));
    });
    body.appendChild(g);
    var inHands = state.inv.filter(function (c) { return c.area === 'hand'; }).map(function (c) { return c.key + (c.thrown ? ' (thrown)' : ''); });
    body.appendChild(el('div', { class: 'fine', text: 'Hands: ' + (inHands.join(', ') || 'empty') + ' · ' + fmt(state.coins) + ' gc' }));
    var cl = $('checklist'); cl.innerHTML = '';
    checklist().forEach(function (c) { cl.appendChild(el('div', { class: c[0], text: c[1] })); });
  }

  // ------------------------------------------------------------------ PDF export
  var WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function pdfSafe(s) {
    return String(s || '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/●/g, '•').replace(/−/g, '-')
      .replace(/\r\n?/g, '\n').replace(/[^\n\x20-\x7e\xa0-\xff]/g, function (c) { return WINANSI_EXTRA.indexOf(c) >= 0 ? c : '?'; });
  }
  function wrapLines(text, font, size, width) {
    var out = [];
    text.split('\n').forEach(function (para) {
      var words = para.split(' '), line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }
  function fitSize(text, font, w, h, maxSize, minSize) {
    for (var s = maxSize; s >= minSize; s -= 0.25) {
      var lines = wrapLines(text, font, s, w - 4);
      var tooWide = lines.some(function (l) { return font.widthOfTextAtSize(l, s) > w - 4; });
      if (!tooWide && lines.length * s * 1.16 <= h - 3) return s;
    }
    return minSize;
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function slotText(c, cont) {
    var it = item(c.key);
    if (cont) return '(' + c.key + ', continued)';
    var head = c.key.toUpperCase() + (c.qty > 1 ? '  x' + c.qty : '');
    var meta = 'Stack ' + it.st + (it.sl > 1 ? ' | ' + it.sl + ' slots' : '') + (it.gc ? ' | ' + fmt(it.gc) + ' gc' : '');
    return head + '\n' + meta + '\n' + it.txt;
  }
  function fieldValues() {
    var v = {}, ch = characteristics().values, uses = expertiseUses(), ai = armorInfo(), b = bg();
    v['Name'] = state.name; v['Background'] = b.name; v['Player'] = state.player; v['Feature'] = state.feature;
    v['Village'] = state.village;
    CROWS.CHARS.forEach(function (c) { v[c] = String(ch[c]); });
    var pl = state.play;
    v['Stamina Max'] = String(staminaMax()); v['Stamina Current'] = String(curStamina());
    v['Speed'] = String(CROWS.BASE_SPEED);
    var adParts = [ai.worn, ai.shield].filter(Boolean).map(function (c) { return adNow(c) + (c.dmg ? '/' + adMax(c) : '') + ' ' + (c === ai.shield ? 'shield' : c.key.replace(' Armor', '').toLowerCase()); });
    var adTotal = [ai.worn, ai.shield].filter(Boolean).reduce(function (s, c) { return s + adNow(c); }, 0);
    v['Armor AD'] = adParts.length ? adTotal + (adParts.length > 1 || adTotal !== ai.total ? '\n(' + adParts.join(' + ') + ')' : '') : '0';
    v['Coins'] = String(state.coins); v['Cruelty'] = String(pl.cruelty);
    Object.keys(pl.conds).forEach(function (k) { if (pl.conds[k]) v['Cond ' + k] = true; });
    Object.keys(uses).forEach(function (k) { if (uses[k]) v['Exp ' + k] = String(uses[k]); });
    Object.keys(pl.spent).forEach(function (k) { for (var i = 1; i <= pl.spent[k]; i++) v['Exp ' + k + ' Spent ' + i] = true; });
    Object.keys(pl.wounds).forEach(function (i) { v['Wound ' + (+i + 1)] = true; });
    Object.keys(pl.magic).forEach(function (k) { if (pl.magic[k]) v['Slot ' + k] = pl.magic[k]; });
    Object.keys(pl.magicMulti || {}).forEach(function (k) {
      if (pl.magicMulti[k]) v['Slot ' + k] = (v['Slot ' + k] ? v['Slot ' + k] + ' ' : '') + '[2+ items: no rest, 1d6 wounds/DT]';
    });
    v['Max Uses'] = String(maxUses(state.txp));
    var spent = traitXP();
    v['TXP'] = fmt(state.txp); v['XP Spent'] = fmt(spent); v['XP Unspent'] = fmt(state.txp - spent);
    var esLabels = { uses: '+3 uses', stamina: '+2 Stamina', mix: '+1 use/+1 Stamina' };
    v['ES Bonuses'] = state.esBonus.length ? state.esBonus.length + ' taken' : '0';
    v['Char Bonuses'] = state.charBonus.length ? state.charBonus.filter(Boolean).map(function (c) { return CROWS.CHAR_ABBR[c] + '+1'; }).join(', ') : '0';
    var traits = ownedTraitIds().map(function (id, i) {
      var p = id.split('|'), t = findTrait(p[0], p[1]);
      return t ? t.n + ' (' + p[0] + (i === 0 ? ', background' : ', ' + fmt(t.x) + ' XP') + '): ' + t.d : id;
    });
    v['Traits'] = traits.join('\n');
    var pets = state.pets.map(function (p, i) {
      var st = pl.petStam[i];
      return (CROWS.PETS[p] || p) + (typeof st === 'number' ? ' [Stamina now ' + st + ']' : '');
    });
    v['Pets'] = pets.join('\n') || '';
    v['Connection Name'] = state.connName; v['Connection Relationship'] = state.connRel;
    var ben = CROWS.CONNECTION_BENEFITS.filter(function (x) { return x[0] === state.connBenefit; })[0];
    v['Connection Benefit'] = ben ? ben[0] + ': ' + ben[1] : '';
    var notes = [];
    if (state.notes.trim()) notes.push(state.notes.trim());
    var inst = ['Blacksmith', 'Crypt', 'General Store', 'Inn', 'Temple'].concat(state.institution ? [state.institution] : []);
    notes.push('Village institutions (1st level): ' + inst.join(', ') + '. Prosperity ' + state.prosperity + '.');
    if (pl.pendingXP) notes.push('XP awaiting a rest: ' + fmt(pl.pendingXP) + '.');
    if (state.esBonus.length) notes.push('E&S bonuses: ' + state.esBonus.map(function (o) { return esLabels[o]; }).join('; ') + '.');
    var loose = state.inv.filter(function (c) { return c.area === 'none'; });
    if (loose.length) notes.push('Left at home: ' + loose.map(function (c) { return c.key + (c.qty > 1 ? ' x' + c.qty : ''); }).join(', ') + '.');
    v['Notes'] = notes.join('\n');
    // Inventory
    var names = { hand: 'Hand ', belt: 'Belt ', pack: 'Backpack ' };
    state.inv.forEach(function (c) {
      if (c.area === 'none') return;
      var s = spanOf(c, c.area);
      for (var k = 0; k < s; k++) {
        var i = c.idx + k, fname = c.area === 'belt' && i >= 4 ? 'Belt Extra' : names[c.area] + (i + 1);
        v[fname] = slotText(c, k > 0);
      }
    });
    if (beltSize() > 4 && !v['Belt Extra']) {
      var tname = ownedTraitIds().map(function (id) { return id.split('|')[1]; }).filter(function (n) { return CROWS.EXTRA_BELT_TRAITS[n]; })[0];
      v['Belt Extra'] = 'Extra belt slot (' + tname + ': ' + CROWS.EXTRA_BELT_TRAITS[tname] + ')';
    }
    return v;
  }

  function buildPdf() {
    var P = window.PDFLib;
    return P.PDFDocument.load(b64ToBytes(CROWS_TEMPLATE_B64)).then(function (doc) {
      return doc.embedFont(P.StandardFonts.Helvetica).then(function (font) {
        var form = doc.getForm(), pages = doc.getPages(), vals = fieldValues(), mx = maxUses(state.txp), uses = expertiseUses();
        CROWS_FIELDS.forEach(function (f) {
          var page = pages[f.page], ph = page.getHeight();
          var rect = { x: f.x, y: ph - f.y - f.h, width: f.w, height: f.h, borderWidth: 0, borderColor: undefined, backgroundColor: undefined };
          if (f.kind === 'check') {
            // one spent-use box per use (capped at max uses); 1 box on unowned expertises a lore book can grant
            var spent = /^Exp (.+) Spent (\d+)$/.exec(f.name);
            if (spent) {
              var n = uses[spent[1]] ? Math.min(uses[spent[1]], mx) : (CROWS.ITEMS['Lore Book (' + spent[1] + ')'] ? 1 : 0);
              if (+spent[2] > n) return;
            }
            var cb = form.createCheckBox(f.name);
            cb.addToPage(page, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderWidth: 0.75, borderColor: P.rgb(0.12, 0.11, 0.12), backgroundColor: P.rgb(1, 1, 1) });
            if (vals[f.name] === true) cb.check();
            return;
          }
          var tf = form.createTextField(f.name);
          var text = pdfSafe(vals[f.name] || '');
          if (f.multiline) tf.enableMultiline();
          if (f.align === 'center') tf.setAlignment(P.TextAlignment.Center);
          tf.setText(text);
          var size = f.size || 8;
          if (f.multiline) size = text ? fitSize(text, font, f.w, f.h, f.size || (f.page === 1 ? 9.5 : 9), 4.5) : (f.size || 8);
          else if (text) {
            while (size > 5 && font.widthOfTextAtSize(text, size) > f.w - 4) size -= 0.5;
          }
          tf.addToPage(page, rect);
          tf.setFontSize(size);
        });
        form.updateFieldAppearances(font);
        doc.setTitle((state.name || 'Crow') + ' - Crows Character Sheet');
        doc.setSubject('Crows Playtest 2 character: ' + bg().name);
        doc.setCreator('The Nest (Crows Playtest 2 character generator)');
        return doc.save();
      });
    });
  }
  function download(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, filename); return; }
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  function fileBase() { return (state.name || 'crow').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'crow'; }
  function exportPdf(btn) {
    if (!window.PDFLib) { toast('PDF library failed to load.'); return; }
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'Building PDF...';
    buildPdf().then(function (bytes) {
      download(bytes, fileBase() + '_Crows_Character.pdf', 'application/pdf');
      toast('PDF downloaded.');
    }).catch(function (e) {
      console.error(e); toast('Could not build the PDF: ' + (e && e.message ? e.message : e));
    }).then(function () { btn.disabled = false; btn.textContent = old; });
  }

  // ------------------------------------------------------------------ wiring
  function bind() {
    var bs = $('bg-select');
    CROWS.BACKGROUNDS.forEach(function (b, i) { bs.appendChild(el('option', { value: String(i), text: b.d[0] + '-' + b.d[1] + '  ' + b.name })); });
    bs.addEventListener('change', function () { state.bgDice = null; setBackground(+this.value, true); render(); });
    $('btn-roll-bg').addEventListener('click', function () {
      var r1 = d(6), r2 = d(6);
      var i = CROWS.BACKGROUNDS.findIndex(function (b) { return b.d[0] === r1 && b.d[1] === r2; });
      state.bgDice = [r1, r2]; setBackground(i, true); render();
      toast('Rolled ' + r1 + ', ' + r2 + ': ' + bg().name);
    });
    $('char-two').addEventListener('change', function () {
      state.twoChar = this.value;
      var others = CROWS.CHARS.filter(function (c) { return c !== state.twoChar; });
      if (others.indexOf(state.highChar) < 0) state.highChar = others[0];
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pattern]'), function (r) {
      r.addEventListener('change', function () { state.pattern = this.value; render(); });
    });
    $('char-high').addEventListener('change', function () { state.highChar = this.value; render(); });

    function text(id, key) { $(id).addEventListener('input', function () { state[key] = this.value; renderSummary(); save(); }); }
    text('in-name', 'name'); text('in-player', 'player'); text('in-feature', 'feature'); text('in-village', 'village');
    text('in-conn-name', 'connName'); text('in-conn-rel', 'connRel'); text('in-notes', 'notes');
    $('btn-rand-name').addEventListener('click', function () { state.name = randomName(); render(); });
    $('btn-rand-feature').addEventListener('click', function () { state.feature = pick(CROWS.NAME_IDEAS.feature); render(); });

    $('in-coins').addEventListener('input', function () { var n = parseInt(this.value, 10); state.coins = isNaN(n) || n < 0 ? 0 : n; state.coinDice = null; renderSummary(); save(); });
    $('in-coins').addEventListener('change', function () { renderInventory(); });
    $('btn-roll-coins').addEventListener('click', function () { rollCoins(); render(); });
    $('btn-arrange').addEventListener('click', function () { selectedId = null; autoArrange(); render(); toast('Inventory arranged.'); });
    $('btn-reset-gear').addEventListener('click', function () {
      if (!confirm('Replace your inventory with the starting gear for ' + bg().name + '?')) return;
      selectedId = null; resetGear(); render();
    });
    var ai = $('add-item-select');
    var groups = { weapon: 'Weapons', ammo: 'Weapons', armor: 'Armor', shield: 'Armor', consumable: 'Alchemy', spell: 'Spellbooks', magic: 'Magic items' };
    var byGroup = {};
    Object.keys(CROWS.ITEMS).sort().forEach(function (k) { var g = groups[item(k).cat] || 'Gear'; (byGroup[g] = byGroup[g] || []).push(k); });
    ['Weapons', 'Armor', 'Gear', 'Alchemy', 'Spellbooks', 'Magic items'].forEach(function (g) {
      var og = el('optgroup', { label: g });
      (byGroup[g] || []).forEach(function (k) { og.appendChild(el('option', { value: k, text: k + (item(k).gc ? ' (' + fmt(item(k).gc) + ' gc)' : '') })); });
      ai.appendChild(og);
    });
    $('btn-add-item').addEventListener('click', function () {
      var key = ai.value, q = Math.max(1, Math.min(99, parseInt($('add-item-qty').value, 10) || 1));
      var st = item(key).st, placed = 0, added = 0;
      while (q > 0) {
        var n = Math.min(q, st), c = newCard(key, n);
        state.inv.push(c); q -= n; added++;
        var occ = occupancy();
        var spot = ['pack', 'belt'].map(function (a) { return [a, firstFit(c, a, occ)]; }).filter(function (x) { return x[1] >= 0; })[0];
        if (spot) { place(c, spot[0], spot[1]); placed++; }
      }
      render();
      toast(placed === added ? 'Added ' + key + '.' : 'Added ' + key + ' (no room for all of it; see "Not carried").');
    });

    var inst = $('in-institution');
    inst.appendChild(el('option', { value: '', text: '(not chosen yet)' }));
    CROWS.STARTING_INSTITUTIONS.forEach(function (n) { inst.appendChild(el('option', { value: n, text: n })); });
    inst.addEventListener('change', function () { state.institution = this.value; save(); });
    $('in-prosperity').addEventListener('change', function () {
      var n = parseInt(this.value, 10); state.prosperity = isNaN(n) ? 0 : Math.max(-10, Math.min(10, n)); render();
    });
    var cb = $('in-conn-benefit');
    cb.appendChild(el('option', { value: '', text: '(choose a benefit)' }));
    CROWS.CONNECTION_BENEFITS.forEach(function (b) { cb.appendChild(el('option', { value: b[0], text: b[0] })); });
    cb.addEventListener('change', function () { state.connBenefit = this.value; render(); });

    $('in-txp').addEventListener('change', function () {
      var n = parseInt(this.value, 10); state.txp = isNaN(n) || n < 0 ? 0 : Math.min(n, 999999); render();
    });
    $('tree-select').addEventListener('change', function () { renderTraits(); });

    $('btn-random').addEventListener('click', function () { startNew(); selectedId = null; randomCrow(); render(); toast('A new crow: ' + state.name + ', ' + bg().name + '.'); });
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Start a new character? Unsaved changes to this one will be lost.')) return;
      startNew(); selectedId = null; state = freshState(0); resetGear(); rollCoins(); render();
    });
    $('btn-save').addEventListener('click', function () {
      download(JSON.stringify(exportState(), null, 2), fileBase() + '_Crows_Character.json', 'application/json');
    });
    $('file-load').addEventListener('change', function () {
      var f = this.files && this.files[0]; var input = this;
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (!validState(s)) throw new Error('not a Crows character file');
          startNew(); selectedId = null; adopt(s); render(); toast('Loaded ' + (state.name || 'character') + '.');
        } catch (e) { toast('Could not load that file: ' + e.message); }
        input.value = '';
      };
      rd.readAsText(f);
    });
    $('btn-pdf').addEventListener('click', function () { exportPdf(this); });
    $('btn-pdf-2').addEventListener('click', function () { exportPdf(this); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedId !== null) { selectedId = null; renderInventory(); } });
  }

  // Expose a tiny API for testing/debugging.
  window.CrowsApp = {
    get state() { return state; }, fieldValues: function () { return fieldValues(); }, buildPdf: buildPdf,
    randomCrow: function () { randomCrow(); render(); }, setBackground: function (i) { setBackground(i, true); render(); },
    // Shared with play.js (Play mode).
    core: {
      render: render, save: save, toast: toast, el: el, $: $, d: d, fmt: fmt, signed: signed, ordinal: ordinal, DIE: DIE,
      item: item, bg: bg, characteristics: characteristics, staminaMax: staminaMax, curStamina: curStamina,
      expertiseUses: expertiseUses, maxUses: maxUses, armorInfo: armorInfo, adMax: adMax, adNow: adNow,
      woundCount: woundCount, occupancy: occupancy, cardById: cardById, spanOf: spanOf, traitXP: traitXP,
      esBonusCount: esBonusCount, charBonusCount: charBonusCount, usePool: usePool, allocTotal: allocTotal
    }
  };

  /*
   * The Save character button (right column, logged in only). A new character isn't in the account until it's
   * pressed (cloud.js holds it: manualNew); after that it autosaves, and the button just shows that it's saved.
   */
  function updateSaveBox(s) {
    var box = $('acct-save'), C = window.CrowsCloud;
    if (!box) return;
    if (refView || !C || !C.user) { box.hidden = true; return; }
    var held = C.held, saving = s === 'saving' || s === 'loading';
    box.hidden = false; box.innerHTML = '';
    box.appendChild(el('button', { type: 'button', class: 'btn wide ' + (held ? 'btn-primary' : 'btn-ghost'), disabled: saving || (!held && s === 'saved'),
      text: saving ? 'Saving\u2026' : held ? 'Save character' : s === 'saved' ? 'Saved \u2713' : 'Save character', onclick: function () { C.saveNow(); } }));
    box.appendChild(el('p', { class: 'fine', text: held ? 'Not in your account yet. Once you save it, your changes save automatically.'
      : s === 'saved' ? 'In your account. Changes save automatically.' : s === 'error' ? 'Not saved yet: trying again. Your work is kept in this browser.'
      : s === 'conflict' ? 'Changed elsewhere: choose which version to keep.' : '' }));
  }

  /*
   * A short description of a change brought in from elsewhere (the Ref, or the player's other device): the new
   * session log entries, which say what happened (Lost 3 Stamina, 130 XP...), plus whatever else changed that
   * isn't logged. `before` is the sheet as it was here just before.
   */
  function describeChange(before) {
    if (!before) return '';
    var now = exportState(), seen = {}, msgs = [], other = [];
    function log(c) { return c.play && Array.isArray(c.play.log) ? c.play.log : []; }
    function differs(get) { try { return JSON.stringify(get(before)) !== JSON.stringify(get(now)); } catch (e) { return false; } }
    log(before).forEach(function (e) { seen[e.t + '|' + e.m] = true; });
    log(now).forEach(function (e) { if (!seen[e.t + '|' + e.m] && e.m) msgs.unshift(e.m); });   // oldest first
    [['equipment', function (c) { return c.inv; }], ['notes', function (c) { return c.notes; }],
     ['coins', function (c) { return c.coins; }], ['conditions', function (c) { return c.play && c.play.conds; }]]
      .concat(msgs.length ? [] : [['Stamina', function (c) { return c.play && c.play.stamina; }],
        ['wounds', function (c) { return c.play && c.play.wounds; }], ['cruelty', function (c) { return c.play && c.play.cruelty; }],
        ['XP', function (c) { return [c.txp, c.play && c.play.pendingXP]; }]])
      .forEach(function (f) { if (differs(f[1])) other.push(f[0]); });
    var text = msgs.slice(0, 2).join(' ') + (msgs.length > 2 ? ' (and ' + (msgs.length - 2) + ' more in the session log)' : '');
    if (other.length) text += (text ? ' ' : '') + other.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + ' changed.';
    return text;
  }

  function refOps(fn) { return function (a) { var q = window.CrowsPlay && window.CrowsPlay.refOps; return q ? q[fn](a) : null; }; }
  function init() {
    bind();
    var s = load();
    if (s) { adopt(s); } else { randomCrow(); }
    render();
    if (window.CrowsCloud) window.CrowsCloud.attach({
      kind: 'characters',
      manualNew: true,   // new characters wait for the Save character button
      onStatus: updateSaveBox,
      getData: exportState,
      valid: validState,
      apply: function (data) { selectedId = null; adopt(clone(data)); render(); },
      // Changes the Ref Screen sent to a linked sheet (play.js), redone on top if the player saved meanwhile.
      refOps: { start: refOps('start'), saved: refOps('saved'), canRedo: refOps('canRedo'), redo: refOps('redo') },
      fresh: function () { selectedId = null; randomCrow(); render(); },
      name: function (c) { return c.name || 'Unnamed crow'; },
      summary: function (c) {
        var b = CROWS.BACKGROUNDS[c.bg];
        return [b ? b.name : '', c.txp ? fmt(c.txp) + ' XP' : '', c.player ? 'played by ' + c.player : ''].filter(Boolean).join(' · ');
      },
      onServer: function () { if (window.CrowsPlay) window.CrowsPlay.syncAddress(); },
      onJoined: function (campaign) { if (window.CrowsPlay) window.CrowsPlay.joined(campaign); },
      onReady: function (p) {
        if (window.CrowsPlay && (p.mode === 'play' || p.mode === 'build')) window.CrowsPlay.setMode(p.mode);
        if (window.CrowsPlay) window.CrowsPlay.loadCampaign();
        if (window.CrowsRefView) window.CrowsRefView.ready(state.name, window.CrowsCloud.owner);
      },
      onRemote: function (before) {
        // Changes now arrive within a second or two: say what changed each time, or if that can't be told, just
        // that something did, once in a while.
        var t = Date.now(), what = describeChange(before);
        if ((what || t - lastRemote > 30000) && !(window.CrowsRefView && window.CrowsRefView.status)) {
          toast((refView ? 'The player changed this character' : 'Changed by your Ref or on another device') + (what ? ': ' + what : '.'), what ? 6000 : 0);
        }
        lastRemote = t;
        if (window.CrowsRefView) window.CrowsRefView.ready(state.name, window.CrowsCloud.owner);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
