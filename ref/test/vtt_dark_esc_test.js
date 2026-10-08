/*
 * Darkness and Escape on the Ref's Tabletop (ref/test/run_vtt_dark_esc_test.py): with darkness on (scene.env.dark) the mask shows only what
 * the lights there now reach (explored ground no light reaches goes black, a scene with no fog gets one, a light put out darkens its ground);
 * Escape leaves any tool for Select, and with Select already on it closes the drawer. Called as a WebDriver async script; reports { ok, steps, error }.
 */
var done = arguments[arguments.length - 1];
var steps = [];
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function scene() { return window.CrowsRef.state.vtt.scenes[0]; }

(async function () {
  var A = window.CrowsRefApp, U = A.ui.vtt, Tbl = window.CrowsTable;
  function tab(name) { var b = qa('#tabbar [role=tab]').filter(function (x) { return text(x).indexOf(name) === 0; })[0]; if (!b) throw new Error('no tab ' + name); b.click(); }
  function key(k, target) { var e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); (target || document.body).dispatchEvent(e); return e; }
  tab('Tabletop');
  qa('button', q('.vtt-empty')).filter(function (b) { return text(b).indexOf('Battle map') === 0; })[0].click();
  await wait(300);
  var sc = scene(), g = sc.g;
  function P(i, j) { return [Math.round(sc.w / 2 + i * g), Math.round(sc.h / 2 + j * g)]; }
  function at(m, p) { return Tbl.maskAt(m, p[0], p[1]); }

  // Escape: a tool goes back to Select; then Escape closes the drawer.
  ['wall', 'measure', 'reveal'].forEach(function (t) {
    if (t === 'reveal') { sc.fog = 'manual'; A.vttChanged(); A.render(); }
    U.view.tool(t); A.render();
    key('Escape');
    check(U.view.getTool() === 'select', 'Escape leaves the ' + t + ' tool for Select');
  });
  U.view.tool('wall'); A.render(); key('Escape', U.view.canvas);
  check(U.view.getTool() === 'select', 'Escape on the map itself leaves the wall tool');
  U.drawer = 'scene'; A.render(); key('Escape');
  check(!U.drawer, 'Escape with Select on closes the drawer');

  // Darkness.
  sc.fog = 'off'; sc.ambient = 'bright'; sc.env = {}; sc.walls = []; sc.seen = ''; sc.seenDims = '';
  sc.tokens = [{ id: 'pcA', name: 'Ada', kind: 'pc', x: P(0, 0)[0], y: P(0, 0)[1], size: 1, sight: 1 },
    { id: 'tch', name: 'Torch', kind: 'obj', x: P(10, 0)[0], y: P(10, 0)[1], size: 1, light: { b: 2, d: 2, on: true } }];
  check(Tbl.computeVision(sc) === null, 'no fog and no darkness: no mask');
  sc.env = { dark: true };
  var m = Tbl.computeVision(sc);
  check(m && at(m, P(0, 0)) >= 2, 'darkness, no fog: the crow’s own square is seen');
  check(at(m, P(10, 0)) >= 2, 'darkness: the torch’s ground is lit');
  check(at(m, P(-10, 0)) === 0 && at(m, P(0, 8)) === 0, 'darkness: ground no light reaches is black');
  sc.tokens[1].light.on = false; m = Tbl.computeVision(sc);
  check(at(m, P(10, 0)) === 0, 'darkness: a torch put out leaves its ground black');
  sc.tokens[1].light.on = true;

  sc.fog = 'vision'; sc.env = {}; sc.ambient = 'bright'; m = Tbl.computeVision(sc);
  check(at(m, P(-10, 0)) === 3, 'vision, bright: far ground is seen (and explored)');
  sc.ambient = 'dark'; m = Tbl.computeVision(sc);
  check(at(m, P(-10, 0)) === 1, 'vision, dark ambient, no darkness: explored ground is remembered');
  sc.env = { dark: true }; m = Tbl.computeVision(sc);
  check(at(m, P(-10, 0)) === 0, 'darkness: explored ground with no light is black');
  check(at(m, P(10, 0)) >= 2, 'darkness: the torch still shows its ground');
  sc.ambient = 'bright'; m = Tbl.computeVision(sc);
  check(at(m, P(-10, 0)) === 0, 'darkness beats a bright ambient light');

  sc.fog = 'manual'; Tbl.fillSeen(sc, true); m = Tbl.computeVision(sc);
  check(at(m, P(-10, 0)) === 0 && at(m, P(10, 0)) >= 2, 'darkness, fog by hand: revealed ground shows only where lit');

  // What the players get: the mask, and only the tokens in the light.
  sc.fog = 'off'; sc.tokens.push({ id: 'foeD', name: 'Ghoul', kind: 'foe', x: P(-10, 0)[0], y: P(-10, 0)[1], size: 1 });
  A.vttChanged(); A.render();
  var v = window.CrowsRef.state.vtt; v.shown = true;
  var pub = A.publicTable();
  check(!!pub && !!pub.fog, 'players get a fog mask in darkness with fog off');
  check(!pub.tokens.some(function (t) { return t.id === 'foeD'; }), 'players don’t get a creature standing in the dark');
  v.shown = false;
  done({ ok: true, steps: steps });
})().catch(function (e) { done({ ok: false, steps: steps, error: String(e && e.stack || e) }); });
