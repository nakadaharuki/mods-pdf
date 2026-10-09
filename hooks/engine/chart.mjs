// @ts-check
// ECharts の option を SVG にして（vendor/echarts.mjs）、svg.mjs で Op の列にする。純な部品。
//
// 選ばなかった案
// - option をそのまま渡す: 既定の色（青系）・12px の字・アニメーション・hover 用の CSS が紙に合わない。足りない項目だけ足す（利用者の指定が常に勝つ）。
// - 軸や凡例の字の大きさを global の textStyle だけで決める: ECharts は軸の目盛りの字を 12px と明示しているので textStyle が効かない。軸と凡例には個別に既定を足す。
// - 描けなかった時に投げる: schema は「おかしい値は捨てて warnings」という約束。option が壊れていても文書全体は組めるよう、空の ops と warnings を返す。
// - 軸・凡例の字を 8pt の固定にする案: 本文 12.5pt の文書でグラフの字だけが小さく見えた。本文が 9.5pt より大きい時は theme.scale 倍する。
// - SVG を二重に ClipOp で包む: svgToOps の clip 自動判定は切り、四角で切るのはここで 1 回だけ。
// - 軸の線を薄い色で残す案: look の決まり（枠と軸の線を引かない・目盛りの刻みも無し）に合わない。0 の補助線が土台の線の代わりをする。
//   利用者が axisLine・axisTick に何か指定した時だけ線を出す（指定を無視して消さない）。
// - ECharts の registerTheme で look の見た目を登録する案: 登録は大域に残り、文書をまたいで効く。option に足せば 1 回の組みで閉じ、利用者の指定が常に勝つ。
// - 系列色に grad の全部を使う案: 紫から橙まで色相が離れ、3 系列目が 1 系列目と近い青紫になって見分けにくい。accent・accent2・sub・ink の順にし、grad は面の濃淡（下に向けて透明になる）に使う。
// - 棒にも勾配: 単色の系列が全部勾配になると「目立たせるのは 1 つだけ」に反する。勾配は面グラフの塗りだけ。

import { renderSvg } from '../vendor/echarts.mjs'
import { svgToOps } from './svg.mjs'

// 型は svg.mjs の物と同じ形。動的な取り込みを探す静的な検査があるので、型のための取り込みも書かない
/** @typedef {{ t: string, [key: string]: any }} Op */
/** @typedef {{ ascent: number, descent: number, adv: (cp: number) => number }} FontLike */

/** mono の灰と黒の系列色（本人の好み: 青を主役にしない）。末尾 2 つは上げ下げ */
const MONO_SERIES = ['#111111', '#6B6B6B', '#A3A3A0', '#3D3D3D', '#C9C9C5']
const FALLBACK = { ink: '#111111', sub: '#4A4A4A', rule: '#CCCCC9', up: '#176639', down: '#A31F1C', paper: '#FFFFFF' }
const FONT_FAMILY = 'Noto Sans JP'
/** 本文 9.5pt の時の値。本文が大きい時は theme.scale 倍する */
const BASE_FONT_SIZE = 8

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** @param {string} hex #rrggbb @param {number} a @returns {string | null} */
function rgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * 系列の色。mono（grad が単色）は墨の濃さで分ける。色のある theme は accent → accent2 → sub → ink → 灰の順
 * @param {{ ink: string, sub: string, accent?: string, accent2?: string, grad?: string[], up: string, down: string }} c
 */
function seriesColors(c) {
  const grad = Array.isArray(c.grad) ? c.grad : []
  const flat = grad.length < 2 || grad.every((g) => g === grad[0])
  if (flat || !c.accent || !c.accent2) return [...MONO_SERIES, c.up, c.down]
  return [c.accent, c.accent2, c.sub, c.ink, '#A3A3A0', c.up, c.down]
}

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
 * 1 つの軸（または軸の配列）に既定を足す。2 本目以降の値軸の補助線は出さない（目盛りの刻みが 1 本目と合わず、補助線が二重に見えるため）。
 * 軸の線・目盛りは既定で消す（show: false）。利用者が axisLine・axisTick に何か書いた時は、show を明示していなければ出す
 * @param {any} axis @param {Record<string, any>} defaults
 */
function fillAxes(axis, defaults) {
  /** @param {any} a */
  const keepUserLines = (a) => {
    for (const k of ['axisLine', 'axisTick']) if (isObj(a[k]) && a[k].show === undefined) a[k].show = true
  }
  if (Array.isArray(axis)) {
    axis.forEach((a, i) => {
      if (!isObj(a)) return
      const userShow = isObj(a.splitLine) ? a.splitLine.show : undefined
      keepUserLines(a)
      fillMissing(a, defaults)
      if (i > 0 && userShow === undefined && isObj(a.splitLine)) a.splitLine.show = false
    })
  } else if (isObj(axis)) {
    keepUserLines(axis)
    fillMissing(axis, defaults)
  }
}

/**
 * 直交座標の既定の余白と、値の字を右へ。ECharts の既定の grid（上下 60px）は 200pt の図でも描く所が 30pt しか残らない。
 * grid を利用者が書いた時は触らない（containLabel の意味が変わる）
 * @param {Record<string, any>} option
 */
function placeGrid(option) {
  if (option.xAxis === undefined && option.yAxis === undefined) return
  const has = (/** @type {any} */ v) => (Array.isArray(v) ? v.some((x) => isObj(x) && (x.show !== false)) : isObj(v) && v.show !== false)
  const titled = Array.isArray(option.title) ? option.title.some((/** @type {any} */ t) => isObj(t) && t.text) : isObj(option.title) && !!option.title.text
  if (option.grid === undefined) {
    option.grid = { left: 4, right: 4, top: 12 + (titled ? 20 : 0) + (has(option.legend) ? 22 : 0), bottom: 4, containLabel: true }
  }
  // look の決まり: 値の字は右の余白に置く。カテゴリ軸（横棒の名前など）は左のまま
  const y = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis
  if (isObj(y) && y.position === undefined && y.type !== 'category') y.position = 'right'
}

/**
 * 系列ごとの既定。線は細く点は小さく、棒は細く角を少し丸く、円は紙の色の隙間で区切り、面は系列色が下へ向けて透明になる塗り
 * @param {Record<string, any>} option @param {any[]} series @param {{ ink: string, sub: string, rule: string, paper: string }} c @param {string[]} palette
 */
function styleSeries(option, series, c, palette) {
  const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis
  const horizontal = isObj(yAxis) && yAxis.type === 'category'
  const legendOn = Array.isArray(option.legend) ? option.legend.some(isObj) : isObj(option.legend)
  series.forEach((/** @type {any} */ sr, i) => {
    if (!isObj(sr)) return
    if (sr.type === 'line') {
      fillMissing(sr, { lineStyle: { width: 1.8 }, symbolSize: 4 })
      if (Array.isArray(sr.data) && sr.data.length > 24 && sr.showSymbol === undefined) sr.showSymbol = false
    } else if (sr.type === 'bar') {
      if (sr.barMaxWidth === undefined) sr.barMaxWidth = 40
      if (sr.barCategoryGap === undefined) sr.barCategoryGap = '45%'
      if (sr.stack === undefined) fillMissing(sr, { itemStyle: { borderRadius: horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0] } })
    } else if (sr.type === 'scatter') {
      if (sr.symbolSize === undefined) sr.symbolSize = 6
    } else if (sr.type === 'pie') {
      // 凡例は上に置くので、円の中心を下げて上の項目の字と重ならないようにする
      if (sr.center === undefined && legendOn) sr.center = ['50%', '58%']
      fillMissing(sr, {
        itemStyle: { borderColor: c.paper, borderWidth: 1.5 },
        label: { color: c.sub },
        labelLine: { lineStyle: { color: c.rule } },
      })
    }
    // 面グラフ: 系列色が下へ向けて透明になる。積み上げは重なるので平らな薄い塗り。系列色が #rrggbb で読めない時も同じ
    if (isObj(sr.areaStyle) && sr.areaStyle.opacity === undefined && sr.areaStyle.color === undefined) {
      const own = (isObj(sr.lineStyle) && sr.lineStyle.color) || (isObj(sr.itemStyle) && sr.itemStyle.color) || sr.color || palette[i % palette.length]
      const top = typeof own === 'string' && sr.stack === undefined ? rgba(own, 0.2) : null
      const bottom = typeof own === 'string' ? rgba(own, 0) : null
      if (top && bottom) {
        // ECharts の面の既定の不透明度 0.7 を 1 にして、止まりの透明度をそのまま見せる
        sr.areaStyle.opacity = 1
        sr.areaStyle.color = { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] }
      } else sr.areaStyle.opacity = 0.15
    }
  })
}

/**
 * @param {Record<string, any>} option
 * @param {{ ink: string, sub: string, rule: string, up: string, down: string, paper: string, accent?: string, accent2?: string, grad?: string[] }} c
 * @param {number} scale
 */
function applyDefaults(option, c, scale) {
  const FONT_SIZE = BASE_FONT_SIZE * scale
  option.animation = false
  fillMissing(option, {
    textStyle: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, color: c.ink },
    backgroundColor: 'transparent',
  })
  if (option.color === undefined) option.color = seriesColors(c)

  const axisDefaults = {
    axisLabel: { fontSize: FONT_SIZE, color: c.sub },
    nameTextStyle: { fontSize: FONT_SIZE, color: c.sub },
    axisLine: { show: false, lineStyle: { color: c.sub } },
    axisTick: { show: false, lineStyle: { color: c.sub } },
    splitLine: { lineStyle: { color: c.rule, width: 0.5 } },
  }
  for (const key of ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis']) fillAxes(option[key], axisDefaults)
  // 題は既定が 18px で本文より目立ちすぎる。見出しは文書側（heading）が持つので、チャートの題は小さく
  const titleDefaults = { textStyle: { fontSize: 10 * scale, color: c.ink }, subtextStyle: { fontSize: FONT_SIZE, color: c.sub } }
  if (Array.isArray(option.title)) option.title.forEach((/** @type {any} */ t) => isObj(t) && fillMissing(t, titleDefaults))
  else if (isObj(option.title)) fillMissing(option.title, titleDefaults)
  placeGrid(option)
  // 面グラフの塗りは既定の不透明度 0.7 だと、黒の系列色では紙面が重くなる。薄くして線と目盛りを読めるように
  const series = Array.isArray(option.series) ? option.series : isObj(option.series) ? [option.series] : []
  styleSeries(option, series, c, Array.isArray(option.color) ? option.color : seriesColors(c))
  const legendDefaults = { textStyle: { fontSize: FONT_SIZE, color: c.ink }, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14 }
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
 * @param {{ x: number, y: number, width: number, height: number, metrics?: Record<string, FontLike>, theme?: { colors?: Partial<Record<string, string>>, scale?: number } }} opts
 * @returns {{ ops: Op[], warnings: string[] }}
 */
export function chartToOps(option, { x, y, width, height, metrics, theme }) {
  if (!isObj(option)) return { ops: [], warnings: ['チャートの option がオブジェクトではないので描きません'] }
  if (!(width > 0) || !(height > 0)) return { ops: [], warnings: ['チャートの大きさが 0 以下なので描きません'] }
  const colors = { ...FALLBACK, ...(theme && theme.colors ? theme.colors : {}) }

  let svg
  try {
    const opt = copy(option)
    applyDefaults(opt, /** @type {typeof FALLBACK} */ (colors), theme && typeof theme.scale === 'number' && theme.scale >= 1 ? theme.scale : 1)
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
