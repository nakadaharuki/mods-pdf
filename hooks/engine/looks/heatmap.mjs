// @ts-check
// heatmap（日ごとの熱地図）: 週を列・曜日（月曜から）を行にした升の並び。1 つの升は墨の 6%（空いた日）から 85%（最大の日）までの濃さで、空いた日も場所を保つ。
// 最後の日（今日）は目立たせる 1 つで、その日より後の週の残りは枠だけの升（まだ値が無い印で、0 とは読ませない）。
// 元は look の designs/heatmap.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 升の濃さは墨の 0.06 + 0.79 x 比（凡例も同じ階調。紙では paper の shade: 下限 8% から 85% までの同じ直線で、hexbin と同じ尺度）・升の間は 2pt・今日だけ accent の枠・この先の日は枠だけ（墨の 12%）・
// 月の名前は 1 日を含む週の列の上に置く・曜日の字は月・水・金だけ。
//
// 紙に写して変えた所
// - 暗い地は塗らない。空いた日の 6% は paper の塗りの下限 8% に持ち上がる。この先の日の枠は細い線の下限 18%。今日の枠は、mono では墨 100% で升の外側に LW.hot（1.5pt・目立たせる線の太さ）
//   （升の中に入れると墨の濃い升に埋まって見えない）。
// - 升の大きさは版面の幅と週の数で決める（元は 9px 固定）。間隔は最大 16pt。週は 53 まで（これを超える分は古い週から捨てる）。
// - 元の「SAMPLE 26 WEEKS」は、下の左に「26 週間・合計 N」。凡例は右下に「少 ▢▢▢▢▢ 多」。
// 選ばなかった案
// - 値を 5 段に区切って塗る案: 元は連続の濃さで、凡例だけが 5 つ。値の差が埋もれるので連続のまま。
// - 抜けた日を捨てる案: 抜けた日は 0（空いた日）として、場所を保つ。同じ日が複数あれば合計する。
import { ALPHA, TICK, fillAttr, rampColor, inkStroke, hotStroke, rect, text, svgDoc, empty, num, withUnit, tr, midline, textWidth, parseYmd, dateLabel, arr, numOf, seeded, ymdOfDay, shade, shadeLegend, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ week: number, row: number, value: number }} Cell */
/** @typedef {{ cells: Cell[], weeks: number, lastWeek: number, lastRow: number, start: number, total: number, max: number, unit: string }} HeatData */

const MAX_WEEKS = 53
const PITCH_MAX = 16
const X0 = 18
const Y0 = 20
const FOOT = 30
const DAY_MS = 86400000

/**
 * @param {unknown} data { days: { date: 'YYYY-MM-DD', value }[], unit? }（最後の日が今日・日の抜けは 0・同じ日は合計）
 * @returns {{ data: HeatData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.days)) warnings.push('熱地図: days（{ date, value } の列）がありません')
  /** @type {Map<number, number>} */
  const byDay = new Map()
  /** @type {{ y: number, m: number, d: number, dow: number, mon: number, day: number } | null} */
  let first = null
  /** @type {{ y: number, m: number, d: number, dow: number, mon: number, day: number } | null} */
  let last = null
  let badDate = 0
  let badValue = 0
  let dup = 0
  for (const it of arr(src.days)) {
    const ymd = parseYmd(it && it.date)
    if (!ymd) { badDate++; continue }
    const v = numOf(it.value)
    if (!(v >= 0)) { badValue++; continue }
    if (byDay.has(ymd.day)) dup++
    byDay.set(ymd.day, (byDay.get(ymd.day) ?? 0) + v)
    if (!first || ymd.day < first.day) first = ymd
    if (!last || ymd.day > last.day) last = ymd
  }
  if (badDate) warnings.push(`熱地図: date が YYYY-MM-DD の日付でない日 ${badDate} 個を捨てました`)
  if (badValue) warnings.push(`熱地図: value が 0 以上 1,000 兆以下の数でない日 ${badValue} 個を捨てました`)
  if (dup) warnings.push(`熱地図: 同じ日の値 ${dup} 個は合計しました`)
  const unit = typeof src.unit === 'string' ? src.unit : ''
  if (!first || !last) return { data: { cells: [], weeks: 0, lastWeek: 0, lastRow: 0, start: 0, total: 0, max: 1, unit }, warnings }
  // 週は月曜から。最後の日を含む週を最後の列にし、53 週を超えたら古い週を捨てる
  let start = first.day - first.mon
  const lastStart = last.day - last.mon
  if (lastStart - start > (MAX_WEEKS - 1) * 7) {
    start = lastStart - (MAX_WEEKS - 1) * 7
    warnings.push(`熱地図: 週は ${MAX_WEEKS} までなので、古い週を捨てました`)
  }
  const weeks = Math.floor((last.day - start) / 7) + 1
  /** @type {Cell[]} */
  const cells = []
  let total = 0
  let max = 0
  for (let day = start; day <= last.day; day++) {
    const value = byDay.get(day) ?? 0
    cells.push({ week: Math.floor((day - start) / 7), row: (day - start) % 7, value })
    total += value
    if (value > max) max = value
  }
  return { data: { cells, weeks, lastWeek: weeks - 1, lastRow: last.mon, start, total, max: max > 0 ? max : 1, unit }, warnings }
}

/**
 * 升の間隔。幅に収まり、高さを渡せばそれにも収まる（最大 16pt）
 * @param {number} W @param {number} weeks @param {number} [H]
 */
function pitchOf(W, weeks, H) {
  const byW = (W - X0 - 4) / Math.max(1, weeks)
  const byH = H === undefined ? Infinity : (H - Y0 - FOOT) / 7
  return Math.max(4, Math.min(PITCH_MAX, byW, byH))
}

/**
 * @param {HeatData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.cells.length) return empty(o)
  const pitch = pitchOf(W, data.weeks, H)
  const cell = pitch - 2
  const natural = Y0 + 7 * pitch + FOOT
  const top = Y0 + Math.max(0, (H - natural) / 2)
  const start = data.start
  /** @type {string[]} */
  const parts = []

  // 月の名前: 1 日を含む週の列の上（最初の列は、その週の月曜の月）。前の字と重ならない時だけ
  let labelEnd = -Infinity
  for (let w = 0; w < data.weeks; w++) {
    let month = 0
    let year = 0
    for (let k = 0; k < 7; k++) {
      const ymd = ymdOfDay(start + w * 7 + k)
      if (ymd.d === 1) { month = ymd.m; year = ymd.y }
    }
    if (!month && w === 0) {
      const ymd = ymdOfDay(start)
      month = ymd.m
      year = ymd.y
    }
    if (!month) continue
    const x = X0 + w * pitch
    const s = dateLabel(`${year}-${String(month).padStart(2, '0')}`, lang, 'm')
    if (x < labelEnd + 6) continue
    parts.push(text(x, top - 6, s, { size: TICK, fill: pal.sub }))
    labelEnd = x + textWidth(s, TICK) + 2
  }
  const dows = lang === 'en' ? ['M', 'W', 'F'] : ['月', '水', '金']
  dows.forEach((s, k) => parts.push(text(4, midline(top + k * 2 * pitch + cell / 2, TICK), s, { size: TICK, fill: pal.sub })))

  for (const c of data.cells) {
    parts.push(rect(X0 + c.week * pitch, top + c.row * pitch, cell, cell, fillAttr(rampColor(pal), shade(c.value / data.max))))
  }
  // この先の日（最後の週の残り）は枠だけ
  const future = `fill="none" ${inkStroke(pal, ALPHA.grid, LW.line)}`
  for (let row = data.lastRow + 1; row < 7; row++) parts.push(rect(X0 + data.lastWeek * pitch + 0.5, top + row * pitch + 0.5, cell - 1, cell - 1, future))
  // 今日: 升の外側の枠
  parts.push(rect(X0 + data.lastWeek * pitch - 1, top + data.lastRow * pitch - 1, cell + 2, cell + 2, `fill="none" ${hotStroke(pal, 1, LW.hot)}`))

  // 下: 左に週と合計・右に凡例（少 → 多）
  const base = top + 7 * pitch + 14
  const totalText = withUnit(num(data.total, Number.isInteger(data.total) ? 0 : 1), data.unit)
  parts.push(text(4, base + 6, tr(lang, `${data.weeks} 週間・合計 ${totalText}`, `${data.weeks} weeks, total ${totalText}`), { size: TICK, fill: pal.sub }))
  parts.push(shadeLegend(W - 4, base + 6, pal, lang).svg)
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種・同じ数の歩き（26 週・最後は金曜）を、日付つきの来場者数にした。値は 0〜40 の整数
 * @returns {{ days: { date: string, value: number }[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261009)
  const base = Date.UTC(2026, 3, 13)
  /** @type {{ date: string, value: number }[]} */
  const days = []
  for (let w = 0; w < 26; w++) {
    for (let d = 0; d < 7; d++) {
      const idle = rnd() < 0.12
      const busy = d < 5 ? 0.85 : 0.4
      const v = idle ? 0 : Math.min(1, rnd() * busy + (0.15 * w) / 25)
      if (w === 25 && d > 4) continue
      days.push({ date: new Date(base + (w * 7 + d) * DAY_MS).toISOString().slice(0, 10), value: Math.round(v * 40) })
    }
  }
  return { days, unit: '人' }
}

export default {
  id: 'heatmap',
  title: '日ごとの熱地図（Calendar heatmap）',
  category: 'work',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ weeks?: number } | undefined} */ data) => Math.round(Y0 + 7 * pitchOf(width, data?.weeks ?? 26) + FOOT),
  sample,
}
