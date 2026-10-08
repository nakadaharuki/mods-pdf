// @ts-check
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutRuby, parseRuby, RUBY_SCALE } from '../hooks/engine/ruby.mjs'

/** 和字は 1em、ASCII は 0.5em の作り物の寸法 */
const m = { adv: (/** @type {number} */ cp) => (cp < 0x80 ? 0.5 : 1) }
const metrics = { mincho: m, minchoBold: m, sans: m, sansBold: m }
const SIZE = 10
const lay = (/** @type {string} */ base, /** @type {string} */ ruby) => layoutRuby(base, ruby, { size: SIZE, font: 'mincho', metrics })
const near = (/** @type {number} */ a, /** @type {number} */ b, msg = '') => assert.ok(Math.abs(a - b) < 1e-9, `${msg} ${a} と ${b}`)

test('ルビの字は親字の 0.5 倍の大きさになる', () => {
  assert.equal(RUBY_SCALE, 0.5)
  assert.equal(lay('漢字', 'かんじ').rubySize, SIZE / 2)
})

test('ルビが親字より短いグループルビは、ルビの並びの中心を親字の並びの中心に合わせる', () => {
  const r = lay('漢字', 'かんじ')
  near(r.width, 20)
  assert.deepEqual(r.baseXs, [0, 10])
  assert.equal(r.mono, false)
  assert.deepEqual(r.ruby.map((g) => g.c), ['か', 'ん', 'じ'])
  near(r.ruby[0].x, 2.5, '1 つ目のルビの位置')
  near(r.ruby[2].x + 5, 17.5, 'ルビの右端')
  const rubyCenter = (r.ruby[0].x + r.ruby[2].x + 5) / 2
  near(rubyCenter, 10, 'ルビの中心 = 親字の中心')
})

test('ルビが親字より長いグループルビは、親字の字間を均等に開けて幅をルビに合わせる', () => {
  const r = lay('東京', 'とうきょう')
  near(r.width, 25, 'ルビの幅になる')
  // 余りは 5pt を字数 2 で割った 2.5pt が単位。両端に半分ずつ・字の間に 1 つ分
  near(r.baseXs[0], 1.25)
  near(r.baseXs[1], 10 + 3.75)
  near(r.baseXs[1] - r.baseXs[0] - 10, 2.5, '字の間に 1 単位')
  near(r.baseXs[0], 2.5 / 2, '左端に半単位')
  near(25 - (r.baseXs[1] + 10), 2.5 / 2, '右端に半単位')
  assert.deepEqual(r.ruby.map((g) => g.x), [0, 5, 10, 15, 20], 'ルビは左端から詰めて並ぶ')
})

test('親字が 1 字でルビが長い時は、親字をルビの中央に置く', () => {
  const r = lay('東', 'とうきょう')
  near(r.width, 25)
  near(r.baseXs[0], 7.5)
})

test('縦棒で区切ったルビはモノルビで、親字 1 字ずつの持ち場に置く', () => {
  const r = lay('漢字', 'かん|じ')
  assert.equal(r.mono, true)
  near(r.width, 20)
  assert.deepEqual(r.baseXs, [0, 10])
  assert.deepEqual(r.ruby.map((g) => g.c), ['か', 'ん', 'じ'], '縦棒はルビの字に入らない')
  near(r.ruby[0].x, 0)
  near(r.ruby[1].x, 5)
  near(r.ruby[2].x, 12.5, '短いルビは自分の親字の中央')
})

test('モノルビで 1 字のルビが親字より長い時は、その字だけ持ち場を広げる', () => {
  const r = lay('東京', 'とう|きょう')
  assert.equal(r.mono, true)
  near(r.width, 10 + 15)
  near(r.baseXs[0], 0)
  near(r.baseXs[1], 10 + 2.5, '広げた持ち場の中央に親字')
  assert.deepEqual(r.ruby.map((g) => g.x), [0, 5, 10, 15, 20])
})

test('全角の縦棒でもモノルビになる', () => {
  const r = lay('漢字', 'かん｜じ')
  assert.equal(r.mono, true)
})

test('縦棒で区切った数が親字の数と違う時は、棒を取ったグループルビにする', () => {
  const r = lay('漢字', 'か|ん|じ')
  assert.equal(r.mono, false)
  assert.deepEqual(r.ruby.map((g) => g.c), ['か', 'ん', 'じ'])
  assert.deepEqual(parseRuby('か|ん|じ', 2), { mono: false, segments: ['かんじ'] })
  assert.deepEqual(parseRuby('かん|じ', 2), { mono: true, segments: ['かん', 'じ'] })
  assert.deepEqual(parseRuby('かんじ', 2), { mono: false, segments: ['かんじ'] })
})

test('ルビが空なら親字の幅のまま', () => {
  const r = lay('漢字', '')
  near(r.width, 20)
  assert.equal(r.ruby.length, 0)
})

test('親字に欧文があれば、その送り幅で並べる', () => {
  // 親字 A・B は 5pt ずつで計 10pt、ルビ 4 字は 20pt。余り 10pt を字数 2 で割った 5pt が単位
  const r = lay('AB', 'えいびー')
  near(r.width, 20, 'ルビ 4 字 × 5pt')
  near(r.baseXs[0], 2.5)
  near(r.baseXs[1], 5 + 5 * 1.5)
})

test('書体に無い字の送り幅は欧文なら半角・それ以外は全角に見立てる', () => {
  const nan = { adv: () => NaN }
  const r = layoutRuby('漢a', 'かん', { size: SIZE, font: 'mincho', metrics: { mincho: nan } })
  near(r.width, 15, '漢 10 + a 5')
})
