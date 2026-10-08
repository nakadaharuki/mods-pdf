// @ts-check
// 字の中の印（**太字**・{親字|るび}・[字](url)・`コード`）を Inline の列にする。純な部品。
// 選ばなかった案: marked の inline lexer をそのまま使う案。{親字|るび} を知らず、\{ のような
// 逃がしを黙って {} にして印を失うので、印の読みは自前で持つ（marked は段落などの骨組みだけに使う）。

/** @typedef {{ text: string, bold?: true, ruby?: string, link?: string, code?: true }} Inline */
/** @typedef {{ bold?: true, link?: string }} Style 入れ子の外側から内側へ渡す飾り */

/** バックスラッシュの後ろに来ると、その字そのものになる印 */
const ESCAPABLE = '*{}[]`|'
const BACKSLASH = String.fromCodePoint(0x5c)

/** リンクに使える先。javascript: や data: は通さない（PDF に書く前の最初の関門） */
const SAFE_URL = /^(?:https?:\/\/|mailto:)[^\s\p{Cc}\p{Cf}]+$/iu
const URL_MAX = 2000

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeUrl(url) {
  return typeof url === 'string' && url.length <= URL_MAX && SAFE_URL.test(url)
}

/** @param {string} ch */
const isSpace = (ch) => /\s/.test(ch)

/**
 * 飾りの付いた Inline を作る。キーの並びを固定して、比べやすくする
 * @param {string} text
 * @param {Style} style
 * @param {{ ruby?: string, code?: true }} [extra]
 * @returns {Inline}
 */
function make(text, style, extra) {
  /** @type {Inline} */
  const it = { text }
  if (style.bold) it.bold = true
  if (extra?.ruby) it.ruby = extra.ruby
  if (style.link) it.link = style.link
  if (extra?.code) it.code = true
  return it
}

/**
 * 隣り合う同じ形の Inline をつなぎ、空の text を捨てる。
 * ルビ付きはつながない: {甲|こう}{乙|こう} を「甲乙」に 1 つのグループルビへ変えると、モノルビの意味が変わる。
 * @param {Inline[]} list
 * @returns {Inline[]}
 */
export function mergeInlines(list) {
  /** @type {Inline[]} */
  const out = []
  for (const it of list) {
    if (!it.text) continue
    const prev = out[out.length - 1]
    if (prev && !prev.ruby && !it.ruby && prev.bold === it.bold && prev.link === it.link && prev.code === it.code) {
      prev.text += it.text
    } else {
      out.push({ ...it })
    }
  }
  return out
}

/**
 * Inline の列をただの字にする（見出しの比べ合わせ・しおり用）
 * @param {Inline[]} inlines
 * @returns {string}
 */
export function plainText(inlines) {
  let s = ''
  for (const it of inlines) s += it.text
  return s
}

/**
 * 字の中の印を Inline の列にする。閉じていない印・読めない印は字のまま残す。
 * @param {string} text
 * @returns {Inline[]}
 */
export function parseInline(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  return mergeInlines(scan(s, {}))
}

/**
 * 太字の閉じ（**）の位置。開きの直後から探し、閉じの前が空白なら閉じにしない（2 ** 3 ** 4 のような式を太字にしない）。
 * @param {string} s
 * @param {number} from 開きの ** の次の位置
 * @returns {number}
 */
function findBoldClose(s, from) {
  for (let k = from; k < s.length - 1; k++) {
    const c = s[k]
    if (c === BACKSLASH && ESCAPABLE.includes(s[k + 1])) {
      k++
      continue
    }
    if (c === '*' && s[k + 1] === '*' && k > from && !isSpace(s[k - 1])) return k
  }
  return -1
}

/**
 * {親字|るび} を読む。始めの { の位置から。
 * 親字は最初の | まで、るびは最後の } まで（るびの中の | はモノルビの区切りとして残す）。
 * 途中に別の { が来たら、始めの { は字のまま（{ {漢|かん} のような崩れを救う）。
 * @param {string} s
 * @param {number} at
 * @returns {{ end: number, text: string, ruby: string } | 'dead' | null} dead は「この先に } が 1 つも無い」
 */
function readRuby(s, at) {
  let base = ''
  let ruby = ''
  let seenBar = false
  for (let j = at + 1; j < s.length; j++) {
    const c = s[j]
    if (c === BACKSLASH && j + 1 < s.length && ESCAPABLE.includes(s[j + 1])) {
      if (seenBar) ruby += s[j + 1]
      else base += s[j + 1]
      j++
      continue
    }
    if (c === '{') return null
    if (c === '}') {
      if (!seenBar || !base.trim() || !ruby.trim()) return null
      return { end: j, text: base, ruby }
    }
    if (c === '|' && !seenBar) {
      seenBar = true
      continue
    }
    if (seenBar) ruby += c
    else base += c
  }
  return 'dead'
}

/**
 * [字](url) を読む。字の中の入れ子の [] と、url の中の入れ子の () を数える（Wikipedia の URL など）。
 * 安全でない url は null（呼び出し側は [ を字のまま残す）。
 * @param {string} s
 * @param {number} at 始めの [ の位置
 * @returns {{ end: number, inner: string, url: string } | null}
 */
function readLink(s, at) {
  let depth = 1
  let close = -1
  for (let j = at + 1; j < s.length; j++) {
    const c = s[j]
    if (c === BACKSLASH && j + 1 < s.length && ESCAPABLE.includes(s[j + 1])) {
      j++
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        close = j
        break
      }
    }
  }
  if (close < 0) return null
  if (s[close + 1] !== '(') return null
  let pd = 1
  let end = -1
  for (let j = close + 2; j < s.length; j++) {
    const c = s[j]
    if (c === '(') pd++
    else if (c === ')') {
      pd--
      if (pd === 0) {
        end = j
        break
      }
    }
  }
  if (end < 0) return null
  const dest = s.slice(close + 2, end).trim()
  let url = ''
  let rest = ''
  if (dest.startsWith('<')) {
    const gt = dest.indexOf('>')
    if (gt < 0) return null
    url = dest.slice(1, gt)
    rest = dest.slice(gt + 1).trim()
  } else {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(dest)
    if (!m) return null
    url = m[1]
    rest = m[2].trim()
  }
  // 「url "題"」の題は捨てる。それ以外の余りはリンクではない
  if (rest && !/^["'(]/.test(rest)) return null
  if (!isSafeUrl(url)) return null
  return { end, inner: s.slice(at + 1, close), url }
}

/**
 * @param {string} s
 * @param {Style} style
 * @returns {Inline[]}
 */
function scan(s, style) {
  /** @type {Inline[]} */
  const out = []
  let buf = ''
  // 一度「この先に閉じが無い」と分かった印は、以降の同じ印を探し直さない（{{{{ や ** の繰り返しで 2 乗にならない）
  let starDead = false
  let braceDead = false
  let tickDead = false
  // [ は入れ子を数えるので「閉じが無い」を一度の失敗では決められない。最後の ] より後の [ だけ探さない
  const lastClose = s.lastIndexOf(']')
  const flush = () => {
    if (buf) {
      out.push(make(buf, style))
      buf = ''
    }
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === BACKSLASH) {
      const nx = s[i + 1]
      if (nx !== undefined && ESCAPABLE.includes(nx)) {
        buf += nx
        i += 2
      } else {
        buf += ch
        i += 1
      }
      continue
    }
    if (ch === '*' && s[i + 1] === '*') {
      const open = i + 2
      if (!starDead && open < s.length && !isSpace(s[open])) {
        const close = findBoldClose(s, open)
        if (close >= 0) {
          flush()
          out.push(...scan(s.slice(open, close), { ...style, bold: true }))
          i = close + 2
          continue
        }
        starDead = true
      }
      buf += '**'
      i += 2
      continue
    }
    if (ch === '{') {
      if (!braceDead) {
        const r = readRuby(s, i)
        if (r === 'dead') braceDead = true
        else if (r) {
          flush()
          out.push(make(r.text, style, { ruby: r.ruby }))
          i = r.end + 1
          continue
        }
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '[') {
      if (!style.link && i < lastClose) {
        const r = readLink(s, i)
        if (r) {
          flush()
          // 字が空のリンクは url を字にする（見えないリンクを作らない）
          if (r.inner.trim() === '') out.push(make(r.url, { ...style, link: r.url }))
          else out.push(...scan(r.inner, { ...style, link: r.url }))
          i = r.end + 1
          continue
        }
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '`') {
      const j = tickDead ? -1 : s.indexOf('`', i + 1)
      if (j === -1) {
        tickDead = true
        buf += ch
        i += 1
        continue
      }
      if (j === i + 1) {
        // `` は空のコード。閉じでも開きでもなく字のまま
        buf += '``'
        i += 2
        continue
      }
      flush()
      out.push(make(s.slice(i + 1, j), style, { code: true }))
      i = j + 1
      continue
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}
