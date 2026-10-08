/*
 * Undo and redo on the Ref's Tabletop (ref/test/run_vtt_undo_test.py): Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) and the right-click menu undo and redo the
 * last 5 changes; pings never make a step; a new change clears redo; typing in a field is left alone; a wall deleted with Delete comes back.
 * Called as a WebDriver async script; reports { ok, steps, error }.
 */
var done = arguments[arguments.length - 1];
var steps = [];
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function st() { return window.CrowsRef.state; }
function scene() { return st().vtt.scenes[0]; }
function tk(id) { return scene().tokens.filter(function (t) { return t.id === id; })[0]; }
function wall(id) { return scene().walls.filter(function (w) { return w.id === id; })[0]; }
window.confirm = function () { return true; };

(async function () {
  var A = window.CrowsRefApp, U = A.ui.vtt;
  function tab(name) { var b = qa('#tabbar [role=tab]').filter(function (x) { return text(x).indexOf(name) === 0; })[0]; if (!b) throw new Error('no tab ' + name); b.click(); }
  tab('Tabletop');
  qa('button', q('.vtt-empty')).filter(function (b) { return text(b).indexOf('Battle map') === 0; })[0].click();
  await wait(300);
  var cv = U.view.canvas, g = scene().g, ox = scene().ox || 0, oy = scene().oy || 0;
  U.view.tool('select');
  var c0 = U.view.center(), gx0 = Math.round((c0.x - ox) / g), gy0 = Math.round((c0.y - oy) / g);
  function P(i, j) { return [ox + (gx0 + i) * g, oy + (gy0 + j) * g]; }
  function scr(p) {
    var z = U.view.zoomLevel(), c = U.view.center(), r = cv.getBoundingClientRect();
    return { x: r.left + (p[0] - c.x) * z + r.width / 2, y: r.top + (p[1] - c.y) * z + r.height / 2 };
  }
  function ev(type, p, o) {
    var s = scr(p), e = Object.assign({ clientX: s.x, clientY: s.y, pointerId: 7, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }, o || {});
    return type === 'contextmenu' ? new MouseEvent(type, e) : new PointerEvent(type, e);
  }
  function fire(type, p, o) { cv.dispatchEvent(ev(type, p, o)); }
  function dragTo(p0, p1) {
    fire('pointerdown', p0);
    for (var i = 1; i <= 4; i++) fire('pointermove', [p0[0] + (p1[0] - p0[0]) * i / 4, p0[1] + (p1[1] - p0[1]) * i / 4]);
    fire('pointerup', p1);
  }
  function key(k, o, target) { var e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})); (target || document.body).dispatchEvent(e); return e; }
  function undoKey() { return key('z', { ctrlKey: true }); }
  function redoKey() { return key('y', { ctrlKey: true }); }
  function toastText() { return text(q('#toast')); }
  var runs = 0, RAT = 'tkU';   // a fresh token id each setup, so the view never reuses a stale token
  function setup() {
    scene().walls = [{ id: 'wA', a: P(0, 0), b: P(2, 0), t: 'wall', open: false }, { id: 'wC', a: P(-4, 3), b: P(-2, 3), t: 'wall', open: false }];
    scene().tokens = [{ id: (RAT = 'tkU' + (++runs)), name: 'Rat', kind: 'obj', x: P(-6, -6)[0], y: P(-6, -6)[1], size: 1, hidden: false, speed: 5 }];
    U.hist = null; A.save(); A.render(); U.view.selectWall(null); U.sel = null;
  }
  function px(id) { return Math.round(tk(id).x); }
  /* Move the rat one square right by dragging it; returns its new x. */
  async function drag() { var t = tk(RAT); dragTo([t.x, t.y], [t.x + g, t.y]); await wait(60); return px(RAT); }
  /* Same move, as the code every tabletop edit runs (a drag is flaky to repeat six times). */
  async function nudge() { tk(RAT).x += g; A.vttChanged(); A.render(); await wait(20); return px(RAT); }
  function menuBtn(label) { var b = qa('.tbl-menu button').filter(function (x) { return text(x).replace(/^✓\s*/, '').indexOf(label) === 0; })[0]; if (!b) throw new Error('no menu item ' + label); return b; }

  // (a) move a token, Ctrl+Z restores it, Ctrl+Y re-applies.
  setup(); await wait(100);
  var x0 = px(RAT), x1 = await drag();
  check(x1 > x0, 'a: dragging the token moves it right');
  var e = undoKey();
  check(px(RAT) === x0 && e.defaultPrevented, 'a: Ctrl+Z puts the token back (and the key is taken)');
  redoKey();
  check(px(RAT) === x1, 'a: Ctrl+Y moves it again');
  undoKey(); key('z', { ctrlKey: true, shiftKey: true });
  check(px(RAT) === x1, 'a: Ctrl+Shift+Z redoes too');
  undoKey(); key('z', { metaKey: true });
  check(px(RAT) === x0, 'a: Cmd+Z counts as Ctrl+Z (second undo is a no-op)');

  // (b) six changes: only the last 5 can be undone.
  setup(); await wait(100);
  var base = px(RAT), n;
  for (n = 0; n < 6; n++) await nudge();
  check(px(RAT) === base + 6 * g, 'b: six moves moved the token six squares');
  for (n = 0; n < 5; n++) undoKey();
  check(px(RAT) === base + g, 'b: five undos leave the first change in place');
  undoKey();
  check(px(RAT) === base + g && /Nothing to undo/.test(toastText()), 'b: the sixth undo does nothing and says so');
  for (n = 0; n < 5; n++) redoKey();
  check(px(RAT) === base + 6 * g, 'b: five redos bring it all back');
  redoKey();
  check(/Nothing to redo/.test(toastText()), 'b: ...and a sixth says nothing to redo');

  // (c) a ping is not a step.
  setup(); await wait(100);
  base = px(RAT); await nudge();
  var sc = scene(); sc.pings = (sc.pings || []).concat([{ id: ++sc.pingId, x: 1, y: 1, by: 'Ref' }]); A.vttChanged();
  check(U.hist.undo.length === 1, 'c: a ping adds no undo step');
  undoKey();
  check(px(RAT) === base && scene().pings.length === 1, 'c: undo reverts the move, not the ping, and keeps the live ping');
  fire('contextmenu', P(5, 5), { button: 2 }); menuBtn('Ping here').click();
  check(U.hist.undo.length === 0 && U.hist.redo.length === 1, 'c: pinging from the menu leaves the stacks alone (' + U.hist.undo.length + '/' + U.hist.redo.length + ', pings ' + scene().pings.length + ')');

  // (d) a new change after undo clears redo.
  setup(); await wait(100);
  base = px(RAT); await nudge(); await nudge();
  undoKey();
  check(U.hist.redo.length === 1, 'd: after an undo there is something to redo');
  tk(RAT).name = 'Mouse'; A.vttChanged();
  check(U.hist.redo.length === 0, 'd: a new change clears redo');
  redoKey();
  check(/Nothing to redo/.test(toastText()) && tk(RAT).name === 'Mouse', 'd: Ctrl+Y then has nothing to redo');

  // (e) the right-click board menu.
  setup(); await wait(100);
  base = px(RAT);
  fire('contextmenu', P(5, 5), { button: 2 });
  var u = menuBtn('Undo'), r = menuBtn('Redo');
  check(u.disabled || u.classList.contains('off') || u.getAttribute('aria-disabled') === 'true', 'e: with nothing done, Undo is greyed out');
  check(r.disabled || r.classList.contains('off') || r.getAttribute('aria-disabled') === 'true', 'e: ...and Redo too');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); U.view.menu && qa('.tbl-menu').forEach(function (m) { m.remove(); });
  await nudge();
  fire('contextmenu', P(5, 5), { button: 2 });
  u = menuBtn('Undo'); r = menuBtn('Redo');
  check(!(u.disabled || u.classList.contains('off')) && (r.disabled || r.classList.contains('off')), 'e: after a move Undo is live and Redo is greyed out');
  u.click();
  check(px(RAT) === base, 'e: clicking Undo in the menu undoes the move');
  fire('contextmenu', P(5, 5), { button: 2 });
  r = menuBtn('Redo');
  check(!(r.disabled || r.classList.contains('off')), 'e: Redo is live afterwards');
  r.click();
  check(px(RAT) === base + g, 'e: clicking Redo re-applies it');
  fire('contextmenu', [tk(RAT).x, tk(RAT).y], { button: 2 });
  check(/Undo/.test(text(q('.tbl-menu'))) && /Redo/.test(text(q('.tbl-menu'))), 'e: the token menu has Undo and Redo');
  menuBtn('Undo').click();
  check(px(RAT) === base, 'e: Undo from the token menu works');
  fire('contextmenu', [(wall('wA').a[0] + wall('wA').b[0]) / 2, wall('wA').a[1]], { button: 2 });
  check(/Undo/.test(text(q('.tbl-menu'))) && /Redo/.test(text(q('.tbl-menu'))), 'e: the wall menu has Undo and Redo');
  menuBtn('Redo').click();
  check(px(RAT) === base + g, 'e: Redo from the wall menu works');

  // (f) typing in a field is left alone.
  setup(); await wait(100);
  base = px(RAT); await nudge();
  var inp = document.createElement('input'); inp.type = 'text'; document.body.appendChild(inp); inp.focus();
  e = key('z', { ctrlKey: true }, inp);
  check(px(RAT) === base + g && !e.defaultPrevented, 'f: Ctrl+Z in a text input does not undo (and is left to the field)');
  var ta = document.createElement('textarea'); document.body.appendChild(ta);
  key('z', { ctrlKey: true }, ta);
  check(px(RAT) === base + g, 'f: nor in a textarea');
  inp.remove(); ta.remove();
  undoKey();
  check(px(RAT) === base, 'f: back on the board, Ctrl+Z works');

  // (g) a wall deleted with Delete comes back.
  setup(); await wait(100);
  var m = [(wall('wC').a[0] + wall('wC').b[0]) / 2, wall('wC').a[1]], wb = JSON.stringify(wall('wC'));
  fire('pointerdown', m); fire('pointerup', m);
  cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  check(!wall('wC') && scene().walls.length === 1, 'g: Delete removes the wall');
  undoKey();
  check(!!wall('wC') && JSON.stringify(wall('wC')) === wb && scene().walls.length === 2, 'g: Ctrl+Z brings it back, unchanged');
  redoKey();
  check(!wall('wC'), 'g: Ctrl+Y deletes it again');
  done({ ok: true, steps: steps });
})().catch(function (e) { done({ ok: false, error: String(e && e.message || e) + ' | ' + String(e && e.stack || ''), steps: steps }); });
