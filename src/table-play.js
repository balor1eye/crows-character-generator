/*
 * The Table tab on the Play page (accounts site): the tabletop scene the Ref is showing, with the fog of war as the Ref's screen works it out.
 * The scene arrives with the live fight (combat.js keeps it: tableData). The player drags their own crow's token (it goes to the Ref
 * as a move, which the Ref's screen checks against walls), measures, pings, and picks a target by clicking a creature (the same target as
 * the Combat card). The map shows only what the party can see; the engine is src/shared/table.js.
 */
(function () {
  'use strict';
  if (!window.CrowsApp || !window.CrowsCombat || !window.CrowsTable) return;
  var C = window.CrowsApp.core, el = C.el, $ = C.$, Combat = window.CrowsCombat, Tbl = window.CrowsTable;
  var P = { view: null, host: null, ui: null, L: null, hudFor: null, scene: null, mask: null, maskKey: '', data: null, sel: null, version: 0, seenPing: -1, sceneId: null, live: false, you: null, campaign: 0 };

  function scene() { return P.scene; }
  function mine(t) { return !!(t && t.link && P.you && t.link === P.you); }
  function mapSrc(sc) {
    var m = sc && sc.map; if (!m) return null;
    return m.b ? m.b : 'api.php?a=table.map&campaign=' + P.campaign + '&key=' + encodeURIComponent(m.k);
  }
  /* The map, with its controls floating on it (as on the Ref's Tabletop): tools down the left, the scene and the fight top left, zoom
     bottom right, and a card with the clicked creature's state and a Target button. */
  function build() {
    P.host = el('div', { class: 'vtt-host' });
    P.view = Tbl.view(P.host, {
      ref: false,
      scene: scene,
      mask: function () { return P.mask; },
      mapSrc: mapSrc,
      tokenSrc: function (t) { return t.art && P.scene && P.scene.art ? P.scene.art[t.art] || null : null; },
      canMove: function (t) { return mine(t) && P.scene && P.scene.move; },
      speedOf: function (t) { return mine(t) ? t.speed || 0 : 0; },
      onSelect: function (t) { P.sel = t ? t.id : null; renderInfo(); },
      onMove: function (t, x, y) { Combat.sendTable({ type: 'move', token: t.id, x: Math.round(x), y: Math.round(y) }); },
      onPing: function (x, y) { Combat.sendTable({ type: 'ping', x: Math.round(x), y: Math.round(y) }); },
      onKey: function (e) { if (e.ctrlKey || e.metaKey || e.altKey) return; var k = { v: 'select', m: 'measure', p: 'ping' }[e.key.toLowerCase()]; if (k) pickTool(k); },
      onFrame: placeHud,
      tooltip: tipLines
    });
    P.view.player(true);
    P.ui = el('div', { class: 'vtt-ui' }); P.L = {};
    ['tl', 'tools', 'zoom', 'hud', 'ask', 'tip'].forEach(function (k) { P.L[k] = el('div', { class: 'vtt-' + k }); P.ui.appendChild(P.L[k]); });
    P.host.appendChild(P.ui);
    P.ui.classList.add('enter'); setTimeout(function () { if (P.ui) P.ui.classList.remove('enter'); }, 600);
    var box = $('play-table');
    box.innerHTML = '';
    box.appendChild(el('h2', { text: 'Table' }));
    box.appendChild(P.host);
    if (!P.fsBound) { P.fsBound = true; document.addEventListener('fullscreenchange', function () { if (P.host) renderBar(); }); }
    renderBar();
  }
  function fab(name, label, onclick, cls, text) {
    return el('button', { type: 'button', class: 'fab' + (cls ? ' ' + cls : ''), title: label, 'aria-label': text ? null : label, onclick: onclick },
      [el('span', { class: 'ico-wrap', html: Tbl.icon(name) }), text ? el('span', { class: 'fab-t', text: text }) : null]);
  }
  var TOOLS = [['select', 'Move', 'Drag your crow’s token to move it; click a creature to target it; drag the board to pan.', 'v'], ['measure', 'Measure', 'Drag to measure squares.', 'm'],
    ['ping', 'Ping', 'Click to point something out to everyone (Alt-click works too).', 'p']];
  function pickTool(t) {
    P.view.tool(t); renderBar();
    var d = TOOLS.filter(function (x) { return x[0] === t; })[0];
    P.L.tip.innerHTML = ''; if (d) P.L.tip.appendChild(el('div', { class: 'vtt-tipbox', text: d[1] + ': ' + d[2] }));
  }
  function renderBar() {
    if (!P.L) return;
    var now = P.view.getTool();
    P.L.tools.innerHTML = '';
    P.L.tools.appendChild(el('div', { class: 'glass palette', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }, TOOLS.map(function (t) {
      var b = fab(t[0], t[1] + ' (' + t[3].toUpperCase() + '): ' + t[2], function () { pickTool(t[0]); }, 'tool' + (now === t[0] ? ' on' : ''));
      b.setAttribute('aria-pressed', String(now === t[0])); b.setAttribute('data-tip', t[1]); return b;
    })));
    var me = P.scene && P.scene.tokens.filter(mine)[0], fs = !!document.fullscreenElement;
    P.L.zoom.innerHTML = '';
    P.L.zoom.appendChild(el('div', { class: 'glass palette' }, [
      me ? fab('mine', 'Find my crow', function () { P.view.centerOn(me.x, me.y, true); }) : null, me ? el('span', { class: 'sep' }) : null,
      fab('plus', 'Zoom in (+)', function () { P.view.zoom(1.25); }), fab('minus', 'Zoom out (−)', function () { P.view.zoom(.8); }), fab('fit', 'Fit the map (0)', function () { P.view.fit(true); }),
      el('span', { class: 'sep' }),
      fab('full', fs ? 'Leave fullscreen' : 'Fullscreen', function () { if (document.fullscreenElement) document.exitFullscreen(); else if (P.host.requestFullscreen) P.host.requestFullscreen(); }, fs ? 'on' : '')]));
  }
  /* The fight's entry for a token (crows' and allies' Stamina and AD are shared with every player; foes' only when the Ref shows them). */
  function entry(t) { var c = P.data && P.data.combat; return t && t.cid && c ? (c.list || []).filter(function (x) { return x.id === t.cid; })[0] || null : null; }
  function vitText(x) { return 'Stamina ' + x.st + '/' + x.stMax + (x.adMax ? ' · AD ' + x.ad + '/' + x.adMax : '') + (x.wounds ? ' · ' + x.wounds + (x.wounds === 1 ? ' wound' : ' wounds') : ''); }
  function tipLines(t) {
    var x = entry(t), k = t.cid && Combat.known ? Combat.known(t.cid) : null, out = [mine(t) ? 'You' : { pc: 'Crow', foe: 'Foe', ally: 'Ally', npc: 'Person', obj: 'Marker' }[t.kind] || ''];
    if (t.dead) out.push('dead');
    else if (x && typeof x.st === 'number') out.push(vitText(x));
    else if (k) out.push('Stamina ' + k.st + '/' + k.stMax + ' (Monster Expert)');
    else if (t.hw) out.push('Looks ' + t.hw);
    if (k && !t.dead) out.push('Power ' + k.p, 'Attacks: ' + (k.atk.join(', ') || 'none'), 'Traits: ' + (k.traits.join(', ') || 'none'));
    return out;
  }
  function chip(text, cls, title) { return el('span', { class: 'hud-chip' + (cls ? ' ' + cls : ''), text: text, title: title || null }); }
  function renderInfo() {
    if (!P.L) return;
    var sc = P.scene, d = P.data; P.L.tl.innerHTML = ''; P.L.hud.innerHTML = '';
    if (!sc) return;
    var kids = [chip(sc.name, 'accent')];
    if (d && d.combat && d.combat.round) kids.push(chip('Round ' + d.combat.round + (d.combat.first ? ' · ' + (d.combat.first === 'crows' ? 'crows first' : 'enemies first') : ''), 'round'));
    if (sc.moved != null) kids.push(chip(sc.moved + ' hexes today'));
    if (!sc.move) kids.push(chip('The Ref moves the tokens', 'warn', 'Your Ref has turned off moving your own token'));
    P.L.tl.appendChild(el('div', { class: 'hud-grp' }, kids));
    var t = P.sel && sc.tokens.filter(function (k) { return k.id === P.sel; })[0];
    if (!t) { P.hudFor = null; P.L.hud.className = 'vtt-hud'; return; }
    var enter = P.hudFor !== t.id; P.hudFor = t.id; P.L.hud.className = 'vtt-hud' + (enter ? ' enter' : '');
    var x = entry(t), kn = t.cid && Combat.known ? Combat.known(t.cid) : null, hp = t.hpf == null ? '' : x && typeof x.st === 'number' ? x.st + '/' + x.stMax : kn ? kn.st + '/' + kn.stMax : t.hpf >= 1 ? 'unhurt' : t.hpf > .6 ? 'scratched' : t.hpf > .3 ? 'hurt' : t.hpf > 0 ? 'badly hurt' : 'down';
    var tg = d && d.combat && t.cid && Combat.setTarget && !mine(t) ? el('button', { type: 'button', class: 'btn btn-small btn-primary hud-target', title: 'Aim your next attack or spell at ' + t.name,
      onclick: function () { if (Combat.setTarget(t.cid)) C.toast('Targeting ' + t.name + '.'); else C.toast(t.name + ' isn’t in the fight.'); } }, [el('span', { class: 'ico-wrap', html: Tbl.icon('target') }), ' Target']) : null;
    var card = [el('div', { class: 'hc-name' }, [el('b', { text: t.name }), mine(t) ? el('span', { class: 'hc-kind', text: 'You' }) : null, t.dead ? chip('dead') : null])];
    if (t.hpf != null && !t.dead) card.push(el('div', { class: 'vbar st' }, [el('span', { class: 'vl', text: 'St' }), el('span', { class: 'vt' }, [el('span', { style: 'width:' + Math.round(Math.max(0, Math.min(1, t.hpf)) * 100) + '%' })]), el('span', { class: 'vn', text: hp })]));
    if (t.adf != null && !t.dead) card.push(el('div', { class: 'vbar ad' }, [el('span', { class: 'vl', text: 'AD' }), el('span', { class: 'vt' }, [el('span', { style: 'width:' + Math.round(Math.max(0, Math.min(1, t.adf)) * 100) + '%' })]), el('span', { class: 'vn', text: x && x.adMax ? x.ad + '/' + x.adMax : '' })]));
    else if (t.hw && !t.dead) card.push(el('div', { class: 'hc-row' }, [chip('looks ' + t.hw, t.hw === 'unhurt' ? '' : 'warn')]));
    if (kn && !t.dead) card.push(el('div', { class: 'hc-row fine', title: 'Monster Expert: you wield a monster lore book and it is in your line of effect', text: '📖 Power ' + kn.p + ' · ' + (kn.atk.join(', ') || 'no attacks') + (kn.traits.length ? ' · ' + kn.traits.join(', ') : '') }));
    if ((t.conds || []).length) card.push(el('div', { class: 'hc-row' }, t.conds.map(function (c) { return chip(c, 'cond'); })));
    if (tg) card.push(tg);
    P.L.hud.appendChild(el('div', { class: 'hud-card' }, card));
    placeHud();
  }
  /*
   * The pop-up for what waits on this player: a counter they may make, a hit they may defend against (the Combat card's own controls).
   * When it's settled (the Ref applied the hit, or the counter went through) the pop-up shows what happened, until they close it.
   */
  function vitals(m) { return m ? { st: m.st, ad: m.ad, wounds: m.wounds || 0, conds: (m.conds || []).slice() } : null; }
  function vitalsDiff(a, b) {
    if (!a || !b) return [];
    var out = [];
    if (a.ad !== b.ad && typeof b.ad === 'number') out.push('AD ' + a.ad + '→' + b.ad);
    if (a.st !== b.st && typeof b.st === 'number') out.push('Stamina ' + a.st + '→' + b.st);
    if (b.wounds > a.wounds) out.push('+' + (b.wounds - a.wounds) + (b.wounds - a.wounds === 1 ? ' wound' : ' wounds'));
    b.conds.forEach(function (k) { if (a.conds.indexOf(k) < 0) out.push('now ' + k.toLowerCase()); });
    return out;
  }
  function feedSince(feed, t, name) {
    return feed.filter(function (f) { return f.t >= t - 1500 && (!name || f.s.indexOf(name) >= 0); }).slice(-4).map(function (f) { return f.s; });
  }
  function rich(text) { return el('span', null, String(text).split('**').map(function (part, i) { return i % 2 ? el('b', { text: part }) : document.createTextNode(part); })); }
  function renderAsk() {
    var box = P.L && P.L.ask; if (!box) return;
    var A = Combat.approvals ? Combat.approvals() : null, K = P.ask || (P.ask = { hits: {}, prompts: {}, results: [], min: false }), now = Date.now();
    if (!A) { if (box.firstChild) box.innerHTML = ''; P.askSig = ''; return; }
    var my = A.me ? A.me.name : '';
    A.hits.forEach(function (x) { if (!K.hits[x.h.id]) K.hits[x.h.id] = { what: '**' + x.h.who + '**' + (x.h.label ? '’s ' + x.h.label : '’s attack'), before: vitals(A.me), t: now }; });
    A.prompts.forEach(function (p) { if (!K.prompts[p.id]) K.prompts[p.id] = { from: p.fromName, t: now }; });
    Object.keys(K.hits).forEach(function (id) {
      if (A.hits.some(function (x) { return x.h.id === id; }) || K.hits[id].gone) return;
      K.hits[id].gone = true; K.min = false;
      K.results.push({ title: K.hits[id].what + ' on you', before: K.hits[id].before, t: K.hits[id].t, name: my });
    });
    Object.keys(K.prompts).forEach(function (id) {
      if (A.prompts.some(function (p) { return p.id === id; }) || K.prompts[id].gone) return;
      K.prompts[id].gone = true;
      if (A.countered[id]) K.results.push({ title: 'Your counter on **' + K.prompts[id].from + '**', t: A.countered[id], name: K.prompts[id].from });
    });
    var res = K.results.map(function (r) { return { r: r, diff: r.before ? vitalsDiff(r.before, vitals(A.me)) : [], feed: feedSince(A.feed, r.t, r.name) }; });
    var sig = JSON.stringify([A.hits.map(function (x) { return [x.h.id, x.h.defended]; }), A.prompts.map(function (p) { return [p.id, !!A.countered[p.id]]; }), res.map(function (x) { return [x.diff, x.feed]; }), K.min]);
    if (sig === P.askSig) return;
    var typing = document.activeElement && box.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing && A.hits.length) return;   // keep what they're typing; it redraws once they're done
    P.askSig = sig; box.innerHTML = '';
    box.style.top = Math.max(56, P.L.tl.offsetTop + P.L.tl.offsetHeight + 10) + 'px';   // under the round
    var n = A.hits.length + A.prompts.length;
    if (n && K.min) { box.appendChild(el('button', { type: 'button', class: 'glass ask-pill', onclick: function () { K.min = false; P.askSig = ''; renderAsk(); } }, [el('span', { class: 'ico-wrap', html: Tbl.icon('hourglass') }), ' ' + n + (n === 1 ? ' thing needs' : ' things need') + ' your answer'])); return; }
    if (n) {
      box.appendChild(el('div', { class: 'glass ask-card', role: 'alertdialog', 'aria-label': 'Your answer is needed' }, [
        el('div', { class: 'ask-head' }, [el('b', { text: 'Your answer is needed' }), el('span', { class: 'grow' }),
          fab('mine', 'Show my crow', function () { var me = P.scene && P.scene.tokens.filter(mine)[0]; if (me) P.view.centerOn(me.x, me.y, true); }, 'sm ghost'),
          fab('minus', 'Later: shrink this to a reminder', function () { K.min = true; P.askSig = ''; renderAsk(); }, 'sm ghost')])]
        .concat(A.prompts.map(function (p) { return Combat.promptBanner(p); }), A.hits.map(function (x) { return Combat.hitBanner(x); }))));
      return;
    }
    if (res.length) {
      box.appendChild(el('div', { class: 'glass ask-card done', role: 'status' }, [
        el('div', { class: 'ask-head' }, [el('b', { text: 'What happened' }), el('span', { class: 'grow' }), fab('x', 'Close', function () { K.results = []; P.askSig = ''; renderAsk(); }, 'sm ghost')])]
        .concat(res.slice(-3).map(function (x) {
          var lines = x.diff.length ? [(x.r.before ? 'You: ' : '') + x.diff.join(', ')] : x.r.before ? ['No damage reached you (avoided or negated), or the Ref hasn’t dealt it.'] : [];
          return el('div', { class: 'ask-what' }, [rich(x.r.title), el('ul', { class: 'ask-res' }, lines.map(function (l) { return el('li', { text: l }); }).concat(x.feed.map(function (l) { return el('li', null, [rich(l)]); })))]);
        }), [el('div', { class: 'ask-ctl' }, [el('button', { type: 'button', class: 'btn btn-small btn-primary', text: 'OK', onclick: function () { K.results = []; P.askSig = ''; renderAsk(); } })])])));
    }
  }
  /* Keep the card on its token as the map pans, zooms, and the token glides. */
  function placeHud() {
    var box = P.L && P.L.hud; if (!box || !P.hudFor) return;
    var s = P.view.screenOf(P.hudFor), W = P.host.clientWidth, H = P.host.clientHeight;
    box.classList.toggle('away', !s || s.x < -s.r || s.y < -s.r || s.x > W + s.r || s.y > H + s.r || P.view.held());
    if (!s) return;
    box.style.transform = 'translate(' + Math.round(s.x) + 'px,' + Math.round(s.y) + 'px)';
    box.style.setProperty('--r', Math.round(Math.max(14, s.r)) + 'px');
    box.classList.toggle('below', s.y - s.r < 150);
  }
  /* Called by combat.js whenever the fight's data changed (and by render). */
  function refresh() {
    var d = Combat.tableData(), was = P.live;
    P.data = d; P.live = !!d;
    if (!d) {
      P.scene = null; P.mask = null; P.you = null;
      if (was) { var box = $('play-table'); if (box) { box.innerHTML = ''; P.view = null; P.host = null; P.L = null; } C.render(); }
      else if ($('play-table') && !$('play-table').firstChild) emptyNote();
      return;
    }
    if (!was) { emptyNote(false); C.render(); }
    if (d.version === P.version && P.view && P.scene) { renderAsk(); return; }
    P.version = d.version; P.you = d.you; P.campaign = d.campaign ? d.campaign.id : 0;
    var t = d.table, fog = t.fog;
    if (!P.view || !P.host || !$('play-table').contains(P.host)) { P.view = null; build(); }
    P.scene = { id: t.id, name: t.name, kind: t.kind, w: t.w, h: t.h, g: t.g, grid: t.grid, ox: t.ox || 0, oy: t.oy || 0, bg: t.bg, showGrid: t.showGrid, unit: t.unit, map: t.map,
      tokens: t.tokens.map(function (k) {
        var o = Object.assign({}, k), kn = k.cid && Combat.known ? Combat.known(k.cid) : null; o.mine = mine(k); o.size = k.size;
        if (kn && o.hpf == null && kn.stMax) { o.hpf = Math.max(0, Math.min(1, kn.st / kn.stMax)); delete o.hw; }   // Monster Expert: its Stamina
        return o;
      }), pins: t.pins || [], walls: [], move: t.move, moved: t.moved, art: t.art || {} };
    var key = fog ? fog.cw + 'x' + fog.ch + ':' + fog.d : '';
    if (key !== P.maskKey) { P.maskKey = key; P.mask = Tbl.unpackMask(fog); }
    // Pings made since this page last looked (the first look only notes where they are).
    (t.pings || []).forEach(function (p) { if (P.seenPing >= 0 && p.id > P.seenPing) P.view.ping(p.x, p.y, '#ffd25a'); });
    var top = (t.pings || []).reduce(function (m, p) { return Math.max(m, p.id); }, 0);
    P.seenPing = P.sceneId === t.id ? Math.max(P.seenPing, top) : top;
    var changedScene = P.sceneId !== t.id; P.sceneId = t.id;
    P.view.sceneChanged(changedScene ? t.id : t.id);
    P.view.settle();
    if (changedScene) { var mt = P.scene.tokens.filter(mine)[0]; if (mt) setTimeout(function () { P.view.centerOn(mt.x, mt.y, true); }, 60); }
    renderBar(); renderInfo(); renderAsk();
  }
  function emptyNote(on) {
    var box = $('play-table'); if (!box) return;
    if (on === false) { if (!P.host) box.innerHTML = ''; return; }
    box.innerHTML = '';
    box.appendChild(el('h2', { text: 'Table' }));
    box.appendChild(el('p', { class: 'hint', text: 'Your Ref isn’t showing a map right now. When they do, it appears here, with fog of war: you see what your crow and its light show. You need to be playing a linked crow in a campaign on the accounts site.' }));
  }

  window.CrowsVTTPlay = { refresh: refresh, live: function () { return P.live; } };
  refresh();
})();
