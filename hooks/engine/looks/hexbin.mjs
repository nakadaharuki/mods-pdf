// @ts-check
// hexbin（ヘキサビン図）: 点が多すぎて円では潰れる時、平面を六角形の升に分けて、升ごとの点の数を墨の濃さで見せる。
// 元の見本は 3,000 回の Claude Code のターンを、かかった時間と出力トークン数で升に分けた物（半径 8 の六角形・小さな 1,900 件の「すぐ直す」と大きな 1,100 件の「長く動く」の 2 つのかたまり）。
// 元は look の designs/hexbin.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 升に分けるのは d3-hexbin の hexbin()（d3-hexbin 0.2.2・BSD-3-Clause・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり）: 升は半径 R で分け、描くのは半径 R の 91%（8 に対して 7.3）の 6 つの角。隣どうしの間に、heatmap の升と同じ髪の毛ほどの地の隙間が走る。
// 濃さは墨を、点の数 / 最大 の平方根に合わせて重ねる（すぐ直す核は長く動く雲の 8 倍ほどの点が 1 升にあり、点の数に比例させると雲が「空き」の濃さに張りついた）。
// 凡例は 5 つの見本を「少」から「多」へ読む（升は連続の濃さ・凡例だけ 5 つは heatmap と同じ）。いちばん点の多い升だけが目立たせる 1 つ（look の Claude の橙の縁）。六角形の格子は、点の範囲の左下から敷く（d3-hexbin の既定は角から敷くので、
// 0 の線の下に 1 段はみ出した）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。濃さは heatmap と同じ paper の shade（紙の下限 8% から）で、上だけ 85% でなく 75% まで（升の間の隙間が 1pt ほどしかなく、目立たせる縁が隣の升に触れる。85% の升に 100% の縁を重ねても、mono では見分けられない）。
//   目立たせる升は、色のある紙では pal.accent の縁・mono では墨 100% の太い縁（ほかの升は 75% 以下の面で、縁が無い）。
// - 升の半径は図の大きさで決める（元は 380px の欄で 8）。plot の幅と高さの積の平方根の 1/31 を 5〜11 に収め、升が 4,000 を超えないよう広げる（Op の上限 20,000 を守る）。
// - 点の範囲（0 から始めるかは、最小が最大の 35% 以下かで決める）は、四方を升の半径 R だけ内側へ寄せて置く。範囲の端にある点の升が、軸の棒や数にはみ出さない
//   （元は点の範囲を data の外へ出せない前提で「これらの上限で升は軸を越えない」と頭の文に書いた。別の data では成り立たない）。
// - 元の「Quick edits」「Agent runs」の字は、それぞれの群の升から最も近い、どの升とも重ならない空きに置く（data の座標に字を決め打ちしない）。群は points と同じ長さの groups（点ごとの名前）で渡す。
//   最大の升の字「PEAK 179」は「最多 179」で、升の上の空きに線でつなぐ。上に空きが無ければ、最も近い空きに置く。
// - 点の範囲を示す題は、左上に縦の題（yLabel）・目盛りの右端に横の題（xLabel）。下は左に件数・右に「少 … 多」の凡例。
// 選ばなかった案
// - 升の数を直接指定する案: data の量と図の大きさで升の見た目が変わる。半径を図から決める。
// - 升の濃さを点の数に比例させる案: 元の頭の文のとおり、雲が空きの濃さに張りつく。平方根にする。
import { hexbin } from '../../vendor/d3.mjs'
import { TICK, LABEL, VALUE, inkFill, fillAttr, rampColor, hotStroke, fillPath, strokePath, text, line, svgDoc, empty, num, textWidth, clip, tr, linear, keep, seeded, axisBottom, axisLeft, tickSet, freeSpot, polyline, shade, shadeLegend, LW } from './paper.mjs'
import { readPoints, extentOf, boundsOf, normalOf, round } from './spread-kit.mjs'

const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 24
const BOTTOM_FROM_BOTTOM = 30
const MAX_GROUPS = 3
/** 升の数の目安の上限（Op の数を守る） */
const MAX_CELLS = 4000
/** 描く六角形の半径 / 升の半径（元は 7.3 / 8） */
const DRAWN = 0.9125
/** 濃さの上限（75%）。heatmap の 85% にしない理由は頭の文 */
const SHADE_HI = 0.75

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ x: number, y: number, size: number, g: number, name: string }} Pt */
/** @typedef {{ pts: Pt[], groups: string[], xLabel: string, yLabel: string }} HexData */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */

/**
 * @param {unknown} data { points: [x, y][], xLabel?, yLabel?, groups?: 点ごとの群の名前 }
 * @returns {{ data: HexData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const read = readPoints(src, warnings, 'ヘキサビン図', MAX_GROUPS)
  return { data: { pts: keep(read.pts, 5000, warnings, 'ヘキサビン図: 点'), groups: read.groups, xLabel: read.xLabel, yLabel: read.yLabel }, warnings }
}

/** 六角形（上が角）の d。中心 (cx, cy)・半径 r @param {number} cx @param {number} cy @param {number} r */
const hex = (cx, cy, r) => polyline(Array.from({ length: 6 }, (_, i) => /** @type {[number, number]} */ ([cx + r * Math.cos((Math.PI / 3) * i - Math.PI / 2), cy + r * Math.sin((Math.PI / 3) * i - Math.PI / 2)])), true)

/**
 * @param {HexData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const pts = data.pts
  if (!pts.length) return empty(o)
  const n = pts.length
  const b = boundsOf(pts)
  const [xLo, xHi] = extentOf(b.x0, b.x1, 0.02)
  const [yLo, yHi] = extentOf(b.y0, b.y1, 0.02)
  const yTicks = tickSet(yLo, yHi, 5)
  const xTicks = tickSet(xLo, xHi, 5)
  const bottom = H - BOTTOM_FROM_BOTTOM
  const left = PAD + Math.max(0, ...yTicks.values.map((t) => textWidth(yTicks.fmt(t), TICK))) + 14
  const right = W - PAD
  const plotW = Math.max(1, right - left)
  const plotH = Math.max(1, bottom - PLOT_TOP)
  const R = Math.max(Math.min(11, Math.max(5, Math.sqrt(plotW * plotH) / 31)), Math.sqrt((plotW * plotH) / (2.6 * MAX_CELLS)))
  const cell = R * DRAWN
  // 点の範囲は四方を R だけ内側へ寄せる（端の点の升が、軸の棒や数にはみ出さない）
  const x = linear(xLo, xHi, left + R, right - R)
  const y = linear(yLo, yHi, bottom - R, PLOT_TOP + R)

  // 升の格子は、plot の左下から敷く（行の中心を 0 の線の R 上に）
  /** @type {{ x: number, y: number, count: number }[]} */
  const bins = /** @type {any} */ (hexbin())
    .radius(R)
    .x((/** @type {Pt} */ p) => x(p.x) - left)
    .y((/** @type {Pt} */ p) => y(p.y) - bottom + R)(pts.map((p) => ({ ...p })))
    .map((/** @type {any} */ bin) => ({ x: bin.x + left, y: bin.y + bottom - R, count: bin.length }))
  let max = 0
  for (const bin of bins) if (bin.count > max) max = bin.count
  const peak = bins.find((bin) => bin.count === max)
  if (!peak) return empty(o)
  /** @type {string[]} */
  const parts = []

  // 左と下の数（4pt の棒つき）。題は左上と、下の目盛りの右端
  parts.push(axisLeft({ ticks: yTicks.values, at: y, x: left, pal, fmt: yTicks.fmt, gap: 5 }))
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: bottom, pal, fmt: xTicks.fmt, unit: data.xLabel, left, right }))
  if (data.yLabel) parts.push(text(PAD, HEADER_Y, data.yLabel, { size: TICK, fill: pal.sub }))

  for (const bin of bins) parts.push(fillPath(hex(bin.x, bin.y, cell), fillAttr(rampColor(pal), shade(Math.sqrt(bin.count / max), SHADE_HI))))

  const bounds = { x0: left + 2, y0: PLOT_TOP - R, x1: right - 2, y1: bottom - 2 }
  const centers = /** @type {[number, number][]} */ (bins.map((bin) => [bin.x, bin.y]))
  /** @type {Box[]} */
  const placed = []

  // 最多の升: 縁を重ね、上の空きへ線でつないで「最多 N」。上に空きが無ければ、最も近い空きに置く（線なし）
  parts.push(strokePath(hex(peak.x, peak.y, cell + 0.45), hotStroke(pal, 1, LW.hot, 1)))
  const peakText = tr(lang, `最多 ${num(max)}`, `Peak ${num(max)}`)
  const peakW = textWidth(peakText, VALUE, true)
  const column = bins.filter((bin) => Math.abs(bin.x - peak.x) < R)
  const lift = Math.min(...column.map((bin) => bin.y)) - cell - 6
  const direct = /** @type {[number, number]} */ ([peak.x - peakW / 2, lift - 12])
  const spot = freeSpot({ w: peakW, h: 9, from: [peak.x, lift], cands: [direct], bounds: { ...bounds, y0: HEADER_Y + 4 }, points: centers, pad: R })
  if (spot) {
    if (spot.x0 === direct[0] && spot.y0 === direct[1]) parts.push(line(peak.x, peak.y - cell, peak.x, spot.y0 + 10, hotStroke(pal, 1, LW.line, 1)))
    parts.push(text(spot.x0, spot.y0 + 8, peakText, { size: VALUE, fill: pal.accent, bold: true }))
    placed.push({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + peakW, y1: spot.y0 + 9 })
  }

  // 群の名前: 群の中心にいちばん近い、どの升とも重ならない空き。名前（ink）と件数（sub）の 2 行
  data.groups.forEach((name, g) => {
    if (!name) return
    const members = pts.filter((p) => p.g === g)
    if (!members.length) return
    let cx = 0
    let cy = 0
    for (const p of members) { cx += x(p.x); cy += y(p.y) }
    cx /= members.length
    cy /= members.length
    const nameText = clip(name, LABEL, W * 0.3)
    const countText = tr(lang, `${num(members.length)} 件`, `${num(members.length)} pts`)
    const w = Math.max(textWidth(nameText, LABEL), textWidth(countText, TICK))
    const spot = freeSpot({ w, h: 18, from: [cx, cy], bounds, points: centers, pad: R, boxes: placed })
    if (!spot) return
    placed.push({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + w, y1: spot.y0 + 18 })
    parts.push(text(spot.x0, spot.y0 + 7.5, nameText, { size: LABEL, fill: pal.ink }))
    parts.push(text(spot.x0, spot.y0 + 16.5, countText, { size: TICK, fill: pal.sub }))
  })

  // 下の行: 左に件数、右に階段（少 … 多）
  parts.push(text(PAD, H - 4, tr(lang, `${num(n)} 件`, `n = ${num(n)}`), { size: TICK, fill: pal.sub }))
  parts.push(shadeLegend(W - PAD, H - 4, pal, lang, { mark: 'hex', hi: SHADE_HI }).svg)
  return svgDoc(W, H, parts.join(''))
}

/**
 * 3,000 件の注文。look の見本と同じ種・同じ式（1,900 件が小さなかたまり・1,100 件が大きなかたまりで、どちらも右上がり）。
 * 横は処理にかかった時間（分）・縦は金額（万円）。名前だけ紙の文書に合う物にした
 * @returns {{ points: number[][], groups: string[], xLabel: string, yLabel: string }}
 */
function sample() {
  const rnd = seeded(20261032)
  const normal = normalOf(rnd)
  /** @type {number[][]} */
  const points = []
  /** @type {string[]} */
  const groups = []
  while (points.length < 3000) {
    const a = normal()
    const b = normal()
    const small = points.length < 1900
    const p = small ? [10 + 5.5 * a, 1.2 + 0.35 * a + 0.4 * b] : [38 + 7 * a, 4.8 + 0.7 * a + 0.75 * b]
    if (p[0] > 2 && p[0] < 58 && p[1] > 0.2 && p[1] < 8) {
      points.push([round(p[0], 1), round(p[1], 2)])
      groups.push(small ? '小口の注文' : '大口の注文')
    }
  }
  return { points, groups, xLabel: '処理時間（分）', yLabel: '金額（万円）' }
}

export default {
  id: 'hexbin',
  title: 'ヘキサビン図（Hexbin plot）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.62),
  sample,
}
