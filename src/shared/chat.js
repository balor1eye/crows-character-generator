/*
 * Campaign chat panel for the Play page and the Ref Screen (window.CrowsChat): a Chat button in the corner that opens a
 * panel over the page, so a table can talk without leaving the sheet or the fight. Same chat as the accounts site's
 * Chat page (server/app/chat.php): messages for everyone, private ones between a player and the Ref, and the Ref's
 * announcements. Only shown to someone logged in with a campaign to chat in. Needs CrowsDom and CrowsCloud.
 */
(function () {
  'use strict';
  var Dom = window.CrowsDom, Cloud = window.CrowsCloud;
  if (!Dom || !Cloud) return;
  var el = Dom.el, btn = Dom.btn;
  var KEY = 'crows-chat-campaign', BADGE_POLL = 60000, LIVE_POLL = 2500;
  var TEMPLATES = [
    ['Session soon', 'Our session starts in 15 minutes. Please get your crow ready!'],
    ['Session scheduled', 'Next session: [day and time]. Reply here if you can’t make it.'],
    ['Cancelled', 'Tonight’s session is cancelled. I’ll post the new time here.'],
    ['Availability', 'Please reply with the days you’re free this week so I can schedule the next session.']
  ];

  var started = false, camps = [], cur = null, isOpen = false, info = { isRef: false, members: [], ref: '' };
  var seen = 0, shown = {}, loading = false, watchUrl = null, ticks = 0, mode = 'chat', timer = null;
  var fab, badge, panel, select, log, pinned, text, to, mail, modeBox, extra, tmpl, sendBtn, sub;

  function api(method, action, query, body) { return Cloud.api(method, action, query, body); }
  function when(iso) {
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return d.toLocaleDateString();
  }
  function remembered() { try { return parseInt(localStorage.getItem(KEY), 10) || null; } catch (e) { return null; } }
  function remember(id) { try { localStorage.setItem(KEY, String(id)); } catch (e) { /* ignore */ } }

  function styles() {
    if (document.getElementById('chat-styles')) return;
    var css = '.chat-fab{position:fixed;left:14px;bottom:14px;z-index:60;box-shadow:var(--shadow)}' +
      '.chat-fab .count{display:inline-block;min-width:1.2rem;margin-left:.35rem;padding:0 .3rem;border-radius:999px;background:var(--accent);color:#fff;font-size:.72rem;font-weight:700;text-align:center}' +
      '.chat-panel{position:fixed;left:14px;bottom:60px;z-index:61;width:min(400px,calc(100vw - 28px));max-height:min(620px,calc(100vh - 80px));display:flex;flex-direction:column;' +
      'background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 6px 24px rgba(0,0,0,.3);font:14px var(--font)}' +
      '.chat-panel[hidden]{display:none}' +
      '.chat-head{display:flex;gap:.5rem;align-items:center;padding:.5rem .7rem;border-bottom:1px solid var(--line)}' +
      '.chat-head select{flex:1;min-width:0;padding:.3rem;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);font:inherit}' +
      '.chat-head strong{flex:1}' +
      '.chat-sub{padding:.2rem .7rem;font-size:.78rem;color:var(--muted)}' +
      '.chat-pin{margin:.4rem .7rem 0;padding:.35rem .6rem;border:1px solid var(--accent);border-left-width:5px;border-radius:8px;background:var(--soft);font-size:.85rem;max-height:6.5em;overflow:auto}' +
      '.chat-pin .chat-body{margin-top:.1rem}' +
      '.chat-log{flex:1;min-height:160px;overflow-y:auto;padding:.5rem .7rem;display:flex;flex-direction:column;gap:.4rem}' +
      '.chat-msg{max-width:88%;padding:.3rem .6rem;border-radius:10px;background:var(--soft);border:1px solid var(--line);align-self:flex-start}' +
      '.chat-msg.mine{align-self:flex-end}.chat-msg.announce{align-self:stretch;max-width:none;border-left:4px solid var(--accent)}.chat-msg.private{border-style:dashed}' +
      '.chat-meta{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap;font-size:.75rem;color:var(--muted)}.chat-meta strong{color:var(--ink)}' +
      '.chat-tag{font-size:.65rem;font-weight:700;padding:0 .45rem;border-radius:999px;border:1px solid var(--accent);color:var(--accent)}' +
      '.chat-del{margin-left:auto;min-height:0!important;padding:0 .4rem!important}' +
      '.chat-body{white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.chat-compose{padding:.5rem .7rem;border-top:1px solid var(--line);display:grid;gap:.35rem}' +
      '.chat-modes{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.85rem}.chat-modes label{display:inline-flex;gap:.25rem;align-items:center}' +
      '.chat-compose textarea,.chat-compose select{width:100%;padding:.4rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);font:inherit}' +
      '.chat-compose textarea{resize:vertical;min-height:3.2em}' +
      '.chat-tmpl{display:flex;gap:.3rem;flex-wrap:wrap}.chat-note{font-size:.78rem;color:var(--muted)}' +
      '.chat-row{display:flex;gap:.6rem;align-items:center}' +
      '@media print{.chat-fab,.chat-panel{display:none!important}}';
    var s = document.createElement('style'); s.id = 'chat-styles'; s.textContent = css; document.head.appendChild(s);
  }

  // ---------------------------------------------------------------- unread badge on the button
  function setBadge(n) { badge.textContent = n ? String(n) : ''; badge.hidden = !n; fab.setAttribute('aria-label', 'Chat' + (n ? ', ' + n + ' unread' : '')); }
  function refreshCampaigns() {
    return api('GET', 'chat.campaigns').then(function (j) {
      camps = j.campaigns;
      if (!camps.length) { if (fab) { fab.hidden = true; } if (isOpen) toggle(false); return; }
      if (fab) fab.hidden = false;
      setBadge(camps.reduce(function (n, c) { return n + (c.id === cur && isOpen ? 0 : c.unread); }, 0));
      if (isOpen) drawSelect();
    }, function () { /* not logged in, or no chat on this server: nothing to show */ });
  }
  function pick() {
    var want = Cloud.kind === 'campaigns' ? Cloud.recordId : null, ids = camps.map(function (c) { return c.id; });
    if (cur && ids.indexOf(cur) >= 0) return cur;
    if (want && ids.indexOf(want) >= 0 && camps.some(function (c) { return c.id === want && c.isRef; })) return want;
    var r = remembered();
    if (r && ids.indexOf(r) >= 0) return r;
    var u = camps.filter(function (c) { return c.unread; })[0];
    return (u || camps[0]).id;
  }

  // ---------------------------------------------------------------- the panel
  function drawSelect() {
    select.innerHTML = '';
    camps.forEach(function (c) { select.appendChild(el('option', { value: c.id, text: c.name + (c.unread && c.id !== cur ? ' (' + c.unread + ')' : ''), selected: c.id === cur ? true : null })); });
    select.hidden = camps.length < 2;
    head.querySelector('strong').hidden = camps.length >= 2;
    head.querySelector('strong').textContent = (camps.filter(function (c) { return c.id === cur; })[0] || { name: 'Chat' }).name;
  }
  var head;
  function build() {
    styles();
    fab = btn('', function () { toggle(!isOpen); }, 'chat-fab btn-small', 'Chat with your Ref and players');
    fab.hidden = true;
    fab.appendChild(document.createTextNode('💬 Chat'));
    badge = el('span', { class: 'count', hidden: true }); fab.appendChild(badge);
    select = el('select', { 'aria-label': 'Campaign', onchange: function () { switchTo(parseInt(this.value, 10)); } });
    head = el('div', { class: 'chat-head' }, [el('strong', { text: 'Chat' }), select,
      btn('×', function () { toggle(false); }, 'btn-small btn-ghost', 'Close chat')]);
    sub = el('div', { class: 'chat-sub' });
    pinned = el('div');
    log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    text = el('textarea', { rows: 2, maxlength: 2000, placeholder: 'Write a message…', 'aria-label': 'Message' });
    text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    to = el('select', { 'aria-label': 'Send privately to' });
    mail = el('input', { type: 'checkbox' });
    modeBox = el('div', { class: 'chat-modes' }); extra = el('div'); tmpl = el('div', { class: 'chat-tmpl' });
    sendBtn = btn('Send', send, 'btn-primary btn-small');
    panel = el('div', { class: 'chat-panel', role: 'dialog', 'aria-label': 'Campaign chat', hidden: true }, [head, sub, pinned, log,
      el('div', { class: 'chat-compose' }, [modeBox, extra, tmpl, text, el('div', { class: 'chat-row' }, [sendBtn, el('span', { class: 'chat-note', text: 'Enter sends' })])])]);
    document.body.appendChild(fab); document.body.appendChild(panel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen && panel.contains(document.activeElement)) toggle(false); });
  }
  function toggle(open) {
    isOpen = open; panel.hidden = !open;
    clearTimeout(timer);
    if (!open) { setBadge(camps.reduce(function (n, c) { return n + c.unread; }, 0)); return; }
    cur = pick(); drawSelect(); switchTo(cur);
    setTimeout(function () { text.focus(); }, 50);
  }
  function switchTo(id) {
    cur = id; remember(id); seen = 0; shown = {}; watchUrl = null; mode = 'chat'; ticks = 0;
    log.innerHTML = ''; log.appendChild(el('p', { class: 'chat-note', text: 'Loading…' }));
    drawSelect(); load(true);
    clearTimeout(timer); timer = setTimeout(tick, LIVE_POLL);
  }

  function setMode(m) { mode = m; drawComposer(); }
  function drawComposer() {
    var opts = [['chat', 'Everyone']];
    if (info.isRef) opts.push(['announce', 'Announcement'], ['private', 'Private']);
    else opts.push(['private', 'Private to Ref']);
    modeBox.innerHTML = '';
    opts.forEach(function (o) {
      modeBox.appendChild(el('label', null, [el('input', { type: 'radio', name: 'chat-mode', checked: mode === o[0] ? true : null, onchange: function () { setMode(o[0]); } }), ' ' + o[1]]));
    });
    extra.innerHTML = '';
    if (mode === 'private' && info.isRef) {
      to.innerHTML = '';
      info.members.forEach(function (m) { to.appendChild(el('option', { value: m.username, text: m.username + (m.crows.length ? ' (' + m.crows.join(', ') + ')' : '') })); });
      extra.appendChild(to);
    }
    if (mode === 'announce') extra.appendChild(el('label', { class: 'chat-note' }, [mail, ' Also email every player']));
    if (mode === 'private') extra.appendChild(el('div', { class: 'chat-note', text: 'Only you and ' + (info.isRef ? 'that player' : info.ref) + ' see this.' }));
    tmpl.innerHTML = '';
    if (info.isRef) TEMPLATES.forEach(function (t) {
      tmpl.appendChild(btn(t[0], function () { mode = 'announce'; drawComposer(); text.value = t[1]; text.focus(); }, 'btn-small btn-ghost', 'Fill in this announcement'));
    });
  }

  function line(m) {
    var tag = m.kind === 'announce' ? 'Announcement' : m.kind === 'private' ? (m.mine ? 'Private to ' + m.to : 'Private from ' + m.from) : null;
    var node = el('div', { class: 'chat-msg ' + m.kind + (m.mine ? ' mine' : '') }, [
      el('div', { class: 'chat-meta' }, [el('strong', { text: m.mine ? 'You' : m.from }), tag ? el('span', { class: 'chat-tag', text: tag }) : null,
        el('span', { text: when(m.at), title: new Date(m.at).toLocaleString() }),
        (info.isRef || m.mine) ? btn('×', function () {
          if (!confirm('Remove this message?')) return;
          api('POST', 'chat.delete', '', { id: m.id }).then(function () { node.remove(); }, function (e) { Dom.toast(e.message); });
        }, 'btn-small btn-ghost chat-del', 'Remove this message') : null]),
      el('div', { class: 'chat-body', text: m.text })]);
    node._m = m;
    return node;
  }
  function add(msgs, initial) {
    var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (initial) log.innerHTML = '';
    msgs.forEach(function (m) { if (shown[m.id]) return; shown[m.id] = true; log.appendChild(line(m)); seen = Math.max(seen, m.id); });
    var e = log.querySelector('.chat-empty'); if (e) e.remove();
    if (!log.children.length) log.appendChild(el('p', { class: 'chat-note chat-empty', text: 'No messages yet. Say hello!' }));
    if (initial || stick) log.scrollTop = log.scrollHeight;
    var last = null;
    Array.prototype.forEach.call(log.querySelectorAll('.chat-msg.announce'), function (n) { last = n; });
    pinned.innerHTML = '';
    if (last) pinned.appendChild(el('div', { class: 'chat-pin' }, [el('strong', { text: 'Announcement' }), el('div', { class: 'chat-body', text: last._m.text })]));
  }
  function load(initial) {
    if (loading || !isOpen) return Promise.resolve();
    loading = true;
    var id = cur;
    return api('GET', 'chat.list', 'campaign=' + id + '&read=1' + (initial ? '' : '&after=' + seen)).then(function (j) {
      loading = false;
      if (id !== cur) return;
      if (initial) {
        info = { isRef: j.isRef, members: j.members, ref: j.campaign.ref };
        sub.textContent = (j.isRef ? 'You are the Ref. ' : 'Ref: ' + j.campaign.ref + '. ') + (j.members.length ? 'Players: ' + j.members.map(function (m) { return m.username; }).join(', ') : 'No players yet');
        drawComposer();
      }
      watchUrl = j.watch || null;
      add(j.messages, initial);
      camps.forEach(function (c) { if (c.id === id) c.unread = 0; });
      setBadge(camps.reduce(function (n, c) { return n + c.unread; }, 0));
    }, function (e) {
      loading = false;
      if (initial) { log.innerHTML = ''; log.appendChild(el('p', { class: 'chat-note', text: e.message })); }
    });
  }
  function send() {
    var t = text.value.trim();
    if (!t) return;
    var body = { campaign: cur, kind: mode, text: t };
    if (mode === 'private' && info.isRef) body.to = to.value;
    if (mode === 'announce') {
      body.email = mail.checked;
      if (!confirm('Send this announcement to every player in the campaign' + (body.email ? ', and email it' : '') + '?')) return;
    }
    sendBtn.disabled = true;
    api('POST', 'chat.send', '', body).then(function (j) {
      sendBtn.disabled = false; text.value = '';
      if (body.kind === 'announce') Dom.toast('Announcement sent to ' + Dom.plural(j.players, 'player') + (body.email ? ' (' + j.emailed + ' emailed).' : '.'));
      load(false);
    }, function (e) { sendBtn.disabled = false; Dom.toast(e.message); });
  }
  function tick() {
    if (!isOpen) return;
    timer = setTimeout(tick, LIVE_POLL);
    ticks++;
    if (document.hidden) return;
    if (watchUrl) {
      fetch(watchUrl, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
        if ((parseInt(t, 10) || 0) > seen || ticks % 12 === 0) load(false);
      }, function () { /* next time */ });
    } else load(false);
  }

  function start(user) {
    if (started || !user) return;
    started = true;
    build();
    refreshCampaigns();
    setInterval(function () { if (!document.hidden && !isOpen) refreshCampaigns(); }, BADGE_POLL);
  }
  Cloud.afterMe(start);
  window.CrowsChat = {
    /* Open the panel (on a campaign, if it's one of this person's). */
    open: function (campaignId) {
      if (!started) return false;
      var go = function () { if (campaignId) cur = campaignId; toggle(true); };
      if (camps.length) go(); else refreshCampaigns().then(go);
      return true;
    }
  };
})();
