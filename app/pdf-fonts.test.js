const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { open } = require('./pdf-engine');
const fonts = require('./pdf-fonts');
const service = require('./pdf-font-service');
const { codexInput, claudeInput } = require('./ai-providers');
const src = fs.readFileSync(path.join(__dirname, '../workspace/sample.pdf'));

(async () => {
  const available = fonts.list('한글 폰트 검사');
  const font = available.find((f) => f.supported && /malgun.*bold/i.test(f.label)) || available.find((f) => f.supported);
  assert.ok(font, 'Korean static TTF is available');
  assert.ok(!available.some((f) => 'path' in f || 'face' in f), 'font catalog does not expose paths or bytes');
  const doc = await open(src);
  try {
    const q = { i: 0, idx: 1, text: 'REPLACED', provider: 'codex' };
    q.token = service.context(doc, 0, 1, q.text).token;
    let calls = 0;
    const ai = { ask: async (_provider, options) => {
      calls++;
      assert.ok(Buffer.from(options.images[0], 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'AI receives PNG crop');
      return { text: JSON.stringify({ candidates: [{ fontId: font.id, reason: '비교 후보' }], note: '확정 아님' }) };
    } };
    const skipped = await service.recommend(doc, q, ai);
    assert.ok(skipped.skipped); assert.strictEqual(calls, 0, 'PDFium-editable text never calls AI');
    assert.strictEqual(doc.fontStatus(0, 1, '한글').needsAi, true, 'missing source glyphs require assistance');
    doc._setFillColor(0, 1, [0,0,0,0]);
    q.token = service.context(doc, 0, 1, q.text).token;
    assert.strictEqual(doc.fontStatus(0, 1, q.text).needsAi, true, 'hidden image text requires assistance');
    assert.strictEqual((await service.recommend(doc, q, ai)).candidates[0].fontId, font.id);
    assert.strictEqual(calls, 1);
    const before = doc.objects(0), raw = doc._renderRaw(0, 1).data;
    const request = { ...q, text: '한글 폰트 검사', fontId: font.id, size: 18, fit: true };
    const prepared = await service.prepare(doc, request);
    assert.deepStrictEqual(doc.objects(0), before, 'preview does not mutate original objects');
    assert.ok(doc._renderRaw(0, 1).data.equals(raw), 'preview does not mutate original pixels');
    const saved = await open(prepared.bytes);
    try {
      const target = saved.objects(0)[prepared.result.idx];
      assert.strictEqual(target.fontId, font.id); assert.strictEqual(target.text, request.text);
      assert.ok(!target.hidden && target.color[3] >= 250);
      assert.ok(target.bounds.x1 - target.bounds.x0 <= before[1].bounds.x1 - before[1].bounds.x0 + 0.2, 'fits source width');
      assert.strictEqual(saved.fontStatus(0, target.idx, '다음 수정').needsAi, false, 'selected font handles later edits without AI');
      const edited = saved.setText(0, target.idx, '다음 수정'); assert.ok(edited.ok && !edited.fallbackFont);
      const again = await open(saved.save());
      try { assert.ok(again.objects(0).some((o) => o.text === '다음 수정' && o.fontId === font.id && !o.hidden)); }
      finally { again.close(); }
    } finally { saved.close(); }
    await assert.rejects(service.prepare(doc, { ...request, text: '\u{10ffff}' }), /없는 글자/);
    assert.deepStrictEqual(doc.objects(0), before, 'unsupported selected font edit leaves original unchanged');
    doc.move(0, [1], 2, 0);
    await assert.rejects(service.prepare(doc, request), /문서가 변경/);
    const last = doc.objects(0).filter((o) => o.type === 'text').at(-1).idx;
    const stale = service.context(doc, 0, last, request.text).token;
    doc.removeObject(0, last);
    assert.throws(() => service.context(doc, 0, last, request.text, stale), /문서가 변경/);
    assert.throws(() => fonts.parseRecommendation('{"candidates":[{"fontId":"arbitrary-path.ttf"}]}', available), /사용할 수 없습니다/);
    assert.throws(() => fonts.parseRecommendation('not json', available), /형식/);
    assert.throws(() => fonts.register(__filename), /TTF/);
    const image = prepared.image;
    assert.strictEqual(codexInput('test', [image])[1].url, 'data:image/png;base64,' + image);
    assert.strictEqual(JSON.parse(claudeInput('test', [image])).message.content[1].source.data, image);
    console.log('OK — AI gate, font preview, persistence, stale selection, unsupported glyphs and image inputs');
  } finally { doc.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
