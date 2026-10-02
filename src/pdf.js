/*
 * Character Generator: the fillable PDF (character record, inventory sheet, cheat sheet), built in the browser with pdf-lib.
 * See state.js.
 */
(function () {
  'use strict';
  var A = window.CrowsGen, f = A.fwd;
  // From the other files (each call goes to the function there).
  var adMax = f('adMax'), adNow = f('adNow'), armorInfo = f('armorInfo'), beltSize = f('beltSize'), bg = f('bg'),
      characteristics = f('characteristics'), curStamina = f('curStamina'), expertiseUses = f('expertiseUses'), findTrait = f('findTrait'),
      item = f('item'), ownedTraitIds = f('ownedTraitIds'), spanOf = f('spanOf'), staminaMax = f('staminaMax'), toast = f('toast'),
      traitXP = f('traitXP');
  var $ = A.$, d = A.d, el = A.el, fmt = A.fmt, maxUses = A.maxUses;
  var state = A.state; A.share('state', function (v) { state = v; });

  // ------------------------------------------------------------------ PDF export
  var WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function pdfSafe(s) {
    return String(s || '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/●/g, '•').replace(/−/g, '-')
      .replace(/\r\n?/g, '\n').replace(/[^\n\x20-\x7e\xa0-\xff]/g, function (c) { return WINANSI_EXTRA.indexOf(c) >= 0 ? c : '?'; });
  }
  function wrapLines(text, font, size, width) {
    var out = [];
    text.split('\n').forEach(function (para) {
      var words = para.split(' '), line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }
  function fitSize(text, font, w, h, maxSize, minSize) {
    for (var s = maxSize; s >= minSize; s -= 0.25) {
      var lines = wrapLines(text, font, s, w - 4);
      var tooWide = lines.some(function (l) { return font.widthOfTextAtSize(l, s) > w - 4; });
      if (!tooWide && lines.length * s * 1.16 <= h - 3) return s;
    }
    return minSize;
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function slotText(c, cont) {
    var it = item(c.key);
    if (cont) return '(' + c.key + ', continued)';
    var head = c.key.toUpperCase() + (c.qty > 1 ? '  x' + c.qty : '');
    var meta = 'Stack ' + it.st + (it.sl > 1 ? ' | ' + it.sl + ' slots' : '') + (it.gc ? ' | ' + fmt(it.gc) + ' gc' : '');
    return head + '\n' + meta + '\n' + it.txt;
  }
  function fieldValues() {
    var v = {}, ch = characteristics().values, uses = expertiseUses(), ai = armorInfo(), b = bg();
    v['Name'] = state.name; v['Background'] = b.name; v['Player'] = state.player; v['Feature'] = state.feature;
    v['Village'] = state.village;
    CROWS.CHARS.forEach(function (c) { v[c] = String(ch[c]); });
    var pl = state.play;
    v['Stamina Max'] = String(staminaMax()); v['Stamina Current'] = String(curStamina());
    v['Speed'] = String(CROWS.BASE_SPEED);
    var adParts = [ai.worn, ai.shield].filter(Boolean).map(function (c) { return adNow(c) + (c.dmg ? '/' + adMax(c) : '') + ' ' + (c === ai.shield ? 'shield' : c.key.replace(' Armor', '').toLowerCase()); });
    var adTotal = [ai.worn, ai.shield].filter(Boolean).reduce(function (s, c) { return s + adNow(c); }, 0);
    v['Armor AD'] = adParts.length ? adTotal + (adParts.length > 1 || adTotal !== ai.total ? '\n(' + adParts.join(' + ') + ')' : '') : '0';
    v['Coins'] = String(state.coins); v['Cruelty'] = String(pl.cruelty);
    Object.keys(pl.conds).forEach(function (k) { if (pl.conds[k]) v['Cond ' + k] = true; });
    Object.keys(uses).forEach(function (k) { if (uses[k]) v['Exp ' + k] = String(uses[k]); });
    Object.keys(pl.spent).forEach(function (k) { for (var i = 1; i <= pl.spent[k]; i++) v['Exp ' + k + ' Spent ' + i] = true; });
    Object.keys(pl.wounds).forEach(function (i) { v['Wound ' + (+i + 1)] = true; });
    Object.keys(pl.magic).forEach(function (k) { if (pl.magic[k]) v['Slot ' + k] = pl.magic[k]; });
    Object.keys(pl.magicMulti || {}).forEach(function (k) {
      if (pl.magicMulti[k]) v['Slot ' + k] = (v['Slot ' + k] ? v['Slot ' + k] + ' ' : '') + '[2+ items: no rest, 1d6 wounds/DT]';
    });
    v['Max Uses'] = String(maxUses(state.txp));
    var spent = traitXP();
    v['TXP'] = fmt(state.txp); v['XP Spent'] = fmt(spent); v['XP Unspent'] = fmt(state.txp - spent);
    var esLabels = { uses: '+3 uses', stamina: '+2 Stamina', mix: '+1 use/+1 Stamina' };
    v['ES Bonuses'] = state.esBonus.length ? state.esBonus.length + ' taken' : '0';
    v['Char Bonuses'] = state.charBonus.length ? state.charBonus.filter(Boolean).map(function (c) { return CROWS.CHAR_ABBR[c] + '+1'; }).join(', ') : '0';
    var traits = ownedTraitIds().map(function (id, i) {
      var p = id.split('|'), t = findTrait(p[0], p[1]);
      return t ? t.n + ' (' + p[0] + (i === 0 ? ', background' : ', ' + fmt(t.x) + ' XP') + '): ' + t.d : id;
    });
    v['Traits'] = traits.join('\n');
    var pets = state.pets.map(function (p, i) {
      var st = pl.petStam[i];
      return (CROWS.PETS[p] || p) + (typeof st === 'number' ? ' [Stamina now ' + st + ']' : '');
    });
    v['Pets'] = pets.join('\n') || '';
    v['Connection Name'] = state.connName; v['Connection Relationship'] = state.connRel;
    var ben = CROWS.CONNECTION_BENEFITS.filter(function (x) { return x[0] === state.connBenefit; })[0];
    v['Connection Benefit'] = ben ? ben[0] + ': ' + ben[1] : '';
    var notes = [];
    if (state.notes.trim()) notes.push(state.notes.trim());
    var inst = ['Blacksmith', 'Crypt', 'General Store', 'Inn', 'Temple'].concat(state.institution ? [state.institution] : []);
    notes.push('Village institutions (1st level): ' + inst.join(', ') + '. Prosperity ' + state.prosperity + '.');
    if (pl.pendingXP) notes.push('XP awaiting a rest: ' + fmt(pl.pendingXP) + '.');
    if (state.esBonus.length) notes.push('E&S bonuses: ' + state.esBonus.map(function (o) { return esLabels[o]; }).join('; ') + '.');
    var loose = state.inv.filter(function (c) { return c.area === 'none'; });
    if (loose.length) notes.push('Left at home: ' + loose.map(function (c) { return c.key + (c.qty > 1 ? ' x' + c.qty : ''); }).join(', ') + '.');
    v['Notes'] = notes.join('\n');
    // Inventory
    var names = { hand: 'Hand ', belt: 'Belt ', pack: 'Backpack ' };
    state.inv.forEach(function (c) {
      if (c.area === 'none') return;
      var s = spanOf(c, c.area);
      for (var k = 0; k < s; k++) {
        var i = c.idx + k, fname = c.area === 'belt' && i >= 4 ? 'Belt Extra' : names[c.area] + (i + 1);
        v[fname] = slotText(c, k > 0);
      }
    });
    if (beltSize() > 4 && !v['Belt Extra']) {
      var tname = ownedTraitIds().map(function (id) { return id.split('|')[1]; }).filter(function (n) { return CROWS.EXTRA_BELT_TRAITS[n]; })[0];
      v['Belt Extra'] = 'Extra belt slot (' + tname + ': ' + CROWS.EXTRA_BELT_TRAITS[tname] + ')';
    }
    return v;
  }

  function buildPdf() {
    var P = window.PDFLib;
    return P.PDFDocument.load(b64ToBytes(CROWS_TEMPLATE_B64)).then(function (doc) {
      return doc.embedFont(P.StandardFonts.Helvetica).then(function (font) {
        var form = doc.getForm(), pages = doc.getPages(), vals = fieldValues(), mx = maxUses(state.txp), uses = expertiseUses();
        CROWS_FIELDS.forEach(function (f) {
          var page = pages[f.page], ph = page.getHeight();
          var rect = { x: f.x, y: ph - f.y - f.h, width: f.w, height: f.h, borderWidth: 0, borderColor: undefined, backgroundColor: undefined };
          if (f.kind === 'check') {
            // one spent-use box per use (capped at max uses); 1 box on unowned expertises a lore book can grant
            var spent = /^Exp (.+) Spent (\d+)$/.exec(f.name);
            if (spent) {
              var n = uses[spent[1]] ? Math.min(uses[spent[1]], mx) : (CROWS.ITEMS['Lore Book (' + spent[1] + ')'] ? 1 : 0);
              if (+spent[2] > n) return;
            }
            var cb = form.createCheckBox(f.name);
            cb.addToPage(page, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderWidth: 0.75, borderColor: P.rgb(0.12, 0.11, 0.12), backgroundColor: P.rgb(1, 1, 1) });
            if (vals[f.name] === true) cb.check();
            return;
          }
          var tf = form.createTextField(f.name);
          var text = pdfSafe(vals[f.name] || '');
          if (f.multiline) tf.enableMultiline();
          if (f.align === 'center') tf.setAlignment(P.TextAlignment.Center);
          tf.setText(text);
          var size = f.size || 8;
          if (f.multiline) size = text ? fitSize(text, font, f.w, f.h, f.size || (f.page === 1 ? 9.5 : 9), 4.5) : (f.size || 8);
          else if (text) {
            while (size > 5 && font.widthOfTextAtSize(text, size) > f.w - 4) size -= 0.5;
          }
          tf.addToPage(page, rect);
          tf.setFontSize(size);
        });
        form.updateFieldAppearances(font);
        doc.setTitle((state.name || 'Crow') + ' - Crows Character Sheet');
        doc.setSubject('Crows Playtest 2 character: ' + bg().name);
        doc.setCreator('The Nest (Crows Playtest 2 character generator)');
        return doc.save();
      });
    });
  }
  function download(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, filename); return; }
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  function fileBase() { return (state.name || 'crow').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'crow'; }
  function exportPdf(btn) {
    if (!window.PDFLib) { toast('PDF library failed to load.'); return; }
    var old = btn.textContent; btn.disabled = true; btn.textContent = 'Building PDF...';
    buildPdf().then(function (bytes) {
      download(bytes, fileBase() + '_Crows_Character.pdf', 'application/pdf');
      toast('PDF downloaded.');
    }).catch(function (e) {
      console.error(e); toast('Could not build the PDF: ' + (e && e.message ? e.message : e));
    }).then(function () { btn.disabled = false; btn.textContent = old; });
  }

  A.add({ pdfSafe: pdfSafe, wrapLines: wrapLines, fitSize: fitSize, b64ToBytes: b64ToBytes, slotText: slotText, fieldValues: fieldValues,
      buildPdf: buildPdf, download: download, fileBase: fileBase, exportPdf: exportPdf, WINANSI_EXTRA: WINANSI_EXTRA });
})();
