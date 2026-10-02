/*
 * Character Generator: the inventory model: hand, belt, and backpack slots, multi-slot and two-handed items, stacks, starting
 * gear, auto-arrange, and moving cards. See state.js.
 */
(function () {
  'use strict';
  var A = window.CrowsGen, f = A.fwd;
  // From the other files (each call goes to the function there).
  var bg = f('bg'), characteristics = f('characteristics'), item = f('item'), liveProps = f('liveProps'), nextUid = f('nextUid'),
      ownedTraitIds = f('ownedTraitIds');
  var AREAS = A.AREAS;
  var state = A.state; A.share('state', function (v) { state = v; });

  // ------------------------------------------------------------------ inventory model
  function newCard(key, qty) { return { id: nextUid(), key: key, qty: qty, area: 'none', idx: 0 }; }
  function spanOf(card, area) {
    var it = item(card.key);
    if (area === 'hand' && it.hands === 2) return 2;
    return it.sl;
  }
  function extraBeltTraits() { return ownedTraitIds().map(function (id) { return id.split('|')[1]; }).filter(function (n) { return CROWS.EXTRA_BELT_TRAITS[n]; }); }
  function extraBeltRule() { return extraBeltTraits().map(function (n) { return CROWS.EXTRA_BELT_TRAITS[n]; }).join(' or '); }
  function beltSize() { return AREAS.belt + Math.min(extraBeltTraits().length, 1); }
  /* May this item go in the extra belt slot? Only what one of the crow's extra-slot traits allows. */
  function extraBeltOk(card) {
    return extraBeltTraits().some(function (n) { var ok = CROWS.EXTRA_BELT_ALLOWS[n]; return !ok || ok(card.key, item(card.key)); });
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
    if (area === 'belt' && idx + s > AREAS.belt && !extraBeltOk(card)) return false; // the trait's extra slot is restricted
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
          spanOf(tgt, card.area) === 1 && !(card.area === 'hand' && tgt.qty > 1) &&
          !(area === 'belt' && idx >= AREAS.belt && !extraBeltOk(card)) && !(card.area === 'belt' && card.idx >= AREAS.belt && !extraBeltOk(tgt))) {
        var a = card.area, i = card.idx;
        place(card, area, idx); place(tgt, a, i); return true;
      }
      return false;
    }
    if (!fits(card, area, idx, occ)) return false;
    place(card, area, idx);
    return true;
  }
  /* Move a card anywhere in an area: onto a matching stack with room, then the first free spot. Play's drag and drop. */
  function moveToArea(card, area) {
    if (area === card.area) return true;
    if (area === 'none') return moveCard(card, 'none', 0);
    if (area !== 'hand') {
      var stacks = state.inv.filter(function (c) { return c !== card && c.area === area && c.key === card.key && c.qty < item(c.key).st; });
      for (var i = 0; i < stacks.length && state.inv.indexOf(card) >= 0; i++) moveCard(card, area, stacks[i].idx);
      if (state.inv.indexOf(card) < 0) return true;   // all of it stacked
    }
    var probe = area === 'hand' && card.qty > 1 ? { id: -1, key: card.key, qty: 1 } : card;
    var spot = firstFit(probe, area, occupancy());
    return spot >= 0 && moveCard(card, area, spot);
  }
  /* Why a card can't go there, for the message. */
  function refusal(card, area, idx) {
    var it = item(card.key);
    if (area === 'hand') return it.hands === 2 || spanOf(card, 'hand') > 1 ? card.key + ' needs both hands free.' : 'Your hands are full.';
    if (area === 'belt' && beltSize() > AREAS.belt && (idx === undefined ? occupancy().belt[AREAS.belt] === null : idx + spanOf(card, 'belt') > AREAS.belt) && !extraBeltOk(card))
      return 'The extra belt slot holds ' + extraBeltRule() + '.';
    if (area === 'pack' && spanOf(card, 'pack') > 1) return card.key + ' needs ' + spanOf(card, 'pack') + ' free slots side by side in one backpack row.';
    return 'Not enough free slots there' + (spanOf(card, area) > 1 ? ' (' + card.key + ' takes ' + spanOf(card, area) + ')' : '') + '.';
  }
  /* Can a hand take one of these now (Pick Up Item needs a free hand; two-handed items need both)? */
  function handFits(key) { return firstFit({ id: -1, key: key, qty: 1 }, 'hand', occupancy()) >= 0; }
  /* An item handed over in a fight (picked up): into a free hand, else the backpack or belt, else set aside. Returns the area. */
  function takeItem(o) {
    var c = liveProps(o, newCard(o.key, Math.max(1, Math.min(item(o.key).st, o.qty | 0 || 1)))), occ = occupancy();
    state.inv.push(c);
    var spot = (c.qty === 1 ? ['hand', 'pack', 'belt'] : ['pack', 'belt']).map(function (a) { return [a, firstFit(c, a, occ)]; }).filter(function (x) { return x[1] >= 0; })[0];
    if (spot) place(c, spot[0], spot[1]);
    return c.area;
  }
  /* Add found or bought items: into the backpack, then the belt; whatever doesn't fit is set aside. True if all of it is carried. */
  function addItem(key, q) {
    var st = item(key).st, all = true;
    while (q > 0) {
      var n = Math.min(q, st), c = newCard(key, n);
      state.inv.push(c); q -= n;
      var occ = occupancy();
      var spot = ['pack', 'belt'].map(function (a) { return [a, firstFit(c, a, occ)]; }).filter(function (x) { return x[1] >= 0; })[0];
      if (spot) place(c, spot[0], spot[1]); else all = false;
    }
    return all;
  }

  A.add({ newCard: newCard, spanOf: spanOf, extraBeltTraits: extraBeltTraits, extraBeltRule: extraBeltRule, beltSize: beltSize,
      extraBeltOk: extraBeltOk, areaSize: areaSize, occupancy: occupancy, fits: fits, firstFit: firstFit, place: place, cardById: cardById,
      startingCards: startingCards, weaponScore: weaponScore, autoArrange: autoArrange, moveCard: moveCard, moveToArea: moveToArea, refusal: refusal,
      handFits: handFits, takeItem: takeItem, addItem: addItem, PACK_ORDER: PACK_ORDER });
})();
