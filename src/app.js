/* UI wiring: state, rendering, the voice loop, and the send loop.
   Voice is the primary way in and out; typing is always available behind ⌨. */
(function (global) {
  'use strict';

  const $ = function (sel) { return document.querySelector(sel); };
  const SETTINGS_KEY = 'chatbox.settings.v1';

  const state = Object.assign({
    lang: 'en',          // interface + support language
    voiceLang: 'zh',     // what the learner speaks into the microphone
    mode: 'offline',
    showAll: false,
    handsFree: false,
    autoSpeak: true,
    apiKey: '',
    // Served over http(s): /api/chat sits next to the page (Netlify function or
    // the local node server). Opened from disk: point at the local server.
    serverUrl: global.location && global.location.protocol === 'file:' ? 'http://localhost:8787' : ''
  }, loadSettings());

  const engine = new global.TUTOR.Engine(global.CURRICULUM);
  const listener = new global.VOICE.Listener();
  const history = [];
  let busy = false;
  let listening = false;

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        lang: state.lang, voiceLang: state.voiceLang, mode: state.mode,
        showAll: state.showAll, handsFree: state.handsFree, autoSpeak: state.autoSpeak,
        apiKey: state.apiKey, serverUrl: state.serverUrl
      }));
    } catch (e) { /* private mode: settings just do not persist */ }
  }

  function t() { return global.I18N.get(state.lang); }

  // "Speak Chinese" / "Parla in inglese" — the mic says which language it expects.
  function micLabel() {
    const s = t();
    return s.speakBtn({ name: s.voiceNames[state.voiceLang] });
  }

  /* ---------- rendering helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const HAN = /[一-鿿㐀-䶿]/;
  const HAN_RUN = /([一-鿿㐀-䶿　-〿！-～]+)/g;

  // Colour each pinyin syllable by its tone.
  function pinyinHTML(py) {
    return global.TUTOR.pinyinParts(py).map(function (part) {
      if (!/[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]/.test(part)) return esc(part);
      return '<span class="t' + global.TUTOR.toneOf(part) + '">' + esc(part) + '</span>';
    }).join('');
  }

  // Plain text -> HTML: keep line breaks, honour **bold**, make Chinese tappable.
  function textHTML(s) {
    let out = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(HAN_RUN,
      '<span class="zh-run" role="button" tabindex="0" title="' + esc(t().speak) + '">$1</span>');
    return out.replace(/\n/g, '<br>');
  }

  function cardHTML(item) {
    const other = state.lang === 'it' ? 'en' : 'it';
    const note = item.note && item.note[state.lang];
    const gloss = state.lang === 'zh' ? item.en : item[state.lang];
    let html = '<div class="card">' +
      '<div class="card-zh"><span class="zh-run" role="button" tabindex="0">' + esc(item.zh) + '</span>' +
      '<button class="speak" data-say="' + esc(item.zh) + '" title="' + esc(t().speak) + '">🔊</button></div>' +
      '<div class="card-py">' + pinyinHTML(item.py) + '</div>' +
      '<div class="card-gloss">' + esc(gloss) + '</div>';
    if (state.showAll || state.lang === 'zh') {
      html += '<div class="card-gloss alt">' +
        (state.lang === 'zh' ? esc(item.it) : esc(item[other])) + '</div>';
    }
    if (note) html += '<div class="card-note">' + esc(note) + '</div>';
    const unit = state.lang === 'zh'
      ? item.unitTitle.zh
      : item.unitTitle.zh + ' · ' + item.unitTitle[state.lang];
    html += '<div class="card-unit">' + esc(unit) + '</div>';
    return html + '</div>';
  }

  function addMessage(role, opts) {
    const list = $('#messages');
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.innerHTML =
      '<div class="who">' + esc(role === 'user' ? t().you : t().tutorName) + '</div>' +
      '<div class="bubble"><div class="body"></div><div class="cards"></div><div class="footer"></div></div>';
    list.appendChild(el);
    const api = {
      el: el,
      setText: function (s) { el.querySelector('.body').innerHTML = textHTML(s); scroll(); },
      setCards: function (items) {
        el.querySelector('.cards').innerHTML = (items || []).map(cardHTML).join('');
        scroll();
      },
      setFooter: function (s) {
        el.querySelector('.footer').innerHTML = s ? textHTML(s) : '';
        scroll();
      },
      setPending: function (on) { el.classList.toggle('pending', !!on); }
    };
    if (opts && opts.text != null) api.setText(opts.text);
    if (opts && opts.cards) api.setCards(opts.cards);
    if (opts && opts.footer) api.setFooter(opts.footer);
    scroll();
    return api;
  }

  function scroll() {
    const list = $('#messages');
    list.scrollTop = list.scrollHeight;
  }

  // One answer, one call: the platform logs the event and works out when this
  // item is next due. Failures are silent on purpose — a dropped connection
  // must never interrupt a drill, and local progress is already saved.
  function reportAttempt(mode) {
    const attempt = engine.takeAttempt();
    if (!attempt || !global.SYNC.enabled) return;
    global.SYNC.recordAttempt(attempt.item, attempt.verdict, mode)
      .catch(function () { /* offline, or signed out */ });
  }

  function updateProgress() {
    const keys = Object.keys(engine.progress);
    const known = keys.filter(function (k) { return engine.progress[k].right >= 2; }).length;
    const total = global.CURRICULUM.all.length;
    $('#progress').textContent = t().progress + ' ' + known + '/' + total;
    $('#progress-bar').style.width = Math.round((known / total) * 100) + '%';
  }

  /* ---------- speaking a reply ---------- */

  // Parenthesised pinyin is for the eye, not the ear.
  function stripPinyinAsides(s) {
    return String(s).replace(/[（(][^）)]*[）)]/g, function (m) {
      return HAN.test(m) ? m : '';
    });
  }

  // A reply can mix Chinese and the support language; each run gets its own voice.
  async function speakReply(text, cards) {
    if (!state.autoSpeak) return;
    const spoken = stripPinyinAsides(text);
    const runs = spoken.split(HAN_RUN).filter(function (x) { return x && x.trim(); });
    for (const run of runs) {
      await global.VOICE.speak(run, HAN.test(run) ? 'zh' : state.lang);
    }
    for (const item of (cards || []).slice(0, 1)) {
      await global.VOICE.speak(item.zh, 'zh');
    }
  }

  /* ---------- listening ---------- */

  function setListening(on) {
    listening = on;
    $('#mic').classList.toggle('on', on);
    $('#mic-label').textContent = on ? t().tapToStop : micLabel();
    $('#voice-status').textContent = on ? t().listening : '';
    if (!on) {
      const box = $('#transcript');
      box.hidden = true;
      box.textContent = '';
    }
  }

  function startListening() {
    if (busy || listening) return;
    global.VOICE.shutUp();
    if (!global.VOICE.supported) {
      $('#voice-status').textContent = t().voiceUnsupported;
      showKeyboard(true);
      return;
    }
    listener.start(state.voiceLang, {
      onStart: function () { setListening(true); },
      onPartial: function (partial) {
        const box = $('#transcript');
        box.hidden = false;
        box.textContent = partial;
      },
      onEnd: function (final) {
        setListening(false);
        if (final) send(final, 'voice');
        else $('#voice-status').textContent = t().micNothing;
      },
      onError: function (kind) {
        setListening(false);
        $('#voice-status').textContent =
          kind === 'not-allowed' || kind === 'service-not-allowed' ? t().micDenied
            : kind === 'unsupported' ? t().voiceUnsupported
              : kind === 'no-speech' ? t().micNothing
                : t().errPrefix + ': ' + kind;
        if (kind === 'unsupported') showKeyboard(true);
      }
    });
  }

  function stopListening() {
    listener.stop();
    setListening(false);
  }

  /* ---------- the send loop ---------- */

  // Slash commands and open drills are always answered by the local engine, in
  // every mode — so practice keeps working with or without a network.
  function isLocal(text) {
    return text.trim()[0] === '/' || !!engine.current;
  }

  async function send(text, mode) {
    if (busy || !text.trim()) return;
    busy = true;
    stopListening();
    global.VOICE.shutUp();
    $('#send').disabled = true;
    $('#mic').disabled = true;

    addMessage('user', { text: text });
    history.push({ role: 'user', text: text });

    const out = addMessage('tutor');
    let reply = '';
    let cards = [];
    try {
      if (state.mode === 'offline' || isLocal(text)) {
        const r = engine.respond(text, state.lang);
        reply = r.text;
        cards = r.cards || [];
        out.setText(r.text);
        out.setCards(cards);
        out.setFooter(r.footer);
        history.push({ role: 'assistant', text: r.text });
        updateProgress();
        reportAttempt(mode);
      } else {
        out.setText(t().thinking);
        out.setPending(true);
        let acc = '';
        const provider = global.PROVIDERS[state.mode];
        const ctx = {
          lang: state.lang,
          engine: engine,
          apiKey: state.apiKey,
          serverUrl: state.serverUrl,
          token: state.mode === 'server' ? await global.SYNC.token() : null,
          unitTitle: engine.unitId ? global.CURRICULUM.unit(engine.unitId).title.en : null
        };
        const r = await provider.send(history, ctx, function (delta) {
          acc += delta;
          out.setText(acc);
        });
        out.setPending(false);
        reply = r.text || acc;
        out.setText(reply);
        history.push({ role: 'assistant', text: reply });
      }
    } catch (err) {
      out.setPending(false);
      const msg = String(err && err.message || err);
      reply = msg === 'NO_KEY' ? t().needKey
        : msg === 'NO_SERVER' ? t().needServer
          : msg === 'NEED_SIGN_IN' ? t().needSignIn
            : t().errPrefix + ': ' + msg;
      out.setText(reply);
      history.pop(); // drop the user turn that never got an answer
    } finally {
      busy = false;
      $('#send').disabled = false;
      $('#mic').disabled = false;
    }

    await speakReply(reply, cards);
    // Hands-free: as soon as the tutor stops talking, the microphone opens again.
    if (state.handsFree && !busy && !listening) startListening();
  }

  /* ---------- chrome ---------- */

  function modeName() {
    const s = t();
    return { offline: s.modeOffline, direct: s.modeDirect, server: s.modeServer }[state.mode];
  }

  function applyLang() {
    const s = t();
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : (state.lang === 'it' ? 'it' : 'en-GB');
    $('#title').textContent = s.title;
    $('#mode-chip').textContent = modeName();
    $('#input').placeholder = s.placeholder;
    $('#send').textContent = s.send;
    $('#mode-label').textContent = s.modeLabel;
    $('#mode option[value=offline]').textContent = s.modeOffline;
    $('#mode option[value=direct]').textContent = s.modeDirect;
    $('#mode option[value=server]').textContent = s.modeServer;
    $('#settings-btn').title = s.settings;
    $('#settings-title').textContent = s.settings;
    $('#key-label').textContent = s.apiKeyLabel;
    $('#key-warn').textContent = s.apiKeyWarn;
    $('#server-label').textContent = s.serverUrlLabel;
    $('#showall-label').textContent = s.showAll;
    $('#account-title').textContent = s.account;
    $('#email-label').textContent = s.emailLabel;
    $('#send-link').textContent = s.sendLink;
    $('#password-label').textContent = s.passwordLabel;
    $('#sign-in').textContent = s.signIn;
    $('#password-hint').textContent = s.passwordHint;
    $('#sign-out').textContent = s.signOut;
    $('#settings-close').textContent = s.close;
    $('#chip-lessons').textContent = s.chipLessons;
    $('#chip-drill').textContent = s.chipDrill;
    $('#chip-review').textContent = s.chipReview;
    $('#chip-help').textContent = s.chipHelp;
    $('#voice-lang-label').textContent = s.voiceLangLabel;
    $('#handsfree-label').textContent = s.handsFree;
    $('#autospeak-label').textContent = s.autoSpeak;
    $('#kbd').title = s.typeInstead;
    $('#mic-label').textContent = listening ? s.tapToStop : micLabel();
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lang === state.lang);
    });
    document.querySelectorAll('.vl').forEach(function (b) {
      b.classList.toggle('on', b.dataset.vlang === state.voiceLang);
    });
    updateProgress();
  }

  function showKeyboard(on) {
    $('#form').hidden = !on;
    $('#kbd').classList.toggle('on', on);
    if (on) $('#input').focus();
  }

  function openSettings() {
    const dlg = $('#settings');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /* ---------- account & sync ---------- */

  function renderAccount(email) {
    $('#account-out').hidden = !!email;
    $('#account-in').hidden = !email;
    if (email) $('#signed-in').textContent = t().signedInAs({ email: email });
    if (!global.SYNC.enabled) {
      $('#account-out').hidden = true;
      $('#account-in').hidden = true;
      $('#account-status').textContent = t().syncDisabled;
    }
  }

  // Pull what other devices recorded, merge it with what is here, and write the
  // union back — so signing in on a second device adds to progress, never resets it.
  async function syncProgress() {
    if (!global.SYNC.enabled) return;
    try {
      const remote = await global.SYNC.pull('zh');
      if (!remote) return;
      engine.progress = global.SYNC.merge(engine.progress, remote);
      engine.saveProgress();
      updateProgress();
      $('#account-status').textContent = t().syncOk;
    } catch (e) {
      $('#account-status').textContent = t().syncFail + e.message;
    }
  }

  async function bootstrapAccount() {
    if (!global.SYNC.enabled) { renderAccount(''); return; }
    const arrived = global.SYNC.consumeRedirect();
    const user = await global.SYNC.whoami();
    renderAccount((user && user.email) || '');
    if (user) await syncProgress();
    if (arrived && !user) $('#account-status').textContent = t().syncFail + 'session';
  }

  function init() {
    $('#mode').value = state.mode;
    $('#api-key').value = state.apiKey;
    $('#server-url').value = state.serverUrl;
    $('#showall').checked = state.showAll;
    $('#handsfree').checked = state.handsFree;
    $('#autospeak').checked = state.autoSpeak;
    applyLang();

    if (!global.VOICE.supported) {
      $('#voice-status').textContent = t().voiceUnsupported;
      showKeyboard(true);
    }

    addMessage('tutor', { text: t().tutor.welcome });

    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.lang = b.dataset.lang;
        saveSettings();
        applyLang();
      });
    });

    document.querySelectorAll('.vl').forEach(function (b) {
      b.addEventListener('click', function () {
        state.voiceLang = b.dataset.vlang;
        saveSettings();
        applyLang();
        if (listening) { stopListening(); startListening(); }
      });
    });

    $('#mic').addEventListener('click', function () {
      if (listening) stopListening(); else startListening();
    });

    $('#kbd').addEventListener('click', function () { showKeyboard($('#form').hidden); });

    $('#handsfree').addEventListener('change', function () {
      state.handsFree = $('#handsfree').checked;
      saveSettings();
      if (state.handsFree && !listening && !busy) startListening();
    });

    $('#autospeak').addEventListener('change', function () {
      state.autoSpeak = $('#autospeak').checked;
      if (!state.autoSpeak) global.VOICE.shutUp();
      saveSettings();
    });

    $('#form').addEventListener('submit', function (e) {
      e.preventDefault();
      const v = $('#input').value;
      $('#input').value = '';
      send(v, 'typed');
    });

    $('#input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#form').dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });

    [['#chip-lessons', '/units'], ['#chip-drill', '/drill'],
     ['#chip-review', '/review'], ['#chip-help', '/help']].forEach(function (pair) {
      $(pair[0]).addEventListener('click', function () { send(pair[1]); });
    });

    // Tap any Chinese text to hear it.
    $('#messages').addEventListener('click', function (e) {
      const btn = e.target.closest('.speak');
      if (btn) { global.VOICE.speak(btn.dataset.say, 'zh'); return; }
      const run = e.target.closest('.zh-run');
      if (run) global.VOICE.speak(run.textContent, 'zh');
    });

    $('#sign-in').addEventListener('click', async function () {
      const email = $('#email').value.trim();
      const password = $('#password').value;
      if (!email || !password) return;
      $('#sign-in').disabled = true;
      try {
        const user = await global.SYNC.signInWithPassword(email, password);
        // Never keep the password around once it has been exchanged for tokens.
        $('#password').value = '';
        renderAccount((user && user.email) || email);
        $('#account-status').textContent = '';
        await syncProgress();
      } catch (e) {
        $('#account-status').textContent = t().signInFail + e.message;
      } finally {
        $('#sign-in').disabled = false;
      }
    });

    ['#email', '#password'].forEach(function (sel) {
      $(sel).addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); $('#sign-in').click(); }
      });
    });

    $('#send-link').addEventListener('click', async function () {
      const email = $('#email').value.trim();
      if (!email) return;
      $('#send-link').disabled = true;
      try {
        await global.SYNC.sendLink(email);
        $('#account-status').textContent = t().linkSent;
      } catch (e) {
        // A rejected address is a sign-in problem, not a sync problem.
        $('#account-status').textContent = t().signInFail + e.message;
      } finally {
        $('#send-link').disabled = false;
      }
    });

    $('#sign-out').addEventListener('click', function () {
      global.SYNC.signOut();
      renderAccount('');
      $('#account-status').textContent = '';
    });

    bootstrapAccount();

    $('#mode-chip').addEventListener('click', openSettings);
    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-close').addEventListener('click', function () { $('#settings').close(); });
    $('#settings').addEventListener('close', function () {
      $('#password').value = '';
      state.mode = $('#mode').value;
      state.apiKey = $('#api-key').value.trim();
      state.serverUrl = $('#server-url').value.trim() || 'http://localhost:8787';
      state.showAll = $('#showall').checked;
      saveSettings();
      applyLang();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
