// @ts-check
// circle-pack（円の詰め合わせ）: 組の中に葉の円を詰めて、円の面積で値を見せる。組は円の外形（細い線）、葉は塗り。
// 元は look の designs/circle-pack.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 円の配置は d3-hierarchy の pack()（ISC・Mike Bostock。Wang らの front-chain 詰め込み。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり）: 円の面積が値。組は 1px の外形線で墨の 18%（枠の段）、葉は墨の 25%（面の塗りの段）。重みは葉が持ち、組は葉を集めるだけ。
// 組の名前と合計は、組の外形線のあいた所に置く（fieldset の見出しのように）。円の中に場所を取らず、上に置く。上に別の組が迫っていたら下に置く
// （接する点では、字がどちらの円の物か分からない）。葉は 3 の余白を持って、名前が葉に重ならない。葉の名前は円の幅に収まる時だけ、値は 2 行目が入る高さの時だけ。
// 詰めた組は、四分の一回して（x と y を入れ替えて。円はどれも接したまま）、組の外接の四角（root の円ではない）を横長の枠にそろえる。葉が元の 18% ほど大きくなる。
//
// data の読み方: root の子が組（子の子が葉）。深い所の節は、組の中の葉にまとめる（2 階層まで）。root の子が全部葉なら、組の線も名前も無く、葉だけを詰める。
//
// 紙に写して変えた所
// - 暗い地は塗らない。組の名前と合計は sub の 7.5pt、葉の名前は 8pt の ink・値は 7.5pt の sub。単位は下の左に「単位: 千人」と 1 度だけ。合計は元と同じく下の右（数は 14pt）。
// - 元の「字の幅 = 1 字 5.6px の見積もり」は、paper の字の幅（textWidth）にした。組の名前は円の幅の 1.6 倍までに収める。
// - 元は 1px の外形線を 18% で引いた。紙の白の上では 1pt の線は 18% 未満で消える（paper の PRINT.line が下限）ので 18% のまま。
// - 組が 24 を超える、または 1 つの組の葉が 24 を超える data は、小さい順に「その他」の 1 つにまとめる（合計は変わらない）。
// 選ばなかった案
// - 組の外形線を字の部分だけ紙の色で塗りつぶして切る案: 元の作者が先に試して、上の葉と隣の組の外形線まで削れたので、線を字の幅だけ手前で止める弧にした（元の頭の文のとおり）。
import { hierarchy, pack } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, BIG, inkFill, inkStroke, text, circle, svgDoc, empty, num, textWidth, clip, tr, midline, f, unitNote, LW } from './paper.mjs'
import { normalizeTree, valueTree, labelOf, treeDigits } from './parts-kit.mjs'

const FOOT = 24

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean, children?: TreeNode[] }} TreeNode */
/** @typedef {{ root: TreeNode | null, unit: string }} PackData */

/**
 * @param {unknown} data { root: { name, children: { name, children: { name, value }[] }[] }, unit? }
 * @returns {{ data: PackData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const root = normalizeTree(src, '円の詰め合わせ', warnings, { maxDepth: 2 })
  return { data: { root, unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * @param {PackData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.root) return empty(o)
  const digits = treeDigits(data.root)
  const plot = { left: 8, top: 14, right: W - 8, bottom: H - FOOT }

  const tree = valueTree(hierarchy, data.root)
  const place = /** @type {any} */ (pack()).size([300, 300]).padding((/** @type {any} */ d) => (d.depth === 0 ? 6 : 3))
  place(tree)
  // 四分の一回して、組の外接の四角を横長の枠に収める
  tree.each((/** @type {any} */ d) => { const x = d.x; d.x = d.y; d.y = x })
  /** @type {any[]} */
  const groups = tree.children ?? []
  const bx0 = Math.min(...groups.map((/** @type {any} */ g) => g.x - g.r))
  const bx1 = Math.max(...groups.map((/** @type {any} */ g) => g.x + g.r))
  const by0 = Math.min(...groups.map((/** @type {any} */ g) => g.y - g.r))
  const by1 = Math.max(...groups.map((/** @type {any} */ g) => g.y + g.r))
  const k = Math.min((plot.right - plot.left) / (bx1 - bx0), (plot.bottom - plot.top) / (by1 - by0))
  const ox = (plot.left + plot.right) / 2 - ((bx0 + bx1) / 2) * k
  const oy = (plot.top + plot.bottom) / 2 - ((by0 + by1) / 2) * k
  tree.each((/** @type {any} */ d) => { d.x = ox + d.x * k; d.y = oy + d.y * k; d.r *= k })

  /** @type {string[]} */
  const parts = []
  /** @type {string[]} */
  const legends = []

  // 組の名前は外形線の上に置く。ほかの組が迫っていない側（上、だめなら下）。標本は字の箱の左右と真ん中の、上下 5pt
  /** @param {any} g @param {number} y @param {number} w */
  const clearance = (g, y, w) => {
    let min = Infinity
    for (const other of groups) {
      if (other === g) continue
      for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-5, 5]) min = Math.min(min, Math.hypot(g.x + dx - other.x, y + dy - other.y) - other.r)
    }
    return min
  }

  for (const g of groups) {
    if (!g.children) {
      leaf(g)
      continue
    }
    const total = num(g.value ?? 0, digits)
    const nameMax = Math.max(12, Math.min(g.r * 1.6, W * 0.4) - textWidth(` ${total}`, TICK))
    const label = `${clip(labelOf(g.data, lang), TICK, nameMax)} ${total}`
    const w = textWidth(label, TICK)
    const above = clearance(g, g.y - g.r, w)
    const below = clearance(g, g.y + g.r, w)
    const th = above >= 4 || above >= below ? -Math.PI / 2 : Math.PI / 2
    // 外形線は、字の左右 3pt 手前で止まる 1 本の弧
    const a = Math.min(1.2, Math.asin(Math.min(1, (w / 2 + 3) / g.r)))
    const x0 = g.x + g.r * Math.cos(th + a)
    const y0 = g.y + g.r * Math.sin(th + a)
    const x1 = g.x + g.r * Math.cos(th - a)
    const y1 = g.y + g.r * Math.sin(th - a)
    parts.push(`<path d="M${f(x0)} ${f(y0)}A${f(g.r)} ${f(g.r)} 0 1 1 ${f(x1)} ${f(y1)}" fill="none" ${inkStroke(pal, ALPHA.card, LW.line)}/>`)
    legends.push(text(g.x, midline(g.y + Math.sin(th) * (g.r + 1.5), TICK), label, { size: TICK, fill: pal.sub, anchor: 'middle' }))
    for (const d of g.children) leaf(d)
  }
  parts.push(...legends)

  /** 葉の円と、収まる時だけ名前と値 @param {any} d */
  function leaf(d) {
    parts.push(circle(d.x, d.y, d.r, inkFill(pal, ALPHA.area)))
    const name = labelOf(d.data, lang)
    if (2 * d.r < textWidth(name, LABEL) + 4) return
    const two = d.r >= 15
    parts.push(text(d.x, midline(d.y + (two ? -4.5 : 0), LABEL), name, { size: LABEL, fill: pal.ink, anchor: 'middle' }))
    if (two) parts.push(text(d.x, midline(d.y + 5.5, TICK), num(d.value ?? 0, digits), { size: TICK, fill: pal.sub, anchor: 'middle' }))
  }

  const total = num(data.root.value, digits)
  parts.push(text(W - 8, H - 4, total, { size: BIG, fill: pal.ink, anchor: 'end' }))
  parts.push(text(W - 8 - textWidth(total, BIG) - 6, H - 4, tr(lang, '合計', 'Total'), { size: TICK, fill: pal.sub, anchor: 'end' }))
  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（6 組・23 の葉。組の合計 55・33・24・24・18・15、全部で 169）の数のまま、地域別の来場者（千人）の話に直した */
function sample() {
  const groups = [
    ['関東', [['東京', 30], ['横浜', 14], ['さいたま', 7], ['千葉', 4]]],
    ['関西', [['大阪', 26], ['京都', 5], ['神戸', 2]]],
    ['東海', [['名古屋', 9], ['静岡', 8], ['浜松', 4], ['岐阜', 3]]],
    ['九州', [['福岡', 11], ['熊本', 6], ['鹿児島', 5], ['長崎', 2]]],
    ['東北', [['仙台', 5], ['盛岡', 4], ['青森', 3], ['秋田', 3], ['山形', 2], ['福島', 1]]],
    ['北海道', [['札幌', 8], ['旭川', 7]]],
  ]
  return {
    root: { name: '来場者', children: groups.map(([name, kids]) => ({ name, children: /** @type {any[][]} */ (kids).map(([n, value]) => ({ name: n, value })) })) },
    unit: '千人',
  }
}

export default {
  id: 'circle-pack',
  title: '円の詰め合わせ（Circle packing）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.66),
  sample,
}
