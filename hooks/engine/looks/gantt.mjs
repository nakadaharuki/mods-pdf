// @ts-check
// gantt（工程表）: タスクごとに 1 行・日付の横軸に棒を置く。棒は高さ 8pt・角 2pt で、終わった分は墨の 55%・残りは薄い道（墨の 14%）。先行する作業（after）の終わりから後続の始まりへ、
// 墨の 35% の 1pt の肘の線（始まりの 6pt 手前で曲がる）を引き、棒より先に描くので棒が上に載る。今日は目立たせる 1 つ（縦の点線と「今日」の字）。
// 元は look の designs/gantt.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 棒は 8pt・角 2pt・終わった分は墨の 55% で薄い道の上・つなぎの線は 1pt の肘で墨の 35%・今日の線は棒の上まで通す・名前は左の列。
//
// 紙に写して変えた所
// - 暗い地は塗らない。日の縦の線は元で墨の 8% の 1px だったが、紙では細い線の下限（18%）まで持ち上がるので 0.5pt にして重く見えないようにした。今日の線は accent（mono は墨 100%）の点線。
// - 軸は日付（YYYY-MM-DD）。横の幅で字の間隔を変える: 1 日が 14pt 以上なら毎日（日の数字・月の最初の日は「10/1」）・1 週が 28pt 以上なら月曜ごと（「10/12」）・それより細ければ月の最初の日（「10月」）。
// - データは tasks（name・start・end・group?・done?・after?）と today?。done は 0〜1 の終わった割合で、1 つも無ければ棒は全部 55% の 1 色。after は先行するタスクの名前。
//   group が変わる所に、小さな見出しの行（sub の字）を足す。today が期間の中にある時だけ今日の線を引く（今の時刻は読まない）。
// - 元の 14 日・7 タスクの固定をやめ、タスクは 40 まで。行の高さは 14〜34pt（元は 28pt）で、渡された高さに入れる。
// 選ばなかった案
// - 後続が先行より先に始まるつなぎも肘で引く案: 終わりから始まりへ戻る線は他の棒を貫く。つなぎは「後続が先行の終わりより後に始まる」時だけ引く。
// - 期間に今日が入らない時に、軸を伸ばして今日を含める案: 期間は data の日付で決める（今日は目印であって範囲ではない）。
import { ALPHA, DASH, TICK, LABEL, fillAttr, seriesColor, inkStroke, hotStroke, strokePath, line, rect, text, svgDoc, empty, tr, nameOf, midline, textWidth, clip, parseYmd, dateLabel, toNum, arr, keep, ymdOfDay, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, group: string, start: number, end: number, done: number | null, after: number }} Task */
/** @typedef {{ tasks: Task[], min: number, max: number, today: number, groups: number, anyDone: boolean }} GanttData start・end・min・max・today は 1970-01-01 からの日数（today が無ければ NaN）・after は先行の番号（無ければ -1） */

const MAX_TASKS = 40
const DAY_MS = 86400000
const HEAD = 34
const FOOT = 22
const GROUP_H = 16
const ROW_MIN = 14
const ROW_MAX = 34

/** @param {number} day @param {'ja'|'en'} lang @param {'md'|'ym'|'m'} kind */
const labelOfDay = (day, lang, kind) => dateLabel(ymdOfDay(day).iso, lang, kind)

/**
 * @param {unknown} data { tasks: { name, start, end, group?, done?, after? }[], today?: 'YYYY-MM-DD' }
 * @returns {{ data: GanttData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.tasks)) warnings.push('工程表: tasks（{ name, start, end } の列）がありません')
  /** @type {Task[]} */
  const tasks = []
  /** @type {string[]} */
  const afterNames = []
  let badDate = 0
  let swapped = 0
  let badDone = 0
  for (const [i, t] of keep(arr(src.tasks), MAX_TASKS, warnings, '工程表: タスク').entries()) {
    const s = parseYmd(t && t.start)
    const e = parseYmd(t && t.end)
    if (!s || !e) { badDate++; continue }
    let done = null
    if (t.done !== undefined && t.done !== null) {
      const d = toNum(t.done)
      if (d >= 0 && d <= 1) done = d
      else { badDone++; done = Number.isNaN(d) ? null : Math.min(1, Math.max(0, d)) }
    }
    if (e.day < s.day) swapped++
    tasks.push({ name: nameOf(t.name) || String(i + 1), group: nameOf(t.group), start: Math.min(s.day, e.day), end: Math.max(s.day, e.day), done, after: -1 })
    afterNames.push(nameOf(t.after))
  }
  if (badDate) warnings.push(`工程表: start・end が YYYY-MM-DD の日付でないタスク ${badDate} 個を捨てました`)
  if (swapped) warnings.push(`工程表: end が start より前のタスク ${swapped} 個は、前後を入れ替えました`)
  if (badDone) warnings.push(`工程表: done が 0〜1 の数でないタスク ${badDone} 個は、0〜1 に収めました`)
  let unknownAfter = 0
  tasks.forEach((t, i) => {
    if (!afterNames[i]) return
    const j = tasks.findIndex((o, k) => k !== i && o.name === afterNames[i])
    if (j < 0) unknownAfter++
    else t.after = j
  })
  if (unknownAfter) warnings.push(`工程表: after が他のタスクの名前でないタスク ${unknownAfter} 個は、つなぎの線を引きません`)
  let today = NaN
  if (src.today !== undefined && src.today !== null) {
    const t = parseYmd(src.today)
    if (t) today = t.day
    else warnings.push('工程表: today が YYYY-MM-DD の日付ではないので、今日の線を引きません')
  }
  const min = tasks.length ? Math.min(...tasks.map((t) => t.start)) : 0
  const max = tasks.length ? Math.max(...tasks.map((t) => t.end)) : 0
  let groups = 0
  tasks.forEach((t, i) => { if (t.group && (i === 0 || t.group !== tasks[i - 1].group)) groups++ })
  return { data: { tasks, min, max, today: today >= min && today <= max ? today : NaN, groups, anyDone: tasks.some((t) => t.done !== null) }, warnings }
}

/**
 * 行の高さ。14〜34pt。高さを渡せばそれに入れる
 * @param {number} n @param {number} groups @param {number} [H]
 */
const rowPitch = (n, groups, H) => (H === undefined ? 28 : Math.max(ROW_MIN, Math.min(ROW_MAX, (H - HEAD - FOOT - groups * GROUP_H) / n)))

/**
 * 横軸の目盛り。lx は字の中心・tx は縦の線と短い印の位置
 * @param {GanttData} data @param {number} x0 @param {number} dayW @param {'ja'|'en'} lang
 * @returns {{ lx: number, tx: number, s: string }[]}
 */
function axisTicks(data, x0, dayW, lang) {
  /** @type {{ lx: number, tx: number, s: string }[]} */
  const out = []
  const days = data.max - data.min + 1
  if (dayW >= 14) {
    for (let i = 0; i < days; i++) {
      const { d } = ymdOfDay(data.min + i)
      out.push({ lx: x0 + (i + 0.5) * dayW, tx: x0 + i * dayW, s: i === 0 || d === 1 ? labelOfDay(data.min + i, lang, 'md') : String(d) })
    }
    return out
  }
  if (dayW * 7 >= 28) {
    for (let day = data.min; day <= data.max; day++) {
      if (ymdOfDay(day).mon === 0) out.push({ lx: x0 + (day - data.min) * dayW, tx: x0 + (day - data.min) * dayW, s: labelOfDay(day, lang, 'md') })
    }
    return out
  }
  // 月の最初の日。字の間が 44pt 以上になるよう、何か月おきに置くかを決める
  const first = ymdOfDay(data.min)
  const step = Math.max(1, Math.ceil(44 / Math.max(1e-6, dayW * 30.4)))
  let k = 0
  for (let y = first.y, m = first.m; Date.UTC(y, m - 1, 1) / DAY_MS <= data.max; m++, k++) {
    const day = Date.UTC(y, m - 1, 1) / DAY_MS
    if (day >= data.min && k % step === 0) out.push({ lx: x0 + (day - data.min) * dayW, tx: x0 + (day - data.min) * dayW, s: labelOfDay(day, lang, m === 1 || !out.length ? 'ym' : 'm') })
    if (m === 12) { y++; m = 0 }
  }
  return out
}

/**
 * @param {GanttData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const tasks = data.tasks
  if (!tasks.length) return empty(o)
  const n = tasks.length
  const rowP = rowPitch(n, data.groups, H)
  const bodyH = n * rowP + data.groups * GROUP_H
  const top = HEAD + Math.max(0, (H - HEAD - FOOT - bodyH) / 2)
  const nameW = Math.min(W * 0.3, Math.max(...tasks.map((t) => textWidth(t.name, LABEL)), textWidth(tr(lang, 'タスク', 'Task'), TICK)))
  const x0 = 4 + nameW + 12
  const plotR = W - 8
  const days = data.max - data.min + 1
  const dayW = (plotR - x0) / days
  const dayX = (/** @type {number} */ day) => x0 + (day - data.min) * dayW

  // 行の位置（group が変わる所に見出しの行を挟む）
  /** @type {number[]} */
  const cys = []
  /** @type {{ y: number, s: string }[]} */
  const headings = []
  let y = top
  tasks.forEach((t, i) => {
    if (t.group && (i === 0 || t.group !== tasks[i - 1].group)) {
      headings.push({ y: y + GROUP_H - 4, s: t.group })
      y += GROUP_H
    }
    cys.push(y + rowP / 2)
    y += rowP
  })
  const bottom = y

  /** @type {string[]} */
  const parts = []
  // 見出しの行: 日の字・短い印・縦の線（軸の線は日付の字の下の 1 本だけ）
  const headY = 22
  parts.push(text(4, headY, tr(lang, 'タスク', 'Task'), { size: TICK, fill: pal.sub }))
  let labelEnd = -Infinity
  for (const t of axisTicks(data, x0, dayW, lang)) {
    const w = textWidth(t.s, TICK)
    const cx = Math.min(W - 2 - w / 2, Math.max(2 + w / 2, t.lx))
    parts.push(line(t.tx, headY + 4, t.tx, headY + 8, inkStroke(pal, ALPHA.dim, LW.line)))
    parts.push(line(t.tx, headY + 8, t.tx, bottom, inkStroke(pal, ALPHA.faint, LW.hair)))
    if (cx - w / 2 >= labelEnd + 3) {
      parts.push(text(cx, headY, t.s, { size: TICK, fill: pal.sub, anchor: 'middle' }))
      labelEnd = cx + w / 2
    }
  }
  parts.push(line(dayX(data.max + 1), headY + 4, dayX(data.max + 1), headY + 8, inkStroke(pal, ALPHA.dim, LW.line)))
  parts.push(line(dayX(data.max + 1), headY + 8, dayX(data.max + 1), bottom, inkStroke(pal, ALPHA.faint, LW.hair)))
  parts.push(line(4, headY + 8, dayX(data.max + 1), headY + 8, inkStroke(pal, ALPHA.faint, LW.hair)))
  for (const h of headings) parts.push(text(4, h.y, clip(h.s, TICK, nameW + 8), { size: TICK, fill: pal.sub, bold: true }))

  // つなぎの線を先に描き、棒がその上に載る
  tasks.forEach((t, i) => {
    if (t.after < 0) return
    const x1 = dayX(tasks[t.after].end + 1) - 1
    const x2 = dayX(t.start) + 1
    if (x2 - x1 < 4) return
    const bend = Math.max(x1 + 2, x2 - 6)
    parts.push(strokePath(`M${x1.toFixed(2)} ${cys[t.after].toFixed(2)}H${bend.toFixed(2)}V${cys[i].toFixed(2)}H${x2.toFixed(2)}`, inkStroke(pal, ALPHA.last, LW.line)))
  })
  tasks.forEach((t, i) => {
    const bx = dayX(t.start) + 1
    const bw = Math.max(2, (t.end - t.start + 1) * dayW - 2)
    const by = cys[i] - 4
    const bar = seriesColor(pal, 1, 0) ?? pal.ink
    const colored = seriesColor(pal, 1, 0) !== null
    if (!data.anyDone) parts.push(rect(bx, by, bw, 8, fillAttr(bar, colored ? 0.85 : ALPHA.body), 'rx="2"'))
    else {
      parts.push(rect(bx, by, bw, 8, fillAttr(bar, colored ? 0.3 : ALPHA.track), 'rx="2"'))
      if (t.done) parts.push(rect(bx, by, Math.max(2, bw * t.done), 8, fillAttr(bar, colored ? 0.85 : ALPHA.body), 'rx="2"'))
    }
    parts.push(text(4, midline(cys[i], LABEL), clip(t.name, LABEL, nameW), { size: LABEL, fill: pal.ink }))
  })

  // 今日: 点線が棒の上まで通り、下に「今日」
  if (Number.isFinite(data.today)) {
    const tx = dayX(data.today) + dayW / 2
    parts.push(line(tx, headY + 6, tx, bottom, hotStroke(pal, 1, LW.line, 1, DASH.ref)))
    parts.push(text(tx, H - 4, tr(lang, '今日', 'Today'), { size: TICK, fill: pal.accent, anchor: 'middle' }))
  }
  parts.push(text(4, H - 4, tr(lang, `${n} 件・${days} 日間`, `${n} tasks, ${days} days`), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 7 タスク・14 日（日の番号を 2026 年 10 月 1 日からの日付に直した）。名前を紙の工程に合う物にした。今日は 10/6 */
function sample() {
  return {
    tasks: [
      { name: '企画', start: '2026-10-01', end: '2026-10-02', done: 1 },
      { name: '調査', start: '2026-10-04', end: '2026-10-06', done: 1, after: '企画' },
      { name: '試作', start: '2026-10-04', end: '2026-10-07', done: 0.6, after: '企画' },
      { name: '設計', start: '2026-10-10', end: '2026-10-12', done: 0.4, after: '調査' },
      { name: '製造', start: '2026-10-09', end: '2026-10-12', done: 0.2, after: '試作' },
      { name: '検査', start: '2026-10-14', end: '2026-10-14', done: 0, after: '製造' },
      { name: '資料作成', start: '2026-10-05', end: '2026-10-08', done: 0 },
    ],
    today: '2026-10-06',
  }
}

export default {
  id: 'gantt',
  title: '工程表（Gantt chart）',
  category: 'work',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {GanttData | undefined} */ data) => {
    const n = Math.max(1, data?.tasks?.length ?? 7)
    const groups = data?.groups ?? 0
    return Math.round(HEAD + FOOT + groups * GROUP_H + n * rowPitch(n, groups))
  },
  sample,
}
