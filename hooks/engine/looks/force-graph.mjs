// @ts-check
// force-graph（力学配置のグラフ）: 項目をつなぎの本数で大きさを変えた丸にし、力でほどいて並べる。元の見本は「小さな TypeScript リポジトリの 30 ファイルと 44 本の import」。
// 元は look の designs/force-graph.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 配置は d3-force（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）: link・many-body・collide と、弱い x・y の引力。.stop() の後に 300 回 tick を進めるので
// タイマーは使わず、種つきの乱数（元と同じ式）なので毎回同じ配置になる。
//
// 決まり（元の頭の文のとおり。数は変えない）: y の引力を x より強くして、雲が横に広がるようにし（欄が横長）、落ち着いた雲の外接を描画面に 1 つの倍率で収める。
// 丸の半径は candle の 2pt の丸から、つなぎの本数の平方根で増える（2 + 1.3 × √(本数 - 1)）。右上の大きさの鍵が半径の決まりを読み返させる。つなぎは墨の 25% の 1pt。
// 目立たせるのはつなぎがいちばん多い 1 つだけ（look の橙）。つなぎの多い 5 つには名前と本数を、8 つの向きのうち「丸にも先の字にも当たらず、線がいちばん少ない側」に置く。
// 元の見本は密なグラフで、線の通らない側が 1 つも無かったので、字には縁取りを付けて、通る線が字の手前で止まるようにした。
//
// 紙に写して変えた所
// - 暗い地は塗らない。ほかの丸は墨の 55%・目立たせる丸は墨 100%（元の 90% は ALPHA.heavy。mono は 100%）。
// - 字の縁取り（元の stage 色の 3px の縁。SVG の paint-order は紙の読み手が持たない）は、字の下に紙の白の 85% の下敷き（paper の underlay）を敷く形にした。
// - 字は pt。名前は 8pt の ink（目立たせる丸の名前は accent）、本数は 7.5pt の sub。元の等幅は紙では sans。名前を置く丸の数は、項目が 8 個以下なら全部、それより多ければ 5 つ。
// - 元は右上の鍵を 1・5・10 に固定したが、紙は最大のつなぎの本数に合わせて（1・中間・最大）にする。左下に「項目の数・つなぎの数」を置く（件数は dendrogram・box-plot・scatter と同じ左下。元は左下の見出しもあったが、data に無いので置かない）。
// - つなぎの value は使わない（元も本数だけ）。group も使わない。自分から自分へのつなぎは捨て、向きの違う同じ組と、同じ組の重なりは 1 本にして、warnings に書く。
// 選ばなかった案
// - 描画面に収める倍率が 1 を超える時に丸の大きさも倍率で変える案: 項目が少ない時に丸が巨大になる。位置だけ倍率で動かし、丸は元の半径のまま（倍率は 3 倍まで）。
// - 名前を全部の丸に置く案: 密なグラフでは字が線を覆い、構造が読めない。つなぎの多い項目だけに名前を置く。
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, midline, f, inkFill, fillAttr, seriesColor, inkStroke, hotFill, text, circle, strokePath, underlay, svgDoc, empty, num, textWidth, clip, nameOf, arr, tr, seeded, LW, overlaps } from './paper.mjs'

const MAX_DRAWN = 200
const PAD = 8
const TOP = 28
const BOTTOM = 22
const LABELS = 5
const SEED = 20261036
const K_MAX = 3

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ nodes: { name: string, deg: number }[], links: { source: number, target: number }[], hot: number }} ForceData */

const radius = (/** @type {number} */ deg) => 2 + 1.3 * Math.sqrt(Math.max(0, deg - 1))

/**
 * @param {unknown} data { nodes: { name, group? }[], links: { source, target, value? }[], highlight? }
 * @returns {{ data: ForceData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.nodes) || !Array.isArray(src.links)) warnings.push('力学配置: nodes（{ name }）と links（{ source, target }）の列がありません')
  /** @type {Map<string, number>} */
  const index = new Map()
  /** @type {string[]} */
  const names = []
  let dupNodes = 0
  for (const n of arr(src.nodes)) {
    const name = nameOf(n && typeof n === 'object' ? n.name : n)
    if (!name) continue
    if (index.has(name)) { dupNodes++; continue }
    index.set(name, names.length)
    names.push(name)
  }
  if (dupNodes) warnings.push(`力学配置: 同じ名前の節 ${dupNodes} 個は 1 つにしました`)
  if (names.length > MAX_DRAWN) names.length = MAX_DRAWN

  /** @type {{ source: number, target: number }[]} */
  const links = []
  const seen = new Set()
  let unknown = 0
  let loops = 0
  let twice = 0
  for (const l of arr(src.links)) {
    const s = index.get(nameOf(l && l.source))
    const t = index.get(nameOf(l && l.target))
    if (s === undefined || t === undefined || s >= names.length || t >= names.length) { unknown++; continue }
    if (s === t) { loops++; continue }
    const key = `${Math.min(s, t)}-${Math.max(s, t)}`
    if (seen.has(key)) { twice++; continue }
    seen.add(key)
    links.push({ source: s, target: t })
  }
  if (unknown) warnings.push(`力学配置: nodes に無い名前を指すつながり ${unknown} 本を捨てました`)
  if (loops) warnings.push(`力学配置: 自分から自分へのつながり ${loops} 本を捨てました`)
  if (twice) warnings.push(`力学配置: 同じ組の重なったつながり ${twice} 本は 1 本にしました`)

  const deg = names.map(() => 0)
  for (const l of links) { deg[l.source]++; deg[l.target]++ }
  let hot = names.length ? deg.indexOf(Math.max(...deg)) : -1
  const want = nameOf(src.highlight)
  if (want) {
    const at = names.indexOf(want)
    if (at >= 0) hot = at
    else warnings.push(`力学配置: highlight の名前「${want}」が nodes にありません。つなぎがいちばん多い項目を目立たせます`)
  }
  return { data: { nodes: names.map((name, i) => ({ name, deg: deg[i] })), links, hot }, warnings }
}

/**
 * @param {ForceData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.nodes.length) return empty(o)
  // d3 は渡した物を書き換えるので、描くたびに作る
  // x・y は渡さない（d3 が未定の x・y を、ひまわりの種の並びで置く。0 を渡すと全部が 1 点から始まる）
  /** @type {any[]} */
  const nodes = data.nodes.map((n, i) => ({ name: n.name, deg: n.deg, r: radius(n.deg), rank: 0, hot: i === data.hot, px: 0, py: 0 }))
  const byDeg = [...nodes].sort((a, b) => b.deg - a.deg)
  byDeg.forEach((n, k) => { n.rank = k })
  const links = data.links.map((l) => ({ source: l.source, target: l.target }))
  const sim = /** @type {any} */ (forceSimulation(nodes))
  sim
    .randomSource(seeded(SEED))
    .force('link', forceLink(links).distance(20))
    .force('charge', forceManyBody().strength(-46))
    .force('collide', forceCollide((/** @type {any} */ n) => n.r + 3))
    .force('x', forceX(0).strength(0.05))
    .force('y', forceY(0).strength(0.075))
    .stop()
    .tick(300)

  // 落ち着いた雲を、描画面に 1 つの倍率で（縦横同じ）収めて真ん中に置く。倍率は K_MAX まで（項目が少ない時に雲を引き伸ばしすぎない）
  const left = PAD
  const right = W - PAD
  const top = TOP
  const bottom = H - BOTTOM
  const x0 = Math.min(...nodes.map((n) => n.x - n.r))
  const x1 = Math.max(...nodes.map((n) => n.x + n.r))
  const y0 = Math.min(...nodes.map((n) => n.y - n.r))
  const y1 = Math.max(...nodes.map((n) => n.y + n.r))
  const k = Math.min(K_MAX, (right - left) / (x1 - x0), (bottom - top) / (y1 - y0))
  const ox = (left + right) / 2 - (k * (x0 + x1)) / 2
  const oy = (top + bottom) / 2 - (k * (y0 + y1)) / 2
  for (const n of nodes) {
    n.px = ox + k * n.x
    n.py = oy + k * n.y
  }

  /** @type {string[]} */
  const parts = []
  const d = links.map((l) => {
    const a = /** @type {any} */ (l.source)
    const b = /** @type {any} */ (l.target)
    return `M${f(a.px)} ${f(a.py)}L${f(b.px)} ${f(b.py)}`
  }).join('')
  parts.push(strokePath(d, inkStroke(pal, ALPHA.area, LW.line)))
  for (const n of [...nodes].sort((a, b) => a.deg - b.deg)) parts.push(circle(n.px, n.py, n.r, n.hot ? hotFill(pal, ALPHA.heavy, 1) : seriesColor(pal, 1) !== null ? fillAttr(/** @type {string} */ (seriesColor(pal, 1)), 0.7) : inkFill(pal, ALPHA.body)))

  // 大きさの鍵（右上）: 丸の半径の決まりを、1・中間・最大のつなぎの本数で読み返す。右端から左へ
  const maxDeg = Math.max(1, ...nodes.map((n) => n.deg))
  const keys = [...new Set([1, Math.round((1 + maxDeg) / 2), maxDeg])]
  let kx = W - PAD
  for (const v of [...keys].reverse()) {
    const label = String(v)
    parts.push(text(kx, 14, label, { size: TICK, fill: pal.sub, anchor: 'end' }))
    kx -= textWidth(label, TICK) + 3 + radius(v)
    parts.push(circle(kx, 11, radius(v), inkFill(pal, ALPHA.body)))
    kx -= radius(v) + 10
  }
  parts.push(text(kx + 4, 14, tr(lang, 'つなぎの本数', 'Links'), { size: TICK, fill: pal.sub, anchor: 'end' }))

  // 名前: つなぎの多い順に、8 つの向きのうち、丸にも先の字にも当たらず、線の通る数がいちばん少ない側へ。置けない丸は名前なしにする
  /** @type {{ x0: number, x1: number, y0: number, y1: number }[]} */
  const boxes = []
  const hitsDot = (/** @type {any} */ b, /** @type {any} */ self) => nodes.some((n) => n !== self && n.px + n.r > b.x0 && n.px - n.r < b.x1 && n.py + n.r > b.y0 && n.py - n.r < b.y1)
  const hitsBox = (/** @type {any} */ b) => boxes.some((q) => overlaps(q, b))
  // Liang-Barsky: つなぎの線分が、箱の中に入るか
  const crosses = (/** @type {any} */ b, /** @type {any} */ l) => {
    const sx = l.source.px
    const sy = l.source.py
    const dx = l.target.px - sx
    const dy = l.target.py - sy
    let t0 = 0
    let t1 = 1
    for (const [p, q] of [[-dx, sx - b.x0], [dx, b.x1 - sx], [-dy, sy - b.y0], [dy, b.y1 - sy]]) {
      if (p === 0) { if (q < 0) return false; continue }
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
    return true
  }
  const labelCount = nodes.length <= 8 ? nodes.length : LABELS
  const clipW = Math.max(40, W * 0.22)
  for (const n of byDeg.slice(0, labelCount)) {
    const name = clip(n.name, LABEL, clipW)
    const deg = String(n.deg)
    const wName = textWidth(name, LABEL)
    const w = wName + 4 + textWidth(deg, TICK)
    const g = n.r * 0.7 + 2
    const sides = [
      [n.px + n.r + 3, midline(n.py, LABEL)],
      [n.px - n.r - 3 - w, midline(n.py, LABEL)],
      [n.px - w / 2, n.py - n.r - 4],
      [n.px - w / 2, n.py + n.r + 10],
      [n.px + g, n.py - g],
      [n.px + g, n.py + g + 8],
      [n.px - g - w, n.py - g],
      [n.px - g - w, n.py + g + 8],
    ]
    /** @type {{ lx: number, ly: number, b: { x0: number, x1: number, y0: number, y1: number }, cut: number } | null} */
    let best = null
    for (const [lx, ly] of sides) {
      const b = { x0: lx - 2, x1: lx + w * 1.1 + 2, y0: ly - 9, y1: ly + 3 }
      if (b.x0 < 2 || b.x1 > W - 2 || b.y0 < TOP - 4 || b.y1 > H - BOTTOM + 8) continue
      if (hitsDot(b, n) || hitsBox(b)) continue
      const cut = links.filter((l) => crosses(b, l)).length
      if (!best || cut < best.cut) best = { lx, ly, b, cut }
    }
    if (!best) continue
    boxes.push(best.b)
    parts.push(underlay(best.lx - 1.5, best.ly - 8.5, w + 3, 11.5, pal))
    parts.push(text(best.lx, best.ly, name, { size: LABEL, fill: n.hot ? pal.accent : pal.ink }))
    parts.push(text(best.lx + wName + 4, best.ly, deg, { size: TICK, fill: pal.sub }))
  }

  parts.push(text(PAD, H - 4, tr(lang, `${num(nodes.length)} 項目・${num(links.length)} 本のつながり`, `${num(nodes.length)} items, ${num(links.length)} links`), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（種 20261035 の成長する歩き・30 ファイル・44 本）を、システム間のデータ連携の話に直した。名前はつなぎの多い順 */
function sample() {
  const FILES = 30
  const EXTRA = 15
  const NAMES = [
    '顧客DB', '認証基盤', '設定管理', '注文管理', '在庫管理', '会計', '配送', '通知', '帳票', '検索',
    '分析基盤', '監査記録', '決済', '請求', '商品管理', '会員', 'ポイント', '広告', 'レビュー', '問い合わせ',
    '返品', '倉庫', '店舗', '予約', 'クーポン', 'サイト', 'アプリ', '管理画面', '外部連携', 'バッチ',
  ]
  const rnd = seeded(20261035)
  const deg = Array(FILES).fill(0)
  /** @type {number[][]} */
  const links = []
  const has = new Set()
  const add = (/** @type {number} */ a, /** @type {number} */ b) => {
    links.push([a, b])
    has.add(`${Math.min(a, b)}-${Math.max(a, b)}`)
    deg[a]++
    deg[b]++
  }
  // つなぎの多い所に集まりやすい（本数 + 1 の 2 乗に比例）。素朴な比例では平らな網になり、最大の項目が 9 本止まりだった
  const pick = (/** @type {number} */ n) => {
    const weight = (/** @type {number} */ j) => (deg[j] + 1) ** 2
    let total = 0
    for (let j = 0; j < n; j++) total += weight(j)
    let r = rnd() * total
    for (let j = 0; j < n; j++) if ((r -= weight(j)) < 0) return j
    return n - 1
  }
  for (let i = 1; i < FILES; i++) add(i, pick(i))
  while (links.length < FILES - 1 + EXTRA) {
    const a = pick(FILES)
    const b = Math.floor(rnd() * FILES)
    if (a !== b && !has.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) add(a, b)
  }
  const rank = deg.map((_, i) => i).sort((p, q) => deg[q] - deg[p] || p - q)
  const label = deg.map(() => '')
  rank.forEach((i, k) => { label[i] = NAMES[k] })
  return { nodes: label.map((name) => ({ name })), links: links.map(([s, t]) => ({ source: label[s], target: label[t] })) }
}

export default {
  id: 'force-graph',
  title: '力学配置のグラフ（Force-directed graph）',
  category: 'flow',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(Math.min(420, width * 0.7)),
  sample,
}
