// Apply a line edit to the live PDF document (the caller restores it on failure).
// Page object indices refer to the original page; editing from high to low keeps
// every remaining index stable, and the primary (whole-line text) goes last.
function assertIndex(objects, idx) {
  if (!Number.isInteger(idx) || idx < 0 || objects[idx]?.type !== 'text') throw new Error('편집할 텍스트 상자를 다시 선택하세요.');
}
// 객체 하나가 X에서 빠지면(제거·투명 글자 드러내기) X보다 뒤의 인덱스는 하나씩 당겨진다
const shiftAbove = (n, x) => (n > x ? n - 1 : n);
function shiftResult(result, x) {
  if (result.idx != null) result.idx = shiftAbove(result.idx, x);
  if (result.lineIdxs) result.lineIdxs = result.lineIdxs.map((n) => shiftAbove(n, x));
}

function applyEdits(doc, i, edits, { primary, fit, remove = [], align } = {}) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('편집할 텍스트가 없습니다.');
  const objects = doc.objects(i);
  const seen = new Set();
  for (const { idx, text } of edits) {
    assertIndex(objects, idx);
    if (seen.has(idx) || typeof text !== 'string') throw new Error('중복되거나 잘못된 편집입니다.');
    seen.add(idx);
  }
  for (const idx of remove) {
    assertIndex(objects, idx);
    if (seen.has(idx)) throw new Error('중복되거나 잘못된 편집입니다.');
    seen.add(idx);
  }
  if (primary != null && !edits.some((e) => e.idx === primary)) throw new Error('기준 텍스트 상자를 찾을 수 없습니다.');
  const results = new Array(edits.length);
  const operations = [
    ...edits.map((edit, order) => ({ ...edit, order, kind: 'edit', isPrimary: edit.idx === primary })),
    ...remove.map((idx) => ({ idx, kind: 'remove' })),
  ].sort((a, b) => b.idx - a.idx);
  // 기준 조각은 맨 마지막에: 투명 글자 줄이면 나중에 드러난 조각의 배경 덮개가 새 글자 위에 얹혀 글자가 가려진다
  const p = operations.findIndex((o) => o.isPrimary);
  if (p >= 0) operations.push(...operations.splice(p, 1));
  let primaryResult;
  for (let k = 0; k < operations.length; k++) {
    const operation = operations[k];
    const { idx } = operation;
    const result = operation.kind === 'remove' ? doc.removeObject(i, idx)
      : fit && operation.isPrimary ? doc.fitText(i, idx, operation.text, fit.maxWidth, fit.mode)
        : doc.setText(i, idx, operation.text);
    if (!result?.ok) throw new Error(result?.reason || '텍스트를 수정하지 못했습니다.');
    if (operation.kind === 'edit') {
      const expectedLines = operation.text.split(/\r?\n/).length;
      const actualLines = result.lineIdxs?.length || 1;
      if (fit && operation.isPrimary && fit.mode === 'wrap') {
        if (result.wrapped && actualLines !== result.wrapped) throw new Error('줄바꿈 일부를 그리지 못했습니다.');
      } else if (actualLines !== expectedLines) throw new Error('텍스트 일부를 그리지 못했습니다.');
    }
    // A revealed object is removed at its old index and appended. Removing a
    // grouped sibling has the same effect on indices above that sibling —
    // both for results already produced and for operations still pending.
    if (operation.kind === 'remove' || result.revealed) {
      for (const previous of results) if (previous) shiftResult(previous, idx);
      for (const pending of operations.slice(k + 1)) pending.idx = shiftAbove(pending.idx, idx);
    }
    if (operation.kind === 'edit') {
      if (result.idx == null && !result.lineIdxs) result.idx = idx;
      results[operation.order] = result;
      if (operation.isPrimary) primaryResult = result;
    }
  }
  // 정렬(가운데·오른쪽): 새 줄 전체의 오른쪽 끝/가운데를 옛 상자에 맞춘다 — 같은 편집 안에서 하므로 실행 취소도 한 번
  if (primaryResult && align && ['center', 'right'].includes(align.mode)) {
    const old = align.oldBounds || {}, idxs = primaryResult.lineIdxs || [primaryResult.idx], now = doc.objects(i);
    const boxes = idxs.map((n) => now[n]?.bounds).filter(Boolean);
    if (boxes.length && [old.x0, old.x1].every(Number.isFinite)) {
      const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
      const dx = align.mode === 'center' ? ((old.x0 + old.x1) - (x0 + x1)) / 2 : old.x1 - x1;
      if (dx && !doc.move(i, idxs, dx, 0).ok) throw new Error('정렬하지 못했습니다.');
    }
  }
  return { results, primaryResult, fallbackFont: results.some((r) => r.fallbackFont) };
}

// 저장·재열기한 문서에서 편집 결과를 확인한다. 공백으로 비운 곁가지 조각(기준 조각이 아닌 ' ' 편집)이
// 일부 폰트에서 저장 뒤 'ÿ'로 읽히거나 옛 글자가 남으면, 검사를 느슨하게 하지 않고 그 객체를 지운다
// (비우려던 조각이므로 지워도 결과는 같다). 지운 뒤의 인덱스는 results에 반영한다. 그 밖의 불일치는 예외.
function verifyEdits(doc, i, edits, results, { primary } = {}) {
  const objects = doc.objects(i), drop = [];
  for (let n = 0; n < edits.length; n++) {
    const indices = results[n].lineIdxs || [results[n].idx];
    const blankSibling = edits[n].idx !== primary && !edits[n].text.trim() && indices.length === 1;
    if (indices.some((idx) => !Number.isInteger(idx) || objects[idx]?.type !== 'text')) throw new Error('저장된 텍스트 위치를 확인하지 못했습니다.');
    const actual = indices.map((idx) => objects[idx].text).join('').replace(/\s/g, '');
    const expected = edits[n].text.replace(/\s/g, '');
    if (actual === expected) continue;
    if (blankSibling) drop.push(n);
    else throw new Error('이 글꼴은 입력한 글자를 그대로 저장하지 못합니다(원본 PDF의 글자 대응 문제). 다른 표기로 바꾸거나 [폰트 맞추기]로 글꼴을 지정하세요.');
  }
  // 높은 인덱스부터 지워야 아직 지우지 않은 조각의 인덱스가 그대로다
  drop.sort((a, b) => results[b].idx - results[a].idx);
  for (const n of drop) {
    const x = results[n].idx;
    if (!doc.removeObject(i, x).ok) throw new Error('저장된 텍스트가 입력과 다릅니다.');
    results.forEach((r, m) => { if (m !== n) shiftResult(r, x); });
    results[n] = { ...results[n], idx: null, removed: true };
  }
  return drop.length;
}

module.exports = { applyEdits, verifyEdits };
