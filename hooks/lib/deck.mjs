// @ts-check
// 資料（kind: 'deck'）の道具の部品。純な部品（ファイルにも本体にも触らない）。
// revise: 最後に組んだ資料の入力に、1 枚ずつの直し（差し替え・挿入・削除・移動）を当てて、新しい入力を返す。
// 選ばなかった案: 直しを PDF や Layout に当てる案。PDF は組み直す物で、直せるのは原稿（入力）だけ。
// 選ばなかった案: 失敗した op だけ飛ばして残りを当てる案。Claude は並びを頭の中で追うので、半端に当たると以降の index がずれて別の枚を壊す。1 つでも失敗したら何も変えない。
import { normalize } from '../engine/schema.mjs'

/** make の theme（資料の既定は vivid・文書の既定は mono） */
export const THEME_NAMES = /** @type {const} */ (['mono', 'koma', 'mergeble', 'vivid'])
/** make の paper。wide は 960×540pt（16:9）で landscape を見ない */
export const PAPER_NAMES = /** @type {const} */ (['A4', 'A5', 'B5', 'Letter', 'wide'])
/** 資料の型（slide.layout） */
export const LAYOUT_NAMES = ['cover', 'section', 'statement', 'grid', 'content', 'split', 'figure', 'kpi', 'compare', 'table', 'quote', 'closing']

/** 1 回の revise で当てる op の数と、資料の枚数の上限（schema の上限と同じ） */
export const OPS_MAX = 60
export const SLIDES_MAX = 120

const ACTIONS = ['replace', 'insert', 'delete', 'move']

/**
 * 資料の入力か。schema は kind の大文字小文字を問わないので、ここでもそろえる
 * @param {unknown} input
 * @returns {boolean}
 */
export function isDeckInput(input) {
  const k = input !== null && typeof input === 'object' ? /** @type {any} */ (input).kind : undefined
  return typeof k === 'string' && k.trim().toLowerCase() === 'deck'
}

/** @typedef {{ action: 'replace'|'insert'|'delete'|'move', index: number, to?: number, slide?: Record<string, any> }} ReviseOp */

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 1 から始まる整数。数や、数だけの字（Claude が "3" と渡すことがある）を通す
 * @param {unknown} v
 * @returns {number | null}
 */
function whole(v) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * JSON の字で届いた配列・オブジェクトを戻す（配列が字になって届く道具がある）
 * @param {unknown} v
 * @returns {unknown}
 */
function unJson(v) {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

/**
 * revise の ops を検査して整える。断る時は理由（Claude が直せる字）
 * @param {unknown} raw
 * @returns {{ ok: true, ops: ReviseOp[] } | { ok: false, reason: string }}
 */
export function parseOps(raw) {
  const list = unJson(raw)
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: 'ops は [{ action, index, … }] の配列で渡してください' }
  if (list.length > OPS_MAX) return { ok: false, reason: `ops は ${OPS_MAX} 個までです（${list.length} 個）。何回かに分けてください` }
  /** @type {ReviseOp[]} */
  const ops = []
  for (const [i, item] of list.entries()) {
    const at = `ops[${i + 1}]`
    if (!isObj(item)) return { ok: false, reason: `${at} がオブジェクトではありません` }
    const action = typeof item.action === 'string' ? item.action.trim().toLowerCase() : ''
    if (!ACTIONS.includes(action)) return { ok: false, reason: `${at}.action は ${ACTIONS.join('・')} のどれかです` }
    const index = whole(item.index)
    if (index === null) return { ok: false, reason: `${at}.index は 1 から始まる整数です（${action}）` }
    /** @type {ReviseOp} */
    const op = /** @type {any} */ ({ action, index })
    if (action === 'move') {
      const to = whole(item.to)
      if (to === null) return { ok: false, reason: `${at}.to は 1 から始まる整数です（move は移す先の枚の番号が要ります）` }
      op.to = to
    }
    if (action === 'replace' || action === 'insert') {
      const slide = unJson(item.slide)
      if (!isObj(slide)) return { ok: false, reason: `${at}.slide が要ります（${action} は新しい 1 枚を { layout, title, … } で渡します）` }
      // type を省いた slide を、schema が受ける形にそろえる
      op.slide = slide.type === undefined ? { type: 'slide', ...slide } : slide
    }
    ops.push(op)
  }
  return { ok: true, ops }
}

/**
 * ops を順に当てる（前の op の結果に次が当たる）。1 つでも失敗したら何も変えず、どの op かを理由に書く
 * @param {readonly any[]} slides
 * @param {readonly ReviseOp[]} ops
 * @returns {{ ok: true, slides: any[], summary: string[] } | { ok: false, reason: string }}
 */
export function applyOps(slides, ops) {
  const out = slides.slice()
  /** @type {string[]} */
  const summary = []
  for (const [i, op] of ops.entries()) {
    const at = `ops[${i + 1}]（${op.action} ${op.index}）`
    const n = out.length
    const range = (/** @type {number} */ v, /** @type {number} */ max) => v >= 1 && v <= max
    if (op.action === 'insert') {
      if (!range(op.index, n + 1)) return { ok: false, reason: `${at}: index は 1〜${n + 1} です（今は ${n} 枚。末尾に足すなら ${n + 1}）` }
      if (n + 1 > SLIDES_MAX) return { ok: false, reason: `${at}: 資料は ${SLIDES_MAX} 枚までです` }
      out.splice(op.index - 1, 0, op.slide)
      summary.push(`${op.index} 枚目に挿入`)
    } else if (op.action === 'replace') {
      if (!range(op.index, n)) return { ok: false, reason: `${at}: index は 1〜${n} です（今は ${n} 枚）` }
      out[op.index - 1] = op.slide
      summary.push(`${op.index} 枚目を差し替え`)
    } else if (op.action === 'delete') {
      if (!range(op.index, n)) return { ok: false, reason: `${at}: index は 1〜${n} です（今は ${n} 枚）` }
      out.splice(op.index - 1, 1)
      summary.push(`${op.index} 枚目を削除`)
    } else {
      const to = /** @type {number} */ (op.to)
      if (!range(op.index, n) || !range(to, n)) return { ok: false, reason: `${at}: index と to は 1〜${n} です（今は ${n} 枚）` }
      const [moved] = out.splice(op.index - 1, 1)
      out.splice(to - 1, 0, moved)
      summary.push(`${op.index} 枚目を ${to} 枚目へ移動`)
    }
  }
  if (out.length === 0) return { ok: false, reason: '全部の枚を消すと資料が空になります。1 枚は残してください' }
  return { ok: true, slides: out, summary }
}

/**
 * 入力から今の枚の並びを取り出す。slides だけの入力はそのまま、markdown（--- で割る）や template・plan から広がる入力は schema の normalize で広げた物
 * @param {Record<string, any>} input
 * @returns {{ slides: any[], datasets: Record<string, any> | undefined, expanded: boolean }}
 */
export function slidesOf(input) {
  const plain = Array.isArray(input.slides) && input.markdown === undefined && input.template === undefined && input.plan === undefined
  if (plain) return { slides: input.slides.slice(), datasets: input.datasets, expanded: false }
  const { doc } = normalize(input)
  const d = /** @type {any} */ (doc)
  return { slides: Array.isArray(d.slides) ? d.slides.slice() : [], datasets: isObj(d.datasets) ? d.datasets : input.datasets, expanded: true }
}

/**
 * 最後に組んだ資料の入力に直しを当てた、新しい入力を作る
 * @param {unknown} input store の pdf:last の input
 * @param {{ ops?: unknown, theme?: unknown, paper?: unknown, title?: unknown }} change
 * @returns {{ ok: true, input: Record<string, any>, summary: string[] } | { ok: false, reason: string }}
 */
export function reviseDeck(input, change) {
  if (!isObj(input)) return { ok: false, reason: '直す資料の入力が残っていません。make で資料（kind: "deck"）を組み直してください' }
  if (!isDeckInput(input)) return { ok: false, reason: '直せるのは資料（kind: "deck"）だけです。文書は make で全体を組み直してください' }
  /** @type {string[]} */
  const summary = []
  const next = { ...input }
  if (change.theme !== undefined && change.theme !== null) {
    if (typeof change.theme !== 'string' || !THEME_NAMES.includes(/** @type {any} */ (change.theme))) return { ok: false, reason: `theme は ${THEME_NAMES.join('・')} のどれかです` }
    next.theme = change.theme
    summary.push(`色を ${change.theme} に`)
  }
  if (change.paper !== undefined && change.paper !== null) {
    if (typeof change.paper !== 'string' || !PAPER_NAMES.includes(/** @type {any} */ (change.paper))) return { ok: false, reason: `paper は ${PAPER_NAMES.join('・')} のどれかです` }
    next.paper = change.paper
    summary.push(`用紙を ${change.paper} に`)
  }
  if (change.title !== undefined && change.title !== null) {
    if (typeof change.title !== 'string' || !change.title.trim()) return { ok: false, reason: 'title は空でない字です' }
    next.title = change.title
    summary.push('題名を変更')
  }
  if (change.ops !== undefined && change.ops !== null) {
    const parsed = parseOps(change.ops)
    if (!parsed.ok) return parsed
    const base = slidesOf(input)
    if (base.slides.length === 0) return { ok: false, reason: '直す枚がありません（slides が空です）' }
    const applied = applyOps(base.slides, parsed.ops)
    if (!applied.ok) return applied
    next.slides = applied.slides
    if (base.datasets !== undefined) next.datasets = base.datasets
    // 広げた後の並びを持つので、元の広げ方は外す（残すと次の組みで二重に広がる）
    delete next.markdown
    delete next.template
    delete next.plan
    delete next.blocks
    summary.unshift(...applied.summary)
  }
  if (summary.length === 0) return { ok: false, reason: 'ops も theme・paper・title も無いので、直す物がありません' }
  return { ok: true, input: next, summary }
}

/**
 * Layout の outline から、1 枚ごと（頁ごと）の題を取る。revise の index を Claude が数え間違えないための一覧
 * @param {readonly { title?: unknown, level?: unknown, page?: unknown }[] | undefined} outline
 * @param {number} pages
 * @param {number} [width] 1 つの題の字数の上限
 * @returns {string[]}
 */
export function pageTitles(outline, pages, width = 24) {
  /** @type {string[]} */
  const titles = Array.from({ length: pages }, () => '')
  /** @type {number[]} */
  const levels = Array.from({ length: pages }, () => 9)
  for (const o of outline ?? []) {
    const p = Number(o?.page)
    const level = Number(o?.level)
    if (!Number.isInteger(p) || p < 0 || p >= pages || typeof o?.title !== 'string') continue
    // 1 枚に題が 2 つ以上ある時は、小さい level（章）より題（level 2）を先に見せる
    const rank = level === 2 ? 0 : level
    if (rank >= levels[p]) continue
    levels[p] = rank
    const chars = Array.from(o.title.replace(/\s+/g, ' ').trim())
    titles[p] = chars.length > width ? `${chars.slice(0, width).join('')}…` : chars.join('')
  }
  return titles
}
