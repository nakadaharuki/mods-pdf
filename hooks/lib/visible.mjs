// @ts-check
// 他人の PDF から来た字を、Claude に渡す前に見える形にする。純な部品。
// 双方向の制御・ゼロ幅・タグ文字は、人にも Claude にも見えないまま読み方や意味を変えられる（指示の隠し込みや表示のすり替え）。
// 消す案は選ばなかった: 消すと名前が別の名前になり、fill の values の名前と合わなくなる。<U+XXXX> に直せば元の字が分かる。

/** 見える形にする字の範囲（コードポイント）。字を直に書くと見分けが付かないので数で持つ */
const RANGES = [
  [0x0000, 0x001f], // 制御（改行・タブを含む）
  [0x007f, 0x009f], // 削除と制御
  [0x00ad, 0x00ad], // 任意のハイフン
  [0x061c, 0x061c], // アラビア文字の向きの印
  [0x180e, 0x180e],
  [0x200b, 0x200f], // ゼロ幅の字と左右の向きの印
  [0x2028, 0x202e], // 行・段落の区切りと向きの制御
  [0x2060, 0x2064], // 見えない結合・演算の印
  [0x2066, 0x2069], // 向きの孤立
  [0xfeff, 0xfeff], // ゼロ幅の空白（BOM）
  [0xe0000, 0xe007f], // タグ文字（ASCII を隠して運べる）
]

/** @param {number} cp */
function isHidden(cp) {
  for (const [a, b] of RANGES) if (cp >= a && cp <= b) return true
  return false
}

/** @param {number} cp */
const mark = (cp) => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`

/**
 * 見えない字・向きを変える字・改行を <U+XXXX> にし、長ければ切る
 * @param {unknown} value
 * @param {number} [max] 見える字の数の上限（既定 200）
 * @returns {string}
 */
export function visible(value, max = 200) {
  const s = String(value ?? '')
  let out = ''
  let n = 0
  for (const ch of s) {
    if (n >= max) return `${out}…`
    const cp = /** @type {number} */ (ch.codePointAt(0))
    out += isHidden(cp) ? mark(cp) : ch
    n += 1
  }
  return out
}

/**
 * 警告などの列を、上限までに絞って「ほか n 件」を付ける
 * @param {readonly string[]} list
 * @param {number} [max]
 * @returns {string[]}
 */
export function capList(list, max = 20) {
  if (list.length <= max) return [...list]
  return [...list.slice(0, max), `ほか ${list.length - max} 件`]
}
