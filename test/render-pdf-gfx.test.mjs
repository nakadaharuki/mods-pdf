// render/pdf の描画の足し(グラデーション・不透明度・blend・角丸と影・path の clip・字のグラデーション)の試験。
// 書いた PDF を pdf-lib で読み戻して中の形を確かめ、pdftoppm があれば絵にして画素の色まで確かめる。
// 見本の頁は out/gfx-pdf/ に書く(pdftoppm -r 90 -png で目で見る)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { shadowRaster, normalizePaint, boxRadii } from '../hooks/render/paint.mjs'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFStream, decodePDFRawStream, rawFontkit } from '../hooks/vendor/pdf.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT_FILES = { mincho: 'NotoSerifJP-JIS-400.ttf', minchoBold: 'NotoSerifJP-JIS-600.ttf', sans: 'NotoSansJP-JIS-400.ttf', sansBold: 'NotoSansJP-JIS-700.ttf' }
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.json'), 'utf8'))
const OUT_DIR = path.join(ROOT, 'out', 'gfx-pdf')
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// ---------- 書体 ----------
const bytesCache = new Map()
function fontBytes(id) {
  if (!bytesCache.has(id)) {
    const parts = manifest[FONT_FILES[id]].parts.map((p) => fs.readFileSync(path.join(ROOT, 'fonts', p)))
    bytesCache.set(id, new Uint8Array(Buffer.concat(parts)))
  }
  return bytesCache.get(id)
}
const fontsOf = (ids) => Object.fromEntries(ids.map((id) => [id, fontBytes(id)]))
const advCache = new Map()
function adv(id, c) {
  let f = advCache.get(id)
  if (!f) { f = { font: rawFontkit.create(fontBytes(id)), map: new Map() }; advCache.set(id, f) }
  let a = f.map.get(c)
  if (a === undefined) { a = f.font.layout(c).glyphs[0].advanceWidth / f.font.unitsPerEm; f.map.set(c, a) }
  return a
}
/** 字の列(字間の調整なし)。extra は TextOp に足す欄 */
function textOp(text, { font = 'sansBold', size = 12, x = 10, y = 50, color = '#111111', ...extra } = {}) {
  const glyphs = []
  let cx = x
  for (const c of text) { glyphs.push({ c, x: cx }); cx += adv(font, c) * size }
  return { t: 'text', font, size, color, y, glyphs, ...extra }
}
const widthOf = (text, font, size) => [...text].reduce((s, c) => s + adv(font, c) * size, 0)

// ---------- 作り物の Layout と、読み戻しの道具 ----------
const layoutOf = (ops, { w = 200, h = 100, fonts = [], pages } = {}) => ({
  meta: { title: '描画の試験', lang: 'ja-JP', created: Date.UTC(2026, 9, 9) },
  page: { width: w, height: h },
  pages: pages ?? [{ ops }],
  tags: [{ role: 'Document', parent: null }, { role: 'P', parent: 0 }, { role: 'Figure', parent: 0, alt: '図' }],
  outline: [],
  fonts,
  warnings: [],
  stats: {},
})
async function render(layout, fonts = []) {
  const r = await renderPdf(layout, { fontBytes: fontsOf(fonts) })
  return { ...r, bytes8: new Uint8Array(Buffer.from(r.text, 'latin1')) }
}
const lowLoad = (bytes) => PDFDocument.load(bytes, { updateMetadata: false })
const pdfOf = async (ops, o = {}) => {
  const r = await render(layoutOf(ops, o), o.fonts ?? [])
  return { r, doc: await lowLoad(r.bytes8) }
}
const contentOf = (doc, i = 0) => {
  const page = doc.getPage(i)
  const c = page.node.Contents()
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
}
/** 辞書・配列・参照をたどる。流れは辞書に読み替える */
function dig(doc, node, ...keys) {
  let cur = node
  for (const k of keys) {
    if (cur instanceof PDFStream) cur = cur.dict
    cur = typeof k === 'number' ? cur.get(k) : cur.get(PDFName.of(k))
    cur = doc.context.lookup(cur)
  }
  return cur
}
const nameOf = (o) => (o && typeof o.asString === 'function' ? o.asString().slice(1) : undefined)
const nums = (doc, arr) => arr.asArray().map((n) => doc.context.lookup(n).asNumber())
const resources = (doc, i = 0) => doc.getPage(i).node.Resources()
const entries = (dict) => dict.entries().map(([k, v]) => [k.asString().slice(1), v])
const approx = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} と ${b}`)
/** 資源の辞書(Pattern・Shading・XObject など)の項目の数。辞書が無ければ 0 */
const countRes = (doc, kind) => { const d = dig(doc, resources(doc), kind); return d ? entries(d).length : 0 }
const hasGroup = (doc, i = 0) => doc.getPage(i).node.get(PDFName.of('Group')) !== undefined

// ---------- 絵にして画素を読む(pdftoppm が無ければ飛ばす) ----------
const HAS_POPPLER = !spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' }).error
const needPoppler = HAS_POPPLER ? {} : { skip: 'pdftoppm が無い' }
function rasterize(text, dpi = 72) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modspdf-gfx-'))
  try {
    const file = path.join(dir, 'a.pdf')
    fs.writeFileSync(file, text, 'latin1')
    const r = spawnSync('pdftoppm', ['-r', String(dpi), file, path.join(dir, 'p')], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const buf = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((n) => n.endsWith('.ppm'))))
    const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString('latin1'))
    const w = Number(m[1])
    const h = Number(m[2])
    const data = buf.subarray(buf.length - w * h * 3)
    return { w, h, px: (x, y) => [data[(y * w + x) * 3], data[(y * w + x) * 3 + 1], data[(y * w + x) * 3 + 2]] }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const near = (got, want, tol = 14, msg = '') => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= tol), `${msg} 画素 [${got}] が [${want}] に近い`)
const pic = async (ops, o) => rasterize((await render(layoutOf(ops, o), o?.fonts ?? [])).text)

const FULL = { t: 'rect', x: 0, y: 0, w: 200, h: 100 }
const lin = (x1, y1, x2, y2, stops) => ({ kind: 'linear', x1, y1, x2, y2, stops })

// ================================================================ グラデーション
test('linear の paint は Pattern 2 と Shading 2 と Function 3 になり、止まりの間は Type 2 でつなぐ', async () => {
  const paint = lin(10, 20, 190, 80, [{ at: 0, color: '#ff0000' }, { at: 0.4, color: '#00ff00' }, { at: 1, color: '#0000ff' }])
  const { r, doc } = await pdfOf([{ ...FULL, fill: '#ff0000', paint }])
  assert.deepEqual(r.warnings, [])
  const pats = entries(dig(doc, resources(doc), 'Pattern'))
  assert.equal(pats.length, 1)
  const pat = doc.context.lookup(pats[0][1])
  assert.equal(dig(doc, pat, 'PatternType').asNumber(), 2)
  const sh = dig(doc, pat, 'Shading')
  assert.equal(dig(doc, sh, 'ShadingType').asNumber(), 2)
  assert.equal(nameOf(dig(doc, sh, 'ColorSpace')), 'DeviceRGB')
  const [x0, y0, x1, y1] = nums(doc, dig(doc, sh, 'Coords'))
  assert.deepEqual([x0, y0, x1, y1], [10, 80, 190, 20], 'y を頁の下から数えた値に裏返す')
  assert.deepEqual(dig(doc, sh, 'Extend').asArray().map((b) => b.asBoolean()), [true, true], '両端を延ばす(形の中は必ず塗る)')
  const fn = dig(doc, sh, 'Function')
  assert.equal(dig(doc, fn, 'FunctionType').asNumber(), 3)
  const parts = dig(doc, fn, 'Functions').asArray().map((f) => doc.context.lookup(f))
  assert.equal(parts.length, 2)
  assert.deepEqual(nums(doc, dig(doc, fn, 'Bounds')), [0.4])
  assert.deepEqual(nums(doc, dig(doc, parts[0], 'C0')), [1, 0, 0])
  assert.deepEqual(nums(doc, dig(doc, parts[0], 'C1')), [0, 1, 0])
  assert.deepEqual(nums(doc, dig(doc, parts[1], 'C1')), [0, 0, 1])
  const c = contentOf(doc)
  assert.match(c, /q\n\/Pattern cs\n\/P\d+ scn\n0 0 200 100 re f\nQ/)
  assert.doesNotMatch(c, /\brg\b/, 'fill の色は paint を読めない時の代わりで、読めた時は使わない')
})

test('radial の paint は Shading 3 で、焦点が始まりの円・外側だけ延ばす・焦点が円の外なら縁の内側へ寄せる', async () => {
  const paint = { kind: 'radial', cx: 100, cy: 50, r: 40, fx: 80, fy: 40, stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#000000' }] }
  const { doc } = await pdfOf([{ ...FULL, fill: '#888888', paint }])
  const sh = dig(doc, doc.context.lookup(entries(dig(doc, resources(doc), 'Pattern'))[0][1]), 'Shading')
  assert.equal(dig(doc, sh, 'ShadingType').asNumber(), 3)
  assert.deepEqual(nums(doc, dig(doc, sh, 'Coords')), [80, 60, 0, 100, 50, 40])
  assert.deepEqual(dig(doc, sh, 'Extend').asArray().map((b) => b.asBoolean()), [false, true])
  assert.equal(dig(doc, dig(doc, sh, 'Function'), 'FunctionType').asNumber(), 2, '2 つの止まりは Type 2 の 1 つ')
  const far = { kind: 'radial', cx: 100, cy: 50, r: 10, fx: 500, fy: 50, stops: paint.stops }
  const np = normalizePaint(far, (c) => (c === '#ffffff' ? [1, 1, 1] : [0, 0, 0]))
  assert.ok(np.coords[3] > 100 && np.coords[3] <= 109.9, `焦点 ${np.coords[3]}`)
})

test('止まりが 0 と 1 に届かない paint は端の色を延ばし、同じ位置の 2 つの止まりは色が跳ぶ', async () => {
  const toRgb = (c) => ({ '#ff0000': [1, 0, 0], '#00ff00': [0, 1, 0], '#0000ff': [0, 0, 1] })[c] ?? null
  const np = normalizePaint(lin(0, 0, 10, 0, [{ at: 0.3, color: '#ff0000' }, { at: 0.7, color: '#0000ff' }]), toRgb)
  assert.deepEqual(np.stops.map((s) => s.at), [0.3, 0.7])
  const { doc } = await pdfOf([{ ...FULL, fill: '#000000', paint: lin(0, 0, 200, 0, [{ at: 0.3, color: '#ff0000' }, { at: 0.7, color: '#0000ff' }]) }])
  const fn = dig(doc, doc.context.lookup(entries(dig(doc, resources(doc), 'Pattern'))[0][1]), 'Shading', 'Function')
  assert.equal(dig(doc, fn, 'FunctionType').asNumber(), 3)
  assert.deepEqual(nums(doc, dig(doc, fn, 'Bounds')), [0.3, 0.7], '0〜0.3 は赤・0.7〜1 は青を延ばす')
  const hard = await pdfOf([{ ...FULL, fill: '#000000', paint: lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000' }, { at: 0.5, color: '#ff0000' }, { at: 0.5, color: '#0000ff' }, { at: 1, color: '#0000ff' }]) }])
  const hf = dig(hard.doc, hard.doc.context.lookup(entries(dig(hard.doc, resources(hard.doc), 'Pattern'))[0][1]), 'Shading', 'Function')
  const hp = dig(hard.doc, hf, 'Functions').asArray().map((f) => hard.doc.context.lookup(f))
  assert.equal(hp.length, 2, '幅 0 の区間は捨てる')
  assert.deepEqual(nums(hard.doc, dig(hard.doc, hf, 'Bounds')), [0.5])
})

test('止まりの透明度が違う paint は輝度のソフトマスク: 灰色の Shading の Form を頁全体の BBox で SMask に入れる', async () => {
  const paint = lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000', opacity: 1 }, { at: 1, color: '#ff0000', opacity: 0 }])
  const { r, doc } = await pdfOf([{ ...FULL, fill: '#ff0000', paint }])
  assert.deepEqual(r.warnings, [])
  const gs = entries(dig(doc, resources(doc), 'ExtGState'))
  assert.equal(gs.length, 1)
  const g = doc.context.lookup(gs[0][1])
  assert.equal(g.has(PDFName.of('ca')), false, 'ソフトマスクだけ(ca は入れない)')
  const sm = dig(doc, g, 'SMask')
  assert.equal(nameOf(dig(doc, sm, 'S')), 'Luminosity')
  assert.deepEqual(nums(doc, dig(doc, sm, 'BC')), [0], '背景は最後の止まりの透明度')
  const form = dig(doc, sm, 'G')
  assert.ok(form instanceof PDFStream)
  assert.deepEqual(nums(doc, dig(doc, form, 'BBox')), [0, 0, 200, 100], 'BBox は頁全体(狭めると外が消える)')
  assert.equal(nameOf(dig(doc, form, 'Group', 'S')), 'Transparency')
  assert.equal(nameOf(dig(doc, form, 'Group', 'CS')), 'DeviceGray')
  assert.equal(new TextDecoder().decode(decodePDFRawStream(form).decode()).trim(), '/Sm sh')
  const gray = dig(doc, form, 'Resources', 'Shading', 'Sm')
  assert.equal(nameOf(dig(doc, gray, 'ColorSpace')), 'DeviceGray')
  const colorSh = dig(doc, doc.context.lookup(entries(dig(doc, resources(doc), 'Pattern'))[0][1]), 'Shading')
  assert.deepEqual(nums(doc, dig(doc, gray, 'Coords')), nums(doc, dig(doc, colorSh, 'Coords')), '色と透明度の Shading は同じ座標')
  assert.deepEqual(nums(doc, dig(doc, gray, 'Function', 'C0')), [1])
  assert.deepEqual(nums(doc, dig(doc, gray, 'Function', 'C1')), [0])
  assert.match(contentOf(doc), /q\n\/GS[-\d]* gs\n\/Pattern cs\n\/P\d+ scn\n/)
  assert.ok(hasGroup(doc), 'ソフトマスクを使った頁は Group を持つ')
})

test('止まりの透明度がそろった paint はソフトマスクにせず ca に掛け、図形の opacity と掛け合わせる', async () => {
  const paint = lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000', opacity: 0.5 }, { at: 1, color: '#0000ff', opacity: 0.5 }])
  const { doc } = await pdfOf([{ ...FULL, fill: '#ff0000', paint, opacity: 0.5 }])
  const gs = entries(dig(doc, resources(doc), 'ExtGState'))
  assert.equal(gs.length, 1)
  const g = doc.context.lookup(gs[0][1])
  assert.equal(g.has(PDFName.of('SMask')), false)
  approx(dig(doc, g, 'ca').asNumber(), 0.25)
  approx(dig(doc, g, 'CA').asNumber(), 0.25)
})

test('止まりの透明度が違う paint に線があれば、塗りと線を別の q に分ける(線までソフトマスクで薄くならない)', async () => {
  const paint = lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000', opacity: 1 }, { at: 1, color: '#ff0000', opacity: 0 }])
  const { doc } = await pdfOf([{ ...FULL, fill: '#ff0000', stroke: '#000000', lw: 2, paint }])
  const c = contentOf(doc)
  assert.match(c, /q\n\/GS[-\d]* gs\n\/Pattern cs\n\/P\d+ scn\n0 0 200 100 re f\nQ\nq\n0 0 0 RG\n2 w\n0 0 200 100 re S\nQ/)
})

test('同じ paint は文書の中で Pattern と Shading を 1 つずつだけ作り、頁の中でも同じ名前を使い回す', async () => {
  const paint = lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }])
  const ops = [0, 1, 2].map((i) => ({ t: 'rect', x: i * 10, y: 0, w: 8, h: 8, fill: '#ff0000', paint: { ...paint, stops: paint.stops.map((s) => ({ ...s })) } }))
  const { doc } = await pdfOf(ops)
  assert.equal(entries(dig(doc, resources(doc), 'Pattern')).length, 1)
  const names = [...contentOf(doc).matchAll(/(\/P\d+) scn/g)].map((m) => m[1])
  assert.equal(names.length, 3)
  assert.equal(new Set(names).size, 1)
})

// ================================================================ 不透明度と blend
test('opacity は Rect・字・画像のどれも ExtGState の ca と CA になり、同じ値は 1 つの ExtGState を使い回す', async () => {
  const ops = [
    { t: 'rect', x: 0, y: 0, w: 20, h: 20, fill: '#112233', opacity: 0.4 },
    { t: 'rect', x: 30, y: 0, w: 20, h: 20, fill: '#112233', opacity: 0.4 },
    textOp('不', { x: 60, y: 30, size: 12, opacity: 0.4 }),
    { t: 'image', x: 90, y: 0, w: 20, h: 20, kind: 'png', base64: PNG_1X1, opacity: 0.4 },
    { t: 'rect', x: 120, y: 0, w: 20, h: 20, fill: '#112233', opacity: 0.7 },
  ]
  const { doc } = await pdfOf(ops, { fonts: ['sansBold'] })
  const gs = entries(dig(doc, resources(doc), 'ExtGState'))
  assert.equal(gs.length, 2, '0.4 と 0.7 の 2 つ')
  const byCa = new Map(gs.map(([name, ref]) => [Math.round(dig(doc, doc.context.lookup(ref), 'ca').asNumber() * 100), name]))
  const g4 = doc.context.lookup(gs.find(([n]) => n === byCa.get(40))[1])
  assert.equal(dig(doc, g4, 'ca').asNumber(), dig(doc, g4, 'CA').asNumber())
  assert.deepEqual(g4.keys().map((k) => k.asString()).sort(), ['/CA', '/Type', '/ca'], 'BM も SMask も入れない最小の辞書')
  const c = contentOf(doc)
  assert.equal([...c.matchAll(new RegExp(`/${byCa.get(40)} gs`, 'g'))].length, 4, '0.4 を使う 4 か所が同じ名前')
  assert.match(c, new RegExp(`q\\n/${byCa.get(40)} gs\\nBT\\n`), '字は q の中で gs を掛ける')
  assert.match(c, new RegExp(`q\\n/${byCa.get(40)} gs\\n20 0 0 20 90 80 cm\\n/Im`), '画像は gs の後に cm')
  assert.ok(hasGroup(doc))
})

test('blend は 12 種が PDF の /BM の名前になり、normal は ExtGState を作らず、知らない名前は normal で描いて warnings に書く', async () => {
  const names = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion']
  const want = ['Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge', 'ColorBurn', 'HardLight', 'SoftLight', 'Difference', 'Exclusion']
  const ops = names.map((b, i) => ({ t: 'rect', x: i * 10, y: 0, w: 8, h: 8, fill: '#336699', blend: b }))
  ops.push({ t: 'path', d: 'M 0 50 L 10 50 L 10 60 Z', fill: '#336699', blend: 'multiply' })
  ops.push({ t: 'rect', x: 0, y: 70, w: 8, h: 8, fill: '#336699', blend: 'normal' })
  ops.push({ t: 'rect', x: 20, y: 70, w: 8, h: 8, fill: '#336699', blend: 'plus-lighter' })
  const { r, doc } = await pdfOf(ops)
  const gs = entries(dig(doc, resources(doc), 'ExtGState'))
  const bm = gs.map(([, ref]) => nameOf(dig(doc, doc.context.lookup(ref), 'BM'))).sort()
  assert.deepEqual(bm, [...want].sort(), 'multiply は path と rect で 1 つに使い回す')
  assert.ok(r.warnings.some((w) => w.includes('plus-lighter')), r.warnings.join('\n'))
  assert.equal(gs.length, 11)
  assert.ok(hasGroup(doc))
})

test('今までの PathOp.opacity だけの頁には Group を足さず、新しい欄を使った頁にだけ足す', async () => {
  const old = await pdfOf([{ t: 'path', d: 'M 1 2 L 30 40 L 5 60 Z', fill: '#999999', opacity: 0.5 }])
  assert.equal(hasGroup(old.doc), false)
  const gs = entries(dig(old.doc, resources(old.doc), 'ExtGState'))
  assert.deepEqual(old.doc.context.lookup(gs[0][1]).keys().map((k) => k.asString()).sort(), ['/CA', '/Type', '/ca'])
  const fresh = await pdfOf([{ t: 'rect', x: 0, y: 0, w: 5, h: 5, fill: '#999999', opacity: 0.5 }])
  assert.equal(hasGroup(fresh.doc), true)
  const g = dig(fresh.doc, fresh.doc.getPage(0).node, 'Group')
  assert.equal(nameOf(dig(fresh.doc, g, 'S')), 'Transparency')
  assert.equal(nameOf(dig(fresh.doc, g, 'CS')), 'DeviceRGB')
})

// ================================================================ 角丸と影
test('RectOp.r は 4 つの曲線で閉じた道筋になって re を使わず、半径は短い辺の半分までに切る', async () => {
  const { doc } = await pdfOf([
    { t: 'rect', x: 10, y: 10, w: 80, h: 40, fill: '#112233', r: 8 },
    { t: 'rect', x: 10, y: 60, w: 80, h: 20, stroke: '#112233', lw: 1, r: 500 },
    { t: 'rect', x: 100, y: 10, w: 30, h: 30, fill: '#112233', r: 0 },
    { t: 'rect', x: 140, y: 10, w: 30, h: 30, fill: '#112233', r: -3 },
  ])
  const c = contentOf(doc)
  const rounded = c.split('Q').slice(0, 2)
  for (const q of rounded) {
    assert.equal([...q.matchAll(/ c\n/g)].length, 4, '角が 4 つ')
    assert.doesNotMatch(q, / re /)
    assert.match(q, /\nh\n[fS]\n$/, '閉じて塗る')
  }
  assert.match(rounded[0], /q\n[\d. ]+ rg\n18 90 m\n82 90 l\n/, '左上の角の少し右から始まる(半径 8)')
  // 2 つ目の半径は 500 を 10(高さの半分)に切る: 上の辺は 10 から 80 までの内側
  assert.match(rounded[1], /\n20 \d+ m\n80 \d+ l\n/)
  assert.equal([...c.matchAll(/ re (?:f|S)\n/g)].length, 2, 'r が 0 と負の物は今までの re')
})

test('shadow は SMask つきの画像を四角の前に Artifact として描き、dx と dy の分だけ動く', async () => {
  const shadow = { dx: 6, dy: 10, blur: 12, color: '#102030', opacity: 0.5 }
  const { r, doc } = await pdfOf([{ t: 'rect', x: 50, y: 20, w: 100, h: 60, fill: '#ffffff', r: 8, shadow, tag: 1 }])
  assert.deepEqual(r.warnings, [])
  const xo = entries(dig(doc, resources(doc), 'XObject'))
  assert.equal(xo.length, 1)
  const img = doc.context.lookup(xo[0][1])
  assert.equal(nameOf(dig(doc, img, 'Subtype')), 'Image')
  assert.equal(nameOf(dig(doc, img, 'ColorSpace')), 'DeviceRGB')
  const sm = dig(doc, img, 'SMask')
  assert.equal(nameOf(dig(doc, sm, 'ColorSpace')), 'DeviceGray')
  const iw = dig(doc, img, 'Width').asNumber()
  const ih = dig(doc, img, 'Height').asNumber()
  assert.equal(dig(doc, sm, 'Width').asNumber(), iw)
  const alpha = decodePDFRawStream(doc.context.lookup(img.dict.get(PDFName.of('SMask')))).decode()
  assert.equal(alpha.length, iw * ih)
  assert.equal(alpha[0], 0, '角は透明')
  assert.ok(alpha[Math.floor(ih / 2) * iw + Math.floor(iw / 2)] > 240, '中心は不透明(ぼかしの σ より四角が十分大きい所)')
  const base = decodePDFRawStream(img).decode()
  assert.deepEqual([...base.slice(0, 3)], [0x10, 0x20, 0x30], '影の色')
  const c = contentOf(doc)
  // Artifact(影)→ 四角の本体の順で、影の gs は ca 0.5
  const iShadow = c.indexOf('/Artifact BMC')
  const iRect = c.indexOf('/P <</MCID')
  assert.ok(iShadow >= 0 && iRect > iShadow, '影は飾りとして本体より前')
  assert.match(c, /\/Artifact BMC\nq\n\/GS[-\d]* gs\n(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\n\/Sd\d+ Do\nQ\nEMC/)
  const m = /(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\n\/Sd\d+ Do/.exec(c)
  const [wpt, hpt, left, bottom] = m.slice(1).map(Number)
  approx(left + wpt / 2, 50 + 50 + 6, 0.01)
  approx(bottom + hpt / 2, 100 - (20 + 30 + 10), 0.01)
  const g = doc.context.lookup(entries(dig(doc, resources(doc), 'ExtGState'))[0][1])
  assert.equal(dig(doc, g, 'ca').asNumber(), 0.5, '不透明度は画像の α でなく ca')
  assert.ok(hasGroup(doc))
})

test('同じ大きさ・角丸・ぼかし・色の影は文書で 1 つの画像を使い回す(違う大きさは別の画像)', async () => {
  const shadow = { dx: 0, dy: 4, blur: 10, color: '#000000', opacity: 0.3 }
  const card = (x, w) => ({ t: 'rect', x, y: 10, w, h: 40, fill: '#ffffff', r: 6, shadow })
  const { doc } = await pdfOf([card(0, 50), card(60, 50), card(120, 50), card(0, 70)])
  assert.equal(entries(dig(doc, resources(doc), 'XObject')).length, 2)
  const names = [...contentOf(doc).matchAll(/(\/Sd\d+) Do/g)].map((m) => m[1])
  assert.equal(names.length, 4)
  assert.equal(new Set(names).size, 2)
})

test('shadowRaster は σ = blur / 2 のガウスに近い: 縁で約 50%・1σ 外で約 16%・ぼかしなしは縁がくっきり', () => {
  const big = shadowRaster(400, 400, 0, 20)
  const row = Math.floor(big.ih / 2)
  const at = (px) => big.alpha[row * big.iw + px] / 255
  const edge = (big.iw - 400 * big.sc) / 2
  // 画素の中心から縁までの距離 d(縁の内側が正)での、σ = 10 のガウスの累積
  const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y }
  const want = (px) => 0.5 * (1 + erf((px + 0.5 - edge) / (10 * big.sc * Math.SQRT2)))
  for (const px of [edge - 20, edge - 10, edge, edge + 10, edge + 20]) approx(at(px), want(px), 0.02)
  assert.ok(at(Math.floor(big.iw / 2)) > 0.999)
  const sharp = shadowRaster(40, 40, 4, 0)
  assert.equal(sharp.sc, 2, '鋭い影は 2 画素/pt')
  const srow = Math.floor(sharp.ih / 2)
  const sedge = Math.round((sharp.iw - 40 * sharp.sc) / 2)
  assert.ok(sharp.alpha[srow * sharp.iw + sedge - 3] < 8 && sharp.alpha[srow * sharp.iw + sedge + 3] > 247, 'ぼかし 0 は 1.5pt の中で 0 から 1')
  assert.equal(shadowRaster(100, 50, 6, 24).sc, 1, 'σ が 3pt 以上なら 1 画素/pt')
})

test('shadowRaster は箱ぼかしの半径を 3 回の幅の混ぜで σ に合わせ、巨大な四角でも 100 万画素を超えない', () => {
  for (const sigma of [1, 3, 5, 12, 40]) {
    const radii = boxRadii(sigma)
    // 幅 d の箱 1 回の分散は (d² - 1) / 12
    const variance = radii.reduce((s, r) => s + ((2 * r + 1) ** 2 - 1) / 12, 0)
    approx(Math.sqrt(variance), sigma, sigma * 0.12 + 0.2)
  }
  const huge = shadowRaster(19000, 15000, 30, 300)
  assert.ok(huge.iw * huge.ih <= 1_000_000, `${huge.iw}×${huge.ih}`)
})

test('壊れた shadow・大きすぎる四角は影なしで描き(warnings)、本体は描く', async () => {
  const bad = [
    { dx: 0, dy: 0, blur: Number.NaN, color: '#000000', opacity: 0.5 },
    { dx: 0, dy: 0, blur: 4, color: 'red', opacity: 0.5 },
    { dx: 0, dy: 0, blur: 4, color: '#000000', opacity: 0 },
    { dx: 0, dy: 0, blur: -2, color: '#000000', opacity: 0.5 },
  ]
  const ops = bad.map((shadow, i) => ({ t: 'rect', x: i * 10, y: 0, w: 8, h: 8, fill: '#336699', shadow }))
  ops.push({ t: 'rect', x: 0, y: 20, w: 30000, h: 10, fill: '#336699', shadow: { dx: 0, dy: 0, blur: 4, color: '#000000', opacity: 0.5 } })
  ops.push({ t: 'rect', x: 0, y: 40, w: 8, h: 8, fill: '#336699', shadow: 'no' })
  const { r, doc } = await pdfOf(ops)
  assert.ok(r.warnings.length >= 3, r.warnings.join('\n'))
  assert.equal(countRes(doc, 'XObject'), 0, '画像は 1 つも入らない')
  assert.equal([...contentOf(doc).matchAll(/ re f\n/g)].length, 6, '本体の四角は全部描く')
})

test('影の画素の合計が上限を超えたら残りは描かず、warnings に書く', async () => {
  // 1 つずつは通る大きさを大きさ違いで並べ、1 文書の合計(12,000,000 画素)を超えさせる
  const ops = []
  for (let i = 0; i < 40; i++) ops.push({ t: 'rect', x: 0, y: 0, w: 900 + i, h: 1000 + i, fill: '#ffffff', shadow: { dx: 0, dy: 0, blur: 30, color: '#000000', opacity: 0.4 } })
  const { r } = await pdfOf(ops)
  assert.ok(r.warnings.some((w) => w.includes('影が多すぎる')), r.warnings.join('\n'))
})

// ================================================================ clip の形
test('ClipOp.d は d の形で切り(W n)、読めない d は外接の四角で切って warnings に書く', async () => {
  const body = [{ t: 'rect', x: 0, y: 0, w: 200, h: 100, fill: '#ff0000' }]
  const { r, doc } = await pdfOf([
    { t: 'clip', x: 10, y: 10, w: 80, h: 80, d: 'M 50 10 L 90 90 L 10 90 Z', ops: body },
    { t: 'clip', x: 100, y: 10, w: 50, h: 50, d: 'M 100 10 Q 150 10 150 60', ops: body },
    { t: 'clip', x: 160, y: 10, w: 20, h: 20, ops: body },
  ])
  const c = contentOf(doc)
  assert.match(c, /q\n50 90 m\n90 10 l\n10 10 l\nh W n\n/, '三角の道筋で切る')
  assert.match(c, /q\n100 40 50 50 re W n/, '読めない d は四角')
  assert.match(c, /q\n160 70 20 20 re W n/, 'd が無ければ今までの四角')
  assert.ok(r.warnings.some((w) => w.includes('clip の d')), r.warnings.join('\n'))
  assert.equal([...c.matchAll(/\bQ\b/g)].length, [...c.matchAll(/\bq\b/g)].length, 'q と Q の数が合う')
})

// ================================================================ 字のグラデーション
test('TextOp.paint は Tr 7 で字を切り抜いて Shading で塗り、字は選べる字のまま・次の字の色指定は抜けない', async () => {
  const text = textOp('グラデ', { x: 10, y: 60, size: 40, color: '#222222', paint: lin(10, 0, 130, 0, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]), tag: 1, actual: 'グラデ' })
  const next = textOp('次', { x: 150, y: 60, size: 20, color: '#222222', tag: 1 })
  const { r, doc } = await pdfOf([textOp('前', { x: 150, y: 20, size: 12, color: '#222222', tag: 1 }), text, next], { fonts: ['sansBold'] })
  assert.deepEqual(r.warnings, [])
  const c = contentOf(doc)
  assert.match(c, /q\nBT\n\S+ 40 Tf\n7 Tr\n1 0 0 1 10 40 Tm\n\[<[0-9a-f]+>[^\]]*\] TJ\nET\n\/Sh\d+ sh\nQ/)
  assert.equal([...c.matchAll(/0\.1333 0\.1333 0\.1333 rg/g)].length, 1, '同じ色の字に rg は 1 回(paint の字の前後で記憶がずれない)')
  const shs = entries(dig(doc, resources(doc), 'Shading'))
  assert.equal(shs.length, 1)
  assert.equal(dig(doc, doc.context.lookup(shs[0][1]), 'ShadingType').asNumber(), 2)
  const pdf = await getDocument({ data: r.bytes8.slice(), useSystemFonts: false, verbosity: 0 }).promise
  const tc = await (await pdf.getPage(1)).getTextContent()
  assert.equal(tc.items.map((i) => i.str).join('').replace(/\s+/g, ''), '前グラデ次')
})

test('字の paint を読めない時は color の色の字で描く', async () => {
  const text = textOp('字', { x: 10, y: 60, size: 40, color: '#222222', paint: { kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ at: 0, color: '#ff0000' }] } })
  const { r, doc } = await pdfOf([text], { fonts: ['sansBold'] })
  assert.ok(r.warnings.some((w) => w.includes('paint') && w.includes('color')), r.warnings.join('\n'))
  assert.match(contentOf(doc), /0\.1333 0\.1333 0\.1333 rg\nBT\n/)
  assert.doesNotMatch(contentOf(doc), /7 Tr/)
})

// ================================================================ 壊れた入力
test('壊れた paint・止まりの色・座標は投げず、fill の色で塗って warnings に書く(同じ警告は 1 回)', async () => {
  const st = [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]
  const bad = [
    lin(0, 0, 10, 0, [st[0]]),
    lin(0, 0, 10, 0, [st[0], { at: 1, color: 'blue' }]),
    lin(Number.NaN, 0, 10, 0, st),
    { kind: 'conic', stops: st },
    { kind: 'radial', cx: 1, cy: 1, r: Number.NaN, stops: st },
    'linear',
  ]
  const ops = bad.map((paint, i) => ({ t: 'rect', x: i * 10, y: 0, w: 8, h: 8, fill: '#336699', paint }))
  ops.push({ t: 'path', d: 'M 0 20 L 10 20 L 10 30 Z', fill: '#336699', paint: bad[0] })
  const { r, doc } = await pdfOf(ops)
  assert.ok(r.warnings.filter((w) => w.includes('paint を読めなかった')).length >= 1)
  assert.equal(new Set(r.warnings).size, r.warnings.length, '同じ警告は 1 回')
  const c = contentOf(doc)
  assert.equal([...c.matchAll(/0\.2 0\.4 0\.6 rg/g)].length, 7, '全部 fill の色で描く')
  assert.equal(countRes(doc, 'Pattern'), 0)
})

test('直線の両端が同じ点・放射の半径が 0 の paint は、最後の止まりの単色(透明度も)で塗る', async () => {
  const st = [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff', opacity: 0.5 }]
  const { r, doc } = await pdfOf([
    { t: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#000000', paint: lin(5, 5, 5, 5, st) },
    { t: 'rect', x: 20, y: 0, w: 10, h: 10, fill: '#000000', paint: { kind: 'radial', cx: 5, cy: 5, r: 0, stops: st } },
  ])
  assert.deepEqual(r.warnings, [])
  const c = contentOf(doc)
  assert.equal([...c.matchAll(/0 0 1 rg/g)].length, 2)
  assert.equal(countRes(doc, 'Pattern'), 0)
  const gs = entries(dig(doc, resources(doc), 'ExtGState'))
  assert.equal(gs.length, 1)
  assert.equal(dig(doc, doc.context.lookup(gs[0][1]), 'ca').asNumber(), 0.5)
})

// ================================================================ 今までの Op
test('今までの Op(paint などを持たない)は今までの描き方のまま: 四角・図形・画像・字・clip の文字列が変わらない', async () => {
  const { doc } = await pdfOf([
    { t: 'rect', x: 10, y: 20, w: 30, h: 40, fill: '#112233', stroke: '#445566', lw: 2 },
    { t: 'rect', x: 50, y: 20, w: 30, h: 40, fill: '#112233' },
    { t: 'rect', x: 90, y: 20, w: 30, h: 40, stroke: '#445566' },
    { t: 'path', d: 'M 1 2 L 3 4 Z', fill: '#000000', stroke: '#ffffff', lw: 3, fillRule: 'evenodd', cap: 'round', join: 'bevel', dash: [2, 1] },
    { t: 'path', d: 'M 1 2 L 3 4 Z', fill: '#000000', opacity: 0.5 },
    { t: 'image', x: 5, y: 5, w: 10, h: 10, kind: 'png', base64: PNG_1X1 },
    { t: 'clip', x: 1, y: 2, w: 3, h: 4, ops: [] },
    textOp('旧', { x: 100, y: 80, size: 10, color: '#112233' }),
  ], { fonts: ['sansBold'] })
  const c = contentOf(doc)
  const gs = [...c.matchAll(/(\/GS[-\d]*) gs/g)].map((m) => m[1])
  assert.equal(gs.length, 1)
  const parts = c.split('\n')
  const joined = parts.join('\n')
  assert.ok(joined.includes('q\n0.0667 0.1333 0.2 rg\n0.2667 0.3333 0.4 RG\n2 w\n10 40 30 40 re B\nQ'))
  assert.ok(joined.includes('q\n0.0667 0.1333 0.2 rg\n50 40 30 40 re f\nQ'))
  assert.ok(joined.includes('q\n0.2667 0.3333 0.4 RG\n1 w\n90 40 30 40 re S\nQ'))
  assert.ok(joined.includes('q\n0 0 0 rg\n1 1 1 RG\n3 w\n1 J\n2 j\n[2 1] 0 d\n1 98 m\n3 96 l\nh\nB*\nQ'))
  assert.ok(joined.includes(`q\n${gs[0]} gs\n0 0 0 rg\n1 98 m\n3 96 l\nh\nf\nQ`))
  assert.match(joined, /q\n10 0 0 10 5 85 cm\n\/Im[-\d]* Do\nQ/)
  assert.ok(joined.includes('q\n1 94 3 4 re W n\nQ'))
  assert.match(joined, /0\.0667 0\.1333 0\.2 rg\nBT\n\S+ 10 Tf\n1 0 0 1 100 20 Tm\n\[<[0-9a-f]+>\] TJ\nET/)
  assert.equal(hasGroup(doc), false)
  assert.equal(countRes(doc, 'Pattern'), 0)
  assert.equal(countRes(doc, 'Shading'), 0)
})

test('同じ入力なら PDF のバイトも同じで、7 ビットの字だけ・どの流れも ASCII85 で包まれる', async () => {
  const build = () => layoutOf([
    { ...FULL, fill: '#000000', paint: lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000', opacity: 1 }, { at: 1, color: '#0000ff', opacity: 0.2 }]), r: 6, shadow: { dx: 1, dy: 2, blur: 8, color: '#000000', opacity: 0.4 } },
    textOp('字', { paint: lin(0, 0, 50, 0, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]), size: 30 }),
  ], { fonts: ['sansBold'] })
  const a = await render(build(), ['sansBold'])
  const b = await render(build(), ['sansBold'])
  assert.equal(a.text, b.text)
  assert.match(a.text, /^[\x00-\x7f]*$/)
  const doc = await lowLoad(a.bytes8)
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue
    const f = obj.dict.get(PDFName.of('Filter'))
    const first = f instanceof PDFArray ? f.get(0) : f
    assert.equal(nameOf(first), 'ASCII85Decode')
  }
})

// ================================================================ 絵にして画素を確かめる
test('絵: linear は左から右・上から下の向きで色が変わる(y の裏返しが合っている)', needPoppler, async () => {
  const h = await pic([{ ...FULL, fill: '#000000', paint: lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]) }])
  near(h.px(2, 50), [250, 0, 5], 12, '左')
  near(h.px(197, 50), [5, 0, 250], 12, '右')
  near(h.px(100, 50), [127, 0, 127], 14, '中')
  const v = await pic([{ ...FULL, fill: '#000000', paint: lin(100, 0, 100, 100, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]) }])
  near(v.px(100, 2), [250, 0, 5], 14, '上は最初の止まり')
  near(v.px(100, 97), [5, 0, 250], 14, '下は最後の止まり')
})

test('絵: radial は中心が最初の止まり・縁が最後の止まり・円の外は最後の色が続く', needPoppler, async () => {
  const p = await pic([{ ...FULL, fill: '#ff00ff', paint: { kind: 'radial', cx: 100, cy: 50, r: 40, stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#000000' }] } }])
  near(p.px(100, 50), [255, 255, 255], 8, '中心')
  near(p.px(100, 70), [128, 128, 128], 16, '半径の半分')
  near(p.px(100 + 38, 50), [13, 13, 13], 22, '縁の近く')
  near(p.px(195, 5), [0, 0, 0], 4, '円の外')
})

test('絵: 止まりの透明度で形が紙に溶ける(右端で完全に透明)・帯の途中は半透明', needPoppler, async () => {
  const p = await pic([
    { t: 'rect', x: 0, y: 0, w: 200, h: 100, fill: '#ffffff' },
    { ...FULL, fill: '#ff0000', paint: lin(0, 0, 200, 0, [{ at: 0, color: '#ff0000', opacity: 1 }, { at: 1, color: '#ff0000', opacity: 0 }]) },
  ])
  near(p.px(2, 50), [255, 4, 4], 12, '左は不透明な赤')
  near(p.px(100, 50), [255, 128, 128], 16, '中は半透明')
  near(p.px(197, 50), [255, 252, 252], 8, '右は紙の白')
})

test('絵: multiply は下の色に掛かり、normal の同じ四角は上の色で覆う', needPoppler, async () => {
  const p = await pic([
    { t: 'rect', x: 0, y: 0, w: 200, h: 100, fill: '#ff8000' },
    { t: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#808080', blend: 'multiply' },
    { t: 'rect', x: 100, y: 0, w: 100, h: 100, fill: '#808080' },
  ])
  near(p.px(50, 50), [128, 64, 0], 6, 'multiply')
  near(p.px(150, 50), [128, 128, 128], 4, 'normal')
})

test('絵: ClipOp.d は三角の外を塗らない', needPoppler, async () => {
  const p = await pic([{ t: 'clip', x: 10, y: 10, w: 180, h: 80, d: 'M 100 10 L 190 90 L 10 90 Z', ops: [{ ...FULL, fill: '#ff0000' }] }])
  near(p.px(100, 80), [255, 0, 0], 4, '三角の中')
  near(p.px(20, 20), [255, 255, 255], 4, '三角の外(左上)')
  near(p.px(185, 20), [255, 255, 255], 4, '三角の外(右上)')
})

test('絵: 角丸の四角は角が抜け、影は四角の下に落ちて上には出ない', needPoppler, async () => {
  const p = await pic([{ t: 'rect', x: 60, y: 20, w: 80, h: 40, fill: '#ffffff', r: 10, shadow: { dx: 0, dy: 8, blur: 12, color: '#000000', opacity: 0.6 } }])
  const lum = ([r, g, b]) => (r + g + b) / 3
  assert.ok(lum(p.px(100, 68)) < 200, `四角の下に影 ${lum(p.px(100, 68))}`)
  assert.ok(lum(p.px(100, 12)) > lum(p.px(100, 68)) + 25, '上の影は下より薄い')
  near(p.px(100, 40), [255, 255, 255], 3, '四角の中は白')
  near(p.px(5, 95), [255, 255, 255], 3, '遠くは紙の白')
  const sq = await pic([{ t: 'rect', x: 60, y: 20, w: 80, h: 40, fill: '#000000', r: 14 }])
  near(sq.px(61, 21), [255, 255, 255], 20, '角は丸く抜ける')
  near(sq.px(100, 40), [0, 0, 0], 3, '中は塗る')
})

test('絵: 字のグラデーションは字の左で赤・右で青になり、字の外は塗らない', needPoppler, async () => {
  const p = await pic([textOp('一二三', { x: 10, y: 70, size: 60, color: '#00ff00', paint: lin(10, 0, 190, 0, [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }]) })], { fonts: ['sansBold'] })
  let left = [0, 0, 0, 0]
  let right = [0, 0, 0, 0]
  let green = 0
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const [r, g, b] = p.px(x, y)
      if (r > 250 && g > 250 && b > 250) continue
      if (g > 200 && r < 80) green++
      const bucket = x < 60 ? left : x > 140 ? right : null
      if (bucket && r + b > 150) { bucket[0] += r; bucket[1] += b; bucket[2] += 1 }
    }
  }
  assert.ok(left[2] > 30 && right[2] > 30, `字の画素 ${left[2]}・${right[2]}`)
  assert.ok(left[0] / left[2] > left[1] / left[2] + 100, '左は赤が強い')
  assert.ok(right[1] / right[2] > right[0] / right[2] + 100, '右は青が強い')
  assert.equal(green, 0, 'color の緑は出ない(paint が優先)')
})

test('絵: opacity 0.5 の黒は紙の上で灰色になる(字・画像・四角)', needPoppler, async () => {
  const p = await pic([
    { t: 'rect', x: 0, y: 0, w: 50, h: 100, fill: '#000000', opacity: 0.5 },
    { t: 'image', x: 50, y: 0, w: 50, h: 100, kind: 'png', base64: PNG_1X1, opacity: 0.5 },
    textOp('■', { x: 110, y: 90, size: 80, color: '#000000', opacity: 0.5 }),
  ], { fonts: ['sansBold'] })
  near(p.px(25, 50), [128, 128, 128], 4, '四角')
  const solidImg = (await pic([{ t: 'image', x: 50, y: 0, w: 50, h: 100, kind: 'png', base64: PNG_1X1 }])).px(75, 50)
  near(p.px(75, 50), solidImg.map((v) => (v + 255) / 2), 6, '画像は紙と半分ずつ')
  let dark = 0
  let grey = 0
  for (let y = 0; y < p.h; y++) for (let x = 105; x < p.w; x++) { const v = p.px(x, y)[0]; if (v < 30) dark++; else if (v > 110 && v < 146) grey++ }
  assert.equal(dark, 0, '字は黒にならない')
  assert.ok(grey > 200, `字は灰色 ${grey}`)
})

// ================================================================ 速さ
function shadowDeck(n) {
  const ops = []
  for (let i = 0; i < n; i++) {
    ops.push({ t: 'rect', x: 20 + (i % 5) * 150, y: 20 + Math.floor(i / 5) * 120, w: 130 + i * 3, h: 90 + i * 2, fill: '#ffffff', stroke: '#cccccc', lw: 0.5, r: 8 + (i % 4), shadow: { dx: 0, dy: 4 + (i % 3), blur: 10 + i, color: '#101828', opacity: 0.25 } })
  }
  return layoutOf(ops, { w: 842, h: 595 })
}

test('大きさの違う影 20 枚を 1 秒以内に PDF にする', async () => {
  const layout = shadowDeck(20)
  const times = []
  let last
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    last = await renderPdf(layout, { fontBytes: {} })
    times.push(performance.now() - t0)
  }
  assert.equal(countRes(await lowLoad(new Uint8Array(Buffer.from(last.text, 'latin1'))), 'XObject'), 20, '影の画像は大きさごとに 1 つ')
  assert.ok(Math.min(...times) <= 1000, `影 20 枚 ${times.map((t) => Math.round(t)).join('・')}ms`)
})

// フックと同じ vm(Node の物なし・大域の名前の参照が遅い)でも、20 枚の影とグラデーションが描ける
const VM_ENTRY = [
  "import { renderPdf } from './render/pdf.mjs'",
  "import { joinB64 } from './vendor/pdf.mjs'",
  'const layout = JSON.parse(host.layoutJson)',
  'const fontBytes = {}',
  'for (const id of layout.fonts) fontBytes[id] = joinB64(JSON.parse(host.fontParts(id)))',
  'const t0 = performance.now()',
  'const r = await renderPdf(layout, { fontBytes })',
  'const ms = performance.now() - t0',
  'host.done(r.text, JSON.stringify({ pages: r.pages, bytes: r.bytes, warnings: r.warnings, ms, seven: !/[^\\x00-\\x7f]/.test(r.text) }))',
].join('\n')
const VM_RUNNER = [
  "import vm from 'node:vm'",
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const root = process.env.MP_ROOT',
  'const globals = Object.create(null)',
  'Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance, console })',
  "const manifest = JSON.parse(fs.readFileSync(path.join(root, 'fonts', 'fonts.json'), 'utf8'))",
  'const files = JSON.parse(process.env.MP_FONT_FILES)',
  'globals.host = {',
  "  layoutJson: fs.readFileSync(process.env.MP_LAYOUT, 'utf8'),",
  "  fontParts: (id) => JSON.stringify(manifest[files[id]].parts.map((p) => fs.readFileSync(path.join(root, 'fonts', p)).toString('base64'))),",
  "  done: (text, meta) => { fs.writeFileSync(process.env.MP_OUT, text, 'latin1'); console.log(meta) },",
  '}',
  'const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })',
  'const cache = new Map()',
  'const load = (file) => {',
  "  if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }))",
  '  return cache.get(file)',
  '}',
  'const linker = async (spec, ref) => load(path.resolve(path.dirname(ref.identifier), spec))',
  "const entry = new vm.SourceTextModule(process.env.MP_ENTRY, { identifier: path.join(root, 'hooks', 'entry-for-test.mjs'), context })",
  'await entry.link(linker)',
  'await entry.evaluate()',
].join('\n')

test('フックと同じ vm で、影 20 枚・グラデーション・字の切り抜きを含む Layout が描けて、1.5 秒以内に収まる', async () => {
  const layout = shadowDeck(20)
  layout.fonts = ['sansBold']
  layout.pages[0].ops.push(
    { ...FULL, fill: '#000000', paint: lin(0, 0, 842, 0, [{ at: 0, color: '#3b2fd9', opacity: 1 }, { at: 0.5, color: '#a12bd6', opacity: 0.4 }, { at: 1, color: '#f2542d', opacity: 0 }]) },
    { t: 'rect', x: 0, y: 0, w: 300, h: 200, fill: '#000000', paint: { kind: 'radial', cx: 100, cy: 100, r: 120, stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#ff0000', opacity: 0 }] }, blend: 'multiply' },
    textOp('資料', { x: 30, y: 500, size: 60, paint: lin(30, 0, 150, 0, [{ at: 0, color: '#3b2fd9' }, { at: 1, color: '#f2542d' }]) }),
  )
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modspdf-gfxvm-'))
  const layoutPath = path.join(dir, 'layout.json')
  const outPath = path.join(dir, 'out.pdf')
  fs.writeFileSync(layoutPath, JSON.stringify(layout))
  try {
    const res = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-'], {
      input: VM_RUNNER,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, MP_ROOT: ROOT, MP_LAYOUT: layoutPath, MP_OUT: outPath, MP_ENTRY: VM_ENTRY, MP_FONT_FILES: JSON.stringify(FONT_FILES) },
    })
    assert.equal(res.status, 0, res.stderr)
    const meta = JSON.parse(res.stdout.trim().split('\n').pop())
    assert.equal(meta.seven, true)
    assert.deepEqual(meta.warnings, [])
    assert.ok(meta.bytes < 4 * 1024 * 1024)
    assert.ok(meta.ms <= 1500, `vm の中の描画 ${Math.round(meta.ms)}ms`)
    const doc = await lowLoad(new Uint8Array(fs.readFileSync(outPath)))
    assert.equal(countRes(doc, 'XObject'), 20)
    assert.ok(entries(dig(doc, resources(doc), 'Pattern')).length >= 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ================================================================ 見本の頁(目で見る)
function circle(cx, cy, r) {
  const k = 0.5523 * r
  return `M ${cx + r} ${cy} C ${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r} C ${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy} C ${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r} C ${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy} Z`
}

function gallery() {
  const W = 841.89
  const H = 595.28
  const ops = []
  const stops4 = [{ at: 0, color: '#1b2a6b' }, { at: 0.25, color: '#2f6fde' }, { at: 0.5, color: '#29c0a8' }, { at: 0.75, color: '#f5d547' }, { at: 1, color: '#f2813b' }]
  // 背景: 放射の光 2 つ(縁の透明度で紙に溶ける)
  ops.push({ t: 'rect', x: 0, y: 0, w: W, h: H, fill: '#fbfaf7' })
  const glow = (cx, cy, r, color) => ({ t: 'rect', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill: color, paint: { kind: 'radial', cx, cy, r, stops: [{ at: 0, color, opacity: 0.55 }, { at: 0.6, color, opacity: 0.18 }, { at: 1, color, opacity: 0 }] } })
  ops.push(glow(760, 40, 300, '#ff9a3c'), glow(60, 560, 300, '#4a8bff'))
  // 題名: 字のグラデーション
  ops.push(textOp('描画の見本', { x: 30, y: 78, size: 52, color: '#222222', paint: lin(30, 0, 290, 0, [{ at: 0, color: '#1f3c88' }, { at: 0.5, color: '#a12bd6' }, { at: 1, color: '#f2542d' }]), tag: 1 }))
  ops.push(textOp('グラデーション・不透明度・blend・角丸と影・形で切る・字の切り抜き', { font: 'sans', x: 32, y: 104, size: 12, color: '#4a4a4a' }))
  const tw = 182
  const th = 170
  const gx = (i) => 30 + i * (tw + 18)
  const gy = (j) => (j === 0 ? 130 : 345)
  const cap = (i, j, t) => ops.push(textOp(t, { font: 'sans', x: gx(i), y: gy(j) + th + 14, size: 8.5, color: '#4a4a4a' }))
  // 1 多段の帯と放射の玉(焦点)
  ops.push({ t: 'rect', x: gx(0), y: gy(0), w: tw, h: 34, fill: '#2f6fde', r: 8, paint: lin(gx(0), 0, gx(0) + tw, 0, stops4) })
  ops.push({ t: 'path', d: circle(gx(0) + 56, gy(0) + 104, 44), fill: '#2f6fde', paint: { kind: 'radial', cx: gx(0) + 56, cy: gy(0) + 104, r: 44, fx: gx(0) + 41, fy: gy(0) + 87, stops: [{ at: 0, color: '#ffffff' }, { at: 0.16, color: '#c6e4ff' }, { at: 0.5, color: '#3d8bff' }, { at: 0.85, color: '#1e2f8f' }, { at: 1, color: '#0b1450' }] } })
  ops.push({ t: 'path', d: circle(gx(0) + 142, gy(0) + 120, 22), stroke: '#222222', lw: 3, fill: '#f0509b', paint: { kind: 'radial', cx: gx(0) + 142, cy: gy(0) + 120, r: 22, fx: gx(0) + 135, fy: gy(0) + 112, stops: [{ at: 0, color: '#ffe0f0' }, { at: 0.5, color: '#f0509b' }, { at: 1, color: '#8e1b5b' }] } })
  cap(0, 0, '1  多段・放射(焦点)のグラデーション')
  // 2 透明度の帯(ソフトマスク)と線つき
  ops.push({ t: 'rect', x: gx(1), y: gy(0), w: tw, h: th, fill: '#222222', r: 10 })
  ops.push({ t: 'rect', x: gx(1) + 8, y: gy(0) + 10, w: tw - 16, h: 56, fill: '#ff6a00', r: 10, paint: lin(gx(1) + 8, 0, gx(1) + tw - 8, 0, [{ at: 0, color: '#ff6a00', opacity: 1 }, { at: 0.5, color: '#ee0979', opacity: 0.7 }, { at: 1, color: '#6a11cb', opacity: 0 }]) })
  ops.push({ t: 'rect', x: gx(1) + 8, y: gy(0) + 78, w: tw - 16, h: 40, fill: '#ffffff', stroke: '#ffffff', lw: 2, r: 8, paint: lin(gx(1) + 8, 0, gx(1) + tw - 8, 0, [{ at: 0, color: '#29c0a8', opacity: 1 }, { at: 1, color: '#29c0a8', opacity: 0 }]) })
  ops.push(textOp('透明度つきの止まり', { x: gx(1) + 12, y: gy(0) + 146, size: 11, color: '#ffffff' }))
  cap(1, 0, '2  止まりの透明度(ソフトマスク)・線は別')
  // 3 blend
  const modes = ['normal', 'multiply', 'screen', 'overlay']
  modes.forEach((m, k) => {
    const x0 = gx(2) + (k % 2) * (tw / 2)
    const y0 = gy(0) + Math.floor(k / 2) * (th / 2)
    ops.push({ t: 'rect', x: x0 + 1, y: y0 + 1, w: tw / 2 - 2, h: th / 2 - 2, fill: '#8e93a6', r: 6, paint: lin(x0, 0, x0 + tw / 2, 0, [{ at: 0, color: '#2e3140' }, { at: 0.5, color: '#8e93a6' }, { at: 1, color: '#f1eee6' }]) })
    const mx = x0 + tw / 4
    const my = y0 + th / 4 + 2
    ops.push({ t: 'path', d: circle(mx - 12, my - 6, 20), fill: '#ff2d95', blend: m, opacity: 0.92 })
    ops.push({ t: 'path', d: circle(mx + 12, my - 6, 20), fill: '#00b8ff', blend: m, opacity: 0.92 })
    ops.push({ t: 'path', d: circle(mx, my + 14, 20), fill: '#ffd60a', blend: m, opacity: 0.92 })
    ops.push(textOp(m, { x: x0 + 8, y: y0 + 14, size: 8, color: '#ffffff', opacity: 0.9 }))
  })
  cap(2, 0, '3  blend: normal・multiply・screen・overlay')
  // 4 形で切る
  ops.push({ t: 'rect', x: gx(3), y: gy(0), w: tw, h: th, fill: '#eeeeee', r: 10 })
  ops.push({ t: 'clip', x: gx(3) + 10, y: gy(0) + 10, w: tw - 20, h: th - 20, d: `${circle(gx(3) + 48, gy(0) + 52, 34)} M ${gx(3) + 118} ${gy(0) + 24} L ${gx(3) + 170} ${gy(0) + 80} L ${gx(3) + 118} ${gy(0) + 136} L ${gx(3) + 66} ${gy(0) + 100} Z`, ops: [
    { t: 'rect', x: gx(3), y: gy(0), w: tw, h: th, fill: '#ff6a00', paint: lin(gx(3), gy(0), gx(3) + tw, gy(0) + th, [{ at: 0, color: '#ff6a00' }, { at: 0.5, color: '#ee0979' }, { at: 1, color: '#6a11cb' }]) },
    textOp('切る', { x: gx(3) + 84, y: gy(0) + 112, size: 26, color: '#ffffff' }),
  ] })
  cap(3, 0, '4  ClipOp.d(円と多角形の 2 つを 1 回で)')
  // 5 影
  ops.push({ t: 'rect', x: gx(0) - 6, y: gy(1) - 6, w: tw + 12, h: th + 12, fill: '#f4f2f8', r: 12 })
  ops.push({ t: 'rect', x: gx(0) + 6, y: gy(1) + 8, w: 130, h: 80, fill: '#ffffff', stroke: '#e6e3ee', lw: 0.5, r: 10, shadow: { dx: 0, dy: 7, blur: 18, color: '#1a2540', opacity: 0.32 } })
  ops.push(textOp('カード A', { x: gx(0) + 20, y: gy(1) + 36, size: 11, color: '#222222' }))
  ops.push(textOp('blur 18・dy 7', { font: 'sans', x: gx(0) + 20, y: gy(1) + 52, size: 8, color: '#4a4a4a' }))
  ops.push({ t: 'rect', x: gx(0) + 44, y: gy(1) + 96, w: 128, h: 58, fill: '#fff8ec', stroke: '#e6d5b8', lw: 0.5, r: 8, shadow: { dx: 0, dy: 3, blur: 6, color: '#3b1f5e', opacity: 0.4 } })
  ops.push(textOp('カード B', { x: gx(0) + 58, y: gy(1) + 122, size: 10, color: '#222222' }))
  cap(0, 1, '5  角丸の影(SMask つき画像)')
  // 6 opacity
  ops.push({ t: 'rect', x: gx(1), y: gy(1), w: tw, h: th, fill: '#ffffff', stroke: '#cccccc', lw: 0.5, r: 10 })
  ;[1, 0.75, 0.5, 0.25].forEach((o, k) => {
    ops.push({ t: 'rect', x: gx(1) + 12 + k * 40, y: gy(1) + 14, w: 36, h: 70, fill: '#1f3c88', r: 6, opacity: o })
    ops.push(textOp(`${Math.round(o * 100)}`, { font: 'sans', x: gx(1) + 18 + k * 40, y: gy(1) + 100, size: 9, color: '#4a4a4a' }))
  })
  ops.push(textOp('字も半透明', { x: gx(1) + 12, y: gy(1) + 140, size: 24, color: '#222222', opacity: 0.45 }))
  cap(1, 1, '6  opacity(四角・字)')
  // 7 字の切り抜きの 2 行
  ops.push({ t: 'rect', x: gx(2), y: gy(1), w: tw, h: th, fill: '#15131d', r: 10 })
  ops.push(textOp('Aa', { x: gx(2) + 12, y: gy(1) + 86, size: 78, color: '#ffffff', paint: lin(gx(2) + 12, gy(1), gx(2) + 130, gy(1) + 90, stops4) }))
  ops.push(textOp('字の切り抜き', { x: gx(2) + 12, y: gy(1) + 130, size: 22, color: '#ffffff', paint: lin(gx(2) + 12, 0, gx(2) + 140, 0, [{ at: 0, color: '#3b2fd9' }, { at: 0.5, color: '#a12bd6' }, { at: 1, color: '#f2542d' }]) }))
  cap(2, 1, '7  TextOp.paint(Tr 7 + sh)')
  // 8 カードと帯(資料の型のめやす)
  ops.push({ t: 'rect', x: gx(3), y: gy(1), w: tw, h: th, fill: '#ffffff', stroke: '#dcd9e3', lw: 0.5, r: 12, shadow: { dx: 0, dy: 5, blur: 14, color: '#15131d', opacity: 0.18 } })
  ops.push({ t: 'rect', x: gx(3) + 16, y: gy(1) + 16, w: 48, h: 3, fill: '#6a3de8', paint: lin(gx(3) + 16, 0, gx(3) + 64, 0, [{ at: 0, color: '#3b2fd9' }, { at: 0.5, color: '#a12bd6' }, { at: 1, color: '#f2542d' }]) })
  ops.push(textOp('売上の見通し', { x: gx(3) + 16, y: gy(1) + 46, size: 14, color: '#15131d' }))
  ops.push(textOp('48', { x: gx(3) + 16, y: gy(1) + 112, size: 56, color: '#15131d', paint: lin(gx(3) + 16, 0, gx(3) + 100, 0, [{ at: 0, color: '#3b2fd9' }, { at: 1, color: '#f2542d' }]) }))
  ops.push(textOp('億円', { x: gx(3) + 108, y: gy(1) + 112, size: 16, color: '#4b4858' }))
  ops.push(textOp('前年比 +32%', { font: 'sans', x: gx(3) + 16, y: gy(1) + 140, size: 10, color: '#157f3b' }))
  cap(3, 1, '8  資料のカードのめやす(影・角丸・グラデーション)')
  return layoutOf([], {
    w: W, h: H, fonts: ['sans', 'sansBold'],
    pages: [{ ops }],
  })
}

test('見本の頁を out/gfx-pdf/ に書く(グラデーション・透明度・blend・影・clip・字の切り抜きが 1 枚に入る)', async () => {
  const layout = gallery()
  const r = await render(layout, ['sans', 'sansBold'])
  assert.deepEqual(r.warnings, [])
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'gfx.pdf'), r.text, 'latin1')
  const doc = await lowLoad(r.bytes8)
  assert.ok(hasGroup(doc))
  assert.ok(entries(dig(doc, resources(doc), 'Pattern')).length >= 8)
  assert.ok(entries(dig(doc, resources(doc), 'ExtGState')).length >= 5)
  if (HAS_POPPLER) {
    const p = spawnSync('pdftoppm', ['-r', '90', '-png', '-singlefile', path.join(OUT_DIR, 'gfx.pdf'), path.join(OUT_DIR, 'gfx')], { encoding: 'utf8' })
    assert.equal(p.status, 0, p.stderr)
  }
})
