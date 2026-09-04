const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseClaudeAuth, parseCodexAuth } = require('./ai-providers');

assert.deepStrictEqual(parseCodexAuth('Logged in using ChatGPT'), { loggedIn: true, authMethod: 'ChatGPT' });
assert.deepStrictEqual(parseCodexAuth('Logged in using API key'), { loggedIn: true, authMethod: 'API key' });
assert.deepStrictEqual(parseCodexAuth('Not logged in'), { loggedIn: false, authMethod: null });
assert.deepStrictEqual(parseClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai"}'), { loggedIn: true, authMethod: 'claude.ai' });
assert.deepStrictEqual(parseClaudeAuth('not json'), {});

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
assert.match(providerSource, /Anthropic\.ClaudeCode/, 'Claude installs from the WinGet package');
assert.match(providerSource, /OpenAI\.Codex/, 'Codex installs from the WinGet package');
assert.match(providerSource, /WindowsApps/, 'Claude Desktop app alias is excluded from CLI discovery');
assert.doesNotMatch(providerSource + serverSource, /install\.ps1|ExecutionPolicy\s+Bypass|irm\s+https:/i,
  'setup never pipes a remote PowerShell script into execution');

console.log('OK — AI provider and UI checks passed');
