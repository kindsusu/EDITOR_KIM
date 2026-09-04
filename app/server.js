// 대필 백엔드: 정적 UI + 파일 읽기/쓰기 + Claude Code CLI 호출 (API 키 없음, 구독 로그인 사용)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = __dirname;
const PORT = 4747;
const CONF = path.join(os.homedir(), '.su-daepil.json');
const ENV = { ...process.env, CLAUDECODE: '' }; // 중첩 세션 검사 회피
const pdfEngine = require('./pdf-engine');
const APP_VERSION = require('../package.json').version;

let conf = {}; try { conf = JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch {}
let WS = conf.workspace && fs.existsSync(conf.workspace) ? conf.workspace : path.join(ROOT, '..', 'workspace');
const sessions = {}; // 문서명 → claude 세션 ID (대화 이어가기)
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

// 절대경로는 그대로 씀 (로컬 단일 사용자 데스크톱 앱, OS 파일 대화상자에서 온 경로). 상대경로는 여전히 WS 안으로 제한.
const safe = (p) => {
  if (p && path.isAbsolute(p)) return path.resolve(p);
  const abs = path.resolve(WS, p || ''); if (!abs.startsWith(WS)) throw new Error('bad path'); return abs;
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
// claude 실행 파일 위치 (설치 후 [다시 확인] 시 재탐색). npm 설치본은 .cmd라 shell 필요
let CLAUDE = null;
const findClaude = () => new Promise((r) => execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], (e, out) => {
  const lines = e ? [] : String(out).split(/\r?\n/).filter(Boolean);
  r(CLAUDE = lines.find((l) => /\.exe$/i.test(l)) || lines[0] || null);
}));
const opts = () => ({ env: ENV, shell: /\.cmd$/i.test(CLAUDE || '') });
const run = (args) => new Promise((r) => CLAUDE ? execFile(CLAUDE, args, opts(), (e, out) => r(e ? null : String(out).trim())) : r(null));

// ---- Claude Code 설치·로그인 상태 ----
async function health() {
  if (!CLAUDE) await findClaude();
  const version = await run(['--version']);
  if (!version) return { installed: false, appVersion: APP_VERSION };
  let auth = {}; try { auth = JSON.parse(await run(['auth', 'status'])); } catch {}
  return { installed: true, version, loggedIn: !!auth.loggedIn, authMethod: auth.authMethod, appVersion: APP_VERSION };
}
// 사용자가 진행 상황을 보도록 별도 PowerShell 창에서 실행
const openConsole = (cmd) => spawn('powershell', ['-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { detached: true, stdio: 'ignore', env: ENV }).unref();

// ---- Claude 호출: stdin으로 프롬프트, stream-json으로 토큰 단위 수신 ----
function askClaude({ prompt, model, session }, onDelta) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model || 'sonnet'];
    if (session) args.push('--resume', session);
    if (!CLAUDE) return reject(new Error('Claude Code가 설치되어 있지 않습니다'));
    const child = spawn(CLAUDE, args, opts());
    let buf = '', text = '', result = null, err = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') { text += ev.event.delta.text; onDelta(ev.event.delta.text); }
        else if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0 && !result) return reject(new Error(err || `claude exit ${code}`));
      resolve({ text: text || result?.result || '', cost: result?.total_cost_usd, ms: result?.duration_api_ms, session: result?.session_id, model: result?.modelUsage && Object.keys(result.modelUsage)[0] });
    });
    child.stdin.end(prompt);
  });
}

const PROMPTS = {
  chat: (doc, name, q) => `아래는 사용자가 열어둔 문서 "${name}"의 내용이다. 문서에 근거해 한국어로 간결하게 답하라. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n질문: ${q}`,
  chatMore: (_doc, _name, q) => q, // 같은 세션의 후속 질문: 문서는 이미 대화에 있음
  edit: (doc, name, q) => `아래 Markdown 문서 "${name}"를 지시대로 수정하라. 출력은 수정된 문서 전체만, 코드펜스나 설명 없이 그대로 출력할 것. 지시와 무관한 부분은 바꾸지 말 것. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n지시: ${q}`,
  editText: (doc, name, q) => `아래 텍스트를 지시대로 고쳐라. 출력은 고친 텍스트만, 설명 없이.\n\n<text>\n${doc}\n</text>\n\n지시: ${q}`,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); }
    if (url.pathname === '/api/health') return json(res, 200, await health());
    if (url.pathname === '/api/setup/install') { openConsole('irm https://claude.ai/install.ps1 | iex'); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/setup/login') { openConsole('claude auth login'); return json(res, 200, { ok: true }); }
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
    if (url.pathname === '/api/session/reset' && req.method === 'POST') { delete sessions[JSON.parse(await body(req)).name]; return json(res, 200, { ok: true }); }
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
      const r = entry.doc.addRect(i, bounds, color || [0, 0, 0, 255]);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
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
      const { name, i, parts, fallbackRects } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const rects = [];
      // redact가 idx+1에 새 텍스트 객체를 끼워넣어 뒤 인덱스를 밀어내므로, 앞 인덱스가 안 밀리도록 뒤에서부터 처리
      const sorted = [...parts].sort((a, b) => b.idx - a.idx);
      for (const { idx, from, to } of sorted) {
        const r = entry.doc.redact(i, idx, from, to);
        if (r.ok) { rects.push(...r.rects); continue; } // redact가 이미 검은 사각형을 얹었다
        if (r.reason === 'charmap') { // 조각 텍스트: 문자맵 매칭이 안 되니 공백으로 지우고 사각형은 따로 덮는다
          const obj = entry.doc.objects(i)[idx];
          entry.doc.setText(i, idx, ' ');
          if (obj && obj.bounds) { entry.doc.addRect(i, obj.bounds, [0, 0, 0, 255]); rects.push(obj.bounds); }
        }
      }
      for (const b of (fallbackRects || [])) { entry.doc.addRect(i, b, [0, 0, 0, 255]); rects.push(b); }
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
      const { mode, doc, name, q, model } = JSON.parse(await body(req));
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      try {
        const session = mode === 'chat' ? sessions[name] : undefined; // 편집은 매번 문서 전체를 새로 넘김
        const prompt = PROMPTS[mode === 'chat' && session ? 'chatMore' : mode](doc, name, q);
        const r = await askClaude({ prompt, model, session }, (t) => send({ delta: t }));
        if (mode === 'chat' && r.session) sessions[name] = r.session;
        send({ done: r });
      } catch (e) { send({ error: e.message }); }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.on('error', (e) => console.error('server:', e.message));
server.listen(PORT, '127.0.0.1', () => console.log(`대필 → http://localhost:${PORT}  workspace=${WS}`));
module.exports = { PORT };
