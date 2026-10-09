// @ts-check
// spread の束（box-plot・contour・hexbin・histogram・ridgeline・scatter・violin）の 7 つが同じにする小さな部品:
// 値の読み取り（群と数）・分位数と帯域幅・見本の乱数。軸の字と棒・空いた所へのラベルの置き方・計算した値の桁は、ほかの束も使うので paper.mjs に上げた（axisLeft・axisBottom・tickSet・freeSpot・fitText・statDigits）。
// 元は look の designs/ の 7 つ（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）が、
// 同じ書き出し（分位数・Box-Muller・目盛りの棒）をそれぞれに持っていた物の、共通の部分。形のファイルが、この束の外では使わない物をここに置かない。
// 分位数は d3-array の quantileSorted（ISC・Mike Bostock。出典は hooks/vendor/d3.mjs と LICENSES/）。
//
// 選ばなかった案
// - 分布の部品（分位数・帯域幅）を paper.mjs に足す案: paper は d3 を読まない（candle などは d3 を読まずに済む）。分位数は d3 を呼ぶので、ここに残す。
// - 分位数を各ファイルに手で書く案: look は「d3-array の quantile の規則を手で書いた」と頭の文に書いていた。紙では d3 が使えるので、同じ規則をそのまま呼ぶ。
// - 群が 1 つの形（histogram）の群の選び方を、全部の群をつないで 1 つにする案: 群の名前が消え、読み手が混ぜた事に気づけない。先頭の群だけ描いて warnings に書く。
import { quantileSorted } from '../../vendor/d3.mjs'
import { VALUE_MAX, num, toNum, arr, nameOf, niceExtent } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ name: string, values: number[] }} Group */
/** @typedef {{ x: number, y: number, size: number, g: number, name: string }} Pt size は 3 つ目の値（無ければ NaN）・g は群の番号（群が無ければ 0）・name は点の名前（無ければ ''） */

// ---------------------------------------------------------------- 値の読み取り

/**
 * 数の列を読む。数でない値と、絶対値が VALUE_MAX を超える値は捨て、数を tally に足す（呼ぶ側が最後に 1 回だけ warnings にする）
 * @param {unknown} list @param {{ bad: number, huge: number }} tally
 * @returns {number[]}
 */
export function readNums(list, tally) {
  /** @type {number[]} */
  const out = []
  for (const v of arr(list)) {
    const n = toNum(v)
    if (Number.isNaN(n)) tally.bad++
    else if (Math.abs(n) > VALUE_MAX) tally.huge++
    else out.push(n)
  }
  return out
}

/**
 * tally の中身を warnings に書く
 * @param {{ bad: number, huge: number }} tally @param {string[]} warnings @param {string} what 「箱ひげ図」のような形の名前
 */
export function tallyWarnings(tally, warnings, what) {
  if (tally.bad) warnings.push(`${what}: 数でない値 ${num(tally.bad)} 個を捨てました`)
  if (tally.huge) warnings.push(`${what}: 絶対値が 1,000 兆を超える値 ${num(tally.huge)} 個を捨てました`)
}

/**
 * 分布の形（box-plot・violin・ridgeline・histogram）の data { groups: { name, values }[] } を読む。値が min 個に満たない群は捨てる
 * @param {any} src @param {string[]} warnings @param {string} what @param {number} min 群が持つべき値の数の下限
 * @returns {Group[]}
 */
export function readGroups(src, warnings, what, min) {
  if (!Array.isArray(src.groups)) warnings.push(`${what}: groups（{ name, values } の列）がありません`)
  const tally = { bad: 0, huge: 0 }
  /** @type {Group[]} */
  const out = []
  let thin = 0
  arr(src.groups).forEach((g, i) => {
    const o = g && typeof g === 'object' ? g : {}
    const values = readNums(o.values, tally)
    if (values.length < min) { thin++; return }
    out.push({ name: nameOf(o.name) || `${i + 1}`, values })
  })
  tallyWarnings(tally, warnings, what)
  if (thin) warnings.push(`${what}: 値が ${num(min)} 個に満たない群 ${num(thin)} 個を捨てました`)
  if (Array.isArray(src.groups) && !out.length && !thin) warnings.push(`${what}: groups が空です`)
  return out
}

/** 数の列を小さい順に並べた写し @param {number[]} values */
export function sorted(values) {
  return values.slice().sort((a, b) => a - b)
}

/** 小さい順の列の p 分位（0〜1）。隣り合う 2 つの間は直線でつなぐ（d3-array の quantileSorted と同じ規則） @param {number[]} s @param {number} p */
export function quantile(s, p) {
  return quantileSorted(s, p) ?? NaN
}

/** 平均 @param {number[]} s */
export function mean(s) {
  let t = 0
  for (const v of s) t += v
  return t / s.length
}

/** 標本の標準偏差（n - 1 で割る）。2 個未満は 0 @param {number[]} s */
export function deviation(s) {
  if (s.length < 2) return 0
  const m = mean(s)
  let t = 0
  for (const v of s) t += (v - m) ** 2
  return Math.sqrt(t / (s.length - 1))
}

/**
 * ガウス核の帯域幅の目安（Silverman: 0.9 × min(標準偏差, 四分位範囲 / 1.34) × n の -1/5 乗）。小さい順の列を受ける。
 * 四分位範囲が 0（同じ値が半分を超える）なら標準偏差だけ。2 個未満・全部同じ値なら 0
 * @param {number[]} s
 */
export function silverman(s) {
  if (s.length < 2) return 0
  const sd = deviation(s)
  const iqr = quantile(s, 0.75) - quantile(s, 0.25)
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd
  return 0.9 * spread * s.length ** -0.2
}

/**
 * 値の範囲の下の端。0 以上の値で、最小が最大の 35% 以下なら 0 から始める（待ち時間・件数は 0 が基準）。ほかは最小のまま（温度・日付は 0 を含めない）
 * @param {number} lo @param {number} hi
 */
export function baseZero(lo, hi) {
  return lo >= 0 && lo <= hi * 0.35 ? 0 : lo
}

/**
 * 点の形（scatter・hexbin・contour）の data を読む。points は [x, y] か [x, y, 大きさ] の列。groups は点ごとの群の名前（points と同じ長さ）、names は点ごとの名前（points と同じ長さ）。
 * 数でない行・上限を超える値の行は捨て、群は先に出た順に maxGroups 個まで（4 つ目からの群の点は捨てる）。groups が points と長さが違う時は、群を使わない
 * @param {any} src @param {string[]} warnings @param {string} what @param {number} maxGroups
 * @returns {{ pts: Pt[], groups: string[], xLabel: string, yLabel: string, sizeLabel: string }}
 */
export function readPoints(src, warnings, what, maxGroups) {
  if (!Array.isArray(src.points)) warnings.push(`${what}: points（[x, y] の列）がありません`)
  const rows = arr(src.points)
  let groupList = Array.isArray(src.groups) ? src.groups : null
  if (groupList && groupList.length !== rows.length) {
    warnings.push(`${what}: groups の数（${num(groupList.length)}）が points の数（${num(rows.length)}）と違うので、群は使いません`)
    groupList = null
  }
  const names = Array.isArray(src.names) ? src.names : []
  /** @type {string[]} */
  const groups = []
  /** @type {Pt[]} */
  const pts = []
  let bad = 0
  let huge = 0
  let extra = 0
  rows.forEach((p, i) => {
    if (!Array.isArray(p) || p.length < 2) { bad++; return }
    const x = toNum(p[0])
    const y = toNum(p[1])
    if (Number.isNaN(x) || Number.isNaN(y)) { bad++; return }
    if (Math.abs(x) > VALUE_MAX || Math.abs(y) > VALUE_MAX) { huge++; return }
    let g = 0
    if (groupList) {
      const name = nameOf(groupList[i])
      g = groups.indexOf(name)
      if (g < 0) {
        if (groups.length >= maxGroups) { extra++; return }
        g = groups.push(name) - 1
      }
    }
    const size = p.length > 2 ? toNum(p[2]) : NaN
    pts.push({ x, y, size: size >= 0 && size <= VALUE_MAX ? size : NaN, g, name: nameOf(names[i]) })
  })
  if (bad) warnings.push(`${what}: [x, y] の数でない点 ${num(bad)} 個を捨てました`)
  if (huge) warnings.push(`${what}: 絶対値が 1,000 兆を超える点 ${num(huge)} 個を捨てました`)
  if (extra) warnings.push(`${what}: 群は ${num(maxGroups)} つまでなので、それより後に出る群の点 ${num(extra)} 個を捨てました`)
  if (Array.isArray(src.points) && !pts.length && !bad && !huge && !extra) warnings.push(`${what}: points が空です`)
  const label = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : '')
  return { pts, groups, xLabel: label(src.xLabel), yLabel: label(src.yLabel), sizeLabel: label(src.sizeLabel) }
}

/**
 * 点の x・y の範囲を、目盛りの間隔に揃えた範囲にする。0 以上で最小が最大の 35% 以下なら 0 から。上は room（範囲の何割）の余白をとってから切りのよい所へ
 * @param {number} lo @param {number} hi @param {number} room
 * @returns {[number, number]}
 */
export function extentOf(lo, hi, room) {
  const base = baseZero(lo, hi)
  return niceExtent(base, hi + (hi - base) * room, 5)
}

/** 点の列から、x・y それぞれの最小と最大（Math.min(...) に 5,000 個を渡さない） @param {Pt[]} pts */
export function boundsOf(pts) {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return { x0, x1, y0, y1 }
}

// ---------------------------------------------------------------- 見本の乱数

/**
 * 標準正規分布の乱数（Box and Muller, 1958）。rnd は 0 以上 1 未満の乱数。1 - rnd() は (0, 1] なので log が有限になる。
 * 乱数を使う順番は look の見本と同じ（log の側が先）なので、同じ種なら look の絵と同じ数が出る
 * @param {() => number} rnd
 * @returns {() => number}
 */
export function normalOf(rnd) {
  return () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
}

/** 見本の数を JSON の小さな字にするための丸め（d 桁） @param {number} v @param {number} d */
export function round(v, d) {
  const k = 10 ** d
  return Math.round(v * k) / k
}
