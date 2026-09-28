// Integration regression: node app/pdf-edit-service.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('./pdf-engine');

process.env.EDITORKIM_PORT = '4861';
const app = require('./server');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-kim-edits-'));
  try {
    const port = await app.ready;
    const post = async (route, data) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      return { status: response.status, ...(await response.json()) };
    };
    const get = async (route, name) => (await fetch(`http://127.0.0.1:${port}${route}?${new URLSearchParams({ name, i: 0 })}`)).json();
    const source = fs.readFileSync(path.join(__dirname, '..', 'workspace', 'sample.pdf'));
    const fixture = await open(source);
    for (let idx = 1; idx <= 3; idx++) {
      assert(fixture.setText(0, idx, ['','AAA','BBB','CCC'][idx]).ok);
      const object = fixture.objects(0)[idx];
      fixture.move(0, [idx], 60 + (idx - 1) * 40 - object.origin.x, 690 - object.origin.y);
      fixture._setFillColor(0, idx, [0, 0, 0, 0]);
    }
    const bytes = fixture.save(); fixture.close();
    for (const route of ['edits', 'fit']) {
      const name = path.join(dir, `${route}.pdf`);
      fs.writeFileSync(name, bytes);
      const payload = route === 'edits'
        ? { name, i: 0, edits: [{ idx: 2, text: ' ' }, { idx: 3, text: ' ' }, { idx: 1, text: 'REPLACED' }] }
        : { name, i: 0, idx: 1, text: 'REPLACED', maxWidth: 200, mode: 'wrap', blank: [2, 3] };
      const result = await post(`/api/pdf/${route}`, payload);
      assert.strictEqual(result.status, 200, JSON.stringify(result));
      assert.strictEqual(result.undoLeft, 1);
      const objects = await get('/api/pdf/objects', name);
      assert(objects.some((o) => o.text === 'Key points:'), 'unrelated object survives');
      assert(!objects.some((o) => o.text === 'CCC'), 'last fragment was cleared');
      assert.strictEqual(objects[result.lineIdxs[0]].text, 'REPLACED', 'returned index addresses replacement');
      await post('/api/pdf/undo', { name });
      const undone = await get('/api/pdf/objects', name);
      assert(undone.some((o) => o.text?.trim() === 'CCC'), 'one undo restores all fragments');
    }
    {
      const name = path.join(dir, 'group.pdf'); fs.writeFileSync(name, bytes);
      const r = await post('/api/pdf/fit', { name, i: 0, idx: 1, text: 'WHOLE', maxWidth: 200, mode: 'wrap', remove: [2, 3] });
      assert.strictEqual(r.status, 200, JSON.stringify(r));
      const after = await get('/api/pdf/objects', name);
      assert(!after.some((o) => ['BBB', 'CCC'].includes(o.text?.trim())));
      assert.strictEqual(after[r.lineIdxs[0]].text, 'WHOLE');
      await post('/api/pdf/undo', { name });
      const undone = await get('/api/pdf/objects', name);
      assert(undone.some((o) => o.text?.trim() === 'BBB') && undone.some((o) => o.text?.trim() === 'CCC'));
    }
    {
      const name = path.join(dir, 'failure.pdf'); fs.writeFileSync(name, source);
      const beforeObjects = await get('/api/pdf/objects', name), beforeInfo = await get('/api/pdf/info', name);
      const failed = await post('/api/pdf/fit', { name, i: 0, idx: 1, text: '\u{1f680}', maxWidth: 300, mode: 'wrap', blank: [2] });
      assert.notStrictEqual(failed.status, 200);
      assert.deepStrictEqual(await get('/api/pdf/objects', name), beforeObjects, 'failed edit leaves live document untouched');
      assert.deepStrictEqual(await get('/api/pdf/info', name), beforeInfo, 'failed edit leaves dirty and history untouched');
      assert(fs.readFileSync(name).equals(source), 'failed edit leaves file bytes untouched');
      const failedSingle = await post('/api/pdf/edit', { name, i: 0, idx: 1, text: '\u{1f680}' });
      assert.notStrictEqual(failedSingle.status, 200);
      assert.deepStrictEqual(await get('/api/pdf/info', name), beforeInfo, 'single edit also preserves history on failure');
    }
    console.log('pdf edit transaction: OK');
  } finally {
    const absolute = path.resolve(dir), root = path.resolve(os.tmpdir()) + path.sep;
    if (!absolute.startsWith(root)) throw new Error('test cleanup outside temporary directory');
    fs.rmSync(absolute, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
