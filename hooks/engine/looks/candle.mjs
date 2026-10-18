// @ts-check
// candle（ローソク足）: 本人の look の「ほかの形が従う基準」の形を、紙の図に写した物。
// 元は look の designs/candle.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 枠と軸の線を引かない・本体は 1 本の幅（スロット）の 62% で墨でなく上げ下げの色の 55% の塗り・
// ヒゲは 1pt で 80%・出来高は下の 18% の帯に墨の 10%・最後の値は墨の 35% の点線で、右の余白（値の字を置く所）まで伸ばす。
// 値の字は右の余白に置く。最高値・最安値の字は最後の値と重なる時は退く。
//
// 紙に写して変えた所
// - 暗い地（STAGE）は塗らない。明るい墨の何 % は、濃い墨（pal.ink）の同じ %。上げ・下げは pal.up・pal.down。
// - 字は pt。最後の値は太字の墨、最高値・最安値・目盛りの端は sub。元の 10px・9px は、紙の大きさの決まり（docs/looks.md の 2 章）の 8pt・7.5pt。
// - 元は下に「SAMPLE 15m」を置いたが、紙では読む人が時を知る手がかりが要るので、最初・真ん中・最後の x の字を置く。
// - 出来高の帯の右の余白に、「出来高」と最大の値を置く（下の帯が何か、紙の読み手には書かないと分からない）。
// 選ばなかった案
// - 白黒印刷でも上げ下げを分けるため、上げを枠だけの本体にする案: 元の「全部 55% の塗り」と形が変わる。上げ下げの色は pal.up・pal.down の差（緑と赤）に任せる。
// - 足が多い時に細い線へ縮める案: 1 本が 1pt を切ると本体が重なって帯になる。MAX_BARS を超えたら足をまとめる（始値は最初・終値は最後・高値と安値は極値・出来高は合計）。
import { ALPHA, DASH, TICK, VALUE, fillAttr, inkFill, inkStroke, strokeAttr, text, line, rect, svgDoc, empty, num, autoDigits, withUnit, compact, gutter, edgeLabels, tr, toNum, seeded, LW } from './paper.mjs'

/** 足の数の上限。plotW 440pt で 1 本が 2.2pt */
const MAX_BARS = 200
// 元の 380 × 250 の欄の縦の割合（178/250・196/250・236/250）。上の余白と下の字の位置は pt のまま
const TOP = 12
const PRICE_BOTTOM = 0.712
const VOL_TOP = 0.784
const VOL_BOTTOM = 0.944
const NOTE_FROM_BOTTOM = 4
const PAD_LEFT = 8
const PAD_RIGHT = 52

/** @typedef {{ x: string, o: number, h: number, l: number, c: number, v: number }} Bar */
/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ rows: Bar[], hasVolume: boolean, unit: string }} CandleData */

/**
 * @param {unknown} data { x, ohlc: [始値, 高値, 安値, 終値][], volume?, unit? }
 * @returns {{ data: CandleData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.ohlc)) warnings.push('ローソク足: ohlc（[始値, 高値, 安値, 終値] の列）がありません')
  const ohlc = Array.isArray(src.ohlc) ? src.ohlc : []
  const xs = Array.isArray(src.x) ? src.x : []
  const vols = Array.isArray(src.volume) ? src.volume : []
  /** @type {Bar[]} */
  let rows = []
  let broken = 0
  let repaired = 0
  let badVolume = 0
  ohlc.forEach((b, i) => {
    const q = Array.isArray(b) && b.length >= 4 ? [toNum(b[0]), toNum(b[1]), toNum(b[2]), toNum(b[3])] : []
    if (q.length !== 4 || q.some((n) => Number.isNaN(n))) { broken++; return }
    const [o, h, l, c] = q
    const hi = Math.max(o, h, l, c)
    const lo = Math.min(o, h, l, c)
    if (hi !== h || lo !== l) repaired++
    let v = vols.length ? toNum(vols[i]) : 0
    if (!(v >= 0)) { if (vols.length) badVolume++; v = 0 }
    rows.push({ x: xs[i] === undefined || xs[i] === null ? '' : String(xs[i]), o, h: hi, l: lo, c, v })
  })
  if (broken) warnings.push(`ローソク足: 数でない値のある足 ${broken} 本を捨てました`)
  if (repaired) warnings.push(`ローソク足: 高値・安値が始値・終値の外にある足 ${repaired} 本を、外れた値まで広げました`)
  if (badVolume) warnings.push(`ローソク足: 出来高が 0 以上の数でない足 ${badVolume} 本は 0 にしました`)
  if (rows.length > MAX_BARS) {
    const k = Math.ceil(rows.length / MAX_BARS)
    /** @type {Bar[]} */
    const merged = []
    for (let i = 0; i < rows.length; i += k) {
      const g = rows.slice(i, i + k)
      merged.push({ x: g[0].x, o: g[0].o, h: Math.max(...g.map((r) => r.h)), l: Math.min(...g.map((r) => r.l)), c: g[g.length - 1].c, v: g.reduce((s, r) => s + r.v, 0) })
    }
    warnings.push(`ローソク足: 足が ${rows.length} 本あり ${MAX_BARS} 本を超えるので、${k} 本ずつ 1 本にまとめました`)
    rows = merged
  }
  const unit = typeof src.unit === 'string' ? src.unit : ''
  return { data: { rows, hasVolume: vols.length > 0 && rows.some((r) => r.v > 0), unit }, warnings }
}

/**
 * @param {CandleData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  let lo = Math.min(...rows.map((r) => r.l))
  let hi = Math.max(...rows.map((r) => r.h))
  if (!(hi > lo)) {
    const pad = Math.abs(hi) * 0.01 || 1
    lo -= pad
    hi += pad
  }
  const last = rows[n - 1]
  const fmt = (/** @type {number} */ v) => withUnit(num(v, autoDigits(hi - lo)), data.unit)
  // 値の字は右の余白に右揃えで置く。余白は元の 52 を下限に、値の字の幅に合わせて広げる（最後の値は太字なので太字で量る）
  const padR = gutter([fmt(last.c), fmt(hi), fmt(lo)], { size: VALUE, bold: true, min: PAD_RIGHT })

  const hasVol = data.hasVolume
  const priceBottom = hasVol ? Math.round(H * PRICE_BOTTOM) : H - 28
  const volTop = H * VOL_TOP
  const volBottom = H * VOL_BOTTOM
  const vmax = hasVol ? Math.max(...rows.map((r) => r.v)) : 0
  const slot = (W - PAD_LEFT - padR) / n
  const body = Math.max(1, slot * 0.62)
  const y = (/** @type {number} */ v) => priceBottom - ((v - lo) / (hi - lo)) * (priceBottom - TOP)
  const vy = (/** @type {number} */ v) => volBottom - (v / vmax) * (volBottom - volTop)

  /** @type {string[]} */
  const parts = []
  rows.forEach((r, i) => {
    const cx = PAD_LEFT + slot * (i + 0.5)
    const color = r.c >= r.o ? pal.up : pal.down
    const top = y(Math.max(r.o, r.c))
    const bottom = y(Math.min(r.o, r.c))
    if (hasVol && r.v > 0) parts.push(rect(cx - body / 2, vy(r.v), body, volBottom - vy(r.v), inkFill(pal, ALPHA.quiet)))
    parts.push(line(cx, y(r.h), cx, y(r.l), strokeAttr(color, ALPHA.wick, LW.line)))
    parts.push(rect(cx - body / 2, top, body, Math.max(1, bottom - top), fillAttr(color, ALPHA.body)))
  })

  const ly = y(last.c)
  const lx = PAD_LEFT + slot * (n - 0.5)
  parts.push(line(lx, ly, W - 4, ly, inkStroke(pal, ALPHA.last, LW.line, DASH.ref)))
  parts.push(text(W - 4, ly - 4, fmt(last.c), { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  // 最高値・最安値の字は、最後の値がその上にある時は退く
  const clear = (/** @type {number} */ yy) => Math.abs(yy - ly) > 11
  if (clear(TOP + 8)) parts.push(text(W - 4, TOP + 8, fmt(hi), { size: TICK, fill: pal.sub, anchor: 'end' }))
  if (clear(priceBottom)) parts.push(text(W - 4, priceBottom, fmt(lo), { size: TICK, fill: pal.sub, anchor: 'end' }))
  if (hasVol) {
    parts.push(text(W - 4, volTop + 7, tr(lang, '出来高', 'Volume'), { size: TICK, fill: pal.sub, anchor: 'end' }))
    parts.push(text(W - 4, volTop + 16, compact(vmax, lang), { size: TICK, fill: pal.sub, anchor: 'end' }))
  }

  // 下の x の字: 最初・最後と、重ならなければ真ん中
  parts.push(edgeLabels(rows.map((r) => r.x), (i) => PAD_LEFT + slot * (i + 0.5), PAD_LEFT, W - padR, H - NOTE_FROM_BOTTOM, pal))
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種・同じ数の歩き（48 本）。出来高は千株。日付は平日だけの「月/日」
 * @returns {{ x: string[], ohlc: number[][], volume: number[], unit: string }}
 */
function sample() {
  const rnd = seeded(20261009)
  /** @type {string[]} */
  const x = []
  /** @type {number[][]} */
  const ohlc = []
  /** @type {number[]} */
  const volume = []
  let close = 100
  let day = 0
  for (let i = 0; i < 48; i++) {
    const open = close
    close = Math.max(60, open + (rnd() - 0.48) * 2.4)
    const high = Math.max(open, close) + rnd() * 0.9
    const low = Math.min(open, close) - rnd() * 0.9
    const vol = 0.3 + rnd()
    let d = new Date(Date.UTC(2026, 6, 1 + day))
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(Date.UTC(2026, 6, 1 + ++day))
    day++
    x.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`)
    ohlc.push([open, high, low, close].map((v) => Math.round(v * 100) / 100))
    volume.push(Math.round(vol * 1000))
  }
  return { x, ohlc, volume, unit: '円' }
}

export default {
  id: 'candle',
  title: 'ローソク足（Candlestick）',
  category: 'time',
  normalize,
  draw,
  height: (/** @type {number} */ width) => Math.round(width * 0.658),
  sample,
}
