// @ts-check
// pnl（収支の見通し）: 年ごとに、売上の棒（左）と費用の棒（右）を並べ、利益を 1 本の線で重ねる。上に売上の年平均の伸び（大きな数）・下に 3 行の数の表。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし（軸の目盛りは引かず、数は下の表に書く）・目立たせるのは 1 つだけ（売上）・字は paper の段・墨の割合は paper の ALPHA。
// - 売上の棒は、色のある紙では grad を左から右へ 1 本で通した面（年が進むほど橙へ）・mono は墨 55%。費用の棒は墨 18%。利益の線は墨・節は紙の色の輪（線の後ろに紙の色の太い線を敷いて、棒の上でも読める）。
// - 利益が負の年があれば、0 の所に点線を 1 本だけ引く。
// - 年平均の伸び（CAGR）は、最初と最後の売上が 0 より大きい時だけ、hero で書く（見出しの数）。
// 選ばなかった案
// - 左に値の目盛りを置く案: 3 つの系列の値が下の表にあり、目盛りと二重になる。表なら桁がそろい、利益の負の値も色で読める。
// - 利益も棒にする案: 売上・費用の棒の隣に 3 本目が並び、1 年の幅が詰まる。利益は線にして、棒の上に重ねる。
// - 棒 1 本ずつに別のグラデーションを付ける案: 年ごとに色が戻る。1 本の左から右のグラデーションで、年が進む向きを色でも見せる。
import { ALPHA, LW, DASH, TICK, LABEL, inkFill, seriesFill, inkStroke, hot, fillAttr, strokeAttr, paints, legend, circle, line, rect, text, strokePath, clip, svgDoc, empty, strOf, numOf, keep, hero, percent, decimals, num, unitNote, niceExtent, linear, polyline, tr } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ x: string[], revenue: number[], cost: number[], profit: number[], unit: string }} PnlData */

const MAX_COLUMNS = 8
const PAD = 12
const HEAD = 34
const XLAB = 16
const ROW = 13

/**
 * @param {unknown} data { x: string[2..8], revenue: number[], cost: number[], profit?: number[], unit }（profit を省くと売上 - 費用）
 * @returns {{ data: PnlData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.x) || !Array.isArray(src.revenue) || !Array.isArray(src.cost)) warnings.push('収支: x（年の字の列）・revenue（売上の数の列）・cost（費用の数の列）が要ります')
  const xs = Array.isArray(src.x) ? src.x : []
  const hasProfit = Array.isArray(src.profit)
  /** @type {PnlData} */
  const out = { x: [], revenue: [], cost: [], profit: [], unit: strOf(src.unit) }
  let bad = 0
  let wrongProfit = 0
  xs.forEach((xv, i) => {
    const label = strOf(xv)
    const r = numOf(Array.isArray(src.revenue) ? src.revenue[i] : NaN)
    const c = numOf(Array.isArray(src.cost) ? src.cost[i] : NaN)
    if (!label || !(r >= 0) || !(c >= 0)) { bad++; return }
    let p = hasProfit ? numOf(src.profit[i]) : NaN
    if (hasProfit && Number.isNaN(p)) wrongProfit++
    if (Number.isNaN(p)) p = r - c
    out.x.push(label)
    out.revenue.push(r)
    out.cost.push(c)
    out.profit.push(p)
  })
  if (bad) warnings.push(`収支: 年の字・売上・費用（0 以上の数）が読めない年 ${bad} 個を捨てました`)
  if (wrongProfit) warnings.push(`収支: profit が数でない年 ${wrongProfit} 個は、売上 - 費用にしました`)
  if (out.x.length > MAX_COLUMNS) {
    keep(out.x, MAX_COLUMNS, warnings, '収支: 年')
    for (const k of /** @type {const} */ (['x', 'revenue', 'cost', 'profit'])) out[k] = /** @type {any[]} */ (out[k]).slice(0, MAX_COLUMNS)
  }
  if (out.x.length < 2) {
    if (xs.length) warnings.push('収支: 年は 2 個以上要ります')
    return { data: { x: [], revenue: [], cost: [], profit: [], unit: out.unit }, warnings }
  }
  return { data: out, warnings }
}

/**
 * @param {PnlData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const n = data.x.length
  if (n < 2) return empty(o)
  const g = paints(pal)
  const all = [...data.revenue, ...data.cost, ...data.profit]
  const digits = decimals(all, 2)
  const lo = Math.min(0, ...data.profit)
  // 上は切りのよい値まで。下は利益のいちばん小さい値に少し余白を足すだけ（切りのよい値まで下げると、棒の下に何も無い余白ができる）
  const [, nhi] = niceExtent(0, Math.max(...data.revenue, ...data.cost, ...data.profit, 1e-9), 4)
  const nlo = lo < 0 ? lo - (nhi - lo) * 0.06 : 0
  const labelW = 34
  const px0 = PAD + labelW
  const px1 = W - PAD
  const gw = (px1 - px0) / n
  const tableH = 3 * ROW
  const unit = unitNote(data.unit, lang)
  const unitH = unit ? 14 : 0
  const py0 = PAD + HEAD
  const py1 = H - PAD - tableH - XLAB - unitH
  const y = linear(nlo, nhi, py1, py0)
  const barW = Math.max(4, Math.min(28, gw * 0.3))
  const mid = (/** @type {number} */ i) => px0 + gw * (i + 0.5)

  /** @type {string[]} */
  const parts = []
  // 見出し: 売上の年平均の伸び
  const first = data.revenue[0]
  const last = data.revenue[n - 1]
  const hotC = hot(pal, 1, ALPHA.body)
  // 色のテーマ: 費用の棒は 2 つ目の系列の色（売上は accent）
  const costFill = seriesFill(pal, 1, -1, 0.55) ?? inkFill(pal, ALPHA.card)
  const keys = [
    { label: tr(lang, '売上', 'Revenue'), mark: /** @type {'box'} */ ('box'), attr: fillAttr(hotC.color, hotC.a) },
    { label: tr(lang, '費用', 'Cost'), mark: /** @type {'box'} */ ('box'), attr: costFill },
    { label: tr(lang, '利益', 'Profit'), mark: /** @type {'line'} */ ('line'), attr: inkStroke(pal, 1, LW.hot) },
  ]
  const key = legend(W - PAD, PAD + 14, keys, pal, { anchor: 'end' })
  parts.push(key.svg)
  if (first > 0 && last > 0) {
    const cagr = Math.pow(last / first, 1 / (n - 1)) - 1
    parts.push(hero(percent(cagr, undefined, true), tr(lang, `売上の年平均の伸び（${data.x[0]}〜${data.x[n - 1]}）`, `Revenue CAGR (${data.x[0]} to ${data.x[n - 1]})`), pal, PAD, PAD + 14, W - PAD - key.width - 12))
  }

  // 0 の点線（利益が負の年がある時だけ）
  if (nlo < 0) parts.push(line(px0, y(0), px1, y(0), inkStroke(pal, ALPHA.ref, LW.hair, DASH.ref)))
  // 棒
  const revFill = g.linear(px0, 0, px1, 0, 1, ALPHA.body)
  const y0 = y(0)
  data.x.forEach((_, i) => {
    const rh = y0 - y(data.revenue[i])
    const ch = y0 - y(data.cost[i])
    parts.push(rect(mid(i) - barW - 1, y0 - rh, barW, rh, revFill))
    parts.push(rect(mid(i) + 1, y0 - ch, barW, ch, costFill))
  })
  // 利益の線: 紙の色の太い線を下に敷き、棒の上でも読めるようにする
  const pts = data.profit.map((v, i) => /** @type {[number, number]} */ ([mid(i), y(v)]))
  parts.push(strokePath(polyline(pts), strokeAttr(pal.paper, 1, LW.ring + 2)))
  parts.push(strokePath(polyline(pts), inkStroke(pal, 1, LW.hot)))
  for (const [cx, cy] of pts) parts.push(circle(cx, cy, 3, `${fillAttr(pal.paper)} ${inkStroke(pal, 1, LW.hot)}`))

  // 下: 年の字と 3 行の数
  const base = py1 + 14
  data.x.forEach((label, i) => parts.push(text(mid(i), base, clip(label, TICK, gw - 4), { size: TICK, fill: pal.sub, anchor: 'middle' })))
  const rows = [
    { name: tr(lang, '売上', 'Revenue'), v: data.revenue, bold: false },
    { name: tr(lang, '費用', 'Cost'), v: data.cost, bold: false },
    { name: tr(lang, '利益', 'Profit'), v: data.profit, bold: true },
  ]
  rows.forEach((r, k) => {
    const yy = base + 15 + k * ROW
    parts.push(text(PAD, yy, r.name, { size: TICK, fill: pal.sub }))
    r.v.forEach((v, i) => {
      const s = num(v, digits)
      parts.push(text(mid(i), yy, clip(s, LABEL, gw - 4, r.bold), { size: LABEL, fill: r.bold && v < 0 ? pal.down : pal.ink, bold: r.bold, anchor: 'middle' }))
    })
  })
  if (unit) parts.push(text(PAD, H - PAD + 2, unit, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 5 か年の収支（見本。単位は百万円・架空の数） */
function sample() {
  return {
    x: ['2026', '2027', '2028', '2029', '2030'],
    revenue: [42, 118, 260, 470, 780],
    cost: [96, 152, 238, 372, 560],
    unit: '百万円',
  }
}

export default {
  id: 'pnl',
  title: '収支の見通し（PnL）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {PnlData} */ data) => Math.max(Math.round(width * 0.46), data.x.length >= 2 ? 2 * PAD + HEAD + 70 + XLAB + 3 * ROW + (data.unit ? 14 : 0) : 0),
  sample,
}
