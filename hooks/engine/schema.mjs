// @ts-check
// 道具 make の引数（と Markdown）を Doc にする。純な部品。おかしい値は捨てて warnings に書き、投げるのは title が無い時だけ。
// 選ばなかった案: おかしい値で全体を断る案。Claude が書いた長い文書が 1 つの誤りで丸ごと失われるので、捨てて知らせる。

import { lex } from '../vendor/text.mjs'
import { parseInline, mergeInlines, isSafeUrl, plainText } from './inline.mjs'

/** inline.mjs の Inline と同じ形（型を取り込む構文は動的な読み込みの静的検査に当たりかねないので、写して書く） */
/** @typedef {{ text: string, bold?: true, ruby?: string, link?: string, code?: true }} Inline */
/** 2 段目を持つ項目。2 段目の項目は Inline[] だけ（3 段目以降は 2 段目に平らにする） */
/** @typedef {{ text: Inline[], items: Inline[][], ordered: boolean }} NestedItem */
/** @typedef {Inline[] | NestedItem} ListItem */
/** @typedef {{ label: string, value: string, note?: string }} KeyItem */
/** @typedef {{ kind: 'text'|'multiline'|'check'|'choice', name: string, label: string, value?: string|boolean, options?: string[], width?: number }} FieldItem */
/** @typedef {'left'|'right'|'center'} Align */
/**
 * @typedef {(
 *   { type: 'heading', level: 1|2|3, text: Inline[] }
 * | { type: 'para', text: Inline[] }
 * | { type: 'list', ordered: boolean, items: ListItem[] }
 * | { type: 'table', head: Inline[][], rows: Inline[][][], align?: Align[], widths?: number[] }
 * | { type: 'quote', text: Inline[] }
 * | { type: 'rule' }
 * | { type: 'pagebreak' }
 * | { type: 'keys', items: KeyItem[] }
 * | { type: 'card', label: string, text: Inline[] }
 * | { type: 'chart', option: Record<string, any>, height?: number, caption?: string }
 * | { type: 'svg', source: string, height?: number, caption?: string, alt: string }
 * | { type: 'image', path: string, width?: number, caption?: string, alt: string }
 * | { type: 'fields', items: FieldItem[] }
 * ) & { id?: string }} Block
 */
/** @typedef {{ title: string, author?: string, lang: 'ja'|'en', theme: 'mono'|'koma'|'mergeble', body: 'mincho'|'gothic', paper: 'A4'|'A5'|'B5'|'Letter', landscape: boolean, size?: number, blocks: Block[] }} Doc */
/** @typedef {{ warn: (msg: string) => void }} Ctx */

export const LIMITS = Object.freeze({
  markdown: 200000,
  blocks: 2000,
  tableRows: 500,
  tableCols: 12,
  /** Inline の列 1 つ（段落・見出し・セル・項目）の字数 */
  text: 20000,
  chartJson: 200000,
  title: 200,
  author: 100,
  /** ラベル・値・名前など短い字 */
  short: 200,
  caption: 400,
  note: 1000,
  /** SVG の字。仕様の外の上限（巨大な入力で組版が止まらないように） */
  svg: 500000,
  /** 要点（keys）を横に並べる数 */
  keysPerRow: 4,
  fieldItems: 200,
  options: 100,
})

const THEMES = /** @type {const} */ (['mono', 'koma', 'mergeble'])
const BODIES = /** @type {const} */ (['mincho', 'gothic'])
const PAPER_NAMES = /** @type {const} */ (['A4', 'A5', 'B5', 'Letter'])
const FIELD_KINDS = ['text', 'multiline', 'check', 'choice']

/** 小さい字に使う、見える印。バックスラッシュは逃がしの字なので数で作る */
const BACKSLASH = String.fromCodePoint(0x5c)
/** 逃がしで字そのものになる印（inline.mjs と同じ） */
const ESCAPABLE = '*{}[]`|'

const ENTITIES = /** @type {Record<string, string>} */ ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 同じ文言の warnings を 1 回だけ積む
 * @param {string[]} warnings
 * @param {string} [prefix]
 * @returns {Ctx}
 */
function makeCtx(warnings, prefix = '') {
  const seen = new Set()
  return {
    warn(msg) {
      const m = prefix + msg
      if (seen.has(m)) return
      seen.add(m)
      warnings.push(m)
    },
  }
}

// ---------------------------------------------------------------- 字の整え

/**
 * 全角・半角の幅が広い字か（改行を消すかの判断用）。East Asian Width の W と F の主な範囲。
 * @param {number} cp
 */
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

/**
 * @param {string} s
 * @param {number} off この位置の直前の字
 * @returns {number | undefined}
 */
function codePointBefore(s, off) {
  if (off <= 0) return undefined
  const c = s.charCodeAt(off - 1)
  if (c >= 0xdc00 && c <= 0xdfff && off >= 2) return s.codePointAt(off - 2)
  return c
}

/**
 * 字の整え: 改行は、前後のどちらかが和字なら消し（日本語の行を折っただけの改行に空白を入れない）、
 * 欧文どうしなら空白 1 つにする。タブは空白に。制御の字と見えない整形の字（ゼロ幅・双方向の制御）は消す。
 * 選ばなかった案: CSS のように「前後の両方が和字の時だけ消す」。「PDF\nを作る」のような和欧の折り返しに空白が入り、組版の和欧間に二重に空くので、片方でよい。
 * @param {string} s
 * @returns {string}
 */
export function cleanText(s) {
  let t = s.replace(/\r\n?/g, '\n')
  if (t.includes('\n')) {
    t = t.replace(/[ \t]*(?:\n[ \t]*)+/g, (m, off, whole) => {
      const before = codePointBefore(whole, off)
      const after = whole.codePointAt(off + m.length)
      if (before === undefined || after === undefined) return ''
      return isWide(before) || isWide(after) ? '' : ' '
    })
  }
  return t.replace(/\t/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '')
}

/**
 * 長さで切る。サロゲート対の途中では切らない
 * @param {string} s
 * @param {number} n
 */
function cutChars(s, n) {
  if (s.length <= n) return s
  let e = n
  const c = s.charCodeAt(e - 1)
  if (c >= 0xd800 && c <= 0xdbff) e--
  return s.slice(0, e)
}

/**
 * 短い字の項目（ラベル・値・名前）。字か数だけ受ける
 * @param {unknown} v
 * @param {number} max
 * @returns {string | undefined}
 */
function shortStr(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  return cutChars(cleanText(String(v)).trim(), max)
}

/** @param {unknown} v @returns {number | undefined} 0 より大きい有限の数だけ */
function positive(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** @param {unknown} id @returns {string | undefined} */
function cleanId(id) {
  if (typeof id !== 'string') return undefined
  const t = cleanText(id).trim()
  return t ? cutChars(t, 100) : undefined
}

/**
 * Inline の列の字数を上限で切る
 * @param {Inline[]} list
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {Inline[]}
 */
function capInline(list, ctx, where) {
  let total = 0
  /** @type {Inline[]} */
  const out = []
  for (const it of list) {
    const room = LIMITS.text - total
    if (room <= 0) {
      ctx.warn(`${where}: 字が ${LIMITS.text} を超えたので切った`)
      break
    }
    if (it.text.length > room) {
      const cut = cutChars(it.text, room)
      if (cut) out.push({ ...it, text: cut })
      ctx.warn(`${where}: 字が ${LIMITS.text} を超えたので切った`)
      break
    }
    out.push(it)
    total += it.text.length
  }
  return out
}

/**
 * 字・Inline・Inline の列のどれが来ても Inline の列にする。字は parseInline で印を読む。
 * Inline の形のものは字のまま（印を読み直さない）。
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {Inline[]}
 */
function coerceInline(v, ctx, where) {
  if (typeof v === 'string') return capInline(parseInline(cleanText(v)), ctx, where)
  const arr = isObj(v) ? [v] : v
  if (!Array.isArray(arr)) {
    if (v !== undefined && v !== null) ctx.warn(`${where}: 字でも Inline の列でもないので空にした`)
    return []
  }
  /** @type {Inline[]} */
  const out = []
  for (const el of arr) {
    if (typeof el === 'string') {
      out.push(...parseInline(cleanText(el)))
    } else if (isObj(el) && typeof el.text === 'string') {
      const text = cleanText(el.text)
      if (!text) continue
      /** @type {Inline} */
      const it = { text }
      if (el.bold === true) it.bold = true
      if (typeof el.ruby === 'string') {
        const ruby = cleanText(el.ruby)
        if (ruby) it.ruby = ruby
      }
      if (typeof el.link === 'string') {
        const url = el.link.trim()
        if (isSafeUrl(url)) it.link = url
        else ctx.warn(`${where}: リンク先が https:// http:// mailto: で始まらないのでリンクにしなかった`)
      }
      if (el.code === true) it.code = true
      out.push(it)
    } else if (el !== undefined && el !== null) {
      ctx.warn(`${where}: Inline の要素の形がおかしいので捨てた`)
    }
  }
  return capInline(mergeInlines(out), ctx, where)
}

// ---------------------------------------------------------------- Block の検査

/**
 * 記入欄の名前: 字・数字・_ - だけ。ほかは _ に。
 * 日本語の字も「字」として残す（氏名・住所のような欄を全部 _ にすると見分けが付かない）。選ばなかった案: ASCII だけ。
 * @param {string} s
 * @returns {string}
 */
function fieldNameOf(s) {
  const t = cutChars(cleanText(s).trim(), 100).replace(/[^\p{L}\p{N}_-]/gu, '_')
  return t || 'field'
}

/**
 * 記入欄の項目を検査する
 * @param {unknown} rawItems
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {FieldItem[]}
 */
function cleanFieldItems(rawItems, ctx, L) {
  if (!Array.isArray(rawItems)) {
    ctx.warn(`${L}: items が配列でない`)
    return []
  }
  if (rawItems.length > LIMITS.fieldItems) ctx.warn(`${L}: 欄が ${LIMITS.fieldItems} を超えたので切った`)
  /** @type {FieldItem[]} */
  const items = []
  rawItems.slice(0, LIMITS.fieldItems).forEach((f, k) => {
    const at = `${L}: items の ${k + 1} 個目`
    if (!isObj(f)) {
      ctx.warn(`${at}がオブジェクトでないので捨てた`)
      return
    }
    const kind = f.kind
    if (!FIELD_KINDS.includes(kind)) {
      ctx.warn(`${at}の kind（${String(kind).slice(0, 20)}）が text・multiline・check・choice のどれでもないので捨てた`)
      return
    }
    const rawName = typeof f.name === 'string' ? f.name : typeof f.label === 'string' ? f.label : 'field'
    const name = fieldNameOf(rawName)
    if (name !== rawName) ctx.warn(`${at}の name "${cutChars(rawName, 30)}" を "${cutChars(name, 30)}" にした`)
    const label = shortStr(f.label, LIMITS.short) || name
    /** @type {FieldItem} */
    const item = { kind, name, label }
    if (kind === 'check') {
      if (f.value !== undefined && typeof f.value !== 'boolean') ctx.warn(`${at}の check の value は真偽だけなので無視した`)
      if (f.value === true) item.value = true
      else if (f.value === false) item.value = false
    } else {
      const v = shortStr(f.value, LIMITS.text)
      if (v !== undefined && typeof f.value !== 'boolean') item.value = v
    }
    if (kind === 'choice') {
      const raw = Array.isArray(f.options) ? f.options : []
      const options = raw
        .slice(0, LIMITS.options)
        .map((o) => shortStr(o, LIMITS.short))
        .filter((o) => o !== undefined && o !== '')
      if (options.length === 0) {
        ctx.warn(`${at}は choice なのに options が無いので捨てた`)
        return
      }
      item.options = /** @type {string[]} */ (options)
      // pdf-lib の選び欄は、選べる物に無い値を選ぶと例外を投げる。ここで外しておく
      if (item.value !== undefined && !item.options.includes(/** @type {string} */ (item.value))) {
        ctx.warn(`${at}の value が options に無いので外した`)
        delete item.value
      }
    }
    if (f.width !== undefined) {
      const w = positive(f.width)
      if (w === undefined) ctx.warn(`${at}の width は 0 より大きい数だけなので無視した`)
      else item.width = w
    }
    items.push(item)
  })
  return items
}

/**
 * 箇条書きの項目 1 つを読む（字・Inline の列・{ text, items, ordered }）
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {{ text: Inline[], kids: unknown[], ordered: boolean | undefined } | null}
 */
function readListItem(raw, ctx, L) {
  if (typeof raw === 'string' || Array.isArray(raw)) {
    return { text: coerceInline(raw, ctx, L), kids: [], ordered: undefined }
  }
  if (isObj(raw)) {
    // items か Inline の列の text があれば入れ子の形。text が字だけで items が無ければ Inline 1 つ（字のまま）
    if (raw.items !== undefined || Array.isArray(raw.text)) {
      return {
        text: raw.text === undefined ? [] : coerceInline(raw.text, ctx, L),
        kids: Array.isArray(raw.items) ? raw.items : [],
        ordered: typeof raw.ordered === 'boolean' ? raw.ordered : undefined,
      }
    }
    if (typeof raw.text === 'string') return { text: coerceInline(raw, ctx, L), kids: [], ordered: undefined }
  }
  return null
}

/**
 * 箇条書きを検査する。入れ子は 2 段まで。
 * 選ばなかった案: 3 段目以降を捨てる。内容が消えるので 2 段目に並べ直す。
 * @param {unknown} rawItems
 * @param {boolean} ordered
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {ListItem[]}
 */
function cleanListItems(rawItems, ordered, ctx, L) {
  if (!Array.isArray(rawItems)) {
    ctx.warn(`${L}: items が配列でない`)
    return []
  }
  let flattened = false
  /** @type {ListItem[]} */
  const out = []
  /**
   * 2 段目の列に、2 段目の項目と、その下の 3 段目以降を前から順に平らに入れる
   * @param {unknown[]} kids
   * @param {Inline[][]} into
   */
  const collect = (kids, into) => {
    for (const k of kids) {
      const it = readListItem(k, ctx, L)
      if (!it) continue
      if (it.text.length) into.push(it.text)
      if (it.kids.length) {
        flattened = true
        collect(it.kids, into)
      }
    }
  }
  for (const raw of rawItems) {
    const it = readListItem(raw, ctx, L)
    if (!it) continue
    /** @type {Inline[][]} */
    const kids = []
    collect(it.kids, kids)
    if (kids.length) out.push({ text: it.text, items: kids, ordered: it.ordered ?? ordered })
    else if (it.text.length) out.push(it.text)
  }
  if (flattened) ctx.warn(`${L}: 箇条書きの 3 段目以降は 2 段目に平らにした`)
  return out
}

/**
 * 表を検査する。頭の行が無ければ 1 行目を頭にする（表は必ず頭の行を持つ）
 * @param {Record<string, any>} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {Block[]}
 */
function cleanTable(raw, ctx, L) {
  let headRaw = Array.isArray(raw.head) ? raw.head : []
  let rowsRaw = (Array.isArray(raw.rows) ? raw.rows : []).filter((r) => {
    if (Array.isArray(r)) return true
    ctx.warn(`${L}: rows の中に配列でない行があったので捨てた`)
    return false
  })
  if (headRaw.length === 0) {
    if (rowsRaw.length === 0) {
      ctx.warn(`${L}: 頭の行も行も無いので捨てた`)
      return []
    }
    headRaw = rowsRaw[0]
    rowsRaw = rowsRaw.slice(1)
    ctx.warn(`${L}: head が無いので 1 行目を頭の行にした`)
  }
  if (headRaw.length > LIMITS.tableCols) {
    ctx.warn(`${L}: 列が ${LIMITS.tableCols} を超えたので切った`)
    headRaw = headRaw.slice(0, LIMITS.tableCols)
  }
  if (rowsRaw.length > LIMITS.tableRows) {
    ctx.warn(`${L}: 行が ${LIMITS.tableRows} を超えたので切った`)
    rowsRaw = rowsRaw.slice(0, LIMITS.tableRows)
  }
  const cols = headRaw.length
  const head = headRaw.map((c) => coerceInline(c, ctx, L))
  let ragged = false
  const rows = rowsRaw.map((r) => {
    if (r.length !== cols) ragged = true
    /** @type {Inline[][]} */
    const cells = []
    for (let c = 0; c < cols; c++) cells.push(coerceInline(r[c], ctx, L))
    return cells
  })
  if (ragged) ctx.warn(`${L}: 頭の行と列の数が違う行があったので、足りない所は空に、余りは切った`)
  /** @type {Block} */
  const table = { type: 'table', head, rows }
  if (Array.isArray(raw.align)) {
    /** @type {Align[]} */
    const align = []
    for (let c = 0; c < cols; c++) {
      const a = raw.align[c]
      align.push(a === 'right' || a === 'center' ? a : 'left')
    }
    table.align = align
  }
  if (raw.widths !== undefined) {
    const w = raw.widths
    if (Array.isArray(w) && w.length === cols && w.every((x) => positive(x) !== undefined)) {
      const sum = w.reduce((a, b) => a + b, 0)
      table.widths = w.map((x) => x / sum)
    } else {
      ctx.warn(`${L}: widths は列の数と同じ個数の正の数だけなので無視した`)
    }
  }
  return [table]
}

/**
 * ECharts の option を JSON の素の物にする（字でも受ける）
 * @param {unknown} opt
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {Record<string, any> | null}
 */
function cleanChartOption(opt, ctx, L) {
  let v = opt
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      ctx.warn(`${L}: option の JSON が壊れているので捨てた`)
      return null
    }
  }
  if (!isObj(v)) {
    ctx.warn(`${L}: option がオブジェクトでないので捨てた`)
    return null
  }
  let json
  try {
    json = JSON.stringify(v)
  } catch {
    ctx.warn(`${L}: option を JSON にできないので捨てた`)
    return null
  }
  if (json === undefined || json.length > LIMITS.chartJson) {
    ctx.warn(`${L}: option が JSON で ${LIMITS.chartJson} 字を超えるので捨てた`)
    return null
  }
  return JSON.parse(json)
}

/**
 * Block を 1 つ検査して整える。要点が 4 個を超えれば複数の Block になり、捨てれば空の列。
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} label  「blocks の 3 個目」のような場所の字
 * @returns {Block[]}
 */
function cleanBlock(raw, ctx, label) {
  if (!isObj(raw)) {
    ctx.warn(`${label}: オブジェクトでないので捨てた`)
    return []
  }
  const type = raw.type
  const L = `${label}（${String(type).slice(0, 20)}）`
  const id = cleanId(raw.id)
  /** @param {Block[]} list */
  const withId = (list) => {
    if (id && list.length) list[0].id = id
    return list
  }
  switch (type) {
    case 'heading': {
      let level = raw.level
      if (typeof level !== 'number' || !Number.isFinite(level)) {
        ctx.warn(`${L}: level が数でないので 2 にした`)
        level = 2
      }
      const lv = /** @type {1|2|3} */ (Math.min(3, Math.max(1, Math.round(level))))
      const text = coerceInline(raw.text, ctx, L)
      if (!text.length) {
        ctx.warn(`${L}: 字が空なので捨てた`)
        return []
      }
      return withId([{ type: 'heading', level: lv, text }])
    }
    case 'para':
    case 'quote': {
      const text = coerceInline(raw.text, ctx, L)
      if (!text.length) {
        ctx.warn(`${L}: 字が空なので捨てた`)
        return []
      }
      return withId([{ type, text }])
    }
    case 'list': {
      const ordered = raw.ordered === true
      const items = cleanListItems(raw.items, ordered, ctx, L)
      if (!items.length) {
        ctx.warn(`${L}: 項目が無いので捨てた`)
        return []
      }
      return withId([{ type: 'list', ordered, items }])
    }
    case 'table':
      return withId(cleanTable(raw, ctx, L))
    case 'rule':
    case 'pagebreak':
      return withId([{ type }])
    case 'keys': {
      if (!Array.isArray(raw.items)) {
        ctx.warn(`${L}: items が配列でない`)
        return []
      }
      /** @type {KeyItem[]} */
      const items = []
      for (const k of raw.items) {
        if (!isObj(k)) continue
        const lab = shortStr(k.label, LIMITS.short) ?? ''
        const value = shortStr(k.value, LIMITS.short) ?? ''
        if (!lab && !value) continue
        /** @type {KeyItem} */
        const it = { label: lab, value }
        const note = shortStr(k.note, LIMITS.note)
        if (note) it.note = note
        items.push(it)
      }
      if (!items.length) {
        ctx.warn(`${L}: 要点が無いので捨てた`)
        return []
      }
      // 横に並べるのは 4 個まで。5 個以上は偏らないように割って複数の keys にする
      const rows = Math.ceil(items.length / LIMITS.keysPerRow)
      const per = Math.ceil(items.length / rows)
      /** @type {Block[]} */
      const blocks = []
      for (let k = 0; k < items.length; k += per) blocks.push({ type: 'keys', items: items.slice(k, k + per) })
      if (rows > 1) ctx.warn(`${L}: 要点が ${LIMITS.keysPerRow} 個を超えたので ${rows} つの keys に割った`)
      return withId(blocks)
    }
    case 'card': {
      const text = coerceInline(raw.text, ctx, L)
      const lab = shortStr(raw.label, LIMITS.short) ?? ''
      if (!text.length) {
        ctx.warn(`${L}: 字が空なので捨てた`)
        return []
      }
      return withId([{ type: 'card', label: lab, text }])
    }
    case 'chart': {
      const option = cleanChartOption(raw.option, ctx, L)
      if (!option) return []
      /** @type {Block} */
      const b = { type: 'chart', option }
      applyFigure(b, raw, ctx, L)
      return withId([b])
    }
    case 'svg': {
      if (typeof raw.source !== 'string' || !/<svg[\s>/]/i.test(raw.source)) {
        ctx.warn(`${L}: source に <svg> が無いので捨てた`)
        return []
      }
      if (raw.source.length > LIMITS.svg) {
        ctx.warn(`${L}: source が ${LIMITS.svg} 字を超えるので捨てた`)
        return []
      }
      const alt = shortStr(raw.alt, LIMITS.caption) || svgTitle(raw.source) || '図'
      /** @type {Block} */
      const b = { type: 'svg', source: raw.source, alt }
      applyFigure(b, raw, ctx, L)
      return withId([b])
    }
    case 'image': {
      const path = typeof raw.path === 'string' ? cleanText(raw.path).trim() : ''
      if (!path || path.length > 500) {
        ctx.warn(`${L}: path が字でないか長すぎるので捨てた`)
        return []
      }
      let alt = shortStr(raw.alt, LIMITS.caption)
      if (!alt) {
        alt = shortStr(raw.caption, LIMITS.caption) || '図'
        ctx.warn(`${L}: alt が無いので「${alt}」にした`)
      }
      /** @type {Block} */
      const b = { type: 'image', path, alt }
      if (raw.width !== undefined) {
        const w = positive(raw.width)
        if (w === undefined) ctx.warn(`${L}: width は 0 より大きい数だけなので無視した`)
        else b.width = w
      }
      const caption = shortStr(raw.caption, LIMITS.caption)
      if (caption) b.caption = caption
      return withId([b])
    }
    case 'fields': {
      const items = cleanFieldItems(raw.items, ctx, L)
      if (!items.length) {
        ctx.warn(`${L}: 欄が無いので捨てた`)
        return []
      }
      return withId([{ type: 'fields', items }])
    }
    default:
      ctx.warn(`${label}: type "${String(type).slice(0, 20)}" は知らないので捨てた`)
      return []
  }
}

/**
 * chart・svg の height と caption
 * @param {any} block
 * @param {Record<string, any>} raw
 * @param {Ctx} ctx
 * @param {string} L
 */
function applyFigure(block, raw, ctx, L) {
  if (raw.height !== undefined) {
    const h = positive(raw.height)
    if (h === undefined) ctx.warn(`${L}: height は 0 より大きい数だけなので無視した`)
    else block.height = h
  }
  const caption = shortStr(raw.caption, LIMITS.caption)
  if (caption) block.caption = caption
}

/** @param {string} svg 最初の title の字（読み上げ用） */
function svgTitle(svg) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(svg)
  if (!m) return ''
  return cutChars(cleanText(htmlToText(m[1])).trim(), LIMITS.caption)
}

/**
 * 記入欄の name を文書全体で一意にする（PDF の欄は名前で束ねられる）。先に来た方が名前を取る
 * @param {Block[]} blocks
 * @param {Ctx} ctx
 */
function dedupeFieldNames(blocks, ctx) {
  const used = new Set()
  for (const b of blocks) {
    if (b.type !== 'fields') continue
    for (const f of b.items) {
      if (!used.has(f.name)) {
        used.add(f.name)
        continue
      }
      let n = 2
      while (used.has(`${f.name}_${n}`)) n++
      const renamed = `${f.name}_${n}`
      ctx.warn(`fields の name "${cutChars(f.name, 30)}" が重複したので "${cutChars(renamed, 30)}" にした`)
      f.name = renamed
      used.add(renamed)
    }
  }
}

// ---------------------------------------------------------------- Markdown

/** @param {string} s */
function unescapeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
}

/**
 * HTML の塊から字だけを取る。コメントと script・style の中身は字にしない。
 * @param {string} html
 */
function htmlToText(html) {
  let t = removeRanges(html, /<!--/g, /-->/g)
  t = removeRanges(t, /<script\b/gi, /<\/script\s*>/gi)
  t = removeRanges(t, /<style\b/gi, /<\/style\s*>/gi)
  t = t.replace(/<br\s*\/?>/gi, '\n')
  // [^<>]* にして、閉じない < が並んでも 2 乗に遅くならない
  t = t.replace(/<\/?[A-Za-z][^<>]*>/g, '')
  return unescapeEntities(t)
}

/**
 * 開きから閉じまでを消す。閉じが無ければ末尾まで消す（ブラウザの読み方と同じ）。
 * 選ばなかった案: 遅延量指定子の 1 つの正規表現。閉じの無い開きが並ぶと、開きごとに末尾まで探して 2 乗になる。
 * @param {string} s
 * @param {RegExp} open g フラグ付き
 * @param {RegExp} close g フラグ付き
 */
function removeRanges(s, open, close) {
  let out = ''
  let at = 0
  for (;;) {
    open.lastIndex = at
    const a = open.exec(s)
    if (!a) return out + s.slice(at)
    out += s.slice(at, a.index)
    close.lastIndex = a.index + a[0].length
    const b = close.exec(s)
    if (!b) return out
    at = b.index + b[0].length
  }
}

/**
 * marked の inline token を、parseInline が読める元の字に戻す。
 * marked の token の text は逃がしが消えてしまう（\{ が { になる）ので、raw から作り直す。
 * 太字は ** のまま、斜体・取り消し線の印は消す（Inline に無い）、リンクは安全な先だけ残す。
 * @param {any[] | undefined} tokens
 * @returns {string}
 */
function inlineSource(tokens) {
  let s = ''
  for (const t of tokens ?? []) s += tokenSource(t)
  return s
}

/** @param {any} t @returns {string} */
function tokenSource(t) {
  switch (t.type) {
    case 'text':
      return t.tokens?.length ? inlineSource(t.tokens) : unescapeEntities(t.raw ?? t.text ?? '')
    case 'escape': {
      const ch = String(t.text ?? '')
      return ESCAPABLE.includes(ch) ? BACKSLASH + ch : ch
    }
    case 'codespan': {
      const c = unescapeEntities(String(t.text ?? ''))
      return !c || c.includes('`') ? c : '`' + c + '`'
    }
    case 'strong': {
      const inner = inlineSource(t.tokens)
      return inner.trim() ? '**' + inner + '**' : inner
    }
    case 'em':
    case 'del':
      return inlineSource(t.tokens)
    case 'link': {
      const href = String(t.href ?? '')
      const inner = inlineSource(t.tokens) || unescapeEntities(String(t.text ?? ''))
      if (!isSafeUrl(href)) return inner
      const enc = href.replace(/[\s()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
      return `[${inner || href}](${enc})`
    }
    case 'image':
      return unescapeEntities(String(t.text ?? ''))
    case 'br':
      return ' '
    case 'html':
      return /^<br\s*\/?>$/i.test(String(t.text ?? t.raw ?? '').trim()) ? ' ' : ''
    case 'checkbox':
      // ☑ ☐ は JIS の字ではなく書体に無いことがあるので、JIS X 0208 の四角を使う
      return t.checked ? '■ ' : '□ '
    default:
      return unescapeEntities(String(t.raw ?? t.text ?? ''))
  }
}

/**
 * 1 行ずつ本文の書体の段落にする（コードの囲みを等幅にしない決まり）。
 * 字のまま使うので Inline の形で渡し、** などの印を読ませない。
 * @param {string} text
 * @returns {Record<string, any>[]}
 */
function literalParas(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l)
    .map((l) => ({ type: 'para', text: [{ text: l }] }))
}

/**
 * 囲みの言語名から、JSON を Block の候補にする
 * @param {string} lang
 * @param {unknown} v
 * @returns {Record<string, any> | null}
 */
function fenceCandidate(lang, v) {
  switch (lang) {
    case 'chart':
      if (isObj(v) && isObj(v.option)) return { type: 'chart', option: v.option, height: v.height, caption: v.caption, id: v.id }
      return { type: 'chart', option: v }
    case 'keys':
      if (Array.isArray(v)) return { type: 'keys', items: v }
      return isObj(v) ? { type: 'keys', items: v.items, id: v.id } : null
    case 'fields':
      if (Array.isArray(v)) return { type: 'fields', items: v }
      return isObj(v) ? { type: 'fields', items: v.items, id: v.id } : null
    case 'card':
      return isObj(v) ? { type: 'card', label: v.label, text: v.text, id: v.id } : null
    default:
      return null
  }
}

/**
 * 箇条書きの項目 1 つを { text, items, ordered } の候補にする（字は parseInline の前の元の字のまま）
 * @param {any} li
 * @param {boolean} ordered
 * @param {Ctx} ctx
 * @returns {Record<string, any>}
 */
function listItemCandidate(li, ordered, ctx) {
  /** @type {string[]} */
  const texts = []
  /** @type {Record<string, any>[]} */
  const kids = []
  let kidOrdered
  // 詰めた箇条書きのタスクの印は、字の token と別の token で来る
  let mark = ''
  for (const t of li.tokens ?? []) {
    switch (t.type) {
      case 'checkbox':
        mark = tokenSource(t)
        break
      case 'text':
      case 'paragraph':
        texts.push(mark + (t.tokens?.length ? inlineSource(t.tokens) : unescapeEntities(String(t.text ?? ''))))
        mark = ''
        break
      case 'list':
        if (kidOrdered === undefined) kidOrdered = !!t.ordered
        for (const sub of t.items ?? []) kids.push(listItemCandidate(sub, !!t.ordered, ctx))
        break
      case 'space':
        break
      case 'code':
        texts.push(String(t.text ?? ''))
        ctx.warn('箇条書きの中の囲み・引用・表などは字だけにした')
        break
      default:
        texts.push(plainOfToken(t))
        ctx.warn('箇条書きの中の囲み・引用・表などは字だけにした')
    }
  }
  return { text: texts.join('\n'), items: kids, ordered: kidOrdered ?? ordered }
}

/**
 * ブロックの token から字だけを取る（引用・箇条書きの中の見慣れない物の代わり）
 * @param {any} t
 * @returns {string}
 */
function plainOfToken(t) {
  switch (t.type) {
    case 'paragraph':
    case 'heading':
    case 'text':
      return t.tokens?.length ? inlineSource(t.tokens) : unescapeEntities(String(t.text ?? ''))
    case 'code':
      return String(t.text ?? '')
    case 'html':
      return htmlToText(String(t.text ?? t.raw ?? ''))
    case 'blockquote':
      return (t.tokens ?? []).map(plainOfToken).filter((x) => x).join('\n')
    case 'list':
      return (t.items ?? []).map((/** @type {any} */ li) => (li.tokens ?? []).map(plainOfToken).filter((/** @type {string} */ x) => x).join('\n')).join('\n')
    case 'table':
      return [t.header, ...(t.rows ?? [])]
        .map((/** @type {any[]} */ row) => Array.from(row ?? []).map((c) => inlineSource(c.tokens)).join(' '))
        .join('\n')
    default:
      return ''
  }
}

const IMAGE_PATH = /\.(?:png|jpe?g)$/i
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

/**
 * Markdown を Block の列にする本体
 * @param {string} md
 * @param {Ctx} ctx
 * @returns {Block[]}
 */
function markdownToBlocks(md, ctx) {
  /** @type {any[]} */
  let tokens
  try {
    tokens = lex(md)
  } catch {
    ctx.warn('Markdown を読めなかったので、改行で分けた段落にした')
    tokens = md.split(/\n{2,}/).map((p) => ({ type: 'paragraph', text: p, tokens: [{ type: 'text', raw: p, text: p }] }))
  }
  /** @type {Block[]} */
  const out = []
  let deepHeadings = 0
  /**
   * @param {Record<string, any>} cand
   * @param {string} label
   */
  const push = (cand, label) => {
    out.push(...cleanBlock(cand, ctx, label))
  }
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space':
      case 'def':
        break
      case 'heading': {
        if (tok.depth > 3) deepHeadings++
        push({ type: 'heading', level: tok.depth, text: inlineSource(tok.tokens) }, 'Markdown の見出し')
        break
      }
      case 'paragraph': {
        const src = inlineSource(tok.tokens).trim()
        if (src === BACKSLASH + 'pagebreak') {
          out.push({ type: 'pagebreak' })
          break
        }
        const sole = (tok.tokens ?? []).filter((/** @type {any} */ t) => !(t.type === 'text' && !String(t.raw ?? t.text ?? '').trim()))
        if (sole.length === 1 && sole[0].type === 'image') {
          const img = sole[0]
          let path = String(img.href ?? '')
          try {
            path = decodeURI(path)
          } catch {
            // 壊れた % はそのまま
          }
          if (IMAGE_PATH.test(path) && !HAS_SCHEME.test(path) && !path.startsWith('//')) {
            push({ type: 'image', path, alt: unescapeEntities(String(img.text ?? '')) || '図', caption: img.title || undefined }, 'Markdown の画像')
            break
          }
          ctx.warn('Markdown の画像は、作業フォルダーの中の png・jpg の相対パスだけ使える。字にした')
        }
        push({ type: 'para', text: src }, 'Markdown の段落')
        break
      }
      case 'list': {
        const ordered = !!tok.ordered
        push({ type: 'list', ordered, items: (tok.items ?? []).map((/** @type {any} */ li) => listItemCandidate(li, ordered, ctx)) }, 'Markdown の箇条書き')
        break
      }
      case 'table': {
        const header = Array.from(tok.header ?? [])
        const aligns = tok.align ?? []
        const anyAlign = aligns.some((/** @type {any} */ a) => a)
        push(
          {
            type: 'table',
            head: header.map((/** @type {any} */ c) => inlineSource(c.tokens)),
            rows: (tok.rows ?? []).map((/** @type {any} */ r) => Array.from(r).map((/** @type {any} */ c) => inlineSource(c.tokens))),
            align: anyAlign ? aligns.map((/** @type {any} */ a) => a ?? 'left') : undefined,
          },
          'Markdown の表',
        )
        break
      }
      case 'blockquote': {
        const parts = (tok.tokens ?? []).map(plainOfToken).filter((/** @type {string} */ x) => x.trim())
        push({ type: 'quote', text: parts.join('\n') }, 'Markdown の引用')
        break
      }
      case 'hr':
        out.push({ type: 'rule' })
        break
      case 'code': {
        const lang = String(tok.lang ?? '').trim().split(/\s+/)[0].toLowerCase()
        const text = String(tok.text ?? '')
        if (lang === 'svg') {
          push({ type: 'svg', source: text, alt: svgTitle(text) || '図' }, 'Markdown の ```svg')
          break
        }
        if (lang === 'chart' || lang === 'keys' || lang === 'card' || lang === 'fields') {
          const label = `Markdown の \`\`\`${lang}`
          let v
          try {
            v = JSON.parse(text)
          } catch {
            ctx.warn(`${label}: JSON が壊れているので段落にした`)
            for (const p of literalParas(text)) push(p, 'Markdown の段落')
            break
          }
          const cand = fenceCandidate(lang, v)
          const made = cand ? cleanBlock(cand, ctx, label) : []
          if (made.length) {
            out.push(...made)
          } else {
            ctx.warn(`${label}: 中身の形がおかしいので段落にした`)
            for (const p of literalParas(text)) push(p, 'Markdown の段落')
          }
          break
        }
        for (const p of literalParas(text)) push(p, 'Markdown の段落')
        break
      }
      case 'html': {
        const raw = String(tok.text ?? tok.raw ?? '')
        if (/^<!--\s*pagebreak\s*-->$/i.test(raw.trim())) {
          out.push({ type: 'pagebreak' })
          break
        }
        const text = cleanText(htmlToText(raw)).trim()
        if (text) push({ type: 'para', text: [{ text }] }, 'Markdown の HTML')
        break
      }
      default: {
        const raw = String(tok.raw ?? '').trim()
        if (raw) {
          ctx.warn(`Markdown の ${String(tok.type).slice(0, 20)} は未対応なので字にした`)
          push({ type: 'para', text: [{ text: raw }] }, 'Markdown の段落')
        }
      }
    }
  }
  if (deepHeadings) ctx.warn(`見出しの深さ 4 以上は 3 にした（${deepHeadings} 個）`)
  return out
}

/**
 * Markdown（marked の lexer。vendor/text.mjs）を Block の列に。
 * 字の中の印は parseInline で読む（marked の逃がしは使わず、元の字から読み直す）。
 * @param {string} md
 * @returns {{ blocks: Block[], warnings: string[] }}
 */
export function fromMarkdown(md) {
  /** @type {string[]} */
  const warnings = []
  const ctx = makeCtx(warnings)
  const blocks = markdownToBlocks(String(md ?? ''), ctx)
  dedupeFieldNames(blocks, ctx)
  return { blocks, warnings }
}

// ---------------------------------------------------------------- normalize

/**
 * 選び値を許す物に直す。大文字小文字は問わない
 * @template {string} T
 * @param {unknown} v
 * @param {readonly T[]} allowed
 * @param {T} dflt
 * @param {string} name
 * @param {Ctx} ctx
 * @returns {T}
 */
function pick(v, allowed, dflt, name, ctx) {
  if (v === undefined || v === null) return dflt
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    const hit = allowed.find((a) => a.toLowerCase() === t)
    if (hit) return hit
  }
  ctx.warn(`${name} が "${String(v).slice(0, 30)}" で使えないので ${dflt} にした（使えるのは ${allowed.join('・')}）`)
  return dflt
}

/**
 * Block の plain な字（見出しと題名の比べ合わせ用）
 * @param {Block} b
 */
function headingKey(b) {
  return b.type === 'heading' ? plainText(b.text).normalize('NFKC').replace(/\s+/g, ' ').trim() : ''
}

/**
 * 道具 make の引数を検査し Doc にする。おかしい値は捨てて warnings に書く（投げるのは title が無い時だけ）。
 * @param {unknown} input
 * @returns {{ doc: Doc, warnings: string[] }}
 */
export function normalize(input) {
  /** @type {string[]} */
  const warnings = []
  const ctx = makeCtx(warnings)
  if (!isObj(input)) throw new Error('make の引数がオブジェクトではありません')
  if (typeof input.title !== 'string') throw new Error('title が必要です（空でない字）')
  let title = cleanText(input.title).replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('title が必要です（空でない字）')
  if (title.length > LIMITS.title) {
    title = cutChars(title, LIMITS.title)
    ctx.warn(`title が ${LIMITS.title} 字を超えたので切った`)
  }

  /** @type {Doc['lang']} */
  let lang = 'ja'
  if (input.lang !== undefined && input.lang !== null) {
    const l = typeof input.lang === 'string' ? input.lang.trim().toLowerCase() : ''
    if (l.startsWith('ja')) lang = 'ja'
    else if (l.startsWith('en')) lang = 'en'
    else ctx.warn(`lang が "${String(input.lang).slice(0, 30)}" で使えないので ja にした（使えるのは ja・en）`)
  }
  const theme = pick(input.theme, THEMES, 'mono', 'theme', ctx)
  const body = pick(input.body, BODIES, 'mincho', 'body', ctx)
  const paper = pick(input.paper, PAPER_NAMES, 'A4', 'paper', ctx)
  let landscape = false
  if (input.landscape !== undefined && input.landscape !== null) {
    if (typeof input.landscape === 'boolean') landscape = input.landscape
    else ctx.warn('landscape は真偽だけなので false にした')
  }
  /** @type {number | undefined} */
  let size
  if (input.size !== undefined && input.size !== null) {
    if (typeof input.size === 'number' && Number.isFinite(input.size)) {
      size = Math.min(14, Math.max(8, input.size))
      if (size !== input.size) ctx.warn(`size は 8〜14 の数だけなので ${size} にした`)
    } else {
      ctx.warn('size は数だけなので無視した')
    }
  }
  /** @type {string | undefined} */
  let author
  if (input.author !== undefined && input.author !== null) {
    if (typeof input.author === 'string') {
      const a = cleanText(input.author).replace(/\s+/g, ' ').trim()
      if (a.length > LIMITS.author) ctx.warn(`author が ${LIMITS.author} 字を超えたので切った`)
      if (a) author = cutChars(a, LIMITS.author)
    } else {
      ctx.warn('author は字だけなので無視した')
    }
  }

  /** @type {Block[]} */
  let blocks = []
  let any = false
  if (input.markdown !== undefined && input.markdown !== null) {
    if (typeof input.markdown === 'string') {
      any = true
      let md = input.markdown
      if (md.length > LIMITS.markdown) {
        md = cutChars(md, LIMITS.markdown)
        ctx.warn(`markdown が ${LIMITS.markdown} 字を超えたので切った`)
      }
      blocks.push(...markdownToBlocks(md, ctx))
    } else {
      ctx.warn('markdown は字だけなので無視した')
    }
  }
  /** @type {unknown} */
  let rawBlocks = input.blocks
  if (typeof rawBlocks === 'string') {
    // 配列が JSON の字になって届く道具がある
    try {
      rawBlocks = JSON.parse(rawBlocks)
    } catch {
      ctx.warn('blocks が配列でなく、JSON としても読めないので無視した')
      rawBlocks = undefined
    }
  }
  if (rawBlocks !== undefined && rawBlocks !== null) {
    if (Array.isArray(rawBlocks)) {
      any = true
      rawBlocks.forEach((b, k) => {
        blocks.push(...cleanBlock(b, ctx, `blocks の ${k + 1} 個目`))
      })
    } else {
      ctx.warn('blocks は配列だけなので無視した')
    }
  }
  if (!any) ctx.warn('markdown も blocks も無いので空の文書にした')

  if (blocks.length > LIMITS.blocks) {
    ctx.warn(`Block が ${LIMITS.blocks} 個を超えたので切った`)
    blocks = blocks.slice(0, LIMITS.blocks)
  }
  dedupeFieldNames(blocks, ctx)

  // 題名の塊は layout が title から作る。本文の頭の同じ見出しは二重になるので消す
  if (blocks.length && blocks[0].type === 'heading' && blocks[0].level === 1 && headingKey(blocks[0]) === title.normalize('NFKC')) {
    blocks = blocks.slice(1)
  }
  // 頭・末の改ページと、続く改ページは白い頁になるだけなので 1 つにまとめる
  /** @type {Block[]} */
  const tidy = []
  for (const b of blocks) {
    if (b.type === 'pagebreak' && (tidy.length === 0 || tidy[tidy.length - 1].type === 'pagebreak')) continue
    tidy.push(b)
  }
  while (tidy.length && tidy[tidy.length - 1].type === 'pagebreak') tidy.pop()
  if (any && tidy.length === 0) ctx.warn('本文が空になった（中身が全部捨てられたか、題名の見出しだけだった）')

  /** @type {Doc} */
  const doc = { title, lang, theme, body, paper, landscape, blocks: tidy }
  if (author) doc.author = author
  if (size !== undefined) doc.size = size
  return { doc, warnings }
}
