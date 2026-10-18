// @ts-check
// bump（順位の推移）: 系列ごとの順位を、期間ごとに 1 本の線で結び、線の交わりを「抜いた・抜かれた」と読ませる。両端に名前、左に順位の数。
// 元は look の designs/bump.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 線は d3-shape の line() と curveBumpX（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 線は 1pt で墨の 35%（candle の参照線と同じ濃さ）。目立たせる 1 本だけを濃くし、その線には全部の期間に点（r=2）を打つ。
// 薄い線を先に描き、目立たせる線を最後に描く（交わりの上に載る）。名前は両端に、その系列が始まる順位と終わる順位に置く。順位の数は左に並べる。
//
// 紙に写して変えた所
// - data の values は順位でなく量（売上など）。期間ごとに大きい順に 1・2・3… と順位を付ける（同じ量なら先に書いた系列が上）。元の見本の順位を並べ替えた形で渡す必要が無い。
//   数でない値（欠測）はその期間の順位に入れず、線はそこで切れる。
// - 目立たせる 1 本は data.highlight（系列の名前）。無ければ、最初の順位から最後の順位へいちばん上がった系列（上がった系列が無ければ無し）。
//   mono では accent が墨なので、目立たせる線は墨 100% の 1.5pt・名前は太字（元は線の太さが同じで色だけが違った。mono は色で分けられない）。
// - 行の間は図の高さを順位の数で割った物（元は 24px の固定）。期間の字は上に、evenLabels の等間隔で置く（元は 8 週ぜんぶ）。元の下の「SAMPLE …」は置かない。
// 選ばなかった案
// - 順位をそのまま data に入れさせる案: 紙の文書の側で「期間ごとの順位」を作る手間が増え、同順位の扱いもばらばらになる。量から順位を出す方が data は 1 つで済む。
import { line, curveBumpX } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, strokeAttr, hot, hotFill, hotStroke, seriesStroke, text, circle, strokePath, svgDoc, empty, textWidth, clip, dodge, midline, seeded, LW } from './paper.mjs'
import { readSeries, lastIndex, evenLabels, xTexts, isoDays } from './time-series.mjs'

const PAD = 4
const NAME_GAP = 8
const TOP = 26
const BOTTOM = 12
const ROW = 22

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/**
 * @param {unknown} data { x, series: [{ name, values }], highlight? }（values は量。期間ごとに大きい順で順位を付ける）
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  return readSeries(data, '順位の推移')
}

/**
 * 期間ごとの順位（1 が最大）。欠測は NaN。同じ量は系列の並び順
 * @param {TimeData} d
 * @returns {number[][]} ranks[系列][期間]
 */
export function rankColumns(d) {
  /** @type {number[][]} */
  const ranks = d.rows.map(() => Array(d.n).fill(NaN))
  for (let i = 0; i < d.n; i++) {
    d.rows
      .map((r, k) => ({ v: r.values[i], k }))
      .filter((e) => Number.isFinite(e.v))
      .sort((a, b) => b.v - a.v || a.k - b.k)
      .forEach((e, rank) => { ranks[e.k][i] = rank + 1 })
  }
  return ranks
}

/**
 * 目立たせる系列: data.highlight、無ければ最初の順位から最後の順位へいちばん上がった系列（上がった系列が無ければ -1）
 * @param {TimeData} d @param {number[][]} ranks
 */
function climber(d, ranks) {
  if (d.highlight >= 0) return d.highlight
  let best = -1
  let gain = 0
  ranks.forEach((r, k) => {
    const first = r.find(Number.isFinite)
    const last = r[lastIndex(r)]
    if (first !== undefined && last !== undefined && first - last > gain) { gain = first - last; best = k }
  })
  return best
}

/**
 * @param {TimeData} d
 * @param {DrawOpts} o
 */
function draw(d, o) {
  const { width: W, height: H, pal, lang } = o
  if (!d.rows.length) return empty(o)
  const R = d.rows.length
  const n = d.n
  const ranks = rankColumns(d)
  const hotK = climber(d, ranks)
  const rankW = textWidth(String(R), TICK)
  // 名前の列は図の幅の 2 割まで。狭い図では、線の幅を 40pt は残すよう名前を「…」で切る
  const maxName = Math.max(10, Math.min(W * 0.2, (W - PAD * 2 - rankW - NAME_GAP * 4 - 40) / 2))
  const names = d.rows.map((r) => clip(r.name, LABEL, maxName))
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL, true)))
  const plotL = PAD + rankW + NAME_GAP + nameW + NAME_GAP
  const plotR = Math.max(plotL + 40, W - PAD - nameW - NAME_GAP)
  const row = R > 1 ? Math.max(1, (H - TOP - BOTTOM) / (R - 1)) : 0
  const y = (/** @type {number} */ r) => TOP + (r - 1) * row
  const at = (/** @type {number} */ i) => (n > 1 ? plotL + ((plotR - plotL) * i) / (n - 1) : (plotL + plotR) / 2)
  const path = /** @type {any} */ (line()).curve(curveBumpX).defined((/** @type {number[]} */ p) => Number.isFinite(p[1])).digits(2)

  /** @type {string[]} */
  const parts = []
  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, TOP - 14, pal))
  for (let r = 1; r <= R; r++) parts.push(text(PAD + rankW, midline(y(r), TICK), String(r), { size: TICK, fill: pal.sub, anchor: 'end' }))

  // 薄い線を先に、目立たせる線を最後に（交わりの上に載せる）
  const order = [...d.rows.keys()].filter((k) => k !== hotK)
  if (hotK >= 0) order.push(hotK)
  /** @type {{ k: number, first: number, last: number }[]} */
  const ends = []
  for (const k of order) {
    const isHot = k === hotK
    /** @type {[number, number][]} */
    const pts = ranks[k].map((r, i) => [at(i), Number.isFinite(r) ? y(r) : NaN])
    parts.push(strokePath(path(pts) ?? '', isHot ? hotStroke(pal, 1, LW.hot) : seriesStroke(pal, k, hotK, LW.line) ?? strokeAttr(pal.ink, ALPHA.ref, LW.line)))
    if (isHot) for (const p of pts) if (Number.isFinite(p[1])) parts.push(circle(p[0], p[1], 2, hotFill(pal, 1, 1)))
    const first = ranks[k].findIndex(Number.isFinite)
    const last = lastIndex(ranks[k])
    if (first >= 0) ends.push({ k, first: ranks[k][first], last: ranks[k][last] })
  }
  // 名前は両端の順位に。同じ高さに重なる（欠測で始まりが違う系列）時だけ押し分ける
  const gap = Math.min(LABEL + 3, Math.max(row, 1))
  const ysL = dodge(ends.map((e) => y(e.first)), gap, TOP - 4, TOP + (R - 1) * row + 4)
  const ysR = dodge(ends.map((e) => y(e.last)), gap, TOP - 4, TOP + (R - 1) * row + 4)
  const textColor = hot(pal, 1).color
  ends.forEach((e, j) => {
    const isHot = e.k === hotK
    const opt = { size: LABEL, fill: isHot ? textColor : pal.ink, bold: isHot }
    parts.push(text(plotL - NAME_GAP, midline(ysL[j], LABEL), names[e.k], { ...opt, anchor: 'end' }))
    parts.push(text(plotR + NAME_GAP, midline(ysR[j], LABEL), names[e.k], opt))
  })
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ順位の表（8 つの店を 8 週）。順位から量（万円）を作る: 順位 r の量は 900 - 80r に ±20 の揺れ（順位の間は 80 なので順位は変わらない）
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const RANKS = [
    ['渋谷店', [1, 1, 1, 2, 2, 2, 3, 2]],
    ['新宿店', [2, 2, 3, 3, 4, 3, 2, 3]],
    ['池袋店', [3, 4, 2, 1, 1, 4, 5, 5]],
    ['横浜店', [4, 3, 4, 5, 5, 5, 4, 4]],
    ['大宮店', [5, 5, 7, 8, 7, 6, 6, 7]],
    ['千葉店', [6, 8, 6, 6, 6, 7, 8, 8]],
    ['川崎店', [7, 6, 5, 4, 3, 1, 1, 1]],
    ['船橋店', [8, 7, 8, 7, 8, 8, 7, 6]],
  ]
  const rnd = seeded(20261012)
  return {
    x: isoDays(2026, 8, 17, 8, 7),
    series: RANKS.map(([name, ranks]) => ({ name: String(name), values: /** @type {number[]} */ (ranks).map((r) => Math.round(900 - 80 * r + (rnd() - 0.5) * 40)) })),
    unit: '万円',
  }
}

export default {
  id: 'bump',
  title: '順位の推移（Bump chart）',
  category: 'time',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {TimeData} */ data) => TOP + BOTTOM + Math.max(1, (data?.rows?.length ?? 8) - 1) * ROW + 8,
  sample,
}

