// @ts-check
// compare-table（機能の比べ）: 左に項目の名前、右に会社（または案）ごとの列。できる・できないは描いた印（○ と ×）、字はそのまま置く。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし（引くのは行の間の細い線だけ）・目立たせるのは 1 つだけ（highlight の列）・字は paper の段・墨の割合は paper の ALPHA。
// - 目立たせる列は、色のある紙では grad の上の棒（3pt）と薄い地・mono では墨 100% の棒と 8% の地。その列の ○ は grad の塗りの丸・名前は accent の太字。
// - ○ は墨の 1.5pt の輪・× は墨 35% の 2 本の細い線（できないことは静かに）。
// 選ばなかった案
// - ○ × の字を使う案: 全角で値の字と並ばず、書体によって大きさが違う。形で描いて、列の真ん中にそろえる。
// - 全部の列に地を敷く案（縞）: 目立たせる 1 つが無くなる。行の細い線だけにして、highlight の列だけに地を敷く。
import { ALPHA, LW, LABEL, inkStroke, paints, circle, line, rect, text, textLines, wrap, clip, svgDoc, empty, strOf, keep, hotIndex } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {boolean | string} Cell */
/** @typedef {{ columns: string[], rows: { name: string, values: Cell[] }[], hot: number }} TableData */

const MAX_COLUMNS = 6
const MAX_ROWS = 10
const PAD = 12
const HEAD = 30
const ROW_H = 24

/**
 * @param {unknown} data { columns: string[2..6], rows: { name, values: (boolean|string)[] }[1..10], highlight?: 目立たせる列の位置（0 から）か名前 }
 * @returns {{ data: TableData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.columns)) warnings.push('比べ表: columns（会社や案の名前の列）がありません')
  if (!Array.isArray(src.rows)) warnings.push('比べ表: rows（{ name, values } の列）がありません')
  /** @type {string[]} */
  let columns = (Array.isArray(src.columns) ? src.columns : []).map(strOf)
  columns = keep(columns, MAX_COLUMNS, warnings, '比べ表: 列')
  if (columns.length < 2) {
    if (Array.isArray(src.columns)) warnings.push('比べ表: 列は 2 個以上要ります')
    columns = []
  }
  /** @type {{ name: string, values: Cell[] }[]} */
  let rows = []
  let bad = 0
  let mismatch = 0
  for (const r of Array.isArray(src.rows) ? src.rows : []) {
    const name = r && typeof r === 'object' ? strOf(r.name) : ''
    if (!name) { bad++; continue }
    const raw = Array.isArray(r.values) ? r.values : []
    if (raw.length !== columns.length) mismatch++
    rows.push({ name, values: columns.map((_, j) => (typeof raw[j] === 'boolean' ? raw[j] : strOf(raw[j]))) })
  }
  if (bad) warnings.push(`比べ表: 名前の読めない行 ${bad} 個を捨てました`)
  if (mismatch && columns.length) warnings.push(`比べ表: 値の数が列の数と違う行 ${mismatch} 個は、足りない所を空にし、余りを捨てました`)
  rows = keep(rows, MAX_ROWS, warnings, '比べ表: 行')
  if (!rows.length) columns = []
  const hot = columns.length ? hotIndex(src.highlight, columns, -1, warnings, '比べ表') : -1
  return { data: { columns, rows: columns.length ? rows : [], hot }, warnings }
}

/**
 * 列の幅と行の高さ。H が有限なら行を詰める（名前は 1 行に）
 * @param {TableData} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const k = data.columns.length
  const nameW = Math.max(70, Math.min(190, W * 0.28))
  const colW = (W - 2 * PAD - nameW) / k
  const m = data.rows.length
  const rowH = Number.isFinite(H) ? Math.max(15, Math.min(ROW_H, (H - 2 * PAD - HEAD) / m)) : ROW_H
  const names = data.rows.map((r) => wrap(r.name, LABEL, nameW - 8, rowH >= 22 ? 2 : 1, false))
  return { k, nameW, colW, rowH, names, need: 2 * PAD + HEAD + m * ROW_H }
}

/**
 * @param {TableData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (data.columns.length < 2 || !data.rows.length) return empty(o)
  const g = paints(pal)
  const { k, nameW, colW, rowH, names } = plan(data, W, H)
  const m = data.rows.length
  const top = Math.max(PAD, (H - (HEAD + m * rowH)) / 2)
  const y0 = top + HEAD
  const y1 = y0 + m * rowH
  const x0 = PAD + nameW
  const rule = inkStroke(pal, ALPHA.card, LW.hair)

  /** @type {string[]} */
  const parts = []
  if (data.hot >= 0) {
    const hx = x0 + data.hot * colW
    parts.push(rect(hx, top, colW, y1 - top, g.linear(hx, top, hx, y1, 0.1, ALPHA.faint)))
    parts.push(rect(hx, top, colW, 3, g.linear(hx, 0, hx + colW, 0, 1, 1)))
  }
  data.columns.forEach((c, j) => {
    const isHot = j === data.hot
    parts.push(text(x0 + j * colW + colW / 2, top + 20, clip(c, LABEL, colW - 8, true), { size: LABEL, fill: isHot ? pal.accent : pal.ink, bold: true, anchor: 'middle' }))
  })
  parts.push(line(PAD, y0, W - PAD, y0, inkStroke(pal, ALPHA.last, LW.hair)))
  data.rows.forEach((r, i) => {
    const yc = y0 + i * rowH + rowH / 2
    const lines = names[i]
    parts.push(textLines(PAD, yc - ((lines.length - 1) * 11) / 2 + 3, lines, { size: LABEL, fill: pal.ink, leading: 11 }))
    r.values.forEach((v, j) => {
      const cx = x0 + j * colW + colW / 2
      const isHot = j === data.hot
      if (v === true) {
        parts.push(isHot
          ? circle(cx, yc, 4.5, g.linear(cx - 4.5, yc - 4.5, cx + 4.5, yc + 4.5, 1, 1))
          : circle(cx, yc, 4, `fill="none" ${inkStroke(pal, 1, LW.hot)}`))
      } else if (v === false) {
        const s = inkStroke(pal, ALPHA.last, LW.line)
        parts.push(line(cx - 3.5, yc - 3.5, cx + 3.5, yc + 3.5, s), line(cx - 3.5, yc + 3.5, cx + 3.5, yc - 3.5, s))
      } else if (v) parts.push(text(cx, yc + 3, clip(v, LABEL, colW - 8), { size: LABEL, fill: isHot ? pal.accent : pal.ink, bold: isHot, anchor: 'middle' }))
    })
    if (i < m - 1) parts.push(line(PAD, y0 + (i + 1) * rowH, W - PAD, y0 + (i + 1) * rowH, rule))
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 請求ソフトの機能の比べ（見本。架空の製品） */
function sample() {
  return {
    columns: ['自社', 'A 社', 'B 社', '手作業'],
    highlight: 0,
    rows: [
      { name: '請求書の自動作成', values: [true, true, false, false] },
      { name: '入金の自動消し込み', values: [true, false, false, false] },
      { name: '銀行との自動連携', values: [true, true, true, false] },
      { name: '会計ソフトとの連携', values: [true, true, false, false] },
      { name: '導入の期間', values: ['1 週間', '1 か月', '2 週間', '–'] },
      { name: '月額（10 人まで）', values: ['9,800 円', '24,000 円', '12,000 円', '0 円'] },
    ],
  }
}

export default {
  id: 'compare-table',
  title: '機能の比べ（Compare table）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {TableData} */ data) => (data.rows.length ? Math.ceil(plan(data, width, Infinity).need) : Math.round(width * 0.3)),
  sample,
}
