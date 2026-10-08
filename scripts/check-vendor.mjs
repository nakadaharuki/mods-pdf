// hooks/vendor/ の 3 つの束（pdf・echarts・text）を、フックと同じ環境（Node の物が無い vm）で読み込んで動かす。
// 実行: node --experimental-vm-modules scripts/check-vendor.mjs
// vm の大域はフックと同じ物だけ。引数の配列や物は vm の中で作る（外で作った配列は別の領域の物で instanceof に弾かれる）。
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const globals = Object.create(null)
Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance, console })
const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })

// 引数を vm の中で作る役。import は持たない（束には依存が入っていない）
const HELPERS = `
export function barLineOption() {
  return {
    xAxis: { type: 'category', data: ['1月', '2月', '3月'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [120, 200, 150] }, { type: 'line', data: [80, 150, 110] }],
  }
}
export function pieOption() {
  return { series: [{ type: 'pie', data: [{ name: '1月', value: 3 }, { name: '2月', value: 5 }] }] }
}
export function candleOption() {
  return {
    xAxis: { type: 'category', data: ['1月', '2月', '3月'] },
    yAxis: { type: 'value', scale: true },
    series: [{ type: 'candlestick', data: [[20, 34, 10, 38], [40, 35, 30, 50], [31, 38, 33, 44]] }],
  }
}
export function chartSize() { return { width: 480, height: 240 } }
export function markdownSource() { return ['# 見出し', '段落の文です。', '| a | b |', '|---|---|', '| 1 | 2 |'].join('\\n') }
export function sentence() { return '今日は天気です。' }
export function a4() { return [595.28, 841.89] }
`

const results = []
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'ok  ' : 'NG  '} ${name}${detail ? `  （${detail}）` : ''}`)
}
const ms = (t0) => `${(performance.now() - t0).toFixed(1)} ms`

/** 束を vm の module として読み、link と evaluate の時間を返す */
async function loadBundle(file) {
  const t0 = performance.now()
  const mod = new vm.SourceTextModule(fs.readFileSync(path.join(root, file), 'utf8'), { identifier: file, context })
  await mod.link(() => { throw new Error(`${file} は import を持たないはず`) })
  await mod.evaluate()
  return { ns: mod.namespace, load: ms(t0) }
}

const timing = []

const helpers = new vm.SourceTextModule(HELPERS, { identifier: 'helpers.mjs', context })
await helpers.link(() => { throw new Error('helpers は import を持たないはず') })
await helpers.evaluate()
const H = helpers.namespace

// 1 つの束の試験が落ちても、残りの束は調べる（例外は行の 1 つに書く。束のソースを吐かない）
/** @param {string} name @param {() => Promise<void> | void} fn */
async function section(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(`${name} が例外で止まった`, false, String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300))
  }
}

await section('echarts', async () => {
  const b = await loadBundle('hooks/vendor/echarts.mjs')
  timing.push(`echarts 読み込み ${b.load}`)
  const t0 = performance.now()
  const svg = b.ns.renderSvg(H.barLineOption(), H.chartSize())
  timing.push(`echarts 棒と折れ線 1 回目 ${ms(t0)}`)
  check('echarts: 棒と折れ線の SVG は <svg で始まり </svg> で終わり 1月 を含む', typeof svg === 'string' && svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>') && svg.includes('1月'), `${svg.length} 字`)
  const pie = b.ns.renderSvg(H.pieOption(), H.chartSize())
  check('echarts: 円グラフの SVG が出る', pie.startsWith('<svg') && pie.trimEnd().endsWith('</svg>'), `${pie.length} 字`)
  const candle = b.ns.renderSvg(H.candleOption(), H.chartSize())
  check('echarts: ローソク足の SVG が出る', candle.startsWith('<svg') && candle.trimEnd().endsWith('</svg>'), `${candle.length} 字`)
})

await section('text', async () => {
  const b = await loadBundle('hooks/vendor/text.mjs')
  timing.push(`text 読み込み ${b.load}`)
  const t0 = performance.now()
  const tokens = b.ns.lex(H.markdownSource())
  timing.push(`text 字句解析 1 回目 ${ms(t0)}`)
  const types = tokens.map((t) => t.type)
  check('text: 見出し・段落・表が字句解析の結果に出る', types.includes('heading') && types.includes('paragraph') && types.includes('table'), types.join(','))
  const t1 = performance.now()
  const cut = b.ns.phraseBoundaries(H.sentence())
  timing.push(`text 文節 1 回目 ${ms(t1)}`)
  const len = [...H.sentence()].length
  check('text: 文節の切れ目は数の配列で、空でなく、0 より大きく字数より小さい', Array.isArray(cut) && cut.length > 0 && cut.every((n) => typeof n === 'number' && n > 0 && n < len), `字数 ${len}・切れ目 ${Array.from(cut).join(',')}`)
})

await section('pdf', async () => {
  const b = await loadBundle('hooks/vendor/pdf.mjs')
  timing.push(`pdf 読み込み ${b.load}`)
  const t0 = performance.now()
  const doc = await b.ns.PDFDocument.create()
  check('pdf: PDFDocument.create() で空の文書ができる', doc.getPageCount() === 0, `頁 ${doc.getPageCount()}`)
  doc.addPage(H.a4())
  const text = await b.ns.save7bit(doc)
  let seven = true
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) { seven = false; break }
  check('pdf: 頁を足して save7bit した答えは 7 ビットの字だけで %PDF で始まる', seven && text.startsWith('%PDF'), `${text.length} 字`)
  timing.push(`pdf 作成と保存 1 回目 ${ms(t0)}`)
})

console.log('--- 時間')
for (const line of timing) console.log(line)

const failed = results.filter((r) => !r.ok)
console.log(`--- ${results.length - failed.length} 通り・${failed.length} 落ち`)
if (failed.length) {
  console.log('落ちた試験: ' + failed.map((r) => r.name).join(' / '))
  process.exit(1)
}
