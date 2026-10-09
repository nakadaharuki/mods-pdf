// @ts-check
// 欄（Pane）の木と大きさ。純な部品。部品の表 t（本体が受け取る Box・Text・Button・Svg）と、押した時の処理 act を受ける。
// 選ばなかった案: 頁の SVG を isInteractive にする案。付けると中身が替わるたびに欄が真っ黒になった（mods-trade の学び）。
// 選ばなかった案: 欄の大きさを ui.open の rows・columns で決める案。デスクトップは受け取るだけで使わないので、
// 桁と行から頁の縦横比を保った一番大きな大きさを自分で出し、Svg の width・height で渡す。

/** デスクトップの欄の 1 マス（CSS ピクセル）。mods-trade が本人の画面で測った値。少し小さめに見積もる（はみ出すと絵が切れる） */
export const PANE_CELL = { w: 7.9, h: 19.6 }
/** 絵の上の 1 行と下のボタンの 1 行 */
const CHROME_ROWS = 2
const DEFAULT_COLS = 54
const DEFAULT_ROWS = 32

/** 欄に頼む桁。デスクトップの欄の幅はこれで決まり、行は頁の縦横比に合わせて変える */
export const PANE_COLUMNS = 54
/** 頼む行の下限。横長の頁（16:9）でも絵と上下の 1 行ずつが入る */
const PANE_ROWS_MIN = 12
/** 縦長の頁（A4 縦 = 33 行）を上限にする */
const PANE_ROWS_MAX = 33

/**
 * 欄に頼む大きさ。幅は 54 桁に固定し、行は頁の縦横比で出す（A4 縦 33 行・A4 横 18 行・16:9 は 15 行）。
 * 選ばなかった案: 縦の決め打ち 33 行のまま横長の頁を出す案。横長の頁は幅 54 桁で高さが半分しか要らず、下が空いた欄になる。
 * @param {number} pageW 頁の幅（pt）
 * @param {number} pageH 頁の高さ（pt）
 * @returns {{ rows: number, columns: number }}
 */
export function paneSizeFor(pageW, pageH) {
  const pw = pageW > 0 ? pageW : 595.28
  const ph = pageH > 0 ? pageH : 841.89
  const W = PANE_COLUMNS * PANE_CELL.w - 4
  const rows = Math.ceil(((W * ph) / pw + 6) / PANE_CELL.h) + CHROME_ROWS
  return { rows: Math.min(PANE_ROWS_MAX, Math.max(PANE_ROWS_MIN, rows)), columns: PANE_COLUMNS }
}

/**
 * 欄の桁と行から、頁の縦横比を保った一番大きな大きさ（CSS ピクセル）。
 * 欄が見積もりより大きければ余白が残り、小さければ SVG の viewBox が比を保って縮める（どちらも中央）
 * @param {number} cols
 * @param {number} rows
 * @param {number} pageW 頁の幅（pt）
 * @param {number} pageH 頁の高さ（pt）
 * @returns {{ w: number, h: number }}
 */
export function paneBox(cols, rows, pageW, pageH) {
  const c = Number.isFinite(cols) && cols > 0 ? cols : DEFAULT_COLS
  const r = Number.isFinite(rows) && rows > 0 ? rows : DEFAULT_ROWS
  const W = Math.max(160, c * PANE_CELL.w - 4)
  const H = Math.max(220, (r - CHROME_ROWS) * PANE_CELL.h - 6)
  const pw = pageW > 0 ? pageW : 595.28
  const ph = pageH > 0 ? pageH : 841.89
  const k = Math.min(W / pw, H / ph)
  return { w: Math.floor(pw * k), h: Math.floor(ph * k) }
}

/** 値の無い（undefined）項目は部品に渡さない（engine の決まりに引っかからないように） */
function strip(/** @type {any} */ raw) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const k of Object.keys(raw)) {
    const make = raw[k]
    out[k] = typeof make === 'function' ? (/** @type {any} */ props = {}) => make(Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined))) : make
  }
  return out
}

/**
 * @typedef {{
 *   surface: string,
 *   cols: number,
 *   rows: number,
 *   doc: { title: string, path: string, pages: number } | null,
 *   deck?: boolean,
 *   page: number,
 *   svg: string | null,
 *   pageW: number,
 *   pageH: number,
 *   fonts: { loaded: number, total: number, ms: number | null, error: string | null },
 *   note: string | null,
 *   busy: boolean,
 * }} PaneModel
 * @typedef {{ prev: () => void, next: () => void, open: () => void, sample: () => void, sampleDeck?: () => void }} PaneActions
 */

/** 書体の読み込みの様子を 1 つの字に */
export function fontsLine(/** @type {PaneModel['fonts']} */ f) {
  if (f.error) return `書体を読めません: ${f.error}`
  if (f.loaded < f.total) return `書体を読み込み中 ${f.loaded}/${f.total}`
  return f.ms === null ? '書体 読み込み済み' : `書体の読み込み ${(f.ms / 1000).toFixed(1)} 秒`
}

const text = (/** @type {any} */ t, /** @type {string} */ s, /** @type {Record<string, any>} */ props = {}) => t.Text({ wrap: 'truncate-end', ...props, children: [s] })
const row = (/** @type {any} */ t, /** @type {any[]} */ children, /** @type {Record<string, any>} */ props = {}) => t.Box({ flexDirection: 'row', ...props, children: children.filter(Boolean) })
const column = (/** @type {any} */ t, /** @type {any[]} */ children, /** @type {Record<string, any>} */ props = {}) => t.Box({ flexDirection: 'column', ...props, children: children.filter(Boolean) })

/**
 * 欄の木。文書があれば頁（デスクトップは Svg・端末は字）と下のボタンの行、無ければ案内と「見本を作る」
 * @param {any} raw 本体が ui.resolve で得た部品の表（Box・Text・Button・Svg）
 * @param {PaneModel} m
 * @param {PaneActions} act
 * @returns {any}
 */
export function paneTree(raw, m, act) {
  const t = strip(raw)
  const terminal = m.surface === 'terminal'
  const f = fontsLine(m.fonts)
  if (!m.doc) {
    return column(t, [
      text(t, 'まだ文書がありません。'),
      text(t, 'Claude に「〇〇を PDF にして」と頼むか、見本を作ってください。'),
      m.note ? text(t, m.note) : null,
      t.Button({ key: 'pdf:sample', label: m.busy ? '見本を組んでいます…' : '見本を作る', onPress: () => act.sample() }),
      act.sampleDeck ? t.Button({ key: 'pdf:sample-deck', label: '資料（事業計画）の見本を作る', onPress: () => act.sampleDeck?.() }) : null,
      text(t, f, { dimColor: true }),
    ], { paddingX: 1 })
  }
  const pages = m.doc.pages
  const at = Math.min(Math.max(0, m.page), Math.max(0, pages - 1))
  const first = at <= 0
  const last = at >= pages - 1
  // 資料は 1 枚ずつ送る（1 枚 = 1 頁）。キーは文書と同じ
  const unit = m.deck ? '枚' : '頁'
  const buttons = row(t, [
    t.Button({ key: 'pdf:prev', label: `前の${unit}`, dimColor: first ? true : undefined, onPress: () => act.prev() }),
    text(t, `${at + 1} / ${pages}`),
    t.Button({ key: 'pdf:next', label: `次の${unit}`, dimColor: last ? true : undefined, onPress: () => act.next() }),
    t.Button({ key: 'pdf:open', label: '開く', onPress: () => act.open() }),
  ], { justifyContent: 'space-between', columnGap: 1, height: 1, overflow: 'hidden', paddingX: 1 })

  if (terminal || !m.svg) {
    // 端末は Svg を描けない。同じ中身を字で（題名・頁数・場所）
    return column(t, [
      text(t, m.doc.title, { bold: true }),
      text(t, `${m.doc.path}・${pages} 頁`),
      text(t, m.note ?? f, { dimColor: true }),
      buttons,
    ], { paddingX: 1 })
  }
  const size = paneBox(m.cols, m.rows, m.pageW, m.pageH)
  const top = text(t, m.note ? `${m.doc.title} ・ ${m.note}` : `${m.doc.title} ・ ${m.doc.path} ・ ${f}`, { dimColor: true })
  const sheet = t.Svg({ source: m.svg, alt: `${m.doc.title} の ${at + 1} / ${pages} ${unit}`, width: size.w, height: size.h })
  // 横長の頁は欄より背が低いので、縦にも中央に置く（上に寄せると下が空いた欄になる）
  return column(t, [
    row(t, [top], { height: 1, overflow: 'hidden', paddingX: 1 }),
    t.Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', children: [sheet] }),
    buttons,
  ])
}
