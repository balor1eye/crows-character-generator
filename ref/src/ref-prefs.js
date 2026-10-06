/*
 * Ref Screen: the Preferences tab: Tabletop Mode, and turning individual functions off. The preferences are state.prefs
 * ({ tabletop, off: { feature: true } }), part of the campaign and saved with it; ref-core.js has the feature list and hides
 * what is off. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var btn = f('btn'), card = f('card'), feat = f('feat'), log = f('log'), playerViewPicker = f('playerViewPicker'), render = f('render'), save = f('save'), tabletop = f('tabletop');
  var el = A.el, FEATURES = A.FEATURES, plural = A.plural, toast = A.toast;
  var state = A.state; A.share('state', function (v) { state = v; });

  var GROUPS = ['Tabs', 'Session tab', 'Party tab', 'Sidebar', 'Combat'];
  /* What Tabletop Mode changes, for the card. */
  var TABLETOP_POINTS = [
    'The live fight is off: nothing is shared with the players’ Play pages, and nothing they send arrives. Sheets stay linked, so you see the crows’ vitals live and your changes still go onto their sheets.',
    'Nothing happens on its own: you press Apply on a hit, Damage or Heal, or a condition, and grabs, dropped items, and effects wait for you.',
    'Creatures roll for the table: pick an attack and the result (tier and damage) is shown. A target is optional; with one, its hit waits for you to apply.',
    'The Session tab gets an At the table card: every enemy and ally in one list to hurt, heal, and mark as having acted, with its attacks in view.',
    'Each creature in the tracker lists its attacks with their tier damage and notes, uses, reactions, and traits.',
    'Everything else (the timer, encounters, travel, rests, the log, the dice) works as before, and you can turn any of it off below.'
  ];

  function renderPrefs() {
    var tt = tabletop(), off = Object.keys(state.prefs.off).filter(function (k) { return state.prefs.off[k]; }).length;
    card('sec-prefs-mode', el('h2', null, ['Campaign Preferences', el('small', { text: 'how this campaign is run' })]), [
      el('div', { class: 'pref-mode' + (tt ? ' on' : '') }, [
        el('label', { class: 'check pref-main' }, [el('input', { type: 'checkbox', checked: tt, id: 'pref-tabletop', onchange: function () {
          state.prefs.tabletop = this.checked;
          log('', '**Tabletop Mode ' + (this.checked ? 'on' : 'off') + '.**');
          save(); render(); toast(this.checked ? 'Tabletop Mode is on.' : 'Tabletop Mode is off: crows and players are linked again.');
        } }), el('b', { text: ' Tabletop Mode' })]),
        el('p', { class: 'hint', text: 'A reference and assistant for running the game at a table, in person or on a call, where the players handle their own crows. It keeps track of the enemies and their abilities and leaves most actions to happen live.' }),
        el('ul', { class: 'pref-points' }, TABLETOP_POINTS.map(function (t) { return el('li', { text: t }); }))
      ]),
      el('div', { class: 'pref-mode pref-view' + (tt ? ' off' : '') }, [
        el('div', { class: 'row center' }, [el('b', { text: 'Players’ combat view' }), playerViewPicker()]),
        el('p', { class: 'hint', text: 'How a fight first shows on the players’ Play pages (accounts site). Battle map: while you show a map on the Tabletop, the fight is on it, ' +
          'with every combat function there (targets, attacks and spells, maneuvers, defenses and counters, the turn, items on the ground), so a whole fight can be played on the map, fullscreen too. ' +
          'Text lists: the Combat card lists the enemies and allies with every action as buttons, and the map stays out of the way. Each player can switch for themselves; changing it here makes it everyone’s default again.' +
          (tt ? ' (Tabletop Mode is on, so nothing is shared with the players now.)' : '') })
      ])
    ]);
    card('sec-prefs-feat', el('h2', null, ['Functions', el('small', { text: off ? plural(off, 'function') + ' turned off' : 'everything is on' })]), [
      el('p', { class: 'hint', text: 'Everything is on by default. Untick what you don’t use and it disappears from the screen. Nothing is deleted: your data stays, and ticking a function brings it back.' }),
      off ? btn('Turn everything on', function () { state.prefs.off = {}; save(); render(); }, 'btn-small') : null
    ].concat(GROUPS.map(function (g) {
      var items = FEATURES.filter(function (x) { return x[3] === g; });
      return el('fieldset', { class: 'pref-group' }, [el('legend', { text: g }), el('div', { class: 'pref-list' }, items.map(function (x) {
        var box = el('input', { type: 'checkbox', checked: feat(x[0]), 'data-feature': x[0], onchange: function () {
          if (this.checked) delete state.prefs.off[x[0]]; else state.prefs.off[x[0]] = true;
          save(); render();
        } });
        return el('label', { class: 'pref-item' }, [box, el('span', null, [el('b', { text: x[1] }), el('span', { class: 'fine', text: x[2] })])]);
      }))]);
    })));
  }

  A.add({ renderPrefs: renderPrefs });
})();
