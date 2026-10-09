// @ts-check
// cycle（循環）: 太い輪を 3〜8 の矢羽根に分けて時計回りに並べ、輪の左右に番号・名前・説明を置く。真ん中には、輪が回すもの（center）の字。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（既定は最初の段）・字は輪の外（濃い面の上に置ける字の色が pal に無い）・墨の割合は paper の ALPHA。
// - 矢羽根の尖りは次の羽根の切れ込みに入る（process と同じ。隙間 3pt が一周とも同じ幅で空く）。
// - 目立たせる 1 つだけが、色のある紙では grad のグラデーション・mono では墨 100%。ほかは最初の段の次から少しずつ濃くなる墨の坂（回る向きが分かる）。
// 選ばなかった案
// - 輪を扇形の円グラフ風に分ける案: 大きさが量に読める。同じ幅の羽根にして、量でなく順番の図にする。
// - 輪の上に反時計回りの矢印の線を重ねる案: 線が増える。羽根の尖りが向きを示す。
import { ALPHA, LW, TICK, LABEL, inkFill, inkStroke, paints, fillPath, strokePath, text, textLines, wrap, clip, svgDoc, empty, readNamed, hotIndex, strOf, ramp, dodge, polyline, f } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ center: string, steps: { name: string, note: string }[], hot: number }} CycleData */

const MAX_STEPS = 8
const PAD = 12
const GAP = 3
const TIP = 10
const NUM_W = 16
const LEAD = 22

/**
 * @param {unknown} data { center?, steps: { name, note? }[3..8], highlight?: 名前か 0 からの位置 }
 * @returns {{ data: CycleData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const steps = readNamed(src.steps, '循環', 'steps', warnings, { min: 3, max: MAX_STEPS })
  const hot = steps.length ? hotIndex(src.highlight, steps.map((s) => s.name), 0, warnings, '循環') : -1
  return { data: { center: strOf(src.center), steps, hot }, warnings }
}

/**
 * 輪の大きさと札の折り返し。H が有限なら輪を高さに収める
 * @param {CycleData} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const labelW = Math.max(70, Math.min(210, W * 0.24))
  let r1 = Math.max(34, Math.min(112, (W - 2 * PAD - 2 * (labelW + LEAD)) / 2))
  if (Number.isFinite(H)) r1 = Math.max(24, Math.min(r1, (H - 2 * PAD) / 2))
  const thick = Math.max(12, Math.min(30, r1 * 0.3))
  const textW = labelW - NUM_W
  const blocks = data.steps.map((s) => {
    const names = wrap(s.name, LABEL, textW, 2, true)
    const notes = s.note ? wrap(s.note, TICK, textW, 2) : []
    return { names, notes, h: names.length * 11 + (notes.length ? 3 + notes.length * 11 : 0) + 2 }
  })
  const n = data.steps.length
  const mids = data.steps.map((_, i) => -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n)
  const side = mids.map((a) => (Math.cos(a) >= 0 ? 1 : -1))
  const stack = [1, -1].map((s) => blocks.reduce((sum, b, i) => (side[i] === s ? sum + b.h + 6 : sum), 0))
  return { labelW, r1, r0: r1 - thick, textW, blocks, mids, side, need: Math.max(2 * r1 + 2 * PAD, Math.max(...stack) + 2 * PAD) }
}

/**
 * @param {CycleData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  const n = data.steps.length
  if (n < 3) return empty(o)
  const g = paints(pal)
  const { r1, r0, textW, blocks, mids, side } = plan(data, W, H)
  const cx = W / 2
  const cy = H / 2
  const rm = (r0 + r1) / 2
  const gap = GAP / rm
  const tip = Math.min(TIP / rm, (2 * Math.PI) / n / 2)
  /** @param {number} r @param {number} a */
  const P = (r, a) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`

  /** @type {string[]} */
  const parts = []
  const soft = ramp(Math.max(1, n - 1), 0.1, 0.36)
  data.steps.forEach((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const s = a + gap / 2
    const e = a + (2 * Math.PI) / n - gap / 2 + tip
    const d = `M${P(r1, s)}A${f(r1)} ${f(r1)} 0 0 1 ${P(r1, e - tip)}L${P(rm, e)}L${P(r0, e - tip)}A${f(r0)} ${f(r0)} 0 0 0 ${P(r0, s)}L${P(rm, s + tip)}Z`
    const isHot = i === data.hot
    const k = (i - data.hot + n) % n
    const fill = isHot
      ? g.linear(cx + rm * Math.cos(s), cy + rm * Math.sin(s), cx + rm * Math.cos(e), cy + rm * Math.sin(e), 1, 1)
      : inkFill(pal, soft[Math.min(Math.max(0, k - 1), soft.length - 1)])
    parts.push(fillPath(d, fill))
  })

  // 輪の真ん中: 輪が回すもの
  const inner = r0 - 8
  if (data.center && inner > 22) {
    const lines = wrap(data.center, LABEL, inner * 1.5, 3, true)
    const lh = 12
    parts.push(textLines(cx, cy - ((lines.length - 1) * lh) / 2 + 3, lines, { size: LABEL, fill: pal.ink, bold: true, anchor: 'middle', leading: lh }))
  }

  // 札: 輪の外の左右の列。高さは輪の中心の向きを目安に、重ならないよう押し分ける
  const lo = PAD
  for (const s of [1, -1]) {
    const idx = data.steps.map((_, i) => i).filter((i) => side[i] === s)
    if (!idx.length) continue
    const gapY = Math.max(...idx.map((i) => blocks[i].h)) + 6
    const want = idx.map((i) => cy + (r1 + 12) * Math.sin(mids[i]))
    const ys = dodge(want, gapY, lo + gapY / 2, H - PAD - gapY / 2)
    const colX = s === 1 ? cx + r1 + LEAD : cx - r1 - LEAD
    idx.forEach((i, k) => {
      const b = blocks[i]
      const isHot = i === data.hot
      const top = ys[k] - b.h / 2
      const anchor = s === 1 ? 'start' : 'end'
      const numX = colX
      const nameX = s === 1 ? colX + NUM_W : colX - NUM_W
      const sx = cx + (r1 + 3) * Math.cos(mids[i])
      const sy = cy + (r1 + 3) * Math.sin(mids[i])
      const bx = cx + (r1 + 9) * Math.cos(mids[i])
      const by = cy + (r1 + 9) * Math.sin(mids[i])
      parts.push(strokePath(polyline([[sx, sy], [bx, by], [colX - s * 6, ys[k]]]), inkStroke(pal, ALPHA.last, LW.hair)))
      parts.push(text(numX, top + 8, String(i + 1).padStart(2, '0'), { size: TICK, fill: isHot ? pal.accent : pal.sub, anchor }))
      parts.push(textLines(nameX, top + 8, b.names.map((l) => clip(l, LABEL, textW, true)), { size: LABEL, fill: isHot ? pal.accent : pal.ink, bold: true, anchor, leading: 11 }))
      if (b.notes.length) parts.push(textLines(nameX, top + 8 + b.names.length * 11 + 3, b.notes, { size: TICK, fill: pal.sub, anchor, leading: 11 }))
    })
  }
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 顧客を増やし続ける仕組みの循環（見本）。目立たせる 1 つは最初の「見つけてもらう」 */
function sample() {
  return {
    center: '顧客が増え続ける仕組み',
    steps: [
      { name: '見つけてもらう', note: '検索と紹介で知られる' },
      { name: '試してもらう', note: '14 日間は無料で使える' },
      { name: '成果を出す', note: '最初の 1 か月で効果が見える' },
      { name: '続けてもらう', note: '毎月の見直しで使い続けられる' },
      { name: '広めてもらう', note: '満足した顧客が次の会社を紹介する' },
    ],
  }
}

export default {
  id: 'cycle',
  title: '循環（Cycle）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {CycleData} */ data) => Math.max(Math.round(width * 0.44), data.steps.length >= 3 ? Math.ceil(plan(data, width, Infinity).need) : 0),
  sample,
}
