/*
 * Ref Screen: the World, Bestiary, Tables, and Rules tabs. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addCombatant = f('addCombatant'), addsText = f('addsText'), addToCombatBtn = f('addToCombatBtn'), area = f('area'), btn = f('btn'),
      card = f('card'), chk = f('chk'), clamp = f('clamp'), download = f('download'), field = f('field'), inp = f('inp'), log = f('log'),
      logItem = f('logItem'), logText = f('logText'), lookup = f('lookup'), more = f('more'), nid = f('nid'), render = f('render'), rich = f('rich'),
      rollDungeonTable = f('rollDungeonTable'), rollInText = f('rollInText'), rollMerchant = f('rollMerchant'),
      rollMiasmaTouched = f('rollMiasmaTouched'), rollTravelEncounter = f('rollTravelEncounter'), rollTravelers = f('rollTravelers'),
      rollWeather = f('rollWeather'), rollWildAnimal = f('rollWildAnimal'), rowsTable = f('rowsTable'), S = f('S'), save = f('save'), sel = f('sel'),
      setTab = f('setTab');
  var $ = A.$, d = A.d, d100 = A.d100, el = A.el, fmt = A.fmt, pick = A.pick, plural = A.plural, rollDice = A.rollDice, Rules = A.Rules,
      signed = A.signed, SIZES = A.SIZES, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ World tab
  function renderWorld() {
    card('sec-places', el('h2', null, ['Places', el('small', { text: 'dungeons, points of interest, villages' })]), [
      el('p', { class: 'hint', text: 'A dungeon\'s greed bonus applies only on the players\' first visit. "Run here" sets the Session tab\'s location, EN, and monster table.' }),
      el('div', { class: 'list' }, state.places.map(function (p) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(p, 'name', { placeholder: 'Name' }), sel(p, 'kind', ['Dungeon', 'POI', 'Village', 'Region', 'Other'], { class: 'in mini' }), inp(p, 'hex', { placeholder: 'Hex / location' })]),
          el('div', { class: 'li-row' }, [el('label', { class: 'check' }, ['Base EN ', inp(p, 'en', { type: 'number', min: 2, max: 10, class: 'tiny' }, { dflt: 9 })]),
            sel(p, 'table', [['Blood Creatures', 'Blood creatures'], ['Undead', 'Undead'], ['Travel', 'Travel table'], ['none', 'Ref\'s choice']], { class: 'in mini' }),
            chk(p, 'visited', 'Visited (no greed bonus)'),
            btn('Run here', function () { var s = S(); s.place = p.id; s.table = p.table === 'Travel' ? 'Travel' : REF.DUNGEON_TABLES[p.table] ? p.table : 'none'; s.firstVisit = !p.visited; s.enAdj = 0; s.crowded = false; s.chaos = false; log('', 'The crows head into ' + (p.name || 'a place') + '.'); save(); setTab('session'); }, 'btn-small btn-primary')]),
          area(p, 'notes', { rows: 2, placeholder: 'Rooms, hooks, loot left behind, monsters killed…' })
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove place', onclick: function () { if (confirm('Remove ' + (p.name || 'this place') + '?')) { state.places = state.places.filter(function (x) { return x !== p; }); save(); render(); } } })]);
      })),
      el('div', { class: 'row' }, [btn('Add place', function () { state.places.push({ id: nid(), name: '', kind: 'Dungeon', hex: '', en: 9, table: 'none', visited: false, notes: '' }); save(); render(); }),
        btn('Add the Dungeons book locations', function () {
          REF.SAMPLE_PLACES.forEach(function (sp) { if (!state.places.some(function (p) { return p.name === sp.name; })) state.places.push({ id: nid(), name: sp.name, kind: sp.kind, hex: '', en: sp.en, table: sp.table, visited: false, notes: sp.notes }); });
          save(); render();
        }, 'btn-ghost')])
    ]);

    card('sec-npcs', el('h2', null, ['NPCs', el('small', { text: state.npcs.length ? String(state.npcs.length) : '' })]), [
      el('div', { class: 'list' }, state.npcs.map(function (n) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(n, 'name', { placeholder: 'Name' }), inp(n, 'role', { placeholder: 'Role (steward, connection, rival crow…)' }), inp(n, 'where', { placeholder: 'Where' })]),
          area(n, 'notes', { rows: 2, placeholder: 'Wants, knows, owes…' })
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove NPC', onclick: function () { state.npcs = state.npcs.filter(function (x) { return x !== n; }); save(); render(); } })]);
      })),
      el('div', { class: 'row' }, [btn('Add NPC', function () { state.npcs.push({ id: nid(), name: '', role: '', where: '', notes: '' }); save(); render(); }),
        btn('Random NPC', function () { var n = randomNPC(); state.npcs.push({ id: nid(), name: n.name, role: '', where: '', notes: n.notes }); log('', 'New NPC: ' + n.name + ', ' + n.notes + '.'); save(); render(); }, 'btn-ghost')])
    ]);

    card('sec-notes', 'Campaign Notes', [
      el('div', { class: 'grid2' }, [field('Hooks, rumors & threads', area(state, 'hooks', { rows: 8, placeholder: 'Maps from corpses, gossip from NPC crows, passing merchants…' })),
        field('Notes', area(state, 'notes', { rows: 8, placeholder: 'Anything else worth remembering between sessions.' }))])
    ]);

    card('sec-history', el('h2', null, ['Session History', el('small', { text: plural(state.history.length, 'archived session') })]), [
      state.history.length ? el('div', null, state.history.slice().reverse().map(function (h) {
        return more('Session ' + h.n + (h.title ? ': ' + h.title : '') + (h.date ? ' (' + h.date + ')' : '') + ' — ' + plural(h.log.length, 'entry'), [
          el('ol', { class: 'log-list' }, h.log.map(logItem)),
          el('div', { class: 'row' }, [btn('Export text', function () { download(logText(h.n, h.title, h.date, h.log), 'Crows_Session_' + h.n + '.txt', 'text/plain'); }, 'btn-small'),
            btn('Delete', function () { if (confirm('Delete the archived log of session ' + h.n + '?')) { state.history = state.history.filter(function (x) { return x !== h; }); save(); render(); } }, 'btn-small btn-ghost btn-danger')])
        ]);
      })) : el('p', { class: 'hint', text: 'Starting the next session (Session tab) puts the last one\'s log here.' })
    ]);
  }
  function randomNPC() {
    return { name: pick(REF.NAMES.first) + ' ' + pick(REF.NAMES.last), notes: pick(REF.NAMES.trait) + '; ' + pick(REF.NAMES.want) };
  }

  // ------------------------------------------------------------------ Bestiary tab
  function renderBestiary() {
    var q = ui.beastQ.toLowerCase(), types = ['Animal', 'Human', 'Blood Creature', 'Undead', 'Unique'];
    var list = REF.BESTIARY.filter(function (b) {
      return (!ui.beastType || b.t === ui.beastType) && (!q || (b.n + ' ' + b.x + ' ' + b.atk.map(function (a) { return a[0]; }).join(' ')).toLowerCase().indexOf(q) >= 0);
    });
    var search = el('input', { type: 'search', class: 'in', placeholder: 'Search creatures…', value: ui.beastQ, 'aria-label': 'Search creatures', oninput: function () { ui.beastQ = this.value; var pos = this.selectionStart; renderBestiary(); var n = $('beast-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } });
    search.id = 'beast-q';
    card('sec-bestiary', el('h2', null, ['Bestiary', el('small', { text: list.length + ' of ' + REF.BESTIARY.length })]), [
      el('div', { class: 'row' }, [el('div', { class: 'grow' }, [search]),
        el('div', { class: 'seg' }, [['', 'All']].concat(types.map(function (t) { return [t, t === 'Blood Creature' ? 'Blood' : t]; })).map(function (t) {
          return el('button', { type: 'button', class: ui.beastType === t[0] ? 'on' : '', text: t[1], onclick: function () { ui.beastType = t[0]; renderBestiary(); } });
        }))]),
      more('How Ref creatures work', REF.MONSTER_RULES.map(function (r) { return el('p', { text: r }); }).concat(types.map(function (t) { return REF.TYPE_NOTES[t] ? el('p', null, [el('b', { text: t + 's: ' }), REF.TYPE_NOTES[t]]) : null; }))),
      el('div', { class: 'beast-list' }, list.map(beastCard))
    ]);
  }
  function beastCard(b) {
    var n = { k: 1 };
    var art = artFor(b.n);
    return el('div', { class: 'beast t-' + b.t.split(' ')[0] + (art ? ' has-art' : '') }, [
      art ? el('button', { type: 'button', class: 'b-art', title: 'View ' + b.n + ' art', 'aria-label': 'View ' + b.n + ' art', onclick: function () {
        lightbox(b.n, [{ label: '', file: art.file }], art.thumb, [{ label: art.custom ? 'Replace art' : 'Use my own art', fn: function () { addCreatureArt(b.n); } }]
          .concat(art.custom ? [{ label: 'Remove my art', fn: function () { removeArt('c:' + b.n); } }] : []));
      } }, [el('img', { src: art.thumb, alt: b.n, loading: 'lazy' })]) : null,
      el('div', { class: 'b-head' }, [el('span', { class: 'b-name', text: b.n }), el('span', { class: 'chip', text: b.t + ' · P' + b.p })]),
      el('div', { class: 'b-stats', text: SIZES[b.sz] + ' · Stamina ' + b.st + (b.ad ? ' · AD ' + b.ad : '') + ' · Speed ' + b.spd + (b.sl ? ' · ' + b.sl + ' slots' : '') + (b.rx > 1 ? ' · ' + b.rx + ' reactions' : '') }),
      el('div', { class: 'b-stats', text: 'A ' + signed(b.c[0]) + ' · M ' + signed(b.c[1]) + ' · S ' + signed(b.c[2]) }),
      el('ul', { class: 'b-atk' }, b.atk.map(function (a) { return el('li', null, [el('b', { text: a[0] + ' (' + signed(a[1]) + ') ' }), a[2] + ': ' + a[3] + ' / ' + a[4] + ' dam' + (a[5] ? '; ' + a[5] : '')]); })),
      b.uses.length ? el('div', { class: 'fine', text: b.uses.map(function (u) { return u[0] + ' ' + u[1] + '/' + u[2]; }).join(' · ') }) : null,
      b.x ? el('div', { class: 'b-x', text: b.x }) : null,
      el('div', { class: 'row' }, [inp(n, 'k', { type: 'number', min: 1, max: 30, class: 'tiny', 'aria-label': 'How many' }, { dflt: 1 }),
        btn('Add to combat', function () { addCombatant(b.n, clamp(n.k, 1, 30), 'foe'); log('', 'Added ' + n.k + ' × ' + b.n + ' to combat.'); toast('Added ' + n.k + ' × ' + b.n + '.'); render(); }, 'btn-small'),
        art ? null : btn('Add art', function () { addCreatureArt(b.n); }, 'btn-small btn-ghost'),
        b.t === 'Animal' ? el('span', { class: 'fine', text: 'Pet price ' + fmt(REF.PET_PRICES[Math.min(10, b.p)]) + ' gc' }) : null])
    ]);
  }

  // ------------------------------------------------------------------ Image pop-up and Maps tab
  /* Pictures the Ref adds (maps, and art for any creature): { key: 'c:<creature>' | 'm:<id>', title, thumb, at, url | blob }.
     Logged in, they are kept in the account (api.php art.*; `url` points at the image) so they follow the Ref to every device.
     Otherwise (the offline file) they live in this browser's IndexedDB (`blob`). A creature's own art wins over the built-in picture. */
  var custom = { creatures: {}, maps: [] }, blobUrls = {}, remote = false;
  function cloudApi(method, action, query, body) { return window.CrowsCloud.api(method, action, query, body); }
  function artDb(mode, fn) {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error('This browser can\'t store pictures.'));
      var r = indexedDB.open('crows-ref-art', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('art', { keyPath: 'key' }); };
      r.onerror = function () { no(r.error); };
      r.onsuccess = function () {
        var db = r.result, t = db.transaction('art', mode), req = fn(t.objectStore('art'));
        t.oncomplete = function () { db.close(); ok(req && req.result); };
        t.onerror = t.onabort = function () { db.close(); no(t.error); };
      };
    });
  }
  function toBase64(blob) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1]); }; r.onerror = function () { no(r.error); }; r.readAsDataURL(blob); });
  }
  function artUrl(rec) { return 'api.php?a=art.file&key=' + encodeURIComponent(rec.key) + '&v=' + rec.at; }
  /* Save a picture (new, replaced, or just renamed: a record with no blob keeps the image it has). */
  function putArt(rec) {
    if (!remote) return artDb('readwrite', function (s) { return s.put(rec); });
    return (rec.blob ? toBase64(rec.blob) : Promise.resolve(undefined)).then(function (img) {
      var body = { key: rec.key, title: rec.title, thumb: rec.thumb };
      if (img !== undefined) body.image = img;
      return cloudApi('POST', 'art.save', '', body);
    }).then(function (j) { rec.at = j.at; rec.url = artUrl(rec); delete rec.blob; });
  }
  function removeArt(key) {
    (remote ? cloudApi('POST', 'art.delete', '', { key: key }) : artDb('readwrite', function (s) { return s.delete(key); })).then(function () {
      if (blobUrls[key]) { URL.revokeObjectURL(blobUrls[key]); delete blobUrls[key]; }
      if (key.indexOf('c:') === 0) delete custom.creatures[key.slice(2)]; else custom.maps = custom.maps.filter(function (m) { return m.key !== key; });
      render();
    }, function (e) { toast('Couldn\'t remove it: ' + e.message); });
  }
  function blobUrl(rec) { return rec.url || blobUrls[rec.key] || (blobUrls[rec.key] = URL.createObjectURL(rec.blob)); }
  function addLoaded(r) { if (r.key.indexOf('c:') === 0) custom.creatures[r.key.slice(2)] = r; else custom.maps.push(r); }
  function loadCustom() {
    var local = function () {
      return artDb('readonly', function (s) { return s.getAll(); }).then(function (all) { return all || []; }, function () { return []; });
    };
    var cloud = window.CrowsCloud;
    if (!cloud || !cloud.afterMe) { local().then(function (all) { all.forEach(addLoaded); if (all.length) render(); }); return; }
    cloud.afterMe(function (user) {
      if (!user || !user.canRef) { local().then(function (all) { all.forEach(addLoaded); if (all.length) render(); }); return; }
      cloudApi('GET', 'art.list').then(function (j) {
        remote = true;
        (j.art || []).forEach(function (r) { r.url = artUrl(r); addLoaded(r); });
        render();
        // Pictures added on this device before they were kept in the account move up once.
        return local().then(function (all) {
          return all.reduce(function (p, r) {
            return p.then(function () {
              var have = r.key.indexOf('c:') === 0 ? custom.creatures[r.key.slice(2)] : custom.maps.filter(function (m) { return m.key === r.key; })[0];
              return (have ? Promise.resolve() : putArt(r).then(function () { addLoaded(r); }))
                .then(function () { return artDb('readwrite', function (s) { return s.delete(r.key); }); });
            });
          }, Promise.resolve()).then(function () { if (all.length) render(); });
        });
      }).catch(function () { remote = false; local().then(function (all) { all.forEach(addLoaded); if (all.length) render(); }); });
    });
  }
  function artFor(name) {
    var c = custom.creatures[name];
    return c ? { thumb: c.thumb, file: blobUrl(c), custom: true } : REF.ART.creatures[name] || null;
  }
  /* Choose a picture, shrink it (long side `max` px, under about 1.3 MB, plus a small thumbnail) and hand back { blob, thumb, name }. */
  function pickImage(max, thumbW, done) {
    var inp = el('input', { type: 'file', accept: 'image/*' });
    inp.onchange = function () {
      var file = inp.files && inp.files[0]; if (!file) return;
      var url = URL.createObjectURL(file), img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); toast('That file isn\'t a picture this browser can open.'); };
      img.onload = function () {
        function draw(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); return c; }
        function encode(k, q) {
          return new Promise(function (ok) { draw(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k)).toBlob(ok, 'image/jpeg', q); }).then(function (blob) {
            return !blob || (blob.size <= 1300000) || (k < .2) ? blob : encode(q > .55 ? k : k * .8, q > .55 ? q - .12 : q);
          });
        }
        var tk = Math.min(1, thumbW / img.naturalWidth), th = draw(Math.round(img.naturalWidth * tk), Math.round(img.naturalHeight * tk));
        encode(Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), .86).then(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) return toast('That picture could not be shrunk.');
          done({ blob: blob, thumb: th.toDataURL('image/jpeg', .78), name: file.name.replace(/\.[^.]+$/, '') });
        });
      };
      img.src = url;
    };
    inp.click();
  }
  function addCreatureArt(name) {
    pickImage(2400, 240, function (p) {
      var rec = { key: 'c:' + name, title: name, thumb: p.thumb, blob: p.blob, at: Date.now() };
      putArt(rec).then(function () { if (blobUrls[rec.key]) { URL.revokeObjectURL(blobUrls[rec.key]); delete blobUrls[rec.key]; } custom.creatures[name] = rec; toast('Art saved for ' + name + '.'); render(); },
        function (e) { toast('Couldn\'t save it: ' + e.message); });
    });
  }
  function addMap() {
    pickImage(4500, 420, function (p) {
      var title = prompt('Map name', p.name); if (title === null) return;
      var rec = { key: 'm:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: (title.trim() || p.name).slice(0, 60), thumb: p.thumb, blob: p.blob, at: Date.now() };
      putArt(rec).then(function () { custom.maps.push(rec); toast('Map added.'); render(); }, function (e) { toast('Couldn\'t save it: ' + e.message); });
    });
  }
  loadCustom();

  /* Full-size viewer. views = [{ label, file }]; more than one gets switch buttons. Shows `thumb` (if given) until the file loads, and keeps it if the
     file isn't there (the single-file copy has no art folder). Maps open to fit the screen; click the picture to switch between fit and full size. */
  function lightbox(title, views, thumb, actions) {
    var old = $('lightbox'); if (old) old.remove();
    var cur = 0, img = el('img', { class: 'lb-img', alt: title }), msg = el('p', { class: 'lb-msg' }), sw = el('div', { class: 'seg' }),
        wrap = el('div', { class: 'lb-wrap' }, [img]), fit = true;
    function close() { box.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function show(i) {
      cur = i; msg.textContent = ''; fit = true; wrap.classList.add('fit');
      img.onerror = function () { msg.textContent = thumb ? 'The full-size file isn\'t available here (open the Ref Screen from the site to get it). Showing the small version.' : 'The picture isn\'t available here (open the Ref Screen from the site to get it).'; if (thumb) img.src = thumb; };
      if (thumb) img.src = thumb;
      var big = new Image(); big.onload = function () { if (cur === i) img.src = big.src; }; big.onerror = img.onerror; big.src = views[i].file;
      Array.prototype.forEach.call(sw.children, function (b, j) { b.classList.toggle('on', j === i); });
    }
    img.onclick = function () { fit = !fit; wrap.classList.toggle('fit', fit); };
    views.forEach(function (v, i) { if (views.length > 1) sw.appendChild(el('button', { type: 'button', text: v.label, onclick: function () { show(i); } })); });
    var box = el('div', { id: 'lightbox', class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: function (e) { if (e.target === box) close(); } }, [
      el('div', { class: 'lb-bar' }, [el('b', { text: title }), views.length > 1 ? sw : null, el('span', { class: 'fine', text: 'Click the picture to zoom' }),
        (actions || []).map(function (a) { return btn(a.label, function () { close(); a.fn(); }, 'btn-small'); }),
        btn('Close', close, 'btn-small')].reduce(function (all, k) { return all.concat(k); }, [])), msg, wrap]);
    document.body.appendChild(box); document.addEventListener('keydown', onKey); show(0);
  }
  function renderMaps() {
    var ART = REF.ART;
    function mine(m) {
      return el('button', { type: 'button', class: 'map-tile', onclick: function () {
        lightbox(m.title, [{ label: '', file: blobUrl(m) }], m.thumb, [
          { label: 'Rename', fn: function () { var t = prompt('Map name', m.title); if (t && t.trim()) { var old = m.title; m.title = t.trim().slice(0, 60); putArt(m).then(render, function (e) { m.title = old; toast('Couldn\'t rename it: ' + e.message); }); } } },
          { label: 'Delete', fn: function () { if (confirm('Delete the map "' + m.title + '" from this device?')) removeArt(m.key); } }]);
      } }, [el('img', { src: m.thumb, alt: m.title, loading: 'lazy' }), el('span', { class: 'b-name', text: m.title }), el('span', { class: 'fine', text: 'Yours' })]);
    }
    var mk = custom.maps.slice().sort(function (a, b) { return a.at - b.at; });
    card('sec-maps', el('h2', null, ['Maps', el('small', { text: 'tap a map to open it full size' })]), [
      el('div', { class: 'row' }, [btn('Add a map…', addMap, 'btn-small btn-primary'),
        el('span', { class: 'fine', text: remote ? 'Pictures you add are kept in your account, so they follow you to other devices.' : 'Not logged in: pictures you add are kept in this browser only.' })]),
      el('div', { class: 'map-list' }, mk.map(mine).concat(ART.maps.map(function (m) {
        return el('button', { type: 'button', class: 'map-tile', onclick: function () { lightbox(m.title, m.variants, m.thumb); } }, [
          el('img', { src: m.thumb, alt: m.title, loading: 'lazy' }),
          el('span', { class: 'b-name', text: m.title }),
          el('span', { class: 'fine', text: (m.note || '') + (m.variants.length > 1 ? ' ' + m.variants.map(function (v) { return v.label; }).join(' / ') : '') })]);
      }))),
      ART.extras.length ? el('h3', { text: 'Entrances' }) : null,
      ART.extras.length ? el('div', { class: 'map-list' }, ART.extras.map(function (x) {
        return el('button', { type: 'button', class: 'map-tile', onclick: function () { lightbox(x.title, [{ label: '', file: x.file }], x.thumb); } }, [
          el('img', { src: x.thumb, alt: x.title, loading: 'lazy' }), el('span', { class: 'b-name', text: x.title })]);
      })) : null]);
  }

  // ------------------------------------------------------------------ Tables tab
  function renderTables() {
    var tv = ui.tables;
    function tcard(key, title, controls, roll, tableView) {
      var res = tv[key];
      return el('div', { class: 'tcard' }, [el('h4', { text: title }),
        el('div', { class: 'row' }, (controls || []).concat([btn('Roll', function () { var r = roll(); tv[key] = r; log(r.enc ? 'enc' : '', title + ': ' + r.log); render(); }, 'btn-small btn-primary')])),
        res ? el('div', { class: 'result' }, [el('div', { class: 'r-roll', text: res.roll }), el('div', null, [rich(res.text)]), res.adds && res.adds.length ? addToCombatBtn(res.adds) : null]) : null,
        tableView ? more('Show table', [tableView(res ? res.n : null)]) : null]);
    }
    function simple(rows, dieLabel, n, dice) { var row = lookup(rows, n); var text = dice ? rollInText(row[2]) : row[2]; return { n: n, roll: dieLabel + ' = ' + n, text: text, log: dieLabel + ' ' + n + ' → ' + text }; }
    var o = ui.topts || (ui.topts = { rank: 0, cruelty: 1, prosperity: state.village.prosperity, habitat: state.travel.habitat, dtab: 'Undead', size: 'Medium', climate: state.travel.climate });

    card('sec-tables', el('h2', null, ['Tables', el('small', { text: 'every roll is logged' })]), [el('div', { class: 'table-grid' }, [
      tcard('travel', 'Travel encounter (d100)', [], function () { var r = rollTravelEncounter(); return { n: r.roll, roll: 'd100 = ' + r.roll + ' (' + state.travel.habitat + ', ' + state.travel.climate + ')', text: '**' + r.kind + '.** ' + r.lines.join(' '), adds: r.adds, log: r.summary, enc: true }; },
        function (n) { return rowsTable(REF.TRAVEL_ENCOUNTERS, 'd100', n); }),
      tcard('dungeon', 'Dungeon encounter', [sel(o, 'dtab', Object.keys(REF.DUNGEON_TABLES), { class: 'in' })], function () {
        var e = rollDungeonTable(o.dtab); return { n: e.roll, roll: 'd' + e.die + ' = ' + e.roll, text: e.text + ' → **' + addsText(e.adds) + '**', adds: e.adds, log: e.text + ' → ' + addsText(e.adds) };
      }, function (n) { var t = REF.DUNGEON_TABLES[o.dtab]; return el('div', null, [rowsTable(t.rows, 'd' + t.die, n), t.note ? el('p', { class: 'fine', text: t.note }) : null]); }),
      tcard('anymon', 'Any monster type (d10)', [], function () {
        var m = d(10), row = lookup(REF.ANY_MONSTER, m), e = row[3] ? rollDungeonTable(row[3]) : null;
        return { n: m, roll: 'd10 = ' + m, text: row[2] + (e ? ': ' + e.text + ' → **' + addsText(e.adds) + '**' : ''), adds: e ? e.adds : [], log: row[2] + (e ? ': ' + addsText(e.adds) : '') };
      }, function (n) { return rowsTable(REF.ANY_MONSTER, 'd10', n); }),
      tcard('minor', 'Minor Interesting Things (d100)', [], function () { return simple(REF.MINOR_THINGS, 'd100', d100().total, true); }, function (n) { return rowsTable(REF.MINOR_THINGS, 'd100', n); }),
      tcard('major', 'Major Interesting Things (d100)', [], function () { return simple(REF.MAJOR_THINGS, 'd100', d100().total, true); }, function (n) { return rowsTable(REF.MAJOR_THINGS, 'd100', n); }),
      tcard('backlash', 'Backlash (d100 + spell rank)', [el('label', { class: 'check' }, ['Rank ', inp(o, 'rank', { type: 'number', min: 0, max: 5, class: 'tiny' })])], function () {
        var r = d100().total, n = r + o.rank, row = lookup(REF.BACKLASH, n), text = rollInText(row[2]);
        return { n: n, roll: 'd100 ' + r + ' + rank ' + o.rank + ' = ' + n, text: text, log: n + ' → ' + text };
      }, function (n) { return el('div', null, [el('p', { class: 'fine', text: REF.BACKLASH_RULES }), rowsTable(REF.BACKLASH, 'd100+rank', n)]); }),
      tcard('miasma', 'Miasma effect (1d10 + cruelty)', [el('label', { class: 'check' }, ['Cruelty ', inp(o, 'cruelty', { type: 'number', min: 0, max: 20, class: 'tiny' })])], function () {
        var r = d(10), n = r + o.cruelty, row = lookup(REF.MIASMA_EFFECTS, n);
        return { n: n, roll: '1d10 ' + r + ' + cruelty ' + o.cruelty + ' = ' + n, text: '**' + row[2] + '** ' + row[3], log: n + ' → ' + row[2] + ' ' + row[3] };
      }, function (n) { return rowsTable(REF.MIASMA_EFFECTS, '1d10+cruelty', n, function (r) { return r[2] + ' + ' + r[3]; }); }),
      tcard('village', 'Village event (d10 + Prosperity)', [el('label', { class: 'check' }, ['Prosperity ', inp(o, 'prosperity', { type: 'number', min: -10, max: 10, class: 'tiny' })])], function () {
        var r = d(10), n = r + o.prosperity, row = lookup(REF.VILLAGE_EVENTS, n);
        return { n: n, roll: 'd10 ' + r + ' + Prosperity ' + o.prosperity + ' = ' + n, text: row[2], log: n + ' → ' + row[2] };
      }, function (n) { return rowsTable(REF.VILLAGE_EVENTS, 'd10+P', n); }),
      tcard('animal', 'Wild animal + reaction', [sel(o, 'habitat', Object.keys(REF.HABITATS), { class: 'in' })], function () {
        var w = rollWildAnimal(o.habitat); return { n: null, roll: o.habitat, text: w.lines.join(' '), adds: w.adds, log: w.lines.join(' ') };
      }, function () { var h = REF.HABITATS[o.habitat]; return el('div', null, [rowsTable(h.rows, 'd' + h.die, null), el('h3', { text: 'Reaction (d100)' }), rowsTable(REF.ANIMAL_REACTION, 'd100', null)]); }),
      tcard('weather', 'Bad weather', [sel(o, 'climate', Object.keys(REF.WEATHER_BY_CLIMATE), { class: 'in', re: false })], function () {
        var w = rollWeather(o.climate); return { n: null, roll: o.climate, text: w.text, log: w.text };
      }, function () { return el('dl', { class: 'kv' }, Object.keys(REF.WEATHER).reduce(function (a, k) { return a.concat([el('dt', { text: k }), el('dd', { text: REF.WEATHER[k].txt })]); }, [])); }),
      tcard('merchant', 'Merchant caravan', [], function () { var m = rollMerchant(); return { n: null, roll: 'd100 + guards', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return rowsTable(REF.MERCHANT_SALES, 'd100', null); }),
      tcard('mtouched', 'Miasma-touched humans', [], function () { var m = rollMiasmaTouched(); return { n: null, roll: '1d6 humans + d100', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return rowsTable(REF.MIASMA_TOUCHED, 'd100', null); }),
      tcard('travelers', 'Travelers', [], function () { var m = rollTravelers(); return { n: null, roll: '1d10 humans + d10 + d6', text: m.lines.join(' '), adds: m.adds, log: m.lines.join(' ') }; },
        function () { return el('div', null, [rowsTable(REF.TRAVELER_ENCOUNTERS, 'd10', null), el('h3', { text: 'Rewards (d6)' }), rowsTable(REF.TRAVELER_REWARDS, 'd6', null)]); }),
      tcard('dismember', 'Dismember (weapon crit)', [], function () { return simple(REF.DISMEMBER, 'd6', d(6)); }, function (n) { return rowsTable(REF.DISMEMBER, 'd6', n); }),
      tcard('harvest', 'Harvest a corpse (monster parts)', [sel(o, 'size', Object.keys(REF.HARVEST), { class: 'in', re: false })], function () {
        var r = rollDice(REF.HARVEST[o.size]); return { n: null, roll: r.detail, text: o.size + ' corpse: **' + plural(r.total, 'part') + '**', log: o.size + ' corpse → ' + r.total + ' parts' };
      }),
      tcard('auction', 'Auction house price', [], function () {
        var a = d(6), b = d(6), pct = a % 2 === 0 ? -b * 10 : b * 10, sell = d(10) * (10 + state.village.prosperity);
        return { n: null, roll: 'die ' + a + (a % 2 === 0 ? ' (even: discount)' : ' (odd: markup)') + ', 1d6 ' + b + '; sell 1d10 × (10 + Prosperity)', text: 'Buying: **' + (pct > 0 ? '+' : '') + pct + '%** of value. Selling: **' + sell + '%** of value (must sell once committed).', log: 'buy ' + (pct > 0 ? '+' : '') + pct + '%, sell ' + sell + '%' };
      }),
      tcard('lost', 'Lost: secret direction (d6)', [], function () { var r = d(6); return { n: r, roll: 'd6 = ' + r, text: 'They actually enter the hex to the **' + REF.DIRECTIONS[r] + '**.', log: '(Ref only) ' + REF.DIRECTIONS[r] }; }),
      tcard('npc', 'Random NPC', [], function () { var n = randomNPC(); return { n: null, roll: 'name, trait, want', text: '**' + n.name + '**: ' + n.notes, log: n.name + ', ' + n.notes }; })
    ])]);
  }

  // ------------------------------------------------------------------ Rules tab
  var RULES = null;
  function parseRules() {
    if (RULES) return RULES;
    var blocks = [], h2 = '', h3 = '', n = 0;
    String(typeof REF_RULES === 'string' ? REF_RULES : '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        var lvl = m[1].length, id = 'r' + (n++);
        if (lvl === 1) { blocks.push({ t: 'h1', s: m[2], id: id }); return; }
        if (lvl === 2) { h2 = id; h3 = ''; } else h3 = id;
        blocks.push({ t: 'h' + lvl, s: m[2], id: id, h2: h2 }); return;
      }
      blocks.push({ t: 'p', s: line, h2: h2, h3: h3 });
    });
    RULES = blocks; return blocks;
  }
  function renderRules() {
    var blocks = parseRules(), c = $('sec-rules');
    if (!blocks.length) { card('sec-rules', 'Rules', [el('p', { class: 'hint', text: 'The rules text wasn\'t built into this copy. Rebuild with ref/build/build.py (it reads docs/CROWS_PT2_RULES.md).' })]); return; }
    if (!c.querySelector('#rules-q')) {
      var search = el('input', { type: 'search', id: 'rules-q', class: 'in', placeholder: 'Search the rules (e.g. grab, lantern, backlash, Prosperity)…', 'aria-label': 'Search the rules',
        oninput: function () { ui.rulesQ = this.value; clearTimeout(renderRules._t); renderRules._t = setTimeout(renderRulesBody, 120); } });
      var jump = el('select', { class: 'in', 'aria-label': 'Jump to section', onchange: function () { var t = document.getElementById(this.value); if (t) t.scrollIntoView({ block: 'start' }); this.value = ''; } },
        [el('option', { value: '', text: 'Jump to a section…' })].concat(blocks.filter(function (b) { return b.t === 'h2' || b.t === 'h3'; }).map(function (b) { return el('option', { value: b.id, text: (b.t === 'h3' ? '   ' : '') + b.s.replace(/ L:.*$/, '') }); })));
      card('sec-rules', el('h2', null, ['Rules Reference', el('small', { text: 'Playtest 2 rules summary' })]), [
        el('div', { class: 'rules-tools' }, [el('div', { class: 'row' }, [el('div', { class: 'grow' }, [search]), el('div', { style: 'flex:0 1 260px' }, [jump])]),
          el('div', { class: 'rules-toc' }, blocks.filter(function (b) { return b.t === 'h2'; }).map(function (b) { return el('a', { href: '#' + b.id, text: b.s, onclick: function (e) { e.preventDefault(); document.getElementById(b.id).scrollIntoView({ block: 'start' }); } }); })),
          el('div', { class: 'fine', id: 'rules-count' })]),
        el('div', { class: 'rules-body', id: 'rules-body' })
      ]);
      search.value = ui.rulesQ;
    }
    renderRulesBody();
  }
  function renderRulesBody() {
    var blocks = parseRules(), q = ui.rulesQ.trim().toLowerCase(), body = $('rules-body');
    if (!body) return;
    body.innerHTML = '';
    var re = q ? new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig') : null;
    var hitH2 = {}, hitH3 = {}, hits = 0;
    if (q) blocks.forEach(function (b) { if (b.t === 'p' && b.s.toLowerCase().indexOf(q) >= 0) { hitH2[b.h2] = true; if (b.h3) hitH3[b.h3] = true; hits++; } else if ((b.t === 'h2' || b.t === 'h3') && b.s.toLowerCase().indexOf(q) >= 0) { hitH2[b.h2] = true; if (b.t === 'h3') hitH3[b.id] = 'all'; if (b.t === 'h2') hitH2[b.id] = 'all'; hits++; } });
    function mark(text) {
      if (!re) return document.createTextNode(text);
      var frag = document.createDocumentFragment();
      text.split(re).forEach(function (part, i) { frag.appendChild(i % 2 ? el('mark', { text: part }) : document.createTextNode(part)); });
      return frag;
    }
    var frag = document.createDocumentFragment();
    blocks.forEach(function (b) {
      if (b.t === 'h1') { if (!q) frag.appendChild(el('p', { class: 'fine', text: b.s })); return; }
      var show = !q;
      if (q) {
        if (b.t === 'h2') show = !!hitH2[b.id];
        else if (b.t === 'h3') show = !!hitH3[b.id] || hitH2[b.h2] === 'all';
        else show = b.s.toLowerCase().indexOf(q) >= 0 || hitH2[b.h2] === 'all' || (b.h3 && hitH3[b.h3] === 'all');
      }
      if (!show) return;
      var n = el(b.t === 'p' ? 'p' : b.t, { id: b.t === 'p' ? null : b.id }, [mark(b.s)]);
      frag.appendChild(n);
    });
    body.appendChild(frag);
    $('rules-count').textContent = q ? (hits ? plural(hits, 'match') + ' (whole sections shown when a heading matches)' : 'No matches.') : '';
  }

  A.add({ renderWorld: renderWorld, randomNPC: randomNPC, renderBestiary: renderBestiary, renderMaps: renderMaps, beastCard: beastCard, renderTables: renderTables, lightbox: lightbox,
      parseRules: parseRules, renderRules: renderRules, renderRulesBody: renderRulesBody, RULES: RULES });
})();
