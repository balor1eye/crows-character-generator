/*
 * The Nest: dice and tests, shared by the Character Generator's Play mode and the Ref Screen (window.CrowsDice),
 * so a player's roll and the Ref's follow the same rules.
 */
(function () {
  'use strict';

  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function int(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }

  /* Roll "NdM", "NdM+K", "NdM x K" or a plain number: { total, detail }. */
  function rollDice(expr) {
    if (typeof expr === 'number') return { total: expr, detail: String(expr) };
    var m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*(?:[x*]\s*([\d,]+))?\s*$/i.exec(expr);
    if (!m) { var k = int(expr, 0); return { total: k, detail: String(k) }; }
    var n = Math.max(1, Math.min(100, int(m[1] || '1', 1))), s = int(m[2], 6), rolls = [], sum = 0;
    for (var i = 0; i < n; i++) { var r = d(s); rolls.push(r); sum += r; }
    if (m[3]) sum += (m[3] === '-' ? -1 : 1) * int(m[4], 0);
    if (m[5]) sum *= int(m[5].replace(/,/g, ''), 1);
    return { total: sum, detail: expr.replace(/\s+/g, '') + ' [' + rolls.join(', ') + ']' };
  }
  /* d100 from two d10s (00 = 100). */
  function d100() { var a = d(10), b = d(10), v = (a % 10) * 10 + (b % 10); if (v === 0) v = 100; return { total: v, detail: 'd100 [' + (a % 10) + ', ' + (b % 10) + ']' }; }

  /* Edges and banes cancel; at most two of either count. Returns -2..2. */
  function netEdges(edges, banes) { return Math.min(2, edges) - Math.min(2, banes); }
  function ebWord(net) { return net === 2 ? 'double edge' : net === 1 ? 'edge' : net === -1 ? 'bane' : net === -2 ? 'double bane' : ''; }
  /* 11 or lower: tier 1; 12-16: tier 2; 17+: tier 3. */
  function tierOf(total) { return total >= 17 ? 3 : total >= 12 ? 2 : 1; }
  /*
   * A test: 2d10 + mod, with net edges (-2..2): an edge is +2 and a bane -2; a double edge or bane moves the tier one step.
   * A natural critMin+ (19) is a crit (tier 3), a natural 2-3 a doom (tier 1). o: { critMin, dice: [a, b] to use, doom: true forces one }.
   * Returns { dice, nat, mod, bonus (the edge's +2 or bane's -2), net, total, tier, crit, doom }.
   */
  function test(mod, net, o) {
    o = o || {};
    var a = o.dice ? o.dice[0] : d(10), b = o.dice ? o.dice[1] : d(10), nat = a + b;
    var bonus = net === 1 ? 2 : net === -1 ? -2 : 0, total = nat + mod + bonus, tier = tierOf(total);
    if (net === 2) tier = Math.min(3, tier + 1);
    if (net === -2) tier = Math.max(1, tier - 1);
    var crit = nat >= (o.critMin || 19), doom = nat <= 3 || !!o.doom;
    if (crit) tier = 3;
    if (doom) tier = 1;
    return { dice: [a, b], nat: nat, mod: mod, bonus: bonus, net: net, total: total, tier: tier, crit: crit, doom: doom };
  }

  window.CrowsDice = { d: d, pick: pick, rollDice: rollDice, d100: d100, netEdges: netEdges, ebWord: ebWord, tierOf: tierOf, test: test };
})();
