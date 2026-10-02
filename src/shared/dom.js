/*
 * The Nest: small page helpers shared by the Character Generator, the Ref Screen, and the accounts site (window.CrowsDom).
 * The apps inline this file when they're built; the accounts site serves it next to portal.js (server/stage.sh).
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  /*
   * el('div', { class, text, html, value, checked, on<event>: fn, any attribute }, [children]). Attributes that are null,
   * undefined, or false are left out; true sets an empty attribute. value and checked are set as properties after the
   * children, so a <select> picks its option. Children can be nodes, strings, or numbers; null, undefined, and false are skipped.
   */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), val, chk;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'value') val = v;
      else if (k === 'checked') chk = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    if (val !== undefined) n.value = val;
    if (chk !== undefined) n.checked = !!chk;
    return n;
  }
  /* A button with the .btn style. extra: a tooltip (string) or more attributes (object). */
  function btn(text, onclick, cls, extra) {
    var a = { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick };
    if (typeof extra === 'string') a.title = extra || null;
    else if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return el('button', a);
  }
  /* A short message in the page's #toast box. */
  function toast(msg, ms) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2800);
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /* "1 wound", "3 wounds", "2 enemies", "2 bushes". */
  function plural(n, w) { return n + ' ' + (n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(ch|sh|s|x)$/.test(w) ? w + 'es' : w + 's'); }

  window.CrowsDom = { $: $, el: el, btn: btn, toast: toast, fmt: fmt, signed: signed, clone: clone, plural: plural };
})();
