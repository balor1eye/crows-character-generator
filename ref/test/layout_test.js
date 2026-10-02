/*
 * Rearranging a page (src/layout.js), run inside the Character Generator or the Ref Screen by run_layout_test.py.
 * arguments[0] is the step: 'gen', 'gen-after-reload', 'ref', 'ref-after-reload'.
 *
 * It drags blocks with pointer events the way a mouse would, and checks the page while the drag is under way
 * (a placeholder in the target column, the other blocks animating, the dragged block taking the column's width)
 * and after it (the block in its new column, the arrangement saved), the column presets, Reset, keyboard moves,
 * locking, and that each page (Build and Play; each Ref Screen tab) keeps its own arrangement.
 */
var done = arguments[arguments.length - 1], step = arguments[0];
var steps = [], errs = [], maxAnim = 0, y0 = 0;
window.addEventListener('error', function (e) { errs.push(e.message); });
function check(cond, what) { if (!cond) throw new Error(what + (errs.length ? ' [page errors: ' + errs.join('; ') + ']' : '')); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function cols() { return qa('main.layout > .lay-col'); }
function colOf(id) { var b = document.getElementById(id); return cols().indexOf(b && b.parentNode); }
function order(i) { return qa('.lay-block', cols()[i]).map(function (b) { return b.id; }); }
function saved() { try { return JSON.parse(localStorage.getItem('crows-layouts')).layouts; } catch (e) { return null; } }
function button(label, root) {
  var b = qa('button', root).filter(function (x) { return text(x).indexOf(label) >= 0; })[0];
  if (!b) throw new Error('no button "' + label + '"');
  return b;
}
function pe(type, x, y, target) {
  (target || document.elementFromPoint(x, y) || document.body).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true }));
}
/* Drag a block (grabbed near its top) to a point, in steps; `during` runs while it's held over the target. */
async function dragTo(id, x, y, during) {
  var b = document.getElementById(id);
  b.scrollIntoView({ block: 'nearest' });
  await wait(50);
  if (typeof x === 'function') { var at = x(); x = at[0]; y = at[1]; }
  y0 = y;   // where to go, worked out after scrolling
  var r = b.getBoundingClientRect(), sx = r.left + 30, sy = r.top + 12;
  pe('pointerdown', sx, sy, b);
  for (var i = 1; i <= 12; i++) {
    pe('pointermove', sx + (x - sx) * i / 12, sy + (y - sy) * i / 12, window);
    maxAnim = Math.max(maxAnim, document.getAnimations ? document.getAnimations().length : 1);   // blocks sliding out of the way
    await wait(25);
  }
  await wait(300);   // the block's width eases to the column's
  if (during) await during();
  pe('pointerup', x, y, window);
  await wait(320);
}

async function gen() {
  var nav = q('.masthead .actions'), lay = button('Layout', nav);
  check(cols().length === 2 && colOf('sec-notes') === 0 && colOf('summary') === 1, 'Build starts as before: the steps, then the Crow sidebar');
  lay.click();
  check(document.body.classList.contains('lay-edit') && q('.lay-bar') && /Lock page/.test(text(lay)), 'the Layout button unlocks the page and shows the rearranging bar');
  check(document.getElementById('sec-background').getAttribute('data-lay-title') === '1 Background', 'blocks show their names while unlocked');
  // Drag the Notes step to the sidebar column, above the Crow summary.
  var seen = {};
  await dragTo('sec-notes', function () { var side = cols()[1].getBoundingClientRect(), sum = document.getElementById('summary').getBoundingClientRect(); return [side.left + side.width / 2, Math.max(sum.top + 10, 120)]; }, null, async function () {
    var b = document.getElementById('sec-notes'), ph = q('.lay-ph');
    seen.ph = ph && cols().indexOf(ph.parentNode);
    seen.width = Math.abs(b.offsetWidth - ph.offsetWidth) < 3 && ph.offsetWidth < cols()[0].offsetWidth; seen.w = [b.offsetWidth, ph.offsetWidth, cols()[0].offsetWidth, b.style.width];
    seen.fixed = getComputedStyle(b).position === 'fixed';
    seen.anim = maxAnim;
  });
  check(seen.ph === 1, 'while dragging, a placeholder shows where it will go, in the sidebar column' + (seen.ph === 1 ? '' : ' ' + JSON.stringify(seen)));
  check(seen.fixed && seen.width, 'the dragged block follows the pointer and takes the width of the column it’s over' + (seen.width ? '' : ' ' + JSON.stringify(seen)));
  check(seen.anim > 0, 'the other blocks animate to their new places');
  check(colOf('sec-notes') === 1, 'dropped: Notes is in the sidebar column');
  var notes = document.getElementById('sec-notes'); notes.focus();
  notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await wait(50);
  check(order(1)[0] === 'sec-notes' && order(1)[1] === 'summary', 'the up arrow moves it above the Crow summary');
  check(!q('.lay-ph') && !q('.lay-dragging'), 'no placeholder left behind');
  // Keyboard: move Background to the other column.
  var bg = document.getElementById('sec-background'); bg.focus();
  bg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await wait(50);
  check(colOf('sec-background') === 1, 'the arrow keys move a focused block to the next column');
  bg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await wait(50);
  check(colOf('sec-background') === 0, '...and back');
  // A wide block in the narrow column is scaled to fit.
  var w = document.getElementById('sec-equipment');
  w.focus(); w.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await wait(50);
  button('Lock page', q('.lay-bar')).click();
  await wait(100);
  check(colOf('sec-equipment') === 1 && (w.scrollWidth <= w.clientWidth + 2 || parseFloat(w.style.zoom) < 1), 'the equipment block in the narrow column fits (scaled down if it has to be)');
  check(!document.body.classList.contains('lay-edit') && !q('.lay-bar') && /Layout/.test(text(lay)), 'locking hides the bar and the block names');
  var s = saved();
  check(s && s['gen-build'] && s['gen-build'].cols[1].indexOf('sec-notes') >= 0 && s['gen-build'].cols[1].indexOf('sec-equipment') >= 0, 'the arrangement is saved (in this browser, offline)');
  // Play has its own arrangement.
  document.getElementById('tab-play').click();
  await wait(100);
  check(colOf('play-vitals') === 0 && colOf('summary') === 1 && document.getElementById('summary').parentNode.classList.contains('play-main'), 'Play is its own page, with its usual arrangement');
  lay.click();
  await dragTo('summary', function () { var main = cols()[0].getBoundingClientRect(); return [main.left + main.width / 2, Math.max(document.getElementById('play-vitals').getBoundingClientRect().top + 8, 100)]; });
  button('Lock page', q('.lay-bar')).click();
  check(colOf('summary') === 0 && order(0).indexOf('summary') < order(0).indexOf('play-vitals'), 'on Play the Crow sidebar can go into the main column, above Vitals' + (colOf('summary') === 0 ? '' : ' ' + JSON.stringify(order(0))));
  // Column presets (on Play).
  lay.click();
  button('Three', q('.lay-bar')).click();
  await wait(50);
  check(cols().length === 3 && colOf('summary') === 0, 'three columns keep the blocks where they were');
  button('One', q('.lay-bar')).click();
  await wait(50);
  check(cols().length === 1 && document.getElementById('summary').parentNode === cols()[0], 'one column puts every block in it');
  button('Wide + narrow', q('.lay-bar')).click();
  await wait(50);
  check(cols().length === 2, 'back to two columns');
  button('Lock page', q('.lay-bar')).click();
  document.getElementById('tab-build').click();
  await wait(100);
  check(colOf('sec-notes') === 1 && colOf('summary') === 1, 'Build still has its own arrangement');
}
async function genAfter() {
  check(colOf('sec-notes') === 1 && colOf('sec-equipment') === 1, 'after a reload, Build is still arranged the same way');
  var lay = button('Layout', q('.masthead .actions'));
  lay.click();
  button('Reset', q('.lay-bar')).click();
  await wait(50);
  button('Lock page', q('.lay-bar')).click();
  check(colOf('sec-notes') === 0 && colOf('summary') === 1 && !(saved() || {})['gen-build'], 'Reset puts the page back the way it came');
}
async function ref() {
  var lay = button('Layout', q('.masthead .actions'));
  check(colOf('sec-dt') === 0 && colOf('side') === 1, 'the Session tab starts as before: its cards, then the sidebar');
  lay.click();
  var dbg = {};
  dbg.pre = [window.scrollY, Math.round(document.getElementById('side').getBoundingClientRect().top), cols().length, window.innerWidth, window.innerHeight];
  await dragTo('side', function () { dbg.mid = [window.scrollY, Math.round(document.getElementById('side').getBoundingClientRect().top)]; var main = cols()[0].getBoundingClientRect(); return [main.left + main.width / 2, Math.max(document.getElementById('sec-dt').getBoundingClientRect().top + 8, 100)]; }, null, async function () {
    dbg.y = y0; dbg.kids = Array.prototype.map.call(cols()[0].children, function (k) { return (k.id || k.className) + '@' + Math.round(k.getBoundingClientRect().top) + '+' + Math.round(k.getBoundingClientRect().height); });
    dbg.scroll = window.scrollY;
  });
  check(colOf('side') === 0 && order(0)[0] === 'side', 'the sidebar (timer, dice, log) moves to the top of the main column' + (order(0)[0] === 'side' ? '' : ' ' + JSON.stringify([colOf('side'), order(0), errs, dbg])));
  var rest = document.getElementById('sec-rest');
  await dragTo('sec-rest', function () { var c2 = cols()[1].getBoundingClientRect(); return [c2.left + c2.width / 2, c2.top + 20]; });
  check(colOf('sec-rest') === 1, 'the Rest card moves into the (now empty) narrow column');
  button('Lock page', q('.lay-bar')).click();
  button('Party', q('#tabbar')).click();
  await wait(100);
  check(colOf('sec-status') === 0 && colOf('side') === 1, 'the Party tab keeps its own arrangement');
  button('Session', q('#tabbar')).click();
  await wait(100);
  check(colOf('side') === 0 && colOf('sec-rest') === 1, 'back on Session, it’s arranged as it was left');
  void rest;
}
async function refAfter() {
  check(colOf('side') === 0 && colOf('sec-rest') === 1, 'after a reload, the Session tab is arranged the same way');
}

({ gen: gen, 'gen-after-reload': genAfter, ref: ref, 'ref-after-reload': refAfter })[step]().then(function () { done({ ok: true, steps: steps }); },
  function (e) { done({ ok: false, error: e.message, steps: steps }); });
