// @ts-check
// 自動の検査（inspect.mjs）の試験。字の重なり・箱の外・「…」の切れ・資料の空き。書体は本物を 1 回だけ読む。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectSvg, inspectLayout, summarizeChecks, opsBounds, SPARSE_BELOW } from '../hooks/engine/inspect.mjs'
import { compose } from '../hooks/engine/index.mjs'
import { laySlide } from '../hooks/engine/lay-slide.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { FONT_IDS } from '../hooks/engine/index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
const bytes = await loadFontBytes(FONT_IDS, manifest, async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64'), new Map())
const metrics = /** @type {any} */ (makeMetrics(bytes))

/** SVG の字の 1 行 */
const t = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ s, size = 12) =>
  `<text x="${x}" y="${y}" font-family="Noto Sans JP" font-size="${size}">${s}</text>`
const svgOf = (/** @type {string} */ body, w = 200, h = 100) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`
const look = (/** @type {string} */ svg, w = 200, h = 100) => inspectSvg(svg, { width: w, height: h, metrics })

/** 頁に置く TextOp（字の x は書体の送り幅で並べる） */
function textOp(/** @type {string} */ s, /** @type {number} */ x, /** @type {number} */ y, size = 10) {
  let cx = x
  const glyphs = Array.from(s).map((c) => {
    const g = { c, x: cx }
    cx += metrics.sans.adv(c.codePointAt(0)) * size
    return g
  })
  return { t: 'text', font: 'sans', size, color: '#111111', y, glyphs }
}
const layoutOf = (/** @type {any[]} */ pages) => ({ page: { width: 300, height: 200 }, pages })

// ---------------------------------------------------------------- inspectSvg

test('字の箱が縦横とも 1pt を超えて重なると、重なりとして数える', () => {
  const r = look(svgOf(t(10, 30, '売上の推移です') + t(40, 34, '重なる字')))
  assert.deepEqual(r.overlaps, ['「売上の推移です」と「重なる字」'])
  assert.deepEqual([r.outside, r.truncated], [[], []])
})

test('隣り合う字は触れていても重なりに数えない（行送りで 1pt に満たない重なり・横に並んだ字）', () => {
  const r = look(svgOf(t(10, 30, '一行目') + t(10, 42, '二行目') + t(60, 30, '横に並ぶ')))
  assert.deepEqual(r.overlaps, [])
})

test('同じ字が同じ所に 2 度ある物（縁取り）は重なりに数えない。位置が違えば数える', () => {
  assert.deepEqual(look(svgOf(t(10, 30, '縁取りの字') + t(10, 30, '縁取りの字'))).overlaps, [])
  assert.equal(look(svgOf(t(10, 30, '縁取りの字') + t(18, 34, '縁取りの字'))).overlaps.length, 1)
})

test('引用符だけの飾りの大きな字は、重なりに数えない', () => {
  const r = look(svgOf(t(10, 60, '“', 80) + t(20, 40, '引用の本文です'), 300, 100), 300, 100)
  assert.deepEqual(r.overlaps, [])
})

test('箱の外: 0.5pt を超えて右へ出た字は外、収まる字は内', () => {
  const r = look(svgOf(t(150, 60, 'はみ出す字です') + t(10, 60, '収まる')))
  assert.deepEqual(r.outside, ['はみ出す字です'])
  const edge = look(svgOf(t(188, 60, 'ぴ')))
  assert.deepEqual(edge.outside, [], '右端にちょうど入る字は外に数えない')
})

test('箱の外: 図の中の clip-path の範囲から出た字も外（頁より狭い箱）', () => {
  const svg = svgOf('<defs><clipPath id="c"><rect x="0" y="0" width="80" height="100"/></clipPath></defs>'
    + `<g clip-path="url(#c)">${t(60, 40, '範囲を出る字です')}${t(5, 70, '範囲の中')}</g>`)
  assert.deepEqual(look(svg).outside, ['範囲を出る字です'])
})

test('切れ: 「…」で終わる字を数える。途中にある「…」は数えない', () => {
  const r = look(svgOf(t(10, 30, '切れた名前…') + t(10, 60, '途中…の字')))
  assert.deepEqual(r.truncated, ['切れた名前…'])
})

test('描いた物の四角（bounds）を返す。箱の左上が原点', () => {
  const r = look(svgOf('<rect x="20" y="30" width="40" height="10" fill="#333"/>'))
  assert.deepEqual(r.bounds, { x0: 20, y0: 30, x1: 60, y1: 40 })
  assert.equal(look(svgOf('')).bounds, null)
})

test('書体の寸法が無い時は何も見ない（字の幅が読めない）', () => {
  const r = inspectSvg(svgOf(t(10, 30, '売上の推移です') + t(40, 34, '重なる字')), { width: 200, height: 100 })
  assert.deepEqual(r, { overlaps: [], outside: [], truncated: [], bounds: null })
})

test('同じ入力は同じ結果（図の字が多くても、重なりは左端で並べて数える）', () => {
  const many = Array.from({ length: 300 }, (_, i) => t((i % 20) * 9, 12 + Math.floor(i / 20) * 6, '字')).join('')
  const a = look(svgOf(many, 200, 100))
  const b = look(svgOf(many, 200, 100))
  assert.deepEqual(a, b)
  assert.ok(a.overlaps.length > 0)
})

// ---------------------------------------------------------------- opsBounds

test('opsBounds: 字・矩形・線・path・clip の中を合わせた四角', () => {
  const ops = [
    { t: 'rect', x: 10, y: 20, w: 30, h: 5 },
    { t: 'rule', x1: 5, y1: 60, x2: 90, y2: 60, w: 1, color: '#000' },
    { t: 'path', d: 'M 100 10 L 120 70 C 1 2 3 4 5 6 Z' },
    { t: 'clip', x: 0, y: 0, w: 10, h: 10, ops: [{ t: 'rect', x: 0, y: 80, w: 10, h: 10 }] },
  ]
  assert.deepEqual(opsBounds(ops), { x0: 0, y0: 2, x1: 120, y1: 90 })
  assert.equal(opsBounds([]), null)
})

// ---------------------------------------------------------------- inspectLayout

test('inspectLayout: 頁ごとに、重なり・頁の外・切れを数える', () => {
  const layout = layoutOf([
    { ops: [textOp('正しい行です', 20, 40), textOp('次の行です', 20, 60)] },
    { ops: [textOp('重なる行です', 20, 40), textOp('重なる行', 40, 44)] },
    { ops: [textOp('頁の外へ出る行です', 250, 40)] },
    { ops: [textOp('切れた見出し…', 20, 40)] },
  ])
  const pages = inspectLayout(layout, { metrics })
  assert.equal(pages.length, 4)
  assert.deepEqual(pages.map((p) => [p.overlaps.length, p.outside.length, p.truncated.length]), [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
  assert.deepEqual(pages.map((p) => p.page), [0, 1, 2, 3])
})

test('inspectLayout: 図の ClipOp の範囲を出た字は、頁の中でも外に数える', () => {
  const layout = layoutOf([{ ops: [{ t: 'clip', x: 20, y: 20, w: 60, h: 40, ops: [textOp('範囲を出る長い字です', 30, 40)] }] }])
  assert.equal(inspectLayout(layout, { metrics })[0].outside.length, 1)
})

test('inspectLayout: 本文の区域の埋まりが 0.85 未満の枚だけ、空いた枚（sparse）に数える。body が無い頁（文書・表紙）は見ない', () => {
  const body = (/** @type {number} */ used) => ({ top: 50, height: 100, used })
  const layout = layoutOf([
    { ops: [], body: body(25) },
    { ops: [], body: body(85) },
    { ops: [], body: body(84.9) },
    { ops: [] },
  ])
  const pages = inspectLayout(layout, { metrics })
  assert.equal(SPARSE_BELOW, 0.85)
  assert.deepEqual(pages.map((p) => p.sparse), [0.25, null, 0.85, null])
})

// ---------------------------------------------------------------- summarizeChecks

test('summarizeChecks: 件数と、頁・種類・字の始め 20 字の文にする。1 頁 1 種類で出す字は 3 つまで', () => {
  const long = 'あ'.repeat(30)
  const { counts, warnings } = summarizeChecks([
    { page: 0, overlaps: [], outside: [], truncated: [], sparse: null },
    { page: 2, overlaps: ['「ア」と「イ」'], outside: ['a', 'b', 'c', 'd', long], truncated: ['名前…'], sparse: 0.4 },
  ])
  assert.deepEqual(counts, { overlaps: 1, outside: 5, truncated: 1, sparse: 1 })
  assert.deepEqual(warnings, [
    '3 頁: 字が重なっている 「ア」と「イ」',
    '3 頁: 字が箱の外にはみ出している 「a」・「b」・「c」・ほか 2 件',
    '3 頁: 字が「…」で切れている 「名前…」',
    '3 頁: 本文の区域の 40% しか埋まっていない（空いた枚）',
  ])
})

test('inspectSvg: 字は始めの 20 字までに切って渡す', () => {
  const r = look(svgOf(t(10, 30, '長い字長い字長い字長い字長い字長い字長い字長い字…', 4)))
  assert.equal(Array.from(r.truncated[0]).length, 20)
})

// ---------------------------------------------------------------- laySlide の body と、見本の自動の検査

const NOW = Date.UTC(2026, 9, 9)
const deckTheme = makeTheme({ kind: 'deck' })
const slideCtx = (/** @type {Record<string, any>} */ extra = {}) => ({
  page: { width: deckTheme.page.width, height: deckTheme.page.height }, index: 1, count: 3, theme: deckTheme, metrics, images: {}, phrase: phraseBoundaries, lang: 'ja',
  section: '', sectionNo: 0, author: '', date: '', tag: () => 1, figure: () => ({ ops: [], warnings: [], height: 100, alt: '図' }), ...extra,
})
const P = (/** @type {string} */ s) => ({ type: 'para', text: s })

test('laySlide は本文のある型に body（区域と中身の下端までの高さ）を返し、表紙・節・結び・引用・要点の文には返さない', () => {
  const short = laySlide({ layout: 'content', title: '短い枚', blocks: [P('一行だけ。')] }, slideCtx())
  assert.ok(short.body && short.body.height > 200 && short.body.used > 0)
  assert.ok(short.body.used / short.body.height < SPARSE_BELOW, '一行の枚は空いた枚')
  const full = laySlide({ layout: 'content', title: '詰まった枚', blocks: Array.from({ length: 5 }, (_, i) => P(`${i + 1} 段落目。${'長い文を書いて行を増やす。'.repeat(40)}`)) }, slideCtx())
  assert.ok(full.body && full.body.used / full.body.height > SPARSE_BELOW)
  for (const layout of ['cover', 'section', 'statement', 'quote', 'closing']) {
    assert.equal(laySlide({ layout, title: '題', lead: '補足', quote: '引用' }, slideCtx()).body, undefined, layout)
  }
  for (const layout of ['split', 'figure', 'kpi', 'compare', 'table']) {
    assert.ok(laySlide({ layout, title: '題', items: [{ label: 'a', value: '1' }], figure: { type: 'chart', kind: 'donut', data: {} }, left: [P('左')], right: [P('右')] }, slideCtx()).body, layout)
  }
})

test('見本の組みに、字の重なり・箱の外・「…」の切れが無い見本（bizplan・deck・deck-wide・looks・report・prose・ruby・en・form）', () => {
  for (const name of ['bizplan', 'deck', 'deck-wide', 'looks', 'report', 'prose', 'ruby', 'en', 'form']) {
    const input = JSON.parse(fs.readFileSync(path.join(ROOT, 'samples', `${name}.json`), 'utf8'))
    const { layout } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
    const pages = inspectLayout(layout, { metrics })
    assert.equal(pages.length, layout.pages.length, name)
    const found = pages.flatMap((p) => [...p.overlaps.map((s) => `重なり ${s}`), ...p.outside.map((s) => `外 ${s}`), ...p.truncated.map((s) => `切れ ${s}`)].map((s) => `${p.page + 1} 頁 ${s}`))
    assert.deepEqual(found, [], name)
  }
})
