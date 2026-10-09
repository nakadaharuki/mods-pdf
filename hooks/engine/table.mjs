// @ts-check
// 表を組む。列の幅を決め、セルを折り返し、頁をまたぐ時に頭の行を出し直す。純な部品。
//
// 選ばなかった案:
//   - 表の行を 1 行ずつ本文の格子に載せる案: 表の字は 8.5pt で行送りが 13.6pt、本文は 9.5pt で 16.6pt。
//     行ごとに格子へ丸めると表が間延びするので、表は自分の寸法で組み、全体の高さだけ最後に格子に切り上げる。
//   - 列の幅を字の数で比べる案: 数字・欧文・和字で幅が違う。セルを 1 行に組んだ幅を測って使う。
//   - 数字の列の判定に頭の行を含める案: 頭は「金額」「前年比」のような字なので必ず外れる。本文のセルだけで決める。
//   - ロゴを字の前の 1 字として組む案（私用領域の字に割り当てる）: 書体に字を足せず、行の折り返しと両端揃えに乗ると
//     ロゴの幅が揃え方に巻き込まれる。セルの幅（natW・minW）にロゴの箱の分を足し、字は箱の分だけ右へずらして描く。
//   - 表の字を 8.5pt の固定にする案: 本文 12.5pt の文書で表だけが小さく見えた。本文が 9.5pt より大きい時は theme.scale 倍する。

import { advOf } from './ruby.mjs'
import { addTag, breakSpans, centerOffset, lineOps, ruleOp, spansOf, toRows, warn, BASE_RATIO } from './lay-text.mjs'
import { svgToOps } from './svg.mjs'
import { lookupLogo } from '../lib/logos.mjs'

/** 本文 9.5pt の時の値。本文が大きい時は theme.scale 倍する */
const BASE_CELL_SIZE = 8.5
const BASE_PITCH = 13.6
const BASE_PAD_X = 4
/** 行の上下に足す余白（合計） */
const BASE_ROW_PAD = 2
/** 表の上下の空き。前後の段落の字と罫が詰まらない分 */
const PAD_TOP = 4
const PAD_BOTTOM = 4
/** 和字の連なりの下限の上限（em）。これを超える連なりは字の途中でも折れる */
const CJK_RUN_CAP = 6
const EPS = 1e-6
/** ロゴの箱（表の字の大きさに対する倍率）。横長のロゴが潰れないよう、高さより横を広く取り、中でロゴを meet で収める */
const LOGO_H = 1.1
const LOGO_W = 1.8
const LOGO_GAP = 0.4
/** 1 本のロゴの字数の上限。表の組みは重いので、大きな SVG は描かない（logos.mjs の上限より厳しい） */
const LOGO_CHARS_MAX = 100_000

/** 数字の列に見なせる字: 数字・符号・▲▼・%・円・桁区切り・小数点・空白 */
const NUMERIC = /^[+\-−＋0-9０-９▲▼△▽%％円,，.．\s]+$/u

/** @param {{ text: string }[]} inl */
const plain = (inl) => inl.map((i) => i.text).join('')

/**
 * セルの中身。Inline[] か、{ text: Inline[], logo } の形
 * @param {any} cell @returns {any[]}
 */
const inlinesOf = (cell) => (Array.isArray(cell) ? cell : cell && Array.isArray(cell.text) ? cell.text : [])

/**
 * セルの logo の字（'NYSE:IBM'）。Inline の logo か、セルの logo
 * @param {any} cell @returns {string | null}
 */
function logoKeyOf(cell) {
  if (Array.isArray(cell)) {
    for (const it of cell) if (it && typeof it.logo === 'string') return it.logo
    return null
  }
  return cell && typeof cell.logo === 'string' ? cell.logo : null
}

/**
 * 表を割れる Item にする。
 * @param {any} env Env（lay-text.mjs）
 * @param {{ head: any[][], rows: any[][][], align?: ('left'|'right'|'center')[], widths?: number[] }} b
 * @returns {any} Item（lay-text.mjs）または null
 */
export function tableItem(env, b) {
  const theme = env.theme
  const cols = b.head.length
  if (cols === 0) return null
  const ink = theme.colors.ink
  const W = theme.measure
  const body = b.rows
  const scale = theme.scale ?? 1
  const CELL_SIZE = BASE_CELL_SIZE * scale
  const PITCH = BASE_PITCH * scale
  const PAD_X = BASE_PAD_X * scale
  const ROW_PAD = BASE_ROW_PAD * scale

  const tTable = addTag(env, 'Table', 0)
  const tHead = addTag(env, 'THead', tTable)
  const tHeadRow = addTag(env, 'TR', tHead)
  const tBody = addTag(env, 'TBody', tTable)

  // 数字の列: 本文のセルが全部数字らしく、数字が 1 つはある。align があればそれに従う
  const aligns = Array.from({ length: cols }, (_, j) => {
    const given = b.align && b.align[j]
    if (given === 'left' || given === 'right' || given === 'center') return given
    let digit = false
    for (const r of body) {
      const t = plain(inlinesOf(r[j])).trim()
      if (t === '') continue
      if (!NUMERIC.test(t)) return /** @type {const} */ ('left')
      if (/[0-9０-９]/u.test(t)) digit = true
    }
    return digit ? /** @type {const} */ ('right') : /** @type {const} */ ('left')
  })

  const logos = env.logos ?? theme.logos
  const logoW = LOGO_W * CELL_SIZE
  const logoH = LOGO_H * CELL_SIZE
  const logoGap = LOGO_GAP * CELL_SIZE

  /**
   * セル 1 つの用意: 1 行に組んだ幅と、折れる最小の幅、それに spans。
   * ロゴがあれば lw（箱と字の間の空き）を字の幅に足す。natW・minW は lw を含む
   * @param {any} cell @param {boolean} head @param {number} tag
   */
  const prep = (cell, head, tag) => {
    const inl = inlinesOf(cell)
    const st = { font: /** @type {'sansBold'|'sans'} */ (head ? 'sansBold' : 'sans'), size: CELL_SIZE, color: ink, tag }
    const spans = spansOf(env, inl, st)
    const one = breakSpans(env, spans, { measure: 1e5, align: 'left' })
    const natLine = one.length ? one[0] : null
    const key = logoKeyOf(cell)
    const svg = key ? lookupLogo(logos, key) : null
    const drawable = svg !== null && svg.length <= LOGO_CHARS_MAX
    if (svg !== null && !drawable) warn(env, `ロゴ ${key} は大きすぎるので描きません`)
    const textW = natLine ? natLine.width : 0
    const lw = drawable ? logoW + (textW > 0 ? logoGap : 0) : 0
    return {
      spans, natLine, natW: textW + lw, lw, logo: drawable ? { key: /** @type {string} */ (key), svg: /** @type {string} */ (svg) } : null,
      minW: minUnit(env, plain(inl), head, CELL_SIZE) + lw,
    }
  }
  const headCells = b.head.map((cell) => prep(cell, true, addTag(env, 'TH', tHeadRow)))
  const bodyCells = body.map((r) => {
    const tr = addTag(env, 'TR', tBody)
    return Array.from({ length: cols }, (_, j) => prep(r[j] ?? [], false, addTag(env, 'TD', tr)))
  })

  // 列の幅
  const nat = new Array(cols).fill(0)
  const min = new Array(cols).fill(0)
  for (let j = 0; j < cols; j++) {
    for (const row of [headCells, ...bodyCells]) {
      nat[j] = Math.max(nat[j], row[j].natW + 2 * PAD_X)
      min[j] = Math.max(min[j], row[j].minW + 2 * PAD_X)
    }
    min[j] = Math.min(min[j], nat[j])
  }
  const colW = allocate(W, nat, min, b.widths)
  const colX = colW.map((_, j) => colW.slice(0, j).reduce((s, v) => s + v, 0))

  /**
   * セルを組む。1 行に収まるなら 1 行に組んだ行を使い回し、揃えは手で動かす
   * @param {ReturnType<typeof prep>} c @param {number} j
   */
  const setCell = (c, j) => {
    const inner = Math.max(colW[j] - 2 * PAD_X, 1)
    const align = aligns[j]
    const logo = c.logo
    if (c.natW <= inner + 0.01 && (c.natLine || logo)) {
      const dx = align === 'right' ? inner - c.natW : align === 'center' ? (inner - c.natW) / 2 : 0
      return { lines: c.natLine ? [c.natLine] : [], dx, lw: c.lw, logo }
    }
    // ロゴの箱の分だけ字の幅を狭める。箱は 1 行目の左に置く
    return { lines: breakSpans(env, c.spans, { measure: Math.max(inner - c.lw, 1), align, phrase: true }), dx: 0, lw: c.lw, logo }
  }
  /** @param {ReturnType<typeof prep>[]} cells */
  const setRow = (cells) => {
    const laid = cells.map(setCell)
    const n = Math.max(1, ...laid.map((c) => c.lines.length))
    return { cells: laid, h: n * PITCH + ROW_PAD }
  }
  const headRow = setRow(headCells)
  const bodyRows = bodyCells.map(setRow)

  const prefix = [0]
  for (const r of bodyRows) prefix.push(prefix[prefix.length - 1] + r.h)
  const n = Math.max(1, bodyRows.length)
  const ptOf = (/** @type {number} */ a, /** @type {number} */ bb) => PAD_TOP + headRow.h + (prefix[Math.min(bb, bodyRows.length)] - prefix[Math.min(a, bodyRows.length)]) + PAD_BOTTOM

  /**
   * @param {any[]} ops @param {typeof headRow} row @param {number} top @param {boolean} untagged
   */
  const drawRow = (ops, row, top, untagged) => {
    row.cells.forEach((c, j) => {
      const x0 = theme.left + colX[j] + PAD_X + c.dx
      c.lines.forEach((ln, k) => {
        const base = top + ROW_PAD / 2 + (PITCH - CELL_SIZE) / 2 + BASE_RATIO * CELL_SIZE + k * PITCH
        for (const op of lineOps(env, ln, x0 + c.lw, base, { untagged })) ops.push(op)
      })
      if (c.logo) {
        // 飾りなので tag は付けない（Artifact）。隣の字が読み上げに出る
        const r = svgToOps(c.logo.svg, { x: x0, y: top + ROW_PAD / 2 + (PITCH - logoH) / 2, width: logoW, height: logoH, metrics: env.metrics, paper: theme.colors.paper, quietStyle: true })
        for (const op of r.ops) ops.push(op)
        for (const w of r.warnings.slice(0, 2)) warn(env, `ロゴ ${c.logo.key}: ${w}`)
      }
    })
  }

  return {
    kind: 'table',
    n,
    rowsOf: (a, bb) => toRows(ptOf(a, bb), theme.lineGap),
    canCut: () => true,
    emit: ({ ops, y0, row0, a, b: bb }) => {
      const x1 = theme.left
      const x2 = theme.left + W
      const top = y0 + PAD_TOP + centerOffset(toRows(ptOf(a, bb), theme.lineGap), ptOf(a, bb), theme.lineGap, row0)
      const last = bb >= n
      ops.push({ t: 'rect', x: x1, y: top, w: W, h: headRow.h, fill: theme.colors.tint })
      drawRow(ops, headRow, top, a > 0)
      let y = top + headRow.h
      for (let i = a; i < Math.min(bb, bodyRows.length); i++) {
        drawRow(ops, bodyRows[i], y, false)
        y += bodyRows[i].h
      }
      ops.push(ruleOp(x1, top, x2, top, 0.8, ink))
      ops.push(ruleOp(x1, top + headRow.h, x2, top + headRow.h, 0.6, ink))
      let yy = top + headRow.h
      for (let i = a; i < Math.min(bb, bodyRows.length) - 1; i++) {
        yy += bodyRows[i].h
        ops.push(ruleOp(x1, yy, x2, yy, 0.4, theme.colors.rule))
      }
      if (bodyRows.length) ops.push(last ? ruleOp(x1, y, x2, y, 0.8, ink) : ruleOp(x1, y, x2, y, 0.4, theme.colors.rule))
      else ops.push(ruleOp(x1, y, x2, y, 0.8, ink))
    },
  }
}

/**
 * 折れる最小の幅（pt）: 欧文の語・数字の連なり、和字は文節（BudouX）のうち最長の物。
 * 幅は字の送り幅の和（カーニングは見ない）。下限なので少し外れても行は組める
 * @param {any} env @param {string} text @param {boolean} bold @param {number} size 表の字の大きさ
 */
function minUnit(env, text, bold, size) {
  const m = env.metrics[bold ? 'sansBold' : 'sans']
  let best = 0
  for (const tok of text.split(/\s+/u)) {
    if (!tok) continue
    if (!/[^\x00-\x7f]/u.test(tok)) {
      best = Math.max(best, width(m, tok, size))
      continue
    }
    let bounds = /** @type {number[]} */ ([])
    if (env.phrase) {
      try { bounds = env.phrase(tok) } catch { bounds = [] }
    }
    const chars = Array.from(tok)
    let from = 0
    for (const at of [...bounds, chars.length]) {
      if (at <= from) continue
      best = Math.max(best, Math.min(width(m, chars.slice(from, at).join(''), size), CJK_RUN_CAP * size))
      from = at
    }
  }
  return best
}

/** @param {any} m @param {string} s @param {number} size */
function width(m, s, size) {
  let w = 0
  for (const ch of s) w += advOf(m, /** @type {number} */ (ch.codePointAt(0)))
  return w * size
}

/**
 * 列の幅を割り振る。widths（割合）があればそのとおり。
 * 自然な幅の合計が版面に収まれば比のまま版面いっぱいに伸ばし、収まらなければ下限から始めて余りを（自然 − 下限）の比で配る。
 * 下限の合計も収まらなければ下限の比で縮める
 * @param {number} W @param {number[]} nat @param {number[]} min @param {number[] | undefined} widths
 */
export function allocate(W, nat, min, widths) {
  const n = nat.length
  if (widths && widths.length === n) {
    const sum = widths.reduce((s, v) => s + v, 0)
    if (sum > 0) return widths.map((v) => (W * v) / sum)
  }
  const sumNat = nat.reduce((s, v) => s + v, 0)
  if (sumNat <= EPS) return nat.map(() => W / n)
  if (sumNat <= W) return nat.map((v) => (v * W) / sumNat)
  const sumMin = min.reduce((s, v) => s + v, 0)
  if (sumMin >= W) return min.map((v) => (v * W) / sumMin)
  const room = W - sumMin
  const want = nat.map((v, j) => v - min[j])
  const sumWant = want.reduce((s, v) => s + v, 0)
  return min.map((v, j) => v + (sumWant > EPS ? (room * want[j]) / sumWant : room / n))
}
