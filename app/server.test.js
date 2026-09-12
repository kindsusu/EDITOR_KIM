// 자체 검사: node app/server.test.js
// 서버의 P6 로직(C1 작업 진행·취소, C3 실행 취소 메모리 상한, C4 용량 줄이기 조기 종료)을 라우트 없이 함수 단위로 검사한다.
// PDFium을 쓰지 않도록 pdf-engine.open을 가짜 문서로 바꿔 둔 뒤 server.js를 읽어 들인다(EDITORKIM_NO_LISTEN=1 → 포트를 열지 않는다).
const assert = require('assert');

process.env.EDITORKIM_NO_LISTEN = '1';
const engine = require('./pdf-engine');

// 가짜 문서: downsample()은 아래 script(maxDpi·quality → after 바이트)가 정하고, save()는 그 길이만큼의 버퍼를 준다
let script = () => 1000;
let lastAfter = 1000;
engine.open = async (bytes) => ({
  downsample({ maxDpi, quality }) {
    lastAfter = script(maxDpi, quality);
    return { ok: true, changed: 1, skipped: [], before: bytes.length, after: lastAfter };
  },
  save() { return Buffer.alloc(lastAfter); }, // best.bytes — 길이만 쓰인다
  close() {},
});
const { _test } = require('./server.js');
const { jobs, startJob, progress, endJob, jobView, snapshot, stacks, trimStacks, downsampleToTarget, rollback, UNDO_MAX_BYTES } = _test;

(async () => {
  // ── C1: 작업 등록·진행·취소·완료 ──────────────────────────────────────────
  {
    const job = startJob('j1', 'split', 5);
    assert.strictEqual(jobs.get('j1'), job, 'jobId가 있으면 등록된다');
    assert.deepStrictEqual(jobView(job), { id: 'j1', phase: 'split', done: 0, total: 5, message: '', finished: false, cancelled: false, error: null });
    assert.strictEqual(progress(job, { done: 2, message: '2번째' }), true, '취소 전에는 계속 진행');
    assert.deepStrictEqual([job.done, job.message], [2, '2번째']);
    job.cancelled = true; // POST /api/jobs/cancel 이 하는 일
    assert.strictEqual(progress(job, { done: 3 }), false, '취소되면 progress가 false');
    assert.strictEqual(job.done, 3, '취소 뒤에도 마지막 진행은 기록된다');
    endJob(job);
    assert.strictEqual(job.finished, true);
    assert.ok(job.timer, '끝난 작업은 자동 삭제 타이머가 걸린다');
    clearTimeout(job.timer); jobs.delete('j1');

    const untracked = startJob(null, 'merge', 3);
    assert.strictEqual(untracked.id, null);
    assert.strictEqual(jobs.size, 0, 'jobId가 없으면 등록하지 않는다(진행 추적 없음)');
    assert.strictEqual(progress(untracked, { done: 1 }), true, '추적하지 않는 작업도 같은 경로로 돈다');

    const failed = startJob('j2', 'downsample', 1);
    failed.error = '저장 실패';
    endJob(failed);
    endJob(failed, { error: '두 번째 오류' }); // catch와 finally가 겹쳐 불려도
    assert.strictEqual(jobView(failed).error, '저장 실패', '처음 오류가 남는다');
    clearTimeout(failed.timer); jobs.delete('j2');
    const reused = startJob('j3', 'split', 1); endJob(reused);
    const again = startJob('j3', 'split', 2); // 같은 id를 다시 쓰면 옛 타이머를 끄고 새로 시작
    assert.strictEqual(again.finished, false);
    assert.strictEqual(jobs.get('j3'), again);
    clearTimeout(again.timer); jobs.delete('j3');
  }

  // ── C3: 실행 취소 메모리 상한 ─────────────────────────────────────────────
  {
    // 실제로 100MB를 네 번 만들 필요는 없다 — snapshot·trimStacks는 bytes.length만 본다(가짜 entry)
    const size = 100 * 1024 * 1024; // 100MB 문서 → 3장이면 300MB로 상한(256MB)을 넘는다
    const entry = { doc: { save: () => ({ length: size }) }, undo: [], redo: [], undoBytes: 0, undoTrimmed: false };
    snapshot(entry, 0); snapshot(entry, 1);
    assert.deepStrictEqual([entry.undo.length, entry.undoBytes], [2, 2 * size]);
    assert.strictEqual(stacks(entry).undoTrimmed, undefined, '상한 아래에서는 undoTrimmed를 보내지 않는다');
    snapshot(entry, 2); snapshot(entry, 3);
    assert.strictEqual(entry.undo.length, 3, '최소 3단계는 남긴다(상한을 넘더라도)');
    assert.strictEqual(entry.undoBytes, 3 * size);
    assert.ok(entry.undoBytes > UNDO_MAX_BYTES, '3단계 보장이 상한보다 우선한다');
    const first = stacks(entry);
    assert.strictEqual(first.undoTrimmed, true, '잘라냈으면 한 번 알린다');
    assert.strictEqual(stacks(entry).undoTrimmed, undefined, 'undoTrimmed는 1회성');
    assert.deepStrictEqual([first.undoLeft, first.redoLeft], [3, 0]);
    assert.deepStrictEqual([entry.undo[0].page, entry.undo[2].page], [1, 3], '가장 오래된 것부터 버린다');

    // redo도 같은 합계에 들어간다
    const e2 = { undo: [], redo: [], undoBytes: 0, undoTrimmed: false };
    for (let i = 0; i < 5; i++) e2.undo.push({ bytes: { length: 10 * 1024 * 1024 }, page: i });
    e2.redo.push({ bytes: { length: 250 * 1024 * 1024 }, page: null });
    trimStacks(e2);
    assert.strictEqual(e2.undo.length, 3, 'redo가 자리를 차지하면 undo를 더 버린다');
    assert.strictEqual(e2.undoBytes, 250 * 1024 * 1024 + 3 * 10 * 1024 * 1024);
    assert.strictEqual(e2.undoTrimmed, true);
  }

  // ── C4: 조기 종료 ────────────────────────────────────────────────────────
  const target = 500;
  const combos = (list) => list.map((c) => `${c.maxDpi}/${c.quality}`);
  {
    // ① 아무리 줄여도 안 줄어드는 문서(단계 안·단계 사이 모두 제자리): dpi마다 품질 2회로 제자리를 확인하고
    //    개선 없는 dpi 단계가 두 번 연속되면 멈춘다 → 6회(이전 구현은 12회)
    script = () => 1000;
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.strictEqual(r.attempts.length, 6, `시도 6회여야 한다: ${JSON.stringify(combos(r.attempts))}`);
    assert.deepStrictEqual(combos(r.attempts), ['150/75', '150/60', '120/75', '120/60', '96/75', '96/60']);
    assert.strictEqual(r.reached, false);
    assert.ok(r.attempts.every((a) => a.skipped === 0), 'attempts에는 실제 시도만 들어간다(건너뛴 조합은 없다)');
  }
  {
    // ①-2 단계 안에서는 계속 줄지만 단계 사이에서는 제자리: 첫 dpi는 품질 3단계를 다 쓰고,
    //     그 뒤 두 dpi가 연속으로 직전 단계 최선을 1% 이상 못 줄이면 멈춘다 → 3+2+2 = 7회
    script = (dpi, q) => (dpi === 150 ? { 75: 1000, 60: 900, 45: 810 }[q] : 810);
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.deepStrictEqual(combos(r.attempts), ['150/75', '150/60', '150/45', '120/75', '120/60', '96/75', '96/60']);
    assert.strictEqual(r.after, 810);
    assert.deepStrictEqual(r.used, { maxDpi: 150, quality: 45 });
  }
  {
    // ①-3 낮은 dpi의 첫 시도가 전체 최선보다 오히려 크지만 같은 단계에서 품질을 낮추면 확 줄어드는 문서.
    //     비교 기준이 전체 최선이면 120/75(1100 > 1000)에서 단계를 접어 120/60(600)을 놓쳤다 —
    //     같은 단계의 직전 시도와 견주므로 이제 놓치지 않는다.
    script = (dpi, q) => ({ 150: { 75: 1000, 60: 1000, 45: 1000 }, 120: { 75: 1100, 60: 600, 45: 600 }, 96: { 75: 400, 60: 400, 45: 400 } }[dpi][q]);
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.deepStrictEqual(combos(r.attempts), ['150/75', '150/60', '120/75', '120/60', '120/45', '96/75']);
    assert.strictEqual(r.reached, true, '96dpi에서 목표(500)에 닿는다');
    assert.deepStrictEqual(r.used, { maxDpi: 96, quality: 75 });
  }
  {
    // ② 단계마다 1% 넘게 줄어드는 문서: 목표에 못 닿으면 12회를 다 돈다(이전과 같은 동작)
    const seq = [1000, 970, 941, 913, 886, 859, 833, 808, 784, 760, 737, 715]; // 단계마다 3%씩
    let k = 0; script = () => seq[k++];
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.strictEqual(r.attempts.length, 12, '개선이 계속되면 모든 조합을 시도한다');
    assert.strictEqual(r.reached, false);
    assert.strictEqual(r.after, 715, '목표 미달이면 최선 결과로 확정한다');
    assert.deepStrictEqual(r.used, { maxDpi: 72, quality: 45 });
  }
  {
    // ③ 목표에 닿으면 그 자리에서 멈춘다

    const seq = [1000, 900, 400];
    let k = 0; script = () => seq[k++];
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.strictEqual(r.attempts.length, 3);
    assert.strictEqual(r.reached, true);
    assert.deepStrictEqual(r.used, { maxDpi: 150, quality: 45 });
  }
  {
    // ④ 품질 단계는 제자리인데 dpi 단계가 효과가 있는 문서: 품질 단계만 건너뛴다

    script = (dpi) => ({ 150: 1000, 120: 800, 96: 640, 72: 512 })[dpi];
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.deepStrictEqual(combos(r.attempts), ['150/75', '150/60', '120/75', '120/60', '96/75', '96/60', '72/75', '72/60'],
      'dpi마다 품질 2단계에서 제자리를 확인하고 다음 dpi로 간다');
    assert.strictEqual(r.after, 512);
  }
  {
    // ⑤ 목표 용량이 없으면 한 번만 실행한다(기존 동작)
    script = () => 700;
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75 });
    assert.strictEqual(r.attempts.length, 1);
    assert.strictEqual(r.reached, true);
  }
  {
    // ⑥ 취소: report가 false를 주면 시도 사이에서 멈추고 cancelled를 돌려준다
    script = () => 900;
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    let seen = 0;
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target,
      report: () => ++seen < 3 });
    assert.strictEqual(r.cancelled, true);
    assert.strictEqual(r.attempts.length, 1, '취소 시점까지의 시도만 남는다');
  }

  {
    // ⑦ 목표 미달이면 최소 결과로 확정한다 — 마지막 시도가 더 크면 앞선 최선으로 되돌려야 한다
    //    (P6 전에는 best에 after 필드가 없어 비교가 항상 false → 첫 시도 결과로 확정되는 버그가 있었다)
    const seq = [1000, 600, 700, 650, 650, 650, 650];
    let k = 0; script = () => seq[k++];
    const entry = { doc: await engine.open(Buffer.alloc(1000)) };
    const r = await downsampleToTarget(entry, Buffer.alloc(1000), { maxDpi: 150, quality: 75, targetBytes: target });
    assert.strictEqual(r.reached, false);
    assert.strictEqual(r.attempts.length, 7, `150dpi 3회 + 제자리 dpi 2단계 2회씩: ${JSON.stringify(combos(r.attempts))}`);
    assert.strictEqual(r.after, 600, `최소 결과로 확정: ${JSON.stringify(r.attempts.map((a) => a.after))}`);
    assert.deepStrictEqual(r.used, { maxDpi: 150, quality: 60 });
  }

  // ── 취소된 문서 편집의 원상 복구: 스냅샷을 pop해 실행 취소 스택에 남기지 않는다 ──
  {
    const entry = { doc: await engine.open(Buffer.alloc(10)), undo: [{ bytes: Buffer.alloc(777), page: null }], redo: [], undoBytes: 777, undoTrimmed: false };
    const popped = await rollback(entry);
    assert.strictEqual(popped.bytes.length, 777);
    assert.deepStrictEqual([entry.undo.length, entry.undoBytes], [0, 0]);
    assert.strictEqual(await rollback({ undo: [], redo: [], undoBytes: 0 }), undefined, '스냅샷이 없으면 아무것도 하지 않는다');
  }

  console.log('OK — P6 서버 로직(C1 작업·C3 undo 상한·C4 조기 종료) 검사 통과');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
