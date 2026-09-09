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
// 기본 작업 폴더. 패키징된 앱에서는 __dirname이 app.asar 안이라 소스 옆 workspace는 읽기만 되고 저장이 실패한다
// → 사용자 문서 폴더 아래 EDITOR_KIM을 만들고 첫 실행에만 샘플을 복사해 쓴다. 개발 실행(npm start / node server.js)은 저장소의 workspace 그대로
const SAMPLES = path.join(ROOT, '..', 'workspace');
const PACKAGED = /[\\/]app\.asar[\\/]/i.test(ROOT);
function defaultWorkspace() {
  if (!PACKAGED) return SAMPLES;
  let documents = path.join(os.homedir(), 'Documents');
  try { documents = require('electron').app.getPath('documents'); } catch {}
  for (const dir of [path.join(documents, 'EDITOR_KIM'), path.join(os.homedir(), 'EDITOR_KIM')]) {
    try {
      if (!fs.existsSync(dir)) { // 사용자가 지운 샘플을 되살리지 않도록 폴더가 없을 때만 복사
        fs.mkdirSync(dir, { recursive: true });
        for (const name of ['sample.pdf', '회의록_초안.md', '회의록_초안.pdf']) {
          try { fs.copyFileSync(path.join(SAMPLES, name), path.join(dir, name)); } catch {}
        }
      }
      return dir;
    } catch (e) { console.error(`workspace ${dir}: ${e.message}`); }
  }
  return os.tmpdir();
}
let WS = conf.workspace && fs.existsSync(conf.workspace) ? conf.workspace : defaultWorkspace();
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

// P5 WP-B2: 용량 줄이기의 "목표 용량까지 반복" 로직을 공유 함수로 뽑는다 — /api/pdf/downsample(열린 문서)와
// /api/pdf/downsample-files(파일 여러 개, 열지 않고 처리)가 함께 쓴다. entry는 { doc } 모양이면 충분(undo/redo는 호출자 몫).
async function downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes }) {
  if (!targetBytes) { // 목표 용량 없이 한 번만 실행
    const r = entry.doc.downsample({ maxDpi, quality });
    return {
      before: r.before, after: r.after, changed: r.changed, skipped: r.skipped,
      reached: true, used: { maxDpi, quality }, attempts: [{ maxDpi, quality, before: r.before, after: r.after, changed: r.changed }],
    };
  }
  // 목표 용량이 있으면: maxDpi를 [입력,120,96,72] 순, quality를 [입력,60,45] 순으로 낮추며 반복. 매 시도는 원본에서 다시 시작한다.
  const dpis = [...new Set([maxDpi, 120, 96, 72])];
  const quals = [...new Set([quality, 60, 45])];
  const attempts = [];
  let best = null, reached = false, finalResult = null;
  outer:
  for (const d of dpis) {
    for (const qv of quals) {
      await swapDoc(entry, originalBytes);
      const r = entry.doc.downsample({ maxDpi: d, quality: qv });
      attempts.push({ maxDpi: d, quality: qv, before: r.before, after: r.after, changed: r.changed, skipped: r.skipped.length });
      if (!best || r.after < best.after) best = { maxDpi: d, quality: qv, bytes: entry.doc.save(), result: r };
      if (r.after <= targetBytes) { reached = true; finalResult = { maxDpi: d, quality: qv, result: r }; break outer; }
    }
  }
  if (!reached) { await swapDoc(entry, best.bytes); finalResult = { maxDpi: best.maxDpi, quality: best.quality, result: best.result }; }
  return {
    before: originalBytes.length, after: finalResult.result.after, changed: finalResult.result.changed, skipped: finalResult.result.skipped,
    reached, used: { maxDpi: finalResult.maxDpi, quality: finalResult.quality }, attempts,
  };
}
// 건너뛴 이미지 대부분이 투명(SMask)이면 더 줄일 방법이 없다는 힌트를 덧붙인다 (downsample·downsample-files 공용)
function downsampleHint(skipped) {
  const alphaCount = skipped.filter((s) => s.reason === '투명(SMask)').length;
  return skipped.length && alphaCount / skipped.length > 0.5 ? { hint: '투명 이미지가 많아 더 줄일 수 없습니다' } : {};
}

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
// 인터넷에서 받아 연결 프로그램으로 바로 연 파일인지 판정한다(WP-B1: 임시 위치면 저장을 "다른 이름으로"로 유도).
// 브라우저·메일 클라이언트의 임시 다운로드 폴더 이름을 폭넓게 잡되, Downloads(사용자가 내려받아 보관하는 곳)는 임시로 치지 않는다.
const TEMP_DIR_ROOTS = [os.tmpdir(), path.join(process.env.LOCALAPPDATA || '', 'Temp')]
  .filter(Boolean).map((p) => path.resolve(p).toLowerCase());
const TEMP_NAME_MARKERS = ['inetcache', 'temporary internet files', 'content.outlook']; // 대소문자 무시, 경로 어디든 있으면 임시로 본다
function isTempPath(p) {
  const norm = path.resolve(p).toLowerCase();
  if (/[\\/]downloads[\\/]/.test(norm)) return false; // 사용자가 내려받아 보관하는 위치는 임시가 아님
  if (TEMP_DIR_ROOTS.some((root) => norm === root || norm.startsWith(root + path.sep))) return true;
  return TEMP_NAME_MARKERS.some((marker) => norm.includes(marker));
}
function isReadOnlyPath(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return false; } catch { return true; }
}
// JPEG의 SOF0/SOF2(비-차등, 허프만) 마커에서 픽셀 크기를 읽는다(이미지 삽입 시 종횡비 유지용). 못 찾으면 null.
// 마커 포맷: 0xFF 0xC0~0xCF(단, C4/C8/CC 제외) 뒤에 length(2B) + precision(1B) + height(2B) + width(2B)
function jpegSize(buf) {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xff) { off++; continue; } // 채움 바이트
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xd9) break; // EOI
    const len = buf.readUInt16BE(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
// 로컬 요청만 받는다. Host 검사는 DNS 리바인딩(외부 도메인을 127.0.0.1로 돌려 같은 출처처럼 요청) 방지, Origin 검사는 다른 사이트의 교차 출처 요청 방지
let port = PORT; // 실제로 연 포트 — 기본 포트가 다른 프로그램에 잡혀 있으면 아래 listen이 다음 포트로 옮긴다
const localHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
const trustedRequest = (req) => localHosts().includes(req.headers.host || '')
  && (!req.headers.origin || localHosts().map((h) => `http://${h}`).includes(req.headers.origin));

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
      // Markdown은 원문 스트림이라 JSON 필드를 못 넣는다 → temp/readOnly는 헤더로 실어 보낸다(렌더러가 fetch 응답 헤더에서 읽음)
      res.writeHead(200, {
        'Content-Type': p.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8',
        'X-Editor-Kim-Temp': isTempPath(p) ? '1' : '0',
        'X-Editor-Kim-Readonly': isReadOnlyPath(p) ? '1' : '0',
      });
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
      const name = url.searchParams.get('name');
      const entry = await getPdfDoc(name);
      const p = safe(name);
      return json(res, 200, {
        pages: Array.from({ length: entry.doc.pageCount }, (_, i) => entry.doc.pageSize(i)), dirty: entry.dirty,
        temp: isTempPath(p), readOnly: isReadOnlyPath(p), ...stacks(entry),
      });
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
    // ── P4 WP-B2: 이미지 변환·페이지 추출·병합·이미지 삽입·용량 압축 ────────────
    if (url.pathname === '/api/pdf/export-images' && req.method === 'POST') { // 문서 상태는 바꾸지 않으므로 snapshot 없음
      const { name, pages, format, dpi, dir } = JSON.parse(await body(req));
      const { doc } = await getPdfDoc(name);
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 400, { error: '저장할 폴더를 찾을 수 없습니다' });
      const scale = Math.max(36, Math.min(600, Number(dpi) || 150)) / 72;
      const base = path.basename(name).replace(/\.pdf$/i, '');
      const list = Array.isArray(pages) && pages.length ? pages.map(Number) : Array.from({ length: doc.pageCount }, (_, i) => i);
      const files = [];
      for (const i of list) {
        const num = String(i + 1).padStart(2, '0');
        if (format === 'jpeg') {
          const file = path.join(dir, `${base}-p${num}.jpg`);
          fs.writeFileSync(file, doc.renderJpeg(i, scale, 85));
          files.push(file);
        } else {
          const file = path.join(dir, `${base}-p${num}.png`);
          fs.writeFileSync(file, await doc.render(i, scale));
          files.push(file);
        }
      }
      return json(res, 200, { files });
    }
    if (url.pathname === '/api/pdf/pages/delete' && req.method === 'POST') { // page:null 스냅샷 → undo/redo가 reloadAll을 준다
      const { name, indices } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, null);
      const r = entry.doc.deletePages(indices);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    // ── P5 WP-B2: 회전·순서 변경·추출·분할·검색 ──────────────────────────────
    if (url.pathname === '/api/pdf/pages/rotate' && req.method === 'POST') { // page:null 스냅샷 → 회전은 쪽 크기(가로/세로)가 뒤바뀌어 문서 전체를 다시 그린다
      const { name, indices, delta } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, null);
      const r = entry.doc.rotatePages(indices, delta);
      entry.dirty = true;
      return json(res, 200, { ...r, reloadAll: true, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/pages/reorder' && req.method === 'POST') { // FPDF_MovePages가 페이지 캐시를 비우므로 문서 전체를 다시 그린다(swapDoc은 불필요)
      const { name, order } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, null);
      const r = entry.doc.reorderPages(order);
      entry.dirty = true;
      return json(res, 200, { ...r, reloadAll: true, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/pages/extract' && req.method === 'POST') { // 새 문서를 만드는 동작이라 실행취소 스택에는 넣지 않는다(병합과 같은 이유)
      const { name, indices, out } = JSON.parse(await body(req));
      const { doc } = await getPdfDoc(name);
      const bytes = doc.extractPages(indices);
      const outPath = safe(out);
      writeAtomic(outPath, bytes);
      if (pdfDocs[out]) { pdfDocs[out].doc.close(); delete pdfDocs[out]; } // 같은 이름으로 이미 열려 있었으면 캐시를 버려 새 내용을 읽게 한다
      const check = await pdfEngine.open(bytes);
      const pageCount = check.pageCount;
      check.close();
      return json(res, 200, { path: out, pageCount });
    }
    if (url.pathname === '/api/pdf/split' && req.method === 'POST') { // N쪽씩 잘라 <이름>-1.pdf, -2.pdf … 로 폴더에 저장 (extractPages 반복 호출, 원본 불변)
      const { name, every, outDir } = JSON.parse(await body(req));
      const { doc } = await getPdfDoc(name);
      const n = Number(every);
      if (!Number.isInteger(n) || n < 1) return json(res, 400, { error: '쪽 수는 1 이상의 정수로 입력하세요' });
      const dir = safe(outDir);
      if (!outDir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 400, { error: '저장할 폴더를 찾을 수 없습니다' });
      const base = path.basename(name).replace(/\.pdf$/i, '');
      const files = [];
      for (let start = 0, part = 1; start < doc.pageCount; start += n, part++) {
        const indices = Array.from({ length: Math.min(n, doc.pageCount - start) }, (_, k) => start + k);
        const bytes = doc.extractPages(indices);
        const file = path.join(dir, `${base}-${part}.pdf`);
        writeAtomic(file, bytes);
        files.push(file);
      }
      return json(res, 200, { files });
    }
    // 빈 질의는 PDFium FindNext가 영영 돌아오지 않는다(엔진 주석 참고) → 라우트 입구에서 바로 거절한다. 문서를 열기 전에 검사해 헛되이 열지 않는다.
    if (url.pathname === '/api/pdf/find' && req.method === 'POST') {
      const { name, query, matchCase } = JSON.parse(await body(req));
      if (!query) return json(res, 400, { error: '검색어를 입력하세요' });
      const { doc } = await getPdfDoc(name);
      const LIMIT = 500;
      const hits = [];
      let truncated = false;
      for (let i = 0; i < doc.pageCount; i++) {
        const found = doc.find(i, query, { matchCase: !!matchCase, limit: LIMIT - hits.length });
        for (const f of found) hits.push({ i, ...f });
        if (hits.length >= LIMIT) { truncated = true; break; }
      }
      return json(res, 200, { hits, total: hits.length, truncated });
    }
    if (url.pathname === '/api/pdf/merge' && req.method === 'POST') { // 새 파일을 만드는 동작이라 실행취소 스택에는 넣지 않는다(대상이 열려 있던 문서면 캐시만 닫는다)
      const { paths, out } = JSON.parse(await body(req));
      const list = [].concat(paths || []);
      if (!list.length) return json(res, 400, { error: '병합할 파일이 없습니다' });
      const buffers = list.map((p) => fs.readFileSync(safe(p)));
      const merged = await pdfEngine.merge(buffers);
      writeAtomic(safe(out), merged);
      if (pdfDocs[out]) { pdfDocs[out].doc.close(); delete pdfDocs[out]; }
      const check = await pdfEngine.open(merged);
      const pageCount = check.pageCount;
      check.close();
      return json(res, 200, { path: out, pageCount });
    }
    if (url.pathname === '/api/pdf/image' && req.method === 'POST') {
      const { name, i, path: imgPath, box } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      const imgFile = safe(imgPath || ''); // 다른 파일 경로와 같은 규칙(절대경로 그대로, 상대경로는 작업 폴더 안)
      const ext = path.extname(imgFile).toLowerCase();
      let image, imgW, imgH;
      if (ext === '.jpg' || ext === '.jpeg') {
        const data = fs.readFileSync(imgFile);
        const size = jpegSize(data);
        if (!size) return json(res, 400, { error: 'JPEG 크기를 읽을 수 없습니다' });
        image = { kind: 'jpeg', data }; imgW = size.width; imgH = size.height;
      } else if (ext === '.png') {
        if (!process.versions.electron) return json(res, 400, { error: 'PNG 삽입은 Electron 앱에서만 지원합니다. JPEG를 사용하세요.' });
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromPath(imgFile);
        const { width, height } = img.getSize();
        if (!width || !height) return json(res, 400, { error: '이미지를 읽을 수 없습니다' });
        const bgra = img.toBitmap(); // BGRA → RGBA
        const rgba = Buffer.alloc(bgra.length);
        for (let k = 0; k < bgra.length; k += 4) { rgba[k] = bgra[k + 2]; rgba[k + 1] = bgra[k + 1]; rgba[k + 2] = bgra[k]; rgba[k + 3] = bgra[k + 3]; }
        image = { kind: 'rgba', data: rgba, width, height }; imgW = width; imgH = height;
      } else return json(res, 400, { error: '지원하지 않는 이미지 형식입니다 (PNG/JPEG만 가능)' });
      let finalBox = box;
      if (!finalBox) {
        const { w: pw, h: ph } = entry.doc.pageSize(i);
        const boxW = pw * 0.4, boxH = boxW * (imgH / imgW);
        finalBox = { x: (pw - boxW) / 2, y: (ph - boxH) / 2, w: boxW, h: boxH };
      }
      snapshot(entry, i);
      const r = entry.doc.insertImage(i, image, finalBox);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/object/resize' && req.method === 'POST') {
      const { name, i, idx, box } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      snapshot(entry, i);
      const r = entry.doc.resizeObject(i, idx, box);
      entry.dirty = true;
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/images' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      const images = []; let totalBytes = 0;
      for (let i = 0; i < entry.doc.pageCount; i++) {
        for (const st of entry.doc.imageStats(i)) { images.push({ page: i, ...st }); totalBytes += st.bytes; }
      }
      const fileBytes = fs.statSync(safe(name)).size;
      return json(res, 200, { images, totalBytes, fileBytes });
    }
    if (url.pathname === '/api/pdf/downsample' && req.method === 'POST') {
      const q = JSON.parse(await body(req));
      const { name, targetBytes } = q;
      const maxDpi = Number(q.maxDpi) > 0 ? Number(q.maxDpi) : 150;
      const quality = Number(q.quality) > 0 ? Number(q.quality) : 75;
      const entry = await getPdfDoc(name);
      snapshot(entry, null); // 문서 전체 스냅샷 — undo/redo가 reloadAll을 준다
      const originalBytes = entry.undo[entry.undo.length - 1].bytes;
      const result = await downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes });
      entry.dirty = true;
      return json(res, 200, { ...result, ...downsampleHint(result.skipped), ...stacks(entry) });
    }
    // P5 WP-B2: 빈 상태 빠른 도구 "여러 파일 용량 줄이기" — 문서를 열어 두지 않고 파일 경로 여러 개를 바로 처리한다.
    // 각 파일을 열어 downsampleToTarget을 돌리고 "<이름>-축소.pdf"로 저장한다(원본은 건드리지 않음, 실행취소 스택도 없음).
    if (url.pathname === '/api/pdf/downsample-files' && req.method === 'POST') {
      const q = JSON.parse(await body(req));
      const paths = [].concat(q.paths || []);
      if (!paths.length) return json(res, 400, { error: '파일을 선택하세요' });
      const maxDpi = Number(q.maxDpi) > 0 ? Number(q.maxDpi) : 150;
      const quality = Number(q.quality) > 0 ? Number(q.quality) : 75;
      const targetBytes = q.targetBytes;
      const results = [];
      for (const p of paths) {
        let entry = null;
        try {
          const src = safe(p);
          const originalBytes = fs.readFileSync(src);
          entry = { doc: await pdfEngine.open(originalBytes) };
          const result = await downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes });
          const dir = q.outDir ? safe(q.outDir) : path.dirname(src);
          const outPath = path.join(dir, path.basename(src).replace(/\.pdf$/i, '') + '-축소.pdf');
          writeAtomic(outPath, entry.doc.save());
          results.push({ path: p, out: outPath, before: result.before, after: result.after, reached: result.reached, used: result.used, ...downsampleHint(result.skipped) });
        } catch (e) { results.push({ path: p, error: e.message }); }
        finally { if (entry) entry.doc.close(); }
      }
      return json(res, 200, { results });
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
      return json(res, 200, { ok: true, page, reloadAll: page === null, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redo' && req.method === 'POST') {
      const { name } = JSON.parse(await body(req));
      const entry = await getPdfDoc(name);
      if (!entry.redo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.redo.pop();
      entry.undo.push({ bytes: entry.doc.save(), page });
      await swapDoc(entry, bytes);
      entry.dirty = true;
      return json(res, 200, { ok: true, page, reloadAll: page === null, ...stacks(entry) });
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
// 기본 포트가 사용 중이면(다른 프로그램, 개발용 서버) 다음 포트를 차례로 시도한다. ready는 실제로 연 포트로 resolve — Electron 창은 이 포트로 접속
// listen(p, cb)의 cb는 'listening' 리스너로 남아 실패한 시도의 것까지 다음 성공 때 함께 불린다 → 리스너를 직접 달고 실패하면 떼어 낸다
const ready = new Promise((resolve, reject) => {
  const listen = (p, retries) => {
    const onError = (e) => {
      server.off('listening', onListening);
      if (e.code === 'EADDRINUSE' && retries > 0) { console.warn(`포트 ${p} 사용 중 → ${p + 1} 시도`); return listen(p + 1, retries - 1); }
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError); server.on('error', (e) => console.error('server:', e.message));
      port = server.address().port; console.log(`EDITOR_KIM → http://localhost:${port}  workspace=${WS}`); resolve(port);
    };
    server.once('error', onError); server.once('listening', onListening);
    server.listen(p, '127.0.0.1');
  };
  listen(PORT, 10);
});
ready.catch((e) => console.error('server:', e.message));
process.once('exit', () => ai.close());
module.exports = { PORT, ready, port: () => port };
