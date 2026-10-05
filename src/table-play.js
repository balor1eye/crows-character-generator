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
  var P = { view: null, host: null, bar: null, info: null, scene: null, mask: null, maskKey: '', data: null, sel: null, version: 0, seenPing: -1, sceneId: null, live: false, you: null, campaign: 0 };

  function scene() { return P.scene; }
  function mine(t) { return !!(t && t.link && P.you && t.link === P.you); }
  function mapSrc(sc) {
    var m = sc && sc.map; if (!m) return null;
    return m.b ? m.b : 'api.php?a=table.map&campaign=' + P.campaign + '&key=' + encodeURIComponent(m.k);
  }
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
      onPing: function (x, y) { Combat.sendTable({ type: 'ping', x: Math.round(x), y: Math.round(y) }); }
    });
    P.view.player(true);
    P.bar = el('div', { class: 'row center vtt-tools' });
    P.info = el('div', { class: 'vtt-info' });
    var box = $('play-table');
    box.innerHTML = '';
    box.appendChild(el('h2', { text: 'Table' }));
    box.appendChild(P.bar); box.appendChild(P.host); box.appendChild(P.info);
    renderBar();
  }
  function renderBar() {
    if (!P.bar) return;
    P.bar.innerHTML = '';
    var tools = [['select', 'Move', 'Drag your crow’s token to move it; click a creature to target it; drag the board to pan.'], ['measure', 'Measure', 'Drag to measure squares.'], ['ping', 'Ping', 'Click to point something out to everyone (Alt-click works too).']];
    P.bar.appendChild(el('div', { class: 'seg', role: 'group', 'aria-label': 'Tools' }, tools.map(function (t) {
      var on = P.view.getTool() === t[0];
      return el('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), title: t[2], text: t[1], onclick: function () { P.view.tool(t[0]); renderBar(); } });
    })));
    P.bar.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Fit', onclick: function () { P.view.fit(); } }));
    P.bar.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: '+', onclick: function () { P.view.zoom(1.25); } }));
    P.bar.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: '−', onclick: function () { P.view.zoom(.8); } }));
    var me = P.scene && P.scene.tokens.filter(mine)[0];
    if (me) P.bar.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'My crow', onclick: function () { P.view.centerOn(me.x, me.y); } }));
    P.bar.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Fullscreen', onclick: function () { if (document.fullscreenElement) document.exitFullscreen(); else if (P.host.requestFullscreen) P.host.requestFullscreen(); } }));
  }
  function renderInfo() {
    if (!P.info) return;
    var sc = P.scene, d = P.data; P.info.innerHTML = '';
    if (!sc) return;
    var kids = [el('span', { class: 'chip accent', text: sc.name })];
    if (d && d.combat && d.combat.round) kids.push(el('span', { class: 'chip', text: 'Round ' + d.combat.round + (d.combat.first ? ' · ' + (d.combat.first === 'crows' ? 'crows first' : 'enemies first') : '') }));
    if (sc.moved != null) kids.push(el('span', { class: 'chip', text: sc.moved + ' hexes moved today' }));
    if (!sc.move) kids.push(el('span', { class: 'chip warn', text: 'The Ref moves the tokens' }));
    P.info.appendChild(el('div', { class: 'row center' }, kids));
    var t = P.sel && sc.tokens.filter(function (k) { return k.id === P.sel; })[0];
    if (t) {
      var hp = t.hpf == null ? '' : t.hpf >= 1 ? 'unhurt' : t.hpf > .6 ? 'scratched' : t.hpf > .3 ? 'hurt' : t.hpf > 0 ? 'badly hurt' : 'down';
      var tg = d && d.combat && t.cid && Combat.setTarget ? el('button', { type: 'button', class: 'btn btn-small', text: 'Target', title: 'Aim your next attack or spell at ' + t.name,
        onclick: function () { if (Combat.setTarget(t.cid)) C.toast('Targeting ' + t.name + '.'); else C.toast(t.name + ' isn’t in the fight.'); } }) : null;
      P.info.appendChild(el('div', { class: 'row center vtt-sel' }, [el('b', { text: t.name }), hp ? el('span', { class: 'fine', text: hp }) : null,
        (t.conds || []).length ? el('span', { class: 'fine', text: t.conds.join(', ') }) : null, t.dead ? el('span', { class: 'chip', text: 'dead' }) : null, tg]));
    }
    P.info.appendChild(el('p', { class: 'fine', text: 'You see what your crows and their lights show; the Ref’s fog hides the rest. ' + (sc.move ? 'Drag your crow to move; walls stop you. ' : '') + 'Scroll or pinch to zoom.' }));
  }
  /* Called by combat.js whenever the fight's data changed (and by render). */
  function refresh() {
    var d = Combat.tableData(), was = P.live;
    P.data = d; P.live = !!d;
    if (!d) {
      P.scene = null; P.mask = null; P.you = null;
      if (was) { var box = $('play-table'); if (box) { box.innerHTML = ''; P.view = null; P.host = null; } C.render(); }
      else if ($('play-table') && !$('play-table').firstChild) emptyNote();
      return;
    }
    if (!was) { emptyNote(false); C.render(); }
    if (d.version === P.version && P.view && P.scene) return;
    P.version = d.version; P.you = d.you; P.campaign = d.campaign ? d.campaign.id : 0;
    var t = d.table, fog = t.fog;
    if (!P.view || !P.host || !$('play-table').contains(P.host)) { P.view = null; build(); }
    P.scene = { id: t.id, name: t.name, kind: t.kind, w: t.w, h: t.h, g: t.g, grid: t.grid, ox: t.ox || 0, oy: t.oy || 0, bg: t.bg, showGrid: t.showGrid, unit: t.unit, map: t.map,
      tokens: t.tokens.map(function (k) { var o = Object.assign({}, k); o.mine = mine(k); o.size = k.size; return o; }), pins: t.pins || [], walls: [], move: t.move, moved: t.moved, art: t.art || {} };
    var key = fog ? fog.cw + 'x' + fog.ch + ':' + fog.d : '';
    if (key !== P.maskKey) { P.maskKey = key; P.mask = Tbl.unpackMask(fog); }
    // Pings made since this page last looked (the first look only notes where they are).
    (t.pings || []).forEach(function (p) { if (P.seenPing >= 0 && p.id > P.seenPing) P.view.ping(p.x, p.y, '#ffd25a'); });
    var top = (t.pings || []).reduce(function (m, p) { return Math.max(m, p.id); }, 0);
    P.seenPing = P.sceneId === t.id ? Math.max(P.seenPing, top) : top;
    var changedScene = P.sceneId !== t.id; P.sceneId = t.id;
    P.view.sceneChanged(changedScene ? t.id : t.id);
    P.view.settle();
    if (changedScene) { var mt = P.scene.tokens.filter(mine)[0]; if (mt) setTimeout(function () { P.view.centerOn(mt.x, mt.y); }, 60); }
    renderBar(); renderInfo();
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
