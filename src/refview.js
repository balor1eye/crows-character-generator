/*
 * Ref view of a player's shared character (Crows_Character_Generator.html?link=<n>, opened from the Ref Screen).
 *
 * The whole sheet is shown, Build and Play, but only the Play mode vitals (Stamina, AD, wounds, conditions,
 * cruelty, coins), equipment, and notes can be changed: every other control is disabled and clicks/keys/drags
 * on it are stopped before the app sees them. The server enforces the same rule (it applies only those fields
 * from a Ref, plus the rests, XP, and hits the Ref Screen makes through link.save), so this is about a clear UI, not trust.
 * The Ref's own character in this browser is left alone (app.js skips its local autosave here).
 */
(function () {
  'use strict';
  if (!window.CrowsCloud || !window.CrowsCloud.linked) return;

  // What a Ref can use. Everything else in the page body is read-only.
  var EDITABLE = '#inventory, .add-item, #btn-arrange, #in-notes, #play-vitals, #ref-banner';
  var ALWAYS_OK = 'summary, details > summary, a[href]';   // expanding sections and following links is just reading
  var BLOCKED_EVENTS = ['click', 'dblclick', 'mousedown', 'pointerdown', 'touchstart', 'keydown', 'input', 'change', 'dragstart', 'drop', 'dragover'];

  document.body.classList.add('ref-view', 'ref-loading');

  var css = 'body.ref-view #btn-random,body.ref-view #btn-new,body.ref-view .actions .file-btn{display:none}' +
    'body.ref-loading .layout{visibility:hidden}' +
    '.ref-banner{margin:12px auto 0;padding:.6rem clamp(16px,2vw,40px)}' +
    '.ref-banner p{margin:0;padding:.6rem .8rem;border-left:4px solid var(--sel);background:var(--card);border-radius:6px;font-size:.92rem}' +
    'body.ref-view .ref-locked{cursor:not-allowed}';
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

  var loaded = false;
  window.CrowsRefView = {
    /* True once the player's character is in (before that the page holds this browser's own character). */
    get loaded() { return loaded; },
    /* The character is loaded: show it with a banner saying what the Ref can do. */
    ready: function (name, owner) {
      loaded = true;
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
