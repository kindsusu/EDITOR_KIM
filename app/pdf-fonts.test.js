const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { open } = require('./pdf-engine');
const fonts = require('./pdf-fonts');
const service = require('./pdf-font-service');
const src = fs.readFileSync(path.join(__dirname, '../workspace/sample.pdf'));

(async () => {
  const available = fonts.list('한글 폰트 검사');
  const font = available.find((f) => f.supported && /malgun.*bold/i.test(f.label)) || available.find((f) => f.supported);
  assert.ok(font, 'Korean static TTF is available');
  assert.ok(!available.some((f) => 'path' in f || 'face' in f || 'chars' in f), 'font catalog does not expose paths or bytes');
  if (/malgun.*bold/i.test(font.label)) assert.strictEqual(fonts.suggest('ABCDEF+MalgunGothicBold', available), font.id, 'PDF font name maps to the matching installed font');
  assert.strictEqual(fonts.suggest('', available), null);
  // 폰트 추천(AI)은 제거됐다 — 서비스는 선택 확인(context)과 미리보기 준비(prepare)만 내보낸다
  assert.deepStrictEqual(Object.keys(service).sort(), ['context', 'prepare'], 'font service exposes no recommendation');
  assert.ok(!('parseRecommendation' in fonts) && !('recommendationPrompt' in fonts), 'font catalog has no AI prompt helpers');
  const doc = await open(src);
  try {
    const q = { i: 0, idx: 1, text: 'REPLACED' };
    // 원본 폰트에 없는 글자·그림으로 그려진 글자는 사용자가 폰트를 직접 골라야 한다(fontStatus.needsAi는 엔진의 기존 필드 이름)
    assert.strictEqual(doc.fontStatus(0, 1, '한글').needsAi, true, 'missing source glyphs need a manual font choice');
    doc._setFillColor(0, 1, [0,0,0,0]);
    q.token = service.context(doc, 0, 1, q.text).token;
    assert.strictEqual(doc.fontStatus(0, 1, q.text).needsAi, true, 'hidden image text needs a manual font choice');
    const before = doc.objects(0), raw = doc._renderRaw(0, 1).data;
    const request = { ...q, text: '한글 폰트 검사', fontId: font.id, size: 18, fit: true };
    const prepared = await service.prepare(doc, request);
    assert.deepStrictEqual(doc.objects(0), before, 'preview does not mutate original objects');
    assert.ok(doc._renderRaw(0, 1).data.equals(raw), 'preview does not mutate original pixels');
    assert.ok(Buffer.from(prepared.image, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'preview image is a PNG crop');
    const saved = await open(prepared.bytes);
    try {
      const target = saved.objects(0)[prepared.result.idx];
      assert.strictEqual(target.fontId, font.id); assert.strictEqual(target.text, request.text);
      assert.ok(!target.hidden && target.color[3] >= 250);
      assert.ok(target.bounds.x1 - target.bounds.x0 <= before[1].bounds.x1 - before[1].bounds.x0 + 0.2, 'fits source width');
      assert.strictEqual(saved.fontStatus(0, target.idx, '다음 수정').needsAi, false, 'selected font handles later edits directly');
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
    assert.throws(() => fonts.register(__filename), /TTF/);
    console.log('OK — manual font choice, font preview, persistence, stale selection and unsupported glyphs');
  } finally { doc.close(); }

  // 줄 단위 상자(여러 조각): 첫 조각이 줄 전체를 새 폰트로 받고 나머지 조각은 지워진다. 축소 기준은 줄 전체 폭
  const { groupLines } = require('./text-grouping');
  const ko = await open(fs.readFileSync(path.join(__dirname, '../workspace/회의록_초안.pdf')));
  try {
    const line = groupLines(ko.objects(0))[0];
    assert.ok(line.objs.length > 1, 'title line is made of several fragments');
    const idx = line.objs[0].idx, remove = line.objs.slice(1).map((o) => o.idx), text = '9월 첫째 주 경영전략회의 회의록 (초안)';
    const lineWidth = line.bounds.x1 - line.bounds.x0, textCount = ko.objects(0).filter((o) => o.type === 'text').length;
    const ctx = service.context(ko, 0, idx, text, undefined, remove);
    assert.ok(ctx.region.x1 - ctx.region.x0 >= lineWidth - 0.01, 'context region covers the whole line');
    const prepared = await service.prepare(ko, { i: 0, idx, remove, text, token: ctx.token, fontId: font.id, size: 22, fit: true });
    const saved = await open(prepared.bytes);
    try {
      const objs = saved.objects(0), target = objs[prepared.result.idx];
      assert.strictEqual(target.text, text); assert.strictEqual(target.fontId, font.id);
      assert.strictEqual(objs.filter((o) => o.type === 'text').length, textCount - remove.length, 'other fragments of the line are removed');
      assert.ok(target.bounds.x1 - target.bounds.x0 <= lineWidth + 0.2, 'shrinks to the whole line width, not the first fragment');
      assert.ok(target.bounds.x1 - target.bounds.x0 > line.objs[0].bounds.x1 - line.objs[0].bounds.x0 + 50, 'not squeezed into the first fragment');
      const lines = groupLines(objs);
      assert.strictEqual(lines.filter((l) => l.text.startsWith('9월')).length, 1, 'title stays a single box');
    } finally { saved.close(); }
    // 투명 글자가 섞인 여러 조각 줄은 막는다(그림 덮기가 첫 조각 자리만 덮는다)
    ko._setFillColor(0, remove[0], [0, 0, 0, 0]);
    assert.throws(() => service.context(ko, 0, idx, text, undefined, remove), /투명 글자/);
    assert.throws(() => service.context(ko, 0, idx, text, undefined, [idx]), /잘못된 줄/);
    console.log('OK — font match on a multi-fragment line (whole line in one object, siblings removed, line-width fit)');
  } finally { ko.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
