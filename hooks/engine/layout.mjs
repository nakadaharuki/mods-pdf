// @ts-check
// Doc を頁に組む（Display List を作る）。純な部品。
//
// 流れ: ブロックごとに「割れる単位（Item）」を作り（行を組み、行数を数える）、頁に流し込み（paginate）、足を付け、統計と警告をまとめる。
//
// 行の格子: 本文の行の基線は必ず theme.baseline(頁の中の行の番号)。見出し・表・図・要点・囲みの高さは行送りの整数倍に切り上げるので、
// 後ろの本文は次の格子の行に戻る。
//
// 選ばなかった案:
//   - 見出しの上の空き（h1 は 2 行・h2 は 1 行）を頁の頭でも残す案: 改ページの直後に 2 行ぶんの白が空き、頁が間延びする。
//     頁の頭では捨てる（before）。見出しの字の基線はどちらでも格子の上。
//   - 見出しを組んでから、直後の段落と一緒に置けるかを後で確かめて戻る案: 先に「見出しの行数 + 次の部品の最小の塊」を数えて、
//     入らなければ見出しごと次の頁へ。戻る処理（巻き戻し）が要らない。
//   - 最後の頁が少ない時に前の頁から行を送る案: 段落の割り方が連鎖して変わるので、警告に書くだけにした。

import { plainText } from './inline.mjs'
import { tableItem } from './table.mjs'
import { keysItem, cardItem, fieldsItem, figureItem } from './lay-blocks.mjs'
import { addTag, breakInlines, lineOps, makeEnv, rowsItem, ruleOp, textLine, toRows, topOf, warn, BASE_RATIO } from './lay-text.mjs'

/** @typedef {any} Env */
/** @typedef {any} Item */

const FONT_ORDER = ['mincho', 'minchoBold', 'sans', 'sansBold']
const TITLE_SIZE = 18
const TITLE_PITCH = TITLE_SIZE * 1.4
const META_SIZE = 9
const META_PITCH = 12
/** 箇条書きの頭の印の幅（em） */
const MARK_EM = 1.5
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000)
const SLASH = String.fromCodePoint(0xff0f)
const ELLIPSIS = String.fromCodePoint(0x2026)
const LAST_PAGE_FILL = 0.15

/**
 * @param {number} now
 * @returns {string}
 */
function dateText(now) {
  if (!Number.isFinite(now)) return ''
  const d = new Date(now)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 題名の塊: 題名・太い罫・author と日付。1 頁目の頭。
 * @param {Env} env
 * @param {{ title: string, author?: string }} doc
 * @param {number} now
 * @returns {Item}
 */
function titleItem(env, doc, now) {
  const theme = env.theme
  const W = theme.measure
  const ink = theme.colors.ink
  const tag = addTag(env, 'H1', 0)
  const lines = breakInlines(env, [{ text: doc.title }], { font: theme.fonts.head, size: TITLE_SIZE, color: ink, tag }, { measure: W, align: 'left', phrase: true })
  const metaText = [doc.author, dateText(now)].filter(Boolean).join(IDEOGRAPHIC_SPACE)
  const metaTag = metaText ? addTag(env, 'P', 0) : undefined
  const meta = metaText ? textLine(env, metaText, { font: theme.fonts.gothic, size: META_SIZE, color: theme.colors.sub, tag: metaTag }) : null

  const padTop = 2
  const titleBottom = padTop + lines.length * TITLE_PITCH
  const ruleTop = titleBottom + 1
  const ruleBottom = ruleTop + 1.4
  const metaTop = ruleBottom + 4
  const end = meta ? metaTop + META_PITCH : ruleBottom + 2
  const rows = toRows(end + 2, theme.lineGap)
  return {
    kind: 'title', n: 1, rowsOf: () => rows,
    emit: ({ ops, y0, page }) => {
      lines.forEach((ln, j) => {
        const base = y0 + padTop + j * TITLE_PITCH + (TITLE_PITCH - TITLE_SIZE) / 2 + BASE_RATIO * TITLE_SIZE
        for (const op of lineOps(env, ln, theme.left, base)) ops.push(op)
        if (j === 0) env.outline.push({ title: doc.title, level: 1, page, y: topOf(base, TITLE_SIZE) })
      })
      const ry = y0 + ruleTop + 0.7
      ops.push(ruleOp(theme.left, ry, theme.left + W, ry, 1.4, ink))
      if (meta) {
        const base = y0 + metaTop + (META_PITCH - META_SIZE) / 2 + BASE_RATIO * META_SIZE
        for (const op of lineOps(env, meta, theme.left, base)) ops.push(op)
      }
    },
  }
}

/**
 * 見出し: h1 は 3 行取り・h2 は 2 行取り・h3 は 1 行取りで、字の基線は塊の最後の行の基線。
 * 折り返す見出しは、1 行ごとに ceil(大きさ × 1.2 / 行送り) 行ずつ下げる（18pt の h1 は 2 行）。
 * @param {Env} env
 * @param {{ level: 1|2|3, text: any[] }} b
 * @returns {Item | null}
 */
function headingItem(env, b) {
  const theme = env.theme
  const lvl = b.level
  const hs = theme.head[`h${lvl}`]
  const nominal = lvl === 1 ? 3 : lvl === 2 ? 2 : 1
  const tag = addTag(env, `H${lvl}`, 0)
  const lines = breakInlines(env, b.text, { font: hs.font, size: hs.size, color: theme.colors.ink, tag }, { measure: theme.measure, align: 'left', phrase: true })
  if (lines.length === 0) return null
  const pitch = Math.max(1, Math.ceil((hs.size * 1.2) / theme.lineGap - 1e-9))
  const before = nominal - 1
  const rows = before + 1 + (lines.length - 1) * pitch
  const title = plainText(b.text)
  return {
    kind: 'heading', n: 1, rowsOf: () => rows, before, keepNext: true,
    emit: ({ ops, y0, row0, page, trim }) => {
      const eff = rows - trim
      const lastRow = row0 + eff - 1
      lines.forEach((ln, j) => {
        const base = theme.baseline(lastRow - (lines.length - 1 - j) * pitch)
        for (const op of lineOps(env, ln, theme.left, base)) ops.push(op)
        if (j === 0) env.outline.push({ title, level: lvl, page, y: topOf(base, hs.size) })
      })
      if (hs.rule > 0) {
        const y = y0 + eff * theme.lineGap - 1.4
        ops.push(ruleOp(theme.left, y, theme.left + theme.measure, y, hs.rule, hs.ruleColor))
      }
    },
  }
}

/**
 * 段落: 1 字下げ・両端揃え（欧文の文書でも）。全部の行が 1 つの P。
 * @param {Env} env
 * @param {{ text: any[] }} b
 * @returns {Item | null}
 */
function paraItem(env, b) {
  const theme = env.theme
  const tag = addTag(env, 'P', 0)
  const lines = breakInlines(env, b.text, { font: theme.fonts.body, size: theme.size, color: theme.colors.ink, tag }, { measure: theme.measure, align: 'justify', indent: 1 }, 'body')
  if (lines.length === 0) return null
  return rowsItem(env, 'para', lines.map((line) => ({ line, x: theme.left })))
}

/**
 * 引用: 左に 1pt の細い罫・2em 下げ。
 * @param {Env} env
 * @param {{ text: any[] }} b
 * @returns {Item | null}
 */
function quoteItem(env, b) {
  const theme = env.theme
  const tag = addTag(env, 'BlockQuote', 0)
  const indent = 2 * theme.size
  const lines = breakInlines(env, b.text, { font: theme.fonts.body, size: theme.size, color: theme.colors.ink, tag }, { measure: theme.measure - indent, align: 'justify' }, 'body')
  if (lines.length === 0) return null
  return rowsItem(env, 'quote', lines.map((line) => ({ line, x: theme.left + indent })), {
    under: (c) => {
      const y1 = c.y0 + 2
      const y2 = c.y0 + (c.b - c.a) * theme.lineGap - 2
      c.ops.push(ruleOp(theme.left + 0.5, y1, theme.left + 0.5, y2, 1, theme.colors.rule))
    },
  })
}

/**
 * 箇条書き: 頭の印を 1.5em の幅に置き、中身は 1.5em 下げた幅で組む。2 段目は更に 1.5em。
 * 頁を割るのは項目の境目か、項目の中で前後に 2 行以上残る所。
 * @param {Env} env
 * @param {{ ordered: boolean, items: any[] }} b
 * @returns {Item | null}
 */
function listItem(env, b) {
  const theme = env.theme
  const em = theme.size
  const ink = theme.colors.ink
  /** @type {any[]} */
  const entries = []
  /** @type {number[]} */
  const itemStart = []
  /** @type {number[]} */
  const itemEnd = []

  /** @param {any[]} list @param {boolean} ordered @param {number} parentTag @param {number} depth */
  const build = (list, ordered, parentTag, depth) => {
    list.forEach((raw, i) => {
      const inl = Array.isArray(raw) ? raw : raw.text
      const li = addTag(env, 'LI', parentTag)
      const lbl = addTag(env, 'Lbl', li)
      const body = addTag(env, 'LBody', li)
      const boxX = theme.left + depth * MARK_EM * em
      const bodyX = boxX + MARK_EM * em
      const lines = breakInlines(env, inl, { font: theme.fonts.body, size: em, color: ink, tag: body }, { measure: theme.measure - (depth + 1) * MARK_EM * em, align: 'justify' }, 'body')
      const st = { font: theme.fonts.body, size: em, color: ink, tag: lbl }
      /** @type {any} */
      let mark = null
      if (ordered) {
        const num = textLine(env, `${i + 1}.`, st)
        if (num) mark = { line: num, x: Math.max(boxX, boxX + MARK_EM * em - 0.3 * em - num.width) }
      } else {
        const dot = textLine(env, String.fromCodePoint(0x30fb), st)
        if (dot) mark = { line: dot, x: boxX + 0.5 * em }
      }
      const start = entries.length
      if (lines.length === 0) entries.push(mark ? { line: null, x: bodyX, mark } : { line: null, x: bodyX })
      else lines.forEach((line, k) => entries.push(k === 0 && mark ? { line, x: bodyX, mark } : { line, x: bodyX }))
      const end = entries.length
      for (let k = start; k < end; k++) {
        itemStart[k] = start
        itemEnd[k] = end
      }
      if (!Array.isArray(raw) && Array.isArray(raw.items) && raw.items.length) {
        build(raw.items, !!raw.ordered, addTag(env, 'L', body), depth + 1)
      }
    })
  }
  build(b.items, !!b.ordered, addTag(env, 'L', 0), 0)
  if (entries.length === 0) return null

  return rowsItem(env, 'list', entries, {
    cut: (a, c) => {
      if (itemStart[c] === c) return true
      return c - Math.max(a, itemStart[c]) >= 2 && itemEnd[c] - c >= 2
    },
  })
}

/**
 * 1 つのブロックを Item にする。
 * @param {Env} env
 * @param {any} b
 * @returns {Item | null}
 */
function blockItem(env, b) {
  const theme = env.theme
  switch (b.type) {
    case 'heading': return headingItem(env, b)
    case 'para': return paraItem(env, b)
    case 'list': return listItem(env, b)
    case 'table': return tableItem(env, b)
    case 'quote': return quoteItem(env, b)
    case 'keys': return keysItem(env, b)
    case 'card': return cardItem(env, b)
    case 'chart':
    case 'svg':
    case 'image': return figureItem(env, b)
    case 'fields': return fieldsItem(env, b)
    case 'rule':
      return {
        kind: 'rule', n: 1, rowsOf: () => 1,
        emit: ({ ops, y0 }) => {
          const y = y0 + theme.lineGap / 2
          ops.push(ruleOp(theme.left, y, theme.left + theme.measure, y, 0.5, theme.colors.rule))
        },
      }
    case 'pagebreak': return { kind: 'break', n: 0, rowsOf: () => 0, emit: () => {} }
    default:
      warn(env, `知らない種類のブロック ${String(b && b.type).slice(0, 20)} を捨てました`)
      return null
  }
}

/**
 * Item を頁に流し込む。割れる物は、入るだけ入れて残りを次の頁へ。
 * @param {Env} env
 * @param {Item[]} items
 * @returns {{ pages: { ops: any[] }[], lastRows: number }}
 */
function paginate(env, items) {
  const theme = env.theme
  const capacity = theme.lines
  /** @type {{ ops: any[] }[]} */
  const pages = [{ ops: [] }]
  let row = 0
  let pending = false
  const newPage = () => {
    pages.push({ ops: [] })
    row = 0
  }

  /** a から切れる最初の所（なければ最後まで） @param {Item} it @param {number} a */
  const firstCut = (it, a) => {
    for (let b = a + 1; b < it.n; b++) if (it.canCut && it.canCut(a, b)) return b
    return it.n
  }
  /** この部品を置き始めるのに要る行数（最初の塊） @param {Item} it */
  const headRows = (it) => {
    if (it.headRows === undefined) it.headRows = it.rowsOf(0, firstCut(it, 0))
    return it.headRows
  }
  /** i 番目から始まる塊が、見出しの直後に必ず同じ頁に要る行数 @param {number} i @returns {number} */
  const need = (i) => {
    const it = items[i]
    if (!it || it.kind === 'break') return 0
    if (it.keepNext) return it.rowsOf(0, 1) + need(i + 1)
    return headRows(it)
  }
  /** 入る一番大きい切り方（なければ -1） @param {Item} it @param {number} a @param {number} left @param {number} trim */
  const pick = (it, a, left, trim) => {
    let best = -1
    for (let b = a + 1; b <= it.n; b++) {
      if (it.rowsOf(a, b) - (a === 0 ? trim : 0) > left) break
      if (b === it.n || (it.canCut && it.canCut(a, b))) best = b
    }
    return best
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'break') {
      pending = true
      continue
    }
    if (pending) {
      if (row > 0) newPage()
      pending = false
    }
    if (it.keepNext && row > 0 && it.rowsOf(0, 1) + need(i + 1) > capacity - row) newPage()

    let a = 0
    while (a < it.n) {
      const trim = it.before && row === 0 ? it.before : 0
      let b = pick(it, a, capacity - row, trim)
      if (b < 0) {
        if (row > 0) {
          newPage()
          continue
        }
        b = firstCut(it, a)
        warn(env, '1 頁に入りきらない大きさの要素があったので、頁の下にはみ出します')
      }
      const used = it.rowsOf(a, b) - (a === 0 ? trim : 0)
      it.emit({ ops: pages[pages.length - 1].ops, y0: theme.top + row * theme.lineGap, row0: row, page: pages.length - 1, a, b, trim: a === 0 ? trim : 0 })
      row = Math.min(capacity, row + used)
      a = b
      if (a < it.n) newPage()
    }
  }
  return { pages, lastRows: row }
}

/**
 * 足: 版面の幅の細い罫と、右寄せの「author ／ title   n / N」。長い題は後ろを … で切る。
 * @param {Env} env
 * @param {{ title: string, author?: string }} doc
 * @param {number} index
 * @param {number} total
 * @returns {any[]}
 */
function footerOps(env, doc, index, total) {
  const theme = env.theme
  const f = theme.foot
  /** @type {any[]} */
  const ops = []
  const right = theme.left + theme.measure
  ops.push(ruleOp(theme.left, f.ruleY, right, f.ruleY, f.ruleW, theme.colors.rule))
  const st = { font: theme.fonts.gothic, size: f.size, color: f.color }
  const num = textLine(env, `${index + 1} / ${total}`, st)
  const numW = num ? num.width : 0
  const gap = 12
  if (num) for (const op of lineOps(env, num, right - numW, f.y)) ops.push(op)
  const full = doc.author ? `${doc.author} ${SLASH} ${doc.title}` : doc.title
  const maxW = theme.measure - numW - gap
  let line = textLine(env, full, st)
  if (line && line.width > maxW) {
    const chars = Array.from(full)
    let lo = 0
    let hi = chars.length
    /** @type {any} */
    let best = null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const cand = textLine(env, chars.slice(0, mid).join('') + ELLIPSIS, st)
      if (cand && cand.width <= maxW) { best = cand; lo = mid } else hi = mid - 1
    }
    line = best
  }
  if (line) for (const op of lineOps(env, line, right - numW - gap - line.width, f.y)) ops.push(op)
  return ops
}

/**
 * 使った書体（clip の中も）
 * @param {any[]} ops @param {Set<string>} out
 */
function collectFonts(ops, out) {
  for (const op of ops) {
    if (op.t === 'text') out.add(op.font)
    else if (op.t === 'clip') collectFonts(op.ops, out)
  }
}

/**
 * Doc を頁に組む。images は { [path]: { kind, base64, width, height } }（本体が読んで渡す）。phrase は文節の切れ目の関数。
 * @param {any} doc normalize の Doc
 * @param {{ metrics: Record<string, any>, theme: any, images?: Record<string, any>, phrase?: (text: string) => number[], now?: number }} o
 * @returns {any} Layout（設計書 3.1）
 */
export function layoutDoc(doc, { metrics, theme, images, phrase, now }) {
  const env = makeEnv({ theme, metrics, phrase, images })
  const when = now === undefined ? Date.now() : now

  /** @type {Item[]} */
  const items = [titleItem(env, doc, when)]
  for (const b of doc.blocks) {
    const it = blockItem(env, b)
    if (it) items.push(it)
  }
  const { pages, lastRows } = paginate(env, items)

  pages.forEach((pg, i) => {
    for (const op of footerOps(env, doc, i, pages.length)) pg.ops.push(op)
  })

  const used = new Set()
  for (const pg of pages) collectFonts(pg.ops, used)
  // 記入欄は sans で見た目を作る（本体が書体を読む対象に入れる）
  if (items.some((it) => it.kind === 'fields')) used.add('sans')
  const fonts = FONT_ORDER.filter((f) => used.has(f))

  const c = env.counts
  const lastPageFill = Math.min(1, lastRows / theme.lines)
  const warnings = [...env.warnings]
  if (c.underfull > 0) warnings.push(`字間を開けすぎないよう、行末を揃えなかった行が ${c.underfull} 行あります`)
  if (c.overfull > 0) warnings.push(`行からはみ出した所が ${c.overfull} 行あります（長い語や URL。行の幅を超えています）`)
  if (c.forced > 0) warnings.push(`禁則を守れず、字の途中で折った所が ${c.forced} 箇所あります`)
  const missing = [...env.missing]
  for (const ch of missing.slice(0, 10)) {
    warnings.push(`書体に無い字「${ch}」(U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()}) を「${String.fromCodePoint(0x3013)}」にしました`)
  }
  if (missing.length > 10) warnings.push(`書体に無い字がほかに ${missing.length - 10} 字あり、「${String.fromCodePoint(0x3013)}」にしました`)
  if (pages.length > 1 && lastPageFill < LAST_PAGE_FILL) warnings.push(`最後の頁が ${lastRows} 行だけです`)

  /** @type {any} */
  const meta = { title: doc.title, lang: doc.lang === 'en' ? 'en-US' : 'ja-JP', created: when }
  if (doc.author) meta.author = doc.author

  return {
    meta,
    page: { width: theme.page.width, height: theme.page.height },
    pages,
    tags: env.tags,
    outline: env.outline,
    fonts,
    warnings,
    stats: {
      lines: c.lines,
      justified: c.justified,
      maxSpread: c.maxSpread,
      runts: c.runts,
      kinsokuBreaks: c.forced,
      overfull: c.overfull,
      missingGlyphs: missing,
      lastPageFill,
    },
  }
}
