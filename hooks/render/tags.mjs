// @ts-check
// render/tags: 描いた中身(MCID)の記録と、PDF の構造(StructTreeRoot・StructElem・ParentTree)を作る純な部品。
// 手本の試し(spike)は「1 行に 1 つの要素」を作っていて誤りだった。ここでは Layout.tags の番号 1 つにつき要素 1 つにし、
// 頁をまたぐ段落は MCR で 1 つの要素にまとめる。要素の並び(K)は描いた順(読み上げの順)にそろえる。
import { PDFName, PDFNumber, PDFHexString, PDFString } from '../vendor/pdf.mjs'

/** @typedef {{ role: string, parent: number|null, alt?: string, lang?: string }} Tag */
/** @typedef {{ tag: number, page: number, mcid: number, seq: number }} Mark */
/** @typedef {{ tag: number, page: number, dict: any, ref: any, seq: number }} WidgetMark */

export class TagLog {
  constructor() {
    /** @type {Mark[]} */
    this.marks = []
    /** @type {WidgetMark[]} */
    this.widgets = []
    /** 頁ごとの「MCID → tag の番号」。ParentTree の元 @type {number[][]} */
    this.pageMcids = []
    this.seq = 0
  }

  /**
   * 頁 page に tag の中身を 1 つ始める。その頁の MCID(0 から)を返す
   * @param {number} page @param {number} tag
   */
  mark(page, tag) {
    const list = this.pageMcids[page] ?? (this.pageMcids[page] = [])
    const mcid = list.length
    list.push(tag)
    this.marks.push({ tag, page, mcid, seq: this.seq++ })
    return mcid
  }

  /**
   * 記入欄の注釈を tag の中身として記録する(OBJR で構造に入れる)
   * @param {number} page @param {number} tag @param {any} dict @param {any} ref
   */
  widget(page, tag, dict, ref) {
    this.widgets.push({ tag, page, dict, ref, seq: this.seq++ })
  }
}

const ROLE = /^[A-Za-z][A-Za-z0-9]*$/

/**
 * 構造の木を作って文書に付ける。返すのは警告だけ。
 * @param {any} doc PDFDocument
 * @param {any[]} pageRefs 頁の PDFRef(頁の番号順)
 * @param {Tag[]} tags Layout.tags
 * @param {TagLog} log
 * @returns {string[]}
 */
export function buildStructTree(doc, pageRefs, tags, log) {
  const ctx = doc.context
  /** @type {string[]} */
  const warnings = []
  const n = tags.length

  // 親は範囲内の別の番号だけ。変なものと輪は Document(0)につなぎ直す
  const parent = tags.map((t, i) => (i === 0 ? -1 : Number.isInteger(t.parent) && /** @type {number} */ (t.parent) >= 0 && /** @type {number} */ (t.parent) < n && t.parent !== i ? /** @type {number} */ (t.parent) : 0))
  for (let i = 1; i < n; i++) {
    let j = parent[i]
    let steps = 0
    while (j > 0 && steps <= n) { j = parent[j]; steps++ }
    if (steps > n) parent[i] = 0
  }
  /** @type {number[][]} */
  const kids = tags.map(() => [])
  for (let i = 1; i < n; i++) kids[parent[i]].push(i)

  /** @type {Mark[][]} */
  const direct = tags.map(() => [])
  for (const m of log.marks) direct[m.tag].push(m)
  /** @type {WidgetMark[][]} */
  const widgets = tags.map(() => [])
  for (const w of log.widgets) widgets[w.tag].push(w)

  // 中身を持つ要素と、そこにつながる祖先だけを作る(空の要素は作らない。Document だけは必ず作る)
  const minSeq = new Array(n).fill(Infinity)
  const used = new Array(n).fill(false)
  const visit = (/** @type {number} */ i) => {
    let min = Infinity
    for (const m of direct[i]) min = Math.min(min, m.seq)
    for (const w of widgets[i]) min = Math.min(min, w.seq)
    for (const c of kids[i]) { visit(c); if (used[c]) min = Math.min(min, minSeq[c]) }
    minSeq[i] = min
    used[i] = min < Infinity || i === 0
  }
  visit(0)

  const rootRef = ctx.nextRef()
  const refs = tags.map((_, i) => (used[i] ? ctx.nextRef() : null))

  for (let i = 0; i < n; i++) {
    if (!used[i]) continue
    const t = tags[i]
    const role = typeof t.role === 'string' && ROLE.test(t.role) ? t.role : 'Span'
    /** @type {{ seq: number, v: any }[]} */
    const entries = []
    const firstPage = direct[i].length ? direct[i][0].page : -1
    for (const m of direct[i]) {
      entries.push({ seq: m.seq, v: m.page === firstPage ? PDFNumber.of(m.mcid) : ctx.obj({ Type: 'MCR', Pg: pageRefs[m.page], MCID: m.mcid }) })
    }
    for (const w of widgets[i]) entries.push({ seq: w.seq, v: ctx.obj({ Type: 'OBJR', Obj: w.ref, Pg: pageRefs[w.page] }) })
    for (const c of kids[i]) if (used[c]) entries.push({ seq: minSeq[c], v: refs[c] })
    entries.sort((a, b) => a.seq - b.seq)

    const dict = ctx.obj({ Type: 'StructElem', S: role, P: i === 0 ? rootRef : refs[parent[i]], K: entries.map((e) => e.v) })
    if (firstPage >= 0) dict.set(PDFName.of('Pg'), pageRefs[firstPage])
    if (typeof t.alt === 'string' && t.alt) dict.set(PDFName.of('Alt'), PDFHexString.fromText(t.alt))
    else if (role === 'Figure') warnings.push('Figure に代替テキスト(alt)が無い')
    if (typeof t.lang === 'string' && /^[A-Za-z0-9-]{2,16}$/.test(t.lang)) dict.set(PDFName.of('Lang'), PDFString.of(t.lang))
    ctx.assign(refs[i], dict)
  }

  // 頁の StructParents の番号 → その頁の MCID 順の要素。記入欄の注釈は頁の番号の後ろに続ける
  /** @type {any[]} */
  const nums = []
  let key = 0
  log.pageMcids.forEach((list, p) => {
    if (!list || !list.length) return
    doc.getPage(p).node.set(PDFName.of('StructParents'), PDFNumber.of(key))
    nums.push(PDFNumber.of(key), ctx.obj(list.map((t) => refs[t])))
    key++
  })
  for (const w of log.widgets) {
    w.dict.set(PDFName.of('StructParent'), PDFNumber.of(key))
    nums.push(PDFNumber.of(key), refs[w.tag])
    key++
  }

  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: refs[0], ParentTree: ctx.obj({ Nums: nums }), ParentTreeNextKey: key }))
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef)
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
  return warnings
}
