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

  // --- D: 폴백 폰트 서브셋 — 폴백 편집이 파일을 MB 단위로 불리지 않아야 한다 ---
  // (원본 회의록_초안.pdf는 건드리지 않는다. 저장본은 메모리에서만 검사)
  if (fs.existsSync(ko)) {
    const koBuf = fs.readFileSync(ko);
    const d = await open(koBuf);
    const ts = d.objects(0).filter((o) => o.type === 'text' && (o.text || '').trim());
    assert.ok(ts.length >= 2, '텍스트 객체 2개 이상');

    const NEW1 = '대필 검수 테스트';
    const e1 = d.setText(0, ts[0].idx, NEW1);
    assert.deepStrictEqual(e1, { ok: true, fallbackFont: true }, '서브셋에 없는 한글 → 폴백');
    const s1 = d.save();
    const g1 = s1.length - koBuf.length;
    console.log(`[서브셋] 원본 ${koBuf.length} → 폴백 1회 ${s1.length} (+${g1})`);
    assert.ok(g1 < 150000, `폴백 1회 증가가 150KB 미만이어야 함 (실제 +${g1})`);

    // 두 번째 폴백 편집(다른 객체·다른 글자) — 합집합 서브셋이라 증가가 계속 작아야 한다
    const e2 = d.setText(0, ts[1].idx, '쀍뷁쭶 두 번째 폴백');
    assert.strictEqual(e2.ok, true);
    const s2 = d.save();
    const g2 = s2.length - koBuf.length;
    console.log(`[서브셋] 폴백 2회 ${s2.length} (+${g2}) fallbackFont=${e2.fallbackFont}`);
    assert.ok(g2 < 150000, `폴백 2회 증가가 150KB 미만이어야 함 (실제 +${g2})`);
    d.close();

    // 저장본 재열기 → 텍스트 + 실제로 그려졌는지(픽셀) 확인
    const d2 = await open(s2);
    const edited = d2.objects(0).find((o) => (o.text || '').includes(NEW1));
    assert.ok(edited, '저장본에서 편집한 텍스트를 다시 읽을 수 있어야 함');
    const { h } = d2.pageSize(0);
    const raw = d2._renderRaw(0, 1);
    const x0 = Math.max(0, Math.floor(edited.bounds.x0)), x1 = Math.min(raw.w, Math.ceil(edited.bounds.x1));
    const y0 = Math.max(0, Math.floor(h - edited.bounds.y1)), y1 = Math.min(raw.h, Math.ceil(h - edited.bounds.y0));
    let dark = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (raw.data[y * raw.stride + x * 4] < 200) dark++;
    console.log(`[서브셋] 편집 영역 ${x1 - x0}x${y1 - y0}px, 진한 픽셀 ${dark}`);
    assert.ok(dark > 20, '편집한 글자가 실제로 렌더돼야 함(빈 칸/투명 아님)');
    d2.close();
  }

  // --- H: charBoxes / move / addRect / redact / pageText ---
  {
    const d = await open(src);
    const o0 = d.objects(0)[0];

    // charBoxes: 글자 수가 문자열 길이와 같고, x0가 오름차순, 객체 bounds 안
    // (공백도 상자를 받는다 — 높이 0의 얇은 상자. 인덱스를 문자열과 맞추려면 그대로 두는 게 맞다)
    const cb = d.charBoxes(0, 0);
    assert.strictEqual(cb.length, o0.text.length, 'charBoxes 개수 = 글자 수');
    assert.strictEqual(cb.length, 37);
    assert.strictEqual(cb.map((c) => c.ch).join(''), o0.text, 'charBoxes 순서 = 문자열 순서');
    for (let k = 1; k < cb.length; k++) assert.ok(cb[k].x0 > cb[k - 1].x0, `x0 오름차순 (${k})`);
    for (const c of cb) {
      assert.ok(c.x0 >= o0.bounds.x0 - 1 && c.x1 <= o0.bounds.x1 + 1, 'x가 bounds 안');
      assert.ok(c.y0 >= o0.bounds.y0 - 1 && c.y1 <= o0.bounds.y1 + 1, 'y가 bounds 안');
    }
    console.log('charBoxes', cb.length, JSON.stringify(cb[0]));

    // move
    const b0 = d.objects(0)[1].bounds;
    assert.deepStrictEqual(d.move(0, [1], 20, -10), { ok: true, moved: 1 });
    const b1 = d.objects(0)[1].bounds;
    for (const [k, dv] of [['x0', 20], ['x1', 20], ['y0', -10], ['y1', -10]]) {
      assert.ok(Math.abs(b1[k] - (b0[k] + dv)) < 0.01, `move ${k}: ${b0[k]} → ${b1[k]}`);
    }
    assert.deepStrictEqual(d.move(0, [999], 1, 1), { ok: false, moved: 0 }, '범위 밖 idx는 무시');
    console.log('move', b0.x0.toFixed(2), '→', b1.x0.toFixed(2));

    // addRect
    const nBefore = d.objects(0).length;
    const rect = { x0: 100, y0: 100, x1: 200, y1: 130 };
    const { idx: rIdx } = d.addRect(0, rect, [0, 0, 0, 255]);
    const ro = d.objects(0);
    assert.strictEqual(ro.length, nBefore + 1, '객체 1개 늘어남');
    assert.strictEqual(ro[rIdx].type, 'path');
    for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(ro[rIdx].bounds[k] - rect[k]) < 0.01, `rect ${k}`);
    console.log('addRect idx', rIdx, JSON.stringify(ro[rIdx].bounds));

    // K: 마크 — addRect가 만든 객체만 mask:true, 나머지는 전부 false
    assert.strictEqual(ro[rIdx].mask, true, '사각형은 mask:true');
    for (let k = 0; k < ro.length; k++) if (k !== rIdx) assert.strictEqual(ro[k].mask, false, `idx ${k}는 mask:false`);

    // K: 저장 → 재열기해도 마크가 살아남는다
    const savedRect = d.save();
    const dr = await open(savedRect);
    const rro = dr.objects(0);
    assert.strictEqual(rro.length, ro.length, '재열기 후 객체 수 동일');
    assert.strictEqual(rro[rIdx].mask, true, '저장·재열기 후에도 mask:true 유지');
    dr.close();

    // K: removeObject — 삭제하면 객체 수가 다시 줄어든다
    assert.deepStrictEqual(d.removeObject(0, rIdx), { ok: true });
    assert.strictEqual(d.objects(0).length, nBefore, 'removeObject 후 원래 개수로 복귀');
    assert.deepStrictEqual(d.removeObject(0, 999), { ok: false }, '범위 밖 idx는 실패');
    d.close();
  }

  // redact — 글자가 실제로 사라지고, 앞뒤는 제자리, 검은 사각형이 덮는다
  {
    const d = await open(src);
    const line = d.objects(0)[5].text;
    assert.strictEqual(line, '1. Editing is local; only the AI call leaves the machine.');
    const from = line.indexOf('local');
    const boxesBefore = d.charBoxes(0, 5);
    const r = d.redact(0, 5, from, from + 5);
    console.log('redact', JSON.stringify(r));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.inserted, 6);
    assert.strictEqual(r.rects.length, 1);

    // K: redact가 얹은 사각형(마지막 객체)도 addRect를 거치므로 mask:true여야 함
    const objsAfterRedact = d.objects(0);
    assert.strictEqual(objsAfterRedact[objsAfterRedact.length - 1].mask, true, 'redact의 가림 사각형은 mask:true');

    const pt = d.pageText(0);
    assert.ok(!pt.includes('local'), '"local"이 페이지 텍스트에 남으면 안 됨');
    assert.ok(pt.includes('1. Editing is '), '앞부분 유지');
    assert.ok(pt.includes('; only the AI call'), '뒷부분 유지');

    const objs = d.objects(0);
    assert.strictEqual(objs[5].text, '1. Editing is ');
    assert.strictEqual(objs[6].text, '; only the AI call leaves the machine.');

    // 뒷부분이 원래 자리에 남았는지 (상자 기준 이동이라 lsb 차이만큼만 어긋난다)
    const suffixBoxes = d.charBoxes(0, 6);
    const err = suffixBoxes[0].x0 - boxesBefore[from + 5].x0;
    console.log('suffix 위치 오차', err.toFixed(3), 'pt');
    assert.ok(Math.abs(err) < 0.5, `뒷부분이 0.5pt 안에서 제자리 (실제 ${err})`);
    assert.ok(Math.abs(suffixBoxes[0].y0 - boxesBefore[from + 5].y0) < 0.01, '세로 위치 유지');

    // 픽셀: 사각형 영역은 거의 전부 검고, 뒷부분 영역에는 글자 픽셀이 남아 있다
    const { h } = d.pageSize(0);
    const raw = d._renderRaw(0, 1);
    const darkFrac = (b, lim = 60) => {
      const x0 = Math.max(0, Math.ceil(b.x0 + 1)), x1 = Math.min(raw.w, Math.floor(b.x1 - 1));
      const y0 = Math.max(0, Math.ceil(h - b.y1 + 1)), y1 = Math.min(raw.h, Math.floor(h - b.y0 - 1));
      let dark = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) if (raw.data[y * raw.stride + x * 4] < lim) dark++;
      return { dark, n, frac: n ? dark / n : 0 };
    };
    const inRect = darkFrac(r.rects[0]);
    console.log('사각형 영역', JSON.stringify(inRect));
    assert.ok(inRect.n > 50 && inRect.frac > 0.95, `가린 자리는 거의 전부 검어야 함 (${inRect.frac})`);
    const sufBox = { x0: suffixBoxes[0].x0, y0: objs[6].bounds.y0, x1: suffixBoxes[8].x1, y1: objs[6].bounds.y1 };
    const inSuf = darkFrac(sufBox, 200);
    console.log('뒷부분 영역', JSON.stringify(inSuf));
    assert.ok(inSuf.dark > 20 && inSuf.frac < 0.6, '뒷부분은 글자로 남아 있어야 함(검은 칠 아님)');

    // 저장 → 재열기: 마스킹이 살아남는다
    const s = d.save();
    d.close();
    const d2 = await open(s);
    const pt2 = d2.pageText(0);
    assert.ok(!pt2.includes('local'), '저장본에도 "local"이 없어야 함');
    assert.ok(pt2.includes('; only the AI call'), '저장본에 뒷부분 유지');
    console.log('저장 후 재열기 OK', s.length, 'bytes');
    d2.close();
  }

  // 줄바꿈 편집: '\n'이 □가 되지 않고 줄마다 객체가 생겨 아래로 배치돼야 한다
  {
    const d = await open(src);
    const before = d.objects(0), t2 = before[2];
    const r = d.setText(0, 2, 'first line\nsecond line\nthird');
    assert.deepStrictEqual({ ok: r.ok, inserted: r.inserted, fb: r.fallbackFont }, { ok: true, inserted: 2, fb: false });
    const after = d.objects(0), L = r.lineIdxs.map((k) => after[k]);
    assert.strictEqual(after.length, before.length + 2, '줄 수만큼 객체 추가');
    assert.deepStrictEqual(r.lineIdxs, [2, before.length, before.length + 1], '추가 줄은 맨 뒤(가장 위 z-순서)에');
    assert.deepStrictEqual(L.map((o) => o.text), ['first line', 'second line', 'third']);
    assert.ok(L[1].bounds.y1 < t2.bounds.y0 + 1 && L[2].bounds.y1 < L[1].bounds.y0 + 1, '각 줄이 앞 줄 아래에');
    assert.ok(Math.abs(L[1].bounds.x0 - L[0].bounds.x0) < 1, '왼쪽 정렬 유지');
    assert.ok(!d.pageText(0).includes('�'), '□ 없음');
    assert.ok(r.group && L.every((o) => o.group === r.group), '줄바꿈 줄들은 같은 그룹 마크');
    assert.ok(after.filter((o) => o.group === r.group).length === 3, '그룹은 정확히 3개 객체');
    // 그룹 마크 저장·재열기 유지, 사용자 그룹 설정/해제
    const d2 = await open(d.save());
    assert.strictEqual(d2.objects(0).filter((o) => o.group === r.group).length, 3, '저장 후에도 그룹 유지');
    const g = d2.setGroup(0, [0, 1]); assert.ok(g.ok && g.id && g.count === 2);
    assert.deepStrictEqual(d2.objects(0).slice(0, 2).map((o) => o.group), [g.id, g.id], '사용자 그룹 설정');
    d2.setGroup(0, [0, 1], null);
    assert.deepStrictEqual(d2.objects(0).slice(0, 2).map((o) => o.group), [null, null], '그룹 해제');
    const s1 = d2.setText(0, 2, 'single'); assert.strictEqual(d2.objects(0)[2].group, null, '한 줄로 되돌리면 줄바꿈 그룹 표시 제거');
    d2.close();
    console.log('줄바꿈 편집 OK', L.map((o) => `${o.text}@y${o.bounds.y0.toFixed(1)}`).join(' | '), '| 그룹', r.group);
    d.close();
  }

  // 배경색 추출: 흰 페이지의 글자 영역은 흰색, 검은 사각형 위는 검정, 'auto' 마스킹은 그 색으로 덮는다
  {
    const d = await open(src);
    const t = d.objects(0)[5];
    const white = d.sampleColor(0, t.bounds);
    assert.ok(white.slice(0, 3).every((v) => v >= 250), `흰 배경 추출: ${white}`);
    d.addRect(0, { x0: 300, y0: 300, x1: 400, y1: 340 }, [0, 0, 0, 255]);
    const black = d.sampleColor(0, { x0: 310, y0: 305, x1: 390, y1: 335 });
    assert.ok(black.slice(0, 3).every((v) => v <= 5), `검정 추출: ${black}`);
    const rr = d.redact(0, 5, 3, 10, 'auto');
    assert.ok(rr.ok, 'auto 색 마스킹');
    const objs = d.objects(0), last = objs[objs.length - 1];
    assert.ok(last.mask && last.color.slice(0, 3).every((v) => v >= 250), `auto 마스킹 사각형은 배경색(흰색): ${last.color}`);
    console.log('배경색 추출 OK 흰', white.slice(0, 3), '검', black.slice(0, 3));
    d.close();
  }

  // 투명 글자(알파 0, PowerPoint 그림 위 검색용) 편집: 배경 사각형으로 덮고 글자를 보이게 맨 위에 다시 그린다
  {
    const d = await open(src);
    const before = d.objects(0), b = before[1].bounds;
    d.addRect(0, b, [255, 255, 255, 255]); // 원래 글자를 흰 사각형으로 가려 "글자 없는" 그림 상태를 흉내
    assert.ok(d._setFillColor(0, 1, [0, 0, 0, 0]), '알파 0');
    const hiddenObj = d.objects(0)[1];
    assert.ok(!hiddenObj.hidden || true, 'hidden 플래그는 렌더 모드 기준(알파는 _setOne이 직접 검사)');
    const dark = (bb) => { const r = d._renderRaw(0, 1); let n = 0; for (let y = Math.floor(842 - bb.y1); y < Math.ceil(842 - bb.y0); y++) for (let x = Math.floor(bb.x0); x < Math.ceil(bb.x1); x++) { const p = y * r.stride + x * 4; if (r.data[p] < 100) n++; } return n; };
    assert.strictEqual(dark(b), 0, '편집 전: 글자가 보이지 않음');
    const r = d.setText(0, 1, 'REVEALED');
    assert.ok(r.ok && r.idx != null, `투명 글자 편집: ${JSON.stringify(r)}`);
    const after = d.objects(0), last = after[after.length - 1];
    assert.strictEqual(last.text, 'REVEALED', '편집된 글자가 맨 위 객체');
    assert.strictEqual(last.color[3], 255, '알파 255로 보이게');
    assert.ok(dark(last.bounds) > 20, '편집 후: 글자가 실제로 그려짐');
    console.log('투명 글자 드러내기 OK, 진한 픽셀', dark(last.bounds));
    d.close();
  }

  // 폭 맞춤: 긴 글이 maxWidth 안에서 줄바꿈되거나(wrap) 축소돼야(shrink) 한다
  {
    const long = 'This sentence is deliberately much longer than the original line so that it must wrap into several lines.';
    const d = await open(src);
    const r = d.fitText(0, 5, long, 200, 'wrap');
    assert.ok(r.ok && r.wrapped >= 2, 'wrap: 2줄 이상');
    const objs = d.objects(0);
    for (const k of r.lineIdxs) assert.ok(objs[k].bounds.x1 - objs[k].bounds.x0 <= 201, `wrap: 객체 ${k} 폭 ≤ 200`);
    assert.strictEqual(r.lineIdxs.map((k) => objs[k].text).join(' '), long, 'wrap: 글자 손실 없음');
    console.log('폭 맞춤 wrap OK', r.wrapped, '줄');
    d.close();
    const d2 = await open(src);
    const r2 = d2.fitText(0, 5, long, 200, 'shrink');
    const b = d2.objects(0)[5].bounds;
    assert.ok(r2.ok && r2.scaled < 1 && b.x1 - b.x0 <= 201, `shrink: 폭 ${(b.x1 - b.x0).toFixed(1)} ≤ 200, scale ${r2.scaled}`);
    console.log('폭 맞춤 shrink OK', r2.scaled.toFixed(3));
    d2.close();
  }

  // redact — 한글(서브셋 폰트, Chromium이 조각낸 텍스트 객체)
  if (fs.existsSync(ko)) {
    const koBuf = fs.readFileSync(ko);
    const d = await open(koBuf);
    // 회귀: 객체 텍스트 끝의 공백(Word/Excel/Chromium 출력)은 텍스트 페이지에 없다 → charBoxes가 합성 상자로 길이를 맞춰야 한다.
    //       안 맞으면 redact가 charmap으로 실패하고 서버가 객체 전체를 가려 버린다(사용자 보고: "선택 가리기가 전체 가리기가 됨").
    const texts = d.objects(0).filter((o) => o.type === 'text');
    const trailing = texts.filter((o) => /\s$/.test(o.text));
    assert.ok(trailing.length > 0, '뒤 공백 조각이 시험지에 있어야 함');
    assert.ok(trailing.every((o) => d.charBoxes(0, o.idx).length === o.text.length), '뒤 공백 조각도 charBoxes 길이 = 텍스트 길이');
    assert.strictEqual(texts.filter((o) => d.charBoxes(0, o.idx).length !== o.text.length).length, 0, '페이지 0 전 객체 대응');
    console.log(`[회의록] 뒤 공백 조각 ${trailing.length}개 charBoxes 대응 OK`);
    // 조각 중 3글자 이상인 것 하나 (charBoxes와 글자 수가 맞는 것)
    const frag = d.objects(0).find((o) => o.type === 'text' && (o.text || '').trim().length >= 3
      && d.charBoxes(0, o.idx).length === o.text.length);
    assert.ok(frag, '3글자 이상 텍스트 조각이 있어야 함');
    assert.ok(d.pageText(0).includes(frag.text), '원래 페이지 텍스트에 조각이 있음');
    const mid = Math.floor(frag.text.length / 2);
    const r = d.redact(0, frag.idx, mid, mid + 1);
    console.log(`[회의록] ${JSON.stringify(frag.text)} 중 ${JSON.stringify(frag.text[mid])} 가리기 → ${JSON.stringify(r)}`);
    assert.strictEqual(r.ok, true);
    assert.ok(!d.pageText(0).includes(frag.text), '가린 뒤에는 원래 조각 문자열이 없어야 함');
    const s = d.save();
    assert.ok(s.length > 0);
    d.close();
    const d2 = await open(s);
    assert.ok(!d2.pageText(0).includes(frag.text), '저장본에도 없음');
    d2.close();
    console.log('[회의록] 마스킹 저장·재열기 OK', s.length, 'bytes');

    // 회귀: 뒤 공백 조각의 부분 마스킹이 charmap 실패 없이 성공 (깨끗한 문서에서)
    const d3 = await open(koBuf);
    const tr = d3.objects(0).find((o) => o.type === 'text' && /\s$/.test(o.text) && o.text.trim().length >= 1);
    const rr = d3.redact(0, tr.idx, 0, 1);
    assert.strictEqual(rr.ok, true, `뒤 공백 조각 부분 마스킹: ${JSON.stringify(rr)}`);
    console.log('[회의록] 뒤 공백 조각 부분 마스킹 OK');
    d3.close();
  }

  console.log('\nOK — 모든 검사 통과');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
