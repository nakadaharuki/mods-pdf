// @ts-check
// polar-area（鶏頭図・極座標の面積図）: 12 か月のような同じ幅の期間の値を、同じ角度の扇で見せる。角度が同じなので、値は扇の面積で表す。
// 半径は値の平方根で、中心の穴（半径 R_IN）から測る: r = sqrt(R_IN² + 値 / 最大 × (R_MAX² − R_IN²))。穴があるので、扇が中心の 1 点に集まらない。
// 元は look の designs/polar-area.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 扇は墨の 25%（面の塗りの段。candle の本体の 55% だと、12 枚の扇が地を埋めて candle より目立った）。隣の扇とは環の真ん中の円周で測って 2pt 空ける
// （donut と同じ測り方）。輪の細い線を値 100・200・300 のような切りのよい所に、同じ平方根の尺度で引く（読むための線）。いちばん大きい 1 つだけを look の橙の 55% にする。
// 合計と最大値を上の隅の 2 つに書く（最大の値の字は ink。橙の扇と月の字が指しているので、遠い隅の橙の数字は 2 つ目の明るい点になる）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる扇は accent の 55%（mono は墨の 80%: paper の monoArea。ほかの扇は 25%）。月の名前も、その扇だけ accent の太字。
// - 色のテーマ（pal.series がある紙）では、扇を項目の並びの順に系列の色で塗る（8 色を超えたら回る）。目立たせる扇は accent（series[0]）の濃い塗り、ほかは series[1…] を薄めて。
// - 目立たせる扇は、既定は最大の値。data.highlight（項目の名前）で替えられる。上の右の隅の値と名前も、目立たせる扇のものになる。
// - 元の月の名前は 1 字（O N D …）だったが、紙では「10月」と全部書く。扇の外に置き、左右にある名前は円から離れる向きに揃える（円に重ならない）。
//   扇が 16 を超えたら名前は 1 つおき・28 を超えたら 2 つおきにする。
// - 輪の値の字は、12 時の線の右・輪のすぐ上に置く（元と同じ）。最初の扇がその高さまで届く時は、紙の色の下敷き（underlay）を敷く。
//   輪が円の縁にある時（最大の輪）は、上に置くと 12 時の隣の扇の名前に並ぶので、輪のすぐ内側に置いて下敷きを敷く。
//   外の輪ほど間が詰まる（平方根）ので、先に決めた外の輪の字と重なる輪は内側に置き直し、それも重なれば書かない（元は 1 つの data では重ならなかった）。
// - 元は下の左の注記に「SAMPLE API SPEND」と書いたが、紙では「単位: 万円」にする。
// - 項目は 36 までで、超えた分は先頭から 36 だけ描いて warnings に書く（並びは時間の順なので、まとめない）。
// - 値が 0 の月は、角度の枠と名前を残して扇だけ描かない（枠は時間の軸なので、捨てて詰めると後の月が前へずれる）。全部 0 なら、半径を決められないので描かず、warnings に書く。
// 選ばなかった案
// - 半径を値に比例させる案: 値が 2 倍の扇が面積で 4 倍に見えて、大きい値が実際より大きく見える。元と同じ平方根。
// - 扇の名前を扇の中に置く案: 小さい値の扇に入らず、墨の濃い扇の上に読める字を置けない。扇の外に置く。
import { ALPHA, TICK, BIG, inkFill, inkStroke, hotFill, seriesFill, text, circle, fillPath, underlay, svgDoc, empty, num, withUnit, textWidth, clip, tr, keep, midline, ticks, decimals, unitNote, ringPath, LW } from './paper.mjs'
import { readItems, labelOf } from './parts-kit.mjs'

const MAX_ROWS = 36
const FOOT = 18
/** 扇どうしの隙間（pt）。環の真ん中の円周で測る */
const GAP = 2

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean }} Row */
/** @typedef {{ rows: Row[], unit: string, hot: number, byName: boolean }} PolarData */

/**
 * @param {unknown} data { items: { name, value }[]（12 時から時計回り）, unit?, highlight? }
 * @returns {{ data: PolarData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const { rows: all, unit } = readItems(src, '鶏頭図', warnings, { zero: true })
  const rows = keep(all, MAX_ROWS, warnings, '鶏頭図: 扇')
  if (rows.length && rows.every((r) => r.value === 0)) {
    warnings.push('鶏頭図: 値がすべて 0 なので、扇を描けません')
    rows.length = 0
  }
  const want = typeof src.highlight === 'string' ? src.highlight.trim() : ''
  let hot = want ? rows.findIndex((r) => r.name === want) : -1
  if (want && hot < 0) warnings.push(`鶏頭図: highlight「${want}」の名前の項目がありません`)
  const byName = hot >= 0
  if (hot < 0 && rows.length) hot = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0)
  return { data: { rows, unit, hot, byName }, warnings }
}

/**
 * @param {PolarData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  const digits = decimals(rows.map((r) => r.value))
  const max = Math.max(...rows.map((r) => r.value))

  // 円の大きさ: 名前を扇の外に置く分（上下 16pt・左右は幅の余り）を引いた、高さと幅の小さい方
  const cx = W / 2
  const top = 10
  const bottom = H - FOOT
  const cy = (top + bottom) / 2
  const rMax = Math.max(24, Math.min((bottom - top) / 2 - 16, W / 2 - 56))
  const rIn = Math.max(4, rMax * 0.09)
  const rMid = (rIn + rMax) / 2
  const radius = (/** @type {number} */ v) => Math.sqrt(rIn * rIn + (v / max) * (rMax * rMax - rIn * rIn))
  const step = (Math.PI * 2) / n

  /** @type {string[]} */
  const parts = []
  // 輪は扇の後ろ。切りのよい値（最大を超えない）を 3 つほど
  const rings = ticks(0, max, 3).filter((v) => v > 0 && v <= max)
  for (const v of rings) parts.push(circle(cx, cy, radius(v), `fill="none" ${inkStroke(pal, ALPHA.grid, LW.line)}`))

  rows.forEach((r, i) => {
    const a0 = -Math.PI / 2 + i * step
    // 0 の月は枠と名前を残し、扇だけ描かない
    if (!(r.value > 0)) return
    const fill = seriesFill(pal, i, data.hot) ?? (i === data.hot ? hotFill(pal, ALPHA.body) : inkFill(pal, ALPHA.area))
    parts.push(fillPath(ringPath(cx, cy, rIn, radius(r.value), a0, a0 + step, GAP, rMid), fill))
  })

  // 輪の値: 12 時の線の右・輪のすぐ上。最初の扇がそこまで届くなら下敷きを敷く。
  // 輪が円の縁（扇の名前の帯）にあるときは、名前と並ばないよう輪のすぐ内側に置く。平方根の尺度は外の輪ほど間が詰まるので、
  // 外の輪から先に決めて、先に決めた字と重なる輪は内側に置き直し、それも重なるなら書かない（重ねた字は読めない）
  /** @type {[number, number][]} */
  const taken = []
  const hit = (/** @type {number} */ y) => taken.some(([a, b]) => y - 6.5 < b && y + 0.5 > a)
  /** @type {{ v: number, y: number, inside: boolean }[]} */
  const marks = []
  for (const v of [...rings].reverse()) {
    const r = radius(v)
    const above = cy - r - 3
    const inner = cy - r + 10
    const y = r <= rMax - 6 && !hit(above) ? above : !hit(inner) ? inner : null
    if (y === null) continue
    taken.push([y - 6.5, y + 0.5])
    marks.push({ v, y, inside: y === inner })
  }
  for (const { v, y, inside } of marks.reverse()) {
    const s = num(v, digits)
    if (inside || radius(rows[0].value) > radius(v) - 2) parts.push(underlay(cx + 2, y - 8, textWidth(s, TICK) + 2, 9.5, pal))
    parts.push(text(cx + 3, y, s, { size: TICK, fill: pal.sub }))
  }

  // 扇の名前: 外に置く。右は左揃え・左は右揃え・上下は中央。多い時は間引く
  const every = n > 28 ? 3 : n > 16 ? 2 : 1
  rows.forEach((r, i) => {
    if (i % every !== 0 && i !== data.hot) return
    const a = -Math.PI / 2 + (i + 0.5) * step
    const c = Math.cos(a)
    const s = Math.sin(a)
    const anchor = c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle'
    const x = cx + (rMax + (anchor === 'middle' ? 11 : 6)) * c
    const y = cy + (rMax + 8) * s
    const hotName = i === data.hot
    parts.push(text(x, midline(y, TICK), clip(labelOf(r, lang), TICK, 44), { size: TICK, fill: hotName ? pal.accent : pal.sub, anchor, bold: hotName }))
  })

  // 上の両隅: 左は合計・右は目立たせる扇の値と名前
  const sum = rows.reduce((s, r) => s + r.value, 0)
  const hotRow = rows[data.hot]
  parts.push(text(8, 20, withUnit(num(sum, digits), data.unit), { size: BIG, fill: pal.ink }))
  parts.push(text(8, 33, tr(lang, '合計', 'Total'), { size: TICK, fill: pal.sub }))
  parts.push(text(W - 8, 20, withUnit(num(hotRow.value, digits), data.unit), { size: BIG, fill: pal.ink, anchor: 'end' }))
  parts.push(text(W - 8, 33, `${data.byName ? tr(lang, '注目', 'Highlight') : tr(lang, '最大', 'Peak')} ${clip(labelOf(hotRow, lang), TICK, 80)}`, { size: TICK, fill: pal.sub, anchor: 'end' }))

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（12 か月の API の費用 84・96・71・128・142・176・163・205・238・271・312・287、合計 2,173）の数のまま、売上（万円）の話に直した。月は 10 月から */
function sample() {
  const values = [84, 96, 71, 128, 142, 176, 163, 205, 238, 271, 312, 287]
  const months = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  return { items: values.map((value, i) => ({ name: `${months[i]}月`, value })), unit: '万円' }
}

export default {
  id: 'polar-area',
  title: '鶏頭図（Polar area）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.6),
  sample,
}
