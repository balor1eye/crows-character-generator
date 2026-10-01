/*
 * Crows Playtest 2 Character Generator — Play mode (at-the-table character management).
 * Tracks Stamina, AD, wounds, conditions, cruelty, expertise uses, usage dice, ammo, dungeon turns,
 * rests, XP, and rolls tests/attacks/castings. Depends on app.js (window.CrowsApp.core) and game-data.js.
 * Live state lives in state.play; per-card live values (ud, dmg, ammo) live on the inventory cards.
 */
(function () {
  'use strict';

  var C = window.CrowsApp.core;
  var el = C.el, $ = C.$, d = C.d, fmt = C.fmt, signed = C.signed, item = C.item;
  var MODE_KEY = 'crows-pt2-mode';
  var CONDITIONS = ['Blessed', 'Grabbed', 'Prone', 'Vulnerable', 'Weakened', 'Unconscious'];
  var DT_CONDITIONS = ['Blessed', 'Vulnerable', 'Weakened']; // end at the end of a dungeon turn
  // Rules book, Conditions (condensed). Shown as tooltips on the condition buttons.
  var CONDITION_RULES = {
    Blessed: 'Edge on all tests, and your attacks deal extra damage equal to the characteristic used. Ends at the end of the dungeon turn.',
    Grabbed: 'Speed 0, you can\'t flank, and attacks against you gain an edge. You move with your grabber. Ends if the grabber lets go, moves out of range, or is killed, prone, or unconscious, or with the Escape Grab maneuver.',
    Prone: 'Speed halved, bane on your melee attacks, and you can\'t flank. Melee attacks against you gain an edge; ranged attacks against you take a bane. Stand up as a maneuver (speed 1+).',
    Vulnerable: 'Each time you take damage, take an extra 1d6. Ends at the end of the dungeon turn.',
    Weakened: 'Bane on all tests. Ends at the end of the dungeon turn.',
    Unconscious: 'Prone, speed 0, no actions, maneuvers, or reactions. Automatic doom on Agility and Strength tests, double bane on Mind tests to notice your surroundings, and attacks against you are tier 3. Taking damage or a loud noise within 10 squares wakes you.'
  };
  var LORE = ['Historical Lore', 'Magic Lore', 'Monster Lore', 'Nature Lore', 'Religious Lore'];
  var AMMO = { Shortbow: 'Quiver of 20 Arrows', Longbow: 'Quiver of 20 Arrows', Crossbow: 'Case of 20 Crossbow Bolts' };
  var MAGIC_SLOTS = ['Head', 'Neck', 'Waist', 'Arms', 'Finger', 'Feet'];
  var PET_FEED = { 'Riding Horse': 2 };

  // UI-only state (not saved with the character).
  var ui = { condInfo: false, eb: 0, mod: 0, dmg: '', pierce: false, first: '', heal: '', coins: '', tDesc: '', tGc: '', tPlayers: 4, xpAmt: '',
    ration: '', activity: '', repair: '', study: '', tended: false, tendedKit: false, useKit: false, caretaker: false };
  var last = null; // most recent roll

  function S() { return window.CrowsApp.state; }
  function P() { return S().play; }
  function log(msg) {
    var l = P().log;
    if (window.CrowsRefView) msg = 'Ref: ' + msg;   // the Ref changing a player's sheet
    l.unshift({ t: Date.now(), m: msg });
    if (l.length > 200) l.length = 200;
  }
  function commit(msg) { if (msg) log(msg); if (!applyingRef) handEdits++; C.render(); }

  /*
   * Changes the Ref Screen sends (refChange) are steps (Stamina -1, XP +130), not final values. Until saved they're
   * kept here, so if the player saved at the same moment, they're replayed on top of the player's version instead
   * of asking which one to keep. Only when nothing was changed by hand here meanwhile (handEdits), since a hand
   * change is a final value that can't be replayed.
   */
  var refOps = [], applyingRef = false, handEdits = 0, handSaved = 0;
  var refQueue = {
    start: function () { return { n: refOps.length, hand: handEdits }; },   // a save is being sent
    saved: function (snap) { refOps.splice(0, snap.n); handSaved = snap.hand; },   // ...and it went through
    canRedo: function () { return refOps.length > 0 && handEdits === handSaved; },
    redo: function () { var ops = refOps; refOps = []; ops.forEach(refChange); }
  };

  // ------------------------------------------------------------------ mode switch
  // The Ref Screen's condensed status view is always Play mode, without changing this browser's choice.
  var FORCED = window.CrowsRefView && window.CrowsRefView.status ? 'play' : null;
  // On the accounts site Play has its own address, play (the same page, see server/public/.htaccess); opening it starts in Play.
  var GEN = 'Crows_Character_Generator.html', PLAY = 'play';
  if (/\/play$/.test(location.pathname) && !FORCED) try { localStorage.setItem(MODE_KEY, 'play'); } catch (e) { /* storage unavailable */ }
  function mode() { if (FORCED) return FORCED; try { return localStorage.getItem(MODE_KEY) === 'play' ? 'play' : 'build'; } catch (e) { return 'build'; } }
  function setMode(m) {
    if (FORCED) return;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* storage unavailable */ }
    applyMode(m);
    C.render();
    window.scrollTo(0, 0);
  }
  function applyMode(m) {
    document.body.setAttribute('data-mode', m);
    $('tab-build').setAttribute('aria-pressed', String(m === 'build'));
    $('tab-play').setAttribute('aria-pressed', String(m === 'play'));
    var what = m === 'play' ? 'Play' : 'Character Generator';
    document.title = 'The Nest · ' + what + (m === 'play' && campaignName() ? ' · ' + campaignName() : '');
    var sub = document.querySelector('.brand-sub');
    if (sub) sub.textContent = 'Crows Playtest 2 · ' + what;
    syncAddress();
  }
  /* Show this mode's address. Only where the accounts server answered: elsewhere there's no play address to go to. */
  function syncAddress() {
    if (FORCED || !window.CrowsCloud || !window.CrowsCloud.server) return;
    var dir = location.pathname.replace(/[^\/]*$/, ''), page = mode() === 'play' ? PLAY : GEN;
    var search = location.search.replace(/([?&])mode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    if (location.pathname === dir + page && search === location.search) return;
    try { history.replaceState(history.state, '', dir + page + search + location.hash); } catch (e) { /* ignore */ }
  }
  /* The campaign the open crow is playing in, if any (from the accounts server), for Play's title. */
  var campaign = null;   // { id: record id, name }
  function campaignName() { return campaign && window.CrowsCloud && campaign.id === window.CrowsCloud.recordId ? campaign.name : null; }
  function loadCampaign() {
    var id = window.CrowsCloud && window.CrowsCloud.recordId;
    if (!id) return;
    window.CrowsCloud.campaign().then(function (name) { campaign = name ? { id: id, name: name } : null; applyMode(mode()); }, function () { /* no title change */ });
  }
  /* A Ref accepted the open crow into `name` while the page was open. */
  function joined(name) {
    var id = window.CrowsCloud && window.CrowsCloud.recordId;
    if (id) { campaign = { id: id, name: name }; applyMode(mode()); }
  }
  function gotoBuild(sectionId) {
    setMode('build');
    var n = $(sectionId);
    if (n) { if (n.tagName === 'DETAILS') n.open = true; n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  // ------------------------------------------------------------------ inventory helpers
  function carried() { return S().inv.filter(function (c) { return c.area !== 'none'; }); }
  function inHands() { return S().inv.filter(function (c) { return c.area === 'hand'; }).sort(function (a, b) { return a.idx - b.idx; }); }
  function where(c) {
    return c.area === 'hand' ? 'Hand ' + (c.idx + 1) : c.area === 'belt' ? 'Belt ' + (c.idx + 1) : c.area === 'pack' ? 'Backpack ' + (c.idx + 1) : 'Not carried';
  }
  function udInfo(key) {
    var m = /UD:?\s*(\d+)\s*\(([^)]*)\)/.exec(item(key).txt);
    if (!m) return null;
    var f = m[2];
    return { max: +m[1], useless: /Useless/.test(f), refuel: /Refuel/.test(f), rest: /Rest/.test(f), activate: /Activate/.test(f), dt: /DT/.test(f), fuel: /oil/i.test(f) ? 'Oil Flask' : null };
  }
  function udNow(c) { var u = udInfo(c.key); return u ? (typeof c.ud === 'number' ? Math.min(c.ud, u.max) : u.max) : 0; }
  function removeCard(c) { S().inv = S().inv.filter(function (x) { return x !== c; }); }
  function useOne(c) { // consume one item from a stack
    c.qty--; delete c.ud;
    if (c.qty <= 0) removeCard(c);
  }
  function findCarried(key) { return carried().filter(function (c) { return c.key === key; })[0] || null; }
  // Roll a card's usage dice: each 1 or 2 is removed.
  function rollUD(c, why) {
    var u = udInfo(c.key), n = udNow(c);
    if (!u || n <= 0) return c.key + ' has no usage dice left.';
    var r = []; for (var i = 0; i < n; i++) r.push(d(6));
    var lost = r.filter(function (x) { return x <= 2; }).length;
    c.ud = n - lost;
    var msg = c.key + ' UD' + (why ? ' (' + why + ')' : '') + ': rolled ' + r.join(', ') + (lost ? ' - lost ' + lost + ', ' + c.ud + ' left' : ' - no loss');
    if (c.ud === 0) {
      if (u.useless) { msg += '. It is used up'; useOne(c); if (c.qty > 0) msg += ' (' + c.qty + ' left in the stack)'; }
      else if (u.refuel) msg += '. Needs refuelling (' + (u.fuel || 'fuel') + ')';
      else if (u.rest) msg += '. Recharges on a rest';
    }
    return msg + '.';
  }

  // ------------------------------------------------------------------ vitals helpers
  function setStamina(v) { var m = C.staminaMax(); v = Math.max(0, Math.min(m, v)); P().stamina = v >= m ? null : v; }
  function absorbers() {
    var ai = C.armorInfo(), out = [];
    if (ai.worn) out.push(ai.worn);
    // A thrown parry weapon isn't in hand to parry with.
    inHands().forEach(function (c) { if (!c.thrown && C.adMax(c) > 0 && out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function speed() {
    var p = P(), occ = C.occupancy(), slow = 0;
    Object.keys(p.wounds).forEach(function (i) { if (occ.pack[+i] !== null) slow++; });
    var base = Math.max(0, CROWS.BASE_SPEED - slow), note = slow ? '-' + slow + ' wounded slots' : '';
    if (p.conds.Grabbed || p.conds.Unconscious) return { v: 0, note: p.conds.Grabbed ? 'grabbed' : 'unconscious' };
    if (p.conds.Prone) return { v: Math.floor(base / 2), note: (note ? note + ', ' : '') + 'halved (prone)' };
    return { v: base, note: note };
  }
  // Put n wounds in backpack slots: empty slots first, then the highest-numbered ones.
  function addWounds(n, kind) {
    var p = P(), occ = C.occupancy(), placed = 0;
    var order = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    var free = order.filter(function (i) { return !p.wounds[i] && occ.pack[i] === null; })
      .concat(order.filter(function (i) { return !p.wounds[i] && occ.pack[i] !== null; }));
    for (var k = 0; k < n && k < free.length; k++) { p.wounds[free[k]] = kind || 'w'; placed++; }
    return placed;
  }
  // Heal n ordinary wounds, freeing item slots first (restores speed).
  function healWounds(n) {
    var p = P(), occ = C.occupancy(), healed = 0;
    var ws = Object.keys(p.wounds).map(Number).filter(function (i) { return p.wounds[i] === 'w'; })
      .sort(function (a, b) { return (occ.pack[b] !== null) - (occ.pack[a] !== null) || b - a; });
    for (var k = 0; k < n && k < ws.length; k++) { delete p.wounds[ws[k]]; healed++; }
    return healed;
  }
  function takeDamage() {
    var p = P(), amt = parseInt(ui.dmg, 10);
    if (!(amt > 0)) { C.toast('Enter the damage first.'); return; }
    var parts = [], dmg = amt;
    if (p.conds.Vulnerable) { var v = d(6); dmg += v; parts.push('vulnerable +' + v); }
    if (!ui.pierce) {
      var abs = absorbers().filter(function (c) { return C.adNow(c) > 0; });
      abs.sort(function (a, b) { return (String(b.id) === ui.first) - (String(a.id) === ui.first); });
      abs.forEach(function (c) {
        if (!dmg) return;
        var a = Math.min(dmg, C.adNow(c)); c.dmg = (c.dmg || 0) + a; dmg -= a;
        parts.push(c.key + ' absorbs ' + a + ' (AD ' + C.adNow(c) + ' left)');
      });
    } else parts.push('piercing');
    var cur = C.curStamina(), s = Math.min(dmg, cur);
    if (s) { setStamina(cur - s); dmg -= s; parts.push('-' + s + ' Stamina'); }
    if (dmg > 0) { var w = addWounds(dmg, 'w'); parts.push(w + ' wound' + (w === 1 ? '' : 's')); }
    ui.dmg = '';
    var dead = C.woundCount() >= 10;
    commit('Took ' + amt + ' damage: ' + parts.join(', ') + '.' + (dead ? ' All 10 backpack slots are wounded: your crow is dead.' : ''));
  }

  // ------------------------------------------------------------------ expertise
  function expList() {
    var uses = C.expertiseUses(), p = P(), out = [];
    Object.keys(CROWS.EXPERTISES).forEach(function (g) {
      CROWS.EXPERTISES[g].forEach(function (e) {
        var n = e[0], total = (uses[n] || 0) + (p.temp[n] || 0);
        if (total > 0) out.push({ name: n, group: g, total: total, spent: Math.min(p.spent[n] || 0, total), desc: e[1] });
      });
    });
    return out;
  }
  function spendExp(name) {
    var e = expList().filter(function (x) { return x.name === name; })[0];
    if (!e || e.spent >= e.total) return false;
    P().spent[name] = e.spent + 1;
    return true;
  }

  // ------------------------------------------------------------------ dice
  function netEdge(extraE, extraB) {
    var e = 0, b = 0;
    if (ui.eb > 0) e = ui.eb; else b = -ui.eb;
    e += extraE; b += extraB;
    return Math.min(e, 2) - Math.min(b, 2);
  }
  function tierOf(total) { return total >= 17 ? 3 : total >= 12 ? 2 : 1; }
  // opts: label, charName, charVal, kind ('test'|'attack'|'cast'|'miasma'), group (expertise group allowed), wtype, melee, dmg {t2,t3,brutal}, card
  function rollTest(opts) {
    if (last && last.chaosPending) log(last.label + ': kept tier 1. ' + chaosRoll(last));
    var p = P(), ch = C.characteristics().values;
    var extraE = p.conds.Blessed ? 1 : 0, extraB = p.conds.Weakened ? 1 : 0;
    if (isAttack(opts) && opts.melee && p.conds.Prone) extraB++;
    var net = netEdge(extraE, extraB);
    var a = d(10), b = d(10), nat = a + b;
    var bonus = net === 1 ? 2 : net === -1 ? -2 : 0;
    var mod = (opts.charVal || 0) + (ui.mod || 0) + (opts.extraMod || 0) + bonus;
    var total = nat + mod;
    var crit = nat >= 19, doom = nat <= 3;
    if (p.conds.Unconscious && /Agility|Strength/.test(opts.charName || '')) doom = true;
    var tier = doom ? 1 : crit ? 3 : tierOf(total);
    if (!doom && !crit && net === 2) tier = Math.min(3, tier + 1);
    if (!doom && !crit && net === -2) tier = Math.max(1, tier - 1);
    var r = { label: opts.label, opts: opts, dice: [a, b], nat: nat, mod: mod, total: total, net: net, crit: crit, doom: doom,
      baseTier: tier, tier: tier, exp: null, extra: [], conds: [] };
    if (extraE) r.conds.push('blessed: edge');
    if (extraB) r.conds.push((p.conds.Weakened ? 'weakened' : 'prone') + ': bane');
    void ch;
    after(r);
    last = r;
    ui.eb = 0;
    log(describe(r));
    C.render();
  }
  function after(r) {
    var o = r.opts, p = P();
    if (o.kind === 'attack' && o.ammo) {
      var q = findCarried(o.ammo);
      if (q) {
        q.ammo = (typeof q.ammo === 'number' ? q.ammo : 20) - 1;
        r.extra.push(o.ammo.replace(/ of 20.*/, '') + ': ' + q.ammo + ' left');
        if (q.ammo <= 0) { removeCard(q); r.extra.push('that was the last one'); }
      }
    }
    if (o.thrown) {
      o.card.thrown = 1;
      r.extra.push('The ' + o.card.key.toLowerCase() + ' leaves your hand: Recover it before you can throw or attack with it again.');
    }
    if (o.kind === 'cast') {
      if (r.doom) r.extra.push('Doom: a BACKLASH happens (Ref rolls d100 + rank).');
      else if (r.baseTier === 1) {
        // The chaos roll is for a final tier 1 result, so wait if an expertise could still improve it.
        if (expOptions(r).length) r.chaosPending = true; else chaosRoll(r);
      }
      if (o.card) {
        if (r.crit) r.extra.push('Crit: no usage die roll for the book.');
        else r.extra.push(rollUD(o.card, 'after casting'));
      }
    }
    if (o.kind === 'miasma') r.miasmaPending = true;
    void p;
  }
  function isAttack(o) { return o.kind === 'attack' || (o.kind === 'cast' && !!o.dmg); }
  function chaosRoll(r) {
    var ch = d(6);
    r.chaosPending = false; r.chaosDone = true; // the tier 1 result is final now
    var t = 'Chaos roll d6 = ' + ch + (ch === 1 ? ': BACKLASH (Ref rolls d100 + rank) instead of the effect.' : ': no backlash.');
    r.extra.push(t);
    return t;
  }
  // Expertises that could improve this roll. A doom is tier 1 regardless of expertises.
  function expOptions(r) {
    if (r.doom || r.exp || r.chaosDone || r.tier >= 3) return [];
    return expList().filter(function (e) {
      if (e.spent >= e.total || e.group !== r.opts.group) return false;
      if (r.opts.kind === 'attack') return e.name === r.opts.wtype;
      if (r.opts.kind === 'cast') return !r.opts.wtype || e.name === r.opts.wtype;
      return true;
    });
  }
  // Parry X: a wielded weapon whose parry AD is down to 0 takes a -1 damage penalty.
  function parryBroken(c) { return !!c && /Parry \d+/.test(item(c.key).txt) && C.adMax(c) > 0 && C.adNow(c) === 0; }
  function isLightWeapon(c) { return item(c.key).cat === 'weapon' && /\bLight\b/.test(item(c.key).txt); }
  // Light: a melee hit while wielding two light weapons adds the unused weapon's tier 2 damage (without A/S).
  // An empty hand counts as a light weapon that makes unarmed strikes (tier 2 = 1).
  function lightBonus(o) {
    if (o.kind !== 'attack' || !o.melee) return null;
    // A hand whose weapon was thrown is empty until the weapon is recovered.
    var h = C.occupancy().hand.map(function (id) { var c = id !== null ? C.cardById(id) : null; return c && c.thrown ? null : id; });
    var a = o.card || null, other;
    if (a) {
      if (!isLightWeapon(a) || C.spanOf(a, 'hand') > 1) return null;
      other = a.idx === 0 ? 1 : 0;
    } else {
      if (h[0] !== null && h[1] !== null) return null; // no free hand to strike with
      other = h[0] === null ? 1 : 0;
    }
    if (h[other] === null) return { dmg: 1, from: 'empty hand' };
    var oc = C.cardById(h[other]);
    if (!oc || oc === a || !isLightWeapon(oc)) return null;
    var m = /12-16: (\d+)/.exec(item(oc.key).txt);
    return m ? { dmg: +m[1], from: oc.key.toLowerCase() } : null;
  }
  // The weapon's own damage at a tier (characteristic included), used for hits on allies too.
  function tierDamage(o, tier) {
    return (tier === 3 ? o.dmg.t3 : o.dmg.t2) + o.charVal - (parryBroken(o.card) ? 1 : 0);
  }
  function damageText(r) {
    var o = r.opts;
    if (!o.dmg) return '';
    if (r.tier === 1) return 'Miss.' + (o.melee ? ' The target can counter.' : '');
    var n = tierDamage(o, r.tier), parts = [];
    if (parryBroken(o.card)) parts.push('-1: parry AD is 0');
    var bless = P().conds.Blessed ? o.charVal : 0;
    if (bless) { n += bless; parts.push(signed(bless) + ' blessed'); }
    var lb = lightBonus(o);
    if (lb) { n += lb.dmg; parts.push('+' + lb.dmg + ' light (' + lb.from + ')'); }
    if (r.crit && o.dmg.brutal) { n *= 2; parts.push('brutal crit: doubled'); }
    return Math.max(0, n) + ' damage' + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '.';
  }
  function describe(r) {
    var s = r.label + ': ' + r.dice.join('+') + (r.mod ? ' ' + signed(r.mod) : '') + ' = ' + r.total + ' -> tier ' + r.tier;
    if (r.crit) s += ' (CRIT)'; if (r.doom) s += ' (DOOM)';
    if (r.exp) s += ', improved with ' + r.exp;
    var dm = damageText(r); if (dm) s += '. ' + dm;
    if (r.extra.length) s += ' ' + r.extra.join(' ');
    return s;
  }
  function plainRoll(label, n, sides, note) {
    var r = []; for (var i = 0; i < n; i++) r.push(d(sides));
    var tot = r.reduce(function (a, b) { return a + b; }, 0);
    last = { plain: true, label: label, dice: r, total: tot, note: note ? note(tot) : '' };
    commit(label + ': ' + r.join(' + ') + (n > 1 ? ' = ' + tot : '') + (last.note ? ' (' + last.note + ')' : '') + '.');
  }

  // Parse attacks from wielded weapons and attack spellbooks.
  // thrown: a Melee X/Ranged Y weapon used as a ranged attack (decided before the roll).
  function weaponAttack(c, thrown) {
    var it = item(c.key), ch = C.characteristics().values;
    var m = /Attack 2d10 \+ (A or S|A|S)\. 12-16: (\d+)[^;]*; 17\+: (\d+)/.exec(it.txt);
    if (!m) return null;
    var range = /^Melee \d+\/Ranged (\d+)/.exec(it.txt);
    if (thrown && !range) return null;
    var melee = /^Melee/.test(it.txt) && !thrown;
    var cn = m[1] === 'A' ? 'Agility' : m[1] === 'S' ? 'Strength' : (ch.Agility >= ch.Strength ? 'Agility' : 'Strength');
    var pen = parryBroken(c) ? 1 : 0;
    return { label: (thrown ? 'Throw ' : 'Attack with ') + c.key, charName: cn, charVal: ch[cn], kind: 'attack', group: 'Weapon', wtype: it.wt,
      melee: melee, ranged: !melee, thrown: !!thrown, dmg: { t2: +m[2], t3: +m[3], brutal: /Brutal/.test(it.txt) }, ammo: AMMO[c.key] || null, card: c,
      summary: (thrown ? 'Ranged ' + range[1] + '. ' : '') + 'Attack 2d10 + ' + CROWS.CHAR_ABBR[cn] + ' (' + signed(ch[cn]) + '). 12-16: ' + (+m[2] + ch[cn] - pen) + ' dam; 17+: ' + (+m[3] + ch[cn] - pen) + ' dam' +
        (/Brutal/.test(it.txt) ? ' (brutal)' : '') + (pen ? ' (-1: parry AD is 0)' : '') };
  }
  function unarmedAttack() {
    var ch = C.characteristics().values, cn = ch.Agility >= ch.Strength ? 'Agility' : 'Strength';
    return { label: 'Unarmed strike', charName: cn, charVal: ch[cn], kind: 'attack', group: 'Weapon', wtype: 'Unarmed', melee: true,
      dmg: { t2: 1, t3: 2, brutal: false }, summary: '2d10 + ' + CROWS.CHAR_ABBR[cn] + ' (' + signed(ch[cn]) + '). 12-16: ' + (1 + ch[cn]) + ' dam; 17+: ' + (2 + ch[cn]) + ' dam' };
  }
  function castOpts(c) {
    var it = item(c.key), ch = C.characteristics().values;
    var disc = (/R\d (\w+)/.exec(it.txt) || [])[1] || null;
    var m = /12-16: (\d+)\s*\+\s*M[^;]*; 17\+: (\d+)\s*\+\s*M/.exec(it.txt);
    return { label: 'Cast ' + c.key.replace(/ Book$/, ''), charName: 'Mind', charVal: ch.Mind, kind: 'cast', group: 'Spellcasting', wtype: disc,
      melee: /Melee \d/.test(it.txt), ranged: /Ranged \d/.test(it.txt),
      dmg: it.atk && m ? { t2: +m[1], t3: +m[2], brutal: false } : null, card: c, summary: it.txt };
  }

  // ------------------------------------------------------------------ rest, dungeon turn, XP
  /* The end of dungeon turn n, as the Ref Screen's "End DT" sends it (refChange endDT); players can't end one here. */
  function endDT(n) {
    var p = P(), msgs = [], ended = endDTConditions();
    p.dt = n;
    if (ended) msgs.push(ended);
    inHands().forEach(function (c) { var u = udInfo(c.key); if (u && u.dt && udNow(c) > 0) msgs.push(rollUD(c, 'end of DT')); });
    var over = overloadedSlots();
    if (over.length) {
      var w = d(6), placed = addWounds(w, 'w');
      msgs.push('Two magic items in one slot (' + over.join(', ') + '): chaos deals 1d6 = ' + w + ' wound' + (w === 1 ? '' : 's') + (placed < w ? ' (' + placed + ' fit)' : '') + '.');
      if (C.woundCount() >= 10) msgs.push('All 10 backpack slots are wounded: your crow is dead.');
    }
    return 'End of dungeon turn ' + n + '. ' + (msgs.join(' ') || 'Nothing in hand burns down.');
  }
  /* Blessed, vulnerable, and weakened end (the end of a DT, or halfway through a rest). */
  function endDTConditions() {
    var p = P(), ended = DT_CONDITIONS.filter(function (k) { return p.conds[k]; });
    ended.forEach(function (k) { delete p.conds[k]; });
    return ended.length ? ended.join(', ') + ' ended.' : '';
  }
  // Rules: more than one magic item equipped in the same slot -> can't rest; 1d6 wounds at the end of each DT.
  function overloadedSlots() { var m = P().magicMulti || {}; return MAGIC_SLOTS.filter(function (k) { return m[k]; }); }
  function caretakerBonus() { return (S().prosperity || 0) >= 6 ? 3 : 2; }
  function surgicalKit() { return carried().filter(function (c) { return c.key === 'Surgical Kit' && udNow(c) > 0; })[0] || null; }
  function foodCards() { return carried().filter(function (c) { return c.key === 'Ration' || c.key === 'Hearty Ration'; }); }
  function rest() {
    var s = S(), p = P(), msgs = [];
    var over = overloadedSlots();
    if (over.length) { C.toast('You can\'t rest with two magic items in one slot (' + over.join(', ') + ').'); return; }
    var food = ui.ration === 'none' ? null : foodCards().filter(function (c) { return c.key === (ui.ration || 'Ration'); })[0] || foodCards()[0] || null;
    if (!food) {
      var sw = addWounds(1, 's');
      commit('Rested without eating: no rest benefits' + (sw ? ' and 1 starvation wound' : '') + '.');
      return;
    }
    var hearty = food.key === 'Hearty Ration';
    useOne(food);
    msgs.push('Ate a ' + food.key.toLowerCase() + '.');
    var starve = Object.keys(p.wounds).filter(function (i) { return p.wounds[i] === 's'; });
    starve.forEach(function (i) { delete p.wounds[i]; });
    if (starve.length) msgs.push('Starvation wounds gone (' + starve.length + ').');
    setStamina(C.staminaMax());
    msgs.push('Stamina full.');
    var heal = 1 + (hearty ? 1 : 0) + (ui.tended ? 1 : 0) + (ui.tended && ui.tendedKit ? 1 : 0) + (ui.caretaker ? caretakerBonus() : 0);
    var h = healWounds(heal);
    if (h) msgs.push('Healed ' + h + ' wound' + (h === 1 ? '' : 's') + '.');
    var uses = C.expertiseUses();
    p.temp = {};
    if (p.miasma) {
      Object.keys(p.spent).forEach(function (k) { p.spent[k] = Math.min(p.spent[k], uses[k] || 0); if (!p.spent[k]) delete p.spent[k]; });
      msgs.push('In the Miasma: expertise uses are NOT restored. Make your Miasma RR.');
    } else {
      p.spent = {};
      msgs.push('Expertise uses restored.');
      if (p.cruelty) { p.cruelty = 0; msgs.push('Rested free of the Miasma: all cruelty lost.'); }
    }
    s.inv.forEach(function (c) { var u = udInfo(c.key); if (u && u.rest && udNow(c) < u.max) { c.ud = u.max; msgs.push(c.key + ' recharged.'); } });
    CONDITIONS.forEach(function (k) { if (k !== 'Grabbed') delete p.conds[k]; });
    if (ui.activity === 'repair') {
      var rc = C.cardById(+ui.repair);
      if (rc) { rc.dmg = 0; msgs.push('Repaired ' + rc.key + ' to full AD.'); }
    } else if (ui.activity === 'study' && ui.study) {
      p.temp[ui.study] = 1; msgs.push('Studied a lore book: +1 use of ' + ui.study + ' until the next rest.');
    } else if (ui.activity === 'Tend Wounds') {
      var kit = ui.useKit ? surgicalKit() : null;
      if (kit) msgs.push('Tended an ally\'s wounds with a surgical kit: they lose 3 wounds instead of 1. ' + rollUD(kit, 'Tend Wounds'));
      else msgs.push('Tended an ally\'s wounds: they lose 2 wounds instead of 1.');
    } else if (ui.activity) msgs.push('Rest activity: ' + ui.activity + '.');
    // pets eat animal feed
    s.pets.forEach(function (pet, i) {
      var need = PET_FEED[pet] || 1, feed = findCarried('Animal Feed'), have = carried().filter(function (c) { return c.key === 'Animal Feed'; }).reduce(function (t, c) { return t + c.qty; }, 0);
      if (have >= need) {
        for (var k = 0; k < need; k++) { feed = findCarried('Animal Feed'); useOne(feed); }
        delete p.petStam[i]; msgs.push('Your ' + pet.toLowerCase() + ' ate and rested.');
      } else msgs.push('Your ' + pet.toLowerCase() + ' had no animal feed (no rest benefit).');
    });
    if (p.pendingXP) msgs.push(applyXP());
    ui.activity = ''; ui.tended = false; ui.tendedKit = false; ui.useKit = false; ui.caretaker = false;
    commit('Rested. ' + msgs.join(' '));
  }
  function applyXP() {
    var s = S(), p = P(), before = C.esBonusCount(s.txp), cb = C.charBonusCount(s.txp), gained = p.pendingXP;
    s.txp = Math.min(999999, s.txp + gained); p.pendingXP = 0;
    var msg = 'Gained ' + fmt(gained) + ' XP (TXP ' + fmt(s.txp) + ').';
    var nb = C.esBonusCount(s.txp) - before, nc = C.charBonusCount(s.txp) - cb;
    if (nb) msg += ' New Expertise & Stamina bonus' + (nb > 1 ? 'es' : '') + ' (' + nb + '): choose in Build > Advancement.';
    if (nc) msg += ' New characteristic bonus' + (nc > 1 ? 'es' : '') + ' (' + nc + ').';
    return msg;
  }
  function nextAt(txp) {
    var es = null, ch = null;
    CROWS.ES_ADV.forEach(function (r) { if (es === null && r[0] > txp) es = r[0]; });
    if (es === null) es = 30000 * (Math.floor(txp / 30000) + 1);
    CROWS.CHAR_ADV.forEach(function (t) { if (ch === null && t > txp) ch = t; });
    if (ch === null) ch = 30000 * (Math.floor(txp / 30000) + 1);
    return { es: es, ch: ch };
  }

  // ------------------------------------------------------------------ rendering
  function btn(text, onclick, cls, extra) {
    var a = { type: 'button', class: 'btn btn-small' + (cls ? ' ' + cls : ''), text: text, onclick: onclick };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return el('button', a);
  }
  function num(val, oninput, attrs) {
    var a = { type: 'number', value: val, oninput: function () { oninput(this.value); } };
    if (attrs) Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
    return el('input', a);
  }
  function card(id, title, kids) {
    var box = $(id); box.innerHTML = '';
    box.appendChild(el('h2', { text: title }));
    kids.forEach(function (k) { if (k) box.appendChild(k); });
  }

  function renderVitals() {
    var p = P(), m = C.staminaMax(), cur = C.curStamina(), sp = speed(), w = C.woundCount();
    var stam = el('div', { class: 'vital big' }, [
      el('div', { class: 'lbl', text: 'Stamina' }),
      el('div', { class: 'val' }, [el('b', { text: String(cur) }), el('span', { text: ' / ' + m })]),
      el('div', { class: 'meter' }, [el('span', { style: 'width:' + (m ? Math.round(cur / m * 100) : 0) + '%' })]),
      el('div', { class: 'pm-row' }, [
        btn('−5', function () { setStamina(cur - 5); commit(); }), btn('−1', function () { setStamina(cur - 1); commit(); }),
        btn('+1', function () { setStamina(cur + 1); commit(); }), btn('+5', function () { setStamina(cur + 5); commit(); }),
        btn('Full', function () { setStamina(m); commit(); }, 'btn-ghost')])
    ]);
    var adBox = el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Armor Defense' })]);
    var abs = absorbers();
    if (!abs.length) adBox.appendChild(el('div', { class: 'fine', text: 'No armor worn, shield, or parry weapon wielded.' }));
    abs.forEach(function (c) {
      var mx = C.adMax(c), now = C.adNow(c);
      adBox.appendChild(el('div', { class: 'ad-row' }, [
        el('span', { class: 'ad-name', text: c.key + (item(c.key).cat === 'weapon' ? ' (parry)' : '') }),
        el('b', { text: now + '/' + mx }),
        btn('−', function () { c.dmg = Math.min(mx, (c.dmg || 0) + 1); commit(); }, '', { 'aria-label': 'Lower ' + c.key + ' AD' }),
        btn('+', function () { c.dmg = Math.max(0, (c.dmg || 0) - 1); commit(); }, '', { 'aria-label': 'Raise ' + c.key + ' AD' })
      ]));
    });
    var small = el('div', { class: 'vital-grid' }, [
      el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Speed' }), el('div', { class: 'val' }, [el('b', { text: String(sp.v) })]), sp.note ? el('div', { class: 'fine', text: sp.note }) : null]),
      el('div', { class: 'vital' + (w >= 7 ? ' danger' : '') }, [el('div', { class: 'lbl', text: 'Wounds' }), el('div', { class: 'val' }, [el('b', { text: String(w) }), el('span', { text: ' / 10' })])]),
      el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Cruelty' }), el('div', { class: 'val' }, [el('b', { text: String(p.cruelty) })]),
        el('div', { class: 'pm-row' }, [btn('−', function () { p.cruelty = Math.max(0, p.cruelty - 1); commit('Cruelty ' + p.cruelty + '.'); }, '', { 'aria-label': 'Lower cruelty' }),
          btn('+', function () { p.cruelty++; commit('Cruelty ' + p.cruelty + '.'); }, '', { 'aria-label': 'Raise cruelty' })])]),
      el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Coins' }), el('div', { class: 'val' }, [el('b', { text: fmt(S().coins) }), el('span', { text: ' gc' })]),
        el('div', { class: 'pm-row' }, [num(ui.coins, function (v) { ui.coins = v; }, { min: 0, placeholder: 'gc', 'aria-label': 'Coins to add or spend', class: 'mini' }),
          btn('+', function () { var n = parseInt(ui.coins, 10) || 0; if (n) { S().coins += n; ui.coins = ''; commit('Gained ' + fmt(n) + ' gc.'); } }, '', { 'aria-label': 'Gain coins' }),
          btn('−', function () { var n = parseInt(ui.coins, 10) || 0; if (n) { S().coins = Math.max(0, S().coins - n); ui.coins = ''; commit('Spent ' + fmt(n) + ' gc.'); } }, '', { 'aria-label': 'Spend coins' })])])
    ]);
    var conds = el('div', { class: 'conds' }, CONDITIONS.map(function (k) {
      return el('button', { type: 'button', class: 'cond' + (p.conds[k] ? ' on' : ''), 'aria-pressed': String(!!p.conds[k]), text: k,
        title: k + ': ' + CONDITION_RULES[k] + (p.conds[k] ? ' (Click to remove.)' : ' (Click to apply.)'), onclick: function () {
        if (p.conds[k]) delete p.conds[k]; else p.conds[k] = true;
        commit((p.conds[k] ? 'Now ' : 'No longer ') + k.toLowerCase() + '.');
      } });
    }));
    var firstSel = el('select', { 'aria-label': 'Damage hits first', onchange: function () { ui.first = this.value; } },
      abs.filter(function (c) { return C.adNow(c) > 0; }).map(function (c) { return el('option', { value: String(c.id), text: c.key + ' first' }); }));
    if (!firstSel.options.length) firstSel = null;
    else { if (ui.first) firstSel.value = ui.first; if (firstSel.selectedIndex < 0 || !ui.first) { firstSel.selectedIndex = 0; ui.first = firstSel.value; } }   // that item may be gone (or reloaded)
    var dmgRow = el('div', { class: 'row wrap dmg-row' }, [
      el('label', { class: 'field' }, ['Damage', num(ui.dmg, function (v) { ui.dmg = v; }, { min: 0, class: 'mini', onkeydown: function (e) { if (e.key === 'Enter') takeDamage(); } })]),
      el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: ui.pierce, onchange: function () { ui.pierce = this.checked; } }), ' Piercing']),
      firstSel, btn('Take damage', takeDamage, 'btn-primary'),
      el('span', { class: 'spacer' }),
      el('label', { class: 'field' }, ['Heal', num(ui.heal, function (v) { ui.heal = v; }, { min: 0, class: 'mini' })]),
      btn('Regain Stamina', function () { var n = parseInt(ui.heal, 10) || 0; if (n) { setStamina(C.curStamina() + n); ui.heal = ''; commit('Regained ' + n + ' Stamina.'); } })
    ]);
    // backpack wound grid
    var occ = C.occupancy(), grid = el('div', { class: 'wound-grid' });
    for (var i = 0; i < 10; i++) (function (i) {
      var cid = occ.pack[i], c = cid !== null ? C.cardById(cid) : null, wk = p.wounds[i];
      grid.appendChild(el('button', { type: 'button', class: 'wslot' + (wk ? ' hurt' : '') + (wk === 's' ? ' starve' : ''), 'aria-pressed': String(!!wk),
        title: wk ? 'Click to heal this wound' : 'Click to mark a wound here',
        onclick: function () { if (p.wounds[i]) delete p.wounds[i]; else p.wounds[i] = 'w'; commit((p.wounds[i] ? 'Wound marked in' : 'Wound healed in') + ' backpack slot ' + (i + 1) + '.'); } },
        [el('span', { class: 'n', text: String(i + 1) }), el('span', { class: 'it', text: c ? c.key : 'empty' }), el('span', { class: 'wk', text: wk === 's' ? 'starving' : wk ? 'wound' : '' })]));
    })(i);
    var dead = w >= 10 ? el('div', { class: 'banner bad', text: 'All 10 backpack slots are wounded: your crow is dead. Make a new crow and roll on the Backgrounds table ' +
      (1 + C.esBonusCount(S().txp)) + ' time' + (C.esBonusCount(S().txp) ? 's' : '') + ' (1 + one per Expertise & Stamina bonus), choosing any result.' }) : null;
    card('play-vitals', 'Vitals', [dead, el('div', { class: 'vital-top' }, [stam, adBox]), small,
      el('div', { class: 'cond-head' }, [el('h3', { text: 'Conditions' }),
        el('button', { type: 'button', class: 'info-toggle', 'aria-expanded': String(ui.condInfo), 'aria-controls': 'cond-info',
          text: ui.condInfo ? '\u24d8 Hide rules' : '\u24d8 What they do', onclick: function () { ui.condInfo = !ui.condInfo; C.render(); } })]),
      conds, condInfo(), el('h3', { text: 'Damage & healing' }), dmgRow,
      el('h3', {}, ['Backpack wounds ', el('small', { text: '(each wound fills a slot; -1 speed per slot with both a wound and an item. Click to mark or heal.)' })]), grid]);
  }

  // Tap-friendly alternative to the condition tooltips (hover tooltips don't show on touch screens).
  function condInfo() {
    if (!ui.condInfo) return null;
    var p = P();
    return el('dl', { class: 'cond-info', id: 'cond-info' }, [].concat.apply([], CONDITIONS.map(function (k) {
      return [el('dt', { class: p.conds[k] ? 'on' : null }, [k, p.conds[k] ? el('small', { text: ' (active)' }) : null]), el('dd', { text: CONDITION_RULES[k] })];
    })));
  }

  function renderTime() {
    var p = P(), s = S();
    var foods = foodCards(), rationSel = el('select', { onchange: function () { ui.ration = this.value; } });
    var kinds = []; foods.forEach(function (c) { if (kinds.indexOf(c.key) < 0) kinds.push(c.key); });
    kinds.forEach(function (k) {
      var n = foods.filter(function (c) { return c.key === k; }).reduce(function (t, c) { return t + c.qty; }, 0);
      rationSel.appendChild(el('option', { value: k, text: 'Eat a ' + k.toLowerCase() + ' (' + n + ' carried)' }));
    });
    rationSel.appendChild(el('option', { value: 'none', text: kinds.length ? "Don't eat (no rest benefits)" : 'No rations! (no rest benefits, starvation wound)' }));
    rationSel.value = kinds.indexOf(ui.ration) >= 0 || ui.ration === 'none' ? ui.ration : (kinds[0] || 'none');
    ui.ration = rationSel.value;
    var act = el('select', { onchange: function () { ui.activity = this.value; C.render(); } }, [
      el('option', { value: '', text: 'No rest activity / not tracked' }),
      el('option', { value: 'repair', text: 'Repair Armor' }),
      el('option', { value: 'study', text: 'Study a lore book' }),
      el('option', { value: 'Craft Equipment', text: 'Craft Equipment' }), el('option', { value: 'Harvest', text: 'Harvest' }),
      el('option', { value: 'Identify Item', text: 'Identify Item' }), el('option', { value: 'Prepare for Task', text: 'Prepare for Task (+2 until next rest)' }),
      el('option', { value: 'Seclude Camp', text: 'Seclude Camp' }), el('option', { value: 'Tend Wounds', text: 'Tend Wounds (on another)' })
    ]);
    act.value = ui.activity;
    var sub = null;
    if (ui.activity === 'repair') {
      var rep = s.inv.filter(function (c) { return C.adMax(c) > 0 && c.dmg; });
      sub = rep.length ? el('select', { onchange: function () { ui.repair = this.value; } }, rep.map(function (c) { return el('option', { value: String(c.id), text: c.key + ' (' + C.adNow(c) + '/' + C.adMax(c) + ')' }); })) :
        el('span', { class: 'fine', text: 'Nothing is damaged.' });
      if (rep.length) { if (!rep.some(function (c) { return String(c.id) === ui.repair; })) ui.repair = String(rep[0].id); sub.value = ui.repair; }
    } else if (ui.activity === 'study') {
      var books = carried().filter(function (c) { return /^Lore Book/.test(c.key); });
      var opts = [];
      books.forEach(function (c) { var m = /\((.+)\)/.exec(c.key); (m ? [m[1]] : LORE).forEach(function (x) { if (opts.indexOf(x) < 0) opts.push(x); }); });
      sub = opts.length ? el('select', { onchange: function () { ui.study = this.value; } }, opts.map(function (x) { return el('option', { value: x, text: x }); })) :
        el('span', { class: 'fine', text: 'You carry no lore book.' });
      if (opts.length) { if (opts.indexOf(ui.study) < 0) ui.study = opts[0]; sub.value = ui.study; } else ui.study = '';
    } else if (ui.activity === 'Tend Wounds') {
      var kit = surgicalKit();
      sub = kit ? el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: ui.useKit, onchange: function () { ui.useKit = this.checked; } }), ' Use my surgical kit (they lose 1 more wound; rolls its usage die)']) :
        el('span', { class: 'fine', text: 'Pick someone with 2+ wounds (not you): they lose 2 wounds instead of 1.' });
      if (!kit) ui.useKit = false;
    }
    var over = overloadedSlots();
    var restBox = el('div', { class: 'rest-box' }, [
      el('div', { class: 'row wrap' }, [
        el('label', { class: 'field' }, ['Food', rationSel]),
        el('label', { class: 'field' }, ['Rest activity', act]), sub
      ]),
      el('div', { class: 'row wrap checks' }, [
        el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: p.miasma, onchange: function () { p.miasma = this.checked; commit(); } }), ' Resting in the Miasma']),
        el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: ui.tended, onchange: function () { ui.tended = this.checked; if (!this.checked) ui.tendedKit = false; C.render(); } }), ' Someone used Tend Wounds on me (+1 wound healed)']),
        ui.tended ? el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: ui.tendedKit, onchange: function () { ui.tendedKit = this.checked; } }), ' ...with a surgical kit (+1 more)']) : null,
        s.connBenefit === 'Caretaker' ? el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: ui.caretaker, onchange: function () { ui.caretaker = this.checked; } }),
          ' Resting at my Caretaker connection\'s home (+' + caretakerBonus() + ' wounds: 2, or 3 at Prosperity 6+; your village is at ' + (s.prosperity || 0) + ')']) : null
      ]),
      over.length ? el('div', { class: 'banner bad', text: 'You can\'t rest: two magic items are equipped in one slot (' + over.join(', ') + '). Unequip one under Magic item slots.' }) : null,
      el('p', { class: 'fine', text: '6 uninterrupted hours (4 asleep), eat 1 ration: regain all Stamina, heal 1 wound, regain expertise uses (not in the Miasma), recharge spellbooks and other rest usage dice' +
        (p.pendingXP ? ', and gain your ' + fmt(p.pendingXP) + ' pending XP' : '') + '.' }),
      btn('Rest', rest, 'btn-primary', { disabled: over.length ? true : null })
    ]);
    card('play-time', 'Dungeon turns & rest', [
      el('div', { class: 'row wrap dt-row' }, [
        el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Dungeon turn' }), el('div', { class: 'val' }, [el('b', { text: String(p.dt + 1) })])]),
        el('p', { class: 'fine grow', text: 'The Ref ends each DT from the Ref Screen. Ending a DT rolls the usage dice of lights in your hands, ends blessed, vulnerable, and weakened, and deals 1d6 wounds if two magic items share a slot. 30 real minutes each; greed bonus +30/20/10% in DT 1/2/3.' })
      ]),
      el('h3', { text: 'Rest' }), restBox
    ]);
  }

  function renderExp() {
    var list = expList(), p = P();
    var grid = el('div', { class: 'play-exp' });
    if (!list.length) grid.appendChild(el('p', { class: 'fine', text: 'No expertise uses.' }));
    list.forEach(function (e) {
      var pips = el('span', { class: 'pips' });
      for (var i = 0; i < e.total; i++) (function (i) {
        var used = i < e.spent;
        pips.appendChild(el('button', { type: 'button', class: 'upip' + (used ? ' used' : ''), 'aria-label': (used ? 'Restore' : 'Spend') + ' a use of ' + e.name,
          title: used ? 'Spent (click to restore)' : 'Available (click to spend)',
          onclick: function () {
            if (used) { p.spent[e.name] = e.spent - 1; if (!p.spent[e.name]) delete p.spent[e.name]; commit('Restored a use of ' + e.name + '.'); }
            else { spendExp(e.name); commit('Spent a use of ' + e.name + '.'); }
          } }));
      })(i);
      grid.appendChild(el('div', { class: 'exp-row has', title: e.desc }, [
        el('span', {}, [el('span', { text: e.name }), p.temp[e.name] ? el('small', { class: 'tag', text: ' +lore book' }) : null, el('small', { class: 'muted', text: ' ' + e.group })]),
        el('span', { class: 'row-r' }, [el('small', { class: 'muted', text: (e.total - e.spent) + '/' + e.total }), pips])
      ]));
    });
    card('play-exp', 'Expertise uses', [el('p', { class: 'hint', text: 'After a roll, spend 1 use of a relevant expertise to improve the result by 1 tier (one per test). The dice roller offers this automatically. ' +
      (p.miasma ? 'You are in the Miasma: resting will not restore uses.' : 'All uses return when you rest outside the Miasma.') }), grid]);
  }

  function renderAttacks() {
    var rows = el('div', { class: 'atk-list' });
    function row(title, sub, action, label, disabled, extra, more) {
      rows.appendChild(el('div', { class: 'atk' }, [
        el('div', { class: 'atk-main' }, [el('b', { text: title }), el('div', { class: 'fine', text: sub }), extra ? el('div', { class: 'fine warnish', text: extra }) : null]),
        el('div', { class: 'atk-btns' }, [btn(label, action, 'btn-primary', { disabled: disabled || null }), more || null])
      ]));
    }
    var hands = inHands();
    hands.forEach(function (c) {
      var it = item(c.key);
      if (it.cat === 'weapon') {
        var a = weaponAttack(c);
        if (!a) return;
        var note = null, dis = !!c.thrown;
        if (c.thrown) note = 'Thrown: recover it first.';
        else if (a.ammo) {
          var q = findCarried(a.ammo);
          note = q ? a.ammo.replace(/ of 20.*/, '') + ': ' + (typeof q.ammo === 'number' ? q.ammo : 20) + ' left' : 'No ' + a.ammo.toLowerCase() + ' carried!';
          dis = !q;
        }
        row(c.key + ' (' + where(c) + ')', a.summary, function () { rollTest(a); }, 'Attack', dis, note);
        var t = weaponAttack(c, true);
        if (t) row('Throw ' + c.key.toLowerCase() + ' (' + where(c) + ')', t.summary, function () { rollTest(t); }, 'Throw', !!c.thrown,
          c.thrown ? 'Thrown: it\'s out of your hand until you recover it.' : null,
          c.thrown ? btn('Recover', function () { delete c.thrown; commit('Recovered the ' + c.key.toLowerCase() + '.'); }, null, { title: 'You pick the weapon back up' }) : null);
      } else if (it.cat === 'spell') {
        var o = castOpts(c), u = udNow(c);
        row(c.key.replace(/ Book$/, '') + ' (' + where(c) + ')', o.summary, function () { rollTest(o); }, 'Cast', u <= 0, u > 0 ? null : 'Usage die spent: recharges on a rest.');
      }
    });
    var ua = unarmedAttack();
    row('Unarmed / improvised', ua.summary, function () { rollTest(ua); }, 'Attack', false, null);
    var stowed = carried().filter(function (c) { return c.area !== 'hand' && (item(c.key).cat === 'spell' || item(c.key).cat === 'weapon'); });
    card('play-attacks', 'Attacks & spells', [
      el('p', { class: 'hint', text: 'Uses the edge/bane and modifier set in the dice panel. Conditions apply automatically (blessed: edge and +damage; weakened: bane; prone: bane on melee). A ranged attack against a creature adjacent to you takes a bane: set it before rolling. Light weapon and parry damage adjustments are included. A thrown weapon is out of your hand (no attacks, parry, or light-weapon bonus) until you recover it.' }),
      rows,
      stowed.length ? el('p', { class: 'fine', text: 'Stowed (draw into a hand to use): ' + stowed.map(function (c) { return c.key + ' (' + where(c) + ')'; }).join(', ') + '. Move items between slots in Build > Equipment.' }) : null
    ]);
  }

  function renderItems() {
    var tbl = el('div', { class: 'item-list' });
    var cards = carried().slice().sort(function (a, b) { var o = { hand: 0, belt: 1, pack: 2 }; return o[a.area] - o[b.area] || a.idx - b.idx; });
    cards.forEach(function (c) {
      var it = item(c.key), u = udInfo(c.key), ctl = [];
      if (u) {
        var n = udNow(c);
        ctl.push(el('span', { class: 'ud', title: item(c.key).txt.split('.')[0], text: 'UD ' + n + '/' + u.max }));
        if (n > 0 && (u.activate || u.dt)) ctl.push(btn('Roll UD', function () { commit(rollUD(c)); }));
        if (u.refuel && n < u.max) {
          var fuel = findCarried(u.fuel || 'Oil Flask');
          ctl.push(btn('Refuel', function () { useOne(fuel); c.ud = u.max; commit('Refuelled ' + c.key + ' with ' + (u.fuel || 'fuel').toLowerCase() + '.'); }, '', { disabled: !fuel || null, title: fuel ? '' : 'No ' + (u.fuel || 'fuel') + ' carried' }));
        }
        if (n < u.max) ctl.push(btn('Reset UD', function () { c.ud = u.max; commit(); }, 'btn-ghost'));
      }
      if (AMMO_CASES[c.key]) {
        var am = typeof c.ammo === 'number' ? c.ammo : 20;
        ctl.push(el('span', { class: 'ud', text: am + ' shots' }));
        ctl.push(btn('−', function () { c.ammo = Math.max(0, am - 1); commit(); }, '', { 'aria-label': 'One fewer' }));
        ctl.push(btn('+', function () { c.ammo = Math.min(20, am + 1); commit(); }, '', { 'aria-label': 'One more' }));
      }
      if (c.key === 'Healing Potion') ctl.push(btn('Drink', function () {
        var m = C.staminaMax(), cur = C.curStamina(), msg;
        if (cur >= m && C.woundCount()) { healWounds(1); msg = 'Drank a healing potion: healed 1 wound.'; }
        else { var r = d(6); setStamina(cur + r); msg = 'Drank a healing potion: rolled ' + r + ', regained ' + (Math.min(m, cur + r) - cur) + ' Stamina.'; }
        useOne(c); commit(msg);
      }));
      else if (it.st > 1 || it.cat === 'consumable' || it.cat === 'food') ctl.push(btn(it.cat === 'consumable' || it.cat === 'food' ? 'Use 1' : '−1', function () { useOne(c); commit('Used 1 ' + c.key + '.'); }));
      if (it.st > 1 && c.qty < it.st && c.area !== 'hand') ctl.push(btn('+1', function () { c.qty++; delete c.ud; commit(); }, 'btn-ghost'));
      tbl.appendChild(el('div', { class: 'item-row cat-' + it.cat }, [
        el('span', { class: 'loc', text: where(c) }),
        el('span', { class: 'nm', title: it.txt }, [el('b', { text: c.key }), c.qty > 1 ? ' ×' + c.qty : '', C.adMax(c) && c.dmg ? el('small', { class: 'muted', text: ' AD ' + C.adNow(c) + '/' + C.adMax(c) }) : null]),
        el('span', { class: 'ctl' }, ctl)
      ]));
    });
    if (!cards.length) tbl.appendChild(el('p', { class: 'fine', text: 'You carry nothing.' }));
    card('play-items', 'Carried items', [el('p', { class: 'hint' }, ['Usage dice: each 1 or 2 rolled removes a die. To add found items or move things between hand, belt, and backpack, use ',
      el('a', { href: '#sec-equipment', text: 'Build > Equipment', onclick: function (e) { e.preventDefault(); gotoBuild('sec-equipment'); } }), '.']), tbl]);
  }
  var AMMO_CASES = { 'Quiver of 20 Arrows': 1, 'Case of 20 Crossbow Bolts': 1 };

  function renderAdvance() {
    var s = S(), p = P(), spent = C.traitXP(), unspent = s.txp - spent, nx = nextAt(s.txp);
    var stats = el('div', { class: 'vital-grid' }, [
      ['Total XP', fmt(s.txp)], ['Unspent XP', fmt(unspent)], ['Pending (after rest)', fmt(p.pendingXP)], ['Max uses/expertise', C.maxUses(s.txp)]
    ].map(function (x) { return el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: x[0] }), el('div', { class: 'val' }, [el('b', { text: String(x[1]) })])]); }));
    var todo = [];
    var pool = C.usePool(), used = C.allocTotal();
    if (pool > used) todo.push('Assign ' + (pool - used) + ' bonus expertise use' + (pool - used === 1 ? '' : 's'));
    if (s.charBonus.some(function (c) { return !c; })) todo.push('Choose a characteristic bonus');
    var banner = todo.length ? el('div', { class: 'banner warn' }, [todo.join('. ') + '. ', el('a', { href: '#sec-advance', text: 'Open Advancement', onclick: function (e) { e.preventDefault(); gotoBuild('sec-advance'); } })]) : null;
    var share = ui.tPlayers > 0 && parseInt(ui.tGc, 10) > 0 ? Math.floor(parseInt(ui.tGc, 10) / ui.tPlayers) : 0;
    var shareEl = el('span', { class: 'fine', id: 'play-share', text: share ? '= ' + fmt(share) + ' XP each' : '' });
    function updShare() { var sh = ui.tPlayers > 0 && parseInt(ui.tGc, 10) > 0 ? Math.floor(parseInt(ui.tGc, 10) / ui.tPlayers) : 0; shareEl.textContent = sh ? '= ' + fmt(sh) + ' XP each' : ''; }
    var form = el('div', { class: 'row wrap' }, [
      el('label', { class: 'field grow' }, ['Treasure recovered', el('input', { type: 'text', value: ui.tDesc, maxlength: 80, placeholder: 'e.g. silver chalice', oninput: function () { ui.tDesc = this.value; } })]),
      el('label', { class: 'field' }, ['Value (gc)', num(ui.tGc, function (v) { ui.tGc = v; updShare(); }, { min: 0, class: 'mini' })]),
      el('label', { class: 'field' }, ['Players', num(ui.tPlayers, function (v) { ui.tPlayers = Math.max(1, parseInt(v, 10) || 1); updShare(); }, { min: 1, max: 12, class: 'mini' })]),
      shareEl,
      btn('Add XP', function () {
        var gc = parseInt(ui.tGc, 10) || 0, n = Math.max(1, ui.tPlayers | 0), xp = Math.floor(gc / n);
        if (!xp) { C.toast('Enter the treasure value.'); return; }
        p.pendingXP += xp;
        p.xpLog.unshift({ t: Date.now(), desc: ui.tDesc || 'Treasure', gc: gc, n: n, xp: xp });
        if (p.xpLog.length > 100) p.xpLog.length = 100;
        var d0 = ui.tDesc || 'treasure'; ui.tDesc = ''; ui.tGc = '';
        commit('Recovered ' + d0 + ' worth ' + fmt(gc) + ' gc: ' + fmt(xp) + ' XP each (applies after the next rest).');
      }, 'btn-primary')
    ]);
    var other = el('div', { class: 'row wrap' }, [
      el('label', { class: 'field' }, ['Other XP (Ref award or correction)', num(ui.xpAmt, function (v) { ui.xpAmt = v; }, { class: 'mini' })]),
      btn('Add to pending', function () {
        var n = parseInt(ui.xpAmt, 10) || 0; if (!n) return;
        p.pendingXP = Math.max(0, p.pendingXP + n); p.xpLog.unshift({ t: Date.now(), desc: 'Adjustment', gc: 0, n: 1, xp: n }); ui.xpAmt = '';
        commit((n > 0 ? 'Added ' : 'Removed ') + fmt(Math.abs(n)) + ' pending XP.');
      }),
      btn('Apply pending XP now', function () { if (p.pendingXP) commit(applyXP()); }, 'btn-ghost', { disabled: !p.pendingXP || null, title: 'Normally XP applies after a rest' })
    ]);
    var hist = el('div', { class: 'xp-hist' }, p.xpLog.slice(0, 8).map(function (x) {
      return el('div', {}, [el('span', { class: 'muted', text: new Date(x.t).toLocaleDateString() + ' ' }), x.desc + (x.gc ? ' (' + fmt(x.gc) + ' gc / ' + x.n + ')' : '') + ': ', el('b', { text: signed(x.xp) + ' XP' })]);
    }));
    card('play-advance', 'Experience & advancement', [
      el('p', { class: 'hint', text: 'Recovered treasure (not bought, crafted, taken from innocents, or an ally\'s) gives XP = its gc value / number of players. XP and TXP bonuses apply only after a rest.' }),
      stats, banner,
      el('p', { class: 'fine' }, ['Next Expertise & Stamina bonus at ' + fmt(nx.es) + ' TXP; next characteristic bonus at ' + fmt(nx.ch) + ' TXP. ',
        el('a', { href: '#sec-traits', text: 'Buy traits', onclick: function (e) { e.preventDefault(); gotoBuild('tree-browser'); } }), ' with unspent XP.']),
      form, other, p.xpLog.length ? el('h3', { text: 'Recent XP' }) : null, hist
    ]);
  }

  function renderGear() {
    var s = S(), p = P();
    var magicItems = carried().filter(function (c) { return item(c.key).cat === 'magic' || c.key === 'Holy Symbol'; }).map(function (c) { return c.key; });
    var dl = el('datalist', { id: 'play-magic-list' }, magicItems.map(function (k) { return el('option', { value: k }); }));
    if (!p.magicMulti) p.magicMulti = {};
    var slots = el('div', { class: 'magic-grid' }, MAGIC_SLOTS.map(function (k) {
      return el('div', { class: 'field' }, [el('label', { for: 'magic-' + k, text: k }), el('input', { type: 'text', id: 'magic-' + k, list: 'play-magic-list', maxlength: 80, value: p.magic[k] || '', oninput: function () {
        if (this.value) p.magic[k] = this.value; else delete p.magic[k]; C.save();
      }, onchange: function () { C.render(); } }),
      el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: !!p.magicMulti[k], onchange: function () {
        if (this.checked) p.magicMulti[k] = true; else delete p.magicMulti[k];
        commit(this.checked ? 'Two magic items now share the ' + k.toLowerCase() + ' slot: no resting, 1d6 wounds at the end of each DT.' : 'Only one magic item in the ' + k.toLowerCase() + ' slot now.');
      } }), ' 2+ items here'])]);
    }));
    var over = overloadedSlots();
    var pets = s.pets.map(function (pet, i) {
      var m = /Stamina (\d+)/.exec(CROWS.PETS[pet] || ''), mx = m ? +m[1] : 0, cur = typeof p.petStam[i] === 'number' ? p.petStam[i] : mx;
      function set(v) { v = Math.max(0, Math.min(mx, v)); if (v >= mx) delete p.petStam[i]; else p.petStam[i] = v; commit(); }
      return el('div', { class: 'pet' }, [el('div', { class: 'row wrap' }, [el('b', { text: pet }), el('span', { text: 'Stamina ' + cur + ' / ' + mx }),
        btn('−1', function () { set(cur - 1); }), btn('+1', function () { set(cur + 1); }), btn('Full', function () { set(mx); }, 'btn-ghost')]),
        el('div', { class: 'fine', text: CROWS.PETS[pet] || '' })]);
    });
    card('play-gear', 'Magic item slots & pets', [
      el('p', { class: 'hint', text: 'Wearing two magic items in one slot: you can\'t rest and take 1d6 wounds at the end of each dungeon turn. Tick "2+ items here" and the app applies both.' }),
      over.length ? el('div', { class: 'banner bad', text: 'Overloaded slot: ' + over.join(', ') + '. You can\'t rest; each DT ends with 1d6 wounds.' }) : null,
      dl, slots,
      pets.length ? el('h3', { text: 'Pets' }) : null
    ].concat(pets).concat([pets.length ? el('p', { class: 'fine', text: 'Command: maneuver. Complex or dangerous: 2d10 + M (1 refuses; 2 obeys, then weakened; 3 obeys). Pets eat animal feed when you rest.' }) : null]));
  }

  function renderLog() {
    var p = P();
    var list = el('ol', { class: 'play-log' }, p.log.slice(0, 60).map(function (x) {
      var t = new Date(x.t);
      return el('li', {}, [el('span', { class: 'muted', text: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' }), x.m]);
    }));
    card('play-log', 'Session log', [
      p.log.length ? list : el('p', { class: 'fine', text: 'Rolls, damage, rests, and XP appear here.' }),
      p.log.length ? btn('Clear log', function () { if (confirm('Clear the session log?')) { p.log = []; commit(); } }, 'btn-ghost') : null
    ]);
  }

  function renderRoller() {
    var box = $('play-side'); box.innerHTML = '';
    var p = P(), ch = C.characteristics().values;
    box.appendChild(el('h3', { text: 'Dice' }));
    var eb = el('div', { class: 'seg', role: 'group', 'aria-label': 'Edges and banes' }, [[-2, 'Dbl bane'], [-1, 'Bane'], [0, 'None'], [1, 'Edge'], [2, 'Dbl edge']].map(function (x) {
      return el('button', { type: 'button', class: ui.eb === x[0] ? 'on' : '', 'aria-pressed': String(ui.eb === x[0]), text: x[1], onclick: function () { ui.eb = x[0]; renderRoller(); } });
    }));
    box.appendChild(eb);
    var auto = [];
    if (p.conds.Blessed) auto.push('blessed: edge'); if (p.conds.Weakened) auto.push('weakened: bane');
    box.appendChild(el('div', { class: 'row side-mod' }, [
      el('label', { class: 'field' }, ['Other modifier', num(ui.mod || '', function (v) { ui.mod = parseInt(v, 10) || 0; }, { class: 'mini', placeholder: '0' })]),
      auto.length ? el('span', { class: 'fine', text: 'Auto: ' + auto.join(', ') }) : null
    ]));
    box.appendChild(el('div', { class: 'side-btns' }, CROWS.CHARS.map(function (c) {
      return btn(c + ' ' + signed(ch[c]), function () { rollTest({ label: c + ' test', charName: c, charVal: ch[c], kind: 'test', group: 'General' }); }, 'btn-primary');
    }).concat([
      btn('Miasma RR', function () {
        var mask = /Plague Mask/i.test(p.magic.Head || '') ? 2 : 0;
        rollTest({ label: 'Miasma RR' + (p.cruelty ? ' (cruelty -' + p.cruelty + ')' : '') + (mask ? ' (plague mask +2)' : ''), charName: 'Mind', charVal: ch.Mind, extraMod: mask - p.cruelty, kind: 'miasma', group: 'General' });
      }),
      btn('Initiative', function () { plainRoll('Initiative', 1, 10, function (t) { return t >= 6 ? 'PCs and allies act first' : 'enemies act first'; }); }),
      btn('Draw from pack', function () { plainRoll('Draw from pack', 1, 10, function (t) { return 'you get an item in slots 1-' + t; }); }),
      btn('d6', function () { plainRoll('d6', 1, 6); }), btn('d10', function () { plainRoll('d10', 1, 10); }),
      btn('2d10', function () { plainRoll('2d10', 2, 10); }), btn('d100', function () { plainRoll('d100', 1, 100); })
    ])));
    var res = el('div', { class: 'roll-result', 'aria-live': 'polite' });
    if (!last) res.appendChild(el('p', { class: 'fine', text: 'Tests: 2d10 + characteristic. 11 or lower = tier 1, 12-16 = tier 2, 17+ = tier 3. Natural 19-20 crit; 2-3 doom.' }));
    else if (last.plain) {
      res.appendChild(el('div', { class: 'rr-label', text: last.label }));
      res.appendChild(el('div', { class: 'rr-total', text: String(last.total) }));
      res.appendChild(el('div', { class: 'fine', text: (last.dice.length > 1 ? last.dice.join(' + ') : '') + (last.note ? ' ' + last.note : '') }));
    } else {
      var r = last;
      res.appendChild(el('div', { class: 'rr-label', text: r.label }));
      res.appendChild(el('div', { class: 'rr-line' }, [el('span', { class: 'rr-dice', text: r.dice.map(function (x) { return x; }).join(' + ') }),
        r.mod ? el('span', { text: ' ' + signed(r.mod) }) : null, el('span', { text: ' = ' }), el('b', { class: 'rr-total', text: String(r.total) })]));
      res.appendChild(el('div', { class: 'tier t' + r.tier, text: 'Tier ' + r.tier + (r.crit ? ' · CRIT' : '') + (r.doom ? ' · DOOM' : '') + (r.exp ? ' · +' + r.exp : '') }));
      var notes = [];
      if (r.net === 1) notes.push('edge +2'); if (r.net === -1) notes.push('bane -2');
      if (r.net === 2) notes.push('double edge: +1 tier'); if (r.net === -2) notes.push('double bane: -1 tier');
      if (r.conds.length) notes.push(r.conds.join(', '));
      if (notes.length) res.appendChild(el('div', { class: 'fine', text: notes.join(' · ') }));
      if (r.crit) res.appendChild(el('div', { class: 'fine', text: r.opts.kind === 'attack' ? 'Crit: you get another action.' : 'Crit: tier 3 plus something extra.' }));
      if (r.doom) res.appendChild(el('div', { class: 'fine', text: 'Doom: tier 1 and a major setback.' }));
      var dm = damageText(r); if (dm) res.appendChild(el('div', { class: 'rr-dmg', text: dm }));
      r.extra.forEach(function (x) { res.appendChild(el('div', { class: 'fine', text: x })); });
      if (r.opts.kind === 'miasma' && r.miasmaPending) {
        if (r.tier === 1) res.appendChild(btn('Apply: gain cruelty + Miasma Effects', function () {
          p.cruelty++; var e = d(10), tot = e + p.cruelty; r.miasmaPending = false;
          r.extra.push('Miasma Effects: 1d10 (' + e + ') + cruelty ' + p.cruelty + ' = ' + tot + (tot >= 13 ? ': your crow becomes an NPC.' : '. Ask the Ref for the effect.'));
          commit('Miasma: gained a cruelty level (now ' + p.cruelty + '); Miasma Effects roll ' + tot + '.');
        }, 'btn-primary'));
        else if (r.tier === 3 && p.cruelty) res.appendChild(btn('Apply: remove all cruelty', function () { p.cruelty = 0; r.miasmaPending = false; commit('Miasma RR tier 3: all cruelty removed.'); }, 'btn-primary'));
        else if (r.tier === 2) res.appendChild(el('div', { class: 'fine', text: 'No effect.' }));
      }
      if (r.doom && r.tier < 3) res.appendChild(el('div', { class: 'fine', text: 'A doom stays tier 1: expertises can\'t improve it.' }));
      var opts = expOptions(r);
      if (opts.length) {
        var sel = el('select', { 'aria-label': 'Expertise to spend' }, opts.map(function (e) { return el('option', { value: e.name, text: e.name + ' (' + (e.total - e.spent) + ' left)' }); }));
        res.appendChild(el('div', { class: 'row exp-spend' }, [sel, btn('Spend: +1 tier', function () {
          if (!spendExp(sel.value)) return;
          r.exp = sel.value; r.tier = Math.min(3, r.tier + 1);
          var note = '';
          if (r.chaosPending) { r.chaosPending = false; note = ' No longer tier 1, so no chaos roll.'; r.extra.push('Improved out of tier 1: no chaos roll.'); }
          commit(r.label + ': spent ' + sel.value + ', now tier ' + r.tier + '.' + (damageText(r) ? ' ' + damageText(r) : '') + note);
        })]));
      }
      if (r.chaosPending) res.appendChild(btn('Keep tier 1: make the chaos roll', function () { commit(r.label + ': kept tier 1. ' + chaosRoll(r)); }, 'btn-primary'));
      // Ranged miss next to allies (Rules: Ranged Attacks).
      if (r.opts.ranged && r.opts.dmg && r.tier === 1 && !r.chaosPending) {
        if (r.doom) res.appendChild(el('div', { class: 'fine warnish', text: 'Ranged doom: if any ally is adjacent to the target, you hit one of them (the Ref picks at random) for ' + Math.max(0, tierDamage(r.opts, 3)) + ' damage (tier 3).' }));
        else if (!r.allyRolled) res.appendChild(btn('Target was next to an ally? Roll', function () {
          var x = d(6); r.allyRolled = true;
          var t = 'Ally check d6 = ' + x + (x % 2 ? ': odd, the shot hits a random adjacent ally (Ref picks) for ' + Math.max(0, tierDamage(r.opts, 2)) + ' damage (tier 2).' : ': even, no ally is hit.');
          r.extra.push(t); commit(r.label + ': ' + t);
        }));
      }
    }
    box.appendChild(res);
  }

  function render() {
    if (!$('play')) return;
    applyMode(mode());
    if (mode() !== 'play') return;
    renderVitals(); renderTime(); renderAttacks(); renderExp(); renderItems(); renderAdvance(); renderGear(); renderLog(); renderRoller();
    var sb = $('play-sum'), p = P(), sp = speed();
    if (sb) sb.textContent = 'Stamina ' + C.curStamina() + '/' + C.staminaMax() + ' · Speed ' + sp.v + ' · Wounds ' + C.woundCount() + '/10' + (p.cruelty ? ' · Cruelty ' + p.cruelty : '') +
      (Object.keys(p.conds).length ? ' · ' + Object.keys(p.conds).join(', ') : '');
  }

  $('tab-build').addEventListener('click', function () { setMode('build'); });
  $('tab-play').addEventListener('click', function () { setMode('play'); });
  applyMode(mode());
  window.CrowsPlay = { render: render, setMode: setMode, syncAddress: syncAddress, loadCampaign: loadCampaign, joined: joined,
    /* Back to full Stamina, as the Full button does (the Ref Screen's "Everyone to full Stamina"). */
    fullStamina: function () { if (C.curStamina() < C.staminaMax()) { setStamina(C.staminaMax()); commit('Back to full Stamina.'); } },
    /*
     * A change the Ref Screen made to this crow (combat, rests, Miasma, XP), applied as changes rather than
     * overwritten values, so it adds to whatever the player did meanwhile. Any of:
     * xp (+ desc, gc, n): pending XP · apply: pending XP into TXP · full: full Stamina · st: Stamina +/- ·
     * wounds: ordinary wounds +/- · cruelty: +/- · setCruelty: a new value · endDT: dungeon turn n ended ·
     * endConds: blessed, vulnerable, weakened end (with a rest) · dt: dungeon turn n ended (with a rest).
     */
    refChange: refChange, refOps: refQueue };

  function refChange(o) {
    var p = P(), msgs = [], n;
    if (o.endDT) msgs.push(endDT(o.endDT));
    if (o.endConds && (n = endDTConditions())) msgs.push('Resting: ' + n);
    if (o.dt && P().dt !== o.dt) { P().dt = o.dt; msgs.push('Dungeon turn ' + o.dt + ' ended with the rest.'); }
    if (o.xp) {
      p.pendingXP = Math.max(0, p.pendingXP + o.xp);
      p.xpLog.unshift({ t: Date.now(), desc: o.desc || 'Treasure', gc: o.gc | 0, n: o.n | 0 || 1, xp: o.xp });
      if (p.xpLog.length > 100) p.xpLog.length = 100;
      msgs.push((o.desc || 'Treasure') + (o.gc ? ' worth ' + fmt(o.gc) + ' gc' : '') + ': ' + fmt(o.xp) + ' XP (applies after the next rest).');
    }
    if (o.apply && p.pendingXP) msgs.push(applyXP());
    if (o.full && C.curStamina() < C.staminaMax()) { setStamina(C.staminaMax()); msgs.push('Back to full Stamina.'); }
    if (o.st) {
      n = C.curStamina(); setStamina(n + o.st); n = C.curStamina() - n;
      if (n) msgs.push((n > 0 ? 'Regained ' : 'Lost ') + Math.abs(n) + ' Stamina (' + C.curStamina() + '/' + C.staminaMax() + ').');
    }
    if (o.wounds > 0 && (n = addWounds(o.wounds, 'w'))) msgs.push(n + ' wound' + (n === 1 ? '' : 's') + (C.woundCount() >= 10 ? ': all 10 backpack slots are wounded, your crow is dead.' : '.'));
    if (o.wounds < 0 && (n = healWounds(-o.wounds))) msgs.push('Healed ' + n + ' wound' + (n === 1 ? '' : 's') + '.');
    if (o.cruelty) { p.cruelty = Math.max(0, p.cruelty + o.cruelty); msgs.push('Cruelty ' + p.cruelty + '.'); }
    if (typeof o.setCruelty === 'number' && p.cruelty !== o.setCruelty) { p.cruelty = Math.max(0, o.setCruelty); msgs.push('Cruelty ' + p.cruelty + '.'); }
    refOps.push(o);
    applyingRef = true;
    try { if (msgs.length) commit(msgs.join(' ')); } finally { applyingRef = false; }
  }
})();
