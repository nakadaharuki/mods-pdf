// 版面と色の試験（書体を読まない・速い）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAPERS, DEFAULT_SIZES, makeTheme, lookPal } from '../hooks/engine/theme.mjs'

const EPS = 1e-6
const mm = (v) => (v * 72) / 25.4
const NAMES = Object.keys(PAPERS)
const CASES = NAMES.flatMap((paper) => [false, true].map((landscape) => ({ paper, landscape })))

/** WCAG の相対輝度とコントラスト比 */
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('5 つの紙（wide を含む）のどれでも行長が字の大きさの整数倍で、左右の余白が等しく、15mm 以上', () => {
  for (const { paper, landscape } of CASES) {
    const t = makeTheme({ paper, landscape })
    const label = `${paper} ${landscape ? '横' : '縦'}`
    assert.ok(Number.isInteger(t.chars), label)
    assert.ok(Math.abs(t.measure - t.size * t.chars) < EPS, label)
    assert.equal(t.left, t.right, label)
    assert.ok(t.left >= mm(15) - EPS, `${label} 左 ${t.left}`)
    assert.ok(Math.abs(t.left + t.measure + t.right - t.page.width) < EPS, label)
    // 1 字ぶん足したら最小の余白を割る = 詰められるだけ詰めた字数
    assert.ok((t.chars + 1) * t.size > t.page.width - 2 * mm(15) - EPS, label)
  }
})

test('行の数 x 行送り + 上下の余白 = 紙の高さ・上は 18mm 以上・下は 20mm 以上', () => {
  for (const { paper, landscape } of CASES) {
    const t = makeTheme({ paper, landscape })
    const label = `${paper} ${landscape ? '横' : '縦'}`
    assert.ok(Number.isInteger(t.lines), label)
    assert.ok(Math.abs(t.lines * t.lineGap + t.top + t.bottom - t.page.height) < EPS, label)
    assert.ok(t.top >= mm(18) - EPS, label)
    assert.ok(t.bottom >= mm(20) - EPS, label)
    assert.ok(t.lines > 5, label)
    // 1 行足したら最小の余白を割る
    assert.ok((t.lines + 1) * t.lineGap > t.page.height - mm(18) - mm(20) - EPS, label)
  }
})

test('行送りは字の大きさの 1.75 倍で、小数に丸めない', () => {
  const t = makeTheme({ size: 9.37 })
  assert.equal(t.lineGap, 9.37 * 1.75)
})

test('縦横を替えると紙の幅と高さが入れ替わる', () => {
  const p = makeTheme({ paper: 'A4' })
  const l = makeTheme({ paper: 'A4', landscape: true })
  assert.equal(p.page.width, 595.28)
  assert.equal(p.page.height, 841.89)
  assert.equal(l.page.width, 841.89)
  assert.equal(l.page.height, 595.28)
  assert.equal(l.landscape, true)
})

test('本文の大きさの既定は A4 9.5・A5 9・B5 9.5・Letter 9.5・wide 9.5', () => {
  assert.deepEqual(DEFAULT_SIZES, { A4: 9.5, A5: 9, B5: 9.5, Letter: 9.5, wide: 9.5 })
  for (const [paper, size] of Object.entries(DEFAULT_SIZES)) assert.equal(makeTheme({ paper }).size, size, paper)
})

test('A4 縦の既定は 1 行 53 字・1 頁 44 行', () => {
  const t = makeTheme({})
  assert.equal(t.chars, 53)
  assert.equal(t.lines, 44)
})

test('size は 8〜14 に収める（はみ出したら端に寄せ、数でなければ既定）', () => {
  assert.equal(makeTheme({ size: 3 }).size, 8)
  assert.equal(makeTheme({ size: 40 }).size, 14)
  assert.equal(makeTheme({ size: 11 }).size, 11)
  assert.equal(makeTheme({ size: Number.NaN }).size, 9.5)
  assert.equal(makeTheme({ size: undefined, paper: 'A5' }).size, 9)
  assert.equal(makeTheme({ size: /** @type {any} */ ('12') }).size, 9.5)
})

test('大きさを変えても行長は整数倍・格子の不変条件は崩れない', () => {
  for (const size of [8, 8.7, 9.5, 10.5, 12, 13.3, 14]) {
    for (const { paper, landscape } of CASES) {
      const t = makeTheme({ paper, landscape, size })
      assert.ok(Math.abs(t.measure - t.size * t.chars) < EPS)
      assert.ok(Math.abs(t.lines * t.lineGap + t.top + t.bottom - t.page.height) < EPS)
      assert.ok(t.left >= mm(15) - EPS && t.top >= mm(18) - EPS && t.bottom >= mm(20) - EPS)
    }
  }
})

test('基線は行の箱の中で字を上下の真ん中に置いた位置（字の箱の上から 0.88 x size）', () => {
  const t = makeTheme({})
  assert.ok(Math.abs(t.baseline(0) - (t.top + (t.lineGap - t.size) / 2 + 0.88 * t.size)) < EPS)
  assert.ok(Math.abs(t.baseline(3) - t.baseline(0) - 3 * t.lineGap) < EPS)
})

test('最初と最後の行の基線は版面の中にある', () => {
  for (const { paper, landscape } of CASES) {
    const t = makeTheme({ paper, landscape })
    const label = `${paper} ${landscape ? '横' : '縦'}`
    assert.ok(t.baseline(0) > t.top, label)
    assert.ok(t.baseline(t.lines - 1) < t.page.height - t.bottom, label)
    // 最後の行の字の下端（基線 + 下がり 0.12 size）も版面の中
    assert.ok(t.baseline(t.lines - 1) + 0.12 * t.size <= t.page.height - t.bottom + EPS, label)
  }
})

test('足の基線は下の余白の中・紙の下端より上にあり、罫はその上', () => {
  for (const { paper, landscape } of CASES) {
    const t = makeTheme({ paper, landscape })
    const label = `${paper} ${landscape ? '横' : '縦'}`
    assert.equal(t.footY, t.foot.y)
    assert.ok(t.footY > t.page.height - t.bottom, `${label} 版面にかぶる`)
    assert.ok(t.footY < t.page.height - 8, `${label} 紙の下端に近すぎる`)
    assert.ok(t.foot.ruleY < t.footY - t.foot.size + 1, `${label} 罫が足の字の上`)
    assert.ok(t.foot.ruleY > t.page.height - t.bottom, `${label} 罫が版面の下`)
    assert.equal(t.foot.size, 8)
    assert.equal(t.foot.ruleW, 0.5)
  }
})

test('書体の割り当て: 明朝の本文は mincho、ゴシックの本文は sans、見出しはどちらも明朝の太字', () => {
  const m = makeTheme({})
  assert.deepEqual(m.fonts, { body: 'mincho', bodyBold: 'minchoBold', head: 'minchoBold', gothic: 'sans', gothicBold: 'sansBold' })
  const g = makeTheme({ body: 'gothic' })
  assert.deepEqual(g.fonts, { body: 'sans', bodyBold: 'sansBold', head: 'minchoBold', gothic: 'sans', gothicBold: 'sansBold' })
})

test('見出し: h1 15pt・罫 0.8pt、h2 13pt・罫 0.6pt、h3 10.5pt・罫なし、どれも明朝の太字', () => {
  const t = makeTheme({})
  assert.deepEqual([t.head.h1.size, t.head.h1.rule, t.head.h1.font], [15, 0.8, 'minchoBold'])
  assert.deepEqual([t.head.h2.size, t.head.h2.rule, t.head.h2.font], [13, 0.6, 'minchoBold'])
  assert.deepEqual([t.head.h3.size, t.head.h3.rule, t.head.h3.font], [10.5, 0, 'minchoBold'])
})

test('見出しの上下の空きは段ごとに theme の値（行の整数）で決まる: 上は上の段ほど広く、下は 0（見出しは直後の本文に付ける）', () => {
  for (const paper of ['A4', 'A5', 'B5', 'Letter']) {
    const t = makeTheme({ paper })
    const { h1, h2, h3 } = t.head
    for (const h of [h1, h2, h3]) {
      assert.ok(Number.isInteger(h.above) && h.above >= 0, '上の空きは行の整数')
      assert.ok(Number.isInteger(h.below) && h.below >= 0, '下の空きは行の整数')
    }
    assert.deepEqual([h1.above, h2.above, h3.above], [2, 1, 1])
    assert.deepEqual([h1.below, h2.below, h3.below], [0, 0, 0])
    assert.ok(h1.above >= h2.above && h2.above >= h3.above, '上の空きは上の段ほど広い')
    assert.ok(h3.above >= 1, 'h3 も前の段落に詰めない')
  }
})

test('h1 は題名の塊（18pt・罫 1.4pt）より小さく、罫も細い（題名の直下に来ても題名が 2 つ並んで見えない）', () => {
  const t = makeTheme({})
  assert.deepEqual([t.title.size, t.title.metaSize, t.title.rule], [18, 9, 1.4])
  assert.ok(t.head.h1.size < t.title.size)
  assert.ok(t.head.h1.rule < t.title.rule)
  assert.ok(t.head.h1.size > t.head.h2.size && t.head.h2.size > t.head.h3.size, '段が下がるほど小さい')
})

test('本文が 9.5pt 以下なら見出し・題名は据え置き（scale 1）、それより大きければ同じ比で大きくなる', () => {
  for (const size of [8, 9, 9.5]) {
    const t = makeTheme({ size })
    assert.equal(t.scale, 1, `本文 ${size}pt`)
    assert.deepEqual([t.head.h1.size, t.head.h2.size, t.head.h3.size, t.title.size], [15, 13, 10.5, 18], `本文 ${size}pt`)
  }
  for (const size of [11, 12.5, 14]) {
    const t = makeTheme({ size })
    assert.ok(Math.abs(t.scale - size / 9.5) < EPS, `本文 ${size}pt`)
    assert.ok(Math.abs(t.head.h1.size - 15 * t.scale) < 0.05)
    assert.ok(Math.abs(t.head.h3.size - 10.5 * t.scale) < 0.05)
  }
})

test('どの本文の大きさでも、題名 > h1 > h2 > h3 > 本文 で、段の違いが本文の 1.1 倍以上ある', () => {
  for (const size of [8, 9, 9.5, 11, 12.5, 14]) {
    const t = makeTheme({ size })
    const sizes = [t.title.size, t.head.h1.size, t.head.h2.size, t.head.h3.size, t.size]
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i - 1] > sizes[i], `本文 ${size}pt: ${sizes.join(' > ')}`)
    assert.ok(t.head.h3.size >= t.size * 1.1 - 0.05, `本文 ${size}pt の h3 ${t.head.h3.size}`)
  }
})

test('mono の色は設計書の値そのまま', () => {
  const c = makeTheme({ theme: 'mono' }).colors
  assert.equal(c.ink, '#111111')
  assert.equal(c.sub, '#4A4A4A')
  assert.equal(c.rule, '#CCCCC9')
  assert.equal(c.tint, '#F1F0ED')
  assert.equal(c.up, '#176639')
  assert.equal(c.down, '#A31F1C')
  assert.equal(c.paper, '#FFFFFF')
})

test('koma と mergeble の色は設計書の値そのまま', () => {
  const k = makeTheme({ theme: 'koma' }).colors
  assert.deepEqual([k.ink, k.accent, k.sub, k.rule, k.tint], ['#16233A', '#1F4FA8', '#47597A', '#C6D2E4', '#F2F6FC'])
  const g = makeTheme({ theme: 'mergeble' }).colors
  assert.deepEqual([g.paper, g.ink, g.accent, g.rule], ['#FAF9F7', '#2B2622', '#C56A4D', '#E4DED8'])
})

test('mono は紺や青を主役にしない（accent は ink と同じ黒）・地は白', () => {
  const c = makeTheme({ theme: 'mono' }).colors
  assert.equal(c.accent, c.ink)
  assert.equal(c.paper, '#FFFFFF')
})

test('字に使う色（ink・sub・accent・up・down）は白地と紙の地のどちらでもコントラスト 3.0 以上、sub は 4.5 以上', () => {
  for (const theme of ['mono', 'koma', 'mergeble']) {
    const { colors: c } = makeTheme({ theme })
    for (const key of ['ink', 'sub', 'accent', 'up', 'down']) {
      assert.ok(contrast(c[key], '#FFFFFF') >= 3, `${theme} ${key} 白地 ${contrast(c[key], '#FFFFFF').toFixed(2)}`)
      assert.ok(contrast(c[key], c.paper) >= 3, `${theme} ${key} 紙 ${contrast(c[key], c.paper).toFixed(2)}`)
    }
    assert.ok(contrast(c.sub, '#FFFFFF') >= 4.5, `${theme} sub 白地 ${contrast(c.sub, '#FFFFFF').toFixed(2)}`)
    assert.ok(contrast(c.sub, c.paper) >= 4.5, `${theme} sub 紙 ${contrast(c.sub, c.paper).toFixed(2)}`)
    assert.ok(contrast(c.ink, c.paper) >= 7, `${theme} ink 紙`)
  }
})

test('表の頭の地（tint）の上でも ink と sub が読める（sub は 4.5 以上）', () => {
  for (const theme of ['mono', 'koma', 'mergeble']) {
    const { colors: c } = makeTheme({ theme })
    assert.ok(contrast(c.ink, c.tint) >= 7, `${theme} ink / tint`)
    assert.ok(contrast(c.sub, c.tint) >= 4.5, `${theme} sub / tint ${contrast(c.sub, c.tint).toFixed(2)}`)
  }
})

test('罫と地は紙と見分けがつき、罫のほうが地より濃い', () => {
  for (const theme of ['mono', 'koma', 'mergeble']) {
    const { colors: c } = makeTheme({ theme })
    assert.ok(contrast(c.rule, c.paper) > 1.05, `${theme} rule`)
    assert.ok(contrast(c.tint, c.paper) > 1.01, `${theme} tint`)
    assert.ok(lum(c.rule) < lum(c.tint), `${theme} 罫が地より濃い`)
  }
})

test('足の字は sub の色', () => {
  for (const theme of ['mono', 'koma', 'mergeble']) {
    const t = makeTheme({ theme })
    assert.equal(t.foot.color, t.colors.sub)
  }
})

test('知らない theme・paper は mono・A4 に戻し、投げない', () => {
  const t = makeTheme({ theme: 'neon', paper: 'A3' })
  assert.equal(t.name, 'mono')
  assert.equal(t.paperName, 'A4')
  assert.equal(makeTheme({}).name, 'mono')
  assert.equal(makeTheme().paperName, 'A4')
  // Object のひな形の名前（toString など）を紙や型の名前に取らない
  assert.equal(makeTheme({ theme: 'toString', paper: 'constructor' }).name, 'mono')
})

test('colors を書き換えても次に作る Theme の色は変わらない', () => {
  const a = makeTheme({})
  a.colors.ink = '#FF0000'
  assert.equal(makeTheme({}).colors.ink, '#111111')
})

test('wide は 960x540 で、縦横を指定しても向きを変えない', () => {
  for (const landscape of [undefined, false, true]) {
    const t = makeTheme({ paper: 'wide', landscape })
    assert.deepEqual(t.page, { width: 960, height: 540 }, String(landscape))
    const d = makeTheme({ kind: 'deck', paper: 'wide', landscape })
    assert.deepEqual(d.page, { width: 960, height: 540 }, `deck ${landscape}`)
  }
})

test('vivid の色は設計書の値そのまま（青の accent・橙の accent2・grad は青の単色）', () => {
  const c = makeTheme({ kind: 'deck', theme: 'vivid' }).colors
  assert.equal(c.ink, '#15171C')
  assert.equal(c.sub, '#4A4F5A')
  assert.equal(c.rule, '#D9DCE1')
  assert.equal(c.tint, '#F4F5F7')
  assert.equal(c.accent, '#1F55C6')
  assert.equal(c.accent2, '#E07A2E')
  assert.deepEqual(c.grad, ['#1F55C6', '#1F55C6'])
  assert.equal(c.up, '#157F3B')
  assert.equal(c.down, '#C0261E')
  assert.equal(c.paper, '#FFFFFF')
  assert.ok(contrast(c.ink, c.paper) >= 4.5 && contrast(c.sub, c.paper) >= 4.5)
})

test('paper の色は設計書の値そのまま（紙 #FAF9F5・墨・朱の accent・金の accent2・grad は墨の単色）', () => {
  const c = makeTheme({ kind: 'deck', theme: 'paper' }).colors
  assert.equal(c.ink, '#141413')
  assert.equal(c.sub, '#73726C')
  assert.equal(c.rule, '#DDD9CE')
  assert.equal(c.tint, '#F0EEE6')
  assert.equal(c.accent, '#D77757')
  assert.equal(c.accent2, '#8F6410')
  assert.deepEqual(c.grad, ['#141413', '#141413'])
  assert.equal(c.up, '#2C7A39')
  assert.equal(c.down, '#AB2B3F')
  assert.equal(c.paper, '#FAF9F5')
  assert.deepEqual(c.grad, [c.ink, c.ink], '光も字のグラデーションも出さない（墨の単色）')
})

test('paper の字の色は紙の上でも白地でも読める: ink は 7 以上・sub は 4.5 以上・up と down は 3 以上', () => {
  // accent（#D77757）は本人の look の色で、紙の上の比は 2.99（白地で 3.15）。色は変えないので、ここでは数えない
  const { colors: c } = makeTheme({ kind: 'deck', theme: 'paper' })
  for (const bg of ['#FFFFFF', c.paper]) {
    assert.ok(contrast(c.ink, bg) >= 7, `ink ${bg} ${contrast(c.ink, bg).toFixed(2)}`)
    assert.ok(contrast(c.sub, bg) >= 4.5, `sub ${bg} ${contrast(c.sub, bg).toFixed(2)}`)
    for (const key of ['up', 'down']) assert.ok(contrast(c[key], bg) >= 3, `${key} ${bg} ${contrast(c[key], bg).toFixed(2)}`)
  }
  assert.ok(contrast(c.ink, c.tint) >= 7, 'ink / tint')
  assert.ok(contrast(c.rule, c.paper) > 1.05 && contrast(c.tint, c.paper) > 1.01, '罫と地は紙と見分けがつく')
  assert.ok(lum(c.rule) < lum(c.tint), '罫が地より濃い')
})

test('paper は系列（series）を持たない: 名前で呼んでも、colors だけ（accent で見分ける）で呼んでも', () => {
  const t = makeTheme({ kind: 'deck', theme: 'paper' })
  assert.equal(lookPal(t).series, undefined, 'Theme から')
  assert.equal(lookPal('paper').series, undefined, '名前から')
  assert.equal(lookPal({ colors: t.colors }).series, undefined, 'colors だけ（accent #D77757 から paper と分かる）')
  assert.equal(lookPal(makeTheme({ kind: 'deck' })).series, undefined, '資料の既定')
})

test('資料の Theme は kind が deck・既定は paper の A4 横で、deck の寸法を持つ', () => {
  const t = makeTheme({ kind: 'deck' })
  assert.equal(t.kind, 'deck')
  assert.equal(t.name, 'paper')
  assert.deepEqual(t.page, { width: 841.89, height: 595.28 })
  assert.equal(t.landscape, true)
  assert.equal(t.deck.grid.cols, 12)
  assert.equal(makeTheme({}).kind, undefined, '文書の Theme は deck の印を持たない')
  assert.equal(makeTheme({ kind: 'deck', landscape: false }).page.width, 595.28, '縦と指定した時だけ縦')
})

test('資料の見出しの書体: paper は明朝の太字で字の下限 10pt、vivid はゴシックの太字で下限なし', () => {
  const p = makeTheme({ kind: 'deck', theme: 'paper' })
  assert.equal(p.deck.headFont, 'minchoBold')
  assert.equal(p.fonts.head, 'minchoBold')
  assert.equal(p.deck.textMin, 10)
  assert.deepEqual([p.fonts.body, p.fonts.bodyBold], ['sans', 'sansBold'], '本文はゴシックのまま')
  const v = makeTheme({ kind: 'deck', theme: 'vivid' })
  assert.equal(v.deck.headFont, 'sansBold')
  assert.equal(v.deck.textMin, undefined)
})

test('資料の字は A4 横で、paper は本文 12.5→11.5→11・表 11→10→9.5、vivid は本文 9.5→9→8.5・表 8.5→8→7.5（字を大きく上げる段は無い）、どの紙でも 7pt を割らず、wide では紙の幅の比で大きくなる', () => {
  const EXPECT = { paper: { body: [12.5, 11.5, 11], table: [11, 10, 9.5] }, vivid: { body: [9.5, 9, 8.5], table: [8.5, 8, 7.5] } }
  for (const [theme, want] of Object.entries(EXPECT)) {
    const a4 = makeTheme({ kind: 'deck', theme }).deck
    assert.deepEqual(a4.sizes.body, want.body, theme)
    assert.deepEqual(a4.sizes.table, want.table, theme)
    assert.equal(a4.sizes.grow, undefined, theme)
    assert.equal(a4.figureZoom, undefined, theme)
    assert.equal(a4.grid.gap, 8, theme)
    assert.deepEqual(a4.margin, { left: 26, right: 26, top: 24, bottom: 22 }, theme)
    const wide = makeTheme({ kind: 'deck', theme, paper: 'wide' }).deck
    assert.ok(Math.abs(wide.scale - 960 / 841.89) < 1e-9, theme)
    assert.ok(wide.sizes.body[0] > a4.sizes.body[0], theme)
    for (const paper of Object.keys(PAPERS)) {
      const { sizes } = makeTheme({ kind: 'deck', theme, paper }).deck
      for (const [k, v] of Object.entries(sizes)) for (const n of [v].flat().concat(Object.values(v).flat())) assert.ok(typeof n !== 'number' || n >= 7, `${theme} ${paper} ${k} ${n}`)
    }
  }
  // 既定（paper）は paper と同じ値
  assert.deepEqual(makeTheme({ kind: 'deck' }).deck.sizes, makeTheme({ kind: 'deck', theme: 'paper' }).deck.sizes)
  // paper の題・要点・注記は vivid より大きい（印刷して読む大きさ）
  const p = makeTheme({ kind: 'deck', theme: 'paper' }).deck.sizes
  const v = makeTheme({ kind: 'deck', theme: 'vivid' }).deck.sizes
  for (const k of ['title', 'lead', 'kicker', 'note', 'label', 'panelTitle', 'panelNote', 'source', 'page', 'kpi']) assert.ok(p[k] > v[k], `${k}: paper ${p[k]} > vivid ${v[k]}`)
})

test('資料の flat（光も階調も使わない）は grad の両端が同じかで決まる: mono・paper・vivid は flat、koma・mergeble は flat でない', () => {
  for (const [theme, flat] of Object.entries({ mono: true, paper: true, vivid: true, koma: false, mergeble: false })) {
    const t = makeTheme({ kind: 'deck', theme })
    assert.equal(t.deck.flat, flat, theme)
    assert.equal(t.colors.grad.every((c) => c === t.colors.grad[0]), flat, `${theme}: grad と flat が合う`)
  }
})

test('文書の Theme は資料の追加（accent2・grad・wide・kind）で動かない: 全部の組み合わせの固まり（hash）が追加前と同じ', () => {
  // 追加前に取った値。theme × 紙 × 向き × 大きさ × 書体を全部並べて JSON にし、FNV-1a で 32 bit にしたもの
  const FROZEN = { mono: 'f5808bb1', koma: '14f3c531', mergeble: 'bda6ddfd' }
  const fnv = (str) => {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  const frozen = (t) => {
    const { baseline, colors, ...rest } = t
    const { accent2, grad, ...c } = colors
    return JSON.stringify({ ...rest, colors: c, b: [0, 1, 7, t.lines - 1].map((i) => baseline(i)) })
  }
  for (const theme of Object.keys(FROZEN)) {
    let all = ''
    for (const paper of ['A4', 'A5', 'B5', 'Letter'])
      for (const landscape of [false, true])
        for (const size of [undefined, 12.5, 8])
          for (const body of ['mincho', 'gothic']) all += frozen(makeTheme({ theme, paper, landscape, size, body })) + '\n'
    assert.equal(fnv(all), FROZEN[theme], theme)
  }
})

test('lookPal: 色のテーマは accent と同じ先頭の 8 色の系列を持ち、mono は系列を持たない', () => {
  for (const name of ['vivid', 'koma', 'mergeble']) {
    const pal = lookPal(makeTheme({ theme: name }))
    assert.equal(pal.series.length, 8, name)
    assert.equal(pal.series[0].toLowerCase(), pal.accent.toLowerCase(), `${name}: series[0] は accent`)
    assert.equal(new Set(pal.series.map((c) => c.toLowerCase())).size, 8, `${name}: 8 色は全部違う`)
    for (const c of pal.series) assert.match(c, /^#[0-9a-fA-F]{6}$/)
  }
  assert.equal(lookPal(makeTheme({ theme: 'mono' })).series, undefined)
})

test('lookPal: 系列の色はどれも紙の上で面として見える（紙との明るさの差が 1.8 倍以上）', () => {
  for (const name of ['vivid', 'koma', 'mergeble']) {
    const theme = makeTheme({ theme: name })
    for (const c of lookPal(theme).series) assert.ok(contrast(c, theme.colors.paper) >= 1.8, `${name} ${c}`)
  }
})

test('lookPal: 呼ぶたびに別の物を返し、書き換えても紙の色（makeTheme の colors）は変わらない', () => {
  const theme = makeTheme({ theme: 'vivid' })
  const before = JSON.stringify(theme.colors)
  const a = lookPal(theme)
  a.series.push('#000000')
  a.grad.push('#000000')
  a.ink = '#000000'
  assert.equal(lookPal(theme).series.length, 8)
  assert.equal(JSON.stringify(theme.colors), before)
})

test('lookPal: 文書の色（colors）に系列を足さない（図だけが使う）', () => {
  assert.equal('series' in makeTheme({ theme: 'vivid' }).colors, false)
})
