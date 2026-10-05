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
 * T.view(host, options) is the canvas: pan, zoom, tokens you can drag, ruler, pings, and (for the Ref) the drawing tools.
 */
(function () {
  'use strict';
  var T = window.CrowsTable = {};
  var SQ3 = Math.sqrt(3);

  // ------------------------------------------------------------------ scenes and grids
  var SIZES = { T: 0.5, S: 1, M: 1, L: 2, H: 3 };
  var KIND_COLOR = { pc: '#4fb6a6', foe: '#c4524a', ally: '#6aa84f', npc: '#d6a93b', obj: '#8a8a93' };
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
   * onRoom(rect), onFogRect(pts, reveal), onMenu(t, event), onPin(pin), onDrop(x, y)
   */
  function view(host, o) {
    var cv = document.createElement('canvas'), ctx = cv.getContext('2d'), cam = { x: 0, y: 0, z: 1 }, V = { tool: 'select', player: false, sel: null, ghost: {}, pings: [], size: { w: 0, h: 0 }, dpr: 1,
      brush: 1, drag: null, hover: null, ruler: null, chain: null, queued: false, sceneId: null, fogImg: null, fogKey: '', lastPing: 0, spaceDown: false, keep: {} };
    cv.className = 'vtt-canvas'; cv.tabIndex = 0; cv.style.touchAction = 'none';
    host.appendChild(cv);

    function sc() { return o.scene(); }
    function toWorld(ev) { var r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / cam.z + cam.x, y: (ev.clientY - r.top) / cam.z + cam.y }; }
    function redraw() { if (V.queued) return; V.queued = true; requestAnimationFrame(function () { V.queued = false; draw(); }); }
    function resize() {
      var r = host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      V.size = { w: Math.max(100, r.width), h: Math.max(100, r.height) }; V.dpr = dpr;
      if (V.fitPending && r.width >= 50) { V.fitPending = false; setTimeout(fit, 0); }
      cv.width = Math.round(V.size.w * dpr); cv.height = Math.round(V.size.h * dpr); cv.style.width = V.size.w + 'px'; cv.style.height = V.size.h + 'px';
      redraw();
    }
    function fit() {
      var s = sc(); if (!s) return;
      if (host.getBoundingClientRect().width < 50) { V.fitPending = true; return; }
      cam.z = Math.max(.05, Math.min(V.size.w / s.w, V.size.h / s.h));
      cam.x = (s.w - V.size.w / cam.z) / 2; cam.y = (s.h - V.size.h / cam.z) / 2; redraw();
    }
    function centerOn(x, y) { cam.x = x - V.size.w / cam.z / 2; cam.y = y - V.size.h / cam.z / 2; redraw(); }
    function zoomAt(f, sx, sy) {
      var s = sc(); if (!s) return;
      var lo = Math.min(V.size.w / s.w, V.size.h / s.h) * .4, nz = Math.max(lo, Math.min(5, cam.z * f));
      var wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y; cam.z = nz; cam.x = wx - sx / nz; cam.y = wy - sy / nz; redraw();
    }
    function tokens() { var s = sc(); return s ? s.tokens.filter(function (t) { return !(V.player && t.hidden); }) : []; }
    function pos(t) { var g = V.ghost[t.id]; return g && g.until > Date.now() ? g : t; }
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
    function drawToken(s, t) {
      var p = pos(t), r = Math.max(.35, tokenSize(t) * .46) * s.g, kc = t.color || KIND_COLOR[t.kind] || '#888';
      ctx.save(); ctx.translate(p.x, p.y);
      if (t.hidden) ctx.globalAlpha = .5;
      if (t.dead) ctx.globalAlpha *= .55;
      else if (t.acted) ctx.globalAlpha *= .75;
      if (t.light && t.light.on !== false && (o.ref && !V.player)) { ctx.beginPath(); ctx.arc(0, 0, r + 3 / cam.z, 0, 7); ctx.strokeStyle = 'rgba(255,200,90,.9)'; ctx.lineWidth = 3 / cam.z; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = kc; ctx.fill();
      var src = o.tokenSrc ? o.tokenSrc(t) : null, im = src ? pic(src, redraw) : null;
      if (im) { ctx.save(); ctx.clip(); ctx.drawImage(im, -r, -r, r * 2, r * 2); ctx.restore(); }
      else if (t.kind === 'obj') { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.font = 'bold ' + r * 1.1 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.icon || (t.light ? '✶' : '◆'), 0, 0); }
      else { ctx.fillStyle = '#fff'; ctx.font = 'bold ' + r * .95 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((t.name || '?').replace(/^(the|a|an)\s+/i, '').slice(0, 2).toUpperCase(), 0, 0); }
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.lineWidth = Math.max(2.5, r * .1); ctx.strokeStyle = t.hidden ? '#9aa' : kc;
      if (t.hidden) ctx.setLineDash([r * .3, r * .2]);
      ctx.stroke(); ctx.setLineDash([]);
      if (t.mine) { ctx.beginPath(); ctx.arc(0, 0, r + 4 / cam.z, 0, 7); ctx.strokeStyle = '#ffd25a'; ctx.lineWidth = 2.5 / cam.z; ctx.stroke(); }
      if (V.sel === t.id) { ctx.beginPath(); ctx.arc(0, 0, r + 6 / cam.z, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / cam.z; ctx.setLineDash([6 / cam.z, 4 / cam.z]); ctx.stroke(); ctx.setLineDash([]); }
      if (t.dead) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * .12); ctx.beginPath(); ctx.moveTo(-r * .6, -r * .6); ctx.lineTo(r * .6, r * .6); ctx.moveTo(r * .6, -r * .6); ctx.lineTo(-r * .6, r * .6); ctx.stroke(); }
      if (t.hpf != null && !t.dead) {
        var bw = r * 1.7, by = r * .78; ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(-bw / 2, by, bw, r * .2);
        ctx.fillStyle = t.hpf > .6 ? '#5fbf6a' : t.hpf > .3 ? '#e0b43f' : '#d6544a'; ctx.fillRect(-bw / 2, by, bw * Math.max(0, Math.min(1, t.hpf)), r * .2);
      }
      (t.conds || []).slice(0, 4).forEach(function (c, i) {
        var cx = r * .85 - i * r * .42, cy = -r * .85; ctx.beginPath(); ctx.arc(cx, cy, r * .22, 0, 7); ctx.fillStyle = '#222'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / cam.z; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold ' + r * .3 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.charAt(0), cx, cy + 1 / cam.z);
      });
      if (t.name && (t.kind !== 'obj' || t.label)) {
        ctx.font = 'bold ' + Math.max(11 / cam.z, s.g * .2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var ty = r + (t.hpf != null ? r * .28 : 3 / cam.z); ctx.lineWidth = 3 / cam.z; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(t.name, 0, ty); ctx.fillStyle = '#fff'; ctx.fillText(t.name, 0, ty);
      }
      ctx.restore();
    }
    function fogImage(s, m) {
      var key = m ? m.cw + 'x' + m.ch + (V.player ? 'p' : 'r') : '';
      if (!m) return null;
      if (!V.fogImg || V.fogKey !== key || V.fogMask !== m) {
        var c = V.fogImg && V.fogImg.width === m.cw && V.fogImg.height === m.ch ? V.fogImg : document.createElement('canvas');
        c.width = m.cw; c.height = m.ch;
        var g = c.getContext('2d'), im = g.createImageData(m.cw, m.ch), A = V.player ? [255, 150, 90, 0] : [150, 100, 48, 0];
        for (var i = 0; i < m.cells.length; i++) { var j = i * 4; im.data[j] = 6; im.data[j + 1] = 5; im.data[j + 2] = 10; im.data[j + 3] = A[m.cells[i]]; }
        g.putImageData(im, 0, 0); V.fogImg = c; V.fogKey = key; V.fogMask = m;
      }
      return V.fogImg;
    }
    function draw() {
      var s = sc(), dpr = V.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, V.size.w, V.size.h);
      ctx.fillStyle = '#0c0b0d'; ctx.fillRect(0, 0, V.size.w, V.size.h);
      if (!s) { ctx.fillStyle = '#aaa'; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No scene yet.', V.size.w / 2, V.size.h / 2); return; }
      var m = o.mask ? o.mask() : null;
      ctx.save(); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
      ctx.fillStyle = s.bg || '#2a2622'; ctx.fillRect(0, 0, s.w, s.h);
      var im = o.mapSrc ? pic(o.mapSrc(s), redraw) : null;
      if (im) ctx.drawImage(im, 0, 0, s.w, s.h);
      drawGrid(s);
      // pins
      (s.pins || []).forEach(function (p) {
        if (V.player && !p.vis) return;
        if (V.player && m && maskAt(m, p.x, p.y) < 1) return;
        ctx.save(); ctx.translate(p.x, p.y); var r = s.g * .22;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = p.vis ? '#e8c14a' : '#7a7ad0'; ctx.fill(); ctx.lineWidth = 2 / cam.z; ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.font = 'bold ' + Math.max(11 / cam.z, s.g * .2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3 / cam.z;
        ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(p.label || '', 0, r + 3 / cam.z); ctx.fillStyle = '#fff'; ctx.fillText(p.label || '', 0, r + 3 / cam.z); ctx.restore();
      });
      // walls (the Ref's)
      if (o.ref && !V.player) {
        (s.walls || []).forEach(function (w) {
          ctx.beginPath(); ctx.moveTo(w.a[0], w.a[1]); ctx.lineTo(w.b[0], w.b[1]);
          ctx.lineWidth = (w.t === 'wall' ? 4 : 6) / cam.z;
          ctx.strokeStyle = w.t === 'wall' ? '#ff9f43' : w.t === 'window' ? '#6ec1ff' : w.open ? '#5fe08a' : '#ff5d5d';
          if (w.t === 'door' && w.open) ctx.setLineDash([8 / cam.z, 6 / cam.z]);
          ctx.stroke(); ctx.setLineDash([]);
        });
      }
      tokens().filter(function (t) { return tokenSize(t) >= 1; }).sort(function (a, b) { return tokenSize(b) - tokenSize(a); }).concat(tokens().filter(function (t) { return tokenSize(t) < 1; })).forEach(function (t) { drawToken(s, t); });
      // fog
      var fi = fogImage(s, m);
      if (fi) {
        ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        if ('filter' in ctx) ctx.filter = 'blur(' + Math.min(12, m.cell * cam.z * .55) + 'px)';
        ctx.drawImage(fi, 0, 0, m.cw * m.cell, m.ch * m.cell); ctx.restore();
      }
      overlays(s);
      ctx.restore();
      if (V.pings.length) { var now = Date.now(); V.pings = V.pings.filter(function (p) { return now - p.t0 < 2200; }); if (V.pings.length) redraw(); }
      if (Object.keys(V.ghost).length) { var n2 = Date.now(); Object.keys(V.ghost).forEach(function (k) { if (V.ghost[k].until <= n2) delete V.ghost[k]; }); }
    }
    function overlays(s) {
      var d = V.drag;
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
      var now = Date.now();
      V.pings.forEach(function (p) {
        var k = (now - p.t0) / 2200; ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = p.color || '#ffd25a'; ctx.lineWidth = 4 / cam.z;
        for (var i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(p.x, p.y, (k * 1.6 + i * .5 * k) * s.g * 1.5 + s.g * .1, 0, 7); ctx.stroke(); }
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
      var t = hitToken(toWorld(e)); if (t && o.onMenu) o.onMenu(t, e);
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); var r = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener('pointerdown', function (e) {
      cv.focus(); pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (Object.keys(pointers).length === 2) {
        var ps = Object.keys(pointers).map(function (k) { return pointers[k]; });
        pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) }; V.drag = null; return;
      }
      var s = sc(); if (!s) return;
      var w = toWorld(e), tool = V.tool;
      if (e.button === 1 || V.spaceDown || e.button === 2) { V.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
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
      if (t) {
        V.sel = t.id; if (o.onSelect) o.onSelect(t);
        if (movable(t)) { var p = pos(t); V.drag = { type: 'token', token: t, from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y }, off: { x: w.x - p.x, y: w.y - p.y }, moved: false }; }
        redraw(); return;
      }
      var pin = hitPin(w);
      if (pin && o.onPin) { o.onPin(pin); return; }
      if (o.onSelect && V.sel) { V.sel = null; o.onSelect(null); }
      V.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, click: true }; redraw();
    });
    cv.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) { pointers[e.pointerId].x = e.clientX; pointers[e.pointerId].y = e.clientY; }
      if (pinch && Object.keys(pointers).length >= 2) {
        var ps = Object.keys(pointers).map(function (k) { return pointers[k]; }), nd = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), r = cv.getBoundingClientRect();
        zoomAt(nd / pinch.d, (ps[0].x + ps[1].x) / 2 - r.left, (ps[0].y + ps[1].y) / 2 - r.top); pinch.d = nd; return;
      }
      var s = sc(); if (!s) return;
      var w = toWorld(e), d = V.drag; V.hover = w;
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
      if (e.key === '+' || e.key === '=') zoomAt(1.2, V.size.w / 2, V.size.h / 2);
      if (e.key === '-') zoomAt(1 / 1.2, V.size.w / 2, V.size.h / 2);
      if (e.key === '0') fit();
      if (o.onKey) o.onKey(e);
    });
    cv.addEventListener('keyup', function (e) { if (e.key === ' ') V.spaceDown = false; });
    cv.addEventListener('pointerleave', function () { V.hover = null; });

    function ping(x, y, send) {
      V.pings.push({ x: x, y: y, t0: Date.now() }); redraw();
      if (send && o.onPing) o.onPing(x, y);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);
    setTimeout(resize, 0);

    return {
      canvas: cv, redraw: redraw, fit: fit, centerOn: centerOn, resize: resize, zoom: function (f) { zoomAt(f, V.size.w / 2, V.size.h / 2); },
      tool: function (t) { V.tool = t; V.chain = null; V.ruler = null; if (!/poly/.test(t)) V.drag = null; cv.style.cursor = t === 'select' ? 'default' : t === 'ping' || t === 'measure' ? 'crosshair' : 'cell'; redraw(); },
      getTool: function () { return V.tool; },
      brush: function (n) { V.brush = n; redraw(); },
      player: function (on) { V.player = !!on; V.fogMask = null; redraw(); },
      isPlayer: function () { return V.player; },
      select: function (id) { V.sel = id; redraw(); },
      selected: function () { return V.sel; },
      ping: function (x, y, color) { V.pings.push({ x: x, y: y, t0: Date.now(), color: color }); redraw(); },
      sceneChanged: function (id) { if (V.sceneId !== id) { V.sceneId = id; V.fogMask = null; V.ghost = {}; V.sel = null; V.chain = null; V.ruler = null; fit(); } else redraw(); },
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

  T.SIZES = SIZES; T.KIND_COLOR = KIND_COLOR; T.uid = uid; T.newScene = newScene; T.isHex = isHex; T.hexAt = hexAt; T.hexCenter = hexCenter; T.snap = snap;
  T.dist = dist; T.distText = distText; T.fogDims = fogDims; T.seenOf = seenOf; T.paintSeen = paintSeen; T.paintPoly = paintPoly; T.fillSeen = fillSeen; T.computeVision = computeVision;
  T.packMask = packMask; T.unpackMask = unpackMask; T.maskAt = maskAt; T.pathBlocked = pathBlocked; T.los = los; T.view = view; T.tokenArt = tokenArt; T.lightsOf = lightsOf;
  T.viewers = viewers;
})();
