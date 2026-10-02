/*
 * Ref Screen: the party: crows imported from files or linked to players’ sheets (sheetOp sends changes to them), inviting
 * players, Party status, XP awards and claims, hirelings, and the ledger. See ref-core.js.
 */
(function () {
  'use strict';
  var A = window.CrowsRefApp, f = A.fwd;
  // From the other files (each call goes to the function there).
  var activePCs = f('activePCs'), area = f('area'), beast = f('beast'), btn = f('btn'), card = f('card'), clamp = f('clamp'), damage = f('damage'),
      field = f('field'), greedBonus = f('greedBonus'), inp = f('inp'), log = f('log'), lookup = f('lookup'), more = f('more'), nextES = f('nextES'),
      nid = f('nid'), pullVitals = f('pullVitals'), render = f('render'), S = f('S'), save = f('save'), sel = f('sel'), today = f('today');
  var $ = A.$, charBonusCount = A.charBonusCount, clone = A.clone, el = A.el, esBonusCount = A.esBonusCount, fmt = A.fmt, inv = A.inv, live = A.live,
      plural = A.plural, toast = A.toast, ui = A.ui;
  var state = A.state; A.share('state', function (v) { state = v; });
  var tab = A.tab; A.share('tab', function (v) { tab = v; });

  // ------------------------------------------------------------------ import a character file from the character generator
  function importCharacter(s) {
    var pc = pcFromSave(s);
    var existing = state.party.filter(function (p) { return p.name && p.name === pc.name; })[0];
    if (existing) {
      pc.id = existing.id; pc.miasma = existing.miasma || []; pc.ad = existing.ad || 0;
      if (existing.link) { pc.link = existing.link; pc.owner = existing.owner; }
      state.party[state.party.indexOf(existing)] = pc;
      return pc.name + ' (updated)';
    }
    state.party.push(pc);
    return pc.name || 'a crow';
  }
  /* A party entry built from a Character Generator save. */
  function pcFromSave(s) {
    if (!s || s.v !== 1 || typeof s.bg !== 'number' || !REF.BACKGROUNDS[s.bg]) throw new Error('not a Crows character file');
    var bg = REF.BACKGROUNDS[s.bg], two = bg[1].indexOf(s.twoChar) >= 0 ? s.twoChar : bg[1][0];
    var others = REF.CHARS.filter(function (c) { return c !== two; });
    var high = others.indexOf(s.highChar) >= 0 ? s.highChar : others[0], low = others[0] === high ? others[1] : others[0];
    var v = {}; v[two] = 2;
    if (s.pattern === 'm12') { v[high] = 2; v[low] = -1; } else { v[high] = 1; v[low] = 0; }
    var extra = 0;
    (s.charBonus || []).forEach(function (c) { if (!c) return; if (REF.CHARS.every(function (k) { return v[k] >= 4; })) { extra += 2; return; } if (v[c] < 4) v[c]++; });
    var stMax = bg[2] + extra;
    (s.esBonus || []).forEach(function (o) { if (o === 'stamina') stMax += 2; else if (o === 'mix') stMax += 1; });
    var play = s.play || {};
    var pc = { id: nid(), name: s.name || '', player: s.player || '', bg: bg[0], feature: s.feature || '', A: v.Agility, M: v.Mind, S: v.Strength,
      stMax: stMax, st: typeof play.stamina === 'number' ? clamp(play.stamina, 0, stMax) : stMax, ad: 0,
      wounds: play.wounds ? Object.keys(play.wounds).length : 0, cruelty: play.cruelty | 0, txp: s.txp | 0, pending: play.pendingXP | 0,
      status: 'active', conn: s.connName || '', rel: s.connRel || '', benefit: s.connBenefit || '', miasma: [], notes: s.notes || '',
      conds: play.conds && typeof play.conds === 'object' && !Array.isArray(play.conds) ? clone(play.conds) : {},
      claims: (Array.isArray(play.xpClaims) ? clone(play.xpClaims) : []).filter(function (c) {   // treasure the player asks the Ref to award XP for
        return c && (play.claimsAnswered || []).indexOf(c.id) < 0;
      }) };
    return pc;
  }

  // ------------------------------------------------------------------ crows linked to a player's account
  /*
   * A player can share a character with a link (from their character list). Added here, the crow stays tied
   * to the player's sheet: Party status shows its live vitals, "Open sheet" shows the whole thing, where the Ref
   * can change the vitals, equipment, and notes, and the party entry refreshes from the sheet about a second
   * after the player changes it. Combat, rests, Miasma RRs, and XP awards here reach the sheet too (sheetOp).
   * Needs the Ref to be logged in on the hosted site.
   */
  function cloudOn() { return !!(window.CrowsCloud && window.CrowsCloud.active); }
  function linkToken(text) { var m = /(?:share=|addlink=)?([0-9a-f]{64})/.exec(String(text || '').trim()); return m ? m[1] : null; }
  /* Add or refresh a linked crow from the server's copy. Ref-side bookkeeping (status, AD, Miasma, Ref notes) is kept. */
  function linkPC(item) {
    var pc = pcFromSave(item.data), existing = state.party.filter(function (p) { return p.link === item.id; })[0];
    pc.link = item.id; pc.owner = item.owner || '';
    if (existing) {
      ['id', 'status', 'ad', 'miasma', 'notes', 'owed'].forEach(function (k) { if (k in existing) pc[k] = existing[k]; });
      (pc.owed || []).forEach(function (o) { applyOp(pc, o); });
      // A crow already in the combat tracker picks up the sheet's Stamina and wounds.
      if (S() && S().combat) S().combat.list.forEach(function (c) {
        if (c.kind !== 'pc' || c.pcId !== pc.id) return;
        c.st = Math.min(pc.st, c.stMax); c.wounds = pc.wounds; c.conds = clone(pc.conds || {});
        if (!c.conds.Grabbed) delete c.grabbedBy;
      });
      state.party[state.party.indexOf(existing)] = pc;
      if (S() && S().combat) S().combat.list.forEach(function (c) { if (c.kind === 'pc' && c.pcId === pc.id) pullVitals(c); });
    } else state.party.push(pc);
    watchLinked(item);
    return pc;
  }
  /* Refresh the party entry soon after the player's sheet changes (not while the Ref is typing). */
  function watchLinked(item) {
    var C = window.CrowsCloud, key = 'link-' + item.id;
    if (!C || !C.watch) return;
    C.watch(key, item.watch, item.version, function () {
      var p = state.party.filter(function (x) { return x.link === item.id; })[0];
      if (!p) { C.watch(key, null); return; }
      if (C.typing) return;
      return refreshLinked(p, true);
    });
  }
  function addFromLink(text) {
    var tok = linkToken(text);
    if (!tok) { toast('That doesn\'t look like a character link. Ask the player to copy it again from their character list.'); return Promise.resolve(); }
    return window.CrowsCloud.api('POST', 'link.redeem', '', { token: tok }).then(function (j) {
      var pc = linkPC(j.item);
      log('', 'Added ' + (pc.name || 'a crow') + ' (' + pc.owner + '\u2019s character) to the party.');
      save(); render(); toast('Added ' + (pc.name || 'the crow') + '.');
    }, function (e) { toast(e.message); });
  }
  function refreshLinked(p, quiet) {
    return window.CrowsCloud.api('GET', 'link.get', 'id=' + p.link).then(function (j) {
      linkPC(j.item); save(); render(); if (!quiet) toast('Updated ' + (j.item.name || 'the crow') + ' from the sheet.');
    }, function (e) {
      if (e.status === 404) window.CrowsCloud.watch('link-' + p.link, null);
      if (!quiet || e.status === 404) toast((p.name || 'A crow') + ': ' + e.message);
    });
  }
  function unlinkPC(p, quietly) {
    var id = p.link;
    if (window.CrowsCloud) window.CrowsCloud.watch('link-' + id, null);
    delete p.link; delete p.owner; save(); render();
    if (cloudOn()) window.CrowsCloud.api('POST', 'link.remove', '', { id: id }).then(function () { if (!quietly) toast('Unlinked. The crow stays in the party as a copy.'); }, function () { /* already gone */ });
  }
  /*
   * The Ref changing a crow's sheet numbers. Simple ops (full, st, wounds, AD, cruelty, conditions, XP, rest, claims, endDT)
   * are applied directly to the party entry via CrowsSheetOps.applyRefChange, then also sent through the iframe (CrowsPlay.refChange)
   * so the player's sheet gets the same changes. Complex ops (hit, restore) go through the iframe only — the party entry doesn't
   * track them (the sheet handles absorbers and wound allocation).
   */
  var sheetOps = window.CrowsSheetOps;
  function applyOp(p, o) {
    if (!o) return;
    // Simple ops: apply directly to party entry via shared function
    var simpleKeys = ['full', 'st', 'wounds', 'cruelty', 'setCruelty', 'cond', 'xp', 'apply', 'claims', 'endDT', 'rest', 'ad'];
    var hasSimple = simpleKeys.some(function (k) { return k in o; });
    if (hasSimple && sheetOps) {
      sheetOps.applyRefChange(p, o);
    }
    // Always queue for iframe (simple ops need player sheet path, complex ops go iframe-only)
    if (!p.link || !cloudOn()) return;
    (p.owed = p.owed || []).push(o);
  }
  function flushOps(p) {
    var w = sheetWin(p);
    if (!w || !p.owed || !p.owed.length) return;
    p.owed.forEach(function (o) { w.CrowsPlay.refChange(o); });
    delete p.owed; save();
  }
  function sheetWin(p) {
    var f = p.link && statusFrames[p.link];
    // Only once the player's character is in the frame (before that it holds this browser's own character).
    try { var w = f && f.frame.contentWindow; return w && w.CrowsPlay && w.CrowsPlay.refChange && w.CrowsRefView && w.CrowsRefView.loaded ? w : null; } catch (e) { return null; }
  }
  function sheetOp(p, o) {
    applyOp(p, o);
    if (p.owed) flushOps(p);
  }
  function flushOps(p) {
    var w = sheetWin(p);
    if (!w || !p.owed || !p.owed.length) return;
    p.owed.forEach(function (o) { w.CrowsPlay.refChange(o); });
    delete p.owed; save();
  }
  function openSheet(p) { window.open('play?link=' + encodeURIComponent(p.link), '_blank', 'noopener'); }
  /* Play a linked crow yourself, as if its player had handed it to you (they're told, and can take it back). */
  function takeControl(p) {
    if (!confirm('Take control of ' + (p.name || 'this crow') + '? You can open, edit, and play the whole sheet until ' + (p.owner || 'the player') +
      ' takes it back. They\u2019re told. Hand it back from Handed to you in My characters.')) return;
    var w = window.open('', '_blank');   // opened now, while the click still counts, so it isn't blocked as a pop-up
    window.CrowsCloud.api('POST', 'control.claim', '', { id: p.link }).then(function (j) {
      if (w) w.location.href = new URL('play?id=' + j.characterId, location.href).href; else toast('You have control of ' + (p.name || 'the crow') + '. Open it from My characters.');
    }, function (e) { if (w) w.close(); toast(e.message); });
  }
  function takeBtn(p) { return btn('Take control', function () { takeControl(p); }, 'btn-small btn-ghost', 'Play this crow yourself, say for a session its player will miss'); }
  function newPC() { return { id: nid(), name: '', player: '', bg: '', feature: '', A: 0, M: 0, S: 0, stMax: 7, st: 7, ad: 0, wounds: 0, cruelty: 0, txp: 0, pending: 0, status: 'active', conn: '', rel: '', benefit: '', miasma: [], notes: '' }; }

  // ------------------------------------------------------------------ Party tab
  // ------------------------------------------------------------------ inviting players
  /*
   * The Ref makes an invite link for this campaign and sends it to the players. A player who opens it asks to
   * join with one of their crows; the request appears here within a second or two (through the change signal
   * the server writes for each new request). Accepting links the crow, just as a character link would.
   * The Ref can also list the campaign in Find a campaign, with a short note, so players can ask without a link.
   */
  function loadInvites() {
    var id = window.CrowsCloud && window.CrowsCloud.recordId;
    if (!cloudOn() || !id || inv.loading) return Promise.resolve();
    inv.loading = true;
    return window.CrowsCloud.api('GET', 'invite.get', 'id=' + id).then(function (j) {
      var known = inv.id === id ? inv.requests.map(function (r) { return r.id; }) : null;
      if (inv.id !== id) { inv.link = ''; inv.draft = null; }
      inv.id = id; inv.hasLink = j.hasLink; inv.listed = !!j.listed; inv.note = j.note || ''; inv.requests = j.requests; inv.latest = j.latest; inv.at = Date.now();
      var fresh = known ? j.requests.filter(function (r) { return known.indexOf(r.id) < 0; }) : [];
      if (fresh.length) toast(fresh.map(function (r) { return r.player + ' asks to join with ' + (r.name || 'a crow'); }).join('. ') + '. See the Party tab.');
      window.CrowsCloud.watch('requests', j.watch, j.latest, function () { if (!window.CrowsCloud.typing) return loadInvites(); });
      render();
    }, function (e) { inv.at = Date.now(); if (e.status !== 404) toast(e.message); }).then(function () { inv.loading = false; });
  }
  function answerRequest(r, accept) {
    window.CrowsCloud.api('POST', accept ? 'join.accept' : 'join.decline', '', { id: r.id }).then(function (j) {
      inv.requests = inv.requests.filter(function (x) { return x.id !== r.id; });
      if (accept) {
        var pc = linkPC(j.item);
        log('', (pc.name || 'A crow') + ' (' + pc.owner + '\u2019s character) joined the party.');
        toast((pc.name || 'The crow') + ' joined the party.');
      } else toast('Declined ' + r.player + '\u2019s request.');
      save(); render();
    }, function (e) { toast(e.message); loadInvites(); });
  }
  function setListing(id, listed, note) {
    window.CrowsCloud.api('POST', 'invite.list', '', { id: id, listed: listed, note: note || '' }).then(function () {
      var was = inv.listed;
      inv.listed = listed; inv.note = listed ? (note || '') : inv.note; inv.draft = null; render();
      toast(!listed ? 'Taken out of Find a campaign. Waiting requests stay here.' : was ? 'Note saved.' : 'Listed: players can find this campaign and ask to join.');
    }, function (e) { toast(e.message); render(); });
  }
  /* The switch for Find a campaign, and the note players see there while it's listed. */
  function listBox(id) {
    var box = el('input', { type: 'checkbox', checked: inv.listed });
    box.addEventListener('change', function () { setListing(id, this.checked, inv.draft !== null ? inv.draft : inv.note); });
    var kids = [el('label', { class: 'check', title: 'Any player with an account can find this campaign and ask to join. You still accept or decline each request.' },
      [box, 'List in Find a campaign'])];
    if (inv.listed) {
      var text = inv.draft !== null ? inv.draft : inv.note;
      var ta = el('textarea', { rows: 2, maxlength: 255, placeholder: 'A note for players: who you\u2019re looking for, when you play\u2026', 'aria-label': 'Note for players' });
      ta.value = text;
      var saveBtn = btn('Save note', function () { setListing(id, true, ta.value); }, 'btn-small', 'Show this note with the campaign in Find a campaign');
      saveBtn.disabled = text === inv.note;
      ta.addEventListener('input', function () { inv.draft = this.value; saveBtn.disabled = this.value === inv.note; });
      kids.push(ta, el('div', { class: 'row center' }, [saveBtn, el('span', { class: 'fine', text: 'Players see the name, summary, this note, and your username.' })]));
    }
    return el('div', { class: 'invite-list' }, kids);
  }
  /* A compact card at the top of the Party tab for inviting players and managing join requests. */
  function renderInvite() {
    var box = $('sec-invite'), id = window.CrowsCloud && window.CrowsCloud.recordId, on = cloudOn() && tab === 'party';
    box.hidden = !on; box.innerHTML = '';
    if (!on) return;
    var head = el('div', { class: 'row center' }, [el('h3', { text: 'Invite players' }), el('span', { class: 'spacer' }),
      inv.requests.length ? el('span', { class: 'badge', text: String(inv.requests.length), title: plural(inv.requests.length, 'request') + ' waiting' }) : null]);
    if (!id) { box.appendChild(head); box.appendChild(el('p', { class: 'fine', text: 'Saving the campaign to your account first…' })); setTimeout(function () { if (tab === 'party') render(); }, 1500); return; }
    if (inv.id !== id || Date.now() - inv.at > 60000) loadInvites();   // also catches requests withdrawn meanwhile
    var linkBox = null;
    if (inv.link) {
      var input = el('input', { type: 'text', class: 'in', readonly: true, value: inv.link, 'aria-label': 'Invite link', onfocus: function () { this.select(); } });
      linkBox = el('div', { class: 'invite-link' }, [input,
        el('div', { class: 'row center' }, [btn('Copy link', function () {
          input.select();
          (navigator.clipboard ? navigator.clipboard.writeText(inv.link) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { document.execCommand('copy'); toast('Link copied.'); });
        }, 'btn-small btn-primary')]),
        el('p', { class: 'fine', text: 'Shown only now; make a new one if you lose it. Keep it private: anyone with an account who has it can ask to join.' })]);
    }
    [head,
      el('p', { class: 'fine', text: 'Players open the link (or find the campaign, if it\u2019s listed), pick a crow, and ask to join. Accepted crows join the party, tied to their sheets.' }),
      el('div', { class: 'row center' }, [
        btn(inv.hasLink ? 'New link' : 'Make a link', function () {
          if (inv.hasLink && !confirm('Make a new link? The old one stops working. Requests already made stay here.')) return;
          window.CrowsCloud.api('POST', 'invite.create', '', { id: id }).then(function (j) { inv.hasLink = true; inv.link = j.link; render(); }, function (e) { toast(e.message); });
        }, 'btn-small'),
        inv.hasLink ? btn('Turn off', function () {
          window.CrowsCloud.api('POST', 'invite.disable', '', { id: id }).then(function () { inv.hasLink = false; inv.link = ''; render(); toast('The invite link no longer works. Waiting requests stay here.'); }, function (e) { toast(e.message); });
        }, 'btn-small btn-ghost', 'Turn off the invite link') : null,
        inv.hasLink && !inv.link ? el('span', { class: 'fine', text: 'Link is on.' }) : null]),
      linkBox,
      listBox(id),
      inv.requests.length ? el('ul', { class: 'join-reqs' }, inv.requests.map(function (r) {
        return el('li', null, [el('div', null, [el('b', { text: r.name || 'Unnamed crow' }), el('div', { class: 'fine', text: r.player + (r.summary ? ' · ' + r.summary : '') })]),
          el('div', { class: 'row center' }, [btn('Accept', function () { answerRequest(r, true); }, 'btn-small btn-primary', 'Add this crow to the party, tied to the player’s sheet'),
            btn('Decline', function () { answerRequest(r, false); }, 'btn-small btn-ghost')])]);
      })) : null
    ].forEach(function (k) { if (k) box.appendChild(k); });
  }

  // ------------------------------------------------------------------ Party status
  /*
   * A condensed, live view of every crow in play. A crow linked to a player's sheet shows that sheet's own Vitals
   * card (the generator at &view=status in a frame), so its buttons work exactly as they do for the player, with
   * the whole character behind them (armor soaking damage, wounds filling backpack slots, the log), and save to
   * the player's sheet within a second. Frames are kept, not rebuilt, across renders (reloading one would lose
   * a second or two and anything half-typed), and they're laid out with CSS order instead of being moved.
   * Crows added by hand or from a file get simple buttons for the numbers kept here.
   */
  var statusFrames = {};   // link id -> { tile, frame, head } — only for complex ops (hit/restore/rest)
  var statusTiles = {};   // link id -> { tile, pcs } — lightweight tiles for vitals
  function statusPCs() { return state.party.filter(function (p) { return p.status === 'active' || p.status === 'away'; }); }
  function statusHead(p) {
    return el('div', { class: 'st-head' }, [el('b', { class: 'grow', text: p.name || 'Unnamed crow' }),
      p.status === 'away' ? el('span', { class: 'chip', text: 'sitting out' }) : null,
      p.owner ? el('span', { class: 'fine', text: p.owner }) : null]);
  }
  function localTile(p) {
    function pm(k, lo, hi, what) {
      return [btn('\u2212', function () { sheetOp(p, { [k]: -1 }); }, 'btn-small', 'Lower ' + what),
        btn('+', function () { sheetOp(p, { [k]: 1 }); }, 'btn-small', 'Raise ' + what)];
    }
    var max = p.stMax || 0, st = Math.min(p.st || 0, max);
    return el('div', { class: 'st-tile' }, [statusHead(p),
      el('div', { class: 'st-stam' }, [el('span', { class: 'lbl', text: 'Stamina' }), el('b', { text: st + ' / ' + max }),
        el('div', { class: 'meter' }, [el('span', { style: 'width:' + (max ? Math.round(st / max * 100) : 0) + '%' })])]),
      el('div', { class: 'row center' }, [btn('\u22125', function () { sheetOp(p, { st: -5 }); }, 'btn-small'), btn('\u22121', function () { sheetOp(p, { st: -1 }); }, 'btn-small'),
        btn('+1', function () { sheetOp(p, { st: 1 }); }, 'btn-small'), btn('+5', function () { sheetOp(p, { st: 5 }); }, 'btn-small'),
        btn('Full', function () { sheetOp(p, { full: true }); }, 'btn-small btn-ghost')]),
      el('div', { class: 'st-nums' }, [
        el('span', { class: p.wounds >= 7 ? 'bad' : null }, ['Wounds ', el('b', { text: (p.wounds || 0) + '/10' })].concat(pm('wounds', 0, 10, 'wounds'))),
        el('span', null, ['AD ', el('b', { text: String(p.ad || 0) })].concat(pm('ad', 0, 99, 'AD'))),
        el('span', null, ['Cruelty ', el('b', { text: String(p.cruelty || 0) })].concat(pm('cruelty', 0, 20, 'cruelty')))]),
      el('div', { class: 'fine', text: 'Kept on this screen only. Link the player\u2019s sheet to see and change everything live.' })]);
  }
  function linkedTile(p) {
    function bump(k, n) { sheetOp(p, { [k]: n }); save(); render(); }
    function pm(k, lo, hi) { return [btn('\u2212', function () { bump(k, -1); }, 'btn-small'), btn('+', function () { bump(k, 1); }, 'btn-small')]; }
    var max = p.stMax || 0, st = Math.min(p.st || 0, max);
    return el('div', { class: 'st-tile linked' }, [statusHead(p),
      el('div', { class: 'st-stam' }, [el('span', { class: 'lbl', text: 'Stamina' }), el('b', { text: st + ' / ' + max }),
        el('div', { class: 'meter' }, [el('span', { style: 'width:' + (max ? Math.round(st / max * 100) : 0) + '%' })])]),
      el('div', { class: 'row center' }, [btn('\u22125', function () { bump('st', -5); }, 'btn-small'), btn('\u22121', function () { bump('st', -1); }, 'btn-small'),
        btn('+1', function () { bump('st', 1); }, 'btn-small'), btn('+5', function () { bump('st', 5); }, 'btn-small'),
        btn('Full', function () { sheetOp(p, { full: true }); }, 'btn-small btn-ghost')]),
      el('div', { class: 'st-nums' }, [
        el('span', { class: p.wounds >= 7 ? 'bad' : null }, ['Wounds ', el('b', { text: (p.wounds || 0) + '/10' })].concat(pm('wounds', 0, 10))),
        el('span', null, ['AD ', el('b', { text: String(p.ad || 0) })].concat(pm('ad', 0, 99))),
        el('span', null, ['Cruelty ', el('b', { text: String(p.cruelty || 0) })].concat(pm('cruelty', 0, 20)))]),
      el('div', { class: 'fine', text: 'Linked to ' + (p.owner ? p.owner + '\u2019s' : 'the player\u2019s') + ' sheet: changes go live. (Hit/rest need iframe.)' })]);
  }
  function renderStatus() {
    var box = $('sec-status'), live = cloudOn();
    if (!box.firstChild) {
      box.appendChild(el('h2', null, ['Party status', el('small', { text: 'live from the players\u2019 sheets' })]));
      box.appendChild(el('p', { class: 'hint', text: 'Each linked crow shows its vitals in a lightweight tile: buttons change Stamina, wounds, AD, and cruelty directly. ' +
        'Changes propagate to the player\u2019s sheet at once. Complex operations (combat hits, rest) use the iframe path.' }));
      box.appendChild(el('div', { class: 'row', style: 'margin-bottom:.6rem' }, [btn('Everyone to full Stamina', function () {
        activePCs().forEach(function (p) { sheetOp(p, { full: true }); });
        save(); render();
      }, 'btn-small btn-ghost', 'Every active crow back to full Stamina')]));
      box.appendChild(el('div', { class: 'st-grid', id: 'st-grid' }));
      box.appendChild(el('p', { class: 'hint', id: 'st-empty', text: 'No crows in play. Add some below.' }));
    }
    var grid = $('st-grid'), pcs = statusPCs(), keep = {};
    $('st-empty').style.display = pcs.length ? 'none' : '';
    Array.prototype.forEach.call(grid.querySelectorAll('.st-tile.local'), function (n) { n.remove(); });
    Array.prototype.forEach.call(grid.querySelectorAll('.st-tile.linked'), function (n) { n.remove(); });
    pcs.forEach(function (p, i) {
      if (p.link && live) {
        keep[p.link] = true;
        // Lightweight tile for display
        var tile = linkedTile(p);
        tile.style.order = i;
        grid.appendChild(tile);
        // Hidden iframe for complex ops (hit, restore, rest) — keeps the player sheet path alive
        var f = statusFrames[p.link];
        if (!f) {
          f = statusFrames[p.link] = { head: el('div'),
            frame: el('iframe', { class: 'st-frame st-frame-hidden', title: 'Vitals of ' + (p.name || 'a linked crow'),
            src: 'Crows_Character_Generator.html?link=' + encodeURIComponent(p.link) + '&view=status' }) };
          // Hide the iframe but keep it in the DOM for CrowsPlay.refChange access
          f.frame.style.display = 'none';
          box.appendChild(f.frame);
        }
      } else {
        var t = localTile(p); t.className += ' local'; t.style.order = i;
        grid.appendChild(t);
      }
    });
    // Clean up old frames
    Object.keys(statusFrames).forEach(function (id) { if (!keep[id]) { statusFrames[id].tile.remove(); delete statusFrames[id]; } });
  }
  // A frame reports its height whenever it changes; size it to fit, so there's no inner scrollbar.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || !e.data.crowsStatus) return;
    Object.keys(statusFrames).forEach(function (id) {
      var fr = statusFrames[id].frame;
      if (fr.contentWindow !== e.source) return;
      fr.style.height = Math.max(60, Math.min(4000, +e.data.h || 0)) + 'px';
      if (e.data.loaded) state.party.forEach(function (p) { if (String(p.link) === id && p.owed) flushOps(p); });
    });
  });

  function renderParty() {
    renderStatus();
    var fileIn = el('input', { type: 'file', accept: '.json,application/json', multiple: true, onchange: function () {
      var files = Array.prototype.slice.call(this.files || []), input = this, done = [];
      if (!files.length) return;
      var left = files.length;
      files.forEach(function (f) {
        var rd = new FileReader();
        rd.onload = function () {
          try { done.push(importCharacter(JSON.parse(rd.result))); } catch (e) { toast(f.name + ': ' + e.message); }
          if (--left === 0) { input.value = ''; save(); render(); if (done.length) { toast('Imported ' + done.join(', ') + '.'); log('', 'Imported crows: ' + done.join(', ') + '.'); } }
        };
        rd.readAsText(f);
      });
    } });
    card('sec-party', el('h2', null, ['The Crows', el('small', { text: plural(activePCs().length, 'active crow') })]), [
      el('p', { class: 'hint', text: 'Keep the party\'s key numbers at hand. Import the .json save files from the Character Generator (Save file), or add crows by hand. Importing a crow with the same name updates it.' +
        (cloudOn() ? ' Players can also send you a link to their character: added that way, the crow stays tied to their sheet. Its vitals show live under Party status, and you can open the sheet to change equipment and notes too.' : '') }),
      cloudOn() ? el('div', { class: 'row', style: 'margin-bottom:.5rem' }, [
        (ui.linkIn = el('input', { type: 'url', class: 'in grow', placeholder: 'Paste a player\u2019s character link', 'aria-label': 'Character link', value: ui.linkText || '',
          oninput: function () { ui.linkText = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') { addFromLink(this.value); ui.linkText = ''; } } })),
        btn('Add from link', function () { addFromLink(ui.linkIn.value); ui.linkText = ''; }, 'btn-primary', 'The crow stays tied to the player\u2019s sheet')]) : null,
      el('div', { class: 'row', style: 'margin-bottom:.7rem' }, [btn('Add crow', function () { state.party.push(newPC()); save(); render(); }, 'btn-primary'),
        el('label', { class: 'btn file-btn' }, ['Import character files', fileIn])]),
      state.party.length ? el('div', { class: 'pc-list' }, [pcHead()].concat(state.party.map(pcCard))) : el('p', { class: 'hint', text: 'No crows yet.' })
    ]);

    var aw = ui.award || (ui.award = { gc: 0, greed: greedBonus(), players: activePCs().length || 1, what: '' });
    var total = Math.round(aw.gc * (1 + aw.greed / 100)), each = aw.players ? Math.floor(total / aw.players) : 0;
    card('sec-xp', el('h2', null, ['Experience', el('small', { text: 'XP = treasure value / number of players' })]), [
      el('p', { class: 'hint', text: 'XP comes from treasure and equipment recovered outside a village (not bought, crafted by the group, taken from an innocent human, or originally an ally\'s). Unique items give the XP on their card. XP can be spent, and bonuses gained, only after finishing a rest.' }),
      claimsBox(),
      el('div', { class: 'grid3' }, [
        field('Treasure value (gc) or card XP', inp(aw, 'gc', { type: 'number', min: 0, max: 9999999 }, { re: true })),
        field('Greed bonus', sel(aw, 'greed', [[0, 'none'], [10, '+10% (DT 3)'], [20, '+20% (DT 2)'], [30, '+30% (DT 1)']], { num: true })),
        field('Number of players', inp(aw, 'players', { type: 'number', min: 1, max: 20 }, { re: true, dflt: 1 })),
        field('What was it?', inp(aw, 'what', { placeholder: 'e.g. jade mask, 538 gc chest' }), 'span2')
      ]),
      el('div', { class: 'row center', style: 'margin-top:.6rem' }, [el('span', null, ['Total ', el('b', { text: fmt(total) + ' gc' }), ' → ', el('b', { text: fmt(each) + ' XP' }), ' per crow']),
        btn('Award as pending XP', function () {
          if (!each) return;
          var answered = aw.claims || [];   // the players' claims this award answers
          activePCs().forEach(function (p) { sheetOp(p, claimOp(p, answered, { xp: each, desc: aw.what || 'Treasure', gc: total, n: aw.players })); });
          state.party.forEach(function (p) { if (activePCs().indexOf(p) < 0 && claimOp(p, answered, {}).claims) sheetOp(p, claimOp(p, answered, {})); });
          state.xpLog.push({ date: today(), session: S().n, what: aw.what, gc: total, each: each });
          log('', 'XP: ' + (aw.what || 'treasure') + ' worth ' + fmt(total) + ' gc → **' + fmt(each) + ' XP** each (applies after the next rest).');
          ui.award = null; save(); render();
        }, 'btn-primary'),
        btn('Apply all pending XP now', function () { activePCs().forEach(function (p) { sheetOp(p, { apply: true }); }); log('', 'Pending XP applied.'); save(); render(); }, 'btn-ghost')]),
      state.xpLog.length ? more('XP history (' + state.xpLog.length + ')', [el('div', { class: 'tbl-wrap' }, [el('table', { class: 'tbl' }, [
        el('thead', null, [el('tr', null, ['Date', 'Session', 'What', 'Value', 'Each'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', null, state.xpLog.slice().reverse().map(function (x) { return el('tr', null, [el('td', { text: x.date }), el('td', { text: String(x.session) }), el('td', { text: x.what || '' }), el('td', { class: 'n', text: fmt(x.gc) }), el('td', { class: 'n', text: fmt(x.each) })]); }))
      ])])]) : null,
      more('Advancement thresholds', [el('p', { text: 'Expertise & Stamina bonuses at TXP 100, 500, 1,250, 2,250, 3,500, 5,000, 10,000, 20,000, 30,000, then every +30,000. Each: +3 expertise uses, or +2 Stamina max, or +1 use and +1 Stamina max. Characteristic bonus (+1, max 4) at 5,000, 15,000, 30,000, then every +30,000. Traits cost 500/1,000/1,500/2,000 XP by row.' }),
        el('p', { text: 'New crow after a death: roll backgrounds 1 + (the dead crow\'s number of E&S bonuses) times and pick any. Starting With More: if all other crows have 5,000+ TXP, a new crow may start at the lowest party TXP with half that in gc for equipment. Retirement at 60,000+ TXP gives the village a benefit (2 at 100,000+).' })])
    ]);

    card('sec-hirelings', el('h2', null, ['Hirelings', el('small', { text: 'daily pay power × 10 gc (min 10) + food' })]), [
      el('p', { class: 'hint', text: 'Paid at the start of each day. If one dies in service, the crows owe its family its equipment (or equal value), wages due, and power × 500 gc on returning to the hiring village. Unpaid hirelings leave; with debts unpaid, no hireling will work for those crows. Players control them; the Ref may take over for out-of-character or suicidal orders. No XP.' }),
      el('div', { class: 'list' }, state.hirelings.map(function (h) {
        var pw = h.power || 0;
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [
          el('div', { class: 'li-row' }, [inp(h, 'name', { placeholder: 'Name' }), sel(h, 'block', [['', 'Stat block…']].concat(REF.BESTIARY.filter(function (b) { return b.t === 'Human' || b.t === 'Animal'; }).map(function (b) { return [b.n, b.n + ' (P' + b.p + ')']; })), { on: function (n) { var b = beast(n); if (b) h.power = b.p; } }),
            inp(h, 'employer', { placeholder: 'Employer' })]),
          el('div', { class: 'li-row' }, [el('label', { class: 'check' }, ['Power ', inp(h, 'power', { type: 'number', min: 0, max: 20, class: 'tiny' }, { re: true })]),
            el('span', { class: 'fine', text: 'Pay ' + Math.max(10, pw * 10) + ' gc/day + food · death debt ' + fmt(pw * 500) + ' gc + gear' }), inp(h, 'notes', { placeholder: 'Notes (lent gear, days owed…)' })])
        ]), el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove hireling', onclick: function () { state.hirelings = state.hirelings.filter(function (x) { return x !== h; }); save(); render(); } })]);
      })),
      el('div', { class: 'row' }, [btn('Add hireling', function () { state.hirelings.push({ id: nid(), name: '', block: '', power: 0, employer: '', notes: '' }); save(); render(); }),
        state.hirelings.length ? btn('Pay a day', function () { var tot = state.hirelings.reduce(function (a, h) { return a + Math.max(10, (h.power || 0) * 10); }, 0); log('', 'Hirelings paid for the day: ' + fmt(tot) + ' gc + a day\'s food each.'); render(); }, 'btn-ghost') : null])
    ]);

    card('sec-ledger', el('h2', null, ['Ledger', el('small', { text: 'loans, credits, bets, debts, promises' })]), [
      el('div', { class: 'list' }, state.ledger.map(function (l) {
        return el('div', { class: 'li' }, [el('div', { class: 'li-main' }, [el('div', { class: 'li-row' }, [inp(l, 'who', { placeholder: 'Who' }), inp(l, 'what', { placeholder: 'What (Money Bags loan, 100 gc credit, rival bet…)' }),
          el('label', { class: 'check' }, ['gc ', inp(l, 'gc', { type: 'number', min: -999999, max: 999999, class: 'tiny', style: 'width:6rem' })]), inp(l, 'due', { placeholder: 'Due / expires' })])]),
          el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Remove entry', onclick: function () { state.ledger = state.ledger.filter(function (x) { return x !== l; }); save(); render(); } })]);
      })),
      btn('Add entry', function () { state.ledger.push({ id: nid(), who: '', what: '', gc: 0, due: '' }); save(); render(); })
    ]);
  }
  /*
   * One crow as a single row of what matters at the table (name, status, characteristics, Stamina, AD, wounds,
   * cruelty, pending XP), under the column heads from pcHead(). The rest (background, XP and bonuses, connection,
   * Miasma, notes, and a linked crow's sheet actions) is under "More", which stays open across renders.
   */
  var PC_STATUSES = [['active', 'Active'], ['away', 'Sitting out'], ['dead', 'Dead'], ['retired', 'Retired'], ['lost', 'Lost to the Miasma']];
  /*
   * Treasure the players logged on their sheets while in this campaign (Play > Experience): XP is the Ref's to award.
   * "Use" fills in the award form (with every claim for the same treasure); the award then answers them. "Dismiss" answers without XP.
   */
  function allClaims() {
    var out = [];
    state.party.forEach(function (p) { (p.claims || []).forEach(function (c) { out.push({ p: p, c: c }); }); });
    return out;
  }
  function claimOp(p, answered, op) {
    var ids = answered.filter(function (a) { return a.pc === p.id; }).map(function (a) { return a.id; });
    if (ids.length) op.claims = ids;
    return op;
  }
  function claimsBox() {
    var list = allClaims();
    if (!list.length) return null;
    return el('div', { class: 'pending' }, [el('b', { text: 'XP claims from players' }), el('ul', { class: 'claims' }, list.map(function (x) {
      var same = list.filter(function (y) { return y.c.desc.toLowerCase() === x.c.desc.toLowerCase() && y.c.gc === x.c.gc; });
      return el('li', null, [(x.p.name || 'A crow') + (x.p.owner ? ' (' + x.p.owner + ')' : '') + ': ' + x.c.desc + ', ' + fmt(x.c.gc) + ' gc split ' + x.c.n + ' ways' +
        (same.length > 1 ? ' (claimed by ' + same.length + ' crows)' : '') + ' ',
        btn('Use', function () {
          ui.award = { gc: x.c.gc, greed: ui.award ? ui.award.greed : greedBonus(), players: x.c.n || activePCs().length || 1, what: x.c.desc,
            claims: same.map(function (y) { return { pc: y.p.id, id: y.c.id }; }) };
          render();
        }, 'btn-small', 'Fill in the award below with this treasure'),
        btn('Dismiss', function () { sheetOp(x.p, { claims: [x.c.id] }); log('', 'Dismissed ' + (x.p.name || 'a crow') + '\u2019s XP claim for ' + x.c.desc + '.'); save(); render(); }, 'btn-small btn-ghost', 'Answer the claim without XP')]);
    }))]);
  }
  function pcHead() {
    return el('div', { class: 'pc-head', 'aria-hidden': 'true' }, ['Crow', 'A', 'M', 'S', 'Stamina', 'AD', 'Wounds', 'Cruelty', 'Pending XP', ''].map(function (t) { return el('span', { text: t }); }));
  }
  function pcCard(p) {
    // A linked crow's sheet fields are refreshed from the player's sheet, so they're shown but not edited here.
    function ro(a) { a = a || {}; if (p.link) { a.disabled = true; a.title = 'From the player’s sheet'; } return a; }
    function cell(label, control, cls) { return el('label', { class: 'c' + (cls ? ' ' + cls : '') }, [el('span', { class: 'l', text: label }), control]); }
    function num(key, min, max, opts, own) { return inp(p, key, (own ? function (a) { return a; } : ro)({ type: 'number', min: min, max: max, class: 'in n', 'aria-label': key }), opts); }
    var benefit = REF.CONNECTION_BENEFITS.filter(function (b) { return b[0] === p.benefit; })[0];
    var es = esBonusCount(p.txp || 0), cb = charBonusCount(p.txp || 0);
    ui.pcOpen = ui.pcOpen || {};
    var more = el('details', { class: 'pc-more', open: ui.pcOpen[p.id] || null, ontoggle: function () { ui.pcOpen[p.id] = this.open; } }, [
      el('summary', { text: 'More' }),
      p.link && cloudOn() ? el('div', { class: 'row center pc-link' }, [
        el('span', { class: 'fine grow', text: 'Linked to ' + (p.owner ? p.owner + '’s' : 'the player’s') + ' sheet: its numbers come from there.' }),
        btn('Update from sheet', function () { refreshLinked(p); }, 'btn-small', 'Refresh name, characteristics, Stamina, wounds, and XP from the sheet'),
        p.status === 'active' || p.status === 'away' ? takeBtn(p) : null,
        btn('Unlink', function () { if (confirm('Unlink ' + (p.name || 'this crow') + ' from the player’s sheet? You keep this copy, but lose access to the sheet.')) unlinkPC(p); }, 'btn-small btn-ghost')
      ]) : null,
      el('div', { class: 'grid3' }, [field('Player', inp(p, 'player', ro())), field('Background', inp(p, 'bg', ro({ list: 'bg-list' }))),
        field('Total XP', inp(p, 'txp', ro({ type: 'number', min: 0, max: 9999999 }), { re: true }))]),
      el('div', { class: 'pc-sum', text: plural(es, 'E&S bonus') + ', ' + plural(cb, 'characteristic bonus') + ' · next E&S bonus at ' + fmt(nextES(p.txp || 0)) + ' TXP' + ((p.txp || 0) >= 60000 ? ' · may retire' : '') }),
      p.miasma && p.miasma.length ? el('div', { class: 'pc-sum', text: 'Miasma: ' + p.miasma.map(function (k) { return lookup(REF.MIASMA_EFFECTS, k)[2].split(':')[0]; }).join(', ') }) : null,
      el('div', { class: 'grid3' }, [field('Connection', inp(p, 'conn', ro({ placeholder: 'NPC name' }))), field('Relationship', inp(p, 'rel', ro())),
        field('Connection benefit', sel(p, 'benefit', [['', '—']].concat(REF.CONNECTION_BENEFITS.map(function (b) { return b[0]; })), { disabled: !!p.link }))]),
      benefit ? el('div', { class: 'fine', text: benefit[1] }) : null,
      field('Notes', area(p, 'notes', { rows: 2, placeholder: 'Feature, goals, debts, secrets…' }))
    ]);
    return el('div', { class: 'pc-row ' + (p.status || 'active') }, [
      el('div', { class: 'pc-main' }, [
        el('div', { class: 'c who' }, [
          inp(p, 'name', ro({ placeholder: 'Crow name', 'aria-label': 'Name', class: 'in pc-name' })),
          el('div', { class: 'row center sub' }, [sel(p, 'status', PC_STATUSES, { class: 'in mini', label: 'Status' }),
            el('span', { class: 'fine', text: [p.player, p.bg].filter(Boolean).join(' · ') + (p.link ? (p.player || p.bg ? ' · ' : '') + 'linked' : '') })])]),
        cell('A', num('A', -5, 5)), cell('M', num('M', -5, 5, { re: true })), cell('S', num('S', -5, 5)),
        el('div', { class: 'c stam' }, [el('span', { class: 'l', text: 'Stamina' }), num('st', 0, 999), el('span', { class: 'of', text: '/' }), num('stMax', 1, 999)]),
        cell('AD', num('ad', 0, 99, null, true)), cell('Wounds', num('wounds', 0, 10)), cell('Cruelty', num('cruelty', 0, 20, { re: true })),
        cell('Pending XP', num('pending', 0, 9999999)),
        el('div', { class: 'c acts' }, [
          p.link && cloudOn() ? btn('Sheet', function () { openSheet(p); }, 'btn-small', 'Open the player’s whole sheet') : null,
          el('button', { type: 'button', class: 'x', text: '×', 'aria-label': 'Delete crow', onclick: function () {
            if (!confirm('Delete ' + (p.name || 'this crow') + ' from the party?')) return;
            if (p.link) unlinkPC(p, true);
            state.party = state.party.filter(function (x) { return x !== p; }); save(); render();
          } })])
      ]),
      more
    ]);
  }

  A.add({ importCharacter: importCharacter, pcFromSave: pcFromSave, cloudOn: cloudOn, linkToken: linkToken, linkPC: linkPC, watchLinked: watchLinked,
      addFromLink: addFromLink, refreshLinked: refreshLinked, unlinkPC: unlinkPC, applyOp: applyOp, sheetWin: sheetWin, sheetOp: sheetOp,
      flushOps: flushOps, openSheet: openSheet, takeControl: takeControl, takeBtn: takeBtn, newPC: newPC, loadInvites: loadInvites,
      answerRequest: answerRequest, setListing: setListing, listBox: listBox, renderInvite: renderInvite, statusPCs: statusPCs,
      statusHead: statusHead, localTile: localTile, renderStatus: renderStatus, renderParty: renderParty, allClaims: allClaims, claimOp: claimOp,
      claimsBox: claimsBox, pcHead: pcHead, pcCard: pcCard, statusFrames: statusFrames, PC_STATUSES: PC_STATUSES });
})();
