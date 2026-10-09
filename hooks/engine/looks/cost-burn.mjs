// @ts-check
// cost-burn（予算の消化）: 期間の累計の使用額を、平らな予算の線に対して描く。日ごとの額から累計を作り、今日の累計から最小二乗法の傾きで期間の終わりまで点線で延ばす（予測）。
// 予測が予算を超えるなら下げの色にして、超える日を字で書く。日ごとの額は plot の下の細い帯に candle の出来高と同じ作法（スロットの 62%・墨の 10%）で置く。今日は目立たせる 1 つ（縦の点線と「今日」の字）。
// 元は look の designs/cost-burn.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 予算は墨の 35% の点線で期間の全部に伸ばす・累計の線は墨の 85% の 1pt でその下に墨の 8% の面・予測は今日の点から始まり（傾きの線へ飛ばない）終わりに点を置く・
// 予測の字は日ごとの額から計算する（手で書かない）・枠と軸の線は引かず、左の目盛りは 4pt の短い印だけ。
//
// 紙に写して変えた所
// - 暗い地は塗らない。累計の面の 8% は paper の塗りの下限と同じ。今日の縦の点線は accent（mono は墨 100%）。予測の色は pal.up・pal.down。
// - データは x（期間の全部の日の字）・actual（今日までの日ごとの額）・budget（期間の予算）。元は 10 月の 31 日・9 日分・予算 $10 に固定していた。
//   左の目盛りは「0・予算の半分・予算」の 3 つ。額の書き方は予算の大きさで決める（10 万以上は万・億・兆。100 未満は小数 2 桁）。
// - 元の「SAMPLE API SPEND, OCTOBER」は置かない。日の字は最初・真ん中・最後と「今日」（重ならない時だけ）。
// 選ばなかった案
// - 予測を期間の傾き全体の線に飛ばす案: 今日の点から始めるのが元の決まり。傾きは最小二乗法で求めるが、線は今日の累計から延ばす。
// - 日が多い時（年の日数など）に日を間引かず描く案: 366 日までに切る（1 日が 1pt 未満だと面と帯が潰れる）。
import { ALPHA, DASH, TICK, VALUE, inkFill, inkStroke, strokeAttr, hotStroke, strokePath, fillPath, line, rect, circle, text, svgDoc, empty, num, compact, withUnit, textWidth, clip, tr, arr, keep, gutter, dodge, f, numOf, LW, hero, axisLeft } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ labels: string[], daily: number[], budget: number, unit: string }} BurnData */

const MAX_DAYS = 366
const NATURAL_H = 200
const PLOT_TOP = 36
const STRIP_H = 22

/**
 * @param {unknown} data { x: string[], actual: number[], budget: number, unit? }（x は期間の全部の日・actual は今日までの日ごとの額）
 * @returns {{ data: BurnData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.actual)) warnings.push('予算の消化: actual（日ごとの額の列）がありません')
  const budget = numOf(src.budget)
  if (!(budget > 0)) warnings.push('予算の消化: budget が 0 より大きい数ではありません')
  let daily = arr(src.actual).map(numOf)
  const valid = daily.filter((v) => v >= 0).length
  if (valid < daily.length && valid > 0) warnings.push(`予算の消化: 日ごとの額が 0 以上の数でない日 ${daily.length - valid} 日は、0 にしました`)
  if (!valid && Array.isArray(src.actual) && daily.length) warnings.push('予算の消化: 日ごとの額に 0 以上の数がありません')
  daily = daily.map((v) => (v >= 0 ? v : 0))
  const labels = arr(src.x).map((s) => (typeof s === 'string' || typeof s === 'number' ? String(s).trim() : ''))
  if (!(budget > 0) || !valid) return { data: { labels: [], daily: [], budget: 1, unit: '' }, warnings }
  const days = Math.max(labels.length, daily.length)
  const kept = keep(Array.from({ length: days }, (_, i) => i), MAX_DAYS, warnings, '予算の消化: 日').length
  return { data: { labels: labels.slice(0, kept), daily: daily.slice(0, kept), budget, unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * 累計の最小二乗の傾き（日の番号 1..n に対する）。n が 2 未満なら NaN
 * @param {number[]} cum
 */
function slopeOf(cum) {
  const n = cum.length
  if (n < 2) return NaN
  const mx = (n + 1) / 2
  const my = cum.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  cum.forEach((y, i) => {
    sxy += (i + 1 - mx) * (y - my)
    sxx += (i + 1 - mx) ** 2
  })
  return sxy / sxx
}

/**
 * @param {BurnData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const { daily, budget, unit } = data
  if (!daily.length) return empty(o)
  const n = daily.length
  const days = Math.max(data.labels.length, n)
  /** @type {number[]} */
  const cum = []
  daily.reduce((s, d) => (cum.push(s + d), s + d), 0)
  const spent = cum[n - 1]
  const slope = slopeOf(cum)
  const canProject = n >= 2 && n < days && Number.isFinite(slope)
  const projected = canProject ? spent + slope * (days - n) : spent
  const over = canProject && projected > budget
  const crossDay = over && spent < budget && slope > 0 ? n + (budget - spent) / slope : NaN

  // 額の字。予算が大きければ万・億・兆・小さければ小数 2 桁
  const money = (/** @type {number} */ v) => withUnit(budget >= 1e5 ? compact(v, lang) : num(v, budget >= 100 ? 0 : 2), unit)
  const tickText = (/** @type {number} */ v) => withUnit(budget >= 1e5 ? compact(v, lang) : num(v, Number.isInteger(v) ? 0 : 2), unit)

  const yMax = Math.max(budget * 1.25, Math.max(projected, spent) * 1.06)
  const stripBottom = H - 18
  const stripTop = stripBottom - STRIP_H
  const plotBottom = stripTop - 16
  const plotL = 4 + Math.max(...[0, budget / 2, budget].map((v) => textWidth(tickText(v), TICK))) + 12
  const padR = gutter([money(projected), tr(lang, '予測', 'Projected'), tr(lang, '予算', 'Budget')], { size: VALUE, bold: true })
  const plotR = W - padR
  const x = (/** @type {number} */ d) => plotL + ((plotR - plotL) * d) / days
  const y = (/** @type {number} */ v) => plotBottom - ((plotBottom - PLOT_TOP) * v) / yMax
  const slot = (plotR - plotL) / days

  /** @type {string[]} */
  const parts = []
  // 見出し: 累計と、それが数える予算
  parts.push(hero(money(spent), tr(lang, `累計・予算 ${money(budget)}`, `Spent of ${money(budget)} budget`), pal, 4, 18, W - 4))

  // 左の目盛り: 4pt の印だけ（軸の線は引かない）
  parts.push(axisLeft({ ticks: [0, budget / 2, budget], at: y, x: plotL, pal, fmt: tickText }))
  // 予算: 期間の全部に伸びる 35% の点線
  parts.push(line(plotL, y(budget), plotR, y(budget), inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))

  // 累計: 0 から始まる 1pt の線と、その下の薄い面
  const pts = [[x(0), y(0)], ...cum.map((v, i) => [x(i + 1), y(v)])]
  const path = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)} ${f(py)}`).join('')
  parts.push(fillPath(`${path}L${f(x(n))} ${f(y(0))}Z`, inkFill(pal, ALPHA.faint)))
  parts.push(strokePath(path, inkStroke(pal, ALPHA.heavy, LW.line)))

  // 予測: 今日の点から期間の終わりへ。予算を超えるなら下げの色
  const pc = over ? pal.down : pal.up
  /** 右の列の字（予測の名前・額・予算の名前）は互いに離す @type {number[]} */
  let rightYs = [y(budget) + 3]
  if (canProject) {
    parts.push(line(x(n), y(spent), x(days), y(projected), strokeAttr(pc, 1, LW.line, DASH.ref)))
    parts.push(circle(x(days), y(projected), 2, `fill="${pc}"`))
    rightYs = dodge([y(projected) - 8, y(projected) + 4, y(budget) + 3], 11, PLOT_TOP, plotBottom)
    parts.push(text(W - 4, rightYs[0], tr(lang, '予測', 'Projected'), { size: TICK, fill: pal.sub, anchor: 'end' }))
    parts.push(text(W - 4, rightYs[1], money(projected), { size: VALUE, fill: pc, anchor: 'end', bold: true }))
    if (Number.isFinite(crossDay) && crossDay <= days) {
      const cx = x(crossDay)
      parts.push(circle(cx, y(budget), 2, `fill="${pal.down}"`))
      parts.push(text(cx - 6, y(budget) - 6, tr(lang, `${Math.ceil(crossDay)} 日目に予算超過`, `Over on day ${Math.ceil(crossDay)}`), { size: TICK, fill: pal.down, anchor: 'end' }))
    }
  }
  parts.push(text(W - 4, canProject ? rightYs[2] : rightYs[0], tr(lang, '予算', 'Budget'), { size: TICK, fill: pal.sub, anchor: 'end' }))

  // 日ごとの額: candle の出来高と同じ（スロットの 62%・墨の 10%）。いちばん大きい日だけ値を書く
  const dmax = Math.max(...daily)
  let big = 0
  daily.forEach((d, i) => {
    if (d > daily[big]) big = i
    const h = dmax > 0 ? ((stripBottom - stripTop) * d) / dmax : 0
    parts.push(rect(x(i + 1) - slot / 2 - slot * 0.31, stripBottom - h, slot * 0.62, h, inkFill(pal, ALPHA.quiet)))
  })
  parts.push(text(plotL - 8, stripBottom, tr(lang, '日額', 'Daily'), { size: TICK, fill: pal.sub, anchor: 'end' }))
  if (dmax > 0) parts.push(text(x(big + 1) - slot * 0.19, stripTop - 3, money(dmax), { size: TICK, fill: pal.ink, anchor: 'end' }))
  parts.push(line(plotL, stripBottom, plotR, stripBottom, inkStroke(pal, ALPHA.faint, LW.line)))

  // 今日: 点が累計の線を終え、目立たせる 1 つの縦の点線が plot と帯を通る
  const tx = x(n)
  parts.push(line(tx, PLOT_TOP, tx, stripBottom, hotStroke(pal, 1, LW.line, 1, DASH.ref)))
  parts.push(circle(tx, y(spent), 2, inkFill(pal)))

  // 日の字: 最初・真ん中・最後と「今日」。今日を優先し、重なる字は置かない
  const todayText = tr(lang, '今日', 'Today')
  /** @type {{ s: string, cx: number, fill: string }[]} */
  const marks = [{ s: todayText, cx: tx, fill: pal.accent }]
  const dayCx = (/** @type {number} */ i) => x(i + 1) - slot / 2
  for (const i of [0, days - 1, Math.floor((days - 1) / 2)]) {
    const s = clip(data.labels[i] ?? String(i + 1), TICK, (plotR - plotL) / 3)
    const w = textWidth(s, TICK)
    if (s && marks.every((m) => Math.abs(m.cx - dayCx(i)) >= (textWidth(m.s, TICK) + w) / 2 + 6)) marks.push({ s, cx: dayCx(i), fill: pal.sub })
  }
  for (const m of marks) {
    if (m.fill === pal.sub) parts.push(line(m.cx, stripBottom, m.cx, stripBottom + 4, strokeAttr(pal.sub, 1, LW.line)))
    parts.push(text(m.cx, H - 4, m.s, { size: TICK, fill: m.fill, anchor: 'middle' }))
  }
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（10 月の 9 日分・予算 10）。単位を万円に直した。日の字は「10/1」 */
function sample() {
  return {
    x: Array.from({ length: 31 }, (_, i) => `10/${i + 1}`),
    actual: [0.34, 0.41, 0.14, 0.09, 0.46, 0.51, 0.44, 0.55, 0.48],
    budget: 10,
    unit: '万円',
  }
}

export default {
  id: 'cost-burn',
  title: '予算の消化（Spend against budget）',
  category: 'usage',
  normalize,
  draw,
  height: () => NATURAL_H,
  sample,
}
