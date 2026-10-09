// @ts-check
// 資料（deck）の 1 枚を 1 頁の Op にする。純な部品（design.md §3.1 の Display List・deck.md の §4）。
//
// 流れ: 型（layout）ごとに、頭（題名・lead）→ 本文（blocks を縦に積む・横に並べる）→ 足の順に組む。
// 本文は「大きさの段（本文 12 → 10.5 → 10・表 10 → 9 → 8）」を上から試し、頁に入る最初の段で組む。入らなければ最後の段のまま
// 後ろの block から落として warnings に書く（黙って次の頁に流さない・黙って捨てない）。
//
// 選ばなかった案:
//   - 段を下げる試しを、本物の env（tag を Layout.tags に積む物）で行う案: 組むたびに段落・ルビの tag が増え、使わなかった組みの
//     中身の無い構造の要素が PDF に残る。試しは使い捨ての env で行い、決めた段で 1 回だけ本物の env を使う（reading order も頭 → 本文 → 足になる）。
//   - 段落の幅を版面いっぱいにする案: 12pt で 1 行が 62 字になり読みづらい。段落と箇条書きは 46 字（本文 12pt × 46）で止め、
//     幅を使うのは表・図・カード・KPI だけにする。右の空きは余白として残す。
//   - 本文の段を block ごとに別々に決める案: 隣り合う段落の字の大きさが揃わない。1 枚（split は左右とも）で 1 つの段にそろえる。
//   - 表を自前で組み直す案: 列の幅の配分・数字の右寄せ・折り返しは table.mjs が持つ。lineGap = 1 の Theme で呼べば rowsOf が pt の高さを返すので、
//     資料の字の大きさ（theme.scale = 字 ÷ 8.5）だけ替えて使い回す。
//   - 1 枚の最後の頁番号を頭と足の両方に出す案: 同じ数が 2 つ並ぶだけ。頁番号は足の「n / N」だけにし、頭の右は kicker があれば section の題を出す。
//   - 影を全部のカードに付ける案: 印刷では灰色のにじみが紙の汚れに見える。カードは tint の地か細い縁で作り、影は使わない。
//   - 円や丸い角を path で書く案: RectOp の r を使う（renderer が持っている。path の数も減る）。ただし丸い点（箇条書き・点）は path。

import { parseInline, plainText } from './inline.mjs'
import { tableItem } from './table.mjs'
import { addTag, breakInlines, lineOps, makeEnv, textLine, BASE_RATIO } from './lay-text.mjs'

/** @typedef {any} Op */
/** @typedef {any} Ctx */
/** @typedef {any} Env */
/** @typedef {any} Plan */

/** 資料の型（design の Layout）。知らない名前は content にする */
export const LAYOUTS = ['cover', 'section', 'statement', 'content', 'split', 'figure', 'kpi', 'compare', 'table', 'quote', 'closing']
/** 足（出典・頁番号）を出さない型 */
const NO_FOOT = new Set(['cover', 'section', 'closing'])
const KAPPA = 0.5523
const ELLIPSIS = String.fromCodePoint(0x2026)
/** 本文の段（本文 12 → 10.5 → 10）の数。段 -1 は余白が大きい枚で字を 14（表 13）まで上げる段 */
const TIERS = 3
/** 上げた段（-1）を使ってよい、本文が占める高さの上限（本文の高さに対する比）。これを超えるなら上げない */
const GROW_FILL = 0.72

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
  const env = makeEnv({ theme: ctx.theme, metrics: ctx.metrics, phrase: ctx.phrase, images: ctx.images, lang: ctx.lang })
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
  S.textMax = 46 * D.sizes.body[0]
  S.real = makeSlideEnv(ctx, true)
  S.fresh = () => {
    const e = makeSlideEnv(ctx, false)
    e.scratch = e
    return e
  }
  S.real.scratch = S.fresh()
  // 1 枚の足の高さは出典の行数に関わらず 2 行ぶん取り、本文の下端が枚ごとに動かないようにする
  S.srcPitch = D.sizes.source * 1.4
  S.bodyBottom = S.H - S.B - 2 * S.srcPitch - S.u(14)
  S.title = plainOf(slide.title)
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
 * @param {any} S @param {Op[]} ops @param {{ kicker?: string, right?: string }} o
 */
function bandOps(S, ops, o) {
  const env = S.real
  const size = S.SZ.kicker
  if (o.kicker) {
    const kt = textBlock(env, o.kicker, { font: 'sansBold', size, color: S.C.sub, measure: S.cw * 0.6, pitch: 1.3 })
    const base = S.T + (kt.pitch - size) / 2 + BASE_RATIO * size
    ops.push(dotOp(S.L + S.u(2.8), base - size * 0.34, S.u(2.8), S.flat ? S.C.ink : S.C.accent))
    drawText(env, ops, { ...kt, lines: kt.lines.slice(0, 1) }, S.L + S.u(11), S.T)
  }
  if (o.right) {
    const w = S.cw * 0.4
    const rt = textBlock(env, o.right, { font: 'sans', size, color: S.C.sub, measure: w, pitch: 1.3, align: 'right' })
    drawText(env, ops, { ...rt, lines: rt.lines.slice(0, 1) }, S.R - w, S.T)
  }
}

/**
 * 頭: 帯・題名・細い帯・lead を組む。返す bodyTop は本文の上端。題名（H2）と lead（P）の tag は組んだ時点で作る。
 * @param {any} S @param {Env} env @param {{ band?: boolean, bar?: boolean }} [o]
 */
function planHead(S, env, o = {}) {
  const { slide, u, SZ } = S
  const band = o.band !== false
  const bar = o.bar !== false
  const kicker = str(slide.kicker) || str(S.ctx.section)
  const right = str(slide.kicker) && str(S.ctx.section) && str(slide.kicker) !== str(S.ctx.section) ? str(S.ctx.section) : ''
  const top = S.T + (band ? u(12) + u(14) : u(4))
  const sizes = [SZ.title, Math.max(16, Math.round(SZ.title * 0.875)), Math.max(14, Math.round(SZ.title * 0.75))]
  const tb = slide.title ? fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes, maxLines: 2, measure: S.cw * 0.92, pitch: 1.28 }) : null
  let y = top
  const titleTop = y
  if (tb) y += tb.h
  let barY = 0
  if (tb && bar) {
    y += u(9)
    barY = y
    y += u(3)
  }
  const lead = slide.lead
    ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead, Math.round(SZ.lead * 0.9 * 10) / 10, Math.round(SZ.lead * 0.8 * 10) / 10], maxLines: 3, measure: Math.min(S.cw, S.textMax * 1.08), pitch: 1.55 })
    : null
  let leadTop = 0
  if (lead) {
    y += tb ? u(bar ? 11 : 9) : 0
    leadTop = y
    y += lead.h
  }
  const bodyTop = y + (tb || lead ? u(20) : 0)
  return {
    bodyTop,
    /** @param {Op[]} ops */
    emit(ops) {
      if (band) bandOps(S, ops, { kicker, right })
      if (tb) {
        drawText(env, ops, tb, S.L, titleTop)
        S.outline.push({ title: plainOf(slide.title), level: 2, y: r2(titleTop) })
      }
      if (tb && bar) ops.push(rectOp(S.L, barY, u(48), u(3), S.flat ? { fill: S.C.ink } : { fill: S.C.grad[0], r: u(1.5), paint: linearH(S.L, S.L + u(48), barY, S.C.grad) }))
      if (lead) drawText(env, ops, lead, S.L, leadTop)
    },
  }
}

/** 足: 出典（2 行まで・左）と頁番号「n / N」（右）。本物の env で本文の後に呼ぶ @param {any} S @param {Op[]} ops */
function emitFoot(S, ops) {
  const env = S.real
  const { SZ, ctx } = S
  const bottom = S.H - S.B
  const num = textBlock(env, `${ctx.index + 1} / ${ctx.count}`, { font: 'sans', size: SZ.page, color: S.C.sub, measure: S.u(200), pitch: S.srcPitch / SZ.page })
  const sources = Array.isArray(S.slide.sources) ? S.slide.sources.map(str).filter(Boolean) : []
  if (sources.length) {
    const src = fitText(S, env, `出典: ${sources.join(' / ')}`, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.source], maxLines: 2, measure: S.cw - num.w - S.u(40), pitch: 1.4 })
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

/** 上げた段の数。段は -growN … -1（大きい方から）と 0 … TIERS-1（下げる方）。 @param {any} S */
const growN = (S) => S.SZ.grow.body.length
/** 段 tier の本文の大きさ（負は上げた段）@param {any} S @param {number} tier */
const bodySize = (S, tier) => (tier < 0 ? S.SZ.grow.body[tier + growN(S)] : S.SZ.body[tier])
/** 段 tier の表の字の大きさ @param {any} S @param {number} tier */
const tableSize = (S, tier) => (tier < 0 ? S.SZ.grow.table[tier + growN(S)] : S.SZ.table[tier])
/** 本文の 1 行の長さ。字を上げた段では 1 行 40 字ぶんまで広げる（textMax は 12pt の 46 字。20pt のまま 552pt に抑えると 27 字で折れて細長くなる） @param {any} S @param {number} size */
const textMeasure = (S, size) => Math.max(S.textMax, 40 * size)

/** 縦に積む block の間の空き。見出しの前は広く、後は狭く @param {any} S @param {Plan} prev @param {Plan} next */
function gapBetween(S, prev, next) {
  if (prev.kind === 'heading') return S.u(6)
  if (next.kind === 'heading') return S.u(22)
  return S.u(14)
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
    case 'keys': return planKeys(S, env, b, x, w, tier)
    case 'table': return planTable(S, env, b, x, w, tier)
    case 'chart':
    case 'svg':
    case 'image': return planFigureBlock(S, env, b, x, w, undefined)
    case 'rule': return { kind: 'rule', label: '罫', h: S.u(10), emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => { ops.push(ruleOp(x, y + S.u(5), x + w, y + S.u(5), 0.5, S.C.rule)) } }
    case 'pagebreak': return null
    default:
      S.warn(env, `${S.ctx.index + 1} 枚目に資料では使えない block（${str(b.type).slice(0, 20)}）があったので捨てた`)
      return null
  }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planPara(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const tb = textBlock(env, b.text, { font: 'sans', size, color: S.C.ink, role: 'P', measure: Math.min(w, textMeasure(S, size)), pitch: 1.6 })
  if (!tb.lines.length) return null
  return { kind: 'para', label: blockLabel(b), h: tb.h, emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => drawText(env, ops, tb, x, y) }
}

/**
 * 箇条書き: 丸い点（飾り）と、1.35em 下げた本文。2 段目は更に下げて小さい点。番号つきは Lbl に数字。
 * @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier
 */
function planList(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const pitch = size * 1.6
  const ind = 1.35 * size
  const gap = 0.32 * size
  const measure = Math.min(w, textMeasure(S, size))
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
  const h = entries.reduce((s, e) => s + e.lines.length * pitch, 0) + gap * (entries.length - 1)
  return {
    kind: 'list', label: blockLabel(b), h,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y0) => {
      let y = y0
      for (const e of entries) {
        const base0 = y + (pitch - size) / 2 + BASE_RATIO * size
        if (e.num) {
          for (const op of lineOps(env, e.num, e.bx + ind - 0.35 * size - e.num.width, base0)) ops.push(op)
        } else {
          ops.push(dotOp(e.bx + 0.42 * size, base0 - 0.3 * size, (e.depth ? 0.13 : 0.19) * size, e.depth ? S.C.sub : S.flat ? S.C.ink : S.C.accent))
        }
        e.lines.forEach((ln, k) => {
          for (const op of lineOps(env, ln, e.bx + ind, y + k * pitch + (pitch - size) / 2 + BASE_RATIO * size)) ops.push(op)
        })
        y += e.lines.length * pitch + gap
      }
    },
  }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planHeading(S, env, b, x, w, tier) {
  const lvl = b.level === 1 ? 1 : b.level === 2 ? 2 : 3
  const size = lvl === 1 ? Math.round(S.SZ.lead * 1.15 * 10) / 10 : lvl === 2 ? S.SZ.lead : Math.round(bodySize(S, tier) * 1.08 * 10) / 10
  const tb = textBlock(env, b.text, { font: 'sansBold', size, color: S.C.ink, role: 'H3', measure: Math.min(w, S.textMax * 1.2), pitch: 1.4 })
  if (!tb.lines.length) return null
  return { kind: 'heading', label: blockLabel(b), h: tb.h, emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => drawText(env, ops, tb, x, y) }
}

/** @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planQuoteBlock(S, env, b, x, w, tier) {
  const size = Math.round(bodySize(S, tier) * 1.15 * 10) / 10
  const pad = S.u(16)
  const tb = textBlock(env, b.text, { font: 'sans', size, color: S.C.ink, role: 'BlockQuote', measure: Math.min(w - pad, textMeasure(S, size)), pitch: 1.6 })
  if (!tb.lines.length) return null
  return {
    kind: 'quote', label: blockLabel(b), h: tb.h,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => {
      ops.push(rectOp(x, y + S.u(3), S.u(3), tb.h - S.u(6), S.flat ? { fill: S.C.ink, r: S.u(1.5) } : { fill: S.C.grad[0], r: S.u(1.5), paint: linearV(x, y, y + tb.h, S.C.grad) }))
      drawText(env, ops, tb, x + pad, y)
    },
  }
}

/** 囲み: tint の丸い地・内側に細い縦の印。label は小さな太字 @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planCard(S, env, b, x, w, tier) {
  const size = bodySize(S, tier)
  const pad = S.u(16)
  const inX = x + pad + S.u(8)
  const inW = w - 2 * pad - S.u(8)
  const tag = addTag(env, 'Note', 0)
  const lab = b.label ? textBlock(env, b.label, { font: 'sansBold', size: Math.max(7.5, Math.round(size * 0.8 * 10) / 10), color: S.flat ? S.C.ink : S.C.accent, measure: inW, pitch: 1.4 }) : null
  if (lab) {
    // 見出しと本文を同じ Note にする（tag を text に付け直す）
    for (const ln of lab.lines) for (const g of ln.glyphs) g.tag = tag
  }
  const body = breakInlines(env, inlinesOf(b.text), { font: 'sans', size, color: S.C.ink, tag }, { measure: Math.max(Math.min(inW, textMeasure(S, size)), size), align: 'left', phrase: true })
  if (!body.length && !lab) return null
  const bodyPitch = size * 1.6
  const h = pad + (lab ? lab.h + S.u(3) : 0) + body.length * bodyPitch + pad
  return {
    kind: 'card', label: blockLabel(b), h,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => {
      ops.push(rectOp(x, y, w, h, { fill: S.C.tint, r: S.u(10) }))
      ops.push(rectOp(x + pad * 0.62, y + pad, S.u(3), h - 2 * pad, S.flat ? { fill: S.C.ink, r: S.u(1.5) } : { fill: S.C.grad[0], r: S.u(1.5), paint: linearV(x, y + pad, y + h - pad, S.C.grad) }))
      let yy = y + pad
      if (lab) {
        drawText(env, ops, lab, inX, yy)
        yy += lab.h + S.u(3)
      }
      body.forEach((ln, k) => {
        for (const op of lineOps(env, ln, inX, yy + k * bodyPitch + (bodyPitch - size) / 2 + BASE_RATIO * size)) ops.push(op)
      })
    },
  }
}

/** 要点（keys）は小さい KPI のカードを横に並べた物 @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number} tier */
function planKeys(S, env, b, x, w, tier) {
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 4).map((it) => ({ label: str(it.label), value: str(it.value), note: str(it.note) }))
  if (!items.length) return null
  const row = planKpiRow(S, env, items, x, w, { valueSize: Math.round(S.SZ.kpi * 0.62), compact: true, tier })
  return { kind: 'keys', label: blockLabel(b), h: row.h, emit: (/** @type {Op[]} */ ops, /** @type {number} */ y) => row.emit(ops, y, row.h) }
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

/** look の拡大。幅 340pt 以下の箱（split の細い側など）は 1 のまま、広い箱ほど上げて theme.deck.figureZoom で止める @param {any} S @param {number} w */
const figureZoom = (S, w) => Math.min(S.theme.deck.figureZoom, Math.max(1, w / 340))

/**
 * 図（chart・svg・image）。fill が数なら、その高さの箱いっぱいに描く（figure の型）。無ければ自然な高さ（flex: 足りなければ縮められる）。
 * 下に caption。Figure の tag は alt が分かる描いた後に作る。
 * @param {any} S @param {Env} env @param {any} b @param {number} x @param {number} w @param {number | undefined} fill
 */
function planFigureBlock(S, env, b, x, w, fill) {
  const small = Math.max(7.5, S.SZ.source)
  const capGap = S.u(6)
  const capTb = b.caption ? textBlock(env.scratch, b.caption, { font: 'sans', size: small, color: S.C.sub, measure: w, pitch: 1.4 }) : null
  const capH = capTb ? capTb.h + capGap : 0
  let natural = fill ?? 0
  if (fill === undefined) {
    const key = b
    const hit = S.nat.get(key)
    if (hit && hit.w === w) natural = hit.h
    else {
      const r = S.ctx.figure(b, { x: 0, y: 0, width: w, metrics: S.ctx.metrics, theme: S.theme, images: S.ctx.images, lang: S.ctx.lang, zoom: figureZoom(S, w) })
      natural = r.height
      S.nat.set(key, { w, h: natural })
    }
  }
  const minFig = Math.min(natural, Math.max(S.u(110), natural * 0.55))
  const total = fill !== undefined ? fill : natural + capH
  return {
    kind: 'figure', label: blockLabel(b), h: total, flex: fill === undefined, minH: fill !== undefined ? total : minFig + capH,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y, /** @type {number} */ hAlloc) => {
      const boxH = Math.max(S.u(40), (hAlloc ?? total) - capH)
      const r = S.ctx.figure(b, { x, y, width: w, height: boxH, metrics: S.ctx.metrics, theme: S.theme, images: S.ctx.images, lang: S.ctx.lang, zoom: figureZoom(S, w) })
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

// ---------------------------------------------------------------- KPI のカード（kpi の型と keys の block で共通）

/**
 * 数・単位・増減・補足を持つカードを横に並べる。tint の丸い地・上に短い grad の帯。値は幅に収まるまで小さくする。
 * @param {any} S @param {Env} env
 * @param {{ label: string, value: string, unit?: string, delta?: unknown, trend?: unknown, note?: string }[]} items
 * @param {number} x @param {number} w
 * @param {{ valueSize: number, compact?: boolean, tier?: number, minH?: number }} o
 */
function planKpiRow(S, env, items, x, w, o) {
  const { u, SZ } = S
  const n = items.length
  const cols = n > 4 ? Math.ceil(n / 2) : n
  const rows = Math.ceil(n / cols)
  const gap = u(o.compact ? 12 : 16)
  const cardW = (w - gap * (cols - 1)) / cols
  const pad = u(o.compact ? 14 : 22)
  const inner = cardW - 2 * pad
  const labelSize = o.compact ? Math.max(7.5, SZ.label - 2) : SZ.label
  const noteSize = o.compact ? Math.max(7.5, SZ.note - 1.5) : SZ.note
  const table = addTag(env, 'Table', 0)
  const tr = addTag(env, 'TR', table)
  const cards = items.map((it, i) => {
    const td = addTag(env, 'TD', tr)
    const label = textBlock(env.scratch, it.label, { font: 'sansBold', size: labelSize, color: S.C.sub, measure: inner, pitch: 1.4 })
    // 値は幅に収まるまで 2pt ずつ小さくする（床は 55%）
    let vs = o.valueSize
    let val = oneLine(env.scratch, it.value, 'sansBold', vs, S.C.ink)
    let unit = it.unit ? oneLine(env.scratch, it.unit, 'sans', Math.max(SZ.note, Math.round(vs * 0.4)), S.C.sub) : null
    while (val.w + (unit ? unit.w + u(5) : 0) > inner && vs > o.valueSize * 0.55) {
      vs -= 2
      val = oneLine(env.scratch, it.value, 'sansBold', vs, S.C.ink)
      unit = it.unit ? oneLine(env.scratch, it.unit, 'sans', Math.max(SZ.note, Math.round(vs * 0.4)), S.C.sub) : null
    }
    const d = deltaOf(it.delta, it.trend)
    const note = it.note ? textBlock(env.scratch, it.note, { font: 'sans', size: noteSize, color: S.C.sub, measure: inner, pitch: 1.45 }) : null
    const pillH = u(o.compact ? 17 : 20)
    const h = pad + u(3) + u(o.compact ? 10 : 14) + label.h + u(o.compact ? 4 : 8) + vs * 1.15 + (d ? u(o.compact ? 8 : 12) + pillH : 0) + (note ? u(o.compact ? 8 : 12) + note.h : 0) + pad
    return { it, td, vs, h, d, pillH, hasNote: !!note, i }
  })
  const cardH = Math.max(o.minH ?? 0, ...cards.map((c) => c.h))
  const total = rows * cardH + (rows - 1) * gap
  return {
    h: total, cardH,
    emit: (/** @type {Op[]} */ ops, /** @type {number} */ y0, /** @type {number} */ _h) => {
      cards.forEach((c, i) => {
        const cx = x + (i % cols) * (cardW + gap)
        const cy = y0 + Math.floor(i / cols) * (cardH + gap)
        ops.push(rectOp(cx, cy, cardW, cardH, { fill: S.C.tint, r: u(S.flat ? 4 : 12) }))
        const bx = cx + pad
        let y = cy + pad
        ops.push(rectOp(bx, y, u(28), u(3), S.flat ? { fill: S.C.ink } : { fill: S.C.grad[0], r: u(1.5), paint: linearH(bx, bx + u(28), y, S.C.grad) }))
        y += u(3) + u(o.compact ? 10 : 14)
        const label = textBlock(env, c.it.label, { font: 'sansBold', size: labelSize, color: S.C.sub, role: 'P', parent: c.td, measure: inner, pitch: 1.4 })
        drawText(env, ops, label, bx, y)
        y += label.h + u(o.compact ? 4 : 8)
        const val = oneLine(env, c.it.value, 'sansBold', c.vs, S.C.ink, addTag(env, 'P', c.td))
        const base = y + c.vs * 1.15 / 2 + c.vs * 0.36
        if (val.ln) {
          const made = lineOps(env, val.ln, bx, base)
          if (!S.flat) paintText(made, linearH(bx, bx + val.w, base, S.C.grad))
          for (const op of made) ops.push(op)
        }
        if (c.it.unit) {
          const us = Math.max(SZ.note, Math.round(c.vs * 0.4))
          const unit = oneLine(env, c.it.unit, 'sans', us, S.C.sub)
          if (unit.ln) for (const op of lineOps(env, unit.ln, bx + val.w + u(5), base)) ops.push(op)
        }
        y += c.vs * 1.15
        if (c.d) {
          y += u(o.compact ? 8 : 12)
          const color = c.d.sign > 0 ? S.C.up : c.d.sign < 0 ? S.C.down : S.C.sub
          const ds = Math.max(7.5, SZ.label - (o.compact ? 2 : 0))
          const dl = oneLine(env, c.d.text, 'sansBold', ds, color, addTag(env, 'P', c.td))
          const pw = dl.w + u(16)
          ops.push(rectOp(bx, y, pw, c.pillH, { fill: mix(color, S.C.tint, 0.86), r: c.pillH / 2 }))
          if (dl.ln) for (const op of lineOps(env, dl.ln, bx + u(8), y + (c.pillH - ds) / 2 + BASE_RATIO * ds)) ops.push(op)
          y += c.pillH
        }
        if (c.hasNote) {
          y += u(o.compact ? 8 : 12)
          const note = textBlock(env, c.it.note, { font: 'sans', size: noteSize, color: S.C.sub, role: 'P', parent: c.td, measure: inner, pitch: 1.45 })
          drawText(env, ops, note, bx, y)
        }
      })
    },
  }
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
 * 1 つの領域（blocks を縦に積む箱）が段 tier で入るか。drop なら、入らない時に表の行を切り、それでも入らなければ後ろの block から落とす。
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
 * 領域たち（split なら左右）を、同じ段で入れる。入る最初の段を使い、どの段でも入らなければ最後の段で落とす。
 * @param {any} S @param {{ blocks: any[], x: number, w: number, availH: number }[]} regions
 */
function fitRegions(S, regions) {
  for (let tier = -growN(S); tier < TIERS; tier++) {
    const fits = regions.map((r) => fitOne(S, r, tier, false))
    // 上げた段は、本文が高さの GROW_FILL までに収まる時だけ（詰まって見えない・図の flex だけで埋まる枚は上げない）
    if (fits.every((f, i) => f.ok && (tier >= 0 || f.used <= regions[i].availH * GROW_FILL))) return fits
  }
  return regions.map((r) => fitOne(S, r, TIERS - 1, true))
}

/**
 * 決まった入れ方で、本物の env で組んで置く。tag は block の順に作られる（読み上げの順）。
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
    const h = fit.heights[j] ?? p.h
    p.emit(ops, y, h)
    y += h
    prev = p
    j++
  }
  for (const b of fit.dropped) S.over(env, blockLabel(b))
  if (fit.cutLast && fit.cutLabel) S.over(env, fit.cutLabel)
  return y - top
}

// ---------------------------------------------------------------- 型

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

/** content と table: 頭と、blocks を 1 段で @param {any} S */
function layoutContent(S) {
  const blocks = Array.isArray(S.slide.blocks) ? S.slide.blocks : []
  const probe = planHead(S, S.fresh())
  const region = { blocks, x: S.L, w: S.cw, availH: S.bodyBottom - probe.bodyTop }
  const [fit] = fitRegions(S, [region])
  const head = planHead(S, S.real)
  head.emit(S.ops)
  emitRegion(S, region, fit, head.bodyTop, S.ops)
}

/** split: left と right を ratio の割合で並べる。間に細い縦の線 @param {any} S */
function layoutSplit(S) {
  const { slide } = S
  const probe = planHead(S, S.fresh())
  const m = /^(\d+):(\d+)$/.exec(str(slide.ratio))
  const a = m ? Number(m[1]) : 6
  const b = m ? Number(m[2]) : 6
  const gap = S.u(36)
  const avail = S.bodyBottom - probe.bodyTop
  const wl = ((S.cw - gap) * a) / (a + b)
  const wr = S.cw - gap - wl
  const left = { blocks: Array.isArray(slide.left) ? slide.left : [], x: S.L, w: wl, availH: avail }
  const right = { blocks: Array.isArray(slide.right) ? slide.right : [], x: S.L + wl + gap, w: wr, availH: avail }
  const fits = fitRegions(S, [left, right])
  const head = planHead(S, S.real)
  head.emit(S.ops)
  const hl = emitRegion(S, left, fits[0], head.bodyTop, S.ops)
  const hr = emitRegion(S, right, fits[1], head.bodyTop, S.ops)
  if (hl > 0 && hr > 0) {
    const x = S.L + wl + gap / 2
    S.ops.push(ruleOp(x, head.bodyTop + S.u(2), x, head.bodyTop + Math.max(hl, hr, S.u(60)) - S.u(2), 0.75, S.C.rule))
  }
}

/** figure: 図を本文の幅いっぱいに（side があれば右 4 段分は側の欄。欄の地は塗らない: 囲みの tint と同じ色で囲みが見えなくなる）。caption は図の下 @param {any} S */
function layoutFigure(S) {
  const { slide } = S
  const blocks = Array.isArray(slide.blocks) ? slide.blocks : []
  const figIdx = slide.figure ? -1 : blocks.findIndex((b) => b && (b.type === 'chart' || b.type === 'svg' || b.type === 'image'))
  const fig = slide.figure ?? (figIdx >= 0 ? blocks[figIdx] : null)
  const sideBlocks = Array.isArray(slide.side) ? slide.side : blocks.filter((_, i) => i !== figIdx)
  const probe = planHead(S, S.fresh())
  const avail = S.bodyBottom - probe.bodyTop
  const hasSide = sideBlocks.length > 0
  const gap = S.u(32)
  const figW = hasSide ? ((S.cw - gap) * 8) / 12 : S.cw
  const sideW = S.cw - gap - figW
  const side = { blocks: sideBlocks, x: S.L + figW + gap, w: sideW, availH: avail }
  const fits = hasSide ? fitRegions(S, [side]) : []
  const head = planHead(S, S.real)
  head.emit(S.ops)
  if (fig && typeof fig === 'object') {
    planFigureBlock(S, S.real, fig, S.L, figW, avail).emit(S.ops, head.bodyTop, avail)
  } else {
    S.over(S.real, '図（figure）が無い')
  }
  if (hasSide) emitRegion(S, side, fits[0], head.bodyTop, S.ops)
}

/** kpi: items を大きな数のカードで横に並べ、本文の高さの少し上寄りに置く @param {any} S */
function layoutKpi(S) {
  const { slide } = S
  const probe = planHead(S, S.fresh())
  const avail = S.bodyBottom - probe.bodyTop
  const items = (Array.isArray(slide.items) ? slide.items : []).filter((it) => it && typeof it === 'object').slice(0, 8)
    .map((it) => ({ label: str(it.label), value: str(it.value), unit: str(it.unit), delta: it.delta, trend: it.trend, note: str(it.note) }))
  const cols = items.length > 4 ? Math.ceil(items.length / 2) : items.length
  const valueSize = cols <= 2 ? S.u(48) : cols === 3 ? S.u(44) : S.u(40)
  const head = planHead(S, S.real)
  head.emit(S.ops)
  if (!items.length) return
  const row = planKpiRow(S, S.real, items, S.L, S.cw, { valueSize, minH: S.u(190) })
  if (row.h > avail + 1) S.over(S.real, 'KPI のカードが高すぎる')
  row.emit(S.ops, head.bodyTop + Math.max(0, (avail - row.h) * 0.4), row.h)
}

/** compare: items 2〜3 個の列をカードで。highlight は accent の縁と tint の地 @param {any} S */
function layoutCompare(S) {
  const { slide, u } = S
  const probe = planHead(S, S.fresh())
  const avail = S.bodyBottom - probe.bodyTop
  const raw = (Array.isArray(slide.items) ? slide.items : []).filter((it) => it && typeof it === 'object').slice(0, 3)
  const n = raw.length
  const gap = u(20)
  const cardW = n ? (S.cw - gap * (n - 1)) / n : S.cw
  const pad = u(22)
  const inner = cardW - 2 * pad
  const titleSize = Math.round(S.SZ.lead * 1.15 * 10) / 10

  /** @param {Env} env @param {number} tier @param {number[]} keeps */
  const build = (env, tier, keeps) => {
    const size = bodySize(S, tier)
    const pitch = size * 1.6
    const gapP = size * 0.45
    return raw.map((it, i) => {
      const note = addTag(env, 'Note', 0)
      const title = textBlock(env, it.title, { font: 'sansBold', size: titleSize, color: S.C.ink, measure: inner, pitch: 1.35 })
      for (const ln of title.lines) for (const g of ln.glyphs) g.tag = note
      const points = (Array.isArray(it.points) ? it.points : []).slice(0, keeps[i]).map((p) => {
        const li = addTag(env, 'P', note)
        return breakInlines(env, inlinesOf(typeof p === 'object' && p ? p.text ?? '' : p), { font: 'sans', size, color: S.C.ink, tag: li }, { measure: Math.max(inner - 1.35 * size, size), align: 'left', phrase: true })
      }).filter((l) => l.length)
      const h = pad + title.h + u(14) + points.reduce((s, l) => s + l.length * pitch, 0) + gapP * Math.max(0, points.length - 1) + pad
      return { it, title, points, h, size, pitch, gapP }
    })
  }
  const tallest = (/** @type {number} */ tier, /** @type {number[]} */ keeps) => Math.max(0, ...build(S.fresh(), tier, keeps).map((c) => c.h))
  const keeps = raw.map((it) => (Array.isArray(it.points) ? it.points.length : 0))
  // 3 枚の囲みは 1 枚の幅が 190pt ほど。20pt では 1 行 9 字で折れて細長くなるので、上げるのは 16pt まで（-2 の段）
  let tier = Math.max(-growN(S), -2)
  while (tier < TIERS - 1 && tallest(tier, keeps) > (tier < 0 ? avail * GROW_FILL : avail)) tier++
  /** @type {string[]} */
  const dropped = []
  for (let guard = 0; guard < 80 && tallest(tier, keeps) > avail; guard++) {
    // 一番高い列の最後の点から落とす
    const cs = build(S.fresh(), tier, keeps)
    let k = 0
    cs.forEach((c, i) => { if (c.h > cs[k].h) k = i })
    if (keeps[k] <= 0) break
    keeps[k]--
    dropped.push(`${plainOf(raw[k].title).slice(0, 12)} の ${keeps[k] + 1} 点目`)
  }
  const head = planHead(S, S.real)
  head.emit(S.ops)
  const cards = build(S.real, tier, keeps)
  const cardH = Math.min(avail, Math.max(0, ...cards.map((c) => c.h), avail * 0.55))
  cards.forEach((c, i) => {
    const x = S.L + i * (cardW + gap)
    const y = head.bodyTop
    const hi = !!c.it.highlight
    const r = u(S.flat ? 4 : 12)
    S.ops.push(rectOp(x, y, cardW, cardH, hi ? { fill: S.C.tint, stroke: S.C.accent, lw: 1.5, r } : { fill: S.C.paper, stroke: S.C.rule, lw: 0.75, r }))
    drawText(S.real, S.ops, c.title, x + pad, y + pad)
    const ry = y + pad + c.title.h + u(6)
    S.ops.push(ruleOp(x + pad, ry, x + cardW - pad, ry, 0.75, hi ? S.C.accent : S.C.rule))
    let yy = y + pad + c.title.h + u(14)
    for (const lines of c.points) {
      const base0 = yy + (c.pitch - c.size) / 2 + BASE_RATIO * c.size
      S.ops.push(dotOp(x + pad + 0.42 * c.size, base0 - 0.3 * c.size, 0.19 * c.size, hi || !S.flat ? S.C.accent : S.C.ink))
      lines.forEach((ln, k) => {
        for (const op of lineOps(S.real, ln, x + pad + 1.35 * c.size, yy + k * c.pitch + (c.pitch - c.size) / 2 + BASE_RATIO * c.size)) S.ops.push(op)
      })
      yy += lines.length * c.pitch + c.gapP
    }
  })
  for (const d of dropped) S.over(S.real, d)
}

/** statement: 1 つの文を大きく、本文の高さの少し上寄りに。上に細い帯、下に小さな補足 @param {any} S */
function layoutStatement(S) {
  const { slide, u, SZ } = S
  const top = S.T + u(30)
  const sizes = [SZ.statement, Math.round(SZ.statement * 0.88 * 10) / 10, Math.round(SZ.statement * 0.76 * 10) / 10]
  const make = (/** @type {Env} */ env) => ({
    sentence: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes, maxLines: 4, measure: S.cw * 0.86, pitch: 1.4 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead], maxLines: 3, measure: Math.min(S.cw * 0.62, S.textMax), pitch: 1.55 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(3) + u(22) + probe.sentence.h + (probe.sub ? u(24) + probe.sub.h : 0)
  const y0 = top + Math.max(0, (S.bodyBottom - top - total) * 0.45)
  const kicker = str(slide.kicker) || str(S.ctx.section)
  bandOps(S, S.ops, { kicker, right: str(slide.kicker) && str(S.ctx.section) && str(slide.kicker) !== str(S.ctx.section) ? str(S.ctx.section) : '' })
  const m = make(S.real)
  S.ops.push(barOp(S, S.L, y0, u(48), u(3)))
  const sy = y0 + u(3) + u(22)
  drawText(S.real, S.ops, m.sentence, S.L, sy)
  S.outline.push({ title: S.title, level: 2, y: r2(sy) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.L, sy + m.sentence.h + u(24))
}

/** quote: 大きな引用と by。引用の頭に grad の大きな引用符 @param {any} S */
function layoutQuote(S) {
  const { slide, u, SZ } = S
  const text = slide.quote ?? slide.title ?? ''
  const sizes = [Math.round(SZ.statement * 0.9 * 10) / 10, Math.round(SZ.statement * 0.8 * 10) / 10, Math.round(SZ.statement * 0.7 * 10) / 10]
  const make = (/** @type {Env} */ env) => ({
    label: slide.title ? textBlock(env, slide.title, { font: 'sansBold', size: SZ.label, color: S.flat ? S.C.ink : S.C.accent, role: 'H2', measure: S.cw * 0.6, pitch: 1.4 }) : null,
    q: fitText(S, env, text, { font: 'sansBold', color: S.C.ink, role: 'BlockQuote', sizes, maxLines: 7, measure: S.cw * 0.8, pitch: 1.5 }),
    by: slide.by ? textBlock(env, slide.by, { font: 'sans', size: SZ.body[0], color: S.C.sub, role: 'P', measure: S.cw * 0.6, pitch: 1.5 }) : null,
  })
  const probe = make(S.fresh())
  const markH = u(28)
  const total = (probe.label ? probe.label.h + u(18) : 0) + markH + u(18) + probe.q.h + (probe.by ? u(22) + probe.by.h : 0)
  const top = S.T + u(30)
  const y0 = top + Math.max(0, (S.bodyBottom - top - total) * 0.45)
  bandOps(S, S.ops, { kicker: str(slide.kicker) || str(S.ctx.section), right: '' })
  const m = make(S.real)
  const markSize = u(100)
  let my = y0
  if (m.label) {
    drawText(S.real, S.ops, m.label, S.L, my)
    S.outline.push({ title: S.title, level: 2, y: r2(my) })
    my += m.label.h + u(18)
  }
  const mark = textBlock(S.real, '“', { font: 'sansBold', size: markSize, color: S.C.ink, measure: u(120), pitch: 1 })
  // 引用符の字は em の箱の上 15〜43% にある。箱を上へずらして、見える所の上端を my に合わせる
  drawText(S.real, S.ops, mark, S.L - u(2), my - 0.15 * markSize, S.flat ? {} : { paint: S.C.grad })
  const qy = my + markH + u(18)
  drawText(S.real, S.ops, m.q, S.L, qy)
  if (m.by) {
    const by = qy + m.q.h + u(22)
    S.ops.push(rectOp(S.L, by + m.by.pitch / 2 - u(0.75), u(24), u(1.5), { fill: S.flat ? S.C.ink : S.C.accent }))
    drawText(S.real, S.ops, m.by, S.L + u(34), by)
  }
}

/** cover: 題（grad の字）・副題・作り手と日付。背景に光 @param {any} S */
function layoutCover(S) {
  const { slide, u, SZ, ctx } = S
  decor(S, 'cover')
  const sizes = [SZ.cover, Math.round(SZ.cover * 0.9), Math.round(SZ.cover * 0.8), Math.round(SZ.cover * 0.7)]
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H1', sizes, maxLines: 3, measure: S.cw * 0.74, pitch: 1.22 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.coverSub], maxLines: 3, measure: Math.min(S.cw * 0.62, S.textMax * 1.1), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(4) + u(24) + probe.title.h + (probe.sub ? u(22) + probe.sub.h : 0)
  const y0 = S.H * 0.47 - total / 2
  bandOps(S, S.ops, { kicker: str(slide.kicker), right: '' })
  const m = make(S.real)
  S.ops.push(barOp(S, S.L, y0, u(64), u(4)))
  const ty = y0 + u(4) + u(24)
  drawText(S.real, S.ops, m.title, S.L, ty, S.flat ? {} : { paint: S.C.grad })
  S.outline.push({ title: S.title, level: 1, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.L, ty + m.title.h + u(22))
  const by = str(slide.by) ? [str(slide.by), str(slide.date)].filter(Boolean).join('　') : [str(ctx.author), str(slide.date) || str(ctx.date)].filter(Boolean).join('　')
  if (by) {
    const bt = textBlock(S.real, by, { font: 'sans', size: SZ.label, color: S.C.sub, role: 'P', measure: S.cw * 0.7, pitch: 1.5 })
    drawText(S.real, S.ops, bt, S.L, S.H - S.B - bt.h)
  }
}

/** section: 大きな番号（grad の細い字）と題と lead @param {any} S */
function layoutSection(S) {
  const { slide, u, SZ, ctx } = S
  decor(S, 'section')
  const no = str(slide.number).trim() || String(ctx.sectionNo || 1).padStart(2, '0')
  const sizes = [SZ.section, Math.round(SZ.section * 0.88), Math.round(SZ.section * 0.76)]
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H1', sizes, maxLines: 2, measure: S.cw * 0.7, pitch: 1.25 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead], maxLines: 3, measure: Math.min(S.cw * 0.55, S.textMax), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const digits = 0.73 * SZ.sectionNo
  const total = digits + u(24) + probe.title.h + (probe.sub ? u(14) + probe.sub.h : 0)
  const y0 = S.H * 0.47 - total / 2
  const m = make(S.real)
  const num = textBlock(S.real, no, { font: 'sans', size: SZ.sectionNo, color: S.C.ink, measure: S.cw, pitch: 1 })
  drawText(S.real, S.ops, num, S.L - u(4), y0 - 0.14 * SZ.sectionNo, S.flat ? {} : { paint: S.C.grad })
  const ty = y0 + digits + u(24)
  drawText(S.real, S.ops, m.title, S.L, ty)
  S.outline.push({ title: S.title, level: 1, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.L, ty + m.title.h + u(14))
}

/** closing: 結びの文（grad の字）と、右に「次の一歩」のカード @param {any} S */
function layoutClosing(S) {
  const { slide, u, SZ } = S
  decor(S, 'closing')
  const steps = (Array.isArray(slide.items) ? slide.items : []).map((it) => (typeof it === 'string' ? it : str(it && (it.text ?? it.title ?? it.label)))).filter(Boolean).slice(0, 6)
  const leftW = steps.length ? S.cw * 0.5 : S.cw * 0.7
  const sizes = [SZ.section, Math.round(SZ.section * 0.88), Math.round(SZ.section * 0.76)]
  const make = (/** @type {Env} */ env) => ({
    title: fitText(S, env, slide.title, { font: 'sansBold', color: S.C.ink, role: 'H2', sizes, maxLines: 4, measure: leftW, pitch: 1.28 }),
    sub: slide.lead ? fitText(S, env, slide.lead, { font: 'sans', color: S.C.sub, role: 'P', sizes: [SZ.lead], maxLines: 4, measure: Math.min(leftW, S.textMax), pitch: 1.6 }) : null,
  })
  const probe = make(S.fresh())
  const total = u(4) + u(22) + probe.title.h + (probe.sub ? u(18) + probe.sub.h : 0)
  const cy = S.H * 0.48
  const y0 = cy - total / 2
  const m = make(S.real)
  S.ops.push(barOp(S, S.L, y0, u(64), u(4)))
  const ty = y0 + u(4) + u(22)
  drawText(S.real, S.ops, m.title, S.L, ty, S.flat ? {} : { paint: S.C.grad })
  S.outline.push({ title: S.title, level: 2, y: r2(ty) })
  if (m.sub) drawText(S.real, S.ops, m.sub, S.L, ty + m.title.h + u(18))
  if (!steps.length) return

  const cardW = S.cw * 0.4
  const cx = S.R - cardW
  const pad = u(24)
  const numW = u(34)
  const size = SZ.body[0] + 1
  const pitch = size * 1.55
  const labelText = S.ctx.lang === 'en' ? 'NEXT STEPS' : '次の一歩'
  const lab = textBlock(S.real, labelText, { font: 'sansBold', size: SZ.label - 1, color: S.flat ? S.C.ink : S.C.accent, measure: cardW - 2 * pad, pitch: 1.4 })
  const list = addTag(S.real, 'L', 0)
  const rows = steps.map((t, i) => {
    const li = addTag(S.real, 'LI', list)
    const lbl = addTag(S.real, 'Lbl', li)
    const body = addTag(S.real, 'LBody', li)
    const n = textLine(S.real, String(i + 1), { font: 'sansBold', size: u(22), color: S.C.ink, tag: lbl })
    const lines = breakInlines(S.real, [{ text: t }], { font: 'sans', size, color: S.C.ink, tag: body }, { measure: cardW - 2 * pad - numW, align: 'left', phrase: true })
    return { n, lines, h: Math.max(lines.length * pitch, u(26)) }
  })
  const rowGap = u(14)
  const h = pad + lab.h + u(16) + rows.reduce((s, r) => s + r.h, 0) + rowGap * (rows.length - 1) + pad
  const y = Math.max(S.T + u(30), cy - h / 2)
  S.ops.push(rectOp(cx, y, cardW, h, { fill: S.C.paper, stroke: S.C.rule, lw: 0.75, r: u(S.flat ? 4 : 14) }))
  drawText(S.real, S.ops, lab, cx + pad, y + pad)
  let yy = y + pad + lab.h + u(16)
  rows.forEach((r, i) => {
    if (i > 0) S.ops.push(ruleOp(cx + pad, yy - rowGap / 2, cx + cardW - pad, yy - rowGap / 2, 0.5, S.C.rule))
    if (r.n) {
      const base = yy + (u(26) - u(22)) / 2 + BASE_RATIO * u(22)
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

/** 型の名前 → 組む関数 @type {Record<string, (S: any) => void>} */
const BUILDERS = {
  cover: layoutCover, section: layoutSection, statement: layoutStatement, content: layoutContent, split: layoutSplit, figure: layoutFigure,
  kpi: layoutKpi, compare: layoutCompare, table: layoutContent, quote: layoutQuote, closing: layoutClosing,
}

/**
 * 1 枚を 1 頁の Op にする。はみ出しは §4.3（字を下げる → 落として warnings）。
 * @param {any} slide
 * @param {Ctx} ctx
 * @returns {{ ops: Op[], warnings: string[], outline: { title: string, level: number, y: number }[], missing: string[], counts: any }}
 */
export function laySlide(slide, ctx) {
  const S = makeState(slide && typeof slide === 'object' ? slide : {}, ctx)
  const asked = str(S.slide.layout)
  const kind = LAYOUTS.includes(asked) ? asked : 'content'
  if (asked && kind !== asked) S.warn(S.real, `${ctx.index + 1} 枚目の layout（${asked.slice(0, 20)}）は知らないので content で組んだ`)
  BUILDERS[kind](S)
  if (!NO_FOOT.has(kind)) emitFoot(S, S.ops)
  return { ops: S.ops, warnings: S.warnings, outline: S.outline, missing: [...S.real.missing], counts: S.real.counts }
}
