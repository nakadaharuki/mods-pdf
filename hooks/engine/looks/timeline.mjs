// @ts-check
// timeline（時刻の並び）: 1 本の時計の軸の上に、実際の時刻の位置で印を置く。元は 1 つの作業の 40 の手番を、時刻の位置の 2pt の縦棒で描いた物（道具を続けて使う所は櫛のように詰まり、人が読んでいる間は空く）。
// 紙では、期間（start・end）を持つ印を「棒」にして、レーン（lane）ごとの行に並べる。期間が 0 の印は元と同じ 2pt の縦棒。軸の線は引かず、下の短い印と時刻の字だけ。目立たせる 1 つ（highlight）は縦の点線と accent の字。
// 元は look の designs/session-timeline.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり）: 印は実際の時刻の位置・最小の幅は 2pt・棒は墨の 55%（candle の本体と同じ）・軸の線を引かず短い印（4pt）と時刻の字だけ・
// 目立たせるのは 1 つだけで、縦の点線と字（元は /compact）・上に期間の長さと件数。
//
// 紙に写して変えた所
// - 暗い地は塗らない。目立たせる 1 つは accent の 55%（mono は墨の 80%。paper の monoArea）の棒と、accent（mono は墨 100%）の点線・字。
// - 元の「棒の高さ = 送った文脈の大きさ」「プロンプトの点」「エラーの赤い棒」は、この形の data（lane・start・end・label）に無い物なので描かない。レーンを分けて行にし、重なる期間は行の中で段に分ける（段は 3 まで）。
// - 時刻は「HH:MM」か分の数（時計の軸）・「YYYY-MM-DD」か「YYYY-MM-DD HH:MM」（日付の軸）。日付だけの印は終わりの日の終わりまで。1 つの図に 2 種類を混ぜない（最初の種類に合わせ、違う物は捨てて warnings に書く）。
// - 字は棒の上に置く（棒の上に字を置くと mono で読めない）。次の棒までの幅に入らない字は「…」で切り、14pt に満たなければ置かない。
// 選ばなかった案
// - 棒の高さに値を割り当てる案: 元の「文脈の大きさ」のような値は data に無い。紙の読み手に必要な「いつ・どのくらい・何を」だけを描く。
// - 印が多い時に軸を間引く案: 印は 300 まで（超える分は捨てて warnings に書く）。軸の字は 46pt 以上離れる間隔だけ置く。
import { ALPHA, DASH, TICK, LABEL, inkFill, seriesFill, inkStroke, hotFill, hotStroke, text, line, rect, svgDoc, empty, tr, nameOf, textWidth, clip, hm, duration, parseYmd, dateLabel, arr, keep, num, ymdOfDay, LW, hero, wrapsTwoRows } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ lane: number, row: number, s: number, e: number, label: string, hot: boolean }} Span */
/** @typedef {{ spans: Span[], lanes: { name: string, rows: number }[], abs: boolean, dateOnly: boolean, t0: number, t1: number }} TimelineData s・e・t0・t1 は分（時計の軸は 0 時から・日付の軸は 1970-01-01 から） */

const MAX_SPANS = 300
const MAX_LANES = 12
const MAX_ROWS = 3
const DAY_MIN = 1440
const TOP = 34
const BOTTOM = 30
const SUB_H = 22
const LANE_PAD = 6
const BAR_H = 9
/** 軸の字の間隔の候補（分）。1 分から 1 年まで */
const STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 360, 720, 1440, 2880, 7200, 14400, 43200, 129600, 259200, 525600, 1051200]

/**
 * 時刻の値を分にする。「HH:MM」（47 時台まで）・0 以上の数（0 時からの分）は時計の軸、「YYYY-MM-DD」と「YYYY-MM-DD HH:MM」は日付の軸
 * @param {unknown} v
 * @returns {{ t: number, abs: boolean, dateOnly: boolean } | null}
 */
function parseTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v < 100000 ? { t: v, abs: false, dateOnly: false } : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (clock) return Number(clock[1]) < 48 && Number(clock[2]) < 60 ? { t: Number(clock[1]) * 60 + Number(clock[2]), abs: false, dateOnly: false } : null
  const full = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s)
  if (!full) return null
  const ymd = parseYmd(full[1])
  if (!ymd) return null
  const hh = full[2] === undefined ? 0 : Number(full[2])
  const mm = full[3] === undefined ? 0 : Number(full[3])
  if (hh > 23 || mm > 59) return null
  return { t: ymd.day * DAY_MIN + hh * 60 + mm, abs: true, dateOnly: full[2] === undefined }
}

/**
 * @param {unknown} data { spans: { lane?, start, end, label, highlight? }[] }
 * @returns {{ data: TimelineData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.spans)) warnings.push('時刻の並び: spans（{ lane?, start, end, label } の列）がありません')
  /** @type {boolean | null} */
  let abs = null
  let badTime = 0
  let mixed = 0
  let swapped = 0
  let hotSeen = false
  /** @type {string[]} */
  const laneNames = []
  /** @type {{ lane: string, s: number, e: number, label: string, hot: boolean }[]} */
  const rows = []
  let dateOnlyAll = true
  for (const sp of keep(arr(src.spans), MAX_SPANS, warnings, '時刻の並び: 印')) {
    const a = parseTime(sp && sp.start)
    const b = parseTime(sp && sp.end)
    if (!a || !b) { badTime++; continue }
    if (abs === null) abs = a.abs
    if (a.abs !== abs || b.abs !== abs) { mixed++; continue }
    let s = a.t
    let e = b.t
    if (e < s) { swapped++; [s, e] = [e, s] }
    if (a.dateOnly && b.dateOnly) e += DAY_MIN
    else dateOnlyAll = false
    const lane = nameOf(sp.lane)
    if (!laneNames.includes(lane)) laneNames.push(lane)
    const hot = sp.highlight === true && !hotSeen
    if (hot) hotSeen = true
    rows.push({ lane, s, e, label: nameOf(sp.label), hot })
  }
  if (badTime) warnings.push(`時刻の並び: start・end が「HH:MM」か「YYYY-MM-DD（ HH:MM）」でない印 ${badTime} 個を捨てました`)
  if (mixed) warnings.push(`時刻の並び: 最初の印と違う種類（時計と日付）の時刻の印 ${mixed} 個を捨てました`)
  if (swapped) warnings.push(`時刻の並び: end が start より前の印 ${swapped} 個は、前後を入れ替えました`)
  const lanes = keep(laneNames, MAX_LANES, warnings, '時刻の並び: レーン').map((name) => ({ name, rows: 1 }))
  const spans = /** @type {Span[]} */ ([])
  // レーンごとに、始まりの順に並べて、重ならない段へ（段は 3 まで・それより多い重なりは最後の段に重ねる）
  lanes.forEach((ln, li) => {
    /** @type {number[]} 段ごとの、そこにある最後の印の終わり */
    const ends = []
    for (const r of rows.filter((x) => x.lane === ln.name).sort((x, y) => x.s - y.s || x.e - y.e)) {
      let row = ends.findIndex((end) => r.s >= end)
      if (row < 0) row = Math.min(ends.length, MAX_ROWS - 1)
      ends[row] = Math.max(ends[row] ?? -Infinity, r.e)
      spans.push({ lane: li, row, s: r.s, e: r.e, label: r.label, hot: r.hot })
    }
    ln.rows = Math.max(1, ends.length)
  })
  let t0 = spans.length ? Math.min(...spans.map((x) => x.s)) : 0
  let t1 = spans.length ? Math.max(...spans.map((x) => x.e)) : 0
  if (spans.length && t1 === t0) { const pad = abs ? DAY_MIN : 30; t0 -= pad; t1 += pad }
  return { data: { spans, lanes, abs: abs === true, dateOnly: dateOnlyAll && abs === true, t0, t1 }, warnings }
}

/** レーンごとの高さ（段の数 x 22pt + 6pt） @param {TimelineData} data */
function laneHeights(data) {
  return data.lanes.map((ln) => ln.rows * SUB_H + LANE_PAD)
}

/** 1 本の軸に並べた時の自然な高さ @param {TimelineData | undefined} data */
function naturalHeight(data) {
  return Math.round(TOP + BOTTOM + (data && data.lanes.length ? laneHeights(data).reduce((s, h) => s + h, 0) : 3 * (SUB_H + LANE_PAD)))
}

/**
 * @param {TimelineData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  if (!data.spans.length) return empty(o)
  const named = data.lanes.length > 1 || data.lanes[0].name !== ''
  const nameW = named ? Math.min(W * 0.22, Math.max(...data.lanes.map((l) => textWidth(l.name, LABEL)))) : 0
  const x0 = 4 + (named ? nameW + 10 : 0)
  const plotR = W - 8
  const span = data.t1 - data.t0
  const heights = laneHeights(data)
  const total = heights.reduce((s, h) => s + h, 0)
  /** @type {string[]} */
  const parts = []

  // 見出し: 全体の長さと件数
  const lenText = data.abs && span >= 2 * DAY_MIN ? tr(lang, `${num(Math.round(span / DAY_MIN))} 日間`, `${num(Math.round(span / DAY_MIN))} days`) : duration(span, lang)
  parts.push(hero(lenText, tr(lang, `${num(data.spans.length)} 件`, `${num(data.spans.length)} items`), pal, 4, 18, W - 4))

  // 印が 5 つ以上で箱が自然な高さの 2 倍以上なら、時間を前半・後半に分けて 2 本の軸に折り返す（軸が倍の幅になり、字を「…」で切らない）
  const two = wrapsTwoRows(data.spans.length, H, naturalHeight(data))
  const bands = two ? [[data.t0, data.t0 + span / 2], [data.t0 + span / 2, data.t1]] : [[data.t0, data.t1]]
  const bandH = (H - TOP) / bands.length
  bands.forEach(([t0, t1], b) => {
    const top = TOP + b * bandH + Math.max(0, (bandH - BOTTOM - total) / 2)
    band(parts, { t0, t1, top, from: TOP + b * bandH }, { data, heights, named, nameW, x0, plotR, W, pal, lang })
  })
  return svgDoc(W, H, parts.join(''))
}

/**
 * 時間の範囲 [t0, t1] を 1 本の軸に描く（レーンの名前・棒・字・目立たせる縦線・軸）。範囲をまたぐ印は両方の軸に、その範囲の分だけ描く
 * @param {string[]} parts @param {{ t0: number, t1: number, top: number, from: number }} r
 * @param {{ data: TimelineData, heights: number[], named: boolean, nameW: number, x0: number, plotR: number, W: number, pal: any, lang: 'ja'|'en' }} c
 */
function band(parts, { t0, t1, top, from }, { data, heights, named, nameW, x0, plotR, W, pal, lang }) {
  const x = (/** @type {number} */ t) => x0 + ((t - t0) / (t1 - t0)) * (plotR - x0)
  /** @type {number[]} */
  const laneTop = []
  let y = top
  heights.forEach((h, i) => { laneTop.push(y); y += h })
  const bottom = y
  data.lanes.forEach((ln, i) => {
    if (named) parts.push(text(4, laneTop[i] + SUB_H - 4, clip(ln.name, LABEL, nameW), { size: LABEL, fill: pal.sub }))
  })
  const inBand = (/** @type {Span} */ sp) => (sp.e > sp.s ? sp.e > t0 && sp.s < t1 : sp.s >= t0 && sp.s <= t1)
  data.lanes.forEach((ln, li) => {
    for (let j = 0; j < ln.rows; j++) {
      const inRow = data.spans.filter((sp) => sp.lane === li && sp.row === j && inBand(sp)).sort((a, b) => a.s - b.s)
      inRow.forEach((sp, k) => {
        const sx = x(Math.max(sp.s, t0))
        // 隣り合う棒が 1 本に見えないよう、右の端を 1pt 空ける
        const bw = Math.max(2, x(Math.min(sp.e, t1)) - sx - 1)
        const subTop = laneTop[li] + j * SUB_H
        parts.push(rect(sx, subTop + SUB_H - 2 - BAR_H, bw, BAR_H, sp.hot ? hotFill(pal, ALPHA.body) : seriesFill(pal, li + 1, 0, 0.85) ?? inkFill(pal, ALPHA.body)))
        const limit = (k + 1 < inRow.length ? x(Math.max(inRow[k + 1].s, t0)) : plotR) - sx - 4
        const room = Math.min(limit, W - 4 - sx) - (sp.hot ? 4 : 0)
        const label = clip(sp.label, TICK, room)
        if (sp.label && room >= 14) parts.push(text(sp.hot ? sx + 4 : sx, subTop + SUB_H - 2 - BAR_H - 3, label, { size: TICK, fill: sp.hot ? pal.accent : pal.ink, bold: sp.hot }))
      })
    }
  })
  const hot = data.spans.find((sp) => sp.hot && inBand(sp) && sp.s >= t0)
  if (hot) parts.push(line(x(hot.s), from - 4, x(hot.s), bottom, hotStroke(pal, 1, LW.line, 1, DASH.ref)))

  // 軸: 軸の線は引かず、4pt の印と時刻の字だけ。最初の時刻を左端に置き、字は 46pt 以上離す
  const ppm = (plotR - x0) / (t1 - t0)
  const step = STEPS.find((s) => s * ppm >= 46) ?? STEPS[STEPS.length - 1]
  const axisY = bottom + 4
  const stamp = (/** @type {number} */ t) => (step >= DAY_MIN ? dateLabel(ymdOfDay(Math.floor(t / DAY_MIN)).iso, lang, step >= 43200 ? 'ym' : 'md') : hm(t))
  /** @type {{ t: number, anchor: 'start'|'middle' }[]} */
  const marks = [{ t: t0, anchor: 'start' }]
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) if (t !== t0) marks.push({ t, anchor: 'middle' })
  let labelEnd = -Infinity
  for (const m of marks) {
    const s = stamp(m.t)
    const w = textWidth(s, TICK)
    const left = m.anchor === 'start' ? x(m.t) : x(m.t) - w / 2
    if (left < labelEnd + 6 || left + w > W - 2) continue
    parts.push(line(x(m.t), axisY, x(m.t), axisY + 4, inkStroke(pal, ALPHA.dim, LW.line)))
    parts.push(text(m.anchor === 'start' ? left : x(m.t), axisY + 14, s, { size: TICK, fill: pal.sub, anchor: m.anchor }))
    labelEnd = left + w
  }
}

/** 元の見本の長さ（14:02 から 15:08 の 66 分）に合わせた、障害対応の経過。3 つのレーンで、期間が 0 の印（一報・中間報告）は 2pt の縦棒 */
function sample() {
  return {
    spans: [
      { lane: '検知', start: '14:02', end: '14:09', label: 'アラート' },
      { lane: '検知', start: '14:09', end: '14:15', label: '一次調査' },
      { lane: '対応', start: '14:15', end: '14:42', label: '原因の調査' },
      { lane: '対応', start: '14:42', end: '14:48', label: '設定を戻す' },
      { lane: '対応', start: '14:48', end: '15:01', label: '再起動と確認' },
      { lane: '対応', start: '15:01', end: '15:08', label: '復旧を確認', highlight: true },
      { lane: '連絡', start: '14:10', end: '14:10', label: '一報' },
      { lane: '連絡', start: '14:30', end: '14:30', label: '中間報告' },
      { lane: '連絡', start: '15:02', end: '15:08', label: '復旧の連絡' },
    ],
  }
}

export default {
  id: 'timeline',
  title: '時刻の並び（Timeline）',
  category: 'work',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {TimelineData | undefined} */ data) => naturalHeight(data),
  sample,
}
