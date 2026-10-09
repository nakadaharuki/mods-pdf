// 割った ECharts の束を「フックと同じ環境」（scripts/hook-env-check.mjs の loadMod と同じ大域・codeGeneration）で読み、全部の series と主な component が描ける事を確かめる。
// 実行: node --experimental-vm-modules scripts/assets/verify-echarts.mjs <out> [--bench]   （<out> は hooks/vendor/ と assets/echarts/themes.json を持つ root）
// 確かめは自動だけ（読めるか・描けるか・大きさ）。絵は見ない: series を空にした時より SVG が長くなる事で「その型が登録されている」と見る。
//
// 選ばなかった案
// - 描いた SVG を目で見る: 本人の方針は「そこまでチェックしなくていい」。
// - 登録されていない型の警告を拾う: 製品版の ECharts は「使っているが import していない」を黙って捨てる。出力が変わるかで見る。
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(process.argv[2] ?? '.')
const bench = process.argv.includes('--bench')
const vendor = path.join(out, 'hooks', 'vendor')
const LIMIT = 1_048_576

const fails = []
const ok = (name, extra = '') => console.log(`ok   ${name}${extra ? `  ${extra}` : ''}`)
const ng = (name, error) => { fails.push(name); console.log(`FAIL ${name}: ${error?.stack?.split('\n').slice(0, 3).join(' | ') ?? error}`) }
const assert = (cond, message) => { if (!cond) throw new Error(message) }

/** 新しい環境で入口を読む（link は相対の import だけ・同じ環境の中で 1 回ずつ読む）。読み込みの時間を返す */
async function load() {
  const globals = Object.create(null)
  Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance })
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })
  const cache = new Map()
  let parseMs = 0
  const get = (file) => {
    if (cache.has(file)) return cache.get(file)
    const text = fs.readFileSync(file, 'utf8')
    const t0 = performance.now()
    const mod = new vm.SourceTextModule(text, { identifier: file, context })
    parseMs += performance.now() - t0
    cache.set(file, mod)
    return mod
  }
  const link = async (specifier, referencing) => {
    if (!specifier.startsWith('.')) throw new Error(`plugin の外からの import は使えない: ${specifier}`)
    return get(path.resolve(path.dirname(referencing.identifier), specifier))
  }
  const t0 = performance.now()
  const main = get(path.join(vendor, 'echarts.mjs'))
  await main.link(link)
  const linked = performance.now()
  await main.evaluate()
  return { ns: main.namespace, files: cache.size, parseMs, linkMs: linked - t0, evalMs: performance.now() - linked, loadMs: performance.now() - t0 }
}

// ---- 1 ファイルずつの点検 ----
const names = fs.readdirSync(vendor).filter((n) => /^echarts(-[\w-]+)?\.mjs$/.test(n)).sort()
for (const n of names) {
  const size = fs.statSync(path.join(vendor, n)).size
  try { assert(size < LIMIT, `${size} B が 1 MiB を超える`); ok(`${n} は 1 MiB 未満`, `${size} B`) } catch (e) { ng(n, e) }
}

const dataset = { source: [['product', 'a', 'b'], ['x', 43, 85], ['y', 83, 73], ['z', 86, 65], ['w', 72, 53]] }
const xy = { xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }, yAxis: { type: 'value' } }
const tree = { name: 'root', children: [{ name: 'a', value: 3, children: [{ name: 'a1', value: 2 }, { name: 'a2', value: 1 }] }, { name: 'b', value: 4 }] }
const graphNodes = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
const radar = { radar: { indicator: [{ name: 'A', max: 100 }, { name: 'B', max: 100 }, { name: 'C', max: 100 }, { name: 'D', max: 100 }] } }

/** series の型ごとの option（空の series の時より SVG が長くなる事を確かめる）。label は表示用 */
const SERIES = {
  bar: { ...xy, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] },
  line: { ...xy, series: [{ type: 'line', data: [5, 3, 6, 2, 4] }] },
  scatter: { xAxis: {}, yAxis: {}, series: [{ type: 'scatter', data: [[1, 2], [3, 4], [5, 1]] }] },
  effectScatter: { xAxis: {}, yAxis: {}, series: [{ type: 'effectScatter', data: [[1, 2], [3, 4], [5, 1]] }] },
  candlestick: { ...xy, series: [{ type: 'candlestick', data: [[20, 34, 10, 38], [40, 35, 30, 50], [31, 38, 33, 44], [38, 15, 5, 42], [10, 20, 8, 25]] }] },
  boxplot: { ...xy, series: [{ type: 'boxplot', data: [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [1, 3, 4, 6, 7], [2, 2, 3, 3, 4], [3, 4, 5, 6, 8]] }] },
  heatmap: { xAxis: { type: 'category', data: ['a', 'b', 'c'] }, yAxis: { type: 'category', data: ['x', 'y'] }, visualMap: { min: 0, max: 10, show: false }, series: [{ type: 'heatmap', data: [[0, 0, 5], [1, 0, 7], [2, 1, 3]] }] },
  pictorialBar: { ...xy, series: [{ type: 'pictorialBar', symbol: 'rect', data: [5, 3, 6, 2, 4] }] },
  custom: { xAxis: {}, yAxis: {}, series: [{ type: 'custom', renderItem: (params, api) => ({ type: 'circle', shape: { cx: api.coord([api.value(0), api.value(1)])[0], cy: api.coord([api.value(0), api.value(1)])[1], r: 8 }, style: { fill: '#333' } }), data: [[1, 2], [3, 4]] }] },
  lines: { xAxis: {}, yAxis: {}, series: [{ type: 'lines', coordinateSystem: 'cartesian2d', data: [{ coords: [[1, 1], [4, 4]] }, { coords: [[1, 4], [4, 1]] }] }] },
  pie: { series: [{ type: 'pie', data: [{ value: 3, name: 'a' }, { value: 5, name: 'b' }] }] },
  radar: { ...radar, series: [{ type: 'radar', data: [{ value: [80, 50, 70, 40], name: 'x' }] }] },
  tree: { series: [{ type: 'tree', data: [tree] }] },
  treemap: { series: [{ type: 'treemap', data: [tree] }] },
  graph: { series: [{ type: 'graph', layout: 'circular', data: graphNodes, links: [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }] }] },
  chord: { series: [{ type: 'chord', data: graphNodes, links: [{ source: 'A', target: 'B', value: 3 }, { source: 'B', target: 'C', value: 2 }] }] },
  gauge: { series: [{ type: 'gauge', data: [{ value: 60 }] }] },
  funnel: { series: [{ type: 'funnel', data: [{ value: 60, name: 'a' }, { value: 30, name: 'b' }] }] },
  parallel: { parallel: {}, parallelAxis: [{ dim: 0, name: 'a' }, { dim: 1, name: 'b' }, { dim: 2, name: 'c' }], series: [{ type: 'parallel', data: [[1, 2, 3], [3, 1, 2]] }] },
  sankey: { series: [{ type: 'sankey', data: graphNodes, links: [{ source: 'A', target: 'B', value: 5 }, { source: 'B', target: 'C', value: 3 }] }] },
  themeRiver: { singleAxis: { type: 'time' }, series: [{ type: 'themeRiver', data: [['2026/01/01', 10, 'a'], ['2026/01/02', 12, 'a'], ['2026/01/01', 5, 'b'], ['2026/01/02', 7, 'b']] }] },
  sunburst: { series: [{ type: 'sunburst', data: tree.children }] },
}
/** component の型ごとの option と、外す key（外すと SVG が短くなる = その component が描いた） */
const COMPONENTS = {
  title: [{ ...xy, title: { text: 'T' }, series: [{ type: 'bar', data: [1, 2] }] }, 'title'],
  legend: [{ legend: { data: ['a', 'b'] }, series: [{ type: 'pie', data: [{ value: 3, name: 'a' }, { value: 5, name: 'b' }] }] }, 'legend'],
  visualMap: [{ ...xy, visualMap: { min: 0, max: 10, calculable: true }, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, 'visualMap'],
  dataset: [{ ...xy, dataset, series: [{ type: 'bar' }] }, 'dataset'],
  polar: [{ polar: {}, angleAxis: {}, radiusAxis: {}, series: [{ type: 'bar', coordinateSystem: 'polar', data: [1, 2, 3] }] }, 'polar'],
  singleAxis: [{ singleAxis: { type: 'category', data: ['a', 'b', 'c'] }, series: [{ type: 'scatter', coordinateSystem: 'singleAxis', data: [[0, 1], [1, 2]] }] }, 'singleAxis'],
  calendar: [{ calendar: { range: '2026-01' }, visualMap: { min: 0, max: 10, show: false }, series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: [['2026-01-02', 3], ['2026-01-05', 8]] }] }, 'calendar'],
  matrix: [{ matrix: { x: { data: ['a', 'b'] }, y: { data: ['c', 'd'] } } }, 'matrix'],
  graphic: [{ graphic: { elements: [{ type: 'rect', shape: { width: 40, height: 20 }, style: { fill: '#333' }, left: 10, top: 10 }] } }, 'graphic'],
  markLine: [{ ...xy, series: [{ type: 'bar', data: [5, 3, 6, 2, 4], markLine: { data: [{ type: 'average' }] } }] }, null],
  markArea: [{ ...xy, series: [{ type: 'bar', data: [5, 3, 6, 2, 4], markArea: { data: [[{ xAxis: 'Tue' }, { xAxis: 'Wed' }]] } }] }, null],
  markPoint: [{ ...xy, series: [{ type: 'bar', data: [5, 3, 6, 2, 4], markPoint: { data: [{ type: 'max' }] } }] }, null],
  dataZoomSlider: [{ ...xy, dataZoom: [{ type: 'slider', start: 0, end: 60 }], series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, 'dataZoom'],
  toolbox: [{ ...xy, toolbox: { feature: { saveAsImage: {} } }, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, 'toolbox'],
  timeline: [{ baseOption: { timeline: { data: ['2025', '2026'] }, ...xy, series: [{ type: 'bar' }] }, options: [{ series: [{ data: [1, 2, 3, 4, 5] }] }, { series: [{ data: [5, 4, 3, 2, 1] }] }] }, null],
  tooltipAxisPointer: [{ ...xy, tooltip: { trigger: 'axis' }, axisPointer: { show: true }, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, null],
  brush: [{ ...xy, brush: {}, toolbox: { feature: { brush: {} } }, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, null],
  aria: [{ ...xy, aria: { enabled: true, decal: { show: true } }, series: [{ type: 'bar', data: [5, 3, 6, 2, 4] }] }, 'aria'],
  transform: [{ ...xy, dataset: [{ source: [['x', 'v'], ['a', 3], ['b', 5], ['c', 4]] }, { transform: { type: 'filter', config: { dimension: 'v', '>=': 4 } } }], series: [{ type: 'bar', datasetIndex: 1 }] }, null],
  labelLayout: [{ ...xy, series: [{ type: 'bar', data: [5, 3, 6, 2, 4], label: { show: true }, labelLayout: { hideOverlap: true } }] }, null],
}

const size = { width: 400, height: 300 }
/** 描くたびに増える id（zr0-c0・zr0-cls-1 など）を畳む */
const norm = (s) => s.replace(/zr\d+-[a-z]*-?\d+/g, 'zr').replace(/zr\d+/g, 'zr')
/** series を空にした時の SVG と長さを比べる。同じ option を 2 回描いて同じ字になる事（決まり）も見る */
async function main() {
  let env
  try {
    env = await load()
    ok('フックと同じ環境で読み込める', `${env.files} ファイル・parse ${env.parseMs.toFixed(0)} ms・link ${env.linkMs.toFixed(0)} ms・evaluate ${env.evalMs.toFixed(0)} ms・合計 ${env.loadMs.toFixed(0)} ms`)
  } catch (e) { ng('フックと同じ環境で読み込める', e); return }
  const { renderSvg, registerTheme } = env.ns
  try { assert(typeof renderSvg === 'function' && typeof registerTheme === 'function', 'renderSvg・registerTheme の export が無い'); ok('入口は renderSvg と registerTheme を export する') } catch (e) { ng('入口の export', e) }

  const base = (opt) => ({ ...opt, series: [] })
  for (const [name, opt] of Object.entries(SERIES)) {
    try {
      const t0 = performance.now()
      const svg = renderSvg(opt, size)
      const ms = performance.now() - t0
      const empty = renderSvg(base(opt), size)
      assert(svg.startsWith('<svg'), '先頭が <svg でない')
      assert(svg.length > empty.length + 50, `series を空にした時と変わらない（${svg.length} / ${empty.length}）: 型が登録されていない`)
      assert(norm(renderSvg(opt, size)) === norm(svg), '同じ option で字が変わる')
      ok(`series ${name} が描ける`, `${svg.length} 字・${ms.toFixed(1)} ms`)
    } catch (e) { ng(`series ${name}`, e) }
  }
  for (const [name, [opt, drop]] of Object.entries(COMPONENTS)) {
    try {
      const svg = renderSvg(opt, size)
      assert(svg.startsWith('<svg'), '先頭が <svg でない')
      if (drop) {
        const { [drop]: _x, ...rest } = opt
        // 外すと series が座標系を見失って投げる物もある（それも「その component が効いている」印）
        let without = null
        try { without = renderSvg(rest, size) } catch { /* 投げた = 効いている */ }
        assert(without === null || norm(svg) !== norm(without), `${drop} を外しても変わらない: component が登録されていない`)
      }
      ok(`component ${name} が通る`, `${svg.length} 字`)
    } catch (e) { ng(`component ${name}`, e) }
  }

  // テーマ: themes.json の全部を init に渡して描ける
  const themesFile = path.join(out, 'assets', 'echarts', 'themes.json')
  if (fs.existsSync(themesFile)) {
    try {
      const themes = JSON.parse(fs.readFileSync(themesFile, 'utf8'))
      const ids = Object.keys(themes)
      assert(ids.length >= 40, `テーマが ${ids.length} 個しかない`)
      const plain = renderSvg(SERIES.bar, size)
      let changed = 0
      for (const id of ids) {
        const svg = renderSvg(SERIES.bar, { ...size, theme: themes[id] })
        assert(svg.startsWith('<svg'), `${id}: 描けない`)
        if (svg !== plain) changed += 1
      }
      registerTheme('verify-theme', themes[ids[0]])
      assert(renderSvg(SERIES.bar, { ...size, theme: 'verify-theme' }).startsWith('<svg'), 'registerTheme した名前で描けない')
      ok(`themes.json の ${ids.length} 個が init に渡せる`, `${changed} 個は既定と違う絵`)
    } catch (e) { ng('themes.json', e) }
  } else console.log('skip themes.json（まだ無い）')

  if (bench) {
    // 時間: 読み込み（5 回）と、5 種類を描く時間（読み込み直後の初回）
    const five = { bar: SERIES.bar, line: SERIES.line, sankey: SERIES.sankey, treemap: SERIES.treemap, radar: SERIES.radar }
    const loads = []
    const firsts = Object.fromEntries(Object.keys(five).map((k) => [k, []]))
    for (let i = 0; i < 5; i++) {
      const e = await load()
      loads.push(e)
      for (const [k, opt] of Object.entries(five)) {
        const t0 = performance.now()
        e.ns.renderSvg(opt, size)
        firsts[k].push(performance.now() - t0)
      }
    }
    const f = (a) => a.map((x) => Math.round(x)).join('/')
    console.log(`bench 読み込み(合計) ${f(loads.map((l) => l.loadMs))} ms・parse ${f(loads.map((l) => l.parseMs))} ms・evaluate ${f(loads.map((l) => l.evalMs))} ms`)
    console.log(`bench 初回の描き ${Object.entries(firsts).map(([k, a]) => `${k} ${f(a)}`).join('・')} ms`)
    const e = loads[0]
    const second = {}
    for (const [k, opt] of Object.entries(five)) { const t0 = performance.now(); e.ns.renderSvg(opt, size); second[k] = Math.round(performance.now() - t0) }
    console.log(`bench 2 回目の描き ${Object.entries(second).map(([k, v]) => `${k} ${v}`).join('・')} ms`)
  }
}
await main()
if (fails.length) { console.log(`\n${fails.length} 件失敗: ${fails.join(' / ')}`); process.exitCode = 1 } else console.log('\nすべて通った')
