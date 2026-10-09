// 表のセルのロゴ（table.mjs）の試験。本物の書体で、tableItem を直に呼ぶ（schema が logo を通すかに頼らない）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { makeEnv } from '../hooks/engine/lay-text.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { tableItem } from '../hooks/engine/table.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const readBase64 = async (rel) => fs.readFileSync(path.join(fontsDir, rel)).toString('base64')
const metrics = makeMetrics(await loadFontBytes(FONT_IDS, manifest, readBase64, new Map()))
const theme = makeTheme({})

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#cc0000"/></svg>'
const LOGO_FILL = '#cc0000'
const logos = { 'NYSE:TEST': LOGO }
const T = (text, extra = {}) => [{ text, ...extra }]

const flat = (ops) => ops.flatMap((op) => (op.t === 'clip' ? flat(op.ops) : [op]))
/** ロゴの箱の左右（pt）。四角か path の x を拾う */
function xRange(op) {
  if (op.t === 'rect') return [op.x, op.x + op.w]
  const xs = String(op.d).match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0)
  return [Math.min(...xs), Math.max(...xs)]
}
const isLogoOp = (op) => (op.fill ?? '').toLowerCase() === LOGO_FILL
const glyphBox = (op) => op.glyphs.map((g) => [g.x, g.x + op.size])
const textOps = (ops) => flat(ops).filter((o) => o.t === 'text')
const textLeft = (ops, text) => Math.min(...textOps(ops).filter((o) => o.glyphs.map((g) => g.c).join('').startsWith(text)).map((o) => o.glyphs[0].x))

/** 表を組んで、emit の ops と env を返す */
function run(block, map = logos) {
  const env = makeEnv({ theme, metrics, phrase: phraseBoundaries })
  if (map) env.logos = map
  const item = tableItem(env, block)
  const ops = []
  item.emit({ ops, y0: 100, row0: 0, page: 0, a: 0, b: item.n, trim: 0 })
  return { env, item, ops }
}
const table = (rows, extra = {}) => ({ type: 'table', head: [T('会社'), T('説明')], rows, align: ['left', 'left'], ...extra })

test('ロゴの箱は字の左に置かれ、字は箱の右から始まる', () => {
  const { ops } = run(table([[T('IBM', { logo: 'NYSE:TEST' }), T('説明')]]))
  const logo = flat(ops).filter(isLogoOp)
  assert.ok(logo.length > 0, 'ロゴが描かれる')
  const right = Math.max(...logo.map((o) => xRange(o)[1]))
  assert.ok(textLeft(ops, 'IBM') >= right, `字 ${textLeft(ops, 'IBM')} はロゴの右端 ${right} より右`)
  assert.ok(Math.min(...logo.map((o) => xRange(o)[0])) >= theme.left, 'ロゴは版面の左端より右')
})

test('ロゴの分だけ列が広がり、ロゴと字は列の中に収まる', () => {
  const longName = '株式会社とても長い名前のカブシキガイシャ'
  const rows = (logo) => [[T(longName, logo ? { logo: 'NYSE:TEST' } : {}), T('説明が入ります')]]
  const w = run(table(rows(true)))
  const wo = run(table(rows(false)))
  const limit = (r) => textLeft(r.ops, '説明が入ります') - 4
  assert.ok(limit(w) > limit(wo), `ロゴ付きの列 ${limit(w)} は付かない列 ${limit(wo)} より広い`)
  const logo = flat(w.ops).filter(isLogoOp)
  const right = Math.max(...logo.map((o) => xRange(o)[1]))
  assert.ok(right <= limit(w))
  for (const op of textOps(w.ops)) {
    const first = op.glyphs[0].x
    if (first >= limit(w)) continue
    for (const [, r] of glyphBox(op)) assert.ok(r <= limit(w) + 0.01, `字の右端 ${r} が列の右端 ${limit(w)} を越える`)
  }
})

test('折り返したセルでも、ロゴは 1 行目の左にだけ付き、2 行目以降の字も箱の右から始まる', () => {
  const name = '株式会社とても長い名前のカブシキガイシャでございます'
  const { ops } = run(table([[T(name, { logo: 'NYSE:TEST' }), T('説明')]], { widths: [0.3, 0.7] }))
  const logo = flat(ops).filter(isLogoOp)
  assert.equal(logo.length > 0, true)
  const right = Math.max(...logo.map((o) => xRange(o)[1]))
  const lines = textOps(ops).filter((o) => o.glyphs.length > 1 && o.glyphs[0].x < theme.left + 0.3 * theme.measure)
  const body = lines.filter((o) => o.y > 100 + 20)
  assert.ok(body.length >= 2, '折り返す')
  for (const o of body) assert.ok(o.glyphs[0].x >= right - 0.01)
})

test('数字の列（右寄せ）のセルでも、ロゴと字が 1 つの塊として列の右端に寄る', () => {
  const { ops } = run({ type: 'table', head: [T('社'), T('株価')], rows: [[T('A'), T('1,234', { logo: 'NYSE:TEST' })], [T('B'), T('99')]] })
  const logo = flat(ops).filter(isLogoOp)
  const right = Math.max(...logo.map((o) => xRange(o)[1]))
  const left = Math.min(...logo.map((o) => xRange(o)[0]))
  const price = textOps(ops).find((o) => o.glyphs.map((g) => g.c).join('') === '1,234')
  assert.ok(price.glyphs[0].x >= right, '字はロゴの右')
  const rowRight = theme.left + theme.measure - 4
  assert.ok(Math.abs(price.glyphs.at(-1).x + 0.5 * price.size - rowRight) < price.size, '塊の右端は列の右端に近い')
  assert.ok(left > theme.left + theme.measure / 2)
})

test('字の無いセルでもロゴだけが描かれる', () => {
  const { ops } = run(table([[[{ text: '', logo: 'NYSE:TEST' }], T('説明')]]))
  assert.ok(flat(ops).filter(isLogoOp).length > 0)
})

test('セルを { text, logo } の形で渡しても同じに描く', () => {
  const a = run(table([[T('IBM', { logo: 'NYSE:TEST' }), T('説明')]]))
  const b = run(table([[{ text: T('IBM'), logo: 'NYSE:TEST' }, T('説明')]]))
  assert.deepEqual(b.ops, a.ops)
})

test('表の頭の行のセルにもロゴを付けられる', () => {
  const { ops } = run({ type: 'table', head: [T('IBM', { logo: 'NYSE:TEST' }), T('説明')], rows: [[T('a'), T('b')]], align: ['left', 'left'] })
  assert.ok(flat(ops).filter(isLogoOp).length > 0)
})

test('ロゴの表に無い logo は、logo の無い表と同じに字だけで組む', () => {
  const withKey = run(table([[T('IBM', { logo: 'NYSE:NOPE' }), T('説明')]]))
  const without = run(table([[T('IBM'), T('説明')]]))
  assert.deepEqual(withKey.ops, without.ops)
  assert.deepEqual(withKey.env.warnings, [])
})

test('logos を渡さなければ、logo の字があっても字だけで組む', () => {
  const a = run(table([[T('IBM', { logo: 'NYSE:TEST' }), T('説明')]]), null)
  const b = run(table([[T('IBM'), T('説明')]]), null)
  assert.deepEqual(a.ops, b.ops)
})

test('ロゴの無い表は、logos を渡しても組みが変わらない', () => {
  const rows = [[T('山田'), T('1,200')], [T('鈴木'), T('85')]]
  const a = run({ type: 'table', head: [T('名前'), T('金額')], rows }, null)
  const b = run({ type: 'table', head: [T('名前'), T('金額')], rows }, logos)
  assert.deepEqual(b.ops, a.ops)
  assert.deepEqual(b.item.rowsOf(0, b.item.n), a.item.rowsOf(0, a.item.n))
})

test('大きすぎるロゴは描かず、警告を 1 つ出して字だけで組む', () => {
  const big = { 'NYSE:BIG': `<svg viewBox="0 0 10 10">${'<path d="M0 0L1 1" fill="#cc0000"/>'.repeat(4000)}</svg>` }
  const a = run(table([[T('IBM', { logo: 'NYSE:BIG' }), T('説明')], [T('X', { logo: 'NYSE:BIG' }), T('説明')]]), big)
  assert.equal(flat(a.ops).filter(isLogoOp).length, 0)
  assert.equal(a.env.warnings.filter((w) => w.includes('NYSE:BIG')).length, 1)
})

test('layout が env に載せるまでは、theme に載せた logos でも表に届く', () => {
  const env = makeEnv({ theme: { ...theme, logos }, metrics, phrase: phraseBoundaries })
  const item = tableItem(env, table([[T('IBM', { logo: 'NYSE:TEST' }), T('説明')]]))
  const ops = []
  item.emit({ ops, y0: 100, row0: 0, page: 0, a: 0, b: item.n, trim: 0 })
  assert.ok(flat(ops).some(isLogoOp))
})

test('ロゴの図は飾りで、tag を持たない', () => {
  const { ops } = run(table([[T('IBM', { logo: 'NYSE:TEST' }), T('説明')]]))
  for (const op of flat(ops).filter(isLogoOp)) assert.equal(op.tag, undefined)
})

test('compose の logos は表に届く（schema が logo を通す時）', (t) => {
  const input = { title: 't', blocks: [{ type: 'table', head: ['会社', '説明'], rows: [[{ text: 'IBM', logo: 'NYSE:TEST' }, '説明']] }] }
  const kept = JSON.stringify(normalize(input).doc.blocks).includes('NYSE:TEST')
  if (!kept) return t.skip('schema がまだ logo を通さない')
  const r = compose(input, { metrics, phrase: phraseBoundaries, now: 0, logos })
  assert.ok(r.layout.pages.flatMap((p) => flat(p.ops)).some(isLogoOp))
  const plain = compose(input, { metrics, phrase: phraseBoundaries, now: 0 })
  assert.equal(plain.layout.pages.flatMap((p) => flat(p.ops)).some(isLogoOp), false)
})

test('logos を渡さない compose の組みは、渡した compose の組みから logo を抜いた物と同じ', () => {
  const input = { title: 't', blocks: [{ type: 'table', head: ['名前', '金額'], rows: [['山田', '1,200'], ['鈴木', '85']] }] }
  const a = compose(input, { metrics, phrase: phraseBoundaries, now: 0 })
  const b = compose(input, { metrics, phrase: phraseBoundaries, now: 0, logos })
  assert.deepEqual(b.layout, a.layout)
})
