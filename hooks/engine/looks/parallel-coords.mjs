// @ts-check
// parallel-coords（平行座標）: 複数の項目を、単位の違う何本かの縦の軸（元の見本は星・行数・年数・フック数・閲覧数の 5 本）に通る 1 本の折れ線で比べる。
// 元は look の designs/parallel-coords.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 軸ごとに、その軸の最小から最大までを縦いっぱいに使う。目盛りは両端の最小と最大だけで、共通の単位が無いので
// 線の形で比べる。静かな線は墨の 18%・1 本ずつ、軸は墨の 14% の細い道（candle は軸の線を引かないので、データの下に敷く程度）。目立たせるのは 1 本だけで、
// その線の値を全部の軸に書く。軸の両端には 4pt の足を打つ。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる線は mono で墨 100%・1.5pt（元は 1px の橙）。静かな線は 18% のまま（細い線の下限 18% と同じ）。
// - 目立たせる線の値は、元は「地の色の四角」を敷いて静かな線を隠した。紙では paper の下敷き（紙の白の 85%）を敷く。値が線の邪魔をしないよう、
//   次の軸へ下がる線の時は点の上・上がる線の時は点の下に置く（元と同じ決まり）。線が軸の端（最小か最大）に居る軸は、端の字を太字の accent にして値を兼ねさせる
//   （別の字を重ねると、同じ数が 2 つ重なって読めなかった）。ほかの字に重なる値は、反対側へ置き替え、それも重なるなら置かない。
// - 元の見本は 24 項目だが、docs/looks.md の 3 章の系列の上限は 12。見本は 12 本（静かな 11 + 目立たせる 1）。
// - 目立たせる線は data.highlight（系列の名前）。無ければ先頭の系列（radar の先頭の系列と同じ決まり。元は最後の系列を目立たせた）。
// - 軸の名前と両端の値は 7.5pt の sub。値は 1 万以上を「2.13万」（英語は K・M）に縮める。軸の右の目立たせる値は 8pt の太字。
// - 元は下の左の「SAMPLE 24 MODS」を置いたが、紙は件数と、軸ごとの尺度の読み方（最小から最大）を置く。右下に凡例（目立たせる線の名前）。
// - 数の無い値がある系列は、線が途中で切れて読めないので捨てて warnings に書く。
// 選ばなかった案
// - 全部の軸を共通の尺度にそろえる案: 単位の違う軸（売上と日数）では、片方の線が潰れる。軸ごとに最小から最大に引き伸ばす。
// - 静かな線を 12 本より多く描く案: 12 本を超えると線が帯になり、目立たせる 1 本以外は読めない。上限は 3 章の系列の上限と同じ。
import { ALPHA, TICK, VALUE, f, inkStroke, strokeAttr, fillAttr, hotStroke, hot, seriesStroke, text, line, circle, strokePath, underlay, svgDoc, empty, num, compact, autoDigits, textWidth, clip, linear, keep, nameOf, toNum, arr, tr, legend, seeded, VALUE_MAX, LW, overlaps, polyline } from './paper.mjs'

const MAX_AXES = 12
const PAD = 4
const NAME_Y = 10
const TOP = 28
const BOTTOM_FROM_BOTTOM = 30

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[] }} Series */
/** @typedef {{ axes: string[], series: Series[], hot: number }} ParallelData */

/**
 * @param {unknown} data { axes: string[], series: { name, values }[], highlight? }
 * @returns {{ data: ParallelData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.axes) || !Array.isArray(src.series)) warnings.push('平行座標: axes（軸の名前の列）と series（{ name, values } の列）がありません')
  const axes = keep(arr(src.axes).map((a) => nameOf(a) || '–'), MAX_AXES, warnings, '平行座標: 軸')
  if (axes.length === 1) warnings.push('平行座標: 軸が 1 本だけなので描けません（2 本以上の軸が要ります）')
  let bad = 0
  /** @type {Series[]} */
  let series = []
  for (const s of arr(src.series)) {
    const values = s && typeof s === 'object' && Array.isArray(s.values) ? axes.map((_, k) => toNum(s.values[k])) : []
    if (!values.length || values.some((v) => !(Math.abs(v) <= VALUE_MAX))) { bad++; continue }
    series.push({ name: nameOf(s.name) || '–', values })
  }
  if (bad) warnings.push(`平行座標: 軸の数だけ ±1,000 兆の中の数が並んでいない系列 ${bad} 個を捨てました`)
  series = keep(series, 12, warnings, '平行座標: 系列')
  const want = nameOf(src.highlight)
  let hotIdx = series.length ? 0 : -1
  if (want) {
    const at = series.findIndex((s) => s.name === want)
    if (at >= 0) hotIdx = at
    else warnings.push(`平行座標: highlight の名前「${want}」が series にありません。先頭の系列を目立たせます`)
  }
  return { data: { axes: axes.length >= 2 ? axes : [], series: axes.length >= 2 ? series : [], hot: hotIdx }, warnings }
}

/**
 * @param {ParallelData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const axes = data.axes
  const series = data.series
  if (axes.length < 2 || !series.length) return empty(o)
  const n = axes.length
  const hotS = series[data.hot]
  const quiet = series.filter((_, i) => i !== data.hot)
  const bottom = H - BOTTOM_FROM_BOTTOM

  // 軸ごとの範囲と、値の字（1 万以上は縮める。小数は軸の幅から決める）
  const ranges = axes.map((_, k) => {
    const vs = series.map((s) => s.values[k])
    return [Math.min(...vs), Math.max(...vs)]
  })
  const fmts = axes.map((_, k) => {
    const [lo, hi] = ranges[k]
    const whole = series.every((s) => Number.isInteger(s.values[k]))
    const dg = whole ? 0 : autoDigits(hi - lo)
    return (/** @type {number} */ v) => (Math.abs(v) >= 1e4 ? compact(v, lang) : num(v, dg))
  })
  const labelW = axes.map((a, k) => Math.max(textWidth(a, TICK), textWidth(fmts[k](ranges[k][0]), TICK), textWidth(fmts[k](ranges[k][1]), TICK)))
  const hotText = axes.map((_, k) => fmts[k](hotS.values[k]))
  const x0 = PAD + labelW[0] / 2
  const x1 = Math.max(x0 + 40, W - PAD - Math.max(labelW[n - 1] / 2, 6 + textWidth(hotText[n - 1], VALUE, true) + 4))
  const ax = (/** @type {number} */ k) => x0 + ((x1 - x0) * k) / (n - 1)
  const spacing = (x1 - x0) / (n - 1)
  const ay = axes.map((_, k) => linear(ranges[k][0], ranges[k][1], bottom, TOP))
  const pathOf = (/** @type {Series} */ s) => polyline(s.values.map((v, k) => /** @type {[number, number]} */ ([ax(k), ay[k](v)])))

  /** @type {string[]} */
  const parts = []
  /** 置いた字の枠。目立たせる値の字が、すでにある字に 1pt より近いかを調べる（paper の overlaps） */
  /** @type {{ x0: number, y0: number, x1: number, y1: number }[]} */
  const boxes = []
  // 軸: 細い道・両端の 4pt の足・名前と最大・最小。目立たせる線が端に居る軸は、端の字がその値を兼ねる（太字の accent）
  axes.forEach((a, k) => {
    const x = ax(k)
    parts.push(line(x, TOP, x, bottom, inkStroke(pal, ALPHA.track, LW.line)))
    for (const yy of [TOP, bottom]) parts.push(line(x - 2, yy, x + 2, yy, strokeAttr(pal.sub, 1, LW.line)))
    parts.push(text(x, NAME_Y, clip(a, TICK, Math.max(30, spacing - 6)), { size: TICK, fill: pal.sub, anchor: 'middle' }))
    // 全部の系列が同じ値の軸は、端の字を 1 つだけ（最小と最大が同じ値で、同じ数が上下に 2 つ並ぶ）
    for (const upper of ranges[k][0] === ranges[k][1] ? [true] : [true, false]) {
      const v = ranges[k][upper ? 1 : 0]
      const str = fmts[k](v)
      const y = upper ? TOP - 5 : bottom + 11
      const mine = hotS.values[k] === v
      const w = textWidth(str, mine ? VALUE : TICK, mine)
      parts.push(text(x, y, str, mine ? { size: VALUE, fill: pal.accent, anchor: 'middle', bold: true } : { size: TICK, fill: pal.sub, anchor: 'middle' }))
      boxes.push({ x0: x - w / 2, y0: y - 7, x1: x + w / 2, y1: y + 2 })
    }
  })
  series.forEach((s, i) => { if (i !== data.hot) parts.push(strokePath(pathOf(s), seriesStroke(pal, i, data.hot, LW.line) ?? inkStroke(pal, ALPHA.card, LW.line))) })
  parts.push(strokePath(pathOf(hotS), hotStroke(pal, 1, LW.hot, 1)))

  // 目立たせる線の値: 下敷きの上に。次の軸へ下がる線は点の上、上がる線は点の下、同じ高さなら横。端の字・先に置いた値の字に重なる時は別の置き方を試し、
  // どれも重なるなら字を置かない（点は残る）。軸が詰まる幅で、字が団子になるより 1 つ抜く方を選んだ
  const h = hot(pal, 1, 1)
  axes.forEach((_, k) => {
    const x = ax(k)
    const v = hotS.values[k]
    const y = ay[k](v)
    parts.push(circle(x, y, 2, fillAttr(h.color, 1)))
    if (v === ranges[k][0] || v === ranges[k][1]) return
    const next = k < n - 1 ? ay[k + 1](hotS.values[k + 1]) : y
    const bases = next > y ? [y - 4, y + 11] : next < y ? [y + 11, y - 4] : [y + 3, y - 4, y + 11]
    const w = textWidth(hotText[k], VALUE, true) + 4
    for (const base of bases) {
      const box = { x0: x + 4, y0: base - 8.5, x1: x + 4 + w, y1: base + 2.5 }
      if (boxes.some((b) => overlaps(b, box, 1))) continue
      boxes.push(box)
      parts.push(underlay(x + 4, base - 8.5, w, 11, pal))
      parts.push(text(x + 6, base, hotText[k], { size: VALUE, fill: pal.accent, bold: true }))
      break
    }
  })

  const key = legend(W - PAD, H - 4, [{ label: clip(hotS.name, TICK, W * 0.3), mark: 'line', attr: hotStroke(pal, 1, LW.hot, 1) }], pal, { anchor: 'end' })
  parts.push(key.svg)
  const note = tr(lang, `${num(series.length)} 件・軸ごとに最小から最大まで`, `${num(series.length)} items, each axis from its min to its max`)
  parts.push(text(PAD, H - 4, clip(note, TICK, W - key.width - 2 * PAD - 12), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（種 20261021・24 本）の考え方を、12 店舗・5 本の軸に直した。新しい店は若いのに売上が高い（元の cost-meter と同じ数） */
function sample() {
  const rnd = seeded(20261021)
  const names = ['駅前店', '港店', '北口店', '中央店', '西町店', '東通り店', '丘の上店', '湖畔店', '駅南店', '本町店', '空港店']
  const axes = ['売上（万円）', '在庫（点）', '開店から（日）', 'スタッフ（人）', '来店（30 日）']
  const quiet = names.map((name) => {
    const quality = rnd()
    const age = Math.round(4 + rnd() * 406)
    const sales = Math.round(3 + quality ** 1.4 * 1150 * (0.35 + (0.65 * age) / 410))
    const stock = Math.round(180 + rnd() ** 1.6 * 9400)
    const staff = Math.min(12, Math.max(1, Math.round(1 + stock / 1000 + (rnd() - 0.5) * 3)))
    const visits = Math.round(400 + sales * (14 + rnd() * 22))
    return { name, values: [sales, stock, age, staff, visits] }
  })
  return { axes, series: [{ name: '新宿南口店', values: [640, 2380, 46, 5, 21300] }, ...quiet], highlight: '新宿南口店' }
}

export default {
  id: 'parallel-coords',
  title: '平行座標（Parallel coordinates）',
  category: 'compare',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(Math.min(340, width * 0.5)),
  sample,
}
