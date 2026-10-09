// @ts-check
// sankey（流れ図）: 左の列から右の列へ、つながりの太さ（値）で流れを見せる。1 日の使いみちをトークンの種類から使い道へ流す、が元の見本。
// 元は look の designs/sankey.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 配置は d3-sankey（BSD-3-Clause・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）で、つながりは sankeyLinkHorizontal の曲線。
//
// 決まり（元の頭の文のとおり）: 節の並びは固定（nodeSort null）で、入れた順に読める。つながりは値と同じ太さの線で、墨の 14%（track）。
// 重なった所は濃く積み上がり、隠し合わない（元は 25% だと 1 本が明るい板になった）。節は幅の細い棒で、candle の本体と同じ墨の 55%。
// 名前と値の字は流れの外の両側の列に置き、流れの上に字を置かない。目立たせる流れは 1 つだけで、いちばん太い物（data.highlight で指定もできる）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる流れは look の Claude の橙（pal.accent）の 55%。mono は accent が墨なので墨の 80%（paper の monoArea。
//   100% は幅のある帯が黒い板になり、55% は同じ 55% の節と溶けた。見本の頁で 55・80・100% を比べた）。
// - 紙の白の上では細い線が暗い地より薄く見えるので、1.5pt 以下の細いつながりは 14% でなく 18% になる（paper の PRINT。strokeAttr が持ち上げる）。
// - 元は目立たせる流れの値を、流れの上に ink の字で置いた。mono では流れが墨 100% で字が読めず、紙の白い字は pal の外なので、
//   値は流れの始まりのすぐ上（太字・流れに重ならない所）に置く。
// - 元は列の上に「TOKEN KIND」「TOOL」と見出しを置いたが、data に列の名前が無いので置かない（上の余白は見出しの分を詰めて 14pt。いちばん上の流れの上に目立たせる値の字が乗る分だけ残す）。下の左に単位、右に合計を置く。
// - 3 列以上の時の途中の節の名前は、右に置くと流れに重なる。紙の白（pal.paper）の 85% の小さい下敷きを敷いて読めるようにする
//   （全部を外の列に出す案は、途中の節の列を飛び越えて名前と節が離れるので選ばなかった）。
// 選ばなかった案
// - 循環するつながり（A→B→A）を残す案: d3-sankey は投げる。normalize で、循環になるつながりを捨てて warnings に書く。
import { sankey, sankeyLinkHorizontal } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, VALUE, inkFill, strokeAttr, hotStroke, monoArea, text, rect, underlay, strokePath, svgDoc, empty, num, textWidth, clip, tr, nameOf, VALUE_MAX, unitNote } from './paper.mjs'

const NODE_W = 6
/** 目立たせる流れの濃さ。look の橙の 55%。mono は monoArea(55%) = 80% */
const HOT_A = ALPHA.body
const PAD_X = 4
const LABEL_GAP = 6
/** 上の余白。目立たせる値の字（8pt の太字・字の上の端は基線から 9.3pt）を、いちばん上から始まる流れの 3pt 上に置ける高さ */
const TOP = 14
const BOTTOM_FROM_BOTTOM = 22
/** 名前と値の 2 行の高さ。節の間がこれより狭い時は 1 行にする */
const TWO_LINE_H = 17

/** @typedef {{ name: string }} SNode */
/** @typedef {{ source: string, target: string, value: number }} SLink */
/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ nodes: SNode[], links: SLink[], unit: string, highlight: [string, string] | null }} SankeyData */

const asName = nameOf

/**
 * @param {unknown} data { nodes: { name, group? }[], links: { source, target, value }[], unit?, highlight?: [source, target] }（source・target は名前）
 * @returns {{ data: SankeyData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.nodes) || !Array.isArray(src.links)) warnings.push('流れ図: nodes（{ name }）と links（{ source, target, value }）の列がありません')
  /** @type {Map<string, SNode>} */
  const nodes = new Map()
  let dupNodes = 0
  for (const n of Array.isArray(src.nodes) ? src.nodes : []) {
    const name = asName(n && typeof n === 'object' ? n.name : n)
    if (!name) continue
    if (nodes.has(name)) { dupNodes++; continue }
    nodes.set(name, { name })
  }
  if (dupNodes) warnings.push(`流れ図: 同じ名前の節 ${dupNodes} 個は 1 つにしました`)

  /** @type {SLink[]} */
  const links = []
  /** @type {Map<string, Set<string>>} */
  const adj = new Map()
  /** from から to へ今のつながりでたどれるか */
  const reaches = (/** @type {string} */ from, /** @type {string} */ to) => {
    const seen = new Set([from])
    const stack = [from]
    while (stack.length) {
      const cur = /** @type {string} */ (stack.pop())
      if (cur === to) return true
      for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
    return false
  }
  let unknown = 0
  let badValue = 0
  let loops = 0
  let cycles = 0
  for (const l of Array.isArray(src.links) ? src.links : []) {
    const s = asName(l && l.source)
    const t = asName(l && l.target)
    const value = typeof l?.value === 'number' ? l.value : Number(l?.value)
    if (!nodes.has(s) || !nodes.has(t)) { unknown++; continue }
    if (!(value > 0) || !(value <= VALUE_MAX)) { badValue++; continue }
    if (s === t) { loops++; continue }
    if (reaches(t, s)) { cycles++; continue }
    const out = adj.get(s) ?? new Set()
    adj.set(s, out)
    out.add(t)
    links.push({ source: s, target: t, value })
  }
  if (unknown) warnings.push(`流れ図: nodes に無い名前を指すつながり ${unknown} 本を捨てました`)
  if (badValue) warnings.push(`流れ図: value が 0 より大きく 1,000 兆以下の数でないつながり ${badValue} 本を捨てました`)
  if (loops) warnings.push(`流れ図: 自分から自分へのつながり ${loops} 本を捨てました`)
  if (cycles) warnings.push(`流れ図: 循環になるつながり ${cycles} 本を捨てました（流れ図は一方向だけ描けます）`)

  const used = new Set(links.flatMap((l) => [l.source, l.target]))
  const kept = [...nodes.values()].filter((n) => used.has(n.name))
  if (kept.length < nodes.size) warnings.push(`流れ図: つながりの無い節 ${nodes.size - kept.length} 個は描きません`)
  const h = Array.isArray(src.highlight) && src.highlight.length === 2 ? [asName(src.highlight[0]), asName(src.highlight[1])] : null
  return { data: { nodes: kept, links, unit: typeof src.unit === 'string' ? src.unit : '', highlight: h && used.has(h[0]) && used.has(h[1]) ? /** @type {[string, string]} */ (h) : null }, warnings }
}

/**
 * d3-sankey で並べる（d3 は渡した物を書き換えるので、毎回作り直して渡す）
 * @param {SankeyData} data @param {number} pad @param {number} left @param {number} right @param {number} top @param {number} bottom
 * @returns {any}
 */
function layout(data, pad, left, right, top, bottom) {
  const layoutFn = /** @type {any} */ (sankey())
  return layoutFn
    .nodeId((/** @type {any} */ d) => d.name)
    .nodeWidth(NODE_W)
    .nodePadding(pad)
    .nodeSort(null)
    .extent([[left, top], [right, bottom]])({
      nodes: data.nodes.map((n) => ({ name: n.name })),
      links: data.links.map((l) => ({ source: l.source, target: l.target, value: l.value })),
    })
}

/**
 * @param {SankeyData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.links.length) return empty(o)
  const bottom = H - BOTTOM_FROM_BOTTOM

  // 1 回目: 列の数と 1 列の最大の節の数を知るための仮の配置（列は節の間の広さにも字の幅にも左右されない）
  const probe = layout(data, 2, PAD_X, W - PAD_X, TOP, bottom)
  const maxLayer = Math.max(...probe.nodes.map((/** @type {any} */ n) => n.layer))
  /** @type {number[]} */
  const counts = []
  for (const n of probe.nodes) counts[n.layer] = (counts[n.layer] ?? 0) + 1
  const maxCol = Math.max(...counts.filter((c) => c !== undefined))
  const pad = maxCol > 1 ? Math.min(18, Math.max(3, ((bottom - TOP) * 0.6) / (maxCol - 1))) : 0
  const twoLine = pad >= TWO_LINE_H

  const digits = data.links.every((l) => Number.isInteger(l.value)) ? 0 : Math.max(...data.links.map((l) => l.value)) < 10 ? 2 : 1
  const fmt = (/** @type {number} */ v) => num(v, digits)
  const maxName = W * 0.26
  /** @type {Map<string, { name: string, value: string }>} */
  const label = new Map()
  for (const n of probe.nodes) label.set(n.name, { name: clip(n.name, LABEL, maxName), value: fmt(n.value) })
  const widthOf = (/** @type {{ name: string, value: string }} */ t) =>
    twoLine ? Math.max(textWidth(t.name, LABEL), textWidth(t.value, TICK)) : textWidth(t.name, LABEL) + 4 + textWidth(t.value, TICK)
  const side = (/** @type {(n: any) => boolean} */ pick) => Math.max(0, ...probe.nodes.filter(pick).map((/** @type {any} */ n) => widthOf(/** @type {any} */ (label.get(n.name)))))
  const leftW = side((n) => n.layer === 0)
  const rightW = maxLayer > 0 ? side((n) => n.layer === maxLayer) : 0
  const left = PAD_X + leftW + LABEL_GAP
  const right = W - PAD_X - rightW - LABEL_GAP

  const graph = layout(data, pad, left, Math.max(right, left + 40), TOP, bottom)
  const link = sankeyLinkHorizontal()

  const hotLink = data.highlight
    ? graph.links.find((/** @type {any} */ l) => l.source.name === data.highlight?.[0] && l.target.name === data.highlight?.[1])
    : graph.links.reduce((/** @type {any} */ a, /** @type {any} */ b) => (b.value > a.value ? b : a))
  /** @type {string[]} */
  const parts = []
  // 目立たせる流れは最後に描き、重なる薄い流れの上に載せる
  const order = [...graph.links].sort((/** @type {any} */ a, /** @type {any} */ b) => Number(a === hotLink) - Number(b === hotLink))
  for (const l of order) {
    const w = Math.max(1, l.width)
    const stroke = l === hotLink ? hotStroke(pal, HOT_A, w, monoArea(HOT_A)) : strokeAttr(pal.ink, ALPHA.track, w)
    parts.push(strokePath(link.digits(1)(l), stroke))
  }

  for (const n of graph.nodes) {
    const mid = (n.y0 + n.y1) / 2
    parts.push(rect(n.x0, n.y0, n.x1 - n.x0, Math.max(1, n.y1 - n.y0), inkFill(pal, ALPHA.body)))
    const t = /** @type {{ name: string, value: string }} */ (label.get(n.name))
    const isLeft = n.layer === 0
    const isRight = n.layer === maxLayer
    const x = isLeft ? n.x0 - LABEL_GAP : n.x1 + LABEL_GAP
    const anchor = isLeft ? 'end' : 'start'
    if (!isLeft && !isRight) parts.push(underlay(x - 2, mid - 9, widthOf(t) + 4, 19, pal))
    if (twoLine) {
      parts.push(text(x, mid - 0.5, t.name, { size: LABEL, fill: pal.ink, anchor }))
      parts.push(text(x, mid + 8.5, t.value, { size: TICK, fill: pal.sub, anchor }))
    } else if (isLeft) {
      parts.push(text(x, mid + 3, t.value, { size: TICK, fill: pal.sub, anchor }))
      parts.push(text(x - textWidth(t.value, TICK) - 4, mid + 3, t.name, { size: LABEL, fill: pal.ink, anchor }))
    } else {
      parts.push(text(x, mid + 3, t.name, { size: LABEL, fill: pal.ink, anchor }))
      parts.push(text(x + textWidth(t.name, LABEL) + 4, mid + 3, t.value, { size: TICK, fill: pal.sub, anchor }))
    }
  }

  // 目立たせる流れの値は、流れが水平なうちの始まりの、流れの上に重ならない所に置く
  if (hotLink) parts.push(text(hotLink.source.x1 + 4, hotLink.y0 - hotLink.width / 2 - 3, fmt(hotLink.value), { size: VALUE, fill: pal.ink, bold: true }))

  const total = graph.nodes.filter((/** @type {any} */ n) => n.targetLinks.length === 0).reduce((/** @type {number} */ s, /** @type {any} */ n) => s + n.value, 0)
  parts.push(text(W - PAD_X, H - 4, `${tr(lang, '合計', 'Total')} ${fmt(total)}`, { size: TICK, fill: pal.sub, anchor: 'end' }))
  if (data.unit) parts.push(text(PAD_X, H - 4, unitNote(data.unit, lang), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 14 本のつながり（単位は千トークン）。名前だけ日本語に直した */
function sample() {
  const links = [
    ['入力', '読み取り', 90], ['入力', '検索', 70], ['入力', 'コマンド', 60], ['入力', '編集', 40],
    ['キャッシュ読み', '読み取り', 820], ['キャッシュ読み', '編集', 520], ['キャッシュ読み', '検索', 260], ['キャッシュ読み', '返答', 240],
    ['キャッシュ書き', '読み取り', 210], ['キャッシュ書き', 'コマンド', 130], ['キャッシュ書き', '編集', 80],
    ['出力', '編集', 70], ['出力', '返答', 50], ['出力', 'コマンド', 20],
  ]
  const names = ['入力', 'キャッシュ読み', 'キャッシュ書き', '出力', '読み取り', '編集', 'コマンド', '検索', '返答']
  return {
    nodes: names.map((name) => ({ name })),
    links: links.map(([source, target, value]) => ({ source, target, value })),
    unit: '千トークン',
  }
}

export default {
  id: 'sankey',
  title: '流れ図（Sankey）',
  category: 'flow',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {SankeyData} */ data) => Math.min(900, Math.round(width * 0.684 + Math.max(0, (data?.nodes?.length ?? 0) - 10) * 8)),
  sample,
}
