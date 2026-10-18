// @ts-check
// streamgraph（流れの面）: 1 年（52 週）の週ごとの作業時間を、種類ごとの 6 本の流れにして、動く中心線のまわりに積む。名前と割合は流れの中の、いちばん太い所に置く。
// 元は look の designs/streamgraph.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 積み方と面は d3-shape の stack()（stackOffsetWiggle・stackOrderInsideOut）と area()・curveBasis（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
// 元をたどると Byron と Wattenberg の「Stacked Graphs」（2008）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 中心線のずれは stackOffsetWiggle（流れの傾きが小さくなる）・並びは stackOrderInsideOut（大きい流れが真ん中）・曲線は curveBasis。
// 目立たせる以外の流れは墨の 3 段（12%・25%・42%）を共有し、いちばん大きい流れがいちばん薄い。隣り合う流れは同じ段にならない。頁を埋める面なので、目立たせる流れも濃くしすぎない
// （元は 55%。90% にして試した所、面が candle より目立った）。流れの間は 1pt の細い線（地の色）で分ける。名前と割合は、流れの厚みが 11pt 以上ある所のいちばん太い所に置く。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる流れは data.highlight の系列だけ（無ければ全部が墨の段）。mono では accent が墨なので 80%（paper の monoArea）で、
//   その上に墨の字は読めないので、名前には紙の色の下敷き（underlay）を敷く。
// - 名前を置ける所の無い流れ（細すぎる・図が狭い）は、元では名前が消えた。紙では名前が無いと読めないので、下に札（凡例）で並べる（収まらなければ段を足す）。
// - 数でない値と負の値は 0 にして warnings に書く。元の 0.1 の下限は置かない（0 の週は流れが細くなる、が data の形）。
// - 元の左下の「SAMPLE …」は置かない。右下の「TOTAL」は、右下の「合計」（chord・sankey・dendrogram・lollipop と同じ所・同じ TICK の sub）。下の x の字は等間隔（元は月の初め）。字は pt で、元の 10px・9px は紙の 8・7.5。
// 選ばなかった案
// - 名前を置けない流れを黙って落とす案（元のまま）: 紙は読む人が data を知らない。名前の無い面は意味が無い。
// - 流れの面を墨の 3 段でなく系列の見た目の段（seriesStyle）にする案: 面は線と違い、点線で分けられない。
import { stack, area, stackOffsetWiggle, stackOrderInsideOut, curveBasis } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, fillAttr, hotFill, seriesFill, seam, text, legend, underlay, svgDoc, empty, num, withUnit, percent, textWidth, clip, linear, midline, tr, decimals, seeded, inkStroke, LW } from './paper.mjs'
import { readSeries, evenLabels, xTexts, isoDays } from './time-series.mjs'

const PAD = 4
/** 名前を置くのに要る流れの厚み（pt）。8pt の字に上下 1.5pt ずつ */
const MIN_THICK = 11
/** ずつ薄くする段。非目立たせる流れが共有する（元の 12%・25%・42%） */
const STEPS = [ALPHA.grid, ALPHA.area, ALPHA.dim]
const LEGEND_ROW = 12
const X_ROW = 18
/** 名前が流れの中に収まるのはこの数まで（これを超えた分は札で並べる前提で高さを決める）・図の上の余白・流れを描く高さの最低 */
const INLINE_MAX = 6
const TOP_PAD = 8
const MIN_PLOT = 70

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[], unit: string }} Row */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */
/** @typedef {[number, number][] & { key: number, index: number }} Layer d3 の stack が返す 1 つの流れ（点ごとの [下, 上]） */

/**
 * @param {unknown} data { x, series: [{ name, values }], unit?, highlight? }
 * @returns {{ data: TimeData, warnings: string[] }}
 */
function normalize(data) {
  const { data: d, warnings } = readSeries(data, '流れの面')
  let fixed = 0
  const rows = d.rows.map((r) => ({ ...r, values: r.values.map((v) => { if (Number.isFinite(v) && v >= 0) return v; fixed++; return 0 }) }))
  if (fixed) warnings.push(`流れの面: 欠測と負の値 ${fixed} 個を 0 にしました（積む形は負の流れを描けません）`)
  return { data: { ...d, rows }, warnings }
}

/**
 * 凡例の札を W に収まる段に分ける（札の幅は paper の legend と同じ見積もり）。draw と height が同じ数え方をする
 * @param {string[]} names 流れの名前（系列の番号の順） @param {number[]} keys 札にする流れ @param {number} W
 */
function packLegend(names, keys, W) {
  /** @type {number[][]} */
  const out = []
  let width = 0
  for (const k of keys) {
    const w = 7 + 3 + textWidth(names[k], TICK) + 10
    if (!out.length || width + w > W - 2 * PAD) { out.push([k]); width = w } else { out[out.length - 1].push(k); width += w }
  }
  return out
}

/**
 * 流れごとの面の墨の段。目立たせる流れは別（-1）。いちばん大きい流れが最初に、隣（積み順）と同じ段にならない中で、使われた回数が少なく薄い段を取る
 * @param {{ key: number, index: number, total: number }[]} byPos 積み順（下から）
 * @param {number} hotK 目立たせる流れの系列の番号（無ければ -1）
 * @returns {Map<number, number>} 系列の番号 → 墨の濃さ
 */
export function pickSteps(byPos, hotK) {
  /** @type {Map<number, number>} */
  const got = new Map()
  const rest = byPos.filter((s) => s.key !== hotK).sort((a, b) => b.total - a.total || a.key - b.key)
  for (const s of rest) {
    const near = [byPos[s.index - 1], byPos[s.index + 1]].map((t) => (t ? got.get(t.key) : undefined))
    const uses = (/** @type {number} */ a) => [...got.values()].filter((v) => v === a).length
    const free = STEPS.filter((a) => !near.includes(a)).sort((a, b) => uses(a) - uses(b) || a - b)
    got.set(s.key, free[0] ?? STEPS[0])
  }
  return got
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
  const K = rows.length
  const table = Array.from({ length: n }, (_, i) => Object.fromEntries(rows.map((r, k) => [k, r.values[i]])))
  const layers = /** @type {Layer[]} */ (/** @type {any} */ (stack()).keys(rows.map((_, k) => k)).offset(stackOffsetWiggle).order(stackOrderInsideOut)(table))
  const totals = rows.map((r) => r.values.reduce((s, v) => s + v, 0))
  const grand = totals.reduce((s, v) => s + v, 0)
  const unit = d.unit || rows[0].unit
  const hotK = d.highlight
  const lo = Math.min(...layers.flatMap((l) => l.map((p) => p[0])))
  const hi = Math.max(...layers.flatMap((l) => l.map((p) => p[1])))
  const left = PAD
  const right = W - PAD
  const at = (/** @type {number} */ i) => (n > 1 ? left + ((right - left) * i) / (n - 1) : (left + right) / 2)
  const step = n > 1 ? (right - left) / (n - 1) : right - left
  const top = TOP_PAD
  const names = rows.map((r) => clip(r.name, LABEL, W * 0.3))
  const byPos = layers.map((s) => ({ key: s.key, index: s.index, total: totals[s.key], layer: s })).sort((a, b) => a.index - b.index)
  const steps = pickSteps(byPos, hotK)

  /**
   * 名前を置く場所を決める（bottom に依る）。置けない流れは null
   * @param {number} bottom
   */
  const place = (bottom) => {
    const y = linear(lo, hi, bottom, top)
    return byPos.map((s) => {
      const thick = (/** @type {number} */ i) => y(s.layer[i][0]) - y(s.layer[i][1])
      const share = grand > 0 ? s.total / grand : 0
      for (const label of [`${names[s.key]} ${percent(share)}`, names[s.key]]) {
        const half = Math.ceil(textWidth(label, LABEL) / 2 / Math.max(step, 1e-6)) + 1
        /** @type {{ i: number, min: number } | null} */
        let best = null
        for (let i = half; i < n - half; i++) {
          let min = Infinity
          for (let j = i - half; j <= i + half; j++) min = Math.min(min, thick(j))
          if (min >= MIN_THICK && (!best || min > best.min)) best = { i, min }
        }
        if (best) return { key: s.key, label, i: best.i, y: (y(s.layer[best.i][0]) + y(s.layer[best.i][1])) / 2 }
      }
      return null
    })
  }
  // 合計は右下（chord・sankey・dendrogram・lollipop と同じ所）。凡例の段は合計の字の幅を空けて詰める
  const totalText = `${tr(lang, '合計', 'Total')} ${withUnit(num(grand, grand >= 100 ? 0 : decimals(rows.flatMap((r) => r.values))), unit)}`
  const legendRows = (/** @type {number[]} */ keys) => packLegend(names, keys, W - textWidth(totalText, TICK) - 12)

  // 凡例の段の数は、名前を置けない流れの数で決まり、段の数は図の下を決め、図の下は名前を置ける流れを決める。安定するまで（最大 4 回）やり直す
  let reserve = 0
  /** @type {ReturnType<typeof place>} */
  let placed = []
  for (let it = 0; it < 5; it++) {
    placed = place(H - X_ROW - 8 - Math.max(1, reserve) * LEGEND_ROW)
    const need = legendRows(byPos.filter((_s, q) => placed[q] === null).map((s) => s.key)).length
    if (need <= reserve) break
    reserve = need
  }
  // 下の段は少なくとも 1 段（合計の字の段。凡例の札があれば同じ段の左に並ぶ）
  const bottom = H - X_ROW - 8 - Math.max(1, reserve) * LEGEND_ROW
  const y = linear(lo, hi, bottom, top)
  const shape = area().x((/** @type {any} */ _p, /** @type {number} */ i) => at(i)).y0((/** @type {number[]} */ p) => y(p[0])).y1((/** @type {number[]} */ p) => y(p[1])).curve(curveBasis).digits(2)

  /** @type {string[]} */
  const parts = []
  for (const s of byPos) {
    const fill = s.key === hotK ? hotFill(pal, ALPHA.body) : (seriesFill(pal, s.key, hotK, 0.6) ?? fillAttr(pal.ink, steps.get(s.key) ?? STEPS[0]))
    parts.push(`<path d="${shape(/** @type {any} */ (s.layer)) ?? ''}" ${fill} ${seam(pal)}/>`)
  }
  placed.forEach((p) => {
    if (!p) return
    const w = textWidth(p.label, LABEL)
    if (p.key === hotK) parts.push(underlay(at(p.i) - w / 2 - 2, p.y - 6.5, w + 4, 13, pal))
    parts.push(text(at(p.i), midline(p.y, LABEL), p.label, { size: LABEL, fill: pal.ink, anchor: 'middle' }))
  })
  parts.push(evenLabels(xTexts(d.x, lang), at, { lo: 4, hi: W - 4 }, bottom + 14, pal))
  // 名前を置けなかった流れの札（積み順の並びで、段に折り返す）
  const unnamed = byPos.filter((_s, q) => placed[q] === null).map((s) => s.key)
  legendRows(unnamed).forEach((row, r) => {
    const keys = row.map((k) => ({
      label: names[k],
      /** @type {'box'} */ mark: 'box',
      attr: `${k === hotK ? hotFill(pal, ALPHA.body) : (seriesFill(pal, k, hotK, 0.6) ?? fillAttr(pal.ink, steps.get(k) ?? STEPS[0]))} ${inkStroke(pal, ALPHA.ref, LW.hair)}`,
    }))
    parts.push(legend(PAD, H - 4 - (reserve - 1 - r) * LEGEND_ROW, keys, pal).svg)
  })
  parts.push(text(W - PAD, H - 4, totalText, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種（20261020）・同じ作り。52 週（2025-10-13 から 2026-10-05 の月曜）の作業時間を、種類 6 つ。3 週で均して流れにする。値は時間（元の百万トークンの 10 倍）。
 * 新機能は 34 時間前後・不具合修正は 3 月の初めに山・改善は 12 月・テストは 4 月から増え・文書は 15 時間前後・自動化は 5 月の 2 時間未満から 10 月に最大へ
 * @returns {{ x: string[], series: { name: string, values: number[] }[], unit: string, highlight: string }}
 */
function sample() {
  const N = 52
  const rnd = seeded(20261020)
  const bump = (/** @type {number} */ t, /** @type {number} */ at, /** @type {number} */ width) => Math.exp(-(((t - at) / width) ** 2) / 2)
  const rise = (/** @type {number} */ t, /** @type {number} */ at, /** @type {number} */ width) => 1 / (1 + Math.exp(-(t - at) / width))
  const KEYS = ['features', 'bugs', 'tests', 'refactor', 'docs', 'agents']
  /** @type {Record<string, number>[]} */
  const raw = []
  for (let t = 0; t < N; t++) {
    const nz = () => (rnd() - 0.5) * 0.5
    raw.push({
      features: 3.4 + 0.7 * Math.sin(t / 7) + nz(),
      bugs: 1.5 + 2.2 * bump(t, 20, 3.5) + nz(),
      tests: 0.9 + 2.0 * rise(t, 24, 4) + nz(),
      refactor: 1.1 + 2.2 * bump(t, 9, 5) + nz(),
      docs: 1.4 + 0.6 * bump(t, 33, 6) + nz() * 0.6,
      agents: 0.15 + 4.2 * rise(t, 31, 4.5) + nz() * 0.6,
    })
  }
  const smooth = (/** @type {string} */ key) => raw.map((_, t) => {
    const win = [t - 1, t, t + 1].filter((i) => i >= 0 && i < N)
    return Math.round(Math.max(0.1, win.reduce((s, i) => s + raw[i][key], 0) / win.length) * 100) / 10
  })
  const NAMES = ['新機能', '不具合修正', 'テスト', '改善', '文書', '自動化']
  return { x: isoDays(2025, 10, 13, N, 7), series: KEYS.map((k, i) => ({ name: NAMES[i], values: smooth(k) })), unit: '時間', highlight: '自動化' }
}

export default {
  id: 'streamgraph',
  title: '流れの面（Streamgraph）',
  category: 'time',
  normalize,
  draw,
  // 流れが 7 つ以上なら、7 つ目からは細くて名前を置けないとみて、その札の段の分だけ高くする（札が積み重なって図の外へ出ない）
  height: (/** @type {number} */ width, /** @type {TimeData} */ data) => {
    const rows = data?.rows ?? []
    const names = rows.map((r) => clip(r.name, LABEL, width * 0.3))
    const legend = rows.length > INLINE_MAX ? packLegend(names, rows.map((_, k) => k).slice(INLINE_MAX), width).length : 0
    return Math.max(Math.round(width * 0.52), TOP_PAD + MIN_PLOT + X_ROW + 8 + Math.max(1, legend) * LEGEND_ROW)
  },
  sample,
}
