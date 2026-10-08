/*
 * The Workshop and the Tabletop's saved encounters, inside the Ref Screen (ref/test/run_workshop_test.py): a custom creature made from the
 * Bestiary (abilities, equipment, attacks and AD from its gear), custom equipment (qualities, upgrade, enchantments, a spellbook), a rename
 * that follows into the creature's gear, the creature in the Bestiary and the tracker (holding its gear), the environment on the battle
 * map (chips, the players' copy, darkness in a creature's roll), and the map saved as an encounter and loaded back as it was.
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
function pick(sel, value, root) { var s = q(sel, root); if (!s) throw new Error('no ' + sel); s.value = value; s.dispatchEvent(new Event('change')); return s; }
function typeIn(sel, value, root, ev) { var n = q(sel, root); if (!n) throw new Error('no ' + sel); n.value = value; n.dispatchEvent(new Event(ev || 'change')); return n; }
function checkbox(label, root) {
  var c = qa('label', root).filter(function (l) { return text(l).indexOf(label) === 0; }).map(function (l) { return q('input[type=checkbox]', l); })[0];
  if (!c) throw new Error('no checkbox ' + label); c.click(); return c;
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function st() { return window.CrowsRef.state; }
function cb() { return st().session.combat; }
function drawer() { return q('#sec-vtt .vtt-drawer'); }
window.confirm = function () { return true; };

(async function () {
  var A = window.CrowsRefApp;
  ['Ash', 'Briar'].forEach(function (n) { st().party.push({ id: A.nid(), name: n, st: 9, stMax: 9, ad: 0, wounds: 0, conds: {}, status: 'active', xp: 0 }); });
  A.save();

  // ---- a custom creature, from the Bestiary
  tab('Workshop');
  check(q('#sec-hb-creatures') && q('#sec-hb-items'), 'the Workshop tab has Custom Creatures and Custom Equipment');
  pick('select[aria-label="Start from a creature"]', 'Bear', q('#sec-hb-creatures'));
  click('New creature', q('#sec-hb-creatures'), true);
  var r = st().homebrew.creatures[0];
  check(r && r.n === 'Bear (variant)' && r.st === 20 && r.c[2] === 2 && r.atk.length === 2, 'a variant copies the Bear’s stats');
  typeIn('#sec-hb-creatures .hb-form input[aria-label="Name"]', 'Grave Bear');
  check(r.n === 'Grave Bear' && A.beast('Grave Bear') && A.beast('Grave Bear').custom, 'renamed, it is in the Bestiary as a custom creature');
  typeIn('#sec-hb-creatures input[aria-label="Power"]', '8');
  pick('#sec-hb-creatures select[aria-label="Type"]', 'Undead');
  check(A.beast('Grave Bear').p === 8 && A.beast('Grave Bear').t === 'Undead', 'its stats can be changed');
  pick('#sec-hb-creatures select[aria-label="Special ability"]', String(REF.HB_ABILITIES.map(function (a) { return a[0]; }).indexOf('Fire Beam')));
  click('Add', q('#sec-hb-creatures .hb-form'), true);
  check(/Fire Beam \(action\)/.test(A.beast('Grave Bear').x) && A.beast('Grave Bear').uses.some(function (u) { return u[0] === 'Fire Beam' && u[1] === 1 && u[2] === 'Day'; }),
    'a special ability from the rules goes into its stat block with its uses');
  check((REF.MONSTER_TRAITS['Grave Bear'] || []).indexOf('Fire Beam') >= 0, 'Monster Expert knows the monster’s abilities by name');
  pick('#sec-hb-creatures select[aria-label="Equipment"]', 'Light Armor'); click('Give', q('#sec-hb-creatures'), true);
  pick('#sec-hb-creatures select[aria-label="Equipment"]', 'Sword'); click('Give', q('#sec-hb-creatures'), true);
  click('Attacks from its weapons', q('#sec-hb-creatures'));
  click('Use AD 9', q('#sec-hb-creatures'));
  var b = A.beast('Grave Bear'), sw = b.atk.filter(function (a) { return a[0] === 'Sword'; })[0];
  check(sw && sw[1] === 2 && sw[3] === 5 && sw[4] === 8 && b.ad === 9, 'its sword becomes an attack (+S) and its armor and parry its AD');

  // ---- custom equipment
  pick('#sec-hb-items select[aria-label="Kind"]', 'weapon');
  click('New item', q('#sec-hb-items'), true);
  var it = st().homebrew.items[0];
  typeIn('#sec-hb-items .hb-form input[aria-label="Name"]', 'Grave Knife');
  checkbox('Light', q('#sec-hb-items'));
  pick('#sec-hb-items select[aria-label="Metal upgrade"]', 'Steel');
  checkbox('Flaming', q('#sec-hb-items'));
  var card = CROWS.ITEMS['Grave Knife'];
  check(card && card.custom && card.cat === 'weapon' && card.light && /12-16: 4 \+ S; 17\+: 7 \+ S/.test(card.txt) && /Steel/.test(card.txt) && /Flaming:/.test(card.txt),
    'a custom weapon becomes an inventory card with its quality, upgrade, and enchantment');
  check(/Rules price 5,512 gc/.test(text(q('#sec-hb-items'))), 'the editor offers the rules’ price (base + steel + flaming)');
  checkbox('Lightning', q('#sec-hb-items'));
  check(/5 \/ 4 Enchanting uses/.test(text(q('#sec-hb-items'))), 'it shows when the enchantments pass 4 uses');
  checkbox('Lightning', q('#sec-hb-items'));
  pick('#sec-hb-items select[aria-label="Kind"]', 'spell');
  click('New item', q('#sec-hb-items'), true);
  checkbox('It is an attack', q('#sec-hb-items'));
  var spell = st().homebrew.items[0], sc0 = CROWS.ITEMS[spell.n];
  check(sc0.cat === 'spell' && sc0.atk && /^R0 Elemental Attack\. UD 1 \(Rest; Activate\)/.test(sc0.txt) && /12-16: 2\+M; 17\+: 4\+M/.test(sc0.txt), 'a spellbook card reads like the rules’');
  pick('#sec-hb-creatures select[aria-label="Equipment"]', 'Grave Knife'); click('Give', q('#sec-hb-creatures'), true);
  A.ui.hb.it = it.id; A.render();   // the knife's editor again
  typeIn('#sec-hb-items .hb-form input[aria-label="Name"]', 'Grave Dagger');
  check(r.gear.some(function (g) { return g[0] === 'Grave Dagger'; }) && CROWS.ITEMS['Grave Dagger'] && !CROWS.ITEMS['Grave Knife'], 'renaming an item renames it in the creature’s equipment');

  // ---- the Bestiary and the tracker
  tab('Bestiary');
  click('Mine', q('#sec-bestiary .seg'), true);
  check(qa('#sec-bestiary .beast').length === 1 && /Grave Bear/.test(text(q('#sec-bestiary .beast'))), 'the Bestiary’s Mine filter shows it');

  // ---- the battle map, its environment, and a creature's roll
  tab('Tabletop');
  click('Battle map', q('.vtt-empty'));
  q('.vtt-roster .fab.add').click();
  click('Crows', drawer(), true);
  pick('select[aria-label=Creature]', 'Grave Bear', drawer());
  q('input[aria-label="How many"]', drawer()).value = '2';
  click('Add', drawer(), true);
  click('Marker', drawer(), true);
  var sc = st().vtt.scenes[0];
  sc.tokens.forEach(function (t, i) { t.hidden = false; t.x = sc.g * (3 + i * 2) + sc.g / 2; t.y = sc.g * (4 + i) + sc.g / 2; });
  var bears = cb().list.filter(function (x) { return x.cref === 'Grave Bear'; });
  check(bears.length === 2 && bears[0].items.map(function (x) { return x.key; }).join() === 'Light Armor,Sword,Grave Dagger', 'a custom creature in the tracker holds its equipment');
  q('.vtt-tr button[title^="Environment"]').click();
  qa('.env-tog', drawer()).filter(function (x) { return /^Rain/.test(text(x)); })[0].click();
  qa('.env-tog', drawer()).filter(function (x) { return /^Darkness/.test(text(x)); })[0].click();
  check(sc.env.rain && sc.env.dark, 'the Environment drawer turns rain and darkness on');
  check(qa('.vtt-tc .hud-chip.env').map(text).join() === 'Darkness,Rain' && /double bane/.test(q('.vtt-tc .hud-chip.env').title), 'they show on the map, with their rules as the tooltip');
  check(q('#vtt-host canvas.vtt-weather'), 'the map has its weather layer');
  st().vtt.shown = true;
  var pub = A.publicTable();
  check(pub.env && pub.env.rain && pub.envInfo.length === 2, 'the players’ copy of the scene carries the environment');
  st().vtt.shown = false;
  bears[0].target = cb().list.filter(function (x) { return x.kind === 'pc'; })[0].id;
  A.monsterAttack(bears[0], A.beast('Grave Bear').atk[0]);
  check(!/darkness/.test(A.ui.dice.note || ''), 'an undead sees in the dark');
  A.ui.dice = null;
  qa('.env-tog', drawer()).filter(function (x) { return /^Smoke/.test(text(x)); })[0].click();
  r.t = 'Human'; A.syncHomebrew();
  A.monsterAttack(bears[0], A.beast('Grave Bear').atk[0]);
  check(/darkness/.test(A.ui.dice.note || ''), 'a human attacking in the map’s darkness takes the double bane');
  r.t = 'Undead'; A.syncHomebrew();

  // ---- save the map as an encounter, then load it back
  bears[0].st = 11; bears[0].conds = { Prone: true };
  cb().items = [{ id: 'g1', key: 'Grave Dagger', qty: 1, hidden: false }];
  var spot = { x: sc.tokens.filter(function (t) { return t.cid === bears[1].id; })[0].x, marker: sc.tokens.filter(function (t) { return t.kind === 'obj'; })[0].x };
  q('.vtt-tr button[title^="Save this map"]').click();
  typeIn('input[aria-label="Encounter name"]', 'The grave den', drawer(), 'input');
  checkbox('Creatures as they are now', drawer());
  click('Save as a new encounter', drawer(), true);
  var e = st().encounters[0];
  check(e.name === 'The grave den' && e.creatures.length === 1 && e.creatures[0].n === 'Grave Bear' && e.creatures[0].k === 2, 'saved: its creatures are the encounter’s');
  check(e.layout && e.layout.env.dark && e.layout.env.rain && e.layout.tokens.length === 3 && e.layout.crows.length === 2 && e.layout.ground.length === 1,
    '...and its layout keeps the environment, the tokens, the crows’ places, and the ground');
  // Clear the fight and the scene, then load it again.
  cb().list = []; cb().items = []; cb().encId = null; cb().round = 0;
  st().vtt.scenes = []; st().vtt.cur = ''; A.ui.vtt.drawer = null; A.save(); A.render();
  tab('Encounters');
  A.ui.encOpen[e.id] = true; A.render();
  click('Run on the Tabletop', q('#enc-' + e.id));
  await wait(50);
  var ns = st().vtt.scenes[0], again = cb().list.filter(function (x) { return x.cref === 'Grave Bear'; });
  check(ns && ns.fromEnc === e.id && ns.env.dark && ns.env.rain, 'loading builds the scene again with its environment');
  check(again.length === 2 && again[0].st === 11 && again[0].conds.Prone && again[1].st === again[1].stMax, 'the creatures come back as they were saved');
  var t1 = ns.tokens.filter(function (t) { return t.cid === again[1].id; })[0], mk = ns.tokens.filter(function (t) { return t.kind === 'obj'; })[0];
  check(t1 && Math.abs(t1.x - spot.x) < 2 && mk && Math.abs(mk.x - spot.marker) < 2, '...each in its place, with the marker');
  check(cb().items.length === 1 && cb().items[0].key === 'Grave Dagger' && again[0].items.length === 3, 'the items on the ground and in their hands are back');
  check(cb().encId === e.id, 'and the encounter is running');
  done({ ok: true, steps: steps });
})().catch(function (err) { done({ ok: false, steps: steps, error: String(err && err.stack || err) }); });
