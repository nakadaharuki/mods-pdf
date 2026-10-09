// 資料（deck）の 1 枚 = 1 頁の組版の試験。書体は本物を 1 回だけ読む。
// Doc を手で組んで layoutDoc に渡す（normalize を通さない）ので、schema の都合と切り離して lay-slide の約束だけを見る。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { makeTheme, PAPERS } from '../hooks/engine/theme.mjs'
import { layoutDoc } from '../hooks/engine/layout.mjs'
import { LAYOUTS } from '../hooks/engine/lay-slide.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const readBase64 = async (rel) => fs.readFileSync(path.join(fontsDir, rel)).toString('base64')
const bytes = await loadFontBytes(FONT_IDS, manifest, readBase64, new Map())
const metrics = makeMetrics(bytes)

const NOW = new Date(2026, 9, 9, 12).getTime()
const flat = (ops) => ops.flatMap((op) => (op.t === 'clip' ? flat(op.ops) : [op]))
const textOf = (op) => op.glyphs.map((g) => g.c).join('')
const textsOf = (page) => flat(page.ops).filter((o) => o.t === 'text')
const allOps = (layout) => layout.pages.flatMap((p) => flat(p.ops))
const PAGE_NO = /^\d+ \/ \d+$/

const P = (t) => ({ type: 'para', text: [{ text: t }] })
const LI = (...ts) => ({ type: 'list', ordered: false, items: ts.map((t) => [{ text: t }]) })
const CELL = (t) => [{ text: t }]

/** 図は描かずに、呼ばれた回数と受けた引数を数えるだけの代役。高さは決まった値を返す */
function stubFigure() {
  const calls = []
  const fn = (block, o) => {
    calls.push({ block, o })
    return { ops: [{ t: 'rect', x: o.x, y: o.y, w: Math.max(o.width, 1), h: 40, fill: '#CCCCCC' }], warnings: [], height: 150, alt: block.alt ?? '図の説明' }
  }
  fn.calls = calls
  return fn
}

/** 11 の型を 1 枚ずつ並べた資料。表紙で始まり、区切りの後に本文が続く */
const SLIDES = [
  { type: 'slide', layout: 'cover', kicker: '事業計画 2027', title: '現場の判断を、三倍速くする', lead: '建設・製造の現場データを、その日のうちに意思決定へ変える', by: '株式会社ミライ工房' },
  { type: 'slide', layout: 'statement', title: '承認の待ち時間を、30 分から 5 分に縮める。', lead: '導入先 41 社の実測では、待ち時間が平均 82% 減った。', sources: ['自社調べ 2026年9月'] },
  { type: 'slide', layout: 'section', title: '市場と課題', lead: 'まず、何が止まっているのかを確かめる。' },
  { type: 'slide', layout: 'content', title: '承認は、いまも紙とメールで止まっている', lead: '300 社への調査で、承認の遅れが最大の損失要因だった。', blocks: [P('承認の流れが人に依存しており、不在や出張で案件が数日止まる。'), LI('待ち時間は平均 2.4 日', '差し戻しの 63% は資料の不足')], sources: ['自社調査 2026年8月'] },
  { type: 'slide', layout: 'split', ratio: '5:7', title: '課題は 3 つに分けられる', left: [P('原因を 3 つに整理した。'), LI('情報がそろわない', '承認者が見つからない')], right: [{ type: 'chart', kind: 'donut', data: {}, alt: '止まった理由の内訳' }] },
  { type: 'slide', layout: 'figure', title: '市場は 2030 年に 1.4 兆円へ', figure: { type: 'chart', kind: 'bars', data: {}, alt: '市場規模の推移', caption: '国内市場（兆円）' }, side: [P('成長の 6 割は中堅企業の置き換え。')] },
  { type: 'slide', layout: 'kpi', title: '導入先は 1 年で 4 倍', items: [{ label: '導入企業数', value: '41', unit: '社', delta: '+310%', note: '前年同月 10 社' }, { label: '月間の承認件数', value: '1,284', unit: '件', delta: '+86%' }, { label: '解約率', value: '0.4', unit: '%', delta: '-0.3pt' }] },
  { type: 'slide', layout: 'compare', title: '既存の方法と比べる', items: [{ title: '紙・メール', points: ['承認に平均 2.4 日', '履歴が残らない'] }, { title: '統合パッケージ', points: ['導入に 6 か月'] }, { title: '私たち', highlight: true, points: ['最短 2 週間で開始', '履歴と監査証跡つき'] }] },
  { type: 'slide', layout: 'table', title: '3 か年の収支計画', blocks: [{ type: 'table', head: [CELL('項目'), CELL('2026'), CELL('2027')], rows: [[CELL('売上'), CELL('180'), CELL('520')], [CELL('営業利益'), CELL('▲84'), CELL('10')]] }] },
  { type: 'slide', layout: 'quote', title: '創業者の言葉', quote: '待ち時間そのものを、無くしたい。', by: '山田 太郎' },
  { type: 'slide', layout: 'closing', title: 'まず、1 現場で試してください', lead: '2 週間の無料の試用。', items: ['現場を 1 か所選ぶ', '2 週間の試用を始める'] },
]

/** @param {any[]} slides @param {{ themeName?: string, paper?: string, landscape?: boolean, figure?: any }} [o] */
function run(slides, { themeName = 'vivid', paper = 'A4', landscape, figure = stubFigure() } = {}) {
  const theme = makeTheme({ kind: 'deck', theme: themeName, paper, landscape })
  const doc = { kind: 'deck', title: '試験の資料', author: '試験者', lang: 'ja', theme: themeName, paper, slides }
  return { layout: layoutDoc(doc, { metrics, theme, images: {}, phrase: phraseBoundaries, now: NOW, figure }), theme, figure }
}

test('11 の型を 1 枚ずつ並べると、1 枚が 1 頁になる（theme と紙のどの組み合わせでも）', () => {
  assert.equal(Object.keys(LAYOUTS).length, 11)
  assert.equal(SLIDES.length, 11)
  for (const themeName of ['vivid', 'mono', 'koma', 'mergeble']) {
    for (const paper of Object.keys(PAPERS)) {
      const { layout, theme } = run(SLIDES, { themeName, paper })
      const label = `${themeName} ${paper}`
      assert.equal(layout.pages.length, 11, label)
      assert.deepEqual(layout.page, theme.page, label)
      for (const [i, pg] of layout.pages.entries()) assert.ok(pg.ops.length > 0, `${label} ${i + 1} 枚目が空`)
    }
  }
})

test('紙の大きさ: A4 は 841.89x595.28 の横、wide は 960x540 で landscape を false にしても横のまま', () => {
  assert.deepEqual(run(SLIDES).layout.page, { width: 841.89, height: 595.28 })
  for (const landscape of [undefined, false, true]) assert.deepEqual(run(SLIDES, { paper: 'wide', landscape }).layout.page, { width: 960, height: 540 }, String(landscape))
  assert.deepEqual(run(SLIDES, { landscape: false }).layout.page, { width: 595.28, height: 841.89 }, '縦と指定した時だけ縦')
})

test('全部の字は紙の中（左右・上下）にあり、7pt を割らない（縦の紙でも）', () => {
  for (const [paper, landscape] of [['A4', undefined], ['wide', undefined], ['A5', undefined], ['A4', false], ['Letter', false]]) {
    const { layout, theme } = run(SLIDES, { paper, landscape })
    for (const [i, pg] of layout.pages.entries()) {
      for (const op of textsOf(pg)) {
        const label = `${paper} ${landscape} ${i + 1} 枚目 ${textOf(op)}`
        assert.ok(op.size >= 7 - 1e-9, `${label} ${op.size}pt`)
        assert.ok(op.y > 0 && op.y < theme.page.height, `${label} y ${op.y}`)
        for (const g of op.glyphs) assert.ok(g.x >= -1 && g.x <= theme.page.width, `${label} x ${g.x}`)
      }
    }
  }
})

test('頁番号「n / N」は本文の枚だけにある（表紙・区切り・結びは番号を出さない）', () => {
  const { layout } = run(SLIDES)
  const numbered = layout.pages.map((pg) => textsOf(pg).filter((o) => PAGE_NO.test(textOf(o))).map(textOf))
  assert.deepEqual(numbered[0], [], '表紙')
  assert.deepEqual(numbered[2], [], '区切り')
  assert.deepEqual(numbered[10], [], '結び')
  for (const i of [1, 3, 4, 5, 6, 7, 8, 9]) assert.deepEqual(numbered[i], [`${i + 1} / 11`], `${i + 1} 枚目`)
})

test('出典は足に「出典: …」で出る（無い枚には出ない）', () => {
  const { layout } = run(SLIDES)
  const src = (i) => textsOf(layout.pages[i]).map(textOf).join('')
  assert.ok(src(1).includes('出典: 自社調べ 2026'), '2 枚目')
  assert.ok(src(3).includes('出典: 自社調査 2026'), '4 枚目')
  assert.ok(!src(6).includes('出典'), '7 枚目に出典は無い')
})

test('outline: 区切りは 1 段目・各枚の題は 2 段目で、頁は題のある枚。引用の題も同じに並ぶ', () => {
  const { layout } = run(SLIDES)
  const o = layout.outline
  const find = (title) => o.find((e) => e.title === title)
  assert.equal(find('現場の判断を、三倍速くする').level, 1, '表紙の題は最初の 1 段目')
  assert.equal(find('現場の判断を、三倍速くする').page, 0)
  assert.equal(find('市場と課題').level, 1)
  assert.equal(find('市場と課題').page, 2)
  assert.equal(find('承認は、いまも紙とメールで止まっている').level, 2)
  assert.equal(find('承認は、いまも紙とメールで止まっている').page, 3)
  assert.equal(find('創業者の言葉').level, 2, '引用の題も outline にある')
  assert.equal(find('創業者の言葉').page, 9)
  const pages = o.map((e) => e.page)
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b), '頁の順に並ぶ')
})

test('tag: 区切りと表紙の題は H1・各枚の題は H2 で、outline の題と同じものが tags にある（引用も）', () => {
  const { layout } = run(SLIDES)
  // 折り返した題は行ごとに別の TextOp になるので、頁ごと・役ごとにつなげて見る
  const heads = (role) => layout.pages.map((pg) => textsOf(pg).filter((o) => o.tag !== undefined && layout.tags[o.tag].role === role).map(textOf).join(''))
  assert.equal(heads('H1')[0], '現場の判断を、三倍速くする', '表紙')
  assert.equal(heads('H1')[2], '市場と課題', '区切り')
  assert.equal(heads('H2')[3], '承認は、いまも紙とメールで止まっている')
  assert.equal(heads('H2')[9], '創業者の言葉', '引用の題')
  assert.equal(heads('H2')[10], 'まず、1 現場で試してください', '結び')
  // outline の題は、その頁の H1 か H2 の字と同じ（section・表紙は H1、ほかは H2）
  for (const e of layout.outline) assert.ok([heads('H1')[e.page], heads('H2')[e.page]].includes(e.title), `outline ${e.title}`)
})

test('tag は読む順（題 → 本文 → 足）に並び、parent は全部有効。Op の tag は tags の中の番号', () => {
  const { layout } = run(SLIDES)
  assert.equal(layout.tags[0].role, 'Document')
  layout.tags.forEach((t, i) => {
    if (i === 0) return
    assert.ok(Number.isInteger(t.parent) && t.parent >= 0 && t.parent < layout.tags.length, `tag ${i} parent`)
  })
  for (const op of allOps(layout)) if (op.tag !== undefined) assert.ok(op.tag > 0 && op.tag < layout.tags.length)
  // 各頁で、題（H1/H2）の tag 番号は本文より小さい
  for (const [i, pg] of layout.pages.entries()) {
    const roles = textsOf(pg).filter((o) => o.tag !== undefined).map((o) => ({ role: layout.tags[o.tag].role, tag: o.tag }))
    const head = roles.find((r) => r.role === 'H1' || r.role === 'H2')
    const body = roles.find((r) => r.role === 'P' || r.role === 'L' || r.role === 'LI' || r.role === 'LBody')
    if (head && body) assert.ok(head.tag < body.tag, `${i + 1} 枚目: 題が本文より先`)
  }
})

test('試しの組み（入るかの試算）が tag を残さない: 空の tag は無く、同じ入力は同じ tags を作る', () => {
  const a = run(SLIDES).layout
  const b = run(SLIDES).layout
  assert.deepEqual(a.tags, b.tags)
  const used = new Set(allOps(a).filter((o) => o.tag !== undefined).map((o) => o.tag))
  const parents = new Set(a.tags.map((t) => t.parent))
  const orphan = a.tags.map((t, i) => i).filter((i) => i > 0 && !used.has(i) && !parents.has(i))
  assert.deepEqual(orphan, [], '字にも子にも使われない tag')
})

test('vivid の表紙・区切り・結びは光（radial の paint）を持ち、題は paint の字。mono には光も階調も無い', () => {
  const vivid = run(SLIDES, { themeName: 'vivid' }).layout
  for (const i of [0, 2, 10]) {
    const ops = flat(vivid.pages[i].ops)
    assert.ok(ops.some((o) => o.paint && o.paint.kind === 'radial'), `${i + 1} 枚目に光`)
    assert.ok(ops.some((o) => o.t === 'text' && o.paint && o.paint.kind === 'linear'), `${i + 1} 枚目に階調の字`)
  }
  const glow = flat(vivid.pages[0].ops).find((o) => o.paint && o.paint.kind === 'radial')
  assert.ok(glow.paint.stops.length >= 3 && glow.paint.stops.some((s) => s.opacity === 0), '光は縁で透明になる')
  const mono = run(SLIDES, { themeName: 'mono' }).layout
  assert.deepEqual(allOps(mono).filter((o) => o.paint), [], 'mono は paint を使わない')
})

test('mono の字と罫は ink と sub の 2 色だけ（up・down の増減と図を除く）', () => {
  const { layout, theme } = run(SLIDES.filter((s) => ['cover', 'content', 'closing', 'section', 'quote'].includes(s.layout)), { themeName: 'mono' })
  const ok = new Set([theme.colors.ink, theme.colors.sub, theme.colors.paper, theme.colors.tint, theme.colors.rule, theme.colors.accent].map((c) => c.toUpperCase()))
  for (const op of allOps(layout)) {
    const c = (op.color ?? op.fill ?? op.stroke)
    if (typeof c === 'string') assert.ok(ok.has(c.toUpperCase()), `${op.t} ${c}`)
  }
})

test('入らない時は字を段で下げ、それでも入らなければ後ろの block を落として警告する。次の枚には流さない', () => {
  const many = Array.from({ length: 40 }, (_, i) => P(`承認の流れが人に依存しており、担当者の不在や出張で案件が止まる。${i + 1} 番目の段落。`))
  const slides = [
    { type: 'slide', layout: 'content', title: '詰め込みすぎた枚', blocks: many },
    { type: 'slide', layout: 'content', title: '次の枚', blocks: [P('次の枚の本文。')] },
  ]
  const { layout, theme } = run(slides)
  assert.equal(layout.pages.length, 2, '頁は増えない')
  assert.ok(layout.warnings.some((w) => /^1 枚目（詰め込みすぎた枚）に入らない: .+/.test(w)), layout.warnings.join('\n'))
  assert.ok(!layout.warnings.some((w) => /^2 枚目/.test(w)), '次の枚の警告は無い')
  const next = textsOf(layout.pages[1]).map(textOf).join('')
  assert.ok(next.includes('次の枚の本文'), '次の枚は自分の本文だけ')
  assert.ok(!next.includes('番目の段落'), '落とした block は次の枚に出ない')
  // 最後の段階の大きさまで下げ、下端を超えない
  const body = textsOf(layout.pages[0]).filter((o) => textOf(o).includes('承認の流れ'))
  assert.ok(body.length > 0)
  const floor = theme.deck.sizes.body[theme.deck.sizes.body.length - 1]
  for (const op of body) {
    assert.equal(op.size, floor, '本文は最小の段')
    assert.ok(op.y < theme.page.height - theme.deck.margin.bottom, `y ${op.y}`)
  }
})

test('表が多すぎる時は行を切り、「n 枚目（題）に入らない: 表」と警告し、表の字は 7pt を割らない', () => {
  const rows = Array.from({ length: 60 }, (_, i) => [CELL(`項目 ${i + 1}`), CELL(String((i + 1) * 100)), CELL('備考')])
  const slides = [{ type: 'slide', layout: 'table', title: '長い表', blocks: [{ type: 'table', head: [CELL('項目'), CELL('金額'), CELL('備考')], rows }] }]
  const { layout } = run(slides)
  assert.equal(layout.pages.length, 1)
  assert.ok(layout.warnings.some((w) => /^1 枚目（長い表）に入らない: .*表/.test(w)), layout.warnings.join('\n'))
  const t = textsOf(layout.pages[0])
  assert.ok(t.every((o) => o.size >= 7))
  assert.ok(t.some((o) => textOf(o) === '項目 1'), '頭の方の行は残る')
  assert.ok(!t.some((o) => textOf(o) === '項目 60'), '後ろの行は切る')
})

test('入る枚は警告を出さず、字は本文の最初の段（12pt）以上。空きが大きい枚は上げた段（最大 20pt）の中のどれかになる', () => {
  const { layout, theme } = run(SLIDES)
  assert.deepEqual(layout.warnings, [])
  const sparse = textsOf(layout.pages[3]).filter((o) => textOf(o).includes('承認の流れ'))
  assert.ok(sparse.length > 0)
  const ladder = [...theme.deck.sizes.grow.body, ...theme.deck.sizes.body]
  for (const op of sparse) assert.ok(ladder.includes(op.size) && op.size >= theme.deck.sizes.body[0], `${op.size}`)
})

test('上げた段は大きい方から並び（本文 20・18・16・14）、通常の最初の段（12）より大きい。紙が小さくても通常の段を割らない', () => {
  for (const paper of Object.keys(PAPERS)) {
    const { grow, body, table } = makeTheme({ kind: 'deck', paper }).deck.sizes
    assert.equal(grow.body.length, 4, paper)
    assert.equal(grow.table.length, 4, paper)
    for (let i = 1; i < grow.body.length; i++) assert.ok(grow.body[i] <= grow.body[i - 1], `${paper} body ${grow.body}`)
    for (let i = 1; i < grow.table.length; i++) assert.ok(grow.table[i] <= grow.table[i - 1], `${paper} table ${grow.table}`)
    assert.ok(grow.body.every((v) => v >= body[0]) && grow.table.every((v) => v >= table[0]), paper)
  }
  assert.deepEqual(makeTheme({ kind: 'deck' }).deck.sizes.grow, { body: [20, 18, 16, 14], table: [16, 14.5, 13, 12] })
})

test('内容が少ない枚ほど字が大きく、増えるほど段を下げる。どの段でも本文の高さの 72% までに収まる（収まらなければ通常の段へ）', () => {
  const sizeOf = (n) => {
    const slides = [{ type: 'slide', layout: 'content', title: '題', blocks: [LI(...Array.from({ length: n }, (_, i) => `項目 ${i + 1}。説明の文がもう少し続く。`))] }]
    const { layout } = run(slides)
    return textsOf(layout.pages[0]).find((o) => textOf(o).startsWith('項目 1'))?.size
  }
  const sizes = [1, 3, 5, 7, 9, 12].map(sizeOf)
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] <= sizes[i - 1], `${sizes}`)
  assert.equal(sizes[0], 20, '1 項目だけなら最大')
  assert.ok(sizes[sizes.length - 1] <= 14, `多いなら上げない: ${sizes}`)
})

test('図は ctx.figure で描く: 図の tag は Figure で alt を持ち、図の幅は版面の中、caption は Caption', () => {
  const { layout, theme, figure } = run(SLIDES)
  assert.ok(figure.calls.length >= 2, '分割の図と図の枚で呼ぶ')
  for (const { o } of figure.calls) assert.ok(o.width > 0 && o.width <= theme.page.width - theme.left - theme.right + 1e-6, `width ${o.width}`)
  const figs = layout.tags.map((t, i) => ({ t, i })).filter((x) => x.t.role === 'Figure')
  assert.ok(figs.length >= 2)
  assert.ok(figs.some((x) => x.t.alt === '止まった理由の内訳'))
  assert.ok(figs.some((x) => x.t.alt === '市場規模の推移'))
  const caps = layout.tags.filter((t) => t.role === 'Caption')
  assert.equal(caps.length, 1)
  assert.ok(allOps(layout).some((o) => o.t === 'text' && textOf(o) === '国内市場（兆円）'))
})

test('図の警告は資料の warnings に出る', () => {
  const figure = () => ({ ops: [], warnings: ['図の試験の警告'], height: 100, alt: 'x' })
  const { layout } = run([SLIDES[5]], { figure })
  assert.ok(layout.warnings.includes('図の試験の警告'))
})

test('kpi は値・単位・増減・補足を持つカードを横に並べ、増減は up・down の色で描く', () => {
  const { layout, theme } = run([SLIDES[6]])
  const t = textsOf(layout.pages[0]).map(textOf)
  for (const s of ['導入企業数', '41', '社', '1,284', '件']) assert.ok(t.includes(s), s)
  const colors = textsOf(layout.pages[0]).filter((o) => /310%|86%|0\.3pt/.test(textOf(o))).map((o) => o.color)
  assert.ok(colors.includes(theme.colors.up) && colors.includes(theme.colors.down), colors.join())
})

test('compare は highlight の列だけ強調（枠の色が違う）で、列の数だけカードがある', () => {
  const { layout, theme } = run([SLIDES[7]])
  const rects = flat(layout.pages[0].ops).filter((o) => o.t === 'rect' && o.r)
  assert.ok(rects.length >= 3, `角丸の矩形 ${rects.length}`)
  const strokes = new Set(rects.map((o) => o.stroke).filter(Boolean))
  assert.ok(strokes.has(theme.colors.accent) || strokes.has(theme.colors.ink), [...strokes].join())
})

test('資料の中に空の枚・知らない型・題の無い枚があっても投げず、1 枚 1 頁を保つ', () => {
  const slides = [{ type: 'slide', layout: 'content' }, { type: 'slide', layout: 'nonsense', title: '知らない型' }, { type: 'slide', layout: 'section' }, { type: 'slide', layout: 'kpi', items: [] }]
  const { layout } = run(slides)
  assert.equal(layout.pages.length, 4)
})

test('slides が空の資料は空の頁を 1 枚だけ作って警告する', () => {
  const { layout } = run([])
  assert.equal(layout.pages.length, 1)
  assert.ok(layout.warnings.length >= 1)
})

test('compose（schema → theme → 組版）は資料を既定の vivid・A4 横で組み、警告なしで 1 枚 1 頁', () => {
  const input = {
    kind: 'deck', title: '試し',
    slides: [
      { layout: 'cover', title: '現場の判断を、三倍速くする', lead: '次の標準のはなし' },
      { layout: 'section', title: '市場と課題' },
      { layout: 'content', title: '承認は止まっている', blocks: [{ type: 'para', text: '承認の流れが人に依存している。' }, { type: 'list', items: ['待ち時間 2.4 日', '差し戻し 63%'] }] },
      { layout: 'kpi', title: '実績', items: [{ label: '導入', value: '41', unit: '社' }, { label: '承認', value: '1,284', unit: '件' }] },
      { layout: 'closing', title: 'まず試してください' },
    ],
  }
  const { layout, warnings } = compose(input, { metrics, phrase: phraseBoundaries, now: NOW })
  assert.equal(layout.pages.length, 5)
  assert.deepEqual(layout.page, { width: 841.89, height: 595.28 })
  assert.deepEqual(warnings, [])
  assert.ok(allOps(layout).some((o) => o.paint && o.paint.kind === 'radial'), '既定は vivid')
  assert.deepEqual(compose({ ...input, paper: 'wide', landscape: false }, { metrics, phrase: phraseBoundaries, now: NOW }).layout.page, { width: 960, height: 540 })
  assert.deepEqual(allOps(compose({ ...input, theme: 'mono' }, { metrics, phrase: phraseBoundaries, now: NOW }).layout).filter((o) => o.paint), [])
})

test('文書（doc）は資料の組版に入らない: 同じ入力は 1 頁以上の縦の A4 で、資料の印（H2 の題や「n / N」）を持たない', () => {
  const { layout } = compose({ title: '報告', blocks: [{ type: 'heading', level: 1, text: '見出し' }, { type: 'para', text: '本文。' }] }, { metrics, phrase: phraseBoundaries, now: NOW })
  assert.deepEqual(layout.page, { width: 595.28, height: 841.89 })
  assert.ok(!allOps(layout).some((o) => o.paint))
})

test('表の字は、入るなら表の最初の段（10pt）以上で、行の少ない表は 16pt まで大きくなる', () => {
  const { layout, theme } = run([SLIDES[8]])
  const cells = textsOf(layout.pages[0]).filter((o) => ['売上', '営業利益', '180', '520'].includes(textOf(o)))
  assert.ok(cells.length >= 4)
  for (const op of cells) assert.equal(op.size, theme.deck.sizes.grow.table[0])
  assert.equal(theme.deck.sizes.grow.table[0], 16)
  assert.deepEqual(layout.warnings, [])
})

test('look は広い箱で拡大して描く: zoom は幅 340pt 以下で 1、広いほど上がり、theme.deck.figureZoom（A4 横 1.35）で止まる。図の外の幅は変えない', () => {
  const theme = makeTheme({ kind: 'deck' })
  assert.equal(theme.deck.figureZoom, 1.35)
  assert.ok(makeTheme({ kind: 'deck', paper: 'wide' }).deck.figureZoom > 1.35)
  assert.equal(makeTheme({ kind: 'deck', paper: 'A5' }).deck.figureZoom >= 1, true)
  const { figure } = run(SLIDES)
  const split = figure.calls.find((c) => c.block.kind === 'donut')
  const full = figure.calls.find((c) => c.block.kind === 'bars')
  assert.ok(split.o.zoom > 1 && split.o.zoom < full.o.zoom, `split ${split.o.width} zoom ${split.o.zoom}`)
  assert.equal(full.o.zoom, theme.deck.figureZoom, `full ${full.o.width}`)
  const narrow = run([{ type: 'slide', layout: 'split', ratio: '7:5', title: '細い図', left: [P('本文。')], right: [{ type: 'chart', kind: 'donut', data: {}, alt: '細い' }] }]).figure.calls[0]
  assert.ok(narrow.o.width <= 340 && narrow.o.zoom === 1, `narrow ${narrow.o.width} zoom ${narrow.o.zoom}`)
})

// ---------------------------------------------------------------- 担当をまたいだ約束（schema が渡す物を lay-slide が正しく読む）

const pageText = (page) => textsOf(page).map(textOf).join('|')

test('枚の字に ** や {親字|るび} が残っていれば解いて組む: 題・要点の字に * が出ず、親字が並び、ルビは読みの字になる', () => {
  const slides = [
    { type: 'slide', layout: 'statement', title: '**強い**題と{漢字|かん|じ}', lead: '**ではなく**本文', sources: [] },
    { type: 'slide', layout: 'content', title: '見出し', blocks: [{ type: 'para', text: '**太字**と通常' }] },
    { type: 'slide', layout: 'quote', title: '引用', quote: '**待ち時間**を無くす', by: '誰か' },
  ]
  const { layout } = run(slides)
  for (const pg of layout.pages) assert.ok(!/[*{}]/.test(pageText(pg)), pageText(pg))
  assert.ok(pageText(layout.pages[0]).includes('強い題と|漢字'), '親字がつながる')
  assert.ok(pageText(layout.pages[0]).includes('かん') || pageText(layout.pages[0]).includes('じ'), 'ルビの読みが出る')
})

test('KPI の trend が delta の符号と違えば trend が勝つ（▲ → ▼）。trend が無ければ符号から決める', () => {
  const mk = (it) => run([{ type: 'slide', layout: 'kpi', title: '指標', items: [{ label: '解約率', value: '0.4', unit: '%', ...it }] }]).layout.pages[0]
  assert.ok(pageText(mk({ delta: '+5%', trend: 'down' })).includes('▼'))
  assert.ok(!pageText(mk({ delta: '+5%', trend: 'down' })).includes('▲'))
  assert.ok(pageText(mk({ delta: '+5%' })).includes('▲'))
  assert.ok(pageText(mk({ delta: '-0.3pt' })).includes('▼'))
  assert.ok(!/[▲▼]/.test(pageText(mk({ delta: '+5%', trend: 'flat' }))), 'flat は矢印なし')
})

test('区切り（section）の番号は slide.number を使い、無ければ「何番目の区切りか」を 2 桁にする。表紙の日付は slide.date が勝つ', () => {
  const slides = [
    { type: 'slide', layout: 'cover', title: '表紙', date: '2027年1月' },
    { type: 'slide', layout: 'section', title: '最初の区切り' },
    { type: 'slide', layout: 'section', title: '二つ目の区切り', number: '07' },
  ]
  const { layout } = run(slides)
  assert.ok(pageText(layout.pages[0]).includes('2027年1月'), pageText(layout.pages[0]))
  assert.ok(pageText(layout.pages[1]).includes('01'), pageText(layout.pages[1]))
  assert.ok(pageText(layout.pages[2]).includes('07'), pageText(layout.pages[2]))
  const withBy = run([{ type: 'slide', layout: 'cover', title: '表紙', by: '株式会社ミライ', date: '2027年1月' }]).layout.pages[0]
  assert.ok(pageText(withBy).replaceAll('|', '').includes('株式会社ミライ　2027年1月'), pageText(withBy))
})

test('締め（closing）の次の一手は 6 つまで並べ、7 つ目からは切る', () => {
  const items = Array.from({ length: 8 }, (_, i) => `一手その${i + 1}`)
  const { layout } = run([{ type: 'slide', layout: 'closing', title: '締め', items }])
  const t = pageText(layout.pages[0])
  assert.ok(t.includes('一手その6') && !t.includes('一手その7'), t)
})
