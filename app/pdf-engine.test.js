// 자체 검사: node app/pdf-engine.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { open } = require('./pdf-engine');

const WS = path.join(__dirname, '..', 'workspace');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

(async () => {
  // --- sample.pdf (Helvetica, 한글 글리프 없음) ---
  const src = fs.readFileSync(path.join(WS, 'sample.pdf'));
  let doc = await open(src);

  assert.strictEqual(doc.pageCount, 1);
  const size = doc.pageSize(0);
  console.log('pageSize', size);
  assert.ok(size.w > 0 && size.h > 0);

  const objs = doc.objects(0);
  const texts = objs.filter((o) => o.type === 'text');
  assert.strictEqual(texts.length, 8, '텍스트 객체 8개');
  assert.strictEqual(texts[0].text, 'GenOffice-lite prototype - sample PDF');
  assert.strictEqual(texts[0].font, 'Helvetica');
  assert.strictEqual(texts[0].size, 12);
  assert.ok(texts[0].bounds.x1 > texts[0].bounds.x0);
  console.log('objects[0]', JSON.stringify(texts[0]));

  const png = await doc.render(0, 1);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG), 'PNG 시그니처');
  console.log('render bytes', png.length);

  // 한글 → Helvetica에 글리프 없음 → 폴백 기대
  const r1 = doc.setText(0, 0, 'EDITED 대필 한글');
  console.log('setText(한글)', r1);
  assert.strictEqual(r1.ok, true);
  if (process.platform === 'win32') assert.strictEqual(r1.fallbackFont, true, '한글은 폴백 폰트여야 함');

  const saved = doc.save();
  assert.ok(saved.length > 0);
  fs.writeFileSync(path.join(WS, 'sample-edited.pdf'), saved);
  console.log('saved bytes', saved.length);
  doc.close();

  // 저장본 재열기 → 텍스트 확인
  const doc2 = await open(saved);
  const reText = doc2.objects(0).filter((o) => o.type === 'text').map((o) => o.text).join('\n');
  assert.ok(reText.includes('EDITED'), '저장본에 EDITED 있음');
  console.log('reloaded first text', JSON.stringify(doc2.objects(0)[0].text));
  doc2.close();

  // 라틴 전용 → 원본 폰트 유지
  doc = await open(src);
  const r2 = doc.setText(0, 0, 'EDITED');
  console.log('setText(라틴)', r2);
  assert.deepStrictEqual(r2, { ok: true, fallbackFont: false });
  assert.strictEqual(doc.objects(0)[0].font, 'Helvetica');
  doc.close();

  // --- 한글 PDF(있을 때만): 서브셋 폰트에서 원본 유지 여부 확인 ---
  const ko = path.join(WS, '회의록_초안.pdf');
  if (fs.existsSync(ko)) {
    const koBuf = fs.readFileSync(ko);
    let d = await open(koBuf);
    const t = d.objects(0).filter((o) => o.type === 'text' && /[가-힣]/.test(o.text || ''));
    if (t.length) {
      // (a) 문서에 없던 한글 → 서브셋에 글리프가 없으므로 폴백 기대
      const r = d.setText(0, t[0].idx, '쀍뷁쭶 대필 엔진 검사');
      console.log(`[회의록_초안.pdf] font=${t[0].font} "${t[0].text}" → ${JSON.stringify(r)} (${r.fallbackFont ? '폴백 폰트' : '원본 폰트 유지'})`);
      assert.strictEqual(r.ok, true);
      const p = await d.render(0, 1);
      assert.ok(p.subarray(0, 8).equals(PNG_SIG));
      assert.ok(d.save().length > 0);
      d.close();

      // (b) 그 객체에 원래 있던 글자만 다시 넣으면 원본 폰트가 유지돼야 한다
      d = await open(koBuf);
      const same = d.setText(0, t[0].idx, (t[0].text || '').trim());
      console.log(`[회의록_초안.pdf] 원본 글자 재입력 → ${JSON.stringify(same)}`);
      assert.deepStrictEqual(same, { ok: true, fallbackFont: false }, '원래 있던 글자는 원본 폰트 유지');
      d.close();
    } else { console.log('[회의록_초안.pdf] 한글 텍스트 객체 없음'); d.close(); }
  } else console.log('[회의록_초안.pdf] 없음 — 건너뜀');

  console.log('\nOK — 모든 검사 통과');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
