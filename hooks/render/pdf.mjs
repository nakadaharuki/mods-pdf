// @ts-check
// render/pdf: Display List(左上が原点・y は下向き・単位 pt)を、pdf-lib で 7 ビットの PDF にする。
// 内容の流れは演算子の物(PDFOperator)を作らず、字の列で組んで 1 頁 1 本の流れにする。
// 10 頁 40 行で演算子の物が数万個できるのを避けるためと、出力をそのまま読んで試験できるため。
import { PDFDocument, PDFName, PDFHexString, PDFString, PDFNumber, fontkit, save7bit, b64ToBytes, rgb } from '../vendor/pdf.mjs'
import { TagLog, buildStructTree } from './tags.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ role: string, parent: number|null, alt?: string, lang?: string }} Tag */
/** @typedef {{ t: 'text', font: FontId, size: number, color: string, y: number, glyphs: { c: string, x: number }[], tag?: number, actual?: string }} TextOp */
/** @typedef {{ t: 'rule', x1: number, y1: number, x2: number, y2: number, w: number, color: string, dash?: number[], tag?: number }} RuleOp */
/** @typedef {{ t: 'rect', x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number, tag?: number }} RectOp */
/** @typedef {{ t: 'path', d: string, fill?: string, stroke?: string, lw?: number, opacity?: number, fillRule?: 'nonzero'|'evenodd', cap?: 'butt'|'round'|'square', join?: 'miter'|'round'|'bevel', dash?: number[], tag?: number }} PathOp */
/** @typedef {{ t: 'clip', x: number, y: number, w: number, h: number, ops: Op[] }} ClipOp */
/** @typedef {{ t: 'image', x: number, y: number, w: number, h: number, kind: 'png'|'jpg', base64: string, tag?: number }} ImageOp */
/** @typedef {{ t: 'field', kind: 'text'|'multiline'|'check'|'choice', name: string, x: number, y: number, w: number, h: number, value?: string|boolean, options?: string[], size?: number, tag?: number }} FieldOp */
/** @typedef {{ t: 'link', x: number, y: number, w: number, h: number, url: string }} LinkOp */
/** @typedef {TextOp|RuleOp|RectOp|PathOp|ClipOp|ImageOp|FieldOp|LinkOp} Op */
/** @typedef {{ meta: { title: string, author?: string, subject?: string, lang: string, created: number }, page: { width: number, height: number }, pages: { ops: Op[] }[], tags: Tag[], outline: { title: string, level: number, page: number, y: number }[], fonts: FontId[] }} Layout */

const LIMIT = 4 * 1024 * 1024
// 1 字ずつ encodeText するので合字は出ないが、記入欄の値(複数字)で fi などが 1 つの字形になって位置がずれるのを防ぐ
const NO_LIGATURE = { liga: false, clig: false, dlig: false, calt: false, rlig: false }
const FIELD_PT = 10
const FIELD_BORDER = 0.5

/** 小数 3 桁(0.0005pt)より細かい差は要らない。-0 と指数表記(1e-7)を出さない */
const num = (/** @type {number} */ v) => {
  const r = Math.round(v * 1000) / 1000
  return String(r === 0 ? 0 : r)
}

/** 描かない字(制御字・幅ゼロの印)。位置は次の字の TJ の調整で保たれる */
const isSkippable = (/** @type {number} */ cp) =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff

const errText = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e))

/**
 * @param {Layout} layout
 * @param {{ fontBytes: Record<string, Uint8Array>, fieldFont?: FontId }} opts
 * @returns {Promise<{ text: string, pages: number, bytes: number, warnings: string[] }>}
 */
export async function renderPdf(layout, { fontBytes, fieldFont = 'sans' }) {
  let r = await build(layout, fontBytes, fieldFont, false)
  /** @type {string[]} */
  const extra = []
  // 丸ごと入れた記入欄の書体で 4 MiB を超えたら、その書体も使う字だけに絞って作り直す(書体 1 つだけ軽くなる)
  if (r.text.length >= LIMIT && r.fieldFontEmbedded) {
    r = await build(layout, fontBytes, fieldFont, true)
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

/** @param {Op[]} ops @param {{ fonts: Set<string>, images: Map<string, ImageOp>, fieldKinds: Set<string> }} acc */
function scan(ops, acc) {
  for (const op of ops) {
    if (op.t === 'text') acc.fonts.add(op.font)
    else if (op.t === 'image') acc.images.set(op.kind + ':' + op.base64, op)
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

/** @typedef {{ doc: any, ctx: any, W: number, H: number, faces: Map<string, Face>, images: Map<string, any>, tags: Tag[], log: TagLog, warn: { add: (m: string) => void }, colors: Map<string, string | null>, fieldFace: Face | null, form: any, minSize: number }} Build */

/**
 * @param {Layout} layout
 * @param {Record<string, Uint8Array>} fontBytes
 * @param {string} fieldFontId
 * @param {boolean} fieldSubset
 */
async function build(layout, fontBytes, fieldFontId, fieldSubset) {
  if (!layout || !layout.page || !Array.isArray(layout.pages) || layout.pages.length === 0) throw new Error('renderPdf: Layout に頁が無い')
  const W = layout.page.width
  const H = layout.page.height
  if (!(W > 0 && H > 0)) throw new Error('renderPdf: 頁の大きさが正しくない')
  const warn = makeWarn()
  const tags = Array.isArray(layout.tags) && layout.tags.length ? layout.tags : [{ role: 'Document', parent: null }]

  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  const ctx = doc.context

  const acc = { fonts: new Set(layout.fonts ?? []), images: new Map(), fieldKinds: new Set() }
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
    faces.set(id, makeFace(await doc.embedFont(bytes, { subset: true, features: NO_LIGATURE }), id, missing))
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
    fieldFace = makeFace(await doc.embedFont(fontBytes[fid], { subset: fieldSubset, features: NO_LIGATURE }), 'field:' + fid, missing)
  }

  /** @type {Map<string, any>} */
  const images = new Map()
  for (const [key, op] of acc.images) {
    try {
      const bytes = b64ToBytes(String(op.base64).replace(/^data:[^,]*,/, ''))
      images.set(key, op.kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes))
    } catch (e) {
      warn.add(`画像を読めなかったので描かなかった: ${errText(e)}`)
    }
  }

  /** @type {Build} */
  const b = { doc, ctx, W, H, faces, images, tags, log: new TagLog(), warn, colors: new Map(), fieldFace, form: null, minSize: Infinity }

  const pageRefs = []
  for (let pi = 0; pi < layout.pages.length; pi++) {
    const page = doc.addPage([W, H])
    pageRefs.push(page.ref)
    const w = new PageWriter(b, page, pi)
    w.drawOps(layout.pages[pi].ops ?? [])
    w.closeGroup()
    page.node.addContentStream(ctx.register(ctx.flateStream(w.out.join('\n'))))
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'))
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
  doc.setCreator('ModsPDF')
  doc.setProducer('ModsPDF (pdf-lib 1.17.1)')
  if (Number.isFinite(m.created)) {
    const d = new Date(m.created)
    doc.setCreationDate(d)
    doc.setModificationDate(d)
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
  }

  push(/** @type {string} */ s) { this.out.push(s) }

  n(/** @type {number} */ v) {
    if (!Number.isFinite(v)) { this.bad = true; return '0' }
    return num(v)
  }

  /** 色の字('#rrggbb')を「r g b」(0〜1)に。直せない色は黒 */
  rgbOf(/** @type {string | undefined} */ c) {
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
    if (v === null) { this.b.warn.add(`色 ${key} を読めなかったので黒にした`); return '0 0 0' }
    return v
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

  /** 不透明度は ExtGState(ca と CA)。頁の資源に 1 度だけ足す */
  gsName(/** @type {number} */ o) {
    const key = num(o)
    let name = this.gsNames.get(key)
    if (!name) {
      name = String(this.page.node.newExtGState('GS', this.b.ctx.obj({ Type: 'ExtGState', ca: o, CA: o })))
      this.gsNames.set(key, name)
    }
    return name
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
    const color = this.rgbOf(op.color)
    if (color !== this.fill) { this.push(`${color} rg`); this.fill = color }
    if (typeof op.actual === 'string') this.push(`/Span <</ActualText ${PDFHexString.fromText(op.actual).toString()} >> BDC`)
    this.push(`BT\n${this.fontName(face)} ${this.n(size)} Tf\n1 0 0 1 ${this.n(x0)} ${this.n(this.b.H - op.y)} Tm\n[${arr}] TJ\nET`)
    if (typeof op.actual === 'string') this.push('EMC')
  }

  /** 線・四角・図形は q と Q で包む(線の太さ・破線・不透明度が次に漏れない) */
  rule(/** @type {RuleOp} */ op) {
    this.group(op.tag)
    const H = this.b.H
    this.push(`q\n${this.rgbOf(op.color)} RG\n${this.n(op.w)} w${this.dash(op.dash)}\n${this.n(op.x1)} ${this.n(H - op.y1)} m ${this.n(op.x2)} ${this.n(H - op.y2)} l S\nQ`)
  }

  rect(/** @type {RectOp} */ op) {
    if (!op.fill && !op.stroke) return
    this.group(op.tag)
    let s = 'q'
    if (op.fill) s += `\n${this.rgbOf(op.fill)} rg`
    if (op.stroke) s += `\n${this.rgbOf(op.stroke)} RG\n${this.n(op.lw ?? 1)} w`
    s += `\n${this.n(op.x)} ${this.n(this.b.H - (op.y + op.h))} ${this.n(op.w)} ${this.n(op.h)} re ${op.fill && op.stroke ? 'B' : op.fill ? 'f' : 'S'}\nQ`
    this.push(s)
  }

  path(/** @type {PathOp} */ op) {
    if (!op.fill && !op.stroke) return
    const d = pathOps(op.d, this.b.H, (v) => this.n(v))
    if (!d) { this.b.warn.add(`path の d を読めなかったので描かなかった: ${String(op.d).slice(0, 40)}`); return }
    this.group(op.tag)
    const star = op.fillRule === 'evenodd' ? '*' : ''
    let s = 'q'
    if (typeof op.opacity === 'number' && op.opacity >= 0 && op.opacity < 1) s += `\n${this.gsName(op.opacity)} gs`
    if (op.fill) s += `\n${this.rgbOf(op.fill)} rg`
    if (op.stroke) {
      s += `\n${this.rgbOf(op.stroke)} RG\n${this.n(op.lw ?? 1)} w`
      const cap = { butt: 0, round: 1, square: 2 }[op.cap ?? 'butt']
      const join = { miter: 0, round: 1, bevel: 2 }[op.join ?? 'miter']
      if (cap) s += `\n${cap} J`
      if (join) s += `\n${join} j`
      s += this.dash(op.dash)
    }
    s += `\n${d}\n${op.fill && op.stroke ? 'B' : op.fill ? 'f' : 'S'}${op.fill ? star : ''}\nQ`
    this.push(s)
  }

  dash(/** @type {number[] | undefined} */ dash) {
    if (!Array.isArray(dash) || !dash.length || !dash.every((v) => Number.isFinite(v) && v >= 0) || !dash.some((v) => v > 0)) return ''
    return `\n[${dash.map((v) => this.n(v)).join(' ')}] 0 d`
  }

  image(/** @type {ImageOp} */ op) {
    const img = this.b.images.get(op.kind + ':' + op.base64)
    if (!img) return
    let name = this.imageNames.get(img)
    if (!name) { name = String(this.page.node.newXObject('Im', img.ref)); this.imageNames.set(img, name) }
    this.group(op.tag)
    this.push(`q\n${this.n(op.w)} 0 0 ${this.n(op.h)} ${this.n(op.x)} ${this.n(this.b.H - (op.y + op.h))} cm\n${name} Do\nQ`)
  }

  /** 中の ops を四角で切る。印付きの中身は q の外で閉じてから入る(BDC と q が交差しないように) */
  clip(/** @type {ClipOp} */ op) {
    if (!Array.isArray(op.ops)) return
    this.closeGroup()
    const saved = this.fill
    this.push(`q\n${this.n(op.x)} ${this.n(this.b.H - (op.y + op.h))} ${this.n(op.w)} ${this.n(op.h)} re W n`)
    this.drawOps(op.ops)
    this.closeGroup()
    this.push('Q')
    this.fill = saved
  }
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

/** リンク注釈。URL は https・http・mailto だけ。7 ビットに収めるため ASCII の外の字は %XX にする */
function addLink(/** @type {Build} */ b, /** @type {any} */ page, /** @type {LinkOp} */ l) {
  const raw = typeof l.url === 'string' ? l.url.trim() : ''
  if (!/^(https?:\/\/|mailto:)/i.test(raw)) { b.warn.add(`リンクの URL は https・http・mailto だけ。捨てた: ${raw.slice(0, 40)}`); return }
  let url
  try { url = raw.replace(/[^\x21-\x7e]/gu, (ch) => encodeURIComponent(ch)) } catch { b.warn.add(`リンクの URL を直せなかったので捨てた: ${raw.slice(0, 40)}`); return }
  const y = b.H - (l.y + l.h)
  const ref = b.ctx.register(b.ctx.obj({
    Type: 'Annot', Subtype: 'Link', F: 4, Border: [0, 0, 0],
    Rect: [l.x, y, l.x + l.w, y + l.h],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
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
    const size = Number.isFinite(op.size) && /** @type {number} */ (op.size) > 0 ? /** @type {number} */ (op.size) : FIELD_PT
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
