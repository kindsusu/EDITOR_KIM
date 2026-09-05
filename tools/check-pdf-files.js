// Local real-file regression checks. Input PDFs stay in memory and are never overwritten.
// Usage: node tools/check-pdf-files.js "path/to/file.pdf" [...]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { open } = require('../app/pdf-engine');

async function check(file) {
  const source = fs.readFileSync(file);
  const original = await open(source);
  const summary = { file: path.basename(file), pages: original.pageCount, text: 0, hidden: 0, images: 0, checked: 0 };
  const cases = [];
  try {
    for (let i = 0; i < original.pageCount; i++) {
      const objects = original.objects(i), texts = objects.filter((o) => o.type === 'text');
      summary.text += texts.length;
      summary.hidden += texts.filter((o) => o.hidden).length;
      summary.images += objects.filter((o) => o.type === 'image').length;
      const target = texts.find((o) => o.hidden && o.text.trim()) || texts.find((o) => o.text.trim());
      if (target) cases.push({ i, target });
    }
  } finally { original.close(); }
  for (const { i, target } of cases) {
    const doc = await open(source);
    try {
      if (target.hidden) {
        const objects = doc.objects(i), pixels = doc._renderRaw(i, 0.5).data;
        assert.strictEqual(doc.setText(i, target.idx, '\u{10ffff}').ok, false);
        assert.deepStrictEqual(doc.objects(i), objects, `page ${i + 1}: rejected edit preserves objects`);
        assert.ok(doc._renderRaw(i, 0.5).data.equals(pixels), `page ${i + 1}: rejected edit preserves pixels`);
      }
      // Repeat the existing characters to exercise the document's own font coverage.
      const replacement = target.text.trim();
      const result = doc.setText(i, target.idx, replacement);
      assert.ok(result.ok, `page ${i + 1}: existing characters remain editable`);
      const reopened = await open(doc.save());
      try {
        assert.strictEqual(reopened.pageCount, summary.pages);
        const edited = reopened.objects(i)[result.idx ?? target.idx];
        assert.ok(edited && edited.type === 'text' && edited.text.trim() === replacement && !edited.hidden && edited.color[3] > 0,
          `page ${i + 1}: saved replacement remains visible at the edited index`);
        assert.ok((await reopened.render(i, 0.5)).length > 0);
      } finally { reopened.close(); }
      summary.checked++;
    } finally { doc.close(); }
  }
  console.log(JSON.stringify(summary));
}

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Usage: node tools/check-pdf-files.js "path/to/file.pdf" [...]');
  for (const file of files) await check(file);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
