// @ts-check
// sunburst（サンバースト）: 木を環の重なりで見せる。内側が上の階層で、1 つの環が 1 つの深さ。扇の角度が値。
// 元は look の designs/sunburst.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
// 環の配置は d3-hierarchy の partition()、扇の形は d3-shape の arc()（どちらも ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 決まり（元の頭の文のとおり）: 環は 1 つの深さが墨の 1 段で、静かな段を使う。内側から面の塗り 25%・枠の段 14%・薄い面 8%（中心の 42% を試したら、最も内側の環が candle より目立ったため。
// streamgraph も同じ結論）。隣の扇とは、環の真ん中の円周で測って 2pt 空け、環と環の間も 2pt 空ける。名前は、字の箱が扇の中に全部入る時だけ書く（短い扇は、切れた字でなく空白にする）。
// 目立たせる扇は 1 つだけ（look の橙の 55%）。右の一覧が、いちばん上の階層の値を全部持つ。穴には合計を置く。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる扇は accent の 55%（mono は墨の 40%。扇の中に ink の名前を置くので、80% だと字が読めない）。
//   既定は最大の葉。data.highlight（名前）で替えられる。右下の「注目」の 1 行も同じ節の名前と値。
// - 元は名前を環に沿って回して置いたが、svg.mjs は回した字の向きを読まない（警告になる）。名前は横向きのまま、字の箱が扇に全部入る場合だけ置く
//   （paper の字の幅で測る。元の fits と同じ判定で、回転の角度が 0 になる）。入らない扇は空白で、名前は右の一覧が持つ。
// - 環の太さは階層の数で等分する（元は 44・28・18 と外へ細くした。横向きの字が入るよう外の環も太くした）。階層は 1〜3 で、4 階層目より深い所は 3 階層目の 1 つにまとめる。
// - 右の一覧は元のとおり、いちばん上の階層の名前と値を環の順に。紙では長さに限りがあるので、入らない行は最後の 1 行「ほか n 件」にまとめる。見出しは data.levels の 1 つ目（無ければ「区分」）と単位。
// - 単位は下の左に「単位: 百万円」と 1 度だけ。右下の「注目」の行は、目立たせる扇の名前と値を accent の太字で。
// 選ばなかった案
// - 字を扇に沿って回す案: svg.mjs が回した字を読めない。字を 1 字ずつ位置と角度を決めて並べる案も、紙の字の幅の見積もりが外れた時にずれるので採らない。
// - 名前を扇の外に引き出し線で出す案: 3 階層の細かい扇に付けると線が交差し、右の一覧と二重になる。
import { hierarchy, partition, arc } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, VALUE, BIG, inkFill, inkStroke, hotFill, text, line, fillPath, svgDoc, empty, num, textWidth, clip, tr, midline, nameOf, arr, unitNote, LW } from './paper.mjs'
import { normalizeTree, valueTree, labelOf, treeDigits, pickHot, depthOf } from './parts-kit.mjs'

const FOOT = 18
/** 扇と扇・環と環の隙間（pt） */
const GAP = 2
/** 階層ごとの墨の段（1 階層目から） */
const STEPS = [ALPHA.area, ALPHA.track, ALPHA.faint]

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean, children?: TreeNode[] }} TreeNode */
/** @typedef {{ root: TreeNode | null, hot: TreeNode | null, byName: boolean, unit: string, levels: string[] }} SunburstData */

/**
 * @param {unknown} data { root: { name, children }, unit?, highlight?, levels?: string[] }
 * @returns {{ data: SunburstData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const root = normalizeTree(src, 'サンバースト', warnings, { maxDepth: 3 })
  const want = nameOf(src.highlight)
  const hot = root ? pickHot(root, want) : null
  const byName = !!(want && hot && hot.name === want)
  if (want && root && !byName) warnings.push(`サンバースト: highlight「${want}」の名前の扇がありません`)
  return { data: { root, hot, byName, unit: typeof src.unit === 'string' ? src.unit : '', levels: arr(src.levels).map(nameOf).slice(0, 3) }, warnings }
}

/**
 * @param {SunburstData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.root) return empty(o)
  const digits = treeDigits(data.root)
  const levels = depthOf(data.root)

  // 環は左・一覧は右。外半径は、高さ（注記と上下の余白を引いた分）と幅の 3 割の小さい方。穴は外半径の 28%
  const top = 10
  const bottom = H - FOOT
  const rOut = Math.max(30, Math.min((bottom - top) / 2, W * 0.3))
  const cx = 14 + rOut
  const cy = (top + bottom) / 2
  const hole = rOut * 0.28
  const thick = (rOut - hole - GAP * (levels - 1)) / levels
  /** @type {(depth: number) => [number, number]} */
  const ringOf = (depth) => {
    const r0 = hole + (depth - 1) * (thick + GAP)
    return [r0, r0 + thick]
  }
  const rmid = (/** @type {number} */ depth) => (ringOf(depth)[0] + ringOf(depth)[1]) / 2

  const tree = valueTree(hierarchy, data.root)
  const place = /** @type {any} */ (partition()).size([2 * Math.PI, 1])
  place(tree)
  const wedge = /** @type {any} */ (arc())
    .startAngle((/** @type {any} */ d) => d.x0)
    .endAngle((/** @type {any} */ d) => d.x1)
    .innerRadius((/** @type {any} */ d) => ringOf(d.depth)[0])
    .outerRadius((/** @type {any} */ d) => ringOf(d.depth)[1])
    .padAngle((/** @type {any} */ d) => GAP / rmid(d.depth))
    .padRadius((/** @type {any} */ d) => rmid(d.depth))
    .digits(2)
  /** @type {any[]} */
  const nodes = tree.descendants().filter((/** @type {any} */ d) => d.depth > 0)

  /**
   * 字の箱（w × h・中心 (x, y)・中心 (0, 0) からの座標）が扇の中に全部入るか。d3 の角度は 12 時から時計回り
   * @param {any} d @param {number} x @param {number} y @param {number} w @param {number} h
   */
  const fits = (d, x, y, w, h) => {
    const [r0, r1] = ringOf(d.depth)
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0]]) {
      const px = x + (dx * w) / 2
      const py = y + (dy * h) / 2
      const r = Math.hypot(px, py)
      let a = Math.atan2(px, -py)
      if (a < 0) a += 2 * Math.PI
      const air = (GAP + 2) / r
      if (r < r0 + 1.5 || r > r1 - 1.5 || a < d.x0 + air || a > d.x1 - air) return false
    }
    return true
  }

  /** @type {string[]} */
  const shapes = []
  /** @type {string[]} */
  const labels = []
  for (const d of nodes) {
    // 1pt の弧は見えないので、環の真ん中で 0.5pt に満たない扇は描かない（巨大な木で d の字が膨らむのも防ぐ）
    if ((d.x1 - d.x0) * rmid(d.depth) < 0.5) continue
    const hot = d.data === data.hot
    shapes.push(fillPath(wedge(d) ?? '', hot ? hotFill(pal, ALPHA.body, 0.4) : inkFill(pal, STEPS[d.depth - 1])))
  }
  // 名前は横向きのまま、字の箱が扇の中に全部入る扇だけ
  for (const d of nodes) {
    const name = labelOf(d.data, lang)
    const [mx, my] = /** @type {[number, number]} */ (wedge.centroid(d))
    if (fits(d, mx, my, textWidth(name, LABEL), 9)) labels.push(text(cx + mx, midline(cy + my, LABEL), name, { size: LABEL, fill: pal.ink, anchor: 'middle' }))
  }
  /** @type {string[]} */
  const parts = [`<g transform="translate(${cx} ${cy})">${shapes.join('')}</g>`, ...labels]

  parts.push(text(cx, cy - 1, num(data.root.value, digits), { size: BIG, fill: pal.ink, anchor: 'middle' }))
  parts.push(text(cx, cy + 12, tr(lang, '合計', 'Total'), { size: TICK, fill: pal.sub, anchor: 'middle' }))

  // 右の一覧: いちばん上の階層の名前と値（環の順）。収まらない行は「ほか n 件」の 1 行に
  const lx = Math.max(cx + rOut + 24, W * 0.6)
  const rx = W - 8
  const topNodes = data.root.children ?? []
  const hotNode = data.hot
  const reserve = hotNode ? 50 : 14
  const maxRows = Math.max(3, Math.floor((H - FOOT - 16 - reserve - 22) / 13))
  const shown = topNodes.length > maxRows ? topNodes.slice(0, maxRows - 1) : topNodes
  const rest = topNodes.slice(shown.length)
  const rowH = Math.min(20, (H - FOOT - 16 - reserve - 26) / (shown.length + (rest.length ? 1 : 0)))
  const listH = 16 + (shown.length + (rest.length ? 1 : 0)) * rowH + (hotNode ? 44 : 0)
  const y0 = Math.max(18, cy - listH / 2 + 12)
  const valW = Math.max(...topNodes.map((d) => textWidth(num(d.value, digits), VALUE, true)))
  const head = data.levels[0] || tr(lang, '区分', 'Group')
  parts.push(text(lx, y0 - 8, clip(head, TICK, rx - lx - valW - 10), { size: TICK, fill: pal.sub }))
  if (data.unit) parts.push(text(rx, y0 - 8, clip(data.unit, TICK, 60), { size: TICK, fill: pal.sub, anchor: 'end' }))
  shown.forEach((d, i) => {
    const y = y0 + 4 + i * rowH
    parts.push(text(lx, midline(y, LABEL), clip(labelOf(d, lang), LABEL, rx - lx - valW - 12), { size: LABEL, fill: pal.ink }))
    parts.push(text(rx, midline(y, VALUE), num(d.value, digits), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  })
  let endY = y0 + 4 + (shown.length - 1) * rowH
  if (rest.length) {
    endY += rowH
    parts.push(text(lx, midline(endY, LABEL), tr(lang, `ほか ${rest.length} 件`, `${rest.length} more`), { size: LABEL, fill: pal.sub }))
    parts.push(text(rx, midline(endY, VALUE), num(rest.reduce((s, d) => s + d.value, 0), digits), { size: VALUE, fill: pal.sub, anchor: 'end', bold: true }))
  }
  if (hotNode) {
    const by = endY + 22
    parts.push(line(lx, by - 12, rx, by - 12, inkStroke(pal, ALPHA.quiet, LW.line)))
    parts.push(text(lx, by, data.byName ? tr(lang, '注目', 'Highlight') : tr(lang, '最大', 'Largest'), { size: TICK, fill: pal.sub }))
    parts.push(text(lx, by + 14, clip(labelOf(hotNode, lang), LABEL, rx - lx - valW - 12), { size: LABEL, fill: pal.accent, bold: true }))
    parts.push(text(rx, by + 14, num(hotNode.value, digits), { size: VALUE, fill: pal.accent, anchor: 'end', bold: true }))
  }

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（412MB のリポジトリ。7 つの最上位の合計 168・121・58・31・19・9・6、最大の 1 つ 52）の数のまま、年間売上（百万円）の話に直した */
function sample() {
  const leaf = (/** @type {string} */ name, /** @type {number} */ value) => ({ name, value })
  const group = (/** @type {string} */ name, /** @type {[string, number][]} */ kids) => ({ name, children: kids.map(([n, v]) => leaf(n, v)) })
  return {
    root: {
      name: '年間売上',
      children: [
        { name: '食品', children: [group('生鮮', [['青果', 151], ['精肉', 11]]), leaf('総菜', 6)] },
        { name: '衣料', children: [group('婦人服', [['コート', 52], ['ニット', 22]]), group('紳士服', [['スーツ', 21], ['シャツ', 7], ['小物', 5]]), group('子供服', [['男児', 9], ['女児', 5]])] },
        { name: '家電', children: [group('大型', [['冷蔵庫', 21], ['洗濯機', 11], ['エアコン', 5]]), group('小型', [['調理', 16], ['美容', 5]])] },
        group('日用品', [['洗剤', 12], ['紙類', 11], ['化粧', 8]]),
        group('家具', [['机', 8], ['椅子', 6], ['棚', 5]]),
        group('文具', [['筆記具', 6], ['紙', 3]]),
        leaf('書籍', 6),
      ],
    },
    unit: '百万円',
    highlight: 'コート',
    levels: ['部門'],
  }
}

export default {
  id: 'sunburst',
  title: 'サンバースト（Sunburst）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.62),
  sample,
}
