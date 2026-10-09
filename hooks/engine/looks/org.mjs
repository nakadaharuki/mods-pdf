// @ts-check
// org（体制図）: 上に代表、その下に横一列の部門、各部門の下に縦に並ぶ担当。線は細い 1 本の幹と短い枝だけで、札の枠は描かない。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（代表）・字は paper の段・墨の割合は paper の ALPHA。
// - 代表は、色のある紙では grad の短い棒（36 x 3pt）と accent の名前（BIG）・mono では墨 100% の棒。部門の名前は LABEL の太字・担当の名前は LABEL。役割は TICK の sub。
// - 段は 3 つまで（代表・部門・担当）。部門は 7 つ・全部で 30 人までで、超えた分は捨てて warnings に書く。
// 選ばなかった案
// - 札に枠を描く案: 枠の線が人の数だけ増え、30 人では線の方が目立つ。字と細い幹だけで段を示す。
// - 部門の下の担当も横に並べる案: 30 人を横に並べると 1 人の幅が狭く、名前が切れる。担当は部門の下に縦に並べる（ファイルの木と同じ形）。
import { ALPHA, LW, TICK, LABEL, BIG, inkFill, fillAttr, seriesColor, inkStroke, paints, circle, line, rect, text, textLines, wrap, clip, textWidth, svgDoc, empty, strOf, midline } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ name: string, role: string, children: Node[] }} Node */

const MAX_NODES = 30
const MAX_UNITS = 7
const MARGIN = 10
const PAD = 12
const ROW_GAP = 6
const COL_MAX = 190

/**
 * @param {unknown} data { root: { name, role?, children?: { name, role?, children?: { name, role? }[] }[] } }（3 段・30 人まで）
 * @returns {{ data: { root: Node | null }, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  let count = 0
  let dropped = 0
  let deeper = 0
  let tooMany = 0
  /** @param {any} raw @param {number} depth @returns {Node | null} */
  const read = (raw, depth) => {
    const name = raw && typeof raw === 'object' ? strOf(raw.name) : ''
    if (!name) { dropped++; return null }
    if (count >= MAX_NODES) { tooMany++; return null }
    count++
    /** @type {Node} */
    const node = { name, role: strOf(raw.role), children: [] }
    const kids = Array.isArray(raw.children) ? raw.children : []
    if (depth >= 2) {
      deeper += kids.length
      return node
    }
    for (const k of kids) {
      if (depth === 0 && node.children.length >= MAX_UNITS) { tooMany++; continue }
      const child = read(k, depth + 1)
      if (child) node.children.push(child)
    }
    return node
  }
  const root = src.root && typeof src.root === 'object' ? read(src.root, 0) : null
  if (!root) warnings.push('体制図: root（{ name, role?, children? }）の名前が読めません')
  if (dropped && root) warnings.push(`体制図: 名前の読めない人 ${dropped} 人を捨てました`)
  if (deeper) warnings.push(`体制図: 4 段目より下の ${deeper} 人は描かないので捨てました（3 段まで）`)
  if (tooMany) warnings.push(`体制図: 部門は ${MAX_UNITS} つまで・全部で ${MAX_NODES} 人までなので、超えた ${tooMany} 人を捨てました`)
  return { data: { root }, warnings }
}

/**
 * 部門の並べ方と折り返し
 * @param {Node} root @param {number} W
 */
function plan(root, W) {
  const k = root.children.length
  const colW = k ? Math.min(COL_MAX, (W - 2 * MARGIN) / k) : W - 2 * MARGIN
  // 担当（bold が false）は、名前が 1 行で役割も入るなら同じ行の右に置く（1 人 11pt）。入らなければ役割を下の行へ
  const block = (/** @type {Node} */ n, /** @type {number} */ w, /** @type {boolean} */ bold) => {
    const names = wrap(n.name, LABEL, w, 2, bold)
    const role = n.role ? clip(n.role, TICK, w) : ''
    const nameW = Math.max(...names.map((l) => textWidth(l, LABEL, bold)))
    const inline = !bold && names.length === 1 && role !== '' && nameW + 8 + textWidth(role, TICK) <= w
    const used = Math.max(nameW, role ? textWidth(role, TICK) : 0, inline ? nameW + 8 + textWidth(role, TICK) : 0)
    return { names, role, inline, used, h: names.length * 11 + (role && !inline ? 11 : 0) }
  }
  const cols = root.children.map((u) => {
    const head = block(u, colW - 14, true)
    const rows = u.children.map((m) => block(m, colW - 24, false))
    return { head, rows, total: head.h + rows.reduce((s, r) => s + r.h + ROW_GAP, ROW_GAP) }
  })
  const rootRole = root.role ? clip(root.role, TICK, W - 2 * MARGIN) : ''
  const lastUsed = cols.length ? Math.max(cols[cols.length - 1].head.used + 9, ...cols[cols.length - 1].rows.map((r) => r.used + 13)) : 0
  const content = k ? (k - 1) * colW + Math.min(colW, lastUsed + 6) : 0
  const x0 = k ? Math.max(MARGIN, (W - content) / 2) : MARGIN
  const top = PAD + 3 + 4 + 12 + (rootRole ? 12 : 0) + 14
  return { k, colW, x0, content, cols, rootRole, l1Top: top + 14, need: top + 14 + Math.max(0, ...cols.map((c) => c.total)) + PAD }
}

/**
 * @param {{ root: Node | null }} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (!data.root) return empty(o)
  const root = data.root
  const g = paints(pal)
  const { k, colW, x0, content, cols, rootRole, l1Top, need } = plan(root, W)
  const rootX = k ? x0 + content / 2 : W / 2
  const lift = Math.max(0, (H - need) / 2)
  const hair = inkStroke(pal, ALPHA.last, LW.hair)

  /** @type {string[]} */
  const parts = []
  parts.push(rect(rootX - 18, PAD + lift, 36, 3, g.linear(rootX - 18, 0, rootX + 18, 0, 1, 1)))
  parts.push(text(rootX, PAD + lift + 3 + 4 + 12, clip(root.name, BIG, W - 2 * MARGIN), { size: BIG, fill: pal.accent, anchor: 'middle' }))
  if (rootRole) parts.push(text(rootX, PAD + lift + 3 + 4 + 12 + 12, rootRole, { size: TICK, fill: pal.sub, anchor: 'middle' }))
  const busY = l1Top + lift - 14
  const rootBottom = PAD + lift + 3 + 4 + 12 + (rootRole ? 12 : 0) + 4

  const xs = cols.map((_, j) => x0 + j * colW + 3)
  if (k) {
    const lo = Math.min(rootX, xs[0])
    const hi = Math.max(rootX, xs[k - 1])
    parts.push(line(rootX, rootBottom, rootX, busY, hair))
    parts.push(line(lo, busY, hi, busY, hair))
  }
  cols.forEach((c, j) => {
    const x = xs[j]
    let y = l1Top + lift
    const headY = midline(y + 8, LABEL)
    parts.push(line(x, busY, x, headY, hair))
    parts.push(circle(x, headY, 2.5, fillAttr(seriesColor(pal, j + 1, 0) ?? pal.ink, 1)))
    parts.push(textLines(x + 9, y + 8, c.head.names.map((l) => clip(l, LABEL, colW - 14, true)), { size: LABEL, fill: pal.ink, bold: true, leading: 11 }))
    if (c.head.role) parts.push(text(x + 9, y + 8 + c.head.names.length * 11, c.head.role, { size: TICK, fill: pal.sub }))
    y += c.head.h + ROW_GAP
    let last = headY
    c.rows.forEach((r) => {
      const my = midline(y + 8, LABEL)
      parts.push(line(x, my, x + 8, my, hair))
      parts.push(textLines(x + 13, y + 8, r.names.map((l) => clip(l, LABEL, colW - 24)), { size: LABEL, fill: pal.ink, leading: 11 }))
      if (r.inline) parts.push(text(x + 13 + textWidth(r.names[0], LABEL) + 8, y + 8, r.role, { size: TICK, fill: pal.sub }))
      else if (r.role) parts.push(text(x + 13, y + 8 + r.names.length * 11, r.role, { size: TICK, fill: pal.sub }))
      last = my
      y += r.h + ROW_GAP
    })
    if (last > headY) parts.push(line(x, headY, x, last, hair))
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 小さな会社の体制（見本。架空の人名） */
function sample() {
  return {
    root: {
      name: '中田 榛希',
      role: '代表取締役',
      children: [
        { name: '開発', role: '責任者 佐藤', children: [{ name: '山田 花', role: 'アプリ' }, { name: '鈴木 一', role: '基盤' }, { name: '田中 実', role: '品質' }] },
        { name: '営業', role: '責任者 高橋', children: [{ name: '伊藤 光', role: '新規' }, { name: '渡辺 空', role: '既存' }] },
        { name: '顧客支援', role: '責任者 小林', children: [{ name: '加藤 凛', role: '導入' }, { name: '吉田 蓮', role: '問い合わせ' }] },
        { name: '経理・総務', role: '責任者 松本', children: [{ name: '井上 葵', role: '経理' }] },
      ],
    },
  }
}

export default {
  id: 'org',
  title: '体制図（Org）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {{ root: Node | null }} */ data) => Math.max(Math.round(width * 0.3), data.root ? Math.ceil(plan(data.root, width).need) : 0),
  sample,
}
