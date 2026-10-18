// @ts-check
// multi-line（複数の折れ線）: 4 つの店の来店客数を 60 日分、細い線で重ねる。目立たせる 1 本だけが濃く、ほかは薄くて後ろへ退く。
// 元は look の designs/multi-line.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 線は 1pt。目立たせる 1 本が見出しの数（最初から最後までの増減の %。data から計算する）を持つ。
// 線の右端に点を打ち、右の余白に名前と最後の値を並べる。最後の値が同じ（見本の 2 本）時のために、ラベルの中心どうしを 11pt 以上離す 2 回の押し分け（paper の dodge）をし、
// 短い引き出し線で、線の端の点とラベルをつなぐ。目盛りは左に短い線と字、薄い横の線を 3 本ほど。軸の線は引かない。目立たせる線を最後に描き、交わりの上に載せる。
//
// 紙に写して変えた所
// - 暗い地は塗らない。薄い線の濃さ（元は 0.9・0.6・0.42）は、紙では系列の見た目の段（paper の seriesStyle。55%・30%・点線）。
//   mono では accent が墨なので、目立たせる線は墨 100% の 1.5pt にして、ほかの線（最大 55%）と 1pt の差も付ける。
// - 色のテーマ（pal.series がある紙）では、線を墨の濃さと点線でなく系列の色で分ける。目立たせる 1 本は accent（series[0]）の 1.5pt、ほかは series[1…] を 70% の 1pt で。点線は使わない。
// - 目立たせる 1 本は data.highlight（系列の名前）。無ければ、最初から最後の値までの増減の割合（絶対値）がいちばん大きい系列。
// - 値の目盛りは data の範囲を切りのよい値に広げた物（元は 10k〜70k の固定）。下の x の字は等間隔（元は月の初めの日）。元の下の「SAMPLE …」は置かない。
// - 値の単位は系列ごとに持てる（series[i].unit。無ければ data.unit）。字は pt で、元の 10px・11px は紙の 8・8（太字）。
// 選ばなかった案
// - 最後の値のラベルを、押し分けずに線の端の高さへ置く案: 同じ値で終わる 2 本（見本の新宿店と池袋店）の字が重なって読めない。
// - 目立たせる線を選べない（最初の値が 0 か欠測で割合が出ない）時に、仮の 1 本を選ぶ案: 見出しの数が嘘になる。その時は見出しを置かず、線は全部 seriesStyle で描く。
import { ALPHA, LABEL, VALUE, TONE, inkFill, fillAttr, strokeAttr, hot, hotFill, hotStroke, seriesStyle, seriesColor, seriesStroke, text, line, circle, strokePath, svgDoc, empty, num, withUnit, percent, textWidth, clip, dodge, midline, tr, decimals, axisLeft, hero, seeded, LW } from './paper.mjs'
import { readSeries, lastIndex, extentOf, yScale, scalePad, evenLabels, xTexts, linePath, isoDays, TOP_HERO, X_ROW } from './time-series.mjs'

const PAD = 4
/** 最後の値の差がこれより小さいラベルは押し分ける（8pt の字の中心どうし。元は 11px の値と 1px の空き = 12px） */
const GAP = 11
const LEADER = 12

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/**
 * @param {unknown} data { x, series: [{ name, values, unit? }], unit?, highlight? }
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  return readSeries(data, '複数の折れ線')
}

/** 最初の数の値から最後の数の値への増減の比（最初が 0 か欠測なら NaN） @param {number[]} values */
function change(values) {
  const first = values.find(Number.isFinite)
  const last = values[lastIndex(values)]
  return first === undefined || last === undefined || first === 0 ? NaN : last / first - 1
}

/**
 * @param {TimeData} d
 * @param {DrawOpts} o
 */
function draw(d, o) {
  const { width: W, height: H, pal, lang } = o
  if (!d.rows.length) return empty(o)
  const rows = d.rows
  const n = d.n
  // 目立たせる 1 本: highlight か、増減の割合（絶対値）がいちばん大きい系列
  let hotK = d.highlight
  if (hotK < 0) {
    let best = 0
    rows.forEach((r, k) => { const c = Math.abs(change(r.values)); if (c > best) { best = c; hotK = k } })
  }
  const ratio = hotK >= 0 ? change(rows[hotK].values) : NaN
  const hasHero = Number.isFinite(ratio)
  const top = (hasHero ? TOP_HERO : 12) + 4
  const bottom = H - X_ROW - 2
  const [lo, hi] = [Math.min(...rows.map((r) => extentOf(r.values)[0])), Math.max(...rows.map((r) => extentOf(r.values)[1]))]
  const sc = yScale(lo, hi, top, bottom, { count: 4 })
  const unitOf = (/** @type {Row} */ r) => r.unit || d.unit
  const tickText = (/** @type {number} */ v) => withUnit(num(v, sc.digits), d.unit || rows[0].unit)
  const digits = decimals(rows.flatMap((r) => r.values))
  const lastK = rows.map((r) => lastIndex(r.values))
  const finals = rows.map((r, k) => withUnit(num(r.values[lastK[k]], digits), unitOf(r)))
  const valW = Math.max(...finals.map((s) => textWidth(s, VALUE, true)))
  const padL = scalePad(sc.ticks.map(tickText))
  // 名前の列に残せる幅: 線の幅を 60pt は残す（狭い図では名前を「…」で切る）
  const room = W - PAD - padL - 60 - valW - 8 - 4 - LEADER - 4
  // 残りが 24pt に満たない狭い図では名前を置かない（最後の値は置く）
  const names = rows.map((r) => (room < 24 ? '' : clip(r.name, LABEL, Math.min(W * 0.18, room))))
  const nameW = Math.max(...names.map((s, k) => textWidth(s, LABEL, k === hotK)))
  const plotR = Math.max(padL + 40, W - PAD - valW - 8 - nameW - 4 - LEADER - 4)
  const at = (/** @type {number} */ i) => (n > 1 ? padL + ((plotR - padL) * i) / (n - 1) : (padL + plotR) / 2)

  /** @type {string[]} */
  const parts = []
  if (hasHero) {
    const first = d.x[rows[hotK].values.findIndex(Number.isFinite)] ?? ''
    const lastX = d.x[lastK[hotK]] ?? ''
    const [fx, lx] = [xTexts([first], lang)[0], xTexts([lastX], lang)[0]]
    const span = fx && lx ? tr(lang, `（${fx} から ${lx}）`, ` (${fx} to ${lx})`) : ''
    parts.push(hero(percent(ratio, 0, true), `${rows[hotK].name}${span}`, pal, PAD, 18, W - 4))
  }
  // 左の目盛りと、薄い横の線（目盛りのところ）
  for (const t of sc.ticks) parts.push(line(padL, sc.y(t), plotR, sc.y(t), strokeAttr(pal.ink, ALPHA.faint, LW.line)))
  parts.push(axisLeft({ ticks: sc.ticks, at: sc.y, fmt: tickText, x: padL, pal }))

  // 後ろから前へ: 薄い線を先に、目立たせる線を最後に（交わりの上に載る）
  const styleOf = new Map()
  let rest = 0
  rows.forEach((_, k) => { if (k !== hotK) styleOf.set(k, seriesStyle(rest++, hotK >= 0)) })
  const order = [...rows.keys()].filter((k) => k !== hotK).reverse()
  if (hotK >= 0) order.push(hotK)
  for (const k of order) {
    /** @type {[number, number][]} */
    const pts = rows[k].values.map((v, i) => [at(i), Number.isFinite(v) ? sc.y(v) : NaN])
    const st = styleOf.get(k)
    const colored = hotK >= 0 && k !== hotK ? null : seriesStroke(pal, k, hotK, k === hotK ? LW.hot : LW.line)
    parts.push(strokePath(linePath(pts), colored ?? (k === hotK ? hotStroke(pal, 1, LW.hot) : strokeAttr(pal.ink, st.a, LW.line, st.dash))))
  }

  // 右端: 点・引き出し線・名前・最後の値。ラベルは GAP 以上に押し分ける
  const ends = rows.map((r, k) => (lastK[k] >= 0 ? sc.y(r.values[lastK[k]]) : NaN))
  const live = rows.map((_, k) => k).filter((k) => lastK[k] >= 0)
  const placed = dodge(live.map((k) => ends[k]), GAP, top, bottom)
  const textHot = hot(pal, 1).color
  live.forEach((k, j) => {
    const isHot = k === hotK
    const st = styleOf.get(k)
    const ex = at(lastK[k])
    const ly = placed[j]
    const tone = hotK >= 0 && !isHot ? null : seriesColor(pal, k, hotK)
    const toneA = isHot ? 1 : TONE.lineRest
    parts.push(circle(ex, ends[k], 2, tone !== null ? fillAttr(tone, toneA) : isHot ? hotFill(pal, 1, 1) : inkFill(pal, st.a)))
    const leader = `M${ex + 4} ${ends[k]}L${plotR + 8} ${ly}H${plotR + LEADER}`
    parts.push(strokePath(leader, tone !== null ? strokeAttr(tone, toneA, LW.line) : isHot ? hotStroke(pal, 1, LW.line) : strokeAttr(pal.ink, st.a, LW.line)))
    parts.push(text(plotR + LEADER + 4, midline(ly, LABEL), names[k], { size: LABEL, fill: isHot ? textHot : pal.sub, bold: isHot }))
    parts.push(text(W - PAD, midline(ly, VALUE), finals[k], { size: VALUE, fill: isHot ? textHot : pal.ink, anchor: 'end', bold: isHot }))
  })
  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種（20261017）・同じ歩き。4 つの店の 1 日の来店客数（人）を 2026-08-11 から 60 日。
 * 渋谷店が目立たせる 1 本で、391 から 614 へ増える（+57%）。新宿店と池袋店は同じ数で終わる
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string, highlight: string }}
 */
function sample() {
  const N = 60
  const rnd = seeded(20261017)
  const STORES = [
    { name: '渋谷店', from: 38, to: 63, wobble: 2.6 },
    { name: '新宿店', from: 43, to: 47, wobble: 2.2 },
    { name: '池袋店', from: 31, to: 46, wobble: 2.0 },
    { name: '横浜店', from: 19, to: 21, wobble: 1.6 },
  ]
  const series = STORES.map((s) => {
    let w = 0
    const values = Array.from({ length: N }, (_, i) => {
      w = 0.7 * w + (rnd() - 0.5) * s.wobble
      return Math.round((s.from + ((s.to - s.from) * i) / (N - 1) + w) * 10)
    })
    return { name: s.name, values }
  })
  return { x: isoDays(2026, 8, 11, N), series, unit: '人', highlight: '渋谷店' }
}

export default {
  id: 'multi-line',
  title: '複数の折れ線（Multi-line chart）',
  category: 'time',
  normalize,
  draw,
  // 右の余白の名前が系列の数だけ縦に並ぶ（1 つ 11pt）ので、系列が多い時は高くする
  height: (/** @type {number} */ width, /** @type {TimeData} */ data) => Math.max(Math.round(width * 0.52), 70 + GAP * (data?.rows?.length ?? 4)),
  sample,
}
