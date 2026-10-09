// @ts-check
// SVG の部分集合を Display List の Op にする。純な部品（DOM も Node の物も使わない）。
// 単位は pt、y は下向き。対応する要素と属性の一覧は docs/design.md の 3.2。
//
// 選ばなかった案
// - DOMParser / 正規表現 1 本での解析: フックの環境に DOM が無い。入れ子と CDATA を正規表現で読むと壊れやすいので、小さな読み手を自前で持つ。
// - DOCTYPE の実体宣言の展開: 読み込み量が爆発する（billion laughs）。&amp; &lt; &gt; &quot; &apos; と数字参照だけ展開し、残りは字のまま。
// - グループ opacity を 1 枚の絵にまとめて合成: Op に層が無い。子の opacity に掛けて近似する（重なった子は濃く出ることがある）。
// - TextOp の透明度: Op に opacity が無いので、紙の色（paper）に混ぜた色にする。
// - 曲線の弧を Op に持たせる: path の d は M・L・C・Z だけという契約なので、弧は C の列に直す（SVG 仕様 F.6）。
// - <use>・<image>・<style>・<script>・<foreignObject>: 外への参照や実行に繋がる物は読まない。

/** @typedef {[number, number, number, number, number, number]} Mat */
/** @typedef {{ name: string, attrs: Record<string, string>, children: (XNode | string)[] }} XNode */
/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba */
/** @typedef {{ kind: 'none' } | { kind: 'current' } | { kind: 'color', rgba: Rgba } | { kind: 'url', id: string, fallback: Rgba | null }} Paint */
/** @typedef {{ ascent: number, descent: number, adv: (cp: number) => number }} FontLike */
/** @typedef {{ x?: number, y?: number, width: number, height: number, metrics?: Record<string, FontLike>, color?: string, paper?: string, clip?: 'auto' | false, quietStyle?: boolean }} SvgOpts
 *   color は currentColor の色（既定 黒）。paper は半透明の字を混ぜる地の色（既定 白）。
 *   clip: 'auto' は描いた物が四角からはみ出す時だけ ClipOp で包む。false は包まない（chartToOps が自分で包む）。
 *   quietStyle: style 要素を読まない旨の警告を出さない（ECharts は hover 用の CSS を必ず入れるため） */
/** @typedef {{ t: 'path', d: string, fill?: string, stroke?: string, lw?: number, opacity?: number, fillRule?: 'evenodd', cap?: 'round' | 'square', join?: 'round' | 'bevel', dash?: number[] }} PathOp */
/** @typedef {{ t: 'text', font: 'sans' | 'sansBold', size: number, color: string, y: number, glyphs: { c: string, x: number }[] }} TextOp */
/** @typedef {{ t: 'clip', x: number, y: number, w: number, h: number, ops: Op[] }} ClipOp */
/** @typedef {PathOp | TextOp | ClipOp} Op */
/**
 * @typedef {{
 *   fill: Paint, stroke: Paint, strokeWidth: number, dash: number[] | null,
 *   cap: 'butt' | 'round' | 'square', join: 'miter' | 'round' | 'bevel', fillRule: 'nonzero' | 'evenodd',
 *   fillOpacity: number, strokeOpacity: number, color: Rgba, fontSize: number, bold: boolean,
 *   anchor: 'start' | 'middle' | 'end', baseline: string, visible: boolean,
 * }} Style
 */
/** @typedef {{ m: Mat, style: Style, opacity: number, out: Op[], vw: number, vh: number }} Ctx */
/** @typedef {[string, ...number[]]} Seg */

/** Op の数の上限。超えた分は捨てる */
const MAX_OPS = 20000
/** 入れ子の深さの上限（再帰を浅く保つ） */
const MAX_DEPTH = 64
const MAX_SOURCE = 8_000_000
const MAX_NODES = 300_000
const MIN_TEXT_PT = 7
/** 1 つの text 要素の字数の上限。巨大な字の列で時間とメモリを使い切らないため */
const MAX_TEXT_CHARS = 20000
/** 円の 4 本の C で近似する時の制御点の比 */
const KAPPA = 0.5522847498307936

const WHITE = '#FFFFFF'
const BLACK = '#000000'

// ---------------------------------------------------------------- XML

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * 実体参照を展開する。知らない &name; はそのまま。DOCTYPE の宣言は見ない
 * @param {string} s
 */
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (whole, body) => {
    if (body[0] !== '#') return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole
    const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    // XML で許されない制御文字・サロゲート・範囲外は、字を作らず捨てる
    if (cp === 9 || cp === 10 || cp === 13) return String.fromCodePoint(cp)
    if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return ''
    return String.fromCodePoint(cp)
  })
}

/**
 * @param {string} src
 * @returns {{ root: XNode | null, error: string | null }}
 */
function parseXml(src) {
  /** @type {XNode} */
  const top = { name: '#top', attrs: Object.create(null), children: [] }
  /** @type {XNode[]} */
  const stack = [top]
  const n = src.length
  let i = 0
  let nodes = 0
  /** @param {string} msg */
  const fail = (msg) => ({ root: null, error: `${msg}（${i} 字目）` })
  while (i < n) {
    const lt = src.indexOf('<', i)
    const cur = stack[stack.length - 1]
    if (lt < 0) {
      if (stack.length > 1) return fail('閉じていない要素があります')
      break
    }
    if (lt > i && stack.length > 1) cur.children.push(decodeEntities(src.slice(i, lt)))
    i = lt
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) return fail('コメントが閉じていません')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) return fail('CDATA が閉じていません')
      if (stack.length > 1) cur.children.push(src.slice(i + 9, end))
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) return fail('処理命令が閉じていません')
      i = end + 2
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE。[ ] の中の宣言と引用符の中の > に惑わされず閉じる > を探す
      let j = i + 2
      let depth = 0
      let quote = ''
      for (; j < n; j++) {
        const ch = src[j]
        if (quote) { if (ch === quote) quote = ''; continue }
        if (ch === '"' || ch === "'") quote = ch
        else if (ch === '[') depth++
        else if (ch === ']') depth--
        else if (ch === '>' && depth <= 0) break
      }
      if (j >= n) return fail('宣言が閉じていません')
      i = j + 1
    } else if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i + 2)
      if (end < 0) return fail('終了タグが閉じていません')
      const name = src.slice(i + 2, end).trim()
      if (stack.length < 2 || stack[stack.length - 1].name !== name) return fail(`終了タグ </${name}> が開始タグと合いません`)
      stack.pop()
      i = end + 1
    } else {
      // 開始タグ
      let j = i + 1
      while (j < n && !/[\s/>]/.test(src[j])) j++
      const name = src.slice(i + 1, j)
      if (!name) return fail('要素の名前がありません')
      /** @type {XNode} */
      const node = { name, attrs: Object.create(null), children: [] }
      let selfClose = false
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++
        if (j >= n) return fail('開始タグが閉じていません')
        if (src[j] === '>') { j++; break }
        if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break }
        let k = j
        while (k < n && !/[\s=/>]/.test(src[k])) k++
        const an = src.slice(j, k)
        if (!an) return fail('属性の名前を読めません')
        while (k < n && /\s/.test(src[k])) k++
        let value = ''
        if (src[k] === '=') {
          k++
          while (k < n && /\s/.test(src[k])) k++
          const q = src[k]
          if (q !== '"' && q !== "'") return fail('属性の値が引用符で囲まれていません')
          const close = src.indexOf(q, k + 1)
          if (close < 0) return fail('属性の値が閉じていません')
          value = decodeEntities(src.slice(k + 1, close))
          k = close + 1
        }
        if (!(an in node.attrs)) node.attrs[an] = value
        j = k
      }
      if (++nodes > MAX_NODES) return fail('要素が多すぎます')
      cur.children.push(node)
      if (!selfClose) {
        if (stack.length > MAX_DEPTH * 4) return fail('入れ子が深すぎます')
        stack.push(node)
      }
      i = j
    }
  }
  if (stack.length > 1) return fail('閉じていない要素があります')
  const root = /** @type {XNode | undefined} */ (top.children.find((c) => typeof c !== 'string'))
  return root ? { root, error: null } : { root: null, error: 'SVG の要素がありません' }
}

/** @param {string} name */
const localName = (name) => (name.startsWith('svg:') ? name.slice(4) : name)

// ---------------------------------------------------------------- 数・長さ・色

// \d+\.?\d* と書くと、数字だけが 2 万字続いて最後に外れる入力で、\d+ と \d* の境目を全部試して二乗になる(0.8 秒)。小数点は後ろの組にまとめる
const NUM_SRC = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
const NUM_RE = new RegExp(NUM_SRC, 'y')
// 前後の空白は trim で落とす。正規表現の中に \s* を重ねると、空白だらけの入力で戻りが二乗になる
const LEN_RE = new RegExp(`^(${NUM_SRC})(px|pt|pc|mm|cm|in|em|ex|%)?$`, 'i')

/** @type {Record<string, number>} */
const UNIT_PX = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }

/**
 * 長さを user unit に。読めなければ NaN
 * @param {string | undefined} s @param {number} em 1em の大きさ @param {number} ref % の基準
 */
function parseLen(s, em, ref) {
  if (s === undefined) return NaN
  const m = LEN_RE.exec(s.trim())
  if (!m) return NaN
  const v = parseFloat(m[1])
  const u = (m[2] || '').toLowerCase()
  if (u === '') return v
  if (u === '%') return (v * ref) / 100
  if (u === 'em') return v * em
  if (u === 'ex') return (v * em) / 2
  return v * UNIT_PX[u]
}

/**
 * 空白かコンマで区切った数の列。読めない所があれば null
 * @param {string | undefined} s
 * @returns {number[] | null}
 */
function parseNumberList(s) {
  if (s === undefined) return null
  /** @type {number[]} */
  const out = []
  let i = 0
  const n = s.length
  for (;;) {
    while (i < n && (s[i] === ' ' || s[i] === ',' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++
    if (i >= n) break
    NUM_RE.lastIndex = i
    const m = NUM_RE.exec(s)
    if (!m) return null
    out.push(parseFloat(m[0]))
    i = NUM_RE.lastIndex
  }
  return out
}

/** @type {Record<string, [number, number, number]>} */
const COLOR_NAMES = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  lime: [0, 255, 0], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255],
  fuchsia: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  dimgray: [105, 105, 105], dimgrey: [105, 105, 105], maroon: [128, 0, 0], olive: [128, 128, 0], navy: [0, 0, 128],
  purple: [128, 0, 128], teal: [0, 128, 128], orange: [255, 165, 0], brown: [165, 42, 42], pink: [255, 192, 203],
  gold: [255, 215, 0],
}

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * @param {string} s
 * @returns {Rgba | null}
 */
function parseColor(s) {
  const t = s.trim().toLowerCase()
  if (t === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (Object.prototype.hasOwnProperty.call(COLOR_NAMES, t)) {
    const [r, g, b] = COLOR_NAMES[t]
    return { r, g, b, a: 1 }
  }
  if (t[0] === '#') {
    if (!/^#[0-9a-f]+$/.test(t)) return null
    const h = t.slice(1)
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((c) => parseInt(c + c, 16))
      return { r: v[0], g: v[1], b: v[2], a: h.length === 4 ? v[3] / 255 : 1 }
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((k) => parseInt(h.slice(k, k + 2), 16))
      return { r: v[0], g: v[1], b: v[2], a: h.length === 8 ? v[3] / 255 : 1 }
    }
    return null
  }
  // \( の後ろに \s* を置かない。空白が数万続いて ) が来ない入力で、\s* と [^)]* の境目を全部試して二乗になる。空白は下の split が捨てる
  const fm = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(t)
  if (!fm) return null
  const parts = fm[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) return null
  /** @param {string} p @param {number} full */
  const comp = (p, full) => {
    const v = parseFloat(p)
    if (!Number.isFinite(v)) return NaN
    return p.endsWith('%') ? (v * full) / 100 : v
  }
  let a = 1
  if (parts.length === 4) {
    a = comp(parts[3], 1)
    if (!Number.isFinite(a)) return null
    a = clamp(a, 0, 1)
  }
  if (fm[1][0] === 'r') {
    const v = parts.slice(0, 3).map((p) => comp(p, 255))
    if (v.some((x) => !Number.isFinite(x))) return null
    return { r: Math.round(clamp(v[0], 0, 255)), g: Math.round(clamp(v[1], 0, 255)), b: Math.round(clamp(v[2], 0, 255)), a }
  }
  const hue = parseFloat(parts[0])
  const sat = comp(parts[1], 100) / 100
  const lig = comp(parts[2], 100) / 100
  if (![hue, sat, lig].every(Number.isFinite)) return null
  const hh = ((hue % 360) + 360) % 360
  const c = (1 - Math.abs(2 * clamp(lig, 0, 1) - 1)) * clamp(sat, 0, 1)
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const mm = clamp(lig, 0, 1) - c / 2
  const sector = Math.floor(hh / 60)
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector] || [0, 0, 0]
  return { r: Math.round((rgb[0] + mm) * 255), g: Math.round((rgb[1] + mm) * 255), b: Math.round((rgb[2] + mm) * 255), a }
}

/** @param {number} v */
const hex2 = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
/** @param {Rgba} c */
const toHex = (c) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase()

/**
 * Op に透明度を持てない字のために、紙の色へ混ぜる
 * @param {Rgba} c @param {number} alpha @param {Rgba} paper
 */
function blend(c, alpha, paper) {
  const a = clamp(alpha, 0, 1)
  return toHex({ r: c.r * a + paper.r * (1 - a), g: c.g * a + paper.g * (1 - a), b: c.b * a + paper.b * (1 - a), a: 1 })
}

/** @param {number} n */
function fmt(n) {
  // 1e300 を 1e+300 と書くと、後ろの path 読みが指数を読む前提になる。紙の外にしかならない大きさは 1e7 に丸める
  const r = Math.round(clamp(n, -1e7, 1e7) * 1000) / 1000
  return String(Object.is(r, -0) ? 0 : r)
}

// ---------------------------------------------------------------- 行列

/** @type {Mat} */
const IDENTITY = [1, 0, 0, 1, 0, 0]

/** A を後から掛ける形ではなく「B を先に適用し、その結果に A を適用」する積 A·B @param {Mat} A @param {Mat} B @returns {Mat} */
function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ]
}

/** @param {Mat} m @param {number} x @param {number} y @returns {[number, number]} */
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** 線の太さと字の大きさに掛ける縮尺。縦横が違う行列は平均で近似する @param {Mat} m */
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

const TRANSFORM_RE = /([a-zA-Z]+)\s*\(([^)]*)\)/y

/**
 * transform 属性。読めなければ null
 * @param {string} s
 * @returns {Mat | null}
 */
function parseTransform(s) {
  /** @type {Mat} */
  let m = IDENTITY
  let i = 0
  const t = s.trim()
  if (t === '') return IDENTITY
  while (i < t.length) {
    while (i < t.length && (t[i] === ' ' || t[i] === ',' || t[i] === '\t' || t[i] === '\n' || t[i] === '\r')) i++
    if (i >= t.length) break
    TRANSFORM_RE.lastIndex = i
    const r = TRANSFORM_RE.exec(t)
    if (!r) return null
    i = TRANSFORM_RE.lastIndex
    const a = parseNumberList(r[2])
    if (!a || a.length === 0) return null
    /** @type {Mat} */
    let n
    switch (r[1]) {
      case 'matrix':
        if (a.length !== 6) return null
        n = /** @type {Mat} */ (a)
        break
      case 'translate':
        if (a.length > 2) return null
        n = [1, 0, 0, 1, a[0], a[1] || 0]
        break
      case 'scale':
        if (a.length > 2) return null
        n = [a[0], 0, 0, a.length === 2 ? a[1] : a[0], 0, 0]
        break
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3) return null
        const rad = (a[0] * Math.PI) / 180
        const c = Math.cos(rad)
        const sn = Math.sin(rad)
        const cx = a[1] || 0
        const cy = a[2] || 0
        n = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy]
        break
      }
      case 'skewX':
        if (a.length !== 1) return null
        n = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0]
        break
      case 'skewY':
        if (a.length !== 1) return null
        n = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0]
        break
      default:
        return null
    }
    m = mul(m, n)
  }
  return m.every(Number.isFinite) ? m : null
}

// ---------------------------------------------------------------- path の d

const PATH_CMDS = 'MmLlHhVvCcSsQqTtAaZz'

/**
 * 弧を 90 度以下ごとの C の列に（SVG 仕様 F.6.5・F.6.6）
 * @param {Seg[]} out
 * @param {number} x1 @param {number} y1 @param {number} rxIn @param {number} ryIn @param {number} phiDeg
 * @param {boolean} fa @param {boolean} fs @param {number} x2 @param {number} y2
 */
function arcToSegs(out, x1, y1, rxIn, ryIn, phiDeg, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0) { out.push(['L', x2, y2]); return }
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cos * dx2 + sin * dy2
  const y1p = -sin * dx2 + cos * dy2
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) { const sq = Math.sqrt(lambda); rx *= sq; ry *= sq }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  /** @param {number} ux @param {number} uy @param {number} vx @param {number} vy */
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dtheta > 0) dtheta -= 2 * Math.PI
  else if (fs && dtheta < 0) dtheta += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9))
  const delta = dtheta / n
  const k = (4 / 3) * Math.tan(delta / 4)
  /** @param {number} th @returns {[number, number, number, number]} 点と接線 */
  const at = (th) => {
    const ct = Math.cos(th)
    const st = Math.sin(th)
    return [
      cx + cos * rx * ct - sin * ry * st,
      cy + sin * rx * ct + cos * ry * st,
      -cos * rx * st - sin * ry * ct,
      -sin * rx * st + cos * ry * ct,
    ]
  }
  for (let i = 0; i < n; i++) {
    const a = at(theta1 + i * delta)
    const b = at(theta1 + (i + 1) * delta)
    // 最後の点は誤差を溜めず、指定の終点に合わせる
    const ex = i === n - 1 ? x2 : b[0]
    const ey = i === n - 1 ? y2 : b[1]
    out.push(['C', a[0] + k * a[2], a[1] + k * a[3], b[0] - k * b[2], b[1] - k * b[3], ex, ey])
  }
}

/**
 * path の d を、絶対の M・L・C・Z だけの列にする。読めない所があればそこまで（SVG の決まり）
 * @param {string} d
 * @returns {{ segs: Seg[], error: boolean }}
 */
function parsePathData(d) {
  /** @type {Seg[]} */
  const segs = []
  const n = d.length
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  /** 前の命令が C/S（'C'）か Q/T（'Q'）だった時の、反射に使う制御点 */
  let lastKind = ''
  let lastX = 0
  let lastY = 0
  let needMove = false
  let error = false

  const skipSep = () => {
    while (i < n) {
      const c = d.charCodeAt(i)
      if (c === 32 || c === 44 || c === 9 || c === 10 || c === 13 || c === 12) i++
      else break
    }
  }
  const num = () => {
    skipSep()
    NUM_RE.lastIndex = i
    const m = NUM_RE.exec(d)
    if (!m) return NaN
    i = NUM_RE.lastIndex
    return parseFloat(m[0])
  }
  // 弧の 2 つの旗は 1 字で、次の数と詰めて書ける（a1 1 0 011 1）
  const flag = () => {
    skipSep()
    const c = d[i]
    if (c === '0' || c === '1') { i++; return c === '1' }
    return null
  }
  const moveIfNeeded = () => {
    if (needMove) { segs.push(['M', cx, cy]); needMove = false }
  }

  for (;;) {
    skipSep()
    if (i >= n) break
    const ch = d[i]
    if (PATH_CMDS.includes(ch)) {
      cmd = ch
      i++
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z') {
      error = true
      break
    } else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    if (segs.length === 0 && cmd !== 'M' && cmd !== 'm') { error = true; break }
    const rel = cmd >= 'a'
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    const up = cmd.toUpperCase()
    let nextKind = ''
    if (up === 'Z') {
      if (segs.length && segs[segs.length - 1][0] !== 'Z') segs.push(['Z'])
      cx = sx
      cy = sy
      needMove = true
    } else if (up === 'M') {
      const x = num() + ox
      const y = num() + oy
      if (!Number.isFinite(x + y)) { error = true; break }
      cx = sx = x
      cy = sy = y
      needMove = false
      segs.push(['M', x, y])
    } else if (up === 'L') {
      const x = num() + ox
      const y = num() + oy
      if (!Number.isFinite(x + y)) { error = true; break }
      moveIfNeeded()
      segs.push(['L', x, y])
      cx = x
      cy = y
    } else if (up === 'H') {
      const x = num() + ox
      if (!Number.isFinite(x)) { error = true; break }
      moveIfNeeded()
      segs.push(['L', x, cy])
      cx = x
    } else if (up === 'V') {
      const y = num() + oy
      if (!Number.isFinite(y)) { error = true; break }
      moveIfNeeded()
      segs.push(['L', cx, y])
      cy = y
    } else if (up === 'C' || up === 'S') {
      let x1
      let y1
      if (up === 'C') {
        x1 = num() + ox
        y1 = num() + oy
      } else if (lastKind === 'C') {
        x1 = 2 * cx - lastX
        y1 = 2 * cy - lastY
      } else {
        x1 = cx
        y1 = cy
      }
      const x2 = num() + ox
      const y2 = num() + oy
      const x = num() + ox
      const y = num() + oy
      if (![x1, y1, x2, y2, x, y].every(Number.isFinite)) { error = true; break }
      moveIfNeeded()
      segs.push(['C', x1, y1, x2, y2, x, y])
      lastX = x2
      lastY = y2
      cx = x
      cy = y
      nextKind = 'C'
    } else if (up === 'Q' || up === 'T') {
      let qx
      let qy
      if (up === 'Q') {
        qx = num() + ox
        qy = num() + oy
      } else if (lastKind === 'Q') {
        qx = 2 * cx - lastX
        qy = 2 * cy - lastY
      } else {
        qx = cx
        qy = cy
      }
      const x = num() + ox
      const y = num() + oy
      if (![qx, qy, x, y].every(Number.isFinite)) { error = true; break }
      moveIfNeeded()
      segs.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y])
      lastX = qx
      lastY = qy
      cx = x
      cy = y
      nextKind = 'Q'
    } else {
      // A
      const rx = num()
      const ry = num()
      const rot = num()
      const fa = flag()
      const fs = flag()
      const x = num() + ox
      const y = num() + oy
      if (![rx, ry, rot, x, y].every(Number.isFinite) || fa === null || fs === null) { error = true; break }
      moveIfNeeded()
      arcToSegs(segs, cx, cy, rx, ry, rot, fa, fs, x, y)
      cx = x
      cy = y
    }
    lastKind = nextKind
  }
  // 描く物の無い M（連続する M・末尾の M）を取り除く
  /** @type {Seg[]} */
  const clean = []
  for (let k = 0; k < segs.length; k++) {
    if (segs[k][0] === 'M' && (k === segs.length - 1 || segs[k + 1][0] === 'M')) continue
    clean.push(segs[k])
  }
  return { segs: clean, error }
}

// ---------------------------------------------------------------- 図形 → 線分の列

/** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} rx @param {number} ry @returns {Seg[]} */
function rectSegs(x, y, w, h, rx, ry) {
  if (rx <= 0 || ry <= 0) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  return [
    ['M', x + rx, y],
    ['L', x + w - rx, y],
    ['C', x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
    ['L', x + w, y + h - ry],
    ['C', x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
    ['L', x + rx, y + h],
    ['C', x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y],
    ['Z'],
  ]
}

/** @param {number} cx @param {number} cy @param {number} rx @param {number} ry @returns {Seg[]} */
function ellipseSegs(cx, cy, rx, ry) {
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ]
}

// ---------------------------------------------------------------- 状態

/** 子を持たず、描きもしない要素（定義の置き場・説明） */
const NOT_DRAWN = new Set(['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'metadata', 'stop'])
/** 読まないと決めた要素（小文字で比べる）。警告に出す名前 */
const REFUSED = new Map([
  ['script', 'script'], ['foreignobject', 'foreignObject'], ['image', 'image'], ['use', 'use'], ['style', 'style'],
  ['iframe', 'iframe'], ['audio', 'audio'], ['video', 'video'], ['animate', 'animate'], ['set', 'set'],
  ['animatetransform', 'animateTransform'], ['animatemotion', 'animateMotion'],
])
const CONTAINERS = new Set(['g', 'a', 'svg'])
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

/** style 属性と別に、同じ名前の属性（プレゼンテーション属性）として読む物 */
const PRESENTATION = new Set([
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-rule',
  'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'display', 'visibility', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'clip-path', 'overflow', 'filter', 'mask', 'stop-color', 'stop-opacity',
])

/**
 * @typedef {{
 *   warnings: string[], warned: Set<string>, count: number, full: boolean,
 *   ids: Map<string, XNode>, metrics: Record<string, FontLike> | undefined, paper: Rgba,
 *   b: { x0: number, y0: number, x1: number, y1: number }, missing: Set<string>, quietStyle: boolean,
 * }} State
 */

/** @param {State} st @param {string} key @param {string} msg */
function warnOnce(st, key, msg) {
  if (st.warned.has(key)) return
  st.warned.add(key)
  st.warnings.push(msg)
}

/** @param {State} st @param {number} x @param {number} y */
function touch(st, x, y) {
  const b = st.b
  if (x < b.x0) b.x0 = x
  if (y < b.y0) b.y0 = y
  if (x > b.x1) b.x1 = x
  if (y > b.y1) b.y1 = y
}

/** Op を 1 つ置く枠を取る。上限に達していれば false @param {State} st */
function reserve(st) {
  if (st.count >= MAX_OPS) {
    if (!st.full) {
      st.full = true
      warnOnce(st, 'limit', `Op が ${String(MAX_OPS).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} 個を超えたので、残りは描きません`)
    }
    return false
  }
  st.count++
  return true
}

/** @param {State} st @param {Ctx} ctx @param {Op} op */
function emit(st, ctx, op) {
  if (reserve(st)) ctx.out.push(op)
}

/** 閉じていない /* が並ぶ入力で正規表現の戻りが二乗にならないよう、手で読む @param {string} s */
function stripCssComments(s) {
  if (s.indexOf('/*') < 0) return s
  let out = ''
  let i = 0
  for (;;) {
    const a = s.indexOf('/*', i)
    if (a < 0) return out + s.slice(i)
    out += s.slice(i, a)
    const b = s.indexOf('*/', a + 2)
    if (b < 0) return out
    i = b + 2
  }
}

/**
 * style 属性（CSS の宣言の列）を { 名前: 値 } に
 * @param {string} s
 * @returns {Record<string, string>}
 */
function parseStyleAttr(s) {
  /** @type {Record<string, string>} */
  const out = Object.create(null)
  for (const decl of stripCssComments(s).split(';')) {
    const k = decl.indexOf(':')
    if (k < 0) continue
    const name = decl.slice(0, k).trim().toLowerCase()
    const value = decl.slice(k + 1).replace(/!important\s*$/i, '').trim()
    if (name && value && !value.includes('var(')) out[name] = value
  }
  return out
}

/**
 * 要素のプレゼンテーション属性と style 属性（後者が勝つ）。PRESENTATION に無い名前（on で始まるイベントなど）は拾わない
 * @param {XNode} node
 * @returns {Record<string, string>}
 */
function readProps(node) {
  /** @type {Record<string, string>} */
  let p = Object.create(null)
  const attrs = node.attrs
  for (const k in attrs) if (PRESENTATION.has(k)) p[k] = attrs[k]
  if (attrs.style !== undefined) p = Object.assign(p, parseStyleAttr(attrs.style))
  return p
}

/** @type {Record<string, number>} */
const FONT_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 }

/** @param {string} v @param {number} parent */
function parseFontSize(v, parent) {
  const t = v.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(FONT_KEYWORDS, t)) return FONT_KEYWORDS[t]
  if (t === 'smaller') return parent / 1.2
  if (t === 'larger') return parent * 1.2
  const len = parseLen(t, parent, parent)
  return Number.isFinite(len) && len >= 0 ? len : NaN
}

/** @param {string} v @returns {number} 0〜1。読めなければ NaN */
function parseOpacity(v) {
  const t = v.trim()
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return NaN
  return clamp(t.endsWith('%') ? n / 100 : n, 0, 1)
}

/**
 * url(…) を手で読む。正規表現の /url\(\s*(['"]?)([^'")]*)\1\s*\)\s*(.*)$/ は、空白が 4000 字続いて ) が無い入力で三乗になる(9.4 秒)。
 * 選ばなかった案: 入力の長さで切る案。長い data URI や長い id を持つ正当な SVG まで落とす。
 * @param {string} t url( で始まる文字列
 * @returns {{ ref: string, rest: string } | null}
 */
function readUrlRef(t) {
  const n = t.length
  const isWs = (/** @type {string} */ c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
  let i = 4
  while (i < n && isWs(t[i])) i++
  const q = t[i] === '"' || t[i] === "'" ? t[i] : ''
  if (q) i++
  const start = i
  while (i < n && t[i] !== '"' && t[i] !== "'" && t[i] !== ')') i++
  let ref = t.slice(start, i)
  if (q) {
    if (t[i] !== q) return null
    i++
  } else ref = ref.trimEnd()
  while (i < n && isWs(t[i])) i++
  if (t[i] !== ')') return null
  return { ref, rest: t.slice(i + 1).trim() }
}

/**
 * @param {State} st @param {string} v
 * @returns {Paint | null} 読めなければ null（親の値を残す）
 */
function parsePaint(st, v) {
  const t = v.trim()
  const lower = t.toLowerCase()
  if (lower === 'none') return { kind: 'none' }
  if (lower === 'currentcolor') return { kind: 'current' }
  if (lower === 'inherit') return null
  if (lower.startsWith('url(')) {
    const m = readUrlRef(t)
    if (!m || m.ref[0] !== '#') {
      warnOnce(st, 'extpaint', '外への参照の塗りは読みません（塗らないことにします）')
      return { kind: 'none' }
    }
    return { kind: 'url', id: m.ref.slice(1), fallback: m.rest ? parseColor(m.rest) : null }
  }
  const c = parseColor(t)
  return c ? { kind: 'color', rgba: c } : null
}

/**
 * 親の style に、この要素の値を重ねる
 * @param {State} st @param {Style} parent @param {Record<string, string>} p @param {number} refLen
 * @returns {Style}
 */
function inherit(st, parent, p, refLen) {
  /** @type {Style} */
  const s = { ...parent }
  let v
  if (p.color !== undefined && p.color.trim().toLowerCase() !== 'currentcolor') {
    const c = parseColor(p.color)
    if (c) s.color = c
  }
  if (p['font-size'] !== undefined) {
    const f = parseFontSize(p['font-size'], parent.fontSize)
    if (Number.isFinite(f)) s.fontSize = f
  }
  if (p.fill !== undefined && (v = parsePaint(st, p.fill))) s.fill = v
  if (p.stroke !== undefined && (v = parsePaint(st, p.stroke))) s.stroke = v
  if (p['stroke-width'] !== undefined) {
    const w = parseLen(p['stroke-width'], s.fontSize, refLen)
    if (Number.isFinite(w) && w >= 0) s.strokeWidth = w
  }
  if (p['stroke-dasharray'] !== undefined) {
    const t = p['stroke-dasharray'].trim().toLowerCase()
    if (t === 'none') s.dash = null
    else if (t !== 'inherit') {
      const parts = t.split(/[\s,]+/).filter(Boolean).map((x) => parseLen(x, s.fontSize, refLen))
      if (parts.length && parts.every((x) => Number.isFinite(x) && x >= 0)) {
        s.dash = parts.reduce((a, b) => a + b, 0) > 0 ? (parts.length % 2 ? parts.concat(parts) : parts) : null
      }
    }
  }
  const cap = p['stroke-linecap']
  if (cap === 'butt' || cap === 'round' || cap === 'square') s.cap = cap
  const join = p['stroke-linejoin']
  if (join === 'miter' || join === 'round' || join === 'bevel') s.join = join
  else if (join === 'miter-clip' || join === 'arcs') s.join = 'miter'
  const rule = p['fill-rule']
  if (rule === 'nonzero' || rule === 'evenodd') s.fillRule = rule
  if (p['fill-opacity'] !== undefined) { const o = parseOpacity(p['fill-opacity']); if (Number.isFinite(o)) s.fillOpacity = o }
  if (p['stroke-opacity'] !== undefined) { const o = parseOpacity(p['stroke-opacity']); if (Number.isFinite(o)) s.strokeOpacity = o }
  if (p['font-weight'] !== undefined) {
    const t = p['font-weight'].trim().toLowerCase()
    if (t === 'bold' || t === 'bolder') s.bold = true
    else if (t === 'normal' || t === 'lighter') s.bold = false
    else { const w = parseFloat(t); if (Number.isFinite(w)) s.bold = w >= 600 }
  }
  const anchor = p['text-anchor']
  if (anchor === 'start' || anchor === 'middle' || anchor === 'end') s.anchor = anchor
  if (p['dominant-baseline'] !== undefined) s.baseline = p['dominant-baseline'].trim().toLowerCase()
  const vis = p.visibility
  if (vis === 'hidden' || vis === 'collapse') s.visible = false
  else if (vis === 'visible') s.visible = true
  return s
}

/**
 * グラデーションは単色で描く（最初の色）。Op に勾配が無いため
 * @param {XNode} el @param {State} st @param {number} depth
 * @returns {Rgba | null}
 */
function gradientColor(el, st, depth) {
  const stop = /** @type {XNode | undefined} */ (el.children.find((c) => typeof c !== 'string' && localName(c.name) === 'stop'))
  if (!stop) {
    const href = el.attrs.href ?? el.attrs['xlink:href']
    const ref = href && href[0] === '#' && depth < 4 ? st.ids.get(href.slice(1)) : undefined
    return ref ? gradientColor(ref, st, depth + 1) : null
  }
  const p = { ...stop.attrs, ...(stop.attrs.style !== undefined ? parseStyleAttr(stop.attrs.style) : {}) }
  const c = parseColor(p['stop-color'] ?? 'black')
  if (!c) return null
  const o = p['stop-opacity'] !== undefined ? parseOpacity(p['stop-opacity']) : 1
  return { ...c, a: c.a * (Number.isFinite(o) ? o : 1) }
}

/**
 * 塗りの色。none なら null
 * @param {Paint} paint @param {Style} style @param {State} st
 * @returns {Rgba | null}
 */
function resolvePaint(paint, style, st) {
  if (paint.kind === 'none') return null
  if (paint.kind === 'color') return paint.rgba
  if (paint.kind === 'current') return style.color
  const el = st.ids.get(paint.id)
  const nm = el ? localName(el.name) : ''
  if (el && (nm === 'linearGradient' || nm === 'radialGradient')) {
    const c = gradientColor(el, st, 0)
    if (c) {
      warnOnce(st, 'gradient', 'グラデーションは最初の色の単色で描きます')
      return c
    }
  } else if (el) {
    warnOnce(st, 'pattern', 'パターンの塗りは読みません')
  }
  return paint.fallback
}

// ---------------------------------------------------------------- 描く

/**
 * 線分の列を行列で写した d にする
 * 線の太さの半分は、はみ出しの判定に入れない（四角の縁に引いた枠線のたびに ClipOp で包むことになるため）
 * @param {State} st @param {Seg[]} segs @param {Mat} m
 * @returns {string | null} 数がおかしければ null
 */
function segsToD(st, segs, m) {
  const parts = []
  for (const seg of segs) {
    const c = seg[0]
    if (c === 'Z') { parts.push('Z'); continue }
    const out = [c]
    for (let k = 1; k < seg.length; k += 2) {
      const [x, y] = apply(m, /** @type {number} */ (seg[k]), /** @type {number} */ (seg[k + 1]))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      touch(st, x, y)
      out.push(fmt(x), fmt(y))
    }
    parts.push(out.join(' '))
  }
  return parts.join(' ')
}

/**
 * 図形を PathOp にする。塗りと線で透明度が違えば 2 つに分ける
 * @param {State} st @param {Ctx} ctx @param {Seg[]} segs @param {boolean} fillable 線だけの図形（line）は false
 */
function drawSegs(st, ctx, segs, fillable) {
  const style = ctx.style
  if (!style.visible || segs.length === 0) return
  const s = scaleOf(ctx.m)
  if (!(s > 0)) return
  let fill = fillable ? resolvePaint(style.fill, style, st) : null
  let stroke = resolvePaint(style.stroke, style, st)
  const lw = style.strokeWidth * s
  const fillA = fill ? fill.a * style.fillOpacity * ctx.opacity : 0
  const strokeA = stroke ? stroke.a * style.strokeOpacity * ctx.opacity : 0
  if (!(fillA > 0)) fill = null
  if (!(strokeA > 0) || !(lw > 0)) stroke = null
  if (!fill && !stroke) return
  const d = segsToD(st, segs, ctx.m)
  if (!d) return

  /** @param {PathOp} op @param {number} a */
  const withOpacity = (op, a) => {
    if (a < 1 - 1e-9) op.opacity = Math.round(a * 1000) / 1000
    return op
  }
  /** @param {PathOp} op */
  const addStroke = (op) => {
    op.lw = Math.round(lw * 1000) / 1000
    return op
  }
  /** @param {PathOp} op */
  const addStrokeStyle = (op) => {
    if (style.cap !== 'butt') op.cap = style.cap
    if (style.join !== 'miter') op.join = style.join
    if (style.dash) op.dash = style.dash.map((v) => Math.round(v * s * 1000) / 1000)
    return op
  }
  /** @param {PathOp} op */
  const addFillStyle = (op) => {
    if (style.fillRule === 'evenodd') op.fillRule = 'evenodd'
    return op
  }

  if (fill && stroke && Math.abs(fillA - strokeA) < 1e-6) {
    /** @type {PathOp} */
    const op = { t: 'path', d, fill: toHex(fill), stroke: toHex(stroke) }
    addStroke(op)
    withOpacity(op, fillA)
    addFillStyle(op)
    addStrokeStyle(op)
    emit(st, ctx, op)
    return
  }
  if (fill) emit(st, ctx, addFillStyle(withOpacity({ t: 'path', d, fill: toHex(fill) }, fillA)))
  if (stroke) emit(st, ctx, addStrokeStyle(withOpacity(addStroke({ t: 'path', d, stroke: toHex(stroke) }), strokeA)))
}

/**
 * 図形の要素を線分の列に
 * @param {XNode} node @param {string} name @param {Ctx} ctx @param {State} st
 * @returns {Seg[]}
 */
function shapeSegs(node, name, ctx, st) {
  const a = node.attrs
  const fs = ctx.style.fontSize
  const lx = (/** @type {string | undefined} */ v) => parseLen(v, fs, ctx.vw)
  const ly = (/** @type {string | undefined} */ v) => parseLen(v, fs, ctx.vh)
  const lr = (/** @type {string | undefined} */ v) => parseLen(v, fs, Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2))
  const or0 = (/** @type {number} */ v) => (Number.isFinite(v) ? v : 0)
  switch (name) {
    case 'path': {
      if (a.d === undefined) return []
      const r = parsePathData(a.d)
      if (r.error) warnOnce(st, 'pathd', 'path の d に読めない所があったので、そこまでを描きます')
      return r.segs
    }
    case 'rect': {
      const w = lx(a.width)
      const h = ly(a.height)
      if (!(w > 0) || !(h > 0)) return []
      let rx = lx(a.rx)
      let ry = ly(a.ry)
      if (!(rx >= 0)) rx = NaN
      if (!(ry >= 0)) ry = NaN
      if (Number.isNaN(rx) && Number.isNaN(ry)) { rx = 0; ry = 0 } else if (Number.isNaN(rx)) rx = ry
      else if (Number.isNaN(ry)) ry = rx
      return rectSegs(or0(lx(a.x)), or0(ly(a.y)), w, h, Math.min(rx, w / 2), Math.min(ry, h / 2))
    }
    case 'circle': {
      const r = lr(a.r)
      return r > 0 ? ellipseSegs(or0(lx(a.cx)), or0(ly(a.cy)), r, r) : []
    }
    case 'ellipse': {
      let rx = lx(a.rx)
      let ry = ly(a.ry)
      if (Number.isNaN(rx) && !Number.isNaN(ry)) rx = ry
      if (Number.isNaN(ry) && !Number.isNaN(rx)) ry = rx
      return rx > 0 && ry > 0 ? ellipseSegs(or0(lx(a.cx)), or0(ly(a.cy)), rx, ry) : []
    }
    case 'line':
      return [['M', or0(lx(a.x1)), or0(ly(a.y1))], ['L', or0(lx(a.x2)), or0(ly(a.y2))]]
    default: {
      // polyline・polygon
      const pts = parseNumberList(a.points)
      if (!pts) { warnOnce(st, 'points', 'points に読めない所があるので、その図形は描きません'); return [] }
      if (pts.length % 2) pts.pop()
      if (pts.length < 4) return []
      /** @type {Seg[]} */
      const segs = []
      for (let k = 0; k < pts.length; k += 2) segs.push([k === 0 ? 'M' : 'L', pts[k], pts[k + 1]])
      if (name === 'polygon') segs.push(['Z'])
      return segs
    }
  }
}

/**
 * clip-path="url(#id)" を、ページ座標の四角にする。四角にならない clipPath は外接の四角で近似する
 * @param {string} value @param {Ctx} ctx @param {State} st
 * @returns {{ x: number, y: number, w: number, h: number } | 'empty' | null} 無ければ null
 */
function resolveClip(value, ctx, st) {
  const t = value.trim()
  if (t === 'none' || t === '') return null
  const mm = /^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)$/i.exec(t)
  if (!mm) {
    warnOnce(st, 'extclip', '外への参照の clip-path は読みません')
    return null
  }
  const el = st.ids.get(mm[2])
  if (!el || localName(el.name) !== 'clipPath') {
    warnOnce(st, 'noclip', `clip-path の参照先 #${mm[2]} が clipPath ではないか、見つかりません`)
    return null
  }
  if (el.attrs.clipPathUnits === 'objectBoundingBox') {
    warnOnce(st, 'clipobb', 'clipPathUnits="objectBoundingBox" は読みません')
    return null
  }
  /** @type {Mat} */
  let base = ctx.m
  if (el.attrs.transform !== undefined) {
    const tm = parseTransform(el.attrs.transform)
    if (tm) base = mul(base, tm)
  }
  let unsupported = false
  for (const child of el.children) {
    if (typeof child === 'string') continue
    const nm = localName(child.name)
    if (nm !== 'rect' && nm !== 'path' && nm !== 'polygon') { unsupported = true; continue }
    const cp = readProps(child)
    if (cp.display === 'none') continue
    let m = base
    if (child.attrs.transform !== undefined) {
      const tm = parseTransform(child.attrs.transform)
      if (tm) m = mul(m, tm)
    }
    const segs = shapeSegs(child, nm, ctx, st)
    if (segs.length === 0) return 'empty'
    if (segs.some((sg) => sg[0] === 'C') || Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) {
      warnOnce(st, 'clipshape', 'clipPath が四角でないか回っているので、外接の四角で切ります')
    }
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const sg of segs) {
      for (let k = 1; k < sg.length; k += 2) {
        const [x, y] = apply(m, /** @type {number} */ (sg[k]), /** @type {number} */ (sg[k + 1]))
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (![x0, y0, x1, y1].every(Number.isFinite)) return 'empty'
    if (nm !== 'rect' && el.children.filter((c) => typeof c !== 'string').length > 1) {
      warnOnce(st, 'clipmany', 'clipPath の中は最初の 1 つだけを読みます')
    }
    return x1 - x0 > 0 && y1 - y0 > 0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : 'empty'
  }
  if (unsupported) {
    warnOnce(st, 'clipkind', 'clipPath の中が rect・path・polygon ではないので、切らずに描きます')
    return null
  }
  return 'empty'
}

/**
 * ctx.out の代わりに inner へ描き、できた物を ClipOp 1 つにして ctx.out に置く
 * @param {State} st @param {Ctx} ctx @param {{ x: number, y: number, w: number, h: number }} r @param {(inner: Ctx) => void} fn
 */
function withClip(st, ctx, r, fn) {
  if (!reserve(st)) return
  /** @type {Op[]} */
  const inner = []
  fn({ ...ctx, out: inner })
  if (inner.length === 0) { st.count--; return }
  ctx.out.push({ t: 'clip', x: Math.round(r.x * 1000) / 1000, y: Math.round(r.y * 1000) / 1000, w: Math.round(r.w * 1000) / 1000, h: Math.round(r.h * 1000) / 1000, ops: inner })
}

/** viewBox（minx miny w h）。読めなければ null @param {string | undefined} s @returns {[number, number, number, number] | null} */
function parseViewBox(s) {
  const a = parseNumberList(s)
  return a && a.length === 4 && a[2] > 0 && a[3] > 0 ? /** @type {[number, number, number, number]} */ (a) : null
}

/**
 * viewBox を (x, y, w, h) に preserveAspectRatio xMidYMid meet で写す行列
 * @param {[number, number, number, number]} vb @param {number} x @param {number} y @param {number} w @param {number} h
 * @returns {Mat}
 */
function viewBoxMatrix(vb, x, y, w, h) {
  const sc = Math.min(w / vb[2], h / vb[3])
  return [sc, 0, 0, sc, x + (w - vb[2] * sc) / 2 - vb[0] * sc, y + (h - vb[3] * sc) / 2 - vb[1] * sc]
}

/**
 * @param {XNode} node @param {Ctx} ctx @param {State} st @param {number} depth
 */
function walk(node, ctx, st, depth) {
  if (st.full) return
  const name = localName(node.name)
  const lower = name.toLowerCase()
  if (REFUSED.has(lower)) return
  const isContainer = CONTAINERS.has(name)
  const isShape = SHAPES.has(name)
  if (!isContainer && !isShape && name !== 'text') return
  if (depth > MAX_DEPTH) {
    warnOnce(st, 'depth', `入れ子が ${MAX_DEPTH} 段を超えた所から先は描きません`)
    return
  }
  const props = readProps(node)
  if (props.display === 'none') return
  if (props.filter !== undefined || props.mask !== undefined) {
    warnOnce(st, 'filtermask', 'filter・mask は読みません（付いていないものとして描きます）')
  }

  let m = ctx.m
  if (node.attrs.transform !== undefined) {
    const tm = parseTransform(node.attrs.transform)
    if (tm) m = mul(m, tm)
    else warnOnce(st, 'transform', '読めない transform があったので、その変換は無いものとして描きます')
  }
  const refLen = Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2)
  const style = inherit(st, ctx.style, props, refLen)
  const o = props.opacity !== undefined ? parseOpacity(props.opacity) : 1
  /** @type {Ctx} */
  let c = { ...ctx, m, style, opacity: ctx.opacity * (Number.isFinite(o) ? o : 1) }

  /** @type {(inner: Ctx) => void} */
  let body
  /** @type {{ x: number, y: number, w: number, h: number } | null} */
  let viewportClip = null

  if (name === 'svg' && depth > 0) {
    // 入れ子の svg: 位置と大きさの四角に viewBox を写し、はみ出しは切る
    const fs = style.fontSize
    const vx = parseLen(node.attrs.x, fs, ctx.vw) || 0
    const vy = parseLen(node.attrs.y, fs, ctx.vh) || 0
    let vwid = parseLen(node.attrs.width ?? '100%', fs, ctx.vw)
    let vhei = parseLen(node.attrs.height ?? '100%', fs, ctx.vh)
    if (!(vwid > 0) || !(vhei > 0)) return
    const vb = parseViewBox(node.attrs.viewBox)
    /** @type {Mat} */
    let inner = mul(m, [1, 0, 0, 1, vx, vy])
    let iw = vwid
    let ih = vhei
    if (vb) {
      inner = mul(m, viewBoxMatrix(vb, vx, vy, vwid, vhei))
      iw = vb[2]
      ih = vb[3]
    }
    const overflow = props.overflow
    if (overflow !== 'visible' && overflow !== 'auto') {
      const [ax, ay] = apply(m, vx, vy)
      const [bx, by] = apply(m, vx + vwid, vy + vhei)
      const [cx2, cy2] = apply(m, vx + vwid, vy)
      const [dx2, dy2] = apply(m, vx, vy + vhei)
      const xs = [ax, bx, cx2, dx2]
      const ys = [ay, by, cy2, dy2]
      viewportClip = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    }
    c = { ...c, m: inner, vw: iw, vh: ih }
    body = (cc) => walkChildren(node, cc, st, depth + 1)
  } else if (isContainer) {
    body = (cc) => walkChildren(node, cc, st, depth + 1)
  } else if (name === 'text') {
    body = (cc) => drawText(node, cc, st)
  } else {
    body = (cc) => {
      const segs = shapeSegs(node, name, cc, st)
      drawSegs(st, cc, segs, name !== 'line')
    }
  }

  const clip = props['clip-path'] !== undefined ? resolveClip(props['clip-path'], c, st) : null
  if (clip === 'empty') return
  /** @param {Ctx} cc */
  const run = (cc) => {
    if (viewportClip) withClip(st, cc, viewportClip, body)
    else body(cc)
  }
  if (clip) withClip(st, c, clip, run)
  else run(c)
}

/** @param {XNode} node @param {Ctx} ctx @param {State} st @param {number} depth */
function walkChildren(node, ctx, st, depth) {
  for (const ch of node.children) {
    if (st.full) return
    if (typeof ch !== 'string') walk(ch, ctx, st, depth)
  }
}

// ---------------------------------------------------------------- 字

/**
 * 描かない字（制御文字・双方向の制御・ゼロ幅の字）。PDF にそのまま渡すと、見えない字や豆腐になり、字の向きも変えられる
 * @param {number} cp
 */
const isInvisible = (cp) =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x61c || cp === 0x180e || (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xfeff

/** 書体に無い字の送り幅の見積もり（和字は 1em・欧字は 0.55em） @param {number} cp */
const fallbackAdv = (cp) => (cp >= 0x2e80 ? 1 : 0.55)

/**
 * @typedef {{ x?: number, y?: number, dx?: number, dy?: number }} CharPos
 * @typedef {{ c: string, style: Style }} Ch
 */

/**
 * 要素の x・y・dx・dy（空白かコンマ区切りの長さの列）を、字の番号ごとの位置に割り当てる
 * @param {XNode} el @param {number} start この要素の最初の字の番号 @param {CharPos[]} pos @param {Style} style @param {Ctx} ctx
 */
function assignPositions(el, start, pos, style, ctx) {
  for (const key of /** @type {const} */ (['x', 'y', 'dx', 'dy'])) {
    const raw = el.attrs[key]
    if (raw === undefined) continue
    const axisRef = key === 'x' || key === 'dx' ? ctx.vw : ctx.vh
    const list = raw.trim().split(/[\s,]+/).filter(Boolean)
    for (let k = 0; k < list.length && k < 4096; k++) {
      const v = parseLen(list[k], style.fontSize, axisRef)
      if (!Number.isFinite(v)) continue
      const slot = pos[start + k] || (pos[start + k] = {})
      slot[key] = v
    }
  }
}

/**
 * text 要素を TextOp にする。1 つの text を「チャンク」（絶対位置で始まる字の連なり）に分け、
 * チャンクごとに text-anchor を掛けて、字ごとの x を出す
 * @param {XNode} node @param {Ctx} ctx @param {State} st
 */
function drawText(node, ctx, st) {
  const m = ctx.m
  const s = scaleOf(m)
  if (!(s > 0) || !ctx.style.visible) return
  // 回ったり反ったり裏返った行列では、基線の向きを無視して x だけ並べる
  const oblique = Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6 || m[0] <= 0 || m[3] <= 0
  const ax = oblique ? s : m[0]
  const ay = oblique ? s : m[3]

  /** @type {Ch[]} */
  const chars = []
  /** @type {CharPos[]} */
  const pos = []
  const preserve = node.attrs['xml:space'] === 'preserve'
  let lastSpace = true

  /** @param {string} data @param {Style} style */
  const addText = (data, style) => {
    for (const c of data) {
      if (chars.length >= MAX_TEXT_CHARS) {
        warnOnce(st, 'textmax', `1 つの text は ${MAX_TEXT_CHARS} 字までしか描きません`)
        return
      }
      if (c === '\n' || c === '\t' || c === '\r' || c === ' ') {
        if (preserve) chars.push({ c: ' ', style })
        else if (!lastSpace) { chars.push({ c: ' ', style }); lastSpace = true }
      } else if (!isInvisible(/** @type {number} */ (c.codePointAt(0)))) {
        chars.push({ c, style })
        lastSpace = false
      }
    }
  }
  /** @param {XNode} el @param {Style} style @param {number} depth */
  const visit = (el, style, depth) => {
    assignPositions(el, chars.length, pos, style, ctx)
    for (const ch of el.children) {
      if (typeof ch === 'string') { addText(ch, style); continue }
      const nm = localName(ch.name)
      const lower = nm.toLowerCase()
      if (REFUSED.has(lower)) continue
      if (nm === 'textPath') { warnOnce(st, 'textpath', 'textPath は読みません'); continue }
      if ((nm === 'tspan' || nm === 'a') && depth < MAX_DEPTH) {
        const p = readProps(ch)
        if (p.display === 'none') continue
        visit(ch, inherit(st, style, p, ctx.vw), depth + 1)
      }
    }
  }
  visit(node, ctx.style, 0)
  if (!preserve) while (chars.length && chars[chars.length - 1].c === ' ') chars.pop()
  if (chars.length === 0) return
  if (oblique) warnOnce(st, 'textrot', '回転・斜めの変換がかかった字は、向きを無視して横に並べます')

  /** @param {Style} sty */
  const fontOf = (sty) => st.metrics?.[sty.bold ? 'sansBold' : 'sans']

  /**
   * @typedef {{ c: string, ux: number, uy: number, sizeDev: number, adv: number, font: 'sans' | 'sansBold', style: Style }} Item
   * @type {Item[][]}
   */
  const chunks = []
  /** @type {Item[]} */
  let chunk = []
  let curX = 0
  let curY = 0
  for (let i = 0; i < chars.length; i++) {
    const p = pos[i]
    if (i === 0 || (p && (p.x !== undefined || p.y !== undefined))) {
      if (p && p.x !== undefined) curX = p.x
      if (p && p.y !== undefined) curY = p.y
      chunk = []
      chunks.push(chunk)
    }
    if (p && p.dx) curX += p.dx
    if (p && p.dy) curY += p.dy
    const { c, style } = chars[i]
    const fm = fontOf(style)
    const cp = /** @type {number} */ (c.codePointAt(0))
    const a = fm ? fm.adv(cp) : NaN
    if (fm && !Number.isFinite(a) && c !== ' ') st.missing.add(c)
    let sizeDev = style.fontSize * s
    if (sizeDev < MIN_TEXT_PT - 1e-9) {
      sizeDev = MIN_TEXT_PT
      warnOnce(st, 'min7', `${MIN_TEXT_PT}pt 未満の字を ${MIN_TEXT_PT}pt に上げました`)
    }
    const adv = (Number.isFinite(a) ? a : fallbackAdv(cp)) * sizeDev
    chunk.push({ c, ux: curX, uy: curY, sizeDev, adv, font: style.bold ? 'sansBold' : 'sans', style })
    curX += adv / ax
  }

  for (const items of chunks) {
    const first = items[0]
    const last = items[items.length - 1]
    const width = last.ux + last.adv / ax - first.ux
    const anchor = first.style.anchor
    const shift = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0
    const [px, py] = apply(m, first.ux + shift, first.uy)
    if (!Number.isFinite(px + py)) continue

    /** @type {TextOp | null} */
    let run = null
    let runKey = ''
    const flush = () => {
      if (!run) return
      // 端の空白は描かない（x は字ごとの絶対位置なので、位置はずれない）
      while (run.glyphs.length && run.glyphs[0].c === ' ') run.glyphs.shift()
      while (run.glyphs.length && run.glyphs[run.glyphs.length - 1].c === ' ') run.glyphs.pop()
      if (run.glyphs.length) emit(st, ctx, run)
      run = null
    }
    for (const it of items) {
      const sty = it.style
      const fill = resolvePaint(sty.fill, sty, st)
      const alpha = fill ? fill.a * sty.fillOpacity * ctx.opacity : 0
      const fm = fontOf(sty)
      const asc = fm ? fm.ascent : 0.88
      const desc = fm ? fm.descent : -0.12
      let shiftY = 0
      switch (sty.baseline) {
        case 'central':
        case 'middle':
          shiftY = ((asc + desc) / 2) * it.sizeDev
          break
        case 'hanging':
        case 'text-before-edge':
        case 'text-top':
          shiftY = asc * it.sizeDev
          break
        case 'ideographic':
        case 'text-after-edge':
        case 'text-bottom':
          shiftY = desc * it.sizeDev
          break
        default:
      }
      const x = px + (it.ux - first.ux) * ax
      const y = py + (it.uy - first.uy) * ay + shiftY
      if (!sty.visible || !fill || !(alpha > 0)) { flush(); continue }
      touch(st, x, y - asc * it.sizeDev)
      touch(st, x + it.adv, y - desc * it.sizeDev)
      const color = alpha >= 1 - 1e-9 ? toHex(fill) : blend(fill, alpha, st.paper)
      const key = `${it.font}|${it.sizeDev}|${color}|${Math.round(y * 1000)}`
      if (!run || key !== runKey) {
        flush()
        run = { t: 'text', font: it.font, size: Math.round(it.sizeDev * 1000) / 1000, color, y: Math.round(y * 1000) / 1000, glyphs: [] }
        runKey = key
      }
      run.glyphs.push({ c: it.c, x: Math.round(x * 1000) / 1000 })
    }
    flush()
  }
}

// ---------------------------------------------------------------- 入口

/**
 * SVG の字を Op の列にする。読めない所・対応しない物は warnings に書く（投げない）
 * @param {string} svg
 * @param {SvgOpts} opts 四角（x, y, width, height。pt）に viewBox を meet で写す
 * @returns {{ ops: Op[], warnings: string[] }}
 */
export function svgToOps(svg, opts) {
  /** @type {State} */
  const st = {
    warnings: [], warned: new Set(), count: 0, full: false, ids: new Map(),
    metrics: opts.metrics, paper: parseColor(opts.paper || WHITE) || { r: 255, g: 255, b: 255, a: 1 },
    b: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, missing: new Set(), quietStyle: !!opts.quietStyle,
  }
  const done = (/** @type {Op[]} */ ops) => ({ ops, warnings: st.warnings })
  if (typeof svg !== 'string' || svg.length === 0) {
    warnOnce(st, 'empty', 'SVG の字が空です')
    return done([])
  }
  if (svg.length > MAX_SOURCE) {
    warnOnce(st, 'big', 'SVG が大きすぎるので描きません')
    return done([])
  }
  const src = svg.charCodeAt(0) === 0xfeff ? svg.slice(1) : svg
  const parsed = parseXml(src)
  if (!parsed.root) {
    warnOnce(st, 'xml', `SVG を読めませんでした: ${parsed.error}`)
    return done([])
  }
  const root = parsed.root
  if (localName(root.name) !== 'svg') {
    warnOnce(st, 'noroot', '最上位が svg 要素ではありません')
    return done([])
  }
  // clipPath と勾配を引くための id の表（深さを問わず、先に出た物を採る）。読まない要素と属性の警告もここで 1 度だけ
  /** @type {XNode[]} */
  const todo = [root]
  while (todo.length) {
    const nd = /** @type {XNode} */ (todo.pop())
    if (nd.attrs.id !== undefined && !st.ids.has(nd.attrs.id)) st.ids.set(nd.attrs.id, nd)
    const refused = REFUSED.get(nd.name.toLowerCase())
    if (refused === 'style') {
      if (!st.quietStyle) warnOnce(st, 'style', 'style 要素（CSS）は読みません')
    } else if (refused) {
      warnOnce(st, `el:${refused}`, `${refused} 要素は読みません（描きません）`)
    }
    for (const k in nd.attrs) {
      if (k.length > 2 && (k[0] === 'o' || k[0] === 'O') && (k[1] === 'n' || k[1] === 'N')) {
        warnOnce(st, 'on', 'on で始まる属性（イベント）は読みません')
      }
    }
    for (let k = nd.children.length - 1; k >= 0; k--) {
      const ch = nd.children[k]
      if (typeof ch !== 'string') todo.push(ch)
    }
  }

  const X = Number.isFinite(opts.x) ? /** @type {number} */ (opts.x) : 0
  const Y = Number.isFinite(opts.y) ? /** @type {number} */ (opts.y) : 0
  const vb = parseViewBox(root.attrs.viewBox)
  let vbw
  let vbh
  if (vb) {
    vbw = vb[2]
    vbh = vb[3]
  } else {
    vbw = parseLen(root.attrs.width, 16, 0)
    vbh = parseLen(root.attrs.height, 16, 0)
    if (!(vbw > 0) || !(vbh > 0)) {
      vbw = opts.width > 0 ? opts.width : 100
      vbh = opts.height > 0 ? opts.height : 100
      warnOnce(st, 'size', 'viewBox も width・height も読めないので、渡された四角と同じ大きさとして描きます')
    }
  }
  const W = opts.width > 0 ? opts.width : vbw
  const H = opts.height > 0 ? opts.height : vbh
  const m0 = viewBoxMatrix(vb || [0, 0, vbw, vbh], X, Y, W, H)

  const baseColor = parseColor(opts.color || BLACK) || { r: 0, g: 0, b: 0, a: 1 }
  /** @type {Style} */
  const style = {
    fill: { kind: 'color', rgba: { r: 0, g: 0, b: 0, a: 1 } }, stroke: { kind: 'none' }, strokeWidth: 1, dash: null,
    cap: 'butt', join: 'miter', fillRule: 'nonzero', fillOpacity: 1, strokeOpacity: 1, color: baseColor,
    fontSize: 16, bold: false, anchor: 'start', baseline: 'auto', visible: true,
  }
  /** @type {Op[]} */
  const ops = []
  walk(root, { m: m0, style, opacity: 1, out: ops, vw: vbw, vh: vbh }, st, 0)

  if (st.missing.size) {
    warnOnce(st, 'missing', `書体に無い字があります: ${[...st.missing].slice(0, 10).join('')}`)
  }
  const b = st.b
  const eps = 0.01
  if (opts.clip !== false && ops.length && (b.x0 < X - eps || b.y0 < Y - eps || b.x1 > X + W + eps || b.y1 > Y + H + eps)) {
    return done([{ t: 'clip', x: X, y: Y, w: W, h: H, ops }])
  }
  return done(ops)
}
