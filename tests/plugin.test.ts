// Mod の入口の試験（claude plugin test。セッション・ログイン・ネットは要らない）。
// 書体は tests/test-fonts.ts の小さな書体（字を絞った本物）。字形の美しさと本物の書体 14 MB の通りは scripts/hook-env-check.mjs が確かめる。
// PDF に組む日本語は tests/texts.ts に集めてある。足したら node scripts/build-test-fonts.mjs で書体を作り直す。
import { expect, test as baseTest } from 'claude-code/testing'
import { PANE, b64OfText, stubAll, tickFonts, until } from './kit'
import { D } from './texts'
import { isOwnPdf } from '../hooks/lib/paths.mjs'

// 組版と PDF の生成は純 JS で数百 ms かかるので、時間の上限は 20 秒にする
const test = (name: string, fn: any) => baseTest(name, { timeoutMs: 20_000 }, fn)

const START = { surface: 'desktop', isInteractive: true, cwd: '/work' } as const
const TOOL = (name: string) => `mcp__mods-pdf__${name}` as const
const OUT = (name: string) => `pdf/${name}.pdf`
// 1x1 の PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('session.start は道具 6 つと /pdf を登録する', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  expect([...s.tools].sort()).toEqual(['fields', 'fill', 'make', 'merge', 'revise', 'stamp'])
  expect(s.commands).toContain('pdf')
})

test('書体は 1 秒ごとに 1 つずつ読み、欄の上の行に進み具合と秒が出る', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  let ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /書体を読み込み中 0\/4/ })).toBeDefined()
  await ui.unmount()

  await tickFonts(s, 1)
  ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /書体を読み込み中 1\/4/ })).toBeDefined()
  await ui.unmount()

  await tickFonts(s, 3)
  ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /書体の読み込み [0-9.]+ 秒/ })).toBeDefined()
  await ui.unmount()

  // 読み終えたら時計は止まり、これ以上読まない
  const reads = s.reads.length
  await s.clock.advance(5000)
  expect(s.reads.length).toBe(reads)
})

test('文書が無い欄は案内と「見本を作る」ボタンを出す', async ($, on) => {
  stubAll(on)
  await $.session.start(START)
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /まだ文書がありません/ })).toBeDefined()
  expect(await ui.find({ key: 'pdf:sample' })).toBeDefined()
})

test('make は ./pdf/ の下に PDF を書き、頁数と組版の数字を答え、欄をその文書に替える', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(out.result).toContain(`書きました: ${OUT(D.report)}（`)
  expect(out.result).toMatch(/（\d+ 頁/)
  expect(out.result).toContain('組版: 行')

  const pdf = s.written[OUT(D.report)]
  expect(pdf.startsWith('%PDF-')).toBe(true)
  expect(/%%EOF\s*$/.test(pdf)).toBe(true)
  // fs.write は字だけを書くので、PDF は 7 ビットの字でなければならない
  expect(/[^\x00-\x7f]/.test(pdf)).toBe(false)
  expect(pdf).toContain('/Outlines')

  expect(s.opened.at(-1)).toMatchObject({ id: 'mods-pdf' })
  const ui = await $.ui.mount(PANE())
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(svg!.props.source.startsWith('<svg')).toBe(true)
  expect(svg!.props.source.length <= 131072).toBe(true)
  expect(svg!.props.alt).toContain(D.report)
  expect(await ui.find({ type: 'Text', text: /1 \/ \d+/ })).toBeDefined()
})

test('make は組み直しのために最後の入力を store に残す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  const last = s.store.get('pdf:last') as any
  expect(last.path).toBe(OUT(D.report))
  expect(last.input.title).toBe(D.report)
  expect(last.input.markdown).toBe(D.reportMd)
})

test('title の無い make は投げず、Claude が直せる理由を result で返す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), markdown: D.noTitleMd })
  expect(out.result).toContain('make に失敗しました')
  expect(out.deny).toBeUndefined()
  expect(Object.keys(s.written)).toEqual([])
})

test('make の書く名前は掃除され、必ず pdf/ の下の 1 ファイルになる', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.weird, file: '../../evil:name', markdown: D.weirdMd })
  const keys = Object.keys(s.written)
  expect(keys.length).toBe(1)
  expect(keys[0]).toMatch(/^pdf\/[^/\\:]+\.pdf$/)
  // 区切りは掃除で - になるので、.. が残っても 1 つのファイル名の中の字で、フォルダーを上へ辿る意味を持たない
  expect(keys[0].split('/').length).toBe(2)
})

test('make は作業フォルダーの画像を読んで入れ、PNG に見えない物は警告にして続ける', async ($, on) => {
  const s = stubAll(on, { files: { 'pic.png': { base64: PNG }, 'fake.png': { base64: b64OfText(D.fakeContent.replace(/[^\x00-\x7f]/g, 'x')) } } })
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.pic, markdown: D.picMd })
  expect(out.result).toContain(`書きました: ${OUT(D.pic)}`)
  expect(out.result).toContain('PNG か JPEG として読めなかった')
  expect(/\/Subtype\s*\/Image/.test(s.written[OUT(D.pic)])).toBe(true)
})

test('fields は記入欄を一覧にし、PDF の字はデータとして読めと context で添える', async ($, on) => {
  stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  const out = await $.tool.call({ tool: TOOL('fields'), path: OUT(D.form) })
  expect(out.result).toContain('記入欄 3 個')
  for (const name of [D.nameField, D.agreeField]) expect(out.result).toContain(JSON.stringify(name))
  expect(out.result).toContain('PDF の座標（pt・左下が原点）')
  expect(Array.isArray(out.context) && out.context.length >= 1).toBe(true)
})

test('fill は日本語の値を欄に入れ、PDF に無い名前は missing として答える', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  const out = await $.tool.call({ tool: TOOL('fill'), path: OUT(D.form), values: { [D.nameField]: D.person, [D.agreeField]: true, [D.noSuchField]: 'x' } })
  expect(out.result).toContain(`書きました: ${OUT(`${D.form}-filled`)}`)
  expect(out.result).toContain('埋めた欄 2 個')
  expect(out.result).toContain('PDF に無い名前 1 個')
  expect(s.written[OUT(`${D.form}-filled`)].startsWith('%PDF-')).toBe(true)

  const back = await $.tool.call({ tool: TOOL('fields'), path: OUT(`${D.form}-filled`) })
  expect(back.result).toContain(D.person)
})

test('fill は values がオブジェクトでなければ書かずに断る', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  const out = await $.tool.call({ tool: TOOL('fill'), path: OUT(D.form), values: 'ただの文字列' })
  expect(out.result).toContain('断りました')
  expect(s.written[OUT(`${D.form}-filled`)]).toBeUndefined()
})

test('stamp は mm の位置に字を書き込み、頁が範囲の外なら理由を result で返す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  const out = await $.tool.call({ tool: TOOL('stamp'), path: OUT(D.report), marks: [{ page: 1, x: 20, y: 30, text: D.person }, { page: 1, x: 20, y: 40, text: 'ABC', size: 9 }], file: D.stampFile })
  expect(out.result).toContain(`書きました: ${OUT(D.stampFile)}（字を 2 か所`)
  expect(s.written[OUT(D.stampFile)].startsWith('%PDF-')).toBe(true)

  const bad = await $.tool.call({ tool: TOOL('stamp'), path: OUT(D.report), marks: [{ page: 99, x: 1, y: 1, text: 'x' }] })
  expect(bad.result).toContain('stamp に失敗しました')
  expect(bad.result).toContain('範囲の外')
})

test('merge は複数の PDF から選んだ頁をつないで 1 つにする', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd })
  await $.tool.call({ tool: TOOL('make'), title: D.second, markdown: D.secondMd })
  const out = await $.tool.call({ tool: TOOL('merge'), parts: [{ path: OUT(D.first), pages: '1-2' }, { path: OUT(D.second) }], file: D.merged })
  expect(out.result).toContain(`書きました: ${OUT(D.merged)}（2 個の PDF から 3 頁`)
  expect(s.written[OUT(D.merged)].startsWith('%PDF-')).toBe(true)
})

test('読めない path は理由つきで断り、ファイルの中身は読みに行かない', async ($, on) => {
  const s = stubAll(on, {
    files: {
      'notes.txt': { base64: b64OfText('x') },
      'big.pdf': { base64: 'AAAA', size: 4 * 1024 * 1024 },
      'out.pdf': { base64: 'AAAA', outside: true },
    },
  })
  await $.session.start(START)
  const cases: [string, string][] = [
    ['/etc/passwd', '使えません'],
    ['C:/Windows/win.ini', '使えません'],
    ['../x.pdf', '.. を含む'],
    ['notes.txt', '読めるのは pdf'],
    ['missing.pdf', 'ファイルがありません'],
    ['big.pdf', '大きすぎます'],
    ['out.pdf', '作業フォルダーの外'],
  ]
  for (const [path, want] of cases) {
    const out = await $.tool.call({ tool: TOOL('fields'), path })
    expect(out.result).toMatch(/^断りました/)
    expect(out.result).toContain(want)
    expect(out.deny).toBeUndefined()
  }
  expect(s.reads).toEqual([])
})

test('欄の頁送りは最後の頁で止まり、戻せる', async ($, on) => {
  stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.three, markdown: D.threeMd })
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: '1 / 3' })).toBeDefined()
  await ui.press({ key: 'pdf:next' })
  expect(await ui.find({ type: 'Text', text: '2 / 3' })).toBeDefined()
  expect((await ui.find({ type: 'Svg' }))!.props.alt).toContain('2 / 3')
  await ui.press({ key: 'pdf:next' })
  await ui.press({ key: 'pdf:next' })
  expect(await ui.find({ type: 'Text', text: '3 / 3' })).toBeDefined()
  await ui.press({ key: 'pdf:prev' })
  expect(await ui.find({ type: 'Text', text: '2 / 3' })).toBeDefined()
})

test('端末の欄は絵を描かず、題名と場所を字で出す', async ($, on) => {
  stubAll(on)
  await $.session.start({ ...START, surface: 'terminal' })
  await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  const ui = await $.ui.mount(PANE('terminal', 100, 30))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: D.report })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(OUT(D.report)) })).toBeDefined()
})

test('「開く」は押した出来事の中では何も始めず、時計の後で PowerShell に場所を環境変数で渡す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'pdf:open' })
  expect(s.ran.length).toBe(0)
  await s.clock.advance(300)
  await until(() => s.ran.length === 1, '開く外のプログラムの起動')
  const run = s.ran[0]
  expect(run.env!.MPDF_FILE.endsWith(`${D.report}.pdf`)).toBe(true)
  if (run.argv[0] === 'powershell.exe') {
    expect(run.argv.join(' ')).toContain('Start-Process -FilePath $env:MPDF_FILE')
    // 場所をコマンドの字に埋めない（字の中の記号が命令として読まれるのを防ぐ）
    expect(run.argv.join(' ').includes(D.report)).toBe(false)
  }
})

test('/pdf は欄を開き、sample で見本を作り、open は文書が無ければ案内する', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)

  const none = await $.command.run({ command: 'pdf', args: 'open' })
  expect(none.text).toContain('開く文書がありません')
  const usage = await $.command.run({ command: 'pdf', args: 'でたらめ' })
  expect(usage.text).toContain('使い方')

  const plain = await $.command.run({ command: 'pdf', args: '' })
  expect(plain).toEqual({})
  expect(s.opened.at(-1)).toMatchObject({ id: 'mods-pdf', focus: true, closeOnEscape: true })

  const sample = await $.command.run({ command: 'pdf', args: 'sample' })
  expect(sample.text).toMatch(/pdf\/sample\.pdf に書きました（\d+ 頁）/)
  expect(s.written['pdf/sample.pdf'].startsWith('%PDF-')).toBe(true)
})

test('読み直しの後は store の記録の入力から前の文書を組み直し、PDF は書き直さない', async ($, on) => {
  const s = stubAll(on, {
    store: { 'pdf:last': { path: OUT(D.prev), title: D.prev, pages: 1, input: { title: D.prev, markdown: D.prevMd } } },
  })
  await $.session.start(START)
  let ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()

  await tickFonts(s, 4)
  await until(async () => {
    const m = await $.ui.mount(PANE())
    const found = (await m.find({ type: 'Svg' })) !== undefined
    await m.unmount()
    return found
  }, '前の文書の組み直し')
  ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: new RegExp(D.prev) })).toBeDefined()
  expect(Object.keys(s.written)).toEqual([])
})

test('入力が大きすぎて残せなかった前の文書は、組み直せない旨を欄の 1 行に出す', async ($, on) => {
  stubAll(on, { store: { 'pdf:last': { path: OUT(D.big), title: D.big, pages: 80 } } })
  await $.session.start(START)
  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /大きすぎて組み直せません/ })).toBeDefined()
})

test('make は既にある別のファイルを上書きせず、-2 を付けた名前に書いて警告で知らせ、自分が書いた物は書き直せる', async ($, on) => {
  const s = stubAll(on, { files: { [OUT(D.report)]: { base64: b64OfText('%PDF-1.4 hand made') } } })
  await $.session.start(START)
  const first = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(first.result).toContain(`書きました: ${OUT(`${D.report}-2`)}`)
  expect(first.result).toContain('上書きせず')
  // 元の物はそのまま
  expect(s.written[OUT(D.report)]).toBeUndefined()
  expect(s.files[OUT(D.report)].base64).toBe(b64OfText('%PDF-1.4 hand made'))

  // 直して書き直す時は、自分が書いた -2 を上書きし、-3 を増やさない
  const again = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(again.result).toContain(`書きました: ${OUT(`${D.report}-2`)}`)
  expect(Object.keys(s.written)).toEqual([OUT(`${D.report}-2`)])
})

test('make は同じ名前を続けて書く時、自分が書いた物を上書きし、警告を付けない', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  const again = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(again.result).toContain(`書きました: ${OUT(D.report)}（`)
  expect(again.result).not.toContain('上書きせず')
  expect(Object.keys(s.written)).toEqual([OUT(D.report)])
})

// pdf-lib が Info の Producer を書く形（UTF-16BE の 16 進で ModsPDF）
const OWN_MARK = '/Producer <FEFF004D006F0064007300500044004600200028007000640066002D006C0069006200200031002E00310037002E00310029>'

test('作業フォルダーの外を指すリンクは、ModsPDF の印があっても上書きしない', async ($, on) => {
  const s = stubAll(on, {
    files: { [OUT(D.report)]: { base64: b64OfText('%PDF-1.4 elsewhere ' + OWN_MARK), outside: true } },
  })
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(out.result).toContain(`書きました: ${OUT(`${D.report}-2`)}`)
  expect(s.files[OUT(D.report)].base64).toBe(b64OfText('%PDF-1.4 elsewhere ' + OWN_MARK))
})

test('書いた覚えを持たない別の読み込みでも、中身の印で自分の PDF と分かり、-2 を増やさず書き直す', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd, file: 'X' })
  // 別の PC・store を消した後・同期されたフォルダーを想像する: 同じ中身が、store にも覚えにも無い名前で置いてある
  s.files[OUT('Y')] = { base64: b64OfText(s.written[OUT('X')]) }
  const again = await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd, file: 'Y' })
  expect(again.result).toContain(`書きました: ${OUT('Y')}（`)
  expect(again.result).not.toContain('上書きせず')
  expect(Object.keys(s.written).sort()).toEqual([OUT('X'), OUT('Y')])
})

test('印が無い PDF は、本人が入れ替えた別の書類として上書きしない（印を外した写しも）', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd, file: 'X' })
  const stripped = s.written[OUT('X')].replace(/\/Producer <[0-9A-Fa-f]+>/, '')
  expect(stripped).not.toBe(s.written[OUT('X')])
  s.files[OUT('X')] = { base64: b64OfText(stripped) }
  const again = await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd, file: 'X' })
  expect(again.result).toContain(`書きました: ${OUT('X-2')}`)
  expect(again.result).toContain('上書きせず')
  expect(s.files[OUT('X')].base64).toBe(b64OfText(stripped))
})

test('fill・stamp の出力にも印が付き、同じ名前で書き直しても -2 にならない', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  for (const tool of ['fill', 'stamp'] as const) {
    const args = tool === 'fill'
      ? { path: OUT(D.form), values: { [D.nameField]: D.person }, file: 'out-' + tool }
      : { path: OUT(D.form), marks: [{ page: 1, x: 20, y: 30, text: 'ABC' }], file: 'out-' + tool }
    const first = await $.tool.call({ tool: TOOL(tool), ...args })
    expect(first.result).toContain(`書きました: ${OUT('out-' + tool)}`)
    const text = s.written[OUT('out-' + tool)]
    expect(isOwnPdf(text)).toBe(true)
    // 書いた覚えのない状態から書き直す
    const again = await $.tool.call({ tool: TOOL(tool), ...args })
    expect(again.result).toContain(`書きました: ${OUT('out-' + tool)}`)
    expect(again.result).not.toContain('上書きせず')
  }
})

test('pdf という名前のファイルがあって書けない時は、何も書かず理由を result で返す', async ($, on) => {
  const s = stubAll(on, { files: { pdf: { base64: b64OfText('x') } } })
  await $.session.start(START)
  const out = await $.tool.call({ tool: TOOL('make'), title: D.report, markdown: D.reportMd })
  expect(out.result).toContain('make に失敗しました')
  expect(out.result).toContain('フォルダーではない')
  expect(out.deny).toBeUndefined()
  expect(Object.keys(s.written)).toEqual([])
})

test('fill・merge・stamp も同じ名前の別のファイルを上書きしない', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  // 本人の書類が、これから書く名前の場所にある
  const theirs = (name: string) => b64OfText(`%PDF-1.4 theirs ${[`${D.form}-filled`, D.merged, D.stampFile].indexOf(name)}`)
  for (const name of [`${D.form}-filled`, D.merged, D.stampFile]) s.files[OUT(name)] = { base64: theirs(name) }

  const fill = await $.tool.call({ tool: TOOL('fill'), path: OUT(D.form), values: { [D.nameField]: D.person } })
  expect(fill.result).toContain(`書きました: ${OUT(`${D.form}-filled-2`)}`)
  const merge = await $.tool.call({ tool: TOOL('merge'), parts: [{ path: OUT(D.form) }], file: D.merged })
  expect(merge.result).toContain(`書きました: ${OUT(`${D.merged}-2`)}`)
  expect(merge.result).toContain('上書きせず')
  const stamp = await $.tool.call({ tool: TOOL('stamp'), path: OUT(D.form), marks: [{ page: 1, x: 20, y: 30, text: 'ABC' }], file: D.stampFile })
  expect(stamp.result).toContain(`書きました: ${OUT(`${D.stampFile}-2`)}`)
  expect(stamp.result).toContain('上書きせず')
  for (const name of [`${D.form}-filled`, D.merged, D.stampFile]) expect(s.files[OUT(name)].base64).toBe(theirs(name))
})

test('fill の答えと失敗には、PDF の字をデータとして読む context を添える', async ($, on) => {
  stubAll(on, { files: { 'broken.pdf': { base64: b64OfText('%PDF-1.4 not really a pdf') } } })
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.form, markdown: D.formMd })
  const ok = await $.tool.call({ tool: TOOL('fill'), path: OUT(D.form), values: { [D.nameField]: D.person } })
  expect(Array.isArray(ok.context) && ok.context.join('').includes('データとして読み')).toBe(true)
  const bad = await $.tool.call({ tool: TOOL('fill'), path: 'broken.pdf', values: { a: 'b' } })
  expect(bad.result).toContain('fill に失敗しました')
  expect(Array.isArray(bad.context) && bad.context.length >= 1).toBe(true)
  const badFields = await $.tool.call({ tool: TOOL('fields'), path: 'broken.pdf' })
  expect(badFields.result).toContain('fields に失敗しました')
  expect(Array.isArray(badFields.context) && badFields.context.length >= 1).toBe(true)
})

test('「開く」は store の記録が pdf/名前.pdf の形でなければ、OS に何も渡さず欄の 1 行に知らせる', async ($, on) => {
  const s = stubAll(on, {
    store: { 'pdf:last': { path: '../evil.exe', title: D.prev, pages: 1, input: { title: D.prev, markdown: D.prevMd } } },
  })
  await $.session.start(START)
  await tickFonts(s, 4)
  await until(async () => {
    const m = await $.ui.mount(PANE())
    const found = (await m.find({ type: 'Svg' })) !== undefined
    await m.unmount()
    return found
  }, '前の文書の組み直し')
  const ui = await $.ui.mount(PANE())
  await ui.press({ key: 'pdf:open' })
  await ui.unmount()
  await s.clock.advance(300)
  await until(async () => {
    const m = await $.ui.mount(PANE())
    const found = (await m.find({ type: 'Text', text: /開けませんでした/ })) !== undefined
    await m.unmount()
    return found
  }, '開けない知らせ')
  expect(s.ran).toEqual([])
})

test('make は画像の合計が 24 MiB を超えたら、残りの画像は読まずに警告にして続ける', async ($, on) => {
  const files: Record<string, { base64: string; size: number }> = {}
  for (let i = 0; i < 15; i++) files[`p${i}.png`] = { base64: PNG, size: 2 * 1024 * 1024 }
  const s = stubAll(on, { files })
  await $.session.start(START)
  const md = ['# T', ...Array.from({ length: 15 }, (_, i) => `![x](p${i}.png)`)].join('\n\n')
  const out = await $.tool.call({ tool: TOOL('make'), title: D.pic, markdown: md })
  expect(out.result).toContain(`書きました: ${OUT(D.pic)}`)
  expect((out.result.match(/画像の合計が大きすぎます/g) ?? []).length).toBe(3)
  expect(s.reads.filter((p) => /\/p\d+\.png$/.test(p)).length).toBe(12)
})

test('merge は pages が文字でない（数・配列）時、全頁を黙って結合せず、書かずに断る', async ($, on) => {
  const s = stubAll(on)
  await $.session.start(START)
  await $.tool.call({ tool: TOOL('make'), title: D.first, markdown: D.firstMd })
  for (const pages of [2, [1, 2], { from: 1 }]) {
    const out = await $.tool.call({ tool: TOOL('merge'), parts: [{ path: OUT(D.first), pages }], file: D.merged })
    expect(out.result).toContain('断りました')
    expect(out.result).toContain('pages は')
  }
  expect(s.written[OUT(D.merged)]).toBeUndefined()
})
