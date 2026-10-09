// @ts-check
// waffle（ワッフル）: 10 x 10 の升を左上から行ごとに塗る。1 つの升が全体の 1%。使った分は墨の 55%、最後の項目（今回の分）は目立たせる 1 つ、残りは枠だけの升（墨の 12%）。
// 元は look の designs/waffle.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 升の数は全部で 100 で、数がそのまま % になる（63 + 7 + 30 = 100）・空きの升は枠だけにして場所を保つ（heatmap の空いた日と同じ印）・
// 凡例の行は格子の行に揃える（最後の行の底を格子の底に合わせる）。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる今回の分は accent の 90%（mono は墨の 80%。paper の monoArea）。空きの枠は紙の白の上で消えないよう、細い線の下限 18%（paper の PRINT）に持ち上がる。
// - 元は升 9px・間隔 11px。紙は幅に余裕があるので、升 11pt・間隔 13pt（格子 130pt）。
// - 元の「70% OF THE WEEKLY LIMIT USED」は、data に文が無いので、大きな数（使った割合）の下に「使った値 / 全体」を書く。下の左に「1 マス = 1%」。
// - 項目が 3 つ以上の時は、最後の項目を目立たせる 1 つにし、手前の項目は墨の 55%・35%・22%・25% と薄くして分ける（青を使わない）。
// - 色のテーマ（pal.series がある紙）では、手前の項目を墨の濃さでなく系列の色（series[1…]・薄め）で分け、今回の分を accent（series[0]）の 90% にする。
// 選ばなかった案
// - 升の数を 100 でなく data に合わせる案: 「数がそのまま %」が崩れる。100 に決め、最大剰余法で配る（端数は大きい端数から 1 つずつ）。
// - 空きを項目に入れさせる案: total（全体）を渡せば残りが空きの枠になるので、項目に「空き」を書く必要は無い。
import { ALPHA, TICK, LABEL, VALUE, HUGE, fillAttr, inkStroke, hotFill, seriesFill, text, rect, svgDoc, empty, percent, withUnit, clip, tr, nameOf, arr, keep, textWidth, numOf, plain, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number }} Part */
/** @typedef {{ parts: Part[], total: number, unit: string }} WaffleData */

const MAX_ITEMS = 6
const CELL = 11
const PITCH = 13
const GRID = PITCH * 10 - (PITCH - CELL)
const X0 = 4
const Y0 = 6
const GAP = 24
const FOOT = 18
/** 凡例の幅の上限（名前の列と値の列の間が空きすぎない幅） */
const LEGEND_W = 200
/** 手前の項目の濃さ（今回の分より前）。1 つ目が 55%（body）で、あとは薄くして分ける */
const EARLIER = [ALPHA.body, ALPHA.last, ALPHA.edge, ALPHA.area, ALPHA.area]

/**
 * @param {unknown} data { items: { name, value }[], total?, unit? }（total が合計より大きければ、残りが空きの枠。省くと合計が全体）
 * @returns {{ data: WaffleData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('ワッフル: items（{ name, value } の列）がありません')
  /** @type {Part[]} */
  let parts = []
  let bad = 0
  arr(src.items).forEach((it, i) => {
    const v = numOf(it && it.value)
    if (!(v >= 0)) { bad++; return }
    parts.push({ name: nameOf(it.name) || String(i + 1), value: v })
  })
  if (bad) warnings.push(`ワッフル: value が 0 以上 1,000 兆以下の数でない項目 ${bad} 個を捨てました`)
  parts = keep(parts, MAX_ITEMS, warnings, 'ワッフル: 項目')
  const sum = parts.reduce((s, p) => s + p.value, 0)
  let total = sum
  if (src.total !== undefined && src.total !== null) {
    const t = numOf(src.total)
    if (t > 0) {
      if (t >= sum) total = t
      else warnings.push('ワッフル: total が項目の合計より小さいので、合計を全体にしました')
    } else warnings.push('ワッフル: total が 0 より大きい数でないので、合計を全体にしました')
  }
  if (parts.length && !(total > 0)) {
    warnings.push('ワッフル: 項目の合計が 0 なので描きません')
    parts = []
  }
  return { data: { parts, total, unit: typeof src.unit === 'string' ? src.unit : '' }, warnings }
}

/**
 * 升の数を 100 に配る。使った分は round(合計 / 全体 x 100)・最大剰余法（端数の大きい項目から 1 つずつ）。残りは空き
 * @param {number[]} values @param {number} total
 * @returns {{ counts: number[], free: number }}
 */
function allocate(values, total) {
  const exact = values.map((v) => (v / total) * 100)
  const used = Math.min(100, Math.round(exact.reduce((s, e) => s + e, 0)))
  const counts = exact.map(Math.floor)
  let left = used - counts.reduce((s, c) => s + c, 0)
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length * 2; k++, left--) counts[order[k % order.length].i]++
  return { counts, free: 100 - counts.reduce((s, c) => s + c, 0) }
}

/**
 * @param {WaffleData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const { parts: items, total, unit } = data
  if (!items.length) return empty(o)
  const { counts, free } = allocate(items.map((p) => p.value), total)
  const hasHot = items.length >= 2
  /** 項目ごとの塗り（今回の分は目立たせる 1 つ） @param {number} i */
  const fillOf = (i) => seriesFill(pal, i, hasHot ? items.length - 1 : -1, 0.9) ?? (hasHot && i === items.length - 1 ? hotFill(pal, 0.9) : fillAttr(pal.ink, EARLIER[Math.min(i, EARLIER.length - 1)]))
  const freeStroke = `fill="none" ${inkStroke(pal, ALPHA.grid, LW.line)}`
  /** 1 つの升（空きは枠だけ。線は升の内側に 0.5pt 入れて、塗りと同じ大きさにする） @param {number} x @param {number} y @param {number} i 項目の番号・空きは -1 */
  const square = (x, y, i) => (i < 0 ? rect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, freeStroke) : rect(x, y, CELL, CELL, fillOf(i)))

  const natural = Y0 + GRID + FOOT
  const top = Y0 + Math.max(0, (H - natural) / 2)
  /** @type {string[]} */
  const out = []
  const kinds = [...counts.flatMap((c, i) => Array(c).fill(i)), ...Array(free).fill(-1)]
  // 幅に余裕がある時は、格子と凡例の組を真ん中に寄せる
  const lw = Math.min(W - X0 - GRID - GAP - 4, LEGEND_W)
  const x0 = X0 + Math.max(0, (W - (X0 + GRID + GAP + lw + 4)) / 2)
  kinds.forEach((k, n) => out.push(square(x0 + (n % 10) * PITCH, top + Math.floor(n / 10) * PITCH, k)))

  const used = items.reduce((s, p) => s + p.value, 0)
  const lx = x0 + GRID + GAP
  out.push(text(lx, top + 22, percent(used / total), { size: HUGE, fill: pal.ink }))
  out.push(text(lx, top + 37, clip(`${withUnit(plain(used), unit)} / ${withUnit(plain(total), unit)}`, TICK, lw), { size: TICK, fill: pal.sub }))

  /** 凡例の行（項目と、空きがあれば空き）。行の底を格子の底に揃える @type {{ name: string, value: number, i: number }[]} */
  const rows = items.map((p, i) => ({ name: p.name, value: p.value, i }))
  if (free > 0) rows.push({ name: tr(lang, '残り', 'Remaining'), value: total - used, i: -1 })
  const rowP = rows.length <= 3 ? 22 : 15
  rows.forEach((r, k) => {
    const y = top + GRID - CELL - (rows.length - 1 - k) * rowP
    out.push(square(lx, y, r.i))
    const hot = hasHot && r.i === items.length - 1
    const valueText = withUnit(plain(r.value), unit)
    const maxName = lw - 18 - textWidth(valueText, VALUE, true) - 8
    out.push(text(lx + 18, y + CELL - 2, clip(r.name, LABEL, maxName), { size: LABEL, fill: pal.ink }))
    out.push(text(lx + lw, y + CELL - 2, valueText, { size: VALUE, fill: hot ? pal.accent : pal.ink, anchor: 'end', bold: true }))
  })
  out.push(text(x0, H - 4, tr(lang, '1 マス = 1%', '1 square = 1%'), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, out.join(''))
}

/** 元の見本（63 + 7 + 30）。週の上限を、予算 100 万円の消化に直した */
function sample() {
  return {
    items: [
      { name: '先月まで', value: 63 },
      { name: '今月', value: 7 },
    ],
    total: 100,
    unit: '万円',
  }
}

export default {
  id: 'waffle',
  title: 'ワッフル（Waffle）',
  category: 'usage',
  normalize,
  draw,
  height: () => Y0 + GRID + FOOT,
  sample,
}
