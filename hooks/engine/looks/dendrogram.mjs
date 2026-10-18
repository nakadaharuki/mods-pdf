// @ts-check
// dendrogram（樹形図）: 項目を、使われ方の近さで束ねた木として、左の根から右の葉へ描き、葉ごとの数を右に置く。元の見本は「同じ会話で使われるスキル 20 本の木と、30 日の実行回数」。
// 元は look の designs/dendrogram.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
// 配置は d3-hierarchy の cluster（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。葉は全部 1 列に揃い、separation を 1 にして葉の行を等間隔にする
// （既定は従兄弟の間を 2 倍にして、行がでこぼこになった）。
//
// 決まり（元の頭の文のとおり。数は変えない）: つなぎ（肘の線）は candle の最後の値と同じ墨の 35% で、共有する幹が重なって濃くならないよう 1 本の path にまとめる。
// 目立たせる枝は 1 つだけ（look の橙）で、その枝の葉の合計をラベルに添える。束の名前は、その束の合流点に入る線の上に置く。葉の名前は 8pt、数は右揃えで右端。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる枝は mono で墨 100%（線は元の 90% を ALPHA.heavy に置き換えた）。ほかの葉の丸は墨の 55%。
// - 目立たせる枝は data.highlight（節の名前）。無ければ、「子が全部葉の束」のうち、葉の数の合計がいちばん大きい物（束が無ければ最大の葉）。元の見本の「文書」の束は
//   最大ではなく本人が選んだ物なので、見本の data は highlight を持つ。
// - 元は「SKILL」「RUNS 30D」の見出しを上に置いたが、data に列の名前が無いので置かない。左下に葉の数、右下に合計を置く。数（value）が無い葉は数の列を出さない。
// - 元は束の名前を大文字にした。日本語に大文字は無いので、そのまま置く。名前は、合流点から親の幹までの長さに収まるよう「…」で切る。
// - 葉の数は 60 まで（紙の 1 頁で読める数）。行の間が 9.5pt を切る時は、名前と数を 1 行おきなどに間引く（丸と線は全部描く）。目立たせる枝の葉は先に選ぶが、9.5pt より近い葉は出さない。
// 選ばなかった案
// - 目立たせる枝の葉の名前を、行の間が狭くても全部出す案: 8pt の字が行ごとに重なって読めない（20 行を高さ 200pt に入れると、5 つの名前が団子になった）。
// - 根の名前を左の端に置く案: 幹の線と重なり、読む情報も増えない。根は描かない（元と同じ）。
// - 数の無い葉に 1 を入れて束の合計を出す案: 合計が件数のように見える。数が無ければ合計も出さない。
import { hierarchy, cluster } from '../../vendor/d3.mjs'
import { ALPHA, TICK, LABEL, midline, f, inkFill, fillAttr, seriesColor, inkStroke, hotFill, hotStroke, text, circle, strokePath, svgDoc, empty, num, textWidth, clip, nameOf, toNum, tr, VALUE_MAX, LW } from './paper.mjs'

const MAX_LEAVES = 60
const PAD = 4
const TOP = 12
const BOTTOM = 26
const PITCH = 14
const TEXT_PITCH = 9.5

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number | null, children: TNode[], hot: boolean }} TNode */
/** @typedef {{ root: TNode | null, leaves: number, hasValues: boolean }} DendroData */

/** 葉の数の合計（葉の value が無ければ 0） @param {TNode} n @returns {number} */
function sumOf(n) {
  return n.children.length ? n.children.reduce((s, c) => s + sumOf(c), 0) : (n.value ?? 0)
}
/** @param {TNode} n @returns {number} */
function leafCount(n) {
  return n.children.length ? n.children.reduce((s, c) => s + leafCount(c), 0) : 1
}

/**
 * @param {unknown} data { root: { name, value?, children? }, highlight? }
 * @returns {{ data: DendroData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const rootSrc = src.root && typeof src.root === 'object' ? src.root : null
  if (!rootSrc) warnings.push('樹形図: root（{ name, children } の木）がありません')
  let leaves = 0
  let dropped = 0
  let badValue = 0
  /** @param {any} n @returns {TNode | null} */
  const build = (n) => {
    const name = nameOf(n && typeof n === 'object' ? n.name : undefined) || '–'
    const kids = n && typeof n === 'object' && Array.isArray(n.children) ? n.children : []
    if (kids.length) {
      /** @type {TNode[]} */
      const children = []
      for (const k of kids) {
        const c = k && typeof k === 'object' ? build(k) : null
        if (c) children.push(c)
      }
      return children.length ? { name, value: null, children, hot: false } : null
    }
    if (leaves >= MAX_LEAVES) { dropped++; return null }
    leaves++
    let value = null
    if (n && typeof n === 'object' && n.value !== undefined && n.value !== null) {
      const v = toNum(n.value)
      if (v >= 0 && v <= VALUE_MAX) value = v
      else badValue++
    }
    return { name, value, children: [], hot: false }
  }
  const root = rootSrc ? build(rootSrc) : null
  if (rootSrc && !root) warnings.push('樹形図: root に children（子の節の列）がありません')
  else if (root && !root.children.length) warnings.push('樹形図: root に子の節がありません（木は 2 段以上が要ります）')
  if (dropped) warnings.push(`樹形図: 葉は ${MAX_LEAVES} 個までなので、超えた ${num(dropped)} 個を捨てました`)
  if (badValue) warnings.push(`樹形図: 葉の value が 0 以上 1,000 兆以下の数でない ${badValue} 個は、数なしで描きます`)
  const usable = root && root.children.length ? root : null

  if (usable) {
    /** @type {TNode[]} */
    const all = []
    /** @type {TNode[]} */
    const clusters = []
    /** @type {TNode[]} */
    const leafList = []
    const walk = (/** @type {TNode} */ n, /** @type {boolean} */ top) => {
      if (!top) all.push(n)
      if (n.children.length) {
        if (!top && n.children.every((c) => !c.children.length)) clusters.push(n)
        n.children.forEach((c) => walk(c, false))
      } else leafList.push(n)
    }
    walk(usable, true)
    const want = nameOf(src.highlight)
    /** @type {TNode | undefined} */
    let chosen
    if (want) {
      chosen = all.find((n) => n.name === want)
      if (!chosen) warnings.push(`樹形図: highlight の名前「${want}」が木にありません。いちばん大きい束を目立たせます`)
    }
    if (!chosen) {
      const pool = clusters.length ? clusters : leafList
      let best = 0
      for (const n of pool) {
        const s = sumOf(n)
        if (s > best) { best = s; chosen = n }
      }
    }
    if (chosen) chosen.hot = true
  }
  const leavesKept = usable ? leafCount(usable) : 0
  return { data: { root: usable, leaves: leavesKept, hasValues: usable ? hasValue(usable) : false }, warnings }
}

/** @param {TNode} n @returns {boolean} */
function hasValue(n) {
  return n.children.length ? n.children.some(hasValue) : n.value !== null
}

/**
 * @param {DendroData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.root) return empty(o)
  const showCount = data.hasValues
  /** @type {any} */
  const rootNode = hierarchy(data.root, (/** @type {TNode} */ d) => (d.children.length ? d.children : null))
  /** @type {any[]} */
  const leaves = rootNode.leaves()
  const names = leaves.map((/** @type {any} */ l) => clip(l.data.name, LABEL, W * 0.3))
  const nameW = Math.max(...names.map((/** @type {string} */ s) => textWidth(s, LABEL)))
  const counts = leaves.map((/** @type {any} */ l) => (l.data.value === null ? '' : num(l.data.value, Number.isInteger(l.data.value) ? 0 : 1)))
  const countW = showCount ? Math.max(...counts.map((/** @type {string} */ s) => textWidth(s, TICK))) : 0
  const leafX = Math.max(PAD + 60, W - PAD - (countW ? countW + 10 : 0) - nameW - 8)
  const rootX = PAD
  const bottom = H - BOTTOM
  const pitch = leaves.length > 1 ? (bottom - TOP) / (leaves.length - 1) : bottom - TOP
  // d3 の cluster は x を行（縦）、y を深さ（横）に置く。ここでは y が横の位置になる
  const layoutFn = /** @type {any} */ (cluster())
  layoutFn.size([bottom - TOP, leafX - rootX]).separation(() => 1)(rootNode)
  const px = (/** @type {any} */ n) => rootX + n.y
  const py = (/** @type {any} */ n) => TOP + n.x
  const inHot = (/** @type {any} */ n) => n.ancestors().some((/** @type {any} */ a) => a.data.hot)

  // 各節が、自分の幹（子の縦の幅）と、子へ向かう腕を引く。目立たせる枝は別の path にする
  let ink = ''
  let accent = ''
  for (const n of rootNode.descendants()) {
    if (!n.children) continue
    const ys = n.children.map(py)
    const trunk = `M${f(px(n))} ${f(Math.min(...ys))}V${f(Math.max(...ys))}`
    if (inHot(n)) accent += trunk
    else ink += trunk
    for (const c of n.children) {
      const arm = `M${f(px(n))} ${f(py(c))}H${f(px(c))}`
      if (inHot(c)) accent += arm
      else ink += arm
    }
  }
  /** @type {string[]} */
  const parts = []
  parts.push(strokePath(ink, inkStroke(pal, ALPHA.ref, LW.line)))
  parts.push(strokePath(accent, hotStroke(pal, ALPHA.heavy, LW.line, 1)))

  // 名前と数を出す葉。行の間が足りない時は、目立たせる枝の葉を先に（TEXT_PITCH ずつ離して）選び、残りは step 行おきで、選んだ葉に近すぎない物だけ足す
  const step = pitch >= TEXT_PITCH ? 1 : Math.ceil(TEXT_PITCH / pitch)
  const shown = new Set()
  const apart = (/** @type {number} */ i) => [...shown].every((j) => Math.abs(py(leaves[i]) - py(leaves[j])) >= TEXT_PITCH - 0.01)
  leaves.forEach((/** @type {any} */ leaf, /** @type {number} */ i) => { if (inHot(leaf) && apart(i)) shown.add(i) })
  leaves.forEach((/** @type {any} */ _leaf, /** @type {number} */ i) => { if (i % step === 0 && !shown.has(i) && apart(i)) shown.add(i) })
  leaves.forEach((/** @type {any} */ leaf, /** @type {number} */ i) => {
    const y = py(leaf)
    const isHot = inHot(leaf)
    parts.push(circle(leafX, y, 2, isHot ? hotFill(pal, ALPHA.heavy, 1) : seriesColor(pal, 1) !== null ? fillAttr(/** @type {string} */ (seriesColor(pal, 1)), 0.7) : inkFill(pal, ALPHA.body)))
    if (shown.has(i)) {
      parts.push(text(leafX + 6, midline(y, LABEL), names[i], { size: LABEL, fill: pal.ink }))
      if (showCount && counts[i]) parts.push(text(W - PAD, midline(y, TICK), counts[i], { size: TICK, fill: pal.sub, anchor: 'end' }))
    }
  })

  // 束と枝の名前は、その節に入る線の上に、合流点の 4pt 手前で右揃え。目立たせる束は葉の合計も添える
  for (const n of rootNode.descendants()) {
    if (!n.children || !n.parent) continue
    const isHot = n.data.hot
    const total = sumOf(n.data)
    const label = isHot && total > 0 ? `${n.data.name} ${num(total, Number.isInteger(total) ? 0 : 1)}` : n.data.name
    const room = px(n) - px(n.parent) - 8
    if (room < 18) continue
    parts.push(text(px(n) - 4, py(n) - 4, clip(label, TICK, room), { size: TICK, fill: isHot ? pal.accent : pal.sub, anchor: 'end' }))
  }

  parts.push(text(PAD, H - 4, tr(lang, `${num(data.leaves)} 項目`, `${num(data.leaves)} items`), { size: TICK, fill: pal.sub }))
  if (showCount) parts.push(text(W - PAD, H - 4, `${tr(lang, '合計', 'Total')} ${num(sumOf(data.root), 0)}`, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の木（スキル 20 本・3 つの系統・7 つの束・30 日の実行回数）を、商品の問い合わせ件数の木に直した。「調理」の束が目立たせる枝 */
function sample() {
  /** @param {string} name @param {[string, number][]} leaves */
  const group = (name, leaves) => ({ name, children: leaves.map(([n, value]) => ({ name: n, value })) })
  return {
    root: {
      name: '全カテゴリ',
      children: [
        { name: '家電', children: [group('調理', [['炊飯器', 64], ['オーブン', 41], ['ケトル', 37], ['ミキサー', 22], ['計量器', 18]]), group('映像', [['テレビ', 29], ['録画機', 33], ['投影機', 15]])] },
        { name: '住まい', children: [group('掃除', [['掃除機', 128], ['モップ', 46], ['洗剤', 24]]), group('収納', [['棚', 71], ['箱', 52]]), group('照明', [['電球', 39], ['蛍光灯', 12], ['ランプ', 9]])] },
        { name: '衣類', children: [group('外出', [['上着', 88], ['靴', 31]]), group('部屋着', [['靴下', 17], ['下着', 11]])] },
      ],
    },
    highlight: '調理',
  }
}

export default {
  id: 'dendrogram',
  title: '樹形図（Dendrogram）',
  category: 'flow',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {DendroData} */ data) => Math.max(120, Math.round(TOP + BOTTOM + Math.max(1, (data?.leaves ?? 20) - 1) * PITCH)),
  sample,
}
