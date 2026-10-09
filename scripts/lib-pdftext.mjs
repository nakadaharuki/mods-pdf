// @ts-check
// PDF の頁の字を 1 字ずつ、位置つきで読む。verify-pdf と compare-typst が使う（フックの外・Node 専用）。
//
// 選ばなかった案:
// - pdf.js の getTextContent: 行の中の字をまとめて 1 つの項目にし、字ごとの x を失う。
//   字間の空き・行末のそろい方を測りたいので使えない。
// - pdf.js の getOperatorList: 字ごとの位置は取れるが、ToUnicode を自前で引く必要があり、
//   Form XObject の中の入れ子も追いにくい。内容の流れを自分で読む方が短く、試験もしやすい。
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFStream, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'

/** @typedef {{ c: string, x: number, y: number, size: number, adv: number, font: string, role: string|null }} Char
 *  x・y は PDF の座標（pt・頁の左下が原点・y は上向き）で、字の送り幅の箱の左端と基線。
 *  size は実際の字の大きさ（Tf の大きさに行列の拡大を掛けた物）、adv は書体の送り幅 × size（TJ の調整は含めない）。
 *  role は印付きの中身の役割（P・H1・RT など）。印が無ければ null */
/** @typedef {{ index: number, width: number, height: number, chars: Char[] }} PageChars */
/** @typedef {[number, number, number, number, number, number]} Mat */

// ---------------------------------------------------------------- 字句

const WS = new Set([0, 9, 10, 12, 13, 32])
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/** @typedef {{ name: string }} NameObj */
/** @typedef {{ k: 'num', v: number } | { k: 'name', v: string } | { k: 'str', v: Uint8Array } | { k: 'op', v: string } | { k: 'open' } | { k: 'close' } | { k: 'dopen' } | { k: 'dclose' }} Token */

class Lexer {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.b = bytes
    this.i = 0
  }

  /** @returns {Token | null} */
  next() {
    const b = this.b
    const n = b.length
    for (;;) {
      while (this.i < n && WS.has(b[this.i])) this.i++
      if (this.i >= n) return null
      if (b[this.i] !== 0x25) break
      while (this.i < n && b[this.i] !== 10 && b[this.i] !== 13) this.i++
    }
    const c = b[this.i]
    if (c === 0x2f) {
      this.i++
      let s = ''
      while (this.i < n && !WS.has(b[this.i]) && !DELIM.has(b[this.i])) {
        if (b[this.i] === 0x23 && this.i + 2 < n && isHex(b[this.i + 1]) && isHex(b[this.i + 2])) {
          s += String.fromCharCode(parseInt(String.fromCharCode(b[this.i + 1], b[this.i + 2]), 16))
          this.i += 3
        } else s += String.fromCharCode(b[this.i++])
      }
      return { k: 'name', v: s }
    }
    if (c === 0x28) return { k: 'str', v: this.literal() }
    if (c === 0x3c) {
      if (b[this.i + 1] === 0x3c) { this.i += 2; return { k: 'dopen' } }
      return { k: 'str', v: this.hex() }
    }
    if (c === 0x3e) {
      if (b[this.i + 1] === 0x3e) { this.i += 2; return { k: 'dclose' } }
      this.i++
      return this.next()
    }
    if (c === 0x5b) { this.i++; return { k: 'open' } }
    if (c === 0x5d) { this.i++; return { k: 'close' } }
    if (c === 0x7b || c === 0x7d || c === 0x29) { this.i++; return { k: 'op', v: String.fromCharCode(c) } }
    let s = ''
    while (this.i < n && !WS.has(b[this.i]) && !DELIM.has(b[this.i])) s += String.fromCharCode(b[this.i++])
    if (NUMBER.test(s)) return { k: 'num', v: parseFloat(s) }
    return { k: 'op', v: s }
  }

  /** 丸括弧の字。入れ子の括弧と、バックスラッシュの逃がし（\n \ddd 行継ぎ）を読む */
  literal() {
    const b = this.b
    const n = b.length
    this.i++
    /** @type {number[]} */
    const out = []
    let depth = 1
    while (this.i < n) {
      const ch = b[this.i++]
      if (ch === 0x5c) {
        const e = b[this.i++]
        if (e === 0x6e) out.push(10)
        else if (e === 0x72) out.push(13)
        else if (e === 0x74) out.push(9)
        else if (e === 0x62) out.push(8)
        else if (e === 0x66) out.push(12)
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30
          for (let k = 0; k < 2 && b[this.i] >= 0x30 && b[this.i] <= 0x37; k++) v = v * 8 + (b[this.i++] - 0x30)
          out.push(v & 0xff)
        } else if (e === 13) {
          if (b[this.i] === 10) this.i++
        } else if (e === 10) {
          // 行継ぎ。何も足さない
        } else if (e !== undefined) out.push(e)
        continue
      }
      if (ch === 0x28) depth++
      else if (ch === 0x29 && --depth === 0) break
      out.push(ch)
    }
    return Uint8Array.from(out)
  }

  /** 山括弧の 16 進の字。空白は無視し、奇数桁は末尾に 0 を足す */
  hex() {
    const b = this.b
    const n = b.length
    this.i++
    /** @type {number[]} */
    const digits = []
    while (this.i < n && b[this.i] !== 0x3e) {
      if (isHex(b[this.i])) digits.push(parseInt(String.fromCharCode(b[this.i]), 16))
      this.i++
    }
    this.i++
    if (digits.length % 2) digits.push(0)
    const out = new Uint8Array(digits.length / 2)
    for (let k = 0; k < out.length; k++) out[k] = digits[2 * k] * 16 + digits[2 * k + 1]
    return out
  }
}

/** @param {number} c */
function isHex(c) {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)
}

/** @typedef {number | Uint8Array | NameObj | { dict: true } | any[]} Arg 配列の中身も同じ形（型の循環を避けて any[] と書く） */
/** @typedef {{ op: string, args: Arg[] }} Op */

/**
 * 内容の流れを (演算子, 引数の列) の列にする。インライン画像は読み飛ばす。
 * @param {Uint8Array} bytes
 * @returns {Op[]}
 */
export function parseOps(bytes) {
  const lx = new Lexer(bytes)
  /** @type {Op[]} */
  const out = []
  /** @type {Arg[]} */
  let args = []
  /** @param {Token} t @returns {Arg | undefined} */
  const value = (t) => {
    if (t.k === 'num') return t.v
    if (t.k === 'str') return t.v
    if (t.k === 'name') return { name: t.v }
    if (t.k === 'open') return readArray()
    if (t.k === 'dopen') { skipDict(); return { dict: true } }
    if (t.k === 'op' && t.v === 'true') return 1
    if (t.k === 'op' && t.v === 'false') return 0
    return undefined
  }
  /** @returns {Arg[]} */
  function readArray() {
    /** @type {Arg[]} */
    const arr = []
    for (;;) {
      const t = lx.next()
      if (!t || t.k === 'close') return arr
      const v = value(t)
      if (v !== undefined) arr.push(v)
    }
  }
  function skipDict() {
    let depth = 1
    while (depth > 0) {
      const t = lx.next()
      if (!t) return
      if (t.k === 'dopen') depth++
      else if (t.k === 'dclose') depth--
    }
  }
  for (;;) {
    const t = lx.next()
    if (!t) break
    if (t.k === 'op') {
      if (t.v === 'BI') {
        skipInlineImage(lx)
        args = []
        continue
      }
      if (t.v === 'true' || t.v === 'false') {
        args.push(t.v === 'true' ? 1 : 0)
        continue
      }
      if (t.v === 'null') continue
      out.push({ op: t.v, args })
      args = []
      continue
    }
    const v = value(t)
    if (v !== undefined) args.push(v)
  }
  return out
}

/** BI … ID データ EI の、ID の後ろの生のデータを EI まで飛ばす */
function skipInlineImage(/** @type {Lexer} */ lx) {
  for (;;) {
    const t = lx.next()
    if (!t) return
    if (t.k === 'op' && t.v === 'ID') break
  }
  const b = lx.b
  let j = lx.i + 1
  for (; j < b.length - 1; j++) {
    if (b[j] === 0x45 && b[j + 1] === 0x49 && (j === 0 || WS.has(b[j - 1])) && (j + 2 >= b.length || WS.has(b[j + 2]) || DELIM.has(b[j + 2]))) break
  }
  lx.i = Math.min(b.length, j + 2)
}

// ---------------------------------------------------------------- 行列

/** m を先に、n を後に掛ける（PDF の行ベクトルの決まり） @param {Mat} m @param {Mat} n @returns {Mat} */
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

/** @type {Mat} */
const IDENTITY = [1, 0, 0, 1, 0, 0]

// ---------------------------------------------------------------- 流れの取り出し

/** @param {any} o @returns {o is PDFStream} */
const isStream = (o) => o instanceof PDFStream

/**
 * 流れを開く（フィルターが重なっていても、pdf-lib の復号に任せる。ASCII85Decode + FlateDecode など）。
 * @param {any} stream
 * @returns {Uint8Array}
 */
function streamBytes(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode()
  return stream.getContents()
}

/** @param {any} o @returns {number} */
const numOf = (o) => (o instanceof PDFNumber ? o.asNumber() : NaN)

// ---------------------------------------------------------------- ToUnicode

/**
 * @typedef {{ map: Map<number, string>, ranges: { lo: number, hi: number, dst: string }[] }} CMap
 */

/**
 * ToUnicode の CMap（bfchar・bfrange）を読む。dst は UTF-16BE の 16 進で、複数の字（合字）もありうる。
 * @param {Uint8Array} bytes
 * @returns {CMap}
 */
export function parseToUnicode(bytes) {
  const lx = new Lexer(bytes)
  /** @type {CMap} */
  const cmap = { map: new Map(), ranges: [] }
  /** @param {Uint8Array} s */
  const code = (s) => s.reduce((a, v) => a * 256 + v, 0)
  /** @param {Uint8Array} s */
  const utf16 = (s) => {
    let r = ''
    for (let k = 0; k + 1 < s.length; k += 2) r += String.fromCharCode(s[k] * 256 + s[k + 1])
    return r
  }
  for (;;) {
    const t = lx.next()
    if (!t) break
    if (t.k !== 'op') continue
    if (t.v === 'beginbfchar') {
      for (;;) {
        const a = lx.next()
        if (!a || a.k !== 'str') break
        const d = lx.next()
        if (!d || d.k !== 'str') break
        cmap.map.set(code(a.v), utf16(d.v))
      }
    } else if (t.v === 'beginbfrange') {
      for (;;) {
        const lo = lx.next()
        if (!lo || lo.k !== 'str') break
        const hi = lx.next()
        if (!hi || hi.k !== 'str') break
        const d = lx.next()
        if (!d) break
        const l = code(lo.v)
        const h = code(hi.v)
        if (d.k === 'str') cmap.ranges.push({ lo: l, hi: h, dst: utf16(d.v) })
        else if (d.k === 'open') {
          let at = l
          for (;;) {
            const e = lx.next()
            if (!e || e.k === 'close') break
            if (e.k === 'str') cmap.map.set(at++, utf16(e.v))
          }
        }
      }
    }
  }
  return cmap
}

/** @param {CMap} cmap @param {number} cid @returns {string | undefined} */
function lookupUnicode(cmap, cid) {
  const hit = cmap.map.get(cid)
  if (hit !== undefined) return hit
  for (const r of cmap.ranges) {
    if (cid >= r.lo && cid <= r.hi) {
      const d = r.dst
      if (!d) return undefined
      // 範囲の字は、最後の UTF-16 の単位を 1 ずつ増やす
      return d.slice(0, -1) + String.fromCharCode(d.charCodeAt(d.length - 1) + (cid - r.lo))
    }
  }
  return undefined
}

// ---------------------------------------------------------------- 書体

/**
 * @typedef {{
 *   name: string,
 *   composite: boolean,
 *   width: (code: number) => number,
 *   unicode: (code: number) => string,
 * }} FontInfo
 * width は 1000 分の 1 em の送り幅
 */

/** 部分埋め込みの印（ABCDEF+）を外した書体名 @param {string} s */
const stripSubset = (s) => s.replace(/^[A-Z]{6}\+/, '')

/**
 * @param {PDFDict} dict
 * @param {string[]} warnings
 * @returns {FontInfo}
 */
function loadFont(dict, warnings) {
  const ctx = dict.context
  const baseFont = dict.lookup(PDFName.of('BaseFont'))
  const name = baseFont instanceof PDFName ? stripSubset(baseFont.decodeText()) : '?'
  const subtype = dict.lookup(PDFName.of('Subtype'))
  const sub = subtype instanceof PDFName ? subtype.decodeText() : ''
  const tu = dict.lookup(PDFName.of('ToUnicode'))
  /** @type {CMap | null} */
  let cmap = null
  if (isStream(tu)) {
    try { cmap = parseToUnicode(streamBytes(tu)) } catch (e) { warnings.push(`ToUnicode を読めなかった（${name}）: ${errText(e)}`) }
  }

  if (sub === 'Type0') {
    const enc = dict.lookup(PDFName.of('Encoding'))
    if (!(enc instanceof PDFName) || !enc.decodeText().startsWith('Identity')) warnings.push(`書体 ${name} の Encoding が Identity 以外なので 2 バイトの字として読んだ`)
    const desc = dict.lookup(PDFName.of('DescendantFonts'))
    const cid = desc instanceof PDFArray ? desc.lookup(0) : undefined
    let dw = 1000
    /** @type {Map<number, number>} */
    const single = new Map()
    /** @type {{ lo: number, hi: number, w: number }[]} */
    const ranges = []
    if (cid instanceof PDFDict) {
      const d = numOf(cid.lookup(PDFName.of('DW')))
      if (Number.isFinite(d)) dw = d
      const w = cid.lookup(PDFName.of('W'))
      if (w instanceof PDFArray) {
        let k = 0
        while (k < w.size()) {
          const first = numOf(w.lookup(k))
          const nx = w.lookup(k + 1)
          if (nx instanceof PDFArray) {
            for (let m = 0; m < nx.size(); m++) single.set(first + m, numOf(nx.lookup(m)))
            k += 2
          } else {
            ranges.push({ lo: first, hi: numOf(nx), w: numOf(w.lookup(k + 2)) })
            k += 3
          }
        }
      }
    }
    return {
      name,
      composite: true,
      width: (code) => {
        const s = single.get(code)
        if (s !== undefined) return s
        for (const r of ranges) if (code >= r.lo && code <= r.hi) return r.w
        return dw
      },
      unicode: (code) => (cmap && lookupUnicode(cmap, code)) || REPLACEMENT,
    }
  }

  // 単純な書体（1 バイトの字）。Widths が無い標準書体は 500 とみなす（ModsPDF も Typst もこの形は使わない）
  const first = numOf(dict.lookup(PDFName.of('FirstChar')))
  const widths = dict.lookup(PDFName.of('Widths'))
  const fd = dict.lookup(PDFName.of('FontDescriptor'))
  const missing = fd instanceof PDFDict ? numOf(fd.lookup(PDFName.of('MissingWidth'))) : NaN
  void ctx
  return {
    name,
    composite: false,
    width: (code) => {
      if (widths instanceof PDFArray && Number.isFinite(first)) {
        const v = numOf(widths.lookup(code - first))
        if (Number.isFinite(v)) return v
        return Number.isFinite(missing) ? missing : 0
      }
      return 500
    },
    unicode: (code) => (cmap && lookupUnicode(cmap, code)) || String.fromCharCode(code),
  }
}

/** 変換できない字の代わり。ソースに見えない字を直に書かないよう数で作る */
const REPLACEMENT = String.fromCodePoint(0xfffd)

/** @param {unknown} e */
const errText = (e) => (e instanceof Error ? e.message : String(e))

// ---------------------------------------------------------------- 読み手

const MAX_FORM_DEPTH = 8

/**
 * 1 つの内容の流れを読んで字を積む。Form XObject（Do）の中にも入る。
 * @param {Uint8Array} content
 * @param {PDFDict | undefined} resources
 * @param {Mat} baseCtm
 * @param {{ chars: Char[], warnings: string[], fonts: Map<PDFDict, FontInfo>, ox: number, oy: number, depth: number, seen: Set<any> }} env
 */
function interpret(content, resources, baseCtm, env) {
  const ops = parseOps(content)
  /** @type {{ ctm: Mat, font: FontInfo | null, fs: number, tc: number, tw: number, th: number, tl: number, rise: number, render: number }[]} */
  const stack = []
  let ctm = baseCtm
  /** @type {FontInfo | null} */
  let font = null
  let fs = 0
  let tc = 0
  let tw = 0
  let th = 1
  let tl = 0
  let rise = 0
  let render = 0
  /** @type {Mat} */
  let tm = IDENTITY
  /** @type {Mat} */
  let tlm = IDENTITY
  /** @type {string[]} */
  const marks = []

  const role = () => {
    for (let k = marks.length - 1; k >= 0; k--) if (marks[k] !== 'Span') return marks[k]
    return marks.length ? 'Span' : null
  }

  /** @param {Uint8Array} s */
  function show(s) {
    if (!font) return
    const step = font.composite ? 2 : 1
    for (let k = 0; k + step <= s.length; k += step) {
      const code = step === 2 ? s[k] * 256 + s[k + 1] : s[k]
      const w0 = font.width(code) / 1000
      const m = mul(tm, ctm)
      const hscale = Math.hypot(m[0], m[1])
      const vscale = Math.hypot(m[2], m[3])
      const trm = mul([fs * th, 0, 0, fs, 0, rise], m)
      if (render !== 3) {
        env.chars.push({
          c: font.unicode(code),
          x: trm[4] - env.ox,
          y: trm[5] - env.oy,
          size: fs * vscale,
          adv: w0 * fs * th * hscale,
          font: font.name,
          role: role(),
        })
      }
      // Tw は 1 バイトの字 32 にだけ効く（2 バイトの字には効かない）
      const tx = (w0 * fs + tc + (!font.composite && code === 32 ? tw : 0)) * th
      tm = mul([1, 0, 0, 1, tx, 0], tm)
    }
  }

  /** @param {number} tx @param {number} ty */
  const nextLine = (tx, ty) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm)
    tm = tlm
  }

  /** @param {Arg[]} a @param {number} k */
  const n = (a, k) => (typeof a[k] === 'number' ? /** @type {number} */ (a[k]) : 0)

  for (const { op, args } of ops) {
    switch (op) {
      case 'q':
        stack.push({ ctm, font, fs, tc, tw, th, tl, rise, render })
        break
      case 'Q': {
        const s = stack.pop()
        if (s) ({ ctm, font, fs, tc, tw, th, tl, rise, render } = s)
        break
      }
      case 'cm':
        ctm = mul([n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), n(args, 5)], ctm)
        break
      case 'BT':
        tm = IDENTITY
        tlm = IDENTITY
        break
      case 'Tf': {
        const nm = /** @type {NameObj} */ (args[0])
        fs = n(args, 1)
        font = null
        const fonts = resources?.lookup(PDFName.of('Font'))
        const fd = fonts instanceof PDFDict && nm && typeof nm === 'object' && 'name' in nm ? fonts.lookup(PDFName.of(nm.name)) : undefined
        if (fd instanceof PDFDict) {
          let f = env.fonts.get(fd)
          if (!f) {
            f = loadFont(fd, env.warnings)
            env.fonts.set(fd, f)
          }
          font = f
        } else env.warnings.push(`Tf の書体 ${nm && 'name' in nm ? nm.name : '?'} が Resources に無い`)
        break
      }
      case 'Tc': tc = n(args, 0); break
      case 'Tw': tw = n(args, 0); break
      case 'Tz': th = n(args, 0) / 100; break
      case 'TL': tl = n(args, 0); break
      case 'Ts': rise = n(args, 0); break
      case 'Tr': render = n(args, 0); break
      case 'Tm':
        tm = [n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), n(args, 5)]
        tlm = tm
        break
      case 'Td': nextLine(n(args, 0), n(args, 1)); break
      case 'TD': tl = -n(args, 1); nextLine(n(args, 0), n(args, 1)); break
      case 'T*': nextLine(0, -tl); break
      case 'Tj': if (args[0] instanceof Uint8Array) show(args[0]); break
      case "'":
        nextLine(0, -tl)
        if (args[0] instanceof Uint8Array) show(args[0])
        break
      case '"':
        tw = n(args, 0)
        tc = n(args, 1)
        nextLine(0, -tl)
        if (args[2] instanceof Uint8Array) show(args[2])
        break
      case 'TJ': {
        const arr = args[0]
        if (!Array.isArray(arr)) break
        for (const it of arr) {
          if (it instanceof Uint8Array) show(it)
          else if (typeof it === 'number') tm = mul([1, 0, 0, 1, (-it / 1000) * fs * th, 0], tm)
        }
        break
      }
      case 'BDC':
      case 'BMC': {
        const nm = args[0]
        marks.push(nm && typeof nm === 'object' && 'name' in nm ? nm.name : 'Span')
        break
      }
      case 'EMC': marks.pop(); break
      case 'Do': {
        const nm = args[0]
        const xs = resources?.lookup(PDFName.of('XObject'))
        const xo = xs instanceof PDFDict && nm && typeof nm === 'object' && 'name' in nm ? xs.lookup(PDFName.of(nm.name)) : undefined
        if (isStream(xo) && env.depth < MAX_FORM_DEPTH && !env.seen.has(xo)) {
          const st = xo.dict.lookup(PDFName.of('Subtype'))
          if (st instanceof PDFName && st.decodeText() === 'Form') {
            const mt = xo.dict.lookup(PDFName.of('Matrix'))
            /** @type {Mat} */
            let fm = IDENTITY
            if (mt instanceof PDFArray && mt.size() === 6) fm = /** @type {Mat} */ ([0, 1, 2, 3, 4, 5].map((k) => numOf(mt.lookup(k))))
            const own = xo.dict.lookup(PDFName.of('Resources'))
            env.seen.add(xo)
            env.depth++
            try {
              interpret(streamBytes(xo), own instanceof PDFDict ? own : resources, mul(fm, ctm), env)
            } catch (e) { env.warnings.push(`Form XObject を読めなかった: ${errText(e)}`) }
            env.depth--
            env.seen.delete(xo)
          }
        }
        break
      }
      default:
        break
    }
  }
}

/**
 * 頁ごとの字を読む。
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pages: PageChars[], warnings: string[] }>}
 */
export async function readPdfChars(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
  /** @type {string[]} */
  const warnings = []
  /** @type {Map<PDFDict, FontInfo>} */
  const fonts = new Map()
  /** @type {PageChars[]} */
  const pages = []
  const list = doc.getPages()
  for (let i = 0; i < list.length; i++) {
    const page = list[i]
    const box = page.getMediaBox()
    /** @type {Char[]} */
    const chars = []
    const contents = page.node.Contents()
    /** @type {Uint8Array[]} */
    const parts = []
    if (isStream(contents)) parts.push(streamBytes(contents))
    else if (contents instanceof PDFArray) {
      for (let k = 0; k < contents.size(); k++) {
        const s = contents.lookup(k)
        if (isStream(s)) parts.push(streamBytes(s))
      }
    }
    const joined = new Uint8Array(parts.reduce((a, p) => a + p.length + 1, 0))
    let at = 0
    for (const p of parts) {
      joined.set(p, at)
      at += p.length
      joined[at++] = 10
    }
    const env = { chars, warnings, fonts, ox: box.x, oy: box.y, depth: 0, seen: new Set() }
    try {
      interpret(joined, page.node.Resources(), IDENTITY, env)
    } catch (e) { warnings.push(`${i + 1} 頁を読めなかった: ${errText(e)}`) }
    pages.push({ index: i, width: box.width, height: box.height, chars })
  }
  return { pages, warnings: [...new Set(warnings)] }
}

// ---------------------------------------------------------------- 行

/** 字面が箱の左半分に寄っている終わり括弧・句読点（行末で右の半分が空いている字） */
const LEFT_INK = new Set(Array.from('、。，．）」』】〕〉》〙〗］｝’”'))

/**
 * 字の墨（見える部分）の右端。左寄りの約物は箱の半分まで。比例幅の字（箱が 1em に満たない）は箱いっぱい。
 * 行末の約物が版面の外に半分はみ出す組み方（ぶら下げでなく空きを詰める）を、箱でなく墨で比べるため。
 * @param {Char} ch
 */
export function inkRight(ch) {
  if (LEFT_INK.has(ch.c) && ch.adv >= ch.size * 0.99) return ch.x + ch.adv * 0.5
  return ch.x + ch.adv
}

/**
 * @typedef {{
 *   page: number, y: number, size: number, x0: number, x1: number, ink: number,
 *   chars: Char[], text: string,
 * }} Line
 * x0 は先頭の字の箱の左端、x1 は末尾の字の箱の右端、ink は末尾の字の墨の右端
 */

/**
 * 字を行にまとめる。基線が yTol 以内で同じ大きさの字が 1 行。同じ基線でも字の間が splitEm 以上開けば別の行（表の列など）。
 * ページの並びの上から下、同じ高さなら左から右。
 * @param {PageChars[]} pages
 * @param {{ sizeMin?: number, sizeMax?: number, yTol?: number, splitEm?: number }} [o]
 * @returns {Line[]}
 */
export function groupLines(pages, o = {}) {
  const { sizeMin = 0, sizeMax = Infinity, yTol = 0.6, splitEm = 2.5 } = o
  /** @type {Line[]} */
  const out = []
  for (const pg of pages) {
    const cs = pg.chars.filter((c) => c.size >= sizeMin && c.size <= sizeMax && c.c !== REPLACEMENT)
    // 基線の降順（上の行から）に並べて、基線が近い字を 1 行に集める
    const sorted = [...cs].sort((a, b) => b.y - a.y || a.x - b.x)
    /** @type {Char[][]} */
    const rows = []
    for (const ch of sorted) {
      const row = rows[rows.length - 1]
      if (row && Math.abs(row[0].y - ch.y) <= yTol && Math.abs(row[0].size - ch.size) <= 0.3) row.push(ch)
      else rows.push([ch])
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      /** @type {Char[]} */
      let seg = []
      const flush = () => {
        // 行の頭と末の空白の字は版面の端を測るのに邪魔なので外す（Typst は行末に空白の字を残す）
        while (seg.length && /^\s/.test(seg[0].c)) seg.shift()
        while (seg.length && /^\s/.test(seg[seg.length - 1].c)) seg.pop()
        if (!seg.length) return
        const first = seg[0]
        const last = seg[seg.length - 1]
        out.push({
          page: pg.index,
          y: first.y,
          size: first.size,
          x0: first.x,
          x1: last.x + last.adv,
          ink: inkRight(last),
          chars: seg,
          text: seg.map((c) => c.c).join(''),
        })
        seg = []
      }
      for (const ch of row) {
        const prev = seg[seg.length - 1]
        if (prev && ch.x - (prev.x + prev.adv) > splitEm * prev.size) flush()
        seg.push(ch)
      }
      flush()
    }
  }
  return out
}

/**
 * 最後の頁の埋まり（0〜1）。版面の上端から、本文の一番下の字の基線までが、版面の高さのどれだけか。
 * 足（下の余白の中）の字と、minSize 未満の字（ルビなど）は数えない。
 * @param {PageChars[]} pages
 * @param {{ top: number, bottom: number, minSize?: number }} o 上と下の余白（pt）
 * @returns {number}
 */
export function lastPageFill(pages, { top, bottom, minSize = 7 }) {
  const last = pages[pages.length - 1]
  if (!last) return 0
  let deepest = 0
  for (const c of last.chars) {
    if (c.size < minSize - 0.01 || /\s/.test(c.c)) continue
    const yTop = last.height - c.y
    if (yTop > last.height - bottom + 1) continue
    if (yTop > deepest) deepest = yTop
  }
  return Math.max(0, Math.min(1, (deepest - top) / (last.height - top - bottom)))
}
