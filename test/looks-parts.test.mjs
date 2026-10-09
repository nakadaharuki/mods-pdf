// @ts-check
// parts の束（donut・treemap・circle-pack・funnel・icicle・polar-area・sunburst・waterfall）の試験。
// 全部の形に test/looks-kit.mjs の共通の確かめを掛け、形ごとに「何を保証するか」を 1 つ以上確かめる。
//
// 選ばなかった案
// - 扇や円の大きさを、描いた path の外接の四角から測る案: 弧は 3 次ベジェに直るので、外接は制御点まで膨らんで円より大きく出る。
//   面積（ベジェを細かく刻んだ多角形の面積）なら、値に比例する形（円・環・扇）を同じ物差しで測れる。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook, LOOKS } from '../hooks/engine/looks/index.mjs'
import { textWidth } from '../hooks/engine/looks/paper.mjs'
import { barsOf } from '../hooks/engine/looks/waterfall.mjs'
import { normalizeTree, valueTree } from '../hooks/engine/looks/parts-kit.mjs'
import { hierarchy } from '../hooks/vendor/d3.mjs'
import { testLook, toOps, flat, textOf, bboxOf, PALS, MEASURE } from './looks-kit.mjs'

const MONO = PALS.mono
const IDS = ['donut', 'treemap', 'circle-pack', 'funnel', 'icicle', 'polar-area', 'sunburst', 'waterfall']
const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi

for (const id of IDS) testLook(id)

/** 描いた物を役割で分ける @param {string} id @param {any} data @param {any} [pal] @param {any} [opts] */
function parts(id, data, pal = MONO, opts = {}) {
  const r = drawLook(id, data, { width: MEASURE, pal, ...opts })
  const ops = flat(toOps(r, pal).ops)
  return { r, ops, paths: ops.filter((o) => o.t === 'path'), texts: ops.filter((o) => o.t === 'text') }
}

const lc = (/** @type {string} */ s) => s.toLowerCase()
/** 塗りの path（弧・扇・円）: 3 次ベジェを含む @param {any} o */
const curved = (o) => !!o.fill && /C/.test(String(o.d))
/** 塗りの四角・台形（直線だけ） @param {any} o */
const boxy = (o) => !!o.fill && !/C/.test(String(o.d))
/** 線だけの path @param {any} o */
const stroked = (o) => !!o.stroke && !o.fill
/** @param {any} o @param {number} a */
const alphaIs = (o, a) => Math.abs((o.opacity ?? 1) - a) < 1e-9
/** 塗りの色が c か @param {any} o @param {string} c */
const filled = (o, c) => !!o.fill && lc(o.fill) === lc(c)
/** 字の左端 @param {any} t */
const leftOf = (t) => t.glyphs[0].x
/** @param {any[]} texts */
const strings = (texts) => texts.map(textOf)
/** 割合の字（「34%」「8.3%」）の数 @param {any[]} texts */
const percents = (texts) => strings(texts).filter((s) => /^\d+(\.\d)?%$/.test(s)).map(parseFloat)
const sum = (/** @type {number[]} */ a) => a.reduce((s, v) => s + v, 0)
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)
/** 値に比例する物の「大きさ ÷ 値」が、全部で（最大 ÷ 最小）tol 倍以内に揃うか @param {number[]} sizes @param {number[]} values @param {number} tol */
function proportional(sizes, values, tol) {
  const k = sizes.map((s, i) => s / values[i])
  assert.ok(Math.max(...k) / Math.min(...k) <= tol, `大きさ ÷ 値が揃わない: ${k.map((x) => x.toFixed(3)).join(' ')}`)
}

/** path の面積（3 次ベジェは 24 本の線に刻む。M・L・C・Z だけ読む）。弧・円・扇を同じ物差しで測る @param {any} op */
function areaOf(op) {
  let area = 0
  let cur = [0, 0]
  let start = [0, 0]
  for (const [, c, body] of String(op.d).matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = (body.match(NUM) ?? []).map(Number)
    if (c === 'M') {
      cur = [n[0], n[1]]
      start = cur
    } else if (c === 'L') {
      area += cur[0] * n[1] - n[0] * cur[1]
      cur = [n[0], n[1]]
    } else if (c === 'C') {
      for (let k = 0; k + 6 <= n.length; k += 6) {
        const [x1, y1, x2, y2, x3, y3] = n.slice(k, k + 6)
        let p = cur
        for (let s = 1; s <= 24; s++) {
          const t = s / 24
          const u = 1 - t
          const q = [u * u * u * cur[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * cur[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]
          area += p[0] * q[1] - q[0] * p[1]
          p = q
        }
        cur = [x3, y3]
      }
    } else {
      area += cur[0] * start[1] - start[0] * cur[1]
      cur = start
    }
  }
  return Math.abs(area) / 2
}

/** path の端点（M・L は 1 つ・C は終点）。制御点を含まないので、弧の上の点だけが返る @param {any} op @returns {number[][]} */
function anchorsOf(op) {
  /** @type {number[][]} */
  const out = []
  for (const [, c, body] of String(op.d).matchAll(/([MLC])([^MLCZ]*)/g)) {
    const n = (body.match(NUM) ?? []).map(Number)
    const step = c === 'C' ? 6 : 2
    for (let i = 0; i + step <= n.length; i += step) out.push([n[i + step - 2], n[i + step - 1]])
  }
  return out
}

/** 点 (x, y) を含む四角の path @param {any[]} cells @param {number} x @param {number} y */
function cellAt(cells, x, y) {
  return cells.find((c) => {
    const b = bboxOf(c)
    return x >= b.x0 - 0.01 && x <= b.x1 + 0.01 && y >= b.y0 - 0.01 && y <= b.y1 + 0.01
  })
}

// ---------------------------------------------------------------- donut

test('donut: 弧は項目の数だけで、面積は値に比例し、割合の字は足して 100%', () => {
  const sample = LOOKS.donut.sample()
  const d = parts('donut', sample)
  const arcs = d.paths.filter(curved)
  assert.equal(arcs.length, sample.items.length)
  proportional(arcs.map(areaOf), sample.items.map((/** @type {{ value: number }} */ i) => i.value), 1.08)
  const pcts = percents(d.texts)
  assert.deepEqual(pcts, [34, 21, 19, 16, 10])
  near(sum(pcts), 100)
})

test('donut: 最初の弧は 12 時の真上から始まり、次の弧は右側に来る（時計回り）', () => {
  const d = parts('donut', LOOKS.donut.sample())
  const arcs = d.paths.filter(curved)
  // 中心は、中央の合計の字（14pt の 1 つだけ・中央揃え）の真ん中
  const centre = d.texts.find((t) => t.size === 14)
  assert.ok(centre)
  const cx = leftOf(centre) + textWidth(textOf(centre), 14) / 2
  const top = Math.min(...arcs.flatMap(anchorsOf).map((p) => p[1]))
  const [sx, sy] = anchorsOf(arcs[0])[0]
  assert.ok(Math.abs(sx - cx) < 4, `最初の弧の始まり x ${sx} が中心 ${cx} の真上でない`)
  assert.ok(sy - top < 3, `最初の弧の始まりが上端 ${top} から離れている: ${sy}`)
  assert.ok(anchorsOf(arcs[1])[0][0] > cx, '2 つ目の弧が右側から始まっていない')
})

test('donut: highlight の弧だけが目立つ（mono は墨 100%・色のある紙は accent）、無ければ全部が墨の坂', () => {
  const sample = LOOKS.donut.sample()
  assert.equal(sample.highlight, '不動産')
  const mono = parts('donut', sample).paths.filter(curved).map((o) => o.opacity ?? 1)
  assert.equal(mono[4], 1)
  assert.ok(mono.slice(0, 4).every((a, i, all) => a < 1 && (i === 0 || a < all[i - 1])), `墨の坂が下がっていない: ${mono}`)
  const koma = parts('donut', sample, PALS.koma).paths.filter(curved)
  assert.deepEqual(koma.map((o) => filled(o, PALS.koma.accent)), [false, false, false, false, true])
  const none = parts('donut', { ...sample, highlight: undefined }).paths.filter(curved).map((o) => o.opacity ?? 1)
  assert.ok(none.every((a, i) => a < 1 && (i === 0 || a < none[i - 1])), `highlight が無いのに目立つ弧がある: ${none}`)
})

test('donut: 13 個以上は小さい順に「その他」へまとめ、割合は足して 100% のまま', () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ name: `項目${i + 1}`, value: 100 - i * 5 }))
  const d = parts('donut', { items })
  assert.equal(d.paths.filter(curved).length, 12)
  assert.ok(d.r.warnings.some((w) => w.includes('その他')), d.r.warnings.join())
  assert.ok(strings(d.texts).includes('その他'))
  assert.ok(Math.abs(sum(percents(d.texts)) - 100) <= 1)
})

test('donut: data.total があれば中央の数はそれになり、割合は項目の合計に対する割合のまま', () => {
  const d = parts('donut', { items: [{ name: 'a', value: 60 }, { name: 'b', value: 40 }], total: 500, unit: '円' })
  assert.ok(strings(d.texts).includes('500円'), strings(d.texts).join())
  assert.deepEqual(percents(d.texts), [60, 40])
})

// ---------------------------------------------------------------- treemap

test('treemap: 升の面積は値に比例し、図の高さの中に収まる', () => {
  const sample = LOOKS.treemap.sample()
  const d = parts('treemap', sample)
  const cells = d.paths.filter(boxy).filter((o) => bboxOf(o).x1 - bboxOf(o).x0 > 12)
  assert.equal(cells.length, sample.root.children.length)
  const values = sample.root.children.map((/** @type {{ value: number }} */ c) => c.value)
  // 溝の 2pt は小さい升ほど面積を削るので、値の大きい 5 つで比べる
  const big = cells.slice(0, 5)
  proportional(big.map((o) => { const b = bboxOf(o); return (b.x1 - b.x0) * (b.y1 - b.y0) }), values.slice(0, 5), 1.03)
  for (const o of cells) assert.ok(bboxOf(o).y1 <= d.r.height - 18, '升が下の注記にかかっている')
})

test('treemap: 升の色は delta の符号で上げ・下げ、無い・0 は墨の薄い段で、凡例は delta があるときだけ', () => {
  const sample = LOOKS.treemap.sample()
  const d = parts('treemap', sample)
  const cells = d.paths.filter(boxy)
  const colorOf = (/** @type {string} */ name) => {
    const t = d.texts.find((x) => textOf(x) === name)
    assert.ok(t, `${name} の字が無い`)
    const c = cellAt(cells, leftOf(t) + 1, t.y - 4)
    assert.ok(c, `${name} の升が無い`)
    return c
  }
  assert.ok(filled(colorOf('通信'), MONO.up), '+3.2% の升が上げの色でない')
  assert.ok(filled(colorOf('小売'), MONO.down), '-2.1% の升が下げの色でない')
  assert.ok(strings(d.texts).includes('前年比 増') && strings(d.texts).includes('前年比 減'))

  const flatData = { root: { name: 'r', children: [{ name: '甲', value: 60, delta: 0 }, { name: '乙', value: 40 }] } }
  const f = parts('treemap', flatData)
  const cellsOf = f.paths.filter((o) => boxy(o) && bboxOf(o).x1 - bboxOf(o).x0 > 12)
  assert.equal(cellsOf.length, 2)
  assert.ok(cellsOf.every((o) => filled(o, MONO.ink) && alphaIs(o, 0.14)), '0・無しの升が墨の薄い段でない')
  const plain = parts('treemap', { root: { name: 'r', children: [{ name: '甲', value: 60 }, { name: '乙', value: 40 }] } })
  assert.ok(!strings(plain.texts).some((s) => s.includes('増')), 'delta が無いのに凡例がある')
})

test('treemap: 名前は升に収まる時だけ書き、収まらない升は名前を省く（切れた名前を作らない）', () => {
  const small = parts('treemap', LOOKS.treemap.sample(), MONO, { width: 300 })
  const cells = small.paths.filter(boxy)
  const names = small.texts.filter((t) => t.size === 8 && lc(t.color) === lc(MONO.ink))
  assert.ok(names.length > 0)
  for (const t of names) {
    const c = cellAt(cells, leftOf(t) + 1, t.y - 4)
    assert.ok(c && leftOf(t) + textWidth(textOf(t), 8) <= bboxOf(c).x1 + 0.5, `${textOf(t)} が升からはみ出す`)
  }
  const d = parts('treemap', { root: { name: 'r', children: [{ name: '大きい', value: 1000 }, { name: 'とても長い名前の小さな葉', value: 1 }] } })
  assert.ok(strings(d.texts).includes('大きい'))
  assert.ok(!strings(d.texts).some((s) => s.includes('小さな葉')), '小さな升に名前を書いた')
})

test('treemap: 入れ子は組の名前を細い帯に書き、1 つの節の子が 24 を超えたら「その他」にまとめて合計を保つ', () => {
  const nested = { root: { name: 'r', children: [{ name: 'A群', children: [{ name: 'a1', value: 50 }, { name: 'a2', value: 30 }] }, { name: 'B群', children: [{ name: 'b1', value: 20 }] }] } }
  const d = parts('treemap', nested)
  const group = d.texts.find((t) => textOf(t) === 'A群')
  assert.ok(group && group.size === 7.5 && lc(group.color) === lc(MONO.sub), '組の名前が sub の 7.5pt でない')
  assert.ok(strings(d.texts).includes('a1'))

  const wide = { root: { name: 'r', children: Array.from({ length: 30 }, (_, i) => ({ name: `葉${i + 1}`, value: 30 - i })) } }
  const n = LOOKS.treemap.normalize(wide)
  const kids = n.data.root.children
  assert.equal(kids.length, 24)
  assert.equal(kids[23].other, true)
  near(sum(kids.map((/** @type {{ value: number }} */ k) => k.value)), sum(wide.root.children.map((c) => c.value)))
  assert.ok(n.warnings.some((w) => w.includes('その他')))
})

// ---------------------------------------------------------------- circle-pack

test('circle-pack: 葉の円の面積は値に比例し、組は細い外形線 1 本ずつ', () => {
  const sample = LOOKS['circle-pack'].sample()
  const d = parts('circle-pack', sample)
  const leaves = sample.root.children.flatMap((/** @type {{ children: { value: number }[] }} */ g) => g.children)
  const circles = d.paths.filter(curved)
  assert.equal(circles.length, leaves.length)
  // 描く順は組ごとの葉の順（値の大きい順）なので、同じ順の値と比べる
  proportional(circles.map(areaOf), leaves.map((/** @type {{ value: number }} */ l) => l.value), 1.03)
  assert.equal(d.paths.filter(stroked).length, sample.root.children.length)
})

test('circle-pack: 組の名前と合計は外形線のあいた所に書き、合計は右下・単位は左下', () => {
  const d = parts('circle-pack', LOOKS['circle-pack'].sample())
  const s = strings(d.texts)
  assert.ok(s.includes('関東 55') && s.includes('北海道 15'), s.join())
  const group = d.texts.find((t) => textOf(t) === '関東 55')
  assert.ok(group && lc(group.color) === lc(MONO.sub))
  const total = d.texts.find((t) => textOf(t) === '169')
  assert.ok(total && total.size === 14 && leftOf(total) > d.r.width * 0.8, '合計が右下にない')
  const unit = d.texts.find((t) => textOf(t) === '単位: 千人')
  assert.ok(unit && leftOf(unit) < 20)
})

test('circle-pack: root の子が全部葉なら組の線も名前もなく、葉の円だけを詰める', () => {
  const d = parts('circle-pack', { root: { name: 'r', children: [{ name: '甲', value: 40 }, { name: '乙', value: 30 }, { name: '丙', value: 20 }] } })
  assert.equal(d.paths.filter(stroked).length, 0)
  assert.equal(d.paths.filter(curved).length, 3)
})

// ---------------------------------------------------------------- funnel

test('funnel: 棒の幅は値に比例する', () => {
  const sample = LOOKS.funnel.sample()
  const d = parts('funnel', sample)
  const bars = d.paths.filter((o) => boxy(o) && filled(o, MONO.ink) && alphaIs(o, 0.25))
  assert.equal(bars.length, sample.items.length)
  proportional(bars.map((o) => { const b = bboxOf(o); return b.x1 - b.x0 }), sample.items.map((/** @type {{ value: number }} */ i) => i.value), 1.003)
})

test('funnel: 前の段に対する割合がいちばん低い段だけ、台形と割合と「離脱」の数が下げの色', () => {
  const d = parts('funnel', LOOKS.funnel.sample())
  const bad = d.paths.filter((o) => boxy(o) && filled(o, MONO.down))
  assert.equal(bad.length, 1)
  const ss = strings(d.texts)
  assert.deepEqual(ss.filter((s) => /^\d+%$/.test(s)), ['87%', '83%', '32%', '40%'])
  const red = d.texts.filter((t) => lc(t.color) === lc(MONO.down)).map(textOf)
  assert.deepEqual(red, ['32%', '離脱 4,000'])

  const drop = parts('funnel', { items: [{ name: 'a', value: 100 }, { name: 'b', value: 80 }, { name: 'c', value: 20 }, { name: 'd', value: 10 }] })
  assert.deepEqual(drop.texts.filter((t) => lc(t.color) === lc(MONO.down)).map(textOf), ['25%', '離脱 60'])
})

test('funnel: 増える段だけの data は「離脱」を作らない', () => {
  const d = parts('funnel', { items: [{ name: '前', value: 10 }, { name: '後', value: 20 }] })
  assert.equal(d.paths.filter((o) => filled(o, MONO.down)).length, 0)
  assert.ok(!strings(d.texts).some((s) => s.includes('離脱')))
})

test('funnel: 離脱の数は切らずに全部書くか、入らなければ書かない（切れた数は別の数に読める）', () => {
  const d = parts('funnel', { items: [{ name: '訪問', value: 120000 }, { name: '登録', value: 100 }] })
  const lost = strings(d.texts).filter((s) => s.startsWith('離脱'))
  assert.ok(lost.every((s) => s === '離脱 119,900'), lost.join())
  assert.ok(strings(d.texts).includes('0.1%'))
  const long = parts('funnel', { items: [{ name: '最初の段の名前がとても長い物', value: 100 }, { name: '最後の段の名前もとても長い物', value: 10 }] }, MONO, { width: 300 })
  assert.ok(strings(long.texts).some((s) => s.includes('10%')), '名前が長いと割合まで消えた')
})

test('funnel: 段は 12 までで、超えたら警告にして先頭から描く', () => {
  const items = Array.from({ length: 15 }, (_, i) => ({ name: `段${i + 1}`, value: 1000 - i * 50 }))
  const d = parts('funnel', { items })
  assert.equal(d.paths.filter((o) => boxy(o) && filled(o, MONO.ink) && alphaIs(o, 0.25)).length, 12)
  assert.ok(d.r.warnings.length > 0)
})

// ---------------------------------------------------------------- icicle

test('icicle: 列は階層の数で、見出しは data.levels（無ければ「N 段目」）', () => {
  const sample = LOOKS.icicle.sample()
  const d = parts('icicle', sample)
  const heads = sample.levels.map((/** @type {string} */ h) => d.texts.find((t) => textOf(t) === h))
  assert.ok(heads.every(Boolean), strings(d.texts).join())
  assert.ok(leftOf(heads[0]) < leftOf(heads[1]) && leftOf(heads[1]) < leftOf(heads[2]), '見出しが左から階層の順でない')

  const one = parts('icicle', { root: { name: 'r', children: [{ name: '甲', value: 3 }, { name: '乙', value: 1 }] } })
  assert.ok(strings(one.texts).includes('1 段目') && !strings(one.texts).includes('2 段目'))
})

test('icicle: 升の高さは値に比例し、4 階層目より深い所は 3 階層目にまとめて警告にする', () => {
  const d = parts('icicle', LOOKS.icicle.sample())
  const top = d.paths.filter((o) => boxy(o) && filled(o, MONO.ink) && alphaIs(o, 0.25))
  assert.equal(top.length, 3)
  // 升は 1pt の溝の分だけ縮めてあるので、高さに 1 を足して比べる
  proportional(top.map((o) => bboxOf(o).y1 - bboxOf(o).y0 + 1), [1108, 512, 222], 1.01)

  const deep = { root: { name: 'r', children: [{ name: 'L1', children: [{ name: 'L2', children: [{ name: 'L3', children: [{ name: 'L4', children: [{ name: 'L5', value: 5 }] }] }] }] }] } }
  const n = parts('icicle', deep)
  assert.ok(n.r.warnings.some((w) => w.includes('3 階層')), n.r.warnings.join())
  assert.ok(strings(n.texts).includes('3 段目') && !strings(n.texts).includes('4 段目'))
})

test('icicle: 目立たせる升は 1 つだけ（既定は最大の葉・highlight で替わる・色のある紙は accent）', () => {
  const sample = LOOKS.icicle.sample()
  const heightOf = (/** @type {any[]} */ ps) => { const b = bboxOf(ps[0]); return b.y1 - b.y0 + 1 }
  const hot = (/** @type {any} */ data, /** @type {any} */ pal = MONO) => {
    const d = parts('icicle', data, pal)
    return { d, cells: d.paths.filter((o) => boxy(o) && (pal === MONO ? alphaIs(o, 0.4) : filled(o, pal.accent))) }
  }
  const byDefault = hot(sample)
  assert.equal(byDefault.cells.length, 1)
  const pick = hot({ ...sample, highlight: '賃借料' })
  assert.equal(pick.cells.length, 1)
  // 最大の葉（基本給 176）と 賃借料（96）の高さの比は値の比
  const ratio = heightOf(byDefault.cells) / heightOf(pick.cells)
  assert.ok(Math.abs(ratio / (176 / 96) - 1) < 0.01, `高さの比 ${ratio}`)
  assert.equal(hot(sample, PALS.koma).cells.length, 1)
  assert.ok(LOOKS.icicle.normalize({ ...sample, highlight: '無い名前' }).warnings.some((w) => w.includes('highlight')))
})

// ---------------------------------------------------------------- polar-area

test('polar-area: 扇の面積は値に比例し（半径は穴からの平方根）、扇の数は項目の数', () => {
  const sample = LOOKS['polar-area'].sample()
  const d = parts('polar-area', sample)
  const wedges = d.paths.filter(curved)
  assert.equal(wedges.length, 12)
  proportional(wedges.map(areaOf), sample.items.map((/** @type {{ value: number }} */ i) => i.value), 1.12)
})

test('polar-area: 最大の扇だけが目立ち（mono は墨 80%）、右上に最大の値と名前、highlight で替わる', () => {
  const sample = LOOKS['polar-area'].sample()
  const d = parts('polar-area', sample)
  const wedges = d.paths.filter(curved)
  const hot = wedges.filter((o) => alphaIs(o, 0.8))
  assert.equal(hot.length, 1)
  assert.equal(wedges.indexOf(hot[0]), 10)
  const s = strings(d.texts)
  assert.ok(s.includes('最大 8月') && s.includes('312万円'))
  const name = d.texts.find((t) => textOf(t) === '8月')
  assert.ok(name && lc(name.color) === lc(MONO.accent))

  const pick = parts('polar-area', { ...sample, highlight: '10月' })
  assert.equal(pick.paths.filter(curved).findIndex((o) => alphaIs(o, 0.8)), 0)
  assert.ok(strings(pick.texts).includes('注目 10月') && strings(pick.texts).includes('84万円'))
  assert.equal(parts('polar-area', sample, PALS.koma).paths.filter((o) => filled(o, PALS.koma.accent)).length, 1)
})

test('polar-area: 外の輪ほど間が詰まっても、輪の値の字どうしは重ならない', () => {
  // 値 3・5・8 は輪が 2・4・6・8 で、最大の輪の字と 6 の輪の字が同じ高さに来る
  const d = parts('polar-area', { items: [{ name: '北', value: 5 }, { name: '東', value: 8 }, { name: '南', value: 3 }] })
  const ys = d.texts.filter((t) => /^[0-9]$/.test(textOf(t)) && t.size === 7.5).map((t) => t.y).sort((a, b) => a - b)
  assert.ok(ys.length >= 3, `輪の値の字が ${ys.length} 個`)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 7.5, `輪の値の字が ${ys[i] - ys[i - 1]}pt しか離れていない`)
})

test('polar-area: 値が 0 の月は枠と名前を残して扇だけ描かない（詰めると後の月が前へずれる）', () => {
  const d = parts('polar-area', { items: [{ name: '北', value: 5 }, { name: '東', value: 0 }, { name: '南', value: 3 }, { name: '西', value: 8 }] })
  assert.equal(d.r.warnings.length, 0, d.r.warnings.join())
  assert.equal(d.paths.filter(curved).length, 3)
  const at = (/** @type {string} */ n) => {
    const t = d.texts.find((x) => textOf(x) === n)
    assert.ok(t, `${n} の名前が無い`)
    return t
  }
  const cx = MEASURE / 2
  // 4 つの枠は 90 度ずつ: 北は右上・東は右下・南は左下・西は左上
  assert.ok(leftOf(at('北')) > cx && leftOf(at('東')) > cx && leftOf(at('南')) < cx && leftOf(at('西')) < cx)
  assert.ok(at('北').y < at('東').y && Math.abs(at('北').y - at('西').y) < 1 && Math.abs(at('東').y - at('南').y) < 1)

  const none = parts('polar-area', { items: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }] })
  assert.ok(none.r.warnings.some((w) => w.includes('すべて 0')))
  assert.equal(none.paths.filter(curved).length, 0)
  assert.ok(parts('polar-area', { items: [{ name: 'a', value: -1 }, { name: 'b', value: 4 }] }).r.warnings.length > 0, '負の値を黙って描いた')
})

test('polar-area: 輪の値は切りのよい数（100・200・300）、扇は 36 までで超えたら警告', () => {
  const d = parts('polar-area', LOOKS['polar-area'].sample())
  const s = strings(d.texts)
  for (const v of ['100', '200', '300']) assert.ok(s.includes(v), `輪の値 ${v} が無い`)
  const items = Array.from({ length: 40 }, (_, i) => ({ name: `${i + 1}`, value: 10 + (i % 7) * 5 }))
  const many = parts('polar-area', { items })
  assert.equal(many.paths.filter(curved).length, 36)
  assert.ok(many.r.warnings.length > 0)
})

// ---------------------------------------------------------------- sunburst

test('sunburst: 環は階層の数だけ（墨の段 25・14・8%）で、2 階層の木なら 2 段', () => {
  const opacities = (/** @type {any} */ data) => [...new Set(parts('sunburst', data).paths.filter(curved).map((o) => o.opacity ?? 1))].sort((a, b) => b - a)
  // 見本は highlight が 3 階層目にあり、目立つ扇は 40%
  assert.deepEqual(opacities(LOOKS.sunburst.sample()), [0.4, 0.25, 0.14, 0.08])
  const two = { root: { name: 'r', children: [{ name: 'A', children: [{ name: 'a1', value: 4 }, { name: 'a2', value: 2 }] }, { name: 'B', children: [{ name: 'b1', value: 3 }] }] } }
  assert.deepEqual(opacities({ ...two, highlight: 'a1' }), [0.4, 0.25, 0.14])
})

test('sunburst: いちばん上の環の扇の面積は値に比例し、右の一覧が名前と値を環の順に持つ', () => {
  const sample = LOOKS.sunburst.sample()
  const d = parts('sunburst', sample)
  const ring1 = d.paths.filter((o) => curved(o) && alphaIs(o, 0.25))
  assert.equal(ring1.length, sample.root.children.length)
  const tops = [168, 121, 58, 31]
  proportional(ring1.slice(0, 4).map(areaOf), tops, 1.12)
  // 一覧の行: 名前は同じ x から始まり、上から下へ値の大きい順
  const rows = ['食品', '衣料', '家電', '日用品', '家具', '文具', '書籍'].map((n) => d.texts.filter((t) => textOf(t) === n).at(-1))
  assert.ok(rows.every(Boolean))
  const xs = new Set(rows.map((t) => t && leftOf(t).toFixed(1)))
  assert.equal(xs.size, 1, '一覧の名前の x がそろっていない')
  const ys = rows.map((t) => t && t.y)
  assert.deepEqual([...ys].sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b)), ys)
})

test('sunburst: 目立たせる扇は 1 つ（highlight・無ければ最大の葉）で、名前は回さず横向きのまま', () => {
  const sample = LOOKS.sunburst.sample()
  const d = parts('sunburst', sample)
  assert.equal(d.paths.filter((o) => curved(o) && alphaIs(o, 0.4)).length, 1)
  assert.ok(strings(d.texts).includes('注目') && strings(d.texts).includes('コート'))
  const largest = parts('sunburst', { ...sample, highlight: undefined })
  assert.ok(strings(largest.texts).includes('最大'))
  assert.ok(!/rotate\(|matrix\(/.test(d.r.svg), '字を回している（svg.mjs は回した字を読めない）')
  assert.ok(d.r.warnings.length === 0)
  assert.equal(parts('sunburst', sample, PALS.koma).paths.filter((o) => filled(o, PALS.koma.accent)).length, 1)
})

// ---------------------------------------------------------------- waterfall

test('waterfall: 期末 = 期首 + 増減の合計で、各棒は前の棒が終わった水準から始まる', () => {
  const sample = LOOKS.waterfall.sample()
  const { data } = LOOKS.waterfall.normalize(sample)
  const { bars, start, end } = barsOf(data)
  near(start, 22)
  const moves = sample.items.filter((/** @type {{ total?: boolean }} */ i) => !i.total).map((/** @type {{ value: number }} */ i) => i.value)
  near(end, 22 + sum(moves), 1e-9)
  near(bars.at(-1)?.value ?? NaN, end, 1e-9)
  for (let i = 1; i < bars.length - 1; i++) near(bars[i].from, bars[i - 1].to, 1e-9)
  assert.ok(strings(parts('waterfall', sample).texts).includes('18.2'), '期末の値の字が 18.2 でない')
})

test('waterfall: 小計（total: true）は水準をその値に置き直す', () => {
  const { data } = LOOKS.waterfall.normalize({ items: [{ name: '期首', value: 100, total: true }, { name: '減', value: -20 }, { name: '小計', value: 70, total: true }, { name: '増', value: 5 }], total: '期末' })
  const { bars, end } = barsOf(data)
  assert.deepEqual(bars.map((b) => [b.from, b.to]), [[0, 100], [100, 80], [0, 70], [70, 75], [0, 75]])
  near(end, 75)
})

test('waterfall: 棒の高さは増減の大きさに比例し、上げは上げの色・下げは下げの色で、つなぎは棒の数より 1 本少ない', () => {
  const sample = LOOKS.waterfall.sample()
  const d = parts('waterfall', sample)
  const bars = d.paths.filter((o) => boxy(o) && alphaIs(o, 0.55))
  assert.equal(bars.length, sample.items.length + 1)
  const move = bars.slice(1, -1)
  const values = sample.items.slice(1).map((/** @type {{ value: number }} */ i) => i.value)
  proportional(move.map((o) => bboxOf(o).y1 - bboxOf(o).y0), values.map(Math.abs), 1.01)
  move.forEach((o, i) => assert.ok(filled(o, values[i] >= 0 ? MONO.up : MONO.down), `${i + 1} 本目の色`))
  // 0 の線 1 本 + つなぎ（棒の数 - 1）
  assert.equal(d.paths.filter(stroked).length, bars.length)
  // 浮いた棒の始まりは前の棒の終わりの高さ
  for (let i = 1; i < bars.length - 1; i++) {
    const prev = bboxOf(bars[i - 1])
    const here = bboxOf(bars[i])
    const prevEnd = i > 1 && values[i - 2] < 0 ? prev.y1 : prev.y0
    const hereStart = values[i - 1] >= 0 ? here.y1 : here.y0
    near(prevEnd, hereStart, 0.05)
  }
})

test('waterfall: 水準が負になる data は 0 の線の下へ棒が伸び、期末の棒も 0 の線から下へ', () => {
  const d = parts('waterfall', { items: [{ name: '期首', value: 5, total: true }, { name: '損失', value: -8 }] })
  const zero = d.paths.find(stroked)
  assert.ok(zero)
  const zeroY = bboxOf(zero).y0
  const bars = d.paths.filter((o) => boxy(o) && alphaIs(o, 0.55))
  assert.equal(bars.length, 3)
  const closing = bboxOf(bars[2])
  near(closing.y0, zeroY, 0.05)
  assert.ok(closing.y1 > zeroY + 1, '負の期末の棒が 0 の線の下に伸びていない')
  assert.ok(strings(d.texts).includes('-3'), strings(d.texts).join())
})

test('waterfall: 最後の棒の名前は data.total（省くと「合計」・false なら棒を足さない）', () => {
  const items = [{ name: '期首', value: 10, total: true }, { name: '増', value: 4 }]
  const named = (/** @type {any} */ total) => strings(parts('waterfall', { items, ...(total === undefined ? {} : { total }) }).texts)
  assert.ok(named(undefined).includes('合計'))
  assert.ok(named('年度末').includes('年度末'))
  const none = parts('waterfall', { items, total: false })
  assert.equal(none.paths.filter((o) => boxy(o) && alphaIs(o, 0.55)).length, 2)
  assert.ok(!strings(none.texts).includes('合計'))
  assert.equal(barsOf(LOOKS.waterfall.normalize({ items, total: false }).data).bars.length, 2)
})

test('waterfall: 項目は 30 までで、超えたら警告にして先頭から描く', () => {
  const items = [{ name: '期首', value: 100, total: true }, ...Array.from({ length: 39 }, (_, i) => ({ name: `増減${i + 1}`, value: i % 2 ? -3 : 4 }))]
  const d = parts('waterfall', { items })
  assert.equal(d.paths.filter((o) => boxy(o) && alphaIs(o, 0.55)).length, 31)
  assert.ok(d.r.warnings.length > 0)
})

// ---------------------------------------------------------------- 木の形の共通部（parts-kit）

test('木: 「その他」は値が大きくても並びの最後で、環・升の並びが data の並び（右の一覧）とそろう', () => {
  /** @type {string[]} */
  const warnings = []
  const root = normalizeTree({ root: { name: 'r', children: Array.from({ length: 30 }, (_, i) => ({ name: `部門${i + 1}`, value: 100 - i * 3 })) } }, 'x', warnings)
  if (!root) throw new Error('木が作れない')
  const kids = valueTree(hierarchy, root).children
  assert.equal(kids.length, 24)
  assert.equal(kids.at(-1).data.other, true)
  assert.ok(kids.at(-1).value > kids[0].value, '見本の「その他」が最大にならない')
  assert.deepEqual(kids.slice(0, -1).map((/** @type {any} */ k) => k.data.name), (root.children ?? []).slice(0, -1).map((k) => k.name))
})

test('木: 目立たせる扇・升の既定は最大の葉で、まとめた「その他」は選ばない', () => {
  const data = { root: { name: 'r', children: Array.from({ length: 30 }, (_, i) => ({ name: `部門${i + 1}`, value: 100 - i * 3 })) } }
  const s = LOOKS.sunburst.normalize(data).data
  assert.ok(s.hot && !s.hot.other)
  assert.equal(s.hot.name, '部門1')
})
