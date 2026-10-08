/*
 * The sheet math shared by Play mode (src/play.js, src/state.js) and the Ref Screen (ref/src/ref-party.js): a crow's derived
 * numbers (Stamina max, AD, wounds...) and the changes a Ref makes to it (applyRefChange), done on a character object in its
 * saved form (exportState in state.js: bg, inv, pets, txp, play...). No DOM. Needs CROWS (src/game-data.js) and src/shared/
 * dom.js (fmt), dice.js, rules.js. window.CrowsSheet.
 */
(function () {
  'use strict';
  var Dice = window.CrowsDice, Rules = window.CrowsRules, fmt = window.CrowsDom.fmt, d = Dice.d;
  var CONDITIONS = ['Blessed', 'Grabbed', 'Prone', 'Vulnerable', 'Weakened', 'Unconscious'];
  var MAGIC_SLOTS = ['Head', 'Neck', 'Waist', 'Arms', 'Finger', 'Feet'];
  var PET_FEED = { 'Riding Horse': 2 };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function item(key) { return CROWS.ITEMS[key] || { cat: 'misc', st: 1, sl: 1, gc: 0, txt: '' }; }
  /*
   * Equipment the Ref made in the Workshop (ref-homebrew.js): its card travels with the fight (combat `defs`) and is kept on the
   * character that got one (character.hb: { name: card }), so the sheet knows its slots, stack, and text. A card is checked here, and
   * can never replace a card from the rules.
   */
  var OFFICIAL = {}; Object.keys(CROWS.ITEMS).forEach(function (k) { OFFICIAL[k] = true; });
  var ITEM_CATS = ['weapon', 'armor', 'shield', 'ammo', 'misc', 'tool', 'light', 'bulky', 'trap', 'food', 'purse', 'book', 'consumable', 'magic', 'spell'];
  function isOfficial(key) { return !!OFFICIAL[key]; }
  function cleanItem(d) {
    if (!d || typeof d !== 'object') return null;
    function n(v, lo, hi, dflt) { v = Math.round(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; }
    var o = { cat: ITEM_CATS.indexOf(d.cat) >= 0 ? d.cat : 'misc', st: n(d.st, 1, 99, 1), sl: n(d.sl, 1, 4, 1), gc: n(d.gc, 0, 1e7, 0), txt: String(d.txt || '').slice(0, 1500), custom: true };
    if (d.hands === 2) o.hands = 2;
    if (o.cat === 'armor' || o.cat === 'shield') o.ad = n(d.ad, 0, 99, 0);
    if (typeof d.wt === 'string' && /^(Bashing|Bow|Chopping|Slashing|Stabbing|Unarmed)$/.test(d.wt)) o.wt = d.wt;
    if (d.light) o.light = true;
    if (d.atk) o.atk = true;
    return o;
  }
  /* Add these cards ({ name: card }) to CROWS.ITEMS (never over a card from the rules). Returns the names added. */
  function registerItems(map) {
    var out = [];
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (k) { if (isOfficial(k) || !k || k.length > 80) return; var c = cleanItem(map[k]); if (c) { CROWS.ITEMS[k] = c; out.push(k); } });
    return out;
  }
  function unregisterItem(key) { if (!isOfficial(key)) delete CROWS.ITEMS[key]; }
  function bg(c) { return CROWS.BACKGROUNDS[c.bg]; }

  // ------------------------------------------------------------------ derived numbers
  function characteristics(c) {
    var b = bg(c);
    var two = b.two.indexOf(c.twoChar) >= 0 ? c.twoChar : b.two[0];
    var others = CROWS.CHARS.filter(function (k) { return k !== two; });
    var high = others.indexOf(c.highChar) >= 0 ? c.highChar : others[0];
    var low = others[0] === high ? others[1] : others[0];
    var v = {};
    v[two] = 2;
    if (c.pattern === 'm12') { v[high] = 2; v[low] = -1; } else { v[high] = 1; v[low] = 0; }
    var base = clone(v), extraStamina = 0;
    (c.charBonus || []).forEach(function (k) {
      if (!k) return;
      if (CROWS.CHARS.every(function (x) { return v[x] >= 4; })) { extraStamina += 2; return; }
      if (v[k] < 4) v[k]++;
    });
    return { values: v, base: base, two: two, high: high, low: low, extraStamina: extraStamina };
  }
  function expertiseUses(c) {
    var out = {}, b = bg(c), alloc = c.esAlloc || {};
    Object.keys(b.exp).forEach(function (k) { out[k] = b.exp[k]; });
    Object.keys(alloc).forEach(function (k) { out[k] = (out[k] || 0) + alloc[k]; });
    return out;
  }
  function staminaMax(c) {
    var s = bg(c).stamina;
    (c.esBonus || []).forEach(function (o) { if (o === 'stamina') s += 2; else if (o === 'mix') s += 1; });
    return s + characteristics(c).extraStamina;
  }
  function curStamina(c) {
    var m = staminaMax(c), p = c.play.stamina;
    return p === null ? m : Math.max(0, Math.min(m, p));
  }
  function setStamina(c, v) { var m = staminaMax(c); v = Math.max(0, Math.min(m, v)); c.play.stamina = v >= m ? null : v; }
  function adMax(card) {
    var it = item(card.key), m = /Parry (\d+)/.exec(it.txt);
    return it.ad || (m ? +m[1] : 0);
  }
  function adNow(card) { return Math.max(0, adMax(card) - (card.dmg || 0)); }
  function woundCount(c) { return Object.keys(c.play.wounds).length; }
  function armorInfo(c) {
    var worn = null, shield = null;
    c.inv.forEach(function (x) {
      var it = item(x.key);
      if (it.cat === 'armor' && x.area === 'pack' && (!worn || it.ad > item(worn.key).ad)) worn = x;
      if (it.cat === 'shield' && x.area === 'hand') shield = x;
    });
    var parts = [], total = 0;
    if (worn) { parts.push(item(worn.key).ad + ' ' + worn.key.replace(' Armor', '').toLowerCase()); total += item(worn.key).ad; }
    if (shield) { parts.push(item(shield.key).ad + ' shield'); total += item(shield.key).ad; }
    return { total: total, text: parts.length ? parts.join(' + ') : '0', worn: worn, shield: shield };
  }

  // ------------------------------------------------------------------ live (Play) state
  // stamina null = at maximum; wounds maps backpack slot index -> 'w' or 's' (starvation).
  // dt = the last dungeon turn the Ref ended; lastRest = { dt, by: 'self' | 'ref', t, extras } (see doRest);
  // xpClaims = treasure the player asked their Ref to award XP for, while the crow is in a campaign; claimsAnswered = the ids
  // the Ref answered (the Ref only adds to this list, and only the player's sheet changes xpClaims, so the two never clash).
  function freshPlay() {
    return { stamina: null, cruelty: 0, conds: {}, spent: {}, temp: {}, wounds: {}, dt: 0, miasma: false,
      pendingXP: 0, xpLog: [], log: [], magic: {}, magicMulti: {}, petStam: {}, got: [], xpClaims: [], claimsAnswered: [], lastRest: null };
  }
  function normalizePlay(p) {
    var base = freshPlay();
    if (!p || typeof p !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (base[k] === null) return;
      if (!(k in p) || typeof p[k] !== typeof base[k] || Array.isArray(p[k]) !== Array.isArray(base[k]) || p[k] === null) p[k] = base[k];
    });
    if (p.stamina !== null && typeof p.stamina !== 'number') p.stamina = null;
    p.xpClaims = p.xpClaims.filter(function (x) { return x && p.claimsAnswered.indexOf(x.id) < 0; });
    return p;
  }
  /* The sheet's log, newest first (Play's Session log card). */
  function addLog(c, msg) {
    var l = c.play.log;
    l.unshift({ t: Date.now(), m: msg });
    if (l.length > 200) l.length = 200;
  }

  // ------------------------------------------------------------------ inventory
  function carried(c) { return c.inv.filter(function (x) { return x.area !== 'none'; }); }
  function inHands(c) { return c.inv.filter(function (x) { return x.area === 'hand'; }).sort(function (a, b) { return a.idx - b.idx; }); }
  function cardById(c, id) { for (var i = 0; i < c.inv.length; i++) if (c.inv[i].id === id) return c.inv[i]; return null; }
  function findCarried(c, key) { return carried(c).filter(function (x) { return x.key === key; })[0] || null; }
  /* The backpack's 10 slots: the id of the card in each, or null. */
  function packOcc(c) {
    var occ = [], i;
    for (i = 0; i < 10; i++) occ.push(null);
    c.inv.forEach(function (x) {
      if (x.area !== 'pack') return;
      for (var k = 0; k < item(x.key).sl; k++) if (x.idx + k < 10) occ[x.idx + k] = x.id;
    });
    return occ;
  }
  function udInfo(key) {
    var m = /UD:?\s*(\d+)\s*\(([^)]*)\)/.exec(item(key).txt);
    if (!m) return null;
    var f = m[2];
    return { max: +m[1], useless: /Useless/.test(f), refuel: /Refuel/.test(f), rest: /Rest/.test(f), activate: /Activate/.test(f), dt: /DT/.test(f), fuel: /oil/i.test(f) ? 'Oil Flask' : null };
  }
  function udNow(card) { var u = udInfo(card.key); return u ? (typeof card.ud === 'number' ? Math.min(card.ud, u.max) : u.max) : 0; }
  function removeCard(c, card) { c.inv = c.inv.filter(function (x) { return x !== card; }); }
  /* Consume one item from a stack. */
  function useOne(c, card) {
    card.qty--; delete card.ud;
    if (card.qty <= 0) removeCard(c, card);
  }
  /* Roll a card's usage dice: each 1 or 2 is removed. */
  function rollUD(c, card, why) {
    var u = udInfo(card.key), n = udNow(card);
    if (!u || n <= 0) return card.key + ' has no usage dice left.';
    var r = []; for (var i = 0; i < n; i++) r.push(d(6));
    var lost = r.filter(function (x) { return x <= 2; }).length;
    card.ud = n - lost;
    var msg = card.key + ' UD' + (why ? ' (' + why + ')' : '') + ': rolled ' + r.join(', ') + (lost ? ' - lost ' + lost + ', ' + card.ud + ' left' : ' - no loss');
    if (card.ud === 0) {
      if (u.useless) { msg += '. It is used up'; useOne(c, card); if (card.qty > 0) msg += ' (' + card.qty + ' left in the stack)'; }
      else if (u.refuel) msg += '. Needs refuelling (' + (u.fuel || 'fuel') + ')';
      else if (u.rest) msg += '. Recharges on a rest';
    }
    return msg + '.';
  }

  // ------------------------------------------------------------------ damage and wounds
  /* What soaks damage: worn armor, then the parry weapons in hand (a thrown one isn't in hand to parry with). */
  function absorbers(c) {
    var ai = armorInfo(c), out = [];
    if (ai.worn) out.push(ai.worn);
    inHands(c).forEach(function (x) { if (!x.thrown && adMax(x) > 0 && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  /* Put n wounds in backpack slots: empty slots first, then the highest-numbered ones. Returns how many fit. */
  function addWounds(c, n, kind) {
    var p = c.play, occ = packOcc(c), placed = 0;
    var order = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    var free = order.filter(function (i) { return !p.wounds[i] && occ[i] === null; })
      .concat(order.filter(function (i) { return !p.wounds[i] && occ[i] !== null; }));
    for (var k = 0; k < n && k < free.length; k++) { p.wounds[free[k]] = kind || 'w'; placed++; }
    return placed;
  }
  /* Heal n ordinary wounds, freeing item slots first (restores speed). Returns how many were healed. */
  function healWounds(c, n) {
    var p = c.play, occ = packOcc(c), healed = 0;
    var ws = Object.keys(p.wounds).map(Number).filter(function (i) { return p.wounds[i] === 'w'; })
      .sort(function (a, b) { return (occ[b] !== null) - (occ[a] !== null) || b - a; });
    for (var k = 0; k < n && k < ws.length; k++) { delete p.wounds[ws[k]]; healed++; }
    return healed;
  }
  /*
   * Deal damage to this crow (the rules' order, Rules.damage): vulnerable, then the absorbers given (worn armor, shields,
   * parry weapons) unless piercing, then Stamina, then wounds. vul: a vulnerable roll already made. Returns { parts, total, vul }.
   */
  function dealDamage(c, amount, piercing, abs, vul) {
    var p = c.play, cur = curStamina(c), parts = [];
    var r = Rules.damage({ amount: amount, vulnerable: !!p.conds.Vulnerable, vul: vul, piercing: piercing, ad: abs.map(adNow),
      stamina: cur, woundRoom: 10 - woundCount(c) });
    if (r.vul) parts.push('vulnerable +' + r.vul);
    if (piercing) parts.push('piercing');
    abs.forEach(function (x, i) { if (r.absorbed[i]) { x.dmg = (x.dmg || 0) + r.absorbed[i]; parts.push(x.key + ' absorbs ' + r.absorbed[i] + ' (AD ' + adNow(x) + ' left)'); } });
    if (r.stamina) { setStamina(c, cur - r.stamina); parts.push('-' + r.stamina + ' Stamina'); }
    if (r.total - r.stamina - r.absorbed.reduce(function (t, a) { return t + a; }, 0) > 0) { var w = addWounds(c, r.wounds, 'w'); parts.push(w + ' wound' + (w === 1 ? '' : 's')); }
    return { parts: parts, total: r.total, vul: r.vul };
  }
  /* The numbers the Ref Screen shows and the combat tracker uses (AD from worn armor and parry weapons). */
  function vitals(c) {
    var abs = absorbers(c);
    return { st: curStamina(c), stMax: staminaMax(c), ad: abs.reduce(function (t, x) { return t + adNow(x); }, 0),
      adMax: abs.reduce(function (t, x) { return t + adMax(x); }, 0), wounds: woundCount(c), conds: clone(c.play.conds), cruelty: c.play.cruelty };
  }

  // ------------------------------------------------------------------ rest, dungeon turn, XP
  /* Blessed, vulnerable, and weakened end (the end of a DT, or halfway through a rest). */
  function endDTConditions(c) {
    var p = c.play, ended = Rules.DT_CONDITIONS.filter(function (k) { return p.conds[k]; });
    ended.forEach(function (k) { delete p.conds[k]; });
    return ended.length ? ended.join(', ') + ' ended.' : '';
  }
  // Rules: more than one magic item equipped in the same slot -> can't rest; 1d6 wounds at the end of each DT.
  function overloadedSlots(c) { var m = c.play.magicMulti || {}; return MAGIC_SLOTS.filter(function (k) { return m[k]; }); }
  /* The end of dungeon turn n, as the Ref Screen's "End DT" sends it (refChange endDT); players can't end one themselves. */
  function endDT(c, n) {
    var p = c.play, msgs = [], ended = endDTConditions(c);
    p.dt = n;
    if (ended) msgs.push(ended);
    inHands(c).forEach(function (x) { var u = udInfo(x.key); if (u && u.dt && udNow(x) > 0) msgs.push(rollUD(c, x, 'end of DT')); });
    var over = overloadedSlots(c);
    if (over.length) {
      var w = d(6), placed = addWounds(c, w, 'w');
      msgs.push('Two magic items in one slot (' + over.join(', ') + '): chaos deals 1d6 = ' + w + ' wound' + (w === 1 ? '' : 's') + (placed < w ? ' (' + placed + ' fit)' : '') + '.');
      if (woundCount(c) >= 10) msgs.push('All 10 backpack slots are wounded: your crow is dead.');
    }
    return 'End of dungeon turn ' + n + '. ' + (msgs.join(' ') || 'Nothing in hand burns down.');
  }
  function caretakerBonus(c) { return (c.prosperity || 0) >= 6 ? 3 : 2; }
  function surgicalKit(c) { return carried(c).filter(function (x) { return x.key === 'Surgical Kit' && udNow(x) > 0; })[0] || null; }
  function foodCards(c) { return carried(c).filter(function (x) { return x.key === 'Ration' || x.key === 'Hearty Ration'; }); }
  /*
   * A rest's effects on this crow, whoever started it: the player's Rest button, or the Ref Screen finishing the party's
   * rest (refChange rest). o: food ('Ration', 'Hearty Ration', 'none', or empty for a ration carried), activity (+ repair,
   * study, useKit), tended, tendedKit, caretaker, miasma, xp (false: pending XP waits), by ('self' or 'ref'), dt (the DT
   * the rest used up). Returns { ok, msg }. Records play.lastRest, so the same rest isn't taken twice (see refRest).
   */
  function doRest(c, o) {
    var p = c.play, msgs = [];
    var over = overloadedSlots(c);
    if (over.length) return { ok: false, msg: 'You can\'t rest with two magic items in one slot (' + over.join(', ') + ').' };
    p.lastRest = { dt: o.dt, by: o.by || 'self', t: Date.now() };
    var foods = foodCards(c);
    var food = o.food === 'none' ? null : foods.filter(function (x) { return x.key === (o.food || 'Ration'); })[0] || foods[0] || null;
    if (!food) {
      var sw = addWounds(c, 1, 's');
      return { ok: true, msg: 'No food: no rest benefits' + (sw ? ' and 1 starvation wound' : '') + '.' };
    }
    var hearty = food.key === 'Hearty Ration';
    useOne(c, food);
    msgs.push('Ate a ' + food.key.toLowerCase() + '.');
    var starve = Object.keys(p.wounds).filter(function (i) { return p.wounds[i] === 's'; });
    starve.forEach(function (i) { delete p.wounds[i]; });
    if (starve.length) msgs.push('Starvation wounds gone (' + starve.length + ').');
    setStamina(c, staminaMax(c));
    msgs.push('Stamina full.');
    var uses = expertiseUses(c);
    p.temp = {};
    if (o.miasma) {
      Object.keys(p.spent).forEach(function (k) { p.spent[k] = Math.min(p.spent[k], uses[k] || 0); if (!p.spent[k]) delete p.spent[k]; });
      msgs.push('In the Miasma: expertise uses are NOT restored. Make your Miasma RR.');
    } else {
      p.spent = {};
      msgs.push('Expertise uses restored.');
      if (p.cruelty) { p.cruelty = 0; msgs.push('Rested free of the Miasma: all cruelty lost.'); }
    }
    c.inv.forEach(function (x) { var u = udInfo(x.key); if (u && u.rest && udNow(x) < u.max) { x.ud = u.max; msgs.push(x.key + ' recharged.'); } });
    CONDITIONS.forEach(function (k) { if (k !== 'Grabbed') delete p.conds[k]; });
    var heal = 1 + (hearty ? 1 : 0) + restActivity(c, o, msgs);
    var h = healWounds(c, heal);
    if (h) msgs.push('Healed ' + h + ' wound' + (h === 1 ? '' : 's') + '.');
    // pets eat animal feed
    (c.pets || []).forEach(function (pet, i) {
      var need = PET_FEED[pet] || 1, have = carried(c).filter(function (x) { return x.key === 'Animal Feed'; }).reduce(function (t, x) { return t + x.qty; }, 0);
      if (have >= need) {
        for (var k = 0; k < need; k++) useOne(c, findCarried(c, 'Animal Feed'));
        delete p.petStam[i]; msgs.push('Your ' + pet.toLowerCase() + ' ate and rested.');
      } else msgs.push('Your ' + pet.toLowerCase() + ' had no animal feed (no rest benefit).');
    });
    if (p.pendingXP && o.xp !== false) msgs.push(applyXP(c));
    return { ok: true, msg: msgs.join(' ') };
  }
  /* The rest activity and the healing others give (Tend Wounds on me, my Caretaker): adds to msgs, returns the extra wounds healed. */
  function restActivity(c, o, msgs) {
    var p = c.play;
    if (o.activity === 'repair') {
      // By card id (the player's own rest), or by item name (rest choices sent to the Ref Screen, whose copy has no card ids):
      // the most damaged carried one.
      var rc = cardById(c, +o.repair) || c.inv.filter(function (x) { return x.key === o.repair && x.dmg && x.area !== 'none'; })
        .sort(function (a, b) { return b.dmg - a.dmg; })[0] || null;
      if (rc) { rc.dmg = 0; msgs.push('Repaired ' + rc.key + ' to full AD.'); }
    } else if (o.activity === 'study' && o.study) {
      p.temp[o.study] = 1; msgs.push('Studied a lore book: +1 use of ' + o.study + ' until the next rest.');
    } else if (o.activity === 'Tend Wounds') {
      var kit = o.useKit ? surgicalKit(c) : null;
      if (kit) msgs.push('Tended an ally\'s wounds with a surgical kit: they lose 3 wounds instead of 1. ' + rollUD(c, kit, 'Tend Wounds'));
      else msgs.push('Tended an ally\'s wounds: they lose 2 wounds instead of 1.');
    } else if (o.activity) msgs.push('Rest activity: ' + o.activity + '.');
    return (o.tended ? 1 : 0) + (o.tended && o.tendedKit ? 1 : 0) + (o.caretaker ? caretakerBonus(c) : 0);
  }
  /*
   * The Ref Screen finished the party's rest (refChange rest: { dt, miasma, xp }). Skipped if this crow already rested
   * from its own sheet during that dungeon turn (in the last 12 hours, so an old rest on an unsynced DT doesn't count).
   */
  function refRest(c, r) {
    var p = c.play, lr = p.lastRest;
    if (lr && lr.by === 'self' && lr.dt === r.dt && Date.now() - lr.t < 12 * 3600000) {
      p.dt = r.dt;
      return 'The party rested (DT ' + r.dt + '). You had already rested from your sheet this dungeon turn, so nothing more happens.';
    }
    // The player's choices sent from Play (r.chose): food, rest activity, healing from others; otherwise a ration and nothing more.
    var res = doRest(c, { by: 'ref', dt: r.dt, miasma: !!r.miasma || p.miasma, xp: r.xp, food: r.food, activity: r.activity, repair: r.repair, study: r.study,
      useKit: r.useKit, tended: r.tended, tendedKit: r.tendedKit, caretaker: r.caretaker });
    if (res.ok && r.chose && p.lastRest) p.lastRest.extras = true;   // nothing left to record on the Rest card
    p.dt = r.dt;
    return res.ok ? 'Rested with the party (DT ' + r.dt + '). ' + res.msg : 'The party rested (DT ' + r.dt + '), but you couldn\'t: ' + res.msg;
  }
  function applyXP(c) {
    var p = c.play, before = Rules.esBonusCount(c.txp), cb = Rules.charBonusCount(c.txp), gained = p.pendingXP;
    c.txp = Math.min(999999, c.txp + gained); p.pendingXP = 0;
    var msg = 'Gained ' + fmt(gained) + ' XP (TXP ' + fmt(c.txp) + ').';
    var nb = Rules.esBonusCount(c.txp) - before, nc = Rules.charBonusCount(c.txp) - cb;
    if (nb) msg += ' New Expertise & Stamina bonus' + (nb > 1 ? 'es' : '') + ' (' + nb + '): choose in Build > Advancement.';
    if (nc) msg += ' New characteristic bonus' + (nc > 1 ? 'es' : '') + ' (' + nc + ').';
    return msg;
  }

  // ------------------------------------------------------------------ the Ref's changes
  /*
   * A hit from the Ref Screen's combat tracker, dealt the way Take damage does it: vulnerable, then worn armor and parry
   * weapons, then Stamina, then wounds. The vulnerable roll is kept in the op so a replay deals the same.
   * o.result gets what happened, with the sheet as it was before (for o.restore, the tracker's Undo).
   */
  function refHit(c, o) {
    var p = c.play;
    var before = { stamina: p.stamina, wounds: clone(p.wounds), dmg: {} };
    c.inv.forEach(function (x) { if (x.dmg) before.dmg[x.id] = x.dmg; });
    var res = dealDamage(c, o.hit, !!o.piercing, absorbers(c).filter(function (x) { return adNow(x) > 0; }), o.vul), parts = res.parts;
    if (res.vul) o.vul = res.vul;
    if (p.conds.Unconscious) { delete p.conds.Unconscious; parts.push('wakes up'); }   // any damage wakes a sleeper
    o.result = { total: res.total, parts: parts, before: before };
    return 'Hit for ' + o.hit + (o.piercing ? ' piercing' : '') + (o.from ? ' by ' + o.from : '') + ': ' + parts.join(', ') + '.' +
      (woundCount(c) >= 10 ? ' All 10 backpack slots are wounded: your crow is dead.' : '');
  }
  function refRestore(c, b) {
    var p = c.play;
    p.stamina = b.stamina; p.wounds = clone(b.wounds || {});
    c.inv.forEach(function (x) { if (b.dmg && b.dmg[x.id]) x.dmg = b.dmg[x.id]; else delete x.dmg; });
    return 'The Ref took back a hit: Stamina, wounds, and armor are as they were.';
  }
  /*
   * A change the Ref Screen made to crow c (combat, rests, Miasma, XP), applied as steps rather than final values, so it adds
   * to whatever the player did meanwhile and can be replayed on a newer copy of the sheet. Any of:
   * hit (+ piercing, from, vul): damage, see refHit · restore: a hit taken back (o.result.before of that hit) ·
   * cond ({ name: true/false }): conditions on or off · rest ({ dt, miasma, xp, and the player's choices + chose }): the party's rest, applied in full (see refRest) ·
   * claims: XP claims the Ref answered (ids) · endDT: dungeon turn n ended · endConds: blessed, vulnerable, weakened end (with a rest) ·
   * dt: dungeon turn n ended (with a rest) · xp (+ desc, gc, n): pending XP · apply: pending XP into TXP · full: full Stamina ·
   * st: Stamina +/- · wounds: ordinary wounds +/- · cruelty: +/- · setCruelty: a new value.
   * Returns what happened, as sentences for the sheet's log (empty if nothing did).
   */
  function applyRefChange(c, o) {
    var p = c.play, msgs = [], n;
    if (o.hit) msgs.push(refHit(c, o));
    if (o.restore) msgs.push(refRestore(c, o.restore));
    if (o.cond) Object.keys(o.cond).forEach(function (k) {
      if (CONDITIONS.indexOf(k) < 0 || !!p.conds[k] === !!o.cond[k]) return;
      if (o.cond[k]) p.conds[k] = true; else delete p.conds[k];
      msgs.push((o.cond[k] ? 'Now ' : 'No longer ') + k.toLowerCase() + '.');
    });
    if (o.rest) msgs.push(refRest(c, o.rest));
    if (o.claims) {   // the player's own sheet takes them off its list (normalizePlay), even if they hadn't reached this copy yet
      o.claims.forEach(function (id) { if (p.claimsAnswered.indexOf(id) < 0) p.claimsAnswered.push(id); });
      if (p.claimsAnswered.length > 50) p.claimsAnswered.splice(0, p.claimsAnswered.length - 50);
      if (!o.xp) msgs.push('The Ref answered your XP claim without an award.');
    }
    if (o.endDT) msgs.push(endDT(c, o.endDT));
    if (o.endConds && (n = endDTConditions(c))) msgs.push('Resting: ' + n);
    if (o.dt && p.dt !== o.dt) { p.dt = o.dt; msgs.push('Dungeon turn ' + o.dt + ' ended with the rest.'); }
    if (o.xp) {
      p.pendingXP = Math.max(0, p.pendingXP + o.xp);
      p.xpLog.unshift({ t: Date.now(), desc: o.desc || 'Treasure', gc: o.gc | 0, n: o.n | 0 || 1, xp: o.xp });
      if (p.xpLog.length > 100) p.xpLog.length = 100;
      msgs.push((o.desc || 'Treasure') + (o.gc ? ' worth ' + fmt(o.gc) + ' gc' : '') + ': ' + fmt(o.xp) + ' XP (applies after the next rest).');
    }
    if (o.apply && p.pendingXP) msgs.push(applyXP(c));
    if (o.full && curStamina(c) < staminaMax(c)) { setStamina(c, staminaMax(c)); msgs.push('Back to full Stamina.'); }
    if (o.st) {
      n = curStamina(c); setStamina(c, n + o.st); n = curStamina(c) - n;
      if (n) msgs.push((n > 0 ? 'Regained ' : 'Lost ') + Math.abs(n) + ' Stamina (' + curStamina(c) + '/' + staminaMax(c) + ').');
    }
    if (o.wounds > 0 && (n = addWounds(c, o.wounds, 'w'))) msgs.push(n + ' wound' + (n === 1 ? '' : 's') + (woundCount(c) >= 10 ? ': all 10 backpack slots are wounded, your crow is dead.' : '.'));
    if (o.wounds < 0 && (n = healWounds(c, -o.wounds))) msgs.push('Healed ' + n + ' wound' + (n === 1 ? '' : 's') + '.');
    if (o.cruelty) { p.cruelty = Math.max(0, p.cruelty + o.cruelty); msgs.push('Cruelty ' + p.cruelty + '.'); }
    if (typeof o.setCruelty === 'number' && p.cruelty !== o.setCruelty) { p.cruelty = Math.max(0, o.setCruelty); msgs.push('Cruelty ' + p.cruelty + '.'); }
    return msgs;
  }

  window.CrowsSheet = { CONDITIONS: CONDITIONS, MAGIC_SLOTS: MAGIC_SLOTS, item: item, isOfficial: isOfficial, cleanItem: cleanItem, registerItems: registerItems, unregisterItem: unregisterItem, bg: bg, characteristics: characteristics,
    expertiseUses: expertiseUses, staminaMax: staminaMax, curStamina: curStamina, setStamina: setStamina, adMax: adMax, adNow: adNow,
    woundCount: woundCount, armorInfo: armorInfo, freshPlay: freshPlay, normalizePlay: normalizePlay, addLog: addLog,
    carried: carried, inHands: inHands, cardById: cardById, findCarried: findCarried, packOcc: packOcc, udInfo: udInfo, udNow: udNow,
    useOne: useOne, rollUD: rollUD, absorbers: absorbers, addWounds: addWounds, healWounds: healWounds, dealDamage: dealDamage, vitals: vitals,
    endDTConditions: endDTConditions, overloadedSlots: overloadedSlots, endDT: endDT, caretakerBonus: caretakerBonus, surgicalKit: surgicalKit,
    foodCards: foodCards, doRest: doRest, restActivity: restActivity, refRest: refRest, applyXP: applyXP, applyRefChange: applyRefChange };
})();
