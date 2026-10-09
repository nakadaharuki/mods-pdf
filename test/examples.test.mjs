// 道具 pdf_examples の中身（hooks/lib/examples.mjs）の試験。目録・見本は repo の物を読む。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runExamples, searchCatalog, EXAMPLES_TOOL } from '../hooks/lib/examples.mjs'
import { resetChartAssets } from '../hooks/engine/chart.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const io = { root, read: (p) => fs.promises.readFile(p, 'utf8') }
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'echarts', 'catalog.json'), 'utf8'))
const ids = (text) => text.split('\n').slice(1).map((l) => l.split('｜')[0])

test('道具の定義は名前 pdf_examples と、読むだけの引数（query・series・category・paper・limit・id）を持つ', () => {
  assert.equal(EXAMPLES_TOOL.name, 'pdf_examples')
  assert.deepEqual(Object.keys(EXAMPLES_TOOL.inputSchema.properties).sort(), ['category', 'id', 'limit', 'paper', 'query', 'series'])
  assert.ok(EXAMPLES_TOOL.description.includes('example'))
  assert.equal(EXAMPLES_TOOL.inputSchema.additionalProperties, false)
})

test('引数が無ければ、見本の本数と series・category の一覧を返す', async () => {
  const r = await runExamples({}, io)
  assert.ok(r.result.includes(`見本 ${catalog.length} 本`))
  assert.ok(r.result.includes('series:') && r.result.includes('bar(') && r.result.includes('category:'))
})

test('語で引くと、語を全部含む見本だけが当たり、id に当たった物が先に来る', async () => {
  const r = await runExamples({ query: 'stack bar' }, io)
  const found = ids(r.result)
  assert.ok(found.length > 0)
  for (const id of found) {
    const row = catalog.find((c) => c.id === id)
    const hay = `${row.id} ${row.title} ${row.titleCN} ${row.category} ${row.series} ${row.component}`.toLowerCase()
    assert.ok(hay.includes('stack') && hay.includes('bar'), id)
  }
  assert.ok(found[0].includes('stack') && found[0].includes('bar'), found[0])
})

test('series と category と paper で絞れる', async () => {
  const r = await runExamples({ series: 'sankey', paper: true }, io)
  const found = ids(r.result)
  assert.ok(found.length >= 1)
  for (const id of found) {
    const row = catalog.find((c) => c.id === id)
    assert.ok(row.series.includes('sankey') && row.flags.paper, id)
  }
  const cat = await runExamples({ category: 'pie' }, io)
  for (const id of ids(cat.result)) assert.ok(catalog.find((c) => c.id === id).category.includes('pie'), id)
})

test('日本語の語（積み上げ・円など）は英語の語に直して引ける', async () => {
  const stack = ids((await runExamples({ query: '積み上げ' }, io)).result)
  assert.ok(stack.length > 0 && stack.some((i) => i.includes('stack')))
  const pie = ids((await runExamples({ query: '円', limit: 30 }, io)).result)
  assert.ok(pie.length > 0 && pie.some((i) => i.startsWith('pie')))
})

test('答えは最大 30 件で、多ければ先頭の件数を知らせる。limit は 1〜30 に収まる', async () => {
  const many = await runExamples({ series: 'bar', limit: 999 }, io)
  assert.equal(ids(many.result).length, 30)
  assert.ok(many.result.split('\n')[0].includes('先頭 30 件'))
  const one = await runExamples({ series: 'bar', limit: 0 }, io)
  assert.equal(ids(one.result).length, 1)
})

test('当たる物が無い時は、その旨を返す（投げない）', async () => {
  const r = await runExamples({ query: 'zzzzqqqq' }, io)
  assert.ok(r.result.includes('当たる見本がありません'))
})

test('id を渡すと、その見本の option の JSON と使い方を返す。JSON は読み直せる', async () => {
  const r = await runExamples({ id: 'bar-simple' }, io)
  assert.ok(r.result.includes('id: bar-simple') && r.result.includes('"example": "bar-simple"'))
  const json = r.result.slice(r.result.indexOf('option:') + 'option:'.length).trim()
  const option = JSON.parse(json)
  assert.equal(option.series[0].type, 'bar')
})

test('知らない id は「ありません」と返し、形の悪い id は断る', async () => {
  assert.ok((await runExamples({ id: 'no-such-example' }, io)).result.includes('ありません'))
  assert.ok('deny' in (await runExamples({ id: '../../etc/passwd' }, io)))
  assert.ok('deny' in (await runExamples({ id: 'a b' }, io)))
})

test('目録を読めなければ、理由を返して投げない', async () => {
  resetChartAssets()
  const r = await runExamples({ query: 'bar' }, { root: '/nowhere', read: async () => { throw new Error('ENOENT') } })
  assert.ok(r.result.includes('読めませんでした'), r.result)
  resetChartAssets()
})

test('searchCatalog: 並びは強さの順、同じ強さは paper を前に、さらに id の順', () => {
  const rows = searchCatalog(
    [
      { id: 'b', title: 'x', titleCN: '', category: [], series: ['bar'], component: [], flags: {} },
      { id: 'a', title: 'x', titleCN: '', category: [], series: ['bar'], component: [], flags: {} },
      { id: 'c', title: 'x', titleCN: '', category: [], series: ['bar'], component: [], flags: { paper: true } },
      { id: 'bar-d', title: 'x', titleCN: '', category: [], series: ['bar'], component: [], flags: {} },
    ],
    { query: 'bar' },
  )
  assert.deepEqual(rows.map((r) => r.id), ['bar-d', 'c', 'a', 'b'])
})
