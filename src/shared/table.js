/*
 * The graphical tabletop, shared by the Ref Screen (Tabletop tab) and the Play page (Table tab): window.CrowsTable.
 *
 * A scene is a map (a picture, or a plain board) with a grid, tokens, walls and doors, pins, and fog of war:
 *   { id, name, kind: 'dungeon'|'travel'|'village'|'open', w, h, g, grid: 'square'|'hexp'|'hexf'|'none', ox, oy, bg, map,
 *     ambient: 'bright'|'dim'|'dark', fog: 'off'|'manual'|'vision', seen, walls: [...], tokens: [...], pins: [...] }
 * Everything is in map pixels; g is one square's (or hex's, flat to flat) width. Rules: a square is 5 ft, a diagonal counts 1, and a light
 * is "Light X/Y": X squares bright, then Y dim.
 *
 * Fog of war is a grid of small cells (a few per square) holding 0 hidden, 1 explored (remembered), 2 dim, 3 bright. In `vision` mode the
 * Ref's screen works it out (computeVision): the party sees where its crows have a line of sight (walls and closed doors block it) that is
 * lit (the scene's ambient light, torches and lanterns, a crow's own sight radius). In `manual` mode the Ref reveals and hides by hand.
 * The Ref publishes only that mask (never the walls) and the tokens the party can see, so players' screens know no more than they show.
 *
 * T.view(host, options) is the canvas: pan, zoom, tokens you can drag, ruler, pings, and (for the Ref) the drawing tools. In a fight,
 * options.links() gives the arrows to draw (who attacks whom: [{ from, to, color, strong }] by token id), and options.onPick(token or null)
 * can take a click for picking a target (return true when it did) before it selects or drags anything.
 */
(function () {
  'use strict';
  var T = window.CrowsTable = {};
  var SQ3 = Math.sqrt(3);

  // ------------------------------------------------------------------ scenes and grids
  var SIZES = { T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4 };
  var KIND_COLOR = { pc: '#4fb6a6', foe: '#c4524a', ally: '#6aa84f', npc: '#d6a93b', obj: '#8a8a93' };
  // The markers around a token for its conditions: [color, letter]. Anything else gets a gray marker with its first letter.
  var COND_STYLE = { Blessed: ['#d9b23c', 'B'], Grabbed: ['#e0782f', 'G'], Prone: ['#8d6a4b', 'P'], Unconscious: ['#6c5fd0', 'U'], Vulnerable: ['#d2455c', 'V'],
    Weakened: ['#4f86b0', 'W'], Hidden: ['#5b6670', 'H'], Squeezing: ['#8b8456', 'S'], Taunted: ['#b8432f', 'T'], Surprised: ['#c27bd6', '!'] };
  var HW_COLOR = { 'unhurt': '#9fdca8', 'armor dented': '#a9c8e8', 'hurt': '#f0c862', 'badly hurt': '#ff8a72', 'down': '#ff6b5e' };
  var COND_INFO = { Blessed: 'Edge on all tests; attacks deal extra damage.', Grabbed: 'Speed 0, can’t flank; attacks against it have an edge.',
    Prone: 'Speed halved, bane on melee attacks; melee against it has an edge, ranged a bane.', Unconscious: 'No actions or reactions; attacks against it are tier 3. Damage wakes it.',
    Vulnerable: 'Takes an extra 1d6 each time it takes damage.', Weakened: 'Bane on all tests.', Hidden: 'Edge on its attacks; attacking reveals it.',
    Squeezing: 'Speed halved; attacks against it get +1.', Taunted: 'Its attacks that leave out the taunter take a bane.', Surprised: 'No turn in round 1; attacks against it get +1.' };
  function condStyle(c) { return COND_STYLE[c] || ['#666', (c || '?').charAt(0).toUpperCase()]; }
  var nid = 1;
  function uid(p) { return (p || 't') + Date.now().toString(36) + (nid++); }
  function newScene(o) {
    o = o || {};
    var g = o.g || 70;
    return { id: uid('s'), name: o.name || 'New scene', kind: o.kind || 'dungeon', w: o.w || g * 30, h: o.h || g * 20, g: g, grid: o.grid || 'square',
      ox: 0, oy: 0, bg: o.bg || '#2a2622', map: o.map || null, ambient: o.ambient || 'dark', fog: o.fog || 'vision', seen: '', seenDims: '',
      walls: [], tokens: [], pins: [], hide: [], playerMove: true, showGrid: true, unit: 5, pingId: 0, revealR: 1 };
  }
  function isHex(sc) { return sc.grid === 'hexp' || sc.grid === 'hexf'; }
  function hexR(sc) { return sc.g / SQ3; }
  /* The hex under a point (axial q, r). */
  function hexAt(sc, x, y) {
    x -= sc.ox; y -= sc.oy;
    var R = hexR(sc), q, r;
    if (sc.grid === 'hexp') { q = (SQ3 / 3 * x - y / 3) / R; r = (2 / 3 * y) / R; } else { q = (2 / 3 * x) / R; r = (-x / 3 + SQ3 / 3 * y) / R; }
    var s = -q - r, rq = Math.round(q), rr = Math.round(r), rs = Math.round(s), dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
  }
  function hexCenter(sc, q, r) {
    var R = hexR(sc);
    return sc.grid === 'hexp' ? { x: sc.ox + sc.g * (q + r / 2), y: sc.oy + 1.5 * R * r } : { x: sc.ox + 1.5 * R * q, y: sc.oy + sc.g * (r + q / 2) };
  }
  function hexCorners(sc, c) {
    var R = hexR(sc), pts = [];
    for (var i = 0; i < 6; i++) { var a = Math.PI / 180 * (60 * i + (sc.grid === 'hexp' ? 30 : 0)); pts.push([c.x + R * Math.cos(a), c.y + R * Math.sin(a)]); }
    return pts;
  }
  /* A point snapped to the grid for a token of `size` squares (hexes: the hex's centre; no grid: unchanged). */
  function snap(sc, x, y, size) {
    if (sc.grid === 'none') return { x: x, y: y };
    if (isHex(sc)) { var h = hexAt(sc, x, y); return hexCenter(sc, h.q, h.r); }
    var n = Math.max(1, Math.round(size || 1)), g = sc.g, gx = (x - sc.ox) / g, gy = (y - sc.oy) / g;
    return n % 2 ? { x: (Math.floor(gx) + .5) * g + sc.ox, y: (Math.floor(gy) + .5) * g + sc.oy } : { x: Math.round(gx) * g + sc.ox, y: Math.round(gy) * g + sc.oy };
  }
  /* A point snapped to the nearest grid corner (walls), or the hex corner. */
  function snapCorner(sc, x, y, fine) {
    if (sc.grid === 'none') return { x: Math.round(x), y: Math.round(y) };
    var step = sc.g / (fine ? 2 : 1);
    if (isHex(sc)) { var c = hexCenter(sc, hexAt(sc, x, y).q, hexAt(sc, x, y).r), best = null, bd = 1e12; hexCorners(sc, c).forEach(function (p) { var d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = p; } }); return { x: best[0], y: best[1] }; }
    return { x: Math.round((x - sc.ox) / step) * step + sc.ox, y: Math.round((y - sc.oy) / step) * step + sc.oy };
  }
  /* Distance in squares (diagonals count 1) or hexes, as a whole number; with no grid, a straight line in squares. */
  function dist(sc, a, b) {
    if (isHex(sc)) { var p = hexAt(sc, a.x, a.y), q = hexAt(sc, b.x, b.y), dq = p.q - q.q, dr = p.r - q.r; return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)); }
    if (sc.grid === 'none') return Math.round(Math.hypot(a.x - b.x, a.y - b.y) / sc.g * 10) / 10;
    return Math.round(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / sc.g);
  }
  function distText(sc, n) {
    if (isHex(sc)) return n + (n === 1 ? ' hex' : ' hexes');
    return n + ' sq' + (sc.unit ? ' (' + Math.round(n * sc.unit) + ' ft)' : '');
  }
  function tokenSize(t) { return t.size || 1; }

  // ------------------------------------------------------------------ fog cells
  function fogCell(sc) { return Math.max(sc.g / 3, Math.max(sc.w, sc.h) / 240); }
  function fogDims(sc) { var c = fogCell(sc); return { cell: c, cw: Math.ceil(sc.w / c), ch: Math.ceil(sc.h / c) }; }
  /* Run-length encoding of cells valued 0-3 (a byte: value in the top two bits, run of 1-63 below), as base64. */
  function pack(arr) {
    var out = [], i = 0, n = arr.length;
    while (i < n) { var v = arr[i], j = i; while (j < n && arr[j] === v && j - i < 63) j++; out.push(v << 6 | j - i); i = j; }
    var s = '';
    for (var k = 0; k < out.length; k += 4096) s += String.fromCharCode.apply(null, out.slice(k, k + 4096));
    return btoa(s);
  }
  function unpack(str, n) {
    var arr = new Uint8Array(n), i = 0;
    try {
      var s = atob(str || '');
      for (var k = 0; k < s.length && i < n; k++) { var b = s.charCodeAt(k), v = b >> 6, run = b & 63; for (var j = 0; j < run && i < n; j++) arr[i++] = v; }
    } catch (e) { /* a damaged mask: everything hidden */ }
    return arr;
  }
  function seenOf(sc) {
    var d = fogDims(sc), key = d.cw + 'x' + d.ch;
    if (!sc._seen || sc._seenKey !== key + sc.seen) {
      sc._seen = sc.seenDims === key && sc.seen ? unpack(sc.seen, d.cw * d.ch) : new Uint8Array(d.cw * d.ch);
      sc._seenKey = key + sc.seen;
    }
    return sc._seen;
  }
  function saveSeen(sc) {
    var d = fogDims(sc);
    sc.seen = pack(sc._seen); sc.seenDims = d.cw + 'x' + d.ch; sc._seenKey = d.cw + 'x' + d.ch + sc.seen;
  }
  /* Hide or reveal (by hand) the cells within r px of a point. */
  function paintSeen(sc, x, y, r, reveal) {
    var d = fogDims(sc), a = seenOf(sc), changed = false;
    for (var cy = Math.max(0, Math.floor((y - r) / d.cell)); cy <= Math.min(d.ch - 1, Math.floor((y + r) / d.cell)); cy++) {
      for (var cx = Math.max(0, Math.floor((x - r) / d.cell)); cx <= Math.min(d.cw - 1, Math.floor((x + r) / d.cell)); cx++) {
        if (Math.hypot((cx + .5) * d.cell - x, (cy + .5) * d.cell - y) <= r + d.cell * .4 && a[cy * d.cw + cx] !== (reveal ? 1 : 0)) { a[cy * d.cw + cx] = reveal ? 1 : 0; changed = true; }
      }
    }
    if (changed) saveSeen(sc);
    return changed;
  }
  function fillSeen(sc, reveal) { var a = seenOf(sc); a.fill(reveal ? 1 : 0); saveSeen(sc); }
  /* Reveal (or hide) the cells whose centres are in a polygon of points [[x,y],...]. */
  function paintPoly(sc, pts, reveal) {
    var d = fogDims(sc), a = seenOf(sc), xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), changed = false;
    for (var cy = Math.max(0, Math.floor(Math.min.apply(null, ys) / d.cell)); cy <= Math.min(d.ch - 1, Math.floor(Math.max.apply(null, ys) / d.cell)); cy++) {
      for (var cx = Math.max(0, Math.floor(Math.min.apply(null, xs) / d.cell)); cx <= Math.min(d.cw - 1, Math.floor(Math.max.apply(null, xs) / d.cell)); cx++) {
        if (inPoly((cx + .5) * d.cell, (cy + .5) * d.cell, pts) && a[cy * d.cw + cx] !== (reveal ? 1 : 0)) { a[cy * d.cw + cx] = reveal ? 1 : 0; changed = true; }
      }
    }
    if (changed) saveSeen(sc);
    return changed;
  }
  function inPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------------ line of sight
  /* The segments that block sight (walls, closed doors) or movement (those and windows). */
  function blockers(sc, what) {
    return (sc.walls || []).filter(function (w) { return what === 'move' ? !(w.t === 'door' && w.open) : w.t === 'wall' || w.t === 'door' && !w.open; })
      .map(function (w) { return [w.a[0], w.a[1], w.b[0], w.b[1]]; });
  }
  function rayHit(px, py, dx, dy, s) {
    var sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-9) return Infinity;
    var t = ((s[0] - px) * sy - (s[1] - py) * sx) / den, u = ((s[0] - px) * dy - (s[1] - py) * dx) / den;
    return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
  }
  /* The area visible from a point within R px, as a polygon [[x,y],...]. */
  function los(px, py, segs, R) {
    var near = segs.filter(function (s) { return Math.max(s[0], s[2]) >= px - R && Math.min(s[0], s[2]) <= px + R && Math.max(s[1], s[3]) >= py - R && Math.min(s[1], s[3]) <= py + R; });
    var box = [[px - R, py - R, px + R, py - R], [px + R, py - R, px + R, py + R], [px + R, py + R, px - R, py + R], [px - R, py + R, px - R, py - R]];
    var all = near.concat(box), angles = [];
    all.forEach(function (s) { [[s[0], s[1]], [s[2], s[3]]].forEach(function (p) { var a = Math.atan2(p[1] - py, p[0] - px); angles.push(a - 1e-4, a, a + 1e-4); }); });
    angles.sort(function (a, b) { return a - b; });
    var pts = [];
    angles.forEach(function (a) {
      var dx = Math.cos(a), dy = Math.sin(a), best = Infinity;
      for (var i = 0; i < all.length; i++) { var t = rayHit(px, py, dx, dy, all[i]); if (t < best) best = t; }
      if (best < Infinity) pts.push([px + dx * best, py + dy * best]);
    });
    return pts;
  }
  /* Does a straight move from a to b cross a wall, a closed door, or a window? */
  function pathBlocked(sc, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1) return false;
    var segs = blockers(sc, 'move');
    for (var i = 0; i < segs.length; i++) { var t = rayHit(a.x, a.y, dx / len, dy / len, segs[i]); if (t > 1e-6 && t < len - 1e-6) return true; }
    return false;
  }

  // ------------------------------------------------------------------ vision
  var work = {};
  function canvas(name, w, h) {
    var c = work[name] || (work[name] = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d', { willReadFrequently: true }); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
    return g;
  }
  function poly(g, pts) { g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); }
  /* Who sees (the crows and allies on the map) and what lights it (tokens with a light, and each viewer's own sight). */
  function viewers(sc) { return sc.tokens.filter(function (t) { return (t.kind === 'pc' || t.kind === 'ally') && !t.dead && t.sees !== false && !t.hidden; }); }
  function lightsOf(sc) {
    var out = [];
    sc.tokens.forEach(function (t) {
      if (t.light && t.light.on !== false && (t.light.b || t.light.d)) out.push({ x: t.x, y: t.y, b: t.light.b || 0, d: t.light.d || 0, s: tokenSize(t) });
    });
    viewers(sc).forEach(function (t) { var s = t.sight == null ? 1 : t.sight; if (s > 0) out.push({ x: t.x, y: t.y, b: s, d: 0, s: tokenSize(t) }); });
    return out;
  }
  /*
   * The fog mask for a scene: { cw, ch, cell, cells: Uint8Array } (0 hidden, 1 explored, 2 dim, 3 bright), or null with no fog. In vision mode the
   * explored memory grows (scene.seen); in manual mode a revealed cell is bright. Returns what changed in .grew.
   */
  function computeVision(sc) {
    if (sc.fog === 'off') return null;
    var d = fogDims(sc), seen = seenOf(sc), cells = new Uint8Array(d.cw * d.ch), i;
    if (sc.fog === 'manual') { for (i = 0; i < cells.length; i++) cells[i] = seen[i] ? 3 : 0; return { cw: d.cw, ch: d.ch, cell: d.cell, cells: cells, grew: false }; }
    var segs = blockers(sc, 'sight'), vs = viewers(sc), big = Math.max(sc.w, sc.h) * 1.5, k = 1 / d.cell;
    var L = canvas('L', d.cw, d.ch), V = canvas('V', d.cw, d.ch), grew = false;
    L.setTransform(k, 0, 0, k, 0, 0); V.setTransform(k, 0, 0, k, 0, 0);
    if (sc.ambient !== 'dark') { L.fillStyle = 'rgba(255,255,255,' + (sc.ambient === 'dim' ? .5 : 1) + ')'; L.fillRect(0, 0, sc.w, sc.h); }
    lightsOf(sc).forEach(function (l) {
      var rb = (l.b + l.s / 2) * sc.g, rd = rb + l.d * sc.g, g = L;
      g.save(); poly(g, los(l.x, l.y, segs, rd)); g.clip();
      var gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, rd), f = rb / rd;
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(Math.min(1, f), 'rgba(255,255,255,1)');
      if (l.d) { gr.addColorStop(Math.min(1, f + .002), 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,.5)'); }
      g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, rd, 0, 7); g.fill(); g.restore();
    });
    V.fillStyle = '#fff';
    vs.forEach(function (t) { poly(V, los(t.x, t.y, segs, big)); V.fill(); });
    L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'destination-in'; L.drawImage(V.canvas, 0, 0);
    var px = L.getImageData(0, 0, d.cw, d.ch).data;
    for (i = 0; i < cells.length; i++) {
      var a = px[i * 4 + 3];
      cells[i] = a >= 200 ? 3 : a >= 70 ? 2 : seen[i] ? 1 : 0;
      if (cells[i] >= 2 && !seen[i]) { seen[i] = 1; grew = true; }
    }
    if (grew) saveSeen(sc);
    return { cw: d.cw, ch: d.ch, cell: d.cell, cells: cells, grew: grew };
  }
  function packMask(m) { return m ? { cw: m.cw, ch: m.ch, cell: m.cell, d: pack(m.cells) } : null; }
  function unpackMask(p) { return p && p.d ? { cw: p.cw, ch: p.ch, cell: p.cell, cells: unpack(p.d, p.cw * p.ch) } : null; }
  function maskAt(m, x, y) {
    if (!m) return 3;
    var cx = Math.floor(x / m.cell), cy = Math.floor(y / m.cell);
    return cx < 0 || cy < 0 || cx >= m.cw || cy >= m.ch ? 0 : m.cells[cy * m.cw + cx];
  }

  // ------------------------------------------------------------------ pictures
  var pics = {};
  function pic(src, done) {
    if (!src) return null;
    var p = pics[src];
    if (p) return p.ok ? p.img : null;
    p = pics[src] = { img: new Image(), ok: false };
    p.img.onload = function () { p.ok = true; if (done) done(); };
    p.img.onerror = function () { p.bad = true; };
    p.img.src = src;
    return null;
  }
  var squares = {};
  /* A small square crop of a picture (96 px, a data URL) for a token; calls back once it's ready. Cached by source. */
  function tokenArt(src, cb) {
    if (!src) return;
    if (squares[src]) { cb(squares[src]); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas'), n = Math.min(img.naturalWidth, img.naturalHeight); c.width = c.height = 96;
        c.getContext('2d').drawImage(img, (img.naturalWidth - n) / 2, Math.max(0, (img.naturalHeight - n) / 3), n, n, 0, 0, 96, 96);
        squares[src] = c.toDataURL('image/jpeg', .8); cb(squares[src]);
      } catch (e) { /* a picture the browser won't read back */ }
    };
    img.src = src;
  }

  // ------------------------------------------------------------------ the view
  /*
   * options: ref (the Ref's controls and view), scene() -> the scene, mask() -> the fog mask, tokenSrc(t), mapSrc(scene), canMove(t),
   * speedOf(t), onSelect(t | null), onMove(t, x, y), onPing(x, y), onWall(seg), onErase(wall), onDoor(wall), onPaint(x, y, r, reveal),
   * onRoom(rect), onFogRect(pts, reveal), onMenu(token | null, event, world point), onPin(pin), onDrop(x, y), onFrame() (after each drawn frame: overlays follow the camera)
   *
   * Everything that changes is animated (unless the system asks for reduced motion): tokens glide to where they moved, pop in when they
   * arrive and fade out when they go, flash red when hurt and green when healed, and fall when they die; new conditions pop, the fog fades
   * as it opens, walls draw themselves in, doors flash, pins drop, and the camera glides. The view diffs the scene each frame to find these.
   */
  var RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ------------------------------------------------------------------ the environment's look (REF.ENV keys)
  /* Each effect draws into the view's weather canvas: (ctx, R: the map's rectangle on screen { x, y, w, h, W, H, g, t, dt }, its own
     particles (kept between frames), the shared state). Particles live in viewport pixels and wrap around it. Subtle on purpose. */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function tint(c, R, color) { c.fillStyle = color; c.fillRect(R.x, R.y, R.w, R.h); }
  function vignette(c, R, color, inner) {
    var cx = R.x + R.w / 2, cy = R.y + R.h / 2, r = Math.hypot(R.w, R.h) / 2, gr = c.createRadialGradient(cx, cy, r * (inner || .35), cx, cy, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, color); c.fillStyle = gr; c.fillRect(R.x, R.y, R.w, R.h);
  }
  function seed(P, n, make) { while (P.length < n) P.push(make(true)); if (P.length > n) P.length = n; }
  function count(R, per, max) { return Math.min(max, Math.round(R.W * R.H / per)); }
  function wrap(p, R, pad) {
    if (p.x < -pad) p.x += R.W + 2 * pad; else if (p.x > R.W + pad) p.x -= R.W + 2 * pad;
    if (p.y < -pad) p.y += R.H + 2 * pad; else if (p.y > R.H + pad) p.y -= R.H + 2 * pad;
  }
  /* Soft drifting blobs (haze, fog, smoke). */
  function blobs(c, R, P, n, rgb, alpha, size, speed) {
    seed(P, n, function () { return { x: rnd(0, R.W), y: rnd(0, R.H), r: rnd(.6, 1.2) * size, vx: rnd(.4, 1) * speed, vy: rnd(-.3, .3) * speed, ph: rnd(0, 6.3) }; });
    P.forEach(function (p) {
      p.x += p.vx * R.dt; p.y += p.vy * R.dt; wrap(p, R, p.r);
      var a = alpha * (.75 + .25 * Math.sin(R.t * .4 + p.ph)), gr = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      c.fillStyle = gr; c.fillRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r);
    });
  }
  /* Falling or blowing streaks (rain, sand). */
  function streaks(c, R, P, n, color, vx, vy, len, width) {
    seed(P, n, function () { return { x: rnd(0, R.W), y: rnd(0, R.H), s: rnd(.7, 1.3) }; });
    var sp = Math.hypot(vx, vy), ux = vx / sp, uy = vy / sp;
    c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.beginPath();
    P.forEach(function (p) {
      p.x += vx * p.s * R.dt; p.y += vy * p.s * R.dt; wrap(p, R, len);
      c.moveTo(p.x, p.y); c.lineTo(p.x - ux * len * p.s, p.y - uy * len * p.s);
    });
    c.stroke();
  }
  /* Round particles (snow, embers). */
  function flakes(c, R, P, n, make, color) {
    seed(P, n, make);
    P.forEach(function (p) {
      p.x += (p.vx + Math.sin(R.t * p.f + p.ph) * p.sway) * R.dt; p.y += p.vy * R.dt; wrap(p, R, 10);
      c.globalAlpha = p.a * (p.flick ? .55 + .45 * Math.sin(R.t * p.flick + p.ph) : 1); c.fillStyle = color;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill();
    });
    c.globalAlpha = 1;
  }
  /* Rings spreading on a surface (water, blood). */
  function ripples(c, R, P, n, rgb) {
    seed(P, n, function (first) { return { x: rnd(R.x, R.x + R.w), y: rnd(R.y, R.y + R.h), t0: R.t - (first ? rnd(0, 3) : 0), dur: rnd(2.2, 3.6), r: rnd(.5, 1.1) * Math.max(14, R.g) }; });
    for (var i = 0; i < P.length; i++) {
      var p = P[i], k = (R.t - p.t0) / p.dur;
      if (k >= 1 || k < 0) { P[i] = { x: rnd(R.x, R.x + R.w), y: rnd(R.y, R.y + R.h), t0: R.t, dur: rnd(2.2, 3.6), r: rnd(.5, 1.1) * Math.max(14, R.g) }; continue; }
      c.strokeStyle = 'rgba(' + rgb + ',' + (.28 * (1 - k)) + ')'; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(p.x, p.y, p.r * k + 2, (p.r * k + 2) * .45, 0, 0, 7); c.stroke();
    }
  }
  var ENV_FX = {
    dim: function (c, R) { tint(c, R, 'rgba(12,14,34,.16)'); vignette(c, R, 'rgba(6,6,18,.35)'); },
    dark: function (c, R) { tint(c, R, 'rgba(2,2,10,' + (.36 + .03 * Math.sin(R.t * .7)) + ')'); vignette(c, R, 'rgba(0,0,6,.6)', .2); },
    smoke: function (c, R, P) { tint(c, R, 'rgba(70,70,72,.12)'); blobs(c, R, P, count(R, 60000, 26), '150,150,155', .22, Math.max(120, R.g * 3), 14); },
    miasma: function (c, R, P) { tint(c, R, 'rgba(110,128,96,.07)'); blobs(c, R, P, count(R, 90000, 18), '140,160,120', .12, Math.max(160, R.g * 4), 9); },
    strong: function (c, R, P) { tint(c, R, 'rgba(150,158,150,.2)'); blobs(c, R, P, count(R, 45000, 34), '185,190,182', .26, Math.max(170, R.g * 4), 12); },
    rain: function (c, R, P) { tint(c, R, 'rgba(30,45,70,.08)'); streaks(c, R, P, count(R, 2600, 420), 'rgba(175,195,225,.32)', -90, 640, 16, 1); },
    storm: function (c, R, P, S) {
      tint(c, R, 'rgba(18,24,44,.16)'); streaks(c, R, P, count(R, 1500, 700), 'rgba(185,200,230,.38)', -220, 820, 20, 1.1);
      if (R.dt && !S.next) S.next = R.t + rnd(5, 12);
      if (R.dt && R.t >= S.next) { S.flash = R.t; S.next = R.t + rnd(6, 15); }
      var k = R.t - S.flash;
      if (k >= 0 && k < .6) { var a = k < .08 ? .3 : k < .16 ? .05 : k < .26 ? .22 : .22 * (1 - (k - .26) / .34); tint(c, R, 'rgba(230,236,255,' + Math.max(0, a) + ')'); }
    },
    blizzard: function (c, R, P) {
      tint(c, R, 'rgba(225,232,240,.13)');
      flakes(c, R, P, count(R, 2200, 520), function () { return { x: rnd(0, R.W), y: rnd(0, R.H), vx: rnd(260, 420), vy: rnd(60, 140), r: rnd(.8, 2.2), a: rnd(.5, .9), sway: 30, f: rnd(1, 3), ph: rnd(0, 6.3) }; }, '#f4f8ff');
    },
    cold: function (c, R, P) {
      vignette(c, R, 'rgba(170,215,255,.32)', .45);
      flakes(c, R, P, count(R, 9000, 140), function () { return { x: rnd(0, R.W), y: rnd(0, R.H), vx: rnd(-8, 12), vy: rnd(18, 40), r: rnd(.8, 1.8), a: rnd(.45, .8), sway: 14, f: rnd(.5, 1.5), ph: rnd(0, 6.3) }; }, '#eef6ff');
    },
    heat: function (c, R) {
      tint(c, R, 'rgba(255,150,60,.07)'); vignette(c, R, 'rgba(255,120,30,.16)', .5);
      var step = Math.max(34, R.h / 12); c.strokeStyle = 'rgba(255,235,200,.035)'; c.lineWidth = Math.max(2, step * .18);
      for (var y = R.y + R.h - ((R.t * 22) % step); y > R.y - step; y -= step) {
        c.beginPath();
        for (var x = R.x; x <= R.x + R.w; x += 18) c.lineTo(x, y + Math.sin(x / 55 + R.t * 2 + y / 40) * 4);
        c.stroke();
      }
    },
    sand: function (c, R, P) {
      tint(c, R, 'rgba(196,154,92,' + (.16 + .04 * Math.sin(R.t * .9)) + ')');
      streaks(c, R, P, count(R, 2000, 520), 'rgba(222,188,130,.42)', 720, 70, 10, 1.4);
    },
    water: function (c, R, P) { tint(c, R, 'rgba(40,96,150,.12)'); ripples(c, R, P, count(R, 50000, 22), '200,230,255'); },
    blood: function (c, R, P) { tint(c, R, 'rgba(110,8,12,.13)'); ripples(c, R, P, count(R, 60000, 16), '255,120,120'); },
    fire: function (c, R, P) {
      var gr = c.createLinearGradient(0, R.y + R.h, 0, R.y + R.h * .55); gr.addColorStop(0, 'rgba(255,110,30,' + (.16 + .04 * Math.sin(R.t * 3)) + ')'); gr.addColorStop(1, 'rgba(255,110,30,0)');
      c.fillStyle = gr; c.fillRect(R.x, R.y, R.w, R.h);
      flakes(c, R, P, count(R, 12000, 110), function () { return { x: rnd(0, R.W), y: rnd(0, R.H), vx: rnd(-10, 10), vy: rnd(-70, -30), r: rnd(.8, 2), a: rnd(.6, 1), sway: 22, f: rnd(1, 3), ph: rnd(0, 6.3), flick: rnd(6, 14) }; }, '#ffb35c');
    }
  };
  T.ENV_FX = Object.keys(ENV_FX);
  function ease(k) { return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
  function backOut(k) { var c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
  function bounceOut(k) {
    if (k < 1 / 2.75) return 7.5625 * k * k;
    if (k < 2 / 2.75) { k -= 1.5 / 2.75; return 7.5625 * k * k + .75; }
    if (k < 2.5 / 2.75) { k -= 2.25 / 2.75; return 7.5625 * k * k + .9375; }
    k -= 2.625 / 2.75; return 7.5625 * k * k + .984375;
  }
  function view(host, o) {
    var cv = document.createElement('canvas'), ctx = cv.getContext('2d'), cam = { x: 0, y: 0, z: 1 }, V = { tool: 'select', player: false, sel: null, ghost: {}, pings: [], size: { w: 0, h: 0 }, dpr: 1,
      brush: 1, drag: null, hover: null, ruler: null, chain: null, queued: false, sceneId: null, fogImg: null, fogKey: '', lastPing: 0, spaceDown: false, keep: {},
      // animation state: shown positions, tweens, what each token looked like last frame, arrivals, departures, effects
      shown: {}, tw: {}, seen: {}, born: {}, leaving: [], fx: {}, condT: {}, alpha: {}, floats: [], rings: [], camTw: null, fogPrev: null, fogT0: 0, sceneT0: 0,
      primed: false, intro: 0, wallSeen: {}, wallT: {}, pinSeen: {}, pinT: {}, selT0: 0, lastT: 0, busy: false };
    cv.className = 'vtt-canvas'; cv.tabIndex = 0; cv.style.touchAction = 'none';
    host.appendChild(cv);
    var wx = document.createElement('canvas'), wctx = wx.getContext('2d'); wx.className = 'vtt-weather'; wx.setAttribute('aria-hidden', 'true'); host.appendChild(wx);
    var tip = document.createElement('div'); tip.className = 'vtt-ttip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; host.appendChild(tip);

    function sc() { return o.scene(); }
    function toWorld(ev) { var r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / cam.z + cam.x, y: (ev.clientY - r.top) / cam.z + cam.y }; }
    function redraw() { if (V.queued) return; V.queued = true; requestAnimationFrame(function () { V.queued = false; draw(); }); }
    function resize() {
      var r = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      V.size = { w: Math.max(100, r.width), h: Math.max(100, r.height) }; V.dpr = dpr;
      if (V.fitPending && r.width >= 50) { V.fitPending = false; setTimeout(fit, 0); }
      cv.width = Math.round(V.size.w * dpr); cv.height = Math.round(V.size.h * dpr); cv.style.width = V.size.w + 'px'; cv.style.height = V.size.h + 'px';
      wx.width = cv.width; wx.height = cv.height; wx.style.width = cv.style.width; wx.style.height = cv.style.height; Wx.parts = {};
      redraw();
    }
    /* Move the camera so world point (cx, cy) is in the middle at zoom z, gliding over ms (zoom eases in log space so it feels even). */
    function camTo(cx, cy, z, ms) {
      if (RM || !ms) { V.camTw = null; cam.z = z; cam.x = cx - V.size.w / z / 2; cam.y = cy - V.size.h / z / 2; redraw(); return; }
      V.camTw = { a: { cx: cam.x + V.size.w / cam.z / 2, cy: cam.y + V.size.h / cam.z / 2, z: cam.z }, b: { cx: cx, cy: cy, z: z }, t0: Date.now(), dur: ms }; redraw();
    }
    function stepCam(now) {
      var t = V.camTw; if (!t) return;
      var k = Math.min(1, (now - t.t0) / t.dur), e = ease(k), z = Math.exp(Math.log(t.a.z) + (Math.log(t.b.z) - Math.log(t.a.z)) * e);
      cam.z = z; cam.x = t.a.cx + (t.b.cx - t.a.cx) * e - V.size.w / z / 2; cam.y = t.a.cy + (t.b.cy - t.a.cy) * e - V.size.h / z / 2;
      if (k >= 1) V.camTw = null; else V.busy = true;
    }
    function fit(anim) {
      var s = sc(); if (!s) return;
      var r = host.getBoundingClientRect();
      if (r.width < 50) { V.fitPending = true; return; }
      if (Math.abs(r.width - V.size.w) > 1 || Math.abs(r.height - V.size.h) > 1) resize();   // measured before the canvas was sized
      camTo(s.w / 2, s.h / 2, Math.max(.05, Math.min(V.size.w / s.w, V.size.h / s.h)), anim === true ? 450 : 0);
    }
    function centerOn(x, y, anim) { camTo(x, y, cam.z, anim ? 420 : 0); }
    function zoomAt(f, sx, sy, anim) {
      var s = sc(); if (!s) return;
      var z0 = V.camTw ? V.camTw.b.z : cam.z, lo = Math.min(V.size.w / s.w, V.size.h / s.h) * .4, nz = Math.max(lo, Math.min(5, z0 * f));
      if (V.camTw) { var b = V.camTw.b; camTo(b.cx, b.cy, nz, 200); return; }
      var wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
      camTo(wx - sx / nz + V.size.w / nz / 2, wy - sy / nz + V.size.h / nz / 2, nz, anim ? 200 : 0);
    }
    function tokens() { var s = sc(); return s ? s.tokens.filter(function (t) { return !(V.player && t.hidden); }) : []; }
    function target(t) { var g = V.ghost[t.id]; return g && g.until > Date.now() ? g : t; }
    function pos(t) { return V.shown[t.id] || target(t); }
    function radius(s, t) { return Math.max(.35, tokenSize(t) * .46) * s.g; }
    /*
     * Once a frame: glide each token toward where it is now (a drag follows the pointer at once), and note what changed since the last
     * frame (hurt, healed, died, a new condition) to start its effect. Tokens that are new pop in (staggered when a scene opens);
     * tokens that are gone fade out.
     */
    function stepTokens(s, now) {
      var here = {};
      tokens().forEach(function (t) {
        here[t.id] = true;
        var tg = target(t), g = V.ghost[t.id], prev = V.seen[t.id], sh = V.shown[t.id];
        if (!prev || !sh) {
          V.shown[t.id] = { x: tg.x, y: tg.y };
          if (!RM) V.born[t.id] = now + (V.primed ? 0 : Math.min(900, V.intro++ * 45));
        } else {
          var tw = V.tw[t.id];
          if (RM || g && g.drag) { delete V.tw[t.id]; tw = null; V.shown[t.id] = { x: tg.x, y: tg.y }; }
          else if (!tw || tw.tx !== tg.x || tw.ty !== tg.y) {
            if (Math.abs(sh.x - tg.x) > .5 || Math.abs(sh.y - tg.y) > .5) {
              var d = Math.hypot(sh.x - tg.x, sh.y - tg.y) / s.g;
              tw = V.tw[t.id] = { fx: sh.x, fy: sh.y, tx: tg.x, ty: tg.y, t0: now, dur: Math.min(900, 240 + d * 70) };
            } else { delete V.tw[t.id]; tw = null; V.shown[t.id] = { x: tg.x, y: tg.y }; }
          }
          if (tw) {
            var k = Math.min(1, (now - tw.t0) / tw.dur), e = ease(k);
            V.shown[t.id] = { x: tw.fx + (tw.tx - tw.fx) * e, y: tw.fy + (tw.ty - tw.fy) * e };
            if (k >= 1) delete V.tw[t.id]; else V.busy = true;
          }
          if (!RM) {
            if (prev.hpf != null && t.hpf != null && t.hpf < prev.hpf - 1e-6) V.fx[t.id] = { type: 'hit', t0: now };
            else if (prev.hpf != null && t.hpf != null && t.hpf > prev.hpf + 1e-6) V.fx[t.id] = { type: 'heal', t0: now };
            if (t.dead && !prev.dead) V.fx[t.id] = { type: 'die', t0: now };
            (t.conds || []).forEach(function (c) { if (prev.conds.indexOf(c) < 0) V.condT[t.id + '|' + c] = now; });
          }
        }
        V.seen[t.id] = { hpf: t.hpf, dead: !!t.dead, conds: (t.conds || []).slice(), t: t };
      });
      Object.keys(V.seen).forEach(function (id) {
        if (here[id]) return;
        if (!RM && V.primed && V.shown[id]) V.leaving.push({ t: V.seen[id].t, p: V.shown[id], t0: now });
        delete V.seen[id]; delete V.shown[id]; delete V.tw[id]; delete V.fx[id]; delete V.born[id]; delete V.alpha[id];
      });
      V.primed = true;
    }
    function hitToken(w) {
      var list = tokens().slice().sort(function (a, b) { return tokenSize(a) - tokenSize(b); }), s = sc();
      for (var i = 0; i < list.length; i++) { var t = list[i], p = pos(t); if (Math.hypot(p.x - w.x, p.y - w.y) <= Math.max(.35, tokenSize(t) * .5) * s.g) return t; }
      return null;
    }
    function hitWall(w) {
      var s = sc(), best = null, bd = 8 / cam.z + s.g * .12;
      (s.walls || []).forEach(function (k) {
        var dx = k.b[0] - k.a[0], dy = k.b[1] - k.a[1], l2 = dx * dx + dy * dy || 1, u = Math.max(0, Math.min(1, ((w.x - k.a[0]) * dx + (w.y - k.a[1]) * dy) / l2));
        var d = Math.hypot(k.a[0] + u * dx - w.x, k.a[1] + u * dy - w.y); if (d < bd) { bd = d; best = k; }
      });
      return best;
    }
    function hitPin(w) {
      var s = sc(), list = (s.pins || []).filter(function (p) { return o.ref && !V.player || p.vis; });
      for (var i = 0; i < list.length; i++) if (Math.hypot(list[i].x - w.x, list[i].y - w.y) < s.g * .4) return list[i];
      return null;
    }
    function movable(t) { return o.canMove ? o.canMove(t) : false; }

    // ---- drawing
    function drawGrid(s) {
      if (s.grid === 'none' || s.showGrid === false) return;
      ctx.save(); ctx.strokeStyle = s.map ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.12)'; ctx.lineWidth = 1 / cam.z; ctx.beginPath();
      var x0 = cam.x, y0 = cam.y, x1 = cam.x + V.size.w / cam.z, y1 = cam.y + V.size.h / cam.z;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(s.w, x1); y1 = Math.min(s.h, y1);
      if (isHex(s)) {
        var a = hexAt(s, x0, y0), b = hexAt(s, x1, y1), span = Math.ceil(Math.max(x1 - x0, y1 - y0) / s.g) + 3, c0 = hexAt(s, (x0 + x1) / 2, (y0 + y1) / 2);
        for (var dq = -span; dq <= span; dq++) for (var dr = -span; dr <= span; dr++) {
          var c = hexCenter(s, c0.q + dq, c0.r + dr);
          if (c.x < x0 - s.g || c.x > x1 + s.g || c.y < y0 - s.g || c.y > y1 + s.g) continue;
          hexCorners(s, c).forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath();
        }
        void a; void b;
      } else {
        for (var x = s.ox + Math.floor((x0 - s.ox) / s.g) * s.g; x <= x1; x += s.g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (var y = s.oy + Math.floor((y0 - s.oy) / s.g) * s.g; y <= y1; y += s.g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      }
      ctx.stroke(); ctx.restore();
    }
    /* A token, with its arrival, departure (a: { p, scale, alpha }), and effects. */
    function drawToken(s, t, a) {
      var now = Date.now(), p = a && a.p || pos(t), r = radius(s, t), kc = t.color || KIND_COLOR[t.kind] || '#888', scale = a && a.scale != null ? a.scale : 1, alpha = 1;
      var b = V.born[t.id];
      if (b && !a) {
        var kb = (now - b) / 380; V.busy = true;
        if (kb < 0) return;
        if (kb >= 1) delete V.born[t.id]; else { scale *= Math.max(.01, backOut(kb)); alpha *= Math.min(1, kb * 2.5); }
      }
      // fade toward how it should look (hidden, dead, done this round) rather than snapping
      var want = (t.hidden ? .5 : 1) * (t.dead ? .55 : t.acted ? .75 : 1), cur = V.alpha[t.id] == null || RM ? want : V.alpha[t.id];
      if (Math.abs(cur - want) > .01) { cur += (want - cur) * Math.min(1, Math.min(50, now - V.lastT) / 120); V.busy = true; } else cur = want;
      if (!a) V.alpha[t.id] = cur;
      alpha *= cur * (a && a.alpha != null ? a.alpha : 1);
      var fx = !a && V.fx[t.id], fk = 0, dx = 0;
      if (fx) {
        fk = (now - fx.t0) / (fx.type === 'hit' ? 520 : fx.type === 'heal' ? 800 : 750);
        if (fk >= 1) { delete V.fx[t.id]; fx = null; } else { V.busy = true; if (fx.type === 'hit') dx = Math.sin(fk * 30) * r * .16 * (1 - fk); }
      }
      var dragging = V.drag && V.drag.type === 'token' && V.drag.token.id === t.id && V.drag.moved;
      if (dragging) scale *= 1.08;
      ctx.save(); ctx.translate(p.x + dx, p.y); if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      if (fx && fx.type === 'die') { ctx.rotate(Math.sin(fk * Math.PI) * .25); }
      if (t.light && t.light.on !== false && (o.ref && !V.player)) { ctx.beginPath(); ctx.arc(0, 0, r + 3 / cam.z, 0, 7); ctx.strokeStyle = 'rgba(255,200,90,.9)'; ctx.lineWidth = 3 / cam.z; ctx.stroke(); }
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = dragging ? 18 : 7; ctx.shadowOffsetY = dragging ? 6 : 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = kc; ctx.fill(); ctx.restore();
      var src = o.tokenSrc ? o.tokenSrc(t) : null, im = src ? pic(src, redraw) : null;
      if (im) { ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.clip(); ctx.drawImage(im, -r, -r, r * 2, r * 2); ctx.restore(); }
      else if (t.kind === 'obj') { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.font = 'bold ' + r * 1.1 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.icon || (t.light ? '✶' : '◆'), 0, 0); }
      else { ctx.fillStyle = '#fff'; ctx.font = 'bold ' + r * .95 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((t.name || '?').replace(/^(the|a|an)\s+/i, '').slice(0, 2).toUpperCase(), 0, 0); }
      if (fx && fx.type === 'hit') { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = 'rgba(230,40,30,' + (.6 * (1 - fk)) + ')'; ctx.fill(); }
      if (fx && fx.type === 'heal') {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = 'rgba(90,220,120,' + (.4 * (1 - fk)) + ')'; ctx.fill();
        for (var hi = 0; hi < 2; hi++) { var hk = Math.max(0, fk - hi * .2); ctx.beginPath(); ctx.arc(0, 0, r * (1 + easeOut(hk) * .7), 0, 7); ctx.strokeStyle = 'rgba(110,235,140,' + (1 - hk) * .9 + ')'; ctx.lineWidth = 3 / cam.z; ctx.stroke(); }
      }
      if (fx && fx.type === 'die') { ctx.beginPath(); ctx.arc(0, 0, r * (1 + easeOut(fk) * .9), 0, 7); ctx.strokeStyle = 'rgba(255,255,255,' + (1 - fk) * .8 + ')'; ctx.lineWidth = 4 / cam.z; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.lineWidth = Math.max(2.5, r * .1); ctx.strokeStyle = t.hidden ? '#9aa' : kc;
      if (t.hidden) ctx.setLineDash([r * .3, r * .2]);
      ctx.stroke(); ctx.setLineDash([]);
      if (t.mine) { ctx.beginPath(); ctx.arc(0, 0, r + 4 / cam.z, 0, 7); ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 2.5 / cam.z; ctx.stroke(); }
      if (V.sel === t.id && !a) {
        var sk = RM ? 1 : Math.min(1, (now - V.selT0) / 320); if (sk < 1) V.busy = true;
        ctx.beginPath(); ctx.arc(0, 0, r + (6 + (1 - easeOut(sk)) * 16) / cam.z, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,' + (.4 + .6 * sk) + ')'; ctx.lineWidth = 2 / cam.z;
        ctx.setLineDash([6 / cam.z, 4 / cam.z]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (t.dead) {
        var xk = fx && fx.type === 'die' ? Math.min(1, fk * 1.6) : 1, xr = r * .6;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * .12); ctx.beginPath();
        ctx.moveTo(-xr, -xr); ctx.lineTo(-xr + 2 * xr * Math.min(1, xk * 2), -xr + 2 * xr * Math.min(1, xk * 2));
        if (xk > .5) { ctx.moveTo(xr, -xr); ctx.lineTo(xr - 2 * xr * (xk - .5) * 2, -xr + 2 * xr * (xk - .5) * 2); }
        ctx.stroke();
      }
      if (t.hpf != null && !t.dead) {   // Stamina, and a thin AD bar under it when there's armor
        var bw = r * 1.7, bh = Math.max(r * .2, 4 / cam.z), by = r * .74; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(-bw / 2, by, bw, bh);
        ctx.fillStyle = t.hpf > .6 ? '#5fbf6a' : t.hpf > .3 ? '#e0b43f' : '#d6544a'; ctx.fillRect(-bw / 2, by, bw * Math.max(0, Math.min(1, t.hpf)), bh);
        if (t.adf != null) { var ah = bh * .55; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(-bw / 2, by + bh, bw, ah); ctx.fillStyle = '#6fa8dc'; ctx.fillRect(-bw / 2, by + bh, bw * Math.max(0, Math.min(1, t.adf)), ah); }
      } else if (t.hw && !t.dead) {   // only how hurt it looks
        var hf = Math.max(r * .26, 9 / cam.z); ctx.font = 'bold ' + hf + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var hw = ctx.measureText(t.hw).width + hf * .7, hy = r * .78;
        ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(-hw / 2, hy - hf * .62, hw, hf * 1.24);
        ctx.fillStyle = HW_COLOR[t.hw] || '#ddd'; ctx.fillText(t.hw, 0, hy);
      }
      // conditions: a ring of small markers over the token's top edge (hover the token for their names)
      var cl = t.conds || [], cm = cl.length > 7 ? 6 : cl.length, mr = Math.max(r * .22, 6 / cam.z);
      for (var ci = 0; ci < cm + (cl.length > cm ? 1 : 0); ci++) {
        var c = ci < cm ? cl[ci] : null, ang = (-50 - ci * 30) * Math.PI / 180, cx = Math.cos(ang) * r * 1.02, cy = Math.sin(ang) * r * 1.02, ck0 = c && V.condT[t.id + '|' + c], cs = 1;
        if (ck0) { var ck = (now - ck0) / 420; if (ck >= 1) delete V.condT[t.id + '|' + c]; else { cs = Math.max(.01, backOut(ck)); V.busy = true; } }
        var st = c ? condStyle(c) : ['#333', '+' + (cl.length - cm)];
        ctx.save(); ctx.translate(cx, cy); ctx.scale(cs, cs);
        ctx.beginPath(); ctx.arc(0, 0, mr, 0, 7); ctx.fillStyle = st[0]; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5 / cam.z; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold ' + mr * (st[1].length > 1 ? .95 : 1.2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st[1], 0, mr * .06); ctx.restore();
      }
      if (t.name && (t.kind !== 'obj' || t.label)) {
        ctx.font = 'bold ' + Math.max(11 / cam.z, s.g * .2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var ty = r + (t.hpf != null ? r * .28 : 3 / cam.z); ctx.lineWidth = 3 / cam.z; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(t.name, 0, ty); ctx.fillStyle = '#fff'; ctx.fillText(t.name, 0, ty);
        if (t.vit && o.vitals && o.vitals()) {   // the Ref's full vitals, under the name
          var vf = Math.max(10 / cam.z, s.g * .16), vy = ty + Math.max(11 / cam.z, s.g * .2) * 1.15; ctx.font = '600 ' + vf + 'px sans-serif';
          ctx.strokeText(t.vit, 0, vy); ctx.fillStyle = '#ffe3a3'; ctx.fillText(t.vit, 0, vy);
        }
      }
      ctx.restore();
    }
    /*
     * The fog as a picture: the mask's cells, blurred once into a larger canvas (so drawing it each frame is cheap). When the mask changes,
     * the old picture fades out over the new one, so newly seen ground opens up rather than popping.
     */
    function fogImage(m) {
      if (!m) { V.fogImg = null; V.fogMask = null; return null; }
      var key = m.cw + 'x' + m.ch + (V.player ? 'p' : 'r');
      if (!V.fogImg || V.fogKey !== key || V.fogMask !== m) {
        var raw = document.createElement('canvas'); raw.width = m.cw; raw.height = m.ch;
        var g = raw.getContext('2d'), im = g.createImageData(m.cw, m.ch), A = V.player ? [255, 150, 90, 0] : [150, 100, 48, 0];
        for (var i = 0; i < m.cells.length; i++) { var j = i * 4; im.data[j] = 6; im.data[j + 1] = 5; im.data[j + 2] = 10; im.data[j + 3] = A[m.cells[i]]; }
        g.putImageData(im, 0, 0);
        var S = Math.max(1, Math.min(8, Math.floor(2048 / Math.max(m.cw, m.ch)))), c = document.createElement('canvas');
        c.width = m.cw * S; c.height = m.ch * S;
        var g2 = c.getContext('2d'); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
        if ('filter' in g2) g2.filter = 'blur(' + S * .55 + 'px)';
        g2.drawImage(raw, 0, 0, c.width, c.height);
        if (V.fogImg && !RM) { V.fogPrev = { img: V.fogImg, w: V.fogW, h: V.fogH }; V.fogT0 = Date.now(); }
        V.fogImg = c; V.fogW = m.cw * m.cell; V.fogH = m.ch * m.cell; V.fogKey = key; V.fogMask = m;
      }
      return V.fogImg;
    }
    function drawPins(s, m, now) {
      (s.pins || []).forEach(function (p) {
        if (V.player && !p.vis) return;
        if (V.player && m && maskAt(m, p.x, p.y) < 1) return;
        var id = p.id || p.x + ',' + p.y, dy = 0;
        if (!V.pinSeen[id]) { V.pinSeen[id] = true; if (V.primed && !RM) V.pinT[id] = now; }
        if (V.pinT[id]) { var k = (now - V.pinT[id]) / 650; if (k >= 1) delete V.pinT[id]; else { dy = -(1 - bounceOut(k)) * s.g * .9; V.busy = true; } }
        ctx.save(); ctx.translate(p.x, p.y + dy); var r = s.g * .22;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = p.vis ? '#e8c14a' : '#7a7ad0'; ctx.fill(); ctx.restore();
        ctx.lineWidth = 2 / cam.z; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
        ctx.font = 'bold ' + Math.max(11 / cam.z, s.g * .2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3 / cam.z;
        ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(p.label || '', 0, r + 3 / cam.z); ctx.fillStyle = '#fff'; ctx.fillText(p.label || '', 0, r + 3 / cam.z); ctx.restore();
      });
    }
    /* The Ref's walls: a new one draws itself in, and a door flashes when it opens or shuts. */
    function drawWalls(s, now) {
      (s.walls || []).forEach(function (w) {
        var id = w.id || w.a.join() + w.b.join(), seen = V.wallSeen[id], ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1];
        if (seen === undefined) { if (V.primed && !RM) V.wallT[id] = now; }
        else if (seen !== !!w.open && !RM) V.rings.push({ x: (ax + bx) / 2, y: (ay + by) / 2, t0: now, color: w.open ? '#5fe08a' : '#ff5d5d', dur: 600, r: s.g * .9 });
        V.wallSeen[id] = !!w.open;
        if (V.wallT[id]) { var k = (now - V.wallT[id]) / 240; if (k >= 1) delete V.wallT[id]; else { V.busy = true; k = easeOut(k); bx = ax + (bx - ax) * k; by = ay + (by - ay) * k; } }
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.lineWidth = (w.t === 'wall' ? 4 : 6) / cam.z;
        ctx.strokeStyle = w.t === 'wall' ? '#ff9f43' : w.t === 'window' ? '#6ec1ff' : w.open ? '#5fe08a' : '#ff5d5d';
        if (w.t === 'door' && w.open) ctx.setLineDash([8 / cam.z, 6 / cam.z]);
        ctx.stroke(); ctx.setLineDash([]);
      });
    }
    function draw() {
      var s = sc(), dpr = V.dpr, now = Date.now();
      V.busy = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, V.size.w, V.size.h);
      ctx.fillStyle = '#0c0b0d'; ctx.fillRect(0, 0, V.size.w, V.size.h);
      if (!s) { V.lastT = now; if (o.onFrame) o.onFrame(); return; }
      stepCam(now);
      var m = o.mask ? o.mask() : null;
      ctx.save(); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24; ctx.fillStyle = s.bg || '#2a2622'; ctx.fillRect(0, 0, s.w, s.h); ctx.restore();
      var im = o.mapSrc ? pic(o.mapSrc(s), redraw) : null;
      if (im) ctx.drawImage(im, 0, 0, s.w, s.h);
      drawGrid(s);
      drawPins(s, m, now);
      if (o.ref && !V.player) drawWalls(s, now);
      stepTokens(s, now);
      V.leaving = V.leaving.filter(function (l) {
        var k = (now - l.t0) / 380; if (k >= 1) return false;
        V.busy = true; drawToken(s, l.t, { p: l.p, scale: 1 - .35 * easeOut(k), alpha: 1 - k }); return true;
      });
      tokens().filter(function (t) { return tokenSize(t) >= 1; }).sort(function (a, b) { return tokenSize(b) - tokenSize(a); }).concat(tokens().filter(function (t) { return tokenSize(t) < 1; })).forEach(function (t) { drawToken(s, t); });
      // fog
      var fi = fogImage(m);
      if (fi) {
        ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(fi, 0, 0, V.fogW, V.fogH);
        if (V.fogPrev) {
          var fk = (now - V.fogT0) / 480;
          if (fk >= 1) V.fogPrev = null; else { V.busy = true; ctx.globalAlpha = 1 - easeOut(fk); ctx.drawImage(V.fogPrev.img, 0, 0, V.fogPrev.w, V.fogPrev.h); }
        }
        ctx.restore();
      } else V.fogPrev = null;
      overlays(s, now);
      ctx.restore();
      if (V.sceneT0) {
        var sk = (now - V.sceneT0) / 450;
        if (sk >= 1) V.sceneT0 = 0; else { V.busy = true; ctx.fillStyle = 'rgba(12,11,13,' + (1 - easeOut(sk)) + ')'; ctx.fillRect(0, 0, V.size.w, V.size.h); }
      }
      if (V.pings.length) { V.pings = V.pings.filter(function (p) { return now - p.t0 < 2200; }); if (V.pings.length) V.busy = true; }
      if (Object.keys(V.ghost).length) { Object.keys(V.ghost).forEach(function (k) { if (V.ghost[k].until <= now) delete V.ghost[k]; }); }
      V.lastT = now;
      if (o.onFrame) o.onFrame();
      if (V.busy) redraw();
      weather();
    }
    /*
     * The scene's environment (scene.env: { rain: true, ... }, keys from REF.ENV) on a canvas over the map: tints, haze, and particles,
     * drawn in screen space and clipped to the map. It animates on its own frames while anything is on, so the map itself isn't redrawn;
     * with reduced motion it is only the still tints.
     */
    var Wx = { raf: 0, last: 0, parts: {}, flash: 0, next: 0, drawn: false };
    function envKeys(s) { var e = s && s.env; return e ? Object.keys(e).filter(function (k) { return e[k] && ENV_FX[k]; }) : []; }
    function weather() {
      var s = sc(), keys = envKeys(s);
      if (!keys.length) { if (Wx.drawn) { wctx.setTransform(1, 0, 0, 1, 0, 0); wctx.clearRect(0, 0, wx.width, wx.height); Wx.drawn = false; } return; }
      if (!Wx.raf) Wx.raf = requestAnimationFrame(function () { Wx.raf = 0; drawWeather(); });
    }
    function drawWeather() {
      var s = sc(), keys = envKeys(s), now = Date.now(), dt = Math.min(.1, Wx.last ? (now - Wx.last) / 1000 : 0);
      Wx.last = now;
      wctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); wctx.clearRect(0, 0, V.size.w, V.size.h);
      if (!keys.length || document.hidden) { Wx.drawn = false; Wx.last = 0; return; }
      var x0 = Math.max(0, -cam.x * cam.z), y0 = Math.max(0, -cam.y * cam.z), x1 = Math.min(V.size.w, (s.w - cam.x) * cam.z), y1 = Math.min(V.size.h, (s.h - cam.y) * cam.z);
      if (x1 <= x0 || y1 <= y0) return;
      var R = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, W: V.size.w, H: V.size.h, z: cam.z, g: s.g * cam.z, t: now / 1000, dt: RM ? 0 : dt };
      wctx.save(); wctx.beginPath(); wctx.rect(R.x, R.y, R.w, R.h); wctx.clip();
      keys.forEach(function (k) { ENV_FX[k](wctx, R, Wx.parts[k] || (Wx.parts[k] = []), Wx); });
      wctx.restore();
      Wx.drawn = true;
      if (!RM) Wx.raf = requestAnimationFrame(function () { Wx.raf = 0; drawWeather(); });
    }
    function overlays(s, now) {
      var d = V.drag;
      if (o.links) drawLinks(s, o.links() || []);
      if (V.tool === 'select' && d && d.type === 'token') {
        var t = d.token, from = d.from, to = d.to;
        var sp = o.speedOf ? o.speedOf(t) : 0, n = dist(s, from, to);
        if (sp > 0 && s.grid !== 'none') {
          ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([10 / cam.z, 6 / cam.z]); ctx.lineWidth = 2 / cam.z;
          if (isHex(s)) { ctx.beginPath(); ctx.arc(from.x, from.y, sp * s.g * .93, 0, 7); ctx.stroke(); }
          else { ctx.strokeRect(from.x - (sp + .5) * s.g, from.y - (sp + .5) * s.g, (2 * sp + 1) * s.g, (2 * sp + 1) * s.g); }
          ctx.restore();
        }
        line(from, to, sp > 0 && n > sp ? '#ff6b5e' : '#fff', distText(s, n) + (sp > 0 ? ' / speed ' + sp : ''));
      }
      if (V.ruler) line(V.ruler.a, V.ruler.b, '#6ec1ff', distText(s, dist(s, V.ruler.a, V.ruler.b)));
      if (V.chain) {
        ctx.save(); ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 4 / cam.z; ctx.beginPath(); ctx.moveTo(V.chain.last.x, V.chain.last.y);
        if (V.hover) ctx.lineTo(V.hover.x, V.hover.y); ctx.stroke(); ctx.restore();
      }
      if (d && d.type === 'rect') {
        ctx.save(); ctx.strokeStyle = '#ffd25a'; ctx.setLineDash([8 / cam.z, 5 / cam.z]); ctx.lineWidth = 2 / cam.z; ctx.strokeRect(Math.min(d.a.x, d.b.x), Math.min(d.a.y, d.b.y), Math.abs(d.a.x - d.b.x), Math.abs(d.a.y - d.b.y)); ctx.restore();
      }
      if (d && d.type === 'poly' && d.pts.length) {
        ctx.save(); ctx.strokeStyle = V.tool === 'reveal' ? '#7ee787' : '#ff8a8a'; ctx.lineWidth = 2 / cam.z; ctx.beginPath();
        d.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); if (V.hover) ctx.lineTo(V.hover.x, V.hover.y); ctx.stroke(); ctx.restore();
      }
      if (V.hover && (V.tool === 'reveal' || V.tool === 'hide') && !(d && d.type === 'poly')) {
        ctx.save(); ctx.beginPath(); ctx.arc(V.hover.x, V.hover.y, V.brush * s.g, 0, 7); ctx.strokeStyle = V.tool === 'reveal' ? '#7ee787' : '#ff8a8a'; ctx.lineWidth = 2 / cam.z; ctx.stroke(); ctx.restore();
      }
      V.pings.forEach(function (p) {
        var k = (now - p.t0) / 2200; ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = ctx.fillStyle = p.color || '#ffd25a'; ctx.lineWidth = 4 / cam.z;
        for (var i = 0; i < 3; i++) { var ki = (k * 2.2 + i / 3) % 1; ctx.globalAlpha = (1 - ki) * (1 - k); ctx.beginPath(); ctx.arc(p.x, p.y, easeOut(ki) * s.g * 1.8 + s.g * .1, 0, 7); ctx.stroke(); }
        ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(p.x, p.y - Math.abs(Math.sin(k * 9)) * s.g * .25 * (1 - k), s.g * .14, 0, 7); ctx.fill();
        ctx.restore();
      });
      V.rings = V.rings.filter(function (g) {
        var k = (now - g.t0) / g.dur; if (k >= 1) return false;
        V.busy = true; ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = g.color; ctx.lineWidth = 3 / cam.z;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (.2 + easeOut(k)), 0, 7); ctx.stroke(); ctx.restore(); return true;
      });
      // numbers rising from a token (damage, healing)
      V.floats = V.floats.filter(function (f) {
        var k = (now - f.t0) / 1400; if (k >= 1) return false;
        if (k < 0) { V.busy = true; return true; }
        var t = s.tokens.filter(function (x) { return x.id === f.id; })[0], p = t ? pos(t) : f.p; if (!p) return false;
        f.p = { x: p.x, y: p.y }; V.busy = true;
        var r = t ? radius(s, t) : s.g * .4, sz = Math.max(15 / cam.z, s.g * .34) * (k < .15 ? backOut(k / .15) : 1);
        ctx.save(); ctx.globalAlpha = k < .65 ? 1 : 1 - (k - .65) / .35; ctx.font = '800 ' + sz + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        var y = p.y - r - easeOut(k) * s.g * .9; ctx.lineWidth = 4 / cam.z; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(f.text, p.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x, y);
        ctx.restore(); return true;
      });
    }
    /* Who is attacking whom: a dashed arrow from each attacker to its target ([{ from, to, color }] by token id), from rim to rim. */
    function drawLinks(s, links) {
      var byId = {}; tokens().forEach(function (t) { byId[t.id] = t; });
      links.forEach(function (k) {
        var a = byId[k.from], b = byId[k.to]; if (!a || !b || a === b) return;
        var p = pos(a), q = pos(b), dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy); if (len < 1) return;
        var ra = radius(s, a), rb = radius(s, b); if (len <= ra + rb + 2) return;
        var ux = dx / len, uy = dy / len, x1 = p.x + ux * ra, y1 = p.y + uy * ra, x2 = q.x - ux * (rb + 3 / cam.z), y2 = q.y - uy * (rb + 3 / cam.z), hd = Math.max(9 / cam.z, s.g * .16);
        ctx.save(); ctx.globalAlpha = k.strong ? .95 : .7; ctx.strokeStyle = ctx.fillStyle = k.color || '#ff6b5e'; ctx.lineWidth = (k.strong ? 3.2 : 2.2) / cam.z;
        ctx.setLineDash([9 / cam.z, 6 / cam.z]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * hd * .6, y2 - uy * hd * .6); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * hd - uy * hd * .55, y2 - uy * hd + ux * hd * .55); ctx.lineTo(x2 - ux * hd + uy * hd * .55, y2 - uy * hd - ux * hd * .55); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }
    function line(a, b, color, text) {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3 / cam.z; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 5 / cam.z, 0, 7); ctx.fillStyle = color; ctx.fill();
      ctx.font = 'bold ' + 14 / cam.z + 'px sans-serif'; var w = ctx.measureText(text).width + 12 / cam.z, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 16 / cam.z;
      ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(mx - w / 2, my - 11 / cam.z, w, 22 / cam.z); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, mx, my);
      ctx.restore();
    }

    // ---- input
    var pointers = {}, pinch = null;
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (V.chain) { V.chain = null; redraw(); return; }
      var w = toWorld(e), t = hitToken(w);
      if (!o.onMenu || V.drag && V.drag.type !== 'pan') return;
      o.onMenu(t || null, e, w);
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); V.camTw = null; var r = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener('pointerdown', function (e) {
      showTip(null);
      cv.focus(); pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (Object.keys(pointers).length === 2) {
        var ps = Object.keys(pointers).map(function (k) { return pointers[k]; });
        pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) }; V.drag = null; V.camTw = null; return;
      }
      var s = sc(); if (!s) return;
      var w = toWorld(e), tool = V.tool;
      if (e.button === 1 || V.spaceDown || e.button === 2) { V.camTw = null; V.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
      if (e.altKey && o.onPing) { ping(w.x, w.y, true); return; }
      if (tool === 'ping') { ping(w.x, w.y, true); return; }
      if (tool === 'measure') { var a = isHex(s) || s.grid === 'none' ? snap(s, w.x, w.y, 1) : snap(s, w.x, w.y, 1); V.ruler = { a: a, b: a }; V.drag = { type: 'ruler' }; redraw(); return; }
      if (o.ref && !V.player) {
        if (tool === 'wall' || tool === 'door' || tool === 'window') {
          var c = snapCorner(s, w.x, w.y, e.shiftKey);
          if (!V.chain) V.chain = { last: c, first: c, n: 0, kind: tool };
          else {
            if (c.x !== V.chain.last.x || c.y !== V.chain.last.y) { o.onWall({ a: [V.chain.last.x, V.chain.last.y], b: [c.x, c.y], t: tool }); V.chain.n++; V.chain.last = c; }
            if (tool !== 'wall') V.chain = null;
          }
          redraw(); return;
        }
        if (tool === 'room') { V.drag = { type: 'rect', a: snapCorner(s, w.x, w.y), b: snapCorner(s, w.x, w.y), room: true }; return; }
        if (tool === 'rect-reveal' || tool === 'rect-hide') { V.drag = { type: 'rect', a: w, b: w, fog: tool === 'rect-reveal' }; return; }
        if (tool === 'pin') { if (o.onDrop) o.onDrop(w.x, w.y); return; }
        if (tool === 'eraser') { var k = hitWall(w); if (k) o.onErase(k); return; }
        if (tool === 'reveal' || tool === 'hide') { V.drag = { type: 'paint', reveal: tool === 'reveal' }; o.onPaint(w.x, w.y, V.brush * s.g, tool === 'reveal'); return; }
        if (tool === 'poly-reveal' || tool === 'poly-hide') {
          if (!V.drag || V.drag.type !== 'poly') V.drag = { type: 'poly', pts: [], reveal: tool === 'poly-reveal' };
          V.drag.pts.push([w.x, w.y]); redraw(); return;
        }
      }
      var t = hitToken(w);
      if (o.onPick && o.onPick(t || null)) { redraw(); return; }   // picking a target: the click is the answer, not a selection or a drag
      if (t) {
        if (V.sel !== t.id) V.selT0 = Date.now();
        V.sel = t.id; if (o.onSelect) o.onSelect(t);
        if (movable(t)) { var p = pos(t); V.drag = { type: 'token', token: t, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, off: { x: w.x - p.x, y: w.y - p.y }, moved: false }; }
        redraw(); return;
      }
      var pin = hitPin(w);
      if (pin && o.onPin) { o.onPin(pin); return; }
      if (o.onSelect && V.sel) { V.sel = null; o.onSelect(null); }
      V.camTw = null; V.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, click: true }; redraw();
    });
    cv.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) { pointers[e.pointerId].x = e.clientX; pointers[e.pointerId].y = e.clientY; }
      if (pinch && Object.keys(pointers).length >= 2) {
        var ps = Object.keys(pointers).map(function (k) { return pointers[k]; }), nd = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), r = cv.getBoundingClientRect();
        zoomAt(nd / pinch.d, (ps[0].x + ps[1].x) / 2 - r.left, (ps[0].y + ps[1].y) / 2 - r.top); pinch.d = nd; return;
      }
      var s = sc(); if (!s) return;
      var w = toWorld(e), d = V.drag; V.hover = w;
      showTip(d || e.pointerType === 'touch' ? null : hitToken(w), e);
      if (d) {
        if (d.type === 'pan') { cam.x = d.cx - (e.clientX - d.sx) / cam.z; cam.y = d.cy - (e.clientY - d.sy) / cam.z; if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.click = false; }
        else if (d.type === 'token') { var pt = snap(s, w.x - d.off.x, w.y - d.off.y, tokenSize(d.token)); d.to = s.grid === 'none' ? { x: w.x - d.off.x, y: w.y - d.off.y } : pt; d.moved = true; V.ghost[d.token.id] = { x: d.to.x, y: d.to.y, until: Date.now() + 60000, drag: true }; }
        else if (d.type === 'ruler') V.ruler.b = snap(s, w.x, w.y, 1);
        else if (d.type === 'rect') { d.b = d.room ? snapCorner(s, w.x, w.y) : w; }
        else if (d.type === 'paint') o.onPaint(w.x, w.y, V.brush * s.g, d.reveal);
      }
      redraw();
    });
    function up(e) {
      delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinch = null;
      var d = V.drag, s = sc(); if (!d || !s) return;
      if (d.type === 'token') {
        delete V.ghost[d.token.id];
        if (d.moved && (d.to.x !== d.from.x || d.to.y !== d.from.y)) {
          V.ghost[d.token.id] = { x: d.to.x, y: d.to.y, until: Date.now() + 5000 };
          var r = o.onMove(d.token, d.to.x, d.to.y);
          if (r === false) delete V.ghost[d.token.id];
        }
        V.drag = null;
      } else if (d.type === 'rect') {
        var a = d.a, b = d.b;
        if (Math.abs(a.x - b.x) > 4 && Math.abs(a.y - b.y) > 4) { if (d.room) o.onRoom({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) }); else if (o.onFogRect) o.onFogRect([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], d.fog); }
        V.drag = null;
      } else if (d.type === 'poly') { /* kept until a double click or Enter */ }
      else if (d.type === 'pan' && d.click && o.onSelect) { V.sel = null; o.onSelect(null); V.drag = null; }
      else V.drag = d.type === 'ruler' ? null : null;
      redraw();
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', function (e) {
      var s = sc(); if (!s) return;
      if (V.chain) { V.chain = null; redraw(); return; }
      if (V.drag && V.drag.type === 'poly') { finishPoly(); return; }
      if (o.ref && !V.player) { var k = hitWall(toWorld(e)); if (k && k.t === 'door' && o.onDoor) { o.onDoor(k); return; } }
    });
    function finishPoly() {
      var d = V.drag; V.drag = null;
      if (d && d.type === 'poly' && d.pts.length > 2 && o.onFogRect) o.onFogRect(d.pts, d.reveal);
      redraw();
    }
    cv.addEventListener('keydown', function (e) {
      if (e.key === ' ') { V.spaceDown = true; e.preventDefault(); }
      if (e.key === 'Escape') { V.chain = null; V.ruler = null; V.drag = null; redraw(); }
      if (e.key === 'Enter') { V.chain = null; if (V.drag && V.drag.type === 'poly') finishPoly(); redraw(); }
      if (e.key === '+' || e.key === '=') zoomAt(1.25, V.size.w / 2, V.size.h / 2, true);
      if (e.key === '-') zoomAt(.8, V.size.w / 2, V.size.h / 2, true);
      if (e.key === '0') fit(true);
      if (o.onKey) o.onKey(e);
    });
    cv.addEventListener('keyup', function (e) { if (e.key === ' ') V.spaceDown = false; });
    cv.addEventListener('pointerleave', function () { V.hover = null; showTip(null); });
    /* The tooltip over a hovered token: its name, how it is doing, and its conditions named (o.tooltip can add lines; o.condInfo explains one). */
    function showTip(t, e) {
      if (!t || t.kind === 'obj' && !(t.conds || []).length) { if (!tip.hidden) { tip.hidden = true; V.tipId = null; } return; }
      var key = t.id + '|' + (t.conds || []).join(',') + '|' + t.hpf + '|' + t.hw + '|' + t.vit + '|' + t.dead;
      if (V.tipId !== key) {
        V.tipId = key; tip.innerHTML = '';
        var add = function (cls, text) { var n = document.createElement('div'); n.className = cls; n.textContent = text; tip.appendChild(n); return n; };
        add('tt-name', t.name || 'Token');
        (o.tooltip ? o.tooltip(t) || [] : []).forEach(function (line) { add('tt-line', line); });
        if (!o.tooltip && t.dead) add('tt-line', 'dead');
        else if (!o.tooltip && t.hw) add('tt-line', t.hw);
        (t.conds || []).forEach(function (c) {
          var row = add('tt-cond', ''), dot = document.createElement('span'), st = condStyle(c), info = (o.condInfo && o.condInfo(c)) || COND_INFO[c] || '';
          dot.className = 'tt-dot'; dot.style.background = st[0]; dot.textContent = st[1];
          var b = document.createElement('b'); b.textContent = c;
          row.appendChild(dot); row.appendChild(b);
          if (info) { var i = document.createElement('span'); i.className = 'tt-info'; i.textContent = info; row.appendChild(i); }
        });
      }
      var r = host.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.round(Math.min(r.width - tw - 6, Math.max(6, x + 16))) + 'px';
      tip.style.top = Math.round(y + 18 + th > r.height ? Math.max(6, y - th - 12) : y + 18) + 'px';
    }

    function ping(x, y, send) {
      V.pings.push({ x: x, y: y, t0: Date.now() }); redraw();
      if (send && o.onPing) o.onPing(x, y);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);
    setTimeout(resize, 0);

    return {
      canvas: cv, redraw: redraw, fit: fit, centerOn: centerOn, resize: resize, zoom: function (f) { zoomAt(f, V.size.w / 2, V.size.h / 2, true); },
      tool: function (t) { V.tool = t; V.chain = null; V.ruler = null; if (!/poly/.test(t)) V.drag = null; cv.style.cursor = t === 'select' ? 'default' : t === 'ping' || t === 'measure' ? 'crosshair' : 'cell'; redraw(); },
      getTool: function () { return V.tool; },
      /* A right-click menu over the map (T.menu), kept inside the host so it shows in fullscreen too. */
      menu: function (x, y, items) { T.menu(x, y, items, host); },
      brush: function (n) { V.brush = n; redraw(); },
      player: function (on) { V.player = !!on; V.fogMask = null; redraw(); },
      isPlayer: function () { return V.player; },
      select: function (id) { if (V.sel !== id) V.selT0 = Date.now(); V.sel = id; redraw(); },
      selected: function () { return V.sel; },
      ping: function (x, y, color) { V.pings.push({ x: x, y: y, t0: Date.now(), color: color }); redraw(); },
      sceneChanged: function (id) {
        if (V.sceneId === id) { redraw(); return; }
        V.sceneId = id; V.fogMask = null; V.fogImg = null; V.fogPrev = null; V.ghost = {}; V.sel = null; V.chain = null; V.ruler = null;
        V.shown = {}; V.tw = {}; V.seen = {}; V.born = {}; V.leaving = []; V.fx = {}; V.condT = {}; V.alpha = {}; V.floats = []; V.rings = [];
        V.wallSeen = {}; V.wallT = {}; V.pinSeen = {}; V.pinT = {}; V.primed = false; V.intro = 0; V.sceneT0 = RM ? 0 : Date.now();
        fit();
      },
      /* Where a token is on the screen (CSS px from the canvas's top left) and its radius there, or null. */
      screenOf: function (id) {
        var s = sc(), t = s && s.tokens.filter(function (k) { return k.id === id; })[0]; if (!t) return null;
        var p = pos(t); return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z, r: radius(s, t) * cam.z };
      },
      /* A few words rising from a token: damage dealt, Stamina regained. */
      floatText: function (id, text, color, delay) { if (RM) return; V.floats.push({ id: id, text: text, color: color || '#fff', t0: Date.now() + (delay || 0) }); redraw(); },
      /* A ring spreading from a point on the map. */
      flash: function (x, y, color) { if (RM) return; var s = sc(); V.rings.push({ x: x, y: y, t0: Date.now(), color: color || '#fff', dur: 600, r: (s ? s.g : 70) * .9 }); redraw(); },
      /* How the map is zoomed now (1 = one map pixel per screen pixel). */
      zoomLevel: function () { return cam.z; },
      center: function () { return { x: cam.x + V.size.w / cam.z / 2, y: cam.y + V.size.h / cam.z / 2 }; },
      /* Drop the local (optimistic) position of tokens whose published position has caught up, or that the Ref never accepted. */
      settle: function () {
        var s = sc(), now = Date.now();
        Object.keys(V.ghost).forEach(function (k) {
          var g = V.ghost[k]; if (g.drag) return;
          var t = s && s.tokens.filter(function (x) { return x.id === k; })[0];
          if (!t || Math.abs(t.x - g.x) < 2 && Math.abs(t.y - g.y) < 2 || now - (g.until - 5000) > 2500) delete V.ghost[k];
        });
        redraw();
      },
      held: function () { return !!(V.drag && V.drag.type === 'token'); },
      clearGhost: function (id) { delete V.ghost[id]; },
      hasSceneSize: function () { return V.size.w > 100; }
    };
  }

  // ------------------------------------------------------------------ icons for the buttons floating on the map (24 px line drawings)
  var ICONS = {
    select: 'M5 3l14 8-6 2-2 6z', measure: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
    ping: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0', wall: 'M3 6h18v12H3z M3 12h18 M9 6v6 M15 12v6',
    door: 'M6 21V3h12v18 M3 21h18 M14 12h.01', window: 'M4 4h16v16H4z M12 4v16 M4 12h16', room: 'M4 4h16v16H4z M4 4m-1.5 0h3 M20 20m-1.5 0h3',
    eraser: 'M16 3l5 5-11 11H5l-2-2z M9 9l6 6 M10 21h11', reveal: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    hide: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M3 3l18 18', 'rect-reveal': 'M4 4h4 M12 4h4 M20 4v4 M20 12v4 M20 20h-4 M12 20H8 M4 20v-4 M4 12V8 M9 12h6',
    'poly-reveal': 'M12 3l9 7-4 11H7L3 10z M12 3h.01 M21 10h.01 M3 10h.01', pin: 'M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z M12 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
    plus: 'M12 5v14 M5 12h14', minus: 'M5 12h14', fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5', full: 'M14 4h6v6 M10 20H4v-6 M20 4l-7 7 M4 20l7-7',
    gear: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9L7 7 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
    show: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M7.8 7.8a6 6 0 0 0 0 8.4 M16.2 7.8a6 6 0 0 1 0 8.4 M4.9 4.9a10 10 0 0 0 0 14.2 M19.1 4.9a10 10 0 0 1 0 14.2',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0', eyeOff: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M3 3l18 18',
    crows: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-1a6 6 0 0 1 12 0v1 M16 3.1a4 4 0 0 1 0 7.8 M22 21v-1a6 6 0 0 0-4-5.7',
    person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a8 8 0 0 1 16 0v1', sword: 'M14.5 17.5L3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2',
    pierce: 'M4 20L20 4 M13 4h7v7 M4 14l6 6', heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z',
    lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4', unlock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 7.5-2', copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
    trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15', sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    flag: 'M5 21V4 M5 4h11l-2 4 2 4H5', marker: 'M12 3l7 9-7 9-7-9z', dice: 'M4 4h16v16H4z M8.5 8.5h.01 M15.5 15.5h.01 M12 12h.01 M15.5 8.5h.01 M8.5 15.5h.01',
    next: 'M5 4l10 8-10 8z M19 5v14', play: 'M6 4l14 8-14 8z', pause: 'M7 4v16 M17 4v16', hourglass: 'M6 2h12 M6 22h12 M7 2v3l5 7-5 7v3 M17 2v3l-5 7 5 7v3',
    sliders: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M16 4v4 M10 10v4 M18 16v4', x: 'M6 6l12 12 M18 6L6 18',
    target: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M12 2v4 M12 18v4 M2 12h4 M18 12h4', check: 'M5 12l5 5 9-10',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14', list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    day: 'M4 5h16v16H4z M4 10h16 M9 3v4 M15 3v4', go: 'M5 12h14 M13 6l6 6-6 6', cond: 'M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z',
    cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z M8 21l1-1.5 M12 21l1-1.5 M16 21l1-1.5', save: 'M5 3h11l3 3v15H5z M8 3v5h7V3 M8 21v-7h8v7',
    beast: 'M6 3l2 7 M12 2v8 M18 3l-2 7 M5 15c0 3.9 3.1 6 7 6s7-2.1 7-6-3.1-4-7-4-7 .1-7 4z', mine: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 2v5 M12 17v5 M2 12h5 M17 12h5'
  };
  /* An icon as an inline SVG string (it takes the text color). */
  function icon(name) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (ICONS[name] || ICONS.marker) + '"/></svg>'; }


  // ------------------------------------------------------------------ movable bars
  /*
   * T.docks(ui, bars, opts): the tabletop's floating bars (scene, clock, tools, zoom...) live in four docks around the map (top, bottom,
   * left, right). Each bar has a grip: drag it to another dock or to a new place in its own dock. Docks along the top and bottom run
   * their bars in rows (wrapping to a new row when they don't fit); the side docks run them in columns, and the bars turn vertical.
   * `bars` is [{ id, el, zone }]: each el is put in its dock wrapped with its grip. The arrangement is kept in localStorage under
   * opts.key. The docks' sizes are published on `ui` as --dk-t/--dk-b/--dk-l/--dk-r (how far each dock reaches in) for what floats
   * over the map. Double-click a grip to put everything back.
   */
  var ZONES = ['top', 'left', 'right', 'bottom'];
  function docks(ui, bars, opts) {
    opts = opts || {};
    function mk(tag, cls, kids) { var n = document.createElement(tag); n.className = cls; (kids || []).forEach(function (k) { n.appendChild(k); }); return n; }
    var root = mk('div', 'vtt-docks'), zone = {}, wrap = {}, byId = {};
    ZONES.forEach(function (z) { zone[z] = mk('div', 'dk-zone dk-' + z + (z === 'top' || z === 'bottom' ? ' h' : ' v')); root.appendChild(zone[z]); });
    var hints = mk('div', 'dk-hints', ZONES.map(function (z) { var h = mk('div', 'dk-hint dk-h-' + z); h.textContent = z; return h; }));
    root.appendChild(hints);
    bars.forEach(function (b) {
      byId[b.id] = b;
      var grip = mk('button', 'dk-grip'); grip.type = 'button'; grip.title = 'Drag to move this bar (double-click to reset the bars)'; grip.setAttribute('aria-label', 'Move this bar');
      grip.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><path d="M2 2h2M6 2h2M2 6h2M6 6h2M2 10h2M6 10h2M2 14h2M6 14h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      b.el.classList.add('dk-in');
      wrap[b.id] = mk('div', 'dk-bar dk-b-' + b.id, [grip, b.el]);
      wrap[b.id].setAttribute('data-bar', b.id);
      grip.addEventListener('pointerdown', function (e) { if (e.button === 0) startDrag(e, b.id); });
      grip.addEventListener('dblclick', function () { place(defaults()); save(); });
    });
    function defaults() { var o = {}; ZONES.forEach(function (z) { o[z] = []; }); bars.forEach(function (b) { (o[b.zone] || o.top).push(b.id); }); return o; }
    function saved() {
      var o = null;
      try { o = JSON.parse(localStorage.getItem(opts.key) || 'null'); } catch (e) { o = null; }
      var d = defaults(), seen = {}, out = {};
      ZONES.forEach(function (z) { out[z] = []; });
      if (o && typeof o === 'object') ZONES.forEach(function (z) { (Array.isArray(o[z]) ? o[z] : []).forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = 1; out[z].push(id); } }); });
      ZONES.forEach(function (z) { d[z].forEach(function (id) { if (!seen[id]) { seen[id] = 1; out[z].push(id); } }); });   // a bar added since it was saved goes where it starts
      return out;
    }
    function place(o) { ZONES.forEach(function (z) { o[z].forEach(function (id) { zone[z].appendChild(wrap[id]); }); }); measure(); }
    function current() { var o = {}; ZONES.forEach(function (z) { o[z] = Array.prototype.map.call(zone[z].children, function (n) { return n.getAttribute('data-bar'); }).filter(Boolean); }); return o; }
    function save() { if (opts.key) try { localStorage.setItem(opts.key, JSON.stringify(current())); } catch (e) { /* storage unavailable */ } }
    /* How far each dock reaches into the map, for the layers that float over it. */
    var mq = 0;
    function measure() {
      cancelAnimationFrame(mq);
      mq = requestAnimationFrame(function () {
        var u = ui.getBoundingClientRect(); if (!u.width) return;
        function reach(z, edge) {
          var r = zone[z].getBoundingClientRect();
          if (!r.width || !r.height || !zone[z].querySelector('.dk-bar:not(.empty)')) return 12;
          return Math.round(edge === 't' ? r.bottom - u.top : edge === 'b' ? u.bottom - r.top : edge === 'l' ? r.right - u.left : u.right - r.left) + 8;
        }
        [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']].forEach(function (p) { ui.style.setProperty('--dk-' + p[1], reach(p[0], p[1]) + 'px'); });
        bars.forEach(function (b) { wrap[b.id].classList.toggle('empty', !b.el.firstChild); });
      });
    }
    ui.insertBefore(root, ui.firstChild);
    place(saved());
    if (window.ResizeObserver) { var ro = new ResizeObserver(measure); ro.observe(ui); ZONES.forEach(function (z) { ro.observe(zone[z]); }); }
    if (window.MutationObserver) new MutationObserver(measure).observe(root, { childList: true, subtree: true });

    // Which dock the pointer means: the outer sides of the map are the side docks, otherwise the top or bottom half.
    function zoneAt(x, y) {
      var r = ui.getBoundingClientRect(), rx = (x - r.left) / (r.width || 1), ry = (y - r.top) / (r.height || 1);
      return rx < .14 ? 'left' : rx > .86 ? 'right' : ry < .5 ? 'top' : 'bottom';
    }
    function beforeWhich(z, x, y, me) {
      var kids = Array.prototype.filter.call(zone[z].children, function (n) { return n !== me && n.getAttribute('data-bar') && n.offsetWidth; }), horiz = z === 'top' || z === 'bottom';
      for (var i = 0; i < kids.length; i++) {
        var r = kids[i].getBoundingClientRect();
        if (horiz ? (y < r.top ? true : y <= r.bottom && x < r.left + r.width / 2) : (x < r.left ? true : x <= r.right && y < r.top + r.height / 2)) return kids[i];
      }
      return null;
    }
    function startDrag(e0, id) {
      e0.preventDefault();
      var me = wrap[id], from = current(), last = '';
      root.classList.add('dragging'); me.classList.add('dk-drag');
      function move(e) {
        var z = zoneAt(e.clientX, e.clientY);
        Array.prototype.forEach.call(hints.children, function (h) { h.classList.toggle('on', h.classList.contains('dk-h-' + z)); });
        var ref = beforeWhich(z, e.clientX, e.clientY, me), key = z + ':' + (ref ? ref.getAttribute('data-bar') : '');
        if (key === last) return; last = key;
        zone[z].insertBefore(me, ref);
        measure();
      }
      function up() {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        root.classList.remove('dragging'); me.classList.remove('dk-drag');
        if (JSON.stringify(current()) !== JSON.stringify(from)) save();
        measure();
      }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      move(e0);
    }
    return { reset: function () { place(defaults()); save(); }, measure: measure };
  }

  // ------------------------------------------------------------------ the right-click menu
  /*
   * T.menu(x, y, items, host): a menu at the pointer (viewport pixels), appended to `host` (the map, so fullscreen shows it). Items:
   * { head } a title, { sep } a rule, { label, fn, danger, on (checkmark), off (disabled), sub: [items] (opens in place, with a Back row), hint }.
   * Escape, a click elsewhere, a right-drag (panning), or the window losing focus closes it. Arrow keys move between rows.
   */
  T.menu = function (x, y, items, host) {
    var old = document.querySelector('.tbl-menu'); if (old) old.remove();
    var box = document.createElement('div'); box.className = 'tbl-menu'; box.setAttribute('role', 'menu');
    var x0 = x, y0 = y;
    function close() {
      box.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointermove', drag, true); window.removeEventListener('blur', close);
    }
    function away(e) { if (!box.contains(e.target)) close(); }
    function drag(e) { if ((e.buttons & 2) && Math.hypot(e.clientX - x0, e.clientY - y0) > 6) close(); }   // a right-drag pans instead
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      var bs = Array.prototype.slice.call(box.querySelectorAll('button:not([disabled])')), i = bs.indexOf(document.activeElement);
      if (bs.length) bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
    function fill(list, back) {
      box.innerHTML = '';
      if (back) {
        var b0 = document.createElement('button'); b0.type = 'button'; b0.setAttribute('role', 'menuitem'); b0.className = 'tm-back'; b0.textContent = '◂ Back';
        b0.addEventListener('click', function () { fill(back); place(); }); box.appendChild(b0);
      }
      list.forEach(function (it) {
        if (!it) return;
        if (it.sep) { if (box.lastChild && box.lastChild.tagName !== 'HR' && !box.lastChild.classList.contains('tm-back')) box.appendChild(document.createElement('hr')); return; }
        if (it.head) { var h = document.createElement('div'); h.className = 'tm-head'; h.textContent = it.head; box.appendChild(h); return; }
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', it.on != null ? 'menuitemcheckbox' : 'menuitem');
        if (it.on != null) b.setAttribute('aria-checked', it.on ? 'true' : 'false');
        if (it.danger) b.classList.add('danger');
        if (it.off) b.disabled = true;
        if (it.hint) b.title = it.hint;
        var l = document.createElement('span'); l.className = 'tm-l'; l.textContent = (it.on != null ? (it.on ? '✓ ' : ' ') : '') + it.label; b.appendChild(l);
        if (it.sub) { var a = document.createElement('span'); a.className = 'tm-a'; a.textContent = '▸'; b.appendChild(a); }
        b.addEventListener('click', function () {
          if (it.sub) { fill(it.sub, list); place(); var f = box.querySelector('button'); if (f) f.focus(); } else { close(); if (it.fn) it.fn(); }
        });
        box.appendChild(b);
      });
      if (box.lastChild && box.lastChild.tagName === 'HR') box.lastChild.remove();
    }
    function place() {
      var W = window.innerWidth, H = window.innerHeight;
      box.style.left = Math.max(4, Math.min(x, W - box.offsetWidth - 4)) + 'px'; box.style.top = Math.max(4, Math.min(y, H - box.offsetHeight - 4)) + 'px';
    }
    fill(items);
    (host || document.body).appendChild(box); place();
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); document.addEventListener('pointermove', drag, true); window.addEventListener('blur', close);
    var f = box.querySelector('button:not([disabled])'); if (f) f.focus({ preventScroll: true });
    return { close: close };
  };

  T.docks = docks;
  T.icon = icon; T.REDUCED_MOTION = RM;
  T.SIZES = SIZES; T.KIND_COLOR = KIND_COLOR; T.COND_STYLE = COND_STYLE; T.condStyle = condStyle; T.uid = uid; T.newScene = newScene; T.isHex = isHex; T.hexAt = hexAt; T.hexCenter = hexCenter; T.snap = snap;
  T.dist = dist; T.distText = distText; T.fogDims = fogDims; T.seenOf = seenOf; T.paintSeen = paintSeen; T.paintPoly = paintPoly; T.fillSeen = fillSeen; T.computeVision = computeVision;
  T.packMask = packMask; T.unpackMask = unpackMask; T.maskAt = maskAt; T.pathBlocked = pathBlocked; T.los = los; T.view = view; T.tokenArt = tokenArt; T.lightsOf = lightsOf;
  T.viewers = viewers;
})();
