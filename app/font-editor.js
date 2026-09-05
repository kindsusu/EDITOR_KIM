// UI for the exceptional path: PDFium keeps handling text it can edit directly.
window.openPdfFontEditor = async function ({ name, i, idx, text, provider, model, autoRecommend = false, onApply }) {
  if (document.querySelector('#fontEditor')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'fontEditor';
  dialog.innerHTML = `<h3>폰트 맞추기</h3>
    <p class="fontStatus">선택 영역 확인 중…</p>
    <label>수정할 한 줄<input class="fontText" maxlength="2000"></label>
    <div class="fontControls"><label>사용할 폰트<select class="fontSelect"></select></label><button class="fontAdd">TTF 추가</button></div>
    <div class="fontControls"><label>크기 (pt)<input class="fontSize" type="number" min="1" max="300" step="0.1"></label>
      <label><input class="fontFit" type="checkbox" checked>기존 폭을 넘으면 축소</label></div>
    <div class="fontControls"><button class="fontRecommend">AI 후보 추천</button><button class="fontStop" hidden>추천 중지</button><button class="fontPreview">미리보기</button></div>
    <p class="fontDisclosure">AI는 PDFium으로 직접 편집하기 어려운 경우에만 호출됩니다. 선택 영역 이미지·문구·폰트 목록이 선택한 AI로 전송됩니다.</p>
    <div class="fontCandidates"></div><p class="fontAdvice"></p><p class="fontNote" role="status"></p>
    <div class="fontCompare"><figure><figcaption>현재 문서</figcaption><img class="fontBefore" alt="현재 선택 영역"></figure>
      <figure><figcaption>저장 후 예상 결과</figcaption><img class="fontAfter" alt="폰트 적용 미리보기" hidden></figure></div>
    <div class="fontControls"><button class="fontApply pri" disabled>이 폰트로 적용</button><button class="fontClose">닫기</button></div>`;
  document.body.appendChild(dialog); dialog.showModal();
  const el = (s) => dialog.querySelector(s), input = el('.fontText'), select = el('.fontSelect'), size = el('.fontSize');
  const note = el('.fontNote'), apply = el('.fontApply'), rec = el('.fontRecommend');
  let ctx, closed = false, aiAbort = null, previewKey = '', busy = false, generation = 0;
  input.value = text;
  const post = async (url, payload, signal) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
    const result = await res.json(); if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`); return result;
  };
  const base = () => ({ name, i, idx, text: input.value, token: ctx?.token });
  const payload = () => ({ ...base(), fontId: select.value, size: Number(size.value), fit: el('.fontFit').checked });
  const key = () => JSON.stringify(payload());
  const invalidate = () => { generation++; previewKey = ''; apply.disabled = true; el('.fontAfter').hidden = true; };
  function close() { closed = true; aiAbort?.abort(); dialog.close(); dialog.remove(); }
  el('.fontClose').onclick = close;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  el('.fontStop').onclick = () => aiAbort?.abort();
  input.oninput = () => { invalidate(); aiAbort?.abort(); el('.fontCandidates').replaceChildren(); el('.fontAdvice').textContent = ''; };
  size.oninput = invalidate; el('.fontFit').onchange = invalidate;
  async function loadContext() {
    const before = input.value;
    const next = await post('/api/pdf/font-context', base());
    if (closed || before !== input.value) return false;
    ctx = next;
    el('.fontStatus').textContent = ctx.reason;
    el('.fontBefore').src = 'data:image/png;base64,' + ctx.image;
    const previous = select.value || ctx.object.fontId;
    select.replaceChildren();
    for (const font of ctx.fonts) {
      const option = new Option(font.label + (font.supported ? '' : ' (일부 글자 없음)'), font.id);
      option.disabled = !font.supported; select.add(option);
    }
    select.value = ctx.fonts.find((f) => f.id === previous && f.supported)?.id || ctx.fonts.find((f) => f.supported)?.id || '';
    if (!size.value) size.value = Number(ctx.object.size.toFixed(1));
    rec.disabled = !ctx.needsAi || !provider || !!aiAbort;
    rec.title = !ctx.needsAi ? 'PDFium이 직접 처리할 수 있어 AI를 호출하지 않습니다.' : !provider ? '상단에서 AI 모델을 선택하세요.' : '선택 영역으로 폰트 후보 추천';
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
  async function recommend() {
    if (aiAbort || closed || !provider) return;
    aiAbort = new AbortController(); rec.disabled = true; el('.fontStop').hidden = false;
    try {
      if (!await loadContext() || !ctx.needsAi) return;
      const expected = input.value;
      note.textContent = 'AI가 선택한 글자 이미지와 설치 폰트 목록을 비교하는 중…';
      const result = await post('/api/pdf/font-recommend', { ...base(), provider, model }, aiAbort.signal);
      if (closed || expected !== input.value) return;
      el('.fontAdvice').textContent = result.note;
      el('.fontCandidates').replaceChildren();
      for (const candidate of result.candidates) {
        const font = ctx.fonts.find((f) => f.id === candidate.fontId);
        if (!font) continue;
        const button = document.createElement('button'); button.textContent = font.label; button.title = candidate.reason;
        button.onclick = () => { select.value = font.id; el('.fontAdvice').textContent = `${candidate.reason} ${result.note}`; preview(); };
        el('.fontCandidates').appendChild(button);
      }
      if (result.candidates.length) { select.value = result.candidates[0].fontId; await preview(); }
    } catch (error) { if (!closed) note.textContent = error.name === 'AbortError' ? '추천을 중지했습니다. 직접 선택할 수 있습니다.' : error.message; }
    finally { aiAbort = null; if (!closed) { rec.disabled = !ctx?.needsAi || !provider; el('.fontStop').hidden = true; } }
  }
  rec.onclick = recommend; el('.fontPreview').onclick = preview;
  select.onchange = () => { invalidate(); preview(); };
  input.onchange = () => loadContext().catch((e) => { note.textContent = e.message; });
  el('.fontAdd').hidden = !window.editorKim?.openFont;
  el('.fontAdd').onclick = async () => {
    try {
      const file = await window.editorKim.openFont(); if (!file || closed) return;
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
      previewKey = ''; apply.disabled = true; rec.disabled = !ctx?.needsAi || !provider;
    } finally { busy = false; }
  };
  try { if (await loadContext() && autoRecommend && ctx.needsAi && provider) await recommend(); }
  catch (error) { note.textContent = error.message; }
};
