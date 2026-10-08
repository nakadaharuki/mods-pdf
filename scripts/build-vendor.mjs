// src/*-entry.mjs から hooks/vendor/ の束を作る（Mod は npm の物を import できないので写して持つ）。
// 実行: npm install && node scripts/build-vendor.mjs
// フックの環境には process もタイマーも無い。束の中だけで効く代わりを頭に置く（大域は書き換えない）
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = (n) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', n, 'package.json'), 'utf8')).version
/** 改行（0x0A）は上の置き換えで済ませる。タブは \t、ほかの制御の字は \xHH に直す */
const escapeControls = (s) => s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).replace(/\t/g, '\\t')
const shim = "const process = { env: { NODE_ENV: 'production' }, nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) }, setTimeout = (f) => { Promise.resolve().then(f); return 0 }, clearTimeout = () => {}, setImmediate = (f) => Promise.resolve().then(f);"
// fontkit は utf-16 などの TextDecoder を作るが、フックの環境の TextDecoder は utf-8 だけなので補う
const decoder = "const TextDecoder = (() => { const U = globalThis.TextDecoder; return class { constructor(enc = 'utf-8') { this.e = String(enc).toLowerCase().replace(/_/g, '-'); this.u = /^(utf-?8|unicode-1-1-utf-8)$/.test(this.e) ? new U('utf-8') : null } decode(b) { if (b === undefined) return ''; const a = b instanceof Uint8Array ? b : new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength ?? b.length); if (this.u) return this.u.decode(a); let s = ''; if (/^utf-?16/.test(this.e)) { const be = /be$/.test(this.e); for (let i = 0; i + 1 < a.length; i += 2) s += String.fromCharCode(be ? (a[i] << 8) | a[i + 1] : a[i] | (a[i + 1] << 8)); return s } for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return s } get encoding() { return this.e } } })();"

const bundles = [
  {
    entry: 'src/pdf-entry.mjs', out: 'hooks/vendor/pdf.mjs',
    banner: [`// 出典: pdf-lib ${pkg('pdf-lib')}（https://github.com/Hopding/pdf-lib・MIT）・fontkit ${pkg('fontkit')}（https://github.com/foliojs/fontkit・MIT）と、その依存`, shim, decoder],
  },
  // keepIdentifiers: 識別子を縮めない。縮めると ECharts の tokens が `$` になり、`$` の直後に点が来る字の並び（フックの検査が探す）が束に出る。
  // esbuild は minify: true に識別子の縮めを含むので、縮めない時は minifyWhitespace と minifySyntax だけを立てる（1.1 MB 程度）
  {
    entry: 'src/echarts-entry.mjs', out: 'hooks/vendor/echarts.mjs', keepIdentifiers: true,
    banner: [`// 出典: Apache ECharts ${pkg('echarts')}（https://echarts.apache.org・Apache-2.0）・zrender（BSD-3-Clause）`, shim],
  },
  {
    entry: 'src/text-entry.mjs', out: 'hooks/vendor/text.mjs', keepIdentifiers: true,
    banner: [`// 出典: BudouX ${pkg('budoux')}（https://github.com/google/budoux・Apache-2.0）・marked ${pkg('marked')}（https://github.com/markedjs/marked・MIT）`, shim],
  },
]
for (const b of bundles) {
  if (!fs.existsSync(path.join(root, b.entry))) { console.log(`skip ${b.out}（${b.entry} が無い）`); continue }
  await build({
    entryPoints: [path.join(root, b.entry)],
    outfile: path.join(root, b.out),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none',
    ...(b.keepIdentifiers ? { minifyWhitespace: true, minifySyntax: true } : { minify: true }),
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    banner: { js: [...b.banner, `// 元は ${b.entry}。scripts/build-vendor.mjs で作る。手で直さない。LICENSE は ../../LICENSES/`].join('\n') },
    logLevel: 'warning',
  })
  // 縮めた束は改行だけのテンプレートリテラル（`<改行>`）を残す。走査が「制御文字の字」と見るので "\n" に直す（mods-trade 0.9.23 の学び）
  // 生の制御の字（タブ・0x01 など）も同じ理由で字のエスケープにする。字の値は変わらない（文字列・テンプレート・正規表現の中だけに出る）
  const f = path.join(root, b.out)
  const out = escapeControls(fs.readFileSync(f, 'utf8').split('`\n`').join('"\\n"'))
  // 縮めた名前が `$` になると、静的な検査が `$.` を mods の呼び出しと読んで落とす。今きれいなのは名前の割り当ての偶然なので、作るたびに確かめる
  if (/\$\./.test(out)) throw new Error(`${b.out}: 「$.」が出た（keepIdentifiers を付けるか entry を直す）`)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(out)) throw new Error(`${b.out}: 生の制御の字が残った`)
  fs.writeFileSync(f, out)
  console.log(b.out, fs.statSync(f).size)
}
