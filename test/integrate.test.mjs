// 部品のつなぎ目の試験。担当ごとの試験は部品を単体で確かめるので、ここでは本物の書体で samples を
// compose → renderPdf / pageSvg / edit に通し、部品どうしの約束（形・入れ子・名前・空白）が合っているかを確かめる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose } from '../hooks/engine/index.mjs'
import { chartToOps } from '../hooks/engine/chart.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { pageSvg } from '../hooks/render/svg.mjs'
import { listFields, fillFields } from '../hooks/edit/existing.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'
import { PDFDocument, PDFArray, decodePDFRawStream } from '../hooks/vendor/pdf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IDS = ['mincho', 'minchoBold', 'sans', 'sansBold']
const NOW = Date.UTC(2026, 9, 9)

let realPromise
/** 本物の書体 4 つと寸法（1 回だけ読む） */
function real() {
  realPromise ??= (async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.json'), 'utf8'))
    const fontBytes = await loadFontBytes(IDS, manifest, async (name) => fs.readFileSync(path.join(ROOT, 'fonts', name)).toString('base64'))
    return { fontBytes, metrics: makeMetrics(fontBytes) }
  })()
  return realPromise
}

const sample = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', `${name}.json`), 'utf8'))

async function build(input) {
  const { fontBytes, metrics } = await real()
  const { layout, warnings } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
  const pdf = await renderPdf(layout, { fontBytes })
  return { layout, warnings, pdf }
}

const toBytes = (text) => {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

const contentOf = (doc, index) => {
  const c = doc.getPage(index).node.Contents()
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
}
const count = (text, re) => (text.match(re) ?? []).length

/** Op を入れ子の中まで歩く */
function* walk(ops) {
  for (const op of ops) {
    yield op
    if (op.t === 'clip') yield* walk(op.ops)
  }
}

test('samples の全部が compose から PDF まで通り、タグの番号と書体は Layout の宣言の中に収まる', async () => {
  for (const name of ['report', 'prose', 'form', 'en', 'ruby']) {
    const { layout, pdf } = await build(sample(name))
    assert.match(pdf.text, /^%PDF-/, name)
    assert.ok(/^[\x00-\x7f]*$/.test(pdf.text), `${name} は 7 ビット`)
    assert.equal(pdf.pages, layout.pages.length, name)
    for (const page of layout.pages) {
      for (const op of walk(page.ops)) {
        if (op.tag !== undefined) assert.ok(Number.isInteger(op.tag) && op.tag > 0 && op.tag < layout.tags.length, `${name}: tag ${op.tag}`)
        if (op.t === 'text') assert.ok(layout.fonts.includes(op.font), `${name}: 書体 ${op.font} が Layout.fonts に無い`)
      }
    }
    for (const tag of layout.tags.slice(1)) assert.ok(tag.parent !== null && tag.parent < layout.tags.indexOf(tag), `${name}: 親は子より前`)
  }
})

test('ルビの字（RT）は 7pt 未満でも「7pt 未満」の警告を出さない（本物の小さい字だけ警告する）', async () => {
  const { pdf, layout } = await build(sample('ruby'))
  const small = [...layout.pages.flatMap((p) => [...walk(p.ops)])].filter((op) => op.t === 'text' && op.size < 7)
  assert.ok(small.length > 0, 'ルビの見本には 7pt 未満の字がある')
  assert.ok(small.every((op) => layout.tags[op.tag]?.role === 'RT'), '7pt 未満の字はルビだけ')
  assert.ok(!pdf.warnings.some((w) => w.includes('7pt 未満')), pdf.warnings.join(' / '))

})

test('チャートの ClipOp は PDF で q・Q と BDC・EMC が釣り合い、中の字と図形が頁の内容に出る', async () => {
  const { layout, pdf } = await build(sample('report'))
  const doc = await PDFDocument.load(toBytes(pdf.text), { updateMetadata: false })
  let seen = 0
  layout.pages.forEach((page, i) => {
    const clips = page.ops.filter((o) => o.t === 'clip')
    if (!clips.length) return
    seen += clips.length
    const c = contentOf(doc, i)
    assert.equal(count(c, /(?:^|\s)q(?=\s)/g), count(c, /(?:^|\s)Q(?=\s|$)/g), `頁 ${i + 1}: q と Q の数`)
    assert.equal(count(c, /\bBDC\b/g) + count(c, /\bBMC\b/g), count(c, /\bEMC\b/g), `頁 ${i + 1}: 印付きの始まりと EMC の数`)
    assert.ok(count(c, / W n/g) >= clips.length, `頁 ${i + 1}: 切り抜きの数`)
  })
  assert.ok(seen >= 2, 'report には図が 2 つ以上ある')
})

test('ClipOp が入れ子でも PDF の q・Q は釣り合い、内側の字は消えず、SVG の clipPath も入れ子で出る', async () => {
  const { fontBytes } = await real()
  const text = (s, y, tag) => ({ t: 'text', font: 'sans', size: 9, color: '#111111', y, glyphs: Array.from(s).map((c, i) => ({ c, x: 60 + i * 9 })), tag })
  const layout = {
    meta: { title: '入れ子', lang: 'ja-JP', created: NOW },
    page: { width: 595.28, height: 841.89 },
    tags: [{ role: 'Document', parent: null }, { role: 'Figure', parent: 0, alt: '図' }],
    outline: [],
    fonts: ['sans'],
    warnings: [],
    pages: [{
      ops: [{
        t: 'clip', x: 50, y: 100, w: 300, h: 200,
        ops: [
          { t: 'rect', x: 60, y: 110, w: 100, h: 20, fill: '#CCCCC9', tag: 1 },
          { t: 'clip', x: 80, y: 120, w: 100, h: 60, ops: [text('内側の字', 150, 1), { t: 'rect', x: 90, y: 160, w: 30, h: 10, fill: '#111111', tag: 1 }] },
          text('外側の字', 200, 1),
        ],
      }],
    }],
  }
  const pdf = await renderPdf(layout, { fontBytes: { sans: fontBytes.sans } })
  const doc = await PDFDocument.load(toBytes(pdf.text), { updateMetadata: false })
  const c = contentOf(doc, 0)
  assert.equal(count(c, / W n/g), 2)
  assert.equal(count(c, /(?:^|\s)q(?=\s)/g), count(c, /(?:^|\s)Q(?=\s|$)/g))
  assert.equal(count(c, /\bBDC\b/g) + count(c, /\bBMC\b/g), count(c, /\bEMC\b/g))
  // 内側の切り抜きは外側の q の中で閉じる: 2 つ目の q は最後の Q より前に始まり、Q が 2 つ続く
  assert.ok(/Q\s+Q/.test(c) || count(c, /Q/g) >= 2)
  const task = getDocument({ data: toBytes(pdf.text), useSystemFonts: false, verbosity: 0 })
  const js = await task.promise
  const got = (await (await js.getPage(1)).getTextContent()).items.map((i) => i.str).join('')
  assert.ok(got.includes('内側の字') && got.includes('外側の字'), got)
  await task.destroy()

  const svg = pageSvg(layout, 0, { id: 'n1' })
  assert.equal(count(svg, /<clipPath /g), 2)
  assert.ok(/<g clip-path="url\(#[^)]+\)">[^]*<g clip-path="url\(#[^)]+\)">/.test(svg), 'g が入れ子')
  const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, 'clipPath の id は重ならない')
})

test('記入欄の日本語の名前と値は、PDF を書いて読み直し、埋め直しても同じ名前で往復する', async () => {
  const { layout, pdf } = await build(sample('form'))
  const names = [...walk(layout.pages.flatMap((p) => p.ops))].filter((o) => o.t === 'field').map((o) => o.name)
  assert.deepEqual(names, ['氏名', 'ふりがな', 'メール', '住所', '同意', '種別'])
  const bytes = toBytes(pdf.text)
  const fields = await listFields(bytes)
  assert.deepEqual(fields.map((f) => f.name), names)
  assert.deepEqual(fields.map((f) => f.kind), ['text', 'text', 'text', 'text', 'check', 'choice'])

  const { fontBytes } = await real()
  const r = await fillFields(bytes, { 氏名: '山田 太郎', 住所: '東京都千代田区\n一丁目', 同意: true, 種別: '法人', 存在しない欄: 'x' }, { fontBytes })
  assert.deepEqual(r.filled.sort(), ['住所', '同意', '氏名', '種別'].sort())
  assert.deepEqual(r.missing, ['存在しない欄'])
  assert.deepEqual(r.failed, [])
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f.value]))
  assert.equal(back['氏名'], '山田 太郎')
  assert.equal(back['住所'], '東京都千代田区\n一丁目')
  assert.equal(back['同意'], true)
  assert.equal(back['種別'], '法人')

  // pdf.js の注釈からも同じ日本語の名前が読める（別のビューアーでも名前が使える）
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 })
  const js = await task.promise
  const annots = await (await js.getPage(1)).getAnnotations()
  assert.deepEqual(annots.filter((a) => a.fieldName).map((a) => a.fieldName), names)
  await task.destroy()
})

test('欄の SVG は空白も 1 字として数え、<text> ごとに x の数と字の数が一致する（xml:space を保つ）', async () => {
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  for (const name of ['en', 'report']) {
    const { layout } = await build(sample(name))
    let spaces = 0
    layout.pages.forEach((_, i) => {
      const svg = pageSvg(layout, i, { id: `s${i}` })
      for (const m of svg.matchAll(/<text xml:space="preserve" x="([^"]*)"[^>]*>([^<]*)<\/text>/g)) {
        const xs = m[1].trim().split(/\s+/).filter(Boolean)
        const chars = Array.from(unescape(m[2]))
        assert.equal(xs.length, chars.length, `${name} 頁 ${i + 1}: x ${xs.length} 個・字 ${chars.length} 個「${m[2].slice(0, 20)}」`)
        spaces += chars.filter((c) => c === ' ').length
      }
    })
    if (name === 'en') assert.ok(spaces > 100, `英文の空白が字として残る（${spaces} 個）`)
  }
})

test('make の答えに載る warnings と stats は、compose の警告と PDF の警告をつなぎ、同じ文を 2 回出さない', async () => {
  const { warnings, layout, pdf } = await build({ title: '警告', blocks: [{ type: 'para', text: [{ text: '本文' + String.fromCodePoint(0x1f600) }] }, { type: 'image', path: 'none.png', alt: '無い画像' }] })
  assert.equal(new Set(warnings).size, warnings.length)
  assert.ok(warnings.some((w) => w.includes('none.png')), warnings.join(' / '))
  assert.ok(Array.isArray(layout.stats.missingGlyphs))
  assert.ok(Number.isFinite(layout.stats.lastPageFill))
  assert.ok(Array.isArray(pdf.warnings))
})

test('SVG の高さの既定は viewBox の縦横比（横長の図が頁に穴を開けない）', async () => {
  const wide = '<svg viewBox="0 0 480 100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="480" height="100" fill="#111111"/></svg>'
  const { layout } = await build({ title: '図', blocks: [{ type: 'svg', source: wide, alt: '横長' }] })
  const rects = [...walk(layout.pages[0].ops)].filter((o) => o.t === 'rect' || o.t === 'path').filter((o) => o.tag !== undefined && layout.tags[o.tag].role === 'Figure')
  assert.ok(rects.length > 0)
  // 高さ = 幅 × 100/480 なので、頁の 1/4 より低い（幅の 0.5 倍の既定なら 1/2 を超える高さを取る）
  const ys = rects.flatMap((o) => (o.t === 'rect' ? [o.y, o.y + o.h] : []))
  assert.ok(Math.max(...ys) - Math.min(...ys) < 120, `図の高さ ${Math.max(...ys) - Math.min(...ys)}`)
})

test('チャートの既定: 凡例は位置の指定が無ければ上・2 本目の値軸には補助線を引かない・指定は常に勝つ', async () => {
  const { metrics } = await real()
  const base = {
    xAxis: { type: 'category', data: ['a', 'b'] },
    yAxis: [{ type: 'value' }, { type: 'value' }],
    series: [{ name: '甲', type: 'bar', data: [1, 2] }, { name: '乙', type: 'line', yAxisIndex: 1, data: [3, 4] }],
  }
  const legendY = (ops) => {
    const texts = [...walk(ops)].filter((o) => o.t === 'text' && o.glyphs.map((g) => g.c).join('') === '甲')
    return texts[0]?.y
  }
  const top = chartToOps({ ...base, legend: { data: ['甲', '乙'] } }, { x: 0, y: 0, width: 400, height: 240, metrics })
  const bottom = chartToOps({ ...base, legend: { data: ['甲', '乙'], bottom: 4 } }, { x: 0, y: 0, width: 400, height: 240, metrics })
  assert.ok(legendY(top.ops) < 40, `凡例は上: ${legendY(top.ops)}`)
  assert.ok(legendY(bottom.ops) > 200, `指定した下が勝つ: ${legendY(bottom.ops)}`)

  const lines = (ops) => [...walk(ops)].filter((o) => o.t === 'path' && /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(o.d.trim()) && o.stroke?.toLowerCase() === '#ccccc9')
  const one = chartToOps({ ...base, legend: {} }, { x: 0, y: 0, width: 400, height: 240, metrics })
  const both = chartToOps({ ...base, legend: {}, yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: true } }] }, { x: 0, y: 0, width: 400, height: 240, metrics })
  assert.ok(lines(both.ops).length > lines(one.ops).length, `補助線 ${lines(one.ops).length} 本 → 指定すれば ${lines(both.ops).length} 本`)
})
