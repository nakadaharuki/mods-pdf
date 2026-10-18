// @ts-check
// treemap（ツリーマップ）: 値を面積にして、十分に正方形に近い升で図全体を埋める（squarified 法）。
// 元は look の designs/treemap.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 配置は d3-hierarchy の treemap と treemapSquarify（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。元は自前の squarify だったが、入れ子（組の中の組）も同じ手で置けるので d3 にした。
//
// 決まり（元の頭の文のとおり）: 升の大きさが値で、塗りは変化の符号で上げ・下げの色の 25%。升は 1pt ずつ内側に引いて、升どうしの間を 2pt の溝にする。
// 名前は、升が名前を収められるだけの大きさのときだけ書く（切れた名前は、無い名前より読みにくい）。
//
// data の読み方: root の葉が升。leaf の delta（数。前年比などの変化の割合 %）があれば、正は上げ・負は下げの色の 25%、delta が無い・0 の升は墨の 14%。
// data.deltaLabel（字）は凡例と升の字に使う「何の変化か」。root が 2 階層以上なら、1 階層目の組の名前を組の上の細い帯に書く（組の名前は帯に収まる時だけ）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。升は 1pt の溝で分ける（元の stroke の墨 12% の枠は、紙では細い線が消えやすいので引かない。溝だけで升は分かれる）。
// - 升の字は、名前（8pt・ink）と、その下に値（7.5pt・sub）・delta（7.5pt・上げ下げの色）。値の字の高さが入る升（高さ 32pt 以上）だけ 2 行目を書く。単位は下の左に「単位: 百万円」と 1 度だけ。
// - 凡例は下の右に、delta がある data のときだけ「前年比 増」「前年比 減」の札 2 つ。mono では上げ下げの色の明るさが近いので、升の中に delta を符号つきの字で書いて、色が無くても読めるようにする。
// - 色のテーマ（pal.series がある紙）では、delta の無い・0 でない data の升を、組があれば組ごと・無ければ升ごと（大きい順）に系列の色で分ける（墨の 14% の灰の升をやめる）。字が載るので濃さは TONE.under。
//   delta が 0 の升は、delta のある data の中の「変化なし」なので灰のまま（色を付けると上げ下げの色の意味が崩れる）。
// - 1 つの節の子が 24 を超えたら、小さい順に「その他」の 1 つにまとめる（合計は変わらない）。「その他」は大きくても最後の升に置く。
// 選ばなかった案
// - 升の名前を、升に収まるよう「…」で切って書く案: 元の決まり（切れた名前は無い名前より読みにくい）に反する。
// - 組ごとに外枠の線を引く案: 紙で細い線が消えやすく、「枠と軸の線を引かない」にも反する。組は帯に名前を書くだけにする。
import { hierarchy, treemap, treemapSquarify } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, TONE, inkFill, fillAttr, seriesFill, text, rect, legend, svgDoc, empty, num, signed, textWidth, clip, tr, decimals, unitNote } from './paper.mjs'
import { normalizeTree, valueTree, labelOf, leavesOf, treeDigits } from './parts-kit.mjs'

const FOOT = 20
/** 組の名前を書く帯の高さ */
const GROUP_H = 12

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, delta?: number, other?: boolean, children?: TreeNode[] }} TreeNode */
/** @typedef {{ root: TreeNode | null, unit: string, deltaLabel: string }} TreemapData */

/**
 * @param {unknown} data { root: { name, value?, children?, delta? }, unit?, deltaLabel? }
 * @returns {{ data: TreemapData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const root = normalizeTree(src, 'ツリーマップ', warnings)
  return { data: { root, unit: typeof src.unit === 'string' ? src.unit : '', deltaLabel: typeof src.deltaLabel === 'string' ? src.deltaLabel.trim() : '' }, warnings }
}

/**
 * @param {TreemapData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.root) return empty(o)
  const leaves = leavesOf(data.root)
  const digits = treeDigits(data.root)
  const deltas = leaves.map((l) => l.delta).filter((d) => d !== undefined)
  const dDigits = decimals(/** @type {number[]} */ (deltas))
  const hasDelta = deltas.length > 0

  const px = 2
  const py = 2
  const pw = W - 2 * px
  const ph = H - FOOT - py
  const nested = (data.root.children ?? []).some((c) => c.children)
  const tree = valueTree(hierarchy, data.root)
  const place = /** @type {any} */ (treemap()).tile(/** @type {any} */ (treemapSquarify).ratio(1)).size([pw, ph]).paddingTop((/** @type {any} */ d) => (nested && d.depth === 1 ? GROUP_H : 0))
  place(tree)

  /** @type {string[]} */
  const parts = []
  // 色のテーマで delta が無い data の升の色番号: 組があれば 1 階層目の組の番号、無ければ升の並び（大きい順）
  const groupAt = new Map((tree.children ?? []).map((g, i) => [g, i]))
  let leafAt = 0
  for (const d of tree.leaves()) {
    const colorIndex = nested ? (groupAt.get(d.ancestors().find((a) => a.depth === 1)) ?? 0) : leafAt
    leafAt++
    const left = px + d.x0 + 1
    const top = py + d.y0 + 1
    const cw = d.x1 - d.x0 - 2
    const ch = d.y1 - d.y0 - 2
    if (!(cw > 0.5) || !(ch > 0.5)) continue
    const node = d.data
    const delta = node.delta
    const fill = delta === undefined && !hasDelta ? (seriesFill(pal, colorIndex, -1, TONE.under) ?? inkFill(pal, ALPHA.track))
      : delta === undefined || delta === 0 ? inkFill(pal, ALPHA.track) : fillAttr(delta > 0 ? pal.up : pal.down, ALPHA.area)
    parts.push(rect(left, top, cw, ch, fill))
    // 名前が収まる升だけ字を書く。値の字は高さに余裕がある升だけ
    const name = labelOf(node, lang)
    if (cw < textWidth(name, LABEL) + 12 || ch < 17) continue
    parts.push(text(left + 6, top + 12.5, name, { size: LABEL, fill: pal.ink }))
    if (ch >= 32) {
      const v = num(node.value, digits)
      parts.push(text(left + 6, top + 24.5, v, { size: TICK, fill: pal.sub }))
      if (delta !== undefined && cw >= textWidth(v, TICK) + textWidth(`${signed(delta, dDigits)}%`, TICK) + 20) {
        parts.push(text(left + 6 + textWidth(v, TICK) + 6, top + 24.5, `${signed(delta, dDigits)}%`, { size: TICK, fill: delta > 0 ? pal.up : delta < 0 ? pal.down : pal.sub }))
      }
    }
  }
  if (nested) {
    for (const g of tree.children ?? []) {
      if (!g.children || g.x1 - g.x0 < 24) continue
      parts.push(text(px + g.x0 + 3, py + g.y0 + 9, clip(labelOf(g.data, lang), TICK, g.x1 - g.x0 - 6), { size: TICK, fill: pal.sub }))
    }
  }

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  if (hasDelta) {
    const dl = data.deltaLabel || tr(lang, '変化', 'Change')
    parts.push(legend(W - 8, H - 4, [
      { label: `${dl} ${tr(lang, '増', 'Up')}`, mark: 'box', attr: fillAttr(pal.up, ALPHA.area) },
      { label: `${dl} ${tr(lang, '減', 'Down')}`, mark: 'box', attr: fillAttr(pal.down, ALPHA.area) },
    ], pal, { anchor: 'end' }).svg)
  }
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（10 業種。ソフトウェア・半導体など。値は 20〜141、上げ下げは符号）を、事業別の売上（百万円）と前年比（%）の話に直した。値の大きい順に 141・134・123・96・82・59・48・33・24・20 */
function sample() {
  const rows = [
    ['通信', 141, 3.2], ['医薬', 134, 1.4], ['ソフトウェア', 123, 8.5], ['小売', 96, -2.1], ['素材', 82, -4.6],
    ['自動車', 59, 0.8], ['エネルギー', 48, -1.2], ['半導体', 33, 12.4], ['銀行', 24, -0.6], ['公益', 20, 0.3],
  ]
  return { root: { name: '事業別の売上', children: rows.map(([name, value, delta]) => ({ name, value, delta })) }, unit: '百万円', deltaLabel: '前年比' }
}

export default {
  id: 'treemap',
  title: 'ツリーマップ（Treemap）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.62),
  sample,
}
