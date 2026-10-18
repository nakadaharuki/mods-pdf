// @ts-check
// matrix2x2（立ち位置の 2 軸の図）: 十字の細い線で 4 つに分け、点を置く。自社（self）だけが色のある紙では grad の丸と淡い輪・その象限の薄い地・mono では墨 100% の丸。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし（引くのは十字の仕切りだけ・墨の 35% の細い線）・目立たせるのは 1 つだけ・値（名前）は点の隣・字は paper の段。
// - 軸の両端の言葉（x の低・高、y の低・高）は、軸の端の外（左の余白と下の余白）に sub で置く。象限の名前は各隅に sub で。
// - 点の名前は点の右・左・上・下の順に、ほかの点と名前に重ならない所へ置く（paper の freeSpot）。置けなければ右に置く。
// 選ばなかった案
// - 4 つの象限を全部違う濃さの地で塗る案: 目立たせるのが 1 つでなくなる。自社の象限だけを薄く塗る。
// - 軸の矢印を引く案: 十字の仕切りと別に線が増える。端の言葉（低 ←→ 高）で向きは分かる。
import { ALPHA, LW, TICK, LABEL, inkFill, inkStroke, strokeAttr, seam, paints, circle, line, rect, text, textWidth, clip, svgDoc, empty, tr, strOf, numOf, keep, freeSpot, isMono, underlay } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, x: number, y: number, self: boolean }} Point */
/** @typedef {{ x: [string, string], y: [string, string], quadrants: string[], points: Point[] }} MatrixData */

const MAX_POINTS = 24
const DOT = 5
const DOT_SELF = 8

/** @param {unknown} v @returns {[string, string]} */
function pair(v) {
  return Array.isArray(v) ? [strOf(v[0]), strOf(v[1])] : ['', '']
}

/**
 * @param {unknown} data { x: [低, 高], y: [低, 高], quadrants?: [左上, 右上, 左下, 右下], points: { name, x: 0..1, y: 0..1, self? }[] }（y は上が高）
 * @returns {{ data: MatrixData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.points)) warnings.push('立ち位置の図: points（{ name, x, y } の列）がありません')
  /** @type {Point[]} */
  let points = []
  let bad = 0
  let clamped = 0
  let selfSeen = false
  for (const p of Array.isArray(src.points) ? src.points : []) {
    const name = p && typeof p === 'object' ? strOf(p.name) : ''
    const x = p && typeof p === 'object' ? numOf(p.x) : NaN
    const y = p && typeof p === 'object' ? numOf(p.y) : NaN
    if (!name || Number.isNaN(x) || Number.isNaN(y)) { bad++; continue }
    if (x < 0 || x > 1 || y < 0 || y > 1) clamped++
    const self = p.self === true && !selfSeen
    if (self) selfSeen = true
    points.push({ name, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), self })
  }
  if (bad) warnings.push(`立ち位置の図: 名前と x・y（0〜1 の数）が読めない点 ${bad} 個を捨てました`)
  if (clamped) warnings.push(`立ち位置の図: x・y が 0〜1 の外の点 ${clamped} 個を、端に寄せました`)
  points = keep(points, MAX_POINTS, warnings, '立ち位置の図: 点')
  if (Array.isArray(src.points) && !points.length && !bad) warnings.push('立ち位置の図: points が空です')
  const q = Array.isArray(src.quadrants) ? src.quadrants.map(strOf) : []
  if (src.quadrants !== undefined && q.length !== 4) warnings.push('立ち位置の図: quadrants は 4 つ（左上・右上・左下・右下）の字の列なので使いません')
  return { data: { x: pair(src.x), y: pair(src.y), quadrants: q.length === 4 ? q : ['', '', '', ''], points }, warnings }
}

/**
 * @param {MatrixData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.points.length) return empty(o)
  const g = paints(pal)
  const pad = 10
  const [xLo, xHi] = [data.x[0] || tr(lang, '低', 'Low'), data.x[1] || tr(lang, '高', 'High')]
  const [yLo, yHi] = [data.y[0] || tr(lang, '低', 'Low'), data.y[1] || tr(lang, '高', 'High')]
  const gutter = Math.min(96, Math.max(textWidth(yLo, TICK), textWidth(yHi, TICK)) + 12)
  const px0 = pad + gutter
  const px1 = W - pad
  const py0 = pad
  const py1 = H - pad - 16
  const mx = (px0 + px1) / 2
  const my = (py0 + py1) / 2
  const inset = 16
  const X = (/** @type {number} */ v) => px0 + inset + v * (px1 - px0 - 2 * inset)
  const Y = (/** @type {number} */ v) => py1 - inset - v * (py1 - py0 - 2 * inset)
  /** @type {string[]} */
  const parts = []

  const self = data.points.find((p) => p.self)
  if (self) {
    const right = self.x >= 0.5
    const top = self.y >= 0.5
    const [qx0, qy0] = [right ? mx : px0, top ? py0 : my]
    parts.push(rect(qx0, qy0, right ? px1 - mx : mx - px0, my - py0, g.linear(qx0, qy0, qx0 + (px1 - px0) / 2, qy0 + (py1 - py0) / 2, 0.1, ALPHA.faint)))
  }
  const cross = inkStroke(pal, ALPHA.last, LW.hair)
  parts.push(line(mx, py0, mx, py1, cross), line(px0, my, px1, my, cross))

  /** @type {{ x0: number, y0: number, x1: number, y1: number }[]} */
  const boxes = []
  const note = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ s, /** @type {'start'|'end'} */ anchor, /** @type {string} */ fill = pal.sub) => {
    const w = textWidth(s, TICK)
    boxes.push({ x0: anchor === 'start' ? x : x - w, y0: y - TICK, x1: anchor === 'start' ? x + w : x, y1: y + 2 })
    return text(x, y, s, { size: TICK, fill, anchor })
  }
  const qmax = (px1 - px0) / 2 - 12
  const [tl, tr_, bl, br] = data.quadrants.map((s) => clip(s, TICK, qmax))
  if (tl) parts.push(note(px0 + 8, py0 + 12, tl, 'start'))
  if (tr_) parts.push(note(px1 - 8, py0 + 12, tr_, 'end'))
  if (bl) parts.push(note(px0 + 8, py1 - 6, bl, 'start'))
  if (br) parts.push(note(px1 - 8, py1 - 6, br, 'end'))
  parts.push(text(px0 - 8, py0 + 9, clip(yHi, TICK, gutter - 8), { size: TICK, fill: pal.sub, anchor: 'end' }))
  parts.push(text(px0 - 8, py1, clip(yLo, TICK, gutter - 8), { size: TICK, fill: pal.sub, anchor: 'end' }))
  parts.push(text(px0, py1 + 15, clip(xLo, TICK, (px1 - px0) / 2 - 8), { size: TICK, fill: pal.sub }))
  parts.push(text(px1, py1 + 15, clip(xHi, TICK, (px1 - px0) / 2 - 8), { size: TICK, fill: pal.sub, anchor: 'end' }))

  const centers = /** @type {[number, number][]} */ (data.points.map((p) => [X(p.x), Y(p.y)]))
  const bounds = { x0: px0 + 2, y0: py0 + 2, x1: px1 - 2, y1: py1 - 2 }
  const lines = []
  // 点は自社を最後に（ほかの点の上に重ねる）。名前は自社が先に置き場を取る
  const order = data.points.map((_, i) => i).sort((a, b) => Number(data.points[b].self) - Number(data.points[a].self))
  for (const i of order) {
    const p = data.points[i]
    const [cx, cy] = centers[i]
    const r = p.self ? DOT_SELF : DOT
    const label = clip(p.name, LABEL, 120, p.self)
    const w = textWidth(label, LABEL, p.self)
    const h = 10
    const cands = /** @type {[number, number][]} */ ([
      [cx + r + 5, cy - h / 2], [cx - r - 5 - w, cy - h / 2], [cx - w / 2, cy - r - 5 - h], [cx - w / 2, cy + r + 5],
    ])
    const spot = freeSpot({ w, h, from: [cx, cy], cands, bounds, points: centers.filter((_, k) => k !== i), pad: 6, boxes }) ?? { x0: cx + r + 5, y0: cy - h / 2 }
    boxes.push({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + w, y1: spot.y0 + h })
    // 十字の線に名前がかかる時のために、紙の色の薄い下敷きを敷く
    lines.push(underlay(spot.x0 - 2, spot.y0 - 1, w + 4, h + 2, pal), text(spot.x0, spot.y0 + 8, label, { size: LABEL, fill: p.self ? pal.accent : pal.ink, bold: p.self }))
  }
  for (const i of data.points.map((_, k) => k).sort((a, b) => Number(data.points[a].self) - Number(data.points[b].self))) {
    const p = data.points[i]
    const [cx, cy] = centers[i]
    if (p.self) {
      parts.push(circle(cx, cy, DOT_SELF + 5, `fill="none" ${isMono(pal) ? inkStroke(pal, ALPHA.last, LW.hair) : strokeAttr(pal.accent, ALPHA.last, LW.hair)}`))
      parts.push(circle(cx, cy, DOT_SELF, g.linear(cx - DOT_SELF, cy - DOT_SELF, cx + DOT_SELF, cy + DOT_SELF, 1, 1)))
    } else parts.push(circle(cx, cy, DOT, `${inkFill(pal, ALPHA.body)} ${seam(pal, LW.line)}`))
  }
  return svgDoc(W, H, g.defs() + parts.join('') + lines.join(''))
}

/** 業務アプリの価格と機能の立ち位置（見本。架空の会社） */
function sample() {
  return {
    x: ['低価格', '高価格'],
    y: ['機能が少ない', '機能が多い'],
    quadrants: ['高機能で安い', '高機能で高い', '低機能で安い', '低機能で高い'],
    points: [
      { name: '自社', x: 0.24, y: 0.8, self: true },
      { name: 'A 社', x: 0.78, y: 0.82 },
      { name: 'B 社', x: 0.62, y: 0.58 },
      { name: 'C 社', x: 0.16, y: 0.3 },
      { name: 'D 社', x: 0.48, y: 0.26 },
      { name: 'E 社', x: 0.86, y: 0.36 },
    ],
  }
}

export default {
  id: 'matrix2x2',
  title: '立ち位置の 2 軸（2×2）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.max(200, Math.round(width * 0.5)),
  sample,
}
