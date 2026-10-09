// @ts-check
// waterfall（ウォーターフォール）: 期首から期末まで、増えた分と減った分を、前の棒の終わりの高さから浮かせた棒で見せる。
// 元は look の designs/waterfall.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 期首と期末の棒は 0 から立つ墨の 55%（candle の本体と同じ）。間の増減は、前の棒が終わった高さから浮いて、上げは上げの色・下げは下げの色の 55%、
// 幅は candle のスロットの 62%。1 本ごとに、次の棒との間を、墨の 35% の 1pt の線（つなぎ）で渡す。値は棒の中でなく先端（上げは上・下げは下）に置く
// （22pt の棒には符号つきの値が入らない）。縦の尺度は 0 から、いちばん高い水準の少し先まで。0 の線は 1 本だけ、墨の薄い線で引く。
//
// data の読み方: items は { name, value, total? }。total: true の項目は 0 から立つ棒（期首・小計。value がその時点の水準）で、水準をその値にする。
// total でない項目は、前の水準からの増減（符号つき）。data.total は、最後に足す棒の名前（字）で、省くと「合計」（en は Total）の棒を足す。total: false なら足さない。
// 最後の棒の水準は、最初の水準に増減を足した値（期末 = 期首 + Σ 増減。試験で確かめる）。
//
// 紙に写して変えた所
// - 色のテーマ（pal.series がある紙）では、期首・小計・期末の棒を accent（series[0]）で塗る（増減の上げ・下げの色は pal.up・pal.down のまま）。
// - 暗い地は塗らない。値の字は ink（totals は太字）。墨の 55% の棒は mono でも見分けられるよう、増減の字に符号（+ -）を付ける。
// - 元は右下に「NET −3.8」と tspan で色を変えて書いたが、紙では「増減」（sub）と値（上げ・下げの色）の 2 つの字にする。tspan が無いのではなく、text() が 1 色の字だけを持つため。
//   符号は ASCII の「-」（paper の signed）。
// - 水準が負になる data（赤字の累計など）では、0 の線が真ん中に来て、棒は 0 から下へ伸びる。値の字は棒の先端の外側（下がる棒は下）に置くので、図の下の余白を 10pt 広げる。
// - 1 本のスロットが値の字より狭い時は、増減の値の字だけを省く（totals は残す）。名前はスロットの幅で「…」に切る。
// - 項目は 30 までで、超えた分は先頭から 30 だけ描いて warnings に書く。
// 選ばなかった案
// - 増減の棒の中に値を書く案: 小さい増減に入らない。墨の濃い棒の上に紙の色の字も置けない。
// - 期首を data に書かず、最初の増減を 0 から始める案: 期首の残高がある普通の報告（残高の増減）で、最初の棒が 0 から浮いた上げに見えてしまう。total: true で明示する。
import { ALPHA, TICK, LABEL, VALUE, inkStroke, fillAttr, text, line, rect, svgDoc, empty, num, signed, textWidth, clip, tr, keep, linear, decimals, unitNote, LW } from './paper.mjs'
import { readItems } from './parts-kit.mjs'

const MAX_ROWS = 30
const PAD = 12

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean, total?: boolean }} Row */
/** @typedef {{ rows: Row[], unit: string, closing: { name: string } | null }} WaterfallData */
/** @typedef {{ name: string, from: number, to: number, value: number, total: boolean, other?: boolean }} Bar */

/**
 * @param {unknown} data { items: { name, value, total? }[], total?: string | boolean, unit? }
 * @returns {{ data: WaterfallData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const { rows: all, unit } = readItems(src, 'ウォーターフォール', warnings, { signed: true })
  const rows = keep(all, MAX_ROWS, warnings, 'ウォーターフォール: 棒')
  const closing = src.total === false ? null : { name: typeof src.total === 'string' ? src.total.trim() : '' }
  return { data: { rows, unit, closing }, warnings }
}

/**
 * 棒の並び（水準の計算）。total の項目は 0 から value、増減は前の水準から。closing があれば、最後の水準の棒を足す
 * @param {WaterfallData} data
 * @returns {{ bars: Bar[], start: number, end: number }}
 */
export function barsOf(data) {
  /** @type {Bar[]} */
  const bars = []
  let level = 0
  for (const r of data.rows) {
    if (r.total) {
      bars.push({ name: r.name, from: 0, to: r.value, value: r.value, total: true })
      level = r.value
    } else {
      bars.push({ name: r.name, from: level, to: level + r.value, value: r.value, total: false })
      level += r.value
    }
  }
  const start = data.rows[0]?.total ? data.rows[0].value : 0
  if (data.closing) bars.push({ name: data.closing.name, from: 0, to: level, value: level, total: true, other: !data.closing.name })
  return { bars, start, end: level }
}

/**
 * @param {WaterfallData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.rows.length) return empty(o)
  const { bars, start, end } = barsOf(data)
  const n = bars.length
  const digits = decimals([...data.rows.map((r) => r.value), end])
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)))
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)))

  const top = 22
  const bottom = H - (lo < 0 ? 40 : 30)
  const y = linear(lo, hi > lo ? hi : lo + 1, bottom, top)
  const slot = (W - 2 * PAD) / n
  const bw = slot * 0.62
  const cx = (/** @type {number} */ i) => PAD + slot * (i + 0.5)

  /** @type {string[]} */
  const parts = []
  // 0 の線（1 本だけ）。つなぎの線は、棒の縁が上に載るよう先に
  parts.push(line(PAD, y(0), W - PAD, y(0), inkStroke(pal, ALPHA.grid, LW.line)))
  bars.forEach((b, i) => {
    if (i === n - 1) return
    parts.push(line(cx(i) + bw / 2, y(b.to), cx(i + 1) - bw / 2, y(b.to), inkStroke(pal, ALPHA.ref, LW.line)))
  })

  bars.forEach((b, i) => {
    const t = y(Math.max(b.from, b.to))
    const h = Math.max(1, Math.abs(y(b.from) - y(b.to)))
    const color = b.total ? pal.ink : b.value >= 0 ? pal.up : pal.down
    parts.push(rect(cx(i) - bw / 2, t, bw, h, fillAttr(color, ALPHA.body)))
    // 値の字: 上がる棒（と正の total）は先端の上・下がる棒（と負の total）は先端の下
    const label = b.total ? num(b.value, digits) : signed(b.value, digits)
    const rising = b.total ? b.value >= 0 : b.value >= 0
    const size = b.total ? VALUE : LABEL
    if (b.total || textWidth(label, size) <= slot - 1) {
      parts.push(text(cx(i), rising ? t - 4 : t + h + 10, label, { size, fill: pal.ink, anchor: 'middle', bold: b.total }))
    }
    parts.push(text(cx(i), H - 17, clip(b.other ? tr(lang, '合計', 'Total') : b.name || tr(lang, '（無題）', '(untitled)'), TICK, slot - 2), { size: TICK, fill: pal.sub, anchor: 'middle' }))
  })

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(8, H - 4, note, { size: TICK, fill: pal.sub }))
  const moves = data.rows.filter((r) => !r.total).length
  if (moves) {
    const net = end - start
    const v = signed(net, digits)
    parts.push(text(W - 8, H - 4, v, { size: TICK, fill: net >= 0 ? pal.up : pal.down, anchor: 'end' }))
    parts.push(text(W - 8 - textWidth(v, TICK) - 5, H - 4, tr(lang, '増減', 'Net'), { size: TICK, fill: pal.sub, anchor: 'end' }))
  }
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（期首 22.0・8 つの増減・期末 18.2・増減 −3.8。単位は千ドル）の数のまま、ある月の資金の動き（百万円）の話に直した */
function sample() {
  return {
    items: [
      { name: '期首', value: 22, total: true },
      { name: '売上', value: 18.4 },
      { name: '外注費', value: -7.8 },
      { name: '受託', value: 9.6 },
      { name: '人件費', value: -14.5 },
      { name: '広告', value: -2.4 },
      { name: '雑収入', value: 2.1 },
      { name: '家賃', value: -3.2 },
      { name: '税', value: -6 },
    ],
    total: '期末',
    unit: '百万円',
  }
}

export default {
  id: 'waterfall',
  title: 'ウォーターフォール（Waterfall）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.45),
  sample,
}
