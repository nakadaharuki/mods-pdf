// 書体の読み込みと寸法の試験。本物の書体 4 つを 1 回だけ読んで使い回す（遅くしない）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FILES, loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { rawFontkit } from '../hooks/vendor/pdf.mjs'

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
  const reads = []
  const counting = async (rel) => { reads.push(rel); return readBase64(rel) }
  const cache = new Map()
  await loadFontBytes(['mincho', 'sans'], manifest, counting, cache)
  assert.deepEqual(reads, ['ZenOldMincho-JIS-400.ttf.0', 'ZenOldMincho-JIS-400.ttf.1', 'NotoSansJP-JIS-400.ttf'])
  reads.length = 0
  await loadFontBytes(['sans', 'mincho', 'minchoBold'], manifest, counting, cache)
  assert.deepEqual(reads, ['ZenOldMincho-JIS-700.ttf.0', 'ZenOldMincho-JIS-700.ttf.1'])
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

test('ASCII の A の送り幅は 0.5〜0.8em（明朝はおよそ 0.76・ゴシックはおよそ 0.61）', () => {
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
