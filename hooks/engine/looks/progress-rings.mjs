// @ts-check
// progress-rings（進捗の輪）: 輪を横に並べる。値の弧は 12 時から時計回りの 2pt で、同じ太さの道は墨の 14%。輪の中に割合・下に名前と実数。満ちた輪は弧も数も上げの色になる（gauge の状態の色と同じ考え）。
// 元は look の designs/progress-rings.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 弧と道は同じ太さ（道が弧の縁からはみ出して見えない）・道は墨の 14%（track の段）・満ちた輪（100% 以上）だけ上げの色・ほかは墨。
//
// 紙に写して変えた所
// - 暗い地は塗らない。道の 14% は 2pt の太い線なので紙でもそのまま。元の 13px の割合は 14pt、名前は 8pt の墨、実数は 7.5pt の sub。
// - 並べる数は幅で決める（元は 4 つ固定）。幅 110pt あたり 1 つ・最大 5 列で、多い時は行を足し、列は均す。
// - 元は「SAMPLE SESSION PROGRESS」を左下に置いたが、紙では置かない（見出しは文書の側にある）。
// 選ばなかった案
// - 100% を超えた輪の弧を 1 周より伸ばす案: 1 周で止める。超えた分は数（120%）で読める。
// - 空の輪（0%）に点を置く案: 道だけで 0 と読める。
import { ALPHA, TICK, LABEL, BIG, inkStroke, strokeAttr, seriesColor, strokePath, circle, text, svgDoc, empty, percent, withUnit, clip, nameOf, arr, keep, f, numOf, plain, gridOf, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, max: number, unit: string, detail: boolean }} Ring */

const MAX_ITEMS = 12
const PAD_TOP = 6
const PAD_BOTTOM = 6

/**
 * @param {unknown} data { items: { name, value, max?, unit? }[], unit? }（max の既定は 100。max を渡した時だけ、輪の下に「値 / max」を書く）
 * @returns {{ data: { rings: Ring[] }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('進捗の輪: items（{ name, value, max? } の列）がありません')
  const unitAll = typeof src.unit === 'string' ? src.unit : ''
  /** @type {Ring[]} */
  const rings = []
  let bad = 0
  let badMax = 0
  arr(src.items).forEach((it, i) => {
    const v = numOf(it && it.value)
    if (!(v >= 0)) { bad++; return }
    let max = 100
    let detail = false
    if (it.max !== undefined && it.max !== null) {
      const m = numOf(it.max)
      if (m > 0) { max = m; detail = true } else badMax++
    }
    rings.push({ name: nameOf(it.name) || String(i + 1), value: v, max, unit: typeof it.unit === 'string' ? it.unit : unitAll, detail })
  })
  if (bad) warnings.push(`進捗の輪: value が 0 以上 1,000 兆以下の数でない項目 ${bad} 個を捨てました`)
  if (badMax) warnings.push(`進捗の輪: max が 0 より大きい数でない項目 ${badMax} 個は、max を 100 にしました`)
  return { data: { rings: keep(rings, MAX_ITEMS, warnings, '進捗の輪: 項目') }, warnings }
}

/**
 * 輪の並べ方。幅 110pt あたり 1 つ（最大 5 列）・行ごとの数は均す。半径は 30（元と同じ）
 * @param {number} W @param {number} n
 */
function geom(W, n) {
  const { cols, rows } = gridOf(n, Math.min(5, Math.floor(W / 110)))
  return { cols, rows, cellW: W / cols, R: 30, rowH: 30 * 2 + 44 }
}

/**
 * @param {{ rings: Ring[] }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const rings = data.rings
  if (!rings.length) return empty(o)
  const { cols, rows, cellW, R, rowH } = geom(W, rings.length)
  const natural = PAD_TOP + rows * rowH + PAD_BOTTOM
  const top = PAD_TOP + Math.max(0, (H - natural) / 2)
  /** @type {string[]} */
  const parts = []
  rings.forEach((r, i) => {
    const cx = cellW / 2 + (i % cols) * cellW
    const cy = top + Math.floor(i / cols) * rowH + R + 2
    const ratio = r.value / r.max
    const full = ratio >= 1
    const color = full ? pal.up : pal.ink
    const ringColor = full ? pal.up : seriesColor(pal, i) ?? pal.ink
    parts.push(circle(cx, cy, R, `fill="none" ${inkStroke(pal, ALPHA.track, LW.ring)}`))
    if (full) parts.push(circle(cx, cy, R, `fill="none" ${strokeAttr(color, 1, LW.ring)}`))
    else if (ratio > 0.002) {
      // 12 時から時計回り。始点と終点が同じ弧は何も描かないので、満ちた輪は円で描く
      const a = -Math.PI / 2 + 2 * Math.PI * ratio
      const d = `M${f(cx)} ${f(cy - R)}A${f(R)} ${f(R)} 0 ${ratio > 0.5 ? 1 : 0} 1 ${f(cx + R * Math.cos(a))} ${f(cy + R * Math.sin(a))}`
      parts.push(strokePath(d, strokeAttr(ringColor, 1, LW.ring)))
    }
    parts.push(text(cx, cy + 5, percent(ratio), { size: BIG, fill: color, anchor: 'middle' }))
    parts.push(text(cx, cy + R + 18, clip(r.name, LABEL, cellW - 12), { size: LABEL, fill: pal.ink, anchor: 'middle' }))
    if (r.detail) {
      parts.push(text(cx, cy + R + 30, clip(`${withUnit(plain(r.value), r.unit)} / ${withUnit(plain(r.max), r.unit)}`, TICK, cellW - 12), { size: TICK, fill: pal.sub, anchor: 'middle' }))
    }
  })
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 4 つの輪。名前と単位を紙の報告に合う物に直した（在庫・工程・予算・検査） */
function sample() {
  return {
    items: [
      { name: '倉庫の在庫', value: 164, max: 200, unit: '箱' },
      { name: '工程', value: 16, max: 25, unit: '件' },
      { name: '予算', value: 14.8, max: 40, unit: '万円' },
      { name: '検査', value: 412, max: 412, unit: '項目' },
    ],
  }
}

export default {
  id: 'progress-rings',
  title: '進捗の輪（Progress rings）',
  category: 'usage',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ rings?: Ring[] } | undefined} */ data) => {
    const g = geom(width, Math.max(1, data?.rings?.length ?? 4))
    return Math.round(PAD_TOP + g.rows * g.rowH + PAD_BOTTOM)
  },
  sample,
}
