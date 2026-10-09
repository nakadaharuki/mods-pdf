// @ts-check
// kpi-hero（大きな数と小さな線）: 先頭の指標だけを細い 32pt の大きな数にし、その下に推移の線と面を広げる。残りの指標は 20pt の数と小さな線で、先頭の右（狭い版面では下）に並べる。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（先頭の指標）・字は paper の段（先頭の数だけ HERO 32pt の細字・ほかの数は HUGE 20pt・どちらも単位は BIG の sub）・変化は tiles と同じ（既定の単位は %・上げは up の色の上向きの三角・下げは down の色の下向き）。
// - 先頭の推移は、色のある紙では accent の線・grad の薄い（18%）面・終わりの点は grad・mono は墨の線と墨 8% の面と墨 100% の点。ほかの指標の小さな線は tiles と同じく変化の色（変化が無ければ up）。
// - 各指標の上に、細い線（18%）を 1 本だけ引く。枠の線は引かない。
// 選ばなかった案
// - 全部の指標を同じ大きさのタイルにする案: 見る順が無くなる（tiles の仕事）。資料の頁では 1 つの数を主役にして、残りは脇に置く。
// - 先頭の数を太字にする案: 太字は VALUE（8pt）以下の決まり。大きな数は細字で、大きさで主役にする。
// - 推移の線をグラデーションの線にする案: svg.mjs の paint は塗りだけ。線は単色にして、面にだけグラデーションを使う。
import { ALPHA, LW, TICK, BIG, HUGE, HERO, inkStroke, strokeAttr, hotStroke, paints, circle, line, text, fillPath, strokePath, clip, textWidth, svgDoc, empty, strOf, numOf, keep, plain, triangle, fillAttr, polyline, gridOf } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, unit: string, delta: number | null, deltaUnit: string, spark: number[] }} Kpi */

const MAX_ITEMS = 7
const SPARK_MAX = 48
const PAD = 12
const GAP = 14
const CELL_H = 58
const WIDE = 600

/**
 * @param {unknown} data { items: { name, value, unit?, delta?, deltaUnit?, spark?: number[] }[1..7] }（先頭が大きな数）
 * @returns {{ data: { items: Kpi[] }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('数の指標: items（{ name, value, delta?, spark? } の列）がありません')
  /** @type {Kpi[]} */
  let items = []
  let bad = 0
  let badDelta = 0
  for (const it of Array.isArray(src.items) ? src.items : []) {
    const value = it && typeof it === 'object' ? numOf(it.value) : NaN
    if (Number.isNaN(value)) { bad++; continue }
    let delta = null
    if (it.delta !== undefined && it.delta !== null) {
      const d = numOf(it.delta)
      if (Number.isNaN(d)) badDelta++
      else delta = d
    }
    let spark = (Array.isArray(it.spark) ? it.spark : []).map(numOf).filter((/** @type {number} */ v) => !Number.isNaN(v))
    if (spark.length > SPARK_MAX) {
      const k = Math.ceil(spark.length / SPARK_MAX)
      spark = spark.filter((/** @type {number} */ _, /** @type {number} */ j) => j % k === 0 || j === spark.length - 1)
    }
    items.push({ name: strOf(it.name) || String(items.length + 1), value, unit: strOf(it.unit), delta, deltaUnit: typeof it.deltaUnit === 'string' ? it.deltaUnit : '%', spark: spark.length >= 2 ? spark : [] })
  }
  if (bad) warnings.push(`数の指標: value が数（絶対値 1,000 兆以下）でない項目 ${bad} 個を捨てました`)
  if (badDelta) warnings.push(`数の指標: delta が数でない項目 ${badDelta} 個は、変化を書きません`)
  items = keep(items, MAX_ITEMS, warnings, '数の指標: 項目')
  return { data: { items }, warnings }
}

/**
 * 並べ方。広い版面は先頭の指標が左・残りが右の格子。狭い版面は先頭が上・残りが下の格子
 * @param {{ items: Kpi[] }} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const rest = data.items.length - 1
  const wide = W >= WIDE
  const heroW = wide ? Math.round((W - 2 * PAD) * 0.38) : W - 2 * PAD
  const hero = data.items[0]
  const heroSpark = hero.spark.length >= 2
  const heroTop = 84
  const heroH = wide ? heroTop + (heroSpark ? 64 : 0) : heroTop - 8
  const gridW = wide ? W - 2 * PAD - heroW - 28 : W - 2 * PAD
  const cols = rest ? Math.min(3, Math.max(1, Math.floor((gridW + GAP) / (110 + GAP)))) : 1
  const { cols: c, rows } = rest ? gridOf(rest, cols) : { cols: 1, rows: 0 }
  const cellW = (gridW - (c - 1) * GAP) / c
  const gridNeed = rows ? rows * CELL_H + (rows - 1) * GAP : 0
  const need = 2 * PAD + (wide ? Math.max(heroH, gridNeed) : heroH + (rows ? GAP + gridNeed : 0))
  const avail = Number.isFinite(H) ? H - 2 * PAD - (wide ? 0 : heroH + GAP) : Infinity
  const cellH = rows ? Math.max(54, Math.min(CELL_H + 18, Number.isFinite(avail) ? (avail - (rows - 1) * GAP) / rows : CELL_H)) : CELL_H
  return { wide, heroW, heroH, heroSpark, gridW, cols: c, rows, cellW, cellH, need }
}

/** 推移の d（lo..hi を高さ h・幅 w に収める） @param {number[]} v @param {number} x @param {number} y 下の端 @param {number} w @param {number} h */
function sparkPoints(v, x, y, w, h) {
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return v.map((s, k) => /** @type {[number, number]} */ ([x + (w * k) / (v.length - 1), y - (hi > lo ? ((s - lo) / (hi - lo)) * h : h / 2)]))
}

/**
 * @param {{ items: Kpi[] }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (!data.items.length) return empty(o)
  const g = paints(pal)
  const { wide, heroW, heroH, heroSpark, cols, rows, cellW, cellH } = plan(data, W, H)
  const hero = data.items[0]
  const top = wide ? Math.max(PAD, (H - Math.max(heroH, rows * cellH + (rows - 1) * GAP)) / 2) : PAD
  /** @type {string[]} */
  const parts = []
  const hairRule = inkStroke(pal, ALPHA.card, LW.hair)

  // 先頭の指標
  const hx = PAD
  parts.push(line(hx, top, hx + heroW, top, hairRule))
  parts.push(text(hx, top + 14, clip(hero.name, TICK, heroW), { size: TICK, fill: pal.sub }))
  const valueText = plain(hero.value)
  const unitW = hero.unit ? textWidth(hero.unit, BIG) + 4 : 0
  const vs = clip(valueText, HERO, Math.max(40, heroW - unitW))
  parts.push(text(hx, top + 50, vs, { size: HERO, fill: pal.ink }))
  if (hero.unit) parts.push(text(hx + textWidth(vs, HERO) + 4, top + 50, clip(hero.unit, BIG, Math.max(20, heroW - textWidth(vs, HERO) - 4)), { size: BIG, fill: pal.sub }))
  if (hero.delta !== null) {
    const trend = hero.delta >= 0 ? pal.up : pal.down
    parts.push(fillPath(triangle(hx + 3.5, top + 63.5, 7, hero.delta >= 0), fillAttr(trend)))
    parts.push(text(hx + 11, top + 67, clip(`${plain(hero.delta, true)}${hero.deltaUnit}`, TICK, heroW - 12), { size: TICK, fill: trend }))
  }
  if (heroSpark) {
    // 推移: 広い版面は先頭の下・狭い版面は右半分に広げる
    const sx = wide ? hx : hx + heroW * 0.5
    const sw = wide ? heroW : heroW * 0.5
    const sy = wide ? top + heroH - 2 : top + 62
    const sh = 44
    const pts = sparkPoints(hero.spark, sx, sy, sw, sh)
    const area = polyline([...pts, [sx + sw, sy], [sx, sy]], true)
    parts.push(fillPath(area, g.linear(sx, sy, sx + sw, sy, 0.18, 0.08)))
    parts.push(strokePath(polyline(pts), hotStroke(pal, 1, LW.hot)))
    const [lx, ly] = pts[pts.length - 1]
    parts.push(circle(lx, ly, 3.5, g.linear(lx - 3.5, ly - 3.5, lx + 3.5, ly + 3.5, 1, 1)))
  }

  // 残りの指標の格子
  const gx = wide ? PAD + heroW + 28 : PAD
  const gy = wide ? top : top + heroH + GAP
  data.items.slice(1).forEach((t, i) => {
    const x = gx + (i % cols) * (cellW + GAP)
    const y = gy + Math.floor(i / cols) * (cellH + GAP)
    parts.push(line(x, y, x + cellW, y, hairRule))
    parts.push(text(x, y + 14, clip(t.name, TICK, cellW), { size: TICK, fill: pal.sub }))
    const sparkW = t.spark.length >= 2 ? Math.min(64, cellW * 0.4) : 0
    const room = Math.max(30, cellW - sparkW - 6)
    const unitW = t.unit ? textWidth(t.unit, BIG) + 3 : 0
    const vs = clip(plain(t.value), HUGE, Math.max(20, room - unitW))
    parts.push(text(x, y + 38, vs, { size: HUGE, fill: pal.ink }))
    if (t.unit) parts.push(text(x + textWidth(vs, HUGE) + 3, y + 38, clip(t.unit, BIG, Math.max(14, room - textWidth(vs, HUGE) - 3)), { size: BIG, fill: pal.sub }))
    const trend = t.delta === null || t.delta >= 0 ? pal.up : pal.down
    if (t.delta !== null) {
      parts.push(fillPath(triangle(x + 3.5, y + 49.5, 7, t.delta >= 0), fillAttr(trend)))
      parts.push(text(x + 11, y + 53, clip(`${plain(t.delta, true)}${t.deltaUnit}`, TICK, cellW - 12), { size: TICK, fill: trend }))
    }
    if (sparkW) parts.push(strokePath(polyline(sparkPoints(t.spark, x + cellW - sparkW, y + 38, sparkW, 20)), strokeAttr(trend, 1, LW.line)))
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 月次の売上（見本）。先頭は売上・残りは補助の指標。折れ線は 12 か月の動き（固定の数） */
function sample() {
  return {
    items: [
      { name: '月次経常収益（MRR）', value: 4820, unit: '万円', delta: 12.4, spark: [2100, 2350, 2500, 2480, 2900, 3150, 3300, 3560, 3800, 4100, 4480, 4820] },
      { name: '契約企業', value: 312, unit: '社', delta: 9.8, spark: [150, 168, 181, 190, 212, 226, 240, 255, 268, 283, 297, 312] },
      { name: '解約率', value: 1.8, unit: '%', delta: -0.3, deltaUnit: 'pt', spark: [2.6, 2.5, 2.4, 2.4, 2.2, 2.2, 2.1, 2.0, 2.0, 1.9, 1.9, 1.8] },
      { name: '顧客あたり単価', value: 15.4, unit: '万円', delta: 2.2, spark: [14.0, 14.0, 13.8, 14.6, 13.7, 13.9, 13.8, 14.0, 14.2, 14.5, 15.1, 15.4] },
      { name: '獲得費用の回収', value: 7, unit: 'か月', delta: -1, deltaUnit: 'か月' },
      { name: '粗利率', value: 78.5, unit: '%', delta: 1.4, deltaUnit: 'pt', spark: [72, 73, 73, 74, 75, 75, 76, 77, 77, 78, 78, 78.5] },
    ],
  }
}

export default {
  id: 'kpi-hero',
  title: '大きな数と小さな線（KPI）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ items: Kpi[] }} */ data) => (data.items.length ? Math.max(Math.round(width * 0.3), Math.ceil(plan(data, width, Infinity).need)) : Math.round(width * 0.3)),
  sample,
}
