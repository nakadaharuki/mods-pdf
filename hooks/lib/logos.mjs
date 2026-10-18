// @ts-check
// ティッカーのロゴ（別のリポ mods-pdf-logos）を読んで { 'NYSE:IBM': svgText } にする。`$` を知らない純な部品。
// ファイルを読む関数 read(path) → Promise<string> は本体（hooks/mods-pdf.mjs）が `fs の read` を包んで渡す。
//
// 選ばなかった案:
//   - 白いロゴの色を ink に塗り替える案: 白に見える色は #fff だけでなく近い灰もあり、fill・stroke・style・rgb() の
//     どの書き方も読み分ける事になる。塗りの明るさで白と決めた index.json の white は、書き方を問わず
//     viewBox を広げて濃い丸い地を 1 枚敷けば見える。
//   - 白いロゴを使わない案: 本人の「全部入れる」に反する。見えるようにして出す。
//   - Claude の渡した ticker からファイルの場所を作る案: 場所は index.json の file だけから取る（..・別の階層を断る）。
//     ticker は索引を引く鍵にしか使わない。
//   - index.json が無い時に投げる案: ロゴは飾りなので黙って空を返し、warnings に 1 行だけ書く。

/** ロゴの置き場の名前（~/.claude の下） */
export const LOGOS_DIR_NAME = 'mods-pdf-logos'
/** 1 回に読むロゴの数の上限 */
export const MAX_LOGOS = 200
/** SVG 1 本の大きさの上限（字）。mods-pdf-logos の build は整えて 600 KB までにしている。描く側の限り（svg.mjs の MAX_SOURCE）に合わせて厳しめに */
export const MAX_SVG_CHARS = 200_000
/** 白いロゴの下に敷く地の色。白が乗って 7:1 以上の濃さ */
export const PILL_FILL = '#333333'

const EXCHANGE_ALIAS = /** @type {Record<string, string>} */ ({ TYO: 'TSE', JPX: 'TSE' })
/** index.json の file に許す形。階層は取引所の 1 段だけ */
const FILE_RE = /^svg\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.svg$/

/**
 * 'NYSE:IBM'・'TSE:7203'・'NASDAQ:AAPL'・'NYSE:BRK.B' の形を読む。取引所は大文字にし、TYO・JPX は TSE に直す
 * @param {unknown} raw
 * @returns {{ exchange: string, code: string, ticker: string } | null}
 */
export function parseLogoKey(raw) {
  if (typeof raw !== 'string' || raw.length > 40) return null
  const m = /^\s*([A-Za-z]{2,8})\s*:\s*([A-Za-z0-9][A-Za-z0-9.\-]{0,9})\s*$/.exec(raw)
  if (!m) return null
  const up = m[1].toUpperCase()
  const exchange = EXCHANGE_ALIAS[up] ?? up
  const code = m[2].toUpperCase()
  return { exchange, code, ticker: `${exchange}:${code}` }
}

/**
 * 原稿（道具の引数）の中の logo の字を集める。表のセル・KPI・箇条書きのどこにあっても拾う。
 * 本体が compose の前に 1 回呼び、返った物だけを loadLogos に渡す
 * @param {unknown} input
 * @param {{ max?: number }} [o]
 * @returns {string[]} 形が正しい物だけ・重複なし・正規化した 'NYSE:IBM' の形
 */
export function collectLogoKeys(input, { max = MAX_LOGOS } = {}) {
  /** @type {Set<string>} */
  const found = new Set()
  /** @type {unknown[]} */
  const stack = [input]
  let visited = 0
  while (stack.length && visited < 200_000 && found.size < max) {
    const v = stack.pop()
    visited++
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object') stack.push(x)
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const x = /** @type {Record<string, unknown>} */ (v)[k]
        if (k === 'logo') {
          const p = parseLogoKey(x)
          if (p) found.add(p.ticker)
        } else if (x && typeof x === 'object') stack.push(x)
      }
    }
  }
  return [...found]
}

/**
 * ロゴの置き場。プラグインの root から上へ、名前が .claude の祖先を探し、その下の mods-pdf-logos を返す。
 * 祖先に .claude が無い時（C:/dev/mods-pdf を直に読み込んだ開発中など）は null
 * @param {unknown} pluginRoot
 * @returns {string | null}
 */
export function logosRoot(pluginRoot) {
  if (typeof pluginRoot !== 'string' || pluginRoot === '') return null
  const parts = pluginRoot.replace(/\\/g, '/').split('/').filter((s, i) => s !== '' || i === 0)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === '.claude') return `${parts.slice(0, i + 1).join('/')}/${LOGOS_DIR_NAME}`
  }
  return null
}

/**
 * logos の表から、原稿の logo の字に合う SVG を引く（BRK-B と BRK.B は同じ物として探す）
 * @param {Record<string, string> | undefined | null} logos
 * @param {unknown} key
 * @returns {string | null}
 */
export function lookupLogo(logos, key) {
  if (!logos) return null
  const p = parseLogoKey(key)
  if (!p) return null
  return logos[p.ticker] ?? logos[`${p.exchange}:${p.code.replace(/-/g, '.')}`] ?? null
}

const NUM = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)'
const VIEWBOX_RE = new RegExp(`\\sviewBox\\s*=\\s*(["'])\\s*${NUM}[\\s,]+${NUM}[\\s,]+${NUM}[\\s,]+${NUM}\\s*\\1`)
const round = (/** @type {number} */ n) => String(Math.round(n * 1000) / 1000)

/**
 * 白いロゴを濃い丸い地（両端が半円の四角）の上に載せた SVG にする。中身の色には触らない。
 * 根の viewBox を広げ、その全面に塗りの四角を 1 枚、根の直後（一番奥）に足す。読めなければ null
 * @param {string} svg
 * @param {string} [fill]
 * @returns {string | null}
 */
export function onPill(svg, fill = PILL_FILL) {
  const root = /<svg\b[^>]*>/i.exec(svg)
  if (!root || root[0].endsWith('/>')) return null
  const tag = root[0]
  let x, y, w, h
  const vb = VIEWBOX_RE.exec(tag)
  if (vb) {
    ;[x, y, w, h] = [vb[2], vb[3], vb[4], vb[5]].map(Number)
  } else {
    const wm = new RegExp(`\\swidth\\s*=\\s*["']\\s*${NUM}(?:px)?\\s*["']`).exec(tag)
    const hm = new RegExp(`\\sheight\\s*=\\s*["']\\s*${NUM}(?:px)?\\s*["']`).exec(tag)
    if (!wm || !hm) return null
    ;[x, y, w, h] = [0, 0, Number(wm[1]), Number(hm[1])]
  }
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
  const padX = 0.5 * h
  const padY = 0.2 * h
  const nx = x - padX
  const ny = y - padY
  const nw = w + 2 * padX
  const nh = h + 2 * padY
  const box = `${round(nx)} ${round(ny)} ${round(nw)} ${round(nh)}`
  const newTag = vb ? tag.replace(VIEWBOX_RE, ` viewBox="${box}"`) : tag.replace(/<svg\b/i, `<svg viewBox="${box}"`)
  const rect = `<rect x="${round(nx)}" y="${round(ny)}" width="${round(nw)}" height="${round(nh)}" rx="${round(nh / 2)}" fill="${fill}" stroke="none" opacity="1"/>`
  return svg.slice(0, root.index) + newTag + rect + svg.slice(root.index + tag.length)
}

/**
 * index.json の字を ticker で引く表にする。形がおかしい行は捨てる
 * @param {string} text
 * @returns {Map<string, { file: string, white: boolean }>}
 */
function parseIndex(text) {
  const rows = JSON.parse(text)
  /** @type {Map<string, { file: string, white: boolean }>} */
  const map = new Map()
  if (!Array.isArray(rows)) return map
  for (const r of rows) {
    const p = r && typeof r === 'object' ? parseLogoKey(r.ticker) : null
    if (!p || typeof r.file !== 'string' || !FILE_RE.test(r.file) || r.file.includes('..')) continue
    map.set(p.ticker, { file: r.file, white: r.white === true })
  }
  return map
}

/** 置き場ごとに覚える（索引と、読んだ SVG）。索引が無かった時は覚えない（あとから clone されるかもしれない） */
const caches = /** @type {Map<string, { index: Map<string, { file: string, white: boolean }>, svgs: Map<string, string | null> }>} */ (new Map())

/** 試験用: 覚えた物を捨てる */
export function clearLogoCache() {
  caches.clear()
}

/**
 * logo の字の集まりから { 'NYSE:IBM': svgText } を作る。索引が無い・読めない時は黙って空を返し、warnings に 1 行だけ書く。
 * 白いロゴ（index.json の white）は onPill で丸い地に載せて返す
 * @param {Iterable<string>} keys 'NYSE:IBM' の形（collectLogoKeys の答え）
 * @param {{ read: (path: string) => Promise<string>, dir?: string | null, root?: unknown }} o
 *   read は本体が fs の read を包んだ物（無い時は投げる）。dir はロゴの置き場、無ければ root（プラグインの root）から logosRoot で決める
 * @returns {Promise<{ logos: Record<string, string>, warnings: string[] }>}
 */
export async function loadLogos(keys, { read, dir, root }) {
  /** @type {Record<string, string>} */
  const logos = {}
  /** @type {string[]} */
  const warnings = []
  /** @type {string[]} */
  const wanted = []
  /** @type {string[]} */
  const malformed = []
  for (const k of keys) {
    const p = parseLogoKey(k)
    if (!p) malformed.push(String(k).slice(0, 40))
    else if (!wanted.includes(p.ticker)) wanted.push(p.ticker)
  }
  if (malformed.length) warnings.push(`logo の形が違うので描きません（NYSE:IBM・TSE:7203 の形）: ${malformed.slice(0, 5).join(', ')}`)
  if (wanted.length === 0) return { logos, warnings }
  if (wanted.length > MAX_LOGOS) {
    warnings.push(`ロゴが ${MAX_LOGOS} 個を超えたので、先の ${MAX_LOGOS} 個だけ描きます`)
    wanted.length = MAX_LOGOS
  }

  const base = dir ?? logosRoot(root)
  if (!base) {
    warnings.push(`ロゴの置き場（~/.claude/${LOGOS_DIR_NAME}）をプラグインの場所から決められなかったので、ロゴは描きません`)
    return { logos, warnings }
  }
  let cache = caches.get(base)
  if (!cache) {
    let index
    try {
      index = parseIndex(await read(`${base}/index.json`))
    } catch {
      warnings.push(`ロゴの索引（${base}/index.json）を読めなかったので、ロゴは描きません。置き方は docs/assets.md`)
      return { logos, warnings }
    }
    cache = { index, svgs: new Map() }
    caches.set(base, cache)
  }
  const c = cache

  /** @type {string[]} */
  const missing = []
  /** @type {string[]} */
  const failed = []
  await Promise.all(wanted.map(async (ticker) => {
    const row = c.index.get(ticker)
    if (!row) { missing.push(ticker); return }
    let svg = c.svgs.get(row.file)
    if (svg === undefined) {
      try {
        const got = await read(`${base}/${row.file}`)
        svg = typeof got === 'string' && got.length <= MAX_SVG_CHARS && /^\s*(<\?xml[^>]*\?>\s*)?<svg\b/i.test(got) ? got : null
      } catch {
        svg = null
      }
      c.svgs.set(row.file, svg)
    }
    if (svg === null) { failed.push(ticker); return }
    const out = row.white ? onPill(svg) : svg
    if (out === null) { failed.push(ticker); return }
    logos[ticker] = out
  }))
  // 並行に読むので到着順がばらつく。同じ入力に同じ答えを返すため並べ直す
  missing.sort()
  failed.sort()
  if (missing.length) warnings.push(`ロゴが無い物（${missing.length} 件。字だけで出します）: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' ほか' : ''}`)
  if (failed.length) warnings.push(`ロゴを読めなかった物（${failed.length} 件）: ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? ' ほか' : ''}`)
  return { logos, warnings }
}
