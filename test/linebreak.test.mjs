// @ts-check
import test from 'node:test'
import assert from 'node:assert/strict'
import { breakParagraph } from '../hooks/engine/linebreak.mjs'
import { classOf, halfSpace, noBreakAfter, noBreakBefore } from '../hooks/engine/jlreq.mjs'

/** 和字・全角の約物は 1em、ASCII は 0.5em。run は 1 字 0.5em */
const fake = {
  upm: 1000,
  ascent: 0.88,
  descent: -0.12,
  adv: (/** @type {number} */ cp) => (cp < 0x80 ? 0.5 : 1),
  has: () => true,
  run: (/** @type {string} */ text) => {
    const chars = Array.from(text)
    return { width: chars.length * 0.5, xs: chars.map((_, i) => i * 0.5) }
  },
}
const metrics = { mincho: fake, minchoBold: fake, sans: fake, sansBold: fake }
const SIZE = 10

/**
 * @param {string} text
 * @param {{ chars?: number, indent?: number, align?: 'justify'|'left'|'center'|'right', phrase?: (t: string) => number[], lastAlign?: 'justify'|'left'|'center'|'right' }} [o]
 */
const para = (text, o = {}) =>
  breakParagraph([{ text, font: 'mincho', size: SIZE }], {
    measure: SIZE * (o.chars ?? 20),
    metrics,
    indent: o.indent ?? 0,
    align: o.align ?? 'justify',
    ...(o.phrase ? { phrase: o.phrase } : {}),
    ...(o.lastAlign ? { lastAlign: o.lastAlign } : {}),
  })

const lineText = (/** @type {{ glyphs: { c: string }[] }} */ l) => l.glyphs.map((g) => g.c).join('')
/** 空白の字を除いた字数 */
const inkCount = (/** @type {{ glyphs: { c: string }[] }} */ l) => l.glyphs.filter((g) => g.c !== ' ').length
const near = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} ${a} と ${b} の差が ${tol} を超えた`)

const KINSOKU_TEXTS = [
  '「そうだね」と彼は言った。「でも、ちょっと待って……」しばらくして、「やっぱり行こう！」と笑った。',
  'ミュージシャンのジョニーは、キャッチャーのミットを買った。ちょっとしたショッピング、コーヒーブレイクにパーティー、ウィンドウショッピングなど。',
  '今日はAIの話をしよう。ChatGPTやClaudeは、「大規模言語モデル（LLM）」と呼ばれる。価格は100円（税込）で、割引率は20％です。',
  '（１）見出し、（２）本文。〔注〕詳しくは『付録』を参照のこと――ただし、その場合は〜約3割増しになる。‘引用’や“強調”も使う。',
  '午後３時に駅前で会う予定だったが、雨が降ってきたので「少し遅れるかも」と連絡した。傘を持っていなかったので、近くのコンビニで買った。',
  'そのとき、ぽつりと「ねえ、覚えてる？」と聞かれた。ええ、もちろん。あの夏の日の、ひぐらしの声、麦茶の氷、縁側の風鈴ーー全部。',
]

test('全角の字だけの段落は、どの行も字間をいじらず、字の位置が字送りの整数倍になる', () => {
  // 平仮名・漢字だけ。小書きの仮名・長音・約物を含まないので、どこで切っても禁則に触れない
  const unit = 'あいうえおかきくけこさしすせそたちつてと山川海空花鳥風月雪雲'
  const text = Array.from({ length: 95 }, (_, i) => unit[i % unit.length]).join('')
  const lines = para(text, { chars: 20, indent: 1 })
  assert.equal(lines.length, 5)
  assert.deepEqual(lines.map(inkCount), [19, 20, 20, 20, 16])
  for (const [i, l] of lines.entries()) {
    assert.equal(l.spread, 0, `${i} 行目の spread`)
    assert.equal(l.overfull, undefined)
    for (const [k, g] of l.glyphs.entries()) {
      const cells = g.x / SIZE
      const expected = i === 0 ? 1 + k : k
      near(cells, expected, 1e-9, `${i} 行目 ${k} 字目の字送り`)
    }
    if (!l.last) near(l.width, 200, 1e-9, `${i} 行目の右端`)
  }
  assert.equal(lines.at(-1)?.last, true)
  assert.deepEqual(lines.map((l) => l.last), [false, false, false, false, true])
})

test('全角の字だけの段落は字下げなしでも格子に乗る', () => {
  const text = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'.repeat(2)
  const lines = para(text, { chars: 10 })
  for (const l of lines) {
    assert.equal(l.spread, 0)
    for (const g of l.glyphs) near((g.x / SIZE) % 1, 0, 1e-9)
  }
  assert.equal(lines.reduce((s, l) => s + inkCount(l), 0), Array.from(text).length)
})

test('行頭禁則と行末禁則: 括弧・句読点・長音・小書きの仮名の多い文を行長 10〜40 字のどれで組んでも破らない', () => {
  for (const [ti, text] of KINSOKU_TEXTS.entries()) {
    const expected = Array.from(text).length
    for (let chars = 10; chars <= 40; chars++) {
      for (const indent of [0, 1]) {
        const lines = para(text, { chars, indent })
        const where = `文 ${ti} 行長 ${chars} 字下げ ${indent}`
        assert.equal(lines.reduce((s, l) => s + inkCount(l), 0), expected, `${where}: 字が落ちたか増えた`)
        for (const [i, l] of lines.entries()) {
          assert.equal(l.overfull, undefined, `${where}: ${i} 行目がはみ出した`)
          const first = l.glyphs[0].c
          const lastCh = l.glyphs.at(-1)?.c ?? ''
          if (i > 0) assert.equal(noBreakBefore(first), false, `${where}: 行頭に ${first}`)
          if (!l.last) {
            assert.equal(noBreakAfter(lastCh), false, `${where}: 行末に ${lastCh}`)
            near(l.width, chars * SIZE, 1e-6, `${where}: ${i} 行目の右端`)
          }
        }
      }
    }
  }
})

test('ASCII の閉じ約物は行頭に、開き括弧は行末に来ない', () => {
  const text = 'Use foo(bar, baz) or [x] and {y}; see this. Then 試す。(注) 完了！ 100% done, ok.'
  for (let chars = 12; chars <= 40; chars++) {
    const lines = para(text, { chars })
    lines.forEach((l, i) => {
      if (i > 0) assert.equal(noBreakBefore(l.glyphs[0].c), false, `行長 ${chars}: 行頭に ${l.glyphs[0].c}`)
      if (!l.last) assert.equal(noBreakAfter(l.glyphs.at(-1)?.c ?? ''), false, `行長 ${chars}: 行末に ${l.glyphs.at(-1)?.c}`)
    })
  }
})

test('分離禁止: —— と …… の間では行を分けない', () => {
  const text = 'ああああ——いいいい……うううう‥‥ええ'
  for (let chars = 3; chars <= 12; chars++) {
    const lines = para(text, { chars })
    for (let i = 1; i < lines.length; i++) {
      const prev = lines[i - 1].glyphs.at(-1)?.c ?? ''
      const next = lines[i].glyphs[0].c
      assert.ok(!(classOf(prev) === 8 && classOf(next) === 8), `行長 ${chars}: ${prev} と ${next} の間で分けた`)
    }
  }
})

test('和欧間は 0.25em で、括弧と欧字の間には入らない', () => {
  // 左寄せにして、伸び縮みなしの自然な位置を見る
  const lines = para('漢a字', { chars: 50, align: 'left' })
  const g = lines[0].glyphs
  assert.deepEqual(g.map((x) => x.c), ['漢', 'a', '字'])
  near(g[1].x, 12.5, 1e-9, '漢の後の欧字は 1em + 0.25em')
  near(g[2].x, 12.5 + 5 + 2.5, 1e-9, '欧字の後の字は 0.5em の欧字 + 0.25em')

  const b = para('漢「a」字', { chars: 50, align: 'left' })[0].glyphs
  assert.deepEqual(b.map((x) => x.c), ['漢', '「', 'a', '」', '字'])
  near(b[1].x, 10, 1e-9)
  near(b[2].x - b[1].x, 10, 1e-9, '「と a の間に和欧間を入れない')
  near(b[3].x - b[2].x, 5, 1e-9, 'a と 」の間に和欧間を入れない')
  near(b[4].x - b[3].x, 10, 1e-9, '」の後の二分は箱の中にある')
})

test('約物が並んだ時の字面どうしの間: 。」と、」は 0、」「と、「は二分、」・は四分', () => {
  // 字面（インク）の間の空き = 次の字の箱の左端 + 次の字の前の空き − (前の字の箱の右端 − 前の字の後の空き)
  const gap = (/** @type {string} */ text) => {
    const g = para(text, { chars: 50, align: 'left', indent: 1 })[0].glyphs
    const a = g[1]
    const b = g[2]
    return (b.x + halfSpace(b.c).before * SIZE - (a.x + SIZE - halfSpace(a.c).after * SIZE)) / SIZE
  }
  assert.equal(gap('あ。」い'), 0)
  assert.equal(gap('あ」」い'), 0)
  assert.equal(gap('あ、」い'), 0)
  assert.equal(gap('あ」。い'), 0)
  assert.equal(gap('あ「「い'), 0)
  assert.equal(gap('あ」「い'), 0.5)
  assert.equal(gap('あ。「い'), 0.5)
  assert.equal(gap('あ、「い'), 0.5)
  assert.equal(gap('あ」・い'), 0.25)
  assert.equal(gap('あ・「い'), 0.5)
  assert.equal(gap('あ、い'), 0.5, '句読点の後に和字が続けば二分を残す')
  assert.equal(gap('あ漢い'), 0)
  // 箱の位置でも確かめる: 。の箱の右端より 」の箱の左端が二分戻る
  const x = para('あ。」い', { chars: 50, align: 'left', indent: 1 })[0].glyphs.map((q) => q.x)
  near(x[2] - x[1], 5, 1e-9)
})

test('行頭の始め括弧は前の二分を取って天付きになる', () => {
  const lines = para('「こんにちは」と言った。', { chars: 30, align: 'left', indent: 0 })
  near(lines[0].glyphs[0].x, -5, 1e-9, '字面の左端が 0 になる')
  near(lines[0].glyphs[1].x, 5, 1e-9)

  // 2 行目の頭に来る始め括弧
  const text = 'あ'.repeat(10) + '「いい」うう'
  const l = para(text, { chars: 10 })
  assert.equal(l.length, 2)
  assert.equal(l[1].glyphs[0].c, '「')
  near(l[1].glyphs[0].x, -5, 1e-9)
})

test('段落 1 行目の始め括弧は字下げの中で前の二分を取り、字面が 1 字下がりの位置になる', () => {
  const lines = para('「こんにちは」と言った。', { chars: 30, indent: 1, align: 'left' })
  near(lines[0].glyphs[0].x, 5, 1e-9, 'x = 0.5em')
  near(lines[0].glyphs[1].x, 15, 1e-9, '2 字目の字面の左端は 1.5em')
  const j = para('「こんにちは」と言ったのです。それから彼は静かに笑って、窓の外の雪を眺めていた。', { chars: 20, indent: 1 })
  near(j[0].glyphs[0].x, 5, 1e-9)
})

test('行末の句点の後の二分は取って、字面の右端が行長にそろう', () => {
  const lines = para('あいうえおかきくけ。こさしすせそたちつ', { chars: 10 })
  assert.equal(lineText(lines[0]), 'あいうえおかきくけ。')
  near(lines[0].width, 100, 1e-9, '右端が行長')
  const maru = lines[0].glyphs.at(-1)
  assert.ok(maru)
  near((maru?.x ?? 0) + 5, 100, 1e-9, '。の字面（左半分）の右端が行長')
  assert.ok(lines[0].spread > 0, '二分足りないので字間にわずかに配る')
  assert.ok(lines[0].spread < 0.1)
})

test('行中の約物の空きを詰めて、1 字を行に追い込める', () => {
  const lines = para('あ、い、う、え、お、か', { chars: 10 })
  assert.equal(lines.length, 1)
  near(lines[0].width, 100, 1e-9, '詰めて行長ちょうど')
  assert.equal(lines[0].overfull, undefined)
  const xs = lines[0].glyphs.map((g) => g.x)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], '字の順が逆転しない')
})

test('最後の行は揃えず左に寄せ、字間を足さない', () => {
  const text = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'
  const lines = para(text, { chars: 10 })
  const last = /** @type {NonNullable<typeof lines[0]>} */ (lines.at(-1))
  assert.equal(last.last, true)
  assert.equal(last.spread, 0)
  near(last.glyphs[0].x, 0, 1e-9)
  assert.ok(last.width < 100)
  for (let i = 1; i < last.glyphs.length; i++) near(last.glyphs[i].x - last.glyphs[i - 1].x, SIZE, 1e-9)
})

test('段落末に 1 字だけの行を残さず、最後の行は 2 字以上になる', () => {
  const eleven = '春夏秋冬東西南北上下左'
  const lines = para(eleven, { chars: 10 })
  assert.equal(lines.length, 2)
  assert.ok(inkCount(lines[1]) >= 2, `最後の行は ${lineText(lines[1])}`)
  assert.ok(lines[0].spread > 0, '前の行が 1 字を譲るので字間に配る')

  // 後ろに付く約物は数えない: 「あ。」は 1 字と数える
  const withStop = '春夏秋冬東西南北上下あ。'
  const l2 = para(withStop, { chars: 10 })
  const main = Array.from(lineText(/** @type {NonNullable<typeof l2[0]>} */ (l2.at(-1)))).filter((c) => !noBreakBefore(c)).length
  assert.ok(l2.length === 1 || main >= 2, `最後の行は ${lineText(/** @type {NonNullable<typeof l2[0]>} */ (l2.at(-1)))}`)

  // 行長が 8 字より短いと、1 字を譲らせる字間の開き（1em を数字ぶんの隙間で割る）が悪さ 3000 を超えるので、1 字の行のほうが軽い
  for (let chars = 8; chars <= 12; chars++) {
    const t = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'.slice(0, chars * 2 + 1)
    const ls = para(t, { chars })
    const tail = /** @type {NonNullable<typeof ls[0]>} */ (ls.at(-1))
    assert.ok(inkCount(tail) >= 2, `行長 ${chars}: 最後の行が ${lineText(tail)}`)
  }
})

test('欧文の語を行の途中で割らない', () => {
  const text = '日本語のtypographyとtypesettingについてのinternationalizationを説明します。Hello world and goodbye moon.'
  const words = text.match(/[A-Za-z]+/g) ?? []
  for (let chars = 12; chars <= 40; chars++) {
    const lines = para(text, { chars })
    const texts = lines.map(lineText)
    for (const w of words) assert.ok(texts.some((t) => t.includes(w)), `行長 ${chars}: ${w} が割れた`)
    for (const l of lines) assert.equal(l.forcedBreak, undefined)
  }
})

test('行長より長い語（URL）は最後の手段で字で割り、その行に forcedBreak の印を付ける', () => {
  const url = 'https://example.com/a/very/long/path/to/somewhere?x=1'
  const lines = para('見る ' + url + ' です', { chars: 8 })
  assert.ok(lines.length >= 3)
  assert.ok(lines.some((l) => l.forcedBreak === true))
  for (const l of lines) assert.equal(l.overfull, undefined, 'はみ出しではなく forcedBreak')
  const joined = lines.map((l) => lineText(l).replace(/ /g, '')).join('')
  assert.equal(joined, '見る' + url + 'です')
})

test('phrase の境目があれば、境目でない所では切らない', () => {
  const text = '吾輩は猫である名前はまだ無い'
  const bounds = [3, 5, 7, 10, 12]
  const phrase = (/** @type {string} */ t) => {
    assert.equal(t, text, 'phrase には段落の字をつなげて渡す')
    return bounds
  }
  const withPhrase = para(text, { chars: 8, align: 'left', phrase })
  assert.equal(inkCount(withPhrase[0]), 7, '8 字入るが、境目の 7 字で切る')
  assert.equal(withPhrase[1].start, 7)
  const without = para(text, { chars: 8, align: 'left' })
  assert.equal(inkCount(without[0]), 8, 'phrase が無ければ 8 字まで詰める')
})

test('line.start は段落の中でその行の最初の字が何字目か（0 から）', () => {
  const text = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'
  const lines = para(text, { chars: 10 })
  let at = 0
  for (const l of lines) {
    assert.equal(l.start, at)
    at += inkCount(l)
  }
  const sur = para('あ𠮷い', { chars: 10 })
  assert.deepEqual(sur[0].glyphs.map((g) => g.c), ['あ', '𠮷', 'い'], 'サロゲート対は 1 字')
})

test('ルビの付いた親字は 1 つの切れない塊で、行をまたがない', () => {
  const spans = [
    { text: 'あいう', font: /** @type {const} */ ('mincho'), size: SIZE },
    { text: '漢字', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: 'かんじ' },
    { text: 'えおかき', font: /** @type {const} */ ('mincho'), size: SIZE },
  ]
  for (let chars = 3; chars <= 9; chars++) {
    const lines = breakParagraph(spans, { measure: chars * SIZE, metrics, align: 'justify' })
    for (const l of lines) {
      const t = lineText(l)
      assert.equal(t.includes('漢'), t.includes('字'), `行長 ${chars}: 漢字が分かれた`)
      assert.equal(l.rubies.length, t.includes('漢') ? 1 : 0)
    }
  }
})

test('ルビは行の中の親字の位置に付き、グループルビが長い時は親字を開けて前後の字にかけない', () => {
  const spans = [
    { text: 'ああ', font: /** @type {const} */ ('mincho'), size: SIZE },
    { text: '東京', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: 'とうきょう', tag: 7 },
    { text: 'いい', font: /** @type {const} */ ('mincho'), size: SIZE },
  ]
  const [line] = breakParagraph(spans, { measure: 100, metrics, align: 'left' })
  assert.equal(line.rubies.length, 1)
  const r = line.rubies[0]
  near(r.baseX, 20, 1e-9)
  near(r.baseW, 25, 1e-9)
  assert.equal(r.size, 5)
  assert.equal(r.font, 'mincho')
  assert.equal(r.tag, 7)
  assert.deepEqual(r.glyphs.map((g) => g.c), ['と', 'う', 'き', 'ょ', 'う'])
  near(r.glyphs[0].x, 20, 1e-9, 'ルビは親字の塊の左端から')
  const g = line.glyphs
  near(g[2].x, 20 + 1.25, 1e-9, '東')
  near(g[3].x, 20 + 13.75, 1e-9, '京')
  near(g[4].x, 45, 1e-9, '次の字は塊の幅の分だけ後')
  assert.ok(g[2].x >= r.baseX && g[3].x + SIZE <= r.baseX + r.baseW, '親字は塊の中')
})

test('モノルビの塊も 1 つの切れない箱で、親字ごとのルビが付く', () => {
  const spans = [
    { text: '漢字', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: 'かん|じ' },
    { text: 'です', font: /** @type {const} */ ('mincho'), size: SIZE },
  ]
  const [line] = breakParagraph(spans, { measure: 100, metrics, align: 'left' })
  assert.deepEqual(line.rubies[0].glyphs.map((g) => g.c), ['か', 'ん', 'じ'])
  near(line.rubies[0].glyphs[2].x, 12.5, 1e-9)
})

test('2,000 字の段落を 50 ミリ秒以内に組む', () => {
  const base = '吾輩はここで「猫」と呼ばれる。名前はまだ無い、どこで生まれたかとんと見当がつかぬ。Appleのiphoneは、2007年に発売された！ ーーキャッチャーのミット、ちょっとしたショッピング。'
  let text = ''
  while (Array.from(text).length < 2000) text += base
  text = Array.from(text).slice(0, 2000).join('')
  const spans = [{ text, font: /** @type {const} */ ('mincho'), size: SIZE }]
  // 初回は関数の最適化前なので、小さい段落で一度流してから測る
  breakParagraph([{ text: base, font: 'mincho', size: SIZE }], { measure: 300, metrics, indent: 1 })
  const times = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    const lines = breakParagraph(spans, { measure: 300, metrics, indent: 1 })
    times.push(performance.now() - t0)
    assert.ok(lines.length > 50)
    assert.equal(lines.filter((l) => l.overfull).length, 0)
  }
  assert.ok(Math.min(...times) < 50, `最良 ${Math.min(...times).toFixed(1)} ミリ秒`)
})

test('左寄せ・中央・右寄せでは字間を伸ばさず、行の中身を寄せる', () => {
  const text = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'
  const left = para(text, { chars: 10, align: 'left' })
  for (const l of left) {
    assert.equal(l.spread, 0)
    near(l.glyphs[0].x, 0, 1e-9)
  }
  const center = para('春夏秋', { chars: 10, align: 'center' })
  near(center[0].glyphs[0].x, 35, 1e-9)
  const right = para('春夏秋', { chars: 10, align: 'right' })
  near(right[0].glyphs[0].x, 70, 1e-9)
  near(right[0].width, 100, 1e-9)
})

test('lastAlign が justify なら最後の行も揃える', () => {
  const text = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'
  const lines = para(text, { chars: 10, lastAlign: 'justify' })
  near(lines.at(-1)?.width ?? 0, 100, 1e-9)
})

test('欧文の空白は字として残り、行の途中では語間として伸びる', () => {
  const lines = para('Hello world and more words here', { chars: 12 })
  assert.ok(lines.length >= 2)
  const l0 = lines[0]
  assert.ok(lineText(l0).includes(' '))
  assert.ok(!lineText(l0).startsWith(' ') && !lineText(l0).endsWith(' '), '行の頭と末に空白は残さない')
  near(l0.width, 120, 1e-6)
  for (const l of lines) assert.equal(l.spread, 0, '字間は開けない')
})

test('どの切り方でも入らない塊は、はみ出しの印を付けて組む', () => {
  const spans = [{ text: '東京', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: 'とうきょうとうきょう' }]
  const lines = breakParagraph(spans, { measure: 30, metrics })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].overfull, true)
})

test('色・太字・タグ・リンクは字ごとに引き継ぐ', () => {
  const spans = [
    { text: 'あ', font: /** @type {const} */ ('mincho'), size: SIZE, color: '#111111' },
    { text: 'い', font: /** @type {const} */ ('minchoBold'), size: SIZE, bold: true, tag: 3 },
    { text: 'う', font: /** @type {const} */ ('mincho'), size: 12, link: 'https://example.com/' },
  ]
  const [line] = breakParagraph(spans, { measure: 100, metrics, align: 'left' })
  assert.equal(line.glyphs[0].color, '#111111')
  assert.equal(line.glyphs[1].bold, true)
  assert.equal(line.glyphs[1].tag, 3)
  assert.equal(line.glyphs[1].font, 'minchoBold')
  assert.equal(line.glyphs[2].link, 'https://example.com/')
  assert.equal(line.glyphs[2].size, 12)
})

test('空の段落は行を作らない', () => {
  assert.deepEqual(breakParagraph([], { measure: 100, metrics }), [])
  assert.deepEqual(breakParagraph([{ text: '', font: 'mincho', size: SIZE }], { measure: 100, metrics }), [])
  assert.deepEqual(breakParagraph([{ text: '   ', font: 'mincho', size: SIZE }], { measure: 100, metrics }), [])
})

test('和字と和字の間の改行は消え、和字と欧文の間の改行は空白になる', () => {
  const a = para('あい\nうえ', { chars: 20, align: 'left' })
  assert.equal(lineText(a[0]), 'あいうえ')
  const b = para('あい\nabc', { chars: 20, align: 'left' })
  assert.equal(lineText(b[0]), 'あい abc')
})

test('禁則の字が行長より長く続く並びは、はみ出さず禁則を破って切り、forcedBreak の印を付ける', () => {
  const text = 'あ' + 'ー'.repeat(25) + 'い'
  const lines = para(text, { chars: 10 })
  assert.ok(lines.length >= 3)
  for (const l of lines) assert.equal(l.overfull, undefined)
  assert.ok(lines.slice(0, -1).every((l) => l.forcedBreak === true))
  assert.equal(lines.reduce((s, l) => s + inkCount(l), 0), Array.from(text).length)

  const dots = para('あ' + '……'.repeat(15), { chars: 10 })
  for (const l of dots) assert.equal(l.overfull, undefined)
  assert.ok(dots.some((l) => l.forcedBreak === true))
})

test('字間を 0.5em 以上開けないと揃わない行は、揃えずに自然な幅のまま左に寄せる', () => {
  // 次の語（9.5em）が行に入らず、「ああ」だけの行が 8em 足りなくなる
  const lines = para('ああ abcdefghijklmnopqrs', { chars: 10 })
  assert.equal(lineText(lines[0]), 'ああ')
  assert.equal(lines[0].spread, 0)
  near(lines[0].width, 20, 1e-9)
  assert.equal(lines[0].overfull, undefined)
  assert.equal(lines[0].underfull, true, '揃っていない行は underfull の印')
  assert.equal(lines.at(-1)?.underfull, undefined, '最後の行は揃えないので印を付けない')
  const full = para('春夏秋冬東西南北上下左右前後内外大小多少長短高低', { chars: 10 })
  assert.ok(full.every((l) => l.underfull === undefined))
})

test('入力の spans を書き換えない', () => {
  const spans = [{ text: '「漢字」です。', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: undefined }]
  const before = JSON.stringify(spans)
  breakParagraph(spans, { measure: 50, metrics })
  assert.equal(JSON.stringify(spans), before)
})
