// hooks/vendor/pdf.mjs の元（pdf-lib 1.17.1 と fontkit 2.0.4）。scripts/build-vendor.mjs が 1 ファイルにまとめる。手で直すのはこのファイル。
// 元は mods-trade の shared/src/pdf-entry.mjs（本人の物）。ModsPDF では低い層（演算子・辞書・フォーム）も使うので pdf-lib を丸ごと出す。
// フックの環境はファイルを字（UTF-8）でしか書けないので、save7bit が中の流れを全部 ASCII85 にして 7 ビットの字の PDF にする。
import { PDFDocument, PDFStream, PDFRawStream, PDFName, PDFArray, PDFNull, PDFHexString } from 'pdf-lib'
import * as fk from 'fontkit'

export * from 'pdf-lib'

// pdf-lib は subset.encodeStream() を呼ぶ。fontkit 2 は subset.encode() なので合わせる
const wrapSubset = (sub) => new Proxy(sub, {
  get(t, k) {
    if (k === 'encodeStream') return () => {
      const h = {}
      const s = { on(ev, cb) { h[ev] = cb; return s } }
      Promise.resolve().then(() => { try { h.data?.(t.encode()); h.end?.() } catch (e) { h.error?.(e) } })
      return s
    }
    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v
  },
})
const wrapFont = (f) => new Proxy(f, {
  get(t, k) { if (k === 'createSubset') return () => wrapSubset(t.createSubset()); const v = t[k]; return typeof v === 'function' ? v.bind(t) : v },
})
export const fontkit = { create: (buf, name) => wrapFont(fk.create(buf, name)) }
/** fontkit そのもの（字の形・送り幅・機能の適用を engine が直接読む時に使う。pdf-lib に渡すのは上の fontkit） */
export const rawFontkit = fk

/**
 * ASCII85 の 1 字（0〜84 → '!'〜'u'）。String.fromCharCode や Math を字ごとに引かず、モジュールの表から取る。
 * フックの環境（vm の文脈）は大域の名前の参照が遅く、2 MB の書体を包むだけで 1 秒近くかかった
 */
const A85 = Array.from({ length: 85 }, (_, i) => String.fromCharCode(i + 33))

function ascii85(bytes) {
  const n = bytes.length
  const out = []
  let line = ''
  let col = 0
  for (let i = 0; i < n; i += 4) {
    const rem = n - i < 4 ? n - i : 4
    let v = bytes[i] * 16777216 + (i + 1 < n ? bytes[i + 1] * 65536 : 0) + (i + 2 < n ? bytes[i + 2] * 256 : 0) + (i + 3 < n ? bytes[i + 3] : 0)
    let s
    if (v === 0 && rem === 4) s = 'z'
    else {
      // v は 2^32 未満の整数なので、(v - 余り) / 85 は割り切れて Math.floor が要らない
      const d4 = v % 85; v = (v - d4) / 85
      const d3 = v % 85; v = (v - d3) / 85
      const d2 = v % 85; v = (v - d2) / 85
      const d1 = v % 85
      const d0 = (v - d1) / 85
      s = A85[d0] + A85[d1] + A85[d2] + A85[d3] + A85[d4]
      if (rem < 4) s = s.slice(0, rem + 1)
    }
    line += s
    col += s.length
    if (col >= 76) { out.push(line, '\n'); line = ''; col = 0 }
  }
  out.push(line, '~>')
  return out.join('')
}

/**
 * 文書を 7 ビットの字だけの PDF にして返す（どの流れも [/ASCII85Decode ...元のフィルター]・オブジェクトの流れは使わない）。
 * 読み込んだ既存の PDF にも使える（中の画像や書体の流れも同じく ASCII85 で包む）。
 * @param {PDFDocument} doc
 * @param {{ updateFieldAppearances?: boolean }} [o] フォームの見た目を pdf-lib に作り直させる時だけ true（既定は作り直さない）
 * @returns {Promise<string>}
 */
export async function save7bit(doc, o = {}) {
  await doc.flush()
  const ctx = doc.context
  const enc = new TextEncoder()
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue
    const body = obj.getContents()
    const dict = obj.dict.clone(ctx)
    const f = dict.get(PDFName.of('Filter'))
    const filters = PDFArray.withContext(ctx)
    filters.push(PDFName.of('ASCII85Decode'))
    if (f instanceof PDFArray) for (let i = 0; i < f.size(); i++) filters.push(f.get(i)); else if (f) filters.push(f)
    dict.set(PDFName.of('Filter'), filters)
    const dp = dict.get(PDFName.of('DecodeParms'))
    if (dp) { const a = PDFArray.withContext(ctx); a.push(PDFNull); if (dp instanceof PDFArray) for (let i = 0; i < dp.size(); i++) a.push(dp.get(i)); else a.push(dp); dict.set(PDFName.of('DecodeParms'), a) }
    dict.delete(PDFName.of('Length'))
    ctx.assign(ref, PDFRawStream.of(dict, enc.encode(ascii85(body))))
  }
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: o.updateFieldAppearances === true })
  // 頭の「バイナリです」の注釈だけが 8 ビット。同じ長さで置き換える（xref の位置を保つ）
  for (let i = 0; i < 32; i++) if (bytes[i] > 0x7f) bytes[i] = 0x41
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) throw new Error('pdf: not 7-bit')
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
  return s
}

/** しおり（見出しの一覧）を付ける。items は [{ title, page（0 から）, y }]。題は UTF-16 の 16 進で書くので 7 ビットのまま */
export function outline(doc, items) {
  if (!items.length) return
  const ctx = doc.context, pages = doc.getPages()
  const root = ctx.nextRef(), refs = items.map(() => ctx.nextRef())
  items.forEach((it, i) => {
    const d = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: root, Dest: [pages[it.page].ref, 'XYZ', null, it.y, null] })
    if (i) d.set(PDFName.of('Prev'), refs[i - 1])
    if (i < items.length - 1) d.set(PDFName.of('Next'), refs[i + 1])
    ctx.assign(refs[i], d)
  })
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: items.length }))
  doc.catalog.set(PDFName.of('Outlines'), root)
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

/** base64 をバイト列に（この束の中で作る。外で作った Uint8Array は別の領域の物で pdf-lib が受けない） */
export const b64ToBytes = (s) => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s)
  const b = atob(s)
  const u = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
  return u
}

/** 割って置いた書体の base64 の列を、1 つのバイト列につなぐ */
export const joinB64 = (list) => {
  const parts = list.map(b64ToBytes)
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
