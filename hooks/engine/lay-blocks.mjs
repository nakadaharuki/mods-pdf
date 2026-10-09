// @ts-check
// 要点（keys）・囲み（card）・図（chart・svg・image）・記入欄（fields）。純な部品。
//
// 選ばなかった案:
//   - 囲みの文を、囲みの内側の余白（8pt）を縦にも取って格子から外す案: 本文の基線は常に theme.baseline に乗せる決まりなので、
//     囲みの字も格子に乗せ、地の四角を行の上下に 0.5pt だけ縮めて前後の段落と接しないようにした。
//   - 要点・囲みの見出し・図の説明・チェック欄を pt の固定にする案: 本文 12.5pt の文書で本文より極端に小さく見えた。
//     本文が 9.5pt より大きい時は theme.scale 倍する（小さい時は据え置く。7pt を割らない）。
//   - チャートを組版の途中で描いておく案: 図の高さが分かれば頁の割り方は決まる。描くのは置く頁と y が決まってから 1 回だけ。

import { chartToOps } from './chart.mjs'
import { svgToOps } from './svg.mjs'
import { addTag, breakInlines, centerOffset, drawEntries, lineOps, ruleOp, textLine, toRows, warn, BASE_RATIO } from './lay-text.mjs'

/** @typedef {any} Env */
/** @typedef {any} Item */

/** 図・要点の上下の空き（前後の段落の字と詰まらない分） */
const PAD_TOP = 4
const PAD_BOTTOM = 4
/** 本文 9.5pt の時の値。本文が大きい時は theme.scale 倍する */
const BASE_SMALL = 8
const BASE_SMALL_PITCH = 11.5
const BASE_VALUE = 14
const BASE_VALUE_PITCH = 19
const BASE_CARD_LABEL = 9
const BASE_FIELD_CHECK = 12
const CARD_BAR = 2
const CARD_PAD = 8
/** 記入欄の高さの、1 行（行送り）に対する比。残りは前後の欄との隙間になる */
const FIELD_HEIGHT = 0.8

/**
 * 1 つの塊の中の文字を、上から pitch ずつ下げて描く
 * @param {Env} env @param {any[]} ops @param {any[]} lines @param {number} x0 @param {number} top @param {number} size @param {number} pitch
 */
function drawBlock(env, ops, lines, x0, top, size, pitch) {
  lines.forEach((ln, k) => {
    const base = top + k * pitch + (pitch - size) / 2 + BASE_RATIO * size
    for (const op of lineOps(env, ln, x0, base)) ops.push(op)
  })
}

/**
 * 要点: 版面の幅を個数で等分した箱を横に並べる。
 * @param {Env} env
 * @param {{ items: { label: string, value: string, note?: string }[] }} b
 * @returns {Item | null}
 */
export function keysItem(env, b) {
  const theme = env.theme
  const items = b.items
  const n = items.length
  if (n === 0) return null
  const SMALL = BASE_SMALL * (theme.scale ?? 1)
  const SMALL_PITCH = BASE_SMALL_PITCH * (theme.scale ?? 1)
  const VALUE = BASE_VALUE * (theme.scale ?? 1)
  const VALUE_PITCH = BASE_VALUE_PITCH * (theme.scale ?? 1)
  const gap = 8
  const boxW = (theme.measure - gap * (n - 1)) / n
  const ink = theme.colors.ink
  const sub = theme.colors.sub
  const tTable = addTag(env, 'Table', 0)
  const tRow = addTag(env, 'TR', tTable)
  const o = { measure: boxW, align: /** @type {const} */ ('left'), phrase: true }
  const boxes = items.map((it) => {
    const td = addTag(env, 'TD', tRow)
    const label = breakInlines(env, [{ text: it.label }], { font: theme.fonts.gothic, size: SMALL, color: sub, tag: td }, o)
    const value = breakInlines(env, [{ text: it.value }], { font: theme.fonts.head, size: VALUE, color: ink, tag: td }, o)
    const note = it.note ? breakInlines(env, [{ text: it.note }], { font: theme.fonts.gothic, size: SMALL, color: sub, tag: td }, o) : []
    const h = 1 + 5 + label.length * SMALL_PITCH + 2 + value.length * VALUE_PITCH + (note.length ? 3 + note.length * SMALL_PITCH : 0) + 2
    return { label, value, note, h }
  })
  const inner = Math.max(...boxes.map((x) => x.h))
  const rows = toRows(PAD_TOP + inner + PAD_BOTTOM, theme.lineGap)
  return {
    kind: 'keys', n: 1, rowsOf: () => rows,
    emit: ({ ops, y0, row0 }) => {
      const shift = centerOffset(rows, PAD_TOP + inner + PAD_BOTTOM, theme.lineGap, row0)
      boxes.forEach((bx, i) => {
        const x = theme.left + i * (boxW + gap)
        let y = y0 + PAD_TOP + shift
        ops.push(ruleOp(x, y + 0.5, x + boxW, y + 0.5, 1, ink))
        y += 1 + 5
        drawBlock(env, ops, bx.label, x, y, SMALL, SMALL_PITCH)
        y += bx.label.length * SMALL_PITCH + 2
        drawBlock(env, ops, bx.value, x, y, VALUE, VALUE_PITCH)
        y += bx.value.length * VALUE_PITCH
        if (bx.note.length) drawBlock(env, ops, bx.note, x, y + 3, SMALL, SMALL_PITCH)
      })
    },
  }
}

/**
 * 囲み: 左に太い罫・地は tint・内側 8pt。label（太字）の行と text の行はどれも格子に乗る。
 * @param {Env} env
 * @param {{ label: string, text: any[] }} b
 * @returns {Item | null}
 */
export function cardItem(env, b) {
  const theme = env.theme
  const ink = theme.colors.ink
  const tag = addTag(env, 'Note', 0)
  const x = theme.left + CARD_BAR + CARD_PAD
  const measure = theme.measure - CARD_BAR - 2 * CARD_PAD
  /** @type {any[]} */
  const entries = []
  if (b.label) {
    const lab = breakInlines(env, [{ text: b.label }], { font: theme.fonts.gothicBold, size: BASE_CARD_LABEL * (theme.scale ?? 1), color: ink, tag }, { measure, align: 'left', phrase: true })
    for (const line of lab) entries.push({ line, x })
  }
  const body = breakInlines(env, b.text, { font: theme.fonts.body, size: theme.size, color: ink, tag }, { measure, align: 'justify' }, 'body')
  for (const line of body) entries.push({ line, x })
  if (entries.length === 0) return null
  const rows = entries.length
  return {
    kind: 'card', n: 1, rowsOf: () => rows,
    emit: (c) => {
      const h = rows * theme.lineGap - 1
      c.ops.push({ t: 'rect', x: theme.left, y: c.y0 + 0.5, w: theme.measure, h, fill: theme.colors.tint })
      c.ops.push(ruleOp(theme.left + CARD_BAR / 2, c.y0 + 0.5, theme.left + CARD_BAR / 2, c.y0 + 0.5 + h, CARD_BAR, ink))
      drawEntries(env, c, entries, 0, entries.length)
    },
  }
}

/**
 * 記入欄: 1 項目 1 行（複数行は 3 行）。ラベルは左の 8em、欄は残りの幅。
 * @param {Env} env
 * @param {{ items: { kind: string, name: string, label: string, value?: string|boolean, options?: string[], width?: number }[] }} b
 * @returns {Item | null}
 */
export function fieldsItem(env, b) {
  const theme = env.theme
  const em = theme.size
  if (b.items.length === 0) return null
  const tag = addTag(env, 'Form', 0)
  const FIELD_CHECK = BASE_FIELD_CHECK * (theme.scale ?? 1)
  // ラベルの列は一番長いラベルが 1 行に収まる幅（上限は版面の 4 割）。固定の 8 字にすると「個人情報の取り扱いに同意する」が 3 行に折れた
  const oneLine = { font: theme.fonts.body, size: em, color: theme.colors.ink }
  const natural = Math.max(...b.items.map((it) => textLine(env, it.label, oneLine)?.width ?? 0))
  const labelW = Math.min(Math.max(5 * em, (Math.ceil(natural / em) + 1) * em), Math.floor((0.4 * theme.measure) / em) * em)
  const fieldW = theme.measure - labelW
  const items = b.items.map((it) => {
    const label = breakInlines(env, [{ text: it.label }], { font: theme.fonts.body, size: em, color: theme.colors.ink, tag }, { measure: labelW - 0.5 * em, align: 'left', phrase: true })
    const base = it.kind === 'multiline' ? 3 : 1
    return { it, label, rows: Math.max(base, label.length), base }
  })
  const prefix = [0]
  for (const x of items) prefix.push(prefix[prefix.length - 1] + x.rows)
  return {
    kind: 'fields', n: items.length,
    rowsOf: (a, bb) => prefix[bb] - prefix[a],
    canCut: () => true,
    emit: (c) => {
      for (let i = c.a; i < c.b; i++) {
        const x = items[i]
        const row = c.row0 + prefix[i] - prefix[c.a]
        const yTop = c.y0 + (prefix[i] - prefix[c.a]) * theme.lineGap
        x.label.forEach((ln, k) => {
          for (const op of lineOps(env, ln, theme.left, theme.baseline(row + k))) c.ops.push(op)
        })
        const it = x.it
        const isCheck = it.kind === 'check'
        const h = isCheck ? FIELD_CHECK : it.kind === 'multiline' ? (x.base - (1 - FIELD_HEIGHT)) * theme.lineGap : FIELD_HEIGHT * theme.lineGap
        const w = isCheck ? FIELD_CHECK : Math.min(it.width ?? fieldW, fieldW)
        const y = it.kind === 'multiline' ? yTop + ((1 - FIELD_HEIGHT) / 2) * theme.lineGap : yTop + (theme.lineGap - h) / 2
        /** @type {any} */
        const op = { t: 'field', kind: it.kind, name: it.name, x: theme.left + labelW, y, w, h, size: em, tag }
        if (it.value !== undefined) op.value = it.value
        if (it.options) op.options = it.options
        c.ops.push(op)
      }
    },
  }
}

/**
 * 図の Op に tag を付ける（ClipOp の中も）。
 * @param {any[]} ops @param {number} tag
 */
function tagAll(ops, tag) {
  for (const op of ops) {
    if (op.t === 'clip') tagAll(op.ops, tag)
    else if (op.t !== 'link') op.tag = tag
  }
}

/**
 * SVG の縦横比（高さ / 幅）。viewBox を先に、無ければ数値の width・height を見る。読めなければ null。
 * 選ばなかった案: 高さを常に幅の 0.5 倍にする設計書どおりの案。横長の図（流れ図）は viewBox の上下が空白になり、頁に大きな穴が開いた。
 * @param {unknown} source
 * @returns {number | null}
 */
export function svgAspect(source) {
  const open = String(source).match(/<svg\b[^>]*>/i)
  if (!open) return null
  const num = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)'
  const vb = open[0].match(new RegExp(`\\bviewBox\\s*=\\s*["']\\s*${num}[\\s,]+${num}[\\s,]+${num}[\\s,]+${num}\\s*["']`, 'i'))
  let w = vb ? Number(vb[3]) : NaN
  let h = vb ? Number(vb[4]) : NaN
  if (!(w > 0 && h > 0)) {
    const wa = open[0].match(new RegExp(`\\swidth\\s*=\\s*["']\\s*${num}(?:px)?\\s*["']`, 'i'))
    const ha = open[0].match(new RegExp(`\\sheight\\s*=\\s*["']\\s*${num}(?:px)?\\s*["']`, 'i'))
    w = wa ? Number(wa[1]) : NaN
    h = ha ? Number(ha[1]) : NaN
  }
  return w > 0 && h > 0 ? h / w : null
}

/**
 * チャート・SVG・画像。幅は版面いっぱい（画像は縦横比を保つ）、下に caption。
 * @param {Env} env
 * @param {any} b chart | svg | image のブロック
 * @returns {Item}
 */
export function figureItem(env, b) {
  const theme = env.theme
  const W = theme.measure
  const sub = theme.colors.sub
  const SMALL = BASE_SMALL * (theme.scale ?? 1)
  const SMALL_PITCH = BASE_SMALL_PITCH * (theme.scale ?? 1)
  const alt = b.type === 'chart' ? b.caption || 'グラフ' : b.alt || '図'
  const tag = addTag(env, 'Figure', 0, { alt })
  const capTag = b.caption ? addTag(env, 'Caption', tag) : undefined
  const caption = b.caption
    ? breakInlines(env, [{ text: b.caption }], { font: theme.fonts.gothic, size: SMALL, color: sub, tag: capTag }, { measure: W, align: 'center', phrase: true })
    : []
  const capH = caption.length ? 3 + caption.length * SMALL_PITCH : 0
  const maxH = theme.lines * theme.lineGap - PAD_TOP - PAD_BOTTOM - capH

  let w = W
  const aspect = b.type === 'svg' ? svgAspect(b.source) : null
  let h = typeof b.height === 'number' && b.height > 0 ? b.height : aspect ? Math.max(24, W * aspect) : W * 0.5
  /** @type {any} */
  let img = null
  if (b.type === 'image') {
    const im = env.images[b.path]
    if (im && im.width > 0 && im.height > 0 && typeof im.base64 === 'string') {
      img = im
      w = Math.min(typeof b.width === 'number' && b.width > 0 ? b.width : W, W)
      h = (w * im.height) / im.width
    } else {
      warn(env, `画像 ${String(b.path).slice(0, 80)} を読み込めなかったので灰色の四角にしました`)
    }
  }
  if (h > maxH) {
    if (img) w = (maxH * img.width) / img.height
    h = maxH
    warn(env, '図が 1 頁より高いので、頁に収まる高さに縮めました')
  }
  const rows = toRows(PAD_TOP + h + capH + PAD_BOTTOM, theme.lineGap)
  return {
    kind: 'figure', n: 1, rowsOf: () => rows,
    emit: ({ ops, y0, row0 }) => {
      const y = y0 + PAD_TOP + centerOffset(rows, PAD_TOP + h + capH + PAD_BOTTOM, theme.lineGap, row0)
      /** @type {any[]} */
      let drawn = []
      if (b.type === 'chart') {
        const r = chartToOps(b.option, { x: theme.left, y, width: W, height: h, metrics: env.metrics, theme })
        for (const m of r.warnings) warn(env, m)
        drawn = r.ops
      } else if (b.type === 'svg') {
        const r = svgToOps(b.source, { x: theme.left, y, width: W, height: h, metrics: env.metrics, color: theme.colors.ink, paper: theme.colors.paper })
        for (const m of r.warnings) warn(env, m)
        drawn = r.ops
      } else if (img) {
        drawn = [{ t: 'image', x: theme.left + (W - w) / 2, y, w, h, kind: img.kind, base64: img.base64 }]
      } else {
        drawn = [{ t: 'rect', x: theme.left, y, w: W, h, fill: theme.colors.tint, stroke: theme.colors.rule, lw: 0.5 }]
      }
      tagAll(drawn, tag)
      for (const op of drawn) ops.push(op)
      drawBlock(env, ops, caption, theme.left, y + h + 3, SMALL, SMALL_PITCH)
    },
  }
}
