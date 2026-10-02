/*
 * Crows Playtest 2 Character Generator: the character, loaded first. Plain browser JavaScript (no build step, no network).
 * Depends on PDFLib (pdf-lib), CROWS (game-data.js), CROWS_TRAIT_TREES (traits-data.js), CROWS_TEMPLATE_B64 / CROWS_FIELDS
 * (template-data.js), and src/shared/.
 *
 * The generator is split into state.js (helpers, traits, advancement, derived numbers, and the character’s lifecycle: new,
 * random, save, load), inventory.js (the slot rules), build-view.js (the Build page and its controls), pdf.js (the PDF), and
 * app.js (window.CrowsApp, account saving, start-up), loaded in that order. They share window.CrowsGen (A below).
 * Play mode (play.js, combat.js) uses window.CrowsApp.core.
 */
(function () {
  'use strict';
  // Shared by this app's files: their functions and constants (add), calls to another file's functions (fwd), and
  // the variables more than one file reassigns, kept in step in every file (share, set).
  var watch = {};
  var A = window.CrowsGen = {
    fwd: function (name) { return function () { return A[name].apply(this, arguments); }; },
    add: function (o) { Object.keys(o).forEach(function (k) { A[k] = o[k]; }); },
    share: function (name, fn) { (watch[name] = watch[name] || []).push(fn); },
    set: function (name, v) { A[name] = v; (watch[name] || []).forEach(function (fn) { fn(v); }); return v; }
  }, f = A.fwd;
  // From the other files (each call goes to the function there).
  var areaSize = f('areaSize'), autoArrange = f('autoArrange'), spanOf = f('spanOf'), startingCards = f('startingCards');
  var state = A.state; A.share('state', function (v) { state = v; });

  var STORAGE_KEY = 'crows-pt2-character';
  var AREAS = { hand: 2, belt: 4, pack: 10 };
  // state (the character) is shared: A.set('state', ...)
  var uid = 1;

  // ------------------------------------------------------------------ helpers
  var Dom = window.CrowsDom, Dice = window.CrowsDice, Rules = window.CrowsRules, Sheet = window.CrowsSheet;   // src/shared/
  var $ = Dom.$, el = Dom.el, fmt = Dom.fmt, signed = Dom.signed, clone = Dom.clone, d = Dice.d, pick = Dice.pick;
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  function toast(msg, ms) { Dom.toast(msg, ms || 2600); }
  function bg() { return CROWS.BACKGROUNDS[state.bg]; }
  function item(key) { return Sheet.item(key); }

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
  var esBonusCount = Rules.esBonusCount, maxUses = Rules.maxUses, charBonusCount = Rules.charBonusCount;
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

  // ------------------------------------------------------------------ derived character (src/shared/sheet.js)
  function characteristics() { return Sheet.characteristics(state); }
  function expertiseUses() { return Sheet.expertiseUses(state); }
  function staminaMax() { return Sheet.staminaMax(state); }
  function curStamina() { return Sheet.curStamina(state); }
  var adMax = Sheet.adMax, adNow = Sheet.adNow;
  function woundCount() { return Sheet.woundCount(state); }
  function armorInfo() { return Sheet.armorInfo(state); }

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
  // Live, at-the-table state (Play mode): see freshPlay in src/shared/sheet.js.
  var freshPlay = Sheet.freshPlay, normalizePlay = Sheet.normalizePlay;
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
    A.set('state', freshState(idx));
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
    s.inv = s.inv.filter(function (c) { return c && typeof c.key === 'string' && c.key && c.key.length <= 80; }).map(function (c) {
      return liveProps(c, { id: nextUid(), key: c.key, qty: Math.max(1, Math.min(item(c.key).st, c.qty | 0)), area: AREAS[c.area] ? c.area : 'none', idx: c.idx | 0 });
    });
    s.play = normalizePlay(s.play);
    if (typeof s.art !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(s.art) || s.art.length > 200000) delete s.art;
    if (!s.art || typeof s.artSm !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(s.artSm) || s.artSm.length > 30000) delete s.artSm;
    // Older server copies turned an empty {} into []; named keys on an array would be dropped when saved.
    if (!s.esAlloc || typeof s.esAlloc !== 'object' || Array.isArray(s.esAlloc)) s.esAlloc = {};
    s.prosperity = typeof s.prosperity === 'number' && isFinite(s.prosperity) ? Math.max(-10, Math.min(10, Math.round(s.prosperity))) : 0;
    // Dice shown as markup: only real d6 rolls (a file or a shared sheet could hold anything here).
    s.bgDice = dice(s.bgDice, 2);
    s.coinDice = dice(s.coinDice, 3);
    A.set('state', s);
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

  function nextUid() { return uid++; }   // ids for inventory cards

  A.add({ norm: norm, toast: toast, bg: bg, item: item, findTrait: findTrait, traitId: traitId, startingTraitId: startingTraitId,
      ownedTraitIds: ownedTraitIds, connected: connected, canLearn: canLearn, pruneTraits: pruneTraits, traitXP: traitXP,
      syncBonusArrays: syncBonusArrays, usePool: usePool, allocTotal: allocTotal, characteristics: characteristics, expertiseUses: expertiseUses,
      staminaMax: staminaMax, curStamina: curStamina, adMax: adMax, adNow: adNow, woundCount: woundCount, armorInfo: armorInfo,
      freshState: freshState, freshPlay: freshPlay, normalizePlay: normalizePlay, liveProps: liveProps, rollCoins: rollCoins, resetGear: resetGear,
      setBackground: setBackground, randomName: randomName, randomCrow: randomCrow, save: save, startNew: startNew, exportState: exportState,
      load: load, validState: validState, dice: dice, adopt: adopt, nextUid: nextUid, STORAGE_KEY: STORAGE_KEY, AREAS: AREAS, Dom: Dom, Dice: Dice,
      Rules: Rules, $: $, el: el, fmt: fmt, signed: signed, clone: clone, d: d, pick: pick, DIE: DIE, TREE_BY_NAME: TREE_BY_NAME,
      esBonusCount: esBonusCount, maxUses: maxUses, charBonusCount: charBonusCount, CARD_LIVE: CARD_LIVE, refView: refView });
})();
