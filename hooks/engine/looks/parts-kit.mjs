// @ts-check
// parts の束（donut・treemap・circle-pack・funnel・icicle・polar-area・sunburst・waterfall）が同じにする物: items と木（root）の data の読み方・環と扇の形・墨の段の坂。
// 純な部品（Mods の決まりは docs/design.md の 2 章）。形のファイルだけが読み、束の外には出さない。
// 元は look の designs/ の parts の 8 つ（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）が、それぞれに持っていた data の読み方の、共通の部分。
// 環の一片（ringPath）・墨の坂（ramp）・値の桁（decimals）・単位の注記（unitNote）は、ほかの束も同じにするので paper.mjs に上げた。
// readItems と normalizeTree は parts の data の形（docs/looks.md の 3 章）だけを読むので、ここに残す。
//
// 選ばなかった案
// - 木の data を d3 の hierarchy にそのまま渡す案: 値が 1e308 の葉が並ぶと合計が無限になり、座標が NaN になる。葉の値は 1,000 兆までにして、読めない葉は数えて warnings に書く。
// - 子が多い節を、描ける数まで先頭から捨てる案: 合計が data と合わなくなる。小さい順に「その他」の 1 つにまとめる（合計は変わらない）。
// - 名前の無い節に、ここで「その他」「無題」と書く案: lang を知らない。名前は空のまま持ち、other の印で、描く側が lang の字にする。
import { VALUE_MAX, decimals, nameOf, arr, toNum, tr } from './paper.mjs'

/** 1 つの節の子の数の上限。超えた分は小さい順に「その他」の 1 つにまとめる */
export const KIDS_MAX = 24

/** @typedef {{ name: string, value: number, other?: boolean, total?: boolean }} Row */
/** @typedef {{ name: string, value: number, delta?: number, other?: boolean, children?: TreeNode[] }} TreeNode */

/**
 * items（{ name, value }[]）を読む。signed が false なら値は 0 より大きく VALUE_MAX 以下だけ、true なら絶対値が VALUE_MAX 以下の数（0 と負を含む）。
 * zero が true なら 0 も読む（負は捨てる）。並びが軸になる形（月ごとの鶏頭図）では、0 の月も枠を持つので、捨てると後の月が前へずれる。
 * 読めない行は捨てて、数を warnings に書く。unit は字だけ
 * @param {any} src data @param {string} what 「ドーナツ」のような名前 @param {string[]} warnings @param {{ signed?: boolean, zero?: boolean }} [o]
 * @returns {{ rows: Row[], unit: string }}
 */
export function readItems(src, what, warnings, { signed = false, zero = false } = {}) {
  if (!Array.isArray(src.items)) warnings.push(`${what}: items（{ name, value } の列）がありません`)
  /** @type {Row[]} */
  const rows = []
  let bad = 0
  for (const it of arr(src.items)) {
    const v = it && typeof it === 'object' ? toNum(it.value) : NaN
    const ok = Number.isFinite(v) && Math.abs(v) <= VALUE_MAX && (signed || v > 0 || (zero && v === 0))
    if (!ok) { bad++; continue }
    rows.push({ name: nameOf(it.name), value: v, ...(it.total === true ? { total: true } : {}) })
  }
  if (bad) warnings.push(`${what}: value が${signed ? '' : zero ? ' 0 以上の' : ' 0 より大きい'}数（1,000 兆以下）でない項目 ${bad} 個を捨てました`)
  if (!rows.length && !bad && Array.isArray(src.items)) warnings.push(`${what}: items が空です`)
  return { rows, unit: typeof src.unit === 'string' ? src.unit : '' }
}

/**
 * 名前の字。空なら lang の字（other は「その他」）
 * @param {{ name: string, other?: boolean }} r @param {'ja'|'en'} lang
 */
export function labelOf(r, lang) {
  return r.other ? tr(lang, 'その他', 'Other') : r.name || tr(lang, '（無題）', '(untitled)')
}

// ---------------------------------------------------------------- 木

/**
 * root（{ name, value?, children?, delta? }）を、描ける木にする。葉の値は 0 より大きく VALUE_MAX 以下だけ（読めない葉は捨てて数を warnings に書く）。
 * 節の値は子の合計（子が全部読めない節は、自分の value を持つ葉になる）。子は値の大きい順。1 つの節の子が KIDS_MAX を超えたら、小さい順に「その他」の 1 つにまとめる。
 * maxDepth（root の下の階層）より深い所は、その階層の葉にまとめる（値は合計のまま）。読める葉が 1 つも無ければ null
 * @param {any} src data（root を持つ） @param {string} what 「ツリーマップ」のような名前 @param {string[]} warnings @param {{ maxDepth?: number }} [o]
 * @returns {TreeNode | null}
 */
export function normalizeTree(src, what, warnings, { maxDepth = 20 } = {}) {
  const raw = src.root
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${what}: root（{ name, value?, children? }）がありません`)
    return null
  }
  let dropped = 0
  let merged = 0
  let collapsed = false
  /** @param {any} r @param {number} depth @returns {TreeNode | null} */
  const build = (r, depth) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { dropped++; return null }
    const name = nameOf(r.name)
    const kidsRaw = Array.isArray(r.children) ? r.children : []
    if (kidsRaw.length) {
      /** @type {TreeNode[]} */
      const kids = []
      for (const k of kidsRaw) {
        const node = build(k, depth + 1)
        if (node) kids.push(node)
      }
      if (kids.length) {
        kids.sort((a, b) => b.value - a.value)
        const value = kids.reduce((s, k) => s + k.value, 0)
        if (depth >= maxDepth) { collapsed = true; return { name, value } }
        if (kids.length > KIDS_MAX) {
          const rest = kids.splice(KIDS_MAX - 1)
          merged += rest.length
          kids.push({ name: '', value: rest.reduce((s, k) => s + k.value, 0), other: true })
        }
        return { name, value, children: kids }
      }
      return null
    }
    const v = toNum(r.value)
    if (!(v > 0 && v <= VALUE_MAX)) { dropped++; return null }
    const d = toNum(r.delta)
    return { name, value: v, ...(Number.isFinite(d) ? { delta: d } : {}) }
  }
  let root = build(raw, 0)
  if (dropped) warnings.push(`${what}: value が 0 より大きい数（1,000 兆以下）でない葉 ${dropped} 個を捨てました`)
  if (merged) warnings.push(`${what}: 1 つの節の子が ${KIDS_MAX} 個を超えるので、小さい ${merged} 個を「その他」にまとめました`)
  if (collapsed) warnings.push(`${what}: ${maxDepth} 階層より深い所は、${maxDepth} 階層目の 1 つにまとめました`)
  if (!root) {
    if (!dropped) warnings.push(`${what}: 値のある葉がありません`)
    return null
  }
  // root が葉だけなら、その 1 つを子に持つ木にする
  if (!root.children) root = { name: '', value: root.value, children: [root] }
  return root
}

/**
 * d3 の hierarchy で木を作り、葉の値を足し上げて大きい順に並べる（「その他」は、大きくても最後。右の一覧など、data の並びで書く所と環・升の並びをそろえる）。d3 の束には型が無く、推論が壊れる（引数の型が全部 any になる）ので、読み込んだ関数を any として呼ぶ。
 * d3 は渡した物を書き換えるので、draw のたびに作り直す（同じ入力で同じ絵になる）
 * @param {unknown} hierarchy d3 の hierarchy @param {TreeNode} root @returns {any}
 */
export function valueTree(hierarchy, root) {
  return /** @type {any} */ (hierarchy)(root).sum((/** @type {TreeNode} */ d) => (d.children ? 0 : d.value)).sort((/** @type {any} */ a, /** @type {any} */ b) => Number(!!a.data.other) - Number(!!b.data.other) || b.value - a.value)
}

/** 葉の列（上から順） @param {TreeNode} root @returns {TreeNode[]} */
export function leavesOf(root) {
  /** @type {TreeNode[]} */
  const out = []
  const walk = (/** @type {TreeNode} */ n) => {
    if (n.children) n.children.forEach(walk)
    else out.push(n)
  }
  walk(root)
  return out
}

/** root の下の階層の数（root の子が葉なら 1） @param {TreeNode} root */
export function depthOf(root) {
  /** @type {(n: TreeNode) => number} */
  const walk = (n) => (n.children ? 1 + Math.max(...n.children.map(walk)) : 0)
  return walk(root)
}

/**
 * 目立たせる節。名前を渡すと、深さ優先でその名前の最初の節（root を除く）。無い・渡さなければ最大の葉（同じ値なら先に出る方。まとめた「その他」は目立たせる意味がないので、ほかに葉があれば選ばない）。節が無ければ null
 * @param {TreeNode} root @param {string} [name] @returns {TreeNode | null}
 */
export function pickHot(root, name = '') {
  if (name) {
    /** @type {TreeNode | null} */
    let found = null
    const walk = (/** @type {TreeNode} */ n) => {
      for (const c of n.children ?? []) {
        if (found) return
        if (!c.other && c.name === name) { found = c; return }
        walk(c)
      }
    }
    walk(root)
    if (found) return found
  }
  /** @type {TreeNode | null} */
  let best = null
  for (const l of leavesOf(root)) if (!l.other && (!best || l.value > best.value)) best = l
  return best ?? leavesOf(root)[0] ?? null
}

/**
 * 値の字（整数なら 0 桁）。木の値は全部同じ桁で書く
 * @param {TreeNode} root
 */
export function treeDigits(root) {
  return decimals(leavesOf(root).map((l) => l.value))
}

