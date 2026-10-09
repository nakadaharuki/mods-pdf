// @ts-check
// box-plot（箱ひげ図）: 群ごとの値のばらつきを、1 本の共通の目盛りの上の 1 行ずつに並べる。元の見本は 6 つの API の応答時間（200 回ずつ・どれも対数正規なので箱が右に偏る）。
// 元は look の designs/box-plot.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 分位数は d3-array の quantileSorted（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）で、spread-kit.mjs が持つ。
//
// 決まり（元の頭の文のとおり）: 行は dumbbell と同じ（名前を左の列・共通の目盛り・中央値を右端に右揃え）。箱は四分位の間で墨の 25%（面の塗り）・1 行の幅（ピッチ）の 62%。
// 中央値は墨 100% の 1px の線。ひげは Tukey の規則（箱から四分位範囲の 1.5 倍の内側にある、いちばん遠い値まで）で墨の 35%。ひげの外の値は外れ値で、
// 半径 1.5 の点（1 行に複数あるので、既定の半径 2 より小さく）・墨の 65%。全部の値のうちいちばん大きい 1 つだけが目立たせる 1 つ（look の Claude の橙）で、半径 2 の点と値の字。
// 目盛りの終わりは、その値から 15% の余白をとって切りのよい所に置く（値の字が図の中に入る）。絵の中の数字は全部 data から計算する。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる 1 つは pal.accent（mono は墨 100% の点。外れ値の墨 65% より濃く、字も付く）。
// - 元は左の列に「メソッド・パス」の等幅の 2 列を置いたが、data は名前 1 つなので、名前を 1 列（sans・LABEL）にする。列の幅は名前の幅に合わせ、長い名前は「…」で切る。
// - 元は上に「ENDPOINT」「MEDIAN」と見出しを置いたが、data に列の名前が無いので、右の「中央値」だけを残す。下の左に件数・右に箱とひげの読み方を置く（紙の読み手には書かないと分からない）。
// - 目盛りは 0 から始める（待ち時間のように 0 が基準の時。最小が最大の 35% より大きければ最小から）。単位は目盛りの右端。
// 選ばなかった案
// - ひげをすべての値の最小・最大にする案: 外れ値が 1 つあるとひげが伸びて箱が潰れる。look と同じ Tukey の規則にする。
// - 行が多い時に箱を細くし続ける案: 24 行までにして warnings に書く（8pt の名前が重なる前に止める）。
import { ALPHA, TICK, LABEL, VALUE, inkFill, seriesFill, inkStroke, hotFill, text, line, rect, circle, svgDoc, empty, num, textWidth, clip, tr, linear, niceExtent, keep, seeded, statDigits, axisBottom, tickSet, fitText, LW } from './paper.mjs'
import { readGroups, sorted, quantile, baseZero, normalOf, round } from './spread-kit.mjs'

/** 行の数の上限。1 行 10pt の名前が重ならない数 */
const MAX_ROWS = 24
const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 24
const AXIS_FROM_BOTTOM = 30
const MAX_PITCH = 34
const BOX_SHARE = 0.62
const MAX_BOX = 18
const ROW_PITCH = 24

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, n: number, q1: number, q2: number, q3: number, lo: number, hi: number, max: number, out: number[] }} Row lo・hi はひげの両端 */
/** @typedef {{ rows: Row[], unit: string }} BoxData */

/**
 * 小さい順の値から、5 つの数と外れ値を作る
 * @param {string} name @param {number[]} s
 * @returns {Row}
 */
function summarize(name, s) {
  const q1 = quantile(s, 0.25)
  const q2 = quantile(s, 0.5)
  const q3 = quantile(s, 0.75)
  const fence = 1.5 * (q3 - q1)
  const inside = s.filter((v) => v >= q1 - fence && v <= q3 + fence)
  const lo = inside[0]
  const hi = inside[inside.length - 1]
  return { name, n: s.length, q1, q2, q3, lo, hi, max: s[s.length - 1], out: s.filter((v) => v < lo || v > hi) }
}

/**
 * @param {unknown} data { groups: { name, values }[], unit? }
 * @returns {{ data: BoxData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const groups = keep(readGroups(src, warnings, '箱ひげ図', 1), MAX_ROWS, warnings, '箱ひげ図: 群')
  return { data: { rows: groups.map((g) => summarize(g.name, sorted(g.values))), unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * @param {BoxData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  let minAll = Infinity
  let maxAll = -Infinity
  for (const r of rows) {
    minAll = Math.min(minAll, r.lo, r.out[0] ?? Infinity)
    maxAll = Math.max(maxAll, r.max)
  }
  // 目盛りの終わりは最大の値から 15% の余白（目立たせる値の字が図の中に入る）。切りのよい所へ
  const base = baseZero(minAll, maxAll)
  const [lo, hi] = niceExtent(base, maxAll + (maxAll - base) * 0.15, 5)
  const digits = statDigits(hi - lo)
  const fmt = (/** @type {number} */ v) => num(v, digits)

  const nameW = Math.min(W * 0.28, Math.max(...rows.map((r) => textWidth(r.name, LABEL))))
  const medW = Math.max(textWidth(tr(lang, '中央値', 'Median'), TICK), ...rows.map((r) => textWidth(fmt(r.q2), VALUE, true)))
  const left = PAD + nameW + 12
  const right = W - PAD - medW - 14
  const x = linear(lo, hi, left, right)
  const pitch = Math.min(MAX_PITCH, (H - AXIS_FROM_BOTTOM - PLOT_TOP) / n)
  const plotBottom = PLOT_TOP + pitch * n
  const box = Math.max(3, Math.min(MAX_BOX, pitch * BOX_SHARE))
  const nameEvery = Math.max(1, Math.ceil((LABEL + 2) / pitch))
  /** @type {string[]} */
  const parts = []

  parts.push(text(W - PAD, HEADER_Y, tr(lang, '中央値', 'Median'), { size: TICK, fill: pal.sub, anchor: 'end' }))
  const xTicks = tickSet(lo, hi, 5)
  for (const t of xTicks.values) {
    const tx = Math.round(x(t)) + 0.5
    if (tx < left - 1 || tx > right + 1) continue
    parts.push(line(tx, PLOT_TOP, tx, plotBottom, inkStroke(pal, ALPHA.grid, LW.line)))
  }
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: plotBottom, pal, fmt: xTicks.fmt, unit: data.unit, left, right, unitX: W - PAD }))

  const hotRow = rows.findIndex((r) => r.max === maxAll)
  rows.forEach((r, i) => {
    const cy = PLOT_TOP + pitch * (i + 0.5)
    const top = cy - box / 2
    if (i % nameEvery === 0) parts.push(text(PAD, cy + LABEL * 0.35, clip(r.name, LABEL, nameW), { size: LABEL, fill: pal.ink }))
    // ひげは箱の下に置き、それぞれ箱の半分の高さの端を付ける
    for (const [from, to] of [[r.lo, r.q1], [r.q3, r.hi]]) parts.push(line(x(from), cy, x(to), cy, inkStroke(pal, ALPHA.last, LW.line)))
    for (const end of [r.lo, r.hi]) parts.push(line(x(end), cy - box / 4, x(end), cy + box / 4, inkStroke(pal, ALPHA.last, LW.line)))
    parts.push(rect(x(r.q1), top, Math.max(1, x(r.q3) - x(r.q1)), box, seriesFill(pal, i, hotRow, 0.55) ?? inkFill(pal, ALPHA.area)))
    parts.push(line(x(r.q2), top, x(r.q2), top + box, inkStroke(pal, 1, LW.line)))
    let hotValue = false
    for (const v of r.out) {
      if (i === hotRow && v === r.max && !hotValue) { hotValue = true; continue }
      parts.push(circle(x(v), cy, 1.5, inkFill(pal, ALPHA.strong)))
    }
    if (i === hotRow) {
      const hx = x(r.max)
      const label = fmt(r.max)
      const fits = hx + 5 + textWidth(label, VALUE, true) <= W - PAD
      parts.push(circle(hx, cy, 2, hotFill(pal, 1, 1)))
      parts.push(text(fits ? hx + 5 : hx - 5, cy + VALUE * 0.35, label, { size: VALUE, fill: pal.accent, anchor: fits ? 'start' : 'end', bold: true }))
    }
    parts.push(text(W - PAD, cy + VALUE * 0.35, fmt(r.q2), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  })

  // 下の字: 左に件数、右に箱とひげの読み方（入る長さの物を選ぶ）
  const ns = rows.map((r) => r.n)
  const nMin = Math.min(...ns)
  const nMax = Math.max(...ns)
  const countText = nMin === nMax ? tr(lang, `各 ${num(nMin)} 件`, `${num(nMin)} each`) : tr(lang, `${num(nMin)}〜${num(nMax)} 件`, `n = ${num(nMin)}–${num(nMax)}`)
  parts.push(text(PAD, H - 4, countText, { size: TICK, fill: pal.sub }))
  const room = W - 2 * PAD - textWidth(countText, TICK) - 16
  const how = fitText([
    tr(lang, '箱＝四分位範囲・線＝中央値・ひげ＝箱から 1.5 倍の範囲の内側・点＝その外の値', 'Box = IQR, line = median, whiskers = within 1.5 IQR, dots = beyond'),
    tr(lang, '箱＝四分位範囲・ひげ＝1.5 倍', 'Box = IQR, whiskers = 1.5 IQR'),
  ], room)
  parts.push(text(W - PAD, H - 4, how, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 6 つのページの表示時間（ミリ秒）。look の見本と同じ種・同じ式・同じ中央値とばらつき（対数正規）で 200 回ずつ。名前だけ紙の文書に合う物にした
 * @returns {{ groups: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261037)
  const normal = normalOf(rnd)
  /** @type {[string, number, number][]} */
  const pages = [['トップページ', 360, 0.38], ['検索結果', 250, 0.5], ['商品の詳細', 190, 0.34], ['カート', 130, 0.3], ['ログイン', 85, 0.45], ['お知らせ', 40, 0.4]]
  return {
    groups: pages.map(([name, median, sigma]) => ({
      name,
      values: Array.from({ length: 200 }, () => round(median * Math.exp(sigma * normal()), 0)).sort((p, q) => p - q),
    })),
    unit: 'ms',
  }
}

export default {
  id: 'box-plot',
  title: '箱ひげ図（Box plot）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {BoxData} */ data) => Math.max(150, Math.round(PLOT_TOP + AXIS_FROM_BOTTOM + Math.max(1, data?.rows?.length ?? 6) * ROW_PITCH)),
  sample,
}
