/* Supabase sign-in and progress sync, over plain fetch.

   No SDK on purpose: the page is a set of classic scripts that must keep working
   from file:// with no network, so a CDN import would be a new failure mode for
   the offline tutor. When CHATBOX_CONFIG is empty, `enabled` is false and every
   call here is a no-op.

   Sign-in is a magic link — the learner types an email, clicks the link, and
   comes back with a session in the URL fragment. No password is ever handled. */
(function (global) {
  'use strict';

  const cfg = global.CHATBOX_CONFIG || {};
  const URL_BASE = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const ANON = String(cfg.SUPABASE_ANON_KEY || '');
  const enabled = !!(URL_BASE && ANON);
  const SESSION_KEY = 'chatbox.session.v1';

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* private mode */ }
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(URL_BASE + path, Object.assign({}, opts, {
      headers: Object.assign({ apikey: ANON, 'content-type': 'application/json' }, opts.headers || {})
    }));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  /* ---------- session ---------- */

  // The magic link lands back here as #access_token=…&refresh_token=…
  function consumeRedirect() {
    const hash = global.location && global.location.hash;
    if (!hash || hash.indexOf('access_token=') < 0) return false;
    const p = new URLSearchParams(hash.slice(1));
    const session = {
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_at: Date.now() + (Number(p.get('expires_in') || 3600) * 1000),
      email: ''
    };
    writeSession(session);
    // Do not leave tokens sitting in the address bar or the history entry.
    try {
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
    } catch (e) { global.location.hash = ''; }
    return true;
  }

  async function refresh(session) {
    const data = await api('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const next = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
      email: (data.user && data.user.email) || session.email || ''
    };
    writeSession(next);
    return next;
  }

  // A valid access token, refreshed when it is within a minute of expiry.
  async function token() {
    if (!enabled) return null;
    let s = readSession();
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at - Date.now() < 60000 && s.refresh_token) {
      try { s = await refresh(s); }
      catch (e) { writeSession(null); return null; }
    }
    return s.access_token;
  }

  async function whoami() {
    const t = await token();
    if (!t) return null;
    try {
      const user = await api('/auth/v1/user', { headers: { authorization: 'Bearer ' + t } });
      const s = readSession();
      if (s && user && user.email && s.email !== user.email) {
        s.email = user.email;
        writeSession(s);
      }
      return user;
    } catch (e) {
      writeSession(null);
      return null;
    }
  }

  // Email + password. Many accounts on this project are credential logins whose
  // address is an identifier rather than a mailbox, so a magic link can never
  // reach them; this is the path those accounts use.
  //
  // The password is passed straight to Supabase and never stored — only the
  // tokens it returns are kept, exactly as with the magic link.
  async function signInWithPassword(email, password) {
    if (!enabled) throw new Error('sync-disabled');
    const data = await api('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password })
    });
    writeSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
      email: (data.user && data.user.email) || email
    });
    return data.user || null;
  }

  async function sendLink(email) {
    if (!enabled) throw new Error('sync-disabled');
    const redirect = global.location.origin + global.location.pathname;
    await api('/auth/v1/otp', {
      method: 'POST',
      body: JSON.stringify({ email: email, create_user: true, options: { email_redirect_to: redirect } })
    });
  }

  function signOut() {
    const s = readSession();
    if (enabled && s && s.access_token) {
      // Best effort; the local session is dropped either way.
      api('/auth/v1/logout', { method: 'POST', headers: { authorization: 'Bearer ' + s.access_token } })
        .catch(function () { /* already gone */ });
    }
    writeSession(null);
  }

  /* ---------- the shared learner platform ---------- */

  // Every app on the platform records answers the same way: one RPC that
  // resolves the item, logs the event and advances the schedule. The maths
  // lives in Postgres (see supabase/schema.sql), so no app can drift from it.
  const APP_NAME = 'chinese-chatbox';

  async function rpc(fn, body) {
    const t = await token();
    if (!t) return null;
    return api('/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + t },
      body: JSON.stringify(body || {})
    });
  }

  // verdict: 'right' | 'partial' | 'tones' | 'wrong' | 'skip' | 'seen'
  async function recordAttempt(item, verdict, mode) {
    if (!enabled) return null;
    return rpc('chatbox_record_attempt', {
      p_lang: item.lang || 'zh',
      p_kind: item.kind || 'phrase',
      p_content: item.zh,
      p_verdict: verdict,
      p_app: APP_NAME,
      p_mode: mode || null,
      p_reading: item.py || null,
      p_glosses: { en: item.en, it: item.it }
    });
  }

  // Everything this learner has practised in Chinese, in any app on the
  // platform — keyed the same way the offline tutor keys its local progress.
  async function pull(lang) {
    const rows = await rpc('chatbox_snapshot', { p_lang: lang || 'zh' });
    if (!rows) return null;
    const out = {};
    rows.forEach(function (r) {
      const key = global.IDENTITY.key(lang || 'zh', 'phrase', r.content);
      out[key] = { right: r.right_count || 0, wrong: r.wrong_count || 0, due: r.due_at || null };
    });
    return out;
  }

  // What the platform thinks is due now, across every app.
  async function due(lang, limit) {
    const rows = await rpc('chatbox_due_items', { p_lang: lang || 'zh', p_limit: limit || 20 });
    return rows || [];
  }

  // Local practice done while signed out still counts: keep the higher tally on
  // each side rather than letting one device erase the other's work.
  function merge(local, remote) {
    const out = {};
    Object.keys(local || {}).forEach(function (k) {
      out[k] = { right: local[k].right, wrong: local[k].wrong };
    });
    Object.keys(remote || {}).forEach(function (k) {
      const a = out[k] || { right: 0, wrong: 0 };
      const b = remote[k];
      out[k] = { right: Math.max(a.right, b.right), wrong: Math.max(a.wrong, b.wrong), due: b.due };
    });
    return out;
  }

  global.SYNC = {
    enabled: enabled,
    app: APP_NAME,
    consumeRedirect: consumeRedirect,
    token: token,
    whoami: whoami,
    signInWithPassword: signInWithPassword,
    sendLink: sendLink,
    signOut: signOut,
    recordAttempt: recordAttempt,
    pull: pull,
    due: due,
    merge: merge,
    email: function () { const s = readSession(); return (s && s.email) || ''; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
