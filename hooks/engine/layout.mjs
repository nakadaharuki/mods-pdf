// @ts-check
// Doc を頁に組む（Display List を作る）。純な部品。
//
// 流れ: ブロックごとに「割れる単位（Item）」を作り（行を組み、行数を数える）、頁に流し込み（paginate）、足を付け、統計と警告をまとめる。
//
// 行の格子: 本文の行の基線は必ず theme.baseline(頁の中の行の番号)。見出し・表・図・要点・囲みの高さは行送りの整数倍に切り上げるので、
// 後ろの本文は次の格子の行に戻る。
//
// 選ばなかった案:
//   - 見出しの上の空き（theme.head の above 行）を頁の頭でも残す案: 改ページの直後に白が空き、頁が間延びする。
//     頁の頭では捨てる（before）。見出しの字の基線はどちらでも格子の上。
//   - 題名の直下の見出しにも above をそのまま取る案: 題名の塊の下に 2 行の穴があく。題名・見出しの直後は STACK_ABOVE 行までに詰める。
//   - 入らない図を、ただ次の頁へ送るだけにする案: 頁の下に 1/5 頁ほどの空きが残る（report の 2 頁目）。
//     図は次の頁の頭に浮かせ、前の頁の空きは直後の本文で埋める（floatFigure）。LaTeX の top float と同じ。
//   - 図の前へ出す物を、見出しの前まで・要点・記入欄まで広げる案: 節の見出しを越えると図と本文の対応が崩れる。
//     要点・記入欄・別の図・罫は原稿の位置に意味がある（図 1 と図 2 を入れ替えない）。本文・箇条書き・引用・囲み・表だけ越える。
//   - 浮かした分に合わせて tag の番号を並べ替える案: 読み上げの順（論理の順）は原稿のままにしたいので、番号は原稿の順で振り、
//     描く順だけを替える。PDF の構造の並びは render/tags.mjs が描いた順に揃えるので、論理の順を PDF にも通すには、
//     tags.mjs が Document の子を tag の番号順に並べる必要がある。
//   - 見出しを組んでから、直後の段落と一緒に置けるかを後で確かめて戻る案: 先に「見出しの行数 + 次の部品の最小の塊」を数えて、
//     入らなければ見出しごと次の頁へ。戻る処理（巻き戻し）が要らない。
//   - 最後の頁が少ない時に前の頁から行を送る案: 段落の割り方が連鎖して変わるので、警告に書くだけにした。
//   - 資料（deck）を doc の paginate に流して、slide を「改頁つきの部品の列」にする案: 資料は 1 枚 = 1 頁で、入らない時は次の頁へ流さず字を下げて落とす。
//     行の格子に乗る doc の部品とは頁の割り方が違うので、doc の組み（日本語の snapshot）に触れないよう、kind === 'deck' の時だけ lay-slide.mjs に渡す。

import { plainText } from './inline.mjs'
import { tableItem } from './table.mjs'
import { keysItem, cardItem, fieldsItem, figureItem } from './lay-blocks.mjs'
import { addTag, breakInlines, lineOps, makeEnv, rowsItem, ruleOp, textLine, toRows, topOf, warn, BASE_RATIO } from './lay-text.mjs'
import { laySlide } from './lay-slide.mjs'
import { figureOps } from './figure.mjs'

/** @typedef {any} Env */
/** @typedef {any} Item */

const FONT_ORDER = ['mincho', 'minchoBold', 'sans', 'sansBold']
/**
 * 見出しの罫は最後の行の基線の下に、見出しの字の大きさの 0.2 倍で引く。
 * 選ばなかった案: 行の下端から 1.4pt 上に引く案。直後の段落の 1 行目にルビがあると、ルビの頭が罫に触れた（本文 12.5pt では重なった）。
 */
const RULE_BELOW = 0.2
/**
 * 折り返す見出しの行どうしの間を、字の大きさのこの倍以上にする（行送りの整数倍に切り上げる）。
 * 選ばなかった案: 1.2 倍。15pt の h1 が 18pt を超えて本文の行送り 16.6pt の 2 行ぶん（33pt）あき、2 行が別々の見出しに見えた。
 * 1.1 倍なら 15pt の h1 は 1 行ぶん（leading 1.11）で収まる。本文 8〜9pt の紙では 1 行ぶんが足りず 2 行ぶんになる（重ならない方を取る）。
 */
const HEAD_LEADING = 1.1
/** 題名・その下の author と日付の行送りは、字の大きさに対する比 */
const TITLE_PITCH_RATIO = 1.4
const META_PITCH_RATIO = 12 / 9
/** 箇条書きの頭の印の幅（em） */
const MARK_EM = 1.5
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000)
const SLASH = String.fromCodePoint(0xff0f)
const ELLIPSIS = String.fromCodePoint(0x2026)
const LAST_PAGE_FILL = 0.15
/** 入らない図を次の頁へ送る時に、図より先に置いてよい部品の種類。見出し・要点・記入欄・改頁・別の図は越えない */
const FLOATS_PAST = new Set(['para', 'list', 'quote', 'card', 'table'])
/** 題名・見出しの直後に来る見出しの上の空き（行）の上限 */
const STACK_ABOVE = 1

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
  const TITLE_SIZE = theme.title.size
  const TITLE_PITCH = TITLE_SIZE * TITLE_PITCH_RATIO
  const META_SIZE = theme.title.metaSize
  const META_PITCH = META_SIZE * META_PITCH_RATIO
  const tag = addTag(env, 'H1', 0)
  const lines = breakInlines(env, [{ text: doc.title }], { font: theme.fonts.head, size: TITLE_SIZE, color: ink, tag }, { measure: W, align: 'left', phrase: true })
  const metaText = [doc.author, dateText(now)].filter(Boolean).join(IDEOGRAPHIC_SPACE)
  const metaTag = metaText ? addTag(env, 'P', 0) : undefined
  const meta = metaText ? textLine(env, metaText, { font: theme.fonts.gothic, size: META_SIZE, color: theme.colors.sub, tag: metaTag }) : null

  const padTop = 2
  const titleBottom = padTop + lines.length * TITLE_PITCH
  const ruleTop = titleBottom + 1
  const ruleBottom = ruleTop + theme.title.rule
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
      const ry = y0 + ruleTop + theme.title.rule / 2
      ops.push(ruleOp(theme.left, ry, theme.left + W, ry, theme.title.rule, ink))
      if (meta) {
        const base = y0 + metaTop + (META_PITCH - META_SIZE) / 2 + BASE_RATIO * META_SIZE
        for (const op of lineOps(env, meta, theme.left, base)) ops.push(op)
      }
    },
  }
}

/**
 * 見出し: 上に theme.head の above 行・下に below 行の空きを取り、字の基線は本体の最後の行の基線（格子の上）。
 * 折り返す見出しは、1 行ごとに ceil(大きさ × HEAD_LEADING / 行送り) 行ずつ下げる。
 * 題名の塊や見出しの直後の見出しは、空きを重ねない（STACK_ABOVE 行まで）。
 * @param {Env} env
 * @param {{ level: 1|2|3, text: any[] }} b
 * @param {string} [prev] 直前の部品の kind
 * @returns {Item | null}
 */
function headingItem(env, b, prev) {
  const theme = env.theme
  const lvl = b.level
  const hs = theme.head[`h${lvl}`]
  const tag = addTag(env, `H${lvl}`, 0)
  const lines = breakInlines(env, b.text, { font: hs.font, size: hs.size, color: theme.colors.ink, tag }, { measure: theme.measure, align: 'left', phrase: true })
  if (lines.length === 0) return null
  const pitch = Math.max(1, Math.ceil((hs.size * HEAD_LEADING) / theme.lineGap - 1e-9))
  const stacked = prev === 'title' || prev === 'heading'
  const before = stacked ? Math.min(hs.above, STACK_ABOVE) : hs.above
  const rows = before + 1 + hs.below + (lines.length - 1) * pitch
  const title = plainText(b.text)
  return {
    kind: 'heading', n: 1, rowsOf: () => rows, before, keepNext: true,
    emit: ({ ops, y0, row0, page, trim }) => {
      const eff = rows - trim
      const lastRow = row0 + eff - 1 - hs.below
      lines.forEach((ln, j) => {
        const base = theme.baseline(lastRow - (lines.length - 1 - j) * pitch)
        for (const op of lineOps(env, ln, theme.left, base)) ops.push(op)
        if (j === 0) env.outline.push({ title, level: lvl, page, y: topOf(base, hs.size) })
      })
      if (hs.rule > 0) {
        const y = theme.baseline(lastRow) + RULE_BELOW * hs.size
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
 * @param {string} [prev] 直前の部品の kind
 * @returns {Item | null}
 */
function blockItem(env, b, prev) {
  const theme = env.theme
  switch (b.type) {
    case 'heading': return headingItem(env, b, prev)
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

  /** 部品 it の a 番目以降を、頁の残りに入るだけ置き、残りは次の頁へ続ける @param {Item} it @param {number} [a0] */
  const place = (it, a0 = 0) => {
    let a = a0
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

  /**
   * 入らない図 items[i] を次の頁の頭へ送り、その前の空きを、直後の本文（図の前に出してよい種類だけ。見出しで止める）で埋める。
   * 埋めた分だけ図は原稿の順より後ろに描かれる（tag の番号は原稿の順のまま）。返すのは、ここまでで置き終えた最後の部品の番号。
   * @param {number} i @returns {number}
   */
  const floatFigure = (i) => {
    let end = i + 1
    while (end < items.length && FLOATS_PAST.has(items[end].kind)) end++
    let j = i + 1
    let a = 0
    while (j < end) {
      const f = items[j]
      const b = pick(f, a, capacity - row, 0)
      if (b < 0) break
      f.emit({ ops: pages[pages.length - 1].ops, y0: theme.top + row * theme.lineGap, row0: row, page: pages.length - 1, a, b, trim: 0 })
      row = Math.min(capacity, row + f.rowsOf(a, b))
      a = b
      if (a < f.n) break
      j++
      a = 0
    }
    place(items[i])
    if (j < end) {
      place(items[j], a)
      j++
    }
    return j - 1
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

    if (it.kind === 'figure' && row > 0 && it.rowsOf(0, 1) > capacity - row) i = floatFigure(i)
    else place(it)
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
 * 資料（kind: 'deck'）を頁に組む。1 枚 = 1 頁。tag・outline・warnings は枚ごとの結果をつなぐ。
 * 選ばなかった案: 枚ごとに Layout を作ってつなぐ案。tags の番号が枚をまたぐ（Document の子として通し番号）ので、ctx.tag は 1 つの配列に積む。
 * @param {any} doc
 * @param {{ metrics: Record<string, any>, theme: any, images?: Record<string, any>, phrase?: (text: string) => number[], now?: number, figure?: Function }} o
 * @returns {any}
 */
function layoutDeck(doc, { metrics, theme, images, phrase, now, figure }) {
  const when = now === undefined ? Date.now() : now
  const slides = Array.isArray(doc.slides) ? doc.slides : []
  /** @type {any[]} */
  const tags = [{ role: 'Document', parent: null }]
  const tag = (/** @type {string} */ role, /** @type {number|null} */ parent, /** @type {{ alt?: string, lang?: string }} */ extra) => {
    /** @type {any} */
    const t = { role, parent }
    if (extra && extra.alt) t.alt = extra.alt
    if (extra && extra.lang) t.lang = extra.lang
    tags.push(t)
    return tags.length - 1
  }
  /** @type {{ ops: any[] }[]} */
  const pages = []
  /** @type {any[]} */
  const outline = []
  /** @type {string[]} */
  const warnings = []
  const missing = new Set()
  const counts = { lines: 0, overfull: 0, underfull: 0, forced: 0, runts: 0 }
  let section = ''
  let sectionNo = 0
  let seenTop = false
  const date = dateText(when)
  slides.forEach((slide, i) => {
    if (slide && slide.layout === 'section') sectionNo++
    const ctx = { page: { width: theme.page.width, height: theme.page.height }, index: i, count: slides.length, theme, metrics, images: images ?? {}, phrase, lang: doc.lang === 'en' ? 'en' : 'ja', section, sectionNo, author: doc.author, date, tag, figure: figure ?? figureOps }
    const r = laySlide(slide, ctx)
    pages.push({ ops: r.ops })
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w)
    for (const ch of r.missing) missing.add(ch)
    counts.lines += r.counts.lines
    counts.overfull += r.counts.overfull
    counts.underfull += r.counts.underfull
    counts.forced += r.counts.forced
    for (const o of r.outline) {
      // しおりは 1 段目から始める（section も表紙も無い資料の最初の題は 1 段目にする）
      const level = o.level === 2 && !seenTop ? 1 : o.level
      if (level === 1) seenTop = true
      outline.push({ title: o.title, level, page: i, y: o.y })
    }
    if (slide && slide.layout === 'section') section = typeof slide.title === 'string' ? slide.title : ''
  })
  if (pages.length === 0) {
    pages.push({ ops: [] })
    warnings.push('資料に slides が 1 枚も無いので、空の頁を 1 枚だけ作りました')
  }
  const used = new Set()
  for (const pg of pages) collectFonts(pg.ops, used)
  const fonts = FONT_ORDER.filter((f) => used.has(f))
  for (const ch of [...missing].slice(0, 10)) {
    warnings.push(`書体に無い字「${ch}」(U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()}) を「${String.fromCodePoint(0x3013)}」にしました`)
  }
  if (missing.size > 10) warnings.push(`書体に無い字がほかに ${missing.size - 10} 字あり、「${String.fromCodePoint(0x3013)}」にしました`)
  /** @type {any} */
  const meta = { title: doc.title, lang: doc.lang === 'en' ? 'en-US' : 'ja-JP', created: when }
  if (doc.author) meta.author = doc.author
  return {
    meta,
    page: { width: theme.page.width, height: theme.page.height },
    pages,
    tags,
    outline,
    fonts,
    warnings,
    stats: { lines: counts.lines, justified: 0, maxSpread: 0, runts: 0, kinsokuBreaks: counts.forced, overfull: counts.overfull, missingGlyphs: [...missing], lastPageFill: 1 },
  }
}

/**
 * Doc を頁に組む。images は { [path]: { kind, base64, width, height } }（本体が読んで渡す）。phrase は文節の切れ目の関数。
 * @param {any} doc normalize の Doc
 * @param {{ metrics: Record<string, any>, theme: any, images?: Record<string, any>, phrase?: (text: string) => number[], now?: number, figure?: Function }} o figure は資料の図の入口（既定は figure.mjs の figureOps。試験で差し替える）
 * @returns {any} Layout（設計書 3.1）
 */
export function layoutDoc(doc, { metrics, theme, images, phrase, now, figure }) {
  if (doc.kind === 'deck') return layoutDeck(doc, { metrics, theme, images, phrase, now, figure })
  const env = makeEnv({ theme, metrics, phrase, images, lang: doc.lang })
  const when = now === undefined ? Date.now() : now

  /** @type {Item[]} */
  const items = [titleItem(env, doc, when)]
  for (const b of doc.blocks) {
    const it = blockItem(env, b, items[items.length - 1].kind)
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
