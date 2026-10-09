// ECharts の「紙に出る物は全部」を esbuild の splitting で割って hooks/vendor/ に出す（地図の geo・map は除く）。
// build-assets.mjs から呼ぶ。単独でも `node scripts/assets/echarts.mjs [--out <dir>]` で動く。
//
// 選ばなかった案
// - 1 ファイルに全部を束ねる案: 1.78 MB になり、フックのモジュールの上限（1 MiB・実測）を超える。
// - src/echarts-entry.mjs のように使う物を数個に絞る案: 本人が「全部入れる」と決めた。Tooltip・Toolbox なども入れる（見本の option が書いてあっても落ちない）。
//   紙に出ない物を入口で見えるようにする代わりに、入れない物は SKIP に理由を書く。
// - esbuild の splitting を entry 1 つで使う案: 共有の chunk は entry が 2 つ以上ある時にしかできない。group ごとに entry を作り、
//   共有の core が 1 つの chunk に出る形にする。esbuild は大きさで割らないので、大きさは group の分け方で決める（足りなければ GROUPS を直す）。
// - dynamic import() で遅延して読む案: フックの環境で動く保証が無く、register を非同期にしたくない。静的な import だけ。
// - ECharts の registerTheme で登録した物を大域に残す案: 文書をまたいで効く。init に object を渡す。
// - GeoComponent・MapChart を入れる案: 地図の GeoJSON が無く、紙の見本にも使えない（束だけ太る）。
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

/** 入れる物の分け方。名前は echarts/charts・components・features の export 名。大きさの均衡は build の結果の一覧で見る */
export const GROUPS = {
  'charts-xy': { from: 'echarts/charts', names: ['LineChart', 'BarChart', 'ScatterChart', 'EffectScatterChart', 'CandlestickChart', 'BoxplotChart', 'HeatmapChart', 'PictorialBarChart', 'CustomChart', 'LinesChart'] },
  'charts-more': { from: 'echarts/charts', names: ['PieChart', 'RadarChart', 'TreeChart', 'TreemapChart', 'GraphChart', 'ChordChart', 'GaugeChart', 'FunnelChart', 'ParallelChart', 'SankeyChart', 'ThemeRiverChart', 'SunburstChart'] },
  'components-axes': { from: 'echarts/components', names: ['GridComponent', 'PolarComponent', 'RadarComponent', 'SingleAxisComponent', 'ParallelComponent', 'CalendarComponent', 'MatrixComponent'] },
  'components-ui': { from: 'echarts/components', names: ['GraphicComponent', 'ToolboxComponent', 'TooltipComponent', 'AxisPointerComponent', 'BrushComponent', 'TitleComponent', 'TimelineComponent', 'LegendComponent', 'DataZoomComponent', 'VisualMapComponent', 'ThumbnailComponent', 'AriaComponent', 'TransformComponent', 'DatasetComponent', 'MarkPointComponent', 'MarkLineComponent', 'MarkAreaComponent'] },
  features: { from: 'echarts/features', names: ['UniversalTransition', 'LabelLayout', 'AxisBreak', 'ScatterJitter'] },
}

/** 入れない export とその理由（GROUPS と合わせて、echarts の export が全部説明される事を build が確かめる） */
export const SKIP = {
  MapChart: '地図の GeoJSON が無い',
  GeoComponent: '地図の GeoJSON が無い',
  GridSimpleComponent: 'GridComponent に含まれる',
  LegendScrollComponent: 'LegendComponent に含まれる',
  LegendPlainComponent: 'LegendComponent に含まれる',
  DataZoomInsideComponent: 'DataZoomComponent に含まれる',
  DataZoomSliderComponent: 'DataZoomComponent に含まれる',
  VisualMapContinuousComponent: 'VisualMapComponent に含まれる',
  VisualMapPiecewiseComponent: 'VisualMapComponent に含まれる',
  CanvasRenderer: '紙には SVG だけ',
  // containLabel: true を ECharts 5 の古い計算に戻す feature。chart.mjs の既定の grid が containLabel: true を書くので、入れると今までの図の大きさが変わる
  // （棒グラフの描く幅が 3pt ずれた）。入れなくても ECharts 6 の outerBounds（既定 auto）が目盛りの字と軸名を図の中に収める。見本 301 本のうち containLabel を書くのは 19 本
  LegacyGridContainLabel: 'chart.mjs の既定の図の大きさを変えない',
}

/** 1 ファイルの上限。フックのモジュールは 1 MiB（1,048,576 B）まで（実測）。余りを残す */
export const FILE_LIMIT = 1_000_000

const escapeControls = (s) => s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).replace(/\t/g, '\\t')
/** フックの環境には process もタイマーも無い。束の中だけで効く代わりを全部のファイルの頭に置く（大域は書き換えない）。build-vendor.mjs と同じ */
const SHIM = "const process = { env: { NODE_ENV: 'production' }, nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) }, setTimeout = (f) => { Promise.resolve().then(f); return 0 }, clearTimeout = () => {}, setImmediate = (f) => Promise.resolve().then(f);"
/**
 * 束に入ってはいけない字（止める）。$. は静的な検査が mods の呼び出しと読んで落とす。require・eval・動的 import・node: の import は読み込みの口になる。
 * hook-env-check.mjs が Mod の .mjs に探す語のうち Buffer・setTimeout・process・new Function は、ECharts と zrender が「無ければ使わない」守りや
 * 頭の shim が受ける呼び出しとして含む（vendor は点検の対象外）。止めずに数だけ出す（ADVISORY）
 */
const FORBIDDEN = [
  ['$.', /\$\./],
  ['require(', /require\(/],
  ['eval(', /\beval\(/],
  ['import(', /\bimport\s*\(/],
  ['import "node:..."', /(?:\bfrom|\bimport)\s*["']node:/],
]
const ADVISORY = [
  ['node:', /node:/g],
  ['Buffer', /\bBuffer\b/g],
  ['setTimeout', /setTimeout/g],
  ['process', /\bprocess\b/g],
  ['new Function', /new Function/g],
]

/** echarts の export 名を lib/export/*.js から読む（上のどちらにも書いていない物が増えたら止める） */
function exportedNames(root, file) {
  const text = fs.readFileSync(path.join(root, 'node_modules', 'echarts', 'lib', 'export', `${file}.js`), 'utf8')
  return [...text.matchAll(/export\s*\{[^}]*?\bas\s+(\w+)\s*\}/g)].map((m) => m[1])
}

function checkCoverage(root) {
  const grouped = new Set(Object.values(GROUPS).flatMap((g) => g.names))
  const missing = []
  for (const file of ['charts', 'components', 'features', 'renderers']) {
    for (const name of exportedNames(root, file)) {
      if (!grouped.has(name) && !(name in SKIP) && name !== 'SVGRenderer') missing.push(`${file}:${name}`)
    }
  }
  const known = new Set(['charts', 'components', 'features'].flatMap((f) => exportedNames(root, f)))
  const stale = [...grouped].filter((n) => !known.has(n))
  if (missing.length || stale.length) throw new Error(`echarts の export と GROUPS・SKIP が合わない。足りない: ${missing.join(' ')} / 存在しない: ${stale.join(' ')}`)
}

function entrySources() {
  const src = {}
  for (const [id, g] of Object.entries(GROUPS)) {
    src[`virtual:${id}`] = [
      `import * as echarts from 'echarts/core'`,
      `import { ${g.names.join(', ')} } from '${g.from}'`,
      `echarts.use([${g.names.join(', ')}])`,
    ].join('\n')
  }
  // 入口。group は同じ out の兄弟ファイルとして import する（外部扱い。echarts/core は共有の chunk に出るので、group の use と同じ登録先を指す）
  src['virtual:main'] = [
    `import * as echarts from 'echarts/core'`,
    `import { SVGRenderer } from 'echarts/renderers'`,
    ...Object.keys(GROUPS).map((id) => `import './echarts-${id}.mjs'`),
    `echarts.use([SVGRenderer])`,
    ``,
    `// テーマを名前で登録する（init に object を渡す方が文書をまたいで残らない。名前で呼びたい時のため）`,
    `export const { registerTheme } = echarts`,
    ``,
    `/**`,
    ` * ECharts の option を SVG の字にする（描いたら捨てる。アニメーションは切る）`,
    ` * @param {object} option`,
    ` * @param {{ width: number, height: number, theme?: string | object }} size theme は registerTheme した名前か theme の object`,
    ` * @returns {string}`,
    ` */`,
    `export function renderSvg(option, { width, height, theme }) {`,
    `  const chart = echarts.init(null, theme ?? null, { renderer: 'svg', ssr: true, width, height })`,
    `  try {`,
    `    chart.setOption({ ...option, animation: false })`,
    `    return chart.renderToSVGString()`,
    `  } finally {`,
    `    chart.dispose()`,
    `  }`,
    `}`,
  ].join('\n')
  return src
}

/**
 * @param {{ out: string, root: string, log?: (s: string) => void }} o out は repo の root と同じ並び（hooks/vendor/ をその下に作る）
 * @returns {Promise<{ files: { name: string, size: number }[], total: number, advisory: Record<string, number> }>}
 */
export async function buildEcharts({ out, root, log = console.log }) {
  checkCoverage(root)
  const vendor = path.join(out, 'hooks', 'vendor')
  fs.mkdirSync(vendor, { recursive: true })
  // 前の chunk（名前に内容の hash が入る）が残らないように、echarts の分だけ先に消す
  for (const n of fs.readdirSync(vendor)) if (/^echarts(-[\w-]+)?\.mjs$/.test(n)) fs.rmSync(path.join(vendor, n))

  const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'echarts', 'package.json'), 'utf8')).version
  const sources = entrySources()
  const plugin = {
    name: 'mp-virtual',
    setup(b) {
      b.onResolve({ filter: /^\.\/echarts-[\w-]+\.mjs$/ }, (a) => ({ path: a.path, external: true }))
      b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'mp' }))
      b.onLoad({ filter: /.*/, namespace: 'mp' }, (a) => ({ contents: sources[a.path], resolveDir: root, loader: 'js' }))
    },
  }
  const entryPoints = { echarts: 'virtual:main' }
  for (const id of Object.keys(GROUPS)) entryPoints[`echarts-${id}`] = `virtual:${id}`

  await build({
    entryPoints, outdir: vendor, entryNames: '[name]', chunkNames: 'echarts-c-[hash]', outExtension: { '.js': '.mjs' },
    absWorkingDir: root, plugins: [plugin],
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
    // 識別子は縮めない: 縮めると ECharts の tokens が `$` になり、`$` の直後に点が来る字の並び（フックの検査が探す）が束に出る
    minifyWhitespace: true, minifySyntax: true,
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    banner: { js: [`// 出典: Apache ECharts ${version}（https://echarts.apache.org・Apache-2.0）・zrender（BSD-3-Clause）`, SHIM, '// 元は scripts/assets/echarts.mjs の entry。scripts/build-assets.mjs で作る。手で直さない。LICENSE は ../../LICENSES/'].join('\n') },
    logLevel: 'warning',
  })

  const files = []
  const advisory = Object.fromEntries(ADVISORY.map(([label]) => [label, 0]))
  for (const n of fs.readdirSync(vendor).sort()) {
    if (!/^echarts(-[\w-]+)?\.mjs$/.test(n)) continue
    const file = path.join(vendor, n)
    // 縮めた束は改行だけのテンプレートリテラル（`<改行>`）を残す。走査が「制御文字の字」と見るので "\n" に直す。生の制御の字は \xHH にする
    const text = escapeControls(fs.readFileSync(file, 'utf8').split('`\n`').join('"\\n"'))
    for (const [label, re] of FORBIDDEN) if (re.test(text)) throw new Error(`${n}: 「${label}」の字が出た（束に入ってはいけない）`)
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error(`${n}: 生の制御の字が残った`)
    // shim の行（頭の 1 行）を除いて数える
    const body = text.replace(SHIM, '')
    for (const [label, re] of ADVISORY) advisory[label] += (body.match(re) ?? []).length
    // shim が全部のファイルの頭にある事（chunk にも届いている事）
    if (!text.includes(SHIM)) throw new Error(`${n}: 頭に shim が無い`)
    fs.writeFileSync(file, text)
    const size = Buffer.byteLength(text)
    if (size >= FILE_LIMIT) throw new Error(`${n}: ${size} B が ${FILE_LIMIT} B を超えた（GROUPS の分け方を直す）`)
    files.push({ name: `hooks/vendor/${n}`, size })
  }
  // import は相対だけ・全部の相手が出力の中にある
  const present = new Set(files.map((f) => path.basename(f.name)))
  for (const f of files) {
    const text = fs.readFileSync(path.join(out, f.name), 'utf8')
    // 文の頭の import / export だけ（字列の中の from は数えない）。`import{a}from"./x.mjs"` と `import"./x.mjs"` と `export{a}from"./x.mjs"`
    for (const m of text.matchAll(/(?:^|[;}\n])(?:import|export)\b[^'";(]*?["']([^"']+)["']/g)) {
      if (!m[1].startsWith('./') || !present.has(m[1].slice(2))) throw new Error(`${f.name}: import 先が不正: ${m[1]}`)
    }
  }
  const total = files.reduce((a, f) => a + f.size, 0)
  log(`echarts ${version}: ${files.length} ファイル・合計 ${total} B・最大 ${Math.max(...files.map((f) => f.size))} B（上限 ${FILE_LIMIT} B）`)
  for (const f of files) log(`  ${f.name}  ${f.size}`)
  log(`  hook-env-check の語（止めない・数だけ）: ${Object.entries(advisory).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
  return { files, total, advisory }
}
