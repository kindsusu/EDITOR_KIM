// Apply a line edit to a private PDF copy. Page object indices refer to the
// original page; editing from high to low keeps every remaining index stable.
function assertIndex(objects, idx) {
  if (!Number.isInteger(idx) || idx < 0 || objects[idx]?.type !== 'text') throw new Error('편집할 텍스트 상자를 다시 선택하세요.');
}

function applyEdits(doc, i, edits, { primary, fit, remove = [] } = {}) {
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
    ...edits.map((edit, order) => ({ ...edit, order, kind: 'edit' })),
    ...remove.map((idx) => ({ idx, kind: 'remove' })),
  ].sort((a, b) => b.idx - a.idx);
  let primaryResult;
  for (const operation of operations) {
    const { idx } = operation;
    const result = operation.kind === 'remove' ? doc.removeObject(i, idx)
      : fit && idx === primary ? doc.fitText(i, idx, operation.text, fit.maxWidth, fit.mode)
        : doc.setText(i, idx, operation.text);
    if (!result?.ok) throw new Error(result?.reason || '텍스트를 수정하지 못했습니다.');
    if (operation.kind === 'edit') {
      const expectedLines = operation.text.split(/\r?\n/).length;
      const actualLines = result.lineIdxs?.length || 1;
      if (fit && idx === primary && fit.mode === 'wrap') {
        if (result.wrapped && actualLines !== result.wrapped) throw new Error('줄바꿈 일부를 그리지 못했습니다.');
      } else if (actualLines !== expectedLines) throw new Error('텍스트 일부를 그리지 못했습니다.');
    }
    // A revealed object is removed at its old index and appended. Removing a
    // grouped sibling has the same effect on indices above that sibling.
    if (operation.kind === 'remove' || result.revealed) {
      for (const previous of results) {
        if (!previous) continue;
        if (previous.idx > idx) previous.idx--;
        if (previous.lineIdxs) previous.lineIdxs = previous.lineIdxs.map((n) => n > idx ? n - 1 : n);
      }
    }
    if (operation.kind === 'edit') {
      if (result.idx == null && !result.lineIdxs) result.idx = idx;
      results[operation.order] = result;
      if (idx === primary) primaryResult = result;
    }
  }
  return { results, primaryResult, fallbackFont: results.some((r) => r.fallbackFont) };
}

function verifyEdits(doc, i, edits, results) {
  const objects = doc.objects(i);
  for (let n = 0; n < edits.length; n++) {
    const indices = results[n].lineIdxs || [results[n].idx];
    if (indices.some((idx) => !Number.isInteger(idx) || objects[idx]?.type !== 'text')) throw new Error('저장된 텍스트 위치를 확인하지 못했습니다.');
    const actual = indices.map((idx) => objects[idx].text).join('').replace(/\s/g, '');
    const expected = edits[n].text.replace(/\s/g, '');
    if (actual !== expected) throw new Error('저장된 텍스트가 입력과 다릅니다.');
  }
}

module.exports = { applyEdits, verifyEdits };
