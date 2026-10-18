// @ts-check
// pyramid（階層）: 上から下へ広がる段を積んだ三角形。段の右に水平の細い線を引き、名前と説明を右の列に置く。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（既定は頂点の段）・字は面の外の右の列・墨の割合は paper の ALPHA。
// - 段は紙の色の水平の隙間 3pt で分ける。段の左右の辺は 1 本の三角形の辺の上に乗る。
// - 目立たせる 1 つだけが、色のある紙では grad のグラデーション・mono では墨 100%。ほかは頂点の次から底へ少しずつ濃くなる墨の坂。
// 選ばなかった案
// - 段の中に名前を書く案: 頂点の段は三角形の先で字が入らず、濃い面の上に置ける字の色が pal に無い。全部の名前を右の列にそろえる。
// - 段の高さを内容の量に比例させる案: 量の図（mekko・funnel 型）に読める。階層は段の高さを同じにして、順番と包含だけを見せる。
import { ALPHA, LW, TICK, LABEL, inkFill, seriesFill, inkStroke, paints, fillPath, line, circle, textLines, wrap, clip, textWidth, svgDoc, empty, readNamed, hotIndex, ramp, polyline } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ levels: { name: string, note: string }[], hot: number }} PyramidData */

const MAX_LEVELS = 6
const PAD = 12
const GAP = 3
const LEAD = 36

/**
 * @param {unknown} data { levels: { name, note? }[2..6]（上から）, highlight?: 名前か 0 からの位置 }
 * @returns {{ data: PyramidData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const levels = readNamed(src.levels, '階層', 'levels', warnings, { min: 2, max: MAX_LEVELS })
  const hot = levels.length ? hotIndex(src.highlight, levels.map((s) => s.name), 0, warnings, '階層') : -1
  return { data: { levels, hot }, warnings }
}

/**
 * 三角形と右の列の大きさ。lh は段 1 つの高さ（H が有限ならそれに収める）。札の行数は lh に入るまで減らす
 * @param {PyramidData} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const n = data.levels.length
  const bw = Math.max(110, Math.min(W * 0.36, 280))
  const labelW = Math.max(90, Math.min(260, W - 2 * PAD - bw - LEAD))
  const natural = data.levels.map((s) => {
    const names = wrap(s.name, LABEL, labelW, 2, true)
    const notes = s.note ? wrap(s.note, TICK, labelW, 2) : []
    return { names, notes, h: names.length * 11 + (notes.length ? 3 + notes.length * 11 : 0) }
  })
  const need = n * (Math.max(...natural.map((b) => b.h)) + 6) + 2 * PAD
  const lh = Number.isFinite(H) ? Math.max(14, (H - 2 * PAD) / n) : need / n - (2 * PAD) / n
  const blocks = data.levels.map((s, i) => {
    let { names, notes } = natural[i]
    const h = () => names.length * 11 + (notes.length ? 3 + notes.length * 11 : 0)
    if (h() > lh - 4 && notes.length > 1) notes = wrap(s.note, TICK, labelW, 1)
    if (h() > lh - 4 && names.length > 1) names = wrap(s.name, LABEL, labelW, 1, true)
    if (h() > lh - 4) notes = []
    return { names, notes, h: h() }
  })
  return { n, bw, labelW, lh, blocks, need }
}

/**
 * @param {PyramidData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (data.levels.length < 2) return empty(o)
  const g = paints(pal)
  const { n, bw, labelW, lh, blocks } = plan(data, W, H)
  const ph = n * lh
  const top = (H - ph) / 2
  const used = Math.min(labelW, Math.max(...blocks.flatMap((b) => [...b.names.map((l) => textWidth(l, LABEL, true)), ...b.notes.map((l) => textWidth(l, TICK))])))
  const x0 = Math.max(PAD, (W - (bw + LEAD + used)) / 2)
  const cx = x0 + bw / 2
  const labelX = x0 + bw + LEAD
  /** 高さ y での三角形の半幅 @param {number} y */
  const hw = (y) => ((y - top) / ph) * (bw / 2)

  /** @type {string[]} */
  const parts = []
  const soft = ramp(Math.max(1, n - 1), 0.1, 0.36)
  data.levels.forEach((_, i) => {
    const y0 = top + i * lh + (i === 0 ? 0 : GAP / 2)
    const y1 = top + (i + 1) * lh - (i === n - 1 ? 0 : GAP / 2)
    const pts = /** @type {[number, number][]} */ ([[cx - hw(y0), y0], [cx + hw(y0), y0], [cx + hw(y1), y1], [cx - hw(y1), y1]])
    const isHot = i === data.hot
    const fill = isHot ? g.linear(cx - hw(y1), y0, cx + hw(y1), y1, 1, 1) : seriesFill(pal, i, data.hot) ?? inkFill(pal, soft[Math.min(i - (data.hot < i ? 1 : 0), soft.length - 1)] ?? soft[0])
    parts.push(fillPath(polyline(pts, true), fill))
    const ym = (y0 + y1) / 2
    const ex = cx + hw(ym)
    parts.push(line(ex + 3, ym, labelX - 8, ym, inkStroke(pal, ALPHA.last, LW.hair)))
    parts.push(circle(ex + 3, ym, 2, inkFill(pal, 1)))
    const b = blocks[i]
    const t = ym - b.h / 2
    parts.push(textLines(labelX, t + 8, b.names.map((l) => clip(l, LABEL, labelW, true)), { size: LABEL, fill: isHot ? pal.accent : pal.ink, bold: true, leading: 11 }))
    if (b.notes.length) parts.push(textLines(labelX, t + 8 + b.names.length * 11 + 3, b.notes, { size: TICK, fill: pal.sub, leading: 11 }))
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 事業の価値の階層（見本）。目立たせる 1 つは頂点の「使命」 */
function sample() {
  return {
    levels: [
      { name: '使命', note: '中小企業の仕事から待ち時間をなくす' },
      { name: '戦略', note: '請求と入金の確認を、自動で終わらせる' },
      { name: '製品', note: '請求書の発行から入金の消し込みまでを 1 つにする' },
      { name: '運用', note: '導入の支援と、毎月の見直しの面談' },
      { name: '基盤', note: '銀行・会計ソフトとの連携と、安全な保管' },
    ],
  }
}

export default {
  id: 'pyramid',
  title: '階層（Pyramid）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {PyramidData} */ data) => Math.max(Math.round(width * 0.4), data.levels.length >= 2 ? Math.ceil(plan(data, width, Infinity).need) : 0),
  sample,
}
