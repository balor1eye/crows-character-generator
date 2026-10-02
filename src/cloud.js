/*
 * The Nest account autosave, shared by the Character Generator and the Ref Screen.
 *
 * When the app is served next to the accounts API (api.php) and the visitor is logged in, the thing
 * being edited (a character or a campaign) is kept in their account: it's loaded from the server and
 * every change is saved back a moment after it's made. Anywhere else (the offline file, a guest) this does
 * nothing beyond one failed probe, and the app keeps its browser-only autosave.
 *
 * URL parameters: ?id=<n> opens that saved record, ?new=1 starts a new one; with neither, the record
 * last open in this browser is reopened (or the current local state is saved as a new one).
 * ?link=<n> is the Ref's view of a character a player shared: only the Play mode vitals (Stamina, wounds,
 * conditions, cruelty, coins, and their log), equipment, notes, and XP are sent back, and the server applies just those.
 * ?id=<n> can also be someone else's character that its player handed to this user (control.give): it's opened
 * and saved like one of their own until the player takes it back, which shows a notice instead of saving a copy.
 *
 * Several windows (or a player and their Ref) can have the same character open. Each checks about once a
 * second for a newer version (a tiny static file the server rewrites on every save, see signal() in
 * server/app/api.php), and changes are merged three ways against the last version both sides agreed on,
 * so edits to different parts never clobber each other; only a real clash (both changed the same thing) asks.
 *
 * The app calls CrowsCloud.attach(opts) once at start-up, CrowsCloud.changed() from its save(),
 * and CrowsCloud.startNew() just before it replaces the whole thing (new, random, load file).
 *
 * With opts.manualNew (the Character Generator), a new record isn't autosaved: it's "held" until the app
 * calls CrowsCloud.saveNow() (its Save character button). From then on it autosaves like any other.
 */
(function () {
  'use strict';

  var API = 'api.php';
  var DELAY = 300;             // ms after the last change before saving
  var MAX_WAIT = 1500;         // ...but never later than this after the first unsaved change
  var WATCH = 1000;            // how often to check the change signal (a static file: no PHP, no database)
  var POLL = 10000;            // how often to ask the API instead, when there's no signal to watch
  var SLOW_POLL = 60000;       // ...and as a safety net when there is
  var TYPING = 1500;           // hold off bringing in changes for this long after a keystroke in a text field
  // What a Ref may change on a shared character (must match SHARED_FIELDS in server/app/api.php).
  // Both sides add to the log and the XP history, so those are combined rather than compared (union).
  var LINK_FIELDS = [{ name: 'inv', path: ['inv'], label: 'equipment' }, { name: 'notes', path: ['notes'], label: 'notes' },
    { name: 'coins', path: ['coins'], label: 'coins' }, { name: 'conds', path: ['play', 'conds'], label: 'conditions' },
    { name: 'stamina', path: ['play', 'stamina'], label: 'Stamina' }, { name: 'cruelty', path: ['play', 'cruelty'], label: 'cruelty' },
    { name: 'wounds', path: ['play', 'wounds'], label: 'wounds' }, { name: 'log', path: ['play', 'log'], label: 'log', union: true },
    { name: 'txp', path: ['txp'], label: 'total XP' }, { name: 'pendingXP', path: ['play', 'pendingXP'], label: 'pending XP' },
    { name: 'xpLog', path: ['play', 'xpLog'], label: 'XP history', union: true, max: 100 }];

  var cfg = null;              // attach() options
  var user = null, csrf = null;
  var linkId = null;           // set in the Ref's view of a shared character
  var owner = '';              // whose character that is (the Ref's view, or a character someone handed to this user)
  var controller = '';         // who the owner handed the open character to, if anyone
  var rec = null;              // { id, version, watch } of the linked record
  var ready = false;           // true once the account copy is loaded (changes before that are ignored)
  var lastSent = null;         // JSON of the data the server has (as this app represents it)
  var base = null;             // the same, parsed: the common ancestor for three-way merges
  var timer = null, inFlight = false, again = false, retryMs = 0, firstChange = 0;
  var pendingNew = false, fresh = false;
  var hold = false;            // opts.manualNew: a new record waiting for saveNow() before it's in the account
  var heldBase = null;         // the held record as it was when holding started (to warn before leaving with changes)
  var gen = 0;                 // bumped when the app starts a new record, so late replies for the old one are ignored
  var chip = null, bar = null;
  var lastPoll = 0, lastKey = 0;
  var server = false;          // the accounts server answered
  var watches = {};            // change signals being watched: key -> { url, version, onNewer, busy }
  var meDone = false, meWaiting = [];   // afterMe(): callbacks for when it's known who is logged in
  function meKnown() { meDone = true; var w = meWaiting; meWaiting = []; w.forEach(function (f) { try { f(user); } catch (e) { /* the caller's problem */ } }); }

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
  function getAction() { return linkId ? 'link.get' : 'get'; }
  function getQuery(id) { return (linkId ? '' : kq() + '&') + 'id=' + id; }

  // ---------------------------------------------------------------- merging
  /* JSON with sorted keys, so two values compare equal whatever order their keys were written in. */
  function stable(v) {
    if (v === undefined) return 'undefined';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function same(a, b) { return stable(a) === stable(b); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /*
   * Three-way merge of plain JSON: whichever side changed a value since `b` wins; objects merge key by key,
   * the play log combines both sides' new entries, and other arrays and values are taken whole. Returns { value, clashes: [paths changed on both sides] }.
   */
  function merge3(b, l, r, path, clashes) {
    clashes = clashes || [];
    path = path || [];
    var value;
    if (same(l, r) || same(r, b)) value = copy(l);
    else if (same(l, b)) value = copy(r);
    else if (path.join('.') === 'play.log' && Array.isArray(l) && Array.isArray(r)) value = unionLog(b, l, r);   // both add to the log
    else if (isObj(l) && isObj(r)) {
      value = {};
      var bb = isObj(b) ? b : {};
      Object.keys(l).concat(Object.keys(r)).forEach(function (k) {
        if (k in value) return;
        var m = merge3(bb[k], l[k], r[k], path.concat(k), clashes).value;
        if (m !== undefined) value[k] = m;
      });
    } else { clashes.push(path.join('.') || '(everything)'); value = copy(l); }
    return { value: value, clashes: clashes };
  }
  function getPath(o, p) { for (var i = 0; i < p.length; i++) { if (!isObj(o)) return undefined; o = o[p[i]]; } return o; }
  function setPath(o, p, v) {
    for (var i = 0; i < p.length - 1; i++) { if (!isObj(o[p[i]])) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = copy(v);
  }
  /* The player's log plus the entries added here since `b`, newest first (as server/app/api.php merge_log does). */
  function unionLog(b, l, r, max) {
    function key(e) { return e && e.t + '|' + (e.m != null ? e.m : e.desc + '|' + e.xp); }   // a log entry, or an XP history entry
    var out = (Array.isArray(r) ? r : []).slice(), seen = {};
    out.concat(Array.isArray(b) ? b : []).forEach(function (e) { seen[key(e)] = true; });
    (Array.isArray(l) ? l : []).forEach(function (e) { if (!seen[key(e)]) { out.push(e); seen[key(e)] = true; } });
    out.sort(function (x, y) { return (y.t || 0) - (x.t || 0); });
    return out.slice(0, max || 200);
  }
  /* In the Ref's view only the shared fields are theirs; everything else always follows the player. */
  function mergeLinked(b, l, r) {
    var value = copy(r), clashes = [];
    LINK_FIELDS.forEach(function (f) {
      var bv = getPath(b, f.path), lv = getPath(l, f.path), rv = getPath(r, f.path);
      if (same(lv, bv) || same(lv, rv)) return;              // the Ref didn't change it: take the player's
      if (f.union) { setPath(value, f.path, unionLog(bv, lv, rv, f.max)); return; }
      if (!same(rv, bv)) clashes.push(f.label);              // both changed it
      setPath(value, f.path, lv);
    });
    return { value: value, clashes: clashes };
  }

  // ---------------------------------------------------------------- UI
  function injectStyles() {
    var css = '.cloud-chip{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;padding:.2rem .55rem;border-radius:99px;' +
      'border:1px solid #5a5354;color:#f4efe6;white-space:nowrap;min-height:30px}' +
      '.cloud-chip .dot{width:8px;height:8px;border-radius:50%;background:#8a8386}' +
      '.cloud-chip[data-s="saved"] .dot{background:#6fbf7c}.cloud-chip[data-s="saving"] .dot{background:#d9a441}' +
      '.cloud-chip[data-s="unsaved"] .dot{background:transparent;border:1px solid #d9a441}' +
      '.cloud-chip[data-s="error"] .dot,.cloud-chip[data-s="conflict"] .dot{background:#ff7b6e}' +
      '.cloud-home{color:#f4efe6!important;text-decoration:none}' +
      '.cloud-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:60;max-width:calc(100vw - 32px);width:560px;' +
      'background:var(--card,#fff);color:var(--ink,#111);border:2px solid var(--bad,#a3231a);border-radius:8px;padding:.8rem 1rem;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.25);font-size:.92rem}.cloud-bar p{margin:0 0 .6rem}.cloud-bar .row{display:flex;gap:.5rem;flex-wrap:wrap}' +
      '.cloud-notes{position:fixed;right:16px;bottom:16px;z-index:61;display:flex;flex-direction:column;gap:.5rem;max-width:min(380px,calc(100vw - 32px))}' +
      '.cloud-note{background:var(--card,#fff);color:var(--ink,#111);border:1px solid var(--line,#ccc);border-left:5px solid var(--ok,#2f6b3a);border-radius:8px;' +
      'padding:.7rem .9rem;box-shadow:0 4px 18px rgba(0,0,0,.25);font-size:.92rem}.cloud-note.no{border-left-color:var(--warn,#9a5b00)}' +
      '.cloud-note p{margin:0 0 .5rem}.cloud-note .row{display:flex;gap:.4rem;flex-wrap:wrap}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  function actions() { return document.querySelector('.masthead .actions'); }
  function link(text, href, cls) { var a = document.createElement('a'); a.href = href; a.className = cls; a.textContent = text; return a; }

  function showChip() {
    var nav = actions(); if (!nav) return;
    injectStyles();
    var home = link(user ? '⌂ Home' : 'Log in', user ? './#home' : './#login', 'btn btn-ghost cloud-home');
    home.title = user ? 'Back to the home page' : 'Log in to save to your account';
    nav.insertBefore(home, nav.firstChild);
    if (!user) return;
    var after = home;
    if (cfg.kind === 'characters' && !linkId) {
      // Back to the character list (leaving an unsaved new character still asks first: see beforeunload).
      var mine = link('My characters', './#characters', 'btn btn-ghost cloud-home');
      mine.title = 'Back to your saved characters';
      nav.insertBefore(mine, home.nextSibling);
      after = mine;
    }
    chip = document.createElement('span');
    chip.className = 'cloud-chip';
    chip.setAttribute('role', 'status');
    chip.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    nav.insertBefore(chip, after.nextSibling);
    status('loading', 'Loading…');
  }
  function delegated() { return !linkId && !!owner; }   // playing a character someone handed to this user
  function status(s, text, title) {
    if (cfg && cfg.onStatus) cfg.onStatus(s);
    if (!chip) return;
    chip.setAttribute('data-s', s);
    chip.querySelector('.txt').textContent = (owner ? owner + '’s crow · ' : controller ? 'Handed to ' + controller + ' · ' : '') + text;
    chip.title = title || (linkId ? 'Ref view: you can change the vitals, equipment, notes, and XP'
      : owner ? owner + ' handed you this crow to play. They can take it back at any time.'
      : controller ? controller + ' can play this crow too until you take it back (My characters, Delegate Control).'
      : user ? 'Account: ' + user.username : '');
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

  // ---------------------------------------------------------------- notifications
  /*
   * Messages for this account (a Ref accepted or declined a join request), shown in the corner until
   * dismissed. New ones pop up within a second or two of being sent, through the ('notes', user) change signal.
   * Not in a Ref's view of someone else's sheet: that's the Ref's account, and their own pages show theirs.
   */
  var notesBox = null, shownNotes = {}, notesLoaded = false;
  function noteText(n) {
    var d = n.detail || {}, crow = d.character || 'your crow', camp = d.campaign || 'their campaign';
    if (n.kind === 'join_accepted') return d.ref + ' accepted ' + crow + ' into ' + camp + '.';
    if (n.kind === 'join_declined') return d.ref + ' declined ' + crow + '\u2019s request to join ' + camp + '.';
    if (n.kind === 'control_given') return d.owner + ' handed you ' + crow + ' to play.';
    if (n.kind === 'control_taken') return d.owner + ' took back control of ' + crow + '.';
    if (n.kind === 'control_returned') return d.by + ' handed ' + crow + ' back to you.';
    if (n.kind === 'control_claimed') return d.by + ' (Ref of ' + (d.campaign || 'your campaign') + ') took control of ' + crow + '.';
    return null;
  }
  function showNote(n) {
    var text = noteText(n);
    if (!text || shownNotes[n.id]) return;
    shownNotes[n.id] = true;
    // Accepted just now (not a note left from before this page opened): the open crow is in that campaign.
    if (notesLoaded && n.kind === 'join_accepted' && n.detail && rec && rec.id === n.detail.characterId && cfg.onJoined) {
      cfg.onJoined(n.detail.campaign || 'Untitled campaign');
    }
    injectStyles();
    if (!notesBox) { notesBox = document.createElement('div'); notesBox.className = 'cloud-notes'; notesBox.setAttribute('role', 'status'); document.body.appendChild(notesBox); }
    var box = document.createElement('div');
    box.className = 'cloud-note' + (n.kind === 'join_declined' || n.kind === 'control_taken' ? ' no' : '');
    var p = document.createElement('p'); p.textContent = text; box.appendChild(p);
    var row = document.createElement('div'); row.className = 'row';
    function add(label, cls, on) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-small ' + cls; b.textContent = label; b.addEventListener('click', on); row.appendChild(b); }
    function dismiss() { box.remove(); call('POST', 'notes.dismiss', '', { id: n.id }).then(null, function () { /* shown again next time */ }); }
    if ((n.kind === 'join_accepted' || n.kind === 'control_given') && n.detail && n.detail.characterId && cfg.kind === 'characters' && !(rec && rec.id === n.detail.characterId)) {
      add('Open ' + (n.detail.character || 'that crow'), 'btn-primary', function () { dismiss(); location.href = 'play?id=' + n.detail.characterId; });
    }
    add('OK', '', dismiss);
    box.appendChild(row);
    notesBox.appendChild(box);
  }
  function loadNotes() {
    return call('GET', 'notes.list').then(function (j) {
      j.items.slice(0, 5).reverse().forEach(showNote);
      notesLoaded = true;
      Cloud.watch('notes', j.watch, j.latest, loadNotes);
    }, function () { /* no notifications here (older server): nothing to show */ });
  }

  // ---------------------------------------------------------------- linking
  function linkKey() { return 'crows-cloud-' + cfg.kind + '-' + user.id; }
  function remember(id) {
    if (linkId) return;
    // Someone else's crow isn't reopened by default: it may be taken back before next time.
    if (!delegated()) try { if (id) localStorage.setItem(linkKey(), String(id)); else localStorage.removeItem(linkKey()); } catch (e) { /* ignore */ }
    var url = location.pathname + (id ? '?id=' + id : '') + location.hash;
    try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
  }
  function remembered() { try { return parseInt(localStorage.getItem(linkKey()), 10) || null; } catch (e) { return null; } }

  /* Show `data` in the app and treat it as what the server has. */
  function adoptRemote(item, data) {
    rec = { id: item.id, version: item.version, watch: item.watch || (rec && rec.id === item.id ? rec.watch : null) };
    if (item.owner) owner = item.owner;
    if (!linkId) controller = item.controller || '';
    cfg.apply(copy(data));
    synced();
  }
  /* The app's current state is exactly what the server has. */
  function synced() {
    lastSent = JSON.stringify(cfg.getData());
    base = JSON.parse(lastSent);
  }

  function openRecord(id) {
    return call('GET', getAction(), getQuery(id)).then(function (j) {
      var item = j.item;
      if (!cfg.valid(item.data)) throw new Error('That save could not be read.');
      adoptRemote(item, item.data);
      remember(item.id);
      return item;
    });
  }

  // ---------------------------------------------------------------- saving
  function payload(data) { return { data: data, name: cfg.name(data) || '', summary: cfg.summary(data) || '' }; }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { flush(); }, ms); }
  function busy() { return !!(timer || inFlight); }

  function flush(force) {
    clearTimeout(timer); timer = null; firstChange = 0;
    if (!ready || !user || hold) return;
    if (inFlight) { again = true; return; }
    var data = cfg.getData(), json = JSON.stringify(data);
    if (rec && json === lastSent && !force) { status('saved', 'Saved'); return; }
    if (linkId) return flushLinked(data, json);
    inFlight = true; again = false;
    // The first content sent after startNew() is the new record; anything sent after that is an edit.
    if (pendingNew) { pendingNew = false; fresh = true; } else fresh = false;
    status('saving', 'Saving…');
    var body = payload(data), p, myGen = gen;
    if (rec) { body.id = rec.id; body.version = rec.version; if (force) body.force = true; p = call('POST', 'save', kq(), body); }
    else p = call('POST', 'create', kq(), body);
    p.then(function (j) {
      if (myGen !== gen) return;
      rec = { id: j.item.id, version: j.item.version, watch: j.item.watch || null };
      lastSent = json; base = JSON.parse(json); retryMs = 0;
      remember(rec.id);
      status('saved', 'Saved', 'Saved to your account at ' + new Date().toLocaleTimeString());
    }, function (e) {
      if (myGen !== gen) return;
      if (e.status === 409 && e.body && e.body.item) return changedElsewhere(e.body.item.id);
      if (e.status === 404 && rec && !delegated()) { rec = null; remember(null); again = true; return; }  // deleted elsewhere: save as new
      failed(e);
    }).then(function () {
      if (myGen !== gen) return;   // startNew() already released the lock
      inFlight = false;
      if (again) schedule(300);
    });
  }

  /* The Ref's save: just the shared fields that differ from what the server last had. */
  function flushLinked(data, json) {
    var fields = {}, from = {}, n = 0, snap = cfg.refOps ? cfg.refOps.start() : null;
    LINK_FIELDS.forEach(function (f) {
      var lv = getPath(data, f.path), bv = getPath(base, f.path);
      if (!same(lv, bv)) { fields[f.name] = lv === undefined ? null : lv; from[f.name] = bv === undefined ? null : bv; n++; }
    });
    if (!n) { lastSent = json; status('saved', 'Saved'); return; }   // nothing the Ref may change was changed
    inFlight = true; again = false;
    status('saving', 'Saving…');
    call('POST', 'link.save', '', { id: linkId, fields: fields, base: from }).then(function (j) {
      retryMs = 0;
      var item = j.item;
      rec.version = item.version;
      if (snap) cfg.refOps.saved(snap);
      // Show the player's latest too, unless the Ref has changed something new meanwhile.
      if (JSON.stringify(cfg.getData()) === json) adoptRemote(item, item.data);
      else base = item.data;
      status('saved', 'Saved', 'Saved to ' + owner + '’s character at ' + new Date().toLocaleTimeString());
    }, function (e) {
      if (e.status === 409 && e.body && e.body.item) return mergeIn(e.body.item, true);
      failed(e);
    }).then(function () {
      inFlight = false;
      if (again) schedule(300);
    });
  }

  function failed(e) {
    if (delegated() && e.status === 404) {
      // The player took their crow back (or deleted it): stop saving to it, and don't make a copy in this account.
      ready = false; clearTimeout(timer); timer = null;
      status('error', 'Taken back', e.message);
      showBar(owner + ' has taken back control of this crow, so changes here are no longer saved.', [
        { text: 'Home', cls: 'btn-primary', on: function () { location.href = './#home'; } },
        { text: 'Dismiss', cls: 'btn-ghost', on: closeBar }]);
      return;
    }
    if (e.status === 401 || e.status === 403 || (linkId && e.status === 404)) {
      status('error', 'Not saved', e.message);
      showBar(e.message + (linkId ? '' : ' Your changes are kept in this browser until you log in again.'), [
        { text: linkId ? 'Home' : 'Log in', cls: 'btn-primary', on: function () { location.href = linkId ? './#home' : './#login'; } },
        { text: 'Dismiss', cls: 'btn-ghost', on: closeBar }]);
      return;
    }
    if (e.status === 413 || e.status === 409) { status('error', 'Not saved', e.message); showBar(e.message, [{ text: 'OK', on: closeBar }]); return; }
    // Network trouble or a server hiccup: keep retrying, slower each time.
    retryMs = Math.min(60000, retryMs ? retryMs * 2 : 4000);
    status('error', 'Offline, retrying', 'Could not reach the server (' + e.message + '). Changes are kept in this browser.');
    schedule(retryMs);
  }

  /* Someone else saved first: fetch their version and merge it with ours. */
  function changedElsewhere(id) {
    call('GET', getAction(), getQuery(id)).then(function (j) { mergeIn(j.item, true); }, failed);
  }

  /*
   * Bring in a newer version from the server. With nothing unsaved here it's simply shown; otherwise it's
   * merged with the local changes, which are then saved on top. A real clash asks which side to keep.
   */
  function mergeIn(item, thenSave) {
    if (!cfg.valid(item.data)) return;
    var before = cfg.getData();            // for onRemote to say what changed
    // Unsaved here are only changes sent from the Ref Screen, which are steps (Stamina -1, XP +130): take the
    // player's version and redo them on top. (A value merge would drop one of two equal hits as "the same".)
    if (linkId && cfg.refOps && cfg.refOps.canRedo()) {
      adoptRemote(item, item.data);
      cfg.refOps.redo();
      if (cfg.onRemote) cfg.onRemote(before);
      flush();
      return;
    }
    var local = before;
    var m = linkId ? mergeLinked(base, local, item.data) : merge3(base, local, item.data);
    if (m.clashes.length) return clash(item, m.clashes);
    var unsaved = !same(m.value, item.data);
    adoptRemote(item, item.data);          // the server's version is the new common ancestor...
    if (unsaved) cfg.apply(m.value);       // ...with our own changes laid back on top
    if (cfg.onRemote) cfg.onRemote(before);
    if (unsaved && thenSave !== false) flush();
    else status('saved', 'Saved');
  }

  function clash(item, where) {
    status('conflict', 'Changed elsewhere');
    var who = linkId ? 'The player' : 'Another window or device';
    var what = linkId ? 'this character’s ' + where.join(', ') : 'this ' + (cfg.kind === 'campaigns' ? 'campaign' : 'character');
    showBar(who + ' changed ' + what + ' at the same time as you (saved ' + new Date(item.updatedAt).toLocaleTimeString() + '). Which version do you want to keep?', [
      { text: 'Keep mine', cls: 'btn-primary', on: function () {
        closeBar();
        // Re-base onto theirs, then resend ours.
        var mine = cfg.getData();
        if (linkId) {
          var mixed = copy(item.data);
          LINK_FIELDS.forEach(function (f) { setPath(mixed, f.path, getPath(mine, f.path)); });
          adoptRemote(item, item.data);
          cfg.apply(mixed);
        } else {
          rec = { id: item.id, version: item.version, watch: rec && rec.id === item.id ? rec.watch : null };
          base = copy(item.data); lastSent = JSON.stringify(item.data);
        }
        flush(true);
      } },
      { text: 'Use theirs', cls: 'btn-ghost', on: function () { closeBar(); adoptRemote(item, item.data); status('saved', 'Saved'); } }]);
  }

  /* Someone is typing in a text field: replacing the page under them would move their cursor. */
  function typing() {
    var a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && Date.now() - lastKey < TYPING;
  }

  /* Look for changes made elsewhere (another device, the player, or their Ref). */
  function poll() {
    if (!ready || !user || !rec || busy() || bar || typing() || document.visibilityState === 'hidden') return;
    lastPoll = Date.now();
    var myGen = gen, id = rec.id;
    call('GET', getAction(), getQuery(id) + '&known=' + rec.version).then(function (j) {
      if (myGen !== gen || !rec || rec.id !== id || busy() || j.item.unchanged) return;
      mergeIn(j.item);
    }, function (e) { if (e.status === 404 || e.status === 403) failed(e); });
  }
  /* The API poll is the fallback; with a change signal to watch it only runs now and then. */
  function slowPoll() { if (Date.now() - lastPoll >= (rec && rec.watch ? SLOW_POLL : POLL) - 500) poll(); }

  /*
   * Check every watched change signal: the open record's, plus any the app registered with watch() (the
   * Ref Screen watches its linked crows). A file holding a version newer than the one we have means fetch it.
   */
  var checking = false;
  function checkSignals() {
    if (checking || !ready || !user || document.visibilityState === 'hidden') return;
    var list = [];
    if (rec && rec.watch) list.push({ url: rec.watch, version: rec.version, onNewer: poll });
    Object.keys(watches).forEach(function (k) { if (!watches[k].busy) list.push(watches[k]); });
    if (!list.length) return;
    checking = true;
    Promise.all(list.map(function (w) {
      return fetch(w.url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (t) {
          var v = parseInt(t, 10);
          if (!(v > w.version) || w.busy) return;
          if (w.onNewer === poll) { poll(); return; }
          w.busy = true;
          return Promise.resolve(w.onNewer(v)).then(null, function () { /* tried again next time */ }).then(function () { w.busy = false; });
        }, function () { /* offline: the API poll will report it */ });
    })).then(function () { checking = false; });
  }

  // Last-chance save when the page is hidden or closed (keepalive bodies are capped near 64 KB).
  /* Start holding a new record: nothing goes to the account until saveNow(). */
  function startHold() {
    hold = true; heldBase = JSON.stringify(cfg.getData());
    status('unsaved', 'Not saved yet', 'This character isn\u2019t in your account yet. Use Save character.');
  }
  function heldChanges() { return hold && JSON.stringify(cfg.getData()) !== heldBase; }

  function flushOnExit() {
    if (!ready || !user || !rec || inFlight) return;
    var data = cfg.getData(), json = JSON.stringify(data);
    if (json === lastSent) return;
    if (linkId || json.length > 60000) { flush(); return; }
    clearTimeout(timer);
    var body = payload(data); body.id = rec.id; body.version = rec.version;
    call('POST', 'save', kq(), body, true).then(function (j) { rec.version = j.item.version; lastSent = json; base = JSON.parse(json); }, function () { /* retried on return */ });
  }

  // ---------------------------------------------------------------- public API
  var Cloud = {
    get user() { return user; },
    get active() { return !!user && ready; },
    get owner() { return owner; },
    /* Who the open character was handed to (when this user owns it), or ''. */
    get controller() { return controller; },
    /* The id of the open record in the account, once it has one. */
    get recordId() { return rec && !linkId ? rec.id : null; },
    /* True once the accounts server has answered (logged in or not). */
    get server() { return server; },
    /*
     * The name of the campaign the open character is currently playing in (in a Ref's party, active or sitting
     * out), or null. Resolves null when there's no open record in the account.
     */
    campaign: function () {
      var id = Cloud.recordId;
      if (!user || !id || cfg.kind !== 'characters') return Promise.resolve(null);
      return call('GET', 'characters.campaigns').then(function (j) {
        var mine = ((j.campaigns || {})[id] || []).filter(function (c) { return c.campaign && (c.state === 'active' || c.state === 'away'); });
        var cur = mine.filter(function (c) { return c.state === 'active'; })[0] || mine[0];
        return cur ? cur.campaign : null;
      });
    },
    /* True in a Ref's view of a player's shared character (?link=). Known before attach() runs. */
    get linked() { return /^https?:$/.test(location.protocol) && !!parseInt(params().link, 10); },

    /*
     * opts: kind ('characters' | 'campaigns'), getData(), apply(data), valid(data),
     *       name(data), summary(data), fresh() (make a brand-new thing for ?new=1), onReady(params), onServer() (the accounts server answered),
     *       onJoined(campaign) (a Ref just accepted the open character into that campaign),
     *       onRemote(before) (a change made elsewhere was just brought in; `before` is what getData() gave just before)
     */
    attach: function (opts) {
      cfg = opts;
      if (!/^https?:$/.test(location.protocol) || !window.fetch) { meKnown(); return; }
      var p = params();
      linkId = cfg.kind === 'characters' ? parseInt(p.link, 10) || null : null;
      call('GET', 'me').then(function (j) {
        user = j.user; csrf = j.csrf; server = true;
        if (cfg.onServer) cfg.onServer();
        if (user && (cfg.kind === 'campaigns' || linkId) && !user.canRef) user = null;
        showChip();
        meKnown();
        if (!user) {
          if (linkId) showBar('Log in with your Ref account to see this character.', [{ text: 'Log in', cls: 'btn-primary', on: function () { location.href = './#login'; } }]);
          return;
        }
        var id = parseInt(p.id, 10) || null;
        var step;
        if (linkId) step = openRecord(linkId);
        else if (p['new'] !== undefined) { cfg.fresh(); pendingNew = true; step = Promise.resolve(); remember(null); }
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
          if (rec) status('saved', 'Saved'); else if (cfg.manualNew && !linkId) startHold(); else flush();
          lastPoll = Date.now();
          if (!linkId) loadNotes();
          setInterval(slowPoll, 1000);
          setInterval(checkSignals, WATCH);
        }, function (e) {
          status('error', 'Not loaded', e.message);
          showBar((linkId ? 'Could not open this character: ' : 'Could not open that save: ') + e.message +
            (linkId ? '' : ' You are looking at the copy kept in this browser, which is not being saved to your account.'), [
            { text: 'Home', cls: 'btn-primary', on: function () { location.href = './#home'; } },
            { text: 'Retry', cls: 'btn-ghost', on: function () { location.reload(); } }]);
        });
      }, function () { meKnown(); /* no accounts server here: stay browser-only */ });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushOnExit(); else { poll(); checkSignals(); } });
      document.addEventListener('input', function () { lastKey = Date.now(); }, true);
      window.addEventListener('pagehide', flushOnExit);
      // A held new character with changes isn't anywhere but this browser: ask before leaving it.
      window.addEventListener('beforeunload', function (e) { if (heldChanges()) { e.preventDefault(); e.returnValue = ''; } });
    },

    /* Called from the app's save(). Cheap: the real work is debounced. */
    changed: function () {
      if (!ready || !user) return;
      if (hold) return;   // a new record waits for saveNow()
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
      if (!ready || !user || linkId) return;
      if (owner || controller) { owner = ''; controller = ''; }   // the new one is this user's own
      if (cfg.manualNew) {
        // Save what was open (if it's in the account), then hold the new one until Save character.
        if (!hold && (timer || (rec && JSON.stringify(cfg.getData()) !== lastSent))) flush();
        gen++; rec = null; lastSent = null; base = null; remember(null);
        inFlight = false; pendingNew = true; fresh = false;
        clearTimeout(timer); timer = null;
        setTimeout(startHold, 0);   // after the app has put the new character in place
        return;
      }
      var reuse = fresh && (rec || inFlight);
      if (!reuse) {
        if (timer || (rec && JSON.stringify(cfg.getData()) !== lastSent)) flush();
        gen++; rec = null; lastSent = null; base = null; remember(null);
        inFlight = false;   // a reply for the old record is now ignored, so don't wait on it
      }
      pendingNew = true;
      if (!reuse) fresh = false;
    },

    /*
     * Watch another record's change signal (item.watch from the API) and call onNewer(version) soon after it
     * changes; the call is repeated until watch() is called again with that version or newer. A promise
     * returned from onNewer holds off the next call until it settles. watch(key, null) stops watching.
     */
    watch: function (key, url, version, onNewer) {
      if (!url) { delete watches[key]; return; }
      var w = watches[key];
      if (w && w.url === url) { w.version = Math.max(w.version, version); w.onNewer = onNewer; }
      else watches[key] = { url: url, version: version, onNewer: onNewer, busy: false };
    },
    /* True while someone is typing in a text field (so a page can hold off re-rendering under them). */
    get typing() { return typing(); },

    /* True while a new record is waiting for saveNow() (opts.manualNew). */
    get held() { return hold; },
    /* Save now: a held new record goes into the account (and autosaves from then on); otherwise any pending change is sent. */
    saveNow: function () {
      if (!ready || !user || linkId) return;
      hold = false; heldBase = null; pendingNew = !rec;
      flush();   // never forced: an existing record still merges with changes made elsewhere
    },

    /* Call fn(user) once it's known who is logged in (user is null for a guest, offline, or without the accounts server). */
    afterMe: function (fn) { if (meDone) fn(user); else meWaiting.push(fn); },
    /* For the Ref Screen: calls the API with this page's login. */
    api: function (method, action, query, body) { return call(method, action, query, body); }
  };
  window.CrowsCloud = Cloud;
})();
