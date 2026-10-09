// @ts-check
// 組んだ物の自動の検査（人が絵を見て直さなくて済むための見張り）。純な部品。単位は pt、y は下向き。
// 見るのは字の重なり・箱の外・「…」で切れた字・資料の枚の空き。図（figure.mjs）は描いた直後に inspectSvg で見て直し、
// 組み上がった頁は inspectLayout が見る。結果は summarizeChecks が compose の warnings と layout.meta.checks の形にする。
//
// 選ばなかった案:
//   - 字の箱を書体の ascent・descent で取る案: 書体ごとに箱が変わり、同じ組みが書体の差し替えで検査に落ちたり通ったりする。基線から字の高さの 0.8 上・0.15 下で固定する。
//   - 字の組（i, j）を総当たりで比べる案: 図は 1,000 を超える字を持つ。x の左端で並べ、右端が届く間だけ比べる。
//   - 重なりの閾値を 0 にする案: 隣り合う字の箱は行の送りで 0.3pt ほど触れる。縦横とも 1pt を超えた時だけ重なりとする。
//   - 資料の飾りの大きな字（引用符・節の番号）も重なりに数える案: 飾りの箱は字の高さの 0.8 で取ると、置き場として決めた余白に入り込む。
//     引用符だけの字・1 つだけの記号は数えない。
//   - 同じ字が同じ所に 2 度ある物（縁取りの字）も重なりに数える案: 見た目に重なりは無い。字も位置も同じ物は数えない。
//   - 頁の座標へ直す変換をここで持つ案: svgToOps が viewBox の変換を済ませて頁の座標で返す。ここは ClipOp の範囲を箱の外の基準にするだけ。

import { svgToOps } from './svg.mjs'

/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Rect */
/** @typedef {{ s: string, x0: number, y0: number, x1: number, y1: number, box: Rect }} TextBox */
/** @typedef {{ overlaps: string[], outside: string[], truncated: string[], bounds: Rect | null }} SvgCheck */
/** @typedef {{ page: number, overlaps: string[], outside: string[], truncated: string[], sparse: number | null }} PageIssues sparse は本文の区域の埋まり（0.85 未満の時だけ。それ以外は null） */
/** @typedef {Record<string, { adv?: (cp: number) => number }>} Metrics */

/** 字の箱: 基線から上へ 0.8・下へ 0.15（字の大きさの比） */
const ASCENT = 0.8
const DESCENT = 0.15
/** 縦横とも、この pt を超えて重なったら重なり */
const OVERLAP_MIN = 1
/** 箱の外はこの pt を超えて出た時 */
const OUTSIDE_TOL = 0.5
/** 資料の枚の本文の区域の埋まりがこれ未満なら、空いた枚 */
export const SPARSE_BELOW = 0.85
/** 1 回の検査で持つ件数の上限（字の山がある図で文を作りすぎない） */
const KEEP = 200
const ELLIPSIS = '…'
const QUOTES = new Set(['“', '”', '‘', '’', '"', "'", '«', '»'])

/** @param {string} s @param {number} [n] */
const head = (s, n = 20) => Array.from(s.trim()).slice(0, n).join('')

/**
 * 字の送り幅（em）。書体に無い字は全角 1 em。書体が無い時（試験の簡易な呼び出し）は和字を 1 em・それ以外を 0.5 em
 * @param {Metrics | undefined} metrics @param {string} font @param {number} cp
 */
function advOf(metrics, font, cp) {
  const m = metrics ? metrics[font] ?? metrics.sans : undefined
  if (m && typeof m.adv === 'function') {
    const a = m.adv(cp)
    return Number.isFinite(a) && a > 0 ? a : 1
  }
  return cp >= 0x2e80 ? 1 : 0.5
}

/**
 * TextOp の字の箱。x は最初の字から最後の字＋送り幅、y は基線から字の高さの 0.8 上と 0.15 下。字が空白だけなら null
 * @param {any} op @param {Metrics | undefined} metrics @returns {{ s: string, x0: number, y0: number, x1: number, y1: number } | null}
 */
function textBox(op, metrics) {
  const glyphs = Array.isArray(op.glyphs) ? op.glyphs : []
  if (!glyphs.length) return null
  const s = glyphs.map((/** @type {any} */ g) => g.c).join('')
  if (!s.trim()) return null
  const first = glyphs[0]
  const last = glyphs[glyphs.length - 1]
  const adv = advOf(metrics, op.font, String(last.c).codePointAt(0) ?? 0) * op.size
  return { s, x0: first.x, x1: last.x + adv, y0: op.y - op.size * ASCENT, y1: op.y + op.size * DESCENT }
}

/**
 * Op の列を歩いて、字の箱を集める。box はその字を切る範囲（頁か、入っている ClipOp の範囲の重なり）
 * @param {any[]} ops @param {Rect} box @param {Metrics | undefined} metrics @param {TextBox[]} out
 */
function collect(ops, box, metrics, out) {
  for (const op of ops) {
    if (!op) continue
    if (op.t === 'clip') {
      const c = { x0: Math.max(box.x0, op.x), y0: Math.max(box.y0, op.y), x1: Math.min(box.x1, op.x + op.w), y1: Math.min(box.y1, op.y + op.h) }
      collect(Array.isArray(op.ops) ? op.ops : [], c, metrics, out)
    } else if (op.t === 'text') {
      const b = textBox(op, metrics)
      if (b) out.push({ ...b, box })
    }
  }
}

/** 数えない字（引用符だけ・1 つだけの記号）。飾りで、置き場の余白に入り込む @param {string} s */
const decorative = (s) => Array.from(s).length === 1 && (QUOTES.has(s) || !/[\p{L}\p{N}]/u.test(s))

/**
 * 字の箱の検査。重なり・箱の外・切れ。
 * @param {TextBox[]} boxes
 * @returns {{ overlaps: string[], outside: string[], truncated: string[] }}
 */
function check(boxes) {
  /** @type {string[]} */
  const overlaps = []
  /** @type {string[]} */
  const outside = []
  /** @type {string[]} */
  const truncated = []
  for (const a of boxes) {
    if (a.x0 < a.box.x0 - OUTSIDE_TOL || a.x1 > a.box.x1 + OUTSIDE_TOL || a.y0 < a.box.y0 - OUTSIDE_TOL || a.y1 > a.box.y1 + OUTSIDE_TOL) {
      if (outside.length < KEEP) outside.push(head(a.s))
    }
    if (a.s.endsWith(ELLIPSIS) && truncated.length < KEEP) truncated.push(head(a.s))
  }
  const order = boxes.filter((b) => !decorative(b.s)).sort((p, q) => p.x0 - q.x0)
  for (let i = 0; i < order.length; i++) {
    const a = order[i]
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]
      if (b.x0 >= a.x1 - OVERLAP_MIN) break
      const ix = Math.min(a.x1, b.x1) - b.x0
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      if (!(ix > OVERLAP_MIN && iy > OVERLAP_MIN)) continue
      if (a.s === b.s && Math.abs(a.x0 - b.x0) < 0.5 && Math.abs(a.y0 - b.y0) < 0.5) continue
      if (overlaps.length < KEEP) overlaps.push(`「${head(a.s)}」と「${head(b.s)}」`)
    }
  }
  return { overlaps, outside, truncated }
}

/**
 * Op の列が占める四角（字の箱・矩形・線・画像・path の点）。何も無ければ null
 * @param {any[]} ops @param {Metrics} [metrics]
 * @returns {Rect | null}
 */
export function opsBounds(ops, metrics) {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
  const add = (x0, y0, x1, y1) => {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return
    r.x0 = Math.min(r.x0, x0, x1)
    r.y0 = Math.min(r.y0, y0, y1)
    r.x1 = Math.max(r.x1, x0, x1)
    r.y1 = Math.max(r.y1, y0, y1)
  }
  /** @param {any[]} list */
  const walk = (list) => {
    for (const op of list) {
      if (!op) continue
      switch (op.t) {
        case 'clip': walk(Array.isArray(op.ops) ? op.ops : []); break
        case 'text': { const b = textBox(op, metrics); if (b) add(b.x0, b.y0, b.x1, b.y1); break }
        case 'rect': case 'image': case 'field': add(op.x, op.y, op.x + op.w, op.y + op.h); break
        case 'rule': add(op.x1, op.y1, op.x2, op.y2); break
        case 'path': {
          const n = typeof op.d === 'string' ? op.d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) : null
          if (n) for (let i = 0; i + 1 < n.length; i += 2) add(Number(n[i]), Number(n[i + 1]), Number(n[i]), Number(n[i + 1]))
          break
        }
        default: break
      }
    }
  }
  walk(ops)
  return r.x0 === Infinity ? null : r
}

/**
 * SVG の字を、width × height の箱に写した時の検査。図（look）を描いた直後に呼ぶ。
 * overlaps は「A」と「B」の字の始め、outside は箱（svg の中の clip-path の範囲も）からはみ出した字、truncated は「…」で終わる字。bounds は描いた物の四角（箱の左上が原点）。
 * 書体の寸法（metrics）が無ければ字の幅が読めないので、何も見ない。
 * @param {string} svg
 * @param {{ width: number, height: number, metrics?: Metrics }} o
 * @returns {SvgCheck}
 */
export function inspectSvg(svg, { width, height, metrics }) {
  if (!metrics) return { overlaps: [], outside: [], truncated: [], bounds: null }
  const { ops } = svgToOps(svg, { x: 0, y: 0, width, height, metrics: /** @type {any} */ (metrics), clip: false, quietStyle: true })
  /** @type {TextBox[]} */
  const boxes = []
  collect(ops, { x0: 0, y0: 0, x1: width, y1: height }, metrics, boxes)
  return { ...check(boxes), bounds: opsBounds(ops, metrics) }
}

/**
 * 組み上がった Layout の頁ごとの検査。page.body（lay-slide が資料の本文の区域に付ける { top, height, used }）があれば、
 * 埋まり（used / height）が SPARSE_BELOW 未満の枚を sparse に数える。無ければ（文書・表紙・節・結び）空きは見ない。
 * @param {{ page: { width: number, height: number }, pages: { ops: any[], body?: { top: number, height: number, used: number } }[] }} layout
 * @param {{ metrics?: Metrics }} [o]
 * @returns {PageIssues[]}
 */
export function inspectLayout(layout, { metrics } = {}) {
  const { width, height } = layout.page
  return layout.pages.map((pg, i) => {
    /** @type {TextBox[]} */
    const boxes = []
    collect(pg.ops, { x0: 0, y0: 0, x1: width, y1: height }, metrics, boxes)
    const found = check(boxes)
    const b = pg.body
    const fill = b && b.height > 0 ? b.used / b.height : null
    return { page: i, ...found, sparse: fill !== null && fill < SPARSE_BELOW ? Math.round(fill * 100) / 100 : null }
  })
}

/**
 * 頁ごとの検査を、組版の結果に足す形にする。counts は layout.meta.checks、warnings は compose の warnings に足す（頁・種類・字の始め 20 字）。
 * 1 頁 1 種類に出す字は 3 つまでで、残りは件数にまとめる。
 * @param {PageIssues[]} pages
 * @returns {{ counts: { overlaps: number, outside: number, truncated: number, sparse: number }, warnings: string[] }}
 */
export function summarizeChecks(pages) {
  const counts = { overlaps: 0, outside: 0, truncated: 0, sparse: 0 }
  /** @type {string[]} */
  const warnings = []
  /** @param {number} page @param {string} kind @param {string[]} list @param {(s: string) => string} fmt */
  const push = (page, kind, list, fmt) => {
    if (!list.length) return
    const shown = list.slice(0, 3).map(fmt).join('・')
    warnings.push(`${page + 1} 頁: ${kind} ${shown}${list.length > 3 ? `・ほか ${list.length - 3} 件` : ''}`)
  }
  for (const p of pages) {
    counts.overlaps += p.overlaps.length
    counts.outside += p.outside.length
    counts.truncated += p.truncated.length
    push(p.page, '字が重なっている', p.overlaps, (s) => s)
    push(p.page, '字が箱の外にはみ出している', p.outside, (s) => `「${s}」`)
    push(p.page, '字が「…」で切れている', p.truncated, (s) => `「${s}」`)
    if (p.sparse !== null) {
      counts.sparse++
      warnings.push(`${p.page + 1} 頁: 本文の区域の ${Math.round(p.sparse * 100)}% しか埋まっていない（空いた枚）`)
    }
  }
  return { counts, warnings }
}
