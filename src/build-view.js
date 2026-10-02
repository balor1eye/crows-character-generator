/*
 * Character Generator: the Build page: each step’s card, the inventory slots (click or drag), the Crow summary, and the
 * page’s controls (bind). See state.js.
 */
(function () {
  'use strict';
  var A = window.CrowsGen, f = A.fwd;
  // From the other files (each call goes to the function there).
  var addItem = f('addItem'), adopt = f('adopt'), allocTotal = f('allocTotal'), armorInfo = f('armorInfo'), autoArrange = f('autoArrange'),
      beltSize = f('beltSize'), bg = f('bg'), canLearn = f('canLearn'), cardById = f('cardById'), characteristics = f('characteristics'),
      download = f('download'), expertiseUses = f('expertiseUses'), exportPdf = f('exportPdf'), exportState = f('exportState'),
      fileBase = f('fileBase'), findTrait = f('findTrait'), fits = f('fits'), freshState = f('freshState'), item = f('item'),
      moveCard = f('moveCard'), occupancy = f('occupancy'), ownedTraitIds = f('ownedTraitIds'), pruneTraits = f('pruneTraits'),
      randomCrow = f('randomCrow'), randomName = f('randomName'), refusal = f('refusal'), resetGear = f('resetGear'), rollCoins = f('rollCoins'),
      save = f('save'), setBackground = f('setBackground'), spanOf = f('spanOf'), staminaMax = f('staminaMax'),
      startingTraitId = f('startingTraitId'), startNew = f('startNew'), syncBonusArrays = f('syncBonusArrays'), toast = f('toast'),
      traitId = f('traitId'), traitXP = f('traitXP'), usePool = f('usePool'), validState = f('validState');
  var $ = A.$, d = A.d, DIE = A.DIE, el = A.el, fmt = A.fmt, maxUses = A.maxUses, pick = A.pick, TREE_BY_NAME = A.TREE_BY_NAME;
  var state = A.state; A.share('state', function (v) { state = v; });

  var selectedId = null;
  // ------------------------------------------------------------------ rendering
  function render() {
    syncBonusArrays();
    renderBackground();
    renderChars();
    renderIdentity();
    renderExpertise();
    renderTraits();
    renderInventory();
    renderVillage();
    renderAdvance();
    renderSummary();
    if (window.CrowsPlay) window.CrowsPlay.render();
    save();
  }

  function renderBackground() {
    var b = bg();
    $('bg-select').value = String(state.bg);
    $('bg-dice').innerHTML = state.bgDice ? 'Rolled <b>' + DIE[state.bgDice[0]] + ' ' + DIE[state.bgDice[1]] + '</b> (' + state.bgDice[0] + ', ' + state.bgDice[1] + ')' : '';
    var st = findTrait(b.trait[0], b.trait[1]);
    var gear = b.gear.map(function (g) { return g[0] + (g[1] > 1 ? ' (' + g[1] + ')' : ''); });
    if (b.pets) gear = gear.concat(b.pets.map(function (p) { return p + ' (pet)'; }));
    if (b.gc) gear.push(b.gc + ' extra gc');
    var box = $('bg-details');
    box.innerHTML = '';
    box.appendChild(el('p', { class: 'blurb', text: b.blurb }));
    var dl = el('dl');
    function row(k, v) { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
    row('Roll', b.d[0] + ', ' + b.d[1]);
    row('Characteristic at 2', b.two.length === 3 ? 'Any' : b.two.join(' or '));
    row('Stamina', String(b.stamina));
    row('Starting trait', b.trait[0] + ': ' + (st ? st.n : b.trait[1]));
    row('Expertises', Object.keys(b.exp).map(function (k) { return k + (b.exp[k] > 1 ? ' (' + b.exp[k] + ' uses)' : ''); }).join(', '));
    row('Equipment', gear.join(', '));
    box.appendChild(dl);
  }

  function renderChars() {
    var b = bg(), ch = characteristics();
    var sel = $('char-two'); sel.innerHTML = '';
    b.two.forEach(function (c) { sel.appendChild(el('option', { value: c, text: c })); });
    sel.value = ch.two; sel.disabled = b.two.length === 1;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pattern]'), function (r) { r.checked = r.value === state.pattern; });
    var hs = $('char-high'); hs.innerHTML = '';
    CROWS.CHARS.filter(function (c) { return c !== ch.two; }).forEach(function (c) {
      hs.appendChild(el('option', { value: c, text: c + (state.pattern === 'm12' ? ' (2, other gets -1)' : ' (1, other gets 0)') }));
    });
    hs.value = ch.high;
    var disp = $('char-display'); disp.innerHTML = '';
    CROWS.CHARS.forEach(function (c) {
      var v = ch.values[c], bonus = v - ch.base[c];
      disp.appendChild(el('div', { class: 'stat' + (c === ch.two ? ' two' : '') }, [
        el('div', { class: 'lbl', text: c + ' (' + CROWS.CHAR_ABBR[c] + ')' }),
        el('div', { class: 'val', text: String(v) }),
        bonus ? el('div', { class: 'lbl', text: '+' + bonus + ' from TXP' }) : null
      ]));
    });
  }

  function renderIdentity() {
    [['in-name', 'name'], ['in-player', 'player'], ['in-feature', 'feature']].forEach(function (p) {
      if (document.activeElement !== $(p[0])) $(p[0]).value = state[p[1]];
    });
  }

  function renderExpertise() {
    var uses = expertiseUses(), mx = maxUses(state.txp), pool = usePool(), used = allocTotal(), b = bg();
    var ds = $('derived-stats'); ds.innerHTML = '';
    var ai = armorInfo();
    [['Stamina', staminaMax()], ['Speed', CROWS.BASE_SPEED], ['Armor AD', ai.text], ['Max uses', mx]].forEach(function (p) {
      ds.appendChild(el('div', { class: 'stat' }, [el('div', { class: 'lbl', text: p[0] }), el('div', { class: 'val', text: String(p[1]) })]));
    });
    var ban = $('alloc-banner');
    if (pool > 0) {
      ban.hidden = false;
      ban.className = 'banner ' + (used === pool ? 'ok' : 'warn');
      ban.textContent = 'Advancement: ' + used + ' of ' + pool + ' bonus expertise uses assigned. Use + / - to assign them (max ' + mx + ' uses per expertise).';
    } else ban.hidden = true;
    var grid = $('exp-grid'); grid.innerHTML = '';
    Object.keys(CROWS.EXPERTISES).forEach(function (cat) {
      var col = el('div', { class: 'exp-col' }, [el('h3', { text: cat })]);
      CROWS.EXPERTISES[cat].forEach(function (e) {
        var n = e[0], u = uses[n] || 0, baseU = b.exp[n] || 0, extra = state.esAlloc[n] || 0;
        var pips = el('span', { class: 'pips', title: u + ' use' + (u === 1 ? '' : 's') });
        for (var i = 0; i < Math.max(u, 0); i++) pips.appendChild(el('span', { class: 'pip ' + (i < baseU ? 'on' : 'bonus') }));
        var kids = [el('span', { text: n, title: e[1] }), pips];
        if (pool > 0) {
          kids.push(el('span', { class: 'pips' }, [
            el('button', { type: 'button', class: 'pm', text: '−', 'aria-label': 'Remove a use of ' + n, disabled: extra <= 0, onclick: function () { state.esAlloc[n]--; if (!state.esAlloc[n]) delete state.esAlloc[n]; render(); } }),
            el('button', { type: 'button', class: 'pm', text: '+', 'aria-label': 'Add a use of ' + n, disabled: used >= pool || u >= mx, onclick: function () { state.esAlloc[n] = extra + 1; render(); } })
          ]));
        }
        col.appendChild(el('div', { class: 'exp-row ' + (u ? 'has' : 'none'), title: e[1] }, kids));
      });
      grid.appendChild(col);
    });
  }

  function traitCard(id, bought) {
    var p = id.split('|'), t = findTrait(p[0], p[1]);
    if (!t) return null;
    var head = el('div', { class: 't-head' }, [
      el('span', {}, [el('span', { class: 't-name', text: t.n }), ' ', el('span', { class: 't-tree', text: p[0] + (bought ? ' · ' + fmt(t.x) + ' XP' : ' · starting trait from background') })])
    ]);
    if (bought) head.appendChild(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Remove', onclick: function () {
      state.traits = state.traits.filter(function (x) { return x !== id; }); pruneTraits(); render();
    } }));
    return el('div', { class: 'trait' + (bought ? ' bought' : '') }, [head, el('p', { text: t.d })]);
  }

  function renderTraits() {
    var list = $('trait-list'); list.innerHTML = '';
    list.appendChild(traitCard(startingTraitId(), false));
    state.traits.forEach(function (id) { var c = traitCard(id, true); if (c) list.appendChild(c); });
    var unspent = state.txp - traitXP();
    $('xp-chip').textContent = fmt(Math.max(unspent, 0)) + ' XP unspent';
    var ts = $('tree-select');
    if (!ts.options.length) CROWS_TRAIT_TREES.forEach(function (t) { ts.appendChild(el('option', { value: t.tree, text: t.tree })); });
    if (!ts.value) ts.value = bg().trait[0];
    var tree = TREE_BY_NAME[ts.value];
    $('tree-sub').textContent = tree.sub;
    var grid = $('tree-grid'); grid.innerHTML = '';
    var owned = ownedTraitIds();
    var sorted = tree.traits.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    sorted.forEach(function (t) {
      var id = traitId(tree.tree, t.n), has = owned.indexOf(id) >= 0;
      var learnable = !has && canLearn(tree.tree, t, owned);
      var afford = unspent >= t.x;
      var btn = null;
      if (has) btn = el('span', { class: 'chip', text: id === startingTraitId() ? 'Starting trait' : 'Owned' });
      else btn = el('button', { type: 'button', class: 'btn btn-small', disabled: !(learnable && afford),
        title: !learnable ? 'Not connected to a trait you own' : !afford ? 'Not enough unspent XP' : 'Buy this trait',
        text: 'Buy (' + fmt(t.x) + ' XP)', onclick: function () { state.traits.push(id); render(); } });
      grid.appendChild(el('div', { class: 'tnode' + (has ? ' owned' : learnable ? '' : ' locked') }, [
        el('span', { class: 'n', text: t.n }),
        el('span', { class: 'c', text: fmt(t.x) + ' XP' + (t.r === 0 ? ' (starting)' : '') }),
        el('p', { text: t.d }), btn
      ]));
    });
  }

  // ---- inventory rendering + interaction
  var dragId = null;
  function cardEl(c) {
    var it = item(c.key);
    var meta = [];
    if (it.st > 1) meta.push(c.qty + ' / ' + it.st);
    if (it.sl > 1) meta.push(it.sl + ' slots');
    if (it.hands === 2) meta.push('2 hands');
    var n = el('div', { class: 'inv-card cat-' + it.cat + (selectedId === c.id ? ' sel' : ''), draggable: 'true', tabindex: '0', role: 'button',
      'aria-label': c.key + (c.qty > 1 ? ' x' + c.qty : ''), 'data-id': c.id }, [
      el('span', { class: 'ic-name', text: c.key + (c.qty > 1 ? ' ×' + c.qty : '') }),
      meta.length ? el('span', { class: 'ic-meta', text: meta.join(' · ') }) : null,
      el('span', { class: 'ic-txt', text: it.txt })
    ]);
    n.addEventListener('click', function (e) { e.stopPropagation(); selectedId = selectedId === c.id ? null : c.id; renderInventory(); });
    n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.click(); } });
    n.addEventListener('dragstart', function (e) { dragId = c.id; try { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ } });
    n.addEventListener('dragend', function () { dragId = null; });
    return n;
  }
  function dropTarget(node, area, idx) {
    node.addEventListener('dragover', function (e) { if (dragId !== null) { e.preventDefault(); node.classList.add('drop-ok'); } });
    node.addEventListener('dragleave', function () { node.classList.remove('drop-ok'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault(); node.classList.remove('drop-ok');
      var c = cardById(dragId); dragId = null;
      if (c) attemptMove(c, area, idx);
    });
    node.addEventListener('click', function () {
      if (selectedId === null) return;
      var c = cardById(selectedId);
      if (c) attemptMove(c, area, idx);
    });
  }
  function attemptMove(c, area, idx) {
    if (moveCard(c, area, idx)) { selectedId = null; render(); }
    else toast(refusal(c, area, idx));
  }

  function slotLabel(word, num) {
    return el('span', { class: 's-lbl' }, [el('span', { class: 's-word', text: word + ' ' }), num]);
  }
  function renderInventory() {
    var inv = $('inventory'); inv.innerHTML = '';
    var occ = occupancy();
    var sel = selectedId !== null ? cardById(selectedId) : null;
    function rowEl(label, area, count, cellsTotal) {
      inv.appendChild(el('div', { class: 'inv-row-label', text: label }));
      var row = el('div', { class: 'inv-row' });
      var i = 0;
      var base = area === 'pack2' ? 5 : 0;
      var realArea = area === 'pack2' ? 'pack' : area;
      while (i < cellsTotal) {
        var slotIdx = base + i;
        if (i >= count) {
          row.appendChild(el('div', { class: 'slot disabled', 'aria-hidden': 'true' }, [el('span', { class: 's-lbl', text: realArea === 'belt' ? 'Extra (trait)' : '' })]));
          i++; continue;
        }
        var cid = occ[realArea][slotIdx];
        var c = cid !== null ? cardById(cid) : null;
        var word = realArea === 'hand' ? 'Hand' : realArea === 'belt' ? 'Belt' : 'Backpack';
        var lbl = word + ' ' + (slotIdx + 1);
        if (c && c.idx === slotIdx) {
          var sp = spanOf(c, realArea);
          var cell = el('div', { class: 'slot', style: sp > 1 ? 'grid-column: span ' + sp : null }, [slotLabel(word, (slotIdx + 1) + (sp > 1 ? '\u2013' + (slotIdx + sp) : '')), cardEl(c)]);
          dropTarget(cell, realArea, slotIdx);
          row.appendChild(cell);
          i += sp;
        } else if (c) {
          i++; // covered by a spanning card that started in the previous row (shouldn't happen)
        } else {
          var canHere = sel ? fits(sel.qty > 1 && realArea === 'hand' ? { id: -1, key: sel.key, qty: 1 } : sel, realArea, slotIdx, occ) : false;
          var empty = el('div', { class: 'slot empty' + (canHere ? ' target' : ''), tabindex: sel ? '0' : null, role: sel ? 'button' : null, 'aria-label': lbl + ' (empty)' },
            [slotLabel(word, String(slotIdx + 1))]);
          dropTarget(empty, realArea, slotIdx);
          empty.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); } });
          row.appendChild(empty);
          i++;
        }
      }
      inv.appendChild(row);
    }
    rowEl('Hands (equipped, not stackable)', 'hand', 2, 5);
    rowEl('Belt', 'belt', beltSize(), 5);
    rowEl('Backpack', 'pack', 5, 5);
    rowEl('', 'pack2', 5, 5);

    var tray = $('tray'); tray.innerHTML = '';
    var loose = state.inv.filter(function (c) { return c.area === 'none'; });
    if (!loose.length) tray.appendChild(el('span', { class: 'tray-empty', text: 'Nothing set aside.' }));
    loose.forEach(function (c) { tray.appendChild(cardEl(c)); });
    if (!tray._wired) { dropTarget(tray, 'none', 0); tray._wired = true; }

    // warnings
    var warns = [];
    if (loose.length) warns.push(loose.length + ' item card' + (loose.length > 1 ? 's are' : ' is') + ' not carried. Only carried items go in the inventory on your sheet.');
    var ai = armorInfo();
    state.inv.forEach(function (c) { if (item(c.key).cat === 'armor' && c.area !== 'pack' && c.area !== 'none') warns.push(c.key + ' only protects you when worn from your backpack.'); });
    var coinCap = state.inv.filter(function (c) { return c.key === 'Coin Purse' && c.area !== 'none'; }).length * 500;
    if (state.coins > coinCap) warns.push('You carry ' + fmt(state.coins) + ' gc but your purses hold ' + fmt(coinCap) + '. Loose coins take a slot per 250.');
    var wb = $('inv-warnings'); wb.hidden = !warns.length; wb.textContent = warns.join(' ');
    void ai;

    // detail panel
    var det = $('card-detail');
    if (!sel) { det.hidden = true; }
    else {
      det.hidden = false; det.innerHTML = '';
      var it = item(sel.key);
      det.appendChild(el('h3', { text: sel.key }));
      det.appendChild(el('p', { text: it.txt }));
      det.appendChild(el('p', { class: 'fine', text: 'Stack ' + it.st + ' · ' + it.sl + ' slot' + (it.sl > 1 ? 's' : '') + (it.gc ? ' · ' + fmt(it.gc) + ' gc' : '') + ' · Now: ' +
        (sel.area === 'none' ? 'not carried' : sel.area === 'hand' ? 'hand ' + (sel.idx + 1) : sel.area === 'belt' ? 'belt ' + (sel.idx + 1) : 'backpack ' + (sel.idx + 1)) +
        '. Click a highlighted slot to move it.' }));
      var ctr = el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn btn-small', text: '− 1', disabled: sel.qty <= 1, onclick: function () { sel.qty--; render(); } }),
        el('span', { text: 'Qty ' + sel.qty }),
        el('button', { type: 'button', class: 'btn btn-small', text: '+ 1', disabled: sel.qty >= it.st || sel.area === 'hand', onclick: function () { sel.qty++; render(); } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Set aside', disabled: sel.area === 'none', onclick: function () { moveCard(sel, 'none', 0); render(); } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Delete card', onclick: function () {
          state.inv = state.inv.filter(function (x) { return x !== sel; }); selectedId = null; render();
        } }),
        el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Done', onclick: function () { selectedId = null; renderInventory(); } })
      ]);
      det.appendChild(ctr);
    }

    // pets
    var pets = $('pets'); pets.innerHTML = '';
    if (state.pets.length) {
      pets.appendChild(el('h3', { text: 'Pets' }));
      state.pets.forEach(function (p) { pets.appendChild(el('div', { class: 'pet', text: CROWS.PETS[p] || p })); });
    }
    if (document.activeElement !== $('in-coins')) $('in-coins').value = state.coins;
    $('coin-dice').innerHTML = state.coinDice ? '<b>' + state.coinDice.map(function (x) { return DIE[x]; }).join(' ') + '</b> = ' + (state.coinDice[0] + state.coinDice[1] + state.coinDice[2]) + (bg().gc ? ' + ' + bg().gc : '') : '';
  }

  function renderVillage() {
    [['in-village', 'village'], ['in-conn-name', 'connName'], ['in-conn-rel', 'connRel'], ['in-notes', 'notes']].forEach(function (p) {
      if (document.activeElement !== $(p[0])) $(p[0]).value = state[p[1]];
    });
    $('in-institution').value = state.institution;
    if (document.activeElement !== $('in-prosperity')) $('in-prosperity').value = state.prosperity;
    $('in-conn-benefit').value = state.connBenefit;
    var b = CROWS.CONNECTION_BENEFITS.filter(function (x) { return x[0] === state.connBenefit; })[0];
    $('conn-benefit-text').textContent = b ? b[1] : '';
  }

  function renderAdvance() {
    if (document.activeElement !== $('in-txp')) $('in-txp').value = state.txp;
    var spent = traitXP(), unspent = state.txp - spent;
    $('xp-summary').innerHTML = 'Traits bought: <b>' + fmt(spent) + ' XP</b> · Unspent: <b style="color:' + (unspent < 0 ? 'var(--bad)' : 'inherit') + '">' + fmt(unspent) + ' XP</b> · Max uses per expertise: <b>' + maxUses(state.txp) + '</b>';
    var list = $('bonus-list'); list.innerHTML = '';
    state.esBonus.forEach(function (o, i) {
      var s = el('select', { 'aria-label': 'Expertise and Stamina bonus ' + (i + 1), onchange: function () { state.esBonus[i] = this.value; render(); } }, [
        el('option', { value: 'uses', text: '+3 expertise uses' }),
        el('option', { value: 'stamina', text: '+2 Stamina maximum' }),
        el('option', { value: 'mix', text: '+1 expertise use and +1 Stamina' })
      ]);
      s.value = o;
      list.appendChild(el('div', { class: 'bonus' }, [el('b', { text: ordinal(i + 1) + ' Expertise & Stamina bonus' }), s]));
    });
    state.charBonus.forEach(function (o, i) {
      var s = el('select', { 'aria-label': 'Characteristic bonus ' + (i + 1), onchange: function () { state.charBonus[i] = this.value; render(); } },
        [el('option', { value: '', text: 'Choose a characteristic (+1, max 4)' })].concat(CROWS.CHARS.map(function (c) { return el('option', { value: c, text: c + ' +1' }); })));
      s.value = o;
      list.appendChild(el('div', { class: 'bonus' }, [el('b', { text: ordinal(i + 1) + ' Characteristic bonus' }), s]));
    });
    if (!state.esBonus.length && !state.charBonus.length) list.appendChild(el('p', { class: 'hint', text: 'No bonuses yet. The first Expertise & Stamina bonus arrives at 100 TXP; the first characteristic bonus at 5,000 TXP.' }));
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function checklist() {
    var items = [];
    items.push([state.name.trim() ? 'ok' : 'todo', state.name.trim() ? 'Named' : 'Give your crow a name']);
    items.push([state.feature.trim() ? 'ok' : 'todo', state.feature.trim() ? 'Distinguishing feature' : 'Pick a distinguishing feature']);
    items.push([state.connName.trim() && state.connBenefit ? 'ok' : 'todo', state.connName.trim() && state.connBenefit ? 'NPC connection' : 'Make an NPC connection and pick a benefit']);
    var loose = state.inv.filter(function (c) { return c.area === 'none'; }).length;
    items.push([loose ? 'todo' : 'ok', loose ? loose + ' item(s) not carried' : 'All gear carried']);
    var pool = usePool(), used = allocTotal();
    if (pool) items.push([used === pool ? 'ok' : 'err', used === pool ? 'Bonus expertise uses assigned' : 'Assign ' + (pool - used) + ' more bonus expertise use(s)']);
    if (state.charBonus.some(function (c) { return !c; })) items.push(['err', 'Choose characteristic bonus(es)']);
    if (state.txp - traitXP() < 0) items.push(['err', 'Traits cost more XP than you have']);
    return items;
  }

  function renderSummary() {
    var ch = characteristics().values, ai = armorInfo();
    var body = $('summary-body'); body.innerHTML = '';
    body.appendChild(el('div', { class: 'sum-name', text: state.name || 'Unnamed crow' }));
    body.appendChild(el('div', { class: 'sum-bg', text: bg().name + (state.feature ? ' · ' + state.feature : '') }));
    var g = el('div', { class: 'sum-stats' });
    CROWS.CHARS.forEach(function (c) { g.appendChild(el('div', {}, [el('b', { text: String(ch[c]) }), el('span', { text: c })])); });
    [['Stamina', staminaMax()], ['Speed', CROWS.BASE_SPEED], ['AD', ai.total]].forEach(function (p) {
      g.appendChild(el('div', {}, [el('b', { text: String(p[1]) }), el('span', { text: p[0] })]));
    });
    body.appendChild(g);
    var inHands = state.inv.filter(function (c) { return c.area === 'hand'; }).map(function (c) { return c.key + (c.thrown ? ' (thrown)' : ''); });
    body.appendChild(el('div', { class: 'fine', text: 'Hands: ' + (inHands.join(', ') || 'empty') + ' · ' + fmt(state.coins) + ' gc' }));
    var cl = $('checklist'); cl.innerHTML = '';
    checklist().forEach(function (c) { cl.appendChild(el('div', { class: c[0], text: c[1] })); });
  }

  // ------------------------------------------------------------------ wiring
  function bind() {
    var bs = $('bg-select');
    CROWS.BACKGROUNDS.forEach(function (b, i) { bs.appendChild(el('option', { value: String(i), text: b.d[0] + '-' + b.d[1] + '  ' + b.name })); });
    bs.addEventListener('change', function () { state.bgDice = null; setBackground(+this.value, true); render(); });
    $('btn-roll-bg').addEventListener('click', function () {
      var r1 = d(6), r2 = d(6);
      var i = CROWS.BACKGROUNDS.findIndex(function (b) { return b.d[0] === r1 && b.d[1] === r2; });
      state.bgDice = [r1, r2]; setBackground(i, true); render();
      toast('Rolled ' + r1 + ', ' + r2 + ': ' + bg().name);
    });
    $('char-two').addEventListener('change', function () {
      state.twoChar = this.value;
      var others = CROWS.CHARS.filter(function (c) { return c !== state.twoChar; });
      if (others.indexOf(state.highChar) < 0) state.highChar = others[0];
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pattern]'), function (r) {
      r.addEventListener('change', function () { state.pattern = this.value; render(); });
    });
    $('char-high').addEventListener('change', function () { state.highChar = this.value; render(); });

    function text(id, key) { $(id).addEventListener('input', function () { state[key] = this.value; renderSummary(); save(); }); }
    text('in-name', 'name'); text('in-player', 'player'); text('in-feature', 'feature'); text('in-village', 'village');
    text('in-conn-name', 'connName'); text('in-conn-rel', 'connRel'); text('in-notes', 'notes');
    $('btn-rand-name').addEventListener('click', function () { state.name = randomName(); render(); });
    $('btn-rand-feature').addEventListener('click', function () { state.feature = pick(CROWS.NAME_IDEAS.feature); render(); });

    $('in-coins').addEventListener('input', function () { var n = parseInt(this.value, 10); state.coins = isNaN(n) || n < 0 ? 0 : n; state.coinDice = null; renderSummary(); save(); });
    $('in-coins').addEventListener('change', function () { renderInventory(); });
    $('btn-roll-coins').addEventListener('click', function () { rollCoins(); render(); });
    $('btn-arrange').addEventListener('click', function () { selectedId = null; autoArrange(); render(); toast('Inventory arranged.'); });
    $('btn-reset-gear').addEventListener('click', function () {
      if (!confirm('Replace your inventory with the starting gear for ' + bg().name + '?')) return;
      selectedId = null; resetGear(); render();
    });
    var ai = $('add-item-select');
    var groups = { weapon: 'Weapons', ammo: 'Weapons', armor: 'Armor', shield: 'Armor', consumable: 'Alchemy', spell: 'Spellbooks', magic: 'Magic items' };
    var byGroup = {};
    Object.keys(CROWS.ITEMS).sort().forEach(function (k) { var g = groups[item(k).cat] || 'Gear'; (byGroup[g] = byGroup[g] || []).push(k); });
    ['Weapons', 'Armor', 'Gear', 'Alchemy', 'Spellbooks', 'Magic items'].forEach(function (g) {
      var og = el('optgroup', { label: g });
      (byGroup[g] || []).forEach(function (k) { og.appendChild(el('option', { value: k, text: k + (item(k).gc ? ' (' + fmt(item(k).gc) + ' gc)' : '') })); });
      ai.appendChild(og);
    });
    $('btn-add-item').addEventListener('click', function () {
      var key = ai.value, all = addItem(key, Math.max(1, Math.min(99, parseInt($('add-item-qty').value, 10) || 1)));
      render();
      toast(all ? 'Added ' + key + '.' : 'Added ' + key + ' (no room for all of it; see "Not carried").');
    });

    var inst = $('in-institution');
    inst.appendChild(el('option', { value: '', text: '(not chosen yet)' }));
    CROWS.STARTING_INSTITUTIONS.forEach(function (n) { inst.appendChild(el('option', { value: n, text: n })); });
    inst.addEventListener('change', function () { state.institution = this.value; save(); });
    $('in-prosperity').addEventListener('change', function () {
      var n = parseInt(this.value, 10); state.prosperity = isNaN(n) ? 0 : Math.max(-10, Math.min(10, n)); render();
    });
    var cb = $('in-conn-benefit');
    cb.appendChild(el('option', { value: '', text: '(choose a benefit)' }));
    CROWS.CONNECTION_BENEFITS.forEach(function (b) { cb.appendChild(el('option', { value: b[0], text: b[0] })); });
    cb.addEventListener('change', function () { state.connBenefit = this.value; render(); });

    $('in-txp').addEventListener('change', function () {
      var n = parseInt(this.value, 10); state.txp = isNaN(n) || n < 0 ? 0 : Math.min(n, 999999); render();
    });
    $('tree-select').addEventListener('change', function () { renderTraits(); });

    $('btn-random').addEventListener('click', function () { startNew(); selectedId = null; randomCrow(); render(); toast('A new crow: ' + state.name + ', ' + bg().name + '.'); });
    $('btn-new').addEventListener('click', function () {
      if (!confirm('Start a new character? Unsaved changes to this one will be lost.')) return;
      startNew(); selectedId = null; A.set('state', freshState(0)); resetGear(); rollCoins(); render();
    });
    $('btn-save').addEventListener('click', function () {
      download(JSON.stringify(exportState(), null, 2), fileBase() + '_Crows_Character.json', 'application/json');
    });
    $('file-load').addEventListener('change', function () {
      var f = this.files && this.files[0]; var input = this;
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (!validState(s)) throw new Error('not a Crows character file');
          startNew(); selectedId = null; adopt(s); render(); toast('Loaded ' + (state.name || 'character') + '.');
        } catch (e) { toast('Could not load that file: ' + e.message); }
        input.value = '';
      };
      rd.readAsText(f);
    });
    $('btn-pdf').addEventListener('click', function () { exportPdf(this); });
    $('btn-pdf-2').addEventListener('click', function () { exportPdf(this); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedId !== null) { selectedId = null; renderInventory(); } });
  }
  function clearSelection() { selectedId = null; }

  A.add({ render: render, renderBackground: renderBackground, renderChars: renderChars, renderIdentity: renderIdentity,
      renderExpertise: renderExpertise, traitCard: traitCard, renderTraits: renderTraits, cardEl: cardEl, dropTarget: dropTarget,
      attemptMove: attemptMove, slotLabel: slotLabel, renderInventory: renderInventory, renderVillage: renderVillage, renderAdvance: renderAdvance,
      ordinal: ordinal, checklist: checklist, renderSummary: renderSummary, bind: bind, clearSelection: clearSelection });
})();
