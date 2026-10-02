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
  var Sheet = window.CrowsSheet;   // src/shared/sheet.js
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
   * to the player's sheet: Party status shows its vitals, "Open sheet" shows the whole thing, where the Ref
   * can change the vitals, equipment, and notes, and the party entry refreshes from the sheet about a second
   * after the player changes it. Combat, rests, Miasma RRs, and XP awards here change the sheet too (sheetOp).
   * Needs the Ref to be logged in on the hosted site.
   */
  function cloudOn() { return !!(window.CrowsCloud && window.CrowsCloud.active); }
  function linkToken(text) { var m = /(?:share=|addlink=)?([0-9a-f]{64})/.exec(String(text || '').trim()); return m ? m[1] : null; }
  /*
   * Add or refresh a linked crow from the server's copy (link.get, or link.save's answer). Ref-side bookkeeping (status, AD,
   * Miasma, Ref notes) is kept. The party entry shows the sheet with the Ref's unsaved changes (p.owed) on top.
   */
  function linkPC(item) {
    var pc = pcFromSave(item.data), existing = state.party.filter(function (p) { return p.link === item.id; })[0];
    if (existing) ['id', 'status', 'ad', 'miasma', 'notes', 'owed'].forEach(function (k) { if (k in existing) pc[k] = existing[k]; });
    var sh = sheets[item.id] || (sheets[item.id] = { base: null, version: 0, local: null, sending: null, timer: null, retryMs: 0 });
    // Not while a save is on its way (its answer brings the newer copy), nor from an answer older than the copy here.
    if (!sh.sending && !(item.version < sh.version)) {
      sh.base = item.data; sh.version = item.version || 0;
      sh.local = replay(item.data, pc.owed || []);
      if (pc.owed && pc.owed.length) queueSave(item.id);
    }
    fromSheet(pc, sh.local);
    pc.link = item.id; pc.owner = item.owner || '';
    if (existing) {
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
    if (sheets[id]) { clearTimeout(sheets[id].timer); delete sheets[id]; }
    delete p.link; delete p.owner; delete p.owed; save(); render();
    if (cloudOn()) window.CrowsCloud.api('POST', 'link.remove', '', { id: id }).then(function () { if (!quietly) toast('Unlinked. The crow stays in the party as a copy.'); }, function () { /* already gone */ });
  }
  /*
   * The Ref changing a crow's sheet (XP, Stamina, wounds, cruelty, a hit, the end of a DT or a rest): sheetOp(p, op), with the op
   * as CrowsSheet.applyRefChange (src/shared/sheet.js) takes it.
   *
   * A linked crow: this screen keeps the player's whole character as the server last sent it (link.get), makes the change on it
   * with the same sheet math the player's own page uses (worn armor soaks a hit, wounds fill backpack slots, a rest eats a
   * ration...), logs it on the sheet, and saves the shared fields with link.save a moment later. Changes are steps (Stamina -1,
   * XP +130), so they wait in p.owed (kept with the campaign) until saved: if the player saved first (409), or the sheet isn't
   * loaded yet, they're made again on the newest copy.
   * A crow added by hand or from a file: just the numbers kept here (applyOp).
   */
  var sheets = {};   // link id -> { base: the server's copy, version (its), local: base + p.owed, sending: the ops being saved, timer, retryMs }
  function applyOp(p, o) {
    if (o.rest) {   // a rest's numbers (the sheet does the whole rest: ration, uses, recharges)
      p.st = p.stMax; p.wounds = Math.max(0, (p.wounds || 0) - 1);
      if (o.rest.xp) { p.txp = (p.txp || 0) + (p.pending || 0); p.pending = 0; }
    }
    if (o.claims && p.claims) p.claims = p.claims.filter(function (c) { return o.claims.indexOf(c.id) < 0; });
    if (o.xp) p.pending = (p.pending || 0) + o.xp;
    if (o.apply) { p.txp = (p.txp || 0) + (p.pending || 0); p.pending = 0; }
    if (o.full) p.st = p.stMax;
    if (o.st) p.st = clamp((p.st || 0) + o.st, 0, p.stMax);
    if (o.wounds) p.wounds = clamp((p.wounds || 0) + o.wounds, 0, 10);
    if (o.cruelty) p.cruelty = Math.max(0, (p.cruelty || 0) + o.cruelty);
    if (typeof o.setCruelty === 'number') p.cruelty = o.setCruelty;
    if (o.cond) { p.conds = p.conds || {}; Object.keys(o.cond).forEach(function (k) { if (o.cond[k]) p.conds[k] = true; else delete p.conds[k]; }); }
  }
  /* A linked crow's character as this screen has it (with the Ref's unsaved changes), or null if it isn't loaded. */
  function sheetOf(p) { var sh = p && p.link && cloudOn() ? sheets[p.link] : null; return sh ? sh.local : null; }
  /* A copy of a saved character, ready for the sheet math. */
  function prepared(data) {
    var c = clone(data);
    if (!Array.isArray(c.inv)) c.inv = [];
    c.txp = c.txp | 0;
    c.play = Sheet.normalizePlay(c.play);
    return c;
  }
  /* Make change o on character c, and log it there as the Ref's (as the player's page does). */
  function applyToSheet(c, o) {
    var msgs = Sheet.applyRefChange(c, o);
    if (msgs.length) Sheet.addLog(c, 'Ref: ' + msgs.join(' '));
  }
  function replay(data, ops) { var c = prepared(data); ops.forEach(function (o) { applyToSheet(c, o); }); return c; }
  /* The party entry's numbers from its sheet. */
  function fromSheet(p, c) {
    var v = Sheet.vitals(c);
    p.st = v.st; p.stMax = v.stMax; p.wounds = v.wounds; p.cruelty = v.cruelty; p.conds = v.conds;
    p.txp = c.txp | 0; p.pending = c.play.pendingXP | 0;
    p.claims = c.play.xpClaims.filter(function (x) { return x && c.play.claimsAnswered.indexOf(x.id) < 0; });
  }
  function sheetOp(p, o) {
    if (!p.link || !cloudOn()) { applyOp(p, o); return; }
    (p.owed = p.owed || []).push(o);
    var c = sheetOf(p);
    if (!c) { applyOp(p, o); return; }   // made on the sheet once it's loaded (linkPC)
    applyToSheet(c, o);
    fromSheet(p, c);
    queueSave(p.link);
  }
  /* Save a linked crow's waiting changes in a moment (so a burst of them goes together). */
  function queueSave(id, ms) {
    var sh = sheets[id];
    if (!sh || sh.sending) return;
    clearTimeout(sh.timer);
    sh.timer = setTimeout(function () { sh.timer = null; sendSheet(id); }, ms == null ? 300 : ms);
  }
  function sendSheet(id) {
    var sh = sheets[id], p = state.party.filter(function (x) { return x.link === id; })[0];
    if (!sh || sh.sending || !sh.local || !p || !p.owed || !p.owed.length || !cloudOn()) return;
    var ops = p.owed.slice(), diff = window.CrowsCloud.linkDiff(sh.base, sh.local);
    function settled(item) {   // these ops are on the sheet (or never will be): take them off the list
      var q = state.party.filter(function (x) { return x.link === id; })[0];
      if (q && q.owed) { q.owed = q.owed.filter(function (o) { return ops.indexOf(o) < 0; }); if (!q.owed.length) delete q.owed; }
      if (item) linkPC(item);
      save(); render();
    }
    if (!diff) { settled(null); return; }   // they changed nothing the Ref may save (Stamina already full, say)
    sh.sending = ops;
    window.CrowsCloud.api('POST', 'link.save', '', { id: id, fields: diff.fields, base: diff.base }).then(function (j) {
      sh.sending = null; sh.retryMs = 0;
      settled(j.item);
    }, function (e) {
      sh.sending = null;
      if (e.status === 409 && e.body && e.body.item) { linkPC(e.body.item); save(); render(); queueSave(id, 0); return; }   // the player saved first: redo on theirs
      if (e.status === 404 || e.status === 400 || e.status === 403 || e.status === 413) {
        toast((p.name || 'A crow') + ': ' + e.message);
        settled(null);
        if (e.status !== 404) refreshLinked(p, true);
        return;
      }
      sh.retryMs = Math.min(60000, sh.retryMs ? sh.retryMs * 2 : 4000);   // offline or a server hiccup: try again, slower each time
      queueSave(id, sh.retryMs);
    });
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
  /* The Party tab's Invite players card (the tab's badge and a toast flag new requests on any tab). Only with an account. */
  function renderInvite() {
    var box = $('sec-invite'), id = window.CrowsCloud && window.CrowsCloud.recordId, on = cloudOn();
    box.hidden = !on; box.innerHTML = '';
    if (!on) return;
    var head = el('h2', null, ['Invite players', inv.requests.length ? el('span', { class: 'badge', text: String(inv.requests.length), title: plural(inv.requests.length, 'request') + ' waiting' }) : null]);
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
   * A condensed view of every crow in play. A linked crow shows its sheet's vitals as this screen has it (refreshed a second
   * or two after the player changes something), and its buttons change that sheet (sheetOp): damage goes through worn armor
   * and parry weapons first, wounds fill backpack slots, and it's all in the sheet's log. Crows added by hand or from a file
   * get simple buttons for the numbers kept here.
   */
  function statusPCs() { return state.party.filter(function (p) { return p.status === 'active' || p.status === 'away'; }); }
  function statusHead(p) {
    return el('div', { class: 'st-head' }, [el('b', { class: 'grow', text: p.name || 'Unnamed crow' }),
      p.status === 'away' ? el('span', { class: 'chip', text: 'sitting out' }) : null,
      p.owner ? el('span', { class: 'fine', text: p.owner }) : null]);
  }
  function stamina(st, max, change, full) {
    return [el('div', { class: 'st-stam' }, [el('span', { class: 'lbl', text: 'Stamina' }), el('b', { text: st + ' / ' + max }),
        el('div', { class: 'meter' }, [el('span', { style: 'width:' + (max ? Math.round(st / max * 100) : 0) + '%' })])]),
      el('div', { class: 'row center' }, [btn('\u22125', function () { change(-5); }, 'btn-small'), btn('\u22121', function () { change(-1); }, 'btn-small'),
        btn('+1', function () { change(1); }, 'btn-small'), btn('+5', function () { change(5); }, 'btn-small'), btn('Full', full, 'btn-small btn-ghost')])];
  }
  function pm(what, change) { return [btn('\u2212', function () { change(-1); }, 'btn-small', 'Lower ' + what), btn('+', function () { change(1); }, 'btn-small', 'Raise ' + what)]; }
  function localTile(p) {
    function bump(k, n, lo, hi) { p[k] = Math.max(lo, Math.min(hi, (p[k] || 0) + n)); save(); render(); }
    var max = p.stMax || 0, st = Math.min(p.st || 0, max);
    return el('div', { class: 'st-tile local' }, [statusHead(p)].concat(
      stamina(st, max, function (n) { bump('st', n, 0, max); }, function () { p.st = max; save(); render(); }), [
      el('div', { class: 'st-nums' }, [
        el('span', { class: p.wounds >= 7 ? 'bad' : null }, ['Wounds ', el('b', { text: (p.wounds || 0) + '/10' })].concat(pm('wounds', function (n) { bump('wounds', n, 0, 10); }))),
        el('span', null, ['AD ', el('b', { text: String(p.ad || 0) })].concat(pm('AD', function (n) { bump('ad', n, 0, 99); }))),
        el('span', null, ['Cruelty ', el('b', { text: String(p.cruelty || 0) })].concat(pm('cruelty', function (n) { bump('cruelty', n, 0, 20); })))]),
      el('div', { class: 'fine', text: p.link ? 'Linked to ' + (p.owner || 'a player') + '\u2019s sheet: log in to see and change it live.' : 'Kept on this screen only. Link the player\u2019s sheet to see and change everything live.' })]));
  }
  /* A linked crow's tile, from its sheet (c). */
  function linkedTile(p, c) {
    var v = Sheet.vitals(c), who = p.owner ? p.owner + '\u2019s' : 'the player\u2019s';
    var h = (ui.stHit = ui.stHit || {})[p.link] || (ui.stHit[p.link] = { n: '', pierce: false });
    function op(o) {
      sheetOp(p, o);
      S().combat.list.forEach(function (x) { if (x.kind === 'pc' && x.pcId === p.id) pullVitals(x); });   // the tracker follows the sheet
      save(); render();
      return o;
    }
    function hit() {
      var n = parseInt(h.n, 10);
      if (!(n > 0)) { toast('Enter the damage first.'); return; }
      var o = op({ hit: n, piercing: !!h.pierce, from: '' });
      h.n = '';
      if (o.result) { log('', '**' + (p.name || 'A crow') + '** takes ' + o.result.total + (o.piercing ? ' piercing' : '') + ' damage on their sheet (' + o.result.parts.join(', ') + ').'); save(); render(); }
    }
    var amount = el('input', { type: 'number', min: 1, max: 99, class: 'in tiny', value: h.n, placeholder: 'dmg', 'aria-label': 'Damage to ' + (p.name || 'the crow'),
      oninput: function () { h.n = this.value; }, onkeydown: function (e) { if (e.key === 'Enter') hit(); } });
    var pierce = el('input', { type: 'checkbox', checked: !!h.pierce, onchange: function () { h.pierce = this.checked; } });
    var conds = REF.CONDITIONS.filter(function (k) { return Sheet.CONDITIONS.indexOf(k[0]) >= 0; });
    return el('div', { class: 'st-tile linked' }, [
      el('div', { class: 'row center' }, [statusHead(p), btn('Open sheet', function () { openSheet(p); }, 'btn-small btn-ghost', 'See the whole sheet'), takeBtn(p)])].concat(
      stamina(v.st, v.stMax, function (n) { op({ st: n }); }, function () { op({ full: true }); }), [
      el('div', { class: 'st-nums' }, [
        el('span', { class: v.wounds >= 7 ? 'bad' : null }, ['Wounds ', el('b', { text: v.wounds + '/10' })].concat(pm('wounds', function (n) { op({ wounds: n }); }))),
        el('span', { title: 'Worn armor and the parry weapons in hand. Repaired on a rest, or on the sheet.' }, ['AD ', el('b', { text: v.ad + '/' + v.adMax })]),
        el('span', null, ['Cruelty ', el('b', { text: String(v.cruelty || 0) })].concat(pm('cruelty', function (n) { op({ cruelty: n }); })))]),
      el('div', { class: 'row center st-dmg' }, [amount, el('label', { class: 'check' }, [pierce, 'Piercing']),
        btn('Deal damage', hit, 'btn-small btn-primary', 'Through worn armor and parry weapons first, then Stamina, then wounds, as on the sheet')]),
      el('div', { class: 'conds' }, conds.map(function (k) {
        var on = !!v.conds[k[0]];
        return el('button', { type: 'button', class: 'cond' + (on ? ' on' : ''), title: k[1], 'aria-pressed': on ? 'true' : 'false', text: k[0],
          onclick: function () { var o = { cond: {} }; o.cond[k[0]] = !on; op(o); } });
      })),
      el('div', { class: 'fine', text: (p.owed && p.owed.length ? 'Saving to ' : 'Changes save to ') + who + ' sheet.' })]));
  }
  function renderStatus() {
    var box = $('sec-status'), grid = el('div', { class: 'st-grid' }), pcs = statusPCs();
    pcs.forEach(function (p) {
      var c = sheetOf(p);
      if (c) grid.appendChild(linkedTile(p, c));
      else if (p.link && cloudOn()) grid.appendChild(el('div', { class: 'st-tile linked' }, [statusHead(p), el('p', { class: 'fine', text: 'Loading ' + (p.owner ? p.owner + '\u2019s' : 'the player\u2019s') + ' sheet\u2026' })]));
      else grid.appendChild(localTile(p));
    });
    card('sec-status', el('h2', null, ['Party status', el('small', { text: 'from the players\u2019 sheets' })]), [
      el('p', { class: 'hint', text: 'A linked crow shows its own sheet: the buttons change that sheet, and the player\u2019s changes show up here within a second or two. ' +
        'Damage goes through worn armor and parry weapons first, as on the sheet.' }),
      el('div', { class: 'row', style: 'margin-bottom:.6rem' }, [btn('Everyone to full Stamina', function () {
        activePCs().forEach(function (p) { sheetOp(p, { full: true }); });   // linked crows: on their sheets
        save(); render();
      }, 'btn-small btn-ghost', 'Every active crow back to full Stamina (linked crows on their own sheets)')]),
      pcs.length ? grid : el('p', { class: 'hint', text: 'No crows in play. Add some below.' })]);
    return box;
  }

  function renderParty() {
    renderStatus();
    renderInvite();
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
      addFromLink: addFromLink, refreshLinked: refreshLinked, unlinkPC: unlinkPC, applyOp: applyOp, sheetOf: sheetOf, prepared: prepared,
      applyToSheet: applyToSheet, replay: replay, fromSheet: fromSheet, sheetOp: sheetOp, queueSave: queueSave, sendSheet: sendSheet, openSheet: openSheet, takeControl: takeControl, takeBtn: takeBtn, newPC: newPC, loadInvites: loadInvites,
      answerRequest: answerRequest, setListing: setListing, listBox: listBox, renderInvite: renderInvite, statusPCs: statusPCs,
      statusHead: statusHead, stamina: stamina, pm: pm, localTile: localTile, linkedTile: linkedTile, renderStatus: renderStatus, renderParty: renderParty, allClaims: allClaims, claimOp: claimOp,
      claimsBox: claimsBox, pcHead: pcHead, pcCard: pcCard, sheets: sheets, PC_STATUSES: PC_STATUSES });
})();
