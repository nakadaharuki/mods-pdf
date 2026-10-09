// @ts-check
// sparks（スパークライン）: 系列ごとに 1 行。細い線と、その下の薄い面・最後の点・右に揃えた最後の値で、水準と最近の動きを軸なしで読ませる。
// 元は look の designs/sparks.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 線は 1pt で墨の 85%・その下の面は墨の 8%・最後の値に点（r=2）・値は右揃え・行どうしの間は墨の細い線（最後の行の後には引かない）。
// 行ごとに自分の範囲（最小〜最大）を持つので、ほとんど動かない指標でも揺れが見える。軸と目盛りは無い。
//
// 紙に写して変えた所
// - 暗い地は塗らない。名前は sub（元の MUTED）・値は墨（太字）。字は pt で、元の 10px・11px は紙の 8・8（太字）。
// - 行の高さは図の高さを行数で割った物（元は 46px の固定）。名前の列は最長の名前の幅・値の列は最長の値の幅で決め、図の幅いっぱいに線を伸ばす。
// - 元の「SAMPLE 1h」の代わりに、線の最初と最後の x の字（真ん中は離れて収まる時だけ）を一番下に置く。
// - 値の単位は系列ごとに持てる（series[i].unit。無ければ data.unit）。元の「/m」「%」「ms」「$」の書き分けのため。
// - 欠測（数でない値）の所で線と面は切れる。最後の値は、最後の数の値。
// 選ばなかった案
// - 全部の行を同じ目盛りに揃える案: 件数と率が同じ図に混ざると、小さい方が真っ直ぐな線になって動きが見えない（元の決まりと逆）。
import { ALPHA, LABEL, VALUE, inkFill, inkStroke, seriesFill, seriesStroke, seriesColor, fillAttr, text, line, circle, fillPath, strokePath, svgDoc, empty, num, withUnit, textWidth, clip, linear, midline, edgeLabels, seeded, decimals, LW } from './paper.mjs'
import { readSeries, lastIndex, extentOf, xTexts, linePath, areaPath, isoDays } from './time-series.mjs'

const PAD = 4
const TOP = 6
const BOTTOM = 18
/** 1 行の既定の高さ。行の中の線の高さはこの 56%（元の 24px / 46px は 52%） */
const ROW = 38
const GAP = 12

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/**
 * @param {unknown} data { x, series: [{ name, values, unit? }], unit? }
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  return readSeries(data, 'スパークライン')
}

/**
 * @param {TimeData} d
 * @param {DrawOpts} o
 */
function draw(d, o) {
  const { width: W, height: H, pal, lang } = o
  if (!d.rows.length) return empty(o)
  const rows = d.rows
  const n = d.n
  const names = rows.map((r) => clip(r.name, LABEL, W * 0.24))
  const finals = rows.map((r) => {
    const k = lastIndex(r.values)
    return k < 0 ? '–' : withUnit(num(r.values[k], decimals(r.values)), r.unit || d.unit)
  })
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL)))
  const valW = Math.max(...finals.map((s) => textWidth(s, VALUE, true)))
  const plotL = PAD + nameW + GAP
  const plotR = Math.max(plotL + 20, W - PAD - valW - GAP - 3)
  const row = (H - TOP - BOTTOM) / rows.length
  const at = (/** @type {number} */ i) => (n > 1 ? plotL + ((plotR - plotL) * i) / (n - 1) : (plotL + plotR) / 2)

  /** @type {string[]} */
  const parts = []
  rows.forEach((r, k) => {
    const top = TOP + k * row
    const y0 = top + row * 0.14
    const y1 = top + row * 0.7
    const [lo, hi] = extentOf(r.values)
    const y = linear(lo, hi, y1, y0)
    /** @type {[number, number][]} */
    const pts = r.values.map((v, i) => [at(i), Number.isFinite(v) ? y(v) : NaN])
    parts.push(fillPath(areaPath(pts, y1), seriesFill(pal, k, -1, 0.18) ?? inkFill(pal, ALPHA.faint)))
    parts.push(strokePath(linePath(pts), seriesStroke(pal, k, -1, LW.line) ?? inkStroke(pal, ALPHA.heavy, LW.line)))
    const last = lastIndex(r.values)
    if (last >= 0) parts.push(circle(at(last), y(r.values[last]), 2, fillAttr(seriesColor(pal, k) ?? pal.ink, 1)))
    const mid = midline((y0 + y1) / 2, LABEL)
    parts.push(text(PAD, mid, names[k], { size: LABEL, fill: pal.sub }))
    parts.push(text(W - PAD, mid, finals[k], { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
    if (k < rows.length - 1) parts.push(line(PAD, top + row * 0.9, W - PAD, top + row * 0.9, inkStroke(pal, ALPHA.faint, LW.line)))
  })
  parts.push(edgeLabels(xTexts(d.x, lang), at, plotL, plotR, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ 6 つの種（11・23・37・41・53・67）の歩き。60 日。値は表示の桁に丸めた数
 * @returns {{ x: string[], series: { name: string, values: number[], unit: string }[] }}
 */
function sample() {
  const N = 60
  const walk = (/** @type {number} */ seed, /** @type {number} */ base, /** @type {number} */ step, /** @type {number} */ cap, /** @type {number} */ digits) => {
    const rnd = seeded(seed)
    const p = 10 ** digits
    let v = base
    return Array.from({ length: N }, () => {
      v = Math.min(cap, Math.max(base * 0.5, v + (rnd() - 0.5) * step))
      return Math.round(v * p) / p
    })
  }
  return {
    x: isoDays(2026, 8, 11, N),
    series: [
      { name: '注文数', values: walk(11, 1280, 260, Infinity, 0), unit: '件/時' },
      { name: 'エラー率', values: walk(23, 0.42, 0.2, Infinity, 2), unit: '%' },
      { name: '応答時間', values: walk(37, 212, 48, Infinity, 0), unit: 'ms' },
      { name: '待ち行列', values: walk(41, 17, 9, Infinity, 0), unit: '件' },
      { name: 'キャッシュ率', values: walk(53, 91.3, 3.4, 99.4, 1), unit: '%' },
      { name: '客単価', values: walk(67, 3180, 700, Infinity, 0), unit: '円' },
    ],
  }
}

export default {
  id: 'sparks',
  title: 'スパークライン（Sparklines）',
  category: 'time',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {TimeData} */ data) => Math.max(60, TOP + BOTTOM + Math.max(1, data?.rows?.length ?? 6) * ROW),
  sample,
}
