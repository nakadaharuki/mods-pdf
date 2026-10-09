// hooks/edit/guard.mjs と、それを通る 4 つの関数（listFields・fillFields・mergePages・stampText）の守りの試験。
// 攻める入力は他人の PDF（プロンプトに混ぜられた敵意のある物）。期待する答えは「一瞬で理由つきに断る」「切り詰める」「警告を添える」。
// 時間の上限は、守る前に実測した値（10 秒を超えて終わらない・14 秒・2^30 回）より遥かに低い 3 秒。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { PDFDocument, PDFName } from '../hooks/vendor/pdf.mjs'
import { inflatedSize, LIMITS } from '../hooks/edit/guard.mjs'
import { listFields, fillFields, mergePages, stampText } from '../hooks/edit/existing.mjs'
import { rawPdf, streamObj, baseObjs, activeFixture, pageDag, fieldDag, manyFields, objStmPdf } from './helpers/raw-pdf.mjs'

const SANS = new Uint8Array(fs.readFileSync(new URL('../fonts/NotoSansJP-JIS-400.ttf', import.meta.url)))
const FONTS = { sans: SANS }
const MB = 1024 * 1024
const SLOW_MS = 3000

// pdf-lib は壊れた部分を読み飛ばす時に console.warn を呼ぶ（フックの環境には無いので、試験の騒がしさだけを消す）
const warn = console.warn
test.before(() => { console.warn = () => {} })
test.after(() => { console.warn = warn })

/** 4 つの関数に同じ PDF を渡して、結果を { 名前: { ms, error, value } } で返す */
async function tryAll(bytes) {
  const calls = {
    listFields: () => listFields(bytes),
    fillFields: () => fillFields(bytes, { name: 'x' }, { fontBytes: FONTS }),
    mergePages: () => mergePages([{ bytes }]),
    stampText: () => stampText(bytes, [{ page: 1, x: 10, y: 10, text: 'x' }], { fontBytes: FONTS }),
  }
  const out = {}
  for (const [name, call] of Object.entries(calls)) {
    const t0 = performance.now()
    try {
      out[name] = { value: await call(), ms: performance.now() - t0 }
    } catch (error) {
      out[name] = { error, ms: performance.now() - t0 }
    }
  }
  return out
}

/** 4 つとも SLOW_MS 以内に、message に合う理由で断ること */
async function assertRefused(bytes, message) {
  for (const [name, r] of Object.entries(await tryAll(bytes))) {
    assert.ok(r.error instanceof Error, name + ' は断るはず（読めてしまった）')
    assert.match(r.error.message, message, name)
    assert.ok(r.ms < SLOW_MS, name + ' が ' + Math.round(r.ms) + ' ms かかった')
  }
}

// ---------------------------------------------------------------------------
// 圧縮の数え（inflatedSize）

/** 試験で使う入力のいろいろ: 空白・乱数・小さな字・繰り返し */
function samples() {
  let seed = 12345
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff
  return [
    Buffer.alloc(0),
    Buffer.alloc(1),
    Buffer.alloc(100000, 0x20),
    Buffer.from(Array.from({ length: 5000 }, () => Math.floor(rnd() * 256))),
    Buffer.from(Array.from({ length: 70000 }, () => 97 + Math.floor(rnd() * 3))),
    Buffer.from('<< /Type /Annot /Rect [1 2 3 4] >>\n'.repeat(3000)),
    Buffer.from(Array.from({ length: 40000 }, (_, i) => (i * i) & 0xff)),
  ]
}

test('inflatedSize: zlib が作った流れの展開後の大きさと一致する（圧縮の強さと方式を変えた全部で）', () => {
  const strategies = [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY, zlib.constants.Z_RLE, zlib.constants.Z_FILTERED]
  let n = 0
  for (const data of samples()) {
    for (const level of [0, 1, 6, 9]) {
      for (const strategy of strategies) {
        const z = new Uint8Array(zlib.deflateSync(data, { level, strategy }))
        assert.equal(inflatedSize(z, 0, 1 << 30), data.length, 'データ ' + data.length + ' 字・level ' + level + '・strategy ' + strategy)
        n++
      }
    }
  }
  assert.ok(n >= 100)
})

test('inflatedSize: 開始位置を指せて、壊れた流れと zlib でない頭は -1', () => {
  const z = new Uint8Array(zlib.deflateSync(Buffer.alloc(1000, 0x61)))
  const padded = new Uint8Array(z.length + 5)
  padded.set(z, 5)
  assert.equal(inflatedSize(padded, 5, 1 << 20), 1000)
  assert.equal(inflatedSize(new Uint8Array(0), 0, 100), -1)
  assert.equal(inflatedSize(Uint8Array.of(1, 2, 3, 4), 0, 100), -1)
  // 辞書つき（FDICT）・方式が違う・頭の検査和が合わない
  assert.equal(inflatedSize(Uint8Array.of(0x78, 0xbb, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01), 0, 100), -1)
  assert.equal(inflatedSize(Uint8Array.of(0x79, 0x9c, 0x03, 0x00), 0, 100), -1)
  assert.equal(inflatedSize(Uint8Array.of(0x78, 0x9d, 0x03, 0x00), 0, 100), -1)
  // 途中で切れた流れ
  assert.equal(inflatedSize(z.subarray(0, 4), 0, 1 << 20), -1)
  // gzip の頭（pako は自動で見分けて読むが、pdf-lib の展開は読めない。数えられない物は通さない）
  assert.equal(inflatedSize(new Uint8Array(zlib.gzipSync(Buffer.alloc(100))), 0, 1 << 20), -1)
})

test('inflatedSize: 上限を超える流れは -2 で、200 MB に膨らむ爆弾も展開せずに一瞬で断る', () => {
  const small = new Uint8Array(zlib.deflateSync(Buffer.alloc(5000, 0x20)))
  assert.equal(inflatedSize(small, 0, 5000), 5000)
  assert.equal(inflatedSize(small, 0, 4999), -2)
  const bomb = new Uint8Array(zlib.deflateSync(Buffer.alloc(200 * MB, 0x20), { level: 9 }))
  assert.ok(bomb.length < 300 * 1024)
  const t0 = performance.now()
  assert.equal(inflatedSize(bomb, 0, LIMITS.streamOut), -2)
  assert.ok(performance.now() - t0 < 500)
})

test('inflatedSize: 空の塊を並べて刻んだ流れは、塊の数の上限で断る', () => {
  // 無圧縮の塊（長さ 0）は 5 バイト。符号表を作り直す仕事の代わりに、塊を数える
  const block = (last) => [last ? 1 : 0, 0, 0, 0xff, 0xff]
  const body = []
  for (let i = 0; i < LIMITS.blocks + 10; i++) body.push(...block(false))
  body.push(...block(true))
  const stream = Uint8Array.of(0x78, 0x01, ...body, 0, 0, 0, 1)
  assert.equal(inflatedSize(stream, 0, 1 << 20), -1)
  const few = Uint8Array.of(0x78, 0x01, ...block(false), ...block(false), ...block(true), 0, 0, 0, 1)
  assert.equal(inflatedSize(few, 0, 1 << 20), 0)
})

// ---------------------------------------------------------------------------
// 圧縮の爆弾（ObjStm と XRef は読み込みの時に必ず展開される）

const bombData = (mb) => zlib.deflateSync(Buffer.concat([Buffer.from('10 0 '), Buffer.alloc(mb * MB, 0x20), Buffer.from('<< >>')]), { level: 9 })

test('圧縮爆弾: ObjStm が 12 MiB を超えて膨らむ PDF は、展開せずに理由つきで断る', async () => {
  const bytes = objStmPdf('/N 1 /First 5 /Filter /FlateDecode', bombData(50))
  assert.ok(bytes.length < 100 * 1024)
  await assertRefused(bytes, /ObjStm が展開すると 12 MiB を超えます/)
})

test('圧縮爆弾: 名前を #xx で書き換える・辞書に "obj" を含む文字列を入れる・辞書を水増しする・Filter を配列にする、のどれでも断る', async () => {
  const data = bombData(50)
  const variants = [
    objStmPdf('/N 1 /First 5 /Filter /FlateDecode', data, { typeKey: '/Type /Obj#53tm' }),
    objStmPdf('/N 1 /First 5 /Filter /FlateDecode /X (obj)', data),
    objStmPdf('/N 1 /First 5 /Filter /FlateDecode /Pad (' + 'x'.repeat(70000) + ')', data),
    objStmPdf('/N 1 /First 5 /Filter [/FlateDecode]', data),
    objStmPdf('/N 1 /First 5 /Filter /FlateDecode /Pad %comment\n 1', data, { typeKey: '/Type\n/ObjStm' }),
  ]
  for (const bytes of variants) await assertRefused(bytes, /ObjStm が展開すると/)
})

test('圧縮爆弾: 圧縮を二重にした ObjStm と、LZW など数えられない圧縮の ObjStm は断る', async () => {
  await assertRefused(objStmPdf('/N 1 /First 5 /Filter [/FlateDecode /FlateDecode]', zlib.deflateSync(bombData(1))), /多重に圧縮されています/)
  await assertRefused(objStmPdf('/N 1 /First 5 /Filter /LZWDecode', Buffer.alloc(1000, 0x80)), /圧縮方式に対応していません/)
  await assertRefused(objStmPdf('/N 1 /First 5 /Filter /FlateDecode', Buffer.from('これは zlib ではない')), /圧縮データを確かめられません/)
})

test('圧縮爆弾: 小さな ObjStm が何本あっても、合計が 16 MiB を超えれば断る', async () => {
  // 1 本あたりは 12 MiB 未満（単体なら通る）でも、合計で数える
  const one = zlib.deflateSync(Buffer.concat([Buffer.from('10 0 '), Buffer.alloc(9 * MB, 0x20), Buffer.from('<< >>')]), { level: 9 })
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>']]
  let text = '%PDF-1.7\n'
  for (const [n, body] of objs) text += `${n} 0 obj\n${body}\nendobj\n`
  const parts = [Buffer.from(text)]
  for (let i = 0; i < 3; i++) {
    parts.push(Buffer.from(`${5 + i} 0 obj\n<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode /Length ${one.length} >>\nstream\n`), one, Buffer.from('\nendstream\nendobj\n'))
  }
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R /Size 20 >>\n%%EOF\n'))
  const bytes = new Uint8Array(Buffer.concat(parts))
  await assertRefused(bytes, /ObjStm が展開すると/)
  // 1 本だけなら通る（上限は合計と 1 本ごと）
  const single = new Uint8Array(Buffer.concat([parts[0], parts[1], parts[2], parts[3], parts[parts.length - 1]]))
  const r = await listFields(single)
  assert.deepEqual(r, [])
})

test('XRef の辞書が荒い値（/Size 20 億・/Index 20 億・幅 /W が巨大）の 400 バイトの PDF は、17 秒かかる前に断る', async () => {
  const small = zlib.deflateSync(Buffer.from('10 0 << /Foo 1 >>'))
  await assertRefused(objStmPdf('/W [1 2 1] /Size 2000000000 /Index [0 2000000000] /Filter /FlateDecode', small, { typeKey: '/Type /XRef' }), /XRef の \/Size が大きすぎます/)
  await assertRefused(objStmPdf('/W [1 2 1] /Size 10 /Index [0 2000000000] /Filter /FlateDecode', small, { typeKey: '/Type /XRef' }), /XRef の \/Index が大きすぎます/)
  await assertRefused(objStmPdf('/W [9999999 1 1] /Size 10 /Index [0 10] /Filter /FlateDecode', small, { typeKey: '/Type /XRef' }), /XRef の幅 \/W がおかしい/)
  // 辞書を 70 KB 水増ししても、辞書を読み終えた後に確かめるので外れない
  await assertRefused(objStmPdf('/Pad (' + 'x'.repeat(70000) + ') /W [1 2 1] /Size 2000000000 /Index [0 2000000000] /Filter /FlateDecode', small, { typeKey: '/Type /XRef' }), /XRef の \/Size が大きすぎます/)
})

test('正常な ObjStm と XRef の流れ（実物の PDF の作り）は通る', async () => {
  // 3 つのオブジェクト（カタログ・頁の木・頁）を ObjStm に入れ、XRef の流れで索引を付ける
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']
  let offsets = ''
  let body = ''
  for (const [i, o] of objs.entries()) { offsets += `${i + 1} ${body.length} `; body += o + '\n' }
  const objStm = zlib.deflateSync(Buffer.from(offsets + body))
  const entries = Buffer.from([0, 0, 0, 255, /* 1 */ 2, 0, 5, 0, /* 2 */ 2, 0, 5, 1, /* 3 */ 2, 0, 5, 2, /* 5 */ 1, 0, 0, 0])
  const xref = zlib.deflateSync(entries)
  const head = Buffer.from('%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 3 /First ' + offsets.length + ' /Filter /FlateDecode /Length ' + objStm.length + ' >>\nstream\n')
  const mid = Buffer.from('\nendstream\nendobj\n6 0 obj\n<< /Type /XRef /W [1 2 1] /Size 7 /Index [0 4 5 1] /Root 1 0 R /Filter /FlateDecode /Length ' + xref.length + ' >>\nstream\n')
  const bytes = new Uint8Array(Buffer.concat([head, objStm, mid, xref, Buffer.from('\nendstream\nendobj\nstartxref\n0\n%%EOF\n')]))
  const merged = await mergePages([{ bytes }])
  assert.equal(merged.pages, 1)
  assert.deepEqual(await listFields(bytes), [])
})

// ---------------------------------------------------------------------------
// 木の爆弾・輪・数の上限

test('同じ節を 2 度指す頁の木（枝が 2^30 本に増える作り）は、4 つの関数が一瞬で断る', async () => {
  await assertRefused(pageDag(30), /頁の木が壊れています/)
})

test('同じ節を 2 度指す欄の木（枝が 2^30 本に増える作り）は、4 つの関数が一瞬で断る', async () => {
  await assertRefused(fieldDag(30), /記入欄の木が壊れています/)
})

test('Kids の輪（頁・欄）は断る', async () => {
  await assertRefused(rawPdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [2 0 R] /Count 1 >>']]), /頁の木が壊れています/)
  await assertRefused(rawPdf([...baseObjs().slice(0, 2).map((o) => o[0] === 1 ? [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> >>'] : o), [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'], [10, '<< /T (a) /Kids [11 0 R] >>'], [11, '<< /T (b) /Kids [10 0 R] >>']]), /記入欄の木が壊れています/)
})

test('/Parent の輪（頁の木の自己参照・欄の親が自分）は断る', async () => {
  const withForm = (field) => rawPdf([[1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'], ...field])
  await assertRefused(rawPdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /Parent 3 0 R >>'], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']]), /\/Parent が輪になっています/)
  await assertRefused(rawPdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 3 0 R >>']]), /\/Parent が輪になっています/)
  await assertRefused(withForm([[10, '<< /T (a) /FT /Tx /Parent 10 0 R /Rect [0 0 10 10] /Subtype /Widget /Type /Annot >>']]), /\/Parent が輪になっています/)
  await assertRefused(withForm([[10, '<< /T (a) /Kids [11 0 R] /Parent 11 0 R >>'], [11, '<< /T (b) /FT /Tx /Parent 10 0 R /Rect [0 0 10 10] /Subtype /Widget /Type /Annot >>']]), /\/Parent が輪になっています/)
})

test('頁の木の鎖が 32 段を超える PDF は断る（輪ではない深い木）', async () => {
  const depth = 40
  const objs = [[1, '<< /Type /Catalog /Pages 10 0 R >>']]
  for (let k = 0; k < depth; k++) objs.push([10 + k, `<< /Type /Pages /Kids [${11 + k} 0 R] /Count 1 >>`])
  objs.push([10 + depth, '<< /Type /Page /MediaBox [0 0 100 100] >>'])
  await assertRefused(rawPdf(objs), /頁の木が深すぎます/)
})

test('参照の鎖が 5 万段ある PDF（結合で pdf-lib の再帰が積み上がる）は、内部の例外を見せずに理由つきで断る', async () => {
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /X 100 0 R >> >>']]
  for (let i = 0; i < 50000; i++) objs.push([100 + i, `<< /N ${101 + i} 0 R >>`])
  const bytes = rawPdf(objs)
  const err = await mergePages([{ bytes }]).then(() => undefined, (e) => e)
  assert.ok(err instanceof Error)
  assert.match(err.message, /入れ子が深すぎて扱えない PDF です/)
  assert.doesNotMatch(err.message, /call stack/)
  // 読むだけ・字を足すだけの関数は鎖を辿らないので、そのまま通る
  assert.deepEqual(await listFields(bytes), [])
})

test('記入欄が 6000 個を超える PDF（2 万個で fillFields が 10 秒を超えた）は、4 つとも一瞬で断る', async () => {
  await assertRefused(manyFields(6001), /記入欄が多すぎます（6000 個まで/)
})

test('頁が共有する巨大な Annots の配列（頁数 × 長さ）は、合計の上限で断る', async () => {
  // 600 頁が、400 個の注釈を持つ同じ配列を指す。buildPageIndex が 24 万回まわる作り
  const annots = Array.from({ length: 400 }, (_, i) => `${1000 + i} 0 R`).join(' ')
  const pages = 600
  const kids = Array.from({ length: pages }, (_, i) => `${2000 + i} 0 R`).join(' ')
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`], [100, `[${annots}]`]]
  for (let i = 0; i < 400; i++) objs.push([1000 + i, '<< /Type /Annot /Subtype /Text /Rect [0 0 1 1] >>'])
  for (let i = 0; i < pages; i++) objs.push([2000 + i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Annots 100 0 R >>'])
  await assertRefused(rawPdf(objs), /頁の注釈が多すぎます/)
})

test('同じ頁を何度も指す Kids は（節ではなく末端の共有なので）数えて通す', async () => {
  const kids = Array.from({ length: 50 }, () => '3 0 R').join(' ')
  const bytes = rawPdf([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, `<< /Type /Pages /Kids [${kids}] /Count 50 >>`], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']])
  assert.equal((await mergePages([{ bytes }])).pages, 50)
})

// ---------------------------------------------------------------------------
// オブジェクトの間の読めない部分

test('オブジェクトの間の読めない部分が 4 MiB ある PDF（1 字ごとに例外を投げて 30 秒かかった）は、断って返る', async () => {
  const head = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n')
  const junks = {
    '数字と空白': new TextEncoder().encode('1 '.repeat(2_000_000)),
    '字と%': new TextEncoder().encode('x%'.repeat(2_000_000)),
    '字と空白': new TextEncoder().encode('x' + ' '.repeat(3_000_000)),
    '印字できる字': new TextEncoder().encode('abc 12 def '.repeat(300_000)),
  }
  for (const [name, junk] of Object.entries(junks)) {
    const bytes = new Uint8Array(head.length + junk.length)
    bytes.set(head)
    bytes.set(junk, head.length)
    const t0 = performance.now()
    await assert.rejects(() => listFields(bytes), /読めない部分が多すぎます/, name)
    assert.ok(performance.now() - t0 < SLOW_MS, name + ' が ' + Math.round(performance.now() - t0) + ' ms かかった')
  }
})

test('オブジェクトの間の隙間（数百バイトの読めない字・空白・コメント）がある PDF は、いつも通り読める', async () => {
  const text = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' + 'gomi '.repeat(60) + '\n\n% comment\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' + '\x00\x01\x02 '.repeat(100) + '\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\nおまけ'
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff)
  assert.equal((await mergePages([{ bytes }])).pages, 1)
})

// ---------------------------------------------------------------------------
// 大きさの上限

test('4 MiB を超える入力は、読む前に大きさで断る', async () => {
  const big = new Uint8Array(4 * MB + 1)
  await assert.rejects(() => listFields(big), /PDF が大きすぎます/)
  await assert.rejects(() => mergePages([{ bytes: big }]), /PDF が大きすぎます（parts\[0\]）/)
})

// ---------------------------------------------------------------------------
// 自動で動く物を持ち越さない

const FORBID_KEYS = ['AA', 'OpenAction', 'XFA', 'JavaScript', 'JS']
const FORBID_ACTIONS = ['JavaScript', 'Launch', 'SubmitForm', 'GoToR', 'ImportData', 'Named']

/** 出力を読み直して、自動で動く物が辞書に残っていないか（圧縮された ObjStm の中も含めて）。残っている物の一覧を返す */
async function remaining(text) {
  const doc = await PDFDocument.load(Uint8Array.from(text, (c) => c.charCodeAt(0)), { updateMetadata: false })
  const found = []
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj.dict ?? obj
    if (typeof dict.keys !== 'function') continue
    for (const k of dict.keys()) if (FORBID_KEYS.includes(k.decodeText())) found.push(`${ref.objectNumber}:/${k.decodeText()}`)
    const s = dict.get(PDFName.of('S'))
    if (s && FORBID_ACTIONS.includes(s.decodeText?.())) found.push(`${ref.objectNumber}:/S /${s.decodeText()}`)
    const subtype = dict.get(PDFName.of('Subtype'))
    if (subtype && ['Screen', 'Movie', 'Sound', 'RichMedia', '3D'].includes(subtype.decodeText?.())) found.push(`${ref.objectNumber}:/Subtype /${subtype.decodeText()}`)
  }
  return found
}

const INPUT_WORDS = ['JavaScript', 'Launch', 'SubmitForm', 'app.alert', 'this.print', 'javascript:', 'cmd.exe', 'evil.example', '<xdp', '/Screen']
const wordsIn = (text) => INPUT_WORDS.filter((w) => text.includes(w))

test('試験の入力には、自動で動く物が全種類入っている（以下の試験が空振りしないための確認）', () => {
  const text = Buffer.from(activeFixture()).toString('latin1')
  assert.deepEqual(wordsIn(text), INPUT_WORDS)
})

test('fillFields: JavaScript・開いた時の動作・/AA・XFA・実行や送信の動作・動画の注釈は出力に残らず、外した事を warnings に書く', async () => {
  const r = await fillFields(activeFixture(), { name: '山田' }, { fontBytes: FONTS })
  assert.deepEqual(await remaining(r.text), [])
  assert.deepEqual(wordsIn(r.text), [])
  assert.deepEqual(r.filled, ['name'])
  const note = r.warnings.find((w) => /自動で動く物を外しました/.test(w))
  assert.ok(note, JSON.stringify(r.warnings))
  for (const word of ['開いた時の動作', 'JavaScript', '実行・送信', 'XFA', '動画']) assert.match(note, new RegExp(word))
  // 外すのは危ない物だけ: https のリンクは残り、文書内の GoTo も残る
  assert.ok(r.text.includes('https://example.com/ok'))
  assert.match(r.text, /\/GoTo/)
})

test('stampText: 同じく自動で動く物は残らず、https のリンクは残る', async () => {
  const r = await stampText(activeFixture(), [{ page: 1, x: 10, y: 10, text: '印' }], { fontBytes: FONTS })
  assert.deepEqual(await remaining(r.text), [])
  assert.deepEqual(wordsIn(r.text), [])
  assert.ok(r.warnings.some((w) => /自動で動く物を外しました/.test(w)))
  assert.ok(r.text.includes('https://example.com/ok'))
})

test('mergePages: 同じく自動で動く物は残らず、結合で飛び先が変わる文書内のリンクも外し、外した事を warnings に書く', async () => {
  const r = await mergePages([{ bytes: activeFixture() }])
  assert.deepEqual(await remaining(r.text), [])
  assert.deepEqual(wordsIn(r.text), [])
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /自動で動く物を外しました.*文書内のリンク/)
  assert.ok(r.text.includes('https://example.com/ok'))
  assert.doesNotMatch(r.text, /\/GoTo/)
})

test('mergePages: 選ばなかった頁へ飛ぶリンク（/Dest）を辿って、元の頁を丸ごとコピーしない', async () => {
  const bytes = rawPdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [5 0 R] >>'],
    [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 6 0 R >>'],
    [5, '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest [4 0 R /Fit] >>'],
    [6, streamObj('', '0 0 m 10 10 l S')],
  ])
  const r = await mergePages([{ bytes, pages: '1' }])
  assert.equal(r.pages, 1)
  // 頁の辞書（/Type /Page）が 1 つだけ。/Dest を辿ると 2 になる
  assert.equal((r.text.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length, 1)
  assert.match(r.warnings[0], /文書内のリンク/)
})

test('危なくない PDF では、何も外さず warnings に何も足さない', async () => {
  const bytes = rawPdf(baseObjs())
  assert.deepEqual((await fillFields(bytes, { name: 'a' }, { fontBytes: FONTS })).warnings, [])
  assert.deepEqual((await stampText(bytes, [{ page: 1, x: 5, y: 5, text: 'a' }], { fontBytes: FONTS })).warnings, [])
  assert.deepEqual((await mergePages([{ bytes }])).warnings, [])
})

test('URI の動作は http・https・mailto だけ残し、javascript:・file:・data: や、頭に制御文字を付けた javascript: は外す', async () => {
  const uris = ['https://ok.example/', 'http://ok.example/', 'mailto:a@ok.example', 'javascript:alert\\(1\\)', 'file:///C:/Windows/System32/calc.exe', 'data:text/html,x', '\\tjavascript:alert\\(1\\)', 'JaVaScRiPt:1', 'ftp://x.example/']
  const objs = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>']]
  const annots = uris.map((_, i) => `${10 + i} 0 R`)
  objs.push([3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [${annots.join(' ')}] >>`])
  uris.forEach((u, i) => objs.push([10 + i, `<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /A << /S /URI /URI (${u}) /Next << /S /JavaScript /JS (x) >> >> >>`]))
  const r = await stampText(rawPdf(objs), [{ page: 1, x: 5, y: 5, text: 'a' }], { fontBytes: FONTS })
  for (const keep of ['https://ok.example/', 'http://ok.example/', 'mailto:a@ok.example']) assert.ok(r.text.includes(keep), keep)
  for (const gone of ['alert', 'calc.exe', 'data:text', 'JaVaScRiPt', 'ftp://']) assert.ok(!r.text.includes(gone), gone)
  // 残した動作の /Next（続けて別の動作をつなぐ鎖）も外す
  assert.deepEqual(await remaining(r.text), [])
})

test('listFields は PDF を書き換えない読み取りなので、自動で動く物の掃除はしない（欄の一覧だけ返す）', async () => {
  const list = await listFields(activeFixture())
  assert.deepEqual(list.map((f) => f.name), ['name'])
})

// ---------------------------------------------------------------------------
// 変異（ゆるい fuzz）: 壊した PDF が、固まらず例外（Error）か結果のどちらかで終わる

test('壊した PDF（字の挿入・削除・置換・複製を 1〜4 か所）80 件が、どの関数でも 3 秒以内に終わり、投げるのは Error だけ', async () => {
  let seed = 20261009
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff
  const tokens = ['0 R', ' R', '<<', '>>', '[', ']', '/Kids', '/Parent', '/Fields', '/Annots', '/Type', '/Length', 'obj', 'endobj', 'stream', 'endstream', '99999999999', '-1', '2 0 R', '10 0 R', '3 0 R', '(', ')', '/', '%', '\n', ' ']
  const sources = [activeFixture(), rawPdf(baseObjs()), pageDag(3), fieldDag(3)]
  const mutate = (src) => {
    const b = Array.from(src)
    for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++) {
      const at = Math.floor(rnd() * b.length)
      const op = Math.floor(rnd() * 5)
      if (op === 0) b[at] = Math.floor(rnd() * 256)
      else if (op === 1) b.splice(at, Math.floor(rnd() * 20))
      else if (op === 2) b.splice(at, 0, ...Buffer.from(tokens[Math.floor(rnd() * tokens.length)]))
      else if (op === 3) { const from = Math.floor(rnd() * b.length); b.splice(at, 0, ...b.slice(from, from + Math.floor(rnd() * 200))) }
      else b[at] ^= 1 << Math.floor(rnd() * 8)
    }
    return new Uint8Array(b)
  }
  for (let i = 0; i < 80; i++) {
    const bytes = mutate(sources[i % sources.length])
    for (const [name, r] of Object.entries(await tryAll(bytes))) {
      if (r.error) assert.ok(r.error instanceof Error && typeof r.error.message === 'string', name + ' が Error でない物を投げた')
      assert.ok(r.ms < SLOW_MS, `変異 ${i} の ${name} が ${Math.round(r.ms)} ms かかった`)
    }
  }
})
