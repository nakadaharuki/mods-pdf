// @ts-check
// donut（ドーナツ）: 内訳を環の弧で見せる。弧は 1 つずつの path で、隣とは環の真ん中の円周で測って 2pt の隙間を空ける（曲がっても隙間が一定）。
// 元は look の designs/donut.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 環は 12 時から時計回りに並べ、中央に合計を置き、右の凡例が各項目の割合を持つ。塗りは墨の段と、目立たせる 1 つだけの色。
// 元の墨の段は 90・65・42・22%（candle の組に収める）で、目立たせる 1 つは look の橙。
//
// 紙に写して変えた所
// - 暗い地は塗らない。墨の段は、大きい順に 90% から 18% まで等しく下げる坂（paper の ramp。項目が 4 つなら元の 4 段とほぼ同じ）。項目が増えても段が足りなくなって同じ濃さが並ばない。
// - 目立たせる 1 つは data.highlight（項目の名前）。色のある紙では accent の 90%。mono は accent が墨なので、その 1 つを墨 100% にして、
//   ほかの坂を 60% から始める（90% のままだと最大の項目と見分けられない。見本の頁で確かめた）。名前が無ければ目立たせない。
// - 凡例は名前・値（sub）・割合（太字）の 3 列。元は割合だけだったが、紙の読み手は実数も要る。単位は下の左に「単位: 円」と 1 度だけ書く。
// - 中央の合計は compact（万・億）で、単位を付ける。data.total が数ならそれ、無ければ項目の合計。割合は項目の合計に対する割合（100% になる）。
// - 項目が 12 個を超えたら、小さい順に「その他」の 1 つにまとめる（環の隙間が弧の角度を超えない。合計は変わらない）。
// 選ばなかった案
// - 凡例を幅いっぱい（右端）まで広げる案: 版面の幅 503pt では名前と割合が 200pt 離れて、行を目で追えない。環と凡例を 1 組にして真ん中に置く。
// - 弧の上に割合の字を置く案: 小さい弧に入らず、墨の濃い弧の上に紙の色の字は置けない（字は pal の ink・sub だけ）。凡例に持つ。
// - 単位を凡例の各行に付ける案: 行が長くなり、狭い幅で名前が切れる。単位は下の左に 1 度。
import { TICK, LABEL, VALUE, BIG, inkFill, hotFill, isMono, text, rect, fillPath, svgDoc, empty, num, percent, compact, withUnit, textWidth, clip, tr, toNum, nameOf, midline, decimals, unitNote, ramp, ringPath, VALUE_MAX } from './paper.mjs'
import { readItems, labelOf } from './parts-kit.mjs'

/** 環に描く項目の数の上限。超えた分は「その他」にまとめる */
const MAX_ROWS = 12
/** 下の注記の高さ */
const FOOT = 18
/** 弧どうしの隙間（pt）。環の真ん中の円周で測る */
const GAP = 2

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean }} Row */
/** @typedef {{ rows: Row[], unit: string, hot: number, total: number }} DonutData */

/**
 * @param {unknown} data { items: { name, value }[], unit?, total?, highlight? }
 * @returns {{ data: DonutData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const { rows: all, unit } = readItems(src, 'ドーナツ', warnings)
  let rows = all
  if (rows.length > MAX_ROWS) {
    const big = new Set(rows.map((_, i) => i).sort((a, b) => rows[b].value - rows[a].value || a - b).slice(0, MAX_ROWS - 1))
    const rest = rows.filter((_, i) => !big.has(i))
    rows = [...rows.filter((_, i) => big.has(i)), { name: '', value: rest.reduce((s, r) => s + r.value, 0), other: true }]
    warnings.push(`ドーナツ: 項目が ${MAX_ROWS} 個を超えるので、小さい ${rest.length} 個を「その他」にまとめました`)
  }
  const want = nameOf(src.highlight)
  const hot = want ? rows.findIndex((r) => !r.other && r.name === want) : -1
  if (want && hot < 0) warnings.push(`ドーナツ: highlight「${want}」の名前の項目がありません`)
  const total = toNum(src.total)
  return { data: { rows, unit, hot, total: total > 0 && total <= VALUE_MAX ? total : 0 }, warnings }
}

/**
 * @param {DonutData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  const sum = rows.reduce((s, r) => s + r.value, 0)
  const digits = decimals(rows.map((r) => r.value))

  // 環は左・凡例は右。環の大きさは、高さ（上下の余白と注記を引いた分）と幅の 3 割の小さい方（元は高さの 38%）
  const top = 8
  const bottom = H - FOOT
  const rOut = Math.max(24, Math.min((bottom - top) / 2 - 1, H * 0.42, W * 0.3))
  const rIn = rOut * 0.74
  const cy = (top + bottom) / 2
  // 環と凡例を 1 組にして、幅の真ん中に置く（凡例の幅は 200pt まで。名前と割合が離れすぎない）
  const ring = Math.max(24, W * 0.07)
  const lw = Math.min(200, W - 16 - 2 * rOut - ring)
  const x0 = Math.max(8, (W - (2 * rOut + ring + lw)) / 2)
  const cx = x0 + rOut
  const lx = cx + rOut + ring
  const rx = lx + lw

  /** @type {string[]} */
  const parts = []
  // 墨の段: 目立たせる項目を除いて、大きい順に濃い方から。mono で目立たせる項目があれば 60% から
  const hot = data.hot
  const order = rows.map((_, i) => i).filter((i) => i !== hot).sort((a, b) => rows[b].value - rows[a].value || a - b)
  const steps = ramp(order.length, hot >= 0 && isMono(pal) ? 0.6 : 0.9, 0.18)
  /** @type {Map<number, number>} */
  const alpha = new Map(order.map((i, k) => [i, steps[k]]))
  /** @param {number} i */
  const fillOf = (i) => (i === hot ? hotFill(pal, 0.9, 1) : inkFill(pal, alpha.get(i)))

  let a = -Math.PI / 2
  rows.forEach((r, i) => {
    const a1 = a + (r.value / sum) * Math.PI * 2
    parts.push(fillPath(ringPath(cx, cy, rIn, rOut, a, a1, GAP), `${fillOf(i)}${n === 1 ? ' fill-rule="evenodd"' : ''}`))
    a = a1
  })

  const totalValue = data.total || sum
  const big = withUnit(compact(totalValue, lang), data.unit)
  parts.push(text(cx, cy - 1, clip(big, BIG, rIn * 2 - 14), { size: BIG, fill: pal.ink, anchor: 'middle' }))
  parts.push(text(cx, cy + 12, tr(lang, '合計', 'Total'), { size: TICK, fill: pal.sub, anchor: 'middle' }))

  // 右の凡例: 見出しの札（弧と同じ塗り）・名前・値（sub）・割合（太字）
  const pct = rows.map((r) => percent(r.value / sum))
  const vals = rows.map((r) => num(r.value, digits))
  const pctW = Math.max(...pct.map((s) => textWidth(s, VALUE, true)))
  const valW = Math.max(...vals.map((s) => textWidth(s, TICK)))
  const nameX = lx + 14
  const withVal = rx - nameX - pctW - valW - 24 >= 40
  const nameMax = Math.max(8, rx - nameX - pctW - 10 - (withVal ? valW + 10 : 0))
  const row = Math.min(22, (bottom - top - 8) / n)
  const y0 = cy - ((n - 1) * row) / 2
  rows.forEach((r, i) => {
    const y = y0 + i * row
    parts.push(rect(lx, y - 3.5, 7, 7, fillOf(i)))
    parts.push(text(nameX, midline(y, LABEL), clip(labelOf(r, lang), LABEL, nameMax), { size: LABEL, fill: pal.ink, bold: i === hot }))
    if (withVal) parts.push(text(rx - pctW - 10, midline(y, TICK), vals[i], { size: TICK, fill: pal.sub, anchor: 'end' }))
    parts.push(text(rx, midline(y, VALUE), pct[i], { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  })

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（資産配分 34・21・19・16・10%、合計 2.48M）を、円の資産配分に直した。目立たせる 1 つは元の「Alt」の位置 */
function sample() {
  return {
    items: [
      { name: '国内株式', value: 843200 },
      { name: '外国株式', value: 520800 },
      { name: '債券', value: 471200 },
      { name: '現金', value: 396800 },
      { name: '不動産', value: 248000 },
    ],
    unit: '円',
    highlight: '不動産',
  }
}

export default {
  id: 'donut',
  title: 'ドーナツ（Donut）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.52),
  sample,
}
