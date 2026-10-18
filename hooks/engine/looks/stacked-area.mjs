// @ts-check
// stacked-area（積み上げ面）: 4 つの部門の日ごとの経費を 30 日分、下から積む。土日の谷が 4 回、リズムとして出る。
// 元は look の designs/stacked-area.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 積み上げと面は d3-shape の stack() と area()・line()（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 帯は下から 25%・18%・12%・8% の墨の段（下の帯がいちばん濃い）。55% の本体のような濃さにしない（頁を埋める面が、ほかの図より目立つ）。
// 帯どうしは 1pt の細い線（地の色）で分け、日の合計は帯の上の縁の 1pt の線（墨の 85%）。点と点は曲線でなく直線（点は 1 日ごとなので）。
// 右の端に、帯ごとの札・名前・期間の合計を置き、ラベルの中心どうしを 12pt 以上離す 2 回の押し分けで、薄い帯の字が重ならないようにする。見出しは期間の合計（帯の合計の和）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。地の色の細い線は、紙の色（pal.paper）の 1pt（paper の seam）。段は、帯が 4 つまでは元の 4 段、5 つ以上は 40% から 8% へ等間隔。
// - 帯の順は data の series の順（下から上）。元は上の 4 つの名前を JS の表で持っていたので、data の並びに任せる（いちばん大きい帯を下に置くのは書く側の判断）。
// - 数でない値（欠測）と負の値は 0 にして warnings に書く（積む形は負の帯が上の帯を壊す）。
// - 見出しは「期間の合計」（元は「SPENT IN 30 DAYS」。紙の data には日数の単位が無いので、期間と書く）。目盛りは 0 から切りのよい値。下の x の字は等間隔。
// 選ばなかった案
// - 帯の濃さを系列の見た目の段（seriesStyle の 100%・55%・30%）にする案: 面が 55% を超えると頁の上で重く、4 つの帯が同じ濃さの塊に見える。面は元の「静かな段」のまま。
// - 帯の名前を d3 の keys にそのまま渡す案: 同じ名前の系列が 2 本あると積み上げが 1 本になる。keys は系列の番号にする。
import { area, line, stack } from '../../vendor/d3.mjs'
import { ALPHA, VALUE, LABEL, fillAttr, seriesFill, inkStroke, seam, text, rect, strokePath, fillPath, svgDoc, empty, num, withUnit, textWidth, clip, dodge, midline, tr, decimals, axisLeft, hero, seeded, LW } from './paper.mjs'
import { readSeries, yScale, scalePad, evenLabels, xTexts, isoDays, TOP_HERO, X_ROW } from './time-series.mjs'

const PAD = 4
const GAP = 12
const SWATCH = 7

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */
/** @typedef {[number, number][] & { key: number, index: number }} Layer d3 の stack が返す 1 つの流れ（点ごとの [下, 上]） */

/**
 * @param {unknown} data { x, series: [{ name, values }]（下から上の順）, unit? }
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  const { data: d, warnings } = readSeries(data, '積み上げ面')
  let fixed = 0
  const rows = d.rows.map((r) => ({ ...r, values: r.values.map((v) => { if (Number.isFinite(v) && v >= 0) return v; fixed++; return 0 }) }))
  if (fixed) warnings.push(`積み上げ面: 欠測と負の値 ${fixed} 個を 0 にしました（積む形は負の帯を描けません）`)
  return { data: { ...d, rows }, warnings }
}

/**
 * 帯 k 本の墨の濃さ（下から）。4 本までは元の段、それより多い時は 40% から 8% へ等間隔
 * @param {number} k
 */
export function bandSteps(k) {
  if (k <= 4) return [ALPHA.area, ALPHA.card, ALPHA.grid, ALPHA.faint].slice(0, k)
  return Array.from({ length: k }, (_, i) => 0.4 - ((0.4 - ALPHA.faint) * i) / (k - 1))
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
  const K = rows.length
  // d3 の stack は渡した物を使うので、毎回作る。keys は系列の番号（同じ名前の系列があっても積める）
  const table = Array.from({ length: n }, (_, i) => Object.fromEntries(rows.map((r, k) => [k, r.values[i]])))
  const layers = /** @type {Layer[]} */ (/** @type {any} */ (stack()).keys(rows.map((_, k) => k))(table))
  const totals = rows.map((r) => r.values.reduce((s, v) => s + v, 0))
  const grand = totals.reduce((s, v) => s + v, 0)
  const peak = Math.max(0, ...layers[K - 1].map((p) => p[1]))
  const top = TOP_HERO + 4
  const bottom = H - X_ROW - 2
  const sc = yScale(0, peak, top, bottom, { count: 3, zero: true })
  const unit = d.unit || rows[0].unit
  const digits = decimals(rows.flatMap((r) => r.values))
  const fmt = (/** @type {number} */ v) => withUnit(num(v, digits), unit)
  const tickText = (/** @type {number} */ v) => withUnit(num(v, sc.digits), unit)
  const padL = scalePad(sc.ticks.map(tickText))
  const valW = Math.max(...totals.map((t) => textWidth(fmt(t), VALUE, true)))
  // 名前の列に残せる幅: 面の幅を 60pt は残す（狭い図では名前を「…」で切る）
  const room = W - PAD - padL - 60 - valW - 8 - 4 - SWATCH - 8
  // 残りが 24pt に満たない狭い図では名前を置かない（札と合計は置く）
  const names = rows.map((r) => (room < 24 ? '' : clip(r.name, LABEL, Math.min(W * 0.2, room))))
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL)))
  const plotR = Math.max(padL + 40, W - PAD - valW - 8 - nameW - 4 - SWATCH - 8)
  const at = (/** @type {number} */ i) => (n > 1 ? padL + ((plotR - padL) * i) / (n - 1) : (padL + plotR) / 2)
  const steps = bandSteps(K)

  const band = area().x((/** @type {any} */ _p, /** @type {number} */ i) => at(i)).y0((/** @type {number[]} */ p) => sc.y(p[0])).y1((/** @type {number[]} */ p) => sc.y(p[1])).digits(2)
  const edge = line().x((/** @type {any} */ _p, /** @type {number} */ i) => at(i)).y((/** @type {number[]} */ p) => sc.y(p[1])).digits(2)

  /** @type {string[]} */
  const parts = []
  layers.forEach((s, k) => parts.push(fillPath(band(/** @type {any} */ (s)) ?? '', seriesFill(pal, k) ?? fillAttr(pal.ink, steps[k]))))
  // 帯どうしを分ける地の色の線は、最後の帯以外の上の縁に。日の合計は最後の帯の上の縁
  layers.slice(0, -1).forEach((s) => parts.push(strokePath(edge(/** @type {any} */ (s)) ?? '', seam(pal))))
  parts.push(strokePath(edge(/** @type {any} */ (layers[K - 1])) ?? '', inkStroke(pal, ALPHA.heavy, LW.line)))
  parts.push(axisLeft({ ticks: sc.ticks, at: sc.y, fmt: tickText, x: padL, pal }))
  parts.push(hero(fmt(grand), tr(lang, '期間の合計', 'Total for the period'), pal, PAD, 18, W - 4))

  // 右の端: 最後の日の各帯の真ん中の高さに札・名前・合計。薄い帯でラベルが重ならないよう押し分ける
  const last = n - 1
  const mids = layers.map((s) => sc.y((s[last][0] + s[last][1]) / 2))
  const ys = dodge(mids, GAP, top + 4, bottom - 2)
  rows.forEach((_, k) => {
    const ly = ys[k]
    parts.push(rect(plotR + 8, ly - SWATCH / 2, SWATCH, SWATCH, seriesFill(pal, k) ?? fillAttr(pal.ink, steps[k])))
    parts.push(rect(plotR + 8, ly - SWATCH / 2, SWATCH, SWATCH, 'fill="none" ' + inkStroke(pal, ALPHA.ref, LW.hair)))
    parts.push(text(plotR + 8 + SWATCH + 4, midline(ly, LABEL), names[k], { size: LABEL, fill: pal.sub }))
    parts.push(text(W - PAD, midline(ly, VALUE), fmt(totals[k]), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  })
  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種（20261013）・同じ作り。部門別の日ごとの経費（万円）を 2026-09-10（木）から 30 日。
 * 開発部は月の中で増え続け、営業部・サポート・その他は土日に下がる
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const DAYS = 30
  const rnd = seeded(20261013)
  const DEPTS = [
    { name: '開発部', base: (/** @type {number} */ d) => 4.6 + (3.2 * d) / (DAYS - 1), weekend: 0.35 },
    { name: '営業部', base: () => 3.3, weekend: 0.4 },
    { name: 'サポート', base: () => 0.95, weekend: 0.6 },
    { name: 'その他', base: () => 0.45, weekend: 0.9 },
  ]
  /** @type {number[][]} */
  const cols = DEPTS.map(() => [])
  for (let d = 0; d < DAYS; d++) {
    const dow = (4 + d) % 7 // 2026-09-10 は木曜。0 が日曜
    const weekend = dow === 0 || dow === 6
    DEPTS.forEach((m, k) => cols[k].push(Math.round(m.base(d) * (weekend ? m.weekend : 1) * (0.82 + rnd() * 0.36) * 100) / 100))
  }
  return { x: isoDays(2026, 9, 10, DAYS), series: DEPTS.map((m, k) => ({ name: m.name, values: cols[k] })), unit: '万円' }
}

export default {
  id: 'stacked-area',
  title: '積み上げ面（Stacked area chart）',
  category: 'time',
  normalize,
  draw,
  // 右の余白の札が帯の数だけ縦に並ぶ（1 つ 12pt）ので、帯が多い時は高くする
  height: (/** @type {number} */ width, /** @type {TimeData} */ data) => Math.max(Math.round(width * 0.52), 70 + GAP * (data?.rows?.length ?? 4)),
  sample,
}
