// @ts-check
// 日本語の見本の字の位置を記録し、後の変更で 1 字も動いていないことを確かめる。
//   node scripts/ja-snapshot.mjs --write [--only prose,ruby]   test/snapshots/ja-<見本>.json を書く
//   node scripts/ja-snapshot.mjs --check [--only prose,ruby]   今の組みを記録と比べる（違えば終了コード 1）
// 英語の直し（ハイフン・書体の字）が lang: 'ja' の文書の字の位置を動かしていないことを、これで確かめる。
//
// 選ばなかった案:
// - TextOp を組んだ順のまま記録する案: 書体・色・tag が変わると Op が割れる。割れ方が変わっただけで字の位置は同じ変更まで落ちるので、
//   (y・書体・大きさ) が同じ字を 1 本の行にまとめ、x の順に並べて記録する。
// - PDF を読み戻して比べる案（lib-pdftext）: TJ の調整を経由して x が丸められ、組版の変更とフォントの埋め込みの変更を見分けられない。
//   組版の出口（Layout）の座標をそのまま読む。
// - 許容誤差を付ける案: 目的は「1 字も動かさない」なので、0.001pt に丸めた値の完全一致だけを見る。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SAMPLES_DIR = path.join(ROOT, 'samples')
export const SNAPSHOT_DIR = path.join(ROOT, 'test/snapshots')

/** 記録する日本語の見本（samples/<名前>.json。lang が ja の物だけ。en は入れない）。一覧は決め打ちで、新しい見本は足して --write する */
export const JA_SAMPLES = ['prose', 'report', 'ruby', 'form', 'bench-30', 'bench-40', 'bench-53']

/** 組版の「今」は固定する（meta の created だけが変わる）。compare-typst.mjs と同じ */
const NOW = Date.UTC(2026, 9, 9)

/**
 * @typedef {{ y: number, font: string, size: number, text: string, x: number[] }} SnapLine
 * @typedef {{ sample: string, lang: string, page: [number, number], pages: SnapLine[][] }} Snapshot
 */

/** 0.001pt に丸める。-0 は 0 に @param {number} v */
export function round3(v) {
  const r = Math.round(v * 1000) / 1000
  return r === 0 ? 0 : r
}

/** @param {string} name */
export const snapshotPath = (name) => path.join(SNAPSHOT_DIR, `ja-${name}.json`)

/** @type {Promise<Record<string, any>> | null} */
let metricsPromise = null

/** 書体の寸法。読むのは 1 回だけ（compare-typst.mjs の buildMods と同じ読み方） */
export function loadMetrics() {
  metricsPromise ??= (async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
    const read = async (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64')
    const fontBytes = await loadFontBytes(/** @type {any[]} */ (FONT_IDS), manifest, read)
    return makeMetrics(fontBytes)
  })()
  return metricsPromise
}

/**
 * Layout の字を、(y・書体・大きさ) が同じもの 1 本の行にまとめる。行は上から下・左から右、行の中の字は x の順。
 * @param {any} layout
 * @returns {SnapLine[][]}
 */
export function linesOfLayout(layout) {
  /** @type {SnapLine[][]} */
  const out = []
  for (const page of layout.pages) {
    /** @type {Map<string, { y: number, font: string, size: number, glyphs: { c: string, x: number }[] }>} */
    const runs = new Map()
    for (const op of page.ops) {
      if (op.t !== 'text') continue
      const y = round3(op.y)
      const key = `${y}|${op.font}|${op.size}`
      let run = runs.get(key)
      if (!run) runs.set(key, (run = { y, font: op.font, size: op.size, glyphs: [] }))
      for (const g of op.glyphs) run.glyphs.push({ c: g.c, x: round3(g.x) })
    }
    const lines = [...runs.values()].map((r) => {
      // 同じ x の字（重なって描いた字）は並びを変えない（sort は安定）
      r.glyphs.sort((a, b) => a.x - b.x)
      return { y: r.y, font: r.font, size: r.size, text: r.glyphs.map((g) => g.c).join(''), x: r.glyphs.map((g) => g.x), first: r.glyphs[0]?.x ?? 0 }
    })
    lines.sort((a, b) => a.y - b.y || a.first - b.first || (a.font < b.font ? -1 : a.font > b.font ? 1 : a.size - b.size))
    out.push(lines.map(({ first, ...line }) => line))
  }
  return out
}

/** ルビの字の数（Layout.tags の役割が RT の字）。記録には入れず、書く時の表示だけに使う @param {any} layout */
function countRubyGlyphs(layout) {
  let n = 0
  for (const page of layout.pages) {
    for (const op of page.ops) if (op.t === 'text' && op.tag !== undefined && layout.tags[op.tag]?.role === 'RT') n += op.glyphs.length
  }
  return n
}

/**
 * 見本を今の組版で組んで、記録の形にする。
 * @param {string} name samples/<名前>.json
 * @returns {Promise<{ snapshot: Snapshot, ms: number, glyphs: number, ruby: number }>}
 */
export async function buildSnapshot(name) {
  const input = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, `${name}.json`), 'utf8'))
  if (input.lang !== 'ja') throw new Error(`${name}: lang が ja ではない（${input.lang}）。日本語の見本だけを記録する`)
  const metrics = await loadMetrics()
  const t0 = performance.now()
  const { layout } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
  const ms = performance.now() - t0
  const pages = linesOfLayout(layout)
  return {
    snapshot: { sample: name, lang: layout.meta.lang, page: [round3(layout.page.width), round3(layout.page.height)], pages },
    ms,
    glyphs: pages.reduce((s, p) => s + p.reduce((t, l) => t + l.x.length, 0), 0),
    ruby: countRubyGlyphs(layout),
  }
}

/**
 * 記録の JSON。行ごとに 1 行にして、git の差分で行の違いが見えるようにする。
 * @param {Snapshot} s
 */
export function serialize(s) {
  const lines = s.pages.map((p) => `    [\n${p.map((l) => `      ${JSON.stringify(l)}`).join(',\n')}\n    ]`)
  return `{\n  "sample": ${JSON.stringify(s.sample)},\n  "lang": ${JSON.stringify(s.lang)},\n  "page": ${JSON.stringify(s.page)},\n  "pages": [\n${lines.join(',\n')}\n  ]\n}\n`
}

/** @param {string} name @returns {Snapshot | null} */
export function readSnapshot(name) {
  const p = snapshotPath(name)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}

/** @param {string} s */
const clip = (s, max = 48) => {
  const a = Array.from(s)
  return a.length <= max ? s : `${a.slice(0, max).join('')}…`
}

/**
 * 記録と今の組みを比べ、最初に違う所を言葉にする。同じなら null。
 * @param {Snapshot} expected 記録
 * @param {Snapshot} actual 今
 * @returns {string | null}
 */
export function firstDifference(expected, actual) {
  const name = expected.sample
  if (expected.page[0] !== actual.page[0] || expected.page[1] !== actual.page[1]) {
    return `${name}: 紙の大きさが違う（記録 ${expected.page.join('×')}pt・今 ${actual.page.join('×')}pt）`
  }
  const total = Math.max(expected.pages.length, actual.pages.length)
  /** @type {number[]} */
  const bad = []
  for (let p = 0; p < total; p++) {
    if (JSON.stringify(expected.pages[p] ?? null) !== JSON.stringify(actual.pages[p] ?? null)) bad.push(p + 1)
  }
  if (bad.length === 0) return null
  const p = bad[0] - 1
  const head = `${name}: 字の位置が記録と違う（違う頁 ${bad.length}/${total}: ${bad.slice(0, 8).join('・')}${bad.length > 8 ? '…' : ''}）`
  const ex = expected.pages[p]
  const ac = actual.pages[p]
  if (!ex || !ac) return `${head}\n  頁数が違う（記録 ${expected.pages.length} 頁・今 ${actual.pages.length} 頁）`
  const n = Math.max(ex.length, ac.length)
  for (let i = 0; i < n; i++) {
    const a = ex[i]
    const b = ac[i]
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue
    const where = `  頁 ${p + 1} の ${i + 1} 行目`
    if (!a || !b) {
      return `${head}\n${where}: 行の数が違う（記録 ${ex.length} 行・今 ${ac.length} 行）。${a ? '記録にだけある' : '今だけにある'}行: y=${(a ?? b).y} 「${clip((a ?? b).text)}」`
    }
    if (a.y !== b.y || a.font !== b.font || a.size !== b.size) {
      return `${head}\n${where}: 行の位置か書体が違う\n    記録: y=${a.y} ${a.font} ${a.size}pt 「${clip(a.text)}」\n    今:   y=${b.y} ${b.font} ${b.size}pt 「${clip(b.text)}」`
    }
    // 字はコードポイント単位（x の配列と添字がそろう）
    const ca = Array.from(a.text)
    const cb = Array.from(b.text)
    const m = Math.max(ca.length, cb.length)
    for (let k = 0; k < m; k++) {
      if (ca[k] === cb[k] && a.x[k] === b.x[k]) continue
      const at = (/** @type {string[]} */ cs, /** @type {number[]} */ xs, /** @type {number} */ j) => (j < 0 || j >= xs.length ? '(なし)' : `「${cs[j]}」x=${xs[j]}`)
      return [
        head,
        `${where}（y=${a.y} ${a.font} ${a.size}pt）の ${k + 1} 字目が違う`,
        `    行の字: 「${clip(a.text, 60)}」`,
        `    記録: 前 ${at(ca, a.x, k - 1)} / ${at(ca, a.x, k)} / 後 ${at(ca, a.x, k + 1)}`,
        `    今:   前 ${at(cb, b.x, k - 1)} / ${at(cb, b.x, k)} / 後 ${at(cb, b.x, k + 1)}`,
        ca[k] === cb[k] && Number.isFinite(a.x[k]) && Number.isFinite(b.x[k]) ? `    ずれ: ${round3(b.x[k] - a.x[k])}pt` : '    字そのものが違う',
      ].join('\n')
    }
  }
  return head
}

/**
 * 1 つの見本を今の組みと記録で比べる。記録が無ければそう言う。
 * @param {string} name
 * @returns {Promise<{ ok: boolean, message: string, ms: number }>}
 */
export async function checkSample(name) {
  const { snapshot, ms } = await buildSnapshot(name)
  const expected = readSnapshot(name)
  if (!expected) return { ok: false, ms, message: `${name}: 記録が無い（${path.relative(ROOT, snapshotPath(name))}）。node scripts/ja-snapshot.mjs --write --only ${name} で作る` }
  const diff = firstDifference(expected, snapshot)
  return diff ? { ok: false, ms, message: diff } : { ok: true, ms, message: `${name}: 同じ` }
}

/** @param {string[]} argv */
function pickNames(argv) {
  const i = argv.indexOf('--only')
  if (i < 0) return JA_SAMPLES
  const names = (argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = names.filter((n) => !JA_SAMPLES.includes(n))
  if (names.length === 0 || unknown.length) {
    console.error(`--only に渡せる見本: ${JA_SAMPLES.join('・')}${unknown.length ? `（知らない名前: ${unknown.join('・')}）` : ''}`)
    process.exit(2)
  }
  return names
}

async function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const check = argv.includes('--check')
  if (write === check) {
    console.error('使い方: node scripts/ja-snapshot.mjs --write|--check [--only 見本,見本]')
    process.exit(2)
  }
  const names = pickNames(argv)
  const t0 = performance.now()
  await loadMetrics()
  console.log(`書体を読んだ: ${Math.round(performance.now() - t0)} ms`)
  let failed = 0
  if (write) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  for (const name of names) {
    if (write) {
      const { snapshot, ms, glyphs, ruby } = await buildSnapshot(name)
      const text = serialize(snapshot)
      fs.writeFileSync(snapshotPath(name), text)
      console.log(`書いた ${name}: ${snapshot.pages.length} 頁・${glyphs} 字（うちルビ ${ruby}）・${(Buffer.byteLength(text) / 1024).toFixed(0)} KiB・組み ${Math.round(ms)} ms`)
    } else {
      const r = await checkSample(name)
      if (r.ok) console.log(`OK ${r.message}（組み ${Math.round(r.ms)} ms）`)
      else {
        failed++
        console.log(`NG ${r.message}`)
      }
    }
  }
  console.log(`${write ? '書き終わり' : failed ? `違う見本 ${failed}/${names.length}` : `全部同じ ${names.length}/${names.length}`}（全体 ${Math.round(performance.now() - t0)} ms）`)
  if (failed) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
