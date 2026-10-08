// fonts/ の書体を作る: JIS X 0208（第 1・第 2 水準と非漢字）＋ ASCII ＋よく使う記号だけの TrueType にする。
// 実行: node scripts/build-fonts.mjs
//   元: Noto Sans JP（C:\Windows\Fonts\NotoSansJP-VF.ttf・可変書体を 400 と 700 に固定）、
//       Zen Old Mincho（C:\dev\kit\files\fonts の Regular と Bold）。どちらも SIL OFL 1.1
//   別の場所にあるなら環境変数 NOTO_SANS_JP_VF・ZEN_OLD_MINCHO_DIR で渡す
// フックの読み込みは 1 回 4 MiB まで、しかも base64（4/3 倍）で読むので、1 ファイルは 3 MiB 未満に保つ。
// 明朝は JIS の字だけでも 5 MB あるので、3 MiB 未満の <名前>.ttf.0・.1 … に割って置き、フックが順に読んでつなぐ（engine/fonts.mjs の joinParts）。
// 字を減らして 1 つに収める案は選ばなかった: 第 2 水準の字だけ別の書体になり、明朝の本文で字の形がそろわない
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'fonts')
const sansVF = process.env.NOTO_SANS_JP_VF ?? 'C:/Windows/Fonts/NotoSansJP-VF.ttf'
const minchoDir = process.env.ZEN_OLD_MINCHO_DIR ?? 'C:/dev/kit/files/fonts'
const LIMIT = 3 * 1024 * 1024

const ascii = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('')
// JIS X 0208 に無いが文書でよく出る字（ダッシュ・引用符・丸数字・単位など）
const extra = '−–—‐―…‥‘’“”«»・「」『』【】〈〉《》〔〕〘〙〖〗（）［］｛｝！？％＄＃＆＊＋，．／：；＜＝＞＠＼＾＿｀｜～￥€£¥©®™°±×÷µ¶§•′″‰←→↑↓↔⇒⇔▲▼△▽►◄■□●○◆◇★☆※〒〜ー々〆ヶヵゝゞヽヾ〃仝①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴ㈱㈲㈹㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡№℡㊤㊥㊦㊧㊨〝〟'
const dec = new TextDecoder('euc-jp')
let jis = ''
for (let r = 0xa1; r <= 0xf4; r++) for (let c = 0xa1; c <= 0xfe; c++) {
  const ch = dec.decode(new Uint8Array([r, c]))
  if (ch && ch !== '\uFFFD') jis += ch
}
const chars = [...new Set(jis + ascii + extra + '\u00A0\u3000')].join('')

const jobs = [
  [sansVF, 'NotoSansJP-JIS-400.ttf', { variationAxes: { wght: 400 } }],
  [sansVF, 'NotoSansJP-JIS-700.ttf', { variationAxes: { wght: 700 } }],
  [path.join(minchoDir, 'ZenOldMincho-Regular.ttf'), 'ZenOldMincho-JIS-400.ttf', {}],
  [path.join(minchoDir, 'ZenOldMincho-Bold.ttf'), 'ZenOldMincho-JIS-700.ttf', {}],
]
const PART = LIMIT - 64 * 1024
fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(out)) if (/\.ttf(\.\d+)?$/.test(f)) fs.rmSync(path.join(out, f))
const manifest = {}
for (const [src, name, opts] of jobs) {
  // halt・palt・vert などの機能（GSUB/GPOS）は残す（約物の半角や縦組みで使う）
  const buf = await subsetFont(fs.readFileSync(src), chars, { targetFormat: 'truetype', preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 13, 14], ...opts })
  const parts = []
  if (buf.length < LIMIT) { fs.writeFileSync(path.join(out, name), buf); parts.push(name) }
  else for (let i = 0, at = 0; at < buf.length; i++, at += PART) { const p = `${name}.${i}`; fs.writeFileSync(path.join(out, p), buf.subarray(at, at + PART)); parts.push(p) }
  manifest[name] = { bytes: buf.length, parts }
  console.log(`${name} ${[...chars].length} 字 ${buf.length} バイト（${parts.length} ファイル）`)
}
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify(manifest, null, 2) + '\n')
