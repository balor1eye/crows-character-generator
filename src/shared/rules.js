/*
 * The Nest: rules shared by the Character Generator (Build and Play) and the Ref Screen (window.CrowsRules), so a
 * crow's sheet and the Ref's party entry for it count advancement and deal damage the same way.
 * Needs CROWS (src/game-data.js) and CrowsDice (src/shared/dice.js).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ advancement
  /* Expertise & Stamina bonuses earned at this total XP (the table, then one every 30,000 from 60,000). */
  function esBonusCount(txp) {
    var n = 0;
    CROWS.ES_ADV.forEach(function (r) { if (txp >= r[0]) n++; });
    if (txp >= 60000) n += Math.floor((txp - 30000) / 30000);
    return n;
  }
  /* The most uses each expertise can have at this total XP. */
  function maxUses(txp) {
    var m = 2;
    CROWS.ES_ADV.forEach(function (r) { if (txp >= r[0]) m = r[1]; });
    return m;
  }
  /* Characteristic bonuses earned at this total XP. */
  function charBonusCount(txp) {
    var n = 0;
    CROWS.CHAR_ADV.forEach(function (t) { if (txp >= t) n++; });
    if (txp >= 60000) n += Math.floor((txp - 30000) / 30000);
    return n;
  }
  /* The total XP of the next Expertise & Stamina bonus (es) and characteristic bonus (ch). */
  function nextBonusAt(txp) {
    var es = null, ch = null;
    CROWS.ES_ADV.forEach(function (r) { if (es === null && r[0] > txp) es = r[0]; });
    if (es === null) es = 30000 * (Math.floor(txp / 30000) + 1);
    CROWS.CHAR_ADV.forEach(function (t) { if (ch === null && t > txp) ch = t; });
    if (ch === null) ch = 30000 * (Math.floor(txp / 30000) + 1);
    return { es: es, ch: ch };
  }

  // ------------------------------------------------------------------ conditions and damage
  /* Conditions that end at the end of a dungeon turn (and halfway through a rest). */
  var DT_CONDITIONS = ['Blessed', 'Vulnerable', 'Weakened'];

  /*
   * Damage, the way the rules deal it: vulnerable adds 1d6, then worn armor, shields, and parry weapons absorb it in
   * order (unless it's piercing), then Stamina, then wounds, one per point left, as far as there's room.
   * o: { amount, vulnerable, vul (a 1d6 already rolled, so a replay deals the same), piercing, ad: [AD left on each
   * absorber, in order], stamina, woundRoom }.
   * Returns { total, vul (the roll, or 0), absorbed: [per absorber], stamina: Stamina lost, wounds: wounds taken }.
   */
  function damage(o) {
    var vul = o.vulnerable ? (typeof o.vul === 'number' ? o.vul : CrowsDice.d(6)) : 0, total = (o.amount || 0) + vul, left = total;
    var absorbed = (o.ad || []).map(function (ad) {
      var a = o.piercing ? 0 : Math.max(0, Math.min(left, ad || 0));
      left -= a;
      return a;
    });
    var st = Math.max(0, Math.min(left, o.stamina || 0)); left -= st;
    var w = Math.max(0, Math.min(left, o.woundRoom || 0));
    return { total: total, vul: vul, absorbed: absorbed, stamina: st, wounds: w };
  }

  window.CrowsRules = { esBonusCount: esBonusCount, maxUses: maxUses, charBonusCount: charBonusCount, nextBonusAt: nextBonusAt,
    DT_CONDITIONS: DT_CONDITIONS, damage: damage };
})();
