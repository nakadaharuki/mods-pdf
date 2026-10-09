// @ts-check
// time の束（sparks・bars・area-threshold・bump・multi-line・stacked-area・step-line・streamgraph）の試験。
// candle は test/looks.test.mjs（手本の 2 つ）。全部の形に test/looks-kit.mjs の共通の確かめを掛け、形ごとに大事な振る舞いを 1 つ以上確かめる。
// 試験の名前は「何を保証するか」を書く。見本の数を直に打ち込むのは、見本が元の look と同じ種で作られる（数が動かない）形だけ。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook } from '../hooks/engine/looks/index.mjs'
import sparks from '../hooks/engine/looks/sparks.mjs'
import bars from '../hooks/engine/looks/bars.mjs'
import areaThreshold from '../hooks/engine/looks/area-threshold.mjs'
import bump, { rankColumns } from '../hooks/engine/looks/bump.mjs'
import multiLine from '../hooks/engine/looks/multi-line.mjs'
import stackedArea, { bandSteps } from '../hooks/engine/looks/stacked-area.mjs'
import stepLine from '../hooks/engine/looks/step-line.mjs'
import streamgraph, { pickSteps } from '../hooks/engine/looks/streamgraph.mjs'
import { readSeries, evenLabels, yScale, isoDays } from '../hooks/engine/looks/time-series.mjs'
import { testLook, toOps, flat, textOf, bboxOf, metrics, PALS, MEASURE } from './looks-kit.mjs'

const MONO = PALS.mono
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)
const same = (/** @type {string} */ a, /** @type {string} */ b) => a.toLowerCase() === b.toLowerCase()

for (const id of ['sparks', 'bars', 'area-threshold', 'bump', 'multi-line', 'stacked-area', 'step-line', 'streamgraph']) testLook(id)

/** 描いた物を役割で分ける @param {string} id @param {any} data @param {any} [pal] @param {any} [opts] */
function parts(id, data, pal = MONO, opts = {}) {
  const r = drawLook(id, data, { width: MEASURE, pal, ...opts })
  const ops = flat(toOps(r, pal).ops)
  return {
    r, ops,
    paths: ops.filter((o) => o.t === 'path'),
    texts: ops.filter((o) => o.t === 'text'),
    strings: ops.filter((o) => o.t === 'text').map(textOf),
  }
}
/** 字の右端（書体の送り幅で測る） @param {any} t */
const right = (t) => {
  const g = t.glyphs[t.glyphs.length - 1]
  return g.x + metrics[t.font].adv(g.c.codePointAt(0)) * t.size
}
const days = (/** @type {number} */ n) => isoDays(2026, 9, 1, n)

// ---------------------------------------------------------------- 共通の読み取り（time-series）

test('time-series: 数でない値は欠測（NaN）にして warnings に書き、系列の長さを x に揃える', () => {
  const { data, warnings } = readSeries({ x: ['a', 'b', 'c'], series: [{ name: 'A', values: [1, null, 'x'] }, { name: 'B', values: [1, 2] }], unit: '件' }, 'テスト')
  assert.deepEqual(data.x, ['a', 'b', 'c'])
  assert.equal(data.rows.length, 2)
  assert.equal(data.rows[0].values[0], 1)
  assert.ok(Number.isNaN(data.rows[0].values[1]) && Number.isNaN(data.rows[0].values[2]))
  assert.equal(data.rows[1].values.length, 3, '短い系列は x の長さまで欠測で埋める')
  assert.ok(warnings.length > 0)
})

test('time-series: 点が 800 を超えたら等間隔に間引き、warnings に書く', () => {
  const x = Array.from({ length: 2000 }, (_, i) => String(i))
  const { data, warnings } = readSeries({ x, series: [{ name: 'A', values: x.map((_, i) => i) }] }, 'テスト')
  assert.ok(data.n <= 800 && data.rows[0].values.length === data.n)
  assert.ok(warnings.some((w) => /800|間引/.test(w)), warnings.join(' / '))
})

test('time-series: yScale の目盛りは 1 つの刻み幅の倍数で、端が範囲を覆う（目盛りと端が食い違わない）', () => {
  for (const [lo, hi] of [[100, 700], [0.21, 0.97], [-300, 259], [3, 3], [0, 1e6]]) {
    const s = yScale(lo, hi, 20, 200, { count: 4 })
    const step = s.ticks.length > 1 ? s.ticks[1] - s.ticks[0] : 1
    s.ticks.forEach((t, i) => i && near(t - s.ticks[i - 1], step, Math.abs(step) * 1e-9 + 1e-12))
    assert.ok(s.ticks[0] <= lo + 1e-9 && s.ticks[s.ticks.length - 1] >= hi - 1e-9, `${lo}〜${hi} の目盛り ${s.ticks}`)
    assert.ok(s.y(s.ticks[0]) <= 200 + 1e-6 && s.y(s.ticks[s.ticks.length - 1]) >= 20 - 1e-6)
  }
})

test('time-series: evenLabels の字は幅に応じて間引かれ、隣と重ならず、左右の端の中に収まる', () => {
  const labels = Array.from({ length: 60 }, (_, i) => `${9 + Math.floor(i / 30)}/${(i % 30) + 1}`)
  for (const [lo, hi] of [[4, 499.5], [4, 160], [4, 100]]) {
    const at = (/** @type {number} */ i) => lo + 26 + (i * (hi - lo - 52)) / 59
    const svg = evenLabels(labels, at, { lo, hi }, 100, MONO)
    const r = { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 120">${svg}</svg>`, width: 500, height: 120 }
    const ts = flat(toOps(r, MONO).ops).filter((o) => o.t === 'text')
    assert.ok(ts.length >= (hi > 200 ? 4 : 1), `幅 ${hi} で ${ts.length} 個`)
    ts.forEach((t, i) => {
      assert.ok(t.glyphs[0].x >= lo - 1e-6 && right(t) <= hi + 1e-6, `${textOf(t)} が端を越えた`)
      if (i) assert.ok(t.glyphs[0].x > right(ts[i - 1]), `${textOf(ts[i - 1])} と ${textOf(t)} が重なる`)
    })
  }
})

// ---------------------------------------------------------------- sparks

test('sparks: 行ごとに自分の最小〜最大を使うので、桁の違う指標でも線の高さが同じ', () => {
  const data = { x: days(6), series: [{ name: '小', values: [1, 2, 3, 2, 4, 3] }, { name: '大', values: [1000, 3000, 2000, 5000, 4000, 1000] }] }
  const { r, paths } = parts('sparks', data)
  const lines = paths.filter((o) => o.stroke && o.lw === 1 && o.opacity === 0.85)
  assert.equal(lines.length, 2)
  const span = (/** @type {any} */ o) => { const b = bboxOf(o); return b.y1 - b.y0 }
  const row = (r.height - 6 - 18) / 2
  near(span(lines[0]), row * 0.56, 0.05)
  near(span(lines[1]), row * 0.56, 0.05)
})

test('sparks: 値は右端に右揃えの太字で、最後の数の値に単位が付く。欠測で終わる行は最後の数の値', () => {
  const data = { x: days(4), series: [{ name: 'A', values: [1, 2, 3, 7], unit: '件' }, { name: 'B', values: [5, 9, null, null], unit: '%' }] }
  const { texts, strings } = parts('sparks', data)
  assert.ok(strings.includes('7件') && strings.includes('9%'), strings.join(','))
  for (const s of ['7件', '9%']) {
    const t = texts.find((x) => textOf(x) === s)
    assert.equal(t.font, 'sansBold')
    near(right(t), MEASURE - 4, 1)
  }
})

test('sparks: 行どうしの間にだけ細い線が引かれる（行数 - 1 本・最後の行の後には引かない）', () => {
  const { r, paths } = parts('sparks', sparks.sample())
  const seps = paths.filter((o) => o.stroke && o.lw === 1 && o.opacity < 0.5 && !o.dash).filter((o) => { const b = bboxOf(o); return b.y0 === b.y1 && b.x1 - b.x0 > r.width * 0.9 })
  assert.equal(seps.length, 5)
})

test('sparks: 最後の値に点（半径 2）が 1 つずつあり、線の最初と最後の x の字が一番下に出る', () => {
  const { paths, strings } = parts('sparks', sparks.sample())
  const dots = paths.filter((o) => o.fill && o.opacity === undefined && String(o.d).includes('C') && bboxOf(o).x1 - bboxOf(o).x0 < 4.5)
  assert.equal(dots.length, 6)
  assert.ok(strings.includes('8/11') && strings.includes('10/9'), strings.join(','))
})

// ---------------------------------------------------------------- bars

test('bars: いちばん大きい棒（絶対値）だけが太字の値を持ち、マイナスなら棒の下・符号つき', () => {
  const data = { x: ['a', 'b', 'c', 'd', 'e'], series: [{ name: 'N', values: [10, -50, 30, 5, -20] }], unit: '人' }
  const { texts } = parts('bars', data)
  const bold = texts.filter((t) => t.font === 'sansBold')
  assert.equal(bold.length, 1)
  assert.equal(textOf(bold[0]), '-50人')
  const zero = texts.find((t) => textOf(t) === '0人')
  assert.ok(bold[0].y > zero.y, 'マイナスの値は零の線より下')
})

test('bars: 棒は値の数だけで、プラスは pal.up・マイナスは pal.down、零を中心に上下に伸びる', () => {
  const data = { x: ['a', 'b', 'c', 'd'], series: [{ name: 'N', values: [10, -5, 0, 8] }] }
  const { paths } = parts('bars', data)
  const bodies = paths.filter((o) => o.fill && o.opacity === 0.55)
  assert.equal(bodies.length, 3 + 1, '値が 0 の棒も 1pt の高さで残す')
  assert.equal(bodies.filter((o) => same(o.fill, MONO.up)).length, 3)
  assert.equal(bodies.filter((o) => same(o.fill, MONO.down)).length, 1)
  const zeroLine = paths.find((o) => o.stroke && o.opacity === 0.35 && bboxOf(o).y0 === bboxOf(o).y1)
  assert.ok(zeroLine, '零の線（墨の 35%）が無い')
  const zeroY = bboxOf(zeroLine).y0
  const up = bboxOf(bodies[0])
  const down = bboxOf(bodies[1])
  near(up.y1, zeroY, 0.02)
  near(down.y0, zeroY, 0.02)
})

test('bars: 全部が 0 以上なら、目盛りに符号が付かず零から片側だけ伸びる', () => {
  const { strings, paths } = parts('bars', { x: ['a', 'b', 'c'], series: [{ name: 'N', values: [3, 9, 6] }] })
  assert.ok(!strings.some((s) => /^[+-]/.test(s)), strings.join(','))
  assert.ok(strings.includes('9'), '最大の値')
  assert.equal(paths.filter((o) => o.fill && o.opacity === 0.55).length, 3)
})

test('bars: 棒が 200 本を超えたらまとめて 200 本以内にし、warnings に書く', () => {
  const x = Array.from({ length: 500 }, (_, i) => String(i))
  const { r, paths } = parts('bars', { x, series: [{ name: 'N', values: x.map((_, i) => (i % 7) - 3) }] })
  assert.ok(r.warnings.length > 0)
  assert.ok(paths.filter((o) => o.fill && o.opacity === 0.55).length <= 200)
})

// ---------------------------------------------------------------- area-threshold

test('area-threshold: 見出しはしきい値を超えた点の数と区間の数を data から数える', () => {
  const data = { x: days(8), series: [{ name: 'P', values: [100, 400, 350, 100, 500, 100, 100, 320] }], threshold: 300, unit: 'ms' }
  const { texts, strings } = parts('area-threshold', data)
  const hero = texts.find((t) => t.size === 14)
  assert.equal(textOf(hero), '4 点')
  assert.ok(strings.includes('しきい値を超えた点（3 区間）'), strings.join(','))
})

test('area-threshold: 超過が無ければ「超過なし」で、pal.down の物は何も描かない', () => {
  const data = { x: days(5), series: [{ name: 'P', values: [100, 200, 150, 120, 90] }], threshold: 300, unit: 'ms' }
  const { ops, strings } = parts('area-threshold', data)
  assert.ok(strings.includes('超過なし'), strings.join(','))
  assert.ok(!ops.some((o) => (o.fill && same(o.fill, MONO.down)) || (o.stroke && same(o.stroke, MONO.down)) || (o.t === 'text' && same(o.color, MONO.down))))
  assert.ok(!ops.some((o) => o.t === 'clip'))
})

test('area-threshold: 超過の面（pal.down の 25%）と線（pal.down の 1pt）は、しきい値の線より上の帯に切り抜かれる', () => {
  const { r, ops, paths } = parts('area-threshold', areaThreshold.sample())
  const clipOp = ops.find((o) => o.t === 'clip')
  assert.ok(clipOp, '切り抜きが無い')
  const dash = paths.find((o) => o.dash)
  assert.ok(dash)
  const thrY = bboxOf(dash).y0
  near(clipOp.y + clipOp.h, thrY, 0.05)
  assert.ok(clipOp.y < thrY && clipOp.y + clipOp.h <= r.height)
  assert.ok(paths.some((o) => o.fill && same(o.fill, MONO.down) && o.opacity === 0.25))
  assert.ok(paths.some((o) => o.stroke && same(o.stroke, MONO.down) && o.lw === 1))
})

test('area-threshold: しきい値は墨の 35% の点線（3 3）で右の余白まで伸び、名前と値を持つ', () => {
  const { paths, strings } = parts('area-threshold', areaThreshold.sample())
  const dashed = paths.filter((o) => o.dash)
  assert.equal(dashed.length, 1)
  assert.deepEqual(dashed[0].dash, [3, 3])
  near(dashed[0].opacity, 0.35)
  near(bboxOf(dashed[0]).x1, MEASURE - 4, 0.01)
  assert.ok(strings.includes('しきい値') && strings.filter((s) => s === '300 ms').length === 2, strings.join(','))
})

test('area-threshold: 最大の点は超過の中なら pal.down の太字の値と点を持ち、最後の値は右の余白の太字（しきい値の字と重ならない）', () => {
  const { texts } = parts('area-threshold', areaThreshold.sample())
  const peak = texts.find((t) => textOf(t) === '393 ms')
  assert.equal(peak.font, 'sansBold')
  assert.ok(same(peak.color, MONO.down))
  const lastV = texts.find((t) => textOf(t) === '150 ms')
  near(right(lastV), MEASURE - 4, 1)
  const thrTexts = texts.filter((t) => textOf(t) === 'しきい値' || textOf(t) === '300 ms')
  for (const t of thrTexts) assert.ok(Math.abs(t.y - lastV.y) >= 7, `${textOf(t)} と最後の値が縦に重なる`)
})

test('area-threshold: threshold が無ければ warnings に書き、超過は描かず見出しも置かない', () => {
  const data = { x: days(4), series: [{ name: 'P', values: [1, 5, 3, 2] }] }
  const n = areaThreshold.normalize(data)
  assert.ok(n.warnings.some((w) => w.includes('threshold')))
  const { ops, texts } = parts('area-threshold', data)
  assert.ok(!texts.some((t) => t.size === 14))
  assert.ok(!ops.some((o) => o.t === 'clip' || o.dash))
})

test('area-threshold: しきい値が図の下の端に近くても、名前と値は図の中に収まる', () => {
  const data = { x: days(6), series: [{ name: 'P', values: [900, 950, 1000, 980, 990, 970] }], threshold: 5 }
  const { r, texts } = parts('area-threshold', data)
  for (const t of texts) assert.ok(t.y <= r.height + 0.5 && t.y >= 0, `${textOf(t)} が y=${t.y}`)
})

// ---------------------------------------------------------------- bump

test('bump: 順位は期間ごとに 1 から系列の数までの並べ替えになり、同じ量は系列の並び順', () => {
  const n = bump.normalize(bump.sample())
  const ranks = rankColumns(n.data)
  for (let i = 0; i < n.data.n; i++) assert.deepEqual(ranks.map((r) => r[i]).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8])
  const tie = rankColumns(bump.normalize({ x: ['a', 'b'], series: [{ name: 'A', values: [5, 1] }, { name: 'B', values: [5, 1] }, { name: 'C', values: [9, 1] }] }).data)
  assert.deepEqual(tie.map((r) => r[0]), [2, 3, 1])
  assert.deepEqual(tie.map((r) => r[1]), [1, 2, 3])
})

test('bump: 欠測の期間は順位に入らず、残りが詰まる', () => {
  const ranks = rankColumns(bump.normalize({ x: ['a', 'b'], series: [{ name: 'A', values: [1, null] }, { name: 'B', values: [2, 3] }, { name: 'C', values: [3, 1] }] }).data)
  assert.deepEqual(ranks.map((r) => r[0]), [3, 2, 1])
  assert.ok(Number.isNaN(ranks[0][1]))
  assert.deepEqual(ranks.slice(1).map((r) => r[1]), [1, 2])
})

test('bump: 目立たせる線（1.5pt・墨 100%）は最後に描かれ、期間ごとに点（半径 2）が付く', () => {
  const { paths } = parts('bump', bump.sample())
  const strokes = paths.filter((o) => o.stroke && !o.dash && o.lw >= 1)
  const hot = strokes.filter((o) => o.lw === 1.5)
  assert.equal(hot.length, 1)
  const ordered = paths.filter((o) => o.stroke && (o.lw === 1 || o.lw === 1.5) && String(o.d).includes('C'))
  assert.equal(ordered[ordered.length - 1], hot[0], '目立たせる線が最後でない（交わりの上に載らない）')
  assert.equal(ordered.length, 8)
  const dots = paths.filter((o) => o.fill && o.opacity === undefined && bboxOf(o).x1 - bboxOf(o).x0 < 4.5)
  assert.equal(dots.length, 8)
})

test('bump: 目立たせる系列は data.highlight、無ければ最初から最後でいちばん順位を上げた系列（太字）', () => {
  const bold = (/** @type {any} */ data) => [...new Set(parts('bump', data).texts.filter((t) => t.font === 'sansBold').map(textOf))]
  assert.deepEqual(bold(bump.sample()), ['川崎店'])
  assert.deepEqual(bold({ ...bump.sample(), highlight: '渋谷店' }), ['渋谷店'])
  const flat3 = { x: days(3), series: [{ name: 'A', values: [3, 3, 3] }, { name: 'B', values: [2, 2, 2] }] }
  assert.deepEqual(bold(flat3), [], '上がった系列が無ければ、目立たせない')
})

test('bump: 名前は左右の両端に 1 つずつ、左は線の始まりの左・右は終わりの右', () => {
  const { texts } = parts('bump', bump.sample())
  for (const name of ['渋谷店', '川崎店', '船橋店']) {
    const ts = texts.filter((t) => textOf(t) === name)
    assert.equal(ts.length, 2, name)
    assert.ok(ts[0].glyphs[0].x < MEASURE / 2 && ts[1].glyphs[0].x > MEASURE / 2)
  }
})

// ---------------------------------------------------------------- multi-line

test('multi-line: 同じ値で終わる 2 本の名前と値は、ラベルの中心が 11pt 以上離れる', () => {
  const { texts } = parts('multi-line', multiLine.sample())
  const ends = texts.filter((t) => ['新宿店', '池袋店'].includes(textOf(t))).sort((a, b) => a.y - b.y)
  assert.equal(ends.length, 2)
  assert.ok(ends[1].y - ends[0].y >= 11 - 1e-6, `${ends[1].y - ends[0].y}`)
  const vals = texts.filter((t) => textOf(t) === '455人')
  assert.equal(vals.length, 2, '同じ値が 2 つとも出る')
})

test('multi-line: 見出しは目立たせる線の最初から最後への増減の %（data から計算）で、期間が添えられる', () => {
  const data = { x: days(3), series: [{ name: 'A', values: [100, 125, 150] }, { name: 'B', values: [100, 100, 101] }] }
  assert.ok(parts('multi-line', data).strings.includes('+50%'))
  const b = parts('multi-line', { ...data, highlight: 'B' }).strings
  assert.ok(b.includes('+1%'), b.join(','))
  const cap = parts('multi-line', data).strings.find((s) => s.startsWith('A（'))
  assert.equal(cap, 'A（9/1 から 9/3）')
})

test('multi-line: 目立たせる線を選べない（最初の値が 0）時は、見出しを置かず、線は全部ふつうの段で描く', () => {
  const data = { x: days(3), series: [{ name: 'A', values: [0, 5, 9] }, { name: 'B', values: [0, 3, 4] }] }
  const { texts, paths } = parts('multi-line', data)
  assert.ok(!texts.some((t) => t.size === 14))
  assert.ok(!paths.some((o) => o.lw === 1.5))
  assert.ok(!texts.some((t) => t.font === 'sansBold'))
})

test('multi-line: 目立たせる線（1.5pt）は最後に描かれ、ほかの線は 1pt で 55%・30% の段や点線に分かれる', () => {
  const { paths } = parts('multi-line', multiLine.sample())
  const lines = paths.filter((o) => o.stroke && String(o.d).startsWith('M') && (o.lw === 1 || o.lw === 1.5) && String(o.d).length > 200)
  assert.equal(lines.length, 4)
  assert.equal(lines[lines.length - 1].lw, 1.5)
  const others = lines.slice(0, -1)
  assert.ok(others.every((o) => o.lw === 1 && o.opacity < 1))
  assert.ok(new Set(others.map((o) => `${o.opacity}/${o.dash ?? ''}`)).size === 3, '3 本の見た目が違う')
})

test('multi-line: 系列が多いと図が高くなり、名前の列は幅に収まる', () => {
  const k = 14
  const data = { x: days(10), series: Array.from({ length: k }, (_, i) => ({ name: `系列${i}`, values: Array.from({ length: 10 }, (_, j) => i * 10 + j) })) }
  const n = multiLine.normalize(data).data
  assert.ok(multiLine.height(MEASURE, n) >= 70 + 11 * k)
  const { r, texts } = parts('multi-line', data)
  for (const t of texts) assert.ok(right(t) <= r.width + 1 && t.glyphs[0].x >= 0)
})

// ---------------------------------------------------------------- stacked-area

test('stacked-area: 帯ごとの合計の字を足すと見出しの期間の合計になる', () => {
  const { texts } = parts('stacked-area', stackedArea.sample())
  const money = (/** @type {any} */ t) => parseFloat(textOf(t).replace(/,/g, ''))
  const hero = texts.find((t) => t.size === 14)
  const bands = texts.filter((t) => t.size === 8 && t.font === 'sansBold')
  assert.equal(bands.length, 4)
  near(bands.reduce((s, t) => s + money(t), 0), money(hero), 0.011)
  const data = stackedArea.sample()
  near(money(hero), data.series.reduce((s, r) => s + r.values.reduce((a, b) => a + b, 0), 0), 0.011)
})

test('stacked-area: 帯の濃さは下から 25%・18%・12%・8%（5 つ以上は 40% から 8% へ等間隔）', () => {
  assert.deepEqual(bandSteps(4), [0.25, 0.18, 0.12, 0.08])
  assert.deepEqual(bandSteps(2), [0.25, 0.18])
  const s = bandSteps(6)
  near(s[0], 0.4)
  near(s[5], 0.08)
  s.forEach((v, i) => i && near(s[i - 1] - v, (0.4 - 0.08) / 5, 1e-9))
  const fills = parts('stacked-area', stackedArea.sample()).paths.filter((o) => o.fill && same(o.fill, MONO.ink) && o.opacity > 0.05 && o.opacity <= 0.25)
  assert.deepEqual(fills.slice(0, 4).map((o) => o.opacity), [0.25, 0.18, 0.12, 0.08])
})

test('stacked-area: 帯の間は地の色の細い線・日の合計は最後の帯の上の縁の墨 85% の線', () => {
  const { paths } = parts('stacked-area', stackedArea.sample())
  assert.equal(paths.filter((o) => o.stroke && same(o.stroke, MONO.paper) && o.lw === 1).length, 3)
  const edge = paths.filter((o) => o.stroke && same(o.stroke, MONO.ink) && o.opacity === 0.85)
  assert.equal(edge.length, 1)
})

test('stacked-area: 右の札は 12pt 以上離れ、薄い帯でも名前と合計が重ならない', () => {
  const { texts } = parts('stacked-area', stackedArea.sample())
  const names = ['開発部', '営業部', 'サポート', 'その他'].map((s) => texts.find((t) => textOf(t) === s)).sort((a, b) => a.y - b.y)
  names.forEach((t, i) => i && assert.ok(t.y - names[i - 1].y >= 12 - 1e-6, `${textOf(names[i - 1])} と ${textOf(t)}`))
})

test('stacked-area: 欠測と負の値は 0 にして warnings に書き、同じ名前の系列が 2 本あっても 2 つの帯になる', () => {
  const n = stackedArea.normalize({ x: ['a', 'b'], series: [{ name: 'A', values: [1, -2] }, { name: 'B', values: [null, 3] }] })
  assert.deepEqual(n.data.rows.map((r) => r.values), [[1, 0], [0, 3]])
  assert.ok(n.warnings.some((w) => w.includes('2 個')))
  const twin = parts('stacked-area', { x: days(5), series: [{ name: 'A', values: [1, 2, 3, 2, 1] }, { name: 'A', values: [2, 2, 2, 2, 2] }] })
  assert.equal(twin.paths.filter((o) => o.fill && same(o.fill, MONO.ink) && o.opacity > 0.05 && bboxOf(o).x1 - bboxOf(o).x0 > 100).length, 2, '札の小さい四角でなく、面の帯が 2 つ')
})

// ---------------------------------------------------------------- step-line

/** 6 日・3 つのリリース（平均 1・3・5）の data */
const STEPS6 = { x: days(6), series: [{ name: 'E', values: [1, 1, 3, 3, 5, 5] }], marks: [{ x: days(6)[0], label: 'A' }, { x: days(6)[2], label: 'B' }, { x: days(6)[4], label: 'C' }] }

test('step-line: 区間の平均はそのリリースの日だけから計算し、最悪（平均がいちばん高い）区間だけ pal.down の太字', () => {
  const { texts } = parts('step-line', STEPS6)
  const mean = texts.filter((t) => t.size <= 8 && /^\d\.\d$/.test(textOf(t)))
  assert.deepEqual(mean.map(textOf), ['1.0', '3.0', '5.0'])
  assert.deepEqual(mean.map((t) => same(t.color, MONO.down)), [false, false, true])
  assert.equal(mean[2].font, 'sansBold')
  assert.ok(same(texts.find((t) => textOf(t) === 'C').color, MONO.down))
})

test('step-line: 見本では v1.7 の区間だけが pal.down（名前と平均）で、面と線は四角で切り抜いて重ねる', () => {
  const { ops, texts, paths } = parts('step-line', stepLine.sample())
  assert.deepEqual(texts.filter((t) => same(t.color, MONO.down)).map(textOf), ['v1.7', '2.3%'])
  assert.equal(ops.filter((o) => o.t === 'clip').length, 2)
  assert.ok(paths.some((o) => o.fill && same(o.fill, MONO.down) && o.opacity === 0.25))
  assert.ok(paths.some((o) => o.stroke && same(o.stroke, MONO.down) && o.lw === 1 && String(o.d).length > 100))
})

test('step-line: 階段の線は水平と垂直だけ（斜めの線を引かない）', () => {
  const { paths } = parts('step-line', stepLine.sample())
  const stair = paths.find((o) => o.stroke && same(o.stroke, MONO.ink) && o.opacity === 0.85 && o.lw === 1)
  const n = (String(stair.d).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  assert.ok(n.length > 40)
  for (let i = 2; i < n.length; i += 2) assert.ok(n[i] === n[i - 2] || n[i + 1] === n[i - 1], `${n[i - 2]},${n[i - 1]} → ${n[i]},${n[i + 1]} が斜め`)
})

test('step-line: 区間が 1 つだけなら比べる相手がいないので最悪を付けず、marks が無ければ平均も名前も出さない', () => {
  const one = parts('step-line', { ...STEPS6, marks: STEPS6.marks.slice(0, 1) })
  assert.ok(!one.texts.some((t) => same(t.color, MONO.down)))
  assert.ok(!one.ops.some((o) => o.t === 'clip'))
  const none = parts('step-line', { x: STEPS6.x, series: STEPS6.series })
  assert.ok(!none.strings.some((s) => ['A', 'B', 'C'].includes(s)))
  assert.ok(!none.texts.some((t) => t.glyphs[0].x > 40 && /^[0-9][.][0-9]$/.test(textOf(t))), '平均の字（目盛りの列より右の数）が出た')
  assert.ok(!none.ops.some((o) => o.t === 'clip'))
})

test('step-line: x に無い字を指す marks と label の無い marks は捨てて warnings に書く。重なる日は先のもの', () => {
  const n = stepLine.normalize({ ...STEPS6, marks: [...STEPS6.marks, { x: 'どこにも無い', label: 'Z' }, { x: STEPS6.x[3] }, { x: STEPS6.x[0], label: '重複' }] })
  assert.deepEqual(n.data.marks.map((m) => m.label), ['A', 'B', 'C'])
  assert.ok(n.warnings.some((w) => w.includes('2 個')), n.warnings.join(' / '))
})

test('step-line: 見出しは最新の値で、今効いているリリースの名前が添えられる。系列が複数なら highlight（無ければ先頭）の 1 本', () => {
  const { strings } = parts('step-line', stepLine.sample())
  assert.ok(strings.includes('0.5%') && strings.includes('最新の値（v1.9）'), strings.join(','))
  const two = stepLine.normalize({ ...STEPS6, series: [{ name: 'E', values: [1, 1, 3, 3, 5, 5] }, { name: 'F', values: [9, 9, 9, 9, 9, 9] }], highlight: 'F' })
  assert.equal(two.data.rows.length, 1)
  assert.equal(two.data.rows[0].name, 'F')
  assert.ok(two.warnings.length > 0)
})

// ---------------------------------------------------------------- streamgraph

test('streamgraph: 流れの割合の字は足して 100% になり（丸めの 1 つ分まで）、どの流れも名前が出る', () => {
  const { strings } = parts('streamgraph', streamgraph.sample())
  const shares = strings.map((s) => /^(.+) (\d+)%$/.exec(s)).filter(Boolean).map((m) => ({ name: m?.[1], pct: Number(m?.[2]) }))
  assert.equal(shares.length, 6)
  near(shares.reduce((s, e) => s + e.pct, 0), 100, 3)
  assert.deepEqual(shares.map((e) => e.name).sort(), streamgraph.sample().series.map((r) => r.name).sort())
})

test('streamgraph: 流れの面は墨の 3 段（12%・25%・42%）で、目立たせる流れだけ別（mono は墨 80%）', () => {
  const { paths } = parts('streamgraph', streamgraph.sample())
  const fills = paths.filter((o) => o.fill && same(o.fill, MONO.ink)).map((o) => o.opacity)
  assert.equal(fills.length, 6)
  assert.deepEqual([...new Set(fills)].sort(), [0.12, 0.25, 0.42, 0.8].sort())
  assert.equal(fills.filter((a) => a === 0.8).length, 1, '目立たせる流れ（自動化）は 1 つ')
})

test('streamgraph: いちばん大きい流れが最も薄く、隣り合う流れは同じ段にならない', () => {
  const byPos = [0, 1, 2, 3, 4, 5].map((k) => ({ key: k, index: k, total: [9, 40, 5, 30, 20, 7][k] }))
  const got = pickSteps(byPos, -1)
  assert.equal(got.get(1), 0.12, '40 がいちばん大きい')
  for (let i = 1; i < 6; i++) assert.notEqual(got.get(i), got.get(i - 1), `${i - 1} と ${i}`)
  const withHot = pickSteps(byPos, 3)
  assert.ok(!withHot.has(3), '目立たせる流れは段を取らない')
})

test('streamgraph: 細すぎて名前を置けない流れは、下の札（凡例）に名前を並べる（名前が消えない）', () => {
  const k = 9
  const data = { x: days(20), series: Array.from({ length: k }, (_, i) => ({ name: `種類${i}`, values: Array.from({ length: 20 }, (_, j) => 1 + ((i * 7 + j * 3) % 5)) })) }
  const { strings } = parts('streamgraph', data)
  for (let i = 0; i < k; i++) assert.ok(strings.some((s) => s.includes(`種類${i}`)), `種類${i} が図のどこにも出ない`)
})

test('streamgraph: 欠測と負の値は 0 にして warnings に書き、左上に合計の 1 行が出る', () => {
  const n = streamgraph.normalize({ x: ['a', 'b', 'c'], series: [{ name: 'A', values: [1, null, 3] }, { name: 'B', values: [-1, 2, 3] }] })
  assert.deepEqual(n.data.rows.map((r) => r.values), [[1, 0, 3], [0, 2, 3]])
  assert.ok(n.warnings.some((w) => w.includes('2 個')), n.warnings.join(' / '))
  assert.ok(parts('streamgraph', streamgraph.sample()).strings.some((s) => s.startsWith('合計 ') && s.endsWith('時間')))
})
