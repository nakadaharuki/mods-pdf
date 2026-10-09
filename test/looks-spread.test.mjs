// @ts-check
// 図の形（looks）の試験: spread の束（box-plot・contour・hexbin・histogram・ridgeline・scatter・violin）。
// 全部の形に looks-kit の共通の確かめを掛け、そのあと形ごとの大事な振る舞い（図が data の数字を正しい位置に置くこと）を確かめる。
// 位置は、描いた svg の目盛りの字から「値 → 座標」の 1 次の関数を作って突き合わせる（形の内部の関数を呼ばない）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook, LOOKS } from '../hooks/engine/looks/index.mjs'
import { quantile, sorted } from '../hooks/engine/looks/spread-kit.mjs'
import { testLook, PALS } from './looks-kit.mjs'

const MONO = PALS.mono
const IDS = ['box-plot', 'contour', 'hexbin', 'histogram', 'ridgeline', 'scatter', 'violin']
for (const id of IDS) testLook(id)

const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 0.6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)

// ---------------------------------------------------------------- svg を読む小さな道具

/** @param {string} s @returns {Record<string, string>} */
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
/** 開きタグ（text 以外）の属性の列 @param {string} svg @param {string} name */
const tags = (svg, name) => [...svg.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'g'))].map((m) => attrsOf(m[1]))
/** text の属性と中身（s） @param {string} svg */
const texts = (svg) => [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => /** @type {Record<string, string>} */ ({ ...attrsOf(m[1]), s: m[2] }))
const isSub = (/** @type {Record<string, string>} */ t) => (t.fill ?? '').toLowerCase() === MONO.sub.toLowerCase()
const isInk = (/** @type {Record<string, string>} */ t) => (t.fill ?? '').toLowerCase() === MONO.ink.toLowerCase()
const asNum = (/** @type {string} */ s) => Number(s.replace(/,/g, ''))
const isNum = (/** @type {string} */ s) => /^-?[\d,]+(\.\d+)?$/.test(s)

/** 値と座標の組の先頭と末尾から作る 1 次の関数 @param {[number, number][]} pairs */
function scaleFrom(pairs) {
  assert.ok(pairs.length >= 2, '目盛りの字が 2 つ以上ない')
  const [a, b] = [pairs[0], pairs[pairs.length - 1]]
  const k = (b[1] - a[1]) / (b[0] - a[0])
  return (/** @type {number} */ v) => a[1] + (v - a[0]) * k
}
/** 下の軸の目盛りの字（中央揃え・7.5pt・sub の数）から、値 → x @param {string} svg */
const xScale = (svg) => scaleFrom(texts(svg).filter((t) => t['text-anchor'] === 'middle' && t['font-size'] === '7.5' && isSub(t) && isNum(t.s)).map((t) => [asNum(t.s), Number(t.x)]))
/** 左の軸の目盛りの字（右揃え・7.5pt・sub の数。基線は目盛りの線の 7.5 × 0.35 下）から、値 → y @param {string} svg */
const yScale = (svg) => scaleFrom(texts(svg).filter((t) => t['text-anchor'] === 'end' && t['font-size'] === '7.5' && isSub(t) && isNum(t.s)).map((t) => [asNum(t.s), Number(t.y) - 2.625]))

/** @param {string} id @param {unknown} data @param {{ width?: number, height?: number }} [o] */
const draw = (id, data, o = {}) => drawLook(id, data, { width: 400, pal: MONO, ...o })
/** @template T @param {number} n @param {(i: number) => T} f @returns {T[]} */
const rangeOf = (n, f) => Array.from({ length: n }, (_, i) => f(i))

// ---------------------------------------------------------------- box-plot

test('box-plot: 箱は 25%〜75% の分位・線は中央値・ひげは箱から 1.5 倍の内側の端で、その外の値だけが点になる', () => {
  // 1〜10 と 40。分位は 3.5・6・8.5、上の柵は 8.5 + 1.5 × 5 = 16 なので、上のひげは 10・40 は外れ値
  const r = draw('box-plot', { groups: [{ name: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40] }, { name: 'B', values: [5, 6, 7, 8, 9] }], unit: 'ms' })
  const x = xScale(r.svg)
  const box = tags(r.svg, 'rect')[0]
  near(Number(box.x), x(3.5))
  near(Number(box.x) + Number(box.width), x(8.5))
  const lines = tags(r.svg, 'line')
  const medians = lines.filter((l) => l.stroke?.toLowerCase() === MONO.ink.toLowerCase() && !l['stroke-opacity'] && l.x1 === l.x2)
  near(Number(medians[0].x1), x(6))
  const whiskers = lines.filter((l) => l['stroke-opacity'] === '0.35' && l.y1 === l.y2).filter((l) => Math.abs(Number(l.y1) - Number(box.y) - Number(box.height) / 2) < 1)
  near(Math.min(...whiskers.map((l) => Number(l.x1))), x(1))
  near(Math.max(...whiskers.map((l) => Number(l.x2))), x(10))
  const dots = tags(r.svg, 'circle')
  assert.equal(dots.length, 1, '外れ値が無い群には点を描かない')
  near(Number(dots[0].cx), x(40))
})

test('box-plot: 群が 24 を超えたら 24 で止めて、捨てた数を warnings に書く', () => {
  const groups = rangeOf(30, (i) => ({ name: `g${i}`, values: [1, 2, 3, 4, 5 + i] }))
  const r = draw('box-plot', { groups })
  assert.equal(tags(r.svg, 'rect').length, 24)
  assert.ok(r.warnings.some((w) => w.includes('24') && w.includes('6')), r.warnings.join('\n'))
})

// ---------------------------------------------------------------- histogram

test('histogram: 棒の件数の合計と、範囲を超えて棒に入れない件数を足すと、全部の件数になる', () => {
  const s = LOOKS.histogram.sample()
  const n = s.groups[0].values.length
  // 高さを大きくして、1 件の棒が最小の高さ 1pt に持ち上がらないようにする
  const r = draw('histogram', s, { height: 1000 })
  const bars = tags(r.svg, 'rect').filter((b) => b['fill-opacity'] === '0.55')
  const peakLabel = texts(r.svg).find((t) => t['font-weight'] === 'bold' && t['text-anchor'] === 'middle')
  if (!peakLabel) throw new Error('一番高い棒の件数が書かれていない')
  const perCount = Math.max(...bars.map((b) => Number(b.height))) / asNum(peakLabel.s)
  const total = bars.reduce((t, b) => t + Math.round(Number(b.height) / perCount), 0)
  const head = texts(r.svg).find((t) => t['text-anchor'] === 'end' && t.s.includes('以上の'))
  const over = head ? asNum(/以上の ([\d,]+) 件/.exec(head.s)?.[1] ?? '0') : 0
  assert.ok(over > 0, '見本は範囲を超える件がある')
  assert.equal(total + over, n)
})

test('histogram: P50・P95・P99 の 3 本の点線がその百分位の位置にあり、P99 だけが墨 100%（ほかは 35%）', () => {
  const s = LOOKS.histogram.sample()
  const r = draw('histogram', s)
  const x = xScale(r.svg)
  const dashed = tags(r.svg, 'line').filter((l) => l['stroke-dasharray'])
  assert.equal(dashed.length, 3)
  const v = sorted(s.groups[0].values)
  // 線は画素の真ん中（四捨五入した位置 + 0.5）に引くので、1pt まで
  ;[0.5, 0.95, 0.99].forEach((p, i) => near(Number(dashed[i].x1), x(quantile(v, p)), 1.01))
  assert.deepEqual(dashed.map((l) => l['stroke-opacity']), ['0.35', '0.35', undefined])
})

test('histogram: 百分位が近くて字が並べない時は、字を重ねず、目立たせる P99 の字を残す（点線は 3 本とも残る）', () => {
  const values = rangeOf(300, (i) => Math.round(Math.sin(i * 12.9898) * 1000) / 1000)
  const r = draw('histogram', { groups: [{ name: 'x', values }] }, { width: 230 })
  const labels = texts(r.svg).filter((t) => /^(P50|P95|P99)$/.test(t.s) || (Number(t.y) === 26 && isNum(t.s)))
  const boxes = labels.map((t) => [Number(t.x), Number(t.x) + t.s.length * 4.2])
  boxes.sort((a, b) => a[0] - b[0])
  boxes.forEach((b, i) => { if (i) assert.ok(boxes[i - 1][1] <= b[0] + 0.5, '字が重なっている: ' + JSON.stringify(boxes)) })
  assert.equal(tags(r.svg, 'line').filter((l) => l['stroke-dasharray']).length, 3)
  assert.ok(labels.some((t) => t.s === 'P99'))
})

test('histogram: 群が 2 つ以上の data は先頭の群だけを描き、warnings に書く', () => {
  const r = draw('histogram', { groups: [{ name: 'AA', values: [1, 2, 3, 4] }, { name: 'BB', values: [5, 6, 7] }] })
  assert.ok(r.warnings.some((w) => w.includes('先頭の群「AA」')), r.warnings.join('\n'))
  const t = texts(r.svg).map((x) => x.s).join('|')
  assert.ok(t.includes('AA（4 件）') && !t.includes('BB'), t)
})

test('histogram: 件数の目盛りは整数だけ（件数が少なくても 0.5 件の目盛りを置かない）', () => {
  const r = draw('histogram', { groups: [{ name: 'x', values: [1, 1, 2, 3, 3, 3] }] })
  const labels = texts(r.svg).filter((t) => t['text-anchor'] === 'end' && t['font-size'] === '7.5' && isSub(t) && isNum(t.s)).map((t) => asNum(t.s))
  assert.ok(labels.length >= 2)
  assert.ok(labels.every(Number.isInteger), labels.join(','))
})

// ---------------------------------------------------------------- violin

test('violin: 中央値の線は中央値の高さ・四分位の棒は 25%〜75% の高さにある', () => {
  // A は 1〜10（分位 3.25・5.5・7.75）、B は 3,4,5,5,6,6,7,8（4.75・5.5・6.25）
  const r = draw('violin', { groups: [{ name: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, { name: 'B', values: [3, 4, 5, 5, 6, 6, 7, 8] }] })
  const y = yScale(r.svg)
  const bars = tags(r.svg, 'rect')
  const medians = tags(r.svg, 'line').filter((l) => l['stroke-width'] === '1' && !l['stroke-opacity'] && l.y1 === l.y2 && l.stroke?.toLowerCase() === MONO.ink.toLowerCase())
  assert.equal(bars.length, 2)
  near(Number(bars[0].y), y(7.75))
  near(Number(bars[0].y) + Number(bars[0].height), y(3.25))
  near(Number(bars[1].y), y(6.25))
  near(Number(bars[1].y) + Number(bars[1].height), y(4.75))
  near(Number(medians[0].y1), y(5.5))
  near(Number(medians[1].y1), y(5.5))
})

test('violin: 群ごとに形の最も太い所を同じ幅に揃える（広がりの違う群も細い線にならない）', () => {
  const wide = rangeOf(40, (i) => i * 5)
  const tight = rangeOf(40, (i) => 100 + (i % 5) * 0.1)
  const r = draw('violin', { groups: [{ name: '広い', values: wide }, { name: '狭い', values: tight }] })
  const widths = tags(r.svg, 'path').map((p) => {
    const xs = [...(p.d ?? '').matchAll(/[ML]([-\d.]+) /g)].map((m) => Number(m[1]))
    return Math.max(...xs) - Math.min(...xs)
  })
  assert.equal(widths.length, 2)
  near(widths[0], widths[1], 0.2)
  assert.ok(widths[0] > 20, `${widths[0]}`)
})

test('violin: 値が 2 個に満たない群は捨てて、群が 12 を超えたら 12 で止める。どちらも warnings に書く', () => {
  const groups = [{ name: '1個', values: [5] }, ...rangeOf(15, (i) => ({ name: `g${i}`, values: [1, 2, 3, 4 + i] }))]
  const r = draw('violin', { groups })
  assert.equal(tags(r.svg, 'path').length, 12)
  assert.ok(r.warnings.some((w) => w.includes('2 個に満たない')), r.warnings.join('\n'))
  assert.ok(r.warnings.some((w) => w.includes('12')), r.warnings.join('\n'))
})

// ---------------------------------------------------------------- ridgeline

const RIDGE = { groups: [{ name: 'A', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, { name: 'B', values: [3, 4, 5, 5, 6, 6, 7, 8] }, { name: 'C', values: [5, 6, 7, 8, 9, 10, 11, 12] }], unit: 'ms' }
/** 山の輪郭（fill が none の path）のうち、墨 100% の 1 本の番号 @param {string} svg */
const hotRow = (svg) => tags(svg, 'path').filter((p) => p.fill === 'none').findIndex((p) => !p['stroke-opacity'])

test('ridgeline: 目立たせる行は highlight の名前の行で、無ければ最後の行（墨 100% の輪郭は 1 本だけ）', () => {
  assert.equal(hotRow(draw('ridgeline', RIDGE).svg), 2)
  const r = draw('ridgeline', { ...RIDGE, highlight: 'B' })
  assert.equal(hotRow(r.svg), 1)
  assert.equal(tags(r.svg, 'path').filter((p) => p.fill === 'none' && !p['stroke-opacity']).length, 1)
})

test('ridgeline: 名前が合わない highlight は最後の行にして warnings に書く', () => {
  const r = draw('ridgeline', { ...RIDGE, highlight: 'ZZ' })
  assert.equal(hotRow(r.svg), 2)
  assert.ok(r.warnings.some((w) => w.includes('highlight「ZZ」')), r.warnings.join('\n'))
})

test('ridgeline: 中央値の点線は各行の中央値の位置にあり、全部の行が同じ尺度で、狭い群の山は広い群より高い', () => {
  const r = draw('ridgeline', { groups: [{ name: '狭い', values: [9.8, 9.9, 10, 10.1, 10.2, 10, 10, 9.9] }, { name: '広い', values: [0, 5, 10, 15, 20, 25, 30, 35] }] })
  const x = xScale(r.svg)
  const stems = tags(r.svg, 'line').filter((l) => l['stroke-dasharray'])
  assert.equal(stems.length, 2)
  near(Number(stems[0].x1), x(10), 0.8)
  near(Number(stems[1].x1), x(17.5), 0.8)
  const heights = tags(r.svg, 'path').filter((p) => p.fill === 'none').map((p, i) => {
    const ys = [...(p.d ?? '').matchAll(/[ML][-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1]))
    return Number(stems[i].y1) - Math.min(...ys)
  })
  assert.ok(heights[0] > heights[1] * 2, `狭い ${heights[0]}・広い ${heights[1]}`)
})

// ---------------------------------------------------------------- scatter

test('scatter: 点線は最小二乗の直線で、傾きが下の行の字と data の傾きに合う', () => {
  const points = rangeOf(20, (i) => [i + 1, 0.5 * (i + 1) + 1])
  const r = draw('scatter', { points })
  const x = xScale(r.svg)
  const y = yScale(r.svg)
  const fit = tags(r.svg, 'line').find((l) => l['stroke-dasharray'] && l['stroke-opacity'] === '0.35')
  if (!fit) throw new Error('点線が無い')
  const kx = x(1) - x(0)
  const ky = y(0) - y(1)
  near(((Number(fit.y1) - Number(fit.y2)) / ky) / ((Number(fit.x2) - Number(fit.x1)) / kx), 0.5, 0.01)
  assert.ok(texts(r.svg).some((t) => /傾き 0\.5/.test(t.s)), texts(r.svg).map((t) => t.s).join('|'))
})

test('scatter: 名前を付けるのは直線から最も離れた 3 件だけ', () => {
  const line = rangeOf(100, (i) => [1 + (i % 50), 0.5 * (1 + (i % 50)) + 1])
  const out = [[25, 60], [10, 30], [40, 5]]
  const points = [...line, ...out]
  const names = [...line.map(() => ''), 'O1', 'O2', 'O3']
  const r = draw('scatter', { points, names })
  const labels = texts(r.svg).filter((t) => t['font-size'] === '8' && isInk(t)).map((t) => t.s)
  assert.equal(labels.length, 3, labels.join('|'))
  assert.deepEqual([...labels].sort(), ['O1', 'O2', 'O3'])
})

test('scatter: 円の半径は大きさの平方根（面積が値を表す）で、大きい円から先に描くので小さい円は大きい円の上に見える', () => {
  const r = draw('scatter', { points: [[1, 1, 1], [2, 2, 100], [3, 3, 50]] })
  const radii = tags(r.svg, 'circle').slice(0, 3).map((c) => Number(c.r))
  assert.ok(radii.indexOf(Math.max(...radii)) < radii.indexOf(Math.min(...radii)), radii.join(','))
  // 大きさ 100 と 50 の半径の比は √2（小さすぎる円は読める半径まで持ち上げるので、大きさ 1 は比べない）
  near(Math.max(...radii) / [...radii].sort((p, q) => q - p)[1], Math.SQRT2, 0.01)
})

// ---------------------------------------------------------------- hexbin

test('hexbin: 同じ点が入る升の濃さは、点の数 / 最大 の平方根に比例し、最大の升だけに目立たせる太さ（LW.hot）の縁と「最多 N」が付く', () => {
  const dup = (/** @type {number} */ n, /** @type {number[]} */ p) => rangeOf(n, () => p)
  const r = draw('hexbin', { points: [...dup(5, [2, 2]), ...dup(3, [8, 8]), [2, 8]] })
  const cells = tags(r.svg, 'path').filter((p) => p.fill !== 'none')
  // 升 3 つ + 凡例の 5 段
  assert.equal(cells.length, 3 + 5)
  const ramp = (/** @type {number} */ c) => 0.08 + (0.75 - 0.08) * Math.sqrt(c / 5)
  const opacities = cells.slice(0, 3).map((c) => Number(c['fill-opacity'])).sort((a, b) => a - b)
  ;[1, 3, 5].forEach((c, i) => near(opacities[i], ramp(c), 0.002))
  const rings = tags(r.svg, 'path').filter((p) => p.fill === 'none' && p['stroke-width'] === '1.5')
  assert.equal(rings.length, 1)
  assert.ok(texts(r.svg).some((t) => t.s === '最多 5'), texts(r.svg).map((t) => t.s).join('|'))
})

test('hexbin: 升は軸の棒と数にはみ出さない（点の範囲の端の升も、図の中に収まる）', () => {
  const r = draw('hexbin', LOOKS.hexbin.sample())
  const ticks = tags(r.svg, 'line').filter((l) => l.stroke?.toLowerCase() === MONO.sub.toLowerCase() && l['stroke-width'] === '1')
  assert.ok(ticks.length > 4, '目盛りの棒（sub・LW.line）')
  const leftEdge = Math.max(...ticks.filter((l) => l.y1 === l.y2).map((l) => Number(l.x2)))
  const bottomEdge = Math.min(...ticks.filter((l) => l.x1 === l.x2).map((l) => Number(l.y1)))
  const cells = tags(r.svg, 'path').filter((p) => p.fill !== 'none').slice(0, -5)
  assert.ok(cells.length > 20)
  for (const c of cells) {
    const pts = [...(c.d ?? '').matchAll(/([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    assert.ok(pts.every(([px, py]) => px >= leftEdge && py <= bottomEdge), `${c.d}（左 ${leftEdge}・下 ${bottomEdge}）`)
  }
})

// ---------------------------------------------------------------- contour

/** 等高線の 300 点（決まった乱数） */
function cloud() {
  let s = 1
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  return rangeOf(300, () => [5 + 3 * (rnd() + rnd() + rnd() - 1.5), 5 + 2 * (rnd() + rnd() + rnd() - 1.5)])
}

test('contour: 等高線は 8 本で、墨の濃さが 18% から 65% へ一段ずつ濃くなり、最も内側だけが墨 25% の面になる', () => {
  const r = draw('contour', { points: cloud() })
  const levels = tags(r.svg, 'path')
  assert.equal(levels.length, 8)
  const alphas = levels.map((p) => Number(p['stroke-opacity']))
  near(alphas[0], 0.18, 0.001)
  near(alphas[7], 0.65, 0.001)
  assert.ok(alphas.every((a, i) => i === 0 || a > alphas[i - 1]), alphas.join(','))
  assert.deepEqual(levels.map((p) => p.fill), ['none', 'none', 'none', 'none', 'none', 'none', 'none', MONO.ink.toLowerCase()])
  assert.equal(levels[7]['fill-opacity'], '0.25')
  assert.equal(levels[7]['fill-rule'], 'evenodd')
})

test('contour: highlight の点は data の座標に置かれ、highlightLabel の字が付く', () => {
  const r = draw('contour', { points: cloud(), highlight: [8, 7], highlightLabel: '今回' })
  const x = xScale(r.svg)
  const y = yScale(r.svg)
  const dot = tags(r.svg, 'circle')[0]
  near(Number(dot.cx), x(8))
  near(Number(dot.cy), y(7))
  assert.ok(texts(r.svg).some((t) => t.s === '今回'))
})

// ---------------------------------------------------------------- 値の読み取り（形どうしで同じ）

test('値が 1,000 兆を超える data は、その値を捨てて warnings に書き、座標に NaN を出さない', () => {
  const group = { name: 'g', values: [1, 2, 3, 4, 5, 6, 1e16] }
  const pts = [[1, 2], [2, 3], [3, 5], [4, 4], [5, 7], [1e16, 1]]
  const cases = /** @type {[string, unknown][]} */ ([
    ['box-plot', { groups: [group] }], ['histogram', { groups: [group] }], ['ridgeline', { groups: [group, group] }], ['violin', { groups: [group, group] }],
    ['scatter', { points: pts }], ['hexbin', { points: pts }], ['contour', { points: pts }],
  ])
  for (const [id, data] of cases) {
    const r = draw(id, data)
    assert.ok(r.warnings.some((w) => w.includes('1,000 兆')), `${id}: ${r.warnings.join('\n')}`)
    assert.ok(!/NaN|Infinity/.test(r.svg), `${id} の svg に NaN がある`)
  }
})

test('scatter・hexbin・contour: 群は points と同じ長さの groups で渡し、長さが違えば群を使わず、3 群を超える点は捨てる（warnings に書く）', () => {
  const points = rangeOf(8, (i) => [i, i * 2])
  for (const id of ['scatter', 'hexbin', 'contour']) {
    const mismatch = draw(id, { points, groups: ['a', 'b'] })
    assert.ok(mismatch.warnings.some((w) => w.includes('groups の数')), `${id}: ${mismatch.warnings.join('\n')}`)
    const many = draw(id, { points, groups: ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd'] })
    assert.ok(many.warnings.some((w) => w.includes('3 つまで')), `${id}: ${many.warnings.join('\n')}`)
  }
})
