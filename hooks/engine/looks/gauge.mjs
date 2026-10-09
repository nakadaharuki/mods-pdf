// @ts-check
// gauge（ゲージ）: 半円の文字盤を横に並べる。10% ごとの目盛り・針・上に名前・下に値。値の弧は 2pt で、色は割合で決まる（60% 未満は上げの色・85% までは accent・それより上は下げの色）ので、数を読む前に状態が分かる。
// 元は look の designs/gauge.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり。数は変えない）: 目盛りは 10% ごと・値の弧だけ 2pt（色が伝える線）・ほかの線は 1pt。
//
// 紙に写して変えた所
// - 暗い地は塗らない。弧の道（track）は墨の 18%（元は 20%）・目盛りは墨の 42%（元は MUTED の不透明）。色は pal.up・pal.accent・pal.down（mono では accent が墨なので「まん中の状態」は墨）。
// - 元は下に「SAMPLE usage」を置いたが、紙では色の意味が読み手に分からないので、右下に 3 つの状態の札（凡例）を置く。
// - 元の 10px の名前・13px の値は、紙の 8pt（名前）・14pt（値）。割合の元の数 max が 100 でない時だけ、値の下に「値 / max」を小さく足す。
// - 並べる数は幅で決める（元は 3 つ固定）。幅 120pt あたり 1 つ・最大 4 列で、多い時は行を足し、列は均す。
// 選ばなかった案
// - 針を目立たせる 1 つ（accent）にする案: 色は状態に使うので、針は墨のまま。目立たせる 1 つは、状態の色が担う。
// - 割合の端の字に単位を付ける案: 1,000,000 円のような max で隣の文字盤まで入る。端の字は compact（100万）で、単位は値の下の行に書く。
import { ALPHA, TICK, LABEL, BIG, fillAttr, inkFill, inkStroke, strokeAttr, strokePath, text, line, circle, svgDoc, empty, percent, withUnit, clip, tr, nameOf, arr, keep, compact, legend, f, numOf, plain, gridOf, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, max: number, unit: string, raw: boolean }} Dial */

const MAX_ITEMS = 12
/** 割合の境目。元の「60% 未満は上げ・85% までは accent・それより上は下げ」 */
const WARN = 0.6
const CRIT = 0.85
const PAD_TOP = 4
const LEGEND_H = 16

/**
 * @param {unknown} data { items: { name, value, max?, unit? }[], unit? }（max の既定は 100）
 * @returns {{ data: { dials: Dial[] }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('ゲージ: items（{ name, value, max? } の列）がありません')
  const unitAll = typeof src.unit === 'string' ? src.unit : ''
  /** @type {Dial[]} */
  const dials = []
  let bad = 0
  let badMax = 0
  arr(src.items).forEach((it, i) => {
    const v = numOf(it && it.value)
    if (!(v >= 0)) { bad++; return }
    let max = 100
    let raw = false
    if (it.max !== undefined && it.max !== null) {
      const m = numOf(it.max)
      if (m > 0) { max = m; raw = m !== 100 } else badMax++
    }
    dials.push({ name: nameOf(it.name) || String(i + 1), value: v, max, unit: typeof it.unit === 'string' ? it.unit : unitAll, raw })
  })
  if (bad) warnings.push(`ゲージ: value が 0 以上 1,000 兆以下の数でない項目 ${bad} 個を捨てました`)
  if (badMax) warnings.push(`ゲージ: max が 0 より大きい数でない項目 ${badMax} 個は、max を 100 にしました`)
  return { data: { dials: keep(dials, MAX_ITEMS, warnings, 'ゲージ: 項目') }, warnings }
}

/**
 * 文字盤の並べ方。幅 120pt あたり 1 つ（最大 4 列）・行ごとの数は均す。半径は列の幅の 36%（元の 46 / 126.7）を 30〜52 に収める
 * @param {number} W @param {number} n @param {number} [H] 渡すと、その高さに入るよう半径を縮める
 */
function geom(W, n, H) {
  const { cols, rows } = gridOf(n, Math.min(4, Math.floor(W / 120)))
  const cellW = W / cols
  let R = Math.max(30, Math.min(52, cellW * 0.36))
  if (H !== undefined) R = Math.max(24, Math.min(R, (H - PAD_TOP - LEGEND_H) / rows - 64))
  return { cols, rows, cellW, R, rowH: R + 64 }
}

/** 割合の状態の色 @param {number} ratio @param {Pal} pal */
const stateColor = (ratio, pal) => (ratio < WARN ? pal.up : ratio <= CRIT ? pal.accent : pal.down)

/** 弧の上の点。fr は 0 が左端・1 が右端（弧は上を回る） @param {number} cx @param {number} cy @param {number} r @param {number} fr */
function at(cx, cy, r, fr) {
  const t = Math.PI * (1 - fr)
  return [cx + r * Math.cos(t), cy - r * Math.sin(t)]
}

/**
 * @param {{ dials: Dial[] }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const dials = data.dials
  if (!dials.length) return empty(o)
  const { cols, rows, cellW, R, rowH } = geom(W, dials.length, H)
  const natural = PAD_TOP + rows * rowH + LEGEND_H
  const top = PAD_TOP + Math.max(0, (H - natural) / 2)
  /** @type {string[]} */
  const parts = []
  dials.forEach((d, i) => {
    const cx = cellW / 2 + (i % cols) * cellW
    const rowTop = top + Math.floor(i / cols) * rowH
    const labelY = rowTop + 9
    const cy = labelY + 12 + R
    const ratio = d.value / d.max
    const arc = Math.min(1, ratio)
    const color = stateColor(ratio, pal)
    const [x0, y0] = at(cx, cy, R, 0)
    const [x1, y1] = at(cx, cy, R, 1)
    parts.push(text(cx, labelY, clip(d.name, LABEL, cellW - 12), { size: LABEL, fill: pal.sub, anchor: 'middle' }))
    parts.push(strokePath(`M${f(x0)} ${f(y0)}A${f(R)} ${f(R)} 0 0 1 ${f(x1)} ${f(y1)}`, inkStroke(pal, ALPHA.card, LW.line)))
    for (let k = 0; k <= 10; k++) {
      const [ax, ay] = at(cx, cy, R - 8, k / 10)
      const [bx, by] = at(cx, cy, R - 3, k / 10)
      parts.push(line(ax, ay, bx, by, inkStroke(pal, ALPHA.dim, LW.line)))
    }
    if (arc > 0.002) {
      const [ex, ey] = at(cx, cy, R, arc)
      parts.push(strokePath(`M${f(x0)} ${f(y0)}A${f(R)} ${f(R)} 0 0 1 ${f(ex)} ${f(ey)}`, strokeAttr(color, 1, LW.ring)))
    }
    const [nx, ny] = at(cx, cy, R - 10, arc)
    parts.push(line(cx, cy, nx, ny, inkStroke(pal, 1, LW.line)))
    parts.push(circle(cx, cy, 2, inkFill(pal)))
    parts.push(text(cx - R, cy + 10, '0', { size: TICK, fill: pal.sub, anchor: 'middle' }))
    parts.push(text(cx + R, cy + 10, compact(d.max, lang), { size: TICK, fill: pal.sub, anchor: 'middle' }))
    parts.push(text(cx, cy + 23, percent(ratio), { size: BIG, fill: color, anchor: 'middle' }))
    if (d.raw || (d.unit !== '%' && d.unit !== '')) {
      parts.push(text(cx, cy + 34, clip(`${withUnit(plain(d.value), d.unit)} / ${withUnit(plain(d.max), d.unit)}`, TICK, cellW - 12), { size: TICK, fill: pal.sub, anchor: 'middle' }))
    }
  })
  const keys = /** @type {{ label: string, mark: 'dot', attr: string }[]} */ ([
    { label: tr(lang, `${percent(WARN)} 未満`, `Under ${percent(WARN)}`), mark: 'dot', attr: fillAttr(pal.up) },
    { label: tr(lang, `${percent(CRIT)} まで`, `Up to ${percent(CRIT)}`), mark: 'dot', attr: fillAttr(pal.accent) },
    { label: tr(lang, `${percent(CRIT)} 超`, `Over ${percent(CRIT)}`), mark: 'dot', attr: fillAttr(pal.down) },
  ])
  parts.push(legend(W - 4, H - 4, keys, pal, { anchor: 'end' }).svg)
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本の 3 つの文字盤（割合）。名前だけ日本語に直した */
function sample() {
  return {
    items: [
      { name: 'CPU', value: 42 },
      { name: 'メモリ', value: 71 },
      { name: 'ディスク', value: 91 },
    ],
    unit: '%',
  }
}

export default {
  id: 'gauge',
  title: 'ゲージ（Gauge）',
  category: 'usage',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ dials?: Dial[] } | undefined} */ data) => {
    const g = geom(width, Math.max(1, data?.dials?.length ?? 3))
    return Math.round(PAD_TOP + g.rows * g.rowH + LEGEND_H)
  },
  sample,
}
