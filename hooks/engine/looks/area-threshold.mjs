// @ts-check
// area-threshold（しきい値つきの面）: 1 日の応答時間（p95）を、しきい値（SLO）と並べて見せる。細い線の下の薄い面と、しきい値を超えた区間だけ赤くした面。
// 元は look の designs/area-threshold.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 線の下の面は墨の 8%・線は 1pt で墨の 85%。しきい値より上の帯に同じ面を切り抜いて pal.down の 25% で塗り、
// 線もそこだけ pal.down にする（凡例なしで超過が読める）。しきい値は墨の 35% の点線で、右の余白まで伸ばし、名前と値を線の上と下に置く。
// 見出しは「しきい値を超えた点の数」と区間の数で、data から数える（打ち込まない）。最大の点は値を持ち、最後の値は線の端の点と右の余白の値。
// 目盛りは 0・半分・端の 3 つで、端は切りのよい値（元は最大を 100 に切り上げた 400 で、しきい値が 4 分の 3）。軸の線は引かない。
//
// 紙に写して変えた所
// - 暗い地は塗らない。元の「2h 00m」は、15 分おきの点が 8 つ（8 × 15 分）と data が知っていたから出せた。紙の data には点の間隔が無いので、
//   見出しは点の数（「8 点」）と区間の数にする（時間にするなら見出しを書く側が x から読む）。
// - 見出しはしきい値（threshold）がある時だけ置く。threshold が無い時は、ただの面と線（超過は描かない）で、warnings に書く。
// - 最大の点が超過の中にあれば pal.down の値と点、超過が無ければ墨の値と点。字は pt で、元の 9px・10px・14px は紙の 7.5・8（太字）・14。
// - 切り抜きは四角の clipPath（svg.mjs は四角だけ読む）。しきい値より上の帯の四角で切るので、面の形のまま切れる。
// 選ばなかった案
// - 超過の面を、しきい値との交点を補間して多角形にする案: 点と点の間でしきい値をまたぐ所の細い三角が、数 pt の誤差で線とずれる。四角で切る方が線と面が必ず揃う。
import { ALPHA, DASH, VALUE, TICK, fillAttr, inkFill, seriesFill, seriesStroke, inkStroke, strokeAttr, text, line, circle, fillPath, strokePath, svgDoc, empty, num, withUnit, textWidth, gutter, midline, tr, rect, seeded, axisLeft, hero, LW } from './paper.mjs'
import { readSeries, lastIndex, extentOf, yScale, scalePad, evenLabels, xTexts, linePath, areaPath, TOP_HERO, TOP_PLAIN, X_ROW } from './time-series.mjs'

const CLIP_ID = 'looks-area-threshold-over'
/** 線を描く高さの最低（pt） */
const MIN_PLOT = 50

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/**
 * @param {unknown} data { x, series: [{ name, values, unit? }], unit?, threshold?, highlight? }（面は 1 系列。複数なら highlight の系列か先頭）
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  const { data: d, warnings } = readSeries(data, 'しきい値つきの面')
  if (d.rows.length > 1) warnings.push('しきい値つきの面: 系列が複数あるので、highlight の系列（無ければ先頭）の 1 本だけを描きます')
  if (d.rows.length && d.threshold === null) warnings.push('しきい値つきの面: threshold（しきい値）が無いので、超過は描かず、ただの面と線にします')
  const pick = d.highlight >= 0 ? d.highlight : 0
  return { data: { ...d, rows: d.rows.length ? [d.rows[pick]] : [] }, warnings }
}

/**
 * @param {TimeData} d
 * @param {DrawOpts} o
 */
function draw(d, o) {
  const { width: W, height: H, pal, lang } = o
  const row = d.rows[0]
  if (!row) return empty(o)
  const vals = row.values
  const unit = row.unit || d.unit
  const thr = d.threshold
  const [lo, hi] = extentOf(vals)
  const top = thr === null ? TOP_PLAIN + 4 : TOP_HERO + 4
  const bottom = H - X_ROW - 2
  const sc = yScale(thr === null ? lo : Math.min(lo, thr), thr === null ? hi : Math.max(hi, thr), top, bottom, { count: 3, zero: true })
  const fmt = (/** @type {number} */ v) => withUnit(num(v, sc.digits), unit)
  const padL = scalePad(sc.ticks.map(fmt))
  const n = vals.length
  const last = lastIndex(vals)
  const sloY = thr === null ? NaN : sc.y(thr)
  const roomBelow = sloY + 12 <= bottom + 6
  const thrName = tr(lang, 'しきい値', 'Threshold')
  const padR = gutter([thrName, thr === null ? '' : fmt(thr), fmt(vals[last])], { size: VALUE, bold: true, min: 52 })
  const plotR = W - padR
  const at = (/** @type {number} */ i) => (n > 1 ? padL + ((plotR - padL) * i) / (n - 1) : (padL + plotR) / 2)
  /** @type {[number, number][]} */
  const pts = vals.map((v, i) => [at(i), Number.isFinite(v) ? sc.y(v) : NaN])
  const base = sc.y(0)
  const over = thr === null ? 0 : vals.filter((v) => v > thr).length
  const spans = thr === null ? 0 : vals.reduce((c, v, i) => c + (v > thr && !(vals[i - 1] > thr) ? 1 : 0), 0)

  /** @type {string[]} */
  const parts = []
  // 先に薄い面（最初の要素が切り抜きにならないように）。超過の面と線は同じ形を、しきい値より上の帯で切って重ねる
  parts.push(fillPath(areaPath(pts, base), seriesFill(pal, 0, -1, 0.15) ?? inkFill(pal, ALPHA.faint)))
  if (over > 0 && thr !== null) {
    const clipH = Math.max(1, sloY - (top - 12))
    parts.push(`<defs><clipPath id="${CLIP_ID}">${rect(padL, top - 12, plotR - padL, clipH, 'fill="#000000"')}</clipPath></defs>`)
    parts.push(`<path d="${areaPath(pts, base)}" ${fillAttr(pal.down, ALPHA.area)} clip-path="url(#${CLIP_ID})"/>`)
  }
  parts.push(strokePath(linePath(pts), seriesStroke(pal, 0, -1, LW.line) ?? inkStroke(pal, ALPHA.heavy, LW.line)))
  if (over > 0) parts.push(`<path d="${linePath(pts)}" fill="none" ${strokeAttr(pal.down, 1, LW.line)} clip-path="url(#${CLIP_ID})"/>`)

  parts.push(axisLeft({ ticks: sc.ticks, at: sc.y, fmt, x: padL, pal }))

  if (thr !== null) {
    parts.push(line(padL, sloY, W - 4, sloY, inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))
    // 名前は線の上・値は線の下。線が図の下の端に近くて下に入らない時は、どちらも線の上へ
    const nameY = roomBelow ? sloY - 4 : sloY - 14
    parts.push(text(W - 4, nameY, thrName, { size: TICK, fill: pal.sub, anchor: 'end' }))
    parts.push(text(W - 4, roomBelow ? sloY + 10 : sloY - 4, fmt(thr), { size: TICK, fill: pal.sub, anchor: 'end' }))
    const big = over ? `${num(over)} ${tr(lang, '点', over === 1 ? 'pt' : 'pts')}` : tr(lang, '超過なし', 'None over')
    const caption = over
      ? tr(lang, `しきい値を超えた点（${num(spans)} 区間）`, `points over the threshold (${num(spans)} ${spans === 1 ? 'span' : 'spans'})`)
      : tr(lang, 'しきい値を超えた点はありません', 'no point is over the threshold')
    parts.push(hero(big, caption, pal, 4, 18, W - 4))
  }

  // 最大の点は点と値（超過の中なら pal.down）。値は点のすぐ上
  let peakAt = -1
  vals.forEach((v, i) => { if (Number.isFinite(v) && (peakAt < 0 || v > vals[peakAt])) peakAt = i })
  if (peakAt >= 0 && textWidth(fmt(vals[peakAt]), VALUE, true) <= plotR - padL) {
    const hot = thr !== null && vals[peakAt] > thr
    const color = hot ? pal.down : pal.ink
    const s = fmt(vals[peakAt])
    const w = textWidth(s, VALUE, true)
    const px = Math.min(plotR - w / 2, Math.max(padL + w / 2, at(peakAt)))
    parts.push(circle(at(peakAt), sc.y(vals[peakAt]), 2, fillAttr(color, 1)))
    parts.push(text(px, sc.y(vals[peakAt]) - 5, s, { size: VALUE, fill: color, anchor: 'middle', bold: true }))
  }

  // 最後の値: 線の端の点と、右の余白の値。しきい値の字（線の上下 12pt）と重なる高さなら、その下（入らなければ上）へ退く
  if (last >= 0) {
    const ly = sc.y(vals[last])
    parts.push(circle(at(last), ly, 2, inkFill(pal, 1)))
    let cy = ly
    if (thr !== null && Math.abs(ly - sloY) < 18) cy = roomBelow ? (sloY + 22 <= bottom + 6 ? sloY + 22 : sloY - 22) : sloY - 28
    parts.push(text(W - 4, midline(cy, VALUE), fmt(vals[last]), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  }

  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種（20261011）の 1 日。15 分おき 96 点・夜の底が 150 前後・昼のこぶが 220 前後・2 つの事故（02:15〜02:45 の再構築・14:15〜15:15 のデプロイ）。
 * API の応答時間（p95・ms）としきい値 300 ms
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string, threshold: number }}
 */
function sample() {
  const rnd = seeded(20261011)
  /** @type {number[]} */
  const values = []
  /** @type {string[]} */
  const x = []
  let wobble = 0
  for (let i = 0; i < 96; i++) {
    const h = (i * 15) / 60
    const day = Math.max(0, Math.sin((Math.PI * (h - 6)) / 16))
    const bump = (/** @type {number} */ at, /** @type {number} */ amp, /** @type {number} */ width) => amp * Math.exp(-(((h - at) / width) ** 2))
    wobble = 0.6 * wobble + (rnd() - 0.5) * 26
    values.push(Math.round(150 + 70 * day + bump(2.5, 190, 0.7) + bump(14.75, 165, 0.7) + wobble))
    x.push(`${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
  }
  return { x, series: [{ name: 'API の応答時間（p95）', values }], unit: 'ms', threshold: 300 }
}

export default {
  id: 'area-threshold',
  title: 'しきい値つきの面（Area with threshold）',
  category: 'time',
  normalize,
  draw,
  // 幅が狭い図でも、見出しと下の x の字の間に線を描ける高さ（50pt）は残す
  height: (/** @type {number} */ width) => Math.max(Math.round(width * 0.5), TOP_HERO + 4 + X_ROW + 2 + MIN_PLOT),
  sample,
}
