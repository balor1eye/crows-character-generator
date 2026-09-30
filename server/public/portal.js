/*
 * Crows accounts portal: log in / create an account / reset a password, then a home page that leads to
 * character creation, saved characters, play, and (for Refs) campaigns and the Ref Screen, plus account
 * settings and (for admins) account management. Routes live in the URL hash (#login, #home, ...).
 */
(function () {
  'use strict';

  var GEN = 'Crows_Character_Generator.html';
  var REF = 'ref.php';
  var me = null, csrf = null, https = true;

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function btn(text, on, cls, title) { return el('button', { type: 'button', class: 'btn ' + (cls || ''), text: text, onclick: on, title: title || null }); }
  function a(text, href, cls) { return el('a', { class: cls === undefined ? 'btn' : cls, href: href, text: text }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function when(iso) {
    var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    return d.toLocaleDateString();
  }
  function fileBase(name) { return String(name || 'Crows').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'Crows'; }
  function download(text, filename) {
    var blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: filename }); document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function api(method, action, body, query) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    return fetch('api.php?a=' + encodeURIComponent(action) + (query ? '&' + query : ''), opts).then(function (r) {
      return r.json().catch(function () { throw new Error('The server sent an unexpected reply (' + r.status + ').'); }).then(function (j) {
        if (!j.ok) {
          if (r.status === 401 && me) { me = null; csrf = null; go('login'); }
          var e = new Error(j.error || 'Request failed.'); e.status = r.status; throw e;
        }
        return j;
      });
    }, function () { throw new Error('Could not reach the server. Check your connection and try again.'); });
  }
  function signedIn(j) { me = j.user; csrf = j.csrf; }

  // ---------------------------------------------------------------- routing
  function route() {
    var h = location.hash.replace(/^#/, '');
    var m = /^reset=([0-9a-f]{64})$/.exec(h);
    if (m) return viewReset(m[1]);
    var page = h || (me ? 'home' : 'login');
    if (!me && ['login', 'register', 'forgot'].indexOf(page) < 0) page = 'login';
    if (me && ['login', 'register', 'forgot'].indexOf(page) >= 0) page = 'home';
    if (page === 'campaigns' && !me.canRef) page = 'home';
    if (page === 'admin' && !me.isAdmin) page = 'home';
    nav();
    var views = { login: viewLogin, register: viewRegister, forgot: viewForgot, home: viewHome, characters: viewCharacters,
      play: viewPlay, campaigns: viewCampaigns, account: viewAccount, admin: viewAdmin };
    (views[page] || viewHome)();
    window.scrollTo(0, 0);
  }
  function go(page) { if (location.hash === '#' + page) route(); else location.hash = page; }
  function show(kids) {
    var v = $('view'); v.innerHTML = '';
    kids.forEach(function (k) { if (k) v.appendChild(k); });
    var f = v.querySelector('input:not([type=hidden])'); if (f && !('ontouchstart' in window)) f.focus();
  }
  function nav() {
    var n = $('nav'); n.innerHTML = '';
    if (!me) return;
    n.appendChild(el('span', { class: 'who', text: me.username + (me.isAdmin ? ' · admin' : me.role === 'ref' ? ' · Ref' : '') }));
    n.appendChild(a('Home', '#home', 'btn btn-ghost btn-small'));
    n.appendChild(a('Account', '#account', 'btn btn-ghost btn-small'));
    n.appendChild(btn('Log out', logout, 'btn-ghost btn-small'));
  }
  function logout() {
    // The apps keep a browser copy of whatever was last open; it's all in the account, so don't leave it
    // behind for the next person on a shared device.
    ['crows-pt2-character', 'crows-pt2-ref-campaign'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    api('POST', 'logout', {}).then(null, function () { /* ignore */ }).then(function () { me = null; csrf = null; go('login'); toast('Logged out.'); });
  }

  // ---------------------------------------------------------------- forms
  function field(label, input, hint) { return el('label', { class: 'field' }, [label, input, hint ? el('small', { text: hint }) : null]); }
  function input(type, name, extra) {
    var o = { type: type, name: name };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return el('input', o);
  }
  /* Wires a form: collects named inputs, disables the submit button while the request runs, shows errors. */
  function form(kids, submitText, handler) {
    var msg = el('div', { class: 'msg err', hidden: true });
    var submit = el('button', { type: 'submit', class: 'btn btn-primary wide', text: submitText });
    var f = el('form', { novalidate: true }, [msg].concat(kids, [el('div', { class: 'form-actions' }, [submit])]));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var vals = {};
      Array.prototype.forEach.call(f.elements, function (i) { if (i.name) vals[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      msg.hidden = true; submit.disabled = true;
      Promise.resolve().then(function () { return handler(vals, f); }).then(null, function (err) {
        msg.className = 'msg err'; msg.textContent = err.message; msg.hidden = false;
      }).then(function () { submit.disabled = false; });
    });
    f.say = function (text, kind) { msg.className = 'msg ' + (kind || 'ok'); msg.textContent = text; msg.hidden = false; };
    return f;
  }
  function insecureNote() {
    return https ? null : el('div', { class: 'msg warn', text: 'This connection is not encrypted yet (no HTTPS), so don\'t reuse a password from another site here.' });
  }
  function guestCard() {
    return el('div', { class: 'card' }, [
      el('h2', { text: 'Just want to make a crow?' }),
      el('p', { class: 'muted', text: 'Use the apps without an account. Your work is kept in this browser and in the files you save, but not on the server.' }),
      a('Continue without an account', GEN, 'btn wide')
    ]);
  }

  function viewLogin() {
    show([el('div', { class: 'narrow' }, [
      el('div', { class: 'card' }, [
        el('h1', { text: 'Log in' }),
        insecureNote(),
        form([
          field('Username or email', input('text', 'login', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' })),
          field('Password', input('password', 'password', { autocomplete: 'current-password' }))
        ], 'Log in', function (v) {
          return api('POST', 'login', { login: v.login, password: v.password }).then(function (j) { signedIn(j); go('home'); });
        }),
        el('div', { class: 'links' }, [a('Create an account', '#register', ''), a('Forgot your password?', '#forgot', '')])
      ]),
      guestCard()
    ])]);
  }

  function viewRegister() {
    show([el('div', { class: 'narrow' }, [
      el('div', { class: 'card' }, [
        el('h1', { text: 'Create an account' }),
        el('p', { class: 'muted', text: 'Save your characters here and open them from any device. Refs can also keep their campaigns.' }),
        insecureNote(),
        form([
          field('Username', input('text', 'username', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: 32 }), '3–32 letters, numbers, dots, dashes, or underscores.'),
          field('Email', input('email', 'email', { autocomplete: 'email' }), 'Only used to reset your password.'),
          field('Password', input('password', 'password', { autocomplete: 'new-password', minlength: 8 }), 'At least 8 characters. A long passphrase is best; very common passwords are refused.'),
          field('Password again', input('password', 'password2', { autocomplete: 'new-password' }))
        ], 'Create account', function (v) {
          if (v.password !== v.password2) throw new Error('The two passwords don\'t match.');
          return api('POST', 'register', { username: v.username, email: v.email, password: v.password }).then(function (j) {
            signedIn(j); go('home'); toast('Welcome, ' + me.username + '!');
          });
        }),
        el('div', { class: 'links' }, [a('I already have an account', '#login', '')])
      ])
    ])]);
  }

  function viewForgot() {
    var f = form([field('Email', input('email', 'email', { autocomplete: 'email' }))], 'Send reset link', function (v) {
      return api('POST', 'forgot', { email: v.email }).then(function (j) { f.say(j.message, 'ok'); });
    });
    show([el('div', { class: 'narrow' }, [el('div', { class: 'card' }, [
      el('h1', { text: 'Reset your password' }),
      el('p', { class: 'muted', text: 'Enter the email on your account and we\'ll send you a link to choose a new password. If it doesn\'t arrive, ask the site admin for a reset link.' }),
      f,
      el('div', { class: 'links' }, [a('Back to log in', '#login', '')])
    ])])]);
  }

  function viewReset(token) {
    nav();
    show([el('div', { class: 'narrow' }, [el('div', { class: 'card' }, [
      el('h1', { text: 'Choose a new password' }),
      form([
        field('New password', input('password', 'password', { autocomplete: 'new-password' }), 'At least 8 characters.'),
        field('New password again', input('password', 'password2', { autocomplete: 'new-password' }))
      ], 'Save password', function (v) {
        if (v.password !== v.password2) throw new Error('The two passwords don\'t match.');
        return api('POST', 'reset', { token: token, password: v.password }).then(function (j) {
          signedIn(j); history.replaceState(null, '', location.pathname + '#home'); route(); toast('Password changed. You are logged in.');
        });
      })
    ])])]);
  }

  // ---------------------------------------------------------------- home
  function tile(title, desc, href, cls) {
    return el('a', { class: 'tile ' + (cls || ''), href: href }, [el('span', { class: 't', text: title }), el('span', { class: 'd', text: desc })]);
  }
  function viewHome() {
    var tiles = [
      tile('Create a character', 'Roll up a new crow. It\'s saved to your account as you go.', GEN + '?new=1&mode=build'),
      tile('My characters', 'Open, edit, copy, download, upload, or delete your saved crows.', '#characters'),
      tile('Play', 'Take one of your crows to the table: vitals, dice, rests, and XP.', '#play')
    ];
    if (me.canRef) tiles.push(tile('Ref Screen', 'Run sessions and keep your campaigns: open one or start a new one.', '#campaigns', 'ref'));
    if (me.isAdmin) tiles.push(tile('Manage accounts', 'Mark accounts as players or Refs, send reset links, and more.', '#admin', 'admin'));
    show([
      el('h1', { text: 'Welcome, ' + me.username }),
      el('p', { class: 'muted', text: 'What would you like to do?' }),
      el('div', { class: 'tiles' }, tiles)
    ]);
  }

  // ---------------------------------------------------------------- characters & campaigns
  var KINDS = {
    characters: { one: 'character', app: GEN, fileSuffix: '_Crows_Character.json',
      valid: function (s) { return s && typeof s === 'object' && s.v === 1 && typeof s.bg === 'number' && Array.isArray(s.inv); },
      name: function (s) { return s.name || 'Unnamed crow'; } },
    campaigns: { one: 'campaign', app: REF, fileSuffix: '_Crows_Campaign.json',
      valid: function (s) { return s && typeof s === 'object' && s.v === 1 && s.session && typeof s.session === 'object'; },
      name: function (s) { return s.name || (s.village && s.village.name) || 'Untitled campaign'; } }
  };

  function listPage(kind, opts) {
    var K = KINDS[kind];
    var list = el('ul', { class: 'rows' }, [el('li', { class: 'empty', text: 'Loading…' })]);
    function load() {
      api('GET', 'list', undefined, 'kind=' + kind).then(function (j) {
        list.innerHTML = '';
        if (!j.items.length) list.appendChild(el('li', { class: 'empty', text: opts.empty }));
        j.items.forEach(function (it) { list.appendChild(row(it)); });
      }, function (e) { list.innerHTML = ''; list.appendChild(el('li', { class: 'empty', text: e.message })); });
    }
    function row(it) {
      var btns = opts.buttons(it).concat(opts.manage ? [
        btn('Download', function () {
          api('GET', 'get', undefined, 'kind=' + kind + '&id=' + it.id).then(function (j) {
            download(JSON.stringify(j.item.data, null, 2), fileBase(it.name) + K.fileSuffix);
          }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost', 'Save a copy to a .json file on this device'),
        btn('Copy', function () {
          api('POST', 'duplicate', { id: it.id }, 'kind=' + kind).then(function () { toast('Copied.'); load(); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost', 'Make a duplicate in your account'),
        btn('Delete', function () {
          if (!confirm('Delete "' + it.name + '" from your account? This can\'t be undone. Download it first if you want a copy.')) return;
          api('POST', 'delete', { id: it.id }, 'kind=' + kind).then(function () { toast('Deleted.'); load(); }, function (e) { toast(e.message); });
        }, 'btn-small btn-danger')
      ] : []);
      return el('li', null, [
        el('div', null, [el('div', { class: 'name', text: it.name || 'Untitled' }),
          el('div', { class: 'meta', text: [it.summary, 'saved ' + when(it.updatedAt)].filter(Boolean).join(' · ') })]),
        el('div', { class: 'btns' }, btns)
      ]);
    }
    function upload(input) {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var added = 0;
      files.reduce(function (p, f) {
        return p.then(function () {
          return f.text().then(function (txt) {
            var data;
            try { data = JSON.parse(txt); } catch (e) { throw new Error(f.name + ' is not a save file.'); }
            if (!K.valid(data)) throw new Error(f.name + ' is not a Crows ' + K.one + ' file.');
            return api('POST', 'create', { data: data, name: K.name(data), summary: 'Uploaded from ' + f.name }, 'kind=' + kind).then(function () { added++; });
          }).then(null, function (e) { toast(e.message); });
        });
      }, Promise.resolve()).then(function () { if (added) toast('Added ' + added + ' ' + K.one + (added === 1 ? '' : 's') + '.'); load(); });
    }
    var head = el('div', { class: 'list-head' }, [
      el('h1', { text: opts.title }),
      el('div', { class: 'btns' }, opts.manage ? [
        a('New ' + K.one, K.app + '?new=1' + (kind === 'characters' ? '&mode=build' : ''), 'btn btn-primary'),
        el('label', { class: 'btn file-btn', title: 'Add .json save files from this device to your account' }, ['Upload file',
          el('input', { type: 'file', accept: '.json,application/json', multiple: true, onchange: function () { upload(this); } })])
      ] : [])
    ]);
    show([head, opts.intro ? el('p', { class: 'muted', text: opts.intro }) : null, el('div', { class: 'card' }, [list])]);
    load();
  }

  function viewCharacters() {
    listPage('characters', {
      title: 'My characters', manage: true,
      empty: 'No characters yet. Create one, or upload a save file from the character generator.',
      buttons: function (it) { return [a('Edit', GEN + '?id=' + it.id + '&mode=build', 'btn btn-small btn-primary'), a('Play', GEN + '?id=' + it.id + '&mode=play', 'btn btn-small')]; }
    });
  }
  function viewPlay() {
    listPage('characters', {
      title: 'Play', manage: false,
      intro: 'Pick a crow to open in Play mode. Everything you change at the table is saved to your account as you go.',
      empty: 'You have no characters yet. Create one from the home page first.',
      buttons: function (it) { return [a('Play', GEN + '?id=' + it.id + '&mode=play', 'btn btn-small btn-primary')]; }
    });
  }
  function viewCampaigns() {
    listPage('campaigns', {
      title: 'Campaigns', manage: true,
      intro: 'Open a campaign in the Ref Screen. Changes are saved to your account as you make them.',
      empty: 'No campaigns yet. Start a new one, or upload a campaign file saved from the Ref Screen.',
      buttons: function (it) { return [a('Open in Ref Screen', REF + '?id=' + it.id, 'btn btn-small btn-primary')]; }
    });
  }

  // ---------------------------------------------------------------- account
  function viewAccount() {
    var details = form([
      field('Username', input('text', 'username', { value: me.username, disabled: true }), 'Usernames can\'t be changed.'),
      field('Email', input('email', 'email', { value: me.email, autocomplete: 'email' })),
      field('New password', input('password', 'newPassword', { autocomplete: 'new-password' }), 'Leave blank to keep your current password. Changing it logs out your other devices.'),
      field('New password again', input('password', 'newPassword2', { autocomplete: 'new-password' })),
      field('Current password', input('password', 'currentPassword', { autocomplete: 'current-password' }), 'Needed to save any change.')
    ], 'Save changes', function (v, f) {
      if (v.newPassword !== v.newPassword2) throw new Error('The two new passwords don\'t match.');
      return api('POST', 'account.update', { email: v.email, newPassword: v.newPassword, currentPassword: v.currentPassword }).then(function (j) {
        me = j.user; nav();
        ['newPassword', 'newPassword2', 'currentPassword'].forEach(function (n) { f.elements[n].value = ''; });
        f.say('Saved.', 'ok');
      });
    });
    var del = form([
      field('Password', input('password', 'password', { autocomplete: 'current-password' })),
      el('label', { class: 'field' }, [el('span', null, [input('checkbox', 'sure'), ' Yes, delete my account and everything saved in it'])])
    ], 'Delete my account', function (v) {
      if (!v.sure) throw new Error('Tick the box to confirm.');
      return api('POST', 'account.delete', { password: v.password }).then(function () { me = null; csrf = null; go('login'); toast('Your account was deleted.'); });
    });
    del.querySelector('button[type=submit]').className = 'btn btn-danger wide';
    show([el('div', { class: 'narrow' }, [
      el('h1', { text: 'Your account' }),
      el('p', { class: 'muted' }, ['You are a ', el('strong', { text: me.role === 'ref' ? 'Ref' : 'player' }), me.isAdmin ? ' and an admin' : '', '.',
        me.role !== 'ref' && !me.isAdmin ? ' An admin can make you a Ref if you run games.' : '']),
      el('div', { class: 'card' }, [el('h2', { text: 'Details' }), details]),
      el('div', { class: 'card' }, [el('h2', { text: 'Devices' }),
        el('p', { class: 'muted', text: 'You stay logged in for 30 days on each device you use.' }),
        btn('Log out everywhere else', function () {
          api('POST', 'account.logoutOthers', {}).then(function () { toast('Logged out of your other devices.'); }, function (e) { toast(e.message); });
        })]),
      el('div', { class: 'card' }, [el('h2', { text: 'Delete account' }),
        el('p', { class: 'muted', text: 'This removes your account and all its saved characters and campaigns. Download anything you want to keep first.' }), del])
    ])]);
  }

  // ---------------------------------------------------------------- admin
  function viewAdmin() {
    var body = el('tbody', null, [el('tr', null, [el('td', { colspan: 6, class: 'muted', text: 'Loading…' })])]);
    var search = input('search', 'q', { placeholder: 'Filter by name or email' });
    var users = [];
    var linkBox = el('div');
    function load() {
      api('GET', 'admin.users').then(function (j) { users = j.users; draw(); }, function (e) { body.innerHTML = ''; body.appendChild(el('tr', null, [el('td', { colspan: 6, text: e.message })])); });
    }
    function act(action, payload, done) {
      return api('POST', action, payload).then(function (j) { if (done) done(j); load(); }, function (e) { toast(e.message); load(); });
    }
    function draw() {
      var f = search.value.trim().toLowerCase();
      body.innerHTML = '';
      users.filter(function (u) { return !f || u.username.toLowerCase().indexOf(f) >= 0 || u.email.toLowerCase().indexOf(f) >= 0; }).forEach(function (u) {
        var self = u.id === me.id;
        var role = el('select', { 'aria-label': 'Role for ' + u.username, onchange: function () {
          act('admin.setRole', { id: u.id, role: this.value }, function () { toast(u.username + ' is now a ' + (role.value === 'ref' ? 'Ref' : 'player') + '.'); if (self) refreshMe(); });
        } }, [el('option', { value: 'player', text: 'Player' }), el('option', { value: 'ref', text: 'Ref' })]);
        role.value = u.role;
        var adm = el('input', { type: 'checkbox', 'aria-label': 'Admin', checked: u.isAdmin, disabled: self, title: self ? 'You can\'t remove your own admin access' : null,
          onchange: function () {
            var on = this.checked;
            if (!confirm((on ? 'Make ' : 'Remove admin access from ') + u.username + (on ? ' an admin? Admins can manage every account.' : '?'))) { this.checked = !on; return; }
            act('admin.setAdmin', { id: u.id, isAdmin: on });
          } });
        body.appendChild(el('tr', null, [
          el('td', null, [el('strong', { text: u.username }), self ? ' (you)' : '', el('div', { class: 'fine', text: u.email })]),
          el('td', null, [role]),
          el('td', null, [adm]),
          el('td', { class: 'fine', text: u.characters + ' char. · ' + u.campaigns + ' camp.' }),
          el('td', { class: 'fine', text: u.lastLogin ? when(u.lastLogin) : 'never' }),
          el('td', null, [el('div', { class: 'cell-btns' }, [
            btn('Reset link', function () {
              act('admin.resetLink', { id: u.id }, function (j) {
                var box = input('text', 'link', { value: j.link, readonly: true });
                linkBox.innerHTML = '';
                linkBox.appendChild(el('div', { class: 'msg ok' }, [
                  'Password reset link for ' + u.username + ' (works once, for 48 hours). Send it to them yourself:',
                  el('div', { class: 'copy' }, [box, btn('Copy', function () {
                    box.select();
                    (navigator.clipboard ? navigator.clipboard.writeText(j.link) : Promise.reject()).then(function () { toast('Copied.'); }, function () { document.execCommand('copy'); toast('Copied.'); });
                  }, 'btn-small')])]));
                linkBox.scrollIntoView({ block: 'nearest' });
              });
            }, 'btn-small btn-ghost', 'Make a one-time link that lets this user choose a new password'),
            self ? null : btn('Delete', function () {
              if (!confirm('Delete ' + u.username + ' and all of their saved characters and campaigns? This can\'t be undone.')) return;
              act('admin.deleteUser', { id: u.id }, function () { toast('Deleted ' + u.username + '.'); });
            }, 'btn-small btn-danger')
          ])])
        ]));
      });
      if (!body.children.length) body.appendChild(el('tr', null, [el('td', { colspan: 6, class: 'muted', text: 'No matching accounts.' })]));
    }
    search.addEventListener('input', draw);
    var EVENTS = { login: 'Logged in', login_failed: 'Failed login', register: 'Created account', password_reset: 'Reset password',
      reset_requested: 'Asked for reset email', password_changed: 'Changed password', email_changed: 'Changed email',
      password_check_failed: 'Wrong current password', logout_others: 'Logged out other devices', account_deleted: 'Deleted own account',
      role_set: 'Role changed', admin_granted: 'Made admin', admin_revoked: 'Admin removed', reset_link_made: 'Reset link made',
      user_deleted: 'Account deleted' };
    var logBox = el('div', null, [btn('Show security log', function () {
      logBox.innerHTML = '<p class="muted">Loading…</p>';
      api('GET', 'admin.audit').then(function (j) {
        logBox.innerHTML = '';
        if (!j.events.length) { logBox.appendChild(el('p', { class: 'muted', text: 'Nothing logged yet.' })); return; }
        logBox.appendChild(el('div', { class: 'table-wrap' }, [el('table', null, [
          el('thead', null, [el('tr', null, ['When', 'Event', 'Account', 'By', 'IP', ''].map(function (h) { return el('th', { text: h }); }))]),
          el('tbody', null, j.events.map(function (e) {
            return el('tr', null, [el('td', { class: 'fine', text: new Date(e.at).toLocaleString() }), el('td', { text: EVENTS[e.event] || e.event }),
              el('td', { text: e.user || '' }), el('td', { text: e.actor || '' }), el('td', { class: 'fine', text: e.ip }), el('td', { class: 'fine', text: e.detail })]);
          }))])]));
      }, function (e) { logBox.innerHTML = ''; logBox.appendChild(el('p', { class: 'muted', text: e.message })); });
    })]);
    show([
      el('div', { class: 'list-head' }, [el('h1', { text: 'Manage accounts' })]),
      el('p', { class: 'muted', text: 'New accounts start as players. Refs can also open the Ref Screen and keep campaigns. Admins can do everything, including this page.' }),
      linkBox,
      el('div', { class: 'card' }, [
        el('div', { style: 'margin-bottom:.8rem;max-width:320px' }, [search]),
        el('div', { class: 'table-wrap' }, [el('table', null, [
          el('thead', null, [el('tr', null, ['Account', 'Role', 'Admin', 'Saves', 'Last login', ''].map(function (h) { return el('th', { text: h }); }))]),
          body])])
      ]),
      el('div', { class: 'card' }, [el('h2', { text: 'Security log' }),
        el('p', { class: 'muted', text: 'Logins, failed logins, password and email changes, and admin actions from the last 180 days (newest first, up to 300).' }),
        logBox])
    ]);
    search.blur();
    load();
  }
  function refreshMe() { api('GET', 'me').then(function (j) { if (j.user) { me = j.user; nav(); } }); }

  // ---------------------------------------------------------------- start
  window.addEventListener('hashchange', route);
  api('GET', 'me').then(function (j) {
    https = j.https; signedIn(j); route();
  }, function (e) {
    $('view').innerHTML = '';
    $('view').appendChild(el('div', { class: 'narrow' }, [el('div', { class: 'card' }, [
      el('h1', { text: 'Can\'t reach the server' }), el('p', { class: 'muted', text: e.message }), btn('Try again', function () { location.reload(); }, 'btn-primary')
    ]), guestCard()]));
  });
})();
