/*
 * Ref Screen: the combat tracker: combatants, damage, monster attacks and maneuvers, reactions, effects and undo, items on the
 * ground, and the live fight shared with the players’ Play pages. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), beast = f('beast'), beastSelect = f('beastSelect'), btn = f('btn'), card = f('card'), chk = f('chk'),
      clamp = f('clamp'), cloudOn = f('cloudOn'), encLink = f('encLink'), field = f('field'), hitControls = f('hitControls'), inp = f('inp'),
      int = f('int'), log = f('log'), lookup = f('lookup'), more = f('more'), nid = f('nid'), render = f('render'), rich = f('rich'),
      rollInText = f('rollInText'), runningEnc = f('runningEnc'), S = f('S'), save = f('save'), sheetOp = f('sheetOp'), sheetWin = f('sheetWin'),
      test = f('test'), testLine = f('testLine');
  var $ = A.$, clone = A.clone, d = A.d, d100 = A.d100, el = A.el, netEdges = A.netEdges, pick = A.pick, plural = A.plural, Rules = A.Rules,
      signed = A.signed, SIZES = A.SIZES, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

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
    var parts = [], st0 = c.st, w0 = c.wounds, slots = slotsOf(c);
    var r = Rules.damage({ amount: amount, vulnerable: !!c.conds.Vulnerable, piercing: piercing, ad: [c.ad], stamina: c.st, woundRoom: slots ? slots - c.wounds : 0 }), total = r.total;
    if (r.vul) parts.push('vulnerable +' + r.vul);
    if (r.absorbed[0]) { c.ad -= r.absorbed[0]; parts.push(r.absorbed[0] + ' to AD'); }
    if (r.stamina) { c.st -= r.stamina; parts.push(r.stamina + ' to Stamina'); }
    if (r.wounds) { c.wounds += r.wounds; parts.push(plural(r.wounds, 'wound')); }
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

  A.add({ addCombatant: addCombatant, addPartyToCombat: addPartyToCombat, addParty: addParty, surprised: surprised, slotsOf: slotsOf, byId: byId,
      sizeOf: sizeOf, noBigger: noBigger, setCond: setCond, damage: damage, heal: heal, syncPC: syncPC, pullVitals: pullVitals,
      targetsFor: targetsFor, targetOf: targetOf, twoTargets: twoTargets, rxMax: rxMax, rxLeft: rxLeft, useRx: useRx, releaseGrabs: releaseGrabs,
      grabbing: grabbing, tauntOn: tauntOn, newRound: newRound, rollMods: rollMods, tierFx: tierFx, hitDamage: hitDamage, testWith: testWith,
      meleeAtk: meleeAtk, monsterAttack: monsterAttack, prompt: prompt, monsterManeuver: monsterManeuver, fxItems: fxItems, applyAct: applyAct,
      undoAct: undoAct, counterDamage: counterDamage, counterAct: counterAct, feed: feed, clearCombat: clearCombat, itemName: itemName,
      itemsText: itemsText, newItem: newItem, onGround: onGround, itemNews: itemNews, putDown: putDown, creaturePickUp: creaturePickUp,
      creatureDrop: creatureDrop, dropFromFallen: dropFromFallen, groundText: groundText, itemsPanel: itemsPanel, pcOf: pcOf, healthWord: healthWord,
      publicCombat: publicCombat, liveChanged: liveChanged, publish: publish, fetchActions: fetchActions, takeAction: takeAction,
      doomOptions: doomOptions, livePanel: livePanel, renderCombat: renderCombat, combatUI: combatUI, combatRow: combatRow, btnPM: btnPM,
      SIZE_ORDER: SIZE_ORDER, live: live, dropQueued: dropQueued, MANEUVER_NOTES: MANEUVER_NOTES });
})();
