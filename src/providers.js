/* Three ways to answer a message:
     offline — the built-in tutor engine, no network at all
     direct  — the browser calls the Claude API itself, with a key the user pasted
     server  — the browser calls the little Node server in server/, which holds the key
   All three expose the same shape: send(history, ctx, onDelta) -> Promise<{text, cards}> */
(function (global) {
  'use strict';

  const MODEL = 'claude-opus-5';
  const API_VERSION = '2023-06-01';

  // Parse a text/event-stream body, handing each `data:` payload to onEvent.
  async function readSSE(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event;
        // Only the parse is forgiving — a keep-alive or a half-written frame is
        // normal. Errors raised by onEvent itself must propagate, or a failure
        // reported by the server would surface as an empty reply.
        try { event = JSON.parse(payload); } catch (e) { continue; }
        onEvent(event);
      }
    }
  }

  // Anthropic stream events -> plain text deltas.
  function anthropicDelta(ev, onDelta) {
    if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      onDelta(ev.delta.text);
    } else if (ev.type === 'error') {
      throw new Error((ev.error && ev.error.message) || 'stream error');
    }
  }

  function toApiMessages(history) {
    return history
      .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
      .map(function (m) { return { role: m.role, content: m.text }; });
  }

  const Providers = {
    /* ---- offline ---- */
    offline: {
      needs: null,
      async send(history, ctx) {
        const last = history[history.length - 1];
        return ctx.engine.respond(last ? last.text : '', ctx.lang);
      }
    },

    /* ---- browser -> api.anthropic.com ---- */
    direct: {
      needs: 'apiKey',
      async send(history, ctx, onDelta) {
        if (!ctx.apiKey) throw new Error('NO_KEY');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': ctx.apiKey,
            'anthropic-version': API_VERSION,
            // Opt-in CORS. Only sound when the key belongs to the person at the keyboard.
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            system: global.TUTOR_SYSTEM_PROMPT({ lang: ctx.lang, unit: ctx.unitTitle }),
            messages: toApiMessages(history),
            stream: true
          })
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error('HTTP ' + res.status + ' — ' + body.slice(0, 300));
        }
        let text = '';
        await readSSE(res, function (ev) {
          anthropicDelta(ev, function (d) { text += d; onDelta(d); });
        });
        return { text: text, cards: [] };
      }
    },

    /* ---- browser -> local node server ---- */
    server: {
      needs: 'serverUrl',
      async send(history, ctx, onDelta) {
        // An empty serverUrl means "same origin" — which is what the Netlify
        // deployment wants, where /api/chat is a function next to the page.
        const base = (ctx.serverUrl || '').replace(/\/+$/, '');
        const headers = { 'content-type': 'application/json' };
        if (ctx.token) headers.authorization = 'Bearer ' + ctx.token;
        let res;
        try {
          res = await fetch(base + '/api/chat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              messages: toApiMessages(history),
              lang: ctx.lang,
              unit: ctx.unitTitle
            })
          });
        } catch (e) {
          throw new Error('NO_SERVER');
        }
        if (res.status === 401) {
          let why = 'NEED_SIGN_IN';
          try { why = (JSON.parse(await res.text()).error) || why; } catch (e) { /* keep default */ }
          throw new Error(why);
        }
        if (!res.ok) {
          const body = await res.text();
          throw new Error('HTTP ' + res.status + ' — ' + body.slice(0, 300));
        }
        let text = '';
        await readSSE(res, function (ev) {
          if (ev.text) { text += ev.text; onDelta(ev.text); }
          if (ev.error) { throw new Error(ev.error); }
        });
        return { text: text, cards: [] };
      }
    }
  };

  global.PROVIDERS = Providers;
  global.PROVIDERS.MODEL = MODEL;
})(typeof window !== 'undefined' ? window : globalThis);
