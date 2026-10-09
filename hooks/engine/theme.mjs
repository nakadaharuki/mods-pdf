// @ts-check
// 版面（紙・余白・行の格子）と色・見出しの決まり。純な部品。単位は pt、y は紙の上から下へ。

/** @typedef {'mono'|'koma'|'mergeble'} ThemeName */
/** @typedef {'mincho'|'gothic'} BodyFace */
/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Colors */
/** @typedef {{ size: number, font: FontId, rule: number, ruleColor: string, above: number, below: number }} HeadStyle ruleColor は見出しの下の罫の色。rule が 0 なら引かない。above・below は見出しの上下に取る空きの行数（行送りの整数倍。頁の頭では above を捨てる） */
/**
 * @typedef {{
 *   name: ThemeName,
 *   paperName: string,
 *   landscape: boolean,
 *   page: { width: number, height: number },
 *   size: number, chars: number, measure: number,
 *   left: number, right: number, top: number, bottom: number,
 *   lineGap: number, lines: number,
 *   scale: number,
 *   title: { size: number, metaSize: number, rule: number },
 *   baseline: (i: number) => number,
 *   footY: number,
 *   fonts: { body: FontId, bodyBold: FontId, head: FontId, gothic: FontId, gothicBold: FontId },
 *   colors: Colors,
 *   head: { h1: HeadStyle, h2: HeadStyle, h3: HeadStyle },
 *   foot: { size: number, color: string, y: number, ruleY: number, ruleW: number },
 * }} Theme
 */

export const PAPERS = { A4: [595.28, 841.89], A5: [419.53, 595.28], B5: [515.91, 728.5], Letter: [612, 792] }

/** 本文の大きさの既定（紙ごと）。小さい紙は少し小さくして 1 行の字数を保つ */
export const DEFAULT_SIZES = { A4: 9.5, A5: 9, B5: 9.5, Letter: 9.5 }

export const SIZE_MIN = 8
export const SIZE_MAX = 14
/** 見出し・題名・表・要点の字は、本文がこの大きさの時の値で決めてある。本文がこれより大きい時だけ、同じ比で大きくする */
export const SCALE_BASE = 9.5

/** @param {number} v 小数 1 桁に */
const round1 = (v) => Math.round(v * 10) / 10
/** @param {number} v ミリメートルを pt に */
const mm = (v) => (v * 72) / 25.4
/** 左右の余白の最小。残りは行長を字の大きさの整数倍にした後の端数で、左右に等分する */
const SIDE_MIN = mm(15)
const TOP_MIN = mm(18)
/** 足（フッター）はこの中に入る */
const BOTTOM_MIN = mm(20)
const LINE_GAP_RATIO = 1.75
/** 行の箱の中で字の箱を真ん中に置いた時の、字の箱の上端から基線までの比。明朝・ゴシックの代表的な値 */
const BASELINE_RATIO = 0.88
/** 題名の塊（本文 9.5pt の時の値）。h1 より一段大きく、罫も一番太い */
const TITLE_SIZE = 18
const META_SIZE = 9
const TITLE_RULE = 1.4
const FOOT_SIZE = 8
/** 足の基線は紙の下端から測る。下の余白は端数の分だけ伸び縮みするので、そちらに合わせると足が頁ごとの紙の違いで動く */
const FOOT_FROM_BOTTOM = mm(13)
const FOOT_RULE_ABOVE = FOOT_SIZE + 3

// 白黒（証券会社調）。紺や青を主役にしない・地を白から動かさない。
// 注記の sub も印刷で飛ばない濃さ（白地に 4.5 以上）
const UP = '#176639'
const DOWN = '#A31F1C'
/** @param {object} o @param {string} k */
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** @type {Record<ThemeName, Colors>} */
const COLORS = {
  mono: { ink: '#111111', sub: '#4A4A4A', rule: '#CCCCC9', tint: '#F1F0ED', accent: '#111111', up: UP, down: DOWN, paper: '#FFFFFF' },
  // Koma の型（_base.css）。手本は typst-pdf/lib/theme.typ
  koma: { ink: '#16233A', sub: '#47597A', rule: '#C6D2E4', tint: '#F2F6FC', accent: '#1F4FA8', up: UP, down: DOWN, paper: '#FFFFFF' },
  // Mergeble。tint は theme.typ の表の頭の地（terra4 を 45% 明るくした値）、sub は theme.typ に無いので ink と同じ温かい褐色で紙の上 4.5 以上に決めた
  mergeble: { ink: '#2B2622', sub: '#5B524B', rule: '#E4DED8', tint: '#F8EAE5', accent: '#C56A4D', up: UP, down: DOWN, paper: '#FAF9F7' },
}

// 見出しの大きさ・罫と、上下に取る空き（行送りの整数倍）。大きさは本文 9.5pt の時の値で、本文が大きい時は makeTheme が scale 倍する。
// 選ばなかった案:
//   - 大きさを pt の固定にしたままにする案: 本文 12.5pt（bench-40）で h1 は本文の 1.2 倍・h3 は本文より小さくなり、段の違いが分からない。
//   - 本文が 9.5pt より小さい時も縮める案: 注記・表・要点の字が 7pt を割り、本文との差も縮む。大きい方へだけ伸ばす（scale >= 1）。
//   - h1 を題名の塊と同じ 18pt・1.4pt の罫にする案: 原稿の頭の h1 が題名の直下に来ると、題名が 2 つ並んで見える。
//     題名（18pt・1.4pt）だけを一番大きい形にし、h1 は一段小さくする。
//   - h3 の上の空きを 0 にして、段落の続きに見せる案: 直前の段落の最後の行に詰まって、見出しと分からない。
//     半行ぶんの空きも格子から外れるので、1 行ぶん取る。
//   - 下の空き（below）で見出しと本文を離す案: 見出しは直後の本文に付ける物なので 0。罫のある段は罫が区切りになる。
/** @type {Record<'h1'|'h2'|'h3', { size: number, rule: number, above: number, below: number }>} */
const HEADS = {
  h1: { size: 15, rule: 0.8, above: 2, below: 0 },
  h2: { size: 13, rule: 0.6, above: 1, below: 0 },
  h3: { size: 10.5, rule: 0, above: 1, below: 0 },
}

/**
 * @param {{ theme?: string, body?: string, paper?: string, landscape?: boolean, size?: number }} [opts]
 * @returns {Theme}
 */
export function makeTheme({ theme = 'mono', body = 'mincho', paper = 'A4', landscape = false, size } = {}) {
  // 知らない名前は黙って既定に戻す（normalize が先に直すので、ここに来るのは直接呼んだ時だけ）
  const name = /** @type {ThemeName} */ (has(COLORS, theme) ? theme : 'mono')
  const paperName = has(PAPERS, paper) ? paper : 'A4'
  const [w, h] = /** @type {Record<string, number[]>} */ (PAPERS)[paperName]
  const width = landscape ? Math.max(w, h) : Math.min(w, h)
  const height = landscape ? Math.min(w, h) : Math.max(w, h)

  const fallback = /** @type {Record<string, number>} */ (DEFAULT_SIZES)[paperName]
  const wanted = typeof size === 'number' && Number.isFinite(size) ? size : fallback
  const sz = Math.min(SIZE_MAX, Math.max(SIZE_MIN, wanted))

  // 浮動小数の誤差で、ちょうど割り切れる幅が 1 字足りなくならないよう 1e-9 を足す
  const chars = Math.floor((width - 2 * SIDE_MIN) / sz + 1e-9)
  const measure = sz * chars
  const side = (width - measure) / 2

  const scale = Math.max(1, sz / SCALE_BASE)
  const lineGap = sz * LINE_GAP_RATIO
  const lines = Math.floor((height - TOP_MIN - BOTTOM_MIN) / lineGap + 1e-9)
  const extra = Math.max(0, height - TOP_MIN - BOTTOM_MIN - lines * lineGap)
  const top = TOP_MIN + extra / 2
  const bottom = BOTTOM_MIN + extra / 2

  const colors = COLORS[name]
  const gothicBody = body === 'gothic'
  const footY = height - FOOT_FROM_BOTTOM

  /** @param {{ size: number, rule: number, above: number, below: number }} s @returns {HeadStyle} */
  const headStyle = (s) => ({ size: round1(s.size * scale), font: 'minchoBold', rule: s.rule, ruleColor: colors.accent, above: s.above, below: s.below })

  return {
    name,
    paperName,
    landscape: !!landscape,
    page: { width, height },
    size: sz,
    chars,
    measure,
    left: side,
    right: side,
    top,
    bottom,
    lineGap,
    lines,
    scale,
    title: { size: round1(TITLE_SIZE * scale), metaSize: round1(META_SIZE * scale), rule: TITLE_RULE },
    baseline: (i) => top + i * lineGap + (lineGap - sz) / 2 + BASELINE_RATIO * sz,
    footY,
    fonts: {
      body: gothicBody ? 'sans' : 'mincho',
      bodyBold: gothicBody ? 'sansBold' : 'minchoBold',
      head: 'minchoBold',
      gothic: 'sans',
      gothicBold: 'sansBold',
    },
    colors: { ...colors },
    head: { h1: headStyle(HEADS.h1), h2: headStyle(HEADS.h2), h3: headStyle(HEADS.h3) },
    foot: { size: FOOT_SIZE, color: colors.sub, y: footY, ruleY: footY - FOOT_RULE_ABOVE, ruleW: 0.5 },
  }
}
