// @ts-check
// tiles（数のタイル）: 数を 1 枚ずつ枠に入れて並べる。枠は墨の 14% の細い線・左上に名前（sub）・大きな値・変化（三角は字でなく形で描く）・下に 1 本の細い折れ線（sparkline）。
// 元は look の designs/tiles.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり（元の頭の文のとおり）: 枠は 1 本の細い線で墨の 14%・三角は path（▲▼ の字を使わない）・折れ線は 1 本の細い線で、変化と同じ上げ下げの色・
// 目立たせる 1 つだけ accent（上がると警告になるタイルの折れ線）。元の見本の折れ線は種つきの歩きで、同じ絵が出る。
//
// 紙に写して変えた所
// - 暗い地は塗らない。枠の 14% は細い線の下限 18%（paper の PRINT）に持ち上がる。折れ線は 1pt。目立たせる折れ線は、mono では墨 100%（上げ下げは緑と赤のまま）。
// - 値の字は 20pt（HUGE。元は 22px）・名前と変化は 7.5pt。値が枠の幅に入らない時だけ 14pt（BIG）にする。
// - 並べる数は幅で決める（元は 3 つ固定）。幅 110pt あたり 1 枚・最大 4 列で、列は均す（6 枚なら 3 列）。
// - 値は data の value に unit を付けた字（元は「12.48M」のように字で持っていた）。折れ線は data の spark（数の列）で、無ければ描かない。変化 delta は数で、既定の単位は %（deltaUnit で変える）。
// 選ばなかった案
// - 変化が下がった時に「良い・悪い」を data で持たせる案: 元は符号だけで上げ下げの色を決める。返品率のように上がると悪い物は、highlight で折れ線を目立たせて知らせる。
// - 折れ線の点が多い時に細かく描く案: 60 個を超えたら等間隔に間引く（枠の中の 1pt の線は 60 個で十分）。
import { ALPHA, TICK, BIG, HUGE, fillAttr, inkStroke, strokeAttr, hotStroke, strokePath, fillPath, triangle, text, rect, svgDoc, empty, withUnit, clip, textWidth, nameOf, arr, keep, f, numOf, plain, gridOf, seeded, LW } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, unit: string, delta: number | null, deltaUnit: string, spark: number[], hot: boolean }} Tile */

const MAX_ITEMS = 12
const SPARK_MAX = 60
const MARGIN = 1
const GAP = 8
const TILE_H = 90
const TILE_H_MAX = 104
const MIN_TILE_W = 110

/**
 * @param {unknown} data { items: { name, value, unit?, delta?, deltaUnit?, spark?, highlight? }[], unit? }
 * @returns {{ data: { tiles: Tile[] }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('数のタイル: items（{ name, value, delta?, spark? } の列）がありません')
  const unitAll = typeof src.unit === 'string' ? src.unit : ''
  /** @type {Tile[]} */
  const tiles = []
  let bad = 0
  let badDelta = 0
  let hotSeen = false
  arr(src.items).forEach((it, i) => {
    const value = numOf(it && it.value)
    if (Number.isNaN(value)) { bad++; return }
    let delta = null
    if (it.delta !== undefined && it.delta !== null) {
      const d = numOf(it.delta)
      if (Number.isNaN(d)) badDelta++
      else delta = d
    }
    let spark = arr(it.spark).map(numOf).filter((v) => !Number.isNaN(v))
    if (spark.length > SPARK_MAX) {
      const k = Math.ceil(spark.length / SPARK_MAX)
      spark = spark.filter((_, j) => j % k === 0 || j === spark.length - 1)
    }
    const hot = it.highlight === true && !hotSeen
    if (hot) hotSeen = true
    tiles.push({
      name: nameOf(it.name) || String(i + 1), value, unit: typeof it.unit === 'string' ? it.unit : unitAll,
      delta, deltaUnit: typeof it.deltaUnit === 'string' ? it.deltaUnit : '%', spark: spark.length >= 2 ? spark : [], hot,
    })
  })
  if (bad) warnings.push(`数のタイル: value が数（絶対値 1,000 兆以下）でない項目 ${bad} 個を捨てました`)
  if (badDelta) warnings.push(`数のタイル: delta が数でない項目 ${badDelta} 個は、変化を書きません`)
  return { data: { tiles: keep(tiles, MAX_ITEMS, warnings, '数のタイル: 項目') }, warnings }
}

/**
 * 並べ方。幅 110pt あたり 1 枚（最大 4 列）・行ごとの数は均す
 * @param {number} W @param {number} n
 */
function geom(W, n) {
  const { cols, rows } = gridOf(n, Math.min(4, Math.floor((W - 2 * MARGIN + GAP) / (MIN_TILE_W + GAP))))
  return { cols, rows, tileW: (W - 2 * MARGIN - (cols - 1) * GAP) / cols }
}

/**
 * @param {{ tiles: Tile[] }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const tiles = data.tiles
  if (!tiles.length) return empty(o)
  const { cols, rows, tileW } = geom(W, tiles.length)
  const tileH = Math.min(TILE_H_MAX, Math.max(TILE_H, (H - 2 * MARGIN - (rows - 1) * GAP) / rows))
  const top = MARGIN + Math.max(0, (H - 2 * MARGIN - rows * tileH - (rows - 1) * GAP) / 2)
  /** @type {string[]} */
  const parts = []
  tiles.forEach((t, i) => {
    const x = MARGIN + (i % cols) * (tileW + GAP)
    const y = top + Math.floor(i / cols) * (tileH + GAP)
    const inner = tileW - 16
    parts.push(rect(x + 0.5, y + 0.5, tileW - 1, tileH - 1, `fill="none" ${inkStroke(pal, ALPHA.track, LW.line)}`, 'rx="3"'))
    parts.push(text(x + 8, y + 14, clip(t.name, TICK, inner), { size: TICK, fill: pal.sub }))
    const valueText = withUnit(plain(t.value), t.unit)
    const big = textWidth(valueText, HUGE) <= inner
    parts.push(text(x + 8, y + 42, clip(valueText, big ? HUGE : BIG, inner), { size: big ? HUGE : BIG, fill: pal.ink }))
    const trend = t.delta === null || t.delta >= 0 ? pal.up : pal.down
    if (t.delta !== null) {
      parts.push(fillPath(triangle(x + 11, y + 54.5, 7, t.delta >= 0), fillAttr(trend)))
      parts.push(text(x + 18, y + 58, clip(`${plain(t.delta, true)}${t.deltaUnit}`, TICK, inner - 10), { size: TICK, fill: trend }))
    }
    if (t.spark.length >= 2) {
      const bandH = Math.max(12, Math.min(28, tileH - 74))
      const bottom = y + tileH - 8
      const lo = Math.min(...t.spark)
      const hi = Math.max(...t.spark)
      const d = t.spark
        .map((v, k) => `${k ? 'L' : 'M'}${f(x + 8 + (inner * k) / (t.spark.length - 1))} ${f(bottom - (hi > lo ? ((v - lo) / (hi - lo)) * bandH : bandH / 2))}`)
        .join('')
      parts.push(strokePath(d, t.hot ? hotStroke(pal, 1, LW.line) : strokeAttr(trend, 1, LW.line)))
    }
  })
  return svgDoc(W, H, parts.join(''))
}

/**
 * 元の見本と同じ種・同じ歩きの折れ線（24 点を 0〜1 に収め、傾きは変化に合わせる）
 * @param {number} seed @param {number} drift
 */
function walk(seed, drift) {
  const rnd = seeded(seed)
  /** @type {number[]} */
  const out = []
  let v = 0.5
  for (let i = 0; i < 24; i++) {
    v += (rnd() - 0.5) * 0.3 + drift
    out.push(v)
  }
  const lo = Math.min(...out)
  const hi = Math.max(...out)
  return out.map((x) => Math.round(((x - lo) / (hi - lo || 1)) * 1000) / 1000)
}

/** 元の見本の 6 枚（種・傾き・変化の向きは同じ）。名前と単位を紙の報告に合う物に直した */
function sample() {
  return {
    items: [
      { name: '売上', value: 1248, unit: '万円', delta: 2.4, spark: walk(20261001, 0.02) },
      { name: '粗利', value: 182, unit: '万円', delta: 1.5, spark: walk(20261002, 0.02) },
      { name: '継続率', value: 58.3, unit: '%', delta: -0.8, deltaUnit: 'pt', spark: walk(20261003, -0.02) },
      { name: '受注', value: 142, unit: '件', delta: 12, deltaUnit: '', spark: walk(20261004, 0.01) },
      { name: '問い合わせ', value: 1087, unit: '件', delta: -4.1, spark: walk(20261005, -0.01) },
      { name: '返品率', value: 2.9, unit: '%', delta: 0.4, deltaUnit: 'pt', spark: walk(20261006, 0.01), highlight: true },
    ],
  }
}

export default {
  id: 'tiles',
  title: '数のタイル（Stat tiles）',
  category: 'usage',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ tiles?: Tile[] } | undefined} */ data) => {
    const g = geom(width, Math.max(1, data?.tiles?.length ?? 6))
    return Math.round(2 * MARGIN + g.rows * TILE_H + (g.rows - 1) * GAP)
  },
  sample,
}
