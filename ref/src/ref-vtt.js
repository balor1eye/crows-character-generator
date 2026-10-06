/*
 * Ref Screen: the Tabletop tab, a graphical tabletop for every mode of play (src/shared/table.js has the engine: grids, line of sight, fog of
 * war, and the canvas). Scenes are kept in state.vtt ({ scenes, cur, shown, clean }) with the campaign:
 *   - Dungeon: a map with walls and doors; crows see by their own light and the party's torches (fog in `vision` mode), the dungeon turn
 *     timer and End DT are on the strip above the map.
 *   - Battle map: tokens tied to the combat tracker (initiative, damage, healing, conditions), no fog unless wanted. The Add drawer puts the session's
 *     crows on it (and in the tracker), and runs the current or a saved encounter onto it.
 *   - Overland: a hex map with the party's marker, hexes moved against the day's allowance, and hexes revealed as it travels.
 *   - Village: a plain map or board with pins for places and institutions and tokens for NPCs.
 * The map fills the tab and its controls float on it (see "the view" below); the engine animates moves, hits, and the fog.
 * The Ref sees everything (fog is only a shade); "Player view" shows what the players see. Pressing Show to players publishes the scene with
 * the live fight (publicCombat in ref-combat.js): the fog as a mask, and only the tokens the party can see. Players move their own tokens
 * and ping with combat.act actions (vttAction).
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addCombatant = f('addCombatant'), addParty = f('addParty'), artFor = f('artFor'), beast = f('beast'), blobUrl = f('blobUrl'), btn = f('btn'), byId = f('byId'),
      fxItems = f('fxItems'), monsterExperts = f('monsterExperts'), fxText = f('fxText'), hitControls = f('hitControls'), rich = f('rich'), slotsOf = f('slotsOf'), surprised = f('surprised'), tauntOn = f('tauntOn'),
      undoAct = f('undoAct'),
      clockText = f('clockText'), customMaps = f('customMaps'), damage = f('damage'), dungeonEN = f('dungeonEN'), encSummary = f('encSummary'), endDT = f('endDT'), feat = f('feat'),
      feed = f('feed'), heal = f('heal'), healthWord = f('healthWord'), liveChanged = f('liveChanged'), liveOn = f('liveOn'), log = f('log'), nextRound = f('nextRound'),
      pauseTimer = f('pauseTimer'), pendingEnc = f('pendingEnc'), remainMs = f('remainMs'), render = f('render'), rollInitiative = f('rollInitiative'), runEncounter = f('runEncounter'),
      runningEnc = f('runningEnc'), save = f('save'), setCond = f('setCond'),
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
  // [id, name, what it does, hotkey, group]: the palette down the map's left side
  var TOOLS = [['select', 'Select', 'Move tokens (drag), select, and pan (drag the board). Right-click a token for its details; double-click a door to open or close it.', 'v', 'play'],
    ['measure', 'Measure', 'Drag to measure squares or hexes.', 'm', 'play'], ['ping', 'Ping', 'Click to point something out to everyone (Alt-click works in any tool).', 'p', 'play'],
    ['wall', 'Wall', 'Click points to draw walls that block sight and movement. Double-click or Esc to finish; Shift snaps to half squares.', 'w', 'walls'],
    ['door', 'Door', 'Click both ends of a door (closed doors block sight and movement).', 'd', 'walls'], ['window', 'Window', 'A window blocks movement but not sight.', 'n', 'walls'],
    ['room', 'Room', 'Drag a rectangle to wall it in.', 'r', 'walls'], ['eraser', 'Erase', 'Click a wall, door, or window to delete it.', 'e', 'walls'],
    ['reveal', 'Reveal', 'Paint to reveal the map to the players.', 'f', 'fog'], ['hide', 'Hide', 'Paint to hide the map again.', 'g', 'fog'],
    ['rect-reveal', 'Reveal box', 'Drag a rectangle to reveal.', 'b', 'fog'], ['poly-reveal', 'Reveal shape', 'Click corners, then double-click or Enter to reveal the shape.', 'y', 'fog'],
    ['pin', 'Pin', 'Click to place a labeled pin (a place, a clue, a door to remember).', 'i', 'pins']];
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
  // ------------------------------------------------------------------ grid detection for uploaded maps
  /* Find a repeating line spacing in an edge profile (one value per pixel column or row): { p, phase, z } or null. Folds the profile at each
     candidate period and scores how sharply one phase stands out; the smallest period that scores nearly as well as the best wins, so the
     squares are found rather than blocks of several. */
  function profilePeriod(prof, minP, maxP) {
    var n = prof.length, mean = 0, sd = 0, i;
    for (i = 0; i < n; i++) mean += prof[i]; mean /= n;
    for (i = 0; i < n; i++) sd += (prof[i] - mean) * (prof[i] - mean); sd = Math.sqrt(sd / n);
    if (!sd) return null;
    var cands = [], best = 0;
    for (var p = minP; p <= maxP; p *= 1.004) {
      var nb = Math.max(4, Math.floor(p)), sum = new Float64Array(nb), cnt = new Float64Array(nb);
      for (i = 0; i < n; i++) { var b = Math.floor((i % p) / p * nb); sum[b] += prof[i]; cnt[b]++; }
      var top = -1e9, at = 0;
      for (var k = 0; k < nb; k++) {
        var m = (sum[k] + sum[(k + 1) % nb] + sum[(k + nb - 1) % nb]) / Math.max(1, cnt[k] + cnt[(k + 1) % nb] + cnt[(k + nb - 1) % nb]);
        if (m > top) { top = m; at = k; }
      }
      var z = (top - mean) / sd * Math.sqrt(n / p) / 3;   // a sharp line at one phase in many cells counts for more than in few
      cands.push({ p: p, phase: (at + .5) / nb * p, z: z }); if (z > best) best = z;
    }
    if (best < 1.2) return null;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.z < best * .8) continue;
      var j = i; for (var q = i + 1; q < cands.length && cands[q].p < c.p * 1.02; q++) if (cands[q].z > cands[j].z) j = q;   // the peak of this cluster
      return cands[j];
    }
    return null;
  }
  /* Detect the printed square grid of a map picture: { g, ox, oy } in picture pixels, or null when no grid shows. */
  function detectGrid(img) {
    var s = Math.min(1, 1600 / img.naturalWidth), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
    var d; try { d = cx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    var gray = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var o = (y * w + x) * 4; gray[y * w + x] = .3 * d[o] + .59 * d[o + 1] + .11 * d[o + 2]; }
    var cp = new Float64Array(w), rp = new Float64Array(h);
    for (y = 0; y < h - 1; y++) for (x = 0; x < w - 1; x++) {
      var v = gray[y * w + x];
      cp[x] += Math.abs(gray[y * w + x + 1] - v); rp[y] += Math.abs(gray[(y + 1) * w + x] - v);
    }
    function flat(a) {   // remove the slow trend so only line-like spikes remain
      var out = new Float64Array(a.length), W = 12, i;
      for (i = 0; i < a.length; i++) { var lo = Math.max(0, i - W), hi = Math.min(a.length - 1, i + W), sm = 0; for (var j = lo; j <= hi; j++) sm += a[j]; out[i] = a[i] - sm / (hi - lo + 1); }
      return out;
    }
    var minP = Math.max(10 * s, 8), maxP = Math.min(w, h) / 3;
    var X = profilePeriod(flat(cp), minP, maxP), Y = profilePeriod(flat(rp), minP, maxP), r;
    if (X && Y && Math.abs(X.p - Y.p) / X.p < .04) r = { p: (X.p + Y.p) / 2, ox: X.phase, oy: Y.phase };
    else if (X && !Y && X.z > 2.5) r = { p: X.p, ox: X.phase, oy: 0 };
    else if (Y && !X && Y.z > 2.5) r = { p: Y.p, ox: 0, oy: Y.phase };
    else return null;
    var g = r.p / s;
    return { g: g, ox: (r.ox / s) % g, oy: (r.oy / s) % g };
  }
  /* "42x65" in a file name: squares across and down. */
  function sizeFromName(title) {
    var m = /(\d{2,3})\s*[x×]\s*(\d{2,3})/i.exec(title || '');
    return m ? { cols: +m[1], rows: +m[2] } : null;
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
      else {
        var rec = m.k ? customMaps().filter(function (r) { return r.key === m.k; })[0] : null, nm = rec ? sizeFromName(rec.title) : null, dg = rec && sc.kind !== 'travel' ? detectGrid(img) : null;
        sc.ox = sc.oy = 0;
        if (dg && sc.w / dg.g >= 4 && sc.w / dg.g <= 400) { sc.g = dg.g; sc.grid = 'square'; sc.showGrid = false; sc.ox = dg.ox; sc.oy = dg.oy; U.cols = Math.round(sc.w / dg.g); toast('Found a grid of ' + Math.round(sc.w / dg.g) + ' squares across; adjust it in Scene settings if it is off.'); }   // the picture draws its own grid: ours only snaps
        else if (nm && nm.cols >= 4 && nm.cols <= 400) { sc.g = sc.w / nm.cols; sc.grid = 'square'; U.cols = nm.cols; }
        else sc.g = Math.max(10, Math.round(sc.w / (sc.kind === 'travel' ? 28 : U.cols)));
      }
      sc.seen = ''; sc.seenDims = ''; changed(); if (U.view) U.view.sceneChanged(sc.id + 'm'); render();
    };
    img.src = src;
    changed();
  }

  // ------------------------------------------------------------------ tokens
  function tsize(x) { return Tbl.SIZES[sizeOf(x)] || 1; }
  function condNames(x) { return Object.keys(x.conds || {}).filter(function (k) { return x.conds[k]; }); }
  /* Keep each token's name, health, conditions, and size in step with the tracker (or the crow). Foes and allies whose fight ended come off.
     Every crow and creature gets its Stamina (hpf) and AD (adf) for its bars, and its vitals in words (vit) for the Vitals toggle. */
  function syncTokens(sc) {
    if (V().clean) sc.tokens = sc.tokens.filter(function (t) { return !(t.cid && !byId(t.cid) && (t.kind === 'foe' || t.kind === 'ally')); });
    var round = S().combat.round;
    sc.tokens.forEach(function (t) {
      var p = pcOfTok(t), x = combatant(t);
      if (x) {
        var slots = slotsOf(x);
        t.name = x.name; t.dead = !!x.dead; t.conds = condNames(x).concat(x.hidden ? ['Hidden'] : [], x.squeeze ? ['Squeezing'] : [], tauntOn(x) ? ['Taunted'] : [], surprised(x) ? ['Surprised'] : []);
        t.hpf = x.stMax ? clamp(x.st / x.stMax, 0, 1) : null; t.adf = x.adMax ? clamp(x.ad / x.adMax, 0, 1) : null;
        t.vit = 'St ' + x.st + '/' + x.stMax + (x.adMax || x.ad ? ' · AD ' + x.ad + '/' + x.adMax : '') + (slots ? ' · W ' + x.wounds + '/' + slots : x.wounds ? ' · ' + plural(x.wounds, 'wound') : '');
        t.size = t.sizeSet ? t.size : tsize(x); t.cref = x.cref || t.cref; t.acted = !!round && (x.kind === 'pc' ? x.done === round : x.acted === round); t.fighting = true;
      } else {
        t.fighting = false; t.acted = false; t.adf = null; t.vit = null;
        if (p) {
          t.name = p.name || t.name; t.hpf = p.stMax ? clamp(p.st / p.stMax, 0, 1) : null; t.conds = condNames(p);
          t.vit = 'St ' + p.st + '/' + p.stMax + (p.ad ? ' · AD ' + p.ad : '') + ' · W ' + (p.wounds || 0) + '/10';
        } else if (t.cref && beast(t.cref) && (t.kind === 'foe' || t.kind === 'ally')) {   // a creature not in the tracker: as the Bestiary has it
          var b = beast(t.cref); t.hpf = 1; t.adf = b.ad ? 1 : null; t.vit = 'St ' + b.st + '/' + b.st + (b.ad ? ' · AD ' + b.ad + '/' + b.ad : '') + ' · not in the tracker';
        } else { t.hpf = null; t.vit = null; }
      }
      if (p) t.link = p.link || null;
    });
  }
  /* The hover tooltip's lines for a token (the Ref sees everything). */
  function tipLines(t) {
    var x = combatant(t), out = [{ pc: 'Crow', foe: 'Foe', ally: 'Ally', npc: 'NPC', obj: 'Marker' }[t.kind] + (t.hidden ? ' · hidden from the players' : '') + (t.acted ? ' · acted' : '')];
    if (t.dead) out.push('dead'); else if (t.vit) out.push(t.vit);
    if (x && x.kind !== 'pc' && !x.dead) out.push('Players see: ' + (S().combat.showSt || x.kind === 'ally' ? 'its Stamina and AD' : healthWord(x)));
    var ex = x ? monsterExperts(x) : [];
    if (ex.length) out.push('Monster Expert: ' + ex.join(', ') + ' know' + (ex.length === 1 ? 's' : '') + ' its Stamina, power, attacks, and traits');
    return out;
  }
  function condInfo(k) { var c = (REFD.CONDITIONS || []).filter(function (q) { return q[0] === k; })[0]; return c ? c[1] : { Hidden: 'Edge on its attacks; any aggressive action reveals it.', Squeezing: 'Speed halved; attacks against it get +1.', Taunted: 'Its attacks that don’t include the taunter take a bane.', Surprised: 'No turn in round 1; attacks against it get +1.' }[k] || ''; }
  /* Where the next new token goes: rows of four around the middle of the view; side -1 or 1 puts it in a group left or right of the middle. */
  function nextSpot(sc, side) {
    var c = U.view ? U.view.center() : { x: sc.w / 2, y: sc.h / 2 };
    var n = U.spawn++ % 12, dx = (side || 0) * 4 * sc.g;
    return Tbl.snap(sc, clamp(c.x + dx + (n % 4 - 1.5) * sc.g * 1.2, 0, sc.w), clamp(c.y + (Math.floor(n / 4) - 1) * sc.g * 1.2, 0, sc.h), 1);
  }
  function addToken(sc, o, side) {
    var p = nextSpot(sc, side), t = Object.assign({ id: Tbl.uid('k'), name: 'Token', kind: 'obj', x: p.x, y: p.y, size: 1, hidden: false, speed: 5 }, o);
    sc.tokens.push(t); U.sel = t.id; return t;
  }
  /* Put the session's crows (the active ones) on the map; on a battle map they join the combat tracker too. */
  function addCrows(sc) {
    var added = placeCrows(sc, sc.kind === 'open' ? -1 : 0), fight = sc.kind === 'open' ? addParty() : 0;
    toast(added || fight ? (added ? 'Added ' + plural(added, 'crow') + '. Drag them into place.' : 'The crows are already on the map.') + (fight ? ' ' + plural(fight, 'crow') + ' joined the combat tracker.' : '')
      : A.activePCs().length ? 'Every crow is already on the map.' : 'No active crows to add (see the Party tab).');
    changed(); render();
  }
  function placeCrows(sc, side) {
    var added = 0; U.spawn = 0;
    A.activePCs().forEach(function (p) {
      if (sc.tokens.some(function (t) { return t.pcId === p.id; })) return;
      addToken(sc, { name: p.name || 'Crow', kind: 'pc', pcId: p.id, sight: 1 }, side); added++;
    });
    return added;
  }
  /* Run a saved encounter (its creatures and the crows go into the combat tracker) and put everyone in it on the map: the crows on the
     left, its creatures on the right (hidden from the players when "Tracker foes start hidden" is on). */
  function loadEncounter(sc, e) {
    if (!e) return;
    if (runningEnc() !== e && !e.creatures.length) { toast('That encounter has no creatures yet: add them on the Encounters tab.'); return; }
    if (!runEncounter(e, true)) return;
    var crows = placeCrows(sc, -1), them = 0; U.spawn = 0;
    S().combat.list.forEach(function (x) {
      if (x.kind === 'pc' || x.enc !== e.id || x.dead || sc.tokens.some(function (t) { return t.cid === x.id; })) return;
      addToken(sc, { name: x.name, kind: x.kind === 'ally' ? 'ally' : 'foe', cid: x.id, cref: x.cref, hidden: x.kind === 'foe' && !!U.hideNew }, 1); them++;
    });
    U.sel = null;
    toast(them || crows ? 'Put ' + [them ? plural(them, 'creature') : '', crows ? plural(crows, 'crow') : ''].filter(Boolean).join(' and ') + ' from ' + (e.name || 'the encounter') + ' on the map.'
      : 'Everyone in ' + (e.name || 'the encounter') + ' is already on the map.');
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
      // Health as the rules let the players know it: crows' and allies' Stamina and AD (the fight shares them), foes' only when the Ref
      // shows foes' Stamina, otherwise how hurt they look.
      var full = t.pcId || cx && (cx.kind === 'ally' || S().combat.showSt);
      if (full && t.hpf != null) { o.hpf = Math.round(t.hpf * 100) / 100; if (t.adf != null) o.adf = Math.round(t.adf * 100) / 100; }
      else if (cx && cx.kind !== 'pc') o.hw = healthWord(cx);
      if (t.dead) o.dead = true;
      if (t.acted) o.acted = true;
      var pc = (t.conds || []).filter(function (k) { return k !== 'Hidden'; });
      if (pc.length) o.conds = pc;
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
  /*
   * Is there a line of effect from a crow to a creature on the current scene? True or false when both have tokens there (walls, closed
   * doors, and windows block it; any clear line from the crow's centre to some part of the creature counts), null when the map can't tell.
   */
  function lineOfEffect(pcId, cid) {
    var sc = cur(); if (!sc) return null;
    var a = sc.tokens.filter(function (t) { return t.pcId === pcId && !t.marker; })[0], b = sc.tokens.filter(function (t) { var x = combatant(t); return x && x.id === cid; })[0];
    if (!a || !b) return null;
    var r = (b.size || 1) * sc.g * .4;
    return [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(function (o) { return !Tbl.pathBlocked(sc, { x: a.x, y: a.y }, { x: b.x + o[0], y: b.y + o[1] }); });
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
  /*
   * The map fills the tab, and everything else floats on it (the way Foundry, Roll20, and Owlbear Rodeo lay out a table): the scene
   * picker top left, the clock and the fight top centre, what the players see top right, the tools down the left, zoom bottom right,
   * the tokens along the bottom, a HUD of actions around the selected token, and a drawer from the right for adding tokens, a token's
   * details, and the scene's settings. Each layer is rebuilt on its own; the HUD follows its token every frame.
   */
  function build() {
    var host = el('div', { class: 'vtt-host vtt-stage', id: 'vtt-host' });
    U.view = Tbl.view(host, {
      ref: true,
      scene: cur,
      mask: function () { var sc = cur(); return sc ? maskFor(sc) : null; },
      mapSrc: mapSrc,
      tokenSrc: tokenSrc,
      canMove: function (t) { return !t.locked; },
      speedOf: function (t) { return t.speed || 0; },
      onSelect: function (t) { U.sel = t ? t.id : null; U.fly = null; var sc = cur(); renderRoster(sc); renderHud(sc); if (U.drawer === 'token') renderDrawer(sc); },
      onMove: function (t, x, y) { var sc = cur(); if (sc) { moveToken(sc, t, x, y, false); render(); } },
      onPing: function (x, y) { var sc = cur(); if (sc) { sc.pings = (sc.pings || []).concat([{ id: ++sc.pingId, x: x, y: y, by: 'Ref' }]).slice(-5); changed(); } },
      onWall: function (w) { var sc = cur(); sc.walls.push({ id: Tbl.uid('w'), a: w.a, b: w.b, t: w.t, open: false }); changed(); render(); },
      onErase: function (w) { var sc = cur(); sc.walls = sc.walls.filter(function (k) { return k !== w; }); U.view.flash((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, '#ff9f43'); changed(); render(); },
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
      onMenu: function (t) { U.sel = t.id; U.view.select(t.id); openDrawer('token'); },
      onKey: onKey,
      onFrame: placeHud,
      tooltip: tipLines,
      condInfo: condInfo,
      vitals: function () { return !!V().vitals; }
    });
    U.ui = el('div', { class: 'vtt-ui' });
    U.L = {};
    ['tl', 'tc', 'tr', 'tools', 'zoom', 'roster', 'hud', 'floats', 'ask', 'drawer', 'banners', 'tip', 'empty'].forEach(function (k) { U.L[k] = el('div', { class: 'vtt-' + k }); U.ui.appendChild(U.L[k]); });
    host.appendChild(U.ui);
    // Fullscreen takes the map alone: bring the toast along so messages still show.
    document.addEventListener('fullscreenchange', function () {
      var t = $('toast'); if (!t) return;
      if (document.fullscreenElement === host) host.appendChild(t); else if (t.parentNode === host) document.body.appendChild(t);
      renderZoom(cur());
    });
    return host;
  }
  function onKey(e) {
    var sc = cur(), t = sc && tok(sc, U.sel);
    if (t && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeToken(sc, t); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !sc) return;
    var k = e.key.toLowerCase(), hot = TOOLS.filter(function (x) { return x[3] === k; })[0];
    if (hot && toolsFor(sc).some(function (x) { return x[0] === hot[0]; })) { pickTool(hot[0]); return; }
    if (k === 'h' && t) { t.hidden = !t.hidden; changed(); render(); }
  }

  // ------------------------------------------------------------------ the tab
  function renderVtt() {
    var sc = cur();
    if (!U.built) { U.host = build(); U.built = true; }
    if (sc) { syncTokens(sc); vitalsFx(sc); }
    var box = $('sec-vtt');
    // Keep the canvas where it is: only the layers floating on it are rebuilt.
    if (!box.contains(U.host)) { box.innerHTML = ''; box.appendChild(U.host); U.view.resize(); }
    U.host.classList.toggle('no-scene', !sc);
    // The floating layers slide in when a scene opens, not each time they're rebuilt.
    var sid = sc ? sc.id : ''; U.ui.classList.toggle('enter', U.enterSid !== sid); if (U.enterSid !== sid) { U.enterSid = sid; U.avSeen = {}; }
    renderTopLeft(sc); renderTopCenter(sc); renderTopRight(sc); renderTools(sc); renderZoom(sc); renderRoster(sc); renderHud(sc); renderAsk(sc); renderEmpty(sc);
    if (!(U.drawer && U.L.drawer.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) renderDrawer(sc);
    banners(sc);
    U.view.player(U.playerView);
    U.view.sceneChanged(sc ? sc.id : null);
    U.view.select(U.sel);
    if (U.view.hasSceneSize()) setTimeout(function () { U.view.resize(); }, 0);
  }
  function ico(name) { return el('span', { class: 'ico-wrap', html: Tbl.icon(name) }); }
  /* A floating button: an icon, and a label beside it when `text` is set (otherwise the label is its tooltip). */
  function fab(name, label, onclick, cls, text, extra) {
    var a = { type: 'button', class: 'fab' + (cls ? ' ' + cls : ''), title: label, 'aria-label': text ? null : label, onclick: onclick };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return el('button', a, [ico(name), text ? el('span', { class: 'fab-t', text: text }) : null]);
  }
  function chip(text, cls, extra) { var a = { class: 'hud-chip' + (cls ? ' ' + cls : ''), text: text }; if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; }); return el('span', a); }

  // ---- top left: the scene
  function renderTopLeft(sc) {
    var v = V(), box = U.L.tl; box.innerHTML = '';
    var kinds = {}; KINDS.forEach(function (k) { kinds[k[0]] = k[1]; });
    if (sc) {
      var sel = el('select', { class: 'glass-sel', 'aria-label': 'Scene', title: 'Switch scene', onchange: function () { v.cur = this.value; U.sel = null; U.sig = ''; U.mask = null; save(); render(); } },
        v.scenes.map(function (s) { return el('option', { value: s.id, text: s.name + ' · ' + (kinds[s.kind] || '') }); }));
      sel.value = v.cur;
      box.appendChild(el('div', { class: 'glass row-g' }, [ico('map'), sel]));
    }
    var add = el('select', { class: 'glass-sel add', 'aria-label': 'New scene', title: 'Make a new scene', onchange: function () { if (this.value) addScene(this.value); this.value = ''; } },
      [el('option', { value: '', text: '+ New scene' })].concat(KINDS.map(function (k) { return el('option', { value: k[0], text: k[1], title: k[2] }); })));
    box.appendChild(el('div', { class: 'glass row-g' }, [add]));
  }

  // ---- top centre: the clock, the day, the village, and the fight
  function renderTopCenter(sc) {
    var box = U.L.tc, ss = S(), c = ss.combat, kids = []; box.innerHTML = '';
    if (!sc) return;
    if (sc.kind === 'dungeon' || sc.kind === 'open') {
      var running = ss.running && ss.mode === 'timer';
      kids.push(el('div', { class: 'hud-grp' }, [chip((ss.rest.active ? 'Resting · ' : '') + 'DT ' + ss.dt, 'accent', { title: 'Dungeon turn' }),
        ss.mode === 'timer' ? chip(clockText(remainMs()), 'clock' + (running ? ' run' : ''), { 'data-clock-vtt': '1', title: 'Time left this dungeon turn' }) : chip(Math.max(0, (ss.rooms || 0) - (ss.roomsDone || 0)) + ' rooms left'),
        ss.mode === 'timer' ? fab(running ? 'pause' : 'play', running ? 'Pause the clock' : 'Start the clock', function () { if (running) pauseTimer(); else startTimer(); }, 'sm')
          : fab('plus', 'One more room explored', function () { ss.roomsDone++; save(); render(); }, 'sm', '1 room'),
        fab('hourglass', 'End DT: roll usage dice (lights burn down), end DT conditions, make the encounter check', endDT, 'sm', 'End DT'),
        chip('EN ' + dungeonEN(), 'dim', { title: 'Encounter number' }),
        ss.pending ? chip('Encounter due', 'warn pulse', { title: 'An encounter is due this dungeon turn' }) : null]));
    }
    if (sc.kind === 'travel') {
      var calc = travelCalc(), moved = sc.moved || 0, over = moved > calc.hex;
      kids.push(el('div', { class: 'hud-grp' }, [chip('Day ' + state.travel.day, 'accent', { title: 'Travel day' }),
        el('span', { class: 'hud-meter' + (over ? ' over' : ''), title: 'Hexes moved today (reveals ' + (sc.revealR == null ? 1 : sc.revealR) + ' hex around the marker as it goes)' },
          [el('span', { class: 'bar' }, [el('span', { style: 'width:' + Math.min(100, calc.hex ? moved / calc.hex * 100 : 0) + '%' })]), el('span', { text: moved + ' / ' + plural(calc.hex, 'hex') })]),
        fab('day', 'New day: reset the hexes moved today', function () { sc.moved = 0; changed(); render(); }, 'sm', 'New day'),
        fab('go', 'Open the Travel tab', function () { setTab('travel'); }, 'sm ghost')]));
    }
    if (sc.kind === 'village') {
      kids.push(el('div', { class: 'hud-grp' }, [chip(state.village.name || 'Village', 'accent'), chip('Prosperity ' + state.village.prosperity),
        fab('pin', 'Put the village’s institutions on the map as pins', function () {
          var n = 0; state.village.inst.forEach(function (i) { if (!sc.pins.some(function (p) { return p.label === i.type; })) { var p = nextSpot(sc); sc.pins.push({ id: Tbl.uid('p'), x: p.x, y: p.y, label: i.type, vis: true }); n++; } });
          toast(n ? 'Added ' + plural(n, 'pin') + '. Click a pin to rename it; the Pin tool adds more.' : 'Already pinned.'); changed(); render();
        }, 'sm', 'Institutions'),
        fab('go', 'Open the Village tab', function () { setTab('village'); }, 'sm ghost')]));
    }
    if (c.round) kids.push(el('div', { class: 'hud-grp fight' }, [chip('Round ' + c.round + (c.first ? ' · ' + (c.first === 'crows' ? 'crows first' : 'enemies first') : ''), 'round'),
      fab('next', 'Next round: roll initiative again', function () { nextRound(); }, 'sm', 'Next round')]));
    else if (c.list.length) kids.push(el('div', { class: 'hud-grp fight' }, [fab('dice', 'Start the fight: 1d10, 6+ and the crows act first', function () { rollInitiative(); }, 'sm primary', 'Roll initiative')]));
    kids.forEach(function (k) { box.appendChild(k); });
  }

  // ---- top right: what the players see, and the scene's settings
  function renderTopRight(sc) {
    var v = V(), box = U.L.tr; box.innerHTML = '';
    if (!sc) return;
    var online = !tabletop() && feat('live') && window.CrowsCloud && window.CrowsCloud.recordId;
    box.appendChild(el('div', { class: 'glass row-g' }, [
      fab(U.playerView ? 'eyeOff' : 'eye', 'See exactly what the players see: fog at full strength and your hidden tokens gone. Good for a shared screen.', function () { U.playerView = !U.playerView; render(); },
        'sm' + (U.playerView ? ' on' : ''), U.playerView ? 'Ref view' : 'Player view'),
      fab('show', online ? (v.shown ? 'Players see the map (with fog of war) on their Play pages, Table tab. Click to hide it.' : 'Share this scene with the players’ Play pages (Table tab).') : 'Needs the accounts site and a campaign (and Tabletop Mode off): otherwise use Player view and a shared screen.',
        function () { v.shown = !v.shown; log('', v.shown ? 'The tabletop is shown to the players.' : 'The tabletop is hidden from the players.'); changed(); render(); },
        'sm' + (v.shown ? ' live' : ''), v.shown ? 'Shown to players' : 'Show to players'),
      fab('heart', v.vitals ? 'Hide the full vitals under each token' : 'Show every crow’s and creature’s full vitals under its token: Stamina, AD, and wounds (only you see them)',
        function () { v.vitals = !v.vitals; save(); U.view.redraw(); renderTopRight(cur()); }, 'sm' + (v.vitals ? ' on' : ''), 'Vitals', { 'aria-pressed': v.vitals ? 'true' : 'false' }),
      fab('gear', 'Scene settings: map, grid, fog, light', function () { toggleDrawer('scene'); }, 'sm' + (U.drawer === 'scene' ? ' on' : ''))]));
  }

  // ---- left: the tools
  function toolsFor(sc) { return TOOLS.filter(function (t) { return !(sc.kind === 'travel' && /^(wall|door|window|room)$/.test(t[0])) && !(/^(reveal|hide|rect-reveal|poly-reveal)$/.test(t[0]) && sc.fog === 'off'); }); }
  function pickTool(t) {
    U.view.tool(t); var sc = cur(); renderTools(sc);
    var d = TOOLS.filter(function (x) { return x[0] === t; })[0];
    U.L.tip.innerHTML = ''; if (d) U.L.tip.appendChild(el('div', { class: 'vtt-tipbox', text: d[1] + ': ' + d[2] }));
  }
  function renderTools(sc) {
    var box = U.L.tools; box.innerHTML = '';
    if (!sc) return;
    var tools = toolsFor(sc), now = U.view.getTool();
    if (!tools.some(function (t) { return t[0] === now; })) { U.view.tool('select'); now = 'select'; }
    var pal = el('div', { class: 'glass palette', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }), group = null;
    tools.forEach(function (t) {
      if (t[4] !== group) { if (group !== null) pal.appendChild(el('span', { class: 'sep' })); group = t[4]; }
      pal.appendChild(fab(t[0], t[1] + (t[3] ? ' (' + t[3].toUpperCase() + ')' : '') + ': ' + t[2], function () { pickTool(t[0]); }, 'tool' + (now === t[0] ? ' on' : ''), null, { 'aria-pressed': now === t[0] ? 'true' : 'false', 'data-tip': t[1] }));
    });
    box.appendChild(pal);
    var fresh = U.flyTool !== now; U.flyTool = now;
    if (/^(reveal|hide)$/.test(now)) box.appendChild(el('div', { class: 'glass flyout brush' + (fresh ? ' enter' : ''), role: 'group', 'aria-label': 'Brush size' }, [el('span', { class: 'fly-l', text: 'Brush' })].concat([.5, 1, 2, 3, 5].map(function (n) {
      return el('button', { type: 'button', class: 'pill' + ((U.brush || 1) === n ? ' on' : ''), text: n + ' sq', onclick: function () { U.brush = n; U.view.brush(n); renderTools(sc); } });
    }))));
  }

  // ---- bottom right: zoom
  function renderZoom(sc) {
    var box = U.L.zoom; box.innerHTML = '';
    if (!sc) return;
    box.appendChild(el('div', { class: 'glass palette' }, [fab('plus', 'Zoom in (+)', function () { U.view.zoom(1.25); }), fab('minus', 'Zoom out (−)', function () { U.view.zoom(.8); }),
      fab('fit', 'Fit the map (0)', function () { U.view.fit(true); }), el('span', { class: 'sep' }),
      fab('full', document.fullscreenElement ? 'Leave fullscreen' : 'Fullscreen', function () { if (document.fullscreenElement) document.exitFullscreen(); else if (U.host.requestFullscreen) U.host.requestFullscreen(); }, document.fullscreenElement ? 'on' : '')]));
  }

  // ---- bottom: the tokens on this map
  var ORDER = { pc: 0, ally: 1, npc: 2, foe: 3, obj: 4 };
  function initials(n) { return (n || '?').replace(/^(the|a|an)\s+/i, '').slice(0, 2).toUpperCase(); }
  function avatar(t, onclick, cls) {
    if (!U.avSeen[t.id]) { U.avSeen[t.id] = true; cls = (cls || '') + ' new'; }
    var src = tokenSrc(t), hp = t.dead ? 0 : t.hpf == null ? null : clamp(t.hpf, 0, 1);
    var a = el('button', { type: 'button', class: 'vtt-av k-' + t.kind + (cls ? ' ' + cls : '') + (t.hidden ? ' hid' : '') + (t.dead ? ' dead' : '') + (t.acted ? ' acted' : ''),
      title: t.name + (t.hidden ? ' (hidden)' : '') + (t.dead ? ' (dead)' : '') + (t.acted ? ' (acted)' : ''), 'aria-label': t.name, style: '--kc:' + (Tbl.KIND_COLOR[t.kind] || '#888') + (hp == null ? '' : ';--hp:' + Math.round(hp * 100) + '%;--hc:' + (hp > .6 ? '#5fbf6a' : hp > .3 ? '#e0b43f' : '#d6544a')),
      onclick: onclick }, [el('span', { class: 'face', style: src ? 'background-image:url("' + src + '")' : null }, [src ? null : t.kind === 'obj' ? (t.icon || (t.light ? '✶' : '◆')) : initials(t.name)]),
      hp == null ? null : el('span', { class: 'ring' }), t.hidden ? el('span', { class: 'badge b-hid', html: Tbl.icon('eyeOff') }) : null, t.acted && !t.dead ? el('span', { class: 'badge b-act', html: Tbl.icon('check') }) : null]);
    return a;
  }
  function renderRoster(sc) {
    var box = U.L.roster; box.innerHTML = '';
    if (!sc) return;
    var list = sc.tokens.slice().sort(function (a, b) { return (ORDER[a.kind] || 0) - (ORDER[b.kind] || 0); });
    var strip = el('div', { class: 'glass strip' }, [fab('plus', 'Add tokens: crows, creatures, NPCs, lights, markers', function () { toggleDrawer('add'); }, 'add' + (U.drawer === 'add' ? ' on' : ''))]);
    if (!list.length) strip.appendChild(el('span', { class: 'strip-note', text: 'No tokens yet: add the crows and creatures' }));
    list.forEach(function (k, i) {
      if (i && ORDER[k.kind] !== ORDER[list[i - 1].kind]) strip.appendChild(el('span', { class: 'sep v' }));
      strip.appendChild(avatar(k, function () { U.sel = k.id; U.fly = null; U.view.select(k.id); U.view.centerOn(k.x, k.y, true); renderRoster(sc); renderHud(sc); if (U.drawer === 'token') renderDrawer(sc); }, k.id === U.sel ? 'sel' : ''));
    });
    box.appendChild(strip);
  }

  // ---- the selected token's HUD
  var CONDS = ['Prone', 'Grabbed', 'Vulnerable', 'Weakened', 'Blessed', 'Unconscious'];
  /* A Stamina or AD bar; it slides from where it was the last time this token's HUD was drawn. */
  function bar(id, label, n, max, cls) {
    var pct = max ? clamp(n / max, 0, 1) * 100 : 0, key = id + label, was = (U.bars || (U.bars = {}))[key], fill = el('span', { style: 'width:' + (was == null ? pct : was) + '%' });
    U.bars[key] = pct;
    if (was != null && was !== pct) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); });
    return el('div', { class: 'vbar ' + (cls || '') }, [el('span', { class: 'vl', text: label }), el('span', { class: 'vt' }, [fill]), el('span', { class: 'vn', text: n + '/' + max })]);
  }
  function renderHud(sc) {
    var box = U.L.hud, t = sc && tok(sc, U.sel); box.innerHTML = '';
    if (!t) { U.hudFor = null; box.className = 'vtt-hud'; return; }
    var x = combatant(t), p = pcOfTok(t), round = S().combat.round, enter = U.hudFor !== t.id; U.hudFor = t.id;
    box.className = 'vtt-hud' + (enter ? ' enter' : '');
    // the card above the token: who it is and how it's doing
    var card = [el('div', { class: 'hc-name' }, [el('b', { text: t.name }), el('span', { class: 'hc-kind', text: { pc: 'Crow', foe: 'Foe', ally: 'Ally', npc: 'NPC', obj: t.light ? 'Light' : 'Marker' }[t.kind] || '' }),
      t.hidden ? el('span', { class: 'hud-chip warn', text: 'hidden' }) : null, t.dead ? el('span', { class: 'hud-chip', text: 'dead' }) : null])];
    if (x) {
      card.push(bar(t.id, 'St', x.st, x.stMax, 'st'));
      if (x.adMax) card.push(bar(t.id, 'AD', x.ad, x.adMax, 'ad'));
      if (x.wounds) card.push(el('div', { class: 'hc-row' }, [el('span', { class: 'hud-chip bad', text: plural(x.wounds, 'wound') })]));
      var on = CONDS.filter(function (k) { return x.conds && x.conds[k]; });
      if (on.length) card.push(el('div', { class: 'hc-row' }, on.map(function (k) { return el('span', { class: 'hud-chip cond', text: k }); })));
    } else if (p && p.stMax) card.push(bar(t.id, 'St', p.st, p.stMax, 'st'));
    if (t.light && t.light.on !== false) card.push(el('div', { class: 'hc-row fine' }, ['Light ' + t.light.b + '/' + t.light.d]));
    box.appendChild(el('div', { class: 'hud-card' }, card));
    // left: the fight
    var left = [];
    if (x) {
      var amt = el('input', { type: 'number', class: 'hud-n', min: 1, max: 999, value: U.hurt || 1, 'aria-label': 'Amount', title: 'How much to hurt or heal',
        onchange: function () { U.hurt = clamp(parseInt(this.value, 10) || 1, 1, 999); } });
      var n = function () { U.hurt = clamp(parseInt(amt.value, 10) || 1, 1, 999); return U.hurt; };
      left.push(amt,
        fab('sword', 'Hurt: deal this damage (AD first, then Stamina, then wounds)', function () { damage(x, n(), false); }, 'hurt', null, { 'data-tip': 'Hurt' }),
        fab('pierce', 'Piercing damage (skips AD)', function () { damage(x, n(), true); }, 'hurt', null, { 'data-tip': 'Piercing' }),
        fab('heart', 'Heal this much Stamina', function () { heal(x, n()); }, 'heal', null, { 'data-tip': 'Heal' }),
        fab('cond', 'Conditions', function () { U.fly = U.fly === 'conds' ? null : 'conds'; renderHud(sc); }, U.fly === 'conds' ? 'on' : '', null, { 'data-tip': 'Conditions' }));
      if (x.kind !== 'pc' && round) left.push(fab('check', x.acted === round ? 'Acted this round (click to undo)' : 'Mark acted this round', function () { x.acted = x.acted === round ? 0 : round; save(); render(); }, x.acted === round ? 'on' : '', null, { 'data-tip': 'Acted' }));
    } else if (t.kind === 'foe' || t.kind === 'ally') {
      left.push(fab('list', 'Add to the combat tracker', function () {
        if (!t.cref) { toast('This token has no creature to add.'); return; }
        var before = S().combat.list.length; addCombatant(t.cref, 1, t.kind === 'ally' ? 'ally' : 'foe');
        if (S().combat.list.length > before) { t.cid = S().combat.list[S().combat.list.length - 1].id; t.name = S().combat.list[S().combat.list.length - 1].name; changed(); render(); }
      }, '', null, { 'data-tip': 'To tracker' }));
    }
    if (left.length) box.appendChild(el('div', { class: 'hud-col left' }, left));
    // right: the token itself
    box.appendChild(el('div', { class: 'hud-col right' }, [
      fab(t.hidden ? 'eyeOff' : 'eye', t.hidden ? 'Hidden from players: click to show (H)' : 'Seen by players: click to hide (H)', function () { t.hidden = !t.hidden; changed(); render(); }, t.hidden ? 'on' : '', null, { 'data-tip': t.hidden ? 'Show' : 'Hide' }),
      fab(t.locked ? 'lock' : 'unlock', t.locked ? 'Locked: can’t be dragged' : 'Lock in place', function () { t.locked = !t.locked; changed(); render(); }, t.locked ? 'on' : '', null, { 'data-tip': t.locked ? 'Unlock' : 'Lock' }),
      fab('sun', 'Light it carries', function () { U.fly = U.fly === 'light' ? null : 'light'; renderHud(sc); }, (t.light && t.light.on !== false ? 'lit' : '') + (U.fly === 'light' ? ' on' : ''), null, { 'data-tip': 'Light' }),
      fab('sliders', 'Details: name, size, sight, speed', function () { openDrawer('token'); }, U.drawer === 'token' ? 'on' : '', null, { 'data-tip': 'Details' }),
      fab('copy', 'Duplicate', function () { var c2 = JSON.parse(JSON.stringify(t)); c2.id = Tbl.uid('k'); c2.cid = null; c2.pcId = null; c2.link = null; c2.x += sc.g; sc.tokens.push(c2); U.sel = c2.id; changed(); render(); }, '', null, { 'data-tip': 'Duplicate' }),
      fab('trash', 'Remove from the map (Delete)', function () { removeToken(sc, t); }, 'danger', null, { 'data-tip': 'Remove' })]));
    // flyouts (they pop open once, not on every rebuild)
    var flyNew = U.flyShown !== U.fly + t.id; U.flyShown = U.fly + t.id;
    if (U.fly === 'conds' && x) box.appendChild(el('div', { class: 'hud-fly conds' + (flyNew ? ' enter' : '') }, CONDS.map(function (k) {
      var on = !!(x.conds && x.conds[k]);
      return el('button', { type: 'button', class: 'pill' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', text: k, onclick: function () { setCond(x, k, !on); save(); render(); } });
    })));
    if (U.fly === 'light') box.appendChild(el('div', { class: 'hud-fly light' + (flyNew ? ' enter' : '') }, PRESETS.map(function (o) {
      var on = presetOf(t) === o[0];
      return el('button', { type: 'button', class: 'pill' + (on ? ' on' : ''), text: o[1], onclick: function () { t.light = parsePreset(o[0].replace('c', '')); if (o[0] === '10/10c' && t.light) t.light.fire = true; changed(); render(); } });
    }).concat(t.light ? [el('button', { type: 'button', class: 'pill' + (t.light.on === false ? ' on' : ''), text: t.light.on === false ? 'Relight' : 'Put out', title: 'Lights go out when burned down (usage dice end each dungeon turn)', onclick: function () { t.light.on = t.light.on === false; changed(); render(); } })] : [])));
    placeHud();
  }
  /* Keep the HUD on its token (called every frame the map draws). */
  function placeHud() {
    var box = U.L.hud; if (!box || !U.hudFor) return;
    var s = U.view.screenOf(U.hudFor), W = U.host.clientWidth, H = U.host.clientHeight;
    var off = !s || s.x < -s.r || s.y < -s.r || s.x > W + s.r || s.y > H + s.r || U.view.held();
    box.classList.toggle('away', !!off);
    if (!s) return;
    box.style.transform = 'translate(' + Math.round(s.x) + 'px,' + Math.round(s.y) + 'px)';
    box.style.setProperty('--r', Math.round(Math.max(14, s.r)) + 'px');
    box.classList.toggle('below', s.y - s.r < 190);
  }

  // ---- the approval pop-up: a hit or effect waiting for the Ref to apply it, and then what it did
  /* Actions this round whose effects wait for the Ref (every hit with damage; everything in Tabletop Mode), oldest first. */
  function waiting() {
    var c = S().combat;
    return (c.acts || []).filter(function (a) { return !a.applied && a.round === c.round && fxItems(a).some(function (f) { return byId(f.id); }); });
  }
  /* What an applied action did to each creature, from how they were (act.before) to how they are. */
  function resultText(a) {
    var out = [];
    Object.keys(a.before || {}).forEach(function (id) {
      var x = byId(id), b = a.before[id]; if (!x) return;
      var parts = [];
      if (x.ad !== b.ad) parts.push('AD ' + b.ad + '→' + x.ad);
      if (x.st !== b.st) parts.push('Stamina ' + b.st + '→' + x.st);
      if (x.wounds !== b.wounds) parts.push((x.wounds > b.wounds ? '+' : '') + (x.wounds - b.wounds) + (Math.abs(x.wounds - b.wounds) === 1 ? ' wound' : ' wounds'));
      Object.keys(x.conds || {}).forEach(function (k) { if (x.conds[k] && !b.conds[k]) parts.push('now ' + k.toLowerCase()); });
      Object.keys(b.conds || {}).forEach(function (k) { if (b.conds[k] && !x.conds[k]) parts.push('no longer ' + k.toLowerCase()); });
      if (x.dead && !b.dead) parts.push('dead');
      out.push(x.name + ': ' + (parts.join(', ') || 'no change (avoided or negated)'));
    });
    return out;
  }
  function renderAsk(sc) {
    var box = U.L.ask; box.innerHTML = '';
    var tc = U.L.tc; box.style.top = Math.max(62, tc.offsetTop + tc.offsetHeight + 10) + 'px';   // under the clock and the fight
    var asked = U.asked || (U.asked = {}), list = waiting();
    if (!sc) return;
    // Show where a new one lands, once.
    list.forEach(function (a) {
      if (asked[a.id]) return;
      asked[a.id] = { t: Date.now() };
      fxItems(a).forEach(function (f) { var tk = sc.tokens.filter(function (k) { return combatant(k) && combatant(k).id === f.id; })[0]; if (tk && U.view) U.view.flash(tk.x, tk.y, '#ffd25a'); });
    });
    var a = list[0];
    if (a && U.askMin === a.id) {
      box.appendChild(el('button', { type: 'button', class: 'glass ask-pill', onclick: function () { U.askMin = null; renderAsk(sc); } }, [ico('hourglass'), ' ' + plural(list.length, 'action') + ' waiting for you']));
      return;
    }
    if (a) {
      var items = fxItems(a).filter(function (f) { return byId(f.id); }), names = items.map(function (f) { return byId(f.id).name; }).join(', ');
      box.appendChild(el('div', { class: 'glass ask-card', role: 'alertdialog', 'aria-label': 'Your approval is needed' }, [
        el('div', { class: 'ask-head' }, [el('b', { text: 'Needs your approval' }), list.length > 1 ? el('span', { class: 'hud-chip', text: '1 of ' + list.length }) : null, el('span', { class: 'grow' }),
          fab('mine', 'Show it on the map', function () { var tk = sc.tokens.filter(function (k) { var x = combatant(k); return x && items.some(function (f) { return f.id === x.id; }); })[0]; if (tk) U.view.centerOn(tk.x, tk.y, true); }, 'sm ghost'),
          fab('minus', 'Later: shrink this to a reminder', function () { U.askMin = a.id; renderAsk(sc); }, 'sm ghost')]),
        el('div', { class: 'ask-what' }, [rich('**' + a.who + '**' + (a.label ? ': ' + a.label : '') + ' → **' + names + '**' + (a.tier ? ' · tier ' + a.tier : '') + (a.crit ? ' (crit)' : a.doom ? ' (doom)' : '') + ': ' + fxText(items) + '.')]),
        a.text ? el('div', { class: 'ask-note', text: a.text }) : null,
        (a.defenses || []).length ? null : items.some(function (f) { var x = byId(f.id); return x.kind === 'pc' && f.damage > 0; }) ? el('div', { class: 'ask-note', text: 'The player can still say how they defend; their answer shows here.' }) : null,
        el('div', { class: 'ask-ctl' }, [hitControls(a)])]));
      return;
    }
    // The last one applied from here: what it did, with Undo, until it's dismissed.
    var done = S().combat.acts && S().combat.acts.filter(function (k) { return k.applied && asked[k.id] && !asked[k.id].seen; }).slice(-1)[0];
    if (done) {
      box.appendChild(el('div', { class: 'glass ask-card done', role: 'status' }, [
        el('div', { class: 'ask-head' }, [el('b', { text: 'Applied' }), el('span', { class: 'grow' }), fab('x', 'Close', function () { Object.keys(asked).forEach(function (k) { asked[k].seen = true; }); renderAsk(sc); }, 'sm ghost')]),
        el('div', { class: 'ask-what' }, [rich('**' + done.who + '**' + (done.label ? ': ' + done.label : ''))]),
        el('ul', { class: 'ask-res' }, resultText(done).map(function (l) { return el('li', { text: l }); })),
        el('div', { class: 'ask-ctl' }, [btn('Undo', function () { undoAct(done); }, 'btn-small btn-ghost', 'Put them back as they were'),
          btn('OK', function () { Object.keys(asked).forEach(function (k) { asked[k].seen = true; }); renderAsk(sc); }, 'btn-small btn-primary')])]));
    }
  }

  // ---- the drawer: add tokens, a token's details, the scene's settings
  function openDrawer(mode) { U.drawer = mode; render(); }
  function toggleDrawer(mode) { U.drawer = U.drawer === mode ? null : mode; render(); }
  function renderDrawer(sc) {
    var box = U.L.drawer;
    var mode = sc ? U.drawer : null, t = sc && tok(sc, U.sel);
    box.classList.toggle('open', !!mode);
    if (!mode) return;
    var title = { add: 'Add to the map', token: t ? t.name : 'Token', scene: 'Scene settings' }[mode];
    var body = mode === 'add' ? addPanel(sc) : mode === 'scene' ? sceneSettings(sc) : t ? inspector(sc, t) : el('p', { class: 'fine', text: 'Select a token on the map or along the bottom.' });
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'dr-head' }, [el('h3', { text: title }), fab('x', 'Close', function () { U.drawer = null; render(); }, 'sm ghost')]));
    box.appendChild(el('div', { class: 'dr-body' }, [body]));
  }
  function addPanel(sc) {
    var quick = el('div', { class: 'dr-quick' }, [
      fab('crows', sc.kind === 'open' ? 'Put every crow in the session on the map, and in the combat tracker' : 'Put every crow in the session on the map', function () { addCrows(sc); }, '', 'Crows'),
      sc.kind !== 'travel' && !tabletop() ? fab('list', 'Put everyone in the combat tracker on the map', function () { addTracker(sc); }, '', 'Tracker') : null,
      fab('flag', 'One token for the whole party (overland travel)', function () {
        if (sc.tokens.some(function (k) { return k.marker; })) { toast('The party marker is already on the map.'); return; }
        addToken(sc, { name: 'The party', kind: 'pc', marker: true, speed: 0 }); changed(); render();
      }, '', 'Party marker'),
      fab('sun', 'A torch or lantern left on the map', function () { addToken(sc, { name: 'Torch', kind: 'obj', light: parsePreset('5/5'), icon: '✶', hidden: false }); changed(); render(); }, '', 'Light'),
      fab('marker', 'A labeled marker: a door, a trap, a body', function () { addToken(sc, { name: 'Marker', kind: 'obj', label: true }); changed(); render(); }, '', 'Marker')]);
    var cs = el('select', { class: 'in', 'aria-label': 'Creature' }, REFD.BESTIARY.map(function (b) { return el('option', { value: b.n, text: b.n }); })), cnt = el('input', { type: 'number', class: 'tiny', value: 1, min: 1, max: 20, 'aria-label': 'How many' });
    if (U.addName) cs.value = U.addName;
    cs.addEventListener('change', function () { U.addName = this.value; });
    var side = el('select', { class: 'in', 'aria-label': 'Side' }, [el('option', { value: 'foe', text: 'Foe' }), el('option', { value: 'ally', text: 'Ally' })]);
    var trk = el('input', { type: 'checkbox', checked: !tabletop() }), hid = el('input', { type: 'checkbox', checked: !!U.hideNew, onchange: function () { U.hideNew = this.checked; } });
    var kids = [el('h4', { text: 'Quick' }), quick].concat(sc.kind === 'travel' ? [] : encounterPanel(sc), [el('h4', { text: 'A creature' }), el('label', { class: 'field' }, ['Creature', cs]),
      el('div', { class: 'row center nw' }, [cnt, side, btn('Add', function () { addCreature(sc, cs.value, clamp(parseInt(cnt.value, 10) || 1, 1, 20), side.value, trk.checked); }, 'btn-small btn-primary')]),
      el('label', { class: 'check', title: 'Also puts it in the combat tracker (and starts the players’ fight view). Otherwise it is only a hidden token.' }, [trk, ' Add to the combat tracker']),
      el('label', { class: 'check', title: 'New foes from the tracker or an encounter start hidden from the players (still seen by you), so you can place them first.' }, [hid, ' Tracker foes start hidden'])]);
    if (state.npcs.length) {
      var ns = el('select', { class: 'in', 'aria-label': 'NPC' }, state.npcs.map(function (n, i) { return el('option', { value: i, text: n.name || 'NPC ' + (i + 1) }); }));
      kids.push(el('h4', { text: 'An NPC' }), el('div', { class: 'row center nw' }, [ns, btn('Add NPC', function () { var n = state.npcs[+ns.value]; addToken(sc, { name: n.name || 'NPC', kind: 'npc' }); changed(); render(); }, 'btn-small')]));
    }
    return el('div', { class: 'dr-stack' }, kids);
  }

  /* The drawer's encounter section: the current encounter (running, or due this dungeon turn) and any saved one, onto the map. */
  function encounterPanel(sc) {
    var run = runningEnc(), due = !run && pendingEnc(), now = run || due, open = state.encounters.filter(function (e) { return !e.done && e !== now; });
    var out = [el('h4', { text: 'Encounter' })];
    if (now) out.push(el('div', { class: 'dr-enc' }, [el('div', { class: 'fine' }, [el('b', { text: (run ? 'Running: ' : 'Due this DT: ') + (now.name || 'untitled') }),
      encSummary(now) ? ' (' + encSummary(now) + ')' : '']),
      btn(run ? 'Put its creatures on the map' : 'Run it on the map', function () { loadEncounter(sc, now); }, 'btn-small btn-primary',
        run ? 'Tokens for the crows and every creature in the running encounter that isn’t on the map yet' : 'Start the encounter (its creatures and the crows go into the combat tracker) and put them all on the map')]));
    else out.push(el('p', { class: 'fine', text: 'No encounter is running.' }));
    if (open.length) {
      var es = el('select', { class: 'in', 'aria-label': 'Saved encounter' }, open.map(function (e) { return el('option', { value: e.id, text: (e.name || 'untitled') + (encSummary(e) ? ' — ' + encSummary(e) : '') }); }));
      if (U.encPick && open.some(function (e) { return e.id === U.encPick; })) es.value = U.encPick;
      es.addEventListener('change', function () { U.encPick = this.value; });
      out.push(el('label', { class: 'field' }, ['Load a saved encounter', es]),
        el('div', { class: 'row center nw' }, [btn('Load onto the map', function () { loadEncounter(sc, open.filter(function (e) { return e.id === es.value; })[0]); }, 'btn-small',
          'Run it (its creatures and the crows go into the combat tracker; the fight is on the Encounters tab too) and put everyone on the map')]));
    } else if (!now) out.push(el('p', { class: 'fine', text: 'No saved encounters: roll or build one on the Encounters tab.' }));
    return out;
  }

  // ---- banners: a new round, a new dungeon turn, an encounter, the map shown or hidden
  function banners(sc) {
    var ss = S(), c = ss.combat, now = { r: c.round || 0, f: c.first || '', dt: ss.dt, pend: !!ss.pending, shown: !!V().shown, day: state.travel.day, sid: sc ? sc.id : '' };
    var was = U.ban; U.ban = now;
    if (!was || !sc || was.sid !== now.sid) return;
    if (now.r && (now.r !== was.r || now.f !== was.f)) banner('Round ' + now.r, now.f ? (now.f === 'crows' ? 'Crows and allies act first' : 'Enemies act first') : '', 'round');
    else if (!now.r && was.r) banner('The fight is over', '', 'calm');
    if (now.dt !== was.dt && (sc.kind === 'dungeon' || sc.kind === 'open')) banner('Dungeon turn ' + now.dt, '', 'dt');
    if (now.pend && !was.pend) banner('Encounter!', 'One is due this dungeon turn', 'warn');
    if (now.shown !== was.shown) banner(now.shown ? 'Shown to the players' : 'Hidden from the players', '', 'info');
    if (now.day !== was.day && sc.kind === 'travel') banner('Day ' + now.day, 'A new day on the road', 'dt');
  }
  function banner(title, sub, kind) {
    var b = el('div', { class: 'vtt-banner b-' + kind, role: 'status' }, [el('b', { text: title }), sub ? el('span', { text: sub }) : null]);
    U.L.banners.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 2600);
  }
  /* Numbers rising from tokens whose Stamina, AD, or wounds changed (whoever changed them: the HUD, the tracker, a player's sheet). */
  function vitalsFx(sc) {
    var seen = U.vit || (U.vit = {}), fresh = U.vitScene !== sc.id; U.vitScene = sc.id;
    sc.tokens.forEach(function (t) {
      var x = combatant(t), p = pcOfTok(t), v = x ? { s: 'x', st: x.st || 0, ad: x.ad || 0, w: x.wounds || 0 } : p ? { s: 'p', st: p.st || 0, ad: 0, w: p.wounds || 0 } : null;
      var was = seen[t.id]; seen[t.id] = v;
      if (fresh || !v || !was || was.s !== v.s) return;
      var lost = was.st + was.ad - v.st - v.ad, dw = v.w - was.w;
      if (lost > 0) floatText(t.id, '−' + lost, 'hurt');
      else if (v.st > was.st) floatText(t.id, '+' + (v.st - was.st), 'heal');
      if (dw > 0) floatText(t.id, '+' + plural(dw, 'wound'), 'wound', 380);
    });
  }
  /* A number rising from a token, over everything else on the map (the HUD too). */
  function floatText(id, text, kind, delay) {
    setTimeout(function () {
      var s = U.view.screenOf(id); if (!s || Tbl.REDUCED_MOTION) return;
      var f = el('div', { class: 'vtt-float f-' + kind, text: text, style: 'left:' + Math.round(s.x) + 'px;top:' + Math.round(s.y - s.r * .4) + 'px' });
      U.L.floats.appendChild(f);
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1500);
    }, delay || 0);
  }

  // ---- no scene yet
  function renderEmpty(sc) {
    var box = U.L.empty; box.innerHTML = '';
    if (sc) return;
    box.appendChild(el('div', { class: 'glass empty-card' }, [el('h2', { text: 'Set the table' }),
      el('p', { text: 'Make a scene and run the game on it: tokens for the crows and creatures, fog of war, and the clock and the fight floating on the map.' }),
      el('div', { class: 'empty-kinds' }, KINDS.map(function (k) {
        return el('button', { type: 'button', class: 'kind-btn', onclick: function () { addScene(k[0]); } }, [ico({ dungeon: 'wall', open: 'sword', travel: 'map', village: 'pin', blank: 'marker' }[k[0]]), el('b', { text: k[1] }), el('span', { text: k[2] })]);
      }))]));
  }

  // ------------------------------------------------------------------ the drawer's forms
  function numIn(obj, key, min, max, onchange, w) {
    var n = el('input', { type: 'number', class: 'tiny', min: min, max: max, value: obj[key] == null ? '' : obj[key], style: w ? 'width:' + w : null });
    n.addEventListener('change', function () { var v = parseFloat(this.value); obj[key] = isNaN(v) ? null : clamp(v, min, max); changed(); if (onchange) onchange(); render(); });
    return n;
  }
  function checkIn(obj, key, label, title) {
    return el('label', { class: 'check', title: title || null }, [el('input', { type: 'checkbox', checked: !!obj[key], onchange: function () { obj[key] = this.checked; changed(); render(); } }), ' ' + label]);
  }
  function inspector(sc, t) {
    var name = el('input', { type: 'text', class: 'in', value: t.name, 'aria-label': 'Name', maxlength: 40, disabled: t.fighting ? true : null });
    name.addEventListener('change', function () { t.name = this.value.slice(0, 40); changed(); render(); });
    var szSel = el('select', { class: 'in', 'aria-label': 'Size', onchange: function () { t.size = +this.value; t.sizeSet = true; changed(); render(); } },
      [[.5, 'Tiny'], [1, 'Small / Medium'], [2, 'Large'], [3, 'Huge'], [4, 'Gigantic']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: (t.size || 1) === o[0] ? true : null }); }));
    var kids = [el('div', { class: 'row' }, [el('label', { class: 'field grow' }, ['Name', name]), el('label', { class: 'field' }, ['Size', szSel])])];
    if (t.fighting) kids.push(el('p', { class: 'fine', text: 'Its name comes from the combat tracker.' }));
    var lightSel = el('select', { class: 'in', 'aria-label': 'Light', onchange: function () { var v = this.value; t.light = v === 'custom' ? t.light || { b: 3, d: 3, on: true } : parsePreset(v.replace('c', '')); if (v === '10/10c' && t.light) t.light.fire = true; changed(); render(); } },
      PRESETS.concat([['custom', 'Custom…']]).map(function (o) { return el('option', { value: o[0], text: o[1], selected: presetOf(t) === o[0] ? true : null }); }));
    kids.push(el('div', { class: 'row center' }, [el('label', { class: 'field grow' }, ['Light it gives', lightSel]),
      t.light ? checkIn(t.light, 'on', 'Lit', 'Lights go out when unticked (a torch burned down: usage dice end each dungeon turn)') : null]));
    if (t.light && presetOf(t) === 'custom') kids.push(el('div', { class: 'row center' }, ['bright ', numIn(t.light, 'b', 0, 30), ' dim ', numIn(t.light, 'd', 0, 30)]));
    if (CARRIERS.indexOf(t.kind) >= 0) kids.push(el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Own sight (squares)', numIn(t, 'sight', 0, 30, null)]), el('label', { class: 'field' }, ['Speed', numIn(t, 'speed', 0, 30)])]),
      el('p', { class: 'fine', text: 'Own sight: how far it sees with no light (Dark Senses: 10+). Speed shows the move range while dragging.' }));
    else if (t.kind === 'foe') kids.push(el('label', { class: 'field' }, ['Speed', numIn(t, 'speed', 0, 30)]));
    kids.push(el('div', { class: 'checks' }, [CARRIERS.indexOf(t.kind) >= 0 ? checkIn(t, 'sees', 'Gives the party sight', 'Off: this token doesn’t see for the party (a blinded crow).') : null,
      t.kind !== 'obj' ? null : checkIn(t, 'label', 'Show its name')]));
    return el('div', { class: 'dr-stack' }, kids);
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
      [['off', 'Off'], ['vision', 'Line of sight and light'], ['manual', 'I reveal by hand']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: sc.fog === o[0] ? true : null }); }));
    var amb = el('select', { class: 'in', 'aria-label': 'Ambient light', onchange: function () { sc.ambient = this.value; changed(); render(); } },
      [['bright', 'Bright'], ['dim', 'Dim'], ['dark', 'Dark']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: sc.ambient === o[0] ? true : null }); }));
    return el('div', { class: 'dr-stack' }, [
      el('label', { class: 'field' }, ['Name', name]), el('label', { class: 'field' }, ['Map', mapSel]),
      el('h4', { text: 'Grid' }),
      el('div', { class: 'row center' }, [el('label', { class: 'field' }, ['Squares across', colsIn]), el('label', { class: 'field grow' }, ['Grid', grid]), el('label', { class: 'field' }, ['Board', bg])]),
      el('div', { class: 'row center' }, [el('span', { class: 'fine', text: 'Offset' }), numIn(sc, 'ox', -400, 400, function () { sc.seen = ''; }), numIn(sc, 'oy', -400, 400, function () { sc.seen = ''; }),
        sc.kind === 'travel' ? null : el('label', { class: 'field inline' }, ['Feet/square ', numIn(sc, 'unit', 0, 100)])]),
      el('div', { class: 'checks' }, [checkIn(sc, 'showGrid', 'Show the grid'), checkIn(sc, 'playerMove', 'Players move their own tokens', 'Their drops arrive as moves you can see; walls stop them.')]),
      el('h4', { text: 'Fog and light' }),
      el('div', { class: 'row' }, [el('label', { class: 'field grow' }, ['Fog of war', fog]), el('label', { class: 'field grow' }, ['Ambient light', amb])]),
      sc.kind === 'travel' ? el('label', { class: 'field inline' }, ['Reveal radius (hexes) ', numIn(sc, 'revealR', 0, 5)]) : null,
      sc.fog === 'off' ? null : el('div', { class: 'row' }, [btn('Reveal all', function () { Tbl.fillSeen(sc, true); changed(); render(); }, 'btn-small'), btn('Hide all', function () { Tbl.fillSeen(sc, false); changed(); render(); }, 'btn-small')]),
      sc.walls.length ? el('h4', { text: 'Walls' }) : null,
      sc.walls.length ? el('div', { class: 'row' }, [btn('Undo wall', function () { sc.walls.pop(); changed(); render(); }, 'btn-small btn-ghost'),
        btn('Clear walls', function () { if (confirm('Delete all ' + sc.walls.length + ' walls and doors on this scene?')) { sc.walls = []; changed(); render(); } }, 'btn-small btn-ghost')]) : null,
      el('h4', { text: 'Scene' }),
      checkIn(V(), 'clean', 'Remove foes’ tokens when they leave the tracker'),
      el('div', { class: 'row' }, [btn('Duplicate scene', function () { var c2 = JSON.parse(JSON.stringify(sc)); c2.id = Tbl.uid('s'); c2.name += ' (copy)'; V().scenes.push(c2); V().cur = c2.id; changed(); render(); }, 'btn-small btn-ghost'),
        btn('Delete scene', function () { if (confirm('Delete the scene "' + sc.name + '"?')) { V().scenes = V().scenes.filter(function (k) { return k !== sc; }); V().cur = V().scenes[0] ? V().scenes[0].id : ''; U.sel = null; U.drawer = null; changed(); render(); } }, 'btn-small btn-ghost btn-danger')])
    ]);
  }

  // Redraw when the tracker, party, or clock change: render() calls renderVtt for the open tab; the clock chip is kept current here.
  setInterval(function () {
    if (document.body.getAttribute('data-tab') !== 'vtt') return;
    var c = document.querySelector('[data-clock-vtt]'); if (c) c.textContent = clockText(remainMs());
  }, 500);

  A.add({ renderVtt: renderVtt, vttAction: vttAction, publicTable: publicTable, lineOfEffect: lineOfEffect });
})();
