const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'index.html module script exists');
assert.doesNotThrow(() => new Function(script), 'index.html module script parses');
assert.match(html, /pdfRenderGeneration/, 'stale PDF renders are invalidated');
assert.match(html, /DOMPurify\.sanitize\(marked\.parse/, 'Markdown preview is sanitized');
assert.doesNotMatch(html, /https:\/\/cdnjs\.cloudflare\.com/, 'UI has no CDN runtime dependency');
assert.match(html, /addEventListener\('wheel'[\s\S]*ctrlKey/, 'Ctrl+wheel zooms the PDF');
assert.match(html, /id="zoomFit"/, 'fit-to-width zoom exists');
assert.doesNotMatch(serverSource, /install\.ps1|ExecutionPolicy\s+Bypass|irm\s+https:/i,
  'server never pipes a remote PowerShell script into execution');
assert.match(serverSource, /headers\.host/, 'server checks the Host header (DNS rebinding)');
assert.match(html, /id="tempBanner"/, 'temp/read-only file banner exists (WP-B1)');
assert.match(html, /window\.retextPdf\.onOpenPaths/, 'renderer wires up onOpenPaths for files opened via file association/argv (WP-B1)');

// P4 WP-B2: page extraction, merge, image export/insert, size reduction dialogs & routes
assert.match(html, /id="pageExtractDialog"/, 'page extraction dialog exists (WP-B2)');
assert.match(html, /id="mergeDialog"/, 'merge dialog exists (WP-B2)');
assert.match(html, /id="exportImagesDialog"/, 'image export dialog exists (WP-B2)');
assert.match(html, /id="downsampleDialog"/, 'downsample (size reduction) dialog exists (WP-B2)');
assert.match(html, /window\.retextPdf\.openImage/, 'renderer wires up openImage for image insertion (WP-B2)');
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
assert.match(html, /retextpdf\.hintSeen/, 'first-run hint is remembered per browser via localStorage (WP-B1)');
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
assert.doesNotMatch(html, /마스킹/, 'no leftover "마스킹" wording remains in the UI (engine mark name RetextPdfMask / route /api/pdf/mask are unaffected, WP-B1)');

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
assert.match(html, /window\.retextPdf\.openPdfFiles/, 'renderer wires up openPdfFiles for multi-file downsample picker (WP-B2)');
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

// P6 WP-B4: 회전 페이지 이미지 크기 조절 손잡이 — 실측(브라우저, 회전 0·1·2·3, 계약 C5 표와 대조) 결과를 코드에 반영
// · box.offsetLeft/Top/Width/Height는 정수로 반올림돼 오차가 생긴다 — box.style.*(pdfToScreen이 써 넣은 소수)를 읽어야 한다
assert.match(html, /function attachResize[\s\S]{0,2000}?screenToPdf/, '이미지 손잡이 크기 조절이 screenToPdf로 화면→PDF 변환을 한다 (P6 WP-B4)');
assert.match(html, /parseFloat\(box\.style\.left\)/, '손잡이 드래그 시작점은 box\.style\.*(소수)를 읽는다 — offsetLeft 등 정수 반올림 값이 아니다 (P6 WP-B4)');
assert.doesNotMatch(html, /const left0 = box\.offsetLeft, top0 = box\.offsetTop, w0 = box\.offsetWidth/, '손잡이 크기 조절은 더 이상 반올림되는 offset\* 값으로 시작점을 잡지 않는다 (P6 WP-B4)');
assert.match(html, /const MIN_PX = 8/, '손잡이로 만들 수 있는 최소 화면 크기가 있다 — 뒤집히거나 0이 되지 않는다 (P6 WP-B4)');

console.log('OK — UI checks passed');

// --- P6 WP-A --- (서버 단언)
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
assert.match(serverSource, /async function restore\(entry, i, before\)/, '실패·취소한 변경은 이전 바이트로 되돌리고 실행 취소 스택에 남기지 않는다 (C1)');
assert.match(serverSource, /JOB_TTL = 60000/, '끝난 작업은 60초 뒤 지운다 (C1)');
// C3: 실행 취소 메모리 상한
assert.match(serverSource, /UNDO_MAX_BYTES = 256 \* 1024 \* 1024/, 'undo 바이트 상한 256MB (C3)');
assert.match(serverSource, /undoTrimmed/, 'undo를 잘라냈음을 UI에 알린다 (C3)');
// C4: 조기 종료
assert.match(serverSource, /DOWNSAMPLE_MIN_GAIN = 0\.01/, '1% 미만 개선이면 다음 dpi 단계로 (C4)');
assert.match(serverSource, /stalledDpis/, '두 dpi 연속 제자리면 중단 (C4)');

console.log('OK — P6 WP-A 서버 단언 통과');

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

// UI 결함 수정(2026-10): 한글 조합 Enter, 적용 중복/실패 보존, 정렬은 서버에서, 링크·원격 이미지 차단
const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
assert.match(mainSource, /will-navigate/, 'app window cannot be navigated away by Markdown links');
assert.match(mainSource, /setWindowOpenHandler/, 'new-window requests are denied and opened externally');
assert.match(html, /ta\.onkeydown = \(e\) => \{\s*if \(e\.isComposing \|\| e\.keyCode === 229\) return;/, 'inline editor ignores Enter while composing Hangul');
assert.match(html, /searchInput'\)\.addEventListener\('keydown'[\s\S]{0,120}isComposing/, 'search input ignores Enter while composing Hangul');
assert.match(html, /let committing = false/, 'inline editor commit has an in-flight guard');
assert.doesNotMatch(html, /\/api\/pdf\/move', \{ name: cur, i, idxs, dx: /, 'edit commit no longer follows up with a separate move');
assert.match(html, /align: alignReq/, 'alignment is sent with the edit so one edit is one undo');
assert.match(html, /refreshSeq\[i\]/, 'refreshPage drops out-of-order responses');
assert.match(html, /mutationSeq/, 'save only clears dirty if no edit happened during it');
assert.match(html, /externalChange/, 'external file change is surfaced');
assert.match(html, /new DOMParser\(\)\.parseFromString\(DOMPurify\.sanitize/, 'Markdown remote images are neutralised before insertion');

// AI 기능 제거(2026-10-03): Claude Code/Codex 연동(채팅 패널·설정 대화상자·로그인 배너·모델 선택·폰트 추천)이 코드에 남지 않는다.
// PDF 편집용으로만 쓰고, 문서는 PC 밖으로 나가지 않는다 — 외부 CLI를 부르는 길 자체가 없어야 한다
assert.ok(!fs.existsSync(path.join(__dirname, 'ai-providers.js')), 'app/ai-providers.js는 지워졌다');
assert.ok(!fs.existsSync(path.join(__dirname, 'claude-provider.test.js')), 'AI 공급자 어댑터 테스트도 지워졌다');
assert.doesNotMatch(html, /id="aiPanel"|class="ai"/, 'AI 채팅 패널이 없다');
assert.doesNotMatch(html, /id="modelPicker"|id="aiToggle"|id="aiRailToggle"/, '머리줄에 AI 모델 선택·채팅 버튼이 없다');
assert.doesNotMatch(html, /<dialog id="setup"/, 'AI 설치·로그인 대화상자가 없다');
assert.doesNotMatch(html, /id="authBanner"|AuthError/, 'AI 로그인 만료 배너가 없다');
assert.doesNotMatch(html, /\/api\/chat|\/api\/setup|\/api\/session\/reset|font-recommend/, '화면이 AI 라우트를 부르지 않는다');
assert.doesNotMatch(html, /ai-collapsed|editRadio|showDiff|rebuildDocText/, 'AI 패널 열·편집 모드·수정안 비교 코드가 없다');
assert.doesNotMatch(html, /claude|codex|chatgpt/i, '화면에 Claude/Codex/ChatGPT 언급이 없다');
assert.match(html, /grid-template-columns:220px 1fr;/, '레이아웃은 파일 목록/편집기 2열이다');
assert.match(html, /<span id="status"><\/span>/, '머리줄 #status는 flash() 알림 자리로만 남는다');
assert.match(html, /id="ver"/, '앱 버전 표시(#ver)는 유지된다');
assert.match(html, /fetch\('\/api\/health'\)/, '앱 버전은 /api/health에서 읽는다');
assert.doesNotMatch(html, /\.ai'|\.aiChoice'/, 'AI 설정 키(localStorage)를 읽거나 청소하는 코드가 없다');
assert.doesNotMatch(serverSource, /\/api\/chat|font-recommend|\/api\/setup|\/api\/session\/reset|ai-providers|FAKE_AUTH_ERROR|code: 'auth'/,
  'server.js에 AI 라우트·공급자 참조·인증 만료 분기가 없다');
assert.doesNotMatch(serverSource, /claude|codex|chatgpt/i, 'server.js에 Claude/Codex/ChatGPT 언급이 없다');
assert.match(serverSource, /url\.pathname === '\/api\/health'\) return json\(res, 200, \{ appVersion: APP_VERSION \}\)/, '/api/health는 앱 버전만 돌려준다');
assert.doesNotMatch(fontEditorSource, /fontRecommend|font-recommend|ensureAi|autoRecommend|AI 후보|AuthError/, '폰트 맞추기 창에 AI 추천 버튼·로그인 처리가 없다');
assert.match(fontEditorSource, /\/api\/pdf\/font-preview/, '폰트 맞추기 미리보기는 그대로 있다');
assert.match(fontEditorSource, /\/api\/pdf\/font-apply/, '폰트 맞추기 적용은 그대로 있다');
assert.match(fontEditorSource, /비슷한 글꼴을 고르세요/, '원래 글꼴을 쓸 수 없으면 사람이 고르도록 안내한다');
const pkg = require('../package.json');
assert.doesNotMatch(pkg.description + ' ' + pkg.keywords.join(' '), /claude|codex|chatgpt/i, 'package.json 설명·키워드에 AI 공급자가 없다');
assert.doesNotMatch(pkg.description, /&/, 'package.json 설명에 & 없음(appx 설명서가 깨진다)');
assert.doesNotMatch(pkg.scripts.test, /ai-providers|claude-provider/, 'npm test가 지운 테스트를 부르지 않는다');
assert.match(pkg.scripts.test, /ui-wiring\.test\.js/, 'npm test가 ui-wiring.test.js를 부른다');

console.log('OK — AI 제거 단언 통과');

// 2026-10-03: CRLF Markdown은 화면 안에서 LF로 다루고 저장할 때 원래 줄바꿈으로 되돌린다(입력 뒤 되돌려도 미저장 표시가 남던 문제)
assert.match(script, /mdEol = \/\\r\\n\/\.test\(text\)/, 'Markdown 원래 줄바꿈을 기억한다');
assert.match(script, /savedText = text\.replace\(\/\\r\\n\/g, '\\n'\)/, '비교 기준(savedText)은 LF로 정규화한다');
assert.match(script, /if \(mdEol === '\\r\\n'\) text = text\.replace/, '저장할 때 CRLF로 되돌린다');
// 2026-10-03: 여러 조각으로 된 줄도 폰트 맞추기가 된다 — 나머지 조각 idx를 remove로 넘긴다
assert.doesNotMatch(script, /fontButton\.disabled = selectedObj\.objs\.length !== 1/, '폰트 맞추기가 조각 하나짜리 줄로 묶여 있지 않다');
assert.match(script, /openPdfFontEditor\(\{[^}]*remove: selection\.objs\.slice\(1\)/, '폰트 창에 나머지 조각을 넘긴다');
console.log('OK — CRLF Markdown·여러 조각 줄 폰트 맞추기 단언 통과');


// 2026-10-03: 앱 이름 Retext PDF(4.0.0). 보이는 이름과 내부 식별자를 모두 새 이름으로 통일했다(기존 사용자 없음 — 호환 코드 없음).
// Store identityName만 Partner Center가 정한 옛 이름 기반 값이라 그대로 둔다
assert.strictEqual(pkg.version, '4.0.0', '버전은 4.0.0이다');
assert.strictEqual(pkg.productName, 'Retext PDF', 'package.json productName은 Retext PDF다');
assert.strictEqual(pkg.build.productName, 'Retext PDF', 'build.productName은 Retext PDF다');
assert.strictEqual(pkg.build.appx.displayName, 'Retext PDF', 'Store 표시 이름은 Retext PDF다');
assert.strictEqual(pkg.build.nsis.shortcutName, 'Retext PDF', '바로가기 이름은 Retext PDF다');
for (const name of [pkg.build.artifactName, pkg.build.portable.artifactName, pkg.build.nsis.artifactName, pkg.build.appx.artifactName]) {
  assert.match(name, /^Retext-PDF-\S+$/, '산출물 이름은 공백 없는 Retext-PDF-...다: ' + name);
}
assert.strictEqual(pkg.name, 'retext-pdf', '패키지 이름(name)은 retext-pdf다');
assert.strictEqual(require('../package-lock.json').name, 'retext-pdf', 'package-lock.json의 name도 retext-pdf다');
assert.strictEqual(pkg.build.appId, 'com.kindsusu.retextpdf', 'appId는 com.kindsusu.retextpdf다');
assert.strictEqual(pkg.build.appx.applicationId, 'RetextPDF', 'Store applicationId는 RetextPDF다');
assert.strictEqual(pkg.build.appx.identityName, 'susukim.EDITORKIM', 'Store identityName은 Partner Center 값(옛 이름 기반) 그대로다');
assert.doesNotMatch(mainSource, /setPath\('userData'/, 'userData 폴더를 고정하지 않는다(기본값 %APPDATA%\\Retext PDF)');
assert.match(serverSource, /path\.join\(os\.homedir\(\), '\.retext-pdf\.json'\)/, '설정 파일은 ~/.retext-pdf.json이다');
assert.match(serverSource, /process\.env\.RETEXTPDF_PORT/, '포트 환경변수는 RETEXTPDF_PORT다');
for (const [label, src] of [['index.html', html], ['preload.js', preloadSource], ['main.js', mainSource], ['server.js', serverSource], ['font-editor.js', fontEditorSource]]) {
  assert.doesNotMatch(src, /editor[^a-z]?kim|dae[p]il/i, `${label}에 옛 앱 이름(대소문자·구분자 무관)이 없다`);
}
assert.match(preloadSource, /exposeInMainWorld\('retextPdf'/, '프리로드는 window.retextPdf를 노출한다');
assert.match(html, /window\.retextPdf\.openFiles/, '화면은 window.retextPdf를 쓴다');
assert.match(html, /'retextpdf\.recent'/, '최근 파일 키는 retextpdf.recent다');
assert.match(html, /X-Retext-Pdf-Temp/, '임시 파일 헤더는 X-Retext-Pdf-Temp다');
assert.match(html, /<title>Retext PDF<\/title>/, 'index.html 제목은 Retext PDF다');
assert.match(html, /<header><b>Retext PDF<\/b>/, '머리줄 브랜드는 Retext PDF다');
assert.match(mainSource, /title: `Retext PDF v\$\{/, '창 제목은 Retext PDF vX.Y.Z다');
console.log('OK — 앱 이름 변경(Retext PDF 4.0.0) 단언 통과');
