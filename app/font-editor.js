// UI for the exceptional path: PDFium keeps handling text it can edit directly.
// 원래 글꼴을 재사용할 수 없는 줄(그림으로 그려진 글자·원본 폰트에 없는 글자)은 사용자가 설치된 TTF를 직접 골라 미리보기 → 적용한다
// remove: 줄 단위 상자의 나머지 조각 idx들 — 적용하면 첫 조각(idx)이 줄 전체를 새 폰트로 그리고 나머지는 지워진다
window.openPdfFontEditor = async function ({ name, i, idx, remove = [], text, onApply }) {
  if (document.querySelector('#fontEditor')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'fontEditor';
  dialog.innerHTML = `<h3>폰트 맞추기</h3>
    <p class="fontStatus">선택 영역 확인 중…</p>
    <label>수정할 한 줄<input class="fontText" maxlength="2000"></label>
    <div class="fontControls"><label>사용할 폰트<select class="fontSelect"></select></label><button class="fontAdd">TTF 추가</button></div>
    <div class="fontControls"><label>크기 (pt)<input class="fontSize" type="number" min="1" max="300" step="0.1"></label>
      <label><input class="fontFit" type="checkbox" checked>기존 폭을 넘으면 축소</label></div>
    <div class="fontControls"><button class="fontPreview">미리보기</button></div>
    <p class="fontAdvice"></p><p class="fontNote" role="status"></p>
    <div class="fontCompare"><figure><figcaption>현재 문서</figcaption><img class="fontBefore" alt="현재 선택 영역"></figure>
      <figure><figcaption>저장 후 예상 결과</figcaption><img class="fontAfter" alt="폰트 적용 미리보기" hidden></figure></div>
    <div class="fontControls"><button class="fontApply pri" disabled>이 폰트로 적용</button><button class="fontClose">닫기</button></div>`;
  document.body.appendChild(dialog); dialog.showModal();
  const el = (s) => dialog.querySelector(s), input = el('.fontText'), select = el('.fontSelect'), size = el('.fontSize');
  const note = el('.fontNote'), apply = el('.fontApply');
  let ctx, closed = false, previewKey = '', busy = false, generation = 0;
  input.value = text;
  const post = async (url, payload) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`);
    return result;
  };
  const base = () => ({ name, i, idx, remove, text: input.value, token: ctx?.token });
  const payload = () => ({ ...base(), fontId: select.value, size: Number(size.value), fit: el('.fontFit').checked });
  const key = () => JSON.stringify(payload());
  const invalidate = () => { generation++; previewKey = ''; apply.disabled = true; el('.fontAfter').hidden = true; };
  function close() { closed = true; dialog.close(); dialog.remove(); }
  el('.fontClose').onclick = close;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  input.oninput = invalidate;
  size.oninput = invalidate; el('.fontFit').onchange = invalidate;
  async function loadContext() {
    const before = input.value;
    const next = await post('/api/pdf/font-context', base());
    if (closed || before !== input.value) return false;
    ctx = next;
    el('.fontStatus').textContent = ctx.reason;
    // needsAi(엔진 필드 이름 그대로): PDFium이 원래 글꼴로 그릴 수 없는 줄 — 사람이 비슷한 글꼴을 고르도록 안내한다
    el('.fontAdvice').textContent = ctx.needsAi ? '원래 글꼴을 판단하기 어렵습니다 — 아래 미리보기로 비교하며 비슷한 글꼴을 고르세요.' : '';
    el('.fontBefore').src = 'data:image/png;base64,' + ctx.image;
    const previous = select.value || ctx.object.fontId || ctx.suggestedFontId; // 이미 지정한 폰트 > PDF 폰트 이름과 비슷한 설치 폰트 > 첫 후보
    select.replaceChildren();
    for (const font of ctx.fonts) {
      const option = new Option(font.label + (font.supported ? '' : ' (일부 글자 없음)'), font.id);
      option.disabled = !font.supported; select.add(option);
    }
    select.value = ctx.fonts.find((f) => f.id === previous && f.supported)?.id || ctx.fonts.find((f) => f.supported)?.id || '';
    if (!size.value) size.value = Number(ctx.object.size.toFixed(1));
    return true;
  }
  async function preview() {
    if (busy || closed || !ctx) return;
    invalidate(); busy = true;
    const expected = key(), version = generation;
    note.textContent = '선택한 폰트를 PDF에 넣고 저장 결과를 확인하는 중…';
    try {
      const result = await post('/api/pdf/font-preview', payload());
      if (closed || version !== generation || expected !== key()) return;
      el('.fontAfter').src = 'data:image/png;base64,' + result.image; el('.fontAfter').hidden = false;
      previewKey = expected; apply.disabled = false;
      note.textContent = `${result.fontLabel} · 저장·재열기 확인 완료. 현재 문서와 비교한 뒤 적용하세요.`;
    } catch (error) { if (!closed) note.textContent = error.message; }
    finally { busy = false; }
  }
  el('.fontPreview').onclick = preview;
  select.onchange = () => { invalidate(); preview(); };
  input.onchange = () => loadContext().catch((e) => { note.textContent = e.message; });
  el('.fontAdd').hidden = !window.retextPdf?.openFont;
  el('.fontAdd').onclick = async () => {
    try {
      const file = await window.retextPdf.openFont(); if (!file || closed) return;
      const font = await post('/api/fonts/add', { path: file });
      await loadContext(); select.value = font.id; invalidate(); await preview();
    } catch (error) { note.textContent = error.message; }
  };
  apply.onclick = async () => {
    if (busy || !previewKey || previewKey !== key()) return;
    busy = true; apply.disabled = true;
    // The payload is frozen at the previewed state while the request is in flight.
    const frozen = payload();
    dialog.querySelectorAll('input,select,button').forEach((node) => { node.disabled = true; });
    try {
      const result = await post('/api/pdf/font-apply', frozen);
      await onApply(result); close();
    } catch (error) {
      note.textContent = error.message;
      dialog.querySelectorAll('input,select,button').forEach((node) => { node.disabled = false; });
      previewKey = ''; apply.disabled = true;
    } finally { busy = false; }
  };
  try { await loadContext(); }
  catch (error) { note.textContent = error.message; }
};
