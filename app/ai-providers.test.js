const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseClaudeAuth, parseCodexAuth, pickExecutable } = require('./ai-providers');

assert.deepStrictEqual(parseCodexAuth('Logged in using ChatGPT'), { loggedIn: true, authMethod: 'ChatGPT' });
assert.deepStrictEqual(parseCodexAuth('Logged in using API key'), { loggedIn: true, authMethod: 'API key' });
assert.deepStrictEqual(parseCodexAuth('Not logged in'), { loggedIn: false, authMethod: null });
assert.deepStrictEqual(parseClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai"}'), { loggedIn: true, authMethod: 'claude.ai' });
assert.deepStrictEqual(parseClaudeAuth('not json'), {});

// `where`가 npm의 확장자 없는 sh 스크립트를 먼저 돌려줘도 실행 가능한 .exe/.cmd를 고른다 (실제 회귀: codex가 "설치 안 됨"으로 보였음)
const npm = 'C:\\Users\\u\\AppData\\Roaming\\npm\\';
assert.strictEqual(pickExecutable([npm + 'codex', npm + 'codex.cmd'], 'win32'), npm + 'codex.cmd');
assert.strictEqual(pickExecutable([npm + 'claude', npm + 'claude.cmd', 'C:\\Links\\claude.exe'], 'win32'), 'C:\\Links\\claude.exe');
assert.strictEqual(pickExecutable([npm + 'codex'], 'win32'), null);
assert.strictEqual(pickExecutable(['/usr/local/bin/codex'], 'linux'), '/usr/local/bin/codex');
assert.strictEqual(pickExecutable([], 'win32'), null);

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const providerSource = fs.readFileSync(path.join(__dirname, 'ai-providers.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'index.html module script exists');
assert.doesNotThrow(() => new Function(script), 'index.html module script parses');
assert.match(html, /id="modelPicker"/, 'model picker exists');
assert.match(html, /id="aiToggle"/, 'AI chat toggle remains available');
assert.match(html, /id="aiRailToggle"/, 'AI panel has a persistent edge toggle');
assert.match(html, /ChatGPT \(Codex\)/, 'Codex option is presented as ChatGPT (Codex)');
assert.match(html, /pdfRenderGeneration/, 'stale PDF renders are invalidated');
assert.match(html, /DOMPurify\.sanitize\(marked\.parse/, 'Markdown preview is sanitized');
assert.doesNotMatch(html, /https:\/\/cdnjs\.cloudflare\.com/, 'UI has no CDN runtime dependency');
assert.match(html, /addEventListener\('wheel'[\s\S]*ctrlKey/, 'Ctrl+wheel zooms the PDF');
assert.match(html, /id="zoomFit"/, 'fit-to-width zoom exists');
assert.match(html, /id="stop"/, 'AI generation can be stopped');
assert.match(providerSource, /Anthropic\.ClaudeCode/, 'Claude installs from the WinGet package');
assert.match(providerSource, /OpenAI\.Codex/, 'Codex installs from the WinGet package');
assert.match(providerSource, /WindowsApps/, 'Claude Desktop app alias is excluded from CLI discovery');
assert.doesNotMatch(providerSource + serverSource, /install\.ps1|ExecutionPolicy\s+Bypass|irm\s+https:/i,
  'setup never pipes a remote PowerShell script into execution');
assert.match(serverSource, /headers\.host/, 'server checks the Host header (DNS rebinding)');
assert.match(html, /id="tempBanner"/, 'temp/read-only file banner exists (WP-B1)');
assert.match(html, /window\.editorKim\.onOpenPaths/, 'renderer wires up onOpenPaths for files opened via file association/argv (WP-B1)');

// P4 WP-B2: page extraction, merge, image export/insert, size reduction dialogs & routes
assert.match(html, /id="pageExtractDialog"/, 'page extraction dialog exists (WP-B2)');
assert.match(html, /id="mergeDialog"/, 'merge dialog exists (WP-B2)');
assert.match(html, /id="exportImagesDialog"/, 'image export dialog exists (WP-B2)');
assert.match(html, /id="downsampleDialog"/, 'downsample (size reduction) dialog exists (WP-B2)');
assert.match(html, /window\.editorKim\.openImage/, 'renderer wires up openImage for image insertion (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/export-images/, 'server exposes export-images route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/pages\/delete/, 'server exposes page delete route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/merge/, 'server exposes merge route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/image/, 'server exposes image insert route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/downsample/, 'server exposes downsample route (WP-B2)');
assert.match(serverSource, /reloadAll/, 'undo/redo responses signal reloadAll for whole-document snapshots (WP-B2)');

// P5 WP-B1: status bar, toolbar groups (dropdown removed), sidebar tabs + thumbnails, empty state / drop overlay, terminology
assert.match(html, /id="statusbar"/, 'status bar exists (WP-B1)');
assert.match(html, /id="pageNumInput"/, 'status bar has a page-number input that jumps to a page (WP-B1)');
assert.match(html, /id="statusHint"/, 'status bar has a first-run hint area (WP-B1)');
assert.match(html, /editorkim\.hintSeen/, 'first-run hint is remembered per browser via localStorage (WP-B1)');
assert.doesNotMatch(html, /id="pageMenuBtn"|id="pageMenuWrap"|class="popupMenu" id="pageMenu"/, 'the old 페이지 ▾ dropdown menu is removed in favor of direct toolbar buttons (WP-B1)');
assert.match(html, /id="groupView"/, 'toolbar has a 보기 group (WP-B1)');
assert.match(html, /id="groupEdit"/, 'toolbar has a 편집 group (WP-B1)');
assert.match(html, /id="groupPage"/, 'toolbar has a 페이지 group (WP-B1)');
assert.match(html, /id="groupDoc"/, 'toolbar has a 문서 group (WP-B1)');
assert.match(html, /id="groupSave"/, 'toolbar has a 저장 group (WP-B1)');
assert.match(html, /id="asideTabs"/, 'sidebar has 파일/페이지 tabs (WP-B1)');
assert.match(html, /id="pageThumbs"/, 'sidebar page tab renders page thumbnails (WP-B1)');
assert.match(html, /openPageCtxMenu/, 'page thumbnail right-click context menu exists (WP-B1)');
assert.match(html, /id="emptyState"/, 'empty state exists when no document is open (WP-B1)');
assert.match(html, /id="dropOverlay"/, 'full-window drag-and-drop overlay exists (WP-B1)');
assert.match(html, /id="rectTool"[^>]*>가리기</, '가리기(rect mask) toolbar button uses unified terminology, not "마스킹 삽입" (WP-B1)');
assert.match(html, /가린 영역/, 'mask panel title is renamed to 가린 영역 (WP-B1)');
assert.doesNotMatch(html, /마스킹/, 'no leftover "마스킹" wording remains in the UI (engine mark name EditorKimMask / route /api/pdf/mask are unaffected, WP-B1)');

// P5 WP-B2: rotate/reorder/extract/split/find/downsample-files routes, search UI, thumbnail rotate/save-as, split & multi-file downsample dialogs
assert.match(serverSource, /\/api\/pdf\/pages\/rotate/, 'server exposes page rotate route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/pages\/reorder/, 'server exposes page reorder route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/pages\/extract/, 'server exposes page extract route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/split/, 'server exposes split route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/find/, 'server exposes find (search) route (WP-B2)');
assert.match(serverSource, /\/api\/pdf\/downsample-files/, 'server exposes multi-file downsample route (WP-B2)');
assert.match(serverSource, /downsampleToTarget/, 'downsample target-size loop is a shared function reused by both downsample routes (WP-B2)');
assert.match(serverSource, /if \(!query\) return json\(res, 400/, 'empty search query is rejected at the route entrance before PDFium ever sees it (WP-B2)');
assert.match(html, /id="searchBar"/, 'search bar exists (WP-B2)');
assert.match(html, /id="searchInput"/, 'search bar has a query input (WP-B2)');
assert.match(html, /id="searchCount"/, 'search bar shows a match counter (WP-B2)');
assert.match(html, /id="searchMatchCase"/, 'search bar has a match-case option (WP-B2)');
assert.match(html, /'searchHit'/, 'search hits are painted as highlight boxes on the page (WP-B2)');
assert.match(html, /openSearchHitCtxMenu/, 'right-clicking a search hit offers a context menu (WP-B2)');
assert.match(html, /줄 전체 가리기/, 'search hit context menu can mask the whole line (WP-B2)');
assert.match(html, /function pdfToScreen/, 'shared pdfToScreen() rotation-aware coordinate helper exists (WP-B2)');
assert.match(html, /function screenToPdf/, 'shared screenToPdf() rotation-aware coordinate helper exists (WP-B2)');
assert.match(html, /id="rotateLeft"[^>]*>↺/, 'rotate-left toolbar button is enabled with its icon kept (WP-B2)');
assert.doesNotMatch(html, /id="rotateLeft"[^>]*disabled/, 'rotate-left toolbar button is no longer disabled (WP-B2)');
assert.match(html, /id="menuSplit"[^>]*>분할…/, 'split toolbar button is enabled and relabeled 분할… (WP-B2)');
assert.doesNotMatch(html, /id="menuSplit"[^>]*disabled/, 'split toolbar button is no longer disabled (WP-B2)');
assert.match(html, /id="splitDialog"/, 'split dialog exists (WP-B2)');
assert.match(html, /id="downsampleFilesDialog"/, 'multi-file downsample dialog exists (WP-B2)');
assert.match(html, /id="emptyDownsampleFiles"[^>]*>여러 파일 용량 줄이기/, '빈 상태 여러 파일 용량 줄이기 quick tool is enabled (WP-B2)');
assert.doesNotMatch(html, /id="emptyDownsampleFiles"[^>]*disabled/, '빈 상태 여러 파일 용량 줄이기 button is no longer disabled (WP-B2)');
assert.doesNotMatch(html, /id="emptyExportImages"[^>]*disabled/, '빈 상태 이미지로 내보내기 button is no longer disabled (WP-B2)');
assert.match(html, /savePageAs/, 'thumbnail context menu can save a single page as a new file (WP-B2)');
assert.match(html, /rotatePages\(\[i\], -90/, 'thumbnail context menu rotates the clicked page (WP-B2)');
assert.match(html, /await pdfMutate\('\/api\/pdf\/pages\/reorder'/, 'drag-drop thumbnail reorder is wired to the reorder route (WP-B2)');
assert.match(html, /window\.editorKim\.openPdfFiles/, 'renderer wires up openPdfFiles for multi-file downsample picker (WP-B2)');
// P5: 도구줄 라벨을 되돌린 축약형 대신 명확한 문구로(공통 규칙 — 두 줄로 접혀도 됨)
assert.match(html, /id="zoomFit"[^>]*>폭 맞춤</, '맞춤 → 폭 맞춤 (P5)');
assert.match(html, /id="menuExtract"[^>]*>페이지 정리…</, '정리… → 페이지 정리… (P5)');
assert.match(html, /id="menuInsertImage"[^>]*>이미지 삽입</, '삽입 → 이미지 삽입 (P5)');
assert.match(html, /id="menuMerge"[^>]*>병합…</, '병합 → 병합… (P5)');
assert.match(html, /id="menuExportImages"[^>]*>이미지로 내보내기…</, '내보내기… → 이미지로 내보내기… (P5)');
assert.match(html, /id="menuDownsample"[^>]*>용량 줄이기…</, '줄이기… → 용량 줄이기… (P5)');
assert.match(html, /id="saveAs"[^>]*>다른 이름으로…</, '다른 이름 → 다른 이름으로… (P5)');

// --- P6 WP-B ---
const fontEditorSource = fs.readFileSync(path.join(__dirname, 'font-editor.js'), 'utf8');

// P6 WP-B1: 작업 진행 창(진행률 폴링 + 취소) — 계약 C1
assert.match(html, /id="jobDialog"/, 'job progress dialog exists (P6 WP-B1)');
assert.match(html, /id="jobProgress"/, 'job progress dialog has a progress bar (P6 WP-B1)');
assert.match(html, /id="jobCancel"/, 'job progress dialog has a cancel button (P6 WP-B1)');
assert.match(html, /function runJob\(label, task\)/, 'runJob() helper wraps long-running requests with a generated jobId (P6 WP-B1)');
assert.match(html, /\/api\/jobs\?id=/, 'UI polls GET /api/jobs?id= for progress (P6 WP-B1, contract C1)');
assert.match(html, /\/api\/jobs\/cancel/, 'UI posts to /api/jobs/cancel (P6 WP-B1, contract C1)');
for (const p of ['/api/pdf/export-images', '/api/pdf/split', '/api/pdf/merge', '/api/pdf/downsample', '/api/pdf/pages/delete']) {
  const re = new RegExp(p.replace(/[/.]/g, '\\$&') + "'[\\s\\S]{0,400}?jobId");
  assert.match(html, re, `${p} request carries a jobId (P6 WP-B1, contract C1)`);
}
assert.match(html, /\/api\/pdf\/downsample-files', \{ paths: downsampleFilesPaths, maxDpi, quality, targetBytes, jobId \}/,
  'downsample-files request carries a jobId (P6 WP-B1, contract C1)');
assert.match(html, /취소됨 — 원래 상태로 되돌렸습니다/, 'cancelled document-mutating jobs (downsample/pages-delete) report the restored state (P6 WP-B1, contract C1)');
assert.match(html, /취소됨 — \$\{n\}개 파일까지 저장됨/, 'cancelled file-producing jobs report how many files were saved before cancel (P6 WP-B1, contract C1)');
assert.match(html, /function maybeFlashUndoTrimmed/, 'a one-shot undoTrimmed flag from stacks() surfaces a flash message (P6 WP-B1, contract C3)');
assert.match(html, /실행 취소 기록이 메모리 한도로 일부 지워졌습니다/, 'undo-trim flash message text (P6 WP-B1, contract C3)');

// P6 WP-B2: 실행 취소 토스트 — flash()와 별개, 5초, 액션 포함
assert.match(html, /id="toast"/, 'undo toast element exists, separate from #status/flash (P6 WP-B2)');
assert.match(html, /function toast\(text, opts = \{\}\)/, 'toast() helper supports an action button (P6 WP-B2)');
assert.match(html, /setTimeout\(hideToast, 5000\)/, 'toast auto-hides after 5s (P6 WP-B2)');
assert.match(html, /toast\(label, \{ action: '실행 취소', onAction: undo \}\)/, 'page delete/rotate completion offers an undo toast (P6 WP-B2)');
assert.match(html, /toast\('페이지 순서를 바꿨습니다', \{ action: '실행 취소', onAction: undo \}\)/, 'page reorder completion offers an undo toast (P6 WP-B2)');
assert.match(html, /toast\('용량을 줄였습니다', \{ action: '실행 취소', onAction: undo \}\)/, 'downsample completion offers an undo toast (P6 WP-B2)');

// P6 WP-B3: 로그인 만료 배너 — 계약 C2
assert.match(html, /id="authBanner"/, 'auth-expired banner exists (P6 WP-B3)');
assert.match(html, /id="authBannerLogin"/, 'auth banner has a re-login button (P6 WP-B3)');
assert.match(html, /function showAuthBanner\(provider\)/, 'showAuthBanner() opens the re-login banner for a specific provider (P6 WP-B3)');
assert.match(html, /ev\.code === 'auth'/, "chat SSE auth errors (code:'auth') trigger the banner (P6 WP-B3, contract C2)");
assert.match(html, /needsRelogin/, 'status bar reflects re-login-needed state for the active provider (P6 WP-B3)');
assert.match(html, /window\.editorKimAuthError = showAuthBanner/, 'font-editor.js (which has no dialog access) can reach the banner via a global hook (P6 WP-B3)');
assert.match(fontEditorSource, /err\.code = result\.code/, 'font-recommend errors propagate the server code field (P6 WP-B3, contract C2)');
assert.match(fontEditorSource, /error\.code === 'auth' && window\.editorKimAuthError/, 'font editor calls the global auth-banner hook on code:\'auth\' (P6 WP-B3)');

// P6 WP-B4: 회전 페이지 이미지 크기 조절 손잡이 — 실측(브라우저, 회전 0·1·2·3, 계약 C5 표와 대조) 결과를 코드에 반영
// · box.offsetLeft/Top/Width/Height는 정수로 반올림돼 오차가 생긴다 — box.style.*(pdfToScreen이 써 넣은 소수)를 읽어야 한다
assert.match(html, /function attachResize[\s\S]{0,2000}?screenToPdf/, '이미지 손잡이 크기 조절이 screenToPdf로 화면→PDF 변환을 한다 (P6 WP-B4)');
assert.match(html, /parseFloat\(box\.style\.left\)/, '손잡이 드래그 시작점은 box\.style\.*(소수)를 읽는다 — offsetLeft 등 정수 반올림 값이 아니다 (P6 WP-B4)');
assert.doesNotMatch(html, /const left0 = box\.offsetLeft, top0 = box\.offsetTop, w0 = box\.offsetWidth/, '손잡이 크기 조절은 더 이상 반올림되는 offset\* 값으로 시작점을 잡지 않는다 (P6 WP-B4)');
assert.match(html, /const MIN_PX = 8/, '손잡이로 만들 수 있는 최소 화면 크기가 있다 — 뒤집히거나 0이 되지 않는다 (P6 WP-B4)');

console.log('OK — AI provider and UI checks passed');

// --- P6 WP-A --- (서버·공급자 함수 단언. 이 절만 Opus가 고친다 — 위쪽 줄은 건드리지 않는다)
const { isAuthError } = require('./ai-providers');
// C2: 로그인 만료·미로그인 문구는 auth로 분류한다(두 CLI가 실제로 내보내는 문장들)
for (const text of [
  'Not logged in. Run `claude auth login` to continue.',
  'Invalid API key · Please run /login',
  'Error: OAuth token has expired, please re-authenticate',
  'request failed with status 401',
  'authentication_error: invalid x-api-key',
  'You must run `codex login` before starting a thread',
]) assert.strictEqual(isAuthError(text), true, `auth로 분류돼야 함: ${text}`);
// 일반 오류는 auth가 아니다 — 배너를 띄우면 안 된다
for (const text of [
  'Claude usage limit reached|1772409600',
  'turn/start 응답 시간이 초과되었습니다',
  'fetch failed: ECONNRESET',
]) assert.strictEqual(isAuthError(text), false, `auth가 아니어야 함: ${text}`);

// C1: 작업 진행·취소 API와 6개 라우트의 jobId 수신
assert.match(serverSource, /url\.pathname === '\/api\/jobs' && req\.method === 'GET'/, '진행 조회 라우트 GET /api/jobs (C1)');
assert.match(serverSource, /url\.pathname === '\/api\/jobs\/cancel' && req\.method === 'POST'/, '취소 라우트 POST /api/jobs/cancel (C1)');
assert.match(serverSource, /function startJob/, '작업 등록 함수 (C1)');
// 긴 라우트 6개가 모두 jobId를 받아 진행·취소를 붙였다
for (const phase of ['export-images', 'split', 'merge', 'downsample', 'downsample-files', 'pages-delete']) {
  assert.ok(serverSource.includes(`startJob(jobId, '${phase}'`) || serverSource.includes(`startJob(q.jobId, '${phase}'`),
    `${phase} 라우트가 jobId를 받는다 (C1)`);
}
assert.match(serverSource, /if \(result\.cancelled\) \{ \/\/ 문서를 바꾸는 작업/, '취소된 용량 줄이기는 스냅샷으로 되돌린다 (C1)');
assert.match(serverSource, /async function rollback\(entry\)/, '되돌리기는 스냅샷을 pop한다 — 실행 취소 스택에 남기지 않는다 (C1)');
assert.match(serverSource, /JOB_TTL = 60000/, '끝난 작업은 60초 뒤 지운다 (C1)');
// C2: 인증 만료 신호
assert.match(serverSource, /json\(res, 401, \{ error: e\.message, code: 'auth'/, 'JSON 라우트는 401 + code:auth (C2)');
assert.match(serverSource, /code: 'auth', provider/, 'SSE는 code:auth와 provider를 함께 보낸다 (C2)');
assert.match(serverSource, /EDITORKIM_FAKE_AUTH_ERROR/, 'WP-B 검증용 로그인 만료 모의 스위치 (C2)');
assert.match(providerSource, /isAuthError/, '공급자 오류 문구를 판별하는 함수가 있다 (C2)');
// C3: 실행 취소 메모리 상한
assert.match(serverSource, /UNDO_MAX_BYTES = 256 \* 1024 \* 1024/, 'undo 바이트 상한 256MB (C3)');
assert.match(serverSource, /undoTrimmed/, 'undo를 잘라냈음을 UI에 알린다 (C3)');
// C4: 조기 종료
assert.match(serverSource, /DOWNSAMPLE_MIN_GAIN = 0\.01/, '1% 미만 개선이면 다음 dpi 단계로 (C4)');
assert.match(serverSource, /stalledDpis/, '두 dpi 연속 제자리면 중단 (C4)');

console.log('OK — P6 WP-A 서버·공급자 단언 통과');

// P7: 줄 단위 편집 상자 — text-grouping.js가 font-editor.js와 같은 모양으로 배선됐는지(로직 자체는 text-grouping.test.js)
assert.match(serverSource, /url\.pathname === '\/text-grouping\.js'/, '/text-grouping.js 라우트가 font-editor.js와 같은 모양으로 있다 (P7)');
assert.match(html, /<script src="\/text-grouping\.js">/, 'index.html이 모듈 스크립트보다 먼저 text-grouping.js를 읽는다 (P7)');
assert.ok(html.indexOf('<script src="/text-grouping.js">') < html.indexOf('<script type="module">'),
  'text-grouping.js는 모듈 스크립트보다 먼저 로드돼야 window.groupLines를 쓸 수 있다 (P7)');
assert.doesNotMatch(script, /function groupLines\(/, '옛 bounds.y0 기반 groupLines 정의는 지워졌다 (P7)');
assert.match(script, /window\.groupLines/, '모듈 스크립트는 text-grouping.js가 노출한 window.groupLines를 쓴다 (P7)');

console.log('OK — P7 배선 단언 통과');

// P8: 끌어다 놓기 — FileList를 contextBridge로 넘기면 프리로드에 빈 객체가 도착해 아무 파일도 열리지 않는다
// (v0.8.0~v0.10.0에서 끌어다 놓기가 동작하지 않은 원인. 실측: FileList → 0개, Array.from → 실제 경로)
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
assert.match(preloadSource, /pathForFile:\s*\(file\)/, '프리로드는 File 하나를 받는 pathForFile을 노출한다 (P8)');
{
  const drop = script.slice(script.indexOf("addEventListener('drop'"));
  const body = drop.slice(0, drop.indexOf('});') + 3);
  assert.match(body, /Array\.from\(e\.dataTransfer\?\.files/, 'drop 처리는 렌더러에서 FileList를 배열로 바꾼 뒤 넘긴다 (P8)');
  assert.doesNotMatch(body, /pathsFromFiles\(e\.dataTransfer/, 'FileList를 그대로 프리로드로 넘기지 않는다 (P8)');
  assert.match(body, /flash\(/, '경로를 못 읽으면 조용히 끝내지 않고 알린다 (P8)');
}

console.log('OK — P8 끌어다 놓기 단언 통과');
