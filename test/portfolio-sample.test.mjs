// 見本 samples/portfolio.json（架空の 10 銘柄の運用報告・横 A4 の 4 枚）の試験。書体は本物を 1 回だけ読む。
// 数字は 2 つの CSV から計算した物で、図の数字と文の数字が食い違わない事・検査が 0 件の事を見る。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { loadChartAssets, resetChartAssets, chartAssetNeeds } from '../hooks/engine/chart.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'fonts', 'fonts.json'), 'utf8'))
const bytes = await loadFontBytes(FONT_IDS, manifest, async (rel) => fs.readFileSync(path.join(root, 'fonts', rel)).toString('base64'), new Map())
const metrics = makeMetrics(bytes)
const input = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'portfolio.json'), 'utf8'))
resetChartAssets()
await loadChartAssets({ root, read: async (p) => fs.readFileSync(p, 'utf8') }, chartAssetNeeds(input))
const out = compose(input, { metrics, phrase: phraseBoundaries, now: Date.UTC(2026, 9, 9) })

const csv = (/** @type {string} */ file) => fs.readFileSync(path.join(root, 'samples', 'portfolio-data', file), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','))
const prices = csv('prices.csv')
const holdings = csv('holdings.csv').slice(1)

test('ポートフォリオの見本は横 A4 の 4 頁で、字の重なり・箱の外・「…」の切れ・空いた枚が 0 件で、警告が無い', () => {
  assert.equal(out.layout.pages.length, 4)
  assert.deepEqual(out.layout.page, { width: 841.89, height: 595.28 })
  assert.deepEqual(out.layout.meta.checks, { overlaps: 0, outside: 0, truncated: 0, sparse: 0 })
  assert.deepEqual(out.warnings, [])
})

test('見本の 1 年の騰落率・BENCH との差・最大下落は、CSV から計算し直した値と、題・KPI・図で一致する', () => {
  const head = prices[0]
  const col = (/** @type {string} */ t) => prices.slice(1).map((r) => Number(r[head.indexOf(t)]))
  const w = Object.fromEntries(holdings.map((h) => [h[0], Number(h[3])]))
  const nav = prices.slice(1).map((_, i) => holdings.reduce((s, h) => s + w[h[0]] * col(h[0])[i], 0))
  const ret = (nav[nav.length - 1] / nav[0] - 1) * 100
  const bench = col('BENCH')
  const benchRet = (bench[bench.length - 1] / bench[0] - 1) * 100
  let peak = 0
  let mdd = 0
  for (const v of nav) {
    peak = Math.max(peak, v)
    mdd = Math.max(mdd, ((peak - v) / peak) * 100)
  }
  const s = (/** @type {number} */ n) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(1)}`
  const first = input.slides[0]
  assert.ok(first.title.includes(`${s(ret)}%`), first.title)
  assert.ok(first.title.includes(`${s(ret - benchRet)}pt`), first.title)
  const kpi = first.panels[0].kpi
  assert.equal(kpi[1].value, s(ret))
  assert.equal(kpi[2].value, s(ret - benchRet))
  assert.equal(kpi[3].value, `-${mdd.toFixed(1)}`)
  const line = input.slides[1].panels[0].look.data
  assert.equal(line.series[0].values.at(-1), Math.round((nav[nav.length - 1] / nav[0]) * 1000) / 10)
  assert.ok(input.slides[1].title.includes(`${mdd.toFixed(1)}%`), input.slides[1].title)
})

test('銘柄ごとの寄与は 1 桁に丸めても合計が全体の騰落に一致する（図の合計と題の数字が食い違わない）', () => {
  const items = input.slides[2].panels[2].look.data.items
  const total = Math.round(items.reduce((a, i) => a + i.value, 0) * 10) / 10
  const ret = Number(input.slides[0].panels[0].kpi[1].value)
  assert.equal(total, ret)
})

test('見本は ECharts の example の図とロゴの印を持ち、売買をすすめる語を使わない', () => {
  const text = JSON.stringify(input)
  assert.ok(input.slides[2].panels.some((p) => p.chart && typeof p.chart.example === 'string'))
  assert.ok(/"logo":"(NASDAQ|TSE):/.test(text))
  for (const word of ['推奨', 'おすすめ', 'お勧め', '買い時', '売り時', '勧誘']) assert.ok(!text.includes(word), word)
  assert.ok(input.slides.every((s) => /架空/.test(JSON.stringify(s))), '各枚の注に架空と書く')
})
