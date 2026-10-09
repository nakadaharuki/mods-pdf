// @ts-check
// radar（レーダー）: 6 本の軸（元の見本）に、4 本の輪（外周の 25・50・75・100%）と軸の線を墨の 12% で引き、系列の値を多角形で重ねる。
// 元は look の designs/radar.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 輪と軸の線は 1 本ずつ墨の 12%。いちばん新しい系列は面を 25% で塗り、同じ色の 1 本の線で縁取る。古い系列は
// 墨の線。どの系列も頂点に r=2 の丸を打ち、1 つの値を読み取れるようにする。軸の名前は外周のすぐ外に置く。軸は最初の 1 本が真上で、あとは時計回り。
//
// 紙に写して変えた所
// - 暗い地は塗らない。元は新しい系列を「上げの緑」で塗ったが、緑は上げ下げの意味を持つので、紙では「目立たせる 1 つ」（hotFill・hotStroke。mono は墨）に
//   した。面は 25%（ALPHA.area）で、mono でも濃くしない（面は輪の上の大きな塗りで、80% にすると黒い板になる）。縁の線は 100%。
// - 古い系列の墨 60% は seriesStyle(i, true)（55%・30% の実線、続いて破線）に置き換えた。系列は 6 つまで（目立たせる 1 つ + 5 つ）。
// - 輪と軸の線は 12% を、紙の線の下限 18%（paper の PRINT）に持ち上げた。細さは 0.75pt。
// - 軸の名前に、先頭の系列の値を 7.5pt の sub で添える（元は値を字で出さなかったが、紙は読む人が丸の高さから値を逆算できない）。
// - 元は下の左に「SAMPLE 6 AXES」・右に凡例を置いた。紙では左下に外周の値（max）、右下に凡例（系列の名前）を置く。
// - max（外周の値）は data.max。無ければ、全部の値の最大を切りのよい値にそろえた物（0 から）。外周を超える値は外周に止め、warnings に書く。
// 選ばなかった案
// - 軸が 3 本より少ない時に線で描く案: 2 本は 1 本の線、1 本は点で、レーダーの読み方が通じない。「データがありません」にして warnings に書く。
// - 輪に値の字を置く案: 軸の名前・値・系列の線と重なり、読む物が増える。外周の値だけ左下に置く。
import { ALPHA, TICK, LABEL, midline, f, fillAttr, inkFill, inkStroke, strokeAttr, hotFill, hotStroke, hot, seriesStyle, text, circle, svgDoc, empty, num, textWidth, clip, niceExtent, keep, nameOf, toNum, arr, tr, legend, seeded, VALUE_MAX, decimals, LW } from './paper.mjs'

const MAX_AXES = 12
const MAX_SERIES = 6
const PAD = 4
/** 真上と真下の名前のための余白（名前の高さ + すき間） */
const ROOM_TOP = 16
const ROOM_BOTTOM = 32
const RING_SHARES = [0.25, 0.5, 0.75, 1]

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[] }} Series */
/** @typedef {{ axes: string[], series: Series[], max: number }} RadarData */

/**
 * @param {unknown} data { axes: string[], series: { name, values }[], max? }
 * @returns {{ data: RadarData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.axes) || !Array.isArray(src.series)) warnings.push('レーダー: axes（軸の名前の列）と series（{ name, values } の列）がありません')
  const axes = keep(arr(src.axes).map((a) => nameOf(a) || '–'), MAX_AXES, warnings, 'レーダー: 軸')
  if (axes.length && axes.length < 3) warnings.push('レーダー: 軸が 3 本より少ないので描けません（レーダーは 3 本以上の軸が要ります）')
  let bad = 0
  let padded = 0
  const askMax = src.max === undefined || src.max === null ? NaN : toNum(src.max)
  if (src.max !== undefined && src.max !== null && !(askMax > 0 && askMax <= VALUE_MAX)) warnings.push('レーダー: max が 0 より大きい数でないので、値の最大から決めます')
  /** @type {Series[]} */
  let series = []
  for (const s of arr(src.series)) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.values)) { bad++; continue }
    /** @type {number[]} */
    const values = []
    for (let k = 0; k < axes.length; k++) {
      const v = toNum(s.values[k])
      if (v >= 0 && v <= VALUE_MAX) values.push(v)
      else { values.push(0); padded++ }
    }
    series.push({ name: nameOf(s.name) || '–', values })
  }
  if (bad) warnings.push(`レーダー: values（数の列）の無い系列 ${bad} 個を捨てました`)
  if (padded) warnings.push(`レーダー: 数でない値・負の値 ${padded} 個を 0 にしました`)
  series = keep(series, MAX_SERIES, warnings, 'レーダー: 系列')
  const peak = Math.max(0, ...series.flatMap((s) => s.values))
  const max = askMax > 0 && askMax <= VALUE_MAX ? askMax : niceExtent(0, peak > 0 ? peak : 1)[1]
  if (series.some((s) => s.values.some((v) => v > max))) warnings.push('レーダー: max を超える値は外周に止めました')
  return { data: { axes: axes.length >= 3 ? axes : [], series: axes.length >= 3 ? series : [], max }, warnings }
}

/**
 * @param {RadarData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const axes = data.axes
  const series = data.series
  if (!axes.length || !series.length) return empty(o)
  const n = axes.length
  const d = decimals(series.flatMap((s) => s.values))
  const angle = (/** @type {number} */ k) => -Math.PI / 2 + (k * 2 * Math.PI) / n

  // 軸の名前: 名前（ink）に先頭の系列の値（sub）を添える。横の名前は半径の外に置くので、その幅の分だけ半径を縮める
  const labels = axes.map((name, k) => ({
    name: clip(name, LABEL, W * 0.22),
    value: num(series[0].values[k], d),
    c: Math.cos(angle(k)),
    s: Math.sin(angle(k)),
  }))
  const pairW = (/** @type {{ name: string, value: string }} */ l) => textWidth(l.name, LABEL) + 3 + textWidth(l.value, TICK)
  const sideRoom = Math.max(0, ...labels.filter((l) => Math.abs(l.c) >= 0.2).map((l) => pairW(l) + 9))
  const midRoom = Math.max(0, ...labels.filter((l) => Math.abs(l.c) < 0.2).map((l) => pairW(l) / 2 - 0))
  const R = Math.max(24, Math.min((W - 2 * PAD) / 2 - Math.max(sideRoom, midRoom), (H - ROOM_TOP - ROOM_BOTTOM) / 2))
  const cx = W / 2
  const cy = ROOM_TOP + (H - ROOM_TOP - ROOM_BOTTOM) / 2
  const at = (/** @type {number} */ k, /** @type {number} */ r) => [cx + r * Math.cos(angle(k)), cy + r * Math.sin(angle(k))]
  const poly = (/** @type {number[]} */ radii) => radii.map((r, k) => at(k, r).map(f).join(',')).join(' ')

  /** @type {string[]} */
  const parts = []
  const gridStroke = inkStroke(pal, ALPHA.grid, LW.hair)
  for (const share of RING_SHARES) parts.push(`<polygon points="${poly(axes.map(() => R * share))}" fill="none" ${gridStroke}/>`)
  axes.forEach((_, k) => {
    const [x, y] = at(k, R)
    parts.push(`<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(x)}" y2="${f(y)}" ${gridStroke}/>`)
  })

  // 先頭の系列を最後に描き、重なる古い系列の上に載せる。値は外周（max）を超えたら外周に止める
  const radiiOf = (/** @type {Series} */ s) => s.values.map((v) => Math.min(1, v / data.max) * R)
  for (let i = series.length - 1; i >= 0; i--) {
    const radii = radiiOf(series[i])
    if (i === 0) {
      parts.push(`<polygon points="${poly(radii)}" ${hotFill(pal, ALPHA.area, ALPHA.area)} ${hotStroke(pal, 1, LW.hot, 1)}/>`)
      const h = hot(pal, 1, 1)
      radii.forEach((r, k) => { const [x, y] = at(k, r); parts.push(circle(x, y, 2, fillAttr(h.color, 1))) })
    } else {
      const st = seriesStyle(i - 1, true)
      parts.push(`<polygon points="${poly(radii)}" fill="none" ${strokeAttr(pal.ink, st.a, LW.line, st.dash)}/>`)
      radii.forEach((r, k) => { const [x, y] = at(k, r); parts.push(circle(x, y, 2, inkFill(pal, st.a))) })
    }
  }

  // 軸の名前: 外周のすぐ外。真上は点の上・真下は点の下・横は点の横に、外側へ向けて置く
  labels.forEach((l, k) => {
    const [x, y] = at(k, R + 7)
    const nameW = textWidth(l.name, LABEL)
    const w = pairW(l)
    const by = l.s < -0.9 ? y - 1 : l.s > 0.9 ? y + 7.5 : midline(y, LABEL)
    const x0 = l.c > 0.2 ? x : l.c < -0.2 ? x - w : x - w / 2
    parts.push(text(x0, by, l.name, { size: LABEL, fill: pal.ink }))
    parts.push(text(x0 + nameW + 3, by, l.value, { size: TICK, fill: pal.sub }))
  })

  // 下の左に外周の値、右に凡例
  const note = `${tr(lang, '外周', 'Outer ring')} = ${num(data.max, decimals([data.max]))}`
  parts.push(text(PAD, H - 4, note, { size: TICK, fill: pal.sub }))
  const budget = Math.max(60, W - 2 * PAD - textWidth(note, TICK) - 16)
  const per = Math.max(24, budget / series.length - 22)
  parts.push(legend(W - PAD, H - 4, series.map((s, i) => ({
    label: clip(s.name, TICK, per),
    mark: /** @type {'line'} */ ('line'),
    attr: i === 0 ? hotStroke(pal, 1, LW.hot, 1) : strokeAttr(pal.ink, seriesStyle(i - 1, true).a, LW.line, seriesStyle(i - 1, true).dash),
  })), pal, { anchor: 'end' }).svg)
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（種 20261009 の 6 本の軸・今と前の四半期）の軸の名前を、店舗の評価の軸に直した。値は 100 点満点 */
function sample() {
  const rnd = seeded(20261009)
  const axes = ['売上', '利益率', 'リピート率', '新規獲得', '満足度', '在庫回転']
  const now = axes.map(() => Math.round((0.35 + rnd() * 0.6) * 100))
  const last = axes.map(() => Math.round((0.25 + rnd() * 0.6) * 100))
  return { axes, series: [{ name: '今期', values: now }, { name: '前期', values: last }], max: 100 }
}

export default {
  id: 'radar',
  title: 'レーダー（Radar）',
  category: 'compare',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(Math.min(360, width * 0.62)),
  sample,
}
