// 資料（kind: deck）の入口の試験（claude plugin test）。make の資料の引数・revise・/pdf sample deck・横長の欄。
// 書体は tests/test-fonts.ts の小さな書体なので、PDF に載る日本語は tests/texts.ts の字だけ（足すなら texts.ts と build-test-fonts を）。
// 資料の題は D の字（一冊目・二冊目・三頁・見積書・申込書）を使い、本文は ASCII で書く。
import { expect, test as baseTest } from 'claude-code/testing'
import { PANE, b64OfText, stubAll, until } from './kit'
import { D } from './texts'
import { applyOps, pageTitles, parseOps, reviseDeck } from '../hooks/lib/deck.mjs'
import { PANE_CELL, paneSizeFor, paneTree } from '../hooks/lib/pane.mjs'
import { makeAnswer, reviseAnswer } from '../hooks/lib/report.mjs'
import { imagePathsOf } from '../hooks/lib/image.mjs'

const test = (name: string, fn: any) => baseTest(name, { timeoutMs: 30_000 }, fn)

const START = { surface: 'desktop', isInteractive: true, cwd: '/work' } as const
const TOOL = (name: string) => `mcp__mods-pdf__${name}` as const
const OUT = (name: string) => `pdf/${name}.pdf`

const slide = (layout: string, title: string, extra: Record<string, unknown> = {}) => ({ type: 'slide', layout, title, ...extra })
const three = () => [
  slide('cover', D.first, { lead: 'Lead line' }),
  slide('content', D.second, { blocks: [{ type: 'para', text: 'Body text of the second slide.' }] }),
  slide('closing', D.three, { items: [{ text: 'Next step' }] }),
]
const titles = (rec: any): string[] => rec.input.slides.map((s: any) => s.title)

// ---- 直しの部品（本体を通さない） ----

test('revise の ops は順に当たり、差し替え・挿入・削除・移動で枚の並びが変わる', async () => {
  const base = ['a', 'b', 'c', 'd']
  const parsed = parseOps([
    { action: 'replace', index: 2, slide: { layout: 'content', title: 'B2' } },
    { action: 'insert', index: 1, slide: { layout: 'cover', title: 'X' } },
    { action: 'delete', index: 5 },
    { action: 'move', index: 1, to: 4 },
  ])
  expect(parsed.ok).toBe(true)
  const applied = applyOps(base, (parsed as any).ops)
  expect(applied.ok).toBe(true)
  // a b c d → a B2 c d → X a B2 c d → X a B2 c → a B2 c X
  expect((applied as any).slides.map((s: any) => (typeof s === 'string' ? s : s.title))).toEqual(['a', 'B2', 'c', 'X'])
  expect((applied as any).summary).toEqual(['2 枚目を差し替え', '1 枚目に挿入', '5 枚目を削除', '1 枚目を 4 枚目へ移動'])
})

test('revise は 1 つでも範囲の外なら何も変えず、何番目の op がなぜ失敗したかを理由に書く', async () => {
  const base = ['a', 'b']
  const parsed = parseOps([{ action: 'delete', index: 1 }, { action: 'delete', index: 9 }, { action: 'delete', index: 1 }]) as any
  const applied = applyOps(base, parsed.ops) as any
  expect(applied.ok).toBe(false)
  expect(applied.reason).toContain('ops[2]')
  expect(applied.reason).toContain('今は 1 枚')
  expect(base).toEqual(['a', 'b'])
  // insert は末尾の次（枚数 + 1）まで
  expect((applyOps(base, (parseOps([{ action: 'insert', index: 3, slide: { layout: 'content' } }]) as any).ops) as any).ok).toBe(true)
  expect((applyOps(base, (parseOps([{ action: 'insert', index: 4, slide: { layout: 'content' } }]) as any).ops) as any).ok).toBe(false)
})

test('revise は ops が JSON の字で届いても読み、index が数字の字でも通し、型の違う op は理由つきで断る', async () => {
  const text = JSON.stringify([{ action: 'delete', index: '2' }])
  expect(parseOps(text)).toEqual({ ok: true, ops: [{ action: 'delete', index: 2 }] })
  for (const [raw, want] of [
    [[], '配列'],
    ['でたらめ', '配列'],
    [[{ action: 'remove', index: 1 }], 'action'],
    [[{ action: 'delete', index: 0 }], 'index'],
    [[{ action: 'delete', index: 1.5 }], 'index'],
    [[{ action: 'move', index: 1 }], 'to'],
    [[{ action: 'replace', index: 1 }], 'slide'],
  ] as [unknown, string][]) {
    const r = parseOps(raw) as any
    expect(r.ok).toBe(false)
    expect(r.reason).toContain(want)
  }
  expect((parseOps(new Array(61).fill({ action: 'delete', index: 1 })) as any).reason).toContain('60 個まで')
})

test('revise は type を省いた slide に type: slide を足し、最後の 1 枚を消して資料を空にする op を断る', async () => {
  const r = parseOps([{ action: 'insert', index: 1, slide: { layout: 'content', title: 'T' } }]) as any
  expect(r.ops[0].slide).toEqual({ type: 'slide', layout: 'content', title: 'T' })
  const all = applyOps(['only'], (parseOps([{ action: 'delete', index: 1 }]) as any).ops) as any
  expect(all.ok).toBe(false)
  expect(all.reason).toContain('1 枚は残して')
})

test('reviseDeck は資料でない入力を断り、theme と paper が使える値かを確かめ、広げ方（markdown・template・plan）を外す', async () => {
  const notDeck = reviseDeck({ title: 't', markdown: '# a' }, { ops: [{ action: 'delete', index: 1 }] }) as any
  expect(notDeck.ok).toBe(false)
  expect(notDeck.reason).toContain('資料')
  const deck = { kind: 'deck', title: 't', slides: three() }
  expect((reviseDeck(deck, { theme: 'neon' }) as any).reason).toContain('theme')
  expect((reviseDeck(deck, { paper: 'B0' }) as any).reason).toContain('paper')
  expect((reviseDeck(deck, {}) as any).reason).toContain('直す物がありません')
  const ok = reviseDeck(deck, { paper: 'wide', theme: 'vivid', title: 'new', ops: [{ action: 'delete', index: 3 }] }) as any
  expect(ok.ok).toBe(true)
  expect(ok.input).toMatchObject({ kind: 'deck', title: 'new', paper: 'wide', theme: 'vivid' })
  expect(ok.input.slides.length).toBe(2)
  // 元の入力は書き換えない
  expect(deck.slides.length).toBe(3)
  const planned = reviseDeck({ kind: 'deck', title: 't', template: 'bizplan', plan: {}, slides: three() }, { paper: 'A4' }) as any
  expect(planned.input.template).toBe('bizplan')
})

test('pageTitles は 1 枚に題が 2 つあれば題（level 2）を先に見せ、長い題を切る', async () => {
  const t = pageTitles([
    { title: 'Chapter', level: 1, page: 0 },
    { title: 'Slide title', level: 2, page: 0 },
    { title: 'x'.repeat(40), level: 2, page: 1 },
  ], 3)
  expect(t[0]).toBe('Slide title')
  expect(t[1].length).toBe(25)
  expect(t[1].endsWith('…')).toBe(true)
  expect(t[2]).toBe('')
})

test('欄に頼む行は頁が横長なほど少なく、A4 の縦で 33 行', async () => {
  const portrait = paneSizeFor(595.28, 841.89)
  const landscape = paneSizeFor(841.89, 595.28)
  const wide = paneSizeFor(960, 540)
  expect(portrait).toEqual({ rows: 33, columns: 54 })
  expect(landscape.rows).toBeLessThan(portrait.rows)
  expect(wide.rows).toBeLessThan(landscape.rows)
  expect(wide.rows >= 12).toBe(true)
})

// ---- 本体の道具 ----

test('session.start は revise と pdf_examples を含む 7 つの道具を登録する', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  expect([...s.tools].sort()).toEqual(['fields', 'fill', 'make', 'merge', 'pdf_examples', 'revise', 'stamp'])
})

test('make は資料（kind: deck）を横 A4 の 1 枚 = 1 頁で組み、枚数と枚の題を答え、store に資料として残す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: three() })
  expect(out.result).toContain(`書きました: ${OUT('deck')}（3 枚`)
  expect(out.result).toContain('枚の題: 1 ')
  const pdf = s.written[OUT('deck')]
  expect(pdf.startsWith('%PDF-')).toBe(true)
  expect(/[^\x00-\x7f]/.test(pdf)).toBe(false)
  expect(/\/MediaBox\s*\[\s*0\s+0\s+841\.8\d*\s+595\.2\d*\s*\]/.test(pdf)).toBe(true)
  const last = s.store.get('pdf:last') as any
  expect(last.path).toBe(OUT('deck'))
  expect(last.input.kind).toBe('deck')
  expect(last.input.slides.length).toBe(3)
})

test('資料の make の答えは検査の件数を付け、中身の薄い枚は頁と埋まりの率で知らせる', async ($, on) => {
  stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'checked', kind: 'deck', slides: [slide('content', D.second, { blocks: [{ type: 'para', text: 'Short.' }] })] })
  expect(out.result).toContain('検査: 字の重なり 0・箱の外 0・「…」の切れ 0・空いた枚 1')
  expect(out.result).toMatch(/1 頁: 本文の区域の \d+% しか埋まっていない/)
})

test('pdf_examples は目録を語で引き、id で見本の option を返し、形の違う id は断る', async ($, on) => {
  const catalog = [{ id: 'bar-simple', title: 'Basic Bar', titleCN: 'x', category: ['bar'], series: ['bar'], flags: { paper: true } }]
  const example = { id: 'bar-simple', title: 'Basic Bar', category: ['bar'], option: { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [1] }] }, flags: { paper: true } }
  const s = stubAll(on, { files: { 'assets/echarts/catalog.json': { base64: b64OfText(JSON.stringify(catalog)) }, 'assets/echarts/examples/bar-simple.json': { base64: b64OfText(JSON.stringify(example)) } } })
  await $.session.start(START)
  expect(s.tools).toContain('pdf_examples')
  const list = await $.tool.call({ tool: TOOL('pdf_examples'), query: 'bar' })
  expect(list.result).toContain('bar-simple')
  const one = await $.tool.call({ tool: TOOL('pdf_examples'), id: 'bar-simple' })
  expect(one.result).toContain('"series"')
  const bad = await $.tool.call({ tool: TOOL('pdf_examples'), id: '../x' })
  expect(bad.result).toContain('断りました')
})

test('資料の欄は横長の頁を出し、ボタンの文は「枚」になり、欄に頼む行は縦長より少ない', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: three() })
  const ui = await $.ui.mount(PANE())
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg!.props.width > svg!.props.height).toBe(true)
  const view = svg!.props.source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  expect(Number(view[1]) > Number(view[2])).toBe(true)
  expect(svg!.props.alt).toContain('1 / 3 枚')
  expect((await ui.find({ key: 'pdf:next' }))!.props.label).toBe('次の枚')
  expect(await ui.find({ type: 'Text', text: '1 / 3' })).toBeDefined()
  expect(s.opened.at(-1).rows).toBeLessThan(33)
  await ui.press({ key: 'pdf:next' })
  expect(await ui.find({ type: 'Text', text: '2 / 3' })).toBeDefined()
})

test('slides を渡して kind を書き忘れても資料として組む', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', slides: three() })
  expect(out.result).toContain('3 枚')
  expect((s.store.get('pdf:last') as any).input.kind).toBe('deck')
})

test("paper: 'wide' の資料は 960×540 の頁を書く", async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'wide', kind: 'deck', paper: 'wide', slides: three() })
  expect(out.result).toContain('書きました')
  expect(/\/MediaBox\s*\[\s*0\s+0\s+960\s+540\s*\]/.test(s.written[OUT('wide')])).toBe(true)
})

test('make の図は { kind, data } で呼べる（文書の blocks にも）', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const data = { items: [{ name: 'A', value: 60 }, { name: 'B', value: 30 }, { name: 'C', value: 10 }], unit: '%' }
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'figure', blocks: [{ type: 'heading', level: 1, text: D.first }, { type: 'chart', kind: 'donut', data, caption: 'Share', alt: 'Share of A B C' }] })
  expect(out.result).toContain(`書きました: ${OUT('figure')}`)
  expect(s.written[OUT('figure')].startsWith('%PDF-')).toBe(true)
})

test('revise は差し替え・挿入・削除・移動を同じ場所に書き直し、store の入力と欄に反映する', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: three() })

  const replace = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'replace', index: 2, slide: { layout: 'content', title: D.form } }] })
  expect(replace.result).toContain(`直して書きました: ${OUT('deck')}（3 枚`)
  expect(replace.result).toContain('2 枚目を差し替え')
  expect(titles(s.store.get('pdf:last'))).toEqual([D.first, D.form, D.three])

  const insert = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'insert', index: 1, slide: { layout: 'section', title: D.second } }] })
  expect(insert.result).toContain('（4 枚')
  expect(titles(s.store.get('pdf:last'))).toEqual([D.second, D.first, D.form, D.three])

  const move = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'move', index: 1, to: 4 }, { action: 'delete', index: 1 }] })
  expect(move.result).toContain('（3 枚')
  expect(titles(s.store.get('pdf:last'))).toEqual([D.form, D.three, D.second])

  // 書き直しは同じ名前の 1 ファイルだけ（-2 を増やさない）
  expect(Object.keys(s.written)).toEqual([OUT('deck')])
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: '1 / 3' })).toBeDefined()
})

test('revise は theme と paper と title も同じ場所に書き直して替える', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: three() })
  const out = await $.tool.call({ tool: TOOL('revise'), paper: 'wide', theme: 'mono', title: D.form })
  expect(out.result).toContain(`直して書きました: ${OUT('deck')}`)
  expect(/\/MediaBox\s*\[\s*0\s+0\s+960\s+540\s*\]/.test(s.written[OUT('deck')])).toBe(true)
  const last = s.store.get('pdf:last') as any
  expect(last).toMatchObject({ path: OUT('deck'), title: D.form })
  expect(last.input).toMatchObject({ paper: 'wide', theme: 'mono', title: D.form })
})

test('revise は範囲の外の index を、何も書かずに何番目の op かを添えて断る', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: three() })
  const pdf = s.written[OUT('deck')]
  const out = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 1 }, { action: 'delete', index: 99 }] })
  expect(out.result).toContain('断りました')
  expect(out.result).toContain('ops[2]')
  expect(out.deny).toBeUndefined()
  expect(s.written[OUT('deck')]).toBe(pdf)
  expect((s.store.get('pdf:last') as any).input.slides.length).toBe(3)
})

test('revise は直す資料が無い時と、資料でない文書と、最後でない path を、書かずに理由つきで断る', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const none = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 1 }] })
  expect(none.result).toContain('断りました')
  expect(none.result).toContain('直す資料がありません')

  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'plain', markdown: D.reportMd })
  const doc = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 1 }] })
  expect(doc.result).toContain('断りました')
  expect(doc.result).toContain('資料')
  expect(Object.keys(s.written)).toEqual([OUT('plain')])

  await $.tool.call({ tool: TOOL('make'), title: D.form, file: 'deck', kind: 'deck', slides: three() })
  const other = await $.tool.call({ tool: TOOL('revise'), path: OUT('plain'), ops: [{ action: 'delete', index: 1 }] })
  expect(other.result).toContain('断りました')
  expect(other.result).toContain('最後に組んだ資料')
  const empty = await $.tool.call({ tool: TOOL('revise') })
  expect(empty.result).toContain('断りました')
  expect(empty.result).toContain('ops')
})

test('revise は store に入力を残せない大きさの資料でも、同じ読み込みの間は直せる', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const big = three()
  ;(big[0] as any).notes = 'n'.repeat(210_000)
  await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'deck', kind: 'deck', slides: big })
  expect((s.store.get('pdf:last') as any).input).toBeUndefined()
  const out = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 3 }] })
  expect(out.result).toContain(`直して書きました: ${OUT('deck')}（2 枚`)
})

test('/pdf sample deck は事業計画の見本を sample-deck.pdf に書き、sample の見本とは別の名前にする', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.command.run({ command: 'pdf', args: 'sample deck' })
  expect(out.text).toMatch(/資料の見本を pdf\/sample-deck\.pdf に書きました（\d+ 枚）/)
  expect(s.written['pdf/sample-deck.pdf'].startsWith('%PDF-')).toBe(true)
  expect((s.store.get('pdf:last') as any).input.kind).toBe('deck')
  const bad = await $.command.run({ command: 'pdf', args: 'sample deck でたらめ' })
  expect(bad.text).toContain('使い方')
  const word = await $.command.run({ command: 'pdf', args: 'sample でたらめ' })
  expect(word.text).toContain('使い方')
})

test('revise は plan から広がった資料（見本）にも、広げた並びに直しを当てられる', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const made = await $.command.run({ command: 'pdf', args: 'sample deck' })
  const n = Number(made.text.match(/（(\d+) 枚）/)[1])
  expect(n >= 2).toBe(true)
  const out = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 2 }] })
  expect(out.result).toContain(`直して書きました: pdf/sample-deck.pdf（${n - 1} 枚`)
  const last = s.store.get('pdf:last') as any
  expect(last.input.plan).toBeUndefined()
  expect(last.input.template).toBeUndefined()
  expect(last.input.slides.length).toBe(n - 1)
})

test('revise は markdown を --- で割った資料にも、広げた並びに直しを当てられる', async ($, on) => {
  stubAll(on)
  await $.session.start(START)
  const markdown = ['# ' + D.first, '', '---', '', '## ' + D.second, '', 'Body.', '', '---', '', '## ' + D.three, '', '- A', '- B'].join('\n')
  const made = await $.tool.call({ tool: TOOL('make'), title: D.report, file: 'split', kind: 'deck', markdown })
  expect(made.result).toContain('（3 枚')
  const out = await $.tool.call({ tool: TOOL('revise'), ops: [{ action: 'delete', index: 1 }] })
  expect(out.result).toContain(`直して書きました: ${OUT('split')}（2 枚`)
})

test('文書が無い欄は「資料の見本を作る」ボタンを出し、押すと事業計画の見本を組む', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ key: 'pdf:sample' })).toBeDefined()
  expect(await ui.find({ key: 'pdf:sample-deck' })).toBeDefined()
  await ui.press({ key: 'pdf:sample-deck' })
  await until(() => s.written['pdf/sample-deck.pdf'] !== undefined, '資料の見本の書き込み', 20_000)
})

// ---- 答えと欄の部品（本体を通さない） ----

test('makeAnswer は資料なら枚数と枚の題を答え、行の揃え方の数字は出さず、はみ出しだけを知らせる', async () => {
  const text = makeAnswer({
    path: 'pdf/deck.pdf', pages: 3, bytes: 90_000, warnings: [], deck: true, titles: ['A', '', 'C'],
    stats: { lines: 80, justified: 70, maxSpread: 0.2, runts: 0, overfull: 0, missingGlyphs: [], lastPageFill: 0.4 },
    ms: { compose: 120, render: 300 },
  })
  expect(text).toContain('書きました: pdf/deck.pdf（3 枚・1 枚 = 1 頁・88 KB）')
  expect(text).toContain('枚の題: 1 A / 2 （題なし） / 3 C')
  expect(text).not.toContain('揃えた行')
  expect(text).not.toContain('組版:')
  expect(text).toContain('組版 120 ms')
  const over = makeAnswer({ path: 'pdf/deck.pdf', pages: 1, bytes: 1000, warnings: [], deck: true, titles: ['A'], stats: { overfull: 2, missingGlyphs: ['繝'] } })
  expect(over).toContain('組版: はみ出し 2・無い字 繝')
})

test('makeAnswer は 60 枚を超える題を ほか n 枚 にまとめる', async () => {
  const text = makeAnswer({ path: 'pdf/d.pdf', pages: 70, bytes: 1000, warnings: [], deck: true, titles: Array.from({ length: 70 }, (_, i) => `S${i + 1}`) })
  expect(text).toContain('60 S60')
  expect(text).toContain('ほか 10 枚')
  expect(text).not.toContain('61 S61')
})

test('reviseAnswer は当てた直しと、直した後の枚の題を答える', async () => {
  const text = reviseAnswer({ path: 'pdf/deck.pdf', pages: 2, bytes: 2048, warnings: ['x を捨てた'], summary: ['2 枚目を差し替え', '1 枚目を削除'], titles: ['A', 'B'], ms: { compose: 50, render: 80 } })
  expect(text).toContain('直して書きました: pdf/deck.pdf（2 枚・2 KB）')
  expect(text).toContain('直し: 2 枚目を差し替え・1 枚目を削除')
  expect(text).toContain('枚の題: 1 A / 2 B')
  expect(text).toContain('警告 1 件')
})

// 部品の表の作り物（Box・Text・Button・Svg を { type, props, children } にする）
const comps = Object.fromEntries(['Box', 'Text', 'Button', 'Svg'].map((type) => [type, (props: any = {}) => ({ type, props, children: props.children ?? [] })]))
const walk = (n: any, out: any[] = []) => { if (n && typeof n === 'object') { out.push(n); for (const c of n.children ?? []) walk(c, out) } return out }
const noop = () => {}
const MODEL = (over: any = {}) => ({
  surface: 'desktop', cols: 54, rows: 18, doc: { title: 'Deck', path: 'pdf/deck.pdf', pages: 4 }, deck: true, page: 0,
  svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', pageW: 841.89, pageH: 595.28,
  fonts: { loaded: 4, total: 4, ms: 1000, error: null }, note: null, busy: false, ...over,
})

test('paneTree は資料なら「前の枚・次の枚」と枚の alt にし、横長の頁を欄の幅いっぱいに置き、縦にも中央へ寄せる', async () => {
  const tree = paneTree(comps, MODEL(), { prev: noop, next: noop, open: noop, sample: noop })
  const label = (key: string) => walk(tree).find((n) => n.props?.key === key).props.label
  expect(label('pdf:prev')).toBe('前の枚')
  expect(label('pdf:next')).toBe('次の枚')
  const svg = walk(tree).find((n) => n.type === 'Svg')
  expect(svg.props.alt).toBe('Deck の 1 / 4 枚')
  expect(svg.props.width > svg.props.height).toBe(true)
  expect(svg.props.width <= 54 * PANE_CELL.w).toBe(true)
  const holder = walk(tree).find((n) => n.type === 'Box' && n.props.alignItems === 'center')
  expect(holder.props.justifyContent).toBe('center')
  // 文書の欄は今のまま「頁」
  const doc = paneTree(comps, MODEL({ deck: false }), { prev: noop, next: noop, open: noop, sample: noop })
  expect(walk(doc).find((n) => n.props?.key === 'pdf:next').props.label).toBe('次の頁')
})

test('paneTree は文書が無い時、資料の見本ボタンも出し、押すと sampleDeck が呼ばれる', async () => {
  const calls: string[] = []
  const tree = paneTree(comps, MODEL({ doc: null, svg: null, deck: false }), { prev: noop, next: noop, open: noop, sample: () => calls.push('sample'), sampleDeck: () => calls.push('deck') })
  walk(tree).find((n) => n.props?.key === 'pdf:sample').props.onPress()
  walk(tree).find((n) => n.props?.key === 'pdf:sample-deck').props.onPress()
  expect(calls).toEqual(['sample', 'deck'])
})

test('imagePathsOf は資料の slides の中の画像（blocks・left・right・side・figure）も重複なしで集める', async () => {
  const img = (path: string) => ({ type: 'image', path, alt: 'alt' })
  const paths = imagePathsOf({
    kind: 'deck',
    title: D.report,
    slides: [
      slide('content', D.first, { blocks: [img('a.png')] }),
      slide('split', D.second, { left: [img('b.png')], right: [img('a.png')] }),
      slide('figure', D.three, { figure: img('c.jpg'), side: [img('d.png')] }),
    ],
  })
  expect(paths.sort()).toEqual(['a.png', 'b.png', 'c.jpg', 'd.png'])
})
