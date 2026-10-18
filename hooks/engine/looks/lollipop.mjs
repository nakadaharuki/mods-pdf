// @ts-check
// lollipop（棒付きの丸）: 上位の項目を、共通の 0 の端から伸びる 1 本の細い棒と丸で並べ、値を右の余白に置く。元の見本は「7 日間のトークン量の上位 10 リポジトリ」。
// 元は look の designs/lollipop.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 多い順に並べる。棒は candle の最後の値の線と同じ重さ（墨の 35%・1pt）で、共通の 0 の端から丸まで。
// 長さは棒グラフと同じに読めるが、棒グラフの重さは持たない。値は右揃えで右の余白に置く。目盛りの端は、最大の値を少し超える切りのよい値
// （元は 2.41 に対して 2.5）。目立たせるのは先頭の 1 つだけ（look の Claude の橙。data.highlight で名前を指定もできる）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。ほかの丸は墨の 55%（元は 90%。mono では目立たせる丸が墨 100% になるので、100% と見分けがつく 55% に下げた。candle の本体と同じ段）。
//   目立たせる棒は元の 60% を ALPHA.strong（65%）に、丸は 90% を ALPHA.heavy（85%）に置き換えた。mono は両方 100%。
// - 字は pt。順位は目盛りの 7.5pt の sub、名前は 8pt、値は 8pt の太字（元の 11px）。元の等幅（順位）は紙では sans（数字は全部同じ幅なので桁が揃う）。
// - 元は上に列の見出し「REPO」「TOKENS, 7 DAYS」を置いたが、data に列の名前が無いので置かない。下の左に単位（長い単位だけ。2 字までは値に付ける）、右に合計を置く。
//   合計は、単位が % の時と、負の値がある時は置かない（足しても意味が無い）。
// - 行の間は、高さが決まっていれば高さから割る。10.5pt を切る時は、名前と値を 1 行おきなどに間引く（丸と棒は全部描く）。
// 選ばなかった案
// - 行を 30 より多く描く案: 紙の 1 頁に収まらず、順位の下の方は誰も読まない。上位 30 だけ描いて warnings に書く。
// - 負の値の棒を右へ折り返す案: 長さの比べ方が変わる。0 の端から左へ伸ばす。
import { ALPHA, TICK, LABEL, VALUE, midline, inkFill, inkStroke, hotFill, hotStroke, text, line, circle, svgDoc, empty, num, withUnit, textWidth, clip, gutter, niceExtent, linear, keep, nameOf, toNum, arr, tr, VALUE_MAX, decimals, unitNote, LW } from './paper.mjs'

const MAX_ROWS = 30
const PAD = 4
const TOP = 8
const BOTTOM = 26
const ROW = 19
const ROW_MAX = 22
const DOT = 3
/** 名前と値の 8pt の字が重ならない行の間の下限 */
const TEXT_PITCH = 10.5

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number }} Row */
/** @typedef {{ rows: Row[], unit: string, hot: number, hots?: number[] }} LollipopData */

/**
 * @param {unknown} data { items: { name, value }[], unit?, highlight? }
 * @returns {{ data: LollipopData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('棒付きの丸: items（{ name, value } の列）がありません')
  /** @type {Row[]} */
  let rows = []
  let broken = 0
  for (const it of arr(src.items)) {
    const name = nameOf(it && typeof it === 'object' ? it.name : undefined)
    const value = toNum(it && typeof it === 'object' ? it.value : undefined)
    if (!name || !(Math.abs(value) <= VALUE_MAX)) { broken++; continue }
    rows.push({ name, value })
  }
  if (broken) warnings.push(`棒付きの丸: 名前が無いか、値が ±1,000 兆の中の数でない行 ${broken} 個を捨てました`)
  rows.sort((a, b) => b.value - a.value)
  rows = keep(rows, MAX_ROWS, warnings, '棒付きの丸: 行')
  // highlight は名前 1 つか、名前の列（文の中で名指しした銘柄を全部目立たせる）
  const wants = Array.isArray(src.highlight) ? src.highlight.map(nameOf).filter(Boolean) : []
  const want = Array.isArray(src.highlight) ? wants[0] : nameOf(src.highlight)
  let hot = rows.length ? 0 : -1
  if (wants.length > 1) {
    const hots = wants.map((w) => rows.findIndex((r) => r.name === w)).filter((at) => at >= 0)
    if (hots.length) return { data: { rows, unit: typeof src.unit === 'string' ? src.unit : '', hot: hots[0], hots }, warnings }
  }
  if (want) {
    const at = rows.findIndex((r) => r.name === want)
    if (at >= 0) hot = at
    else warnings.push(`棒付きの丸: highlight の名前「${want}」が items にありません。いちばん多い行を目立たせます`)
  }
  return { data: { rows, unit: typeof src.unit === 'string' ? src.unit : '', hot }, warnings }
}

/**
 * @param {LollipopData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  const unit = data.unit
  const inline = unit.length > 0 && unit.length <= 2
  const d = decimals(rows.map((r) => r.value))
  const fmt = (/** @type {number} */ v) => (inline ? withUnit(num(v, d), unit) : num(v, d))

  const rankW = textWidth(String(n), TICK)
  const rankX = PAD + rankW
  const nameX = rankX + 6
  const names = rows.map((r) => clip(r.name, LABEL, W * 0.3))
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL)))
  const x0Edge = nameX + nameW + 10
  const padR = gutter(rows.map((r) => fmt(r.value)), { size: VALUE, bold: true, min: 36 })
  const x1Edge = Math.max(x0Edge + 40, W - PAD - padR)
  const vals = rows.map((r) => r.value)
  const [lo, hi] = niceExtent(Math.min(0, ...vals), Math.max(0, ...vals))
  const sx = linear(lo, hi, x0Edge, x1Edge)
  const zero = sx(0)

  const pitch = Math.min(ROW_MAX, (H - TOP - BOTTOM) / n)
  const r = Math.max(1.5, Math.min(DOT, pitch * 0.35))
  const step = pitch >= TEXT_PITCH ? 1 : Math.ceil(TEXT_PITCH / pitch)

  /** @type {string[]} */
  const parts = []
  rows.forEach((row, i) => {
    const cy = TOP + pitch * (i + 0.5)
    const hot = data.hots ? data.hots.includes(i) : i === data.hot
    const cx = sx(row.value)
    const dir = cx >= zero ? 1 : -1
    if (Math.abs(cx - zero) > r) parts.push(line(zero, cy, cx - dir * r, cy, hot ? hotStroke(pal, ALPHA.strong, LW.line, 1) : inkStroke(pal, ALPHA.ref, LW.line)))
    parts.push(circle(cx, cy, r, hot ? hotFill(pal, ALPHA.heavy, 1) : inkFill(pal, ALPHA.body)))
    if (i % step === 0 || hot) {
      parts.push(text(rankX, midline(cy, TICK), String(i + 1), { size: TICK, fill: pal.sub, anchor: 'end' }))
      parts.push(text(nameX, midline(cy, LABEL), names[i], { size: LABEL, fill: pal.ink }))
      parts.push(text(W - PAD, midline(cy, VALUE), fmt(row.value), { size: VALUE, fill: hot ? pal.accent : pal.ink, anchor: 'end', bold: true }))
    }
  })

  if (!inline && unit) parts.push(text(PAD, H - 4, unitNote(unit, lang), { size: TICK, fill: pal.sub }))
  if (unit !== '%' && vals.every((v) => v >= 0)) parts.push(text(W - PAD, H - 4, `${tr(lang, '合計', 'Total')} ${fmt(vals.reduce((s, v) => s + v, 0))}`, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 10 件（単位は百万トークン）を、支店ごとの売上（億円）の話に直した */
function sample() {
  const items = [['東京', 2.41], ['大阪', 1.86], ['名古屋', 1.52], ['福岡', 1.17], ['札幌', 0.94], ['仙台', 0.71], ['広島', 0.58], ['京都', 0.42], ['神戸', 0.27], ['新潟', 0.15]]
  return { items: items.map(([name, value]) => ({ name, value })), unit: '億円' }
}

export default {
  id: 'lollipop',
  title: '棒付きの丸（Lollipop）',
  category: 'compare',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {LollipopData} */ data) => Math.max(100, Math.round(TOP + BOTTOM + Math.min(MAX_ROWS, data?.rows?.length ?? 8) * ROW)),
  sample,
}
