/*
 * Wall editing on the Ref's Tabletop (ref/test/run_vtt_walls_test.py): with the Select tool, dragging a wall moves the whole segment
 * (snapped to half squares), dragging an end handle moves every wall end on that joint (Alt detaches), Escape cancels a drag, Delete
 * removes the selected wall, right-click opens the wall menu (Make it, Split here, Delete), and a movable token over a wall wins.
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
function walls() { return scene().walls; }
function wall(id) { return walls().filter(function (w) { return w.id === id; })[0]; }
window.confirm = function () { return true; };

(async function () {
  var A = window.CrowsRefApp, U = A.ui.vtt;
  function tab(name) { var b = qa('#tabbar [role=tab]').filter(function (x) { return text(x).indexOf(name) === 0; })[0]; if (!b) throw new Error('no tab ' + name); b.click(); }
  tab('Tabletop');
  var eb = qa('button', q('.vtt-empty')).filter(function (b) { return text(b).indexOf('Battle map') === 0; })[0];
  eb.click();
  await wait(300);
  var cv = U.view.canvas, g = scene().g, ox = scene().ox || 0, oy = scene().oy || 0;
  U.view.tool('select');
  // Grid point (i, j) squares from a grid corner near the middle of the view.
  var c0 = U.view.center(), gx0 = Math.round((c0.x - ox) / g), gy0 = Math.round((c0.y - oy) / g);
  function P(i, j) { return [ox + (gx0 + i) * g, oy + (gy0 + j) * g]; }
  function scr(p) {   // world point -> client coords through the view's camera
    var z = U.view.zoomLevel(), c = U.view.center(), r = cv.getBoundingClientRect();
    return { x: r.left + (p[0] - c.x) * z + r.width / 2, y: r.top + (p[1] - c.y) * z + r.height / 2 };
  }
  function mid(w) { return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]; }
  function ev(type, p, o) {
    var s = scr(p), e = Object.assign({ clientX: s.x, clientY: s.y, pointerId: 7, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }, o || {});
    return type === 'contextmenu' ? new MouseEvent(type, e) : new PointerEvent(type, e);
  }
  function fire(type, p, o) { cv.dispatchEvent(ev(type, p, o)); }
  function key(k) { cv.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
  /* Press at p0, move to p1 in steps, optionally release. */
  function dragTo(p0, p1, o, release) {
    fire('pointerdown', p0, o);
    for (var i = 1; i <= 4; i++) fire('pointermove', [p0[0] + (p1[0] - p0[0]) * i / 4, p0[1] + (p1[1] - p0[1]) * i / 4], o);
    if (release !== false) fire('pointerup', p1, o);
  }
  function setup() {
    scene().walls = [
      { id: 'wA', a: P(0, 0), b: P(2, 0), t: 'wall', open: false },
      { id: 'wB', a: P(2, 0), b: P(2, 2), t: 'wall', open: false },
      { id: 'wC', a: P(-4, 3), b: P(-2, 3), t: 'wall', open: false },
      { id: 'wD', a: P(0, -3), b: P(2, -3), t: 'door', open: false }
    ];
    scene().tokens = []; A.save(); A.render(); U.view.selectWall(null);
  }
  function same(a, b) { return Math.abs(a[0] - b[0]) < .01 && Math.abs(a[1] - b[1]) < .01; }
  function snap(w) { return JSON.stringify([w.a, w.b]); }
  var z0 = U.view.zoomLevel();
  check(z0 > 0 && cv.getBoundingClientRect().width > 100, 'the battle map canvas is up (zoom ' + z0.toFixed(2) + ')');

  // 1. Drag a whole wall by one square.
  setup(); await wait(100);
  var C0 = snap(wall('wC')), B0 = snap(wall('wB')), D0 = snap(wall('wD'));
  dragTo(mid(wall('wA')), [mid(wall('wA'))[0] + g, mid(wall('wA'))[1] + g]);
  check(same(wall('wA').a, P(1, 1)) && same(wall('wA').b, P(3, 1)), '1: dragging a wall by a square moves both its ends by a square (length kept)');
  check(snap(wall('wC')) === C0 && snap(wall('wB')) === B0 && snap(wall('wD')) === D0, '1: the other walls do not move (even the one that shared an end)');

  // 2. Drag a shared end.
  setup(); await wait(100);
  var m = mid(wall('wA')); dragTo(m, m);   // click to select A
  var a2 = wall('wA').b.slice();
  dragTo(a2, [a2[0] + g, a2[1] - g]);
  check(same(wall('wA').b, P(3, -1)) && same(wall('wB').a, P(3, -1)), '2: dragging the selected wall’s end moves the joint on both walls');
  check(same(wall('wA').a, P(0, 0)) && same(wall('wB').b, P(2, 2)), '2: the far ends stay put');

  // 3. Alt detaches.
  setup(); await wait(100);
  m = mid(wall('wA')); dragTo(m, m);
  var a3 = wall('wA').b.slice();
  dragTo(a3, [a3[0] + g, a3[1] - g], { altKey: true });
  check(same(wall('wA').b, P(3, -1)) && same(wall('wB').a, P(2, 0)), '3: with Alt only the selected wall’s end moves');

  // 4. Escape restores.
  setup(); await wait(100);
  var before = snap(wall('wA'));
  m = mid(wall('wA'));
  dragTo(m, [m[0] + g, m[1] + g], null, false);
  check(snap(wall('wA')) !== before, '4: mid-drag, the wall has moved');
  key('Escape');
  check(snap(wall('wA')) === before, '4: Escape puts the wall back');
  fire('pointerup', [m[0] + g, m[1] + g]);
  check(snap(wall('wA')) === before && walls().length === 4, '4: releasing afterwards changes nothing');

  // 5. Delete removes the selected wall.
  setup(); await wait(100);
  m = mid(wall('wC')); dragTo(m, m);
  key('Delete');
  check(!wall('wC') && walls().length === 3, '5: Delete removes the selected wall');
  setup(); await wait(100);
  m = mid(wall('wC')); dragTo(m, m);
  key('Backspace');
  check(!wall('wC') && walls().length === 3, '5: Backspace does too');

  // 6. Right-click menu.
  setup(); await wait(100);
  var dm = mid(wall('wD'));
  fire('contextmenu', dm, { button: 2 });
  var menu = q('.tbl-menu');
  check(!!menu && /Door/.test(text(q('.tm-head', menu))), '6: right-clicking a door opens a menu headed Door');
  var mt = text(menu);
  check(/Open it/.test(mt) && /Make it/.test(mt) && /Split here/.test(mt) && /Delete/.test(mt), '6: the menu has Open it, Make it, Split here, and Delete');
  function mbtn(label) { var b = qa('.tbl-menu button').filter(function (x) { return text(x).replace(/^✓\s*/, '').indexOf(label) === 0; })[0]; if (!b) throw new Error('no menu item ' + label); return b; }
  mbtn('Open it').click();
  check(wall('wD').open === true, '6: Open it opens the door');
  fire('contextmenu', dm, { button: 2 });
  mbtn('Make it').click();
  mbtn('Window').click();
  check(wall('wD').t === 'window' && !wall('wD').open, '6: Make it > Window turns it into a window (and shuts it)');
  fire('contextmenu', dm, { button: 2 });
  mbtn('Split here').click();
  var halves = walls().filter(function (w) { return w.a[1] === P(0, -3)[1] && w.b[1] === P(0, -3)[1] && w.a[0] >= P(0, 0)[0] - .01 && w.b[0] <= P(2, 0)[0] + .01 && (w.id === 'wD' || w.t === 'window'); });
  check(walls().length === 5 && halves.length === 2 && same(wall('wD').b, P(1, -3)) && halves.some(function (w) { return same(w.a, P(1, -3)) && same(w.b, P(2, -3)) && w.t === 'window'; }), '6: Split here at the midpoint cuts it in two windows');
  fire('contextmenu', mid(wall('wC')), { button: 2 });
  mbtn('Delete').click();
  check(!wall('wC') && walls().length === 4, '6: the menu’s Delete removes the wall');

  // 7. Clicking away clears the selection; a token over a wall wins.
  setup(); await wait(100);
  m = mid(wall('wC')); dragTo(m, m);
  var empty = P(6, -6);
  fire('pointerdown', empty); fire('pointerup', empty);
  key('Delete');
  check(!!wall('wC') && walls().length === 4, '7: pointerdown on an empty spot clears the wall selection (Delete then removes nothing)');
  setup(); await wait(100);
  var mc = mid(wall('wC')), cb = snap(wall('wC'));
  scene().tokens = [{ id: 'tkW', name: 'Rat', kind: 'obj', x: mc[0], y: mc[1], size: 1, hidden: false, speed: 5 }];
  A.save(); A.render(); await wait(100);
  dragTo(mc, [mc[0], mc[1] + g * 2]);
  await wait(100);
  var tk = scene().tokens.filter(function (t) { return t.id === 'tkW'; })[0];
  check(tk && Math.abs(tk.y - mc[1]) > g, '7: a movable token over a wall is dragged (moved ' + (tk ? Math.round(tk.y - mc[1]) : '?') + ' px down)');
  check(snap(wall('wC')) === cb, '7: ...and the wall under it stays put');
  done({ ok: true, steps: steps });
})().catch(function (e) { done({ ok: false, error: String(e && e.stack || e), steps: steps }); });
