// @ts-check
// scripts/verify-pdf.mjs: 組んだ PDF を紙として確かめる。手で組んだ Layout を renderPdf に通した PDF を、良い物と壊した物で確かめる。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyPdf, countStructure, expectedText } from '../scripts/verify-pdf.mjs'
import { loadFontBytes } from '../hooks/engine/fonts.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { PDFDocument } from 'pdf-lib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
const fontBytes = await loadFontBytes(['sans'], manifest, async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64'))
const theme = makeTheme({})

/** 全角の字だけを 1em ずつ並べた TextOp。y は上からの基線 @param {string} text @param {number} x @param {number} y @param {number} size @param {number} [tag] */
const textOp = (text, x, y, size, tag) => ({
  t: 'text',
  font: 'sans',
  size,
  color: '#111111',
  y,
  ...(tag === undefined ? {} : { tag }),
  glyphs: Array.from(text).map((c, i) => ({ c, x: x + i * size })),
})

const TAGS = [
  { role: 'Document', parent: null },
  { role: 'H2', parent: 0 },
  { role: 'P', parent: 0 },
  { role: 'RT', parent: 0 },
]

/**
 * @param {any[][]} pageOps 頁ごとの Op
 * @param {{ tags?: any[], outline?: any[], title?: string }} [o]
 */
async function makePdf(pageOps, o = {}) {
  /** @type {any} */
  const layout = {
    meta: { title: o.title ?? '試験の紙', lang: 'ja-JP', created: 0 },
    page: { width: theme.page.width, height: theme.page.height },
    pages: pageOps.map((ops) => ({ ops })),
    tags: o.tags ?? TAGS,
    outline: o.outline ?? [{ title: '見出しです', level: 2, page: 0, y: 80 }],
    fonts: ['sans'],
  }
  const r = await renderPdf(layout, { fontBytes })
  return Uint8Array.from(Buffer.from(r.text, 'latin1'))
}

const L = theme.left
const INPUT = { title: '試験の紙', blocks: [{ type: 'heading', level: 2, text: '見出しです' }, { type: 'para', text: '本文の一段落です' }] }
const goodOps = () => [textOp('見出しです', L, 100, 13, 1), textOp('本文の一段落です', L, 130, 9.5, 2)]

/** @param {{ ok: boolean | null, text: string }[]} results @param {string} word */
const line = (results, word) => results.find((x) => x.text.includes(word))

test('正しい PDF と入力は、ひとつも落ちずに全部の項目が通る', async () => {
  const res = await verifyPdf(await makePdf([goodOps()]), INPUT)
  assert.deepEqual(res.results.filter((x) => x.ok === false), [])
  assert.ok(res.pass >= 10, `通りは ${res.pass} 個`)
  assert.equal(res.fail, 0)
})

test('入力の json が無い項目は － になり、通りにも落ちにも数えない', async () => {
  const res = await verifyPdf(await makePdf([goodOps()]))
  const skipped = res.results.filter((x) => x.ok === null)
  assert.ok(skipped.length >= 2)
  assert.equal(res.pass + res.fail, res.results.filter((x) => x.ok !== null).length)
})

test('7pt 未満の字は落ち、ルビ（RT）の字は 0.5 倍の決まりなので外す', async () => {
  const small = await verifyPdf(await makePdf([[...goodOps(), textOp('小さい', L, 160, 6, 2)]]), INPUT)
  const bad = line(small.results, '7pt')
  assert.equal(bad?.ok, false)
  assert.match(bad?.text ?? '', /6pt/)
  const ruby = await verifyPdf(await makePdf([[...goodOps(), textOp('ふり', L, 160, 4.75, 3)]]), INPUT)
  assert.equal(line(ruby.results, '字の大きさ')?.ok, true)
  assert.match(line(ruby.results, '字の大きさ')?.text ?? '', /ルビ 2 字/)
})

test('版面の外にはみ出した字は落ち、左の天付き（左端 - 0.5em）までは許す', async () => {
  const tooRight = await verifyPdf(await makePdf([[...goodOps(), textOp('右', theme.left + theme.measure, 160, 9.5, 2)]]), INPUT)
  assert.equal(line(tooRight.results, '余白')?.ok, false)
  const hang = await verifyPdf(await makePdf([[...goodOps(), textOp('「', L - 4.75, 160, 9.5, 2)]]), INPUT)
  assert.equal(line(hang.results, '余白')?.ok, true)
  const tooLeft = await verifyPdf(await makePdf([[...goodOps(), textOp('左', L - 6, 160, 9.5, 2)]]), INPUT)
  assert.equal(line(tooLeft.results, '余白')?.ok, false)
})

test('入力にあるのに PDF に無い字は、往復照合で足りない字として名前を挙げる', async () => {
  const input = { ...INPUT, blocks: [INPUT.blocks[0], { type: 'para', text: '本文の一段落です麟' }] }
  const res = await verifyPdf(await makePdf([goodOps()]), input)
  const r = line(res.results, '足りない')
  assert.equal(r?.ok, false)
  assert.match(r?.text ?? '', /麟/)
})

test('同じ字が 2 回あるのに 1 回しか出ていない落ちも見つける（字の数で数える）', async () => {
  const input = { ...INPUT, blocks: [INPUT.blocks[0], { type: 'para', text: '本文の一段落です本' }] }
  const res = await verifyPdf(await makePdf([goodOps()]), input)
  assert.match(line(res.results, '足りない')?.text ?? '', /本/)
})

test('足（下の余白の中）の字は往復照合に数えない', async () => {
  // 本文の字を落とし、足に同じ字を置いても、足りないままにする
  const ops = [textOp('見出しです', L, 100, 13, 1), textOp('本文の一段', L, 130, 9.5, 2), textOp('落ちです', L, theme.page.height - 36, 8)]
  const res = await verifyPdf(await makePdf([ops]), INPUT)
  assert.equal(line(res.results, '足りない')?.ok, false)
})

test('構造の要素が行ごとにできている PDF は落ち、ブロックごとの PDF は通る', async () => {
  const tags = [{ role: 'Document', parent: null }, ...Array.from({ length: 12 }, () => ({ role: 'P', parent: 0 }))]
  const ops = Array.from({ length: 12 }, (_, i) => textOp('本文の一段落です', L, 100 + i * 17, 9.5, i + 1))
  const perLine = await verifyPdf(await makePdf([ops], { tags, outline: [] }), { title: '試験の紙', blocks: [{ type: 'para', text: '本文の一段落です'.repeat(12) }] })
  assert.equal(line(perLine.results, '構造の要素')?.ok, false)
  const good = await verifyPdf(await makePdf([goodOps()]), INPUT)
  assert.equal(line(good.results, '構造の要素')?.ok, true)
})

test('タグの要素が 1 つも無い（Document だけの）PDF は構造で落ちる', async () => {
  const res = await verifyPdf(await makePdf([goodOps().map((o) => ({ ...o, tag: undefined }))], { tags: [{ role: 'Document', parent: null }] }), INPUT)
  assert.equal(line(res.results, '構造の要素')?.ok, false)
})

test('countStructure: 同じ要素を頁をまたいで二重に数えず、ブロック級だけを別に数える', async () => {
  const bytes = await makePdf([goodOps()])
  const st = countStructure(await PDFDocument.load(bytes))
  assert.equal(st.root, true)
  assert.equal(st.roles.P, 1)
  assert.equal(st.roles.H2, 1)
  assert.equal(st.block, 2)
})

test('しおりの数が見出しの数に合わなければ落ちる', async () => {
  const none = await verifyPdf(await makePdf([goodOps()], { outline: [] }), INPUT)
  assert.equal(line(none.results, 'しおり')?.ok, false)
  const ok = await verifyPdf(await makePdf([goodOps()]), INPUT)
  assert.equal(line(ok.results, 'しおり')?.ok, true)
})

test('題名が入力と違う PDF は落ちる', async () => {
  const res = await verifyPdf(await makePdf([goodOps()], { title: '別の題' }), INPUT)
  assert.equal(line(res.results, 'Title')?.ok, false)
})

test('記入欄の数と値（文字欄の日本語・チェック欄のオン）を入力と照らす', async () => {
  const fieldOps = [
    textOp('氏名同意', L, 100, 9.5, 2),
    { t: 'field', kind: 'text', name: '氏名', x: L, y: 110, w: 150, h: 16, value: '山田太郎' },
    { t: 'field', kind: 'check', name: 'agree', x: L, y: 140, w: 12, h: 12, value: true },
  ]
  const input = (/** @type {string} */ name, /** @type {boolean} */ on) => ({
    title: '試験の紙',
    blocks: [{ type: 'fields', items: [{ kind: 'text', name: '氏名', label: '氏名', value: name }, { kind: 'check', name: 'agree', label: '同意', value: on }] }],
  })
  const bytes = await makePdf([fieldOps], { tags: TAGS, outline: [] })
  const ok = await verifyPdf(bytes, input('山田太郎', true))
  assert.equal(line(ok.results, '記入欄')?.ok, true, line(ok.results, '記入欄')?.text)
  const wrongText = await verifyPdf(bytes, input('佐藤花子', true))
  assert.equal(line(wrongText.results, '記入欄')?.ok, false)
  assert.match(line(wrongText.results, '記入欄')?.text ?? '', /氏名/)
  const wrongCheck = await verifyPdf(bytes, input('山田太郎', false))
  assert.equal(line(wrongCheck.results, '記入欄')?.ok, false)
  assert.match(line(wrongCheck.results, '記入欄')?.text ?? '', /agree/)
})

test('最後の頁が数行だけで終わる PDF は落ち、半分以上埋まっていれば通る', async () => {
  const full = Array.from({ length: 20 }, (_, i) => textOp('本文の一段落です', L, theme.top + 12 + i * theme.lineGap, 9.5, 2))
  const short = await verifyPdf(await makePdf([full, [textOp('少し', L, theme.top + 12, 9.5, 2)]], { outline: [] }), { title: '試験の紙', blocks: [{ type: 'para', text: '本文の一段落です' }] })
  assert.equal(line(short.results, '最後の頁')?.ok, false)
  const filled = await verifyPdf(await makePdf([full, full], { outline: [] }), { title: '試験の紙', blocks: [{ type: 'para', text: '本文の一段落です' }] })
  assert.equal(line(filled.results, '最後の頁')?.ok, true)
})

test('7 ビットでないバイトが混じった PDF は落ちる', async () => {
  const bytes = await makePdf([goodOps()])
  const dirty = new Uint8Array(bytes.length + 1)
  dirty.set(bytes)
  dirty[bytes.length] = 0x80
  const res = await verifyPdf(dirty, INPUT)
  assert.equal(line(res.results, '7 ビット')?.ok, false)
})

test('expectedText: 見出し・段落・表・要点・囲みの字とルビの読みを集め、チャートと svg の元は外す', () => {
  const { doc } = normalize({
    title: '見本',
    blocks: [
      { type: 'heading', level: 2, text: '見出し' },
      { type: 'para', text: '{漢字|かん|じ}と**太字**' },
      { type: 'table', head: ['列'], rows: [['セル']] },
      { type: 'keys', items: [{ label: 'ラベル', value: '値', note: '注' }] },
      { type: 'card', label: '囲み', text: '中身' },
      { type: 'chart', option: { title: { text: 'チャートの中' } }, caption: '図の説明' },
    ],
  })
  const t = expectedText(doc)
  for (const s of ['見出し', '漢字', 'かんじ', '太字', '列', 'セル', 'ラベル', '値', '注', '囲み', '中身', '図の説明']) assert.ok(t.includes(s), s)
  assert.ok(!t.includes('チャートの中'))
})

test('コマンド: 通れば終了の符号 0、落ちがあれば 1。最後の行は「--- n 通り・m 落ち」', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'))
  const pdf = path.join(dir, 'good.pdf')
  const bad = path.join(dir, 'bad.pdf')
  const json = path.join(dir, 'in.json')
  fs.writeFileSync(pdf, await makePdf([goodOps()]))
  fs.writeFileSync(bad, await makePdf([[...goodOps(), textOp('小さい', L, 160, 6, 2)]]))
  fs.writeFileSync(json, JSON.stringify(INPUT))
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-pdf.mjs'), ...args], { encoding: 'utf8' })
  const a = run([pdf, json])
  assert.equal(a.status, 0, a.stdout + a.stderr)
  assert.match(a.stdout.trim().split('\n').pop() ?? '', /^--- \d+ 通り・0 落ち$/)
  const b = run([bad, json])
  assert.equal(b.status, 1)
  assert.match(b.stdout.trim().split('\n').pop() ?? '', /^--- \d+ 通り・[1-9]\d* 落ち$/)
  assert.match(b.stdout, /✗/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('--all: PDF の置き場に見本の PDF が無ければ、見本ごとに知らせて終了の符号 1 で終わる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-all-'))
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-pdf.mjs'), '--all', dir], { encoding: 'utf8' })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  const names = fs.readdirSync(path.join(ROOT, 'samples')).filter((n) => n.endsWith('.json'))
  assert.equal([...r.stdout.matchAll(/^✗ .+ が無い/gm)].length, names.length)
  assert.match(r.stdout.trim().split('\n').pop() ?? '', new RegExp(`^--- ${names.length} 本・落ちた見本 ${names.length} 本$`))
  fs.rmSync(dir, { recursive: true, force: true })
})
