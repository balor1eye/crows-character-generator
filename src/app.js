/*
 * Character Generator: window.CrowsApp (for Play mode and tests), account saving (src/cloud.js), and start-up. Loaded last.
 * See state.js.
 */
(function () {
  'use strict';
  var A = window.CrowsGen, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addItem = f('addItem'), checklist = f('checklist'), adMax = f('adMax'), adNow = f('adNow'), adopt = f('adopt'), allocTotal = f('allocTotal'), areaSize = f('areaSize'),
      armorInfo = f('armorInfo'), bg = f('bg'), bind = f('bind'), buildPdf = f('buildPdf'), cardById = f('cardById'),
      characteristics = f('characteristics'), clearSelection = f('clearSelection'), curStamina = f('curStamina'), expertiseUses = f('expertiseUses'),
      exportState = f('exportState'), extraBeltRule = f('extraBeltRule'), fieldValues = f('fieldValues'), handFits = f('handFits'), item = f('item'),
      load = f('load'), moveCard = f('moveCard'), moveToArea = f('moveToArea'), occupancy = f('occupancy'), ordinal = f('ordinal'),
      randomCrow = f('randomCrow'), refusal = f('refusal'), render = f('render'), save = f('save'), setBackground = f('setBackground'),
      spanOf = f('spanOf'), staminaMax = f('staminaMax'), takeItem = f('takeItem'), toast = f('toast'), traitXP = f('traitXP'),
      usePool = f('usePool'), validState = f('validState'), woundCount = f('woundCount');
  var $ = A.$, charBonusCount = A.charBonusCount, clone = A.clone, d = A.d, DIE = A.DIE, el = A.el, esBonusCount = A.esBonusCount, fmt = A.fmt,
      maxUses = A.maxUses, refView = A.refView, signed = A.signed;
  var state = A.state; A.share('state', function (v) { state = v; });

  var lastRemote = 0;   // when a change made elsewhere was last brought in

  // Expose a tiny API for testing/debugging.
  window.CrowsApp = {
    get state() { return state; }, fieldValues: function () { return fieldValues(); }, buildPdf: buildPdf,
    randomCrow: function () { randomCrow(); render(); }, setBackground: function (i) { setBackground(i, true); render(); },
    // Shared with play.js (Play mode).
    core: {
      invGrid: f('invGrid'), render: render, save: save, toast: toast, el: el, $: $, d: d, fmt: fmt, signed: signed, ordinal: ordinal, DIE: DIE,
      item: item, bg: bg, characteristics: characteristics, staminaMax: staminaMax, curStamina: curStamina,
      expertiseUses: expertiseUses, maxUses: maxUses, armorInfo: armorInfo, adMax: adMax, adNow: adNow,
      woundCount: woundCount, occupancy: occupancy, cardById: cardById, spanOf: spanOf, traitXP: traitXP,
      areaSize: areaSize, handFits: handFits, takeItem: takeItem, extraBeltRule: extraBeltRule, moveCard: moveCard, moveToArea: moveToArea, refusal: refusal, addItem: addItem,
      esBonusCount: esBonusCount, charBonusCount: charBonusCount, usePool: usePool, allocTotal: allocTotal, ownedTraitIds: f('ownedTraitIds')
    }
  };

  /*
   * The Finish crow button (right column, logged in only). A new character is saved to the account at once as a draft
   * (cloud.js) and autosaves from then on; Finish crow marks it ready to play. A finished crow just shows that it's saved.
   */
  function updateSaveBox(s) {
    var box = $('acct-save'), C = window.CrowsCloud;
    if (!box) return;
    if (refView || !C || !C.user) { box.hidden = true; return; }
    var draft = C.draft, saving = s === 'saving' || s === 'loading', open = checklist().filter(function (c) { return c[0] === 'err'; }).length;
    box.hidden = false; box.innerHTML = '';
    box.appendChild(el('button', { type: 'button', class: 'btn wide ' + (draft ? 'btn-primary' : 'btn-ghost'), disabled: saving || !draft || open > 0 || null,
      text: saving ? 'Saving\u2026' : draft ? 'Finish crow' : 'Saved \u2713', onclick: function () { C.finish(); } }));
    box.appendChild(el('p', { class: 'fine', text: s === 'error' ? 'Not saved yet: trying again. Your work is kept in this browser.'
      : s === 'conflict' ? 'Changed elsewhere: choose which version to keep.'
      : draft ? (open ? 'Draft: saved to your account. Fix the items marked \u2715 to finish it.' : 'Draft: saved to your account and not shown as ready yet. Press Finish crow when this crow is ready to play.')
      : s === 'saved' ? 'In your account. Changes save automatically.' : '' }));
  }

  /*
   * A short description of a change brought in from elsewhere (the Ref, or the player's other device): the new
   * session log entries, which say what happened (Lost 3 Stamina, 130 XP...), plus whatever else changed that
   * isn't logged. `before` is the sheet as it was here just before.
   */
  function describeChange(before) {
    if (!before) return '';
    var now = exportState(), seen = {}, msgs = [], other = [];
    function log(c) { return c.play && Array.isArray(c.play.log) ? c.play.log : []; }
    function differs(get) { try { return JSON.stringify(get(before)) !== JSON.stringify(get(now)); } catch (e) { return false; } }
    log(before).forEach(function (e) { seen[e.t + '|' + e.m] = true; });
    log(now).forEach(function (e) { if (!seen[e.t + '|' + e.m] && e.m) msgs.unshift(e.m); });   // oldest first
    [['equipment', function (c) { return c.inv; }], ['notes', function (c) { return c.notes; }],
     ['coins', function (c) { return c.coins; }], ['conditions', function (c) { return c.play && c.play.conds; }]]
      .concat(msgs.length ? [] : [['Stamina', function (c) { return c.play && c.play.stamina; }],
        ['wounds', function (c) { return c.play && c.play.wounds; }], ['cruelty', function (c) { return c.play && c.play.cruelty; }],
        ['XP', function (c) { return [c.txp, c.play && c.play.pendingXP]; }]])
      .forEach(function (f) { if (differs(f[1])) other.push(f[0]); });
    var text = msgs.slice(0, 2).join(' ') + (msgs.length > 2 ? ' (and ' + (msgs.length - 2) + ' more in the session log)' : '');
    if (other.length) text += (text ? ' ' : '') + other.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + ' changed.';
    return text;
  }

  /* On the accounts site, Start over, Save file, and Load file go behind a ⋯ More button in the header (offline they stay as buttons). */
  function moreMenu() {
    var menu = $('more-menu'), btn = $('more-btn');
    if (!menu || menu.classList.contains('collapsed')) return;
    menu.classList.add('collapsed');
    function open(on) { menu.classList.toggle('open', on); btn.setAttribute('aria-expanded', String(on)); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(!menu.classList.contains('open')); });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
    $('more-pop').addEventListener('click', function (e) { if (e.target.closest('button')) open(false); });
  }

  function init() {
    bind();
    var s = load();
    if (s) { adopt(s); } else { randomCrow(); }
    render();
    if (window.CrowsCloud) window.CrowsCloud.attach({
      kind: 'characters',
      onStatus: updateSaveBox,
      getData: exportState,
      valid: validState,
      apply: function (data) { clearSelection(); adopt(clone(data)); render(); },
      fresh: function () { clearSelection(); randomCrow(); render(); },
      name: function (c) { return c.name || 'Unnamed crow'; },
      summary: function (c) {
        var b = CROWS.BACKGROUNDS[c.bg];
        return [b ? b.name : '', c.txp ? fmt(c.txp) + ' XP' : '', c.player ? 'played by ' + c.player : ''].filter(Boolean).join(' · ');
      },
      onServer: function () { moreMenu(); if (window.CrowsPlay) window.CrowsPlay.syncAddress(); },
      onJoined: function (campaign) { if (window.CrowsPlay) window.CrowsPlay.joined(campaign); },
      onReady: function (p) {
        if (window.CrowsPlay && (p.mode === 'play' || p.mode === 'build')) window.CrowsPlay.setMode(p.mode);
        if (window.CrowsPlay) window.CrowsPlay.loadCampaign();
        if (window.CrowsRefView) window.CrowsRefView.ready(state.name, window.CrowsCloud.owner);
      },
      onRemote: function (before) {
        // Changes now arrive within a second or two: say what changed each time, or if that can't be told, just
        // that something did, once in a while.
        var t = Date.now(), what = describeChange(before);
        if (what || t - lastRemote > 30000) {
          toast((refView ? 'The player changed this character' : 'Changed by your Ref or on another device') + (what ? ': ' + what : '.'), what ? 6000 : 0);
        }
        lastRemote = t;
        if (window.CrowsRefView) window.CrowsRefView.ready(state.name, window.CrowsCloud.owner);
      }
    });
  }

  A.add({ moreMenu: moreMenu, updateSaveBox: updateSaveBox, describeChange: describeChange, init: init });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
