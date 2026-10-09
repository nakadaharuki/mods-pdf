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
import { LAYOUTS, laySlide } from '../hooks/engine/lay-slide.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'
import { opsBounds } from '../hooks/engine/inspect.mjs'

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

/** 12 の型を 1 枚ずつ並べた資料。表紙で始まり、区切りの後に本文が続く。grid は図・表・KPI・箇条書きの 4 つの panel */
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
  { type: 'slide', layout: 'grid', kicker: '導入の実績', title: '導入先は 41 社で、承認は 5 分で終わる', lead: '導入前後の実測を 4 つの panel で並べる。', panels: [
    { title: '導入企業数', kpi: [{ label: '導入企業数', value: '41', unit: '社', delta: '+310%' }, { label: '解約率', value: '0.4', unit: '%', delta: '-0.3pt' }] },
    { title: '承認の待ち時間', note: '平均（分）', blocks: [{ type: 'chart', kind: 'bars', data: {}, alt: '承認の待ち時間の推移' }], source: '自社調べ' },
    { title: '費用の内訳', blocks: [{ type: 'table', head: [CELL('項目'), CELL('金額')], rows: [[CELL('導入'), CELL('120')], [CELL('保守'), CELL('36')]] }] },
    { title: '次の一手', blocks: [LI('現場を 1 か所選ぶ', '2 週間の試用を始める')] },
  ] },
  { type: 'slide', layout: 'closing', title: 'まず、1 現場で試してください', lead: '2 週間の無料の試用。', items: ['現場を 1 か所選ぶ', '2 週間の試用を始める'] },
]

/** @param {any[]} slides @param {{ themeName?: string, paper?: string, landscape?: boolean, figure?: any }} [o] */
function run(slides, { themeName = 'vivid', paper = 'A4', landscape, figure = stubFigure() } = {}) {
  const theme = makeTheme({ kind: 'deck', theme: themeName, paper, landscape })
  const doc = { kind: 'deck', title: '試験の資料', author: '試験者', lang: 'ja', theme: themeName, paper, slides }
  return { layout: layoutDoc(doc, { metrics, theme, images: {}, phrase: phraseBoundaries, now: NOW, figure }), theme, figure }
}

test('12 の型を 1 枚ずつ並べると、1 枚が 1 頁になる（theme と紙のどの組み合わせでも）', () => {
  assert.equal(LAYOUTS.length, 12)
  assert.equal(SLIDES.length, 12)
  for (const themeName of ['vivid', 'mono', 'koma', 'mergeble']) {
    for (const paper of Object.keys(PAPERS)) {
      const { layout, theme } = run(SLIDES, { themeName, paper })
      const label = `${themeName} ${paper}`
      assert.equal(layout.pages.length, 12, label)
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
  assert.deepEqual(numbered[11], [], '結び')
  for (const i of [1, 3, 4, 5, 6, 7, 8, 9, 10]) assert.deepEqual(numbered[i], [`${i + 1} / 12`], `${i + 1} 枚目`)
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
  assert.equal(heads('H2')[10], '導入先は 41 社で、承認は 5 分で終わる', 'grid の題')
  assert.equal(heads('H2')[11], 'まず、1 現場で試してください', '結び')
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
  for (const i of [0, 2, 11]) {
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
  const { layout, theme } = run(SLIDES.filter((s) => ['cover', 'content', 'grid', 'closing', 'section', 'quote'].includes(s.layout)), { themeName: 'mono' })
  // 札（panel）の地は paper に tint を 55% 混ぜた色。mono の中の色なので 2 色の約束には含める
  const ok = new Set([theme.colors.ink, theme.colors.sub, theme.colors.paper, theme.colors.tint, theme.colors.rule, theme.colors.accent, theme.colors.up, theme.colors.down, '#F7F7F5', '#CCCCCC' /* 図の代役の色 */].map((c) => c.toUpperCase()))
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

test('入る枚は警告を出さず、本文の字は最初の段（A4 横で 9.5pt）以下の段の中のどれか。字を大きく上げる段は無い', () => {
  const { layout, theme } = run(SLIDES)
  assert.deepEqual(layout.warnings, [])
  const lines = textsOf(layout.pages[3]).filter((o) => textOf(o).includes('承認の流れ'))
  assert.ok(lines.length > 0)
  const ladder = theme.deck.sizes.body
  for (const op of lines) assert.ok(ladder.includes(op.size) && op.size <= ladder[0], `${op.size}`)
})

test('字を大きく上げる段（grow）は無い: sizes に grow が無く、内容が 1 項目だけの panel でも本文は最初の段を超えない。空きは panel を足して埋める', () => {
  for (const paper of Object.keys(PAPERS)) {
    const { sizes } = makeTheme({ kind: 'deck', paper }).deck
    assert.equal(sizes.grow, undefined, paper)
    const { body, table } = sizes
    for (const ladder of [body, table]) for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] <= ladder[i - 1], `${paper} ${ladder}`)
    assert.ok(body[0] <= 10.5 * (paper === 'wide' ? 960 / 841.89 : 1) + 1e-9, `${paper} 本文の最初の段 ${body[0]}`)
  }
  const sizeOf = (n) => {
    const slides = [{ type: 'slide', layout: 'content', title: '題', blocks: [LI(...Array.from({ length: n }, (_, i) => `項目 ${i + 1}。説明の文がもう少し続く。`))] }]
    const { layout, theme } = run(slides)
    return { size: textsOf(layout.pages[0]).find((o) => textOf(o).startsWith('項目 1'))?.size, first: theme.deck.sizes.body[0] }
  }
  for (const n of [1, 3, 6, 12]) {
    const { size, first } = sizeOf(n)
    assert.ok(size <= first + 1e-9, `${n} 項目: ${size}pt（最初の段 ${first}）`)
  }
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
  // 中身の薄い枚は検査が「空いた枚」と知らせる（組版の警告は無い）
  assert.deepEqual(warnings.filter((w) => !/しか埋まっていない/.test(w)), [])
  assert.equal(layout.meta.checks.sparse, warnings.length)
  assert.ok(allOps(layout).some((o) => o.paint && o.paint.kind === 'radial'), '既定は vivid')
  assert.deepEqual(compose({ ...input, paper: 'wide', landscape: false }, { metrics, phrase: phraseBoundaries, now: NOW }).layout.page, { width: 960, height: 540 })
  assert.deepEqual(allOps(compose({ ...input, theme: 'mono' }, { metrics, phrase: phraseBoundaries, now: NOW }).layout).filter((o) => o.paint), [])
})

test('文書（doc）は資料の組版に入らない: 同じ入力は 1 頁以上の縦の A4 で、資料の印（H2 の題や「n / N」）を持たない', () => {
  const { layout } = compose({ title: '報告', blocks: [{ type: 'heading', level: 1, text: '見出し' }, { type: 'para', text: '本文。' }] }, { metrics, phrase: phraseBoundaries, now: NOW })
  assert.deepEqual(layout.page, { width: 595.28, height: 841.89 })
  assert.ok(!allOps(layout).some((o) => o.paint))
})

test('表の字は、行が少なくても表の最初の段（A4 横で 8.5pt）を超えない（表を大きくして空きを埋めない）', () => {
  const { layout, theme } = run([SLIDES[8]])
  const cells = textsOf(layout.pages[0]).filter((o) => ['売上', '営業利益', '180', '520'].includes(textOf(o)))
  assert.ok(cells.length >= 4)
  for (const op of cells) assert.ok(op.size <= theme.deck.sizes.table[0] + 1e-9 && op.size >= theme.deck.sizes.table[theme.deck.sizes.table.length - 1] - 1e-9, `${op.size}`)
  assert.deepEqual(layout.warnings, [])
})

test('図は panel の箱の大きさで描く: zoom を渡さず、図に渡す幅は panel の中の幅（版面の幅より狭い）で、版面の幅いっぱいには引き伸ばさない', () => {
  const { figure, theme } = run(SLIDES)
  const full = theme.page.width - theme.deck.margin.left - theme.deck.margin.right
  assert.ok(figure.calls.length >= 3, '分割・図・grid の panel で呼ぶ')
  for (const { o } of figure.calls) {
    assert.ok(o.zoom === undefined || o.zoom === 1, `zoom ${o.zoom}`)
    assert.ok(o.width > 0 && o.width < full, `width ${o.width}`)
  }
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

// ---------------------------------------------------------------- KPI のロゴ

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#CC0000"/></svg>'
const logoCtx = (logos) => ({
  page: { width: 841.89, height: 595.28 }, index: 3, count: 6, theme: makeTheme({ kind: 'deck' }), metrics, images: {}, phrase: phraseBoundaries, lang: 'ja',
  section: '', sectionNo: 0, author: '', date: '', tag: () => 1, figure: stubFigure(), logos,
})
const kpiSlide = (logo) => ({ type: 'slide', layout: 'kpi', title: '主要な指標', items: [{ label: '売上', value: '1,284', unit: '億円', ...(logo ? { logo } : {}) }, { label: '利益', value: '84', unit: '億円' }] })
const logoRect = (r) => flat(r.ops).filter((o) => o.t === 'rect' && o.fill === '#CC0000' || o.t === 'path' && o.fill === '#CC0000')

test('KPI の item の logo は、logos に svg があればカードの右上に描き、無ければ何も描かず、渡された logos に無い字は warnings に 1 回書く', () => {
  const withLogo = laySlide(kpiSlide('NYSE:IBM'), logoCtx({ 'NYSE:IBM': LOGO_SVG }))
  const marks = logoRect(withLogo)
  assert.equal(marks.length, 1, 'ロゴは 1 つ')
  const page = withLogo.ops.filter((o) => o.t === 'rect' && o.w > 150 && o.h > 100)[0]
  assert.ok(page, 'カードの地')
  const at = opsBounds(marks)
  assert.ok(at.x0 > page.x + page.w / 2 && at.x1 <= page.x + page.w, `右: ${at.x0}`)
  assert.ok(at.y0 >= page.y && at.y1 < page.y + page.h / 2, `上: ${at.y0}`)
  assert.deepEqual(withLogo.warnings, [])

  const unwired = laySlide(kpiSlide('NYSE:IBM'), logoCtx(undefined))
  assert.equal(logoRect(unwired).length, 0)
  assert.deepEqual(unwired.warnings, [], 'logos を渡していない組みは黙って描かない')

  const missing = laySlide(kpiSlide('NYSE:IBM'), logoCtx({ 'NYSE:OTHER': LOGO_SVG }))
  assert.equal(logoRect(missing).length, 0)
  assert.equal(missing.warnings.length, 1)
  assert.match(missing.warnings[0], /NYSE:IBM/)
})

test('KPI のロゴを置いても、ラベルはロゴの左に収まり、ロゴの無いカードの組みは変わらない', () => {
  const plain = laySlide(kpiSlide(undefined), logoCtx({ 'NYSE:IBM': LOGO_SVG }))
  const again = laySlide(kpiSlide(undefined), logoCtx(undefined))
  assert.deepEqual(plain.ops, again.ops)
  const withLogo = laySlide(kpiSlide('NYSE:IBM'), logoCtx({ 'NYSE:IBM': LOGO_SVG }))
  const mark = opsBounds(logoRect(withLogo))
  const label = flat(withLogo.ops).filter((o) => o.t === 'text').find((o) => textOf(o) === '売上')
  assert.ok(label, 'ラベル')
  assert.ok(Math.max(...label.glyphs.map((g) => g.x)) + label.size <= mark.x0 + 0.5 || label.y - label.size > mark.y1, 'ラベルはロゴと重ならない')
})

test('compose に渡した logos は、資料の KPI の logo としてカードに描かれる（schema が item の logo を通し、compose が theme 経由で届ける）', () => {
  const input = { kind: 'deck', title: '指標', slides: [kpiSlide('NYSE:IBM')] }
  const { layout } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW, logos: { 'NYSE:IBM': LOGO_SVG } })
  assert.equal(logoRect({ ops: layout.pages[0].ops }).length, 1)
  const bare = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
  assert.equal(logoRect({ ops: bare.layout.pages[0].ops }).length, 0)
})

// ---------------------------------------------------------------- grid（panel を本文の区域いっぱいに詰める）

const gridCtx = (figure = stubFigure(), o = {}) => ({
  page: { width: 841.89, height: 595.28 }, index: 0, count: 1, theme: makeTheme({ kind: 'deck', ...o }), metrics, images: {}, phrase: phraseBoundaries, lang: 'ja',
  section: '', sectionNo: 0, author: '', date: '', tag: () => 1, figure,
})
/** panel の札（角丸で、線と地を持つ矩形）。頭の細い帯は r が無いので入らない */
const cardsOf = (r) => flat(r.ops).filter((o) => o.t === 'rect' && o.r && o.stroke && o.fill)
const textPanel = (i, n = 3) => ({ title: `panel ${i + 1}`, blocks: [LI(...Array.from({ length: n }, (_, k) => `項目 ${i + 1}-${k + 1}。説明の文が少し続く。`))] })
const kpiPanel = () => ({ title: '指標', kpi: [{ label: '売上', value: '120', unit: '億円', delta: '+4%' }, { label: '利益', value: '12', unit: '億円' }] })
const gridSlide = (panels, arrange) => ({ type: 'slide', layout: 'grid', title: '題は 1 行で言い切る', lead: '要点は 1〜2 行。', panels, ...(arrange ? { arrange } : {}) })
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

const ARRANGES = [
  ['1+2', 3], ['2x2', 4], ['3col', 3], ['1+3', 4], ['kpi+3', 4], ['2x3', 6],
  ['auto', 1], ['auto', 2], ['auto', 3], ['auto', 4], ['auto', 5], ['auto', 6], ['auto', 7], ['auto', 8], ['auto', 9],
  ['rows:2,3', 5], ['rows:1,2,2|0.5,1,2', 5],
]

test('どの並べ方でも panel は本文の区域の端から端まで使い切り（上下左右とも）、互いに重ならず、隙間は panel の間だけ', () => {
  for (const [arrange, n] of ARRANGES) {
    const panels = Array.from({ length: n }, (_, i) => (i === 0 && (arrange === 'kpi+3' || arrange.startsWith('rows:1')) ? kpiPanel() : textPanel(i)))
    const ctx = gridCtx()
    const r = laySlide(gridSlide(panels, arrange), ctx)
    const label = `${arrange} ${n} 個`
    const cards = cardsOf(r)
    assert.equal(cards.length, n, label)
    const { left, right } = ctx.theme.deck.margin
    const x0 = Math.min(...cards.map((c) => c.x))
    const x1 = Math.max(...cards.map((c) => c.x + c.w))
    const y0 = Math.min(...cards.map((c) => c.y))
    const y1 = Math.max(...cards.map((c) => c.y + c.h))
    assert.ok(Math.abs(x0 - left) < 0.5 && Math.abs(x1 - (ctx.page.width - right)) < 0.5, `${label} 左右 ${x0}..${x1}`)
    assert.ok(Math.abs(y0 - r.body.top) < 0.5 && Math.abs(y1 - (r.body.top + r.body.height)) < 0.5, `${label} 上下 ${y0}..${y1} 区域 ${r.body.top}..${r.body.top + r.body.height}`)
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(overlap(cards[i], cards[j]) < 0.01, `${label}: ${i + 1} と ${j + 1} が重なる`)
    const area = cards.reduce((a, c) => a + c.w * c.h, 0)
    assert.ok(area >= 0.88 * (x1 - x0) * (y1 - y0), `${label}: 隙間が大きい ${area}`)
  }
})

test('panel が 6 つでも、字は 7pt を割らず、本文は最後の段（A4 横で 8.5pt）以上。入らなければ落として警告する（字を小さくして入れない）', () => {
  const ctx = gridCtx()
  const { sizes } = ctx.theme.deck
  const r = laySlide(gridSlide(Array.from({ length: 6 }, (_, i) => textPanel(i, 5))), ctx)
  const texts = flat(r.ops).filter((o) => o.t === 'text')
  assert.ok(texts.length > 20)
  for (const op of texts) assert.ok(op.size >= 7 - 1e-9, `${textOf(op)} ${op.size}pt`)
  const body = texts.filter((o) => /^項目 \d-\d/.test(textOf(o)))
  assert.ok(body.length > 0)
  for (const op of body) assert.ok(op.size >= sizes.body[sizes.body.length - 1] - 1e-9, `${textOf(op)} ${op.size}pt`)
  const heavy = laySlide(gridSlide(Array.from({ length: 6 }, (_, i) => textPanel(i, 60))), gridCtx())
  assert.ok(heavy.warnings.some((w) => /に入らない/.test(w)), heavy.warnings.join('\n'))
  for (const op of flat(heavy.ops).filter((o) => o.t === 'text')) assert.ok(op.size >= 7 - 1e-9, `${op.size}pt`)
})

test('panel の中身が多い枚は、いちばん小さい段まで試してから落とす。落とした panel は区域の中に残り、はみ出さない', () => {
  const ctx = gridCtx()
  const r = laySlide(gridSlide(Array.from({ length: 4 }, (_, i) => textPanel(i, 40))), ctx)
  for (const c of cardsOf(r)) assert.ok(c.y + c.h <= r.body.top + r.body.height + 0.5)
  const bottom = r.body.top + r.body.height
  for (const op of flat(r.ops).filter((o) => o.t === 'text' && !PAGE_NO.test(textOf(o)))) assert.ok(op.y <= bottom + 1, `${textOf(op)} y ${op.y}`)
})

test('図の panel は札の中の寸法で図を描く（高さも渡す）。図は panel の幅を超えず、字の下限 7.5pt は図に渡す', () => {
  const figure = stubFigure()
  const r = laySlide(gridSlide([{ title: '図', note: '単位: 億円', blocks: [{ type: 'chart', kind: 'bars', data: {}, alt: '図の説明' }], source: '自社調べ' }, textPanel(1), textPanel(2)], '1+2'), gridCtx(figure))
  assert.equal(figure.calls.length, 1)
  const { o } = figure.calls[0]
  const card = cardsOf(r).sort((a, b) => a.x - b.x)[0]
  assert.ok(o.width > 0 && o.width < card.w && o.width > card.w * 0.8, `width ${o.width} 札 ${card.w}`)
  assert.ok(o.height > 0 && o.height < card.h, `height ${o.height} 札 ${card.h}`)
  assert.equal(o.zoom === undefined || o.zoom === 1, true)
  const t = flat(r.ops).filter((x) => x.t === 'text').map(textOf).join('|')
  assert.ok(t.includes('単位: 億円') && t.includes('出典: 自社調べ'), t)
})

test('rows の並べ方: 行の panel の数と高さの重みで決まり、KPI だけの行は重みでなく自然な高さの帯になる。数が合わなければ auto にして警告する', () => {
  const ctx = gridCtx()
  const r = laySlide(gridSlide([kpiPanel(), textPanel(1), textPanel(2), textPanel(3)], 'rows:1,1,2|0,1,3'), ctx)
  assert.deepEqual(r.warnings, [])
  const rows = cardsOf(r).sort((a, b) => a.y - b.y || a.x - b.x)
  assert.equal(rows.length, 4)
  const [band, a, b, c] = rows
  assert.ok(band.h < 130, `KPI の帯は低い: ${band.h}`)
  assert.ok(Math.abs(a.h * 3 - c.h) < 1, `行の高さの比 1:3 → ${a.h}:${c.h}`)
  assert.equal(b.y, c.y, '3 行目は 2 つ並ぶ')

  const bad = laySlide(gridSlide([textPanel(0), textPanel(1)], 'rows:2,2'), gridCtx())
  assert.ok(bad.warnings.some((w) => /rows:2,2/.test(w) && /auto/.test(w)), bad.warnings.join('\n'))
  assert.equal(cardsOf(bad).length, 2)
})

test('旧 11 の型の本文（content・split・figure・kpi・compare・table）も panel の札に入って組まれる。札の数は型ごとに決まる', () => {
  const count = (i) => cardsOf(laySlide(SLIDES[i], gridCtx())).length
  assert.equal(count(3), 1, 'content は 1 枚の札')
  assert.equal(count(4), 2, 'split は左右の 2 枚')
  assert.equal(count(6), 1, 'kpi は 1 枚の札に項目を並べる')
  assert.equal(count(7), 3, 'compare は列の数')
  assert.equal(count(8), 1, 'table は 1 枚の札')
})

test('本文の区域の埋まり（body.used / height）: 空いた枚は 0.85 を割り、図と KPI で満たした枚は 0.85 以上。表紙・区切り・結びは body を持たない', () => {
  const thin = laySlide(gridSlide([textPanel(0, 1), textPanel(1, 1)]), gridCtx())
  assert.ok(thin.body.used / thin.body.height < 0.85, `${thin.body.used / thin.body.height}`)
  const full = laySlide(gridSlide([kpiPanel(), { title: '図', blocks: [{ type: 'chart', kind: 'bars', data: {}, alt: '図' }] }, { title: '図 2', blocks: [{ type: 'chart', kind: 'donut', data: {}, alt: '図' }] }], 'rows:1,2|0,1'), gridCtx())
  assert.ok(full.body.used / full.body.height >= 0.85, `${full.body.used / full.body.height}`)
  for (const i of [0, 2, 11]) assert.equal(laySlide(SLIDES[i], gridCtx()).body, undefined, `${i + 1} 枚目`)
})
