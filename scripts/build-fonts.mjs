// fonts/ の書体を作る: JIS X 0208（第 1・第 2 水準と非漢字）＋ ASCII ＋よく使う記号だけの TrueType にする。
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'fonts')
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

/** @typedef {{ family: string, subfamily: string, postscript: string }} Face */

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
  tables.find((t) => t.tag === 'head').data.writeUInt32BE(0, 8)
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
const notoFace = (subfamily) => ({ family: 'Noto Sans JP', subfamily, postscript: `NotoSansJP-${subfamily}` })

// 4 つ目は名前を直す書体。Zen Old Mincho は元の名前が正しいので null（触らない）
const jobs = [
  [sansVF, 'NotoSansJP-JIS-400.ttf', { variationAxes: { wght: 400 } }, notoFace('Regular')],
  [sansVF, 'NotoSansJP-JIS-700.ttf', { variationAxes: { wght: 700 } }, notoFace('Bold')],
  [path.join(minchoDir, 'ZenOldMincho-Regular.ttf'), 'ZenOldMincho-JIS-400.ttf', {}, null],
  [path.join(minchoDir, 'ZenOldMincho-Bold.ttf'), 'ZenOldMincho-JIS-700.ttf', {}, null],
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
  console.log(`${name} ${[...chars].length} 字 ${buf.length} バイト（${parts.length} ファイル）`)
}
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify(manifest, null, 2) + '\n')
