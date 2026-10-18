// @ts-check
// icicle（アイシクル）: 木を左から右へ並べる。1 列が 1 階層、升の高さが値。経費の 3 段（区分・部署・費目）のような入れ子の割合が、列をたどって読める。
// 元は look の designs/icicle.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 升の配置は d3-hierarchy の partition()（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）で、軸を入れ替えて、深さが横・値が縦になる。
//
// 決まり（元の頭の文のとおり）: 1 列が 1 つの深さで、sunburst と同じ静かな墨の段（25%・14%・8%）。升は、列の間を 2pt・隣の升の間を 1pt の溝にするよう内側に引く
// （葉が多く、1 つが 6pt に満たない物が普通のため）。名前と値は、升が収められるだけの高さと幅のときだけ書く。目立たせる升は 1 つだけ（look の橙の 55%）で、
// 既定は最大の葉。値の字は、同じ升に名前の横で収まらなければ名前の下に落とし、それも高さが無ければ書かない。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる升は accent の 55%（mono は墨の 40%。升の中に ink の字を置くので、80% にすると字が読めない。紙の色の字は pal の外）。
//   data.highlight（名前）で替えられる。
// - 色のテーマ（pal.series がある紙）では、升を 1 階層目の組ごとの系列の色で塗り（組の中は同じ色を深さで薄く）、目立たせる升の組を series[0]（accent）にする（sunburst と同じ）。
// - 列は data の階層の数（1〜3）だけ。元は 3 列に固定して「GROUP / PACKAGE / MODULE」と見出しを置いたが、data に列の名前が無いので、data.levels（字の列。省くと「1 段目」「2 段目」…）にする。
//   列の幅は、その列の名前と値の字の幅に比例させる（元は最初の 2 つの幅を手で決めていた）。
// - 4 階層目より深い所は、3 階層目の 1 つにまとめる（warnings に書く）。
// - 合計は下の右に、元と同じく「合計」（7.5pt）と数（14pt）。単位は下の左に「単位: 百万円」と 1 度だけ。
// 選ばなかった案
// - 4 階層以上を列を細くして全部並べる案: 6 列では 1 列が 80pt 以下になり、名前が 1 つも書けない。3 階層までにして、深い所はまとめる。
// - 升を値の大きい順でなく、data の並びのまま置く案: partition は大きい順に並べるほうが、細い升が下にまとまって読みやすい（元と同じ）。
import { hierarchy, partition } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, BIG, inkFill, hotFill, fillAttr, seriesColor, text, rect, svgDoc, empty, num, textWidth, tr, midline, nameOf, arr, unitNote } from './paper.mjs'
import { normalizeTree, valueTree, labelOf, treeDigits, pickHot, depthOf } from './parts-kit.mjs'

const FOOT = 26
const PAD = 8
/** 階層ごとの墨の段（1 階層目から）。look の「25・14・8%」 */
const STEPS = [ALPHA.area, ALPHA.track, ALPHA.faint]
/** 色のテーマの段（1 階層目から）。字（ink）が載るので 3 対 1 以上で読める濃さ。目立たせる升は 0.6（sunburst と同じ） */
const COLOR_STEPS = [0.5, 0.36, 0.24]
const COLOR_HOT = 0.6

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean, children?: TreeNode[] }} TreeNode */
/** @typedef {{ root: TreeNode | null, hot: TreeNode | null, unit: string, levels: string[] }} IcicleData */

/**
 * @param {unknown} data { root: { name, children }, unit?, highlight?, levels?: string[] }
 * @returns {{ data: IcicleData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const root = normalizeTree(src, 'アイシクル', warnings, { maxDepth: 3 })
  const want = nameOf(src.highlight)
  const hot = root ? pickHot(root, want) : null
  if (want && root && hot && hot.name !== want) warnings.push(`アイシクル: highlight「${want}」の名前の升がありません`)
  return { data: { root, hot, unit: typeof src.unit === 'string' ? src.unit : '', levels: arr(src.levels).map(nameOf).slice(0, 3) }, warnings }
}

/**
 * @param {IcicleData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.root) return empty(o)
  const digits = treeDigits(data.root)
  const cols = depthOf(data.root)
  const plot = { top: 30, bottom: H - FOOT }

  const tree = valueTree(hierarchy, data.root)
  const topNodes = data.root.children ?? []
  /** @param {any} node @param {any} target */
  const holds = (node, target) => node === target || (node.children ?? []).some((/** @type {any} */ c) => holds(c, target))
  const hotGroup = data.hot ? topNodes.findIndex((t) => holds(t, data.hot)) : -1
  const place = /** @type {any} */ (partition()).size([plot.bottom - plot.top, 1])
  place(tree)
  /** @type {any[]} */
  const nodes = tree.descendants().filter((/** @type {any} */ d) => d.depth > 0)

  // 列の幅: その列でいちばん長い「名前 + 値」の幅に比例して、全体（左右の余白と溝を除く）を分ける。1 列は幅の 14〜34% の間に収まる
  const avail = W - 2 * PAD - 2 * (cols - 1)
  const want = Array.from({ length: cols }, (_, c) => {
    const m = Math.max(0, ...nodes.filter((d) => d.depth === c + 1).map((d) => textWidth(labelOf(d.data, lang), LABEL) + textWidth(num(d.value ?? 0, digits), TICK) + 18))
    return Math.min(W * 0.34, Math.max(W * 0.14, m))
  })
  const sum = want.reduce((s, v) => s + v, 0)
  const widths = want.map((v) => (avail * v) / sum)
  const xs = widths.map((_, c) => PAD + widths.slice(0, c).reduce((s, v) => s + v, 0) + 2 * c)

  /** @type {string[]} */
  const parts = []
  for (let c = 0; c < cols; c++) {
    const head = data.levels[c] || tr(lang, `${c + 1} 段目`, `Level ${c + 1}`)
    parts.push(text(xs[c] + 6, 22, head, { size: TICK, fill: pal.sub }))
  }

  for (const d of nodes) {
    const c = d.depth - 1
    const x0 = xs[c]
    const w = widths[c]
    const y = plot.top + d.x0 + 0.5
    const h = Math.max(0.5, d.x1 - d.x0 - 1)
    const hot = d.data === data.hot
    const group = d.ancestors().find((/** @type {any} */ a) => a.depth === 1)
    const tone = seriesColor(pal, group ? topNodes.indexOf(group.data) : 0, hotGroup)
    parts.push(rect(x0, y, w, h, tone !== null ? fillAttr(tone, hot ? COLOR_HOT : COLOR_STEPS[c]) : hot ? hotFill(pal, ALPHA.body, 0.4) : inkFill(pal, STEPS[c])))
    const name = labelOf(d.data, lang)
    const nameW = textWidth(name, LABEL)
    if (h < 11 || nameW + 12 > w) continue
    const v = num(d.value ?? 0, digits)
    const valueW = textWidth(v, TICK)
    // 値の字は、1 階層目と目立たせる升は ink・ほかは sub（元と同じ）
    const valueFill = d.depth === 1 || hot ? pal.ink : pal.sub
    if (nameW + valueW + 18 <= w) {
      const ty = h >= 26 ? y + 12 : y + h / 2
      parts.push(text(x0 + 6, h >= 26 ? ty : midline(ty, LABEL), name, { size: LABEL, fill: pal.ink }))
      parts.push(text(x0 + w - 6, h >= 26 ? ty : midline(ty, TICK), v, { size: TICK, fill: valueFill, anchor: 'end' }))
    } else {
      parts.push(text(x0 + 6, h >= 26 ? y + 12 : midline(y + h / 2, LABEL), name, { size: LABEL, fill: pal.ink }))
      if (h >= 30) parts.push(text(x0 + 6, y + 23.5, v, { size: TICK, fill: valueFill }))
    }
  }

  const total = num(data.root.value, digits)
  parts.push(text(W - PAD, H - 4, total, { size: BIG, fill: pal.ink, anchor: 'end' }))
  parts.push(text(W - PAD - textWidth(total, BIG) - 6, H - 4, tr(lang, '合計', 'Total'), { size: TICK, fill: pal.sub, anchor: 'end' }))
  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(PAD, H - 4, note, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（1,842KB の Web の束。3 階層・42 の葉・区分の合計 1,108 + 512 + 222）の数のまま、年間の経費（百万円）の話に直した。最大の葉（176）が目立たせる升になる */
function sample() {
  /** @type {[string, [string, number][]][]} */
  const people = [
    ['営業部', [['基本給', 176], ['賞与', 52], ['福利厚生', 36]]],
    ['製造部', [['基本給', 132], ['残業代', 28], ['福利厚生', 12]]],
    ['開発部', [['基本給', 104], ['賞与', 52]]],
    ['管理部', [['基本給', 46], ['賞与', 38], ['残業代', 26], ['福利厚生', 18]]],
    ['広報部', [['基本給', 61], ['賞与', 27], ['残業代', 18], ['福利厚生', 12]]],
    ['人事部', [['基本給', 52], ['賞与', 28], ['福利厚生', 14]]],
    ['品質部', [['基本給', 44], ['賞与', 18]]],
  ]
  const leaf = (/** @type {string} */ name, /** @type {number} */ value) => ({ name, value })
  const group = (/** @type {string} */ name, /** @type {[string, number][]} */ kids) => ({ name, children: kids.map(([n, v]) => leaf(n, v)) })
  const events = [
    ['広告宣伝', [['テレビ', 64], ['ウェブ', 48], ['雑誌', 36], ['屋外', 30], ['展示', 18]]],
    ['出張・交際', [['国内出張', 46], ['海外出張', 41], ['会議費', 36], ['交際費', 25]]],
    ['外注', [['デザイン', 34], ['開発', 28], ['翻訳', 20], ['校正', 14]]],
    ['研修', [['社外研修', 48], ['資格', 24]]],
  ]
  return {
    root: {
      name: '年間の経費',
      children: [
        { name: '人件費', children: [...people.map(([n, kids]) => group(n, kids)), leaf('経理部', 57), leaf('総務部', 41), leaf('役員', 16)] },
        { name: '事業費', children: events.map(([n, kids]) => group(/** @type {string} */ (n), /** @type {[string, number][]} */ (kids))) },
        { name: '管理費', children: [leaf('賃借料', 96), leaf('光熱費', 90), leaf('通信費', 36)] },
      ],
    },
    unit: '百万円',
    levels: ['区分', '部署・項目', '費目'],
  }
}

export default {
  id: 'icicle',
  title: 'アイシクル（Icicle）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.6),
  sample,
}
