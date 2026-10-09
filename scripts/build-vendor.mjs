// src/*-entry.mjs から hooks/vendor/ の束を作る（Mod は npm の物を import できないので写して持つ）。
// 実行: npm install && node scripts/build-vendor.mjs [pdf|echarts|text|d3 …] [--check]
// --check は束を作って今の hooks/vendor/ の物とバイト単位で比べるだけ（何も書かない）。違えば終了の符号 1。
// フックの環境には process もタイマーも無い。束の中だけで効く代わりを頭に置く（大域は書き換えない）
import { build } from 'esbuild'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = (n) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version
/** 改行（0x0A）は上の置き換えで済ませる。タブは \t、ほかの制御の字は \xHH に直す */
const escapeControls = (s) => s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).replace(/\t/g, '\\t')
const shim = "const process = { env: { NODE_ENV: 'production' }, nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) }, setTimeout = (f) => { Promise.resolve().then(f); return 0 }, clearTimeout = () => {}, setImmediate = (f) => Promise.resolve().then(f);"
// fontkit は utf-16 などの TextDecoder を作るが、フックの環境の TextDecoder は utf-8 だけなので補う
const decoder = "const TextDecoder = (() => { const U = globalThis.TextDecoder; return class { constructor(enc = 'utf-8') { this.e = String(enc).toLowerCase().replace(/_/g, '-'); this.u = /^(utf-?8|unicode-1-1-utf-8)$/.test(this.e) ? new U('utf-8') : null } decode(b) { if (b === undefined) return ''; const a = b instanceof Uint8Array ? b : new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength ?? b.length); if (this.u) return this.u.decode(a); let s = ''; if (/^utf-?16/.test(this.e)) { const be = /be$/.test(this.e); for (let i = 0; i + 1 < a.length; i += 2) s += String.fromCharCode(be ? (a[i] << 8) | a[i + 1] : a[i] | (a[i + 1] << 8)); return s } for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return s } get encoding() { return this.e } } })();"

const argv = process.argv.slice(2)
const check = argv.includes('--check')
const only = argv.filter((a) => !a.startsWith('--'))
const wanted = (name) => only.length === 0 || only.includes(name)
let drifted = 0
// --check の一時の置き場は実行ごとに作る。同じ名前の置き場を並行の実行（試験・別の担当）が使うと、書きかけの束と比べて DIFF と出ることがあった
const checkDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'mods-pdf-vendor-check-')) : ''

const bundles = [
  {
    name: 'pdf', entry: 'src/pdf-entry.mjs', out: 'hooks/vendor/pdf.mjs',
    banner: [`// 出典: pdf-lib ${pkg('pdf-lib')}（https://github.com/Hopding/pdf-lib・MIT）・fontkit ${pkg('fontkit')}（https://github.com/foliojs/fontkit・MIT）と、その依存`, shim, decoder],
  },
  // keepIdentifiers: 識別子を縮めない。縮めると ECharts の tokens が `$` になり、`$` の直後に点が来る字の並び（フックの検査が探す）が束に出る。
  // esbuild は minify: true に識別子の縮めを含むので、縮めない時は minifyWhitespace と minifySyntax だけを立てる（1.1 MB 程度）
  {
    name: 'echarts', entry: 'src/echarts-entry.mjs', out: 'hooks/vendor/echarts.mjs', keepIdentifiers: true,
    banner: [`// 出典: Apache ECharts ${pkg('echarts')}（https://echarts.apache.org・Apache-2.0）・zrender（BSD-3-Clause）`, shim],
  },
  {
    name: 'text', entry: 'src/text-entry.mjs', out: 'hooks/vendor/text.mjs', keepIdentifiers: true,
    banner: [`// 出典: BudouX ${pkg('budoux')}（https://github.com/google/budoux・Apache-2.0）・marked ${pkg('marked')}（https://github.com/markedjs/marked・MIT）・Hypher ${pkg('hypher')}（https://github.com/bramstein/Hypher・BSD-3-Clause）と hyph-en-us のパターン（hyphenation.en-us ${pkg('hyphenation.en-us')}）`, shim],
  },
]
for (const b of bundles) {
  if (!wanted(b.name)) continue
  if (!fs.existsSync(path.join(root, b.entry))) { console.log(`skip ${b.out}（${b.entry} が無い）`); continue }
  await build({
    entryPoints: [path.join(root, b.entry)],
    outfile: check ? path.join(checkDir, `${b.name}.mjs`) : path.join(root, b.out),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
    ...(b.keepIdentifiers ? { minifyWhitespace: true, minifySyntax: true } : { minify: true }),
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    banner: { js: [...b.banner, `// 元は ${b.entry}。scripts/build-vendor.mjs で作る。手で直さない。LICENSE は ../../LICENSES/`].join('\n') },
    logLevel: 'warning',
  })
  // 縮めた束は改行だけのテンプレートリテラル（`<改行>`）を残す。走査が「制御文字の字」と見るので "\n" に直す（mods-trade 0.9.23 の学び）
  // 生の制御の字（タブ・0x01 など）も同じ理由で字のエスケープにする。字の値は変わらない（文字列・テンプレート・正規表現の中だけに出る）
  const f = check ? path.join(checkDir, `${b.name}.mjs`) : path.join(root, b.out)
  const out = escapeControls(fs.readFileSync(f, 'utf8').split('`\n`').join('"\\n"'))
  // 縮めた名前が `$` になると、静的な検査が `$.` を mods の呼び出しと読んで落とす。今きれいなのは名前の割り当ての偶然なので、作るたびに確かめる
  if (/\$\./.test(out)) throw new Error(`${b.out}: 「$.」が出た（keepIdentifiers を付けるか entry を直す）`)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(out)) throw new Error(`${b.out}: 生の制御の字が残った`)
  if (check) {
    const target = path.join(root, b.out)
    const same = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === out
    if (!same) drifted++
    console.log(`${same ? 'same' : 'DIFF'} ${b.out}`)
    if (!same && fs.existsSync(target)) {
      // どこから違うかを出す（束が実行ごとに揺れるのか、本当に古いのかを見分ける）
      const old = fs.readFileSync(target, 'utf8')
      let i = 0
      while (i < out.length && i < old.length && out[i] === old[i]) i++
      console.log(`  最初の違い: ${i} 字目（今の束 ${old.length} 字・作った束 ${out.length} 字）
  今の束:   ${JSON.stringify(old.slice(Math.max(0, i - 30), i + 60))}
  作った束: ${JSON.stringify(out.slice(Math.max(0, i - 30), i + 60))}`)
    }
    fs.rmSync(f, { force: true })
    continue
  }
  fs.writeFileSync(f, out)
  console.log(b.out, fs.statSync(f).size)
}

// d3（図の形 looks が使う）。d3 の部品は package.json に無いので、置き場を探す: 環境変数 D3_MODULES → この repo の node_modules → 隣の modscode の node_modules。
// 選ばなかった案: npm の d3 をここで足す案。package.json はこの回の持ち主の外だった。足すなら版を固定する:
//   d3-array 3.2.4・d3-chord 3.0.1・d3-color 3.1.0・d3-contour 4.0.2・d3-delaunay 6.0.4・d3-force 3.0.0・d3-format 3.1.0・d3-hexbin 0.2.2
//   d3-hierarchy 3.1.2・d3-interpolate 3.0.1・d3-path 3.1.0・d3-polygon 3.0.1・d3-quadtree 3.0.1・d3-random 3.0.1・d3-sankey 0.12.3・d3-scale 4.0.2・d3-shape 3.2.0
if (wanted('d3')) {
  const places = [process.env.D3_MODULES, path.join(root, 'node_modules'), path.join(root, '..', 'modscode', 'node_modules')].filter(Boolean)
  const d3Root = places.find((d) => fs.existsSync(path.join(d, 'd3-array', 'package.json')))
  if (!d3Root) console.log('skip hooks/vendor/d3.mjs（d3-array が見つからない。D3_MODULES か node_modules に d3 の部品を置く）')
  else await buildD3(d3Root)
}
if (checkDir) fs.rmSync(checkDir, { recursive: true, force: true })
if (check && drifted) { console.log(`${drifted} 本が今の束と違う`); process.exit(1) }

async function buildD3(d3Root) {
  const mod = (n) => path.join(d3Root, n)
  const entry = 'src/d3-entry.mjs'
  // フックの環境にタイマーは無い。d3-force（d3-timer）が作る時に呼ぶので、束の中だけで効く代わりを置く
  const timers = 'const setTimeout = () => 0, clearTimeout = () => {}, setInterval = () => 0, clearInterval = () => {};'
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'],
    // 識別子は縮めない（縮めた名前が `$` になると hook-env-check の「$ の直後の点」の検査が落ちる）
    minifyWhitespace: true, minifySyntax: true, legalComments: 'none', write: false, metafile: true,
    // d3-sankey は d3-array 1〜2 と d3-shape 1 を指す。v3 が同じ呼び出しに答える（look の束と同じ）
    alias: { 'd3-array': mod('d3-array'), 'd3-shape': mod('d3-shape'), 'd3-path': mod('d3-path') },
    nodePaths: [d3Root], logLevel: 'warning',
  })
  const used = new Set()
  for (const input of Object.keys(result.metafile.inputs)) {
    const m = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)
    if (m) used.add(m[m.length - 1].replace(/^node_modules\//, '').replace(/\/$/, ''))
  }
  const entryText = fs.readFileSync(path.join(root, entry), 'utf8')
  const packages = [...used].sort().map((name) => {
    const pj = JSON.parse(fs.readFileSync(path.join(mod(name), 'package.json'), 'utf8'))
    const licFile = fs.readdirSync(mod(name)).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    if (!licFile) throw new Error(`${name} に LICENSE が無い`)
    const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url
    const url = (pj.homepage || repo || '').replace(/^git\+/, '').replace(/\.git$/, '')
    if (!check) {
      const dir = path.join(root, 'LICENSES', 'npm', name)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(path.join(mod(name), licFile), path.join(dir, licFile))
    }
    const exports = [...entryText.matchAll(/export \{([^}]*)\} from '([^']+)'/g)]
      .filter((m) => m[2] === name).flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean))
    return { name, version: pj.version, spdx: pj.license, url, license: `LICENSES/npm/${name}/${licFile}`, exports }
  })
  const wrap = (str, width) => {
    const lines = ['']
    for (const word of str.split(' ')) {
      if ((lines[lines.length - 1] + ' ' + word).trim().length > width) lines.push(word)
      else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + word).trim()
    }
    return lines
  }
  const credit = packages.map((p) => `${p.name} ${p.version} (${p.spdx})`).join(', ')
  const banner = [
    '// 出典: d3 の各部品（Mike Bostock ほか）。C:/dev/modscode の scripts/build-vendor.mjs（look の hooks/vendor/d3.mjs と同じ入口 vendor-src/d3-entry.mjs）から、識別子を縮めずに作り直した物。手で直さない。',
    '// 縮めると名前が一字の記号になり、hook-env-check の検査（その記号の直後の点）が落ちるため。ライセンスは ../../LICENSES/npm/<パッケージ名>/ の原本。',
    '// 各部品は自分のライセンス（ISC・BSD-3-Clause・Unlicense）。ModsPDF のライセンスの外:',
    ...wrap(credit, 100).map((l) => `// ${l}`),
    timers,
  ].join('\n')
  const code = escapeControls(`${banner}\n${result.outputFiles[0].text}`.split('`\n`').join('"\\n"'))
  if (/\$\./.test(code)) throw new Error('hooks/vendor/d3.mjs: 「$.」が出た')
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(code)) throw new Error('hooks/vendor/d3.mjs: 生の制御の字が残った')
  const f = path.join(root, 'hooks/vendor/d3.mjs')
  if (check) {
    const same = fs.existsSync(f) && fs.readFileSync(f, 'utf8') === code
    if (!same) drifted++
    console.log(`${same ? 'same' : 'DIFF'} hooks/vendor/d3.mjs（${d3Root}）`)
    return
  }
  fs.writeFileSync(f, code)
  const manifest = {
    built: new Date().toISOString().slice(0, 10),
    note: 'look の hooks/vendor/manifest.json の d3 の束（同じ入口・同じ版）を、識別子を縮めずに作り直した物。esbuild の minifyWhitespace と minifySyntax だけ。',
    bundles: [{ file: 'hooks/vendor/d3.mjs', bytes: Buffer.byteLength(code), sha256: crypto.createHash('sha256').update(code).digest('hex'), packages }],
  }
  fs.writeFileSync(path.join(root, 'hooks/vendor/d3.manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
  console.log('hooks/vendor/d3.mjs', code.length, packages.length, 'packages')
}
