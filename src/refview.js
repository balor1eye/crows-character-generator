/*
 * Ref view of a player's shared character (Crows_Character_Generator.html?link=<n>, opened from the Ref Screen).
 *
 * The whole sheet is shown, Build and Play, but only the Play mode vitals (Stamina, AD, wounds, conditions,
 * cruelty, coins), equipment, and notes can be changed: every other control is disabled and clicks/keys/drags
 * on it are stopped before the app sees them. The server enforces the same rule (it applies only those fields
 * from a Ref), so this is about a clear UI, not trust.
 * The Ref's own character in this browser is left alone (app.js skips its local autosave here).
 *
 * &view=status is the condensed form the Ref Screen's Party tab embeds for each linked crow: just the Vitals
 * card, with the sheet's own buttons working on the whole character, live. It tells the Ref Screen its height.
 */
(function () {
  'use strict';
  if (!window.CrowsCloud || !window.CrowsCloud.linked) return;

  // What a Ref can use. Everything else in the page body is read-only.
  var EDITABLE = '#inventory, #tray, #card-detail, .add-item, #btn-arrange, #in-notes, #play-vitals, #ref-banner';
  var ALWAYS_OK = 'summary, details > summary, a[href]';   // expanding sections and following links is just reading
  var BLOCKED_EVENTS = ['click', 'dblclick', 'mousedown', 'pointerdown', 'touchstart', 'keydown', 'input', 'change', 'dragstart', 'drop', 'dragover'];

  var STATUS = /[?&]view=status(&|$)/.test(location.search);
  document.body.classList.add('ref-view', 'ref-loading');
  if (STATUS) document.body.classList.add('ref-status');

  var css = 'body.ref-view #btn-random,body.ref-view #btn-new,body.ref-view .actions .file-btn{display:none}' +
    'body.ref-loading .layout{visibility:hidden}' +
    '.ref-banner{max-width:1320px;margin:12px auto 0;padding:.6rem 16px}' +
    '.ref-banner p{margin:0;padding:.6rem .8rem;border-left:4px solid var(--sel);background:var(--card);border-radius:6px;font-size:.92rem}' +
    'body.ref-view .ref-locked{cursor:not-allowed}' +
    // The condensed status view: only the Vitals card, without its title, headings, or rules text.
    'html:has(body.ref-status){background:transparent}' +
    'body.ref-status{margin:0;padding:0;background:transparent;min-height:0}' +
    '.st-hide{display:none!important}' +
    '.st-path{display:block!important;margin:0!important;padding:0!important;max-width:none!important;border:0!important;background:transparent!important;box-shadow:none!important}' +
    'body.ref-loading #play-vitals{visibility:hidden}' +
    'body.ref-status #play-vitals{display:block;margin:0;padding:.2rem 0 .1rem;border:0;box-shadow:none;background:transparent}' +
    'body.ref-status #play-vitals>h2,body.ref-status #play-vitals h3,body.ref-status .info-toggle,body.ref-status #cond-info{display:none}' +
    'body.ref-status #play-vitals .conds,body.ref-status #play-vitals .dmg-row{margin:.45rem 0 0}' +
    'body.ref-status .vital-top{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:.4rem}' +
    'body.ref-status .vital-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:.4rem;margin-top:.4rem}' +
    'body.ref-status .vital{padding:.3rem .4rem}body.ref-status .vital .lbl{font-size:.6rem}' +
    'body.ref-status .vital .val b{font-size:1.15rem}body.ref-status .vital.big .val b{font-size:1.6rem}' +
    'body.ref-status .vital .fine{font-size:.65rem}body.ref-status .meter{margin:.2rem 0}' +
    'body.ref-status .pm-row{gap:3px;flex-wrap:wrap}body.ref-status .pm-row .btn{padding:.1rem .4rem;min-height:26px}' +
    'body.ref-status .pm-row input{width:3.2rem;min-width:0}' +
    'body.ref-status .conds .cond{min-height:26px;padding:.1rem .5rem}' +
    'body.ref-status .dmg-row{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .45rem}' +
    'body.ref-status .dmg-row .field{display:inline-flex;flex-direction:row;align-items:center;gap:.3rem;margin:0}' +
    'body.ref-status .dmg-row input[type=number]{width:3.6rem}body.ref-status .dmg-row .spacer{display:none}' +
    'body.ref-status .wound-grid{grid-template-columns:repeat(10,minmax(0,1fr));gap:3px;margin-top:.45rem}' +
    'body.ref-status .wslot{min-height:0;padding:1px 3px}body.ref-status .wslot .it{font-size:.6rem}body.ref-status .wslot .wk{font-size:.55rem}' +
    'body.ref-status .toast{bottom:4px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function inMain(n) { return n && n.closest && n.closest('.layout'); }
  function editable(n) { return n && n.closest && (n.closest(EDITABLE) || n.closest(ALWAYS_OK)); }

  BLOCKED_EVENTS.forEach(function (type) {
    document.addEventListener(type, function (e) {
      var t = e.target;
      if (!inMain(t) || editable(t)) return;
      if (type === 'keydown' && /^(Tab|Shift|Escape|Arrow|Page|Home|End)/.test(e.key)) return;   // moving around is fine
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  });

  // Grey out controls the Ref can't use. Re-run after every render (the app rebuilds parts of the page).
  var pending = false;
  function lock() {
    pending = false;
    var main = document.querySelector('.layout');
    if (!main) return;
    Array.prototype.forEach.call(main.querySelectorAll('input, select, textarea, button'), function (n) {
      if (editable(n)) return;
      if (!n.disabled) { n.disabled = true; n.classList.add('ref-locked'); }
    });
  }
  new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(lock); } })
    .observe(document.body, { childList: true, subtree: true });

  if (STATUS) {
    // Hide everything but the Vitals card (left in place, so the sheet's own styles still apply to it),
    // and keep the Ref Screen told of its height.
    var vit = document.getElementById('play-vitals');
    for (var n = vit; n.parentNode !== document.body; n = n.parentNode) {
      n.parentNode.classList.add('st-path');
      Array.prototype.forEach.call(n.parentNode.children, function (sib) { if (sib !== n) sib.classList.add('st-hide'); });
    }
    Array.prototype.forEach.call(document.body.children, function (sib) { if (sib !== n && sib.id !== 'toast' && sib.tagName !== 'SCRIPT') sib.classList.add('st-hide'); });
    document.body.classList.add('st-path');
    var sent = 0;
    var tell = function () {
      var h = Math.ceil(vit.getBoundingClientRect().height) + 2;
      if (h !== sent && window.parent !== window) { sent = h; window.parent.postMessage({ crowsStatus: true, h: h }, location.origin); }
    };
    if (window.ResizeObserver) new ResizeObserver(tell).observe(vit);
    window.addEventListener('load', tell);
  }

  window.CrowsRefView = {
    /* True in the condensed view embedded in the Ref Screen (&view=status). */
    status: STATUS,
    /* The character is loaded: show it with a banner saying what the Ref can do. */
    ready: function (name, owner) {
      if (STATUS) { document.body.classList.remove('ref-loading'); return; }
      var b = document.getElementById('ref-banner');
      if (!b) {
        b = document.createElement('div'); b.id = 'ref-banner'; b.className = 'ref-banner';
        var main = document.querySelector('.layout');
        main.parentNode.insertBefore(b, main);
      }
      b.innerHTML = '';
      var p = document.createElement('p');
      p.textContent = 'Ref view of ' + (name || 'this crow') + (owner ? ', played by ' + owner : '') + '. You can change the vitals (Play tab: Stamina, AD, wounds, ' +
        'conditions, cruelty, coins), equipment, and notes; the rest of the sheet is read-only. Changes save to the player’s character, and theirs show up here within a second or two.';
      b.appendChild(p);
      document.body.classList.remove('ref-loading');
      lock();
    }
  };
})();
