/*
 * A fight run on the Tabletop's battle map from start to end, inside the Ref Screen (ref/test/run_vtt_combat_test.py): the players'
 * default combat view, surprise and initiative on the map, a creature's Act drawer (its tracker row), picking its target by clicking a
 * token, an attack whose hit waits in the approval pop-up, Apply and Undo, the last roll and the feed on the map, Acted and the
 * round's count, the Fight drawer, the next round, and End.
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
function st() { return window.CrowsRef.state; }
function cb() { return st().session.combat; }
function who(name) { return cb().list.filter(function (x) { return x.name === name; })[0]; }
function scene() { return st().vtt.scenes[0]; }
function tokNamed(name) { return scene().tokens.filter(function (t) { return t.name === name; })[0]; }
function drawer() { return q('#sec-vtt .vtt-drawer'); }
function select(name) { var t = tokNamed(name); qa('.vtt-roster .vtt-av').filter(function (a) { return a.getAttribute('aria-label') === name; })[0].click(); return t; }
/* A click on a token on the canvas (pointer down and up where it is drawn). */
function clickToken(name) {
  var U = window.CrowsRefApp.ui.vtt, t = tokNamed(name), p = U.view.screenOf(t.id), cv = U.view.canvas, r = cv.getBoundingClientRect();
  var o = { clientX: r.left + p.x, clientY: r.top + p.y, pointerId: 7, bubbles: true, button: 0 };
  cv.dispatchEvent(new PointerEvent('pointerdown', o)); cv.dispatchEvent(new PointerEvent('pointerup', o));
}
window.confirm = function () { return true; };

(async function () {
  var A = window.CrowsRefApp;
  // Two active crows (the party tab's import is covered by the combat encounter test).
  ['Ash', 'Briar'].forEach(function (n) { st().party.push({ id: A.nid(), name: n, st: 9, stMax: 9, ad: 0, wounds: 0, conds: {}, status: 'active', xp: 0 }); });
  A.save();

  // The players' default view of a fight.
  tab('Preferences');
  check(st().prefs.playerView === 'map' && /Battle map/.test(text(q('.pref-view .seg button.on'))), 'players see fights on the battle map by default');
  click('Text lists', q('.pref-view'));
  check(st().prefs.playerView === 'text' && A.playerView() === 'text', 'the Ref can make text lists the players’ default');
  click('Battle map', q('.pref-view'));
  check(st().prefs.playerView === 'map', '...and the battle map again');

  // A battle map with the crows and two creatures.
  tab('Tabletop');
  click('Battle map', q('.vtt-empty'));
  q('.vtt-roster .fab.add').click();
  click('Crows', drawer(), true);
  var cs = q('select[aria-label=Creature]', drawer()); cs.value = 'Blood Creature A'; cs.dispatchEvent(new Event('change'));
  q('input[aria-label="How many"]', drawer()).value = '2';
  click('Add', drawer(), true);
  scene().tokens.forEach(function (t, i) { t.hidden = false; t.x = scene().g * (4 + i * 3) + scene().g / 2; t.y = scene().g * 6.5; });
  A.ui.vtt.drawer = null; A.save(); A.render();
  await wait(300);
  check(cb().list.length === 4 && scene().tokens.length === 4, 'two crows and two creatures are on the map and in the tracker');

  // Surprise and initiative from the top of the map.
  var sur = q('.vtt-tc select[aria-label=Surprise]');
  check(!!sur, 'before the fight starts, the map offers surprise');
  sur.value = 'foes'; sur.dispatchEvent(new Event('change'));
  click('Roll initiative', q('.vtt-tc'));
  check(cb().round === 1 && cb().surprise === 'foes' && A.surprised(who('Blood Creature A 1')), 'Roll initiative starts round 1, with the foes surprised');
  check(/Round 1/.test(text(q('.vtt-tc'))) && /0\/2 foes acted/.test(text(q('.vtt-tc'))) && /0\/2 crows done/.test(text(q('.vtt-tc'))), 'the map shows the round and who has acted');

  // A creature's Act drawer, and its target picked on the map.
  select('Blood Creature A 1');
  q('.vtt-hud [data-tip=Act]').click();
  check(drawer().classList.contains('open') && !!q('.cbt', drawer()) && /Claws/.test(text(drawer())), 'its Act drawer holds its tracker row: attacks, conditions, uses, reactions');
  click('Pick its target on the map', drawer());
  clickToken('Ash');
  await wait(100);
  check(who('Blood Creature A 1').tgt === who('Ash').id, 'clicking Ash’s token makes Ash its target');
  check(/→ Ash/.test(text(q('.vtt-hud .hud-card'))), 'its HUD card says who it attacks');
  check(A.ui.vtt.sel === tokNamed('Blood Creature A 1').id, 'the creature stays selected');

  // Its attack: the hit waits for approval; Apply, then Undo.
  var hit = null;
  for (var i = 0; i < 12 && !hit; i++) {
    click('Claws', drawer());
    await wait(50);
    hit = (cb().acts || []).filter(function (a) { return !a.applied && a.who === 'Blood Creature A 1'; })[0];
  }
  check(!!hit, 'Claws hits Ash (within a few tries)');
  check(/Needs your approval/.test(text(q('.vtt-ask'))) && /Apply/.test(text(q('.vtt-ask'))), 'the hit waits in the approval pop-up');
  check(/Claws → Ash/.test(text(q('.vtt-roll'))) && !/Apply/.test(text(q('.vtt-roll'))), 'the roll floats bottom left (its Apply is in the pop-up)');
  check(/Claws/.test(text(q('.vtt-ticker'))), 'the feed line scrolls by on the map');
  var st0 = who('Ash').st;
  click('Apply', q('.vtt-ask'));
  check(who('Ash').st < st0 || who('Ash').wounds > 0, 'Apply deals it to Ash');
  check(/Applied/.test(text(q('.vtt-ask'))), 'the pop-up says what it did');
  click('Undo', q('.vtt-ask'));
  check(who('Ash').st === st0 && !who('Ash').wounds, 'Undo puts Ash back');

  // Acted, and the round's count.
  q('.vtt-hud [data-tip=Acted]').click();
  check(who('Blood Creature A 1').acted === 1 && /1\/2 foes acted/.test(text(q('.vtt-tc'))), 'Acted counts on the map');

  // The Fight drawer.
  click('Fight', q('.vtt-tc'));
  check(/The fight/i.test(text(q('.dr-head', drawer()))) && qa('.dr-turn', drawer()).length === 4, 'the Fight drawer lists everyone in the fight');
  check(!!q('.sit-row', drawer()) && !!q('.items-box', drawer()) && !!q('.dr-end', drawer()), 'it has the battlefield buttons, the items on the ground, and the end');
  qa('.dr-turn', drawer()).filter(function (b) { return /Blood Creature A 2/.test(text(b)); })[0].click();
  check(A.ui.vtt.sel === tokNamed('Blood Creature A 2').id && /Blood Creature A 2/.test(text(q('.dr-head', drawer()))), 'a name in it selects that creature and opens its Act drawer');

  // The next round, and the end.
  click('Next round', q('.vtt-tc'));
  check(cb().round === 2 && !A.surprised(who('Blood Creature A 1')), 'Next round: round 2, no one surprised');
  click('End', q('.vtt-tc'), true);
  check(!cb().list.length && !cb().round, 'End clears the tracker');
  check(st().log.some(function (e) { return /Combat ends/.test(e.s); }), 'the log notes the end of the fight');
  check(scene().tokens.filter(function (t) { return t.kind === 'pc'; }).length === 2, 'the crows stay on the map');
  done({ ok: true, steps: steps });
})().catch(function (e) { done({ ok: false, error: String(e && e.stack || e), steps: steps }); });
