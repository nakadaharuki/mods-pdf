// @ts-check
// market（市場規模 TAM・SAM・SOM）: 底をそろえた入れ子の円。円の頂点から右へ細い線を引き、右の列に名前・値（20pt）・説明・全体に対する割合を置く。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（取りにいく市場 SOM = いちばん内側）・値は右の列・字は paper の段。
// - 外の 2 つは墨の薄い面（8%・16%）と細い縁。SOM だけが、色のある紙では grad の面・mono では墨 100%。
// - 円の大きさは面積比を土台にしつつ、内側が点にならないよう下限（2 番目 0.62・3 番目 0.34 の半径比）を置く。下限が効いた時は図の下に「円の大きさは目安です」と書く。
// 選ばなかった案
// - 円の中に値を書く案: 内側の円が小さく入らない。mono の SOM は墨 100% で、その上に置ける字の色が pal に無い。値は右の列にそろえる。
// - 円を中心をそろえた同心円にする案: 3 つの円の縁が近づき、頂点の線の置き場が詰まる。底をそろえると頂点が縦に離れ、右の列の 3 つの札が重ならない。
import { ALPHA, LW, TICK, LABEL, HUGE, inkFill, seriesFill, inkStroke, paints, circle, strokePath, text, textLines, wrap, clip, textWidth, svgDoc, empty, tr, strOf, numOf, keep, plain, withUnit, percent, dodge, f } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, note: string }} Item */

const MAX_ITEMS = 3
/** 円の半径比の下限（外から数えて 2 番目・3 番目） */
const FLOORS = [1, 0.62, 0.34]
const LABEL_H = 62

/**
 * @param {unknown} data { items: { name, value, note? }[2..3]（外側から）, unit? }
 * @returns {{ data: { items: Item[], unit: string }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.items)) warnings.push('市場規模: items（{ name, value, note? } の列）がありません')
  /** @type {Item[]} */
  let items = []
  let bad = 0
  for (const it of Array.isArray(src.items) ? src.items : []) {
    const value = it && typeof it === 'object' ? numOf(it.value) : NaN
    const name = it && typeof it === 'object' ? strOf(it.name) : ''
    if (!(value > 0) || !name) { bad++; continue }
    items.push({ name, value, note: strOf(it.note) })
  }
  if (bad) warnings.push(`市場規模: 名前と 0 より大きい値（1,000 兆以下）が読めない項目 ${bad} 個を捨てました`)
  items = keep(items, MAX_ITEMS, warnings, '市場規模: 項目')
  if (items.length === 1) { warnings.push('市場規模: 項目は 2 個以上要ります'); items = [] }
  // 外側ほど大きいはず。逆なら大きい順に直す
  if (items.some((it, i) => i > 0 && it.value > items[i - 1].value)) {
    items = [...items].sort((a, b) => b.value - a.value)
    warnings.push('市場規模: 値が大きい順でないので、大きい順（外側から）に並べ直しました')
  }
  return { data: { items, unit: typeof src.unit === 'string' ? src.unit.trim() : '' }, warnings }
}

/** 半径の比（先頭は 1）。下限が効いたか @param {Item[]} items */
function ratios(items) {
  let floored = false
  /** @type {number[]} */
  const k = []
  items.forEach((it, i) => {
    if (i === 0) { k.push(1); return }
    const area = Math.sqrt(it.value / items[0].value)
    const want = Math.max(area, FLOORS[Math.min(i, FLOORS.length - 1)])
    if (want > area + 1e-9) floored = true
    k.push(Math.min(want, k[i - 1] - 0.14))
  })
  return { k, floored }
}

/**
 * @param {{ items: Item[], unit: string }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const items = data.items
  const n = items.length
  if (n < 2) return empty(o)
  const g = paints(pal)
  const pad = 12
  const { k, floored } = ratios(items)
  const foot = floored ? 16 : 0
  const R = Math.max(20, Math.min((H - 2 * pad - foot) / 2, (W - 2 * pad - 36 - 150) / 2, W * 0.2))
  const labelW = Math.max(110, Math.min(260, W - 2 * pad - 2 * R - 36))
  // 円と札の組を、札の字の実際の幅で真ん中に置く（札の枠いっぱいで測ると左に寄って見える）
  const used = Math.min(labelW, Math.max(...items.map((it) => Math.max(textWidth(it.name, LABEL, true), textWidth(withUnit(plain(it.value), data.unit), HUGE), it.note ? textWidth(it.note, TICK) : 0))))
  const x0 = Math.max(pad, (W - (2 * R + 36 + used)) / 2)
  const cx = x0 + R
  const labelX = cx + R + 36
  const yb = (H - foot) / 2 + R
  const radii = k.map((v) => v * R)
  const tops = radii.map((r) => yb - 2 * r)

  /** @type {string[]} */
  const parts = []
  const edge = inkStroke(pal, ALPHA.edge, LW.hair)
  radii.forEach((r, i) => {
    const hot = i === n - 1
    const fill = hot ? g.linear(cx - r, yb - 2 * r, cx + r, yb, 1, 1) : seriesFill(pal, i + 1, 0) ?? inkFill(pal, i === 0 ? ALPHA.faint : ALPHA.card - 0.02)
    parts.push(circle(cx, yb - r, r, hot ? fill : `${fill} ${edge}`))
  })

  // 右の列の札は、頂点の高さを目安に、重ならない高さへ押し分ける
  const ly = dodge(tops, LABEL_H, pad + 8, H - pad - foot - LABEL_H + 6)
  items.forEach((it, i) => {
    const y = tops[i]
    const hot = i === n - 1
    const bend = labelX - 20
    const link = `M${f(cx)} ${f(y)}L${f(bend)} ${f(y)}L${f(bend + 10)} ${f(ly[i])}L${f(labelX - 6)} ${f(ly[i])}`
    parts.push(strokePath(link, inkStroke(pal, ALPHA.last, LW.hair)))
    parts.push(circle(cx, y, 2.5, inkFill(pal, 1)))
    parts.push(text(labelX, ly[i] + 3, clip(it.name, LABEL, labelW), { size: LABEL, fill: hot ? pal.accent : pal.ink, bold: true }))
    parts.push(text(labelX, ly[i] + 27, clip(withUnit(plain(it.value), data.unit), HUGE, labelW), { size: HUGE, fill: pal.ink }))
    const sub = [...(it.note ? wrap(it.note, TICK, labelW, 1) : []), ...(i > 0 ? [tr(lang, `全体の ${percent(it.value / items[0].value)}`, `${percent(it.value / items[0].value)} of total`)] : [])]
    parts.push(textLines(labelX, ly[i] + 40, sub, { size: TICK, fill: pal.sub, leading: 11 }))
  })
  if (floored) parts.push(text(pad, H - 6, tr(lang, '円の大きさは目安です（面積の比ではありません）', 'Circle sizes are approximate, not to scale'), { size: TICK, fill: pal.sub }))
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 国内の中小企業向けの業務ソフトの市場（見本。架空の数） */
function sample() {
  return {
    items: [
      { name: 'TAM 市場全体', value: 12400, note: '国内の中小企業向け業務ソフト全体' },
      { name: 'SAM 狙える市場', value: 3100, note: '従業員 10〜99 人の会社' },
      { name: 'SOM 取れる市場', value: 310, note: '3 年で獲得をめざす顧客' },
    ],
    unit: '億円',
  }
}

export default {
  id: 'market',
  title: '市場規模（TAM・SAM・SOM）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ items: Item[] }} */ data) => Math.max(Math.round(width * 0.46), data.items.length * LABEL_H + 40),
  sample,
}
