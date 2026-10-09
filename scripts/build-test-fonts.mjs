// @ts-check
// 試験用の小さな書体（tests/test-fonts.ts）を作る。fonts/ の本物から、試験の字だけを残した TrueType を base64 で埋め込む。
// 実行: node scripts/build-test-fonts.mjs   （tests/texts.ts の日本語を変えたら、もう一度走らせる）
// 選ばなかった案: 試験で本物の書体（14 MB）を読む案。claude plugin test は node:fs を import できず、読めるのは stub が返す物だけ。
// 試験が欲しいのは「書体の読み込みと組版と PDF の通り」で、字形の美しさではない（それは scripts/hook-env-check.mjs が本物で確かめる）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontsDir = path.join(root, 'fonts')
const testsDir = path.join(root, 'tests')
const outFile = path.join(testsDir, 'test-fonts.ts')

/** fonts/fonts.json の割った書体をつないで 1 つのバッファーにする */
function readWhole(manifest, name) {
  const info = manifest[name]
  return Buffer.concat(info.parts.map((p) => fs.readFileSync(path.join(fontsDir, p))))
}

// 残す字: ASCII・全角の約物・組版が穴埋めに使う〓、それに tests/texts.ts（PDF に組む日本語を集めた物）の字。
// 試験の名前や期待値の字は PDF に載らない。漢字の輪郭は 1 字 400 バイト前後あり、全部残すと 1 書体が 200 KB を超える
const keep = new Set()
for (let c = 0x20; c < 0x7f; c++) keep.add(String.fromCharCode(c))
for (const ch of '。、，．・「」『』（）［］【】〔〕〈〉《》〓ー〜…—―！？：；％＋－＝　') keep.add(ch)
for (const ch of fs.readFileSync(path.join(testsDir, 'texts.ts'), 'utf8')) {
  if (ch.codePointAt(0) > 0x7f) keep.add(ch)
}
const chars = [...keep].join('')

const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const files = {}
const small = {}
for (const name of Object.keys(manifest)) {
  const buf = await subsetFont(readWhole(manifest, name), chars, { targetFormat: 'truetype', preserveNameIds: [0, 1, 2, 3, 4, 5, 6] })
  files[name] = Buffer.from(buf).toString('base64')
  small[name] = { bytes: buf.length, parts: [name] }
  console.log(`${name} ${keep.size} 字 ${buf.length} バイト`)
}

const body = [
  '// 自動生成: node scripts/build-test-fonts.mjs。手で直さない。',
  '// 試験用に字を絞った書体（fonts/ の本物から）。fonts.json と同じ形の目録つき。',
  `export const TEST_MANIFEST: Record<string, { bytes: number; parts: string[] }> = ${JSON.stringify(small, null, 2)}`,
  '',
  `export const TEST_FONT_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)}`,
  '',
].join('\n')
fs.writeFileSync(outFile, body)
console.log(`${path.relative(root, outFile)} ${body.length} 字`)
