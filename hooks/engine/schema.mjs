// @ts-check
// 道具 make の引数（と Markdown）を Doc にする。純な部品。おかしい値は捨てて warnings に書き、投げるのは title が無い時だけ。
// 選ばなかった案: おかしい値で全体を断る案。Claude が書いた長い文書が 1 つの誤りで丸ごと失われるので、捨てて知らせる。

import { lex } from '../vendor/text.mjs'
import { parseInline, mergeInlines, isSafeUrl, plainText, formatNumber } from './inline.mjs'
import { expandBizplan } from './templates/bizplan.mjs'

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
 * | { type: 'list', ordered: boolean, items: ListItem[], logos?: (string | null)[] }
 * | { type: 'table', head: Inline[][], rows: Inline[][][], align?: Align[], widths?: number[] }
 * | { type: 'quote', text: Inline[] }
 * | { type: 'rule' }
 * | { type: 'pagebreak' }
 * | { type: 'keys', items: KeyItem[] }
 * | { type: 'card', label: string, text: Inline[] }
 * | { type: 'chart', option?: Record<string, any>, kind?: string, data?: Record<string, any> | unknown[], dataset?: string, example?: string, theme?: string, alt?: string, height?: number, caption?: string }
 * | { type: 'svg', source: string, height?: number, caption?: string, alt: string }
 * | { type: 'image', path: string, width?: number, caption?: string, alt: string }
 * | { type: 'fields', items: FieldItem[] }
 * ) & { id?: string }} Block
 */
/**
 * 資料（deck）の 1 枚。字の項目（title・lead・quote・by・points など）は Inline の列でなく字のまま持つ（中の ** や {親字|るび} は組む側が parseInline で読む）。
 * 選ばなかった案: Block と同じ Inline の列にする案。道具に渡された JSON のまま revise が 1 枚ずつ差し替えられ、Markdown から作った 1 枚とも同じ形で比べられる。
 * @typedef {'cover'|'section'|'statement'|'grid'|'content'|'split'|'figure'|'kpi'|'compare'|'table'|'quote'|'closing'} SlideLayout
 * @typedef {{ title?: string, note?: string, source?: string, span?: number, emphasis?: true, blocks?: Block[], kpi?: KpiItem[] }} Panel panel の中身は blocks（図・表は 1 つ、字・箇条書きは続けて）か kpi のどちらか 1 つ
 * @typedef {{ label: string, value: string, unit?: string, delta?: string, trend?: 'up'|'down'|'flat', note?: string, logo?: string }} KpiItem
 * @typedef {{ title: string, points: string[], highlight?: true }} CompareItem
 * @typedef {{
 *   type: 'slide', layout: SlideLayout, id?: string, kicker?: string, title?: string, lead?: string,
 *   number?: string, date?: string, by?: string, quote?: string,
 *   blocks?: Block[], left?: Block[], right?: Block[], ratio?: '5:7'|'6:6'|'7:5', figure?: Block, side?: Block[], panels?: Panel[], arrange?: string,
 *   items?: KpiItem[] | CompareItem[] | string[], notes?: string, sources?: string[],
 * }} Slide
 */
/** @typedef {{ data: Record<string, any>, source?: string, asOf?: string }} Dataset */
/**
 * @typedef {{
 *   kind: 'doc'|'deck', title: string, author?: string, lang: 'ja'|'en', theme: 'mono'|'koma'|'mergeble'|'vivid'|'paper', body: 'mincho'|'gothic',
 *   paper: 'A4'|'A5'|'B5'|'Letter'|'wide', landscape: boolean, size?: number, blocks: Block[],
 *   slides?: Slide[], datasets?: Record<string, Dataset>, attach: boolean,
 * }} Doc kind が deck の時は blocks が空で、中身は slides
 */
/**
 * @typedef {{ warn: (msg: string) => void, budget: { text: number }, datasets: Record<string, Dataset>, lang: 'ja'|'en', title?: string }} Ctx
 * budget.text は文書全体で残っている本文の字数。datasets は検査の済んだ数字の入口（chart の dataset がここを引く）。title は文書の題（資料の表紙の既定）
 */
/** 箇条書き 1 つの中で読む項目（入れ子を含む）の数と、入れ子の深さ。JSON で深く入れ子にした項目が再帰で止まるのを避ける */
const LIST_VISIT_MAX = 5000
const LIST_DEPTH_MAX = 32

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
  /** 文書全体の記入欄の数。1 欄ごとに pdf-lib が見た目を作り、5,000 欄で書き込みに 2 秒かかる */
  fieldsTotal: 300,
  /** 記入欄の値 1 つの字数 */
  fieldValue: 2000,
  /** 表のセル 1 つの字数。セルの組版は字数の 2 乗に近く、20,000 字の 1 セルで 4.7 秒かかった */
  cell: 2000,
  /** 1 つの表の字数の合計 */
  tableChars: 50000,
  /** 文書全体の本文（Inline）の字数の合計。markdown の上限と blocks の合計が、10 秒の中で組める量 */
  docText: 400000,
  /** blocks が JSON の字で届いた時の長さ */
  blocksJson: 2000000,
  /** 字 1 つを Inline にする前に切る長さ。整えで減る分の余裕を見て text の 4 倍 */
  rawText: 80000,
  /** 要点（keys）の数。横に 4 個ずつ割るので、100 個で 25 の keys になる */
  keys: 100,
  /** Inline の列に入れる要素の数 */
  inlineElems: 5000,
  /** 資料の枚数 */
  slides: 120,
  /** 資料の 1 枚の中の blocks・left・right・side の個数（それぞれ） */
  slideBlocks: 12,
  /** 資料の 1 枚の panel の数と、KPI の panel の項目の数 */
  panels: 9,
  panelKpi: 6,
  /** 数字の入口（datasets）の数と、1 つの data の JSON の字数 */
  datasets: 40,
  datasetJson: 200000,
  /** 資料の 1 枚の題・lead・引用・話す人の覚え・出典の個数 */
  slideTitle: 300,
  slideLead: 1000,
  slideNotes: 4000,
  slideSources: 8,
  /** 型ごとの items の上限（kpi 4・compare 3・closing 6）。points は 1 つの列の中の個数 */
  kpiItems: 4,
  compareItems: 3,
  closingItems: 6,
  comparePoints: 8,
  /** 事業計画（plan）の JSON の字数 */
  planJson: 400000,
})
/** kpi・compare・closing の items で、検査のために見る個数（捨てる物が先にあっても使える物を拾う。巨大な配列で止まらない上限） */
const ITEM_SCAN_MAX = 64

const THEMES = /** @type {const} */ (['mono', 'koma', 'mergeble', 'vivid', 'paper'])
const BODIES = /** @type {const} */ (['mincho', 'gothic'])
const PAPER_NAMES = /** @type {const} */ (['A4', 'A5', 'B5', 'Letter', 'wide'])
const KINDS = /** @type {const} */ (['doc', 'deck'])
const TEMPLATES = /** @type {const} */ (['bizplan'])
/** 資料の型。使い道は docs/deck.md の 4.2 */
const LAYOUTS = /** @type {const} */ (['cover', 'section', 'statement', 'grid', 'content', 'split', 'figure', 'kpi', 'compare', 'table', 'quote', 'closing'])
/** 型ごとに読む項目（これ以外を渡されたら捨てて warnings に書く）。id・kicker・notes・sources はどの型でも読む */
const SLIDE_USES = /** @type {Record<string, string[]>} */ ({
  cover: ['title', 'lead', 'by', 'date'],
  section: ['title', 'lead', 'number'],
  statement: ['title', 'lead'],
  grid: ['title', 'lead', 'panels', 'arrange'],
  content: ['title', 'lead', 'blocks'],
  split: ['title', 'lead', 'left', 'right', 'ratio'],
  figure: ['title', 'lead', 'figure', 'side'],
  kpi: ['title', 'lead', 'items'],
  compare: ['title', 'lead', 'items'],
  table: ['title', 'lead', 'blocks'],
  quote: ['quote', 'by'],
  closing: ['title', 'lead', 'items', 'by'],
})
const SLIDE_FIELDS = ['title', 'lead', 'by', 'date', 'number', 'quote', 'blocks', 'left', 'right', 'ratio', 'figure', 'side', 'items', 'panels', 'arrange']
/** panel の並べ方の名前。'rows:2,3' や 'rows:1,2|1,3'（行の panel の数 | 行の高さの重み）の形も使える */
const ARRANGE_NAMES = ['auto', '1+2', '2x2', '3col', '1+3', 'kpi+3', '2x3']
const ARRANGE_ROWS = /^rows:[1-4](?:,[1-4]){0,5}(?:\|[0-9.]+(?:,[0-9.]+){0,5})?$/
const RATIOS = ['5:7', '6:6', '7:5']
/** 図の kind（look の id）の形。存在の確かめは描く時に drawLook がする（新しい形が増えても schema を直さない） */
const KIND_NAME = /^[a-z][a-z0-9-]{0,39}$/
/** ECharts の見本の id・テーマの名前（ファイル名に使うので英数字と _ - だけ） */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
/** ロゴの印。取引所:コード（NYSE:IBM・TSE:7203・NYSE:BRK.B） */
const LOGO_RE = /^[A-Z][A-Z0-9]{0,11}:[A-Z0-9][A-Z0-9._-]{0,15}$/
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
    budget: { text: LIMITS.docText },
    datasets: {},
    lang: 'ja',
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
  if (t.includes('\n')) t = joinLines(t)
  return t.replace(/\t/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '')
}

/**
 * 改行とその前後の空白・タブ・改行の連なりを、空か空白 1 つにする。
 * 選ばなかった案: /[ \t]*(?:\n[ \t]*)+/ の 1 つの正規表現。空白だけが数万字続く入力で、連なりの始めを 1 字ずつずらして
 * 毎回末尾まで読み直すので 2 乗になる(6 万字で 1.8 秒)。改行を起点に前後へ広げれば 1 回の走査で済む。
 * @param {string} t \n だけに揃えた字
 */
function joinLines(t) {
  const n = t.length
  let out = ''
  let copied = 0
  for (let nl = t.indexOf('\n'); nl >= 0; nl = t.indexOf('\n', copied)) {
    let start = nl
    while (start > copied && (t[start - 1] === ' ' || t[start - 1] === '\t')) start--
    let end = nl + 1
    while (end < n && (t[end] === ' ' || t[end] === '\t' || t[end] === '\n')) end++
    const before = codePointBefore(t, start)
    const after = t.codePointAt(end)
    out += t.slice(copied, start)
    if (before !== undefined && after !== undefined && !(isWide(before) || isWide(after))) out += ' '
    copied = end
  }
  return out + t.slice(copied)
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
  // 整えの前に切る(上限の 4 倍まで残すので、整えで減る分は見込める)
  return cutChars(cleanText(cutChars(String(v), max * 4 + 64)).trim(), max)
}

/** @param {unknown} v @returns {number | undefined} 0 より大きい有限の数だけ */
function positive(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/** @param {unknown} id @returns {string | undefined} */
function cleanId(id) {
  if (typeof id !== 'string') return undefined
  const t = cleanText(cutChars(id, 1000)).trim()
  return t ? cutChars(t, 100) : undefined
}

/**
 * Inline の列の字数を上限で切る
 * @param {Inline[]} list
 * @param {Ctx} ctx
 * @param {string} where
 * @param {number} [max]
 * @returns {Inline[]}
 */
function capInline(list, ctx, where, max = LIMITS.text) {
  let total = 0
  /** @type {Inline[]} */
  const out = []
  // 1 つの列の上限と、文書全体の残りのうち小さい方で切る
  const limit = Math.min(max, ctx.budget.text)
  const warnCut = () => ctx.warn(limit < max ? `${where}: 文書全体の本文が ${LIMITS.docText} 字を超えたので切った` : `${where}: 字が ${max} を超えたので切った`)
  for (const it of list) {
    const room = limit - total
    if (room <= 0) {
      warnCut()
      break
    }
    if (it.text.length > room) {
      const cut = cutChars(it.text, room)
      if (cut) {
        out.push({ ...it, text: cut })
        total += cut.length
      }
      warnCut()
      break
    }
    out.push(it)
    total += it.text.length
  }
  ctx.budget.text -= total
  return out
}

/**
 * 字・Inline・Inline の列のどれが来ても Inline の列にする。字は parseInline で印を読む。
 * Inline の形のものは字のまま（印を読み直さない）。
 * 印を読む前に、上限の 4 倍(rawText まで)で字を切る。切らずに読むと、上限を超える分も整えと印の読みに時間を使う。
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} where
 * @param {number} [max] この列の字数の上限(表のセルは cell)
 * @returns {Inline[]}
 */
function coerceInline(v, ctx, where, max = LIMITS.text) {
  const rawMax = Math.min(LIMITS.rawText, max * 4)
  if (typeof v === 'string') return capInline(parseInline(cleanText(cutChars(v, rawMax))), ctx, where, max)
  const arr = isObj(v) ? [v] : v
  if (!Array.isArray(arr)) {
    if (v !== undefined && v !== null) ctx.warn(`${where}: 字でも Inline の列でもないので空にした`)
    return []
  }
  /** @type {Inline[]} */
  const out = []
  let seen = 0
  for (const el of arr.length > LIMITS.inlineElems ? arr.slice(0, LIMITS.inlineElems) : arr) {
    // 上限を超えたら読むのをやめる(超えた分は下の capInline が切って warnings に書く)
    if (seen > max) break
    if (typeof el === 'string') {
      for (const x of parseInline(cleanText(cutChars(el, rawMax)))) {
        out.push(x)
        seen += x.text.length
      }
    } else if (isObj(el) && typeof el.text === 'string') {
      const text = cleanText(cutChars(el.text, rawMax))
      if (!text) continue
      seen += text.length
      /** @type {Inline} */
      const it = { text }
      if (el.bold === true) it.bold = true
      if (typeof el.ruby === 'string') {
        const ruby = cleanText(cutChars(el.ruby, LIMITS.short))
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
  if (arr.length > LIMITS.inlineElems) ctx.warn(`${where}: Inline の要素が ${LIMITS.inlineElems} を超えたので切った`)
  return capInline(mergeInlines(out), ctx, where, max)
}

// ---------------------------------------------------------------- Block の検査

/**
 * 記入欄の名前: 字・数字・_ - だけ。ほかは _ に。
 * 日本語の字も「字」として残す（氏名・住所のような欄を全部 _ にすると見分けが付かない）。選ばなかった案: ASCII だけ。
 * @param {string} s
 * @returns {string}
 */
function fieldNameOf(s) {
  const t = cutChars(cleanText(cutChars(s, 1000)).trim(), 100).replace(/[^\p{L}\p{N}_-]/gu, '_')
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
      const v = shortStr(f.value, LIMITS.fieldValue)
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
 * @param {(string | null)[]} [marks] 項目（返す列）と同じ並びのロゴを入れる口。項目が { text, logo } の形の時だけ印が入る
 * @returns {ListItem[]}
 */
function cleanListItems(rawItems, ordered, ctx, L, marks = []) {
  if (!Array.isArray(rawItems)) {
    ctx.warn(`${L}: items が配列でない`)
    return []
  }
  let flattened = false
  let visited = 0
  let tooMany = false
  /** @type {ListItem[]} */
  const out = []
  /**
   * 2 段目の列に、2 段目の項目と、その下の 3 段目以降を前から順に平らに入れる
   * @param {unknown[]} kids
   * @param {Inline[][]} into
   * @param {number} depth
   */
  const collect = (kids, into, depth) => {
    if (depth > LIST_DEPTH_MAX) { tooMany = true; return }
    for (const k of kids) {
      if (++visited > LIST_VISIT_MAX) { tooMany = true; return }
      const it = readListItem(k, ctx, L)
      if (!it) continue
      if (it.text.length) into.push(it.text)
      if (it.kids.length) {
        flattened = true
        collect(it.kids, into, depth + 1)
      }
    }
  }
  for (const raw of rawItems) {
    if (++visited > LIST_VISIT_MAX) { tooMany = true; break }
    const logo = isObj(raw) ? cleanLogo(raw.logo, ctx, L) : undefined
    const it = readListItem(raw, ctx, L)
    if (!it) continue
    /** @type {Inline[][]} */
    const kids = []
    collect(it.kids, kids, 1)
    if (kids.length) {
      out.push({ text: it.text, items: kids, ordered: it.ordered ?? ordered })
      marks.push(logo ?? null)
    } else if (it.text.length) {
      out.push(it.text)
      marks.push(logo ?? null)
    }
  }

  if (flattened) ctx.warn(`${L}: 箇条書きの 3 段目以降は 2 段目に平らにした`)
  if (tooMany) ctx.warn(`${L}: 箇条書きの項目が ${LIST_VISIT_MAX} 個か入れ子 ${LIST_DEPTH_MAX} 段を超えたので、そこから先は読まなかった`)
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
  // セル 1 つと表全体の字数を切る。セルの組版は字数の 2 乗に近く、12 列 20 行 各 1,000 字(24 万字)で 4.2 秒かかった
  let left = LIMITS.tableChars
  let spent = false
  /** @param {unknown} v */
  const cell = (v) => {
    if (left <= 0) {
      if (typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null) spent = true
      return []
    }
    const inl = coerceInline(v, ctx, L, Math.min(LIMITS.cell, left))
    left -= plainText(inl).length
    return inl
  }
  // セルは { text, logo: 'NYSE:IBM' } でもよい。ロゴはセルの最初の Inline の logo に載せる（table.mjs がそこを読む。セルの形を object に替えると他の読み手が崩れる）
  let headLogo = false
  const head = headRaw.map((h) => {
    if (isObj(h) && h.logo !== undefined && h.logo !== null) headLogo = true
    return cell(h)
  })
  if (headLogo) ctx.warn(`${L}: 頭の行のセルには logo を付けられないので使わなかった`)
  let ragged = false
  const rows = rowsRaw.map((r) => {
    if (r.length !== cols) ragged = true
    /** @type {Inline[][]} */
    const cells = []
    for (let c = 0; c < cols; c++) {
      const logo = isObj(r[c]) ? cleanLogo(r[c].logo, ctx, L) : undefined
      const inl = cell(r[c])
      if (logo) {
        if (inl.length) inl[0] = { ...inl[0], logo }
        else inl.push({ text: '', logo })
      }
      cells.push(inl)
    }
    return cells
  })
  if (ragged) ctx.warn(`${L}: 頭の行と列の数が違う行があったので、足りない所は空に、余りは切った`)
  if (spent) ctx.warn(`${L}: 表の字が ${LIMITS.tableChars} を超えたので、そこから先のセルは空にした`)
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
 * ロゴの印（'NYSE:IBM'・'TSE:7203' の形）。大文字にそろえる。形が違えば捨てて warnings。ロゴの絵は組む側（hooks/lib/logos.mjs）が引く
 * 選ばなかった案: 存在をここで確かめる。絵の置き場（別のリポ）はこの部品が知らない。無い印は描く側が黙って描かず、warnings に 1 行書く
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {string | undefined}
 */
function cleanLogo(v, ctx, L) {
  if (v === undefined || v === null) return undefined
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (LOGO_RE.test(s)) return s
  ctx.warn(`${L}: logo は 'NYSE:IBM' や 'TSE:7203' の形（取引所:コード）だけなので使わなかった`)
  return undefined
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
 * 見本に置く data（配列か { series }・{ source }・{ categories } の object）を JSON の素の物にする。字でも受ける
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {Record<string, any> | unknown[] | undefined}
 */
function cleanChartData(v, ctx, L) {
  let x = v
  if (typeof x === 'string') {
    if (x.length > LIMITS.datasetJson) {
      ctx.warn(`${L}: data の JSON の字が ${LIMITS.datasetJson} 字を超えるので捨てた`)
      return undefined
    }
    try {
      x = JSON.parse(x)
    } catch {
      ctx.warn(`${L}: data の JSON が壊れているので捨てた`)
      return undefined
    }
  }
  if (!Array.isArray(x) && !isObj(x)) {
    ctx.warn(`${L}: data は配列か { series } の object だけなので捨てた`)
    return undefined
  }
  let json
  try {
    json = JSON.stringify(x)
  } catch {
    ctx.warn(`${L}: data を JSON にできないので捨てた`)
    return undefined
  }
  if (json === undefined || json.length > LIMITS.datasetJson) {
    ctx.warn(`${L}: data が JSON で ${LIMITS.datasetJson} 字を超えるので捨てた`)
    return undefined
  }
  return JSON.parse(json)
}

/**
 * JSON の素の物（オブジェクト）にして、字数の上限を見る。字でも受ける。関数・循環・undefined は JSON を通して落とす。
 * @param {unknown} v
 * @param {number} max JSON の字数の上限
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {Record<string, any> | null}
 */
function cleanJsonObject(v, max, ctx, where) {
  let x = v
  if (typeof x === 'string') {
    if (x.length > max) {
      ctx.warn(`${where}: JSON の字が ${max} 字を超えるので捨てた`)
      return null
    }
    try {
      x = JSON.parse(x)
    } catch {
      ctx.warn(`${where}: JSON が壊れているので捨てた`)
      return null
    }
  }
  if (!isObj(x)) {
    ctx.warn(`${where}: オブジェクトでないので捨てた`)
    return null
  }
  let json
  try {
    json = JSON.stringify(x)
  } catch {
    ctx.warn(`${where}: JSON にできないので捨てた`)
    return null
  }
  if (json === undefined || json.length > max) {
    ctx.warn(`${where}: JSON で ${max} 字を超えるので捨てた`)
    return null
  }
  return JSON.parse(json)
}

/**
 * chart の Block。{ kind, data か dataset }（look の形）か { option }（ECharts）。
 * kind があれば kind を使い（option は捨てて warnings）、kind の data が無い時だけ option に落とす。dataset は datasets の data を引く。
 * 選ばなかった案: kind が知らない名前なら option に落とす案。誤字が見えなくなる。存在の確かめは描く時（drawLook）で、使える種類を warnings に出す。
 * @param {Record<string, any>} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {Block | null}
 */
function cleanChartBlock(raw, ctx, L) {
  /** @type {string | undefined} */
  let kind
  if (raw.kind !== undefined && raw.kind !== null) {
    const k = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
    if (KIND_NAME.test(k)) kind = k
    else ctx.warn(`${L}: kind は小文字の英数字と - の 40 字までの名前だけなので使わなかった`)
  }
  /** @type {string | undefined} */
  let dataset
  if (typeof raw.dataset === 'string') dataset = cleanId(raw.dataset)
  /** @type {Record<string, any> | undefined} */
  let data
  if (kind) {
    if (dataset !== undefined) {
      if (Object.prototype.hasOwnProperty.call(ctx.datasets, dataset)) data = ctx.datasets[dataset].data
      else ctx.warn(`${L}: dataset "${cutChars(dataset, 30)}" が datasets に無い`)
    }
    if (data === undefined && raw.data !== undefined && raw.data !== null) {
      const d = cleanJsonObject(raw.data, LIMITS.datasetJson, ctx, `${L} の data`)
      if (d) data = d
    }
  }
  /** @type {Record<string, any> | null | undefined} */
  let option
  if (raw.option !== undefined && raw.option !== null) option = cleanChartOption(raw.option, ctx, L)

  // 見本・テーマ・data（ECharts の見本を土台にする形）。kind（look の形）とは同時に使わない
  /** @type {string | undefined} */
  let example
  /** @type {string | undefined} */
  let theme
  /** @type {Record<string, any> | unknown[] | undefined} */
  let seed
  const assetFields = [raw.example, raw.theme].some((x) => x !== undefined && x !== null)
  if (kind && assetFields) ctx.warn(`${L}: kind と example・theme が両方あるので kind を使う（example・theme は使わない）`)
  if (!kind) {
    if (raw.example !== undefined && raw.example !== null) {
      if (typeof raw.example === 'string' && ASSET_NAME.test(raw.example.trim())) example = raw.example.trim()
      else ctx.warn(`${L}: example は英数字と _ - だけの見本の id なので使わなかった`)
    }
    if (raw.theme !== undefined && raw.theme !== null) {
      if (typeof raw.theme === 'string' && ASSET_NAME.test(raw.theme.trim())) theme = raw.theme.trim()
      else ctx.warn(`${L}: theme は英数字と _ - だけのテーマの名前なので使わなかった`)
    }
    // kind を書いて名前が合わなかった時の data は look の数字なので、見本の data とは読まない
    if (raw.data !== undefined && raw.data !== null && (raw.kind === undefined || raw.kind === null)) seed = cleanChartData(raw.data, ctx, L)
  }

  if (kind && data === undefined) {
    if (!option) {
      ctx.warn(`${L}: kind "${kind}" の data も dataset も無いので捨てた`)
      return null
    }
    ctx.warn(`${L}: kind "${kind}" の data が無いので option で描く`)
    kind = undefined
    dataset = undefined
  }
  if (kind) {
    if (option) ctx.warn(`${L}: kind と option が両方あるので kind を使う`)
    /** @type {Block} */
    const b = { type: 'chart', kind, data: /** @type {Record<string, any>} */ (data) }
    if (dataset !== undefined && Object.prototype.hasOwnProperty.call(ctx.datasets, dataset)) b.dataset = dataset
    return b
  }
  if (!option && !example) {
    if (raw.option === undefined || raw.option === null) ctx.warn(`${L}: option も kind も example もないので捨てた`)
    return null
  }
  /** @type {Block} */
  const chart = { type: 'chart' }
  if (option) chart.option = option
  if (example) chart.example = example
  if (theme) chart.theme = theme
  if (seed !== undefined) chart.data = seed
  return chart
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
      /** @type {(string | null)[]} */
      const marks = []
      const items = cleanListItems(raw.items, ordered, ctx, L, marks)
      if (!items.length) {
        ctx.warn(`${L}: 項目が無いので捨てた`)
        return []
      }
      /** @type {Block} */
      const list = { type: 'list', ordered, items }
      if (marks.some((m) => m !== null)) list.logos = marks
      return withId([list])
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
      if (raw.items.length > LIMITS.keys) ctx.warn(`${L}: 要点が ${LIMITS.keys} 個を超えたので切った`)
      for (const k of raw.items.slice(0, LIMITS.keys)) {
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
      const made = cleanChartBlock(raw, ctx, L)
      if (!made) return []
      applyFigure(made, raw, ctx, L)
      const alt = shortStr(raw.alt, LIMITS.caption)
      if (alt) /** @type {{ alt?: string }} */ (made).alt = alt
      return withId([made])
    }
    case 'svg': {
      if (typeof raw.source === 'string' && raw.source.length > LIMITS.svg) {
        ctx.warn(`${L}: source が ${LIMITS.svg} 字を超えるので捨てた`)
        return []
      }
      if (typeof raw.source !== 'string' || !/<svg[\s>/]/i.test(raw.source)) {
        ctx.warn(`${L}: source に <svg> が無いので捨てた`)
        return []
      }
      const alt = shortStr(raw.alt, LIMITS.caption) || svgTitle(raw.source) || '図'
      /** @type {Block} */
      const b = { type: 'svg', source: raw.source, alt }
      applyFigure(b, raw, ctx, L)
      return withId([b])
    }
    case 'image': {
      const path = typeof raw.path === 'string' ? cleanText(cutChars(raw.path, 1000)).trim() : ''
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
 * cleanBlock を投げさせない。深すぎる入れ子のような想定外の形で 1 つの Block が落ちても、文書全体は失わない
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} label
 * @returns {Block[]}
 */
function safeBlock(raw, ctx, label) {
  try {
    return cleanBlock(raw, ctx, label)
  } catch (e) {
    ctx.warn(`${label}: 読めない形だったので捨てた(${e instanceof Error ? e.message.slice(0, 60) : '不明'})`)
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
  // /<title[^>]*>([\s\S]*?)<\/title>/ は、<title> が数万個並ぶ入力で、開きごとに末尾まで閉じを探して 2 乗になる(49 万字で 2.3 秒)。
  // 開きは [^<>]* にして次の < で止め、閉じは最初の開きから 1 度だけ探す(最初の開きの後ろに閉じが無ければ、後ろの開きにも無い)
  const open = /<title[^<>]*>/i.exec(svg)
  if (!open) return ''
  const from = open.index + open[0].length
  const close = /<\/title[^<>]*>/i.exec(svg.slice(from, from + LIMITS.caption * 20))
  if (!close) return ''
  return cutChars(cleanText(htmlToText(svg.slice(from, from + close.index))).trim(), LIMITS.caption)
}

/**
 * 記入欄の name を文書全体で一意にする（PDF の欄は名前で束ねられる）。先に来た方が名前を取る
 * @param {Block[]} blocks
 * @param {Ctx} ctx
 */
function dedupeFieldNames(blocks, ctx) {
  limitFields(blocks, ctx)
  const used = new Set()
  /** 名前ごとに、次に試す番号。同じ名前が何度来ても、番号を 2 から数え直さない(欄が数万個で 2 乗になる) */
  const next = new Map()
  for (const b of blocks) {
    if (b.type !== 'fields') continue
    for (const f of b.items) {
      if (!used.has(f.name)) {
        used.add(f.name)
        continue
      }
      let n = next.get(f.name) ?? 2
      while (used.has(`${f.name}_${n}`)) n++
      next.set(f.name, n + 1)
      const renamed = `${f.name}_${n}`
      ctx.warn(`fields の name "${cutChars(f.name, 30)}" が重複したので "${cutChars(renamed, 30)}" にした`)
      f.name = renamed
      used.add(renamed)
    }
  }
}

/**
 * 文書全体の記入欄を fieldsTotal 個までにする。超えた欄は捨て、空になった fields の Block も捨てる。
 * 1 欄ごとに pdf-lib が見た目(書体の字形の並び)を作るので、数が多いと 10 秒のフックの中で書き終わらない。
 * @param {Block[]} blocks
 * @param {Ctx} ctx
 */
function limitFields(blocks, ctx) {
  let left = LIMITS.fieldsTotal
  let cut = false
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'fields') continue
    if (b.items.length > left) {
      cut = true
      b.items = b.items.slice(0, left)
    }
    left -= b.items.length
    if (b.items.length === 0) {
      blocks.splice(i, 1)
      i--
    }
  }
  if (cut) ctx.warn(`記入欄が文書全体で ${LIMITS.fieldsTotal} 個を超えたので、超えた分は捨てた`)
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
      // { kind, data か dataset }（look の形）。ECharts の option 自体も dataset という名前の項目を持つので、字の dataset だけを入口の名前と読む
      if (isObj(v) && typeof v.kind === 'string' && (isObj(v.data) || typeof v.dataset === 'string')) {
        return { type: 'chart', kind: v.kind, data: v.data, dataset: v.dataset, option: v.option, height: v.height, caption: v.caption, alt: v.alt, id: v.id }
      }
      // 見本を土台にする形（example・theme・data を持つ）。ECharts の option 自体はこれらの名前を最上位に持たない
      if (isObj(v) && (typeof v.example === 'string' || typeof v.theme === 'string') && !('series' in v)) {
        return { type: 'chart', example: v.example, theme: v.theme, data: v.data, option: v.option, height: v.height, caption: v.caption, alt: v.alt, id: v.id }
      }
      if (isObj(v) && isObj(v.option)) return { type: 'chart', option: v.option, example: v.example, theme: v.theme, data: v.data, height: v.height, caption: v.caption, alt: v.alt, id: v.id }
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

/** 1 つの段落(インラインを読む単位)の「閉じていないかもしれない印の数 × 字数」の上限。1e7 で marked が約 0.3 秒 */
const DELIM_COST_MAX = 1e7
/** 新しい単位が始まる行（箇条書き・番号・表の行・見出し）。引用の > は外してから見る */
const UNIT_START = /^[ \t]*(?:[-*+][ \t]|\d{1,9}[.)][ \t]|\||#{1,6}(?:[ \t]|$))/
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/
const QUOTE_PREFIX = /^(?:[ \t]*>)+/
/** 引用の入れ子の上限。これを超える行は浅くする（数千段の入れ子は、深さごとに中身を読み直すので 4 秒かかる） */
const QUOTE_DEPTH_MAX = 16
/** 文書全体の > の数がこれを超えたら、引用の深さを行ごとに見る */
const QUOTE_SCAN_MIN = 2000

/**
 * marked の強調と取り消し線・リンク・タグは、閉じない印(* _ ~ [ <)が段落に並ぶと 2 乗になる。
 * 「**a 」を 1.5 万個並べた 6 万字で 43 秒、「_a 」で 35 秒、20,000 字でも 4 秒かかり、10 秒のフックの中で終わらない。
 * 段落ごとに「印の数 × 字数」を見て、上限を超えた段落は、超えた分の印を \ で逃がして字にする。
 * 選ばなかった案: 印の数だけで切る案(正当な長い文書の太字まで消える)。上限を超えるのは、1,000 字の段落に 1 万個の印のような
 * 現実にない密度だけなので、上限の下では何も変えない。段落の切れ目は空行・箇条書き・表の行・見出しで見る(それぞれ marked も別に読む)。
 * @param {string} md
 * @param {Ctx} ctx
 * @returns {string}
 */
function tameMarkdown(md, ctx) {
  const n = md.length
  let all = 0
  let gt = 0
  for (let i = 0; i < n; i++) {
    const c = md.charCodeAt(i)
    if (c === 42 || c === 95 || c === 126 || c === 91 || c === 60) all++
    else if (c === 62) gt++
  }
  if (all * n <= DELIM_COST_MAX && gt <= QUOTE_SCAN_MIN) return md // 文書全体でも上限の下なら、段落に分けるまでもない

  /** @type {string[]} */
  const out = []
  let copied = 0
  /** @type {number[]} */
  let delims = []
  let unitStart = 0
  let inFence = ''
  let delimCut = false
  let quoteCut = false
  const flush = (/** @type {number} */ end) => {
    const len = end - unitStart
    if (delims.length * len > DELIM_COST_MAX) {
      const keep = Math.max(8, Math.floor(DELIM_COST_MAX / Math.max(1, len)))
      for (let k = keep; k < delims.length; k++) {
        out.push(md.slice(copied, delims[k]), BACKSLASH)
        copied = delims[k]
      }
      delimCut = true
    }
    delims = []
  }
  for (let pos = 0; pos <= n; ) {
    let eol = md.indexOf('\n', pos)
    if (eol < 0) eol = n
    const line = md.slice(pos, eol)
    const fence = FENCE_LINE.exec(line)
    if (inFence) {
      if (fence && fence[1][0] === inFence[0] && fence[1].length >= inFence.length) {
        inFence = ''
        unitStart = eol + 1
      }
    } else if (fence) {
      flush(pos)
      inFence = fence[1]
    } else if (line.trim() === '') {
      flush(pos)
      unitStart = eol + 1
    } else {
      const q = QUOTE_PREFIX.exec(line)
      if (q && q[0].length > QUOTE_DEPTH_MAX) {
        let depth = 0
        for (let i = 0; i < q[0].length; i++) if (q[0].charCodeAt(i) === 62) depth++
        if (depth > QUOTE_DEPTH_MAX) {
          out.push(md.slice(copied, pos), '>'.repeat(QUOTE_DEPTH_MAX))
          copied = pos + q[0].length
          quoteCut = true
        }
      }
      if (UNIT_START.test(q ? line.slice(q[0].length) : line)) {
        flush(pos)
        unitStart = pos
      }
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i)
        if ((c === 42 || c === 95 || c === 126 || c === 91 || c === 60) && (i === 0 || line.charCodeAt(i - 1) !== 92)) delims.push(pos + i)
      }
    }
    pos = eol + 1
  }
  flush(n)
  if (!delimCut && !quoteCut) return md
  if (quoteCut) ctx.warn(`引用(>)の入れ子が ${QUOTE_DEPTH_MAX} 段を超える行があったので、${QUOTE_DEPTH_MAX} 段にした`)
  if (delimCut) ctx.warn('印(* _ ~ [ <)が極端に多い段落があったので、超えた分は印ではなく字として読んだ')
  out.push(md.slice(copied))
  return out.join('')
}

/**
 * Markdown を marked の token の列にする。読めなければ改行で分けた段落にする
 * @param {string} md
 * @param {Ctx} ctx
 * @returns {any[]}
 */
function lexMarkdown(md, ctx) {
  try {
    return lex(tameMarkdown(md, ctx))
  } catch {
    ctx.warn('Markdown を読めなかったので、改行で分けた段落にした')
    return md.split(/\n{2,}/).map((p) => ({ type: 'paragraph', text: p, tokens: [{ type: 'text', raw: p, text: p }] }))
  }
}

/**
 * Markdown を Block の列にする本体
 * @param {string} md
 * @param {Ctx} ctx
 * @returns {Block[]}
 */
function markdownToBlocks(md, ctx) {
  return tokensToBlocks(lexMarkdown(md, ctx), ctx)
}

/**
 * marked の token の列を Block の列にする（資料は 1 枚ごとの token の列を、題の token を取り除いてからここに通す）
 * @param {any[]} tokens
 * @param {Ctx} ctx
 * @returns {Block[]}
 */
function tokensToBlocks(tokens, ctx) {
  /** @type {Block[]} */
  const out = []
  let deepHeadings = 0
  /**
   * @param {Record<string, any>} cand
   * @param {string} label
   */
  const push = (cand, label) => {
    for (const b of safeBlock(cand, ctx, label)) out.push(b)
  }
  for (const tok of tokens) {
    // 上限を超えた Block は後で捨てるだけなので、読まずにやめる(2,000 を超える分の整えと検査が無駄になる)
    if (out.length > LIMITS.blocks) {
      ctx.warn(`Block が ${LIMITS.blocks} 個を超えたので切った`)
      break
    }
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
          const made = cand ? safeBlock(cand, ctx, label) : []
          if (made.length) {
            for (const b of made) out.push(b)
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

// ---------------------------------------------------------------- 数字の入口（datasets）

/**
 * datasets を検査する。{ [id]: { data, source?, asOf? } }。id は 40 個まで、data は JSON で 200,000 字までのオブジェクト。
 * 選ばなかった案: おかしい入口が 1 つあれば全部を捨てる案。ほかの数字は使えるので、おかしい入口だけ捨てて warnings に書く。
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @returns {Record<string, Dataset>}
 */
function cleanDatasets(raw, ctx) {
  /** @type {Record<string, Dataset>} */
  const out = {}
  if (raw === undefined || raw === null) return out
  let v = raw
  if (typeof v === 'string') {
    // 配列やオブジェクトが JSON の字になって届く道具がある
    if (v.length > LIMITS.blocksJson) {
      ctx.warn(`datasets が JSON の字で ${LIMITS.blocksJson} 字を超えるので無視した`)
      return out
    }
    try {
      v = JSON.parse(v)
    } catch {
      ctx.warn('datasets がオブジェクトでなく、JSON としても読めないので無視した')
      return out
    }
  }
  if (!isObj(v)) {
    ctx.warn('datasets はオブジェクトだけなので無視した')
    return out
  }
  let n = 0
  for (const key of Object.keys(v)) {
    const id = cleanId(key)
    if (!id || id === '__proto__') {
      ctx.warn('datasets の名前が空か使えないので捨てた')
      continue
    }
    if (n >= LIMITS.datasets) {
      ctx.warn(`datasets が ${LIMITS.datasets} 個を超えたので、超えた分は捨てた`)
      break
    }
    const ent = v[key]
    const at = `datasets の "${cutChars(id, 30)}"`
    if (!isObj(ent)) {
      ctx.warn(`${at} がオブジェクトでないので捨てた`)
      continue
    }
    const data = cleanJsonObject(ent.data, LIMITS.datasetJson, ctx, `${at} の data`)
    if (!data) continue
    /** @type {Dataset} */
    const d = { data }
    const source = shortStr(ent.source, LIMITS.short)
    if (source) d.source = source
    const asOf = shortStr(ent.asOf, 40)
    if (asOf) d.asOf = asOf
    out[id] = d
    n++
  }
  return out
}

/**
 * 数字の入口の出典を、足の出典に出す 1 本の字にする（時点があれば添える）
 * @param {Dataset} ds
 * @param {'ja'|'en'} lang
 * @returns {string}
 */
function sourceNote(ds, lang) {
  if (!ds.source) return ''
  if (!ds.asOf) return ds.source
  return lang === 'en' ? `${ds.source} (as of ${ds.asOf})` : `${ds.source}（${ds.asOf} 時点）`
}

/**
 * 文書（doc）の chart が dataset を引いている時、その出典を図の説明の後ろに足す。資料は足の出典（slide.sources）に入るのでここは通らない。
 * @param {Block[]} blocks
 * @param {Ctx} ctx
 */
function noteDatasetSources(blocks, ctx) {
  for (const b of blocks) {
    if (b.type !== 'chart' || b.dataset === undefined || !Object.prototype.hasOwnProperty.call(ctx.datasets, b.dataset)) continue
    const note = sourceNote(ctx.datasets[b.dataset], ctx.lang)
    if (!note) continue
    const tag = ctx.lang === 'en' ? 'Source: ' : '出典: '
    b.caption = b.caption ? `${b.caption}（${tag}${note}）` : tag + note
  }
}

// ---------------------------------------------------------------- 資料（slides）

/** @param {any} b */
const isFigureBlock = (b) => !!b && (b.type === 'chart' || b.type === 'svg' || b.type === 'image')

/**
 * 資料の字の項目 1 つ。字か数だけ受け、整えて上限で切り、文書全体の字数の残りから引く。中の印（** や {親字|るび}）は組む側が読むのでそのまま残す。
 * @param {unknown} v
 * @param {number} max
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {string | undefined}
 */
function slideText(v, max, ctx, where) {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' && typeof v !== 'number') {
    ctx.warn(`${where}: 字でないので捨てた`)
    return undefined
  }
  const full = cleanText(cutChars(String(v), max * 4 + 64)).trim()
  const limit = Math.max(0, Math.min(max, ctx.budget.text))
  if (full.length > limit) ctx.warn(limit < max ? `${where}: 文書全体の本文が ${LIMITS.docText} 字を超えたので切った` : `${where}: 字が ${max} を超えたので切った`)
  const t = cutChars(full, limit)
  ctx.budget.text -= t.length
  return t || undefined
}

/**
 * 話す人の覚え。改行は残す（行ごとに整える）。PDF の頁には出さない
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {string | undefined}
 */
function slideNotes(v, ctx, where) {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') {
    ctx.warn(`${where}: 字でないので捨てた`)
    return undefined
  }
  const lines = cutChars(v.replace(/\r\n?/g, '\n'), LIMITS.slideNotes * 2).split('\n').map((l) => cleanText(l).trim())
  let t = lines.join('\n').trim()
  if (t.length > LIMITS.slideNotes) {
    t = cutChars(t, LIMITS.slideNotes)
    ctx.warn(`${where}: 字が ${LIMITS.slideNotes} を超えたので切った`)
  }
  return t || undefined
}

/**
 * 出典の列（字 1 つでもよい）。同じ文は 1 回、8 本まで
 * @param {unknown} v
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {string[]}
 */
function slideSources(v, ctx, where) {
  if (v === undefined || v === null) return []
  const arr = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null
  if (!arr) {
    ctx.warn(`${where}: 字の列でないので捨てた`)
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const x of arr) {
    const s = shortStr(x, LIMITS.short)
    if (s && !out.includes(s)) out.push(s)
  }
  if (out.length > LIMITS.slideSources) {
    ctx.warn(`${where}: 出典が ${LIMITS.slideSources} 本を超えたので切った`)
    out.length = LIMITS.slideSources
  }
  return out
}

/**
 * 資料の 1 枚の中の Block の列（blocks・left・right・side）。12 個まで。頁の区切りと記入欄は資料の頁に置けないので捨てる。
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {Block[] | undefined}
 */
function cleanBlockList(raw, ctx, where) {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    ctx.warn(`${where}: 配列でないので捨てた`)
    return undefined
  }
  /** @type {Block[]} */
  const made = []
  for (let k = 0; k < raw.length && made.length <= LIMITS.slideBlocks; k++) {
    for (const b of safeBlock(raw[k], ctx, `${where} の ${k + 1} 個目`)) made.push(b)
  }
  return onlySlideBlocks(made, ctx, where)
}

/**
 * @param {Block[]} list
 * @param {Ctx} ctx
 * @param {string} where
 * @returns {Block[]}
 */
function onlySlideBlocks(list, ctx, where) {
  /** @type {Block[]} */
  const out = []
  for (const b of list) {
    if (b.type === 'pagebreak' || b.type === 'fields') {
      ctx.warn(`${where}: ${b.type} は資料の頁に置けないので捨てた`)
      continue
    }
    out.push(b)
  }
  if (out.length > LIMITS.slideBlocks) {
    ctx.warn(`${where}: Block が ${LIMITS.slideBlocks} 個を超えたので切った`)
    out.length = LIMITS.slideBlocks
  }
  return out
}

/** 増減の字から向きを決める（符号が無ければ flat）。+ ▲ ↑ は up、- − ▼ ↓ は down @param {string} s @returns {'up'|'down'|'flat'} */
function trendOf(s) {
  const c = s.trim()[0]
  if (c === '+' || c === '＋' || c === String.fromCodePoint(0x25b2) || c === String.fromCodePoint(0x2191)) return 'up'
  if (c === '-' || c === '－' || c === String.fromCodePoint(0x2212) || c === String.fromCodePoint(0x25bc) || c === String.fromCodePoint(0x2193)) return 'down'
  return 'flat'
}

/**
 * KPI の項目。value は字か数（数は桁区切りの字にする）。delta は符号付きの字か数で、向き（trend）も添える。4 個まで
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {KpiItem[]}
 */
function cleanKpiItems(raw, ctx, L, max = LIMITS.kpiItems) {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) ctx.warn(`${L}: items が配列でない`)
    return []
  }
  /** @type {KpiItem[]} */
  const out = []
  // 捨てる項目が先にあっても、使える項目が 4 個に満たなくならないよう、検査してから数える
  for (const it of raw.slice(0, ITEM_SCAN_MAX)) {
    if (!isObj(it)) {
      ctx.warn(`${L}: items の中にオブジェクトでない物があったので捨てた`)
      continue
    }
    const value = typeof it.value === 'number' ? formatNumber(it.value) : shortStr(it.value, LIMITS.short)
    if (!value) {
      ctx.warn(`${L}: items の value が無いので捨てた`)
      continue
    }
    /** @type {KpiItem} */
    const k = { label: shortStr(it.label ?? it.name, LIMITS.short) ?? '', value }
    const unit = shortStr(it.unit, 20)
    if (unit) k.unit = unit
    const delta = typeof it.delta === 'number' ? `${it.delta > 0 ? '+' : ''}${formatNumber(it.delta)}` : shortStr(it.delta, 40)
    if (delta) {
      k.delta = delta
      k.trend = trendOf(delta)
    }
    const note = shortStr(it.note, LIMITS.note)
    if (note) k.note = note
    const logo = cleanLogo(it.logo, ctx, L)
    if (logo) k.logo = logo
    out.push(k)
  }
  return capItems(out, max, `${L}: kpi の items が ${max} 個を超えたので切った`, ctx)
}

/**
 * 使える項目を数の上限で切る（超えたら warnings に書く）
 * @template T
 * @param {T[]} list
 * @param {number} max
 * @param {string} msg
 * @param {Ctx} ctx
 * @returns {T[]}
 */
function capItems(list, max, msg, ctx) {
  if (list.length <= max) return list
  ctx.warn(msg)
  return list.slice(0, max)
}

/**
 * 比べの項目。title と points（字の列）。3 列まで。highlight は 1 つだけ目立たせる印
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {CompareItem[]}
 */
function cleanCompareItems(raw, ctx, L) {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) ctx.warn(`${L}: items が配列でない`)
    return []
  }
  /** @type {CompareItem[]} */
  let out = []
  for (const it of raw.slice(0, ITEM_SCAN_MAX)) {
    if (!isObj(it)) {
      ctx.warn(`${L}: items の中にオブジェクトでない物があったので捨てた`)
      continue
    }
    const title = shortStr(it.title ?? it.name ?? it.label, LIMITS.short)
    if (!title) {
      ctx.warn(`${L}: items の title が無いので捨てた`)
      continue
    }
    const rawPoints = typeof it.points === 'string' ? [it.points] : Array.isArray(it.points) ? it.points : []
    if (rawPoints.length > LIMITS.comparePoints) ctx.warn(`${L}: points が ${LIMITS.comparePoints} 個を超えたので切った`)
    const points = rawPoints
      .slice(0, LIMITS.comparePoints)
      .map((p) => shortStr(p, LIMITS.note))
      .filter((p) => p !== undefined && p !== '')
    /** @type {CompareItem} */
    const c = { title, points: /** @type {string[]} */ (points) }
    if (it.highlight === true) c.highlight = true
    out.push(c)
  }
  out = capItems(out, LIMITS.compareItems, `${L}: compare の items が ${LIMITS.compareItems} 個を超えたので切った`, ctx)
  if (out.filter((c) => c.highlight).length > 1) {
    let seen = false
    for (const c of out) {
      if (!c.highlight) continue
      if (seen) delete c.highlight
      seen = true
    }
    ctx.warn(`${L}: highlight は 1 つだけなので、最初の 1 つにした`)
  }
  return out
}

/**
 * 結びの次の一歩（字の列）。字かオブジェクトの text を受け、6 個まで
 * @param {unknown} raw
 * @param {Ctx} ctx
 * @param {string} L
 * @returns {string[]}
 */
function cleanClosingItems(raw, ctx, L) {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) ctx.warn(`${L}: items が配列でない`)
    return []
  }
  /** @type {string[]} */
  const out = []
  for (const it of raw.slice(0, ITEM_SCAN_MAX)) {
    const s = shortStr(isObj(it) ? it.text : it, LIMITS.note)
    if (s) out.push(s)
  }
  return capItems(out, LIMITS.closingItems, `${L}: closing の items が ${LIMITS.closingItems} 個を超えたので切った`, ctx)
}

/**
 * panel 1 つ。{ title, note, source, span, emphasis } と、中身（look・chart・table・kpi・list・text のちょうど 1 つ）。
 * 中身は blocks（図・表は 1 つ、字・箇条書きは続けて）か kpi に直す。2 つ以上あれば最初の 1 つを使って警告し、無ければ捨てて警告する。
 * 数字の入口（dataset）を引いた図の出典は、panel に出典が無ければ panel の出典にする。
 * 選ばなかった案: look と chart を 1 つの欄にまとめる案。look は { kind, data } の形（紙の決まりに揃えた形）、chart は ECharts の option・example も受け、どちらを渡したか原稿から読める方が直しやすい。
 * @param {unknown} raw @param {Ctx} ctx @param {string} L
 * @returns {Panel | null}
 */
function cleanPanel(raw, ctx, L) {
  if (!isObj(raw)) {
    ctx.warn(`${L}: オブジェクトでないので捨てた`)
    return null
  }
  const KEYS = ['look', 'chart', 'table', 'kpi', 'list', 'text']
  const given = KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null)
  if (given.length === 0) {
    ctx.warn(`${L}: look・chart・table・kpi・list・text のどれも無いので捨てた`)
    return null
  }
  if (given.length > 1) ctx.warn(`${L}: 中身は 1 つだけなので ${given[0]} を使い、${given.slice(1).join('・')} は捨てた`)
  const kind = given[0]
  const v = raw[kind]
  /** @type {Panel} */
  const out = {}
  const title = shortStr(raw.title, LIMITS.short)
  if (title) out.title = title
  const note = shortStr(raw.note, LIMITS.short)
  if (note) out.note = note
  const source = shortStr(raw.source, LIMITS.short)
  if (source) out.source = source
  if (raw.span !== undefined && raw.span !== null) {
    const sp = positive(raw.span)
    if (sp === undefined) ctx.warn(`${L}: span は 0 より大きい数だけなので無視した`)
    else out.span = Math.min(4, sp)
  }
  if (raw.emphasis === true) out.emphasis = true

  if (kind === 'kpi') {
    const items = cleanKpiItems(Array.isArray(v) ? v : isObj(v) ? v.items : undefined, ctx, L, LIMITS.panelKpi)
    if (!items.length) {
      ctx.warn(`${L}: kpi の項目が無いので捨てた`)
      return null
    }
    out.kpi = items
    return out
  }
  /** @type {Block[]} */
  let blocks = []
  if (kind === 'look' || kind === 'chart') {
    if (!isObj(v)) {
      ctx.warn(`${L}: ${kind} はオブジェクト（{ kind, data か dataset }）だけなので捨てた`)
      return null
    }
    blocks = safeBlock({ ...v, type: 'chart' }, ctx, `${L}（${kind}）`)
    const fig = /** @type {any} */ (blocks[0])
    if (fig) {
      if (!fig.alt && out.title) fig.alt = out.title
      if (!out.source && typeof fig.dataset === 'string' && Object.prototype.hasOwnProperty.call(ctx.datasets, fig.dataset)) {
        const n = sourceNote(ctx.datasets[fig.dataset], ctx.lang)
        if (n) out.source = n
      }
    }
  } else if (kind === 'table') {
    if (!isObj(v)) {
      ctx.warn(`${L}: table はオブジェクト（{ head, rows }）だけなので捨てた`)
      return null
    }
    blocks = safeBlock({ ...v, type: 'table' }, ctx, `${L}（table）`)
  } else if (kind === 'list') {
    const rawList = Array.isArray(v) ? { items: v } : isObj(v) ? v : null
    if (!rawList) {
      ctx.warn(`${L}: list は字の配列か { items } だけなので捨てた`)
      return null
    }
    blocks = safeBlock({ ...rawList, type: 'list' }, ctx, `${L}（list）`)
  } else {
    const paras = (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' ? x.split(/\n{2,}/) : [x]))
    for (const [k, x] of paras.entries()) for (const b of safeBlock({ type: 'para', text: x }, ctx, `${L}（text の ${k + 1} 段落目）`)) blocks.push(b)
  }
  if (!blocks.length) {
    ctx.warn(`${L}: ${kind} の中身を読めなかったので捨てた`)
    return null
  }
  out.blocks = blocks
  return out
}

/**
 * panels の列。9 個まで。読めない panel は捨てて warnings に書く。
 * @param {unknown} raw @param {Ctx} ctx @param {string} L
 * @returns {Panel[]}
 */
function cleanPanels(raw, ctx, L) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    ctx.warn(`${L}: panels が配列でない`)
    return []
  }
  /** @type {Panel[]} */
  const out = []
  for (let k = 0; k < raw.length && out.length <= LIMITS.panels; k++) {
    const p = cleanPanel(raw[k], ctx, `${L}: panels の ${k + 1} 個目`)
    if (p) out.push(p)
  }
  return capItems(out, LIMITS.panels, `${L}: panels が ${LIMITS.panels} 個を超えたので切った`, ctx)
}

/**
 * panel の並べ方（arrange）。名前か 'rows:2,3'（行ごとの panel の数）の形。知らない書き方は捨てて auto にする。
 * @param {unknown} v @param {Ctx} ctx @param {string} L
 * @returns {string | undefined}
 */
function cleanArrange(v, ctx, L) {
  if (v === undefined || v === null) return undefined
  const a = typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, '') : ''
  if (ARRANGE_NAMES.includes(a) || ARRANGE_ROWS.test(a)) return a === 'auto' ? undefined : a
  ctx.warn(`${L}: arrange が "${cutChars(String(v), 20)}" で使えないので auto にした（使えるのは ${ARRANGE_NAMES.join('・')} と rows:2,3 の形）`)
  return undefined
}

/**
 * layout の指定が無い時に、中身から型を決める（無ければ null）
 * @param {Record<string, any>} c
 * @returns {SlideLayout | null}
 */
function inferLayout(c) {
  if (c.panels && c.panels.length) return 'grid'
  if (c.figure) return 'figure'
  if ((c.left && c.left.length) || (c.right && c.right.length)) return 'split'
  if (c.quote) return 'quote'
  if (Array.isArray(c.items) && c.items.length) {
    const first = c.items[0]
    if (isObj(first)) return 'points' in first || 'title' in first || 'highlight' in first ? 'compare' : 'kpi'
    return 'closing'
  }
  if (c.blocks && c.blocks.length) return 'content'
  if (c.title || c.lead) return 'statement'
  return null
}

/**
 * 読んだ項目から 1 枚を仕上げる。型を決め（指定が無ければ中身から）、型に要る物が無ければ content に落とし、
 * 型で使わない項目は捨てて warnings に書く。数字の入口を引いた chart の出典は sources に足す。
 * 選ばなかった案: 型に要る物が無い 1 枚を捨てる案。題や本文は読めるので content にして残し、warnings で知らせる。
 * @param {Record<string, any>} c 読んだ項目（layoutAsked・id・kicker・title・lead・… ・items は未検査）
 * @param {Ctx & { title?: string }} ctx
 * @param {string} L
 * @returns {Slide | null}
 */
function finishSlide(c, ctx, L) {
  /** @type {SlideLayout | null} */
  let layout = c.layoutAsked ?? inferLayout(c)
  if (!layout) {
    ctx.warn(`${L}: 中身が無いので捨てた`)
    return null
  }
  /** @type {Block[] | undefined} */
  let blocks = c.blocks
  /** @type {Block | undefined} */
  let figure = c.figure
  let title = c.title
  let lead = c.lead
  /** @type {any} */
  let items

  /** 型に要る物が無い時、content に落とせるなら落とす @param {string} what */
  const fallback = (what) => {
    if (title || lead || (blocks && blocks.length)) {
      ctx.warn(`${L}: ${layout} の型に要る ${what} が無いので content にした`)
      layout = 'content'
      return true
    }
    ctx.warn(`${L}: ${layout} の型に要る ${what} が無く、ほかに中身も無いので捨てた`)
    return false
  }

  switch (layout) {
    case 'cover':
      if (!title) title = ctx.title
      break
    case 'section':
      if (!title && !fallback('title')) return null
      break
    case 'statement':
      if (!title && lead) {
        title = lead
        lead = undefined
      }
      if (!title && !fallback('title')) return null
      break
    case 'grid':
      if (!(c.panels && c.panels.length) && !fallback('panels')) return null
      break
    case 'split':
      if (!((c.left && c.left.length) || (c.right && c.right.length)) && !fallback('left か right')) return null
      break
    case 'figure':
      if (!figure && blocks) {
        const k = blocks.findIndex(isFigureBlock)
        if (k >= 0) {
          figure = blocks[k]
          blocks = blocks.filter((_, i) => i !== k)
        }
      }
      if (!figure && !fallback('figure')) return null
      break
    case 'kpi':
      items = cleanKpiItems(c.items, ctx, L)
      if (!items.length && !fallback('items')) return null
      break
    case 'compare':
      items = cleanCompareItems(c.items, ctx, L)
      if (!items.length && !fallback('items')) return null
      break
    case 'table': {
      const t = blocks ? blocks.find((b) => b.type === 'table') : undefined
      if (!t) {
        if (!fallback('表の Block')) return null
      } else {
        if (blocks && blocks.length > 1) ctx.warn(`${L}: table の型は表 1 つだけを置くので、ほかの Block は捨てた`)
        blocks = [t]
      }
      break
    }
    case 'quote':
      if (!c.quote && !fallback('quote')) return null
      break
    case 'closing':
      items = cleanClosingItems(c.items, ctx, L)
      if (!title && !items.length && !fallback('title か items')) return null
      break
    default:
  }
  if ((layout === 'content' || layout === 'grid') && !title && !lead && !(blocks && blocks.length) && !(c.panels && c.panels.length)) {
    ctx.warn(`${L}: 中身が無いので捨てた`)
    return null
  }

  /** @type {Record<string, any>} */
  const out = { type: 'slide', layout }
  if (c.id) out.id = c.id
  if (c.kicker) out.kicker = c.kicker
  const uses = SLIDE_USES[layout]
  /** @type {Record<string, any>} */
  const have = { title, lead, number: c.number, date: c.date, by: c.by, quote: c.quote, blocks, left: c.left, right: c.right, ratio: c.ratio, figure, side: c.side, items: items ?? c.items, panels: c.panels, arrange: c.arrange }
  for (const f of SLIDE_FIELDS) {
    const v = have[f]
    const present = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ''
    if (!present) continue
    if (uses.includes(f)) out[f] = v
    else ctx.warn(`${L}: ${f} は ${layout} の型では使わないので捨てた`)
  }
  if (c.notes) out.notes = c.notes

  const sources = [...(c.sources ?? [])]
  /** @type {Block[]} */
  const shown = [...(out.blocks ?? []), ...(out.left ?? []), ...(out.right ?? []), ...(out.side ?? []), ...(out.figure ? [out.figure] : [])]
  for (const b of shown) {
    if (b.type !== 'chart' || b.dataset === undefined || !Object.prototype.hasOwnProperty.call(ctx.datasets, b.dataset)) continue
    const note = sourceNote(ctx.datasets[b.dataset], ctx.lang)
    if (note && !sources.includes(note)) sources.push(note)
  }
  if (sources.length > LIMITS.slideSources) {
    ctx.warn(`${L}: 出典が ${LIMITS.slideSources} 本を超えたので切った`)
    sources.length = LIMITS.slideSources
  }
  if (sources.length) out.sources = sources
  return /** @type {Slide} */ (out)
}

/**
 * 道具に渡された 1 枚（オブジェクト）を検査して Slide にする。おかしい項目は捨てて warnings に書く。
 * @param {unknown} raw
 * @param {Ctx & { title?: string }} ctx
 * @param {string} label 「slides の 3 個目」のような場所の字
 * @returns {Slide | null}
 */
function cleanSlide(raw, ctx, label) {
  if (!isObj(raw)) {
    ctx.warn(`${label}: オブジェクトでないので捨てた`)
    return null
  }
  const L = `${label}（slide）`
  if (raw.type !== undefined && raw.type !== 'slide') ctx.warn(`${L}: type が "${cutChars(String(raw.type), 20)}" だが slide として読んだ`)
  /** @type {Record<string, any>} */
  const c = {}
  if (raw.layout !== undefined && raw.layout !== null) {
    const l = typeof raw.layout === 'string' ? raw.layout.trim().toLowerCase() : ''
    if (LAYOUTS.includes(/** @type {any} */ (l))) c.layoutAsked = l
    else ctx.warn(`${L}: layout が "${cutChars(String(raw.layout), 20)}" で使えないので中身から決めた（使えるのは ${LAYOUTS.join('・')}）`)
  }
  c.id = cleanId(raw.id)
  c.kicker = shortStr(raw.kicker, LIMITS.short) || undefined
  c.title = slideText(raw.title, LIMITS.slideTitle, ctx, `${L}: title`)
  c.lead = slideText(raw.lead, LIMITS.slideLead, ctx, `${L}: lead`)
  c.quote = slideText(raw.quote, LIMITS.slideLead, ctx, `${L}: quote`)
  c.by = shortStr(raw.by, LIMITS.short) || undefined
  c.date = shortStr(raw.date, 40) || undefined
  c.number = shortStr(raw.number, 8) || undefined
  c.blocks = cleanBlockList(raw.blocks, ctx, `${L}: blocks`)
  c.left = cleanBlockList(raw.left, ctx, `${L}: left`)
  c.right = cleanBlockList(raw.right, ctx, `${L}: right`)
  c.side = cleanBlockList(raw.side, ctx, `${L}: side`)
  c.panels = cleanPanels(raw.panels, ctx, L)
  c.arrange = cleanArrange(raw.arrange, ctx, L)
  if (raw.figure !== undefined && raw.figure !== null) {
    const made = safeBlock(raw.figure, ctx, `${L}: figure`)
    const fig = made.find(isFigureBlock)
    if (fig) c.figure = fig
    else if (made.length) ctx.warn(`${L}: figure は chart・svg・image だけなので捨てた`)
  }
  if (raw.ratio !== undefined && raw.ratio !== null) {
    if (RATIOS.includes(raw.ratio)) c.ratio = raw.ratio
    else ctx.warn(`${L}: ratio が "${cutChars(String(raw.ratio), 20)}" で使えない（使えるのは ${RATIOS.join('・')}）`)
  }
  c.items = raw.items
  c.notes = slideNotes(raw.notes, ctx, `${L}: notes`)
  c.sources = slideSources(raw.sources, ctx, `${L}: sources`)
  return finishSlide(c, ctx, L)
}

// ---------------------------------------------------------------- 資料の Markdown

/** 1 枚の区切り: --- だけの行（字下げは 3 つまで） */
const SLIDE_BREAK = /^ {0,3}-{3,}[ \t]*$/
/** 囲みを閉じる行（言語名を持たない） */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
/** 「題名と 1 行だけ」の 1 行の長さの上限（字）。これより長い段落は本文 */
const STATEMENT_MAX = 100

/**
 * 資料の Markdown を 1 枚ごとの字に分ける。区切りはコードの囲み（バッククォート 3 つか ~~~）の外の --- だけの行。空の 1 枚は捨てる。
 * 選ばなかった案: marked の水平線 token で分ける案。直前の行が字の --- は見出し（setext）になり、区切りが消える。
 * @param {string} md
 * @returns {string[]}
 */
function splitSlides(md) {
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  let cur = []
  let fence = ''
  for (const line of md.split(/\r?\n/)) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = ''
      cur.push(line)
      continue
    }
    const open = FENCE_LINE.exec(line)
    if (open) {
      fence = open[1]
      cur.push(line)
      continue
    }
    if (SLIDE_BREAK.test(line)) {
      out.push(cur.join('\n'))
      cur = []
      continue
    }
    cur.push(line)
  }
  out.push(cur.join('\n'))
  return out.filter((seg) => seg.trim() !== '')
}

/** @param {string} s 題の比べ合わせ用 */
const titleKey = (s) => s.normalize('NFKC').replace(/\s+/g, ' ').trim()

/**
 * Markdown の 1 枚分の token から Slide を作る。頭の # は section（原稿の題と同じ文で、資料の最初の 1 枚なら表紙）、## は題名。
 * 型は中身から決める: 図 1 つだけ → figure・題名と 1 行だけ → statement（題が大きい文、1 行が補足）・引用だけ → quote・ほか → content。
 * @param {any[]} tokens
 * @param {Ctx & { title?: string }} ctx
 * @param {boolean} allowCover 資料の最初の 1 枚か
 * @param {string} label
 * @returns {Slide | null}
 */
function slideFromTokens(tokens, ctx, allowCover, label) {
  let toks = tokens.filter((t) => t.type !== 'space' && t.type !== 'def')
  if (!toks.length) return null
  const L = `${label}（slide）`
  /** @type {Record<string, any>} */
  const c = {}
  const head = toks[0].type === 'heading' && toks[0].depth <= 2 ? toks[0] : null
  if (head) {
    c.title = slideText(inlineSource(head.tokens).trim(), LIMITS.slideTitle, ctx, `${L}: 題`)
    toks = toks.slice(1)
  }
  if (head && head.depth === 1) {
    const cover = allowCover && c.title !== undefined && titleKey(c.title) === titleKey(ctx.title ?? '')
    c.layoutAsked = cover ? 'cover' : 'section'
    if (toks.length && toks[0].type === 'paragraph') {
      c.lead = slideText(inlineSource(toks[0].tokens).trim(), LIMITS.slideLead, ctx, `${L}: 最初の段落`)
      toks = toks.slice(1)
    }
    if (toks.length) ctx.warn(`${L}: ${cover ? '表紙' : 'section'} は題と最初の段落だけを使うので、残りは捨てた`)
    return finishSlide(c, ctx, L)
  }
  if (!toks.length) {
    c.layoutAsked = 'statement'
    return finishSlide(c, ctx, L)
  }
  const only = toks.length === 1 ? toks[0] : null
  if (only && only.type === 'paragraph' && !(only.tokens ?? []).some((/** @type {any} */ t) => t.type === 'image')) {
    const src = inlineSource(only.tokens).trim()
    if (src && src !== BACKSLASH + 'pagebreak' && Array.from(src).length <= STATEMENT_MAX) {
      // 大きく出すのは 1 行の方（言いたい文）。題は見出しの帯の小さな字（kicker）に回す
      // 選ばなかった案: 題を大きくして 1 行を補足にする案。「結論」のような題の札が主役になり、言いたい文が小さくなる
      c.layoutAsked = 'statement'
      if (c.title) c.kicker = cutChars(c.title, LIMITS.short)
      c.title = slideText(src, LIMITS.slideTitle, ctx, `${L}: 1 行`)
      return finishSlide(c, ctx, L)
    }
  }
  if (!head && only && only.type === 'blockquote') {
    c.layoutAsked = 'quote'
    c.quote = slideText(plainOfToken(only), LIMITS.slideLead, ctx, `${L}: 引用`)
    return finishSlide(c, ctx, L)
  }
  const blocks = onlySlideBlocks(tokensToBlocks(toks, ctx), ctx, `${L}: Block`)
  if (blocks.length === 1 && isFigureBlock(blocks[0])) {
    c.layoutAsked = 'figure'
    c.figure = blocks[0]
  } else {
    c.layoutAsked = 'content'
    c.blocks = blocks
  }
  return finishSlide(c, ctx, L)
}

/**
 * 資料の Markdown を Slide の列にする
 * @param {string} md
 * @param {Ctx & { title?: string }} ctx
 * @param {boolean} allowCover 資料の最初の 1 枚が表紙になれるか（前に別の 1 枚が無い時）
 * @returns {Slide[]}
 */
function slidesFromMarkdownSource(md, ctx, allowCover) {
  /** @type {Slide[]} */
  const slides = []
  const segs = splitSlides(md)
  for (let i = 0; i < segs.length; i++) {
    if (slides.length > LIMITS.slides) break
    const s = slideFromTokens(lexMarkdown(segs[i], ctx), ctx, allowCover && slides.length === 0, `Markdown の ${i + 1} 枚目`)
    if (s) slides.push(s)
  }
  return slides
}

/**
 * 資料の Markdown を Slide の列にする（試験と revise の下請け用）。区切りは --- だけの行。
 * @param {string} md
 * @param {{ title?: string, lang?: 'ja'|'en', datasets?: unknown }} [opts] title は表紙にする頭の # の題、datasets は chart の dataset を引く入口
 * @returns {{ slides: Slide[], warnings: string[] }}
 */
export function slidesFromMarkdown(md, opts = {}) {
  /** @type {string[]} */
  const warnings = []
  /** @type {Ctx & { title?: string }} */
  const ctx = makeCtx(warnings)
  ctx.lang = opts.lang === 'en' ? 'en' : 'ja'
  ctx.title = opts.title
  ctx.datasets = cleanDatasets(opts.datasets, ctx)
  const slides = slidesFromMarkdownSource(String(md ?? ''), ctx, true)
  return { slides, warnings }
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
  let title = cleanText(cutChars(input.title, LIMITS.title * 10)).replace(/\s+/g, ' ').trim()
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
  ctx.lang = lang
  ctx.title = title

  // 資料（deck）か文書（doc）か。kind が無くても、slides か template があれば資料にする
  /** @type {'bizplan' | undefined} */
  let template
  if (input.template !== undefined && input.template !== null) {
    const t = typeof input.template === 'string' ? input.template.trim().toLowerCase() : ''
    if (t === 'bizplan') template = 'bizplan'
    else ctx.warn(`template が "${String(input.template).slice(0, 30)}" で使えないので無視した（使えるのは ${TEMPLATES.join('・')}）`)
  }
  const hasSlides = input.slides !== undefined && input.slides !== null
  const kindAsked = input.kind !== undefined && input.kind !== null
  /** @type {Doc['kind']} */
  let kind = pick(input.kind, KINDS, 'doc', 'kind', ctx)
  if (!kindAsked && (template || hasSlides)) kind = 'deck'
  if (kind === 'doc' && kindAsked && (template || hasSlides)) ctx.warn('kind が doc なので template と slides は読まない（資料にするなら kind: "deck"）')
  const deck = kind === 'deck'

  const theme = pick(input.theme, THEMES, deck ? 'paper' : 'mono', 'theme', ctx)
  const body = pick(input.body, BODIES, deck ? 'gothic' : 'mincho', 'body', ctx)
  const paper = pick(input.paper, PAPER_NAMES, 'A4', 'paper', ctx)
  // 資料は A4 の横が標準。wide（960×540）は横しか無い
  let landscape = false
  if (input.landscape !== undefined && input.landscape !== null) {
    if (typeof input.landscape === 'boolean') landscape = input.landscape
    else ctx.warn('landscape は真偽だけなので false にした')
  } else if (deck && paper === 'A4') {
    landscape = true
  }
  if (paper === 'wide') landscape = true
  let attach = deck
  if (input.attach !== undefined && input.attach !== null) {
    if (typeof input.attach === 'boolean') attach = input.attach
    else ctx.warn(`attach は真偽だけなので ${attach} にした`)
  }
  ctx.datasets = cleanDatasets(input.datasets, ctx)
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
      const a = cleanText(cutChars(input.author, LIMITS.author * 10)).replace(/\s+/g, ' ').trim()
      if (a.length > LIMITS.author) ctx.warn(`author が ${LIMITS.author} 字を超えたので切った`)
      if (a) author = cutChars(a, LIMITS.author)
    } else {
      ctx.warn('author は字だけなので無視した')
    }
  }

  if (deck) return normalizeDeck(input, { ctx, warnings, title, author, lang, theme, body, paper, landscape, size, attach, template })

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
    if (rawBlocks.length > LIMITS.blocksJson) {
      ctx.warn(`blocks が JSON の字で ${LIMITS.blocksJson} 字を超えるので無視した`)
      rawBlocks = undefined
    } else {
      try {
        rawBlocks = JSON.parse(rawBlocks)
      } catch {
        ctx.warn('blocks が配列でなく、JSON としても読めないので無視した')
        rawBlocks = undefined
      }
    }
  }
  if (rawBlocks !== undefined && rawBlocks !== null) {
    if (Array.isArray(rawBlocks)) {
      any = true
      // 2,000 個を超えた Block は後で捨てるだけなので、検査せずにやめる。keys が複数の Block に割れる分があるので、数えるのは出来上がりの数
      for (let k = 0; k < rawBlocks.length && blocks.length <= LIMITS.blocks; k++) {
        for (const b of safeBlock(rawBlocks[k], ctx, `blocks の ${k + 1} 個目`)) blocks.push(b)
      }
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

  noteDatasetSources(tidy, ctx)
  /** @type {Doc} */
  const doc = { kind: 'doc', title, lang, theme, body, paper, landscape, blocks: tidy, attach }
  if (author) doc.author = author
  if (size !== undefined) doc.size = size
  if (Object.keys(ctx.datasets).length) doc.datasets = ctx.datasets
  return { doc, warnings }
}

/**
 * 資料（kind が deck）の中身を作る。slides は 事業計画の型 → Markdown → slides の順につなぐ（前の物の後ろに足す）。
 * 選ばなかった案: blocks を 1 枚の content にして受ける案。どこで 1 枚を割るかが原稿から決まらないので、使わず warnings に書く。
 * @param {Record<string, any>} input
 * @param {{ ctx: Ctx, warnings: string[], title: string, author: string | undefined, lang: Doc['lang'], theme: Doc['theme'], body: Doc['body'], paper: Doc['paper'], landscape: boolean, size: number | undefined, attach: boolean, template: 'bizplan' | undefined }} h
 * @returns {{ doc: Doc, warnings: string[] }}
 */
function normalizeDeck(input, { ctx, warnings, title, author, lang, theme, body, paper, landscape, size, attach, template }) {
  if (input.blocks !== undefined && input.blocks !== null) ctx.warn('kind が deck なので blocks は読まない（slides か markdown を使う）')
  /** @type {Slide[]} */
  let slides = []
  let any = false

  if (template === 'bizplan') {
    any = true
    if (input.plan === undefined || input.plan === null) {
      ctx.warn('template が bizplan なのに plan が無いので、事業計画の頁は作らなかった')
    } else {
      const plan = cleanJsonObject(input.plan, LIMITS.planJson, ctx, 'plan')
      if (plan) {
        const ex = expandBizplan(plan, { lang })
        for (const w of ex.warnings) ctx.warn(w)
        // 事業計画の数字の入口。同じ名前を利用者が datasets で渡していれば、利用者の物を使う（金融のデータを後から差し込める）
        const planned = cleanDatasets(ex.datasets, ctx)
        for (const id of Object.keys(planned)) {
          if (Object.prototype.hasOwnProperty.call(ctx.datasets, id)) continue
          if (Object.keys(ctx.datasets).length >= LIMITS.datasets) {
            ctx.warn(`datasets が ${LIMITS.datasets} 個を超えたので、事業計画の数字の入口 "${cutChars(id, 30)}" は足さなかった`)
            continue
          }
          ctx.datasets[id] = planned[id]
        }
        ex.slides.forEach((s, k) => {
          const made = cleanSlide(s, ctx, `plan の ${k + 1} 枚目`)
          if (made) slides.push(made)
        })
      }
    }
  }

  if (input.markdown !== undefined && input.markdown !== null) {
    if (typeof input.markdown === 'string') {
      any = true
      let md = input.markdown
      if (md.length > LIMITS.markdown) {
        md = cutChars(md, LIMITS.markdown)
        ctx.warn(`markdown が ${LIMITS.markdown} 字を超えたので切った`)
      }
      for (const s of slidesFromMarkdownSource(md, ctx, slides.length === 0)) slides.push(s)
    } else {
      ctx.warn('markdown は字だけなので無視した')
    }
  }

  /** @type {unknown} */
  let rawSlides = input.slides
  if (typeof rawSlides === 'string') {
    // 配列が JSON の字になって届く道具がある
    if (rawSlides.length > LIMITS.blocksJson) {
      ctx.warn(`slides が JSON の字で ${LIMITS.blocksJson} 字を超えるので無視した`)
      rawSlides = undefined
    } else {
      try {
        rawSlides = JSON.parse(rawSlides)
      } catch {
        ctx.warn('slides が配列でなく、JSON としても読めないので無視した')
        rawSlides = undefined
      }
    }
  }
  if (rawSlides !== undefined && rawSlides !== null) {
    if (Array.isArray(rawSlides)) {
      any = true
      for (let k = 0; k < rawSlides.length && slides.length <= LIMITS.slides; k++) {
        const made = cleanSlide(rawSlides[k], ctx, `slides の ${k + 1} 個目`)
        if (made) slides.push(made)
      }
    } else {
      ctx.warn('slides は配列だけなので無視した')
    }
  }
  if (!any) ctx.warn('markdown も slides も template も無いので空の資料にした')

  if (slides.length > LIMITS.slides) {
    ctx.warn(`資料の枚数が ${LIMITS.slides} 枚を超えたので切った`)
    slides = slides.slice(0, LIMITS.slides)
  }
  if (any && slides.length === 0) ctx.warn('資料が空になった（中身が全部捨てられた）')

  // section の大きな番号は 01 から数える。表紙の作り手は文書の author で埋める
  let sections = 0
  for (const s of slides) {
    if (s.layout === 'section') {
      sections++
      if (!s.number) s.number = String(sections).padStart(2, '0')
    } else if (s.layout === 'cover' && !s.by && author) {
      s.by = author
    }
  }

  /** @type {Doc} */
  const doc = { kind: 'deck', title, lang, theme, body, paper, landscape, blocks: [], slides, attach }
  if (author) doc.author = author
  if (size !== undefined) doc.size = size
  if (Object.keys(ctx.datasets).length) doc.datasets = ctx.datasets
  return { doc, warnings }
}
