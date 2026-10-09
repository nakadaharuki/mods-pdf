// @ts-check
// calendar-month（月のカレンダー）: 1 か月を月曜から始まる格子にする。升は墨の 8% の面（線でなく 2pt の隙間で分けるので枠が無い）・週末の日付は薄く（紙では sub）して平日を先に読ませる。
// 1 日に最大 3 つの点（r=2）を、種類ごとの決まった位置に置く（欠けた点が「その種類が無い」と読める）。種類ごとの濃さは墨の 85%・65%・42%。凡例は種類ごとの月の件数で、合計も同じ日から数える。今日は目立たせる 1 つ（枠と日付）。
// 元は look の designs/calendar-month.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 月は 7 列の格子で、1 日の曜日の分だけ前を空ける・升は面と 2pt の隙間・点は 1 日に種類ごとの位置で最大 3 つ・
// 凡例の件数と合計は日から数える（点と食い違わない）・今日だけ accent。
//
// 紙に写して変えた所
// - 暗い地は塗らない。升の 8% は paper の塗りの下限と同じ。週末の日付の 42% の墨は、字を半透明にできない（paper の約束）ので pal.sub の字にする。今日の枠は 1pt（mono は墨 100%）。
// - 点の種類は data の events の label。初めて出た順に 3 つまでを位置に割り当て、4 種類以上ある時は 4 つ目を「その他」に集める（点の濃さは墨の 85・65・42・25%）。
// - 升の幅は版面の幅で決める（元は 49px 固定）。高さは月の週数（4〜6）と渡された高さから 26〜46pt。
// - 元の「SAMPLE EVENTS BY DAY」は下の左に「日ごとのイベント」。右に合計。月の名前は左上に 8pt の太字（元は muted の 9px）。
// 選ばなかった案
// - 1 日に同じ種類が何件もある時に点を重ねて数を表す案: 元は「その種類があるか」だけ。件数は凡例の月の合計で読める。
// - 今日を現在の時刻から決める案: 同じ入力で同じ絵にならない。data.today を渡した時だけ今日を示す。
import { ALPHA, TICK, LABEL, fillAttr, inkFill, hotStroke, circle, text, rect, legend, svgDoc, empty, num, tr, nameOf, midline, parseYm, parseYmd, dateLabel, weekday, arr, keep, clip, seeded, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ month: string, y: number, m: number, days: number, firstMon: number, kinds: string[], other: number, byDay: number[][], counts: number[], today: number }} CalData  kinds は種類の名前（空は「イベント」）・other は「その他」に集めた位置（無ければ -1） */

const MAX_EVENTS = 1000
const MAX_KINDS = 4
const GAP = 2
const X0 = 4
const Y0 = 40
const FOOT = 22
/** 種類ごとの点の濃さ（位置の順） */
const DOT_ALPHA = [ALPHA.heavy, ALPHA.strong, ALPHA.dim, ALPHA.area]

/**
 * @param {unknown} data { month: 'YYYY-MM', events: { date, label }[], today?: 'YYYY-MM-DD' }
 * @returns {{ data: CalData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const ym = parseYm(src.month)
  const blank = { month: '', y: 0, m: 0, days: 0, firstMon: 0, kinds: [], other: -1, byDay: [], counts: [], today: 0 }
  if (!ym) {
    warnings.push('月のカレンダー: month が YYYY-MM の月ではありません')
    return { data: blank, warnings }
  }
  if (!Array.isArray(src.events)) warnings.push('月のカレンダー: events（{ date, label } の列）がありません')
  const events = keep(arr(src.events), MAX_EVENTS, warnings, '月のカレンダー: イベント')
  /** @type {string[]} 初めて出た順の種類の名前 */
  const names = []
  /** @type {{ day: number, name: string }[]} */
  const list = []
  let badDate = 0
  let outside = 0
  for (const e of events) {
    const ymd = parseYmd(e && e.date)
    if (!ymd) { badDate++; continue }
    if (ymd.y !== ym.y || ymd.m !== ym.m) { outside++; continue }
    const name = nameOf(e.label)
    if (!names.includes(name)) names.push(name)
    list.push({ day: ymd.d, name })
  }
  if (badDate) warnings.push(`月のカレンダー: date が YYYY-MM-DD の日付でないイベント ${badDate} 件を捨てました`)
  if (outside) warnings.push(`月のカレンダー: month の外の日付のイベント ${outside} 件を捨てました`)
  // 4 種類までは名前のまま。それより多い時は 4 つ目を「その他」に集める
  const merged = names.length > MAX_KINDS
  const kinds = merged ? [...names.slice(0, MAX_KINDS - 1), ''] : names
  const slotOf = (/** @type {string} */ name) => Math.min(names.indexOf(name), kinds.length - 1)
  /** @type {number[][]} */
  const byDay = Array.from({ length: ym.days + 1 }, () => [])
  const counts = kinds.map(() => 0)
  for (const e of list) {
    const k = slotOf(e.name)
    if (!byDay[e.day].includes(k)) byDay[e.day].push(k)
    counts[k]++
  }
  let today = 0
  if (src.today !== undefined && src.today !== null) {
    const t = parseYmd(src.today)
    if (t && t.y === ym.y && t.m === ym.m) today = t.d
    else warnings.push('月のカレンダー: today が month の中の YYYY-MM-DD の日付ではないので、今日の印を付けません')
  }
  return { data: { month: `${ym.y}-${String(ym.m).padStart(2, '0')}`, y: ym.y, m: ym.m, days: ym.days, firstMon: ym.firstMon, kinds, other: merged ? MAX_KINDS - 1 : -1, byDay, counts, today }, warnings }
}

/**
 * 升の大きさ。幅は 7 等分・高さは週数と渡された高さから 26〜46pt
 * @param {number} W @param {number} rows @param {number} [H]
 */
function cellOf(W, rows, H) {
  const cw = (W - 2 * X0 - 6 * GAP) / 7
  const ch = H === undefined ? 33 : Math.max(26, Math.min(46, (H - Y0 - FOOT) / rows - GAP))
  return { cw, ch }
}

/**
 * @param {CalData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.days) return empty(o)
  const rows = Math.ceil((data.firstMon + data.days) / 7)
  const { cw, ch } = cellOf(W, rows, H)
  const natural = Y0 + rows * (ch + GAP) + FOOT
  const top = Y0 + Math.max(0, (H - natural) / 2)
  /** @type {string[]} */
  const parts = []
  parts.push(text(X0, top - 22, dateLabel(data.month, lang, 'ym'), { size: LABEL, fill: pal.ink, bold: true }))
  // 凡例: 種類ごとの点と月の件数（右上）
  const kindName = (/** @type {number} */ k) => (k === data.other ? tr(lang, 'その他', 'Other') : data.kinds[k] || tr(lang, 'イベント', 'Event'))
  const keys = data.kinds.map((_, k) => ({ label: `${clip(kindName(k), TICK, W * 0.2)} ${num(data.counts[k])}`, mark: /** @type {'dot'} */ ('dot'), attr: fillAttr(pal.ink, DOT_ALPHA[k]) }))
  parts.push(legend(W - X0, top - 22, keys, pal, { anchor: 'end' }).svg)
  for (let c = 0; c < 7; c++) parts.push(text(X0 + c * (cw + GAP) + 6, top - 6, weekday((c + 1) % 7, lang).slice(0, 1), { size: TICK, fill: pal.sub }))

  for (let d = 1; d <= data.days; d++) {
    const slot = data.firstMon + d - 1
    const x = X0 + (slot % 7) * (cw + GAP)
    const y = top + Math.floor(slot / 7) * (ch + GAP)
    const weekend = slot % 7 >= 5
    const isToday = d === data.today
    parts.push(rect(x, y, cw, ch, inkFill(pal, ALPHA.faint)))
    if (isToday) parts.push(rect(x + 0.5, y + 0.5, cw - 1, ch - 1, `fill="none" ${hotStroke(pal, 1, LW.line)}`))
    parts.push(text(x + 6, y + 13, String(d), { size: LABEL, fill: isToday ? pal.accent : weekend ? pal.sub : pal.ink, bold: isToday }))
    for (const k of data.byDay[d]) parts.push(circle(x + 8 + k * 7, y + ch - 8, 2, inkFill(pal, DOT_ALPHA[k])))
  }
  const total = data.counts.reduce((s, c) => s + c, 0)
  parts.push(text(X0, midline(H - 8, TICK), tr(lang, '日ごとのイベント', 'Events by day'), { size: TICK, fill: pal.sub }))
  parts.push(text(W - X0, midline(H - 8, TICK), tr(lang, `${num(total)} 件`, `${num(total)} events`), { size: TICK, fill: pal.sub, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（2026 年 10 月・種 20261033・リリース 8・レビュー 14・会議 5）。今日は 10/9 */
function sample() {
  const rnd = seeded(20261033)
  const kinds = [{ name: 'リリース', p: [0.3, 0.06] }, { name: 'レビュー', p: [0.5, 0.06] }, { name: '会議', p: [0.4, 0] }]
  const first = 3
  /** @type {{ date: string, label: string }[]} */
  const events = []
  for (let d = 1; d <= 31; d++) {
    const weekend = (first + d - 1) % 7 >= 5
    kinds.forEach((k) => {
      if (rnd() < k.p[weekend ? 1 : 0]) events.push({ date: `2026-10-${String(d).padStart(2, '0')}`, label: k.name })
    })
  }
  return { month: '2026-10', events, today: '2026-10-09' }
}

export default {
  id: 'calendar-month',
  title: '月のカレンダー（Month calendar）',
  category: 'work',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {CalData | undefined} */ data) => {
    const rows = data && data.days ? Math.ceil((data.firstMon + data.days) / 7) : 5
    return Math.round(Y0 + rows * (cellOf(width, rows).ch + GAP) + FOOT)
  },
  sample,
}
