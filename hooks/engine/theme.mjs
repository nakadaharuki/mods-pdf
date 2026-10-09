// @ts-check
// 版面（紙・余白・行の格子）と色・見出しの決まり。純な部品。単位は pt、y は紙の上から下へ。

/** @typedef {'mono'|'koma'|'mergeble'|'vivid'} ThemeName */
/** @typedef {'mincho'|'gothic'} BodyFace */
/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, accent2: string, grad: string[], up: string, down: string, paper: string }} Colors grad は表紙・section の光と題名の字・細い帯の色の止まり（2 色以上。先頭と末尾が同じなら単色 = 光を出さない） */
/**
 * 資料（deck）の寸法。大きさは A4 横（841.89 pt 幅）を 1 とした値に scale を掛けた pt で、7pt を割らない。
 * @typedef {{
 *   scale: number,
 *   margin: { left: number, right: number, top: number, bottom: number },
 *   grid: { cols: number, gap: number, colW: number },
 *   flat: boolean,
 *   sizes: { cover: number, coverSub: number, section: number, sectionNo: number, statement: number, title: number, lead: number,
 *            body: number[], table: number[], kicker: number, page: number, source: number, label: number, note: number, kpi: number, panelTitle: number, panelNote: number },
 * }} DeckStyle
 */
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
 *   kind?: 'deck',
 *   deck?: DeckStyle,
 * }} Theme
 */

/** wide は資料の 16:9（960×540pt）。向きは見ない（横しか無い） */
export const PAPERS = { A4: [595.28, 841.89], A5: [419.53, 595.28], B5: [515.91, 728.5], Letter: [612, 792], wide: [960, 540] }

/** 本文の大きさの既定（紙ごと）。小さい紙は少し小さくして 1 行の字数を保つ */
export const DEFAULT_SIZES = { A4: 9.5, A5: 9, B5: 9.5, Letter: 9.5, wide: 9.5 }

export const SIZE_MIN = 8
export const SIZE_MAX = 14
/** 見出し・題名・表・要点の字は、本文がこの大きさの時の値で決めてある。本文がこれより大きい時だけ、同じ比で大きくする */
export const SCALE_BASE = 9.5

/** @param {number} v 小数 1 桁に */
const round1 = (v) => Math.round(v * 10) / 10
/** @param {number} v 小数 2 桁に */
const round2 = (v) => Math.round(v * 100) / 100
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

// accent2 と grad は資料（deck）と図の形（looks）が読む。mono は墨だけ（grad の先頭と末尾が同じ = 光も字のグラデーションも出さない）
/** @type {Record<ThemeName, Colors>} */
const COLORS = {
  mono: { ink: '#111111', sub: '#4A4A4A', rule: '#CCCCC9', tint: '#F1F0ED', accent: '#111111', accent2: '#6B6B6B', grad: ['#111111', '#111111'], up: UP, down: DOWN, paper: '#FFFFFF' },
  // Koma の型（_base.css）。手本は typst-pdf/lib/theme.typ
  koma: { ink: '#16233A', sub: '#47597A', rule: '#C6D2E4', tint: '#F2F6FC', accent: '#1F4FA8', accent2: '#5B7FBF', grad: ['#1F4FA8', '#3F7BD9'], up: UP, down: DOWN, paper: '#FFFFFF' },
  // Mergeble。tint は theme.typ の表の頭の地（terra4 を 45% 明るくした値）、sub は theme.typ に無いので ink と同じ温かい褐色で紙の上 4.5 以上に決めた
  mergeble: { ink: '#2B2622', sub: '#5B524B', rule: '#E4DED8', tint: '#F8EAE5', accent: '#C56A4D', accent2: '#8F5A44', grad: ['#C56A4D', '#E39A74'], up: UP, down: DOWN, paper: '#FAF9F7' },
  // 資料の既定。紫を主役に、橙を差す。表紙と section は grad の光、題名の下は grad の細い帯。地は白
  vivid: { ink: '#15131D', sub: '#4B4858', rule: '#DCD9E3', tint: '#F4F2F8', accent: '#6A3DE8', accent2: '#F0562E', grad: ['#3B2FD9', '#A12BD6', '#F2542D'], up: '#157F3B', down: '#C0261E', paper: '#FFFFFF' },
}

// 図の形（looks）が系列・項目を塗り分ける 8 色。先頭は必ずそのテーマの accent（目立たせる 1 つの色と、1 番目の系列が同じ色になる。試験が確かめる）。
// 色はテーマごとに白地（vivid・koma は #FFFFFF、mergeble は #FAF9F7）の上で隣り合っても見分けられる色相を選んだ。字には使わない（字は ink・sub・accent・up・down だけ）。
// mono は持たない（墨の濃さと点線で分ける）。
// 選ばなかった案:
//   - Colors に series を足して makeTheme().colors に入れる案: colors は表紙の光・表の頭・足など文書の全部が読む。8 色が混ざると、図だけが使う物が文書の色の表を広げる。図の入口 lookPal だけが足す。
//   - 12 色にする案: 系列の上限が 12 だが、8 色を超える系列は図として読めない。9 本目からは回して使い、墨の濃さではなく線の形に頼らない（8 色で足りない図は分け方を見直す）。
/** @type {Record<string, string[]>} */
const SERIES = {
  vivid: ['#6A3DE8', '#F0562E', '#0FA3A3', '#E8A317', '#3D7DD8', '#D6336C', '#5B8C2A', '#8A5A44'],
  koma: ['#1F4FA8', '#E0752B', '#14958A', '#8E4FC2', '#D1A21A', '#C93C6B', '#5B8C2A', '#6B7A99'],
  mergeble: ['#C56A4D', '#3F7F8C', '#D19A2E', '#6B7F3F', '#8A5A8F', '#2F5D8A', '#B5495B', '#7A6A5B'],
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

// 資料（deck）の寸法。A4 横（幅 841.89pt）を 1 とし、紙の幅の比（wide は 960/841.89）を全部の値に掛ける。
// 選ばなかった案:
//   - 小さい紙（A5 横の幅 595pt = 0.71 倍）で字も同じ比に縮める案: 注記の 7.5pt が 5.3pt になり、7pt 未満を作らない決まりを破る。
//     各値に床を持たせ、紙が小さい時は字だけが床で止まる（余白と段は比のまま）。
//   - doc の Theme の欄（size・measure・lineGap・baseline …）を deck では空にして deck だけに値を置く案: lay-text・table・lay-blocks が
//     theme.size・measure・left・lineGap・baseline・fonts を直に読む。資料の本文の大きさで同じ欄を埋めておけば、今の部品を資料の大きさで呼べる。
const DECK_BASE_WIDTH = 841.89
const DECK_MARGIN = { left: 26, right: 26, top: 24, bottom: 22 }
const DECK_GAP = 8
const DECK_COLS = 12
const DECK_LINE_RATIO = 1.6
/** [A4 横での大きさ, 小さい紙での床] */
const DECK_SIZES = {
  cover: [40, 26], coverSub: [16, 11], section: [36, 24], sectionNo: [96, 56], statement: [30, 20], title: [18, 14], lead: [10, 8.5],
  kicker: [8, 7.5], page: [7.5, 7], source: [7, 7], label: [9, 7.5], note: [8, 7.5], kpi: [30, 22], panelTitle: [9, 7.5], panelNote: [7, 7],
}
/**
 * 本文と表は、入らない時に段で下げる（lay-slide の §4.3）。証券会社や金融機関の月次レポートの密度（本文 9.5pt・表 8.5pt）が最初の段。
 * 選ばなかった案:
 *   - 余白が大きい枚で字を上げる段（本文 20〜14pt）: 空きを字の大きさで埋めると、3 つの箇条書きが頁の半分を占める。空きは字でなく panel の数で埋める。
 *   - look を A4 横の幅いっぱいに置く時の拡大（zoom 1.35）: panel の枠（300〜500pt 幅）に look の自然な字の大きさのまま描く。拡大すると枠の中の項目が減る。
 */
const DECK_BODY = [[9.5, 8.5], [9, 8], [8.5, 7.5]]
const DECK_TABLE = [[8.5, 7.5], [8, 7.5], [7.5, 7]]

/**
 * 資料の Theme。doc の Theme と同じ欄を、資料の本文（sans）の大きさと余白で埋め、deck に資料だけの値を足す。
 * @param {{ theme?: string, paper?: string, landscape?: boolean }} o
 * @returns {Theme}
 */
function makeDeckTheme({ theme, paper = 'A4', landscape }) {
  const name = /** @type {ThemeName} */ (theme !== undefined && has(COLORS, theme) ? theme : 'vivid')
  const paperName = has(PAPERS, paper) ? paper : 'A4'
  const [pw, ph] = /** @type {Record<string, number[]>} */ (PAPERS)[paperName]
  // wide は向きを見ない。ほかの紙は、向きの指定が無ければ横（資料は横 A4 が標準）
  const wide = paperName === 'wide'
  const land = wide ? true : landscape === undefined ? true : !!landscape
  const width = wide ? pw : land ? Math.max(pw, ph) : Math.min(pw, ph)
  const height = wide ? ph : land ? Math.min(pw, ph) : Math.max(pw, ph)
  const s = width / DECK_BASE_WIDTH
  /** @param {number[]} v [A4 での値, 床] */
  const fit = (v) => Math.max(v[1], round1(v[0] * s))
  /** @param {Record<string, number[]>} t */
  const pick = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fit(v)]))
  const sizes = /** @type {DeckStyle['sizes']} */ ({ ...pick(DECK_SIZES), body: DECK_BODY.map(fit), table: DECK_TABLE.map(fit) })

  const margin = { left: round1(DECK_MARGIN.left * s), right: round1(DECK_MARGIN.right * s), top: round1(DECK_MARGIN.top * s), bottom: round1(DECK_MARGIN.bottom * s) }
  const gap = round1(DECK_GAP * s)
  const measure = width - margin.left - margin.right
  const colW = (measure - (DECK_COLS - 1) * gap) / DECK_COLS
  const colors = COLORS[name]
  const sz = sizes.body[0]
  const lineGap = sz * DECK_LINE_RATIO
  const lines = Math.floor((height - margin.top - margin.bottom) / lineGap + 1e-9)
  const footY = height - margin.bottom
  const flat = colors.grad.every((c) => c === colors.grad[0])
  /** @param {number} size @returns {HeadStyle} */
  const headStyle = (size) => ({ size, font: 'sansBold', rule: 0, ruleColor: colors.accent, above: 0, below: 0 })

  return {
    name,
    paperName,
    landscape: land,
    page: { width, height },
    size: sz,
    chars: Math.floor(measure / sz + 1e-9),
    measure,
    left: margin.left,
    right: margin.right,
    top: margin.top,
    bottom: margin.bottom,
    lineGap,
    lines,
    // chart（ECharts）の字は 8pt × scale。資料の幅が A4 横より大きい時だけ伸ばし、小さい紙でも縮めない（7pt を割らない）
    scale: Math.max(1, s),
    title: { size: sizes.title, metaSize: sizes.kicker, rule: 3 },
    baseline: (i) => margin.top + i * lineGap + (lineGap - sz) / 2 + BASELINE_RATIO * sz,
    footY,
    fonts: { body: 'sans', bodyBold: 'sansBold', head: 'sansBold', gothic: 'sans', gothicBold: 'sansBold' },
    colors: { ...colors, grad: [...colors.grad] },
    head: { h1: headStyle(sizes.section), h2: headStyle(sizes.title), h3: headStyle(sizes.lead) },
    foot: { size: sizes.page, color: colors.sub, y: footY, ruleY: footY - sizes.page - 3, ruleW: 0.5 },
    kind: 'deck',
    deck: { scale: s, margin, grid: { cols: DECK_COLS, gap, colW }, flat, sizes },
  }
}

/**
 * kind が 'deck' なら資料の Theme（既定は vivid・横・sans）。そうでなければ文書の Theme（既定は mono・縦・明朝）。
 * @param {{ kind?: 'doc'|'deck', theme?: string, body?: string, paper?: string, landscape?: boolean, size?: number }} [opts]
 * @returns {Theme}
 */
export function makeTheme({ kind, theme, body = 'mincho', paper = 'A4', landscape, size } = {}) {
  if (kind === 'deck') return makeDeckTheme({ theme, paper, landscape })
  // 知らない名前は黙って既定に戻す（normalize が先に直すので、ここに来るのは直接呼んだ時だけ）
  const name = /** @type {ThemeName} */ (theme !== undefined && has(COLORS, theme) ? theme : 'mono')
  const paperName = has(PAPERS, paper) ? paper : 'A4'
  const [w, h] = /** @type {Record<string, number[]>} */ (PAPERS)[paperName]
  // wide は向きを見ない（960×540 のまま）
  const width = paperName === 'wide' ? w : landscape ? Math.max(w, h) : Math.min(w, h)
  const height = paperName === 'wide' ? h : landscape ? Math.min(w, h) : Math.max(w, h)

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
    colors: { ...colors, grad: [...colors.grad] },
    head: { h1: headStyle(HEADS.h1), h2: headStyle(HEADS.h2), h3: headStyle(HEADS.h3) },
    foot: { size: FOOT_SIZE, color: colors.sub, y: footY, ruleY: footY - FOOT_RULE_ABOVE, ruleW: 0.5 },
  }
}

/** @param {string} a @param {string} b */
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

/**
 * 図の形（looks）に渡す色（Pal）。theme.colors に、色のテーマなら系列の 8 色（series）を足した物。mono は series を持たない（墨の濃さと点線で分ける）。
 * theme は Theme でも、colors だけを持つ物でも、テーマの名前でもよい。名前が無い時は accent で見分ける（accent が ink と同じなら mono、koma・mergeble・vivid の accent ならその色、
 * どれでもなければ vivid の 8 色）。返す物は新しく作るので、書き換えても theme の色は変わらない。
 * @param {Theme | { colors: Colors, name?: string } | string} theme
 * @returns {Colors & { series?: string[] }}
 */
export function lookPal(theme) {
  const given = typeof theme === 'string' ? theme : theme && typeof theme === 'object' && typeof theme.name === 'string' ? theme.name : undefined
  const name = given !== undefined && has(COLORS, given) ? /** @type {ThemeName} */ (given) : undefined
  const colors = theme && typeof theme === 'object' && theme.colors ? theme.colors : COLORS[name ?? 'mono']
  const out = { ...colors, grad: [...colors.grad] }
  /** @type {string[] | undefined} */
  let series
  if (name !== undefined) series = SERIES[name]
  else if (!sameHex(colors.accent, colors.ink)) series = SERIES[Object.keys(SERIES).find((k) => sameHex(COLORS[/** @type {ThemeName} */ (k)].accent, colors.accent)) ?? 'vivid']
  return series ? { ...out, series: [...series] } : out
}
