/*
 * The AI key vault's crypto (ref/src/ref-ai.js), run with node >= 19:  node ref/test/test_ai_vault.js
 * Round trip, the vault string's shape (api.php vault.save), wrong passphrase, wrong AAD (another account), tampering, and a fresh salt/IV each time.
 */
var assert = require('assert');
if (!globalThis.crypto || !globalThis.crypto.subtle) { console.log('SKIP: no globalThis.crypto.subtle (needs node >= 19)'); process.exit(0); }
var V = require('../src/ref-ai.js');
var steps = 0;
function ok(c, what) { assert.ok(c, what); steps++; console.log('ok - ' + what); }
function rejects(p, what) { return p.then(function () { throw new Error('should have failed: ' + what); }, function () { ok(true, what); }); }

var payload = { key: 'sk-ant-api03-EXAMPLEEXAMPLE-wxyz', model: 'claude-sonnet-5-5', at: 1 }, pass = 'correct horse battery staple', user = 'test_ref';
V.seal(payload, pass, user, 'wxyz').then(function (s) {
  var o = JSON.parse(s.vault);
  ok(Object.keys(o).sort().join() === 'ct,hint,iter,iv,kdf,salt,v', 'vault has exactly v, kdf, iter, salt, iv, ct, hint');
  ok(o.v === 1 && o.kdf === 'PBKDF2-SHA256' && o.iter === 600000 && o.hint === 'wxyz', 'v=1, PBKDF2-SHA256, 600000 rounds, hint kept');
  ok(Buffer.from(o.salt, 'base64').length === 16 && Buffer.from(o.iv, 'base64').length === 12, 'salt 16 bytes, iv 12 bytes');
  ok(Buffer.from(o.ct, 'base64').length <= 4096 && s.vault.length < 8192, 'ct and whole vault within the server limits');
  ok(V.parse(s.vault) !== null, 'parse accepts it (the server-side shape check)');
  ok(s.vault.indexOf('EXAMPLE') < 0 && s.vault.indexOf(payload.key) < 0, 'the plaintext key is not in the vault string');
  ok(V.parse(JSON.stringify(Object.assign({}, o, { extra: 1 }))) === null && V.parse(JSON.stringify(Object.assign({}, o, { iter: 1000 }))) === null && V.parse('nope') === null, 'parse refuses extra keys, low iterations, and junk');
  return V.open(s.vault, pass, user).then(function (r) {
    ok(JSON.stringify(r.payload) === JSON.stringify(payload), 'right passphrase decrypts to the same payload');
    return Promise.all([
      rejects(V.open(s.vault, 'wrong passphrase here', user), 'wrong passphrase fails'),
      rejects(V.open(s.vault, pass, 'someone_else'), 'wrong AAD (another username) fails'),
      rejects(V.open(s.vault, pass, 'local'), 'wrong AAD ("local" for an account vault) fails'),
      rejects(V.open(JSON.stringify(Object.assign({}, o, { ct: o.ct.slice(0, -6) + (o.ct.slice(-6) === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA') })), pass, user), 'a tampered ciphertext fails')
    ]).then(function () {
      // re-seal with the derived key (a new IV), as the model change does
      return V.sealWith(r.cryptoKey, r.salt, r.iter, { key: payload.key, model: 'claude-opus-5-5', at: 2 }, user, 'wxyz').then(function (v2) {
        ok(JSON.parse(v2).iv !== o.iv && JSON.parse(v2).salt === o.salt, 'sealWith uses a fresh IV and keeps the salt');
        return V.open(v2, pass, user).then(function (r2) { ok(r2.payload.model === 'claude-opus-5-5', 'the re-sealed vault opens with the same passphrase'); });
      });
    });
  }).then(function () {
    return V.seal(payload, pass, user, 'wxyz').then(function (s2) { ok(JSON.parse(s2.vault).salt !== o.salt && JSON.parse(s2.vault).iv !== o.iv && JSON.parse(s2.vault).ct !== o.ct, 'a new seal has a new salt, IV, and ciphertext'); });
  });
}).then(function () {
  ok(V.strength('short').ok === false && V.strength('twelve chars').ok === true && V.strength('aaaaaaaaaaaaaaaa').ok === false, 'passphrase strength hint');
  // the scan payload: same schema/prompt rules as api.php
  var d = V.detectPayload({ image: 'AAAA', mime: 'image/png', kind: 'dungeon', hasLabels: true, cols: 30, rows: 20, title: 'Crypt', envKeys: [['dark', 'Darkness'], ['bad key!', 'x']] }, 'claude-sonnet-5-5');
  ok(d.payload.tool_choice.type === 'auto' && d.payload.tools[0].name === 'report_objects' && Object.keys(d.envKeys).join() === 'dark', 'detect payload: auto tool choice, env keys filtered');
  var r = V.detectResult({ content: [{ type: 'tool_use', name: 'report_objects', input: { objects: [
    { name: '  Pillar  ', type: 'pillar', x: 0.5, y: 2, w: 0, h: 0.1 }, { name: '', type: 'pillar', x: .1, y: .1 }, { name: 'Odd', type: 'chest', x: .2, y: .2, light: true }, { name: 'NoPos', type: 'statue' }],
    walls: [{ x1: 0, y1: 0, x2: .5, y2: 0 }, { x1: .2, y1: .2, x2: .2, y2: .2 }, { x1: .4, y1: .1, x2: .4, y2: 1.5, door: true }, { x1: .1, y1: .1, x2: 'x', y2: .3 }], env: ['dark', 'nope', 'dark'] } }] }, d.envKeys, 'm');
  ok(r.objects.length === 2 && r.objects[0].name === 'Pillar' && r.objects[0].y === 1 && r.objects[0].w === 0.005 && r.objects[1].type === 'other' && r.objects[1].light === undefined && r.env.join() === 'dark', 'detect result clamped and validated like the server');
  ok(r.walls.length === 2 && r.walls[0].door === false && r.walls[1].door === true && r.walls[1].y2 === 1, 'detect walls: zero-length and malformed dropped, ends clamped, doors kept');
  ok(/stops a person both moving and seeing/.test(d.payload.messages[0].content[1].text) && d.payload.tools[0].input_schema.required.indexOf('walls') >= 0, 'detect asks only for walls, doors, and blocking objects');
  console.log('PASS (' + steps + ' checks)');
}).catch(function (e) { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); });
