// @ts-check
// 見本（samples/<名前>.json。make の引数と同じ形）を組んで PDF にし、頁の絵にする。資料（kind: 'deck'）も文書も同じに扱う。
//   node scripts/deck-preview.mjs [名前 ...] [--dpi=80]
// 名前を省くと bizplan・deck・deck-wide・looks を組む。名前は samples/ の中の json の名前（拡張子なし）。.json で終わる名前は、その場所の json を読む（試しの入力用。絵の名前は拡張子を除いた名前）。
// 出力: out/deck/<名前>.pdf と、pdftoppm の out/deck/<名前>-<頁>.png（頁が 10 以上なら -01 のように 0 が付く）。
// 終了の符号: 警告があれば 1（見本の入力が直す所を持っている印）。検査の件数（重なり・外・切れ・空き）も警告に入る。
// ロゴは ~/.claude/mods-pdf-logos（無ければ描かず警告）、chart の example は assets/echarts から読む。
//
// 選ばなかった案
// - hooks/mods-pdf.mjs の make を通す案: 本体は $ の環境が要り、絵を見る台本には重い。見た目は compose → renderPdf で決まる（欄の寸法だけが違う）。
// - 画像を 1 枚にまとめる案（contact sheet）: 字の細部を見るための絵なので、1 頁 1 枚の PNG のまま。まとめて見たい時は pdftoppm の -r を下げる。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { normalize } from '../hooks/engine/schema.mjs'
import { loadChartAssets, chartAssetNeeds } from '../hooks/engine/chart.mjs'
import { collectLogoKeys, loadLogos, LOGOS_DIR_NAME } from '../hooks/lib/logos.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLES = path.join(ROOT, 'samples')
const OUT = path.join(ROOT, 'out', 'deck')
const DEFAULT_NAMES = ['bizplan', 'deck', 'deck-wide', 'looks']
/** 組版の「今」を固定する（日付の入る所が毎回同じになる）。ja-snapshot.mjs と同じ */
const NOW = Date.UTC(2026, 9, 9)

const args = process.argv.slice(2)
const dpiArg = args.find((a) => a.startsWith('--dpi='))
const dpi = dpiArg ? Math.min(300, Math.max(30, Number(dpiArg.slice(6)) || 80)) : 80
const names = args.filter((a) => !a.startsWith('--'))
if (!names.length) names.push(...DEFAULT_NAMES)

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
const readBase64 = async (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64')
const fontBytes = await loadFontBytes(/** @type {any} */ (FONT_IDS), manifest, readBase64)
const metrics = makeMetrics(fontBytes)

fs.mkdirSync(OUT, { recursive: true })
let anyWarning = false

for (const arg of names) {
  const given = arg.endsWith('.json')
  const file = given ? path.resolve(arg) : path.join(SAMPLES, `${arg}.json`)
  const name = given ? path.basename(arg, '.json') : arg
  if (!fs.existsSync(file)) {
    console.error(`${given ? arg : `samples/${arg}.json`} がありません`)
    process.exitCode = 2
    continue
  }
  const input = JSON.parse(fs.readFileSync(file, 'utf8'))
  const keys = collectLogoKeys(normalize(input).doc)
  const got = await loadLogos(keys, { read: async (p) => fs.readFileSync(p, 'utf8'), dir: path.join(os.homedir(), '.claude', LOGOS_DIR_NAME) })
  await loadChartAssets({ root: ROOT, read: async (p) => fs.readFileSync(p, 'utf8') }, chartAssetNeeds(input))
  const t0 = performance.now()
  const { layout, warnings: composeWarnings, checks } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW, logos: got.logos })
  const warnings = [...got.warnings, ...composeWarnings]
  const composed = performance.now() - t0
  const pdf = await renderPdf(layout, { fontBytes })
  const total = performance.now() - t0
  const pdfPath = path.join(OUT, `${name}.pdf`)
  fs.writeFileSync(pdfPath, Buffer.from(pdf.text, 'latin1'))

  // 「<名前>-<頁の数>.png」だけを自分の絵とみなす（deck と deck-wide が互いの絵を消さない）
  const ownPng = (/** @type {string} */ f) => f.startsWith(`${name}-`) && /^\d+\.png$/.test(f.slice(name.length + 1))
  for (const f of fs.readdirSync(OUT)) if (ownPng(f)) fs.rmSync(path.join(OUT, f))
  const ppm = spawnSync('pdftoppm', ['-r', String(dpi), '-png', pdfPath, path.join(OUT, name)], { encoding: 'utf8' })
  const all = [...warnings, ...pdf.warnings]
  if (ppm.error || ppm.status !== 0) all.push(`pdftoppm で絵にできなかった: ${ppm.error?.message ?? ppm.stderr}`)

  console.log(`\n${name}: ${pdf.pages} 頁・${layout.page.width}x${layout.page.height}pt・${pdf.bytes} バイト・組み ${composed.toFixed(0)} ms・合計 ${total.toFixed(0)} ms`)
  console.log(pdfPath)
  for (const f of fs.readdirSync(OUT).filter(ownPng).sort()) console.log(path.join(OUT, f))
  const c = checks.counts
  console.log(`検査: 重なり ${c.overlaps}・外 ${c.outside}・切れ ${c.truncated}・空き ${c.sparse}`)
  for (const w of all) console.log(`警告: ${w}`)
  if (all.length) anyWarning = true
}
if (anyWarning && !process.exitCode) process.exitCode = 1
