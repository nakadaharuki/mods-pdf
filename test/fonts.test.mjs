// 書体の読み込みと寸法の試験。本物の書体 4 つを 1 回だけ読んで使い回す（遅くしない）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FILES, loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { rawFontkit } from '../hooks/vendor/pdf.mjs'
import { compose } from '../hooks/engine/index.mjs'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const readBase64 = async (rel) => fs.readFileSync(path.join(fontsDir, rel)).toString('base64')
const IDS = ['mincho', 'minchoBold', 'sans', 'sansBold']

const bytes = await loadFontBytes(IDS, manifest, readBase64, new Map())
const metrics = makeMetrics(bytes)

const EMOJI = String.fromCodePoint(0x1f600)
const VS16 = String.fromCodePoint(0xfe0f)
const HEBREW_ALEF = String.fromCodePoint(0x05d0)
const KANJI_ASTRAL = String.fromCodePoint(0x20bb7)
const cp = (s) => /** @type {number} */ (s.codePointAt(0))

test('明朝の 2 つに割ったファイルをつないだバイト列の長さが fonts.json の bytes と同じ', () => {
  assert.equal(manifest[FONT_FILES.mincho].parts.length, 2)
  assert.equal(bytes.mincho.length, manifest[FONT_FILES.mincho].bytes)
  assert.equal(bytes.minchoBold.length, manifest[FONT_FILES.minchoBold].bytes)
  assert.equal(bytes.sans.length, manifest[FONT_FILES.sans].bytes)
  assert.equal(bytes.sansBold.length, manifest[FONT_FILES.sansBold].bytes)
})

test('つないだバイト列は TrueType の頭（00 01 00 00）で始まる', () => {
  for (const id of IDS) assert.deepEqual([...bytes[id].subarray(0, 4)], [0, 1, 0, 0], id)
})

test('頼んだ書体だけを返す', async () => {
  const got = await loadFontBytes(['sans'], manifest, readBase64, new Map())
  assert.deepEqual(Object.keys(got), ['sans'])
})

test('読み終えたファイルは次の呼び出しで読み直さない', async () => {
  // 期待するファイル名は fonts.json の parts から取る（書体を替えても試験の狙い「読み直さない」は変わらない）
  const partsOf = (id) => manifest[FONT_FILES[id]].parts
  const reads = []
  const counting = async (rel) => { reads.push(rel); return readBase64(rel) }
  const cache = new Map()
  await loadFontBytes(['mincho', 'sans'], manifest, counting, cache)
  assert.deepEqual(reads, [...partsOf('mincho'), ...partsOf('sans')])
  reads.length = 0
  await loadFontBytes(['sans', 'mincho', 'minchoBold'], manifest, counting, cache)
  assert.deepEqual(reads, partsOf('minchoBold'))
})

test('同時に 2 回頼まれても読むのは 1 回', async () => {
  let n = 0
  const counting = async (rel) => { n++; return readBase64(rel) }
  const cache = new Map()
  await Promise.all([loadFontBytes(['sans'], manifest, counting, cache), loadFontBytes(['sans'], manifest, counting, cache)])
  assert.equal(n, 1)
})

test('読むのに失敗したファイルは覚えず、次の呼び出しで読み直す', async () => {
  let fail = true
  const flaky = async (rel) => { if (fail) throw new Error('読めない'); return readBase64(rel) }
  const cache = new Map()
  await assert.rejects(loadFontBytes(['sans'], manifest, flaky, cache), /読めない/)
  fail = false
  const got = await loadFontBytes(['sans'], manifest, flaky, cache)
  assert.equal(got.sans.length, manifest[FONT_FILES.sans].bytes)
})

test('知らない書体の名前は断る', async () => {
  await assert.rejects(loadFontBytes(['serif'], manifest, readBase64, new Map()), /知らない書体/)
})

test('fonts.json に無い書体は断る', async () => {
  await assert.rejects(loadFontBytes(['sans'], {}, readBase64, new Map()), /fonts\.json/)
})

test('fonts.json の bytes とつないだ長さが違えば断る', async () => {
  const bad = { ...manifest, [FONT_FILES.sans]: { ...manifest[FONT_FILES.sans], bytes: 1 } }
  await assert.rejects(loadFontBytes(['sans'], bad, readBase64, new Map()), /大きさが/)
})

test('和字と全角の約物の送り幅はどの書体でも 1em', () => {
  for (const id of IDS) {
    for (const ch of ['あ', 'ア', '漢', '、', '。', '「', '」', '（', '）', '・']) {
      assert.equal(metrics[id].adv(cp(ch)), 1, `${id} ${ch}`)
    }
  }
})

test('ASCII の A の送り幅は 0.5〜0.8em（明朝はおよそ 0.72・ゴシックはおよそ 0.61）', () => {
  for (const id of IDS) {
    const a = metrics[id].adv(cp('A'))
    assert.ok(a > 0.5 && a < 0.8, `${id} ${a}`)
  }
  assert.ok(Math.abs(metrics.sans.adv(cp('A')) - 0.6) < 0.05)
})

test('寸法: upm は正・ascent は正・descent は負', () => {
  for (const id of IDS) {
    const m = metrics[id]
    assert.ok(m.upm > 0)
    assert.ok(m.ascent > 0.7 && m.ascent < 1.5, `${id} ascent ${m.ascent}`)
    assert.ok(m.descent < 0 && m.descent > -0.5, `${id} descent ${m.descent}`)
  }
})

test('書体に無い字は has が false で adv が NaN', () => {
  for (const id of IDS) {
    assert.equal(metrics[id].has(cp(EMOJI)), false, id)
    assert.ok(Number.isNaN(metrics[id].adv(cp(EMOJI))), id)
    assert.equal(metrics[id].has(cp('あ')), true, id)
  }
})

test('範囲の外のコードポイントを渡しても投げず、無い字として答える', () => {
  assert.equal(metrics.mincho.has(-1), false)
  assert.equal(metrics.mincho.has(0x110000), false)
  assert.ok(Number.isNaN(metrics.mincho.adv(0x110000)))
})

test('missing は書体に無い字だけを重複なく出てきた順で返す', () => {
  assert.deepEqual(metrics.sans.missing(`aあ${EMOJI}b${EMOJI}${HEBREW_ALEF}`), [EMOJI, HEBREW_ALEF])
  assert.deepEqual(metrics.sans.missing('欧文 and 和文。'), [])
  assert.deepEqual(metrics.sans.missing(''), [])
})

test('office は合字にならず 6 字 = xs の数 6（ゴシックの既定のレイアウトは ffi を合字にする）', () => {
  const plain = rawFontkit.create(bytes.sans).layout('office')
  assert.ok(plain.glyphs.length < 6, '前提: 既定のままだと合字になる')
  for (const id of IDS) {
    const r = metrics[id].run('office')
    assert.equal(r.xs.length, 6, id)
    assert.equal(r.xs[0], 0)
  }
})

test('fi・ffl・-> の字形の数 = 字の数（合字を切る）', () => {
  for (const id of IDS) {
    const text = 'fi ffl ->'
    const r = metrics[id].run(text)
    assert.equal(r.xs.length, text.length, id)
    for (let i = 1; i < r.xs.length; i++) assert.ok(r.xs[i] > r.xs[i - 1], `${id} 左端は右へ進む`)
  }
})

test('run の幅は字ごとの送り幅の和と大きく違わない（違うのはカーニングの分だけ）', () => {
  for (const id of IDS) {
    const text = 'Hello, World 123'
    const m = metrics[id]
    const sum = [...text].reduce((s, ch) => s + m.adv(cp(ch)), 0)
    const r = m.run(text)
    assert.ok(Math.abs(r.width - sum) < 0.2, `${id} ${r.width} / ${sum}`)
    assert.ok(r.width <= sum + 1e-9, 'カーニングは詰める向き')
  }
})

test('カーニングは残る（AV の幅は A と V の送り幅の和より狭い）', () => {
  for (const id of IDS) {
    const m = metrics[id]
    const sum = m.adv(cp('A')) + m.adv(cp('V'))
    assert.ok(m.run('AV').width < sum - 0.01, `${id} ${m.run('AV').width} / ${sum}`)
  }
})

test('run の xs は各字の左端で、最後の字の左端 + その字の送り幅 = 幅（カーニングなしの語）', () => {
  const m = metrics.mincho
  const r = m.run('office')
  const last = r.xs[5] + m.adv(cp('e'))
  assert.ok(Math.abs(last - r.width) < 1e-9)
})

test('和字の run は 1 字ごとに 1em ずつ進む', () => {
  const r = metrics.mincho.run('日本語、')
  assert.deepEqual(r.xs, [0, 1, 2, 3])
  assert.equal(r.width, 4)
})

test('空の文字列の run は幅 0・xs が空', () => {
  const r = metrics.sans.run('')
  assert.equal(r.width, 0)
  assert.deepEqual(r.xs, [])
})

test('サロゲート対の字は 1 字として数える', () => {
  const r = metrics.mincho.run(`a${KANJI_ASTRAL}b`)
  assert.equal(r.xs.length, 3)
  for (let i = 1; i < 3; i++) assert.ok(r.xs[i] >= r.xs[i - 1])
})

test('字形の数が字の数と合わない時（異体字選択子が落ちる）は字ごとの送り幅に戻り、xs の数は字の数', () => {
  const text = `a${VS16}b`
  const r = metrics.sans.run(text)
  assert.equal(r.xs.length, 3)
  assert.ok(Number.isFinite(r.width))
})

test('書体に無い字を含んでも run の幅は有限', () => {
  const r = metrics.mincho.run(`a${EMOJI}b`)
  assert.equal(r.xs.length, 3)
  assert.ok(Number.isFinite(r.width) && r.width > 0)
})

test('右から左の字を含んでも xs は左から右へ進む', () => {
  const r = metrics.sans.run(`a${HEBREW_ALEF}b`)
  assert.equal(r.xs.length, 3)
  assert.ok(r.xs[1] > r.xs[0] && r.xs[2] > r.xs[1])
})

test('同じ語の run は覚えてあって同じ物を返し、書き換えられない', () => {
  const m = metrics.sans
  const a = m.run('cache-me')
  const b = m.run('cache-me')
  assert.equal(a, b)
  assert.throws(() => { a.xs.push(1) }, TypeError)
})

// name 表の記録を「プラットフォーム:番号」→ 字 で読む。fontkit は Mac と Windows を分けて返さないので、表を直に読む
/** @param {Uint8Array} font @returns {Map<string, string>} */
function nameRecords(font) {
  const buf = Buffer.from(font)
  const { offset } = tableDirectory(buf).get('name')
  const count = buf.readUInt16BE(offset + 2)
  const strings = offset + buf.readUInt16BE(offset + 4)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    const r = offset + 6 + i * 12
    const pid = buf.readUInt16BE(r)
    const at = strings + buf.readUInt16BE(r + 10)
    const raw = buf.subarray(at, at + buf.readUInt16BE(r + 8))
    out.set(`${pid}:${buf.readUInt16BE(r + 6)}`, pid === 3 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1'))
  }
  return out
}

/** @param {Buffer} buf @returns {Map<string, { checksum: number, offset: number, length: number }>} */
function tableDirectory(buf) {
  const out = new Map()
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const o = 12 + i * 16
    out.set(buf.toString('latin1', o, o + 4), { checksum: buf.readUInt32BE(o + 4), offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) })
  }
  return out
}

/** sfnt の checksum（4 バイトずつ。末尾は 0 で埋める） */
function sfntSum(bytes) {
  const padded = Buffer.alloc((bytes.length + 3) & ~3)
  Buffer.from(bytes).copy(padded)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) % 0x100000000
  return sum
}

test('Noto Sans JP の 400 と 700 の PostScript 名は NotoSansJP-Regular と NotoSansJP-Bold（可変書体の既定の Thin にならない）', () => {
  assert.equal(rawFontkit.create(bytes.sans).postscriptName, 'NotoSansJP-Regular')
  assert.equal(rawFontkit.create(bytes.sansBold).postscriptName, 'NotoSansJP-Bold')
})

test('Noto Serif JP の 400 と 600 の PostScript 名は NotoSerifJP-Regular と NotoSerifJP-SemiBold（可変書体の既定の ExtraLight にならない）', () => {
  // 明朝の太字の役は 600（SemiBold）。scripts/build-fonts.mjs の serifFace と同じ名前
  assert.equal(rawFontkit.create(bytes.mincho).postscriptName, 'NotoSerifJP-Regular')
  assert.equal(rawFontkit.create(bytes.minchoBold).postscriptName, 'NotoSerifJP-SemiBold')
})

test('Noto Sans JP の名前は Windows と Mac の両方に同じ字で入り、Thin を含まず、予約名 Source を名前に使わない', () => {
  for (const [font, sub] of [[bytes.sans, 'Regular'], [bytes.sansBold, 'Bold']]) {
    const rec = nameRecords(font)
    for (const pid of [1, 3]) {
      assert.equal(rec.get(`${pid}:1`), 'Noto Sans JP', `pid ${pid} family`)
      assert.equal(rec.get(`${pid}:2`), sub, `pid ${pid} subfamily`)
      assert.equal(rec.get(`${pid}:4`), `Noto Sans JP ${sub}`, `pid ${pid} full`)
      assert.equal(rec.get(`${pid}:6`), `NotoSansJP-${sub}`, `pid ${pid} postscript`)
      for (const nid of [1, 2, 3, 4, 6]) assert.ok(!rec.get(`${pid}:${nid}`).includes('Source'), `pid ${pid} name ${nid}`)
    }
    for (const v of rec.values()) assert.ok(!v.includes('Thin'), v)
  }
})

test('名前の表を書き直した後も sfnt の checksum は表ごとに、ファイル全体で合う（OS が表を捨てない）', () => {
  for (const font of [bytes.sans, bytes.sansBold, bytes.mincho, bytes.minchoBold]) {
    const buf = Buffer.from(font)
    const dir = tableDirectory(buf)
    for (const [tag, t] of dir) {
      const data = Buffer.from(buf.subarray(t.offset, t.offset + t.length))
      if (tag === 'head') data.writeUInt32BE(0, 8)
      assert.equal(sfntSum(data), t.checksum, tag)
      assert.equal(t.offset % 4, 0, `${tag} の位置は 4 の倍数`)
    }
    const whole = Buffer.from(buf)
    whole.writeUInt32BE(0, dir.get('head').offset + 8)
    assert.equal((sfntSum(whole) + buf.readUInt32BE(dir.get('head').offset + 8)) % 0x100000000, 0xb1b0afba)
  }
})

// ---------- アクセント付きの欧文と約物(Latin-1 補助・Latin Extended-A・一般の約物) ----------
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const countIn = (id, cps) => cps.filter((c) => metrics[id].has(c)).length

test('Latin-1 補助の 96 字(U+00A0〜00FF)は 4 書体すべてにあり、送り幅が有限で正', () => {
  for (const id of IDS) {
    assert.equal(countIn(id, range(0xa0, 0xff)), 96, id)
    for (const c of range(0xa0, 0xff)) assert.ok(metrics[id].adv(c) >= 0, `${id} U+${c.toString(16)}`)
  }
})

test('Latin Extended-A は元の書体にある字だけ入る(ゴシック 30/128・明朝も同じ 30/128)', () => {
  // 2026-10-18 に fonts/ から読んだ値。Noto Sans JP と Noto Serif JP は同じ 30 字
  // （Ā ā Ă ă Đ đ Ē ē Ě ě Ĩ ĩ Ī ī Ń ń Ň ň Ō ō Ŏ ŏ Œ œ Ũ ũ Ū ū Ŭ ŭ）。Zen Old Mincho の頃は明朝が 8 字だった
  const extA = range(0x100, 0x17f)
  const inSans = extA.filter((c) => metrics.sans.has(c))
  assert.equal(inSans.length, 30)
  assert.equal(countIn('sansBold', extA), 30)
  assert.deepEqual(extA.filter((c) => metrics.mincho.has(c)), inSans, '明朝の字の集まりはゴシックと同じ')
  assert.deepEqual(extA.filter((c) => metrics.minchoBold.has(c)), inSans)
  for (const c of [0x100, 0x14c, 0x152, 0x153]) assert.ok(metrics.mincho.has(c), `U+${c.toString(16)}`)
})

test('一般の約物は元の書体にある字だけ入る(U+2010〜2027 と U+2030〜205E)', () => {
  const punct = [...range(0x2010, 0x2027), ...range(0x2030, 0x205e)]
  assert.equal(countIn('sans', punct), 32)
  assert.equal(countIn('sansBold', punct), 32)
  // Noto Serif JP はゴシックと同じ 32 字（Zen Old Mincho の頃は 22 字）
  assert.equal(countIn('mincho', punct), 32)
  assert.equal(countIn('minchoBold', punct), 32)
})

// ゴシックにあって明朝に無い字の集まり（cmap から求める）。今の fonts/ では 岸(U+5CB8) の 1 字だけ:
// 元の C:/Windows/Fonts/NotoSerifJP-VF.ttf（Version 2.02 non-release）に 岸 が無い。明朝の本文の 岸 はゴシックで描かれる
const SANS_ONLY = (() => {
  const inMincho = new Set(rawFontkit.create(bytes.mincho).characterSet)
  return rawFontkit.create(bytes.sans).characterSet.filter((c) => !inMincho.has(c))
})()

test('ゴシックにあって明朝に無い字は 岸 だけ（JIS 第 1 水準の字が明朝の元の書体に無い。書体を作り直したらこの試験を更新する）。どちらにも無い字(Ł)は両方で無い', () => {
  assert.deepEqual(SANS_ONLY.map((c) => String.fromCodePoint(c)), ['岸'])
  for (const c of SANS_ONLY) {
    assert.equal(metrics.mincho.has(c), false)
    assert.ok(Number.isNaN(metrics.mincho.adv(c)))
    assert.equal(metrics.sans.has(c), true)
  }
  // Ā は Noto Serif JP にある（Zen Old Mincho の頃は無かった）
  assert.equal(metrics.mincho.has(0x100), true)
  assert.equal(metrics.mincho.has(0x141) || metrics.sans.has(0x141), false)
})

test('足した字を含む語も合字にならず、字の数 = xs の数で、左端は右へ進む', () => {
  for (const id of IDS) {
    for (const text of ['café', 'Åäöü ñß', 'naïve “quoted” – dash…']) {
      const r = metrics[id].run(text)
      assert.equal(r.xs.length, [...text].length, `${id} ${text}`)
      for (let i = 1; i < r.xs.length; i++) assert.ok(r.xs[i] >= r.xs[i - 1], `${id} ${text} ${i}`)
    }
  }
})

test('今ある字の送り幅とカーニングは足した字で動かない(A・e・0・空白・読点・括弧と AV・Hello の幅は据え置き)', () => {
  // 2026-10-18 に今の fonts/（Noto Serif JP 400・Noto Sans JP 400）から読んだ値。次に書体を作り直した時に
  // 同じでなければ、日本語の文書の字の位置が動く（ゴシックは Zen の頃から据え置き。明朝は Zen の 0.756/0.482/0.615/0.28・AV 1.362・Hello 7.305 から替わった）
  const chars = ['A', 'e', '0', ' ', '、', '「']
  const want = { mincho: [0.718, 0.547, 0.557, 0.256, 1, 1], sans: [0.608, 0.554, 0.555, 0.224, 1, 1] }
  const run = { mincho: [1.314, 8.046], sans: [1.165, 7.609] }
  for (const id of ['mincho', 'sans']) {
    chars.forEach((ch, i) => assert.ok(Math.abs(metrics[id].adv(cp(ch)) - want[id][i]) < 1e-9, `${id} ${ch} ${metrics[id].adv(cp(ch))}`))
    assert.ok(Math.abs(metrics[id].run('AV').width - run[id][0]) < 1e-9, `${id} AV`)
    assert.ok(Math.abs(metrics[id].run('Hello, World 123').width - run[id][1]) < 1e-9, `${id} Hello`)
  }
})

// ---------- 太さの旗 ----------
test('Noto Sans JP の 700 は fsSelection の BOLD と head.macStyle の bold が立ち、400 は fsSelection の REGULAR が立つ', () => {
  const flags = (font) => {
    const buf = Buffer.from(font)
    const dir = tableDirectory(buf)
    return { sel: buf.readUInt16BE(dir.get('OS/2').offset + 62), mac: buf.readUInt16BE(dir.get('head').offset + 44), weight: buf.readUInt16BE(dir.get('OS/2').offset + 4) }
  }
  const BOLD = 0x20
  const REGULAR = 0x40
  const bold = flags(bytes.sansBold)
  assert.equal(bold.weight, 700)
  assert.ok(bold.sel & BOLD, 'fsSelection BOLD')
  assert.ok(!(bold.sel & REGULAR), 'fsSelection REGULAR は落ちている')
  assert.equal(bold.mac & 1, 1, 'macStyle bold')
  const regular = flags(bytes.sans)
  assert.equal(regular.weight, 400)
  assert.ok(regular.sel & REGULAR, 'fsSelection REGULAR')
  assert.ok(!(regular.sel & BOLD), 'fsSelection BOLD は落ちている')
  assert.equal(regular.mac & 1, 0, 'macStyle は bold でない')
})

test('Noto Serif JP の太さの旗は 400 が REGULAR・600(SemiBold・太字の役)が BOLD と macStyle bold で、usWeightClass は 400 と 600', () => {
  // build-fonts.mjs の serifFace は Regular 以外を bold 扱いにする。600 を 700 と名乗らせない（usWeightClass は切り出しの値のまま）
  for (const [font, bold, weight] of [[bytes.mincho, false, 400], [bytes.minchoBold, true, 600]]) {
    const buf = Buffer.from(font)
    const dir = tableDirectory(buf)
    const sel = buf.readUInt16BE(dir.get('OS/2').offset + 62)
    assert.equal(!!(sel & 0x20), bold)
    assert.equal(!!(sel & 0x40), !bold)
    assert.equal(buf.readUInt16BE(dir.get('head').offset + 44) & 1, bold ? 1 : 0)
    assert.equal(buf.readUInt16BE(dir.get('OS/2').offset + 4), weight)
  }
})

// ---------- フックが読めるファイルの大きさ ----------
test('割ったファイルはどれも 3 MiB 未満(base64 で 4 MiB の読み込みに収まる)で、つなぐと bytes になる', () => {
  for (const info of Object.values(manifest)) {
    let sum = 0
    for (const part of info.parts) {
      const size = fs.statSync(path.join(fontsDir, part)).size
      assert.ok(size < 3 * 1024 * 1024, `${part} ${size}`)
      assert.ok(Math.ceil(size / 3) * 4 < 4 * 1024 * 1024, `${part} の base64`)
      sum += size
    }
    assert.equal(sum, info.bytes)
  }
})

// ---------- 明朝に無い字は、その字だけゴシックで描く ----------
const NOW = Date.UTC(2026, 9, 9)
// 確かめる字は SANS_ONLY（今は 岸）から取る。書体を作り直して集まりが空になったら、本物では確かめられないので
// 明朝の has だけを偽にした stub（Ā を明朝に無い事にする）で代わりの書体の仕組みを確かめる
// next は直後に置く同じ系統の字（和字の後に欧文を置くと和欧間の空きが入り、送り幅だけでは次の字の位置を言えない）
const { ch: ALT_CH, next: ALT_NEXT, metrics: ALT_METRICS } = (() => {
  if (SANS_ONLY.length) return { ch: String.fromCodePoint(SANS_ONLY[0]), next: '次', metrics }
  const ch = String.fromCodePoint(0x100)
  const hide = (m) => ({ ...m, has: (c) => c !== 0x100 && m.has(c), adv: (c) => (c === 0x100 ? NaN : m.adv(c)) })
  return { ch, next: 'b', metrics: { ...metrics, mincho: hide(metrics.mincho), minchoBold: hide(metrics.minchoBold) } }
})()
/** 本文の段落 1 つ(と任意の見出し)を明朝で組み、頁 0 の字の op を返す */
function composeText(text, { heading } = {}) {
  const blocks = []
  if (heading) blocks.push({ type: 'heading', level: 2, text: [{ text: heading }] })
  blocks.push({ type: 'para', text: [{ text }] })
  const r = compose({ title: '代わりの書体', lang: 'ja', body: 'mincho', blocks }, { metrics: ALT_METRICS, images: {}, now: NOW })
  const ops = r.layout.pages[0].ops.filter((op) => op.t === 'text')
  return { ...r, ops }
}
const opWith = (ops, ch) => ops.find((op) => op.glyphs.some((g) => g.c === ch))
const glyphOf = (op, ch) => op.glyphs.find((g) => g.c === ch)

test('明朝に無い字(今は 岸)はゴシックで描き、字の箱は明朝の行の基線に乗る', () => {
  const { ops, layout, warnings } = composeText(`日本語${ALT_CH}${ALT_NEXT}日本語。`)
  const a = opWith(ops, ALT_CH)
  assert.equal(a.font, 'sans', `${ALT_CH} はゴシック`)
  const mincho = opWith(ops, '語')
  assert.equal(mincho.font, 'mincho')
  assert.equal(a.y, mincho.y, '同じ基線')
  assert.equal(a.size, mincho.size, '同じ大きさ')
  // 字の箱の幅はゴシックの送り幅。次の字(明朝)はその右に続く
  const next = glyphOf(opWith(ops, ALT_NEXT), ALT_NEXT)
  assert.ok(Math.abs(next.x - (glyphOf(a, ALT_CH).x + metrics.sans.adv(cp(ALT_CH)) * a.size)) < 1e-9, '次の字はゴシックの送り幅の後')
  assert.deepEqual(layout.stats.missingGlyphs, [])
  assert.deepEqual(warnings.filter((w) => w.includes('〓')), [])
})

test('明朝の太字に無い字はゴシックの太字で描く(見出しでも基線がそろう)', () => {
  const { ops } = composeText('本文', { heading: `見出し${ALT_CH}` })
  const a = opWith(ops, ALT_CH)
  assert.equal(a.font, 'sansBold')
  const head = opWith(ops, '見')
  assert.equal(head.font, 'minchoBold')
  assert.equal(a.y, head.y)
})

test('明朝に在る é と Ō は明朝のまま(足した字を代わりの書体に回さない)', () => {
  const { ops } = composeText('café Ōsaka 日本語。')
  assert.equal(opWith(ops, 'é').font, 'mincho')
  assert.equal(opWith(ops, 'Ō').font, 'mincho')
})

test('ゴシックにも無い Ł は〓にして、warnings と missingGlyphs に出す', () => {
  const { ops, layout, warnings } = composeText('日本語Łódź。')
  assert.equal(opWith(ops, 'Ł'), undefined)
  assert.ok(layout.stats.missingGlyphs.includes('Ł'))
  assert.ok(warnings.some((w) => w.includes('Ł') && w.includes('〓')), warnings.join('\n'))
})

test('ゴシックの本文でも明朝に無い字に回らず、Latin-1 の字は同じ書体で描く', () => {
  const r = compose({ title: 't', lang: 'ja', body: 'gothic', blocks: [{ type: 'para', text: [{ text: 'Ā café。' }] }] }, { metrics, images: {}, now: NOW })
  const ops = r.layout.pages[0].ops.filter((op) => op.t === 'text')
  assert.equal(opWith(ops, 'Ā').font, 'sans')
  assert.equal(opWith(ops, 'é').font, 'sans')
})
