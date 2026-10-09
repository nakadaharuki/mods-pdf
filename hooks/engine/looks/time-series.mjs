// @ts-check
// time の束の形（sparks・bars・area-threshold・bump・multi-line・stacked-area・step-line・streamgraph）が共有する物。形ではなく部品なので LOOKS には入らない。
// 純な部品（Mods の決まりは docs/design.md の 2 章。ドル記号の直後の点・Node の物・動的な読み込み・タイマーを使わない）。d3 は読まない（d3 を使う形がそれぞれ読む）。
// data の「時系列」の形（docs/looks.md の 3 章）を読む・値の目盛り・下の x の字・欠測のある線の d を持つ。左の目盛り（axisLeft）・見出しの数（hero）・値の桁（decimals）は、ほかの束と同じにするので paper.mjs に上げた。
// 元は look の designs/ の time の束（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）が、それぞれに持っていた読み方と目盛りの、共通の部分。
//
// 選ばなかった案
// - 時系列の形ごとに normalize を書く案: 8 つの形で「数でない値・短い系列・x の数の違い・上限」の扱いがずれる。読み方はここ 1 か所にし、形は読んだ後の列だけを見る。
// - 欠測（数でない値）を 0 に直す案: 折れ線が 0 に落ちて「値が 0 になった」と読める。線は切れ（線・面）、積む形（stacked-area・streamgraph）と棒だけが 0 か空きにする。
// - 下の x の字を最初・真ん中・最後の 3 つだけにする案: 60 日の線で日付が 3 つでは位置が読めない。字の幅から「何点おきなら重ならないか」を決めて等間隔に置く（evenLabels）。
import { TICK, VALUE_MAX, text, f, num, withUnit, textWidth, clip, toNum, nameOf, arr, tickStep, stepDigits, dateLabel } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ name: string, values: number[], unit: string }} Row 値の NaN は欠測 */
/** @typedef {{ x: string[], n: number, rows: Row[], unit: string, threshold: number | null, highlight: number }} TimeData */

/** 1 系列で描く点の上限。版面の幅 440pt に 2 点ずつ。超えたら等間隔に間引いて warnings に書く */
export const POINTS_MAX = 800

/**
 * 時系列の data { x, series: { name, values, unit? }[], unit?, threshold?, highlight? } を読む。
 * 数でない値は欠測（NaN）・長さの違う系列は NaN で足して x と同じ長さにする・数の値が 1 つも無い系列は捨てる。投げず、捨てた物を warnings に書く
 * @param {unknown} data @param {string} what 「複数の折れ線」のような名前 @param {{ max?: number }} [o]
 * @returns {{ data: TimeData, warnings: string[] }}
 */
export function readSeries(data, what, { max = POINTS_MAX } = {}) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const list = arr(src.series)
  if (!list.length) warnings.push(`${what}: series（{ name, values } の列）がありません`)
  /** @type {Row[]} */
  let rows = []
  let dropped = 0
  let bad = 0
  list.forEach((s, i) => {
    const raw = s && typeof s === 'object' ? arr(s.values) : []
    const values = raw.map((v) => {
      const n = toNum(v)
      if (Number.isFinite(n) && Math.abs(n) <= VALUE_MAX) return n
      bad++
      return NaN
    })
    if (!values.some(Number.isFinite)) { dropped++; return }
    rows.push({ name: nameOf(s.name) || `系列 ${i + 1}`, values, unit: typeof s.unit === 'string' ? s.unit : '' })
  })
  if (dropped) warnings.push(`${what}: 数の値が 1 つも無い系列 ${dropped} 本を描きません`)
  if (bad) warnings.push(`${what}: 数でない（か 1,000 兆を超える）値 ${bad} 個を欠測にしました`)
  let n = Math.max(0, ...rows.map((r) => r.values.length))
  /** @type {string[]} */
  let x = arr(src.x).map((v) => (v === undefined || v === null ? '' : String(v)))
  if (x.length && x.length !== n && rows.length) warnings.push(`${what}: x の数（${x.length}）と値の数（${n}）が違います。足りない所は空にし、多い x は使いません`)
  rows = rows.map((r) => ({ ...r, values: r.values.length < n ? [...r.values, ...Array(n - r.values.length).fill(NaN)] : r.values }))
  if (n > max) {
    const k = Math.ceil(n / max)
    const pick = (/** @type {any[]} */ a) => a.filter((_, i) => i % k === 0)
    warnings.push(`${what}: 点が ${num(n)} 個あり ${num(max)} 個を超えるので、${k} 点に 1 点だけ描きます`)
    rows = rows.map((r) => ({ ...r, values: pick(r.values) }))
    x = pick(x)
    n = Math.ceil(n / k)
  }
  while (x.length < n) x.push('')
  x = x.slice(0, n)
  const threshold = toNum(src.threshold)
  if (src.threshold !== undefined && src.threshold !== null && !Number.isFinite(threshold)) warnings.push(`${what}: threshold が数でないので使いません`)
  const wanted = nameOf(src.highlight)
  const highlight = wanted ? rows.findIndex((r) => r.name === wanted) : -1
  if (wanted && highlight < 0) warnings.push(`${what}: highlight「${wanted}」という名前の系列がありません`)
  return { data: { x, n, rows, unit: typeof src.unit === 'string' ? src.unit : '', threshold: Number.isFinite(threshold) ? threshold : null, highlight }, warnings }
}

/** 最後の数の値の番号（無ければ -1） @param {number[]} values */
export function lastIndex(values) {
  for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return i
  return -1
}

/** 数の値だけの列 @param {number[]} values */
export const finite = (values) => values.filter(Number.isFinite)

/** @param {number[]} values 数の値の最大・最小（無ければ NaN） */
export function extentOf(values) {
  const v = finite(values)
  return v.length ? [Math.min(...v), Math.max(...v)] : [NaN, NaN]
}

/**
 * 縦の目盛り。lo..hi を切りのよい範囲に広げ、y（値 → pt）と目盛りの値・桁を返す。同じ値（幅 0）なら ±1 に広げる
 * @param {number} lo @param {number} hi @param {number} top 上の y @param {number} bottom 下の y
 * @param {{ count?: number, zero?: boolean }} [o] zero: 0 を範囲に含める（面・棒は 0 から描く）
 * @returns {{ y: (v: number) => number, ticks: number[], lo: number, hi: number, digits: number }}
 */
export function yScale(lo, hi, top, bottom, { count = 4, zero = false } = {}) {
  let a = Number.isFinite(lo) ? lo : 0
  let b = Number.isFinite(hi) ? hi : 1
  if (zero) { a = Math.min(a, 0); b = Math.max(b, 0) }
  if (!(b > a)) { a -= 1; b += 1 }
  // 範囲と目盛りは、元の範囲から決めた同じ間隔で揃える（広げた範囲から目盛りを決め直すと、間隔が変わって範囲の端が目盛りから外れる）
  const step = tickStep(a, b, count)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const first = Math.floor(a / step + 1e-9)
  const last = Math.ceil(b / step - 1e-9)
  const nl = Number((first * step).toFixed(dec))
  const nh = Number((last * step).toFixed(dec))
  const ts = Array.from({ length: Math.min(1000, last - first + 1) }, (_, i) => Number(((first + i) * step).toFixed(dec)))
  const span = nh - nl
  return { y: (v) => bottom - ((v - nl) / span) * (bottom - top), ticks: ts, lo: nl, hi: nh, digits: stepDigits(step) }
}

/** 左の目盛りの字がきれいに入る左の余白（字の幅 + 8pt の間と 4pt の線。最低 24pt） @param {string[]} labels */
export function scalePad(labels) {
  return Math.max(24, Math.ceil(Math.max(0, ...labels.map((s) => textWidth(s, TICK)))) + 12)
}

/** 値の字を作る関数（3 桁区切り・単位つき） @param {string} unit @param {number} digits */
export const valueText = (unit, digits) => (/** @type {number} */ v) => withUnit(num(v, digits), unit)

/** x の字を読む字にする。'YYYY-MM-DD' は「10/9」（en は Oct 9）に、'YYYY-MM' は「2026年10月」に、ほかはそのまま @param {string[]} x @param {'ja'|'en'} lang */
export const xTexts = (x, lang) => x.map((s) => dateLabel(s, lang, 'md'))

/** 何点おきに字を置くか（切りのよい値） */
const STRIDES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 2000]

/**
 * 下の x の字を等間隔に置く（軸の線と目盛りの線は引かない）。字の幅から、隣と字 1.4 個分以上空く「何点おき」を決め、最初の点から置く。
 * 端で bounds からはみ出す字は端に寄せる（左の端なら左揃え・右の端なら右揃え）。空の字は置かない
 * @param {string[]} labels @param {(i: number) => number} at i 番目の x 座標 @param {{ lo: number, hi: number }} bounds 字が出てよい左右の端 @param {number} y 基線 @param {Pal} pal
 */
export function evenLabels(labels, at, bounds, y, pal) {
  const n = labels.length
  if (!n) return ''
  // 1 つの字が図の幅の半分近くになる長い x の字は、「…」で切る（隣と重ならないために 2 点おきにしても入らない）
  labels = labels.map((s) => clip(s, TICK, (bounds.hi - bounds.lo) * 0.45))
  const widths = labels.map((s) => textWidth(s, TICK))
  const widest = Math.max(...widths)
  const need = Math.max(widest * 2.4, widest + 16)
  const pitch = n > 1 ? Math.abs(at(1) - at(0)) : need
  const want = Math.ceil(need / Math.max(pitch, 1e-6))
  const k = STRIDES.find((s) => s >= want) ?? n
  /** @type {string[]} */
  const out = []
  for (let i = 0; i < n; i += k) {
    if (!labels[i]) continue
    const w = widths[i]
    const cx = at(i)
    let ax = cx
    /** @type {'start'|'middle'|'end'} */
    let anchor = 'middle'
    if (cx - w / 2 < bounds.lo) { ax = bounds.lo; anchor = 'start' } else if (cx + w / 2 > bounds.hi) { ax = bounds.hi; anchor = 'end' }
    out.push(text(ax, y, labels[i], { size: TICK, fill: pal.sub, anchor }))
  }
  return out.join('')
}

/** 見出しの下の、図の上の端（pt）。見出しが無ければ 12 */
export const TOP_HERO = 36
export const TOP_PLAIN = 12
/** 下の x の字の基線から図の下までの高さ（pt） */
export const X_ROW = 22

/**
 * 点の列を、欠測（y が数でない）で切れた折れ線の d にする。1 点だけの切れ端は描かない
 * @param {[number, number][]} pts
 */
export function linePath(pts) {
  return segments(pts).filter((s) => s.length > 1).map((s) => `M${s.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}`).join('')
}

/**
 * 点の列の下の面（欠測で切れる）を baseY までの閉じた d にする
 * @param {[number, number][]} pts @param {number} baseY
 */
export function areaPath(pts, baseY) {
  return segments(pts).filter((s) => s.length > 1).map((s) => `M${f(s[0][0])} ${f(baseY)}L${s.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}L${f(s[s.length - 1][0])} ${f(baseY)}Z`).join('')
}

/** y が数の点が続く切れ端の列 @param {[number, number][]} pts @returns {[number, number][][]} */
export function segments(pts) {
  /** @type {[number, number][][]} */
  const out = []
  /** @type {[number, number][]} */
  let cur = []
  for (const p of pts) {
    if (Number.isFinite(p[1])) cur.push(p)
    else if (cur.length) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}

/** 'YYYY-MM-DD' の日付の列（見本用）。Date.UTC だけを使う @param {number} y @param {number} m @param {number} d @param {number} count @param {number} [stepDays] */
export function isoDays(y, m, d, count, stepDays = 1) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d + i * stepDays)).toISOString().slice(0, 10))
}

