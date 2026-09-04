// 사용자의 Claude Code / Codex(ChatGPT) 로그인을 그대로 쓰는 AI 공급자 어댑터.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');

const ENV = { ...process.env, CLAUDECODE: '' };
const CODEX_CWD = path.join(os.tmpdir(), 'editor-kim-codex');
fs.mkdirSync(CODEX_CWD, { recursive: true });

const commandOpts = (file) => ({ env: ENV, windowsHide: true, shell: /\.cmd$/i.test(file || '') });

function execText(file, args) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    execFile(file, args, { ...commandOpts(file), timeout: 10000 }, (error, stdout, stderr) => resolve({
      ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(),
    }));
  });
}

function execChecked(file, args, timeout = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...commandOpts(file), timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (error) return reject(new Error(output || error.message));
      resolve(output);
    });
  });
}

function whereAll(name) {
  return new Promise((resolve) => execFile(process.platform === 'win32' ? 'where' : 'which', [name], { windowsHide: true }, (error, stdout) => {
    resolve(error ? [] : String(stdout).split(/\r?\n/).filter(Boolean));
  }));
}

async function where(name) {
  const lines = await whereAll(name);
  return lines.find((line) => /\.exe$/i.test(line)) || lines[0] || null;
}

function bundledCodex() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const bin = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  try {
    return fs.readdirSync(bin, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => path.join(bin, entry.name, 'codex.exe')).filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
  } catch { return null; }
}

function parseClaudeAuth(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function parseCodexAuth(raw) {
  const text = String(raw || '');
  if (!/logged in using/i.test(text)) return { loggedIn: false, authMethod: null };
  const method = /chatgpt/i.test(text) ? 'ChatGPT' : /api key/i.test(text) ? 'API key' : text.replace(/^.*logged in using\s*/i, '').trim();
  return { loggedIn: true, authMethod: method || 'Codex' };
}

class CodexAppServer extends EventEmitter {
  constructor(getExecutable, version) {
    super();
    this.getExecutable = getExecutable;
    this.version = version;
    this.proc = null;
    this.starting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.generation = 0;
  }

  async start() {
    if (this.proc) return;
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start() {
    const executable = await this.getExecutable();
    if (!executable) throw new Error('Codex가 설치되어 있지 않습니다');
    const proc = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      ...commandOpts(executable), cwd: CODEX_CWD, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.generation += 1;
    let stderr = '';
    proc.stderr.on('data', (data) => { stderr = (stderr + data).slice(-8000); });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method) this.emit('message', message);
    });
    proc.on('exit', (code) => {
      const error = new Error(stderr.trim() || `Codex App Server가 종료되었습니다 (${code})`);
      if (this.proc === proc) this.proc = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear(); this.emit('stopped', error);
    });
    proc.on('error', (error) => this.emit('stopped', error));
    await this._request('initialize', { clientInfo: { name: 'editor_kim', title: 'EDITOR_KIM', version: this.version } });
    this.notify('initialized', {});
  }

  _request(method, params = {}, timeoutMs = 15000) {
    if (!this.proc) return Promise.reject(new Error('Codex App Server가 실행 중이 아닙니다'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 응답 시간이 초과되었습니다`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  async request(method, params = {}, timeoutMs) { await this.start(); return this._request(method, params, timeoutMs); }
  notify(method, params = {}) { if (this.proc) this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  sessionValid(session) { return !!(this.proc && session?.threadId && session.generation === this.generation); }
  close() { if (this.proc) { this.proc.kill(); this.proc = null; } }

  async models() {
    const result = await this.request('model/list', { limit: 100, includeHidden: false });
    return (result.data || []).map((item) => ({
      id: item.model || item.id, name: item.displayName || item.model || item.id,
      isDefault: !!item.isDefault, defaultReasoningEffort: item.defaultReasoningEffort || null,
    }));
  }

  async ask({ prompt, model, session }, onDelta) {
    await this.start();
    let threadId = this.sessionValid(session) ? session.threadId : null;
    if (!threadId) {
      const started = await this.request('thread/start', {
        model: model || null, cwd: CODEX_CWD, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
        serviceName: 'editor_kim',
        developerInstructions: 'You are the document assistant inside EDITOR_KIM. Answer directly. Never call tools, run commands, browse, inspect files, or modify files. Use only the document text in the user message. For editing requests, return only the requested replacement text with no explanation or code fence.',
      });
      threadId = started.thread.id;
    }

    const startedAt = Date.now();
    const earlyMessages = [];
    const bufferEarly = (message) => earlyMessages.push(message);
    this.on('message', bufferEarly);
    let turn;
    try { turn = await this.request('turn/start', {
      threadId, input: [{ type: 'text', text: prompt }], model: model || null, cwd: CODEX_CWD,
      approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
    }); } catch (error) { this.off('message', bufferEarly); throw error; }
    const turnId = turn.turn.id;
    const agentItems = new Map();
    let streamed = '', finalText = '', lastAgentText = '';

    return new Promise((resolve, reject) => {
      const cleanup = () => { this.off('message', handle); this.off('stopped', stopped); };
      const stopped = (error) => { cleanup(); reject(error); };
      const handle = (message) => {
        const params = message.params || {};
        if (params.threadId && params.threadId !== threadId) return;
        if (params.turnId && params.turnId !== turnId) return;
        if (message.method === 'item/started' && params.item?.type === 'agentMessage') {
          agentItems.set(params.item.id, params.item.phase || 'final_answer');
        } else if (message.method === 'item/agentMessage/delta') {
          const phase = agentItems.get(params.itemId);
          if (!phase || phase === 'final_answer') { streamed += params.delta; onDelta(params.delta); }
        } else if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
          lastAgentText = params.item.text || lastAgentText;
          if (!params.item.phase || params.item.phase === 'final_answer') finalText = params.item.text || finalText;
        } else if (message.method === 'error' && params.error) {
          cleanup(); reject(new Error(params.error.message || 'Codex 호출 오류'));
        } else if (message.method === 'turn/completed') {
          cleanup();
          if (params.turn?.status !== 'completed') return reject(new Error(params.turn?.error?.message || `Codex turn ${params.turn?.status || 'failed'}`));
          resolve({ text: finalText || lastAgentText || streamed, ms: Date.now() - startedAt,
            session: { threadId, generation: this.generation }, model, billing: 'ChatGPT 구독' });
        }
      };
      this.off('message', bufferEarly); this.on('message', handle); this.on('stopped', stopped);
      for (const message of earlyMessages) handle(message);
    });
  }
}

function createProviders({ version }) {
  let claude = null, codex = null;
  const existing = (files) => files.filter(Boolean).find((file) => fs.existsSync(file)) || null;
  const findClaude = async () => {
    if (claude) return claude;
    const preferred = process.platform === 'win32' ? [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.local', 'bin', 'claude.exe'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'claude.cmd'),
    ] : [];
    const discovered = (await whereAll('claude')).filter((file) => !/[\\/]Microsoft[\\/]WindowsApps[\\/]Claude\.exe$/i.test(file));
    return (claude = existing([...preferred, ...discovered]));
  };
  const findCodex = async () => {
    if (codex) return codex;
    const preferred = process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'codex.exe') : null;
    return (codex = existing([preferred, await where('codex'), bundledCodex()]));
  };
  const codexServer = new CodexAppServer(findCodex, version);

  async function install(provider) {
    const existing = provider === 'claude' ? await findClaude() : await findCodex();
    if (existing) return { ok: true, alreadyInstalled: true };
    const winget = await where('winget');
    if (!winget) throw new Error('Windows 앱 설치 관리자(WinGet)가 없습니다. Microsoft Store에서 앱 설치 관리자를 업데이트해 주세요.');
    const packageId = provider === 'claude' ? 'Anthropic.ClaudeCode' : 'OpenAI.Codex';
    const output = await execChecked(winget, [
      'install', '--id', packageId, '--exact', '--source', 'winget', '--scope', 'user', '--silent',
      '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements',
    ]);
    if (provider === 'claude') claude = null;
    else { codex = null; codexServer.close(); }
    const executable = provider === 'claude' ? await findClaude() : await findCodex();
    if (!executable) throw new Error('설치는 완료됐지만 실행 파일을 찾지 못했습니다. 앱을 다시 시작해 주세요.');
    return { ok: true, output };
  }

  async function login(provider) {
    const executable = provider === 'claude' ? await findClaude() : await findCodex();
    if (!executable) throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'}가 설치되어 있지 않습니다`);
    const args = provider === 'claude' ? ['auth', 'login'] : ['login'];
    const child = spawn(executable, args, { ...commandOpts(executable), detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true };
  }

  async function claudeHealth() {
    const executable = await findClaude();
    const current = await execText(executable, ['--version']);
    if (!current?.ok) return { installed: false, loggedIn: false, models: [] };
    const status = await execText(executable, ['auth', 'status']);
    const auth = parseClaudeAuth(status?.stdout);
    return { installed: true, version: current.stdout, loggedIn: !!auth.loggedIn, authMethod: auth.authMethod || null,
      models: [{ id: 'sonnet', name: 'Sonnet 5', isDefault: true }, { id: 'opus', name: 'Opus 5', isDefault: false }] };
  }

  async function codexHealth() {
    const executable = await findCodex();
    const current = await execText(executable, ['--version']);
    if (!current?.ok) return { installed: false, loggedIn: false, models: [] };
    const status = await execText(executable, ['login', 'status']);
    const auth = parseCodexAuth([status?.stdout, status?.stderr].filter(Boolean).join('\n'));
    let models = [];
    if (auth.loggedIn) { try { models = await codexServer.models(); } catch {} }
    return { installed: true, version: current.stdout, ...auth, models };
  }

  async function askClaude({ prompt, model, session }, onDelta) {
    const executable = await findClaude();
    if (!executable) throw new Error('Claude Code가 설치되어 있지 않습니다');
    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', model || 'sonnet'];
      if (session) args.push('--resume', session);
      const child = spawn(executable, args, { ...commandOpts(executable), stdio: ['pipe', 'pipe', 'pipe'] });
      let buf = '', text = '', result = null, error = '';
      child.stdout.on('data', (data) => {
        buf += data; const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let event; try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') { text += event.event.delta.text; onDelta(event.event.delta.text); }
          else if (event.type === 'result') result = event;
        }
      });
      child.stderr.on('data', (data) => { error += data; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0 && !result) return reject(new Error(error || `claude exit ${code}`));
        resolve({ text: text || result?.result || '', cost: result?.total_cost_usd, ms: result?.duration_api_ms,
          session: result?.session_id, model: result?.modelUsage && Object.keys(result.modelUsage)[0], billing: 'Claude 구독' });
      });
      child.stdin.end(prompt);
    });
  }

  return {
    health: async () => { const [claudeState, codexState] = await Promise.all([claudeHealth(), codexHealth()]); return { claude: claudeState, codex: codexState }; },
    ask: (provider, options, onDelta) => provider === 'codex' ? codexServer.ask(options, onDelta) : askClaude(options, onDelta),
    sessionValid: (provider, session) => provider !== 'codex' || codexServer.sessionValid(session),
    executable: (provider) => provider === 'codex' ? findCodex() : findClaude(),
    install,
    login,
    close: () => codexServer.close(),
  };
}

module.exports = { createProviders, parseClaudeAuth, parseCodexAuth };
