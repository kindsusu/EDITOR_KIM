// 편집 상자를 "줄" 단위로 묶는다. 원래는 상자 = PDF 텍스트 객체 하나였다.
// Chromium·한글·엑셀이 만든 PDF는 커닝·글꼴 경계 때문에 한 줄을 수십 조각으로 쪼개므로
// 이러면 "모든 글자가 단어 단위로 표기돼 실질적으로 수정이 어렵다"(사용자 보고).
//
// 근본 원인: 줄 판정에 bounds.y0(글자 잉크의 아래끝)를 쓰면 받침·괄호·숫자 때문에
// 같은 줄이라도 글자마다 잉크 아래끝이 달라 한 줄이 여러 행으로 쪼개진다.
// (실측: workspace/회의록_초안.pdf 1쪽에서 bounds.y0 기준 행이 6개 이상으로 흩어짐.)
//
// 해결: 텍스트 행렬의 (e,f) — 기준선(baseline) 원점 — 으로 행을 나눈다.
// app/pdf-engine.js의 objects()가 이미 item.matrix/item.origin/item.scaledSize로 노출해 둔다.
// 기준선으로 묶으면 위 문서 1쪽(텍스트 객체 309개)이 정확히 15개 시각적 줄이 된다.
//
// 실측(간격은 글자크기 대비 비율):
//   같은 줄 안 조각 간격: 0.03~0.49 (낱자 사이 0.03~0.32, 낱말 사이 0.39~0.49)
//   표의 옆 칸 사이 간격: 3 이상 (계약서 실측: 인접쌍 38개 전부 3 이상, 그중 32쌍은 사이에 세로선 객체가 있다)
// → 그 사이인 0.6을 병합 경계로 쓴다.

// 같은 행 판정: |Δ기준선| ≤ 이 값 × 글자크기.
// 기준선은 bounds.y0와 달리 글자마다 흔들리지 않으므로(획 하나 정도의 오차뿐) 넉넉히 잡아도 안전하다.
const ROW_BASELINE_EPS = 0.2;
// 다음 조각을 이어붙일지 판정: 간격(음수 = 겹침도 허용) / max(두 조각 글자크기).
// 낱말 사이 간격 실측 최대 0.49, 표 옆 칸 간격 실측 최소 3 — 그 사이의 안전한 경계.
const GAP_MERGE_RATIO = 0.6;
// 글자 크기 차이가 이 값(pt) 이상이면 다른 글자로 보고 잇지 않는다.
const SIZE_DIFF_MAX = 0.6;
// 세로 괘선으로 볼 비텍스트 객체의 폭 상한(pt) — 이보다 넓으면 칠해진 도형(칸 배경 등)이라 괘선이 아니다.
const RULE_MAX_WIDTH = 3;
// 세로 괘선으로 볼 비텍스트 객체의 높이 하한(pt) — 이보다 낮으면 점·장식이라 표 경계가 아니다.
const RULE_MIN_HEIGHT = 4;

// 기준선(baseline) y좌표. matrix가 있고 b(기울임/회전 성분)가 거의 0이면 수평 텍스트이므로
// origin.y(=행렬의 f)를 그대로 쓴다. 회전·기울임이면 origin.y가 기울어진 선 위의 한 점이라
// 다른 조각과 그대로 비교할 수 없으므로 bounds.y0로 되돌아간다(엔진에서 matrix를 못 읽었을 때도 마찬가지).
function baselineOf(o) {
  if (o.matrix && Math.abs(o.matrix[1]) < 1e-6) return o.origin.y;
  return o.bounds.y0;
}
// 행 안 정렬 기준 x좌표: 기준선 시작점(origin.x)이 있으면 그것, 없으면 잉크 상자의 왼쪽 끝.
function xOf(o) { return o.origin ? o.origin.x : o.bounds.x0; }
// 행렬 배율까지 반영한 실제 글자 크기. scaledSize가 없으면(비텍스트 등) size로, 그것도 없으면 0 나눗셈을 피하려 1로.
function sizeOf(o) { return (o.scaledSize != null ? o.scaledSize : o.size) || 1; }

function unionBounds(members) {
  return members.reduce((b, o) => ({
    x0: Math.min(b.x0, o.bounds.x0), y0: Math.min(b.y0, o.bounds.y0),
    x1: Math.max(b.x1, o.bounds.x1), y1: Math.max(b.y1, o.bounds.y1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}
function sameRow(a, b) { return Math.abs(baselineOf(a) - baselineOf(b)) <= ROW_BASELINE_EPS * Math.max(sizeOf(a), sizeOf(b)); }

// 그룹 마크(EditorKimGroup)가 있는 객체들 — 줄바꿈 편집으로 생긴 줄들, 사용자가 Shift 클릭으로 묶은 상자들.
// 기준선 규칙보다 우선한다: 마크가 있으면 멀리 떨어져 있어도 한 상자다.
// 상자 안 정렬·seps만 기준선으로 다시 계산한다(위→아래, 왼→오른쪽; 같은 줄이면 '', 다른 줄이면 '\n').
function buildGroupBox(members, groupId) {
  const sorted = members.slice().sort((a, b) => (sameRow(a, b) ? xOf(a) - xOf(b) : baselineOf(b) - baselineOf(a)));
  const seps = sorted.slice(1).map((o, j) => (sameRow(o, sorted[j]) ? '' : '\n'));
  const text = sorted.map((o, j) => (j ? seps[j - 1] : '') + o.text).join('');
  return { objs: sorted, seps, text, group: groupId, size: sorted[0].size, font: sorted[0].font, bounds: unionBounds(sorted) };
}

// 그룹 마크가 없는 객체들을 기준선으로 행(줄)으로 나눈다. 위 → 아래 순서로 정렬한 뒤
// 앞 항목(대표 기준선)과 같은 행이면 그 행에 넣고, 아니면 새 행을 연다.
function splitIntoRows(items) {
  const sorted = items.slice().sort((a, b) => baselineOf(b) - baselineOf(a));
  const rows = [];
  for (const o of sorted) {
    const row = rows[rows.length - 1];
    if (row && sameRow(o, row.rep)) row.items.push(o);
    else rows.push({ rep: o, items: [o] });
  }
  return rows.map((r) => r.items);
}

// a와 b(같은 행, a가 왼쪽) 사이에 표 경계로 보이는 세로 괘선이 있는지 — 있으면 잇지 않는다.
// (표 경계용 안전장치. 계약서 실측에서 인접 칸 38쌍 중 32쌍이 여기 걸린다.)
function hasVerticalRuleBetween(a, b, nonText) {
  const lo = a.bounds.x1, hi = b.bounds.x0;
  if (hi <= lo) return false; // 겹치는 조각 사이엔 괘선이 들어갈 틈이 없다
  return nonText.some((r) => {
    const w = r.bounds.x1 - r.bounds.x0, h = r.bounds.y1 - r.bounds.y0;
    if (!(w < RULE_MAX_WIDTH && h > RULE_MIN_HEIGHT)) return false;
    const rx = (r.bounds.x0 + r.bounds.x1) / 2;
    if (!(rx >= lo && rx <= hi)) return false;
    return r.bounds.y0 < a.bounds.y1 && r.bounds.y1 > a.bounds.y0; // y 범위가 앞 조각과 겹침
  });
}

// 한 행 안에서 왼→오른쪽으로 훑으며 이어붙일 조각을 상자로 묶는다.
// 아래 조건을 전부 만족해야 잇는다 — 하나라도 어긋나면 거기서 상자를 끊는다.
function mergeRow(rowItems, nonText) {
  const sorted = rowItems.slice().sort((a, b) => xOf(a) - xOf(b));
  const boxes = [[sorted[0]]];
  for (let j = 1; j < sorted.length; j++) {
    const cur = boxes[boxes.length - 1], a = cur[cur.length - 1], b = sorted[j];
    const gap = (b.bounds.x0 - a.bounds.x1) / Math.max(sizeOf(a), sizeOf(b));
    const sameFont = a.font === b.font;
    const sameSize = Math.abs(sizeOf(a) - sizeOf(b)) < SIZE_DIFF_MAX;
    const sameHidden = !!a.hidden === !!b.hidden;
    const sameColor = a.color[0] === b.color[0] && a.color[1] === b.color[1] && a.color[2] === b.color[2]; // 알파 제외
    if (gap < GAP_MERGE_RATIO && sameFont && sameSize && sameHidden && sameColor && !hasVerticalRuleBetween(a, b, nonText)) cur.push(b);
    else boxes.push([b]);
  }
  return boxes.map((members) => ({
    objs: members, seps: members.slice(1).map(() => ''), text: members.map((o) => o.text).join(''),
    group: null, size: members[0].size, font: members[0].font, bounds: unionBounds(members),
  }));
}

// objs -> [{ objs, seps, text, group, size, font, bounds }]
// 반환 모양은 그대로 유지한다 — 뒤따르는 편집·가리기·이동·검색 코드가 그대로 동작해야 한다.
function groupLines(objs) {
  const texts = objs.filter((o) => o.type === 'text' && o.bounds);
  const nonText = objs.filter((o) => o.type !== 'text' && o.bounds); // 세로 괘선 판정용
  const grouped = new Map(), ungrouped = [];
  for (const o of texts) {
    if (o.group) { if (!grouped.has(o.group)) grouped.set(o.group, []); grouped.get(o.group).push(o); }
    else ungrouped.push(o);
  }
  const boxes = [];
  for (const [gid, members] of grouped) boxes.push(buildGroupBox(members, gid));
  for (const row of splitIntoRows(ungrouped)) boxes.push(...mergeRow(row, nonText));
  // 공백뿐인 상자는 만들지 않는다. 한 줄을 고치면 나머지 조각은 공백(' ')만 남는데(첫 조각이 줄 전체 글을 받는다),
  // 그 빈 조각들이 각각 상자가 되면 편집 직후 화면에 눌러도 아무 것도 없는 작은 상자가 十여 개 생긴다(실측: 15 → 31개).
  // 줄 안에 끼어 있는 공백 조각은 여기서 걸러지지 않는다 — 이미 앞뒤 글자와 한 상자로 묶여 text에 그대로 남는다.
  const visible = boxes.filter((b) => (b.text || '').trim() !== '');
  // 화면에 보이는 순서(위→아래, 같은 줄이면 왼→오른쪽)로 정렬한다.
  // groups/rows를 만든 순서는 PDF 객체가 쓰인 순서를 따르므로 문서 읽기 순서와 다를 수 있다
  // (rebuildDocText가 AI에 보내는 글의 줄 순서, 회귀 검사의 "첫 상자" 판정이 이 순서에 기댄다).
  visible.sort((A, B) => {
    const a0 = A.objs[0], b0 = B.objs[0];
    const dy = baselineOf(b0) - baselineOf(a0);
    if (Math.abs(dy) > ROW_BASELINE_EPS * Math.max(sizeOf(a0), sizeOf(b0))) return dy;
    return xOf(a0) - xOf(b0);
  });
  return visible;
}

if (typeof window !== 'undefined') window.groupLines = groupLines;
if (typeof module !== 'undefined') module.exports = { groupLines };
