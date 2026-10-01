/*
 * Light / dark theme, shared by the Character Generator, the Ref Screen, and the accounts portal.
 * "Auto" follows the device setting; Light and Dark override it. The choice sets data-theme on <html>
 * (the stylesheets key their dark colours off it) and is kept in localStorage, so every page on the
 * same site agrees, open tabs and embedded frames included. Loaded in <head> so there's no flash.
 * Any button with class "theme-toggle" cycles Auto -> Light -> Dark.
 */
(function () {
  var KEY = 'nest-theme';
  var NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  var ICON = { auto: '\u25D0', light: '\u2600', dark: '\u263E' };
  var NAME = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var root = document.documentElement;
  var cur = 'auto';

  function stored() {
    try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; }
  }
  function label(b, t) {
    b.textContent = ICON[t] + ' ' + NAME[t];
    b.title = 'Theme: ' + NAME[t] + (t === 'auto' ? ' (follows your device)' : '') + '. Click for ' + NAME[NEXT[t]] + '.';
    b.setAttribute('aria-label', b.title);
  }
  function apply(t) {
    cur = t;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    Array.prototype.forEach.call(document.querySelectorAll('.theme-toggle'), function (b) { label(b, t); });
  }
  function set(t) {
    try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* storage unavailable */ }
    apply(t);
  }

  apply(stored());
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(stored()); });
  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('.theme-toggle'), function (b) {
      b.addEventListener('click', function () { set(NEXT[cur]); });
    });
    apply(cur);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
