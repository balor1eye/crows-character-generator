// Plain node test for src/shared/map-vision.js: node ref/test/test_map_vision.js (exits non-zero on failure).
var V = require('../../src/shared/map-vision.js');
var fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
var seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function hash(x, y) { var h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ---- align: a procedural scene seen through two windows
var shapes = [], i;
for (i = 0; i < 70; i++) shapes.push({ x: rnd(), y: rnd(), w: 0.02 + rnd() * 0.1, h: 0.02 + rnd() * 0.1, c: 40 + Math.floor(rnd() * 180) });
function render(W, H, x0, y0, ww, hh, extra) {
  var d = new Uint8ClampedArray(W * H * 4), x, y, k, s;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var u = x0 + (x + 0.5) / W * ww, v = y0 + (y + 0.5) / H * hh, c = 110;
    if (u < 0 || u > 1 || v < 0 || v > 1) c = 20;
    else {
      for (k = 0; k < shapes.length; k++) { s = shapes[k]; if (u >= s.x && u < s.x + s.w && v >= s.y && v < s.y + s.h) c = s.c; }
      if (extra) for (k = 0; k < extra.length; k++) { s = extra[k]; if (u >= s.x && u < s.x + s.w && v >= s.y && v < s.y + s.h) c = s.c; }
    }
    c += (hash(Math.floor(u * 400), Math.floor(v * 400)) - 0.5) * 10;
    var p = (y * W + x) * 4; d[p] = d[p + 1] = d[p + 2] = c; d[p + 3] = 255;
  }
  return { data: d, width: W, height: H };
}
var labels = [{ x: 0.1, y: 0.1, w: 0.12, h: 0.02, c: 250 }, { x: 0.5, y: 0.6, w: 0.1, h: 0.02, c: 5 }, { x: 0.7, y: 0.3, w: 0.14, h: 0.025, c: 250 }, { x: 0.3, y: 0.8, w: 0.1, h: 0.02, c: 5 }];
var a = render(480, 360, 0, 0, 1, 1, labels);
var t0 = Date.now();
var b = render(360, 315, 0.2, 0.15, 0.6, 0.7, null);       // crop, other resolution
var T = V.align(a, b), ms = Date.now() - t0;
console.log('crop transform', JSON.stringify(T), 'ms incl. render', ms);
check(T && Math.abs(T.sx - 1 / 0.6) < 0.04 && Math.abs(T.sy - 1 / 0.7) < 0.04 && Math.abs(T.ox + 0.2 / 0.6) < 0.02 && Math.abs(T.oy + 0.15 / 0.7) < 0.02, 'align recovers crop scale and offset');
var b2 = render(300, 300, -0.1, -0.1, 1.25, 1.25 * 360 / 480 * 300 / 300 * 1, null); // framed with margin
b2 = render(300, Math.round(300 * 0.75 * 1.0), -0.1, -0.1, 1.25, 1.25, null);
var T2 = V.align(a, b2);
console.log('margin transform', JSON.stringify(T2));
check(T2 && Math.abs(T2.sx - 0.8) < 0.02 && Math.abs(T2.sy - 0.8) < 0.02 && Math.abs(T2.ox - 0.08) < 0.02 && Math.abs(T2.oy - 0.08) < 0.02, 'align recovers margin framing');
var c = render(200, 150, 0.0, 0.0, 1, 1, null);
var T3 = V.align(a, c);
check(T3 && Math.abs(T3.sx - 1) < 0.02 && Math.abs(T3.sy - 1) < 0.02 && Math.abs(T3.ox) < 0.02 && Math.abs(T3.oy) < 0.02, 'align recovers plain resize with labels on a');
seed = 999;
var junk = []; for (i = 0; i < 70; i++) junk.push({ x: rnd(), y: rnd(), w: 0.02 + rnd() * 0.1, h: 0.02 + rnd() * 0.1, c: 40 + Math.floor(rnd() * 180) });
var saved = shapes; shapes = junk; var other = render(300, 225, 0, 0, 1, 1, null); shapes = saved;
var T4 = V.align(a, other);
check(T4 === null || T4.score < 0.6, 'unrelated image gives null or low score (' + (T4 ? T4.score.toFixed(2) : 'null') + ')');

// ---- transform
var objs = [{ name: 'A', type: 'other', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { name: 'B', type: 'other', x: 0.1, y: 0.5, w: 0.1, h: 0.1 }, { name: 'C', type: 'other', x: 0.9, y: 0.9, w: 0.1, h: 0.1, light: true }];
objs[2].x = 0.7; objs[2].y = 0.7;
var out = V.transform(objs, { sx: 2, sy: 2, ox: -0.5, oy: -0.5 });
check(out.length === 2 && out[0].name === 'A' && Math.abs(out[0].x - 0.5) < 1e-9 && Math.abs(out[0].w - 0.2) < 1e-9 && out[1].name === 'C' && out[1].light === true && Math.abs(out[1].x - 0.9) < 1e-9, 'transform maps, keeps fields, drops B (x would be -0.3)');
check(objs[0].x === 0.5, 'transform does not mutate input');

// ---- detect
var W = 600, H = 450, d = new Uint8ClampedArray(W * H * 4), x, y;
for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
  var v = 125 + (hash(x, y) - 0.5) * 24 + Math.sin(x / 40) * 6, p = (y * W + x) * 4;
  d[p] = v + 4; d[p + 1] = v; d[p + 2] = v - 4; d[p + 3] = 255;
}
function rect(x0, y0, w, h, r, g, bl) { for (var yy = y0; yy < y0 + h; yy++) for (var xx = x0; xx < x0 + w; xx++) { var q = (yy * W + xx) * 4; d[q] = r; d[q + 1] = g; d[q + 2] = bl; } }
rect(100, 100, 30, 30, 70, 45, 30); rect(300, 200, 40, 20, 60, 40, 25); rect(450, 300, 20, 20, 200, 200, 210); rect(150, 330, 60, 40, 55, 40, 30);
rect(40, 60, 400, 2, 20, 20, 20);                 // thin wall line
rect(520, 20, 3, 300, 20, 20, 20);                // thin vertical line
for (y = -7; y <= 7; y++) for (x = -7; x <= 7; x++) if (x * x + y * y <= 49) { var q2 = ((250 + y) * W + 400 + x) * 4; d[q2] = 255; d[q2 + 1] = 170; d[q2 + 2] = 40; }
var found = V.detect({ data: d, width: W, height: H }, { cols: 30 });
console.log('detected', JSON.stringify(found.map(function (o) { return [o.type, +(o.x * W).toFixed(0), +(o.y * H).toFixed(0), +(o.w * W).toFixed(0), +(o.h * H).toFixed(0)]; })));
function at(px, py, light) { return found.some(function (o) { return Math.abs(o.x * W - px) < 12 && Math.abs(o.y * H - py) < 12 && !!o.light === light; }); }
check(at(115, 115, false) && at(320, 210, false) && at(460, 310, false) && at(180, 350, false), 'detect finds the drawn squares');
check(at(400, 250, true), 'detect finds the warm dot as a light');
check(!found.some(function (o) { return (o.y * H < 70 && o.y * H > 50) || Math.abs(o.x * W - 521) < 6; }), 'detect ignores long thin lines');
check(found.length <= 40 && found.length <= 8, 'detect finds no texture (count ' + found.length + ')');
check(JSON.stringify(found) === JSON.stringify(V.detect({ data: d, width: W, height: H }, { cols: 30 })), 'detect is deterministic');
check(found.every(function (o) { return o.name && o.type && o.x > 0 && o.x < 1 && o.hidden === false && o.note === ''; }), 'detect objects have contract shape');
check(V.detect({ data: d, width: W, height: H }, { cols: 0 }).length >= 4, 'detect works with unknown cols');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
