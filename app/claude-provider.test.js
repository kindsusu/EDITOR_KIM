const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

// Exercise the real adapter without a login or billable requests. Only the CLI process is replaced.
function harness() {
  let child, argv, input = '', killed = false;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./ai-providers'), 'utf8'), {
    module, process, Buffer, setTimeout, clearTimeout,
    require: (name) => name === 'child_process' ? {
      execFile: (_file, _args, _options, callback) => queueMicrotask(() => callback(null, 'C:\\fake\\claude.exe', '')),
      spawn: (_file, args) => {
        argv = args; child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
        child.stdin.on('data', (data) => { input += data; });
        child.kill = () => { killed = true; }; // A delayed close must not delay cancellation.
        return child;
      },
    } : name === 'fs' ? { ...fs, existsSync: () => true } : require(name),
  });
  const adapter = module.exports.createProviders({ version: 'test' });
  return {
    ask: (options = {}, delta = () => {}) => adapter.ask('claude', { prompt: '폰트 추천', ...options }, delta),
    ready: () => new Promise(setImmediate),
    emit: (value, newline = true) => child.stdout.write(JSON.stringify(value) + (newline ? '\n' : '')),
    bytes: (data) => { for (const byte of data) child.stdout.write(Buffer.from([byte])); },
    close: (code = 0) => child.emit('close', code),
    get args() { return argv; }, get input() { return input; }, get killed() { return killed; },
  };
}
const delta = (text) => ({ type: 'stream_event', event: { delta: { type: 'text_delta', text } } });
const result = (text) => ({ type: 'result', is_error: false, result: text, modelUsage: { 'claude-test': {} }, session_id: 'session' });

test('Claude sends the chosen model and image, and uses the final JSON across UTF-8 chunk boundaries', async () => {
  const h = harness(), promise = h.ask({ model: 'opus', images: ['cG5n'] }); await h.ready();
  assert.equal(h.args[h.args.indexOf('--model') + 1], 'opus');
  assert.equal(h.args[h.args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(JSON.parse(h.input).message.content[1].source.data, 'cG5n');
  h.emit(delta('중간 설명'));
  h.bytes(Buffer.from(JSON.stringify(result('{"note":"한글 최종 응답"}')))); h.close();
  assert.equal((await promise).text, '{"note":"한글 최종 응답"}');
});
test('Claude errors reject even after partial text', async () => {
  const h = harness(), promise = h.ask(); await h.ready();
  h.emit(delta('일부 응답')); h.emit({ type: 'result', is_error: true, errors: ['usage limit reached'] }); h.close(1);
  await assert.rejects(promise, /usage limit reached/);
});
test('Text-only Claude requests retain streaming and conversation resume', async () => {
  const h = harness(), chunks = [], promise = h.ask({ session: 'prior-session' }, (text) => chunks.push(text));
  await h.ready();
  assert.equal(h.args[h.args.indexOf('--resume') + 1], 'prior-session');
  assert.ok(!h.args.includes('--input-format')); assert.equal(h.input, '폰트 추천');
  h.emit(delta('정상 응답')); h.emit(result('정상 응답')); h.close();
  assert.equal((await promise).text, '정상 응답'); assert.deepEqual(chunks, ['정상 응답']);
});
test('Claude cannot succeed on a truncated stream or failed process', async () => {
  for (const code of [0, 1]) {
    const h = harness(), promise = h.ask(); await h.ready();
    h.emit(delta('일부 응답')); if (code) h.emit(result('final')); h.close(code);
    await assert.rejects(promise, /종료|완료/);
  }
});
test('Abort during executable discovery never starts Claude', { timeout: 1000 }, async () => {
  const h = harness(), controller = new AbortController();
  const promise = h.ask({ signal: controller.signal }); controller.abort();
  await assert.rejects(promise, (e) => e.aborted === true); assert.equal(h.args, undefined);
});
test('Abort rejects immediately without waiting for process close', async () => {
  const h = harness(), controller = new AbortController(), promise = h.ask({ signal: controller.signal });
  await h.ready(); controller.abort();
  await assert.rejects(Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('still pending'), 100))]), (e) => e.aborted === true);
  assert.equal(h.killed, true); h.close();
});
