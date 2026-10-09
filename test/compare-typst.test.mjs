// @ts-check
// scripts/compare-typst.mjs: ModsPDF と Typst の組版を同じ物差しで数える。
// 数え方の試験は、字の位置を手で決めた頁で行う（Typst も ModsPDF も呼ばない）。Typst を呼ぶ試験は typst が無ければ飛ばす。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  tstr, inlinesToTypst, docToTypst, matchParagraphs, splitByIndent, measure, better, ROWS, renderMarkdown,
  lineAdjustment, difficultyCheck, tallyResult, defaultNames, BENCH_MIN_ADJUSTED,
} from '../scripts/compare-typst.mjs'
import { BENCHES, generateBench, mulberry32 } from '../scripts/make-bench.mjs'
import { readPdfChars, groupLines } from '../scripts/lib-pdftext.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const theme = makeTheme({})
const LEFT = theme.left
const RIGHT = theme.left + theme.measure
const S = theme.size
const BACKSLASH = String.fromCharCode(92)
const hasTypst = spawnSync('typst', ['--version']).status === 0

/**
 * 手で決めた字の位置から頁を作る。xs を省けば、x0 から 1em ずつ（空白は 2.66pt・欧字は 6pt）。
 * @param {{ text: string, y: number, x0?: number, xs?: number[] }[]} lines
 */
function page(lines) {
  /** @type {import('../scripts/lib-pdftext.mjs').Char[]} */
  const chars = []
  for (const l of lines) {
    let x = l.x0 ?? LEFT
    Array.from(l.text).forEach((c, i) => {
      const adv = c === ' ' ? 2.66 : /[A-Za-z]/.test(c) ? 6 : S
      if (l.xs) x = l.xs[i]
      chars.push({ c, x, y: l.y, size: S, adv, font: 'F', role: null })
      x += adv
    })
  }
  return [{ index: 0, width: theme.page.width, height: theme.page.height, chars }]
}
const para = (/** @type {{ text: string }[]} */ lines) => lines.map((l) => l.text).join('')
const A = 'あ'

test('tstr: 逃がすのはバックスラッシュと二重引用符だけ', () => {
  assert.equal(tstr(`a"b${BACKSLASH}c#*$`), `"a${BACKSLASH}"b${BACKSLASH}${BACKSLASH}c#*$"`)
})

test('inlinesToTypst: 字は文字列にして飾りだけ関数にし、式の間に空白を入れず、ルビは親字だけにして数える', () => {
  const r = inlinesToTypst(
    [{ text: 'a' }, { text: 'b', bold: true }, { text: 'c', link: 'https://example.com' }, { text: '親', ruby: 'おや' }, { text: '子' }],
    theme,
  )
  assert.equal(r.code, '#"a"#strong("b")#link("https://example.com", "c")#"親子"')
  assert.equal(r.ruby, 1)
  assert.equal(inlinesToTypst([{ text: 'x', bold: true, link: 'https://e.com' }], theme).code, '#link("https://e.com", strong("x"))')
})

test('docToTypst: 版面は makeTheme と同じで、組まない物（チャート・要点・囲み・記入欄）は省いた数を返す', () => {
  const { doc } = normalize({
    title: '見本',
    author: '著者',
    blocks: [
      { type: 'heading', level: 1, text: '見出し' },
      { type: 'para', text: '本文' },
      { type: 'chart', option: { series: [] } },
      { type: 'keys', items: [{ label: 'a', value: 'b' }] },
      { type: 'card', label: 'c', text: 'd' },
      { type: 'fields', items: [{ kind: 'text', name: 'n', label: 'l' }] },
    ],
  })
  const r = docToTypst(doc, theme)
  assert.match(r.typ, new RegExp(`width: ${theme.page.width}pt, height: ${theme.page.height}pt`))
  assert.ok(r.typ.includes(`left: ${Math.round(theme.left * 1000) / 1000}pt`))
  assert.ok(r.typ.includes('first-line-indent: (amount: 1em, all: true)'))
  assert.ok(r.typ.includes('linebreaks: "optimized"'))
  assert.deepEqual({ chart: r.omitted.chart, keys: r.omitted.keys, card: r.omitted.card, fields: r.omitted.fields }, { chart: 1, keys: 1, card: 1, fields: 1 })
})

test('Typst に渡した字が記法に化けず、そのまま PDF の字になる（# * $ " \\ @ と飾り・表・入れ子の箇条書き）', { skip: !hasTypst }, async () => {
  const tricky = `a#b*c$d"e${BACKSLASH}f@g_h`
  const { doc } = normalize({
    title: '試験',
    blocks: [
      { type: 'heading', level: 2, text: '見出し二' },
      { type: 'para', text: `${tricky} と **太字** と [リンク](https://example.com) と \`コード\` と {親|おや}` },
      { type: 'list', ordered: false, items: [['一つ目'], { text: ['二つ目'], items: [['入れ子']] }] },
      { type: 'list', ordered: true, items: [['番号一'], ['番号二']] },
      { type: 'table', head: ['列甲', '列乙'], rows: [['セル一', 'セル二']], align: ['left', 'right'], widths: [30, 70] },
      { type: 'quote', text: '引用の字' },
      { type: 'rule' },
      { type: 'pagebreak' },
      { type: 'para', text: '次の頁' },
    ],
  })
  const { typ } = docToTypst(doc, theme)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'))
  const typPath = path.join(dir, 'a.typ')
  const pdfPath = path.join(dir, 'a.pdf')
  fs.writeFileSync(typPath, typ)
  const fontDirs = ['C:/dev/kit/files/fonts', 'C:/Users/nakada/.claude/local-mods/nakada-mods/nakada/skills/typst-pdf/fonts'].filter((p) => fs.existsSync(p))
  const r = spawnSync('typst', ['compile', '--ignore-system-fonts', ...fontDirs.flatMap((d) => ['--font-path', d]), typPath, pdfPath], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const { pages } = await readPdfChars(new Uint8Array(fs.readFileSync(pdfPath)))
  assert.equal(pages.length, 2)
  const text = groupLines(pages).map((l) => l.text).join('').replace(/\s/g, '')
  for (const s of [tricky, '太字', 'リンク', 'コード', '親', '一つ目', '入れ子', '番号二', 'セル二', '引用の字', '次の頁']) assert.ok(text.includes(s), `${s} が PDF に無い`)
  assert.ok(!text.includes('おや'), 'ルビの読みは Typst に出さない')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('matchParagraphs: 段落は行の頭から行の末までを占める並びだけを採り、短い段落が見出しの字に紛れ込まない', () => {
  const pages = page([{ text: 'はいと言う', y: 700 }, { text: 'はい', y: 680 }, { text: '次の段落の一行目', y: 660 }, { text: '二行目です', y: 640 }])
  const lines = groupLines(pages)
  const m = matchParagraphs(lines, ['はい', '次の段落の一行目二行目です', '無い段落'])
  assert.equal(m.matched, 2)
  assert.equal(m.total, 3)
  assert.deepEqual(m.paras[0].map((l) => l.text), ['はい'])
  assert.deepEqual(m.paras[1].map((l) => l.text), ['次の段落の一行目', '二行目です'])
})

test('splitByIndent: 左端より 0.5em 以上右から始まる行が段落の頭', () => {
  const lines = groupLines(page([{ text: 'あああ', y: 700, x0: LEFT + S }, { text: 'いいい', y: 680 }, { text: 'ううう', y: 660, x0: LEFT + S }]))
  const ps = splitByIndent(lines, LEFT, S)
  assert.deepEqual(ps.map((p) => p.length), [2, 1])
})

test('measure: 字間に足された空き（最大・平均・0.02em を超える行の割合）と、版面の右端との差を、最後の行を除く行で数える', () => {
  const step = S * 1.05
  // 1 行目は 1em 下げの 52 字でぴったり
  const l1 = { text: A.repeat(52), y: 700, x0: LEFT + S }
  const l2 = { text: A.repeat(20), y: 680, xs: Array.from({ length: 20 }, (_, i) => LEFT + i * step) }
  const l3 = { text: A.repeat(5), y: 660 }
  const m = measure(page([l1, l2, l3]), { theme, paraTexts: [para([l1, l2, l3])] })
  assert.equal(m.justified, 2)
  assert.ok(Math.abs(m.wajiMax - 0.05) < 1e-6, String(m.wajiMax))
  assert.ok(Math.abs(m.wajiRatio - 0.5) < 1e-9)
  // 1 行目はぴったり、2 行目は右端の手前で終わる
  assert.ok(Math.abs(m.edgeMean - (RIGHT - (LEFT + 19 * step + S)) / 2) < 1e-6)
})

test('measure: 行頭禁則・行末禁則・段落末 1 字の行を数える', () => {
  const l1 = { text: '、' + A.repeat(10) + '「', y: 700 }
  const l2 = { text: 'い。', y: 680 }
  const m = measure(page([l1, l2]), { theme, paraTexts: [para([l1, l2])] })
  assert.equal(m.headBreaks, 1)
  assert.equal(m.tailBreaks, 1)
  assert.equal(m.runts, 1)
  const ok = measure(page([{ text: A.repeat(10), y: 700 }, { text: 'いう。', y: 680 }]), { theme, paraTexts: [A.repeat(10) + 'いう。'] })
  assert.deepEqual([ok.headBreaks, ok.tailBreaks, ok.runts], [0, 0, 0])
})

test('measure: 約物の並びは字面の間の空き（前の右の空き + 字の間 + 次の左の空き）で数える', () => {
  // あ 」「 い 。」 う 』 『 え。 」「は 0 の字の間で空き 1em、。」は半分詰めて 0、』『は字の間を 0.2em 開けて 1.2em
  const text = 'あ」「い。」う』『え'
  const xs = []
  let x = LEFT
  for (const [i, c] of Array.from(text).entries()) {
    if (c === '」' && text[i - 1] === '。') x -= S / 2
    if (c === '『') x += 0.2 * S
    xs.push(x)
    x += S
  }
  const l = { text, y: 700, xs }
  const m = measure(page([l]), { theme, paraTexts: [text] })
  assert.equal(m.punctPairs, 3)
  assert.equal(m.punctPair05, 2)
  assert.equal(m.punctRun1, 1)
})

test('measure: 段落の最初の行の始め括弧の位置と、途中の行頭の天付きを版面の左端からの em で出す', () => {
  const l1 = { text: '「あい', y: 700, x0: LEFT + S / 2 }
  const l2 = { text: '「うえ', y: 680, x0: LEFT - S / 2 }
  const m = measure(page([l1, l2]), { theme, paraTexts: [para([l1, l2])] })
  assert.equal(m.parenIndentN, 1)
  assert.ok(Math.abs(m.parenIndent - 0.5) < 1e-9)
  assert.equal(m.hangOpenN, 1)
  assert.ok(Math.abs(m.hangOpen - -0.5) < 1e-9)
})

test('measure: 和欧間は間に空白の字があっても箱から箱までの空きを em で数える', () => {
  const xs = [LEFT, LEFT + S + 0.25 * S, LEFT + S + 0.25 * S + 6, LEFT + S + 0.25 * S + 6 + 2.66]
  const l = { text: 'あA い', y: 700, xs }
  const m = measure(page([l]), { theme, paraTexts: [l.text] })
  assert.equal(m.woN, 2)
  assert.ok(Math.abs(m.woMean - (0.25 + 2.66 / S) / 2) < 1e-6)
  assert.ok(m.woSd > 0)
})

test('measure: 行末の約物が半分はみ出す詰め方は、箱でなく墨の右端で数える（はみ出す行は差 0、箱が収まる行は半分の差）', () => {
  // 1 行目: 52 字 + 。 で、。の箱の左端を版面の右端の 0.5em 手前に置く（墨がぴったり右端）
  const hangStep = (RIGHT - S / 2 - LEFT - S) / 51
  const hang = { text: A.repeat(52) + '。', y: 700, xs: [...Array.from({ length: 52 }, (_, i) => LEFT + i * hangStep), RIGHT - S / 2] }
  // 2 行目: 50 字 + 。 を詰めずに並べる（墨の右端は LEFT + 50.5em）
  const inside = { text: A.repeat(50) + '。', y: 680 }
  const last = { text: 'あ', y: 660 }
  const m = measure(page([hang, inside, last]), { theme, paraTexts: [para([hang, inside, last])] })
  const e2 = RIGHT - (LEFT + 50 * S + S / 2)
  assert.ok(Math.abs(m.edgeMean - e2 / 2) < 1e-6, String(m.edgeMean))
  assert.ok(Math.abs(m.edgeMax - e2) < 1e-6)
})

test('better: 小さいほど良い項目・目標に近いほど良い項目・丸めて同じ値は引き分け・値が無ければ付けない', () => {
  const row = (/** @type {string} */ key) => /** @type {any} */ (ROWS.find((r) => r.key === key))
  assert.equal(better(0, 1, row('edgeMean')), 'mods')
  assert.equal(better(2, 1, row('edgeMean')), 'typst')
  assert.equal(better(0.0001, 0.0002, row('edgeMean')), 'tie')
  assert.equal(better(0.28, 0.266, row('woMean')), 'typst')
  assert.equal(better(0.5, 0.99, row('parenIndent')), 'mods')
  assert.equal(better(NaN, 1, row('edgeMean')), null)
  assert.equal(better(1, 2, row('pages')), null)
})

test('renderMarkdown: 良い方の値に ▲ を付け、ModsPDF が組めていない時はその理由を書く', () => {
  const m = measure(page([{ text: A.repeat(3), y: 700 }]), { theme, paraTexts: [A.repeat(3)] })
  const base = { name: 'x', title: '題', status: 'ok', omitted: { chart: 1 }, rubyInlines: 2, typst: { status: 'ok', ms: 10, metrics: { ...m, edgeMean: 1 } } }
  const md = renderMarkdown([{ ...base, mods: { status: 'ok', ms: 5, metrics: { ...m, edgeMean: 0 }, warnings: [] } }], { typstVersion: 'typst 0.15.1' })
  assert.match(md, /右端の差の平均[^|]*\| 0\.000 ▲ \| 1\.000 \|/)
  assert.match(md, /chart 1 個/)
  assert.match(md, /ルビ: 2 箇所を親字だけにした（ルビなし/)
  const pending = renderMarkdown([{ ...base, mods: { status: 'pending', reason: 'layout 待ち（x）' } }], { typstVersion: 'typst 0.15.1' })
  assert.match(pending, /ModsPDF: layout 待ち（x）/)
  // 見出しの凡例にも ▲ の字はあるので、値に付いた ▲（数字の後ろ）だけを見る
  assert.ok(!/[0-9―] ▲/.test(pending))
})

/** 手で決めた x の字の列（page() の最初の行） @param {string} text @param {number[]} [xs] */
const chars = (text, xs) => page([{ text, y: 700, xs }])[0].chars
/** 隣り合う字の間を、箱の端から gaps（em）だけ開けた x の列を作る。1 字目は LEFT */
function xsFor(/** @type {string} */ text, /** @type {number[]} */ gaps) {
  const out = [LEFT]
  const cs = chars(text)
  for (let i = 1; i < cs.length; i++) out.push(out[i - 1] + cs[i - 1].adv + gaps[i - 1] * S)
  return out
}

test('lineAdjustment: 字を送り幅どおりに並べた行はベタ組みなので、調整が要らない', () => {
  const r = lineAdjustment(chars('あいうえお'))
  assert.equal(r.adjusted, false)
  assert.ok(Math.abs(r.net) < 1e-9)
})

test('lineAdjustment: 0.005em 以上開いた所があれば調整が要った行で、開きは net に正で出る', () => {
  const text = 'あいう'
  const r = lineAdjustment(chars(text, xsFor(text, [0.01, 0])))
  assert.equal(r.adjusted, true)
  assert.ok(Math.abs(r.net - 0.01) < 1e-9, String(r.net))
  assert.equal(lineAdjustment(chars(text, xsFor(text, [0.004, 0]))).adjusted, false)
})

test('lineAdjustment: 小さなずれも足し上げて 0.005em を超えたら調整が要った行（位置のずれはベタ組みからの累積）', () => {
  const text = 'あいうえ'
  assert.equal(lineAdjustment(chars(text, xsFor(text, [0.003, 0.003, 0]))).adjusted, true)
})

test('lineAdjustment: 字を詰めた所は net に負で出る', () => {
  const text = 'あ」い'
  const r = lineAdjustment(chars(text, xsFor(text, [-0.1, 0])))
  assert.equal(r.adjusted, true)
  assert.ok(Math.abs(r.net + 0.1) < 1e-9, String(r.net))
})

test('lineAdjustment: 約物どうしの詰め（」「 を半分詰める）は調整が要った行だが、詰めにも開けにも数えない標準の空き', () => {
  const text = 'あ」「い'
  const r = lineAdjustment(chars(text, xsFor(text, [0, -0.5, 0])))
  assert.equal(r.adjusted, true)
  assert.ok(Math.abs(r.net) < 1e-9, String(r.net))
})

test('lineAdjustment: 直に隣り合う和欧間は四分が標準で、それより詰めた分は負・開けた分は正で net に出る', () => {
  const text = 'あA'
  const net = (/** @type {number} */ gap) => lineAdjustment(chars(text, xsFor(text, [gap]))).net
  assert.ok(Math.abs(net(0.25)) < 1e-9)
  assert.ok(Math.abs(net(0.3) - 0.05) < 1e-9)
  assert.ok(Math.abs(net(0.2) + 0.05) < 1e-9)
  // 標準の四分でも、ベタ組みからは 0.25em ずれているので調整が要った行
  assert.equal(lineAdjustment(chars(text, xsFor(text, [0.25]))).adjusted, true)
})

test('lineAdjustment: 入力の空白がある和欧間は、四分から空白の送り幅までを標準とする（ModsPDF は四分に詰め、Typst は空白の幅のまま置く）', () => {
  // あ 空白 A: 空白の送り幅は 2.66pt（約 0.28em）
  const sp = 2.66 / S
  const at = (/** @type {number} */ box) => [LEFT, LEFT + S, LEFT + S + box * S]
  const modsLike = lineAdjustment(chars('あ A', at(0.25)))
  const typstLike = lineAdjustment(chars('あ A', at(sp)))
  assert.deepEqual([modsLike.adjusted, typstLike.adjusted], [true, false])
  assert.ok(Math.abs(modsLike.net) < 1e-9, '四分は標準なので net に出ない')
  assert.ok(Math.abs(typstLike.net) < 1e-9)
  // 標準の幅（四分〜空白の幅）より外は動かした量として出る
  assert.ok(Math.abs(lineAdjustment(chars('あ A', at(0.4))).net - (0.4 - sp)) < 1e-9)
  assert.ok(Math.abs(lineAdjustment(chars('あ A', at(0.1))).net - (0.1 - 0.25)) < 1e-9)
})

test('lineAdjustment: 欧字どうしのカーニングとルビの下の親字の間は、揃えるための調整に足さない', () => {
  assert.equal(lineAdjustment(chars('AV', xsFor('AV', [-0.05]))).adjusted, false)
  const text = '親字'
  const xs = xsFor(text, [0.3])
  assert.equal(lineAdjustment(chars(text, xs)).adjusted, true)
  assert.equal(lineAdjustment(chars(text, xs), { underRuby: () => true }).adjusted, false)
})

test('measure: 調整が要った行を、段落の最後の行を除いた両端揃えの行から数え、詰め・開けに分ける', () => {
  const open = { text: 'あいう', y: 700, xs: xsFor('あいう', [0.01, 0]) }
  const squeeze = { text: 'あ」い', y: 680, xs: xsFor('あ」い', [-0.1, 0]) }
  const solid = { text: 'ああ', y: 660 }
  // 最後の行は動かしてあっても数えない
  const last = { text: 'あ、あ', y: 640, xs: xsFor('あ、あ', [0.3, 0]) }
  const m = measure(page([open, squeeze, solid, last]), { theme, paraTexts: [para([open, squeeze, solid, last])] })
  assert.equal(m.justified, 3)
  assert.deepEqual([m.adjusted, m.adjCompress, m.adjExpand], [2, 1, 1])
})

test('measure: 行頭に来た小書きの仮名と長音を数え、行頭禁則の内訳として同じ行の数に含める', () => {
  const lines = ['あい', 'ょう', 'ーあ', 'っあ', 'う、', '、あ', '々あ'].map((text, i) => ({ text, y: 700 - i * 20 }))
  const m = measure(page(lines), { theme, paraTexts: [para(lines)] })
  assert.equal(m.smallHeads, 3)
  // 、と々も行頭禁則の字なので、行頭禁則の破れは 5 行
  assert.equal(m.headBreaks, 5)
  const ok = measure(page([{ text: 'あいう', y: 700 }, { text: 'えお', y: 680 }]), { theme, paraTexts: ['あいうえお'] })
  assert.equal(ok.smallHeads, 0)
})

test('measure: ルビを置いた所は、構造の印（RT）が付いた中身ごとに 1 つと数える（字の位置や間隔では数えない）', () => {
  const pages = page([{ text: 'あいう', y: 700 }])
  const rt = (/** @type {string} */ c, /** @type {number} */ x, /** @type {number} */ mc) => ({ c, x, y: 712, size: S / 2, adv: S / 2, font: 'F', role: 'RT', mc })
  // 1 つ目は離れた 2 字、2 つ目は隣り合う 2 字、3 つ目は別の印の 1 字（2 つ目のすぐ隣）
  pages[0].chars.push(rt('る', LEFT, 10), rt('び', LEFT + 40, 10), rt('か', LEFT + 60, 11), rt('な', LEFT + 65, 11), rt('ふ', LEFT + 70, 12))
  const m = measure(pages, { theme, paraTexts: ['あいう'] })
  assert.equal(m.rubyPlaced, 3)
  assert.equal(measure(page([{ text: 'あいう', y: 700 }]), { theme, paraTexts: ['あいう'] }).rubyPlaced, 0)
})

test('tallyResult: 良い方の数を見本ごとに数え、片方が組めていなければ全部 0', () => {
  const m = measure(page([{ text: A.repeat(3), y: 700 }]), { theme, paraTexts: [A.repeat(3)] })
  const mods = { status: 'ok', metrics: { ...m, edgeMean: 0, edgeMax: 0 } }
  const typst = { status: 'ok', metrics: { ...m, edgeMean: 1, edgeMax: 2 } }
  const t = tallyResult({ mods, typst })
  assert.equal(t.mods, 2)
  assert.equal(t.typst, 0)
  assert.ok(t.tie > 0)
  assert.deepEqual(tallyResult({ mods: { status: 'pending' }, typst }), { mods: 0, typst: 0, tie: 0 })
})

test('difficultyCheck: 難しい見本だけ、どちらも調整が要った行が 20 行以上（詰め・開けでも 20 行以上）あり、途中の行頭の始め括弧があれば合格', () => {
  const base = measure(page([{ text: A.repeat(3), y: 700 }]), { theme, paraTexts: [A.repeat(3)] })
  const side = (/** @type {Partial<typeof base>} */ o) => ({ status: 'ok', metrics: { ...base, adjusted: 30, adjCompress: 25, adjExpand: 3, hangOpenN: 4, ...o } })
  assert.equal(difficultyCheck({ name: 'report', mods: side({}), typst: side({}) }), null)
  assert.equal(difficultyCheck({ name: 'bench-30', mods: side({}), typst: side({}) })?.ok, true)
  assert.equal(difficultyCheck({ name: 'bench-30', mods: side({ adjusted: BENCH_MIN_ADJUSTED - 1 }), typst: side({}) })?.ok, false)
  assert.equal(difficultyCheck({ name: 'bench-30', mods: side({}), typst: side({ adjCompress: 10, adjExpand: 9 }) })?.ok, false)
  assert.equal(difficultyCheck({ name: 'bench-30', mods: side({ hangOpenN: 0 }), typst: side({}) })?.ok, false)
  assert.equal(difficultyCheck({ name: 'bench-30', mods: { status: 'pending' }, typst: side({}) })?.ok, false)
})

test('renderMarkdown: ルビの行は「ModsPDF だけができる事」の表に分けて ▲ に数えず、見本ごとと全部の合計の ▲ を出す', () => {
  const m = measure(page([{ text: A.repeat(3), y: 700 }]), { theme, paraTexts: [A.repeat(3)] })
  const one = (/** @type {string} */ name, /** @type {number} */ modsEdge, /** @type {number} */ typstEdge) => ({
    name, title: '', status: 'ok', omitted: {}, rubyInlines: 4, chars: 53, paper: 'A4', size: 9.5, paras: 1,
    mods: { status: 'ok', ms: 1, warnings: [], metrics: { ...m, edgeMean: modsEdge, rubyPlaced: 4 } },
    typst: { status: 'ok', ms: 1, metrics: { ...m, edgeMean: typstEdge, rubyPlaced: 0 } },
  })
  const md = renderMarkdown([one('easy', 0, 1), one('bench-x', 1, 0)], { typstVersion: 'typst 0.15.1' })
  assert.match(md, /ModsPDF だけができる事（▲ に数えない）/)
  assert.match(md, /ルビを置いた所の数[^|]*入力のルビ指定 4 箇所 \| 4 \| 0（標準の機能なし） \|/)
  assert.equal((md.match(/この見本の ▲: ModsPDF 1・Typst 0/g) ?? []).length, 1)
  assert.match(md, /\| bench-x \| 53 \| 0 \| 1 \|/)
  assert.match(md, /\| 易しい見本の計 \| \| 1 \| 0 \|/)
  assert.match(md, /\| 難しい見本の計 \| \| 0 \| 1 \|/)
  assert.match(md, /\| 全部の合計 \| \| 1 \| 1 \|/)
  assert.match(md, /良い方に付いた ▲: ModsPDF 1・Typst 1/)
})

test('defaultNames: 易しい 3 本の後ろに、samples の bench-*.json を名前順に足す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-'))
  for (const n of ['bench-b.json', 'bench-a.json', 'other.json', 'bench-.json', 'notbench-c.json']) fs.writeFileSync(path.join(dir, n), '{}')
  assert.deepEqual(defaultNames(dir), ['report', 'prose', 'ruby', 'bench-a', 'bench-b'])
  assert.deepEqual(defaultNames(path.join(dir, 'absent')), ['report', 'prose', 'ruby'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('make-bench: 同じ種なら同じ見本、種を変えれば違う見本が出て、3 本で段落は合わせて 300 になる', () => {
  const [spec] = BENCHES
  assert.equal(JSON.stringify(generateBench(spec)), JSON.stringify(generateBench(spec)))
  assert.notEqual(JSON.stringify(generateBench(spec)), JSON.stringify(generateBench({ ...spec, seed: spec.seed + 1 })))
  const paras = BENCHES.map((b) => generateBench(b).blocks.filter((x) => x.type === 'para').length)
  assert.deepEqual(paras, [100, 100, 100])
  const r = mulberry32(1)
  const first = [r(), r(), r()]
  const again = mulberry32(1)
  assert.deepEqual(first, [again(), again(), again()])
  assert.ok(first.every((v) => v >= 0 && v < 1))
})

test('make-bench: 3 本の 1 行の字数は 30・40・53 字で、samples/bench-*.json は今の生成器が出す物と同じ', () => {
  assert.deepEqual(BENCHES.map((b) => makeTheme({ paper: b.paper, size: b.size }).chars), [30, 40, 53])
  for (const b of BENCHES) {
    const doc = generateBench(b)
    const onDisk = fs.readFileSync(path.join(ROOT, 'samples', `${b.name}.json`), 'utf8')
    assert.equal(onDisk, JSON.stringify(doc, null, 2) + '\n', `${b.name}.json が生成器の出力と違う。node scripts/make-bench.mjs で作り直す`)
    const { doc: normal, warnings } = normalize(doc)
    assert.deepEqual(warnings, [])
    assert.equal(normal.paper, b.paper)
    assert.equal(normal.size, b.size)
  }
})

test('make-bench: 小書きの仮名・長音・約物の連なり・欧文と空白・数と単位・ルビが、どの見本にも十分にある', () => {
  for (const b of BENCHES) {
    const text = generateBench(b).blocks.filter((x) => x.type === 'para').map((x) => x.text).join('\n')
    const count = (/** @type {RegExp} */ re) => (text.match(re) ?? []).length
    assert.ok(count(/[ゃゅょっャュョッ]/g) >= 100, `${b.name}: 小書きの仮名`)
    assert.ok(count(/ー/g) >= 100, `${b.name}: 長音`)
    assert.ok(count(/[「『（]/g) >= 100, `${b.name}: 段落の途中の始め括弧`)
    assert.ok(count(/[。、」）』][「『（]|。」|）」|」、/g) >= 50, `${b.name}: 約物の連なり`)
    assert.ok(count(/[ぁ-んァ-ヶ一-龠] [A-Za-z0-9]/g) >= 20 && count(/[ぁ-んァ-ヶ一-龠][A-Za-z0-9]/g) >= 20, `${b.name}: 欧文と和文の間の空白あり・なし`)
    assert.ok(count(/\d+(?:\.\d+)? ?(?:MiB|KiB|pt|mm|em|ms|秒|倍|%)/g) >= 20, `${b.name}: 数と単位`)
    assert.ok(count(/\{[^|}]+\|[^}]+\}/g) >= 50, `${b.name}: ルビ`)
  }
  const all = BENCHES.map((b) => JSON.stringify(generateBench(b))).join('')
  assert.ok(all.includes('Claude Code の Mods') && all.includes('PDF を 3 MiB 未満に'), '例の言い回しが、空白つきのままどれかの見本に入っている')
})

test('難しい見本を両方の組版で組むと、どちらも調整が要った行が 20 行以上あり、段落の途中の行頭の始め括弧が出る', { skip: !hasTypst, timeout: 120000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-'))
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/compare-typst.mjs'), '--names', BENCHES.map((b) => b.name).join(','), '--samples', path.join(ROOT, 'samples'), '--out', path.join(dir, 'out'), '--typ-dir', path.join(dir, 'typ')],
    { encoding: 'utf8' },
  )
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'out/compare.json'), 'utf8'))
  for (const b of BENCHES) {
    const d = json.docs.find((/** @type {any} */ x) => x.name === b.name)
    assert.equal(d.mods.status, 'ok', `${b.name}: ${d.mods.reason}`)
    assert.equal(d.typst.status, 'ok')
    assert.equal(d.chars, b.chars)
    assert.equal(d.paras, 100)
    assert.ok(d.mods.metrics.parasMatched === 100 && d.typst.metrics.parasMatched === 100, `${b.name}: 段落の照合`)
    const dc = difficultyCheck(d)
    assert.equal(dc?.ok, true, dc?.text)
    assert.ok(d.mods.metrics.rubyPlaced > 0 && d.typst.metrics.rubyPlaced === 0)
  }
  const md = fs.readFileSync(path.join(dir, 'out/compare.md'), 'utf8')
  assert.match(md, /難しさの確かめ:.*合格/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('コマンド: samples の json から Typst の元・両方の PDF・compare.md・compare.json を書く', { skip: !hasTypst }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmpcli-'))
  fs.writeFileSync(path.join(dir, 'mini.json'), JSON.stringify({ title: '小さな見本', markdown: '## 見出し\n\n本文の一段落です。「括弧」と English の語。\n\n次の段落です。' }))
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/compare-typst.mjs'), '--names', 'mini,absent', '--samples', dir, '--out', path.join(dir, 'out'), '--typ-dir', path.join(dir, 'typ')],
    { encoding: 'utf8' },
  )
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(fs.existsSync(path.join(dir, 'typ/mini.typ')))
  assert.ok(fs.existsSync(path.join(dir, 'out/compare/mini-typst.pdf')))
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'out/compare.json'), 'utf8'))
  const mini = json.docs.find((/** @type {any} */ d) => d.name === 'mini')
  assert.equal(mini.typst.status, 'ok')
  assert.ok(['ok', 'pending'].includes(mini.mods.status))
  const absent = json.docs.find((/** @type {any} */ d) => d.name === 'absent')
  assert.equal(absent.status, 'samples 待ち')
  const md = fs.readFileSync(path.join(dir, 'out/compare.md'), 'utf8')
  assert.match(md, /samples 待ち/)
  fs.rmSync(dir, { recursive: true, force: true })
})
