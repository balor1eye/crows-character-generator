/*
 * The Nest accounts portal: log in / create an account / reset a password, then a home page that leads to
 * character creation, saved characters, play, and (for Refs) campaigns and the Ref Screen, plus account
 * settings and (for admins) account management. Routes live in the URL hash (#login, #home, ...).
 */
(function () {
  'use strict';

  var GEN = 'Crows_Character_Generator.html', PLAY = 'play';   // Play is the generator's Play mode at its own address (.htaccess)
  var REF = 'ref.php';
  var me = null, csrf = null, https = true, unread = 0;   // unread: notifications not yet dismissed
  var PENDING_SHARE = 'crows-pending-share';

  // ---------------------------------------------------------------- helpers
  var Dom = window.CrowsDom, $ = Dom.$, el = Dom.el;   // dom.js (src/shared/dom.js)
  function btn(text, on, cls, title) { return Dom.btn(text, on, cls, title); }
  function a(text, href, cls) { return el('a', { class: cls === undefined ? 'btn' : cls, href: href, text: text }); }
  function toast(msg) { Dom.toast(msg, 3200); }
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
  function signedIn(j) { me = j.user; csrf = j.csrf; unread = j.notes || 0; }
  /* Where to go after logging in: back to a character or campaign link opened while logged out, or home. */
  function afterLogin() {
    var to = null;
    try { to = sessionStorage.getItem(PENDING_SHARE); sessionStorage.removeItem(PENDING_SHARE); } catch (e) { /* ignore */ }
    if (to && /^[0-9a-f]{64}$/.test(to)) to = 'share=' + to;   // saved by an older version of this page
    go(to && /^(share|join)=[0-9a-f]{64}$/.test(to) ? to : 'home');
  }

  // ---------------------------------------------------------------- routing
  function route() {
    var h = location.hash.replace(/^#/, '');
    var m = /^reset=([0-9a-f]{64})$/.exec(h);
    if (m) return viewReset(m[1]);
    var sh = /^(share|join)=([0-9a-f]{64})$/.exec(h);
    if (sh) {
      if (me) return sh[1] === 'share' ? viewShare(sh[2]) : viewJoin({ token: sh[2] });
      // Remember it through login (or account creation), then come back to it.
      try { sessionStorage.setItem(PENDING_SHARE, h); } catch (e) { /* ignore */ }
      history.replaceState(null, '', location.pathname + '#login');
      h = 'login';
    }
    var page = h || (me ? 'home' : 'login');
    if (!me && ['login', 'register', 'forgot'].indexOf(page) < 0) page = 'login';
    if (me && ['login', 'register', 'forgot'].indexOf(page) >= 0) page = 'home';
    var listed = /^campaign=(\d+)$/.exec(page);
    if (listed) { nav(); viewJoin({ campaign: listed[1] }); window.scrollTo(0, 0); return; }
    if (page === 'campaigns' && !me.canRef) page = 'home';
    if (page === 'admin' && !me.isAdmin) page = 'home';
    nav();
    var views = { login: viewLogin, register: viewRegister, forgot: viewForgot, home: viewHome, characters: viewCharacters,
      play: viewPlay, find: viewFind, campaigns: viewCampaigns, account: viewAccount, admin: viewAdmin };
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
    var home = a('Home', '#home', 'btn btn-ghost btn-small');
    if (unread) { home.appendChild(el('span', { class: 'count', text: String(unread), title: unread + ' new' })); home.setAttribute('aria-label', 'Home, ' + unread + ' new'); }
    n.appendChild(home);
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

  /* What the person was sent ('share' for a character, 'join' for a campaign) before they had to log in. */
  function pendingShare() { try { var v = sessionStorage.getItem(PENDING_SHARE) || ''; return v ? (/^join=/.test(v) ? 'join' : 'share') : null; } catch (e) { return null; } }
  function pendingNote() {
    var p = pendingShare();
    return p ? el('div', { class: 'msg ok', text: p === 'join' ? 'Log in (or create an account) to ask to join the campaign your Ref invited you to.' :
      'Log in (or create an account) to add the character someone shared with you.' }) : null;
  }
  function viewLogin() {
    show([el('div', { class: 'narrow' }, [
      el('div', { class: 'card' }, [
        el('h1', { text: 'Log in' }),
        pendingNote(),
        insecureNote(),
        form([
          field('Username or email', input('text', 'login', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' })),
          field('Password', input('password', 'password', { autocomplete: 'current-password' }))
        ], 'Log in', function (v) {
          return api('POST', 'login', { login: v.login, password: v.password }).then(afterPassword);
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
          field('Email', input('email', 'email', { autocomplete: 'email' }), 'For resetting your password, sign-in codes if you choose them, and notices you can turn off.'),
          field('Password', input('password', 'password', { autocomplete: 'new-password', minlength: 8 }), 'At least 8 characters. A long passphrase is best; very common passwords are refused.'),
          field('Password again', input('password', 'password2', { autocomplete: 'new-password' }))
        ], 'Create account', function (v) {
          if (v.password !== v.password2) throw new Error('The two passwords don\'t match.');
          return api('POST', 'register', { username: v.username, email: v.email, password: v.password }).then(function (j) { viewSignupVerify(j.verify); });
        }),
        el('div', { class: 'links' }, [a('I already have an account', '#login', '')])
      ])
    ])]);
  }
  /* Sign-up, step two: the code emailed to the new address. The account is made once it's entered. */
  function viewSignupVerify(c) {
    var f = form([
      el('p', { class: 'muted', text: 'We emailed a 6-digit code to ' + c.email + '. It works for 30 minutes; check your spam folder if it\u2019s not there.' }),
      el('label', { class: 'field' }, ['Code', codeInput({ placeholder: '123456' })])
    ], 'Create account', function (v) {
      return api('POST', 'register.verify', { token: c.token, code: v.code }).then(afterPassword, function (e) {
        if (e.status === 401) { toast(e.message); go('register'); return; }
        throw e;
      });
    });
    show([el('div', { class: 'narrow' }, [el('div', { class: 'card' }, [
      el('h1', { text: 'Check your email' }), f,
      el('div', { class: 'links' }, [
        btn('Send a new code', function () {
          api('POST', 'register.resend', { token: c.token }).then(function () { toast('A new code is on its way.'); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost'),
        el('a', { href: '#register', text: 'Start over', onclick: function (e) { e.preventDefault(); go('register'); } }),
        a('I already have an account', '#login', '')
      ]),
      el('p', { class: 'fine', text: 'If that email already has an account, no code is sent; that address is told instead. Log in or reset your password.' })
    ])])]);
    var i = f.querySelector('input'); if (i) i.focus();
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
          history.replaceState(null, '', location.pathname + '#login'); toast('Password changed.'); afterPassword(j);
        });
      })
    ])])]);
  }

  // ---------------------------------------------------------------- two-step login
  /*
   * A correct password gets a challenge, not a session: prove the second factor (an authenticator app code, an
   * emailed code, or a recovery code), or, for an account without one (every new account), set one up first.
   * These steps aren't routes: reloading the page goes back to logging in, which makes a fresh challenge.
   */
  function afterPassword(j) {
    if (j.mfa) return viewMfaLogin(j.mfa);
    if (j.mfaSetup) return viewMfaSetup(j.mfaSetup);
    signedIn(j); afterLogin();
  }
  function codeInput(extra) {
    return input('text', 'code', Object.assign({ inputmode: 'numeric', autocomplete: 'one-time-code', autocapitalize: 'off', spellcheck: 'false', maxlength: 12, class: 'code-in' }, extra || {}));
  }
  function resendBtn(token) {
    return btn('Send a new code', function () {
      api('POST', 'mfa.resend', { token: token }).then(function () { toast('A new code is on its way.'); }, function (e) { toast(e.message); });
    }, 'btn-small btn-ghost');
  }

  function viewMfaLogin(c) {
    nav();
    var recovery = false, hint = el('p', { class: 'muted' }), label = el('span'), code = codeInput();
    function mode() {
      label.textContent = recovery ? 'Recovery code' : 'Code';
      code.setAttribute('inputmode', recovery ? 'text' : 'numeric');
      code.placeholder = recovery ? 'xxxx-xxxx' : '123456';
      hint.textContent = recovery ? 'Enter one of the recovery codes you saved when you set up two-step login. Each works once.'
        : c.method === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'We emailed a 6-digit code to ' + c.email + '. It works for 15 minutes; check your spam folder if it\u2019s not there.';
      toggle.textContent = recovery ? (c.method === 'totp' ? 'Use my authenticator app' : 'Use the emailed code') : 'Use a recovery code instead';
      code.value = ''; code.focus();
    }
    var toggle = el('a', { href: '#', onclick: function (e) { e.preventDefault(); recovery = !recovery; mode(); } });
    var f = form([hint, el('label', { class: 'field' }, [label, code])], 'Log in', function (v) {
      return api('POST', 'mfa.verify', { token: c.token, code: v.code }).then(function (j) {
        signedIn(j); afterLogin();
        if (j.recoveryLeft !== undefined) toast(j.recoveryLeft <= 3 ? 'Recovery code used. Only ' + j.recoveryLeft + ' left: make new ones on your Account page.' : 'Recovery code used (' + j.recoveryLeft + ' left).');
      });
    });
    show([el('div', { class: 'narrow' }, [el('div', { class: 'card' }, [
      el('h1', { text: 'Two-step login' }), f,
      el('div', { class: 'links' }, [toggle, c.method === 'email' ? resendBtn(c.token) : null,
        el('a', { href: '#login', text: 'Start over', onclick: function (e) { e.preventDefault(); go('login'); } })]),   // the URL may already be #login
      el('p', { class: 'fine', text: 'Lost your phone and your recovery codes? Ask the site admin to reset your two-step login.' })
    ])])]);
    mode();
  }

  /*
   * Setting up the second factor: at sign-up, at the first login of an older account, or from the Account page
   * (opts.change). Pick a method, confirm it with a code, then save the recovery codes.
   */
  function viewMfaSetup(c, opts) {
    opts = opts || {};
    nav();
    var box = el('div', { class: 'card' });
    show([el('div', { class: 'narrow' }, [box])]);
    function step(kids) { box.innerHTML = ''; kids.forEach(function (k) { if (k) box.appendChild(k); }); var i = box.querySelector('input'); if (i) i.focus(); }
    function choose() {
      step([
        el('h1', { text: opts.change ? 'Change two-step login' : 'Protect your account' }),
        el('p', { class: 'muted', text: (opts.change ? '' : 'One more step' + (c.username ? ', ' + c.username : '') + '. ') +
          'Every account on The Nest uses two-step login: after your password, you also enter a code. Pick where your codes come from.' }),
        el('div', { class: 'choices' }, [
          el('button', { type: 'button', class: 'choice', onclick: function () { start('totp'); } }, [el('span', { class: 't', text: 'Authenticator app' }), el('span', { class: 'tag', text: 'Recommended' }),
            el('span', { class: 'd', text: 'Google Authenticator, Microsoft Authenticator, 1Password, Authy, or similar. Works offline and doesn\u2019t depend on email.' })]),
          el('button', { type: 'button', class: 'choice', onclick: function () { start('email'); } }, [el('span', { class: 't', text: 'Emailed codes' }),
            el('span', { class: 'd', text: 'We email a code to ' + c.email + ' each time you log in. Simpler, but only as safe as your email.' })])
        ]),
        opts.change ? el('div', { class: 'links' }, [a('Cancel', '#account', '')]) : null
      ]);
    }
    function start(method) {
      api('POST', 'mfa.setupStart', { token: c.token, method: method }).then(function (j) { method === 'totp' ? scan(j) : emailed(j); }, function (e) { toast(e.message); if (e.status === 401) go('login'); });
    }
    function confirmForm(submitText) {
      return form([el('label', { class: 'field' }, ['6-digit code', codeInput({ placeholder: '123456' })])], submitText, function (v) {
        return api('POST', 'mfa.setupFinish', { token: c.token, code: v.code }).then(done);
      });
    }
    function scan(j) {
      step([
        el('h1', { text: 'Set up your authenticator app' }),
        el('ol', { class: 'steps' }, [
          el('li', { text: 'In your authenticator app, add an account and scan this code.' }),
          el('li', null, ['Can\u2019t scan it (say, on this same phone)? Enter this key instead: ', el('code', { class: 'secret', text: j.secret }),
            ' ', el('a', { href: j.uri, text: 'or open it in an app on this device' })]),
          el('li', { text: 'Type the 6-digit code the app shows for The Nest.' })
        ]),
        qrSvg(j.uri),
        confirmForm('Turn on two-step login'),
        el('div', { class: 'links' }, [a('Pick a different method', '#', ''), opts.change ? a('Cancel', '#account', '') : null])
      ]);
      box.querySelector('.links a').addEventListener('click', function (e) { e.preventDefault(); choose(); });
    }
    function emailed(j) {
      step([
        el('h1', { text: 'Check your email' }),
        el('p', { class: 'muted', text: 'We sent a 6-digit code to ' + j.email + '. It works for 15 minutes; check your spam folder if it\u2019s not there.' }),
        confirmForm('Turn on two-step login'),
        el('div', { class: 'links' }, [resendBtn(c.token), a('Pick a different method', '#', ''), opts.change ? a('Cancel', '#account', '') : null])
      ]);
      box.querySelectorAll('.links a')[0].addEventListener('click', function (e) { e.preventDefault(); choose(); });
    }
    function done(j) {
      signedIn(j);
      recoveryCodes(box, j.recoveryCodes, opts.change ? 'Two-step login is changed.' : 'Two-step login is on.', function () {
        if (opts.change) { go('account'); toast('Two-step login changed.'); }
        else { afterLogin(); toast('Welcome, ' + me.username + '!'); }
      });
    }
    choose();
  }

  /* Show new recovery codes once, with ways to keep them, and continue only after they're saved. */
  function recoveryCodes(box, codes, title, onDone) {
    var text = 'The Nest recovery codes for ' + me.username + ' (each works once):\n\n' + codes.join('\n') + '\n';
    var ok = el('input', { type: 'checkbox' }), cont = btn('Continue', function () { if (!ok.checked) { toast('Tick the box once you\u2019ve saved them.'); return; } onDone(); }, 'btn-primary wide');
    box.innerHTML = '';
    [el('h1', { text: title }),
      el('p', { text: 'Save these recovery codes somewhere safe, like a password manager or a printout. If you lose your phone or can\u2019t get your email, one of them gets you in. Each works once. They won\u2019t be shown again.' }),
      el('ul', { class: 'recovery' }, codes.map(function (c) { return el('li', null, [el('code', { text: c })]); })),
      el('div', { class: 'row-btns' }, [
        btn('Copy', function () { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied.'); }, function () { toast('Copy them by hand, or use Download.'); }); }, 'btn-small'),
        btn('Download', function () { download(text, 'The_Nest_recovery_codes.txt'); }, 'btn-small'),
        btn('Print', function () { window.print(); }, 'btn-small btn-ghost')]),
      el('label', { class: 'check-row' }, [ok, ' I\u2019ve saved my recovery codes']),
      el('div', { class: 'form-actions' }, [cont])
    ].forEach(function (k) { box.appendChild(k); });
  }

  /* The otpauth:// link as a QR code (qrcode.js, vendored), drawn as SVG on a white quiet zone so it scans in dark mode. */
  function qrSvg(uri) {
    var NS = 'http://www.w3.org/2000/svg', q = window.qrcode(0, 'M');
    q.addData(uri); q.make();
    var n = q.getModuleCount(), m = 4, size = n + m * 2, path = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) path += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size); svg.setAttribute('class', 'qr'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for your authenticator app');
    var bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    var fg = document.createElementNS(NS, 'path'); fg.setAttribute('d', path); fg.setAttribute('fill', '#000');
    svg.appendChild(bg); svg.appendChild(fg);
    return svg;
  }

  // ---------------------------------------------------------------- home
  function tile(title, desc, href, cls) {
    return el('a', { class: 'tile ' + (cls || ''), href: href }, [el('span', { class: 't', text: title }), el('span', { class: 'd', text: desc })]);
  }
  function viewHome() {
    var tiles = [
      tile('My characters', 'Create a new crow, or open, edit, copy, download, upload, or delete your saved ones.', '#characters'),
      tile('Play', 'Take one of your crows to the table: vitals, dice, rests, and XP.', '#play'),
      tile('Find a campaign', 'Search the campaigns Refs have opened to new players, and ask to join with one of your crows.', '#find')
    ];
    if (me.canRef) tiles.push(tile('Ref Screen', 'Run sessions and keep your campaigns: open one or start a new one.', '#campaigns', 'ref'));
    if (me.isAdmin) tiles.push(tile('Manage accounts', 'Mark accounts as players or Refs, send reset links, and more.', '#admin', 'admin'));
    var news = el('div');
    show([
      el('h1', { text: 'Welcome, ' + me.username }),
      news,
      el('p', { class: 'muted', text: 'What would you like to do?' }),
      el('div', { class: 'tiles' }, tiles)
    ]);
    loadNews(news);
  }

  /* Notifications (a Ref answered a join request), kept on the home page until dismissed. */
  function noteText(n) {
    var d = n.detail || {}, crow = d.character || 'your crow', camp = d.campaign || 'their campaign';
    if (n.kind === 'join_accepted') return d.ref + ' accepted ' + crow + ' into ' + camp + '. You\u2019ll see each other\u2019s changes live.';
    if (n.kind === 'join_declined') return d.ref + ' declined ' + crow + '\u2019s request to join ' + camp + '. You can ask again from their invite link, or from Find a campaign if it\u2019s listed.';
    if (n.kind === 'control_given') return d.owner + ' handed you ' + crow + ' to play. It\u2019s under Handed to you in My characters until they take it back.';
    if (n.kind === 'control_taken') return d.owner + ' took back control of ' + crow + '.';
    if (n.kind === 'control_returned') return d.by + ' handed ' + crow + ' back to you.';
    if (n.kind === 'control_claimed') return d.by + ' (Ref of ' + (d.campaign || 'your campaign') + ') took control of ' + crow + ' to play it. If it\u2019s yours, Take back control under Delegate Control in My characters.';
    return null;
  }
  function loadNews(box) {
    api('GET', 'notes.list').then(function (j) {
      var items = j.items.filter(noteText);
      unread = j.items.length; nav();
      box.innerHTML = '';
      if (!items.length) return;
      box.appendChild(el('div', { class: 'card news' }, [
        el('div', { class: 'list-head' }, [el('h2', { text: 'News' }), items.length > 1 ? btn('Dismiss all', function () {
          api('POST', 'notes.dismiss', { all: true }).then(function () { loadNews(box); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost') : null]),
        el('ul', { class: 'rows' }, items.map(function (n) {
          var ok = n.kind !== 'join_declined' && n.kind !== 'control_taken';
          var open = n.kind === 'join_accepted' || n.kind === 'control_given';
          return el('li', { class: ok ? 'yes' : 'no' }, [
            el('div', null, [el('div', { text: noteText(n) }), el('div', { class: 'meta', text: when(n.at) })]),
            el('div', { class: 'btns' }, [
              open && n.detail.characterId ? a('Play ' + (n.detail.character || 'it'), PLAY + '?id=' + n.detail.characterId, 'btn btn-small btn-primary') : null,
              btn('Dismiss', function () { api('POST', 'notes.dismiss', { id: n.id }).then(function () { loadNews(box); }, function (e) { toast(e.message); }); }, 'btn-small btn-ghost')])
          ]);
        }))]));
    }, function () { /* nothing to show */ });
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
      Promise.all([api('GET', 'list', undefined, 'kind=' + kind),
        opts.campaigns ? api('GET', 'characters.campaigns').then(null, function () { return { campaigns: {} }; }) : null]).then(function (res) {
        var j = res[0], camps = res[1] ? res[1].campaigns : null;
        list.innerHTML = '';
        if (!j.items.length) list.appendChild(el('li', { class: 'empty', text: opts.empty }));
        j.items.forEach(function (it) { list.appendChild(row(it, camps && camps[it.id])); });
      }, function (e) { list.innerHTML = ''; list.appendChild(el('li', { class: 'empty', text: e.message })); });
    }
    function row(it, camps) {
      var panel = el('div', { class: 'share-panel', hidden: true });
      var btns = opts.buttons(it).concat(opts.manage && kind === 'characters' ? [
        btn('Share', function () { if (panel.hidden) sharePanel(it, panel); else panel.hidden = true; }, 'btn-small btn-ghost', 'Send your Ref a link to this character'),
        btn('Delegate Control', function () { if (panel.hidden) controlPanel(it, panel, load); else panel.hidden = true; }, 'btn-small btn-ghost',
          'Let another player or your Ref play this crow, and take it back when you like')
      ] : []).concat(opts.manage && kind === 'campaigns' ? [
        btn('Rename', function () { if (panel.hidden) renamePanel(it, panel, load); else panel.hidden = true; }, 'btn-small btn-ghost', 'Change this campaign\'s name')
      ] : []).concat(opts.manage ? [
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
          el('div', { class: 'meta', text: [it.summary, 'saved ' + when(it.updatedAt)].filter(Boolean).join(' · ') }),
          opts.campaigns ? campaignChips(camps) : null,
          it.controller ? el('div', { class: 'camps' }, [el('span', { class: 'camp-chip warn', title: it.controller + ' can open and play this crow until you take it back' }, [
            el('b', { text: 'Handed to ' + it.controller })])]) : null]),
        el('div', { class: 'btns' }, btns),
        panel
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
        a(kind === 'characters' ? 'Create a character' : 'New ' + K.one, K.app + '?new=1' + (kind === 'characters' ? '&mode=build' : ''), 'btn btn-primary'),
        el('label', { class: 'btn file-btn', title: 'Add .json save files from this device to your account' }, ['Upload file',
          el('input', { type: 'file', accept: '.json,application/json', multiple: true, onchange: function () { upload(this); } })])
      ] : [])
    ]);
    var handed = kind === 'characters' ? el('div') : null;
    show([head, opts.intro ? el('p', { class: 'muted', text: opts.intro }) : null, el('div', { class: 'card' }, [list]), handed]);
    load();
    if (handed) handedToMe(handed, opts);
  }

  /* Crows other players handed to this user to play (shown under their own on My characters and Play). */
  function handedToMe(box, opts) {
    api('GET', 'control.list').then(function (j) {
      box.innerHTML = '';
      if (!j.items.length) return;
      box.appendChild(el('h2', { class: 'section-head', text: 'Handed to you' }));
      box.appendChild(el('p', { class: 'muted', text: 'Other players\u2019 crows you can play until they take them back. Changes save to their sheet.' }));
      box.appendChild(el('div', { class: 'card' }, [el('ul', { class: 'rows' }, j.items.map(function (it) {
        return el('li', null, [
          el('div', null, [el('div', { class: 'name', text: it.name || 'Unnamed crow' }),
            el('div', { class: 'meta', text: [it.owner + '\u2019s crow', it.summary, 'saved ' + when(it.updatedAt)].filter(Boolean).join(' · ') })]),
          el('div', { class: 'btns' }, [
            opts.manage ? a('Edit', GEN + '?id=' + it.id + '&mode=build', 'btn btn-small') : null,
            a('Play', PLAY + '?id=' + it.id, 'btn btn-small btn-primary'),
            btn('Hand back', function () {
              if (!confirm('Hand ' + (it.name || 'this crow') + ' back to ' + it.owner + '? You won\u2019t be able to open it after that.')) return;
              api('POST', 'control.release', { id: it.id }).then(function () { toast('Handed back to ' + it.owner + '.'); handedToMe(box, opts); }, function (e) { toast(e.message); });
            }, 'btn-small btn-ghost', 'Give control back to ' + it.owner)])
        ]);
      }))]));
    }, function () { /* older server: nothing to show */ });
  }

  /*
   * Hand a character to someone else to play (another player, or the Ref), or take it back. They can open,
   * edit, and play it, and act with it in fights; the owner keeps full access and can take it back any time.
   */
  function controlPanel(it, panel, reload) {
    panel.hidden = false; panel.innerHTML = '';
    panel.appendChild(el('p', { class: 'muted', text: 'Loading…' }));
    var crow = it.name || 'this crow';
    function draw(j) {
      panel.innerHTML = '';
      panel.appendChild(el('h3', { text: 'Delegate control of ' + crow }));
      if (j.controller) {
        panel.appendChild(el('p', { text: j.controller.username + ' has control of ' + crow + ' (since ' + new Date(j.controller.since).toLocaleDateString() +
          '). They can open, edit, and play it, and act with it in fights. You still can too.' }));
        panel.appendChild(el('div', { class: 'row-btns' }, [btn('Take back control', function () {
          api('POST', 'control.take', { id: it.id }).then(function () { toast('You have ' + crow + ' back.'); reload(); }, function (e) { toast(e.message); });
        }, 'btn-small btn-primary')]));
        return;
      }
      var listId = 'control-refs-' + it.id;
      var who = input('text', 'username', { placeholder: 'Their username', list: listId, autocomplete: 'off', 'aria-label': 'Username' });
      panel.appendChild(el('p', { class: 'fine', text: 'Let another player or your Ref play ' + crow + ', say for a session you\u2019ll miss. They can open, edit, and play it, and act with it in fights, but not delete, copy, or share it. You keep full access and can take it back any time.' }));
      panel.appendChild(el('datalist', { id: listId }, j.refs.map(function (r) { return el('option', { value: r }); })));
      // In a campaign: pick its Ref or one of the other players there, or "Someone else" to type a username.
      var camps = j.campaigns || [], pick = null, kids = [];
      if (camps.length) {
        pick = el('select', { name: 'pick', 'aria-label': 'Hand to', onchange: function () { typed.hidden = pick.value !== ''; if (!typed.hidden) who.focus(); } },
          camps.map(function (c) {
            return el('optgroup', { label: c.name }, [el('option', { value: c.ref, text: c.ref + ' (Ref)' })].concat(
              c.players.map(function (u) { return el('option', { value: u, text: u }); })));
          }).concat([el('option', { value: '', text: 'Someone else\u2026' })]));
        kids.push(field('Hand to', pick, camps.some(function (c) { return c.players.length; }) ? null : 'No other players in ' + (camps.length > 1 ? 'these campaigns' : camps[0].name) + ' yet.'));
      }
      var typed = field(pick ? 'Their username' : 'Hand to', who, !pick && j.refs.length ? 'Refs with access: ' + j.refs.join(', ') : null);
      typed.hidden = !!pick;
      kids.push(typed);
      panel.appendChild(form(kids, 'Delegate control', function (v) {
        return api('POST', 'control.give', { id: it.id, username: v.pick || v.username }).then(function (r) {
          toast(r.controller.username + ' can now play ' + crow + '.'); reload();
        });
      }));
    }
    api('GET', 'control.get', undefined, 'id=' + it.id).then(draw, function (e) { panel.innerHTML = ''; panel.appendChild(el('p', { class: 'muted', text: e.message })); });
  }

  /* Where a crow stands in campaigns (My characters): one chip per campaign, Ref, or join request. */
  var CAMP_STATES = { active: ['In play', 'ok'], away: ['Sitting out', ''], dead: ['Dead', 'bad'], retired: ['Retired', ''], lost: ['Lost to the Miasma', 'bad'],
    pending: ['Asked to join', 'warn'], declined: ['Request declined', ''], access: ['Ref has access, not in a party', ''] };
  function campaignChips(camps) {
    if (!camps || !camps.length) return el('div', { class: 'camps' }, [el('span', { class: 'camp-chip none', text: 'Not in a campaign' })]);
    return el('div', { class: 'camps' }, camps.map(function (c) {
      var st = CAMP_STATES[c.state] || [c.state, ''];
      return el('span', { class: 'camp-chip ' + st[1], title: (c.campaign ? c.campaign + ', run by ' : 'Ref: ') + c.ref }, [
        el('b', { text: st[0] }), ' \u00b7 ' + (c.campaign ? c.campaign + ' (' + c.ref + ')' : c.ref)]);
    }));
  }

  /*
   * Sharing one character with a Ref: make (or replace) the link, see which Refs have it, take access away.
   * Only the link's hash is stored, so a link can be shown once; "New link" makes another and retires the old.
   */
  /* Rename a campaign: sets its name in the save itself (as the Ref Screen's Campaign name field does), so an open Ref Screen picks it up. */
  function renamePanel(it, panel, done) {
    panel.hidden = false; panel.innerHTML = '';
    panel.appendChild(el('p', { class: 'muted', text: 'Loading…' }));
    api('GET', 'get', undefined, 'kind=campaigns&id=' + it.id).then(function (j) {
      var rec = j.item;
      var name = input('text', 'name', { value: rec.data.name || '', maxlength: 120, placeholder: (rec.data.village && rec.data.village.name) || 'Untitled campaign' });
      panel.innerHTML = '';
      panel.appendChild(el('h3', { text: 'Rename campaign' }));
      panel.appendChild(form([field('Campaign name', name, 'Leave it blank to use the village name.')], 'Save name', function (v) {
        var data = rec.data;
        data.name = v.name.trim();
        return api('POST', 'save', { id: it.id, version: rec.version, data: data, name: KINDS.campaigns.name(data), summary: rec.summary }, 'kind=campaigns').then(function () {
          panel.hidden = true; toast('Renamed.'); done();
        }, function (e) {
          if (e.status !== 409) throw e;
          // Changed in the Ref Screen meanwhile: rename the latest copy on the next try.
          return api('GET', 'get', undefined, 'kind=campaigns&id=' + it.id).then(function (k) { rec = k.item; }, function () { /* keep the old copy */ }).then(function () {
            throw new Error('The campaign was just changed in the Ref Screen. Save again to rename it.');
          });
        });
      }));
      name.focus(); name.select();
    }, function (e) { panel.innerHTML = ''; panel.appendChild(el('div', { class: 'msg err', text: e.message })); });
  }
  function sharePanel(it, panel) {
    panel.hidden = false; panel.innerHTML = '';
    panel.appendChild(el('p', { class: 'muted', text: 'Loading…' }));
    var linkBox = el('div');
    function showLink(link) {
      var box = input('text', 'share', { value: link, readonly: true, 'aria-label': 'Character link' });
      linkBox.innerHTML = '';
      linkBox.appendChild(el('div', { class: 'msg ok' }, [
        'Send this link to your Ref. They can add ' + (it.name || 'this crow') + ' to a campaign, see the sheet, and change its vitals (Stamina, wounds, conditions…), equipment, and notes. Keep it private: any Ref who has it can do the same.',
        el('div', { class: 'copy' }, [box, btn('Copy', function () {
          box.select();
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { document.execCommand('copy'); toast('Link copied.'); });
        }, 'btn-small')])]));
    }
    function draw(j) {
      panel.innerHTML = '';
      panel.appendChild(el('h3', { text: 'Share with your Ref' }));
      panel.appendChild(el('div', { class: 'row-btns' }, [
        btn(j.hasLink ? 'New link' : 'Make a link', function () {
          if (j.hasLink && !confirm('Make a new link? The old one stops working for anyone who hasn\'t used it yet. Refs who already added this crow keep access.')) return;
          api('POST', 'share.create', { id: it.id }).then(function (r) { j.hasLink = true; draw(j); showLink(r.link); }, function (e) { toast(e.message); });
        }, 'btn-small btn-primary'),
        j.hasLink ? btn('Turn off link', function () {
          api('POST', 'share.disable', { id: it.id }).then(function () { j.hasLink = false; draw(j); toast('The link no longer works. Refs who already added this crow keep access.'); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost') : null
      ]));
      panel.appendChild(linkBox);
      panel.appendChild(el('p', { class: 'fine', text: j.refs.length ? 'Refs with access:' : 'No Ref has added this crow yet.' }));
      if (j.refs.length) panel.appendChild(el('ul', { class: 'access' }, j.refs.map(function (r) {
        var claim = el('input', { type: 'checkbox', checked: r.canTakeControl ? true : null, onchange: function () {
          var c = this;
          api('POST', 'share.allowControl', { accessId: r.accessId, allow: c.checked }).then(function () {
            r.canTakeControl = c.checked;
            toast(c.checked ? r.username + ' can now take control of ' + (it.name || 'this crow') + '.' : r.username + ' can no longer take control.');
          }, function (e) { c.checked = !c.checked; toast(e.message); });
        } });
        return el('li', null, [el('div', null, [el('span', { text: r.username + ' · since ' + new Date(r.since).toLocaleDateString() }),
          el('label', { class: 'check-row fine', title: 'Lets this Ref open, edit, and play the whole sheet themselves, say for a session you’ll miss. You’re told when they do, and can take it back.' },
            [claim, ' Can take control of the whole sheet'])]),
          btn('Remove', function () {
            if (!confirm('Take away ' + r.username + '\u2019s access to ' + (it.name || 'this crow') + '?')) return;
            api('POST', 'share.revoke', { accessId: r.accessId }).then(function () { toast('Removed.'); load(); }, function (e) { toast(e.message); });
          }, 'btn-small btn-danger')]);
      })));
    }
    function load() { api('GET', 'share.get', undefined, 'id=' + it.id).then(draw, function (e) { panel.innerHTML = ''; panel.appendChild(el('p', { class: 'muted', text: e.message })); }); }
    load();
  }

  /* Someone opened a character link. Refs pick a campaign to add it to; anyone else is told to pass it on. */
  function viewShare(token) {
    nav();
    var box = el('div', { class: 'card' }, [el('p', { class: 'muted', text: 'Loading…' })]);
    show([el('div', { class: 'narrow' }, [el('h1', { text: 'Shared character' }), box])]);
    if (!me.canRef) {
      box.innerHTML = '';
      box.appendChild(el('p', { text: 'This is a link to someone\u2019s character. Only Refs can add characters to a campaign, so send it to your Ref.' }));
      box.appendChild(a('Home', '#home', 'btn'));
      return;
    }
    Promise.all([api('GET', 'link.preview', undefined, 'token=' + token), api('GET', 'list', undefined, 'kind=campaigns')]).then(function (res) {
      var c = res[0], camps = res[1].items;
      box.innerHTML = '';
      box.appendChild(el('h2', { text: c.name || 'Unnamed crow' }));
      box.appendChild(el('p', { class: 'muted', text: [c.summary, 'played by ' + c.owner].filter(Boolean).join(' · ') }));
      if (c.own) box.appendChild(el('div', { class: 'msg warn', text: 'This is your own character.' }));
      if (c.accessId) box.appendChild(el('div', { class: 'msg ok', text: 'You already have access to this crow. Adding it to another campaign is fine too.' }));
      box.appendChild(el('p', { text: 'Add it to which campaign? You\u2019ll see its vitals live, and can change them, its equipment, and its notes.' }));
      box.appendChild(el('ul', { class: 'rows' }, camps.map(function (cp) {
        return el('li', null, [el('div', null, [el('div', { class: 'name', text: cp.name || 'Untitled' }), el('div', { class: 'meta', text: cp.summary || '' })]),
          a('Add to this campaign', REF + '?id=' + cp.id + '#addlink=' + token, 'btn btn-small btn-primary')]);
      }).concat([el('li', null, [el('div', { class: 'name', text: 'A new campaign' }), a('Start one with this crow', REF + '?new=1#addlink=' + token, 'btn btn-small')])])));
    }, function (e) {
      box.innerHTML = '';
      box.appendChild(el('p', { text: e.message }));
      box.appendChild(a('Home', '#home', 'btn'));
    });
  }

  /*
   * Find a campaign: the campaigns Refs have listed, searchable by name, summary, the Ref's note, or the Ref's
   * username. Each opens the same join page an invite link does.
   */
  function viewFind() {
    var q = el('input', { type: 'search', class: 'grow', placeholder: 'Search by name, Ref, or words in the description', 'aria-label': 'Search campaigns', maxlength: 200 });
    var list = el('ul', { class: 'rows' }, [el('li', { class: 'empty', text: 'Loading…' })]);
    var seq = 0, timer = null;
    function load() {
      var mine = ++seq, words = q.value.trim();
      api('GET', 'campaigns.search', undefined, 'q=' + encodeURIComponent(words)).then(function (j) {
        if (mine !== seq) return;
        list.innerHTML = '';
        if (!j.items.length) list.appendChild(el('li', { class: 'empty', text: words ? 'No listed campaign matches that. Try fewer or other words.' : 'No campaigns are listed right now. Ask a Ref for an invite link, or check back later.' }));
        j.items.forEach(function (c) {
          var state = c.own ? 'Your campaign' : c.mine === 'pending' ? 'You asked to join' : c.mine === 'accepted' ? 'One of your crows is in' : null;
          list.appendChild(el('li', null, [
            el('div', { class: 'grow' }, [el('div', { class: 'name', text: c.name }),
              el('div', { class: 'meta', text: ['run by ' + c.ref, c.crows === 1 ? '1 crow in play' : c.crows + ' crows in play', c.summary].filter(Boolean).join(' · ') }),
              c.note ? el('div', { class: 'note', text: c.note }) : null]),
            el('div', { class: 'btns' }, [state ? el('span', { class: 'meta', text: state }) : null,
              a(c.own ? 'View' : 'Ask to join', '#campaign=' + c.id, 'btn btn-small' + (c.own ? '' : ' btn-primary'))])]));
        });
        if (j.more) list.appendChild(el('li', { class: 'empty', text: 'Showing the newest ' + j.items.length + '. Search to narrow it down.' }));
      }, function (e) { if (mine !== seq) return; list.innerHTML = ''; list.appendChild(el('li', { class: 'empty', text: e.message })); });
    }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 300); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(timer); load(); } });
    show([el('div', { class: 'list-head' }, [el('h1', { text: 'Find a campaign' })]),
      el('p', { class: 'muted', text: 'These campaigns are open to new players. Pick one to ask to join with one of your crows; its Ref accepts or declines.' }),
      el('div', { class: 'card' }, [el('div', { class: 'row search' }, [q]), list])]);
    load();
  }

  /*
   * Someone opened a campaign invite ({ token }), or a listed campaign from Find a campaign ({ campaign: id }).
   * They pick which of their crows to bring; the Ref accepts or declines in the Ref Screen. Each crow shows
   * where its request stands, and a waiting one can be withdrawn.
   */
  function viewJoin(src) {
    nav();
    var query = src.token ? 'token=' + src.token : 'campaign=' + encodeURIComponent(src.campaign);
    var again = src.token ? 'open this link again' : 'come back to this page';
    var box = el('div', { class: 'card' }, [el('p', { class: 'muted', text: 'Loading…' })]);
    show([el('div', { class: 'narrow' }, [el('h1', { text: 'Join a campaign' }), box])]);
    function load() {
      api('GET', 'join.preview', undefined, query).then(draw, function (e) {
        box.innerHTML = '';
        box.appendChild(el('p', { text: e.message }));
        box.appendChild(src.token ? a('Home', '#home', 'btn') : a('Find a campaign', '#find', 'btn'));
      });
    }
    function draw(j) {
      box.innerHTML = '';
      box.appendChild(el('h2', { text: j.campaign || 'Untitled campaign' }));
      box.appendChild(el('p', { class: 'muted', text: [j.summary, 'run by ' + j.ref].filter(Boolean).join(' · ') }));
      if (j.own) box.appendChild(el('div', { class: 'msg warn', text: 'This is your own campaign.' }));
      box.appendChild(el('p', { text: 'Pick the crow you want to play. ' + j.ref + ' will see your request in the Ref Screen. If they accept, ' +
        'the crow joins the party: they can see its sheet and change its vitals (Stamina, wounds, conditions…), equipment, and notes, ' +
        'and you both see each other\u2019s changes live. You can take that access away later from the crow\u2019s Share button.' }));
      if (!j.characters.length) {
        box.appendChild(el('p', { class: 'muted', text: 'You have no characters yet. Create one in My characters, then ' + again + '.' }));
        box.appendChild(a('Go to My characters', '#characters', 'btn btn-primary'));
        return;
      }
      box.appendChild(el('ul', { class: 'rows' }, j.characters.map(function (c) {
        var state = c.status === 'pending' ? el('span', { class: 'meta', text: 'Waiting for ' + j.ref })
          : c.status === 'accepted' && c.refHasAccess ? el('span', { class: 'meta', text: 'In the campaign' })
          : c.status === 'declined' ? el('span', { class: 'meta', text: 'Declined' }) : null;
        var act = c.status === 'pending' ? btn('Withdraw', function () {
            api('POST', 'join.cancel', { id: c.requestId }).then(function () { toast('Request withdrawn.'); load(); }, function (e) { toast(e.message); load(); });
          }, 'btn-small btn-ghost')
          : c.status === 'accepted' && c.refHasAccess ? null
          : btn(c.status === 'declined' ? 'Ask again' : 'Ask to join', function () {
            api('POST', 'join.request', { token: src.token || '', campaign: src.token ? 0 : Number(src.campaign), characterId: c.id }).then(function () { toast('Asked to join with ' + (c.name || 'this crow') + '.'); load(); },
              function (e) { toast(e.message); load(); });
          }, 'btn-small btn-primary');
        return el('li', null, [el('div', null, [el('div', { class: 'name', text: c.name || 'Unnamed crow' }), el('div', { class: 'meta', text: c.summary || '' })]),
          el('div', { class: 'btns' }, [state, act])]);
      })));
      box.appendChild(el('p', { class: 'fine' }, ['Want a new crow for this campaign? Create one in ', a('My characters', '#characters', ''), ', then ' + again + '.']));
      if (!src.token) box.appendChild(el('p', null, [a('Back to Find a campaign', '#find', 'btn btn-small btn-ghost')]));
    }
    load();
  }

  function viewCharacters() {
    listPage('characters', {
      title: 'My characters', manage: true, campaigns: true,
      intro: 'Create a character to roll up a new crow; it goes into your account when you press Save character. Saved crows save changes as you go.',
      empty: 'No characters yet. Use Create a character above, or upload a save file from the character generator.',
      buttons: function (it) { return [a('Edit', GEN + '?id=' + it.id + '&mode=build', 'btn btn-small btn-primary'), a('Play', PLAY + '?id=' + it.id, 'btn btn-small')]; }
    });
  }
  function viewPlay() {
    listPage('characters', {
      title: 'Play', manage: false,
      intro: 'Pick a crow to open in Play mode. Everything you change at the table is saved to your account as you go.',
      empty: 'You have no characters yet. Create one in My characters first.',
      buttons: function (it) { return [a('Play', PLAY + '?id=' + it.id, 'btn btn-small btn-primary')]; }
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
      mfaCard(),
      emailCard(),
      el('div', { class: 'card' }, [el('h2', { text: 'Devices' }),
        el('p', { class: 'muted', text: 'You stay logged in for 30 days on each device you use.' }),
        btn('Log out everywhere else', function () {
          api('POST', 'account.logoutOthers', {}).then(function () { toast('Logged out of your other devices.'); }, function (e) { toast(e.message); });
        })]),
      el('div', { class: 'card' }, [el('h2', { text: 'Delete account' }),
        el('p', { class: 'muted', text: 'This removes your account and all its saved characters and campaigns. Download anything you want to keep first.' }), del])
    ])]);
  }

  /* How this account signs in, and ways to change it or get new recovery codes (both need the password). */
  function mfaCard() {
    var box = el('div', { class: 'card' }, [el('h2', { text: 'Two-step login' }), el('p', { class: 'muted', text: 'Loading…' })]);
    function withPassword(label, then) {
      var pw = input('password', 'currentPassword', { autocomplete: 'current-password' });
      var f = form([field('Current password', pw)], label, function (v) { return then(v.currentPassword); });
      box.appendChild(f); pw.focus();
    }
    api('GET', 'account.mfa').then(function (j) {
      box.innerHTML = '';
      box.appendChild(el('h2', { text: 'Two-step login' }));
      box.appendChild(el('p', { class: 'muted', text: j.method ? 'On, with ' + (j.method === 'totp' ? 'an authenticator app' : 'codes emailed to ' + me.email) + '. ' +
        j.recoveryLeft + ' recovery code' + (j.recoveryLeft === 1 ? '' : 's') + ' left.' : 'Not set up yet: you\u2019ll set it up the next time you log in.' }));
      if (j.method && j.recoveryLeft <= 3) box.appendChild(el('div', { class: 'msg warn', text: 'You\u2019re running low on recovery codes. Make new ones.' }));
      box.appendChild(el('div', { class: 'row-btns' }, [
        btn(j.method ? 'Change method' : 'Set it up now', function () {
          withPassword('Continue', function (pw) { return api('POST', 'account.mfaChange', { currentPassword: pw }).then(function (r) { viewMfaSetup({ token: r.token, email: r.email }, { change: true }); }); });
        }, 'btn-small'),
        j.method ? btn('New recovery codes', function () {
          withPassword('Make new codes', function (pw) {
            return api('POST', 'account.mfaRecovery', { currentPassword: pw }).then(function (r) {
              var card = el('div', { class: 'card' }); show([el('div', { class: 'narrow' }, [card])]);
              recoveryCodes(card, r.recoveryCodes, 'New recovery codes', function () { go('account'); toast('Your old recovery codes no longer work.'); });
            });
          });
        }, 'btn-small btn-ghost') : null]));
    }, function (e) { box.lastChild.textContent = e.message; });
    return box;
  }

  /* Optional emails, saved as soon as a box is ticked or unticked. */
  function emailCard() {
    var box = el('div', { class: 'card' }, [el('h2', { text: 'Email notifications' }), el('p', { class: 'muted', text: 'Loading…' })]);
    var opts = [['joinDecisions', 'When a Ref accepts or declines my request to join a campaign']];
    if (me.isAdmin) opts.push(['newAccounts', 'When someone creates an account (admins)']);
    api('GET', 'account.emailPrefs').then(function (j) {
      box.innerHTML = '';
      box.appendChild(el('h2', { text: 'Email notifications' }));
      box.appendChild(el('p', { class: 'muted', text: 'Sent to ' + me.email + '. You\u2019ll still see these on your home page either way. Password and email-change messages are always sent.' }));
      opts.forEach(function (o) {
        var cb = el('input', { type: 'checkbox', checked: j.prefs[o[0]] ? true : null, onchange: function () {
          var body = {}; body[o[0]] = this.checked; var c = this;
          api('POST', 'account.setEmailPrefs', body).then(function () { toast(c.checked ? 'Emails on.' : 'Emails off.'); }, function (e) { c.checked = !c.checked; toast(e.message); });
        } });
        box.appendChild(el('label', { class: 'check-row' }, [cb, ' ' + o[1]]));
      });
    }, function (e) { box.lastChild.textContent = e.message; });
    return box;
  }

  // ---------------------------------------------------------------- admin
  function viewAdmin() {
    var body = el('tbody', null, [el('tr', null, [el('td', { colspan: 7, class: 'muted', text: 'Loading…' })])]);
    var search = input('search', 'q', { placeholder: 'Filter by name or email' });
    var users = [];
    var linkBox = el('div');
    function load() {
      api('GET', 'admin.users').then(function (j) { users = j.users; draw(); }, function (e) { body.innerHTML = ''; body.appendChild(el('tr', null, [el('td', { colspan: 7, text: e.message })])); });
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
          el('td', { class: 'fine', text: u.mfa === 'totp' ? 'App' : u.mfa === 'email' ? 'Email' : 'Not yet' }),
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
            u.mfa ? btn('Reset 2-step', function () {
              if (!confirm('Reset ' + u.username + '\u2019s two-step login? They\u2019re logged out everywhere and set up a new method at their next login. Do this only once you\u2019re sure it\u2019s really them asking.')) return;
              act('admin.resetMfa', { userId: u.id }, function () { toast(u.username + ' will set up two-step login again at their next login.'); if (self) { me = null; go('login'); } });
            }, 'btn-small btn-ghost', 'For someone who lost their phone and recovery codes') : null,
            self ? null : btn('Delete', function () {
              if (!confirm('Delete ' + u.username + ' and all of their saved characters and campaigns? This can\'t be undone.')) return;
              act('admin.deleteUser', { id: u.id }, function () { toast('Deleted ' + u.username + '.'); });
            }, 'btn-small btn-danger')
          ])])
        ]));
      });
      if (!body.children.length) body.appendChild(el('tr', null, [el('td', { colspan: 7, class: 'muted', text: 'No matching accounts.' })]));
    }
    search.addEventListener('input', draw);
    var EVENTS = { login: 'Logged in', login_failed: 'Failed login', register: 'Created account', password_reset: 'Reset password',
      reset_requested: 'Asked for reset email', password_changed: 'Changed password', email_changed: 'Changed email',
      password_check_failed: 'Wrong current password', logout_others: 'Logged out other devices', account_deleted: 'Deleted own account',
      role_set: 'Role changed', admin_granted: 'Made admin', admin_revoked: 'Admin removed', reset_link_made: 'Reset link made',
      user_deleted: 'Account deleted', share_link_made: 'Made a share link', share_link_disabled: 'Turned off share link',
      share_redeemed: 'Ref added a shared crow', share_revoked: 'Took away a Ref\u2019s access', login_password: 'Password OK (second step next)',
      mfa_failed: 'Wrong two-step code', mfa_set_up: 'Set up two-step login', mfa_recovery_used: 'Used a recovery code',
      mfa_recovery_regenerated: 'Made new recovery codes', mfa_reset: 'Two-step login reset by admin' };
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
          el('thead', null, [el('tr', null, ['Account', 'Role', 'Admin', 'Saves', '2-step', 'Last login', ''].map(function (h) { return el('th', { text: h }); }))]),
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
