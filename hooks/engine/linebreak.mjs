// @ts-check
// 段落を行に分ける。Knuth-Plass（段落全体の悪さの合計を最小にする）を、日本語の組版向けに作り直した物。
//
// 選ばなかった案:
//   - TeX の箱・のり・罰の列をそのまま使う案: 行頭の始め括弧の天付きと行末の約物の詰めは「切れた所によって前後の字の幅が変わる」ので、
//     罰の幅で表すと次の行の頭に効かない。字の塊（atom）の間の空き（gap）を持ち、行 [q, p) の幅を累積和から O(1) で出す形にした。
//   - 字間を最初から均等に伸ばす案: 全角だけの行が行長にぴったり収まる時でも空きを動かしてしまう。
//     行長は字の大きさの整数倍なので、収まる行は空きを一切動かさず、足りない行だけを 3 段の順で配る。
//
//   - 段落末の 1 字の行を「禁止」にする案: 行長が短い（8 字未満）と、1 字を譲らせる字間の開きが 0.2em を超え、
//     字間を開けすぎた行のほうが 1 字の行より読みにくい。禁止でなく悪さ 3000 の罰にして、極端な場合は 1 字の行を選べるようにした。
//   - 切れない箱（行長より長い語・禁則の連なり）で打ち切る案: 行が空になって何も返らない。はみ出しの印か forcedBreak の印を付けて必ず組む。
//
// 空きを配る順（JLReq 3.8）
//   詰める: ① 約物の空き → ② 和欧間（八分まで）→ ③ 欧文の語間
//   伸ばす: ① 和欧間（二分まで）→ ② 欧文の語間 → ③ 字間（和字の間に均等・悪さで重く罰する）

import { CL, classOf, classOfCp, effectiveBlank, halfSpace, inseparable, noBreakAfter, noBreakBefore, spaceBetween } from './jlreq.mjs'
import { advOf, layoutRuby } from './ruby.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ text: string, font: FontId, size: number, color?: string, bold?: boolean, ruby?: string, link?: string, tag?: number }} Span */
/** @typedef {{ adv: (cp: number) => number, run?: (text: string) => { width: number, xs: number[] } }} FontMetricsLike */
/** @typedef {'justify'|'left'|'center'|'right'} Align */
/**
 * @typedef {{
 *   measure: number,
 *   metrics: Record<string, FontMetricsLike>,
 *   indent?: number,
 *   align?: Align,
 *   phrase?: (text: string) => number[],
 *   lastAlign?: Align,
 *   hanging?: boolean,
 * }} BreakOptions
 * hanging（ぶら下げ）は設計書の名前だけ受け取り、v0.1 では使わない（行末の約物は空きを取って揃える）。
 */
/** @typedef {{ c: string, x: number, font: FontId, size: number, color?: string, bold?: boolean, tag?: number, link?: string }} LineGlyph */
/** @typedef {{ glyphs: { c: string, x: number }[], font: FontId, size: number, color?: string, tag?: number, baseX: number, baseW: number }} LineRuby */
/** @typedef {{ glyphs: LineGlyph[], rubies: LineRuby[], width: number, spread: number, last: boolean, start: number, overfull?: true, underfull?: true, forcedBreak?: true }} Line */

const LINE_PENALTY = 10
const RUNT_BADNESS = 3000
const PHRASE_PENALTY = 300
const WORD_SPLIT_PENALTY = 1000
/** 入らない行の費用。普通の行の費用（最大でも MAX_BAD の 2 乗）より大きくして、入る切り方があれば必ずそちらを選ぶ */
const FALLBACK_COST = 1e9
const MAX_BAD = 10000
/** 字間に足してよい量の目安（em）。この量で悪さが 100 になる。③を重く罰するために、①②の上限（二分・語間の 1.5 倍）よりずっと小さく取る */
const CAP3_EM = 0.1
/** 段ごとの重み。約物の空きの詰めは JLReq が最初に勧める手段なので軽く、語間の詰めは目立つので重く数える */
const W_STRETCH1 = 0.5
const W_SHRINK1 = 0.3
const W_SHRINK2 = 0.7
const W_SHRINK3 = 1
/** 字間にこれ以上足さないと揃わない行は、揃えずに自然な幅で左に寄せる（字間が 0.5em も開いた行より、行末が揃わない行のほうが読める） */
const MAX_SPREAD_EM = 0.5
const EPS = 1e-6

/**
 * @typedef {{
 *   k: 'c'|'w'|'s'|'r', s: Span, ch: string, cls: number, idx: number, nl: boolean, chars: string[],
 * }} Tok
 */

/** @typedef {{ glyphs: { c: string, x: number }[], font: FontId, size: number, color?: string, tag?: number }} AtomRuby */

/**
 * @typedef {{
 *   kind: 'cjk'|'word'|'ruby', w: number, size: number,
 *   glyphs: LineGlyph[], ruby: null | AtomRuby,
 *   idx: number, nch: number, fc: string, lc: string, aFirst: number, aLast: number,
 *   sb: number, eb: number, sp: Tok | null, wordId: number,
 * }} Atom
 */

/**
 * @typedef {{
 *   legal: boolean, pen: number, forced: boolean, space: Tok | null,
 *   nat: number, sh1: number, sh2: number, sh3: number, st1: number, st2: number, st3: boolean,
 * }} Gap
 */

/** @type {FontMetricsLike} */
const FALLBACK_METRICS = { adv: () => NaN }

/**
 * @param {Record<string, FontMetricsLike>} metrics
 * @param {string} font
 */
function metricsOf(metrics, font) {
  return (metrics && metrics[font]) || FALLBACK_METRICS
}

/** @param {FontMetricsLike} m */
function spaceAdvEm(m) {
  const a = m.adv(0x20)
  return Number.isFinite(a) && a > 0 ? a : 0.25
}

/**
 * @param {string} c
 * @param {number} x
 * @param {Span} s
 * @returns {LineGlyph}
 */
function mkGlyph(c, x, s) {
  /** @type {LineGlyph} */
  const g = { c, x, font: s.font, size: s.size }
  if (s.color !== undefined) g.color = s.color
  if (s.bold !== undefined) g.bold = s.bold
  if (s.tag !== undefined) g.tag = s.tag
  if (s.link) g.link = s.link
  return g
}

/**
 * 字の列（Span の text）を 1 字ずつの印にする。字の数え方はコードポイント（サロゲート対は 1 字）。
 * @param {Span[]} spans
 * @returns {Tok[]}
 */
function tokenize(spans) {
  /** @type {Tok[]} */
  const toks = []
  let idx = 0
  for (const s of spans) {
    const chars = Array.from(typeof s.text === 'string' ? s.text : '')
    if (chars.length === 0) continue
    if (s.ruby) {
      toks.push({ k: 'r', s, ch: chars[0], cls: classOf(chars[0]), idx, nl: false, chars })
      idx += chars.length
      continue
    }
    for (const ch of chars) {
      const cp = /** @type {number} */ (ch.codePointAt(0))
      const cls = classOfCp(cp)
      const k = cls === CL.WESTERN_SPACE ? 's' : cls === CL.WESTERN ? 'w' : 'c'
      toks.push({ k, s, ch, cls, idx, nl: cp === 10 || cp === 13, chars: [ch] })
      idx++
    }
  }
  return toks
}

/**
 * 空白を整える。前後の空白は捨て、続く空白は 1 つにし、和字と和字の間の改行だけの空白は消す
 * （Markdown の段落の途中の改行が日本語では空白にならないため）。
 * @param {Tok[]} toks
 * @returns {Tok[]}
 */
function resolveSpaces(toks) {
  /** @type {Tok[]} */
  const out = []
  let i = 0
  while (i < toks.length) {
    if (toks[i].k !== 's') {
      out.push(toks[i])
      i++
      continue
    }
    let j = i
    let real = -1
    while (j < toks.length && toks[j].k === 's') {
      if (real < 0 && !toks[j].nl) real = j
      j++
    }
    const prev = out.length ? out[out.length - 1] : null
    const next = j < toks.length ? toks[j] : null
    i = j
    if (!prev || !next) continue
    const wide = (/** @type {Tok} */ t) => t.k === 'c' || t.k === 'r'
    if (real < 0 && wide(prev) && wide(next)) continue
    out.push(toks[real >= 0 ? real : j - 1])
  }
  return out
}

/**
 * 欧文の語（27 の連なり）を並べる。書体と大きさが同じ連なりごとに metrics の run（カーニング込み）で幅を出す。
 * @param {Tok[]} word
 * @param {Record<string, FontMetricsLike>} metrics
 * @returns {{ glyphs: LineGlyph[], w: number, lefts: number[] }}
 */
function layoutWord(word, metrics) {
  /** @type {LineGlyph[]} */
  const glyphs = []
  /** @type {number[]} */
  const lefts = []
  let off = 0
  for (let a = 0; a < word.length; ) {
    const s = word[a].s
    let b = a + 1
    while (b < word.length && word[b].s.font === s.font && word[b].s.size === s.size) b++
    const m = metricsOf(metrics, s.font)
    const count = b - a
    let xs = /** @type {number[] | null} */ (null)
    let width = 0
    if (typeof m.run === 'function') {
      try {
        const r = m.run(word.slice(a, b).map((t) => t.ch).join(''))
        if (r && Array.isArray(r.xs) && r.xs.length === count && Number.isFinite(r.width)) {
          xs = r.xs
          width = r.width
        }
      } catch {
        xs = null
      }
    }
    if (!xs) {
      xs = []
      let at = 0
      for (let k = a; k < b; k++) {
        xs.push(at)
        at += advOf(m, /** @type {number} */ (word[k].ch.codePointAt(0)))
      }
      width = at
    }
    for (let k = a; k < b; k++) {
      const left = off + xs[k - a] * s.size
      lefts.push(left)
      glyphs.push(mkGlyph(word[k].ch, left, word[k].s))
    }
    off += width * s.size
    a = b
  }
  lefts.push(off)
  return { glyphs, w: off, lefts }
}

/**
 * @param {Tok[]} toks
 * @param {Record<string, FontMetricsLike>} metrics
 * @param {number} measure
 * @returns {Atom[]}
 */
function buildAtoms(toks, metrics, measure) {
  /** @type {Atom[]} */
  const atoms = []
  /** @type {Tok | null} */
  let pendingSp = null
  let wordSeq = 0
  for (let i = 0; i < toks.length; ) {
    const t = toks[i]
    if (t.k === 's') {
      pendingSp = t
      i++
      continue
    }
    /** @type {Atom[]} */
    let made
    if (t.k === 'w') {
      let j = i
      while (j < toks.length && toks[j].k === 'w') j++
      const word = toks.slice(i, j)
      const lw = layoutWord(word, metrics)
      i = j
      if (lw.w <= measure + EPS || word.length === 1) {
        made = [
          {
            kind: 'word', w: lw.w, size: word[0].s.size, glyphs: lw.glyphs, ruby: null, idx: word[0].idx, nch: word.length,
            fc: word[0].ch, lc: word[word.length - 1].ch, aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: -1,
          },
        ]
      } else {
        // 行長より長い語（URL など）は、最後の手段として字ごとに割れる塊にする
        const id = wordSeq++
        made = word.map((tk, k) => ({
          kind: /** @type {const} */ ('word'), w: lw.lefts[k + 1] - lw.lefts[k], size: tk.s.size,
          glyphs: [{ ...lw.glyphs[k], x: 0 }], ruby: null, idx: tk.idx, nch: 1,
          fc: tk.ch, lc: tk.ch, aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: id,
        }))
      }
    } else if (t.k === 'r') {
      i++
      const s = t.s
      const lr = layoutRuby(t.chars.join(''), /** @type {string} */ (s.ruby), { size: s.size, font: s.font, metrics })
      /** @type {AtomRuby} */
      const rub = { glyphs: lr.ruby, font: s.font, size: lr.rubySize }
      if (s.color !== undefined) rub.color = s.color
      if (s.tag !== undefined) rub.tag = s.tag
      made = [
        {
          kind: 'ruby', w: lr.width, size: s.size, glyphs: t.chars.map((c, k) => mkGlyph(c, lr.baseXs[k], s)), ruby: rub,
          idx: t.idx, nch: t.chars.length, fc: t.chars[0], lc: t.chars[t.chars.length - 1], aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: -1,
        },
      ]
    } else {
      i++
      const s = t.s
      const adv = advOf(metricsOf(metrics, s.font), /** @type {number} */ (t.ch.codePointAt(0)))
      made = [
        {
          kind: 'cjk', w: adv * s.size, size: s.size, glyphs: [mkGlyph(t.ch, 0, s)], ruby: null, idx: t.idx, nch: 1,
          fc: t.ch, lc: t.ch, aFirst: adv, aLast: adv,
          sb: effectiveBlank(halfSpace(t.ch).before, adv) * s.size,
          eb: effectiveBlank(halfSpace(t.ch).after, adv) * s.size,
          sp: null, wordId: -1,
        },
      ]
    }
    made[0].sp = pendingSp
    pendingSp = null
    for (const a of made) atoms.push(a)
  }
  return atoms
}

/** @type {Gap} */
const NO_GAP = { legal: false, pen: 0, forced: false, space: null, nat: 0, sh1: 0, sh2: 0, sh3: 0, st1: 0, st2: 0, st3: false }

/**
 * 2 つの塊の間の空きと、そこで行を分けてよいか。
 * @param {Atom} A
 * @param {Atom} B
 * @param {Record<string, FontMetricsLike>} metrics
 * @param {Set<number> | null} phraseSet
 * @returns {Gap}
 */
function buildGap(A, B, metrics, phraseSet) {
  if (A.wordId >= 0 && A.wordId === B.wordId) {
    return { legal: true, pen: WORD_SPLIT_PENALTY, forced: true, space: null, nat: 0, sh1: 0, sh2: 0, sh3: 0, st1: 0, st2: 0, st3: false }
  }
  const a = A.lc
  const b = B.fc
  const kinsoku = !(noBreakAfter(a) || noBreakBefore(b))
  if (B.sp) {
    const sw = spaceAdvEm(metricsOf(metrics, B.sp.s.font)) * B.sp.s.size
    return {
      legal: kinsoku, pen: 0, forced: false, space: B.sp,
      nat: sw, sh1: A.eb + B.sb, sh2: 0, sh3: sw * 0.2, st1: 0, st2: sw * 0.5, st3: false,
    }
  }
  const em = A.size
  const pair = spaceBetween(a, b, { advA: A.aLast, advB: B.aFirst })
  const rawA = effectiveBlank(halfSpace(a).after, A.aLast)
  const rawB = effectiveBlank(halfSpace(b).before, B.aFirst)
  const sep = inseparable(a, b)
  return {
    legal: kinsoku && !sep,
    pen: phraseSet && !phraseSet.has(B.idx) ? PHRASE_PENALTY : 0,
    forced: false,
    space: null,
    nat: (pair.natural - rawA - rawB) * em,
    sh1: pair.kind === 'punct' ? pair.natural * em : 0,
    sh2: pair.kind === 'autospace' ? (pair.natural - pair.min) * em : 0,
    sh3: 0,
    st1: pair.kind === 'autospace' ? (pair.max - pair.natural) * em : 0,
    st2: 0,
    st3: !sep,
  }
}

/** @param {number} x */
const cube = (x) => x * x * x

/**
 * 段落（Span の列）を、行長 measure の行に分ける。
 * @param {Span[]} spans
 * @param {BreakOptions} opts
 * @returns {Line[]}
 */
export function breakParagraph(spans, opts) {
  const measure = Math.max(opts.measure, 1e-3)
  const metrics = opts.metrics
  const align = opts.align ?? 'justify'
  const lastAlign = opts.lastAlign ?? (align === 'justify' ? 'left' : align)

  const atoms = buildAtoms(resolveSpaces(tokenize(spans)), metrics, measure)
  const n = atoms.length
  if (n === 0) return []
  const emRef = atoms[0].size
  const indentPt = align === 'left' || align === 'justify' ? (opts.indent ?? 0) * emRef : 0

  /** @type {Set<number> | null} */
  let phraseSet = null
  if (typeof opts.phrase === 'function') {
    try {
      const bounds = opts.phrase(spans.map((s) => (typeof s.text === 'string' ? s.text : '')).join(''))
      if (Array.isArray(bounds)) phraseSet = new Set(bounds)
    } catch {
      phraseSet = null
    }
  }

  /** @type {Gap[]} */
  const gaps = [NO_GAP]
  for (let i = 1; i < n; i++) gaps.push(buildGap(atoms[i - 1], atoms[i], metrics, phraseSet))

  // 累積和。行 [q, p) の中の空きは gaps[q + 1 .. p - 1]
  const PW = new Float64Array(n + 1)
  const MA = new Int32Array(n + 1)
  const GN = new Float64Array(n)
  const SH1 = new Float64Array(n)
  const SH2 = new Float64Array(n)
  const SH3 = new Float64Array(n)
  const ST1 = new Float64Array(n)
  const ST2 = new Float64Array(n)
  const N3 = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    PW[i + 1] = PW[i] + atoms[i].w
    MA[i + 1] = MA[i] + (noBreakBefore(atoms[i].fc) ? 0 : atoms[i].nch)
    if (i > 0) {
      const g = gaps[i]
      GN[i] = GN[i - 1] + g.nat
      SH1[i] = SH1[i - 1] + g.sh1
      SH2[i] = SH2[i - 1] + g.sh2
      SH3[i] = SH3[i - 1] + g.sh3
      ST1[i] = ST1[i - 1] + g.st1
      ST2[i] = ST2[i - 1] + g.st2
      N3[i] = N3[i - 1] + (g.st3 ? 1 : 0)
    }
  }

  /** 行 [q, p) の自然な幅。行頭の始め括弧の前の空きと行末の約物の後の空きは取る */
  const lineNatural = (/** @type {number} */ q, /** @type {number} */ p) =>
    PW[p] - PW[q] + GN[p - 1] - GN[q] + (q === 0 ? indentPt : 0) - atoms[q].sb - atoms[p - 1].eb

  /** @param {boolean} isLast */
  const isJustify = (isLast) => (isLast ? lastAlign === 'justify' : align === 'justify')

  /**
   * 行の悪さ。詰めても入らない行は -1。
   * @param {number} q
   * @param {number} p
   * @param {boolean} isLast
   */
  const badness = (q, p, isLast) => {
    const need = measure - lineNatural(q, p)
    if (need < -EPS) {
      const c1 = SH1[p - 1] - SH1[q]
      const c2 = SH2[p - 1] - SH2[q]
      const c3 = SH3[p - 1] - SH3[q]
      const shr = -need
      if (shr > c1 + c2 + c3 + EPS) return -1
      const y1 = Math.min(shr, c1)
      const y2 = Math.min(shr - y1, c2)
      const y3 = shr - y1 - y2
      let b = 0
      if (c1 > 0) b += W_SHRINK1 * cube(y1 / c1)
      if (c2 > 0) b += W_SHRINK2 * cube(y2 / c2)
      if (c3 > 0) b += W_SHRINK3 * cube(y3 / c3)
      return 100 * b
    }
    if (need <= EPS) return 0
    if (!isJustify(isLast)) return isLast ? 0 : Math.min(MAX_BAD, 100 * cube(need / (0.5 * measure)))
    const S1 = ST1[p - 1] - ST1[q]
    const S2 = ST2[p - 1] - ST2[q]
    const n3 = N3[p - 1] - N3[q]
    const x1 = Math.min(need, S1)
    let r = need - x1
    const x2 = Math.min(r, S2)
    r -= x2
    let b = 0
    if (S1 > 0) b += W_STRETCH1 * cube(x1 / S1)
    if (S2 > 0) b += cube(x2 / S2)
    if (r > EPS) {
      if (n3 > 0) b += cube(r / n3 / emRef / CAP3_EM)
      else {
        // 字間を開けられない行（欧文だけ）は、語間を上限を超えて開ける
        const cap = S1 + S2
        return cap > 0 ? Math.min(MAX_BAD, 100 * cube(need / cap)) : MAX_BAD
      }
    }
    return Math.min(MAX_BAD, 100 * b)
  }

  /** 行 [q, p) を詰められるだけ詰めた幅 */
  const minWidth = (/** @type {number} */ q, /** @type {number} */ p) =>
    lineNatural(q, p) - (SH1[p - 1] - SH1[q]) - (SH2[p - 1] - SH2[q]) - (SH3[p - 1] - SH3[q])

  /** 詰めても行長を大きく超えるなら、これより後ろの切り方も入らない */
  const tooWide = (/** @type {number} */ q, /** @type {number} */ p) => minWidth(q, p) > measure + emRef

  const best = new Float64Array(n + 1).fill(Infinity)
  const prevQ = new Int32Array(n + 1).fill(-1)
  const forcedAt = new Uint8Array(n + 1)
  best[0] = 0
  for (let q = 0; q < n; q++) {
    const bq = best[q]
    if (bq === Infinity) continue
    let found = false
    let fallbackP = -1
    for (let p = q + 1; p <= n; p++) {
      const isLast = p === n
      const g = isLast ? null : gaps[p]
      if (g && !g.legal) {
        if (tooWide(q, p)) break
        continue
      }
      let b = badness(q, p, isLast)
      if (b < 0) {
        if (!found) fallbackP = p
        break
      }
      found = true
      if (isLast && q > 0 && MA[p] - MA[q] <= 1) b += RUNT_BADNESS
      let dem = (LINE_PENALTY + b) * (LINE_PENALTY + b)
      if (g && g.pen > 0) dem += g.pen * g.pen
      const total = bq + dem
      if (total < best[p]) {
        best[p] = total
        prevQ[p] = q
        forcedAt[p] = 0
      }
    }
    if (!found) {
      // どの切り方でも入らない（行長より広い塊、禁則が続く並び）。最初に切れる所で切ってはみ出しの印を付ける。
      // ただし、そこまで行くと 1em を超えてはみ出し、手前に入る所があるなら、禁則を破って入る所で切る（「あーーーーー…」のような並び）。
      // 禁則を守って大きくはみ出すより、禁則を破るほうが紙面の被害が小さいと見た
      if (fallbackP < 0) {
        fallbackP = q + 1
        while (fallbackP < n && !gaps[fallbackP].legal) fallbackP++
      }
      let target = fallbackP
      let forced = false
      if (minWidth(q, fallbackP) > measure + emRef) {
        let fit = -1
        for (let p = q + 1; p < fallbackP && minWidth(q, p) <= measure + EPS; p++) fit = p
        if (fit > q) {
          target = fit
          forced = true
        }
      }
      const total = bq + FALLBACK_COST
      if (total < best[target]) {
        best[target] = total
        prevQ[target] = q
        forcedAt[target] = forced ? 1 : 0
      }
    }
  }

  /** @type {number[]} */
  const cuts = []
  for (let p = n; p > 0; p = prevQ[p]) cuts.push(p)
  cuts.reverse()

  /** @type {Line[]} */
  const lines = []
  let q = 0
  for (const p of cuts) {
    lines.push(buildLine(q, p, p === n))
    q = p
  }
  return lines

  /**
   * 切り方が決まった行に、空きを配って字の位置を出す。
   * @param {number} q
   * @param {number} p
   * @param {boolean} isLast
   * @returns {Line}
   */
  function buildLine(q, p, isLast) {
    const need = measure - lineNatural(q, p)
    const adj = new Float64Array(p - q)
    let spread = 0
    if (need < -EPS) {
      const c1 = SH1[p - 1] - SH1[q]
      const c2 = SH2[p - 1] - SH2[q]
      const c3 = SH3[p - 1] - SH3[q]
      const shr = -need
      const y1 = Math.min(shr, c1)
      const y2 = Math.min(shr - y1, c2)
      const y3 = Math.min(shr - y1 - y2, c3)
      for (let k = q + 1; k < p; k++) {
        const g = gaps[k]
        let d = 0
        if (c1 > 0) d += (g.sh1 / c1) * y1
        if (c2 > 0) d += (g.sh2 / c2) * y2
        if (c3 > 0) d += (g.sh3 / c3) * y3
        adj[k - q] = -d
      }
    } else if (need > EPS && isJustify(isLast)) {
      const S1 = ST1[p - 1] - ST1[q]
      const S2 = ST2[p - 1] - ST2[q]
      const n3 = N3[p - 1] - N3[q]
      let x1 = Math.min(need, S1)
      let r = need - x1
      let x2 = Math.min(r, S2)
      r -= x2
      let s3 = 0
      if (r > EPS) {
        if (n3 > 0) s3 = r / n3 / emRef <= MAX_SPREAD_EM ? r / n3 : 0
        else if (S2 > 0) x2 += r
        else if (S1 > 0) x1 += r
      }
      for (let k = q + 1; k < p; k++) {
        const g = gaps[k]
        let d = 0
        if (S1 > 0) d += (g.st1 / S1) * x1
        if (S2 > 0) d += (g.st2 / S2) * x2
        if (g.st3) d += s3
        adj[k - q] = d
      }
      spread = s3 > EPS ? s3 / emRef : 0
    }

    /** @type {LineGlyph[]} */
    const glyphs = []
    /** @type {LineRuby[]} */
    const rubies = []
    let x = (q === 0 ? indentPt : 0) - atoms[q].sb
    for (let k = q; k < p; k++) {
      const A = atoms[k]
      if (k > q) {
        const g = gaps[k]
        // 空白も字として残す。抜き出した文字列やコピーで欧文の語の間が詰まらないように。位置は空きの頭
        if (g.space) glyphs.push(mkGlyph(' ', x, g.space.s))
        x += g.nat + adj[k - q]
      }
      for (const gl of A.glyphs) glyphs.push({ ...gl, x: x + gl.x })
      if (A.ruby) {
        /** @type {LineRuby} */
        const r = { glyphs: A.ruby.glyphs.map((rg) => ({ c: rg.c, x: x + rg.x })), font: A.ruby.font, size: A.ruby.size, baseX: x, baseW: A.w }
        if (A.ruby.color !== undefined) r.color = A.ruby.color
        if (A.ruby.tag !== undefined) r.tag = A.ruby.tag
        rubies.push(r)
      }
      x += A.w
    }
    let width = x - atoms[p - 1].eb

    const mode = isLast ? lastAlign : align
    if (mode === 'center' || mode === 'right') {
      const inkLeft = q === 0 ? indentPt : 0
      const shift = Math.max(0, mode === 'center' ? (measure - (width - inkLeft)) / 2 - inkLeft : measure - width)
      if (shift > 0) {
        for (const g of glyphs) g.x += shift
        for (const r of rubies) {
          r.baseX += shift
          for (const rg of r.glyphs) rg.x += shift
        }
        width += shift
      }
    }

    /** @type {Line} */
    const line = { glyphs, rubies, width, spread, last: isLast, start: atoms[q].idx }
    if (width - measure > 0.01) line.overfull = true
    // 揃えるはずの行が、字間を開けすぎないために短いまま残った印。呼び出し側が「揃った行」に数えないため
    else if (isJustify(isLast) && measure - width > 0.01) line.underfull = true
    if (!isLast && (gaps[p].forced || forcedAt[p] === 1)) line.forcedBreak = true
    return line
  }
}
