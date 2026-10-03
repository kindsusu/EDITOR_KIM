const crypto = require('crypto');
const engine = require('./pdf-engine');

const union = (boxes) => boxes.reduce((b, o) => ({ x0: Math.min(b.x0, o.x0), y0: Math.min(b.y0, o.y0), x1: Math.max(b.x1, o.x1), y1: Math.max(b.y1, o.y1) }));

// remove: 같은 줄의 나머지 조각 idx들(줄 단위 상자). 첫 조각(idx)이 줄 전체 글을 새 폰트로 받고 나머지는 지운다 —
// 줄 편집(/api/pdf/edits·fit)과 같은 방식. 투명(hidden) 조각은 그림 덮기 범위가 첫 조각뿐이라 받지 않는다.
function context(doc, i, idx, text, expected, remove = []) {
  if (!Number.isInteger(i) || i < 0 || i >= doc.pageCount || !Number.isInteger(idx) || idx < 0) throw new Error('잘못된 페이지 또는 텍스트 선택');
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\r\n]/.test(text)) throw new Error('폰트 맞추기는 2,000자 이하의 한 줄씩 사용하세요.');
  if (!Array.isArray(remove) || remove.some((n) => !Number.isInteger(n) || n < 0 || n === idx) || new Set(remove).size !== remove.length) throw new Error('잘못된 줄 선택');
  const objects = doc.objects(i), object = objects[idx];
  // Applying a cloned document must not discard concurrent edits on any page.
  const token = crypto.createHash('sha256').update(doc.save()).digest('hex');
  if (expected && token !== expected) throw new Error('문서가 변경됐습니다. 폰트 창을 닫고 다시 선택하세요.');
  if (!object || object.type !== 'text') throw new Error('텍스트 상자를 선택하세요.');
  if (object.group) throw new Error('그룹을 해제한 뒤 텍스트 상자 하나를 선택하세요.');
  const siblings = remove.map((n) => objects[n]);
  if (siblings.some((o) => !o || o.type !== 'text' || o.group)) throw new Error('줄을 다시 선택하세요.');
  if (siblings.length && [object, ...siblings].some((o) => o.hidden)) throw new Error('그림 위 투명 글자 줄은 조각이 하나일 때만 폰트를 맞출 수 있습니다.');
  // 줄 전체 영역: 미리보기 그림과 "기존 폭을 넘으면 축소"의 기준
  const region = union([object, ...siblings].map((o) => o.bounds));
  return { object, token, region };
}
async function prepare(doc, q) {
  if (typeof q.token !== 'string' || !q.token) throw new Error('미리보기할 텍스트를 다시 선택하세요.');
  const remove = q.remove || [];
  const { region } = context(doc, q.i, q.idx, q.text, q.token, remove);
  const draft = await engine.open(doc.save());
  let reopened;
  try {
    // 나머지 조각을 뒤 idx부터 지운다 — 지울 때마다 그 뒤 인덱스가 하나씩 당겨지므로 첫 조각 idx를 맞춘다
    let idx = q.idx;
    for (const n of [...remove].sort((a, b) => b - a)) {
      if (!draft.removeObject(q.i, n).ok) throw new Error('줄의 나머지 조각을 지우지 못했습니다.');
      if (n < idx) idx--;
    }
    const result = draft.setFontText(q.i, idx, q.text, { fontId: q.fontId, size: q.size, fit: q.fit !== false, maxWidth: region.x1 - region.x0 });
    const bytes = draft.save();
    reopened = await engine.open(bytes);
    const edited = reopened.objects(q.i)[result.idx];
    if (!edited || edited.text.trim() !== q.text.trim() || edited.hidden || edited.fontId !== q.fontId) throw new Error('저장 후 폰트 검증에 실패해 적용하지 않았습니다.');
    const bounds = union([region, edited.bounds]);
    return { bytes, result, image: reopened.renderRegion(q.i, bounds).toString('base64') };
  } finally { reopened?.close(); draft.close(); }
}
module.exports = { context, prepare };
