// @ts-check
// scripts/lib-pdftext.mjs: PDF の頁の字を、位置・大きさ・送り幅つきで 1 字ずつ読む。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName } from 'pdf-lib'
import { readPdfChars, parseOps, parseToUnicode, groupLines, inkRight, lastPageFill, markedRuns } from '../scripts/lib-pdftext.mjs'
import { loadFontBytes } from '../hooks/engine/fonts.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @param {number} a @param {number} b @param {number} [eps] */
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} は ${b} に近いはず`)

/**
 * 単純な書体（1 バイトの字・全部 600/1000 em）だけで、指定の内容の流れを持つ 200×300 の PDF を作る。
 * 流れの演算子を 1 つずつ確かめるため、PDF 全体は pdf-lib の低い層で組む。
 * @param {string} content
 * @param {{ form?: { matrix: number[], content: string } }} [o]
 */
async function pdfWith(content, o = {}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 300])
  const ctx = doc.context
  const widths = Array.from({ length: 95 }, () => 600)
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'TestFont', FirstChar: 32, LastChar: 126, Widths: widths }))
  /** @type {Record<string, any>} */
  const res = { Font: { F1: font } }
  if (o.form) {
    const fm = ctx.register(ctx.stream(o.form.content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 300], Matrix: o.form.matrix, Resources: { Font: { F1: font } } }))
    res.XObject = { Fm: fm }
  }
  page.node.set(PDFName.of('Resources'), ctx.obj(res))
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(content)))
  return doc.save()
}

/** @param {string} content @param {Parameters<typeof pdfWith>[1]} [o] */
async function charsOf(content, o) {
  const { pages } = await readPdfChars(await pdfWith(content, o))
  return pages[0].chars
}

test('Td の後の文字は、送り幅 × 大きさずつ右に並ぶ', async () => {
  const cs = await charsOf('BT /F1 10 Tf 20 100 Td (AB) Tj ET')
  assert.equal(cs.length, 2)
  assert.deepEqual(cs.map((c) => c.c), ['A', 'B'])
  near(cs[0].x, 20)
  near(cs[0].y, 100)
  near(cs[1].x, 26)
  near(cs[0].size, 10)
  near(cs[0].adv, 6)
})

test('TJ の調整は次の字の位置だけを動かし、adv には含まれない', async () => {
  const cs = await charsOf('BT /F1 10 Tf 0 0 Td [(A) -500 (B) 250 (C)] TJ ET')
  near(cs[1].x, 6 + 5)
  near(cs[2].x, 11 + 6 - 2.5)
  for (const c of cs) near(c.adv, 6)
})

test('Tc は字ごとに、Tz は送り幅と Tc をまとめて縮める', async () => {
  const cs = await charsOf('BT /F1 10 Tf 2 Tc 50 Tz 0 0 Td (AB) Tj ET')
  near(cs[1].x, (6 + 2) * 0.5)
  near(cs[0].adv, 3)
})

test('Tw は 1 バイトの空白の字だけに効く', async () => {
  const cs = await charsOf('BT /F1 10 Tf 3 Tw 0 0 Td (A B) Tj ET')
  near(cs[2].x, 6 + 6 + 3)
})

test('TD は行送りを決め、T* と TL で次の行へ進む', async () => {
  const cs = await charsOf('BT /F1 10 Tf 12 TL 0 100 Td (A) Tj T* (B) Tj 5 -20 TD (C) Tj T* (D) Tj ET')
  assert.deepEqual(cs.map((c) => [c.c, c.x, c.y]), [['A', 0, 100], ['B', 0, 88], ['C', 5, 68], ['D', 5, 48]])
})

test("引用符の演算子 ' と \" は改行して字を出す（\" は Tw と Tc も決める）", async () => {
  const cs = await charsOf('BT /F1 10 Tf 10 TL 0 100 Td (A) Tj (B) \' 1 2 (C D) " ET')
  assert.deepEqual(cs.map((c) => c.c), ['A', 'B', 'C', ' ', 'D'])
  near(cs[1].y, 90)
  near(cs[2].y, 80)
  // C の後: 6 + Tc 2 = 8、空白の後: 6 + Tc 2 + Tw 1 = 9
  near(cs[3].x, 8)
  near(cs[4].x, 8 + 9)
})

test('q と Q の中の cm は外に漏れず、字の大きさは拡大が掛かる', async () => {
  const cs = await charsOf('q 2 0 0 2 10 10 cm BT /F1 10 Tf 5 5 Td (A) Tj ET Q BT /F1 10 Tf 0 0 Td (B) Tj ET')
  near(cs[0].x, 20)
  near(cs[0].y, 20)
  near(cs[0].size, 20)
  near(cs[0].adv, 12)
  near(cs[1].x, 0)
  near(cs[1].size, 10)
})

test('上下を反す cm と Tm でも、y は頁の左下から測った基線で、大きさは正', async () => {
  const cs = await charsOf('1 0 0 -1 0 300 cm BT /F1 10 Tf 1 0 0 -1 20 50 Tm (A) Tj ET')
  near(cs[0].x, 20)
  near(cs[0].y, 250)
  near(cs[0].size, 10)
})

test('16 進の字・8 進の逃がし・入れ子の括弧を読める', async () => {
  const cs = await charsOf('BT /F1 10 Tf 0 0 Td <4142> Tj (\\103\\(\\)) Tj ((x)) Tj ET')
  assert.equal(cs.map((c) => c.c).join(''), 'ABC()(x)')
})

test('インライン画像の中のバイトを字と読み違えない', async () => {
  // 画像のデータに「(Z) Tj」と読める並びと、制御の字を入れる（制御の字は数で作る）
  const raw = String.fromCharCode(1) + '(Z) Tj ' + String.fromCharCode(2)
  const cs = await charsOf('q 1 0 0 1 0 0 cm BI /W 2 /H 1 /CS /G /BPC 8 ID ' + raw + ' EI Q BT /F1 10 Tf 0 0 Td (A) Tj ET')
  assert.equal(cs.map((c) => c.c).join(''), 'A')
})

test('印付きの中身の役割を字に付ける（入れ子の Span は外側の役割を優先）', async () => {
  const cs = await charsOf('/P <</MCID 0>> BDC BT /F1 10 Tf 0 0 Td (A) Tj /Span <</ActualText (x)>> BDC (B) Tj EMC ET EMC BT /F1 10 Tf (C) Tj ET')
  assert.deepEqual(cs.map((c) => c.role), ['P', 'P', null])
})

test('Form XObject の中の字も、Matrix を掛けて読む', async () => {
  const cs = await charsOf('q 1 0 0 1 0 100 cm /Fm Do Q', { form: { matrix: [1, 0, 0, 1, 50, 0], content: 'BT /F1 10 Tf 5 5 Td (A) Tj ET' } })
  assert.equal(cs.length, 1)
  near(cs[0].x, 55)
  near(cs[0].y, 105)
})

test('ToUnicode の bfchar・bfrange（16 進と配列）・サロゲート対を引ける', () => {
  const src = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar
<0001> <0041>
<0002> <D840DC0B>
endbfchar
2 beginbfrange
<0010> <0012> <3042>
<0020> <0021> [<0061> <00620063>]
endbfrange
endcmap`
  const m = parseToUnicode(new TextEncoder().encode(src))
  assert.equal(m.map.get(1), 'A')
  assert.equal(m.map.get(2), String.fromCodePoint(0x2000b))
  assert.equal(m.ranges.length, 1)
  assert.equal(m.map.get(0x20), 'a')
  assert.equal(m.map.get(0x21), 'bc')
})

test('演算子の読みは、数・名前・配列・辞書を引数にまとめる', () => {
  const ops = parseOps(new TextEncoder().encode('1 0 0 1 5 6 cm /P <</MCID 3 /K [1 2]>> BDC [(a) -10 <62>] TJ % 注釈\nET'))
  assert.deepEqual(ops.map((o) => o.op), ['cm', 'BDC', 'TJ', 'ET'])
  assert.deepEqual(ops[0].args, [1, 0, 0, 1, 5, 6])
  assert.deepEqual(ops[1].args[0], { name: 'P' })
})

test('ModsPDF の PDF（ASCII85 + Flate・TJ の調整・部分埋め込み）から、字ごとの x をそのまま読み戻す', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
  const fontBytes = await loadFontBytes(['sans'], manifest, async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64'))
  const xs = [50, 60.5, 71.25, 90]
  /** @type {any} */
  const layout = {
    meta: { title: 't', lang: 'ja-JP', created: 0 },
    page: { width: 595.28, height: 841.89 },
    pages: [{ ops: [{ t: 'text', font: 'sans', size: 10, color: '#111111', y: 100, tag: 1, glyphs: '日本語A'.split('').map((c, i) => ({ c, x: xs[i] })) }] }],
    tags: [{ role: 'Document', parent: null }, { role: 'P', parent: 0 }],
    outline: [],
    fonts: ['sans'],
  }
  const pdf = await renderPdf(layout, { fontBytes })
  const { pages } = await readPdfChars(Uint8Array.from(Buffer.from(pdf.text, 'latin1')))
  const cs = pages[0].chars
  assert.equal(cs.map((c) => c.c).join(''), '日本語A')
  cs.forEach((c, i) => {
    near(c.x, xs[i], 0.01)
    near(c.y, 841.89 - 100, 0.01)
    near(c.size, 10)
    assert.equal(c.role, 'P')
  })
  near(cs[0].adv, 10, 0.01)
})

test('inkRight: 全角の終わり括弧・句読点は箱の左半分まで、ほかは箱いっぱい', () => {
  const ch = (/** @type {string} */ c, adv = 10) => ({ c, x: 100, y: 0, size: 10, adv, font: 'F', role: null })
  near(inkRight(ch(String.fromCodePoint(0x3002))), 105)
  near(inkRight(ch(String.fromCodePoint(0x3001))), 105)
  near(inkRight(ch(String.fromCodePoint(0x6f22))), 110)
  // 比例幅の引用符（箱が 1em に満たない）は箱いっぱい
  near(inkRight(ch(String.fromCodePoint(0x201d), 5)), 105)
})

test('inkRight: 中点は字面が箱の真ん中の二分にあるので、箱の四分の三まで', () => {
  const ch = (/** @type {string} */ c, adv = 10) => ({ c, x: 100, y: 0, size: 10, adv, font: 'F', role: null })
  near(inkRight(ch(String.fromCodePoint(0x30fb))), 107.5)
  // 比例幅の字（箱が 1em に満たない）は箱いっぱい
  near(inkRight(ch(String.fromCodePoint(0x30fb), 5)), 105)
})

test('字に、役割を決めた印付きの中身が何番目かを付ける（同じ役割が続いても別の印なら番号が違い、入れ子の Span は外側に従う）', async () => {
  const cs = await charsOf('/RT <</MCID 0>> BDC BT /F1 10 Tf 0 0 Td (AB) Tj /Span <</ActualText (x)>> BDC (C) Tj EMC ET EMC /RT <</MCID 1>> BDC BT /F1 10 Tf 0 20 Td (D) Tj ET EMC BT /F1 10 Tf 0 40 Td (E) Tj ET')
  assert.deepEqual(cs.map((c) => c.role), ['RT', 'RT', 'RT', 'RT', null])
  assert.equal(cs[0].mc, cs[1].mc)
  assert.equal(cs[0].mc, cs[2].mc)
  assert.notEqual(cs[3].mc, cs[0].mc)
  assert.equal(cs[4].mc, null)
})

test('markedRuns: 同じ役割の印付きの中身ごとに字をまとめる（位置が離れていても 1 つ、隣り合っていても印が違えば別）', async () => {
  const content = [
    '/RT <</MCID 0>> BDC BT /F1 5 Tf 10 100 Td (ab) Tj 1 0 0 1 80 100 Tm (c) Tj ET EMC',
    '/RT <</MCID 1>> BDC BT /F1 5 Tf 1 0 0 1 86 100 Tm (d) Tj ET EMC',
    '/P <</MCID 2>> BDC BT /F1 10 Tf 1 0 0 1 10 50 Tm (text) Tj ET EMC',
    '/RT <</MCID 3>> BDC BT /F1 5 Tf 1 0 0 1 10 150 Tm (e) Tj ET EMC',
  ].join('\n')
  const { pages } = await readPdfChars(await pdfWith(content))
  const runs = markedRuns(pages, 'RT')
  assert.deepEqual(runs.map((r) => r.chars.map((c) => c.c).join('')), ['abc', 'd', 'e'])
  assert.deepEqual(runs.map((r) => r.page), [0, 0, 0])
  assert.equal(markedRuns(pages, 'P').length, 1)
  assert.deepEqual(markedRuns(pages, 'H1'), [])
})

test('markedRuns: 印の無い字は数えず、頁をまたいでも別の印は別の中身として数える', async () => {
  const one = await readPdfChars(await pdfWith('/RT <</MCID 0>> BDC BT /F1 5 Tf 0 0 Td (a) Tj ET EMC BT /F1 5 Tf 0 0 Td (b) Tj ET'))
  const pages = [one.pages[0], { ...one.pages[0], index: 1, chars: one.pages[0].chars.map((c) => ({ ...c, mc: 99 })) }]
  assert.equal(markedRuns(pages, 'RT').length, 2)
  assert.equal(markedRuns([{ ...one.pages[0], chars: [{ c: 'x', x: 0, y: 0, size: 5, adv: 5, font: 'F', role: 'RT', mc: null }] }], 'RT').length, 0)
})

/** @param {string} text @param {number} y @param {number} x0 @param {number} [size] @param {number} [step] */
const row = (text, y, x0, size = 10, step = 10) =>
  Array.from(text).map((c, i) => ({ c, x: x0 + i * step, y, size, adv: step, font: 'F', role: null }))

test('groupLines: 同じ基線の字を 1 行にし、大きさの違う字・間が開いた字は別の行にし、行の頭と末の空白を外す', () => {
  const body = [...row('本文です ', 700, 50), ...row('表の列', 700, 300)]
  const ruby = row('ほん', 709, 50, 5, 5)
  const lines = groupLines([{ index: 0, width: 595, height: 842, chars: [...ruby, ...body, ...row('次の行', 680, 50)] }], { sizeMin: 9.8, sizeMax: 10.2 })
  assert.deepEqual(lines.map((l) => l.text), ['本文です', '表の列', '次の行'])
  near(lines[0].x1, 90)
  assert.deepEqual(lines.map((l) => l.y), [700, 700, 680])
})

test('lastPageFill: 最後の頁の字が版面のどこまで届いたかの割合（足の字は数えない）', () => {
  const page = (/** @type {import('../scripts/lib-pdftext.mjs').Char[]} */ chars) => ({ index: 0, width: 600, height: 800, chars })
  // 版面は上 50・下 50 の余白で高さ 700。基線が上から 400 → (400-50)/700 = 0.5
  const body = row('字', 800 - 400, 50)
  const foot = row('足', 800 - 770, 50, 8)
  near(lastPageFill([page(row('字', 600, 50)), page([...body, ...foot])], { top: 50, bottom: 50 }), 0.5)
})

/**
 * pdf.js の getTextContent の各項目の先頭の字が、こちらの読みの字と同じ位置（0.05pt 以内）にあるか。
 * pdf.js と別の実装で、行列の掛け方（上下を反す変換）と ToUnicode を一度に確かめる。
 * @param {Uint8Array} bytes
 * @returns {Promise<{ items: number, missed: string[] }>}
 */
async function crossCheck(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { pages } = await readPdfChars(bytes)
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 })
  const pdf = await task.promise
  let items = 0
  /** @type {string[]} */
  const missed = []
  for (let i = 0; i < pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent()
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue
      items++
      const first = Array.from(it.str)[0]
      const hit = pages[i].chars.some((c) => c.c === first && Math.abs(c.x - it.transform[4]) < 0.05 && Math.abs(c.y - it.transform[5]) < 0.05)
      if (!hit) missed.push(`${i + 1} 頁 ${JSON.stringify(it.str.slice(0, 8))}`)
    }
  }
  await task.destroy()
  return { items, missed }
}

test('pdf.js の getTextContent と同じ位置・同じ字を、ModsPDF の PDF の全項目で読む', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
  const fontBytes = await loadFontBytes(['mincho', 'sans'], manifest, async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64'))
  /** @type {any[]} */
  const ops = []
  for (let i = 0; i < 6; i++) {
    ops.push({ t: 'text', font: i % 2 ? 'sans' : 'mincho', size: 9.5 + i, color: '#111111', y: 80 + i * 40, glyphs: Array.from('組版の試験ABC日本語').map((c, k) => ({ c, x: 50 + k * (9.5 + i) * 1.01 })) })
  }
  /** @type {any} */
  const layout = { meta: { title: 't', lang: 'ja-JP', created: 0 }, page: { width: 595.28, height: 841.89 }, pages: [{ ops }], tags: [{ role: 'Document', parent: null }], outline: [], fonts: ['mincho', 'sans'] }
  const pdf = await renderPdf(layout, { fontBytes })
  const r = await crossCheck(Uint8Array.from(Buffer.from(pdf.text, 'latin1')))
  assert.ok(r.items >= 6)
  assert.deepEqual(r.missed, [])
})

test('pdf.js と同じ位置・同じ字を、Typst の PDF（上下を反す変換・FlateDecode だけ）でも読む', { skip: spawnSync('typst', ['--version']).status !== 0 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdftext-'))
  const src = `#set page(width: 300pt, height: 300pt, margin: 20pt)
#set text(font: ("Zen Old Mincho", "Noto Sans JP"), lang: "ja", size: 10pt)
#set par(justify: true)
#"吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。ABC 123 の語。"
#text(weight: "bold", size: 14pt)[#"太字の見出し"]
`
  fs.writeFileSync(path.join(dir, 'a.typ'), src)
  const fontDirs = ['C:/dev/kit/files/fonts', 'C:/Users/nakada/.claude/local-mods/nakada-mods/nakada/skills/typst-pdf/fonts'].filter((p) => fs.existsSync(p))
  const r = spawnSync('typst', ['compile', '--ignore-system-fonts', ...fontDirs.flatMap((d) => ['--font-path', d]), path.join(dir, 'a.typ'), path.join(dir, 'a.pdf')], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'a.pdf')))
  const c = await crossCheck(bytes)
  assert.ok(c.items >= 3)
  assert.deepEqual(c.missed, [])
  const { pages } = await readPdfChars(bytes)
  assert.ok(pages[0].chars.every((ch) => ch.size > 0))
  assert.ok(pages[0].chars.some((ch) => Math.abs(ch.size - 14) < 0.01 && ch.c === '太'))
  fs.rmSync(dir, { recursive: true, force: true })
})
