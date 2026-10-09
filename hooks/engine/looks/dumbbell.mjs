// @ts-check
// dumbbell（ダンベル）: 項目ごとに 2 つの値（元は API の応答時間の中央値と 95% 点）を、同じ尺度の上で細い線でつなぎ、2 つの丸を打つ。遅い順に並べる。
// 元は look の designs/dumbbell.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 全部の行が 1 つの尺度（0 から、最大を少し超える切りのよい値まで）を共有する。つなぎは墨の 35%・1pt の線で、
// 2 つの丸の間だけ。前の丸（from）は墨・後の丸（to）は墨の濃さを下げ、目標（threshold）を超えた時だけ後の丸が下げの色になるので、数を読まなくても
// 遅い尾に目が行く。目標は candle の最後の値と同じ墨の 35% の点線。値は丸の外側の両端に置く。目標の線は、値の字と交わる所で切れる（値を丸から
// 動かすと値が丸と合わなくなるので、動かすのは線の方）。切れ目が 9pt より近い時は 1 つにつなぐ（点線の短い 1 本は、それだけで印に見える）。
// 目標を超えた件数は行から数える。
//
// 紙に写して変えた所
// - 暗い地は塗らない。後の丸は墨の 60% を ALPHA.strong（65%）に置き換えた。上げ下げの下げは pal.down。
// - 元は名前を「メソッド（灰）＋パス（等幅の墨）」の 2 列にしたが、紙の data は 1 つの名前なので、名前の列は 1 つ（8pt の ink）。
// - 値の字の置き場所: 元は前の値が左・後の値が右だった。紙の data は前より後が小さい行もあるので、小さい方の丸の左・大きい方の丸の右に置く。
//   元は名前に触れる値を落としたが、紙では値が data そのものなので落とさず、左の列に値の幅の分の余白を取る。
// - 元は「ROUTE」「SLO 300 MS」「3 OVER 300 MS」を上に置いた。紙では目標の線の上に「目標の名前＋値」、上の左に超えた件数を置く（目標が無ければ上の字は無い）。
//   元の下の「SAMPLE ...」は置かず、左下に単位、右下に凡例（前の丸・後の丸の名前）を置く。
// - 目標（threshold・thresholdLabel）は docs/looks.md の 3 章の前後の data に無い。時系列の threshold と同じ名前で足した（任意）。無ければ後の丸は墨の濃さを下げるだけ。
// 選ばなかった案
// - 行を 30 より多く描く案: 1 頁に収まらない。遅い順の上位 30 だけ描いて warnings に書く。
// - 値の字が目標の線に重なる時に、字を動かす案: 字が丸から離れて、どの丸の値か分からなくなる。線を切る。
import { ALPHA, DASH, TICK, LABEL, midline, f, fillAttr, inkFill, seriesColor, inkStroke, strokeAttr, text, line, circle, svgDoc, empty, num, textWidth, clip, niceExtent, ticks, linear, keep, nameOf, toNum, arr, tr, legend, VALUE_MAX, decimals, unitNote, LW } from './paper.mjs'

const MAX_ROWS = 30
const PAD = 4
const R = 2
const ROW = 19
const ROW_MAX = 20
const ROW_MIN = 8
/** 上の字（目標がある時だけ）の高さ */
const HEAD = 16
const TOP = 8
/** 目盛りの字の行と、左下・右下の行 */
const BOTTOM = 34

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, from: number, to: number }} Row */
/** @typedef {{ rows: Row[], fromLabel: string, toLabel: string, unit: string, threshold: number | null, thresholdLabel: string }} DumbbellData */

/**
 * @param {unknown} data { items: { name, from, to }[], fromLabel, toLabel, unit?, threshold?, thresholdLabel? }
 * @returns {{ data: DumbbellData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('ダンベル: items（{ name, from, to } の列）がありません')
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
  if (broken) warnings.push(`ダンベル: 名前が無いか、from・to が ±1,000 兆の中の数でない行 ${broken} 個を捨てました`)
  rows.sort((a, b) => Math.max(b.from, b.to) - Math.max(a.from, a.to))
  rows = keep(rows, MAX_ROWS, warnings, 'ダンベル: 行')
  const th = src.threshold === undefined || src.threshold === null ? NaN : toNum(src.threshold)
  if (src.threshold !== undefined && src.threshold !== null && !(Math.abs(th) <= VALUE_MAX)) warnings.push('ダンベル: threshold が数でないので、目標の線は引きません')
  return {
    data: {
      rows,
      fromLabel: nameOf(src.fromLabel),
      toLabel: nameOf(src.toLabel),
      unit: typeof src.unit === 'string' ? src.unit : '',
      threshold: Math.abs(th) <= VALUE_MAX ? th : null,
      thresholdLabel: nameOf(src.thresholdLabel),
    },
    warnings,
  }
}

/**
 * @param {DumbbellData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  const th = data.threshold
  const d = decimals(rows.flatMap((r) => [r.from, r.to]))
  const fmt = (/** @type {number} */ v) => num(v, d)
  const fromLabel = data.fromLabel || tr(lang, '前', 'From')
  const toLabel = data.toLabel || tr(lang, '後', 'To')
  // 超えたのは後の丸だけ（元の p95）
  const over = th === null ? 0 : rows.filter((r) => r.to > th).length

  const names = rows.map((r) => clip(r.name, LABEL, W * 0.26))
  const nameW = Math.max(...names.map((s) => textWidth(s, LABEL)))
  const valW = Math.max(...rows.flatMap((r) => [textWidth(fmt(r.from), LABEL), textWidth(fmt(r.to), LABEL)]))
  const x0Edge = PAD + nameW + 10 + valW + R + 5
  const x1Edge = Math.max(x0Edge + 40, W - PAD - valW - R - 5)
  const all = rows.flatMap((r) => [r.from, r.to])
  const [lo, hi] = niceExtent(Math.min(0, ...all, ...(th === null ? [] : [th])), Math.max(0, ...all, ...(th === null ? [] : [th])))
  const sx = linear(lo, hi, x0Edge, x1Edge)

  const top = TOP + (th === null ? 0 : HEAD)
  const pitch = Math.max(ROW_MIN, Math.min(ROW_MAX, (H - top - BOTTOM) / n))
  const plotBottom = top + pitch * n
  /** @type {string[]} */
  const parts = []

  // 目盛り（薄い縦の線・下の字・2pt の足）。軸の線は引かない
  const tk = ticks(lo, hi, Math.max(2, Math.floor((x1Edge - x0Edge) / 70)))
  // 目盛りは切りのよい値なので、データの桁ではなく目盛り自身の桁で書く（0.0・500.0 と並べない）
  const td = decimals(tk)
  for (const t of tk) {
    const tx = Math.round(sx(t)) + 0.5
    parts.push(line(tx, top, tx, plotBottom, inkStroke(pal, ALPHA.faint, LW.line)))
    parts.push(line(tx, plotBottom + 2, tx, plotBottom + 5, strokeAttr(pal.sub, 1, LW.line)))
    parts.push(text(tx, plotBottom + 14, num(t, td), { size: TICK, fill: pal.sub, anchor: 'middle' }))
  }

  // 色のテーマ: 前の丸は series[1]、後の丸は accent（遅い側は pal.down のまま）
  const fromTone = seriesColor(pal, 1)
  const toTone = seriesColor(pal, 0)
  /** @type {string[]} */
  const marks = []
  /** @type {number[][]} 目標の線を切る範囲 [上, 下] */
  const gaps = []
  const sref = th === null ? 0 : Math.round(sx(th)) + 0.5
  const place = (/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ cy, /** @type {string} */ svg) => {
    if (th !== null && sref > x0 - 3 && sref < x1 + 3) gaps.push([cy - 7, cy + 7])
    marks.push(svg)
  }
  rows.forEach((r, i) => {
    const cy = top + pitch * (i + 0.5)
    const a = sx(r.from)
    const b = sx(r.to)
    const slow = th !== null && r.to > th
    marks.push(text(PAD, midline(cy, LABEL), names[i], { size: LABEL, fill: pal.ink }))
    marks.push(line(Math.min(a, b) + R, cy, Math.max(a, b) - R, cy, inkStroke(pal, ALPHA.ref, LW.line)))
    marks.push(circle(a, cy, R, fromTone !== null ? fillAttr(fromTone, 1) : inkFill(pal, 1)))
    marks.push(circle(b, cy, R, slow ? fillAttr(pal.down, 1) : toTone !== null ? fillAttr(toTone, 1) : inkFill(pal, ALPHA.strong)))
    // 値は小さい方の丸の左・大きい方の丸の右（from が小さければ元の見本と同じ並び）
    const pairs = /** @type {[number, number, string, boolean][]} */ ([[a, r.from, pal.ink, false], [b, r.to, slow ? pal.down : pal.ink, slow]])
    pairs.sort((p, q) => p[0] - q[0])
    const [left, right] = pairs
    const ls = fmt(left[1])
    const rs = fmt(right[1])
    place(left[0] - R - 5 - textWidth(ls, LABEL), left[0] - R - 5, cy, text(left[0] - R - 5, midline(cy, LABEL), ls, { size: LABEL, fill: left[2], anchor: 'end' }))
    place(right[0] + R + 5, right[0] + R + 5 + textWidth(rs, LABEL), cy, text(right[0] + R + 5, midline(cy, LABEL), rs, { size: LABEL, fill: right[2] }))
  })

  if (th !== null) {
    // 目標の線は行の下に 1 本の path で引く。値の字と交わる所は切り、9pt より近い切れ目は 1 つにつなぐ
    let dd = ''
    let y0 = top - 4
    for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) {
      if (g0 > y0 + 9) dd += `M${f(sref)} ${f(y0)}V${f(g0)}`
      y0 = Math.max(y0, g1)
    }
    if (plotBottom > y0) dd += `M${f(sref)} ${f(y0)}V${f(plotBottom)}`
    if (dd) parts.push(`<path d="${dd}" fill="none" ${inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)}/>`)
    const word = data.thresholdLabel || tr(lang, '目標', 'Target')
    // 目標は切りのよい値が多いので、データの桁ではなく自分の桁で書く（目標値 640.0 と並べない）
    const label = clip(`${word} ${num(th, decimals([th]))}`, TICK, W * 0.4)
    const lw = textWidth(label, TICK)
    const overText = over > 0 ? tr(lang, `${over} 件が超過`, `${over} over`) : ''
    const overW = overText ? textWidth(overText, TICK, true) : 0
    // 「超えた件数」は上の左。目標の字がそれにかかる時は、右へずらす
    const lx = Math.min(W - PAD - lw, Math.max(sref - lw / 2, PAD + overW + 8))
    parts.push(text(lx, TOP + 7, label, { size: TICK, fill: pal.sub }))
    if (overText) parts.push(text(PAD, TOP + 7, overText, { size: TICK, fill: pal.down, bold: true }))
  }
  parts.push(...marks)

  if (data.unit) parts.push(text(PAD, H - 4, unitNote(data.unit, lang), { size: TICK, fill: pal.sub }))
  const keyW = Math.max(40, W * 0.3 - 20)
  parts.push(legend(W - PAD, H - 4, [
    { label: clip(fromLabel, TICK, keyW), mark: 'dot', attr: fromTone !== null ? fillAttr(fromTone, 1) : inkFill(pal, 1) },
    { label: clip(toLabel, TICK, keyW), mark: 'dot', attr: toTone !== null ? fillAttr(toTone, 1) : inkFill(pal, ALPHA.strong) },
  ], pal, { anchor: 'end' }).svg)
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 8 本（中央値と 95% 点・ms）の名前を、処理の名前に直した */
function sample() {
  const items = [['受付登録', 210, 640], ['帳票出力', 160, 420], ['全文検索', 120, 360], ['ファイル取込', 190, 290], ['認証', 80, 240], ['一覧表示', 58, 170], ['履歴表示', 42, 118], ['残高照会', 35, 90]]
  return { items: items.map(([name, from, to]) => ({ name, from, to })), fromLabel: '中央値', toLabel: '95% 点', unit: 'ms', threshold: 300, thresholdLabel: '目標' }
}

export default {
  id: 'dumbbell',
  title: 'ダンベル（Dumbbell）',
  category: 'compare',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {DumbbellData} */ data) => Math.max(100, Math.round(TOP + (data?.threshold == null ? 0 : HEAD) + BOTTOM + Math.min(MAX_ROWS, data?.rows?.length ?? 8) * ROW)),
  sample,
}
