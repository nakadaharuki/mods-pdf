// ECharts の見本・テーマ（assets/echarts/）を使う chart の Block と、割った束の試験。素材は repo の物をそのまま読む。
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chartToOps, chartBlockToOps, loadChartAssets, chartAssetNeeds, resolveChartBlock, stripForPaper, resetChartAssets, usesChartAssets,
} from '../hooks/engine/chart.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readFile = (p) => fs.promises.readFile(p, 'utf8')
const io = { root, read: readFile }

const font = { upm: 1000, ascent: 0.88, descent: -0.12, adv: (cp) => (cp > 0x2e7f ? 1 : 0.55), has: () => true, run: () => ({ width: 0, xs: [] }) }
const metrics = { sans: font, sansBold: font, mincho: font, minchoBold: font }
const OPTS = (theme = 'mono', extra = {}) => ({ x: 20, y: 30, width: 480, height: 260, metrics, theme: makeTheme({ theme }), ...extra })

const flat = (ops) => ops.flatMap((o) => (o.t === 'clip' ? [o, ...flat(o.ops)] : [o]))
const texts = (ops) => flat(ops).filter((o) => o.t === 'text')
const stringOf = (op) => op.glyphs.map((g) => g.c).join('')

const EXAMPLES = ['bar-simple', 'line-simple', 'pie-simple', 'area-rainfall', 'heatmap-large-piecewise', 'mix-timeline-finance', 'bar-negative']

before(async () => {
  resetChartAssets()
  await loadChartAssets(io, { themes: true, catalog: true, examples: EXAMPLES })
})

test('割った束は全ファイルが 1 MiB 未満で、入口が読む相手が全部ある', () => {
  const dir = path.join(root, 'hooks', 'vendor')
  const names = fs.readdirSync(dir).filter((n) => /^echarts(-[\w-]+)?\.mjs$/.test(n))
  assert.ok(names.includes('echarts.mjs'))
  assert.ok(names.length >= 5, '割れていない')
  for (const n of names) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8')
    assert.ok(Buffer.byteLength(text) < 1048576, `${n} が 1 MiB 以上`)
    for (const m of text.matchAll(/(?:^|[;}\n])(?:import|export)\b[^'";(]*?["']([^"']+)["']/g)) {
      assert.ok(m[1].startsWith('./') && names.includes(m[1].slice(2)), `${n}: import 先 ${m[1]} が無い`)
    }
  }
})

test('束の入口は renderSvg を export し、割った束でも棒・折れ線・円が同じ形で描ける', async () => {
  const mod = await import('../hooks/vendor/echarts.mjs')
  assert.equal(typeof mod.renderSvg, 'function')
  const svg = mod.renderSvg({ xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: {}, series: [{ type: 'bar', data: [1, 2] }] }, { width: 200, height: 120 })
  assert.ok(svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'))
})

test('見本の id だけで、棒・折れ線・円が描ける（警告なし・全体が渡した四角の ClipOp 1 つ）', () => {
  for (const id of ['bar-simple', 'line-simple', 'pie-simple']) {
    const r = chartBlockToOps({ type: 'chart', example: id }, OPTS())
    assert.deepEqual(r.warnings, [], id)
    assert.equal(r.ops.length, 1, id)
    assert.deepEqual([r.ops[0].t, r.ops[0].x, r.ops[0].y, r.ops[0].w, r.ops[0].h], ['clip', 20, 30, 480, 260])
    assert.ok(flat(r.ops).length > 10, id)
  }
})

test('棒の見本には軸の目盛り（Mon〜Sun）の字が出る', () => {
  const strings = texts(chartBlockToOps({ type: 'chart', example: 'bar-simple' }, OPTS()).ops).map(stringOf)
  for (const d of ['Mon', 'Tue', 'Sun']) assert.ok(strings.includes(d), d)
})

test('data（series の data）が見本の数字を置き換える', () => {
  const r = resolveChartBlock({ type: 'chart', example: 'bar-simple', data: [[1, 2]] }, 'mono')
  assert.deepEqual(r.option.series[0].data, [[1, 2]])
  const cat = chartBlockToOps({ type: 'chart', example: 'bar-simple', data: { categories: ['東京', '大阪'], series: [{ data: [3, 5] }] } }, OPTS())
  const strings = texts(cat.ops).map(stringOf)
  assert.ok(strings.includes('東京') && strings.includes('大阪'), strings.join(','))
  assert.ok(!strings.includes('Mon'))
})

test('data が dataset を持つ見本では dataset の source を置き換える', () => {
  const base = resolveChartBlock({ type: 'chart', example: 'bar-negative' }, 'mono').option
  assert.ok(base, 'bar-negative を読めなかった')
  const withDataset = { dataset: { source: [['x', 'y'], ['a', 1]] }, series: [{ type: 'bar' }] }
  const r = resolveChartBlock({ type: 'chart', option: withDataset, data: [['k', 'v'], ['p', 9], ['q', 8]] }, 'mono')
  assert.deepEqual(r.option.dataset.source, [['k', 'v'], ['p', 9], ['q', 8]])
})

test('data の { series: [{ name, data }] } は前の系列から順に重ね、足りない系列は最後の系列を写して足し、凡例の古い名前を捨てる', () => {
  const option = { legend: { data: ['旧A', '旧B'] }, xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: {}, series: [{ name: '旧A', type: 'line', data: [1, 2] }] }
  const r = resolveChartBlock({ type: 'chart', option, data: { series: [{ name: 'A', data: [5, 6] }, { name: 'B', data: [7, 8] }] } }, 'mono')
  assert.deepEqual(r.option.series.map((s) => [s.name, s.type, s.data]), [['A', 'line', [5, 6]], ['B', 'line', [7, 8]]])
  assert.equal(r.option.legend.data, undefined)
})

test('option は最後に深く重ね、配列は丸ごと置き換える', () => {
  const r = resolveChartBlock({
    type: 'chart', example: 'bar-simple',
    option: { yAxis: { name: '件数' }, series: [{ type: 'line', data: [9] }] },
  }, 'mono')
  assert.equal(r.option.yAxis.type, 'value', '見本の項目が消えた')
  assert.equal(r.option.yAxis.name, '件数')
  assert.deepEqual(r.option.series, [{ type: 'line', data: [9] }])
  assert.equal(r.option.xAxis.type, 'category')
})

test('知らない example は投げず、warnings に書いて ops は空', () => {
  const r = chartBlockToOps({ type: 'chart', example: 'no-such-example' }, OPTS())
  assert.deepEqual(r.ops, [])
  assert.ok(r.warnings.some((w) => w.includes('no-such-example')), r.warnings.join('/'))
})

test('知らない example でも option が添えてあれば、その option で描く', () => {
  const option = { xAxis: { type: 'category', data: ['x'] }, yAxis: {}, series: [{ type: 'bar', data: [1] }] }
  const r = chartBlockToOps({ type: 'chart', example: 'no-such-example', option }, OPTS())
  assert.ok(r.ops.length === 1)
  assert.ok(r.warnings.some((w) => w.includes('no-such-example')))
})

test('壊れた JSON・大きすぎる素材・読めない素材は投げず、理由が warnings に出る', async () => {
  resetChartAssets()
  const bad = { root: '/x', read: async (p) => (p.includes('broken') ? '{ not json' : p.includes('huge') ? 'x'.repeat(4 * 1024 * 1024 + 1) : p.includes('noopt') ? '{"id":"noopt"}' : Promise.reject(new Error('EIO'))) }
  await loadChartAssets(bad, { themes: true, examples: ['broken', 'huge', 'noopt', 'unreadable', '../etc', 'a b'] })
  for (const id of ['broken', 'huge', 'noopt', 'unreadable', '../etc', 'a b']) {
    const r = chartBlockToOps({ type: 'chart', example: id }, OPTS())
    assert.deepEqual(r.ops, [], id)
    assert.ok(r.warnings.length >= 1, id)
  }
  const themeWarn = chartBlockToOps({ type: 'chart', option: { series: [{ type: 'pie', data: [{ value: 1, name: 'a' }] }] }, theme: 'vivid' }, OPTS())
  assert.ok(themeWarn.warnings.some((w) => w.includes('themes.json')), themeWarn.warnings.join('/'))
  assert.ok(themeWarn.ops.length === 1, 'テーマが無くても図は描く')
  resetChartAssets()
  await loadChartAssets(io, { themes: true, catalog: true, examples: EXAMPLES })
})

test('素材は 1 度しか読まない', async () => {
  resetChartAssets()
  const seen = []
  const counting = { root, read: (p) => { seen.push(path.basename(p)); return readFile(p) } }
  await loadChartAssets(counting, { themes: true, examples: ['bar-simple'] })
  await loadChartAssets(counting, { themes: true, examples: ['bar-simple', 'line-simple'] })
  assert.deepEqual(seen.sort(), ['bar-simple.json', 'line-simple.json', 'themes.json'])
  await loadChartAssets(io, { themes: true, catalog: true, examples: ['pie-simple', 'area-rainfall', 'heatmap-large-piecewise', 'mix-timeline-finance', 'bar-negative'] })
})

test('紙に要らない部品（toolbox・tooltip・brush・axisPointer）は落ち、範囲と色は残る', () => {
  const o = {
    toolbox: {}, tooltip: {}, brush: {}, axisPointer: {},
    dataZoom: [{ type: 'slider', start: 10, end: 60 }, { type: 'inside', start: 10, end: 60 }],
    visualMap: { type: 'continuous', min: 0, max: 5, calculable: true },
    timeline: { autoPlay: true, loop: true, controlStyle: { showPlayBtn: true } },
    series: [],
  }
  stripForPaper(o)
  for (const k of ['toolbox', 'tooltip', 'brush', 'axisPointer']) assert.equal(o[k], undefined, k)
  assert.deepEqual(o.dataZoom.map((z) => [z.type, z.start, z.end]), [['inside', 10, 60], ['inside', 10, 60]])
  assert.equal(o.visualMap.max, 5)
  assert.equal(o.visualMap.calculable, false)
  assert.equal(o.timeline.autoPlay, false)
  assert.equal(o.timeline.loop, false)
  assert.equal(o.timeline.controlStyle.show, false)
})

test('見本の系列には、ラベルの重なりを除ける指定（hideOverlap）が付く。見本が自分で決めた系列は書き換えない', () => {
  const o = { series: [{ type: 'bar', label: { show: true } }, { type: 'bar', labelLayout: { hideOverlap: false } }] }
  stripForPaper(o)
  assert.deepEqual(o.series[0].labelLayout, { hideOverlap: true })
  assert.deepEqual(o.series[1].labelLayout, { hideOverlap: false })
})

test('timeline の baseOption と options の中の部品も落ちる', () => {
  const o = { baseOption: { tooltip: {}, timeline: {}, series: [] }, options: [{ toolbox: {} }, { brush: {} }] }
  stripForPaper(o)
  assert.equal(o.baseOption.tooltip, undefined)
  assert.equal(o.options[0].toolbox, undefined)
  assert.equal(o.options[1].brush, undefined)
})

test('実際の見本（toolbox と dataZoom を持つ area-rainfall）は、組み込む option に toolbox・tooltip が無く、dataZoom は inside だけ', () => {
  const r = resolveChartBlock({ type: 'chart', example: 'area-rainfall' }, 'mono')
  assert.ok(r.option)
  assert.equal(r.option.toolbox, undefined)
  assert.equal(r.option.tooltip, undefined)
  const zooms = [].concat(r.option.dataZoom ?? [])
  assert.ok(zooms.length > 0)
  assert.ok(zooms.every((z) => z.type !== 'slider'))
  const drawn = chartBlockToOps({ type: 'chart', example: 'area-rainfall' }, OPTS())
  assert.equal(drawn.ops.length, 1)
})

test('visualMap を持つ heatmap の見本は、持ち手を外しても色の凡例が残って描ける', () => {
  const r = chartBlockToOps({ type: 'chart', example: 'heatmap-large-piecewise' }, OPTS())
  assert.equal(r.ops.length, 1)
  assert.ok(flat(r.ops).filter((o) => o.t === 'path').length > 20)
})

test('timeline の見本は再生の部品を外して描ける', () => {
  const r = resolveChartBlock({ type: 'chart', example: 'mix-timeline-finance' }, 'mono')
  const tl = r.option.baseOption?.timeline ?? r.option.timeline
  assert.ok(tl, 'timeline が無い')
  assert.equal(tl.autoPlay, false)
  assert.equal(tl.controlStyle.show, false)
  assert.equal(chartBlockToOps({ type: 'chart', example: 'mix-timeline-finance' }, OPTS()).ops.length, 1)
})

test('同じ入力からは同じ Op の並びができる（見本・テーマ・data を使う図も）', () => {
  const b = { type: 'chart', example: 'bar-simple', theme: 'macarons', data: { series: [{ data: [1, 2, 3] }] } }
  for (const block of [{ type: 'chart', example: 'pie-simple' }, { type: 'chart', example: 'bar-simple', theme: 'macarons' }, b]) {
    const a = JSON.stringify(chartBlockToOps(block, OPTS()))
    assert.equal(a, JSON.stringify(chartBlockToOps(block, OPTS())))
  }
})

test('見本・theme・data を使わない図は chartToOps とまったく同じ Op になる', () => {
  const option = { xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: {}, legend: {}, series: [{ name: 's', type: 'bar', data: [1, 2] }, { type: 'pie', data: [{ name: 'a', value: 1 }] }] }
  assert.equal(usesChartAssets({ type: 'chart', option }), false)
  assert.equal(JSON.stringify(chartBlockToOps({ type: 'chart', option }, OPTS())), JSON.stringify(chartToOps(option, OPTS())))
})

test('ModsPDF のテーマ（vivid）は系列の最初の色が accent と同じ紫で、mono は墨の濃さのまま', () => {
  const vivid = chartBlockToOps({ type: 'chart', example: 'bar-simple' }, OPTS('vivid'))
  const fills = flat(vivid.ops).filter((o) => o.t === 'path' && o.fill).map((o) => o.fill.toUpperCase())
  assert.ok(fills.includes('#6A3DE8'), fills.join(','))
  const mono = chartBlockToOps({ type: 'chart', example: 'bar-simple' }, OPTS('mono'))
  const monoFills = flat(mono.ops).filter((o) => o.t === 'path' && o.fill).map((o) => o.fill.toUpperCase())
  assert.ok(monoFills.includes('#111111'), monoFills.join(','))
  assert.ok(!monoFills.includes('#6A3DE8'))
})

test('組み込みのテーマ（macarons）を名前で選ぶと、そのテーマの系列の色で描く', () => {
  const t = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'echarts', 'themes.json'), 'utf8')).macarons
  const r = chartBlockToOps({ type: 'chart', example: 'bar-simple', theme: 'macarons' }, OPTS('mono'))
  assert.deepEqual(r.warnings, [])
  const fills = flat(r.ops).filter((o) => o.t === 'path' && o.fill).map((o) => o.fill.toUpperCase())
  assert.ok(fills.includes(t.color[0].toUpperCase()), `${t.color[0]} が ${fills.join(',')} に無い`)
})

test('知らないテーマ名は warnings に書いて、文書のテーマで描く', () => {
  const r = chartBlockToOps({ type: 'chart', example: 'bar-simple', theme: 'no-such-theme' }, OPTS('vivid'))
  assert.ok(r.warnings.some((w) => w.includes('no-such-theme')))
  assert.equal(r.ops.length, 1)
})

test('テーマの名前に文書のテーマを使う（既定）。themes.json に 40 個あり、ModsPDF の 4 つを含む', () => {
  const themes = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'echarts', 'themes.json'), 'utf8'))
  assert.equal(Object.keys(themes).length, 40)
  for (const n of ['mono', 'koma', 'mergeble', 'vivid']) assert.ok(themes[n], n)
  assert.equal(resolveChartBlock({ type: 'chart', example: 'bar-simple' }, 'vivid').plain, false)
  assert.equal(resolveChartBlock({ type: 'chart', example: 'bar-simple', theme: 'dark' }, 'vivid').plain, true)
})

test('円グラフの名前は長くても「...」で切らず、全部の字が出る', () => {
  const long = 'Very long category name that will not fit the width'
  const option = { series: [{ type: 'pie', radius: '50%', data: [{ name: long, value: 5 }, { name: `${long}2`, value: 3 }, { name: 'c', value: 3 }] }] }
  const size = { width: 300, height: 200 }
  for (const r of [chartToOps(option, OPTS('mono', size)), chartBlockToOps({ type: 'chart', option, theme: 'vivid' }, OPTS('vivid', size)), chartBlockToOps({ type: 'chart', option, theme: 'dark' }, OPTS('vivid', size))]) {
    const strings = texts(r.ops).map(stringOf)
    assert.ok(strings.includes(long), strings.join('/'))
    assert.ok(strings.every((s) => !s.includes('...') && !s.includes('…')), strings.join('/'))
  }
})

test('textMin を渡すと、図の中の字が全部その大きさ以上になる', () => {
  const r = chartBlockToOps({ type: 'chart', example: 'pie-simple' }, OPTS('vivid', { textMin: 9 }))
  const sizes = texts(r.ops).map((t) => t.size)
  assert.ok(sizes.length > 0)
  assert.ok(sizes.every((s) => s >= 9 - 1e-9), sizes.join(','))
  const plain = texts(chartBlockToOps({ type: 'chart', example: 'pie-simple' }, OPTS('vivid')).ops).map((t) => t.size)
  assert.ok(Math.min(...plain) < 9)
})

test('chartAssetNeeds: 道具の引数と Markdown の囲みから見本の id を拾い、見本が無い文書は素材を読まない', () => {
  const blocks = { title: 't', blocks: [{ type: 'chart', example: 'bar-simple' }, { type: 'chart', example: 'pie-simple', theme: 'dark' }, { type: 'para', text: 'x' }] }
  assert.deepEqual(chartAssetNeeds(blocks), { examples: ['bar-simple', 'pie-simple'], themes: true })
  const md = { title: 't', markdown: '# h\n\n```chart\n{"example": "line-simple"}\n```\n' }
  assert.deepEqual(chartAssetNeeds(md), { examples: ['line-simple'], themes: true })
  assert.deepEqual(chartAssetNeeds({ title: 't', markdown: '# h\n\n本文' }), { examples: [], themes: false })
  assert.deepEqual(chartAssetNeeds({ title: 't', theme: 'vivid', blocks: [{ type: 'para', text: 'x' }] }), { examples: [], themes: false })
  assert.deepEqual(chartAssetNeeds(undefined), { examples: [], themes: false })
})

test('chartAssetNeeds: 見本の id は 60 本までしか拾わない', () => {
  const blocks = Array.from({ length: 100 }, (_, i) => ({ type: 'chart', example: `e${i}` }))
  assert.equal(chartAssetNeeds({ blocks }).examples.length, 60)
})

test('目録・見本・テーマの素材が揃っている（目録の id ごとに見本の JSON があり、4 MiB 未満）', () => {
  const dir = path.join(root, 'assets', 'echarts')
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'))
  const files = fs.readdirSync(path.join(dir, 'examples')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort()
  assert.deepEqual(catalog.map((c) => c.id).sort(), files)
  for (const f of files) {
    const size = fs.statSync(path.join(dir, 'examples', `${f}.json`)).size
    assert.ok(size < 4 * 1024 * 1024, `${f} が 4 MiB 以上`)
  }
})
