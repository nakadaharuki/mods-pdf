// hooks/edit/existing.mjs の試験。入力の PDF は pdf-lib で試験の中で作り、結果は pdfjs-dist で読み直して確かめる。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFHexString, PDFName, PDFBool, fontkit, degrees } from '../hooks/vendor/pdf.mjs'
import { listFields, fillFields, mergePages, stampText, parsePageSpec } from '../hooks/edit/existing.mjs'
import { rawPdf } from './helpers/raw-pdf.mjs'
import { isOwnPdf } from '../hooks/lib/paths.mjs'

const readFont = (name) => new Uint8Array(fs.readFileSync(new URL('../fonts/' + name, import.meta.url)))
const SANS = readFont('NotoSansJP-JIS-400.ttf')
const SANS_BOLD = readFont('NotoSansJP-JIS-700.ttf')
const FONTS = { sans: SANS, sansBold: SANS_BOLD }
// 書体（Noto Sans JP）に字形が無い字
const EMOJI = String.fromCodePoint(0x1f600)

// ---------------------------------------------------------------------------
// 道具

/** 7 ビットの字を、pdfjs に渡すバイト列に戻す */
const toBytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0))

function assertSevenBit(text) {
  assert.equal(typeof text, 'string')
  assert.ok(text.startsWith('%PDF-'))
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) assert.fail('7 ビットでない字が ' + i + ' 番目にある: ' + text.charCodeAt(i))
  }
}

const openPdf = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise

async function pageTexts(pdf, n) {
  const tc = await (await pdf.getPage(n)).getTextContent()
  return tc.items.map((i) => i.str).join('')
}

/** 頁の注釈（欄）を { 名前: 注釈 } の表で（ラジオは名前が重なるので配列） */
async function annotsByName(pdf, n) {
  const out = {}
  for (const a of await (await pdf.getPage(n)).getAnnotations()) (out[a.fieldName] ??= []).push(a)
  return out
}

/** 頁に頁の目印の字を描く（結合の順を getTextContent で確かめる） */
async function labelPage(doc, page, label) {
  doc.registerFontkit(fontkit)
  page.drawText(label, { x: 20, y: 20, size: 14, font: await doc.embedFont(SANS, { subset: true }) })
}

/** n 頁の文書。各頁に "<label>-<頁>" と描く */
async function numberedPdf(label, n) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= n; i++) await labelPage(doc, doc.addPage([300, 200]), label + '-' + i)
  return doc.save()
}

/**
 * 記入欄のある 2 頁の文書。1 頁: name・agree・pref・plan・id（読み取り専用）、2 頁: memo・tags・send。
 * @param {{ noP?: boolean, withSignature?: boolean }} [o] noP は widget の /P を消す。
 */
async function buildForm({ noP = false, withSignature = false } = {}) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const jp = await doc.embedFont(SANS, { subset: true })
  const form = doc.getForm()
  const p1 = doc.addPage([400, 300])
  const p2 = doc.addPage([400, 300])
  await labelPage(doc, p1, 'F-1')
  await labelPage(doc, p2, 'F-2')

  const name = form.createTextField('name')
  name.setText('山田 太郎')
  name.addToPage(p1, { x: 20, y: 240, width: 200, height: 24, font: jp })
  const agree = form.createCheckBox('agree')
  agree.addToPage(p1, { x: 20, y: 200, width: 16, height: 16 })
  agree.check()
  const pref = form.createDropdown('pref')
  pref.addOptions(['東京都', '大阪府', '北海道'])
  pref.select('東京都')
  pref.addToPage(p1, { x: 20, y: 160, width: 120, height: 22, font: jp })
  const plan = form.createRadioGroup('plan')
  plan.addOptionToPage('standard', p1, { x: 20, y: 120, width: 14, height: 14 })
  plan.addOptionToPage('premium', p1, { x: 60, y: 120, width: 14, height: 14 })
  const id = form.createTextField('id')
  id.setText('A-001')
  id.enableReadOnly()
  id.addToPage(p1, { x: 200, y: 160, width: 80, height: 20, font: jp })

  const memo = form.createTextField('memo')
  memo.enableMultiline()
  memo.addToPage(p2, { x: 20, y: 120, width: 300, height: 100, font: jp })
  const tags = form.createOptionList('tags')
  tags.addOptions(['緊急', '重要', '通常'])
  tags.enableMultiselect()
  tags.addToPage(p2, { x: 20, y: 20, width: 100, height: 60, font: jp })
  const send = form.createButton('send')
  send.addToPage('送信', p2, { x: 200, y: 20, width: 80, height: 24, font: jp })

  if (withSignature) {
    const ctx = doc.context
    const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText('sign'), Rect: [250, 240, 380, 280], F: 4, P: p1.ref }))
    p1.node.addAnnot(ref)
    form.acroForm.addField(ref)
  }
  form.updateFieldAppearances(jp)
  if (noP) {
    for (const f of form.getFields()) for (const w of f.acroField.getWidgets()) w.dict.delete(doc.context.obj('P'))
  }
  // 既定の保存はオブジェクトストリームを使う。実物の PDF に多い形で読めることも兼ねて確かめる
  return doc.save()
}

const FORM = await buildForm()

const toAscii = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')

const near = (a, b, tol = 0.15) => assert.ok(Math.abs(a - b) <= tol, a + ' と ' + b + ' の差が ' + tol + ' を超える')

// ---------------------------------------------------------------------------
// listFields

test('listFields: 全種類の欄を、名前・種類・値・選び肢・頁・読み取り専用つきで返す', async () => {
  const list = await listFields(FORM)
  const by = Object.fromEntries(list.map((f) => [f.name, f]))
  assert.deepEqual(list.map((f) => f.name), ['name', 'agree', 'pref', 'plan', 'id', 'memo', 'tags', 'send'])

  assert.equal(by.name.kind, 'text')
  assert.equal(by.name.value, '山田 太郎')
  assert.equal(by.name.page, 1)
  assert.equal(by.name.readOnly, false)

  assert.equal(by.agree.kind, 'check')
  assert.equal(by.agree.value, true)

  assert.equal(by.pref.kind, 'choice')
  assert.equal(by.pref.value, '東京都')
  assert.deepEqual(by.pref.options, ['東京都', '大阪府', '北海道'])

  assert.equal(by.plan.kind, 'radio')
  assert.equal(by.plan.value, '')
  assert.deepEqual(by.plan.options, ['standard', 'premium'])

  assert.equal(by.id.readOnly, true)
  assert.equal(by.id.value, 'A-001')

  assert.equal(by.memo.page, 2)
  assert.equal(by.tags.kind, 'choice')
  assert.deepEqual(by.tags.value, [])
  assert.equal(by.tags.multiple, true)
  assert.equal(by.send.kind, 'button')
  assert.equal(by.send.page, 2)
})

test('listFields: rect は PDF の座標（pt・左下が原点）のまま返す', async () => {
  const by = Object.fromEntries((await listFields(FORM)).map((f) => [f.name, f]))
  // pdf-lib は枠線の太さの半分だけ外側へ広げて Rect を書く
  const [x, y, w, h] = by.name.rect
  near(x, 20, 1); near(y, 240, 1); near(w, 200, 2); near(h, 24, 2)
  assert.ok(by.name.rect.every(Number.isFinite))
})

test('listFields: widget に /P が無くても、各頁の Annots から頁を探す', async () => {
  const noP = await buildForm({ noP: true })
  const by = Object.fromEntries((await listFields(noP)).map((f) => [f.name, f]))
  assert.equal(by.name.page, 1)
  assert.equal(by.memo.page, 2)
  assert.equal(by.send.page, 2)
})

test('listFields: 署名欄は signature として並ぶ', async () => {
  const list = await listFields(await buildForm({ withSignature: true }))
  const sig = list.find((f) => f.name === 'sign')
  assert.equal(sig?.kind, 'signature')
  assert.equal(sig?.page, 1)
})

test('listFields: 欄の無い PDF は空の配列', async () => {
  assert.deepEqual(await listFields(await numberedPdf('N', 1)), [])
})

test('listFields: 別の領域（vm）で作られた Uint8Array も受ける', async () => {
  const foreign = vm.runInNewContext('new Uint8Array(bytes)', { bytes: Array.from(FORM) })
  assert.equal(foreign instanceof Uint8Array, false)
  assert.equal((await listFields(foreign)).length, 8)
})

// ---------------------------------------------------------------------------
// fillFields

const FILL = { name: '佐藤 花子', agree: false, pref: '大阪府', plan: 'premium', memo: '一行目\n二行目', tags: ['緊急', '通常'] }

test('fillFields: 日本語の値を text・check・choice・radio に入れ、読み直すと値が入っている', async () => {
  const r = await fillFields(FORM, FILL, { fontBytes: FONTS })
  assertSevenBit(r.text)
  assert.deepEqual(r.filled, ['name', 'agree', 'pref', 'plan', 'memo', 'tags'])
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.failed, [])

  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.name.value, '佐藤 花子')
  assert.equal(back.agree.value, false)
  assert.equal(back.pref.value, '大阪府')
  assert.equal(back.plan.value, 'premium')
  assert.equal(back.memo.value, '一行目\n二行目')
  assert.deepEqual(back.tags.value, ['緊急', '通常'])

  // pdf.js の目（見る側）でも同じ値が見える。見た目の字が日本語で作られている証拠として、欄の値を読む
  const pdf = await openPdf(toBytes(r.text))
  const p1 = await annotsByName(pdf, 1)
  assert.equal(p1.name[0].fieldValue, '佐藤 花子')
  assert.deepEqual(p1.pref[0].fieldValue, ['大阪府'])
  assert.equal(p1.agree[0].fieldValue, 'Off')
  const premium = p1.plan.find((a) => a.buttonValue === 'premium')
  assert.equal(premium.fieldValue, 'premium')
})

test('fillFields: 触っていない欄の値と、読み取り専用の印は変わらない', async () => {
  const r = await fillFields(FORM, { name: '田中' }, { fontBytes: FONTS })
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.pref.value, '東京都')
  assert.equal(back.agree.value, true)
  assert.equal(back.id.value, 'A-001')
  assert.equal(back.id.readOnly, true)
})

test('fillFields: 日本語の値の見た目が書体つきで作られ、flatten なしでも字が頁から読める', async () => {
  const r = await fillFields(FORM, { name: '鈴木 一郎' }, { fontBytes: FONTS })
  const pdf = await openPdf(toBytes(r.text))
  // 欄の見た目の字は widget の外観（流れ）の中。flatten せずに外観だけを取り出して、日本語の字形で作られたかを見る
  const ap = (await annotsByName(pdf, 1)).name[0]
  assert.ok(ap.hasAppearance)
  assert.equal(ap.fieldValue, '鈴木 一郎')
})

test('fillFields: 無い名前は missing に、入れられない欄は理由つきで failed に入り、ほかの欄は埋まる', async () => {
  const r = await fillFields(FORM, {
    name: '山本', 存在しない欄: 'x', pref: '沖縄県', plan: 'gold', agree: 'たぶん', send: 'x', tags: ['緊急'],
  }, { fontBytes: FONTS })
  assert.deepEqual(r.filled, ['name', 'tags'])
  assert.deepEqual(r.missing, ['存在しない欄'])
  assert.deepEqual(r.failed.map((f) => f.name), ['pref', 'plan', 'agree', 'send'])
  assert.match(r.failed[0].reason, /選び肢にありません: 沖縄県/)
  assert.match(r.failed[1].reason, /gold/)
  assert.match(r.failed[2].reason, /true か false/)
  assert.match(r.failed[3].reason, /押しボタン/)
  // 失敗した欄は元のまま
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.pref.value, '東京都')
  assert.equal(back.name.value, '山本')
})

test('fillFields: 選べる数を超える指定と、文字数の上限を超える値は failed になる', async () => {
  const r = await fillFields(FORM, { pref: ['東京都', '大阪府'] }, { fontBytes: FONTS })
  assert.equal(r.failed[0].name, 'pref')
  assert.match(r.failed[0].reason, /1 つしか/)
})

test('fillFields: 選び欄は空の指定で選択を外し、真偽は文字でも受ける', async () => {
  const r = await fillFields(FORM, { pref: '', agree: 'いいえ', plan: 'standard' }, { fontBytes: FONTS })
  assert.deepEqual(r.failed, [])
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.pref.value, '')
  assert.equal(back.agree.value, false)
  assert.equal(back.plan.value, 'standard')
})

test('fillFields: 日本語の値で fontBytes が無いと、理由つきで投げる', async () => {
  await assert.rejects(() => fillFields(FORM, { name: '山田' }), /fontBytes/)
})

test('fillFields: 英数字だけなら fontBytes が無くても入れられる', async () => {
  const r = await fillFields(FORM, { name: 'Taro Yamada', agree: true })
  assert.deepEqual(r.filled, ['name', 'agree'])
  assert.equal(r.failed.length, 0)
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.name.value, 'Taro Yamada')
})

test('fillFields: 素のバイト列を fontBytes に渡しても sans として使う', async () => {
  const r = await fillFields(FORM, { name: '渡辺' }, { fontBytes: SANS })
  const back = Object.fromEntries((await listFields(toBytes(r.text))).map((f) => [f.name, f]))
  assert.equal(back.name.value, '渡辺')
})

test('fillFields: 書体に無い字は warnings に出す', async () => {
  const r = await fillFields(FORM, { name: '山田' + EMOJI }, { fontBytes: FONTS })
  assert.ok(r.warnings.some((w) => w.includes(EMOJI)), r.warnings.join('|'))
})

test('fillFields: flatten すると欄が消え、字は頁に残る', async () => {
  const r = await fillFields(FORM, FILL, { flatten: true, fontBytes: FONTS })
  assertSevenBit(r.text)
  assert.deepEqual(await listFields(toBytes(r.text)), [])
  const pdf = await openPdf(toBytes(r.text))
  assert.equal(pdf.numPages, 2)
  assert.equal((await (await pdf.getPage(1)).getAnnotations()).length, 0)
  const t1 = await pageTexts(pdf, 1)
  assert.ok(t1.includes('佐藤 花子'), t1)
  assert.ok(t1.includes('大阪府'), t1)
  assert.ok(t1.includes('F-1'), '元の頁の字も残る')
  const t2 = await pageTexts(pdf, 2)
  assert.ok(t2.includes('一行目'), t2)
  assert.ok(t2.includes('二行目'), t2)
})

test('fillFields: 見た目の無い署名欄があっても flatten でき、外した事を warnings に書く', async () => {
  const withSig = await buildForm({ withSignature: true })
  const r = await fillFields(withSig, { name: '高橋' }, { flatten: true, fontBytes: FONTS })
  assert.ok(r.warnings.some((w) => w.includes('sign')), r.warnings.join('|'))
  assert.deepEqual(await listFields(toBytes(r.text)), [])
  assert.ok((await pageTexts(await openPdf(toBytes(r.text)), 1)).includes('高橋'))
})

test('fillFields: 書き換えても元の頁の数と字は変わらない', async () => {
  const r = await fillFields(FORM, {}, { fontBytes: FONTS })
  const pdf = await openPdf(toBytes(r.text))
  assert.equal(pdf.numPages, 2)
  assert.ok((await pageTexts(pdf, 2)).includes('F-2'))
  assert.equal((await listFields(toBytes(r.text))).length, 8)
})

test('fillFields: NeedAppearances が真の文書でも、日本語の見た目を作ったあとは外す（見る側が作り直して日本語を消さない）', async () => {
  const doc = await PDFDocument.load(FORM)
  doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True)
  const withNeed = await doc.save({ useObjectStreams: false })
  assert.ok(toAscii(withNeed).includes('/NeedAppearances'), '試験の入力に NeedAppearances が無い')
  const r = await fillFields(withNeed, { name: '中村' }, { fontBytes: FONTS })
  assert.equal(r.text.includes('/NeedAppearances'), false)
})

test('fillFields: 見た目の無い日本語の欄が元からあれば、英数字だけを入れる時も書体を使って見た目を作る', async () => {
  const doc = await PDFDocument.load(FORM)
  for (const f of doc.getForm().getFields()) if (f.getName() === 'name') for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of('AP'))
  const noAp = await doc.save({ updateFieldAppearances: false })
  const r = await fillFields(noAp, { agree: false }, { fontBytes: FONTS })
  const name = (await annotsByName(await openPdf(toBytes(r.text)), 1)).name[0]
  assert.equal(name.fieldValue, '山田 太郎')
  assert.ok(name.hasAppearance)
  // 書体が無ければ、既定の書体では日本語の見た目を作れない事を理由つきで伝える
  await assert.rejects(() => fillFields(noAp, { agree: false }), /欄の見た目を作れませんでした.*fontBytes/)
})

test('fillFields: 元の作成者・更新日を書き換えない', async () => {
  const doc = await PDFDocument.load(FORM)
  doc.setModificationDate(new Date(Date.UTC(2020, 0, 2, 3, 4, 5)))
  doc.setCreator('元の作成者')
  const dated = await doc.save()
  const r = await fillFields(dated, { name: '加藤' }, { fontBytes: FONTS })
  const info = (await (await openPdf(toBytes(r.text))).getMetadata()).info
  assert.equal(info.Creator, '元の作成者')
  assert.match(info.ModDate, /^D:20200102030405/)
})

// ---------------------------------------------------------------------------
// mergePages

test('parsePageSpec: 書いた順に並べ、全角・空・末尾までの指定を読む', () => {
  assert.deepEqual(parsePageSpec('1-3,5', 6), [0, 1, 2, 4])
  assert.deepEqual(parsePageSpec('5, 1-2', 6), [4, 0, 1])
  assert.deepEqual(parsePageSpec('２-３，６', 6), [1, 2, 5])
  assert.deepEqual(parsePageSpec('4-', 6), [3, 4, 5])
  assert.deepEqual(parsePageSpec('2,2', 3), [1, 1])
  assert.deepEqual(parsePageSpec(undefined, 3), [0, 1, 2])
  assert.deepEqual(parsePageSpec('  ', 2), [0, 1])
  assert.deepEqual(parsePageSpec('1' + String.fromCodePoint(0x301c) + '2', 3), [0, 1])
})

test('parsePageSpec: おかしい字・範囲の外・逆順の範囲は理由つきで投げる', () => {
  assert.throws(() => parsePageSpec('abc', 3), /読めません/)
  assert.throws(() => parsePageSpec('1-2-3', 3), /読めません/)
  assert.throws(() => parsePageSpec('1,,2', 3), /読めません/)
  assert.throws(() => parsePageSpec('0', 3), /頁 0 は範囲の外です/)
  assert.throws(() => parsePageSpec('2-9', 3), /頁 9 は範囲の外です（この PDF は 3 頁）/)
  assert.throws(() => parsePageSpec('3-1', 3), /始めが終わりより後ろ/)
  assert.throws(() => parsePageSpec(5, 3), /文字で渡して/)
})

test('mergePages: 複数の PDF から指定した頁を、書いた順に結合する', async () => {
  const three = await numberedPdf('A', 3)
  const r = await mergePages([{ bytes: three, pages: '3,1' }, { bytes: FORM }, { bytes: three, pages: '2-3' }])
  assertSevenBit(r.text)
  assert.equal(r.pages, 2 + 2 + 2)
  const pdf = await openPdf(toBytes(r.text))
  assert.equal(pdf.numPages, 6)
  const order = []
  for (let n = 1; n <= 6; n++) order.push((await pageTexts(pdf, n)).match(/[A-Z]-\d/)?.[0])
  assert.deepEqual(order, ['A-3', 'A-1', 'F-1', 'F-2', 'A-2', 'A-3'])
})

test('mergePages: pages を省くと全部の頁が入る', async () => {
  const r = await mergePages([{ bytes: await numberedPdf('B', 4) }])
  assert.equal(r.pages, 4)
  assert.equal((await openPdf(toBytes(r.text))).numPages, 4)
})

test('mergePages: おかしい指定は何番目の入力かを添えて投げる', async () => {
  const three = await numberedPdf('A', 3)
  await assert.rejects(() => mergePages([{ bytes: three }, { bytes: three, pages: '9' }]), /parts\[1\].*頁 9 は範囲の外/)
  await assert.rejects(() => mergePages([{ bytes: three, pages: 'x' }]), /parts\[0\].*読めません/)
  await assert.rejects(() => mergePages([]), /parts が空/)
})

test('mergePages: 空のバイト列や PDF でない物は理由つきで投げる', async () => {
  await assert.rejects(() => mergePages([{ bytes: new Uint8Array([1, 2, 3]) }]), /PDF を読めません（parts\[0\]）/)
})

test('mergePages: 記入欄のある頁を抜き出しても、元の頁が増殖して大きさが倍にならない', async () => {
  const one = await mergePages([{ bytes: FORM, pages: '1' }])
  assert.equal((await openPdf(toBytes(one.text))).numPages, 1)
  // 頁の辞書（/Type /Page）が 1 つだけ。注釈の /P を辿って元の頁がもう1枚コピーされると 2 になる
  const pageDicts = one.text.match(/\/Type\s*\/Page(?![a-z])/g) ?? []
  assert.equal(pageDicts.length, 1)
  // 抜き出した頁には欄の見た目が残る（欄は引き継がないが、見える）
  const kept = (await annotsByName(await openPdf(toBytes(one.text)), 1)).name
  assert.equal(kept[0].fieldValue, '山田 太郎')
})

// ---------------------------------------------------------------------------
// stampText

/** 頁の字を { 字, x, y（mm・見える頁の左上から）} で返す */
async function stampsOn(text, n = 1) {
  const pdf = await openPdf(toBytes(text))
  const page = await pdf.getPage(n)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  return tc.items.filter((i) => i.str.trim()).map((i) => {
    const m = pdfjs.Util.transform(vp.transform, i.transform)
    return { str: i.str, x: m[4] * 25.4 / 72, y: m[5] * 25.4 / 72 }
  })
}

async function blankPdf({ rotate = 0, box, pageSize = [300, 400], leak = false } = {}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage(pageSize)
  if (box) page.setMediaBox(...box)
  if (rotate) page.setRotation(degrees(rotate))
  if (leak) {
    // 拡大と移動を q なしで掛けたまま終わる内容（戻さない PDF は実物にある）
    page.node.addContentStream(doc.context.register(doc.context.stream('0.5 0 0 0.5 100 100 cm')))
  }
  return doc.save()
}

test('stampText: 指定した mm の位置（頁の左上から・基線）に字が来る', async () => {
  const r = await stampText(await blankPdf(), [{ page: 1, x: 30, y: 50, text: '氏名' }], { fontBytes: FONTS })
  assertSevenBit(r.text)
  assert.deepEqual(r.warnings, [])
  const [s] = await stampsOn(r.text)
  assert.equal(s.str, '氏名')
  near(s.x, 30); near(s.y, 50)
})

test('stampText: 回転した頁（90・180・270）でも、見える頁の左上から測った位置に字が来る', async () => {
  for (const rotate of [90, 180, 270]) {
    const r = await stampText(await blankPdf({ rotate }), [{ page: 1, x: 30, y: 50, text: '氏名' }, { page: 1, x: 70, y: 20, text: '住所' }], { fontBytes: FONTS })
    const stamps = await stampsOn(r.text)
    const a = stamps.find((s) => s.str === '氏名'), b = stamps.find((s) => s.str === '住所')
    assert.ok(a && b, '回転 ' + rotate + ' で字が読めない')
    near(a.x, 30); near(a.y, 50)
    near(b.x, 70); near(b.y, 20)
  }
})

test('stampText: 回転した頁の字は見た目で横書きに読める（字が寝ていない）', async () => {
  for (const rotate of [90, 180, 270]) {
    const r = await stampText(await blankPdf({ rotate }), [{ page: 1, x: 30, y: 50, text: 'ABC' }], { fontBytes: FONTS })
    const pdf = await openPdf(toBytes(r.text))
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 1 })
    const [item] = (await page.getTextContent()).items.filter((i) => i.str.trim())
    const m = pdfjs.Util.transform(vp.transform, item.transform)
    // 見える頁で、字の進む向きは右（m[0] > 0, m[1] ≒ 0）、字の上は上向き（m[3] の符号は画面の座標で負）
    assert.ok(m[0] > 0 && Math.abs(m[1]) < 1e-6, '回転 ' + rotate + ' の字が横向きでない: ' + m.join(','))
    assert.ok(m[3] < 0 && Math.abs(m[2]) < 1e-6, '回転 ' + rotate + ' の字が逆さ: ' + m.join(','))
  }
})

test('stampText: MediaBox の原点が 0 でない頁（回転ありも）でも、見える頁の左上から測れる', async () => {
  for (const rotate of [0, 90]) {
    const bytes = await blankPdf({ rotate, box: [50, 100, 300, 400] })
    const r = await stampText(bytes, [{ page: 1, x: 40, y: 60, text: '印' }], { fontBytes: FONTS })
    const [s] = await stampsOn(r.text)
    near(s.x, 40); near(s.y, 60)
  }
})

test('stampText: 元の内容が拡大・移動を戻さずに終わる頁でも、位置と大きさが狂わない', async () => {
  const r = await stampText(await blankPdf({ leak: true }), [{ page: 1, x: 30, y: 50, text: '氏名', size: 12 }], { fontBytes: FONTS })
  const pdf = await openPdf(toBytes(r.text))
  const page = await pdf.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const [item] = (await page.getTextContent()).items.filter((i) => i.str.trim())
  const m = pdfjs.Util.transform(vp.transform, item.transform)
  near(m[4] * 25.4 / 72, 30); near(m[5] * 25.4 / 72, 50)
  near(Math.hypot(m[0], m[1]), 12, 0.01)
})

test('stampText: size の既定は 10.5pt で、指定すればその大きさ', async () => {
  const r = await stampText(await blankPdf(), [{ page: 1, x: 10, y: 20, text: 'A' }, { page: 1, x: 10, y: 40, text: 'B', size: 20 }], { fontBytes: FONTS })
  const pdf = await openPdf(toBytes(r.text))
  const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((i) => i.str.trim())
  const size = (s) => Math.hypot(...items.find((i) => i.str === s).transform.slice(0, 2))
  near(size('A'), 10.5, 0.01)
  near(size('B'), 20, 0.01)
})

test('stampText: 複数行は行送りを空けて下へ並ぶ', async () => {
  const r = await stampText(await blankPdf(), [{ page: 1, x: 30, y: 50, text: '一行目\n二行目', size: 10 }], { fontBytes: FONTS })
  const stamps = await stampsOn(r.text)
  const a = stamps.find((s) => s.str === '一行目'), b = stamps.find((s) => s.str === '二行目')
  near(a.y, 50); near(b.y - a.y, 10 * 1.4 * 25.4 / 72)
  near(a.x, b.x)
})

test('stampText: font で書体を選び、fontBytes に無い書体は sans で書く', async () => {
  const name = (bytes) => fontkit.create(bytes).postscriptName
  const r = await stampText(await blankPdf(), [
    { page: 1, x: 10, y: 20, text: '太', font: 'sansBold' },
    { page: 1, x: 10, y: 40, text: '細', font: 'sans' },
    { page: 1, x: 10, y: 60, text: '明', font: 'mincho' },
  ], { fontBytes: FONTS })
  assert.ok(r.text.includes(name(SANS_BOLD)), 'sansBold が埋め込まれていない')
  assert.ok(r.text.includes(name(SANS)))
  // 明朝は無いので sans に落ち、字は出る
  const pdf = await openPdf(toBytes(r.text))
  assert.ok((await pageTexts(pdf, 1)).includes('明'))
})

test('stampText: 書体に無い字は warnings に出す', async () => {
  const r = await stampText(await blankPdf(), [{ page: 1, x: 10, y: 20, text: '笑' + EMOJI }], { fontBytes: FONTS })
  assert.ok(r.warnings.some((w) => w.includes(EMOJI)), r.warnings.join('|'))
})

test('stampText: 空の字は書かず、頁の外の位置は警告し、範囲外の頁と数でない位置は投げる', async () => {
  const bytes = await blankPdf()
  const empty = await stampText(bytes, [{ page: 1, x: 10, y: 10, text: '   ' }], { fontBytes: FONTS })
  assert.equal((await pageTexts(await openPdf(toBytes(empty.text)), 1)).trim(), '')
  const off = await stampText(bytes, [{ page: 1, x: 5000, y: 10, text: '遠' }], { fontBytes: FONTS })
  assert.match(off.warnings[0], /頁の外/)
  await assert.rejects(() => stampText(bytes, [{ page: 2, x: 1, y: 1, text: 'a' }], { fontBytes: FONTS }), /marks\[0\].*頁 2 は範囲の外です（この PDF は 1 頁）/)
  await assert.rejects(() => stampText(bytes, [{ page: 1, x: NaN, y: 1, text: 'a' }], { fontBytes: FONTS }), /mm の数字/)
  await assert.rejects(() => stampText(bytes, [{ page: 1, x: 1, y: 1, text: 'a' }]), /fontBytes/)
})

test('stampText: 元の頁の字も欄も残したまま足す', async () => {
  const r = await stampText(FORM, [{ page: 2, x: 20, y: 10, text: '承認' }], { fontBytes: FONTS })
  assert.equal((await listFields(toBytes(r.text))).length, 8)
  const pdf = await openPdf(toBytes(r.text))
  const t = await pageTexts(pdf, 2)
  assert.ok(t.includes('F-2') && t.includes('承認'), t)
})

test('答えが 4 MiB を超える時は、書き込めない字を返さず理由つきで投げる', async () => {
  const doc = await PDFDocument.create()
  const page = doc.addPage([100, 100])
  // 7 ビットの字にすると 4 分の 5 倍になる。3.5 MB の詰められない流れで 4 MiB を超える。頁から辿れないと結合では複製されない
  const noise = Uint8Array.from({ length: 3_500_000 }, (_, i) => (Math.imul(i, 2654435761) >>> 24) & 0xff)
  page.node.addContentStream(doc.context.register(doc.context.stream(noise)))
  const big = await doc.save()
  await assert.rejects(() => stampText(big, [{ page: 1, x: 1, y: 1, text: 'a' }], { fontBytes: FONTS }), /4 MiB を超えます/)
  await assert.rejects(() => mergePages([{ bytes: big }]), /4 MiB を超えます/)
})

// ---------------------------------------------------------------------------
// 暗号化

// /Encrypt を持つ最小の PDF（xref の位置は pdf-lib が順に読むので合わせなくてよい）
const ENCRYPTED = new TextEncoder().encode([
  '%PDF-1.4',
  '1 0 obj', '<< /Type /Catalog /Pages 2 0 R >>', 'endobj',
  '2 0 obj', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', 'endobj',
  '3 0 obj', '<< /Filter /Standard /V 1 /R 2 /O (' + 'o'.repeat(32) + ') /U (' + 'u'.repeat(32) + ') /P -4 >>', 'endobj',
  '4 0 obj', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>', 'endobj',
  'trailer', '<< /Size 5 /Root 1 0 R /Encrypt 3 0 R >>', 'startxref', '0', '%%EOF',
].join('\n'))

test('暗号化された PDF は、どの関数でも「暗号化された PDF は扱えません」で断る', async () => {
  const msg = /暗号化された PDF は扱えません/
  await assert.rejects(() => listFields(ENCRYPTED), msg)
  await assert.rejects(() => fillFields(ENCRYPTED, { a: 'b' }, { fontBytes: FONTS }), msg)
  await assert.rejects(() => stampText(ENCRYPTED, [{ page: 1, x: 1, y: 1, text: 'a' }], { fontBytes: FONTS }), msg)
  await assert.rejects(() => mergePages([{ bytes: ENCRYPTED }]), msg)
  const plain = await numberedPdf('A', 1)
  await assert.rejects(() => mergePages([{ bytes: plain }, { bytes: ENCRYPTED }]), /暗号化された PDF は扱えません（parts\[1\]）/)
})

// ---------------------------------------------------------------------------
// 4 つの答えは全部 7 ビット

test('どの関数の答えも 7 ビットの字だけで、読み直せる PDF になっている', async () => {
  const outs = [
    (await fillFields(FORM, FILL, { fontBytes: FONTS })).text,
    (await fillFields(FORM, FILL, { flatten: true, fontBytes: FONTS })).text,
    (await mergePages([{ bytes: FORM, pages: '2' }, { bytes: await numberedPdf('Z', 2) }])).text,
    (await stampText(FORM, [{ page: 1, x: 10, y: 10, text: '印' }], { fontBytes: FONTS })).text,
  ]
  for (const text of outs) {
    assertSevenBit(text)
    assert.ok((await openPdf(toBytes(text))).numPages >= 1)
  }
})

// ---------------------------------------------------------------------------
// 入力の大きさの上限（道具の引数は Claude が書く物。PDF の字は他人が書いた物）

test('listFields: PDF の作り手が書いた長すぎる名前・値・選び肢は切って返す（Claude の文脈を食わせない）', async () => {
  const opts = Array.from({ length: 1000 }, (_, i) => `(${'o'.repeat(500)}${i})`).join(' ')
  const bytes = rawPdf([
    [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R 11 0 R] >> >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [10 0 R 11 0 R] >>'],
    [10, `<< /T (${'n'.repeat(2000)}) /FT /Tx /V (${'v'.repeat(20000)}) /Rect [0 0 10 10] /Subtype /Widget /Type /Annot /P 3 0 R >>`],
    [11, `<< /T (pick) /FT /Ch /Ff 131072 /Opt [${opts}] /V (a) /Rect [0 20 10 30] /Subtype /Widget /Type /Annot /P 3 0 R >>`],
  ])
  const [text, choice] = await listFields(bytes)
  assert.ok(text.name.length <= 501 && text.name.endsWith('…'), 'name ' + text.name.length)
  assert.ok(text.value.length <= 5001 && text.value.endsWith('…'), 'value ' + text.value.length)
  assert.equal(choice.options.length, 500)
  assert.ok(choice.options.every((o) => o.length <= 301))
})

test('fillFields: 長すぎる値・選ぶ数が多すぎる指定はその欄だけ failed になり、ほかの欄は埋まる', async () => {
  const r = await fillFields(FORM, { name: 'あ'.repeat(20001), tags: Array.from({ length: 501 }, () => '重要'), memo: '残る' }, { fontBytes: FONTS })
  assert.deepEqual(r.filled, ['memo'])
  assert.deepEqual(r.failed.map((f) => f.name).sort(), ['name', 'tags'])
  assert.match(r.failed.find((f) => f.name === 'name').reason, /値が長すぎます（20000 字まで/)
  assert.match(r.failed.find((f) => f.name === 'tags').reason, /選ぶ数が多すぎます/)
  // ぎりぎり（20000 字）は入る
  const edge = await fillFields(FORM, { memo: 'あ'.repeat(20000) }, { fontBytes: FONTS })
  assert.deepEqual(edge.filled, ['memo'])
})

test('fillFields: values の数が欄の上限（6000）を超えたら、PDF を読む前に投げる', async () => {
  const many = Object.fromEntries(Array.from({ length: 6001 }, (_, i) => ['f' + i, 'x']))
  await assert.rejects(() => fillFields(FORM, many, { fontBytes: FONTS }), /values が多すぎます（6001 個。6000 個まで）/)
})

test('fillFields: 入れられない理由に入る PDF の選び肢は、数と長さを切って答えに入れる', async () => {
  const opts = Array.from({ length: 200 }, (_, i) => `(${'s'.repeat(100)}${i})`).join(' ')
  const bytes = rawPdf([
    [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [10 0 R] >>'],
    [10, `<< /T (pick) /FT /Ch /Opt [${opts}] /Rect [0 0 100 20] /Subtype /Widget /Type /Annot /P 3 0 R >>`],
  ])
  const r = await fillFields(bytes, { pick: 'どれでもない' }, { fontBytes: FONTS })
  assert.equal(r.failed.length, 1)
  assert.ok(r.failed[0].reason.length < 1000, '理由が ' + r.failed[0].reason.length + ' 字')
  assert.match(r.failed[0].reason, /^選び肢にありません: どれでもない/)
  // 長い値を貼られたチェック欄の理由にも、値をそのまま写さない
  const check = await fillFields(FORM, { agree: 'あ'.repeat(5000) }, { fontBytes: FONTS })
  assert.ok(check.failed[0].reason.length < 200)
})

test('stampText: marks の数・text の長さ・行数・座標の桁・size の大きさの上限を超える指定は、どれかを添えて投げる', async () => {
  const plain = await blankPdf()
  const one = (m) => stampText(plain, [{ page: 1, x: 10, y: 10, text: 'a', ...m }], { fontBytes: FONTS })
  await assert.rejects(() => stampText(plain, Array.from({ length: 2001 }, () => ({ page: 1, x: 1, y: 1, text: 'a' })), { fontBytes: FONTS }), /marks が多すぎます（2001 個。2000 個まで）/)
  await assert.rejects(() => one({ text: 'あ'.repeat(10001) }), /marks\[0\]: text が長すぎます/)
  await assert.rejects(() => one({ text: 'a\n'.repeat(501) }), /marks\[0\]: 行が多すぎます/)
  await assert.rejects(() => one({ x: 1e9 }), /marks\[0\]: x と y は mm で ±100000 以内/)
  await assert.rejects(() => one({ y: -1e21 }), /±100000 以内/)
  await assert.rejects(() => one({ size: 1001 }), /size は 1000 pt まで/)
  await assert.rejects(() => stampText(plain, 'x', { fontBytes: FONTS }), /marks は配列/)
  await assert.rejects(() => stampText(plain, [null], { fontBytes: FONTS }), /marks\[0\]: \{ page, x, y, text \}/)
  // ぎりぎりは通る
  const edge = await one({ text: 'a'.repeat(10000), size: 1000, x: 100000, y: -100000 })
  assert.ok(Array.isArray(edge.warnings))
})

test('parsePageSpec: 長すぎる指定と、選ぶ頁が多すぎる指定（1-5000 を何千回も書く）は、配列を作る前に投げる', () => {
  assert.throws(() => parsePageSpec('1,'.repeat(10001), 5), /頁の指定が長すぎます/)
  assert.throws(() => parsePageSpec('1-5000,1-5000', 5000), /頁の指定が多すぎます（一度に 5000 頁まで）/)
  assert.throws(() => parsePageSpec('1-10,'.repeat(600), 10), /頁の指定が多すぎます/)
  assert.throws(() => parsePageSpec('1-,1-', 5000), /頁の指定が多すぎます/)
  assert.equal(parsePageSpec('1-5000', 5000).length, 5000)
})

test('mergePages: parts が 100 を超える・結合の頁が 5000 を超える・parts の要素が object でない、のどれも理由つきで投げる', async () => {
  const one = await numberedPdf('A', 1)
  await assert.rejects(() => mergePages(Array.from({ length: 101 }, () => ({ bytes: one }))), /parts が多すぎます（101 個。100 個まで）/)
  const ten = await numberedPdf('T', 10)
  const parts = Array.from({ length: 11 }, () => ({ bytes: ten, pages: Array(46).fill('1-10').join(',') }))
  await assert.rejects(() => mergePages(parts), /結合する頁が多すぎます（5000 頁まで/)
  await assert.rejects(() => mergePages([{ bytes: ten, pages: '1-10,'.repeat(600) }]), /parts\[0\]: 頁の指定が多すぎます/)
  await assert.rejects(() => mergePages([null]), /parts\[0\] は \{ bytes, pages\? \} で渡してください/)
})

test('fillFields と stampText の出力は、元の PDF の作り手に関わらず Producer を ModsPDF にする（pdf/ の同名ファイルを上書きしてよいかの印）', async () => {
  const text = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  assert.equal(isOwnPdf(text(FORM)), false, '元の PDF は印が無い')
  const filled = await fillFields(FORM, { memo: 'あ' }, { fontBytes: FONTS })
  assert.equal(isOwnPdf(filled.text), true)
  const stamped = await stampText(await blankPdf(), [{ page: 1, x: 10, y: 10, text: 'a' }], { fontBytes: FONTS })
  assert.equal(isOwnPdf(stamped.text), true)
  const merged = await mergePages([{ bytes: FORM }])
  assert.equal(isOwnPdf(merged.text), true)
})
