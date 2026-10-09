// @ts-check
// 同じ文を ModsPDF と Typst 0.15.1 で組み、日本語の組版を数字で比べる。
//   node scripts/compare-typst.mjs [--names report,prose,ruby,bench-30] [--samples samples] [--out out] [--typ-dir samples/compare]
// --names を省くと、易しい見本（report・prose・ruby）と samples の bench-*.json（scripts/make-bench.mjs が作る難しい見本）を全部比べる。
// 出力: samples/compare/<名前>.typ（Typst の元）・out/compare/<名前>-mods.pdf・<名前>-typst.pdf・out/compare.md・out/compare.json
//
// 選ばなかった案:
// - 段落の区切りを字下げだけで見分ける案（指示にあった方法）: 表のセル・箇条書き・引用も本文の大きさなら混ざり、
//   両端揃えの行の数が両方の組版で食い違う。入力の段落の字を PDF の行の並びから探して照合する方が公平なので、
//   照合が半分に満たない時だけ字下げの方法に戻す。
// - Typst に ModsPDF の機能（チャート・要点・記入欄）を無理に近づける案: 比べたいのは字の組みだけ。省いた物は表に書く。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readPdfChars, groupLines, lastPageFill, markedRuns } from './lib-pdftext.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

/** @typedef {import('../hooks/engine/schema.mjs').Doc} Doc */
/** @typedef {import('../hooks/engine/theme.mjs').Theme} Theme */
/** @typedef {import('./lib-pdftext.mjs').Line} Line */
/** @typedef {import('./lib-pdftext.mjs').PageChars} PageChars */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TYPST_FONT_DIRS = [
  'C:/dev/kit/files/fonts',
  'C:/Users/nakada/.claude/local-mods/nakada-mods/nakada/skills/typst-pdf/fonts',
]

// ---------------------------------------------------------------- 字の種類

/** 行頭に来てはいけない字（指示の一覧のとおり） */
const NO_HEAD = new Set(Array.from('、。，．）」』】〕〉》’”・：；！？ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞ'))
/** 行末に来てはいけない字 */
const NO_TAIL = new Set(Array.from('（「『【〔〈《‘“'))
const OPEN = new Set(Array.from('（「『【〔〈《“‘｛［〝'))
const CLOSE = new Set(Array.from('）」』】〕〉》”’｝］〞'))
const STOP = new Set(Array.from('、。，．'))
const MIDDLE = new Set(Array.from('・'))
const PUNCT = new Set([...OPEN, ...CLOSE, ...STOP, ...MIDDLE])
/** 小書きの仮名と長音。JLReq 3.1.7 の厳しい禁則では行頭に来てはいけない（ゆるい禁則では来てよい）。々・ゝ・ゞ は含めない */
const SMALL_HEAD = new Set(Array.from('ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶー'))

/** @param {string} s */
const cpOf = (s) => s.codePointAt(0) ?? 0

/** 和字（漢字・ひらがな・カタカナ・長音）。約物と中点は含めない @param {string} c */
export function isWaji(c) {
  const cp = cpOf(c)
  if (cp === 0x30fb || cp === 0x3099 || cp === 0x309a) return false
  if (cp === 0x30fc || cp === 0x3005 || cp === 0x3006) return true
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)
}

/** 欧字と数字（半角の幅の字）。全角形は含めない @param {string} c */
export function isLatin(c) {
  const cp = cpOf(c)
  return cp < 0x250 && /^[\p{L}\p{Nd}]/u.test(c)
}

/** 字の右に付く空き（em）。全角の終わり括弧・句読点は半分、中点は四分。比例幅（箱が 1em に満たない）の字は 0 @param {import('./lib-pdftext.mjs').Char} ch */
function blankAfter(ch) {
  if (ch.adv < ch.size * 0.99) return 0
  if (CLOSE.has(ch.c) || STOP.has(ch.c)) return 0.5
  if (MIDDLE.has(ch.c)) return 0.25
  return 0
}

/** 字の左に付く空き（em） @param {import('./lib-pdftext.mjs').Char} ch */
function blankBefore(ch) {
  if (ch.adv < ch.size * 0.99) return 0
  if (OPEN.has(ch.c)) return 0.5
  if (MIDDLE.has(ch.c)) return 0.25
  return 0
}

const SPACE = /^\s/

/** @param {string} s */
const strip = (s) => s.replace(/[\s\p{Cc}\p{Cf}]/gu, '')

// ---------------------------------------------------------------- Typst の元を作る

/** Typst の文字列にする。逃がすのはバックスラッシュと二重引用符だけ @param {string} s */
export function tstr(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * Inline の列を Typst の式の列にする。字はすべて文字列にして、Typst の記法（* _ # など）に化けさせない。
 * 隣り合う飾りなしの字は 1 つの文字列にまとめ、式の間に空白を入れない（空白は本物の空きになる）。
 * ルビは Typst に無いので親字だけにする。
 * @param {any[]} list
 * @param {Theme} theme
 * @param {{ bold?: boolean }} [o]
 * @returns {{ code: string, ruby: number }}
 */
export function inlinesToTypst(list, theme, o = {}) {
  let code = ''
  let ruby = 0
  let plain = ''
  const flush = () => {
    if (plain) {
      code += '#' + (o.bold ? `strong(${tstr(plain)})` : tstr(plain))
      plain = ''
    }
  }
  for (const it of list ?? []) {
    if (it.ruby) ruby++
    if (!it.bold && !it.link && !it.code) {
      plain += it.text
      continue
    }
    flush()
    let e = tstr(it.text)
    if (it.code) e = `highlight(fill: rgb(${tstr(theme.colors.tint)}), ${e})`
    if (it.bold || o.bold) e = `strong(${e})`
    if (it.link) e = `link(${tstr(it.link)}, ${e})`
    code += '#' + e
  }
  flush()
  return { code, ruby }
}

/**
 * Doc を Typst の元にする。版面は makeTheme と同じ。字の組みを比べるために、チャート・svg・画像・要点・囲み・記入欄は省く。
 * @param {Doc} doc
 * @param {Theme} theme
 * @returns {{ typ: string, omitted: Record<string, number>, ruby: number }}
 */
export function docToTypst(doc, theme) {
  const c = theme.colors
  const pt = (/** @type {number} */ v) => `${Math.round(v * 1000) / 1000}pt`
  const omitted = { chart: 0, svg: 0, image: 0, keys: 0, card: 0, fields: 0 }
  let ruby = 0
  /** @param {any[]} inl @param {boolean} [bold] */
  const il = (inl, bold) => {
    const r = inlinesToTypst(inl, theme, { bold })
    ruby += r.ruby
    return r.code
  }
  const lang = doc.lang === 'en' ? 'lang: "en", region: "us"' : 'lang: "ja", region: "jp"'
  const foot = doc.author ? `${doc.author} ／ ${doc.title}` : doc.title
  const bodyFont = doc.body === 'gothic' ? '("Noto Sans JP", "Zen Old Mincho")' : '("Zen Old Mincho", "Noto Sans JP")'

  /** @type {string[]} */
  const out = []
  out.push(`// ModsPDF の samples から scripts/compare-typst.mjs が作った元。手で直さない。`)
  out.push(`#set document(title: ${tstr(doc.title)}${doc.author ? `, author: ${tstr(doc.author)}` : ''})`)
  out.push(`#set page(width: ${pt(theme.page.width)}, height: ${pt(theme.page.height)}, margin: (left: ${pt(theme.left)}, right: ${pt(theme.right)}, top: ${pt(theme.top)}, bottom: ${pt(theme.bottom)}), footer: context [`)
  out.push(`  #set text(size: 8pt, fill: rgb(${tstr(c.sub)}))`)
  out.push(`  #line(length: 100%, stroke: 0.5pt + rgb(${tstr(c.rule)}))`)
  out.push(`  #align(right)[#${tstr(foot)}#h(1em)#counter(page).display()#" / "#counter(page).final().first()]`)
  out.push(`])`)
  // 行の送りは 1.75 倍: 行の箱を 1em（上 1em・下 0）にして、行間 0.75em を足す。段落の間も同じ行間にして格子に乗せる
  out.push(`#set text(font: ${bodyFont}, ${lang}, size: ${pt(theme.size)}, fill: rgb(${tstr(c.ink)}), top-edge: 1em, bottom-edge: 0pt)`)
  out.push(`#set par(justify: true, first-line-indent: (amount: 1em, all: true), leading: 0.75em, spacing: 0.75em, linebreaks: "optimized")`)
  out.push(`#set smartquote(enabled: false)`)
  out.push(`#show heading: it => {`)
  out.push(`  set par(first-line-indent: 0pt, justify: false)`)
  out.push(`  let (size, rule) = if it.level == 1 { (${pt(theme.head.h1.size)}, ${pt(theme.head.h1.rule)}) } else if it.level == 2 { (${pt(theme.head.h2.size)}, ${pt(theme.head.h2.rule)}) } else { (${pt(theme.head.h3.size)}, 0pt) }`)
  out.push(`  block(above: ${pt(theme.lineGap * 1.2)}, below: ${pt(theme.lineGap * 0.6)}, sticky: true)[`)
  out.push(`    #text(size: size, weight: "bold")[#it.body]`)
  out.push(`    #if rule > 0pt [#v(0.2em)#line(length: 100%, stroke: rule + rgb(${tstr(c.accent)}))]`)
  out.push(`  ]`)
  out.push(`}`)
  out.push(`#show list: set par(first-line-indent: 0pt, justify: false)`)
  out.push(`#show enum: set par(first-line-indent: 0pt, justify: false)`)
  out.push(`#show table: set par(first-line-indent: 0pt, justify: false)`)
  out.push(`#show table: set text(size: 8.5pt)`)
  out.push('')
  // 題名の塊（ModsPDF は doc.title から題名の塊をいつも作る。ここでは同じ大きさ・罫の形で置く）
  out.push(`#block(below: ${pt(theme.lineGap * 0.8)})[`)
  out.push(`  #set par(first-line-indent: 0pt, justify: false)`)
  out.push(`  #text(size: ${pt(theme.title.size)}, weight: "bold")[${'#' + tstr(doc.title)}]`)
  out.push(`  #v(0.25em)`)
  out.push(`  #line(length: 100%, stroke: ${pt(theme.title.rule)} + rgb(${tstr(c.accent)}))`)
  out.push(`]`)
  out.push('')

  /** @param {any} item @returns {string} */
  const listItem = (item) => {
    if (Array.isArray(item)) return `[${il(item)}]`
    const sub = (item.items ?? []).map((/** @type {any[]} */ s) => `[${il(s)}]`).join(', ')
    const fn = item.ordered ? 'enum' : 'list'
    return `[${il(item.text)}${sub ? `#${fn}(tight: true, ${sub})` : ''}]`
  }

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`#heading(level: ${b.level})[${il(b.text)}]`)
        break
      case 'para':
        out.push(il(b.text))
        break
      case 'list': {
        const items = b.items.map(listItem).join(', ')
        out.push(`#${b.ordered ? 'enum' : 'list'}(tight: true, ${items})`)
        break
      }
      case 'table': {
        const n = b.head.length
        const widths = b.widths && b.widths.length === n ? b.widths.map((w) => `${Math.max(1, Math.round(w * 100)) / 100}fr`).join(', ') : Array(n).fill('auto').join(', ')
        const aligns = Array.from({ length: n }, (_, i) => b.align?.[i] ?? 'left').join(', ')
        const cell = (/** @type {any[]} */ x, /** @type {boolean} */ bold) => `[${il(x, bold)}]`
        const head = b.head.map((x) => cell(x, true)).join(', ')
        const rows = b.rows.map((row) => row.map((x) => cell(x, false)).join(', ')).join(',\n  ')
        out.push(
          `#table(columns: (${widths}${n === 1 ? ',' : ''}), align: (${aligns}${n === 1 ? ',' : ''}), stroke: (x: none, y: 0.4pt + rgb(${tstr(c.rule)})), inset: (x: 5pt, y: 3.5pt), fill: (x, y) => if y == 0 { rgb(${tstr(c.tint)}) } else { none },\n  table.header(${head}),\n  ${rows})`,
        )
        break
      }
      case 'quote':
        out.push(`#block(inset: (left: 10pt), stroke: (left: 1.2pt + rgb(${tstr(c.rule)})))[
#set par(first-line-indent: 0pt)
${il(b.text)}
]`)
        break
      case 'rule':
        out.push(`#line(length: 100%, stroke: 0.5pt + rgb(${tstr(c.rule)}))`)
        break
      case 'pagebreak':
        out.push('#pagebreak()')
        break
      default:
        out.push(`// 省いた: ${b.type}`)
        omitted[/** @type {keyof typeof omitted} */ (b.type)]++
    }
    out.push('')
  }
  return { typ: out.join('\n'), omitted, ruby }
}

// ---------------------------------------------------------------- 組版の数え

/**
 * 入力の段落の字を、PDF の行の並びから探して、段落ごとの行にする。
 * 段落は行の頭から行の末までを占める並びだけを採る（短い段落が見出しの字に紛れ込まない）。
 * @param {Line[]} lines 頁の並び・上から下
 * @param {string[]} paras 段落の字（空白なし）
 * @returns {{ paras: Line[][], matched: number, total: number }}
 */
export function matchParagraphs(lines, paras) {
  /** @type {number[]} */
  const starts = []
  /** @type {Line[]} */
  const kept = []
  let s = ''
  for (const l of lines) {
    const t = strip(l.text)
    if (!t) continue
    starts.push(s.length)
    kept.push(l)
    s += t
  }
  starts.push(s.length)
  /** @type {Map<number, number>} */
  const at = new Map()
  starts.forEach((v, i) => at.set(v, i))
  /** @type {Line[][]} */
  const found = []
  let cursor = 0
  let total = 0
  for (const p of paras) {
    if (!p) continue
    total++
    let from = cursor
    let hit = -1
    for (;;) {
      const idx = s.indexOf(p, from)
      if (idx < 0) break
      if (at.has(idx) && at.has(idx + p.length)) { hit = idx; break }
      from = idx + 1
    }
    if (hit < 0) continue
    const a = /** @type {number} */ (at.get(hit))
    const b = /** @type {number} */ (at.get(hit + p.length))
    found.push(kept.slice(a, b))
    cursor = hit + p.length
  }
  return { paras: found, matched: found.length, total }
}

/**
 * 字下げの量で段落に分ける（照合が少ない時の代わり）。左端より 0.5em 以上右から始まる行が段落の頭。
 * @param {Line[]} lines
 * @param {number} left
 * @param {number} size
 * @returns {Line[][]}
 */
export function splitByIndent(lines, left, size) {
  /** @type {Line[][]} */
  const out = []
  for (const l of lines) {
    if (l.x0 > left + size * 0.5 - 0.01 || out.length === 0) out.push([l])
    else out[out.length - 1].push(l)
  }
  return out
}

/** 字の位置がベタ組みからこの量（em）以上ずれた所があれば「調整が要った」行 */
export const ADJUST_TOL = 0.005
/** 和字と欧字・数字の間の標準の空き（JLReq 3.2.2 の四分アキ） */
export const WO_STANDARD = 0.25

/** 欧字・数字・半角の約物（欧文の語の中の字） @param {string} c */
function isLatinRun(c) {
  const cp = cpOf(c)
  return cp > 0x20 && cp < 0x250
}

/**
 * 両端揃えの 1 行を、ベタ組み（字を送り幅どおりに詰めて並べた形）と比べる。
 * 隣り合う空白でない 2 字の間の空き（間に空白の字があれば、その送り幅を引いた残り）を左から足し、
 * 足し上げた量がどこかで ADJUST_TOL 以上になった行を adjusted とする。
 * 欧字・数字どうしが直に隣り合う所（カーニング）とルビの下の親字の間（ルビの長さで開く）は、どちらの組版にもある動きで
 * 揃えるための調整ではないので足さない。
 * net は「詰めたか、開いたか」を見る合計で、標準の空き（和欧間の四分・約物どうしの詰め）を除く。
 * 和欧間の標準は、直に隣り合うなら 0.25em、間に入力の空白があるなら 0.25em からその空白の送り幅まで（ModsPDF は入力の空白を四分に詰め、
 * Typst は空白の送り幅のまま置くので、片方の流儀に決めると、もう一方の行が全部「詰めた」か「開いた」になる）。
 * 標準の空きを除かない案は選ばなかった: 欧文を 1 語含むだけの行が全部「開けて揃えた」になり、約物どうしの詰めだけの行が「詰めて揃えた」になる。
 * @param {import('./lib-pdftext.mjs').Char[]} chars 行の字（左から右）
 * @param {{ underRuby?: (a: import('./lib-pdftext.mjs').Char, b: import('./lib-pdftext.mjs').Char) => boolean }} [o]
 * @returns {{ adjusted: boolean, net: number, maxDrift: number }}
 */
export function lineAdjustment(chars, o = {}) {
  let drift = 0
  let maxDrift = 0
  let net = 0
  let prev = -1
  for (let j = 0; j < chars.length; j++) {
    if (SPACE.test(chars[j].c)) continue
    if (prev >= 0) {
      const a = chars[prev]
      const b = chars[j]
      const spaced = j > prev + 1
      let spaces = 0
      for (let k = prev + 1; k < j; k++) spaces += chars[k].adv / a.size
      const box = (b.x - (a.x + a.adv)) / a.size
      const gap = box - spaces
      const free = (o.underRuby?.(a, b) ?? false) || (!spaced && isLatinRun(a.c) && isLatinRun(b.c))
      if (!free) {
        drift += gap
        maxDrift = Math.max(maxDrift, Math.abs(drift))
        if (!spaced && PUNCT.has(a.c) && PUNCT.has(b.c)) {
          // 約物どうしの詰めは標準の空き
        } else if ((isWaji(a.c) && isLatinRun(b.c)) || (isLatinRun(a.c) && isWaji(b.c))) {
          const lo = spaced ? Math.min(WO_STANDARD, spaces) : WO_STANDARD
          const hi = spaced ? Math.max(WO_STANDARD, spaces) : WO_STANDARD
          net += box - Math.min(hi, Math.max(lo, box))
        } else net += gap
      }
    }
    prev = j
  }
  return { adjusted: maxDrift >= ADJUST_TOL - 1e-9, net, maxDrift }
}

/** @param {number[]} v */
const mean = (v) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN)
/** @param {number[]} v */
const sd = (v) => {
  if (v.length === 0) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length)
}

/**
 * @typedef {{
 *   pages: number, lastFill: number, bodyLines: number, paraLines: number, paras: number, parasMatched: number, byIndent: boolean,
 *   justified: number, edgeMean: number, edgeMax: number,
 *   wajiMean: number, wajiMax: number, wajiRatio: number,
 *   headBreaks: number, smallHeads: number, tailBreaks: number, runts: number,
 *   adjusted: number, adjCompress: number, adjExpand: number, rubyPlaced: number,
 *   woMean: number, woSd: number, woN: number,
 *   punctRun1: number, punctPair05: number, punctPairs: number,
 *   parenIndent: number, parenIndentN: number, hangOpen: number, hangOpenN: number,
 * }} Metrics
 */

/**
 * PDF の頁から組版の数字を数える。
 * @param {PageChars[]} pages
 * @param {{ theme: Theme, paraTexts: string[] }} o 版面と、入力の段落の字
 * @returns {Metrics}
 */
export function measure(pages, { theme, paraTexts }) {
  const size = theme.size
  const right = theme.left + theme.measure
  const bodyLinesAll = groupLines(pages, { sizeMin: size - 0.2, sizeMax: size + 0.2 })
  const m = matchParagraphs(bodyLinesAll, paraTexts.map(strip))
  let paras = m.paras
  let byIndent = false
  if (m.total > 0 && m.matched < m.total * 0.5) {
    paras = splitByIndent(bodyLinesAll, theme.left, size)
    byIndent = true
  }
  // ルビの親字の間は、ルビの長さで開くので、字間の計測から外す。小さい字（ルビ）を頁ごとに持つ
  const smallByPage = pages.map((pg) => pg.chars.filter((c) => c.size < size * 0.6 && c.size >= 3 && !/\s/.test(c.c)))
  /** @param {Line} line @param {import('./lib-pdftext.mjs').Char} a @param {import('./lib-pdftext.mjs').Char} b */
  const underRuby = (line, a, b) => {
    const small = smallByPage[line.page]
    if (!small.length) return false
    const x0 = a.x - 0.01
    const x1 = b.x + b.adv + 0.01
    return small.some((s) => s.x >= x0 && s.x <= x1 && s.y > line.y + size * 0.4 && s.y < line.y + size * 2)
  }

  /** @type {number[]} */
  const edge = []
  /** @type {number[]} */
  const wajiAll = []
  let wajiLines = 0
  let wajiBad = 0
  let justified = 0
  /** @type {number[]} */
  const wo = []
  let headBreaks = 0
  let smallHeads = 0
  let tailBreaks = 0
  let runts = 0
  let adjusted = 0
  let adjCompress = 0
  let adjExpand = 0
  let punctRun1 = 0
  let punctPair05 = 0
  let punctPairs = 0
  /** @type {number[]} */
  const parenIndent = []
  /** @type {number[]} */
  const hangOpen = []
  let paraLines = 0

  for (const para of paras) {
    paraLines += para.length
    para.forEach((line, k) => {
      const isLast = k === para.length - 1
      const cs = line.chars.filter((c) => !/\s/.test(c.c))
      if (cs.length === 0) return
      if (NO_HEAD.has(cs[0].c)) headBreaks++
      if (SMALL_HEAD.has(cs[0].c)) smallHeads++
      if (NO_TAIL.has(cs[cs.length - 1].c)) tailBreaks++
      if (OPEN.has(cs[0].c)) {
        const v = (cs[0].x - theme.left) / size
        if (k === 0) parenIndent.push(v)
        else hangOpen.push(v)
      }
      if (isLast && cs.filter((c) => !PUNCT.has(c.c) && !STOP.has(c.c)).length === 1) runts++

      // 隣り合う字の間の空き（em）。和欧間だけは、間に空白の字があっても（入力に「道具 A」と空白を打った時）箱から箱までを測る
      let lineAdded = false
      let lineHasWaji = false
      /** @type {import('./lib-pdftext.mjs').Char[]} */
      let run = []
      let runTotal = 0
      const endRun = () => {
        if (run.length >= 2 && runTotal > 1 + 0.01) punctRun1++
        run = []
        runTotal = 0
      }
      const chs = line.chars
      for (let i = 0; i < chs.length; i++) {
        const a = chs[i]
        if (SPACE.test(a.c)) continue
        let j = i + 1
        while (j < chs.length && SPACE.test(chs[j].c)) j++
        if (j >= chs.length) break
        const b = chs[j]
        const gap = (b.x - (a.x + a.adv)) / a.size
        if ((isWaji(a.c) && isLatin(b.c)) || (isLatin(a.c) && isWaji(b.c))) wo.push(gap)
        if (j !== i + 1) {
          endRun()
          continue
        }
        if (isWaji(a.c) && isWaji(b.c) && !underRuby(line, a, b) && !isLast) {
          lineHasWaji = true
          const added = Math.max(0, gap)
          wajiAll.push(added)
          if (added > 0.02) lineAdded = true
        }
        if (PUNCT.has(a.c) && PUNCT.has(b.c)) {
          const total = blankAfter(a) + gap + blankBefore(b)
          punctPairs++
          if (total > 0.5 + 0.01) punctPair05++
          if (run.length === 0) run = [a]
          run.push(b)
          runTotal += total
        } else endRun()
      }
      endRun()
      if (!isLast) {
        justified++
        const adj = lineAdjustment(chs, { underRuby: (a, b) => underRuby(line, a, b) })
        if (adj.adjusted) {
          adjusted++
          if (adj.net <= -ADJUST_TOL) adjCompress++
          else if (adj.net >= ADJUST_TOL) adjExpand++
        }
        edge.push(Math.abs(right - line.ink))
        if (lineHasWaji) {
          wajiLines++
          if (lineAdded) wajiBad++
        }
      }
    })
  }

  return {
    pages: pages.length,
    lastFill: lastPageFill(pages, { top: theme.top, bottom: theme.bottom }),
    bodyLines: bodyLinesAll.length,
    paraLines,
    paras: m.total,
    parasMatched: m.matched,
    byIndent,
    justified,
    edgeMean: mean(edge),
    edgeMax: edge.length ? Math.max(...edge) : NaN,
    wajiMean: mean(wajiAll),
    wajiMax: wajiAll.length ? Math.max(...wajiAll) : NaN,
    wajiRatio: wajiLines ? wajiBad / wajiLines : NaN,
    headBreaks,
    smallHeads,
    tailBreaks,
    runts,
    adjusted,
    adjCompress,
    adjExpand,
    rubyPlaced: markedRuns(pages, 'RT').length,
    woMean: mean(wo),
    woSd: sd(wo),
    woN: wo.length,
    punctRun1,
    punctPair05,
    punctPairs,
    parenIndent: mean(parenIndent),
    parenIndentN: parenIndent.length,
    hangOpen: mean(hangOpen),
    hangOpenN: hangOpen.length,
  }
}

// ---------------------------------------------------------------- 表

/**
 * @typedef {{ key: keyof Metrics, label: string, dir: 'low' | 'high' | number | null, digits: number, unit?: string, ratio?: boolean, note?: string }} Row
 * dir は良い向き。'low' は小さいほど、数なら「その値に近いほど」、null は比べない（ただの情報）
 */

/** @type {Row[]} */
export const ROWS = [
  { key: 'pages', label: '頁数', dir: null, digits: 0 },
  { key: 'lastFill', label: '最後の頁の埋まり（0〜1）', dir: null, digits: 2 },
  { key: 'bodyLines', label: '本文の行の数（字の大きさが本文 ±0.2pt の全部の行）', dir: null, digits: 0 },
  { key: 'paraLines', label: 'うち照合できた段落の行の数', dir: null, digits: 0 },
  { key: 'justified', label: '両端揃えの行の数（段落の最後の行を除く）', dir: null, digits: 0 },
  { key: 'adjusted', label: '調整が要った行（両端揃えの行で、字の位置がベタ組みから 0.005em 以上ずれた所がある行・情報）', dir: null, digits: 0 },
  { key: 'adjCompress', label: 'うち詰めて揃えた行（標準の空きを除いた空きの合計が負・JLReq 3.8.2 は詰めを優先する・情報）', dir: null, digits: 0 },
  { key: 'adjExpand', label: 'うち字間を開けて揃えた行（同じ合計が正・情報）', dir: null, digits: 0 },
  { key: 'edgeMean', label: '行の右端と版面の右端の差の平均（pt）', dir: 'low', digits: 3 },
  { key: 'edgeMax', label: '行の右端と版面の右端の差の最大（pt）', dir: 'low', digits: 3 },
  { key: 'wajiMean', label: '和字の間に足された空きの平均（em）', dir: 'low', digits: 4 },
  { key: 'wajiMax', label: '和字の間に足された空きの最大（em）', dir: 'low', digits: 4 },
  { key: 'wajiRatio', label: '0.02em を超える空きを持つ行の割合', dir: 'low', digits: 3 },
  { key: 'headBreaks', label: '行頭禁則の破れ（行）', dir: 'low', digits: 0 },
  { key: 'smallHeads', label: '行頭に小書きの仮名・長音が来た行（JLReq 3.1.7 の厳しい禁則なら 0・上の行頭禁則の内訳）', dir: 'low', digits: 0 },
  { key: 'tailBreaks', label: '行末禁則の破れ（行）', dir: 'low', digits: 0 },
  { key: 'runts', label: '段落の最後の行が 1 字（約物を除く）の数', dir: 'low', digits: 0 },
  { key: 'woMean', label: '和欧間の空きの平均（em・目標 0.25・間の空白も含む）', dir: 0.25, digits: 3 },
  { key: 'woSd', label: '和欧間の空きの標準偏差（em）', dir: 'low', digits: 3 },
  { key: 'punctPairs', label: '約物どうしが隣り合う組の数（情報）', dir: null, digits: 0 },
  { key: 'punctRun1', label: '約物の並びで空きの合計が 1em を超えた所', dir: 'low', digits: 0 },
  { key: 'punctPair05', label: '約物 2 字の間の空きが 0.5em を超えた所（JLReq の詰めが効いていない）', dir: 'low', digits: 0 },
  { key: 'parenIndent', label: '段落の最初の行の始め括弧の位置（版面の左端から em・目標 0.5）', dir: 0.5, digits: 2 },
  { key: 'hangOpen', label: '段落の途中の行頭の始め括弧の位置（版面の左端から em・天付きの目標 -0.5）', dir: -0.5, digits: 2 },
]

/**
 * ModsPDF だけができる事。勝ち負けの ▲ には数えない。
 * @type {{ key: keyof Metrics, label: string, typstNote: string }[]}
 */
export const CAPABILITIES = [
  { key: 'rubyPlaced', label: 'ルビを置いた所の数（PDF の RT の印の数）', typstNote: '標準の機能なし' },
]

/** @param {number} v @param {Row} row */
function fmtValue(v, row) {
  if (!Number.isFinite(v)) return '―'
  return v.toFixed(row.digits)
}

/**
 * 良い方を決める。丸めた値が同じなら引き分け。
 * @param {number} a ModsPDF @param {number} b Typst @param {Row} row
 * @returns {'mods' | 'typst' | 'tie' | null}
 */
export function better(a, b, row) {
  if (row.dir === null || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const ra = Number(a.toFixed(row.digits))
  const rb = Number(b.toFixed(row.digits))
  const score = (/** @type {number} */ v) => (row.dir === 'low' ? v : row.dir === 'high' ? -v : Math.abs(v - /** @type {number} */ (row.dir)))
  const sa = score(ra)
  const sb = score(rb)
  if (Math.abs(sa - sb) < 1e-9) return 'tie'
  return sa < sb ? 'mods' : 'typst'
}

// ---------------------------------------------------------------- 実行

/** @param {string} p */
const exists = (p) => {
  try { return fs.existsSync(p) } catch { return false }
}

/**
 * ModsPDF 側: compose → renderPdf。layout がまだ無い・動かない時は理由を返す。
 * @param {unknown} input
 * @returns {Promise<{ ok: true, bytes: Uint8Array, ms: number, warnings: string[] } | { ok: false, reason: string }>}
 */
async function buildMods(input) {
  const indexPath = path.join(ROOT, 'hooks/engine/index.mjs')
  if (!exists(indexPath)) return { ok: false, reason: 'layout 待ち（hooks/engine/index.mjs が無い）' }
  let compose
  try {
    ;({ compose } = await import(pathToFileURL(indexPath).href))
  } catch (e) {
    return { ok: false, reason: `layout 待ち（index.mjs を読めない: ${e instanceof Error ? e.message.split('\n')[0] : e}）` }
  }
  if (typeof compose !== 'function') return { ok: false, reason: 'layout 待ち（compose が無い）' }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
    const read = async (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64')
    const ids = /** @type {any[]} */ (['mincho', 'minchoBold', 'sans', 'sansBold'])
    const fontBytes = await loadFontBytes(ids, manifest, read)
    const metrics = makeMetrics(fontBytes)
    const t1 = performance.now()
    const { layout, warnings } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: Date.UTC(2026, 9, 9) })
    const pdf = await renderPdf(layout, { fontBytes })
    const t2 = performance.now()
    // 書体を読む時間は 1 回きりなので、組版と PDF の時間だけを測る
    return { ok: true, bytes: Uint8Array.from(Buffer.from(pdf.text, 'latin1')), ms: t2 - t1, warnings: [...warnings, ...(pdf.warnings ?? [])] }
  } catch (e) {
    return { ok: false, reason: `ModsPDF の組版が失敗: ${e instanceof Error ? e.message.split('\n')[0] : e}` }
  }
}

/**
 * Typst で組む。
 * @param {string} typPath
 * @param {string} pdfPath
 * @returns {{ ok: true, ms: number, stderr: string } | { ok: false, reason: string }}
 */
function buildTypst(typPath, pdfPath) {
  const dirs = TYPST_FONT_DIRS.filter(exists)
  const args = ['compile', '--ignore-system-fonts']
  for (const d of dirs) args.push('--font-path', d)
  args.push(typPath, pdfPath)
  const t0 = performance.now()
  const r = spawnSync('typst', args, { encoding: 'utf8', timeout: 120000 })
  const ms = performance.now() - t0
  if (r.error) return { ok: false, reason: `typst を呼べない: ${r.error.message}` }
  if (r.status !== 0) return { ok: false, reason: `typst の組版が失敗: ${(r.stderr || '').split('\n').slice(0, 6).join(' / ')}` }
  return { ok: true, ms, stderr: r.stderr || '' }
}

/** @param {string} bin */
function typstVersion(bin = 'typst') {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : '不明'
}

/** 入力から段落の字（ルビの読みは含めない）を取る @param {Doc} doc */
function paragraphTexts(doc) {
  return doc.blocks.filter((b) => b.type === 'para').map((b) => /** @type {any} */ (b).text.map((/** @type {any} */ i) => i.text).join(''))
}

/**
 * 1 つの文書を比べる。
 * @param {string} name
 * @param {{ samplesDir: string, outDir: string, typDir: string }} o
 */
export async function compareOne(name, { samplesDir, outDir, typDir }) {
  const jsonPath = path.join(samplesDir, `${name}.json`)
  if (!exists(jsonPath)) return { name, status: 'samples 待ち', reason: `${path.relative(ROOT, jsonPath)} が無い` }
  const input = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const { doc } = normalize(input)
  const theme = makeTheme({ theme: doc.theme, body: doc.body, paper: doc.paper, landscape: doc.landscape, size: doc.size })
  const paraTexts = paragraphTexts(doc)

  // Typst
  const { typ, omitted, ruby } = docToTypst(doc, theme)
  fs.mkdirSync(typDir, { recursive: true })
  fs.mkdirSync(path.join(outDir, 'compare'), { recursive: true })
  const typPath = path.join(typDir, `${name}.typ`)
  fs.writeFileSync(typPath, typ)
  const typstPdf = path.join(outDir, 'compare', `${name}-typst.pdf`)
  const modsPdf = path.join(outDir, 'compare', `${name}-mods.pdf`)

  /** @type {any} */
  const res = { name, title: doc.title, paper: doc.paper, size: theme.size, chars: theme.chars, omitted, rubyInlines: ruby, paras: paraTexts.length, mods: null, typst: null }

  const t = buildTypst(typPath, typstPdf)
  if (t.ok) {
    const { pages } = await readPdfChars(new Uint8Array(fs.readFileSync(typstPdf)))
    res.typst = { status: 'ok', ms: t.ms, metrics: measure(pages, { theme, paraTexts }) }
  } else res.typst = { status: 'error', reason: t.reason }

  const m = await buildMods(input)
  if (m.ok) {
    fs.writeFileSync(modsPdf, m.bytes)
    const { pages } = await readPdfChars(m.bytes)
    res.mods = { status: 'ok', ms: m.ms, warnings: m.warnings, metrics: measure(pages, { theme, paraTexts }) }
  } else res.mods = { status: 'pending', reason: m.reason }
  return { ...res, status: 'ok' }
}

/** @param {number} ms */
const msText = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms)} ms`)

/** 難しい見本（bench-*）か @param {string} name */
export const isBench = (name) => /^bench-/.test(name)

/** 難しい見本で、どちらの PDF にもこれだけは「調整が要った行」があること。足りなければ見本を難しくする */
export const BENCH_MIN_ADJUSTED = 20

/**
 * 難しさの確かめ。難しい見本で、両方の PDF に調整が要った行が BENCH_MIN_ADJUSTED 以上あり、
 * 段落の途中の行頭の始め括弧が 1 行以上あること。難しい見本でなければ null。
 * @param {any} r compareOne の答え
 * @returns {{ ok: boolean, text: string } | null}
 */
export function difficultyCheck(r) {
  if (!isBench(r.name)) return null
  const mm = r.mods?.status === 'ok' ? r.mods.metrics : null
  const tm = r.typst?.status === 'ok' ? r.typst.metrics : null
  if (!mm || !tm) return { ok: false, text: '難しさの確かめ: 片方が組めていないので確かめられない' }
  const adjOk = mm.adjusted >= BENCH_MIN_ADJUSTED && tm.adjusted >= BENCH_MIN_ADJUSTED
  // 標準の空き（和欧間の四分）だけで揃った行を除いても足りること。ベタ組みからのずれだけでは、欧文を含むだけの行も数えてしまう
  const realMods = mm.adjCompress + mm.adjExpand
  const realTypst = tm.adjCompress + tm.adjExpand
  const realOk = realMods >= BENCH_MIN_ADJUSTED && realTypst >= BENCH_MIN_ADJUSTED
  const hangOk = mm.hangOpenN > 0 && tm.hangOpenN > 0
  const ok = adjOk && realOk && hangOk
  return {
    ok,
    text: `難しさの確かめ: 調整が要った行 ModsPDF ${mm.adjusted}・Typst ${tm.adjusted}（${BENCH_MIN_ADJUSTED} 行以上${adjOk ? 'あり' : 'が必要。足りない'}）、うち詰め・開けで揃えた行 ModsPDF ${realMods}・Typst ${realTypst}（${realOk ? '同じく足りている' : '足りない'}）、段落の途中の行頭の始め括弧 ModsPDF ${mm.hangOpenN} 行・Typst ${tm.hangOpenN} 行（${hangOk ? '0 行でない' : '0 行の側がある'}）→ ${ok ? '合格' : '不合格（見本を難しくする）'}`,
  }
}

/**
 * 1 つの結果で、良い方に付く ▲ の数。片方が組めていなければ全部 0。
 * @param {any} r
 * @returns {{ mods: number, typst: number, tie: number }}
 */
export function tallyResult(r) {
  const t = { mods: 0, typst: 0, tie: 0 }
  const mm = r.mods?.status === 'ok' ? r.mods.metrics : null
  const tm = r.typst?.status === 'ok' ? r.typst.metrics : null
  if (!mm || !tm) return t
  for (const row of ROWS) {
    const w = better(/** @type {number} */ (mm[row.key]), /** @type {number} */ (tm[row.key]), row)
    if (w === 'mods') t.mods++
    else if (w === 'typst') t.typst++
    else if (w === 'tie') t.tie++
  }
  return t
}

/**
 * 結果から Markdown を作る。
 * @param {any[]} results
 * @param {{ typstVersion: string }} meta
 */
export function renderMarkdown(results, meta) {
  const L = []
  L.push('# ModsPDF と Typst の日本語組版の比べ')
  L.push('')
  L.push(`- Typst: ${meta.typstVersion}（書体は Zen Old Mincho と Noto Sans JP だけ。システムの書体は使わない）`)
  L.push('- 同じ文（samples/*.json）を同じ版面（見本の paper と size から makeTheme が決めた左右・上下の余白・本文の大きさ・行送り 1.75 倍）で組み、できた PDF の字の位置を 1 字ずつ読んで数えた。')
  L.push('- 見本は 2 種類。易しい見本（report・prose・ruby）は普通の文章で、両方とも禁則が破れない。難しい見本（bench-*）は scripts/make-bench.mjs が決まった種の乱数で作った文で、小書きの仮名・長音・約物の連なり・欧文と数字・ルビを詰め込み、行長を 3 通りにしてある。')
  L.push('- Typst は一番よい設定: justify・全角下げ（first-line-indent all）・linebreaks "optimized"・lang ja・region jp。')
  L.push('- ▲ は良い方。丸めた値が同じなら ＝。情報だけの行（頁数・行の数・調整が要った行など）と「ModsPDF だけができる事」には付けない。')
  L.push('')
  /** @type {{ name: string, chars: number | null, t: { mods: number, typst: number, tie: number } }[]} */
  const tallies = []
  for (const r of results) {
    L.push(`## ${r.name}${r.title ? `（${r.title}）` : ''}`)
    L.push('')
    if (r.status !== 'ok') {
      L.push(`- ${r.status}: ${r.reason}`)
      L.push('')
      continue
    }
    if (r.chars) L.push(`- 版面: ${r.paper ?? ''} 本文 ${r.size}pt・1 行 ${r.chars} 字・段落 ${r.paras}`)
    const mm = r.mods?.status === 'ok' ? r.mods.metrics : null
    const tm = r.typst?.status === 'ok' ? r.typst.metrics : null
    if (!mm) L.push(`- ModsPDF: ${r.mods?.reason ?? '組めていない'}`)
    if (!tm) L.push(`- Typst: ${r.typst?.reason ?? '組めていない'}`)
    L.push('')
    L.push('| 項目 | ModsPDF | Typst |')
    L.push('|---|---:|---:|')
    for (const row of ROWS) {
      const a = mm ? /** @type {number} */ (mm[row.key]) : NaN
      const b = tm ? /** @type {number} */ (tm[row.key]) : NaN
      const w = better(a, b, row)
      const sa = fmtValue(a, row) + (w === 'mods' ? ' ▲' : w === 'tie' ? ' ＝' : '')
      const sb = fmtValue(b, row) + (w === 'typst' ? ' ▲' : w === 'tie' ? ' ＝' : '')
      const extra =
        row.key === 'paraLines' ? { a: mm ? `${mm.paraLines}（段落 ${mm.parasMatched}/${mm.paras}${mm.byIndent ? '・字下げで区切った' : ''}）` : '', b: tm ? `${tm.paraLines}（段落 ${tm.parasMatched}/${tm.paras}${tm.byIndent ? '・字下げで区切った' : ''}）` : '' }
        : row.key === 'woMean' ? { a: mm ? `${sa}（${mm.woN} 所）` : '', b: tm ? `${sb}（${tm.woN} 所）` : '' }
        : row.key === 'parenIndent' ? { a: mm ? `${sa}（${mm.parenIndentN} 段落）` : '', b: tm ? `${sb}（${tm.parenIndentN} 段落）` : '' }
        : row.key === 'hangOpen' ? { a: mm ? `${sa}（${mm.hangOpenN} 行）` : '', b: tm ? `${sb}（${tm.hangOpenN} 行）` : '' }
        : null
      L.push(`| ${row.label} | ${extra && extra.a ? extra.a : sa} | ${extra && extra.b ? extra.b : sb} |`)
    }
    L.push(`| 組む時間（参考・ModsPDF は書体の読み込みを除く） | ${r.mods?.status === 'ok' ? msText(r.mods.ms) : '―'} | ${r.typst?.status === 'ok' ? msText(r.typst.ms) : '―'} |`)
    L.push('')
    L.push('| ModsPDF だけができる事（▲ に数えない） | ModsPDF | Typst |')
    L.push('|---|---:|---:|')
    for (const cap of CAPABILITIES) {
      const a = mm ? /** @type {number} */ (mm[cap.key]) : NaN
      const b = tm ? /** @type {number} */ (tm[cap.key]) : NaN
      const input = cap.key === 'rubyPlaced' ? `・入力のルビ指定 ${r.rubyInlines} 箇所` : ''
      L.push(`| ${cap.label}${input} | ${Number.isFinite(a) ? a : '―'} | ${Number.isFinite(b) ? `${b}（${cap.typstNote}）` : '―'} |`)
    }
    L.push('')
    const t = tallyResult(r)
    tallies.push({ name: r.name, chars: r.chars ?? null, t })
    L.push(`この見本の ▲: ModsPDF ${t.mods}・Typst ${t.typst}・引き分け ${t.tie}`)
    L.push('')
    const dc = difficultyCheck(r)
    if (dc) {
      L.push(dc.text)
      L.push('')
    }
    const om = Object.entries(r.omitted).filter(([, n]) => /** @type {number} */ (n) > 0)
    L.push(`Typst で省いた物: ${om.length ? om.map(([k, n]) => `${k} ${n} 個`).join('・') : 'なし'}。ルビ: ${r.rubyInlines ? `${r.rubyInlines} 箇所を親字だけにした（ルビなし。Typst に標準のルビが無く、@preview のルビのパッケージは手元に無い）` : 'この文書には無い'}。`)
    if (mm && r.mods.warnings?.length) L.push(`ModsPDF の warnings: ${r.mods.warnings.slice(0, 5).join(' / ')}${r.mods.warnings.length > 5 ? ` ほか ${r.mods.warnings.length - 5} 件` : ''}`)
    L.push('')
  }
  const sum = (/** @type {typeof tallies} */ list) => list.reduce((a, x) => ({ mods: a.mods + x.t.mods, typst: a.typst + x.t.typst, tie: a.tie + x.t.tie }), { mods: 0, typst: 0, tie: 0 })
  const easy = tallies.filter((x) => !isBench(x.name))
  const hard = tallies.filter((x) => isBench(x.name))
  const all = sum(tallies)
  L.push('## 全体')
  L.push('')
  L.push(`良い方に付いた ▲: ModsPDF ${all.mods}・Typst ${all.typst}・引き分け ${all.tie}`)
  L.push('')
  L.push('| 見本 | 1 行の字数 | ModsPDF の ▲ | Typst の ▲ | 引き分け |')
  L.push('|---|---:|---:|---:|---:|')
  for (const x of tallies) L.push(`| ${x.name} | ${x.chars ?? '―'} | ${x.t.mods} | ${x.t.typst} | ${x.t.tie} |`)
  if (easy.length && hard.length) {
    const e = sum(easy)
    const h = sum(hard)
    L.push(`| 易しい見本の計 | | ${e.mods} | ${e.typst} | ${e.tie} |`)
    L.push(`| 難しい見本の計 | | ${h.mods} | ${h.typst} | ${h.tie} |`)
  }
  L.push(`| 全部の合計 | | ${all.mods} | ${all.typst} | ${all.tie} |`)
  L.push('')
  L.push('## 数え方の注記')
  L.push('')
  L.push('- 行: 字の大きさが本文 ±0.2pt で、基線が 0.6pt 以内の字を 1 行にまとめた（字の間が 2.5em 以上開けば別の行）。ルビ（本文の半分の大きさ）と足は本文の行に入らない。')
  L.push('- 段落: 入力の段落の字（空白を除く）が、行の並びの中で行の頭から行の末までを占める所を探して照合した。見つからなかった段落は数えない。')
  L.push('- 行の右端: 末尾の字の墨の右端。終わり括弧・句読点（全角）は箱の左半分に墨があるので箱の半分まで、中点は箱の真ん中に墨があるので箱の四分の三まで（中点は後から足した。行末の中点の右の四分を版面の外に出す組み方を、箱の右端で測ると 3pt 近いずれに見えた）。')
  L.push('- 和字の間に足された空き: 両端揃えの行の、隣り合う和字（漢字・かな・長音）の間の「次の字の x − (今の字の x + 送り幅)」を em にして、負（詰め）は 0 とした。ルビの下の親字の間は外す。')
  L.push('- 和欧間: 和字と欧字・数字が直接隣り合う所の同じ空き。詰めも含める。')
  L.push('- 約物の並び: 約物どうしが隣り合う列の、字面の間の空き（前の字の右の空き + 字の間 + 次の字の左の空き）の合計。全角の終わり括弧・句読点は右に 0.5em、始め括弧は左に 0.5em、中点は両側 0.25em。')
  L.push('- 始め括弧の位置: 段落の最初の行の頭が始め括弧の時の、その字の箱の左端 − 版面の左端（em）。JLReq 3.1.5 の全角下がりは 0.5。段落の途中の行頭の始め括弧は、同じ位置を段落の 2 行目以降で数えた物で、天付きは -0.5。')
  L.push('- 行頭に小書きの仮名・長音: 段落の行の最初の字が ぁぃぅぇぉっゃゅょゎゕゖ・ァィゥェォッャュョヮヵヶ・ー の行。行頭禁則の破れの内訳で、行頭禁則の行は ー と小書きの仮名も含むので、この行は上の行の一部（今ある行の数え方は変えていない）。JLReq 3.1.7 の厳しい禁則では 0、ゆるい禁則では来てよい。')
  L.push('- 調整が要った行: 段落の最後でない行（両端揃えの行）で、空白でない隣り合う 2 字の間の空き（間に空白の字があればその送り幅を引く）を左から足し、足し上げた量が 0.005em 以上になった所がある行。欧字・数字どうしが直に隣り合う所（カーニング）とルビの下の親字の間は足さない。')
  L.push('- うち詰めて揃えた行・字間を開けて揃えた行: 調整が要った行の、標準の空きを除いた空きの合計が −0.005em 以下なら詰め、+0.005em 以上なら開け。標準の空きは、和欧間の四分（直に隣り合うなら 0.25em、間に入力の空白があるなら 0.25em からその空白の送り幅まで。ModsPDF は入力の空白を四分に詰め、Typst は空白の送り幅のまま置く）と、約物どうしの詰め。除かないと、欧文を 1 語含むだけの行が全部「開けて揃えた」になる。標準の空きだけで揃った行と、詰めと開けが打ち消し合った行は、どちらにも数えない（調整が要った行 ≧ 詰め + 開け）。JLReq 3.8.2 は詰めを優先する。')
  L.push('- ルビを置いた所: PDF の構造の印（RT）が付いた中身の数。ルビ 1 つが 1 つの印になる。Typst には標準のルビが無く、親字だけにして組むので 0。')
  L.push('- 難しさの確かめ: 難しい見本は、両方の PDF で調整が要った行が 20 行以上あり（詰め・開けで揃えた行だけでも 20 行以上）、段落の途中の行頭に始め括弧が来た行があること。足りなければ見本を難しくする。')
  L.push('- 良い向き: 小さいほどよい項目は ▲ が値の小さい方、目標のある項目（和欧間 0.25・始め括弧 0.5・天付き -0.5）は目標に近い方。')
  L.push('')
  return L.join('\n')
}

/**
 * --names を省いた時の見本の並び。易しい 3 本の後ろに、難しい見本（bench-*.json）を名前順に足す。
 * @param {string} samplesDir
 */
export function defaultNames(samplesDir) {
  const hard = exists(samplesDir) ? fs.readdirSync(samplesDir).filter((n) => /^bench-.+.json$/.test(n)).map((n) => n.replace(/.json$/, '')).sort() : []
  return ['report', 'prose', 'ruby', ...hard]
}

async function main() {
  /** @type {string[]} */
  const argv = process.argv.slice(2)
  /** @param {string} flag @param {string} dflt @returns {string} */
  const opt = (flag, dflt) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
  }
  const samplesDir = path.resolve(ROOT, opt('--samples', 'samples'))
  const names = argv.includes('--names') ? opt('--names', '').split(',').map((s) => s.trim()).filter(Boolean) : defaultNames(samplesDir)
  const outDir = path.resolve(ROOT, opt('--out', 'out'))
  const typDir = path.resolve(ROOT, opt('--typ-dir', 'samples/compare'))
  fs.mkdirSync(outDir, { recursive: true })

  const results = []
  for (const n of names) {
    const r = await compareOne(n, { samplesDir, outDir, typDir })
    results.push(r)
    const mods = r.status === 'ok' ? (r.mods?.status === 'ok' ? 'ModsPDF ○' : `ModsPDF ${r.mods?.reason}`) : r.status
    const typ = r.status === 'ok' ? (r.typst?.status === 'ok' ? 'Typst ○' : `Typst ${r.typst?.reason}`) : ''
    console.log(`${n}: ${mods} / ${typ}`)
    const dc = difficultyCheck(r)
    if (dc) console.log(`  ${dc.text}`)
  }
  const meta = { typstVersion: typstVersion() }
  fs.writeFileSync(path.join(outDir, 'compare.md'), renderMarkdown(results, meta))
  fs.writeFileSync(path.join(outDir, 'compare.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...meta, docs: results }, null, 2))
  console.log(`書きました: ${path.relative(ROOT, path.join(outDir, 'compare.md'))}・compare.json`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
