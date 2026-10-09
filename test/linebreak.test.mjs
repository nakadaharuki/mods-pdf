// @ts-check
import test from 'node:test'
import assert from 'node:assert/strict'
import { breakParagraph } from '../hooks/engine/linebreak.mjs'
import { classOf, halfSpace, noBreakAfter, noBreakBefore } from '../hooks/engine/jlreq.mjs'
import { hyphenPoints } from '../hooks/vendor/text.mjs'

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
 * @param {{ chars?: number, indent?: number, align?: 'justify'|'left'|'center'|'right', phrase?: (t: string) => number[], lastAlign?: 'justify'|'left'|'center'|'right', lang?: 'ja'|'en' }} [o]
 */
const para = (text, o = {}) =>
  breakParagraph([{ text, font: 'mincho', size: SIZE }], {
    measure: SIZE * (o.chars ?? 20),
    metrics,
    indent: o.indent ?? 0,
    align: o.align ?? 'justify',
    ...(o.phrase ? { phrase: o.phrase } : {}),
    ...(o.lastAlign ? { lastAlign: o.lastAlign } : {}),
    ...(o.lang ? { lang: o.lang } : {}),
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

test('行の途中の句点の後ろの二分は詰めない（JLReq 3.8.3）。同じ形の読点の後ろは詰めて追い込む', () => {
  // 11 字を行長 10.5 字に入れるには、行の途中の二分アキを 0.5 字ぶん詰めるしかない
  const comma = para('あいうえお、かきくけこ', { chars: 10.5 })
  assert.equal(comma.length, 1, '読点の後ろの二分を詰めて 1 行に追い込む')
  near(comma[0].width, 105, 1e-9)
  const stop = para('あいうえお。かきくけこ', { chars: 10.5 })
  assert.ok(stop.length > 1, '句点の後ろは詰められないので 1 行に入らない')
  const maru = stop[0].glyphs.find((g) => g.c === '。')
  const next = stop[0].glyphs[(maru ? stop[0].glyphs.indexOf(maru) : 0) + 1]
  assert.ok(maru && next && next.x - maru.x >= SIZE - 1e-9, '句点の後ろの二分アキは残る')
})

test('行の途中の句点の後ろは、どの行長でも 1 字分以上あく（始め括弧が続く時は二分）', () => {
  const texts = [
    '今日は晴れでした。明日は雨でしょう。週末は出かけます。来週は仕事です。再来週は休みです。',
    'そのとき、ぽつりと「ねえ、覚えてる？」と聞かれた。ええ、もちろん。あの夏の日の、ひぐらしの声、麦茶の氷。全部覚えている。',
    '春が来た。夏が来た。秋が来た。冬が来た。「また春が来た」。夏が来た。秋が来た。冬が来た。',
  ]
  let seen = 0
  for (const text of texts) {
    for (let chars = 6; chars <= 30; chars++) {
      for (const indent of [0, 1]) {
        for (const l of para(text, { chars, indent })) {
          for (let i = 0; i + 1 < l.glyphs.length; i++) {
            if (l.glyphs[i].c !== '。') continue
            seen++
            const open = '「『（〔［｛〈《【'.includes(l.glyphs[i + 1].c)
            const gap = l.glyphs[i + 1].x - l.glyphs[i].x
            assert.ok(gap >= (open ? SIZE / 2 : SIZE) - 1e-6, `行長 ${chars} 字下げ ${indent}: 「。${l.glyphs[i + 1].c}」の間が ${gap}pt に詰まった`)
          }
        }
      }
    }
  }
  assert.ok(seen > 500, `行の途中の句点を ${seen} 個しか見ていない`)
})

test('行末の句点の後ろの二分は詰めてよい: 字面の右端が行長にそろい、字間は動かない', () => {
  // 句点まで入れると箱の右端が 110pt で行長 105pt を超えるが、行末の二分アキを取れば字面の右端がちょうど 105pt
  const lines = para('あいうえおかきくけこ。ああ', { chars: 10.5 })
  assert.equal(lineText(lines[0]), 'あいうえおかきくけこ。')
  near(lines[0].width, 105, 1e-9)
  assert.equal(lines[0].spread, 0)
  assert.equal(lines[0].overfull, undefined)
})

test('行中の約物の空きを詰めて、1 字を行に追い込める', () => {
  const lines = para('あ、い、う、え、お、か', { chars: 10 })
  assert.equal(lines.length, 1)
  near(lines[0].width, 100, 1e-9, '詰めて行長ちょうど')
  assert.equal(lines[0].overfull, undefined)
  const xs = lines[0].glyphs.map((g) => g.x)
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], '字の順が逆転しない')
})

test('約物の空きを詰めて入る時は、1 字を次の行へ追い出して字間を伸ばさず、詰めて追い込む', () => {
  // 10 字目の後は」が続いて切れない。」まで入れると 105pt で、読点 2 つの空きを詰めれば 100pt に収まる
  const lines = para('あい、うえ、おかきく」けこさしすせそたちつ', { chars: 10 })
  assert.equal(lineText(lines[0]), 'あい、うえ、おかきく」')
  assert.equal(lines[0].spread, 0, '字間は伸ばさない')
  near(lines[0].width, 100, 1e-9)
  const [, , comma, u] = lines[0].glyphs
  assert.ok(u.x - comma.x < SIZE - 1e-6, '読点の後ろの空きを詰めた')
})

test('和欧間を伸ばして 1 字を追い出すより、読点と和欧間を詰めて追い込む（追込み優先）', () => {
  // 「abあいか、いabい」は自然幅 87.5pt で、和欧間を伸ばせば 90pt に揃う。次の「う」まで入れると 97.5pt で、詰めきって 90pt になる
  const lines = para('abあいか、いabいうき漢', { chars: 9 })
  assert.equal(lineText(lines[0]), 'abあいか、いabいう')
  assert.equal(lines[0].spread, 0)
  near(lines[0].width, 90, 1e-9)
  const g = lines[0].glyphs
  near(g[6].x - g[5].x, SIZE / 2, 1e-9, '読点の後ろの二分は詰めきる')
  assert.ok(g[2].x - g[1].x - SIZE / 2 < SIZE / 4, 'ab と あ の間の和欧間は四分より狭い')
})

test('伸ばす行では、約物と和字間隔の前後に字間を配らず、字間は和字どうしのあいだだけに入る', () => {
  // 欧文の語は割れないので第 1 行は 9 字で 1em 足りない。伸びる所は あ|い う|え え|お お|か か|き き|く の 6 つ
  const lines = para('あい、うえおかきくabcdefghijklmnop', { chars: 10 })
  const g = lines[0].glyphs
  assert.deepEqual(g.map((x) => x.c), Array.from('あい、うえおかきく'))
  near(g[2].x - g[1].x, SIZE, 1e-9, 'い と 、の間は伸ばさない')
  near(g[3].x - g[2].x, SIZE, 1e-9, '、と う の間は伸ばさない')
  const spread = SIZE / 6
  for (const k of [1, 4, 5, 6, 7]) near(g[k].x - g[k - 1].x, SIZE + spread, 1e-9, `${k} 字目の前の字間`)
  near(g[3].x - g[0].x, 3 * SIZE + spread, 1e-9, 'あ から う までは い の前の 1 つだけ伸びる')
  near(lines[0].width, 100, 1e-9, '右端が行長')
})

test('和字間の字間が一字の 1/4 を超える時だけ、約物の前後にも字間を配って右端を揃える', () => {
  // 第 1 行は 8 字で 2em 足りない。和字間の 5 つに配ると 0.4em で上限の 0.25em を超えるので、約物の前後も含めた 7 つに 2/7em ずつ
  const lines = para('あい、うえおかきabcdefghijklmnop', { chars: 10 })
  const g = lines[0].glyphs
  assert.deepEqual(g.map((x) => x.c), Array.from('あい、うえおかき'))
  const each = (2 * SIZE) / 7
  for (let k = 1; k < g.length; k++) near(g[k].x - g[k - 1].x, SIZE + each, 1e-9, `${k} 字目の前の字間（約物のそばも）`)
  near(lines[0].width, 100, 1e-9, '右端が行長')
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

/** ルビの試験で使う Span。ruby を渡せば親字 */
const rs = (/** @type {string} */ text, /** @type {string} */ [ruby, tag] = []) => ({
  text, font: /** @type {const} */ ('mincho'), size: SIZE, ...(ruby ? { ruby } : {}), ...(tag !== undefined ? { tag } : {}),
})

test('ルビは親字の塊の位置に付き、tag・書体・大きさを引き継ぐ', () => {
  const [line] = breakParagraph([rs('ああ'), rs('東京', ['とうきょう', 7]), rs('いい')], { measure: 100, metrics, align: 'left' })
  assert.equal(line.rubies.length, 1)
  const r = line.rubies[0]
  assert.equal(r.size, 5)
  assert.equal(r.font, 'mincho')
  assert.equal(r.tag, 7)
  assert.deepEqual(r.glyphs.map((g) => g.c), ['と', 'う', 'き', 'ょ', 'う'])
  near(r.glyphs[0].x, r.baseX, 1e-9, 'ルビは塊の左端から')
  near(r.baseW, 25, 1e-9, '塊の幅はルビの幅')
  const g = line.glyphs
  assert.ok(g[2].x >= r.baseX - 1e-9 && g[3].x + SIZE <= r.baseX + r.baseW + 1e-9, '親字は塊の中')
})

test('親字より長いグループルビは、前後が仮名なら両側に等しく掛かり、親字の字間を開けない（JLReq 3.3.8）', () => {
  const [line] = breakParagraph([rs('ああ'), rs('東京', ['とうきょう']), rs('いい')], { measure: 100, metrics, align: 'left' })
  const r = line.rubies[0]
  const g = line.glyphs
  // ルビの余り 5pt を前後に 2.5pt ずつ掛ける。親字は詰めて並び、前後の仮名は字送りの格子に乗ったまま
  near(r.baseX, 17.5, 1e-9, 'ルビは前の仮名の上へ 2.5pt')
  near(g[2].x, 20, 1e-9, '東')
  near(g[3].x, 30, 1e-9, '京は東の隣')
  near(g[4].x, 40, 1e-9, '次の仮名')
  near(r.baseX + r.baseW, 42.5, 1e-9, 'ルビの右端は次の仮名の上へ 2.5pt')
  near(line.width, 60, 1e-9)
})

test('前後が漢字・別のルビなら掛けず、親字の字間を均等に開けて塊をルビの幅にする', () => {
  const [a] = breakParagraph([rs('鉄'), rs('東京', ['とうきょう']), rs('船')], { measure: 100, metrics, align: 'left' })
  near(a.rubies[0].baseX, 10, 1e-9, '前の漢字の上に出ない')
  near(a.glyphs[1].x, 11.25, 1e-9)
  near(a.glyphs[2].x, 23.75, 1e-9)
  near(a.glyphs[3].x, 35, 1e-9, '後ろの漢字はルビの右端から')
  const [b] = breakParagraph([rs('錨', ['いかり']), rs('錨', ['いかり'])], { measure: 100, metrics, align: 'left' })
  near(b.rubies[1].baseX, b.rubies[0].baseX + b.rubies[0].baseW, 1e-9, 'ルビどうしも掛けない')
})

test('片側だけ仮名なら、その側へ余りを全部掛けて親字を詰める', () => {
  const [right] = breakParagraph([rs('鉄'), rs('錨', ['いかり']), rs('を')], { measure: 100, metrics, align: 'left' })
  assert.deepEqual(right.glyphs.map((g) => g.x), [0, 10, 20], '錨も「を」も字送りの格子に乗る')
  near(right.rubies[0].baseX, 10, 1e-9, '前の漢字には掛けない')
  near(right.rubies[0].baseX + right.rubies[0].baseW, 25, 1e-9, '「を」の上へ 5pt（ルビ文字 1 字分）')
  const [left] = breakParagraph([rs('鉄の'), rs('錨', ['いかり']), rs('船')], { measure: 100, metrics, align: 'left' })
  assert.deepEqual(left.glyphs.map((g) => g.x), [0, 10, 20, 30])
  near(left.rubies[0].baseX, 15, 1e-9, '前の「の」の上へ 5pt')
})

test('ルビが後ろの仮名・長音・小書きの仮名・分離禁止・中点・句読点・終わり括弧には掛かり、漢字・繰返し記号・欧文・区切り約物には掛からない', () => {
  // 掛かれば後ろの字は塊の左端 + 10（親字の右隣）、掛からなければ塊の右端（+ 15）か、欧文なら和欧間を足した位置
  for (const next of ['を', 'ヲ', 'ー', 'ぁ', '…', '・', '。', '、', '」']) {
    const [l] = breakParagraph([rs('鉄'), rs('錨', ['いかり']), rs(next)], { measure: 100, metrics, align: 'left' })
    near(l.glyphs[2].x - l.glyphs[1].x, 10, 1e-9, `${next} の上に掛かる`)
  }
  for (const next of ['船', '々', '！']) {
    const [l] = breakParagraph([rs('鉄'), rs('錨', ['いかり']), rs(next)], { measure: 100, metrics, align: 'left' })
    near(l.glyphs[2].x - l.glyphs[1].x, 12.5, 1e-9, `${next} の上には掛からない`)
  }
  const [a] = breakParagraph([rs('鉄'), rs('錨', ['いかり']), rs('a')], { measure: 100, metrics, align: 'left' })
  assert.equal(a.rubies[0].baseX + a.rubies[0].baseW <= a.glyphs[2].x, true, '欧文の上には掛からない')
})

test('ルビが前の仮名・長音・小書きの仮名・分離禁止・中点・読点・終わり括弧の後ろの二分アキには掛かり、漢字・欧文・始め括弧には掛からない', () => {
  for (const prev of ['の', 'ン', 'ー', 'っ', '…', '・', '、', '」']) {
    const [l] = breakParagraph([rs(prev), rs('錨', ['いかり']), rs('鉄')], { measure: 100, metrics, align: 'left' })
    near(l.glyphs[1].x - l.glyphs[0].x, 10, 1e-9, `${prev} の後ろに掛かる`)
  }
  for (const prev of ['船', '「']) {
    const [l] = breakParagraph([rs(prev), rs('錨', ['いかり']), rs('鉄')], { measure: 100, metrics, align: 'left' })
    near(l.glyphs[1].x - l.glyphs[0].x, 12.5, 1e-9, `${prev} の後ろには掛からない`)
  }
  const [a] = breakParagraph([rs('a'), rs('錨', ['いかり']), rs('鉄')], { measure: 100, metrics, align: 'left' })
  assert.equal(a.rubies[0].baseX >= a.glyphs[0].x + 5 - 1e-9, true, '欧文の上には掛からない')
})

test('ルビの前の読点・後ろの始め括弧のアキの上に掛かっても、親字は約物の字面から二分アキのまま', () => {
  const [a] = breakParagraph([rs('あ、'), rs('錨', ['いかり']), rs('鉄')], { measure: 100, metrics, align: 'left' })
  assert.deepEqual(a.glyphs.map((g) => g.x), [0, 10, 20, 30], '、の箱の右半分（二分アキ）の後に錨')
  near(a.rubies[0].baseX, 15, 1e-9, 'ルビは二分アキの上へ 5pt（右は漢字なので余りを全部左へ）')
  const [b] = breakParagraph([rs('錨', ['いかり']), rs('「あ」')], { measure: 100, metrics, align: 'left' })
  assert.deepEqual(b.glyphs.map((g) => g.x), [0, 10, 20, 30])
  near(b.rubies[0].baseX + b.rubies[0].baseW, 15, 1e-9, '「の前の二分アキの上へ 5pt')
})

test('切れた側には掛けない: 行頭ではルビの左端を行頭に、行末ではルビの右端を行末に揃え、親字をその分内側に置く', () => {
  // 「あいう」は 30pt、錨を足すと 42.5pt > 32pt なので錨の前で切れる
  const lines = breakParagraph([rs('あいう'), rs('錨', ['いかり']), rs('えおか')], { measure: 32, metrics, align: 'left' })
  assert.equal(lineText(lines[0]), 'あいう')
  const head = lines[1]
  assert.equal(head.glyphs[0].c, '錨')
  near(head.rubies[0].baseX, 0, 1e-9, 'ルビの左端が行頭')
  // 右の「え」には 2.5pt 掛かる。掛からない左の 2.5pt は親字の前後に半分ずつ
  near(head.glyphs[0].x, 1.25, 1e-9, '親字は左の余りの半分だけ内側')
  near(head.glyphs[1].x, 12.5, 1e-9, '次の仮名はルビの右端より 2.5pt 手前')

  // 行末: 錨が行の最後に来る切り方（「おかきく」の次の行に「けこ錨」は入らない幅）
  const ends = breakParagraph([rs('おかきくけこ'), rs('錨', ['いかり'])], { measure: 62, metrics, align: 'left' })
  const tail = ends.find((l) => l.rubies.length === 1)
  assert.ok(tail)
  near((tail?.rubies[0].baseX ?? 0) + (tail?.rubies[0].baseW ?? 0), tail?.width ?? 0, 1e-9, 'ルビの右端が行末')
})

test('仮名 1 字をはさんで両側にルビが来る時は、掛ける量を半分にして、ルビどうしが触れない', () => {
  const [l] = breakParagraph([rs('あ'), rs('錨', ['いかり']), rs('う'), rs('錨', ['いかり']), rs('え')], { measure: 100, metrics, align: 'left' })
  const [r1, r2] = l.rubies
  assert.ok(r2.baseX - (r1.baseX + r1.baseW) >= 5 - 1e-9, '2 つのルビの間にルビ文字 1 字分の空き')
  assert.deepEqual(l.glyphs.map((g) => g.x), [0, 10, 20, 30, 40], '字は格子のまま')
})

test('モノルビは親字 1 字ごとに別のルビが付き、ルビの長い字だけが前後の仮名に掛かる', () => {
  const [l] = breakParagraph([rs('ああ'), rs('東京', ['とう|きょう']), rs('いい')], { measure: 100, metrics, align: 'left' })
  assert.equal(l.rubies.length, 2, '東と京に 1 つずつ')
  const [to, kyo] = l.rubies
  assert.deepEqual(to.glyphs.map((g) => g.c), ['と', 'う'])
  assert.deepEqual(kyo.glyphs.map((g) => g.c), ['き', 'ょ', 'う'])
  // 東（ルビ 10pt = 親字）は持ち場が親字と同じで掛けられない。京（ルビ 15pt）は右の「い」へ 5pt
  near(to.baseX, 20, 1e-9, '東は左へも右へも掛からない')
  near(to.baseW, 10, 1e-9)
  near(kyo.baseX, 30, 1e-9)
  near(kyo.baseX + kyo.baseW, 45, 1e-9, '京の右端は次の仮名の上へ 5pt')
  assert.deepEqual(l.glyphs.map((g) => g.x), [0, 10, 20, 30, 40, 50], '親字も次の仮名も格子のまま')
})

test('ルビが掛かった行も、約物の空きを詰めて行長ぴったりに揃い、字が重ならず、禁則を破らず、漢字の上にルビが出ない', () => {
  // 親字の字には tag 9 を付けて、ルビの下の字とそれ以外の字を見分ける
  const rb = (/** @type {string} */ t, /** @type {string} */ ruby) => rs(t, [ruby, 9])
  const spans = [
    rs('その朝、'), rb('錨', 'いかり'), rs('は静かに、'), rb('鯨', 'くじら'), rs('は遠くで、'), rb('海', 'うみ'), rs('「'), rb('港', 'みなと'), rs('」と呼ばれる。'),
    rs('それでも、'), rb('錨', 'いかり'), rs('を下ろし、'), rb('鯨', 'くじら'), rs('を見送って、'), rb('東京', 'とうきょう'), rs('へ帰る。'),
    rs('「'), rb('鯨', 'くじら'), rs('」、'), rb('錨', 'いかり'), rs('、'), rb('海', 'うみ'), rs('「あ」。'),
  ]
  for (let chars = 8; chars <= 24; chars++) {
    const lines = breakParagraph(spans, { measure: chars * SIZE, metrics, indent: 1, align: 'justify' })
    for (const [i, l] of lines.entries()) {
      const where = `行長 ${chars} の ${i} 行目`
      assert.equal(l.overfull, undefined, `${where}: はみ出した`)
      if (!l.last && !l.underfull) near(l.width, chars * SIZE, 1e-6, `${where}: 右端`)
      for (let k = 1; k < l.glyphs.length; k++) assert.ok(l.glyphs[k].x > l.glyphs[k - 1].x - 1e-9, `${where}: 字の順が逆転した`)
      if (i > 0) assert.equal(noBreakBefore(l.glyphs[0].c), false, `${where}: 行頭に ${l.glyphs[0].c}`)
      if (!l.last) assert.equal(noBreakAfter(l.glyphs.at(-1)?.c ?? ''), false, `${where}: 行末に ${l.glyphs.at(-1)?.c}`)
      // 約物の空きの上に掛かっても、詰めた行で約物の字面（終わり括弧・句読点は箱の左半分、始め括弧は右半分）にルビが乗らない
      const runStarts = l.glyphs.flatMap((g, k) => (g.tag === 9 && (k === 0 || l.glyphs[k - 1].tag !== 9) ? [k] : []))
      assert.equal(runStarts.length, l.rubies.length, `${where}: 親字の塊の数とルビの数`)
      for (const [n, k] of runStarts.entries()) {
        const r = l.rubies[n]
        let e = k
        while (e + 1 < l.glyphs.length && l.glyphs[e + 1].tag === 9) e++
        const before = l.glyphs[k - 1]
        const after = l.glyphs[e + 1]
        if (before && [2, 6, 7].includes(classOf(before.c))) assert.ok(before.x + SIZE / 2 <= r.baseX + 1e-6, `${where}: ルビが ${before.c} の字面に乗った`)
        if (after && classOf(after.c) === 1) assert.ok(after.x + SIZE / 2 >= r.baseX + r.baseW - 1e-6, `${where}: ルビが ${after.c} の字面に乗った`)
      }
      for (const r of l.rubies) {
        for (const g of l.glyphs) {
          if (classOf(g.c) !== 19) continue
          if (g.tag === 9) continue
          const overlap = Math.min(g.x + SIZE, r.baseX + r.baseW) - Math.max(g.x, r.baseX)
          assert.ok(overlap < 1e-6, `${where}: ルビが漢字 ${g.c} に ${overlap}pt 掛かった`)
        }
      }
    }
  }
})

test('モノルビの読みは親字の持ち場の中で中央に置かれる', () => {
  const spans = [
    { text: '漢字', font: /** @type {const} */ ('mincho'), size: SIZE, ruby: 'かん|じ' },
    { text: 'です', font: /** @type {const} */ ('mincho'), size: SIZE },
  ]
  const [line] = breakParagraph(spans, { measure: 100, metrics, align: 'left' })
  assert.deepEqual(line.rubies.map((r) => r.glyphs.map((g) => g.c)), [['か', 'ん'], ['じ']], '読みは親字ごとに分かれる')
  near(line.rubies[1].glyphs[0].x, 12.5, 1e-9, '1 字の読みは字の箱 10pt の中央（5pt の字を 2.5pt 内側）')
})

test('モノルビの親字どうしの間では行を分けられるが、グループルビの親字は分けない', () => {
  const mono = [rs('あいう'), rs('漢字', ['かん|じ']), rs('えおかき')]
  const group = [rs('あいう'), rs('漢字', ['かんじ']), rs('えおかき')]
  let monoSplit = 0
  for (let chars = 3; chars <= 9; chars++) {
    for (const [name, spans] of [['モノ', mono], ['グループ', group]]) {
      const lines = breakParagraph(spans, { measure: chars * SIZE, metrics, align: 'justify' })
      for (const l of lines) {
        const t = lineText(l)
        const split = t.includes('漢') !== t.includes('字')
        if (name === 'グループ') assert.equal(split, false, `行長 ${chars}: グループルビの漢字が分かれた`)
        else if (split) monoSplit++
        // 親字 1 字につきルビは 1 つ（モノルビ）・塊に 1 つ（グループ）
        const parents = Array.from(t).filter((c) => c === '漢' || c === '字').length
        assert.equal(l.rubies.length, name === 'モノ' ? parents : Math.min(1, parents), `行長 ${chars} ${name}: ルビの数`)
      }
    }
  }
  assert.ok(monoSplit > 0, 'モノルビは親字の間で分けて詰められる行長がある')
})

test('モノルビの親字の間にも字間が配られ、ルビはそれぞれの親字に付いてくる', () => {
  // 「は行頭に置けるが行末には置けないので、第 1 行は 9 字で 1em 足りない
  const spans = [rs('あいうえおかき'), rs('漢字', ['かん|じ']), rs('「こさしすせそ')]
  const [l] = breakParagraph(spans, { measure: 100, metrics, align: 'justify' })
  assert.equal(lineText(l), 'あいうえおかき漢字')
  const kan = l.glyphs[7]
  const ji = l.glyphs[8]
  assert.ok(ji.x - kan.x > SIZE + 1e-6, '漢と字の間にも字間が入る')
  near(l.width, 100, 1e-9, '右端が行長')
  near(l.rubies[0].baseX, kan.x, 1e-9, '「かん」は漢に付く')
  near(l.rubies[1].baseX, ji.x, 1e-9, '「じ」は字に付く')
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

// 追い込みを追い出しより優先する（JLReq 3.8.2: 字間を詰めて入るなら、字間を開けない）
const KAN = '春夏秋冬東西南北上下左右前後内外大小多少長短高低'
const kanji = (/** @type {number} */ n, k = 0) => Array.from({ length: n }, (_, i) => KAN[(i + k) % KAN.length]).join('')

test('詰めで入る行は字間を開けず、行中の読点の空きを詰めて、行頭に来られない句点を追い込む', () => {
  // 行長 30 字。31 字目の「。」は行頭に来られない。30 字で切ると 1em 足りず、29 字で切って字間を 1/28em ずつ開ける手もあるが、
  // 行中の「、」の後ろの二分アキを詰めて「。」まで入れる（詰める所がある）
  const lines = para(kanji(14) + '、' + kanji(15, 3) + '。' + kanji(40, 7), { chars: 30 })
  const first = lines[0]
  assert.equal(lineText(first).endsWith('。'), true, `1 行目: ${lineText(first)}`)
  assert.equal(first.spread, 0, '字間は開けない')
  near(first.width, 300, 1e-6)
  assert.equal(first.underfull, undefined)
})

test('詰める所が無い行だけ字間を開ける', () => {
  // 同じ形で行中に約物が無い。「。」まで入れるには 0.5em 詰めたいが詰める所が無いので、29 字で切って字間を開ける
  const lines = para(kanji(30) + '。' + kanji(40, 7), { chars: 30 })
  const first = lines[0]
  assert.equal(inkCount(first), 29)
  assert.ok(first.spread > 0, '詰められないので字間を開ける')
  near(first.width, 300, 1e-6)
})

// 原稿の半角空白が和字と欧字の間にある時は和欧間にする
test('和字と欧字の間の半角空白は和欧間（四分）の幅になり、空白の字は残る', () => {
  const a = para('漢 abc', { chars: 50, align: 'left' })[0].glyphs
  assert.deepEqual(a.map((g) => g.c), ['漢', ' ', 'a', 'b', 'c'], '空白の字は残る')
  near(a[2].x, 12.5, 1e-9, '漢の後ろは 1em + 四分')
  const b = para('abc 漢', { chars: 50, align: 'left' })[0].glyphs
  assert.deepEqual(b.map((g) => g.c), ['a', 'b', 'c', ' ', '漢'])
  near(b[4].x, 15 + 2.5, 1e-9, '欧字の後ろも四分')
  const same = para('漢a', { chars: 50, align: 'left' })[0].glyphs
  near(same[1].x, a[2].x, 1e-9, '空白を書いても書かなくても同じ幅')
  const r = breakParagraph([{ text: '漢', font: 'mincho', size: SIZE, ruby: 'かん' }, { text: ' abc', font: 'mincho', size: SIZE }], { measure: 500, metrics, align: 'left' })[0].glyphs
  near(r.find((g) => g.c === 'a')?.x ?? 0, 12.5, 1e-9, 'ルビの親字の後ろも四分')
})

test('欧字と欧字の間の空白は語間のまま、約物と欧字の間の空白は空白の幅のまま', () => {
  const w = para('abc def', { chars: 50, align: 'left' })[0].glyphs
  near(w[4].x, 15 + 5, 1e-9, '語間は書体の空白の幅（この試験の書体では 0.5em）')
  const p = para('。 abc', { chars: 50, align: 'left' })[0].glyphs
  near(p[2].x, 10 + 5, 1e-9, '句点と欧字の間は空白の幅')
})

test('和字と欧字の間の空白で、行を分けてよいのは空白があった時と同じ。行の頭と末に空白は残さない', () => {
  const lines = para('あいうえ abc', { chars: 4 })
  assert.deepEqual(lines.map(lineText), ['あいうえ', 'abc'])
})

test('和欧間になった空白は、縮める時は八分まで、伸ばす時は二分までを字間より先に使う', () => {
  const one = (/** @type {number} */ measure) =>
    breakParagraph([{ text: 'あ a い', font: 'mincho', size: SIZE }], { measure, metrics, align: 'justify', lastAlign: 'justify' })[0]
  // 自然な幅は 10 + 2.5 + 5 + 2.5 + 10 = 30
  const shrunk = one(28.75)
  near(shrunk.glyphs.find((g) => g.c === 'a')?.x ?? 0, 10 + 1.875, 1e-9, '2 つの和欧間が 0.625pt ずつ縮む')
  assert.equal(shrunk.spread, 0)
  const stretched = one(33.75)
  near(stretched.glyphs.find((g) => g.c === 'a')?.x ?? 0, 10 + 4.375, 1e-9, '2 つの和欧間が 1.875pt ずつ伸びる')
  assert.equal(stretched.spread, 0, '字間は開けない')
  near(stretched.width, 33.75, 1e-9)
  const limit = one(35)
  near(limit.glyphs.find((g) => g.c === 'a')?.x ?? 0, 10 + 5, 1e-9, '二分（5pt）まで伸びる')
  assert.equal(limit.spread, 0)
})

test('詰める時は欧文の語間を先に縮め、足りない分だけ読点の空き・和欧間に回す（JLReq 3.8.3）', () => {
  const one = (/** @type {number} */ measure) =>
    breakParagraph([{ text: 'あ、いab cdう', font: 'mincho', size: SIZE }], { measure, metrics, align: 'justify', lastAlign: 'justify' })[0]
  const x = (/** @type {ReturnType<typeof one>} */ l, /** @type {string} */ c) => l.glyphs.find((g) => g.c === c)?.x ?? NaN
  // 自然な幅は 10+10+10 + 和欧間 2.5 + 10 + 語間 5 + 10 + 和欧間 2.5 + 10 = 70（試験の書体の空白は 0.5em）。語間は 1pt まで縮む
  const small = one(69.5)
  near(x(small, 'い') - x(small, '、'), SIZE, 1e-9, '読点の後ろの空きは詰めない')
  near(x(small, 'a') - x(small, 'い'), SIZE + 2.5, 1e-9, '和欧間も詰めない')
  near(x(small, 'c') - x(small, 'b'), 5 + 4.5, 1e-9, '語間が 0.5pt 縮む')
  const large = one(68)
  near(x(large, 'c') - x(large, 'b'), 5 + 4, 1e-9, '語間は 1pt の限りまで縮む')
  assert.ok(x(large, 'い') - x(large, '、') < SIZE - 1e-6, '残りは読点の後ろの空きから')
  assert.equal(large.spread, 0)
})

test('伸ばす時は欧文の語間を先に伸ばし、足りない分だけ和欧間に回す（JLReq 3.8.4）', () => {
  const one = (/** @type {number} */ measure) =>
    breakParagraph([{ text: 'あab cdう', font: 'mincho', size: SIZE }], { measure, metrics, align: 'justify', lastAlign: 'justify' })[0]
  const x = (/** @type {ReturnType<typeof one>} */ l, /** @type {string} */ c) => l.glyphs.find((g) => g.c === c)?.x ?? NaN
  // 自然な幅は 10 + 2.5 + 10 + 5 + 10 + 2.5 + 10 = 50。語間は 2.5pt まで伸びる
  const small = one(51.5)
  near(x(small, 'a') - x(small, 'あ'), SIZE + 2.5, 1e-9, '和欧間は伸ばさない')
  near(x(small, 'c') - x(small, 'b'), 5 + 5 + 1.5, 1e-9, '語間が 1.5pt 伸びる')
  const large = one(54.5)
  near(x(large, 'c') - x(large, 'b'), 5 + 5 + 2.5, 1e-9, '語間は 2.5pt の限りまで伸びる')
  near(x(large, 'a') - x(large, 'あ'), SIZE + 2.5 + 2 / 2, 1e-9, '残りの 2pt は 2 つの和欧間に 1pt ずつ')
  assert.equal(large.spread, 0, '字間は開けない')
})

// ---- 英語のハイフン（lang: 'en'） ----

/** 英語の見本。1 語が 11〜15 字で、行長 30 字（15em）では語を割らないと行が揃わない */
const EN_TEXT = 'the in the development responsibility with was by environmental the approximately good representative to make was environmental conversation for approximately be a be'

/**
 * 行を語に戻す: ハイフンで終わる行は - を外して次の行の頭につなぎ、ほかは空白でつなぐ
 * @param {ReturnType<typeof para>} lines
 */
const rejoin = (lines) =>
  lines.reduce((acc, l, i) => {
    const t = lineText(l)
    const joiner = i === 0 ? '' : lines[i - 1].hyphenated ? '' : ' '
    return acc + joiner + (l.hyphenated ? t.slice(0, -1) : t)
  }, '')

test('en では長い語をハイフンで割り、行末にハイフンを置いて、その幅まで入れて行長にそろえる', () => {
  const lines = para(EN_TEXT, { chars: 30, lang: 'en' })
  assert.deepEqual(lines.map((l) => !!l.hyphenated), [true, false, false])
  assert.equal(lineText(lines[0]).endsWith('environ-'), true, lineText(lines[0]))
  assert.equal(rejoin(lines), EN_TEXT, '割った語をつなぎ直すと元の文になる（字が落ちも増えもしない）')
  assert.equal(lines[0].overfull, undefined)
  near(lines[0].width, 300, 1e-6, 'ハイフンまで含めて右端が行長にそろう')
  const hy = lines[0].glyphs.at(-1)
  assert.ok(hy)
  near((hy?.x ?? 0) + SIZE / 2, lines[0].width, 1e-6, 'ハイフンの字は行の右端（幅 0.5em）')
})

test('ハイフンの字は割った語の最後の字と同じ書体・大きさ・色・tag を持つ', () => {
  const lines = breakParagraph(
    [{ text: 'the in the development responsibility with was by environmental the approximately good', font: 'sansBold', size: SIZE, color: '#123456', tag: 7, bold: true }],
    { measure: SIZE * 30, metrics, align: 'justify', lang: 'en' },
  )
  const first = lines[0]
  assert.equal(first.hyphenated, true)
  const hy = first.glyphs.at(-1)
  const letter = first.glyphs.at(-2)
  assert.equal(hy?.c, '-')
  assert.deepEqual(
    { font: hy?.font, size: hy?.size, color: hy?.color, tag: hy?.tag, bold: hy?.bold },
    { font: letter?.font, size: letter?.size, color: letter?.color, tag: letter?.tag, bold: letter?.bold },
  )
})

test('ja（既定も明示も）では英単語を割らない: ハイフンの字も hyphenated の印も出ない', () => {
  for (const o of [{}, { lang: /** @type {const} */ ('ja') }]) {
    const lines = para(EN_TEXT, { chars: 30, ...o })
    for (const l of lines) {
      assert.equal(l.hyphenated, undefined)
      assert.equal(l.glyphs.some((g) => g.c === '-'), false)
    }
    for (const w of EN_TEXT.split(' ')) assert.ok(lines.some((l) => lineText(l).split(' ').includes(w)), `語 ${w} が割れた`)
  }
})

test('割る語は小文字の英字だけの語: 大文字で始まる語・大文字が混ざる語・数字や記号が混ざる語・URL は割らない', () => {
  // 5 字の語（割れない）を n 個並べた後ろに置いて、語が行末に来る位置を 0〜13 個ずらす。語間だけでは揃えきれない行ができ、割れる語は割れる
  const sweep = (/** @type {string} */ word) =>
    Array.from({ length: 14 }, (_, n) => para(`${'abcde '.repeat(n)}${word} ${'abcde '.repeat(3)}end`, { chars: 20, lang: 'en' }).some((l) => l.hyphenated))
  assert.ok(sweep('environmental').some(Boolean), '対照: 小文字の英字だけの語は、位置によって割れる')
  const kept = ['Environmental', 'ENVIRONMENTAL', 'iPhoneenvironmental', 'environmental2024', 'environ-mental', 'environmental/representative', "environmental's", 'https://example.org/environmental', 'v1.2.3-environmental']
  for (const word of kept) assert.equal(sweep(word).some(Boolean), false, `${word} が割れた`)
})

test('語の前後の約物（括弧・コンマ・ピリオド）は割る語の芯に入れず、約物ごと前後の断片に付く', () => {
  let brackets = 0
  let periods = 0
  for (let n = 0; n < 14; n++) {
    const a = `${'abcde '.repeat(n)}(environmental), ${'abcde '.repeat(3)}end`
    const b = `${'abcde '.repeat(n)}environmental. ${'abcde '.repeat(3)}end`
    const la = para(a, { chars: 20, lang: 'en' })
    const lb = para(b, { chars: 20, lang: 'en' })
    assert.equal(rejoin(la), a)
    assert.equal(rejoin(lb), b)
    for (const l of la) if (l.hyphenated && lineText(l).includes('(')) {
      brackets++
      assert.match(lineText(l), /\([a-z]{2,}-$/, '始め括弧は語の頭の断片に付く')
    }
    for (const l of lb) if (l.hyphenated) periods++
  }
  assert.ok(brackets > 0 && periods > 0, '約物が付いた語も割れる')
})

test('2 行続けてハイフンで終わる切り方を避ける（TeX の doublehyphendemerits）', () => {
  // 罰が無いと「im- / responsi-」のように 2 行続けて割る組みを選ぶ見本
  const text = 'are that organization are administration be organization good that development with implementation development are and responsibility international'
  const lines = para(text, { chars: 21, lang: 'en' })
  const flags = lines.map((l) => !!l.hyphenated)
  assert.equal(flags.filter(Boolean).length, 1)
  for (let i = 1; i < flags.length; i++) assert.equal(flags[i] && flags[i - 1], false, `${i} 行目と前の行が続けてハイフンで終わる`)
  assert.equal(rejoin(lines), text)
})

test('最後から 2 行目をハイフンで終えない（TeX の finalhyphendemerits）', () => {
  // 罰が無いと「imple- / mentation are」のように、最後の行の前の行を割る組みを選ぶ見本
  const text = 'and was conversation with in on and responsibility and for a by approximately time was representative for implementation implementation are'
  const lines = para(text, { chars: 31, lang: 'en' })
  assert.equal(lines.length, 3)
  assert.equal(lines.at(-2)?.hyphenated, undefined)
  assert.equal(rejoin(lines), text)
})

test('割れる語でも割らずに収まる行は、en でも ja と字の位置が 1 字も変わらない', () => {
  const text = 'international organization representative'
  const en = para(text, { chars: 60, lang: 'en' })
  const ja = para(text, { chars: 60 })
  assert.equal(en.length, 1)
  assert.deepEqual(en.map((l) => l.glyphs.map((g) => [g.c, g.x])), ja.map((l) => l.glyphs.map((g) => [g.c, g.x])))
  assert.deepEqual(en.map((l) => l.width), ja.map((l) => l.width))
})

test('割った語の後ろの断片は、元の語の並びから左端を引いた位置に字が並ぶ（字送りは語の中と同じ）', () => {
  // fake の run は 1 字 0.5em。断片 mental の字送りも 0.5em のまま
  const lines = para(EN_TEXT, { chars: 30, lang: 'en' })
  const g = lines[1].glyphs
  const start = g.findIndex((x) => x.c === 'm')
  near(g[start + 1].x - g[start].x, SIZE / 2, 1e-6, '断片 mental の字送り')
  assert.equal(g.slice(0, 6).map((x) => x.c).join(''), 'mental')
})

test('hyphenPoints: 左 2 字・右 3 字を残し、TeX の例外の語（present・project）は割らず、associate は例外のとおり割る', () => {
  for (const w of ['international', 'internationalization', 'representative', 'responsibility', 'approximately', 'extraordinary']) {
    const pts = hyphenPoints(w)
    assert.ok(pts.length > 0, `${w} に切り目がある`)
    for (const p of pts) assert.ok(p >= 2 && p <= w.length - 3, `${w}: 位置 ${p} は左 2 字・右 3 字の外`)
    assert.deepEqual(pts, [...pts].sort((a, b) => a - b))
  }
  assert.deepEqual(hyphenPoints('present'), [])
  assert.deepEqual(hyphenPoints('projects'), [])
  assert.deepEqual(hyphenPoints('associate'), [2, 4])
  assert.deepEqual(hyphenPoints('Associates'), [2, 4], '大文字小文字は区別しない')
  assert.deepEqual(hyphenPoints('recognizance'), [2, 5, 7])
  assert.deepEqual(hyphenPoints('table'), [2])
})

test('hyphenPoints: 英字以外が混ざる語・短すぎる語は割らない', () => {
  for (const w of ['', 'a', 'it', 'co-operate', 'environment2', 'café', 'https://example.org', "don't"]) assert.deepEqual(hyphenPoints(w), [], w)
})
