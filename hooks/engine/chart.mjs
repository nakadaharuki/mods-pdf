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
// 見本・テーマ（assets/echarts/）
// - 描く時にファイルを読む案: 組版（layoutDoc）は同期で、図の draw の中から非同期は呼べない。組む前に本体が loadChartAssets で読み、ここはモジュールの変数から引く。
// - 素材の置き場を引数で全部の関数に通す案: figure → chartToOps の途中の 3 つの部品の形が変わる。読んだ物はモジュールの変数に覚える（フォントを本体が覚えるのと同じ）。
// - 見本から要らない部品を丸ごと消す案: dataZoom を消すと表示範囲が全データに広がり、visualMap を消すと heatmap の色が消える。範囲と色は残して、操作の部品（スライダーの持ち手・再生ボタン）だけ外す。
// - 見本と利用者の option を配列の中まで重ねる案: series の要素を index で重ねると、利用者が series を 1 つ書いた時に見本の 2 本目が残る。配列は丸ごと置き換える。
// - ECharts の組み込みのテーマにも look の色の既定（軸・字・格子線の色）を足す案: option は init のテーマに勝つので、選んだテーマの色が全部消える。組み込みのテーマの時は大きさ・余白・形の既定だけ足す。

import { renderSvg } from '../vendor/echarts.mjs'
import { svgToOps } from './svg.mjs'
import { lookPal } from './theme.mjs'

/** 見本・テーマの JSON の読み込みの上限（B）。フックのファイル読みの 1 回の上限と同じ */
const READ_MAX = 4 * 1024 * 1024
/** 覚えておく見本の数（大きい見本は数 MB ある） */
const EXAMPLES_KEPT = 24
/** 1 回の入力で読む見本の数 */
const NEEDS_MAX = 60
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
/** ModsPDF の 4 つのテーマ。themes.json の中でほかの 36 個（ECharts の組み込み）と区別する */
const OWN_THEMES = ['mono', 'koma', 'mergeble', 'vivid']

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
 * 系列の色。色のテーマは図の形（looks）と同じ lookPal の 8 色（同じ項目が図ごとに違う色にならないため）。mono は墨の濃さで分ける
 * @param {{ ink: string, sub: string, accent?: string, accent2?: string, grad?: string[], up: string, down: string }} c
 */
function seriesColors(c) {
  const s = c.accent ? lookPal({ colors: { ...c, grad: Array.isArray(c.grad) ? c.grad : [] } }).series : undefined
  return Array.isArray(s) && s.length ? [...s] : [...MONO_SERIES, c.up, c.down]
}

/**
 * 色の既定を外した写し。キーが color か〜Color の物を落とし、空になった入れ子も落とす
 * @param {Record<string, any>} v
 * @returns {Record<string, any>}
 */
function withoutColor(v) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const k of Object.keys(v)) {
    if (k === 'color' || /Color$/.test(k)) continue
    const x = v[k]
    if (isObj(x)) {
      const y = withoutColor(x)
      if (Object.keys(y).length) out[k] = y
    } else out[k] = x
  }
  return out
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
 * @param {boolean} [plain] 組み込みのテーマ。色の既定は足さない
 */
function styleSeries(option, series, c, palette, plain = false) {
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
      // 名前の幅は SSR が見積もって「…」で切る（紙には余白があるので切らない）
      const pieDefaults = {
        itemStyle: { borderColor: c.paper, borderWidth: 1.5 },
        label: { color: c.sub },
        labelLine: { lineStyle: { color: c.rule } },
      }
      fillMissing(sr, plain ? withoutColor(pieDefaults) : pieDefaults)
      fillMissing(sr, { label: { overflow: 'none' } })
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
function applyDefaults(option, c, scale, mode = {}) {
  const FONT_SIZE = Math.max(BASE_FONT_SIZE * scale, mode.textMin ?? 0)
  // 組み込みのテーマ（mode.plain）の時は色の既定を足さない（足すとテーマの色が全部消える）。ModsPDF のテーマの時は色の列だけテーマに任せる
  const keep = mode.plain ? withoutColor : (/** @type {any} */ v) => v
  option.animation = false
  fillMissing(option, keep({
    textStyle: { fontFamily: FONT_FAMILY, fontSize: FONT_SIZE, color: c.ink },
    backgroundColor: 'transparent',
  }))
  if (option.color === undefined && !(mode.theme && Array.isArray(mode.theme.color))) option.color = seriesColors(c)

  const axisDefaults = {
    axisLabel: { fontSize: FONT_SIZE, color: c.sub },
    nameTextStyle: { fontSize: FONT_SIZE, color: c.sub },
    axisLine: { show: false, lineStyle: { color: c.sub } },
    axisTick: { show: false, lineStyle: { color: c.sub } },
    splitLine: { lineStyle: { color: c.rule, width: 0.5 } },
  }
  for (const key of ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis']) fillAxes(option[key], mode.plain ? withoutColor(axisDefaults) : axisDefaults)
  // 題は既定が 18px で本文より目立ちすぎる。見出しは文書側（heading）が持つので、チャートの題は小さく
  const titleDefaults = keep({ textStyle: { fontSize: Math.max(10 * scale, mode.textMin ?? 0), color: c.ink }, subtextStyle: { fontSize: FONT_SIZE, color: c.sub } })
  if (Array.isArray(option.title)) option.title.forEach((/** @type {any} */ t) => isObj(t) && fillMissing(t, titleDefaults))
  else if (isObj(option.title)) fillMissing(option.title, titleDefaults)
  placeGrid(option)
  // 面グラフの塗りは既定の不透明度 0.7 だと、黒の系列色では紙面が重くなる。薄くして線と目盛りを読めるように
  const series = Array.isArray(option.series) ? option.series : isObj(option.series) ? [option.series] : []
  styleSeries(option, series, c, Array.isArray(option.color) ? option.color : mode.theme && Array.isArray(mode.theme.color) ? mode.theme.color : seriesColors(c), mode.plain === true)
  const legendDefaults = keep({ textStyle: { fontSize: FONT_SIZE, color: c.ink }, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14 })
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
 * @typedef {{
 *   x: number, y: number, width: number, height: number, metrics?: Record<string, FontLike>,
 *   theme?: { name?: string, colors?: Partial<Record<string, string>>, scale?: number },
 *   textMin?: number,
 * }} ChartOpts textMin は図の中の字の下限（pt。資料の図は 9）
 */

/**
 * 描く本体。themeObj は init に渡す ECharts のテーマ（見本・theme を使う図だけ。無ければ今までの描き方）
 * @param {any} option
 * @param {ChartOpts} opts
 * @param {Record<string, any> | null} themeObj
 * @param {boolean} plain 組み込みのテーマ（色の既定を足さない）
 * @returns {{ ops: Op[], warnings: string[] }}
 */
function drawChart(option, { x, y, width, height, metrics, theme, textMin }, themeObj, plain) {
  if (!isObj(option)) return { ops: [], warnings: ['チャートの option がオブジェクトではないので描きません'] }
  if (!(width > 0) || !(height > 0)) return { ops: [], warnings: ['チャートの大きさが 0 以下なので描きません'] }
  const colors = { ...FALLBACK, ...(theme && theme.colors ? theme.colors : {}) }

  let svg
  try {
    const opt = copy(option)
    applyDefaults(opt, /** @type {typeof FALLBACK} */ (colors), theme && typeof theme.scale === 'number' && theme.scale >= 1 ? theme.scale : 1, { theme: themeObj ?? undefined, plain, textMin: textMin && textMin > 0 ? textMin : undefined })
    const size = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
    svg = renderSvg(opt, themeObj ? { ...size, theme: themeObj } : size)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ops: [], warnings: [`チャートを描けませんでした: ${msg}`] }
  }

  // pt をそのまま px として渡したので、SVG は四角に 1:1（丸めた分だけの縮尺）で写る
  const r = svgToOps(svg, { x, y, width, height, metrics, color: colors.ink, paper: colors.paper, clip: false, quietStyle: true })
  if (r.ops.length === 0) return { ops: [], warnings: [...r.warnings, 'チャートに描く物がありませんでした（series の type や data を確かめてください）'] }
  return { ops: [{ t: 'clip', x, y, w: width, h: height, ops: r.ops }], warnings: r.warnings }
}

/**
 * ECharts の option を、四角 (x, y, width, height) の中に描く Op の列にする。
 * 返す ops は、その四角で切る ClipOp が 1 つ。描けなければ ops は空で、理由は warnings
 * @param {Record<string, any>} option
 * @param {ChartOpts} opts
 * @returns {{ ops: Op[], warnings: string[] }}
 */
export function chartToOps(option, opts) {
  return drawChart(option, opts, null, false)
}

// ---------------------------------------------------------------- 素材（見本・テーマ・目録）

/**
 * 読んだ素材。モジュールの変数に覚える（次の組版では読まない）。描く側は同期なので、本体が組む前に loadChartAssets で読んでおく
 * @type {{ themes: Record<string, any> | null, themesError: string | null, catalog: any[] | null, catalogError: string | null, examples: Map<string, any>, errors: Map<string, string> }}
 */
const assets = { themes: null, themesError: null, catalog: null, catalogError: null, examples: new Map(), errors: new Map() }

/** 試験で素材を空に戻す */
export function resetChartAssets() {
  assets.themes = null
  assets.themesError = null
  assets.catalog = null
  assets.catalogError = null
  assets.examples.clear()
  assets.errors.clear()
}

/**
 * 読み込みの口。root は plugin の根、read は絶対の場所から字を読む関数（本体がフックのファイル読みを包んで渡す。1 回 4 MiB まで）
 * @typedef {{ root: string, read: (path: string) => Promise<string> }} AssetIO
 */

/** @param {string} root @param {string} rel */
const join = (root, rel) => `${String(root).replace(/[\\/]+$/, '')}/${rel}`

/**
 * JSON の素材を 1 つ読む。大きすぎる・壊れている時は投げず、理由を返す
 * @param {AssetIO} io @param {string} rel
 * @returns {Promise<{ value: any } | { error: string }>}
 */
async function readJson(io, rel) {
  let text
  try {
    text = await io.read(join(io.root, rel))
  } catch (e) {
    return { error: `${rel} を読めなかった: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof text !== 'string') return { error: `${rel} が字でない` }
  if (text.length > READ_MAX) return { error: `${rel} が ${READ_MAX} 字を超えるので使わなかった` }
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { error: `${rel} の JSON が壊れている` }
  }
}

/**
 * 原稿の入力（道具の引数）から、要る素材を拾う。見本の id は "example": "…" の字から（Markdown の中の囲みも含む）。
 * 選ばなかった案: normalize を通して chart の Block から拾う案。組みの前にもう 1 回 normalize が走る。字の走査なら余分に読むのは最悪でも見本 60 本まで
 * @param {unknown} input
 * @returns {{ examples: string[], themes: boolean }}
 */
export function chartAssetNeeds(input) {
  /** @type {string} */
  let s = ''
  try {
    s = typeof input === 'string' ? input : JSON.stringify(input) ?? ''
  } catch {
    s = ''
  }
  /** @type {Set<string>} */
  const ids = new Set()
  for (const m of s.matchAll(/\\?"example\\?"\s*:\s*\\?"([A-Za-z0-9][A-Za-z0-9_-]{0,79})/g)) {
    ids.add(m[1])
    if (ids.size >= NEEDS_MAX) break
  }
  const hasThemeKey = /\\?"theme\\?"\s*:\s*\\?"[A-Za-z0-9_-]+/.test(s)
  return { examples: [...ids], themes: ids.size > 0 || (hasThemeKey && /chart/.test(s)) }
}

/**
 * 素材を読んでモジュールの変数に覚える。読めた物は 2 度読まない。読めなかった物は理由を覚えて描く時に warnings に書き、次の組みでもう一度読む（一時の失敗を覚えっぱなしにしない）
 * @param {AssetIO} io
 * @param {{ examples?: string[], themes?: boolean, catalog?: boolean }} needs
 */
export async function loadChartAssets(io, needs) {
  if (needs.themes && assets.themes === null) {
    const r = await readJson(io, 'assets/echarts/themes.json')
    if ('error' in r) assets.themesError = r.error
    else if (isObj(r.value)) assets.themes = r.value
    else assets.themesError = 'assets/echarts/themes.json がオブジェクトでない'
  }
  if (needs.catalog && assets.catalog === null) {
    const r = await readJson(io, 'assets/echarts/catalog.json')
    if ('error' in r) assets.catalogError = r.error
    else if (Array.isArray(r.value)) assets.catalog = r.value
    else assets.catalogError = 'assets/echarts/catalog.json が配列でない'
  }
  for (const id of needs.examples ?? []) {
    if (assets.examples.has(id)) continue
    assets.errors.delete(id)
    if (!ID_RE.test(id)) {
      assets.errors.set(id, `example "${id.slice(0, 40)}" は英数字と _ - だけの名前ではないので使わなかった`)
      continue
    }
    const r = await readJson(io, `assets/echarts/examples/${id}.json`)
    if ('error' in r) assets.errors.set(id, `example "${id}" は見本に無いか読めなかった（${r.error}）`)
    else if (isObj(r.value) && isObj(r.value.option)) {
      assets.examples.set(id, r.value)
      // 古い物から手放す（見本は大きい物で数 MB ある）
      while (assets.examples.size > EXAMPLES_KEPT) assets.examples.delete(/** @type {string} */ (assets.examples.keys().next().value))
    } else assets.errors.set(id, `example "${id}" に option が無い`)
  }
}

/** 目録（pdf_examples の道具が使う）。まだ読んでいなければ catalog は null */
export function chartCatalog() {
  return { catalog: assets.catalog, error: assets.catalogError }
}

/** 読み済みの見本（無ければ null） @param {string} id */
export function chartExample(id) {
  return assets.examples.get(id) ?? null
}

// ---------------------------------------------------------------- 見本を紙に合わせる

/** 紙に要らない部品（hover・操作のためだけの物）。範囲や色を決める物は落とさない */
const PAPER_DROP = ['toolbox', 'tooltip', 'brush', 'axisPointer']

/** @param {Record<string, any>} o 見本の option の 1 つ（timeline の baseOption・options の 1 つも） */
function stripOne(o) {
  for (const k of PAPER_DROP) delete o[k]
  // スライダーを消すと表示範囲が全データに広がる。範囲を決める inside に替える
  for (const z of seriesList(o.dataZoom)) if (isObj(z) && z.type === 'slider') z.type = 'inside'
  // 細い段や小さい値のラベルが重なると読めない。ECharts の重なりの除け（hideOverlap）を、見本が決めていなければ付ける。
  // 選ばなかった案: 重なったラベルを描いてから検査で見つける案（直せないので、描く前に ECharts に除けさせる）
  for (const sr of seriesList(o.series)) if (isObj(sr) && !isObj(sr.labelLayout)) sr.labelLayout = { hideOverlap: true }
  // 色の凡例は残し、持ち手だけ外す（消すと heatmap の色が消える）
  for (const v of seriesList(o.visualMap)) if (isObj(v)) v.calculable = false
  if (isObj(o.timeline)) {
    o.timeline.autoPlay = false
    o.timeline.loop = false
    o.timeline.controlStyle = { ...(isObj(o.timeline.controlStyle) ? o.timeline.controlStyle : {}), show: false }
  }
}

/** 見本の option から紙に要らない部品を落とす（書き換える） @param {Record<string, any>} option */
export function stripForPaper(option) {
  stripOne(option)
  if (isObj(option.baseOption)) stripOne(option.baseOption)
  if (Array.isArray(option.options)) for (const o of option.options) if (isObj(o)) stripOne(o)
}

/**
 * base に over を深く重ねる。配列は丸ごと置き換える
 * @param {Record<string, any>} base @param {Record<string, any>} over
 */
function overlay(base, over) {
  for (const k of Object.keys(over)) {
    if (k === '__proto__') continue
    if (isObj(over[k]) && isObj(base[k])) overlay(base[k], over[k])
    else base[k] = copy(over[k])
  }
}

/** 配列か 1 つの object かを配列にそろえる @param {any} v @returns {any[]} */
function seriesList(v) {
  return Array.isArray(v) ? v : isObj(v) ? [v] : []
}

/**
 * data を option に置く。
 *   [[…], …]（2 次元の配列）か { source } → dataset の source（無ければ最初の series の data）
 *   { series: [{ name, data }] } → series を前から順に重ねる（足りなければ最後の series を写して足す）
 *   { categories: […] } → カテゴリ軸の data
 * @param {Record<string, any>} option @param {unknown} data @param {string[]} warnings
 */
function applyData(option, data, warnings) {
  /** @param {unknown} rows */
  const putRows = (rows) => {
    const ds = Array.isArray(option.dataset) ? (option.dataset.find((/** @type {any} */ d) => isObj(d) && d.source !== undefined) ?? option.dataset[0]) : option.dataset
    if (isObj(ds)) {
      ds.source = rows
      return
    }
    const sr = seriesList(option.series)[0]
    if (isObj(sr)) sr.data = rows
    else warnings.push('data を置く dataset も series も無いので使わなかった')
  }
  if (Array.isArray(data)) {
    putRows(data)
    return
  }
  if (!isObj(data)) {
    warnings.push('data は配列か { series } の形だけなので使わなかった')
    return
  }
  if (data.source !== undefined) putRows(data.source)
  if (Array.isArray(data.categories)) {
    const axes = [...seriesList(option.xAxis), ...seriesList(option.yAxis)].filter(isObj)
    const cat = axes.find((a) => a.type === 'category') ?? axes[0]
    if (cat) cat.data = data.categories
    else warnings.push('categories を置く軸が無いので使わなかった')
  }
  if (Array.isArray(data.series)) {
    if (!Array.isArray(option.series)) option.series = seriesList(option.series)
    /** @type {any[]} */
    const list = option.series
    data.series.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (!isObj(s)) return
      if (!isObj(list[i])) {
        const last = list[list.length - 1]
        list[i] = isObj(last) ? copy(last) : { type: 'bar' }
        // 写した系列の名前と値は、渡された物で置き換わるまで残さない
        delete list[i].name
        delete list[i].data
      }
      Object.assign(list[i], copy(s))
    })
    // 見本の凡例は元の系列の名前を並べている。系列から決まるようにする
    for (const l of seriesList(option.legend)) if (isObj(l) && Array.isArray(l.data)) delete l.data
  }
}

/**
 * 図の Block（example・theme・data・option）を、組み込む option と ECharts のテーマにする
 * @param {Record<string, any>} block
 * @param {string | undefined} docTheme 文書のテーマの名前
 * @returns {{ option: Record<string, any> | null, themeObj: Record<string, any> | null, plain: boolean, warnings: string[] }}
 */
export function resolveChartBlock(block, docTheme) {
  /** @type {string[]} */
  const warnings = []
  /** @type {Record<string, any> | null} */
  let option = null
  const userOption = isObj(block.option) ? block.option : null
  if (typeof block.example === 'string') {
    const ex = assets.examples.get(block.example)
    if (ex) {
      option = copy(ex.option)
      stripForPaper(option)
      const f = isObj(ex.flags) ? ex.flags : {}
      if (f.needsMap) warnings.push(`見本 ${block.example} は地図の見本で、地図のデータが無いので図の一部しか描けません`)
      if (f.needsData && block.data === undefined) warnings.push(`見本 ${block.example} は外のデータを読む見本です。data を渡さないと軸と枠だけの図になります`)
      if (f.lostRenderItem) warnings.push(`見本 ${block.example} は描き方の関数（renderItem）を持つ見本で、関数が無いので軸しか描けません`)
      if (Array.isArray(f.truncated) && f.truncated.length) warnings.push(`見本 ${block.example} の長い data は途中で切ってあります。data を渡してください`)
    } else {
      warnings.push(assets.errors.get(block.example) ?? `example "${String(block.example).slice(0, 40)}" は読み込んでいない見本です`)
    }
  }
  const fromExample = option !== null
  if (option === null && userOption) option = copy(userOption)
  if (option !== null) {
    if (block.data !== undefined && block.data !== null) applyData(option, block.data, warnings)
    if (fromExample && userOption) overlay(option, userOption)
  }

  /** @type {Record<string, any> | null} */
  let themeObj = null
  /** @type {string | undefined} */
  let name = typeof block.theme === 'string' ? block.theme : docTheme
  if (assets.themes === null) {
    if (typeof block.theme === 'string' || fromExample) warnings.push(assets.themesError ?? 'テーマの素材（themes.json）を読んでいないので、文書の色で描く')
    name = undefined
  } else if (name !== undefined && !Object.prototype.hasOwnProperty.call(assets.themes, name)) {
    if (typeof block.theme === 'string') warnings.push(`theme "${block.theme.slice(0, 40)}" は themes.json に無いので文書のテーマで描く`)
    name = docTheme !== undefined && Object.prototype.hasOwnProperty.call(assets.themes, docTheme) ? docTheme : undefined
  }
  if (name !== undefined && assets.themes !== null) themeObj = assets.themes[name]
  return { option, themeObj, plain: name !== undefined && !OWN_THEMES.includes(name), warnings }
}

/** 見本・theme・data のどれかを使う図か（使わなければ今までの描き方をそのまま通す） @param {Record<string, any>} block */
export function usesChartAssets(block) {
  return typeof block.example === 'string' || typeof block.theme === 'string' || (block.data !== undefined && block.data !== null && block.kind === undefined)
}

/**
 * chart の Block を四角の中に描く Op の列にする。example・theme・data があれば見本とテーマを使い、無ければ chartToOps と同じ
 * （素材は loadChartAssets で先に読んでおく。知らない見本・壊れた素材は投げず warnings に書く）
 * @param {Record<string, any>} block
 * @param {ChartOpts} opts
 * @returns {{ ops: Op[], warnings: string[] }}
 */
export function chartBlockToOps(block, opts) {
  if (!usesChartAssets(block)) return chartToOps(block.option, opts)
  const r = resolveChartBlock(block, opts.theme && typeof opts.theme.name === 'string' ? opts.theme.name : undefined)
  if (r.option === null) return { ops: [], warnings: [...r.warnings, 'チャートの元になる option がありません（example を読めなかったか、option を渡していません）'] }
  const d = drawChart(r.option, opts, r.themeObj, r.plain)
  return { ops: d.ops, warnings: [...r.warnings, ...d.warnings] }
}
