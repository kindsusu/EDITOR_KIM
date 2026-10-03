// Retext PDF 백엔드: 정적 UI + 파일 읽기/쓰기 + PDF 편집(PDFium). 127.0.0.1에서만 열고 문서를 PC 밖으로 보내지 않는다
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.RETEXTPDF_PORT) || 4747;
const MARKED_BROWSER = path.join(path.dirname(require.resolve('marked')), 'marked.umd.js');
const DOMPURIFY_BROWSER = path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js');
const CONF = path.join(os.homedir(), '.retext-pdf.json');
const pdfEngine = require('./pdf-engine');
const pdfFonts = require('./pdf-fonts');
const fontService = require('./pdf-font-service');
const { applyEdits, verifyEdits } = require('./pdf-edit-service');
const APP_VERSION = require('../package.json').version;

let conf = {}; try { conf = JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch {}
// 기본 작업 폴더. 패키징된 앱에서는 __dirname이 app.asar 안이라 소스 옆 workspace는 읽기만 되고 저장이 실패한다
// → 사용자 문서 폴더 아래 Retext PDF를 만들고 첫 실행에만 샘플을 복사해 쓴다. 개발 실행(npm start / node server.js)은 저장소의 workspace 그대로
const SAMPLES = path.join(ROOT, '..', 'workspace');
const PACKAGED = /[\\/]app\.asar[\\/]/i.test(ROOT);
function defaultWorkspace() {
  if (!PACKAGED) return SAMPLES;
  let documents = path.join(os.homedir(), 'Documents');
  try { documents = require('electron').app.getPath('documents'); } catch {}
  for (const dir of [path.join(documents, 'Retext PDF'), path.join(os.homedir(), 'Retext PDF')]) {
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
const pdfDocs = {}; // docKey(파일) → { doc, mtimeMs, dirty, busy, externalChange, undo, redo, ... }
const MAX_RENDER_SCALE = 4; // A4 기준 2380×3368px. 그 이상은 WASM 힙만 먹고 화면에서 구분되지 않는다
// 상태 코드를 실은 오류 — 공통 catch가 e.status로 응답한다
const httpError = (status, message) => Object.assign(new Error(message), { status });
// 캐시 키: 상대·절대 표기가 달라도 같은 파일이면 한 항목(Windows는 대소문자 무시)
const docKey = (name) => { const p = safe(name); return process.platform === 'win32' ? p.toLowerCase() : p; };

// 캐시된 PDF 문서를 반환. 없거나 디스크에서 파일이 바뀌었으면 (다시) 연다.
// 미저장 편집이 있으면(또는 긴 작업 중이면) 다시 열지 않는다 — 편집과 실행 취소 기록을 지키고
// externalChange로 "디스크의 파일이 바뀌었다"만 알린다(OneDrive 동기화·백신이 mtime을 바꾸는 경우). 저장하면 풀린다.
async function getPdfDoc(name) {
  const p = safe(name), key = docKey(name), cached = pdfDocs[key];
  let mtimeMs;
  try { mtimeMs = fs.statSync(p).mtimeMs; } // 미저장 편집 중 파일이 사라져도(동기화가 옮김) 편집은 남겨 저장할 수 있게 한다
  catch (e) { if (cached?.dirty) { cached.externalChange = true; return cached; } throw e; }
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  if (cached && (cached.dirty || cached.busy)) { if (cached.dirty) cached.externalChange = true; return cached; }
  if (cached) { delete pdfDocs[key]; cached.doc.close(); } // 다시 열기가 실패해도 닫힌 문서가 캐시에 남지 않게 먼저 뺀다
  const doc = await pdfEngine.open(fs.readFileSync(p));
  if (pdfDocs[key]) { doc.close(); return pdfDocs[key]; } // 같은 파일을 동시에 연 다른 요청이 먼저 넣었다
  return (pdfDocs[key] = { doc, mtimeMs, dirty: false, undo: [], redo: [], undoBytes: 0, undoTrimmed: false });
}
// 문서를 바꾸는 요청용: 긴 작업이 같은 문서를 쓰는 중이면 409. 끼어들면 작업의 되돌리기·스냅샷이 엉킨다.
// 긴 작업 라우트는 이것으로 문서를 얻은 뒤 (await 없이) entry.busy = true, finally에서 푼다
async function getEditableDoc(name) {
  const entry = await getPdfDoc(name);
  if (entry.busy) throw httpError(409, '긴 작업이 끝난 뒤 다시 시도하세요.');
  return entry;
}
// 캐시에서 문서를 버린다(다른 파일로 덮어쓴 경우·닫기). 긴 작업이 쓰는 중이면 닫지 않고 409
function dropDoc(name) {
  const key = docKey(name), entry = pdfDocs[key];
  if (!entry) return;
  if (entry.busy) throw httpError(409, '긴 작업이 끝난 뒤 다시 시도하세요.');
  delete pdfDocs[key]; entry.doc.close();
}

// ponytail: undo 스택은 문서당 최대 20개(save() 바이트 통짜) — 600KB 문서 기준 12MB, 개인용 데스크톱 앱이라 넉넉함.
//   더 큰 문서/더 긴 히스토리가 필요해지면 diff 기반으로 바꿔야 함.
const UNDO_MAX = 20;
// P6 C3: 개수만으로는 모자란다 — 이미지가 많은 문서는 한 장(save() 바이트)이 수십 MB라 20개면 수 GB가 된다.
//   undo+redo 바이트 합계(entry.undoBytes)를 상한 아래로 유지한다. 최근 3단계는 무슨 일이 있어도 남긴다
//   (방금 한 편집을 되돌릴 수 없으면 편집기가 아니다). 잘라냈으면 undoTrimmed 플래그를 한 번 UI로 보낸다.
const UNDO_MAX_BYTES = 256 * 1024 * 1024;
const stackBytes = (entry) => [...entry.undo, ...entry.redo].reduce((n, s) => n + s.bytes.length, 0);
function trimStacks(entry) { // 합계를 다시 재고(최대 20+20개라 비용이 없다) 상한을 넘는 동안 가장 오래된 undo부터 버린다
  entry.undoBytes = stackBytes(entry);
  while (entry.undoBytes > UNDO_MAX_BYTES && entry.undo.length > 3) {
    entry.undoBytes -= entry.undo.shift().bytes.length;
    entry.undoTrimmed = true;
  }
  return entry.undoBytes;
}
function snapshot(entry, i, bytes = entry.doc.save()) {
  entry.undo.push({ bytes, page: i });
  if (entry.undo.length > UNDO_MAX) entry.undo.shift();
  entry.redo = [];
  trimStacks(entry);
}
// 엔진이 doc.batch를 지원하면 fn 동안 콘텐츠 재생성을 미뤄 쪽마다 한 번만 만든다(조각마다 쪽 전체를 다시 쓰면
// 옛 스트림이 파일에 쌓인다). 지원하지 않는 엔진이면 그냥 실행한다. 반환값은 fn의 것
function batch(doc, fn) {
  let r;
  if (typeof doc.batch === 'function') doc.batch(() => { r = fn(); }); else r = fn();
  return r;
}
// 실패한 변경을 되돌린다: 변경 전 바이트로 문서를 다시 연다. 다시 열지도 못하면(힙 부족 등) 바뀐 문서를 그대로 두되
// 변경 전 바이트를 실행 취소 스택에 넣고 미저장으로 표시한다 — 적어도 Ctrl+Z로 돌아갈 수 있다
async function restore(entry, i, before) {
  try { await swapDoc(entry, before); } catch { snapshot(entry, i, before); entry.dirty = true; }
}
// 스냅샷을 찍고 fn(동기 엔진 호출)으로 문서를 바꾼다. fn이 던지거나 { ok:false }를 주면 문서를 되돌리고
// 실행 취소 스택·redo·dirty는 손대지 않는다(하지 않은 일은 되돌릴 것도 없다). 성공하면 스냅샷을 쌓고 dirty.
async function mutate(entry, i, fn) {
  const before = entry.doc.save();
  let r;
  try { r = batch(entry.doc, fn); } catch (error) { await restore(entry, i, before); throw error; }
  if (r?.ok === false) { await restore(entry, i, before); return r; }
  snapshot(entry, i, before);
  entry.dirty = true;
  return r;
}
// 줄 편집 트랜잭션: 살아 있는 문서를 직접 고친 뒤 저장 바이트로 다시 열어 검증하고, 그 재열기 문서를 새 정본으로 쓴다
// (재열기는 고아 스트림도 떨군다). 실패하면 변경 전 바이트로 되돌리고 스택·dirty는 그대로 둔다.
// 비용: 저장 2회 + 열기 1회. 예전(사본 열기 + 저장 3회 + 열기 2회)은 290MB 문서에서 WASM 힙(2GB)을 넘겨 엔진이 죽었다.
async function editTransaction(entry, i, edits, options = {}) {
  const doc = entry.doc, before = doc.save(); // before = 실행 취소 스냅샷
  let persisted = null, result;
  try {
    result = batch(doc, () => applyEdits(doc, i, edits, options));
    persisted = await pdfEngine.open(doc.save());
    // 열기는 await라 이론상 다른 요청이 끼어들 수 있다 — 그새 문서가 바뀌었으면(실행 취소 등) 덮어쓰지 않는다
    if (entry.doc !== doc) throw new Error('파일이 변경됐습니다. 다시 편집하세요.');
    batch(persisted, () => verifyEdits(persisted, i, edits, result.results, options)); // 지운 곁가지 조각만큼 인덱스를 고쳐 둔다
  } catch (error) {
    if (persisted) persisted.close();
    if (entry.doc === doc) await restore(entry, i, before);
    throw error;
  }
  snapshot(entry, i, before);
  entry.doc = persisted;
  entry.dirty = true;
  doc.close();
  return result;
}
// undoTrimmed는 1회성: 한 번 실어 보낸 뒤 되돌린다(UI가 "오래된 실행 취소 기록을 버렸습니다"를 한 번만 알리게)
const stacks = (entry) => {
  const trimmed = !!entry.undoTrimmed;
  entry.undoTrimmed = false;
  return { undoLeft: entry.undo.length, redoLeft: entry.redo.length, undoBytes: entry.undoBytes || 0, ...(trimmed ? { undoTrimmed: true } : {}),
    ...(entry.externalChange ? { externalChange: true } : {}) }; // 미저장 편집 중 디스크 파일이 바뀌었다(getPdfDoc) — 저장하면 덮어쓴다
};
// 바이트를 다른 문서 객체로 바꿔 끼운다. 새 문서를 먼저 열고 나서 옛 것을 닫아, 열기에 실패해도 닫힌 핸들이 남지 않게 한다
async function swapDoc(entry, bytes) { const doc = await pdfEngine.open(bytes); entry.doc.close(); entry.doc = doc; }

// ── P6 C1: 긴 작업의 진행·취소 ─────────────────────────────────────────────
// 클라이언트가 요청 본문에 jobId(자기가 만든 문자열)를 넣으면 그 작업의 진행을 GET /api/jobs?id=… 로 볼 수 있고
// POST /api/jobs/cancel 로 멈출 수 있다. jobId가 없으면 추적만 없고 동작은 같다(등록하지 않는다).
// **취소는 단위 작업(페이지 1장·파일 1개·시도 1회) 사이에서만 본다** — PDFium은 WASM 동기 호출이라
// 한 장을 렌더하거나 한 번 downsample하는 중에는 이벤트 루프가 돌지 않아 끼어들 수 없다.
const JOB_TTL = 60000; // 끝난 작업은 60초 뒤 지운다(UI가 마지막 폴링으로 결과를 받을 시간)
const jobs = new Map();
// 등록 전에 온 취소(요청 본문을 읽거나 문서를 여는 사이 [취소]를 누른 경우): id를 기억했다가 startJob이 곧바로 취소 상태로 시작한다
const earlyCancels = new Map(); // id → 정리 타이머
function startJob(id, phase, total = 0) {
  const job = { id: id || null, phase, done: 0, total, message: '', cancelled: false, finished: false, error: null, timer: null };
  if (!id) return job; // 추적 안 함
  const old = jobs.get(id);
  if (old?.timer) clearTimeout(old.timer);
  if (earlyCancels.has(id)) { clearTimeout(earlyCancels.get(id)); earlyCancels.delete(id); job.cancelled = true; }
  jobs.set(id, job);
  return job;
}
// 진행 상황을 갱신하고 "계속해도 되는가"를 돌려준다 — 라우트는 if (!progress(...)) 로 취소를 처리한다
function progress(job, patch = {}) { Object.assign(job, patch); return !job.cancelled; }
function endJob(job, patch = {}) {
  if (job.finished) return job; // 오류 경로(catch)와 finally가 겹쳐 불려도 처음 상태를 지킨다
  Object.assign(job, patch, { finished: true });
  if (job.id && jobs.get(job.id) === job) { job.timer = setTimeout(() => jobs.delete(job.id), JOB_TTL); job.timer.unref(); }
  return job;
}
const jobView = (job) => ({ id: job.id, phase: job.phase, done: job.done, total: job.total, message: job.message, finished: job.finished, cancelled: job.cancelled, error: job.error });
// 단위 작업 사이에 이벤트 루프로 한 번 돌아간다. **이게 없으면 취소가 전혀 먹지 않는다**:
// await는 이미 이룬 프로미스에 대해 마이크로태스크만 돌리므로 HTTP 요청(폴링·취소)이 처리되지 않는다
// (실측 2026-09-10: setImmediate 없이 100쪽 용량 줄이기를 돌리니 127초 동안 /api/jobs 응답이 한 번도 오지 않았다).
const tick = () => new Promise((resolve) => setImmediate(resolve));

// P5 WP-B2: 용량 줄이기의 "목표 용량까지 반복" 로직을 공유 함수로 뽑는다 — /api/pdf/downsample(열린 문서)와
// /api/pdf/downsample-files(파일 여러 개, 열지 않고 처리)가 함께 쓴다. entry는 { doc } 모양이면 충분(undo/redo는 호출자 몫).
// P6 C4: 조기 종료 — 목표에 닿지 못하는 문서(이미 잘 압축된 스캔 등)에서 12번을 다 돌지 않는다.
//   비교 기준은 "전체 최선"이 아니라 **같은 dpi 단계 안의 직전 시도**다(검수 결정):
//   전체 최선과 견주면 낮은 dpi의 첫 시도가 최선보다 크기만 해도 그 단계의 품질 단계를 통째로 잃어버린다.
//   · 같은 dpi 안에서: 품질을 한 단 낮춘 시도가 그 단계의 직전 시도보다 1% 이상 줄지 않으면 남은 품질 단계를 건너뛴다
//     (품질을 더 낮춰도 안 줄어드는 이미지는 해상도를 낮춰야 줄어든다).
//   · dpi 단계 사이에서: 그 단계의 최선이 직전 단계의 최선보다 1% 이상 작지 않으면 "개선 없음"으로 센다.
//   · 개선 없는 dpi 단계가 두 번 연속이면 멈춘다(더 낮춰도 같은 결과 — 대개 전부 '줄여도 커짐'으로 건너뛴 문서).
//   · 목표에 닿으면 즉시 멈추고, 목표 미달이면 전체 최소 결과로 확정한다.
//   · attempts에는 실제로 돌린 시도만 남는다(건너뛴 조합은 기록하지 않는다).
//   · 맞바꿈: 품질 단계를 건너뛰다가 목표를 스칠 수 있다(예: q60이 0.5%만 줄었는데 q45라면 목표에 닿는 경우).
//     그래도 최선 결과는 언제나 확정되고, 시간을 몇 분씩 쓰는 쪽이 사용자에게 더 나쁘다.
// report(patch) → false면 취소. 호출자(라우트)가 진행 단위를 자기 방식으로 세므로(시도 1회 / 파일 1개) 여기서는 job을 직접 만지지 않는다.
const DOWNSAMPLE_MIN_GAIN = 0.01;
async function downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes, report }) {
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
  const keepGoing = (patch) => !report || report(patch) !== false;
  let best = null, reached = false, finalResult = null, stalledDpis = 0, cancelled = false;
  let prevStepBest = null; // 직전 dpi 단계의 최선 바이트(단계 사이 비교 기준)
  outer:
  for (const d of dpis) {
    let stepBest = null; // 이 dpi 단계의 최선
    let prevInStep = null; // 이 dpi 단계의 직전 시도 결과(단계 안 비교 기준)
    for (const qv of quals) {
      await tick(); // 시도 1회는 몇 초~수십 초짜리 동기 WASM 호출 → 그 앞에서만 멈출 수 있다
      if (!keepGoing({ message: `${d}dpi / 품질 ${qv} 시도 중`, attempt: attempts.length + 1 })) { cancelled = true; break outer; }
      await swapDoc(entry, originalBytes);
      const r = entry.doc.downsample({ maxDpi: d, quality: qv });
      attempts.push({ maxDpi: d, quality: qv, before: r.before, after: r.after, changed: r.changed, skipped: r.skipped.length });
      // P6 버그 고침: 옛 best에는 after 필드가 없어 `r.after < best.after`가 언제나 false였다 —
      // 목표 미달이면 "최소 결과"가 아니라 첫 시도 결과로 확정됐다(실측: 12회를 돌아 3.15MB를 찾고도 16.53MB로 확정).
      if (!best || r.after < best.after) best = { maxDpi: d, quality: qv, after: r.after, bytes: entry.doc.save(), result: r };
      if (!keepGoing({ message: `${d}dpi / 품질 ${qv} → ${(r.after / 1048576).toFixed(1)}MB`, attempt: attempts.length })) { cancelled = true; break outer; }
      if (r.after <= targetBytes) { reached = true; finalResult = { maxDpi: d, quality: qv, result: r }; break outer; }
      // 단계 안 비교: 첫 시도는 이 단계의 기준이므로 언제나 통과, 그 뒤는 직전 시도보다 1% 이상 줄어야 계속한다
      const stepImproved = prevInStep === null || r.after <= prevInStep * (1 - DOWNSAMPLE_MIN_GAIN);
      if (stepBest === null || r.after < stepBest) stepBest = r.after;
      prevInStep = r.after;
      if (!stepImproved) break; // 이 dpi에서 품질을 더 낮춰도 소용없다 → 다음 dpi
    }
    // 단계 사이 비교: 첫 단계는 기준이므로 개선으로 보고, 그 뒤는 직전 단계 최선보다 1% 이상 작아야 개선이다
    const dpiImproved = stepBest !== null && (prevStepBest === null || stepBest <= prevStepBest * (1 - DOWNSAMPLE_MIN_GAIN));
    if (stepBest !== null) prevStepBest = stepBest;
    if (dpiImproved) stalledDpis = 0;
    else if (++stalledDpis >= 2) break; // 두 dpi 단계 연속 제자리 → 더 낮춰도 같다
  }
  if (cancelled) return { cancelled: true, attempts, before: originalBytes.length };
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
// 요청 본문을 Buffer로 모은다. 조각마다 따로 UTF-8로 풀면 조각 경계에 걸린 한글이 깨진다(U+FFFD) → 다 모아 한 번에 푼다.
// 상한을 넘으면 413, 연결이 끊기면 거절해 라우트가 멈춰 있지 않게 한다
const BODY_MAX = 64 * 1024 * 1024;
const body = (req) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > BODY_MAX) return reject(httpError(413, '요청이 너무 큽니다 (최대 64MB)')); // 나머지는 읽어 버린다
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
  req.on('close', () => { if (!req.complete) reject(httpError(400, '요청이 중간에 끊겼습니다')); });
});
// JSON 본문 → 객체. 깨진 JSON은 500이 아니라 400
async function readJson(req) {
  const text = (await body(req)).toString('utf8');
  let q; try { q = JSON.parse(text); } catch { throw httpError(400, '요청 형식이 잘못됐습니다 (JSON)'); }
  if (!q || typeof q !== 'object') throw httpError(400, '요청 형식이 잘못됐습니다 (JSON)');
  return q;
}
// 로컬 요청만 받는다. Host 검사는 DNS 리바인딩(외부 도메인을 127.0.0.1로 돌려 같은 출처처럼 요청) 방지, Origin 검사는 다른 사이트의 교차 출처 요청 방지
let port = PORT; // 실제로 연 포트 — 기본 포트가 다른 프로그램에 잡혀 있으면 아래 listen이 다음 포트로 옮긴다
const localHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
const trustedRequest = (req) => localHosts().includes(req.headers.host || '')
  && (!req.headers.origin || localHosts().map((h) => `http://${h}`).includes(req.headers.origin));

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x'); // '//' 같은 경로는 여기서 던진다 — 잡지 않으면 처리되지 않은 거절로 프로세스가 죽었다
  } catch { return json(res, 400, { error: '잘못된 요청 주소' }); }
  try {
    if (!trustedRequest(req)) return json(res, 403, { error: '허용되지 않은 요청 출처' });
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); }
    if (url.pathname === '/font-editor.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'font-editor.js')).pipe(res); }
    if (url.pathname === '/text-grouping.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'text-grouping.js')).pipe(res); }
    if (url.pathname === '/vendor/marked.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(MARKED_BROWSER).pipe(res); }
    if (url.pathname === '/vendor/purify.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return fs.createReadStream(DOMPURIFY_BROWSER).pipe(res); }
    if (url.pathname === '/api/health') return json(res, 200, { appVersion: APP_VERSION }); // 화면 머리줄의 앱 버전(#ver)이 읽는다
    // P6 C1: 진행 조회·취소. UI는 긴 작업을 시작할 때 만든 jobId로 500ms마다 폴링하고 [취소]에서 cancel을 부른다
    if (url.pathname === '/api/jobs' && req.method === 'GET') {
      const job = jobs.get(url.searchParams.get('id') || '');
      if (!job) return json(res, 404, { error: '작업을 찾을 수 없습니다' }); // 아직 시작 전이거나 끝난 뒤 60초가 지났다
      return json(res, 200, jobView(job));
    }
    if (url.pathname === '/api/jobs/cancel' && req.method === 'POST') {
      const { id } = await readJson(req);
      if (!id) return json(res, 400, { error: '작업 id가 없습니다' });
      const job = jobs.get(id);
      if (!job) { // 아직 등록 전 — 기억해 두면 startJob이 취소 상태로 시작한다(끝난 지 오래된 id면 JOB_TTL 뒤 잊는다)
        clearTimeout(earlyCancels.get(id));
        const timer = setTimeout(() => earlyCancels.delete(id), JOB_TTL); timer.unref();
        earlyCancels.set(id, timer);
        return json(res, 200, { ok: true, pending: true });
      }
      job.cancelled = true; // 실제 중단은 라우트가 다음 단위 작업 사이에서 확인한다
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/workspace' && req.method === 'GET') return json(res, 200, { path: WS });
    if (url.pathname === '/api/workspace' && req.method === 'POST') {
      const { path: p } = await readJson(req);
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
        'X-Retext-Pdf-Temp': isTempPath(p) ? '1' : '0',
        'X-Retext-Pdf-Readonly': isReadOnlyPath(p) ? '1' : '0',
      });
      return fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
    }
    if (url.pathname === '/api/file' && req.method === 'PUT') { writeAtomic(safe(url.searchParams.get('name')), await body(req)); return json(res, 200, { ok: true }); }
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
      const { name, pages, format, dpi, dir, jobId } = await readJson(req);
      const entry = await getEditableDoc(name), { doc } = entry; // 내보내는 동안 실행 취소 등이 doc을 닫지 못하게 잡는다
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 400, { error: '저장할 폴더를 찾을 수 없습니다' });
      const scale = Math.max(36, Math.min(600, Number(dpi) || 150)) / 72;
      const base = path.basename(name).replace(/\.pdf$/i, '');
      const list = Array.isArray(pages) && pages.length ? pages.map(Number) : Array.from({ length: doc.pageCount }, (_, i) => i);
      const files = [];
      const job = startJob(jobId, 'export-images', list.length); // 진행 단위: 페이지 1장
      entry.busy = true;
      try {
        for (const i of list) {
          await tick(); // 이벤트 루프로 한 번 돌아가 취소·폴링을 받는다
          if (!progress(job, { message: `${i + 1}쪽 내보내는 중` })) return json(res, 200, { cancelled: true, files });
          const num = String(i + 1).padStart(2, '0');
          if (format === 'jpeg') {
            const file = path.join(dir, `${base}-p${num}.jpg`);
            writeAtomic(file, doc.renderJpeg(i, scale, 85));
            files.push(file);
          } else {
            const file = path.join(dir, `${base}-p${num}.png`);
            writeAtomic(file, await doc.render(i, scale));
            files.push(file);
          }
          progress(job, { done: files.length });
        }
        return json(res, 200, { files });
      } catch (e) { job.error = e.message; throw e; }
      finally { entry.busy = false; endJob(job); }
    }
    if (url.pathname === '/api/pdf/pages/delete' && req.method === 'POST') { // page:null 스냅샷 → undo/redo가 reloadAll을 준다
      const { name, indices, jobId } = await readJson(req);
      const entry = await getEditableDoc(name);
      // 진행 단위: 삭제 1회(한 번의 WASM 호출이라 그 앞에서만 취소를 본다. 빠르지만 다른 긴 작업과 형식을 맞춘다)
      const job = startJob(jobId, 'pages-delete', 1);
      entry.busy = true;
      try {
        await tick();
        if (!progress(job, { message: '페이지 삭제 중' })) return json(res, 200, { cancelled: true, ...stacks(entry) }); // 아직 아무것도 바꾸지 않았다
        const r = await mutate(entry, null, () => entry.doc.deletePages(indices));
        progress(job, { done: 1 });
        return json(res, 200, { ...r, ...stacks(entry) });
      } catch (e) { job.error = e.message; throw e; }
      finally { entry.busy = false; endJob(job); }
    }
    // ── P5 WP-B2: 회전·순서 변경·추출·분할·검색 ──────────────────────────────
    if (url.pathname === '/api/pdf/pages/rotate' && req.method === 'POST') { // page:null 스냅샷 → 회전은 쪽 크기(가로/세로)가 뒤바뀌어 문서 전체를 다시 그린다
      const { name, indices, delta } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, null, () => entry.doc.rotatePages(indices, delta));
      return json(res, 200, { ...r, reloadAll: true, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/pages/reorder' && req.method === 'POST') { // FPDF_MovePages가 페이지 캐시를 비우므로 문서 전체를 다시 그린다(swapDoc은 불필요)
      const { name, order } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, null, () => entry.doc.reorderPages(order));
      return json(res, 200, { ...r, reloadAll: true, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/pages/extract' && req.method === 'POST') { // 새 문서를 만드는 동작이라 실행취소 스택에는 넣지 않는다(병합과 같은 이유)
      const { name, indices, out } = await readJson(req);
      const { doc } = await getPdfDoc(name);
      const bytes = doc.extractPages(indices);
      const outPath = safe(out);
      dropDoc(out); // 같은 이름으로 이미 열려 있었으면 캐시를 버려 새 내용을 읽게 한다(긴 작업 중이면 409)
      writeAtomic(outPath, bytes);
      const check = await pdfEngine.open(bytes);
      const pageCount = check.pageCount;
      check.close();
      return json(res, 200, { path: out, pageCount });
    }
    if (url.pathname === '/api/pdf/split' && req.method === 'POST') { // N쪽씩 잘라 <이름>-1.pdf, -2.pdf … 로 폴더에 저장 (extractPages 반복 호출, 원본 불변)
      const { name, every, outDir, jobId } = await readJson(req);
      const entry = await getEditableDoc(name), { doc } = entry; // 자르는 동안 doc을 잡아 둔다
      const n = Number(every);
      if (!Number.isInteger(n) || n < 1) return json(res, 400, { error: '쪽 수는 1 이상의 정수로 입력하세요' });
      const dir = safe(outDir);
      if (!outDir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return json(res, 400, { error: '저장할 폴더를 찾을 수 없습니다' });
      const base = path.basename(name).replace(/\.pdf$/i, '');
      const files = [];
      const job = startJob(jobId, 'split', Math.ceil(doc.pageCount / n)); // 진행 단위: 조각 파일 1개
      entry.busy = true;
      try {
        for (let start = 0, part = 1; start < doc.pageCount; start += n, part++) {
          await tick();
          if (!progress(job, { message: `${part}번째 조각 만드는 중` })) return json(res, 200, { cancelled: true, files });
          const indices = Array.from({ length: Math.min(n, doc.pageCount - start) }, (_, k) => start + k);
          const bytes = doc.extractPages(indices);
          const file = path.join(dir, `${base}-${part}.pdf`);
          writeAtomic(file, bytes);
          files.push(file);
          progress(job, { done: files.length });
        }
        return json(res, 200, { files });
      } catch (e) { job.error = e.message; throw e; }
      finally { entry.busy = false; endJob(job); }
    }
    // 빈 질의는 PDFium FindNext가 영영 돌아오지 않는다(엔진 주석 참고) → 라우트 입구에서 바로 거절한다. 문서를 열기 전에 검사해 헛되이 열지 않는다.
    if (url.pathname === '/api/pdf/find' && req.method === 'POST') {
      const { name, query, matchCase } = await readJson(req);
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
      const { paths, out, jobId } = await readJson(req);
      const list = [].concat(paths || []);
      if (!list.length) return json(res, 400, { error: '병합할 파일이 없습니다' });
      // 진행 단위: 읽는 파일 1개 + 마지막 병합 1단계(merge 자체는 한 번의 WASM 호출이라 중간에 멈출 수 없다)
      const job = startJob(jobId, 'merge', list.length + 1);
      try {
        const buffers = [];
        for (const p of list) {
          await tick();
          if (!progress(job, { message: `${path.basename(p)} 읽는 중` })) return json(res, 200, { cancelled: true, files: [] });
          buffers.push(fs.readFileSync(safe(p)));
          progress(job, { done: buffers.length });
        }
        await tick();
        if (!progress(job, { message: '병합하는 중' })) return json(res, 200, { cancelled: true, files: [] });
        const merged = await pdfEngine.merge(buffers);
        dropDoc(out);
        writeAtomic(safe(out), merged);
        const check = await pdfEngine.open(merged);
        const pageCount = check.pageCount;
        check.close();
        progress(job, { done: list.length + 1 });
        return json(res, 200, { path: out, pageCount });
      } catch (e) { job.error = e.message; throw e; }
      finally { endJob(job); }
    }
    if (url.pathname === '/api/pdf/image' && req.method === 'POST') {
      const { name, i, path: imgPath, box } = await readJson(req);
      const entry = await getEditableDoc(name);
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
      const r = await mutate(entry, i, () => entry.doc.insertImage(i, image, finalBox));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/object/resize' && req.method === 'POST') {
      const { name, i, idx, box } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, i, () => entry.doc.resizeObject(i, idx, box));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/images' && req.method === 'POST') {
      const { name } = await readJson(req);
      const entry = await getPdfDoc(name);
      const images = []; let totalBytes = 0;
      for (let i = 0; i < entry.doc.pageCount; i++) {
        for (const st of entry.doc.imageStats(i)) { images.push({ page: i, ...st }); totalBytes += st.bytes; }
      }
      const fileBytes = fs.statSync(safe(name)).size;
      return json(res, 200, { images, totalBytes, fileBytes });
    }
    if (url.pathname === '/api/pdf/downsample' && req.method === 'POST') {
      const q = await readJson(req);
      const { name, targetBytes } = q;
      const maxDpi = Number(q.maxDpi) > 0 ? Number(q.maxDpi) : 150;
      const quality = Number(q.quality) > 0 ? Number(q.quality) : 75;
      const entry = await getEditableDoc(name);
      const originalBytes = entry.doc.save(); // 문서 전체 스냅샷(undo/redo가 reloadAll을 준다) — 성공했을 때만 실행 취소 스택에 쌓는다
      // 진행 단위: 시도 1회(dpi×품질 조합). 목표 용량이 없으면 한 번만 돈다
      const maxAttempts = targetBytes ? new Set([maxDpi, 120, 96, 72]).size * new Set([quality, 60, 45]).size : 1;
      const job = startJob(q.jobId, 'downsample', maxAttempts);
      entry.busy = true;
      try {
        let result;
        try {
          result = await downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes,
            report: ({ message, attempt }) => progress(job, { message, done: Math.max(0, attempt - 1) }) });
        } catch (e) { await restore(entry, null, originalBytes); throw e; } // 도중 실패 → 원본으로(스택·dirty는 그대로)
        if (result.cancelled) { // 문서를 바꾸는 작업 → 원본으로 되돌린다. 하지 않은 일이라 실행 취소 스택에도 넣지 않는다
          await restore(entry, null, originalBytes);
          return json(res, 200, { cancelled: true, attempts: result.attempts, ...stacks(entry) });
        }
        snapshot(entry, null, originalBytes);
        entry.dirty = true;
        return json(res, 200, { ...result, ...downsampleHint(result.skipped), ...stacks(entry) });
      } catch (e) { job.error = e.message; throw e; }
      finally { entry.busy = false; endJob(job); }
    }
    // P5 WP-B2: 빈 상태 빠른 도구 "여러 파일 용량 줄이기" — 문서를 열어 두지 않고 파일 경로 여러 개를 바로 처리한다.
    // 각 파일을 열어 downsampleToTarget을 돌리고 "<이름>-축소.pdf"로 저장한다(원본은 건드리지 않음, 실행취소 스택도 없음).
    if (url.pathname === '/api/pdf/downsample-files' && req.method === 'POST') {
      const q = await readJson(req);
      const paths = [].concat(q.paths || []);
      if (!paths.length) return json(res, 400, { error: '파일을 선택하세요' });
      const maxDpi = Number(q.maxDpi) > 0 ? Number(q.maxDpi) : 150;
      const quality = Number(q.quality) > 0 ? Number(q.quality) : 75;
      const targetBytes = q.targetBytes;
      const results = [];
      const files = [];
      const job = startJob(q.jobId, 'downsample-files', paths.length); // 진행 단위: 파일 1개(파일 안의 시도 사이에서도 취소를 본다)
      try {
        for (const p of paths) {
          await tick();
          if (!progress(job, { message: `${path.basename(p)} 줄이는 중` })) return json(res, 200, { cancelled: true, files, results });
          let entry = null;
          try {
            const src = safe(p);
            const originalBytes = fs.readFileSync(src);
            entry = { doc: await pdfEngine.open(originalBytes) };
            // 파일 안의 시도 진행은 메시지로만 보여 준다(진행 막대는 파일 수 기준을 유지)
            const result = await downsampleToTarget(entry, originalBytes, { maxDpi, quality, targetBytes,
              report: ({ message }) => progress(job, { message: `${path.basename(p)} — ${message}` }) });
            if (result.cancelled) return json(res, 200, { cancelled: true, files, results }); // 만들던 파일은 쓰지 않는다(writeAtomic 전)
            const dir = q.outDir ? safe(q.outDir) : path.dirname(src);
            const outPath = path.join(dir, path.basename(src).replace(/\.pdf$/i, '') + '-축소.pdf');
            writeAtomic(outPath, entry.doc.save());
            files.push(outPath);
            results.push({ path: p, out: outPath, before: result.before, after: result.after, reached: result.reached, used: result.used, ...downsampleHint(result.skipped) });
          } catch (e) { results.push({ path: p, error: e.message }); }
          finally { if (entry) entry.doc.close(); }
          progress(job, { done: results.length });
        }
        return json(res, 200, { results, files });
      } catch (e) { job.error = e.message; throw e; }
      finally { endJob(job); }
    }
    if (url.pathname === '/api/fonts' && req.method === 'GET') return json(res, 200, pdfFonts.list(url.searchParams.get('text') || ''));
    if (url.pathname === '/api/fonts/add' && req.method === 'POST') {
      const { path: file } = await readJson(req);
      return json(res, 200, pdfFonts.publicInfo(pdfFonts.register(file)));
    }
    if (url.pathname === '/api/pdf/font-context' && req.method === 'POST') {
      const q = await readJson(req), { doc } = await getPdfDoc(q.name);
      const ctx = fontService.context(doc, q.i, q.idx, q.text, q.token, q.remove), fonts = pdfFonts.list(q.text);
      return json(res, 200, { ...ctx, ...doc.fontStatus(q.i, q.idx, q.text), fonts, suggestedFontId: pdfFonts.suggest(ctx.object.font, fonts), image: doc.renderRegion(q.i, ctx.region).toString('base64') });
    }
    if (url.pathname === '/api/pdf/font-status' && req.method === 'POST') {
      const q = await readJson(req), { doc } = await getPdfDoc(q.name);
      fontService.context(doc, q.i, q.idx, q.text);
      return json(res, 200, doc.fontStatus(q.i, q.idx, q.text));
    }
    if (['/api/pdf/font-preview', '/api/pdf/font-apply'].includes(url.pathname) && req.method === 'POST') {
      const q = await readJson(req), entry = await getEditableDoc(q.name);
      const prepared = await fontService.prepare(entry.doc, q);
      if (await getPdfDoc(q.name) !== entry) throw new Error('파일이 변경됐습니다. 다시 선택하세요.');
      fontService.context(entry.doc, q.i, q.idx, q.text, q.token, q.remove);
      if (url.pathname.endsWith('font-apply')) {
        const next = await pdfEngine.open(prepared.bytes);
        try {
          fontService.context(entry.doc, q.i, q.idx, q.text, q.token, q.remove);
          snapshot(entry, q.i);
        } catch (error) { next.close(); throw error; }
        entry.doc.close(); entry.doc = next; entry.dirty = true;
      }
      return json(res, 200, { ...prepared.result, image: prepared.image, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/edit' && req.method === 'POST') {
      const { name, i, idx, text } = await readJson(req);
      const entry = await getEditableDoc(name);
      const { primaryResult: r } = await editTransaction(entry, i, [{ idx, text }], { primary: idx });
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/edits' && req.method === 'POST') {
      // remove: 지울 곁가지 조각(보이는 조각), align: { mode:'center'|'right', oldBounds } — 정렬까지 한 트랜잭션(실행 취소 한 번)
      const { name, i, edits, remove, align } = await readJson(req);
      const entry = await getEditableDoc(name);
      const result = await editTransaction(entry, i, edits, { primary: edits?.at(-1)?.idx, remove: [].concat(remove || []), align });
      return json(res, 200, { ...result, lineIdxs: result.primaryResult.lineIdxs || [result.primaryResult.idx], ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/group' && req.method === 'POST') { // 상자 묶기(id 생략→새 그룹) / 풀기(id:null)
      const { name, i, idxs, id } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, i, () => entry.doc.setGroup(i, idxs, id === undefined ? undefined : id));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/fit' && req.method === 'POST') { // 폭 맞춤 편집: wrap(줄바꿈) / shrink(축소) / none
      // blank: 같은 줄의 나머지 조각 idx들 — 여기서 함께 비운다. 편집 한 번은 실행 취소 한 번이어야 하는데,
      // 예전에는 UI가 /api/pdf/edits로 먼저 비우고 /api/pdf/fit을 또 불러 스냅샷이 두 개 쌓였다(Ctrl+Z 두 번 필요).
      const { name, i, idx, text, maxWidth, mode, blank, remove, align } = await readJson(req);
      const entry = await getEditableDoc(name);
      const result = await editTransaction(entry, i, [
        ...[].concat(blank || []).map((b) => ({ idx: b, text: ' ' })),
        { idx, text },
      ], { primary: idx, fit: { maxWidth: +maxWidth, mode }, remove: [].concat(remove || []), align });
      const r = result.primaryResult;
      return json(res, 200, { ...r, lineIdxs: r.lineIdxs || [r.idx], ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/charboxes' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, doc.charBoxes(+url.searchParams.get('i'), +url.searchParams.get('idx')));
    }
    if (url.pathname === '/api/pdf/move' && req.method === 'POST') {
      const { name, i, idxs, dx, dy } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, i, () => entry.doc.move(i, idxs, dx, dy));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/rect' && req.method === 'POST') {
      const { name, i, bounds, color } = await readJson(req);
      const entry = await getEditableDoc(name);
      const col = color === 'auto' ? entry.doc.sampleColor(i, bounds) : (color || [0, 0, 0, 255]); // 'auto' = 그 자리 배경색
      const r = await mutate(entry, i, () => { const a = entry.doc.addRect(i, bounds, col); return a.idx < 0 ? { ...a, ok: false } : a; });
      return json(res, 200, { ...r, color: col, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/remove' && req.method === 'POST') {
      const { name, i, idx } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, i, () => entry.doc.removeObject(i, idx));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redact' && req.method === 'POST') {
      const { name, i, idx, from, to } = await readJson(req);
      const entry = await getEditableDoc(name);
      const r = await mutate(entry, i, () => entry.doc.redact(i, idx, from, to));
      return json(res, 200, { ...r, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/mask' && req.method === 'POST') {
      const { name, i, parts, fallbackRects, color } = await readJson(req);
      if (!Array.isArray(parts)) return json(res, 400, { error: '가릴 글자를 고르세요' });
      const entry = await getEditableDoc(name);
      const rects = [], skipped = [];
      const colFor = (b) => (color === 'auto' ? entry.doc.sampleColor(i, b) : (color || [0, 0, 0, 255])); // 'auto' = 그 자리 배경색
      // 하나라도 가렸으면 성공(건너뛴 조각은 skipped로 알린다). 아무것도 못 가렸으면 ok:false — 문서·스택은 그대로
      const r = await mutate(entry, i, () => {
        // redact가 idx+1에 새 텍스트 객체를 끼워넣어 뒤 인덱스를 밀어내므로, 앞 인덱스가 안 밀리도록 뒤에서부터 처리
        const sorted = [...parts].sort((a, b) => b.idx - a.idx);
        for (const { idx, from, to } of sorted) {
          const r = entry.doc.redact(i, idx, from, to, color === 'auto' ? 'auto' : (color || undefined));
          if (r.ok) { rects.push(...r.rects); continue; } // redact가 이미 사각형을 얹었다
          // 글자 단위로 못 자르는 객체(조각 텍스트 charmap, 회전·기울임 rotated): 객체 전체를 공백으로 지우고 상자를 따로 덮는다
          if (r.reason === 'charmap' || r.reason === 'rotated') {
            const obj = entry.doc.objects(i)[idx];
            const col = obj && obj.bounds ? colFor(obj.bounds) : null; // 글자를 지우기 전에 색을 잰다
            const cleared = entry.doc.setText(i, idx, ' ');
            if (!cleared?.ok) { skipped.push({ idx, reason: cleared?.reason || 'clear' }); continue; } // 글자가 남는데 덮기만 하면 안 된다
            // 같은 자리에 겹쳐 그린 사본(굵게·그림자용)도 비운다 — 안 비우면 저장 뒤 사본에서 가린 글자가 다시 읽힌다.
            // _setOneRaw는 객체 자리를 유지한다(setText는 투명 사본을 드러내며 맨 뒤로 옮겨 남은 parts의 인덱스를 민다)
            for (const j of r.twins || []) {
              const t = entry.doc._setOneRaw(i, j, ' ');
              if (!t?.ok) skipped.push({ idx: j, reason: t?.reason || 'twin' });
            }
            if (obj && obj.bounds) { entry.doc.addRect(i, obj.bounds, col); rects.push(obj.bounds); }
          } else skipped.push({ idx, reason: r.reason });
        }
        for (const b of (fallbackRects || [])) { entry.doc.addRect(i, b, colFor(b)); rects.push(b); }
        return { ok: rects.length > 0 };
      });
      return json(res, 200, { ok: r.ok, rects: r.ok ? rects : [], skipped, textLeft: entry.doc.pageText(i), ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/undo' && req.method === 'POST') {
      const { name } = await readJson(req);
      const entry = await getEditableDoc(name);
      if (!entry.undo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.undo.at(-1), current = entry.doc.save();
      await swapDoc(entry, bytes); // 먼저 바꿔 끼운다 — 열기에 실패하면 스택은 그대로다
      entry.undo.pop();
      entry.redo.push({ bytes: current, page });
      trimStacks(entry); // redo로 옮겨도 합계는 그대로다 → 상한을 다시 확인한다(P6 C3)
      entry.dirty = true;
      return json(res, 200, { ok: true, page, reloadAll: page === null, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/redo' && req.method === 'POST') {
      const { name } = await readJson(req);
      const entry = await getEditableDoc(name);
      if (!entry.redo.length) return json(res, 200, { ok: false });
      const { bytes, page } = entry.redo.at(-1), current = entry.doc.save();
      await swapDoc(entry, bytes);
      entry.redo.pop();
      entry.undo.push({ bytes: current, page });
      trimStacks(entry); // P6 C3
      entry.dirty = true;
      return json(res, 200, { ok: true, page, reloadAll: page === null, ...stacks(entry) });
    }
    if (url.pathname === '/api/pdf/text' && req.method === 'GET') {
      const { doc } = await getPdfDoc(url.searchParams.get('name'));
      return json(res, 200, { text: doc.pageText(+url.searchParams.get('i')) });
    }
    if (url.pathname === '/api/pdf/save' && req.method === 'POST') {
      const { name } = await readJson(req);
      const entry = await getEditableDoc(name);
      const p = safe(name);
      writeAtomic(p, entry.doc.save());
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false; entry.externalChange = false;
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pdf/saveas' && req.method === 'POST') {
      const { name, to } = await readJson(req);
      const entry = await getEditableDoc(name);
      const p = safe(to), from = docKey(name), key = docKey(to);
      if (from !== key) dropDoc(to); // 대상이 따로 열려 있었으면 버린다(긴 작업 중이면 409 — 쓰기 전에)
      writeAtomic(p, entry.doc.save());
      entry.mtimeMs = fs.statSync(p).mtimeMs; entry.dirty = false; entry.externalChange = false;
      if (from !== key) { delete pdfDocs[from]; pdfDocs[key] = entry; }
      return json(res, 200, { ok: true, path: to });
    }
    if (url.pathname === '/api/pdf/close' && req.method === 'POST') {
      const { name } = await readJson(req);
      dropDoc(name);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    if (res.headersSent) return res.end();
    json(res, e.status || 500, { error: e.message });
  }
});
// 기본 포트가 사용 중이면(다른 프로그램, 개발용 서버) 다음 포트를 차례로 시도한다. ready는 실제로 연 포트로 resolve — Electron 창은 이 포트로 접속
// listen(p, cb)의 cb는 'listening' 리스너로 남아 실패한 시도의 것까지 다음 성공 때 함께 불린다 → 리스너를 직접 달고 실패하면 떼어 낸다
// RETEXTPDF_NO_LISTEN=1 이면 포트를 열지 않는다 — server.test.js가 순수 함수(snapshot·downsampleToTarget·jobs)만 불러 쓰기 위한 것
const ready = process.env.RETEXTPDF_NO_LISTEN === '1' ? Promise.resolve(0) : new Promise((resolve, reject) => {
  const listen = (p, retries) => {
    const onError = (e) => {
      server.off('listening', onListening);
      if (e.code === 'EADDRINUSE' && retries > 0) { console.warn(`포트 ${p} 사용 중 → ${p + 1} 시도`); return listen(p + 1, retries - 1); }
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError); server.on('error', (e) => console.error('server:', e.message));
      port = server.address().port; console.log(`Retext PDF → http://localhost:${port}  workspace=${WS}`); resolve(port);
    };
    server.once('error', onError); server.once('listening', onListening);
    server.listen(p, '127.0.0.1');
  };
  listen(PORT, 10);
});
ready.catch((e) => console.error('server:', e.message));
module.exports = { PORT, ready, port: () => port,
  // 자체 검사용(server.test.js): P6 C1·C3·C4 로직을 직접 부르고, server를 4848에 직접 listen해 라우트를 가짜 엔진으로 검사한다
  _test: { server, pdfDocs, jobs, startJob, progress, endJob, jobView, snapshot, stacks, trimStacks, downsampleToTarget, UNDO_MAX, UNDO_MAX_BYTES } };
