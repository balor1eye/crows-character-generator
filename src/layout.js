/*
 * Page layouts for the Character Generator, Play, and the Ref Screen: anyone can rearrange the blocks on a page.
 *
 * Each page (Build, Play, each Ref Screen tab) is a row of columns holding its blocks (the cards, plus the sidebar).
 * The Layout button in the header unlocks the page: blocks show their names and can be dragged anywhere, into
 * another column too. While a block is dragged the others slide to where they'll end up, and the block takes the
 * width of the column under it; a block too wide for a narrow column is scaled down to fit. The column setup can
 * be changed (wide + narrow, narrow + wide, two equal, three, one), and Reset puts the page back as it was. Locking
 * the page keeps the arrangement.
 *
 * Arrangements are kept per page in the account (prefs.get / prefs.save in server/app/api.php) when logged in, and
 * in this browser otherwise. Blocks a newer version adds go to their usual column. Narrow screens show one column
 * (the sidebar first, as before) unless the page is unlocked, which shows the columns stacked so blocks can still
 * move between them. The Ref's view of a player's sheet keeps the default layout.
 *
 * The app calls Layout.init(cfg) once and Layout.apply() whenever the page changes (Build/Play, a Ref Screen tab),
 * and Layout.fit() after it re-renders (to rescale blocks that got wider than their column).
 * cfg: { pages: { id: { blocks: [ids], cols: [[ids], [ids]], colClass } }, current(): id, narrow: CSS width of a
 * narrow column, breakpoint: px below which it's one column, titles: { id: name }, nav: element for the button }.
 */
(function () {
  'use strict';
  var KEY = 'crows-layouts';
  var PRESETS = [
    ['main-side', 'Wide + narrow', ['W', 'N']], ['side-main', 'Narrow + wide', ['N', 'W']],
    ['two', 'Two equal', ['W', 'W']], ['three', 'Three', ['W', 'W', 'W']], ['one', 'One', ['W']]];
  var cfg = null, root = null, store = null, bar = null, btnEl = null;
  var page = null, layouts = {}, owner = null, editing = false, cols = [];
  var drag = null, saveTimer = null, pending = {};

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function preset(id) { return PRESETS.filter(function (p) { return p[0] === id; })[0] || PRESETS[0]; }
  function template(id) {
    return preset(id)[2].map(function (w) { return w === 'N' ? cfg.narrow : 'minmax(0, 1fr)'; }).join(' ');
  }
  // Logged in is enough: the page's own record (a character, a campaign) may still be loading.
  function api(method, action, body) { return window.CrowsCloud && window.CrowsCloud.user ? window.CrowsCloud.api(method, action, '', body) : Promise.reject(new Error('offline')); }

  // ------------------------------------------------------------------ saved arrangements
  function readLocal() { try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); return d && typeof d === 'object' ? d : null; } catch (e) { return null; } }
  function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify({ owner: owner, layouts: layouts })); } catch (e) { /* storage unavailable */ } }
  /* The page's arrangement: what was saved, cleaned up against the blocks the page has now. */
  function layoutFor(id) {
    var def = cfg.pages[id], saved = layouts[id], known = {}, n;
    def.blocks.forEach(function (b) { known[b] = true; });
    var p = saved && saved.preset ? preset(saved.preset) : preset(def.preset || 'main-side');
    n = p[2].length;
    var out = []; for (var i = 0; i < n; i++) out.push([]);
    var placed = {};
    if (saved && Array.isArray(saved.cols)) saved.cols.forEach(function (col, i) {
      (col || []).forEach(function (b) { if (known[b] && !placed[b]) { out[Math.min(i, n - 1)].push(b); placed[b] = true; } });
    });
    def.cols.forEach(function (col, i) { col.forEach(function (b) { if (!placed[b]) { out[Math.min(i, n - 1)].push(b); placed[b] = true; } }); });
    return { preset: p[0], cols: out };
  }
  /* Keep the page's arrangement here and in the account (a moment after the last change). */
  function remember(id, l) {
    if (l) layouts[id] = l; else delete layouts[id];
    writeLocal();
    pending[id] = l || null;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, 600);
  }
  function flushSaves() {
    if (!owner) { pending = {}; return; }
    var todo = pending; pending = {};
    Object.keys(todo).forEach(function (id) {
      api('POST', 'prefs.save', { page: id, layout: todo[id] }).then(null, function () { pending[id] = todo[id]; clearTimeout(saveTimer); saveTimer = setTimeout(flushSaves, 10000); });
    });
  }

  // ------------------------------------------------------------------ building the page
  function blockEl(id) { return $(id); }
  function allBlocks() {
    var seen = {}, out = [];
    Object.keys(cfg.pages).forEach(function (p) { cfg.pages[p].blocks.forEach(function (b) { if (!seen[b] && blockEl(b)) { seen[b] = true; out.push(blockEl(b)); } }); });
    return out;
  }
  function title(b) {
    if (cfg.titles && cfg.titles[b.id]) return cfg.titles[b.id];
    var h = b.querySelector('h2');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 48) : b.id;
  }
  /* Put the current page's blocks into its columns (the other pages' blocks wait out of sight). */
  function apply(force) {
    if (!cfg || drag) return;
    var id = cfg.current();
    if (!cfg.pages[id] || (!force && id === page && cols.length)) return;   // still this page: nothing to move
    page = id;
    var l = layoutFor(id);
    allBlocks().forEach(function (b) { b.classList.add('lay-block'); store.appendChild(b); });
    cols.forEach(function (c) { c.remove(); });
    cols = l.cols.map(function (ids, i) {
      var c = el('div', { class: 'lay-col ' + (cfg.pages[id].colClass || ''), 'data-col': String(i) });
      ids.forEach(function (b) { if (blockEl(b)) c.appendChild(blockEl(b)); });
      root.insertBefore(c, store);
      return c;
    });
    root.style.setProperty('--lay-cols', template(l.preset));
    root.setAttribute('data-lay-cols', String(cols.length));
    root.classList.add('lay-on');
    if (editing) { markBlocks(); showBar(); }
    fit();
  }
  /* The page's own arrangement, ignoring anything saved. */
  function defaultLayout(id) { var s = layouts[id]; delete layouts[id]; var d = layoutFor(id); if (s) layouts[id] = s; return d; }
  /* Save the page as it is now (nothing, when that's just the default). */
  function keep() { var c = current(); remember(page, JSON.stringify(c) === JSON.stringify(defaultLayout(page)) ? null : c); }
  /* The arrangement as it is on the page now. */
  function current() {
    return { preset: (layoutFor(page) || {}).preset, cols: cols.map(function (c) {
      return Array.prototype.filter.call(c.children, function (x) { return x.classList.contains('lay-block'); }).map(function (x) { return x.id; });
    }) };
  }

  /*
   * Scale a block down when its contents are wider than its column (an inventory or a wide table in a narrow
   * column), so nothing is cut off. Back to full size when it fits again.
   */
  var fitting = false;
  function fit() {
    if (fitting || !cols.length) return;
    fitting = true;
    cols.forEach(function (c) {
      Array.prototype.forEach.call(c.children, function (b) {
        if (!b.classList.contains('lay-block') || b === (drag && drag.b)) return;
        fitBlock(b);
      });
    });
    fitting = false;
  }
  function fitBlock(b) {
    b.style.zoom = '';
    var w = b.clientWidth, sw = b.scrollWidth;
    if (w > 0 && sw > w + 2) b.style.zoom = String(Math.max(0.55, w / sw).toFixed(3));
  }

  // ------------------------------------------------------------------ unlocking
  function markBlocks() {
    cols.forEach(function (c) { Array.prototype.forEach.call(c.children, function (b) {
      if (!b.classList.contains('lay-block')) return;
      b.setAttribute('data-lay-title', title(b) + (b.hidden ? ' (shows when needed)' : ''));
      b.setAttribute('tabindex', '0');
      b.setAttribute('aria-roledescription', 'movable block');
      b.setAttribute('aria-label', title(b) + '. Drag, or use the arrow keys, to move it.');
    }); });
  }
  function unmark() {
    allBlocks().forEach(function (b) { ['data-lay-title', 'tabindex', 'aria-roledescription', 'aria-label'].forEach(function (a) { b.removeAttribute(a); }); });
  }
  function showBar() {
    if (bar) bar.remove();
    var l = layoutFor(page);
    bar = el('div', { class: 'lay-bar', role: 'region', 'aria-label': 'Rearranging this page' }, [
      el('div', { class: 'lay-bar-text' }, [el('b', { text: 'Rearranging this page. ' }), 'Drag a block to move it, into another column too (on a phone, press and hold first; with the keyboard, focus a block and use the arrow keys).']),
      el('div', { class: 'lay-bar-tools' }, [
        el('span', { class: 'lay-lbl', text: 'Columns:' }),
        el('div', { class: 'lay-seg', role: 'group', 'aria-label': 'Columns' }, PRESETS.map(function (p) {
          return el('button', { type: 'button', class: p[0] === l.preset ? 'on' : '', 'aria-pressed': String(p[0] === l.preset), text: p[1], onclick: function () { setPreset(p[0]); } });
        })),
        el('button', { type: 'button', class: 'btn btn-ghost lay-reset', text: 'Reset', title: 'Put this page back the way it came', onclick: reset }),
        el('button', { type: 'button', class: 'btn btn-primary lay-lock', text: '🔒 Lock page', onclick: function () { setEditing(false); } })])]);
    root.insertBefore(bar, root.firstChild);
  }
  function setEditing(on) {
    if (drag) endDrag(true);
    editing = !!on;
    document.body.classList.toggle('lay-edit', editing);
    if (btnEl) {
      btnEl.textContent = editing ? '🔓 Lock page' : '🔒 Layout';
      btnEl.setAttribute('aria-pressed', String(editing));
      btnEl.title = editing ? 'Lock the page and keep this arrangement' : 'Unlock the page to rearrange its blocks';
    }
    if (editing) { markBlocks(); showBar(); }
    else {
      if (bar) { bar.remove(); bar = null; }
      unmark();
      if (page) keep();
      flushSaves();
    }
    fit();
  }
  /* Change the columns: blocks in columns that go away join the last one left. */
  function setPreset(p) {
    var l = current(), n = preset(p)[2].length, out = [];
    for (var i = 0; i < n; i++) out.push([]);
    l.cols.forEach(function (c, i) { out[Math.min(i, n - 1)] = out[Math.min(i, n - 1)].concat(c); });
    var before = snapshot();
    remember(page, { preset: p, cols: out });
    apply(true);
    flip(before);
  }
  function reset() {
    var before = snapshot();
    remember(page, null);
    apply(true);
    flip(before);
  }

  // ------------------------------------------------------------------ animation
  function visibleBlocks() {
    var out = [];
    cols.forEach(function (c) { Array.prototype.forEach.call(c.children, function (b) { if (b.classList.contains('lay-block') || b.classList.contains('lay-ph')) out.push(b); }); });
    return out;
  }
  function snapshot() { var m = []; visibleBlocks().forEach(function (b) { m.push([b, b.getBoundingClientRect()]); }); return m; }
  /* Slide every block from where it was to where it is now. */
  function flip(before) {
    if (!document.body.animate && !Element.prototype.animate) return;
    before.forEach(function (pair) {
      var b = pair[0], r = pair[1];
      if (drag && b === drag.b) return;
      var n = b.getBoundingClientRect(), dx = r.left - n.left, dy = r.top - n.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      b.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.75,.25,1)' });
    });
  }

  // ------------------------------------------------------------------ dragging
  function blockAt(t) { var b = t && t.closest ? t.closest('.lay-block') : null; return b && cols.some(function (c) { return c.contains(b); }) ? b : null; }
  function onDown(e) {
    if (!editing || drag || e.button > 0) return;
    if (e.target.closest && e.target.closest('.lay-bar')) return;
    var b = blockAt(e.target);
    if (!b) return;
    var start = { b: b, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch', ready: e.pointerType !== 'touch' };
    if (start.touch) start.timer = setTimeout(function () { start.ready = true; b.classList.add('lay-armed'); if (navigator.vibrate) navigator.vibrate(15); }, 350);
    function move(ev) {
      if (ev.pointerId !== start.id) return;
      var far = Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y);
      if (!drag) {
        if (!start.ready) { if (far > 8) cancel(); return; }   // a touch that moves first is a scroll
        if (far < 4) return;
        beginDrag(start, ev);
      }
      if (drag) { ev.preventDefault(); moveDrag(ev.clientX, ev.clientY); }
    }
    function up(ev) { if (ev.pointerId !== start.id) return; cancel(); if (drag) endDrag(false); }
    function cancel() {
      clearTimeout(start.timer); b.classList.remove('lay-armed');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function beginDrag(start, ev) {
    var b = start.b, r = b.getBoundingClientRect();
    var ph = el('div', { class: 'lay-ph', 'aria-hidden': 'true' });
    ph.style.height = r.height + 'px';
    var before = snapshot();
    drag = { b: b, ph: ph, dx: ev.clientX - r.left, dy: ev.clientY - r.top, home: b.parentNode, next: b.nextSibling, x: ev.clientX, y: ev.clientY, y0: start.y, w: r.width };
    b.parentNode.insertBefore(ph, b);
    b.classList.add('lay-dragging');
    b.style.width = r.width + 'px'; b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
    document.body.appendChild(b);
    document.body.classList.add('lay-grabbing');
    flip(before);
    scrollLoop();
  }
  /* The column under the pointer (or the nearest one), and where in it the block would go. */
  function targetAt(x, y) {
    // Side by side: the column under the pointer (or the nearest one across). Stacked (a narrow screen): the nearest one down.
    var best = null, bestD = Infinity;
    cols.forEach(function (c) {
      var r = c.getBoundingClientRect(), dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0, dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      var d = dx * 100000 + dy;
      if (d < bestD) { bestD = d; best = c; }
    });
    var before = null;
    Array.prototype.some.call(best.children, function (k) {
      if (!k.classList.contains('lay-block')) return false;
      var r = k.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = k; return true; }
      return false;
    });
    return { col: best, before: before };
  }
  function nextBlock(n) { do { n = n.nextElementSibling; } while (n && !n.classList.contains('lay-block')); return n || null; }
  function moveDrag(x, y) {
    var d = drag;
    d.x = x; d.y = y;
    var t = targetAt(x, y);
    if (t.col !== d.ph.parentNode || nextBlock(d.ph) !== t.before) {
      var before = snapshot();
      if (t.before) t.col.insertBefore(d.ph, t.before); else t.col.appendChild(d.ph);
      flip(before);
    }
    // The block takes the width of the column it's over (and rescales if it's too wide for it).
    var w = d.ph.offsetWidth;   // the column's width for a block
    if (Math.abs(w - d.w) > 1) {
      d.w = w; d.b.style.width = w + 'px'; d.dx = Math.min(d.dx, w - 24);
      fitBlock(d.b);
      requestAnimationFrame(function () { if (drag === d) d.ph.style.height = Math.min(d.b.getBoundingClientRect().height, window.innerHeight * 0.6) + 'px'; });
    }
    d.b.style.left = (x - d.dx) + 'px';
    d.b.style.top = (y - Math.min(d.dy, d.b.offsetHeight - 12)) + 'px';
  }
  /* Scroll the page while the block is held near the top or bottom of the window. */
  function scrollLoop() {
    if (!drag) return;
    // Only once the block has been moved: grabbing one near the edge shouldn't send the page off.
    var y = drag.y, edge = 70, moved = Math.abs(y - drag.y0) > 40;
    var v = !moved ? 0 : y < edge ? -(edge - y) / 4 : y > window.innerHeight - edge ? (y - window.innerHeight + edge) / 4 : 0;
    if (v) { window.scrollBy(0, v); moveDrag(drag.x, drag.y); }
    requestAnimationFrame(scrollLoop);
  }
  function endDrag(cancelled) {
    var d = drag;
    if (!d) return;
    if (cancelled) d.home.insertBefore(d.ph, d.next && d.next.parentNode === d.home ? d.next : null);   // back where it was
    var r = d.ph.getBoundingClientRect();
    d.b.style.transition = 'left .18s ease, top .18s ease, width .18s ease';
    d.b.style.left = r.left + 'px'; d.b.style.top = r.top + 'px'; d.b.style.width = r.width + 'px';
    var finish = function () {
      if (d.done) return;
      d.done = true;
      d.ph.parentNode.insertBefore(d.b, d.ph);
      d.ph.remove();
      d.b.classList.remove('lay-dragging');
      ['transition', 'left', 'top', 'width'].forEach(function (k) { d.b.style[k] = ''; });
      document.body.classList.remove('lay-grabbing');
      drag = null;
      if (!cancelled) keep();
      fit();
      d.b.focus({ preventScroll: true });
    };
    setTimeout(finish, 200);
  }
  /* Keyboard: arrow keys move the focused block up, down, or to the next column. */
  function onKey(e) {
    if (!editing) return;
    if (e.key === 'Escape' && drag) { endDrag(true); return; }
    var b = document.activeElement;
    if (!b || !b.classList || !b.classList.contains('lay-block') || drag) return;
    var col = b.parentNode, ci = cols.indexOf(col);
    if (ci < 0 || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) < 0) return;
    e.preventDefault();
    var before = snapshot(), sib = function (n, dir) { do { n = dir < 0 ? n.previousElementSibling : n.nextElementSibling; } while (n && !n.classList.contains('lay-block')); return n; };
    if (e.key === 'ArrowUp') { var p = sib(b, -1); if (p) col.insertBefore(b, p); }
    else if (e.key === 'ArrowDown') { var nx = sib(b, 1); if (nx) col.insertBefore(b, nx.nextSibling); }
    else {
      var to = cols[ci + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (!to) return;
      var idx = Array.prototype.filter.call(col.children, function (x) { return x.classList.contains('lay-block'); }).indexOf(b);
      var there = Array.prototype.filter.call(to.children, function (x) { return x.classList.contains('lay-block'); });
      to.insertBefore(b, there[idx] || null);
    }
    flip(before);
    b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    keep();
    fit();
  }

  // ------------------------------------------------------------------ setting up
  function injectStyles() {
    var bp = cfg.breakpoint || 1000;
    var css =
      'main.layout.lay-on{grid-template-columns:var(--lay-cols)}' +
      '.lay-col{display:flex;flex-direction:column;gap:1rem;min-width:0}' +
      '.lay-store{display:none!important}' +
      // A sidebar that isn't last in its column scrolls with the page instead of staying put over the blocks below it.
      '.lay-col>.lay-block:not(:last-child){position:relative;top:auto}' +
      '@media (max-width:' + bp + 'px){main.layout.lay-on{grid-template-columns:minmax(0,1fr)}body:not(.lay-edit) .lay-col{display:contents}}' +
      // Unlocked
      '.lay-bar{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6rem 1rem;padding:.7rem .9rem;' +
      'border:2px solid var(--sel,#d9a441);border-radius:8px;background:var(--card,#fff);color:var(--ink,#111);box-shadow:0 4px 18px rgba(0,0,0,.12);position:sticky;top:8px;z-index:30}' +
      '.lay-bar-text{flex:1 1 320px;font-size:.92rem}.lay-bar-tools{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem}.lay-lbl{font-size:.85rem;color:var(--muted,#666)}' +
      '.lay-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line,#ccc);border-radius:6px;overflow:hidden}' +
      '.lay-seg button{border:0;border-right:1px solid var(--line,#ccc);background:var(--card,#fff);color:var(--ink,#111);padding:.35rem .6rem;font:inherit;font-size:.82rem;cursor:pointer;min-height:34px}' +
      '.lay-seg button:last-child{border-right:0}.lay-seg button.on{background:var(--ink,#111);color:var(--card,#fff);font-weight:600}' +
      'body.lay-edit .lay-col{min-height:160px;padding:.4rem;margin:-.4rem;border-radius:10px;outline:2px dashed color-mix(in srgb,var(--line,#ccc) 80%,transparent);outline-offset:0;' +
      'background:color-mix(in srgb,var(--sel,#d9a441) 5%,transparent)}' +
      'body.lay-edit .lay-col:not(:has(.lay-block,.lay-ph))::after{content:"Drop blocks here";margin:auto;color:var(--muted,#888);font-size:.9rem}' +
      'body.lay-edit .lay-block:not(.lay-dragging){position:relative!important;top:auto!important}' +
      'body.lay-edit .lay-block{max-height:380px;overflow:hidden;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none;' +
      'outline:2px dashed var(--sel,#d9a441);outline-offset:2px;transition:box-shadow .15s,outline-color .15s}' +
      'body.lay-edit .lay-block>*{pointer-events:none}' +
      'body.lay-edit .lay-block[hidden]{display:block!important;min-height:3.4rem;opacity:.75;background:var(--card,#fff);border-radius:8px}' +
      'body.lay-edit .lay-block::before{content:"\\283F  " attr(data-lay-title);display:block;position:relative;z-index:2;font:700 .74rem/1.4 var(--font,system-ui,sans-serif);' +
      'letter-spacing:.06em;text-transform:uppercase;color:var(--accent,#a3231a);padding:.35rem .6rem;margin:0 0 .4rem;background:color-mix(in srgb,var(--sel,#d9a441) 18%,var(--card,#fff));border-radius:6px}' +
      'body.lay-edit .lay-block::after{content:"";position:absolute;left:0;right:0;bottom:0;height:56px;background:linear-gradient(transparent,var(--card,#fff));pointer-events:none;border-radius:0 0 8px 8px}' +
      'body.lay-edit .lay-block:hover,body.lay-edit .lay-block:focus-visible{outline-color:var(--accent,#a3231a);box-shadow:0 6px 22px rgba(0,0,0,.18)}' +
      'body.lay-edit .lay-block.lay-armed{outline-style:solid;transform:scale(.99)}' +
      'body .lay-block.lay-dragging{position:fixed!important;z-index:1000;margin:0!important;cursor:grabbing;pointer-events:none;opacity:.97;box-shadow:0 18px 50px rgba(0,0,0,.35)!important;' +
      'outline:3px solid var(--accent,#a3231a)!important;transform:rotate(.6deg);transition:width .18s ease}' +
      'body.lay-grabbing,body.lay-grabbing *{cursor:grabbing!important}' +
      '.lay-ph{border:2px dashed var(--accent,#a3231a);border-radius:8px;background:color-mix(in srgb,var(--accent,#a3231a) 9%,transparent);transition:height .18s ease;min-height:48px}' +
      '.lay-btn[aria-pressed="true"]{background:var(--sel,#d9a441)!important;color:#111!important;border-color:var(--sel,#d9a441)!important}' +
      '@media (max-width:' + bp + 'px){body.lay-edit main.layout.lay-on{grid-template-columns:minmax(0,1fr)}body.lay-edit .lay-col{margin:0 0 .6rem}}' +
      '@media (prefers-reduced-motion:reduce){.lay-block.lay-dragging,.lay-ph{transition:none}}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  function init(c) {
    cfg = c;
    root = document.querySelector('main.layout');
    if (!root || (window.CrowsCloud && window.CrowsCloud.linked)) { cfg = null; return; }   // the Ref's view of a player's sheet keeps its layout
    injectStyles();
    store = el('div', { class: 'lay-store', 'aria-hidden': 'true' });
    root.appendChild(store);
    // The pages' own containers (Build steps, Play, the Ref Screen tabs) give their blocks to the columns.
    (c.containers || []).forEach(function (sel) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (n) { store.appendChild(n); }); });
    var local = readLocal();
    if (local && local.layouts) { layouts = local.layouts; owner = local.owner || null; }
    if (c.nav) {
      btnEl = el('button', { type: 'button', class: 'btn btn-ghost lay-btn', 'aria-pressed': 'false', text: '🔒 Layout', title: 'Unlock the page to rearrange its blocks', onclick: function () { setEditing(!editing); } });
      c.nav.insertBefore(btnEl, c.nav.querySelector('.theme-toggle'));
    }
    root.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', function () { requestAnimationFrame(fit); });
    window.addEventListener('beforeunload', function () { if (Object.keys(pending).length) flushSaves(); });
    apply(true);
    // Logged in: the account's arrangements; a guest: this browser's.
    if (window.CrowsCloud && window.CrowsCloud.afterMe) window.CrowsCloud.afterMe(function (user) {
      var uid = user ? user.id : null;
      if (!uid) {
        if (owner) { layouts = {}; owner = null; writeLocal(); apply(true); }   // someone else's arrangement was kept here: not this visitor's
        return;
      }
      api('GET', 'prefs.get').then(function (j) {
        var acct = (j.prefs && j.prefs.layouts) || {};
        // A guest's arrangement in this browser goes into the account the first time (if the account has none).
        if (owner === null && Object.keys(layouts).length && !Object.keys(acct).length) {
          Object.keys(layouts).forEach(function (id) { pending[id] = layouts[id]; acct[id] = layouts[id]; });
          owner = uid; layouts = acct; writeLocal(); flushSaves();
        } else { owner = uid; layouts = acct; writeLocal(); }
        if (!drag && !editing) apply(true);
      }, function () { /* an older server: this browser's arrangement */ });
    });
  }

  window.CrowsLayout = { init: init, apply: function () { apply(false); }, fit: function () { if (cfg && !editing) fit(); }, get editing() { return editing; }, setEditing: setEditing };
})();
