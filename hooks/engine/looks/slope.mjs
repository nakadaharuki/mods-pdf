// @ts-check
// slope（傾き図）: 項目ごとに「前」と「後」の 2 つの値を、2 本の縦の列の間の 1 本の線で結ぶ。元の見本は「8 リポジトリのキャッシュ命中率の先週と今週」。
// 元は look の designs/slope.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 全部の項目が 1 つの尺度を共有する。線は candle のヒゲと同じ 80% の重さで、2 つの r=2 の丸の間に引く。
// 上がったら上げの色・下がったら下げの色（数を読む前に向きが分かる）。同じ値は墨。両側の列に名前と値を置く。値が 11px より近い 2 つの字は、平均の
// 位置を中心に押し分ける（元は「群で平均を中心に」）。動かした字は、35% の細い線で丸とつなぐ。上がった件数と下がった件数は行から数える。
//
// 紙に写して変えた所
// - 暗い地は塗らない。上げ・下げの色は pal.up・pal.down（緑と赤）。同じ値の線は墨の 80%。
// - 字は pt。名前は 8pt の ink・値は 8pt の太字（元の 10px・11px）。後の値は線と同じ色（pal.up・pal.down）の太字。列の見出しは 7.5pt の sub。
// - 押し分けは paper の dodge（上から順に下へ押し、下から押し戻す）に任せた。元の「群の平均を中心に」は、群の字が 1 方向に偏らない代わりに、
//   群の端の字が元の位置から遠くなる。紙の字は 8pt で押す幅が小さいので、動いた字は 2pt を超えたら細い線で丸とつなぐ（元と同じ）。
// - 元は下に「SAMPLE ...」を置いたが、紙では置かない。左下に長い単位だけ（2 字までは値に付ける）、右下に上がった件数・下がった件数を置く。
// - 前の列と後の列の間隔は幅の 38%（上限）。元の 380px の欄は 37% だった。紙は幅が広いので、同じ割合にしないと線が寝て傾きが読めない。
// 選ばなかった案
// - 24 件より多い項目を描く案: 押し分けた字が尺度の外へ溢れ、字の位置と丸が合わなくなる。上の 24 件だけ描いて warnings に書く（先頭から数える）。
// - 動かした字を丸の高さに戻す案: 重なって読めない。動かして細い線でつなぐ。
import { ALPHA, TICK, LABEL, VALUE, midline, inkStroke, fillAttr, strokeAttr, text, line, circle, svgDoc, empty, num, withUnit, textWidth, clip, dodge, linear, keep, nameOf, toNum, arr, tr, VALUE_MAX, decimals, unitNote, LW } from './paper.mjs'

const MAX_ROWS = 24
const PAD = 4
const R = 2
/** 2 つの字の基線の間の下限（8pt の字が重ならない） */
const GAP = 10
const TOP = 30
const BOTTOM = 26

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, from: number, to: number }} Row */
/** @typedef {{ rows: Row[], fromLabel: string, toLabel: string, unit: string }} SlopeData */

/**
 * @param {unknown} data { items: { name, from, to }[], fromLabel, toLabel, unit? }
 * @returns {{ data: SlopeData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('傾き図: items（{ name, from, to } の列）がありません')
  /** @type {Row[]} */
  let rows = []
  let broken = 0
  for (const it of arr(src.items)) {
    const ok = it && typeof it === 'object'
    const name = nameOf(ok ? it.name : undefined)
    const from = toNum(ok ? it.from : undefined)
    const to = toNum(ok ? it.to : undefined)
    if (!name || !(Math.abs(from) <= VALUE_MAX) || !(Math.abs(to) <= VALUE_MAX)) { broken++; continue }
    rows.push({ name, from, to })
  }
  if (broken) warnings.push(`傾き図: 名前が無いか、from・to が ±1,000 兆の中の数でない行 ${broken} 個を捨てました`)
  rows = keep(rows, MAX_ROWS, warnings, '傾き図: 行')
  return { data: { rows, fromLabel: nameOf(src.fromLabel), toLabel: nameOf(src.toLabel), unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * @param {SlopeData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const unit = data.unit
  const inline = unit.length > 0 && unit.length <= 2
  const d = decimals(rows.flatMap((r) => [r.from, r.to]))
  const fmt = (/** @type {number} */ v) => (inline ? withUnit(num(v, d), unit) : num(v, d))
  const color = (/** @type {Row} */ r) => (r.to > r.from ? pal.up : r.to < r.from ? pal.down : pal.ink)

  // 両側の字の幅を量って、2 つの列を真ん中に寄せて置く
  const names = rows.map((r) => clip(r.name, LABEL, W * 0.2))
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL)))
  const valW = Math.max(...rows.flatMap((r) => [textWidth(fmt(r.from), VALUE, true), textWidth(fmt(r.to), VALUE, true)]))
  const sideW = nameW + 4 + valW + 10
  const gap = Math.max(60, Math.min(W * 0.38, W - 2 * sideW - 2 * PAD))
  const x0 = (W - (2 * sideW + gap)) / 2
  const xl = x0 + sideW + 0.5
  const xr = xl + gap

  const top = TOP
  const bottom = H - BOTTOM
  const all = rows.flatMap((r) => [r.from, r.to])
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const padV = (hi - lo) * 0.04
  const yOf = linear(lo - padV, hi + padV, bottom, top)
  const before = rows.map((r) => yOf(r.from))
  const after = rows.map((r) => yOf(r.to))
  const lb = dodge(before, GAP, top - 4, bottom + 4)
  const la = dodge(after, GAP, top - 4, bottom + 4)

  /** @type {string[]} */
  const parts = []
  for (const cx of [xl, xr]) parts.push(line(cx, top - 10, cx, bottom + 10, inkStroke(pal, ALPHA.grid, LW.line)))
  parts.push(text(xl, 12, clip(data.fromLabel || tr(lang, '前', 'Before'), TICK, gap * 0.45), { size: TICK, fill: pal.sub, anchor: 'middle' }))
  parts.push(text(xr, 12, clip(data.toLabel || tr(lang, '後', 'After'), TICK, gap * 0.45), { size: TICK, fill: pal.sub, anchor: 'middle' }))

  rows.forEach((r, i) => {
    const c = color(r)
    parts.push(line(xl, before[i], xr, after[i], strokeAttr(c, ALPHA.wick, LW.line)))
    parts.push(circle(xl, before[i], R, fillAttr(c, 1)))
    parts.push(circle(xr, after[i], R, fillAttr(c, 1)))
    // 2pt より動いた字は、細い線で丸とつなぐ
    if (Math.abs(lb[i] - before[i]) > 2) parts.push(line(xl - 3, before[i], xl - 7, lb[i], inkStroke(pal, ALPHA.ref, LW.line)))
    if (Math.abs(la[i] - after[i]) > 2) parts.push(line(xr + 3, after[i], xr + 7, la[i], inkStroke(pal, ALPHA.ref, LW.line)))
    parts.push(text(xl - 9, midline(lb[i], VALUE), fmt(r.from), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
    parts.push(text(xl - 9 - valW - 4, midline(lb[i], LABEL), names[i], { size: LABEL, fill: pal.ink, anchor: 'end' }))
    parts.push(text(xr + 9, midline(la[i], VALUE), fmt(r.to), { size: VALUE, fill: c, bold: true }))
    parts.push(text(xr + 9 + valW + 4, midline(la[i], LABEL), names[i], { size: LABEL, fill: pal.ink }))
  })

  if (!inline && unit) parts.push(text(PAD, H - 4, unitNote(unit, lang), { size: TICK, fill: pal.sub }))
  const rose = rows.filter((r) => r.to > r.from).length
  const fell = rows.filter((r) => r.to < r.from).length
  const fellText = tr(lang, `${fell} 件が下降`, `${fell} down`)
  const roseText = tr(lang, `${rose} 件が上昇`, `${rose} up`)
  parts.push(text(W - PAD, H - 4, fellText, { size: TICK, fill: pal.down, anchor: 'end', bold: true }))
  parts.push(text(W - PAD - textWidth(fellText, TICK, true) - 10, H - 4, roseText, { size: TICK, fill: pal.up, anchor: 'end', bold: true }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 8 件（キャッシュ命中率・%）を、店舗ごとの達成率（先月と今月）の話に直した */
function sample() {
  const items = [['新宿', 62, 81], ['渋谷', 55, 74], ['池袋', 71, 66], ['品川', 40, 58], ['上野', 66, 50], ['銀座', 80, 84], ['浅草', 47, 52], ['秋葉原', 57, 45]]
  return { items: items.map(([name, from, to]) => ({ name, from, to })), fromLabel: '先月', toLabel: '今月', unit: '%' }
}

export default {
  id: 'slope',
  title: '傾き図（Slope）',
  category: 'compare',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {SlopeData} */ data) => Math.max(160, Math.round(TOP + BOTTOM + Math.min(MAX_ROWS, data?.rows?.length ?? 8) * 22)),
  sample,
}
