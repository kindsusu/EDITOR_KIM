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

console.log('OK — AI provider and UI checks passed');
