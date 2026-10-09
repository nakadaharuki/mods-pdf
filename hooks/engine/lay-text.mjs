// @ts-check
// layout の下請け: 字（Inline）を Span にし、linebreak の行（Line）を描く物（Op）にする。純な部品。
//
// 選ばなかった案:
//   - 書体に無い字を、行を組んだ後の glyph で直す案: linebreak は span.font で幅を測るので、組んだ後に書体を替えると
//     幅も揃え方も狂う。Span を作る時に字ごとに書体を決めて割る。
//   - ルビの親字と読みに同じ tag を付けたまま描く案: linebreak は LineRuby.tag に span.tag を写すだけなので、
//     RB（親字）と RT（読み）を分けるには layout が RB→RT の対応を持つ。

import { breakParagraph } from './linebreak.mjs'
import { RUBY_SCALE } from './ruby.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ text: string, bold?: true, ruby?: string, link?: string, code?: true }} Inline */
/** @typedef {{ text: string, font: FontId, size: number, color?: string, ruby?: string, link?: string, tag?: number }} Span */
/** @typedef {{ glyphs: any[], rubies: any[], width: number, spread: number, last: boolean, start: number, overfull?: true, underfull?: true, forcedBreak?: true }} Line */
/** @typedef {{ font: FontId, size: number, color: string, tag?: number }} TextStyle */
/** @typedef {{ role: string, parent: number|null, alt?: string, lang?: string }} Tag */
/** @typedef {{ lines: number, justified: number, maxSpread: number, runts: number, forced: number, overfull: number, underfull: number }} Counts */
/**
 * @typedef {{
 *   theme: any,
 *   metrics: Record<string, any>,
 *   phrase?: (text: string) => number[],
 *   lang: 'ja'|'en',
 *   images: Record<string, any>,
 *   tags: Tag[],
 *   rtOf: Map<number, number>,
 *   missing: Set<string>,
 *   seen: Set<string>,
 *   warnings: string[],
 *   outline: { title: string, level: number, page: number, y: number }[],
 *   counts: Counts,
 * }} Env
 */
/**
 * 頁を割る単位。割れない物は n が 1。
 * rowsOf(a, b) は部品 [a, b) の行数、canCut(a, b) は [a, b) で切って残りを次の頁に続けてよいか。
 * before は頁の頭では捨てる空き行（見出しの上の空き）。keepNext は直後の本文と離さない印。
 * @typedef {{
 *   kind: string,
 *   n: number,
 *   rowsOf: (a: number, b: number) => number,
 *   canCut?: (a: number, b: number) => boolean,
 *   emit: (c: { ops: any[], y0: number, row0: number, page: number, a: number, b: number, trim: number }) => void,
 *   keepNext?: boolean,
 *   before?: number,
 * }} Item
 */

export const REPLACEMENT = String.fromCodePoint(0x3013)
/** 描かずに捨てる字（異体字選択子）。書体に無くても〓にしない */
const isSelector = (/** @type {number} */ cp) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)

/** @type {Record<string, FontId>} */
const BOLD = { mincho: 'minchoBold', minchoBold: 'minchoBold', sans: 'sansBold', sansBold: 'sansBold' }
/** 明朝と無い字の代わりを探す、もう一方の系統 */
/** @type {Record<string, FontId>} */
const ALT = { mincho: 'sans', minchoBold: 'sansBold', sans: 'mincho', sansBold: 'minchoBold' }

/** 字の箱の上端から基線までの比（theme と同じ） */
export const BASE_RATIO = 0.88

/**
 * @param {{ theme: any, metrics: Record<string, any>, phrase?: (text: string) => number[], images?: Record<string, any>, lang?: string }} o
 * @returns {Env}
 */
export function makeEnv({ theme, metrics, phrase, images, lang }) {
  return {
    theme, metrics, phrase, images: images ?? {}, lang: lang === 'en' ? 'en' : 'ja',
    tags: [{ role: 'Document', parent: null }],
    rtOf: new Map(), missing: new Set(), seen: new Set(), warnings: [], outline: [],
    counts: { lines: 0, justified: 0, maxSpread: 0, runts: 0, forced: 0, overfull: 0, underfull: 0 },
  }
}

/** 同じ文は 1 回だけ積む @param {Env} env @param {string} msg */
export function warn(env, msg) {
  if (env.seen.has(msg)) return
  env.seen.add(msg)
  env.warnings.push(msg)
}

/**
 * @param {Env} env
 * @param {string} role
 * @param {number} parent
 * @param {{ alt?: string }} [extra]
 * @returns {number}
 */
export function addTag(env, role, parent, extra) {
  /** @type {Tag} */
  const t = { role, parent }
  if (extra && extra.alt) t.alt = extra.alt
  env.tags.push(t)
  return env.tags.length - 1
}

/** @param {Env} env @param {string} font @param {number} cp */
function hasGlyph(env, font, cp) {
  const m = env.metrics[font]
  return !m || typeof m.has !== 'function' || m.has(cp)
}

/**
 * 字を、書体ごとの連なりに割る。無い字は、もう一方の系統にあればそれで、どちらにも無ければ〓にする。
 * @param {Env} env
 * @param {string} text
 * @param {FontId} font
 * @returns {{ text: string, font: FontId }[]}
 */
export function fixRuns(env, text, font) {
  const alt = ALT[font]
  /** @type {{ text: string, font: FontId }[]} */
  const out = []
  /** @type {{ text: string, font: FontId } | null} */
  let cur = null
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0))
    let f = font
    let c = ch
    if (!hasGlyph(env, font, cp)) {
      if (isSelector(cp)) continue
      if (hasGlyph(env, alt, cp)) f = alt
      else if (/\s/u.test(ch)) c = ' '
      else {
        env.missing.add(ch)
        c = REPLACEMENT
        if (!hasGlyph(env, font, 0x3013) && hasGlyph(env, alt, 0x3013)) f = alt
      }
    }
    if (cur && cur.font === f) cur.text += c
    else {
      cur = { text: c, font: f }
      out.push(cur)
    }
  }
  return out
}

/**
 * ルビのように 1 つの書体で出したい字: 全部の字がある方を選び、それでも無い字は〓にする。
 * @param {Env} env @param {string} text @param {FontId} font
 * @returns {{ text: string, font: FontId }}
 */
function singleRun(env, text, font) {
  const all = (/** @type {FontId} */ f) => { for (const ch of text) if (!hasGlyph(env, f, /** @type {number} */ (ch.codePointAt(0)))) return false; return true }
  let f = font
  if (!all(font) && all(ALT[font])) f = ALT[font]
  let out = ''
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0))
    if (hasGlyph(env, f, cp)) out += ch
    else if (isSelector(cp)) continue
    else if (/\s/u.test(ch)) out += ' '
    else { env.missing.add(ch); out += REPLACEMENT }
  }
  return { text: out, font: f }
}

/**
 * Inline の列を Span の列にする。
 * @param {Env} env
 * @param {Inline[]} inlines
 * @param {TextStyle} st
 * @returns {Span[]}
 */
export function spansOf(env, inlines, st) {
  /** @type {Span[]} */
  const spans = []
  for (const it of inlines) {
    if (!it || typeof it.text !== 'string' || it.text === '') continue
    const font = it.bold ? BOLD[st.font] : st.font
    const color = it.code ? env.theme.colors.sub : st.color
    if (it.ruby) {
      const base = singleRun(env, it.text, font)
      const rt = singleRun(env, it.ruby, base.font)
      /** @type {Span} */
      const sp = { text: base.text, font: base.font, size: st.size, color, ruby: rt.text }
      if (it.link) sp.link = it.link
      if (st.tag !== undefined) {
        const ruby = addTag(env, 'Ruby', st.tag)
        const rb = addTag(env, 'RB', ruby)
        const rtTag = addTag(env, 'RT', ruby)
        env.rtOf.set(rb, rtTag)
        sp.tag = rb
      }
      spans.push(sp)
      continue
    }
    for (const run of fixRuns(env, it.text, font)) {
      /** @type {Span} */
      const sp = { text: run.text, font: run.font, size: st.size, color }
      if (it.link) sp.link = it.link
      if (st.tag !== undefined) sp.tag = st.tag
      spans.push(sp)
    }
  }
  return spans
}

/**
 * 行の数え上げ。はみ出し・揃えなかった行・禁則を破った行は種類ごとに数え、body なら統計にも入れる。
 * @param {Env} env
 * @param {Line[]} lines
 * @param {boolean} body 本文の行（段落・箇条書き・引用・囲み）か
 * @param {boolean} justify 両端揃えの段落か
 */
export function noteLines(env, lines, body, justify) {
  const c = env.counts
  for (const ln of lines) {
    if (ln.overfull) c.overfull++
    if (ln.underfull) c.underfull++
    if (ln.forcedBreak) c.forced++
  }
  if (!body || lines.length === 0) return
  c.lines += lines.length
  for (const ln of lines) {
    if (justify && !ln.last && !ln.underfull) c.justified++
    if (ln.spread > c.maxSpread) c.maxSpread = ln.spread
  }
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]
    let n = 0
    for (const g of last.glyphs) if (g.c !== ' ') n++
    if (n <= 1) c.runts++
  }
}

/**
 * Inline の列を行に分ける。
 * @param {Env} env
 * @param {Inline[]} inlines
 * @param {TextStyle} st
 * @param {{ measure: number, align?: 'justify'|'left'|'center'|'right', indent?: number, phrase?: boolean }} o
 * @param {'body'|'other'} [rec]
 * @returns {Line[]}
 */
export function breakInlines(env, inlines, st, o, rec = 'other') {
  return breakSpans(env, spansOf(env, inlines, st), o, rec)
}

/**
 * 作ってある Span を行に分ける（同じ Span を幅を変えて何度も組む時に、ルビの tag を増やさないため）。
 * @param {Env} env
 * @param {Span[]} spans
 * @param {{ measure: number, align?: 'justify'|'left'|'center'|'right', indent?: number, phrase?: boolean }} o
 * @param {'body'|'other'} [rec]
 * @returns {Line[]}
 */
export function breakSpans(env, spans, o, rec = 'other') {
  if (spans.length === 0) return []
  const align = o.align ?? 'left'
  /** @type {any} */
  const opts = { measure: o.measure, metrics: env.metrics, indent: o.indent ?? 0, align }
  if (o.phrase && env.phrase) opts.phrase = env.phrase
  // 英語の文書だけ。日本語の文書には lang を渡さず、linebreak の既定（割らない）のままにする
  if (env.lang === 'en') opts.lang = 'en'
  const lines = breakParagraph(spans, opts)
  noteLines(env, lines, rec === 'body', align === 'justify')
  return lines
}

/** 1 行の字（折り返さない）。幅を測る時や短いラベルに使う
 * @param {Env} env @param {string} text @param {TextStyle} st @param {{ align?: 'left'|'center'|'right', measure?: number }} [o]
 * @returns {Line | null} */
export function textLine(env, text, st, o = {}) {
  const lines = breakInlines(env, [{ text }], st, { measure: o.measure ?? 1e5, align: o.align ?? 'left' })
  return lines.length ? lines[0] : null
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} w @param {string} color */
export function ruleOp(x1, y1, x2, y2, w, color) {
  return { t: 'rule', x1, y1, x2, y2, w, color }
}

/**
 * 行を Op の列にする。x0 は行の左端の頁の座標、base は基線。
 * 書体・大きさ・色・tag が同じ間は 1 つの TextOp。ルビは親字の上の TextOp、リンクは字の下の罫と LinkOp。
 * @param {Env} env
 * @param {Line} line
 * @param {number} x0
 * @param {number} base
 * @param {{ untagged?: boolean }} [o] untagged は頁をまたいで出し直す表の頭の行（飾りにする）
 * @returns {any[]}
 */
export function lineOps(env, line, x0, base, o = {}) {
  /** @type {any[]} */
  const ops = []
  const ink = env.theme.colors.ink
  const noTag = !!o.untagged
  /** @type {any} */
  let cur = null
  for (const g of line.glyphs) {
    const color = g.color ?? ink
    const tag = noTag ? undefined : g.tag
    if (cur && cur.font === g.font && cur.size === g.size && cur.color === color && cur.tag === tag) {
      cur.glyphs.push({ c: g.c, x: x0 + g.x })
    } else {
      cur = { t: 'text', font: g.font, size: g.size, color, y: base, glyphs: [{ c: g.c, x: x0 + g.x }] }
      if (tag !== undefined) cur.tag = tag
      ops.push(cur)
    }
  }
  for (const r of line.rubies) {
    const parent = r.size / RUBY_SCALE
    const rt = r.tag === undefined || noTag ? undefined : (env.rtOf.get(r.tag) ?? r.tag)
    /** @type {any} */
    const op = {
      t: 'text', font: r.font, size: r.size, color: r.color ?? ink,
      y: base - parent * BASE_RATIO - r.size * 0.12,
      glyphs: r.glyphs.map((/** @type {{ c: string, x: number }} */ rg) => ({ c: rg.c, x: x0 + rg.x })),
    }
    if (rt !== undefined) op.tag = rt
    ops.push(op)
  }
  // リンク: 同じ url が続く字をひとまとまりにして、字の下の罫と行ごとの四角
  /** @type {{ url: string, x1: number, x2: number, size: number } | null} */
  let run = null
  const flush = () => {
    if (!run) return
    const y = base + run.size * 0.14
    ops.push(ruleOp(x0 + run.x1, y, x0 + run.x2, y, 0.4, ink))
    ops.push({ t: 'link', x: x0 + run.x1, y: base - run.size * BASE_RATIO, w: run.x2 - run.x1, h: run.size, url: run.url })
    run = null
  }
  for (const g of line.glyphs) {
    if (!g.link) { flush(); continue }
    const m = env.metrics[g.font]
    const a = m && typeof m.adv === 'function' ? m.adv(/** @type {number} */ (g.c.codePointAt(0))) : NaN
    const x2 = g.x + (Number.isFinite(a) ? a : 1) * g.size
    if (run && run.url === g.link) run.x2 = x2
    else { flush(); run = { url: g.link, x1: g.x, x2, size: g.size } }
  }
  flush()
  return ops
}

/**
 * 見出しなどの「この字の上端」。em の箱の上端
 * @param {number} base @param {number} size
 */
export const topOf = (base, size) => base - size * BASE_RATIO

/**
 * 行の格子へ切り上げた部品（表・要点・図）を、内容の上下の空きが等しくなるように下げる量。
 * 切り上げの余りを下だけに取ると、前の段落とは 8pt なのに次の段落とは 25pt 離れて、表が上に寄って見えた。
 * 頁の頭（row0 が 0）では下げない。頁の最初の行と上端をそろえる。
 * @param {number} rows 部品が取る行の数 @param {number} contentPt 上下の空きを含む内容の高さ @param {number} lineGap @param {number} row0
 */
export const centerOffset = (rows, contentPt, lineGap, row0) => (row0 > 0 ? Math.max(0, rows * lineGap - contentPt) / 2 : 0)

/** 行数から行送りの整数倍に切り上げた行の数。浮動小数の誤差で 1 行増えないよう 1e-6 を引く
 * @param {number} pt @param {number} lineGap */
export const toRows = (pt, lineGap) => Math.max(1, Math.ceil(pt / lineGap - 1e-6))

/**
 * 行ごとに 1 行ぶんの高さを取る部品（段落・箇条書き・引用・囲み）の描き方。基線は必ず theme.baseline（行の格子）。
 * mark は箇条書きの頭の印。同じ基線に置く。
 * @typedef {{ line: Line | null, x: number, mark?: { line: Line, x: number } }} Entry
 */

/**
 * @param {Env} env
 * @param {{ ops: any[], row0: number }} c 頁の ops と、この部品の先頭の行の番号
 * @param {Entry[]} entries
 * @param {number} a 描く最初の部品
 * @param {number} b 描く最後の次
 */
export function drawEntries(env, c, entries, a, b) {
  for (let i = a; i < b; i++) {
    const base = env.theme.baseline(c.row0 + i - a)
    const e = entries[i]
    if (e.mark) for (const op of lineOps(env, e.mark.line, e.mark.x, base)) c.ops.push(op)
    if (e.line) for (const op of lineOps(env, e.line, e.x, base)) c.ops.push(op)
  }
}

/**
 * 1 行 1 部品の Item。割る時は、頁の頭と末に 1 行だけを残さない（既定）か、cut が許す所で。
 * 選ばなかった案: 3 行の段落を 2+1 に割る。頁末の 1 行か頁頭の 1 行が必ず残るので、割らずに次の頁へ送る。
 * @param {Env} env
 * @param {string} kind
 * @param {Entry[]} entries
 * @param {{ cut?: (a: number, b: number) => boolean, under?: (c: any) => void }} [spec]
 * @returns {Item}
 */
export function rowsItem(env, kind, entries, spec = {}) {
  const n = entries.length
  return {
    kind, n,
    rowsOf: (a, b) => b - a,
    canCut: spec.cut ?? ((a, b) => b - a >= 2 && n - b >= 2),
    emit: (c) => {
      if (spec.under) spec.under(c)
      drawEntries(env, c, entries, c.a, c.b)
    },
  }
}
