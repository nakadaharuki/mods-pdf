// @ts-check
// contour（密度の等高線図）: 点が集まる所を、同じ密度をつないだ 8 本の線で見せる。元の見本は 600 ターンを、ターンの始めの文脈の大きさとそのターンの費用で置き、2 つの群の山にした物。
// 元は look の designs/contour.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 密度とその等高線は d3-contour の contourDensity()（d3-contour 4.0.2・ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり）: 密度の格子は 4px の升・8 つの水準は格子の最大の 15% から 85% まで 10% ずつ（いつもちょうど 8 本）。いちばん低い水準を 15% からにするのは、それより薄い縁が
// 0 の線の外へはみ出すため（そこに点は無い）。線は 1px の墨で、不透明度が縁から芯へ階段を上る。面を塗るのは最上の水準だけ（墨の 25%・evenodd）なので、目はまず最も濃い所に行く。
// GeoJSON の輪は、短い関数で小数 1 桁の path にする。目立たせる 1 つは「今」の点（look の Claude の橙の点と字）。群の名前は、縁のいちばん上の少し上・字は輪のどの線とも交わらない所に置く。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる「今」の点は、色のある紙では pal.accent・mono では墨 100%（群の名前の ink と、点の周りの輪の線は 65% 以下なので見分けられる）。
// - 線の不透明度の階段は、元の 0.08・0.12・0.18・0.25・0.35・0.42・0.55・0.65 でなく、紙の印刷の下限 18% から 65% まで等間隔に上る 8 段（0.18・0.24・0.30・0.37・0.44・0.51・0.58・0.65）。
//   元の階段の下 2 段（0.08・0.12）は、紙では印刷の下限（細い線は 18%）に持ち上がって 3 段目（0.18）と同じ濃さになり、縁から芯への階段が崩れる。
// - 元は 380px の欄で、帯域幅 16px・点の範囲は欄の左右・上下に近かった。紙では帯域幅を plot の幅の 3.5%（7〜24pt）にして、点の範囲を四方に 1.5 帯域幅だけ内側へ寄せる
//   （最も低い水準の縁は、点から 2 つの帯域幅ほど外へ広がる。寄せないと、縁が 0 の線の外へ大きく出る。元は点が範囲の端に届かない見本だった）。
// - 元の「NOW 146k, $0.29」は、data の point の 1 つでなく別の印なので、任意の highlight（[x, y]）と highlightLabel にした。無ければ目立たせる点は置かない（目立たせるのは 1 つ以下）。
// - 群の名前は points と同じ長さの groups（点ごとの名前）で渡し、元と同じく群の中心の近くの縁のすぐ上に置く（ほかの字や線に重なる時は、いちばん近い空きに置く）。
//   名前の下は件数。元の下の字（SAMPLE 600 TURNS・8 DENSITY LEVELS）は、下の左に件数・右に水準の読み方にする。
// 選ばなかった案
// - 水準を data の最大に合わせて決める案（d3 の既定の閾値）: 水準の数が data で変わり、「いつも 8 本」の決まりを守れない。
// - 点そのものも重ねて描く案: 5,000 点が墨の面になり、等高線の階段が読めない。点は密度に入れるだけにする。
import { contourDensity } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, fillAttr, strokeAttr, hotFill, circle, text, svgDoc, empty, num, textWidth, clip, tr, linear, keep, nameOf, toNum, seeded, axisBottom, axisLeft, tickSet, freeSpot, fitText, polyline, VALUE_MAX, LW } from './paper.mjs'
import { readPoints, extentOf, boundsOf, normalOf, round } from './spread-kit.mjs'

const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 24
const BOTTOM_FROM_BOTTOM = 30
const MAX_GROUPS = 3
const LEVELS = 8
/** 最も低い水準は最大の 15%・そこから 10% ずつ */
const LEVEL_FROM = 0.15
const LEVEL_STEP = 0.1
/** 線の不透明度の階段（縁から芯へ）。紙の下限 18% から 65% まで等間隔 */
const LINE_A = Array.from({ length: LEVELS }, (_, i) => 0.18 + ((0.65 - 0.18) * i) / (LEVELS - 1))
const CELL = 4

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ x: number, y: number, size: number, g: number, name: string }} Pt */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */
/** @typedef {{ pts: Pt[], groups: string[], xLabel: string, yLabel: string, highlight: { x: number, y: number, label: string } | null }} ContourData */

/**
 * @param {unknown} data { points: [x, y][], xLabel?, yLabel?, groups?: 点ごとの群の名前, highlight?: [x, y], highlightLabel? }
 * @returns {{ data: ContourData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const read = readPoints(src, warnings, '等高線図', MAX_GROUPS)
  /** @type {ContourData['highlight']} */
  let highlight = null
  if (src.highlight !== undefined) {
    const hx = Array.isArray(src.highlight) ? toNum(src.highlight[0]) : NaN
    const hy = Array.isArray(src.highlight) ? toNum(src.highlight[1]) : NaN
    if (Number.isNaN(hx) || Number.isNaN(hy) || Math.abs(hx) > VALUE_MAX || Math.abs(hy) > VALUE_MAX) warnings.push('等高線図: highlight が [x, y] の数でないので、目立たせる点は置きません')
    else highlight = { x: hx, y: hy, label: nameOf(src.highlightLabel) }
  }
  return { data: { pts: keep(read.pts, 5000, warnings, '等高線図: 点'), groups: read.groups, xLabel: read.xLabel, yLabel: read.yLabel, highlight }, warnings }
}

/**
 * GeoJSON の MultiPolygon を path の d にする。輪ごとに M..L..Z。原点を (ox, oy) だけずらす
 * @param {any} geo @param {number} ox @param {number} oy
 */
function toPath(geo, ox, oy) {
  return /** @type {number[][][][]} */ (geo.coordinates).flatMap((poly) => poly.map((ring) => polyline(ring.map(([x, y]) => /** @type {[number, number]} */ ([x + ox, y + oy])), true))).join('')
}

/**
 * @param {ContourData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const pts = data.pts
  if (!pts.length) return empty(o)
  const n = pts.length
  const b = boundsOf(pts)
  const hl = data.highlight
  const [xLo, xHi] = extentOf(hl ? Math.min(b.x0, hl.x) : b.x0, hl ? Math.max(b.x1, hl.x) : b.x1, 0.02)
  const [yLo, yHi] = extentOf(hl ? Math.min(b.y0, hl.y) : b.y0, hl ? Math.max(b.y1, hl.y) : b.y1, 0.02)
  const yTicks = tickSet(yLo, yHi, 5)
  const xTicks = tickSet(xLo, xHi, 5)
  const bottom = H - BOTTOM_FROM_BOTTOM
  const left = PAD + Math.max(0, ...yTicks.values.map((t) => textWidth(yTicks.fmt(t), TICK))) + 14
  const right = W - PAD
  const plotW = Math.max(1, right - left)
  const plotH = Math.max(1, bottom - PLOT_TOP)
  const sigma = Math.min(24, Math.max(7, plotW * 0.035))
  const m = 1.5 * sigma
  const x = linear(xLo, xHi, left + m, right - m)
  const y = linear(yLo, yHi, bottom - m, PLOT_TOP + m)

  // 密度は plot の中の座標（左上が原点）で測る。d3 は渡した配列を読むだけだが、毎回新しく作って渡す
  // d3 の設定の関数は、引数があれば自分を・無ければ今の値を返す型なので、続けて呼べるよう any にする
  const density = /** @type {any} */ (contourDensity())
    .size([Math.round(plotW), Math.round(plotH)])
    .bandwidth(sigma)
    .cellSize(CELL)
    .x((/** @type {number[]} */ p) => p[0])
    .y((/** @type {number[]} */ p) => p[1])
  const field = density.contours(pts.map((p) => [x(p.x) - left, y(p.y) - PLOT_TOP, p.g]))
  const rings = LINE_A.map((_, i) => field(field.max * (LEVEL_FROM + LEVEL_STEP * i)))
  /** @type {string[]} */
  const parts = []
  parts.push(axisLeft({ ticks: yTicks.values, at: y, x: left, pal, fmt: yTicks.fmt, gap: 5 }))
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: bottom, pal, fmt: xTicks.fmt, unit: data.xLabel, left, right }))
  if (data.yLabel) parts.push(text(PAD, HEADER_Y, data.yLabel, { size: TICK, fill: pal.sub }))

  rings.forEach((geo, i) => {
    const d = toPath(geo, left, PLOT_TOP)
    if (!d) return
    const top = i === LEVELS - 1
    const stroke = strokeAttr(pal.ink, LINE_A[i], LW.line)
    parts.push(`<path d="${d}" ${top ? `${fillAttr(pal.ink, ALPHA.area)} fill-rule="evenodd"` : 'fill="none"'} ${stroke}/>`)
  })

  // 輪の頂点（隣り合う頂点は 1 升以内なので、どの頂点にも 3pt 以内に入らない箱は、どの線とも交わらない）
  /** @type {[number, number][]} */
  const verts = []
  for (const geo of rings) for (const poly of /** @type {number[][][][]} */ (geo.coordinates)) for (const ring of poly) for (const [vx, vy] of ring) verts.push([vx + left, vy + PLOT_TOP])
  const bounds = { x0: PAD, y0: HEADER_Y + 4, x1: W - PAD, y1: bottom }
  /** @type {Box[]} */
  const placed = []

  // 群の名前: 群の中心の近くの縁のいちばん上の少し上（元と同じ）。ほかの線や字に重なる時は、最も近い空き
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
    let rim = Infinity
    for (const [vx, vy] of verts) if (Math.abs(vx - cx) < 20 && vy < rim) rim = vy
    const cands = Number.isFinite(rim) ? /** @type {[number, number][]} */ ([[cx - w / 2, rim - 4 - 18]]) : []
    const spot = freeSpot({ w, h: 18, from: [cx, cy], cands, bounds, points: verts, pad: 3, boxes: placed })
    if (!spot) return
    placed.push({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + w, y1: spot.y0 + 18 })
    parts.push(text(spot.x0, spot.y0 + 7.5, nameText, { size: LABEL, fill: pal.ink }))
    parts.push(text(spot.x0, spot.y0 + 16.5, countText, { size: TICK, fill: pal.sub }))
  })

  // 目立たせる点: 点と字。字は点の右・左・上・下の順に、線と重ならない最初の側
  if (hl) {
    const nx = x(hl.x)
    const ny = y(hl.y)
    const label = hl.label || `${num(hl.x, 1)}, ${num(hl.y, 1)}`
    const w = textWidth(label, LABEL)
    const cands = /** @type {[number, number][]} */ ([[nx + 6, ny - 6], [nx - 6 - w, ny - 6], [nx - w / 2, ny - 7 - 8], [nx - w / 2, ny + 6]])
    const spot = freeSpot({ w, h: 8, from: [nx, ny], cands, bounds, points: verts, pad: 3, boxes: placed })
    parts.push(circle(nx, ny, 2, hotFill(pal, 1, 1)))
    if (spot) parts.push(text(spot.x0, spot.y0 + 7, label, { size: LABEL, fill: pal.accent }))
  }

  parts.push(text(PAD, H - 4, tr(lang, `${num(n)} 件`, `n = ${num(n)}`), { size: TICK, fill: pal.sub }))
  const how = fitText([tr(lang, `密度の等高線 ${LEVELS} 本（濃い線ほど点が集まる）`, `${LEVELS} density lines (darker = denser)`), tr(lang, `密度の等高線 ${LEVELS} 本`, `${LEVELS} density lines`)], W - 2 * PAD - textWidth(`${num(n)} 件`, TICK) - 16)
  parts.push(text(W - PAD, H - 4, how, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 600 組の来店。look の見本と同じ種・同じ式（380 組は短く立ち寄る・220 組はじっくり見る。どちらも長いほど購入額が増える）。
 * 横は滞在時間（分）・縦は購入額（千円。元の費用の 10 倍）。「今回」は 1 組の来店の目印
 * @returns {{ points: number[][], groups: string[], xLabel: string, yLabel: string, highlight: number[], highlightLabel: string }}
 */
function sample() {
  const rnd = seeded(20261033)
  const normal = normalOf(rnd)
  const kinds = [
    { name: 'ふらっと来店', n: 380, k: 48, sk: 14, c0: 0.07, sc: 0.025 },
    { name: 'じっくり来店', n: 220, k: 128, sk: 20, c0: 0.04, sc: 0.045 },
  ]
  /** @type {number[][]} */
  const points = []
  /** @type {string[]} */
  const groups = []
  for (const g of kinds) {
    for (let i = 0; i < g.n; ) {
      const k = g.k + g.sk * normal()
      const c = g.c0 + 0.0016 * k + g.sc * normal()
      if (k > 0 && k < 200 && c > 0 && c < 0.6) {
        points.push([round(k, 1), round(c * 10, 2)])
        groups.push(g.name)
        i++
      }
    }
  }
  return { points, groups, xLabel: '滞在時間（分）', yLabel: '購入額（千円）', highlight: [146, 2.9], highlightLabel: '今回 146 分・2.9 千円' }
}

export default {
  id: 'contour',
  title: '等高線図（Density contours）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.62),
  sample,
}
