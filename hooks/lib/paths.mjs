// @ts-check
// 書く場所と読む場所の決まり。純な部品（ファイルには触らない）。
// 道具の引数は Claude が書く字なので、ここで綴りだけを先に断る。ファイルの有無やリンクの先は本体が stat で確かめる。

/** 読むファイルの大きさの上限。fs の読みは base64 で 4 MiB まで、4/3 倍になるので 3 MiB 未満 */
export const READ_LIMIT = 3 * 1024 * 1024
/** 書く場所の頭。必ずこの下に書く */
export const OUT_DIR = 'pdf'
const NAME_MAX = 80
/** Windows が装置名として扱う名前。拡張子が付いても予約のままなので、頭の語で見る */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 読める拡張子 */
export const PDF_EXT = ['pdf']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg']

/**
 * 字・数字・._- だけを残し、ほかは - にする。選ばなかった案: 危ない字を断る案。
 * 題名から付ける名前は日本語や記号が混ざるのが普通で、断ると Claude が毎回やり直すことになるので掃除して使う。
 * @param {unknown} raw
 * @returns {string} 拡張子の無い名前
 */
export function cleanName(raw) {
  let s = String(raw ?? '').normalize('NFC').trim()
  s = s.replace(/\.pdf$/i, '')
  /** @type {string[]} */
  const kept = []
  for (const ch of s) kept.push(/^[\p{L}\p{Nd}._-]$/u.test(ch) ? ch : '-')
  let name = kept.join('').replace(/^\.+/, '')
  name = Array.from(name).slice(0, NAME_MAX).join('')
  if (!name) name = 'document'
  // CON.foo も予約。最初の . より前の語で見る
  if (RESERVED.test(name.split('.')[0])) name = '_' + name
  return name
}

/**
 * 書く場所。必ず pdf/ の下
 * @param {unknown} raw
 * @returns {string}
 */
export function outPath(raw) {
  return `${OUT_DIR}/${cleanName(raw)}.pdf`
}

/**
 * 元の PDF の名前から、拡張子と場所を外した名前
 * @param {unknown} p
 * @returns {string}
 */
export function baseNameOf(p) {
  const s = String(p ?? '')
  const last = s.split(/[\\/]/).pop() ?? ''
  return last.replace(/\.[A-Za-z0-9]+$/, '')
}

/**
 * 読む場所の綴りを確かめる。作業フォルダーからの相対だけを通す。
 * 断る時は { ok: false, reason }（Claude が直せるよう、理由は字で返す）。
 * @param {unknown} raw
 * @param {readonly string[]} exts 通す拡張子（小文字）
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function checkReadPath(raw, exts) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'path が空です。作業フォルダーからの相対パスを渡してください' }
  const p = raw.trim()
  for (const ch of p) {
    const cp = /** @type {number} */ (ch.codePointAt(0))
    if (cp < 0x20 || cp === 0x7f) return { ok: false, reason: 'path に制御文字が入っています' }
  }
  if (/^[\\/]/.test(p)) return { ok: false, reason: `/ や \\ で始まる場所（絶対パス・ネットワークの場所）は使えません（${p}）。作業フォルダーからの相対パスで渡してください` }
  if (p.startsWith('~')) return { ok: false, reason: `~ で始まる場所は使えません（${p}）。作業フォルダーからの相対パスで渡してください` }
  // C: の形に加え、名前の途中の : も断る（Windows の代替データストリーム file.pdf:x）
  if (p.includes(':')) return { ok: false, reason: `: を含む場所（ドライブ名など）は使えません（${p}）。作業フォルダーからの相対パスで渡してください` }
  const segments = p.split(/[\\/]/)
  if (segments.some((s) => /^\.{2,}$/.test(s))) return { ok: false, reason: `.. を含む場所は使えません（${p}）。作業フォルダーの中のファイルだけ読めます` }
  const ext = (p.split('.').pop() ?? '').toLowerCase()
  if (!p.includes('.') || !exts.includes(ext)) return { ok: false, reason: `読めるのは ${exts.join('・')} のファイルだけです（${p}）` }
  return { ok: true, path: p }
}

/**
 * 比べるための綴り: 区切りを / にそろえ、末尾の区切りを外す。Windows のパス（ドライブ名か \\ の頭）だけ小文字にそろえる
 * （Windows は大文字小文字を区別しない。Linux で小文字にそろえると別の名前が同じになってしまう）
 * @param {string} p
 */
function fold(p) {
  let s = p.replace(/\\/g, '/')
  const isWindows = /^[A-Za-z]:/.test(s) || p.startsWith('\\\\')
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return isWindows ? s.toLowerCase() : s
}

/**
 * 解決した場所が作業フォルダーの中か。両方とも「リンクを辿った本当の場所」で渡す
 * @param {unknown} real ファイルの realPath
 * @param {unknown} root 作業フォルダーの realPath
 * @returns {boolean}
 */
export function isInside(real, root) {
  if (typeof real !== 'string' || typeof root !== 'string' || !real || !root) return false
  const r = fold(real)
  const base = fold(root)
  const prefix = base.endsWith('/') ? base : `${base}/`
  return r.startsWith(prefix)
}
