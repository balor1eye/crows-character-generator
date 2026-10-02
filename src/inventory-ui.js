/*
 * Character Generator: the one inventory component. Build's step 5 and Play's Items card both draw their slot grid (Hands,
 * Belt, Backpack), the Not carried tray, and the selected card's detail panel with invGrid(). Cards move by click (select a
 * card, click a slot) or by drag. See state.js.
 *
 * invGrid(host, o) fills `host` for o.mode, 'build' or 'play':
 *   redraw()        draw this component again (a card was selected or put down)
 *   after(msg)      the sheet changed (a move, a quantity): the page re-renders; Play also logs `msg`
 *   fallback        a drop onto a taken slot goes to the first free slot of that area (Play)
 *   badge(c)        extra text on a card's face, like "UD 2/3" (Play)
 *   controls(c)     buttons for the selected card, such as Use 1 or Roll UD (Play)
 *   ground, pickUp(g), cantPickUp(g), drop(cards)   the fight's On the ground zone (Play, in a fight; ground is null otherwise)
 */
(function () {
  'use strict';
  var A = window.CrowsGen, f = A.fwd;
  // From the other files (each call goes to the function there).
  var beltSize = f('beltSize'), cardById = f('cardById'), fits = f('fits'), item = f('item'), moveCard = f('moveCard'),
      moveToArea = f('moveToArea'), occupancy = f('occupancy'), refusal = f('refusal'), spanOf = f('spanOf'), toast = f('toast');
  var el = A.el, fmt = A.fmt;
  var state = A.state; A.share('state', function (v) { state = v; });

  var selected = { build: null, play: null }, redrawers = {}, dragId = null, dragGround = null;
  var ZONES = [['hand', 'Hands'], ['belt', 'Belt'], ['pack', 'Backpack'], ['none', 'Not carried']];
  var TIPS = {
    hand: 'Hands: what you wield or hold. One item per hand (no stacks); two-handed items take both. In a fight, getting an item into a hand takes Draw From Belt or Draw From Pack.',
    ground: 'On the ground in this fight: what anyone dropped, or the Ref put there. Drop what’s in your hands here (free). Picking something up is the Pick Up Item maneuver and needs a free hand: drag it into Hands.'
  };

  function clearSelection(mode) { if (mode) selected[mode] = null; else selected.build = selected.play = null; }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    Object.keys(selected).forEach(function (m) { if (selected[m] !== null && redrawers[m]) { selected[m] = null; redrawers[m](); } });
  });

  function slotLabel(word, num) {
    return el('span', { class: 's-lbl' }, [el('span', { class: 's-word', text: word + ' ' }), num]);
  }
  function whereText(c) {
    return c.area === 'none' ? 'not carried' : c.area === 'hand' ? 'hand ' + (c.idx + 1) : c.area === 'belt' ? 'belt ' + (c.idx + 1) : 'backpack ' + (c.idx + 1);
  }

  function invGrid(host, o) {
    var mode = o.mode;
    redrawers[mode] = o.redraw;
    var occ = occupancy(), sel = selected[mode] !== null ? cardById(selected[mode]) : null;
    if (!sel) selected[mode] = null;
    host.innerHTML = '';

    function select(c) { selected[mode] = selected[mode] === c.id ? null : c.id; o.redraw(); }
    function attemptMove(c, area, idx) {
      var ok = idx === undefined ? moveToArea(c, area) : moveCard(c, area, idx);
      if (!ok && idx !== undefined && o.fallback && area !== 'none') ok = moveToArea(c, area);
      if (ok) {
        selected[mode] = null;
        o.after(area === 'none' ? 'Set aside ' + c.key + '.' : 'Moved ' + c.key + ' to ' + (area === 'pack' ? 'backpack' : area) + '.');
      } else toast(refusal(c, area, idx));
    }
    function cardEl(c) {
      var it = item(c.key), meta = [], badge = o.badge ? o.badge(c) : '';
      if (it.st > 1) meta.push(c.qty + ' / ' + it.st);
      if (it.sl > 1) meta.push(it.sl + ' slots');
      if (it.hands === 2) meta.push('2 hands');
      if (badge) meta.push(badge);
      var n = el('div', { class: 'inv-card cat-' + it.cat + (selected[mode] === c.id ? ' sel' : ''), draggable: 'true', tabindex: '0', role: 'button', title: it.txt,
        'aria-label': c.key + (c.qty > 1 ? ' x' + c.qty : ''), 'data-id': c.id }, [
        el('span', { class: 'ic-name', text: c.key + (c.qty > 1 ? ' ×' + c.qty : '') }),
        meta.length ? el('span', { class: 'ic-meta', text: meta.join(' · ') }) : null,
        el('span', { class: 'ic-txt', text: it.txt })
      ]);
      n.addEventListener('click', function (e) { e.stopPropagation(); select(c); });
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.click(); } });
      n.addEventListener('dragstart', function (e) { dragId = c.id; try { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ } });
      n.addEventListener('dragend', function () { dragId = null; });
      return n;
    }
    function dropTarget(node, area, idx) {
      node.addEventListener('dragover', function (e) { if (dragId !== null || dragGround) { e.preventDefault(); node.classList.add('drop-ok'); } });
      node.addEventListener('dragleave', function () { node.classList.remove('drop-ok'); });
      node.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation(); node.classList.remove('drop-ok');
        var g = dragGround, c = cardById(dragId); dragGround = null; dragId = null;
        if (g) {   // an item from the ground: only into a hand (the Pick Up Item maneuver)
          if (area === 'hand') o.pickUp(g);
          else if (area !== 'ground') toast('Picking something up puts it in a free hand (Pick Up Item): drag it into Hands.');
          return;
        }
        if (!c) return;
        if (area === 'ground') { o.drop([c]); return; }
        attemptMove(c, area, area === 'none' ? 0 : idx);
      });
      node.addEventListener('click', function () {
        if (selected[mode] === null || area === 'ground') return;
        var c = cardById(selected[mode]);
        if (c) attemptMove(c, area, area === 'none' ? 0 : idx);
      });
    }

    // Hands, Belt, Backpack (two rows of five).
    var inv = el('div', { class: 'inventory' });
    function rowEl(label, area, count, cellsTotal, zone) {
      var box = el('div', { class: 'inv-zone zone-' + zone, title: TIPS[zone] || null }, [el('div', { class: 'inv-row-label', text: label })]);
      var row = el('div', { class: 'inv-row' }), i = 0, base = area === 'pack2' ? 5 : 0, realArea = area === 'pack2' ? 'pack' : area;
      while (i < cellsTotal) {
        var slotIdx = base + i;
        if (i >= count) {
          row.appendChild(el('div', { class: 'slot disabled', 'aria-hidden': 'true' }, [el('span', { class: 's-lbl', text: realArea === 'belt' ? 'Extra (trait)' : '' })]));
          i++; continue;
        }
        var cid = occ[realArea][slotIdx], c = cid !== null ? cardById(cid) : null;
        var word = realArea === 'hand' ? 'Hand' : realArea === 'belt' ? 'Belt' : 'Backpack';
        if (c && c.idx === slotIdx) {
          var sp = spanOf(c, realArea);
          var cell = el('div', { class: 'slot', style: sp > 1 ? 'grid-column: span ' + sp : null }, [slotLabel(word, (slotIdx + 1) + (sp > 1 ? '–' + (slotIdx + sp) : '')), cardEl(c)]);
          dropTarget(cell, realArea, slotIdx);
          row.appendChild(cell);
          i += sp;
        } else if (c) {
          i++;   // covered by a spanning card that started in the previous row (shouldn't happen)
        } else {
          var canHere = sel ? fits(sel.qty > 1 && realArea === 'hand' ? { id: -1, key: sel.key, qty: 1 } : sel, realArea, slotIdx, occ) : false;
          var empty = el('div', { class: 'slot empty' + (canHere ? ' target' : ''), tabindex: sel ? '0' : null, role: sel ? 'button' : null, 'aria-label': word + ' ' + (slotIdx + 1) + ' (empty)' },
            [slotLabel(word, String(slotIdx + 1))]);
          dropTarget(empty, realArea, slotIdx);
          empty.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); } });
          row.appendChild(empty);
          i++;
        }
      }
      box.appendChild(row);
      inv.appendChild(box);
    }
    rowEl('Hands (equipped, not stackable)', 'hand', 2, 5, 'hand');
    rowEl('Belt', 'belt', beltSize(), 5, 'belt');
    rowEl('Backpack', 'pack', 5, 5, 'pack');
    rowEl('', 'pack2', 5, 5, 'pack');
    host.appendChild(inv);

    // Not carried
    var loose = state.inv.filter(function (c) { return c.area === 'none'; });
    var tray = el('div', { class: 'tray' });
    if (!loose.length) tray.appendChild(el('span', { class: 'tray-empty', text: 'Nothing set aside.' }));
    loose.forEach(function (c) { tray.appendChild(cardEl(c)); });
    dropTarget(tray, 'none', 0);
    host.appendChild(el('div', { class: 'tray-wrap zone-none' }, [el('h3', {}, ['Not carried ', el('small', { text: '(drop here to set aside; left behind at home)' })]), tray]));

    // On the ground (a fight)
    if (o.ground) {
      var gt = el('div', { class: 'tray' });
      if (!o.ground.length) gt.appendChild(el('span', { class: 'tray-empty', text: 'Drag what’s in your hands here to drop it.' }));
      o.ground.forEach(function (g) {
        var it = item(g.key), why = o.cantPickUp(g);
        var gc = el('div', { class: 'inv-card ground cat-' + it.cat, draggable: 'true', title: g.key + (g.by ? '\nDropped by ' + g.by + '.' : '') + '\n' + (why || 'Drag it into Hands, or use Pick up (the Pick Up Item maneuver).'),
          ondragstart: function (e) { dragGround = g; try { e.dataTransfer.setData('text/plain', g.key); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* old browsers */ } },
          ondragend: function () { dragGround = null; } }, [
          el('span', { class: 'ic-name', text: g.key + (g.qty > 1 ? ' ×' + g.qty : '') }),
          g.by ? el('span', { class: 'ic-meta', text: 'dropped by ' + g.by }) : null,
          el('button', { type: 'button', class: 'btn btn-small', text: 'Pick up', disabled: why ? true : null, title: why || 'Pick Up Item (a maneuver): into a free hand', onclick: function () { o.pickUp(g); } })
        ]);
        gt.appendChild(gc);
      });
      dropTarget(gt, 'ground');
      host.appendChild(el('div', { class: 'tray-wrap zone-ground', title: TIPS.ground }, [el('h3', {}, ['On the ground ', el('small', { text: '(this fight)' })]), gt]));
    }

    // The selected card
    var det = el('div', { class: 'card-detail', hidden: sel ? null : true });
    if (sel) {
      var it = item(sel.key), btns = [];
      det.appendChild(el('h3', { text: sel.key }));
      det.appendChild(el('p', { text: it.txt }));
      det.appendChild(el('p', { class: 'fine', text: 'Stack ' + it.st + ' · ' + it.sl + ' slot' + (it.sl > 1 ? 's' : '') + (it.gc ? ' · ' + fmt(it.gc) + ' gc' : '') + ' · Now: ' + whereText(sel) +
        '. Click a highlighted slot to move it.' }));
      if (o.controls) btns = btns.concat(o.controls(sel));
      if (mode === 'build') {
        btns.push(el('button', { type: 'button', class: 'btn btn-small', text: '− 1', disabled: sel.qty <= 1, onclick: function () { sel.qty--; o.after(); } }));
        btns.push(el('span', { text: 'Qty ' + sel.qty }));
        btns.push(el('button', { type: 'button', class: 'btn btn-small', text: '+ 1', disabled: sel.qty >= it.st || sel.area === 'hand', onclick: function () { sel.qty++; o.after(); } }));
        btns.push(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Set aside', disabled: sel.area === 'none', onclick: function () { attemptMove(sel, 'none'); } }));
        btns.push(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Delete card', onclick: function () {
          state.inv = state.inv.filter(function (x) { return x !== sel; }); selected[mode] = null; o.after();
        } }));
      } else {
        var mv = el('select', { class: 'mini-sel', 'aria-label': 'Move ' + sel.key, title: 'Move ' + sel.key + ' to another area (it goes in the first free slot that fits)', onchange: function () {
          if (this.value === 'ground') { o.drop([sel]); return; }
          attemptMove(sel, this.value);
        } }, ZONES.concat(o.ground && sel.area === 'hand' ? [['ground', 'On the ground']] : []).map(function (z) {
          return el('option', { value: z[0], text: z[0] === sel.area ? z[1] : '→ ' + z[1] });
        }));
        mv.value = sel.area;
        btns.push(mv);
      }
      btns.push(el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: 'Done', onclick: function () { selected[mode] = null; o.redraw(); } }));
      det.appendChild(el('div', { class: 'row' }, btns));
    }
    host.appendChild(det);
  }

  A.add({ invGrid: invGrid, invClear: clearSelection, slotLabel: slotLabel });
})();
