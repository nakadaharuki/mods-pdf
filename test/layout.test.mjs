// layout（Doc を頁に組む）の試験。本物の書体を 1 回だけ読んで使い回す。
import test from 'node:test'
import { fastest, fmtTimes } from './helpers/timing.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { allocate } from '../hooks/engine/table.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const readBase64 = async (rel) => fs.readFileSync(path.join(fontsDir, rel)).toString('base64')
const bytes = await loadFontBytes(FONT_IDS, manifest, readBase64, new Map())
const metrics = makeMetrics(bytes)

const NOW = new Date(2026, 9, 9, 12).getTime()
const theme = makeTheme({})
const T = (t) => [{ text: t }]
const build = (input, images = {}) => compose(input, { metrics, images, phrase: phraseBoundaries, now: NOW })
const flat = (ops) => ops.flatMap((op) => (op.t === 'clip' ? flat(op.ops) : [op]))
const textOf = (op) => op.glyphs.map((g) => g.c).join('')
const allOps = (layout) => layout.pages.flatMap((p) => flat(p.ops))
const roleOf = (layout, op) => (op.tag === undefined ? undefined : layout.tags[op.tag].role)
const isGrid = (y) => Array.from({ length: theme.lines }, (_, i) => theme.baseline(i)).some((b) => Math.abs(b - y) < 1e-9)

/** 決まった順に文を並べて、だいたい n 字の本文を作る（乱数を使わない） */
const SENTENCES = [
  '吾輩は猫である。', '名前はまだ無い。', 'どこで生れたかとんと見当がつかぬ。', '何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。',
  '吾輩はここで始めて人間というものを見た。', 'しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。', 'この書生というのは時々我々を捕えて煮て食うという話である。',
]
function body(n, seed = 0) {
  let s = ''
  let i = seed
  while (s.length < n) s += SENTENCES[i++ % SENTENCES.length]
  return s.slice(0, n)
}

/** 段落ごとの、頁ごとの行の y の集合 */
function linesByPage(layout, tag) {
  /** @type {Map<number, Set<number>>} */
  const out = new Map()
  layout.pages.forEach((pg, i) => {
    for (const op of flat(pg.ops)) {
      if (op.tag !== tag || op.t !== 'text') continue
      if (!out.has(i)) out.set(i, new Set())
      out.get(i).add(op.y)
    }
  })
  return out
}

/** 1×1 の PNG（zlib と CRC で作る） */
function tinyPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.from([0, 255, 0, 0, 0, 0, 255])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}
const IMAGES = { 'a.png': { kind: 'png', base64: tinyPng(), width: 2, height: 1 } }

/** 全部の種類のブロックを含む文書 */
function richInput() {
  const blocks = [
    { type: 'heading', level: 1, text: T('第一章 概要') },
    { type: 'para', text: [{ text: '吾輩は' }, { text: '猫', ruby: 'ねこ' }, { text: 'である。' }, { text: '太字', bold: true }, { text: 'と' }, { text: 'code', code: true }, { text: 'と' }, { text: 'リンク', link: 'https://example.com/a' }, { text: 'を含む。' + body(200) }] },
    { type: 'heading', level: 2, text: T('箇条書き') },
    { type: 'list', ordered: false, items: [T('一つ目 ' + body(80)), { text: T('二つ目'), items: [T('入れ子 ' + body(40))], ordered: true }, T('三つ目')] },
    { type: 'list', ordered: true, items: [T('第一'), T('第二')] },
    { type: 'heading', level: 3, text: T('表') },
    { type: 'table', head: [T('項目'), T('金額'), T('前年比')], rows: [[T('売上'), T('1,234円'), T('+1.5%')], [T('利益'), T('▲45円'), T('▲3.2%')]] },
    { type: 'quote', text: T('引用の文。' + body(100)) },
    { type: 'rule' },
    { type: 'keys', items: [{ label: '売上', value: '1,234円', note: '前年比 +12%' }, { label: '利益', value: '▲45円' }, { label: '件数', value: '320件' }] },
    { type: 'card', label: '補足', text: T('囲みの文。' + body(120)) },
    { type: 'chart', option: { xAxis: { type: 'category', data: ['1月', '2月', '3月'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [120, 200, 150] }] }, caption: '月別の売上' },
    { type: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="5" y="5" width="90" height="40" fill="#cccccc"/><text x="50" y="30" font-size="12" text-anchor="middle">図</text></svg>', alt: '四角の図', height: 100 },
    { type: 'image', path: 'a.png', alt: '小さな画像', caption: '画像の題' },
    { type: 'fields', items: [{ kind: 'text', name: 'name', label: 'お名前', value: '森田 一郎' }, { kind: 'check', name: 'ok', label: '同意する', value: true }, { kind: 'multiline', name: 'memo', label: 'メモ' }, { kind: 'choice', name: 'pick', label: '選択', options: ['甲', '乙'] }] },
    { type: 'pagebreak' },
    { type: 'para', text: T(body(300, 3)) },
  ]
  return { title: '全部入りの文書', author: '森田', blocks }
}

test('FONT_IDS は 4 つの書体の名前', () => {
  assert.deepEqual(FONT_IDS, ['mincho', 'minchoBold', 'sans', 'sansBold'])
})

test('title が無いと compose は投げる', () => {
  assert.throws(() => build({ blocks: [] }), /title/)
})

test('空の文書でも題名の塊だけの 1 頁を組む', () => {
  const { layout, warnings } = build({ title: '題だけ' })
  assert.equal(layout.pages.length, 1)
  assert.equal(layout.tags[0].role, 'Document')
  assert.equal(layout.tags[0].parent, null)
  assert.ok(warnings.some((w) => w.includes('空の文書')))
})

test('題名の塊: 18pt 明朝の太字・下に 1.4pt の ink の罫・author と日付（2026年10月9日）・題名は H1 で outline の最初', () => {
  const { layout } = build({ title: '月次の報告', author: '森田', blocks: [{ type: 'para', text: T(body(100)) }] })
  const ops = flat(layout.pages[0].ops)
  const title = ops.find((o) => o.t === 'text' && textOf(o) === '月次の報告')
  assert.ok(title)
  assert.equal(title.font, 'minchoBold')
  assert.equal(title.size, 18)
  assert.equal(layout.tags[title.tag].role, 'H1')
  const rule = ops.find((o) => o.t === 'rule' && o.w === 1.4)
  assert.ok(rule)
  assert.equal(rule.color, theme.colors.ink)
  assert.ok(rule.y1 > title.y)
  const meta = ops.find((o) => o.t === 'text' && textOf(o).includes('2026年10月9日'))
  assert.ok(meta, '日付の字')
  assert.ok(textOf(meta).startsWith('森田'))
  assert.equal(meta.size, 9)
  assert.equal(meta.color, theme.colors.sub)
  assert.ok(meta.y > rule.y1)
  assert.equal(layout.outline[0].title, '月次の報告')
  assert.equal(layout.outline[0].level, 1)
  assert.equal(layout.outline[0].page, 0)
  assert.equal(layout.meta.title, '月次の報告')
  assert.equal(layout.meta.author, '森田')
  assert.equal(layout.meta.lang, 'ja-JP')
  assert.equal(layout.meta.created, NOW)
})

test('lang が en の文書は meta.lang が en-US', () => {
  const { layout } = build({ title: 'Report', lang: 'en', blocks: [{ type: 'para', text: T('The quick brown fox jumps over the lazy dog. '.repeat(20)) }] })
  assert.equal(layout.meta.lang, 'en-US')
})

test('本文の基線は全部 theme.baseline の行の格子の上にある（段落・箇条書き・引用・囲み・記入欄のラベル）', () => {
  const { layout } = build(richInput(), IMAGES)
  const bodyOps = allOps(layout).filter((o) => o.t === 'text' && o.font === 'mincho' && o.size === theme.size)
  assert.ok(bodyOps.length > 20)
  for (const o of bodyOps) assert.ok(isGrid(o.y), `y=${o.y} が格子から外れた: ${textOf(o).slice(0, 12)}`)
})

test('見出し・表・要点・図・囲みの後でも次の本文は格子の行に戻る', () => {
  const blocks = []
  for (let i = 0; i < 6; i++) {
    blocks.push({ type: 'heading', level: (i % 3) + 1, text: T('見出し' + i) })
    blocks.push({ type: 'table', head: [T('甲'), T('乙')], rows: [[T('あ'), T('い')], [T('う'), T('え')], [T('お'), T('か')]] })
    blocks.push({ type: 'para', text: T(body(150, i)) })
    blocks.push({ type: 'keys', items: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] })
    blocks.push({ type: 'para', text: T(body(150, i + 1)) })
    blocks.push({ type: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>', alt: '図', height: 61.3 })
    blocks.push({ type: 'para', text: T(body(150, i + 2)) })
  }
  const { layout } = build({ title: '格子', blocks })
  const paras = allOps(layout).filter((o) => o.t === 'text' && layout.tags[o.tag ?? 0]?.role === 'P' && o.font === 'mincho')
  assert.ok(paras.length >= 18)
  for (const o of paras) assert.ok(isGrid(o.y), `y=${o.y}`)
})

test('見出しの上下の空きは theme.head の above・below（行の数）で、基線は格子の上。h3 も上に 1 行あけて前の段落に詰めない', () => {
  const { layout } = build({ title: '見出し', blocks: [
    { type: 'para', text: T(body(60)) },
    { type: 'heading', level: 1, text: T('章') },
    { type: 'para', text: T(body(60)) },
    { type: 'heading', level: 2, text: T('節') },
    { type: 'para', text: T(body(60)) },
    { type: 'heading', level: 3, text: T('項') },
    { type: 'para', text: T(body(60)) },
  ] })
  const ops = allOps(layout)
  const find = (role) => ops.find((o) => o.t === 'text' && roleOf(layout, o) === role)
  const para = ops.filter((o) => o.t === 'text' && roleOf(layout, o) === 'P' && o.font === 'mincho')
  const rowOf = (y) => Array.from({ length: theme.lines }, (_, i) => i).find((i) => Math.abs(theme.baseline(i) - y) < 1e-9)
  const first = rowOf(para[0].y)
  const h1 = find('H2') // 見出し 2 の方が先に出るので役割で引き分ける
  assert.ok(h1)
  const h1op = ops.find((o) => o.t === 'text' && textOf(o) === '章')
  const h2op = ops.find((o) => o.t === 'text' && textOf(o) === '節')
  const h3op = ops.find((o) => o.t === 'text' && textOf(o) === '項')
  for (const o of [h1op, h2op, h3op]) assert.ok(isGrid(o.y))
  // 見出しの前の段落の最後の行から、見出しの基線までの行数 = 取る行数
  const lastBefore = (op) => Math.max(...para.filter((p) => p.y < op.y).map((p) => rowOf(p.y)))
  assert.equal(rowOf(h1op.y) - lastBefore(h1op), theme.head.h1.above + 1)
  assert.equal(rowOf(h2op.y) - lastBefore(h2op), theme.head.h2.above + 1)
  assert.equal(rowOf(h3op.y) - lastBefore(h3op), theme.head.h3.above + 1)
  assert.equal(rowOf(h3op.y) - lastBefore(h3op), 2, 'h3 の上に空きの行が 1 行ある')
  // 見出しの基線から次の本文の最初の基線まで = below + 1 行
  const firstAfter = (op) => Math.min(...para.filter((p) => p.y > op.y).map((p) => rowOf(p.y)))
  assert.equal(firstAfter(h1op) - rowOf(h1op.y), theme.head.h1.below + 1)
  assert.equal(firstAfter(h2op) - rowOf(h2op.y), theme.head.h2.below + 1)
  assert.equal(firstAfter(h3op) - rowOf(h3op.y), theme.head.h3.below + 1)
  assert.ok(first >= 0)
  assert.deepEqual([h1op, h2op, h3op].map((o) => layout.tags[o.tag].role), ['H1', 'H2', 'H3'])
  assert.deepEqual([h1op, h2op, h3op].map((o) => o.size), [theme.head.h1.size, theme.head.h2.size, theme.head.h3.size])
  // h1・h2 の下に罫（h3 は無し）
  const rules = ops.filter((o) => o.t === 'rule' && (o.w === theme.head.h1.rule || o.w === theme.head.h2.rule) && o.w !== 1.4)
  assert.ok(rules.some((r) => r.w === theme.head.h2.rule && r.y1 > h2op.y))
})

test('折り返す見出しも基線は格子の上で、最後の行の基線が塊の最後の行', () => {
  const long = '長い見出しの文字列を折り返させるために同じような語をいくつもいくつも並べていきます'.repeat(2)
  const { layout } = build({ title: '長い見出し', blocks: [{ type: 'heading', level: 1, text: T(long) }, { type: 'para', text: T(body(100)) }] })
  const ops = allOps(layout).filter((o) => o.t === 'text' && layout.tags[o.tag ?? 0]?.role === 'H1' && textOf(o) !== '長い見出し')
  const ys = [...new Set(ops.map((o) => o.y))]
  assert.ok(ys.length >= 2, `見出しが 2 行以上に折れた（${ys.length}）`)
  for (const y of ys) assert.ok(isGrid(y))
})

test('折り返す見出しの行どうしは字の大きさの 1.1 倍以上あき、それ以上は広げない（行送りの整数倍で一番詰まった所）', () => {
  const long = '長い見出しの文字列を折り返させるために同じような語をいくつもいくつも並べていきます'.repeat(2)
  for (const size of [8, 9, 9.5, 11, 12.5, 14]) {
    const th = makeTheme({ size })
    for (const level of [1, 2, 3]) {
      const { layout } = build({ title: '題', size, blocks: [{ type: 'heading', level, text: T(long) }, { type: 'para', text: T(body(100)) }] })
      const ys = [...new Set(allOps(layout).filter((o) => o.t === 'text' && layout.tags[o.tag ?? 0]?.role === `H${level}` && o.size === th.head[`h${level}`].size).map((o) => o.y))].sort((a, b) => a - b)
      assert.ok(ys.length >= 2, `本文 ${size}pt の h${level} が折れた`)
      const hsz = th.head[`h${level}`].size
      const step = ys[1] - ys[0]
      assert.ok(step >= hsz * 1.1 - 1e-6, `本文 ${size}pt の h${level}: 行どうし ${step}pt が ${hsz}pt の 1.1 倍未満`)
      assert.ok(step - th.lineGap < hsz * 1.1 - 1e-6, `本文 ${size}pt の h${level}: 行どうし ${step}pt が必要より 1 行以上広い`)
    }
  }
})

test('見出しが頁の最後に残らない: 見出しの頁に、直後の本文が 2 行以上（段落が 2 行以下ならその全部）いっしょにある', () => {
  const blocks = []
  const lens = [180, 90, 420, 260, 600, 130, 350]
  for (let i = 0; i < 40; i++) {
    blocks.push({ type: 'heading', level: 2, text: T('見出し' + i) })
    blocks.push({ type: 'para', text: T(body(lens[i % lens.length], i)) })
  }
  const { layout } = build({ title: '孤立', blocks })
  assert.ok(layout.pages.length >= 4)
  const headings = layout.tags.map((t, i) => [t, i]).filter(([t]) => t.role === 'H2').map(([, i]) => i)
  assert.equal(headings.length, 40)
  for (const h of headings) {
    const p = h + 1
    assert.equal(layout.tags[p].role, 'P')
    const hp = linesByPage(layout, h)
    assert.equal(hp.size, 1)
    const [page, hy] = [...hp.entries()][0]
    const pLines = linesByPage(layout, p)
    const total = [...pLines.values()].reduce((s, v) => s + v.size, 0)
    const here = pLines.get(page)
    assert.ok(here, `見出し ${h} が頁 ${page} の最後に残った`)
    assert.ok([...here].every((y) => y > [...hy][0]))
    assert.ok(here.size >= Math.min(2, total), `見出し ${h} の頁に本文が ${here.size} 行しかない`)
  }
})

test('段落の 1 行だけが頁の頭にも末にも残らない', () => {
  const blocks = []
  const lens = [100, 330, 215, 480, 160, 700, 250, 540, 120, 390, 610, 280]
  for (let i = 0; i < 60; i++) blocks.push({ type: 'para', text: T(body(lens[i % lens.length], i)) })
  const { layout } = build({ title: '寡婦と孤児', blocks })
  assert.ok(layout.pages.length >= 5)
  let split = 0
  layout.tags.forEach((t, tag) => {
    if (t.role !== 'P') return
    const byPage = linesByPage(layout, tag)
    const total = [...byPage.values()].reduce((s, v) => s + v.size, 0)
    if (total < 2) return
    if (byPage.size > 1) split++
    for (const [page, ys] of byPage) assert.ok(ys.size >= 2, `段落 ${tag} が頁 ${page} に ${ys.size} 行だけ`)
  })
  assert.ok(split >= 3, `頁をまたぐ段落が試験に含まれていない（${split}）`)
})

test('見出しの直後が図・表・要点でも、見出しは頁の最後に残らず次の部品と同じ頁に置く', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>'
  const nexts = [
    { type: 'svg', source: svg, alt: '図', height: 120 },
    { type: 'table', head: [T('甲'), T('乙')], rows: [[T('あ'), T('い')]] },
    { type: 'keys', items: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] },
  ]
  for (const next of nexts) {
    for (let k = 0; k < 36; k++) {
      const filler = Array.from({ length: k }, (_, i) => ({ type: 'para', text: T('短い行' + i) }))
      const { layout } = build({ title: '直後', blocks: [...filler, { type: 'heading', level: 2, text: T('見出しX') }, next] })
      const heading = allOps(layout).find((o) => o.t === 'text' && textOf(o) === '見出しX')
      const pageOf = (pred) => layout.pages.findIndex((p) => flat(p.ops).some(pred))
      const hPage = pageOf((o) => o === heading)
      const isNext = (o) => {
        if (next.type === 'svg') return o.t === 'path'
        if (next.type === 'table') return o.t === 'text' && textOf(o) === '甲'
        return o.t === 'text' && textOf(o) === 'a'
      }
      const nextPage = pageOf(isNext)
      assert.equal(hPage, nextPage, `${next.type} k=${k}`)
    }
  }
})

test('段落の全部の行は 1 つの P の tag・欧文の文書も 1 字下げで両端揃え', () => {
  const text = 'The quick brown fox jumps over the lazy dog and keeps running across the wide open field until night falls. '.repeat(6)
  const { layout } = build({ title: 'English', lang: 'en', blocks: [{ type: 'para', text: T(text) }] })
  const ops = allOps(layout).filter((o) => o.t === 'text' && o.font === 'mincho' && o.size === theme.size)
  const tags = new Set(ops.map((o) => o.tag))
  assert.equal(tags.size, 1)
  assert.equal(layout.tags[[...tags][0]].role, 'P')
  const ys = [...new Set(ops.map((o) => o.y))]
  assert.ok(ys.length >= 3)
  const first = ops.filter((o) => o.y === ys[0]).sort((a, b) => a.glyphs[0].x - b.glyphs[0].x)[0]
  assert.ok(Math.abs(first.glyphs[0].x - (theme.left + theme.size)) < 1e-6)
  assert.ok(layout.stats.justified >= 2)
})

test('2 行の段落と 3 行の段落は割らない', () => {
  const blocks = []
  // 本文 1 行の字数は 52〜53。3 行より少し短い段落を頁の末に当てるため、いろいろな長さを並べる
  for (let i = 0; i < 80; i++) blocks.push({ type: 'para', text: T(body(i % 2 ? 100 : 140, i)) })
  const { layout } = build({ title: '割らない', blocks })
  layout.tags.forEach((t, tag) => {
    if (t.role !== 'P') return
    const byPage = linesByPage(layout, tag)
    const total = [...byPage.values()].reduce((s, v) => s + v.size, 0)
    if (total <= 3) assert.ok(byPage.size <= 1, `${total} 行の段落 ${tag} が割れた`)
  })
})

test('表が頁をまたぐと、頭の行が次の頁の先頭に tag なしで出し直される', () => {
  const rows = []
  for (let i = 0; i < 70; i++) rows.push([T('項目' + i), T(String(i * 1000) + '円'), T('説明')])
  const { layout } = build({ title: '長い表', blocks: [{ type: 'table', head: [T('項目名'), T('金額'), T('備考')], rows }] })
  assert.ok(layout.pages.length >= 2)
  const headText = (pg) => flat(layout.pages[pg].ops).filter((o) => o.t === 'text' && o.font === 'sansBold' && textOf(o) === '項目名')
  const first = headText(0)
  assert.equal(first.length, 1)
  assert.equal(layout.tags[first[0].tag].role, 'TH')
  for (let pg = 1; pg < layout.pages.length; pg++) {
    const again = headText(pg)
    assert.equal(again.length, 1, `頁 ${pg} に頭の行`)
    assert.equal(again[0].tag, undefined)
    // 頭の行は頁の表の一番上
    const bodyYs = flat(layout.pages[pg].ops).filter((o) => o.t === 'text' && o.font === 'sans').map((o) => o.y)
    assert.ok(again[0].y < Math.min(...bodyYs))
  }
  // 本文の行は全部 1 回ずつ（落ちも重なりもしない）
  const all = allOps(layout).filter((o) => o.t === 'text' && o.font === 'sans' && /^項目\d+$/.test(textOf(o)))
  assert.equal(all.length, 70)
  // 構造: Table > THead > TR > TH、TBody > TR > TD
  const role = (i) => layout.tags[i].role
  const th = first[0].tag
  assert.deepEqual([role(th), role(layout.tags[th].parent), role(layout.tags[layout.tags[th].parent].parent), role(layout.tags[layout.tags[layout.tags[th].parent].parent].parent)], ['TH', 'TR', 'THead', 'Table'])
  const td = all[0].tag
  assert.deepEqual([role(td), role(layout.tags[td].parent), role(layout.tags[layout.tags[td].parent].parent)], ['TD', 'TR', 'TBody'])
})

test('表: 数字だけの列は右寄せ・字は 8.5pt の sans で頭の行は sansBold・上下と頭の下に太い罫', () => {
  const { layout } = build({ title: '表', blocks: [{ type: 'table', head: [T('名'), T('金額')], rows: [[T('甲'), T('1,234円')], [T('乙'), T('▲5.0%')]] }] })
  const ops = allOps(layout)
  const cell = (s) => ops.find((o) => o.t === 'text' && textOf(o) === s)
  const a = cell('1,234円')
  const b = cell('▲5.0%')
  assert.equal(a.size, 8.5)
  assert.equal(a.font, 'sans')
  assert.equal(cell('名').font, 'sansBold')
  const right = (op) => op.glyphs[op.glyphs.length - 1].x + 8.5 * 0.5
  // 右端がそろう（同じ列の数字の右端は、1 字ぶんの誤差の中で同じ）
  assert.ok(Math.abs(right(a) - right(b)) < 8.5)
  assert.ok(a.glyphs[0].x > cell('甲').glyphs[0].x + 50)
  const ws = ops.filter((o) => o.t === 'rule').map((o) => o.w)
  assert.ok(ws.includes(0.8) && ws.includes(0.6))
  assert.ok(ops.some((o) => o.t === 'rect' && o.fill === theme.colors.tint))
})

test('表: 列の幅は版面の幅に収まり、widths の割合を守る', () => {
  const W = theme.measure
  const sum = (a) => a.reduce((s, v) => s + v, 0)
  const nat = [40, 200, 80]
  const min = [20, 60, 40]
  assert.ok(Math.abs(sum(allocate(W, nat, min, undefined)) - W) < 1e-9)
  const wide = allocate(W, [300, 400, 500], [30, 40, 50], undefined)
  assert.ok(Math.abs(sum(wide) - W) < 1e-9)
  assert.ok(wide.every((v, j) => v >= [30, 40, 50][j]))
  const squeeze = allocate(100, [300, 400, 500], [150, 150, 150], undefined)
  assert.ok(Math.abs(sum(squeeze) - 100) < 1e-9)
  const given = allocate(W, nat, min, [1, 2, 1])
  assert.ok(Math.abs(given[1] / given[0] - 2) < 1e-9)
})

test('全部の TextOp の字の x は版面の左端 − 0.5em から右端の間、y は紙の中、字は 7pt 以上（ルビを除く）', () => {
  const { layout } = build(richInput(), IMAGES)
  const left = theme.left - 0.5 * theme.size
  const right = theme.left + theme.measure
  let count = 0
  for (const op of allOps(layout)) {
    if (op.t !== 'text') continue
    count++
    assert.ok(op.y >= 0 && op.y <= layout.page.height, `y=${op.y}`)
    if (roleOf(layout, op) !== 'RT') assert.ok(op.size >= 7, `size=${op.size} ${textOf(op)}`)
    for (const g of op.glyphs) assert.ok(g.x >= left - 1e-6 && g.x <= right + 1e-6, `x=${g.x} (${g.c})`)
  }
  assert.ok(count > 50)
})

test('全頁に足があり、「n / N」が正しい。足は tag なしで 8pt・sub の色・罫は 0.5pt', () => {
  const { layout } = build(richInput(), IMAGES)
  const N = layout.pages.length
  assert.ok(N >= 2)
  layout.pages.forEach((pg, i) => {
    const ops = flat(pg.ops)
    const num = ops.find((o) => o.t === 'text' && o.y === theme.foot.y && textOf(o) === `${i + 1} / ${N}`)
    assert.ok(num, `頁 ${i} の頁番号`)
    assert.equal(num.tag, undefined)
    assert.equal(num.size, 8)
    assert.equal(num.color, theme.foot.color)
    const title = ops.find((o) => o.t === 'text' && o.y === theme.foot.y && textOf(o) === '森田 ／ 全部入りの文書')
    assert.ok(title, `頁 ${i} の足の題`)
    assert.ok(num.glyphs[0].x > title.glyphs[title.glyphs.length - 1].x)
    const rule = ops.find((o) => o.t === 'rule' && o.y1 === theme.foot.ruleY)
    assert.ok(rule)
    assert.equal(rule.w, 0.5)
    assert.equal(rule.color, theme.colors.rule)
    assert.equal(rule.tag, undefined)
  })
})

test('author が無い足は題だけ。長い題は … で切って版面の中に収める', () => {
  const { layout } = build({ title: '題だけの足', blocks: [] })
  assert.ok(flat(layout.pages[0].ops).some((o) => o.t === 'text' && o.y === theme.foot.y && textOf(o) === '題だけの足'))
  const longTitle = '非常に長い題名'.repeat(30)
  const r = build({ title: longTitle, blocks: [{ type: 'para', text: T(body(50)) }] })
  const foot = flat(r.layout.pages[0].ops).filter((o) => o.t === 'text' && o.y === theme.foot.y)
  assert.ok(foot.some((o) => textOf(o).endsWith('…')))
  for (const o of foot) for (const g of o.glyphs) assert.ok(g.x >= theme.left - 1e-6 && g.x <= theme.left + theme.measure)
})

test('tags の parent は全部有効で、0 が Document。Op の tag は tags の中の番号', () => {
  const { layout } = build(richInput(), IMAGES)
  assert.deepEqual(layout.tags[0], { role: 'Document', parent: null })
  layout.tags.forEach((t, i) => {
    if (i === 0) return
    assert.ok(Number.isInteger(t.parent) && t.parent >= 0 && t.parent < layout.tags.length && t.parent !== i, `tag ${i}`)
    assert.ok(t.parent < i, `親は先に作る tag ${i}`)
  })
  for (const op of allOps(layout)) if (op.tag !== undefined) assert.ok(Number.isInteger(op.tag) && op.tag > 0 && op.tag < layout.tags.length)
})

test('outline: 題名・見出しが level と頁つきで文書の順に並ぶ。頁は見出しの字がある頁', () => {
  const blocks = []
  for (let i = 0; i < 12; i++) {
    blocks.push({ type: 'heading', level: 1, text: T('章' + i) })
    blocks.push({ type: 'para', text: T(body(500, i)) })
    blocks.push({ type: 'heading', level: 2, text: T('節' + i) })
    blocks.push({ type: 'para', text: T(body(400, i)) })
    blocks.push({ type: 'heading', level: 3, text: T('項' + i) })
    blocks.push({ type: 'para', text: T(body(300, i)) })
  }
  const { layout } = build({ title: 'しおり', blocks })
  assert.equal(layout.outline.length, 1 + 36)
  assert.deepEqual(layout.outline[0], { ...layout.outline[0], title: 'しおり', level: 1, page: 0 })
  assert.deepEqual(layout.outline.slice(1, 4).map((o) => [o.title, o.level]), [['章0', 1], ['節0', 2], ['項0', 3]])
  let lastKey = -1
  for (const o of layout.outline.slice(1)) {
    const op = allOps(layout).find((x) => x.t === 'text' && textOf(x) === o.title && layout.pages[o.page] && flat(layout.pages[o.page].ops).includes(x))
    assert.ok(op, `${o.title} は頁 ${o.page} にある`)
    assert.ok(o.y < op.y && op.y - o.y <= op.size, `y は字の上: ${o.title} ${o.y} ${op.y}`)
    const key = o.page * 10000 + o.y
    assert.ok(key > lastKey, '文書の順')
    lastKey = key
  }
})

test('ルビ: 親字は RB・ルビは RT のタグで Ruby の子、Ruby の親は P。ルビの基線は親字の基線 − 大きさ×0.88 − ルビの大きさ×0.12', () => {
  const { layout } = build({ title: 'ルビ', blocks: [{ type: 'para', text: [{ text: '吾輩は' }, { text: '猫', ruby: 'ねこ' }, { text: 'である。' }, { text: '漢字', ruby: 'かん|じ' }, { text: 'と。' + body(100) }] }] })
  const ops = allOps(layout).filter((o) => o.t === 'text')
  const rts = ops.filter((o) => roleOf(layout, o) === 'RT')
  const rbs = ops.filter((o) => roleOf(layout, o) === 'RB')
  // モノルビ（かん|じ）は読みの TextOp が親字ごとに分かれるが、タグは 1 つのルビに 1 つの RB と RT
  assert.equal(new Set(rts.map((o) => o.tag)).size, 2)
  assert.equal(new Set(rbs.map((o) => o.tag)).size, 2)
  const neko = rts.find((o) => textOf(o) === 'ねこ')
  const nekoBase = rbs.find((o) => textOf(o) === '猫')
  assert.ok(neko && nekoBase)
  assert.equal(neko.size, theme.size * 0.5)
  assert.ok(Math.abs(neko.y - (nekoBase.y - theme.size * 0.88 - neko.size * 0.12)) < 1e-9)
  const rb = layout.tags[nekoBase.tag]
  const rt = layout.tags[neko.tag]
  assert.equal(rb.role, 'RB')
  assert.equal(rt.role, 'RT')
  assert.equal(rb.parent, rt.parent)
  assert.equal(layout.tags[rb.parent].role, 'Ruby')
  assert.equal(layout.tags[layout.tags[rb.parent].parent].role, 'P')
  // ルビは親字の真上（中付き）
  const rubyCenter = neko.glyphs[0].x + (neko.size * neko.glyphs.length) / 2
  const baseCenter = nekoBase.glyphs[0].x + theme.size / 2
  assert.ok(Math.abs(rubyCenter - baseCenter) < 1e-6)
  // 別々のルビは別々の RB・RT
  assert.notEqual(rbs[0].tag, rbs[1].tag)
  assert.notEqual(rts[0].tag, rts[1].tag)
})

test('リンク: 字の下に 0.4pt の ink の罫と、行ごとの LinkOp（url と字の幅）', () => {
  const { layout } = build({ title: 'リンク', blocks: [{ type: 'para', text: [{ text: '前の文。' }, { text: 'サイトを見る', link: 'https://example.com/x' }, { text: 'と後ろの文。' + body(40) }] }] })
  const ops = allOps(layout)
  const link = ops.find((o) => o.t === 'link')
  assert.ok(link)
  assert.equal(link.url, 'https://example.com/x')
  assert.ok(Math.abs(link.w - theme.size * 6) < 1) // 6 字
  const rule = ops.find((o) => o.t === 'rule' && o.w === 0.4)
  assert.ok(rule)
  assert.equal(rule.color, theme.colors.ink)
  assert.ok(Math.abs(rule.x2 - rule.x1 - link.w) < 1e-9)
  assert.ok(rule.y1 > link.y + link.h * 0.5 && rule.y1 < link.y + link.h + 3)
})

test('太字は minchoBold・code は本文の書体のまま色が sub', () => {
  const { layout } = build({ title: '飾り', blocks: [{ type: 'para', text: [{ text: '前' }, { text: '太い字', bold: true }, { text: '中' }, { text: 'コード', code: true }, { text: '後' }] }] })
  const ops = allOps(layout).filter((o) => o.t === 'text' && layout.tags[o.tag ?? 0]?.role === 'P')
  const bold = ops.find((o) => textOf(o) === '太い字')
  assert.equal(bold.font, 'minchoBold')
  const code = ops.find((o) => textOf(o) === 'コード')
  assert.equal(code.font, 'mincho')
  assert.equal(code.color, theme.colors.sub)
})

test('本文がゴシックの文書: 太字は sansBold・書体は sans', () => {
  const { layout } = build({ title: 'ゴシック', body: 'gothic', blocks: [{ type: 'para', text: [{ text: '前' }, { text: '太い字', bold: true }, { text: '後' }] }] })
  const ops = allOps(layout).filter((o) => o.t === 'text' && layout.tags[o.tag ?? 0]?.role === 'P')
  assert.ok(ops.some((o) => o.font === 'sans'))
  assert.equal(ops.find((o) => textOf(o) === '太い字').font, 'sansBold')
})

test('書体に無い字: もう一方の系統にあればそれで描き、どちらにも無ければ〓にして stats と warnings に 1 回ずつ', () => {
  // ゴシックにあって明朝に無い字を寸法から探す(今の fonts/ では 岸 だけ。∑ は Noto Serif JP にあるので明朝で描ける)。
  // 無ければ明朝の has だけを偽にした stub で ∑ を明朝に無い事にして、代わりの書体の仕組みを確かめる
  let altCp = null
  for (let c = 0x20; c < 0x10000 && altCp === null; c++) if (metrics.sans.has(c) && !metrics.mincho.has(c)) altCp = c
  const hide = (m) => ({ ...m, has: (c) => c !== 0x2211 && m.has(c), adv: (c) => (c === 0x2211 ? NaN : m.adv(c)) })
  const m = altCp !== null ? metrics : { ...metrics, mincho: hide(metrics.mincho), minchoBold: hide(metrics.minchoBold) }
  const alt = String.fromCodePoint(altCp ?? 0x2211)
  const kokuji = String.fromCodePoint(0x20bb7)
  const { layout, warnings } = compose({ title: '無い字', blocks: [{ type: 'para', text: T(`和${alt}の合計と${kokuji}と${kokuji}と${kokuji}を含む。` + body(60)) }] }, { metrics: m, images: {}, phrase: phraseBoundaries, now: NOW })
  const ops = allOps(layout).filter((o) => o.t === 'text')
  const sans = ops.find((o) => o.font === 'sans' && textOf(o) === alt)
  assert.ok(sans, `mincho に無い ${alt} は sans で描く`)
  assert.ok(!ops.some((o) => textOf(o).includes(kokuji)), '無い字は描かない')
  assert.ok(ops.some((o) => textOf(o).includes(String.fromCodePoint(0x3013))))
  assert.deepEqual(layout.stats.missingGlyphs, [kokuji])
  assert.equal(warnings.filter((w) => w.includes(kokuji)).length, 1)
  assert.ok(!warnings.some((w) => w.includes(alt)))
})

// 書体に U+00AD の字を足した後も、入力の任意のハイフンが語の途中に見えるハイフンにならないこと（捨てているのは schema の cleanText。書体に字が無かった頃は〓になる心配だった）
test('任意のハイフン(U+00AD)は書体に字があっても描かず、幅も取らない（有っても無くても字の位置が同じ・警告なし）', () => {
  const shy = String.fromCodePoint(0x00ad)
  const plain = 'international relations and the environment ' + body(40)
  const withShy = plain.replace('international', `inter${shy}national`).replace('environment', `envi${shy}ron${shy}ment`)
  for (const lang of ['en', 'ja']) {
    const a = build({ title: 't', lang, blocks: [{ type: 'para', text: T(plain) }] })
    const b = build({ title: 't', lang, blocks: [{ type: 'para', text: T(withShy) }] })
    const xs = (l) => allOps(l).filter((o) => o.t === 'text').flatMap((o) => o.glyphs.map((g) => [g.c, Math.round(g.x * 1000)]))
    assert.ok(!allOps(b.layout).some((o) => o.t === 'text' && textOf(o).includes(shy)), `${lang}: U+00AD を描いた`)
    assert.deepEqual(xs(b.layout), xs(a.layout), `${lang}: U+00AD が字の位置を動かした`)
    assert.deepEqual(b.warnings, a.warnings, `${lang}: U+00AD で警告が出た`)
    assert.deepEqual(b.layout.stats.missingGlyphs, [])
  }
})

test('stats: 全角だけの行は字間を 1 つも動かさない（maxSpread 0）・揃えた行の数・行の数・禁則の破れ', () => {
  const full = 'あ'.repeat(theme.chars * 4 - 10)
  const { layout } = build({ title: '全角', blocks: [{ type: 'para', text: T(full) }] })
  const s = layout.stats
  assert.equal(s.maxSpread, 0)
  assert.ok(s.lines >= 4)
  assert.equal(s.justified, s.lines - 1)
  assert.equal(s.runts, 0)
  assert.equal(s.kinsokuBreaks, 0)
  assert.equal(s.overfull, 0)
  assert.deepEqual(s.missingGlyphs, [])
})

test('割れない長い語は字で割り、禁則の破れ・はみ出しを stats と warnings に数でまとめる', () => {
  const url = 'x'.repeat(theme.chars * 2 + 20)
  const { layout, warnings } = build({ title: '長い語', blocks: [{ type: 'para', text: T('前の文 ' + url + ' 後ろの文。') }] })
  assert.ok(layout.stats.kinsokuBreaks >= 1)
  assert.ok(warnings.some((w) => w.includes('禁則')))
  assert.equal(warnings.filter((w) => w.includes('禁則')).length, 1)
})

test('lastPageFill: 最後の頁の行の埋まり。0.15 未満なら「最後の頁が n 行だけです」', () => {
  const fewLines = build({ title: '終わりが短い', blocks: [{ type: 'para', text: T(body(300)) }, { type: 'pagebreak' }, { type: 'para', text: T(body(110)) }] })
  assert.equal(fewLines.layout.pages.length, 2)
  const n = Math.round(fewLines.layout.stats.lastPageFill * theme.lines)
  assert.ok(n >= 1 && n <= 3)
  assert.ok(fewLines.layout.stats.lastPageFill < 0.15)
  assert.ok(fewLines.warnings.some((w) => w === `最後の頁が ${n} 行だけです`), fewLines.warnings.join('|'))
  const blocks = []
  for (let i = 0; i < 12; i++) blocks.push({ type: 'para', text: T(body(520, i)) })
  const full = build({ title: '埋まる', blocks })
  const fill = full.layout.stats.lastPageFill
  assert.ok(fill > 0 && fill <= 1)
  if (fill >= 0.15) assert.ok(!full.warnings.some((w) => w.includes('最後の頁')))
})

test('pagebreak は改頁し、頭・続きの改頁で白い頁を作らない', () => {
  const { layout } = build({ title: '改頁', blocks: [{ type: 'para', text: T(body(80)) }, { type: 'pagebreak' }, { type: 'pagebreak' }, { type: 'para', text: T(body(80)) }] })
  assert.equal(layout.pages.length, 2)
  const paraOn = (i) => flat(layout.pages[i].ops).some((o) => o.t === 'text' && roleOf(layout, o) === 'P' && o.font === 'mincho')
  assert.ok(paraOn(0) && paraOn(1))
})

test('頁の頭の見出しは上の空きを捨てる（h1 が頁の先頭の行に来る）', () => {
  const { layout } = build({ title: '頭', blocks: [{ type: 'para', text: T(body(80)) }, { type: 'pagebreak' }, { type: 'heading', level: 1, text: T('二頁目の章') }, { type: 'para', text: T(body(80)) }] })
  const h = flat(layout.pages[1].ops).find((o) => o.t === 'text' && textOf(o) === '二頁目の章')
  assert.equal(h.y, theme.baseline(0))
})

test('題名の直後の見出しは上の空きを 1 行に詰める（題名の下に 2 行の穴をあけない）', () => {
  const { layout } = build({ title: '詰める', blocks: [
    { type: 'heading', level: 1, text: T('最初の章') },
    { type: 'heading', level: 2, text: T('すぐ下の節') },
    { type: 'para', text: T(body(60)) },
  ] })
  const ops = allOps(layout)
  const at = (t) => ops.find((o) => o.t === 'text' && textOf(o) === t)
  const rowOf = (y) => Array.from({ length: theme.lines }, (_, i) => i).find((i) => Math.abs(theme.baseline(i) - y) < 1e-9)
  // 題名の塊は 3 行（0〜2 行目）。h1 は 1 行あけて 4 行目（詰めなければ 5 行目）、h2 はその 2 行下
  assert.equal(rowOf(at('最初の章').y), 4)
  assert.equal(rowOf(at('すぐ下の節').y), 6)
})

test('原稿の頭の h1 が題名と同じ文なら 1 つにまとめ、違う文なら本文の見出しとして題名より小さく組む（題名が 2 つ並ばない）', () => {
  const same = build({ title: '同じ題', markdown: '# 同じ題\n\n本文です。' }).layout
  assert.equal(allOps(same).filter((o) => o.t === 'text' && o.size === 18).length, 1)
  assert.deepEqual(same.outline.map((o) => [o.title, o.level]), [['同じ題', 1]])

  const diff = build({ title: '題名', markdown: '# 別の見出し\n\n本文です。' }).layout
  const ops = allOps(diff)
  const title = ops.find((o) => o.t === 'text' && textOf(o) === '題名')
  const head = ops.find((o) => o.t === 'text' && textOf(o) === '別の見出し')
  assert.equal(title.size, 18)
  assert.equal(head.size, theme.head.h1.size)
  assert.ok(head.size < title.size)
  assert.ok(head.y > title.y)
  assert.equal(diff.tags[head.tag].role, 'H1')
  assert.deepEqual(diff.outline.map((o) => [o.title, o.level]), [['題名', 1], ['別の見出し', 1]])
  // 罫: 題名の 1.4pt と、h1 の細い罫が 1 本ずつ
  assert.deepEqual(ops.filter((o) => o.t === 'rule' && o.w >= 0.8).map((o) => o.w).sort(), [theme.head.h1.rule, 1.4].sort())
})

const FIG_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5" fill="#888"/></svg>'
const fig = (height, alt = '図') => ({ type: 'svg', source: FIG_SVG, alt, height })
const pathYs = (op) => (op.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1)
/** 図（Figure の tag）の線・面の y の範囲を、頁ごとに */
function figureSpans(layout) {
  const out = new Map()
  layout.pages.forEach((pg, i) => {
    for (const op of flat(pg.ops)) {
      if (op.t !== 'path' || layout.tags[op.tag ?? 0]?.role !== 'Figure') continue
      const r = out.get(i) ?? { min: Infinity, max: -Infinity }
      for (const y of pathYs(op)) { r.min = Math.min(r.min, y); r.max = Math.max(r.max, y) }
      out.set(i, r)
    }
  })
  return out
}
const tagsOf = (layout, role) => layout.tags.map((t, i) => (t.role === role ? i : -1)).filter((i) => i >= 0)
/** 本文の段落の tag（題名の下の author・日付の行も P なので除く） */
const paraTags = (layout) => tagsOf(layout, 'P').slice(1)
/** tag の字の行が、頁ごとに何本あるか */
const rowsOnPages = (layout, tag) => layout.pages.map((_, i) => linesByPage(layout, tag).get(i)?.size ?? 0)

test('入らない図は次の頁の頭に送り、前の頁の空きを、直後の本文で埋める（図が後ろに浮く）。tag の番号は原稿の順のまま', () => {
  const { layout } = build({ title: '浮く図', blocks: [
    { type: 'para', text: T(body(1500)) },
    fig(220),
    { type: 'para', text: T(body(200, 1)) },
    { type: 'para', text: T(body(200, 2)) },
    { type: 'heading', level: 2, text: T('次の節') },
    { type: 'para', text: T(body(100, 3)) },
  ] })
  const spans = figureSpans(layout)
  assert.deepEqual([...spans.keys()], [1], '図は 2 頁目')
  assert.ok(spans.get(1).min < theme.top + 30, '図は頁の頭')
  const [p0, p1, p2, p3] = paraTags(layout)
  const fig0 = tagsOf(layout, 'Figure')[0]
  const h2 = tagsOf(layout, 'H2')[0]
  // 前の頁に、図の後ろの 2 つの段落が全部ある
  for (const p of [p1, p2]) {
    const rows = rowsOnPages(layout, p)
    assert.ok(rows[0] > 0 && rows[1] === 0, rows.join(','))
  }
  // 見出しは図より後ろ（節を越えて前に出ない）
  const hy = linesByPage(layout, h2)
  assert.deepEqual([...hy.keys()], [1])
  assert.ok([...hy.get(1)][0] > spans.get(1).max)
  assert.ok(rowsOnPages(layout, p3)[1] > 0)
  // 論理の順（tag の番号）は原稿の順: 図は後ろの段落より前
  assert.ok(p0 < fig0 && fig0 < p1 && p1 < p2 && p2 < h2 && h2 < p3)
})

test('図の前に出すのは同じ節の本文だけ: 直後が見出しなら何も前に出ず、図は次の頁の頭・見出しはその後ろ', () => {
  const { layout } = build({ title: '節を越えない', blocks: [
    { type: 'para', text: T(body(1500)) },
    fig(220),
    { type: 'heading', level: 2, text: T('次の節') },
    { type: 'para', text: T(body(200, 1)) },
  ] })
  const spans = figureSpans(layout)
  assert.deepEqual([...spans.keys()], [1])
  const hy = linesByPage(layout, tagsOf(layout, 'H2')[0])
  assert.deepEqual([...hy.keys()], [1], '見出しは前の頁に出ない')
  assert.ok([...hy.get(1)][0] > spans.get(1).max)
  assert.equal(layout.pages.length, 2)
})

test('図の前に出すのは本文・箇条書き・引用・囲み・表だけ: 要点・記入欄・別の図・罫は越えない', () => {
  const stops = [
    { type: 'keys', items: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] },
    { type: 'fields', items: [{ kind: 'text', name: 'n', label: '名前' }] },
    fig(50, '二つ目'),
    { type: 'rule' },
  ]
  for (const stop of stops) {
    const { layout } = build({ title: '越えない', blocks: [{ type: 'para', text: T(body(1500)) }, fig(220), stop, { type: 'para', text: T(body(100, 1)) }] })
    const after = paraTags(layout)[1]
    assert.deepEqual([...linesByPage(layout, after).keys()], [1], `${stop.type} の後ろの段落は前の頁に出ない`)
    assert.equal([...figureSpans(layout).keys()][0], 1, `${stop.type}: 図は次の頁の頭`)
  }
  const fillers = [
    { type: 'list', ordered: false, items: [T('甲'), T('乙'), T('丙')] },
    { type: 'quote', text: T(body(100)) },
    { type: 'card', label: '補足', text: T(body(100)) },
    { type: 'table', head: [T('甲'), T('乙')], rows: [[T('あ'), T('い')], [T('う'), T('え')]] },
  ]
  for (const f of fillers) {
    const { layout } = build({ title: '前に出る', blocks: [{ type: 'para', text: T(body(1500)) }, fig(220), f] })
    assert.deepEqual([...figureSpans(layout).keys()], [1], `${f.type}: 図は次の頁の頭`)
    const roles = new Set(layout.pages[0].ops.filter((o) => o.tag !== undefined).map((o) => layout.tags[o.tag].role))
    assert.ok([...roles].some((r) => r !== 'P' && r !== 'H1'), `${f.type} は図より先に前の頁にある`)
  }
})

test('図が頁に入る時は原稿の順のまま（浮かさない）', () => {
  const { layout } = build({ title: '入る図', blocks: [
    { type: 'para', text: T(body(300)) },
    fig(150),
    { type: 'para', text: T(body(200, 1)) },
  ] })
  assert.equal(layout.pages.length, 1)
  const after = paraTags(layout)[1]
  assert.ok([...linesByPage(layout, after).get(0)][0] > figureSpans(layout).get(0).max, '段落は図の下')
})

test('図の前に出た本文が頁をまたぐ時は、残りの行が図の後ろに続く（前の頁にも図の頁にも 2 行以上）', () => {
  const { layout } = build({ title: '続き', blocks: [
    { type: 'para', text: T(body(1500)) },
    fig(220),
    { type: 'para', text: T(body(1200, 1)) },
  ] })
  const after = paraTags(layout)[1]
  const rows = rowsOnPages(layout, after)
  assert.ok(rows[0] >= 2 && rows[1] >= 2, rows.join(','))
  const spans = figureSpans(layout)
  assert.deepEqual([...spans.keys()], [1])
  assert.ok([...linesByPage(layout, after).get(1)].every((y) => y > spans.get(1).max), '続きは図の下')
})

test('図が連なっても原稿の順を保つ（一つ目の図は二つ目の図より前）', () => {
  const { layout } = build({ title: '図が 2 つ', blocks: [
    { type: 'para', text: T(body(1500)) },
    fig(220, '一つ目'),
    { type: 'para', text: T(body(100, 1)) },
    fig(220, '二つ目'),
    { type: 'para', text: T(body(100, 2)) },
  ] })
  const [a, b] = tagsOf(layout, 'Figure')
  const ys = (tag) => layout.pages.flatMap((pg, i) => flat(pg.ops).filter((o) => o.tag === tag && o.t === 'path').flatMap((o) => pathYs(o).map((y) => i * 10000 + y)))
  assert.ok(Math.max(...ys(a)) < Math.min(...ys(b)))
})

test('記入欄: 続く欄の枠は 3pt 以上あけ、枠どうしがくっつかない（複数行の欄も同じ）', () => {
  const { layout } = build({ title: '記入', blocks: [{ type: 'fields', items: [
    { kind: 'text', name: 'a', label: '一' }, { kind: 'text', name: 'b', label: '二' },
    { kind: 'multiline', name: 'c', label: '三' }, { kind: 'text', name: 'd', label: '四' },
  ] }] })
  const f = allOps(layout).filter((o) => o.t === 'field')
  for (let i = 1; i < f.length; i++) {
    const gap = f[i].y - (f[i - 1].y + f[i - 1].h)
    assert.ok(gap >= 3, `${f[i - 1].name} と ${f[i].name} の間 ${gap}pt`)
  }
})

test('記入欄: label は左の列（短い label なら 5em）・FieldOp は残りの幅で行の真ん中・check は 12pt の正方形・multiline は 3 行・tag は Form', () => {
  const { layout } = build({ title: '記入', blocks: [{ type: 'fields', items: [
    { kind: 'text', name: 'name', label: 'お名前', value: '森田' },
    { kind: 'check', name: 'ok', label: '同意', value: true },
    { kind: 'multiline', name: 'memo', label: 'メモ' },
    { kind: 'choice', name: 'pick', label: '選択', options: ['甲', '乙'] },
    { kind: 'text', name: 'narrow', label: '短い欄', width: 100 },
  ] }] })
  const fields = allOps(layout).filter((o) => o.t === 'field')
  assert.deepEqual(fields.map((f) => f.name), ['name', 'ok', 'memo', 'pick', 'narrow'])
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
  const x0 = theme.left + 5 * theme.size
  for (const f of fields) {
    assert.ok(Math.abs(f.x - x0) < 1e-9)
    assert.equal(layout.tags[f.tag].role, 'Form')
  }
  assert.ok(Math.abs(byName.name.w - (theme.measure - 5 * theme.size)) < 1e-9)
  assert.ok(Math.abs(byName.name.h - 0.8 * theme.lineGap) < 1e-9)
  assert.equal(byName.name.value, '森田')
  assert.equal(byName.ok.w, 12)
  assert.equal(byName.ok.h, 12)
  assert.equal(byName.ok.value, true)
  assert.ok(byName.memo.h > 2.5 * theme.lineGap)
  assert.deepEqual(byName.pick.options, ['甲', '乙'])
  assert.equal(byName.narrow.w, 100)
  // 行の真ん中: 欄の中心の y が、その行の箱の中心
  const label = allOps(layout).find((o) => o.t === 'text' && textOf(o) === 'お名前')
  assert.ok(isGrid(label.y))
  const rowTop = label.y - (theme.baseline(0) - theme.top)
  assert.ok(Math.abs(byName.name.y + byName.name.h / 2 - (rowTop + theme.lineGap / 2)) < 1e-6)
  // 次の項目は 1 行下（multiline は 3 行ぶん下）
  assert.ok(Math.abs(byName.memo.y - byName.ok.y - (theme.lineGap + (0.1 * theme.lineGap - (theme.lineGap - 12) / 2) )) < 1e-6)
  assert.ok(layout.fonts.includes('sans'))
})

test('記入欄: 長い label も 1 行に収まるよう列が広がり、版面の 4 割を超えない', () => {
  const long = '個人情報の取り扱いに同意する'
  const { layout } = build({ title: '記入', blocks: [{ type: 'fields', items: [
    { kind: 'check', name: 'ok', label: long },
    { kind: 'text', name: 'name', label: 'お名前' },
  ] }] })
  const fields = allOps(layout).filter((o) => o.t === 'field')
  const labels = allOps(layout).filter((o) => o.t === 'text' && textOf(o) === long)
  assert.equal(labels.length, 1, '長い label は 1 行のまま')
  const x = fields[0].x - theme.left
  assert.ok(x >= 14 * theme.size && x <= 0.4 * theme.measure + 1e-9, `列の幅 ${x}`)
  assert.ok(Math.abs(fields[1].x - fields[0].x) < 1e-9, '欄の左端はそろう')

  // 版面の 4 割を超える label は折り返す
  const huge = '長い'.repeat(40)
  const r = build({ title: '記入', blocks: [{ type: 'fields', items: [{ kind: 'text', name: 'a', label: huge }] }] })
  const f = allOps(r.layout).find((o) => o.t === 'field')
  assert.ok(f.x - theme.left <= 0.4 * theme.measure + 1e-9)
  assert.ok(allOps(r.layout).filter((o) => o.t === 'text' && /^(長い)+$/.test(textOf(o))).length >= 2)
})

test('箇条書き: 頭の印を 1.5em に置き中身は 1.5em 下げる・2 段目は更に 1.5em・タグは L > LI > Lbl・LBody', () => {
  const { layout } = build({ title: '箇条', blocks: [{ type: 'list', ordered: false, items: [T('一つ目の項目'), { text: T('二つ目の項目'), ordered: true, items: [T('入れ子の項目')] }] }, { type: 'list', ordered: true, items: [T('第一'), T('第二')] }] })
  const ops = allOps(layout).filter((o) => o.t === 'text')
  const dot = ops.filter((o) => textOf(o) === String.fromCodePoint(0x30fb))
  assert.equal(dot.length, 2)
  const one = ops.find((o) => textOf(o) === '一つ目の項目')
  const nested = ops.find((o) => textOf(o) === '入れ子の項目')
  assert.ok(Math.abs(one.glyphs[0].x - (theme.left + 1.5 * theme.size)) < 1e-6)
  assert.ok(Math.abs(nested.glyphs[0].x - (theme.left + 3 * theme.size)) < 1e-6)
  const role = (i) => layout.tags[i].role
  assert.equal(role(one.tag), 'LBody')
  assert.equal(role(layout.tags[one.tag].parent), 'LI')
  assert.equal(role(layout.tags[layout.tags[one.tag].parent].parent), 'L')
  assert.equal(role(dot[0].tag), 'Lbl')
  assert.equal(layout.tags[dot[0].tag].parent, layout.tags[one.tag].parent)
  // 入れ子の L は親の LBody の子
  assert.equal(role(layout.tags[layout.tags[nested.tag].parent].parent), 'L')
  assert.equal(role(layout.tags[layout.tags[layout.tags[nested.tag].parent].parent].parent), 'LBody')
  // 番号は右寄せ「1.」「2.」
  const nums = ops.filter((o) => /^\d\.$/.test(textOf(o)) && roleOf(layout, o) === 'Lbl')
  assert.ok(nums.length >= 3)
  for (const o of nums) assert.ok(o.glyphs[o.glyphs.length - 1].x + 3 <= theme.left + 3 * theme.size + 1)
  // 項目の最初の行と頭の印は同じ基線
  assert.equal(dot[0].y, one.y)
})

test('箇条書きは項目の中で 1 行だけを残して割らない', () => {
  const items = []
  for (let i = 0; i < 40; i++) items.push(T(body(i % 3 ? 130 : 60, i)))
  const { layout } = build({ title: '長い箇条', blocks: [{ type: 'list', ordered: false, items }] })
  assert.ok(layout.pages.length >= 2)
  layout.tags.forEach((t, tag) => {
    if (t.role !== 'LBody') return
    const byPage = linesByPage(layout, tag)
    const total = [...byPage.values()].reduce((s, v) => s + v.size, 0)
    if (total >= 2 && byPage.size > 1) for (const ys of byPage.values()) assert.ok(ys.size >= 2)
  })
})

test('要点: 版面を個数で等分した箱（間 8pt）・上に 1pt の ink の罫・label 8pt sub・value 14pt 明朝の太字・note 8pt sub・タグ Table > TR > TD', () => {
  const { layout } = build({ title: '要点', blocks: [{ type: 'keys', items: [{ label: '売上', value: '1,234円', note: '前年比 +12%' }, { label: '利益', value: '56円' }, { label: '件数', value: '7件' }] }] })
  const ops = allOps(layout)
  const rules = ops.filter((o) => o.t === 'rule' && o.w === 1)
  assert.equal(rules.length, 3)
  const boxW = (theme.measure - 16) / 3
  rules.forEach((r, i) => {
    assert.ok(Math.abs(r.x1 - (theme.left + i * (boxW + 8))) < 1e-9)
    assert.ok(Math.abs(r.x2 - r.x1 - boxW) < 1e-9)
    assert.equal(r.color, theme.colors.ink)
  })
  const val = ops.find((o) => o.t === 'text' && textOf(o).includes('1,234'))
  assert.equal(val.size, 14)
  assert.equal(val.font, 'minchoBold')
  const lab = ops.find((o) => o.t === 'text' && textOf(o) === '売上')
  assert.equal(lab.size, 8)
  assert.equal(lab.color, theme.colors.sub)
  const note = ops.find((o) => o.t === 'text' && textOf(o).includes('前年比'))
  assert.equal(note.size, 8)
  assert.ok(lab.y < val.y && val.y < note.y)
  const td = layout.tags[val.tag]
  assert.equal(td.role, 'TD')
  assert.equal(layout.tags[td.parent].role, 'TR')
  assert.equal(layout.tags[layout.tags[td.parent].parent].role, 'Table')
})

test('囲み: 左に 2pt の ink の縦の罫・地は tint・label は 9pt sansBold・文は本文の大きさで格子の上・タグ Note', () => {
  const { layout } = build({ title: '囲み', blocks: [{ type: 'card', label: '補足', text: T(body(200)) }] })
  const ops = allOps(layout)
  const bar = ops.find((o) => o.t === 'rule' && o.w === 2)
  assert.ok(bar)
  assert.equal(bar.color, theme.colors.ink)
  assert.equal(bar.x1, bar.x2)
  assert.ok(bar.y2 > bar.y1)
  const bg = ops.find((o) => o.t === 'rect' && o.fill === theme.colors.tint)
  assert.ok(bg)
  const label = ops.find((o) => o.t === 'text' && textOf(o) === '補足')
  assert.equal(label.size, 9)
  assert.equal(label.font, 'sansBold')
  assert.equal(layout.tags[label.tag].role, 'Note')
  assert.ok(isGrid(label.y))
  const text = ops.filter((o) => o.t === 'text' && o.size === theme.size && layout.tags[o.tag ?? 0]?.role === 'Note')
  assert.ok(text.length >= 3)
  for (const o of text) {
    assert.ok(isGrid(o.y))
    assert.ok(o.glyphs[0].x >= theme.left + 2 + 8 - 1e-6)
  }
  assert.ok(bg.y < label.y - 8 && bg.y + bg.h > text[text.length - 1].y)
})

test('引用: 左に 1pt の rule の色の縦の罫・2em 下げ・タグ BlockQuote。罫: 格子の 1 行の真ん中に 0.5pt の rule の色', () => {
  const { layout } = build({ title: '引用', blocks: [{ type: 'quote', text: T(body(200)) }, { type: 'rule' }, { type: 'para', text: T(body(80)) }] })
  const ops = allOps(layout)
  const bar = ops.find((o) => o.t === 'rule' && o.w === 1 && o.x1 === o.x2)
  assert.ok(bar)
  assert.equal(bar.color, theme.colors.rule)
  const q = ops.filter((o) => o.t === 'text' && roleOf(layout, o) === 'BlockQuote')
  assert.ok(q.length >= 2)
  for (const o of q) {
    assert.ok(Math.abs(o.glyphs[0].x - (theme.left + 2 * theme.size)) < 1e-6 || o.glyphs[0].x > theme.left + 2 * theme.size - theme.size)
    assert.ok(isGrid(o.y))
  }
  const hr = ops.find((o) => o.t === 'rule' && o.w === 0.5 && o.y1 === o.y2 && o.y1 !== theme.foot.ruleY)
  assert.ok(hr)
  assert.equal(hr.color, theme.colors.rule)
  // 罫の真ん中は、その行の箱の中心（行の基線から (行送り − 字の大きさ)/2 + 0.88 字 を引いた箱の上端の、半行下）
  const top = hr.y1 - theme.lineGap / 2
  assert.ok(Math.abs(((top - theme.top) / theme.lineGap) % 1) < 1e-6 || Math.abs((((top - theme.top) / theme.lineGap) % 1) - 1) < 1e-6)
})

test('図: chart・svg・image の Op に Figure の tag が付く（ClipOp の中も）・alt・caption は 8pt sub の Caption で Figure の子', () => {
  const { layout, warnings } = build(richInput(), IMAGES)
  const figures = layout.tags.map((t, i) => [t, i]).filter(([t]) => t.role === 'Figure')
  assert.equal(figures.length, 3)
  assert.deepEqual(figures.map(([t]) => t.alt), ['月別の売上', '四角の図', '小さな画像'])
  const figTags = new Set(figures.map(([, i]) => i))
  let clips = 0
  const check = (ops) => {
    for (const op of ops) {
      if (op.t === 'clip') { clips++; check(op.ops); continue }
      if (figTags.has(op.tag)) continue
    }
  }
  check(layout.pages.flatMap((p) => p.ops))
  assert.ok(clips >= 1, 'チャートは ClipOp を使う')
  // チャートの中の Op は全部 Figure の tag
  const chartFig = figures[0][1]
  const chartClip = layout.pages.flatMap((p) => p.ops).find((o) => o.t === 'clip' && flat(o.ops).some((x) => x.tag === chartFig))
  assert.ok(chartClip)
  for (const op of flat(chartClip.ops)) assert.equal(op.tag, chartFig, `${op.t}`)
  const img = allOps(layout).find((o) => o.t === 'image')
  assert.ok(img)
  assert.ok(figTags.has(img.tag))
  assert.ok(Math.abs(img.w / img.h - 2) < 1e-9, '縦横比を守る')
  assert.ok(img.w <= theme.measure + 1e-9)
  const cap = allOps(layout).find((o) => o.t === 'text' && textOf(o) === '月別の売上')
  assert.equal(cap.size, 8)
  assert.equal(cap.color, theme.colors.sub)
  assert.equal(layout.tags[cap.tag].role, 'Caption')
  assert.ok(figTags.has(layout.tags[cap.tag].parent))
  assert.ok(!warnings.some((w) => w.includes('灰色')))
})

test('図の高さの既定は幅の 0.5 倍・頁の残りに入らなければ次の頁へ', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="#888"/></svg>'
  const blocks = []
  for (let i = 0; i < 4; i++) blocks.push({ type: 'para', text: T(body(1500, i)) })
  blocks.push({ type: 'svg', source: svg, alt: '図' })
  const { layout } = build({ title: '図の頁', blocks })
  const pageOf = layout.pages.findIndex((p) => flat(p.ops).some((o) => o.t === 'path' && layout.tags[o.tag ?? 0]?.role === 'Figure'))
  assert.ok(pageOf >= 0)
  const paths = flat(layout.pages[pageOf].ops).filter((o) => o.t === 'path')
  assert.ok(paths.length >= 1)
  // 図は頁の途中で切れず、版面の中に収まる
  const rects = flat(layout.pages[pageOf].ops).filter((o) => o.t === 'path' && o.fill === '#888888')
  assert.ok(rects.length >= 1)
})

test('画像が無い時は灰の四角と warnings', () => {
  const { layout, warnings } = build({ title: '無い画像', blocks: [{ type: 'image', path: 'none.png', alt: '無い' }] }, {})
  assert.ok(allOps(layout).some((o) => o.t === 'rect' && o.fill === theme.colors.tint && layout.tags[o.tag].role === 'Figure'))
  assert.ok(warnings.some((w) => w.includes('none.png')))
})

test('fonts は使った書体だけで、Op の書体はすべて入っている', () => {
  const { layout } = build({ title: '書体', blocks: [{ type: 'para', text: T(body(80)) }] })
  const used = new Set(allOps(layout).filter((o) => o.t === 'text').map((o) => o.font))
  assert.deepEqual(new Set(layout.fonts), used)
  assert.ok(!layout.fonts.includes('sansBold'))
  const rich = build(richInput(), IMAGES).layout
  const richUsed = new Set(allOps(rich).filter((o) => o.t === 'text').map((o) => o.font))
  for (const f of richUsed) assert.ok(rich.fonts.includes(f))
})

test('compose の warnings は検査と組版をつなぎ、同じ文は 1 回', () => {
  const { warnings } = build({ title: 'w', blocks: [{ type: 'image', path: 'a.png', alt: 'x' }, { type: 'image', path: 'a.png', alt: 'x' }] }, {})
  assert.equal(new Set(warnings).size, warnings.length)
  assert.ok(warnings.filter((w) => w.includes('a.png')).length <= 1)
})

test('同じ入力からは同じ Layout（乱数も時計も使わない）', () => {
  const a = build(richInput(), IMAGES).layout
  const b = build(richInput(), IMAGES).layout
  assert.deepEqual(a, b)
})

test('作った Layout は renderPdf に通り、頁の数が合う', async () => {
  const { layout } = build(richInput(), IMAGES)
  const fontBytes = Object.fromEntries(FONT_IDS.map((id) => [id, bytes[id]]))
  const pdf = await renderPdf(layout, { fontBytes })
  assert.equal(pdf.pages, layout.pages.length)
  assert.ok(pdf.bytes > 5000 && pdf.bytes < 4 * 1024 * 1024)
  assert.ok(!pdf.warnings.some((w) => w.includes('tag') || w.includes('Layout.fonts')), pdf.warnings.join('|'))
})

test('10 頁ほどの文書（段落 60・表 2・チャート 1）を 600 ms 以内に組む', () => {
  const blocks = []
  const chart = { type: 'chart', option: { xAxis: { type: 'category', data: ['1', '2', '3', '4'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [3, 5, 2, 8] }] }, caption: '推移' }
  const table = () => ({ type: 'table', head: [T('項目'), T('金額'), T('前年比'), T('備考')], rows: Array.from({ length: 25 }, (_, i) => [T('項目' + i), T(String(i * 1234) + '円'), T('+' + i + '.5%'), T(i % 4 ? '短い' : '折り返すかもしれない少し長い説明のセルです')]) })
  for (let i = 0; i < 60; i++) {
    if (i % 12 === 0) blocks.push({ type: 'heading', level: 2, text: T('節 ' + i) })
    blocks.push({ type: 'para', text: [{ text: body(200 + (i % 5) * 40, i) }, { text: '重要', bold: true }, { text: 'な点と' }, { text: '用語', ruby: 'ようご' }, { text: 'の説明。' }] })
    if (i === 15) blocks.push(table())
    if (i === 30) blocks.push(chart)
    if (i === 45) blocks.push(table())
  }
  const input = { title: '速さの試験', author: '森田', blocks }
  // 1 回目は JIT と書体の寸法の覚えこみで遅い。並列の試験の巻き添えもあるので、4 回の最良を見る（test/helpers/timing.mjs）
  const { ms, value: { layout }, times } = fastest(() => build(input), 4)
  assert.ok(layout.pages.length >= 8 && layout.pages.length <= 14, `頁の数 ${layout.pages.length}`)
  assert.ok(ms < 600, fmtTimes(times))
})

// ---- 本文の大きさに合わせた寸法（本文 12.5pt など）

test('本文が大きい文書では、題名・見出し・表・要点・囲みの見出し・図の説明が theme.scale 倍になり、見出しは本文より大きい', () => {
  const size = 12.5
  const big = makeTheme({ size })
  const { layout } = build({ title: '大きい字', author: '見本', size, blocks: [
    { type: 'heading', level: 1, text: T('見出し一') },
    { type: 'heading', level: 2, text: T('見出し二') },
    { type: 'heading', level: 3, text: T('見出し三') },
    { type: 'para', text: T('本文です。') },
    { type: 'table', head: [T('項目'), T('値')], rows: [[T('行'), T('42')]] },
    { type: 'keys', items: [{ label: '比べた道具', value: '3 種', note: '説明' }] },
    { type: 'card', label: '補足', text: T('囲みの文。') },
    { type: 'svg', source: FIG_SVG, alt: '図', height: 40, caption: '図の説明' },
  ] })
  const ops = allOps(layout).filter((o) => o.t === 'text')
  const sizeOf = (s) => ops.find((o) => textOf(o) === s)?.size
  assert.equal(big.scale, size / 9.5)
  assert.equal(sizeOf('大きい字'), big.title.size)
  assert.equal(sizeOf('見出し一'), big.head.h1.size)
  assert.equal(sizeOf('見出し二'), big.head.h2.size)
  assert.equal(sizeOf('見出し三'), big.head.h3.size)
  assert.equal(sizeOf('本文です。'), size)
  for (const h of ['見出し一', '見出し二', '見出し三']) assert.ok(sizeOf(h) >= size * 1.1 - 0.05, `${h} は本文の 1.1 倍以上`)
  assert.equal(sizeOf('項目'), 8.5 * big.scale)
  assert.equal(sizeOf('比べた道具'), 8 * big.scale)
  assert.equal(sizeOf('3 種'), 14 * big.scale)
  assert.equal(sizeOf('補足'), 9 * big.scale)
  assert.equal(sizeOf('図の説明'), 8 * big.scale)
})

test('本文が 9.5pt 以下の文書では、表・要点・囲み・図の説明は今までの大きさのまま（7pt を割らず、本文に近づけない）', () => {
  for (const size of [8, 9]) {
    const { layout } = build({ title: '小さい字', size, blocks: [
      { type: 'table', head: [T('項目')], rows: [[T('行')]] },
      { type: 'keys', items: [{ label: '比べた道具', value: '3 種' }] },
      { type: 'svg', source: FIG_SVG, alt: '図', height: 40, caption: '図の説明' },
    ] })
    const ops = allOps(layout).filter((o) => o.t === 'text')
    const sizeOf = (s) => ops.find((o) => textOf(o) === s)?.size
    assert.deepEqual([sizeOf('項目'), sizeOf('比べた道具'), sizeOf('3 種'), sizeOf('図の説明')], [8.5, 8, 14, 8], `本文 ${size}pt`)
  }
})

test('見出しの罫は直後の段落の 1 行目のルビの頭に触れない（本文 9.5pt でも 12.5pt でも）', () => {
  for (const size of [9.5, 12.5]) {
    const th = makeTheme({ size })
    for (const level of [1, 2]) {
      const { layout } = build({ title: '罫とルビ', size, blocks: [
        { type: 'heading', level, text: T('見出し') },
        { type: 'para', text: [{ text: '漢字', ruby: 'かんじ' }, { text: 'の読みを上に付けた段落です。' + body(60) }] },
      ] })
      const ops = allOps(layout)
      const head = ops.find((o) => o.t === 'text' && textOf(o) === '見出し')
      const rule = ops.find((o) => o.t === 'rule' && o.w === th.head[`h${level}`].rule && o.y1 > head.y)
      const rt = ops.find((o) => o.t === 'text' && textOf(o) === 'かんじ')
      assert.ok(rule && rt, `本文 ${size}pt の h${level}`)
      assert.ok(rule.y1 < head.y + 0.25 * th.head[`h${level}`].size, '罫は見出しの字のすぐ下')
      const rubyEmTop = rt.y - 0.88 * rt.size
      assert.ok(rule.y1 + rule.w / 2 <= rubyEmTop + 1e-6, `本文 ${size}pt の h${level}: 罫の下端 ${rule.y1 + rule.w / 2} がルビの上端 ${rubyEmTop} に触れる`)
    }
  }
})
