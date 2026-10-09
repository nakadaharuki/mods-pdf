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
import { tstr, inlinesToTypst, docToTypst, matchParagraphs, splitByIndent, measure, better, ROWS, renderMarkdown } from '../scripts/compare-typst.mjs'
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
