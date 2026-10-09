// @ts-check
// 紙の図（looks）の入口。種類ごとの束を静的に読んで LOOKS（id → 形）を作り、drawLook で 1 つ描く。
// 元は look の designs/ の 43 の形（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）と、その決まりに沿って ModsPDF で新しく作った事業計画の 13 形（biz）。約束は docs/looks.md と docs/deck.md の 6 章。本体と layout はここだけを呼ぶ。知らない id・壊れた data・投げた形でも投げず、空の svg と warnings を返す。
//
// 形を足す人へ（手本は candle.mjs と sankey.mjs。確かめは test/looks-kit.mjs が全部の形に掛ける）
// - ファイルは <id>.mjs、頭は「// @ts-check」、2 行目以降に元の頭の文の日本語の写しと出典の行（docs/looks.md の 5 章）。束（time.mjs など）に import を足す。
// - 墨の割合・点線・字の大きさ・数と日付は paper.mjs の名前で書く（ALPHA・DASH・TICK/LABEL/VALUE/BIG/HUGE・num/percent/signed/dateLabel）。
// - 字は paper の text() だけ（y は基線。縦の中心は midline）。色は ink・sub（目立たせる字は accent、上げ下げは up・down）。
// - 目立たせる 1 つは hotFill・hotStroke。ほかの線は seriesStyle(i, true) で 100% を譲る。
// - d3 は '../../vendor/d3.mjs' から名前で読む。d3 は渡した物を書き換えるので、draw のたびに新しい物を作って渡す。
// - 書体に無い字（· U+00B7・≤・≥・半角カナ）は使わない。▲▼ は全角なので、上げ下げの印は triangle() の形で描く。
// - Pal・DrawOpts の型は各ファイルに typedef で写す（import の型指定は hook-env-check に落とされる）。
//
// 選ばなかった案
// - 形ごとのファイルを動的に読む案: フックの環境に動的な読み込みは無い。束（time.mjs など）が静的に読む。
// - 上限を形ごとに持たせる案: 点・系列・節・ラベルの上限は 10 秒のフックを守る物で、形の見た目の決まりではない。ここ 1 か所で掛ける。
import { cleanPal, svgDoc, toNum, num, withTextMin } from './paper.mjs'
import time from './time.mjs'
import usage from './usage.mjs'
import compare from './compare.mjs'
import spread from './spread.mjs'
import parts from './parts.mjs'
import flow from './flow.mjs'
import work from './work.mjs'
import biz from './biz.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[], series?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en', textMin?: number }} DrawOpts textMin は字の大きさの下限（pt。資料の図は 9）。drawWith が paper の withTextMin で包むので、形は何も書かなくてよい */
/**
 * @typedef {{
 *   id: string, title: string, category: 'time'|'usage'|'compare'|'spread'|'parts'|'flow'|'work'|'biz',
 *   normalize: (data: unknown) => { data: any, warnings: string[] },
 *   draw: (data: any, o: DrawOpts) => string,
 *   height: (width: number, data: any) => number,
 *   sample: () => any,
 * }} Look
 */

/** 束の並びは docs/looks.md の 4 章の種類の順。biz（事業計画の 13 形）は資料の回に足した物で、4 章の 43 の外 */
export const CATEGORIES = /** @type {const} */ (['time', 'usage', 'compare', 'spread', 'parts', 'flow', 'work', 'biz'])

/**
 * 全部の形（束の順）。id が重なっていないこと・docs/looks.md の 4 章の 43 の id と種類に揃っていることは試験が確かめる。
 * 形のファイルの category は字の型に広がるので、ここで Look の型に読み替える（試験が CATEGORIES の中の名前だけかを確かめる）
 * @type {Look[]}
 */
export const LOOK_LIST = /** @type {Look[]} */ (/** @type {unknown} */ ([...time, ...usage, ...compare, ...spread, ...parts, ...flow, ...work, ...biz]))

/** id → 形 @type {Readonly<Record<string, Look>>} */
export const LOOKS = Object.freeze(Object.fromEntries(LOOK_LIST.map((l) => [l.id, l])))

const has = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k)

// ---------------------------------------------------------------- 上限（docs/looks.md の 3 章の下）

/** 配列の名前ごとの上限。名前の無い配列（点の [x, y] など）と表に無い名前は ARRAY_MAX */
const LIMITS = new Map([
  ['points', 5000], ['series', 12], ['values', 2000], ['x', 2000], ['ohlc', 2000], ['volume', 2000], ['actual', 2000], ['nodes', 200], ['links', 1000],
])
const ARRAY_MAX = 5000
const TREE_MAX = 2000
const LABEL_MAX = 80
const DEPTH_MAX = 20
/** 1 回の描きで歩く値の数。これを超える data は描かない（10 秒のフックを守る） */
const VISIT_MAX = 400000
const KEY_MAX = 200

/**
 * data を上限に収めた写しにする。文字列は 80 字・配列は名前ごとの上限・木（root）は 2,000 節で切る。関数・記号・巨大な整数は捨てる。元の data は書き換えない
 * @param {unknown} data
 * @param {string[]} warnings 切った分を書き足す
 * @returns {unknown}
 */
export function capData(data, warnings) {
  /** @type {Map<string, number>} */
  const over = new Map()
  let longLabels = 0
  let visits = 0
  let treeNodes = 0
  let treeDropped = 0
  const drop = (/** @type {string} */ key, /** @type {number} */ n) => over.set(key, (over.get(key) ?? 0) + n)

  /** @param {unknown} v @param {string | undefined} key @param {number} depth @param {boolean} tree */
  const walk = (v, key, depth, tree) => {
    if (++visits > VISIT_MAX) throw new Error('data が大きすぎます')
    if (typeof v === 'string') {
      if (v.length <= LABEL_MAX) return v
      const chars = Array.from(v)
      if (chars.length <= LABEL_MAX) return v
      longLabels++
      return `${chars.slice(0, LABEL_MAX - 1).join('')}…`
    }
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
    if (typeof v !== 'object' || depth > DEPTH_MAX) return undefined
    if (Array.isArray(v)) {
      const limit = key !== undefined && LIMITS.has(key) ? /** @type {number} */ (LIMITS.get(key)) : ARRAY_MAX
      if (v.length > limit) drop(key ?? '配列', v.length - limit)
      const out = []
      for (let i = 0; i < Math.min(v.length, limit); i++) {
        const item = walk(v[i], undefined, depth + 1, tree)
        if (item !== undefined) out.push(item)
        else if (tree) treeDropped++
      }
      return out
    }
    if (tree) {
      if (++treeNodes > TREE_MAX) return undefined
    }
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const k of Object.keys(v).slice(0, KEY_MAX)) {
      if (k === '__proto__') continue
      const item = walk(/** @type {any} */ (v)[k], k, depth + 1, tree || k === 'root')
      if (item !== undefined) out[k] = item
    }
    return out
  }

  const result = walk(data, undefined, 0, false)
  const names = /** @type {Record<string, string>} */ ({ points: '点', series: '系列', values: '値', nodes: '節', links: 'つながり' })
  for (const [k, n] of over) {
    const limit = LIMITS.get(k) ?? ARRAY_MAX
    warnings.push(`data の ${names[k] ?? k}（${k}）は ${num(limit)} 個までなので、超えた ${n} 個を捨てました`)
  }
  if (treeDropped || treeNodes > TREE_MAX) warnings.push(`data の木（root）は ${num(TREE_MAX)} 節までなので、超えた節を捨てました`)
  if (longLabels) warnings.push(`ラベルの字は ${LABEL_MAX} 字までなので、長い字 ${longLabels} 個を「…」で切りました`)
  return result
}

// ---------------------------------------------------------------- 描く

const WIDTH_DEFAULT = 480
const WIDTH_RANGE = [100, 1600]
const HEIGHT_RANGE = [40, 1600]

const clamp = (/** @type {number} */ v, /** @type {number[]} */ [lo, hi]) => Math.min(hi, Math.max(lo, v))
const msg = (/** @type {unknown} */ e) => String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 200)

/**
 * 図を 1 つ描く。返す svg は viewBox="0 0 width height" で、width・height は pt（そのまま ModsPDF の svg ブロックに入れると縮尺 1 で載る）
 * @param {string} id 形の id（LOOKS の名前）
 * @param {unknown} data 形ごとの data（docs/looks.md の 3 章）
 * @param {{ width?: number, height?: number, pal?: Partial<Pal>, lang?: string, textMin?: number }} [opts]
 * @returns {{ svg: string, width: number, height: number, warnings: string[] }}
 */
export function drawLook(id, data, opts = {}) {
  const look = typeof id === 'string' && has(LOOKS, id) ? LOOKS[id] : undefined
  if (look) return drawWith(look, data, opts)
  const { width, height } = sizeOf(opts, (w) => w * 0.6)
  const ids = LOOK_LIST.map((l) => l.id).join('・')
  return { svg: svgDoc(width, height, ''), width, height, warnings: [`知らない図の種類 ${JSON.stringify(String(id).slice(0, 40))} です。使える種類: ${ids || '（まだありません）'}`] }
}

/** 幅と、渡された高さ（無ければ fallback(幅) か null）を範囲に収める @param {any} opts @param {(w: number) => number} fallback */
function sizeOf(opts, fallback) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const w = toNum(o.width)
  const width = clamp(w > 0 ? w : WIDTH_DEFAULT, WIDTH_RANGE)
  const h = toNum(o.height)
  return { width, height: clamp(h > 0 ? h : fallback(width), HEIGHT_RANGE), asked: h > 0 }
}

/**
 * 形を 1 つ渡して描く（drawLook の中身。形が投げた時の始末を試験するために分けてある）。投げず、空の svg と warnings を返す
 * @param {Look} look
 * @param {unknown} data
 * @param {{ width?: number, height?: number, pal?: Partial<Pal>, lang?: string, textMin?: number }} [opts]
 * @returns {{ svg: string, width: number, height: number, warnings: string[] }}
 */
export function drawWith(look, data, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const pal = cleanPal(o.pal)
  const lang = o.lang === 'en' ? 'en' : 'ja'
  let { width, height, asked } = sizeOf(o, (w) => w * 0.6)
  /** @type {string[]} */
  const warnings = []
  try {
    return withTextMin(toNum(o.textMin), () => {
      const norm = look.normalize(capData(data, warnings))
      for (const m of norm.warnings) warnings.push(m)
      // 形の height が数でない値（NaN・字）を返しても、幅の 0.6 倍に戻して viewBox を壊さない
      if (!asked) {
        const h = toNum(look.height(width, norm.data))
        height = clamp(h > 0 ? h : width * 0.6, HEIGHT_RANGE)
      }
      const svg = look.draw(norm.data, { width, height, pal, lang })
      if (typeof svg !== 'string' || !svg.startsWith('<svg')) throw new Error('svg の字を返しませんでした')
      return { svg, width, height, warnings: [...new Set(warnings)] }
    })
  } catch (e) {
    warnings.push(`図「${look.title}」を描けませんでした: ${msg(e)}`)
    return { svg: svgDoc(width, height, ''), width, height, warnings: [...new Set(warnings)] }
  }
}
