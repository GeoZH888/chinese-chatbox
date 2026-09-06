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

  /* ---------- progress ---------- */

  async function pull() {
    const t = await token();
    if (!t) return null;
    const rows = await api('/rest/v1/progress?select=item_key,right_count,wrong_count', {
      headers: { authorization: 'Bearer ' + t }
    });
    const out = {};
    (rows || []).forEach(function (r) {
      out[r.item_key] = { right: r.right_count || 0, wrong: r.wrong_count || 0 };
    });
    return out;
  }

  async function push(progress) {
    const t = await token();
    if (!t) return false;
    const rows = Object.keys(progress || {}).map(function (k) {
      return { item_key: k, right_count: progress[k].right || 0, wrong_count: progress[k].wrong || 0 };
    });
    if (!rows.length) return true;
    await api('/rest/v1/progress', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + t, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
    return true;
  }

  // Two devices drilling the same phrase both count: keep the higher tally on
  // each side rather than letting the last writer erase the other's practice.
  function merge(local, remote) {
    const out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = { right: local[k].right, wrong: local[k].wrong }; });
    Object.keys(remote || {}).forEach(function (k) {
      const a = out[k] || { right: 0, wrong: 0 };
      const b = remote[k];
      out[k] = { right: Math.max(a.right, b.right), wrong: Math.max(a.wrong, b.wrong) };
    });
    return out;
  }

  global.SYNC = {
    enabled: enabled,
    consumeRedirect: consumeRedirect,
    token: token,
    whoami: whoami,
    sendLink: sendLink,
    signOut: signOut,
    pull: pull,
    push: push,
    merge: merge,
    email: function () { const s = readSession(); return (s && s.email) || ''; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
