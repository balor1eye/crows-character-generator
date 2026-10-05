/*
 * Ref Screen: the Tabletop tab, a graphical tabletop for every mode of play (src/shared/table.js has the engine: grids, line of sight, fog of
 * war, and the canvas). Scenes are kept in state.vtt ({ scenes, cur, shown, clean }) with the campaign:
 *   - Dungeon: a map with walls and doors; crows see by their own light and the party's torches (fog in `vision` mode), the dungeon turn
 *     timer and End DT are on the strip above the map.
 *   - Battle map: tokens tied to the combat tracker (initiative, damage, healing, conditions), no fog unless wanted.
 *   - Overland: a hex map with the party's marker, hexes moved against the day's allowance, and hexes revealed as it travels.
 *   - Village: a plain map or board with pins for places and institutions and tokens for NPCs.
 * The Ref sees everything (fog is only a shade); "Player view" shows what the players see. Pressing Show to players publishes the scene with
 * the live fight (publicCombat in ref-combat.js): the fog as a mask, and only the tokens the party can see. Players move their own tokens
 * and ping with combat.act actions (vttAction).
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addCombatant = f('addCombatant'), addParty = f('addParty'), artFor = f('artFor'), blobUrl = f('blobUrl'), btn = f('btn'), byId = f('byId'),
      clockText = f('clockText'), customMaps = f('customMaps'), damage = f('damage'), dungeonEN = f('dungeonEN'), endDT = f('endDT'), feat = f('feat'),
      feed = f('feed'), heal = f('heal'), healthWord = f('healthWord'), liveChanged = f('liveChanged'), liveOn = f('liveOn'), log = f('log'), nextRound = f('nextRound'),
      pauseTimer = f('pauseTimer'), remainMs = f('remainMs'), render = f('render'), rollInitiative = f('rollInitiative'), save = f('save'), setCond = f('setCond'),
      setTab = f('setTab'), sizeOf = f('sizeOf'), startTimer = f('startTimer'), tabletop = f('tabletop'), travelCalc = f('travelCalc');
  var $ = A.$, el = A.el, S = A.S, toast = A.toast, plural = A.plural, ui = A.ui, clamp = A.clamp, REFD = window.REF;
  var state = A.state; A.share('state', function (v) { state = v; });
  var Tbl = window.CrowsTable;

  var KINDS = [['dungeon', 'Dungeon', 'A map with walls and doors; the crows see by their own light and what is lit (fog of war by line of sight).'],
    ['open', 'Battle map', 'An open map or room for a fight: no fog unless you turn it on.'],
    ['travel', 'Overland (hex)', 'A hex map for travel: the party’s marker, the day’s hexes, and hexes revealed as it goes.'],
    ['village', 'Village or town', 'A map or plain board with pins for places and institutions and tokens for people.'],
    ['blank', 'Blank board', 'An empty board for theater of the mind.']];
  var PRESETS = [['', 'No light'], ['5/5', 'Torch (5/5)'], ['10/10', 'Lantern (10/10)'], ['10/10c', 'Campfire (10/10)'], ['2/2', 'Candle (2/2)'], ['15/15', 'Large fire (15/15)']];
  var TOOLS = [['select', 'Select', 'Move tokens (drag), select, and pan (drag the board). Double-click a door to open or close it.'],
    ['measure', 'Measure', 'Drag to measure squares or hexes.'], ['ping', 'Ping', 'Click to point something out to everyone (Alt-click works in any tool).'],
    ['wall', 'Wall', 'Click points to draw walls that block sight and movement. Double-click or Esc to finish; Shift snaps to half squares.'],
    ['door', 'Door', 'Click both ends of a door (closed doors block sight and movement).'], ['window', 'Window', 'A window blocks movement but not sight.'],
    ['room', 'Room', 'Drag a rectangle to wall it in.'], ['eraser', 'Erase', 'Click a wall, door, or window to delete it.'],
    ['reveal', 'Reveal', 'Paint to reveal the map to the players.'], ['hide', 'Hide', 'Paint to hide the map again.'],
    ['rect-reveal', 'Reveal box', 'Drag a rectangle to reveal.'], ['poly-reveal', 'Reveal shape', 'Click corners, then double-click or Enter to reveal the shape.'],
    ['pin', 'Pin', 'Click to place a labeled pin (a place, a clue, a door to remember).']];
  var CARRIERS = ['pc', 'ally'];

  var U = ui.vtt = ui.vtt || { view: null, built: false, sel: null, mask: null, sig: '', art: {}, playerView: false, cols: 40, hurt: 1, spawn: 0 };
  
  function V() { return state.vtt; }
  function cur() { var v = V(); return v.scenes.filter(function (s) { return s.id === v.cur; })[0] || null; }
  function tok(sc, id) { return sc && id ? sc.tokens.filter(function (t) { return t.id === id; })[0] || null : null; }
  function pcOfTok(t) { return t && t.pcId ? state.party.filter(function (p) { return p.id === t.pcId; })[0] || null : null; }
  function combatant(t) {
    if (!t) return null;
    if (t.cid) return byId(t.cid);
    var p = pcOfTok(t);
    return p ? S().combat.list.filter(function (x) { return x.kind === 'pc' && x.pcId === p.id; })[0] || null : null;
  }
  function changed() { U.sig = ''; save(); }

  // ------------------------------------------------------------------ scenes
  function makeScene(kind, name) {
    var o = { name: name || (KINDS.filter(function (k) { return k[0] === kind; })[0] || ['', 'Scene'])[1], kind: kind };
    if (kind === 'dungeon') { o.fog = 'vision'; o.ambient = 'dark'; }
    else if (kind === 'travel') { o.fog = 'manual'; o.ambient = 'bright'; o.grid = 'hexp'; o.g = 110; o.w = 4000; o.h = 3000; }
    else if (kind === 'village') { o.fog = 'off'; o.ambient = 'bright'; o.grid = 'none'; o.bg = '#6b7a52'; }
    else if (kind === 'blank') { o.fog = 'off'; o.ambient = 'bright'; o.bg = '#3a3633'; }
    else { o.fog = 'off'; o.ambient = 'bright'; o.bg = '#4a5a3c'; }
    var sc = Tbl.newScene(o);
    sc.moved = 0; sc.pings = [];
    if (kind === 'travel') { sc.unit = 0; sc.showGrid = false; }   // the maps print their own hexes; ours is for snapping, distance, and reveal (turn it on in Scene settings to line it up)
    return sc;
  }
  function addScene(kind) {
    var sc = makeScene(kind, ''), n = V().scenes.filter(function (s) { return s.kind === kind; }).length;
    if (n) sc.name += ' ' + (n + 1);
    V().scenes.push(sc); V().cur = sc.id; U.sel = null;
    if (kind === 'travel' && REFD && REFD.ART && REFD.ART.maps.length) setMap(sc, { b: (REFD.ART.maps.filter(function (m) { return /cornath/i.test(m.title); })[0] || REFD.ART.maps[0]).variants[0].file });
    changed(); render();
  }
  function mapChoices() {
    var out = [['', 'No map (plain board)']];
    (REFD.ART.maps || []).forEach(function (m) { m.variants.forEach(function (v) { out.push(['b|' + v.file, m.title + (m.variants.length > 1 ? ' — ' + v.label : '')]); }); });
    customMaps().forEach(function (m) { out.push(['k|' + m.key, m.title + ' (mine)']); });
    return out;
  }
  function mapSrc(sc) {
    var m = sc && sc.map; if (!m) return null;
    if (m.b) return m.b;
    var rec = customMaps().filter(function (r) { return r.key === m.k; })[0];
    return rec ? blobUrl(rec) : null;
  }
  function artVariant(file) {
    var r = null;
    (REFD.ART.maps || []).forEach(function (m) { m.variants.forEach(function (v) { if (v.file === file) r = v; }); });
    return r;
  }
  /* Set a scene's map and size the scene to the picture (once it has loaded). */
  function setMap(sc, m) {
    sc.map = m;
    var src = mapSrc(sc);
    if (!m || !src) { changed(); return; }
    var img = new Image();
    var v = m.b ? artVariant(m.b) : null;   // official artwork knows its own squares across; otherwise use the Squares across setting
    img.onload = function () {
      sc.w = img.naturalWidth; sc.h = img.naturalHeight;
      if (v && v.cols) { sc.g = sc.w / v.cols; sc.grid = 'square'; sc.showGrid = !v.printed; U.cols = v.cols; }   // exact (fractional) squares so the grid meets the artwork's edges
      else sc.g = Math.max(10, Math.round(sc.w / (sc.kind === 'travel' ? 28 : U.cols)));
      sc.seen = ''; sc.seenDims = ''; sc.ox = sc.oy = 0; changed(); if (U.view) U.view.sceneChanged(sc.id + 'm'); render();
    };
    img.src = src;
    changed();
  }

  // ------------------------------------------------------------------ tokens
  function tsize(x) { return Tbl.SIZES[sizeOf(x)] || 1; }
  function condNames(x) { return Object.keys(x.conds || {}).filter(function (k) { return x.conds[k]; }); }
  /* Keep each token's name, health, conditions, and size in step with the tracker (or the crow). Foes and allies whose fight ended come off. */
  function syncTokens(sc) {
    if (V().clean) sc.tokens = sc.tokens.filter(function (t) { return !(t.cid && !byId(t.cid) && (t.kind === 'foe' || t.kind === 'ally')); });
    var round = S().combat.round;
    sc.tokens.forEach(function (t) {
      var p = pcOfTok(t), x = combatant(t);
      if (x) {
        t.name = x.name; t.dead = !!x.dead; t.conds = condNames(x); t.hpf = x.stMax ? x.st / x.stMax : null; t.hw = x.kind === 'pc' ? null : healthWord(x);
        t.size = t.sizeSet ? t.size : tsize(x); t.cref = x.cref || t.cref; t.acted = !!round && (x.kind === 'pc' ? x.done === round : x.acted === round); t.fighting = true;
      } else {
        t.fighting = false; t.acted = false;
        if (p) { t.name = p.name || t.name; t.hpf = p.stMax ? clamp(p.st / p.stMax, 0, 1) : null; }
      }
      if (p) t.link = p.link || null;
    });
  }
  function nextSpot(sc) {
    var c = U.view ? U.view.center() : { x: sc.w / 2, y: sc.h / 2 };
    var n = U.spawn++ % 12;
    return Tbl.snap(sc, c.x + (n % 4 - 1.5) * sc.g * 1.2, c.y + (Math.floor(n / 4) - 1) * sc.g * 1.2, 1);
  }
  function addToken(sc, o) {
    var p = nextSpot(sc), t = Object.assign({ id: Tbl.uid('k'), name: 'Token', kind: 'obj', x: p.x, y: p.y, size: 1, hidden: false, speed: 5 }, o);
    sc.tokens.push(t); U.sel = t.id; return t;
  }
  function addCrows(sc) {
    var added = 0;
    A.activePCs().forEach(function (p) {
      if (sc.tokens.some(function (t) { return t.pcId === p.id; })) return;
      addToken(sc, { name: p.name || 'Crow', kind: 'pc', pcId: p.id, sight: 1 }); added++;
    });
    toast(added ? 'Added ' + plural(added, 'crow') + '. Drag them into place.' : 'No active crows to add (see the Party tab).');
    changed(); render();
  }
  /* Put the tracker's creatures that aren't on this map on it. */
  function addTracker(sc) {
    var added = 0, list = S().combat.list;
    list.forEach(function (x) {
      if (x.kind === 'pc') { var p = pcOfTok({ pcId: x.pcId }); if (p && !sc.tokens.some(function (t) { return t.pcId === p.id; })) { addToken(sc, { name: x.name, kind: 'pc', pcId: p.id }); added++; } return; }
      if (sc.tokens.some(function (t) { return t.cid === x.id; })) return;
      addToken(sc, { name: x.name, kind: x.kind === 'ally' ? 'ally' : 'foe', cid: x.id, cref: x.cref, hidden: x.kind === 'foe' && !!U.hideNew }); added++;
    });
    toast(added ? 'Put ' + plural(added, 'token') + ' on the map.' : 'Everyone in the tracker is already on the map.');
    changed(); render();
  }
  function addCreature(sc, name, count, side, toTracker) {
    for (var i = 0; i < count; i++) {
      var before = S().combat.list.length;
      if (toTracker) addCombatant(name, 1, side);
      var x = toTracker ? S().combat.list[S().combat.list.length - 1] : null;
      if (toTracker && S().combat.list.length === before) continue;
      var same = sc.tokens.filter(function (t) { return t.cref === name; }).length;
      addToken(sc, { name: x ? x.name : name + ' ' + (same + 1), kind: side === 'ally' ? 'ally' : 'foe', cid: x ? x.id : null, cref: name, hidden: !x });
    }
    changed(); render();
  }
  function removeToken(sc, t) { sc.tokens = sc.tokens.filter(function (k) { return k !== t; }); if (U.sel === t.id) U.sel = null; changed(); render(); }
  function parsePreset(v) { if (!v) return null; var m = /^(\d+)\/(\d+)/.exec(v); return { b: +m[1], d: +m[2], on: true }; }
  function presetOf(t) { if (!t.light) return ''; var k = t.light.b + '/' + t.light.d; return PRESETS.some(function (p) { return p[0].replace('c', '') === k; }) ? (k === '10/10' ? (t.light.fire ? '10/10c' : '10/10') : k) : 'custom'; }

  // ------------------------------------------------------------------ what the players see
  function artKey(t) { return t.pcId ? 'p' + t.pcId : t.cref && !t.noArt && artFor(t.cref) ? 'c' + t.cref : null; }
  function artSrc(key) {
    if (!key) return null;
    if (U.art[key] !== undefined) return U.art[key];
    U.art[key] = null;
    if (key.charAt(0) === 'p') { var p = state.party.filter(function (q) { return 'p' + q.id === key; })[0]; U.art[key] = p && p.artSm || null; }
    else { var a = artFor(key.slice(1)); if (a && a.thumb) Tbl.tokenArt(a.thumb, function (d) { U.art[key] = d; if (U.view) U.view.redraw(); liveChanged(); }); }
    return U.art[key];
  }
  function tokenSrc(t) { return artSrc(artKey(t)); }
  /* The fog mask for this scene (worked out again only when something that affects it changed). */
  function maskFor(sc) {
    if (sc.fog === 'off') return null;
    var sig = [sc.id, sc.fog, sc.ambient, sc.w, sc.h, sc.g, sc.seen, JSON.stringify(sc.walls), JSON.stringify(sc.tokens.map(function (t) { return [t.id, t.x, t.y, t.kind, t.dead, t.hidden, t.light, t.sight, t.sees, t.size]; }))].join('|');
    if (sig === U.sig && U.mask) return U.mask;
    var m = Tbl.computeVision(sc);
    U.mask = m; U.sig = sig;
    if (m && m.grew) { m.grew = false; U.sig = ''; setTimeout(save, 0); }   // the explored memory grew: keep it with the campaign
    return m;
  }
  /* The scene as the players get it, or null. */
  function publicTable() {
    var v = V(), sc = cur();
    if (!v.shown || !sc) return null;
    syncTokens(sc);
    var m = maskFor(sc);
    var vis = sc.tokens.filter(function (t) {
      if (t.hidden) return false;
      var x = combatant(t); if (x && x.hidden && x.kind === 'foe') return false;
      if (sc.fog === 'off' || !m) return true;
      if (CARRIERS.indexOf(t.kind) >= 0) return true;
      var c = Tbl.maskAt(m, t.x, t.y);
      return t.kind === 'obj' && !t.light ? c >= 1 : c >= 2;
    });
    var art = {};
    var tokens = vis.map(function (t) {
      var o = { id: t.id, name: t.name, kind: t.kind, x: Math.round(t.x), y: Math.round(t.y), size: t.size || 1 };
      var cx = combatant(t); if (cx) o.cid = cx.id;
      if (t.link) o.link = t.link;
      if (t.pcId) o.hpf = t.hpf == null ? null : Math.round(t.hpf * 100) / 100;
      else if (t.hw) o.hpf = { 'unhurt': 1, 'armor dented': 1, 'hurt': .6, 'badly hurt': .3, 'down': 0, 'dead': 0 }[t.hw];
      if (t.dead) o.dead = true;
      if (t.acted) o.acted = true;
      if (t.conds && t.conds.length) o.conds = t.conds;
      if (t.icon) o.icon = t.icon;
      if (t.label) o.label = true;
      if (t.speed && t.pcId) o.speed = t.speed;
      var k = artKey(t), src = artSrc(k);
      if (src) { o.art = k; art[k] = src; }
      return o;
    });
    return { id: sc.id, name: sc.name, kind: sc.kind, w: sc.w, h: sc.h, g: sc.g, grid: sc.grid, ox: sc.ox, oy: sc.oy, bg: sc.bg, showGrid: sc.showGrid !== false, unit: sc.unit,
      map: sc.map ? (sc.map.b ? { b: sc.map.b } : { k: sc.map.k }) : null, fog: sc.fog === 'off' ? null : Tbl.packMask(m), tokens: tokens, art: art,
      pins: sc.pins.filter(function (p) { return p.vis; }).map(function (p) { return { id: p.id, x: Math.round(p.x), y: Math.round(p.y), label: p.label, vis: true }; }),
      pings: (sc.pings || []).slice(-5), move: sc.playerMove !== false, moved: sc.kind === 'travel' ? sc.moved || 0 : null };
  }
  // ------------------------------------------------------------------ moves
  /* A token moved by the Ref's hand (free) or a player's (blocked by walls). Returns false if it can't. */
  function moveToken(sc, t, x, y, byPlayer) {
    var from = { x: t.x, y: t.y }, to = { x: x, y: y };
    if (byPlayer && Tbl.pathBlocked(sc, from, to)) return false;
    var n = Tbl.dist(sc, from, to);
    t.x = x; t.y = y;
    if (sc.kind === 'travel' && t.kind === 'pc') {
      sc.moved = (sc.moved || 0) + n;
      if (sc.fog === 'manual') Tbl.paintSeen(sc, x, y, sc.g * ((sc.revealR == null ? 1 : sc.revealR) + .55), true);
    }
    changed();
    return n;
  }
  /* A player's action from their Play page (called by takeAction in ref-combat.js): a move or a ping. */
  function vttAction(p, a) {
    var sc = cur(); if (!sc || !V().shown) return;
    if (a.type === 'ping') {
      sc.pings = (sc.pings || []).concat([{ id: ++sc.pingId, x: clamp(+a.x || 0, 0, sc.w), y: clamp(+a.y || 0, 0, sc.h), by: p ? p.name : '' }]).slice(-5);
      if (U.view) U.view.ping(+a.x, +a.y, '#5ec4ff');
      changed(); return;
    }
    var t = tok(sc, a.token);
    if (!p || !t || t.pcId !== p.id || t.locked || sc.playerMove === false) return;
    var s = Tbl.snap(sc, clamp(+a.x || 0, 0, sc.w), clamp(+a.y || 0, 0, sc.h), t.size);
    var n = moveToken(sc, t, s.x, s.y, true);
    if (n === false) { feed('**' + (p.name || 'A crow') + '** can’t go that way: a wall is in the way.'); changed(); return; }
    var sp = t.speed || 0;
    if (S().combat.round && sp && n > sp) feed('**' + (p.name || 'A crow') + '** moves ' + plural(n, 'square') + ' (speed ' + sp + ').');
    changed(); if (U.view) U.view.clearGhost(t.id);
  }

  // ------------------------------------------------------------------ the view
  function build() {
    var host = el('div', { class: 'vtt-host', id: 'vtt-host' });
    U.view = Tbl.view(host, {
      ref: true,
      scene: cur,
      mask: function () { var sc = cur(); return sc ? maskFor(sc) : null; },
      mapSrc: mapSrc,
      tokenSrc: tokenSrc,
      canMove: function (t) { return !t.locked; },
      speedOf: function (t) { return t.speed || 0; },
      onSelect: function (t) { U.sel = t ? t.id : null; renderSide(); },
      onMove: function (t, x, y) { var sc = cur(); if (sc) { moveToken(sc, t, x, y, false); render(); } },
      onPing: function (x, y) { var sc = cur(); if (sc) { sc.pings = (sc.pings || []).concat([{ id: ++sc.pingId, x: x, y: y, by: 'Ref' }]).slice(-5); changed(); } },
      onWall: function (w) { var sc = cur(); sc.walls.push({ id: Tbl.uid('w'), a: w.a, b: w.b, t: w.t, open: false }); changed(); render(); },
      onErase: function (w) { var sc = cur(); sc.walls = sc.walls.filter(function (k) { return k !== w; }); changed(); render(); },
      onDoor: function (w) { w.open = !w.open; changed(); render(); },
      onRoom: function (r) {
        var sc = cur(), pts = [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]];
        for (var i = 0; i < 4; i++) sc.walls.push({ id: Tbl.uid('w'), a: pts[i], b: pts[(i + 1) % 4], t: 'wall', open: false });
        changed(); render();
      },
      onPaint: function (x, y, r, reveal) { var sc = cur(); if (sc && Tbl.paintSeen(sc, x, y, r, reveal)) { U.sig = ''; U.view.redraw(); clearTimeout(U.paintT); U.paintT = setTimeout(function () { changed(); render(); }, 300); } },
      onFogRect: function (pts, reveal) { var sc = cur(); if (sc) { Tbl.paintPoly(sc, pts, reveal); changed(); render(); } },
      onDrop: function (x, y) {
        var sc = cur(), label = prompt('Pin label', '');
        if (label === null) return;
        sc.pins.push({ id: Tbl.uid('p'), x: x, y: y, label: label.slice(0, 40), vis: false }); changed(); render();
      },
      onPin: function (p) {
        var sc = cur(), v = prompt('Pin label (empty to delete). It is shown to players once you add "+" at the start.', (p.vis ? '+' : '') + p.label);
        if (v === null) return;
        if (!v.trim()) sc.pins = sc.pins.filter(function (k) { return k !== p; }); else { p.vis = v.charAt(0) === '+'; p.label = v.replace(/^\+/, '').slice(0, 40); }
        changed(); render();
      },
      onKey: function (e) { var sc = cur(), t = sc && tok(sc, U.sel); if (t && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeToken(sc, t); } }
    });
    return host;
  }

  // ------------------------------------------------------------------ the tab
  function renderVtt() {
    var v = V(), sc = cur();
    if (!U.built) { U.host = build(); U.built = true; }
    if (sc) syncTokens(sc);
    var box = $('sec-vtt');
    // Keep the canvas where it is: only the bars around it are rebuilt.
    if (!box.contains(U.host)) { box.innerHTML = ''; U.bars = el('div', { class: 'vtt-bars' }); U.strip = el('div', { class: 'vtt-strip' }); box.appendChild(U.bars); box.appendChild(U.strip); box.appendChild(U.host); U.view.resize(); }
    renderBars(sc);
    renderStrip(sc);
    renderSide();
    U.view.player(U.playerView);
    U.view.sceneChanged(sc ? sc.id : null);
    U.view.select(U.sel);
    var again = U.view.hasSceneSize ? U.view : null; if (again) setTimeout(function () { U.view.resize(); }, 0);
  }
  function seg(options, value, onpick, label) {
    return el('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(function (o) {
      return el('button', { type: 'button', class: value === o[0] ? 'on' : '', 'aria-pressed': value === o[0] ? 'true' : 'false', title: o[2] || null, text: o[1], onclick: function () { onpick(o[0]); } });
    }));
  }
  function renderBars(sc) {
    var v = V(), bars = U.bars; bars.innerHTML = '';
    var sel = el('select', { class: 'in', 'aria-label': 'Scene', onchange: function () { v.cur = this.value; U.sel = null; U.sig = ''; U.mask = null; save(); render(); } },
      v.scenes.map(function (s) { return el('option', { value: s.id, text: s.name + ' · ' + (KINDS.filter(function (k) { return k[0] === s.kind; })[0] || ['', ''])[1] }); }));
    sel.value = v.cur;
    var add = el('select', { class: 'in', 'aria-label': 'New scene', onchange: function () { if (this.value) addScene(this.value); this.value = ''; } },
      [el('option', { value: '', text: '+ New scene…' })].concat(KINDS.map(function (k) { return el('option', { value: k[0], text: k[1], title: k[2] }); })));
    var online = !tabletop() && feat('live') && window.CrowsCloud && window.CrowsCloud.recordId;
    var shown = btn(v.shown ? 'Shown to players' : 'Show to players', function () { v.shown = !v.shown; log('', v.shown ? 'The tabletop is shown to the players.' : 'The tabletop is hidden from the players.'); changed(); render(); },
      'btn-small' + (v.shown ? ' btn-primary' : ''), online ? (v.shown ? 'Players see the map (with fog of war) on their Play pages, Table tab. Click to hide it.' : 'Share this scene with the players’ Play pages (Table tab).') : 'Needs the accounts site and a campaign (and Tabletop Mode off): otherwise use Player view and a shared screen.');
    bars.appendChild(el('div', { class: 'row center vtt-top' }, [sc ? sel : null, add, el('span', { class: 'spacer' }),
      sc ? btn(U.playerView ? 'Ref view' : 'Player view', function () { U.playerView = !U.playerView; render(); }, 'btn-small' + (U.playerView ? ' btn-primary' : ''), 'See exactly what the players see: fog at full strength and your hidden tokens gone. Good for a shared screen.') : null,
      sc ? btn('Fullscreen', function () { var h = U.host; if (document.fullscreenElement) document.exitFullscreen(); else if (h.requestFullscreen) h.requestFullscreen(); }, 'btn-small btn-ghost') : null,
      sc ? shown : null, sc && online && v.shown ? el('span', { class: 'fine', text: 'Live' }) : null]));
    if (!sc) { bars.appendChild(el('p', { class: 'hint', text: 'Make a scene to start: a Dungeon (walls, doors, and fog of war), a Battle map, an Overland hex map for travel, a Village, or a Blank board. Add tokens for the crows and creatures, and run the whole game on it.' })); return; }
    var tools = TOOLS.filter(function (t) { return !(sc.kind === 'travel' && /^(wall|door|window|room)$/.test(t[0])) && !(/^(reveal|hide|rect-reveal|poly-reveal)$/.test(t[0]) && sc.fog === 'off'); });
    var cur_ = U.view.getTool();
    if (!tools.some(function (t) { return t[0] === cur_; })) U.view.tool('select');
    bars.appendChild(el('div', { class: 'row center vtt-tools' }, [seg(tools, U.view.getTool(), function (t) { U.view.tool(t); renderBars(sc); }, 'Tools'),
      /^(reveal|hide)$/.test(U.view.getTool()) ? el('label', { class: 'field inline' }, ['Brush ', el('select', { class: 'in', onchange: function () { U.brush = +this.value; U.view.brush(U.brush); } },
        [.5, 1, 2, 3, 5].map(function (n) { return el('option', { value: n, text: n + ' sq', selected: (U.brush || 1) === n ? true : null }); }))]) : null,
      btn('Fit', function () { U.view.fit(); }, 'btn-small btn-ghost'), btn('+', function () { U.view.zoom(1.25); }, 'btn-small btn-ghost'), btn('−', function () { U.view.zoom(.8); }, 'btn-small btn-ghost'),
      el('span', { class: 'fine', text: (TOOLS.filter(function (t) { return t[0] === U.view.getTool(); })[0] || [])[2] || '' })]));
  }
  function renderStrip(sc) {
    var s = U.strip, ss = S(); s.innerHTML = ''; if (!sc) return;
    var c = ss.combat, kids = [];
    if (sc.kind === 'dungeon' || sc.kind === 'open') {
      var running = ss.running && ss.mode === 'timer';
      kids.push(el('span', { class: 'chip accent', text: (ss.rest.active ? 'Resting · ' : '') + 'DT ' + ss.dt }),
        ss.mode === 'timer' ? el('span', { class: 'chip', 'data-clock-vtt': '1', text: clockText(remainMs()) }) : el('span', { class: 'chip', text: Math.max(0, (ss.rooms || 0) - (ss.roomsDone || 0)) + ' rooms left' }),
        ss.mode === 'timer' ? btn(running ? 'Pause' : 'Start', function () { if (running) pauseTimer(); else startTimer(); }, 'btn-small') : btn('+1 room', function () { ss.roomsDone++; save(); render(); }, 'btn-small'),
        btn('End DT', endDT, 'btn-small', 'Roll usage dice (lights burn down), end DT conditions, make the encounter check'),
        el('span', { class: 'fine', text: 'EN ' + dungeonEN() }),
        ss.pending ? el('span', { class: 'chip warn', text: 'Encounter due this DT' }) : null);
    }
    if (sc.kind === 'travel') {
      var calc = travelCalc(), over = (sc.moved || 0) > calc.hex;
      kids.push(el('span', { class: 'chip accent', text: 'Travel day ' + A.state.travel.day }), el('span', { class: 'chip' + (over ? ' warn' : ''), text: (sc.moved || 0) + ' of ' + plural(calc.hex, 'hex') + ' today' }),
        btn('New day', function () { sc.moved = 0; changed(); render(); }, 'btn-small', 'Reset the hexes moved today'), btn('Travel tab', function () { setTab('travel'); }, 'btn-small btn-ghost'),
        el('span', { class: 'fine', text: 'Reveals ' + (sc.revealR == null ? 1 : sc.revealR) + ' hex around the marker as it moves.' }));
    }
    if (sc.kind === 'village') {
      kids.push(el('span', { class: 'chip accent', text: state.village.name || 'Village' }), el('span', { class: 'chip', text: 'Prosperity ' + state.village.prosperity }),
        btn('Institutions as pins', function () {
          var n = 0; state.village.inst.forEach(function (i) { if (!sc.pins.some(function (p) { return p.label === i.type; })) { var p = nextSpot(sc); sc.pins.push({ id: Tbl.uid('p'), x: p.x, y: p.y, label: i.type, vis: true }); n++; } });
          toast(n ? 'Added ' + plural(n, 'pin') + ': drag… (pins stay where placed: use the Pin tool to add more).' : 'Already pinned.'); changed(); render();
        }, 'btn-small'), btn('Village tab', function () { setTab('village'); }, 'btn-small btn-ghost'));
    }
    if (c.list.length || sc.kind !== 'travel') {
      kids.push(el('span', { class: 'spacer' }));
      if (c.round) kids.push(el('span', { class: 'chip accent', text: 'Round ' + c.round + (c.first ? ' · ' + (c.first === 'crows' ? 'crows first' : 'enemies first') : '') }), btn('Next round', function () { nextRound(); }, 'btn-small'));
      else if (c.list.length) kids.push(btn('Roll initiative', function () { rollInitiative(); }, 'btn-small btn-primary', 'Start the fight: 1d10, 6+ and the crows act first'));
    }
    s.appendChild(el('div', { class: 'row center' }, kids));
  }

  // ------------------------------------------------------------------ the side panel
  function numIn(obj, key, min, max, onchange, w) {
    var n = el('input', { type: 'number', class: 'tiny', min: min, max: max, value: obj[key] == null ? '' : obj[key], style: w ? 'width:' + w : null });
    n.addEventListener('change', function () { var v = parseFloat(this.value); obj[key] = isNaN(v) ? null : clamp(v, min, max); changed(); if (onchange) onchange(); render(); });
    return n;
  }
  function checkIn(obj, key, label, title) {
    return el('label', { class: 'check', title: title || null }, [el('input', { type: 'checkbox', checked: !!obj[key], onchange: function () { obj[key] = this.checked; changed(); render(); } }), ' ' + label]);
  }
  function renderSide() {
    var box = $('sec-vtt-side'), sc = cur(); box.innerHTML = '';
    if (!sc) { box.appendChild(el('h2', { text: 'Tabletop' })); box.appendChild(el('p', { class: 'fine', text: 'Pick a scene type above.' })); return; }
    var t = tok(sc, U.sel);
    box.appendChild(el('h2', null, ['Tokens', el('small', { text: plural(sc.tokens.length, 'token') })]));
    box.appendChild(el('div', { class: 'vtt-add' }, [
      btn('Crows', function () { addCrows(sc); }, 'btn-small', 'Put every active crow on the map'),
      sc.kind !== 'travel' && !tabletop() ? btn('Tracker', function () { addTracker(sc); }, 'btn-small', 'Put everyone in the combat tracker on the map') : null,
      btn('Party marker', function () {
        if (sc.tokens.some(function (k) { return k.marker; })) { toast('The party marker is already on the map.'); return; }
        addToken(sc, { name: 'The party', kind: 'pc', marker: true, speed: 0 }); changed(); render();
      }, 'btn-small', 'One token for the whole party (overland travel)'),
      btn('Light', function () { addToken(sc, { name: 'Torch', kind: 'obj', light: parsePreset('5/5'), icon: '✶', hidden: false }); changed(); render(); }, 'btn-small', 'A torch or lantern left on the map'),
      btn('Marker', function () { addToken(sc, { name: 'Marker', kind: 'obj', label: true }); changed(); render(); }, 'btn-small', 'A labeled marker: a door, a trap, a body')]));
    var cs = el('select', { class: 'in', 'aria-label': 'Creature' }, REFD.BESTIARY.map(function (b) { return el('option', { value: b.n, text: b.n }); })), cnt = el('input', { type: 'number', class: 'tiny', value: 1, min: 1, max: 20, 'aria-label': 'How many' });
    var side = el('select', { class: 'in', 'aria-label': 'Side' }, [el('option', { value: 'foe', text: 'Foe' }), el('option', { value: 'ally', text: 'Ally' })]);
    var trk = el('input', { type: 'checkbox', checked: !tabletop() }), hid = el('input', { type: 'checkbox', checked: !!U.hideNew, onchange: function () { U.hideNew = this.checked; } });
    box.appendChild(el('div', { class: 'vtt-add2' }, [el('label', { class: 'field' }, ['Add a creature', cs]), el('div', { class: 'row center' }, [cnt, side, btn('Add', function () { addCreature(sc, cs.value, clamp(parseInt(cnt.value, 10) || 1, 1, 20), side.value, trk.checked); }, 'btn-small btn-primary')]),
      el('label', { class: 'check', title: 'Also puts it in the combat tracker (and starts the players’ fight view). Otherwise it is only a hidden token.' }, [trk, ' Add to the combat tracker']),
      el('label', { class: 'check', title: 'New foes from the tracker start hidden from the players (still seen by you), so you can place them first.' }, [hid, ' Tracker foes start hidden'])]));
    if (state.npcs.length) {
      var ns = el('select', { class: 'in', 'aria-label': 'NPC' }, state.npcs.map(function (n, i) { return el('option', { value: i, text: n.name || 'NPC ' + (i + 1) }); }));
      box.appendChild(el('div', { class: 'row center' }, [ns, btn('Add NPC', function () { var n = state.npcs[+ns.value]; addToken(sc, { name: n.name || 'NPC', kind: 'npc' }); changed(); render(); }, 'btn-small')]));
    }
    // the token list
    box.appendChild(el('div', { class: 'vtt-list' }, sc.tokens.map(function (k) {
      return el('button', { type: 'button', class: 'chip vtt-chip k-' + k.kind + (k.id === U.sel ? ' sel' : '') + (k.hidden ? ' hid' : '') + (k.dead ? ' dead' : ''), title: 'Select and find ' + k.name,
        text: (k.hidden ? '◌ ' : '') + k.name, onclick: function () { U.sel = k.id; U.view.centerOn(k.x, k.y); renderSide(); U.view.select(k.id); } });
    })));
    if (t) box.appendChild(inspector(sc, t));
    box.appendChild(sceneSettings(sc));
  }
  function inspector(sc, t) {
    var x = combatant(t), p = pcOfTok(t), name = el('input', { type: 'text', class: 'in', value: t.name, 'aria-label': 'Name', maxlength: 40, disabled: t.fighting ? true : null });
    name.addEventListener('change', function () { t.name = this.value.slice(0, 40); changed(); render(); });
    var szSel = el('select', { class: 'in', 'aria-label': 'Size', onchange: function () { t.size = +this.value; t.sizeSet = true; changed(); render(); } },
      [[.5, 'Tiny'], [1, 'Small / Medium'], [2, 'Large'], [3, 'Huge'], [4, 'Gigantic']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: (t.size || 1) === o[0] ? true : null }); }));
    var kids = [el('h3', { text: 'Selected: ' + t.name }), el('div', { class: 'row' }, [el('label', { class: 'field grow' }, ['Name', name]), el('label', { class: 'field' }, ['Size', szSel])]),
      el('div', { class: 'checks' }, [checkIn(t, 'hidden', 'Hidden from players', 'Players never see this token (a creature waiting in ambush)'), checkIn(t, 'locked', 'Locked', 'Can’t be dragged'),
        CARRIERS.indexOf(t.kind) >= 0 ? checkIn(t, 'sees', 'Gives the party sight', 'Off: this token doesn’t see for the party (a blinded crow).') : null,
        t.kind !== 'obj' ? null : checkIn(t, 'label', 'Show its name')])];
    // vision and light
    var lightSel = el('select', { class: 'in', 'aria-label': 'Light', onchange: function () { var v = this.value; t.light = v === 'custom' ? t.light || { b: 3, d: 3, on: true } : parsePreset(v.replace('c', '')); if (v === '10/10c' && t.light) t.light.fire = true; changed(); render(); } },
      PRESETS.concat([['custom', 'Custom…']]).map(function (o) { return el('option', { value: o[0], text: o[1], selected: presetOf(t) === o[0] ? true : null }); }));
    kids.push(el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Light it gives', lightSel]),
      t.light ? checkIn(t.light, 'on', 'Lit', 'Lights go out when unticked (a torch burned down: usage dice end each dungeon turn)') : null,
      t.light && presetOf(t) === 'custom' ? el('span', { class: 'row center' }, ['bright ', numIn(t.light, 'b', 0, 30), ' dim ', numIn(t.light, 'd', 0, 30)]) : null]));
    if (CARRIERS.indexOf(t.kind) >= 0) kids.push(el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Own sight (squares)', numIn(t, 'sight', 0, 30, null)]), el('label', { class: 'field' }, ['Speed', numIn(t, 'speed', 0, 30)]),
      el('span', { class: 'fine', text: 'Own sight: how far it sees with no light (Dark Senses: 10+). Speed shows the move range while dragging.' })]));
    else if (t.kind === 'foe') kids.push(el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Speed', numIn(t, 'speed', 0, 30)])]));
    if (x) {
      var amt = { n: U.hurt || 1 }, nIn = numIn(amt, 'n', 1, 999, function () { U.hurt = amt.n; });
      kids.push(el('div', { class: 'vtt-vitals' }, [el('div', { class: 'row center' }, [el('b', { text: 'Stamina ' + x.st + '/' + x.stMax }), el('span', { text: 'AD ' + x.ad + '/' + x.adMax }), x.wounds ? el('span', { class: 'chip warn', text: plural(x.wounds, 'wound') }) : null,
        x.dead ? el('span', { class: 'chip', text: 'dead' }) : null]),
        el('div', { class: 'row center' }, [nIn, btn('Hurt', function () { damage(x, Math.max(1, amt.n), false); }, 'btn-small', 'Deal this damage (AD first, then Stamina, then wounds)'), btn('Piercing', function () { damage(x, Math.max(1, amt.n), true); }, 'btn-small'),
          btn('Heal', function () { heal(x, Math.max(1, amt.n)); }, 'btn-small')]),
        el('div', { class: 'conds' }, ['Prone', 'Grabbed', 'Vulnerable', 'Weakened', 'Blessed', 'Unconscious'].map(function (k) {
          var on = !!(x.conds && x.conds[k]);
          return el('button', { type: 'button', class: 'cond' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', text: k, onclick: function () { setCond(x, k, !on); save(); render(); } });
        })), (x.kind !== 'pc' && S().combat.round) ? btn(x.acted === S().combat.round ? 'Acted this round ✓' : 'Mark acted', function () { x.acted = x.acted === S().combat.round ? 0 : S().combat.round; save(); render(); }, 'btn-small') : null]));
    } else if (t.kind === 'foe' || t.kind === 'ally') {
      kids.push(btn('Add to the combat tracker', function () {
        if (!t.cref) { toast('This token has no creature to add.'); return; }
        var before = S().combat.list.length; addCombatant(t.cref, 1, t.kind === 'ally' ? 'ally' : 'foe');
        if (S().combat.list.length > before) { t.cid = S().combat.list[S().combat.list.length - 1].id; t.name = S().combat.list[S().combat.list.length - 1].name; changed(); render(); }
      }, 'btn-small'));
    }
    kids.push(el('div', { class: 'row' }, [btn('Duplicate', function () { var c2 = JSON.parse(JSON.stringify(t)); c2.id = Tbl.uid('k'); c2.cid = null; c2.pcId = null; c2.link = null; c2.x += sc.g; sc.tokens.push(c2); U.sel = c2.id; changed(); render(); }, 'btn-small btn-ghost'),
      btn('Remove', function () { removeToken(sc, t); }, 'btn-small btn-ghost')]));
    return el('div', { class: 'vtt-insp' }, kids);
  }
  function sceneSettings(sc) {
    var name = el('input', { type: 'text', class: 'in', value: sc.name, maxlength: 60, 'aria-label': 'Scene name' }); name.addEventListener('change', function () { sc.name = this.value.slice(0, 60) || 'Scene'; changed(); render(); });
    var mapSel = el('select', { class: 'in', 'aria-label': 'Map', onchange: function () {
      var v = this.value, m = !v ? null : v.charAt(0) === 'b' ? { b: v.slice(2) } : { k: v.slice(2) };
      if (!m) { sc.map = null; changed(); render(); } else setMap(sc, m);
    } }, mapChoices().map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    mapSel.value = sc.map ? (sc.map.b ? 'b|' + sc.map.b : 'k|' + sc.map.k) : '';
    var cols = { n: Math.round(sc.w / sc.g) };
    var colsIn = el('input', { type: 'number', class: 'tiny', min: 4, max: 400, value: cols.n, 'aria-label': 'Squares across' });
    colsIn.addEventListener('change', function () { var n = clamp(parseInt(this.value, 10) || 40, 4, 400); U.cols = n; sc.g = Math.max(10, sc.w / n); sc.seen = ''; sc.seenDims = ''; changed(); render(); });
    var grid = el('select', { class: 'in', 'aria-label': 'Grid', onchange: function () { sc.grid = this.value; sc.seen = ''; sc.seenDims = ''; changed(); render(); } },
      [['square', 'Square grid'], ['hexp', 'Hexes (pointy top)'], ['hexf', 'Hexes (flat top)'], ['none', 'No grid']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: sc.grid === o[0] ? true : null }); }));
    var bg = el('input', { type: 'color', value: sc.bg || '#2a2622', 'aria-label': 'Board color' }); bg.addEventListener('input', function () { sc.bg = this.value; U.view.redraw(); }); bg.addEventListener('change', function () { changed(); });
    var fog = el('select', { class: 'in', 'aria-label': 'Fog of war', onchange: function () { sc.fog = this.value; changed(); render(); } },
      [['off', 'Fog of war: off'], ['vision', 'Fog: line of sight and light'], ['manual', 'Fog: I reveal by hand']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: sc.fog === o[0] ? true : null }); }));
    var amb = el('select', { class: 'in', 'aria-label': 'Ambient light', onchange: function () { sc.ambient = this.value; changed(); render(); } },
      [['bright', 'Ambient light: bright'], ['dim', 'Ambient light: dim'], ['dark', 'Ambient light: dark']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: sc.ambient === o[0] ? true : null }); }));
    var nudge = el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'Grid offset' }), numIn(sc, 'ox', -400, 400, function () { sc.seen = ''; }), numIn(sc, 'oy', -400, 400, function () { sc.seen = ''; }),
      sc.kind === 'travel' ? el('label', { class: 'field inline' }, ['Reveal radius (hexes)', numIn(sc, 'revealR', 0, 5)]) : null]);
    return el('details', { class: 'more vtt-settings', open: U.settingsOpen || null, ontoggle: function () { U.settingsOpen = this.open; } }, [el('summary', { text: 'Scene settings' }),
      el('label', { class: 'field' }, ['Name', name]), el('label', { class: 'field' }, ['Map', mapSel]),
      el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Squares across', colsIn]), el('label', { class: 'field grow' }, ['Grid', grid]), el('label', { class: 'field' }, ['Board', bg])]),
      nudge,
      el('div', { class: 'checks' }, [checkIn(sc, 'showGrid', 'Show the grid'), checkIn(sc, 'playerMove', 'Players move their own tokens', 'Their drops arrive as moves you can see; walls stop them.')]),
      sc.kind === 'travel' ? null : el('label', { class: 'field' }, ['Feet per square', numIn(sc, 'unit', 0, 100)]),
      el('div', { class: 'row' }, [el('label', { class: 'field grow' }, ['Fog', fog]), el('label', { class: 'field grow' }, ['Light', amb])]),
      el('div', { class: 'row' }, [btn('Reveal all', function () { Tbl.fillSeen(sc, true); changed(); render(); }, 'btn-small'), btn('Hide all', function () { Tbl.fillSeen(sc, false); changed(); render(); }, 'btn-small'),
        sc.walls.length ? btn('Undo wall', function () { sc.walls.pop(); changed(); render(); }, 'btn-small btn-ghost') : null,
        sc.walls.length ? btn('Clear walls', function () { if (confirm('Delete all ' + sc.walls.length + ' walls and doors on this scene?')) { sc.walls = []; changed(); render(); } }, 'btn-small btn-ghost') : null]),
      checkIn(V(), 'clean', 'Remove foes’ tokens when they leave the tracker'),
      el('div', { class: 'row' }, [btn('Duplicate scene', function () { var c2 = JSON.parse(JSON.stringify(sc)); c2.id = Tbl.uid('s'); c2.name += ' (copy)'; V().scenes.push(c2); V().cur = c2.id; changed(); render(); }, 'btn-small btn-ghost'),
        btn('Delete scene', function () { if (confirm('Delete the scene "' + sc.name + '"?')) { V().scenes = V().scenes.filter(function (k) { return k !== sc; }); V().cur = V().scenes[0] ? V().scenes[0].id : ''; U.sel = null; changed(); render(); } }, 'btn-small btn-ghost')])
    ]);
  }

  // Redraw when the tracker, party, or clock change: render() calls renderVtt for the open tab; the clock chip is kept current here.
  setInterval(function () {
    if (document.body.getAttribute('data-tab') !== 'vtt') return;
    var c = document.querySelector('[data-clock-vtt]'); if (c) c.textContent = clockText(remainMs());
  }, 500);

  A.add({ renderVtt: renderVtt, vttAction: vttAction, publicTable: publicTable });
})();
