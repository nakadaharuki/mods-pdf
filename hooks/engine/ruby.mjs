// @ts-check
// ルビ（振り仮名）の配置。モノルビとグループルビ。
//
// JLReq 3.3 は、ルビが親字より短い時の置き方に「中付き」「肩付き」「均等割り」などを挙げる。ここでは中付きだけを持つ
// （ルビの並びの中心を親字の並びの中心に合わせる）。肩付きは先頭を揃える流儀で、短いルビが左に寄って見た目が偏るため選ばなかった。
//
// ルビが親字より長い時（JLReq 3.3.8）は、前後の字に掛けてよい字（仮名・長音・小書きの仮名・分離禁止・中点・約物の空き）の上へ
// ルビ文字 1 字分まで掛け、掛けても残る分だけ親字の字間に配る（掛けるのが先、字間は残り。附属書 F.2 と同じ順）。
// 漢字・別のルビには掛けない。どの字に掛けられるかは前後の字を見ないと決まらないので、この部品は「掛ける量 overL / overR を
// 渡されたとして親字をどこに置くか」と「掛けられる量の上限 slack」だけを持ち、相手の字の判定は linebreak が持つ。
// 行頭・行末で切れた側には掛けない（ルビの端を行頭・行末に揃える。3.3.8 の Figure 141）ので、linebreak が切った後の掛ける量でもう一度置く。

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ adv: (cp: number) => number }} AdvMetrics */
/** @typedef {{ left: number, right: number, total: number }} RubySlack */

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
 * 前後の字に掛ける量（左と右の上限 capL・capR。pt）を、ルビがはみ出す量 slack に収まるよう左右に分ける。
 * 両側に掛けられるなら半分ずつ。片側にしか掛けられない（反対は漢字など）なら、その側が残りを全部取る。
 * @param {RubySlack} slack
 * @param {number} capL
 * @param {number} capR
 * @returns {{ left: number, right: number }}
 */
export function splitOverhang(slack, capL, capR) {
  const cl = Math.max(0, Math.min(capL, slack.left))
  const cr = Math.max(0, Math.min(capR, slack.right))
  let left = Math.min(cl, slack.total / 2)
  const right = Math.min(cr, slack.total - left)
  left = Math.min(cl, slack.total - right)
  return { left, right }
}

/**
 * 親字とルビを並べる。長さの単位は pt で、親字の左端が 0。width はルビがはみ出す分も含めた塊の幅で、overL・overR によらない
 * （前後の字に掛ける分は linebreak が空きを負にして重ねる）。
 * @param {string} base 親字
 * @param {string} ruby ルビ。「かん|じ」のように縦棒で区切ればモノルビ、区切りが無ければグループルビ
 * @param {{ size: number, font: FontId, metrics: Record<string, AdvMetrics>, overL?: number, overR?: number }} opts
 *   overL・overR: 塊の左・右でルビが前後の字に掛かる量（pt）。その分だけ親字を内側へ寄せ、親字の字間に配る分を減らす。
 *   slack を超える量は切る
 * @returns {{ width: number, baseXs: number[], ruby: { c: string, x: number }[], rubySize: number, mono: boolean, slack: RubySlack }}
 */
export function layoutRuby(base, ruby, { size, font, metrics, overL = 0, overR = 0 }) {
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
      return { width: Math.max(bw, r.width), baseXs, ruby: rubyOut, rubySize, mono: false, slack: { left: 0, right: 0, total: 0 } }
    }
    const total = r.width - bw
    const oL = Math.min(Math.max(0, overL), total)
    const oR = Math.min(Math.max(0, overR), total - oL)
    // 掛けた分を引いた余りを、両端に半分ずつ・字の間に 1 ずつ。単位は余り / 字数
    const unit = (total - oL - oR) / n
    let at = 0
    for (let i = 0; i < n; i++) {
      baseXs.push(oL + at + unit * (i + 0.5))
      at += baseW[i]
    }
    placeRuby(r, 0, rubyOut)
    return { width: r.width, baseXs, ruby: rubyOut, rubySize, mono: false, slack: { left: total, right: total, total } }
  }

  // モノルビ: 親字 1 字ごとに、その字の幅とルビの幅の大きい方を持ち場にする。
  // 前後の字に掛けられるのは両端の持ち場だけ（中の持ち場は隣の親字に掛けない）。掛ける側へ親字を寄せる
  const last = baseChars.length - 1
  const runs = segments.map(rubyRun)
  const excess = (/** @type {number} */ i) => Math.max(0, runs[i].width - baseW[i])
  const oL = Math.min(Math.max(0, overL), excess(0))
  const oR = Math.min(Math.max(0, overR), excess(last))
  let at = 0
  for (let i = 0; i <= last; i++) {
    const r = runs[i]
    const slot = Math.max(baseW[i], r.width)
    let bx = (slot - baseW[i]) / 2
    if (i === 0) bx = Math.max(bx, oL)
    if (i === last) bx = Math.min(bx, slot - baseW[i] - oR)
    baseXs.push(at + bx)
    placeRuby(r, at + (slot - r.width) / 2, rubyOut)
    at += slot
  }
  const left = excess(0)
  const right = excess(last)
  return { width: at, baseXs, ruby: rubyOut, rubySize, mono: true, slack: { left, right, total: left + right } }
}
