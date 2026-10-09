// @ts-check
// render/pdf: Display List(左上が原点・y は下向き・単位 pt)を、pdf-lib で 7 ビットの PDF にする。
// 内容の流れは演算子の物(PDFOperator)を作らず、字の列で組んで 1 頁 1 本の流れにする。
// 10 頁 40 行で演算子の物が数万個できるのを避けるためと、出力をそのまま読んで試験できるため。
import { PDFDocument, PDFDict, PDFName, PDFHexString, PDFString, PDFNumber, fontkit, save7bit, b64ToBytes, rgb } from '../vendor/pdf.mjs'
import { TagLog, buildStructTree } from './tags.mjs'
import { blendOf, normalizePaint, buildPaint, roundedRectPath, shadowRaster, shadowImage, SHADOW_PX_TOTAL, SHADOW_SIDE_MAX } from './paint.mjs'
import { planAttachments, embedAttachments, addXmp, CREATOR_TOOL, PRODUCER } from './meta.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {ReturnType<typeof planAttachments>} AttachPlan */
/** @typedef {{ role: string, parent: number|null, alt?: string, lang?: string }} Tag */
/** @typedef {{ at: number, color: string, opacity?: number }} Stop */
/** @typedef {{ kind: 'linear', x1: number, y1: number, x2: number, y2: number, stops: Stop[] } | { kind: 'radial', cx: number, cy: number, r: number, fx?: number, fy?: number, stops: Stop[] }} Paint */
/** @typedef {{ dx: number, dy: number, blur: number, color: string, opacity: number }} Shadow */
/** @typedef {{ t: 'text', font: FontId, size: number, color: string, y: number, glyphs: { c: string, x: number }[], tag?: number, actual?: string, paint?: Paint, opacity?: number, blend?: string }} TextOp */
/** @typedef {{ t: 'rule', x1: number, y1: number, x2: number, y2: number, w: number, color: string, dash?: number[], tag?: number }} RuleOp */
/** @typedef {{ t: 'rect', x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number, tag?: number, paint?: Paint, r?: number, opacity?: number, shadow?: Shadow, blend?: string }} RectOp */
/** @typedef {{ t: 'path', d: string, fill?: string, stroke?: string, lw?: number, opacity?: number, fillRule?: 'nonzero'|'evenodd', cap?: 'butt'|'round'|'square', join?: 'miter'|'round'|'bevel', dash?: number[], tag?: number, paint?: Paint, blend?: string }} PathOp */
/** @typedef {{ t: 'clip', x: number, y: number, w: number, h: number, ops: Op[], d?: string }} ClipOp */
/** @typedef {{ t: 'image', x: number, y: number, w: number, h: number, kind: 'png'|'jpg', base64: string, tag?: number, opacity?: number, blend?: string }} ImageOp */
/** @typedef {{ t: 'field', kind: 'text'|'multiline'|'check'|'choice', name: string, x: number, y: number, w: number, h: number, value?: string|boolean, options?: string[], size?: number, tag?: number }} FieldOp */
/** @typedef {{ t: 'link', x: number, y: number, w: number, h: number, url: string }} LinkOp */
/** @typedef {TextOp|RuleOp|RectOp|PathOp|ClipOp|ImageOp|FieldOp|LinkOp} Op */
/** @typedef {{ meta: { title: string, author?: string, subject?: string, lang: string, created: number }, page: { width: number, height: number }, pages: { ops: Op[] }[], tags: Tag[], outline: { title: string, level: number, page: number, y: number }[], fonts: FontId[] }} Layout */

const LIMIT = 4 * 1024 * 1024
// 1 字ずつ encodeText するので合字は出ないが、記入欄の値(複数字)で fi などが 1 つの字形になって位置がずれるのを防ぐ
const NO_LIGATURE = { liga: false, clig: false, dlig: false, calt: false, rlig: false }
const FIELD_PT = 10
const FIELD_BORDER = 0.5
const DASH_MIN_PERIOD = 0.5
const DASH_MAX_ITEMS = 16
/** PNG は embedPng が全画素を開く（10000×10000 の 196 バイトの PNG で 5.2 秒・833 MB）。1 枚と全体の画素数の上限。JPEG は頭を読むだけで開かない */
const PNG_PIXELS_MAX = 24_000_000
const PNG_PIXELS_TOTAL = 48_000_000
const IMAGES_MAX = 100
/** リンクの URL の長さの上限（schema の URL_MAX と同じ） */
const URL_MAX = 2000

/** PDF の実数として安全に書ける大きさ。Acrobat の実数の上限が 32767 で、これを超える座標は紙の外にしかならない */
const NUM_MAX = 32767

/** 小数 3 桁(0.0005pt)より細かい差は要らない。-0 と指数表記(1e-7・1e+21)を出さない。範囲の外は NUM_MAX に丸める */
const num = (/** @type {number} */ v) => {
  const r = Math.round(Math.min(NUM_MAX, Math.max(-NUM_MAX, v)) * 1000) / 1000
  return String(r === 0 ? 0 : r)
}

/** 描かない字(制御字・幅ゼロの印)。位置は次の字の TJ の調整で保たれる */
const isSkippable = (/** @type {number} */ cp) =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff

const errText = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e))

/**
 * PNG の画素数(幅×高さ)を、開かずに塊の並びから読む。
 * pdf-lib の PNG 読みは印(8 バイト)を確かめず、IHDR が何番目の塊でも、何個あっても最後の物を採るので、
 * 先頭だけを見ると小さな IHDR の後ろに大きな IHDR を置く PNG に抜けられる。全部の IHDR を見て大きい方を採る。
 * @param {Uint8Array} bytes
 */
function pngPixelsOf(bytes) {
  const u32 = (/** @type {number} */ o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  let max = -1
  for (let off = 8; off + 12 <= bytes.length; ) {
    const len = u32(off)
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    if (type === 'IHDR' && len >= 8 && off + 16 <= bytes.length) max = Math.max(max, u32(off + 8) * u32(off + 12))
    if (type === 'IEND') break
    off += 12 + len
  }
  if (max < 0) throw new Error('PNG の IHDR が無い')
  return max
}

/**
 * source は make の入力そのもの。渡された時だけ、入力の attach が true なら元の原稿・数字の入口・話す人の覚えを添付し、XMP を付ける(render/meta.mjs)。
 * 渡さない・attach が false の文書の PDF は、添付の仕組みが無かった時と同じ字になる。
 * @param {Layout} layout
 * @param {{ fontBytes: Record<string, Uint8Array>, fieldFont?: FontId, source?: unknown }} opts
 * @returns {Promise<{ text: string, pages: number, bytes: number, warnings: string[] }>}
 */
export async function renderPdf(layout, { fontBytes, fieldFont = 'sans', source }) {
  /** @type {string[]} */
  const extra = []
  /** @type {AttachPlan | null} */
  let plan = null
  if (source !== undefined && source !== null) {
    const p = planAttachments(source, { lang: layout?.meta?.lang })
    extra.push(...p.warnings)
    if (p.attach) plan = p
  }
  let r = await build(layout, fontBytes, fieldFont, false, plan)
  // 添付で 4 MiB を超えたら、添付だけ落とす(XMP は小さいので残す)。記入欄の書体を絞るより先: 添付は無くても資料の中身が変わらない
  if (r.text.length >= LIMIT && plan && plan.files.length) {
    plan = { ...plan, files: [] }
    r = await build(layout, fontBytes, fieldFont, false, plan)
    extra.push('添付を入れると PDF が 4 MiB を超えるので、元の原稿と数字の添付を落とした')
  }
  // 丸ごと入れた記入欄の書体で 4 MiB を超えたら、その書体も使う字だけに絞って作り直す(書体 1 つだけ軽くなる)
  if (r.text.length >= LIMIT && r.fieldFontEmbedded) {
    r = await build(layout, fontBytes, fieldFont, true, plan)
    extra.push('PDF が 4 MiB を超えたので、記入欄の書体も使う字だけに絞った。記入欄に新しく打った字は出ない事がある')
  }
  if (r.text.length >= LIMIT) throw new Error(`renderPdf: PDF が 4 MiB を超えた(${r.text.length} 字)。頁・画像・書体を減らす`)
  return { text: r.text, pages: r.pages, bytes: r.text.length, warnings: [...extra, ...r.warnings] }
}

/** 同じ警告は 1 回だけ */
function makeWarn() {
  const seen = new Set()
  /** @type {string[]} */
  const list = []
  return { add(/** @type {string} */ m) { if (!seen.has(m)) { seen.add(m); list.push(m) } }, list }
}

/**
 * subset の書体名の頭に付ける印(PDF の決まり ISO 32000-1 の 9.6.4: 大文字 6 字 + 「+」)。書体名と使った字から決める。
 * pdf-lib の既定は名前の後ろに乱数(NotoSansJP-Regular-8659)を付けるので、同じ入力でも PDF が毎回違い、subset の印にもならなかった。
 * Why not: 印を付けずに名前だけにする案は選ばなかった。subset なのに印が無い PDF は、別々の subset を結合した時に
 * 同じ名前の書体を見分けられず、ビューアーが字形を取り違える。字の集まりから決めれば、集まりが違えば印も違う。
 * @param {string} psName @param {Iterable<number>} cps
 */
function subsetTag(psName, cps) {
  let h = 0x811c9dc5
  const mix = (/** @type {number} */ v) => { h = Math.imul(h ^ v, 0x01000193) >>> 0 }
  for (const ch of psName) mix(ch.codePointAt(0) ?? 0)
  for (const cp of [...cps].sort((a, b) => a - b)) mix(cp)
  let tag = ''
  for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) }
  return tag
}

/** @param {Uint8Array} bytes @param {string} fallback @returns {string} 書体の PostScript 名(読めなければ fallback) */
function psNameOf(bytes, fallback) {
  try {
    const n = /** @type {any} */ (fontkit).create(bytes).postscriptName
    return typeof n === 'string' && /^[\x21-\x7e]+$/.test(n) ? n : fallback
  } catch { return fallback }
}

/** @param {Op[]} ops @param {{ fonts: Set<string>, images: Map<string, ImageOp>, fieldKinds: Set<string>, chars: Map<string, Set<number>> }} acc */
function scan(ops, acc) {
  for (const op of ops) {
    if (op.t === 'text') {
      acc.fonts.add(op.font)
      let set = acc.chars.get(op.font)
      if (!set) acc.chars.set(op.font, (set = new Set()))
      for (const g of op.glyphs) set.add(g.c.codePointAt(0) ?? 0)
    } else if (op.t === 'image') acc.images.set(op.kind + ':' + op.base64, op)
    else if (op.t === 'field') acc.fieldKinds.add(op.kind)
    else if (op.t === 'clip' && Array.isArray(op.ops)) scan(op.ops, acc)
  }
}

/** pdf-lib の書体から、字ごとの {glyph の 16 進・送り幅(em)} を覚えて返す */
function makeFace(/** @type {any} */ font, /** @type {string} */ id, /** @type {Map<string, Set<string>>} */ missing) {
  /** @type {Map<string, { hex: string, adv: number } | null>} */
  const cache = new Map()
  /** @type {Set<number> | null} */
  let charset = null
  const has = (/** @type {number} */ cp) => {
    if (!charset) charset = new Set(font.getCharacterSet())
    return charset.has(cp)
  }
  return {
    font,
    id,
    has,
    glyph(/** @type {string} */ c) {
      let e = cache.get(c)
      if (e !== undefined) return e
      const cp = c.codePointAt(0) ?? 0
      e = null
      if (!isSkippable(cp)) {
        e = { hex: font.encodeText(c).asString(), adv: font.widthOfTextAtSize(c, 1) }
        if (!has(cp)) {
          const set = missing.get(id) ?? new Set()
          set.add(c)
          missing.set(id, set)
        }
      }
      cache.set(c, e)
      return e
    },
  }
}

/** @typedef {ReturnType<typeof makeFace>} Face */

/** @typedef {{ paints: Map<string, any>, shadows: Map<string, any>, shadowPx: number }} Gfx */
/** @typedef {{ doc: any, ctx: any, W: number, H: number, faces: Map<string, Face>, images: Map<string, any>, tags: Tag[], log: TagLog, warn: { add: (m: string) => void }, colors: Map<string, string | null>, fieldFace: Face | null, form: any, minSize: number, gfx: Gfx }} Build */

/**
 * @param {Layout} layout
 * @param {Record<string, Uint8Array>} fontBytes
 * @param {string} fieldFontId
 * @param {boolean} fieldSubset
 * @param {AttachPlan | null} plan 添付と XMP の計画。無ければ何も足さない
 */
async function build(layout, fontBytes, fieldFontId, fieldSubset, plan) {
  if (!layout || !layout.page || !Array.isArray(layout.pages) || layout.pages.length === 0) throw new Error('renderPdf: Layout に頁が無い')
  const W = layout.page.width
  const H = layout.page.height
  if (!(W > 0 && H > 0)) throw new Error('renderPdf: 頁の大きさが正しくない')
  const warn = makeWarn()
  const tags = Array.isArray(layout.tags) && layout.tags.length ? layout.tags : [{ role: 'Document', parent: null }]

  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  const ctx = doc.context

  const acc = { fonts: new Set(layout.fonts ?? []), images: new Map(), fieldKinds: new Set(), chars: new Map() }
  const declared = new Set(layout.fonts ?? [])
  for (const pg of layout.pages) scan(pg.ops ?? [], acc)
  for (const id of acc.fonts) if (!declared.has(/** @type {any} */ (id))) warn.add(`Layout.fonts に無い書体 ${id} が使われていた`)

  /** @type {Map<string, Set<string>>} */
  const missing = new Map()
  /** @type {Map<string, Face>} */
  const faces = new Map()
  for (const id of acc.fonts) {
    const bytes = fontBytes[id]
    if (!bytes) throw new Error(`renderPdf: fontBytes に ${id} が無い`)
    const ps = psNameOf(bytes, id)
    const customName = `${subsetTag(ps, acc.chars.get(id) ?? [])}+${ps}`
    faces.set(id, makeFace(await doc.embedFont(bytes, { subset: true, customName, features: NO_LIGATURE }), id, missing))
  }

  // 記入欄の書体は丸ごと入れる(見る人が欄に打った字も出る)。チェック欄だけの文書は書体が要らない
  /** @type {Face | null} */
  let fieldFace = null
  if (acc.fieldKinds.has('text') || acc.fieldKinds.has('multiline') || acc.fieldKinds.has('choice')) {
    let fid = fieldFontId
    if (!fontBytes[fid]) {
      fid = [...acc.fonts].find((id) => fontBytes[id]) ?? ''
      if (!fid) throw new Error('renderPdf: 記入欄の書体のバイト列が無い')
      warn.add(`記入欄の書体 ${fieldFontId} が無いので ${fid} を使った`)
    }
    // 丸ごとの書体は subset ではないので印を付けない(絞った時だけ付ける。欄の字は入力の前に決まらないので、字の集まりは書体名だけで決める)
    const ps = psNameOf(fontBytes[fid], fid)
    const customName = fieldSubset ? `${subsetTag('field:' + ps, [])}+${ps}` : ps
    fieldFace = makeFace(await doc.embedFont(fontBytes[fid], { subset: fieldSubset, customName, features: NO_LIGATURE }), 'field:' + fid, missing)
  }

  /** @type {Map<string, any>} */
  const images = new Map()
  let pngPixels = 0
  for (const [key, op] of acc.images) {
    try {
      if (images.size >= IMAGES_MAX) { warn.add(`画像が ${IMAGES_MAX} 枚を超えたので、残りは描かなかった`); break }
      const bytes = b64ToBytes(String(op.base64).replace(/^data:[^,]*,/, ''))
      if (op.kind !== 'jpg') {
        // IHDR(8 バイトの印の後ろ 16〜23 バイト目)の幅と高さだけで画素数を見る。開く前に断らないと、小さな PNG が数 GB に広がる
        const px = pngPixelsOf(bytes)
        if (px > PNG_PIXELS_MAX || pngPixels + px > PNG_PIXELS_TOTAL) { warn.add(`PNG の画素数が多すぎる(${px} 画素)ので描かなかった`); continue }
        pngPixels += px
      }
      images.set(key, op.kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes))
    } catch (e) {
      warn.add(`画像を読めなかったので描かなかった: ${errText(e)}`)
    }
  }

  /** @type {Build} */
  const b = { doc, ctx, W, H, faces, images, tags, log: new TagLog(), warn, colors: new Map(), fieldFace, form: null, minSize: Infinity, gfx: { paints: new Map(), shadows: new Map(), shadowPx: 0 } }

  const pageRefs = []
  for (let pi = 0; pi < layout.pages.length; pi++) {
    const page = doc.addPage([W, H])
    pageRefs.push(page.ref)
    const w = new PageWriter(b, page, pi)
    w.drawOps(layout.pages[pi].ops ?? [])
    w.closeGroup()
    page.node.addContentStream(ctx.register(ctx.flateStream(w.out.join('\n'))))
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'))
    // 混ぜ方(blend)の色空間を決める頁の Group。新しい欄(blend・paint・影・rect と字と画像の opacity)を使った頁だけに付け、
    // 今までの PathOp.opacity だけの頁は Group を足さない(PDF のバイトを変えない)
    if (w.transparent) page.node.set(PDFName.of('Group'), ctx.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' }))
    for (const l of w.links) addLink(b, page, l)
    for (const f of w.fields) addField(b, pi, page, f)
    if (w.bad) warn.add('座標や大きさに数でない値があった(0 として描いた)')
  }

  if (b.minSize < 6.995) warn.add(`7pt 未満の字がある(最小 ${Math.round(b.minSize * 100) / 100}pt)。印刷で読みにくい`)

  if (b.form && fieldFace) {
    // 見る人が欄に打つ字は、欄の DA が指す書体(DR)で描かれる。pdf-lib は DR を作らないので自分で足す
    const acro = b.form.acroForm.dict
    acro.set(PDFName.of('DA'), PDFString.of(`/${fieldFace.font.name} 0 Tf 0 g`))
    acro.set(PDFName.of('DR'), ctx.obj({ Font: { [fieldFace.font.name]: fieldFace.font.ref } }))
  }

  addOutline(doc, layout.outline ?? [], pageRefs, H, warn)
  for (const m of buildStructTree(doc, pageRefs, tags, b.log)) warn.add(m)

  for (const [id, set] of missing) {
    const list = [...set].slice(0, 8)
    warn.add(`書体 ${id} に無い字があった(四角で出る): ${list.map((c) => `「${c}」U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}`).join(' ')}${set.size > 8 ? ' ほか' : ''}`)
  }

  const m = layout.meta ?? /** @type {any} */ ({})
  doc.setTitle(m.title ?? '', { showInWindowTitleBar: true })
  if (m.author) doc.setAuthor(m.author)
  if (m.subject) doc.setSubject(m.subject)
  doc.setLanguage(m.lang ?? 'ja-JP')
  doc.setCreator(CREATOR_TOOL)
  doc.setProducer(PRODUCER)
  if (Number.isFinite(m.created)) {
    const d = new Date(m.created)
    doc.setCreationDate(d)
    doc.setModificationDate(d)
  }
  if (plan) {
    await embedAttachments(doc, plan.files, m.created)
    addXmp(doc, m)
  }

  const text = await save7bit(doc, { updateFieldAppearances: false })
  return { text, pages: doc.getPageCount(), warnings: warn.list, fieldFontEmbedded: fieldFace !== null && !fieldSubset }
}

class PageWriter {
  /** @param {Build} b @param {any} page @param {number} index */
  constructor(b, page, index) {
    this.b = b
    this.page = page
    this.index = index
    /** @type {string[]} */
    this.out = []
    /** @type {LinkOp[]} */
    this.links = []
    /** @type {FieldOp[]} */
    this.fields = []
    /** 文字の塗り色を覚えて、同じ色を何度も書かない(q と Q の中で替えた色は外に出ない) */
    this.fill = ''
    /** 開いている印付きの中身: tag の番号・-1(飾り)・null(無し) @type {number | null} */
    this.open = null
    this.bad = false
    /** @type {Map<string, string>} */
    this.fontNames = new Map()
    /** @type {Map<any, string>} */
    this.imageNames = new Map()
    /** @type {Map<string, string>} */
    this.gsNames = new Map()
    /** Pattern・Shading・影の画像の資源名。名前は頁ごとの連番(pdf-lib の乱数の名前を使わず、混ざる順に依らない) */
    this.resCount = 0
    /** @type {Map<string, string>} */
    this.resNames = new Map()
    /** 新しい欄(blend・paint・影・opacity)を使った頁。Group を付ける */
    this.transparent = false
  }

  push(/** @type {string} */ s) { this.out.push(s) }

  n(/** @type {number} */ v) {
    if (!Number.isFinite(v)) { this.bad = true; return '0' }
    return num(v)
  }

  /** 色の字('#rrggbb')を「r g b」(0〜1)に。読めなければ null(警告は呼ぶ側) */
  rgbRaw(/** @type {unknown} */ c) {
    const cache = this.b.colors
    const key = String(c)
    let v = cache.get(key)
    if (v === undefined) {
      const m = typeof c === 'string' ? /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(c) : null
      if (m) {
        let h = m[1]
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
        const ch = (/** @type {number} */ k) => String(Math.round((parseInt(h.slice(k, k + 2), 16) / 255) * 10000) / 10000)
        v = `${ch(0)} ${ch(2)} ${ch(4)}`
      } else {
        v = null
      }
      cache.set(key, v)
    }
    return v
  }

  /** 色の字を「r g b」(0〜1)に。直せない色は黒 */
  rgbOf(/** @type {string | undefined} */ c) {
    const v = this.rgbRaw(c)
    if (v === null) { this.b.warn.add(`色 ${String(c)} を読めなかったので黒にした`); return '0 0 0' }
    return v
  }

  /** 色の字を [r, g, b](0〜1)に。読めなければ null */
  rgbArr(/** @type {unknown} */ c) {
    const v = this.rgbRaw(c)
    return v === null ? null : v.split(' ').map(Number)
  }

  /** @param {number | undefined} tag */
  tagKey(tag) {
    if (tag === undefined || tag === null) return -1
    if (Number.isInteger(tag) && tag >= 0 && tag < this.b.tags.length) return tag
    this.b.warn.add(`tag ${tag} が Layout.tags に無かったので飾りとして描いた`)
    return -1
  }

  /** 次の中身の印(BDC/BMC)を開く。同じ tag が続く間は 1 つの中身にまとめる(MCID を増やさない) */
  group(/** @type {number | undefined} */ tag) {
    const key = this.tagKey(tag)
    if (this.open === key) return
    this.closeGroup()
    if (key < 0) this.push('/Artifact BMC')
    else {
      const role = this.b.tags[key].role
      this.push(`/${/^[A-Za-z][A-Za-z0-9]*$/.test(role) ? role : 'Span'} <</MCID ${this.b.log.mark(this.index, key)}>> BDC`)
    }
    this.open = key
  }

  closeGroup() {
    if (this.open !== null) { this.push('EMC'); this.open = null }
  }

  fontName(/** @type {Face} */ face) {
    let name = this.fontNames.get(face.id)
    if (!name) {
      name = String(this.page.node.newFontDictionary(face.font.name, face.font.ref))
      this.fontNames.set(face.id, name)
    }
    return name
  }

  /**
   * ExtGState は (ca・CA, BM, SMask) の組ごとに 1 つ。頁の資源に 1 度だけ足して使い回す。無い項目は辞書に入れない(BM /Normal も入れない)。
   * 返すのは「/GS-1234 gs」の頭の名前(使う側が gs を付ける)。何も無ければ ''。
   * @param {number | null} o 不透明度 @param {string | null} bm PDF の /BM @param {{ np: any, maskRef: any, bc: number } | null} mask 輝度のソフトマスク
   * @param {boolean} [legacy] 今までの PathOp.opacity だけの使い方。Group の印を付けない
   */
  gsRef(o, bm, mask, legacy = false) {
    if (o === null && !bm && !mask) return ''
    if (!legacy) this.transparent = true
    const key = `${o === null ? '' : num(o)}|${bm ?? ''}|${mask ? mask.np.key : ''}`
    let name = this.gsNames.get(key)
    if (!name) {
      /** @type {Record<string, any>} */
      const dict = { Type: 'ExtGState' }
      if (o !== null) { dict.ca = o; dict.CA = o }
      if (bm) dict.BM = bm
      if (mask) dict.SMask = { Type: 'Mask', S: 'Luminosity', G: mask.maskRef, BC: [mask.bc] }
      name = String(this.page.node.newExtGState('GS', this.b.ctx.obj(dict)))
      this.gsNames.set(key, name)
    }
    return name
  }

  /** 頁の資源(Pattern・Shading など)に参照を足して、内容の流れで使う名前(/P1)を返す。同じ物は同じ名前 */
  resName(/** @type {string} */ kind, /** @type {string} */ prefix, /** @type {string} */ key, /** @type {any} */ ref) {
    const k = `${kind}:${key}`
    let name = this.resNames.get(k)
    if (!name) {
      const res = this.page.node.normalizedEntries().Resources
      let dict = res.lookupMaybe(PDFName.of(kind), PDFDict)
      if (!dict) { dict = this.b.ctx.obj({}); res.set(PDFName.of(kind), dict) }
      name = `/${prefix}${++this.resCount}`
      dict.set(PDFName.of(name.slice(1)), ref)
      this.resNames.set(k, name)
    }
    return name
  }

  /**
   * paint を PDF の物にする(文書で 1 回だけ作り、同じ paint は使い回す)。読めない paint は null で、warnings に 1 回書く。
   * 直線の両端が同じ点など単色になる paint は、物を作らず np だけを持つ。
   * @param {unknown} paint @param {string} what 戻す先の欄の名前(警告の文に使う)
   */
  paintOf(paint, what) {
    const cache = this.b.gfx.paints
    let key
    try { key = JSON.stringify(paint) } catch { key = undefined }
    if (key !== undefined && cache.has(key)) return cache.get(key)
    const np = key === undefined ? null : normalizePaint(paint, (c) => this.rgbArr(c))
    let ent = null
    if (np) ent = np.kind === 'solid' ? { np } : { np, ...buildPaint(this.b.ctx, np, this.b.W, this.b.H) }
    else this.b.warn.add(`paint を読めなかったので ${what} の色で塗った`)
    if (key !== undefined) cache.set(key, ent)
    return ent
  }

  /**
   * op の paint・opacity・blend から、gs と塗りの指定を決める。
   * 止まりの透明度がそろっている paint は、ソフトマスクにせず ca に掛ける(軽く、どのビューアーでも通る)。
   * @param {{ paint?: unknown, opacity?: unknown, blend?: unknown }} op @param {string} what @param {boolean} [legacy]
   * @returns {{ ent: any | null, solid: string | null, o: number | null, bm: string | null, mask: any | null, gs: string }}
   */
  effect(op, what, legacy = false) {
    const ent = op.paint === undefined || op.paint === null ? null : this.paintOf(op.paint, what)
    const np = ent ? ent.np : null
    let o = typeof op.opacity === 'number' && op.opacity >= 0 && op.opacity < 1 ? op.opacity : null
    if (np && np.alpha === 'uniform') o = (o ?? 1) * np.uniform
    let bm = null
    if (op.blend !== undefined && op.blend !== null) {
      const v = blendOf(op.blend)
      if (v === undefined) this.b.warn.add(`blend「${String(op.blend).slice(0, 24)}」は未対応なので normal で描いた`)
      else bm = v
    }
    const mask = np && np.alpha === 'varying' ? ent : null
    const gs = this.gsRef(o, bm, mask, legacy && !np && !bm)
    return {
      ent: np && np.kind !== 'solid' ? ent : null,
      solid: np && np.kind === 'solid' ? np.rgb.join(' ') : null,
      o, bm, mask, gs,
    }
  }

  /** @param {Op[]} ops */
  drawOps(ops) {
    for (const op of ops) {
      switch (op.t) {
        case 'text': this.text(op); break
        case 'rule': this.rule(op); break
        case 'rect': this.rect(op); break
        case 'path': this.path(op); break
        case 'image': this.image(op); break
        case 'clip': this.clip(op); break
        case 'field': this.fields.push(op); break
        case 'link': this.links.push(op); break
        default: this.b.warn.add(`未対応の Op ${/** @type {any} */ (op)?.t} を捨てた`)
      }
    }
  }

  text(/** @type {TextOp} */ op) {
    const face = this.b.faces.get(op.font)
    if (!face) { this.b.warn.add(`TextOp の書体 ${op.font} を埋め込んでいない`); return }
    const size = op.size
    if (!(size > 0) || !Array.isArray(op.glyphs)) return
    // ルビ（RT）は親字の半分の大きさが組版の決まり。毎回「7pt 未満」と警告して、本物の小さい字の警告を埋もれさせない
    const isRuby = op.tag !== undefined && this.b.tags[op.tag]?.role === 'RT'
    if (!isRuby && size < this.b.minSize) this.b.minSize = size
    let first = true
    let x0 = 0
    let cursor = 0
    let hex = ''
    let arr = ''
    for (const g of op.glyphs) {
      const e = face.glyph(g.c)
      if (!e) continue
      if (first) { x0 = g.x; cursor = g.x; first = false } else {
        // 字ごとの x に合わせる調整(千分の 1 em・PDF では正が左へ詰める)。丸めた分も cursor に入れて誤差をためない
        const adj = Math.round(-((g.x - cursor) * 1000) / size * 1000) / 1000
        if (adj !== 0) { arr += `<${hex}>${this.n(adj)}`; hex = ''; cursor -= (adj * size) / 1000 }
      }
      hex += e.hex
      cursor += e.adv * size
    }
    if (first) return
    arr += `<${hex}>`
    this.group(op.tag)
    const eff = this.effect(op, 'color')
    const show = `${this.fontName(face)} ${this.n(size)} Tf\n`
    const tm = `1 0 0 1 ${this.n(x0)} ${this.n(this.b.H - op.y)} Tm\n[${arr}] TJ`
    if (eff.ent) {
      // 字のグラデーション: 字の形で切り抜き(Tr 7)、その中を Shading で塗る。色は rg でなく切り抜きの中から来るので this.fill には触らない
      if (typeof op.actual === 'string') this.push(`/Span <</ActualText ${PDFHexString.fromText(op.actual).toString()} >> BDC`)
      this.push(`q\n${eff.gs ? `${eff.gs} gs\n` : ''}BT\n${show}7 Tr\n${tm}\nET\n${this.resName('Shading', 'Sh', eff.ent.np.key, eff.ent.shRef)} sh\nQ`)
      if (typeof op.actual === 'string') this.push('EMC')
      return
    }
    const color = eff.solid ?? this.rgbOf(op.color)
    // rg は q の外に置く。q の中で変えると Q で戻り、this.fill の記憶が実際の状態とずれる
    if (color !== this.fill) { this.push(`${color} rg`); this.fill = color }
    if (typeof op.actual === 'string') this.push(`/Span <</ActualText ${PDFHexString.fromText(op.actual).toString()} >> BDC`)
    this.push(eff.gs ? `q\n${eff.gs} gs\nBT\n${show}${tm}\nET\nQ` : `BT\n${show}${tm}\nET`)
    if (typeof op.actual === 'string') this.push('EMC')
  }

  /** 線・四角・図形は q と Q で包む(線の太さ・破線・不透明度が次に漏れない) */
  rule(/** @type {RuleOp} */ op) {
    this.group(op.tag)
    const H = this.b.H
    this.push(`q\n${this.rgbOf(op.color)} RG\n${this.n(op.w)} w${this.dash(op.dash)}\n${this.n(op.x1)} ${this.n(H - op.y1)} m ${this.n(op.x2)} ${this.n(H - op.y2)} l S\nQ`)
  }

  /**
   * 塗りと線の 1 つの図形を q … Q で出す(fill と stroke は 1 つの命令 B にまとめる)。
   * 止まりの透明度が違うグラデーション(ソフトマスク)は線にも掛かってしまうので、その時だけ塗りと線を別の q に分ける。
   * @param {ReturnType<PageWriter['effect']>} eff
   * @param {{ d: string, sep: string, fillRgb: string | null, hasFill: boolean, stroke: string, hasStroke: boolean, star: string }} o
   *   d は道筋(m l c h か re)・sep は道筋と塗りの命令の間(re は ' '・path は改行)・stroke は「\nRG\nw …」(線が無ければ '')
   */
  shape(eff, o) {
    const fillSet = eff.ent ? `/Pattern cs\n${this.resName('Pattern', 'P', eff.ent.np.key, eff.ent.patRef)} scn` : `${o.fillRgb} rg`
    if (eff.mask && o.hasFill && o.hasStroke) {
      this.push(`q\n${eff.gs} gs\n${fillSet}\n${o.d}${o.sep}f${o.star}\nQ`)
      const gs2 = this.gsRef(eff.o, eff.bm, null)
      this.push(`q${gs2 ? `\n${gs2} gs` : ''}${o.stroke}\n${o.d}${o.sep}S\nQ`)
      return
    }
    let s = 'q'
    if (eff.gs) s += `\n${eff.gs} gs`
    if (o.hasFill) s += `\n${fillSet}`
    s += o.stroke
    s += `\n${o.d}${o.sep}${o.hasFill && o.hasStroke ? 'B' : o.hasFill ? 'f' : 'S'}${o.hasFill ? o.star : ''}\nQ`
    this.push(s)
  }

  rect(/** @type {RectOp} */ op) {
    const eff = this.effect(op, 'fill')
    const hasFill = !!(op.fill || eff.ent || eff.solid)
    if (!hasFill && !op.stroke) return
    const H = this.b.H
    const rr = radiusOf(op)
    const fillRgb = hasFill ? (eff.solid ?? (op.fill ? this.rgbOf(op.fill) : null)) : null
    if (op.shadow !== undefined && op.shadow !== null) this.shadow(op, rr)
    this.group(op.tag)
    const d = rr > 0 ? roundedRectPath(op.x, op.y, op.w, op.h, rr, H, (v) => this.n(v)) : `${this.n(op.x)} ${this.n(H - (op.y + op.h))} ${this.n(op.w)} ${this.n(op.h)} re`
    const stroke = op.stroke ? `\n${this.rgbOf(op.stroke)} RG\n${this.n(op.lw ?? 1)} w` : ''
    this.shape(eff, { d, sep: rr > 0 ? '\n' : ' ', fillRgb, hasFill, stroke, hasStroke: !!op.stroke, star: '' })
  }

  /**
   * 角丸の四角の影。画素は文書で 1 つだけ作って使い回す(同じ大きさ・角丸・ぼかし・色のカードが何枚あっても 1 回)。
   * 影は飾りなので Artifact に入れ(読み上げに画像として出さない)、四角の本体より先に描く。
   * 不透明度は画像の α でなく gs の ca で掛ける。blend は影に掛けない(本体だけ)。
   */
  shadow(/** @type {RectOp} */ op, /** @type {number} */ rr) {
    const sh = op.shadow
    const b = this.b
    if (!sh || typeof sh !== 'object') { b.warn.add('shadow を読めなかったので影なしで描いた'); return }
    const dx = sh.dx ?? 0
    const dy = sh.dy ?? 0
    const blur = sh.blur ?? 0
    const opacity = sh.opacity ?? 1
    const rgbv = this.rgbArr(sh.color)
    const { x, y, w, h } = op
    if (![dx, dy, blur, opacity, x, y, w, h].every(Number.isFinite) || !rgbv || blur < 0 || !(opacity > 0) || !(w > 0) || !(h > 0)) {
      b.warn.add('shadow の値(dx・dy・blur・color・opacity)か四角の大きさを読めなかったので影なしで描いた')
      return
    }
    if (w > SHADOW_SIDE_MAX || h > SHADOW_SIDE_MAX) { b.warn.add(`影を付ける四角が大きすぎる(${Math.round(w)}×${Math.round(h)}pt)ので影なしで描いた`); return }
    const key = [w, h, rr, blur].map((v) => Math.round(v * 1000) / 1000).join('|') + '|' + rgbv.join(',')
    let ent = b.gfx.shadows.get(key)
    if (!ent) {
      const ras = shadowRaster(w, h, rr, blur)
      if (b.gfx.shadowPx + ras.iw * ras.ih > SHADOW_PX_TOTAL) { b.warn.add('影が多すぎる(画素の合計が上限)ので、残りの影は描かなかった'); return }
      b.gfx.shadowPx += ras.iw * ras.ih
      ent = { ref: shadowImage(b.ctx, ras, rgbv), wpt: ras.wpt, hpt: ras.hpt }
      b.gfx.shadows.set(key, ent)
    }
    const name = this.resName('XObject', 'Sd', key, ent.ref)
    const gs = this.gsRef(opacity < 1 ? opacity : null, null, null)
    this.transparent = true
    const left = x + w / 2 + dx - ent.wpt / 2
    const top = y + h / 2 + dy - ent.hpt / 2
    this.group(undefined)
    this.push(`q\n${gs ? `${gs} gs\n` : ''}${this.n(ent.wpt)} 0 0 ${this.n(ent.hpt)} ${this.n(left)} ${this.n(b.H - (top + ent.hpt))} cm\n${name} Do\nQ`)
  }

  path(/** @type {PathOp} */ op) {
    const eff = this.effect(op, 'fill', true)
    const hasFill = !!(op.fill || eff.ent || eff.solid)
    if (!hasFill && !op.stroke) return
    const d = pathOps(op.d, this.b.H, (v) => this.n(v))
    if (!d) { this.b.warn.add(`path の d を読めなかったので描かなかった: ${String(op.d).slice(0, 40)}`); return }
    this.group(op.tag)
    const fillRgb = hasFill ? (eff.solid ?? (op.fill ? this.rgbOf(op.fill) : null)) : null
    let stroke = ''
    if (op.stroke) {
      stroke += `\n${this.rgbOf(op.stroke)} RG\n${this.n(op.lw ?? 1)} w`
      const cap = { butt: 0, round: 1, square: 2 }[op.cap ?? 'butt']
      const join = { miter: 0, round: 1, bevel: 2 }[op.join ?? 'miter']
      if (cap) stroke += `\n${cap} J`
      if (join) stroke += `\n${join} j`
      stroke += this.dash(op.dash)
    }
    this.shape(eff, { d, sep: '\n', fillRgb, hasFill, stroke, hasStroke: !!op.stroke, star: op.fillRule === 'evenodd' ? '*' : '' })
  }

  /** 1 周期が 0.5pt に満たない破線は実線にする。細かすぎる破線は閲覧ソフトが 1 本の線を数万の断片にして描くため、開くのが止まる */
  dash(/** @type {number[] | undefined} */ dash) {
    if (!Array.isArray(dash) || !dash.length || dash.length > DASH_MAX_ITEMS || !dash.every((v) => Number.isFinite(v) && v >= 0) || !dash.some((v) => v > 0)) return ''
    if (dash.reduce((a, v) => a + v, 0) < DASH_MIN_PERIOD) return ''
    return `\n[${dash.map((v) => this.n(v)).join(' ')}] 0 d`
  }

  image(/** @type {ImageOp} */ op) {
    const img = this.b.images.get(op.kind + ':' + op.base64)
    if (!img) return
    let name = this.imageNames.get(img)
    if (!name) { name = String(this.page.node.newXObject('Im', img.ref)); this.imageNames.set(img, name) }
    this.group(op.tag)
    const gs = this.effect(op, 'fill').gs
    this.push(`q\n${gs ? `${gs} gs\n` : ''}${this.n(op.w)} 0 0 ${this.n(op.h)} ${this.n(op.x)} ${this.n(this.b.H - (op.y + op.h))} cm\n${name} Do\nQ`)
  }

  /** 中の ops を四角で切る。印付きの中身は q の外で閉じてから入る(BDC と q が交差しないように) */
  clip(/** @type {ClipOp} */ op) {
    if (!Array.isArray(op.ops)) return
    this.closeGroup()
    const saved = this.fill
    // d(M・L・C・Z)があればその形で切る。読めなければ外接の四角で切って warnings に書く
    let shape = null
    if (op.d !== undefined && op.d !== null) {
      shape = pathOps(op.d, this.b.H, (v) => this.n(v))
      if (!shape) this.b.warn.add(`clip の d を読めなかったので四角で切った: ${String(op.d).slice(0, 40)}`)
    }
    this.push(`q\n${shape ?? `${this.n(op.x)} ${this.n(this.b.H - (op.y + op.h))} ${this.n(op.w)} ${this.n(op.h)} re`} W n`)
    this.drawOps(op.ops)
    this.closeGroup()
    this.push('Q')
    this.fill = saved
  }
}

/** 角丸の半径。w か h が 0 以下・半径が正の数でないなら 0。min(w, h)/2 を超えない */
function radiusOf(/** @type {RectOp} */ op) {
  const r = op.r
  if (typeof r !== 'number' || !(r > 0) || !(op.w > 0) || !(op.h > 0)) return 0
  return Math.min(r, op.w / 2, op.h / 2)
}

const PATH_ARGS = /** @type {Record<string, number>} */ ({ M: 2, L: 2, C: 6, Z: 0 })

/** 絶対座標の M L C Z だけの d を m l c h に。読めなければ null */
function pathOps(/** @type {string} */ d, /** @type {number} */ H, /** @type {(v: number) => string} */ n) {
  const t = String(d).match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!t) return null
  /** @type {string[]} */
  const out = []
  let cmd = ''
  let moved = false
  let i = 0
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) {
      cmd = t[i++]
      if (!(cmd in PATH_ARGS)) return null
      if (cmd === 'Z') { out.push('h'); continue }
    } else if (cmd === '' || cmd === 'Z') return null
    if (cmd !== 'M' && !moved) return null // 現在点が無い(最初が M でない)
    const k = PATH_ARGS[cmd]
    if (i + k > t.length) return null
    const v = t.slice(i, i + k).map(Number)
    if (v.some((x) => !Number.isFinite(x))) return null
    i += k
    if (cmd === 'M') { out.push(`${n(v[0])} ${n(H - v[1])} m`); cmd = 'L'; moved = true } // M の後に続く座標の組は線
    else if (cmd === 'L') out.push(`${n(v[0])} ${n(H - v[1])} l`)
    else out.push(`${n(v[0])} ${n(H - v[1])} ${n(v[2])} ${n(H - v[3])} ${n(v[4])} ${n(H - v[5])} c`)
  }
  return out.length ? out.join('\n') : null
}

/**
 * リンク注釈。URL は https・http・mailto だけ。7 ビットに収めるため ASCII の外の字は %XX にする。
 * URI は 16 進の文字列で書く。pdf-lib の PDFString.of は ( ) \ を逃がさないので、"https://a/x)/S/JavaScript/JS(…)/Z(" の
 * ような URL が文字列を抜けて、同じ辞書に JavaScript の動作を足せてしまう(試験で確かめた)。16 進なら URL の字は 1 つも解釈されない。
 * 選ばなかった案: ( ) \ を %28 %29 %5C にする案。URL の中身が変わり、括弧を含む実在の URL(Wikipedia など)が別の物を指しうる。
 */
function addLink(/** @type {Build} */ b, /** @type {any} */ page, /** @type {LinkOp} */ l) {
  const raw = typeof l.url === 'string' ? l.url.trim() : ''
  if (!/^(https?:\/\/|mailto:)/i.test(raw)) { b.warn.add(`リンクの URL は https・http・mailto だけ。捨てた: ${raw.slice(0, 40)}`); return }
  if (raw.length > URL_MAX * 3) { b.warn.add(`リンクの URL が長すぎるので捨てた(${raw.length} 字): ${raw.slice(0, 40)}`); return }
  let url
  try { url = raw.replace(/[^\x21-\x7e]/gu, (ch) => encodeURIComponent(ch)) } catch { b.warn.add(`リンクの URL を直せなかったので捨てた: ${raw.slice(0, 40)}`); return }
  if (url.length > URL_MAX) { b.warn.add(`リンクの URL が長すぎるので捨てた(${url.length} 字): ${raw.slice(0, 40)}`); return }
  const x = Number(l.x), w = Number(l.w), h = Number(l.h), top = Number(l.y)
  if (![x, w, h, top].every(Number.isFinite)) { b.warn.add(`リンクの位置が数でないので捨てた: ${raw.slice(0, 40)}`); return }
  const y = b.H - (top + h)
  const hex = Array.from(url, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  const ref = b.ctx.register(b.ctx.obj({
    Type: 'Annot', Subtype: 'Link', F: 4, Border: [0, 0, 0],
    Rect: [num(x), num(y), num(x + w), num(y + h)].map(Number),
    A: { Type: 'Action', S: 'URI', URI: PDFHexString.of(hex) },
  }))
  page.node.addAnnot(ref)
}

const NO_HEAD = new Set([...'、。，．・：；？！ー）〕］｝〉》」』】々ゝゞぁぃぅぇぉっゃゅょァィゥェォッャュョ)]},.:;!?'])

/** 欄の初めの見た目用の折り返し(字の幅 maxWidth まで)。ASCII の語は割らず、行頭禁則の字は前の行にぶら下げる */
function wrapForField(/** @type {string} */ text, /** @type {(t: string) => number} */ measure, /** @type {number} */ maxWidth) {
  /** @type {string[]} */
  const lines = []
  for (const para of text.split(/\r\n?|\n/)) {
    let line = ''
    let w = 0
    for (const tok of para.match(/[\x21-\x7e]+| +|[\s\S]/gu) ?? []) {
      const tw = measure(tok)
      const blank = tok[0] === ' '
      if (line === '' && blank) continue
      if (line !== '' && w + tw > maxWidth && !blank) {
        if (tok.length === 1 && NO_HEAD.has(tok)) { line += tok; w += tw; continue }
        lines.push(line.trimEnd())
        line = ''
        w = 0
      }
      if (tw > maxWidth && !blank) {
        for (const ch of tok) {
          const cw = measure(ch)
          if (line !== '' && w + cw > maxWidth) { lines.push(line); line = ''; w = 0 }
          line += ch
          w += cw
        }
        continue
      }
      line += tok
      w += tw
    }
    lines.push(line.trimEnd())
  }
  return lines.join('\n')
}

/** 記入欄 1 つ。日本語の値の見た目は pdf-lib が欄の書体で作る(addToPage に書体を渡す) */
function addField(/** @type {Build} */ b, /** @type {number} */ pi, /** @type {any} */ page, /** @type {FieldOp} */ op) {
  const name = typeof op.name === 'string' ? op.name : ''
  if (!name) { b.warn.add('名前の無い記入欄は作らなかった'); return }
  try {
    const form = b.form ?? (b.form = b.doc.getForm())
    const face = b.fieldFace
    // 1e300 や 1e-7 が DA の「… Tf」にそのまま入ると、閲覧ソフトが欄を描けない。欄の字は 4〜72pt に収める
    const size = Number.isFinite(op.size) && /** @type {number} */ (op.size) > 0 ? Math.round(Math.min(72, Math.max(4, /** @type {number} */ (op.size))) * 100) / 100 : FIELD_PT
    const appearance = {
      x: op.x, y: b.H - (op.y + op.h),
      width: Math.max(op.w - FIELD_BORDER, 1), height: Math.max(op.h - FIELD_BORDER, 1),
      borderWidth: FIELD_BORDER, borderColor: rgb(0.4, 0.4, 0.4), backgroundColor: rgb(1, 1, 1), textColor: rgb(0.067, 0.067, 0.067),
    }
    const withFont = () => {
      if (!face) throw new Error('記入欄の書体が無い')
      return { ...appearance, font: face.font }
    }
    const checkText = (/** @type {string} */ s) => {
      for (const ch of s) if (face && ch !== '\n' && !isSkippable(ch.codePointAt(0) ?? 0) && !face.has(ch.codePointAt(0) ?? 0)) b.warn.add(`記入欄「${name}」の値に書体に無い字がある: 「${ch}」`)
    }
    /** @type {any} */
    let field
    if (op.kind === 'text' || op.kind === 'multiline') {
      field = form.createTextField(name)
      if (!face) throw new Error('記入欄の書体が無い')
      // 字の大きさは DA の Tf から読まれる。pdf-lib はそのまま使う(0 なら欄に合わせて自動)
      field.acroField.setDefaultAppearance(`/${face.font.name} ${size} Tf 0 g`)
      if (op.kind === 'multiline') field.enableMultiline()
      const value = typeof op.value === 'string' ? op.value : ''
      if (value) {
        const v = op.kind === 'multiline' ? value : value.replace(/[\r\n]+/g, ' ')
        checkText(v)
        // 複数行は初めの見た目だけ折り返して作り、値(V)は元の字に戻す。pdf-lib は空白でしか折らず、日本語が 1 行からはみ出して切れる
        field.setText(op.kind === 'multiline' ? wrapForField(v, (t) => face.font.widthOfTextAtSize(t, size), appearance.width - 3.5) : v)
      }
      field.addToPage(page, withFont())
      if (value && op.kind === 'multiline') field.acroField.setValue(PDFHexString.fromText(value))
    } else if (op.kind === 'check') {
      field = form.createCheckBox(name)
      field.addToPage(page, appearance)
      // addToPage の前に check() すると /V だけ on で /AS が Off のままになる(保存の後に未チェックに見える)
      if (op.value === true) field.check()
    } else if (op.kind === 'choice') {
      field = form.createDropdown(name)
      if (!face) throw new Error('記入欄の書体が無い')
      const options = (Array.isArray(op.options) ? op.options : []).map(String)
      const value = typeof op.value === 'string' && op.value ? op.value : ''
      if (value && !options.includes(value)) { options.push(value); b.warn.add(`選び欄「${name}」の値「${value}」が選択肢に無いので足した`) }
      for (const o of options) checkText(o)
      if (options.length) field.addOptions([...options])
      if (value) field.select(value)
      field.acroField.setDefaultAppearance(`/${face.font.name} ${size} Tf 0 g`)
      field.addToPage(page, withFont())
    } else {
      b.warn.add(`記入欄「${name}」の種類 ${op.kind} は未対応`)
      return
    }
    const key = op.tag
    if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < b.tags.length) {
      const widgets = field.acroField.getWidgets()
      const wd = widgets[widgets.length - 1]
      b.log.widget(pi, key, wd.dict, b.ctx.getObjectRef(wd.dict))
    }
  } catch (e) {
    b.warn.add(`記入欄「${name}」を作れなかった: ${errText(e)}`)
  }
}

/**
 * しおり。level で入れ子にする(vendor の outline は平ら)。Count は開いた状態の子孫の数。
 * @param {any} doc @param {Layout['outline']} items @param {any[]} pageRefs
 */
function addOutline(doc, items, pageRefs, /** @type {number} */ H, /** @type {{ add: (m: string) => void }} */ warn) {
  const ctx = doc.context
  /** @type {{ title: string, level: number, page: number, y: number, ref: any, kids: any[] }[]} */
  const nodes = []
  for (const it of items) {
    if (!it || typeof it.title !== 'string' || !it.title || !Number.isInteger(it.page) || it.page < 0 || it.page >= pageRefs.length) {
      warn.add('しおりの項目を読めなかったので捨てた')
      continue
    }
    nodes.push({ title: it.title, level: Number.isInteger(it.level) && it.level > 0 ? it.level : 1, page: it.page, y: Number.isFinite(it.y) ? H - it.y : H, ref: ctx.nextRef(), kids: [] })
  }
  if (!nodes.length) return
  const rootRef = ctx.nextRef()
  /** @type {typeof nodes} */
  const roots = []
  /** @type {typeof nodes} */
  const stack = []
  /** @type {Map<any, any>} */
  const parentOf = new Map()
  for (const nd of nodes) {
    while (stack.length && stack[stack.length - 1].level >= nd.level) stack.pop()
    const p = stack[stack.length - 1]
    if (p) { p.kids.push(nd); parentOf.set(nd, p) } else roots.push(nd)
    stack.push(nd)
  }
  /** @type {(nd: any) => number} */
  const descendants = (nd) => nd.kids.reduce((/** @type {number} */ s, /** @type {any} */ k) => s + 1 + descendants(k), 0)
  const write = (/** @type {typeof nodes} */ list, /** @type {any} */ parentRef) => {
    list.forEach((nd, i) => {
      const dict = ctx.obj({ Title: PDFHexString.fromText(nd.title), Parent: parentRef, Dest: [pageRefs[nd.page], 'XYZ', null, nd.y, null] })
      if (i) dict.set(PDFName.of('Prev'), list[i - 1].ref)
      if (i < list.length - 1) dict.set(PDFName.of('Next'), list[i + 1].ref)
      if (nd.kids.length) {
        dict.set(PDFName.of('First'), nd.kids[0].ref)
        dict.set(PDFName.of('Last'), nd.kids[nd.kids.length - 1].ref)
        dict.set(PDFName.of('Count'), PDFNumber.of(descendants(nd)))
      }
      ctx.assign(nd.ref, dict)
      write(nd.kids, nd.ref)
    })
  }
  write(roots, rootRef)
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: roots[0].ref, Last: roots[roots.length - 1].ref, Count: nodes.length }))
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}
