/* Offline tutor: pinyin utilities, answer checking, drills, lookup, progress.
   No network, no dependencies — this is what runs when the chatbox is opened
   straight from disk. */
(function (global) {
  'use strict';

  /* ---------- pinyin ---------- */

  const TONE_MAP = {
    'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
    'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
    'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
    'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
    'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
    'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4],
    'ń': ['n', 2], 'ň': ['n', 3], 'ǹ': ['n', 4], 'ḿ': ['m', 2]
  };

  // Tone number of a pinyin syllable: 1-4 from the diacritic, 5 = neutral.
  function toneOf(syllable) {
    for (const ch of syllable) {
      if (TONE_MAP[ch]) return TONE_MAP[ch][1];
    }
    return 5;
  }

  // "nǐ hǎo" and "ni3 hao3" both collapse to "ni hao".
  function stripTones(s) {
    let out = '';
    for (const ch of String(s)) {
      out += TONE_MAP[ch] ? TONE_MAP[ch][0] : ch;
    }
    return out.replace(/[1-5]/g, '');
  }

  const VOWEL = 'aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ';
  const CONSONANT = 'bpmfdtnlgkhjqxzcsrwy';
  const LETTER = 'A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ';
  const LETTER_RE = new RegExp('[' + LETTER + ']');
  const SPLIT_RE = new RegExp('([^' + LETTER + ']+)');

  function lc(ch) { return String(ch || '').toLowerCase(); }
  function isVowel(ch) { return !!ch && VOWEL.indexOf(lc(ch)) >= 0; }
  function isConsonant(ch) { return !!ch && CONSONANT.indexOf(lc(ch)) >= 0; }

  // A consonant followed by a vowel can only start a syllable, so we can split
  // "xièxie" into xiè + xie without a full syllable table. The one wrinkle is
  // the digraphs zh/ch/sh, whose h must not be treated as an initial of its own.
  function startsSyllable(str, i) {
    const c = str[i];
    if (!isConsonant(c)) return false;
    if (lc(c) === 'h' && i > 0 && 'zcs'.indexOf(lc(str[i - 1])) >= 0) return false;
    if ('zcs'.indexOf(lc(c)) >= 0 && lc(str[i + 1]) === 'h') return isVowel(str[i + 2]);
    return isVowel(str[i + 1]);
  }

  // Split a pinyin string into syllables and separators, for tone colouring.
  function pinyinParts(s) {
    const out = [];
    String(s).split(SPLIT_RE).forEach(function (chunk) {
      if (chunk === '') return;
      if (!LETTER_RE.test(chunk)) { out.push(chunk); return; }
      let start = 0;
      for (let i = 1; i < chunk.length; i++) {
        if (startsSyllable(chunk, i)) {
          out.push(chunk.slice(start, i));
          start = i;
        }
      }
      out.push(chunk.slice(start));
    });
    return out;
  }

  /* ---------- normalisation ---------- */

  const PUNCT = /[\s，。、？！；：""''「」《》…·,.\?!;:"'()（）\-—_/]/g;

  function normLatin(s) {
    return stripTones(String(s).toLowerCase())
      .replace(/ü/g, 'u').replace(/v/g, 'u')
      .replace(PUNCT, '');
  }

  function normHan(s) {
    return String(s).replace(PUNCT, '').replace(/…/g, '');
  }

  function hasHan(s) { return /[一-鿿]/.test(String(s)); }

  /* ---------- progress (localStorage, best effort) ---------- */

  const STORE_KEY = 'chatbox.progress.v1';

  function loadProgress() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch (e) { return {}; }
    // Progress used to be keyed by curriculum position ('greetings:7'). Those
    // keys mean nothing now that identity is content-based, and counting them
    // would overstate how much has been practised, so drop them.
    const clean = {};
    Object.keys(saved).forEach(function (k) {
      if (k.indexOf('|') > 0) clean[k] = saved[k];
    });
    return clean;
  }

  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
  }

  /* ---------- the engine ---------- */

  function Engine(curriculum) {
    this.c = curriculum;
    this.unitId = null;       // null = draw from every unit
    this.current = null;      // item being drilled
    this.lastAttempt = null;  // {item, verdict} — the app forwards this to the platform
    this.progress = loadProgress();
  }

  // Read and clear, so one answer is never logged twice.
  Engine.prototype.takeAttempt = function () {
    const a = this.lastAttempt;
    this.lastAttempt = null;
    return a;
  };

  // Exposed so a sync layer can replace `progress` wholesale and persist it.
  Engine.prototype.saveProgress = function () {
    saveProgress(this.progress);
  };

  Engine.prototype.score = function (key) {
    return this.progress[key] || { right: 0, wrong: 0 };
  };

  Engine.prototype.record = function (key, ok) {
    const s = this.score(key);
    if (ok) s.right += 1; else s.wrong += 1;
    this.progress[key] = s;
    saveProgress(this.progress);
  };

  Engine.prototype.pool = function () {
    const self = this;
    if (!this.unitId) return this.c.all;
    return this.c.all.filter(function (x) { return x.unitId === self.unitId; });
  };

  // Weakest-first with a dash of randomness, so drills do not loop on one item.
  Engine.prototype.pick = function (weakOnly) {
    const self = this;
    let pool = this.pool().slice();
    if (weakOnly) {
      pool = pool.filter(function (x) {
        const s = self.score(x.key);
        return s.wrong > 0 || s.right === 0;
      });
      if (!pool.length) return null;
    }
    pool.sort(function (a, b) {
      const sa = self.score(a.key), sb = self.score(b.key);
      const wa = sa.wrong * 2 - sa.right + Math.random() * 1.5;
      const wb = sb.wrong * 2 - sb.right + Math.random() * 1.5;
      return wb - wa;
    });
    return pool[0];
  };

  // Compare a learner's attempt with the target item.
  // -> 'right' | 'pinyin' | 'tones' | 'wrong'
  Engine.prototype.check = function (input, item) {
    const raw = String(input).trim();
    if (!raw) return 'wrong';

    if (hasHan(raw)) {
      return normHan(raw) === normHan(item.zh) ? 'right' : 'wrong';
    }

    const target = normLatin(item.py);
    const attempt = normLatin(raw);
    if (attempt !== target) return 'wrong';

    // Syllables match. Did they also get the tones right, if they marked any?
    const marked = /[1-5]/.test(raw) || pinyinParts(raw).some(function (p) { return toneOf(p) !== 5; });
    if (!marked) return 'pinyin';

    const tonesOf = function (s) {
      return String(s).replace(/([a-zü]+)([1-5])/gi, function (m, syl, n) { return syl + n; })
        .split(/[^A-Za-z1-5āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]+/)
        .filter(Boolean)
        .map(function (syl) {
          const digit = syl.match(/[1-5]/);
          return digit ? Number(digit[0]) : toneOf(syl);
        });
    };
    const a = tonesOf(raw), b = tonesOf(item.py);
    return a.join() === b.join() ? 'right' : 'tones';
  };

  Engine.prototype.search = function (query) {
    const q = String(query).trim();
    if (!q) return [];
    const qh = normHan(q);
    const ql = normLatin(q);
    const scored = [];
    this.c.all.forEach(function (item) {
      let s = 0;
      if (qh && hasHan(q)) {
        if (normHan(item.zh) === qh) s = 100;
        else if (normHan(item.zh).indexOf(qh) >= 0) s = 60;
      }
      if (ql.length > 1) {
        if (normLatin(item.py) === ql) s = Math.max(s, 95);
        else if (normLatin(item.py).indexOf(ql) >= 0) s = Math.max(s, 55);
        if (normLatin(item.en) === ql || normLatin(item.it) === ql) s = Math.max(s, 90);
        else if (normLatin(item.en).indexOf(ql) >= 0 || normLatin(item.it).indexOf(ql) >= 0) s = Math.max(s, 50);
      }
      if (s > 0) scored.push([s, item]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored.slice(0, 5).map(function (x) { return x[1]; });
  };

  /* ---------- command routing ---------- */

  const ALIASES = {
    units: ['units', 'unit', 'lessons', 'lezioni', 'unità', '课程', '目录'],
    unitPick: ['unit', 'unità', '单元'],
    drill: ['drill', 'practise', 'practice', 'esercizio', 'esercizi', '练习', '出题'],
    review: ['review', 'ripassa', 'ripasso', '复习'],
    hint: ['hint', 'indizio', '提示'],
    skip: ['skip', 'salta', '跳过'],
    stats: ['stats', 'progress', 'progressi', '进度', '统计'],
    help: ['help', 'aiuto', '帮助', '?']
  };

  function matches(word, list) { return list.indexOf(word) >= 0; }

  // "问候 · Greetings", but just "问候" when the interface is already Chinese.
  function unitLabel(title, lang) {
    return lang === 'zh' ? title.zh : title.zh + ' · ' + title[lang];
  }

  // Returns { text, cards, drill } — the UI renders cards as phrase cards.
  Engine.prototype.respond = function (input, lang) {
    const T = global.I18N.get(lang).tutor;
    const raw = String(input).trim();
    const self = this;

    if (!raw) return { text: T.help, cards: [] };

    if (raw[0] === '/') {
      const bits = raw.slice(1).split(/\s+/);
      const cmd = bits[0].toLowerCase();
      const arg = bits[1];

      if (matches(cmd, ALIASES.help)) return { text: T.help, cards: [] };

      if (matches(cmd, ALIASES.unitPick) && arg) {
        const idx = parseInt(arg, 10) - 1;
        const u = this.c.units[idx];
        if (!u) return { text: T.unitUnknown, cards: [] };
        this.unitId = u.id;
        return { text: T.unitChosen({ title: unitLabel(u.title, lang), n: u.items.length }), cards: [] };
      }

      if (matches(cmd, ALIASES.units)) {
        const lines = this.c.units.map(function (u, i) {
          return (i + 1) + '. ' + unitLabel(u.title, lang) + ' (' + u.items.length + ')';
        });
        return { text: T.unitsHeader + '\n' + lines.join('\n'), cards: [] };
      }

      if (matches(cmd, ALIASES.drill) || matches(cmd, ALIASES.review)) {
        const weak = matches(cmd, ALIASES.review);
        const item = this.pick(weak);
        if (!item) return { text: T.reviewEmpty, cards: [] };
        this.current = item;
        return { text: T.drillPrompt({ cue: item[lang === 'zh' ? 'en' : lang] }), cards: [], drill: true };
      }

      if (matches(cmd, ALIASES.hint)) {
        if (!this.current) return { text: T.noDrill, cards: [] };
        const han = normHan(this.current.zh);
        return { text: T.hint({ first: han[0], n: han.length }), cards: [] };
      }

      if (matches(cmd, ALIASES.skip)) {
        if (!this.current) return { text: T.noDrill, cards: [] };
        const item = this.current;
        this.current = null;
        this.record(item.key, false);
        this.lastAttempt = { item: item, verdict: 'skip' };
        return { text: T.skipped, cards: [item], footer: T.nextHint };
      }

      if (matches(cmd, ALIASES.stats)) {
        const keys = Object.keys(this.progress);
        const known = keys.filter(function (k) { return self.progress[k].right >= 2; }).length;
        return { text: T.statsLine({ seen: keys.length, known: known, total: this.c.all.length }), cards: [] };
      }

      return { text: T.help, cards: [] };
    }

    // A drill is running: treat the message as an attempt.
    if (this.current) {
      const item = this.current;
      const verdict = this.check(raw, item);
      // Verdicts in the platform's vocabulary (supabase/schema.sql).
      const PLATFORM = { right: 'right', pinyin: 'partial', tones: 'tones', wrong: 'wrong' };
      if (verdict !== 'tones') this.lastAttempt = { item: item, verdict: PLATFORM[verdict] };
      if (verdict === 'right') {
        this.current = null;
        this.record(item.key, true);
        return { text: T.correct, cards: [item], footer: T.nextHint };
      }
      if (verdict === 'pinyin') {
        this.current = null;
        this.record(item.key, true);
        return { text: T.correctPinyin, cards: [item], footer: T.nextHint };
      }
      if (verdict === 'tones') {
        return { text: T.toneOff, cards: [], drill: true };
      }
      const hits = this.search(raw);
      if (hits.length && hits[0].key !== item.key) {
        // They typed a different phrase from the book — answer it, say plainly
        // that it was not the answer, and leave the drill open unscored.
        return {
          text: T.aside({ cue: item[lang === 'zh' ? 'en' : lang] }),
          cards: hits,
          drill: true
        };
      }
      this.record(item.key, false);
      this.current = null;
      return { text: T.wrong, cards: [item], footer: T.nextHint };
    }

    // Otherwise: dictionary lookup.
    const hits = this.search(raw);
    if (!hits.length) return { text: T.lookupNone({ q: raw }), cards: [] };
    return { text: T.lookupHeader({ n: hits.length }), cards: hits };
  };

  global.TUTOR = {
    Engine: Engine,
    toneOf: toneOf,
    stripTones: stripTones,
    pinyinParts: pinyinParts,
    normLatin: normLatin,
    normHan: normHan,
    hasHan: hasHan
  };
})(typeof window !== 'undefined' ? window : globalThis);
