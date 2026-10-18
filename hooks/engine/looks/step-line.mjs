// @ts-check
// step-line（階段状の折れ線）: 48 日分の API エラー率を、6 回のリリースをまたいで見せる。値は次の変更まで保たれるので、斜めでなく階段で結ぶ。
// 元は look の designs/step-line.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 階段は d3-shape の line()・area() と curveStepAfter（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 1 日 1 点を階段で結び、その下を墨の 8% の面・線は 1pt の墨 85%。リリース（マーク）ごとに、図の中を縦の細い線（墨の 8%）で分け、
// 下に短い線と名前を置く。各リリースの平均（そのリリースの日だけの平均。data から計算する）を、その区間でいちばん高い日の少し上に置く。
// 平均がいちばん高いリリースが「最悪」で、その区間だけ pal.down の面（25%）・線（1pt）・名前・平均（太字）にする（area-threshold の超過と同じ色）。見出しは最新の値。
//
// 紙に写して変えた所
// - 暗い地は塗らない。リリースの位置は data の marks（{ x, label }。x は data.x の字。この形だけの追加の項目）。無ければ、階段と面だけ（平均・最悪は出さない）。
// - 系列は 1 本（複数なら highlight の系列か先頭の 1 本。warnings に書く）。最悪の区間は、区間が 2 つ以上ある時だけ付ける（1 つなら比べる相手が無い）。
// - 最悪の区間は四角の clipPath で、同じ面と線を区間の幅で切り抜いて重ねる（階段の縦の線も含める。0.5pt ずつ広げて、縁の線を半分に切らない）。
// - 下は 2 行: リリースの名前（marks があれば）と、等間隔の x の字（日付）。平均は 8pt の小さい字で、区間が字より狭い時は置かない。字は pt で、元の 9px・10px は紙の 7.5・8（太字）。
// 選ばなかった案
// - 区間を data.x の同じ字の連なりで表す案: x は日付で、同じ日付は無い。リリースは日付の上の印なので、marks で別に渡す。
// - 系列が複数なら全部を階段にする案: 平均と最悪が系列ごとに要り、字が重なる。この形は 1 本の系列の「変化の履歴」を見せる形にする。
import { line, area, curveStepAfter } from '../../vendor/d3.mjs'
import { ALPHA, VALUE, TICK, fillAttr, inkFill, seriesFill, seriesStroke, inkStroke, strokeAttr, fillPath, strokePath, line as ln, text, rect, svgDoc, empty, num, withUnit, textWidth, clip, tr, nameOf, arr, axisLeft, hero, seeded, LW } from './paper.mjs'
import { readSeries, lastIndex, extentOf, yScale, scalePad, evenLabels, xTexts, isoDays, TOP_HERO } from './time-series.mjs'

const PAD = 4
const CLIP_ID = 'looks-step-line-worst'
/** 下の 2 行（リリースの名前・x の字）が要る高さ。marks が無ければ x の字の 1 行 */
const BOTTOM_MARKS = 34
const BOTTOM_PLAIN = 22
/** 階段を描く高さの最低（pt） */
const MIN_PLOT = 50

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number, marks: { at: number, label: string }[] }} StepData */

/**
 * @param {unknown} data { x, series: [{ name, values }], unit?, highlight?, marks?: [{ x, label }] }
 * @returns {{ data: StepData, warnings: string[] }}
 */
function normalize(data) {
  const { data: d, warnings } = readSeries(data, '階段状の折れ線')
  if (d.rows.length > 1) warnings.push('階段状の折れ線: 系列が複数あるので、highlight の系列（無ければ先頭）の 1 本だけを描きます')
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  /** @type {{ at: number, label: string }[]} */
  const marks = []
  let lost = 0
  for (const m of arr(src.marks)) {
    const at = d.x.indexOf(nameOf(m && typeof m === 'object' ? m.x : m))
    const label = nameOf(m && typeof m === 'object' ? m.label : '')
    if (at < 0 || !label) { lost++; continue }
    if (!marks.some((k) => k.at === at)) marks.push({ at, label })
  }
  if (lost) warnings.push(`階段状の折れ線: marks のうち、x に無い字を指す物か label が無い物 ${lost} 個を捨てました`)
  marks.sort((a, b) => a.at - b.at)
  const pick = d.highlight >= 0 ? d.highlight : 0
  return { data: { ...d, rows: d.rows.length ? [d.rows[pick]] : [], marks }, warnings }
}

/**
 * @param {StepData} d
 * @param {DrawOpts} o
 */
function draw(d, o) {
  const { width: W, height: H, pal, lang } = o
  const row = d.rows[0]
  if (!row) return empty(o)
  const vals = row.values
  const n = d.n
  const unit = row.unit || d.unit
  const marks = d.marks
  const top = TOP_HERO + 4
  const bottom = H - (marks.length ? BOTTOM_MARKS : BOTTOM_PLAIN)
  const [lo, hi] = extentOf(vals)
  const sc = yScale(lo, hi, top, bottom, { count: 4, zero: true })
  const fmt = (/** @type {number} */ v) => withUnit(num(v, Math.max(sc.digits, 1)), unit)
  const tickText = (/** @type {number} */ v) => withUnit(num(v, sc.digits), unit)
  const padL = scalePad(sc.ticks.map(tickText))
  const plotR = W - 8
  // 1 日は at(i) から at(i + 1) まで（最後の日が右の端まで届く）
  const at = (/** @type {number} */ i) => padL + ((plotR - padL) * i) / n
  const last = lastIndex(vals)
  const base = sc.y(0)

  /** 区間 { 始まり・終わり・平均・いちばん高い値 }（マークごと。最初のマークより前は区間にしない） */
  const spans = marks.map((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].at : n
    const days = vals.slice(m.at, end).filter(Number.isFinite)
    return { ...m, end, mean: days.length ? days.reduce((a, b) => a + b, 0) / days.length : NaN, high: days.length ? Math.max(...days) : NaN }
  })
  const worst = spans.length > 1 ? spans.reduce((a, b) => (b.mean > a.mean || Number.isNaN(a.mean) ? b : a)) : null

  /** @type {[number, number][]} */
  const pts = vals.map((v, i) => [at(i), Number.isFinite(v) ? sc.y(v) : NaN])
  pts.push([at(n), last >= 0 ? sc.y(vals[last]) : NaN])
  const defined = (/** @type {[number, number]} */ p) => Number.isFinite(p[1])
  const stepLine = /** @type {any} */ (line()).curve(curveStepAfter).defined(defined).digits(2)
  const stepArea = /** @type {any} */ (area()).curve(curveStepAfter).defined(defined).x((/** @type {[number, number]} */ p) => p[0]).y0(base).y1((/** @type {[number, number]} */ p) => p[1]).digits(2)
  const lineD = stepLine(pts) ?? ''
  const areaD = stepArea(pts) ?? ''

  /** @type {string[]} */
  const parts = []
  parts.push(fillPath(areaD, seriesFill(pal, 0, -1, 0.15) ?? inkFill(pal, ALPHA.faint)))
  parts.push(strokePath(lineD, seriesStroke(pal, 0, -1, LW.line) ?? inkStroke(pal, ALPHA.heavy, LW.line)))
  if (worst) {
    const x0 = at(worst.at) - 0.5
    const x1 = at(worst.end) + 0.5
    parts.push(`<defs><clipPath id="${CLIP_ID}">${rect(x0, top - 12, x1 - x0, bottom - top + 12, 'fill="#000000"')}</clipPath></defs>`)
    parts.push(`<path d="${areaD}" ${fillAttr(pal.down, ALPHA.area)} clip-path="url(#${CLIP_ID})"/>`)
    parts.push(`<path d="${lineD}" fill="none" ${strokeAttr(pal.down, 1, LW.line)} clip-path="url(#${CLIP_ID})"/>`)
  }
  parts.push(axisLeft({ ticks: sc.ticks, at: sc.y, fmt: tickText, x: padL, pal }))

  // リリースごと: 縦の細い線・下の短い線と名前
  for (const s of spans) {
    const bad = s === worst
    const rx = at(s.at)
    parts.push(ln(rx, top, rx, bottom, inkStroke(pal, ALPHA.faint, LW.line)))
    parts.push(ln(rx, bottom + 2, rx, bottom + 6, strokeAttr(bad ? pal.down : pal.sub, 1, LW.line)))
    const name = clip(s.label, TICK, Math.max(30, (plotR - padL) / Math.max(1, spans.length)))
    const w = textWidth(name, TICK)
    const cx = Math.min(W - 4 - w / 2, Math.max(4 + w / 2, rx))
    parts.push(text(cx, bottom + 14, name, { size: TICK, fill: bad ? pal.down : pal.sub, anchor: 'middle' }))
  }
  // 区間の平均: その区間でいちばん高い日の少し上。区間が字より狭い時と、前の字に重なる時は置かない
  let freeFrom = -Infinity
  for (const s of spans) {
    if (!Number.isFinite(s.mean)) continue
    const bad = s === worst
    const str = fmt(s.mean)
    const w = textWidth(str, bad ? VALUE : TICK, bad)
    const cx = (at(s.at) + at(s.end)) / 2
    if (at(s.end) - at(s.at) < w + 4 || cx - w / 2 < freeFrom) continue
    freeFrom = cx + w / 2 + 2
    parts.push(text(cx, sc.y(s.high) - 5, str, { size: bad ? VALUE : TICK, fill: bad ? pal.down : pal.sub, anchor: 'middle', bold: bad }))
  }

  // 見出し: 最新の値と、今のリリース（最後の日に効いているマーク）
  if (last >= 0) {
    const live = [...spans].reverse().find((s) => s.at <= last)
    const caption = tr(lang, '最新の値', 'Latest value') + (live ? `（${live.label}）` : '')
    parts.push(hero(fmt(vals[last]), caption, pal, PAD, 18, W - 4))
  }
  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種（20261019）・同じ作り。サービスの API エラー率（%）を 48 日（2026-08-23 から 2026-10-09 まで）、リリース（2・10・17・25・33・41 日目）6 回。
 * 各日はそのリリースの水準に ±12% の揺れ。v1.7 だけが 2.3% で最悪
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string, marks: { x: string, label: string }[] }}
 */
function sample() {
  const N = 48
  const rnd = seeded(20261019)
  const BEFORE = 0.9
  const RELEASES = [
    { name: 'v1.4', day: 2, level: 0.8 },
    { name: 'v1.5', day: 10, level: 0.6 },
    { name: 'v1.6', day: 17, level: 0.7 },
    { name: 'v1.7', day: 25, level: 2.3 },
    { name: 'v1.8', day: 33, level: 0.9 },
    { name: 'v1.9', day: 41, level: 0.5 },
  ]
  const values = Array.from({ length: N }, (_, d) => {
    const rel = RELEASES.filter((r) => r.day <= d).pop()
    return Math.round((rel ? rel.level : BEFORE) * (0.88 + rnd() * 0.24) * 100) / 100
  })
  const x = isoDays(2026, 8, 23, N)
  return { x, series: [{ name: 'API エラー率', values }], unit: '%', marks: RELEASES.map((r) => ({ x: x[r.day], label: r.name })) }
}

export default {
  id: 'step-line',
  title: '階段状の折れ線（Step line）',
  category: 'time',
  normalize,
  draw,
  // 幅が狭い図でも、見出しと下の 2 行の間に階段を描ける高さ（50pt）は残す
  height: (/** @type {number} */ width) => Math.max(Math.round(width * 0.5), TOP_HERO + 4 + BOTTOM_MARKS + MIN_PLOT),
  sample,
}
