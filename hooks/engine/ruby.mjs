// @ts-check
// ルビ（振り仮名）の配置。モノルビとグループルビ。
//
// JLReq 3.3 は、ルビが親字より短い時の置き方に「中付き」「肩付き」「均等割り」などを挙げる。ここでは中付きだけを持つ
// （ルビの並びの中心を親字の並びの中心に合わせる）。肩付きは先頭を揃える流儀で、短いルビが左に寄って見た目が偏るため選ばなかった。
// ルビが親字より長い時は、前後の字の上にかける（JLReq の許す「かけ」）方法を選ばず、親字の字間を開けて幅をルビに合わせる。
// かける方法は隣の字の種類を見て可否を決める必要があり、linebreak が行を決めた後にしか分からないので、
// 行の組みと独立に決められる開け方にした。

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ adv: (cp: number) => number }} AdvMetrics */

/** ルビの字の大きさ / 親字の大きさ */
export const RUBY_SCALE = 0.5

/** ルビの区切りに使える縦棒（半角と全角） */
const BARS = /[|｜]/

/**
 * 字の送り幅（em）。書体に無い字（NaN）は、欧文なら半角・それ以外は全角に見立てる。
 * @param {AdvMetrics | undefined} m
 * @param {number} cp
 */
export function advOf(m, cp) {
  const a = m && typeof m.adv === 'function' ? m.adv(cp) : NaN
  if (Number.isFinite(a)) return a
  return cp < 0x2000 ? 0.5 : 1
}

/**
 * ルビの字を、モノルビなら親字 1 字ずつの区切りに、グループルビなら 1 つの塊にする。
 * 縦棒で区切った数が親字の数と違う時は、棒を無視したグループルビにする（黙って字が落ちるよりよい）。
 * @param {string} ruby
 * @param {number} baseCount 親字の字数（コードポイント）
 * @returns {{ mono: boolean, segments: string[] }}
 */
export function parseRuby(ruby, baseCount) {
  if (!BARS.test(ruby)) return { mono: false, segments: [ruby] }
  const segs = ruby.split(BARS)
  if (segs.length === baseCount) return { mono: true, segments: segs }
  return { mono: false, segments: [segs.join('')] }
}

/**
 * 親字とルビを並べる。長さの単位は pt で、親字の左端が 0。
 * @param {string} base 親字
 * @param {string} ruby ルビ。「かん|じ」のように縦棒で区切ればモノルビ、区切りが無ければグループルビ
 * @param {{ size: number, font: FontId, metrics: Record<string, AdvMetrics> }} opts
 * @returns {{ width: number, baseXs: number[], ruby: { c: string, x: number }[], rubySize: number, mono: boolean }}
 */
export function layoutRuby(base, ruby, { size, font, metrics }) {
  const m = metrics ? metrics[font] : undefined
  const rubySize = size * RUBY_SCALE
  const baseChars = Array.from(base)
  const baseW = baseChars.map((c) => advOf(m, /** @type {number} */ (c.codePointAt(0))) * size)
  const { mono, segments } = parseRuby(ruby, baseChars.length)

  /** @param {string} text */
  const rubyRun = (text) => {
    const chars = Array.from(text)
    const advs = chars.map((c) => advOf(m, /** @type {number} */ (c.codePointAt(0))) * rubySize)
    return { chars, advs, width: advs.reduce((s, v) => s + v, 0) }
  }

  /**
   * ルビの字を x から並べる。
   * @param {ReturnType<typeof rubyRun>} r
   * @param {number} x
   * @param {{ c: string, x: number }[]} out
   */
  const placeRuby = (r, x, out) => {
    let at = x
    r.chars.forEach((c, i) => {
      out.push({ c, x: at })
      at += r.advs[i]
    })
  }

  /** @type {{ c: string, x: number }[]} */
  const rubyOut = []
  /** @type {number[]} */
  const baseXs = []

  if (!mono) {
    const r = rubyRun(segments[0])
    const bw = baseW.reduce((s, v) => s + v, 0)
    const n = baseChars.length
    if (r.width <= bw || n === 0) {
      let at = 0
      for (let i = 0; i < n; i++) {
        baseXs.push(at)
        at += baseW[i]
      }
      placeRuby(r, (bw - r.width) / 2, rubyOut)
      return { width: Math.max(bw, r.width), baseXs, ruby: rubyOut, rubySize, mono: false }
    }
    // 両端に半分ずつ・字の間に 1 ずつ。単位は (ルビ − 親字) / 字数
    const unit = (r.width - bw) / n
    let at = 0
    for (let i = 0; i < n; i++) {
      baseXs.push(at + unit * (i + 0.5))
      at += baseW[i]
    }
    placeRuby(r, 0, rubyOut)
    return { width: r.width, baseXs, ruby: rubyOut, rubySize, mono: false }
  }

  // モノルビ: 親字 1 字ごとに、その字の幅とルビの幅の大きい方を持ち場にする
  let at = 0
  for (let i = 0; i < baseChars.length; i++) {
    const r = rubyRun(segments[i])
    const slot = Math.max(baseW[i], r.width)
    baseXs.push(at + (slot - baseW[i]) / 2)
    placeRuby(r, at + (slot - r.width) / 2, rubyOut)
    at += slot
  }
  return { width: at, baseXs, ruby: rubyOut, rubySize, mono: true }
}
