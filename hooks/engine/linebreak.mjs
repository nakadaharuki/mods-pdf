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
// 空きを配る順（JLReq 3.8.3 / 3.8.4）
//   詰める: ① 欧文の語間（四分まで）→ ② 約物の空き → ③ 和欧間（八分まで）
//   伸ばす: ① 欧文の語間（二分まで）→ ② 和欧間（二分まで）→ ③ 字間（和字の間に均等・悪さで重く罰する）
// 選ばなかった案: 設計書 §3.2 の 6 の旧順（詰める 約物→和欧間→語間・伸ばす 和欧間→語間）。JLReq は語間を最初の段に置く。
//   旧順では和欧間（本文に多い）が先に動き、同じ行の和欧間どうしが揃わず、目標の四分からのずれが大きくなった（bench-30 の標準偏差 0.067 → 0.063）。

import { CL, classOf, classOfCp, effectiveBlank, halfSpace, inseparable, noBreakAfter, noBreakBefore, spaceBetween } from './jlreq.mjs'
import { advOf, layoutRuby, parseRuby, splitOverhang } from './ruby.mjs'
import { hyphenPoints } from '../vendor/text.mjs'

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
 *   lang?: 'ja'|'en',
 * }} BreakOptions
 * hanging（ぶら下げ）は設計書の名前だけ受け取り、v0.1 では使わない（行末の約物は空きを取って揃える）。
 * lang が 'en' の時だけ、欧文の語にハイフンの切り目を足す。既定の 'ja' では欧文の語を割らない（日本語の文書の組みを動かさない）。
 */
/** @typedef {{ c: string, x: number, font: FontId, size: number, color?: string, bold?: boolean, tag?: number, link?: string }} LineGlyph */
/** @typedef {{ glyphs: { c: string, x: number }[], font: FontId, size: number, color?: string, tag?: number, baseX: number, baseW: number }} LineRuby */
/** @typedef {{ glyphs: LineGlyph[], rubies: LineRuby[], width: number, spread: number, last: boolean, start: number, overfull?: true, underfull?: true, forcedBreak?: true, hyphenated?: true }} Line */

const LINE_PENALTY = 10
const RUNT_BADNESS = 9000
const PHRASE_PENALTY = 300
const WORD_SPLIT_PENALTY = 1000
/**
 * 英語のハイフン（lang が 'en' の時だけ）。費用の形は TeX と同じ（行の費用 = (LINE_PENALTY + 悪さ)^2 に、切り目の罰の 2 乗を足す）。
 * 選ばなかった案: TeX の値そのもの（hyphenpenalty 50・doublehyphendemerits 10000・finalhyphendemerits 5000）。
 * TeX の値は、悪さが 0〜100 に収まる行の費用が数百〜数千の物差し。ここは字間を開ける行に床（SPREAD_FLOOR）を足すので普通の行の費用が 7 万前後にあり、
 * TeX の値だと罰が軽すぎて、A5 の英文 2 本で 2 行続きのハイフンが 10 行・18 行出た。TeX と同じ比で効くよう 3 倍・50 倍・50 倍にした。
 * DOUBLE_HYPHEN_DEMERITS は前の行もハイフンで終わっている行に、FINAL_HYPHEN_DEMERITS は最後から 2 行目がハイフンで終わる時に足す
 */
const HYPHEN_PENALTY = 150
const DOUBLE_HYPHEN_DEMERITS = 500000
const FINAL_HYPHEN_DEMERITS = 250000
/** 割る語の下限（芯の英字の数）。短い語を割っても行は整わず、読みにくくなるだけ */
const HYPHEN_MIN_WORD = 6
/** ハイフンの字。U+2010 でなく U+002D にして、抜き出した文字列やコピーで普通のハイフンとして読めるようにする（Typst と同じ） */
const HYPHEN_CP = 0x2d
/** 入らない行の費用。普通の行の費用（最大でも MAX_BAD の 2 乗）より大きくして、入る切り方があれば必ずそちらを選ぶ */
const FALLBACK_COST = 1e12
/** 悪さの上限。字間の開きが大きい行どうしの優劣が付かなくならないよう、字間を 0.5em 開けた行（MAX_SPREAD_EM）の悪さより大きく取る */
const MAX_BAD = 1e5
/** 字間に足してよい量の目安（em）。この量で悪さが 100 になる。③を重く罰するために、①②の上限（二分・語間の 1.5 倍）よりずっと小さく取る */
const CAP3_EM = 0.05
/** 段ごとの重み。先に使う段ほど軽く、後の段ほど重く数える（段の順は JLReq 3.8.3 / 3.8.4 のとおり） */
const W_STRETCH1 = 0.5
const W_SHRINK1 = 0.3
const W_SHRINK2 = 0.7
const W_SHRINK3 = 1
/** 字間にこれ以上足さないと揃わない行は、揃えずに自然な幅で左に寄せる（字間が 0.5em も開いた行より、行末が揃わない行のほうが読める） */
const MAX_SPREAD_EM = 0.5
/**
 * 詰めだけで入る行の悪さの最大。詰めの 3 段（語間・約物の空き・和欧間）を使い切った行がここに届く。
 */
const SHRINK_MAX_BAD = 100 * (W_SHRINK1 + W_SHRINK2 + W_SHRINK3)
/**
 * 字間（③）を開けないと揃わない行に足す床。JLReq 3.8.2 は「詰めを先に、詰める所が無い時だけ伸ばす」と順序で決めている。
 * 重みの比べ合いにすると、足りない 1em を 30 の字間に配った悪さ（約 4）が、約物の空き 1 つを全部詰めた悪さ（30）に勝ってしまい、
 * 詰めて入る行を選ばずに字間を 0.02em 開けた。詰めの最大より大きい床を足して、詰めで入る切り方があれば必ずそちらを選ぶ。
 */
const SPREAD_FLOOR = SHRINK_MAX_BAD + 50
const STRETCH_FLOOR = SHRINK_MAX_BAD + 50
const EPS = 1e-6
/** JLReq 3.8.4 の (c) が字間に開けてよい上限（em）。これを超える時は (d) で約物の前後にも配る */
const CAP_C_EM = 0.25
/** 字間を開けて揃える所に使わない字のクラス（JLReq 3.1.11）。始め括弧・終わり括弧・ハイフン・区切り約物・中点・句点・読点・和字間隔 */
/** @type {Set<number>} */
const NO_SPREAD = new Set([CL.OPENING, CL.CLOSING, CL.HYPHEN, CL.DIVIDING, CL.MIDDLE_DOT, CL.FULL_STOP, CL.COMMA, CL.IDEOGRAPHIC_SPACE])

/**
 * @typedef {{
 *   k: 'c'|'w'|'s'|'r', s: Span, ch: string, cls: number, idx: number, nl: boolean, chars: string[], part?: string,
 * }} Tok
 */

/** @typedef {{ glyphs: { c: string, x: number }[], font: FontId, size: number, color?: string, tag?: number }} AtomRuby */

/**
 * ルビが親字より長い時に前後の字へ掛ける量（pt）。ovL・ovR は前後が仮名などで切れていない時の計画、
 * blankL・blankR は掛ける相手が約物の空き（その分は詰められる空きから引く）か。lay は掛ける量を渡して親字の x を出し直す。
 * @typedef {{
 *   slack: { left: number, right: number, total: number }, lay: (overL: number, overR: number) => number[],
 *   capL: number, capR: number, blankL: boolean, blankR: boolean, ovL: number, ovR: number,
 * }} RubyHang
 */

/**
 * @typedef {{
 *   kind: 'cjk'|'word'|'ruby', w: number, size: number,
 *   glyphs: LineGlyph[], ruby: null | AtomRuby, rb: null | RubyHang,
 *   idx: number, nch: number, fc: string, lc: string, aFirst: number, aLast: number,
 *   sb: number, eb: number, sp: Tok | null, wordId: number, hyId: number,
 * }} Atom
 */

/**
 * 空き（gap）。縮められる量は sh1 約物の空き・sh2 和欧間・sh3 語間、伸ばせる量は st1 和欧間・st2 語間。
 * 配る順は縮める時 sh3 → sh1 → sh2、伸ばす時 st2 → st1（JLReq 3.8.3 / 3.8.4）。番号は種類の名前で、順ではない。
 * st3 は字間（③）を配ってよい所、st4 は (d) で約物の前後も含めて配ってよい所。
 * @typedef {{
 *   legal: boolean, pen: number, forced: boolean, space: Tok | null,
 *   nat: number, sh1: number, sh2: number, sh3: number, st1: number, st2: number, st3: boolean, st4: boolean, hy: number,
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
      // モノルビは親字 1 字ごとが独立した塊で、間で行を分けてよく、字間も開けてよい（JLReq 3.3.7）。
      // グループルビ・熟語ルビは親字全体が 1 つの塊で、分けず、字間も開けない
      const { mono, segments } = parseRuby(s.ruby, chars.length)
      if (mono) {
        chars.forEach((ch, i) => toks.push({ k: 'r', s, ch, cls: classOf(ch), idx: idx + i, nl: false, chars: [ch], part: segments[i] }))
      } else {
        toks.push({ k: 'r', s, ch: chars[0], cls: classOf(chars[0]), idx, nl: false, chars })
      }
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

/** 語の頭と尻に付いていても、割る語の芯から外す ASCII の約物 */
const HYPHEN_LEAD = new Set(['(', '[', '{', '"', "'"])
const HYPHEN_TRAIL = new Set([')', ']', '}', '"', "'", '.', ',', ';', ':', '!', '?'])

/**
 * 欧文の語（27 の連なり）の中で、ハイフンを置いてよい位置（語の何字目の前か）。
 * 割るのは、頭と尻の約物を外した芯が小文字の英字だけで HYPHEN_MIN_WORD 字以上の語。大文字で始まる語（固有名詞・文頭）、
 * 大文字が混ざる語（iPhone）、数字や記号が混ざる語（URL・版番号・縮約形）は割らない。
 * 左 2 字・右 3 字を残す規則（TeX の lefthyphenmin 2・righthyphenmin 3）はパターンの側が持つ。
 * @param {Tok[]} word
 * @returns {number[]}
 */
function hyphenCuts(word) {
  let a = 0
  let b = word.length
  while (a < b && HYPHEN_LEAD.has(word[a].ch)) a++
  while (b > a && HYPHEN_TRAIL.has(word[b - 1].ch)) b--
  if (b - a < HYPHEN_MIN_WORD) return []
  let core = ''
  for (let i = a; i < b; i++) core += word[i].ch
  if (!/^[a-z]+$/.test(core)) return []
  return hyphenPoints(core).map((p) => p + a)
}

/**
 * @param {Tok[]} toks
 * @param {Record<string, FontMetricsLike>} metrics
 * @param {number} measure
 * @param {'ja'|'en'} lang
 * @returns {Atom[]}
 */
function buildAtoms(toks, metrics, measure, lang) {
  /** @type {Atom[]} */
  const atoms = []
  /** @type {Tok | null} */
  let pendingSp = null
  let wordSeq = 0
  let hyphSeq = 0
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
        const cuts = lang === 'en' ? hyphenCuts(word) : []
        if (cuts.length === 0) {
          made = [
            {
              kind: 'word', w: lw.w, size: word[0].s.size, glyphs: lw.glyphs, ruby: null, rb: null, idx: word[0].idx, nch: word.length,
              fc: word[0].ch, lc: word[word.length - 1].ch, aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: -1, hyId: -1,
            },
          ]
        } else {
          // 語全体を 1 度並べて（カーニング込み）から切り目で割る。割った幅の合計は割らない時の幅と同じで、行の途中では見た目が変わらない
          const id = hyphSeq++
          const edges = [0, ...cuts, word.length]
          made = []
          for (let e = 1; e < edges.length; e++) {
            const s0 = edges[e - 1]
            const e0 = edges[e]
            made.push({
              kind: 'word', w: lw.lefts[e0] - lw.lefts[s0], size: word[0].s.size,
              glyphs: lw.glyphs.slice(s0, e0).map((g) => ({ ...g, x: g.x - lw.lefts[s0] })), ruby: null, rb: null,
              idx: word[s0].idx, nch: e0 - s0, fc: word[s0].ch, lc: word[e0 - 1].ch, aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: -1, hyId: id,
            })
          }
        }
      } else {
        // 行長より長い語（URL など）は、最後の手段として字ごとに割れる塊にする
        const id = wordSeq++
        made = word.map((tk, k) => ({
          kind: /** @type {const} */ ('word'), w: lw.lefts[k + 1] - lw.lefts[k], size: tk.s.size,
          glyphs: [{ ...lw.glyphs[k], x: 0 }], ruby: null, rb: null, idx: tk.idx, nch: 1,
          fc: tk.ch, lc: tk.ch, aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: id, hyId: -1,
        }))
      }
    } else if (t.k === 'r') {
      i++
      const s = t.s
      const base = t.chars.join('')
      const lay = (/** @type {number} */ overL, /** @type {number} */ overR) =>
        layoutRuby(base, t.part ?? /** @type {string} */ (s.ruby), { size: s.size, font: s.font, metrics, overL, overR })
      const lr = lay(0, 0)
      /** @type {AtomRuby} */
      const rub = { glyphs: lr.ruby, font: s.font, size: lr.rubySize }
      if (s.color !== undefined) rub.color = s.color
      if (s.tag !== undefined) rub.tag = s.tag
      made = [
        {
          kind: 'ruby', w: lr.width, size: s.size, glyphs: t.chars.map((c, k) => mkGlyph(c, lr.baseXs[k], s)), ruby: rub,
          rb: { slack: lr.slack, lay: (a, b) => lay(a, b).baseXs, capL: 0, capR: 0, blankL: false, blankR: false, ovL: 0, ovR: 0 },
          idx: t.idx, nch: t.chars.length, fc: t.chars[0], lc: t.chars[t.chars.length - 1], aFirst: 0, aLast: 0, sb: 0, eb: 0, sp: null, wordId: -1, hyId: -1,
        },
      ]
    } else {
      i++
      const s = t.s
      const adv = advOf(metricsOf(metrics, s.font), /** @type {number} */ (t.ch.codePointAt(0)))
      made = [
        {
          kind: 'cjk', w: adv * s.size, size: s.size, glyphs: [mkGlyph(t.ch, 0, s)], ruby: null, rb: null, idx: t.idx, nch: 1,
          fc: t.ch, lc: t.ch, aFirst: adv, aLast: adv,
          sb: effectiveBlank(halfSpace(t.ch).before, adv) * s.size,
          eb: effectiveBlank(halfSpace(t.ch).after, adv) * s.size,
          sp: null, wordId: -1, hyId: -1,
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
const NO_GAP = { legal: false, pen: 0, forced: false, space: null, nat: 0, sh1: 0, sh2: 0, sh3: 0, st1: 0, st2: 0, st3: false, st4: false, hy: 0 }

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
    return { legal: true, pen: WORD_SPLIT_PENALTY, forced: true, space: null, nat: 0, sh1: 0, sh2: 0, sh3: 0, st1: 0, st2: 0, st3: false, st4: false, hy: 0 }
  }
  if (A.hyId >= 0 && A.hyId === B.hyId) {
    // 語の中の切り目。割らなければ幅 0 のつなぎ目で、伸び縮みも字間もない（語の中の字は動かさない）。割ったら行末にハイフンの字が付く
    const last = A.glyphs[A.glyphs.length - 1]
    return {
      legal: true, pen: HYPHEN_PENALTY, forced: false, space: null, nat: 0, sh1: 0, sh2: 0, sh3: 0, st1: 0, st2: 0, st3: false, st4: false,
      hy: advOf(metricsOf(metrics, last.font), HYPHEN_CP) * last.size,
    }
  }
  const a = A.lc
  const b = B.fc
  const kinsoku = !(noBreakAfter(a) || noBreakBefore(b))
  const em = A.size
  const pair = spaceBetween(a, b, { advA: A.aLast, advB: B.aFirst })
  // 原稿の半角空白が和字と欧字の間にある時は、空白の幅でなく和欧間（四分・八分まで詰め・二分まで伸ばす。JLReq 3.8.3 / 3.8.4）にする。
  // 空白のまま語間にすると、空白なしで書いた和欧間（0.25em）と幅が揃わず、同じ紙面で和欧間のばらつきが出た。
  // 約物と欧字の間（「。 Apple」など）は spaceBetween が和欧間にしないので、原稿の空白の幅のまま。
  // 空白の字は残す（抜き出した文字列で語がつながらないように）。行を分けてよいのも空白があった時と同じ
  const wide = (/** @type {Atom} */ t) => t.kind === 'cjk' || t.kind === 'ruby'
  const autospace = B.sp !== null && pair.kind === 'autospace' && ((wide(A) && B.kind === 'word') || (A.kind === 'word' && wide(B)))
  // JLReq 3.8.3: 行の途中の句点（cl-06）の後ろの二分アキは、文の区切りとして残す。詰める量に入れない。
  // 行末の句点の後ろは、行の幅を出す lineNatural が空きを取る（詰める量の外で、いつも取る）
  const stopHeld = classOf(a) === CL.FULL_STOP
  if (B.sp && !autospace) {
    const sw = spaceAdvEm(metricsOf(metrics, B.sp.s.font)) * B.sp.s.size
    return {
      legal: kinsoku, pen: 0, forced: false, space: B.sp,
      nat: sw, sh1: (stopHeld ? 0 : A.eb) + B.sb, sh2: 0, sh3: sw * 0.2, st1: 0, st2: sw * 0.5, st3: false, st4: false, hy: 0,
    }
  }
  const rawA = effectiveBlank(halfSpace(a).after, A.aLast)
  const rawB = effectiveBlank(halfSpace(b).before, B.aFirst)
  // JLReq 3.1.11: 括弧・句読点・中点・区切り約物・ハイフン・和字間隔の前後は、字間を開けて揃える所に使わない。
  // 約物の空きは詰める側だけに使い、開ける量は和字どうしの字間に回す
  const sep = inseparable(a, b)
  const noSpread = sep || NO_SPREAD.has(classOf(a)) || NO_SPREAD.has(classOf(b))
  const autospaceGap = pair.kind === 'autospace'
  return {
    legal: kinsoku && !sep,
    pen: !autospace && phraseSet && !phraseSet.has(B.idx) ? PHRASE_PENALTY : 0,
    forced: false,
    space: autospace ? B.sp : null,
    nat: (pair.natural - rawA - rawB) * em,
    sh1: pair.kind === 'punct' && !stopHeld ? pair.natural * em : 0,
    sh2: pair.kind === 'autospace' ? (pair.natural - pair.min) * em : 0,
    sh3: 0,
    st1: pair.kind === 'autospace' ? (pair.max - pair.natural) * em : 0,
    st2: 0,
    st3: !noSpread && !autospaceGap,
    st4: !sep,
    hy: 0,
  }
}

/**
 * 親字より長いルビが、隣の塊の上へ掛けられる量の上限（pt）と、その相手が約物の空きか。JLReq 3.3.8 の (2)〜(5)。
 * side は相手がルビの前（before）か後ろ（after）か。
 *   - 平仮名・片仮名・長音・小書きの仮名・分離禁止の字・中点: その字の上へルビ文字 1 字分まで。
 *   - 終わり括弧・句点・読点: 後ろに来る時はその字の上へ、前に来る時はその字の後ろの二分アキの上へ（アキを詰めた行ではその分まで）。
 *   - 始め括弧: 後ろに来る時はその前の二分アキの上へ。前に来る時は掛けない。
 *   - 漢字・欧文・別のルビ・空白をはさむ相手には掛けない（(1)）。
 * 選ばなかった案: 前に来る始め括弧の上へ半字まで掛ける。3.3.8 が「好ましくないという意見」を載せ、「 」の墨の上にルビが乗るので掛けない側にした。
 * @param {Atom | null} N
 * @param {'before'|'after'} side
 * @param {number} rubySize
 * @returns {{ cap: number, blank: boolean }}
 */
function hangRoom(N, side, rubySize) {
  const none = { cap: 0, blank: false }
  if (!N || N.kind !== 'cjk') return none
  switch (classOf(N.fc)) {
    case CL.HIRAGANA:
    case CL.KATAKANA:
    case CL.PROLONGED:
    case CL.SMALL_KANA:
    case CL.INSEPARABLE:
    case CL.MIDDLE_DOT:
      return { cap: Math.min(rubySize, N.w), blank: false }
    case CL.CLOSING:
    case CL.FULL_STOP:
    case CL.COMMA:
      return side === 'after' ? { cap: Math.min(rubySize, N.w), blank: false } : { cap: Math.min(rubySize, N.eb), blank: true }
    case CL.OPENING:
      return side === 'after' ? { cap: Math.min(rubySize, N.sb), blank: true } : none
    default:
      return none
  }
}

/**
 * 親字より長いルビを持つ塊ごとに、前後の字へ掛ける量を決めて rb.ovL・rb.ovR に入れる。切れた側に掛けない処理は buildLine にある。
 * 1 つの字の両側にルビが来る時は、お互いが触れないよう掛ける量を半分にする（3.3.8 が挙げる 2 つの方法のうち、両方の掛けを減らす方）。
 * @param {Atom[]} atoms
 */
function planHang(atoms) {
  const n = atoms.length
  for (let i = 0; i < n; i++) {
    const rb = atoms[i].rb
    if (!rb || rb.slack.total <= EPS) continue
    const rubySize = /** @type {AtomRuby} */ (atoms[i].ruby).size
    const before = i > 0 && !atoms[i].sp ? hangRoom(atoms[i - 1], 'before', rubySize) : { cap: 0, blank: false }
    const after = i + 1 < n && !atoms[i + 1].sp ? hangRoom(atoms[i + 1], 'after', rubySize) : { cap: 0, blank: false }
    rb.capL = before.cap
    rb.blankL = before.blank
    rb.capR = after.cap
    rb.blankR = after.blank
  }
  for (let i = 1; i + 1 < n; i++) {
    const L = atoms[i - 1].rb
    const R = atoms[i + 1].rb
    if (!L || !R || atoms[i + 1].sp || atoms[i].sp) continue
    if (L.capR > 0 && R.capL > 0) {
      L.capR /= 2
      R.capL /= 2
    }
  }
  for (const a of atoms) {
    if (!a.rb) continue
    const o = splitOverhang(a.rb.slack, a.rb.capL, a.rb.capR)
    a.rb.ovL = o.left
    a.rb.ovR = o.right
  }
}

/**
 * ルビが前後の字に掛かる分だけ、2 つの塊の間の自然な幅を負にする。相手が約物の空きなら、詰められる空きもその分減らす
 * （詰めると掛けた先の字の墨にルビが乗るため。3.3.8 (3) の「詰められた空き量まで」）。行が切れる所では gap を使わないので掛からない。
 * @param {Gap} g
 * @param {Atom} A
 * @param {Atom} B
 */
function applyHang(g, A, B) {
  if (A.rb && A.rb.ovR > 0) {
    g.nat -= A.rb.ovR
    if (A.rb.blankR) g.sh1 = Math.max(0, g.sh1 - A.rb.ovR)
  }
  if (B.rb && B.rb.ovL > 0) {
    g.nat -= B.rb.ovL
    if (B.rb.blankL) g.sh1 = Math.max(0, g.sh1 - B.rb.ovL)
  }
}

/**
 * 行の悪さ（行ごとに何度も呼ぶ熱い経路）で使う。Math.min と直に書かず、モジュールの変数に取っておく。
 * フックの環境（vm の文脈）は大域の名前の参照が遅く、20 万字で組版が 3.7 秒 → 0.76 秒になった（Node では差が出ない）
 */
const min = Math.min

/** @param {number} x */
const cube = (x) => x * x * x

/**
 * 字間（段階③）を 1 つの字間に開ける量（pt）。JLReq 3.8.4 の (c) は、約物の前後を避けた和字どうしの字間に四分まで。
 * それで足りない時と、避けた字間しか無い時は、(d) で約物の前後にも均等に配る（分離禁止の字間だけは配らない）。
 * 開ける所が無ければ null
 * @param {number} r 段階①②の後に残った量（pt）
 * @param {number} n3 (c) の字間の数
 * @param {number} n4 (d) でだけ使う字間の数
 * @param {number} em
 * @returns {{ per: number, all: boolean } | null}
 */
function spreadPer(r, n3, n4, em) {
  if (n3 > 0 && r / n3 / em <= CAP_C_EM) return { per: r / n3, all: false }
  if (n3 + n4 > 0) return { per: r / (n3 + n4), all: true }
  return null
}

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

  const lang = opts.lang === 'en' ? 'en' : 'ja'
  const atoms = buildAtoms(resolveSpaces(tokenize(spans)), metrics, measure, lang)
  const n = atoms.length
  if (n === 0) return []
  planHang(atoms)
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
  for (let i = 1; i < n; i++) {
    const g = buildGap(atoms[i - 1], atoms[i], metrics, phraseSet)
    applyHang(g, atoms[i - 1], atoms[i])
    gaps.push(g)
  }

  // 累積和。行 [q, p) の中の空きは gaps[q + 1 .. p - 1]
  const PW = new Float64Array(n + 1)
  const MA = new Int32Array(n + 1)
  const GN = new Float64Array(n)
  /** 行がその位置で終わる時に足すハイフンの幅（HYW[p] は atoms[p - 1] の後ろで切る時） */
  const HYW = new Float64Array(n + 1)
  const SH1 = new Float64Array(n)
  const SH2 = new Float64Array(n)
  const SH3 = new Float64Array(n)
  const ST1 = new Float64Array(n)
  const ST2 = new Float64Array(n)
  const N3 = new Int32Array(n)
  const N4 = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    PW[i + 1] = PW[i] + atoms[i].w
    MA[i + 1] = MA[i] + (noBreakBefore(atoms[i].fc) ? 0 : atoms[i].nch)
    if (i > 0) {
      const g = gaps[i]
      GN[i] = GN[i - 1] + g.nat
      HYW[i] = g.hy
      SH1[i] = SH1[i - 1] + g.sh1
      SH2[i] = SH2[i - 1] + g.sh2
      SH3[i] = SH3[i - 1] + g.sh3
      ST1[i] = ST1[i - 1] + g.st1
      ST2[i] = ST2[i - 1] + g.st2
      N3[i] = N3[i - 1] + (g.st3 ? 1 : 0)
      N4[i] = N4[i - 1] + (g.st4 && !g.st3 ? 1 : 0)
    }
  }

  /** 行 [q, p) の自然な幅。行頭の始め括弧の前の空きと行末の約物の後の空きは取り、語の中で切るなら行末のハイフンの幅を足す */
  const lineNatural = (/** @type {number} */ q, /** @type {number} */ p) =>
    PW[p] - PW[q] + GN[p - 1] - GN[q] + (q === 0 ? indentPt : 0) - atoms[q].sb - atoms[p - 1].eb + HYW[p]

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
      // c1 語間 → c2 約物の空き → c3 和欧間 の順に詰める
      const c1 = SH3[p - 1] - SH3[q]
      const c2 = SH1[p - 1] - SH1[q]
      const c3 = SH2[p - 1] - SH2[q]
      const shr = -need
      if (shr > c1 + c2 + c3 + EPS) return -1
      const y1 = min(shr, c1)
      const y2 = min(shr - y1, c2)
      const y3 = shr - y1 - y2
      let b = 0
      if (c1 > 0) b += W_SHRINK1 * cube(y1 / c1)
      if (c2 > 0) b += W_SHRINK2 * cube(y2 / c2)
      if (c3 > 0) b += W_SHRINK3 * cube(y3 / c3)
      return 100 * b
    }
    if (need <= EPS) return 0
    if (!isJustify(isLast)) return isLast ? 0 : min(MAX_BAD, 100 * cube(need / (0.5 * measure)))
    const S1 = ST1[p - 1] - ST1[q]
    const S2 = ST2[p - 1] - ST2[q]
    const n3 = N3[p - 1] - N3[q]
    const n4 = N4[p - 1] - N4[q]
    // x2 語間 → x1 和欧間 の順に伸ばす
    const x2 = min(need, S2)
    let r = need - x2
    const x1 = min(r, S1)
    r -= x1
    let b = 0
    if (S2 > 0) b += W_STRETCH1 * cube(x2 / S2)
    if (S1 > 0) b += cube(x1 / S1)
    let floor = STRETCH_FLOOR
    if (r > EPS) {
      const sp = spreadPer(r, n3, n4, emRef)
      if (sp) {
        b += cube(sp.per / emRef / CAP3_EM)
        floor = SPREAD_FLOOR
      } else {
        // 字間を開けられない行（欧文だけ）は、語間を上限を超えて開ける
        const cap = S1 + S2
        return cap > 0 ? min(MAX_BAD, 100 * cube(need / cap)) : MAX_BAD
      }
    }
    return min(MAX_BAD, 100 * b + floor)
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
      // 前の行もハイフンで終わっていれば 2 行続き、次が最後の行なら最後から 2 行目がハイフンで終わっている（費用の足し方は TeX と同じ）
      if (g && g.hy > 0 && q > 0 && gaps[q].hy > 0) dem += DOUBLE_HYPHEN_DEMERITS
      if (isLast && q > 0 && gaps[q].hy > 0) dem += FINAL_HYPHEN_DEMERITS
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
      const c1 = SH3[p - 1] - SH3[q]
      const c2 = SH1[p - 1] - SH1[q]
      const c3 = SH2[p - 1] - SH2[q]
      const shr = -need
      const y1 = Math.min(shr, c1)
      const y2 = Math.min(shr - y1, c2)
      const y3 = Math.min(shr - y1 - y2, c3)
      for (let k = q + 1; k < p; k++) {
        const g = gaps[k]
        let d = 0
        if (c1 > 0) d += (g.sh3 / c1) * y1
        if (c2 > 0) d += (g.sh1 / c2) * y2
        if (c3 > 0) d += (g.sh2 / c3) * y3
        adj[k - q] = -d
      }
    } else if (need > EPS && isJustify(isLast)) {
      const S1 = ST1[p - 1] - ST1[q]
      const S2 = ST2[p - 1] - ST2[q]
      const n3 = N3[p - 1] - N3[q]
      const n4 = N4[p - 1] - N4[q]
      let x2 = Math.min(need, S2)
      let r = need - x2
      let x1 = Math.min(r, S1)
      r -= x1
      let s3 = 0
      let toAll = false
      if (r > EPS) {
        const sp = spreadPer(r, n3, n4, emRef)
        if (sp) {
          if (sp.per / emRef <= MAX_SPREAD_EM) {
            s3 = sp.per
            toAll = sp.all
          }
        } else if (S2 > 0) x2 += r
        else if (S1 > 0) x1 += r
      }
      for (let k = q + 1; k < p; k++) {
        const g = gaps[k]
        let d = 0
        if (S1 > 0) d += (g.st1 / S1) * x1
        if (S2 > 0) d += (g.st2 / S2) * x2
        if (g.st3 || (toAll && g.st4)) d += s3
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
      // 親字より長いルビが前後の字に掛かるのは、行の中でつながっている側だけ。切れた側（行頭・行末）はルビの端を行に揃えて、親字をその分内側へ置く
      const baseXs = A.rb ? A.rb.lay(k > q ? A.rb.ovL : 0, k < p - 1 ? A.rb.ovR : 0) : null
      A.glyphs.forEach((gl, j) => glyphs.push({ ...gl, x: x + (baseXs ? baseXs[j] : gl.x) }))
      if (A.ruby) {
        /** @type {LineRuby} */
        const r = { glyphs: A.ruby.glyphs.map((rg) => ({ c: rg.c, x: x + rg.x })), font: A.ruby.font, size: A.ruby.size, baseX: x, baseW: A.w }
        if (A.ruby.color !== undefined) r.color = A.ruby.color
        if (A.ruby.tag !== undefined) r.tag = A.ruby.tag
        rubies.push(r)
      }
      x += A.w
    }
    // 語の中で切った行は、行末にハイフンを置く。字の書体・大きさ・色・tag は語の最後の字と同じ
    const hyphenated = !isLast && gaps[p].hy > 0
    if (hyphenated) {
      const lastGlyph = atoms[p - 1].glyphs[atoms[p - 1].glyphs.length - 1]
      glyphs.push({ ...lastGlyph, c: String.fromCodePoint(HYPHEN_CP), x })
      x += gaps[p].hy
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
    if (hyphenated) line.hyphenated = true
    return line
  }
}
