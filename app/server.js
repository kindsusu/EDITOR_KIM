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
const APP_VERSION = require('../package.json').version;
const ai = require('./ai-providers').createProviders({ version: APP_VERSION });

let conf = {}; try { conf = JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch {}
let WS = conf.workspace && fs.existsSync(conf.workspace) ? conf.workspace : path.join(ROOT, '..', 'workspace');
const sessions = {}; // `${provider}\0${문서명}` → { model, id }
const pdfDocs = {}; // 파일명 → { doc, mtimeMs, dirty }

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

// 절대경로는 그대로 씀 (로컬 단일 사용자 데스크톱 앱, OS 파일 대화상자에서 온 경로). 상대경로는 WS 밖으로 나갈 수 없다.
const safe = (p) => {
  if (p && path.isAbsolute(p)) return path.resolve(p);
  const abs = path.resolve(WS, p || ''), relative = path.relative(path.resolve(WS), abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('bad path');
  return abs;
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const trustedOrigin = (req) => !req.headers.origin || [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(req.headers.origin);

const PROMPTS = {
  chat: (doc, name, q) => `아래는 사용자가 열어둔 문서 "${name}"의 내용이다. 문서에 근거해 한국어로 간결하게 답하라. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n질문: ${q}`,
  chatMore: (_doc, _name, q) => q, // 같은 세션의 후속 질문: 문서는 이미 대화에 있음
  edit: (doc, name, q) => `아래 Markdown 문서 "${name}"를 지시대로 수정하라. 출력은 수정된 문서 전체만, 코드펜스나 설명 없이 그대로 출력할 것. 지시와 무관한 부분은 바꾸지 말 것. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n지시: ${q}`,
  editText: (doc, name, q) => `아래 텍스트를 지시대로 고쳐라. 출력은 고친 텍스트만, 설명 없이.\n\n<text>\n${doc}\n</text>\n\n지시: ${q}`,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!trustedOrigin(req)) return json(res, 403, { error: '허용되지 않은 요청 출처' });
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); }
    if (url.pathname === '/vendor/marked.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(MARKED_BROWSER).pipe(res); }
    if (url.pathname === '/vendor/purify.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(DOMPURIFY_BROWSER).pipe(res); }
    if (url.pathname === '/api/health') return json(res, 200, { appVersion: APP_VERSION, providers: await ai.health() });
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
    if (url.pathname === '/api/file' && req.method === 'PUT') { fs.writeFileSync(safe(url.searchParams.get('name')), await body(req)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/session/reset' && req.method === 'POST') {
      const { name, provider } = JSON.parse(await body(req));
      if (provider) delete sessions[`${provider}\0${name}`];
      else for (const key of Object.keys(sessions)) if (key.endsWith(`\0${name}`)) delete sessions[key];
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pdf/info' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, { pages: Array.from({ length: doc.pageCount }, (_, i) => doc.pageSize(i)) });
    }
    if (url.pathname === '/api/pdf/page' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      const png = await doc.render(+url.searchParams.get('i'), +(url.searchParams.get('scale') || 1.5));
      res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png);
    }
    if (url.pathname === '/api/pdf/objects' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, doc.objects(+url.searchParams.get('i')));
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
      const rects = [];
      const colFor = (b) => (color === 'auto' ? entry.doc.sampleColor(i, b) : (color || [0, 0, 0, 255])); // 'auto' = 그 자리 배경색
      // redact가 idx+1에 새 텍스트 객체를 끼워넣어 뒤 인덱스를 밀어내므로, 앞 인덱스가 안 밀리도록 뒤에서부터 처리
      const sorted = [...parts].sort((a, b) => b.idx - a.idx);
      for (const { idx, from, to } of sorted) {
        const r = entry.doc.redact(i, idx, from, to, color === 'auto' ? 'auto' : (color || undefined));
        if (r.ok) { rects.push(...r.rects); continue; } // redact가 이미 사각형을 얹었다
        if (r.reason === 'charmap') { // 조각 텍스트: 문자맵 매칭이 안 되니 공백으로 지우고 사각형은 따로 덮는다
          const obj = entry.doc.objects(i)[idx];
          const col = obj && obj.bounds ? colFor(obj.bounds) : null; // 글자를 지우기 전에 색을 잰다
          entry.doc.setText(i, idx, ' ');
          if (obj && obj.bounds) { entry.doc.addRect(i, obj.bounds, col); rects.push(obj.bounds); }
        }
      }
      for (const b of (fallbackRects || [])) { entry.doc.addRect(i, b, colFor(b)); rects.push(b); }
      entry.dirty = true;
      return json(res, 200, { ok: true, rects, textLeft: entry.doc.pageText(i), ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/undo' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      if (!entry.undo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.undo.pop();
      entry.redo.push({ bytes: entry.doc.save(), page });
      entry.doc.close();
      entry.doc = await pdfEngine.open(bytes);
      entry.dirty = true;
      return json(res, 200, { ok: true, page, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redo' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      if (!entry.redo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.redo.pop();
      entry.undo.push({ bytes: entry.doc.save(), page });
      entry.doc.close();
      entry.doc = await pdfEngine.open(bytes);
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
      const p = safe(name), tmp = p + '.tmp';
      fs.writeFileSync(tmp, entry.doc.save()); fs.renameSync(tmp, p); // 크래시로 원본이 잘리지 않도록 임시파일 경유
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pdf/saveas' && req.method === 'POST') {
      const { name, to } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      const p = safe(to), tmp = p + '.tmp';
      fs.writeFileSync(tmp, entry.doc.save()); fs.renameSync(tmp, p);
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false;
      if (name !== to) { delete pdfDocs[name]; pdfDocs[to] = entry; }
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
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      try {
        const key = `${provider}\0${name}`;
        const saved = mode === 'chat' && sessions[key]?.model === model ? sessions[key] : null;
        const session = saved && ai.sessionValid(provider, saved.id) ? saved.id : undefined; // 편집은 매번 문서 전체를 새로 넘김
        const prompt = PROMPTS[mode === 'chat' && session ? 'chatMore' : mode](doc, name, q);
        const result = await ai.ask(provider, { prompt, model, session }, (text) => send({ delta: text }));
        if (mode === 'chat' && result.session) sessions[key] = { model, id: result.session };
        send({ done: { ...result, provider } });
      } catch (e) { send({ error: e.message }); }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.on('error', (e) => console.error('server:', e.message));
server.listen(PORT, '127.0.0.1', () => console.log(`EDITOR_KIM → http://localhost:${PORT}  workspace=${WS}`));
process.once('exit', () => ai.close());
module.exports = { PORT };
