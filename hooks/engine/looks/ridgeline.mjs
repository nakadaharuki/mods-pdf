// @ts-check
// ridgeline（リッジライン図）: 群ごとの値の分布を、少しずつ重ねた密度の山の行にして並べる。古い群が奥（上）・新しい群が手前（下）で、見てほしい最後の行が隠れない。
// 元の見本は直近 7 日のツール呼び出しの応答時間（1 日 300 回ずつ。金曜だけ 30% が遅い 2 つ目の山に行く）。
// 元は look の designs/ridgeline.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 各行は、ガウス核の密度推定を一定の間隔で測った物。全部の行が 1 つの高さの尺度を共有する（狭い日は高く出る）。行は、先に地の色で塗り、
// そのあと墨で塗って 1px の輪郭を引く（手前の行が奥の行を隠し、濁らせない）。ふつうの行は 8% の薄い面（25% の面を 6 つ重ねると頁でいちばん重い灰色になるので、輪郭に形を任せる）で、
// 目立たせる 1 行（look の橙）だけが 25% の面を持つ。行は山の高さのおよそ半分で重なる（山の高さがピッチの 1.93 倍）。各行の中央値は墨 35% の点線の 1px の柱で、右端に値の字。
// 密度推定は教科書の式を手で書いた物で、絵の中の数字は全部 data から計算する。
//
// 紙に写して変えた所
// - 地の色で塗る所は、紙では pal.paper（紙の白）で塗る。紙の白が奥の山を隠すので、look の「stage で塗ってから墨」と同じ重なり方になる。
// - 目立たせる 1 行（既定は最後の行。data.highlight に群の名前で替えられる）は、色のある紙では pal.accent の 25% の面と 90% の輪郭。mono は面が墨の 50%・輪郭が墨 100%
//   （ほかの行の輪郭は 55% なので見分けられる）。
// - 元は帯域幅を 18ms に固定したが、data に単位が無いので、群ごとの Silverman の目安（0.9 × min(標準偏差, 四分位範囲 / 1.34) × n の -1/5 乗）の平均を、全部の行で共有する。
//   見本ではおよそ 17ms で、元の 18ms とほぼ同じ。
// - 元の「TODAY」の札は、群の名前だけにする（data に「今日」の印が無い）。上の「P50」は「中央値」。下の「SAMPLE ...」は置かない。値の単位は目盛りの右端（箱ひげ図と同じ）。
// 選ばなかった案
// - 全部の行を墨の 25% の面で重ねる案: 頁でいちばん重くなる（元の頭の文のとおり）。
// - 行の数だけ頁を縦に伸ばす案: 12 行までにして warnings に書く。行が 12 を超える data は ridgeline でなく、行を絞るか ECharts にする。
import { ALPHA, DASH, TICK, LABEL, VALUE, fillAttr, inkFill, inkStroke, hotFill, hotStroke, fillPath, strokePath, text, line, svgDoc, empty, num, textWidth, clip, tr, linear, niceExtent, keep, nameOf, dateLabel, seeded, statDigits, axisBottom, tickSet, polyline, fitText, LW } from './paper.mjs'
import { readGroups, sorted, quantile, baseZero, normalOf, round, silverman } from './spread-kit.mjs'

const MAX_ROWS = 12
const STEPS = 120
const PAD = 12
const HEADER_Y = 11
const PLOT_TOP = 22
const BOTTOM_FROM_BOTTOM = 29
/** 山の高さはピッチのこの倍（元は 58px / 30px）。重なりがおよそ半分になる */
const PEAK_PER_PITCH = 1.93
const MAX_PITCH = 36
const ROW_PITCH = 30

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, values: number[] }} Row values は小さい順 */
/** @typedef {{ rows: Row[], unit: string, hot: number }} RidgeData hot は目立たせる行の番号 */

/**
 * @param {unknown} data { groups: { name, values }[], unit?, highlight?: 群の名前 }（値が 2 個以上ある群だけ。古い群から並べる）
 * @returns {{ data: RidgeData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const groups = keep(readGroups(src, warnings, 'リッジライン図', 2), MAX_ROWS, warnings, 'リッジライン図: 群')
  const rows = groups.map((g) => ({ name: g.name, values: sorted(g.values) }))
  const wanted = nameOf(src.highlight)
  const found = wanted ? rows.findIndex((r) => r.name === wanted) : -1
  if (wanted && found < 0) warnings.push(`リッジライン図: highlight「${wanted}」という名前の群がありません。最後の行を目立たせます`)
  return { data: { rows, unit: typeof src.unit === 'string' ? src.unit : '', hot: found >= 0 ? found : rows.length - 1 }, warnings }
}

/**
 * ガウス核の密度を、lo から hi まで STEPS + 1 点で測る
 * @param {number[]} s @param {number} h @param {number} lo @param {number} hi
 * @returns {number[]}
 */
function kde(s, h, lo, hi) {
  const k = 1 / (s.length * h * Math.sqrt(2 * Math.PI))
  const out = []
  for (let i = 0; i <= STEPS; i++) {
    const t = lo + ((hi - lo) * i) / STEPS
    let sum = 0
    for (const c of s) {
      const u = (t - c) / h
      if (u > -6 && u < 6) sum += Math.exp(-0.5 * u * u)
    }
    out.push(sum * k)
  }
  return out
}

/**
 * @param {RidgeData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  // 範囲は全部の値の 0.5%〜99.5%（1 つ 2 つの外れた値で、山が左に寄って右が空かない）。範囲の外の値も密度には入り、山の線が範囲で終わる
  const pooled = sorted(rows.flatMap((r) => r.values))
  const minAll = quantile(pooled, 0.005)
  const maxAll = quantile(pooled, 0.995)
  const widths = rows.map((r) => silverman(r.values)).filter((h) => h > 0)
  const h = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : (maxAll - minAll) / 20 || Math.abs(maxAll) * 0.05 || 1
  const nonneg = pooled[0] >= 0
  const dLo = nonneg ? Math.max(0, minAll - 3 * h) : minAll - 3 * h
  const dHi = maxAll + 3 * h
  const [lo, hi] = niceExtent(baseZero(dLo, dHi), dHi, 5)
  const digits = statDigits(hi - lo)
  const fmt = (/** @type {number} */ v) => num(v, digits)

  const dens = rows.map((r) => kde(r.values, h, lo, hi))
  let top = 0
  for (const d of dens) for (const v of d) top = Math.max(top, v)
  if (!(top > 0)) return empty(o)

  const nameW = Math.min(W * 0.26, Math.max(...rows.map((r) => textWidth(r.name, LABEL))))
  const medW = Math.max(textWidth(tr(lang, '中央値', 'Median'), TICK), ...rows.map((r) => textWidth(fmt(quantile(r.values, 0.5)), VALUE, true)))
  const left = PAD + nameW + 12
  const right = W - PAD - medW - 14
  const x = linear(lo, hi, left, right)
  const pitch = Math.min(MAX_PITCH, (H - BOTTOM_FROM_BOTTOM - PLOT_TOP) / (n - 1 + PEAK_PER_PITCH))
  const peak = pitch * PEAK_PER_PITCH
  const base0 = PLOT_TOP + peak
  /** @type {string[]} */
  const parts = []
  parts.push(text(W - PAD, HEADER_Y, tr(lang, '中央値', 'Median'), { size: TICK, fill: pal.sub, anchor: 'end' }))

  // 奥（最初の行）から手前へ。手前の行が奥の行を隠す
  rows.forEach((r, i) => {
    const base = base0 + i * pitch
    const y = (/** @type {number} */ d) => base - (d / top) * peak
    const hot = i === data.hot
    const curve = /** @type {[number, number][]} */ (dens[i].map((d, k) => [x(lo + ((hi - lo) * k) / STEPS), y(d)]))
    const closed = polyline([...curve, [x(hi), base], [x(lo), base]], true)
    parts.push(fillPath(closed, fillAttr(pal.paper, 1)))
    parts.push(fillPath(closed, hot ? hotFill(pal, ALPHA.area) : inkFill(pal, ALPHA.faint)))
    parts.push(strokePath(polyline(curve), hot ? hotStroke(pal, 0.9, LW.line) : inkStroke(pal, ALPHA.body, LW.line)))

    // 中央値: 底から山の線まで、墨 35% の点線の柱
    const p50 = quantile(r.values, 0.5)
    const at = Math.max(0, Math.min(STEPS, Math.round(((p50 - lo) / (hi - lo)) * STEPS)))
    parts.push(line(x(p50), base, x(p50), y(dens[i][at]), hot ? hotStroke(pal, ALPHA.ref, LW.line, ALPHA.ref, DASH.ref) : inkStroke(pal, ALPHA.ref, LW.line, DASH.ref)))
    parts.push(text(PAD, base - 2, clip(r.name, LABEL, nameW), { size: LABEL, fill: hot ? pal.accent : pal.ink }))
    parts.push(text(W - PAD, base - 2, fmt(p50), { size: VALUE, fill: hot ? pal.accent : pal.ink, anchor: 'end', bold: true }))
  })

  const lastBase = base0 + (n - 1) * pitch
  const xTicks = tickSet(lo, hi, 5)
  parts.push(axisBottom({ ticks: xTicks.values, at: x, y: lastBase + 2, pal, fmt: xTicks.fmt, unit: data.unit, left, right, unitX: W - PAD }))

  const ns = rows.map((r) => r.values.length)
  const nMin = Math.min(...ns)
  const nMax = Math.max(...ns)
  const countText = nMin === nMax ? tr(lang, `各 ${num(nMin)} 件`, `${num(nMin)} each`) : tr(lang, `${num(nMin)}〜${num(nMax)} 件`, `n = ${num(nMin)}–${num(nMax)}`)
  parts.push(text(PAD, H - 4, countText, { size: TICK, fill: pal.sub }))
  const how = fitText([
    tr(lang, '山＝密度（全部の行で同じ尺度）・点線＝中央値', 'Hill = density (one scale for every row), dashed = median'),
    tr(lang, '山＝密度・点線＝中央値', 'Hill = density, dashed = median'),
  ], W - 2 * PAD - textWidth(countText, TICK) - 16)
  parts.push(text(W - PAD, H - 4, how, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 直近 7 日の応答時間（ミリ秒）。look の見本と同じ種・同じ式（1 日 300 回の対数正規・金曜だけ 30% が 380ms の 2 つ目の山）。名前を「10/3（土）」の日付にした
 * @returns {{ groups: { name: string, values: number[] }[], unit: string, highlight: string }}
 */
function sample() {
  const rnd = seeded(20261031)
  const normal = normalOf(rnd)
  /** @type {{ date: string, median: number, slow?: { share: number, median: number } }[]} */
  const days = [
    { date: '2026-10-03', median: 168 },
    { date: '2026-10-04', median: 160 },
    { date: '2026-10-05', median: 212 },
    { date: '2026-10-06', median: 198 },
    { date: '2026-10-07', median: 205 },
    { date: '2026-10-08', median: 221 },
    { date: '2026-10-09', median: 214, slow: { share: 0.3, median: 380 } },
  ]
  const groups = days.map((day) => {
    /** @type {number[]} */
    const values = []
    for (let i = 0; i < 300; i++) {
      const slow = day.slow && rnd() < day.slow.share
      const m = slow ? /** @type {{ median: number }} */ (day.slow).median : day.median
      values.push(round(m * Math.exp((slow ? 0.1 : 0.3) * normal()), 0))
    }
    return { name: dateLabel(day.date, 'ja', 'mdw'), values: values.sort((p, q) => p - q) }
  })
  return { groups, unit: 'ms', highlight: groups[groups.length - 1].name }
}

export default {
  id: 'ridgeline',
  title: 'リッジライン図（Ridgeline plot）',
  category: 'spread',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {RidgeData} */ data) => Math.round(PLOT_TOP + (Math.max(1, data?.rows?.length ?? 7) - 1 + PEAK_PER_PITCH) * ROW_PITCH + BOTTOM_FROM_BOTTOM),
  sample,
}
