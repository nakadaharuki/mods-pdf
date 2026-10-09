// @ts-check
// 日本語の見本の字の位置が、test/snapshots/ja-<見本>.json の記録と同じであること。
// 英語の直しで日本語の組みが動いていないことの守り。意図して日本語の組みを変えた時は
// node scripts/ja-snapshot.mjs --write で記録を書き直し、差分を読んでからコミットする。
import test from 'node:test'
import assert from 'node:assert/strict'
import { JA_SAMPLES, buildSnapshot, firstDifference, linesOfLayout, readSnapshot, round3, serialize, snapshotPath } from '../scripts/ja-snapshot.mjs'

for (const name of JA_SAMPLES) {
  test(`日本語の見本 ${name} の字の位置が記録と同じ`, async () => {
    const expected = readSnapshot(name)
    assert.ok(expected, `記録が無い: ${snapshotPath(name)}。node scripts/ja-snapshot.mjs --write --only ${name} で作る`)
    const { snapshot } = await buildSnapshot(name)
    const diff = firstDifference(expected, snapshot)
    assert.equal(diff, null, `\n${diff}`)
  })
}

test('字の位置の比べは 1 字の x の 0.001pt の違いも見つけ、違う字の前後の x を言う', () => {
  const base = { sample: 't', lang: 'ja-JP', page: /** @type {[number, number]} */ ([100, 200]), pages: [[{ y: 10, font: 'mincho', size: 10, text: '日本語', x: [0, 10, 20] }]] }
  assert.equal(firstDifference(base, structuredClone(base)), null)
  const moved = structuredClone(base)
  moved.pages[0][0].x[1] = 10.001
  const msg = firstDifference(base, moved) ?? ''
  assert.match(msg, /頁 1 の 1 行目/)
  assert.match(msg, /2 字目/)
  assert.match(msg, /前 「日」x=0 \/ 「本」x=10 \/ 後 「語」x=20/)
  assert.match(msg, /今: {3}前 「日」x=0 \/ 「本」x=10.001 \/ 後 「語」x=20/)
})

test('字の位置の比べは行や頁が増えても減っても違うと言う', () => {
  const line = { y: 10, font: 'mincho', size: 10, text: 'あ', x: [0] }
  const base = { sample: 't', lang: 'ja-JP', page: /** @type {[number, number]} */ ([100, 200]), pages: [[line]] }
  assert.match(firstDifference(base, { ...base, pages: [[line, { ...line, y: 20 }]] }) ?? '', /行の数が違う/)
  assert.match(firstDifference(base, { ...base, pages: [[line], [line]] }) ?? '', /頁数が違う/)
  assert.match(firstDifference(base, { ...base, pages: [[{ ...line, size: 11 }]] }) ?? '', /書体が違う/)
})

test('組んだ字は y と書体と大きさが同じ物が 1 行になり、Op の割れ方に左右されない', () => {
  const op = (/** @type {number} */ y, /** @type {string} */ c, /** @type {number} */ x, extra = {}) => ({ t: 'text', font: 'mincho', size: 10, color: '#111111', y, glyphs: [{ c, x }], ...extra })
  const split = linesOfLayout({ pages: [{ ops: [op(20, 'い', 10, { tag: 3 }), op(20, 'あ', 0.00049), { t: 'rule' }, op(10, 'う', 5)] }] })
  const whole = linesOfLayout({ pages: [{ ops: [{ t: 'text', font: 'mincho', size: 10, color: '#000000', y: 20, glyphs: [{ c: 'あ', x: 0 }, { c: 'い', x: 10 }] }, op(10, 'う', 5)] }] })
  assert.deepEqual(split, whole)
  assert.deepEqual(split[0].map((l) => [l.y, l.text, l.x]), [[10, 'う', [5]], [20, 'あい', [0, 10]]])
  assert.equal(round3(-0.0001), 0)
  assert.ok(!Object.is(round3(-0.0001), -0))
})

test('記録の JSON は 1 行 1 本で書き、読み戻すと同じになる', () => {
  const s = { sample: 't', lang: 'ja-JP', page: /** @type {[number, number]} */ ([100, 200]), pages: [[{ y: 1, font: 'sans', size: 8, text: '😀a', x: [0, 8.5] }], []] }
  const text = serialize(s)
  assert.deepEqual(JSON.parse(text), s)
  assert.equal(text.split('\n').filter((l) => l.includes('"text"')).length, 1)
})
