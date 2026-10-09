// @ts-check
// histogram（ヒストグラム）: 1 つの群の値を等しい幅の棒に数えて、分布の山と裾を見せる。元の見本は 2,000 回のツール呼び出しの応答時間（対数正規で、山が中央値の近くにあり、右に長い裾が出る）。
// 元は look の designs/histogram.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 分位数は d3-array の quantileSorted（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）で、spread-kit.mjs が持つ。
//
// 決まり（元の頭の文のとおり）: 棒は 1 本の幅（スロット）の 62% で、墨の 55% の塗り（candle の本体と同じ）。範囲の終わりより大きい値は、
// 最後の棒に積まず（その棒が嘘になる）棒に入れないで、数だけを見出しに書く。p50・p95・p99 は candle の最後の値と同じ墨の 35% の点線で、
// p99 だけが目立たせる 1 つ（look の Claude の橙）。いちばん高い棒は先に件数を書く。絵の中の数字（百分位・山・範囲を超えた件数）は、
// 全部 data から計算する。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる p99 は pal.accent（mono は accent が墨なので墨 100% の点線。ほかの 2 本は 35% のままなので見分けられる）。
// - 元は 0 から 1,800 ms を 60 ms の 30 本に固定したが、data に単位も範囲も無いので、範囲は 0.5% の値（p99.5）が入る所まで・棒の幅は
//   1・2・5 の倍数（30 本前後になる幅）にする。見本は 1,600 ms まで・50 ms の 32 本。0 から始めるのは、最小が最大の 35% 以下の時だけ（温度のように 0 が基準でない data は最小から）。
// - 元は「P50 378」の P50 を muted・数を ink の 2 色の 1 つの字にしたが、紙の字は 1 色なので、名前（sub）と数（ink の太字）の 2 つの字にして並べる。
// - 元の下の「SAMPLE TOOL CALL LATENCY」は、群の名前として左上の見出し（件数と一緒）に置く。単位は下の目盛りの右端。
// - 群が 2 つ以上の data は、先頭の群だけを描いて warnings に書く（群を比べるなら ridgeline・violin・box-plot）。
import { ALPHA, DASH, TICK, VALUE, inkFill, seriesFill, inkStroke, hotStroke, text, line, rect, svgDoc, empty, num, textWidth, clip, tr, linear, tickStep, seeded, statDigits, axisBottom, tickSet, stepDigits, LW } from './paper.mjs'
import { readGroups, sorted, quantile, baseZero, normalOf, round } from './spread-kit.mjs'

/** 棒の本数の上限。幅が 1・2・5 の倍数なので 30 本を目安にしても最大で 42 本ほど */
const MAX_BINS = 80
const PAD = 12
const HEADER_Y = 11
/** 百分位の字の基線。字の上の端はその 7pt ほど上 */
const PCT_Y = 26
const PLOT_TOP = 42
const AXIS_FROM_BOTTOM = 22
const SLOT_SHARE = 0.62

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} HistData values は小さい順 */

/**
 * @param {unknown} data { groups: { name, values }[], unit? }（先頭の群だけを描く）
 * @returns {{ data: HistData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const groups = readGroups(src, warnings, 'ヒストグラム', 1)
  if (groups.length > 1) warnings.push(`ヒストグラム: 先頭の群「${groups[0].name}」だけを描きます（ほかの ${groups.length - 1} 群は捨てました。群を比べるなら ridgeline・violin・box-plot）`)
  const g = groups[0]
  return { data: { name: g?.name ?? '', values: g ? sorted(g.values) : [], unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * 棒の並び（範囲の始まり・幅・本数）を決める。範囲の終わりは p99.5 の次の棒の端
 * @param {number[]} v 小さい順
 * @returns {{ a: number, width: number, bins: number, end: number }}
 */
function binning(v) {
  const top = quantile(v, 0.995)
  let a = baseZero(v[0], top)
  let hi = top
  if (!(hi > a)) {
    // 全部が同じ値: 値の 10% を片側の幅にする（0 なら 1）
    const pad = Math.abs(v[0]) * 0.1 || 1
    a = v[0] - pad
    hi = v[0] + pad
  }
  const width = tickStep(a, hi, 30)
  a = Math.floor(a / width + 1e-9) * width
  const bins = Math.min(MAX_BINS, Math.floor((hi - a) / width + 1e-9) + 1)
  return { a, width, bins, end: a + bins * width }
}

/**
 * @param {HistData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const v = data.values
  const n = v.length
  if (!n) return empty(o)
  const { a, width: bw0, bins, end } = binning(v)
  const counts = new Array(bins).fill(0)
  let over = 0
  for (const x of v) {
    if (x >= end) over++
    else counts[Math.min(bins - 1, Math.max(0, Math.floor((x - a) / bw0)))]++
  }
  const peak = Math.max(...counts)
  const peakAt = counts.indexOf(peak)
  // 件数の目盛りは整数（1 件の半分は無い）。間隔は 1・2・5 の倍数で、1 より細かくしない
  const countStep = Math.max(1, tickStep(0, peak, 3))
  const countTop = Math.ceil(peak / countStep) * countStep
  const yTicks = { values: Array.from({ length: Math.round(countTop / countStep) + 1 }, (_, i) => i * countStep), fmt: (/** @type {number} */ c) => num(c) }

  const plotBottom = H - AXIS_FROM_BOTTOM
  const plotLeft = PAD + Math.max(0, ...yTicks.values.map((t) => textWidth(yTicks.fmt(t), TICK))) + 8
  const plotRight = W - PAD
  const x = linear(a, end, plotLeft, plotRight)
  const y = linear(0, countTop, plotBottom, PLOT_TOP)
  const slot = (plotRight - plotLeft) / bins
  const bw = slot * SLOT_SHARE
  const digits = statDigits(end - a)
  const fmt = (/** @type {number} */ t) => num(t, digits)
  // 範囲の終わりは棒の幅の倍数なので、幅の桁だけで書く（155 を 155.0 と書かない）
  const endText = num(end, stepDigits(bw0))
  /** @type {string[]} */
  const parts = []

  // 見出し: 左に群の名前と件数、右に範囲を超えた件数
  const right = over ? tr(lang, `${endText}${data.unit ? ` ${data.unit}` : ''} 以上の ${num(over)} 件は棒に入れない`, `${num(over)} at or over ${endText}${data.unit ? ` ${data.unit}` : ''}, not binned`) : ''
  const rightW = right ? textWidth(right, TICK) : 0
  const count = tr(lang, `${num(n)} 件`, `n = ${num(n)}`)
  const leftRoom = plotRight - PAD - rightW - 16
  const left = data.name ? `${clip(data.name, TICK, Math.max(40, leftRoom - textWidth(`（${count}）`, TICK)))}（${count}）` : count
  parts.push(text(PAD, HEADER_Y, left, { size: TICK, fill: pal.sub }))
  if (right) parts.push(text(W - PAD, HEADER_Y, right, { size: TICK, fill: pal.sub, anchor: 'end' }))

  // 件数の格子: 切りのよい件数に細い線。左に数
  for (const c of yTicks.values) {
    const gy = Math.round(y(c)) + 0.5
    parts.push(line(plotLeft, gy, plotRight, gy, inkStroke(pal, ALPHA.grid, LW.line)))
    parts.push(text(plotLeft - 7, gy + TICK * 0.35, yTicks.fmt(c), { size: TICK, fill: pal.sub, anchor: 'end' }))
  }

  counts.forEach((c, i) => {
    if (!c) return
    const by = y(c)
    parts.push(rect(plotLeft + slot * i + (slot - bw) / 2, by, bw, Math.max(1, plotBottom - by), seriesFill(pal, 1, 0, 0.85) ?? inkFill(pal, ALPHA.body)))
  })
  parts.push(text(plotLeft + slot * (peakAt + 0.5), y(peak) - 3.5, num(peak), { size: VALUE, fill: pal.ink, anchor: 'middle', bold: true }))

  const xTicks = tickSet(a, end, 5)
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: plotBottom, pal, fmt: xTicks.fmt, unit: data.unit, left: plotLeft, right: plotRight }))

  // 百分位: 見出しの行から軸まで点線を引き、字は線の右（置けなければ左・数だけ・無し）。p99 だけが目立たせる 1 つ。
  // 選ばなかった案: 重なる字を 2 段に積む案（見出しの行と棒の間に 2 段目の余白が無い）
  const marks = [['P50', 0.5], ['P95', 0.95], ['P99', 0.99]].map(([name, p]) => ({ name: /** @type {string} */ (name), value: quantile(v, /** @type {number} */ (p)), hot: p === 0.99 }))
  const xAt = (/** @type {number} */ value) => Math.round(Math.min(plotRight, Math.max(plotLeft, x(value)))) + 0.5
  for (const m of marks) {
    const mx = xAt(m.value)
    parts.push(line(mx, PCT_Y - 9, mx, plotBottom, m.hot ? hotStroke(pal, 1, LW.line, 1, DASH.ref) : inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))
  }
  /** 置いた字の横の範囲。次の字が重ならない所を選ぶ */
  /** @type {[number, number][]} */
  const placed = []
  const free = (/** @type {number} */ x0, /** @type {number} */ x1) => x0 >= plotLeft && x1 <= plotRight && placed.every(([p0, p1]) => x1 + 3 <= p0 || x0 >= p1 + 3)
  // 目立たせる P99 を先に置く（字が足りない時に残るのは大事な物）
  const order = [...marks.keys()].sort((p, q) => Number(marks[q].hot) - Number(marks[p].hot) || q - p)
  for (const i of order) {
    const m = marks[i]
    const nextX = marks[i + 1] ? Math.round(x(marks[i + 1].value)) : plotRight
    const mx = xAt(m.value)
    const num_ = fmt(m.value)
    const nameW = textWidth(m.name, TICK) + 3
    const numW = textWidth(num_, VALUE, true)
    // 名前つき → 数だけ の順に、線の右・左で重ならない所を探す。無ければ字は置かない（点線は残る）
    for (const withName of [true, false]) {
      const wide = (withName ? nameW : 0) + numW
      const x0 = [mx + 4, mx - 4 - wide].find((c) => free(c, c + wide) && (c < mx || c + wide < nextX - 4))
      if (x0 === undefined) continue
      placed.push([x0, x0 + wide])
      if (withName) parts.push(text(x0, PCT_Y, m.name, { size: TICK, fill: m.hot ? pal.accent : pal.sub }))
      parts.push(text(x0 + (withName ? nameW : 0), PCT_Y, num_, { size: VALUE, fill: m.hot ? pal.accent : pal.ink, bold: true }))
      break
    }
  }
  return svgDoc(W, H, parts.join(''))
}

/**
 * 2,000 件の対数正規の待ち時間（中央値 38 分・ばらつき 0.55）。look の見本と同じ種・同じ式で、数を 1/10 にして単位を分にした
 * @returns {{ groups: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261036)
  const normal = normalOf(rnd)
  const values = Array.from({ length: 2000 }, () => round(38 * Math.exp(0.55 * normal()), 1)).sort((p, q) => p - q)
  return { groups: [{ name: '問い合わせの初回応答時間', values }], unit: '分' }
}

export default {
  id: 'histogram',
  title: 'ヒストグラム（Histogram）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.526),
  sample,
}
