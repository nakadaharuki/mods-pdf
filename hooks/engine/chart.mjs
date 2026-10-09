// @ts-check
// ECharts の option を SVG にして（vendor/echarts.mjs）、svg.mjs で Op の列にする。純な部品。
//
// 選ばなかった案
// - option をそのまま渡す: 既定の色（青系）・12px の字・アニメーション・hover 用の CSS が紙に合わない。足りない項目だけ足す（利用者の指定が常に勝つ）。
// - 軸や凡例の字の大きさを global の textStyle だけで決める: ECharts は軸の目盛りの字を 12px と明示しているので textStyle が効かない。軸と凡例には個別に既定を足す。
// - 描けなかった時に投げる: schema は「おかしい値は捨てて warnings」という約束。option が壊れていても文書全体は組めるよう、空の ops と warnings を返す。
// - SVG を二重に ClipOp で包む: svgToOps の clip 自動判定は切り、四角で切るのはここで 1 回だけ。

import { renderSvg } from '../vendor/echarts.mjs'
import { svgToOps } from './svg.mjs'

// 型は svg.mjs の物と同じ形。動的な取り込みを探す静的な検査があるので、型のための取り込みも書かない
/** @typedef {{ t: string, [key: string]: any }} Op */
/** @typedef {{ ascent: number, descent: number, adv: (cp: number) => number }} FontLike */

/** mono の灰と黒の系列色（本人の好み: 青を主役にしない）。末尾 2 つは上げ下げ */
const MONO_SERIES = ['#111111', '#6B6B6B', '#A3A3A0', '#3D3D3D', '#C9C9C5']
const FALLBACK = { ink: '#111111', sub: '#4A4A4A', rule: '#CCCCC9', up: '#176639', down: '#A31F1C', paper: '#FFFFFF' }
const FONT_FAMILY = 'Noto Sans JP'
const FONT_SIZE = 8

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * option を壊さずに写す。関数や循環を含む option は JSON を通す（関数は落ちる）
 * @param {any} option
 */
function copy(option) {
  try {
    return structuredClone(option)
  } catch {
    return JSON.parse(JSON.stringify(option))
  }
}

/**
 * target に無い項目だけ src から足す（入れ子の物は中まで）。配列は葉として扱う
 * @param {Record<string, any>} target @param {Record<string, any>} src
 */
function fillMissing(target, src) {
  for (const k of Object.keys(src)) {
    if (target[k] === undefined) target[k] = copy(src[k])
    else if (isObj(target[k]) && isObj(src[k])) fillMissing(target[k], src[k])
  }
}

/**
 * 1 つの軸（または軸の配列）に既定を足す。2 本目以降の値軸の補助線は出さない（目盛りの刻みが 1 本目と合わず、補助線が二重に見えるため）
 * @param {any} axis @param {Record<string, any>} defaults
 */
function fillAxes(axis, defaults) {
  if (Array.isArray(axis)) {
    axis.forEach((a, i) => {
      if (!isObj(a)) return
      const userShow = isObj(a.splitLine) ? a.splitLine.show : undefined
      fillMissing(a, defaults)
      if (i > 0 && userShow === undefined && isObj(a.splitLine)) a.splitLine.show = false
    })
  } else if (isObj(axis)) fillMissing(axis, defaults)
}

/**
 * @param {Record<string, any>} option
 * @param {{ ink: string, sub: string, rule: string, up: string, down: string }} c
 */
function applyDefaults(option, c) {
  option.animation = false
  fillMissing(option, {
    textStyle: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, color: c.ink },
    backgroundColor: 'transparent',
  })
  if (option.color === undefined) option.color = [...MONO_SERIES, c.up, c.down]

  const axisDefaults = {
    axisLabel: { fontSize: FONT_SIZE, color: c.sub },
    nameTextStyle: { fontSize: FONT_SIZE, color: c.sub },
    axisLine: { lineStyle: { color: c.sub } },
    axisTick: { lineStyle: { color: c.sub } },
    splitLine: { lineStyle: { color: c.rule } },
  }
  for (const key of ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis']) fillAxes(option[key], axisDefaults)
  // 題は既定が 18px で本文より目立ちすぎる。見出しは文書側（heading）が持つので、チャートの題は小さく
  const titleDefaults = { textStyle: { fontSize: 10, color: c.ink }, subtextStyle: { fontSize: FONT_SIZE, color: c.sub } }
  if (Array.isArray(option.title)) option.title.forEach((/** @type {any} */ t) => isObj(t) && fillMissing(t, titleDefaults))
  else if (isObj(option.title)) fillMissing(option.title, titleDefaults)
  // 面グラフの塗りは既定の不透明度 0.7 だと、黒の系列色では紙面が重くなる。薄くして線と目盛りを読めるように
  const series = Array.isArray(option.series) ? option.series : isObj(option.series) ? [option.series] : []
  for (const sr of series) {
    if (isObj(sr) && isObj(sr.areaStyle) && sr.areaStyle.opacity === undefined && sr.areaStyle.color === undefined) sr.areaStyle.opacity = 0.15
  }
  const legendDefaults = { textStyle: { fontSize: FONT_SIZE, color: c.ink } }
  /** @param {any} l */
  const legendFill = (l) => {
    if (!isObj(l)) return
    fillMissing(l, legendDefaults)
    // ECharts 6 の凡例の既定位置は下。利用者が grid.bottom を小さく指定すると軸の目盛りに重なる（LLM の option は凡例が上にある前提で書かれている）。位置の指定が 1 つも無い時だけ上に置く
    if (l.top === undefined && l.bottom === undefined && l.left === undefined && l.right === undefined) l.top = 4
  }
  if (Array.isArray(option.legend)) option.legend.forEach(legendFill)
  else legendFill(option.legend)
}

/**
 * ECharts の option を、四角 (x, y, width, height) の中に描く Op の列にする。
 * 返す ops は、その四角で切る ClipOp が 1 つ。描けなければ ops は空で、理由は warnings
 * @param {Record<string, any>} option
 * @param {{ x: number, y: number, width: number, height: number, metrics?: Record<string, FontLike>, theme?: { colors?: Partial<Record<string, string>> } }} opts
 * @returns {{ ops: Op[], warnings: string[] }}
 */
export function chartToOps(option, { x, y, width, height, metrics, theme }) {
  if (!isObj(option)) return { ops: [], warnings: ['チャートの option がオブジェクトではないので描きません'] }
  if (!(width > 0) || !(height > 0)) return { ops: [], warnings: ['チャートの大きさが 0 以下なので描きません'] }
  const colors = { ...FALLBACK, ...(theme && theme.colors ? theme.colors : {}) }

  let svg
  try {
    const opt = copy(option)
    applyDefaults(opt, /** @type {typeof FALLBACK} */ (colors))
    svg = renderSvg(opt, { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ops: [], warnings: [`チャートを描けませんでした: ${msg}`] }
  }

  // pt をそのまま px として渡したので、SVG は四角に 1:1（丸めた分だけの縮尺）で写る
  const r = svgToOps(svg, { x, y, width, height, metrics, color: colors.ink, paper: colors.paper, clip: false, quietStyle: true })
  if (r.ops.length === 0) return { ops: [], warnings: [...r.warnings, 'チャートに描く物がありませんでした（series の type や data を確かめてください）'] }
  return { ops: [{ t: 'clip', x, y, w: width, h: height, ops: r.ops }], warnings: r.warnings }
}
