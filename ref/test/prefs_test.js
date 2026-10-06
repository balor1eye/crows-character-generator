/*
 * Campaign Preferences, run inside the Ref Screen by ref/test/run_prefs_test.py: everything is on by default, turning a
 * function off hides its tab or card (and back on shows it again), and Tabletop Mode rolls creatures' attacks for the table
 * without dealing anything to a crow or publishing the fight.
 * Called as a WebDriver async script; reports { ok, steps, error }.
 */
var done = arguments[arguments.length - 1];
var steps = [];
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function tabs() { return qa('#tabbar [role=tab]').map(function (b) { return text(b).replace(/[^A-Za-z]/g, '').replace(/XP$|^$/, ''); }); }
function tab(name) { var b = qa('#tabbar [role=tab]').filter(function (x) { return text(x).indexOf(name) === 0; })[0]; if (!b) throw new Error('no tab ' + name); b.click(); }
function box(key) { return q('[data-feature=' + key + ']'); }
function st() { return window.CrowsRef.state; }
try {
  tab('Preferences');
  check(qa('[data-feature]').length > 15 && qa('[data-feature]').every(function (b) { return b.checked; }), 'every function is on by default');
  check(q('#pref-tabletop') && !q('#pref-tabletop').checked && !st().prefs.tabletop, 'Tabletop Mode is off by default');
  check(q('#sec-table').hidden, 'the At the table card is hidden');
  box('travel').click(); box('dice').click(); box('rest').click();
  check(tabs().indexOf('Travel') < 0 && tabs().indexOf('Encounters') >= 0, 'Travel left the tab bar, Encounters stayed');
  check(q('#side-dice').hidden && !q('#side-log').hidden, 'the sidebar dice are hidden, the log is not');
  tab('Session');
  check(q('#sec-rest').hidden && !q('#sec-dt').hidden, 'the Rest card is hidden on the Session tab, Dungeon turns are not');
  tab('Preferences'); box('rest').click(); box('dice').click(); box('travel').click();
  tab('Session');
  check(!q('#sec-rest').hidden && !q('#side-dice').hidden && tabs().indexOf('Travel') >= 0, 'turning them back on shows them again');
  // a hidden tab that is open falls back to Session
  tab('Rules'); tab('Preferences'); box('rules').click();
  check(tabs().indexOf('Rules') < 0, 'the Rules tab is gone');
  box('rules').click();
  // Tabletop Mode
  q('#pref-tabletop').click();
  check(st().prefs.tabletop, 'Tabletop Mode is on');
  tab('Session');
  check(!q('#sec-table').hidden, 'the At the table card shows');
  var CR = window.CrowsRefApp;
  CR.addCombatant('Bear', 1, 'foe'); CR.save(); CR.render();
  var pc = { id: 'p1', name: 'Ash', status: 'active', st: 9, stMax: 9, wounds: 0, ad: 0, conds: {}, link: 'abc' };
  st().party.push(pc); CR.addParty(); CR.save(); CR.render();
  var list = st().session.combat.list, bear = list.filter(function (x) { return x.cref === 'Bear'; })[0], ash = list.filter(function (x) { return x.kind === 'pc'; })[0];
  check(bear && ash, 'a Bear and a crow are in the tracker');
  bear.tgt = ash.id; CR.save(); CR.render();
  tab('Encounters');
  var row = qa('#sec-combat .cbt').filter(function (r) { return q('.cbt-name input', r).value === bear.name; })[0];
  check(q('.cbt-ref', row) && /Bite/.test(text(q('.cbt-ref', row))), 'the Bear lists its attacks');
  qa('.atk-btn', row)[0].click();
  var act = (st().session.combat.acts || []).slice(-1)[0];
  if (act && act.items && act.items.length) { check(ash.st === 9 && !act.applied, 'the hit waits: nothing was dealt to the crow'); CR.applyAct(act); check(ash.st < 9, 'Apply deals it'); }
  else check(ash.st === 9, 'a miss dealt nothing to the crow');
  check(q('#sec-combat .tt-roll'), 'the roll is shown for the table');
  check(!q('#sec-combat .live-box'), 'no live fight panel');
  check(JSON.stringify(CR.publicCombat()) === '{"active":false}', 'nothing is published to the players');
  var before = bear.st; CR.damage(bear, 5, false); check(bear.st < before, 'the Ref still hurts the Bear');
  tab('Preferences'); q('#pref-tabletop').click();
  tab('Session');
  check(q('#sec-table').hidden && tabs().indexOf('Preferences') >= 0, 'turning Tabletop Mode off hides the card');
  // preferences are part of the campaign and survive a reload of it
  box('maps').click();
  var copy = JSON.parse(localStorage.getItem(CR.STORAGE_KEY));
  check(copy.prefs && copy.prefs.off.maps === true, 'preferences are saved with the campaign');
  box('maps').click();
  done({ ok: true, steps: steps });
} catch (e) { done({ ok: false, steps: steps, error: String(e && e.stack || e) }); }
