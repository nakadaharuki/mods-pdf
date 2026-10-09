// @ts-check
// bullet（バレット図）: 目標に対する実績を 1 行ずつ。行ごとにゼロからの目盛りを持ち、悪い・ふつう・良いの 3 つの範囲を墨の濃淡で敷き（悪い範囲がいちばん濃い）、その上に実績の細い棒（帯の高さの 1/3）、目標は 1 本の縦の印。
// 右の数は目標に届けば上げの色・悪い範囲にあれば下げの色。Stephen Few の bullet graph（公開された図の考え方で、コードではない）に従う。
// 元は look の designs/bullet.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 範囲は墨の 22%・14%・8%（悪い・ふつう・良い）・実績の棒は帯の高さの 1/3 で candle の本体と同じ 55%・目標の印は 1 本・
// 名前は左の列・値は右の列（右揃え）・行ごとの範囲の上端が目盛りの端。
//
// 紙に写して変えた所
// - 暗い地は塗らない。範囲の 8% は紙の白の上でも paper の塗りの下限（8%）に収まるのでそのまま。目標の印は 1.5pt（元は 1px）。
// - 範囲（data.ranges: 小さい順の上端。最後が目盛りの端）が無い時は、目標があれば「目標の 80%・目標・目盛りの端」・無ければ「端の 60%・80%・100%」で敷く（端は値と目標の 1.1 倍を切りのよい数に）。
// - 下の左に「濃い帯ほど悪い範囲」（元は「SAMPLE WEEKLY TARGETS」）。名前の下に「目標 95%」。
// 選ばなかった案
// - 悪い・ふつう・良いを色（赤・黄・緑）で分ける案: 色は右の数の状態だけに使い、範囲は墨の濃淡にする（look の決まり。印刷で色が飛んでも読める）。
// - 実績が目盛りの端を超えた時に端を伸ばす案: 棒は端で止める（右の数で超過が読める）。範囲を data で決めた意図を保つ。
import { ALPHA, TICK, LABEL, VALUE, fillAttr, inkFill, inkStroke, text, rect, line, svgDoc, empty, withUnit, clip, textWidth, tr, nameOf, arr, keep, niceExtent, numOf, plain, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, target: number | null, ranges: number[], unit: string }} Kpi */

const MAX_ITEMS = 12
const PAD_TOP = 12
const FOOT = 22
const BAND = 12
const BAR = 4
/** 範囲の濃さ。範囲の数ごとに、悪い範囲が濃く・最後（良い）が薄い */
const BAND_ALPHA = [
  [ALPHA.faint],
  [ALPHA.edge, ALPHA.faint],
  [ALPHA.edge, ALPHA.track, ALPHA.faint],
  [ALPHA.edge, ALPHA.track, ALPHA.quiet, ALPHA.faint],
]

/**
 * @param {unknown} data { items: { name, value, target?, max?, ranges?, unit? }[], unit? }
 * @returns {{ data: { kpis: Kpi[] }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('バレット図: items（{ name, value, target?, ranges? } の列）がありません')
  const unitAll = typeof src.unit === 'string' ? src.unit : ''
  /** @type {Kpi[]} */
  const kpis = []
  let bad = 0
  let badRanges = 0
  arr(src.items).forEach((it, i) => {
    const value = numOf(it && it.value)
    if (!(value >= 0)) { bad++; return }
    const t = numOf(it.target)
    const target = t > 0 ? t : null
    /** @type {number[]} */
    let ranges = []
    if (it.ranges !== undefined && it.ranges !== null) {
      const rs = arr(it.ranges).map(numOf)
      const ok = rs.length >= 1 && rs.length <= 4 && rs.every((r, k) => r > 0 && (k === 0 || r > rs[k - 1]))
      if (ok) ranges = rs
      else badRanges++
    }
    if (!ranges.length) {
      const m = numOf(it.max)
      const end = m > 0 ? m : niceExtent(0, Math.max(value, target ?? 0, 1e-9) * 1.1)[1]
      ranges = target && target < end ? [target * 0.8, target, end] : [end * 0.6, end * 0.8, end]
    }
    kpis.push({ name: nameOf(it.name) || String(i + 1), value, target, ranges, unit: typeof it.unit === 'string' ? it.unit : unitAll })
  })
  if (bad) warnings.push(`バレット図: value が 0 以上 1,000 兆以下の数でない項目 ${bad} 個を捨てました`)
  if (badRanges) warnings.push(`バレット図: ranges が「0 より大きい 4 個までの、小さい順の数」でない項目 ${badRanges} 個は、範囲を自動にしました`)
  return { data: { kpis: keep(kpis, MAX_ITEMS, warnings, 'バレット図: 項目') }, warnings }
}

/**
 * 行の高さ。幅に依らず 28〜40pt。高さを渡すとそれに入れる
 * @param {number} n @param {number} [H]
 */
const rowPitch = (n, H) => (H === undefined ? 32 : Math.max(28, Math.min(40, (H - PAD_TOP - FOOT) / n)))

/**
 * @param {{ kpis: Kpi[] }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const kpis = data.kpis
  if (!kpis.length) return empty(o)
  const n = kpis.length
  const rowP = rowPitch(n, H)
  const top = PAD_TOP + Math.max(0, (H - PAD_TOP - FOOT - n * rowP) / 2)

  const valueTexts = kpis.map((k) => withUnit(plain(k.value), k.unit))
  const targetTexts = kpis.map((k) => (k.target === null ? '' : `${tr(lang, '目標', 'Target')} ${withUnit(plain(k.target), k.unit)}`))
  const nameW = Math.min(W * 0.32, Math.max(...kpis.map((k, i) => Math.max(textWidth(k.name, LABEL), textWidth(targetTexts[i], TICK)))))
  const valueW = Math.max(...valueTexts.map((s) => textWidth(s, VALUE, true)))
  const bx0 = 4 + nameW + 12
  const bx1 = Math.max(bx0 + 40, W - 4 - valueW - 12)

  /** @type {string[]} */
  const parts = []
  kpis.forEach((k, i) => {
    const cy = top + rowP * i + rowP / 2
    const max = k.ranges[k.ranges.length - 1]
    const x = (/** @type {number} */ v) => bx0 + (Math.min(max, Math.max(0, v)) / max) * (bx1 - bx0)
    const alphas = BAND_ALPHA[k.ranges.length - 1]
    let from = 0
    k.ranges.forEach((to, j) => {
      parts.push(rect(x(from), cy - BAND / 2, x(to) - x(from), BAND, fillAttr(pal.ink, alphas[j])))
      from = to
    })
    parts.push(rect(bx0, cy - BAR / 2, x(k.value) - bx0, BAR, inkFill(pal, ALPHA.body)))
    if (k.target !== null) parts.push(line(x(k.target), cy - BAND / 2, x(k.target), cy + BAND / 2, inkStroke(pal, 1, LW.hot)))
    if (targetTexts[i]) {
      parts.push(text(4, cy - 1, clip(k.name, LABEL, nameW), { size: LABEL, fill: pal.ink }))
      parts.push(text(4, cy + 10, clip(targetTexts[i], TICK, nameW), { size: TICK, fill: pal.sub }))
    } else parts.push(text(4, cy + 3, clip(k.name, LABEL, nameW), { size: LABEL, fill: pal.ink }))
    const state = k.target !== null && k.value >= k.target ? pal.up : k.value < k.ranges[0] ? pal.down : pal.ink
    parts.push(text(W - 4, cy + 3, valueTexts[i], { size: VALUE, fill: state, anchor: 'end', bold: true }))
  })
  parts.push(text(4, H - 4, tr(lang, '濃い帯ほど悪い範囲・縦の印は目標', 'Darker bands are poorer ranges; the tick is the target'), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 4 行（値・目標・範囲はそのまま）。名前を紙の報告に合う物に直した */
function sample() {
  return {
    items: [
      { name: '納期遵守率', value: 96.4, target: 95, ranges: [80, 90, 100], unit: '%' },
      { name: 'リピート率', value: 71, target: 80, ranges: [50, 75, 100], unit: '%' },
      { name: '計画達成率', value: 58, target: 80, ranges: [60, 75, 100], unit: '%' },
      { name: '成約件数', value: 18, target: 20, ranges: [10, 16, 24], unit: '件' },
    ],
  }
}

export default {
  id: 'bullet',
  title: 'バレット図（Bullet graph）',
  category: 'usage',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {{ kpis?: Kpi[] } | undefined} */ data) => PAD_TOP + Math.max(1, data?.kpis?.length ?? 4) * rowPitch(1) + FOOT,
  sample,
}
