/* Hosted chat endpoint: the same job as server/server.mjs, but on Netlify.

   The key lives in a Netlify environment variable and never reaches the browser.
   Every request must carry a Supabase access token, so a stranger who finds the
   URL cannot spend your Anthropic credit; set ALLOWED_EMAILS to narrow it
   further to a known list of learners.

   Required environment variables:
     ANTHROPIC_API_KEY   your key
     SUPABASE_URL        https://<project>.supabase.co
     SUPABASE_ANON_KEY   the project's anon (publishable) key
   Optional:
     ALLOWED_EMAILS      comma-separated allowlist; unset means any signed-in user
*/
import Anthropic from '@anthropic-ai/sdk';
import '../../src/prompt.js'; // assigns globalThis.TUTOR_SYSTEM_PROMPT

const MODEL = 'claude-opus-5';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, OPTIONS'
};

function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...CORS }
  });
}

// Ask Supabase who this token belongs to. No JWT library needed, and a revoked
// or expired token is rejected by the source of truth rather than by us.
async function identify(req) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: 'Server is missing SUPABASE_URL or SUPABASE_ANON_KEY.' };

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Sign in to use the AI tutor.' };

  let res;
  try {
    res = await fetch(url.replace(/\/+$/, '') + '/auth/v1/user', {
      headers: { apikey: anon, authorization: 'Bearer ' + token }
    });
  } catch (e) {
    return { error: 'Could not reach Supabase to check the session.' };
  }
  if (!res.ok) return { error: 'That session is not valid any more — sign in again.' };

  const user = await res.json();
  const allow = (process.env.ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && allow.indexOf(String(user.email || '').toLowerCase()) < 0) {
    return { error: 'This account is not on the allowlist for the AI tutor.' };
  }
  return { user: user };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Use POST.');
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, 'Server is missing ANTHROPIC_API_KEY.');

  const who = await identify(req);
  if (who.error) return fail(401, who.error);

  let body;
  try { body = await req.json(); } catch (e) { return fail(400, 'Bad JSON.'); }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-30) // a tutoring chat needs recent turns, not the whole history
    : [];
  if (!messages.length) return fail(400, 'No messages.');

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sse = (obj) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n'));
      try {
        const s = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          // A short tutor reply on a serverless timeout: low effort keeps the
          // first token and the whole turn well inside the function's budget.
          output_config: { effort: 'low' },
          system: globalThis.TUTOR_SYSTEM_PROMPT({ lang: body.lang, unit: body.unit }),
          messages
        });
        for await (const event of s) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            sse({ text: event.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === 'refusal') sse({ text: '\n\n[The model declined this request.]' });
      } catch (err) {
        console.error('[chat]', err);
        sse({ error: String((err && err.message) || err) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...CORS }
  });
};

export const config = { path: '/api/chat' };
