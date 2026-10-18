// @ts-check
// funnel（ファネル）: 段ごとの数を、中央にそろえた横棒で上から並べる。棒の幅は 1 つの尺度で、数に比例する。段と段の間に、変換の割合を書いた薄い台形を置く。
// 元は look の designs/funnel.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり（元の頭の文のとおり）: 棒は 1 段の高さ（スロット）の 62% で、墨の 25%（面の塗りの段）。本体の 55% にしないのは、幅の広い墨の板が 5 本並ぶと
// ほかの絵より目立つため。残りの 38% に、上の棒と下の棒をつなぐ墨 8% の台形を置き、その段の変換の割合を書く。
// いちばん多く失う段（前の段に対する割合がいちばん小さい段）だけを「下げ」の色にする（台形は 25%・字は下げの色）。
//
// 紙に写して変えた所
// - 色のテーマ（pal.series がある紙）では、段の棒を段ごとの系列の色で塗り、段の間の台形は上の段の色の薄い塗りにする。いちばん多く失う段の台形は pal.down のまま。
// - 暗い地は塗らない。下げの色は pal.down（mono でも赤。上げ下げは paper 全体で同じ色）。
// - 元の「LOST 4,000」は「離脱 4,000」（en は Lost）。台形の右の横に置き、右に入らなければ左、どちらにも入らなければ書かない（数を「…」で切ると別の数に読めるため）。値は棒の右の列に太字で、名前は左の列に置く（幅はそれぞれ字の幅に合わせる）。
// - 下の右の注記は、元の「PAID 9.3% OF INSTALLS」を「最後の段 9.3%（最初の段比）」にした（data に「何が最後か」の語が無いので、段の名前で書く）。
// - 段の高さは高さから決める。30pt 未満になる時は、棒を 62% でなく「段 − 11pt」にして、台形の中の割合の字（7.5pt）が棒に重ならない高さを残す。
// - 段は 12 までで、超えた分は先頭から 12 だけ描いて warnings に書く（段は並びが意味を持つので、まとめない）。
// 選ばなかった案
// - 棒の幅を最初の段の値で割る案: 後の段が最初より大きい data（誤り）で棒が band を超える。最大の値で割る。
// - 台形の中でなく棒の右に割合を書く案: 台形がその段の変換を表すので、台形の中に書くほうが読み手の目が動かない。
import { ALPHA, TICK, LABEL, VALUE, inkFill, fillAttr, seriesFill, text, rect, fillPath, svgDoc, empty, num, percent, textWidth, clip, tr, keep, midline, f, decimals, unitNote } from './paper.mjs'
import { readItems, labelOf } from './parts-kit.mjs'

const MAX_ROWS = 12
const TOP = 10
const FOOT = 20
const PAD = 8

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, value: number, other?: boolean }} Row */
/** @typedef {{ rows: Row[], unit: string }} FunnelData */

/**
 * @param {unknown} data { items: { name, value }[]（上の段から）, unit? }
 * @returns {{ data: FunnelData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const { rows, unit } = readItems(src, 'ファネル', warnings)
  return { data: { rows: keep(rows, MAX_ROWS, warnings, 'ファネル: 段'), unit }, warnings }
}

/**
 * @param {FunnelData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal, lang } = o
  const rows = data.rows
  if (!rows.length) return empty(o)
  const n = rows.length
  const digits = decimals(rows.map((r) => r.value))
  const max = Math.max(...rows.map((r) => r.value))

  // 左に名前・右に値の列。棒の band は残りの幅（最小 60pt）
  const names = rows.map((r) => labelOf(r, lang))
  const vals = rows.map((r) => num(r.value, digits))
  const valW = Math.max(...vals.map((s) => textWidth(s, VALUE, true)))
  const nameCap = Math.max(24, Math.min(W * 0.26, W - 2 * PAD - valW - 28 - 60))
  const nameW = Math.min(nameCap, Math.max(...names.map((s) => textWidth(s, LABEL))))
  const left = PAD + nameW + 14
  const right = W - PAD - valW - 14
  const cx = (left + right) / 2
  const half = (/** @type {number} */ v) => (((right - left) * v) / max) / 2

  const slot = (H - TOP - FOOT) / n
  const bar = slot >= 29 ? slot * 0.62 : Math.max(8, slot - 11)
  const barY = (/** @type {number} */ i) => TOP + i * slot

  // いちばん多く失う段: 前の段に対する割合がいちばん小さい段（失っていなければ無い）
  let worst = -1
  for (let i = 1; i < n; i++) {
    const ratio = rows[i].value / rows[i - 1].value
    if (ratio < 1 && (worst < 0 || ratio < rows[worst].value / rows[worst - 1].value)) worst = i
  }

  /** @type {string[]} */
  const parts = []
  rows.forEach((r, i) => {
    const y = barY(i)
    if (i > 0) {
      const a = half(rows[i - 1].value)
      const b = half(r.value)
      const y0 = barY(i - 1) + bar
      const bad = i === worst
      const d = `M${f(cx - a)} ${f(y0)}L${f(cx + a)} ${f(y0)}L${f(cx + b)} ${f(y)}L${f(cx - b)} ${f(y)}Z`
      parts.push(fillPath(d, bad ? fillAttr(pal.down, ALPHA.area) : (seriesFill(pal, i - 1, -1, 0.18) ?? inkFill(pal, ALPHA.faint))))
      const mid = (y0 + y) / 2
      parts.push(text(cx, midline(mid, TICK), percent(r.value / rows[i - 1].value), { size: TICK, fill: bad ? pal.down : pal.sub, anchor: 'middle' }))
      if (bad) {
        const lost = `${tr(lang, '離脱', 'Lost')} ${num(rows[i - 1].value - r.value, digits)}`
        // 台形の右に置く。入らなければ左、どちらにも入らなければ書かない（数を「…」で切ると別の数に読める）
        const w = textWidth(lost, TICK)
        if (cx + a + 8 + w <= W - PAD) parts.push(text(cx + a + 8, midline(mid, TICK), lost, { size: TICK, fill: pal.down }))
        else if (cx - a - 8 - w >= PAD) parts.push(text(cx - a - 8, midline(mid, TICK), lost, { size: TICK, fill: pal.down, anchor: 'end' }))
      }
    }
    parts.push(rect(cx - half(r.value), y, 2 * half(r.value), bar, seriesFill(pal, i, -1, 0.85) ?? inkFill(pal, ALPHA.area)))
    parts.push(text(PAD, midline(y + bar / 2, LABEL), clip(names[i], LABEL, nameW + 4), { size: LABEL, fill: pal.ink }))
    parts.push(text(W - PAD, midline(y + bar / 2, VALUE), vals[i], { size: VALUE, fill: pal.ink, anchor: 'end', bold: true }))
  })

  const note = unitNote(data.unit, lang)
  if (note) parts.push(text(PAD, H - 4, note, { size: TICK, fill: pal.sub }))
  if (n > 1) {
    const room = W - 2 * PAD - (note ? textWidth(note, TICK) + 16 : 0)
    // 切るのは名前だけ。割合は、名前が長くても最後まで残す
    const cap = Math.max(24, (room - 70) / 2)
    const first = clip(names[0], TICK, cap)
    const last = clip(names[n - 1], TICK, cap)
    const s = tr(lang, `${last} ${percent(rows[n - 1].value / rows[0].value)}（${first}比）`, `${last} ${percent(rows[n - 1].value / rows[0].value)} of ${first}`)
    parts.push(text(W - PAD, H - 4, s, { size: TICK, fill: pal.sub, anchor: 'end' }))
  }
  return svgDoc(W, H, parts.join(''))
}

/** 元の見本（8,200 から 760 までの 5 段。87%・83%・32%・40%・最後は 9.3%）の数のまま、名前だけを会員制サービスの話に直した */
function sample() {
  return {
    items: [
      { name: '来場者', value: 8200 },
      { name: '会員登録', value: 7100 },
      { name: '初回購入', value: 5900 },
      { name: '再購入', value: 1900 },
      { name: '定期契約', value: 760 },
    ],
    unit: '人',
  }
}

export default {
  id: 'funnel',
  title: 'ファネル（Funnel）',
  category: 'parts',
  normalize,
  draw,
  height: (/** @type {number} */ _width, /** @type {{ rows?: Row[] } | undefined} */ data) => TOP + Math.max(1, data?.rows?.length ?? 5) * 36 + FOOT,
  sample,
}
