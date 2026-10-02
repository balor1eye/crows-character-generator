/*
 * Ref Screen: saving and loading campaign files, and start-up. Loaded last. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addFromLink = f('addFromLink'), endDT = f('endDT'), freshState = f('freshState'), importCharacter = f('importCharacter'),
      isCampaign = f('isCampaign'), linkToken = f('linkToken'), liveChanged = f('liveChanged'), load = f('load'), loadInvites = f('loadInvites'),
      log = f('log'), pauseTimer = f('pauseTimer'), refreshLinked = f('refreshLinked'), render = f('render'), repairObjects = f('repairObjects'),
      rollTravelEncounter = f('rollTravelEncounter'), S = f('S'), save = f('save'), setTab = f('setTab'), sheetOf = f('sheetOf'), startNew = f('startNew'),
      startTimer = f('startTimer'), test = f('test'), tick = f('tick'), withDefaults = f('withDefaults');
  var $ = A.$, clone = A.clone, el = A.el, TAB_KEY = A.TAB_KEY, TABS = A.TABS, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ files
  function download(text, name, type) {
    var blob = new Blob([text], { type: type }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileBase() { return (state.name || state.village.name || 'Crows').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Crows'; }

  // ------------------------------------------------------------------ init
  function init() {
    A.set('state', load() || freshState());
    try { A.set('tab', localStorage.getItem(TAB_KEY) || 'session'); } catch (e) { A.set('tab', 'session'); }
    if (!TABS.some(function (t) { return t[0] === tab; })) A.set('tab', 'session');
    document.body.setAttribute('data-tab', tab);
    // Rearrangeable pages (src/layout.js): each tab is a page of its cards plus the sidebar (timer, dice, log).
    if (window.CrowsLayout) {
      var pages = {};
      TABS.forEach(function (t) {
        var ids = Array.prototype.map.call(document.querySelectorAll('#page-' + t[0] + ' > section'), function (n) { return n.id; });
        pages['ref-' + t[0]] = { blocks: ids.concat('side'), cols: [ids, ['side']], colClass: 'page' };
      });
      window.CrowsLayout.init({ pages: pages, containers: ['main.layout > .pages'], current: function () { return 'ref-' + tab; },
        narrow: 'clamp(320px, 22vw, 420px)', breakpoint: 1080, nav: document.querySelector('.masthead .actions'),
        titles: { side: 'Timer, dice & log', 'sec-enc-run': 'Running encounter' } });
    }

    var dl = el('datalist', { id: 'bg-list' }, REF.BACKGROUNDS.map(function (b) { return el('option', { value: b[0] }); }));
    document.body.appendChild(dl);

    $('btn-save').addEventListener('click', function () { download(JSON.stringify(state, null, 1), fileBase() + '_Crows_Campaign.json', 'application/json'); toast('Campaign saved to a file.'); });
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Start a new campaign? Save the current one to a file first if you want to keep it.')) return;
      startNew(); A.set('state', freshState()); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render();
    });
    $('file-load').addEventListener('change', function () {
      var f = this.files && this.files[0], input = this;
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (s && s.v === 1 && typeof s.bg === 'number') throw new Error('that is a character file: import it in the Party tab');
          if (!s || s.v !== 1 || !s.session) throw new Error('not a Crows campaign file');
          startNew(); A.set('state', withDefaults(freshState(), s)); ui.lastEnc = null; ui.dice = null; save(); render(); toast('Loaded ' + (state.name || state.village.name || 'campaign') + '.');
        } catch (e) { toast('Could not load that file: ' + e.message); }
        input.value = '';
      };
      rd.readAsText(f);
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === ' ' && tab === 'session' && S().mode === 'timer' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (S().running) pauseTimer(); else startTimer(); }
    });
    render();
    setInterval(tick, 250);
    if (window.CrowsCloud) window.CrowsCloud.attach({
      kind: 'campaigns',
      getData: function () { return state; },
      valid: isCampaign,
      apply: function (data) { A.set('state', repairObjects(withDefaults(freshState(), clone(data)))); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render(); },
      fresh: function () { A.set('state', freshState()); ui.lastEnc = null; ui.dice = null; ui.tables = {}; save(); render(); },
      name: function (c) { return c.name || (c.village && c.village.name) || 'Untitled campaign'; },
      onReady: function () {
        loadInvites();   // join requests (and the badge) show whichever tab is open
        liveChanged();   // share the fight in the tracker (if any) with the players
        // Refresh crows tied to players' sheets, then add one passed from the home page (#addlink=<token>).
        state.party.filter(function (p) { return p.link; }).forEach(function (p) { refreshLinked(p, true); });
        var tok = linkToken((/addlink=([0-9a-f]{64})/.exec(location.hash) || [])[1]);
        if (tok) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
          addFromLink(tok).then(function () { setTab('party'); });
        }
      },
      summary: function (c) {
        var crows = (c.party || []).length;
        return ['Session ' + ((c.session && c.session.n) || 1), crows ? crows + (crows === 1 ? ' crow' : ' crows') : '',
          c.village && c.village.name ? c.village.name : ''].filter(Boolean).join(' · ');
      }
    });
  }

  window.CrowsRef = { get state() { return state; },
    /* A linked crow's character as this screen has it (with the Ref's unsaved changes), for tests. */
    sheet: function (linkId) { var p = state.party.filter(function (x) { return x.link === linkId; })[0]; return p ? sheetOf(p) : null; },
    rollTravelEncounter: rollTravelEncounter, endDT: endDT, test: test, importCharacter: function (s) { var r = importCharacter(s); save(); render(); return r; } };

  A.add({ download: download, fileBase: fileBase, init: init });

  init();
})();
