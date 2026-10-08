// @ts-check
// 日本語組版の字の分類・禁則・約物の空き。
//
// 出典（事実の表を、この頁の外に取りに行かず、決まりとして写した）:
//   - W3C「日本語組版処理の要件」(JLReq) 付属資料 A（文字クラス）と付属資料 B（約物の並びの空き）
//   - JIS X 4051 の行頭禁則・行末禁則・分離禁止
// 文字クラスの番号は JLReq の cl-01〜cl-30 のうち、横組みの本文で使う物だけを持つ（20〜25・28〜30 は v0.1 では使わない）。
// 表を推測で埋めない。付属資料 A に無い字は、CJK の領域なら 19（どこでも切れる字）、それ以外は 27（欧文用）にする。
//
// 空きの単位はすべて em（字の大きさに対する割合）。

export const CL = Object.freeze({
  OPENING: 1,
  CLOSING: 2,
  HYPHEN: 3,
  DIVIDING: 4,
  MIDDLE_DOT: 5,
  FULL_STOP: 6,
  COMMA: 7,
  INSEPARABLE: 8,
  ITERATION: 9,
  PROLONGED: 10,
  SMALL_KANA: 11,
  PREFIX: 12,
  POSTFIX: 13,
  IDEOGRAPHIC_SPACE: 14,
  HIRAGANA: 15,
  KATAKANA: 16,
  MATH_SYMBOL: 17,
  MATH_OPERATOR: 18,
  IDEOGRAPHIC: 19,
  WESTERN_SPACE: 26,
  WESTERN: 27,
})

/** 小さな表は字を並べた文字列で書く。コードポイントで引けるようにここで 1 度だけ展開する。 */
const TABLE = new Map()
/**
 * @param {number} cls
 * @param {string} chars
 */
function put(cls, chars) {
  for (const ch of chars) TABLE.set(/** @type {number} */ (ch.codePointAt(0)), cls)
}

put(CL.OPENING, '‘“（〔［｛〈《「『【｟〘〖〝«〚｢')
put(CL.CLOSING, '’”）〕］｝〉》」』】｠〙〗〟»〛〞｣')
// ～（全角チルダ）は Windows で 〜 の代わりに使われるので同じ扱いにする
put(CL.HYPHEN, '‐〜゠–～')
put(CL.DIVIDING, '！？‼⁇⁈⁉')
put(CL.MIDDLE_DOT, '・：；･')
put(CL.FULL_STOP, '。．｡')
put(CL.COMMA, '、，､')
// ― (U+2015) は日本語の文書でダッシュとして使うので — と同じ扱いにする
put(CL.INSEPARABLE, '—―…‥〳〴〵')
put(CL.ITERATION, 'ヽヾゝゞ々〻')
put(CL.PROLONGED, 'ーｰ')
put(CL.SMALL_KANA, 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿﾞﾟ')
put(CL.PREFIX, '￥＄￡＃€№')
put(CL.POSTFIX, '°′″℃￠％‰')
put(CL.MATH_SYMBOL, '＝≠≦≧＜＞')
put(CL.MATH_OPERATOR, '＋−×÷±')
put(CL.IDEOGRAPHIC, '〆〇※†‡•')
TABLE.set(0x3000, CL.IDEOGRAPHIC_SPACE)

/** ASCII のうち、行頭に置けない字・行末に置けない字（クラスは 27 のまま、禁則だけ別に持つ） */
const ASCII_NO_BREAK_BEFORE = new Set(Array.from(')]},.:;?!%', (c) => /** @type {number} */ (c.codePointAt(0))))
const ASCII_NO_BREAK_AFTER = new Set(Array.from('([{', (c) => /** @type {number} */ (c.codePointAt(0))))

const NO_BREAK_BEFORE_CLASSES = new Set([2, 3, 4, 5, 6, 7, 9, 10, 11, 13])
const NO_BREAK_AFTER_CLASSES = new Set([1, 12])

/**
 * コードポイントの文字クラス。
 * @param {number} cp
 * @returns {number}
 */
export function classOfCp(cp) {
  const hit = TABLE.get(cp)
  if (hit !== undefined) return hit
  if (cp < 0x80) return cp <= 0x20 ? CL.WESTERN_SPACE : CL.WESTERN
  if (cp >= 0x3041 && cp <= 0x309f) return CL.HIRAGANA
  if (cp >= 0x30a0 && cp <= 0x30ff) return CL.KATAKANA
  if (cp >= 0x31f0 && cp <= 0x31ff) return CL.SMALL_KANA
  if (cp >= 0x4e00 && cp <= 0x9fff) return CL.IDEOGRAPHIC
  if (cp >= 0x3400 && cp <= 0x4dbf) return CL.IDEOGRAPHIC
  if (cp >= 0xf900 && cp <= 0xfaff) return CL.IDEOGRAPHIC
  if (cp >= 0x20000 && cp <= 0x3ffff) return CL.IDEOGRAPHIC
  // 半角カタカナ（ｦ〜ﾝ）
  if (cp >= 0xff66 && cp <= 0xff9d) return CL.KATAKANA
  // 全角の英数字・記号（表に無い物）は 19 と同じ扱い
  if (cp >= 0xff00 && cp <= 0xffef) return CL.IDEOGRAPHIC
  // 部首・CJK の記号・ハングル・矢印や図形など、日本語の書体では全角で出る領域
  if (cp >= 0x2e80 && cp <= 0x33ff) return CL.IDEOGRAPHIC
  if (cp >= 0x1100 && cp <= 0x11ff) return CL.IDEOGRAPHIC
  if (cp >= 0xa000 && cp <= 0xa4cf) return CL.IDEOGRAPHIC
  if (cp >= 0xac00 && cp <= 0xd7af) return CL.IDEOGRAPHIC
  if (cp >= 0xfe30 && cp <= 0xfe6f) return CL.IDEOGRAPHIC
  if (cp >= 0x2190 && cp <= 0x2bff) return CL.IDEOGRAPHIC
  if (cp >= 0x1f000 && cp <= 0x1faff) return CL.IDEOGRAPHIC
  // 幅のある空白（en space など）は欧文間隔
  if ((cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f) return CL.WESTERN_SPACE
  return CL.WESTERN
}

/**
 * 1 字（先頭のコードポイント）の文字クラス。
 * @param {string} ch
 * @returns {number}
 */
export function classOf(ch) {
  const cp = ch.codePointAt(0)
  return cp === undefined ? CL.WESTERN : classOfCp(cp)
}

/**
 * 行頭禁則: この字を行頭に置いてはならない。
 * @param {string} ch
 */
export function noBreakBefore(ch) {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  if (cp < 0x80) return ASCII_NO_BREAK_BEFORE.has(cp)
  return NO_BREAK_BEFORE_CLASSES.has(classOfCp(cp))
}

/**
 * 行末禁則: この字を行末に置いてはならない。
 * @param {string} ch
 */
export function noBreakAfter(ch) {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  if (cp < 0x80) return ASCII_NO_BREAK_AFTER.has(cp)
  return NO_BREAK_AFTER_CLASSES.has(classOfCp(cp))
}

/**
 * 分離禁止: この 2 字の間で行を分けてはならない。
 * 分離禁止の字（—— ……）が 2 つ並んだ間と、欧文の語の中（27 と 27 の間）。
 * @param {string} a
 * @param {string} b
 */
export function inseparable(a, b) {
  const ca = classOf(a)
  const cb = classOf(b)
  return (ca === CL.INSEPARABLE && cb === CL.INSEPARABLE) || (ca === CL.WESTERN && cb === CL.WESTERN)
}

const NO_SPACE = Object.freeze({ before: 0, after: 0 })
const OPENING_SPACE = Object.freeze({ before: 0.5, after: 0 })
const CLOSING_SPACE = Object.freeze({ before: 0, after: 0.5 })
const MIDDLE_DOT_SPACE = Object.freeze({ before: 0.25, after: 0.25 })

/**
 * 約物の字面の半分の空き。送り幅 1em のうち字面の無い側と幅（em）。
 * 全角の送り幅を持つ字の話で、細い字形（欧文の引用符など）には linebreak 側で effectiveBlank をかけて減らす。
 * @param {string} ch
 * @returns {{ before: number, after: number }}
 */
export function halfSpace(ch) {
  switch (classOf(ch)) {
    case CL.OPENING:
      return OPENING_SPACE
    case CL.CLOSING:
    case CL.FULL_STOP:
    case CL.COMMA:
      return CLOSING_SPACE
    case CL.MIDDLE_DOT:
      return MIDDLE_DOT_SPACE
    default:
      return NO_SPACE
  }
}

/**
 * 送り幅が 1em に満たない字は、字面の無い側の空きがその分だけ小さい。
 * 例: 送り幅 0.474em の “ に 0.5em の空きを仮定すると字が重なる。
 * 式は min(空き, max(0, 送り幅 − (1 − 空き)))。送り幅 1em なら空きそのまま、0.5em 以下の字（欧文の引用符）は 0。
 * @param {number} half 名目の空き（em）
 * @param {number} adv 字の送り幅（em）
 */
export function effectiveBlank(half, adv) {
  if (half <= 0) return 0
  return Math.min(half, Math.max(0, adv - (1 - half)))
}

/**
 * 和字（クラス 15・16・19・9・10・11）。欧文との間に和欧間を入れる相手
 * @param {number} c
 */
function isWa(c) {
  return c === CL.HIRAGANA || c === CL.KATAKANA || c === CL.IDEOGRAPHIC || c === CL.ITERATION || c === CL.PROLONGED || c === CL.SMALL_KANA
}

const DEFAULT_SPACE_WIDTH = 0.25

/**
 * 欧文の空白の伸び縮み。natural は書体の空白の幅（em）。
 * @param {number} spaceWidth
 */
export function spaceGlue(spaceWidth = DEFAULT_SPACE_WIDTH) {
  return { natural: spaceWidth, min: spaceWidth * 0.8, max: spaceWidth * 1.5, priority: 3, kind: /** @type {const} */ ('space') }
}

/**
 * 隣り合う 2 字の間の空き（JLReq 付属資料 B の横組の表）。
 * natural は「2 つの字面の間の空きの合計」で、約物が持つ半分の空きを含む（和字どうしなら 0）。
 * min は縮められる下限、max は伸ばせる上限。priority は縮める順（1 約物の空き → 2 和欧間 → 3 欧文の語間、0 は動かない）。
 * 欧文の空白（クラス 26）が片方でもあれば spaceGlue を返す。
 *
 * ctx は省略できる。advA・advB は a・b の送り幅（em・既定 1）で、細い字形の約物の空きを減らすのに使う。
 * 伸ばす時の順（和欧間 → 欧文の語間 → 字間）は表でなく linebreak が持つ。
 * @param {string} a
 * @param {string} b
 * @param {{ advA?: number, advB?: number, spaceWidth?: number }} [ctx]
 * @returns {{ natural: number, min: number, max: number, priority: number, kind: 'none'|'punct'|'autospace'|'space' }}
 */
export function spaceBetween(a, b, ctx = {}) {
  const ca = classOf(a)
  const cb = classOf(b)
  if (ca === CL.WESTERN_SPACE || cb === CL.WESTERN_SPACE) return spaceGlue(ctx.spaceWidth)

  const nomA = halfSpace(a).after
  const nomB = halfSpace(b).before
  const effA = effectiveBlank(nomA, ctx.advA ?? 1)
  const effB = effectiveBlank(nomB, ctx.advB ?? 1)
  let t = effA + effB

  // 約物が並んだ時は、両方の半分を足さずに表の値にする。細い字形が混ざる時は表の前提（どちらも全角）が崩れるので足しただけにする。
  // 送り幅が 1em ちょうどでない書体（0.998em など）でも表を使えるよう、わずかな差は許す
  if (effA >= nomA - 0.02 && effB >= nomB - 0.02) {
    const aClosing = ca === CL.CLOSING || ca === CL.FULL_STOP || ca === CL.COMMA
    const bClosing = cb === CL.CLOSING || cb === CL.FULL_STOP || cb === CL.COMMA
    if (aClosing && cb === CL.OPENING) t = 0.5
    else if (aClosing && bClosing) t = 0
    else if (ca === CL.OPENING && cb === CL.OPENING) t = 0
    else if (aClosing && cb === CL.MIDDLE_DOT) t = 0.25
    else if (ca === CL.MIDDLE_DOT && cb === CL.OPENING) t = 0.5
  }

  // 和欧間。欧文側が行頭に置けない約物（閉じ括弧・コンマなど）や行末に置けない約物（開き括弧）に付く側は、字に張り付くので入れない
  if (isWa(ca) && cb === CL.WESTERN && !noBreakBefore(b)) return { natural: 0.25, min: 0.125, max: 0.5, priority: 2, kind: 'autospace' }
  if (ca === CL.WESTERN && isWa(cb) && !noBreakAfter(a)) return { natural: 0.25, min: 0.125, max: 0.5, priority: 2, kind: 'autospace' }

  if (t > 0) return { natural: t, min: 0, max: t, priority: 1, kind: 'punct' }
  return { natural: 0, min: 0, max: 0, priority: 0, kind: 'none' }
}
