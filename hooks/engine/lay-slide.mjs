// @ts-check
// 資料（deck）の 1 枚を 1 頁の Op にする。純な部品（design.md §3.1 の Display List・deck.md の §4）。
//
// 流れ: 本文のある枚（grid・content・split・figure・kpi・compare・table）は全部「頭の帯 + panel の格子」に写して組む。
// 頭は kicker・題 1 行・要点 1〜2 行。本文の区域（頭の下から足の上まで）は panel が隙間なく埋める。panel は
// 薄い地の札（題・注・出典つき）に、図なら札の中の大きさのまま、字・表なら本文 9.5pt・表 8.5pt から入る段を探して描く。
// 表紙・区切り・statement・quote・closing は余白の多い型のまま（空きの検査は数えない）。
//
// 選ばなかった案:
//   - 余白が大きい枚で字を 14〜20pt に上げる段（旧 grow）: 空きを字の大きさで埋めると、3 つの箇条書きが頁の半分を占めて薄く見える。
//     空きは panel の数と配置で埋め、字は本文 9.5pt のまま、入らない時だけ 9 → 8.5 に下げる。
//   - look を幅いっぱいに置いて zoom で拡大する案: panel の枠（250〜500pt 幅）に look の自然な字の大きさのまま描く。拡大すると枠の中の項目が減る。
//   - 本文の段を panel ごとに決める案: 隣り合う panel の字の大きさが揃わない。1 枚で 1 つの段にそろえる。
//   - panel の高さを中身の高さに縮め、余りを隣に回す案: 縦横の入れ子の配分が解けなくなる。配置は数と中身の型から決め、
//     中身が薄ければ埋まり（body.used）を下げて inspect が空いた枚に数える。
//   - 表を自前で組み直す案: 列の幅の配分・数字の右寄せ・折り返しは table.mjs が持つ。lineGap = 1 の Theme で呼べば rowsOf が pt の高さを返すので、
//     資料の字の大きさ（theme.scale = 字 ÷ 8.5）だけ替えて使い回す。
//   - 頁番号を頭と足の両方に出す案: 同じ数が 2 つ並ぶだけ。頁番号は足の「n / N」だけにし、頭の右は kicker があれば section の題を出す。
//   - 影を札に付ける案: 印刷では灰色のにじみが紙の汚れに見える。札は薄い地と細い縁で作り、影は使わない。
//   - 円や丸い角を path で書く案: RectOp の r を使う（renderer が持っている。path の数も減る）。ただし丸い点（箇条書き・点）は path。

import { parseInline, plainText } from './inline.mjs'
import { tableItem } from './table.mjs'
import { svgToOps } from './svg.mjs'
import { addTag, breakInlines, lineOps, makeEnv, textLine, BASE_RATIO } from './lay-text.mjs'

/** @typedef {any} Op */
/** @typedef {any} Ctx */
/** @typedef {any} Env */
/** @typedef {any} Plan */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/** 資料の型（design の Layout）。知らない名前は grid にする。grid 以外の本文の型は panel に写して組む */
export const LAYOUTS = ['cover', 'section', 'statement', 'grid', 'content', 'split', 'figure', 'kpi', 'compare', 'table', 'quote', 'closing']
/** panel の並べ方（slide.arrange） */
export const ARRANGES = ['auto', '1+2', '2x2', '3col', '1+3', 'kpi+3', '2x3']
/** 足（出典・頁番号）を出さない型 */
const NO_FOOT = new Set(['cover', 'section', 'closing'])
const KAPPA = 0.5523
const ELLIPSIS = String.fromCodePoint(0x2026)
/** 本文の段（本文 9.5 → 9 → 8.5・表 8.5 → 8 → 7.5）の数 */
const TIERS = 3
/** panel の数の上限 */
const MAX_PANELS = 9
/** KPI の panel の項目の上限 */
const MAX_KPI = 6

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100
const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
/** 字か Inline[] を Inline[] に。字は ** と {親字|るび} を読む（schema は slide の字を字のまま持つ約束） @param {unknown} v @returns {{ text: string }[]} */
const inlinesOf = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x.text === 'string') : parseInline(str(v)))
/** @param {unknown} v */
const plainOf = (v) => (Array.isArray(v) ? plainText(/** @type {any} */ (v)) : plainText(parseInline(str(v))))

/** @param {string} c */
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
/** a に b を t だけ混ぜた色 @param {string} a @param {string} b @param {number} t */
const mix = (a, b, t) => {
  const x = rgb(a)
  const y = rgb(b)
  return `#${x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('')}`
}

// ---------------------------------------------------------------- 描く物の部品

/** @param {number} cx @param {number} cy @param {number} r */
function circlePath(cx, cy, r) {
  const k = KAPPA * r
  const p = (/** @type {number} */ v) => r2(v)
  return `M ${p(cx + r)} ${p(cy)} C ${p(cx + r)} ${p(cy + k)} ${p(cx + k)} ${p(cy + r)} ${p(cx)} ${p(cy + r)} C ${p(cx - k)} ${p(cy + r)} ${p(cx - r)} ${p(cy + k)} ${p(cx - r)} ${p(cy)} C ${p(cx - r)} ${p(cy - k)} ${p(cx - k)} ${p(cy - r)} ${p(cx)} ${p(cy - r)} C ${p(cx + k)} ${p(cy - r)} ${p(cx + r)} ${p(cy - k)} ${p(cx + r)} ${p(cy)} Z`
}
/** @param {number} cx @param {number} cy @param {number} r @param {string} fill @returns {Op} */
const dotOp = (cx, cy, r, fill) => ({ t: 'path', d: circlePath(cx, cy, r), fill })
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {Record<string, any>} [o] @returns {Op} */
const rectOp = (x, y, w, h, o = {}) => ({ t: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...o })
/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} w @param {string} color @returns {Op} */
const ruleOp = (x1, y1, x2, y2, w, color) => ({ t: 'rule', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), w, color })

/** @param {string[]} grad */
const stopsOf = (grad) => grad.map((color, i) => ({ at: grad.length === 1 ? 0 : i / (grad.length - 1), color }))
/** 横向きの線形グラデーション（x1 → x2 を grad の端から端に） @param {number} x1 @param {number} x2 @param {number} y @param {string[]} grad */
const linearH = (x1, x2, y, grad) => ({ kind: 'linear', x1: r2(x1), y1: r2(y), x2: r2(Math.max(x2, x1 + 1)), y2: r2(y), stops: stopsOf(grad) })
/** 縦向き @param {number} x @param {number} y1 @param {number} y2 @param {string[]} grad */
const linearV = (x, y1, y2, grad) => ({ kind: 'linear', x1: r2(x), y1: r2(y1), x2: r2(x), y2: r2(Math.max(y2, y1 + 1)), stops: stopsOf(grad) })
/** 紙に溶ける光（放射。中心が peak、縁が 0 の透明度） */
function glowOp(cx, cy, r, color, peak, paper) {
  const paint = {
    kind: 'radial', cx: r2(cx), cy: r2(cy), r: r2(r),
    stops: [{ at: 0, color, opacity: peak }, { at: 0.4, color, opacity: r2(peak * 0.6) }, { at: 0.75, color, opacity: r2(peak * 0.18) }, { at: 1, color, opacity: 0 }],
  }
  // 読めない時の fill は紙の色にする（先頭の止まりの色だと、paint を読めない描き手が頁に色の四角を塗る）。紙の上では見えない
  return { t: 'rect', x: r2(cx - r), y: r2(cy - r), w: r2(2 * r), h: r2(2 * r), fill: paper, paint }
}

/** text の Op に paint を付ける（読めない時の色は先頭の止まり）。ルビには付けない @param {Op[]} ops @param {any} paint */
function paintText(ops, paint) {
  for (const op of ops) {
    if (op.t !== 'text') continue
    op.paint = paint
    op.color = paint.stops[0].color
  }
}

/** 図の Op に tag を付ける（ClipOp の中も）。link は構造の外 @param {Op[]} ops @param {number} tag */
function tagAll(ops, tag) {
  for (const op of ops) {
    if (op.t === 'clip') tagAll(op.ops, tag)
    else if (op.t !== 'link') op.tag = tag
  }
}

// ---------------------------------------------------------------- 状態と env

/**
 * tag を Layout.tags に積む配列もどき。addTag は push して長さ - 1 を番号にするので、ctx.tag を呼んで最後の番号を覚える。
 * @param {Ctx} ctx
 */
function tagSink(ctx) {
  let last = 0
  return {
    push: (/** @type {{ role: string, parent: number|null, alt?: string, lang?: string }} */ t) => {
      /** @type {{ alt?: string, lang?: string }} */
      const extra = {}
      if (t.alt) extra.alt = t.alt
      if (t.lang) extra.lang = t.lang
      last = ctx.tag(t.role, t.parent, extra)
      return last + 1
    },
    get length() { return last + 1 },
  }
}

/** @param {Ctx} ctx @param {boolean} real 本物なら tag を ctx に積む。使い捨てなら自分の配列に積んで捨てる */
function makeSlideEnv(ctx, real) {
  /** @type {any} */
  const env = makeEnv({ theme: ctx.theme, metrics: ctx.metrics, phrase: ctx.phrase, images: ctx.images, lang: ctx.lang, logos: ctx.logos })
  if (real) env.tags = tagSink(ctx)
  return env
}

/** @param {any} slide @param {Ctx} ctx */
function makeState(slide, ctx) {
  const theme = ctx.theme
  const D = theme.deck
  const s = D.scale
  /** @type {any} */
  const S = {
    slide, ctx, theme, D, s, SZ: D.sizes, C: theme.colors, flat: D.flat,
    W: ctx.page.width, H: ctx.page.height, L: theme.left, cw: theme.measure, R: theme.left + theme.measure,
    T: D.margin.top, B: D.margin.bottom,
    ops: /** @type {Op[]} */ ([]), warnings: /** @type {string[]} */ ([]), outline: /** @type {{ title: string, level: number, y: number }[]} */ ([]),
    seen: new Set(), nat: new Map(),
  }
  S.u = (/** @type {number} */ v) => v * s
  // 表紙・区切り・statement・quote・closing は余白を広く取る（頁の端から 26pt では、大きな字が縁に張り付く）
  S.X = S.L + S.u(22)
  S.XR = S.R - S.u(22)
  S.textMax = 46 * D.sizes.body[0]
  S.real = makeSlideEnv(ctx, true)
  S.fresh = () => {
    const e = makeSlideEnv(ctx, false)
    e.scratch = e
    return e
  }
  S.real.scratch = S.fresh()
  // 足は 1 行ぶん。出典が 1 行に収まらない時は切って警告する（本文の下端が枚ごとに動かないようにする）
  S.srcPitch = D.sizes.source * 1.4
  S.bodyBottom = S.H - S.B - S.srcPitch - S.u(6)
  S.title = plainOf(slide.title)
  S.cardFill = mix(S.C.paper, S.C.tint, 0.55)
  /** 本物の env の時だけ warnings に積む（試しの組みでは積まない）。同じ文は 1 回 */
  S.warn = (/** @type {Env} */ env, /** @type {string} */ msg) => {
    if (env !== S.real || S.seen.has(msg)) return
    S.seen.add(msg)
    S.warnings.push(msg)
  }
  S.over = (/** @type {Env} */ env, /** @type {string} */ what) =>
    S.warn(env, `${ctx.index + 1} 枚目（${S.title.slice(0, 24) || '題名なし'}）に入らない: ${what}`)
  return S
}

// ---------------------------------------------------------------- 字の塊

/**
 * 字（または Inline[]）を行に組む。role があれば tag を作る（本物の env では Layout.tags に積まれる）。
 * @param {Env} env
 * @param {unknown} content
 * @param {{ font: string, size: number, color: string, role?: string, parent?: number, measure: number, align?: 'left'|'center'|'right', pitch?: number }} o
 */
function textBlock(env, content, o) {
  const tag = o.role ? addTag(env, o.role, o.parent ?? 0) : undefined
  const lines = breakInlines(env, inlinesOf(content), { font: /** @type {any} */ (o.font), size: o.size, color: o.color, tag }, { measure: Math.max(o.measure, o.size), align: o.align ?? 'left', phrase: true })
  const pitch = o.size * (o.pitch ?? 1.5)
  let w = 0
  for (const ln of lines) w = Math.max(w, ln.width)
  return { lines, size: o.size, pitch, h: lines.length * pitch, w, tag }
}

/**
 * 大きさの候補を順に試し、maxLines に収まる最初の大きさで組む。どれでも収まらなければ最後の大きさで、字を切って「…」を付ける。
 * 試しは env.scratch（使い捨て）で行い、tag は決まった 1 回だけ env に作る。
 * @param {any} S @param {Env} env @param {unknown} content
 * @param {{ font: string, color: string, role?: string, parent?: number, sizes: number[], maxLines: number, measure: number, align?: 'left'|'center'|'right', pitch?: number }} o
 */
function fitText(S, env, content, o) {
  const sc = env.scratch
  const inl = inlinesOf(content)
  const lineCount = (/** @type {{ text: string }[]} */ x, /** @type {number} */ size) =>
    breakInlines(sc, x, { font: /** @type {any} */ (o.font), size, color: o.color }, { measure: Math.max(o.measure, size), align: 'left', phrase: true }).length
  let size = o.sizes[o.sizes.length - 1]
  for (const sz of o.sizes) {
    if (lineCount(inl, sz) <= o.maxLines) {
      size = sz
      break
    }
  }
  let use = inl
  if (lineCount(inl, size) > o.maxLines) {
    const chars = Array.from(plainOf(inl))
    let lo = 0
    let hi = chars.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineCount([{ text: chars.slice(0, mid).join('') + ELLIPSIS }], size) <= o.maxLines) lo = mid
      else hi = mid - 1
    }
    use = [{ text: chars.slice(0, lo).join('') + ELLIPSIS }]
    S.over(env, `${o.maxLines} 行に収まらず「${chars.slice(0, 12).join('')}…」の後ろを切った`)
  }
  return textBlock(env, use, { ...o, size })
}

/**
 * 組んだ字の塊を、上端 top から描く。paint があれば字をグラデーションで塗る（x 方向に塊の幅いっぱい）。
 * @param {Env} env @param {Op[]} ops @param {ReturnType<typeof textBlock>} tb @param {number} x @param {number} top @param {{ paint?: string[] }} [o]
 */
function drawText(env, ops, tb, x, top, o = {}) {
  tb.lines.forEach((ln, k) => {
    const base = top + k * tb.pitch + (tb.pitch - tb.size) / 2 + BASE_RATIO * tb.size
    const made = lineOps(env, ln, x, base)
    if (o.paint) paintText(made, linearH(x, x + tb.w, base, o.paint))
    for (const op of made) ops.push(op)
  })
}

/** 1 行の字（折り返さない）の幅と、描く関数 @param {Env} env @param {string} text @param {string} font @param {number} size @param {string} color @param {number} [tag] */
function oneLine(env, text, font, size, color, tag) {
  const ln = textLine(env, text, { font: /** @type {any} */ (font), size, color, tag })
  return { ln, w: ln ? ln.width : 0 }
}

// ---------------------------------------------------------------- 頭と足

/**
 * 頭の帯: 左に丸い印と kicker（無ければ section の題）、右に section の題（kicker があって違う時だけ）。tag を作らない（飾り）。
 * @param {any} S @param {Op[]} ops @param {{ kicker?: string, right?: string, x?: number, xr?: number }} o
 */
function bandOps(S, ops, o) {
  const env = S.real
  const size = S.SZ.kicker
  const x0 = o.x ?? S.L
  const x1 = o.xr ?? S.R
  if (o.kicker) {
    const kt = textBlock(env, o.kicker, { font: 'sansBold', size, color: S.C.sub, measure: (x1 - x0) * 0.6, pitch: 1.3 })
    const base = S.T + (kt.pitch - size) / 2 + BASE_RATIO * size
    ops.push(dotOp(x0 + S.u(2.4), base - size * 0.34, S.u(2.4), S.flat ? S.C.ink : S.C.accent))
    drawText(env, ops, { ...kt, lines: kt.lines.slice(0, 1) }, x0 + S.u(9), S.T)
  }
  if (o.right) {
    const w = (x1 - x0) * 0.4
    const rt = textBlock(env, o.right, { font: 'sans', size, color: S.C.sub, measure: w, pitch: 1.3, align: 'right' })
    drawText(env, ops, { ...rt, lines: rt.lines.slice(0, 1) }, x1 - w, S.T)
  }
}

/**
 * 題を 1 行に収める。大きい方から試し、どれも 1 行に収まらなければ 2 行（2 番目の大きさ）で組む。
 * 選ばなかった案: 1 行に収まるまで小さくし続ける案。長い題が 12pt になり、本文との差が無くなる。
 * @param {any} S @param {Env} env @param {unknown} title @param {number[]} sizes @param {number} measure
 */
function fitTitle(S, env, title, sizes, measure) {
  const inl = inlinesOf(title)
  for (const sz of sizes) {
    const n = breakInlines(env.scratch, inl, { font: 'sansBold', size: sz, color: S.C.ink }, { measure: Math.max(measure, sz), align: 'left', phrase: true }).length
    if (n <= 1) return textBlock(env, inl, { font: 'sansBold', size: sz, color: S.C.ink, role: 'H2', measure, pitch: 1.25 })
  }
  return fitText(S, env, title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes: [sizes[1] ?? sizes[0]], maxLines: 2, measure, pitch: 1.25 })
}

/**
 * 頭: 帯・題名・lead を組む。返す bodyTop は本文の上端。題名（H2）と lead（P）の tag は組んだ時点で作る。
 * 題は 1 行・lead は 2 行まで。頁の上端に grad の細い帯を引く（mono は墨の単色）。
 * @param {any} S @param {Env} env
 */
function planHead(S, env) {
  const { slide, u, SZ } = S
  const kicker = str(slide.kicker) || str(S.ctx.section)
  const right = str(slide.kicker) && str(S.ctx.section) && str(slide.kicker) !== str(S.ctx.section) ? str(S.ctx.section) : ''
  let y = S.T + SZ.kicker * 1.3 + u(5)
  const sizes = [SZ.title, Math.max(14, Math.round(SZ.title * 0.89)), Math.max(13, Math.round(SZ.title * 0.78))]
  const tb = slide.title ? fitTitle(S, env, slide.title, sizes, S.cw) : null
  const titleTop = y
  if (tb) y += tb.h
  const lead = slide.lead
    ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead, Math.round(SZ.lead * 0.92 * 10) / 10], maxLines: 2, measure: S.cw, pitch: 1.5 })
    : null
  let leadTop = 0
  if (lead) {
    y += tb ? u(3) : 0
    leadTop = y
    y += lead.h
  }
  const bodyTop = y + u(8)
  return {
    bodyTop,
    /** @param {Op[]} ops */
    emit(ops) {
      const h = Math.max(2, u(2.5))
      ops.push(rectOp(0, 0, S.W, h, S.flat ? { fill: S.C.ink } : { fill: S.C.grad[0], paint: linearH(0, S.W, 0, S.C.grad) }))
      bandOps(S, ops, { kicker, right })
      if (tb) {
        drawText(env, ops, tb, S.L, titleTop)
        S.outline.push({ title: plainOf(slide.title), level: 2, y: r2(titleTop) })
      }
      if (lead) drawText(env, ops, lead, S.L, leadTop)
    },
  }
}

/** 足: 出典（1 行・左）と頁番号「n / N」（右）。本物の env で本文の後に呼ぶ @param {any} S @param {Op[]} ops */
function emitFoot(S, ops) {
  const env = S.real
  const { SZ, ctx } = S
  const bottom = S.H - S.B
  const num = textBlock(env, `${ctx.index + 1} / ${ctx.count}`, { font: 'sans', size: SZ.page, color: S.C.sub, measure: S.u(200), pitch: S.srcPitch / SZ.page })
  const sources = Array.isArray(S.slide.sources) ? S.slide.sources.map(str).filter(Boolean) : []
  if (sources.length) {
    const src = fitText(S, env, `出典: ${sources.join(' / ')}`, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.source], maxLines: 1, measure: S.cw - num.w - S.u(40), pitch: 1.4 })
    drawText(env, ops, src, S.L, bottom - src.h)
  }
  drawText(env, ops, num, S.R - num.w, bottom - num.pitch)
}

// ---------------------------------------------------------------- block の部品

const BLOCK_LABEL = { para: '段落', list: '箇条書き', heading: '見出し', quote: '引用', card: '囲み', keys: '要点', table: '表', chart: '図', svg: '図', image: '図', rule: '罫' }
/** @param {any} b */
function blockLabel(b) {
  const kind = /** @type {Record<string, string>} */ (BLOCK_LABEL)[b && b.type] ?? str(b && b.type)
  const snippet = plainOf(b && (b.text ?? b.label ?? b.caption ?? '')).slice(0, 14)
  return snippet ? `${kind}「${snippet}」` : kind
}

/** 段 tier の本文・表の大きさ @param {any} S @param {number} tier */
const bodySize = (S, tier) => S.SZ.body[tier]
/** @param {any} S @param {number} tier */
const tableSize = (S, tier) => S.SZ.table[tier]

/** 縦に積む block の間の空き。見出しの前は広く、後は狭く @param {any} S @param {Plan} prev @param {Plan} next */
function gapBetween(S, prev, next) {
  if (prev.kind === 'heading') return S.u(4)
  if (next.kind === 'heading') return S.u(10)
  return S.u(7)
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier @returns {Plan | null} */
function planBlock(S, env, b, x, w, tier) {
  if (!b || typeof b !== 'object') return null
  switch (b.type) {
    case 'para': return planPara(S, env, b, x, w, tier)
    case 'list': return planList(S, env, b, x, w, tier)
    case 'heading': return planHeading(S, env, b, x, w, tier)
    case 'quote': return planQuoteBlock(S, env, b, x, w, tier)
    case 'card': return planCard(S, env, b, x, w, tier)
    case 'table': return planTable(S, env, b, x, w, tier)
    case 'chart':
    case 'svg':
    case 'image': return planFigureBlock(S, env, b, x, w, undefined)
    case 'rule': return { kind: 'rule', label: '罫', h: S.u(8), emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => { ops.push(ruleOp(x, y + S.u(4), x + w, y + S.u(4), 0.5, S.C.rule)) } }
    case 'pagebreak': return null
    default:
      S.warn(env, `${S.ctx.index + 1} 枚目に資料では使えない block（${str(b.type).slice(0, 20)}）があったので捨てた`)
      return null
  }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planPara(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const tb = textBlock(env, b.text, { font: 'sans', size, color: S.C.ink, role: 'P', measure: w, pitch: 1.55 })
  if (!tb.lines.length) return null
  return { kind: 'para', label: blockLabel(b), h: tb.h, emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => drawText(env, ops, tb, x, y) }
}

/**
 * 箇条書き: 丸い点（飾り）と、1.35em 下げた本文。2 段目は更に下げて小さい点。番号つきは Lbl に数字。
 * 余った高さは項目の間に配る（上限 0.9em ずつ）。入らない時は cut が後ろの項目を落とす。
 * @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier
 */
function planList(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const pitch = size * 1.55
  const ind = 1.35 * size
  const gap = 0.3 * size
  const measure = w
  /** @type {{ lines: any[], bx: number, depth: number, num: any }[]} */
  const entries = []
  /** @param {any[]} list @param {boolean} ordered @param {number} parentTag @param {number} depth */
  const walk = (list, ordered, parentTag, depth) => {
    list.forEach((raw, i) => {
      const inl = Array.isArray(raw) ? raw : raw.text
      const li = addTag(env, 'LI', parentTag)
      const lbl = ordered ? addTag(env, 'Lbl', li) : undefined
      const body = addTag(env, 'LBody', li)
      const num = ordered ? textLine(env, `${i + 1}.`, { font: 'sansBold', size, color: S.C.accent, tag: lbl }) : null
      const lines = breakInlines(env, inlinesOf(inl), { font: 'sans', size, color: S.C.ink, tag: body }, { measure: Math.max(measure - (depth + 1) * ind, size), align: 'left', phrase: true })
      if (lines.length) entries.push({ lines, bx: x + depth * ind, depth, num })
      if (!Array.isArray(raw) && Array.isArray(raw.items) && raw.items.length) walk(raw.items, !!raw.ordered, addTag(env, 'L', body), depth + 1)
    })
  }
  walk(Array.isArray(b.items) ? b.items : [], !!b.ordered, addTag(env, 'L', 0), 0)
  if (!entries.length) return null
  const heightOf = (/** @type {number} */ k) => entries.slice(0, k).reduce((s, e) => s + e.lines.length * pitch, 0) + gap * Math.max(0, k - 1)
  /** @param {number} k */
  const make = (k) => ({
    kind: 'list', label: blockLabel(b), h: heightOf(k),
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y0, /** @type {number} */ hAlloc) => {
      const extra = k > 1 && hAlloc > heightOf(k) ? Math.min((hAlloc - heightOf(k)) / (k - 1), 0.9 * size) : 0
      let y = y0
      for (const e of entries.slice(0, k)) {
        const base0 = y + (pitch - size) / 2 + BASE_RATIO * size
        if (e.num) {
          for (const op of lineOps(env, e.num, e.bx + ind - 0.35 * size - e.num.width, base0)) ops.push(op)
        } else {
          ops.push(dotOp(e.bx + 0.42 * size, base0 - 0.3 * size, (e.depth ? 0.13 : 0.19) * size, e.depth ? S.C.sub : S.flat ? S.C.ink : S.C.accent))
        }
        e.lines.forEach((ln, kk) => {
          for (const op of lineOps(env, ln, e.bx + ind, y + kk * pitch + (pitch - size) / 2 + BASE_RATIO * size)) ops.push(op)
        })
        y += e.lines.length * pitch + gap + extra
      }
    },
  })
  const plan = make(entries.length)
  return {
    ...plan,
    /** maxH に入る項目の数まで落とす。1 つも入らなければ null */
    cut: (/** @type {number} */ maxH) => {
      let k = 0
      for (let c = 1; c < entries.length; c++) if (heightOf(c) <= maxH) k = c
      if (k < 1) return null
      return { ...make(k), label: `箇条書きの ${k + 1} 項目目以降`, cutAt: k }
    },
  }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planHeading(S, env, b, x, w, tier) {
  const lvl = b.level === 1 ? 1 : b.level === 2 ? 2 : 3
  const size = lvl === 1 ? Math.round(S.SZ.lead * 1.2 * 10) / 10 : lvl === 2 ? Math.round(S.SZ.lead * 1.1 * 10) / 10 : Math.round(bodySize(S, tier) * 1.08 * 10) / 10
  const tb = textBlock(env, b.text, { font: 'sansBold', size, color: S.C.ink, role: 'H3', measure: w, pitch: 1.4 })
  if (!tb.lines.length) return null
  return { kind: 'heading', label: blockLabel(b), h: tb.h, emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => drawText(env, ops, tb, x, y) }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planQuoteBlock(S, env, b, x, w, tier) {
  const size = Math.round(bodySize(S, tier) * 1.1 * 10) / 10
  const pad = S.u(10)
  const tb = textBlock(env, b.text, { font: 'sans', size, color: S.C.ink, role: 'BlockQuote', measure: w - pad, pitch: 1.55 })
  if (!tb.lines.length) return null
  return {
    kind: 'quote', label: blockLabel(b), h: tb.h,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => {
      ops.push(rectOp(x, y + S.u(2), S.u(2.5), tb.h - S.u(4), S.flat ? { fill: S.C.ink, r: S.u(1.2) } : { fill: S.C.grad[0], r: S.u(1.2), paint: linearV(x, y, y + tb.h, S.C.grad) }))
      drawText(env, ops, tb, x + pad, y)
    },
  }
}

/** 囲み: tint の丸い地・内側に細い縦の印。label は小さな太字 @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planCard(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const pad = S.u(9)
  const inX = x + pad + S.u(6)
  const inW = w - 2 * pad - S.u(6)
  const tag = addTag(env, 'Note', 0)
  const lab = b.label ? textBlock(env, b.label, { font: 'sansBold', size: Math.max(7.5, Math.round(size * 0.85 * 10) / 10), color: S.flat ? S.C.ink : S.C.accent, measure: inW, pitch: 1.4 }) : null
  if (lab) {
    // 見出しと本文を同じ Note にする（tag を text に付け直す）
    for (const ln of lab.lines) for (const g of ln.glyphs) g.tag = tag
  }
  const body = breakInlines(env, inlinesOf(b.text), { font: 'sans', size, color: S.C.ink, tag }, { measure: Math.max(inW, size), align: 'left', phrase: true })
  if (!body.length && !lab) return null
  const bodyPitch = size * 1.55
  const h = pad + (lab ? lab.h + S.u(2) : 0) + body.length * bodyPitch + pad
  return {
    kind: 'card', label: blockLabel(b), h,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => {
      ops.push(rectOp(x, y, w, h, { fill: S.C.tint, r: S.u(6) }))
      ops.push(rectOp(x + pad * 0.6, y + pad, S.u(2.5), h - 2 * pad, S.flat ? { fill: S.C.ink, r: S.u(1.2) } : { fill: S.C.grad[0], r: S.u(1.2), paint: linearV(x, y + pad, y + h - pad, S.C.grad) }))
      let yy = y + pad
      if (lab) {
        drawText(env, ops, lab, inX, yy)
        yy += lab.h + S.u(2)
      }
      body.forEach((ln, k) => {
        for (const op of lineOps(env, ln, inX, yy + k * bodyPitch + (bodyPitch - size) / 2 + BASE_RATIO * size)) ops.push(op)
      })
    },
  }
}

/**
 * 表。table.mjs の tableItem を、lineGap = 1 の Theme で呼んで高さ（pt）を得る。字は tier の表の大きさ（scale = 字 ÷ 8.5）。
 * 上下に 4pt ずつ持つ空き（PAD）は引いて、表の罫の上端を y に合わせる。入らない時は行を切って入れる（cut）。
 * @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier
 */
function planTable(S, env, b, x, w, tier) {
  const size = tableSize(S, tier)
  const derived = { ...S.theme, left: x, measure: w, lineGap: 1, scale: size / 8.5 }
  const tenv = Object.create(env)
  tenv.theme = derived
  const item = tableItem(tenv, b)
  if (!item) return null
  const PAD = 4
  const n = item.n
  /** @param {number} k */
  const hOf = (k) => item.rowsOf(0, k) - 2 * PAD
  /** @param {number} k */
  const emitRows = (k) => (/** @type {Op[]} */ ops, /** @type {number} */ y) => item.emit({ ops, y0: y - PAD, row0: 0, page: 0, a: 0, b: k, trim: 0 })
  return {
    kind: 'table', label: blockLabel({ type: 'table' }), h: hOf(n), emit: emitRows(n),
    /** maxH に入る行数まで切る（頭の行 + 本文 1 行 + 以上）。入らなければ null */
    cut: (/** @type {number} */ maxH) => {
      let k = 0
      for (let c = 1; c <= n; c++) if (hOf(c) <= maxH) k = c
      if (k < 2 || k >= n) return null
      return { kind: 'table', label: `表の ${k + 1} 行目以降`, h: hOf(k), emit: emitRows(k), cutAt: k }
    },
  }
}

/**
 * 図（chart・svg・image）。fill が数なら、その高さの箱いっぱいに描く（panel の中の図）。無ければ自然な高さ（flex: 足りなければ縮められる）。
 * 下に caption。Figure の tag は alt が分かる描いた後に作る。zoom は使わず、箱の大きさのまま描く（look の字は textMin 以上で決まる）。
 * @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number | undefined} fill
 */
function planFigureBlock(S, env, b, x, w, fill) {
  const small = Math.max(7.5, S.SZ.source)
  const capGap = S.u(4)
  const capTb = b.caption ? textBlock(env.scratch, b.caption, { font: 'sans', size: small, color: S.C.sub, measure: w, pitch: 1.4 }) : null
  const capH = capTb ? capTb.h + capGap : 0
  let natural = fill ?? 0
  if (fill === undefined) {
    const key = b
    const hit = S.nat.get(key)
    if (hit && hit.w === w) natural = hit.h
    else {
      const r = S.ctx.figure(b, { x: 0, y: 0, width: w, metrics: S.ctx.metrics, theme: S.theme, images: S.ctx.images, lang: S.ctx.lang })
      natural = r.height
      S.nat.set(key, { w, h: natural })
    }
  }
  const minFig = Math.min(natural, Math.max(S.u(90), natural * 0.55))
  const total = fill !== undefined ? fill : natural + capH
  return {
    kind: 'figure', label: blockLabel(b), h: total, flex: fill === undefined, minH: fill !== undefined ? total : minFig + capH,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y, /** @type {number} */ hAlloc) => {
      const boxH = Math.max(S.u(30), (hAlloc ?? total) - capH)
      const r = S.ctx.figure(b, { x, y, width: w, height: boxH, metrics: S.ctx.metrics, theme: S.theme, images: S.ctx.images, lang: S.ctx.lang })
      for (const m of r.warnings) S.warn(env, m)
      const tag = addTag(env, 'Figure', 0, { alt: r.alt || '図' })
      tagAll(r.ops, tag)
      for (const op of r.ops) ops.push(op)
      if (capTb) {
        const ct = textBlock(env, b.caption, { font: 'sans', size: small, color: S.C.sub, role: 'Caption', parent: tag, measure: w, pitch: 1.4 })
        drawText(env, ops, ct, x, y + boxH + capGap)
      }
    },
  }
}

// ---------------------------------------------------------------- KPI（panel の中の数のタイル）

/**
 * KPI の item の logo（'NYSE:IBM' の形の字）の SVG。ctx.logos（無ければ theme.logos。compose が載せる。logos.mjs が作った { 字: svg }）にあれば返す。どちらも無ければ（ロゴを渡していない組み）何も言わず描かず、
 * 渡されているのに無い字は warnings に 1 回書く。飾りなので tag は付けない。
 * @param {any} S @param {Env} env @param {{ logo?: string }} it @returns {string | null}
 */
function logoOf(S, env, it) {
  const key = it.logo
  const logos = S.ctx.logos ?? S.theme.logos
  if (!key || !logos || typeof logos !== 'object') return null
  const svg = Object.prototype.hasOwnProperty.call(logos, key) ? logos[key] : undefined
  if (typeof svg === 'string' && svg) return svg
  S.warn(env, `${S.ctx.index + 1} 枚目の KPI のロゴ ${key.slice(0, 24)} が見つからないので描かなかった`)
  return null
}

/** タイル 1 つの上下の余白（pt）。KPI の panel の自然な高さにも使う @param {any} S */
const kpiPadV = (S) => S.u(8)

/**
 * KPI の panel 1 つの中身（箱 box）の自然な高さ: 項目に増減・補足があるかで決める。帯（kpi+3）の高さを決めるために使う。
 * @param {any} S @param {{ delta?: unknown, note?: string }[]} items
 */
function kpiNaturalHeight(S, items) {
  const { u, SZ } = S
  const hasDelta = items.some((it) => it.delta !== undefined && it.delta !== null && it.delta !== '')
  const hasNote = items.some((it) => !!it.note)
  return 2 * kpiPadV(S) + SZ.label * 1.35 + u(3) + SZ.kpi * 1.15 + (hasDelta ? u(3) + SZ.note * 1.5 : 0) + (hasNote ? u(3) + SZ.note * 1.4 : 0)
}

/**
 * 数のタイルを箱の中に並べる。タイルは箱を縦横に割った枠（細い線で区切る）で、各枠に ラベル・値（単位）・増減・補足 を縦に積み、枠の縦の中央に置く。
 * 値は枠の高さの 46%（上限 SZ.kpi）から、枠の幅に収まるまで 1pt ずつ小さくする。収まらなければ補足、増減の順に落として警告する。
 * 返す fill は、枠に対して中身が占める高さの平均（空いた枠の検査の元）。
 * 選ばなかった案: タイルを tint の丸いカードにする案。panel の札の中にもう 1 枚のカードを重ねると、地が二重になって線が増える。
 * @param {any} S @param {Env} env
 * @param {{ label: string, value: string, unit?: string, delta?: unknown, trend?: unknown, note?: string, logo?: string }[]} items
 * @param {Box} box @param {Op[]} ops
 * @returns {{ fill: number }}
 */
function emitKpi(S, env, items, box, ops) {
  const { u, SZ } = S
  const n = items.length
  let cols = 1
  let best = Infinity
  for (let c = 1; c <= n; c++) {
    const tw = box.w / c
    const th = box.h / Math.ceil(n / c)
    if (c > 1 && tw < u(80)) continue
    const score = Math.abs(Math.log(tw / th / 2.2))
    if (score < best) {
      best = score
      cols = c
    }
  }
  const rows = Math.ceil(n / cols)
  const tw = box.w / cols
  const th = box.h / rows
  const padX = u(8)
  const inner = tw - 2 * padX
  const labelSize = SZ.label
  const noteSize = Math.max(7.5, SZ.note - 0.5)
  const logoSize = u(18)
  const table = addTag(env, 'Table', 0)
  const tr = addTag(env, 'TR', table)
  let fillSum = 0
  items.forEach((it, i) => {
    const td = addTag(env, 'TD', tr)
    const cx = box.x + (i % cols) * tw
    const cy = box.y + Math.floor(i / cols) * th
    if (i % cols > 0) ops.push(ruleOp(cx, cy + u(4), cx, cy + th - u(4), 0.5, S.C.rule))
    if (i >= cols) ops.push(ruleOp(cx + u(4), cy, cx + tw - u(4), cy, 0.5, S.C.rule))
    const bx = cx + padX
    const logo = logoOf(S, env, it)
    const sc = env.scratch
    const labelW = logo ? inner - logoSize - u(6) : inner
    const label = textBlock(sc, it.label, { font: 'sansBold', size: labelSize, color: S.C.sub, measure: labelW, pitch: 1.35 })
    const labelLines = Math.min(label.lines.length, 2)
    const d = deltaOf(it.delta, it.trend)
    const note = it.note ? textBlock(sc, it.note, { font: 'sans', size: noteSize, color: S.C.sub, measure: inner, pitch: 1.4 }) : null
    const noteLines = note ? Math.min(note.lines.length, 2) : 0
    /** 値の大きさ vs で、枠に積む中身の高さ @param {number} vs @param {boolean} withDelta @param {boolean} withNote */
    const groupH = (vs, withDelta, withNote) =>
      labelLines * labelSize * 1.35 + u(3) + vs * 1.15 + (withDelta && d ? u(3) + SZ.note * 1.5 : 0) + (withNote && note ? u(3) + noteLines * noteSize * 1.4 : 0)
    let showDelta = !!d
    let showNote = !!note
    let vs = Math.min(SZ.kpi, th * 0.46)
    const measureValue = (/** @type {number} */ size) => {
      const v = oneLine(sc, it.value, 'sansBold', size, S.C.ink)
      const un = it.unit ? oneLine(sc, it.unit, 'sans', Math.max(SZ.note, Math.round(size * 0.4)), S.C.sub) : null
      return v.w + (un ? un.w + u(4) : 0)
    }
    const avail = th - 2 * kpiPadV(S)
    for (;;) {
      const fitsW = measureValue(vs) <= inner
      const fitsH = groupH(vs, showDelta, showNote) <= avail
      if (fitsW && fitsH) break
      if (vs > SZ.label + 3) vs -= 1
      else if (showNote) {
        showNote = false
        S.over(env, `KPI「${it.label.slice(0, 12)}」の補足`)
      } else if (showDelta) {
        showDelta = false
        S.over(env, `KPI「${it.label.slice(0, 12)}」の増減`)
      } else break
    }
    const gh = groupH(vs, showDelta, showNote)
    fillSum += Math.min(1, (gh + 2 * kpiPadV(S)) / th)
    let y = cy + Math.max(kpiPadV(S), (th - gh) / 2)
    if (logo) for (const op of svgToOps(logo, { x: bx + inner - logoSize, y, width: logoSize, height: logoSize, metrics: S.ctx.metrics, color: S.C.ink, paper: S.C.paper }).ops) ops.push(op)
    const lab = textBlock(env, it.label, { font: 'sansBold', size: labelSize, color: S.C.sub, role: 'P', parent: td, measure: labelW, pitch: 1.35 })
    drawText(env, ops, { ...lab, lines: lab.lines.slice(0, 2) }, bx, y)
    y += labelLines * labelSize * 1.35 + u(3)
    const val = oneLine(env, it.value, 'sansBold', vs, S.C.ink, addTag(env, 'P', td))
    const base = y + (vs * 1.15) / 2 + vs * 0.36
    if (val.ln) {
      const made = lineOps(env, val.ln, bx, base)
      if (!S.flat) paintText(made, linearH(bx, bx + val.w, base, S.C.grad))
      for (const op of made) ops.push(op)
    }
    if (it.unit) {
      const unit = oneLine(env, it.unit, 'sans', Math.max(SZ.note, Math.round(vs * 0.4)), S.C.sub)
      if (unit.ln) for (const op of lineOps(env, unit.ln, bx + val.w + u(4), base)) ops.push(op)
    }
    y += vs * 1.15
    if (showDelta && d) {
      y += u(3)
      const color = d.sign > 0 ? S.C.up : d.sign < 0 ? S.C.down : S.C.sub
      const dl = oneLine(env, d.text, 'sansBold', SZ.note, color, addTag(env, 'P', td))
      if (dl.ln) for (const op of lineOps(env, dl.ln, bx, y + (SZ.note * 1.5 - SZ.note) / 2 + BASE_RATIO * SZ.note)) ops.push(op)
      y += SZ.note * 1.5
    }
    if (showNote && note) {
      y += u(3)
      const nt = textBlock(env, it.note, { font: 'sans', size: noteSize, color: S.C.sub, role: 'P', parent: td, measure: inner, pitch: 1.4 })
      drawText(env, ops, { ...nt, lines: nt.lines.slice(0, 2) }, bx, y)
    }
  })
  return { fill: fillSum / n }
}

/**
 * 増減の字と符号。+・▲・数字始まりは上げ、-・▼・マイナス始まりは下げ。数なら符号から。
 * trend（schema が字の符号から付ける向き。費用の増加を下げと見せたい時の上書きにもなる）があれば、色と矢印の向きはそれに従う。
 * @param {unknown} d @param {unknown} [trend] @returns {{ text: string, sign: number } | null}
 */
function deltaOf(d, trend) {
  const read = deltaRead(d)
  if (!read) return null
  const sign = trend === 'up' ? 1 : trend === 'down' ? -1 : trend === 'flat' ? 0 : read.sign
  if (sign === read.sign) return read
  return { text: `${sign > 0 ? '▲ ' : sign < 0 ? '▼ ' : ''}${read.text.replace(/^[▲▼] /u, '')}`, sign }
}

/** @param {unknown} d @returns {{ text: string, sign: number } | null} */
function deltaRead(d) {
  if (d === undefined || d === null || d === '') return null
  if (typeof d === 'number') return Number.isFinite(d) ? { text: `${d > 0 ? '+' : ''}${d}`, sign: Math.sign(d) } : null
  const t = String(d).trim()
  if (!t) return null
  const down = /^[-−▼▽]/u.test(t)
  const up = /^[+▲△]/u.test(t) || /^[0-9]/u.test(t)
  const arrow = down ? (/^[▼▽]/u.test(t) ? '' : '▼ ') : up && /^[+0-9]/u.test(t) ? '▲ ' : ''
  return { text: `${arrow}${t.replace(/^[-−]/u, '−')}`, sign: down ? -1 : up ? 1 : 0 }
}

// ---------------------------------------------------------------- 積む・入れる

/**
 * 高さを割り振る。足りなければ flex（図）を minH まで縮める。入れば heights（block ごとの高さ）を返す。
 * @param {any} S @param {Plan[]} plans @param {number} avail
 * @returns {{ ok: boolean, heights: number[], total: number }}
 */
function allocate(S, plans, avail) {
  const gaps = plans.map((p, i) => (i === 0 ? 0 : gapBetween(S, plans[i - 1], p)))
  const total = plans.reduce((s, p, i) => s + p.h + gaps[i], 0)
  const heights = plans.map((p) => p.h)
  if (total <= avail + 1e-6) return { ok: true, heights, total }
  const shrinkable = plans.reduce((s, p) => s + (p.flex ? p.h - p.minH : 0), 0)
  if (total - shrinkable > avail + 1e-6) return { ok: false, heights, total }
  const need = total - avail
  plans.forEach((p, i) => {
    if (p.flex) heights[i] = p.h - (need * (p.h - p.minH)) / shrinkable
  })
  return { ok: true, heights, total: avail }
}

/**
 * 1 つの領域（blocks を縦に積む箱）が段 tier で入るか。drop なら、入らない時に表の行・箇条書きの項目を切り、それでも入らなければ後ろの block から落とす。
 * @param {any} S @param {{ blocks: any[], x: number, w: number, availH: number }} r @param {number} tier @param {boolean} drop
 */
function fitOne(S, r, tier, drop) {
  let keep = r.blocks.length
  for (;;) {
    const env = S.fresh()
    /** @type {Plan[]} */
    const plans = []
    for (let i = 0; i < keep; i++) {
      const p = planBlock(S, env, r.blocks[i], r.x, r.w, tier)
      if (p) plans.push(p)
    }
    let a = allocate(S, plans, r.availH)
    /** @type {{ index: number, maxH: number } | null} */
    let cutLast = null
    if (!a.ok && drop && plans.length) {
      const last = plans[plans.length - 1]
      if (last.cut) {
        const others = plans.slice(0, -1).reduce((s, p, i) => s + p.h + (i === 0 ? 0 : gapBetween(S, plans[i - 1], p)), 0)
        const gap = plans.length > 1 ? gapBetween(S, plans[plans.length - 2], last) : 0
        const maxH = r.availH - others - gap
        const cut = last.cut(maxH)
        if (cut) {
          plans[plans.length - 1] = cut
          a = allocate(S, plans, r.availH)
          if (a.ok) cutLast = { index: plans.length - 1, maxH }
        }
      }
    }
    if (a.ok) return { ok: true, tier, keep, heights: a.heights, used: a.total, cutLast, dropped: r.blocks.slice(keep), cutLabel: cutLast ? plans[cutLast.index].label : '' }
    if (!drop) return { ok: false, tier, keep, heights: [], used: 0, cutLast: null, dropped: [], cutLabel: '' }
    if (keep === 0) return { ok: true, tier, keep: 0, heights: [], used: 0, cutLast: null, dropped: r.blocks, cutLabel: '' }
    keep--
  }
}

/**
 * 領域たち（null は領域を持たない panel）を、同じ段で入れる。入る最初の段を使い、どの段でも入らなければ最後の段で切る・落とす。
 * @param {any} S @param {({ blocks: any[], x: number, w: number, availH: number } | null)[]} regions
 */
function fitRegions(S, regions) {
  for (let tier = 0; tier < TIERS; tier++) {
    const fits = regions.map((r) => (r ? fitOne(S, r, tier, false) : null))
    if (fits.every((f) => f === null || f.ok)) return fits
  }
  return regions.map((r) => (r ? fitOne(S, r, TIERS - 1, true) : null))
}

/**
 * 決まった入れ方で、本物の env で組んで置く。tag は block の順に作られる（読み上げの順）。
 * 領域の block が箇条書き 1 つだけなら、余った高さを項目の間に配らせる。
 * @param {any} S @param {{ blocks: any[], x: number, w: number, availH: number }} r @param {ReturnType<typeof fitOne>} fit @param {number} top @param {Op[]} ops
 */
function emitRegion(S, r, fit, top, ops) {
  const env = S.real
  let y = top
  let j = 0
  /** @type {Plan | null} */
  let prev = null
  for (let i = 0; i < fit.keep; i++) {
    let p = planBlock(S, env, r.blocks[i], r.x, r.w, fit.tier)
    if (!p) continue
    if (fit.cutLast && fit.cutLast.index === j && p.cut) {
      const cut = p.cut(fit.cutLast.maxH)
      if (cut) p = cut
    }
    if (prev) y += gapBetween(S, prev, p)
    const alone = p.kind === 'list' && fit.keep === 1
    const h = alone ? Math.max(fit.heights[j] ?? p.h, r.availH) : fit.heights[j] ?? p.h
    p.emit(ops, y, h)
    y += alone ? p.h : h
    prev = p
    j++
  }
  for (const b of fit.dropped) S.over(env, blockLabel(b))
  if (fit.cutLast && fit.cutLabel) S.over(env, fit.cutLabel)
  return y - top
}

// ---------------------------------------------------------------- panel の格子

/**
 * panel の並べ方の木。h は左から右へ、v は上から下へ並べる。子は節か [重み, 節]。葉は null（panel 1 つ。重みは panel の span）。
 * 重みの 'band' は KPI の帯の高さ（pt の固定）。
 * 選ばなかった案: 全部を 12 段の格子の座標で書く案。入れ子の配分（右の小 2 つの高さを揃える）が座標の計算になり、型を足すたびに直す所が増える。
 * @typedef {null | { dir: 'h' | 'v', c: (any)[] }} Spec
 */
const hs = (/** @type {any[]} */ ...c) => ({ dir: 'h', c })
const vs = (/** @type {any[]} */ ...c) => ({ dir: 'v', c })
const BAND = 'band'
/** 名前つきの並べ方と、その panel の数 */
const NAMED = {
  '1+2': { n: 3, spec: () => hs([1.45, null], vs(null, null)) },
  '2x2': { n: 4, spec: () => vs(hs(null, null), hs(null, null)) },
  '3col': { n: 3, spec: () => hs(null, null, null) },
  '1+3': { n: 4, spec: () => hs([1.5, null], vs(null, null, null)) },
  'kpi+3': { n: 4, spec: () => vs([BAND, null], hs(null, null, null)) },
  '2x3': { n: 6, spec: () => vs(hs(null, null, null), hs(null, null, null)) },
}

/**
 * 'auto' の並べ方: panel の数と、先頭の panel の型から決める。先頭が KPI なら上に帯。先頭が図で残りが字・KPI なら「大 1・右に小 n」。
 * @param {number} n @param {string[]} kinds
 * @returns {{ spec: Spec, name: string }}
 */
function autoSpec(n, kinds) {
  const band = kinds[0] === 'kpi' && n >= 3
  const small = (/** @type {string} */ k) => k === 'text' || k === 'kpi'
  switch (n) {
    case 1: return { spec: null, name: '1' }
    case 2: return { spec: hs(null, null), name: '1x2' }
    case 3:
      if (band) return { spec: vs([BAND, null], hs(null, null)), name: 'kpi+2' }
      if (kinds.every(small)) return { spec: NAMED['3col'].spec(), name: '3col' }
      return { spec: NAMED['1+2'].spec(), name: '1+2' }
    case 4:
      if (band) return { spec: NAMED['kpi+3'].spec(), name: 'kpi+3' }
      if (kinds[0] === 'figure' && kinds.slice(1).every(small)) return { spec: NAMED['1+3'].spec(), name: '1+3' }
      return { spec: NAMED['2x2'].spec(), name: '2x2' }
    case 5:
      if (band) return { spec: vs([BAND, null], hs(null, null), hs(null, null)), name: 'kpi+4' }
      return { spec: vs(hs(null, null), hs(null, null, null)), name: '2+3' }
    case 6:
      if (band) return { spec: vs([BAND, null], hs(null, null, null), hs(null, null)), name: 'kpi+5' }
      return { spec: NAMED['2x3'].spec(), name: '2x3' }
    case 7: return { spec: vs(hs(null, null, null, null), hs(null, null, null)), name: '3+4' }
    case 8: return { spec: vs(hs(null, null, null, null), hs(null, null, null, null)), name: '4+4' }
    default: return { spec: vs(hs(null, null, null), hs(null, null, null), hs(null, null, null)), name: '3x3' }
  }
}

/**
 * 'rows:1,2,2|0.4,1,1.3' → 行ごとの panel の数と、行の高さの重み。panel の総数が合わなければ null。KPI だけの行は、重みを使わず KPI の自然な高さの帯にする。
 * 選ばなかった案: 名前の並べ方を増やす案。薄い字の行と背の高い図の行の比は枚ごとに違い、名前では足りなくなる。
 * @param {string} arrange @param {string[]} kinds
 * @returns {{ spec: Spec, name: string, bandIdx: number[] } | null}
 */
function rowsSpec(arrange, kinds) {
  const m = /^rows:([0-9,]+)(?:\|([0-9.,]+))?$/.exec(arrange)
  if (!m) return null
  const counts = m[1].split(',').map(Number)
  if (counts.reduce((a, b) => a + b, 0) !== kinds.length) return null
  const weights = m[2] ? m[2].split(',').map(Number) : []
  let at = 0
  /** @type {number[]} */
  const bandIdx = []
  const rows = counts.map((n, r) => {
    const rowKinds = kinds.slice(at, at + n)
    const node = n === 1 ? null : hs(...rowKinds.map(() => null))
    if (rowKinds.every((k) => k === 'kpi') && counts.length > 1) bandIdx.push(at)
    at += n
    const w = rowKinds.every((k) => k === 'kpi') && counts.length > 1 ? BAND : weights[r] > 0 ? weights[r] : 1
    return [w, node]
  })
  return { spec: vs(...rows), name: arrange, bandIdx }
}

/**
 * 木を箱に当てはめ、葉（panel）の箱を順に返す。箱は隙間 gap だけ空けて、区域の端から端まで使い切る。
 * @param {Spec} spec @param {Box} box @param {number} gap @param {number[]} spans panel の重み @param {number} band
 * @returns {Box[]}
 */
function place(spec, box, gap, spans, band) {
  /** @type {Box[]} */
  const out = []
  let leaf = 0
  /** @param {any} node @param {Box} b */
  const walk = (node, b) => {
    if (node === null) {
      out.push(b)
      leaf++
      return
    }
    const kids = node.c.map((/** @type {any} */ c) => (Array.isArray(c) ? { w: c[0], n: c[1] } : { w: 1, n: c }))
    // 葉の重みは panel の span（無ければ 1）に、木で決めた重みを掛ける
    let at = leaf
    const weights = kids.map((/** @type {{ w: any, n: any }} */ k) => {
      if (k.w === BAND) {
        at += count(k.n)
        return BAND
      }
      if (k.n === null) return (typeof k.w === 'number' ? k.w : 1) * (spans[at++] ?? 1)
      at += count(k.n)
      return typeof k.w === 'number' ? k.w : 1
    })
    const total = b[node.dir === 'h' ? 'w' : 'h'] - gap * (kids.length - 1)
    const fixed = weights.reduce((s, w) => s + (w === BAND ? Math.min(band, total * 0.4) : 0), 0)
    const sum = weights.reduce((s, w) => s + (w === BAND ? 0 : w), 0)
    let pos = node.dir === 'h' ? b.x : b.y
    kids.forEach((/** @type {{ n: any }} */ k, i) => {
      const w = weights[i]
      const size = w === BAND ? Math.min(band, total * 0.4) : ((total - fixed) * w) / sum
      walk(k.n, node.dir === 'h' ? { x: pos, y: b.y, w: size, h: b.h } : { x: b.x, y: pos, w: b.w, h: size })
      pos += size + gap
    })
  }
  /** @param {any} node @returns {number} */
  const count = (node) => (node === null ? 1 : node.c.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + count(Array.isArray(c) ? c[1] : c), 0))
  walk(spec, box)
  return out
}

/** panel の型: kpi・図 1 つだけ（figure）・表 1 つだけ（table）・ほか（text） @param {any} p */
function kindOf(p) {
  if (Array.isArray(p.kpi) && p.kpi.length) return 'kpi'
  const bs = Array.isArray(p.blocks) ? p.blocks : []
  if (bs.length === 1 && bs[0] && (bs[0].type === 'chart' || bs[0].type === 'svg' || bs[0].type === 'image')) return 'figure'
  if (bs.length === 1 && bs[0] && bs[0].type === 'table') return 'table'
  return 'text'
}

/**
 * 札の内側の寸法。題と注の行（あれば）・出典の行（あれば）を除いた中身の箱。
 * @param {any} S @param {any} p @param {Box} cell
 */
function chromeOf(S, p, cell) {
  const { u, SZ } = S
  const pad = u(9)
  const top = u(8)
  const bottom = u(7)
  const headH = p.title || p.note ? SZ.panelTitle * 1.45 + u(5) : 0
  const srcH = p.source ? SZ.source * 1.4 + u(3) : 0
  const inner = { x: cell.x + pad, y: cell.y + top + headH, w: Math.max(10, cell.w - 2 * pad), h: Math.max(10, cell.h - top - headH - srcH - bottom) }
  return { pad, top, headH, srcH, inner }
}

/**
 * 札を描く: 地・縁・題（左）・注（右）・出典（下）。tag は題が H3、注と出典が P。
 * @param {any} S @param {Op[]} ops @param {any} p @param {Box} cell @param {ReturnType<typeof chromeOf>} ch
 */
function emitCard(S, ops, p, cell, ch) {
  const env = S.real
  const { u, SZ } = S
  ops.push(rectOp(cell.x, cell.y, cell.w, cell.h, { fill: S.cardFill, stroke: p.emphasis ? S.C.accent : S.C.rule, lw: p.emphasis ? 1.2 : 0.5, r: u(S.flat ? 3 : 5) }))
  const { inner } = ch
  if (p.title || p.note) {
    const y = cell.y + ch.top
    const note = p.note ? oneLine(env.scratch, str(p.note), 'sans', SZ.panelNote, S.C.sub) : null
    const noteW = note ? Math.min(note.w, inner.w * 0.5) : 0
    if (p.title) {
      const tb = fitText(S, env, p.title, { font: 'sansBold', color: S.C.ink, role: 'H3', sizes: [SZ.panelTitle], maxLines: 1, measure: Math.max(20, inner.w - (noteW ? noteW + u(8) : 0)), pitch: 1.45 })
      drawText(env, ops, tb, inner.x, y)
    }
    if (p.note) {
      const nb = fitText(S, env, p.note, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.panelNote], maxLines: 1, measure: noteW + 1, align: 'right', pitch: 1.45 * (SZ.panelTitle / SZ.panelNote) })
      drawText(env, ops, nb, inner.x + inner.w - (noteW + 1), y)
    }
    const ry = y + SZ.panelTitle * 1.45 + u(1.5)
    ops.push(ruleOp(inner.x, ry, inner.x + inner.w, ry, 0.5, S.C.rule))
  }
  if (p.source) {
    const sb = fitText(S, env, `出典: ${str(p.source).replace(/^出典[:：]\s*/u, '')}`, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.source], maxLines: 1, measure: inner.w, pitch: 1.4 })
    drawText(env, ops, sb, inner.x, cell.y + cell.h - u(7) - sb.h)
  }
}

/**
 * 枚の本文を panel に写す。grid は slide.panels。ほかの本文の型は panel に直す。
 * @param {any} slide @param {string} kind
 * @returns {{ panels: any[], arrange: string }}
 */
function panelsOf(slide, kind) {
  const blocks = Array.isArray(slide.blocks) ? slide.blocks : []
  switch (kind) {
    case 'grid': return { panels: Array.isArray(slide.panels) ? slide.panels : [], arrange: str(slide.arrange) || 'auto' }
    case 'split': {
      const m = /^(\d+):(\d+)$/.exec(str(slide.ratio))
      const a = m ? Number(m[1]) : 6
      const b = m ? Number(m[2]) : 6
      const left = Array.isArray(slide.left) ? slide.left : []
      const right = Array.isArray(slide.right) ? slide.right : []
      return { panels: [...(left.length ? [{ blocks: left, span: a }] : []), ...(right.length ? [{ blocks: right, span: b }] : [])], arrange: 'auto' }
    }
    case 'figure': {
      const side = Array.isArray(slide.side) ? slide.side : []
      return { panels: [...(slide.figure ? [{ blocks: [slide.figure], span: side.length ? 2 : 1 }] : []), ...(side.length ? [{ blocks: side }] : [])], arrange: 'auto' }
    }
    case 'kpi': return { panels: [{ kpi: Array.isArray(slide.items) ? slide.items : [] }], arrange: 'auto' }
    case 'compare': {
      const items = Array.isArray(slide.items) ? slide.items : []
      return {
        panels: items.map((it) => ({ title: it.title, emphasis: !!it.highlight, blocks: [{ type: 'list', ordered: false, items: (Array.isArray(it.points) ? it.points : []).map((t) => [{ text: str(t) }]) }] })),
        arrange: 'auto',
      }
    }
    default: return { panels: blocksToPanels(blocks), arrange: 'auto' }
  }
}

/**
 * blocks（content・table の型）を panel に分ける。見出しは次の panel の題。図・表は 1 つずつ panel、字の block は続く限り 1 つの panel にまとめる。
 * @param {any[]} blocks
 */
function blocksToPanels(blocks) {
  /** @type {any[]} */
  const panels = []
  /** @type {any} */
  let cur = null
  let title = ''
  const flush = () => {
    if (cur) panels.push(cur)
    cur = null
  }
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || b.type === 'pagebreak') continue
    if (b.type === 'heading') {
      flush()
      title = plainOf(b.text)
      continue
    }
    if (b.type === 'chart' || b.type === 'svg' || b.type === 'image' || b.type === 'table') {
      flush()
      panels.push({ ...(title ? { title } : {}), blocks: [b] })
      title = ''
      continue
    }
    if (b.type === 'keys') {
      flush()
      panels.push({ ...(title ? { title } : {}), kpi: (Array.isArray(b.items) ? b.items : []).map((/** @type {any} */ it) => ({ label: str(it.label), value: str(it.value), note: str(it.note), logo: str(it.logo) })) })
      title = ''
      continue
    }
    if (!cur) {
      cur = { ...(title ? { title } : {}), blocks: [] }
      title = ''
    }
    cur.blocks.push(b)
  }
  flush()
  return panels
}

/**
 * 本文の区域を panel の格子で使い切る。
 * 区域の埋まり（body.used / body.height）は、panel の中身が札の中で占める割合の面積平均。図と KPI は札の大きさに合わせて描くので満ちるが、
 * 字・表は中身の高さ ÷ 札の中の高さで測る（薄い panel が多い枚は、inspect が空いた枚に数える）。
 * @param {any} S @param {any[]} panelsIn @param {string} arrange
 */
function layoutGrid(S, panelsIn, arrange) {
  const probe = planHead(S, S.fresh())
  const avail = S.bodyBottom - probe.bodyTop
  let panels = panelsIn.filter((p) => p && typeof p === 'object')
  if (panels.length > MAX_PANELS) {
    for (const p of panels.slice(MAX_PANELS)) S.over(S.real, `panel「${plainOf(p.title).slice(0, 12) || '題なし'}」（${MAX_PANELS} 個まで）`)
    panels = panels.slice(0, MAX_PANELS)
  }
  const head = planHead(S, S.real)
  head.emit(S.ops)
  S.bodyTop = head.bodyTop
  S.bodyHeight = avail
  S.fill = 1
  if (!panels.length) {
    S.fill = 0
    return
  }
  const kinds = panels.map(kindOf)
  const region = { x: S.L, y: head.bodyTop, w: S.cw, h: avail }
  const gap = S.D.grid.gap
  const named = /** @type {Record<string, { n: number, spec: () => Spec }>} */ (NAMED)[arrange]
  const rows = arrange.startsWith('rows:') ? rowsSpec(arrange, kinds) : null
  /** @type {{ spec: Spec, name: string, bandIdx?: number[] }} */
  let chosen
  if (rows) chosen = rows
  else if (named && named.n === panels.length) chosen = { spec: named.spec(), name: arrange }
  else {
    if (arrange.startsWith('rows:')) S.warn(S.real, `${S.ctx.index + 1} 枚目の arrange「${arrange}」は panel ${panels.length} 個と数が合わないので auto にした`)
    if (arrange !== 'auto' && ARRANGES.includes(arrange)) S.warn(S.real, `${S.ctx.index + 1} 枚目の arrange「${arrange}」は panel ${named ? named.n : '?'} 個の並べ方だが、panel が ${panels.length} 個なので auto にした`)
    chosen = autoSpec(panels.length, kinds)
  }
  const spans = panels.map((p) => (typeof p.span === 'number' && p.span > 0 ? Math.min(4, p.span) : 1))
  const bandIdx = chosen.bandIdx ?? (kinds[0] === 'kpi' && chosen.spec && chosen.spec.dir === 'v' && chosen.spec.c.some((/** @type {any} */ c) => Array.isArray(c) && c[0] === BAND) ? [0] : [])
  const band = bandIdx.reduce((m, i) => Math.max(m, chromeBandHeight(S, panels[i])), 0)
  const cells = place(chosen.spec, region, gap, spans, band)

  const chromes = panels.map((p, i) => chromeOf(S, p, cells[i]))
  /** 字・表・混ざりの panel は blocks の領域を持つ。図 1 つだけの panel と KPI は箱の大きさで描く（段を探さない） */
  const regions = panels.map((p, i) => (kinds[i] === 'kpi' || kinds[i] === 'figure' ? null : { blocks: Array.isArray(p.blocks) ? p.blocks : [], x: chromes[i].inner.x, w: chromes[i].inner.w, availH: chromes[i].inner.h }))
  const fits = fitRegions(S, regions)

  let areaSum = 0
  let fillSum = 0
  panels.forEach((p, i) => {
    const cell = cells[i]
    const ch = chromes[i]
    emitCard(S, S.ops, p, cell, ch)
    let fill = 1
    if (kinds[i] === 'kpi') {
      const items = p.kpi.slice(0, MAX_KPI)
      if (p.kpi.length > MAX_KPI) S.over(S.real, `KPI の ${MAX_KPI + 1} 個目以降`)
      fill = emitKpi(S, S.real, items, ch.inner, S.ops).fill
    } else if (kinds[i] === 'figure') {
      planFigureBlock(S, S.real, p.blocks[0], ch.inner.x, ch.inner.w, ch.inner.h).emit(S.ops, ch.inner.y, ch.inner.h)
    } else {
      const fit = /** @type {NonNullable<typeof fits[number]>} */ (fits[i])
      emitRegion(S, /** @type {any} */ (regions[i]), fit, ch.inner.y, S.ops)
      // 入らずに落とした・切った panel は、空いたのでなく溢れたのだから満ちている（溢れは警告が知らせる）
      fill = ch.inner.h > 0 && fit.dropped.length === 0 && !fit.cutLast ? Math.min(1, fit.used / ch.inner.h) : 1
    }
    areaSum += cell.w * cell.h
    fillSum += cell.w * cell.h * fill
  })
  S.fill = areaSum > 0 ? fillSum / areaSum : 0
}

/** KPI の帯の高さ（pt）: 札の余白と題・出典の行に、タイルの自然な高さを足す @param {any} S @param {any} p */
function chromeBandHeight(S, p) {
  const ch = chromeOf(S, p, { x: 0, y: 0, w: 100, h: 1000 })
  const items = (Array.isArray(p.kpi) ? p.kpi : []).slice(0, MAX_KPI)
  return 1000 - ch.inner.h + kpiNaturalHeight(S, items)
}

// ---------------------------------------------------------------- 余白の多い型

/** 表紙・section・結びの背景の飾り。vivid は grad の光（紙に溶ける放射）、mono は何も足さない @param {any} S @param {'cover'|'section'|'closing'} kind */
function decor(S, kind) {
  const { W, H, C } = S
  // mono は光を出さない（黒白の証券会社調。地を塗らない）
  if (S.flat) return
  const g = C.grad
  const c0 = g[0]
  const c1 = g[Math.floor((g.length - 1) / 2)]
  const c2 = g[g.length - 1]
  /** @type {[number, number, number, string, number][]} */
  const spec = kind === 'cover'
    ? [[0.9, 0.0, 0.52, c2, 0.3], [0.72, 0.86, 0.4, c1, 0.2], [0.02, 1.03, 0.46, c0, 0.2]]
    : kind === 'section'
      ? [[0.88, 0.48, 0.46, c1, 0.22], [1.0, 0.08, 0.3, c2, 0.2], [0.1, 1.05, 0.35, c0, 0.14]]
      : [[0.1, 0.0, 0.45, c0, 0.18], [0.92, 0.95, 0.5, c2, 0.26], [0.8, 0.35, 0.3, c1, 0.14]]
  for (const [fx, fy, fr, color, peak] of spec) S.ops.push(glowOp(W * fx, H * fy, W * fr, color, peak, C.paper))
}

/** 細い帯（grad）。mono は墨の単色 @param {any} S @param {number} x @param {number} y @param {number} w @param {number} h */
function barOp(S, x, y, w, h) {
  return rectOp(x, y, w, h, S.flat ? { fill: S.C.ink } : { fill: S.C.grad[0], r: h / 2, paint: linearH(x, x + w, y, S.C.grad) })
}

/** statement: 1 つの文を大きく、本文の高さの少し上寄りに。上に細い帯、下に小さな補足 @param {any} S */
function layoutStatement(S) {
  const { slide, u, SZ } = S
  const top = S.T + u(30)
  const sizes = [SZ.statement, Math.round(SZ.statement * 0.88 * 10) / 10, Math.round(SZ.statement * 0.76 * 10) / 10]
  const make = (/** @type {Env} */ env) => ({
    sentence: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes, maxLines: 4, measure: (S.XR - S.X) * 0.86, pitch: 1.4 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead * 1.3], maxLines: 3, measure: Math.min((S.XR - S.X) * 0.62, S.textMax * 1.3), pitch: 1.55 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(3) + u(22) + probe.sentence.h + (probe.sub ? u(24) + probe.sub.h : 0)
  const y0 = top + Math.max(0, (S.bodyBottom - top - total) * 0.45)
  const kicker = str(slide.kicker) || str(S.ctx.section)
  bandOps(S, S.ops, { kicker, right: str(slide.kicker) && str(S.ctx.section) && str(slide.kicker) !== str(S.ctx.section) ? str(S.ctx.section) : '', x: S.X, xr: S.XR })
  const m = make(S.real)
  S.ops.push(barOp(S, S.X, y0, u(48), u(3)))
  const sy = y0 + u(3) + u(22)
  drawText(S.real, S.ops, m.sentence, S.X, sy)
  S.outline.push({ title: S.title, level: 2, y: r2(sy) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.X, sy + m.sentence.h + u(24))
}

/** quote: 大きな引用と by。引用の頭に grad の大きな引用符 @param {any} S */
function layoutQuote(S) {
  const { slide, u, SZ } = S
  const text = slide.quote ?? slide.title ?? ''
  const sizes = [Math.round(SZ.statement * 0.9 * 10) / 10, Math.round(SZ.statement * 0.8 * 10) / 10, Math.round(SZ.statement * 0.7 * 10) / 10]
  const w = S.XR - S.X
  const make = (/** @type {Env} */ env) => ({
    label: slide.title ? textBlock(env, slide.title, { font: 'sansBold', size: SZ.label, color: S.flat ? S.C.ink : S.C.accent, role: 'H2', measure: w * 0.6, pitch: 1.4 }) : null,
    q: fitText(S, env, text, { font: 'sansBold', color: S.C.ink, role: 'BlockQuote', sizes, maxLines: 7, measure: w * 0.8, pitch: 1.5 }),
    by: slide.by ? textBlock(env, slide.by, { font: 'sans', size: SZ.body[0] + 1, color: S.C.sub, role: 'P', measure: w * 0.6, pitch: 1.5 }) : null,
  })
  const probe = make(S.fresh())
  const markH = u(28)
  const total = (probe.label ? probe.label.h + u(18) : 0) + markH + u(18) + probe.q.h + (probe.by ? u(22) + probe.by.h : 0)
  const top = S.T + u(30)
  const y0 = top + Math.max(0, (S.bodyBottom - top - total) * 0.45)
  bandOps(S, S.ops, { kicker: str(slide.kicker) || str(S.ctx.section), right: '', x: S.X, xr: S.XR })
  const m = make(S.real)
  const markSize = u(100)
  let my = y0
  if (m.label) {
    drawText(S.real, S.ops, m.label, S.X, my)
    S.outline.push({ title: S.title, level: 2, y: r2(my) })
    my += m.label.h + u(18)
  }
  const mark = textBlock(S.real, '“', { font: 'sansBold', size: markSize, color: S.C.ink, measure: u(120), pitch: 1 })
  // 引用符の字は em の箱の上 15〜43% にある。箱を上へずらして、見える所の上端を my に合わせる
  drawText(S.real, S.ops, mark, S.X - u(2), my - 0.15 * markSize, S.flat ? {} : { paint: S.C.grad })
  const qy = my + markH + u(18)
  drawText(S.real, S.ops, m.q, S.X, qy)
  if (m.by) {
    const by = qy + m.q.h + u(22)
    S.ops.push(rectOp(S.X, by + m.by.pitch / 2 - u(0.75), u(24), u(1.5), { fill: S.flat ? S.C.ink : S.C.accent }))
    drawText(S.real, S.ops, m.by, S.X + u(34), by)
  }
}

/** cover: 題（grad の字）・副題・作り手と日付。背景に光 @param {any} S */
function layoutCover(S) {
  const { slide, u, SZ, ctx } = S
  decor(S, 'cover')
  const sizes = [SZ.cover, Math.round(SZ.cover * 0.9), Math.round(SZ.cover * 0.8), Math.round(SZ.cover * 0.7)]
  const w = S.XR - S.X
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H1', sizes, maxLines: 3, measure: w * 0.74, pitch: 1.22 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.coverSub], maxLines: 3, measure: Math.min(w * 0.62, S.textMax * 1.5), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(4) + u(24) + probe.title.h + (probe.sub ? u(22) + probe.sub.h : 0)
  const y0 = S.H * 0.47 - total / 2
  bandOps(S, S.ops, { kicker: str(slide.kicker), right: '', x: S.X, xr: S.XR })
  const m = make(S.real)
  S.ops.push(barOp(S, S.X, y0, u(64), u(4)))
  const ty = y0 + u(4) + u(24)
  drawText(S.real, S.ops, m.title, S.X, ty, S.flat ? {} : { paint: S.C.grad })
  S.outline.push({ title: S.title, level: 1, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.X, ty + m.title.h + u(22))
  const by = str(slide.by) ? [str(slide.by), str(slide.date)].filter(Boolean).join('　') : [str(ctx.author), str(slide.date) || str(ctx.date)].filter(Boolean).join('　')
  if (by) {
    const bt = textBlock(S.real, by, { font: 'sans', size: SZ.label + 1, color: S.C.sub, role: 'P', measure: w * 0.7, pitch: 1.5 })
    drawText(S.real, S.ops, bt, S.X, S.H - S.B - bt.h)
  }
}

/** section: 大きな番号（grad の細い字）と題と lead @param {any} S */
function layoutSection(S) {
  const { slide, u, SZ, ctx } = S
  decor(S, 'section')
  const no = str(slide.number).trim() || String(ctx.sectionNo || 1).padStart(2, '0')
  const sizes = [SZ.section, Math.round(SZ.section * 0.88), Math.round(SZ.section * 0.76)]
  const w = S.XR - S.X
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H1', sizes, maxLines: 2, measure: w * 0.7, pitch: 1.25 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead * 1.3], maxLines: 3, measure: Math.min(w * 0.55, S.textMax * 1.3), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const digits = 0.73 * SZ.sectionNo
  const total = digits + u(24) + probe.title.h + (probe.sub ? u(14) + probe.sub.h : 0)
  const y0 = S.H * 0.47 - total / 2
  const m = make(S.real)
  const num = textBlock(S.real, no, { font: 'sans', size: SZ.sectionNo, color: S.C.ink, measure: w, pitch: 1 })
  drawText(S.real, S.ops, num, S.X - u(4), y0 - 0.14 * SZ.sectionNo, S.flat ? {} : { paint: S.C.grad })
  const ty = y0 + digits + u(24)
  drawText(S.real, S.ops, m.title, S.X, ty)
  S.outline.push({ title: S.title, level: 1, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.X, ty + m.title.h + u(14))
}

/** closing: 結びの文（grad の字）と、右に「次の一歩」のカード @param {any} S */
function layoutClosing(S) {
  const { slide, u, SZ } = S
  decor(S, 'closing')
  const steps = (Array.isArray(slide.items) ? slide.items : []).map((it) => (typeof it === 'string' ? it : str(it && (it.text ?? it.title ?? it.label)))).filter(Boolean).slice(0, 6)
  const w = S.XR - S.X
  const leftW = steps.length ? w * 0.5 : w * 0.7
  const sizes = [SZ.section, Math.round(SZ.section * 0.88), Math.round(SZ.section * 0.76)]
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes, maxLines: 4, measure: leftW, pitch: 1.28 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead * 1.3], maxLines: 4, measure: Math.min(leftW, S.textMax * 1.3), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(4) + u(22) + probe.title.h + (probe.sub ? u(18) + probe.sub.h : 0)
  const cy = S.H * 0.48
  const y0 = cy - total / 2
  const m = make(S.real)
  S.ops.push(barOp(S, S.X, y0, u(64), u(4)))
  const ty = y0 + u(4) + u(22)
  drawText(S.real, S.ops, m.title, S.X, ty, S.flat ? {} : { paint: S.C.grad })
  S.outline.push({ title: S.title, level: 2, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.X, ty + m.title.h + u(18))
  if (!steps.length) return

  const cardW = w * 0.4
  const cx = S.XR - cardW
  const pad = u(22)
  const numW = u(32)
  const size = SZ.body[0] + 2
  const pitch = size * 1.55
  const labelText = S.ctx.lang === 'en' ? 'NEXT STEPS' : '次の一歩'
  const lab = textBlock(S.real, labelText, { font: 'sansBold', size: SZ.label, color: S.flat ? S.C.ink : S.C.accent, measure: cardW - 2 * pad, pitch: 1.4 })
  const list = addTag(S.real, 'L', 0)
  const rows = steps.map((t, i) => {
    const li = addTag(S.real, 'LI', list)
    const lbl = addTag(S.real, 'Lbl', li)
    const body = addTag(S.real, 'LBody', li)
    const n = textLine(S.real, String(i + 1), { font: 'sansBold', size: u(20), color: S.C.ink, tag: lbl })
    const lines = breakInlines(S.real, [{ text: t }], { font: 'sans', size, color: S.C.ink, tag: body }, { measure: cardW - 2 * pad - numW, align: 'left', phrase: true })
    return { n, lines, h: Math.max(lines.length * pitch, u(24)) }
  })
  const rowGap = u(12)
  const h = pad + lab.h + u(14) + rows.reduce((s, r) => s + r.h, 0) + rowGap * (rows.length - 1) + pad
  const y = Math.max(S.T + u(30), cy - h / 2)
  S.ops.push(rectOp(cx, y, cardW, h, { fill: S.C.paper, stroke: S.C.rule, lw: 0.75, r: u(S.flat ? 4 : 10) }))
  drawText(S.real, S.ops, lab, cx + pad, y + pad)
  let yy = y + pad + lab.h + u(14)
  rows.forEach((r, i) => {
    if (i > 0) S.ops.push(ruleOp(cx + pad, yy - rowGap / 2, cx + cardW - pad, yy - rowGap / 2, 0.5, S.C.rule))
    if (r.n) {
      const base = yy + (u(24) - u(20)) / 2 + BASE_RATIO * u(20)
      const made = lineOps(S.real, r.n, cx + pad, base)
      if (!S.flat) paintText(made, linearH(cx + pad, cx + pad + r.n.width, base, S.C.grad))
      for (const op of made) S.ops.push(op)
    }
    r.lines.forEach((ln, k) => {
      for (const op of lineOps(S.real, ln, cx + pad + numW, yy + k * pitch + (pitch - size) / 2 + BASE_RATIO * size)) S.ops.push(op)
    })
    yy += r.h + rowGap
  })
}

// ---------------------------------------------------------------- 入口

/** panel の格子で組む型（grid と、grid に写して組む本文の型） */
const GRID_LAYOUTS = new Set(['grid', 'content', 'split', 'figure', 'kpi', 'compare', 'table'])

/** @type {Record<string, (S: any) => void>} */
const BUILDERS = { cover: layoutCover, section: layoutSection, statement: layoutStatement, quote: layoutQuote, closing: layoutClosing }

/**
 * 1 枚を 1 頁の Op にする。はみ出しは §4.3（字を下げる → 切る・落として warnings）。
 * @param {any} slide
 * @param {Ctx} ctx
 * @returns {{ ops: Op[], warnings: string[], outline: { title: string, level: number, y: number }[], missing: string[], counts: any, body?: { top: number, height: number, used: number } }} body は本文の区域（頭の下から足の上まで）と、panel の中身が占める高さ。panel の格子で組んだ枚だけが持つ。layout が頁の body に写し、inspectLayout が空いた枚を数える
 */
export function laySlide(slide, ctx) {
  const S = makeState(slide && typeof slide === 'object' ? slide : {}, ctx)
  const asked = str(S.slide.layout)
  const kind = LAYOUTS.includes(asked) ? asked : 'grid'
  if (asked && kind !== asked) S.warn(S.real, `${ctx.index + 1} 枚目の layout（${asked.slice(0, 20)}）は知らないので grid で組んだ`)
  if (GRID_LAYOUTS.has(kind)) {
    const { panels, arrange } = panelsOf(S.slide, kind)
    layoutGrid(S, panels, arrange)
  } else {
    BUILDERS[kind](S)
  }
  /** @type {{ top: number, height: number, used: number } | undefined} */
  let body
  if (S.bodyTop !== undefined) body = { top: r2(S.bodyTop), height: r2(S.bodyHeight), used: r2(S.bodyHeight * S.fill) }
  if (!NO_FOOT.has(kind)) emitFoot(S, S.ops)
  return { ops: S.ops, warnings: S.warnings, outline: S.outline, missing: [...S.real.missing], counts: S.real.counts, body }
}
