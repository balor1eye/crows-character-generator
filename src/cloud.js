/*
 * Crows account autosave, shared by the Character Generator and the Ref Screen.
 *
 * When the app is served next to the accounts API (api.php) and the visitor is logged in, the thing
 * being edited (a character or a campaign) is kept in their account: it's loaded from the server and
 * every change is saved back a moment after it's made. Anywhere else (the offline file, GitHub Pages,
 * a guest) this does nothing beyond one failed probe, and the app keeps its browser-only autosave.
 *
 * URL parameters: ?id=<n> opens that saved record, ?new=1 starts a new one; with neither, the record
 * last open in this browser is reopened (or the current local state is saved as a new one).
 *
 * The app calls CrowsCloud.attach(opts) once at start-up, CrowsCloud.changed() from its save(),
 * and CrowsCloud.startNew() just before it replaces the whole thing (new, random, load file).
 */
(function () {
  'use strict';

  var API = 'api.php';
  var DELAY = 1200;            // ms after the last change before saving
  var MAX_WAIT = 8000;         // ...but never later than this after the first unsaved change
  var cfg = null;              // attach() options
  var user = null, csrf = null;
  var rec = null;              // { id, version } of the linked record
  var ready = false;           // true once the account copy is loaded (changes before that are ignored)
  var lastSent = null;         // JSON of the last data the server has
  var timer = null, inFlight = false, again = false, retryMs = 0, firstChange = 0;
  var pendingNew = false, fresh = false;
  var gen = 0;                 // bumped when the app starts a new record, so late replies for the old one are ignored
  var chip = null, bar = null;

  function params() {
    var p = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      p[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
    return p;
  }

  function call(method, action, query, body, keepalive) {
    var url = API + '?a=' + encodeURIComponent(action) + (query ? '&' + query : '');
    var opts = { method: method, credentials: 'same-origin', headers: {}, cache: 'no-store' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    if (keepalive) opts.keepalive = true;
    return fetch(url, opts).then(function (r) {
      var type = r.headers.get('Content-Type') || '';
      if (type.indexOf('application/json') < 0) { var e = new Error('no api'); e.noApi = true; throw e; }
      return r.json().then(function (j) {
        if (!j.ok) { var err = new Error(j.error || 'Request failed'); err.status = r.status; err.body = j; throw err; }
        return j;
      });
    });
  }
  function kq() { return 'kind=' + cfg.kind; }

  // ---------------------------------------------------------------- UI
  function injectStyles() {
    var css = '.cloud-chip{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;padding:.2rem .55rem;border-radius:99px;' +
      'border:1px solid #5a5354;color:#f4efe6;white-space:nowrap;min-height:30px}' +
      '.cloud-chip .dot{width:8px;height:8px;border-radius:50%;background:#8a8386}' +
      '.cloud-chip[data-s="saved"] .dot{background:#6fbf7c}.cloud-chip[data-s="saving"] .dot{background:#d9a441}' +
      '.cloud-chip[data-s="error"] .dot,.cloud-chip[data-s="conflict"] .dot{background:#ff7b6e}' +
      '.cloud-home{color:#f4efe6!important;text-decoration:none}' +
      '.cloud-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:60;max-width:calc(100vw - 32px);width:560px;' +
      'background:var(--card,#fff);color:var(--ink,#111);border:2px solid var(--bad,#a3231a);border-radius:8px;padding:.8rem 1rem;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25);font-size:.92rem}.cloud-bar p{margin:0 0 .6rem}.cloud-bar .row{display:flex;gap:.5rem;flex-wrap:wrap}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  function actions() { return document.querySelector('.masthead .actions'); }
  function link(text, href, cls) { var a = document.createElement('a'); a.href = href; a.className = cls; a.textContent = text; return a; }

  function showChip() {
    var nav = actions(); if (!nav) return;
    injectStyles();
    var home = link(user ? '⌂ Home' : 'Log in', user ? './#home' : './#login', 'btn btn-ghost cloud-home');
    home.title = user ? 'Back to your characters' + (cfg.kind === 'campaigns' ? ' and campaigns' : '') : 'Log in to save to your account';
    nav.insertBefore(home, nav.firstChild);
    if (!user) return;
    chip = document.createElement('span');
    chip.className = 'cloud-chip';
    chip.setAttribute('role', 'status');
    chip.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    nav.insertBefore(chip, home.nextSibling);
    status('loading', 'Loading…');
  }
  function status(s, text, title) {
    if (!chip) return;
    chip.setAttribute('data-s', s);
    chip.querySelector('.txt').textContent = text;
    chip.title = title || (user ? 'Account: ' + user.username : '');
  }
  function closeBar() { if (bar) { bar.remove(); bar = null; } }
  function showBar(msg, buttons) {
    closeBar();
    bar = document.createElement('div');
    bar.className = 'cloud-bar'; bar.setAttribute('role', 'alert');
    var p = document.createElement('p'); p.textContent = msg; bar.appendChild(p);
    var row = document.createElement('div'); row.className = 'row';
    buttons.forEach(function (b) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.text;
      btn.addEventListener('click', b.on); row.appendChild(btn);
    });
    bar.appendChild(row);
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------------- linking
  function linkKey() { return 'crows-cloud-' + cfg.kind + '-' + user.id; }
  function remember(id) {
    try { if (id) localStorage.setItem(linkKey(), String(id)); else localStorage.removeItem(linkKey()); } catch (e) { /* ignore */ }
    var url = location.pathname + (id ? '?id=' + id : '') + location.hash;
    try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
  }
  function remembered() { try { return parseInt(localStorage.getItem(linkKey()), 10) || null; } catch (e) { return null; } }

  function openRecord(id) {
    return call('GET', 'get', kq() + '&id=' + id).then(function (j) {
      var item = j.item;
      if (!cfg.valid(item.data)) throw new Error('That save could not be read.');
      rec = { id: item.id, version: item.version };
      cfg.apply(item.data);
      lastSent = JSON.stringify(cfg.getData());
      remember(item.id);
      return item;
    });
  }

  // ---------------------------------------------------------------- saving
  function payload(data) { return { data: data, name: cfg.name(data) || '', summary: cfg.summary(data) || '' }; }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { flush(); }, ms); }

  function flush(force) {
    clearTimeout(timer); timer = null; firstChange = 0;
    if (!ready || !user) return;
    if (inFlight) { again = true; return; }
    var data = cfg.getData(), json = JSON.stringify(data);
    if (rec && json === lastSent && !force) { status('saved', 'Saved'); return; }
    inFlight = true; again = false;
    // The first content sent after startNew() is the new record; anything sent after that is an edit.
    if (pendingNew) { pendingNew = false; fresh = true; } else fresh = false;
    status('saving', 'Saving…');
    var body = payload(data), p, myGen = gen;
    if (rec) { body.id = rec.id; body.version = rec.version; if (force) body.force = true; p = call('POST', 'save', kq(), body); }
    else p = call('POST', 'create', kq(), body);
    p.then(function (j) {
      if (myGen !== gen) return;
      rec = { id: j.item.id, version: j.item.version };
      lastSent = json; retryMs = 0;
      remember(rec.id);
      status('saved', 'Saved', 'Saved to your account at ' + new Date().toLocaleTimeString());
    }, function (e) {
      if (myGen !== gen) return;
      if (e.status === 409 && e.body && e.body.item) return conflict(e.body.item);
      if (e.status === 404 && rec) { rec = null; remember(null); again = true; return; }  // deleted elsewhere: save as new
      if (e.status === 401 || e.status === 403) {
        status('error', 'Not saved', e.message);
        showBar(e.message + ' Your changes are kept in this browser until you log in again.', [
          { text: 'Log in', cls: 'btn-primary', on: function () { location.href = './#login'; } },
          { text: 'Dismiss', cls: 'btn-ghost', on: closeBar }]);
        return;
      }
      if (e.status === 413 || (e.status === 409 && !rec)) { status('error', 'Not saved', e.message); showBar(e.message, [{ text: 'OK', on: closeBar }]); return; }
      // Network trouble or a server hiccup: keep retrying, slower each time.
      retryMs = Math.min(60000, retryMs ? retryMs * 2 : 4000);
      status('error', 'Offline, retrying', 'Could not reach the server (' + e.message + '). Changes are kept in this browser.');
      schedule(retryMs);
    }).then(function () {
      if (myGen !== gen) return;   // startNew() already released the lock
      inFlight = false;
      if (again) schedule(300);
    });
  }

  function conflict(item) {
    status('conflict', 'Changed elsewhere');
    var what = cfg.kind === 'campaigns' ? 'campaign' : 'character';
    showBar('This ' + what + ' was saved from another window or device at ' + new Date(item.updatedAt).toLocaleTimeString() + '. Which version do you want to keep?', [
      { text: 'Keep this one', cls: 'btn-primary', on: function () { closeBar(); flush(true); } },
      { text: 'Load the other one', cls: 'btn-ghost', on: function () {
        closeBar();
        openRecord(item.id).then(function () { status('saved', 'Saved'); }, function (e) { status('error', 'Not loaded', e.message); });
      } }]);
  }

  // Last-chance save when the page is hidden or closed (keepalive bodies are capped near 64 KB).
  function flushOnExit() {
    if (!ready || !user || !rec || inFlight) return;
    var data = cfg.getData(), json = JSON.stringify(data);
    if (json === lastSent || json.length > 60000) { if (json !== lastSent) flush(); return; }
    clearTimeout(timer);
    var body = payload(data); body.id = rec.id; body.version = rec.version;
    call('POST', 'save', kq(), body, true).then(function (j) { rec.version = j.item.version; lastSent = json; }, function () { /* retried on return */ });
  }

  // ---------------------------------------------------------------- public API
  var Cloud = {
    get user() { return user; },
    get active() { return !!user && ready; },

    /*
     * opts: kind ('characters' | 'campaigns'), getData(), apply(data), valid(data),
     *       name(data), summary(data), fresh() (make a brand-new thing for ?new=1), onReady(params)
     */
    attach: function (opts) {
      cfg = opts;
      if (!/^https?:$/.test(location.protocol) || !window.fetch) return;
      var p = params();
      call('GET', 'me').then(function (j) {
        user = j.user; csrf = j.csrf;
        if (user && cfg.kind === 'campaigns' && !user.canRef) user = null;
        showChip();
        if (!user) return;
        var id = parseInt(p.id, 10) || null;
        var step;
        if (p['new'] !== undefined) { cfg.fresh(); pendingNew = true; step = Promise.resolve(); remember(null); }
        else if (id || remembered()) {
          var want = id || remembered();
          step = openRecord(want).catch(function (e) {
            if (e.status === 404 && !id) { remember(null); return; }   // the remembered one was deleted: save what's here as new
            throw e;
          });
        } else step = Promise.resolve();
        step.then(function () {
          ready = true;
          if (cfg.onReady) cfg.onReady(p);
          if (rec) status('saved', 'Saved'); else flush();
        }, function (e) {
          status('error', 'Not loaded', e.message);
          showBar('Could not open that save: ' + e.message + ' You are looking at the copy kept in this browser, which is not being saved to your account.', [
            { text: 'Home', cls: 'btn-primary', on: function () { location.href = './#home'; } },
            { text: 'Retry', cls: 'btn-ghost', on: function () { location.reload(); } }]);
        });
      }, function () { /* no accounts server here: stay browser-only */ });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushOnExit(); });
      window.addEventListener('pagehide', flushOnExit);
    },

    /* Called from the app's save(). Cheap: the real work is debounced. */
    changed: function () {
      if (!ready || !user) return;
      var t = Date.now();
      if (!firstChange) firstChange = t;
      schedule(Math.max(0, Math.min(DELAY, firstChange + MAX_WAIT - t)));
    },

    /*
     * Called just before the app replaces everything (new, random, load a file). The next change is
     * saved as a new record, unless the current one was itself just started and never edited (so
     * rerolling "Random crow" doesn't leave a trail of throwaway saves).
     */
    startNew: function () {
      if (!ready || !user) return;
      var reuse = fresh && (rec || inFlight);
      if (!reuse) {
        if (timer || (rec && JSON.stringify(cfg.getData()) !== lastSent)) flush();
        gen++; rec = null; lastSent = null; remember(null);
        inFlight = false;   // a reply for the old record is now ignored, so don't wait on it
      }
      pendingNew = true;
      if (!reuse) fresh = false;
    }
  };
  window.CrowsCloud = Cloud;
})();
