// EDITOR_KIM 백엔드: 정적 UI + 파일 읽기/쓰기 + Claude Code/Codex 호출 (API 키 없음, 구독 로그인 사용)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.EDITORKIM_PORT) || 4747;
const MARKED_BROWSER = path.join(path.dirname(require.resolve('marked')), 'marked.umd.js');
const DOMPURIFY_BROWSER = path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js');
const CONF = path.join(os.homedir(), '.editor-kim.json');
{ // 옛 이름 시절 설정 파일을 새 경로로 1회 이전
  const OLD_CONF = path.join(os.homedir(), '.su-da' + 'epil.json');
  if (!fs.existsSync(CONF) && fs.existsSync(OLD_CONF)) { try { fs.renameSync(OLD_CONF, CONF); } catch {} }
}
const pdfEngine = require('./pdf-engine');
const pdfFonts = require('./pdf-fonts');
const fontService = require('./pdf-font-service');
const APP_VERSION = require('../package.json').version;
const ai = require('./ai-providers').createProviders({ version: APP_VERSION });

let conf = {}; try { conf = JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch {}
let WS = conf.workspace && fs.existsSync(conf.workspace) ? conf.workspace : path.join(ROOT, '..', 'workspace');
const sessions = {}; // `${provider}\0${문서명}` → { model, id }
const pdfDocs = {}; // 파일명 → { doc, mtimeMs, dirty }
const MAX_RENDER_SCALE = 4; // A4 기준 2380×3368px. 그 이상은 WASM 힙만 먹고 화면에서 구분되지 않는다

// 캐시된 PDF 문서를 반환. 없거나 디스크에서 파일이 바뀌었으면 (다시) 연다 — 미저장 편집은 버려짐.
async function getPdfDoc(name) {
  const p = safe(name);
  const mtimeMs = fs.statSync(p).mtimeMs;
  const cached = pdfDocs[name];
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  if (cached) cached.doc.close();
  const doc = await pdfEngine.open(fs.readFileSync(p));
  return (pdfDocs[name] = { doc, mtimeMs, dirty: false, undo: [], redo: [] });
}

// ponytail: undo 스택은 문서당 최대 20개(save() 바이트 통짜) — 600KB 문서 기준 12MB, 개인용 데스크톱 앱이라 넉넉함.
//   더 큰 문서/더 긴 히스토리가 필요해지면 diff 기반으로 바꿔야 함.
const UNDO_MAX = 20;
function snapshot(entry, i) {
  entry.undo.push({ bytes: entry.doc.save(), page: i });
  if (entry.undo.length > UNDO_MAX) entry.undo.shift();
  entry.redo = [];
}
const stacks = (entry) => ({ undoLeft: entry.undo.length, redoLeft: entry.redo.length });
// 바이트를 다른 문서 객체로 바꿔 끼운다. 새 문서를 먼저 열고 나서 옛 것을 닫아, 열기에 실패해도 닫힌 핸들이 남지 않게 한다
async function swapDoc(entry, bytes) { const doc = await pdfEngine.open(bytes); entry.doc.close(); entry.doc = doc; }

// 절대경로는 그대로 씀 (로컬 단일 사용자 데스크톱 앱, OS 파일 대화상자에서 온 경로). 상대경로는 WS 밖으로 나갈 수 없다.
const safe = (p) => {
  if (p && path.isAbsolute(p)) return path.resolve(p);
  const abs = path.resolve(WS, p || ''), relative = path.relative(path.resolve(WS), abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('bad path');
  return abs;
};
// 임시 파일에 쓴 뒤 바꿔치기: 크래시로 원본이 잘리지 않는다. 다른 프로그램(Acrobat 등)이 잡고 있으면 rename이 EPERM/EBUSY → 이유를 알려준다
function writeAtomic(p, data) {
  const tmp = p + '.tmp';
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, p); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    const busy = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
    throw new Error(busy ? '저장 실패: 파일이 다른 프로그램에서 열려 있거나 쓰기 권한이 없습니다' : `저장 실패: ${e.message}`);
  }
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
// 로컬 요청만 받는다. Host 검사는 DNS 리바인딩(외부 도메인을 127.0.0.1로 돌려 같은 출처처럼 요청) 방지, Origin 검사는 다른 사이트의 교차 출처 요청 방지
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const trustedRequest = (req) => LOCAL_HOSTS.has(req.headers.host || '')
  && (!req.headers.origin || [...LOCAL_HOSTS].map((h) => `http://${h}`).includes(req.headers.origin));

const PROMPTS = {
  chat: (doc, name, q) => `아래는 사용자가 열어둔 문서 "${name}"의 내용이다. 문서에 근거해 한국어로 간결하게 답하라. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n질문: ${q}`,
  chatMore: (_doc, _name, q) => q, // 같은 세션의 후속 질문: 문서는 이미 대화에 있음
  edit: (doc, name, q) => `아래 Markdown 문서 "${name}"를 지시대로 수정하라. 출력은 수정된 문서 전체만, 코드펜스나 설명 없이 그대로 출력할 것. 지시와 무관한 부분은 바꾸지 말 것. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n지시: ${q}`,
  editText: (doc, name, q) => `아래 텍스트를 지시대로 고쳐라. 출력은 고친 텍스트만, 설명 없이.\n\n<text>\n${doc}\n</text>\n\n지시: ${q}`,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!trustedRequest(req)) return json(res, 403, { error: '허용되지 않은 요청 출처' });
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); }
    if (url.pathname === '/font-editor.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'font-editor.js')).pipe(res); }
    if (url.pathname === '/vendor/marked.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(MARKED_BROWSER).pipe(res); }
    if (url.pathname === '/vendor/purify.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(DOMPURIFY_BROWSER).pipe(res); }
    if (url.pathname === '/api/health') { // ?provider=claude|codex 이면 그 공급자만 검사(로그인 대기 중 2초마다 부르므로)
      const only = url.searchParams.get('provider');
      return json(res, 200, { appVersion: APP_VERSION, providers: await ai.health(['claude', 'codex'].includes(only) ? only : undefined) });
    }
    if (url.pathname === '/api/setup' && req.method === 'POST') {
      const { provider, action } = JSON.parse(await body(req));
      if (!['claude', 'codex'].includes(provider) || !['install', 'login'].includes(action)) return json(res, 400, { error: '잘못된 AI 설정 요청' });
      return json(res, 200, action === 'install' ? await ai.install(provider) : await ai.login(provider));
    }
    if (url.pathname === '/api/workspace' && req.method === 'GET') return json(res, 200, { path: WS });
    if (url.pathname === '/api/workspace' && req.method === 'POST') {
      const { path: p } = JSON.parse(await body(req));
      if (!fs.existsSync(p)) return json(res, 400, { error: '폴더 없음' });
      WS = path.resolve(p); fs.writeFileSync(CONF, JSON.stringify({ ...conf, workspace: WS })); return json(res, 200, { path: WS });
    }
    if (url.pathname === '/api/files') {
      const dir = url.searchParams.get('dir');
      if (dir) return json(res, 200, fs.readdirSync(dir).filter((f) => /\.(md|pdf)$/i.test(f)).sort().map((f) => path.join(dir, f)));
      return json(res, 200, fs.readdirSync(WS).filter((f) => /\.(md|pdf)$/i.test(f)).sort());
    }
    if (url.pathname === '/api/file' && req.method === 'GET') {
      const p = safe(url.searchParams.get('name'));
      if (!fs.existsSync(p)) return json(res, 404, { error: '파일 없음' }); // 헤더 전송 후 스트림 오류가 나면 프로세스가 죽는다 → 먼저 확인
      res.writeHead(200, { 'Content-Type': p.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8' });
      return fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
    }
    if (url.pathname === '/api/file' && req.method === 'PUT') { writeAtomic(safe(url.searchParams.get('name')), await body(req)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/session/reset' && req.method === 'POST') {
      const { name, provider } = JSON.parse(await body(req));
      if (provider) delete sessions[`${provider}\0${name}`];
      else for (const key of Object.keys(sessions)) if (key.endsWith(`\0${name}`)) delete sessions[key];
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pdf/info' && req.method === 'GET') { // 서버가 문서 상태의 정본: 미저장 여부와 실행취소 스택도 함께 준다(새로고침·재열기 뒤 화면과 어긋나지 않게)
      const entry = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, { pages: Array.from({ length: entry.doc.pageCount }, (_, i) => entry.doc.pageSize(i)), dirty: entry.dirty, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/page' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      const scale = Math.max(0.25, Math.min(MAX_RENDER_SCALE, +(url.searchParams.get('scale') || 1.5) || 1.5));
      const png = await doc.render(+url.searchParams.get('i'), scale);
      res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png);
    }
    if (url.pathname === '/api/pdf/objects' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, doc.objects(+url.searchParams.get('i')));
    }
    if (url.pathname === '/api/fonts' && req.method === 'GET') return json(res, 200, pdfFonts.list(url.searchParams.get('text') || ''));
    if (url.pathname === '/api/fonts/add' && req.method === 'POST') {
      const { path: file } = JSON.parse(await body(req));
      return json(res, 200, pdfFonts.publicInfo(pdfFonts.register(file)));
    }
    if (url.pathname === '/api/pdf/font-context' && req.method === 'POST') {
      const q = JSON.parse(await body(req)), { doc } = await getPdfDoc(q.name);
      const ctx = fontService.context(doc, q.i, q.idx, q.text, q.token), fonts = pdfFonts.list(q.text);
      return json(res, 200, { ...ctx, ...doc.fontStatus(q.i, q.idx, q.text), fonts, suggestedFontId: pdfFonts.suggest(ctx.object.font, fonts), image: doc.renderRegion(q.i, ctx.object.bounds).toString('base64') });
    }
    if (url.pathname === '/api/pdf/font-status' && req.method === 'POST') {
      const q = JSON.parse(await body(req)), { doc } = await getPdfDoc(q.name);
      fontService.context(doc, q.i, q.idx, q.text);
      return json(res, 200, doc.fontStatus(q.i, q.idx, q.text));
    }
    if (url.pathname === '/api/pdf/font-recommend' && req.method === 'POST') {
      const q = JSON.parse(await body(req)), { doc } = await getPdfDoc(q.name);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      try { return json(res, 200, await fontService.recommend(doc, q, ai, controller.signal)); }
      finally { clearTimeout(timer); }
    }
    if (['/api/pdf/font-preview', '/api/pdf/font-apply'].includes(url.pathname) && req.method === 'POST') {
      const q = JSON.parse(await body(req)), entry = await getPdfDoc(q.name);
      const prepared = await fontService.prepare(entry.doc, q);
      if (await getPdfDoc(q.name) !== entry) throw new Error('파일이 변경됐습니다. 다시 선택하세요.');
      fontService.context(entry.doc, q.i, q.idx, q.text, q.token);
      if (url.pathname.endsWith('font-apply')) {
        const next = await pdfEngine.open(prepared.bytes);
        try {
          fontService.context(entry.doc, q.i, q.idx, q.text, q.token);
          snapshot(entry, q.i);
        } catch (error) { next.close(); throw error; }
        entry.doc.close(); entry.doc = next; entry.dirty = true;
      }
      return json(res, 200, { ...prepared.result, image: prepared.image, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/edit' && req.method === 'POST') {
      const { name, i, idx, text } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.setText(i, idx, text);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/edits' && req.method === 'POST') {
      const { name, i, edits } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const results = edits.map(({ idx, text }) => entry.doc.setText(i, idx, text));
      entry.dirty = true;
      return json(res, 200, { results, fallbackFont: results.some((r) => r.fallbackFont), ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/group' && req.method === 'POST') { // 상자 묶기(id 생략→새 그룹) / 풀기(id:null)
      const { name, i, idxs, id } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.setGroup(i, idxs, id === undefined ? undefined : id);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/fit' && req.method === 'POST') { // 폭 맞춤 편집: wrap(줄바꿈) / shrink(축소) / none
      const { name, i, idx, text, maxWidth, mode } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.fitText(i, idx, text, +maxWidth, mode);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/charboxes' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, doc.charBoxes(+url.searchParams.get('i'), +url.searchParams.get('idx')));
    }
    if (url.pathname === '/api/pdf/move' && req.method === 'POST') {
      const { name, i, idxs, dx, dy } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.move(i, idxs, dx, dy);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/rect' && req.method === 'POST') {
      const { name, i, bounds, color } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const col = color === 'auto' ? entry.doc.sampleColor(i, bounds) : (color || [0, 0, 0, 255]); // 'auto' = 그 자리 배경색
      const r = entry.doc.addRect(i, bounds, col);
      entry.dirty = true;
      return json(res, 200, { ...r, color: col, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/remove' && req.method === 'POST') {
      const { name, i, idx } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.removeObject(i, idx);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redact' && req.method === 'POST') {
      const { name, i, idx, from, to } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.redact(i, idx, from, to);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/mask' && req.method === 'POST') {
      const { name, i, parts, fallbackRects, color } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const rects = [], skipped = [];
      const colFor = (b) => (color === 'auto' ? entry.doc.sampleColor(i, b) : (color || [0, 0, 0, 255])); // 'auto' = 그 자리 배경색
      // redact가 idx+1에 새 텍스트 객체를 끼워넣어 뒤 인덱스를 밀어내므로, 앞 인덱스가 안 밀리도록 뒤에서부터 처리
      const sorted = [...parts].sort((a, b) => b.idx - a.idx);
      for (const { idx, from, to } of sorted) {
        const r = entry.doc.redact(i, idx, from, to, color === 'auto' ? 'auto' : (color || undefined));
        if (r.ok) { rects.push(...r.rects); continue; } // redact가 이미 사각형을 얹었다
        // 글자 단위로 못 자르는 객체(조각 텍스트 charmap, 회전·기울임 rotated): 객체 전체를 공백으로 지우고 상자를 따로 덮는다
        if (r.reason === 'charmap' || r.reason === 'rotated') {
          const obj = entry.doc.objects(i)[idx];
          const col = obj && obj.bounds ? colFor(obj.bounds) : null; // 글자를 지우기 전에 색을 잰다
          entry.doc.setText(i, idx, ' ');
          if (obj && obj.bounds) { entry.doc.addRect(i, obj.bounds, col); rects.push(obj.bounds); }
        } else skipped.push({ idx, reason: r.reason });
      }
      for (const b of (fallbackRects || [])) { entry.doc.addRect(i, b, colFor(b)); rects.push(b); }
      entry.dirty = true;
      return json(res, 200, { ok: true, rects, skipped, textLeft: entry.doc.pageText(i), ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/undo' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      if (!entry.undo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.undo.pop();
      entry.redo.push({ bytes: entry.doc.save(), page });
      await swapDoc(entry, bytes);
      entry.dirty = true;
      return json(res, 200, { ok: true, page, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redo' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      if (!entry.redo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.redo.pop();
      entry.undo.push({ bytes: entry.doc.save(), page });
      await swapDoc(entry, bytes);
      entry.dirty = true;
      return json(res, 200, { ok: true, page, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/text' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, { text: doc.pageText(+url.searchParams.get('i')) });
    }
    if (url.pathname === '/api/pdf/save' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      const p = safe(name);
      writeAtomic(p, entry.doc.save());
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pdf/saveas' && req.method === 'POST') {
      const { name, to } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      const p = safe(to);
      writeAtomic(p, entry.doc.save());
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false;
      if (name !== to) { delete pdfDocs[name]; if (pdfDocs[to]) pdfDocs[to].doc.close(); pdfDocs[to] = entry; }
      return json(res, 200, { ok: true, path: to });
    }
    if (url.pathname === '/api/pdf/close' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      if (pdfDocs[name]) { pdfDocs[name].doc.close(); delete pdfDocs[name]; }
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { mode, doc, name, q, model, provider = 'claude' } = JSON.parse(await body(req));
      if (!['claude', 'codex'].includes(provider)) return json(res, 400, { error: '지원하지 않는 AI 공급자' });
      if (!PROMPTS[mode]) return json(res, 400, { error: '잘못된 모드' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
      // 사용자가 [중지]를 누르거나 창을 닫아 연결이 끊기면 CLI 호출도 함께 끊는다(토큰·시간 낭비 방지)
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableFinished) controller.abort(); });
      try {
        const key = `${provider}\0${name}`;
        const saved = mode === 'chat' && sessions[key]?.model === model ? sessions[key] : null;
        const session = saved && ai.sessionValid(provider, saved.id) ? saved.id : undefined; // 편집은 매번 문서 전체를 새로 넘김
        const run = (resume) => ai.ask(provider, { prompt: PROMPTS[mode === 'chat' && resume ? 'chatMore' : mode](doc, name, q), model, session: resume, signal: controller.signal }, (text) => send({ delta: text }));
        let result;
        try { result = await run(session); }
        catch (e) { // 이어가던 대화를 CLI가 잃었으면(업데이트·세션 파일 정리 등) 문서를 다시 넣어 새 대화로 한 번 더 시도
          if (!session || e.aborted) throw e;
          delete sessions[key]; send({ notice: '이전 대화를 이어갈 수 없어 새 대화로 다시 보냅니다' });
          result = await run(undefined);
        }
        if (mode === 'chat' && result.session) sessions[key] = { model, id: result.session };
        send({ done: { ...result, provider } });
      } catch (e) { if (!controller.signal.aborted) send({ error: e.message }); }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); else res.end(); }
});
server.on('error', (e) => console.error('server:', e.message));
server.listen(PORT, '127.0.0.1', () => console.log(`EDITOR_KIM → http://localhost:${PORT}  workspace=${WS}`));
process.once('exit', () => ai.close());
module.exports = { PORT };
