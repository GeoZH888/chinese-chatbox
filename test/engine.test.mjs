/* Headless checks for the offline tutor: pinyin handling, answer marking,
   lookup, and command routing. Run with `npm test`. */
import assert from 'node:assert/strict';
import test from 'node:test';

// The browser files attach to globalThis when window is absent.
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }
};
await import('../src/i18n.js');
await import('../src/curriculum.js');
await import('../src/tutor.js');
await import('../src/prompt.js');

const { CURRICULUM, TUTOR, I18N, TUTOR_SYSTEM_PROMPT } = globalThis;

// Each test gets its own progress, so drills picked at random cannot leak
// scores from one test into the next.
function freshEngine() {
  globalThis.localStorage._d = {};
  return new TUTOR.Engine(CURRICULUM);
}

test('curriculum is well formed', () => {
  assert.ok(CURRICULUM.units.length >= 8);
  assert.ok(CURRICULUM.all.length >= 50);
  for (const item of CURRICULUM.all) {
    for (const field of ['zh', 'py', 'en', 'it', 'key', 'unitId']) {
      assert.ok(item[field], `${item.zh} is missing ${field}`);
    }
    for (const lang of ['zh', 'en', 'it']) {
      assert.ok(item.unitTitle[lang], `${item.unitId} title missing ${lang}`);
    }
  }
  const keys = CURRICULUM.all.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, 'keys must be unique');
});

test('every UI string exists in all three languages', () => {
  const shape = (o) => Object.keys(o).sort().join(',');
  const zh = I18N.get('zh'), en = I18N.get('en'), it = I18N.get('it');
  assert.equal(shape(zh), shape(en));
  assert.equal(shape(en), shape(it));
  assert.equal(shape(zh.tutor), shape(en.tutor));
  assert.equal(shape(en.tutor), shape(it.tutor));
});

test('tone detection and stripping', () => {
  assert.equal(TUTOR.toneOf('nǐ'), 3);
  assert.equal(TUTOR.toneOf('hǎo'), 3);
  assert.equal(TUTOR.toneOf('xie'), 5);
  assert.equal(TUTOR.toneOf('zàijiàn'), 4);
  assert.equal(TUTOR.stripTones('nǐ hǎo'), 'ni hao');
  assert.equal(TUTOR.stripTones('ni3 hao3'), 'ni hao');
  assert.equal(TUTOR.normLatin('Nǐ Hǎo!'), 'nihao');
});

test('pinyin splits into syllables so each can be coloured by tone', () => {
  const parts = (s) => TUTOR.pinyinParts(s);
  assert.deepEqual(parts('xièxie'), ['xiè', 'xie']);
  assert.deepEqual(parts('zàijiàn'), ['zài', 'jiàn']);
  assert.deepEqual(parts('fúwùyuán'), ['fú', 'wù', 'yuán']);
  assert.deepEqual(parts('fēnzhōng'), ['fēn', 'zhōng']);   // zh digraph kept whole
  assert.deepEqual(parts('hěn'), ['hěn']);                 // final -n not split off
  assert.deepEqual(parts('nǐ hǎo'), ['nǐ', ' ', 'hǎo']);   // separators preserved
  // Splitting must never lose or reorder characters, for any entry.
  for (const item of CURRICULUM.all) {
    assert.equal(parts(item.py).join(''), item.py, item.py);
  }
});

test('answer marking accepts characters, pinyin, and flags tone slips', () => {
  const e = freshEngine();
  const item = CURRICULUM.all.find((i) => i.zh === '你好');

  assert.equal(e.check('你好', item), 'right');
  assert.equal(e.check('你好。', item), 'right');       // punctuation ignored
  assert.equal(e.check('nǐ hǎo', item), 'right');       // tones marked and correct
  assert.equal(e.check('ni3 hao3', item), 'right');     // numbered pinyin
  assert.equal(e.check('nihao', item), 'pinyin');       // syllables right, no tones given
  assert.equal(e.check('ní hào', item), 'tones');       // syllables right, tones wrong
  assert.equal(e.check('再见', item), 'wrong');
  assert.equal(e.check('', item), 'wrong');
});

test('lookup finds items from any of the three languages', () => {
  const e = freshEngine();
  assert.equal(e.search('谢谢')[0].py, 'xièxie');
  assert.equal(e.search('grazie')[0].zh, '谢谢');
  assert.equal(e.search('thank you')[0].zh, '谢谢');
  assert.equal(e.search('zaijian')[0].zh, '再见');
  assert.equal(e.search('qwertyuiop').length, 0);
});

test('commands route in every interface language', () => {
  for (const lang of ['zh', 'en', 'it']) {
    const e = freshEngine();
    assert.match(e.respond('/help', lang).text, /\/drill|\/units|练习/);
    assert.ok(e.respond('/units', lang).text.split('\n').length >= 9);

    assert.match(e.respond('/unit 2', lang).text, /2|self|自我|Presentarsi|Introducing/i);
    assert.equal(e.unitId, 'self');

    const drill = e.respond('/drill', lang);
    assert.equal(drill.drill, true);
    assert.ok(e.current, 'a drill item should be pending');
    assert.equal(e.current.unitId, 'self', 'drills respect the chosen unit');

    const hint = e.respond('/hint', lang);
    assert.ok(hint.text.length > 0);

    // Correct answer clears the drill and is recorded.
    const answer = e.current.zh;
    const res = e.respond(answer, lang);
    assert.equal(res.cards.length, 1);
    assert.equal(e.current, null);
    assert.ok(Object.values(e.progress).some((s) => s.right > 0));

    assert.match(e.respond('/stats', lang).text, /Practised|Esercitate|已练习/);
  }
});

test('a wrong answer shows the target and records a miss', () => {
  const e = freshEngine();
  e.respond('/drill', 'en');
  const key = e.current.key;
  const res = e.respond('完全不对的句子', 'en');
  assert.equal(res.cards[0].key, key);
  assert.equal(e.progress[key].wrong, 1);
});

test('review only offers items that are new or previously missed', () => {
  const e = freshEngine();
  const first = e.pick(false);
  e.record(first.key, true);
  e.record(first.key, true);
  const weak = e.pick(true);
  assert.ok(weak, 'there should still be unpractised items');
  assert.notEqual(weak.key, first.key);
});

test('the system prompt names the chosen support language', () => {
  assert.match(TUTOR_SYSTEM_PROMPT({ lang: 'it' }), /Italian/);
  assert.match(TUTOR_SYSTEM_PROMPT({ lang: 'en' }), /British English/);
  assert.match(TUTOR_SYSTEM_PROMPT({ lang: 'zh', unit: 'Greetings' }), /Greetings/);
});

test('a known but unrelated phrase during a drill is answered, not marked', () => {
  const e = freshEngine();
  e.unitId = 'directions';
  e.respond('/drill', 'en');
  const key = e.current.key;
  const res = e.respond('grazie', 'en');           // 谢谢, from another unit
  assert.equal(res.cards[0].zh, '谢谢');
  assert.equal(res.drill, true, 'the drill stays open');
  assert.equal(e.current.key, key, 'and on the same item');
  assert.equal(e.progress[key], undefined, 'no score change');
  assert.match(res.text, /different phrase/);
});
