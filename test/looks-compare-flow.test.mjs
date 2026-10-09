// @ts-check
// 図の形（looks）の試験: 比べ（radar・dumbbell・lollipop・parallel-coords・slope）と流れ（chord・dendrogram・force-graph）。
// 全部の形に共通の確かめは test/looks-kit.mjs の testLook（test/looks.test.mjs も LOOK_LIST の全部に掛ける。ここでも掛けるのは、この 1 本だけを動かしても
// 8 つの形が確かめ終わるように）。そのあとに、形ごとに 1 つ以上、その形の大事な振る舞いを確かめる。見るのは描いた svg の字（座標と属性）と、svgToOps の字。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook, LOOKS } from '../hooks/engine/looks/index.mjs'
import { textWidth } from '../hooks/engine/looks/paper.mjs'
import { testLook, toOps, flat, textOf, PALS, MEASURE } from './looks-kit.mjs'

const MONO = PALS.mono
const KOMA = PALS.koma
const IDS = ['radar', 'dumbbell', 'lollipop', 'parallel-coords', 'slope', 'chord', 'dendrogram', 'force-graph']
for (const id of IDS) testLook(id)

// ---------------------------------------------------------------- svg の字を読む小さな道具

/** @param {string} svg @param {string} name 要素の名前 @returns {Record<string, string>[]} 属性の組（出てきた順） */
function tagsOf(svg, name) {
  return [...svg.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'g'))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
}
/** @param {string} svg @returns {{ x: number, y: number, s: string, size: number, fill: string, anchor: string, bold: boolean }[]} */
function textsOf(svg) {
  return [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((p) => [p[1], p[2]]))
    return { x: Number(a.x), y: Number(a.y), s: m[2].replace(/&amp;/g, '&'), size: Number(a['font-size']), fill: a.fill, anchor: a['text-anchor'] ?? 'start', bold: a['font-weight'] === 'bold' }
  })
}
/** 字の枠（基線から上へ size の 80%・下へ 20%。幅は paper の見積もり）が重なる字の組 @param {ReturnType<typeof textsOf>} texts */
function collisions(texts) {
  const box = (/** @type {ReturnType<typeof textsOf>[number]} */ t) => {
    const w = textWidth(t.s, t.size, t.bold)
    const x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x
    return [x0, t.y - t.size * 0.8, x0 + w, t.y + t.size * 0.2]
  }
  const out = []
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = box(texts[i])
      const b = box(texts[j])
      if (a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01) out.push(`${texts[i].s}|${texts[j].s}`)
    }
  }
  return out
}
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)
const draw = (/** @type {string} */ id, /** @type {unknown} */ data, opts = {}) => drawLook(id, data, { width: MEASURE, pal: MONO, ...opts })
const norm = (/** @type {string} */ id, /** @type {unknown} */ data) => LOOKS[id].normalize(data)

// ---------------------------------------------------------------- lollipop

test('lollipop: 並びは値の多い順（入れた順に依らない）で、順位の字が 1 から振られ、棒の長さが値に比例する', () => {
  const data = { items: [{ name: 'c', value: 30 }, { name: 'a', value: 90 }, { name: 'b', value: 60 }, { name: 'd', value: 15 }] }
  const r = draw('lollipop', data)
  const t = textsOf(r.svg)
  assert.deepEqual(t.filter((x) => x.size === 8 && !x.bold).map((x) => x.s), ['a', 'b', 'c', 'd'])
  assert.deepEqual(t.filter((x) => x.size === 7.5 && /^\d$/.test(x.s)).map((x) => x.s), ['1', '2', '3', '4'])
  const stems = tagsOf(r.svg, 'line')
  const dots = tagsOf(r.svg, 'circle')
  const x0 = Number(stems[0].x1)
  const reach = dots.map((c) => Number(c.cx) - x0)
  // 丸の中心の 0 の端からの距離は、値の比（90 : 60 : 30 : 15）
  near(reach[1] / reach[0], 60 / 90, 1e-3)
  near(reach[2] / reach[0], 30 / 90, 1e-3)
  near(reach[3] / reach[0], 15 / 90, 1e-3)
})

test('lollipop: 目立たせるのは先頭の 1 行だけ（mono は墨 100%・ほかは 55%）。highlight で別の行に替えられ、無い名前は先頭に戻って warnings', () => {
  const items = [{ name: 'a', value: 9 }, { name: 'b', value: 5 }, { name: 'c', value: 2 }]
  const dots = (/** @type {string} */ svg) => tagsOf(svg, 'circle').map((c) => c['fill-opacity'] ?? '1')
  assert.deepEqual(dots(draw('lollipop', { items }).svg), ['1', '0.55', '0.55'])
  assert.deepEqual(dots(draw('lollipop', { items, highlight: 'c' }).svg), ['0.55', '0.55', '1'])
  const miss = draw('lollipop', { items, highlight: 'zz' })
  assert.deepEqual(dots(miss.svg), ['1', '0.55', '0.55'])
  assert.ok(miss.warnings.some((w) => /highlight/.test(w)))
  // 色のある紙では、目立たせる丸と値の字は accent
  const koma = draw('lollipop', { items }, { pal: KOMA })
  assert.equal(tagsOf(koma.svg, 'circle')[0].fill, KOMA.accent)
  assert.equal(textsOf(koma.svg).find((x) => x.bold)?.fill, KOMA.accent)
})

test('lollipop: 2 字までの単位は値に付き、長い単位は左下に「単位:」と置く。% の時と負の値がある時は合計を置かない', () => {
  const items = [{ name: 'a', value: 9 }, { name: 'b', value: 5 }]
  const yen = textsOf(draw('lollipop', { items, unit: '円' }).svg).map((x) => x.s)
  assert.ok(yen.includes('9円') && yen.includes('合計 14円') && !yen.some((s) => s.startsWith('単位')))
  const long = textsOf(draw('lollipop', { items, unit: '百万トークン' }).svg).map((x) => x.s)
  assert.ok(long.includes('9') && long.includes('単位: 百万トークン'))
  assert.ok(!textsOf(draw('lollipop', { items, unit: '%' }).svg).some((x) => x.s.startsWith('合計')))
  assert.ok(!textsOf(draw('lollipop', { items: [{ name: 'a', value: 9 }, { name: 'b', value: -5 }] }).svg).some((x) => x.s.startsWith('合計')))
})

test('lollipop: 行が 30 を超えたら上位 30 だけ描いて warnings に書き、名前か値の読めない行は捨てる', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ name: `項目${i}`, value: 40 - i }))
  const n = norm('lollipop', { items: [...items, { name: '', value: 3 }, { name: 'x', value: 'abc' }] })
  assert.equal(n.data.rows.length, 30)
  assert.equal(n.warnings.length, 2)
  assert.match(n.warnings.join('\n'), /捨てました/)
})

// ---------------------------------------------------------------- dumbbell

test('lollipop・dumbbell・slope・radar: 長い小数は値の大きさに見合う桁へ丸め、dumbbell の目盛りと目標は自分の桁で書く', () => {
  const big = textsOf(draw('lollipop', { items: [{ name: 'a', value: 5053.7351 }, { name: 'b', value: 13.00012 }] }).svg).map((x) => x.s)
  assert.ok(big.includes('5,054') && big.includes('13'), big.join('|'))
  const small = textsOf(draw('lollipop', { items: [{ name: 'a', value: 2.4137 }, { name: 'b', value: 1.8602 }] }).svg).map((x) => x.s)
  assert.ok(small.includes('2.41') && small.includes('1.86'), small.join('|'))
  const d = textsOf(draw('dumbbell', { items: [{ name: 'a', from: 13.00012, to: 500.4417 }, { name: 'b', from: 80.5, to: 310.25 }] }).svg)
  assert.ok(d.every((x) => !/\.\d{2,}/.test(x.s)), d.map((x) => x.s).join('|'))
  assert.ok(d.filter((x) => x.size === 7.5 && x.anchor === 'middle' && /^[\d,]+$/.test(x.s)).length >= 3, '目盛りは小数なしの切りのよい値')
  const target = textsOf(draw('dumbbell', { items: [{ name: 'a', from: 4, to: 9 }], threshold: 2.5 }).svg).map((x) => x.s)
  assert.ok(target.includes('目標 2.5'), target.join('|'))
  const sl = textsOf(draw('slope', { items: [{ name: 'a', from: 12.3456, to: 87.6543 }], unit: '%' }).svg).map((x) => x.s)
  assert.ok(sl.includes('12.35%') && sl.includes('87.65%'), sl.join('|'))
  const rd = textsOf(draw('radar', { axes: ['売上', '利益', '客数'], series: [{ name: 's', values: [37.123456, 12, 21] }] }).svg).map((x) => x.s)
  assert.ok(rd.includes('37.12'), rd.join('|'))
})

test('dumbbell: 2 つの丸は 1 つの尺度の上にあり、目盛りの値から丸の位置が 1 次式で決まる', () => {
  const data = { items: [{ name: 'a', from: 100, to: 400 }, { name: 'b', from: 200, to: 300 }], fromLabel: '前', toLabel: '後' }
  const dots = tagsOf(draw('dumbbell', data).svg, 'circle').filter((c) => c.r === '2')
  const xs = dots.map((c) => Number(c.cx))
  // 行 a: 100・400、行 b: 200・300 の順に並ぶ（凡例の丸は r=2 で 2 つ後ろ）
  const per = (xs[1] - xs[0]) / 300
  near((xs[2] - xs[0]) / per, 100, 0.05)
  near((xs[3] - xs[0]) / per, 200, 0.05)
})

test('dumbbell: 目標を超えた「後」の丸と値だけが pal.down で、超えた件数が上の左に出て、目標の点線は値の字の所で切れる', () => {
  const data = {
    items: [{ name: 'a', from: 210, to: 640 }, { name: 'b', from: 160, to: 420 }, { name: 'c', from: 190, to: 290 }, { name: 'd', from: 42, to: 118 }],
    fromLabel: '中央値', toLabel: '95%', unit: 'ms', threshold: 300, thresholdLabel: '目標',
  }
  const r = draw('dumbbell', data)
  const down = tagsOf(r.svg, 'circle').filter((c) => c.fill === MONO.down)
  assert.equal(down.length, 2)
  const t = textsOf(r.svg)
  assert.deepEqual(t.filter((x) => x.fill === MONO.down).map((x) => x.s).sort(), ['2 件が超過', '420', '640'])
  assert.ok(t.some((x) => /^目標 300$/.test(x.s)))
  // 点線は 1 本の path。値の字（290）が線の上に来る行で切れ、M が 2 つ以上
  const dash = tagsOf(r.svg, 'path').find((p) => p['stroke-dasharray'] === '3 3')
  assert.ok(dash, '目標の点線が無い')
  assert.ok((dash.d.match(/M/g) ?? []).length >= 2, `切れ目が無い: ${dash.d}`)
})

test('dumbbell: 目標が無ければ丸は墨だけで点線も件数も出ない。前より後が小さい行は、小さい丸の左・大きい丸の右に値が出る。並びは大きい方の値の順', () => {
  const data = { items: [{ name: 'a', from: 50, to: 10 }, { name: 'b', from: 20, to: 90 }] }
  const r = draw('dumbbell', data)
  assert.equal(tagsOf(r.svg, 'circle').filter((c) => c.fill === MONO.down).length, 0)
  assert.ok(!tagsOf(r.svg, 'path').some((p) => p['stroke-dasharray']))
  const t = textsOf(r.svg)
  const names = t.filter((x) => x.size === 8 && /^[ab]$/.test(x.s)).map((x) => x.s)
  assert.deepEqual(names, ['b', 'a'])
  const v = (/** @type {string} */ s) => /** @type {any} */ (t.find((x) => x.s === s))
  // 行 a: 10 が左（end）・50 が右（start）
  assert.equal(v('10').anchor, 'end')
  assert.equal(v('50').anchor, 'start')
})

// ---------------------------------------------------------------- slope

test('slope: 上がった線は pal.up・下がった線は pal.down・同じ値は墨で、上がった件数と下がった件数が右下に出る', () => {
  const data = { items: [{ name: 'a', from: 10, to: 30 }, { name: 'b', from: 50, to: 20 }, { name: 'c', from: 40, to: 40 }, { name: 'd', from: 5, to: 8 }], fromLabel: '前', toLabel: '後' }
  const r = draw('slope', data)
  // 線は candle のヒゲと同じ 80%・ふつうの線の太さ（LW.line）。縦の 2 本の列（12%）と、字をつなぐ線（35%）は濃さで分かれる
  const slopes = tagsOf(r.svg, 'line').filter((l) => l['stroke-opacity'] === '0.8')
  assert.deepEqual(slopes.map((l) => l.stroke), [MONO.up, MONO.down, MONO.ink, MONO.up])
  assert.ok(slopes.every((l) => l['stroke-width'] === '1'))
  const t = textsOf(r.svg).map((x) => x.s)
  assert.ok(t.includes('2 件が上昇') && t.includes('1 件が下降'))
  // 後の値の字は線と同じ色
  const post = textsOf(r.svg).find((x) => x.s === '30')
  assert.equal(post?.fill, MONO.up)
})

test('slope: 近い値の字は同じ側で 10pt 以上離れ、2pt を超えて動いた字は丸と細い線でつながる', () => {
  const data = { items: [{ name: 'a', from: 50, to: 50 }, { name: 'b', from: 51, to: 50.5 }, { name: 'c', from: 52, to: 49 }, { name: 'd', from: 90, to: 10 }] }
  const r = draw('slope', data)
  const vals = textsOf(r.svg).filter((x) => x.size === 8 && x.bold && /^\d/.test(x.s))
  const left = vals.filter((x) => x.anchor === 'end').map((x) => x.y).sort((a, b) => a - b)
  const right = vals.filter((x) => x.anchor === 'start').map((x) => x.y).sort((a, b) => a - b)
  for (const side of [left, right]) for (let i = 1; i < side.length; i++) assert.ok(side[i] - side[i - 1] >= 10 - 1e-6, `字の間 ${side[i] - side[i - 1]}pt`)
  const ties = tagsOf(r.svg, 'line').filter((l) => l['stroke-opacity'] === '0.35')
  assert.ok(ties.length >= 2, `つなぐ線 ${ties.length}`)
})

// ---------------------------------------------------------------- radar

test('radar: 輪は外周の 25・50・75・100% の 4 つで、どれも軸の数だけの頂点を持ち、系列の多角形の頂点は値/max の半径にある', () => {
  const data = { axes: ['a', 'b', 'c', 'd', 'e'], series: [{ name: '今', values: [100, 50, 25, 75, 0] }], max: 100 }
  const r = draw('radar', data)
  const polys = tagsOf(r.svg, 'polygon')
  assert.equal(polys.length, 5)
  const pts = polys.map((p) => p.points.split(' ').map((q) => q.split(',').map(Number)))
  assert.ok(pts.every((p) => p.length === 5))
  const spokes = tagsOf(r.svg, 'line')
  const cx = Number(spokes[0].x1)
  const cy = Number(spokes[0].y1)
  const rad = (/** @type {number[]} */ [x, y]) => Math.hypot(x - cx, y - cy)
  const outer = rad(pts[3][0])
  assert.deepEqual([0, 1, 2].map((i) => Math.round((rad(pts[i][0]) / outer) * 100)), [25, 50, 75])
  const series = pts[4].map(rad)
  assert.deepEqual(series.map((v) => Math.round((v / outer) * 100)), [100, 50, 25, 75, 0])
  // 1 つ目の軸は真上
  near(pts[3][0][0], cx, 0.02)
  assert.ok(pts[3][0][1] < cy)
})

test('radar: 目立たせる先頭の系列だけ面を塗り（25%）、古い系列は塗らない線。max を超える値は外周に止めて warnings、軸が 3 本より少なければ描かない', () => {
  const data = { axes: ['a', 'b', 'c'], series: [{ name: '今', values: [200, 10, 10] }, { name: '前', values: [5, 5, 5] }], max: 100 }
  const n = norm('radar', data)
  assert.match(n.warnings.join(''), /外周に止めました/)
  const polys = tagsOf(draw('radar', data).svg, 'polygon')
  assert.equal(polys.filter((p) => p.fill !== 'none' && p['fill-opacity'] === '0.25').length, 1)
  assert.equal(polys.filter((p) => p.fill === 'none').length, 4 + 1)
  const two = draw('radar', { axes: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] })
  assert.match(two.svg, /データがありません/)
  assert.ok(two.warnings.some((w) => /3 本/.test(w)))
})

test('radar: 軸の名前に先頭の系列の値が添い、max を省くと全部の値の最大から切りのよい外周を決める', () => {
  const data = { axes: ['売上', '利益', '客数'], series: [{ name: 's', values: [37, 12, 21] }] }
  const t = textsOf(draw('radar', data).svg).map((x) => x.s)
  assert.ok(t.includes('売上') && t.includes('37') && t.includes('外周 = 40'))
})

// ---------------------------------------------------------------- parallel-coords

test('parallel-coords: 軸ごとに最小の値が下・最大の値が上に来る（軸ごとの尺度）で、目立たせる線は最後に描かれて 1.5pt', () => {
  const data = {
    axes: ['売上', '日数', '人数'],
    series: [{ name: 'hot', values: [5, 500, 2] }, { name: 'a', values: [100, 20, 9] }, { name: 'b', values: [50, 300, 4] }, { name: 'c', values: [10, 100, 7] }],
  }
  const r = draw('parallel-coords', data, { height: 252 })
  const paths = tagsOf(r.svg, 'path')
  assert.equal(paths.length, 4)
  const ys = paths.map((p) => [...p.d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => Number(m[2])))
  const top = Math.min(...ys.flat())
  const bottom = Math.max(...ys.flat())
  // 軸 0 の最小は hot の 5（下）・最大は a の 100（上）。軸 1 は a の 20（下）・hot の 500（上）。軸 2 は hot の 2（下）・a の 9（上）
  const [hot, a] = [ys[3], ys[0]]
  near(hot[0], bottom); near(a[0], top)
  near(a[1], bottom); near(hot[1], top)
  near(hot[2], bottom); near(a[2], top)
  assert.equal(paths[3]['stroke-width'], '1.5')
  assert.ok(paths.slice(0, 3).every((p) => p['stroke-width'] === '1' && p['stroke-opacity'] === '0.18'))
})

test('parallel-coords: 目立たせる線の値が全部の軸に出る。highlight で線を替えられ、数の欠けた系列は捨てて warnings に書く', () => {
  const series = [{ name: 'a', values: [1, 2] }, { name: 'b', values: [3, 4] }, { name: 'c', values: [5, 'x'] }]
  const n = norm('parallel-coords', { axes: ['p', 'q'], series, highlight: 'b' })
  assert.equal(n.data.series.length, 2)
  assert.equal(n.data.hot, 1)
  assert.ok(n.warnings.some((w) => /捨てました/.test(w)))
  const t = textsOf(draw('parallel-coords', { axes: ['p', 'q'], series: series.slice(0, 2), highlight: 'b' }).svg).filter((x) => x.bold).map((x) => x.s)
  assert.deepEqual(t, ['3', '4'])
})

test('parallel-coords: 目立たせる線が軸の端に居る軸は端の字が値を兼ね（太字の accent・1 つだけ）、値の字はほかの字に重ならない', () => {
  const data = { axes: ['売上', '日数', '人数'], series: [{ name: 'h', values: [9, 50, 2] }, { name: 'a', values: [1, 100, 9] }, { name: 'b', values: [5, 10, 4] }] }
  const t = textsOf(draw('parallel-coords', data).svg)
  assert.deepEqual(t.filter((x) => x.bold).map((x) => x.s).sort(), ['2', '50', '9'])
  assert.ok(t.filter((x) => x.bold).every((x) => x.fill === MONO.accent))
  assert.deepEqual(collisions(t), [])
  // 全部の系列が同じ値の軸は、端の字が 1 つだけで、数でない座標（NaN）も出ない
  const flatAxis = draw('parallel-coords', { axes: ['a', 'b'], series: [{ name: 'h', values: [5, 5] }, { name: 'x', values: [5, 7] }] })
  assert.ok(!/NaN|Infinity/.test(flatAxis.svg))
  assert.deepEqual(textsOf(flatAxis.svg).filter((x) => x.s === '5' && x.x === textsOf(flatAxis.svg).find((y) => y.s === 'a')?.x).length, 1)
  // 軸が詰まる幅（12 本・300pt）でも、置いた字どうしが重ならない（置けない値は字を抜く）
  const axes = Array.from({ length: 12 }, (_, i) => `軸${i + 1}`)
  // 目立たせる線は全部の軸で 9,500（最大の 10,000 の少し下）。値の字が横に並んで重なる並び
  const series = [{ name: 'h', values: axes.map(() => 9500) }, ...Array.from({ length: 5 }, (_, k) => ({ name: `s${k}`, values: axes.map((_, i) => ((i * 7 + k * 13) % 11) * 1000) })), { name: 'top', values: axes.map(() => 10000) }]
  const crowded = textsOf(draw('parallel-coords', { axes, series }, { width: 300 }).svg)
  assert.deepEqual(collisions(crowded), [])
})

// ---------------------------------------------------------------- chord

const FLOW = {
  nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  links: [{ source: 'A', target: 'B', value: 40 }, { source: 'B', target: 'A', value: 36 }, { source: 'A', target: 'C', value: 10 }, { source: 'C', target: 'B', value: 4 }],
}

test('chord: リボンは「つながりのある組」ごとに 1 本（向きが違う 2 本は 1 本の両端）、輪の弧は節の数で、合計の字が出る', () => {
  const r = draw('chord', FLOW)
  const paths = tagsOf(r.svg, 'path')
  // 組は A-B・A-C・B-C の 3 本 + 輪の弧 3 つ
  assert.equal(paths.length, 6)
  assert.equal(paths.filter((p) => p['fill-opacity'] === '0.55' && !p.stroke).length, 3 + 0, '輪の弧は墨の 55%')
  const t = textsOf(r.svg).map((x) => x.s)
  assert.ok(t.includes('合計 90'))
  assert.ok(t.includes('A') && t.includes('B') && t.includes('C'))
})

test('chord: 目立たせるのは 2 つの向きの合計が最大の組（A と B の 76）で、合計の字が下敷きの上に出る。highlight で組を替えられる', () => {
  const r = draw('chord', FLOW)
  const hotRibbon = tagsOf(r.svg, 'path').filter((p) => p.stroke && p['fill-opacity'] === '0.55')
  assert.equal(hotRibbon.length, 1)
  assert.ok(textsOf(r.svg).some((x) => x.s === '76' && x.bold))
  // 字の前に、紙の白の 85% の下敷きの四角がある
  assert.ok(tagsOf(r.svg, 'rect').some((q) => q.fill === MONO.paper && q['fill-opacity'] === '0.85'))
  const other = draw('chord', { ...FLOW, highlight: ['C', 'A'] })
  assert.ok(textsOf(other.svg).some((x) => x.s === '10' && x.bold))
  assert.equal(norm('chord', { ...FLOW, highlight: ['A', 'Z'] }).warnings.length, 1)
})

test('chord: 自分から自分へ・無い名前・0 以下の値のつながりを捨て、同じ向きの同じ組は足し合わせ、つながりの無い節は描かない', () => {
  const n = norm('chord', {
    nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'Z' }],
    links: [{ source: 'A', target: 'A', value: 5 }, { source: 'A', target: 'B', value: 3 }, { source: 'A', target: 'B', value: 4 }, { source: 'B', target: 'Q', value: 1 }, { source: 'B', target: 'C', value: 0 }],
  })
  assert.deepEqual(n.data.names, ['A', 'B'])
  assert.equal(n.data.matrix[0][1], 7)
  assert.equal(n.warnings.length, 4)
  assert.match(draw('chord', { nodes: [{ name: 'A' }, { name: 'B' }], links: [{ source: 'A', target: 'B', value: 0 }] }).svg, /データがありません/)
})

test('chord: 節が 24 を超えたら出入りの合計が大きい 24 を残し、名前は 8pt・出した数は 7.5pt の sub で添える', () => {
  const nodes = Array.from({ length: 30 }, (_, i) => ({ name: `n${i}` }))
  const links = nodes.slice(1).map((n, i) => ({ source: nodes[0].name, target: n.name, value: 100 - i }))
  const n = norm('chord', { nodes, links })
  assert.equal(n.data.names.length, 24)
  assert.ok(n.warnings.some((w) => /24 個まで/.test(w)))
  const t = textsOf(draw('chord', FLOW).svg)
  const a = /** @type {any} */ (t.find((x) => x.s === 'A'))
  assert.equal(a.size, 8)
  const aSent = t.find((x) => x.s === '50')
  assert.equal(aSent?.size, 7.5)
  assert.equal(aSent?.fill, MONO.sub)
})

// ---------------------------------------------------------------- dendrogram

const TREE = {
  root: {
    name: '全体',
    children: [
      { name: '甲', children: [{ name: 'g1', children: [{ name: 'a', value: 5 }, { name: 'b', value: 3 }] }, { name: 'g2', children: [{ name: 'c', value: 10 }, { name: 'd', value: 1 }] }] },
      { name: '乙', children: [{ name: 'e', value: 7 }, { name: 'f', value: 2 }] },
    ],
  },
}

test('dendrogram: 葉は全部同じ列で等間隔の行に並び、丸の数が葉の数、数は右揃えで右端にあり、右下の合計が葉の数の和', () => {
  const r = draw('dendrogram', TREE)
  const dots = tagsOf(r.svg, 'circle')
  assert.equal(dots.length, 6)
  assert.equal(new Set(dots.map((c) => c.cx)).size, 1)
  const ys = dots.map((c) => Number(c.cy))
  for (let i = 2; i < ys.length; i++) near(ys[i] - ys[i - 1], ys[1] - ys[0], 0.02)
  const t = textsOf(r.svg)
  assert.deepEqual(t.filter((x) => x.anchor === 'end' && x.size === 7.5 && /^\d+$/.test(x.s)).map((x) => x.s), ['5', '3', '10', '1', '7', '2'])
  assert.ok(t.some((x) => x.s === '合計 28') && t.some((x) => x.s === '6 項目'))
})

test('dendrogram: 目立たせるのは「子が全部葉の束」のうち葉の合計が最大の束（g2 の 11）で、ラベルに合計が添う。highlight で替えられる', () => {
  const t = textsOf(draw('dendrogram', TREE).svg)
  const hot = t.find((x) => x.fill === MONO.accent && /^g2 11$/.test(x.s))
  assert.ok(hot, `目立たせるラベル: ${t.map((x) => x.s).join('|')}`)
  const other = textsOf(draw('dendrogram', { ...TREE, highlight: '乙' }).svg)
  assert.ok(other.some((x) => x.s === '乙 9'))
  assert.ok(norm('dendrogram', { ...TREE, highlight: 'zz' }).warnings.some((w) => /highlight/.test(w)))
  // 目立たせる枝の葉の丸は 100%、ほかは 55%
  const ops = draw('dendrogram', TREE)
  const op = tagsOf(ops.svg, 'circle').map((c) => c['fill-opacity'] ?? '1')
  assert.deepEqual(op, ['0.55', '0.55', '1', '1', '0.55', '0.55'])
})

test('dendrogram: 葉は 60 までで、超えた分は捨てて warnings。数の無い葉だけの木は数の列と合計を出さない', () => {
  const kids = Array.from({ length: 70 }, (_, i) => ({ name: `l${i}`, value: 1 }))
  const n = norm('dendrogram', { root: { name: 'r', children: kids } })
  assert.equal(n.data.leaves, 60)
  assert.ok(n.warnings.some((w) => /60 個まで/.test(w)))
  const t = textsOf(draw('dendrogram', { root: { name: 'r', children: [{ name: 'g', children: [{ name: 'x' }, { name: 'y' }] }] } }).svg).map((x) => x.s)
  assert.ok(!t.some((s) => s.startsWith('合計')))
})

test('dendrogram: 行の間が狭い時は、目立たせる枝の葉の名前も 9.5pt 以上離して間引き、少なくとも 1 つは出す', () => {
  const leaves = (/** @type {string} */ p, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ name: `${p}${i}`, value: i + 1 }))
  const tree = { root: { name: 'r', children: [{ name: 'g', children: leaves('a', 8) }, { name: 'h', children: leaves('b', 4) }] }, highlight: 'g' }
  const t = textsOf(draw('dendrogram', tree, { height: 120 }).svg).filter((x) => x.size === 8)
  assert.ok(t.some((x) => /^a/.test(x.s)))
  assert.ok(t.length < 12)
  assert.deepEqual(collisions(t), [])
})

// ---------------------------------------------------------------- force-graph

/** 5 つの節の星 + 1 本の枝（A がつなぎ 4 本・B が 2 本） */
const STAR = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name })),
  links: [['A', 'B'], ['A', 'C'], ['A', 'D'], ['A', 'E'], ['B', 'F']].map(([source, target]) => ({ source, target })),
}

test('force-graph: 丸の半径はつなぎの本数の平方根で増え（2 + 1.3 × √(本数 - 1)）、つなぎがいちばん多い節だけが目立つ（mono は墨 100%）', () => {
  const r = draw('force-graph', STAR)
  const dots = tagsOf(r.svg, 'circle')
  // 凡例の丸（1・中間・最大）が先、節の丸は本数の少ない順
  const nodeDots = dots.filter((c) => c.cy !== '11')
  assert.equal(nodeDots.length, 6)
  const radii = nodeDots.map((c) => Number(c.r)).sort((a, b) => a - b)
  const want = [1, 1, 1, 1, 2, 4].map((d) => 2 + 1.3 * Math.sqrt(d - 1)).sort((a, b) => a - b)
  radii.forEach((v, i) => near(v, want[i], 0.01))
  const solid = nodeDots.filter((c) => c['fill-opacity'] === undefined)
  assert.equal(solid.length, 1)
  near(Number(solid[0].r), 2 + 1.3 * Math.sqrt(3), 0.01)
})

test('force-graph: 描くたびに同じ配置になり、つなぎは 1 本の path で、丸と線が描画面の中に収まる', () => {
  const a = draw('force-graph', LOOKS['force-graph'].sample())
  const b = draw('force-graph', LOOKS['force-graph'].sample())
  assert.equal(a.svg, b.svg)
  assert.equal(tagsOf(a.svg, 'path').length, 1)
  for (const c of tagsOf(a.svg, 'circle')) {
    assert.ok(Number(c.cx) - Number(c.r) >= 0 && Number(c.cx) + Number(c.r) <= MEASURE, `x ${c.cx}`)
    assert.ok(Number(c.cy) - Number(c.r) >= 0 && Number(c.cy) + Number(c.r) <= a.height, `y ${c.cy}`)
  }
})

test('force-graph: 名前を置くのはつなぎの多い 5 つ（節が 8 個以下なら全部）で、名前は丸にも別の名前にも重ならず、下敷きの上に出る', () => {
  const r = draw('force-graph', LOOKS['force-graph'].sample())
  const t = textsOf(r.svg).filter((x) => x.size === 8)
  assert.equal(t.length, 5)
  assert.equal(tagsOf(r.svg, 'rect').filter((q) => q['fill-opacity'] === '0.85').length, 5)
  const small = textsOf(draw('force-graph', STAR).svg).filter((x) => x.size === 8)
  assert.equal(small.length, 6)
  // 名前の箱（左端から幅まで）が、どの丸にも重ならない
  const dots = tagsOf(r.svg, 'circle').filter((c) => Number(c.cy) > 20)
  const ops = flat(toOps(r, MONO).ops)
  for (const op of ops.filter((o) => o.t === 'text' && o.size === 8)) {
    const x0 = op.glyphs[0].x
    const x1 = op.glyphs[op.glyphs.length - 1].x + op.size
    for (const c of dots) {
      const cx = Number(c.cx)
      const cy = Number(c.cy)
      const rr = Number(c.r)
      const hit = cx + rr > x0 && cx - rr < x1 && cy + rr > op.y - 8 && cy - rr < op.y + 2
      assert.ok(!hit, `「${textOf(op)}」が丸 (${cx}, ${cy}) に重なった`)
    }
  }
})

test('force-graph: 自分から自分へ・無い名前・向きの違う同じ組のつなぎを捨て（同じ組は 1 本）、highlight で目立たせる節を替えられる', () => {
  const n = norm('force-graph', {
    nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    links: [{ source: 'A', target: 'A' }, { source: 'A', target: 'B' }, { source: 'B', target: 'A' }, { source: 'B', target: 'Q' }, { source: 'B', target: 'C' }],
    highlight: 'C',
  })
  assert.equal(n.data.links.length, 2)
  assert.equal(n.warnings.length, 3)
  assert.equal(n.data.hot, 2)
  assert.equal(norm('force-graph', { ...STAR, highlight: 'ZZ' }).data.hot, 0)
})

test('8 つの形はどれも index の LOOKS に入り、種類は 4 章の表のとおり（比べ 5・流れ 3）で、英語でも字が出る', () => {
  assert.deepEqual(IDS.filter((id) => !LOOKS[id]), [])
  assert.deepEqual(IDS.map((id) => LOOKS[id].category), ['compare', 'compare', 'compare', 'compare', 'compare', 'flow', 'flow', 'flow'])
  for (const id of IDS) {
    const r = drawLook(id, LOOKS[id].sample(), { width: MEASURE, pal: MONO, lang: 'en' })
    assert.deepEqual(r.warnings, [])
    assert.ok(flat(toOps(r, MONO).ops).filter((o) => o.t === 'text').length > 3, id)
  }
})
