// @ts-check
// 図の形（looks）の見本の頁を作る。選んだ形（無ければ全部）を、A4 の頁に 2 つずつ・版面の幅いっぱいに並べた PDF にして、頁の絵にする。
//   node scripts/looks-preview.mjs [種類か id ...] [--theme=mono|koma|mergeble] [--lang=ja|en]
//   node --experimental-vm-modules scripts/looks-preview.mjs --env     （フックと同じ環境で全部の形を描けるか。見本と、上限を超えた data の時間も測る）
// 出力: out/looks/looks-<名前>.pdf と、pdftoppm -r 80 -png の out/looks/<名前>-<頁>.png（頁が 10 以上なら -01 のように 0 が付く）。
// <名前> は引数をつないだ物（無ければ all）に、mono 以外の theme と en の時はその名前を足した物（mono と koma の絵が上書きし合わない）。
// 種類は time・usage・compare・spread・parts・flow・work。細い線や小さな字を見る時は、PDF を pdftoppm -r 150 で描き直す。
//
// 選ばなかった案
// - 図の高さを頁に合わせて縮める案: 縮めると字の大きさが変わる。幅は版面そのまま（図の 1pt = 紙の 1pt）にして、頁の半分に入らない高さの形だけ、形の draw に高さを渡して低くする。
// - 題を見出しにする案: 見出しは 2 行取りで、2 つ並べると頁に入らない。「id・題」は図の下のキャプションにする。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { drawLook, LOOK_LIST, CATEGORIES } from '../hooks/engine/looks/index.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'out', 'looks')
/** 図の下のキャプション 1 行（3 + 行の高さ 11.5）と図の上下の余白 4 + 4（lay-blocks.mjs の figureItem） */
const FIGURE_EXTRA = 23
/** 上限を超えた data を描く時間の上限（ms）。test/looks-kit.mjs の INFLATED_MS と同じ */
const BIG_MS = 1000

const args = process.argv.slice(2)
const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const names = args.filter((a) => !a.startsWith('--'))

// ---------------------------------------------------------------- フックと同じ環境の確かめ

/** hook-env-check.mjs と同じ vm の作り方（Node の物が無い・文字列からのコード生成は禁止）で looks を読み、全部の形の見本を描く */
async function envCheck() {
  if (typeof vm.SourceTextModule !== 'function') {
    console.error('node --experimental-vm-modules scripts/looks-preview.mjs --env で動かしてください')
    process.exitCode = 2
    return
  }
  const fails = []
  const check = (/** @type {string} */ name, /** @type {boolean} */ ok, /** @type {string} */ extra = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`)
    if (!ok) fails.push(name)
  }
  const dollar = /\$\./
  const nodeWords = /node:|(?<![\w/'"-])process\s*[.[]|typeof\s+process\b|\bBuffer\b|setTimeout|setInterval|setImmediate|require\(|\beval\(|new Function|\bimport\s*\(|Math\.random|Date\.now|new Date\(\s*\)/
  const lookFiles = fs.readdirSync(path.join(ROOT, 'hooks/engine/looks')).filter((n) => n.endsWith('.mjs'))
  const d3 = fs.readFileSync(path.join(ROOT, 'hooks/vendor/d3.mjs'), 'utf8')
  check('d3.mjs に「ドル記号の直後の点」が無い', !dollar.test(d3))
  check('looks/*.mjs に「ドル記号の直後の点」と Node の語・Math.random・Date.now が無い', lookFiles.every((n) => {
    const t = fs.readFileSync(path.join(ROOT, 'hooks/engine/looks', n), 'utf8')
    return !dollar.test(t) && !t.split('\n').some((l) => nodeWords.test(l))
  }))

  const globals = Object.create(null)
  Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance })
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })
  const cache = new Map()
  const load = (/** @type {string} */ file) => {
    if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }))
    return cache.get(file)
  }
  const entry = load(path.join(ROOT, 'hooks/engine/looks/index.mjs'))
  const t0 = performance.now()
  await entry.link(async (/** @type {string} */ specifier, /** @type {any} */ referencing) => {
    if (!specifier.startsWith('.')) throw new Error(`plugin の外からの import は使えない: ${specifier}`)
    return load(path.resolve(path.dirname(referencing.identifier), specifier))
  })
  await entry.evaluate()
  const loadMs = Math.round(performance.now() - t0)
  const { drawLook: inVm } = entry.namespace
  check('フックの環境で looks と d3 を読み込める', typeof inVm === 'function', `${loadMs} ms・d3 ${Math.round(d3.length / 1024)} KB`)
  /** @type {{ id: string, sample: number, big: number }[]} */
  const times = []
  for (const look of LOOK_LIST) {
    const id = look.id
    const t1 = performance.now()
    const a = inVm(id, look.sample(), { width: 503.5 })
    const ms = performance.now() - t1
    const b = drawLook(id, look.sample(), { width: 503.5 })
    // 上限を超えた data（点 6,000・木の葉 3,000 …）。index.mjs の上限で切られ、warnings が付く
    const t2 = performance.now()
    const c = inVm(id, inflate(look.sample()), { width: 503.5 })
    const big = performance.now() - t2
    times.push({ id, sample: ms, big })
    check(`フックの環境で ${id} を描け、Node で描いた物と同じ svg になる`, a.svg.startsWith('<svg') && a.svg.length > 1000 && a.svg === b.svg && a.warnings.length === 0, `${a.svg.length} 字・見本 ${ms.toFixed(1)} ms`)
    check(`フックの環境で ${id} の上限を超えた data を ${BIG_MS} ms 以内に描ける`, c.svg.startsWith('<svg') && c.warnings.length > 0 && big < BIG_MS, `${big.toFixed(1)} ms`)
  }
  const sum = (/** @type {number[]} */ v) => v.reduce((s, x) => s + x, 0)
  const worst = (/** @type {'sample'|'big'} */ k) => times.reduce((m, t) => (t[k] > m[k] ? t : m), times[0])
  const ws = worst('sample')
  const wb = worst('big')
  console.log(`\n${times.length} 形・見本の合計 ${sum(times.map((t) => t.sample)).toFixed(0)} ms（最大 ${ws.id} ${ws.sample.toFixed(1)} ms）・上限を超えた data の合計 ${sum(times.map((t) => t.big)).toFixed(0)} ms（最大 ${wb.id} ${wb.big.toFixed(1)} ms）`)
  console.log(`フックの 10 秒には、上限を超えた data の図でも ${Math.floor(10000 / Math.max(1, wb.big))} 枚（いちばん遅い形だけを並べた時）`)
  console.log(fails.length ? `\n${fails.length} 件失敗` : '\nすべて通った')
  if (fails.length) process.exitCode = 1
}

/**
 * test/looks-kit.mjs の inflate の写し: 一番上の配列を 6,000 個に伸ばし、系列・群の中の 1 つ目の配列も 6,000 に伸ばし、木は 3,000 個の葉を足す。
 * 選ばなかった案: looks-kit.mjs から読む案。looks-kit は読んだ時に node:test の試験を登録する作りで、書体も読み込む（この台本は試験を走らせない）
 * @param {any} sample
 */
function inflate(sample) {
  const grow = (/** @type {any[]} */ a) => Array.from({ length: 6000 }, (_, i) => a[i % a.length])
  /** @type {Record<string, any>} */
  const out = { ...sample }
  for (const [k, v] of Object.entries(sample)) {
    if (Array.isArray(v) && v.length) {
      out[k] = grow(v)
      const first = v[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const wide = { ...first }
        for (const [k2, v2] of Object.entries(first)) if (Array.isArray(v2) && v2.length) wide[k2] = grow(v2)
        out[k][0] = wide
      }
    }
  }
  if (sample.root) out.root = { ...sample.root, children: Array.from({ length: 3000 }, (_, i) => ({ name: `葉${i}`, value: 1 })) }
  return out
}

if (args.includes('--env')) {
  await envCheck()
  process.exit(process.exitCode ?? 0)
}

// ---------------------------------------------------------------- 見本の頁

/** 引数（種類か id）から形を選ぶ。無ければ全部 */
function pick() {
  if (!names.length) return LOOK_LIST
  /** @type {typeof LOOK_LIST} */
  const out = []
  for (const n of names) {
    const hit = LOOK_LIST.filter((l) => l.id === n || l.category === n)
    if (!hit.length) {
      console.error(`知らない種類か id です: ${n}\n種類: ${CATEGORIES.join('・')}\nid: ${LOOK_LIST.map((l) => l.id).join('・') || '（まだありません）'}`)
      process.exit(1)
    }
    for (const l of hit) if (!out.includes(l)) out.push(l)
  }
  return out
}

const looks = pick()
if (!looks.length) {
  console.error('描ける形がまだありません')
  process.exit(1)
}
const themeName = flag('theme', 'mono')
const lang = flag('lang', 'ja') === 'en' ? 'en' : 'ja'
const label = [names.length ? names.join('-') : 'all', themeName === 'mono' ? '' : themeName, lang === 'en' ? 'en' : ''].filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]/g, '-')

const theme = makeTheme({ theme: themeName })
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
const readBase64 = async (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64')
const fontBytes = await loadFontBytes(/** @type {any} */ (FONT_IDS), manifest, readBase64)
const metrics = makeMetrics(fontBytes)
const NOW = Date.UTC(2026, 9, 9)
// 1 頁目は題名の塊（layout が必ず置く）が行を取る。2 つ並べる高さは、それを引いた行数の半分で決め、全頁で同じにする
const titleRows = Math.round(compose({ title: 'x', theme: themeName }, { metrics, images: {}, phrase: phraseBoundaries, now: NOW }).layout.stats.lastPageFill * theme.lines)
const maxFig = Math.floor((theme.lines - titleRows) / 2) * theme.lineGap - FIGURE_EXTRA
/** @type {any[]} */
const blocks = []
/** @type {string[]} */
const warnings = []
looks.forEach((look, i) => {
  const opts = { width: theme.measure, pal: theme.colors, lang }
  let r = drawLook(look.id, look.sample(), opts)
  if (r.height > maxFig) r = drawLook(look.id, look.sample(), { ...opts, height: Math.floor(maxFig) })
  for (const w of r.warnings) warnings.push(`${look.id}: ${w}`)
  const title = `${look.id}・${look.title}`
  blocks.push({ type: 'svg', source: r.svg, alt: title, caption: title })
  if (i % 2 === 1 && i < looks.length - 1) blocks.push({ type: 'pagebreak' })
  console.log(`${look.id.padEnd(16)} ${r.width} x ${r.height} pt・svg ${r.svg.length} 字`)
})

// 題は「・」でつなぐ（ファイル名の label は「-」でつながった 1 語になり、id を多く並べると行の終わりで割れずに禁則の警告になった）
const shown = [names.length ? names.join('・') : 'すべて', themeName === 'mono' ? '' : themeName, lang === 'en' ? 'en' : ''].filter(Boolean).join('・')
const { layout, warnings: composeWarnings } = compose({ title: `図の形の見本（${shown}）`, theme: themeName, blocks }, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
for (const w of composeWarnings) warnings.push(`組版: ${w}`)
const want = Math.ceil(looks.length / 2)
if (layout.pages.length !== want) warnings.push(`頁が ${layout.pages.length} 枚になった（2 つずつなら ${want} 枚）`)
const pdf = await renderPdf(layout, { fontBytes })

fs.mkdirSync(OUT, { recursive: true })
const pdfPath = path.join(OUT, `looks-${label}.pdf`)
fs.writeFileSync(pdfPath, Buffer.from(pdf.text, 'latin1'))
// 「<名前>-<頁の数>.png」だけを自分の絵とみなす（startsWith だと candle-sankey が candle-sankey-koma の絵まで消す）
const ownPng = (/** @type {string} */ f) => f.startsWith(`${label}-`) && /^\d+\.png$/.test(f.slice(label.length + 1))
for (const f of fs.readdirSync(OUT)) if (ownPng(f)) fs.rmSync(path.join(OUT, f))
const ppm = spawnSync('pdftoppm', ['-r', '80', '-png', pdfPath, path.join(OUT, label)], { encoding: 'utf8' })
if (ppm.error || ppm.status !== 0) warnings.push(`pdftoppm で絵にできなかった: ${ppm.error?.message ?? ppm.stderr}`)
const pngs = fs.readdirSync(OUT).filter(ownPng).sort()

console.log(`\n${pathToFileURL(pdfPath).pathname.replace(/^\//, '')}  ${pdf.pages} 頁・${pdf.bytes} バイト`)
for (const p of pngs) console.log(path.join(OUT, p))
for (const w of warnings) console.log(`警告: ${w}`)
if (warnings.length) process.exitCode = 1
