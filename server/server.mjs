/* Local server mode: serves the chatbox and proxies chat turns to Claude, so the
   API key stays on this machine instead of in the browser.

   Run:  npm install && npm start     (needs ANTHROPIC_API_KEY, see .env.example)
   Then: http://localhost:8787
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

import '../src/prompt.js'; // assigns globalThis.TUTOR_SYSTEM_PROMPT

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 8787);
const MODEL = 'claude-opus-5';

// Minimal .env reader — one less dependency for a single-key setup.
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnvFile();

// Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile.
const client = new Anthropic();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);

  // Never serve outside the project directory.
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad JSON"}');
    return;
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }))
    : [];
  if (!messages.length) {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"no messages"}');
    return;
  }

  cors(res);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  const sse = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system: globalThis.TUTOR_SYSTEM_PROMPT({ lang: body.lang, unit: body.unit }),
      messages
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        sse({ text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      sse({ text: '\n\n[The model declined this request.]' });
    }
  } catch (err) {
    console.error('[chat]', err);
    const hint = /api key|authentication|401/i.test(String(err && err.message))
      ? 'No usable credential. Set ANTHROPIC_API_KEY in .env (see .env.example).'
      : String(err && err.message || err);
    sse({ error: hint });
  } finally {
    res.end();
  }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204).end(); return; }
  if (req.method === 'POST' && req.url.startsWith('/api/chat')) { handleChat(req, res); return; }
  if (req.method === 'GET') { serveStatic(req, res); return; }
  res.writeHead(405).end('Method not allowed');
}).listen(PORT, () => {
  console.log(`Chatbox on http://localhost:${PORT}  (model: ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('No ANTHROPIC_API_KEY set — offline tutor mode still works; AI modes will not.');
  }
});
