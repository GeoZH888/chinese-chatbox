/* Voice in and voice out.

   In:  Web Speech recognition (Chrome/Edge/Safari). The learner picks which
        language they are speaking — Chinese by default, since speaking Chinese
        is the point; English or Italian when they want to ask a question.
   Out: speech synthesis, Chinese read at learner pace.

   Everything degrades quietly: if the browser has no recogniser, the caller
   gets `supported === false` and the app stays fully usable by typing. */
(function (global) {
  'use strict';

  const SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  const BCP47 = { zh: 'zh-CN', en: 'en-GB', it: 'it-IT' };

  /* ---------- speaking ---------- */

  let voices = [];
  function refreshVoices() {
    voices = (global.speechSynthesis && global.speechSynthesis.getVoices()) || [];
  }
  if (global.speechSynthesis) {
    refreshVoices();
    global.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }

  function voiceFor(tag) {
    const prefix = tag.split('-')[0].toLowerCase();
    return voices.filter(function (v) { return v.lang.toLowerCase() === tag.toLowerCase(); })[0]
      || voices.filter(function (v) { return v.lang.toLowerCase().indexOf(prefix) === 0; })[0]
      || null;
  }

  // Resolves when the utterance finishes (or immediately if speech is unavailable),
  // which is what lets the hands-free loop wait before it opens the microphone.
  function speak(text, lang) {
    return new Promise(function (resolve) {
      if (!global.speechSynthesis || !text || !text.trim()) { resolve(); return; }
      // No installed voices (some headless or stripped-down browsers): saying
      // nothing is fine, but the hands-free loop must not wait on it.
      if (!voices.length) { refreshVoices(); }
      if (!voices.length) { resolve(); return; }
      const tag = BCP47[lang] || lang || 'zh-CN';
      global.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = tag;
      const v = voiceFor(tag);
      if (v) u.voice = v;
      u.rate = tag.indexOf('zh') === 0 ? 0.85 : 1;
      u.onend = function () { resolve(); };
      u.onerror = function () { resolve(); };
      global.speechSynthesis.speak(u);
      // Some browsers never fire onend on a cancelled queue; do not hang the loop.
      setTimeout(resolve, Math.min(15000, 900 + text.length * 130));
    });
  }

  function shutUp() {
    if (global.speechSynthesis) global.speechSynthesis.cancel();
  }

  /* ---------- listening ---------- */

  function Listener() {
    this.rec = null;
    this.active = false;
  }

  Listener.prototype.start = function (lang, handlers) {
    if (!SR) { handlers.onError && handlers.onError('unsupported'); return; }
    this.stop();

    const rec = new SR();
    rec.lang = BCP47[lang] || lang || 'zh-CN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = '';
    const self = this;

    rec.onresult = function (e) {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      handlers.onPartial && handlers.onPartial(finalText + interim);
    };
    rec.onerror = function (e) {
      self.active = false;
      handlers.onError && handlers.onError(e.error || 'error');
    };
    rec.onend = function () {
      self.active = false;
      handlers.onEnd && handlers.onEnd(finalText.trim());
    };

    this.rec = rec;
    this.active = true;
    try {
      rec.start();
      handlers.onStart && handlers.onStart();
    } catch (err) {
      this.active = false;
      handlers.onError && handlers.onError('start-failed');
    }
  };

  Listener.prototype.stop = function () {
    if (this.rec) {
      try { this.rec.stop(); } catch (e) { /* already stopped */ }
      this.rec = null;
    }
    this.active = false;
  };

  global.VOICE = {
    supported: !!SR,
    canSpeak: !!global.speechSynthesis,
    Listener: Listener,
    speak: speak,
    shutUp: shutUp,
    tagFor: function (lang) { return BCP47[lang] || lang; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
