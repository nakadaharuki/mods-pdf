// render/meta.mjs の試験。元の原稿・数字の入口・話す人の覚えの添付(EmbeddedFiles と /AF)と、XMP の metadata。
// 計画(何を添えるか)は書体なしで確かめ、PDF に書いた物は pdfjs と pdf-lib で読み戻す。pdfdetach(poppler)があれば同じ一覧を見る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { planAttachments, tablesOf, csvText, notesMarkdown, xmlText, xmpPacket, ATTACH_RAW_MAX, SOURCE_JSON_MAX } from '../hooks/render/meta.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } from '../hooks/vendor/pdf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.UTC(2026, 9, 9, 3, 0, 0)
/** 先頭の BOM(U+FEFF)。ソースに字のまま書くと見えなくなるので、コードで作る */
const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`)
const dec = new TextDecoder('utf-8')
const text = (/** @type {Uint8Array} */ b) => dec.decode(b)

// ---------- 入力と作り物の Layout ----------
const DECK = {
  kind: 'deck',
  title: '月次売上レビュー（2026年度第2四半期）',
  author: '森田一郎',
  datasets: {
    sales: { source: '社内の集計', asOf: '2026-09-30', data: { x: ['4月', '5月', '6月'], revenue: [120, 135, 128], cost: [100, 110, 105], unit: '百万円' } },
    '市場': { data: { items: [{ name: 'TAM', value: 1500 }, { name: 'SAM', value: 750 }] } },
  },
  slides: [
    { layout: 'cover', title: '月次売上レビュー', lead: '4月から6月' },
    { layout: 'statement', title: '売上は **128** 百万円', notes: '最初に結論を言う。\n前月比は 5% 減。' },
    { layout: 'content', title: '内訳', blocks: [{ type: 'para', text: [{ text: '本文' }] }] },
    { layout: 'closing', title: '次の一歩', items: ['来月の見通し'], notes: '質問を受ける。' },
  ],
}

/** 添付の中身を確かめるための、何も描かない 1 頁の Layout(書体が要らない) */
const layoutOf = (extraOps = []) => ({
  meta: { title: DECK.title, author: DECK.author, lang: 'ja-JP', created: NOW },
  page: { width: 300, height: 200 },
  pages: [{ ops: [{ t: 'rect', x: 10, y: 10, w: 100, h: 50, fill: '#eeeeee' }, ...extraOps] }],
  tags: [{ role: 'Document', parent: null }],
  outline: [],
  fonts: [],
  warnings: [],
  stats: {},
})
const render = (input, layout = layoutOf()) => renderPdf(layout, { fontBytes: {}, ...(input === undefined ? {} : { source: input }) })
const toBytes = (/** @type {string} */ s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const fileNames = (plan) => plan.files.map((f) => f.name)

// ================================================================ 計画(何を添えるか)
test('資料の既定で、元の原稿・数字の入口の JSON と CSV・話す人の覚えを、名前の順に計画する', () => {
  const plan = planAttachments(DECK)
  assert.equal(plan.attach, true)
  assert.deepEqual(plan.warnings, [])
  assert.deepEqual(fileNames(plan), ['data-d2.csv', 'data-d2.json', 'data-sales.csv', 'data-sales.json', 'notes.md', 'source.json'])
  const by = Object.fromEntries(plan.files.map((f) => [f.name, f]))
  assert.deepEqual([by['source.json'].rel, by['source.json'].mime], ['Source', 'application/json'])
  assert.deepEqual([by['data-sales.json'].rel, by['data-sales.json'].mime], ['Data', 'application/json'])
  assert.deepEqual([by['data-sales.csv'].rel, by['data-sales.csv'].mime], ['Data', 'text/csv'])
  assert.deepEqual([by['notes.md'].rel, by['notes.md'].mime], ['Supplement', 'text/markdown'])
  assert.deepEqual(JSON.parse(text(by['source.json'].bytes)), JSON.parse(JSON.stringify(DECK)), '元の原稿は make の入力と同じ中身')
})

test('数字の入口の JSON は id・出典・日付・data を持ち、CSV は BOM と CRLF で x と数の列を並べる', () => {
  const plan = planAttachments(DECK)
  const json = JSON.parse(text(plan.files.find((f) => f.name === 'data-sales.json').bytes))
  assert.deepEqual(Object.keys(json), ['id', 'source', 'asOf', 'data'])
  assert.equal(json.id, 'sales')
  assert.equal(json.source, '社内の集計')
  const csv = plan.files.find((f) => f.name === 'data-sales.csv').bytes
  assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf], '表計算が日本語を読めるよう UTF-8 の BOM')
  assert.equal(text(csv).replace(BOM_RE, ''), 'x,revenue,cost\r\n4月,120,100\r\n5月,135,110\r\n6月,128,105\r\n')
})

test('話す人の覚えは、notes のある枚だけを枚の番号と題名つきの Markdown にする', () => {
  const plan = planAttachments(DECK)
  const md = text(plan.files.find((f) => f.name === 'notes.md').bytes)
  assert.equal(md, '# 月次売上レビュー（2026年度第2四半期）（話す人の覚え）\n\n## 2. 売上は 128 百万円\n\n最初に結論を言う。\n前月比は 5% 減。\n\n## 4. 次の一歩\n\n質問を受ける。\n')
  assert.equal(notesMarkdown({ title: 'x', slides: [{ layout: 'cover', title: 'a' }] }), null, 'notes が 1 つも無ければ作らない')
})

test('attach が false の資料と、attach を指定しない文書は、何も計画しない', () => {
  assert.deepEqual(planAttachments({ ...DECK, attach: false }), { attach: false, files: [], warnings: [] })
  assert.deepEqual(planAttachments({ title: '文書', markdown: '# 見出し\n\n本文' }), { attach: false, files: [], warnings: [] })
})

test('文書でも attach: true なら、元の原稿と数字の入口を添える(話す人の覚えは無い)', () => {
  const plan = planAttachments({ title: '文書', markdown: '本文', attach: true, datasets: { a: { data: { x: [1, 2], v: [3, 4] } } } })
  assert.deepEqual(fileNames(plan), ['data-a.csv', 'data-a.json', 'source.json'])
})

test('bizplan の数字の入口は、入力に無くても normalize の中で作られた物を添える', () => {
  const plan = planAttachments({
    kind: 'deck', title: '事業計画', template: 'bizplan',
    plan: {
      company: 'ソラミド', summary: ['要約'], problem: { points: ['課題'] }, solution: { points: ['解決：説明'] },
      market: { tam: { value: 100 }, sam: { value: 50 }, som: { value: 5 }, unit: '億円' },
      financials: { years: ['2027', '2028'], revenue: [1, 2], cost: [2, 3], unit: '億円' },
    },
  })
  assert.ok(fileNames(plan).includes('data-financials.json'))
  assert.ok(fileNames(plan).includes('data-financials.csv'))
  assert.ok(fileNames(plan).includes('source.json'))
})

test('ファイル名は ASCII だけで重ならず、日本語の id は説明に残る', () => {
  const ids = ['売上', '売上2', 'a b', 'a_b', 'ＡＢＣ', 'x.']
  const datasets = Object.fromEntries(ids.map((id) => [id, { data: { x: ['a'], v: [1] } }]))
  const plan = planAttachments({ kind: 'deck', title: '名前', slides: [{ layout: 'cover', title: 't' }], datasets })
  const names = fileNames(plan)
  assert.equal(new Set(names).size, names.length, '名前が重ならない')
  for (const n of names) assert.match(n, /^[A-Za-z0-9._-]+$/, n)
  assert.equal(names.length, ids.length * 2 + 1, 'どの id も JSON と CSV が 1 つずつ残り、原稿が 1 つ')
  const sales = plan.files.find((f) => f.desc.includes('売上') && f.name.endsWith('.json') && !f.desc.includes('売上2'))
  assert.ok(sales, '日本語の id は Desc に残る')
  assert.equal(sales.name, 'data-d1.json', 'ASCII が何も残らない id は連番の名前')
  assert.ok(names.includes('data-2.json'), '売上2 は残った 2 を名前にする')
  assert.ok(names.includes('data-a_b.json') && names.includes('data-a_b-2.json'), 'a b と a_b が同じ名前に潰れても、-2 を付けて両方残る')
})

test('元の原稿が 200,000 字を超えたら原稿だけ入れず、警告して数字の入口は添える', () => {
  const big = { kind: 'deck', title: '大きい', markdown: `## 題\n\n${'あ'.repeat(120000)}`, datasets: { a: { data: { x: ['a', 'b'], v: Array.from({ length: 2 }, (_, i) => i) } }, b: { data: { pad: 'い'.repeat(100000) } } } }
  assert.ok(JSON.stringify(big).length > SOURCE_JSON_MAX)
  const plan = planAttachments(big)
  assert.ok(plan.warnings.some((w) => w.includes('200000')), plan.warnings.join())
  assert.ok(!fileNames(plan).includes('source.json'))
  assert.ok(fileNames(plan).includes('data-a.json'))
})

test('合計が 2 MiB を超えたら、優先の低い後ろの物から入れず、警告する', () => {
  // 数字の入口は 1 つ 200,000 字まで。原稿は 200,000 字を超えると入らないので、大きい入口が並ぶ時は数字の入口だけが残る
  const rows = (k) => ({ x: Array.from({ length: 10000 }, (_, i) => `r${k}-${i}`), v: Array.from({ length: 10000 }, (_, i) => (i * 7919 + k) % 10007) })
  const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']
  const datasets = Object.fromEntries(ids.map((id, k) => [id, { data: rows(k) }]))
  const plan = planAttachments({ kind: 'deck', title: '多い', slides: [{ layout: 'cover', title: 't' }], datasets })
  const total = plan.files.reduce((s, f) => s + f.bytes.length, 0)
  assert.ok(total <= ATTACH_RAW_MAX, `${total} バイト`)
  assert.ok(plan.warnings.some((w) => w.includes('合計')), plan.warnings.join())
  const names = fileNames(plan)
  assert.ok(names.includes('data-d1.json'), '先に計画した入口は残る')
  const missing = ids.flatMap((id) => ['json', 'csv'].map((e) => `data-${id}.${e}`)).filter((n) => !names.includes(n))
  assert.ok(missing.length > 0 && missing.some((n) => n.endsWith('.csv')), `落ちた物 ${missing.join()}`)
  assert.deepEqual(names, [...names].sort(), '残った物は名前の順')
})

// ================================================================ CSV
const csv = (data) => tablesOf(data).map((t) => ({ key: t.key, text: csvText(t).replace(BOM_RE, '') }))

test('x と数の列・series・ohlc は 1 つの表になり、字の列と x だけの図は表にしない', () => {
  assert.deepEqual(csv({ x: ['a', 'b'], series: [{ name: '線', values: [1, 2] }, { values: [3, null] }], unit: '円' }), [{ key: '', text: 'x,線,series2\r\na,1,3\r\nb,2,\r\n' }])
  assert.deepEqual(csv({ x: ['d1', 'd2'], ohlc: [[1, 3, 0, 2], [2, 4, 1, 3]], volume: [10, 20] }), [{ key: '', text: 'x,volume,open,high,low,close\r\nd1,10,1,3,0,2\r\nd2,20,2,4,1,3\r\n' }])
  assert.deepEqual(csv({ x: ['低', '高'], y: ['低', '高'], points: [{ name: 'A', x: 0.1, y: 0.2 }] }), [{ key: 'points', text: 'name,x,y\r\nA,0.1,0.2\r\n' }], '2 軸の x と y は軸の名前で、数の列ではない')
  assert.deepEqual(csv({ x: ['a', 'b'] }), [], '数の列が 1 つも無ければ表にしない')
  assert.deepEqual(csv({ axes: ['速さ', '強さ'], series: [{ name: 'A', values: [1, 2] }], max: 5 }), [{ key: '', text: 'axes,A\r\n速さ,1\r\n強さ,2\r\n' }], 'radar の axes も行の見出しになる')
  assert.deepEqual(csv({ groups: [{ name: 'g', values: [1, 2, 3] }] }), [], '名前と数の配列だけの行は、名前だけの表にしない')
})

test('同じ形の行の配列は配列ごとに表になり、字や数でない項目は表に入れない', () => {
  const t = csv({ nodes: [{ id: 'a', name: 'A', meta: { k: 1 } }, { id: 'b', name: 'B' }], links: [{ from: 'a', to: 'b', label: '払う' }], root: { name: 'r', children: [] } })
  assert.deepEqual(t.map((x) => x.key), ['nodes', 'links'])
  assert.equal(t[0].text, 'id,name\r\na,A\r\nb,B\r\n')
  assert.deepEqual(csv({ root: { name: 'r', children: [{ name: 'c', value: 1 }] } }), [], '木は表にしない')
  assert.deepEqual(csv(null), [])
  assert.deepEqual(csv([1, 2]), [])
})

test('CSV のセルは , " 改行を引用し、式として動く先頭の字には引用符を付けて字にする', () => {
  const t = csv({ items: [{ name: 'a,b', note: 'say "hi"\nok' }, { name: '=SUM(A1:A2)', note: '@x' }, { name: '-12.5', note: '+cmd|calc' }, { name: '-3%', note: '1,234' }] })[0].text
  assert.equal(t, 'name,note\r\n"a,b","say ""hi""\nok"\r\n\'=SUM(A1:A2),\'@x\r\n-12.5,\'+cmd|calc\r\n-3%,"1,234"\r\n')
})

// ================================================================ XMP
test('XMP は ASCII だけで、日本語は文字参照、サロゲートの対は 1 つの字、使えない制御字は捨てる', () => {
  const s = `題名 \u{1F600} <&>"'\u0001\n\ud800x`
  const x = xmlText(s)
  assert.match(x, /^[\x20-\x7e]*$/)
  assert.equal(x, '&#x984C;&#x540D; &#x1F600; &lt;&amp;&gt;&quot;&apos; x')
  const packet = xmpPacket({ title: '月次売上＆見通し', author: '森田一郎', lang: 'ja-JP', created: NOW })
  assert.match(packet, /^[\x09\x0a\x20-\x7e]*$/, 'packet 全体が ASCII')
  assert.match(packet, /<xmp:CreatorTool>ModsPDF<\/xmp:CreatorTool>/)
  assert.match(packet, /<xmp:CreateDate>2026-10-09T03:00:00Z<\/xmp:CreateDate>/)
  assert.ok(!/pdfaid|conformance/i.test(packet), 'PDF/A などを名乗らない')
  assert.ok(packet.includes(`<rdf:li>${xmlText('森田一郎')}</rdf:li>`), '作り手は文字参照')
  assert.ok(!xmpPacket({ title: 't', created: Number.NaN }).includes('CreateDate'), '日付が数でなければ書かない')
})

// ================================================================ PDF に書く
test('source を渡さなければ、添付も XMP も付かず、PDF の字は今までと同じ', async () => {
  const plain = await render(undefined)
  const withUndefined = await renderPdf(layoutOf(), { fontBytes: {}, source: undefined })
  assert.equal(withUndefined.text, plain.text)
  assert.ok(!/\/EmbeddedFiles|\/AF\b|\/Metadata|\/Filespec/.test(plain.text))
  const off = await render({ ...DECK, attach: false })
  assert.equal(off.text, plain.text, 'attach が false の入力を渡しても同じ字')
  const doc = await render({ title: '文書', markdown: '本文' })
  assert.equal(doc.text, plain.text, '文書は既定で添付しない')
})

test('資料を書くと pdfjs が 6 つの添付を出し、中身のバイトが計画と同じ', async () => {
  const r = await render(DECK)
  assert.deepEqual(r.warnings, [])
  assert.match(r.text, /^[\x00-\x7f]*$/, '7 ビット')
  const pdf = await getDocument({ data: toBytes(r.text), verbosity: 0, useSystemFonts: false }).promise
  const att = await pdf.getAttachments()
  const plan = planAttachments(DECK)
  assert.deepEqual([...att.keys()], fileNames(plan), '名前の順')
  for (const f of plan.files) {
    const got = await pdf.getAttachmentContent(att.get(f.name).filename)
    assert.deepEqual(Buffer.from(got.content ?? got), Buffer.from(f.bytes), f.name)
    assert.equal(att.get(f.name).description, f.desc, `${f.name} の説明`)
  }
  assert.equal(att.get('data-d2.json').description, '数字の入口 市場（JSON）')
})

test('各添付は AFRelationship・MIME の Subtype・Params の Size と作った日を持ち、catalog の /AF と名前の木にそろって載る', async () => {
  const r = await render(DECK)
  const doc = await PDFDocument.load(toBytes(r.text), { updateMetadata: false })
  const ctx = doc.context
  const catalog = doc.catalog
  const af = ctx.lookup(catalog.get(PDFName.of('AF')), PDFArray).asArray().map((x) => ctx.lookup(x, PDFDict))
  const tree = ctx.lookup(ctx.lookup(ctx.lookup(catalog.get(PDFName.of('Names')), PDFDict).get(PDFName.of('EmbeddedFiles')), PDFDict).get(PDFName.of('Names')), PDFArray).asArray()
  assert.equal(af.length, 6)
  assert.equal(tree.length, 12, '名前と参照の組')
  const keys = tree.filter((_, i) => i % 2 === 0).map((k) => k.decodeText())
  assert.deepEqual(keys, [...keys].sort(), '名前の木の鍵は昇順')
  const rel = { 'source.json': 'Source', 'notes.md': 'Supplement', 'data-sales.json': 'Data', 'data-sales.csv': 'Data', 'data-d2.json': 'Data', 'data-d2.csv': 'Data' }
  const sub = { json: 'application/json', csv: 'text/csv', md: 'text/markdown' }
  for (const spec of af) {
    const name = spec.get(PDFName.of('F')).decodeText()
    assert.ok(spec.get(PDFName.of('F')) instanceof PDFString, 'F は PDFString(ASCII)')
    assert.ok(spec.get(PDFName.of('UF')) instanceof PDFHexString)
    assert.equal(spec.get(PDFName.of('AFRelationship')).asString().slice(1), rel[name], name)
    const stream = ctx.lookup(ctx.lookup(spec.get(PDFName.of('EF')), PDFDict).get(PDFName.of('F')))
    assert.ok(stream instanceof PDFRawStream)
    assert.equal(stream.dict.get(PDFName.of('Subtype')).asString().slice(1).replace('#2F', '/'), sub[name.split('.').pop()], name)
    const params = ctx.lookup(stream.dict.get(PDFName.of('Params')), PDFDict)
    assert.equal(params.get(PDFName.of('Size')).asNumber(), decodePDFRawStream(stream).decode().length, `${name} の Size は元のバイト数`)
    assert.equal(params.get(PDFName.of('ModDate')).decodeText(), 'D:20261009030000Z', '作った日は layout.meta.created')
    assert.equal(params.get(PDFName.of('CreationDate')).decodeText(), 'D:20261009030000Z')
  }
})

test('XMP を pdfjs が読み、日本語の題名と作り手がそのまま取れ、Info の題名と同じ', async () => {
  const r = await render(DECK)
  const pdf = await getDocument({ data: toBytes(r.text), verbosity: 0, useSystemFonts: false }).promise
  const md = await pdf.getMetadata()
  assert.equal(md.metadata.get('dc:title'), DECK.title)
  assert.deepEqual(md.metadata.get('dc:creator'), [DECK.author])
  assert.equal(md.metadata.get('xmp:creatortool'), 'ModsPDF')
  assert.equal(md.metadata.get('pdf:producer'), 'ModsPDF (pdf-lib 1.17.1)')
  assert.equal(md.info.Title, DECK.title)
  assert.equal(md.info.Producer, 'ModsPDF (pdf-lib 1.17.1)')
})

test('同じ入力は同じ PDF の字になる(日付は layout.meta.created)', async () => {
  assert.equal((await render(DECK)).text, (await render(DECK)).text)
  assert.notEqual((await render(DECK)).text, (await render(DECK, { ...layoutOf(), meta: { ...layoutOf().meta, created: NOW + 86400000 } })).text)
})

test('created が数でなければ、添付に日付を書かない', async () => {
  const r = await render(DECK, { ...layoutOf(), meta: { title: 't', lang: 'ja-JP' } })
  const doc = await PDFDocument.load(toBytes(r.text), { updateMetadata: false })
  const spec = doc.context.lookup(doc.context.lookup(doc.catalog.get(PDFName.of('AF')), PDFArray).get(0), PDFDict)
  const stream = doc.context.lookup(doc.context.lookup(spec.get(PDFName.of('EF')), PDFDict).get(PDFName.of('F')))
  const params = doc.context.lookup(stream.dict.get(PDFName.of('Params')), PDFDict)
  assert.equal(params.get(PDFName.of('ModDate')), undefined)
  assert.ok(params.get(PDFName.of('Size')))
})

test('壊れた入力(title が無い)を渡しても投げず、添付せずに警告する', async () => {
  const r = await render({ kind: 'deck', slides: [] })
  assert.ok(r.warnings.some((w) => w.includes('添付しなかった')), r.warnings.join())
  assert.ok(!/\/EmbeddedFiles|\/Metadata/.test(r.text))
})

// ---------- 4 MiB ----------
/** 先頭の印と SOF0 だけが本物の JPEG(pdf-lib は頭だけ読み、画素は開かない)。詰め物は乱数で圧縮されない */
function fakeJpegBase64(bytes) {
  const head = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]
  const b = Buffer.alloc(head.length + bytes)
  Buffer.from(head).copy(b)
  let s = 12345
  for (let i = head.length; i < b.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; b[i] = (s >>> 16) & 0xff }
  return b.toString('base64')
}

test('添付を入れると 4 MiB を超える時は、添付だけを落として警告し、XMP は残す', async () => {
  const image = { t: 'image', x: 0, y: 0, w: 8, h: 8, kind: 'jpg', base64: fakeJpegBase64(2_960_000) }
  const layout = layoutOf([image])
  const base = await render(undefined, layout)
  assert.ok(base.text.length < 4 * 1024 * 1024 && base.text.length > 3_500_000, `添付なしは 4 MiB に収まる(${base.text.length} 字)`)
  // 圧縮しにくい数字の入口を 4 つ(1 つ 200,000 字未満)。添えると 4 MiB を超える
  const rows = (k) => ({ x: Array.from({ length: 9000 }, (_, i) => `${(Math.imul(i + k, 2654435761) >>> 0)}`), v: Array.from({ length: 9000 }, (_, i) => (Math.imul(i + 1, 48271 + k) >>> 0) % 100003) })
  const input = { ...DECK, datasets: Object.fromEntries([1, 2, 3, 4].map((k) => [`d${k}`, { data: rows(k) }])) }
  const r = await render(input, layout)
  assert.ok(r.warnings.some((w) => w.includes('4 MiB') && w.includes('添付')), r.warnings.join())
  assert.ok(r.text.length < 4 * 1024 * 1024)
  assert.ok(!/\/EmbeddedFiles/.test(r.text), '添付は落ちた')
  assert.match(r.text, /\/Metadata/, 'XMP は残る')
})

// ---------- 実物の組版と、poppler ----------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.json'), 'utf8'))
const readBase64 = async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64')

test('組んだ資料を書くと、原稿・数字・覚えが添付され、pdfdetach(poppler)が同じ一覧を出す', async (t) => {
  const fontBytes = await loadFontBytes(FONT_IDS, manifest, readBase64)
  const metrics = makeMetrics(fontBytes)
  const { layout } = compose(DECK, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
  const r = await renderPdf(layout, { fontBytes, source: DECK })
  assert.deepEqual(r.warnings, [])
  const pdf = await getDocument({ data: toBytes(r.text), verbosity: 0, useSystemFonts: false }).promise
  assert.equal(pdf.numPages, 4, '資料 1 枚 = 1 頁')
  const att = await pdf.getAttachments()
  assert.deepEqual([...att.keys()], fileNames(planAttachments(DECK)))
  const src = await pdf.getAttachmentContent('source.json')
  assert.equal(JSON.parse(text(src.content ?? src)).title, DECK.title)

  const probe = spawnSync('pdfdetach', ['-v'], { encoding: 'utf8' })
  if (probe.error) {
    t.diagnostic(`pdfdetach を実行できない(${probe.error.code ?? probe.error.message})ので、poppler での一覧は飛ばした`)
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modspdf-meta-'))
  try {
    const file = path.join(dir, 'a.pdf')
    fs.writeFileSync(file, r.text, 'latin1')
    const list = spawnSync('pdfdetach', ['-list', file], { encoding: 'utf8' })
    assert.equal(list.status, 0, list.stderr)
    assert.match(list.stdout, /6 embedded files/)
    for (const name of fileNames(planAttachments(DECK))) assert.ok(list.stdout.includes(name), `${name} が一覧に無い`)
    const out = path.join(dir, 'notes.out')
    assert.equal(spawnSync('pdfdetach', ['-savefile', 'notes.md', '-o', out, file], { encoding: 'utf8' }).status, 0)
    assert.equal(fs.readFileSync(out, 'utf8'), text(planAttachments(DECK).files.find((f) => f.name === 'notes.md').bytes))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
