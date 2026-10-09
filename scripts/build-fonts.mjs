// fonts/ の書体を作る: JIS X 0208（第 1・第 2 水準と非漢字）＋ ASCII ＋よく使う記号
// ＋ Latin-1 補助・Latin Extended-A・一般の約物（元の書体にある字）だけの TrueType にする。
// 実行: node scripts/build-fonts.mjs [出す場所]   （既定は fonts/。確かめてから fonts/ に写す時は別の場所へ出す）
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
import * as fontkit from 'fontkit'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'fonts')
const sansVF = process.env.NOTO_SANS_JP_VF ?? 'C:/Windows/Fonts/NotoSansJP-VF.ttf'
const serifVF = process.env.NOTO_SERIF_JP_VF ?? 'C:/Windows/Fonts/NotoSerifJP-VF.ttf'
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
/** @param {number} a @param {number} b @returns {string} a \u304B\u3089 b \u307E\u3067\u306E\u30B3\u30FC\u30C9\u30DD\u30A4\u30F3\u30C8\u306E\u5B57 */
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).join('')
// \u30A2\u30AF\u30BB\u30F3\u30C8\u4ED8\u304D\u306E\u6B27\u6587\uFF08Latin-1 \u88DC\u52A9\u30FBLatin Extended-A\uFF09\u3068\u4E00\u822C\u306E\u7D04\u7269\u3002\u5143\u306E\u66F8\u4F53\u306B\u7121\u3044\u5B57\u306F subset \u304C\u6368\u3066\u308B\u306E\u3067\u7BC4\u56F2\u306E\u307E\u307E\u6E21\u3059
// \uFF08Latin Extended-A \u306F Noto 30/128\u30FBZen 8/128\u3002\u660E\u671D\u306B\u7121\u3044\u5B57\u306F layout \u304C\u5B57\u3054\u3068\u306B\u30B4\u30B7\u30C3\u30AF\u3067\u63CF\u304F\uFF09\u3002
// \u5143\u306B\u5728\u308B\u5B57\u3092 1 \u3064\u305A\u3064\u6570\u3048\u3066\u6E21\u3059\u6848\u306F\u9078\u3070\u306A\u304B\u3063\u305F: \u5143\u306E\u66F8\u4F53\u3092\u66FF\u3048\u305F\u6642\u306B\u4ED8\u3044\u3066\u3053\u306A\u3044
const latin = span(0xa0, 0xff) + span(0x100, 0x17f) + span(0x2010, 0x2027) + span(0x2030, 0x205e)
const chars = [...new Set(jis + ascii + extra + '\u00A0\u3000' + latin)].join('')

/**
 * sfnt の checksum（4 バイトずつ足す。末尾は 0 で埋める）
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function sfntChecksum(bytes) {
  const padded = Buffer.alloc((bytes.length + 3) & ~3)
  Buffer.from(bytes).copy(padded)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) % 0x100000000
  return sum
}

/** @param {string} s @returns {Buffer} UTF-16BE（Windows の記録） */
const utf16be = (s) => Buffer.from(s, 'utf16le').swap16()

/** @param {string} s @returns {Buffer} Mac Roman（ASCII と © だけ。名前の表はこの範囲に収まる） */
function macRoman(s) {
  return Buffer.from([...s].map((ch) => {
    if (ch.codePointAt(0) < 0x80) return ch.codePointAt(0)
    if (ch === '©') return 0xa9
    throw new Error(`Mac Roman にない字: ${ch}`)
  }))
}

/** @typedef {{ family: string, subfamily: string, postscript: string, bold: boolean }} Face */

/**
 * 太さの旗を face に合わせる。OS/2.fsSelection は bit 5 が BOLD・bit 6 が REGULAR（どちらか一方）、head.macStyle は bit 0 が BOLD。
 * 可変書体の既定（Thin）から切り出した Noto は、どちらの旗も立っていなかった。usWeightClass は切り出しの時点で正しい。
 * Why not: Zen Old Mincho は触らない。元から旗が合っている。
 * @param {Buffer} os2
 * @param {Buffer} head
 * @param {boolean} bold
 */
function setWeightFlags(os2, head, bold) {
  const sel = os2.readUInt16BE(62)
  os2.writeUInt16BE(bold ? (sel | 0x20) & ~0x40 : (sel | 0x40) & ~0x20, 62)
  const mac = head.readUInt16BE(44)
  head.writeUInt16BE(bold ? mac | 1 : mac & ~1, 44)
}

/**
 * name 表を作り直す。Windows（3,1,0x409）の 1・2・3・4・6 を face に合わせ、同じ番号の Mac（1,0,0）の記録も作る。
 * 他の番号（著作権・ライセンス・可変書体の軸の名前）は元の字のまま。
 * Why not: subset の名前をそのまま残す案は選ばない（可変書体の既定の名前 Thin が PostScript 名に残る）。
 * @param {Buffer} table
 * @param {Face} face
 * @returns {Buffer}
 */
function rewriteName(table, face) {
  const count = table.readUInt16BE(2)
  const strings = table.readUInt16BE(4)
  /** @type {Map<number, string>} */
  const win = new Map()
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    if (table.readUInt16BE(r) !== 3 || table.readUInt16BE(r + 2) !== 1 || table.readUInt16BE(r + 4) !== 0x409) continue
    const at = strings + table.readUInt16BE(r + 10)
    win.set(table.readUInt16BE(r + 6), Buffer.from(table.subarray(at, at + table.readUInt16BE(r + 8))).swap16().toString('utf16le'))
  }
  const oldPs = win.get(6)
  if (oldPs === undefined || win.get(3) === undefined) throw new Error('name 表に 3 と 6 の記録が無い')
  const set = new Map([
    [1, face.family],
    [2, face.subfamily],
    [3, win.get(3).split(oldPs).join(face.postscript)],
    [4, `${face.family} ${face.subfamily}`],
    [6, face.postscript],
  ])
  const value = (nid) => set.get(nid) ?? win.get(nid)
  const recs = [...win.keys()].map((nid) => ({ pid: 3, eid: 1, lid: 0x409, nid, data: utf16be(value(nid)) }))
  for (const nid of win.keys()) if (nid < 256) recs.push({ pid: 1, eid: 0, lid: 0, nid, data: macRoman(value(nid)) })
  recs.sort((a, b) => a.pid - b.pid || a.nid - b.nid)
  const head = Buffer.alloc(6)
  head.writeUInt16BE(recs.length, 2)
  head.writeUInt16BE(6 + 12 * recs.length, 4)
  const dir = []
  const body = []
  let off = 0
  for (const r of recs) {
    const e = Buffer.alloc(12)
    e.writeUInt16BE(r.pid, 0); e.writeUInt16BE(r.eid, 2); e.writeUInt16BE(r.lid, 4)
    e.writeUInt16BE(r.nid, 6); e.writeUInt16BE(r.data.length, 8); e.writeUInt16BE(off, 10)
    dir.push(e)
    body.push(r.data)
    off += r.data.length
  }
  return Buffer.concat([head, ...dir, ...body])
}

/**
 * subset の書体の名前を face に直し、表の位置と checksum を計算し直す（name の長さが変わるので後ろの表は全部動く）。
 * head の checkSumAdjustment は全体の checksum から求めるので、計算の間は 0 にしておく。
 * @param {Buffer} font
 * @param {Face} face
 * @returns {Buffer}
 */
function setFace(font, face) {
  const n = font.readUInt16BE(4)
  const tables = []
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    const start = font.readUInt32BE(o + 8)
    tables.push({ tag: font.toString('latin1', o, o + 4), data: Buffer.from(font.subarray(start, start + font.readUInt32BE(o + 12))) })
  }
  const name = tables.find((t) => t.tag === 'name')
  name.data = rewriteName(name.data, face)
  const head = tables.find((t) => t.tag === 'head').data
  setWeightFlags(tables.find((t) => t.tag === 'OS/2').data, head, face.bold)
  head.writeUInt32BE(0, 8)
  let at = 12 + 16 * n
  const entries = tables.map((t) => {
    const e = { tag: t.tag, checksum: sfntChecksum(t.data), offset: at, length: t.data.length }
    at += (t.data.length + 3) & ~3
    return e
  })
  const out = Buffer.alloc(at)
  font.copy(out, 0, 0, 12)
  entries.forEach((e, i) => {
    const o = 12 + i * 16
    out.write(e.tag, o, 'latin1')
    out.writeUInt32BE(e.checksum, o + 4)
    out.writeUInt32BE(e.offset, o + 8)
    out.writeUInt32BE(e.length, o + 12)
    tables[i].data.copy(out, e.offset)
  })
  const headAt = entries.find((e) => e.tag === 'head').offset
  out.writeUInt32BE((0xb1b0afba - sfntChecksum(out) + 0x100000000) % 0x100000000, headAt + 8)
  return out
}

/** @param {string} subfamily @returns {Face} Noto Sans JP の太さ（400 は Regular・700 は Bold） */
const notoFace = (subfamily) => ({ family: 'Noto Sans JP', subfamily, postscript: `NotoSansJP-${subfamily}`, bold: subfamily === 'Bold' })
/** @param {string} subfamily @returns {Face} Noto Serif JP（明朝の太字の役は 600 = SemiBold。見出しの W6 に当たる） */
const serifFace = (subfamily) => ({ family: 'Noto Serif JP', subfamily, postscript: `NotoSerifJP-${subfamily}`, bold: subfamily !== 'Regular' })

// 4 つ目は名前を直す書体（可変書体の既定の名前 Thin を直す）。明朝は 10-09 に Zen Old Mincho から Noto Serif JP に替えた（本人「Noto Serif JP でいいよ」）
const jobs = [
  [sansVF, 'NotoSansJP-JIS-400.ttf', { variationAxes: { wght: 400 } }, notoFace('Regular')],
  [sansVF, 'NotoSansJP-JIS-700.ttf', { variationAxes: { wght: 700 } }, notoFace('Bold')],
  [serifVF, 'NotoSerifJP-JIS-400.ttf', { variationAxes: { wght: 400 } }, serifFace('Regular')],
  [serifVF, 'NotoSerifJP-JIS-600.ttf', { variationAxes: { wght: 600 } }, serifFace('SemiBold')],
]
const PART = LIMIT - 64 * 1024
fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(out)) if (/\.ttf(\.\d+)?$/.test(f)) fs.rmSync(path.join(out, f))
const manifest = {}
for (const [src, name, opts, face] of jobs) {
  // halt・palt・vert などの機能（GSUB/GPOS）は残す（約物の半角や縦組みで使う）
  let buf = Buffer.from(await subsetFont(fs.readFileSync(src), chars, { targetFormat: 'truetype', preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 13, 14], ...opts }))
  if (face) buf = setFace(buf, face)
  const parts = []
  if (buf.length < LIMIT) { fs.writeFileSync(path.join(out, name), buf); parts.push(name) }
  else for (let i = 0, at = 0; at < buf.length; i++, at += PART) { const p = `${name}.${i}`; fs.writeFileSync(path.join(out, p), buf.subarray(at, at + PART)); parts.push(p) }
  manifest[name] = { bytes: buf.length, parts }
  // 渡した字のうち書体に在った字の数（元に無い字は捨てられる）
  const inFont = /** @type {any} */ (fontkit.create(buf)).characterSet.length
  console.log(`${name} 渡した ${[...chars].length} 字・書体にある字 ${inFont}・${buf.length} バイト（${parts.length} ファイル）`)
}
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify(manifest, null, 2) + '\n')
