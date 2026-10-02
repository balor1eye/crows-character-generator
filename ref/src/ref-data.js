/*
 * Crows (MCDM) Playtest 2 — data for the Ref Screen.
 * Source: the Rules, Characters, Ref, and Dungeons books for Playtest 2, via docs/CROWS_PT2_RULES.md.
 * Everything here is plain data; ref.js does the rolling and bookkeeping.
 */

var REF = {};

REF.CHARS = ['Agility', 'Mind', 'Strength'];
REF.CONDITIONS = [
  ['Blessed', 'Edge on all tests; attacks deal extra damage equal to the characteristic used. Ends at the end of the dungeon turn.'],
  ['Grabbed', 'Speed 0, can\'t flank, attacks against you gain an edge; you move with the grabber. Ends if the grabber moves out of range, lets go, is killed, prone, or unconscious, or you Escape Grab.'],
  ['Prone', 'Speed halved, bane on melee attacks, can\'t flank; melee attacks against you gain an edge, ranged attacks against you take a bane. Standing up is a maneuver (speed 1+).'],
  ['Unconscious', 'Prone, speed 0, no actions, maneuvers, or reactions. Automatic doom on Agility and Strength tests; double bane on Mind tests to notice things. Attacks against you are automatically tier 3 (can still crit). Any damage wakes you.'],
  ['Vulnerable', 'Take an extra 1d6 damage each time you take damage. Ends at the end of the dungeon turn.'],
  ['Weakened', 'Bane on all tests. Ends at the end of the dungeon turn.']
];

/* Backgrounds in character-app order (index = saved "bg"): name, characteristic(s) at 2, starting Stamina. */
REF.BACKGROUNDS = [
  ['Acolyte of the Gardner', ['Mind'], 5], ['Acolyte of the Healer', ['Mind'], 7], ['Acolyte of the Smith', ['Mind'], 7],
  ['Acolyte of the Three', ['Mind', 'Strength'], 7], ['Acolyte of the Warrior', ['Mind', 'Strength'], 9], ['Alchemist', ['Mind'], 5],
  ['Apprentice Mage', ['Mind'], 5], ['Archer', ['Agility'], 7], ['Assassin', ['Agility'], 5],
  ['Beggar', ['Agility', 'Mind', 'Strength'], 7], ['Blacksmith', ['Strength'], 7], ['Bodyguard', ['Strength'], 9],
  ['Cartographer', ['Mind'], 7], ['Conjurer', ['Mind'], 7], ['Cook', ['Agility', 'Mind', 'Strength'], 7],
  ['Duelist', ['Agility'], 9], ['Entertainer', ['Agility'], 5], ['Executioner', ['Strength'], 9],
  ['Farmer', ['Strength'], 7], ['Gladiator', ['Strength'], 9], ['Hunter', ['Agility'], 5],
  ['Hydromancer', ['Mind'], 7], ['Illusionist', ['Mind'], 5], ['Keraunomancer', ['Mind'], 7],
  ['Knight', ['Strength'], 9], ['Merchant', ['Mind'], 7], ['Miner', ['Strength'], 7],
  ['Noble', ['Agility', 'Mind'], 7], ['Pugilist', ['Agility', 'Strength'], 9], ['Pyromancer', ['Mind'], 5],
  ['Sage', ['Mind'], 5], ['Soldier', ['Strength'], 9], ['Thief', ['Agility'], 5],
  ['Tinkerer', ['Mind'], 5], ['Transmuter', ['Mind'], 5], ['Village Watch', ['Strength'], 9]
];

REF.CONNECTION_BENEFITS = [
  ['Animal Lover', 'Looks after and feeds your pets in the village for free. Pets resting with them heal 2 extra wounds (3 at Prosperity 6+).'],
  ['Caretaker', 'Rest at their home in the village: heal 2 extra wounds (3 at Prosperity 6+).'],
  ['Concerned', 'Once per cycle when you leave the village: 1 torch.'],
  ['Crafty', '+2 on crafting rolls in the village.'],
  ['Foodie', 'Once per cycle when you leave the village: rations equal to half the Prosperity (min 1).'],
  ['Magic Enthusiast', 'Each day identifies magic items equal to Prosperity (min 1).'],
  ['Money Bags', 'Loan up to 100 x Prosperity gc (min 100 gc); no new loan until repaid.'],
  ['Monster Collector', 'Trades 1 monster part of a wanted type for 5 of another type.'],
  ['Rival', 'A rival crow. Once per cycle, bet on whose trip pays more; on return roll any die (even: you win). Loser pays 50 gc.'],
  ['Smarty Pants', 'Researches 1 question at a time; if answerable in the village, the answer comes 1 day later.']
];

REF.NAMES = {
  first: ['Aldric', 'Bryn', 'Corra', 'Dunstan', 'Edda', 'Fenwick', 'Gilda', 'Hollis', 'Isolde', 'Jory', 'Kestrel', 'Lark', 'Marek', 'Nell', 'Osric', 'Petra', 'Quill', 'Rook', 'Sabine', 'Tamsin', 'Ulric', 'Vesna', 'Wren', 'Yorick', 'Zora', 'Mags', 'Brannoc', 'Tilde', 'Hobb', 'Ysolde', 'Agna', 'Bertil', 'Cress', 'Dagny', 'Elric', 'Fen', 'Greer', 'Hale', 'Ilse', 'Jonas'],
  last: ['Ashdown', 'Blackmoor', 'Crowley', 'Dunmere', 'Fairweather', 'Grimsby', 'Hollowell', 'Ironside', 'Kettle', 'Larkspur', 'Mudd', 'Nettles', 'Oakes', 'Pike', 'Quarry', 'Ravensworth', 'Stitch', 'Thorne', 'Underhill', 'Vane', 'Whitlock', 'Yarrow', 'Barrow', 'Candlewick'],
  trait: ['a jagged scar across one cheek', 'always smells faintly of pipe smoke', 'a booming, theatrical voice', 'mismatched eyes', 'hums when nervous', 'a crow tattoo on one hand', 'missing two fingers', 'a battered wide-brimmed hat', 'laughs at the worst moments', 'counts coins obsessively', 'speaks in a hoarse whisper', 'collects monster teeth', 'wildly superstitious', 'copper hair braided with bones', 'a moth-eaten red scarf', 'a stutter that vanishes in a fight', 'never makes eye contact', 'overly familiar', 'quotes scripture constantly', 'gambles on everything'],
  want: ['wants a debt forgiven', 'wants news of a missing child', 'wants a rival humiliated', 'wants a rare monster part', 'wants to leave the village', 'wants a lost heirloom back', 'wants protection', 'wants to be a crow', 'wants a secret kept', 'wants revenge on a Necromancer cult']
};

/* ------------------------------------------------------------------ Bestiary
 * t=type, sz=size, p=power, st=Stamina, spd=speed text, sl=slots, c=[A,M,S], ad=AD, rx=reactions,
 * atk=[name, attack bonus, range, T2 dam, T3 dam, note], uses=[[feature, n, 'Rest'|'Day']], x=notes.
 */
function C(t, n, sz, p, st, spd, sl, c, ad, atk, x, uses, rx) {
  return { t: t, n: n, sz: sz, p: p, st: st, spd: spd, sl: sl, c: c, ad: ad || 0, atk: atk || [], x: x || '', uses: uses || [], rx: rx || 1 };
}
REF.BESTIARY = [
  // Animals
  C('Animal', 'Ape', 'M', 4, 10, '5, climb 5', 10, [1, -1, 2], 0, [['Punch', 2, 'M1', 3, 5]], 'At 0 Stamina: +2 damage.'),
  C('Animal', 'Bear', 'L', 6, 20, '6, climb 6', 10, [0, -2, 2], 0, [['Bite', 2, 'M1', 4, 6], ['Claws', 2, 'M1', 2, 3, '2 targets']], 'At 15 Stamina or less: +2 damage. No dim light penalty.'),
  C('Animal', 'Cave Bear', 'L', 9, 30, '6', 15, [0, -2, 3], 0, [['Bite', 3, 'M1', 6, 6], ['Claws', 3, 'M1', 2, 3, '2 targets']], 'At 22 Stamina or less: +2 damage. No dim light penalty.'),
  C('Animal', 'Camel', 'L', 5, 15, '8', 10, [0, -2, 2], 0, [['Kick', 2, 'M1', 3, 6]], 'Gets rest benefits without food or water for up to 3 days; starves only after 3 days.'),
  C('Animal', 'Cat', 'T', 1, 4, '5, climb 5', 1, [1, -2, -3], 0, [['Scratch', 1, 'M1', 2, 3]], 'No dim light penalty.'),
  C('Animal', 'Big Cat', 'L', 7, 25, '6, climb 6', 10, [2, -2, 2], 0, [['Bite', 2, 'M1', 4, 7], ['Scratch', 2, 'M1', 2, 4, '2 targets']], 'Charge: moved 4+ squares first: +3 damage. No dim light penalty.'),
  C('Animal', 'Wildcat', 'S', 2, 9, '6, climb 6', 1, [1, -2, 0], 0, [['Bite', 1, 'M1', 2, 4], ['Scratch', 1, 'M1', 1, 2, '2 targets']], 'Charge: moved 4+ squares first: +2 damage. No dim light penalty.'),
  C('Animal', 'Chicken', 'T', 0, 2, '2, fly 3', 0, [1, -2, -4], 0, [['Peck', 1, 'M1', 1, 2]], 'Falls if still airborne when it stops flying.'),
  C('Animal', 'Crocodile', 'L', 6, 20, '4, swim 6', 10, [1, -3, 2], 0, [['Bite', 2, 'M1', 4, 6, 'T3 vs Medium or smaller: grabbed']], 'While grabbing it can\'t bite others; maneuver: 3 piercing damage to the grabbed creature. No darkness or dim light penalty.'),
  C('Animal', 'Crow', 'T', 0, 2, '2, fly 8', 0, [1, -2, -4], 0, [['Peck', 1, 'M1', 1, 2]], 'Carries 1 sheet of paper; a pet crow can return home on command.'),
  C('Animal', 'Giant Crow', 'L', 5, 15, '2, fly 10', 10, [2, -2, 2], 0, [['Peck', 2, 'M1', 3, 6]], 'While flying: edge to grab; bane for others to escape its grab.'),
  C('Animal', 'Deer', 'M', 2, 5, '8', 5, [1, -2, 0], 0, [['Ram', 2, 'M1', 2, 4]], 'Charge: +2 damage. No dim light penalty.'),
  C('Animal', 'Dog', 'M', 2, 9, '7', 1, [1, -2, 0], 0, [['Bite', 1, 'M1', 2, 4]], 'No dim light penalty.'),
  C('Animal', 'Donkey', 'M', 3, 5, '6', 10, [0, -2, 1], 0, [['Kick', 1, 'M1', 3, 4]]),
  C('Animal', 'Elephant', 'H', 10, 25, '5', 25, [-1, -2, 3], 0, [['Stomp', 3, 'M1', 5, 9]], 'Draft: 15 open slots while hauling.'),
  C('Animal', 'Goat', 'M', 2, 8, '5', 2, [0, -2, 1], 0, [['Gore', 1, 'M1', 2, 4]], 'No dim light penalty.'),
  C('Animal', 'Hawk', 'S', 1, 5, '2, fly 8', 0, [1, -2, -1], 0, [['Rake', 1, 'M1', 2, 3]], 'Carries 1 Tiny object.'),
  C('Animal', 'Draft Horse', 'L', 5, 10, '8', 15, [0, -2, 2], 0, [['Kick', 2, 'M1', 3, 6]], 'Draft: 5 open slots while hauling.'),
  C('Animal', 'Riding Horse', 'L', 5, 15, '10', 10, [2, -2, 2], 0, [['Kick', 2, 'M1', 3, 6]]),
  C('Animal', 'War Horse', 'L', 6, 20, '8', 10, [0, -2, 2], 0, [['Kick', 2, 'M1', 4, 6]], 'Mounted Charge: moved 4+ squares before the rider attacks: rider +2 damage.'),
  C('Animal', 'Monitor Lizard', 'M', 4, 15, '4, swim 4', 5, [2, -3, 1], 0, [['Bite', 2, 'M1', 3, 5, 'Lacerate on T3']], 'Lacerate: a T3 that damages Stamina or wounds leaves a laceration until the target regains Stamina; a target taking a maneuver and an action in a turn takes 1 piercing damage per laceration.'),
  C('Animal', 'Mule', 'L', 4, 10, '7', 10, [1, -2, 2], 0, [['Kick', 2, 'M1', 3, 5]]),
  C('Animal', 'Ox', 'L', 8, 20, '5', 20, [-1, -2, 3], 0, [['Kick', 3, 'M1', 4, 8]], 'Draft: 10 open slots while hauling.'),
  C('Animal', 'Rat', 'T', 0, 2, '4, climb 4', 0, [1, -3, -5], 0, [['Bite', 1, 'M1', 1, 2]], 'No dim light penalty.'),
  C('Animal', 'Giant Scorpion', 'L', 7, 25, '6, climb 6 (U)', 10, [2, -4, 2], 0, [['Pincer', 2, 'M1', 2, 4, '2 targets; T3 vs Medium or smaller: grabbed (up to 2)'], ['Sting', 2, 'M2', 4, 7, 'T2 weakened; T3 vulnerable and weakened']], 'Maneuver: 3 piercing damage to all it has grabbed. Vibration Sense 2 squares (exact location, no penalties).'),
  C('Animal', 'Constrictor Snake', 'H', 5, 15, '6, climb 6', 10, [2, -3, 2], 0, [['Bite', 2, 'M1', 3, 6]], 'Grabber: edge to grab, bane to escape it; maneuver: 2 piercing damage to the grabbed creature. Heat Sense 2 squares (humans, blood creatures, demons, birds, mammals).'),
  C('Animal', 'Venomous Snake', 'T', 1, 5, '6, climb 6', 0, [1, -3, -4], 0, [['Bite', 1, 'M1', 1, 2, 'T3 weakened']], 'Heat Sense 2 squares.'),
  C('Animal', 'Giant Venomous Snake', 'L', 4, 15, '6, climb 6', 5, [2, -4, 1], 0, [['Bite', 2, 'M1', 3, 5, 'T2 weakened; T3 vulnerable and weakened']], 'Heat Sense 2 squares.'),
  C('Animal', 'Spider', 'T', 0, 2, '5, climb 5 (U)', 0, [1, -4, -5], 0, [['Bite', 1, 'M1', 1, 2]], 'Vibration Sense 2 squares.'),
  C('Animal', 'Giant Spider', 'H', 10, 30, '8, climb 8 (U)', 20, [2, -4, 3], 0, [['Bite', 3, 'M1', 5, 9, 'T2 weakened; T3 vulnerable and weakened']], 'Web (action): 3-square area within 1; web has 10 Stamina; Agility RR: grabbed; speed halved until end of next turn; none. Vibration Sense 2 squares.'),
  C('Animal', 'Wolf', 'M', 3, 10, '7', 5, [1, -2, 0], 0, [['Bite', 1, 'M1', 3, 4]], 'Pack Hunter: flanking with another wolf gives +3 total. No dim light penalty.'),
  C('Animal', 'Dire Wolf', 'L', 5, 15, '7', 10, [2, -2, 2], 0, [['Bite', 2, 'M1', 3, 6, 'T3 vs Medium or smaller: prone']], 'Pack Hunter. No dim light penalty.'),
  // Humans
  C('Human', 'Alchemist', 'M', 3, 5, '5', 10, [1, 1, -1], 0, [['Unarmed', 1, 'M1', 2, 3], ['Acid Vial', 1, 'R5', 5, 9]], 'Alchemy 3, Magic Lore, Monster Lore. Gear: 5 acid vials, alchemist\'s tools, fire bomb, 5 poison vials. Fire Bomb (action): throw 10 squares, 3 cube, Agility RR: 10; 5; 0 damage.'),
  C('Human', 'Archer (P4)', 'M', 4, 10, '5', 10, [1, 0, 0], 2, [['Shortbow', 2, 'R12', 3, 5]], 'AD 2 from a knife (parry). Athletics, Stealth, Bow. Gear: quiver, shortbow, knife.'),
  C('Human', 'Archer (P7)', 'M', 7, 25, '5', 10, [2, 1, 0], 0, [['Longbow', 4, 'R22', 5, 8, 'ignores cover']], 'Athletics, Stealth, Bow 2. Gear: longbow, quiver.'),
  C('Human', 'Archer (P10)', 'M', 10, 40, '5', 10, [3, 1, 0], 0, [['Longbow', 5, 'R22', 6, 9, 'ignores cover']], 'Split Shot: 2 arrows, 2 targets. Athletics, Stealth, Bow 2. (Tables\' "Archer P8" uses this block.)'),
  C('Human', 'Blacksmith', 'M', 3, 5, '5', 10, [0, 0, 1], 0, [['Hammer', 2, 'M1/R5', 3, 5]], 'Pummeling: T3 pushes Medium or smaller 1; crit knocks prone. Blacksmithing 3, Bashing. Gear: blacksmith\'s tools, hammer.'),
  C('Human', 'Commoner', 'M', 0, 5, '5', 10, [0, 0, 0], 0, [['Unarmed', 0, 'M1', 1, 2]]),
  C('Human', 'Conjurer', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Unarmed', 1, 'M1', 1, 2]], 'Jumper: its teleports +1 square. Magic Lore, Conjuration. Books: jaunt, summon object, teleport object.'),
  C('Human', 'Cultist', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Bone Capture', 2, 'R5', 3, 4, 'T3 prone']], 'Religious Lore, Necromancy. Books: bone capture, minor curse, monster sense.'),
  C('Human', 'Elementalist', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Fire Hands', 2, 'M1', 6, 10], ['Fire Lance', 2, 'R10', 4, 6]], 'Its damaging elemental spells +1 damage. Magic Lore, Elemental. Books: create water, fire hands, fire lance.'),
  C('Human', 'Enchanter', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Unarmed', 1, 'M1', 1, 2]], 'Enchanting 3, Magic Lore. Enchanter\'s tools. Material Transfer (rest activity): two weapons or armor craftable from the same materials but made of different ones swap materials.'),
  C('Human', 'Guide', 'M', 5, 15, '5', 10, [1, 2, 0], 0, [['Longbow', 1, 'R20', 4, 7]], 'Travel role tests: roll twice, choose. Historical Lore, Nature Lore, Navigate 2, Stealth. Gear: compass, longbow, quiver, torch.'),
  C('Human', 'Illusionist', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Unarmed', 1, 'M1', 1, 2]], 'Its UD-duration illusions +1 UD. Magic Lore, Illusion. Books: cacophony, light, minor phantasm.'),
  C('Human', 'Priest', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Unarmed', 1, 'M1', 1, 2]], 'Its benefaction healing +1 Stamina. Religious Lore, Benefaction. Books: minor blessing, minor healing, minor ward.'),
  C('Human', 'Sage (P3)', 'M', 3, 5, '5', 10, [0, 2, 0], 0, [['Fire Lance', 2, 'R10', 4, 6]], 'Lore-book study shares its benefit with 1 other resting human. Historical, Magic, Monster, Nature, Religious Lore. Gear: journal, lore books, quill, fire lance book.'),
  C('Human', 'Sage (P6)', 'M', 6, 20, '5', 10, [1, 3, 0], 0, [['Fire Lance', 3, 'R10', 5, 7]], 'Lecture: lore-book study shares with up to 2 others. All five lores, 2 uses each.'),
  C('Human', 'Thief (P3)', 'M', 3, 5, '5', 10, [1, 0, 0], 2, [['Knife', 1, 'M1/R5', 3, 5]], 'AD 2 (knife parry). Disengage (+1 Shift). Hide/sneak unarmored: roll twice, choose. Stealth 2, Thievery 2. Gear: crowbar, knife, lockpick set.'),
  C('Human', 'Thief (P6)', 'M', 6, 20, '5', 10, [2, 1, 0], 2, [['Knife', 2, 'M1/R5', 4, 6]], 'AD 2. Disengage. Hide/sneak/pick lock unarmored: roll twice. Stealth 3, Thievery 3.'),
  C('Human', 'Thief (P9)', 'M', 9, 35, '5', 10, [3, 1, 1], 2, [['Knife', 3, 'M1/R5', 5, 7]], 'AD 2. Disengage. Agility RRs and hide/sneak/pick lock unarmored: roll twice. Stealth 4, Thievery 4. Fine lockpick set. (Book lists power 6.)'),
  C('Human', 'Torchbearer', 'M', 3, 5, '5', 10, [1, 0, 0], 2, [['Knife', 1, 'M1/R5', 3, 5]], 'AD 2. Disengage. A torch it holds has max UD 2. Search, Stealth. Gear: knife, 6 torches.'),
  C('Human', 'Transmuter', 'M', 3, 5, '5', 10, [0, 1, 0], 0, [['Unarmed', 1, 'M1', 1, 2]], 'Its UD-duration alterations +1 UD. Magic Lore, Alteration. Books: animal form, repair, take shape.'),
  C('Human', 'Trapper', 'M', 5, 15, '5', 10, [2, 1, 1], 0, [['Longbow', 2, 'R20', 5, 8]], 'Others take a bane on RRs against its terrain effects. Nature Lore 2, Navigate, Stealth. Gear: 2 bear traps, 2 caltrops, knife, lantern, longbow, 2 oil, quiver.'),
  C('Human', 'Pike Warrior (P4)', 'M', 4, 10, '5', 10, [1, 0, 1], 5, [['Pike', 2, 'M2', 4, 8, 'crits on 18-20; crit = 16 damage']], 'Light armor. Athletics, Lift, Stabbing.'),
  C('Human', 'Pike Warrior (P7)', 'M', 7, 25, '5', 10, [1, 0, 2], 10, [['Pike', 4, 'M2', 5, 9, 'crits on 18-20; crit = 18 damage']], 'Medium armor. Spinning Shaft: a T3 also deals 2 damage to another target in range. Stabbing 2.'),
  C('Human', 'Pike Warrior (P10)', 'M', 10, 40, '5', 10, [1, 0, 3], 15, [['Pike', 5, 'M2', 6, 10, 'crits on 18-20; crit = 20 damage']], 'Heavy armor. Spinning Shaft (3 damage). All expertises 2 uses.'),
  C('Human', 'Sword Warrior (P4)', 'M', 4, 10, '5', 10, [1, 0, 1], 14, [['Sword', 2, 'M1', 4, 7]], 'Light armor, shield, sword. Disengage (+2 Shift). Endurance, Lift, Slashing.'),
  C('Human', 'Sword Warrior (P7)', 'M', 7, 25, '5', 10, [1, 0, 2], 19, [['Sword', 4, 'M1', 5, 8]], 'Medium armor, shield, sword. Disengage (+2). Interposing Arm (reaction): a creature within 1 is hit while it wields a shield: the damage goes to its shield. Slashing 2.'),
  C('Human', 'Sword Warrior (P10)', 'M', 10, 40, '5', 10, [1, 0, 3], 24, [['Sword', 5, 'M1', 6, 9]], 'Heavy armor, shield, sword. Disengage (+2). Interposing Arm. All expertises 2 uses.'),
  // Monsters
  C('Blood Creature', 'Blood Creature A', 'S', 1, 5, '6, climb 6', 0, [2, -2, 0], 0, [['Claws', 2, 'M1', 2, 3]], '"Creep", "red drool", "spindleclaw"; hunts in packs and drops from above. Drop Attack: falls count as 10 squares shorter; after a fall with no damage, edge on attacks and damage until end of turn.'),
  C('Blood Creature', 'Blood Creature B', 'S', 3, 15, '6, climb 6 (U)', 0, [2, -1, 1], 0, [['Bite', 2, 'M1', 3, 4, '+2 damage vs a creature it has grabbed'], ['Tendril', 2, 'M1', 3, 4, 'T3 vs Medium or smaller: grabbed']], '"Blood spider", "mouth eyes"; a tendril orb. Maneuver: 2 damage to the grabbed creature.'),
  C('Blood Creature', 'Blood Creature C', 'L', 8, 40, '5', 0, [0, 0, 2], 0, [['Punch', 2, 'M1', 4, 8], ['Clot', 2, 'R10', 3, 7]], '"Blood brute", "tiny arms". Fits through 1-inch gaps, never squeezes, can\'t be grabbed or knocked prone.'),
  C('Unique', 'Ring Collector (Namlin)', 'M', 20, 100, '7', 0, [4, 5, 4], 0, [['Kneel', 5, 'R10', 8, 14, 'T3 prone'], ['Sword', 4, 'M1', 7, 12, 'kill: victim explodes, 1d6 to all within 1'], ['Punches', 4, 'M1', 4, 8, '2 targets']], 'Craelin\'s warped advisor, imprisoned for hoarding rings. Extra action or maneuver each turn. Senses magic rings within 20 squares.', [['Vanish (teleport 50 miles to a visited place)', 1, 'Rest']], 4),
  C('Undead', 'Undead A', 'M', 2, 10, '5', 0, [1, -3, 2], 0, [['Claws', 2, 'M1', 2, 4, 'Lacerate on T3'], ['Spine', 2, 'R5', 1, 3]], '"Razorback", "spined death"; pack. Leap (maneuver): jump its speed.'),
  C('Undead', 'Undead B', 'M', 4, 20, '6', 0, [2, -2, 2], 0, [['Claws', 2, 'M1', 3, 5, 'Lacerate on any hit'], ['Spine', 2, 'R10', 2, 4]], '"Longclaw", "spined one". Leap. Its counters deal 5 damage.'),
  C('Undead', 'Undead C', 'L', 6, 30, '6, climb 6 (U)', 0, [2, 0, 2], 0, [['Crush', 2, 'M2', 4, 6, 'T3 vs Medium or smaller: grabbed (no limit)'], ['Bite', 2, 'M1', 4, 6, '+2 while it has anyone grabbed']], '"Gray death", "rotting breath"; many-limbed, horse-sized. Squeeze (maneuver): 2 piercing to each grabbed creature.'),
  C('Undead', 'Undead D', 'H', 10, 50, '5', 0, [-2, 0, 3], 0, [['Claws', 3, 'M2', 3, 5, '2 targets'], ['Rend', 3, 'M2', 5, 9]], '"Fire belly", "skull mountain". Fire Beam (action): 10x2 line within 1, Agility RR: 10; 5; 0. Absorb (maneuver): destroy a human corpse (died <24h) within 2 and its mundane gear; regain 10 Stamina.', [['Fire Beam', 1, 'Day']], 2),
  C('Undead', 'Undead E', 'L', 12, 60, '4', 0, [-2, 0, 3], 0, [['Fist', 3, 'M1', 3, 5, '2 targets; T3 vs Medium or smaller: grabbed (max 2); +3 melee damage vs grabbed'], ['Bite', 3, 'M1', 6, 10]], '"Babbling death", "hideous choir"; a giant of two fused humans. Bite Frenzy (action): bite each enemy within 1. Horrid Gnashing: non-undead with Mind 1 or less starting a turn within 1: bane on all tests until its next turn starts.', [['Bite Frenzy', 1, 'Day']], 2),
  C('Undead', 'Undead F', 'L', 15, 75, '4, climb 4', 0, [-2, 1, 4], 0, [['Boneshard', 4, 'M2/R5', 7, 12]], '"Gore beast", "rot pile", "sludge". Exploding Mote (action): 4 cube within 10, non-undead Strength RR: 15; 7; 0. Glorp Through (maneuver): move speed, no opportunity attacks, through spaces; 1d6 damage to each space\'s occupant it enters; ending in a space slides the occupant to the nearest free space. At 0 Stamina explodes: 1d10 to all within 2.', [['Exploding Mote', 2, 'Day'], ['Glorp Through', 3, 'Day']], 3),
  C('Undead', 'Undead G', 'M', 20, 100, '6, fly 6', 0, [2, 5, 5], 0, [['Rustswords', 5, 'M1', 8, 16, 'each metal armor/sword/shield of a damaged creature -5 AD'], ['Begone', 5, 'R10', 8, 14, 'vertical slide 3 (T2) or 5 (T3)']], '"Fallen knight", "rusted one". Extra action or maneuver per turn. Insect Breath (action, 1/turn): 5 cube within 1, enemies Agility RR: 20; 10; 0. Rise!: humans it kills rise as undead A in 1d6 rounds.', [['Insect Breath', 3, 'Day']], 4),
  C('Undead', 'Undead H', 'H', 25, 120, '7', 0, [3, 4, 5], 0, [['Spineswords', 5, 'M2/R5', 10, 19, 'damage: weakened'], ['Bites', 5, 'M1', 5, 10, '2 targets; crit vs Large or smaller: head removed']], '"Flayer of souls", "spinecruncher". Extra action or maneuver. Whirlwind (action, 1/turn): move speed, no opportunity attacks; each enemy within 2 at start, end, or during takes 1d10. Damned Shriek (maneuver, 1/turn): enemies within 5 Mind RR: prone and vulnerable; prone; none.', [['Whirlwind', 3, 'Day'], ['Damned Shriek', 2, 'Day']], 4)
];
REF.TYPE_NOTES = {
  'Animal': 'Rarely fight to the death; flee at 0 Stamina or when they get what they want. Predators give up on hard targets and traps. All animals can become pets.',
  'Human': 'All Medium, speed 5, 10 slots. Flee or surrender when outmatched; fight for a reason and stop when satisfied. A lone human at 0 Stamina flees; a group reduced by half flees (Ref\'s call).',
  'Blood Creature': 'Craelin\'s creations; exposed muscle, red. LIKES: 1+ gallon of animal or human blood, the scent of iron, dripping liquid. HATES: dry fleshless bones, containers of 1+ gallon of clean fresh water, soap. No darkness or dim light penalty.',
  'Undead': 'Ornassa\'s creations; hate the living; memories may make them falter. LIKES: reminders of those the source humans loved, corpses dead less than 24h, cold, the scent of wet earth. HATES: reminders of those they hated, the gods\' iconography, bonfire-size or larger fire, stained glass. No darkness or dim light penalty.',
  'Unique': 'One of a kind and sapient. No darkness or dim light penalty.'
};
REF.MONSTER_RULES = [
  'Monsters have no slots and die at 0 Stamina. Humans and animals have slots (backpack slots) and take wounds.',
  'Power 0-50 is the threat level: starting crows can\'t beat power 11+ head-on; groups of power 1+ are dangerous.',
  'One reaction unless stated. X/Rest features: X uses between rests; a crit regains 1 expended use.',
  'Monsters are named by letter (blood creature A); show players the art. LIKES: they investigate and interact if there\'s no danger. HATES: they hunt and destroy the source, prioritizing a crow wearing or carrying it.',
  'Suspicious like or hate in an odd or dangerous place: 2d10+M: approaches unsuspecting; investigates oddities first; withdraws nearby and prepares an ambush or gathers allies.',
  'Monsters flee losing fights (weak ones stay with the pack); dungeon monsters rarely pursue outside their territory; wanderers flee sooner; they often let crows flee after killing a human or pet big enough to eat.'
];

/* ------------------------------------------------------------------ Encounter tables
 * Entries: [lo, hi, text, adds] where adds = [[bestiary name, count or dice]].
 */
REF.DUNGEON_TABLES = {
  'Blood Creatures': { die: 6, rows: [
    [1, 1, '1d6 blood creature A', [['Blood Creature A', '1d6']]],
    [2, 2, '2d6 blood creature A', [['Blood Creature A', '2d6']]],
    [3, 3, '1 blood creature B', [['Blood Creature B', 1]]],
    [4, 4, '1d6 blood creature B', [['Blood Creature B', '1d6']]],
    [5, 5, '1 blood creature C', [['Blood Creature C', 1]]],
    [6, 6, '1 blood creature C + 1d6 blood creature A', [['Blood Creature C', 1], ['Blood Creature A', '1d6']]]
  ] },
  'Undead': { die: 10, note: 'The book labels this table d6 but it has 10 rows; roll a d10.', rows: [
    [1, 1, '1d6 undead A', [['Undead A', '1d6']]],
    [2, 2, '1d6 undead A + 1 undead B', [['Undead A', '1d6'], ['Undead B', 1]]],
    [3, 3, '1d6 undead B', [['Undead B', '1d6']]],
    [4, 4, '2d6 undead A', [['Undead A', '2d6']]],
    [5, 5, '1d6 undead A + 1d6 undead B', [['Undead A', '1d6'], ['Undead B', '1d6']]],
    [6, 6, '1 undead C', [['Undead C', 1]]],
    [7, 7, '2 undead C', [['Undead C', 2]]],
    [8, 8, '1 undead D', [['Undead D', 1]]],
    [9, 9, '1 undead E', [['Undead E', 1]]],
    [10, 10, '1 undead F', [['Undead F', 1]]]
  ] }
};
REF.ANY_MONSTER = [[1, 2, 'Angel (no table in the playtest: Ref\'s choice)', null], [3, 4, 'Blood creatures', 'Blood Creatures'], [5, 6, 'Demon (no table in the playtest: Ref\'s choice)', null], [7, 8, 'Plant (no table in the playtest: Ref\'s choice)', null], [9, 10, 'Undead', 'Undead']];

REF.TRAVEL_ENCOUNTERS = [
  [1, 20, 'Any Monster'], [21, 25, 'Bad Weather'], [26, 30, 'Merchant'], [31, 50, 'Miasma-Touched'],
  [51, 70, 'Monster from Nearby'], [71, 75, 'Strong Miasma'], [76, 80, 'Traveler'], [81, 100, 'Wild Animal']
];

REF.WEATHER_BY_CLIMATE = {
  'Cold / Winter': ['Blizzard', 'Cold Snap'], 'Desert': ['Heat Wave', 'Sandstorm'],
  'Fall & Spring': ['Rain', 'Thunderstorm'], 'Tropical / Summer': ['Heat Wave', 'Thunderstorm']
};
REF.WEATHER = {
  'Blizzard': { hex: -2, txt: '-2 hexes. Each hour outside without cold weather gear, each human makes a Strength RR: 4d6 P; 3d6 P; 2d6 P, with a cumulative -2 per previous such RR until they get gear or shelter or the weather changes. Guides, scouts, and trackers: double bane on role tests.' },
  'Cold Snap': { hex: 0, txt: 'Hourly Strength RR without cold weather gear: 3d6 P; 2d6 P; 1d6 P, with the same cumulative -2.' },
  'Heat Wave': { hex: 0, txt: 'Each creature traveling more than 2 hexes a day makes a Strength RR: 2d6 P; 1d6 P; none.' },
  'Rain': { hex: -1, txt: '-1 hex. Each ration carrier makes a Mind test: lose 1d6+1 rations to mold; lose 1; none.' },
  'Sandstorm': { hex: -2, txt: '-2 hexes. Guides, scouts, and trackers: double bane on role tests.' },
  'Thunderstorm': { hex: -2, txt: '-2 hexes. Each ration carrier makes a Mind test: lose 2d6; 1d6; none. Guides, scouts, and trackers: bane on role tests.' }
};

REF.MERCHANT_SALES = [
  [1, 10, 'Alchemist 1st level'], [11, 15, 'Alchemist 2nd level'], [16, 18, 'Alchemist 3rd level'], [19, 20, 'Alchemist 4th level'],
  [21, 30, 'Blacksmith 1st level'], [31, 35, 'Blacksmith 2nd level'], [36, 38, 'Blacksmith 3rd level'], [39, 40, 'Blacksmith 4th level'],
  [41, 50, 'Bookseller 1st level'], [51, 55, 'Bookseller 2nd level'], [56, 58, 'Bookseller 3rd level'], [59, 60, 'Bookseller 4th level'],
  [61, 70, 'Enchanter 1st level'], [71, 75, 'Enchanter 2nd level'], [76, 78, 'Enchanter 3rd level'], [79, 80, 'Enchanter 4th level'],
  [81, 90, 'General Store 1st level'], [91, 95, 'General Store 2nd level'], [96, 98, 'General Store 3rd level'],
  [99, 100, 'Roll again until you get two different institutions in a row: the caravan acts as both']
];
REF.MERCHANT_NPC = { 'Alchemist': 'Alchemist', 'Blacksmith': 'Blacksmith', 'Bookseller': 'Sage (P6)', 'Enchanter': 'Enchanter', 'General Store': 'Commoner' };
REF.MERCHANT_GUARDS = ['Archer (P4)', 'Archer (P7)', 'Archer (P10)', 'Elementalist', 'Pike Warrior (P4)', 'Pike Warrior (P7)', 'Pike Warrior (P10)', 'Sword Warrior (P4)', 'Sword Warrior (P7)', 'Sword Warrior (P10)'];

/* d100 human stat blocks, 4% steps (index = floor((d100-1)/4)). */
REF.HUMANS_MIASMA = ['Alchemist', 'Archer (P4)', 'Archer (P7)', 'Archer (P10)', 'Blacksmith', 'Conjurer', 'Cultist', 'Elementalist', 'Enchanter', 'Guide', 'Illusionist', 'Priest', 'Sage (P3)', 'Sage (P6)', 'Thief (P3)', 'Thief (P6)', 'Thief (P9)', 'Transmuter', 'Trapper', 'Pike Warrior (P4)', 'Pike Warrior (P7)', 'Pike Warrior (P10)', 'Sword Warrior (P4)', 'Sword Warrior (P7)', 'Sword Warrior (P10)'];
REF.HUMANS_TRAVELER = ['Alchemist', 'Archer (P4)', 'Archer (P7)', 'Archer (P10)', 'Blacksmith', 'Commoner', 'Conjurer', 'Elementalist', 'Enchanter', 'Guide', 'Illusionist', 'Priest', 'Sage (P3)', 'Sage (P6)', 'Thief (P3)', 'Thief (P6)', 'Thief (P9)', 'Transmuter', 'Trapper', 'Pike Warrior (P4)', 'Pike Warrior (P7)', 'Pike Warrior (P10)', 'Sword Warrior (P4)', 'Sword Warrior (P7)', 'Sword Warrior (P10)'];

REF.MIASMA_TOUCHED = [
  [1, 10, 'Bandits: demand 10d10 x 10 gc of goods; attack only if refused and they have the advantage.'],
  [11, 14, 'Cannibals: ambush if they outnumber the crows; otherwise pose as travelers and strike while the crows sleep. One crow to eat is a win.'],
  [15, 18, 'Competitive: propose a contest and a wager (winner takes any item from the loser; negotiable). Attack if refused or if the winners gloat.'],
  [19, 22, 'Cruel: 50%: torturing a captive creature; otherwise feign friendship to kidnap a crow.'],
  [23, 32, 'Cultists of a Necromancer: trade anything or favors for necromancy spellbooks and spellbooks; proselytize; attack thieves and blasphemers.'],
  [33, 36, 'Death to the Gods: hate religion; ambush crows who disagree or show religious items. If agreed with, may help, but won\'t enter town.'],
  [37, 40, 'Deceitful: tell false tales to lure the crows into traps. Accused: attack if they can win, else joke and flee.'],
  [41, 44, 'Despondent: defend only; lash out at anyone who comforts them.'],
  [45, 48, 'Destructive: bait a fight. If the crows redirect their anger at something nearby, they go destroy it; else fight to kill or maim, then flee.'],
  [49, 52, 'False Bravado: invite the crows to raid a monster den and split the loot; flee when the fighting starts.'],
  [53, 56, 'Greedy: want food, shelter, supplies, treasure. Beggars if outmatched, bandits if the crows look weak.'],
  [57, 60, 'Knowledge Seeker: question the crows until gifted a lore book, the day ends (travel cut short), or the crows leave; then attack to kidnap the most knowledgeable for days of lectures.'],
  [61, 64, 'Mage Hunter: ambush crows carrying spellbooks; otherwise ask about mages. Kill mages, take books.'],
  [65, 68, 'Monster Hatred: recruit the crows against a nearby monster type; charge in recklessly.'],
  [69, 72, 'Monster Obsessed: lure the crows to their beloved monsters\' lair, rigged with bear traps; watch them eat.'],
  [73, 76, 'Sluggish: aimless. If taken along they slow the group to 1 hex a day; leave at a village. If abandoned after agreeing, ambush at the next outdoor encounter.'],
  [77, 80, 'Suspicious: friendly, then suspicious. Flee and fortify if the crows are stronger; else follow and ambush the camp.'],
  [81, 84, 'Thieves: befriend the crows, steal the most valuable items, flee.'],
  [85, 88, 'Tyrant: followers of a tyrant demanding fealty. Refusers are captured and killed; oath-takers are blessed and invited to join or found a branch. Later the same group demands a progress report.'],
  [89, 92, 'Vain: value looks. Praise well-groomed crows; kidnap and bathe the filthy ones who refuse a bath.'],
  [93, 96, 'Violent: attack; stop if one crow agrees to die.'],
  [97, 100, 'Wicked Crows: join the crows on a dungeon trip, then use its horrors to kill them one by one.']
];

REF.TRAVELER_ENCOUNTERS = [
  [1, 1, 'Animal Hunt: hunting an animal from the habitat table. Help them for a reward.'],
  [2, 2, 'Battle against 2d6 Miasma-touched (1d6: 1-2 bandits, 3-4 cannibals, 5-6 cultists). Save them for a reward.'],
  [3, 3, 'Camping: friendly crows share their meal (no ration needed next rest); standoffish crows are asked to leave; refusing: they attack or flee.'],
  [4, 4, 'Crows (1d6): 1-2 invite a joint raid; 3-4 standoffish, but kindness earns lore on a nearby POI or dungeon; 5-6 rivals plan to kill the crows for their loot.'],
  [5, 5, 'Injured: one has 1d6 wounds and a bad leg. Heal them or give a mount or vehicle for a reward.'],
  [6, 6, 'Lost: spend a day guiding them for a reward.'],
  [7, 7, 'Need an escort to the nearest village, for a reward.'],
  [8, 8, 'Pursued by monsters (closest dungeon\'s table). If the crows intervene, the travelers flee, leaving their dead.'],
  [9, 9, 'Starving: give them 1d6 days of food for a reward.'],
  [10, 10, 'Treasure Hunt: seeking one specific item (e.g. a Major Interesting Thing). Help and hand it over for a reward.']
];
REF.TRAVELER_REWARDS = [
  [1, 1, 'Nothing'], [2, 2, 'Useful info on a nearby POI, dungeon, village, or treasure'], [3, 3, '1d6 x 100 gc'], [4, 4, '2d10 x 100 gc'],
  [5, 5, 'A Minor Interesting Thing'], [6, 6, 'A Major Interesting Thing']
];

function A(lo, hi, t, adds) { return [lo, hi, t, adds || null]; }
REF.HABITATS = {
  'Coastal': { die: 10, rows: [A(1, 1, '1 crocodile', [['Crocodile', 1]]), A(2, 2, '2 crocodiles', [['Crocodile', 2]]), A(3, 3, '1d6 giant crows', [['Giant Crow', '1d6']]), A(4, 4, '1 hawk', [['Hawk', 1]]), A(5, 5, '1 monitor lizard', [['Monitor Lizard', 1]]), A(6, 6, '2 monitor lizards', [['Monitor Lizard', 2]]), A(7, 7, '1 constrictor snake', [['Constrictor Snake', 1]]), A(8, 8, '1 venomous snake', [['Venomous Snake', 1]]), A(9, 9, '1 giant venomous snake', [['Giant Venomous Snake', 1]]), A(10, 10, '1 giant spider', [['Giant Spider', 1]])] },
  'Cold': { die: 10, rows: [A(1, 1, '1 bear', [['Bear', 1]]), A(2, 2, '2 bears', [['Bear', 2]]), A(3, 3, '1 cave bear', [['Cave Bear', 1]]), A(4, 4, '2 cave bears', [['Cave Bear', 2]]), A(5, 5, '2d6 deer', [['Deer', '2d6']]), A(6, 6, '1d6 oxen', [['Ox', '1d6']]), A(7, 7, '2d6 oxen', [['Ox', '2d6']]), A(8, 8, '1d6 wolves', [['Wolf', '1d6']]), A(9, 9, '1 dire wolf', [['Dire Wolf', 1]]), A(10, 10, '1 dire wolf + 1d6 wolves', [['Dire Wolf', 1], ['Wolf', '1d6']])] },
  'Desert': { die: 100, rows: [A(1, 7, 'big cat', [['Big Cat', 1]]), A(8, 13, '1d6 big cats', [['Big Cat', '1d6']]), A(14, 20, '2d6 dogs', [['Dog', '2d6']]), A(21, 27, 'elephant', [['Elephant', 1]]), A(28, 33, '2d6 elephants', [['Elephant', '2d6']]), A(34, 40, 'monitor lizard', [['Monitor Lizard', 1]]), A(41, 46, '2 monitor lizards', [['Monitor Lizard', 2]]), A(47, 53, 'giant scorpion', [['Giant Scorpion', 1]]), A(54, 59, '2 giant scorpions', [['Giant Scorpion', 2]]), A(60, 66, 'constrictor snake', [['Constrictor Snake', 1]]), A(67, 73, 'venomous snake', [['Venomous Snake', 1]]), A(74, 80, 'giant venomous snake', [['Giant Venomous Snake', 1]]), A(81, 87, '2d6 venomous snakes', [['Venomous Snake', '2d6']]), A(88, 94, 'giant spider', [['Giant Spider', 1]]), A(95, 100, '2 giant spiders', [['Giant Spider', 2]])] },
  'Forest': { die: 100, rows: [A(1, 5, 'ape', [['Ape', 1]]), A(6, 10, '1d6 apes', [['Ape', '1d6']]), A(11, 15, 'bear', [['Bear', 1]]), A(16, 20, '2 bears', [['Bear', 2]]), A(21, 25, 'big cat', [['Big Cat', 1]]), A(26, 30, 'wildcat', [['Wildcat', 1]]), A(31, 35, '1d6 giant crows', [['Giant Crow', '1d6']]), A(36, 40, '2d6 deer', [['Deer', '2d6']]), A(41, 45, '2d6 dogs', [['Dog', '2d6']]), A(46, 50, 'elephant', [['Elephant', 1]]), A(51, 55, '2d6 elephants', [['Elephant', '2d6']]), A(56, 60, 'hawk', [['Hawk', 1]]), A(61, 65, 'constrictor snake', [['Constrictor Snake', 1]]), A(66, 70, 'venomous snake', [['Venomous Snake', 1]]), A(71, 75, 'giant venomous snake', [['Giant Venomous Snake', 1]]), A(76, 80, 'giant venomous snake + 1d6 venomous snakes', [['Giant Venomous Snake', 1], ['Venomous Snake', '1d6']]), A(81, 85, 'giant spider', [['Giant Spider', 1]]), A(86, 90, '2 giant spiders', [['Giant Spider', 2]]), A(91, 95, '1d6 wolves', [['Wolf', '1d6']]), A(96, 100, 'dire wolf + 1d6 wolves', [['Dire Wolf', 1], ['Wolf', '1d6']])] },
  'Grassland': { die: 100, rows: [A(1, 5, 'bear', [['Bear', 1]]), A(6, 10, '2 bears', [['Bear', 2]]), A(11, 15, 'big cat', [['Big Cat', 1]]), A(16, 20, '1d6 big cats', [['Big Cat', '1d6']]), A(21, 25, 'wildcat', [['Wildcat', 1]]), A(26, 30, '1d6 deer', [['Deer', '1d6']]), A(31, 35, '2d6 deer', [['Deer', '2d6']]), A(36, 40, 'dog', [['Dog', 1]]), A(41, 45, '2d6 dogs', [['Dog', '2d6']]), A(46, 50, 'elephant', [['Elephant', 1]]), A(51, 55, '2d6 elephants', [['Elephant', '2d6']]), A(56, 60, 'hawk', [['Hawk', 1]]), A(61, 65, '2 hawks', [['Hawk', 2]]), A(66, 70, 'constrictor snake', [['Constrictor Snake', 1]]), A(71, 75, 'venomous snake', [['Venomous Snake', 1]]), A(76, 80, 'giant venomous snake', [['Giant Venomous Snake', 1]]), A(81, 85, 'giant venomous snake + 1d6 venomous snakes', [['Giant Venomous Snake', 1], ['Venomous Snake', '1d6']]), A(86, 90, '1d6 wolves', [['Wolf', '1d6']]), A(91, 95, 'dire wolf', [['Dire Wolf', 1]]), A(96, 100, 'dire wolf + 1d6 wolves', [['Dire Wolf', 1], ['Wolf', '1d6']])] },
  'Hill / Mountain': { die: 100, rows: [A(1, 5, 'bear', [['Bear', 1]]), A(6, 10, '2 bears', [['Bear', 2]]), A(11, 15, 'cave bear', [['Cave Bear', 1]]), A(16, 20, 'big cat', [['Big Cat', 1]]), A(21, 25, '1d6 big cats', [['Big Cat', '1d6']]), A(26, 30, 'wildcat', [['Wildcat', 1]]), A(31, 35, '1d6 deer', [['Deer', '1d6']]), A(36, 40, '2d6 deer', [['Deer', '2d6']]), A(41, 45, 'dog', [['Dog', 1]]), A(46, 50, '2d6 dogs', [['Dog', '2d6']]), A(51, 55, '2d6 goats', [['Goat', '2d6']]), A(56, 60, 'hawk', [['Hawk', 1]]), A(61, 65, 'giant scorpion', [['Giant Scorpion', 1]]), A(66, 70, 'constrictor snake', [['Constrictor Snake', 1]]), A(71, 75, 'venomous snake', [['Venomous Snake', 1]]), A(76, 80, 'giant venomous snake', [['Giant Venomous Snake', 1]]), A(81, 85, 'giant venomous snake + 1d6 venomous snakes', [['Giant Venomous Snake', 1], ['Venomous Snake', '1d6']]), A(86, 90, 'giant spider', [['Giant Spider', 1]]), A(91, 95, '1d6 wolves', [['Wolf', '1d6']]), A(96, 100, 'dire wolf + 1d6 wolves', [['Dire Wolf', 1], ['Wolf', '1d6']])] },
  'Marsh / Swamp': { die: 10, rows: [A(1, 1, 'bear', [['Bear', 1]]), A(2, 2, '1d6 crocodiles', [['Crocodile', '1d6']]), A(3, 3, '1d6 giant crows', [['Giant Crow', '1d6']]), A(4, 4, 'monitor lizard', [['Monitor Lizard', 1]]), A(5, 5, '2 monitor lizards', [['Monitor Lizard', 2]]), A(6, 6, 'constrictor snake', [['Constrictor Snake', 1]]), A(7, 7, 'venomous snake', [['Venomous Snake', 1]]), A(8, 8, 'giant venomous snake', [['Giant Venomous Snake', 1]]), A(9, 9, 'giant venomous snake + 1d6 venomous snakes', [['Giant Venomous Snake', 1], ['Venomous Snake', '1d6']]), A(10, 10, 'giant spider', [['Giant Spider', 1]])] }
};

REF.ANIMAL_REACTION = [
  [1, 5, 'Asleep: unconscious in the crows\' path; waking it makes it violent.'],
  [6, 10, 'Attached: fond of a random crow, follows them, fears the others.'],
  [11, 15, 'Curious: aggression frightens it; calm lets it investigate, then leave; sharing food makes it friendly.'],
  [16, 20, 'Embattled: fighting other animals, humans, or monsters; aid it and one becomes friendly.'],
  [21, 25, 'Friendly: follows for 1 hour; a crow may test to own it; meanness makes it flee.'],
  [26, 35, 'Frightened: freezes. Unless approached with utmost calm, flees if outmatched and there\'s an exit, else fights until the crows flee. Ref may allow a Mind test + Handle Pet to make it curious.'],
  [36, 45, 'Hungry: approaches when the crows eat; 1 ration makes it friendly; refused, it attacks to steal food.'],
  [46, 50, 'Injured: at half Stamina, frightened and cornered; healing makes it friendly.'],
  [51, 55, 'Playful: play makes it friendly; ignored, it turns violent.'],
  [56, 65, 'Protective: fights to the death. Any die even: nest of 1d10 young or eggs (each sellable to stables as a pet); odd: guards a Minor Interesting Thing.'],
  [66, 70, 'Stalking: follows hidden, pounces on 1-2 isolated crows.'],
  [71, 80, 'Starved: attacks unless given a day\'s food for its size, then eats and flees; carnivores may carry off a crow.'],
  [81, 90, 'Territorial: follows threateningly; stops when the crows leave the hex, else fights to the death.'],
  [91, 95, 'Treasure-Seeking: wants a shiny or food-like item a crow holds; refused, it attacks.'],
  [96, 100, 'Violent: ambushes.']
];

REF.STRONG_MIASMA = 'None if the crows spend the day only in beacon-protected hexes. Otherwise the Miasma strengthens for 24 hours: bane on Miasma RRs; the haze becomes opaque fog; guides, scouts, and trackers take a bane on role tests; a lost group (or one getting lost) is magically moved 1d10 hexes in a direction of the Ref\'s choice.';

REF.MINOR_THINGS = [
  [1, 1, 'Angel corpse'], [2, 2, 'Blood creature corpse'], [3, 3, 'Demon corpse'], [4, 4, 'Plant creature corpse'], [5, 5, 'Undead remains'],
  [6, 6, 'Map to a hidden POI'], [7, 7, 'Map to buried treasure'], [8, 9, 'Empty coin purse'], [10, 11, 'Ball bearings'], [12, 13, 'Caltrops'],
  [14, 15, '10 ft of chain'], [16, 17, 'Oil flask'], [18, 19, 'Net'], [20, 21, 'Quiver of arrows'], [22, 23, 'Case of crossbow bolts'],
  [24, 25, 'Soap'], [26, 27, 'Acid vial'], [28, 29, 'Poison vial'], [30, 30, 'IOU for 5d10 gc from a nearby villager'],
  [31, 32, 'Bashing weapon (Ref\'s choice)'], [33, 34, 'Bow (Ref\'s choice)'], [35, 36, 'Chopping weapon (Ref\'s choice)'], [37, 38, 'Slashing weapon (Ref\'s choice)'], [39, 40, 'Stabbing weapon (Ref\'s choice)'],
  [41, 41, 'Shield at 0 AD'], [42, 42, 'Gluepot'], [43, 44, 'Padlock'], [45, 45, 'Lockpick set'], [46, 46, 'Gem worth 10d10 gc (book lists it as 45-46)'],
  [47, 48, 'Lore book (Ref\'s choice of expertise)'], [49, 49, 'Light armor at 0 AD'], [50, 50, 'Smoke bomb'], [51, 51, 'Healing potion'],
  [52, 54, 'Surgical kit'], [55, 55, 'Speed potion'], [56, 57, 'Quiver of steel arrows (57 is missing in the book)'], [58, 58, 'Case of steel bolts'],
  [59, 59, 'Fine torch'], [60, 61, 'Art object worth 20d10 gc'], [62, 62, 'Medium armor at 0 AD'], [63, 63, 'Masterwork torch'],
  [64, 65, 'Strong acid vial'], [66, 67, 'Strong poison'], [68, 68, 'Fire bomb'], [69, 69, 'Rage potion'],
  [70, 70, 'R0 alteration spellbook (Ref\'s choice)'], [71, 71, 'R0 benefaction spellbook (Ref\'s choice)'], [72, 72, 'R0 conjuration spellbook (Ref\'s choice)'],
  [73, 73, 'R0 elemental spellbook (Ref\'s choice)'], [74, 74, 'R0 illusion spellbook (Ref\'s choice)'], [75, 75, 'R0 necromancy spellbook (Ref\'s choice)'],
  [76, 76, 'Bear trap'], [77, 77, 'Gem worth 1d6 x 100 gc'], [78, 78, 'Steel shield at 0 AD'], [79, 79, 'Yew bow'], [80, 80, 'Heavy armor at 0 AD'],
  [81, 81, 'Boom wand'], [82, 82, 'Fine block & tackle'], [83, 83, 'Fine ladder'], [84, 84, 'Fine spyglass'], [85, 85, 'Fine coin purse'],
  [86, 86, 'Fine rope'], [87, 87, 'Fine alchemist\'s tools'], [88, 88, 'Fine blacksmith\'s tools'], [89, 89, 'Fine enchanter\'s tools'], [90, 90, 'Plague mask'],
  [91, 91, 'Light bloodhide armor at 0 AD'], [92, 95, 'Steel weapon: 92 bashing, 93 chopping, 94 slashing, 95 stabbing'],
  [96, 96, 'Absorbing bow'], [97, 97, 'Absorbing melee weapon'], [98, 98, 'Vicious bow'], [99, 99, 'Vicious melee weapon'], [100, 100, 'Roll on Major Interesting Things']
];
REF.MAJOR_THINGS = [
  [1, 2, 'Roll on Minor Interesting Things'], [3, 4, 'Quiver of archmage obsidian arrows'], [5, 6, 'Case of archmage obsidian bolts'], [7, 8, 'Waterwalking light armor'],
  [9, 10, 'Archmage obsidian bar'], [11, 12, 'Steel medium armor at 0 AD'], [13, 14, 'Fine lockpick set'], [15, 16, 'Fine padlock'], [17, 18, 'Fine compass'],
  [19, 20, 'Fine lantern'], [21, 22, 'Fine lore book'], [23, 24, 'Masterwork block & tackle'], [25, 26, 'Masterwork alchemist\'s tools'], [27, 28, 'Masterwork blacksmith\'s tools'],
  [29, 30, 'Masterwork enchanter\'s tools'], [31, 32, 'Masterwork coin purse'], [33, 34, 'Masterwork rope'], [35, 36, 'Masterwork spyglass'], [37, 38, 'Cart'],
  [39, 40, 'Necromancer silver bar'], [41, 42, 'Demon\'s head shield'], [43, 44, 'Feather light armor'], [45, 46, 'Glow shield'], [47, 48, 'Glow light armor'],
  [49, 50, 'Luring shield'], [51, 52, 'Luring light armor'], [53, 54, 'Spell-storing shield'], [55, 56, 'Spell-storing light armor'], [57, 58, 'Impact bow'],
  [59, 60, 'Impact melee weapon'], [61, 62, 'Raging bow'], [63, 64, 'Raging melee weapon'], [65, 66, 'Defending bow'], [67, 68, 'Defending melee weapon'],
  [69, 70, 'Heavy steel armor at 0 AD'], [71, 72, 'Masterwork lockpick set'], [73, 74, 'Masterwork padlock'], [75, 76, 'Archmage willow log'], [77, 78, 'Archmage obsidian shield at 0 AD'],
  [79, 80, 'Masterwork compass'], [81, 82, 'Masterwork lantern'], [83, 84, 'Masterwork lore book'], [85, 86, 'Telepathic node light armor'], [87, 88, 'Exploding bow'],
  [89, 90, 'Exploding melee weapon'], [91, 92, 'Lightning bow'], [93, 94, 'Lightning melee weapon'], [95, 96, 'Poisoning bow'], [97, 98, 'Poisoning melee weapon'],
  [99, 100, 'Undead bone light armor'], [101, 999, 'Archmage obsidian weapon of the Ref\'s choice (temple Greed Exchange only)']
];

REF.BACKLASH = [
  [1, 2, 'Donkey head: you can only bray loudly (1 UD).'], [3, 4, 'Compelled to dance: speed -2, bane on climb, hide, sneak, swim (1 UD).'],
  [5, 6, 'A ghostly, indestructible accordion plays polka loudly and follows you until the end of the DT (no going unnoticed).'],
  [7, 8, 'Until the end of the DT, each time you speak roll a d10; on a 10, boom: each creature within 3 takes 1d6 (+1d6 if already suffering this).'],
  [9, 10, 'Fiery mood: if you don\'t harm a creature before the end of the DT, take 1d6 piercing (+1d6 if stacking).'],
  [11, 12, 'Cold until the end of the DT: speed -1; start a turn in or soaked with water: 1d6 piercing (stacking: a further -1 speed).'],
  [13, 14, 'Weakened.'], [15, 16, 'The next damage you take before the end of the DT is doubled.'], [17, 18, 'Vulnerable.'],
  [19, 20, 'The Ref picks a hand slot: drop that item; it\'s unusable until the end of the DT.'], [21, 22, 'The nearest 1d6 rations are destroyed.'],
  [23, 24, 'A boom heard within 100 squares; the curious come.'], [25, 26, 'You and all within 10 are pushed 1d6 squares in a random direction.'],
  [27, 28, 'Take 1d6 damage.'], [29, 30, 'Teleport 1d6 squares (Ref picks the direction).'],
  [31, 32, 'Shuffle your inventory cards, roll a d10, draw that many; the last card\'s item becomes a Ref-controlled goat until the goat dies.'],
  [33, 34, 'Same draw: that item teleports to a random creature within 20.'], [35, 36, 'Same draw: that item becomes a feather duster until the end of the DT.'],
  [37, 38, 'Goo: speed -2 until the end of the DT (stacks, -2 each).'], [39, 40, 'Noxious gas: bane on all tests (1 UD).'],
  [41, 42, 'The target\'s worst fears are shared: each ally within 10 of the target takes 1d6 piercing.'],
  [43, 44, 'Speak only in rhyming couplets or take 1d6 piercing (1 UD).'], [45, 46, 'Porcelain: take double non-piercing damage (1 UD).'],
  [47, 48, 'Glowing outline: you can\'t hide; attacks against you +2 (1 UD).'], [49, 50, 'Fire: you and all within 2 take 1d6.'],
  [51, 52, 'Demonic bees: you and all within 3 make a Strength RR: 6 damage + weakened; 3 damage; none.'],
  [53, 54, 'Tentacles: you and all within 3 take 1d6; you gain 3 special wounds (removed by an action with a bladed tool or weapon, no harm).'],
  [55, 56, 'Dirt falls: you and all within 2 make an Agility RR: 6 damage + prone; 3 damage; none.'], [57, 58, 'Summon 1d6 hostile blood creature A within 5.'],
  [59, 60, 'Prone, can\'t stand, crawl only (1 UD).'], [61, 62, 'Your hands become feet until the end of the DT: +2 speed; can\'t hold or manipulate.'],
  [63, 64, 'Quicksand within 1 of you (reroll if not on the ground). Each creature on it (and entering or starting a turn there, if not grappled) makes an Agility RR: grappled + 1d6 piercing at the end of each round; grappled until the end of its next turn; can move 2 squares.'],
  [65, 66, 'A one-way viewing portal near your enemy or rival lets them watch you until the end of the DT.'], [67, 68, 'Teleport up to 50 squares horizontally (Ref picks the direction).'],
  [69, 70, 'Take 1d6 damage and be encased in earth from the neck down, grappled; another creature\'s action frees you; 1d6 at the start of each round while grappled.'],
  [71, 72, 'A good spell targets the nearest enemy; a bad spell targets you (ignores range; Ref decides).'],
  [73, 74, 'At the start of each of your combat turns, roll any die; odd: vomit slugs and lose the turn (1 UD).'], [75, 76, '1d6 x 100 coins, or a gem or mundane treasure, melts (Ref\'s choice).'],
  [77, 78, 'Frog: Tiny, Stamina max 1, 0 slots, lose your expertises, climb and swim speed = speed, Jump +2 (1 UD).'],
  [79, 80, 'Card draw: that item is teleported to a dungeon of the Ref\'s choice.'], [81, 82, 'Mouth and ears sealed until you rest (can\'t speak or hear).'],
  [83, 84, 'You treat bright light as darkness (2 UD).'], [85, 86, 'A cloud of stinging insects: you can\'t rest until you feed it 1,000 lb of flesh.'],
  [87, 88, 'Strength -1 until you rest (cumulative).'], [89, 90, 'Agility -1 until you rest (cumulative).'], [91, 92, 'Mind -1 until you rest (cumulative).'],
  [93, 94, 'Gain 1d6 wounds.'], [95, 96, 'Lightning: you and all within 5 take 3d6.'],
  [97, 98, 'Magic allergy: 1d6 piercing whenever anyone within 10 activates a magic item or casts (2 UD).'],
  [99, 100, 'Your castings are 1 tier lower; tier 1 becomes a doom (2 UD).'], [101, 101, 'Permanent regrowing antlers (no unmodified headgear).'],
  [102, 102, 'The Ref swaps all uses of one of your expertises to one you lack.'], [103, 103, 'A hand permanently becomes a random mundane one-handed weapon (that hand slot is otherwise unusable).'],
  [104, 104, 'Stamina 0 and 2d6 wounds.'], [105, 999, 'Sucked into Hell forever (dead).']
];
REF.BACKLASH_RULES = 'Backlash replaces the spell (still roll the book\'s UD). It happens on a doom casting, or on a chaos roll: a non-doom tier 1 casting rolls 1d6, and a 1 is a backlash. The Ref rolls d100 + the spell\'s rank. If a backlash needs a creature and the target was an object, the caster is the target. A duplicate ongoing-duration backlash (not conditions) is rerolled unless it stacks. Backlash UD are rolled at the end of each DT.';

REF.MIASMA_EFFECTS = [
  [1, 2, 'Despondent: speak only when spoken to, one-word answers, until you leave the Miasma.', 'Edge on sneak and hide.'],
  [3, 4, 'Ravenous: must eat 2 rations per rest for rest benefits while in the Miasma.', '+2 on forage tests.'],
  [5, 6, 'Rage: the Ref destroys 1 random mundane backpack item.', 'Regain 3 Stamina, or lose 1 wound if at full Stamina.'],
  [7, 8, 'Deceitful: only lies while in the Miasma.', 'Gain an expertise you lack.'],
  [9, 10, 'Lazy: refuse travel roles while in the Miasma.', 'Rests heal 2 wounds instead of 1.'],
  [11, 12, 'Relish violence: must pursue and fight foes until you can\'t sense them (lasts until you have no cruelty).', '+1 damage on weapon attacks.'],
  [13, 999, 'Lost to the Miasma: all other effects and cruelty end; immune to new effects; permanently cruel.', 'The crow becomes a Ref NPC.']
];
REF.MIASMA_RULES = 'Outdoors only (not indoor areas fully enclosed in stone or metal). Resting in the Miasma regains no expertise uses. After every rest in the Miasma, each human makes a 2d10+M RR, -1 per level of cruelty: T1 gain 1 cruelty and roll a Miasma Effect; T2 none; T3 remove all your cruelty OR improve another human\'s result (who rested with you) by 1 tier. Miasma Effect: roll 1d10 + cruelty and gain both effects of that row (the second lasts as long as the first); if you already have that pair, reroll. Lose all cruelty on finishing a rest with no Miasma.';

REF.VILLAGE_EVENTS = [
  [-99, -9, 'Monster attack destroys an institution.'],
  [-8, -8, 'Two institutions lose 1 level (if both are 1st level, one is destroyed).'],
  [-7, -7, 'Bandits: an institution loses 1 level (1st level: destroyed).'],
  [-6, -6, 'Prosperity -1 (at -10: an institution is destroyed).'],
  [-5, -5, 'The villagers blame the crows: no business with them until the crows found a new institution.'],
  [-4, -4, 'A crow\'s quarters are vandalized: a mundane item is destroyed.'],
  [-3, -3, 'Sale percentage -5%.'],
  [-2, -2, 'An institution\'s steward is murdered: it\'s closed next cycle (not a retired crow).'],
  [-1, -1, 'An artisan is vandalized: no crafting or tool/material sales next cycle.'],
  [0, 0, 'A merchant is robbed: -3 levels this cycle (0 = closed).'],
  [1, 2, 'A merchant is -1 level this cycle.'],
  [3, 4, 'A merchant has low supplies: 30% chance any item is out of stock.'],
  [5, 6, 'A merchant has low supplies (30% chance an item is out of stock), but its buy percentage is +5%.'],
  [7, 8, 'A merchant is +1 level.'],
  [9, 10, 'Each crow gets 6 rations for the next outing.'],
  [11, 11, 'A merchant is +2 levels.'],
  [12, 12, 'A merchant gives each crow a 100 gc credit (expires at the end of the cycle).'],
  [13, 13, 'An artisan makes 2 crafting rolls a day for each item next cycle.'],
  [14, 14, 'Each crow gets a healing potion.'],
  [15, 15, 'Sale percentage +5%.'],
  [16, 16, 'Festival: each merchant +1 level.'],
  [17, 17, 'Prosperity +1 (at 10: +10% sale percentage next cycle).'],
  [18, 18, 'A merchant gives a 500 gc credit.'],
  [19, 19, 'An institution below 5th level gains +1 level.'],
  [20, 999, 'The villagers found the institution the crows suggest.']
];
REF.SALE_PCT = [[-10, -10, 30], [-9, -6, 40], [-5, -2, 45], [-1, 1, 50], [2, 5, 55], [6, 9, 60], [10, 10, 70]];

/* Institutions: founding price, level-up prices (index 0 = price to reach level 2), merchant/artisan roles, rules text. */
REF.INSTITUTIONS = {
  'Alchemist': { found: 3000, up: [1500, 3000, 6000], roles: 'artisan, merchant', txt: 'Artisan: crafts alchemy items from your materials, bonus = level. Merchant: buys/sells alchemy items needing up to (level) Alchemy uses; standard/fine/MW alchemist\'s tools. Identify an alchemy item: 10 gc. Workshop 5 gc/day: +level to your alchemy crafting rolls. L4 & Prosperity 10: the first purchase each cycle comes with a free healing potion.' },
  'Auction House': { found: 2000, up: [500, 1000, 2000, 4000], roles: 'merchant', txt: 'Buys/sells any valued item including gems and art. Availability % (valued/unique): L1 15/5, L2 20/10, L3 25/15, L4 30/20, L5 35/25. Cost: roll any die: even, discount 1d6 x 10%; odd, +1d6 x 10%. Unique items only if the Ref allows: 2d10 x 1,000 gc (1d10 x 100 if it can become useless). Sell anything: 1d10 x (10 + Prosperity)% of value; once committed you must sell; buy back at the sale price + 10% of value. L5 & Prosperity 10: once a cycle a sale under 80% becomes 80%.' },
  'Barracks': { found: 3000, up: [750, 1500, 3000, 6000], roles: '', txt: 'Hirelings up to max power: L1 2, L2 4, L3 6, L4 8, L5 10. L5 & Prosperity 10: hirelings come with 12 extra rations.' },
  'Beacon': { found: 4000, up: [1500, 3000, 6000, 12000], roles: '', txt: 'Its flame disperses the Miasma in the village hex + a radius of (level) hexes (L5 & Prosperity 10: 6). Humans there are unaffected even outdoors. Travel through the flame to any affected hex for up to 5 creatures: 100 gc per hex.' },
  'Blacksmith': { found: 3000, up: [1500, 3000, 6000], roles: 'artisan, merchant', txt: 'Artisan: blacksmithing items, bonus = level. Sells blacksmithing items by Blacksmithing uses and magic arms/armor by Enchanting uses: L1 1/-, L2 2/1, L3 3/2, L4 4/3, including barding. Buys/sells crafting materials; standard/fine/MW blacksmith\'s tools. Repair armor: 5 gc per suit or shield. Workshop 5 gc/day: +level to blacksmithing crafting. L4 & Prosperity 10: hone a non-unarmed weapon for 500 gc: +1 damage (no stacking) until a doom attack with it.' },
  'Bookseller': { found: 3000, up: [750, 1500, 3000, 6000, 12000], roles: 'merchant', txt: 'Spellbooks up to rank: L1 R0, L2 R1, L3 R2, L4 R3, L5 R4, L6 R5. Standard/fine/MW lore books. L6 & Prosperity 10: +1 UD on a spellbook for 250 gc (lasts until expended; doesn\'t return on rest; no stacking).' },
  'Crypt': { found: 2000, up: [500, 1000, 2000, 4000], roles: '', txt: 'Inter a dead crow\'s remains; their player picks a boon. Once per cycle a living crow praying there gains it (one boon per crow; one holder per boon; a new boon replaces the old; spending needs no action). L5 & Prosperity 10: counts as L6 for boons.' },
  'Enchanter': { found: 3000, up: [1500, 3000, 6000], roles: 'artisan, merchant', txt: 'Artisan: enchanting items and weapon/armor enchantments, bonus = level. Sells enchanting items and enchanted gear by Enchanting uses (L1 1, L2 2, L3 3, L4 4); standard/fine/MW enchanter\'s tools. Workshop 5 gc/day: +level. L4 & Prosperity 10: personal ward for 500 gc: +10 AD until removed by damage (no stacking).' },
  'General Store': { found: 1000, up: [1500, 3000], roles: 'merchant', txt: 'Buys/sells mundane non-weapon, non-armor gear by quality: L1 standard, L2 fine, L3 masterwork. Buys (doesn\'t sell) gems and art. L3 & Prosperity 10: buy 3 rations, oil, or torches (any quality), get 1 free.' },
  'Inn': { found: 1000, up: [250, 500, 1000, 2000], roles: 'merchant', txt: 'A night + a day\'s food: 5 gc (for travelers). Gambling rest activity, bet 1 gc up to a max of L1 15+P, L2 25+P, L3 35+P, L4 45+P, L5 60+P (P = Prosperity). Over/Under 7 (2d6; call over, under, or exactly 7; wrong loses; over/under right pays x2; exactly 7 right pays x4). Guess the Number (guess 1-6, Ref rolls a d6: right pays x5). L5 & Prosperity 10: once a cycle a traveling merchant sells any priced item at +25%.' },
  'Stables': { found: 2000, up: [750, 1500, 3000, 6000], roles: 'merchant', txt: 'Pets up to power L1 2, L2 4, L3 6, L4 8, L5 10; vehicles; vehicle repair 5 gc per Stamina; animal feed. L5 & Prosperity 10: buy 3 feed, get 1 free.' },
  'Temple': { found: 2000, up: [500, 1000, 2000, 4000], roles: 'artisan', txt: 'Artisan (Smith priests): alchemy, blacksmithing, and enchanting items and enchantments, bonus = level. Greed Exchange: put a magic item in the Three\'s chest; it\'s replaced by a Minor Interesting Things roll (item worth 1,000 gc or less) or Major (more than 1,000 gc); the Ref adds temple level + Prosperity to the roll. Heal Wounds: donate 100 gc (or an item) to remove wounds = level. Mount\'s Prayer: donate 100 gc: 1 pet gets +3 speed for (level) days. Prayer of Returning: retrieve an item you owned 24h+, lost no more than 5 x level days ago, not in another\'s possession: 50% of its value (unique: 1d10 x 1,000 gc or an item of equal value). L5 & Prosperity 10: counts as L6.' }
};
REF.STARTING_INSTITUTIONS = ['Blacksmith', 'Crypt', 'General Store', 'Inn', 'Temple'];
REF.CRYPT_BOONS = [
  ['Cooperation', 'When you assist: +2 x crypt level extra.'], ['Disappearance', 'Invisible for (level) rounds.'], ['Escape', 'Teleport 3 x level squares.'],
  ['Flight', 'Fly speed = speed for (level) rounds.'], ['Fury', '+(level)d6 damage on an attack.'],
  ['Greed', 'In a dungeon: learn the direction and how many chambers away the (level) most valuable treasures on your dungeon level are, most valuable first.'],
  ['Knowledge', 'Ask the Ref (level) questions about a named, known subject; honest answers.'], ['Rescue', 'After an RR, +1 tier; (level) uses.'],
  ['Swiftness', 'Speed +level until the end of the DT.'], ['Vitality', 'When you regain Stamina, regain +2 x level more.']
];
REF.GADWICK = { name: 'Gadwick', prosperity: 0, note: 'In Castle Gadwick\'s towers, dungeon, and crypts.', inst: [
  ['Alchemist', 1, 'Brune'], ['Auction House', 1, 'Lili'], ['Barracks', 2, 'Cormal'], ['Blacksmith', 2, 'Deirdre'], ['Bookseller', 1, 'Rion'],
  ['Enchanter', 1, 'Isaac'], ['General Store', 3, 'Sorcha'], ['Stables', 3, 'Anna'], ['Temple', 1, 'Mackle'], ['Inn', 1, 'Duna'], ['Crypt', 1, 'Oda']
], boons: [['Greed', 1], ['Rescue', 1], ['Vitality', 1]] };

/* Sample locations from the Dungeons book (details are in the Rules tab). */
REF.SAMPLE_PLACES = [
  { name: 'Ruined Tower', kind: 'POI', en: 7, table: 'Travel', notes: 'Collapsed mage\'s tower + dry well. Searching rubble: encounter check EN 7. A search finds a Minor Interesting Thing (max 3). Well: crow skeleton with shovel; digging finds a coin purse, 94 gc.' },
  { name: 'Ruined Windmill', kind: 'POI', en: 7, table: 'Travel', notes: 'Cellar: sleeping undead C, 54 gc + Major Interesting Thing. Floor 2 collapses under 2+ Medium creatures. Steel knife atop the spinning shaft.' },
  { name: 'Blood Library', kind: 'Dungeon', en: 9, table: 'Blood Creatures', notes: 'Craelin\'s alteration library. EN 9; 8 if any crow is bloodstained; 7 if half or more. Ring Collector (Namlin) in the prison crystal (area 4).' },
  { name: 'Floating Manor', kind: 'Dungeon', en: 9, table: 'Undead', notes: 'Wolverly Manor in the Wist Weald. EN 9 (8 if the check happens during combat anywhere but area 15). Lisbeth in the kitchen; Horace (undead G) in the crypt.' }
];

/* Overland travel. */
REF.PACES = { Slow: { hex: 1, en: 8, note: 'edge on role tests' }, Normal: { hex: 2, en: 7, note: '' }, Fast: { hex: 3, en: 6, note: 'bane on role tests' } };
REF.TRAVEL_ROLES = [
  ['Supporter', 'Fight the Miasma', '2d10+M', 'none', 'up to 4 creatures (incl. you): edge on today\'s Miasma RR', 'double edge'],
  ['Supporter', 'Make Camp', '2d10+S', 'none', 'choose rest EN +1 or +2 on crafting rolls at camp this rest', 'EN +2 or +4'],
  ['Supporter', 'Support Everyone (up to 4 allies in roles)', '2d10+M or S', '-1 to their role tests today', '+1', '+2'],
  ['Guide', 'Follow Normal Route', '2d10+M', 'choose -1 hex or travel EN -1', 'none', 'choose +1 hex or travel EN +1'],
  ['Guide', 'Follow Safe Route', '2d10+M', 'lost', 'travel EN +1 but -1 hex', 'travel EN +2'],
  ['Guide', 'Follow Shortcut', '2d10+M', 'lost', '+1 hex but travel EN -1', '+2 hexes'],
  ['Guide', 'Back on Track (start of day, instead of normal task)', '2d10+M', 'still lost', 'found position; travel normally', 'as T2 + choose +1 hex or travel EN +1'],
  ['Scout', 'Scout for Danger', '2d10+A or M', 'none', 'travel EN +1', 'travel EN +2'],
  ['Scout', 'Scout for Shelter', '2d10+M', 'none', 'rest EN +1', 'rest EN +2'],
  ['Scout', 'Treasure Hunt', '2d10+S', 'none', 'Ref rolls Minor Interesting Things', 'Ref rolls Major Interesting Things'],
  ['Tracker', 'Forage', '2d10+M', 'none', '1 ration', '1d6+1 rations'],
  ['Tracker', 'Hunt', '2d10+A', 'travel EN -1', 'none', '3d6 rations + 1d6 animal parts'],
  ['Tracker', 'Track Specific Creature', '2d10+M', 'travel EN -1', 'none', 'you meet it (Ref picks when and where)']
];
REF.DIRECTIONS = ['', 'North', 'Northeast', 'Southeast', 'South', 'Southwest', 'Northwest'];

REF.DISMEMBER = [[1, 2, 'Arm (attacker picks): drops held items, releases grabs by it, natural attacks using it -1 damage; no arms = no attacks or arm tasks.'], [3, 4, 'Leg: speed reduced proportionally; no legs = speed 0, can\'t stand.'], [5, 5, 'Attacker\'s choice of arm or leg.'], [6, 6, 'Head: dies.']];
REF.HARVEST = { 'Tiny': '1d6', 'Small': '1d6', 'Medium': '1d6', 'Large': '2d6', 'Huge': '3d6', 'Holy Shit': '4d6' };
REF.PET_PRICES = [5, 10, 50, 100, 500, 1000, 2500, 5000, 7500, 10000, 15000];

/* Quick reference cards for the Session tab. */
REF.QUICK = [
  ['Tests', '2d10 + characteristic. T1 11 or less (fail); T2 12-16 (partial / at a cost); T3 17+ (success). Natural 19-20 = crit (T3 + extra benefit; attacks: extra action). Natural 2-3 = doom (T1 + major setback). Edge +2, bane -2; double edge = +1 tier, double bane = -1 tier. Expertise use after a roll: +1 tier (not on a doom).'],
  ['When to test', 'Only when there\'s a real chance of failure and a consequence. Clever plans succeed. Warn players before certain-death actions; roll openly. No retries unless circumstances significantly change.'],
  ['Dungeon turns', '30 real minutes on a shared visible timer (options: 60 relaxed, 20 intense, or every 1d6 rooms). End of DT: roll usage dice, end blessed/vulnerable/weakened and DT effects, then encounter check. Outside dungeons, 2 in-game hours = 1 DT.'],
  ['Encounter checks', 'End of each DT and on loud acts: 1d10 >= EN. EN 9; 8 if crowded (20+ creatures on the level) or the crows left chaos; 7 if both. A 10: immediate. 9 or less: give a sign; it happens any time in the next DT.'],
  ['Greed bonus', 'First visit to a dungeon only: treasure found in DT 1 +30%, DT 2 +20%, DT 3 +10% value.'],
  ['Rest', '6 uninterrupted hours, 4+ asleep, eat 1 ration. Ends the DT without an encounter check; halfway through, DT effects end; new DT when it ends. Gains: all Stamina, -1 wound, all expertise uses (not in the Miasma). One rest activity each. Interrupted by combat: restart.'],
  ['Combat round', 'Each round a player rolls 1d10: 6+ crows and allies act first. Turn: maneuver + action, or 2 maneuvers. 1 reaction per round. Surprised: no turn in round 1, attacks against them +1.'],
  ['Damage', 'AD first, then Stamina; piercing skips AD. Crows (and humans, animals) at 0 AD and 0 Stamina take 1 wound per damage, each filling a backpack slot; all 10 wounded = dead. Ref creatures die at 0 Stamina (a crow may ask to knock out instead).'],
  ['XP', 'Recovered treasure outside a village: each crow gains total gc value / number of players. Applies after the next rest. Not for bought, crafted, stolen-from-innocents, or ally-owned items.']
];
