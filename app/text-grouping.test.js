// 자체 검사: node app/text-grouping.test.js
// 합성 객체로 groupLines의 순수 함수 단위 검사를 하고(①~⑦, SPEC-line-grouping.md 참고),
// 저장소 표본(workspace/*)으로 실제 PDF 통합 검사를 한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { groupLines } = require('./text-grouping');
const { open } = require('./pdf-engine');

const WS = path.join(__dirname, '..', 'workspace');

// 합성 텍스트 객체. matrix는 [1, skewB, 0, 1, originX, originY] — 회전·기울임 없는 보통 글자는 skewB=0이라
// origin.y(=matrix[5])가 그대로 기준선이고, scaledSize = size(행렬 배율 1이므로).
let nextIdx = 0;
function T(text, { x0, y0, x1, y1, originX = x0, originY = y0, size = 10, font = 'Helvetica', hidden = false, color = [0, 0, 0, 255], group = null, skewB = 0 }) {
  const matrix = [1, skewB, 0, 1, originX, originY];
  return {
    idx: nextIdx++, type: 'text', text, bounds: { x0, y0, x1, y1 },
    size, font, hidden, color, group,
    matrix, origin: { x: originX, y: originY }, scaledSize: size * Math.hypot(matrix[0], matrix[1]),
  };
}
// 세로 괘선(표 경계) 후보 — 비텍스트 객체.
function rule({ x0, y0, x1, y1 }) { return { idx: nextIdx++, type: 'path', text: null, bounds: { x0, y0, x1, y1 } }; }

// ① 같은 기준선·간격 0.3×글자크기 → 한 상자
{
  const a = T('9', { x0: 0, y0: 0, x1: 9, y1: 10 });
  const b = T('월', { x0: 12, y0: 0, x1: 21, y1: 10 }); // 간격 (12-9)/10 = 0.3
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 1, '① 간격 0.3 → 한 상자');
  assert.strictEqual(lines[0].text, '9월');
}

// ② 같은 기준선·간격 2.0×글자크기 → 두 상자
{
  const a = T('A', { x0: 0, y0: 0, x1: 9, y1: 10 });
  const b = T('B', { x0: 29, y0: 0, x1: 38, y1: 10 }); // 간격 (29-9)/10 = 2.0
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 2, '② 간격 2.0 → 두 상자');
}

// ③ 간격 0.3인데 사이에 세로선(폭 1pt) → 두 상자 (표 경계 안전장치)
{
  const a = T('가', { x0: 0, y0: 0, x1: 9, y1: 10 });
  const b = T('나', { x0: 12, y0: 0, x1: 21, y1: 10 }); // 간격 0.3, ③ 없으면 합쳐질 조건
  const line = rule({ x0: 10, y0: -1, x1: 11, y1: 11 }); // 폭 1pt(<3), 높이 12pt(>4), a·b 사이(10~11), y 겹침
  const lines = groupLines([a, b, line]);
  assert.strictEqual(lines.length, 2, '③ 사이에 세로선 → 두 상자');
}

// ④ 간격 0.3인데 글꼴 다름 → 두 상자
{
  const a = T('A', { x0: 0, y0: 0, x1: 9, y1: 10, font: 'Helvetica' });
  const b = T('B', { x0: 12, y0: 0, x1: 21, y1: 10, font: 'Times' });
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 2, '④ 글꼴 다름 → 두 상자');
}

// ⑤ 간격 0.3인데 하나만 hidden → 두 상자
{
  const a = T('A', { x0: 0, y0: 0, x1: 9, y1: 10, hidden: false });
  const b = T('B', { x0: 12, y0: 0, x1: 21, y1: 10, hidden: true });
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 2, '⑤ hidden 다름 → 두 상자');
}

// ⑥ bounds.y0는 다르지만 origin.y가 같음 → 한 상자 (이번 수정의 핵심: 기준선 vs 잉크 아래끝)
{
  // 받침 있는 글자처럼 잉크 상자 아래끝(bounds.y0)이 5pt나 다르지만, 실제로 그려진 기준선(origin.y)은 둘 다 0
  const a = T('한', { x0: 0, y0: 0, x1: 9, y1: 10, originY: 0 });
  const b = T('글', { x0: 12, y0: 5, x1: 21, y1: 15, originY: 0 }); // bounds.y0=5 ≠ a의 0, 그러나 originY는 같다
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 1, '⑥ origin.y가 같으면 bounds.y0가 달라도 한 상자');
  assert.strictEqual(lines[0].text, '한글');
}

// ⑦ 그룹 마크가 있으면 떨어져 있어도 한 상자에 seps가 '\n' (줄바꿈 편집·Shift 묶음)
{
  const a = T('첫째 줄', { x0: 0, y0: 95, x1: 9, y1: 105, originY: 100, group: 'g1' });
  const b = T('둘째 줄', { x0: 0, y0: 75, x1: 9, y1: 85, originY: 80, group: 'g1' }); // 기준선 차이 20 ≫ 0.2×10
  const lines = groupLines([a, b]);
  assert.strictEqual(lines.length, 1, '⑦ 그룹 마크 → 떨어져 있어도 한 상자');
  assert.strictEqual(lines[0].group, 'g1');
  assert.deepStrictEqual(lines[0].seps, ['\n']);
  assert.strictEqual(lines[0].text, '첫째 줄\n둘째 줄');
}

console.log('OK — 합성 객체 단위 검사 ①~⑦ 통과');

// --- 통합 검사: 저장소 표본 PDF ---
(async () => {
  const samplePath = path.join(WS, 'sample.pdf');
  const sampleDoc = await open(fs.readFileSync(samplePath));
  const sampleLines = groupLines(sampleDoc.objects(0));
  assert.strictEqual(sampleLines.length, 8, 'sample.pdf → 상자 8개(변화 없음)');
  sampleDoc.close();
  console.log(`OK — sample.pdf 상자 ${sampleLines.length}개`);

  const koPath = path.join(WS, '회의록_초안.pdf');
  if (fs.existsSync(koPath)) {
    const koDoc = await open(fs.readFileSync(koPath));
    const koLines = groupLines(koDoc.objects(0));
    console.log('회의록_초안.pdf 1쪽 상자 수:', koLines.length);
    console.log('첫 상자:', JSON.stringify(koLines[0].text));
    assert.strictEqual(koLines.length, 15, '회의록_초안.pdf 1쪽 → 상자 15개');
    assert.ok(koLines[0].text.startsWith('9월'), '첫 상자는 9월로 시작');
    assert.ok(koLines[0].text.endsWith('(초안)'), '첫 상자는 (초안)으로 끝남');
    koDoc.close();
  } else {
    console.log('회의록_초안.pdf 없음 — 통합 검사 건너뜀');
  }
  console.log('OK — text-grouping 통합 검사 통과');
})().catch((e) => { console.error(e); process.exit(1); });
