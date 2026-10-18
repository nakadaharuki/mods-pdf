// @ts-check
// bars（零を中心にした棒）: 1 時間ごとの 24 本の増減を、零の線の上下に上げ・下げの色で並べる。candle の足と同じ作りで、2 つの図が 1 つの体系に読める。
// 元は look の designs/bars.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 棒は 1 本の幅（スロット）の 62% で、上げ下げの色の 55% の塗り。上と下は同じ目盛り。
// 目盛りの端は切りのよい値（値の最大の絶対値の 1.12 倍を、目盛りの間隔に切り上げる）で、+端・0・-端の 3 つだけを字にする。零の線は墨の 35%。
// いちばん大きい棒（絶対値）だけが先の外に値を持つ（プラスは上・マイナスは下）。枠と軸の線は引かない。
//
// 紙に写して変えた所
// - 暗い地は塗らない。値が全部 0 以上（か全部 0 以下）の時は、上下対称にすると半分が空くので、零を端にした片側の目盛り（0・半分・端）にする。
// - 下の x の字は、元の「00・06・12・18」のように、字の幅から決めた等間隔（time-series の evenLabels）。元の右下の「SAMPLE」は置かない。
// - 目盛りと値の字は単位つき（単位は data の unit か、系列の unit）。字は pt で、元の 9px・9px は紙の 7.5・8（太字）。
// - 棒が 200 本を超える時は、等間隔に間引く（time-series の POINTS_MAX と別に、棒は 1pt 以上の幅が要るので 200）。
// 選ばなかった案
// - 上げを枠だけの棒にして白黒印刷でも上げ下げを分ける案: 元の「全部 55% の塗り」と形が変わる。上げ下げは pal.up・pal.down の差（緑と赤）に任せる（candle と同じ）。
import { ALPHA, VALUE, fillAttr, inkStroke, text, line, rect, svgDoc, empty, num, signed, withUnit, tickStep, linear, textWidth, axisLeft, seeded, LW } from './paper.mjs'
import { readSeries, yScale, extentOf, evenLabels, xTexts, scalePad, X_ROW } from './time-series.mjs'

/** 棒の本数の上限。plotW 440pt で 1 本が 2.2pt */
const MAX_BARS = 200
const TOP = 16
const PAD_RIGHT = 8

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/**
 * @param {unknown} data { x, series: [{ name, values, unit? }], unit?, highlight? }（棒は 1 系列。複数なら highlight の系列か先頭）
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  const { data: d, warnings } = readSeries(data, '棒グラフ', { max: MAX_BARS })
  if (d.rows.length > 1) warnings.push('棒グラフ: 系列が複数あるので、highlight の系列（無ければ先頭）の 1 本だけを描きます')
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
  const [lo, hi] = extentOf(vals)
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi))
  const want = (maxAbs || 1) * 1.12
  const step = tickStep(0, want, 3)
  const T = Math.ceil(want / step - 1e-9) * step
  const mixed = lo < 0 && hi > 0
  // 目盛りは 3 つ: 両側なら -T・0・T、片側なら 0・T/2・T（全部が 0 以下なら -T・-T/2・0）
  const [vLo, vHi] = mixed ? [-T, T] : hi <= 0 && lo < 0 ? [-T, 0] : [0, T]
  const tickVals = mixed ? [T, 0, -T] : vLo < 0 ? [0, -T / 2, -T] : [T, T / 2, 0]
  const bottom = H - X_ROW - 4
  const y = linear(vLo, vHi, bottom, TOP)
  const zeroY = y(0)
  const digits = yScale(vLo, vHi, TOP, bottom, { count: 3 }).digits
  const tickText = (/** @type {number} */ v) => withUnit(mixed ? signed(v, digits) : num(v, digits), unit)
  const labelsL = tickVals.map(tickText)
  const padL = scalePad(labelsL)
  const plotR = W - PAD_RIGHT
  const n = vals.length
  const slot = (plotR - padL) / n
  const bw = Math.max(1, slot * 0.62)
  const cx = (/** @type {number} */ i) => padL + slot * (i + 0.5)

  /** @type {string[]} */
  const parts = []
  parts.push(axisLeft({ ticks: tickVals, at: y, fmt: tickText, x: padL, pal }))
  parts.push(line(padL, zeroY, plotR, zeroY, inkStroke(pal, ALPHA.ref, LW.line)))
  let big = -1
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) return
    if (big < 0 || Math.abs(v) > Math.abs(vals[big])) big = i
    const top = Math.min(y(v), zeroY)
    const h = Math.max(1, Math.abs(y(v) - zeroY))
    parts.push(rect(cx(i) - bw / 2, top, bw, h, fillAttr(v >= 0 ? pal.up : pal.down, ALPHA.body)))
  })
  // いちばん大きい棒は、先の外に値を置く（プラスは棒の上・マイナスは棒の下）
  if (big >= 0) {
    const v = vals[big]
    const s = withUnit(mixed ? signed(v, digits) : num(v, digits), unit)
    const w = textWidth(s, VALUE, true)
    const x = Math.min(W - 4 - w / 2, Math.max(4 + w / 2, cx(big)))
    parts.push(text(x, v >= 0 ? y(v) - 4 : y(v) + VALUE + 3, s, { size: VALUE, fill: pal.ink, anchor: 'middle', bold: true }))
  }
  parts.push(evenLabels(xTexts(d.x, lang), cx, { lo: 4, hi: W - 4 }, H - 4, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種・同じ歩き（24 時間・やや上に偏る）。会員の純増（人）
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261010)
  const values = Array.from({ length: 24 }, () => Math.round((rnd() - 0.45) * 520))
  return { x: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`), series: [{ name: '会員の純増', values }], unit: '人' }
}

export default {
  id: 'bars',
  title: '棒グラフ（零を中心）',
  category: 'time',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.56),
  sample,
}

