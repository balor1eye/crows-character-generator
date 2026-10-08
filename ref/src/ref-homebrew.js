/*
 * Ref Screen: the Workshop tab. The Ref's own creatures and equipment, kept with the campaign in state.homebrew { creatures, items }.
 *
 * - Creatures: every stat a stat block has (type, size, power, Stamina, speeds, slots, A/M/S, AD, reactions, attacks), special abilities
 *   picked from every creature in the rules (REF.HB_ABILITIES; their text can be edited, and limited uses count in the tracker),
 *   expertises, likes and hates, and equipment from the rules or the Workshop. They join REF.BESTIARY (sync), so the Bestiary,
 *   encounters, the combat tracker, and the Tabletop use them like any other creature; one in a fight holds its equipment.
 * - Equipment: any kind on the cards (weapons, armor, shields, ammunition, gear, alchemy, magic items, spellbooks, materials, treasure,
 *   vehicles) with the stats the rules allow, weapon qualities, metal and wood upgrades, enchantments (at most 4 Enchanting uses), usage
 *   dice, and crafting. Each becomes an inventory card in CROWS.ITEMS (CrowsSheet.registerItems), written the way the rules' cards are,
 *   so crows' sheets can carry and use it (the fight hands players its card: publicCombat `defs`).
 * A creature or item keeps its name as its key: renaming one renames it in encounters, the tracker, and on the Tabletop (rename*).
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addCombatant = f('addCombatant'), area = f('area'), beastCard = f('beastCard'), btn = f('btn'), card = f('card'), chk = f('chk'), field = f('field'),
      inp = f('inp'), log = f('log'), more = f('more'), nid = f('nid'), render = f('render'), save = f('save'), sel = f('sel'), setTab = f('setTab');
  var $ = A.$, clamp = A.clamp, clone = A.clone, el = A.el, fmt = A.fmt, plural = A.plural, signed = A.signed, toast = A.toast, ui = A.ui;
  var Sheet = window.CrowsSheet;
  var state = A.state; A.share('state', function (v) { state = v; sync(); });

  var OFFICIAL_BEASTS = REF.BESTIARY.slice(), OFFICIAL_TRAITS = clone(REF.MONSTER_TRAITS);
  var itemKeys = [];   // the names this file put in CROWS.ITEMS
  var H = ui.hb = ui.hb || { cr: null, it: null, crQ: '', itQ: '', abPick: '', gearPick: '', gearQty: 1, expPick: '', from: '', itFrom: '', kind: 'weapon' };

  function hb() { var h = state.homebrew; if (!h || typeof h !== 'object') h = state.homebrew = {}; if (!Array.isArray(h.creatures)) h.creatures = []; if (!Array.isArray(h.items)) h.items = []; return h; }
  function sentence(t) { t = String(t || '').trim(); return !t ? '' : /[.!?)]$/.test(t) ? t : t + '.'; }
  function num(v, lo, hi, dflt) { v = Math.round(+v); return isFinite(v) ? clamp(v, lo, hi) : dflt; }
  function isMonsterType(t) { return t !== 'Human' && t !== 'Animal'; }

  // ------------------------------------------------------------------ creatures
  function newCreature(o) {
    return Object.assign({ id: nid(), n: '', t: 'Other', sz: 'M', p: 1, st: 10, ad: 0, rx: 1, sl: 0, c: [0, 0, 0], spd: { walk: 5, climb: 0, climbU: false, swim: 0, fly: 0, burrow: 0 },
      atk: [['Claws', 1, 'M1', 2, 4]], ab: [], exp: [], gear: [], likes: '', hates: '', notes: '', art: '', made: A.today() }, o || {});
  }
  function speedText(s) {
    var out = [String(s.walk || 0)];
    if (s.climb) out.push('climb ' + s.climb + (s.climbU ? ' (U)' : ''));
    if (s.swim) out.push('swim ' + s.swim);
    if (s.fly) out.push('fly ' + s.fly);
    if (s.burrow) out.push('burrow ' + s.burrow);
    return out.join(', ');
  }
  function parseSpeed(t) {
    var g = function (re) { var m = re.exec(t || ''); return m ? +m[1] : 0; };
    return { walk: g(/^(\d+)/), climb: g(/climb (\d+)/), climbU: /climb \d+ \(U\)/.test(t || ''), swim: g(/swim (\d+)/), fly: g(/fly (\d+)/), burrow: g(/burrow (\d+)/) };
  }
  /* The stat block the rest of the Ref Screen reads (the shape of REF.BESTIARY's entries). */
  function toBeast(r) {
    var x = [sentence(r.notes)].concat(r.ab.map(function (a) { return sentence(a.x); }));
    if (r.exp.length) x.push('Expertises: ' + r.exp.map(function (e) { return e[0] + (e[1] > 1 ? ' ' + e[1] : ''); }).join(', ') + '.');
    if (r.gear.length) x.push('Gear: ' + r.gear.map(function (g) { return (g[1] > 1 ? g[1] + ' × ' : '') + g[0]; }).join(', ') + '.');
    if (r.likes) x.push('LIKES: ' + sentence(r.likes));
    if (r.hates) x.push('HATES: ' + sentence(r.hates));
    return { t: r.t, n: r.n, sz: r.sz, p: r.p, st: r.st, spd: speedText(r.spd), sl: r.sl, c: r.c.slice(), ad: r.ad,
      atk: r.atk.filter(function (a) { return a[0]; }).map(function (a) { return a[5] ? a.slice(0, 6) : a.slice(0, 5); }), x: x.filter(Boolean).join(' '),
      uses: r.ab.filter(function (a) { return a.u > 0; }).map(function (a) { return [a.n, a.u, a.per || 'Rest']; }), rx: r.rx, custom: true, hb: r.id, gear: r.gear.slice(), art: r.art || '' };
  }
  function fromBeast(b) {
    return newCreature({ n: uniqueName(b.n + ' (variant)', null), t: REF.HB_TYPES.indexOf(b.t) >= 0 ? b.t : 'Other', sz: b.sz, p: b.p, st: b.st, ad: b.ad || 0, rx: b.rx || 1, sl: b.sl || 0, c: b.c.slice(),
      spd: parseSpeed(b.spd), atk: b.atk.map(function (a) { return a.slice(); }), notes: b.x || '', art: b.custom ? b.art : b.n,
      ab: (b.uses || []).map(function (u) { return { n: u[0], x: '', u: u[1], per: u[2] }; }), gear: (b.gear || []).map(function (g) { return g.slice(); }) });
  }
  function beastNames() { var o = {}; REF.BESTIARY.forEach(function (b) { o[b.n] = true; }); return o; }
  function uniqueName(want, self) {
    var taken = {}; OFFICIAL_BEASTS.forEach(function (b) { taken[b.n] = true; }); hb().creatures.forEach(function (c) { if (c !== self) taken[c.n] = true; });
    var n = (want || 'New creature').trim().slice(0, 60) || 'New creature', k = n, i = 2;
    while (taken[k]) k = n + ' ' + i++;
    return k;
  }

  // ------------------------------------------------------------------ equipment
  function newItem(kind, o) {
    var base = { id: nid(), n: '', kind: kind, gc: 10, sl: 1, st: 1, txt: '', craft: { exp: '', uses: 1, mat: '', goal: 10 }, made: A.today() };
    var k = {
      weapon: { wt: 'Slashing', hands: 1, reach: 1, range: 0, ch: 'S', t2: 3, t3: 6, q: {}, metal: '', wood: '', ench: [] },
      armor: { base: 'Light', ad: 5, up: '', ench: [], sl: 2, gc: 50 },
      shield: { ad: 5, up: '', ench: [], gc: 15 },
      ammo: { for: 'Bows (arrows)', count: 20, metal: '', gc: 5 },
      gear: { gcat: 'misc', ud: 0, udt: {}, refuel: '', lb: 0, ld: 0, quality: '', qb: 1, act: '', fx: '' },
      alchemy: { st: 5, act: 'Maneuver', rr: '', t1: '', t2: '', t3: '', fx: '', ud: 0, udt: {}, gc: 100, craft: { exp: 'Alchemy', uses: 1, mat: '1 monster part', goal: 20 } },
      magic: { slot: '', ud: 1, udt: { Rest: true, Activate: true }, act: 'Action', rr: '', t1: '', t2: '', t3: '', fx: '', gc: 500, craft: { exp: 'Enchanting', uses: 2, mat: 'a gem worth 100 gc', goal: 100 } },
      spell: { rank: 0, disc: 'Elemental', time: 'Action', dmg: false, t2n: 2, t3n: 4, rng: 'Ranged 10', tgt: '1 creature', dur: 'Instant', t1: '', t2: '', t3: '', gc: 250 },
      material: { msize: 'S', gc: 100 },
      treasure: { tsize: 'T', gc: 100 },
      vehicle: { vst: 25, vsize: 'Large', animals: 1, cargo: 250, gc: 1000 }
    }[kind] || {};
    return Object.assign(base, clone(k), o || {});
  }
  function metalOf(r) { return REF.HB_METAL.filter(function (m) { return m[0] === r.metal; })[0] || null; }
  function woodOf(r) { return REF.HB_WOOD.filter(function (m) { return m[0] === r.wood; })[0] || null; }
  function armorUp(r) { var t = r.kind === 'shield' ? 'Shield' : r.base, ups = (REF.HB_ARMOR[t] || [0, 0, 0, '', 0, []])[5]; return ups.filter(function (u) { return u[0] === r.up; })[0] || null; }
  function enchList(r) { return r.kind === 'weapon' ? REF.HB_WEAPON_ENCH : REF.HB_ARMOR_ENCH; }
  function enchOf(r) { return (r.ench || []).map(function (n) { return enchList(r).filter(function (e) { return e[0] === n; })[0]; }).filter(Boolean); }
  function enchUses(r) { return enchOf(r).reduce(function (a, e) { return a + e[2]; }, 0); }
  /* Which enchantments this item can take (a bow or not; a suit or a shield). */
  function enchFits(r, e) {
    if (r.kind === 'weapon') return r.wt !== 'Unarmed' && (!e[6] || (e[6] === 'bow') === (r.wt === 'Bow'));
    return e[3] === 'Both' || e[3] === (r.kind === 'shield' ? 'Shield' : 'Suit');
  }
  function udText(r) {
    if (!(r.ud > 0)) return '';
    var tags = REF.HB_UD_TAGS.filter(function (t) { return r.udt && r.udt[t]; }).map(function (t) { return t === 'Refuel' && r.refuel ? 'Refuel with ' + r.refuel : t; });
    return 'UD: ' + r.ud + ' (' + (tags.join('; ') || 'Activate') + ').';
  }
  function tiers(r) { return r.t1 || r.t2 || r.t3 ? '<=11: ' + (r.t1 || 'no effect') + '; 12-16: ' + (r.t2 || 'as 17+ at a cost') + '; 17+: ' + (r.t3 || 'full effect') + '.' : ''; }
  function craftText(r) {
    var c = r.craft || {};
    return c.exp ? 'Craft: ' + c.exp + ' ' + (c.uses || 1) + (c.mat ? ', ' + c.mat : '') + ', goal ' + (c.goal || 0) + '.' : '';
  }
  /* What the item is worth by the rules: the base and each upgrade and enchantment (the Ref sets the price). */
  function suggestedPrice(r) {
    var p = 0;
    if (r.kind === 'weapon') { p = r.sl > 1 || r.hands === 2 && !r.q.Cumbersome ? 15 : 12; var m = metalOf(r), w = woodOf(r); if (m) p += m[3]; if (w) p += w[2]; }
    else if (r.kind === 'armor' || r.kind === 'shield') { var b = REF.HB_ARMOR[r.kind === 'shield' ? 'Shield' : r.base]; p = b ? b[2] : 0; var u = armorUp(r); if (u) p += u[2]; }
    else if (r.kind === 'ammo') { p = 5; var am = metalOf(r); if (am) p += Math.round(am[3] / 5); }
    else if (r.kind === 'spell') p = REF.HB_SPELL_PRICES[r.rank] || 250;
    else return null;
    enchOf(r).forEach(function (e) { p += e[1]; });
    return p;
  }
  /* The card's text, written the way the rules' cards are (the crows' sheets read weapons, usage dice, parry, and spell damage from it). */
  function cardText(r) {
    var out = [];
    if (r.kind === 'weapon') {
      var m = metalOf(r), w = woodOf(r), ret = (r.ench || []).indexOf('Returning') >= 0 ? 5 : 0, rng = r.range ? r.range + (w ? w[1] : 0) + ret : 0;
      var t2 = r.t2 + (m ? m[1] : 0), t3 = r.t3 + (m ? m[2] : 0), ch = r.ch;
      out.push((r.reach ? 'Melee ' + r.reach + (rng ? '/Ranged ' + rng : '') : 'Ranged ' + (rng || 5)) + '.');
      out.push('Attack 2d10 + ' + ch + '. 12-16: ' + t2 + ' + ' + ch + '; 17+: ' + t3 + ' + ' + ch + '.');
      var qs = [r.wt].concat(REF.HB_QUALITIES.filter(function (q) { return r.q[q[0]]; }).map(function (q) { return q[2] ? q[0] + ' ' + (+r.q[q[0]] || 1) : q[0]; }));
      out.push(qs.join(', ') + (r.q.Cumbersome ? ' (1 slot, but needs 2 hands to wield)' : '') + '.');
      if (r.sl > 1) out.push('Occupies ' + r.sl + ' slots.');
      if (r.wt === 'Bow') out.push(/rossbow|Reload/.test(r.n + JSON.stringify(r.q)) ? 'Uses bolts.' : 'Uses arrows.');
      if (m) out.push(m[0] + ' (+' + m[1] + '/+' + m[2] + ' damage, included).');
      if (w) out.push(w[0] + ' (+' + w[1] + ' range, included).');
    } else if (r.kind === 'armor' || r.kind === 'shield') {
      var u = armorUp(r);
      out.push('Armor, AD ' + adOf(r) + (u ? ' (' + u[0] + ' +' + u[1] + ')' : '') + '.');
      out.push(r.kind === 'shield' ? 'Only protects while wielded in a hand slot.' : (r.sl > 1 ? 'Occupies ' + r.sl + ' slots. ' : '') + 'Worn from the backpack (one suit at a time; don only outside combat rounds).');
    } else if (r.kind === 'ammo') {
      var am = metalOf(r);
      out.push('Ammunition for ' + r.for + (r.count ? ' (' + r.count + ')' : '') + '. Ammo used in a ranged attack is destroyed.');
      if (am) out.push(am[0] + ': +' + am[1] + '/+' + am[2] + ' damage.');
    } else if (r.kind === 'gear') {
      if (udText(r)) out.push(udText(r));
      if (r.gcat === 'light' && (r.lb || r.ld)) out.push((r.act || 'Maneuver') + ': Light ' + (r.lb || 0) + '/' + (r.ld || 0) + '.');
      else if (r.act && r.fx) out.push(r.act + ': ' + sentence(r.fx));
      if (!r.act && r.fx) out.push(sentence(r.fx));
      if (r.quality) out.push(r.quality + ': +' + (r.qb || 1) + ' on tests using it.');
      if (r.sl > 1) out.push('Occupies ' + r.sl + ' slots.');
    } else if (r.kind === 'alchemy' || r.kind === 'magic') {
      if (r.slot) out.push('Slot: ' + r.slot + '.');
      if (udText(r)) out.push(udText(r).replace(/^UD: /, 'UD '));
      if (r.fx || r.rr) out.push((r.act ? r.act + ': ' : '') + sentence((r.fx || '') + (r.rr ? (r.fx ? ' ' : '') + r.rr + ' RR' : '')).replace(/\.$/, '.'));
      if (tiers(r)) out.push(tiers(r));
    } else if (r.kind === 'spell') {
      var head = 'R' + r.rank + ' ' + r.disc + (r.dmg ? ' Attack' + (r.time !== 'Action' ? ', ' + r.time : '') : ', ' + r.time) + '.';
      out.push(head, 'UD 1 (Rest; Activate).', [r.rng, r.tgt, r.dur && r.dur !== 'Instant' ? 'Dur ' + r.dur : ''].filter(Boolean).join(', ') + '.');
      if (r.dmg) out.push('12-16: ' + r.t2n + '+M' + (r.t2 ? ' ' + r.t2 : '') + '; 17+: ' + r.t3n + '+M' + (r.t3 ? ' ' + r.t3 : '') + '.' + (r.t1 ? ' <=11: ' + r.t1 + '.' : ''));
      else if (tiers(r)) out.push(tiers(r));
    } else if (r.kind === 'material') out.push('Crafting material (' + ({ S: 'Small', M: 'Medium' }[r.msize] || r.msize) + ').');
    else if (r.kind === 'treasure') out.push('Treasure (' + ({ T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large' }[r.tsize] || '') + '), worth ' + fmt(r.gc) + ' gc. Counts toward XP when recovered outside a village.');
    else if (r.kind === 'vehicle') out.push('Vehicle: Stamina ' + r.vst + '; needs ' + plural(r.animals, r.vsize + ' animal') + '; ' + r.cargo + ' slots of cargo. Destroyed at 0 Stamina; a wheelwright repairs it.');
    enchOf(r).forEach(function (e) { out.push(e[0] + ': ' + sentence(e[r.kind === 'weapon' ? 5 : 6])); });
    if (r.txt) out.push(sentence(r.txt));
    if (craftText(r)) out.push(craftText(r));
    return out.filter(Boolean).join(' ');
  }
  function adOf(r) { return r.ad; }
  var KIND_CAT = { weapon: 'weapon', armor: 'armor', shield: 'shield', ammo: 'ammo', alchemy: 'consumable', magic: 'magic', spell: 'spell', material: 'misc', treasure: 'misc', vehicle: 'bulky' };
  /* The inventory card (src/game-data.js shape). */
  function toCard(r) {
    var o = { cat: r.kind === 'gear' ? r.gcat : KIND_CAT[r.kind] || 'misc', st: r.st, sl: r.sl, gc: r.gc, txt: cardText(r), custom: true };
    if (r.kind === 'weapon') { o.wt = r.wt; if (r.hands === 2 || r.q.Cumbersome) o.hands = 2; if (r.q.Light) o.light = true; }
    if (r.kind === 'armor' || r.kind === 'shield') o.ad = adOf(r);
    if (r.kind === 'spell' && r.dmg) o.atk = true;
    return o;
  }
  function itemTaken(want, self) {
    var taken = {}; Object.keys(CROWS.ITEMS).forEach(function (k) { if (Sheet.isOfficial(k)) taken[k] = true; }); hb().items.forEach(function (c) { if (c !== self) taken[c.n] = true; });
    var n = (want || 'New item').trim().slice(0, 60) || 'New item', k = n, i = 2;
    while (taken[k]) k = n + ' ' + i++;
    return k;
  }
  /* An item from the rules as a starting point: its card text, price, slots, and (for weapons and armor) its numbers. */
  function fromCard(key) {
    var c = CROWS.ITEMS[key]; if (!c) return newItem('gear');
    var kind = { weapon: 'weapon', armor: 'armor', shield: 'shield', ammo: 'ammo', consumable: 'alchemy', magic: 'magic', spell: 'spell' }[c.cat] || 'gear';
    var r = newItem(kind, { n: itemTaken(key + ' (variant)', null), gc: c.gc, sl: c.sl, st: c.st });
    var t = c.txt || '';
    if (kind === 'weapon') {
      var mel = /Melee (\d+)/.exec(t), rng = /Ranged (\d+)/.exec(t), ch = /Attack 2d10 \+ (A or S|A|S|M)/.exec(t), t2 = /12-16: (\d+)/.exec(t), t3 = /17\+: (\d+)/.exec(t);
      Object.assign(r, { wt: c.wt || 'Slashing', hands: c.hands || 1, reach: mel ? +mel[1] : 0, range: rng ? +rng[1] : 0, ch: ch ? ch[1] : 'S', t2: t2 ? +t2[1] : 2, t3: t3 ? +t3[1] : 4, q: {} });
      REF.HB_QUALITIES.forEach(function (q) { var m = new RegExp('\\b' + q[0] + '(?: (\\d+))?').exec(t); if (m) r.q[q[0]] = q[2] ? +m[1] || 1 : true; });
    } else if (kind === 'armor') { r.ad = c.ad || 0; r.base = c.sl >= 4 ? 'Heavy' : c.sl === 3 ? 'Medium' : 'Light'; }
    else if (kind === 'shield') r.ad = c.ad || 0;
    else if (kind === 'gear') {
      r.gcat = c.cat; var ud = /UD:?\s*(\d+)\s*\(([^)]*)\)/.exec(t), lt = /Light (\d+)\/(\d+)/.exec(t);
      if (ud) { r.ud = +ud[1]; REF.HB_UD_TAGS.forEach(function (g) { if (ud[2].indexOf(g) >= 0) r.udt[g] = true; }); r.refuel = (/Refuel with ([\w ]+)/.exec(ud[2]) || [])[1] || ''; }
      if (lt) { r.lb = +lt[1]; r.ld = +lt[2]; r.act = 'Maneuver'; }
      r.fx = t.replace(/UD:?\s*\d+\s*\([^)]*\)\.?\s*/, '').replace(/Maneuver: Light \d+\/\d+\.?/, '').trim();
    } else { r.fx = t; }
    return r;
  }

  // ------------------------------------------------------------------ keeping the bestiary and the item cards in step
  function sync() {
    if (!state) return;
    var h = hb();
    REF.BESTIARY.length = 0;
    OFFICIAL_BEASTS.forEach(function (b) { REF.BESTIARY.push(b); });
    Object.keys(REF.MONSTER_TRAITS).forEach(function (k) { if (!OFFICIAL_TRAITS[k]) delete REF.MONSTER_TRAITS[k]; });
    h.creatures.forEach(function (r) {
      if (!r.n) return;
      REF.BESTIARY.push(toBeast(r));
      if (isMonsterType(r.t) && r.ab.length) REF.MONSTER_TRAITS[r.n] = r.ab.map(function (a) { return a.n; });   // what Monster Expert tells a player
    });
    itemKeys.forEach(function (k) { Sheet.unregisterItem(k); });
    var map = {};
    h.items.forEach(function (r) { if (r.n && r.kind !== 'vehicle') map[r.n] = toCard(r); });
    itemKeys = Sheet.registerItems(map);
  }
  function changed() { sync(); save(); }

  /* A new name for a creature or item: encounters, the tracker, and the Tabletop follow it. */
  function renameCreature(r, to) {
    var from = r.n; r.n = to; if (!from || from === to) return;
    state.encounters.forEach(function (e) {
      e.creatures.forEach(function (c) { if (c.n === from) c.n = to; });
      if (e.layout) e.layout.tokens.forEach(function (t) { if (t.cr === from) t.cr = to; });
    });
    A.S().combat.list.forEach(function (x) { if (x.cref === from) x.cref = to; });
    state.vtt.scenes.forEach(function (sc) { sc.tokens.forEach(function (t) { if (t.cref === from) t.cref = to; }); });
    hb().creatures.forEach(function (c) { if (c.art === from) c.art = to; });
  }
  function renameItem(r, to) {
    var from = r.n; r.n = to; if (!from || from === to) return;
    hb().creatures.forEach(function (c) { c.gear.forEach(function (g) { if (g[0] === from) g[0] = to; }); });
    var c = A.S().combat;
    (c.items || []).concat.apply(c.items || [], c.list.map(function (x) { return x.items || []; })).forEach(function (it) { if (it.key === from) it.key = to; });
    state.encounters.forEach(function (e) {
      if (!e.layout) return;
      (e.layout.ground || []).concat.apply(e.layout.ground || [], e.layout.tokens.map(function (t) { return t.items || []; })).forEach(function (it) { if (it.key === from) it.key = to; });
    });
  }

  // ------------------------------------------------------------------ small form pieces
  function numIn(obj, key, min, max, label, onchg) {
    return el('label', { class: 'hb-num' }, [el('span', { text: label }), inp(obj, key, { type: 'number', min: min, max: max, class: 'tiny', 'aria-label': label }, { dflt: min > 0 ? min : 0, on: function () { changed(); if (onchg) onchg(); render(); } })]);
  }
  function txtIn(obj, key, label, attrs, re) {
    return field(label, inp(obj, key, Object.assign({ 'aria-label': label }, attrs || {}), { on: function () { changed(); }, re: !!re }), 'grow');
  }
  function selIn(obj, key, options, label, num) {
    return field(label, sel(obj, key, options, { label: label, num: !!num, on: function () { changed(); } }));
  }
  function nameIn(r, which) {
    var n = el('input', { type: 'text', class: 'in', value: r.n, maxlength: 60, 'aria-label': 'Name', placeholder: which === 'c' ? 'Creature name' : 'Item name' });
    n.addEventListener('change', function () {
      var want = this.value.trim(), to = which === 'c' ? uniqueName(want, r) : itemTaken(want, r);
      if (to !== want && want) toast('"' + want + '" is taken: named it "' + to + '".');
      if (which === 'c') renameCreature(r, to); else renameItem(r, to);
      changed(); render();
    });
    return field('Name', n, 'grow');
  }
  function itemOptions(filter) {
    var groups = {};
    Object.keys(CROWS.ITEMS).sort().forEach(function (k) {
      var c = CROWS.ITEMS[k]; if (filter && !filter(c)) return;
      var g = c.custom ? 'Workshop' : { weapon: 'Weapons', armor: 'Armor', shield: 'Armor', ammo: 'Weapons', consumable: 'Alchemy', magic: 'Magic items', spell: 'Spellbooks' }[c.cat] || 'Gear';
      (groups[g] = groups[g] || []).push(k);
    });
    return ['Workshop', 'Weapons', 'Armor', 'Gear', 'Alchemy', 'Magic items', 'Spellbooks'].filter(function (g) { return groups[g]; })
      .map(function (g) { return el('optgroup', { label: g }, groups[g].map(function (k) { return el('option', { value: k, text: k }); })); });
  }
  /* A bound text box that also does `on` after each change (area() saves the value first). */
  function areaIn(obj, key, attrs, on) { var n = area(obj, key, attrs); n.addEventListener('input', on); return n; }
  function removeBtn(label, fn) { return el('button', { type: 'button', class: 'x', text: '×', 'aria-label': label, title: label, onclick: fn }); }

  // ------------------------------------------------------------------ the creature editor
  /* What its equipment gives: the best suit, shield, and parry weapon's AD (as the rules' humans count it). */
  function gearAD(r) {
    var suit = 0, shield = 0, parry = 0;
    r.gear.forEach(function (g) {
      var c = CROWS.ITEMS[g[0]]; if (!c) return;
      if (c.cat === 'armor') suit = Math.max(suit, c.ad || 0);
      if (c.cat === 'shield') shield = Math.max(shield, c.ad || 0);
      var p = /Parry (\d+)/.exec(c.txt || ''); if (p && c.cat === 'weapon') parry = Math.max(parry, +p[1]);
    });
    return { suit: suit, shield: shield, parry: parry, total: suit + shield + parry };
  }
  /* Attacks for the weapons it carries: attack bonus = the characteristic, damage = the card's + that characteristic. */
  function weaponAttacks(r) {
    var added = 0;
    r.gear.forEach(function (g) {
      var c = CROWS.ITEMS[g[0]]; if (!c || c.cat !== 'weapon' || r.atk.some(function (a) { return a[0] === g[0]; })) return;
      var t = c.txt || '', mel = /Melee (\d+)/.exec(t), rng = /Ranged (\d+)/.exec(t), ch = /Attack 2d10 \+ (A or S|A|S)/.exec(t), t2 = /12-16: (\d+)/.exec(t), t3 = /17\+: (\d+)/.exec(t);
      if (!t2 || !t3) return;
      var A_ = r.c[0], S_ = r.c[2], v = !ch ? S_ : ch[1] === 'A' ? A_ : ch[1] === 'S' ? S_ : Math.max(A_, S_);
      var notes = [/ignores cover/i.test(t) ? 'ignores cover' : '', /Brutal/.test(t) ? 'crit: double damage' : ''].filter(Boolean).join('; ');
      var row = [g[0], v, (mel ? 'M' + mel[1] : '') + (mel && rng ? '/' : '') + (rng ? 'R' + rng[1] : ''), +t2[1] + v, +t3[1] + v];
      if (notes) row.push(notes);
      r.atk.push(row); added++;
    });
    return added;
  }
  function creatureEditor(r) {
    var spd = r.spd;
    var atkRows = r.atk.map(function (a, i) {
      var o = { n: a[0], b: a[1], r: a[2], t2: a[3], t3: a[4], x: a[5] || '' };
      function put() { r.atk[i] = [o.n, num(o.b, -5, 15, 0), String(o.r || 'M1').toUpperCase().replace(/\s+/g, ''), num(o.t2, 0, 99, 0), num(o.t3, 0, 99, 0)].concat(o.x ? [o.x] : []); changed(); }
      return el('div', { class: 'li-row hb-atk' }, [
        inp(o, 'n', { placeholder: 'Attack', 'aria-label': 'Attack name', maxlength: 40 }, { on: put }),
        el('label', { class: 'hb-num' }, ['+', inp(o, 'b', { type: 'number', min: -5, max: 15, class: 'tiny', 'aria-label': 'Attack bonus' }, { on: put })]),
        inp(o, 'r', { placeholder: 'M1', 'aria-label': 'Reach or range (M1, R10, M1/R5)', list: 'hb-ranges', class: 'in mini', maxlength: 9 }, { on: put }),
        el('label', { class: 'hb-num' }, ['T2', inp(o, 't2', { type: 'number', min: 0, max: 99, class: 'tiny', 'aria-label': 'Tier 2 damage' }, { on: put })]),
        el('label', { class: 'hb-num' }, ['T3', inp(o, 't3', { type: 'number', min: 0, max: 99, class: 'tiny', 'aria-label': 'Tier 3 damage' }, { on: put })]),
        inp(o, 'x', { placeholder: 'What else it does (T3 prone, 2 targets…)', 'aria-label': 'Attack notes', list: 'hb-atk-notes', maxlength: 160 }, { on: put }),
        removeBtn('Remove ' + (a[0] || 'attack'), function () { r.atk.splice(i, 1); changed(); render(); })]);
    });
    var abPick = el('select', { class: 'in', 'aria-label': 'Special ability' }, [el('option', { value: '', text: 'Pick a special ability…' })].concat(REF.HB_ABILITIES.map(function (a, i) {
      return el('option', { value: String(i), text: a[0] + ' — ' + a[3], title: a[1] });
    })));
    var abRows = r.ab.map(function (a, i) {
      var per = { per: a.per || 'Rest', u: a.u || 0 };
      return el('div', { class: 'hb-ab' }, [
        el('div', { class: 'li-row' }, [inp(a, 'n', { placeholder: 'Name', 'aria-label': 'Ability name', maxlength: 50 }, { on: changed }),
          el('label', { class: 'hb-num', title: 'Uses between rests or per day (0: no limit). The tracker counts them; a crit regains one.' }, ['Uses', inp(per, 'u', { type: 'number', min: 0, max: 9, class: 'tiny', 'aria-label': 'Uses' }, { on: function (v) { a.u = v; changed(); } })]),
          sel(per, 'per', [['Rest', 'per rest'], ['Day', 'per day']], { class: 'in mini', label: 'Uses per', re: false, on: function (v) { a.per = v; changed(); } }),
          removeBtn('Remove ' + (a.n || 'ability'), function () { r.ab.splice(i, 1); changed(); render(); })]),
        areaIn(a, 'x', { rows: 2, 'aria-label': (a.n || 'Ability') + ' text', placeholder: 'What it does (written into the stat block)' }, function () { changed(); })]);
    });
    var expAll = [].concat(CROWS.EXPERTISES.General, CROWS.EXPERTISES.Spellcasting, CROWS.EXPERTISES.Weapon).map(function (e) { return e[0]; });
    var expPick = el('select', { class: 'in', 'aria-label': 'Expertise' }, [el('option', { value: '', text: 'Add an expertise…' })].concat(expAll.filter(function (n) { return !r.exp.some(function (e) { return e[0] === n; }); }).map(function (n) { return el('option', { value: n, text: n }); })));
    expPick.addEventListener('change', function () { if (this.value) { r.exp.push([this.value, 1]); changed(); render(); } });
    var gearPick = el('select', { class: 'in', 'aria-label': 'Equipment' }, itemOptions());
    if (H.gearPick && CROWS.ITEMS[H.gearPick]) gearPick.value = H.gearPick;
    gearPick.addEventListener('change', function () { H.gearPick = this.value; });
    var gq = { q: H.gearQty || 1 };
    var ad = gearAD(r), arts = Object.keys(REF.ART.creatures || {}).sort();
    var types = REF.HB_TYPES.map(function (t) { return [t, t]; });
    return el('div', { class: 'hb-editor' }, [
      el('div', { class: 'hb-cols' }, [
        el('div', { class: 'hb-form' }, [
          el('h4', { text: 'Stat line' }),
          el('div', { class: 'row' }, [nameIn(r, 'c'), selIn(r, 't', types, 'Type'), selIn(r, 'sz', REF.HB_SIZES, 'Size')]),
          el('div', { class: 'row hb-nums' }, [numIn(r, 'p', 0, 50, 'Power'), numIn(r, 'st', 1, 999, 'Stamina'), numIn(r, 'ad', 0, 99, 'AD'), numIn(r, 'sl', 0, 50, 'Slots'), numIn(r, 'rx', 1, 9, 'Reactions')]),
          el('p', { class: 'fine', text: isMonsterType(r.t) ? 'Monsters have no slots: they die at 0 Stamina, and see in the dark. Power 0-50 is the threat (starting crows can’t beat power 11+ head-on).'
            : 'Humans and animals have slots (backpack slots) that take wounds; at 0 Stamina they flee.' }),
          el('div', { class: 'row hb-nums' }, [numIn(r.c, 0, -5, 6, 'Agility'), numIn(r.c, 1, -5, 6, 'Mind'), numIn(r.c, 2, -5, 6, 'Strength')]),
          el('div', { class: 'row hb-nums' }, [numIn(spd, 'walk', 0, 30, 'Speed'), numIn(spd, 'climb', 0, 30, 'Climb'), chk(spd, 'climbU', 'upside down (U)', { on: changed, title: 'Climbs ceilings too' }),
            numIn(spd, 'swim', 0, 30, 'Swim'), numIn(spd, 'fly', 0, 30, 'Fly'), numIn(spd, 'burrow', 0, 30, 'Burrow')]),
          el('h4', { text: 'Attacks' }),
          el('p', { class: 'fine', text: 'Bonus is added to 2d10. Reach or range: M1 (melee 1), R10 (ranged 10), M1/R5 (thrown). The tracker reads the notes: “T3 prone”, “T2 weakened”, “T3 vs Medium or smaller: grabbed”, “Lacerate on T3”, “2 targets”, “crits on 18-20; crit = 16 damage”.' }),
          atkRows.length ? el('div', { class: 'hb-list' }, atkRows) : el('p', { class: 'fine', text: 'No attacks.' }),
          el('div', { class: 'row' }, [btn('Add attack', function () { r.atk.push(['Attack', Math.max(r.c[0], r.c[2]), 'M1', 2, 4]); changed(); render(); }, 'btn-small btn-ghost'),
            r.gear.some(function (g) { var c = CROWS.ITEMS[g[0]]; return c && c.cat === 'weapon'; }) ? btn('Attacks from its weapons', function () { var n = weaponAttacks(r); changed(); render(); toast(n ? 'Added ' + plural(n, 'attack') + '.' : 'Its weapons already have attacks.'); }, 'btn-small btn-ghost', 'An attack for each weapon it carries: bonus = its characteristic, damage = the weapon’s + that characteristic') : null]),
          el('h4', { text: 'Special abilities' }),
          abRows.length ? el('div', { class: 'hb-list' }, abRows) : el('p', { class: 'fine', text: 'None yet. Pick any creature’s ability from the rules (then change its numbers), or write your own.' }),
          el('div', { class: 'row' }, [el('div', { class: 'grow' }, [abPick]),
            btn('Add', function () { var a = REF.HB_ABILITIES[+abPick.value]; if (!a) return; r.ab.push({ n: a[0], x: a[1], u: a[2] ? a[2][0] : 0, per: a[2] ? a[2][1] : 'Rest' }); changed(); render(); }, 'btn-small'),
            btn('Write one', function () { r.ab.push({ n: 'New ability', x: '', u: 0, per: 'Rest' }); changed(); render(); }, 'btn-small btn-ghost')]),
          el('h4', { text: 'Expertises' }),
          el('div', { class: 'hb-chips' }, r.exp.map(function (e, i) {
            var o = { u: e[1] };
            return el('span', { class: 'hb-chip' }, [e[0], inp(o, 'u', { type: 'number', min: 1, max: 5, class: 'tiny', 'aria-label': e[0] + ' uses' }, { on: function (v) { e[1] = v; changed(); } }),
              removeBtn('Remove ' + e[0], function () { r.exp.splice(i, 1); changed(); render(); })]);
          }).concat([expPick])),
          el('h4', { text: 'Equipment' }),
          el('p', { class: 'fine', text: 'In a fight it holds these (it can drop them, and does when it dies); the crows can take them. Items from the rules or your own.' }),
          r.gear.length ? el('div', { class: 'hb-list' }, r.gear.map(function (g, i) {
            var o = { q: g[1] || 1 }, c = CROWS.ITEMS[g[0]];
            return el('div', { class: 'li-row' }, [el('b', { class: 'grow', text: g[0], title: c ? c.txt : 'Not a known item' }),
              el('label', { class: 'hb-num' }, ['×', inp(o, 'q', { type: 'number', min: 1, max: 99, class: 'tiny', 'aria-label': g[0] + ' count' }, { on: function (v) { g[1] = v; changed(); } })]),
              c ? el('span', { class: 'fine', text: c.cat + (c.ad ? ', AD ' + c.ad : '') }) : el('span', { class: 'fine warn', text: 'unknown item' }),
              removeBtn('Remove ' + g[0], function () { r.gear.splice(i, 1); changed(); render(); })]);
          })) : null,
          el('div', { class: 'row' }, [el('div', { class: 'grow' }, [gearPick]), inp(gq, 'q', { type: 'number', min: 1, max: 99, class: 'tiny', 'aria-label': 'How many' }, { on: function (v) { H.gearQty = v; } }),
            btn('Give', function () { var k = gearPick.value; if (!k) return; var have = r.gear.filter(function (g) { return g[0] === k; })[0]; if (have) have[1] += gq.q; else r.gear.push([k, gq.q]); changed(); render(); }, 'btn-small')]),
          ad.total ? el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'Its equipment gives AD ' + ad.total + ' (' + [ad.suit ? 'armor ' + ad.suit : '', ad.shield ? 'shield ' + ad.shield : '', ad.parry ? 'parry ' + ad.parry : ''].filter(Boolean).join(', ') + ').' }),
            r.ad !== ad.total ? btn('Use AD ' + ad.total, function () { r.ad = ad.total; changed(); render(); }, 'btn-small btn-ghost') : null]) : null,
          el('h4', { text: 'Behavior' }),
          el('div', { class: 'row' }, [txtIn(r, 'likes', 'Likes', { placeholder: 'What draws it (monsters investigate)' }), txtIn(r, 'hates', 'Hates', { placeholder: 'What it hunts down and destroys' })]),
          field('Notes', areaIn(r, 'notes', { rows: 3, placeholder: 'Description, nicknames, tactics, anything else for the stat block' }, function () { changed(); })),
          field('Looks like (art for its token and the Bestiary)', sel(r, 'art', [['', 'No picture (add your own in the Bestiary)']].concat(arts.map(function (n) { return [n, n]; })), { on: changed }))
        ]),
        el('div', { class: 'hb-preview' }, [el('h4', { text: 'In the Bestiary' }), REF.BESTIARY.filter(function (b) { return b.hb === r.id; })[0] ? beastCard(REF.BESTIARY.filter(function (b) { return b.hb === r.id; })[0]) : el('p', { class: 'fine', text: 'Give it a name.' })])
      ])
    ]);
  }

  // ------------------------------------------------------------------ the equipment editor
  function enchPicker(r) {
    var used = enchUses(r);
    return el('div', null, [
      el('div', { class: 'row center' }, [el('b', { text: 'Enchantments' }), el('span', { class: 'chip' + (used > 4 ? ' warn' : ''), text: used + ' / 4 Enchanting uses', title: 'An item can carry several enchantments, up to 4 Enchanting uses in all' })]),
      el('div', { class: 'hb-checks' }, enchList(r).filter(function (e) { return enchFits(r, e); }).map(function (e) {
        var on = (r.ench || []).indexOf(e[0]) >= 0, eff = e[r.kind === 'weapon' ? 5 : 6], mat = e[r.kind === 'weapon' ? 3 : 4], goal = e[r.kind === 'weapon' ? 4 : 5];
        return el('label', { class: 'check hb-ench' + (on ? ' on' : ''), title: eff }, [el('input', { type: 'checkbox', checked: on, onchange: function () {
          r.ench = (r.ench || []).filter(function (n) { return n !== e[0]; }); if (this.checked) r.ench.push(e[0]);
          if (enchUses(r) > 4) toast('That is more than 4 Enchanting uses: the rules allow 4 on one item.');
          changed(); render();
        } }), el('span', null, [el('b', { text: e[0] }), el('span', { class: 'fine', text: fmt(e[1]) + ' gc · ' + plural(e[2], 'Enchanting use') + ' · ' + mat + ', goal ' + goal }), el('span', { class: 'hb-eff', text: eff })])]);
      }))]);
  }
  function udPicker(r) {
    return el('div', { class: 'row center hb-nums' }, [numIn(r, 'ud', 0, 6, 'Usage dice'),
      el('div', { class: 'hb-checks inline' }, REF.HB_UD_TAGS.map(function (t) {
        return el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: !!(r.udt && r.udt[t]), onchange: function () { r.udt = r.udt || {}; if (this.checked) r.udt[t] = true; else delete r.udt[t]; changed(); render(); } }), ' ' + t]);
      })), r.udt && r.udt.Refuel ? txtIn(r, 'refuel', 'Refuel with', { placeholder: 'oil', maxlength: 30 }) : null]);
  }
  function tiersIn(r, label) {
    return el('div', null, [el('b', { text: label || 'Outcomes by tier' }),
      el('div', { class: 'row' }, [txtIn(r, 't1', '11 or less', { maxlength: 120 }), txtIn(r, 't2', '12-16', { maxlength: 120 }), txtIn(r, 't3', '17+', { maxlength: 120 })])]);
  }
  function itemEditor(r) {
    var kids = [el('div', { class: 'row' }, [nameIn(r, 'i'), selIn(r, 'kind', REF.HB_KINDS, 'Kind')])], sp = suggestedPrice(r);
    var common = el('div', { class: 'row hb-nums' }, [numIn(r, 'gc', 0, 1e7, 'Price (gc)'), numIn(r, 'sl', 1, 4, 'Slots'), numIn(r, 'st', 1, 99, 'Stack'),
      sp != null && sp !== r.gc ? btn('Rules price ' + fmt(sp) + ' gc', function () { r.gc = sp; changed(); render(); }, 'btn-small btn-ghost', 'The base item plus its upgrades and enchantments') : null]);
    if (r.kind === 'weapon') {
      var bow = r.wt === 'Bow';
      kids.push(el('h4', { text: 'Weapon' }),
        el('div', { class: 'row' }, [selIn(r, 'wt', REF.HB_WEAPON_TYPES, 'Type (its expertise)'), selIn(r, 'ch', [['S', 'Strength'], ['A', 'Agility'], ['A or S', 'Agility or Strength']], 'Attack with'),
          selIn(r, 'hands', [[1, 'One hand'], [2, 'Two hands']], 'Wield in', true)]),
        el('div', { class: 'row hb-nums' }, [numIn(r, 'reach', 0, 3, 'Melee reach'), numIn(r, 'range', 0, 40, bow ? 'Range' : 'Thrown range'), numIn(r, 't2', 0, 30, '12-16 damage'), numIn(r, 't3', 0, 40, '17+ damage')]),
        el('p', { class: 'fine', text: 'Damage adds the characteristic it attacks with (as on the cards). Reach 0 makes it ranged only. The rules’ ranges: 1-handed 3/6, 2-handed 3/6 or 4/8-9 with reach 1-2; light weapons 2/4-5 and thrown 5.' }),
        el('b', { text: 'Qualities' }),
        el('div', { class: 'hb-checks' }, REF.HB_QUALITIES.map(function (q) {
          var on = !!r.q[q[0]];
          return el('label', { class: 'check', title: q[1] }, [el('input', { type: 'checkbox', checked: on, onchange: function () { if (this.checked) r.q[q[0]] = q[2] ? 2 : true; else delete r.q[q[0]]; changed(); render(); } }),
            ' ' + q[0], q[2] && on ? inp(r.q, q[0], { type: 'number', min: 1, max: 10, class: 'tiny', 'aria-label': q[0] + ' value' }, { on: changed }) : null]);
        })),
        el('div', { class: 'row' }, [bow || r.wt === 'Unarmed' ? null : selIn(r, 'metal', [['', 'Iron (no upgrade)']].concat(REF.HB_METAL.map(function (m) { return [m[0], m[0] + ' (+' + m[1] + '/+' + m[2] + ' damage, ' + fmt(m[3]) + ' gc; Blacksmithing ' + m[4] + ', ' + m[5] + ', goal ' + m[6] + ')']; })), 'Metal upgrade'),
          bow ? selIn(r, 'wood', [['', 'Hickory (no upgrade)']].concat(REF.HB_WOOD.map(function (w) { return [w[0], w[0] + ' (+' + w[1] + ' range, ' + fmt(w[2]) + ' gc; Blacksmithing ' + w[3] + ', ' + w[4] + ', goal ' + w[5] + ')']; })), 'Wood upgrade') : null]),
        r.wt === 'Unarmed' ? el('p', { class: 'fine', text: 'Unarmed weapons can’t be enchanted.' }) : enchPicker(r));
    } else if (r.kind === 'armor' || r.kind === 'shield') {
      var t = r.kind === 'shield' ? 'Shield' : r.base, base = REF.HB_ARMOR[t];
      kids.push(el('h4', { text: r.kind === 'shield' ? 'Shield' : 'Armor' }),
        el('div', { class: 'row' }, [r.kind === 'armor' ? field('Type', sel(r, 'base', [['Light', 'Light (cloth, hide, leather)'], ['Medium', 'Medium (chain, scale)'], ['Heavy', 'Heavy (plate, ring, splint)']], {
          label: 'Armor type', on: function (v) { var b = REF.HB_ARMOR[v]; r.ad = b[0]; r.sl = b[1]; r.gc = b[2]; r.up = ''; changed(); } })) : null,
          selIn(r, 'up', [['', 'No upgrade']].concat(base[5].map(function (u) { return [u[0], u[0] + ' (+' + u[1] + ' AD, ' + fmt(u[2]) + ' gc; ' + u[3] + ' use' + (u[3] > 1 ? 's' : '') + ', ' + u[4] + ', goal ' + u[5] + ')']; })), 'Upgrade'),
          numIn(r, 'ad', 0, 60, 'AD')]),
        el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'The rules: ' + t + ' AD ' + base[0] + ', ' + plural(base[1], 'slot') + (armorUp(r) ? ', +' + armorUp(r)[1] + ' from ' + armorUp(r)[0] : '') + '.' }),
          r.ad !== base[0] + (armorUp(r) ? armorUp(r)[1] : 0) ? btn('Use AD ' + (base[0] + (armorUp(r) ? armorUp(r)[1] : 0)), function () { r.ad = base[0] + (armorUp(r) ? armorUp(r)[1] : 0); changed(); render(); }, 'btn-small btn-ghost') : null]),
        enchPicker(r));
    } else if (r.kind === 'ammo') {
      kids.push(el('h4', { text: 'Ammunition' }), el('div', { class: 'row' }, [txtIn(r, 'for', 'For', { list: 'hb-ammo-for', maxlength: 40 }), numIn(r, 'count', 1, 100, 'Shots'),
        selIn(r, 'metal', [['', 'Iron']].concat(REF.HB_METAL.map(function (m) { return [m[0], m[0] + ' (+' + m[1] + '/+' + m[2] + ')']; })), 'Metal')]));
    } else if (r.kind === 'gear') {
      kids.push(el('h4', { text: 'Gear' }), el('div', { class: 'row' }, [selIn(r, 'gcat', REF.HB_GEAR_CATS, 'Sort'), selIn(r, 'act', [['', 'Always on / passive'], ['Maneuver', 'Maneuver'], ['Action', 'Action']], 'Using it'),
        selIn(r, 'quality', [['', 'Standard'], ['Fine', 'Fine'], ['Masterwork', 'Masterwork']], 'Quality'), r.quality ? numIn(r, 'qb', 1, 3, 'Bonus') : null]),
        r.gcat === 'light' ? el('div', { class: 'row hb-nums' }, [numIn(r, 'lb', 0, 30, 'Bright (squares)'), numIn(r, 'ld', 0, 30, 'Dim (squares)')]) : null,
        udPicker(r), field('What it does', areaIn(r, 'fx', { rows: 2, placeholder: 'Climb without a test; +1 to guide tests while carried…' }, function () { changed(); })));
    } else if (r.kind === 'alchemy' || r.kind === 'magic') {
      kids.push(el('h4', { text: r.kind === 'magic' ? 'Magic item' : 'Alchemy item' }),
        el('div', { class: 'row' }, [r.kind === 'magic' ? selIn(r, 'slot', REF.HB_MAGIC_SLOTS.map(function (s) { return [s, s || 'Held (no slot)']; }), 'Worn in') : null,
          selIn(r, 'act', [['', 'Passive (while carried or worn)'], ['Maneuver', 'Maneuver'], ['Action', 'Action'], ['Reaction', 'Reaction']], 'Using it'),
          selIn(r, 'rr', [['', 'No resistance roll'], ['Agility', 'Agility RR'], ['Mind', 'Mind RR'], ['Strength', 'Strength RR']], 'Target resists')]),
        udPicker(r), field('What it does', areaIn(r, 'fx', { rows: 2, placeholder: 'Drink: regain 1d6 Stamina… / throw up to 10 squares, 3 cube…' }, function () { changed(); })), tiersIn(r));
    } else if (r.kind === 'spell') {
      kids.push(el('h4', { text: 'Spellbook' }),
        el('div', { class: 'row' }, [numIn(r, 'rank', 0, 5, 'Rank', function () { r.gc = REF.HB_SPELL_PRICES[r.rank] || r.gc; }), selIn(r, 'disc', REF.HB_DISCIPLINES, 'Discipline'), selIn(r, 'time', REF.HB_CAST_TIMES, 'Casting time')]),
        el('div', { class: 'row' }, [txtIn(r, 'rng', 'Range', { list: 'hb-spell-range', maxlength: 40 }), txtIn(r, 'tgt', 'Targets or area', { maxlength: 60, placeholder: '1 creature; Cube 3; All allies' }), txtIn(r, 'dur', 'Duration', { list: 'hb-spell-dur', maxlength: 30 })]),
        chk(r, 'dmg', 'It is an attack (deals damage + Mind)', { on: changed }),
        r.dmg ? el('div', { class: 'row hb-nums' }, [numIn(r, 't2n', 0, 30, '12-16 damage + M'), numIn(r, 't3n', 0, 40, '17+ damage + M'), txtIn(r, 't3', 'Also on 17+', { maxlength: 60, placeholder: 'and prone' })]) : tiersIn(r, 'What each tier does'),
        el('p', { class: 'fine', text: 'Spellbooks have UD 1 (Rest; Activate), and are cast with 2d10 + Mind while wielded. A T1 that isn’t a doom risks backlash (1d6: 1).' }));
    } else if (r.kind === 'material') kids.push(el('div', { class: 'row' }, [selIn(r, 'msize', [['S', 'Small (a bar)'], ['M', 'Medium (a log)']], 'Size')]));
    else if (r.kind === 'treasure') kids.push(el('div', { class: 'row' }, [selIn(r, 'tsize', REF.HB_TREASURE_SIZES, 'Size')]));
    else if (r.kind === 'vehicle') kids.push(el('div', { class: 'row hb-nums' }, [numIn(r, 'vst', 1, 500, 'Stamina'), selIn(r, 'vsize', [['Large', 'Large animals'], ['Huge', 'Huge animals'], ['Holy Shit', 'Holy Shit! animals']], 'Pulled by'), numIn(r, 'animals', 1, 16, 'Animals'), numIn(r, 'cargo', 1, 5000, 'Cargo slots')]),
      el('p', { class: 'fine', text: 'Vehicles aren’t carried, so they don’t become inventory cards.' }));
    kids.push(common);
    kids.push(more('Crafting (optional)', [el('div', { class: 'row' }, [selIn(r.craft, 'exp', REF.HB_CRAFT_EXP.map(function (e) { return [e, e || 'Not craftable']; }), 'Expertise'),
      numIn(r.craft, 'uses', 1, 4, 'Uses'), txtIn(r.craft, 'mat', 'Materials', { maxlength: 60 }), numIn(r.craft, 'goal', 0, 5000, 'Goal')])], !!(r.craft && r.craft.exp)));
    kids.push(field('More card text', areaIn(r, 'txt', { rows: 2, placeholder: 'Anything else the card says' }, function () { changed(); renderPreview(r); })));
    return el('div', { class: 'hb-editor' }, [el('div', { class: 'hb-cols' }, [el('div', { class: 'hb-form' }, kids), el('div', { class: 'hb-preview', id: 'hb-item-preview' }, [itemPreview(r)])])]);
  }
  function itemPreview(r) {
    var c = toCard(r);
    return el('div', { class: 'hb-card' }, [el('div', { class: 'hb-card-head' }, [el('b', { text: r.n || 'Unnamed item' }), el('span', { class: 'chip', text: (REF.HB_KINDS.filter(function (k) { return k[0] === r.kind; })[0] || ['', r.kind])[1] })]),
      el('div', { class: 'fine', text: [fmt(r.gc) + ' gc', plural(r.sl, 'slot'), r.st > 1 ? 'stack ' + r.st : '', c.ad ? 'AD ' + c.ad : '', c.hands === 2 ? '2 hands' : ''].filter(Boolean).join(' · ') }),
      el('p', { class: 'hb-card-txt', text: c.txt || '—' })]);
  }
  function renderPreview(r) { var b = $('hb-item-preview'); if (b) { b.innerHTML = ''; b.appendChild(itemPreview(r)); } }

  // ------------------------------------------------------------------ the tab
  function lists() {
    return [el('datalist', { id: 'hb-ranges' }, ['M1', 'M2', 'M3', 'R5', 'R10', 'R15', 'R20', 'M1/R5', 'M2/R5', 'M1/R10'].map(function (v) { return el('option', { value: v }); })),
      el('datalist', { id: 'hb-atk-notes' }, REF.HB_ATTACK_NOTES.map(function (v) { return el('option', { value: v }); })),
      el('datalist', { id: 'hb-ammo-for' }, ['Bows (arrows)', 'Crossbows (bolts)', 'Slings (stones)'].map(function (v) { return el('option', { value: v }); })),
      el('datalist', { id: 'hb-spell-range' }, ['Self', 'Melee 1', 'Ranged 3', 'Ranged 5', 'Ranged 10', 'Ranged 15', 'Aura 2', 'Cube 3 within 10', 'Line 5 x 1 within 1'].map(function (v) { return el('option', { value: v }); })),
      el('datalist', { id: 'hb-spell-dur' }, ['Instant', 'DT', '1 UD', '2 UD', 'End of DT'].map(function (v) { return el('option', { value: v }); }))];
  }
  function renderWorkshop() {
    var h = hb();
    // creatures
    var q = H.crQ.toLowerCase(), crs = h.creatures.filter(function (r) { return !q || (r.n + ' ' + r.t).toLowerCase().indexOf(q) >= 0; });
    var from = el('select', { class: 'in', 'aria-label': 'Start from a creature' }, [el('option', { value: '', text: 'A blank creature' })].concat((function () {
      var g = {}; OFFICIAL_BEASTS.concat(REF.BESTIARY.filter(function (b) { return b.custom; })).forEach(function (b) { (g[b.custom ? 'Mine' : b.t] = g[b.custom ? 'Mine' : b.t] || []).push(b.n); });
      return Object.keys(g).map(function (t) { return el('optgroup', { label: t }, g[t].map(function (n) { return el('option', { value: n, text: n }); })); });
    })()));
    from.value = H.from && beastNames()[H.from] ? H.from : '';
    from.addEventListener('change', function () { H.from = this.value; });
    var crSearch = el('input', { type: 'search', class: 'in', placeholder: 'Search your creatures…', value: H.crQ, 'aria-label': 'Search your creatures', id: 'hb-cr-q', oninput: function () { H.crQ = this.value; var p = this.selectionStart; renderWorkshop(); var n = $('hb-cr-q'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* ignore */ } } });
    card('sec-hb-creatures', el('h2', null, ['Custom Creatures', el('small', { text: plural(h.creatures.length, 'creature') })]), lists().concat([
      el('p', { class: 'hint', text: 'Your own creatures join the Bestiary, encounters, the combat tracker, and the Tabletop. Start from a blank stat block or copy any creature, then change anything.' }),
      el('div', { class: 'row' }, [field('Start from', from, 'grow'), btn('New creature', function () {
        var b = H.from && REF.BESTIARY.filter(function (x) { return x.n === H.from; })[0], r = b ? fromBeast(b) : newCreature({ n: uniqueName('New creature', null) });
        h.creatures.unshift(r); H.cr = r.id; log('', 'Workshop: new creature **' + r.n + '**.'); changed(); render();
      }, 'btn-primary')]),
      h.creatures.length > 6 ? crSearch : null,
      el('div', { class: 'hb-items' }, crs.map(function (r) {
        var open = H.cr === r.id;
        return el('div', { class: 'hb-row' + (open ? ' open' : '') }, [
          el('div', { class: 'li-row' }, [el('button', { type: 'button', class: 'hb-name', 'aria-expanded': open ? 'true' : 'false', onclick: function () { H.cr = open ? null : r.id; render(); } }, [el('b', { text: r.n || 'Unnamed' }),
            el('span', { class: 'fine', text: ' ' + r.t + ' · ' + (A.SIZES[r.sz] || r.sz) + ' · P' + r.p + ' · Stamina ' + r.st + (r.ad ? ' · AD ' + r.ad : '') + (r.ab.length ? ' · ' + plural(r.ab.length, 'ability', 'abilities') : '') })]),
            el('span', { class: 'spacer' }),
            btn(open ? 'Done' : 'Edit', function () { H.cr = open ? null : r.id; render(); }, 'btn-small' + (open ? ' btn-primary' : '')),
            btn('Add to combat', function () { addCombatant(r.n, 1, 'foe'); log('', 'Added 1 × ' + r.n + ' to combat.'); toast('Added ' + r.n + ' to the combat tracker.'); render(); }, 'btn-small btn-ghost'),
            btn('Duplicate', function () { var c = clone(r); c.id = nid(); c.n = uniqueName(r.n + ' (copy)', null); h.creatures.splice(h.creatures.indexOf(r) + 1, 0, c); H.cr = c.id; changed(); render(); }, 'btn-small btn-ghost'),
            btn('Delete', function () {
              var used = state.encounters.filter(function (e) { return e.creatures.some(function (c) { return c.n === r.n; }); }).length;
              if (!confirm('Delete ' + (r.n || 'this creature') + '?' + (used ? ' ' + plural(used, 'saved encounter') + ' use' + (used === 1 ? 's' : '') + ' it, and will keep its name without its stats.' : ''))) return;
              h.creatures = h.creatures.filter(function (x) { return x !== r; }); if (H.cr === r.id) H.cr = null; changed(); render();
            }, 'btn-small btn-ghost btn-danger')]),
          open ? creatureEditor(r) : null]);
      })),
      !h.creatures.length ? el('p', { class: 'fine', text: 'No custom creatures yet.' }) : null
    ]));

    // equipment
    var iq = H.itQ.toLowerCase(), its = h.items.filter(function (r) { return !iq || (r.n + ' ' + r.kind).toLowerCase().indexOf(iq) >= 0; });
    var ifrom = el('select', { class: 'in', 'aria-label': 'Start from an item' }, [el('option', { value: '', text: 'A blank item of this kind' })].concat(itemOptions(function (c) { return !c.custom; })));
    ifrom.value = H.itFrom && CROWS.ITEMS[H.itFrom] ? H.itFrom : '';
    ifrom.addEventListener('change', function () { H.itFrom = this.value; });
    var kind = el('select', { class: 'in', 'aria-label': 'Kind' }, REF.HB_KINDS.map(function (k) { return el('option', { value: k[0], text: k[1] }); }));
    kind.value = H.kind; kind.addEventListener('change', function () { H.kind = this.value; });
    var itSearch = el('input', { type: 'search', class: 'in', placeholder: 'Search your equipment…', value: H.itQ, 'aria-label': 'Search your equipment', id: 'hb-it-q', oninput: function () { H.itQ = this.value; var p = this.selectionStart; renderWorkshop(); var n = $('hb-it-q'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* ignore */ } } });
    card('sec-hb-items', el('h2', null, ['Custom Equipment', el('small', { text: plural(h.items.length, 'item') })]), [
      el('p', { class: 'hint', text: 'Any kind of equipment on the cards, with the stats, qualities, upgrades, and enchantments the rules allow. Your items can be given to creatures, put on the ground in a fight, and picked up by the crows (their sheets get the card).' }),
      el('div', { class: 'row' }, [field('Kind', kind), field('Or start from', ifrom, 'grow'), btn('New item', function () {
        var r = H.itFrom ? fromCard(H.itFrom) : newItem(H.kind, {}); if (!H.itFrom) r.n = itemTaken('New ' + (REF.HB_KINDS.filter(function (k) { return k[0] === H.kind; })[0] || ['', 'item'])[1].toLowerCase().replace(/ \(.*$/, ''), null);
        h.items.unshift(r); H.it = r.id; log('', 'Workshop: new item **' + r.n + '**.'); changed(); render();
      }, 'btn-primary')]),
      h.items.length > 6 ? itSearch : null,
      el('div', { class: 'hb-items' }, its.map(function (r) {
        var open = H.it === r.id;
        return el('div', { class: 'hb-row' + (open ? ' open' : '') }, [
          el('div', { class: 'li-row' }, [el('button', { type: 'button', class: 'hb-name', 'aria-expanded': open ? 'true' : 'false', onclick: function () { H.it = open ? null : r.id; render(); } }, [el('b', { text: r.n || 'Unnamed' }),
            el('span', { class: 'fine', text: ' ' + (REF.HB_KINDS.filter(function (k) { return k[0] === r.kind; })[0] || ['', r.kind])[1] + ' · ' + fmt(r.gc) + ' gc' + ((r.ench || []).length ? ' · ' + r.ench.join(', ') : '') })]),
            el('span', { class: 'spacer' }),
            btn(open ? 'Done' : 'Edit', function () { H.it = open ? null : r.id; render(); }, 'btn-small' + (open ? ' btn-primary' : '')),
            btn('Duplicate', function () { var c = clone(r); c.id = nid(); c.n = itemTaken(r.n + ' (copy)', null); h.items.splice(h.items.indexOf(r) + 1, 0, c); H.it = c.id; changed(); render(); }, 'btn-small btn-ghost'),
            btn('Delete', function () {
              if (!confirm('Delete ' + (r.n || 'this item') + '? Crows that already have one keep its card.')) return;
              h.items = h.items.filter(function (x) { return x !== r; }); if (H.it === r.id) H.it = null; changed(); render();
            }, 'btn-small btn-ghost btn-danger')]),
          open ? itemEditor(r) : null]);
      })),
      !h.items.length ? el('p', { class: 'fine', text: 'No custom equipment yet.' }) : null
    ]);
  }

  /* From the Bestiary: edit a Workshop creature, or copy one from the rules into the Workshop. */
  function workshopOpen(b) {
    var r = b.custom ? hb().creatures.filter(function (c) { return c.id === b.hb; })[0] : null;
    if (!r) { r = fromBeast(b); hb().creatures.unshift(r); log('', 'Workshop: new creature **' + r.n + '**, from ' + b.n + '.'); changed(); }
    H.cr = r.id; setTab('workshop');
  }

  A.add({ workshopOpen: workshopOpen, renderWorkshop: renderWorkshop, syncHomebrew: sync, hbToBeast: toBeast, hbToCard: toCard, hbCardText: cardText });
})();
