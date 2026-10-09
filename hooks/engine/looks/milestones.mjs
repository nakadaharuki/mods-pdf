// @ts-check
// milestones（道のりの節目）: 左から右へ等間隔に点を置いた 1 本の道。点から細い線を上下へ互い違いに引き、旗の形に日付と名前を置く。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（まだ終わっていない最初の節目）・字は paper の段・墨の割合は paper の ALPHA。
// - 終わった節目は墨 100% の点と、点どうしをつなぐ実線。終わっていない節目は紙の色の輪と、点線の道。次の節目だけが、色のある紙では grad の大きな点と薄い輪・mono では墨 100% の大きな点と細い輪。
// - 日付は BIG（14pt・細字）。色は、終わった節目が ink・これからが sub・次の節目が accent。名前は LABEL の太字で、日付の下に置く。日付が幅に入らない狭い図では「2026/10」に縮める。
// 選ばなかった案
// - 点を日付の間隔どおりに置く案: 同じ月の節目が重なり、旗の字が重なる。等間隔にして、日付は字で見せる（時間の長さは gantt の仕事）。
// - 節目の上下を同じ側にそろえる案: 旗の幅が点の間隔に収まり、名前が 2 行に割れる。上下に互い違いに置くと、旗の幅が点の間隔の 2 倍になる。
import { ALPHA, LW, DASH, LABEL, BIG, inkFill, inkStroke, strokeAttr, fillAttr, paints, circle, line, text, textLines, wrap, clip, svgDoc, empty, strOf, keep, isMono, dateLabel, textWidth, wrapsTwoRows } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ date: string, name: string, done: boolean }} Item */

const MAX_ITEMS = 8
const MARGIN = 10
const STEM = 14
const R = 4
const R_HOT = 6
const DATE_H = 17

/**
 * @param {unknown} data { items: { date: 'YYYY-MM' か字, name, done? }[2..8] }
 * @returns {{ data: { items: Item[], hot: number }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('節目: items（{ date, name, done? } の列）がありません')
  /** @type {Item[]} */
  let items = []
  let bad = 0
  for (const it of Array.isArray(src.items) ? src.items : []) {
    const name = it && typeof it === 'object' ? strOf(it.name) : ''
    if (!name) { bad++; continue }
    items.push({ date: strOf(it.date), name, done: it.done === true })
  }
  if (bad) warnings.push(`節目: 名前の読めない行 ${bad} 個を捨てました`)
  items = keep(items, MAX_ITEMS, warnings, '節目: 行')
  if (Array.isArray(src.items) && items.length < 2 && !bad) warnings.push('節目: items は 2 個以上要ります')
  if (items.length < 2) items = []
  let hot = items.findIndex((it) => !it.done)
  if (hot < 0 && items.length) hot = items.length - 1
  return { data: { items, hot }, warnings }
}

/** 日付の字（BIG）。年月が幅に入らない時は「2026/10」に縮め、それでも入らなければ切る @param {string} date @param {'ja'|'en'} lang @param {number} maxW */
function dateText(date, lang, maxW) {
  const long = dateLabel(date, lang, 'ym')
  if (textWidth(long, BIG) <= maxW) return long
  const m = /^(\d{4})-(\d{2})/.exec(date)
  return clip(m ? `${m[1]}/${Number(m[2])}` : long, BIG, maxW)
}

/**
 * 点の間隔・旗の幅と折り返し。H が有限なら、旗が上下に収まるまで名前の行数を減らす
 * @param {{ items: Item[], hot: number }} data @param {number} W @param {number} H @param {'ja'|'en'} lang
 */
function plan(data, W, H, lang, fitLast = false) {
  const n = data.items.length
  // 最後の旗は右端で止まるので、年月が入る幅を先に取る（入らないと、最後の日付だけ「2028/4」に縮んで書式が揃わない）
  const tail = data.items[n - 1].date
  const tailW = tail ? textWidth(dateLabel(tail, lang, 'ym'), BIG) + 8 : 0
  // 2 本に折り返した時の行の最後の旗は、名前が 1 行に入る幅まで取る（右端で止まる旗が名前を「…」で切らない）
  const nameW = fitLast ? Math.min(textWidth(data.items[n - 1].name, LABEL, true) + 8, W * 0.3) : 0
  const lastW = Math.max(70, Math.min(150, W * 0.14), Math.min(tailW, W * 0.3), nameW)
  const pitch = (W - 2 * MARGIN - R_HOT - lastW) / Math.max(1, n - 1)
  const xs = data.items.map((_, i) => MARGIN + R_HOT + i * pitch)
  const widths = xs.map((x) => Math.max(40, Math.min(200, 2 * pitch - 12, W - MARGIN - x - 6)))
  const room = Number.isFinite(H) ? Math.max(11 + 11, H / 2 - 12 - STEM) : Infinity
  const flags = data.items.map((it, i) => {
    const date = it.date ? dateText(it.date, lang, widths[i]) : ''
    let names = wrap(it.name, LABEL, widths[i], 2, true)
    if ((date ? DATE_H : 0) + names.length * 11 > room) names = wrap(it.name, LABEL, widths[i], 1, true)
    return { date, names, h: (date ? DATE_H : 0) + names.length * 11 + 2 }
  })
  const bh = Math.max(0, ...flags.map((b) => b.h))
  return { xs, widths, flags, need: 2 * (STEM + bh) + 2 * 12 }
}

/**
 * @param {{ items: Item[], hot: number }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const items = data.items
  if (items.length < 2) return empty(o)
  const g = paints(pal)
  // 節目が 5 つ以上で箱が自然な高さの 2 倍以上なら、前半・後半の 2 本の道のりに折り返す（幅が倍になり、名前を「…」で切らない）
  const two = wrapsTwoRows(items.length, H, naturalHeight(data, W))
  const split = two ? Math.ceil(items.length / 2) : items.length
  /** @type {string[]} */
  const parts = []
  const rows = two ? [[0, split], [split, items.length]] : [[0, items.length]]
  rows.forEach(([from, to], r) => {
    const rowH = two ? H / 2 : H
    drawRow(parts, { ...data, items: items.slice(from, to), hot: data.hot - from }, r * rowH + rowH / 2, rowH, o, g, two)
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/**
 * 1 本の道のりを cy の高さに描く。実線・点線と目立たせる節目は、この行の中の並びで決める
 * @param {string[]} parts @param {{ items: Item[], hot: number }} data @param {number} cy @param {number} rowH @param {DrawOpts} o @param {ReturnType<typeof paints>} g @param {boolean} fitLast
 */
function drawRow(parts, data, cy, rowH, o, g, fitLast) {
  const { width: W, pal, lang } = o
  const items = data.items
  const { xs, widths, flags } = plan(data, W, rowH, lang, fitLast)
  for (let i = 0; i + 1 < items.length; i++) {
    const solid = items[i].done && (items[i + 1].done || i + 1 === data.hot)
    parts.push(line(xs[i], cy, xs[i + 1], cy, solid ? inkStroke(pal, 1, LW.hot) : inkStroke(pal, ALPHA.last, LW.line, DASH.ref)))
  }
  items.forEach((it, i) => {
    const x = xs[i]
    const isHot = i === data.hot
    const up = i % 2 === 0
    const b = flags[i]
    const top = up ? cy - STEM - b.h : cy + STEM
    parts.push(line(x, up ? cy - STEM - b.h + 2 : cy, x, up ? cy : cy + STEM + b.h - 2, inkStroke(pal, ALPHA.last, LW.hair)))
    const tx = x + 6
    let by = top + 8
    if (b.date) {
      parts.push(text(tx, by + 6, b.date, { size: BIG, fill: isHot ? pal.accent : it.done ? pal.ink : pal.sub }))
      by += DATE_H
    }
    parts.push(textLines(tx, by, b.names.map((l) => clip(l, LABEL, widths[i], true)), { size: LABEL, fill: isHot ? pal.accent : it.done ? pal.ink : pal.sub, bold: true, leading: 11 }))
    if (isHot) {
      parts.push(circle(x, cy, R_HOT + 4, `fill="none" ${isMono(pal) ? inkStroke(pal, ALPHA.last, LW.hair) : strokeAttr(pal.accent, ALPHA.last, LW.hair)}`))
      parts.push(circle(x, cy, R_HOT, g.linear(x - R_HOT, cy - R_HOT, x + R_HOT, cy + R_HOT, 1, 1)))
    } else if (it.done) parts.push(circle(x, cy, R, inkFill(pal, 1)))
    else parts.push(circle(x, cy, R, `${fillAttr(pal.paper)} ${inkStroke(pal, 1, LW.line)}`))
  })
}

/** 1 本に並べた時の自然な高さ @param {{ items: Item[], hot: number }} data @param {number} width */
function naturalHeight(data, width) {
  return Math.max(Math.round(width * 0.26), data.items.length >= 2 ? Math.ceil(plan(data, width, Infinity, 'ja').need) : 0)
}

/** 事業の節目（見本）。次の節目は 3 つ目の「有料版の開始」 */
function sample() {
  return {
    items: [
      { date: '2026-04', name: '会社を設立', done: true },
      { date: '2026-07', name: '試作版を完成', done: true },
      { date: '2026-10', name: '有料版を開始' },
      { date: '2027-03', name: '契約 100 社を達成' },
      { date: '2027-09', name: '黒字に転換' },
      { date: '2028-04', name: '海外へ展開' },
    ],
  }
}

export default {
  id: 'milestones',
  title: '節目の道のり（Milestones）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {any} */ data) => naturalHeight(data, width),
  sample,
}
