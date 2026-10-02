// 자체 검사: node app/server.test.js
// 서버의 P6 로직(C1 작업 진행·취소, C3 실행 취소 메모리 상한, C4 용량 줄이기 조기 종료)을 라우트 없이 함수 단위로 검사한다.
// PDFium을 쓰지 않도록 pdf-engine.open을 가짜 문서로 바꿔 둔 뒤 server.js를 읽어 들인다(EDITORKIM_NO_LISTEN=1 → 포트를 열지 않는다).
const assert = require('assert');

process.env.EDITORKIM_NO_LISTEN = '1';
process.env.EDITORKIM_PORT = '4848'; // 라우트 검사는 아래에서 직접 listen한다(사용자 앱의 4747은 쓰지 않는다)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const engine = require('./pdf-engine');

// 가짜 문서: downsample()은 아래 script(maxDpi·quality → after 바이트)가 정하고,
// 문서 내용은 문자열 state로 흉내 낸다 — open(bytes)이 state를 읽고 save()가 그대로 돌려준다.
// move(i, idxs, dx): state에 '+m'을 붙인다. idxs가 비면 일부만 바꾼 뒤 ok:false, dx==='throw'면 바꾼 뒤 던진다(되돌리기 검사용)
let script = () => 1000;
let failOpen = false;
const closed = [];
engine.open = async (bytes) => {
  if (failOpen) throw new Error('열기 실패(가짜)');
  const doc = {
    state: Buffer.from(bytes).toString(),
    downsample({ maxDpi, quality }) {
      const after = script(maxDpi, quality);
      return { ok: true, changed: 1, skipped: [], before: bytes.length, after };
    },
    pageCount: 1,
    pageSize: () => ({ w: 100, h: 100, rotation: 0 }),
    move(i, idxs, dx) {
      doc.state += '+partial';
      if (dx === 'throw') throw new Error('엔진 오류(가짜)');
      if (!idxs.length) return { ok: false, moved: 0 };
      doc.state = doc.state.replace('+partial', '+m');
      return { ok: true, moved: idxs.length };
    },
    save() { return Buffer.from(doc.state); },
    close() { closed.push(doc); },
  };
  return doc;
};
const { _test } = require('./server.js');
const { server, pdfDocs, jobs, startJob, progress, endJob, jobView, snapshot, stacks, trimStacks, downsampleToTarget, UNDO_MAX_BYTES } = _test;

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

  // ── 라우트 검사(가짜 엔진, 127.0.0.1:4848) ─────────────────────────────────
  await new Promise((resolve) => server.listen(4848, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-kim-server-'));
  const raw = (method, route, data, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 4848, method, path: route, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let body = text; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject);
    req.end(data);
  });
  const post = (route, data) => raw('POST', route, JSON.stringify(data));
  const info = async (name) => (await raw('GET', '/api/pdf/info?' + new URLSearchParams({ name }))).body;
  try {
    // 1: '//' 같은 경로가 프로세스를 죽이지 않고 400
    assert.strictEqual((await raw('GET', '//')).status, 400);
    assert.strictEqual((await raw('GET', '/api/workspace')).status, 200, '서버가 살아 있다');

    // 2: 큰 한글 본문이 조각 경계에서 깨지지 않는다 / 깨진 JSON은 400 / 상한 초과는 413
    {
      const md = path.join(dir, '한글.md'), text = '# 회의록\n' + '가나다라마바사아자차카타파하 한글 문장입니다. '.repeat(7000);
      assert.ok(Buffer.byteLength(text) > 280000);
      assert.strictEqual((await raw('PUT', '/api/file?' + new URLSearchParams({ name: md }), Buffer.from(text))).status, 200);
      assert.ok(fs.readFileSync(md, 'utf8') === text, '저장한 글자가 그대로다(U+FFFD 없음)'); // strictEqual은 실패 시 280KB 차이를 찍는다
      const bad = await raw('POST', '/api/pdf/move', '{not json');
      assert.strictEqual(bad.status, 400);
      assert.match(bad.body.error, /요청 형식/);
      const big = await raw('PUT', '/api/file?' + new URLSearchParams({ name: path.join(dir, 'big.md') }), Buffer.alloc(65 * 1024 * 1024, 0x61));
      assert.strictEqual(big.status, 413);
      assert.ok(!fs.existsSync(path.join(dir, 'big.md')), '상한을 넘으면 쓰지 않는다');
    }

    const name = path.join(dir, 'a.pdf');
    fs.writeFileSync(name, 'v1');
    let clock = Date.now();
    const bump = (content) => { fs.writeFileSync(name, content); const t = new Date((clock += 10000)); fs.utimesSync(name, t, t); };
    const count = Object.keys(pdfDocs).length;
    // 3c: 같은 파일의 다른 표기는 한 항목
    assert.strictEqual((await info(name)).dirty, false);
    assert.strictEqual((await info(dir + path.sep + '.' + path.sep + 'a.pdf')).dirty, false);
    if (process.platform === 'win32') assert.strictEqual((await info(name.toUpperCase())).dirty, false);
    assert.strictEqual(Object.keys(pdfDocs).length, count + 1, '표기가 달라도 캐시 항목은 하나');
    const entry = () => Object.values(pdfDocs)[count];

    // 3a: 디스크가 바뀌어 다시 열다 실패해도 닫힌 문서가 캐시에 남지 않는다(다음 요청에서 이중 close·해제 후 사용 없음)
    {
      const old = entry().doc;
      bump('v2'); failOpen = true;
      assert.strictEqual((await raw('GET', '/api/pdf/info?' + new URLSearchParams({ name }))).status, 500);
      failOpen = false;
      assert.strictEqual(Object.keys(pdfDocs).length, count, '실패한 항목은 캐시에서 빠졌다');
      assert.strictEqual((await info(name)).dirty, false);
      assert.strictEqual(closed.filter((d) => d === old).length, 1, '옛 문서는 정확히 한 번 닫혔다');
      assert.strictEqual(entry().doc.state, 'v2');
    }

    // 4: 실패한 변경(ok:false·예외)은 스택·dirty·문서를 건드리지 않는다
    {
      const live = entry().doc;
      const before = await info(name);
      const noop = await post('/api/pdf/move', { name, i: 0, idxs: [], dx: 1, dy: 0 });
      assert.deepStrictEqual([noop.status, noop.body.ok], [200, false]);
      const thrown = await post('/api/pdf/move', { name, i: 0, idxs: [1], dx: 'throw', dy: 0 });
      assert.strictEqual(thrown.status, 500);
      assert.deepStrictEqual(await info(name), before, 'undo/redo/dirty 그대로');
      assert.strictEqual(entry().doc.state, 'v2', '부분 변경은 되돌려졌다');
      assert.notStrictEqual(entry().doc, live, '되돌리기는 변경 전 바이트로 다시 연 문서');
      const ok = await post('/api/pdf/move', { name, i: 0, idxs: [1], dx: 1, dy: 0 });
      assert.deepStrictEqual([ok.status, ok.body.undoLeft, ok.body.redoLeft], [200, 1, 0]);
      assert.strictEqual(entry().dirty, true);
      assert.strictEqual((await post('/api/pdf/mask', { name, i: 0 })).status, 400, 'parts가 없으면 400');
    }

    // 5: 실행 취소·다시 실행 — 바꿔 끼우기가 실패하면 스택은 그대로
    {
      failOpen = true;
      assert.strictEqual((await post('/api/pdf/undo', { name })).status, 500);
      failOpen = false;
      const after = await info(name);
      assert.deepStrictEqual([after.undoLeft, after.redoLeft], [1, 0], '실패한 undo는 스택을 옮기지 않는다');
      assert.strictEqual(entry().doc.state, 'v2+m');
      const u = await post('/api/pdf/undo', { name });
      assert.deepStrictEqual([u.body.ok, u.body.undoLeft, u.body.redoLeft], [true, 0, 1]);
      assert.strictEqual(entry().doc.state, 'v2');
      failOpen = true;
      assert.strictEqual((await post('/api/pdf/redo', { name })).status, 500);
      failOpen = false;
      const mid = await info(name);
      assert.deepStrictEqual([mid.undoLeft, mid.redoLeft], [0, 1], '실패한 redo도 스택을 옮기지 않는다');
      const r = await post('/api/pdf/redo', { name });
      assert.deepStrictEqual([r.body.undoLeft, r.body.redoLeft], [1, 0]);
      assert.strictEqual(entry().doc.state, 'v2+m');
    }

    // 3b: 미저장 편집 중 디스크 파일이 바뀌어도 다시 열지 않고 externalChange로 알린다
    {
      bump('v3');
      const i3 = await info(name);
      assert.strictEqual(i3.externalChange, true);
      assert.deepStrictEqual([i3.dirty, i3.undoLeft], [true, 1], '편집과 실행 취소 기록이 남는다');
      assert.strictEqual(entry().doc.state, 'v2+m');
      const moved = await post('/api/pdf/move', { name, i: 0, idxs: [1], dx: 1, dy: 0 });
      assert.strictEqual(moved.body.externalChange, true, '변경 응답에도 실린다');
      assert.strictEqual((await post('/api/pdf/save', { name })).body.ok, true);
      assert.strictEqual((await info(name)).externalChange, undefined, '저장하면 풀린다');
      assert.strictEqual(fs.readFileSync(name, 'utf8'), 'v2+m+m');
    }

    // 11: 긴 작업 중인 문서를 바꾸는 요청은 409 / 등록 전에 온 취소는 기억된다
    {
      entry().busy = true;
      for (const [route, data] of [['/api/pdf/move', { name, i: 0, idxs: [1], dx: 1, dy: 0 }], ['/api/pdf/undo', { name }], ['/api/pdf/save', { name }], ['/api/pdf/close', { name }]]) {
        const r = await post(route, data);
        assert.deepStrictEqual([r.status, r.body.error], [409, '긴 작업이 끝난 뒤 다시 시도하세요.'], route);
      }
      entry().busy = false;
      const c = await post('/api/jobs/cancel', { id: 'early-1' });
      assert.deepStrictEqual([c.status, c.body.pending], [200, true]);
      const job = startJob('early-1', 'downsample', 1);
      assert.strictEqual(job.cancelled, true, '먼저 온 취소가 적용된다');
      assert.strictEqual(progress(job), false);
      endJob(job); clearTimeout(job.timer); jobs.delete('early-1');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('OK — P6 서버 로직(C1 작업·C3 undo 상한·C4 조기 종료)·라우트(주소·본문·캐시·되돌리기·409) 검사 통과');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
