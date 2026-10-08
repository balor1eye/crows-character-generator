/*
 * Map vision helpers: window.CrowsMapVision (also module.exports under node, for ref/test/test_map_vision.js).
 *
 * Pixel buffers are { data: Uint8ClampedArray RGBA, width, height } (what canvas getImageData returns).
 *   pixels(img, maxSide)    browser: draw an <img> into a canvas, long side <= maxSide, return a buffer
 *   jpeg(img, maxSide, q)   browser: base64 JPEG (no data: prefix) of the scaled image, for the server's map.detect
 *   align(a, b)             { sx, sy, ox, oy, score } | null: bx = ax*sx + ox, by = ay*sy + oy in normalized (0..1) coordinates
 *   transform(objs, T)      objects mapped through an align() result; those whose centre leaves 0..1 are dropped
 *   detect(buf, grid)       heuristic object/light finder, objects in the map.detect shape (fractions of the image)
 *
 * align cost: two edge maps (Sobel magnitude, lightly blurred, clipped so printed text cannot dominate). A coarse pass at 64 px long
 * side tries ~23 scales (0.4..3 in 9% steps; one pixel scale for both axes, so a differently framed sheet still works) x every
 * 2 px offset, scoring a normalized cross-correlation on a sparse grid of a's pixels that fall inside b. The best few distinct
 * candidates are refined by pattern search on 192 px maps. About 0.2-0.5 s for 512 px inputs in a browser.
 *
 * detect: everything works on a downsample where a square is ~8 px. Blobs are pixels that differ from a wide blur of their
 * surroundings by more than the floor's own noise, opened to drop speckle and lines, then connected components that are
 * 0.4-4.5 squares, compact and not elongated. Light = small bright warm (orange/yellow) blobs. Deterministic.
 */
(function () {
  'use strict';
  var V = {};

  // ------------------------------------------------------------------ browser helpers
  function canvasFor(img, maxSide) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var k = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  V.pixels = function (img, maxSide) {
    var c = canvasFor(img, maxSide || 512);
    return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
  };
  V.jpeg = function (img, maxSide, quality) {
    var c = canvasFor(img, maxSide || 1600);
    var u = c.toDataURL('image/jpeg', quality || 0.85);
    return u.slice(u.indexOf(',') + 1);
  };

  // ------------------------------------------------------------------ image plumbing
  // Area-average resample. src has `stride` interleaved channels; the first `och` are kept. Returns Float32Array(nw*nh*och).
  function box(src, sw, sh, stride, nw, nh, och) {
    var out = new Float32Array(nw * nh * och);
    var fx = sw / nw, fy = sh / nh;
    var stx = Math.max(1, Math.floor(fx / 4)), sty = Math.max(1, Math.floor(fy / 4));
    for (var y = 0; y < nh; y++) {
      var y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * fy)));
      for (var x = 0; x < nw; x++) {
        var x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * fx)));
        var n = 0, a0 = 0, a1 = 0, a2 = 0;
        for (var j = y0; j < y1; j += sty) {
          for (var i = x0; i < x1; i += stx) {
            var p = (j * sw + i) * stride;
            a0 += src[p]; if (och > 1) { a1 += src[p + 1]; a2 += src[p + 2]; }
            n++;
          }
        }
        var o = (y * nw + x) * och;
        out[o] = a0 / n; if (och > 1) { out[o + 1] = a1 / n; out[o + 2] = a2 / n; }
      }
    }
    return out;
  }
  function grayOf(buf, nw, nh) {
    var rgb = box(buf.data, buf.width, buf.height, 4, nw, nh, 3), g = new Float32Array(nw * nh);
    for (var i = 0; i < g.length; i++) g[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    return g;
  }
  function sizeFor(buf, L) {
    var k = L / Math.max(buf.width, buf.height);
    return [Math.max(2, Math.round(buf.width * k)), Math.max(2, Math.round(buf.height * k))];
  }
  function blur3(src, w, h) {
    var t = new Float32Array(src.length), o = new Float32Array(src.length), x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      t[i] = (src[x > 0 ? i - 1 : i] + src[i] + src[x < w - 1 ? i + 1 : i]) / 3;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      o[i] = (t[y > 0 ? i - w : i] + t[i] + t[y < h - 1 ? i + w : i]) / 3;
    }
    return o;
  }
  // Edge strength map: Sobel magnitude, blurred twice, clipped at ~97th percentile, scaled 0..1.
  function edgeMap(g, w, h) {
    var e = new Float32Array(w * h), x, y, i;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      var gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      e[i] = Math.sqrt(gx * gx + gy * gy);
    }
    e = blur3(blur3(e, w, h), w, h);
    var hist = new Uint32Array(256), mx = 0;
    for (i = 0; i < e.length; i++) if (e[i] > mx) mx = e[i];
    if (mx <= 0) return { e: e, w: w, h: h };
    for (i = 0; i < e.length; i++) hist[Math.min(255, Math.floor(e[i] / mx * 255))]++;
    var acc = 0, cut = mx, want = e.length * 0.97;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) { cut = (i + 1) / 255 * mx; break; } }
    for (i = 0; i < e.length; i++) e[i] = Math.min(1, e[i] / cut);
    return { e: e, w: w, h: h };
  }
  function edgesAt(buf, L) {
    var d = sizeFor(buf, L);
    return edgeMap(grayOf(buf, d[0], d[1]), d[0], d[1]);
  }

  // ------------------------------------------------------------------ align
  // Score a map a -> b: b_px = (a_px - ca) * s + c (c = where a's centre lands, in b pixels). st = sampling stride in a.
  // Returns normalized cross-correlation over a's pixels landing inside b, scaled down when the overlap is small.
  function score(A, B, s, cx, cy, st) {
    var wa = A.w, ha = A.h, wb = B.w, hb = B.h, ae = A.e, be = B.e;
    var ox = cx - wa / 2 * s, oy = cy - ha / 2 * s;
    var ix0 = Math.max(0, ox), iy0 = Math.max(0, oy), ix1 = Math.min(wb, ox + wa * s), iy1 = Math.min(hb, oy + ha * s);
    if (ix1 <= ix0 || iy1 <= iy0) return 0;
    var cov = (ix1 - ix0) * (iy1 - iy0) / Math.min(wa * ha * s * s, wb * hb);
    if (cov < 0.3) return 0;
    var n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    var i0 = Math.max(1, Math.ceil((ix0 - ox) / s)), i1 = Math.min(wa - 2, Math.floor((ix1 - ox) / s));
    var j0 = Math.max(1, Math.ceil((iy0 - oy) / s)), j1 = Math.min(ha - 2, Math.floor((iy1 - oy) / s));
    for (var j = j0; j <= j1; j += st) {
      var by = j * s + oy;
      if (by < 0 || by >= hb - 1) continue;
      var yi = by | 0, fy = by - yi;
      for (var i = i0; i <= i1; i += st) {
        var bx = i * s + ox;
        if (bx < 0 || bx >= wb - 1) continue;
        var xi = bx | 0, fx = bx - xi, p = yi * wb + xi;
        var vb = (be[p] * (1 - fx) + be[p + 1] * fx) * (1 - fy) + (be[p + wb] * (1 - fx) + be[p + wb + 1] * fx) * fy;
        var va = ae[j * wa + i];
        n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
      }
    }
    if (n < 60) return 0;
    var cva = saa / n - sa * sa / (n * n), cvb = sbb / n - sb * sb / (n * n);
    if (cva < 1e-6 || cvb < 1e-6) return 0;
    var r = (sab / n - sa * sb / (n * n)) / Math.sqrt(cva * cvb);
    if (r <= 0) return 0;
    return r * Math.sqrt(Math.min(1, cov / 0.6));
  }

  V.align = function (a, b) {
    if (!a || !b || !a.width || !b.width) return null;
    // coarse
    var A = edgesAt(a, 64), B = edgesAt(b, 64), cands = [], s, k;
    for (k = 0; ; k++) {
      s = 0.4 * Math.pow(1.09, k);
      if (s > 3.05) break;
      var oxl = -A.w * s * 0.7, oxh = B.w - A.w * s * 0.3, oyl = -A.h * s * 0.7, oyh = B.h - A.h * s * 0.3;
      for (var oy = oyl; oy <= oyh; oy += 2) for (var ox = oxl; ox <= oxh; ox += 2) {
        var cx = ox + A.w / 2 * s, cy = oy + A.h / 2 * s;
        var sc = score(A, B, s, cx, cy, 3);
        if (sc > 0.2) cands.push({ s: s, cx: cx, cy: cy, sc: sc });
      }
      if (cands.length > 600) { cands.sort(byScore); cands.length = 150; }
    }
    cands.sort(byScore);
    var picks = [];
    for (var c = 0; c < cands.length && picks.length < 6; c++) {
      var ok = true;
      for (var q = 0; q < picks.length; q++) {
        var p = picks[q];
        if (Math.abs(Math.log(cands[c].s / p.s)) < 0.15 && Math.abs(cands[c].cx - p.cx) < 6 && Math.abs(cands[c].cy - p.cy) < 6) { ok = false; break; }
      }
      if (ok) picks.push(cands[c]);
    }
    if (!picks.length) return null;
    // refine on 192 px maps
    var A2 = edgesAt(a, 192), B2 = edgesAt(b, 192), best = null;
    var rs = A2.w / A.w; // a-frame scale 64 -> 192 (b frame scales the same way)
    for (var m = 0; m < picks.length; m++) {
      var cur = { s: picks[m].s, cx: picks[m].cx * (B2.w / B.w), cy: picks[m].cy * (B2.h / B.h) };
      // s is b-px per a-px; both frames change by their own long-side factor
      cur.s = picks[m].s * (B2.w / B.w) / (A2.w / A.w);
      cur.sc = score(A2, B2, cur.s, cur.cx, cur.cy, 2);
      var steps = [[1.04, 3], [1.02, 1.5], [1.01, 0.75], [1.005, 0.4]];
      for (var L = 0; L < steps.length; L++) {
        for (var it = 0; it < 24; it++) {
          var moved = false, ds = steps[L][0], dd = steps[L][1];
          var tries = [[cur.s * ds, cur.cx, cur.cy], [cur.s / ds, cur.cx, cur.cy], [cur.s, cur.cx + dd, cur.cy], [cur.s, cur.cx - dd, cur.cy],
            [cur.s, cur.cx, cur.cy + dd], [cur.s, cur.cx, cur.cy - dd]];
          for (var t = 0; t < tries.length; t++) {
            var v = score(A2, B2, tries[t][0], tries[t][1], tries[t][2], 2);
            if (v > cur.sc + 1e-6) { cur = { s: tries[t][0], cx: tries[t][1], cy: tries[t][2], sc: v }; moved = true; }
          }
          if (!moved) break;
        }
      }
      if (!best || cur.sc > best.sc) best = cur;
    }
    if (!best || best.sc < 0.35) return null;
    var sx = best.s * A2.w / B2.w, sy = best.s * A2.h / B2.h;
    var ox2 = best.cx - A2.w / 2 * best.s, oy2 = best.cy - A2.h / 2 * best.s;
    return { sx: sx, sy: sy, ox: ox2 / B2.w, oy: oy2 / B2.h, score: Math.min(1, best.sc) };
  };
  function byScore(p, q) { return q.sc - p.sc; }

  V.transform = function (objs, T) {
    var out = [];
    if (!T) return out;
    for (var i = 0; i < (objs || []).length; i++) {
      var o = objs[i], r = {}, k;
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
      r.x = o.x * T.sx + T.ox; r.y = o.y * T.sy + T.oy;
      r.w = o.w * T.sx; r.h = o.h * T.sy;
      if (r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1) continue;
      out.push(r);
    }
    return out;
  };

  // ------------------------------------------------------------------ detect
  function boxBlur(src, w, h, r) {
    // integral-image box blur with clamped window
    var I = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var row = 0;
      for (x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    var out = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }
  function morph(m, w, h, grow) { // 3x3 erode (grow=false) or dilate (grow=true)
    var o = new Uint8Array(m.length), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var hit = grow ? 0 : 1;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy, v = (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : m[yy * w + xx];
        if (grow) { if (v) hit = 1; } else if (!v) hit = 0;
      }
      o[y * w + x] = hit;
    }
    return o;
  }
  // 4-connected components of a mask: [{ x0, y0, x1, y1, n, sx, sy, sum }]; `weight` (optional) accumulates into sum.
  function components(m, w, h, weight) {
    var seen = new Uint8Array(m.length), out = [], stack = [];
    for (var s = 0; s < m.length; s++) {
      if (!m[s] || seen[s]) continue;
      var c = { x0: w, y0: h, x1: -1, y1: -1, n: 0, sx: 0, sy: 0, sum: 0 };
      seen[s] = 1; stack.length = 0; stack.push(s);
      while (stack.length) {
        var p = stack.pop(), x = p % w, y = (p - x) / w;
        c.n++; c.sx += x; c.sy += y; if (weight) c.sum += weight[p];
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        if (x > 0 && m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && m[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && m[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
      }
      out.push(c);
    }
    return out;
  }

  V.detect = function (buf, grid) {
    if (!buf || !buf.width) return [];
    var cols = grid && grid.cols > 0 ? grid.cols : 30;
    var sqSrc = buf.width / cols;
    var k = Math.min(640 / Math.max(buf.width, buf.height), 8 / sqSrc, 1.5);
    var w = Math.max(8, Math.round(buf.width * k)), h = Math.max(8, Math.round(buf.height * k));
    var sq = sqSrc * k; // one square in work pixels
    if (sq < 3) return [];
    var rgb = box(buf.data, buf.width, buf.height, 4, w, h, 3), n = w * h, i;
    var g = new Float32Array(n);
    for (i = 0; i < n; i++) g[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    g = blur3(g, w, h);
    var bg = boxBlur(g, w, h, Math.max(3, Math.round(sq * 3)));
    var D = new Float32Array(n), ad = new Float32Array(n);
    for (i = 0; i < n; i++) { D[i] = g[i] - bg[i]; ad[i] = Math.abs(D[i]); }
    // robust noise level of the floor: median absolute deviation
    var hist = new Uint32Array(256);
    for (i = 0; i < n; i++) hist[Math.min(255, Math.floor(ad[i]))]++;
    var acc = 0, med = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n / 2) { med = i; break; } }
    var thr = Math.max(18, 1.48 * (med + 0.5) * 3.5);
    // lights first
    var lm = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var r = rgb[i * 3], gg = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      if (r > 190 && r >= gg && gg >= b && r - b > 70 && gg > 90 && (r + gg + b) / 3 > 140 && D[i] > 22) lm[i] = 1;
    }
    var out = [], lights = [], lc = components(lm, w, h, null);
    for (i = 0; i < lc.length; i++) {
      var c = lc[i], bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (c.n < 3 || Math.max(bw, bh) > 2 * sq) continue;
      if (Math.min(bw, bh) / Math.max(bw, bh) < 0.4 || c.n / (bw * bh) < 0.4) continue;
      lights.push({ cx: (c.x0 + c.x1 + 1) / 2, cy: (c.y0 + c.y1 + 1) / 2, bw: Math.max(bw, sq * 0.5), bh: Math.max(bh, sq * 0.5), s: c.n * 1000 });
    }
    // objects
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) if (ad[i] > thr) mask[i] = 1;
    mask = morph(morph(mask, w, h, false), w, h, true);
    var cs = components(mask, w, h, ad), objs = [];
    for (i = 0; i < cs.length; i++) {
      var o = cs[i], ow = o.x1 - o.x0 + 1, oh = o.y1 - o.y0 + 1;
      if (ow < sq * 0.4 || oh < sq * 0.4 || ow > sq * 4.5 || oh > sq * 4.5) continue;
      if (o.n < sq * sq * 0.25) continue;
      if (Math.min(ow, oh) / Math.max(ow, oh) < 0.3) continue;
      if (o.n / (ow * oh) < 0.4) continue;
      objs.push({ cx: (o.x0 + o.x1 + 1) / 2, cy: (o.y0 + o.y1 + 1) / 2, bw: ow, bh: oh, s: o.sum / o.n * Math.sqrt(o.n) });
    }
    // lights win over objects on the same spot; near duplicates collapse to the stronger one
    var keep = [], j, all = [];
    for (i = 0; i < lights.length; i++) { lights[i].light = true; all.push(lights[i]); }
    for (i = 0; i < objs.length; i++) {
      var dup = false;
      for (j = 0; j < lights.length; j++) if (near(objs[i], lights[j])) { dup = true; break; }
      if (!dup) all.push(objs[i]);
    }
    all.sort(function (p, q) { return (q.light ? 1e12 : 0) + q.s - ((p.light ? 1e12 : 0) + p.s) || p.cy - q.cy || p.cx - q.cx; });
    for (i = 0; i < all.length; i++) {
      var d2 = false;
      for (j = 0; j < keep.length; j++) if (near(all[i], keep[j])) { d2 = true; break; }
      if (!d2) keep.push(all[i]);
      if (keep.length >= 40) break;
    }
    keep.sort(function (p, q) { return p.cy - q.cy || p.cx - q.cx; });
    for (i = 0; i < keep.length; i++) {
      var kk = keep[i];
      out.push({ name: kk.light ? 'Light' : 'Object', type: kk.light ? 'light' : 'other', x: kk.cx / w, y: kk.cy / h, w: kk.bw / w, h: kk.bh / h,
        light: !!kk.light, hidden: false, note: '' });
    }
    return out;
  };
  function near(p, q) {
    var d = Math.max(p.bw, p.bh, q.bw, q.bh) * 0.6;
    return Math.abs(p.cx - q.cx) < d && Math.abs(p.cy - q.cy) < d;
  }

  if (typeof window !== 'undefined') window.CrowsMapVision = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})();
