// @ts-check
// chord（弦図）: 項目どうしの引き継ぎ（元の見本は 6 つのエージェントの 1 週間の引き継ぎ 317 回）を、円周の弧と、弧どうしをつなぐリボンで描く。
// 元は look の designs/chord.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 配置は d3-chord の chord（弧の間は 0.04 ラジアンで、各弧の中のリボンは大きい順）・弧は d3-shape の arc・リボンは d3-chord の ribbon（ISC・Mike Bostock。
// 出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり。数は変えない）: リボンは墨の 8% の塗りに、22% の 1 本の縁。リボンが円盤の全部を覆うので、塗りを 25%、14% + 縁 35% にすると
// candle より明るい灰色の板になった。交差が線に読めるよう、塗りは薄く縁で見せる（candle がヒゲで読めるのと同じ）。円周の輪は 6pt の帯で candle の本体と同じ 55%。
// 引き継ぎがいちばん多い 1 組（元は開発とレビューの 42 + 34 = 76 回）だけを目立たせ（look の橙）、その合計を太い側の端の中に書く。弧は墨のままで、橙は 1 組だけ。
// 名前は輪の外に置き、弧の真ん中の角度で、横の名前は輪から離れる向きに揃える。名前には、その項目が出した引き継ぎの数を添える。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせるリボンは accent の 55%（mono は墨の 55%）。縁は目立たせる物も墨の 22%。mono でも paper の monoArea（80%）にしないのは、
//   円周の輪（6pt の帯・55%）と同じ濃さに揃え、リボンの束が弧より黒く見えないようにするため（80% だと、広いリボンが円盤の中で板になった）。
// - 元は目立たせるリボンの合計を、リボンの上に ink の字で置いた。紙ではリボンが濃く、字は紙の白に出来ないので、字の下に紙の白の 85% の下敷きを敷く（paper の underlay）。
// - 字は pt。名前は 8pt の ink、出した数は 7.5pt の sub、合計は 8pt の太字（元の 10px・9px）。名前に出した数を添える。
// - 名前が重なる時は、弧の小さい方の名前を落とす（元は 6 つで重ならなかった）。項目は 24 個まで（輪が名前で埋まる）。多い時は、出入りの合計が大きい 24 個を残して warnings に書く。
// - 元は下に「SAMPLE ...」を置いたが、紙では左下に単位（data.unit。無ければ置かない）、右下に合計を置く。
// - つながりの扱い: 自分から自分へは捨て、同じ向きの同じ組は足し合わせる（向きの違う組は 1 本のリボンの両端になる）。
// - 目立たせる組は data.highlight（[名前, 名前] の 2 つ。向きは問わない）。無ければ、2 つの向きの合計がいちばん大きい組。
// 選ばなかった案
// - 目立たせる組の凡例を置く案: 元も「1 つの凡例を置く案を捨てて、リボンの中に数を書く」と決めた物。紙でも同じ。
// - 自分から自分へのリボンを残す案: d3-chord は描けるが、同じ弧の中の輪になり、引き継ぎの数が読めない。
import { chord, ribbon, arc } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, VALUE, midline, f, inkFill, strokeAttr, hotFill, TONE, seriesColor, seriesFill, fillAttr, text, fillPath, underlay, svgDoc, empty, num, textWidth, clip, nameOf, toNum, arr, tr, VALUE_MAX, unitNote, LW } from './paper.mjs'

const MAX_NODES = 24
const PAD = 4
const ROOM_TOP = 16
const ROOM_BOTTOM = 32
const RING = 6

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ names: string[], matrix: number[][], unit: string, pair: [number, number] | null }} ChordData */

/** リボンの path の小数を 1 桁にする（d3 の ribbon には digits が無い。-0 を出さない） @param {string} d */
function round1(d) {
  return d.replace(/-?\d+\.\d+(?:e-?\d+)?|-?\d+e-?\d+/g, (m) => {
    const v = Math.round(Number(m) * 10) / 10
    return String(v === 0 ? 0 : v)
  })
}

/**
 * @param {unknown} data { nodes: { name, group? }[], links: { source, target, value }[], unit?, highlight?: [name, name] }
 * @returns {{ data: ChordData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.nodes) || !Array.isArray(src.links)) warnings.push('弦図: nodes（{ name }）と links（{ source, target, value }）の列がありません')
  /** @type {Map<string, number>} */
  const index = new Map()
  /** @type {string[]} */
  let names = []
  let dupNodes = 0
  for (const n of arr(src.nodes)) {
    const name = nameOf(n && typeof n === 'object' ? n.name : n)
    if (!name) continue
    if (index.has(name)) { dupNodes++; continue }
    index.set(name, names.length)
    names.push(name)
  }
  if (dupNodes) warnings.push(`弦図: 同じ名前の節 ${dupNodes} 個は 1 つにしました`)

  /** @type {Map<string, number>} */
  const flow = new Map()
  let unknown = 0
  let badValue = 0
  let loops = 0
  for (const l of arr(src.links)) {
    const s = index.get(nameOf(l && l.source))
    const t = index.get(nameOf(l && l.target))
    const value = toNum(l && typeof l === 'object' ? l.value : undefined)
    if (s === undefined || t === undefined) { unknown++; continue }
    if (!(value > 0) || !(value <= VALUE_MAX)) { badValue++; continue }
    if (s === t) { loops++; continue }
    flow.set(`${s}>${t}`, (flow.get(`${s}>${t}`) ?? 0) + value)
  }
  if (unknown) warnings.push(`弦図: nodes に無い名前を指すつながり ${unknown} 本を捨てました`)
  if (badValue) warnings.push(`弦図: value が 0 より大きく 1,000 兆以下の数でないつながり ${badValue} 本を捨てました`)
  if (loops) warnings.push(`弦図: 自分から自分へのつながり ${loops} 本を捨てました`)

  // つながりのある節だけ。多い時は、出入りの合計が大きい順に MAX_NODES 個
  const total = names.map(() => 0)
  for (const [k, v] of flow) {
    const [s, t] = k.split('>').map(Number)
    total[s] += v
    total[t] += v
  }
  let order = names.map((_, i) => i).filter((i) => total[i] > 0)
  if (order.length < names.length) warnings.push(`弦図: つながりの無い節 ${names.length - order.length} 個は描きません`)
  if (order.length > MAX_NODES) {
    const top = new Set([...order].sort((a, b) => total[b] - total[a] || a - b).slice(0, MAX_NODES))
    warnings.push(`弦図: 節は ${MAX_NODES} 個までなので、出入りの合計が小さい ${order.length - MAX_NODES} 個を捨てました`)
    order = order.filter((i) => top.has(i))
  }
  const pos = new Map(order.map((old, i) => [old, i]))
  names = order.map((i) => names[i])
  const matrix = names.map(() => names.map(() => 0))
  for (const [k, v] of flow) {
    const [s, t] = k.split('>').map(Number)
    const a = pos.get(s)
    const b = pos.get(t)
    if (a !== undefined && b !== undefined) matrix[a][b] += v
  }

  // 目立たせる組: highlight（向きを問わない）か、2 つの向きの合計がいちばん大きい組
  /** @type {[number, number] | null} */
  let pair = null
  const hl = Array.isArray(src.highlight) && src.highlight.length === 2 ? src.highlight.map(nameOf) : null
  if (hl) {
    const a = names.indexOf(hl[0])
    const b = names.indexOf(hl[1])
    if (a >= 0 && b >= 0 && a !== b && matrix[a][b] + matrix[b][a] > 0) pair = [Math.min(a, b), Math.max(a, b)]
    else warnings.push('弦図: highlight の 2 つの名前が、つながりのある組ではありません。いちばん多い組を目立たせます')
  }
  if (!pair) {
    let best = 0
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const s = matrix[i][j] + matrix[j][i]
        if (s > best) { best = s; pair = [i, j] }
      }
    }
  }
  return { data: { names, matrix, unit: typeof src.unit === 'string' ? src.unit : '', pair }, warnings }
}

/**
 * @param {ChordData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const n = data.names.length
  if (!n) return empty(o)
  const M = data.matrix
  const whole = M.every((r) => r.every((v) => Number.isInteger(v)))
  const fmt = (/** @type {number} */ v) => num(v, whole ? 0 : 1)
  const sent = M.map((r) => r.reduce((s, v) => s + v, 0))
  const names = data.names.map((s) => clip(s, LABEL, W * 0.2))
  const labelW = names.map((s, i) => textWidth(s, LABEL) + 3 + textWidth(fmt(sent[i]), TICK))
  const sideRoom = Math.max(...labelW) + 14
  const rOut = Math.max(30, Math.min((W - 2 * PAD) / 2 - sideRoom, (H - ROOM_TOP - ROOM_BOTTOM) / 2))
  const rIn = rOut - RING
  const cx = W / 2
  const cy = ROOM_TOP + (H - ROOM_TOP - ROOM_BOTTOM) / 2

  // d3 は渡した物を書き換えるので、描くたびに作る
  const chords = /** @type {any} */ (chord()).padAngle(0.04).sortSubgroups((/** @type {number} */ a, /** @type {number} */ b) => b - a)(M)
  const ring = /** @type {any} */ (arc()).innerRadius(rIn).outerRadius(rOut).digits(1)
  const band = /** @type {any} */ (ribbon()).radius(rIn - 1)
  const pair = data.pair
  const isPair = (/** @type {any} */ c) => pair !== null && ((c.source.index === pair[0] && c.target.index === pair[1]) || (c.source.index === pair[1] && c.target.index === pair[0]))

  /** @type {string[]} */
  const parts = [`<g transform="translate(${f(cx)} ${f(cy)})">`]
  // 目立たせるリボンは最後に描き、重なる薄いリボンの上に載せる
  // 色のテーマ: リボンは出す側の項目の色（目立たせる組は accent で濃く、ほかは薄く）、輪の弧は項目の色
  for (const c of [...chords].sort((a, b) => Number(isPair(a)) - Number(isPair(b)))) {
    const own = isPair(c) ? seriesFill(pal, 0, 0, TONE.fill) : seriesFill(pal, c.source.index + 1, 0, 0.85)
    parts.push(fillPath(round1(band(c)), `${own ?? (isPair(c) ? hotFill(pal, ALPHA.body, ALPHA.body) : inkFill(pal, ALPHA.faint))} ${strokeAttr(pal.ink, ALPHA.edge, LW.hair)}`))
  }
  for (const g of chords.groups) parts.push(fillPath(ring(g), (() => { const c = seriesColor(pal, g.index + 1, 0); return c === null ? null : fillAttr(c, TONE.fill) })() ?? inkFill(pal, ALPHA.body)))
  parts.push('</g>')

  // 名前: 弧の真ん中の角度の、輪のすぐ外。横の名前は輪から離れる向きに揃え、上と下では名前が輪に沿うので少し外へ。小さい弧の名前が重なったら落とす
  /** @type {{ x0: number, x1: number, y0: number, y1: number }[]} */
  const boxes = []
  const groups = [...chords.groups].sort((a, b) => (b.endAngle - b.startAngle) - (a.endAngle - a.startAngle))
  for (const g of groups) {
    const a = (g.startAngle + g.endAngle) / 2
    const sx = Math.sin(a)
    const sy = -Math.cos(a)
    const r = rOut + 8
    const x = cx + r * sx
    const y = cy + r * sy + 3 + sy * 5
    const w = labelW[g.index]
    const x0 = Math.abs(sx) < 0.2 ? x - w / 2 : sx > 0 ? x : x - w
    const box = { x0: x0 - 1, x1: x0 + w + 1, y0: y - 8, y1: y + 2 }
    if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H) continue
    if (boxes.some((b) => b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1)) continue
    boxes.push(box)
    parts.push(text(x0, y, names[g.index], { size: LABEL, fill: pal.ink }))
    parts.push(text(x0 + textWidth(names[g.index], LABEL) + 3, y, fmt(sent[g.index]), { size: TICK, fill: pal.sub }))
  }

  // 目立たせるリボンの合計（2 つの向きの合計）を、先頭の項目の側の太い端の中に、下敷きの上に置く
  const hotChord = chords.find(isPair)
  if (hotChord && pair) {
    const end = hotChord.source.index === pair[0] ? hotChord.source : hotChord.target
    const a = (end.startAngle + end.endAngle) / 2
    const r = rIn * 0.78
    const s = fmt(M[pair[0]][pair[1]] + M[pair[1]][pair[0]])
    const w = textWidth(s, VALUE, true)
    const tx = cx + r * Math.sin(a)
    const ty = cy - r * Math.cos(a)
    parts.push(underlay(tx - w / 2 - 2, midline(ty, VALUE) - 8, w + 4, 11, pal))
    parts.push(text(tx, midline(ty, VALUE), s, { size: VALUE, fill: pal.ink, anchor: 'middle', bold: true }))
  }

  if (data.unit) parts.push(text(PAD, H - 4, unitNote(data.unit, lang), { size: TICK, fill: pal.sub }))
  parts.push(text(W - PAD, H - 4, `${tr(lang, '合計', 'Total')} ${fmt(sent.reduce((s, v) => s + v, 0))}`, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 6 × 6 の表（行が列へ渡した 1 週間の引き継ぎ・合計 317 回）を、部署間の引き継ぎに直した。開発とレビューの組が最多（42 + 34 = 76） */
function sample() {
  const names = ['企画', '開発', 'レビュー', '試験', '文書', '調査']
  const matrix = [
    [0, 38, 6, 8, 5, 22],
    [10, 0, 42, 30, 9, 6],
    [4, 34, 0, 8, 3, 2],
    [3, 26, 5, 0, 2, 1],
    [2, 4, 6, 1, 0, 3],
    [18, 12, 1, 2, 4, 0],
  ]
  const links = matrix.flatMap((row, i) => row.flatMap((value, j) => (value > 0 ? [{ source: names[i], target: names[j], value }] : [])))
  return { nodes: names.map((name) => ({ name })), links, unit: '件' }
}

export default {
  id: 'chord',
  title: '弦図（Chord）',
  category: 'flow',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(Math.min(380, width * 0.68)),
  sample,
}
