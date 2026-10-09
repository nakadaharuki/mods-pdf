// @ts-check
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutRuby, parseRuby, RUBY_SCALE, splitOverhang } from '../hooks/engine/ruby.mjs'

/** 和字は 1em、ASCII は 0.5em の作り物の寸法 */
const m = { adv: (/** @type {number} */ cp) => (cp < 0x80 ? 0.5 : 1) }
const metrics = { mincho: m, minchoBold: m, sans: m, sansBold: m }
const SIZE = 10
const lay = (/** @type {string} */ base, /** @type {string} */ ruby, /** @type {{ overL?: number, overR?: number }} */ over = {}) => layoutRuby(base, ruby, { size: SIZE, font: 'mincho', metrics, ...over })
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

test('ルビが親字より長い分は slack に出る。短いルビは 0', () => {
  assert.deepEqual(lay('東京', 'とうきょう').slack, { left: 5, right: 5, total: 5 })
  assert.deepEqual(lay('錨', 'いかり').slack, { left: 5, right: 5, total: 5 })
  assert.deepEqual(lay('漢字', 'かんじ').slack, { left: 0, right: 0, total: 0 })
  assert.deepEqual(lay('漢字', 'かん|じ').slack, { left: 0, right: 0, total: 0 })
  assert.deepEqual(lay('東京', 'とう|きょう').slack, { left: 0, right: 5, total: 5 }, 'モノルビは両端の持ち場ごと')
})

test('前後の字に掛ける量を渡すと、ルビの位置と塊の幅は変えずに、親字をその分内側へ寄せ、字間に配る分を減らす', () => {
  const none = lay('錨', 'いかり')
  near(none.width, 15)
  near(none.baseXs[0], 2.5, 'ルビの中央')
  const both = lay('錨', 'いかり', { overL: 2.5, overR: 2.5 })
  near(both.width, 15, '塊の幅は変わらない')
  near(both.baseXs[0], 2.5)
  assert.deepEqual(both.ruby, none.ruby, 'ルビの位置は変わらない')
  near(lay('錨', 'いかり', { overL: 5 }).baseXs[0], 5, '左へ全部掛けると親字は右端')
  near(lay('錨', 'いかり', { overR: 5 }).baseXs[0], 0, '右へ全部掛けると親字は左端')
  near(lay('錨', 'いかり', { overL: 100, overR: 100 }).baseXs[0], 5, '余りを超える分は切る（左が先に取る）')
  const two = lay('東京', 'とうきょう', { overL: 2.5, overR: 2.5 })
  near(two.baseXs[0], 2.5)
  near(two.baseXs[1], 12.5, '余りが無くなって字間は 0')
  const half = lay('東京', 'とうきょう', { overL: 2.5 })
  near(half.baseXs[1] - half.baseXs[0] - SIZE, 1.25, '掛けても残る 2.5pt を字数 2 で割った単位が字の間に')
  near(half.baseXs[0], 2.5 + 0.625)
})

test('モノルビは両端の持ち場の親字だけを、掛ける側から離して内側へ寄せる', () => {
  const none = lay('東京', 'とう|きょう')
  near(none.baseXs[1], 12.5, '持ち場の中央')
  near(lay('東京', 'とう|きょう', { overR: 2.5 }).baseXs[1], 12.5, '中央の余白で足りる分は動かさない')
  near(lay('東京', 'とう|きょう', { overR: 5 }).baseXs[1], 10, '右へ 5pt 掛けるなら親字は持ち場の左端')
  near(lay('東京', 'とう|きょう', { overL: 5 }).baseXs[0], 0, '東のルビは親字と同じ長さで掛けられない')
  near(lay('東京', 'とう|きょう', { overR: 5 }).width, 25, '塊の幅は変わらない')
})

test('splitOverhang: 両側に掛けられれば半分ずつ、片側だけならその側が余りを全部取り、上限は超えない', () => {
  const slack = { left: 5, right: 5, total: 5 }
  assert.deepEqual(splitOverhang(slack, 5, 5), { left: 2.5, right: 2.5 })
  assert.deepEqual(splitOverhang(slack, 0, 5), { left: 0, right: 5 })
  assert.deepEqual(splitOverhang(slack, 5, 0), { left: 5, right: 0 })
  assert.deepEqual(splitOverhang(slack, 0, 0), { left: 0, right: 0 })
  assert.deepEqual(splitOverhang(slack, 1, 5), { left: 1, right: 4 }, '左の上限が小さければ右が多く取る')
  assert.deepEqual(splitOverhang(slack, 5, 1), { left: 4, right: 1 })
  assert.deepEqual(splitOverhang(slack, 1, 1), { left: 1, right: 1 }, '上限に届かない分は掛けず、字間へ')
  assert.deepEqual(splitOverhang({ left: 0, right: 0, total: 0 }, 5, 5), { left: 0, right: 0 }, '短いルビは掛けない')
  assert.deepEqual(splitOverhang({ left: 0, right: 5, total: 5 }, 5, 5), { left: 0, right: 5 }, 'モノルビは持ち場ごと')
  assert.deepEqual(splitOverhang({ left: 8, right: 2, total: 10 }, 8, 2), { left: 8, right: 2 })
})
