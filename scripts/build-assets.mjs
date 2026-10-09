// 素材（ECharts の束・テーマ・見本・目録）を 1 本の手順で作り直す。何度流しても同じ物ができる（chunk の名前は内容の hash）。
// 実行: node scripts/build-assets.mjs [--out <dir>] [--only echarts,themes,examples] [--no-verify]
//   --out    出す root（hooks/vendor/ と assets/ をその下に作る）。既定は repo の root
//   --only   一部だけ作る（コンマ区切り）。既定は全部。examples は scripts/assets/examples.mjs があれば呼び、無ければ飛ばす
//   --no-verify  最後の自動点検（読めるか・描けるか）を飛ばす
// ロゴは別のリポ mods-pdf-logos の `node build.mjs`（docs/assets.md）。
//
// 選ばなかった案
// - npm の script ごとに分ける案: 束・テーマ・見本は ECharts の版に一緒に追従する。1 本にして、版を上げた時に全部が揃うようにする。
// - 点検を別の npm script にする案: 作りっぱなしで 1 MiB を超えたり読めない束が出るのを防ぐため、作った直後に必ず通す。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
/** node_modules/echarts がある所まで上へたどる（out/assets-stage/scripts/ からでも scripts/ からでも同じ root に着く） */
function findRoot(from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'echarts', 'package.json'))) return dir
    if (path.dirname(dir) === dir) throw new Error(`node_modules/echarts が見つからない（${from} から上）。npm install を先に`)
  }
}
const root = findRoot(here)
const DEFAULT_OUT = '.'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
if (flag('-h') || flag('--help')) {
  console.log('node scripts/build-assets.mjs [--out <dir>] [--only echarts,themes,examples] [--no-verify]')
  process.exit(0)
}
const out = path.resolve(value('--out') ?? path.join(root, DEFAULT_OUT))
const STEPS = ['echarts', 'themes', 'examples']
const only = value('--only') ? value('--only').split(',').map((s) => s.trim()).filter(Boolean) : STEPS
for (const s of only) if (!STEPS.includes(s)) throw new Error(`--only に知らない名前: ${s}（${STEPS.join(',')}）`)

console.log(`root ${root}\nout  ${out}\nsteps ${only.join(',')}`)
const t0 = performance.now()
const done = []
const step = async (name, fn) => {
  const t = performance.now()
  const r = await fn()
  const ms = Math.round(performance.now() - t)
  done.push(name)
  console.log(`-- ${name} ${ms} ms`)
  return r
}

if (only.includes('echarts')) {
  const { buildEcharts } = await import(pathToFileURL(path.join(here, 'assets', 'echarts.mjs')).href)
  await step('echarts', () => buildEcharts({ out, root }))
}
if (only.includes('themes')) {
  const { buildThemes } = await import(pathToFileURL(path.join(here, 'assets', 'themes.mjs')).href)
  await step('themes', () => buildThemes({ out, root }))
}
if (only.includes('examples')) {
  const file = path.join(here, 'assets', 'examples.mjs')
  if (!fs.existsSync(file)) console.log('-- examples 飛ばす（scripts/assets/examples.mjs が無い）')
  else {
    const { buildExamples } = await import(pathToFileURL(file).href)
    await step('examples', () => buildExamples({ out, root }))
  }
}

// 自動点検: 読めるか・描けるか・1 MiB 未満か（--experimental-vm-modules が要るので子の node で）
if (!flag('--no-verify') && (done.includes('echarts') || done.includes('themes')) && fs.existsSync(path.join(out, 'hooks', 'vendor', 'echarts.mjs'))) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(here, 'assets', 'verify-echarts.mjs'), out], { stdio: 'inherit' })
  if (r.status !== 0) { console.error('自動点検に失敗した'); process.exit(r.status ?? 1) }
}
console.log(`\n完了 ${Math.round(performance.now() - t0)} ms`)
