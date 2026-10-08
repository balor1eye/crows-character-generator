/*
 * Ref Screen: map objects. A "map kit" is the furniture, lights, and environment of one map picture, kept in state.mapKits[mapId]
 * ({ objects, env, src: 'ai' | 'auto' | 'ref', at, noAsk }; positions are fractions of that map's picture). Kits come from:
 *   - detection when a map is uploaded or the Ref asks (generateKit): Claude's vision through the accounts server (api.php map.detect, when
 *     logged in and the server has a key), otherwise the browser's own shape finding (src/shared/map-vision.js, src 'auto');
 *   - the Ref saving the objects and environment standing on a scene's map (saveFromScene, src 'ref').
 * A map with labeled and unlabeled versions (siblings: an official map's variants, uploads with matching titles, or uploads the Ref paired in
 * state.mapPairs) is read on its labeled version, and the objects are carried to every other version by aligning the pictures.
 * Loading a map onto a scene (mapLoaded, called from ref-vtt.js) places the kit, or offers to generate one. Tokens are kind 'obj' with gen = map id.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var blobUrl = f('blobUrl'), customMaps = f('customMaps'), render = f('render'), save = f('save'), vttChanged = f('vttChanged'), artRemote = f('artRemote');
  var el = A.el, toast = A.toast, plural = A.plural, clone = A.clone, REFD = window.REF, Tbl = window.CrowsTable;
  var state = A.state; A.share('state', function (v) { state = v; });
  var KINDS_OK = { dungeon: 1, open: 1, village: 1 };
  var ICONS = { chest: '▣', table: '▭', chair: '⊓', bed: '▬', shelf: '≡', altar: '✚', statue: '♜', pillar: '●', barrel: '◍', crate: '▢', well: '◎', fountain: '≈',
    trap: '⚠', door: '▯', stairs: '☰', light: '✶', plant: '♣', rubble: '∴', body: '☠', other: '◆' };
  var LABELS = /\b(labell?ed|labels?|key|gm|dm|players?|unlabell?ed|no labels)\b/ig;
  var running = {}, waiting = {};   // map id -> the generation under way; map id -> the scene waiting for its objects

  // ------------------------------------------------------------------ maps, their names, and their siblings
  function kits() { return state.mapKits || (state.mapKits = {}); }
  function pairs() { return state.mapPairs || (state.mapPairs = {}); }
  function mapIdOf(m) { return !m ? '' : m.b ? 'b|' + m.b : m.k ? 'k|' + m.k : ''; }
  function mapOf(id) { return id.charAt(0) === 'b' ? { b: id.slice(2) } : { k: id.slice(2) }; }
  function hasKit(k) { return !!(k && k.src); }
  function kitOf(id) { var k = kits()[id]; return hasKit(k) ? k : null; }
  /* The official map entry and variant for a file, or the upload's record. */
  function officialOf(id) {
    var hit = null;
    if (id.charAt(0) === 'b') (REFD.ART.maps || []).forEach(function (m) { m.variants.forEach(function (v) { if (v.file === id.slice(2)) hit = { m: m, v: v }; }); });
    return hit;
  }
  function recOf(id) { return id.charAt(0) === 'k' ? customMaps().filter(function (r) { return r.key === id.slice(2); })[0] || null : null; }
  function titleOf(id) {
    var o = officialOf(id), r = recOf(id);
    return o ? o.m.title + (o.m.variants.length > 1 ? ' (' + o.v.label + ')' : '') : r ? r.title : 'this map';
  }
  function srcOf(id) { var o = officialOf(id), r = recOf(id); return o ? o.v.file : r ? blobUrl(r) : null; }
  function normTitle(t) { return String(t || '').replace(LABELS, ' ').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase(); }
  function labeledWord(t) { return /\b(labell?ed|labels?|key|gm|dm)\b/i.test(t) && !/\b(unlabell?ed|no labels?)\b/i.test(t); }
  /* Every version of a map, the map itself included. */
  function siblings(id) {
    var o = officialOf(id);
    if (o) return o.m.variants.map(function (v) { return 'b|' + v.file; });
    var out = [id], p = pairs();
    Object.keys(p).forEach(function (a) { if (a === id || p[a] === id) { [a, p[a]].forEach(function (x) { if (out.indexOf(x) < 0 && recOf(x)) out.push(x); }); } });
    var n = normTitle((recOf(id) || {}).title);
    if (n) customMaps().forEach(function (r) { var x = 'k|' + r.key; if (out.indexOf(x) < 0 && normTitle(r.title) === n) out.push(x); });
    return out;
  }
  /* The version whose printed labels name the objects: the paired one, a variant labeled so, or an upload titled so. */
  function labeledOf(id) {
    var sibs = siblings(id), p = pairs(), hit = null;
    sibs.forEach(function (s) { if (!hit && p[s] && sibs.indexOf(p[s]) >= 0) hit = p[s]; });
    if (hit) return hit;
    sibs.forEach(function (s) {
      var o = officialOf(s), t = o ? o.v.label : (recOf(s) || {}).title;
      if (!hit && t && (o ? /label/i.test(t) && !/\b(un|no)[- ]?label/i.test(t) : labeledWord(t))) hit = s;
    });
    return hit;
  }
  /* Squares across a map picture, when it is known (0 when not). */
  function colsOf(id, sc) {
    var o = officialOf(id), r = recOf(id), nm = r && /(\d{2,3})\s*[x×]\s*(\d{2,3})/i.exec(r.title);
    if (o && o.v.cols) return o.v.cols;
    if (sc && sc.map && mapIdOf(sc.map) === id && sc.g) return Math.round(sc.w / sc.g);
    return nm ? +nm[1] : 0;
  }
  function loadImg(id) {
    return new Promise(function (ok, no) {
      var src = srcOf(id); if (!src) return no(new Error('no picture'));
      var img = new Image(); img.onload = function () { ok(img); }; img.onerror = function () { no(new Error('picture not found')); }; img.src = src;
    });
  }

  // ------------------------------------------------------------------ detection
  function cropJpeg(img, x0, y0, x1, y1, max) {
    var sw = (x1 - x0) * img.naturalWidth, sh = (y1 - y0) * img.naturalHeight, k = Math.min(1, max / Math.max(sw, sh));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(img, x0 * img.naturalWidth, y0 * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .85).split(',')[1];
  }
  function envKeys() { return (REFD.ENV || []).map(function (e) { return [e[0], e[1]]; }); }
  function askServer(body) {
    return window.CrowsCloud.api('POST', 'map.detect', '', body).then(function (j) {
      return { objects: Array.isArray(j.objects) ? j.objects : [], env: Array.isArray(j.env) ? j.env : [] };
    });
  }
  /* Claude's reading of the picture, in one call or (a wide map) up to four overlapping tiles with their results mapped back and de-duplicated. */
  function detectRemote(img, info) {
    var V = window.CrowsMapVision, W = img.naturalWidth, H = img.naturalHeight, cols = info.cols, wide = cols > 50;
    var tx = wide ? 2 : 1, ty = wide && H / W * cols > 50 ? 2 : 1, ov = .06, jobs = [];
    for (var j = 0; j < ty; j++) for (var i = 0; i < tx; i++) jobs.push({ x0: Math.max(0, i / tx - ov), x1: Math.min(1, (i + 1) / tx + ov), y0: Math.max(0, j / ty - ov), y1: Math.min(1, (j + 1) / ty + ov) });
    var base = { mime: 'image/jpeg', hasLabels: info.hasLabels, kind: info.kind, title: info.title, envKeys: envKeys() };
    return Promise.all(jobs.map(function (t) {
      var whole = jobs.length === 1;
      return askServer(Object.assign({ image: whole ? V.jpeg(img, 1600, .85) : cropJpeg(img, t.x0, t.y0, t.x1, t.y1, 1600),
        cols: whole ? cols : Math.round(cols * (t.x1 - t.x0)), rows: cols ? Math.round(cols * (t.y1 - t.y0) * H / W) : 0 }, base)).then(function (r) {
        r.objects = r.objects.map(function (o) { var c = clone(o); c.x = t.x0 + o.x * (t.x1 - t.x0); c.y = t.y0 + o.y * (t.y1 - t.y0); c.w = o.w * (t.x1 - t.x0); c.h = o.h * (t.y1 - t.y0); return c; });
        return r;
      });
    })).then(function (rs) {
      var out = [], env = [];
      rs.forEach(function (r) {
        r.env.forEach(function (k) { if (env.indexOf(k) < 0) env.push(k); });
        r.objects.forEach(function (o) {
          var dup = out.some(function (p) { return String(p.name).toLowerCase() === String(o.name).toLowerCase() && Math.hypot(p.x - o.x, p.y - o.y) < .02; });
          if (!dup) out.push(o);
        });
      });
      return { objects: out, env: env };
    });
  }
  function cleanObjects(list) {
    return (list || []).filter(function (o) { return o && isFinite(o.x) && isFinite(o.y) && o.x >= 0 && o.x <= 1 && o.y >= 0 && o.y <= 1; }).slice(0, 80).map(function (o) {
      return { name: String(o.name || 'Object').slice(0, 40), type: ICONS[o.type] ? o.type : 'other', x: +o.x, y: +o.y, w: Math.max(0.002, +o.w || 0.02), h: Math.max(0.002, +o.h || 0.02),
        light: !!o.light, hidden: !!o.hidden, note: String(o.note || '').slice(0, 200) };
    });
  }

  /* Find the objects on a map (and its other versions) and keep them as its kit. Resolves with the kit; never throws. opts: { cols, kind, force,
     quiet } (force reads the picture again even over a Ref-saved kit; quiet leaves out the finished message). Only one run per map at a time. */
  function generateKit(id, opts) {
    opts = opts || {};
    if (running[id]) return running[id];
    var V = window.CrowsMapVision;
    if (!V) { toast('The object finder isn\'t loaded.'); return Promise.resolve(null); }
    /* Claude reads the labeled version's printed names; shape finding only would mistake its label text for objects, so it reads an unlabeled one. */
    var sibs = siblings(id), lab = labeledOf(id), srcId = (artRemote() ? lab : lab === id ? sibs.filter(function (s) { return s !== lab; })[0] : null) || (function () { var full = sibs.filter(function (s) { var o = officialOf(s); return o && /full/i.test(o.v.label); })[0]; return full || id; })();
    var srcKit = kitOf(srcId), reuse = srcKit && !opts.force, title = titleOf(id), made = null, why = 'log in for named objects';
    if (!opts.quiet) toast('Looking for objects on ' + title + '…', 6000);
    var run = (reuse ? Promise.resolve(null) : loadImg(srcId).then(function (img) {
      var info = { cols: colsOf(srcId) || (srcId === id ? opts.cols || 0 : 0), hasLabels: srcId === lab, kind: opts.kind || 'dungeon', title: titleOf(srcId) };
      var remote = artRemote() ? detectRemote(img, info) : Promise.reject(new Error('no login'));
      return remote.then(function (r) { r.src = 'ai'; return r; }, function (e) {
        var r = V.detect(V.pixels(img, 1024), { cols: info.cols });
        return { objects: r || [], env: [], src: 'auto', why: !artRemote() ? 'log in for named objects' : e && e.status === 429 ? 'the server\'s hourly limit is used up' : 'the server can\'t name them right now' };
      }).then(function (r) { r.img = img; return r; });
    })).then(function (r) {
      var at = Date.now(), noAsk = !!((kits()[srcId] || {}).noAsk), env = {};
      if (r && r.why) why = r.why;
      if (r) {
        r.env.forEach(function (k) { env[k] = true; });
        made = { objects: cleanObjects(r.objects), env: env, src: r.src, at: at, noAsk: noAsk };
        kits()[srcId] = made;
      } else made = srcKit;
      // carry them to the other versions that don't have a kit the Ref saved
      var others = sibs.filter(function (s) { return s !== srcId && (opts.force ? true : !kitOf(s)); });
      return others.reduce(function (p, s) {
        return p.then(function () {
          if (kitOf(s) && kitOf(s).src === 'ref') return;
          return loadImg(s).then(function (img2) {
            var a = r && r.img ? V.pixels(r.img, 512) : null;
            return (a ? Promise.resolve(a) : loadImg(srcId).then(function (i) { return V.pixels(i, 512); })).then(function (pa) {
              var T = V.align(pa, V.pixels(img2, 512));
              if (!T) return;
              kits()[s] = { objects: cleanObjects(V.transform(made.objects, T)), env: clone(made.env), src: made.src, at: at, noAsk: !!(kits()[s] && kits()[s].noAsk) };
            });
          }).catch(function () { /* that version's picture is missing or can't be read */ });
        });
      }, Promise.resolve());
    }).then(function () {
      delete running[id];
      save();
      var k = kitOf(id) || made;
      if (!opts.quiet) {
        var n = k ? k.objects.length : 0;
        toast(!k ? 'Couldn\'t read objects from ' + title + '.' : n ? 'Found ' + plural(n, 'object') + ' on ' + title + (k.src === 'auto' ? ', by shape only (' + why + ').' : '.') : 'Found no objects on ' + title + (k.src === 'auto' ? ' by shape (' + why + ').' : '.'), 5000);
      }
      var sid = waiting[id]; delete waiting[id];
      if (sid && k) { var sc = scenes().filter(function (s) { return s.id === sid; })[0]; if (sc && mapIdOf(sc.map) === id) { placeKit(sc, id); vttChanged(); render(); } }
      render();
      return k;
    }, function (e) {
      delete running[id]; delete waiting[id];
      toast('Couldn\'t read objects from ' + title + ': ' + (e && e.message || 'unknown error'), 5000);
      return null;
    });
    running[id] = run;
    return run;
  }

  // ------------------------------------------------------------------ kits on scenes
  function scenes() { return (state.vtt && state.vtt.scenes) || []; }
  function genTokens(sc, id) { return sc.tokens.filter(function (t) { return t.gen === id; }); }
  function objTokens(sc) { return sc.tokens.filter(function (t) { return t.kind === 'obj'; }); }
  function mergeEnv(sc, env) {
    var added = 0; sc.env = sc.env || {};
    Object.keys(env || {}).forEach(function (k) {
      if (!env[k] || sc.env[k]) return;
      if (k === 'dark' && sc.env.dim || k === 'dim' && sc.env.dark) return;   // one light level at a time
      if (k === 'storm' && sc.env.rain || k === 'rain' && sc.env.storm) return;
      sc.env[k] = true; added++;
    });
    return added;
  }
  /* Put a kit's objects (and environment) on the scene: tokens the Ref sees (lights the players see too). Returns how many were placed; a scene that
     already has this map's generated tokens gets none. */
  function placeKit(sc, id, opts) {
    var k = kitOf(id); if (!k || !sc.w || !sc.g) return 0;
    if (genTokens(sc, id).length && !(opts && opts.again)) return 0;
    var n = 0;
    k.objects.forEach(function (o) {
      var size = Math.max(1, Math.round(Math.max(o.w * sc.w, o.h * sc.h) / sc.g)), p = Tbl.snap(sc, o.x * sc.w, o.y * sc.h, size);
      var lp = /^(\d+)\/(\d+)/.exec(o.lp || '5/5') || [0, 5, 5], light = o.light ? { b: +lp[1], d: +lp[2], on: true } : null;
      if (light && o.fire) light.fire = true;
      sc.tokens.push({ id: Tbl.uid('k'), name: o.name || 'Object', kind: 'obj', x: p.x, y: p.y, size: size, hidden: !!o.hidden || (!o.light && !o.shown), speed: 5,
        gen: id, otype: o.type || 'other', secret: !!o.hidden, icon: ICONS[o.type] || (o.light ? '✶' : '◆'), light: light, label: false, locked: true, note: o.note || '' });
      n++;
    });
    var e = mergeEnv(sc, k.env);
    if (n || e) { vttChanged(); }
    return n;
  }
  function removeGen(sc, id) {
    var n = genTokens(sc, id).length; sc.tokens = sc.tokens.filter(function (t) { return t.gen !== id; });
    if (n) vttChanged();
    return n;
  }
  /* Keep the objects (all the scene's marker tokens) and environment on the scene's map as that map's kit; offers to copy to its other versions. */
  function saveFromScene(sc) {
    var id = mapIdOf(sc && sc.map); if (!id) return toast('Put a map on this scene first.');
    if (!sc.w || !sc.h) return;
    var objs = objTokens(sc).map(function (t) {
      var o = { name: t.name, type: t.otype || (t.light ? 'light' : 'other'), x: t.x / sc.w, y: t.y / sc.h, w: (t.size || 1) * sc.g / sc.w, h: (t.size || 1) * sc.g / sc.h,
        light: !!t.light, hidden: t.secret != null ? !!t.secret : !!t.hidden && !!t.light, note: t.note || '' };
      if (!t.light && !t.hidden) o.shown = true;
      if (t.light) { o.lp = t.light.b + '/' + t.light.d; if (t.light.fire) o.fire = true; }
      return o;
    });
    var env = {}; Object.keys(sc.env || {}).forEach(function (k) { if (sc.env[k]) env[k] = true; });
    var old = kits()[id];
    kits()[id] = { objects: objs, env: env, src: 'ref', at: Date.now(), noAsk: !!(old && old.noAsk) };
    objTokens(sc).forEach(function (t) { t.gen = id; });
    save();
    var others = siblings(id).filter(function (s) { return s !== id; });
    toast('Saved ' + plural(objs.length, 'object') + (Object.keys(env).length ? ' and the environment' : '') + ' for ' + titleOf(id) + '.');
    if (others.length) ask('Copy to the other versions?', 'Carry these objects over to ' + others.map(titleOf).join(', ') + '? Their own saved sets are replaced.', [
      { label: 'Copy to ' + plural(others.length, 'other version'), primary: true, fn: function () { copyKit(id, others); } }, { label: 'Only this one' }]);
    render();
  }
  /* Carry a kit to other versions of the map by aligning the pictures. */
  function copyKit(id, targets) {
    var V = window.CrowsMapVision, k = kitOf(id), done = 0;
    if (!V || !k) return;
    loadImg(id).then(function (img) {
      var pa = V.pixels(img, 512);
      return targets.reduce(function (p, s) {
        return p.then(function () {
          return loadImg(s).then(function (i2) {
            var T = V.align(pa, V.pixels(i2, 512)); if (!T) return;
            kits()[s] = { objects: cleanObjects(V.transform(k.objects, T)), env: clone(k.env), src: k.src, at: Date.now(), noAsk: !!(kits()[s] && kits()[s].noAsk) }; done++;
          }).catch(function () { /* unreadable */ });
        });
      }, Promise.resolve());
    }).then(function () { save(); toast(done ? 'Copied to ' + plural(done, 'other version') + '.' : 'Couldn\'t line the pictures up, so nothing was copied.'); });
  }

  // ------------------------------------------------------------------ the pop-up
  /* A small modal dialog: Tab stays inside it, Esc closes it, and focus goes back where it was. buttons: [{ label, fn, primary }]. */
  function ask(title, text, buttons) {
    var prev = document.activeElement, old = document.getElementById('mapobj-ask'); if (old) old.remove();
    var host = document.fullscreenElement || document.body, h = el('h3', { id: 'mapobj-ask-t', text: title, style: 'margin:0 0 .5rem' });
    function close() { box.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus && document.body.contains(prev)) prev.focus(); }
    var bs = buttons.map(function (b) {
      return el('button', { type: 'button', class: 'btn btn-small' + (b.primary ? ' btn-primary' : ''), text: b.label, onclick: function () { close(); if (b.fn) b.fn(); } });
    });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var i = bs.indexOf(document.activeElement), n = bs.length;
      e.preventDefault(); bs[(i + (e.shiftKey ? n - 1 : 1)) % n].focus();
    }
    var box = el('div', { id: 'mapobj-ask', class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mapobj-ask-t', style: 'align-items:center;justify-content:center',
      onclick: function (e) { if (e.target === box) close(); } }, [
      el('div', { style: 'background:var(--paper);color:var(--ink);border:1px solid var(--ink);border-radius:8px;padding:1rem;max-width:26rem;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.35)' }, [
        h, el('p', { text: text, style: 'margin:0 0 .8rem' }), el('div', { class: 'row' }, bs)])]);
    host.appendChild(box); document.addEventListener('keydown', onKey, true); bs[0].focus();
  }
  /* Called by ref-vtt.js once a map the Ref chose is on a scene (not for grid re-fits, saved encounters, or hex/blank scenes). */
  function mapLoaded(sc) {
    var id = mapIdOf(sc && sc.map); if (!id || !KINDS_OK[sc.kind]) return;
    var k = kitOf(id), title = titleOf(id);
    if (k) {
      var n = placeKit(sc, id);
      if (n) { toast('Placed ' + plural(n, 'object') + ' on ' + title + ' from its saved set.'); render(); }
      return;
    }
    if (running[id]) { waiting[id] = sc.id; toast('Still looking for objects on ' + title + '; they go on the map when found.'); return; }
    if ((kits()[id] || {}).noAsk || objTokens(sc).length) return;
    ask('Generate objects for ' + title + '?', 'This map has no objects yet. Generate them? (Furniture, chests, altars, and lights are found from the picture.)', [
      { label: 'Generate', primary: true, fn: function () { generateHere(sc, id); } }, { label: 'Not now' },
      { label: 'Don\'t ask for this map', fn: function () { setNoAsk(id, true); } }]);
  }
  function setNoAsk(id, on) {
    var k = kits()[id] || (kits()[id] = { objects: [], env: {}, src: '', at: 0, noAsk: false });
    k.noAsk = !!on; save(); render();
  }
  /* Generate for this scene's map and put the objects on it (replacing any generated ones when `again`). */
  function generateHere(sc, id, again) {
    if (running[id]) { waiting[id] = sc.id; toast('Still looking for objects; they go on the map when found.'); return; }
    if (!again) waiting[id] = sc.id;   // the run places them itself when it finishes
    generateKit(id, { cols: colsOf(id, sc), kind: sc.kind, force: !!again }).then(function (k) {
      if (!again || !k || mapIdOf(sc.map) !== id) return;
      removeGen(sc, id);
      var n = placeKit(sc, id, { again: true }); toast('Placed ' + plural(n, 'object') + '.'); vttChanged(); render();
    });
  }

  // ------------------------------------------------------------------ the menus
  /* The board menu's "Map objects" submenu for the scene (null when it has no map). */
  function menuItems(sc) {
    var id = mapIdOf(sc && sc.map); if (!id) return null;
    var k = kitOf(id), mine = genTokens(sc, id).length, busy = !!running[id];
    return { label: 'Map objects', sub: [
      { label: 'Save objects & environment for this map', hint: 'Keeps every marker token and the environment as this map\'s set, to place whenever the map is loaded.', fn: function () { saveFromScene(sc); } },
      { label: 'Place saved objects', off: !k || !k.objects.length && !Object.keys(k.env || {}).length, hint: k ? '' : 'No saved or found objects for this map yet.', fn: function () {
        var n = placeKit(sc, id, { again: true }); toast(n ? 'Placed ' + plural(n, 'object') + '.' : 'Nothing new to place.'); render(); } },
      { label: busy ? 'Looking for objects…' : k ? 'Generate objects again' : 'Generate objects', off: busy, hint: 'Reads the picture for furniture, chests, and lights (Claude when logged in; shapes otherwise).',
        fn: function () { if (k && k.src === 'ref' && !confirm('Replace the objects you saved for this map?')) return; generateHere(sc, id, true); } },
      { label: 'Remove generated objects', off: !mine, danger: true, fn: function () { var n = removeGen(sc, id); toast('Removed ' + plural(n, 'object') + '.'); render(); } },
      { sep: true },
      { label: 'Ask about objects for this map', on: !(kits()[id] || {}).noAsk, hint: 'The pop-up when a map with no objects is loaded.', fn: function () { setNoAsk(id, !(kits()[id] || {}).noAsk); } }] };
  }
  /* Items for an uploaded map tile's right-click menu (popMenu: { label, fn | sub }). */
  function tileItems(m) {
    var id = 'k|' + m.key, p = pairs(), others = customMaps().filter(function (r) { return r.key !== m.key; });
    return [{ label: 'Labeled version…', sub: others.map(function (r) {
      var on = p[id] === 'k|' + r.key;
      return { label: (on ? '✓ ' : '') + r.title, fn: function () { if (on) delete p[id]; else p[id] = 'k|' + r.key; save(); toast(on ? 'Unpaired.' : '"' + r.title + '" is the labeled version of "' + m.title + '".'); if (!on) generateKit(id, {}); } };
    }).concat(others.length ? [{ sep: true }] : [], p[id] ? [{ label: 'No labeled version', fn: function () { delete p[id]; save(); render(); } }] : [],
      others.length ? [] : [{ label: 'Add another map first', fn: function () {} }]) },
      { label: running[id] ? 'Looking for objects…' : 'Generate objects', fn: function () { if (!running[id]) generateKit(id, { force: true }); } }];
  }
  /* After an upload: read it in the background. */
  function uploaded(rec) { generateKit('k|' + rec.key, {}); }

  A.add({ mapLoaded: mapLoaded, mapKitSave: saveFromScene, mapObjMenu: menuItems, mapTileItems: tileItems, mapUploaded: uploaded, generateKit: generateKit, mapIdOf: mapIdOf,
    mapKitOf: kitOf, mapSiblings: siblings, mapLabeledOf: labeledOf, placeKit: placeKit });
})();
