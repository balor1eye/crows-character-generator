/*
 * Live combat on the Play page (accounts site only).
 *
 * When the Ref runs a fight in the Ref Screen with this crow in the combat tracker, the Combat card shows it here,
 * live, with every option the rules give a crow at that moment:
 *  - the round, who acts first, surprise, and this crow's turn: an action and a maneuver, or two maneuvers (a crit
 *    gives another action), and one reaction a round;
 *  - every combatant: how hurt foes look (or their Stamina and AD if the Ref shows them), conditions, grabs, taunts,
 *    hidden or squeezing, who each creature is attacking, and a feed of what happens;
 *  - targets: one, or several for spells and attacks that take more (Spark, Group Healing, Stream...), allies and
 *    yourself included for healing and blessings;
 *  - attacks and spells from Attacks & spells, sent to the Ref with their tier, damage, and effects (healing, AD,
 *    wounds closed, blessed, prone, weakened, vulnerable, pushes; Pummeling and Dismember) once the roll is final;
 *  - maneuvers (Move, Shift, Stand Up, Draw From Belt/Pack, Pick Up Item, Dump Backpack, Reload, Command Pet, and the
 *    rolled ones: Grab, Knockback, Escape Grab, Jump), and the actions Taunt, Ready, Assist, or anything in words;
 *  - reactions: a counter when a creature misses this crow in melee or fails to grab or knock it back (the Ref
 *    Screen asks), and opportunity attacks or readied actions;
 *  - the encounter's unattended items: drop what's in your hands (or Dump Backpack), and pick up what's on the
 *    ground (Pick Up Item: a maneuver that needs a free hand; the Ref Screen hands it over in the fight it publishes);
 *  - the modifiers the rules apply: the target's surprise, prone, grabbed, squeezing, or unconscious state, and the
 *    battlefield (flanking, high ground, hidden, cover, dim light, darkness, ranged against an adjacent creature,
 *    beyond range), and an ally's assist on the next test.
 *
 * The page watches the change signal for this crow's fights (see "live combat" in server/app/api.php), so the card
 * appears, changes, and goes away within a second or two of the Ref Screen. Every linked crow in the party also gets the
 * session with it, fight or not (the session bar: dungeon turn, timer, greed bonus, the party's rest, a signalled encounter),
 * and sends its choices for the party's rest (sendRest). The fight itself only shows to the crows in it. Damage, conditions, and healing the crow
 * takes reach the sheet from the Ref Screen, through its own armor.
 */
(function () {
  'use strict';
  if (!window.CrowsApp || !window.CrowsPlay) return;
  var C = window.CrowsApp.core, el = C.el, $ = C.$, signed = C.signed;
  var Play = window.CrowsPlay, Cloud = window.CrowsCloud;
  var fight = null;       // { charId, version, watch, campaign: { id, name }, combat, you: this crow's link id }
  var targets = [];       // ids of the chosen combatants, the first one is the main target
  var say = '', trigger = '';
  var sit = {};           // battlefield modifiers for the next roll
  var rxnNext = false;    // the next attack is a reaction (opportunity attack, readied action)
  var turn = { round: -1, act: 0, mnv: 0, extra: 0 };
  var usedAssists = {}, pendingAssist = null;
  var assistTo = '', assistChar = '';
  var loading = false, off = false;
  var reaching = {};      // item id -> when this crow asked to pick it up (until the Ref Screen answers)

  /*
   * Spells with effects on creatures in a fight (beyond damage, which the sheet works out). By tier 1/2/3: Stamina
   * regained, AD gained, wounds closed (null: no effect), +M where the book adds Mind; targets: how many (or by tier);
   * conds: conditions at tier 3; push by tier.
   */
  var SPELLS = {
    'Minor Healing Book': { heal: [1, 2, 4], plusM: true, targets: 1, allies: true },
    'Group Healing Book': { heal: [1, 2, 4], plusM: true, targets: 3, allies: true },
    'Minor Ward Book': { ad: [null, 1, 3], plusM: true, targets: 1, allies: true },
    'Wound Closure Book': { wounds: [0, 1, 2], targets: 1, allies: true },
    'Minor Blessing Book': { bless: [0, 1, 2], targets: [0, 1, 2], allies: true },
    'Spark Book': { targets: 2 },
    'Stream Book': { targets: 6 },
    'Thunder Book': { push: [0, 1, 2] },
    'Bone Capture Book': { t3: ['Prone'] },
    'Corrupt Book': { t3: ['Vulnerable'] },
    'Minor Curse Book': { t3: ['Weakened'] }
  };

  function charId() { return Cloud && Cloud.active && !Cloud.linked ? Cloud.recordId : null; }
  /* The fight the open crow is in, or null (the party's other crows get the session, not the fight). */
  function cur() {
    var id = charId(), c = fight && id && fight.charId === id && fight.combat && fight.combat.active ? fight.combat : null;
    return c && fight.you && (c.list || []).some(function (x) { return x.kind === 'pc' && x.link === fight.you; }) ? c : null;
  }
  /* The session the Ref Screen shares (dungeon turn, timer, greed bonus, the party's rest), or null. */
  function session() {
    var id = charId();
    return fight && id && fight.charId === id && fight.combat && fight.combat.session || null;
  }
  function find(id) { var c = cur(); return c && id ? c.list.filter(function (x) { return x.id === id; })[0] || null : null; }
  function me() { var c = cur(); return c && fight.you ? c.list.filter(function (x) { return x.kind === 'pc' && x.link === fight.you; })[0] || null : null; }
  function alive(x) { return x && !x.dead; }
  function chars() { return C.characteristics().values; }
  function best(a, b) { var v = chars(); return v[a] >= v[b] ? a : b; }
  function sizeAtMostMedium(x) { return !x || 'TSM'.indexOf(x.sz || 'M') >= 0; }
  /* Keep the targets on combatants still in the fight; with none, the first foe still up. */
  function fixTargets() {
    var c = cur();
    if (!c) return;
    targets = targets.filter(function (id) { return alive(find(id)); });
    if (targets.length) return;
    var foe = c.list.filter(function (x) { return x.kind === 'foe' && alive(x) && x.health !== 'down'; })[0] || c.list.filter(function (x) { return x.kind === 'foe' && alive(x); })[0];
    if (foe) targets = [foe.id];
  }
  function mainTarget() { return find(targets[0]); }

  // ------------------------------------------------------------------ server
  function load() {
    var id = charId();
    if (!id || loading || off) return;
    loading = true;
    var known = fight && fight.charId === id ? fight.version : 0;
    return Cloud.api('GET', 'combat.mine', 'id=' + id + (known ? '&known=' + known : '')).then(function (j) {
      if (charId() !== id) return;
      if (j.unchanged) { fight.version = j.version; return; }
      var was = cur(), prompts = was ? myPrompts().map(function (p) { return p.id; }) : [];
      var sessWas = JSON.stringify(session()), restWas = resting();
      fight = { charId: id, version: j.version, watch: j.watch, campaign: j.campaign, combat: j.combat, you: j.you };
      var now = cur();
      if (resting() && !restWas) C.toast('The party is resting: pick your food and rest activity on the Rest & turns tab, and send them to the Ref.', 6000);
      if (now && !was) C.toast('Combat! ' + (fight.campaign ? fight.campaign.name + ': ' : '') + 'your Ref started a fight.', 5000);
      if (was && !now) C.toast('The fight is over.', 4000);
      var fresh = now ? myPrompts().filter(function (p) { return prompts.indexOf(p.id) < 0; }) : [];
      if (fresh.length) C.toast(fresh[0].fromName + ' missed you: you may counter (a reaction). See the Combat card.', 6000);
      fixTargets();
      takeGiven();
      update();
      Play.items();
      if (JSON.stringify(session()) !== sessWas) C.render();   // the session bar and the Rest card
    }, function (e) {
      if (e.status === 404 && /Unknown action/.test(e.message)) off = true;   // a server without live combat
    }).then(function () {
      loading = false;
      if (fight && fight.charId === id && fight.watch) Cloud.watch('combat', fight.watch, fight.version, load);
    });
  }
  function act(a) {
    var c = cur();
    if (!c) { C.toast('Your crow isn’t in a fight.'); return Promise.resolve(false); }
    a.round = c.round;
    return Cloud.api('POST', 'combat.act', '', { id: fight.charId, campaign: fight.campaign.id, action: a }).then(function () { return true; },
      function (e) { C.toast('Not sent to the Ref: ' + e.message, 5000); if (e.status === 409) load(); return false; });
  }

  // ------------------------------------------------------------------ the session
  function resting() { var s = session(); return !!(s && s.rest && s.rest.active); }
  /* True once the Ref Screen has this crow's rest choices. */
  function restSent() { var s = session(); return resting() && fight.you != null && (s.rest.chose || []).indexOf(fight.you) >= 0; }
  /* The player's food and rest activity for the party's rest: the Ref Screen applies them when it finishes the rest. */
  function sendRest(o) {
    if (!resting()) { C.toast('The party isn’t resting.'); return Promise.resolve(false); }
    var a = { type: 'rest' };
    ['food', 'activity', 'study'].forEach(function (k) { if (o[k]) a[k] = String(o[k]); });
    // The armor to repair by name: card ids aren't kept on the Ref Screen's copy of the sheet.
    var rc = o.activity === 'repair' ? sheet().inv.filter(function (c) { return String(c.id) === String(o.repair); })[0] : null;
    if (rc) a.repair = rc.key;
    ['useKit', 'tended', 'tendedKit', 'caretaker'].forEach(function (k) { if (o[k]) a[k] = true; });
    return Cloud.api('POST', 'combat.act', '', { id: fight.charId, campaign: fight.campaign.id, action: a }).then(function () { C.toast('Sent to the Ref.'); return true; },
      function (e) { C.toast('Not sent to the Ref: ' + e.message, 5000); if (e.status === 409) load(); return false; });
  }
  function msLeft(s) { return s.running && s.endAt ? s.endAt - Date.now() : s.remain; }
  function clockText(ms) { var t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
  /* The session bar at the top of Play: the dungeon turn, time left, greed bonus, resting, an encounter signalled. */
  function renderSession() {
    var box = $('play-session'), s = document.body.getAttribute('data-mode') === 'play' ? session() : null;
    if (!box) return;
    box.hidden = !s;
    box.innerHTML = '';
    if (!s) return;
    var item = function (lbl, val, cls, extra) { return el('div', Object.assign({ class: 'sess-item' + (cls ? ' ' + cls : '') }, extra || {}), [el('span', { class: 'sess-lbl', text: lbl }), ' ', el('b', { text: val })]); };
    var timer = typeof s.rooms === 'number' ? item('Rooms left', String(s.rooms)) :
      item(s.running ? 'Time left' : 'Timer paused', clockText(msLeft(s)), msLeft(s) <= 0 ? 'out' : msLeft(s) <= 300000 ? 'low' : '', { 'data-sess-clock': '1' });
    [el('span', { class: 'sess-title', text: fight.campaign ? fight.campaign.name : 'Session' }), item('Dungeon turn', String(s.dt)), s.rest && s.rest.active ? null : timer,
      s.greed ? item('Greed bonus', '+' + s.greed + '%') : null,
      s.rest && s.rest.active ? el('button', { type: 'button', class: 'chip accent sess-chip', text: 'Resting' + (restSent() ? ' · choices sent' : ': choose food & activity'),
        title: 'Your food and rest activity: Rest & turns tab', onclick: function () { if (Play.showTab) Play.showTab('rest'); } }) : null,
      s.pending ? el('span', { class: 'chip bad sess-chip', text: 'Encounter signalled', title: 'The Ref gave a sign: an encounter comes during this dungeon turn' }) : null
    ].forEach(function (n) { if (n) box.appendChild(n); });
  }
  setInterval(function () {
    var s = session(), n = document.querySelector('[data-sess-clock] b');
    if (!s || !n || !s.running) return;
    var ms = msLeft(s);
    n.textContent = clockText(ms);
    n.parentNode.className = 'sess-item' + (ms <= 0 ? ' out' : ms <= 300000 ? ' low' : '');
  }, 1000);

  // ------------------------------------------------------------------ unattended items
  function sheet() { return window.CrowsApp.state; }
  /* What's on the ground, as the players see it (the Ref's hidden items aren't sent), or null outside a fight. */
  function ground() { var c = cur(); return c ? (c.items || []) : null; }
  /* Items the Ref Screen handed this crow (pickups it won): onto the sheet, each once. */
  function takeGiven() {
    var c = cur();
    if (!c || !fight.you) return;
    var p = sheet().play, got = Array.isArray(p.got) ? p.got : (p.got = []), msgs = [];
    (c.given || []).forEach(function (g) {
      if (g.to !== fight.you || got.indexOf(g.id) >= 0) return;
      got.push(g.id); delete reaching[g.item];
      var area = C.takeItem(g);
      msgs.push('Picked up ' + g.key + (area === 'hand' ? '.' : area === 'none' ? ': no room for it, so it’s set aside.' : ': no free hand, so it went in your ' + (area === 'pack' ? 'backpack' : 'belt') + '.'));
    });
    if (got.length > 200) got.splice(0, got.length - 200);
    if (msgs.length) { Play.note(msgs.join(' ')); C.toast(msgs.join(' '), 4000); }
  }
  function isReaching(id) { return reaching[id] && Date.now() - reaching[id] < 10000; }
  /* Why this crow can't pick the item up now ('' if it can): the Pick Up Item maneuver needs a free hand. */
  function cantPickUp(it) {
    var mine = me();
    if (!mine) return 'Your crow isn’t in this fight.';
    if (mine.dead || mine.conds.indexOf('Unconscious') >= 0) return 'Not while unconscious.';
    if (isReaching(it.id)) return 'Already reaching for it: waiting for the Ref.';
    if (!C.handFits(it.key)) return C.spanOf({ key: it.key }, 'hand') > 1 ? it.key + ' needs both hands free.' : 'You need a free hand to pick it up.';
    return '';
  }
  function pickUp(it) {
    var why = cantPickUp(it);
    if (why) { C.toast(why); return; }
    reaching[it.id] = Date.now();
    spend('mnv');
    act({ type: 'pickup', item: it.id, itemName: it.key }).then(function (ok) {
      if (ok) C.toast('Pick Up Item: ' + it.key + ' (a maneuver). The Ref hands it over.'); else delete reaching[it.id];
      update(); C.render();
    });
  }
  function dropSpec(c) { var o = { key: c.key, qty: c.qty }; ['ud', 'dmg', 'ammo'].forEach(function (k) { if (typeof c[k] === 'number') o[k] = c[k]; }); return o; }
  /*
   * Put items down in the fight: what's in this crow's hands (dropping is free), or with dump, the backpack's contents
   * (the Dump Backpack maneuver). They leave the sheet once the Ref Screen has the action. False if not allowed.
   */
  function drop(cards, dump) {
    if (!cur() || !cards.length) return false;
    if (!dump && cards.some(function (c) { return c.area !== 'hand'; })) {
      C.toast('In a fight you can only drop what’s in your hands. Draw it first (Draw From Belt or Draw From Pack), or Dump Backpack.', 5000);
      return false;
    }
    if (dump) spend('mnv');
    act({ type: 'drop', dump: !!dump, items: cards.map(dropSpec) }).then(function (ok) {
      if (!ok) return;
      sheet().inv = sheet().inv.filter(function (c) { return cards.indexOf(c) < 0; });
      Play.note((dump ? 'Dumped my backpack: ' : 'Dropped ') + cards.map(function (c) { return c.key + (c.qty > 1 ? ' ×' + c.qty : ''); }).join(', ') + '.');
    });
    return true;
  }
  function dumpBackpack() {
    var pack = sheet().inv.filter(function (c) { return c.area === 'pack'; });
    if (!pack.length) { maneuver('Dump Backpack', null, 'their backpack is empty'); return; }
    if (!confirm('Dump your backpack? Everything in it (' + pack.map(function (c) { return c.key; }).join(', ') + ') lands on the ground, where anyone can pick it up.')) return;
    drop(pack, true);
  }

  // ------------------------------------------------------------------ this crow's turn
  function syncTurn() { var c = cur(); if (c && turn.round !== c.round) turn = { round: c.round, act: 0, mnv: 0, extra: 0 }; }
  /* Use an action or a maneuver this turn (an action and a maneuver, or two maneuvers; a crit adds an action). */
  function spend(kind) {
    syncTurn();
    var acts = 1 + turn.extra, slots = 2 + turn.extra;
    if (kind === 'act') turn.act++; else turn.mnv++;
    if (turn.act > acts) C.toast('That’s more actions than you have this turn (1, plus 1 for each crit).', 5000);
    else if (turn.act + turn.mnv > slots) C.toast('That’s more than an action and a maneuver (or two maneuvers) this turn.', 5000);
  }
  function rxLeft() { var m = me(); return m && typeof m.rxLeft === 'number' ? m.rxLeft : 1; }
  function myPrompts() { var c = cur(), m = me(); return c && m ? (c.prompts || []).filter(function (p) { return p.to === m.id && !p.done; }) : []; }
  function myAssist() { var c = cur(), m = me(); return c && m ? (c.assists || []).filter(function (a) { return a.to === m.id && !usedAssists[a.id]; })[0] || null : null; }

  /*
   * Called by play.js for every roll in a fight: the modifiers that apply. For attacks: the main target's surprise
   * (+1), prone (melee edge, ranged bane), grabbed (edge), squeezing (+1), unconscious (tier 3), and the battlefield.
   * For any test: an ally's assist.
   */
  function rollMods(opts, attack) {
    var c = cur(), mine = me();
    if (!c) return null;
    var m = { e: 0, b: 0, mod: 0, why: [], autoT3: false }, melee = !!opts.melee;
    var as = myAssist();
    if (as) { m.mod += as.bonus; m.why.push(signed(as.bonus) + ' assist from ' + as.fromName); pendingAssist = as.id; }
    if (opts.kind === 'maneuver' && opts.maneuver === 'Jump' && opts.run) { m.e++; m.why.push('moved 2+ squares first: edge'); }
    if (!attack) return m;
    var t = mainTarget(), canFlank = !(mine && mine.conds.some(function (k) { return k === 'Prone' || k === 'Grabbed'; }));
    if (t && t !== mine) {
      if (t.surprised) { m.mod++; m.why.push('+1 vs surprised'); }
      if (t.conds.indexOf('Prone') >= 0) { if (melee) { m.e++; m.why.push('target prone: edge'); } else { m.b++; m.why.push('target prone: bane on ranged'); } }
      if (t.conds.indexOf('Grabbed') >= 0) { m.e++; m.why.push('target grabbed: edge'); }
      if (t.squeeze) { m.mod++; m.why.push('+1 vs squeezing'); }
      if (t.conds.indexOf('Unconscious') >= 0) { m.autoT3 = true; m.why.push('target unconscious: tier 3'); }
    }
    if (sit.flank && melee && canFlank) { m.e++; m.why.push('flanking: edge'); }
    if (sit.high) { m.e++; m.why.push('high ground: edge'); }
    if (sit.hidden) { m.e++; m.why.push('hidden: edge (now revealed)'); }
    if (sit.cover) { m.b++; m.why.push('cover: bane'); }
    if (sit.dark) { m.b += 2; m.why.push('darkness: double bane'); } else if (sit.dim) { m.b++; m.why.push('dim light: bane'); }
    if (sit.adj && !melee) { m.b++; m.why.push('ranged vs adjacent: bane'); }
    if (sit.far > 0 && !melee) { m.mod -= 2 * sit.far; m.why.push('-' + (2 * sit.far) + ' beyond range'); }
    sit = {};   // they were for this roll (and attacking gives a hidden crow away)
    return m;
  }

  // ------------------------------------------------------------------ rolls (attacks, spells, maneuvers, assists)
  function kindOf(r) { return r && r.opts ? r.opts.kind : ''; }
  function isFightRoll(r) { return /^(attack|cast|maneuver|assist)$/.test(kindOf(r)); }
  /* How many targets this roll takes: spells may take several (some by tier); everything else one. */
  function maxTargets(r) {
    var fx = r.opts.card && SPELLS[r.opts.card.key];
    if (!fx || !fx.targets) return 1;
    return Array.isArray(fx.targets) ? fx.targets[r.tier - 1] : fx.targets;
  }
  /* Called by play.js right after a roll. */
  function rolled(r) {
    if (!cur()) return;
    if (pendingAssist) {   // the assist went into this test
      usedAssists[pendingAssist] = true;
      act({ type: 'assistUsed', text: pendingAssist });
      pendingAssist = null;
    }
    if (!isFightRoll(r)) return;
    r.fight = { targets: targets.slice(), sent: false, rxn: rxnNext && (r.opts.kind === 'attack' || r.opts.kind === 'cast') };
    if (r.fight.rxn) rxnNext = false;
    if (r.opts.maneuver === 'Escape Grab') r.fight.targets = [];
    if (Play.final(r)) send(r);
  }
  /* The result changed (expertise spent, chaos roll made): send it once it's final. */
  function updated(r) { if (r && r.fight && !r.fight.sent && Play.final(r)) send(r); }
  /* Another roll is starting: a result still waiting goes as it is. */
  function superseded(r) { if (r && r.fight && !r.fight.sent) send(r); }
  function tlist(r) {
    return r.fight.targets.slice(0, Math.max(0, maxTargets(r))).map(function (id) { var x = find(id); return x ? { id: x.id, name: x.name } : null; }).filter(Boolean);
  }
  function send(r) {
    var o = r.opts, k = o.kind, ts = tlist(r), main = ts[0] || null, p;
    r.fight.sent = true;
    if (k === 'maneuver') {
      p = { type: 'maneuver', name: o.maneuver, tier: r.tier, crit: r.crit, doom: r.doom, target: main ? main.id : '', targetName: main ? main.name : '' };
      if (o.maneuver === 'Jump') p.jump = Math.max(3, 2 + Math.max(chars().Agility, chars().Strength));
      spend('mnv');
    } else if (k === 'assist') {
      var to = find(o.assistTo);
      p = { type: 'assist', tier: r.tier, crit: r.crit, doom: r.doom, assistTo: o.assistTo, bonus: r.tier === 1 ? -1 : r.tier === 2 ? 1 : 2, text: to ? '' : '' };
      spend('act');
    } else {
      var dm = Play.damageOf(r), notes = [], fx = (o.card && SPELLS[o.card.key]) || {}, M = chars().Mind, wt = o.card ? C.item(o.card.key).txt : '';
      if (dm && dm.parts.length) notes.push(dm.parts.join(', '));
      if (r.crit) notes.push(k === 'attack' ? 'crit: another action' : 'crit');
      r.extra.forEach(function (x) { if (/chaos|backlash|ally/i.test(x)) notes.push(x); });
      var rank = k === 'cast' && o.card ? +((/\bR(\d)\b/.exec(wt) || [])[1] || 0) : 0, conds = [], push = 0, condMaxSize = '';
      function byTier(arr, addM) { var v = arr ? arr[r.tier - 1] : null; return v === null || v === undefined || (!v && !addM) ? 0 : v + (addM ? M : 0); }
      var heal = fx.heal ? byTier(fx.heal, fx.plusM) : 0, ad = fx.ad ? byTier(fx.ad, fx.plusM) : 0, wounds = fx.wounds ? byTier(fx.wounds) : 0;
      if (fx.bless && fx.bless[r.tier - 1]) conds.push('Blessed');
      if (fx.t3 && r.tier === 3) conds = conds.concat(fx.t3);
      if (fx.push) push = fx.push[r.tier - 1] || 0;
      // Weapon qualities: Pummeling (T3 vs your size or smaller: push 1; crit: prone), Dismember (a crit takes a limb: the Ref rolls).
      if (k === 'attack' && /Pummeling/.test(wt)) {
        if (r.tier === 3 && sizeAtMostMedium(find(main && main.id))) { push = 1; notes.push('Pummeling: push 1'); }
        if (r.crit) { conds.push('Prone'); condMaxSize = 'M'; notes.push('Pummeling crit: prone'); }
      }
      if (push) notes.push('push ' + push);
      p = { type: 'attack', targets: ts, target: main ? main.id : '', targetName: main ? main.name : '', label: r.label, tier: r.tier, crit: r.crit, doom: r.doom,
        damage: dm ? dm.n : 0, cast: k === 'cast', heal: heal, ad: ad, healWounds: wounds, conds: conds, condMaxSize: condMaxSize, push: push,
        melee: !!o.melee, ranged: !!o.ranged && !!o.dmg, allyDamage: Play.allyDamage(r, 3), allyDamage2: Play.allyDamage(r, 2), rank: rank,
        backlash: k === 'cast' && r.extra.some(function (x) { return /BACKLASH/.test(x); }), dismember: k === 'attack' && /Dismember/.test(wt) && r.crit,
        rxn: r.fight.rxn, text: notes.join('; ') };
      if (!r.fight.rxn) spend(k === 'cast' && o.time === 'mnv' ? 'mnv' : 'act');
      if (r.crit && k === 'attack' && !r.fight.rxn) { syncTurn(); turn.extra++; }
    }
    act(p).then(function (ok) { if (!ok) { r.fight.sent = false; C.render(); } });
  }
  /* For the dice result: where this roll went, or a button to send it now. */
  function rollNote(r) {
    if (!r || !r.fight) return null;
    var names = r.fight.targets.map(function (id) { var x = find(id); return x ? x.name : null; }).filter(Boolean);
    var who = r.opts.kind === 'assist' ? ' (assisting ' + ((find(r.opts.assistTo) || {}).name || 'an ally') + ')' : names.length ? ' (target: ' + names.slice(0, maxTargets(r) || 1).join(', ') + ')' : ' (no target)';
    if (r.fight.sent) return el('div', { class: 'fine cbt-sent', text: '→ Sent to the Ref' + who + (r.fight.rxn ? ', as a reaction' : '') + '.' });
    return el('div', { class: 'row cbt-wait' }, [el('span', { class: 'fine', text: 'Goes to the Ref' + who + ' once you keep this result.' }),
      el('button', { type: 'button', class: 'btn btn-small', text: 'Send as it is', onclick: function () { send(r); C.render(); } })]);
  }

  // ------------------------------------------------------------------ maneuvers, actions, reactions
  /* A maneuver without a roll (Move, Shift, Draw From Belt...), sent to the Ref. */
  function maneuver(name, target, text) {
    spend('mnv');
    var t = target ? find(target) : null;
    return act({ type: 'maneuver', name: name, target: t ? t.id : '', targetName: t ? t.name : '', text: text || '' }).then(function (ok) { if (ok) { C.toast(name + ': sent to the Ref.'); update(); } return ok; });
  }
  /* A rolled maneuver, through the dice panel (expertise and conditions as for any test). */
  function rollManeuver(name, charName, extra) {
    var o = { label: name, charName: charName, charVal: chars()[charName], kind: 'maneuver', group: 'General', maneuver: name };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    Play.rollTest(o);
  }
  function counter(p) {
    var ws = Play.meleeWeapons().sort(function (a, b) { return b.t2 - a.t2; }), w = ws[0];
    if (!w) return;
    var n = p.doom ? w.t3 : w.t2, foe = find(p.from);
    act({ type: 'attack', label: 'Counter with ' + w.key, tier: p.doom ? 3 : 2, damage: n, melee: true, target: p.from, targetName: foe ? foe.name : p.fromName,
      targets: foe ? [{ id: foe.id, name: foe.name }] : [], rxn: true, prompt: p.id, text: p.doom ? 'they rolled a doom: tier 3 damage' : '' })
      .then(function (ok) { if (ok) C.toast('Counter: ' + n + ' damage to ' + p.fromName + '.'); });
  }

  // ------------------------------------------------------------------ the Combat card
  function healthChip(x) {
    var cls = x.dead || x.health === 'down' ? 'bad' : x.health === 'badly hurt' ? 'warn' : x.health === 'hurt' || x.health === 'armor dented' ? 'mid' : 'ok';
    return el('span', { class: 'hp-chip ' + cls, text: x.health });
  }
  function rich(text) {
    return el('span', null, String(text).split('**').map(function (part, i) { return i % 2 ? el('b', { text: part }) : document.createTextNode(part); }));
  }
  var btn = window.CrowsDom.btn;
  function row(x) {
    var mine = x === me(), on = targets[0] === x.id, also = !on && targets.indexOf(x.id) >= 0, m = me();
    var nums = typeof x.st === 'number' ? 'Stamina ' + x.st + '/' + x.stMax + (x.adMax ? ' · AD ' + x.ad + '/' + x.adMax : '') + (x.wounds ? ' · ' + x.wounds + ' wound' + (x.wounds === 1 ? '' : 's') : '') : '';
    var hitsMe = m && (x.tgt === m.id || x.tgt2 === m.id);
    return el('div', { class: 'cbt-row k-' + x.kind + (x.dead ? ' dead' : '') + (on || also ? ' on' : '') + (mine ? ' me' : '') }, [
      el('div', { class: 'cbt-who' }, [
        el('b', { text: x.name + (mine ? ' (you)' : '') }),
        el('div', { class: 'fine', text: [x.type, x.size, nums].filter(Boolean).join(' · ') })]),
      el('div', { class: 'cbt-tags' }, [healthChip(x)].concat(
        (x.conds || []).map(function (k) { return el('span', { class: 'chip', text: k }); }),
        x.surprised ? [el('span', { class: 'chip warn', text: 'surprised', title: 'No turn in round 1; attacks against them get +1' })] : [],
        x.grabbedByName ? [el('span', { class: 'chip warn', text: 'grabbed by ' + x.grabbedByName })] : [],
        x.tauntName ? [el('span', { class: 'chip', text: 'taunted by ' + x.tauntName, title: 'Its attacks that don’t include ' + x.tauntName + ' take a bane' })] : [],
        x.hidden ? [el('span', { class: 'chip', text: 'hidden' })] : [],
        (x.holds || []).map(function (h) { return el('span', { class: 'chip', text: 'holds ' + h }); }), x.squeeze ? [el('span', { class: 'chip', text: 'squeezing', title: 'Attacks against it get +1' })] : [],
        x.kind === 'pc' && x.done ? [el('span', { class: 'chip ok', text: 'done', title: 'Done for this round' })] : [],
        x.kind !== 'pc' && x.acted ? [el('span', { class: 'chip', text: 'acted' })] : [],
        x.tgtName ? [el('span', { class: 'chip' + (hitsMe ? ' warn' : ''), text: hitsMe ? 'attacking you' : '→ ' + x.tgtName + (x.tgt2Name ? ', ' + x.tgt2Name : ''), title: 'Who it’s attacking' })] : [])),
      alive(x) ? el('span', { class: 'cbt-pick' }, [
        btn(on ? 'Target ✓' : 'Target', function () { targets = [x.id]; update(); }, 'btn-small' + (on ? ' btn-primary' : ''), { 'aria-pressed': String(on), title: mine ? 'Yourself (healing, wards, blessings)' : 'Your attacks and spells go at ' + x.name }),
        on ? null : btn(also ? '−' : '+', function () { if (also) targets.splice(targets.indexOf(x.id), 1); else if (targets.length < 6) targets.push(x.id); update(); }, 'btn-small btn-ghost',
          { 'aria-pressed': String(also), title: also ? 'Drop ' + x.name + ' from your targets' : 'Also target ' + x.name + ' (for spells and attacks on several creatures)', 'aria-label': (also ? 'Drop ' : 'Also target ') + x.name })]) : null
    ]);
  }
  function renderView(box) {
    var c = cur(), mine = me(), t = mainTarget();
    var foes = c.list.filter(function (x) { return x.kind === 'foe'; }), friends = c.list.filter(function (x) { return x.kind !== 'foe'; });
    var up = foes.filter(function (x) { return !x.dead && x.health !== 'down'; }).length;
    var order = !c.round ? 'The fight hasn’t started: the Ref rolls initiative.' : c.first === 'crows' ? 'Crows and allies act first.' : c.first === 'foes' ? 'Enemies act first.' : '';
    var surprise = c.round <= 1 && c.surprise === 'crows' ? 'The crows and their allies are surprised: no turn in round 1.' :
      c.round <= 1 && c.surprise === 'foes' ? 'The foes are surprised: no turn in round 1, and attacks against them get +1.' : '';
    var names = targets.map(function (id) { var x = find(id); return x ? x.name : null; }).filter(Boolean);
    box.appendChild(el('div', { class: 'cbt-head' }, [
      el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Round' }), el('div', { class: 'val' }, [el('b', { text: String(c.round || '—') })])]),
      el('div', { class: 'grow' }, [
        el('div', null, [el('b', { text: c.name || 'A fight' }), fight.campaign ? ' · ' + fight.campaign.name : '']),
        el('div', { class: 'fine', text: [order, surprise].filter(Boolean).join(' ') }),
        el('div', { class: 'fine', text: up + ' of ' + foes.length + ' foe' + (foes.length === 1 ? '' : 's') + ' standing.' + (names.length ? ' Your target' + (names.length > 1 ? 's' : '') + ': ' + names.join(', ') + '.' : ' No target chosen.') })])]));
    // What's happening to this crow right now.
    var bans = [];
    if (mine && mine.surprised) bans.push(['warn', 'You’re surprised: you take no turn this round.']);
    if (mine && mine.conds.indexOf('Unconscious') >= 0) bans.push(['bad', 'You’re unconscious: no actions, maneuvers, or reactions; attacks against you are tier 3. Any damage wakes you.']);
    if (mine && mine.grabbedByName) bans.push(['warn', 'Grabbed by ' + mine.grabbedByName + ': speed 0, you can’t flank, attacks against you have an edge. Escape Grab is a maneuver.']);
    if (mine && mine.conds.indexOf('Prone') >= 0) bans.push(['warn', 'Prone: speed halved, bane on your melee attacks, you can’t flank. Standing up is a maneuver.']);
    if (mine && mine.tauntName) bans.push(['warn', 'Taunted by ' + mine.tauntName + ': your attacks that don’t include them take a bane.']);
    var as = myAssist();
    if (as) bans.push(['ok', as.fromName + ' assists you: ' + signed(as.bonus) + ' on your next test (it lapses after this turn).']);
    bans.forEach(function (b) { box.appendChild(el('div', { class: 'banner ' + b[0], text: b[1] })); });
    myPrompts().forEach(function (p) {
      var ws = Play.meleeWeapons().sort(function (a, b) { return b.t2 - a.t2; }), w = ws[0], can = w && rxLeft() > 0 && !(mine && mine.conds.indexOf('Unconscious') >= 0);
      box.appendChild(el('div', { class: 'banner ok cbt-prompt' }, [
        el('b', { text: 'Reaction: ' }), p.fromName + (p.what ? ' failed ' + p.what + ' against you' : ' missed you') + (p.doom ? ' with a doom' : '') + '. You may counter with your wielded melee weapon: its tier ' + (p.doom ? 3 : 2) + ' damage. ',
        can ? btn('Counter ' + p.fromName + ' (' + (p.doom ? w.t3 : w.t2) + ' with ' + w.key + ')', function () { counter(p); }, 'btn-small btn-primary') :
          el('span', { class: 'fine', text: !w ? 'You have no melee weapon in hand to counter with.' : rxLeft() <= 0 ? 'You’ve used your reaction this round.' : '' })]));
    });
    if (mine && c.round) box.appendChild(turnBox(c, mine));
    box.appendChild(el('h3', { text: 'Enemies' }));
    box.appendChild(el('div', { class: 'cbt-list' }, foes.length ? foes.map(row) : [el('p', { class: 'fine', text: 'No enemies in the fight yet.' })]));
    if (friends.length) {
      box.appendChild(el('h3', { text: 'Crows and allies' }));
      box.appendChild(el('div', { class: 'cbt-list' }, friends.map(row)));
    }
    var items = c.items || [];
    if (items.length) {
      box.appendChild(el('h3', { text: 'On the ground' }));
      box.appendChild(el('div', { class: 'cbt-list cbt-ground' }, items.map(function (it) {
        var why = cantPickUp(it);
        return el('div', { class: 'cbt-row k-item', title: (C.item(it.key).txt || it.key) }, [
          el('div', { class: 'cbt-who' }, [el('b', { text: it.key + (it.qty > 1 ? ' ×' + it.qty : '') }), it.by ? el('div', { class: 'fine', text: 'Dropped by ' + it.by }) : null]),
          el('span', { class: 'cbt-pick' }, [btn(isReaching(it.id) ? 'Reaching…' : 'Pick up', function () { pickUp(it); }, 'btn-small', { disabled: why ? true : null,
            title: why || 'Pick Up Item (a maneuver): into a free hand' })])]);
      })));
    }
    var feed = (c.feed || []).slice(-12).reverse();
    if (feed.length) box.appendChild(el('details', { class: 'cbt-feed', open: true }, [el('summary', { text: 'What’s happening' }),
      el('ol', null, feed.map(function (f) { var d = new Date(f.t); return el('li', null, [el('span', { class: 'log-t', text: ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) }), rich(f.s)]); }))]));
    void t;
  }
  /* This crow's turn: what's used, what's left, and done for the round. */
  function turnBox(c, mine) {
    syncTurn();
    var acts = 1 + turn.extra, slots = 2 + turn.extra, left = [];
    var actLeft = Math.max(0, Math.min(acts - turn.act, slots - turn.act - turn.mnv)), mnvLeft = Math.max(0, slots - turn.act - turn.mnv);
    left.push(actLeft ? plural(actLeft, 'action') + ' left' : 'no action left');
    left.push(mnvLeft ? 'room for ' + plural(mnvLeft, 'maneuver') : 'no maneuver left');
    var sideFirst = c.first === 'crows' ? 'Your side acts first this round.' : c.first === 'foes' ? 'The enemies act first this round.' : '';
    return el('div', { class: 'cbt-turn' }, [
      el('div', null, [el('b', { text: 'Your turn: ' }), 'an action and a maneuver, or two maneuvers' + (turn.extra ? ', plus ' + plural(turn.extra, 'extra action') + ' from a crit' : '') + '. ' + sideFirst]),
      el('div', { class: 'fine', text: 'Used: ' + plural(turn.act, 'action') + ', ' + plural(turn.mnv, 'maneuver') + ' (' + left.join(', ') + ') · Reaction: ' + (rxLeft() > 0 ? 'available' : 'used') + ' this round.' }),
      el('div', { class: 'row wrap' }, [
        btn(mine.done ? 'Done for round ' + c.round + ' ✓ (undo)' : 'Done for this round', function () { act({ type: mine.done ? 'undone' : 'done' }); }, mine.done ? '' : 'btn-primary', { 'aria-pressed': String(!!mine.done), title: 'Tell the Ref your crow has acted this round' }),
        btn('Reset my count', function () { turn = { round: c.round, act: 0, mnv: 0, extra: 0 }; update(); }, 'btn-small btn-ghost', { title: 'Start counting this turn’s actions and maneuvers again' })])
    ]);
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function renderAct(box) {
    var c = cur(), mine = me(), t = mainTarget(), out = !!(mine && mine.conds.indexOf('Unconscious') >= 0), v = chars();
    var grabbed = !!(mine && mine.grabbedByName), prone = !!(mine && mine.conds.indexOf('Prone') >= 0), pets = (window.CrowsApp.state.pets || []).length;
    var tAt = t && t !== mine ? t : null, fits = tAt && sizeAtMostMedium(tAt), dis = Play.disengage();
    function sitBtn(key, label, title, disabled) {
      return el('button', { type: 'button', class: 'cond' + (sit[key] ? ' on' : ''), 'aria-pressed': String(!!sit[key]), title: title, text: label, disabled: disabled || null,
        onclick: function () { sit[key] = !sit[key]; update(true); } });
    }
    box.appendChild(el('p', { class: 'hint', text: 'Pick your target(s), then attack or cast from Attacks & spells: once a roll is final it goes to the Ref with its damage and effects. Maneuvers and actions below go to the Ref too.' }));
    // Battlefield modifiers for the next attack.
    box.appendChild(el('div', { class: 'sit-row' }, [el('span', { class: 'fine', text: 'Next attack:' }),
      sitBtn('flank', 'Flanking', 'An ally is on the opposite side of the target: edge on melee attacks (not while you or they are prone or grabbed)', grabbed || prone),
      sitBtn('high', 'High ground', '1+ square above the target: edge on attacks'),
      sitBtn('hidden', 'Hidden', 'You’re hidden from the target: edge on attacks (attacking reveals you)'),
      sitBtn('cover', 'Cover', 'The target is half behind something solid: bane on attacks'),
      sitBtn('dim', 'Dim light', 'Dim light or light concealment: bane on attacks'),
      sitBtn('dark', 'Darkness', 'Darkness, heavy concealment, or an invisible target: double bane (against a silent mover, the Ref may have you guess its square)'),
      sitBtn('adj', 'Ranged vs adjacent', 'A ranged attack against a creature next to you: bane'),
      el('label', { class: 'fine', title: 'Squares beyond your range: -2 each' }, ['Beyond range ', el('input', { type: 'number', class: 'mini', min: 0, max: 10, value: sit.far || '', 'aria-label': 'Squares beyond range',
        oninput: function () { sit.far = Math.max(0, Math.min(10, parseInt(this.value, 10) || 0)); } })])]));
    box.appendChild(el('label', { class: 'check', title: 'An opportunity attack (a creature leaves your reach) or a readied action: it uses your reaction, not your turn' }, [
      el('input', { type: 'checkbox', checked: rxnNext, disabled: out || rxLeft() <= 0 || null, onchange: function () { rxnNext = this.checked; } }), ' My next attack is a reaction (opportunity attack or readied action)']));
    // Maneuvers.
    var mv = [
      btn('Move', function () { maneuver('Move', null, ''); }, 'btn-small', { title: 'Move up to your speed (you can split it around your action)' }),
      btn('Shift' + (dis ? ' (' + (1 + dis) + ')' : ''), function () { maneuver('Shift', null, 'shifts ' + (1 + dis) + ' square' + (dis ? 's' : '') + ' (no opportunity attacks)'); }, 'btn-small', { title: 'Move 1 square without opportunity attacks' + (dis ? ' (+' + dis + ' from Disengage)' : '') }),
      prone ? btn('Stand Up', function () { Play.setCond('Prone', false); maneuver('Stand Up', null, ''); }, 'btn-small btn-primary', { title: 'Stand up (speed 1+)' }) : null,
      btn('Draw From Belt', function () { maneuver('Draw From Belt', null, 'takes 1-2 items from their belt'); }, 'btn-small'),
      btn('Draw From Pack', function () { var r = C.d(10); maneuver('Draw From Pack', null, 'd10 = ' + r + ': gets an item from backpack slots 1-' + r + ' (or only rearranges the pack)'); }, 'btn-small', { title: 'Name an item, roll 1d10: you take it if the roll is at least one of its slot numbers' }),
      btn('Pick Up Item', function () { maneuver('Pick Up Item', null, ''); }, 'btn-small', { title: 'Needs a free hand. For something on the Ref’s list, use its Pick up button under On the ground instead' }),
      btn('Dump Backpack', dumpBackpack, 'btn-small btn-ghost', { title: 'Maneuver: everything in your backpack lands on the ground' }),
      Play.unloaded().length ? btn('Reload', function () { Play.reload(Play.unloaded()[0]); }, 'btn-small btn-primary', { title: 'Load 1 ammo before each attack' }) : null,
      pets ? btn('Command Pet', function () { maneuver('Command Pet', tAt && tAt.id, 'their pet uses its action or a maneuver' + (tAt ? ' against ' + tAt.name : '')); }, 'btn-small', { title: 'Your pet uses its action or maneuver (a complex or dangerous command: 2d10 + M)' }) : null,
      fits ? btn('Grab ' + tAt.name, function () { rollManeuver('Grab', 'Strength'); }, 'btn-small', { title: '2d10 + S against a target your size or smaller in reach: T1 they may counter; T2 grabbed (push 1 or you shift); T3 grabbed' }) : null,
      fits ? btn('Knockback ' + tAt.name, function () { rollManeuver('Knockback', 'Strength'); }, 'btn-small', { title: '2d10 + S against a target your size or smaller in reach: T1 they may counter; T2 push 1; T3 push 2' }) : null,
      tAt && !fits ? el('span', { class: 'fine', text: tAt.name + ' is too big to grab or knock back.' }) : null,
      grabbed ? btn('Escape Grab', function () { rollManeuver('Escape Grab', best('Agility', 'Strength')); }, 'btn-small btn-primary', { title: '2d10 + A or S: T1 still grabbed; T2 free, but the grabber may counter; T3 free and move 1' }) : null,
      btn('Jump', function () { rollManeuver('Jump', best('Agility', 'Strength'), { run: !!sit.run }); }, 'btn-small', { title: 'Part of a move, 2d10 + A or S (edge if you moved 2+ squares first): T1 0; T2 up to 2 squares, 1 high; T3 up to ' + Math.max(3, 2 + Math.max(v.Agility, v.Strength)) + ' squares, 1 high' }),
      el('label', { class: 'fine' }, [el('input', { type: 'checkbox', checked: !!sit.run, onchange: function () { sit.run = this.checked; } }), ' moved 2+ first'])
    ];
    box.appendChild(el('h3', { text: 'Maneuvers' }));
    box.appendChild(el('div', { class: 'row wrap cbt-btns' }, out ? [el('span', { class: 'fine', text: 'Not while unconscious.' })] : mv.filter(Boolean)));
    // Actions besides attacking and casting.
    var crows = c.list.filter(function (x) { return x.kind !== 'foe' && alive(x) && x !== mine; });
    if (!crows.some(function (x) { return x.id === assistTo; })) assistTo = crows[0] ? crows[0].id : '';
    var aSel = el('select', { 'aria-label': 'Ally to assist', onchange: function () { assistTo = this.value; } }, crows.map(function (x) { return el('option', { value: x.id, text: x.name }); }));
    aSel.value = assistTo;
    var cSel = el('select', { 'aria-label': 'Characteristic for the assist', onchange: function () { assistChar = this.value; } }, ['Agility', 'Mind', 'Strength'].map(function (k) { return el('option', { value: k, text: k + ' ' + signed(v[k]) }); }));
    cSel.value = assistChar || best('Agility', 'Strength');
    var trig = el('input', { type: 'text', class: 'grow', maxlength: 200, value: trigger, placeholder: 'e.g. when the ghoul steps through the door, I attack it', 'aria-label': 'Ready: trigger and action', oninput: function () { trigger = this.value; } });
    box.appendChild(el('h3', { text: 'Actions' }));
    box.appendChild(el('div', { class: 'row wrap cbt-btns' }, out ? [el('span', { class: 'fine', text: 'Not while unconscious.' })] : [
      tAt ? btn('Taunt ' + tAt.name, function () { spend('act'); act({ type: 'taunt', target: tAt.id, targetName: tAt.name }).then(function (ok) { if (ok) C.toast('Taunt: sent to the Ref.'); }); }, 'btn-small',
        { title: 'A creature within 10: until the start of your next turn, its attacks that don’t include you take a bane' }) : null,
      crows.length ? el('span', { class: 'cbt-assist' }, [aSel, cSel, btn('Assist', function () {
        Play.rollTest({ label: 'Assist ' + ((find(assistTo) || {}).name || ''), charName: cSel.value, charVal: v[cSel.value], kind: 'assist', group: 'General', assistTo: assistTo });
      }, 'btn-small', { title: 'Before their test, the same kind of action as theirs: T1 -1, T2 +1, T3 +2 to their next test (it lapses after a turn)' })]) : null
    ].filter(Boolean)));
    if (!out) box.appendChild(el('div', { class: 'row wrap cbt-say' }, [trig, btn('Ready', function () {
      if (!trigger.trim()) { trig.focus(); return; }
      spend('act'); act({ type: 'ready', text: trigger.trim() }).then(function (ok) { if (ok) { trigger = ''; C.toast('Readied: it goes off as your reaction when the trigger happens.'); update(); } });
    }, 'btn-small', { title: 'Name a trigger and an action or maneuver: it happens as your reaction when the trigger does (ready it again each turn)' })]));
    var input = el('input', { type: 'text', class: 'grow', maxlength: 300, value: say, placeholder: 'Anything else: drink a potion, shove it toward the pit, run for the door', 'aria-label': 'Other action',
      oninput: function () { say = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') declare(); } });
    function declare() {
      var text = say.trim();
      if (!text) { input.focus(); return; }
      act({ type: 'declare', text: text, target: tAt ? tAt.id : '', targetName: tAt ? tAt.name : '' }).then(function (ok) { if (ok) { say = ''; C.toast('Sent to the Ref.'); update(); } });
    }
    box.appendChild(el('div', { class: 'row wrap cbt-say' }, [input, btn(tAt ? 'Send (at ' + tAt.name + ')' : 'Send', declare, '')]));
  }
  /* Show the fight: the whole card, or just its view while the player is typing in it. */
  function update(force) {
    renderSession();
    var box = $('play-combat');
    if (!box) return;
    var c = document.body.getAttribute('data-mode') === 'play' ? cur() : null;
    box.hidden = !c;
    if (!c) { box.innerHTML = ''; return; }
    var a = document.activeElement, typing = !force && a && box.contains(a) && a.tagName === 'INPUT' && a.type !== 'checkbox';
    var view = $('cbt-view'), acts = $('cbt-act');
    if (!view || !acts) {
      box.innerHTML = '';
      box.appendChild(el('h2', { text: 'Combat' }));
      view = el('div', { id: 'cbt-view' }); acts = el('div', { id: 'cbt-act' });
      box.appendChild(view); box.appendChild(acts);
      typing = false;
    }
    view.innerHTML = ''; renderView(view);
    if (!typing) { acts.innerHTML = ''; renderAct(acts); }
    var bar = $('cbt-target-bar');
    if (bar) bar.replaceWith(targetBar());
  }
  /* At the top of Attacks & spells: who the next attack or spell goes at. */
  function targetBar() {
    var c = cur();
    if (!c) return el('span', { id: 'cbt-target-bar', hidden: true });
    var opts = c.list.filter(alive), mine = me();
    var s = el('select', { 'aria-label': 'Target', onchange: function () { targets = this.value ? [this.value] : []; update(); } },
      [el('option', { value: '', text: 'No target' })].concat(opts.map(function (x) { return el('option', { value: x.id, text: x.name + (x === mine ? ' (you)' : x.kind === 'foe' ? '' : x.kind === 'pc' ? ' (crow)' : ' (ally)') + ' · ' + x.health }); })));
    s.value = find(targets[0]) ? targets[0] : '';
    var more = targets.slice(1).map(function (id) { var x = find(id); return x ? x.name : null; }).filter(Boolean);
    return el('div', { id: 'cbt-target-bar', class: 'row wrap cbt-target' }, [el('label', { class: 'field' }, ['In combat: target', s]),
      el('span', { class: 'fine grow', text: (more.length ? 'Also: ' + more.join(', ') + ' (for spells and attacks on several creatures). ' : '') + 'Attacks and spells go to the Ref with this target. Healing, wards, and blessings: target an ally or yourself.' + (rxnNext ? ' Your next attack is a reaction.' : '') })]);
  }

  window.CrowsCombat = { load: load, render: update, rolled: rolled, updated: updated, superseded: superseded, rollNote: rollNote,
    session: session, resting: resting, restSent: restSent, sendRest: sendRest,
    ground: ground, pickUp: pickUp, cantPickUp: cantPickUp, drop: drop,
    rollMods: rollMods, targetBar: targetBar, maneuver: function (name, target, text) { return cur() ? maneuver(name, target, text) : Promise.resolve(false); } };
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  // A crow that gets its record id later (a new crow, saved as a draft) starts being watched then.
  setInterval(function () { var id = charId(); if (id && (!fight || fight.charId !== id)) load(); }, 2000);
})();
