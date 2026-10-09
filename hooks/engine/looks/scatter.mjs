// @ts-check
// scatter（散布図）: 点を 2 つの量の上に置き、円の面積で 3 つ目の量を見せる。元の見本は 120 件のエージェントの実行を、かかった時間と費用で置いた物（円の面積はトークン数）。
// 117 件は 1 つの習慣に従う（1 分 38K トークン・100 万トークン 3.10 ドルなので、費用は時間に比例する）。残りの 3 件は、わざと習慣を破る（見る価値のある物）。
// 元は look の designs/scatter.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 点線は費用を時間に当てはめた最小二乗の直線で、candle の参照線の重み（墨 35%）。傾きは下の行に書く（線は点のいちばん濃い所を通るので、線の上に字を置くと円に乗る）。
// 直線から最も離れた 3 件（残差の絶対値が最大）に名前を付ける。名前の選び方は、人でなくコードが決める。そのうち費用が最大の 1 件が目立たせる 1 つ（look の Claude の橙）。
// 円は墨 25% の面と、重なりが数えられる墨 55% の縁。半径は大きさの平方根（面積が値を正しく表す）。小さな円が大きな円の上に見えるよう、大きい円から先に描く。
// 絵の中の数字は全部 data から計算する（傾き・範囲・円の大きさの目盛り）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる 1 件は pal.accent の 25% の面と 100% の縁（mono は墨の 50% の面と 100% の縁）。ほかの名前付きの 2 件の縁は、元の 90% でなく 80%
//   （mono で 100% の縁と 90% の縁は見分けられない）。
// - 元の data は円が 1 つの値（トークン）を持つが、docs/looks.md の 3 章の points は [x, y] だけなので、3 つ目の値（円の大きさ）を任意で足した。points は [x, y] でも [x, y, 大きさ] でもよい。
//   名前は names（点と同じ長さ・名前の無い点は空の字）、円の大きさの題は sizeLabel。群（groups・点ごとの名前）は、円の描き方で分ける（群 1: 面と縁・群 2: 縁だけ・群 3: 濃い面）。
// - 大きさが無い data は、どの点も同じ半径（点が 400 以下は 2.5・1,500 以下は 2・それより多い時は 1.5）。
// - 見出しは左に縦の題（yLabel）・右に群の凡例と円の大きさの目安（入る時だけ）。下は左に件数・右に直線の傾き。横の題（xLabel）は目盛りの右端。元の見出しの「RUNS, COST BY DURATION」は置かない。
// 選ばなかった案
// - 直線を目立たせる案: 点線は 35% の参照線（candle の最後の値と同じ）の 1 つで、目立たせる 1 つは外れた円に残す。
import { ALPHA, DASH, TICK, LABEL, fillAttr, strokeAttr, inkStroke, hotFill, hotStroke, text, line, circle, svgDoc, empty, num, textWidth, clip, tr, linear, keep, compact, legend, seeded, axisBottom, axisLeft, tickSet, fitText, statDigits, LW } from './paper.mjs'
import { readPoints, extentOf, boundsOf, normalOf, round } from './spread-kit.mjs'

const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 26
const BOTTOM_FROM_BOTTOM = 30
/** いちばん大きい円の半径 */
const R_MAX = 7
const MAX_GROUPS = 3
/** 名前を付ける点の数 */
const LABELED = 3

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ x: number, y: number, size: number, g: number, name: string }} Pt */
/** @typedef {{ pts: Pt[], groups: string[], xLabel: string, yLabel: string, sizeLabel: string }} ScatterData */

/**
 * @param {unknown} data { points: ([x, y] | [x, y, 大きさ])[], xLabel?, yLabel?, sizeLabel?, groups?: 点ごとの群の名前, names?: 点ごとの名前 }
 * @returns {{ data: ScatterData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const read = readPoints(src, warnings, '散布図', MAX_GROUPS)
  return { data: { ...read, pts: keep(read.pts, 5000, warnings, '散布図: 点') }, warnings }
}

/**
 * 最小二乗の直線（y = a + b x）。点が 3 つに満たない・x が全部同じなら null
 * @param {Pt[]} pts
 * @returns {{ a: number, b: number } | null}
 */
function fitLine(pts) {
  const n = pts.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (const p of pts) { mx += p.x; my += p.y }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2 }
  if (!(sxx > 0)) return null
  const b = sxy / sxx
  return { a: my - b * mx, b }
}

/**
 * @param {ScatterData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const pts = data.pts
  if (!pts.length) return empty(o)
  const n = pts.length
  const { x0: minX, x1: maxX, y0: minY, y1: maxY } = boundsOf(pts)
  const [xLo, xHi] = extentOf(minX, maxX, 0.03)
  const [yLo, yHi] = extentOf(minY, maxY, 0.1)
  const yTicks = tickSet(yLo, yHi, 5)
  const xTicks = tickSet(xLo, xHi, 5)
  const plotBottom = H - BOTTOM_FROM_BOTTOM
  const left = PAD + Math.max(0, ...yTicks.values.map((t) => textWidth(yTicks.fmt(t), TICK))) + 8
  const right = W - PAD
  const x = linear(xLo, xHi, left, right)
  const y = linear(yLo, yHi, plotBottom, PLOT_TOP)

  let sizeMax = 0
  for (const p of pts) if (p.size > sizeMax) sizeMax = p.size
  const hasSize = sizeMax > 0
  const plain = n <= 400 ? 2.5 : n <= 1500 ? 2 : 1.5
  const rad = (/** @type {number} */ s) => (hasSize ? Math.max(1.5, R_MAX * Math.sqrt((s > 0 ? s : 0) / sizeMax)) : plain)
  const radOf = (/** @type {Pt} */ p) => rad(p.size)
  /** @type {string[]} */
  const parts = []

  // 縦の目盛りの線（細い線）と左の数。横は 4pt の棒と下の数（横の題が右端）
  for (const t of yTicks.values) parts.push(line(left, Math.round(y(t)) + 0.5, right, Math.round(y(t)) + 0.5, inkStroke(pal, ALPHA.grid, LW.line)))
  parts.push(axisLeft({ ticks: yTicks.values, at: (t) => Math.round(y(t)) + 0.5, x: left, pal, fmt: yTicks.fmt, stub: false, gap: 3 }))
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: plotBottom, pal, fmt: xTicks.fmt, unit: data.xLabel, left, right }))

  // 近い順の直線は、範囲の外へ出る所で切る
  const fit = fitLine(pts)
  if (fit) {
    const xs = [xLo, xHi]
    if (fit.b !== 0) xs.push((yLo - fit.a) / fit.b, (yHi - fit.a) / fit.b)
    const inside = xs.filter((v) => v >= xLo - 1e-9 && v <= xHi + 1e-9 && fit.a + fit.b * v >= yLo - 1e-9 && fit.a + fit.b * v <= yHi + 1e-9).sort((p, q) => p - q)
    if (inside.length >= 2) {
      const p1 = inside[0]
      const p2 = inside[inside.length - 1]
      parts.push(line(x(p1), y(fit.a + fit.b * p1), x(p2), y(fit.a + fit.b * p2), inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))
    }
  }

  // 名前を付ける 3 件: 直線から最も遠い点（残差が 0 の点しか無ければ付けない）。そのうち y が最大の 1 件が目立たせる 1 つ
  /** @type {Pt[]} */
  let odd = []
  if (fit) {
    const res = (/** @type {Pt} */ p) => Math.abs(p.y - (fit.a + fit.b * p.x))
    odd = [...pts].sort((p, q) => res(q) - res(p)).slice(0, LABELED).filter((p) => res(p) > 1e-9 * (Math.abs(yHi) + 1))
  }
  const hot = odd.length ? odd.reduce((a, b) => (b.y > a.y ? b : a)) : null

  const markOf = (/** @type {Pt} */ p) => {
    if (p === hot) return `${hotFill(pal, ALPHA.area)} ${hotStroke(pal, 1, LW.line)}`
    const rimA = odd.includes(p) ? ALPHA.wick : ALPHA.body
    if (p.g === 1) return `fill="none" ${strokeAttr(pal.ink, ALPHA.wick, LW.line)}`
    if (p.g === 2) return `${fillAttr(pal.ink, ALPHA.body)} ${strokeAttr(pal.ink, rimA, LW.line)}`
    return `${fillAttr(pal.ink, ALPHA.area)} ${strokeAttr(pal.ink, rimA, LW.line)}`
  }
  // 大きい円から先に（小さい円が上に見える）。目立たせる 1 件は最後
  const order = [...pts].sort((p, q) => (q.size > 0 ? q.size : 0) - (p.size > 0 ? p.size : 0))
  for (const p of order) if (p !== hot) parts.push(circle(x(p.x), y(p.y), radOf(p), markOf(p)))
  if (hot) parts.push(circle(x(hot.x), y(hot.y), radOf(hot), markOf(hot)))

  // 名前: 円の右（図の外に出る時は左）。名前は ink（目立たせる 1 件は accent）・値は sub
  const yDigits = statDigits(yHi - yLo)
  const xDigits = statDigits(xHi - xLo)
  for (const p of odd) {
    const cx = x(p.x)
    const cy = y(p.y)
    const gap = radOf(p) + 4
    const name = clip(p.name || `${num(p.x, xDigits)}, ${num(p.y, yDigits)}`, LABEL, W * 0.4)
    const val = p.name ? num(p.y, yDigits) : ''
    const nameW = textWidth(name, LABEL)
    const valW = val ? textWidth(val, TICK) + 4 : 0
    const onRight = cx + gap + nameW + valW <= W - PAD
    const isHot = p === hot
    const ty = cy + LABEL * 0.35
    if (onRight) {
      parts.push(text(cx + gap, ty, name, { size: LABEL, fill: isHot ? pal.accent : pal.ink }))
      if (val) parts.push(text(cx + gap + nameW + 4, ty, val, { size: TICK, fill: isHot ? pal.accent : pal.sub }))
    } else {
      if (val) parts.push(text(cx - gap, ty, val, { size: TICK, fill: isHot ? pal.accent : pal.sub, anchor: 'end' }))
      parts.push(text(cx - gap - valW, ty, name, { size: LABEL, fill: isHot ? pal.accent : pal.ink, anchor: 'end' }))
    }
  }

  // 見出し: 左に縦の題、右に群の凡例と円の大きさの目安（左の字と重ならない時だけ）
  if (data.yLabel) parts.push(text(PAD, HEADER_Y, data.yLabel, { size: TICK, fill: pal.sub }))
  const headLeft = PAD + (data.yLabel ? textWidth(data.yLabel, TICK) + 16 : 0)
  let edge = W - PAD
  if (data.groups.length > 1) {
    const keys = /** @type {{ label: string, mark: 'dot', attr: string }[]} */ (data.groups.map((g, i) => ({
      label: g || `${i + 1}`,
      mark: 'dot',
      attr: i === 1 ? `fill="none" ${strokeAttr(pal.ink, ALPHA.wick, LW.line)}` : i === 2 ? `${fillAttr(pal.ink, ALPHA.body)} ${strokeAttr(pal.ink, ALPHA.body, LW.line)}` : `${fillAttr(pal.ink, ALPHA.area)} ${strokeAttr(pal.ink, ALPHA.body, LW.line)}`,
    })))
    const probe = legend(0, HEADER_Y, keys, pal)
    if (edge - probe.width >= headLeft) {
      parts.push(legend(edge, HEADER_Y, keys, pal, { anchor: 'end' }).svg)
      edge -= probe.width + 16
    }
  }
  if (hasSize) {
    const sizes = tickSet(0, sizeMax, 3).values.filter((t) => t > 0).slice(-2)
    const title = data.sizeLabel || tr(lang, '円の面積', 'Bubble area')
    /** @type {{ t: number, r: number, label: string, w: number }[]} */
    const keys = sizes.map((t) => ({ t, r: rad(t), label: compact(t, lang), w: 0 }))
    for (const k of keys) k.w = k.r * 2 + 3 + textWidth(k.label, TICK)
    const total = textWidth(title, TICK) + keys.reduce((s, k) => s + 10 + k.w, 0)
    if (keys.length && edge - total >= headLeft) {
      let cx = edge - total
      parts.push(text(cx, HEADER_Y, title, { size: TICK, fill: pal.sub }))
      cx += textWidth(title, TICK)
      for (const k of keys) {
        cx += 10
        parts.push(circle(cx + k.r, HEADER_Y - TICK * 0.35, k.r, `${fillAttr(pal.ink, ALPHA.area)} ${strokeAttr(pal.ink, ALPHA.body, LW.line)}`))
        parts.push(text(cx + k.r * 2 + 3, HEADER_Y, k.label, { size: TICK, fill: pal.sub }))
        cx += k.w
      }
    }
  }

  // 下の行: 左に件数、右に直線の傾き（直線の見本の線つき）
  parts.push(text(PAD, H - 4, tr(lang, `${num(n)} 件`, `n = ${num(n)}`), { size: TICK, fill: pal.sub }))
  if (fit) {
    const slope = num(fit.b, Math.max(0, 1 - Math.floor(Math.log10(Math.abs(fit.b) || 1))))
    const caption = fitText([tr(lang, `最小二乗の直線（傾き ${slope}）`, `Least-squares line (slope ${slope})`), tr(lang, `直線の傾き ${slope}`, `Slope ${slope}`)], W - 2 * PAD - textWidth(`${num(n)} 件`, TICK) - 40)
    const sample = 14
    parts.push(line(W - PAD - sample, H - 4 - TICK * 0.35, W - PAD, H - 4 - TICK * 0.35, inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))
    parts.push(text(W - PAD - sample - 4, H - 4, caption, { size: TICK, fill: pal.sub, anchor: 'end' }))
  }
  return svgDoc(W, H, parts.join(''))
}

/**
 * 120 件の案件。look の見本と同じ種・同じ式（117 件は 1 分 38,000 の処理・100 万件 3.1 の費用に比例し、3 件が習慣を破る）。
 * 所要時間は分・費用は千円・円の大きさは処理件数（千件）。名前を紙の文書に合う物にした
 * @returns {{ points: number[][], names: string[], xLabel: string, yLabel: string, sizeLabel: string }}
 */
function sample() {
  const rnd = seeded(20261038)
  const normal = normalOf(rnd)
  /** @type {{ name: string, min: number, tok: number, cost: number }[]} */
  const runs = []
  for (let i = 0; i < 117; i++) {
    const min = 2 + 38 * Math.pow(rnd(), 1.3)
    const tok = min * 38000 * Math.exp(0.2 * normal())
    runs.push({ name: '', min, tok, cost: (tok / 1e6) * 3.1 * Math.exp(0.12 * normal()) })
  }
  runs.push({ name: '認証の作り直し', min: 31, tok: 2.6e6, cost: 9.8 }, { name: '再集計', min: 7, tok: 1.6e6, cost: 6.1 }, { name: '審査待ち', min: 44, tok: 0.3e6, cost: 0.9 })
  return {
    points: runs.map((r) => [round(r.min, 1), round(r.cost, 2), round(r.tok / 1000, 0)]),
    names: runs.map((r) => r.name),
    xLabel: '所要時間（分）',
    yLabel: '費用（千円）',
    sizeLabel: '処理件数（千件）',
  }
}

export default {
  id: 'scatter',
  title: '散布図（Scatter plot）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.58),
  sample,
}
