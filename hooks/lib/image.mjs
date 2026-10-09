// @ts-check
// 画像の頭の読み: PNG（IHDR）と JPEG（SOF）の幅と高さ。純な部品。
// 画像を開いて描き直すことはしない。組版が要るのは寸法だけで、中身は renderPdf が pdf-lib で入れる。
import { b64ToBytes } from '../vendor/pdf.mjs'
import { normalize } from '../engine/schema.mjs'

/** @typedef {{ kind: 'png'|'jpg', width: number, height: number }} ImageInfo */
/** 1 辺の上限。これを超える画像は寸法がおかしい（壊れた頭）として断る */
const SIDE_MAX = 30000

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** @param {Uint8Array} b @param {number} at */
const u16 = (b, at) => (b[at] << 8) | b[at + 1]
/** @param {Uint8Array} b @param {number} at */
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0

/**
 * @param {Uint8Array} b
 * @returns {ImageInfo | null}
 */
function pngInfo(b) {
  if (b.length < 24) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (b[i] !== PNG_SIGNATURE[i]) return null
  // 最初の塊は必ず IHDR（長さ 13）
  if (u32(b, 8) !== 13 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
  const width = u32(b, 16)
  const height = u32(b, 20)
  if (!(width > 0 && height > 0 && width <= SIDE_MAX && height <= SIDE_MAX)) return null
  return { kind: 'png', width, height }
}

/**
 * JPEG は印（FF xx）をたどって SOF0・SOF1・SOF2 を探す。SOF3 以降（ロスレス・算術符号）は PDF が受けないので探さない。
 * @param {Uint8Array} b
 * @returns {ImageInfo | null}
 */
function jpgInfo(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let at = 2
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) return null
    // 印の前の詰め物（FF が続く）を飛ばす
    while (at < b.length && b[at] === 0xff) at++
    const marker = b[at]
    at++
    // 長さを持たない印: TEM・RSTn・SOI・EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    // 画像の本体に入った（SOF が先に来ていない壊れたファイル）か、終わり
    if (marker === 0xd9 || marker === 0xda) return null
    if (at + 1 >= b.length) return null
    const len = u16(b, at)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (at + 7 > b.length) return null
      const height = u16(b, at + 3)
      const width = u16(b, at + 5)
      if (!(width > 0 && height > 0)) return null
      return { kind: 'jpg', width, height }
    }
    if (len < 2) return null
    at += len
  }
  return null
}

/**
 * 画像の base64 から、種類と寸法を読む。読めなければ null（拡張子ではなく中身の頭で決める）
 * @param {string} base64
 * @returns {ImageInfo | null}
 */
export function imageInfo(base64) {
  if (typeof base64 !== 'string' || base64.length < 8) return null
  let bytes
  try {
    bytes = b64ToBytes(base64)
  } catch {
    return null
  }
  return pngInfo(bytes) ?? jpgInfo(bytes)
}

/**
 * make の引数から、画像のブロックが指す path を重複なしで集める。
 * 組版（compose）の中でも同じ検査をするが、画像は本体が先に読んで渡す約束なので、先に Doc にして path を拾う。
 * 引数がおかしい時は空（その時の断りは compose が書く）
 * @param {unknown} input
 * @returns {string[]}
 */
export function imagePathsOf(input) {
  try {
    const { doc } = normalize(input)
    /** @type {Set<string>} */
    const seen = new Set()
    for (const b of doc.blocks) if (b.type === 'image' && typeof b.path === 'string') seen.add(b.path)
    return [...seen]
  } catch {
    return []
  }
}
