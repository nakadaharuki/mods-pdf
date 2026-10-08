// 版面と色の試験（書体を読まない・速い）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAPERS, DEFAULT_SIZES, makeTheme } from '../hooks/engine/theme.mjs'

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

test('4 つの紙のどれでも行長が字の大きさの整数倍で、左右の余白が等しく、15mm 以上', () => {
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

test('本文の大きさの既定は A4 9.5・A5 9・B5 9.5・Letter 9.5', () => {
  assert.deepEqual(DEFAULT_SIZES, { A4: 9.5, A5: 9, B5: 9.5, Letter: 9.5 })
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

test('見出し: h1 18pt・罫 1.4pt、h2 13pt・罫 0.6pt、h3 10.5pt・罫なし、どれも明朝の太字', () => {
  const t = makeTheme({})
  assert.deepEqual([t.head.h1.size, t.head.h1.rule, t.head.h1.font], [18, 1.4, 'minchoBold'])
  assert.deepEqual([t.head.h2.size, t.head.h2.rule, t.head.h2.font], [13, 0.6, 'minchoBold'])
  assert.deepEqual([t.head.h3.size, t.head.h3.rule, t.head.h3.font], [10.5, 0, 'minchoBold'])
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
