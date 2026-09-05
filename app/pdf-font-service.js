const crypto = require('crypto');
const engine = require('./pdf-engine');
const fonts = require('./pdf-fonts');

function context(doc, i, idx, text, expected) {
  if (!Number.isInteger(i) || i < 0 || i >= doc.pageCount || !Number.isInteger(idx) || idx < 0) throw new Error('잘못된 페이지 또는 텍스트 선택');
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\r\n]/.test(text)) throw new Error('폰트 맞추기는 2,000자 이하의 한 줄씩 사용하세요.');
  const objects = doc.objects(i), object = objects[idx];
  // Applying a cloned document must not discard concurrent edits on any page.
  const token = crypto.createHash('sha256').update(doc.save()).digest('hex');
  if (expected && token !== expected) throw new Error('문서가 변경됐습니다. 폰트 창을 닫고 다시 선택하세요.');
  if (!object || object.type !== 'text') throw new Error('텍스트 상자를 선택하세요.');
  if (object.group) throw new Error('그룹을 해제한 뒤 텍스트 상자 하나를 선택하세요.');
  return { object, token };
}
async function prepare(doc, q) {
  if (typeof q.token !== 'string' || !q.token) throw new Error('미리보기할 텍스트를 다시 선택하세요.');
  const { object } = context(doc, q.i, q.idx, q.text, q.token);
  const draft = await engine.open(doc.save());
  let reopened;
  try {
    const result = draft.setFontText(q.i, q.idx, q.text, { fontId: q.fontId, size: q.size, fit: q.fit !== false });
    const bytes = draft.save();
    reopened = await engine.open(bytes);
    const edited = reopened.objects(q.i)[result.idx];
    if (!edited || edited.text.trim() !== q.text.trim() || edited.hidden || edited.fontId !== q.fontId) throw new Error('저장 후 폰트 검증에 실패해 적용하지 않았습니다.');
    const bounds = { x0: Math.min(object.bounds.x0, edited.bounds.x0), y0: Math.min(object.bounds.y0, edited.bounds.y0),
      x1: Math.max(object.bounds.x1, edited.bounds.x1), y1: Math.max(object.bounds.y1, edited.bounds.y1) };
    return { bytes, result, image: reopened.renderRegion(q.i, bounds).toString('base64') };
  } finally { reopened?.close(); draft.close(); }
}
async function recommend(doc, q, ai, signal) {
  const { object, token } = context(doc, q.i, q.idx, q.text, q.token);
  const status = doc.fontStatus(q.i, q.idx, q.text);
  if (!status.needsAi) return { candidates: [], token, skipped: true, note: status.reason };
  if (!['claude', 'codex'].includes(q.provider)) throw new Error('상단에서 AI 모델을 선택하세요.');
  const candidates = fonts.list(q.text).filter((f) => f.supported);
  if (!candidates.length) throw new Error('입력 문자를 지원하는 TTF 폰트가 없습니다. 폰트 파일을 추가하세요.');
  const result = await ai.ask(q.provider, {
    prompt: fonts.recommendationPrompt(object, q.text, candidates), model: q.model,
    images: [doc.renderRegion(q.i, object.bounds).toString('base64')], signal,
  }, () => {});
  return { ...fonts.parseRecommendation(result.text, candidates), token, model: result.model };
}
module.exports = { context, prepare, recommend };
