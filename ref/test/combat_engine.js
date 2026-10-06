/*
 * The combat tracker's rules engine, run inside the Ref Screen by ref/test/run_engine_test.py.
 *
 * Creatures fight allied NPCs (no accounts needed), with the dice forced for each roll, and the test checks what the
 * rules say happens: tier effects (grabbed, weakened and vulnerable, prone with a size limit), grabs ending when the
 * grabber dies, Undo putting damage and conditions back, counters after a melee miss (and reactions running out),
 * attacks on 2 targets, fixed crit damage, the target's state (prone, unconscious: tier 3 and waking up), battlefield
 * buttons (flanking, resetting after the roll), hidden attackers revealing themselves, opportunity attacks, the
 * Grab / Knockback / Escape Grab maneuvers, and "at 15 Stamina or less" bonus damage.
 *
 * Called as a WebDriver async script; reports { ok, steps, error }.
 */
var done = arguments[arguments.length - 1];
var steps = [];
function check(cond, what) { if (!cond) throw new Error(what); steps.push(what); }
function q(sel, root) { return (root || document).querySelector(sel); }
function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function text(n) { return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }
function button(label, root) {
  var b = qa('button', root).filter(function (x) { return text(x).indexOf(label) === 0; })[0];
  if (!b) throw new Error('no button "' + label + '"');
  return b;
}
function has(label, root) { return qa('button', root).some(function (x) { return text(x).indexOf(label) === 0; }); }
function exact(label, root) { var b = qa('button', root).filter(function (x) { return text(x) === label; })[0]; if (!b) throw new Error('no button "' + label + '"'); return b; }
function hasExact(label, root) { return qa('button', root).some(function (x) { return text(x) === label; }); }
function combat() { return window.CrowsRef.state.session.combat; }
function who(name) { return combat().list.filter(function (x) { return x.name === name; })[0]; }
function row(name) { return qa('#sec-combat .cbt').filter(function (r) { var i = q('.cbt-name input', r); return i && i.value === name; })[0]; }
function hp(name) { var x = who(name); return x.st + x.ad; }
function dice() { return text(q('#side-dice .result')); }
/* The page's own dice (a WebDriver script has its own Math): each roll gets these values. */
function force(v) { window.Math.random = function () { return v; }; }
var real = window.Math.random;
function add(name, n, side) {
  var box = q('#sec-combat'), s = q('select[aria-label=Creature]', box);
  s.value = name; s.dispatchEvent(new Event('change'));
  var c = q('input[aria-label="How many"]', box); c.value = String(n); c.dispatchEvent(new Event('change'));
  var sd = q('select[aria-label=Side]', box); sd.value = side; sd.dispatchEvent(new Event('change'));
  qa('button', box).filter(function (x) { return text(x) === 'Add'; })[0].click();
}
function target(attacker, victim, second) {
  var s = q('select[aria-label="' + attacker + '’s ' + (second ? 'second target' : 'target') + '"]');
  if (!s) throw new Error('no target picker for ' + attacker);
  s.value = who(victim).id; s.dispatchEvent(new Event('change'));
}
/* A hit waits until the Ref applies it: press Apply on the result, as the Ref would (when there's damage to deal). */
function applyHit() { var b = qa('button', q('#side-dice .result')).filter(function (x) { return text(x).indexOf('Apply') === 0; })[0]; if (b) b.click(); }
function attack(attacker, label, v) { force(v); try { button(label, row(attacker)).click(); } finally { window.Math.random = real; } applyHit(); }
function cond(name, k) { button(k, q('.conds', row(name))).click(); }

try {
  if (document.body.getAttribute('data-tab') !== 'encounters') button('Encounters', q('#tabbar')).click();   // the tracker for fights outside an encounter
  add('Sword Warrior (P4)', 2, 'ally');
  add('Crocodile', 1, 'foe');
  check(who('Sword Warrior (P4) 1') && who('Crocodile 1'), 'two allied sword warriors and a crocodile in the tracker');

  // Tier effects: the crocodile's crit bite grabs a Medium target.
  target('Crocodile 1', 'Sword Warrior (P4) 1');
  var h0 = hp('Sword Warrior (P4) 1');
  attack('Crocodile 1', 'Bite', 0.999);
  var sw1 = who('Sword Warrior (P4) 1');
  check(hp('Sword Warrior (P4) 1') === h0 - 6, 'a crit bite deals its tier 3 damage (6) to the target it was given');
  check(sw1.conds.Grabbed && sw1.grabbedBy === who('Crocodile 1').id, 'T3 vs Medium or smaller: the target is grabbed by the crocodile');
  check(/grabbed by Crocodile 1/.test(text(row('Sword Warrior (P4) 1'))) && /grabbing Sword Warrior/.test(text(row('Crocodile 1'))), 'both rows show the grab');
  button('Undo', q('#side-dice .result')).click();
  check(hp('Sword Warrior (P4) 1') === h0 && !who('Sword Warrior (P4) 1').conds.Grabbed, 'Undo puts the damage and the grab back');
  attack('Crocodile 1', 'Bite', 0.999);
  check(who('Sword Warrior (P4) 1').conds.Grabbed, 'grabbed again');
  button('Mark dead', row('Crocodile 1')).click();
  check(!who('Sword Warrior (P4) 1').conds.Grabbed, 'the grab ends when the grabber dies');

  // Weakened and vulnerable by tier.
  add('Giant Scorpion', 1, 'foe');
  target('Giant Scorpion 1', 'Sword Warrior (P4) 2');
  attack('Giant Scorpion 1', 'Sting', 0.999);
  var sw2 = who('Sword Warrior (P4) 2');
  check(sw2.conds.Vulnerable && sw2.conds.Weakened, 'the sting’s tier 3: vulnerable and weakened');

  // A melee doom: the target counters at tier 3, and has no reaction left after.
  attack('Giant Scorpion 1', 'Pincer', 0);
  check(/miss/.test(dice()) && has('Sword Warrior (P4) 2 counters Giant Scorpion 1 (7)', q('#side-dice .result')), 'a melee doom offers the target’s counter at tier 3 (sword 7)');
  var s0 = hp('Giant Scorpion 1');
  button('Sword Warrior (P4) 2 counters', q('#side-dice .result')).click();
  check(hp('Giant Scorpion 1') === s0 - 7, 'the counter deals 7 to the scorpion');
  check(/rxn 0\/1/.test(text(row('Sword Warrior (P4) 2'))), 'the counter used the sword warrior’s reaction');
  attack('Giant Scorpion 1', 'Pincer', 0);
  check(!has('Sword Warrior (P4) 2 counters', q('#side-dice .result')), 'no second counter in the same round');

  // Two targets, one roll.
  add('Bear', 1, 'foe');
  target('Bear 1', 'Sword Warrior (P4) 1'); target('Bear 1', 'Sword Warrior (P4) 2', true);
  var a1 = hp('Sword Warrior (P4) 1'), a2 = hp('Sword Warrior (P4) 2');
  attack('Bear 1', 'Claws', 0.6);
  check(hp('Sword Warrior (P4) 1') === a1 - 2 && hp('Sword Warrior (P4) 2') < a2 - 2, 'claws on 2 targets: one roll hits both (the vulnerable one takes 1d6 more)');

  // "At 15 Stamina or less: +2 damage".
  button('Clear dead', q('#sec-combat')).click();
  var b = who('Bear 1'); b.st = 15;
  target('Bear 1', 'Sword Warrior (P4) 1');
  a1 = hp('Sword Warrior (P4) 1');
  attack('Bear 1', 'Bite', 0.6);
  check(hp('Sword Warrior (P4) 1') === a1 - 6 && /\+2 hurt/.test(dice() + JSON.stringify(window.CrowsRef.state.log.slice(-2))), 'a bear at 15 Stamina bites for 4 + 2');

  // Fixed crit damage.
  add('Pike Warrior (P4)', 1, 'foe');
  target('Pike Warrior (P4) 1', 'Sword Warrior (P4) 1');
  a1 = hp('Sword Warrior (P4) 1');
  attack('Pike Warrior (P4) 1', 'Pike', 0.9);   // 10 + 10: a crit (it crits on 18-20)
  check(a1 - hp('Sword Warrior (P4) 1') === Math.min(16, a1), 'a pike crit deals its fixed 16 damage');

  // The target's state: prone gives a melee edge; unconscious is tier 3 and the hit wakes it.
  cond('Sword Warrior (P4) 1', 'Prone');
  attack('Pike Warrior (P4) 1', 'Pike', 0.5);
  check(/target prone/.test(dice()), 'a prone target: the melee attack has an edge');
  target('Pike Warrior (P4) 1', 'Sword Warrior (P4) 2');
  cond('Sword Warrior (P4) 2', 'Unconscious');
  attack('Pike Warrior (P4) 1', 'Pike', 0.25);   // 3 + 3 + 2 = 8: tier 1, but an unconscious target is hit at tier 3
  check(/T3/.test(dice() + window.CrowsRef.state.log.slice(-3).map(function (e) { return e.s; }).join(' ')) && /target unconscious/.test(dice()), 'an unconscious target is hit at tier 3');
  check(!who('Sword Warrior (P4) 2').conds.Unconscious, 'the damage wakes it up');

  // Battlefield buttons apply to one roll.
  button('Flanking', q('#sec-combat .sit-row')).click();
  attack('Pike Warrior (P4) 1', 'Pike', 0.5);
  check(/flanking/.test(dice()) && !q('#sec-combat .sit-row .cond.on'), 'flanking gives an edge, and the battlefield buttons reset after the roll');

  // A hidden attacker has an edge and is revealed.
  button('Hidden', q('.conds', row('Pike Warrior (P4) 1'))).click();
  attack('Pike Warrior (P4) 1', 'Pike', 0.5);
  check(/hidden/.test(dice()) && !who('Pike Warrior (P4) 1').hidden, 'a hidden attacker has an edge and is revealed by attacking');

  // Opportunity attack: a reaction (at a fresh sword warrior: the others may be down by now).
  add('Sword Warrior (P4)', 1, 'ally');
  target('Pike Warrior (P4) 1', 'Sword Warrior (P4) 3');
  button('Opportunity attack', row('Pike Warrior (P4) 1')).click();
  check(/opportunity attack/.test(dice()) && /rxn 0\/1/.test(text(row('Pike Warrior (P4) 1'))) && !has('Opportunity attack', row('Pike Warrior (P4) 1')), 'an opportunity attack uses its reaction');

  // Maneuvers: Grab (its size or smaller), then Escape Grab; Knockback that fails lets the target counter.
  add('Undead C', 1, 'foe');
  target('Undead C 1', 'Sword Warrior (P4) 3');
  force(0.999); try { exact('Grab', row('Undead C 1')).click(); } finally { window.Math.random = real; }
  check(who('Sword Warrior (P4) 3').grabbedBy === who('Undead C 1').id, 'Undead C grabs the sword warrior (a Grab maneuver, tier 3)');
  check(has('Escape Grab', row('Sword Warrior (P4) 3')), 'the grabbed sword warrior has Escape Grab');
  force(0.999); try { button('Escape Grab', row('Sword Warrior (P4) 3')).click(); } finally { window.Math.random = real; }
  check(!who('Sword Warrior (P4) 3').conds.Grabbed, 'Escape Grab at tier 3 frees it');
  add('Blood Creature A', 1, 'foe');
  target('Blood Creature A 1', 'Sword Warrior (P4) 3');
  check(!hasExact('Grab', row('Blood Creature A 1')) && !hasExact('Knockback', row('Blood Creature A 1')), 'a Small creature can’t grab or knock back a Medium one');
  force(0); try { button('Knockback', row('Undead C 1')).click(); } finally { window.Math.random = real; }
  check(/may counter/.test(dice()), 'a failed Knockback: the target may counter');

  done({ ok: true, steps: steps });
} catch (e) {
  window.Math.random = real;
  done({ ok: false, error: e.message, steps: steps });
}
