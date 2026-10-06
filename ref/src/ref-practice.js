/*
 * Ref Screen: practice fights on the Tabletop. Once an encounter is on the battle map, the sidebar's Practice block (#side-practice, shown on
 * the Tabletop tab) sets up a fight against computer-controlled crows: how many, each one's background (its Stamina, characteristics,
 * weapons, armor, and attack spells come from the Character Generator's data, CROWS), how experienced and armored they are, how they pick
 * targets, who runs the foes (the Ref, or the computer too), surprise, whether hits apply at once, when a crow leaves the fight, and the pace.
 *
 * The practice crows are combatants of kind 'pc' with a `bot` record and a made-up pcId ('bot…'), tied to their tokens by cid. On their
 * side's turn each one stands up or escapes a grab, heals a hurt friend (Minor Healing), moves toward its target (walls block it), and
 * attacks with the best weapon or spell it can reach: the roll is made here with the rules' modifiers and goes through crowAction
 * (ref-combat.js), the same path a player's attack from their Play page takes. They counter melee misses against them. With "Computer
 * runs the foes" the creatures move and attack too (their attacks are monsterAttack's), and foes counter the crows' melee misses.
 *
 * A practice fight is the Ref's alone: it isn't published to the players (publicCombat), and when it ends, the combat tracker, the scene's
 * tokens, and the log go back to how they were when it started (state.practice.run.snap). Restart goes back to its own start
 * (run.start) and rolls initiative again. Simulate plays it through N times at once (the computer runs both sides) for odds.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), applyAct = f('applyAct'), beast = f('beast'), btn = f('btn'), byId = f('byId'), chk = f('chk'), counterAct = f('counterAct'),
      crowAction = f('crowAction'), feed = f('feed'), field = f('field'), fxItems = f('fxItems'), meleeAtk = f('meleeAtk'), monsterAttack = f('monsterAttack'),
      monsterManeuver = f('monsterManeuver'), nextRound = f('nextRound'), nid = f('nid'), render = f('render'), runningEnc = f('runningEnc'), rxLeft = f('rxLeft'), S = f('S'), save = f('save'),
      sel = f('sel'), setCond = f('setCond'), surprised = f('surprised'), targetsFor = f('targetsFor'), test = f('test'), testLine = f('testLine'), twoTargets = f('twoTargets');
  var $ = A.$, clamp = A.clamp, clone = A.clone, d = A.d, el = A.el, netEdges = A.netEdges, pick = A.pick, plural = A.plural, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });
  var Tbl = window.CrowsTable;

  var U = ui.prac = ui.prac || { playing: false, last: 0, sim: false };
  var NAMES = ['Ash', 'Briar', 'Corvin', 'Dove', 'Edda', 'Finch'];
  // Party mixes: the backgrounds the crows get, in order (the Ref can change each one).
  var MIXES = [['balanced', 'Balanced', ['Bodyguard', 'Archer', 'Acolyte of the Healer', 'Knight', 'Pyromancer', 'Thief']],
    ['fighters', 'Fighters', ['Bodyguard', 'Knight', 'Gladiator', 'Executioner', 'Soldier', 'Village Watch']],
    ['ranged', 'Archers and casters', ['Archer', 'Hunter', 'Soldier', 'Assassin', 'Pyromancer', 'Keraunomancer']],
    ['party', 'Like the party', null], ['random', 'Random', null]];
  var EXP = [['new', 'New crows'], ['seasoned', 'Seasoned (+2 Stamina, +1 best characteristic)'], ['veteran', 'Veterans (+4 Stamina, +1 to two characteristics)']];
  var ARMOR = [['own', 'Their own gear'], ['none', 'No armor'], ['light', 'Light armor (AD 5)'], ['medium', 'Medium armor (AD 10)'], ['heavy', 'Heavy armor (AD 15)']];
  var TACTICS = [['focus', 'Focus fire on the most hurt foe'], ['nearest', 'Attack the nearest foe'], ['random', 'Pick foes at random']];
  var FOES = [['ref', 'You run the foes'], ['auto', 'The computer runs the foes too']];
  var FALL = [['dead', 'When dead (10 wounds)'], ['wounds3', 'At 3 wounds'], ['zero', 'At 0 Stamina']];
  var PACE = [['step', 'One step at a time'], ['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
  var PACE_MS = { slow: 1800, normal: 900, fast: 250 };
  var ROUND_CAP = 30;

  function P() { return state.practice; }
  function run() { return P() && P().run; }
  function practiceOn() { return !!run(); }
  function opts() { return P().opts; }
  function isBot(x) { return !!(x && x.bot); }
  function bots() { return S().combat.list.filter(isBot); }

  // ------------------------------------------------------------------ the crows
  function bgByName(n) { var B = CROWS.BACKGROUNDS; for (var k in B) if (B[k].name === n) return B[k]; return null; }
  function bgNames() { return Object.keys(CROWS.BACKGROUNDS).map(function (k) { return CROWS.BACKGROUNDS[k].name; }); }
  /* A weapon or spell from its card text: reach (Melee N), range (Ranged N), the characteristic(s) it uses, and its tier 2 and 3 numbers. */
  function arm(key) {
    var it = CROWS.ITEMS[key];
    if (!it || !(it.cat === 'weapon' || it.cat === 'spell')) return null;
    var t = it.txt, mel = /Melee (\d+)/.exec(t), rng = /Ranged (\d+)/.exec(t), ch = /Attack 2d10 \+ ([AMS](?: or [AMS])?)/.exec(t);
    var t1 = /<=11: (\d+)/.exec(t), t2 = /12-16: (\d+)/.exec(t), t3 = /17\+: (\d+)/.exec(t);
    var heal = it.cat === 'spell' && /Regains Stamina/.test(t);
    if (!t2 || !t3 || (it.cat === 'spell' && !it.atk && !heal)) return null;
    return { name: key, melee: mel ? +mel[1] : 0, range: rng ? +rng[1] : 0, chars: it.cat === 'spell' ? ['M'] : ch ? ch[1].split(' or ') : ['S'],
      t1: t1 ? +t1[1] : 0, t2: +t2[1], t3: +t3[1], spell: it.cat === 'spell', heal: heal, two: /2 targets/.test(t), dismember: /Dismember/.test(t),
      parry: +((/Parry (\d+)/.exec(t) || [])[1] || 0), cond3: /17\+:[^.]*weakened/.test(t) ? ['Weakened'] : [] };
  }
  /* A practice crow from a background: its characteristics (2 in the background's, 1 in the one its weapon uses, 0 in the last), Stamina,
     gear (with the standard kit's knife), and AD from armor, a shield, and a parrying weapon. */
  function makeCrow(bgName, i) {
    var o = opts(), b = bgByName(bgName) || bgByName('Bodyguard'), keys = b.gear.concat(CROWS.STANDARD_KIT).map(function (g) { return g[0]; });
    var arms = keys.map(arm).filter(Boolean), weapons = arms.filter(function (w) { return !w.spell; });
    var main = weapons.slice().sort(function (p, q) { return q.t3 - p.t3; })[0];
    var two = b.two[0], letter = { Agility: 'A', Mind: 'M', Strength: 'S' }, v = { A: 0, M: 0, S: 0 };
    v[letter[two]] = 2;
    var high = main && main.chars.map(function (k) { return { A: 'Agility', M: 'Mind', S: 'Strength' }[k]; }).filter(function (k) { return k !== two; })[0];
    if (!high || b.two.length > 1 && main.chars.indexOf(letter[two]) >= 0) high = ['Strength', 'Agility', 'Mind'].filter(function (k) { return k !== two; })[0];
    v[letter[high]] = 1;
    var st = b.stamina, best = letter[two];
    if (o.exp === 'seasoned') { st += 2; v[best] = Math.min(4, v[best] + 1); }
    if (o.exp === 'veteran') { st += 4; v[best] = Math.min(4, v[best] + 1); v[letter[high]] = Math.min(4, v[letter[high]] + 1); }
    var armor = 0, shield = 0;
    keys.forEach(function (k) { var it = CROWS.ITEMS[k]; if (it && it.cat === 'armor') armor = Math.max(armor, it.ad); if (it && it.cat === 'shield') shield = it.ad; });
    armor = { own: armor, none: 0, light: 5, medium: 10, heavy: 15 }[o.armor] || 0;
    var melee = weapons.filter(function (w) { return w.melee; }).sort(function (p, q) { return (q.t2 + val(v, q)) - (p.t2 + val(v, p)); })[0] || null;
    var ranged = weapons.filter(function (w) { return w.range; }).sort(function (p, q) { return (q.t2 + val(v, q)) - (p.t2 + val(v, p)); })[0] || null;
    var ad = armor + shield + (melee ? melee.parry : 0), short = b.name.replace(/^Acolyte of the (.*)$/, '$1\u2019s Acolyte');
    return { id: nid(), kind: 'pc', pcId: 'bot' + nid(), cref: '', name: NAMES[i % NAMES.length] + ' (' + short + ')', st: st, stMax: st, ad: ad, adMax: ad, wounds: 0,
      conds: {}, used: {}, dead: false, note: '', bot: { bg: b.name, A: v.A, M: v.M, S: v.S, melee: melee, ranged: ranged,
        spells: arms.filter(function (w) { return w.spell && !w.heal; }), heal: arms.filter(function (w) { return w.heal; })[0] || null, ud: {}, speed: CROWS.BASE_SPEED } };
  }
  function val(v, w) { return Math.max.apply(null, w.chars.map(function (k) { return v[k] || 0; })); }
  /* The backgrounds for n crows from the chosen mix (the party's own crows' backgrounds, then the balanced list). */
  function fillCrows() {
    var o = opts(), names = bgNames(), m = MIXES.filter(function (x) { return x[0] === o.mix; })[0] || MIXES[0], out = [];
    for (var i = 0; i < o.n; i++) {
      var pcs = activePCs().filter(function (p) { return bgByName(p.bg); });
      out.push(o.mix === 'random' ? pick(names) : o.mix === 'party' ? (pcs[i] ? pcs[i].bg : MIXES[0][2][i % 6]) : m[2][i % 6]);
    }
    o.crows = out;
  }
  function crowSummary(bgName) {
    var x = makeCrow(bgName, 0), b = x.bot;
    return 'St ' + x.stMax + (x.adMax ? ' · AD ' + x.adMax : '') + ' · ' + [b.melee, b.ranged !== b.melee ? b.ranged : null].concat(b.spells, [b.heal]).filter(Boolean).map(function (w) { return w.name.replace(/ Book$/, ''); }).join(', ');
  }

  // ------------------------------------------------------------------ the map
  function scene() { return A.vtt.cur(); }
  function tk(x) { var sc = scene(); return sc ? A.vtt.tokOf(sc, x) : null; }
  /* Squares between two tokens' edges (1: next to each other), from where they stand. */
  function gapAt(sc, a, b) {
    var raw = Tbl.isHex(sc) ? Tbl.dist(sc, a, b) : sc.grid === 'none' ? Math.hypot(a.x - b.x, a.y - b.y) / sc.g : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / sc.g;
    return Math.round((raw - ((a.size || 1) + (b.size || 1)) / 2 + 1) * 10) / 10;
  }
  /* How far apart two combatants are, or null when either has no token here (then everyone is in reach). */
  function gap(x, y) { var sc = scene(), a = tk(x), b = tk(y); return sc && a && b ? gapAt(sc, a, b) : null; }
  function inReach(x, y, n) { var g = gap(x, y); return g === null || g <= n + .01; }
  /* Move x's token toward y until it's within `want` squares (or as close as it gets), up to `speed` squares, to a free square it can reach in a straight line. */
  function moveToward(x, y, want, speed) {
    var sc = scene(), a = tk(x), b = tk(y);
    if (!sc || !a || !b || speed <= 0 || gapAt(sc, a, b) <= want + .01) return 0;
    var others = sc.tokens.filter(function (t) { return t !== a && !t.dead && t.kind !== 'obj'; }), best = null, bestCost = Infinity, step = sc.g;
    for (var dx = -speed; dx <= speed; dx++) for (var dy = -speed; dy <= speed; dy++) {
      var p = Tbl.snap(sc, a.x + dx * step, a.y + dy * step, a.size), n = Tbl.dist(sc, a, p);
      if (!n || n > speed || p.x < 0 || p.y < 0 || p.x > sc.w || p.y > sc.h) continue;
      var spot = { x: p.x, y: p.y, size: a.size };
      if (others.some(function (t) { return Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) < sc.g * ((t.size || 1) + (a.size || 1)) / 2 * .95; })) continue;
      if (Tbl.pathBlocked(sc, a, p)) continue;
      var g = gapAt(sc, spot, b), cost = g <= want + .01 ? n : 100 + g * 10 + n;
      if (cost < bestCost) { bestCost = cost; best = p; }
    }
    if (!best || bestCost >= 100 + gapAt(sc, a, b) * 10) return 0;   // nowhere closer
    var moved = A.vtt.moveToken(sc, a, best.x, best.y, false);
    if (moved) feed('**' + x.name + '** moves ' + plural(moved, 'square') + '.');
    return moved;
  }

  // ------------------------------------------------------------------ who's in the fight
  function foes() { return S().combat.list.filter(function (x) { return x.kind === 'foe'; }); }
  function foeOut(x) { return x.dead || x.st <= 0; }
  /* A practice crow leaves the fight at the point the Ref chose (and dies at 10 wounds). */
  function botOut(x) {
    if (x.wounds >= 10 && !x.dead) x.dead = true;
    var fa = opts().fallAt;
    return x.dead || x.out || (fa === 'zero' && x.st <= 0) || (fa === 'wounds3' && x.wounds >= 3);
  }
  function markOut() {
    bots().forEach(function (x) {
      if (!x.out && !x.dead && botOut(x)) { x.out = true; feed('**' + x.name + '** falls back out of the fight.'); }
    });
  }
  function outcome() {
    var c = S().combat;
    if (!foes().some(function (x) { return !foeOut(x); })) return 'won';
    if (bots().every(botOut)) return 'lost';
    if (c.round > ROUND_CAP) return 'draw';
    return null;
  }
  function canAct(x) { return !x.dead && !x.conds.Unconscious && !surprised(x); }
  /* The other side's creatures a crow (or a creature) can fight: up, not out. */
  function enemiesOf(x) { return targetsFor(x).filter(function (t) { return isBot(t) ? !botOut(t) : !foeOut(t); }); }
  function nearest(x, list) {
    var best = [], bd = Infinity;
    list.forEach(function (t) { var g = gap(x, t); g = g === null ? 0 : g; if (g < bd - .01) { bd = g; best = [t]; } else if (Math.abs(g - bd) <= .01) best.push(t); });
    return best.length ? pick(best) : null;
  }

  // ------------------------------------------------------------------ a crow's turn
  function charOf(x, w) { var b = x.bot; return Math.max.apply(null, w.chars.map(function (k) { return b[k] || 0; })); }
  /* The modifiers on a crow's roll at t (the same ones a player's Play page knows): conditions, surprise, prone, grabbed, squeezing. */
  function mods(x, t, melee) {
    var m = { e: 0, b: 0, bonus: 0, why: [], autoT3: false };
    if (x.conds.Weakened) { m.b++; m.why.push('weakened'); }
    if (x.conds.Blessed) { m.e++; m.why.push('blessed'); }
    if (x.conds.Prone && melee) { m.b++; m.why.push('prone'); }
    if (t) {
      if (surprised(t)) { m.bonus++; m.why.push('+1 vs surprised'); }
      if (t.conds.Prone) { if (melee) { m.e++; m.why.push('target prone'); } else { m.b++; m.why.push('target prone (ranged)'); } }
      if (t.conds.Grabbed) { m.e++; m.why.push('target grabbed'); }
      if (t.squeeze) { m.bonus++; m.why.push('+1 vs squeezing'); }
      if (t.conds.Unconscious) { m.autoT3 = true; m.why.push('target unconscious: tier 3'); }
      if (!melee && gap(x, t) !== null && gap(x, t) <= 1) { m.b++; m.why.push('ranged vs adjacent'); }
    }
    return m;
  }
  function udLeft(x, w) { return !w.spell || (x.bot.ud[w.name] === undefined ? 1 : x.bot.ud[w.name]) > 0; }
  /* A spell's usage die after a cast (not on a crit): a 1 or 2 and the book is spent until a rest. */
  function rollUD(x, w, r) {
    if (!w.spell || r.crit) return '';
    var n = d(6);
    if (n > 2) return ' UD ' + n + ': kept.';
    x.bot.ud[w.name] = 0;
    return ' UD ' + n + ': the book is spent until a rest.';
  }
  /* What x can hit t with from where it stands, best first: [{ w, melee }]. */
  function options(x, t) {
    var b = x.bot, out = [];
    [b.melee].concat(b.spells, [b.ranged]).forEach(function (w) {
      if (!w || !udLeft(x, w)) return;
      if (w.melee && inReach(x, t, w.melee)) out.push({ w: w, melee: true, v: w.t2 + charOf(x, w) + 2 });
      else if (w.range && inReach(x, t, w.range)) out.push({ w: w, melee: false, v: w.t2 + charOf(x, w) - (gap(x, t) !== null && gap(x, t) <= 1 ? 3 : 0) });
    });
    return out.sort(function (p, q) { return q.v - p.v; });
  }
  function maxReach(x) { var b = x.bot; return Math.max.apply(null, [b.melee, b.ranged].concat(b.spells).filter(function (w) { return w && udLeft(x, w); }).map(function (w) { return Math.max(w.melee, w.range); }).concat([1])); }
  function chooseTarget(x) {
    var list = enemiesOf(x), t = opts().tactics;
    if (!list.length) return null;
    var now = list.filter(function (y) { return options(x, y).length; });
    if (t === 'random') return pick(now.length ? now : list);
    if (t === 'focus') {
      var pool = now.length ? now : list;
      return pool.slice().sort(function (p, q) { return (p.st + p.ad) - (q.st + q.ad) || (gap(x, p) || 0) - (gap(x, q) || 0); })[0];
    }
    return nearest(x, list);
  }
  /* Send a practice crow's action through the same path as a player's; apply it at once when the Ref chose that (or nothing waits on it). */
  function act(x, a) {
    var r = crowAction(x, a, 'b' + nid());
    if (r && !r.applied && fxItems(r).length && (opts().autoApply || U.sim || !fxItems(r).some(function (f) { return f.damage > 0; }))) applyAct(r);
    return r;
  }
  function attack(x, t, o, extra) {
    var w = o.w, ch = charOf(x, w), m = mods(x, t, o.melee), r = test(ch + m.bonus, netEdges(m.e, m.b), 19);
    if (m.autoT3 && !r.doom) r.tier = 3;
    var dmg = r.tier === 3 ? w.t3 + ch : r.tier === 2 ? w.t2 + ch : 0;
    if (dmg && x.conds.Blessed) dmg += ch;
    var tg = [t];
    if (w.two) { var t2 = nearest(x, enemiesOf(x).filter(function (y) { return y !== t && options(x, y).some(function (q) { return q.w === w; }); })); if (t2) tg.push(t2); }
    var lash = w.spell && (r.doom || (r.tier === 1 && d(6) === 1));
    var note = testLine(r) + (m.why.length ? ' [' + m.why.join(', ') + ']' : '') + '.' + rollUD(x, w, r);
    var a = act(x, { type: 'attack', label: w.name.replace(/ Book$/, '') + (extra ? ' (crit: extra action)' : ''), targets: tg.map(function (y) { return { id: y.id, name: y.name }; }),
      tier: r.tier, crit: r.crit, doom: r.doom, melee: o.melee, ranged: !o.melee, damage: dmg, dismember: w.dismember, cast: w.spell, backlash: lash, rank: 0,
      allyDamage: w.t3 + ch, allyDamage2: w.t2 + ch, conds: r.tier === 3 ? w.cond3 : [], text: note });
    // A foe the computer runs counters a melee miss (its melee attack's tier 2 damage, tier 3 on a doom).
    if (a && o.melee && r.tier === 1 && (opts().foes === 'auto' || U.sim) && !t.dead && rxLeft(t) > 0 && meleeAtk(t)) a.counter = counterAct(t, x, r.doom);
    return r;
  }
  /* A crow heals the most hurt friend in reach (itself too) when one is at half Stamina or less. */
  function tryHeal(x) {
    var w = x.bot.heal;
    if (!w || !udLeft(x, w)) return false;
    var hurt = bots().filter(function (y) { return !y.dead && !y.out && y.st <= y.stMax / 2 && inReach(x, y, w.melee || 1); })
      .sort(function (p, q) { return p.st / p.stMax - q.st / q.stMax; })[0];
    if (!hurt) return false;
    var ch = x.bot.M, m = mods(x, null, false), r = test(ch, netEdges(m.e, m.b), 19), n = (r.tier === 3 ? w.t3 : r.tier === 2 ? w.t2 : w.t1) + ch;
    act(x, { type: 'attack', label: w.name.replace(/ Book$/, ''), target: hurt.id, targetName: hurt.name, tier: r.tier, crit: r.crit, doom: r.doom, heal: r.doom ? 0 : n, cast: true,
      backlash: r.doom, rank: 0, text: testLine(r) + '.' + rollUD(x, w, r) });
    return true;
  }
  function botTurn(x) {
    var c = S().combat, b = x.bot;
    if (!canAct(x) || botOut(x)) { x.done = c.round; return; }
    // the maneuver: stand up, break a grab, or heal
    var used = false;
    if (x.conds.Prone) { act(x, { type: 'maneuver', name: 'Stand Up' }); used = true; }
    else if (x.conds.Grabbed) {
      var g = byId(x.grabbedBy), m = mods(x, null, false), r = test(Math.max(b.A, b.S) + m.bonus, netEdges(m.e, m.b), 19);
      var e = act(x, { type: 'maneuver', name: 'Escape Grab', tier: r.tier, crit: r.crit, doom: r.doom, text: testLine(r) + '.' });
      if (r.tier === 2 && g && (opts().foes === 'auto' || U.sim) && rxLeft(g) > 0 && meleeAtk(g) && e) e.counter = counterAct(g, x, false);
      used = true;
    }
    if (!used) tryHeal(x);
    // the move and the action
    var t = chooseTarget(x);
    if (t && !x.conds.Grabbed) {
      if (!options(x, t).length) moveToward(x, t, b.melee ? b.melee.melee : maxReach(x), b.speed);
      if (!options(x, t).length) t = enemiesOf(x).filter(function (y) { return options(x, y).length; })[0] || t;
    }
    var o = t && options(x, t)[0];
    if (o) {
      var r1 = attack(x, t, o);
      if (r1.crit && !t.dead) { var t2 = foeOut(t) ? chooseTarget(x) : t, o2 = t2 && options(x, t2)[0]; if (o2) attack(x, t2, o2, true); }
    } else if (t) feed('**' + x.name + '** can’t reach a foe this turn.');
    x.done = c.round;
  }
  /* Answer counter prompts: a crow with a melee weapon and a reaction left counters a missed melee attack, Grab, or Knockback. */
  function counters() {
    var c = S().combat, did = false;
    (c.prompts || []).forEach(function (q) {
      var x = byId(q.to), by = byId(q.from);
      if (q.done || q.round !== c.round || !isBot(x)) return;
      q.done = true;
      var w = x.bot.melee;
      if (!w || !by || by.dead || x.dead || x.conds.Unconscious || botOut(x) || rxLeft(x) <= 0 || !inReach(x, by, w.melee)) return;
      var ch = charOf(x, w);
      act(x, { type: 'attack', label: w.name + ' (counter)', target: by.id, targetName: by.name, tier: q.doom ? 3 : 2, damage: (q.doom ? w.t3 : w.t2) + ch, melee: true, rxn: true, prompt: q.id });
      did = true;
    });
    return did;
  }

  // ------------------------------------------------------------------ a creature's turn (when the computer runs them)
  function reachOf(a) { var m = /M(\d+)/.exec(a[2] || ''), r = /R(\d+)/.exec(a[2] || ''); return { melee: m ? +m[1] : r ? 0 : 1, range: r ? +r[1] : 0 }; }
  function foeAttack(c, t) {
    var b = beast(c.cref), list = b ? b.atk : [];
    var ok = list.filter(function (a) { var r = reachOf(a); return r.melee && inReach(c, t, r.melee) || r.range && inReach(c, t, r.range); });
    return ok.sort(function (p, q) { return (q[3] + q[4] + q[1] * 2) - (p[3] + p[4] + p[1] * 2); })[0] || null;
  }
  function foeTurn(c) {
    var cb = S().combat, b = beast(c.cref);
    c.acted = cb.round;
    if (!canAct(c) || foeOut(c)) return;
    if (c.conds.Prone) { setCond(c, 'Prone', false); feed('**' + c.name + '** stands up.'); }
    if (c.conds.Grabbed && c.grabbedBy) { monsterManeuver(c, 'escape'); applyWaiting(); c.acted = cb.round; return; }
    if (!b || !b.atk.length) return;
    var t = nearest(c, enemiesOf(c));
    if (!t) return;
    c.tgt = t.id;
    var a = foeAttack(c, t);
    if (!a) {
      var far = Math.max.apply(null, b.atk.map(function (q) { var r = reachOf(q); return r.melee || 0; }).concat([1]));
      moveToward(c, t, far, parseInt(b.spd, 10) || 5);
      a = foeAttack(c, t);
      if (!a) { var o = enemiesOf(c).filter(function (y) { return foeAttack(c, y); })[0]; if (o) { t = o; c.tgt = t.id; a = foeAttack(c, t); } }
    }
    if (!a) { feed('**' + c.name + '** can’t reach anyone this turn.'); return; }
    if (twoTargets(a)) { var t2 = nearest(c, enemiesOf(c).filter(function (y) { return y !== t; })); c.tgt2 = t2 ? t2.id : null; }
    monsterAttack(c, a);
    applyWaiting();
    if (ui.dice && ui.dice.r && ui.dice.r.crit && !t.dead) { var a2 = foeAttack(c, t); if (a2) { monsterAttack(c, a2); applyWaiting(); } }
    c.acted = cb.round;
  }
  /* Hits waiting for the Ref this round: dealt at once when "Apply hits at once" is on (or in a simulation). */
  function applyWaiting() {
    if (!opts().autoApply && !U.sim) return false;
    var c = S().combat, did = false;
    (c.acts || []).forEach(function (a) { if (!a.applied && a.round === c.round && fxItems(a).some(function (f) { return byId(f.id); })) { applyAct(a); did = true; } });
    return did;
  }

  // ------------------------------------------------------------------ the turn order
  /* Whose turn it is: 'crows' (a practice crow still to act), 'foes' (a foe still to act), or 'end' (everyone has gone). */
  function phase() {
    var c = S().combat, auto = opts().foes === 'auto' || U.sim;
    var crowsLeft = bots().filter(function (x) { return x.done !== c.round && canAct(x) && !botOut(x); }).length +
      (auto ? c.list.filter(function (x) { return x.kind === 'ally' && x.acted !== c.round && canAct(x); }).length : 0);
    var foesLeft = foes().filter(function (x) { return x.acted !== c.round && canAct(x) && !foeOut(x); }).length;
    var order = c.first === 'foes' ? [['foes', foesLeft], ['crows', crowsLeft]] : [['crows', crowsLeft], ['foes', foesLeft]];
    return order[0][1] ? order[0][0] : order[1][1] ? order[1][0] : 'end';
  }
  /*
   * One step of the fight: a reaction, a crow's turn, a creature's turn (when the computer runs them), or the next round. Returns false when
   * nothing could be done (the fight is over, it hasn't started, or the foes' turn is the Ref's).
   */
  function step() {
    var c = S().combat;
    if (!run() || run().result) return false;
    markOut();
    var res = outcome();
    if (res) { finish(res); return true; }
    if (!c.round) return false;
    if (counters()) { save(); render(); return true; }
    applyWaiting();
    var ph = phase(), auto = opts().foes === 'auto' || U.sim;
    if (ph === 'crows') {
      var x = bots().filter(function (y) { return y.done !== c.round && canAct(y) && !botOut(y); })[0];
      if (x) botTurn(x);
      else { var al = c.list.filter(function (y) { return y.kind === 'ally' && y.acted !== c.round && canAct(y); })[0]; if (al) foeTurn(al); }
      bots().forEach(function (y) { if (!canAct(y) || botOut(y)) y.done = c.round; });
      markOut(); save(); render(); return true;
    }
    if (ph === 'foes') {
      if (!auto) return false;
      foeTurn(foes().filter(function (y) { return y.acted !== c.round && canAct(y) && !foeOut(y); })[0]);
      markOut(); save(); render(); return true;
    }
    if (opts().autoRound || U.sim) { nextRound(); return true; }
    return false;
  }
  function tally(res) {
    var c = S().combat, bs = bots(), fs = foes();
    return { outcome: res, rounds: c.round, crows: bs.length, crowsOut: bs.filter(botOut).length, crowsDead: bs.filter(function (x) { return x.dead; }).length,
      foes: fs.length, foesDown: fs.filter(foeOut).length };
  }
  var WORDS = { won: 'The crows won', lost: 'The crows were beaten', draw: 'No winner after ' + ROUND_CAP + ' rounds' };
  function resultText(r) {
    return WORDS[r.outcome] + (r.outcome === 'draw' ? '' : ' in ' + plural(r.rounds, 'round')) + ': ' + r.foesDown + '/' + r.foes + ' foes down, ' +
      r.crowsOut + '/' + r.crows + ' crows out' + (r.crowsDead ? ' (' + r.crowsDead + ' dead)' : '') + '.';
  }
  function finish(res) {
    var R = run(), r = tally(res);
    if (U.sim) { R.simOut = r; return; }
    R.result = r; U.playing = false;
    P().history = [{ kind: 'run', name: R.name, at: Date.now(), r: r }].concat(P().history || []).slice(0, 8);
    feed('**Practice over.** ' + resultText(r));
    toast(resultText(r));
    save(); render();
  }

  // ------------------------------------------------------------------ starting, restarting, and ending
  function snapOf() { var sc = scene(); return { combat: clone(S().combat), scene: sc ? sc.id : null, tokens: sc ? clone(sc.tokens) : null }; }
  function restore(from) {
    var c = S().combat;
    Object.keys(c).forEach(function (k) { delete c[k]; });
    Object.assign(c, clone(from.combat));
    var sc = state.vtt.scenes.filter(function (s) { return s.id === from.scene; })[0];
    if (sc && from.tokens) sc.tokens = clone(from.tokens);
    A.vtt.deselect(); A.vtt.changed();
  }
  function startPractice() {
    var c = S().combat, sc = scene(), o = opts();
    if (!foes().some(function (x) { return !foeOut(x); })) { toast('No foes in the fight: load an encounter onto the map first.'); return; }
    if (o.crows.length !== o.n) fillCrows();
    var enc = runningEnc();
    state.practice.run = { name: enc ? enc.name || 'untitled' : foes().length + ' foes', snap: { combat: clone(c), scene: sc ? sc.id : null, tokens: sc ? clone(sc.tokens) : null, log: clone(state.log), dice: ui.dice || null } };
    // The crows' places on the map go to the practice crows (and the real crows leave the fight until the practice ends).
    var spots = sc ? sc.tokens.filter(function (t) { return t.pcId && !t.marker; }).map(function (t) { return { x: t.x, y: t.y }; }) : [];
    c.list = c.list.filter(function (x) { return x.kind !== 'pc'; });
    if (sc) sc.tokens = sc.tokens.filter(function (t) { return !(t.pcId && !t.marker); });
    c.round = 0; c.first = null; c.feed = []; c.acts = []; c.prompts = []; c.assists = []; c.surprise = o.surprise;
    c.list.forEach(function (x) { delete x.tgt; delete x.tgt2; x.acted = 0; });
    if (sc) A.vtt.resetSpawn();
    o.crows.forEach(function (bg, i) {
      var x = makeCrow(bg, i);
      c.list.splice(i, 0, x);
      if (sc) { var t = A.vtt.addToken(sc, { name: x.name, kind: 'pc', pcId: x.pcId, cid: x.id, sight: 1, speed: x.bot.speed }, -1); if (spots[i]) { t.x = spots[i].x; t.y = spots[i].y; } }
    });
    A.vtt.deselect();
    run().start = snapOf();
    ui.dice = null; U.playing = o.pace !== 'step'; U.last = Date.now();
    nextRound();
    toast('Practice: ' + plural(o.n, 'computer crow') + ' against ' + run().name + '. ' + (o.foes === 'auto' ? 'The computer runs both sides.' : 'You run the foes: roll for each one, and the crows answer on their turn.'));
  }
  function restartPractice() {
    var R = run(); if (!R) return;
    restore(R.start); delete R.result; ui.dice = null;
    U.playing = opts().pace !== 'step'; U.last = Date.now();
    nextRound();
  }
  function endPractice() {
    var R = run(); if (!R) return;
    restore(R.snap);
    state.log = R.snap.log; ui.dice = R.snap.dice || null;
    state.practice.run = null; U.playing = false;
    save(); render();
    toast('Practice over: the fight and the map are back as they were.');
  }
  /* Play the practice fight through n times from its start (the computer runs both sides; nothing is drawn or saved meanwhile). */
  function simulate(n) {
    var R = run(); if (!R) return;
    var keep = { save: A.save, render: A.render, log: A.log }, noop = function () {}, out = [], dice = ui.dice;
    A.save = noop; A.render = noop; A.log = noop; U.sim = true; U.playing = false;
    try {
      for (var i = 0; i < n; i++) {
        restore(R.start); delete R.simOut; delete R.result; nextRound();
        for (var g = 0; g < 4000 && !R.simOut; g++) if (!step()) break;
        out.push(R.simOut || tally('draw'));
      }
    } finally {
      A.save = keep.save; A.render = keep.render; A.log = keep.log; U.sim = false;
      restore(R.start); delete R.simOut; delete R.result; ui.dice = dice; nextRound();
    }
    var won = out.filter(function (r) { return r.outcome === 'won'; }), avg = function (k, list) { list = list || out; return list.length ? list.reduce(function (s, r) { return s + r[k]; }, 0) / list.length : 0; };
    var sum = { kind: 'sim', name: R.name, at: Date.now(), n: n, won: won.length, lost: out.filter(function (r) { return r.outcome === 'lost'; }).length,
      rounds: avg('rounds', won.length ? won : out), crowsOut: avg('crowsOut'), crowsDead: avg('crowsDead'), crows: out[0] ? out[0].crows : 0 };
    R.sim = sum;
    P().history = [sum].concat(P().history || []).slice(0, 8);
    save(); render();
    toast('Simulated ' + plural(n, 'fight') + ': the crows won ' + Math.round(won.length / n * 100) + '%.');
  }
  function simText(s) {
    return plural(s.n, 'fight') + ': crows won ' + Math.round(s.won / s.n * 100) + '%' + (s.lost ? ', lost ' + Math.round(s.lost / s.n * 100) + '%' : '') +
      '; ' + (s.won ? 'wins took ' : 'fights took ') + s.rounds.toFixed(1) + ' rounds; ' + s.crowsOut.toFixed(1) + '/' + s.crows + ' crows out, ' + s.crowsDead.toFixed(1) + ' dead on average.';
  }

  // The pace: one step every so often while playing (Step mode: only when the Ref presses Next step).
  setInterval(function () {
    if (!state || !run() || !U.playing || U.sim || run().result) return;
    var ms = PACE_MS[opts().pace];
    if (!ms || Date.now() - U.last < ms) return;
    if (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && $('side-practice').contains(document.activeElement)) return;
    U.last = Date.now();
    step();
  }, 100);

  // ------------------------------------------------------------------ the sidebar block
  function renderPractice() {
    var box = $('side-practice'); if (!box) return;
    box.innerHTML = '';
    var on = tab === 'vtt' && !!(run() || scene());   // on the Tabletop, once there's a scene
    box.classList.toggle('on', on);
    if (!on) return;
    var kids = [el('h3', { text: 'Practice fight' })];
    if (run()) kids = kids.concat(runUI()); else kids = kids.concat(setupUI());
    var hist = (P().history || []).slice(0, 5);
    if (hist.length) kids.push(el('details', { class: 'prac-hist' }, [el('summary', { text: 'Past results (' + hist.length + ')' }), el('ul', null, hist.map(function (h) {
      return el('li', null, [el('b', { text: h.name + ': ' }), h.kind === 'sim' ? simText(h) : resultText(h.r)]);
    }))]));
    kids.forEach(function (k) { if (k) box.appendChild(k); });
  }
  function setupUI() {
    var o = opts(), c = S().combat, standing = foes().filter(function (x) { return !foeOut(x); });
    if (!standing.length) return [el('p', { class: 'fine', text: 'Load an encounter onto the battle map (the + at the bottom of the map, then Encounter), and practise it here against computer-controlled crows.' })];
    if (o.crows.length !== o.n) fillCrows();
    var names = bgNames(), out = [
      el('p', { class: 'fine', text: 'Run ' + plural(standing.length, 'foe') + ' on the map against computer-controlled crows. Nothing from the practice is kept: the fight, the map, and the log go back to how they are now.' }),
      el('div', { class: 'row center prac-row' }, [field('Crows', sel(o, 'n', [1, 2, 3, 4, 5, 6], { num: true, label: 'Number of practice crows', on: fillCrows })),
        field('Party', sel(o, 'mix', MIXES.map(function (m) { return [m[0], m[1]]; }), { label: 'Party mix', on: fillCrows }), 'grow')]),
      el('ol', { class: 'prac-crows' }, o.crows.map(function (bg, i) {
        var s = el('select', { class: 'in', 'aria-label': 'Crow ' + (i + 1) + ' background', onchange: function () { o.crows[i] = this.value; save(); render(); } },
          names.map(function (n) { return el('option', { value: n, text: n }); }));
        s.value = bg;
        return el('li', null, [s, el('span', { class: 'fine', text: crowSummary(bg) })]);
      })),
      field('Experience', sel(o, 'exp', EXP, { label: 'Experience' })),
      field('Armor', sel(o, 'armor', ARMOR, { label: 'Armor' })),
      field('Tactics', sel(o, 'tactics', TACTICS, { label: 'Tactics' })),
      field('Foes', sel(o, 'foes', FOES, { label: 'Who runs the foes' })),
      field('Surprise', sel(o, 'surprise', [['none', 'No surprise'], ['crows', 'The crows are surprised'], ['foes', 'The foes are surprised']], { label: 'Surprise' })),
      field('A crow leaves the fight', sel(o, 'fallAt', FALL, { label: 'When a crow leaves the fight' })),
      field('Pace', sel(o, 'pace', PACE, { label: 'Pace' })),
      chk(o, 'autoApply', ' Apply hits at once', { title: 'Off: every hit waits for your approval on the map, the way a real fight does' }),
      chk(o, 'autoRound', ' Start the next round on its own', { title: 'Off: press Next round at the top of the map when everyone has gone' }),
      el('div', { class: 'row' }, [btn('Start practice', startPractice, 'btn-primary', 'The practice crows take the real crows’ places, and round 1 starts')])
    ];
    if (c.round) out.splice(1, 0, el('p', { class: 'fine warn-t', text: 'The fight on the map is in round ' + c.round + '; the practice starts from round 1 with the foes as they are now.' }));
    return out;
  }
  function runUI() {
    var R = run(), o = opts(), c = S().combat, ph = R.result ? 'end' : phase(), auto = o.foes === 'auto';
    var status = R.result ? resultText(R.result) : !c.round ? 'Not started.' : 'Round ' + c.round + ' · ' + (c.first === 'crows' ? 'crows first' : 'foes first') + '. ' +
      (ph === 'crows' ? 'The crows’ turn.' : ph === 'foes' ? (auto ? 'The foes’ turn.' : 'Your turn: roll for each foe on the map (each roll marks it acted), or press Foes done.') :
        o.autoRound ? 'Everyone has gone.' : 'Everyone has gone: press Next round.');
    var ctl = [
      R.result ? null : o.pace === 'step' ? btn('Next step', function () { if (!step()) toast(ph === 'foes' && !auto ? 'Waiting for the foes: press Foes done when they’ve gone.' : 'Nothing to do yet.'); }, 'btn-small btn-primary', 'One crow’s turn, a reaction, a foe’s turn, or the next round')
        : btn(U.playing ? 'Pause' : 'Play', function () { U.playing = !U.playing; U.last = 0; render(); }, 'btn-small' + (U.playing ? '' : ' btn-primary')),
      !R.result && ph === 'foes' && !auto ? btn('Foes done', function () { foes().forEach(function (x) { if (!x.dead) x.acted = c.round; }); save(); render(); }, 'btn-small', 'Mark every foe as having acted this round') : null,
      !R.result && ph === 'end' && !o.autoRound ? btn('Next round', function () { nextRound(); }, 'btn-small') : null,
      btn('Restart', restartPractice, 'btn-small btn-ghost', 'Back to the start of this practice, and roll initiative again'),
      btn('End practice', endPractice, 'btn-small btn-ghost', 'The practice crows leave; the fight, the map, and the log go back to how they were')];
    var crows = el('ul', { class: 'prac-list' }, bots().map(function (x) {
      return el('li', { class: x.dead ? 'dead' : botOut(x) ? 'out' : '' }, [el('b', { text: x.name }), ' St ' + x.st + '/' + x.stMax + (x.adMax ? ' · AD ' + x.ad + '/' + x.adMax : '') +
        (x.wounds ? ' · ' + plural(x.wounds, 'wound') : '') + (x.dead ? ' · dead' : botOut(x) ? ' · out' : c.round && x.done === c.round ? ' · done' : '')]);
    }));
    var n = el('input', { type: 'number', class: 'tiny', min: 1, max: 200, value: o.sims || 20, 'aria-label': 'How many fights to simulate',
      onchange: function () { o.sims = clamp(parseInt(this.value, 10) || 20, 1, 200); save(); } });
    return [el('p', { class: 'prac-status' + (R.result ? ' done' : '') }, [el('b', { text: R.name + ': ' }), status]),
      el('div', { class: 'row prac-ctl' }, ctl.filter(Boolean)),
      R.result ? null : field('Pace', sel(o, 'pace', PACE, { label: 'Pace', on: function (v) { U.playing = v !== 'step' && U.playing; } })),
      R.result ? null : el('div', { class: 'row' }, [chk(o, 'autoApply', ' Apply hits at once'), chk(o, 'autoRound', ' Next round on its own')]),
      R.result ? null : field('Foes', sel(o, 'foes', FOES, { label: 'Who runs the foes' })),
      crows,
      el('div', { class: 'row center prac-sim' }, [btn('Simulate', function () { var k = o.sims || 20; toast('Simulating ' + plural(k, 'fight') + '…'); setTimeout(function () { simulate(k); }, 30); }, 'btn-small',
        'Play this practice through many times from its start, the computer running both sides, for the odds'), n, el('span', { class: 'fine', text: 'fights' })]),
      R.sim ? el('p', { class: 'fine', text: 'Simulated ' + simText(R.sim) }) : null];
  }

  A.add({ practiceOn: practiceOn, startPractice: startPractice, restartPractice: restartPractice, endPractice: endPractice, simulate: simulate, renderPractice: renderPractice,
    practiceStep: step, makeCrow: makeCrow });
})();
