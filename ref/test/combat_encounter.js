/*
 * Full combat encounter test for the Ref Screen, run inside the page by ref/test/run_combat_test.py.
 *
 * It drives the real UI the way a Ref would (clicks, typing, file import) and checks what's on screen and what
 * the app saved. It starts from an empty campaign: four crows are imported from character files, an encounter
 * is built by hand in the Encounters tab, and then it's run from start to finish there: surprise, a like/hate
 * check, initiative, monster attacks, damage and wounds on a crow, a condition, a second round, a reinforcement,
 * morale cues, every foe down, treasure XP, and the end-of-encounter summary.
 *
 * Called as a WebDriver async script: the last argument is the callback. It reports
 * { ok: true, steps: [...], campaign: <saved state> } or { ok: false, error, steps }.
 * Dice are seeded (arguments[0]) so a failing run can be repeated.
 */
var done = arguments[arguments.length - 1], seed = arguments[0] || 1;
var steps = [], confirms = [];

/* ---------------------------------------------------------------- helpers */
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function button(label, root, exact) {
  var b = qa('button', root).filter(function (x) { var t = text(x); return exact ? t === label : t.indexOf(label) === 0; })[0];
  if (!b) throw new Error('no button "' + label + '"' + (root && root.id ? ' in #' + root.id : ''));
  return b;
}
function click(label, root, exact) { button(label, root, exact).click(); }
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function goTab(name) { click(name, q('#tabbar')); check(document.body.getAttribute('data-tab') === name.toLowerCase(), 'switched to the ' + name + ' tab'); }
function saved() { return JSON.parse(localStorage.getItem('crows-pt2-ref-campaign')); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn, what, ms) {
  for (var t = 0; t < (ms || 5000); t += 50) { if (fn()) return; await wait(50); }
  throw new Error('timed out waiting for ' + what);
}
function run() { return q('#sec-enc-run'); }
function row(name) {
  var r = qa('.cbt', run()).filter(function (x) { return q('.cbt-name input', x).value === name; })[0];
  if (!r) throw new Error('no combat row "' + name + '"');
  return r;
}
function pool(r, label) {   // a combat row's Stamina, AD, or Wounds number
  var p = qa('.pool', r).filter(function (x) { return text(q('.lbl', x)) === label; })[0];
  return p ? parseInt(text(q('b', p)), 10) : null;
}
function hit(name, amount) { var r = row(name); q('input[placeholder=dmg]', r).value = String(amount); click('Damage', r, true); }
function cues() { return qa('.cue', run()).map(text); }
function dice() { return text(q('#side-dice .result')); }
function logHas(s) { return saved().log.some(function (e) { return e.s.indexOf(s) >= 0; }); }
function pc(name) { return saved().party.filter(function (p) { return p.name === name; })[0]; }
function encState() { return saved().encounters[0]; }

/* Seeded dice (mulberry32), so a run can be repeated exactly. */
Math.random = (function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(seed);
window.confirm = function (m) { confirms.push(m); return true; };

/* Four players' crows, as Character Generator save files: [name, background index, two-point characteristic, Stamina]. */
var CROWS = [['Ash', 11, 'Strength', 9], ['Briar', 7, 'Agility', 7], ['Corvin', 4, 'Mind', 9], ['Dove', 8, 'Agility', 5]];

(async function () {
  /* ---------------------------------------------------------------- 1. an empty campaign */
  goTab('Village');
  var nameIn = qa('#page-village input').filter(function (i) { return i.placeholder === 'optional'; })[0];
  type(nameIn, 'Combat test ' + new Date().toISOString().slice(0, 16));
  check(/^Combat test/.test(saved().name), 'named the campaign');
  check(saved().party.length === 0 && saved().encounters.length === 0 && saved().log.length === 0, 'it starts empty');

  /* ---------------------------------------------------------------- 2. four players' crows */
  goTab('Party');
  var file = q('#sec-party input[type=file]'), dt = new DataTransfer();
  CROWS.forEach(function (c) {
    var save = { v: 1, bg: c[1], twoChar: c[2], pattern: '', name: c[0], player: 'Player ' + c[0][0], txp: 0, play: {} };
    dt.items.add(new File([JSON.stringify(save)], c[0] + '.json', { type: 'application/json' }));
  });
  file.files = dt.files;
  file.dispatchEvent(new Event('change', { bubbles: true }));
  await until(function () { return saved().party.length === 4; }, 'four crows to import');
  CROWS.forEach(function (c) { check(pc(c[0]) && pc(c[0]).stMax === c[3] && pc(c[0]).st === c[3] && pc(c[0]).status === 'active', c[0] + ' imported with ' + c[3] + ' Stamina'); });

  /* ---------------------------------------------------------------- 3. build the encounter by hand */
  goTab('Encounters');
  check(run().hidden, 'no encounter running yet');
  click('Create encounter manually', q('#sec-enc-new'));
  var e = encState();
  check(e && e.src === 'Manual', 'created a manual encounter');
  var card = function () { return q('#enc-' + e.id); };
  check(card() && card().open, 'its card is open for editing');
  type(q('input[aria-label="Encounter name"]', card()), 'Ambush at the ford');
  type(q('input[aria-label="Where"]', card()), 'Ford of Ashes');
  type(q('textarea', card()), 'Undead rise from the reeds while two thieves wait to pick over the bodies.');
  var want = [['Undead A', 2], ['Undead B', 1], ['Thief (P3)', 2]];
  want.forEach(function (w, i) {
    click('Add creature', card());
    var r = qa('.enc-cre .li-row', card())[i];
    type(q('select[aria-label=Creature]', r), w[0]);
    type(q('input[aria-label="How many"]', r), String(w[1]));
  });
  e = encState();
  check(e.name === 'Ambush at the ford' && e.where === 'Ford of Ashes', 'named it and set where');
  check(JSON.stringify(e.creatures.map(function (c) { return [c.n, c.k]; })) === JSON.stringify(want), 'added 2 × Undead A, 1 × Undead B, 2 × Thief (P3)');

  /* ---------------------------------------------------------------- 4. run it */
  click('Run encounter', card());
  check(!run().hidden, 'the Running card appears');
  check(text(q('h2', run())).indexOf('Running: Ambush at the ford') === 0, 'it shows the encounter\'s name');
  check(text(run()).indexOf('Undead rise from the reeds') >= 0 && text(run()).indexOf('Ford of Ashes') >= 0, 'it shows where and what happens');
  var c = saved().session.combat;
  check(c.encId === e.id && c.round === 0, 'the encounter is running, not started');
  check(c.list.filter(function (x) { return x.kind === 'pc'; }).length === 4, 'all four crows joined the fight');
  check(c.list.filter(function (x) { return x.kind === 'foe' && x.enc === e.id; }).length === 5, 'all five foes joined, tagged with the encounter');
  check(qa('.cbt', run()).length === 9, 'the tracker in the Encounters tab shows nine combatants');
  check(text(q('#tabbar')).indexOf('Encounters⚔') >= 0, 'the Encounters tab shows the ⚔ badge');
  check(logHas('Encounter begins: Ambush at the ford'), 'the log says the encounter began');
  check(text(card()).indexOf('Running now') >= 0, 'the saved card points to the fight instead of a second set of editors');

  /* ---------------------------------------------------------------- 5. surprise, like/hate, round 1 */
  click('Crows surprised', run());
  check(saved().session.combat.surprise === 'crows', 'set the crows as surprised');
  click('Like/hate check', run());
  check(/Like\/hate check \(M -2\)/.test(dice()) && /They (approach|investigate|withdraw)/.test(dice()), 'like/hate check used the monsters\' best Mind (-2)');
  click('Start combat + initiative', run());
  check(saved().session.combat.round === 1, 'round 1 started');
  check(logHas('surprised: no turn this round'), 'the round 1 log line explains surprise');
  var tags = qa('.cbt', run()).filter(function (r) { return /surprised/.test(text(q('.cbt-top', r))); });
  check(tags.length === 4 && tags.every(function (r) { return r.classList.contains('pc'); }), 'the four crows are tagged surprised, the foes aren\'t');
  check(!q('.run-setup', run()), 'surprise settings are gone once combat starts');

  /* ---------------------------------------------------------------- 6. foes act; a crow is hurt */
  click('Claws +2', row('Undead B 1'));
  check(/\+3 = /.test(dice()) && /\+1 vs surprised/.test(dice()), 'a foe attacking surprised crows gets +1 (Claws +2 rolls at +3)');
  check(logHas('**Undead B 1** Claws (M1)'), 'the attack is logged');
  hit('Dove', 7);
  check(pool(row('Dove'), 'Stam') === 0 && pool(row('Dove'), 'Wounds') === 2, 'Dove takes 7: 5 Stamina, then 2 wounds');
  check(pc('Dove').st === 0 && pc('Dove').wounds === 2, 'Dove\'s party entry follows the tracker');
  check(logHas('**Dove** takes 7 damage (5 to Stamina, 2 wounds)'), 'the damage is logged');
  click('Weakened', row('Ash'), true);
  check(saved().session.combat.list.filter(function (x) { return x.name === 'Ash'; })[0].conds.Weakened === true, 'Ash is weakened');

  /* ---------------------------------------------------------------- 7. round 2, a reinforcement */
  click('Next round + initiative', run());
  check(saved().session.combat.round === 2, 'round 2 started');
  check(qa('.cbt .chip', run()).every(function (x) { return text(x) !== 'surprised'; }), 'no one is tagged surprised in round 2');
  click('Claws +2', row('Undead B 1'));
  check(!/vs surprised/.test(dice()), 'no surprise bonus in round 2');
  var addRow = qa('.row', run()).filter(function (r) { return q('select[aria-label=Creature]', r) && q('select[aria-label=Side]', r); })[0];
  type(q('select[aria-label=Creature]', addRow), 'Sword Warrior (P4)');
  type(q('input[aria-label="How many"]', addRow), '1');
  type(q('select[aria-label=Side]', addRow), 'ally');
  click('Add', addRow, true);
  var sw = saved().session.combat.list.filter(function (x) { return x.cref === 'Sword Warrior (P4)'; })[0];
  check(sw && sw.kind === 'ally' && sw.enc === e.id, 'a Sword Warrior joins as an ally, tagged with the encounter');

  /* ---------------------------------------------------------------- 8. morale and the foes going down */
  hit('Thief (P3) 1', 7);
  check(pool(row('Thief (P3) 1'), 'Stam') === 0 && pool(row('Thief (P3) 1'), 'AD') === 0, 'the first thief takes 7: 2 to AD, 5 to Stamina');
  check(cues().some(function (t) { return /Half the human foes are down/.test(t); }), 'morale cue: half the humans are down, so they flee');
  hit('Undead A 1', 10); hit('Undead A 2', 10); hit('Undead B 1', 20);
  check(['Undead A 1', 'Undead A 2', 'Undead B 1'].every(function (n) { return row(n).classList.contains('dead'); }), 'the undead die at 0 Stamina');
  click('Mark dead', row('Thief (P3) 2'), true);
  check(cues().some(function (t) { return /Every foe is down/.test(t); }), 'cue: every foe is down');
  check(/0 of 5 foes standing/.test(text(run())), 'the count reads 0 of 5 foes standing');

  /* ---------------------------------------------------------------- 9. the Session tab knows */
  goTab('Session');
  check(/Running encounter: Ambush at the ford/.test(text(q('#sec-combat .run-note'))), 'the Session tab\'s combat card links to the running encounter');
  goTab('Encounters');

  /* ---------------------------------------------------------------- 10. treasure XP for the four players */
  type(q('textarea', run()), 'The thieves carried a silver locket.');
  check(encState().notes === 'The thieves carried a silver locket.', 'Ref notes typed during the fight are kept');
  click('Award treasure XP', run());
  check(document.body.getAttribute('data-tab') === 'party', 'Award treasure XP opens the Party tab');
  var xp = q('#sec-xp');
  var what = qa('input', xp).filter(function (i) { return i.placeholder && i.placeholder.indexOf('jade mask') >= 0; })[0];
  check(what.value === 'Ambush at the ford', 'the XP card is labelled with the encounter');
  type(qa('select', xp)[0], '0');                       // no greed bonus, so the numbers are exact
  type(q('input[type=number]', xp), '400');
  xp = q('#sec-xp');
  check(/400 gc → 100 XP per crow/.test(text(xp)), '400 gc between four players is 100 XP each');
  click('Award as pending XP', xp);
  check(saved().party.every(function (p) { return p.pending === 100; }), 'each of the four crows has 100 pending XP');
  goTab('Encounters');
  check(!run().hidden, 'the encounter is still running after awarding XP');

  /* ---------------------------------------------------------------- 11. end it */
  type(q('.run-end select', run()), 'won');
  click('End encounter', run(), true);
  e = encState();
  c = saved().session.combat;
  check(run().hidden, 'the Running card is gone');
  check(c.list.length === 0 && c.round === 0 && c.encId === null && c.surprise === 'none', 'the combat tracker is cleared');
  check(e.done === true && e.outcome === 'The crows won', 'the encounter is resolved: the crows won');
  [/^The thieves carried a silver locket\.\n\n/, /Session 1, DT 1: The crows won after 2 rounds\./, /Fallen: 2 × Undead A, 1 × Undead B, 1 × Thief \(P3\)\./,
    /Foes still standing: 1 × Thief \(P3\)\./, /Allies: 1 × Sword Warrior \(P4\)\./, /Crows: Ash 9\/9; Briar 7\/7; Corvin 9\/9; Dove 0\/5, 2 wounds\./,
    /Corpses to harvest: 4 Medium \(1d6 parts each\)\./].forEach(function (re) { check(re.test(e.notes), 'notes: ' + re.source.replace(/^\^|\\n|\\/g, '')); });
  check(card() && card().open && /resolved: the crows won/.test(text(q('summary', card()))), 'the list shows the resolved encounter, open');
  check(text(q('#tabbar')).indexOf('Encounters⚔') < 0, 'the ⚔ badge is gone');
  check(logHas('Encounter ends: Ambush at the ford.'), 'the log says the encounter ended');
  check(pc('Dove').st === 0 && pc('Dove').wounds === 2 && pc('Ash').st === 9, 'the crows keep their Stamina and wounds after the fight');
  check(confirms.length === 0, 'no confirmation was needed along the way');

  return { ok: true, steps: steps, campaign: saved(), recordId: window.CrowsCloud && window.CrowsCloud.recordId || null };
})().then(done, function (err) { done({ ok: false, error: err.message, steps: steps, confirms: confirms }); });
