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
// - <image>・<style>・<script>・<foreignObject>: 外への参照や実行に繋がる物は読まない。
// - <use> の外のファイル（href="a.svg#x"・data:）: 同じ文書の #id だけ読む。循環は経路に載せて止め、展開の回数にも上限を付ける（入れ子の use で部品が指数的に増えるため）。
// - 入れ子の svg の id を作る側が前置きで避ける案: 外から来た SVG（ロゴ）を直せない。読む側で、内側の svg から外へ探す。
// - 勾配を座標の変換つきの Paint にする案: Paint は頁の pt の線形（始点・終点）と放射（円）だけ。objectBoundingBox や gradientTransform で
//   斜めに歪む線形は、始点と「終点＝等値線が垂直になる軸の端」を逆行列から出せば正確に写る。円が楕円になる放射だけは円で近似し、警告する。
// - グループの mix-blend-mode を 1 枚に合成してから混ぜる案: Op に層が無い。子の Op それぞれに同じ blend を付ける（子が重なる所は二重に混ざる）。
// - グループや線・円の filter の影: RectOp.shadow は四角の影しか持てない。rect に直接掛けた feDropShadow（または feGaussianBlur+feOffset）だけ読み、
//   ほかの filter は今までどおり読まない。
// - 影の blur は CSS の box-shadow と同じ「ぼかしの半径」= 2σ（pt）。render/paint.mjs（PDF）が σ = blur / 2 で読むのに合わせた。欄は stdDeviation = blur / 2 に戻す。

/** @typedef {[number, number, number, number, number, number]} Mat */
/** @typedef {{ name: string, attrs: Record<string, string>, children: (XNode | string)[] }} XNode */
/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba */
/** @typedef {{ kind: 'none' } | { kind: 'current' } | { kind: 'color', rgba: Rgba } | { kind: 'url', id: string, fallback: Rgba | null }} SvgPaint */
/** @typedef {{ ascent: number, descent: number, adv: (cp: number) => number }} FontLike */
/** @typedef {{ x?: number, y?: number, width: number, height: number, metrics?: Record<string, FontLike>, color?: string, paper?: string, clip?: 'auto' | false, quietStyle?: boolean }} SvgOpts
 *   color は currentColor の色（既定 黒）。paper は半透明の字を混ぜる地の色（既定 白）。
 *   clip: 'auto' は描いた物が四角からはみ出す時だけ ClipOp で包む。false は包まない（chartToOps が自分で包む）。
 *   quietStyle: style 要素を読まない旨の警告を出さない（ECharts は hover 用の CSS を必ず入れるため） */
/** @typedef {{ at: number, color: string, opacity?: number }} Stop */
/** @typedef {{ kind: 'linear', x1: number, y1: number, x2: number, y2: number, stops: Stop[] } | { kind: 'radial', cx: number, cy: number, r: number, fx?: number, fy?: number, stops: Stop[] }} Paint
 *  docs/deck.md の 2。座標は頁の pt（左上が原点） */
/** @typedef {'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'} Blend */
/** @typedef {{ dx: number, dy: number, blur: number, color: string, opacity: number }} Shadow */
/** @typedef {{ t: 'path', d: string, fill?: string, stroke?: string, lw?: number, opacity?: number, fillRule?: 'evenodd', cap?: 'round' | 'square', join?: 'round' | 'bevel', dash?: number[], paint?: Paint, blend?: Blend }} PathOp */
/** @typedef {{ t: 'rect', x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number, r?: number, opacity?: number, shadow?: Shadow, paint?: Paint, blend?: Blend }} RectOp */
/** @typedef {{ t: 'text', font: 'sans' | 'sansBold', size: number, color: string, y: number, glyphs: { c: string, x: number }[], paint?: Paint, opacity?: number, blend?: Blend }} TextOp */
/** @typedef {{ t: 'clip', x: number, y: number, w: number, h: number, d?: string, ops: Op[] }} ClipOp */
/** @typedef {PathOp | RectOp | TextOp | ClipOp} Op */
/**
 * @typedef {{
 *   fill: SvgPaint, stroke: SvgPaint, strokeWidth: number, dash: number[] | null,
 *   cap: 'butt' | 'round' | 'square', join: 'miter' | 'round' | 'bevel', fillRule: 'nonzero' | 'evenodd',
 *   fillOpacity: number, strokeOpacity: number, color: Rgba, fontSize: number, bold: boolean,
 *   anchor: 'start' | 'middle' | 'end', baseline: string, visible: boolean,
 * }} Style
 */
/** @typedef {{ m: Mat, style: Style, opacity: number, out: Op[], vw: number, vh: number, blend: Blend | null }} Ctx */
/** @typedef {[string, ...number[]]} Seg */

/** Op の数の上限。超えた分は捨てる */
const MAX_OPS = 20000
/** 入れ子の深さの上限（再帰を浅く保つ） */
const MAX_DEPTH = 64
const MAX_SOURCE = 8_000_000
const MAX_NODES = 300_000
/** use の展開の回数と、walk が要素を訪ねる回数の上限。入れ子の use で同じ部品を指数的に増やされても止まる */
const MAX_USES = 10_000
const MAX_STEPS = 1_000_000
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
function mixWithPaper(c, alpha, paper) {
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
  ['script', 'script'], ['foreignobject', 'foreignObject'], ['image', 'image'], ['style', 'style'],
  ['iframe', 'iframe'], ['audio', 'audio'], ['video', 'video'], ['animate', 'animate'], ['set', 'set'],
  ['animatetransform', 'animateTransform'], ['animatemotion', 'animateMotion'],
])
const CONTAINERS = new Set(['g', 'a', 'svg'])
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

/** style 属性と別に、同じ名前の属性（プレゼンテーション属性）として読む物 */
const PRESENTATION = new Set([
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'fill-rule',
  'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'display', 'visibility', 'font-size', 'font-weight',
  'text-anchor', 'dominant-baseline', 'clip-path', 'overflow', 'filter', 'mask', 'stop-color', 'stop-opacity', 'mix-blend-mode',
])

/**
 * @typedef {{
 *   warnings: string[], warned: Set<string>, count: number, full: boolean,
 *   ids: Map<string, XNode>, scopes: Map<string, XNode>[], scopeOf: Map<XNode, Map<string, XNode>>, path: XNode[], useCount: number, steps: number, metrics: Record<string, FontLike> | undefined, paper: Rgba,
 *   b: { x0: number, y0: number, x1: number, y1: number }, missing: Set<string>, quietStyle: boolean,
 * }} State
 */

/** @param {State} st @param {string} key @param {string} msg */
function warnOnce(st, key, msg) {
  if (st.warned.has(key)) return
  st.warned.add(key)
  st.warnings.push(msg)
}

/**
 * id から要素を引く。いま描いている所を含む一番内側の svg から外側へ順に探し、どこにも無ければ文書全体で先に出た物。
 * 入れ子の svg どうしが同じ id（ECharts の zr0-c0 など）を持っていても、それぞれ自分の clipPath・勾配に当たる
 * 選ばなかった案: 作る側が id に前置きを付ける。呼ぶ側に強いることになり、外から来た SVG（ロゴ）は直せない
 * @param {State} st @param {string} id
 */
function findId(st, id) {
  for (let i = st.scopes.length - 1; i >= 0; i--) {
    const v = st.scopes[i].get(id)
    if (v) return v
  }
  return st.ids.get(id)
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
  if (!reserve(st)) return
  if (ctx.blend && op.t !== 'clip') op.blend = ctx.blend
  ctx.out.push(op)
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

const FONT_SIZE_WORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'smaller', 'larger'])

/**
 * CSS の font のまとめ書き（`normal bold 9.5px/1.2 "Noto Sans JP", sans-serif`）を、font-style・font-weight・font-size・font-family にばらす。
 * まとめ書きは書かなかった物を初期値に戻すので、4 つとも返す。大きさの語が見つからない（caption・menu などのシステム書体）なら null。
 * 選ばなかった案: font-variant・font-stretch・line-height も返す。Style に持ち場所が無く、読んでも描き方が変わらない。
 * @param {string} v
 * @returns {{ 'font-style': string, 'font-weight': string, 'font-size': string, 'font-family': string } | null}
 */
export function parseFontShorthand(v) {
  const t = v.trim()
  let style = 'normal'
  let weight = 'normal'
  let i = 0
  const n = t.length
  while (i < n) {
    while (i < n && /\s/.test(t[i])) i++
    let j = i
    while (j < n && !/\s/.test(t[j])) j++
    if (j === i) break
    const tok = t.slice(i, j)
    const lower = tok.toLowerCase()
    const slash = lower.indexOf('/')
    const head = slash < 0 ? lower : lower.slice(0, slash)
    const lm = LEN_RE.exec(head)
    // 単位の無い数は太さ（400）なので大きさに数えない
    if (FONT_SIZE_WORDS.has(head) || (lm && lm[2])) {
      // 大きさの後ろは line-height（`12px / 1.2` のように離れた書き方も）を飛ばして、残りが書体名
      let rest = t.slice(j).trim()
      if (slash < 0 && rest[0] === '/') rest = rest.replace(/^\/\s*\S+\s*/, '')
      return { 'font-style': style, 'font-weight': weight, 'font-size': head, 'font-family': rest }
    }
    if (lower === 'italic' || lower === 'oblique') style = lower
    else if (lower === 'bold' || lower === 'bolder' || lower === 'lighter' || /^[1-9]\d{0,2}$/.test(lower)) weight = lower
    // normal・small-caps・condensed などは初期値のままか、描き方が変わらない
    else if (lower !== 'normal' && lower !== 'small-caps' && !/^(ultra-|extra-|semi-)?(condensed|expanded)$/.test(lower)) return null
    i = j
  }
  return null
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
    if (!name || !value || value.includes('var(')) continue
    if (name === 'font') {
      // その場でばらす。あとに書かれた font-size などが勝ち、前に書かれた物はまとめ書きが上書きする（CSS の順序のとおり）
      const parts = parseFontShorthand(value)
      if (parts) Object.assign(out, parts)
    } else out[name] = value
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
  if (attrs.font !== undefined) {
    const parts = parseFontShorthand(attrs.font)
    if (parts) p = Object.assign(p, parts)
  }
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
 * @returns {SvgPaint | null} 読めなければ null（親の値を残す）
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

// ---------------------------------------------------------------- 塗り（勾配・影・重ね方）

/** 線分の列（M・L・C・Z）の外接の四角。曲線は端の点でなく極値まで見る @param {Seg[]} segs @returns {{ x: number, y: number, w: number, h: number } | null} */
function segsBox(segs) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let px = 0
  let py = 0
  /** @param {number} x @param {number} y */
  const add = (x, y) => {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  for (const seg of segs) {
    if (seg[0] === 'Z') continue
    if (seg[0] === 'C') {
      const [, ax, ay, bx, by, ex, ey] = /** @type {number[]} */ (seg)
      for (const t of [...cubicExtrema(px, ax, bx, ex), ...cubicExtrema(py, ay, by, ey)]) {
        add(cubicAt(px, ax, bx, ex, t), cubicAt(py, ay, by, ey, t))
      }
      add(ex, ey)
      px = ex
      py = ey
    } else {
      px = /** @type {number} */ (seg[1])
      py = /** @type {number} */ (seg[2])
      add(px, py)
    }
  }
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 3 次ベジェの 1 軸の極値の t（0〜1 の内側） @param {number} p0 @param {number} p1 @param {number} p2 @param {number} p3 */
function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  /** @type {number[]} */
  const ts = []
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const sq = Math.sqrt(disc)
      ts.push((-b + sq) / (2 * a), (-b - sq) / (2 * a))
    }
  }
  return ts.filter((t) => t > 0 && t < 1)
}

/** @param {number} p0 @param {number} p1 @param {number} p2 @param {number} p3 @param {number} t */
function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** @param {Seg[]} segs @param {Mat} m @returns {Seg[] | null} 数がおかしければ null */
function transformSegs(segs, m) {
  /** @type {Seg[]} */
  const out = []
  for (const seg of segs) {
    if (seg[0] === 'Z') { out.push(seg); continue }
    /** @type {[string, ...number[]]} */
    const o = [seg[0]]
    for (let k = 1; k < seg.length; k += 2) {
      const [x, y] = apply(m, /** @type {number} */ (seg[k]), /** @type {number} */ (seg[k + 1]))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      o.push(x, y)
    }
    out.push(o)
  }
  return out
}

/** href でつながる勾配の鎖（自分から先へ）。循環と 5 段目以降は辿らない @param {XNode} el @param {State} st */
function gradientChain(el, st) {
  /** @type {XNode[]} */
  const chain = [el]
  for (let i = 0; i < 4; i++) {
    const last = chain[chain.length - 1]
    const href = last.attrs.href ?? last.attrs['xlink:href']
    if (!href || href[0] !== '#') break
    const ref = findId(st, href.slice(1))
    if (!ref || chain.includes(ref)) break
    const nm = localName(ref.name)
    if (nm !== 'linearGradient' && nm !== 'radialGradient') break
    chain.push(ref)
  }
  return chain
}

/** 勾配の止まり。stop を持つ最初の要素の物（href の先から受け継ぐ）。offset は昇順に直す @param {XNode[]} chain @param {Style} style @returns {{ at: number, rgba: Rgba }[]} */
function gradientStops(chain, style) {
  const holder = chain.find((g) => g.children.some((c) => typeof c !== 'string' && localName(c.name) === 'stop'))
  if (!holder) return []
  /** @type {{ at: number, rgba: Rgba }[]} */
  const out = []
  let prev = 0
  for (const c of holder.children) {
    if (typeof c === 'string' || localName(c.name) !== 'stop') continue
    const p = { ...c.attrs, ...(c.attrs.style !== undefined ? parseStyleAttr(c.attrs.style) : {}) }
    const raw = p.offset === undefined ? NaN : parseFloat(p.offset)
    let at = Number.isFinite(raw) ? (p.offset.trim().endsWith('%') ? raw / 100 : raw) : 0
    at = Math.max(prev, clamp(at, 0, 1))
    prev = at
    const sc = p['stop-color'] === undefined ? undefined : p['stop-color'].trim()
    const col = sc === undefined ? { r: 0, g: 0, b: 0, a: 1 } : sc.toLowerCase() === 'currentcolor' ? style.color : parseColor(sc) || { r: 0, g: 0, b: 0, a: 1 }
    const o = p['stop-opacity'] !== undefined ? parseOpacity(p['stop-opacity']) : 1
    out.push({ at, rgba: { ...col, a: col.a * (Number.isFinite(o) ? o : 1) } })
  }
  return out
}

/** Paint の止まりの数の上限（docs/deck.md の 2） */
const MAX_STOPS = 8
/** @param {number} v */
const r3 = (v) => Math.round(v * 1000) / 1000

/**
 * 勾配の要素を、頁の pt の Paint にする
 * @param {XNode} el linearGradient か radialGradient
 * @param {State} st @param {Ctx} ctx @param {Style} style @param {Mat} m 図形の座標系から頁への行列
 * @param {{ x: number, y: number, w: number, h: number } | null} bbox 図形の座標系での外接の四角（objectBoundingBox の基準）
 * @returns {{ paint: Paint, first: Rgba } | { solid: Rgba | null } | null} null は「描けない」（外接の四角が無いなど）。solid は 1 色で塗る（止まりが 1 つ・点に潰れた勾配）
 */
function makeGradient(el, st, ctx, style, m, bbox) {
  const chain = gradientChain(el, st)
  const own = localName(el.name)
  const common = new Set(['gradientUnits', 'gradientTransform', 'spreadMethod'])
  /** @param {string} name */
  const attr = (name) => {
    for (const g of chain) {
      if (!common.has(name) && localName(g.name) !== own) continue
      const v = g.attrs[name]
      if (v !== undefined) return v
    }
    return undefined
  }
  const stops = gradientStops(chain, style)
  if (stops.length === 0) return { solid: null }
  if (stops.every((s) => !(s.rgba.a > 0))) return { solid: null }
  if (stops.length === 1) return { solid: stops[0].rgba }
  const last = stops[stops.length - 1].rgba
  const spread = attr('spreadMethod')
  if (spread !== undefined && spread.trim() !== 'pad') {
    warnOnce(st, 'spread', `spreadMethod="${spread.trim()}" は読みません（pad として描きます）`)
  }
  const user = (attr('gradientUnits') || '').trim() === 'userSpaceOnUse'
  /** @type {Mat} */
  let G = IDENTITY
  const gt = attr('gradientTransform')
  if (gt !== undefined) {
    const t = parseTransform(gt)
    if (t) G = t
    else warnOnce(st, 'gradtransform', '読めない gradientTransform があったので、その変換は無いものとして描きます')
  }
  /** @type {Mat} */
  let T
  if (user) T = mul(m, G)
  else {
    if (!bbox || !(bbox.w > 0) || !(bbox.h > 0)) return null
    T = mul(mul(m, [bbox.w, 0, 0, bbox.h, bbox.x, bbox.y]), G)
  }
  const [a, b, c, d] = T
  const det = a * d - b * c
  if (!(Math.abs(det) > 1e-12)) return null
  const diag = Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2)
  /** bbox の基準では 50% が 0.5 になるよう ref を 1 にする @param {string} name @param {number} dflt @param {number} ref */
  const len = (name, dflt, ref) => {
    const v = attr(name)
    const n = v === undefined ? NaN : parseLen(v, style.fontSize, user ? ref : 1)
    return Number.isFinite(n) ? n : dflt
  }

  /** @type {Stop[]} */
  let outStops = stops.map((s) => {
    /** @type {Stop} */
    const o = { at: Math.round(s.at * 10000) / 10000, color: toHex(s.rgba) }
    if (s.rgba.a < 1 - 1e-9) o.opacity = r3(s.rgba.a)
    return o
  })
  if (outStops.length > MAX_STOPS) {
    warnOnce(st, 'stops', `勾配の止まりが ${MAX_STOPS} 個を超えるので間引きました`)
    const n = outStops.length
    const keep = new Set([0, n - 1])
    for (let k = 1; k < MAX_STOPS - 1; k++) keep.add(Math.round((k * (n - 1)) / (MAX_STOPS - 1)))
    outStops = outStops.filter((_, i) => keep.has(i))
  }

  if (own === 'linearGradient') {
    const x1 = len('x1', 0, ctx.vw)
    const y1 = len('y1', 0, ctx.vh)
    const x2 = len('x2', user ? ctx.vw : 1, ctx.vw)
    const y2 = len('y2', 0, ctx.vh)
    const vx = x2 - x1
    const vy = y2 - y1
    const v2 = vx * vx + vy * vy
    if (!(v2 > 0)) return { solid: last }
    // 等値線が垂直になる軸に直す: 変換後の「1pt 進むと t がどれだけ増えるか」の向きを逆行列の転置から出し、終点をそこに置く
    const gx = (d * vx - b * vy) / det / v2
    const gy = (-c * vx + a * vy) / det / v2
    const g2 = gx * gx + gy * gy
    if (!(g2 > 0)) return null
    const [sx, sy] = apply(T, x1, y1)
    const ex = sx + gx / g2
    const ey = sy + gy / g2
    if (![sx, sy, ex, ey].every(Number.isFinite)) return null
    return { paint: { kind: 'linear', x1: r3(sx), y1: r3(sy), x2: r3(ex), y2: r3(ey), stops: outStops }, first: stops[0].rgba }
  }

  const cx = len('cx', user ? ctx.vw / 2 : 0.5, ctx.vw)
  const cy = len('cy', user ? ctx.vh / 2 : 0.5, ctx.vh)
  const r = len('r', user ? diag / 2 : 0.5, diag)
  if (!(r > 0)) return { solid: last }
  const fx = len('fx', cx, ctx.vw)
  const fy = len('fy', cy, ctx.vh)
  const lenA = Math.hypot(a, b)
  const lenB = Math.hypot(c, d)
  const similar = Math.abs(lenA - lenB) <= 1e-3 * Math.max(lenA, lenB) && Math.abs(a * c + b * d) <= 1e-3 * lenA * lenB
  if (!similar) warnOnce(st, 'radialellipse', '放射の勾配が楕円になる変形（縦横の比が違う四角に objectBoundingBox で掛けた時など）は、円で近似します')
  const rr = r * Math.sqrt(Math.abs(det))
  const [px, py] = apply(T, cx, cy)
  let [qx, qy] = apply(T, fx, fy)
  if (![px, py, qx, qy, rr].every(Number.isFinite)) return null
  // 焦点は円の内側に収める（SVG 1.1 の決まり。外に出る円錐は PDF のビューアーごとに塗りが違う）
  const dist = Math.hypot(qx - px, qy - py)
  if (dist > rr * 0.999) {
    const k = (rr * 0.999) / dist
    qx = px + (qx - px) * k
    qy = py + (qy - py) * k
  }
  /** @type {Paint} */
  const paint = { kind: 'radial', cx: r3(px), cy: r3(py), r: r3(rr), stops: outStops }
  if (Math.hypot(qx - px, qy - py) > 1e-6) { paint.fx = r3(qx); paint.fy = r3(qy) }
  return { paint, first: stops[0].rgba }
}

/**
 * 塗り（fill）を解決する。勾配は Paint（頁の pt）にし、読めなければ fallback の色。none は null
 * @param {SvgPaint} sp @param {Style} style @param {State} st @param {Ctx} ctx @param {Mat} m
 * @param {() => ({ x: number, y: number, w: number, h: number } | null)} bbox objectBoundingBox の勾配のときだけ呼ぶ
 * @returns {{ rgba: Rgba, alpha: number, paint: Paint | null } | null} alpha は色自身の透明度（勾配の時は止まりの側が持つので 1）
 */
function resolveFill(sp, style, st, ctx, m, bbox) {
  if (sp.kind === 'none') return null
  if (sp.kind === 'color') return { rgba: sp.rgba, alpha: sp.rgba.a, paint: null }
  if (sp.kind === 'current') return { rgba: style.color, alpha: style.color.a, paint: null }
  const el = findId(st, sp.id)
  const nm = el ? localName(el.name) : ''
  if (el && (nm === 'linearGradient' || nm === 'radialGradient')) {
    const g = makeGradient(el, st, ctx, style, m, bbox())
    if (g && 'paint' in g) return { rgba: g.first, alpha: 1, paint: g.paint }
    if (g) return g.solid ? { rgba: g.solid, alpha: g.solid.a, paint: null } : null
  } else if (el) {
    warnOnce(st, 'pattern', 'パターンの塗りは読みません')
  }
  return sp.fallback ? { rgba: sp.fallback, alpha: sp.fallback.a, paint: null } : null
}

/**
 * 線の色。勾配は最初の色の単色にする（Op の paint は塗りだけ）。none なら null
 * @param {SvgPaint} paint @param {Style} style @param {State} st
 * @returns {Rgba | null}
 */
function resolvePaint(paint, style, st) {
  if (paint.kind === 'none') return null
  if (paint.kind === 'color') return paint.rgba
  if (paint.kind === 'current') return style.color
  const el = findId(st, paint.id)
  const nm = el ? localName(el.name) : ''
  if (el && (nm === 'linearGradient' || nm === 'radialGradient')) {
    const stops = gradientStops(gradientChain(el, st), style)
    if (stops.length) {
      warnOnce(st, 'gradientline', 'グラデーションの線は最初の色の単色で描きます')
      return stops[0].rgba
    }
  } else if (el) {
    warnOnce(st, 'pattern', 'パターンの塗りは読みません')
  }
  return paint.fallback
}

/** @type {Set<string>} */
const BLEND_MODES = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'])

/** @param {State} st @param {string} v @returns {Blend | null} 無し・normal・読めない値は null */
function parseBlend(st, v) {
  const t = v.trim().toLowerCase()
  if (t === 'normal' || t === '') return null
  if (BLEND_MODES.has(t)) return /** @type {Blend} */ (t)
  warnOnce(st, 'blend', `mix-blend-mode: ${t} は読みません（normal として描きます）`)
  return null
}

/**
 * filter="url(#id)" が影だけの filter なら、その影（図形の座標系の長さ）を返す。feDropShadow 1 つ、または
 * feGaussianBlur と feOffset（と feFlood・feComposite・feMerge・feComponentTransfer）の組。それ以外は null
 * @param {string} value @param {State} st
 * @returns {{ dx: number, dy: number, blur: number, color: string, opacity: number } | null}
 */
function resolveShadow(value, st) {
  const t = value.trim()
  if (!t.toLowerCase().startsWith('url(')) return null
  const ref = readUrlRef(t)
  if (!ref || ref.ref[0] !== '#') return null
  const el = findId(st, ref.ref.slice(1))
  if (!el || localName(el.name) !== 'filter') return null
  const prims = /** @type {XNode[]} */ (el.children.filter((c) => typeof c !== 'string'))
  /** @param {XNode} n */
  const props = (n) => ({ ...n.attrs, ...(n.attrs.style !== undefined ? parseStyleAttr(n.attrs.style) : {}) })
  /** 数の列の最初の 1 つ @param {string | undefined} s @param {number} dflt */
  const first = (s, dflt) => {
    const n = s === undefined ? NaN : parseFloat(s)
    return Number.isFinite(n) ? n : dflt
  }
  /** @param {XNode | undefined} flood @param {number} mulOpacity */
  const colorOf = (flood, mulOpacity) => {
    const p = flood ? props(flood) : {}
    const c = (p['flood-color'] !== undefined && parseColor(p['flood-color'])) || { r: 0, g: 0, b: 0, a: 1 }
    const o = p['flood-opacity'] !== undefined ? parseOpacity(p['flood-opacity']) : 1
    return { color: toHex(c), opacity: clamp(c.a * (Number.isFinite(o) ? o : 1) * mulOpacity, 0, 1) }
  }
  const named = (/** @type {string} */ n) => prims.find((p) => localName(p.name) === n)
  const names = new Set(prims.map((p) => localName(p.name)))
  const drop = named('feDropShadow')
  if (drop) {
    if (names.size !== 1) return null
    const a = drop.attrs
    return { dx: first(a.dx, 2), dy: first(a.dy, 2), blur: Math.max(0, first(a.stdDeviation, 2)), ...colorOf(drop, 1) }
  }
  const blur = named('feGaussianBlur')
  const offset = named('feOffset')
  const ALLOWED = ['feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feComponentTransfer']
  if (!blur || !(offset || names.has('feMerge')) || [...names].some((n) => !ALLOWED.includes(n))) return null
  // 影の濃さを feComponentTransfer の feFuncA（slope）で決める書き方が広く出回っている
  let alpha = 1
  const transfer = named('feComponentTransfer')
  const funcA = transfer && /** @type {XNode | undefined} */ (transfer.children.find((c) => typeof c !== 'string' && localName(c.name) === 'feFuncA'))
  if (funcA && (funcA.attrs.type === undefined || funcA.attrs.type === 'linear')) alpha = clamp(first(funcA.attrs.slope, 1), 0, 1)
  return {
    dx: offset ? first(offset.attrs.dx, 0) : 0,
    dy: offset ? first(offset.attrs.dy, 0) : 0,
    blur: Math.max(0, first(blur.attrs.stdDeviation, 0)),
    ...colorOf(named('feFlood'), alpha),
  }
}

// ---------------------------------------------------------------- 描く

/**
 * 線分の列を行列で写した d にする
 * 線の太さの半分は、はみ出しの判定に入れない（四角の縁に引いた枠線のたびに ClipOp で包むことになるため）
 * @param {State} st @param {Seg[]} segs @param {Mat} m @param {boolean} [track] false なら描いた範囲に数えない（clipPath の形）
 * @returns {string | null} 数がおかしければ null
 */
function segsToD(st, segs, m, track = true) {
  const parts = []
  for (const seg of segs) {
    const c = seg[0]
    if (c === 'Z') { parts.push('Z'); continue }
    const out = [c]
    for (let k = 1; k < seg.length; k += 2) {
      const [x, y] = apply(m, /** @type {number} */ (seg[k]), /** @type {number} */ (seg[k + 1]))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      if (track) touch(st, x, y)
      out.push(fmt(x), fmt(y))
    }
    parts.push(out.join(' '))
  }
  return parts.join(' ')
}

/**
 * 図形を PathOp（角丸・影のある四角は RectOp）にする。塗りと線で透明度が違えば 2 つに分ける
 * @param {State} st @param {Ctx} ctx @param {Seg[]} segs @param {boolean} fillable 線だけの図形（line）は false
 * @param {{ rect?: { x: number, y: number, w: number, h: number, r: number }, box?: { x: number, y: number, w: number, h: number }, shadow?: Shadow | null } | null} [opt]
 *   rect は RectOp の頁の pt の位置。box は objectBoundingBox の基準（図形の座標系。無ければ segs から出す）。shadow は頁の pt の長さで、opacity は影の色の濃さ（塗りの透明度は後で掛ける）
 */
function drawShape(st, ctx, segs, fillable, opt) {
  const style = ctx.style
  const rect = opt ? opt.rect : undefined
  if (!style.visible || (!rect && segs.length === 0)) return
  const s = scaleOf(ctx.m)
  if (!(s > 0)) return
  let fill = fillable ? resolveFill(style.fill, style, st, ctx, ctx.m, () => (opt && opt.box) || segsBox(segs)) : null
  let stroke = resolvePaint(style.stroke, style, st)
  const lw = style.strokeWidth * s
  const fillA = fill ? fill.alpha * style.fillOpacity * ctx.opacity : 0
  const strokeA = stroke ? stroke.a * style.strokeOpacity * ctx.opacity : 0
  if (!(fillA > 0)) fill = null
  if (!(strokeA > 0) || !(lw > 0)) stroke = null
  if (!fill && !stroke) return
  const d = rect ? '' : segsToD(st, segs, ctx.m)
  if (d === null) return
  if (rect) { touch(st, rect.x, rect.y); touch(st, rect.x + rect.w, rect.y + rect.h) }

  /** @returns {PathOp | RectOp} */
  const make = () => {
    if (!rect) return { t: 'path', d }
    /** @type {RectOp} */
    const op = { t: 'rect', x: r3(rect.x), y: r3(rect.y), w: r3(rect.w), h: r3(rect.h) }
    if (rect.r > 0) op.r = r3(rect.r)
    return op
  }
  /** @param {PathOp | RectOp} op @param {number} a */
  const withOpacity = (op, a) => {
    if (a < 1 - 1e-9) op.opacity = Math.round(a * 1000) / 1000
    return op
  }
  /** @param {PathOp | RectOp} op */
  const addStroke = (op) => {
    op.stroke = toHex(/** @type {Rgba} */ (stroke))
    op.lw = Math.round(lw * 1000) / 1000
    return op
  }
  /** @param {PathOp | RectOp} op */
  const addFill = (op) => {
    op.fill = toHex(/** @type {NonNullable<typeof fill>} */ (fill).rgba)
    const g = /** @type {NonNullable<typeof fill>} */ (fill).paint
    if (g) op.paint = g
    if (op.t === 'path' && style.fillRule === 'evenodd') op.fillRule = 'evenodd'
    return op
  }
  /** @param {PathOp | RectOp} op */
  const addStrokeStyle = (op) => {
    if (op.t !== 'path') return op
    if (style.cap !== 'butt') op.cap = style.cap
    if (style.join !== 'miter') op.join = style.join
    if (style.dash) op.dash = style.dash.map((v) => Math.round(v * s * 1000) / 1000)
    return op
  }
  /** @param {PathOp | RectOp} op @param {number} a */
  const addShadow = (op, a) => {
    const sh = opt && opt.shadow
    if (op.t !== 'rect' || !sh) return op
    const o = sh.opacity * a
    if (o > 0.001) op.shadow = { dx: r3(sh.dx), dy: r3(sh.dy), blur: r3(sh.blur), color: sh.color, opacity: r3(o) }
    return op
  }

  if (fill && stroke && Math.abs(fillA - strokeA) < 1e-6) {
    emit(st, ctx, addShadow(addStrokeStyle(withOpacity(addStroke(addFill(make())), fillA)), fillA))
    return
  }
  if (fill) emit(st, ctx, addShadow(withOpacity(addFill(make()), fillA), fillA))
  if (stroke) emit(st, ctx, addStrokeStyle(withOpacity(addStroke(make()), strokeA)))
}

/**
 * rect の位置・大きさ・角の半径（図形の座標系）。半径は辺の半分までに収める。幅か高さが 0 以下なら null
 * @param {XNode} node @param {Ctx} ctx
 * @returns {{ x: number, y: number, w: number, h: number, rx: number, ry: number } | null}
 */
function rectGeom(node, ctx) {
  const a = node.attrs
  const fs = ctx.style.fontSize
  const lx = (/** @type {string | undefined} */ v) => parseLen(v, fs, ctx.vw)
  const ly = (/** @type {string | undefined} */ v) => parseLen(v, fs, ctx.vh)
  const w = lx(a.width)
  const h = ly(a.height)
  if (!(w > 0) || !(h > 0)) return null
  let rx = lx(a.rx)
  let ry = ly(a.ry)
  if (!(rx >= 0)) rx = NaN
  if (!(ry >= 0)) ry = NaN
  if (Number.isNaN(rx) && Number.isNaN(ry)) { rx = 0; ry = 0 } else if (Number.isNaN(rx)) rx = ry
  else if (Number.isNaN(ry)) ry = rx
  const x = lx(a.x)
  const y = ly(a.y)
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, w, h, rx: Math.min(rx, w / 2), ry: Math.min(ry, h / 2) }
}

/**
 * 角丸か影のある rect を RectOp で描く。RectOp で表せない時（回転・だ円の角・破線の枠）は false を返し、呼んだ側が PathOp で描く
 * @param {XNode} node @param {Ctx} ctx @param {State} st @param {{ dx: number, dy: number, blur: number, color: string, opacity: number } | null} spec 図形の座標系の長さの影
 */
function drawRect(node, ctx, st, spec) {
  const g = rectGeom(node, ctx)
  if (!g) return false
  const round = g.rx > 0 && g.ry > 0
  if (!round && !spec) return false
  const m = ctx.m
  const style = ctx.style
  const px = g.rx * Math.abs(m[0])
  const py = g.ry * Math.abs(m[3])
  const axis = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] !== 0 && m[3] !== 0
  const circular = !round || Math.abs(px - py) <= 0.01 * Math.max(px, py)
  const dashed = style.dash !== null && style.stroke.kind !== 'none'
  if (!axis || !circular || dashed) {
    if (spec) warnOnce(st, 'shadowdrop', '回転した四角・だ円の角の四角・破線の枠には影を付けません（影の無い図形として描きます）')
    return false
  }
  const [ax, ay] = apply(m, g.x, g.y)
  const [bx, by] = apply(m, g.x + g.w, g.y + g.h)
  if (![ax, ay, bx, by].every(Number.isFinite)) return true
  const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), r: round ? (px + py) / 2 : 0 }
  const shadow = spec ? { dx: spec.dx * m[0], dy: spec.dy * m[3], blur: spec.blur * scaleOf(m) * 2, color: spec.color, opacity: spec.opacity } : null
  drawShape(st, ctx, [], true, { rect, box: { x: g.x, y: g.y, w: g.w, h: g.h }, shadow })
  return true
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
      const g = rectGeom(node, ctx)
      return g ? rectSegs(g.x, g.y, g.w, g.h, g.rx, g.ry) : []
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

/** 4 つの角が軸に平行な四角（頂点 4 つ、または 4 つ + 始点に戻る線）か。C を含めば違う @param {Seg[]} segs */
function isAxisRect(segs) {
  /** @type {[number, number][]} */
  const pts = []
  for (const sg of segs) {
    if (sg[0] === 'C') return false
    if (sg[0] === 'Z') continue
    pts.push([/** @type {number} */ (sg[1]), /** @type {number} */ (sg[2])])
  }
  if (pts.length === 5 && Math.abs(pts[4][0] - pts[0][0]) < 1e-6 && Math.abs(pts[4][1] - pts[0][1]) < 1e-6) pts.pop()
  if (pts.length !== 4) return false
  const eq = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 1e-6
  return (eq(pts[0][0], pts[1][0]) && eq(pts[1][1], pts[2][1]) && eq(pts[2][0], pts[3][0]) && eq(pts[3][1], pts[0][1])) ||
    (eq(pts[0][1], pts[1][1]) && eq(pts[1][0], pts[2][0]) && eq(pts[2][1], pts[3][1]) && eq(pts[3][0], pts[0][0]))
}

/** 1 つの部分パス（M が 1 つ）の向き。正は rectSegs と同じ向き（頂点・制御点の靴ひも）。M が複数なら 0 @param {Seg[]} segs */
function windingOf(segs) {
  if (segs.filter((s) => s[0] === 'M').length !== 1) return 0
  /** @type {[number, number][]} */
  const pts = []
  for (const sg of segs) {
    if (sg[0] === 'Z') continue
    for (let k = 1; k < sg.length; k += 2) pts.push([/** @type {number} */ (sg[k]), /** @type {number} */ (sg[k + 1])])
  }
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    area += x0 * y1 - x1 * y0
  }
  return area
}

/** 部分パス 1 つの向きを逆にする（M・L・C・Z）。clipPath の子を重ねるとき、向きが逆だと nonzero で重なりが抜けるため @param {Seg[]} segs @returns {Seg[]} */
function reverseSegs(segs) {
  const closed = segs[segs.length - 1][0] === 'Z'
  const body = closed ? segs.slice(0, -1) : segs
  /** @type {[number, number][]} */
  const pts = [[/** @type {number} */ (body[0][1]), /** @type {number} */ (body[0][2])]]
  /** @type {number[][]} 辺 i（pts[i] から pts[i+1]）の制御点。L は空 */
  const ctrl = []
  for (let k = 1; k < body.length; k++) {
    const sg = body[k]
    if (sg[0] === 'C') {
      ctrl.push([/** @type {number} */ (sg[1]), /** @type {number} */ (sg[2]), /** @type {number} */ (sg[3]), /** @type {number} */ (sg[4])])
      pts.push([/** @type {number} */ (sg[5]), /** @type {number} */ (sg[6])])
    } else {
      ctrl.push([])
      pts.push([/** @type {number} */ (sg[1]), /** @type {number} */ (sg[2])])
    }
  }
  /** @type {Seg[]} */
  const out = [['M', pts[pts.length - 1][0], pts[pts.length - 1][1]]]
  for (let i = ctrl.length - 1; i >= 0; i--) {
    const [px, py] = pts[i]
    const c = ctrl[i]
    out.push(c.length ? ['C', c[2], c[3], c[0], c[1], px, py] : ['L', px, py])
  }
  if (closed) out.push(['Z'])
  return out
}

/** clipPath の中に読む形 */
const CLIP_SHAPES = new Set(['rect', 'path', 'polygon', 'circle', 'ellipse'])

/**
 * clip-path="url(#id)" を、頁の座標の切り口にする。軸に平行な四角は x・y・w・h だけ、それ以外の形は d（M・L・C・Z）も付ける。
 * 子が複数なら重ねた形（和）。clipPathUnits="objectBoundingBox" と、rect・path・polygon・circle・ellipse 以外の子は読まない
 * @param {string} value @param {Ctx} ctx @param {State} st
 * @returns {{ x: number, y: number, w: number, h: number, d?: string } | 'empty' | null} 無ければ null
 */
function resolveClip(value, ctx, st) {
  const t = value.trim()
  if (t === 'none' || t === '') return null
  const mm = /^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)$/i.exec(t)
  if (!mm) {
    warnOnce(st, 'extclip', '外への参照の clip-path は読みません')
    return null
  }
  const el = findId(st, mm[2])
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
  /** @type {Seg[][]} 頁の座標の部分パス（子ごと） */
  const shapes = []
  for (const child of el.children) {
    if (typeof child === 'string') continue
    let nm = localName(child.name)
    let shape = child
    const cp = readProps(child)
    if (cp.display === 'none') continue
    let m = base
    if (child.attrs.transform !== undefined) {
      const tm = parseTransform(child.attrs.transform)
      if (tm) m = mul(m, tm)
    }
    if (nm === 'use') {
      // use の先が図形ならその形を x・y だけ動かして使う（use を重ねた use や symbol は読まない）
      const target = useTarget(child, st)
      const tn = target ? localName(target.name) : ''
      if (!target || !CLIP_SHAPES.has(tn) || st.path.includes(target)) { unsupported = true; continue }
      m = mul(m, [1, 0, 0, 1, parseLen(child.attrs.x, 16, ctx.vw) || 0, parseLen(child.attrs.y, 16, ctx.vh) || 0])
      shape = target
      nm = tn
      if (shape.attrs.transform !== undefined) {
        const tm = parseTransform(shape.attrs.transform)
        if (tm) m = mul(m, tm)
      }
    } else if (!CLIP_SHAPES.has(nm)) { unsupported = true; continue }
    const segs = shapeSegs(shape, nm, ctx, st)
    if (segs.length === 0) continue
    const page = transformSegs(segs, m)
    if (page) shapes.push(page)
  }
  if (unsupported) warnOnce(st, 'clipkind', 'clipPath の中は rect・path・polygon・circle・ellipse だけを読みます（ほかの子は切り口に入れません）')
  if (shapes.length === 0) return unsupported ? null : 'empty'

  /** 小数 3 桁に丸めた切り口 @param {Seg[]} segs @param {boolean} withD */
  const finish = (segs, withD) => {
    const b = segsBox(segs)
    if (!b || !(b.w > 0) || !(b.h > 0)) return /** @type {'empty'} */ ('empty')
    /** @type {{ x: number, y: number, w: number, h: number, d?: string }} */
    const r = { x: b.x, y: b.y, w: b.w, h: b.h }
    if (withD) {
      const d = segsToD(st, segs, IDENTITY, false)
      if (d) r.d = d
    }
    return r
  }
  if (shapes.length === 1) return finish(shapes[0], !isAxisRect(shapes[0]))
  const all = shapes.flatMap((s) => (windingOf(s) < 0 ? reverseSegs(s) : s))
  return finish(all, true)
}

/**
 * ctx.out の代わりに inner へ描き、できた物を ClipOp 1 つにして ctx.out に置く
 * @param {State} st @param {Ctx} ctx @param {{ x: number, y: number, w: number, h: number, d?: string }} r @param {(inner: Ctx) => void} fn
 */
function withClip(st, ctx, r, fn) {
  if (!reserve(st)) return
  /** @type {Op[]} */
  const inner = []
  fn({ ...ctx, out: inner })
  if (inner.length === 0) { st.count--; return }
  /** @type {ClipOp} */
  const op = { t: 'clip', x: Math.round(r.x * 1000) / 1000, y: Math.round(r.y * 1000) / 1000, w: Math.round(r.w * 1000) / 1000, h: Math.round(r.h * 1000) / 1000, ops: inner }
  if (r.d) op.d = r.d
  ctx.out.push(op)
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
  if (++st.steps > MAX_STEPS) {
    st.full = true
    warnOnce(st, 'steps', '要素が多すぎる（use の展開を含む）ので、残りは描きません')
    return
  }
  const name = localName(node.name)
  const lower = name.toLowerCase()
  if (REFUSED.has(lower)) return
  const isContainer = CONTAINERS.has(name)
  const isShape = SHAPES.has(name)
  if (!isContainer && !isShape && name !== 'text' && name !== 'use') return
  if (depth > MAX_DEPTH) {
    warnOnce(st, 'depth', `入れ子が ${MAX_DEPTH} 段を超えた所から先は描きません`)
    return
  }
  const props = readProps(node)
  if (props.display === 'none') return
  if (props.mask !== undefined) warnOnce(st, 'mask', 'mask は読みません（付いていないものとして描きます）')
  // 影だけを読む: rect に直接掛けた feDropShadow（または feGaussianBlur+feOffset）。ほかの filter は付いていないものとして描く
  const filterOn = props.filter !== undefined && props.filter.trim().toLowerCase() !== 'none'
  const shadow = filterOn && name === 'rect' ? resolveShadow(props.filter, st) : null
  if (filterOn && !shadow) warnOnce(st, 'filter', 'filter は rect の feDropShadow（または feGaussianBlur と feOffset）だけ読みます（ほかは付いていないものとして描きます）')

  let m = ctx.m
  if (node.attrs.transform !== undefined) {
    const tm = parseTransform(node.attrs.transform)
    if (tm) m = mul(m, tm)
    else warnOnce(st, 'transform', '読めない transform があったので、その変換は無いものとして描きます')
  }
  const refLen = Math.sqrt((ctx.vw * ctx.vw + ctx.vh * ctx.vh) / 2)
  const style = inherit(st, ctx.style, props, refLen)
  const o = props.opacity !== undefined ? parseOpacity(props.opacity) : 1
  // 子の Op にそれぞれ同じ blend を付ける（グループ 1 枚に合成してから混ぜることはできない）。子の normal は親の blend を消さない
  const blend = props['mix-blend-mode'] !== undefined ? parseBlend(st, props['mix-blend-mode']) || ctx.blend : ctx.blend
  /** @type {Ctx} */
  let c = { ...ctx, m, style, opacity: ctx.opacity * (Number.isFinite(o) ? o : 1), blend }

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
  } else if (name === 'use') {
    body = (cc) => drawUse(node, cc, st, depth)
  } else if (name === 'text') {
    body = (cc) => drawText(node, cc, st)
  } else {
    body = (cc) => {
      if (name === 'rect' && drawRect(node, cc, st, shadow)) return
      drawShape(st, cc, shapeSegs(node, name, cc, st), name !== 'line', null)
    }
  }

  const clip = props['clip-path'] !== undefined ? resolveClip(props['clip-path'], c, st) : null
  if (clip === 'empty') return
  /** @param {Ctx} cc */
  const run = (cc) => {
    if (viewportClip) withClip(st, cc, viewportClip, body)
    else body(cc)
  }
  // 入れ子の svg の中では、その svg の id を先に引く。経路には use の循環を見つけるため、いま開いている入れ口を載せる
  const scope = name === 'svg' ? st.scopeOf.get(node) : undefined
  if (scope) st.scopes.push(scope)
  if (isContainer) st.path.push(node)
  try {
    if (clip) withClip(st, c, clip, run)
    else run(c)
  } finally {
    if (isContainer) st.path.pop()
    if (scope) st.scopes.pop()
  }
}

/** use の href の先。無い・外のファイル・見つからない時は警告して null @param {XNode} node @param {State} st @returns {XNode | null} */
function useTarget(node, st) {
  const href = node.attrs.href ?? node.attrs['xlink:href']
  if (href === undefined) return null
  const h = href.trim()
  if (h[0] !== '#') {
    warnOnce(st, 'extuse', 'use が外のファイルを指す参照は読みません（同じ文書の #id だけ読みます）')
    return null
  }
  const target = findId(st, h.slice(1))
  if (!target) warnOnce(st, 'nouse', `use の参照先 ${h} が見つかりません`)
  return target || null
}

/**
 * use を描く。参照先を、use の transform と x・y の移動をかけた座標・use の style を受け継いだ位置に置く。
 * symbol は入れ子の svg として（width・height は use の物、無ければ 100%）。svg は use の width・height で大きさを上書き
 * @param {XNode} node @param {Ctx} ctx @param {State} st @param {number} depth
 */
function drawUse(node, ctx, st, depth) {
  const target = useTarget(node, st)
  if (!target) return
  if (st.path.includes(target)) {
    warnOnce(st, 'usecycle', 'use が自分の中へ戻る参照（循環）は読みません')
    return
  }
  if (++st.useCount > MAX_USES) {
    warnOnce(st, 'usemax', `use の展開が ${MAX_USES} 回を超えたので、残りは描きません`)
    return
  }
  const fs = ctx.style.fontSize
  const x = parseLen(node.attrs.x, fs, ctx.vw) || 0
  const y = parseLen(node.attrs.y, fs, ctx.vh) || 0
  const nm = localName(target.name)
  let el = target
  if (nm === 'symbol' || nm === 'svg') {
    /** @type {Record<string, string>} */
    const attrs = Object.assign(Object.create(null), target.attrs)
    if (nm === 'symbol') { delete attrs.x; delete attrs.y; attrs.width = node.attrs.width ?? '100%'; attrs.height = node.attrs.height ?? '100%' }
    else { if (node.attrs.width !== undefined) attrs.width = node.attrs.width; if (node.attrs.height !== undefined) attrs.height = node.attrs.height }
    el = { name: 'svg', attrs, children: target.children }
    const own = st.scopeOf.get(target)
    if (own) st.scopeOf.set(el, own)
  }
  st.path.push(target)
  try {
    walk(el, { ...ctx, m: mul(ctx.m, [1, 0, 0, 1, x, y]) }, st, depth + 1)
  } finally {
    st.path.pop()
  }
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

  /** 字の勾配（objectBoundingBox）の基準になる、text 要素全体の外接の四角（図形の座標系） */
  const textBox = () => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const items of chunks) {
      const f = items[0]
      const l = items[items.length - 1]
      const w = l.ux + l.adv / ax - f.ux
      const sh = f.style.anchor === 'middle' ? -w / 2 : f.style.anchor === 'end' ? -w : 0
      x0 = Math.min(x0, f.ux + sh)
      x1 = Math.max(x1, f.ux + sh + w)
      for (const it of items) {
        const fm = fontOf(it.style)
        y0 = Math.min(y0, it.uy - (fm ? fm.ascent : 0.88) * it.style.fontSize)
        y1 = Math.max(y1, it.uy - (fm ? fm.descent : -0.12) * it.style.fontSize)
      }
    }
    return [x0, y0, x1, y1].every(Number.isFinite) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
  }
  /** @type {Map<Style, ReturnType<typeof resolveFill>>} */
  const fills = new Map()
  /** @param {Style} sty */
  const fillOf = (sty) => {
    if (!fills.has(sty)) fills.set(sty, resolveFill(sty.fill, sty, st, ctx, m, textBox))
    return fills.get(sty) || null
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
      const fr = fillOf(sty)
      const fill = fr && fr.rgba
      const grad = fr ? fr.paint : null
      const alpha = fr ? fr.alpha * sty.fillOpacity * ctx.opacity : 0
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
      // 勾配の字は、半透明を紙の色に混ぜず本物の不透明度（TextOp.opacity）で持つ。止まりの透明度は paint が持つ
      const color = grad || alpha >= 1 - 1e-9 ? toHex(fill) : mixWithPaper(fill, alpha, st.paper)
      const key = `${it.font}|${it.sizeDev}|${color}|${Math.round(y * 1000)}|${grad ? JSON.stringify(grad) + alpha : ''}`
      if (!run || key !== runKey) {
        flush()
        run = { t: 'text', font: it.font, size: Math.round(it.sizeDev * 1000) / 1000, color, y: Math.round(y * 1000) / 1000, glyphs: [] }
        if (grad) {
          run.paint = grad
          if (alpha < 1 - 1e-9) run.opacity = r3(alpha)
        }
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
    warnings: [], warned: new Set(), count: 0, full: false, ids: new Map(), scopes: [], scopeOf: new Map(), path: [], useCount: 0, steps: 0,
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
  // clipPath・勾配・use を引くための id の表。全体では先に出た物を採り、svg ごと（入れ子の中は含まない）にも持つ。読まない要素と属性の警告もここで 1 度だけ
  /** @type {[XNode, Map<string, XNode>][]} */
  const todo = []
  const rootScope = new Map()
  st.scopeOf.set(root, rootScope)
  todo.push([root, rootScope])
  while (todo.length) {
    const [nd, scope] = /** @type {[XNode, Map<string, XNode>]} */ (todo.pop())
    if (nd.attrs.id !== undefined) {
      if (!st.ids.has(nd.attrs.id)) st.ids.set(nd.attrs.id, nd)
      if (!scope.has(nd.attrs.id)) scope.set(nd.attrs.id, nd)
    }
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
    let childScope = scope
    if (nd !== root && localName(nd.name) === 'svg') {
      childScope = new Map()
      st.scopeOf.set(nd, childScope)
    }
    for (let k = nd.children.length - 1; k >= 0; k--) {
      const ch = nd.children[k]
      if (typeof ch !== 'string') todo.push([ch, childScope])
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
  walk(root, { m: m0, style, opacity: 1, out: ops, vw: vbw, vh: vbh, blend: null }, st, 0)

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
