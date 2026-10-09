// @ts-check
// mekko（市場の割合）: 列の幅が列の値、列の中の高さが内訳の割合。区分は墨の濃さで分け、いちばん大きな区画だけに色をのせる。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（面積が最大の区画）・字は paper の段・墨の割合は paper の ALPHA。
// - 区画は紙の色の細い線で分ける。区分（内訳の名前）は下の凡例の濃さで見分ける（10〜40% の墨の坂・最初の区分がいちばん薄い）。
// - 目立たせる区画は、色のある紙では grad の薄い（30%）グラデーション・mono では墨 50% と、accent の 1.5pt の縁。薄くするのは、区画の中の割合の字（ink）を読めるようにするため。
// - 列の名前と合計は列の上・割合の字は区画の中（区画が字より小さければ置かない）。
// 選ばなかった案
// - 区画の中に区分の名前も書く案: 狭い区画で字が重なる。区分の名前は凡例にまとめ、区画には割合だけを置く。
// - 列を値の大きい順に並べ替える案: 入力の順（地域の順・年の順など）が崩れる。順は入力のとおりにする。
// - 区分ごとに別の色を使う案: 色が増え、目立たせる 1 つが埋もれる。墨の濃さで分ける。
import { LW, TICK, LABEL, inkFill, seriesColor, fillAttr, hotStroke, paints, legend, rect, text, clip, textWidth, svgDoc, empty, strOf, numOf, keep, plain, withUnit, percent, ramp } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, parts: { name: string, value: number }[] }} Column */
/** @typedef {{ columns: Column[], names: string[], unit: string }} MekkoData */

const MAX_COLUMNS = 8
const MAX_PARTS = 6
const PAD = 12
const HEAD = 30
const FOOT = 20
const SEAM = 1.5
const MIN_COL = 12

/**
 * @param {unknown} data { columns: { name, value, parts: { name, value }[] }[2..8], unit? }（parts の値は列の中の割合を決める）
 * @returns {{ data: MekkoData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.columns)) warnings.push('市場の割合: columns（{ name, value, parts } の列）がありません')
  /** @type {Column[]} */
  let columns = []
  let badCols = 0
  let badParts = 0
  for (const c of Array.isArray(src.columns) ? src.columns : []) {
    const name = c && typeof c === 'object' ? strOf(c.name) : ''
    /** @type {Map<string, number>} */
    const merged = new Map()
    for (const p of c && typeof c === 'object' && Array.isArray(c.parts) ? c.parts : []) {
      const pn = p && typeof p === 'object' ? strOf(p.name) : ''
      const pv = p && typeof p === 'object' ? numOf(p.value) : NaN
      if (!pn || !(pv > 0)) { badParts++; continue }
      merged.set(pn, (merged.get(pn) ?? 0) + pv)
    }
    const parts = [...merged].map(([n, v]) => ({ name: n, value: v }))
    if (!name || !parts.length) { badCols++; continue }
    const sum = parts.reduce((s, p) => s + p.value, 0)
    const own = numOf(c.value)
    columns.push({ name, value: own > 0 ? own : sum, parts })
  }
  if (badCols) warnings.push(`市場の割合: 名前か内訳の読めない列 ${badCols} 個を捨てました`)
  if (badParts) warnings.push(`市場の割合: 名前と 0 より大きい値が読めない内訳 ${badParts} 個を捨てました`)
  columns = keep(columns, MAX_COLUMNS, warnings, '市場の割合: 列')
  // 区分（内訳の名前）は最初に出た順。6 を超えた区分は捨てる（濃さの坂が見分けられない）
  /** @type {string[]} */
  const names = []
  for (const c of columns) for (const p of c.parts) if (!names.includes(p.name)) names.push(p.name)
  if (names.length > MAX_PARTS) {
    const ok = new Set(names.slice(0, MAX_PARTS))
    warnings.push(`市場の割合: 区分は ${MAX_PARTS} 個までなので、超えた ${names.length - MAX_PARTS} 個を捨てました`)
    for (const c of columns) c.parts = c.parts.filter((p) => ok.has(p.name))
    columns = columns.filter((c) => c.parts.length)
    names.length = MAX_PARTS
  }
  // 列の中は区分の順に積む（同じ区分が同じ並びになる）
  for (const c of columns) c.parts.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name))
  if (columns.length < 2) {
    if (columns.length === 1 || (Array.isArray(src.columns) && src.columns.length)) warnings.push('市場の割合: 列は 2 個以上要ります')
    columns = []
  }
  return { data: { columns, names: columns.length ? names : [], unit: typeof src.unit === 'string' ? src.unit.trim() : '' }, warnings }
}

/**
 * @param {MekkoData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const cols = data.columns
  const n = cols.length
  if (n < 2) return empty(o)
  const g = paints(pal)
  const total = cols.reduce((s, c) => s + c.value, 0)
  const innerW = W - 2 * PAD - SEAM * (n - 1)
  // 細すぎる列は MIN_COL にそろえ、残りの幅を残りの列で分ける
  const raw = cols.map((c) => (c.value / total) * innerW)
  const small = raw.filter((w) => w < MIN_COL)
  const rest = raw.reduce((s, w) => (w < MIN_COL ? s : s + w), 0)
  const scale = rest > 0 ? (innerW - small.length * MIN_COL) / rest : 1
  const widths = raw.map((w) => (w < MIN_COL ? MIN_COL : w * scale))
  const y0 = PAD + HEAD
  const y1 = H - PAD - FOOT
  const shades = ramp(data.names.length, 0.4, 0.1).reverse()

  // 面積がいちばん大きい区画（列の値 x 内訳の割合）
  let hotC = 0
  let hotP = 0
  let best = -1
  cols.forEach((c, j) => {
    const sum = c.parts.reduce((s, p) => s + p.value, 0)
    c.parts.forEach((p, k) => {
      const area = c.value * (p.value / sum)
      if (area > best) { best = area; hotC = j; hotP = k }
    })
  })

  // 色のテーマ: 部分の色は series[1…]（series[0] は目立たせる 1 つの accent）。字が上に載るので 50%
  const partFill = (/** @type {number} */ i) => { const c = seriesColor(pal, i + 1, 0); return c === null ? inkFill(pal, shades[i]) : fillAttr(c, 0.5) }
  /** @type {string[]} */
  const parts = []
  let x = PAD
  cols.forEach((c, j) => {
    const w = widths[j]
    const sum = c.parts.reduce((s, p) => s + p.value, 0)
    const avail = y1 - y0 - SEAM * (c.parts.length - 1)
    parts.push(text(x, PAD + 8, clip(c.name, LABEL, w + SEAM, true), { size: LABEL, fill: pal.ink, bold: true }))
    parts.push(text(x, PAD + 19, clip(withUnit(plain(c.value), data.unit), TICK, w + SEAM), { size: TICK, fill: pal.sub }))
    let y = y0
    c.parts.forEach((p, k) => {
      const share = p.value / sum
      const h = avail * share
      const isHot = j === hotC && k === hotP
      const fill = isHot ? g.linear(x, y, x + w, y + h, 0.3, 0.5) : partFill(data.names.indexOf(p.name))
      parts.push(rect(x, y, w, h, fill, isHot ? hotStroke(pal, 1, LW.hot) : ''))
      const label = percent(share)
      if (w >= textWidth(label, TICK) + 6 && h >= 13) parts.push(text(x + 4, y + 10, label, { size: TICK, fill: isHot ? pal.accent : pal.ink, bold: isHot }))
      y += h + SEAM
    })
    x += w + SEAM
  })
  // 凡例は、幅に入るまで名前を詰める（入らなければ最も短い詰め方のまま）
  let key = legend(PAD, H - PAD, [], pal)
  for (let ml = 90; ml >= 14; ml -= 8) {
    key = legend(PAD, H - PAD, data.names.map((nm, i) => ({ label: clip(nm, TICK, ml), mark: /** @type {'box'} */ ('box'), attr: partFill(i) })), pal)
    if (key.width <= W - 2 * PAD) break
  }
  parts.push(key.svg)
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 業務ソフトの市場の割合（見本。架空の数）。列は会社の規模・内訳は用途 */
function sample() {
  return {
    unit: '億円',
    columns: [
      { name: '従業員 10 人未満', value: 2400, parts: [{ name: '会計', value: 900 }, { name: '請求', value: 700 }, { name: '勤怠', value: 500 }, { name: 'その他', value: 300 }] },
      { name: '10〜49 人', value: 4600, parts: [{ name: '会計', value: 1500 }, { name: '請求', value: 1700 }, { name: '勤怠', value: 900 }, { name: 'その他', value: 500 }] },
      { name: '50〜99 人', value: 3100, parts: [{ name: '会計', value: 1000 }, { name: '請求', value: 900 }, { name: '勤怠', value: 800 }, { name: 'その他', value: 400 }] },
      { name: '100 人以上', value: 2300, parts: [{ name: '会計', value: 900 }, { name: '請求', value: 500 }, { name: '勤怠', value: 600 }, { name: 'その他', value: 300 }] },
    ],
  }
}

export default {
  id: 'mekko',
  title: '市場の割合（Mekko）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.max(210, Math.round(width * 0.42)),
  sample,
}
