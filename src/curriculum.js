/* Curriculum for Chinese (Mandarin) learners.
   Every item carries the target language (zh + pinyin) and glosses in the two
   support languages: British English (en) and Italian (it).
   `note` is optional and keyed by support language. */
(function (global) {
  'use strict';

  const UNITS = [
    {
      id: 'greetings',
      title: { zh: '问候', en: 'Greetings', it: 'Saluti' },
      items: [
        { zh: '你好', py: 'nǐ hǎo', en: 'hello', it: 'ciao',
          note: { en: 'Two 3rd tones in a row: the first is said as a 2nd tone — "ní hǎo".',
                  it: 'Due terzi toni di fila: il primo si pronuncia come secondo — "ní hǎo".',
                  zh: '两个三声相连，前一个读作二声。' } },
        { zh: '您好', py: 'nín hǎo', en: 'hello (polite)', it: 'salve (formale)',
          note: { en: '您 is the respectful form of 你 — use it for elders, customers, officials.',
                  it: '您 è il 你 di cortesia — per anziani, clienti, autorità.',
                  zh: '您是你的敬称。' } },
        { zh: '早上好', py: 'zǎoshang hǎo', en: 'good morning', it: 'buongiorno' },
        { zh: '晚安', py: 'wǎn’ān', en: 'good night', it: 'buonanotte',
          note: { en: 'The apostrophe marks a syllable break: wǎn + ān, not wǎ + nān.',
                  it: 'L’apostrofo separa le sillabe: wǎn + ān, non wǎ + nān.',
                  zh: '隔音符号表示音节分界。' } },
        { zh: '谢谢', py: 'xièxie', en: 'thank you', it: 'grazie' },
        { zh: '不客气', py: 'bú kèqi', en: 'you are welcome', it: 'prego',
          note: { en: '不 bù shifts to bú before a 4th tone.',
                  it: '不 bù diventa bú davanti a un quarto tono.',
                  zh: '不在四声前变调为二声。' } },
        { zh: '对不起', py: 'duìbuqǐ', en: 'sorry', it: 'scusa' },
        { zh: '没关系', py: 'méi guānxi', en: 'it is all right', it: 'non fa niente' },
        { zh: '再见', py: 'zàijiàn', en: 'goodbye', it: 'arrivederci' }
      ]
    },
    {
      id: 'self',
      title: { zh: '自我介绍', en: 'Introducing yourself', it: 'Presentarsi' },
      items: [
        { zh: '你叫什么名字？', py: 'nǐ jiào shénme míngzi', en: 'what is your name?', it: 'come ti chiami?' },
        { zh: '我叫……', py: 'wǒ jiào …', en: 'my name is …', it: 'mi chiamo …' },
        { zh: '你是哪国人？', py: 'nǐ shì nǎ guó rén', en: 'which country are you from?', it: 'di che paese sei?' },
        { zh: '我是意大利人。', py: 'wǒ shì Yìdàlì rén', en: 'I am Italian', it: 'sono italiano/a',
          note: { en: '意大利 Yìdàlì = Italy. Add 人 rén to a place to make a nationality.',
                  it: '意大利 Yìdàlì = Italia. 人 rén trasforma un luogo in nazionalità.',
                  zh: '国名 + 人 = 国籍。' } },
        { zh: '我是英国人。', py: 'wǒ shì Yīngguó rén', en: 'I am British', it: 'sono britannico/a' },
        { zh: '我在学中文。', py: 'wǒ zài xué Zhōngwén', en: 'I am learning Chinese', it: 'sto imparando il cinese',
          note: { en: '在 before the verb marks an action in progress.',
                  it: '在 davanti al verbo indica un’azione in corso.',
                  zh: '“在 + 动词”表示正在进行。' } },
        { zh: '认识你很高兴。', py: 'rènshi nǐ hěn gāoxìng', en: 'pleased to meet you', it: 'piacere di conoscerti' },
        { zh: '我住在北京。', py: 'wǒ zhù zài Běijīng', en: 'I live in Beijing', it: 'abito a Pechino' },
        { zh: '你会说英语吗？', py: 'nǐ huì shuō Yīngyǔ ma', en: 'do you speak English?', it: 'parli inglese?',
          note: { en: '吗 ma at the end turns any statement into a yes/no question.',
                  it: '吗 ma alla fine trasforma un’affermazione in domanda sì/no.',
                  zh: '句末加吗构成是非问句。' } }
      ]
    },
    {
      id: 'numbers',
      title: { zh: '数字和钱', en: 'Numbers & money', it: 'Numeri e denaro' },
      items: [
        { zh: '一、二、三', py: 'yī, èr, sān', en: 'one, two, three', it: 'uno, due, tre' },
        { zh: '四、五、六', py: 'sì, wǔ, liù', en: 'four, five, six', it: 'quattro, cinque, sei' },
        { zh: '七、八、九、十', py: 'qī, bā, jiǔ, shí', en: 'seven, eight, nine, ten', it: 'sette, otto, nove, dieci' },
        { zh: '多少钱？', py: 'duōshao qián', en: 'how much is it?', it: 'quanto costa?' },
        { zh: '一百块', py: 'yìbǎi kuài', en: 'one hundred yuan', it: 'cento yuan',
          note: { en: '块 kuài is the spoken word for 元 yuán — like "quid" for pounds.',
                  it: '块 kuài è la parola parlata per 元 yuán, come "sacco" nel gergo.',
                  zh: '口语用块，书面用元。' } },
        { zh: '太贵了。', py: 'tài guì le', en: 'too expensive', it: 'troppo caro' },
        { zh: '便宜一点儿。', py: 'piányi yìdiǎnr', en: 'a bit cheaper, please', it: 'un po’ meno caro' },
        { zh: '可以刷卡吗？', py: 'kěyǐ shuākǎ ma', en: 'can I pay by card?', it: 'posso pagare con la carta?' },
        { zh: '我要两个。', py: 'wǒ yào liǎng ge', en: 'I would like two', it: 'ne vorrei due',
          note: { en: 'Before a measure word, "two" is 两 liǎng, never 二 èr.',
                  it: 'Davanti a un classificatore "due" è 两 liǎng, mai 二 èr.',
                  zh: '量词前用两，不用二。' } }
      ]
    },
    {
      id: 'food',
      title: { zh: '点菜', en: 'Ordering food', it: 'Ordinare al ristorante' },
      items: [
        { zh: '服务员', py: 'fúwùyuán', en: 'waiter / waitress', it: 'cameriere/a',
          note: { en: 'Calling this across the room is normal in China, not rude.',
                  it: 'Chiamarlo ad alta voce in Cina è normale, non maleducato.',
                  zh: '在中国餐厅里这样招呼很常见。' } },
        { zh: '菜单', py: 'càidān', en: 'menu', it: 'menù' },
        { zh: '我要点菜。', py: 'wǒ yào diǎncài', en: 'I would like to order', it: 'vorrei ordinare' },
        { zh: '这个', py: 'zhège', en: 'this one', it: 'questo',
          note: { en: 'Point at the menu and say 这个 — it works everywhere.',
                  it: 'Indica il menù e di’ 这个 — funziona sempre.',
                  zh: '指着菜单说“这个”最实用。' } },
        { zh: '不要辣。', py: 'bú yào là', en: 'not spicy, please', it: 'non piccante' },
        { zh: '我吃素。', py: 'wǒ chīsù', en: 'I am vegetarian', it: 'sono vegetariano/a' },
        { zh: '一瓶啤酒', py: 'yì píng píjiǔ', en: 'a bottle of beer', it: 'una bottiglia di birra' },
        { zh: '好吃！', py: 'hǎochī', en: 'delicious!', it: 'buonissimo!' },
        { zh: '买单。', py: 'mǎidān', en: 'the bill, please', it: 'il conto, per favore' }
      ]
    },
    {
      id: 'directions',
      title: { zh: '问路', en: 'Asking directions', it: 'Chiedere indicazioni' },
      items: [
        { zh: '请问……', py: 'qǐngwèn …', en: 'excuse me, may I ask …', it: 'scusi, posso chiedere …' },
        { zh: '洗手间在哪儿？', py: 'xǐshǒujiān zài nǎr', en: 'where is the toilet?', it: 'dov’è il bagno?' },
        { zh: '地铁站', py: 'dìtiězhàn', en: 'underground station', it: 'stazione della metro' },
        { zh: '往前走。', py: 'wǎng qián zǒu', en: 'go straight on', it: 'vada dritto' },
        { zh: '左拐', py: 'zuǒ guǎi', en: 'turn left', it: 'giri a sinistra' },
        { zh: '右拐', py: 'yòu guǎi', en: 'turn right', it: 'giri a destra' },
        { zh: '远吗？', py: 'yuǎn ma', en: 'is it far?', it: 'è lontano?' },
        { zh: '走路十分钟。', py: 'zǒulù shí fēnzhōng', en: 'ten minutes on foot', it: 'dieci minuti a piedi' },
        { zh: '我迷路了。', py: 'wǒ mílù le', en: 'I am lost', it: 'mi sono perso/a' }
      ]
    },
    {
      id: 'shopping',
      title: { zh: '购物', en: 'Shopping', it: 'Fare compere' },
      items: [
        { zh: '我想买……', py: 'wǒ xiǎng mǎi …', en: 'I would like to buy …', it: 'vorrei comprare …' },
        { zh: '有没有大号的？', py: 'yǒu méiyǒu dà hào de', en: 'do you have it in large?', it: 'ce l’avete in taglia grande?',
          note: { en: 'Verb + 没 + verb is a neat yes/no question without 吗.',
                  it: 'Verbo + 没 + verbo: domanda sì/no senza 吗.',
                  zh: '正反问句：有没有。' } },
        { zh: '可以试试吗？', py: 'kěyǐ shìshi ma', en: 'may I try it on?', it: 'posso provarlo?' },
        { zh: '我只是看看。', py: 'wǒ zhǐshì kànkan', en: 'I am just looking', it: 'sto solo guardando' },
        { zh: '有别的颜色吗？', py: 'yǒu bié de yánsè ma', en: 'any other colours?', it: 'ci sono altri colori?' },
        { zh: '给我一个袋子。', py: 'gěi wǒ yí ge dàizi', en: 'a bag, please', it: 'mi dia un sacchetto' },
        { zh: '太大了。', py: 'tài dà le', en: 'too big', it: 'troppo grande' }
      ]
    },
    {
      id: 'time',
      title: { zh: '时间', en: 'Time & dates', it: 'Tempo e date' },
      items: [
        { zh: '现在几点？', py: 'xiànzài jǐ diǎn', en: 'what is the time?', it: 'che ore sono?' },
        { zh: '三点半', py: 'sān diǎn bàn', en: 'half past three', it: 'le tre e mezza' },
        { zh: '今天', py: 'jīntiān', en: 'today', it: 'oggi' },
        { zh: '明天见！', py: 'míngtiān jiàn', en: 'see you tomorrow!', it: 'a domani!' },
        { zh: '星期一', py: 'xīngqīyī', en: 'Monday', it: 'lunedì',
          note: { en: 'Days are 星期 + a number; Sunday is the exception, 星期天.',
                  it: 'I giorni sono 星期 + un numero; domenica fa eccezione: 星期天.',
                  zh: '星期加数字即可，星期天例外。' } },
        { zh: '几号？', py: 'jǐ hào', en: 'what date?', it: 'che giorno del mese?' },
        { zh: '什么时候？', py: 'shénme shíhou', en: 'when?', it: 'quando?' }
      ]
    },
    {
      id: 'survival',
      title: { zh: '应急表达', en: 'Getting by', it: 'Cavarsela' },
      items: [
        { zh: '我不明白。', py: 'wǒ bù míngbai', en: 'I do not understand', it: 'non capisco' },
        { zh: '请再说一遍。', py: 'qǐng zài shuō yí biàn', en: 'please say that again', it: 'può ripetere?' },
        { zh: '说慢一点儿。', py: 'shuō màn yìdiǎnr', en: 'please speak more slowly', it: 'parli più lentamente' },
        { zh: '这个怎么说？', py: 'zhège zěnme shuō', en: 'how do you say this?', it: 'come si dice questo?' },
        { zh: '请帮帮忙。', py: 'qǐng bāngbang máng', en: 'could you help me?', it: 'mi può aiutare?' },
        { zh: '没问题。', py: 'méi wèntí', en: 'no problem', it: 'nessun problema' },
        { zh: '我需要医生。', py: 'wǒ xūyào yīshēng', en: 'I need a doctor', it: 'ho bisogno di un medico' }
      ]
    }
  ];

  // Flatten once, tagging each item with its unit so lookups can report context.
  const ALL = [];
  UNITS.forEach(function (u) {
    u.items.forEach(function (item, i) {
      item.unitId = u.id;
      item.unitTitle = u.title;
      item.position = i;
      item.lang = 'zh';
      item.kind = 'phrase';
      // Keyed by what is practised, not where it sits — see src/identity.js.
      item.key = global.IDENTITY.key(item.lang, item.kind, item.zh);
      ALL.push(item);
    });
  });

  global.CURRICULUM = {
    units: UNITS,
    all: ALL,
    unit: function (id) {
      return UNITS.filter(function (u) { return u.id === id; })[0] || null;
    },
    byKey: function (k) {
      return ALL.filter(function (x) { return x.key === k; })[0] || null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
