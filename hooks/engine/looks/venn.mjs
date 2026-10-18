// @ts-check
// venn（重なり）: 2〜3 の円を重ね、全部が重なる所だけを色で塗る。円の名前と説明は円の外の左右・重なりの説明は図の下に、細い線で重なりの中心から引く。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（全部の重なり）・字は円の外・墨の割合は paper の ALPHA。
// - 円は墨の薄い面（8%）と細い縁。重なりの面は、色のある紙では grad のグラデーション・mono では墨の 80%（monoArea）。
// - 重なりの形は、円の中心の平均から全部の円の縁までの距離（光線）を 90 方向に測って作る（円どうしの交点の式を円の数ごとに書かない）。
// 選ばなかった案
// - 円の中に名前を書く案: 重なる所で字が重なり、濃い面の上に置ける字の色が pal に無い。名前は円の外の左右に置く。
// - 円の大きさを量に比例させる案: 量の図（market）に読める。同じ大きさにして、重なりだけを見せる。
// - 2 つずつの重なりも塗り分ける案: 目立たせるのが 1 つでなくなる。全部の重なりだけを塗る（2 つずつの所は、円の薄い面が重なって少し濃くなるだけ）。
import { ALPHA, LW, TICK, LABEL, inkFill, seriesFill, inkStroke, paints, circle, fillPath, line, text, textLines, wrap, clip, svgDoc, empty, readNamed, strOf, dodge, polyline } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ sets: { name: string, note: string }[], overlap: string }} VennData */

const PAD = 12
const GAP = 14
const R_MAX = 100
const RAYS = 90

/**
 * @param {unknown} data { sets: { name, note? }[2..3], overlap?: 全部の重なりの説明 }
 * @returns {{ data: VennData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const sets = readNamed(src.sets, '重なり', 'sets', warnings, { min: 2, max: 3 })
  return { data: { sets, overlap: strOf(src.overlap) }, warnings }
}

/**
 * 円の大きさと札の折り返し
 * @param {VennData} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const n = data.sets.length
  const labelW = Math.max(70, Math.min(160, W * 0.2))
  const over = data.overlap ? wrap(data.overlap, LABEL, Math.min(220, W - 2 * PAD), 2, true) : []
  const ovH = over.length ? GAP + 6 + over.length * 11 : 0
  const tall = n === 2 ? 2 : 2 + 0.866
  const rW = (W - 2 * PAD - 2 * (labelW + GAP)) / 3.1
  const rH = (H - 2 * PAD - ovH) / tall
  const r = Math.max(18, Math.min(rW, rH, R_MAX))
  const blocks = data.sets.map((s) => {
    const names = wrap(s.name, LABEL, labelW, 2, true)
    const notes = s.note ? wrap(s.note, TICK, labelW, 3) : []
    return { names, notes, h: names.length * 11 + (notes.length ? 3 + notes.length * 11 : 0) }
  })
  const gapY = Math.max(...blocks.map((b) => b.h)) + 8
  return { n, labelW, over, ovH, tall, r, blocks, rW, labelNeed: 2 * PAD + (n === 3 ? 2 : 1) * gapY + ovH }
}

/**
 * 点 (px, py) から向き (ux, uy) の光線が円 (cx, cy, r) の縁に出るまでの距離。点が円の外なら負
 * @param {number} px @param {number} py @param {number} ux @param {number} uy @param {number} cx @param {number} cy @param {number} r
 */
function exitDist(px, py, ux, uy, cx, cy, r) {
  const dx = px - cx
  const dy = py - cy
  const c = dx * dx + dy * dy - r * r
  if (c > 0) return -1
  const b = dx * ux + dy * uy
  return -b + Math.sqrt(b * b - c)
}

/**
 * @param {VennData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const n = data.sets.length
  if (n < 2) return empty(o)
  const g = paints(pal)
  const { labelW, over, ovH, tall, r, blocks } = plan(data, W, H)
  const d = (n === 2 ? 1.1 : 1.0) * r
  const blockH = tall * r + ovH
  const top = (H - blockH) / 2
  const cx = W / 2
  const cy0 = top + r
  /** @type {[number, number][]} */
  const centers = n === 2 ? [[cx - d / 2, cy0], [cx + d / 2, cy0]] : [[cx - d / 2, cy0], [cx + d / 2, cy0], [cx, cy0 + d * 0.866]]
  const mx = centers.reduce((s, c) => s + c[0], 0) / n
  const my = centers.reduce((s, c) => s + c[1], 0) / n

  /** @type {string[]} */
  const parts = []
  const edge = inkStroke(pal, ALPHA.edge, LW.hair)
  centers.forEach(([x, y], i) => parts.push(circle(x, y, r, `${seriesFill(pal, i + 1, 0, 0.6) ?? inkFill(pal, ALPHA.faint)} ${edge}`)))

  // 全部の重なり（共通部分は凸なので、平均の点から光線を出せば縁の形が 1 周で取れる）
  /** @type {[number, number][]} */
  const poly = []
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * Math.PI * 2
    const [ux, uy] = [Math.cos(a), Math.sin(a)]
    const t = Math.min(...centers.map(([x, y]) => exitDist(mx, my, ux, uy, x, y, r)))
    if (!(t > 0)) { poly.length = 0; break }
    poly.push([mx + t * ux, my + t * uy])
  }
  if (poly.length) parts.push(fillPath(polyline(poly, true), g.linear(mx - r / 2, my - r / 2, mx + r / 2, my + r / 2, 1)))

  // 円の札: 1 つ目は左・ほかは右の列（右の列は重ならない高さに押し分ける）
  const right = data.sets.map((_, i) => i).filter((i) => i > 0)
  const gapY = Math.max(...blocks.map((b) => b.h)) + 8
  // 3 つ目の円の札は、円の中心より少し下に置く（2 つ目の円の縁と札が重ならない高さ）
  const ry = dodge(right.map((i) => centers[i][1] + (i === 2 ? 0.35 * r : 0)), gapY, PAD + gapY / 2, H - PAD - gapY / 2)
  const place = (/** @type {number} */ i, /** @type {number} */ yc) => {
    const b = blocks[i]
    const left = i === 0
    const x = left ? centers[i][0] - r - 12 : centers[i][0] + r + 12
    const anchor = left ? 'end' : 'start'
    const t = yc - b.h / 2
    parts.push(textLines(x, t + 8, b.names.map((l) => clip(l, LABEL, labelW, true)), { size: LABEL, fill: pal.ink, bold: true, anchor, leading: 11 }))
    if (b.notes.length) parts.push(textLines(x, t + 8 + b.names.length * 11 + 3, b.notes, { size: TICK, fill: pal.sub, anchor, leading: 11 }))
  }
  place(0, centers[0][1])
  right.forEach((i, k) => place(i, ry[k]))

  // 全部の重なりの説明: 図の下に置き、重なりの中心から細い線を引く
  if (over.length) {
    const oy = top + tall * r + GAP
    if (poly.length) {
      parts.push(line(mx, my, mx, oy - 4, inkStroke(pal, ALPHA.last, LW.hair)))
      parts.push(circle(mx, my, 2, inkFill(pal, 1)))
    }
    parts.push(textLines(mx, oy + 8, over.map((l) => clip(l, LABEL, W - 2 * PAD, true)), { size: LABEL, fill: pal.accent, bold: true, anchor: 'middle', leading: 11 }))
  }
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 事業の条件（見本）。全部の重なりが「ここが事業」 */
function sample() {
  return {
    sets: [
      { name: '顧客が困っている', note: '請求と入金の確認に、毎月 20 時間かかっている' },
      { name: '私たちが作れる', note: '銀行・会計ソフトと連携する技術がある' },
      { name: '続けて稼げる', note: '月額の課金で、利益が出る' },
    ],
    overlap: 'ここが事業の中心になる',
  }
}

export default {
  id: 'venn',
  title: '重なり（Venn）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {VennData} */ data) => {
    if (data.sets.length < 2) return Math.round(width * 0.3)
    const p = plan(data, width, Infinity)
    const r = Math.max(18, Math.min(p.rW, 84))
    return Math.round(Math.max(2 * PAD + p.tall * r + p.ovH, p.labelNeed))
  },
  sample,
}
