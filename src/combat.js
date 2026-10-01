/*
 * Live combat on the Play page (accounts site only).
 *
 * When the Ref runs a fight in the Ref Screen with this crow in the combat tracker, the Combat card shows it here,
 * live: the round, who acts first, surprise, the enemies (how hurt they look, or their Stamina and AD if the Ref
 * shows them), the allies and crows, and a feed of what happens. The player picks a target, then attacks or casts
 * from Attacks & spells: once the roll is final (after any expertise use or chaos roll) it goes to the Ref Screen
 * with its tier and damage, and the Ref Screen deals the damage to the target. Other actions are sent in words,
 * and "Done for this round" tells the Ref the crow has acted. Attacks against a surprised target get +1.
 *
 * The page watches the change signal for this crow's fights (see "live combat" in server/app/api.php), so the
 * card appears, changes, and goes away within a second or two of the Ref Screen. Nothing here touches the
 * character itself: damage the crow takes still reaches the sheet the usual way, from the Ref Screen.
 */
(function () {
  'use strict';
  if (!window.CrowsApp || !window.CrowsPlay) return;
  var C = window.CrowsApp.core, el = C.el, $ = C.$;
  var Cloud = window.CrowsCloud;
  var fight = null;       // { charId, version, watch, campaign: { id, name }, combat, you: this crow's link id }
  var target = '';        // id of the chosen combatant
  var say = '';           // the "other action" being typed
  var loading = false, off = false;

  function charId() { return Cloud && Cloud.active && !Cloud.linked ? Cloud.recordId : null; }
  /* The fight the open crow is in, or null. */
  function cur() {
    var id = charId();
    return fight && id && fight.charId === id && fight.combat && fight.combat.active ? fight.combat : null;
  }
  function find(id) { var c = cur(); return c && id ? c.list.filter(function (x) { return x.id === id; })[0] || null : null; }
  function me() { var c = cur(); return c && fight.you ? c.list.filter(function (x) { return x.kind === 'pc' && x.link === fight.you; })[0] || null : null; }
  function targetable(x) { return x && !x.dead && x !== me(); }
  /* Keep the target on someone still standing: the first foe up, unless the player chose someone else. */
  function fixTarget() {
    var c = cur();
    if (!c || targetable(find(target))) return;
    var foe = c.list.filter(function (x) { return x.kind === 'foe' && targetable(x) && x.health !== 'down'; })[0] || c.list.filter(function (x) { return x.kind === 'foe' && targetable(x); })[0];
    target = foe ? foe.id : '';
  }

  // ------------------------------------------------------------------ server
  function load() {
    var id = charId();
    if (!id || loading || off) return;
    loading = true;
    var known = fight && fight.charId === id ? fight.version : 0;
    return Cloud.api('GET', 'combat.mine', 'id=' + id + (known ? '&known=' + known : '')).then(function (j) {
      if (charId() !== id) return;
      if (j.unchanged) { fight.version = j.version; return; }
      var was = cur();
      fight = { charId: id, version: j.version, watch: j.watch, campaign: j.campaign, combat: j.combat, you: j.you };
      var now = cur();
      if (now && !was) C.toast('Combat! ' + (fight.campaign ? fight.campaign.name + ': ' : '') + 'your Ref started a fight.', 5000);
      if (was && !now) C.toast('The fight is over.', 4000);
      fixTarget();
      update();
    }, function (e) {
      if (e.status === 404 && /Unknown action/.test(e.message)) off = true;   // a server without live combat
    }).then(function () {
      loading = false;
      if (fight && fight.charId === id && fight.watch) Cloud.watch('combat', fight.watch, fight.version, load);
    });
  }
  function act(a) {
    var c = cur();
    if (!c) { C.toast('Your crow isn’t in a fight.'); return Promise.resolve(false); }
    a.round = c.round;
    return Cloud.api('POST', 'combat.act', '', { id: fight.charId, campaign: fight.campaign.id, action: a }).then(function () { return true; },
      function (e) { C.toast('Not sent to the Ref: ' + e.message, 5000); if (e.status === 409) load(); return false; });
  }

  // ------------------------------------------------------------------ rolls from Attacks & spells
  function isAction(r) { return !!(r && r.opts && (r.opts.kind === 'attack' || r.opts.kind === 'cast')); }
  /* Called by play.js right after an attack or casting is rolled. */
  function rolled(r) {
    if (!cur() || !isAction(r)) return;
    var t = find(target);
    r.fight = { target: t && targetable(t) ? t.id : '', name: t && targetable(t) ? t.name : '', sent: false };
    if (window.CrowsPlay.final(r)) send(r);
  }
  /* The result changed (expertise spent, chaos roll made): send it once it's final. */
  function updated(r) { if (r && r.fight && !r.fight.sent && window.CrowsPlay.final(r)) send(r); }
  /* Another roll is starting: a result still waiting goes as it is. */
  function superseded(r) { if (r && r.fight && !r.fight.sent) send(r); }
  function send(r) {
    var dm = window.CrowsPlay.damageOf(r), notes = [];
    if (dm && dm.parts.length) notes.push(dm.parts.join(', '));
    if (r.crit) notes.push(r.opts.kind === 'attack' ? 'crit: another action' : 'crit');
    r.extra.forEach(function (x) { if (/chaos|backlash|ally/i.test(x)) notes.push(x); });
    r.fight.sent = true;
    act({ type: 'attack', target: r.fight.target, targetName: r.fight.name, label: r.label, tier: r.tier, crit: r.crit, doom: r.doom,
      damage: dm ? dm.n : 0, cast: r.opts.kind === 'cast', text: notes.join('; ') }).then(function (ok) { if (!ok) { r.fight.sent = false; C.render(); } });
  }
  /* For the dice result: where this roll went, or a button to send it now. */
  function rollNote(r) {
    if (!r || !r.fight) return null;
    var who = r.fight.name ? ' (target: ' + r.fight.name + ')' : ' (no target)';
    if (r.fight.sent) return el('div', { class: 'fine cbt-sent', text: '→ Sent to the Ref' + who + '.' });
    return el('div', { class: 'row cbt-wait' }, [el('span', { class: 'fine', text: 'Goes to the Ref' + who + ' once you keep this result.' }),
      el('button', { type: 'button', class: 'btn btn-small', text: 'Send as it is', onclick: function () { send(r); C.render(); } })]);
  }
  /* +1 to attacks against a surprised target (round 1). */
  function attackBonus() {
    var t = find(target);
    return t && t.surprised ? { n: 1, why: '+1 vs surprised ' + t.name } : null;
  }

  // ------------------------------------------------------------------ the Combat card
  function healthChip(x) {
    var cls = x.dead || x.health === 'down' ? 'bad' : x.health === 'badly hurt' ? 'warn' : x.health === 'hurt' || x.health === 'armor dented' ? 'mid' : 'ok';
    return el('span', { class: 'hp-chip ' + cls, text: x.health });
  }
  function rich(text) {
    return el('span', null, String(text).split('**').map(function (part, i) { return i % 2 ? el('b', { text: part }) : document.createTextNode(part); }));
  }
  function row(x) {
    var mine = x === me(), on = x.id === target && targetable(x);
    var nums = typeof x.st === 'number' ? 'Stamina ' + x.st + '/' + x.stMax + (x.adMax ? ' · AD ' + x.ad + '/' + x.adMax : '') + (x.wounds ? ' · ' + x.wounds + ' wound' + (x.wounds === 1 ? '' : 's') : '') : '';
    return el('div', { class: 'cbt-row k-' + x.kind + (x.dead ? ' dead' : '') + (on ? ' on' : '') + (mine ? ' me' : '') }, [
      el('div', { class: 'cbt-who' }, [
        el('b', { text: x.name + (mine ? ' (you)' : '') }),
        el('div', { class: 'fine', text: [x.type, x.size, nums].filter(Boolean).join(' · ') })]),
      el('div', { class: 'cbt-tags' }, [healthChip(x)].concat(
        (x.conds || []).map(function (k) { return el('span', { class: 'chip', text: k }); }),
        x.surprised ? [el('span', { class: 'chip warn', text: 'surprised', title: 'No turn in round 1; attacks against them get +1' })] : [],
        x.kind === 'pc' && x.done ? [el('span', { class: 'chip ok', text: 'done', title: 'Done for this round' })] : [])),
      targetable(x) ? el('button', { type: 'button', class: 'btn btn-small' + (on ? ' btn-primary' : ''), 'aria-pressed': String(on), text: on ? 'Target ✓' : 'Target',
        onclick: function () { target = x.id; update(); } }) : null
    ]);
  }
  function renderView(box) {
    var c = cur(), mine = me(), t = find(target);
    var foes = c.list.filter(function (x) { return x.kind === 'foe'; }), friends = c.list.filter(function (x) { return x.kind !== 'foe'; });
    var up = foes.filter(function (x) { return !x.dead && x.health !== 'down'; }).length;
    var order = !c.round ? 'The fight hasn’t started: the Ref rolls initiative.' : c.first === 'crows' ? 'Crows and allies act first.' : c.first === 'foes' ? 'Enemies act first.' : '';
    var surprise = c.round <= 1 && c.surprise === 'crows' ? 'The crows and their allies are surprised: no turn in round 1.' :
      c.round <= 1 && c.surprise === 'foes' ? 'The foes are surprised: no turn in round 1, and attacks against them get +1.' : '';
    box.appendChild(el('div', { class: 'cbt-head' }, [
      el('div', { class: 'vital' }, [el('div', { class: 'lbl', text: 'Round' }), el('div', { class: 'val' }, [el('b', { text: String(c.round || '—') })])]),
      el('div', { class: 'grow' }, [
        el('div', null, [el('b', { text: c.name || 'A fight' }), fight.campaign ? ' · ' + fight.campaign.name : '']),
        el('div', { class: 'fine', text: [order, surprise].filter(Boolean).join(' ') }),
        el('div', { class: 'fine', text: up + ' of ' + foes.length + ' foe' + (foes.length === 1 ? '' : 's') + ' standing.' + (t ? ' Your target: ' + t.name + '.' : ' No target chosen.') })])]));
    if (mine && mine.surprised) box.appendChild(el('div', { class: 'banner warn', text: 'You’re surprised: you take no turn this round.' }));
    box.appendChild(el('h3', { text: 'Enemies' }));
    box.appendChild(el('div', { class: 'cbt-list' }, foes.length ? foes.map(row) : [el('p', { class: 'fine', text: 'No enemies in the fight yet.' })]));
    if (friends.length) {
      box.appendChild(el('h3', { text: 'Crows and allies' }));
      box.appendChild(el('div', { class: 'cbt-list' }, friends.map(row)));
    }
    var feed = (c.feed || []).slice(-12).reverse();
    if (feed.length) box.appendChild(el('details', { class: 'cbt-feed', open: true }, [el('summary', { text: 'What’s happening' }),
      el('ol', null, feed.map(function (f) { var d = new Date(f.t); return el('li', null, [el('span', { class: 'log-t', text: ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) }), rich(f.s)]); }))]));
  }
  function renderAct(box) {
    var c = cur(), mine = me(), t = find(target), done = !!(mine && mine.done);
    var input = el('input', { type: 'text', class: 'grow', maxlength: 300, value: say, placeholder: 'e.g. I shove it toward the pit / drink a potion / run for the door', 'aria-label': 'Other action',
      oninput: function () { say = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') declare(); } });
    function declare() {
      var text = say.trim();
      if (!text) { input.focus(); return; }
      act({ type: 'declare', text: text, target: t ? t.id : '', targetName: t ? t.name : '' }).then(function (ok) { if (ok) { say = ''; C.toast('Sent to the Ref.'); update(); } });
    }
    box.appendChild(el('p', { class: 'hint', text: 'Choose a target, then attack or cast from Attacks & spells. Once a roll is final it goes to the Ref with its damage.' }));
    box.appendChild(el('div', { class: 'row wrap cbt-say' }, [input,
      el('button', { type: 'button', class: 'btn', text: t ? 'Send (at ' + t.name + ')' : 'Send', onclick: declare })]));
    box.appendChild(el('div', { class: 'row wrap' }, [
      el('button', { type: 'button', class: 'btn' + (done ? '' : ' btn-primary'), disabled: !c.round || !mine || null, 'aria-pressed': String(done),
        text: done ? 'Done for round ' + c.round + ' ✓ (undo)' : 'Done for this round',
        title: c.round ? 'Tell the Ref your crow has acted this round' : 'The fight hasn’t started',
        onclick: function () { act({ type: done ? 'undone' : 'done' }); } })]));
  }
  /* Show the fight: the whole card, or just its view while the player is typing an action. */
  function update() {
    var box = $('play-combat');
    if (!box) return;
    var c = document.body.getAttribute('data-mode') === 'play' ? cur() : null;
    box.hidden = !c;
    if (!c) { box.innerHTML = ''; return; }
    var typing = document.activeElement && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    var view = $('cbt-view'), acts = $('cbt-act');
    if (!view || !acts) {
      box.innerHTML = '';
      box.appendChild(el('h2', { text: 'Combat' }));
      view = el('div', { id: 'cbt-view' }); acts = el('div', { id: 'cbt-act' });
      box.appendChild(view); box.appendChild(acts);
      typing = false;
    }
    view.innerHTML = ''; renderView(view);
    if (!typing) { acts.innerHTML = ''; renderAct(acts); }
    var bar = $('cbt-target-bar');
    if (bar) bar.replaceWith(targetBar());
  }
  /* At the top of Attacks & spells: who the next attack or spell goes at. */
  function targetBar() {
    var c = cur();
    if (!c) return el('span', { id: 'cbt-target-bar', hidden: true });
    var opts = c.list.filter(targetable);
    var s = el('select', { 'aria-label': 'Target', onchange: function () { target = this.value; update(); } },
      [el('option', { value: '', text: 'No target' })].concat(opts.map(function (x) { return el('option', { value: x.id, text: x.name + (x.kind === 'foe' ? '' : x.kind === 'pc' ? ' (crow)' : ' (ally)') + ' · ' + x.health }); })));
    s.value = targetable(find(target)) ? target : '';
    var b = attackBonus();
    return el('div', { id: 'cbt-target-bar', class: 'row wrap cbt-target' }, [el('label', { class: 'field' }, ['In combat: target', s]),
      el('span', { class: 'fine grow', text: 'Attacks and spells go to the Ref with this target.' + (b ? ' ' + b.why + '.' : '') })]);
  }

  window.CrowsCombat = { load: load, render: update, rolled: rolled, updated: updated, superseded: superseded, rollNote: rollNote,
    attackBonus: function () { return cur() ? attackBonus() : null; }, targetBar: targetBar };
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  // A crow that gets its record id later (a new one saved with Save character) starts being watched then.
  setInterval(function () { var id = charId(); if (id && (!fight || fight.charId !== id)) load(); }, 2000);
})();
