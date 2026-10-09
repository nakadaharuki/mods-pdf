// @ts-check
// 書体の読み込みと寸法。純な部品（フックの環境に無い Node の物は使わない・ファイルの読み方は引数で受ける）。
import { rawFontkit, joinB64, b64ToBytes } from '../vendor/pdf.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ bytes: number, parts: string[] }} ManifestEntry */
/** @typedef {Record<string, ManifestEntry>} FontManifest fonts/fonts.json の形 */
/** @typedef {{ width: number, xs: number[] }} FontRun */
/**
 * @typedef {{
 *   upm: number,
 *   ascent: number,
 *   descent: number,
 *   adv: (cp: number) => number,
 *   has: (cp: number) => boolean,
 *   run: (text: string) => FontRun,
 *   missing: (text: string) => string[],
 * }} FontMetrics
 * upm は 1 em の単位数。ascent は正・descent は負（どちらも em）。adv は送り幅（em）で無い字は NaN。
 * run の答えは覚えてあるので書き換えない（凍結してある）
 */
/** @typedef {Record<FontId, FontMetrics>} Metrics */

export const FONT_FILES = {
  mincho: 'NotoSerifJP-JIS-400.ttf',
  minchoBold: 'NotoSerifJP-JIS-600.ttf',
  sans: 'NotoSansJP-JIS-400.ttf',
  sansBold: 'NotoSansJP-JIS-700.ttf',
}

/** 読み終えた書体のファイル（名前 → 約束）。約束ごと覚えるので、同時に 2 回呼ばれても読むのは 1 回 */
const defaultCache = new Map()

/**
 * fonts.json と、ファイルを base64 で読む関数から、書体のバイト列を作る。割ったファイルはつなぐ。
 * まだ読んでいないファイルだけを読む（cache に覚える）。読むのは 1 ファイルずつ順に。
 * 一度に全部の約束を並べて読む案は選ばなかった: フックの読み込みは 1 回 4 MiB 近い base64 で、
 * 並べるとその字が同時に何本も生きてメモリが跳ねる。
 * @param {FontId[]} ids
 * @param {FontManifest} manifest
 * @param {(relPath: string) => Promise<string>} readBase64 fonts/ の下の相対パス（manifest の parts の名前）を渡す
 * @param {Map<string, Promise<Uint8Array>>} [cache] 試験で分けたい時だけ渡す
 * @returns {Promise<Record<FontId, Uint8Array>>}
 */
export async function loadFontBytes(ids, manifest, readBase64, cache = defaultCache) {
  /** @type {Record<string, Uint8Array>} */
  const out = {}
  for (const id of new Set(ids)) {
    const file = /** @type {Record<string, string>} */ (FONT_FILES)[id]
    if (!file) throw new Error(`fonts: 知らない書体 ${id}`)
    const info = manifest[file]
    if (!info || !Array.isArray(info.parts) || info.parts.length === 0) throw new Error(`fonts: fonts.json に ${file} が無い`)
    let pending = cache.get(file)
    if (!pending) {
      pending = readParts(file, info, readBase64)
      cache.set(file, pending)
      // 失敗を覚えたままにしない（次の呼び出しで読み直せるように）
      pending.catch(() => { if (cache.get(file) === pending) cache.delete(file) })
    }
    out[id] = await pending
  }
  return /** @type {Record<FontId, Uint8Array>} */ (out)
}

/**
 * @param {string} file
 * @param {ManifestEntry} info
 * @param {(relPath: string) => Promise<string>} readBase64
 * @returns {Promise<Uint8Array>}
 */
async function readParts(file, info, readBase64) {
  const strings = []
  for (const part of info.parts) strings.push(await readBase64(part))
  // つなぐ関数は束の中のものを使う（外で作った Uint8Array は別の領域の物で、pdf-lib が受けない）
  const bytes = strings.length === 1 ? b64ToBytes(strings[0]) : joinB64(strings)
  if (typeof info.bytes === 'number' && bytes.length !== info.bytes) {
    throw new Error(`fonts: ${file} の大きさが fonts.json と違う（${bytes.length} / ${info.bytes}）`)
  }
  return bytes
}

// 合字を切る。PDF には 1 字ずつ書くので、合字の字形が出ると位置がずれる。カーニング（kern）は残す
const NO_LIGATURES = { liga: false, clig: false, dlig: false, calt: false, rlig: false }
// run の答えを覚える上限。欧文の語は同じ物が何度も出るので足りる。超えたら全部捨てる（古い物から捨てる細工は割に合わない）
const RUN_CACHE_MAX = 20000

/**
 * バイト列から寸法を作る。
 * @param {Partial<Record<FontId, Uint8Array>>} bytesById
 * @returns {Metrics}
 */
export function makeMetrics(bytesById) {
  /** @type {Record<string, FontMetrics>} */
  const out = {}
  for (const [id, bytes] of Object.entries(bytesById)) {
    if (bytes) out[id] = makeFontMetrics(bytes)
  }
  return /** @type {Metrics} */ (out)
}

/**
 * @param {Uint8Array} bytes
 * @returns {FontMetrics}
 */
export function makeFontMetrics(bytes) {
  /** @type {any} */
  const font = rawFontkit.create(bytes)
  if (!font || typeof font.layout !== 'function') throw new Error('fonts: 書体を開けない（コレクションは未対応）')
  const upm = font.unitsPerEm
  /** @type {Map<number, number>} */
  const advCache = new Map()
  /** @type {Map<string, FontRun>} */
  const runCache = new Map()

  /** @param {number} cp */
  const has = (cp) => Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff && font.hasGlyphForCodePoint(cp)

  /** @param {number} cp */
  const adv = (cp) => {
    let v = advCache.get(cp)
    if (v === undefined) {
      v = has(cp) ? font.glyphForCodePoint(cp).advanceWidth / upm : NaN
      advCache.set(cp, v)
    }
    return v
  }

  const notdef = font.getGlyph(0).advanceWidth / upm

  /**
   * 字ごとの送り幅の和に戻す形。字形の数が字の数と合わない時（異体字選択子が落ちるなど）に使う
   * @param {number[]} cps
   * @returns {FontRun}
   */
  const plainRun = (cps) => {
    const xs = []
    let x = 0
    for (const cp of cps) {
      xs.push(x)
      const a = adv(cp)
      x += Number.isNaN(a) ? notdef : a
    }
    return { width: x, xs }
  }

  /** @param {string} text @returns {FontRun} */
  const run = (text) => {
    const hit = runCache.get(text)
    if (hit) return hit
    const cps = Array.from(text, (ch) => /** @type {number} */ (ch.codePointAt(0)))
    /** @type {FontRun} */
    let result
    if (cps.length === 0) result = { width: 0, xs: [] }
    else {
      let laid = null
      try {
        // 向きを ltr に決める。決めないと右から左の字（ヘブライ文字など）で字形の並びが逆になる
        laid = font.layout(text, NO_LIGATURES, undefined, undefined, 'ltr')
      } catch { laid = null }
      if (laid && laid.glyphs.length === cps.length) {
        const xs = []
        let x = 0
        for (let i = 0; i < cps.length; i++) {
          const p = laid.positions[i]
          xs.push((x + (p.xOffset || 0)) / upm)
          x += p.xAdvance
        }
        result = { width: x / upm, xs }
      } else result = plainRun(cps)
    }
    Object.freeze(result.xs)
    Object.freeze(result)
    if (runCache.size >= RUN_CACHE_MAX) runCache.clear()
    runCache.set(text, result)
    return result
  }

  /** 書体に無い字（重複なし・出てきた順） @param {string} text */
  const missing = (text) => {
    const seen = new Set()
    for (const ch of text) {
      const cp = /** @type {number} */ (ch.codePointAt(0))
      if (!has(cp)) seen.add(ch)
    }
    return [...seen]
  }

  return { upm, ascent: font.ascent / upm, descent: font.descent / upm, adv, has, run, missing }
}
