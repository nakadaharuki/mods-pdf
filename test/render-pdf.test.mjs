// render/pdf と render/tags の試験。本物の書体で手作りの Layout(2 頁)を PDF にし、pdf.js と pdf-lib で読み戻して確かめる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFHexString, PDFRef, decodePDFRawStream, rawFontkit } from '../hooks/vendor/pdf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT_FILES = { mincho: 'ZenOldMincho-JIS-400.ttf', minchoBold: 'ZenOldMincho-JIS-700.ttf', sans: 'NotoSansJP-JIS-400.ttf', sansBold: 'NotoSansJP-JIS-700.ttf' }
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.json'), 'utf8'))
const W = 595.28
const H = 841.89
// 1×1 の PNG
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ---------- 書体と寸法 ----------
const bytesCache = new Map()
function fontBytes(id) {
  if (!bytesCache.has(id)) {
    const parts = manifest[FONT_FILES[id]].parts.map((p) => fs.readFileSync(path.join(ROOT, 'fonts', p)))
    bytesCache.set(id, new Uint8Array(Buffer.concat(parts)))
  }
  return bytesCache.get(id)
}
const fontsOf = (ids) => Object.fromEntries(ids.map((id) => [id, fontBytes(id)]))
const ALL_FONTS = ['mincho', 'minchoBold', 'sans', 'sansBold']

const advCache = new Map()
/** 字の送り幅(em)。renderPdf とは別に fontkit の字形から読む */
function adv(id, c) {
  let f = advCache.get(id)
  if (!f) { f = { font: rawFontkit.create(fontBytes(id)), map: new Map() }; advCache.set(id, f) }
  let a = f.map.get(c)
  if (a === undefined) { a = f.font.layout(c).glyphs[0].advanceWidth / f.font.unitsPerEm; f.map.set(c, a) }
  return a
}

/** 字の列。extra は字ごとの上乗せ(両端揃えの字間に当たる)。7 字ごとに約物の詰めのような負の動きを入れて、調整の数が全部は同じにならないようにする */
function textOp(text, { font = 'mincho', size = 9.5, x = 42, y, color = '#111111', tag, extra = 0.07, actual }) {
  const glyphs = []
  let cx = x
  let i = 0
  for (const c of text) {
    glyphs.push({ c, x: cx })
    cx += adv(font, c) * size + extra + (i % 7 === 6 ? -0.35 * size : 0)
    i++
  }
  const op = { t: 'text', font, size, color, y, glyphs }
  if (tag !== undefined) op.tag = tag
  if (actual !== undefined) op.actual = actual
  return op
}
const charsOf = (op) => op.glyphs.map((g) => g.c).join('')
/** clip の中も含めた描く順の字の op */
function flatText(ops) {
  return ops.flatMap((op) => (op.t === 'text' ? [op] : op.t === 'clip' ? flatText(op.ops) : []))
}

// 構造の番号
const T = { DOC: 0, H1: 1, P: 2, TABLE: 3, TR: 4, TD1: 5, TD2: 6, FIGURE: 7, FORM: 8, LINK: 9, UNUSED: 10 }

function sampleLayout() {
  const page0 = [
    { t: 'rect', x: 42, y: 30, w: 500, h: 24, fill: '#F1F0ED' },
    textOp('ModsPDF の試験　見出し', { font: 'minchoBold', size: 18, y: 50, tag: T.H1 }),
    textOp('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。', { y: 100, tag: T.P }),
    textOp('「ModsPDF」は Claude Code の Mod の中だけで組む PDF です。', { y: 117, tag: T.P, actual: '「ModsPDF」は Claude Code の Mod の中だけで組む PDF です。' }),
    textOp('セル甲', { x: 42, y: 160, tag: T.TD1 }),
    textOp('セル乙', { x: 200, y: 160, tag: T.TD2 }),
    { t: 'rule', x1: 42, y1: 170, x2: 540, y2: 170, w: 0.4, color: '#CCCCC9', dash: [2, 2] },
    { t: 'rect', x: 42, y: 175, w: 120, h: 10, stroke: '#4A4A4A', lw: 0.5 },
    {
      t: 'clip', x: 42, y: 200, w: 200, h: 100,
      ops: [
        { t: 'path', d: 'M 50 290 L 100 220 C 120 210 140 250 180 230 Z', fill: '#999999', stroke: '#111111', lw: 1, opacity: 0.5, fillRule: 'evenodd', cap: 'round', join: 'bevel', dash: [3, 1], tag: T.FIGURE },
        { t: 'rect', x: 60, y: 250, w: 40, h: 30, fill: '#176639', tag: T.FIGURE },
        textOp('グラフ', { font: 'sans', size: 8, x: 70, y: 215, tag: T.FIGURE }),
      ],
    },
    { t: 'image', x: 260, y: 200, w: 40, h: 40, kind: 'png', base64: PNG_1X1, tag: T.FIGURE },
    textOp('example.com へのリンク', { y: 330, tag: T.LINK }),
    { t: 'link', x: 42, y: 320, w: 120, h: 12, url: 'https://example.com/モッズ' },
    { t: 'link', x: 42, y: 340, w: 60, h: 12, url: 'javascript:alert(1)' },
    { t: 'field', kind: 'text', name: 'name', x: 120, y: 400, w: 200, h: 22, value: '山田　太郎', size: 11, tag: T.FORM },
    { t: 'field', kind: 'multiline', name: 'memo', x: 120, y: 430, w: 200, h: 50, value: '一行目\n二行目', tag: T.FORM },
    { t: 'field', kind: 'check', name: 'agree', x: 120, y: 490, w: 14, h: 14, value: true, tag: T.FORM },
    { t: 'field', kind: 'check', name: 'nope', x: 150, y: 490, w: 14, h: 14, value: false, tag: T.FORM },
    { t: 'field', kind: 'choice', name: 'kind', x: 120, y: 520, w: 80, h: 18, options: ['個人', '法人'], value: '法人', tag: T.FORM },
    { t: 'rule', x1: 42, y1: 790, x2: 553, y2: 790, w: 0.5, color: '#CCCCC9' },
    textOp('山田 ／ ModsPDF の試験   1 / 2', { font: 'sans', size: 8, x: 380, y: 805, color: '#4A4A4A' }),
  ]
  const page1 = [
    textOp('続きの段落。折り返した三行目がここに来る。', { y: 100, tag: T.P }),
    { t: 'link', x: 42, y: 200, w: 50, h: 10, url: 'mailto:info@example.com' },
    { t: 'rule', x1: 42, y1: 790, x2: 553, y2: 790, w: 0.5, color: '#CCCCC9' },
    textOp('山田 ／ ModsPDF の試験   2 / 2', { font: 'sans', size: 8, x: 380, y: 805, color: '#4A4A4A' }),
  ]
  return {
    meta: { title: 'ModsPDF の試験', author: '山田', subject: '描画の確かめ', lang: 'ja-JP', created: Date.UTC(2026, 9, 9, 3, 4, 5) },
    page: { width: W, height: H },
    pages: [{ ops: page0 }, { ops: page1 }],
    tags: [
      { role: 'Document', parent: null },
      { role: 'H1', parent: 0 },
      { role: 'P', parent: 0 },
      { role: 'Table', parent: 0 },
      { role: 'TR', parent: 3 },
      { role: 'TD', parent: 4 },
      { role: 'TD', parent: 4 },
      { role: 'Figure', parent: 0, alt: '売上の推移を示す図' },
      { role: 'Form', parent: 0 },
      { role: 'Link', parent: 2 },
      { role: 'L', parent: 0 },
    ],
    outline: [
      { title: 'はじめに', level: 1, page: 0, y: 50 },
      { title: '詳細', level: 2, page: 1, y: 100 },
      { title: '付録', level: 1, page: 1, y: 300 },
    ],
    fonts: ['mincho', 'minchoBold', 'sans'],
    warnings: [],
    stats: {},
  }
}

let samplePromise
function sample() {
  samplePromise ??= (async () => {
    const layout = sampleLayout()
    const r = await renderPdf(layout, { fontBytes: fontsOf(ALL_FONTS), fieldFont: 'sans' })
    return { layout, r, bytes: new Uint8Array(Buffer.from(r.text, 'latin1')) }
  })()
  return samplePromise
}
const openJs = (bytes) => getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise

// ---------- pdf-lib で低い層を読む道具 ----------
const lowLoad = (bytes) => PDFDocument.load(bytes, { updateMetadata: false })
const nameOf = (o) => (o instanceof PDFName ? o.asString().slice(1) : undefined)
const resolve = (ctx, o) => ctx.lookup(o)

function contentOf(doc, pageIndex) {
  const page = doc.getPage(pageIndex)
  const c = page.node.Contents()
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
}

/** 書体の資源名 → { cid → 幅(千分の 1 em) } */
function fontWidths(doc, pageIndex) {
  const ctx = doc.context
  const fonts = doc.getPage(pageIndex).node.Resources().lookup(PDFName.of('Font'), PDFDict)
  const out = new Map()
  for (const [key] of fonts.entries()) {
    const fd = fonts.lookup(key, PDFDict)
    const cid = ctx.lookup(fd.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict)
    const arr = cid.lookup(PDFName.of('W'), PDFArray).asArray().map((x) => resolve(ctx, x))
    const widths = new Map()
    for (let i = 0; i < arr.length;) {
      const c = arr[i].asNumber()
      if (arr[i + 1] instanceof PDFArray) {
        arr[i + 1].asArray().forEach((w, k) => widths.set(c + k, resolve(ctx, w).asNumber()))
        i += 2
      } else {
        const c2 = arr[i + 1].asNumber()
        const w = arr[i + 2].asNumber()
        for (let k = c; k <= c2; k++) widths.set(k, w)
        i += 3
      }
    }
    out.set(key.asString().slice(1), widths)
  }
  return out
}

/** 内容の流れの BT … ET を読み、字ごとの x(pt)に直す */
function textBlocks(doc, pageIndex) {
  const content = contentOf(doc, pageIndex)
  const widths = fontWidths(doc, pageIndex)
  const blocks = []
  const re = /BT\s+\/(\S+)\s+([-\d.]+)\s+Tf\s+1 0 0 1 ([-\d.]+) ([-\d.]+) Tm\s+\[([^\]]*)\]\s+TJ\s+ET/g
  for (const m of content.matchAll(re)) {
    const size = Number(m[2])
    const wmap = widths.get(m[1])
    assert.ok(wmap, `資源の書体 ${m[1]} が見つかる`)
    let x = Number(m[3])
    const xs = []
    for (const t of m[5].matchAll(/<([0-9a-fA-F]*)>|(-?[\d.]+)/g)) {
      if (t[1] !== undefined) {
        for (let k = 0; k < t[1].length; k += 4) {
          const cidv = parseInt(t[1].slice(k, k + 4), 16)
          assert.ok(wmap.has(cidv), `cid ${cidv} の幅が W に有る`)
          xs.push(x)
          x += (wmap.get(cidv) * size) / 1000
        }
      } else {
        x -= (Number(t[2]) * size) / 1000
      }
    }
    blocks.push({ font: m[1], size, x0: Number(m[3]), y: Number(m[4]), xs })
  }
  return blocks
}

// ---------- 構造(StructTreeRoot)を木にして読む ----------
function readStruct(doc) {
  const ctx = doc.context
  const pageIndex = (ref) => doc.getPages().findIndex((p) => p.ref === ref)
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)
  const walk = (ref) => {
    const d = ctx.lookup(ref, PDFDict)
    const role = nameOf(d.get(PDFName.of('S')))
    const pgRef = d.get(PDFName.of('Pg'))
    const pg = pgRef ? pageIndex(pgRef) : -1
    const k = d.get(PDFName.of('K'))
    const kv = k instanceof PDFArray ? k.asArray() : k === undefined ? [] : [k]
    const node = { role, ref, pg, kids: [], marks: [], objr: 0, alt: undefined }
    const alt = d.get(PDFName.of('Alt'))
    if (alt instanceof PDFHexString) node.alt = alt.decodeText()
    for (const item of kv) {
      if (item instanceof PDFNumber) { node.marks.push({ page: pg, mcid: item.asNumber() }); continue }
      const o = ctx.lookup(item)
      if (o instanceof PDFNumber) { node.marks.push({ page: pg, mcid: o.asNumber() }); continue }
      const type = nameOf(o.get(PDFName.of('Type')))
      if (type === 'MCR') node.marks.push({ page: pageIndex(o.get(PDFName.of('Pg'))), mcid: o.lookup(PDFName.of('MCID'), PDFNumber).asNumber(), mcr: true })
      else if (type === 'OBJR') node.objr++
      else node.kids.push(walk(item))
    }
    return node
  }
  return { root, tree: walk(root.get(PDFName.of('K'))) }
}
const findAll = (node, role, out = []) => {
  if (node.role === role) out.push(node)
  for (const c of node.kids) findAll(c, role, out)
  return out
}

// ---------- 試験 ----------
test('7 ビットの字だけで 4 MiB 未満・頁の数と bytes が合う', async () => {
  const { r } = await sample()
  assert.match(r.text, /^[\x00-\x7f]*$/)
  assert.ok(r.text.length < 4 * 1024 * 1024)
  assert.equal(r.pages, 2)
  assert.equal(r.bytes, r.text.length)
  assert.ok(Array.isArray(r.warnings))
  assert.ok(r.text.startsWith('%PDF-'))
})

test('pdf.js で読んだ字が入力の字と同じで、順も同じ', async () => {
  const { layout, bytes } = await sample()
  const pdf = await openJs(bytes)
  assert.equal(pdf.numPages, 2)
  for (let p = 0; p < 2; p++) {
    const tc = await (await pdf.getPage(p + 1)).getTextContent()
    const got = tc.items.map((i) => i.str).join('').replace(/\s+/g, '')
    const want = flatText(layout.pages[p].ops).map(charsOf).join('').replace(/\s+/g, '')
    assert.equal(got, want, `頁 ${p + 1} の字`)
  }
})

test('1 行の字の x が Display List の x と 0.05pt 以内で、基線の y が裏返っている', async () => {
  const { layout, bytes } = await sample()
  const doc = await lowLoad(bytes)
  for (let p = 0; p < 2; p++) {
    const ops = flatText(layout.pages[p].ops)
    const blocks = textBlocks(doc, p)
    assert.equal(blocks.length, ops.length, `頁 ${p + 1} の字の塊の数`)
    ops.forEach((op, i) => {
      const b = blocks[i]
      assert.equal(b.xs.length, op.glyphs.length, `${charsOf(op)} の字数`)
      assert.ok(Math.abs(b.size - op.size) < 1e-6)
      assert.ok(Math.abs(b.y - (H - op.y)) < 0.01, `基線 ${charsOf(op)}`)
      op.glyphs.forEach((g, k) => assert.ok(Math.abs(b.xs[k] - g.x) <= 0.05, `${charsOf(op)} の ${k} 字目: PDF ${b.xs[k]} / 入力 ${g.x}`))
    })
  }
})

test('字の調整が全部は 0 でなく、ぴったり並ぶ字には調整を入れない', async () => {
  const { bytes } = await sample()
  const content = contentOf(await lowLoad(bytes), 0)
  assert.match(content, /\]\s+TJ/)
  assert.match(content, />-?\d+(\.\d+)?</, '字と字の間に調整の数が入る')
  // 送り幅どおりに並べた字: 調整は 1 つも入らず、1 つの 16 進の列になる
  const exact = { t: 'text', font: 'mincho', size: 10, color: '#000000', y: 100, glyphs: [] }
  let x = 50
  for (const c of 'ぴったり並ぶ') { exact.glyphs.push({ c, x }); x += adv('mincho', c) * 10 }
  const layout = { ...sampleLayout(), pages: [{ ops: [exact] }], tags: [{ role: 'Document', parent: null }], outline: [], fonts: ['mincho'] }
  return renderPdf(layout, { fontBytes: fontsOf(['mincho']) }).then(async (r) => {
    const c = contentOf(await lowLoad(new Uint8Array(Buffer.from(r.text, 'latin1'))), 0)
    const tj = /\[([^\]]*)\]\s+TJ/.exec(c)
    assert.match(tj[1], /^<[0-9a-f]+>$/i)
  })
})

test('文書の情報: 題名・作者・主題・言語 ja-JP・作成者・作成日時・題名を窓に出す', async () => {
  const { bytes } = await sample()
  const pdf = await openJs(bytes)
  const { info } = await pdf.getMetadata()
  assert.equal(info.Title, 'ModsPDF の試験')
  assert.equal(info.Author, '山田')
  assert.equal(info.Subject, '描画の確かめ')
  assert.equal(info.Language, 'ja-JP')
  assert.equal(info.Creator, 'ModsPDF')
  assert.equal(info.Producer, 'ModsPDF (pdf-lib 1.17.1)')
  assert.match(info.CreationDate, /^D:20261009030405/)
  assert.match(info.ModDate, /^D:20261009030405/)
  assert.equal((await pdf.getViewerPreferences()).get('DisplayDocTitle'), true)
})

test('しおりの題が読め、level で入れ子になり、行き先の y が頁の下から数えた値になる', async () => {
  const { bytes } = await sample()
  const pdf = await openJs(bytes)
  const outline = await pdf.getOutline()
  assert.deepEqual(outline.map((o) => o.title), ['はじめに', '付録'])
  assert.deepEqual(outline[0].items.map((o) => o.title), ['詳細'])
  assert.ok(Math.abs(outline[0].dest[3] - (H - 50)) < 0.01)
  assert.equal(await pdf.getPageIndex(outline[0].items[0].dest[0]), 1)
})

test('構造: H1 が 1 つ・2 頁にまたがる P は 1 つの要素・Figure に Alt・使われない tag は要素にしない', async () => {
  const { bytes } = await sample()
  const doc = await lowLoad(bytes)
  const { tree } = readStruct(doc)
  assert.equal(tree.role, 'Document')
  assert.equal(findAll(tree, 'H1').length, 1)
  const ps = findAll(tree, 'P')
  assert.equal(ps.length, 1, 'P は段落 1 つ')
  const pages = new Set(ps[0].marks.map((m) => m.page))
  assert.deepEqual([...pages].sort(), [0, 1], '両方の頁の中身を持つ')
  assert.ok(ps[0].marks.some((m) => m.mcr), '別の頁の中身は MCR')
  const figures = findAll(tree, 'Figure')
  assert.equal(figures.length, 1)
  assert.equal(figures[0].alt, '売上の推移を示す図')
  assert.equal(findAll(tree, 'L').length, 0)
  // 子だけの Table / TR も要素にする
  const table = findAll(tree, 'Table')
  assert.equal(table.length, 1)
  assert.equal(table[0].marks.length, 0)
  assert.equal(findAll(table[0], 'TR').length, 1)
  assert.equal(findAll(table[0], 'TD').length, 2)
  // P の中の Link は P の子で、読む順(P の 2 行 → Link → 次の頁の続き)に並ぶ
  assert.equal(ps[0].kids.length, 1)
  assert.equal(ps[0].kids[0].role, 'Link')
  const rawK = doc.context.lookup(ps[0].ref, PDFDict).lookup(PDFName.of('K'), PDFArray).asArray()
  const kinds = rawK.map((k) => {
    const o = doc.context.lookup(k)
    if (o instanceof PDFNumber) return 'mcid'
    return nameOf(o.get(PDFName.of('Type'))) === 'MCR' ? 'mcr' : 'elem:' + nameOf(o.get(PDFName.of('S')))
  })
  assert.deepEqual(kinds, ['mcid', 'elem:Link', 'mcr'], 'K は描いた順(頁 1 の字・Link・頁 2 の続き)')
  // 記入欄は Form の OBJR
  const form = findAll(tree, 'Form')
  assert.equal(form.length, 1)
  assert.equal(form[0].objr, 5)
})

test('構造: 要素の数はブロックの数に近く、行の数にならない(ParentTree は頁の MCID 順)', async () => {
  const { bytes } = await sample()
  const doc = await lowLoad(bytes)
  const { root, tree } = readStruct(doc)
  const count = (n) => 1 + n.kids.reduce((s, k) => s + count(k), 0)
  // Document + H1 + P + Link + Table + TR + TD*2 + Figure + Form
  assert.equal(count(tree), 10)
  const pt = root.lookup(PDFName.of('ParentTree'), PDFDict)
  const nums = pt.lookup(PDFName.of('Nums'), PDFArray).asArray()
  assert.equal(root.lookup(PDFName.of('ParentTreeNextKey'), PDFNumber).asNumber(), nums.length / 2)
  const keys = nums.filter((_, i) => i % 2 === 0).map((n) => n.asNumber())
  assert.deepEqual(keys, keys.map((_, i) => i), '番号は 0 から続く')
  for (let p = 0; p < 2; p++) {
    const key = doc.getPage(p).node.lookup(PDFName.of('StructParents'), PDFNumber).asNumber()
    const arr = doc.context.lookup(nums[key * 2 + 1], PDFArray).asArray()
    // 頁 p の MCID n の要素 = 構造の要素がその MCID を持つ要素
    const owners = new Map()
    const walk = (nd) => { nd.marks.forEach((m) => { if (m.page === p) owners.set(m.mcid, nd.ref) }); nd.kids.forEach(walk) }
    walk(tree)
    assert.equal(arr.length, owners.size, `頁 ${p + 1} の MCID の数`)
    arr.forEach((ref, mcid) => assert.equal(ref, owners.get(mcid), `頁 ${p + 1} の MCID ${mcid} の持ち主`))
  }
  assert.equal(doc.catalog.lookup(PDFName.of('MarkInfo'), PDFDict).get(PDFName.of('Marked')).asBoolean(), true)
})

test('構造: 同じ tag が続く字は 1 つの中身にまとまり、tag の無い物は Artifact になる', async () => {
  const { bytes } = await sample()
  const c = contentOf(await lowLoad(bytes), 0)
  assert.equal([...c.matchAll(/\/P <<\/MCID \d+>> BDC/g)].length, 1, '同じ P の 2 行は 1 つの中身(MCID)にまとまる')
  assert.match(c, /\/Artifact BMC/)
  assert.equal([...c.matchAll(/\bEMC\b/g)].length, [...c.matchAll(/\bBDC\b|\bBMC\b/g)].length, 'BDC/BMC と EMC の数が合う')
  assert.match(c, /\/H1 <<\/MCID 0>> BDC/, 'MCID は頁ごとに 0 から')
  assert.match(c, /\/Span <<\/ActualText <FEFF[0-9A-F]+> >> BDC/, 'actual のある字は ActualText で包む')
  assert.ok(c.indexOf('/Figure') > c.indexOf(' W n'), 'Figure の中身は clip の中')
  const c1 = contentOf(await lowLoad(bytes), 1)
  assert.match(c1, /\/P <<\/MCID 0>> BDC/, '2 頁目も MCID は 0 から')
})

test('pdf.js の構造: 頁ごとに H1・P・Table が読め、Figure に alt、Lang は ja-JP', async () => {
  const { bytes } = await sample()
  const pdf = await openJs(bytes)
  const flat = (n, out = []) => { out.push(n); (n.children ?? []).forEach((c) => flat(c, out)); return out }
  const t0 = flat(await (await pdf.getPage(1)).getStructTree())
  const t1 = flat(await (await pdf.getPage(2)).getStructTree())
  const roles = (t) => t.map((n) => n.role).filter(Boolean)
  assert.equal(roles(t0).filter((r) => r === 'H1').length, 1)
  assert.equal(roles(t0).filter((r) => r === 'P').length, 1)
  assert.equal(roles(t1).filter((r) => r === 'P').length, 1, '2 頁目にも同じ P が出る')
  assert.ok(roles(t0).includes('Table'))
  assert.ok(roles(t0).includes('TD'))
  const fig = t0.find((n) => n.role === 'Figure')
  assert.equal(fig.alt, '売上の推移を示す図')
  assert.equal((await pdf.getMetadata()).info.Language, 'ja-JP')
})

test('記入欄: pdf.js で text は日本語の値・チェック欄は on・選び欄は選んだ値が読める', async () => {
  const { bytes } = await sample()
  const pdf = await openJs(bytes)
  const annots = await (await pdf.getPage(1)).getAnnotations()
  const f = Object.fromEntries(annots.filter((a) => a.subtype === 'Widget').map((a) => [a.fieldName, a]))
  assert.deepEqual(Object.keys(f).sort(), ['agree', 'kind', 'memo', 'name', 'nope'])
  assert.equal(f.name.fieldValue, '山田　太郎')
  assert.equal(f.memo.fieldValue.replace(/\r\n?/g, '\n'), '一行目\n二行目')
  assert.equal(f.memo.multiLine, true)
  assert.ok(f.agree.checkBox)
  assert.notEqual(f.agree.fieldValue, 'Off')
  assert.equal(f.nope.fieldValue, 'Off')
  assert.deepEqual([].concat(f.kind.fieldValue), ['法人'])
  assert.deepEqual(f.kind.options.map((o) => o.displayValue), ['個人', '法人'])
})

test('チェック欄: 保存し直して読み込んでも /V と /AS が同じ on の名前で、未チェックは Off のまま', async () => {
  const { bytes } = await sample()
  const once = await lowLoad(bytes)
  const again = await lowLoad(await once.save({ updateFieldAppearances: false }))
  for (const doc of [once, again]) {
    const form = doc.getForm()
    const on = form.getCheckBox('agree')
    const off = form.getCheckBox('nope')
    assert.equal(on.isChecked(), true)
    assert.equal(off.isChecked(), false)
    const v = on.acroField.dict.get(PDFName.of('V'))
    const as = on.acroField.getWidgets()[0].dict.get(PDFName.of('AS'))
    assert.ok(v instanceof PDFName && as instanceof PDFName)
    assert.notEqual(v.asString(), '/Off')
    assert.equal(as, v, '/AS は /V と同じ名前')
    assert.equal(off.acroField.getWidgets()[0].dict.get(PDFName.of('AS')).asString(), '/Off')
  }
})

test('欄の書体: 丸ごと埋め込まれ、AcroForm の DR と欄の DA がそれを指す(見る人が打った字も出る)', async () => {
  const { bytes } = await sample()
  const doc = await lowLoad(bytes)
  const acro = doc.getForm().acroForm.dict
  const dr = acro.lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict)
  assert.equal(dr.entries().length, 1)
  const [key, ref] = dr.entries()[0]
  const fontDict = doc.context.lookup(ref, PDFDict)
  const cid = doc.context.lookup(fontDict.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict)
  const desc = cid.lookup(PDFName.of('FontDescriptor'), PDFDict)
  const file = desc.lookup(PDFName.of('FontFile2'))
  // 丸ごと = 字形が全部。使った字だけの書体(数十 KB)よりずっと大きい
  assert.ok(file.getContentsSize() > 500 * 1024, `欄の書体の大きさ ${file.getContentsSize()}`)
  assert.match(String(acro.get(PDFName.of('DA'))), new RegExp(key.asString().slice(1)))
  const tf = doc.getForm().getTextField('name')
  assert.match(tf.acroField.getDefaultAppearance(), new RegExp(`/${key.asString().slice(1)} 11 Tf`), '欄の字の大きさは size')
})

test('リンク: https は /A /URI で入り、ASCII の外は %XX、javascript: は捨てて warnings に書く', async () => {
  const { bytes, r } = await sample()
  const pdf = await openJs(bytes)
  const links = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Link')
  assert.equal(links.length, 1)
  assert.equal(links[0].url, 'https://example.com/%E3%83%A2%E3%83%83%E3%82%BA')
  assert.ok(Math.abs(links[0].rect[1] - (H - 332)) < 0.01)
  assert.ok(r.warnings.some((w) => w.includes('javascript:')))
  const mail = (await (await pdf.getPage(2)).getAnnotations()).filter((a) => a.subtype === 'Link')
  assert.equal(mail.length, 1)
  assert.equal(mail[0].url, 'mailto:info@example.com')
})

test('図形: 不透明度は ExtGState の ca と CA・破線と端と結びと evenodd・clip は q re W n', async () => {
  const { bytes } = await sample()
  const doc = await lowLoad(bytes)
  const c = contentOf(doc, 0)
  const gs = doc.getPage(0).node.Resources().lookup(PDFName.of('ExtGState'), PDFDict)
  assert.equal(gs.entries().length, 1)
  const g = doc.context.lookup(gs.entries()[0][1], PDFDict)
  assert.equal(g.lookup(PDFName.of('ca'), PDFNumber).asNumber(), 0.5)
  assert.equal(g.lookup(PDFName.of('CA'), PDFNumber).asNumber(), 0.5)
  assert.match(c, /\/GS[\w-]* gs/)
  assert.match(c, /\[3 1\] 0 d/)
  assert.match(c, /\n1 J\n/)
  assert.match(c, /\n2 j\n/)
  assert.match(c, /B\*\nQ/)
  assert.match(c, /q\n[-\d. ]+ re W n/)
  assert.match(c, /\n[-\d.]+ [-\d.]+ m\n[-\d.]+ [-\d.]+ l\n[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ c\nh\n/, 'M L C Z が m l c h になる')
  // 画像は XObject
  const xo = doc.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict)
  assert.equal(xo.entries().length, 1)
  assert.match(c, /\/Im[\w-]* Do/)
})

test('埋め込む書体は Layout.fonts と欄の書体だけ(使っていない書体は入れない)', async () => {
  const { bytes } = await sample()
  const doc = await lowLoad(bytes)
  const type0 = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Subtype')) === PDFName.of('Type0'))
  assert.equal(type0.length, 3 + 1, 'mincho・minchoBold・sans と欄の書体')
})

test('書体に無い字・Layout.fonts に無い書体・7pt 未満の字は warnings に出る', async () => {
  const layout = sampleLayout()
  layout.pages = [{ ops: [textOp('絵😀字', { y: 100, tag: T.P }), textOp('ゴ', { font: 'sansBold', y: 120, tag: T.P }), textOp('小', { size: 6, y: 140 })] }]
  layout.outline = []
  const r = await renderPdf(layout, { fontBytes: fontsOf(ALL_FONTS) })
  assert.ok(r.warnings.some((w) => w.includes('U+1F600')), r.warnings.join('\n'))
  assert.ok(r.warnings.some((w) => w.includes('sansBold') && w.includes('Layout.fonts')))
  assert.ok(r.warnings.some((w) => w.includes('7pt 未満') && w.includes('6pt')))
})

test('壊れた入力は他を巻き込まない: 重複した欄名・読めない path・存在しない tag・悪い色', async () => {
  const layout = sampleLayout()
  layout.fonts = ['mincho', 'sans']
  layout.pages = [{
    ops: [
      { t: 'field', kind: 'text', name: 'dup', x: 10, y: 10, w: 100, h: 20, value: 'a' },
      { t: 'field', kind: 'text', name: 'dup', x: 10, y: 40, w: 100, h: 20, value: 'b' },
      { t: 'field', kind: 'choice', name: 'c', x: 10, y: 70, w: 100, h: 20, options: ['x'], value: 'y' },
      { t: 'path', d: 'M 1 2 Q 3 4 5 6', fill: '#000000' },
      { t: 'path', d: 'L 1 2 L 3 4', stroke: '#000000' },
      { t: 'rect', x: 1, y: 1, w: 5, h: 5, fill: 'red', tag: 99 },
      textOp('字', { y: 100, tag: 99 }),
    ],
  }]
  layout.outline = [{ title: '範囲外', level: 1, page: 9, y: 0 }]
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho', 'sans']) })
  const w = r.warnings.join('\n')
  assert.match(w, /dup/)
  assert.match(w, /path の d/)
  assert.match(w, /tag 99/)
  assert.match(w, /色 red/)
  assert.match(w, /選択肢に無い/)
  assert.match(w, /しおり/)
  const pdf = await openJs(new Uint8Array(Buffer.from(r.text, 'latin1')))
  const names = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Widget').map((a) => a.fieldName).sort()
  assert.deepEqual(names, ['c', 'dup'])
})

test('頁が空・書体のバイト列が無い時は投げる', async () => {
  const layout = sampleLayout()
  await assert.rejects(renderPdf({ ...layout, pages: [] }, { fontBytes: fontsOf(ALL_FONTS) }), /頁/)
  await assert.rejects(renderPdf(layout, { fontBytes: fontsOf(['mincho']) }), /fontBytes/)
})

test('10 頁・1 頁 40 行を 1.5 秒以内に描く', async () => {
  const lines = []
  const body = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'
  const pages = []
  for (let p = 0; p < 10; p++) {
    const ops = []
    for (let l = 0; l < 40; l++) ops.push(textOp(body.slice(l % 7, 40 + (l % 7)), { y: 60 + l * 17, tag: 2, extra: 0.03 }))
    ops.push(textOp(`${p + 1} / 10`, { font: 'sans', size: 8, x: 500, y: 805 }))
    pages.push({ ops })
  }
  lines.push(pages)
  const layout = { ...sampleLayout(), pages, outline: [], fonts: ['mincho', 'sans'] }
  const input = { fontBytes: fontsOf(['mincho', 'sans']) }
  const times = []
  let last
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now()
    last = await renderPdf(layout, input)
    times.push(performance.now() - t0)
  }
  assert.equal(last.pages, 10)
  assert.ok(Math.min(...times) <= 1500, `10 頁の描画 ${times.map((t) => Math.round(t)).join('・')}ms`)
})

// ---------- 追加の試験 ----------
const bytesOf = (r) => new Uint8Array(Buffer.from(r.text, 'latin1'))
const oneLine = (extra = {}) => ({
  ...sampleLayout(),
  pages: [{ ops: [textOp('試験', { y: 100, tag: 1 })] }],
  tags: [{ role: 'Document', parent: null }, { role: 'P', parent: 0 }],
  outline: [],
  fonts: ['mincho'],
  ...extra,
})

test('親が輪・範囲外・自分自身の tag は Document につなぎ直し、全部が 1 つの木に入る', async () => {
  const layout = oneLine({
    pages: [{ ops: [textOp('甲', { y: 50, tag: 1 }), textOp('乙', { y: 60, tag: 2 }), textOp('丙', { y: 70, tag: 3 }), textOp('丁', { y: 80, tag: 4 })] }],
    tags: [
      { role: 'Document', parent: null },
      { role: 'P', parent: 2 },
      { role: 'Span', parent: 1 },
      { role: 'H2', parent: 99 },
      { role: 'H3', parent: 4 },
    ],
  })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho']) })
  const { tree } = readStruct(await lowLoad(bytesOf(r)))
  const count = (n) => 1 + n.kids.reduce((s, k) => s + count(k), 0)
  assert.equal(count(tree), 5)
  assert.equal(findAll(tree, 'H2').length + findAll(tree, 'H3').length + findAll(tree, 'P').length + findAll(tree, 'Span').length, 4)
})

test('描けない字(制御字)は飛ばしても、あとの字の位置は入力の x のまま', async () => {
  const layout = oneLine({
    pages: [{ ops: [{ t: 'text', font: 'mincho', size: 10, color: '#111111', y: 100, glyphs: [{ c: 'あ', x: 10 }, { c: '\n', x: 20 }, { c: 'い', x: 30.5 }, { c: 'う', x: 60 }] }] }],
  })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho']) })
  const [b] = textBlocks(await lowLoad(bytesOf(r)), 0)
  assert.deepEqual(b.xs.map((x) => Math.round(x * 100) / 100), [10, 30.5, 60])
})

test('JPEG も描け、読めない画像は warnings に書いて他を描き続ける', async () => {
  const jpg = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
  const layout = oneLine({
    pages: [{
      ops: [
        { t: 'image', x: 10, y: 10, w: 20, h: 20, kind: 'jpg', base64: jpg },
        { t: 'image', x: 40, y: 10, w: 20, h: 20, kind: 'png', base64: 'data:image/png;base64,' + PNG_1X1 },
        { t: 'image', x: 70, y: 10, w: 20, h: 20, kind: 'png', base64: '!!!!' },
        textOp('試験', { y: 100, tag: 1 }),
      ],
    }],
  })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho']) })
  assert.ok(r.warnings.some((w) => w.includes('画像')), r.warnings.join('\n'))
  const doc = await lowLoad(bytesOf(r))
  const xo = doc.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict)
  const filters = xo.entries().map(([, ref]) => String(doc.context.lookup(ref).dict.get(PDFName.of('Filter'))))
  assert.equal(filters.length, 2)
  assert.ok(filters.some((f) => f.includes('DCTDecode')))
  assert.equal(textBlocks(doc, 0).length, 1)
})

test('欄の書体のバイト列が無い時は別の書体で作り warnings に書く・チェック欄だけなら書体を入れない', async () => {
  const layout = oneLine({ pages: [{ ops: [textOp('試験', { y: 100, tag: 1 }), { t: 'field', kind: 'text', name: 'a', x: 10, y: 10, w: 80, h: 20, value: '値' }] }] })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho']), fieldFont: 'sansBold' })
  assert.ok(r.warnings.some((w) => w.includes('sansBold') && w.includes('mincho')), r.warnings.join('\n'))
  const only = oneLine({ pages: [{ ops: [textOp('試験', { y: 100, tag: 1 }), { t: 'field', kind: 'check', name: 'c', x: 10, y: 10, w: 14, h: 14, value: true }] }] })
  const r2 = await renderPdf(only, { fontBytes: fontsOf(['mincho']) })
  const doc = await lowLoad(bytesOf(r2))
  const type0 = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Subtype')) === PDFName.of('Type0'))
  assert.equal(type0.length, 1)
  assert.ok(r2.text.length < 400 * 1024)
})

/** 圧縮が効かない RGB の PNG(PDF の大きさを任意に膨らませる) */
function randomPng(side) {
  const raw = Buffer.alloc((side * 3 + 1) * side)
  for (let y = 0; y < side; y++) crypto.randomFillSync(raw, y * (side * 3 + 1) + 1, side * 3)
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(side, 0)
  ihdr.writeUInt32BE(side, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}

test('丸ごとの欄の書体で 4 MiB を超えたら、欄の書体も絞って作り直し warnings に書く', async () => {
  // 欄の書体に明朝(丸ごとで 3.3 MiB)を使い、そこへ約 1 MiB の画像を足して超えさせる。絞れば画像だけ(約 1.3 MiB)で収まる
  const png = randomPng(580)
  const layout = oneLine({
    pages: [{ ops: [textOp('試験', { y: 100, tag: 1 }), { t: 'image', x: 10, y: 10, w: 50, h: 50, kind: 'png', base64: png }, { t: 'field', kind: 'text', name: 'a', x: 10, y: 200, w: 100, h: 20, value: '値' }] }],
  })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho']), fieldFont: 'mincho' })
  assert.ok(r.text.length < 4 * 1024 * 1024)
  assert.ok(r.text.length > 1024 * 1024, '画像が入っている')
  assert.ok(r.warnings.some((w) => w.includes('記入欄に新しく打った字は出ない事がある')), r.warnings.join('\n'))
  const pdf = await openJs(bytesOf(r))
  const w = (await (await pdf.getPage(1)).getAnnotations()).find((a) => a.subtype === 'Widget')
  assert.equal(w.fieldValue, '値')
  // 絞った後でも欄の書体は埋め込まれている(書体は 1 つだけ軽くなる)
  const doc = await lowLoad(bytesOf(r))
  assert.equal(doc.getForm().acroForm.dict.lookup(PDFName.of('DR'), PDFDict).lookup(PDFName.of('Font'), PDFDict).entries().length, 1)
})

test('絞っても 4 MiB を超える時は投げる', async () => {
  const layout = oneLine({
    pages: [{ ops: [textOp('試験', { y: 100, tag: 1 }), { t: 'image', x: 10, y: 10, w: 50, h: 50, kind: 'png', base64: randomPng(1130) }] }],
  })
  await assert.rejects(renderPdf(layout, { fontBytes: fontsOf(['mincho']) }), /4 MiB/)
})

test('部品の中に Node の物・ドルと点の並び・動的 import・eval が無く、import は相対パスだけ', () => {
  for (const f of ['pdf.mjs', 'tags.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'hooks', 'render', f), 'utf8')
    assert.ok(src.startsWith('// @ts-check'), `${f} の頭`)
    assert.doesNotMatch(src, /\$\./, `${f}: ドルと点の並び`)
    assert.doesNotMatch(src, /\b(process|Buffer|setTimeout|setInterval|require|global|globalThis)\b/, `${f}: Node の物`)
    assert.doesNotMatch(src, /\beval\s*\(|new\s+Function\b|\bimport\s*\(/, `${f}: 文字列からのコード・動的 import`)
    for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(m[1], /^\.\.?\//, `${f}: import ${m[1]}`)
  }
})

// フックと同じ環境(vm・Node の物なし・タイマーなし)で、手作りの Layout が描けて同じ字・構造になる。
// 子のプロセスで --experimental-vm-modules を使う(試験の起動は node --test だけで足りるように)。
// 外の領域の配列を pdf-lib が弾くので、Layout の JSON も書体の base64 も vm の中で解く。
const VM_ENTRY = [
  "import { renderPdf } from './render/pdf.mjs'",
  "import { joinB64 } from './vendor/pdf.mjs'",
  'const layout = JSON.parse(host.layoutJson)',
  'const fontBytes = {}',
  'for (const id of layout.fonts) fontBytes[id] = joinB64(JSON.parse(host.fontParts(id)))',
  "const r = await renderPdf(layout, { fontBytes, fieldFont: 'sans' })",
  'host.done(r.text, JSON.stringify({ pages: r.pages, bytes: r.bytes, warnings: r.warnings, seven: !/[^\\x00-\\x7f]/.test(r.text) }))',
].join('\n')

const VM_RUNNER = [
  "import vm from 'node:vm'",
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const root = process.env.MP_ROOT',
  'const globals = Object.create(null)',
  'Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance, console })',
  "const manifest = JSON.parse(fs.readFileSync(path.join(root, 'fonts', 'fonts.json'), 'utf8'))",
  'const files = JSON.parse(process.env.MP_FONT_FILES)',
  'globals.host = {',
  "  layoutJson: fs.readFileSync(process.env.MP_LAYOUT, 'utf8'),",
  "  fontParts: (id) => JSON.stringify(manifest[files[id]].parts.map((p) => fs.readFileSync(path.join(root, 'fonts', p)).toString('base64'))),",
  "  done: (text, meta) => { fs.writeFileSync(process.env.MP_OUT, text, 'latin1'); console.log(meta) },",
  '}',
  'const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })',
  'const cache = new Map()',
  'const load = (file) => {',
  "  if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }))",
  '  return cache.get(file)',
  '}',
  'const linker = async (spec, ref) => load(path.resolve(path.dirname(ref.identifier), spec))',
  "const entry = new vm.SourceTextModule(process.env.MP_ENTRY, { identifier: path.join(root, 'hooks', 'entry-for-test.mjs'), context })",
  'await entry.link(linker)',
  'await entry.evaluate()',
].join('\n')

test('フックと同じ vm(Node の物なし)で描けて、pdf.js が同じ字と構造を読める', async () => {
  const layout = sampleLayout()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modspdf-'))
  const layoutPath = path.join(dir, 'layout.json')
  const outPath = path.join(dir, 'out.pdf')
  fs.writeFileSync(layoutPath, JSON.stringify(layout))
  try {
    const res = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-'], {
      input: VM_RUNNER,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, MP_ROOT: ROOT, MP_LAYOUT: layoutPath, MP_OUT: outPath, MP_ENTRY: VM_ENTRY, MP_FONT_FILES: JSON.stringify(FONT_FILES) },
    })
    assert.equal(res.status, 0, res.stderr)
    const meta = JSON.parse(res.stdout.trim().split('\n').pop())
    assert.equal(meta.pages, 2)
    assert.equal(meta.seven, true)
    assert.ok(meta.bytes < 4 * 1024 * 1024)
    const bytes = new Uint8Array(fs.readFileSync(outPath))
    const pdf = await openJs(bytes)
    assert.equal(pdf.numPages, 2)
    for (let p = 0; p < 2; p++) {
      const tc = await (await pdf.getPage(p + 1)).getTextContent()
      assert.equal(tc.items.map((i) => i.str).join('').replace(/\s+/g, ''), flatText(layout.pages[p].ops).map(charsOf).join('').replace(/\s+/g, ''))
    }
    const { tree } = readStruct(await lowLoad(bytes))
    assert.equal(findAll(tree, 'P').length, 1)
    const widgets = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Widget')
    assert.equal(widgets.find((a) => a.fieldName === 'name').fieldValue, '山田　太郎')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('複数行の欄: 長い日本語は初めの見た目を折り返し、値(V)は元の字のまま', async () => {
  const long = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'
  const layout = oneLine({ pages: [{ ops: [textOp('試験', { y: 100, tag: 1 }), { t: 'field', kind: 'multiline', name: 'memo', x: 20, y: 120, w: 200, h: 80, value: long, size: 10 }] }] })
  const r = await renderPdf(layout, { fontBytes: fontsOf(['mincho', 'sans']) })
  const doc = await lowLoad(bytesOf(r))
  const widget = doc.getForm().getTextField('memo').acroField.getWidgets()[0]
  const ap = doc.context.lookup(widget.getAppearances().normal)
  const stream = new TextDecoder().decode(decodePDFRawStream(ap).decode())
  assert.ok([...stream.matchAll(/\bTj\b/g)].length >= 3, '3 行以上に折り返している')
  const pdf = await openJs(bytesOf(r))
  const f = (await (await pdf.getPage(1)).getAnnotations()).find((a) => a.subtype === 'Widget')
  assert.equal(f.fieldValue, long)
})
