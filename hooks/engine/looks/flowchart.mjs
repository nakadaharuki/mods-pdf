// @ts-check
// flowchart（仕組み・お金とサービスの流れ）: 左から右へ段に分けた小さな箱を、細い曲線の矢印でつなぐ。箱は墨の薄い面と細い縁・矢印の上の字は紙の色の下敷きの上。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ（矢印がいちばん多くつながる箱）・字は paper の段・墨の割合は paper の ALPHA。
// - 段は、矢印をたどった最長の長さで決める（最初の段は矢印の入らない箱）。同じ段の箱は、前の段の箱の高さの平均で並べて、矢印の交わりを減らす。
// - group があれば、箱を group ごとの横の帯に分け、帯の名前を左に置く（顧客・自社・取引先など）。帯の境は細い線だけで、地は塗らない。
// - 目立たせる箱は、色のある紙では grad の薄い（20%）グラデーションと accent の縁・名前は accent の太字。mono では墨 35% の面。つながる矢印も accent の 60%（mono は 80%）。
// - 循環する矢印（戻る矢印）は描けないので、捨てて warnings に書く。左から右の流れだけを描く。
// 選ばなかった案
// - 箱の中を濃い面（グラデーションや墨 100%）で塗る案: 濃い面の上に置ける字の色が pal に無い。薄い面にして、縁と字の色で目立たせる。
// - 矢印の字を矢印の横に置く案: 曲線が斜めに通る所で、字と線が重なる。矢印の真ん中に紙の色の下敷きを敷いて、その上に書く。
// - 戻る矢印を下に回して描く案: 線が箱の下を回り込んで長くなる。流れ図は左から右の 1 方向だけにして、戻る流れは別の図（cycle）で描く。
import { ALPHA, LW, TICK, LABEL, inkFill, inkStroke, hotStroke, hot, fillAttr, paints, rect, line, fillPath, strokePath, text, textLines, wrap, clip, textWidth, underlay, svgDoc, empty, strOf, keep, arrowHead, wrapsTwoRows, f } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ id: string, name: string, group: string }} FlowNode */
/** @typedef {{ from: number, to: number, label: string }} FlowLink */
/** @typedef {{ nodes: FlowNode[], links: FlowLink[], hot: number }} FlowData */

const MAX_NODES = 14
const MAX_LINKS = 24
const PAD = 12
const NODE_H = 30
const GAP_Y = 10
const LANE_W = 62
const NODE_MIN = 56
const ARROW = 5

/**
 * @param {unknown} data { nodes: { id, name, group? }[2..14], links: { from, to, label? }[0..24] }（左から右の流れ）
 * @returns {{ data: FlowData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  if (!Array.isArray(src.nodes)) warnings.push('流れ図: nodes（{ id, name, group? } の列）がありません')
  /** @type {FlowNode[]} */
  let nodes = []
  let bad = 0
  let dup = 0
  for (const n of Array.isArray(src.nodes) ? src.nodes : []) {
    const id = n && typeof n === 'object' ? strOf(n.id) : ''
    const name = n && typeof n === 'object' ? strOf(n.name) || id : ''
    if (!id) { bad++; continue }
    if (nodes.some((m) => m.id === id)) { dup++; continue }
    nodes.push({ id, name, group: strOf(n.group) })
  }
  if (bad) warnings.push(`流れ図: id の読めない箱 ${bad} 個を捨てました`)
  if (dup) warnings.push(`流れ図: id が重なる箱 ${dup} 個を捨てました`)
  nodes = keep(nodes, MAX_NODES, warnings, '流れ図: 箱')
  if (nodes.length < 2) {
    if (Array.isArray(src.nodes)) warnings.push('流れ図: 箱は 2 個以上要ります')
    return { data: { nodes: [], links: [], hot: -1 }, warnings }
  }
  /** @type {FlowLink[]} */
  let links = []
  let missing = 0
  let same = 0
  for (const l of Array.isArray(src.links) ? src.links : []) {
    const a = l && typeof l === 'object' ? nodes.findIndex((n) => n.id === strOf(l.from)) : -1
    const b = l && typeof l === 'object' ? nodes.findIndex((n) => n.id === strOf(l.to)) : -1
    if (a < 0 || b < 0 || a === b) { missing++; continue }
    if (links.some((m) => m.from === a && m.to === b)) { same++; continue }
    links.push({ from: a, to: b, label: strOf(l.label) })
  }
  if (missing) warnings.push(`流れ図: 箱の id を指さない（または自分に戻る）矢印 ${missing} 本を捨てました`)
  if (same) warnings.push(`流れ図: 同じ向きに重なる矢印 ${same} 本を捨てました`)
  links = keep(links, MAX_LINKS, warnings, '流れ図: 矢印')
  // 戻る矢印（循環）を捨てる: 深さ優先でたどり、たどっている途中の箱へ戻る矢印を落とす
  const keepLink = links.map(() => true)
  const state = nodes.map(() => 0)
  /** @param {number} u */
  const dfs = (u) => {
    state[u] = 1
    links.forEach((l, k) => {
      if (l.from !== u || !keepLink[k]) return
      if (state[l.to] === 1) keepLink[k] = false
      else if (state[l.to] === 0) dfs(l.to)
    })
    state[u] = 2
  }
  nodes.forEach((_, u) => { if (state[u] === 0) dfs(u) })
  const back = keepLink.filter((k) => !k).length
  if (back) warnings.push(`流れ図: 戻る（循環する）矢印 ${back} 本は左から右に描けないので捨てました`)
  links = links.filter((_, k) => keepLink[k])
  // 目立たせる箱: 矢印がいちばん多くつながる箱（同数なら先の箱）
  const deg = nodes.map((_, i) => links.filter((l) => l.from === i || l.to === i).length)
  const top = Math.max(...deg)
  return { data: { nodes, links, hot: top > 0 ? deg.indexOf(top) : -1 }, warnings }
}

/**
 * 段・帯・箱の位置。H が有限で足りなければ箱の高さと間を詰める（0.6 倍まで）
 * @param {FlowData} data @param {number} W @param {number} H
 */
function plan(data, W, H) {
  const wrapped = wrapsTwoRows(layersOf(data), H, naturalHeight(data, W))
  if (!wrapped) return planRows(data, W, H, 1)
  return planRows(data, W, H / 2, 2)
}

/** 段の数（矢印をたどった最長の長さ + 1） @param {FlowData} data */
function layersOf(data) {
  const layer = data.nodes.map(() => 0)
  for (let pass = 0; pass < data.nodes.length; pass++) for (const l of data.links) layer[l.to] = Math.max(layer[l.to], layer[l.from] + 1)
  return Math.max(...layer) + 1
}

/** 1 段組みの自然な高さ @param {FlowData} data @param {number} W */
function naturalHeight(data, W) {
  return Math.max(170, Math.ceil(planRows(data, W, Infinity, 1).need))
}

/**
 * rowsN が 2 なら、段を前半・後半に分けて 2 つの行に並べる（H は 1 行の高さ）
 * @param {FlowData} data @param {number} W @param {number} H @param {1 | 2} rowsN
 */
function planRows(data, W, H, rowsN) {
  const { nodes, links } = data
  const n = nodes.length
  // 段: 矢印をたどった最長の長さ
  const layer = nodes.map(() => 0)
  for (let pass = 0; pass < n; pass++) for (const l of links) layer[l.to] = Math.max(layer[l.to], layer[l.from] + 1)
  const L = Math.max(...layer) + 1
  const perRow = Math.ceil(L / rowsN)
  const lanes = [...new Set(nodes.map((nd) => nd.group))]
  const useLanes = lanes.some((g) => g !== '')
  if (useLanes && lanes.includes('')) lanes.push(lanes.splice(lanes.indexOf(''), 1)[0])
  const lane = nodes.map((nd) => (useLanes ? lanes.indexOf(nd.group) : 0))
  const laneCount = useLanes ? lanes.length : 1
  // 同じ段の並び: 前の段の矢印元の位置の平均（なければ元の順）
  /** @type {number[][]} */
  const cells = Array.from({ length: L }, () => [])
  const order = nodes.map(() => 0)
  for (let l = 0; l < L; l++) {
    const members = nodes.map((_, i) => i).filter((i) => layer[i] === l)
    const key = (/** @type {number} */ i) => {
      const from = links.filter((k) => k.to === i).map((k) => lane[k.from] * 100 + order[k.from])
      return from.length ? from.reduce((s, v) => s + v, 0) / from.length : lane[i] * 100 + i
    }
    members.sort((a, b) => lane[a] - lane[b] || key(a) - key(b) || a - b)
    members.forEach((i, k) => { order[i] = k })
    cells[l] = members
  }
  // 帯の高さ: 帯の中で、どの段にも並ぶ最大の箱の数
  const rows = Array.from({ length: laneCount }, (_, ln) => Math.max(1, ...cells.map((c) => c.filter((i) => lane[i] === ln).length)))
  const naturalH = rows.reduce((s, r) => s + r * (NODE_H + GAP_Y) + GAP_Y, 0)
  const scale = Number.isFinite(H) ? Math.min(1, Math.max(0.6, (H - 2 * PAD) / naturalH)) : 1
  const nodeH = Math.max(24, NODE_H * scale)
  const gapY = GAP_Y * scale
  const laneH = rows.map((r) => r * (nodeH + gapY) + gapY)
  const need = 2 * PAD + rows.reduce((s, r) => s + r * (NODE_H + GAP_Y) + GAP_Y, 0)
  // 横: 矢印の字が入る間（字の幅 + 24・最大 114）を確かめてから箱の幅を決める
  const labelW = Math.max(0, ...links.map((l) => (l.label ? textWidth(l.label, TICK) : 0)))
  const laneW = useLanes ? Math.min(LANE_W, W * 0.14) : 0
  const avail = W - 2 * PAD - laneW
  // 矢印の字が入る間を先に取り、箱が NODE_MIN に満たなければ間を詰める（字は 2 行に折る）
  const want = Math.max(28, Math.min(114, labelW + 24))
  const C = perRow
  let nodeW = Math.min(130, (avail - (C - 1) * want) / C)
  let gapX = want
  if (C > 1 && nodeW < NODE_MIN) {
    // 間は 52 まで詰め、余りは箱の幅へ回す（NODE_MIN のままだと「自社サー／ビス」のように名前が語の途中で折れる）
    const tight = (avail - (C - 1) * 28) / C
    nodeW = Math.max(20, tight < NODE_MIN ? tight : Math.min(tight, Math.max(NODE_MIN, (avail - (C - 1) * 52) / C)))
    gapX = Math.max(8, (avail - C * nodeW) / (C - 1))
  }
  if (C === 1) gapX = 0
  const left = PAD + laneW + Math.max(0, (avail - (C * nodeW + (C - 1) * gapX)) / 2)
  const laneTop = laneH.map((_, ln) => laneH.slice(0, ln).reduce((s, v) => s + v, 0))
  const totalH = laneH.reduce((s, v) => s + v, 0)
  const top = Math.max(PAD, (H - totalH) / 2)
  const rowOf = (/** @type {number} */ l) => Math.floor(l / perRow)
  const pos = nodes.map((_, i) => {
    const same = cells[layer[i]].filter((j) => lane[j] === lane[i])
    const k = same.indexOf(i)
    const stack = same.length * nodeH + (same.length - 1) * gapY
    const row = rowOf(layer[i])
    return { x: left + (layer[i] % perRow) * (nodeW + gapX), y: row * H + top + laneTop[lane[i]] + (laneH[lane[i]] - stack) / 2 + k * (nodeH + gapY), w: nodeW, h: nodeH, row }
  })
  return { layer, L, lanes, useLanes, laneW, laneH, laneTop, top, totalH, pos, nodeW, gapX, need, left, rowsN, rowH: H }
}

/**
 * @param {FlowData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (data.nodes.length < 2) return empty(o)
  const g = paints(pal)
  const { lanes, useLanes, laneW, laneH, laneTop, top, pos, gapX, rowsN, rowH } = plan(data, W, H)
  /** @type {string[]} */
  const parts = []

  if (useLanes) {
    const rule = inkStroke(pal, ALPHA.card, LW.hair)
    for (let r = 0; r < rowsN; r++) {
      const y0 = r * rowH + top
      lanes.forEach((name, ln) => {
        if (ln > 0) parts.push(line(PAD, y0 + laneTop[ln], W - PAD, y0 + laneTop[ln], rule))
        if (name) {
          const lines = wrap(name, TICK, laneW - 10, 3)
          parts.push(textLines(PAD, y0 + laneTop[ln] + laneH[ln] / 2 - ((lines.length - 1) * 10.5) / 2 + 3, lines, { size: TICK, fill: pal.sub, leading: 10.5 }))
        }
      })
    }
  }

  // 矢印（箱より先に描き、箱の面が下をかくす）
  const quiet = inkStroke(pal, ALPHA.dim, LW.line)
  /** @type {string[]} */
  const labels = []
  data.links.forEach((l) => {
    const a = pos[l.from]
    const b = pos[l.to]
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const x2 = b.x
    const y2 = b.y + b.h / 2
    const across = a.row !== b.row
    const xm = (x1 + x2 - ARROW) / 2
    const onHot = l.from === data.hot || l.to === data.hot
    const h = hot(pal, 0.6, 0.8)
    const stroke = onHot ? hotStroke(pal, 0.6, LW.line, 0.8) : quiet
    const head = onHot ? fillAttr(h.color, h.a) : fillAttr(pal.ink, ALPHA.dim)
    if (across) {
      // 行をまたぐ矢印: 箱の下から出て、2 つの行の間で横へ渡り、次の行の箱の上へ下りる
      const ax = a.x + a.w / 2
      const bx = b.x + b.w / 2
      const my = (a.row + 1) * rowH
      parts.push(strokePath(`M${f(ax)} ${f(a.y + a.h)}V${f(my)}H${f(bx)}V${f(b.y - ARROW)}`, stroke))
      parts.push(fillPath(arrowHead(bx, b.y, Math.PI / 2, ARROW), head))
      if (l.label) {
        const ls = wrap(l.label, TICK, Math.max(24, Math.abs(bx - ax) - 8, 60), 2)
        const w = Math.max(...ls.map((x) => textWidth(x, TICK)))
        const hh = ls.length * 10 + 1
        const cx = (ax + bx) / 2
        labels.push(underlay(cx - w / 2 - 2, my - hh / 2, w + 4, hh, pal), textLines(cx, my - hh / 2 + 8, ls, { size: TICK, fill: pal.sub, anchor: 'middle', leading: 10 }))
      }
      return
    }
    parts.push(strokePath(`M${f(x1)} ${f(y1)}C${f(xm)} ${f(y1)} ${f(xm)} ${f(y2)} ${f(x2 - ARROW)} ${f(y2)}`, stroke))
    parts.push(fillPath(arrowHead(x2, y2, 0, ARROW), head))
    if (l.label) {
      // 字は段の間（箱の無い所）に置く。同じ箱から何本も出る矢印は、曲線が分かれた終点の側・ほかは出発の側（離れた段へ飛ぶ矢印でも箱にかからない）
      const fan = data.links.filter((k) => k.from === l.from).length > 1
      const tx = fan ? x2 - gapX * 0.45 : x1 + gapX * 0.45
      let best = [x1, y1]
      let dist = Infinity
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const u = 1 - t
        const px = u * u * u * x1 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * (x2 - ARROW)
        const py = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2
        if (Math.abs(px - tx) < dist) { dist = Math.abs(px - tx); best = [px, py] }
      }
      const ls = wrap(l.label, TICK, Math.max(24, gapX - 8), 2)
      const w = Math.max(...ls.map((x) => textWidth(x, TICK)))
      const hh = ls.length * 10 + 1
      labels.push(underlay(best[0] - w / 2 - 2, best[1] - hh / 2, w + 4, hh, pal), textLines(best[0], best[1] - hh / 2 + 8, ls, { size: TICK, fill: pal.sub, anchor: 'middle', leading: 10 }))
    }
  })

  // 箱: 紙の色で下の矢印を隠してから、墨の薄い面と細い縁
  data.nodes.forEach((nd, i) => {
    const p = pos[i]
    const isHot = i === data.hot
    parts.push(rect(p.x, p.y, p.w, p.h, fillAttr(pal.paper), 'rx="4"'))
    parts.push(rect(p.x, p.y, p.w, p.h, isHot ? g.linear(p.x, p.y, p.x + p.w, p.y + p.h, 0.2, 0.35) : inkFill(pal, ALPHA.faint), `rx="4" ${isHot ? hotStroke(pal, 1, LW.hot) : inkStroke(pal, ALPHA.edge, LW.hair)}`))
    const lines = wrap(nd.name, LABEL, p.w - 10, 2, isHot).map((s) => clip(s, LABEL, p.w - 10, isHot))
    parts.push(textLines(p.x + p.w / 2, p.y + p.h / 2 - ((lines.length - 1) * 11) / 2 + 3, lines, { size: LABEL, fill: isHot ? pal.accent : pal.ink, bold: isHot, anchor: 'middle', leading: 11 }))
  })
  parts.push(...labels)
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 請求サービスのお金と仕事の流れ（見本。架空の会社）。目立たせる箱は矢印が最も多い「自社サービス」 */
function sample() {
  return {
    nodes: [
      { id: 'ad', name: '広告・紹介', group: '顧客側' },
      { id: 'cust', name: '利用企業', group: '顧客側' },
      { id: 'svc', name: '自社サービス', group: '自社' },
      { id: 'bank', name: '銀行', group: '連携先' },
      { id: 'acct', name: '会計ソフト', group: '連携先' },
    ],
    links: [
      { from: 'ad', to: 'cust', label: '14 日間の無料体験' },
      { from: 'cust', to: 'svc', label: '月額 9,800 円' },
      { from: 'svc', to: 'bank', label: '入金の確認' },
      { from: 'svc', to: 'acct', label: '仕訳データ' },
    ],
  }
}

export default {
  id: 'flowchart',
  title: '流れ図（Flowchart）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {FlowData} */ data) => (data.nodes.length >= 2 ? naturalHeight(data, width) : Math.round(width * 0.3)),
  sample,
}
