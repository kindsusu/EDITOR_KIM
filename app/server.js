// 프로토타입 백엔드: 정적 UI 제공 + 파일 읽기/쓰기 + `claude -p` 호출 (API 키 없음, Claude Code 로그인 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const WS = path.join(ROOT, 'workspace');
const PORT = 4747;

const safe = (p) => {
  const abs = path.resolve(WS, p || '');
  if (!abs.startsWith(WS)) throw new Error('bad path');
  return abs;
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

// ---- Claude 호출: stdin으로 프롬프트, stream-json으로 토큰 단위 수신 ----
function askClaude({ prompt, model }, onDelta) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence'];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { shell: true, env: { ...process.env, CLAUDECODE: '' } });
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
      resolve({ text: text || result?.result || '', cost: result?.total_cost_usd, ms: result?.duration_api_ms, model: result?.modelUsage && Object.keys(result.modelUsage)[0] });
    });
    child.stdin.end(prompt);
  });
}

const PROMPTS = {
  chat: (doc, name, q) => `아래는 사용자가 열어둔 문서 "${name}"의 내용이다. 문서에 근거해 한국어로 간결하게 답하라. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n질문: ${q}`,
  edit: (doc, name, q) => `아래 Markdown 문서 "${name}"를 지시대로 수정하라. 출력은 수정된 문서 전체만, 코드펜스나 설명 없이 그대로 출력할 것. 지시와 무관한 부분은 바꾸지 말 것. 도구는 쓰지 말 것.\n\n<document>\n${doc}\n</document>\n\n지시: ${q}`,
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); }
    if (url.pathname === '/api/files') return json(res, 200, fs.readdirSync(WS).filter((f) => /\.(md|pdf)$/i.test(f)));
    if (url.pathname === '/api/file' && req.method === 'GET') {
      const p = safe(url.searchParams.get('name'));
      res.writeHead(200, { 'Content-Type': p.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8' });
      return fs.createReadStream(p).pipe(res);
    }
    if (url.pathname === '/api/file' && req.method === 'PUT') { fs.writeFileSync(safe(url.searchParams.get('name')), await body(req)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { mode, doc, name, q, model } = JSON.parse(await body(req));
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      try { const r = await askClaude({ prompt: PROMPTS[mode](doc, name, q), model }, (t) => send({ delta: t })); send({ done: r }); }
      catch (e) { send({ error: e.message }); }
      return res.end();
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => console.log(`GenOffice-lite proto → http://localhost:${PORT}`));
