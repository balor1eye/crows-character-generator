/*
 * Ref Screen: the AI tab and the Ref's own Anthropic API key, kept in a zero-knowledge vault.
 *
 * The plaintext key never reaches the accounts server. The browser encrypts it (WebCrypto: PBKDF2-SHA256, 600000 rounds, 16-byte salt ->
 * AES-GCM-256, 12-byte IV, AAD "crows-ai-vault-v1:" + username) with a passphrase the Ref chooses, never stored anywhere. The server (api.php
 * vault.get/save/delete) keeps only the ciphertext and hands it back to its owner; not logged in, it is kept in localStorage `crows-ai-vault`
 * (AAD username "local"). Map scans call api.anthropic.com straight from the browser with the decrypted key.
 *
 * Where the key lives: only in the `U` closure variable below (and the non-extractable derived CryptoKey beside it). It is never in `state` (which
 * syncs to the cloud), on window or the app object (A), in the DOM after entry (the inputs are emptied at once), or in a log. It is dropped
 * after 30 minutes without activity, on logout (a different or missing account), and on pagehide.
 * Residual risk: whoever controls the served JavaScript could ship code that reads the key when it is unlocked. The page's CSP limits injected
 * scripts, not the operator's own build.
 *
 * Exported to the other files (A.add): aiReady(), aiHas(), aiUnlock(), aiDetect(body). Under node the crypto is exported for ref/test/test_ai_vault.js.
 */
(function () {
  'use strict';
  var VERSION = 'crows-ai-vault-v1', ITER = 600000, MIN_PASS = 12, IDLE_MS = 30 * 60 * 1000, LOCAL_KEY = 'crows-ai-vault';
  var DEFAULT_MODEL = 'claude-sonnet-5-5', TEST_MODEL = 'claude-haiku-4-5-20251001';
  var MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (default)'], ['claude-opus-5-5', 'Claude Opus 5.5 (best, slower, costs more)'], [TEST_MODEL, 'Claude Haiku 4.5 (fastest, cheapest)']];
  var MAP_OBJECT_TYPES = ['pillar', 'statue', 'shelf', 'crate', 'boulder', 'tree', 'rubble', 'other'], MAP_MAX_WALLS = 200, MAP_MAX_OBJECTS = 40;
  var subtle = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;

  // ------------------------------------------------------------------ crypto (pure: no state, no DOM)
  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var t = atob(s), a = new Uint8Array(t.length); for (var i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function aad(user) { return utf8(VERSION + ':' + user); }
  function rand(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
  /* The AES-GCM key from a passphrase (not extractable). */
  function derive(pass, salt, iter) {
    return subtle.importKey('raw', utf8(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  /* Encrypt a payload with an already-derived key (a fresh IV each time) into the vault string. */
  function sealWith(cryptoKey, salt, iter, payload, user, hint) {
    var iv = rand(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(user) }, cryptoKey, utf8(JSON.stringify(payload))).then(function (ct) {
      return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: iter, salt: b64(salt), iv: b64(iv), ct: b64(ct), hint: hint || '' });
    });
  }
  /* A new vault string from a passphrase: resolves { vault, cryptoKey, salt, iter }. */
  function seal(payload, pass, user, hint, iter) {
    var salt = rand(16); iter = iter || ITER;
    return derive(pass, salt, iter).then(function (k) { return sealWith(k, salt, iter, payload, user, hint).then(function (vault) { return { vault: vault, cryptoKey: k, salt: salt, iter: iter }; }); });
  }
  /* Is this the vault shape the server accepts? Returns the parsed object or null. */
  function parse(vault) {
    var o; try { o = JSON.parse(vault); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    var keys = Object.keys(o).sort().join();
    if (keys !== 'ct,hint,iter,iv,kdf,salt,v' || o.v !== 1 || o.kdf !== 'PBKDF2-SHA256' || typeof o.hint !== 'string' || o.hint.length > 4) return null;
    if (!Number.isInteger(o.iter) || o.iter < 600000 || o.iter > 5000000) return null;
    try {
      var s = unb64(o.salt).length, i = unb64(o.iv).length, c = unb64(o.ct).length;
      if (s < 16 || s > 64 || i !== 12 || c < 16 || c > 4096) return null;
    } catch (e) { return null; }
    return o;
  }
  /* Decrypt a vault string: resolves { payload, cryptoKey, salt, iter }; rejects (Error 'Wrong passphrase') when the passphrase or account is wrong. */
  function open(vault, pass, user) {
    var o = parse(vault);
    if (!o) return Promise.reject(new Error('The saved key is damaged.'));
    var salt = unb64(o.salt);
    return derive(pass, salt, o.iter).then(function (k) {
      return subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: aad(user) }, k, unb64(o.ct)).then(function (pt) {
        var payload = JSON.parse(new TextDecoder().decode(pt));
        return { payload: payload, cryptoKey: k, salt: salt, iter: o.iter };
      });
    }).then(null, function (e) { throw e && e.message === 'The saved key is damaged.' ? e : new Error('Wrong passphrase'); });
  }
  /* A rough strength reading of a passphrase, for the hint. */
  function strength(p) {
    var n = p.length, classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(function (r) { return r.test(p); }).length, words = p.trim().split(/\s+/).length;
    if (n < MIN_PASS) return { ok: false, text: n + ' of ' + MIN_PASS + ' characters at least' };
    if (/^(.)\1+$/.test(p) || /^(password|passphrase|1234567890)/i.test(p)) return { ok: false, text: 'Too easy to guess' };
    var score = (n >= 16 ? 1 : 0) + (n >= 22 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (words >= 4 ? 1 : 0);
    return { ok: true, text: score >= 3 ? 'Strong' : score >= 1 ? 'Good' : 'Acceptable; longer is stronger' };
  }

  // ------------------------------------------------------------------ the map scan (ported from api.php a_map_detect)
  function clip(v, max) { return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim().slice(0, max) : ''; }
  function frac(v, d) { return typeof v === 'number' && isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000 : (d || 0); }
  function detectPayload(body, model) {
    var kind = ['dungeon', 'open', 'village'].indexOf(body.kind) >= 0 ? body.kind : 'dungeon', title = clip(body.title, 80);
    var cols = Number.isInteger(body.cols) ? Math.max(0, Math.min(500, body.cols)) : 0, rows = Number.isInteger(body.rows) ? Math.max(0, Math.min(500, body.rows)) : 0;
    var envKeys = {}, envList = (Array.isArray(body.envKeys) ? body.envKeys : []).slice(0, 40);
    envList.forEach(function (p) { if (Array.isArray(p) && typeof p[0] === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(p[0])) envKeys[p[0]] = clip(p[1], 40); });
    var objSchema = { type: 'object', properties: {
      name: { type: 'string', description: 'Short name, at most 30 characters' }, type: { type: 'string', 'enum': MAP_OBJECT_TYPES },
      x: { type: 'number', description: 'Centre, fraction of image width, 0 to 1' }, y: { type: 'number', description: 'Centre, fraction of image height, 0 to 1' },
      w: { type: 'number', description: 'Footprint width, fraction of image width' }, h: { type: 'number', description: 'Footprint height, fraction of image height' } },
      required: ['name', 'type', 'x', 'y', 'w', 'h'] };
    var wallSchema = { type: 'object', properties: {
      x1: { type: 'number', description: 'One end, fraction of image width' }, y1: { type: 'number', description: 'One end, fraction of image height' },
      x2: { type: 'number', description: 'Other end, fraction of image width' }, y2: { type: 'number', description: 'Other end, fraction of image height' },
      door: { type: 'boolean', description: 'A door across a doorway, not a wall' } },
      required: ['x1', 'y1', 'x2', 'y2'] };
    var names = Object.keys(envKeys);
    var tool = { name: 'report_objects', description: 'Report the walls, doors, and large blocking objects on the battle map.', input_schema: { type: 'object', properties: {
      walls: { type: 'array', maxItems: MAP_MAX_WALLS, items: wallSchema }, objects: { type: 'array', maxItems: MAP_MAX_OBJECTS, items: objSchema },
      env: { type: 'array', items: names.length ? { type: 'string', 'enum': names } : { type: 'string' } } }, required: ['walls', 'objects', 'env'] } };
    var prompt = 'This image is a top-down tabletop RPG battle map' + (title ? ' titled "' + title + '"' : '') + ' (' + kind + ' setting' + (cols > 0 && rows > 0 ? ', ' + cols + ' x ' + rows + ' squares' : '') + '). '
      + (cols > 0 ? 'One grid square is 1/' + cols + ' of the image width' + (rows > 0 ? ' and 1/' + rows + ' of its height' : '') + '. ' : 'If the map shows a grid, measure against it. ')
      + 'Report only what stops a person both moving and seeing past it. '
      + 'Walls: each straight run of wall as one segment along its middle, from corner to corner; split a curved or cave wall into short straight segments; follow grid lines where the wall does. '
      + 'Leave a gap at every doorway and report each door as its own segment across the doorway with door true. Open archways, windows, low walls, cliff edges, and map borders with no wall drawn are not walls. '
      + 'Objects: only large solid things a person cannot see over or walk through, about one square across or more, such as pillars, columns, big statues, bookcases and tall shelves, stacked crates, boulders, tree trunks, standing stones. '
      + 'Give each one\'s centre (x, y) and the footprint it is drawn with (w, h), measured on the grid. '
      + 'Do not report anything a person can see over or that is small: tables, chairs, beds, chests, barrels, altars, wells, lights, traps, stairs, rugs, bodies, or decoration. '
      + 'All positions and sizes are fractions of the image width (x, w) and height (y, h), 0 to 1. '
      + (body.hasLabels ? 'The map has printed labels or a legend: use them to name objects, and do NOT report the label text itself. ' : '')
      + 'Keep names short (30 characters or fewer). Report at most ' + MAP_MAX_WALLS + ' wall segments and ' + MAP_MAX_OBJECTS + ' objects. '
      + (names.length ? 'In env, list keys from the allowed set only when the picture clearly implies them (for example a dark cave); usually leave it empty. Allowed: '
        + names.map(function (k) { return envKeys[k] ? k + ' (' + envKeys[k] + ')' : k; }).join(', ') + '. ' : 'Leave env empty. ')
      + 'Answer by calling report_objects.';
    return { envKeys: envKeys, payload: { model: model, max_tokens: 16000, tools: [tool], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: ['image/jpeg', 'image/png', 'image/webp'].indexOf(body.mime) >= 0 ? body.mime : 'image/jpeg', data: body.image } }, { type: 'text', text: prompt }] }] } };
  }
  function detectResult(j, envKeys, model) {
    var input = null;
    (Array.isArray(j && j.content) ? j.content : []).forEach(function (b) { if (!input && b && b.type === 'tool_use' && b.name === 'report_objects' && b.input && typeof b.input === 'object') input = b.input; });
    if (!input) throw new Error('The model gave no answer.');
    var objects = [], walls = [], env = [];
    (Array.isArray(input.objects) ? input.objects : []).forEach(function (o) {
      if (objects.length >= MAP_MAX_OBJECTS || !o || typeof o.x !== 'number' || typeof o.y !== 'number') return;
      var name = clip(o.name, 30); if (!name) return;
      objects.push({ name: name, type: MAP_OBJECT_TYPES.indexOf(o.type) >= 0 ? o.type : 'other', x: frac(o.x), y: frac(o.y), w: Math.max(0.005, frac(o.w, 0.03)), h: Math.max(0.005, frac(o.h, 0.03)) });
    });
    (Array.isArray(input.walls) ? input.walls : []).forEach(function (w) {
      if (walls.length >= MAP_MAX_WALLS || !w || ['x1', 'y1', 'x2', 'y2'].some(function (k) { return typeof w[k] !== 'number'; })) return;
      var seg = { x1: frac(w.x1), y1: frac(w.y1), x2: frac(w.x2), y2: frac(w.y2) };
      if (Math.abs(seg.x1 - seg.x2) + Math.abs(seg.y1 - seg.y2) < 0.002) return;
      seg.door = w.door === true; walls.push(seg);
    });
    (Array.isArray(input.env) ? input.env : []).forEach(function (e) { if (typeof e === 'string' && Object.prototype.hasOwnProperty.call(envKeys, e) && env.indexOf(e) < 0) env.push(e); });
    return { objects: objects, walls: walls, env: env, model: model };
  }
  /* One call to the Anthropic API from the browser. Rejects with Error(message from Anthropic) and .status. */
  function callAnthropic(apiKey, payload) {
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(payload) }).then(function (r) {
      return r.json().then(function (j) { return { r: r, j: j }; }, function () { return { r: r, j: null }; });
    }, function () { throw new Error('Could not reach Anthropic (offline, or blocked).'); }).then(function (x) {
      if (x.r.ok && x.j) return x.j;
      var e = new Error((x.j && x.j.error && x.j.error.message) || 'Anthropic answered HTTP ' + x.r.status + '.'); e.status = x.r.status; throw e;
    });
  }

  var Vault = { seal: seal, sealWith: sealWith, open: open, parse: parse, derive: derive, aad: aad, strength: strength, detectPayload: detectPayload, detectResult: detectResult,
    ITER: ITER, MIN_PASS: MIN_PASS, MODELS: MODELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vault;
  if (typeof window === 'undefined' || !window.CrowsRefApp) return;

  // ------------------------------------------------------------------ the browser side
  var A = window.CrowsRefApp, f = A.fwd;
  var render = f('render'), btn = f('btn');
  var el = A.el, toast = A.toast;

  var U = null;            // the unlocked vault: { user, key, model, cryptoKey, salt, iter, hint }. The only place the API key lives.
  var stored = null;       // the encrypted vault string last read or written (not secret), '' when there is none, null before it is read
  var storedFor = null;    // whose vault `stored` is ('local' or a username)
  var meKnown = false, loading = null, idleTimer = null, unlocking = null, lastSig = '', note = { text: '', bad: false };

  function who() { var c = window.CrowsCloud, u = c && c.me && c.me(); return u && u.username ? u.username : 'local'; }
  function online() { return who() !== 'local'; }
  function lock(why) {
    var was = !!U; U = null; clearTimeout(idleTimer);
    clearForm();
    if (was && why) toast(why);
    if (was) { lastSig = ''; render(); }
  }
  function touch() { clearTimeout(idleTimer); if (U) idleTimer = setTimeout(function () { lock('The AI key locked after 30 minutes idle.'); }, IDLE_MS); }
  function clearForm() { Array.prototype.forEach.call(document.querySelectorAll('input[data-ai-secret]'), function (n) { n.value = ''; }); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, touch, { capture: true, passive: true }); });
  window.addEventListener('pagehide', function () { lock(); });
  setInterval(function () { if (U && U.user !== who()) lock('The AI key locked because you logged out.'); }, 3000);

  /* Read this account's encrypted vault (server when logged in, else this browser). Resolves the vault string or ''. */
  function load(force) {
    var c = window.CrowsCloud;
    if (c && c.afterMe && !meKnown) return new Promise(function (ok) { c.afterMe(function () { meKnown = true; ok(); }); }).then(function () { return load(force); });   // account or this browser: wait until it's known
    var me = who();
    if (!force && stored !== null && storedFor === me) return Promise.resolve(stored);
    if (loading && loading.for === me) return loading.p;
    var p;
    if (online()) p = window.CrowsCloud.api('GET', 'vault.get', '').then(function (j) { return typeof j.vault === 'string' ? j.vault : ''; });
    else p = Promise.resolve().then(function () { try { return localStorage.getItem(LOCAL_KEY) || ''; } catch (e) { return ''; } });
    var q = p.then(function (v) { if (storedFor !== me && U) lock(); stored = v; storedFor = me; loading = null; return v; }, function (e) { loading = null; throw e; });
    loading = { for: me, p: q };
    return q;
  }
  function store(vault) {
    var me = who(), p;
    if (online()) p = window.CrowsCloud.api('POST', 'vault.save', '', { vault: vault });
    else p = new Promise(function (ok, no) { try { localStorage.setItem(LOCAL_KEY, vault); ok(); } catch (e) { no(new Error('This browser would not keep it (storage is blocked or full).')); } });
    return p.then(function () { stored = vault; storedFor = me; });
  }
  function discard() {
    var me = who(), p;
    if (online()) p = window.CrowsCloud.api('POST', 'vault.delete', '', {});
    else p = Promise.resolve().then(function () { try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ } });
    return p.then(function () { stored = ''; storedFor = me; });
  }
  function hintOf(vault) { var o = vault && parse(vault); return o ? o.hint : ''; }

  // ------------------------------------------------------------------ the unlock dialog
  function dialog(title, text, label) {
    return new Promise(function (resolve) {
      var prev = document.activeElement, busy = false;
      var input = el('input', { type: 'password', class: 'in', autocomplete: 'off', spellcheck: 'false', 'data-ai-secret': '1', 'aria-label': label || 'Vault passphrase', style: 'width:100%' });
      var msg = el('p', { class: 'fine', role: 'alert', text: '', style: 'min-height:1.2em;margin:.3rem 0' });
      var ok = el('button', { type: 'submit', class: 'btn btn-small btn-primary', text: 'Unlock' });
      var no = el('button', { type: 'button', class: 'btn btn-small', text: 'Cancel' });
      var box = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ai-dlg-t', style: 'align-items:center;justify-content:center' }, [
        el('form', { style: 'background:var(--paper);color:var(--ink);border:1px solid var(--ink);border-radius:8px;padding:1rem;max-width:26rem;width:100%;box-shadow:0 4px 16px rgba(0,0,0,.35)',
          onsubmit: function (e) { e.preventDefault(); go(); } }, [
          el('h3', { id: 'ai-dlg-t', text: title, style: 'margin:0 0 .5rem' }), el('p', { text: text, style: 'margin:0 0 .6rem' }), input, msg,
          el('div', { class: 'row' }, [ok, no])])]);
      function done(v) { input.value = ''; box.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus && document.body.contains(prev)) prev.focus(); resolve(v); }
      function go() {
        if (busy || !input.value) return;
        busy = true; ok.disabled = true; msg.textContent = 'Unlocking…';
        var pass = input.value; input.value = '';
        open(stored, pass, who()).then(function (r) {
          pass = '';
          U = { user: who(), key: String(r.payload.key || ''), model: r.payload.model || DEFAULT_MODEL, cryptoKey: r.cryptoKey, salt: r.salt, iter: r.iter, hint: hintOf(stored) };
          touch(); lastSig = ''; done(true); render();
        }, function (e) { pass = ''; busy = false; ok.disabled = false; msg.textContent = e.message + '. Try again.'; input.focus(); });
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); return; }
        if (e.key !== 'Tab') return;
        var order = [input, ok, no].filter(function (n) { return !n.disabled; }), i = order.indexOf(document.activeElement);
        e.preventDefault(); order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus();
      }
      no.addEventListener('click', function () { done(false); });
      box.addEventListener('click', function (e) { if (e.target === box) done(false); });
      (document.fullscreenElement || document.body).appendChild(box); document.addEventListener('keydown', onKey, true); input.focus();
    });
  }

  // ------------------------------------------------------------------ exports for the other files
  function aiReady() { return !!U && U.user === who(); }
  /* Is there a saved key (resolves false when it can't be read)? */
  function aiHas() { return load().then(function (v) { return !!v; }, function () { return false; }); }
  /* Unlocked already, or ask for the passphrase. Resolves true/false. */
  function aiUnlock() {
    if (aiReady()) return Promise.resolve(true);
    if (unlocking) return unlocking;
    unlocking = load().then(function (v) {
      if (!v) return false;
      return dialog('Unlock your Anthropic key', 'Enter your vault passphrase. The key is decrypted in this browser only, and locks again after 30 minutes idle.');
    }, function () { return false; }).then(function (r) { unlocking = null; return r; });
    return unlocking;
  }
  /* The map.detect answer shape ({ objects, env, model }) from the Ref's own key. */
  function aiDetect(body) {
    if (!aiReady()) return Promise.reject(new Error('Your AI key is locked.'));
    touch();
    var model = U.model || DEFAULT_MODEL, d = detectPayload(body, model);
    return callAnthropic(U.key, d.payload).then(function (j) { return detectResult(j, d.envKeys, model); });
  }

  // ------------------------------------------------------------------ the tab
  function say(text, bad) { note = { text: text, bad: !!bad }; lastSig = ''; render(); }
  function field(label, control, extra) { return el('label', { class: 'field' }, [label, control, extra]); }
  function secret(label, auto, id) { return el('input', { type: 'password', class: 'in', autocomplete: auto, spellcheck: 'false', 'data-ai-secret': '1', 'aria-label': label, id: id, style: 'max-width:26rem' }); }
  function passPair(prefix) {
    var p1 = secret('Vault passphrase', 'new-password', prefix + '-p1'), p2 = secret('Vault passphrase again', 'new-password', prefix + '-p2');
    var hint = el('span', { class: 'fine', 'aria-live': 'polite', text: 'At least ' + MIN_PASS + ' characters. Not your account password.' });
    p1.addEventListener('input', function () { var s = strength(p1.value); hint.textContent = p1.value ? s.text : 'At least ' + MIN_PASS + ' characters. Not your account password.'; hint.style.color = p1.value && !s.ok ? 'var(--bad, #a33)' : ''; });
    /* The passphrase when both entries agree and are long enough, else null with the reason said. */
    function take() {
      var a = p1.value, b = p2.value; p1.value = ''; p2.value = '';
      if (strength(a).ok === false) { say(strength(a).text + '. Use a passphrase of at least ' + MIN_PASS + ' characters.', true); return null; }
      if (a !== b) { say('The two passphrases do not match.', true); return null; }
      return a;
    }
    return { nodes: [field('Vault passphrase', p1, hint), field('Vault passphrase again', p2)], take: take };
  }
  function persist(payload, pass, hint, user) {
    return seal(payload, pass, user, hint).then(function (s) { return store(s.vault).then(function () { return s; }); });
  }
  function renderAi() {
    var me = who(), page = document.getElementById('sec-ai-key');
    if (!page) return;
    if (stored === null || storedFor !== me) {
      if (!loading || loading.for !== me) load().then(function () { lastSig = ''; render(); }, function (e) { stored = null; storedFor = null; note = { text: 'Could not read your saved key: ' + (e && e.message || 'error') + '.', bad: true }; });
    }
    var have = stored !== null && storedFor === me ? !!stored : null, un = aiReady(), hint = have ? hintOf(stored) : '';
    var sig = [me, have, un, hint, un ? U.model : '', note.text].join('|');
    if (sig === lastSig && page.firstChild) return;   // nothing changed: leave what is being typed alone
    lastSig = sig;
    var status = have === null ? 'Checking for a saved key…' : !have ? 'No key saved yet.' : (un ? 'Unlocked' : 'Locked') + ': key …' + (hint || '????') + (online() ? ', kept in your account.' : ', kept in this browser (not logged in).');
    var kids = [el('p', { text: status, role: 'status', style: 'font-weight:bold' })];
    if (note.text) kids.push(el('p', { class: 'fine', role: 'alert', text: note.text, style: note.bad ? 'color:var(--bad, #a33)' : '' }));

    var row = [];
    if (have && !un) row.push(btn('Unlock', function () { aiUnlock(); }, 'btn-primary'));
    if (un) row.push(btn('Lock now', function () { lock('AI key locked.'); }));
    if (have) row.push(btn('Remove key', function () {
      if (!confirm('Remove your saved Anthropic key from ' + (online() ? 'your account' : 'this browser') + '? You would need to enter it again to use it.')) return;
      discard().then(function () { U = null; note = { text: 'Key removed.', bad: false }; lastSig = ''; render(); }, function (e) { say('Could not remove it: ' + e.message, true); });
    }, 'btn-danger'));
    if (row.length) kids.push(el('div', { class: 'row' }, row));

    // add or replace
    var keyIn = secret('Anthropic API key', 'off', 'ai-key-in'), pp = passPair('ai-new'), tested = el('span', { class: 'fine', 'aria-live': 'polite', text: '' });
    function testKey(k, model) {
      tested.textContent = 'Testing…';
      return callAnthropic(k, { model: TEST_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }).then(function () { tested.textContent = 'The key works.'; return true; },
        function (e) { tested.textContent = 'Anthropic says: ' + e.message; return false; });
    }
    kids.push(el('h3', { text: have ? 'Replace the key' : 'Add your key', style: 'margin:.8rem 0 .3rem' }),
      field('Anthropic API key', keyIn, el('span', { class: 'fine', text: 'From console.anthropic.com. It is encrypted here before it goes anywhere.' })));
    pp.nodes.forEach(function (n) { kids.push(n); });
    kids.push(el('div', { class: 'row' }, [
      btn('Test key', function () { var k = keyIn.value.trim() || (U && U.key); if (!k) { tested.textContent = 'Type a key to test (or unlock the saved one).'; return; } testKey(k); }),
      btn('Save key', function () {
        var k = keyIn.value.trim(); keyIn.value = '';
        if (!k) return say('Type your API key first.', true);
        var pass = pp.take(); if (pass === null) return;
        tested.textContent = 'Encrypting…';
        var payload = { key: k, model: un ? U.model : DEFAULT_MODEL, at: Date.now() }, me2 = who();
        persist(payload, pass, k.slice(-4), me2).then(function (s) {
          U = { user: me2, key: payload.key, model: payload.model, cryptoKey: s.cryptoKey, salt: s.salt, iter: s.iter, hint: k.slice(-4) };
          touch(); note = { text: 'Saved and unlocked. Use Test key to check it works.', bad: false }; lastSig = ''; render();
        }, function (e) { say('Could not save it: ' + e.message, true); });
      }, 'btn-primary'), tested]));

    if (un) {
      var sm = el('select', { class: 'in', 'aria-label': 'Model for map scans' }, MODELS.map(function (m) { return el('option', { value: m[0], text: m[1] }); }));
      sm.value = U.model;
      sm.addEventListener('change', function () {
        var model = sm.value, u = U; if (!u) return;
        sealWith(u.cryptoKey, u.salt, u.iter, { key: u.key, model: model, at: Date.now() }, u.user, u.hint).then(store).then(function () {
          if (U === u) U.model = model; note = { text: 'Map scans will use ' + model + '.', bad: false }; lastSig = ''; render();
        }, function (e) { say('Could not save the model: ' + e.message, true); });
      });
      var pp2 = passPair('ai-chg');
      kids.push(el('h3', { text: 'Model for map scans', style: 'margin:.8rem 0 .3rem' }), sm,
        el('h3', { text: 'Change passphrase', style: 'margin:.8rem 0 .3rem' }));
      pp2.nodes.forEach(function (n) { kids.push(n); });
      kids.push(btn('Change passphrase', function () {
        var pass = pp2.take(), u = U; if (pass === null || !u) return;
        persist({ key: u.key, model: u.model, at: Date.now() }, pass, u.hint, u.user).then(function (s) {
          if (U === u) { U.cryptoKey = s.cryptoKey; U.salt = s.salt; U.iter = s.iter; }
          note = { text: 'Passphrase changed.', bad: false }; lastSig = ''; render();
        }, function (e) { say('Could not change it: ' + e.message, true); });
        pass = '';
      }));
    } else if (have) kids.push(el('p', { class: 'fine', text: 'Unlock the key to choose the model or change the passphrase.' }));

    page.innerHTML = '';
    page.appendChild(el('h2', null, ['AI', el('small', { text: 'your own Anthropic key, for scanning maps' })]));
    kids.forEach(function (k) { page.appendChild(k); });

    var about = document.getElementById('sec-ai-about');
    if (about && !about.firstChild) {
      about.appendChild(el('h2', { text: 'How your key is protected' }));
      [ 'With your own key, Claude reads the maps you upload and traces their walls, doors, and large objects that block sight. You pay Anthropic directly; nothing is billed through this site.',
        'Your key is encrypted in this browser with a vault passphrase you choose (not your account password), using AES-GCM with a key made from the passphrase by 600,000 rounds of PBKDF2. Only the scrambled result is stored: in your account when you are logged in, or in this browser when you are not. The site\'s server, its administrator, and anyone who gets into its database see only that, and cannot read the key. Nobody can recover a forgotten passphrase; you would add the key again.',
        'To scan a map, your browser unlocks the key and talks to Anthropic directly. The decrypted key is held in memory only: never saved with the campaign, never shown again after you type it, and dropped after 30 minutes idle, on logout, or when you leave the page.',
        'What this cannot stop: whoever controls this site\'s scripts could change them to capture the key at the moment you unlock it. The page\'s security policy blocks scripts injected by others, but you are trusting whoever publishes this page. Use a key with a spending limit you are comfortable with, and revoke it at Anthropic if you doubt anything.'
      ].forEach(function (t) { about.appendChild(el('p', { text: t })); });
    }
  }

  A.add({ renderAi: renderAi, aiReady: aiReady, aiHas: aiHas, aiUnlock: aiUnlock, aiDetect: aiDetect });
})();
