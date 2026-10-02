/*
 * Shared sheet operations: applyRefChange(p, o) modifies a character/party-entry object directly.
 * Called by both the Play page's refChange (simple ops) and the Ref screen's applyOp (party entry).
 * Complex ops (hit, restore, rest) need the player's full sheet context and stay in the iframe.
 *
 * Operations handled here:
 *   o.full: back to max Stamina
 *   o.st: Stamina +/- (positive or negative number)
 *   o.wounds: wound change (+ = more, - = heal)
 *   o.cruelty: cruelty +/-
 *   o.setCruelty: set cruelty to a specific value
 *   o.cond: conditions object { ConditionName: true/false }
 *   o.xp: pending XP (+number)
 *   o.apply: apply all pending XP into txp
 *   o.claims: XP claims answered (array of claim ids)
 *   o.endDT: end of dungeon turn n (set DT number on party entry)
 *   o.rest: party rest applied (reset st, heal 1 wound, apply XP if flag)
 */
(function () {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* Apply a refChange op on a character/party-entry object. Returns a message string or null. */
  function applyRefChange(p, o) {
    var msgs = [];
    if (typeof o === 'undefined' || o === null) return null;

    // full: back to max Stamina
    if (o.full) { p.st = p.stMax; msgs.push('Back to full Stamina.'); }

    // st: Stamina +/-
    if (o.st) {
      p.st = clamp((p.st || 0) + o.st, 0, p.stMax);
      var delta = o.st > 0 ? '+' + o.st : '' + o.st;
      msgs.push('Stamina ' + delta + ' (' + p.st + '/' + p.stMax + ').');
    }

    // wounds: +/-
    if (o.wounds) {
      p.wounds = clamp((p.wounds || 0) + o.wounds, 0, 10);
      if (o.wounds > 0) msgs.push('Wounds ' + p.wounds + '/10.');
      else msgs.push('Healed ' + Math.abs(o.wounds) + ' wound(s).');
    }

    // cruelty: +/-
    if (o.cruelty) {
      p.cruelty = Math.max(0, (p.cruelty || 0) + o.cruelty);
      msgs.push('Cruelty ' + p.cruelty + '.');
    }

    // setCruelty: absolute value
    if (typeof o.setCruelty === 'number') {
      p.cruelty = Math.max(0, o.setCruelty);
      msgs.push('Cruelty set to ' + p.cruelty + '.');
    }

    // ad: AD change (armor damage)
    if (o.ad) {
      p.ad = Math.max(0, (p.ad || 0) + o.ad);
      p.adMax = Math.max(p.adMax || p.ad, p.ad);
      msgs.push('AD ' + p.ad + '/' + p.adMax + '.');
    }

    // conditions: set or clear
    if (o.cond) {
      p.conds = p.conds || {};
      Object.keys(o.cond).forEach(function (k) {
        if (o.cond[k]) p.conds[k] = true;
        else delete p.conds[k];
      });
      msgs.push('Conditions updated.');
    }

    // XP: add pending
    if (o.xp) {
      p.pending = (p.pending || 0) + o.xp;
      msgs.push('+' + o.xp + ' pending XP.');
    }

    // apply: pending XP into txp
    if (o.apply) {
      p.txp = (p.txp || 0) + (p.pending || 0);
      p.pending = 0;
      msgs.push('Pending XP applied to TXP.');
    }

    // claims: XP claims answered (filter them out)
    if (o.claims && Array.isArray(o.claims) && p.claims) {
      p.claims = p.claims.filter(function (c) { return o.claims.indexOf(c.id) < 0; });
      if (!o.xp) msgs.push('XP claim answered without award.');
    }

    // endDT: record the dungeon turn number
    if (o.endDT) { p.dt = o.endDT; }

    // rest: party rest (reset Stamina, heal 1 wound, optionally apply XP)
    if (o.rest) {
      p.st = p.stMax;
      p.wounds = Math.max(0, (p.wounds || 0) - 1);
      if (o.rest.xp) {
        p.txp = (p.txp || 0) + (p.pending || 0);
        p.pending = 0;
      }
      msgs.push('Rest applied: full Stamina, healed 1 wound' + (o.rest.xp ? ', XP applied' : '') + '.');
    }

    return msgs.length ? msgs.join(' ') : null;
  }

  window.CrowsSheetOps = { applyRefChange: applyRefChange, clamp: clamp };
})();
