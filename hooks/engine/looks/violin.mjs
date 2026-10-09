// @ts-check
// violin（ヴァイオリン図）: 群ごとの値の分布を、左右対称の密度の形で並べる。箱ひげ図は山が 2 つあっても 1 つの箱にしてしまうが、ヴァイオリン図は 2 つのふくらみとして見せる。
// 元の見本は 4 つのモデルの 1 ターンの秒数（300 ターンずつ。2 つは速い返事と道具を使う重い返事の 2 つの山を持つ）。
// 元は look の designs/violin.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 分位数は d3-array の quantileSorted（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）で、spread-kit.mjs が持つ。
//
// 決まり（元の頭の文のとおり）: 形は Epanechnikov 核 0.75(1 - u^2) の密度推定で、帯域幅は Silverman の目安（0.9 × min(標準偏差, 四分位範囲 / 1.34) × n の -1/5 乗）に
// 2.214（ガウス核の帯域幅をこの核に移す係数。Marron と Nolan の canonical bandwidth）を掛けた物。値の最小より 1 帯域下から最大より 1 帯域上までを 64 に分けて測る
// （この核は 1 帯域の外で厳密に 0 になるので、形は平らに切れず点に閉じる）。1 つの輪郭にして左右に写し、墨の 25%。形の最も太い所は、全部の群で同じ 1 スロットの 62%
// （群ごとにばらつきが違いすぎて、1 つの密度の尺度には載らない）。四分位範囲は幅 4pt の墨の 55% の棒、中央値はその密度の幅いっぱいの墨 100% の 1px の線で、値を名前の下に書く。
// 絵の中の数字は全部 data から計算する。
//
// 紙に写して変えた所
// - 暗い地は塗らない。look はこの形で目立たせる 1 つを持たない（橙が無い）ので、紙も墨の濃さだけ。
// - 元は縦軸を 0 から始めた。0 以上の値で最小が最大の 35% 以下の時だけ 0 から（待ち時間は 0 が基準）。ほかは値の範囲に合わせる。値が負になりうる data は、輪郭を 0 で切らない。
// - 元は「P50 16.5 S」の P50 を muted・値を ink の 2 色にしたが、紙の字は 1 色なので、「中央値」（sub）と値（ink の太字）の 2 つの字にして、名前の下に中央で並べる。
// - 元の上の「SECONDS PER TURN」は、data の単位（左上）と各群の件数（右上）にする。下の「SAMPLE ...」は置かない。
// - 形の最も太い所が太りすぎないよう、半幅は 30pt までにする（群が 2 つの時に 1 スロットの 62% だと、形が 130pt を超える）。
// 選ばなかった案
// - 全部の群を 1 つの密度の尺度に載せる案: 山の低く広い群が線になって、2 つの山が見えない。look と同じに、群ごとに最も太い所を揃える。
// - 帯域幅を ECharts や d3 の既定にする案: 見本の山の 2 つ目が埋もれる。Silverman の目安を群ごとに使う。
import { ALPHA, TICK, LABEL, inkFill, inkStroke, fillPath, text, line, rect, svgDoc, empty, num, textWidth, clip, tr, linear, niceExtent, keep, seeded, statDigits, axisLeft, tickSet, polyline, LW, unitNote } from './paper.mjs'
import { readGroups, sorted, quantile, baseZero, normalOf, round, silverman } from './spread-kit.mjs'

/** 形の数の上限（1 つ 30pt 前後で並べられる数） */
const MAX_COLUMNS = 12
const STEPS = 64
/** ガウス核の帯域幅を Epanechnikov 核へ移す係数（Marron と Nolan の canonical bandwidth） */
const EPANECHNIKOV = 2.214
const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 24
const BOTTOM_FROM_BOTTOM = 34
const SLOT_SHARE = 0.62
const MAX_HALF = 30
const BAR_W = 4

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, n: number, q1: number, q2: number, q3: number, dens: [number, number][], lo: number, hi: number }} Shape dens は [値, 密度] の 65 点 */
/** @typedef {{ shapes: Shape[], unit: string }} ViolinData */

/**
 * 1 つの群の密度の形。帯域幅は Silverman の目安 × 2.214。全部が同じ値（帯域幅 0）の時は、値の 5%（0 なら 1）を帯域幅にする
 * @param {number[]} s 小さい順 @param {boolean} nonneg 0 を下の限りにするか
 * @returns {{ dens: [number, number][], lo: number, hi: number }}
 */
function density(s, nonneg) {
  const n = s.length
  const h0 = silverman(s)
  const h = (h0 > 0 ? h0 : Math.abs(s[0]) * 0.05 || 1) * EPANECHNIKOV
  const lo = nonneg ? Math.max(0, s[0] - h) : s[0] - h
  const hi = s[n - 1] + h
  /** @type {[number, number][]} */
  const dens = Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = lo + ((hi - lo) * i) / STEPS
    let d = 0
    for (const v of s) {
      const u = (t - v) / h
      if (u > -1 && u < 1) d += 0.75 * (1 - u * u)
    }
    return [t, d / (n * h)]
  })
  return { dens, lo, hi }
}

/**
 * @param {unknown} data { groups: { name, values }[], unit? }（値が 2 個以上ある群だけ）
 * @returns {{ data: ViolinData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const groups = keep(readGroups(src, warnings, 'ヴァイオリン図', 2), MAX_COLUMNS, warnings, 'ヴァイオリン図: 群')
  const nonneg = groups.every((g) => Math.min(...g.values) >= 0)
  const shapes = groups.map((g) => {
    const s = sorted(g.values)
    return { name: g.name, n: s.length, q1: quantile(s, 0.25), q2: quantile(s, 0.5), q3: quantile(s, 0.75), ...density(s, nonneg) }
  })
  return { data: { shapes, unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * @param {ViolinData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const shapes = data.shapes
  if (!shapes.length) return empty(o)
  const m = shapes.length
  const dLo = Math.min(...shapes.map((s) => s.lo))
  const dHi = Math.max(...shapes.map((s) => s.hi))
  const [lo, hi] = niceExtent(baseZero(dLo, dHi), dHi, 5)
  const yTicks = tickSet(lo, hi, 5)
  const plotBottom = H - BOTTOM_FROM_BOTTOM
  const left = PAD + Math.max(0, ...yTicks.values.map((t) => textWidth(yTicks.fmt(t), TICK))) + 8
  const right = W - PAD
  const y = linear(lo, hi, plotBottom, PLOT_TOP)
  const slot = (right - left) / m
  const half = Math.min(MAX_HALF, (slot * SLOT_SHARE) / 2)
  const digits = statDigits(hi - lo)
  /** @type {string[]} */
  const parts = []

  if (data.unit) parts.push(text(PAD, HEADER_Y, unitNote(data.unit, lang), { size: TICK, fill: pal.sub }))
  const ns = shapes.map((s) => s.n)
  const nMin = Math.min(...ns)
  const nMax = Math.max(...ns)
  parts.push(text(W - PAD, HEADER_Y, nMin === nMax ? tr(lang, `各 ${num(nMin)} 件`, `${num(nMin)} each`) : tr(lang, `${num(nMin)}〜${num(nMax)} 件`, `n = ${num(nMin)}–${num(nMax)}`), { size: TICK, fill: pal.sub, anchor: 'end' }))
  for (const t of yTicks.values) parts.push(line(left, Math.round(y(t)) + 0.5, right, Math.round(y(t)) + 0.5, inkStroke(pal, ALPHA.grid, LW.line)))
  parts.push(axisLeft({ ticks: yTicks.values, at: (t) => Math.round(y(t)) + 0.5, x: left, pal, fmt: yTicks.fmt, stub: false, gap: 3 }))

  const medianWord = tr(lang, '中央値', 'Median')
  shapes.forEach((s, i) => {
    const cx = left + slot * (i + 0.5)
    const dmax = Math.max(...s.dens.map((d) => d[1]))
    const w = (/** @type {number} */ d) => (dmax > 0 ? (half * d) / dmax : 0)
    // 右側を上から下へ、左側を下から上へたどって 1 つの輪郭にする
    const rightSide = /** @type {[number, number][]} */ (s.dens.map(([t, d]) => [cx + w(d), y(t)]))
    const leftSide = /** @type {[number, number][]} */ (s.dens.map(([t, d]) => [cx - w(d), y(t)]).reverse())
    parts.push(fillPath(polyline([...rightSide, ...leftSide], true), inkFill(pal, ALPHA.area)))

    const bar = Math.max(1, y(s.q1) - y(s.q3))
    parts.push(rect(cx - BAR_W / 2, y(s.q3), BAR_W, bar, inkFill(pal, ALPHA.body)))
    // 中央値の線は、中央値の高さの形の幅いっぱい（四分位の棒より細くならない）
    const step = Math.max(0, Math.min(STEPS, Math.round(((s.q2 - s.lo) / (s.hi - s.lo)) * STEPS)))
    const mw = Math.max(BAR_W, w(s.dens[step][1]))
    const my = Math.round(y(s.q2)) + 0.5
    parts.push(line(cx - mw, my, cx + mw, my, inkStroke(pal, 1, LW.line)))

    parts.push(text(cx, plotBottom + 15, clip(s.name, LABEL, slot - 6), { size: LABEL, fill: pal.ink, anchor: 'middle' }))
    const val = num(s.q2, digits)
    const pairW = textWidth(medianWord, TICK) + 3 + textWidth(val, TICK, true)
    parts.push(text(cx - pairW / 2, plotBottom + 26, medianWord, { size: TICK, fill: pal.sub }))
    parts.push(text(cx - pairW / 2 + textWidth(medianWord, TICK) + 3, plotBottom + 26, val, { size: TICK, fill: pal.ink, bold: true }))
  })
  return svgDoc(W, H, parts.join(''))
}

/**
 * 4 つの窓口の待ち時間（分）。look の見本と同じ種・同じ式・同じ混ぜ方（2 つは速い山と重い山の 2 つ）で 300 件ずつ。名前だけ紙の文書に合う物にした
 * @returns {{ groups: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261039)
  const normal = normalOf(rnd)
  /** @type {[string, [number, number, number][]][]} */
  const desks = [
    ['電話', [[0.55, 9, 0.35], [0.45, 28, 0.22]]],
    ['チャット', [[0.65, 6, 0.35], [0.35, 19, 0.25]]],
    ['メール', [[1, 3.5, 0.45]]],
    ['来店', [[1, 15, 0.33]]],
  ]
  return {
    groups: desks.map(([name, mix]) => {
      /** @type {number[]} */
      const values = []
      for (let i = 0; i < 300; i++) {
        let u = rnd()
        let k = 0
        while (k < mix.length - 1 && u > mix[k][0]) u -= mix[k++][0]
        values.push(round(mix[k][1] * Math.exp(mix[k][2] * normal()), 1))
      }
      return { name, values: values.sort((p, q) => p - q) }
    }),
    unit: '分',
  }
}

export default {
  id: 'violin',
  title: 'ヴァイオリン図（Violin plot）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.5),
  sample,
}
