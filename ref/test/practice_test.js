/*
 * A practice fight on the Tabletop (ref/src/ref-practice.js), inside the Ref Screen (ref/test/run_practice_test.py): the sidebar's Practice
 * block appears on the Tabletop once foes are on the map, its settings (how many crows, the mix, each crow's background), Start (the practice
 * crows take the real crows' places, round 1 starts, nothing is published), a fight the computer plays through to the end, Restart,
 * Simulate, a step-by-step fight where the Ref runs the foes, and End (the fight, the map, and the log back as they were).
 * Called as a WebDriver async script; reports { ok, steps, error }.
 */
var done = arguments[arguments.length - 1];
var steps = [];
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function button(label, root, exact) {
  var b = qa('button', root).filter(function (x) { var t = text(x); return exact ? t === label : t.indexOf(label) === 0; })[0];
  if (!b) throw new Error('no button "' + label + '"');
  return b;
}
function click(label, root, exact) { button(label, root, exact).click(); }
function tab(name) { var b = qa('#tabbar [role=tab]').filter(function (x) { return text(x).indexOf(name) === 0; })[0]; if (!b) throw new Error('no tab ' + name); b.click(); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn, ms, what) { var t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await wait(100); } }
function st() { return window.CrowsRef.state; }
function cb() { return st().session.combat; }
function scene() { return st().vtt.scenes[0]; }
function drawer() { return q('#sec-vtt .vtt-drawer'); }
function block() { return q('#side-practice'); }
function shown(n) { return !!n && getComputedStyle(n).display !== 'none'; }
function setSel(label, value) { var s = q('select[aria-label="' + label + '"]', block()); if (!s) throw new Error('no select ' + label); s.value = value; s.dispatchEvent(new Event('change')); }
function bots() { return cb().list.filter(function (x) { return x.bot; }); }
window.confirm = function () { return true; };

(async function () {
  var A = window.CrowsRefApp;
  ['Ash', 'Briar'].forEach(function (n) { st().party.push({ id: A.nid(), name: n, bg: 'Thief', st: 9, stMax: 9, ad: 0, wounds: 0, conds: {}, status: 'active', xp: 0 }); });
  A.save();

  // A battle map with the two crows and three creatures.
  tab('Tabletop');
  check(!shown(block()), 'the Practice block waits for a scene');
  click('Battle map', q('.vtt-empty'));
  check(shown(block()) && /Load an encounter/.test(text(block())), 'on an empty battle map the Practice block says to load an encounter');
  q('.vtt-roster .fab.add').click();
  click('Crows', drawer(), true);
  var cs = q('select[aria-label=Creature]', drawer()); cs.value = 'Thief (P3)'; cs.dispatchEvent(new Event('change'));
  q('input[aria-label="How many"]', drawer()).value = '3';
  click('Add', drawer(), true);
  scene().tokens.forEach(function (t, i) { t.hidden = false; t.x = scene().g * (3 + (t.kind === 'pc' ? 0 : 8)) + scene().g / 2; t.y = scene().g * (3 + i * 2) + scene().g / 2; });
  A.ui.vtt.drawer = null; A.save(); A.render();
  await wait(200);
  var before = JSON.stringify(cb()), tokensBefore = JSON.stringify(scene().tokens), logBefore = st().log.length;
  check(cb().list.length === 5 && scene().tokens.length === 5, 'two crows and three thieves are on the map and in the tracker');

  // The settings.
  check(/Start practice/.test(text(block())) && /3 foes/.test(text(block())), 'the Practice block offers a practice against the 3 foes');
  setSel('Number of practice crows', '3');
  check(qa('.prac-crows li', block()).length === 3, 'three crows: one background each');
  setSel('Party mix', 'fighters');
  check(st().practice.opts.crows.join() === 'Bodyguard,Knight,Gladiator', 'the Fighters mix fills in Bodyguard, Knight, Gladiator');
  setSel('Crow 2 background', 'Archer');
  check(st().practice.opts.crows[1] === 'Archer' && /Shortbow/.test(text(qa('.prac-crows li', block())[1])), 'a crow’s background can be changed, and its gear shows');
  setSel('Who runs the foes', 'auto');
  setSel('Pace', 'fast');
  tab('Session');
  check(!shown(block()), 'the block is only on the Tabletop');
  tab('Tabletop');

  // Start.
  click('Start practice', block());
  await wait(50);
  check(!!st().practice.run && cb().round >= 1, 'Start begins round 1');
  check(bots().length === 3 && !cb().list.some(function (x) { return x.kind === 'pc' && !x.bot; }), 'three practice crows take the real crows’ places in the tracker');
  var b0 = bots()[0];
  check(b0.stMax === 9 && b0.adMax === 14 && b0.bot.melee.name === 'Sword', 'the Bodyguard has 9 Stamina, AD 14 (light armor, shield, sword parry), and a sword');
  check(bots()[1].bot.ranged.name === 'Shortbow', 'the Archer has a shortbow');
  check(scene().tokens.filter(function (t) { return t.kind === 'pc'; }).length === 3 && scene().tokens.every(function (t) { return t.kind !== 'pc' || /^bot/.test(t.pcId); }), 'their tokens replace the crows’ on the map');
  check(A.publicCombat && A.publicCombat().active === false, 'the practice isn’t shared with the players');

  // The computer plays it through.
  await until(function () { return st().practice.run.result; }, 90000, 'the practice fight to end');
  var r = st().practice.run.result;
  check(/won|lost|draw/.test(r.outcome) && r.rounds >= 1, 'the fight ends: ' + r.outcome + ' in ' + r.rounds + ' rounds');
  check(/The crows (won|were beaten)|No winner/.test(text(block())) && st().practice.history[0].kind === 'run', 'the block shows the result, and keeps it under Past results');
  check(cb().feed.some(function (x) { return /\*\*(Ash|Briar|Corvin) \(/.test(x.s); }), 'the practice crows acted in the feed');

  // Restart and Simulate.
  click('Restart', block());
  check(!st().practice.run.result && cb().round === 1 && bots().every(function (x) { return x.st === x.stMax && !x.dead; }), 'Restart goes back to the start, round 1');
  q('input[aria-label="How many fights to simulate"]', block()).value = '8';
  q('input[aria-label="How many fights to simulate"]', block()).dispatchEvent(new Event('change'));
  A.ui.prac.playing = false;
  A.simulate(8);
  var sim = st().practice.run.sim;
  check(sim && sim.n === 8 && sim.won + sim.lost <= 8 && /Simulated 8 fights/.test(text(block())), 'Simulate plays it 8 times: the crows won ' + sim.won);
  check(cb().round === 1 && bots().every(function (x) { return x.st === x.stMax; }), '...and leaves the practice at its start');

  // Step by step, with the Ref running the foes.
  setSel('Who runs the foes', 'ref');
  setSel('Pace', 'step');
  cb().first = 'crows'; cb().surprise = 'none'; A.save(); A.render();
  for (var i = 0; i < 6 && A.practiceStep(); i++) { /* the crows' turns */ }
  check(bots().every(function (x) { return x.done === cb().round || x.dead || x.out; }), 'Next step plays each crow’s turn');
  check(!!button('Foes done', block()) && /Your turn/.test(text(block())), 'then it’s the Ref’s turn with the foes');
  var thief = cb().list.filter(function (x) { return x.kind === 'foe' && !x.dead && x.st > 0; })[0];
  thief.tgt = bots()[0].id;
  A.monsterAttack(thief, A.beast(thief.cref).atk[0]);
  check(thief.acted === cb().round, 'a foe’s roll marks it acted');
  click('Foes done', block());
  var r0 = cb().round;
  A.practiceStep();
  check(cb().round === r0 + 1 || st().practice.run.result, 'when everyone has gone, the next round starts');

  // End.
  click('End practice', block());
  check(!st().practice.run, 'End practice stops it');
  check(JSON.stringify(cb()) === before, 'the combat tracker is back as it was');
  check(JSON.stringify(scene().tokens) === tokensBefore, 'the map’s tokens are back');
  check(st().log.length === logBefore, 'the log is back as it was');
  check(st().practice.history.length >= 2, 'past results are kept');
  done({ ok: true, steps: steps });
})().catch(function (e) { done({ ok: false, steps: steps, error: String(e && e.message || e) + '\n' + (e && e.stack || '') }); });
