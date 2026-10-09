// @ts-check
// render/paint: pdf.mjs が使う、グラデーション(Pattern 2 + Shading 2/3 + Function 2/3)・輝度のソフトマスク・影の画素・角丸の path。
// pdf-lib の物は ctx(PDFContext)を引数で受けて作るだけで、頁への足し方(資源の名前・gs)は pdf.mjs が持つ。
// Math.* は大域から引かずにモジュールの変数へ(フックの環境は大域の名前の参照が遅く、画素の繰り返しで効く)。
const { floor, ceil, sqrt, abs, round, min, max } = Math

/** 止まりの数。仕様の Display List は 2〜8 だが、SVG から来た物を捨てて単色にするより通す。それでも暴走を止める上限 */
const STOPS_MAX = 32
/** 1 つの影の画素数の上限と、1 文書の合計の上限。20 枚の影が 1 秒に収まる量 */
export const SHADOW_PX_MAX = 1_000_000
export const SHADOW_PX_TOTAL = 12_000_000
/** 影を作る四角の辺の上限(pt)と、ぼかしの上限(pt)。超えた分は画素にも頁にも意味が無い */
export const SHADOW_SIDE_MAX = 20000
const BLUR_MAX = 400
/** 円を 4 本の三次ベジェで近似する係数 */
const KAPPA = 0.5522847498

const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 座標と色の成分は小数 4 桁で足りる(PDF の数を短くし、同じ見た目の paint を同じ key にする) */
const r4 = (/** @type {number} */ v) => round(v * 10000) / 10000

// ---------------------------------------------------------------- blend

/** blend の名前 → PDF の /BM。normal は null(gs に入れない) */
const BLEND_NAMES = new Map([
  ['normal', null], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
  ['color-dodge', 'ColorDodge'], ['color-burn', 'ColorBurn'], ['hard-light', 'HardLight'], ['soft-light', 'SoftLight'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'],
])

/** @param {unknown} blend @returns {string | null | undefined} PDF の名前・null(normal)・undefined(知らない名前) */
export function blendOf(blend) {
  if (typeof blend !== 'string') return undefined
  return BLEND_NAMES.get(blend)
}

// ---------------------------------------------------------------- paint

/** @typedef {{ at: number, rgb: number[], a: number }} NStop */
/** @typedef {{ kind: 'linear' | 'radial', coords: number[], stops: NStop[], alpha: 'none' | 'uniform' | 'varying', uniform: number, key: string }} NGradient */
/** @typedef {{ kind: 'solid', rgb: number[], alpha: 'none' | 'uniform', uniform: number, key: string }} NSolid */
/** @typedef {NGradient | NSolid} NPaint */

/**
 * Display List の paint を、座標を数にそろえ止まりを昇順にした形へ。読めなければ null(呼ぶ側が fill の色に戻す)。
 * 直線の両端が同じ点・放射の半径が 0 以下は、SVG と同じく最後の止まりの単色(solid)。
 * @param {any} paint
 * @param {(c: unknown) => number[] | null} toRgb 色の字 → [r,g,b](0〜1)
 * @returns {NPaint | null}
 */
export function normalizePaint(paint, toRgb) {
  if (!paint || typeof paint !== 'object') return null
  const list = paint.stops
  if (!Array.isArray(list) || list.length < 2 || list.length > STOPS_MAX) return null
  /** @type {NStop[]} */
  const stops = []
  for (const s of list) {
    if (!s || typeof s !== 'object' || !Number.isFinite(s.at)) return null
    const rgb = toRgb(s.color)
    if (!rgb) return null
    const o = s.opacity === undefined || s.opacity === null ? 1 : s.opacity
    if (!Number.isFinite(o)) return null
    stops.push({ at: clamp01(s.at), rgb: rgb.map(r4), a: clamp01(o) })
  }
  stops.sort((p, q) => p.at - q.at)
  const last = stops[stops.length - 1]
  let coords
  /** @type {'linear' | 'radial'} */
  let kind
  if (paint.kind === 'linear') {
    const { x1, y1, x2, y2 } = paint
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null
    if (x1 === x2 && y1 === y2) return solid(last)
    kind = 'linear'
    coords = [r4(x1), r4(y1), r4(x2), r4(y2)]
  } else if (paint.kind === 'radial') {
    const { cx, cy, r } = paint
    if (![cx, cy, r].every(Number.isFinite)) return null
    if (!(r > 0)) return solid(last)
    let fx = paint.fx === undefined || paint.fx === null ? cx : paint.fx
    let fy = paint.fy === undefined || paint.fy === null ? cy : paint.fy
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null
    // 焦点が円の外だと円錐になって形が欠ける。縁の少し内側に寄せる(SVG も同じ)
    const dist = sqrt((fx - cx) * (fx - cx) + (fy - cy) * (fy - cy))
    if (dist > 0.99 * r) {
      const k = (0.99 * r) / dist
      fx = cx + (fx - cx) * k
      fy = cy + (fy - cy) * k
    }
    kind = 'radial'
    coords = [r4(cx), r4(cy), r4(r), r4(fx), r4(fy)]
  } else return null
  const first = stops[0].a
  let same = true
  let opaque = true
  for (const s of stops) {
    if (abs(s.a - first) > 1e-6) same = false
    if (s.a < 1 - 1e-6) opaque = false
  }
  const alpha = opaque ? 'none' : same ? 'uniform' : 'varying'
  const key = JSON.stringify([kind, coords, stops.map((s) => [r4(s.at), s.rgb, r4(s.a)])])
  return { kind, coords, stops, alpha, uniform: same ? first : 1, key }
}

/** @param {NStop} last @returns {NSolid} */
function solid(last) {
  return { kind: 'solid', rgb: last.rgb, alpha: last.a < 1 - 1e-6 ? 'uniform' : 'none', uniform: last.a, key: JSON.stringify(['solid', last.rgb, r4(last.a)]) }
}

/**
 * 0 と 1 まで止まりを延ばす。延ばさないと、最初の区間の関数が [0, at[1]] いっぱいに伸びて色の位置がずれる。
 * @param {NStop[]} stops @returns {NStop[]}
 */
function padStops(stops) {
  const out = stops.slice()
  if (out[0].at > 0) out.unshift({ ...out[0], at: 0 })
  if (out[out.length - 1].at < 1) out.push({ ...out[out.length - 1], at: 1 })
  return out
}

/**
 * 止まりから色(または灰色)の関数。2 つなら Type 2、それ以上は Type 2 の区間を Type 3 でつなぐ。
 * 同じ位置の 2 つの止まり(段差)は幅 0 の区間を捨てて、境目で色が跳ぶ形にする。
 * @param {any} ctx @param {NStop[]} stops @param {(s: NStop) => number[]} comps
 */
function functionRef(ctx, stops, comps) {
  /** @type {NStop[][]} */
  const segs = []
  for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1].at > stops[i].at) segs.push([stops[i], stops[i + 1]])
  const piece = (/** @type {NStop} */ a, /** @type {NStop} */ b) => ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: comps(a), C1: comps(b), N: 1 })
  if (segs.length === 0) {
    const c = comps(stops[stops.length - 1])
    return ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: c, C1: c, N: 1 }))
  }
  if (segs.length === 1) return ctx.register(piece(segs[0][0], segs[0][1]))
  const fns = []
  const bounds = []
  const enc = []
  segs.forEach(([a, b], i) => {
    fns.push(piece(a, b))
    enc.push(0, 1)
    if (i > 0) bounds.push(a.at)
  })
  return ctx.register(ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: fns, Bounds: bounds, Encode: enc }))
}

/** 座標は頁の左上が原点(y は下向き)。PDF の左下原点へは H - y で直す */
function shadingRef(/** @type {any} */ ctx, /** @type {NGradient} */ np, /** @type {number} */ H, /** @type {string} */ cs, /** @type {any} */ fn) {
  const c = np.coords
  // 延ばす向き: 直線は両端、放射は外側だけ。これで形の中は必ず塗られ、色の外側は最後の止まりの色(SVG の pad)
  const dict = np.kind === 'linear'
    ? { ShadingType: 2, ColorSpace: cs, Coords: [c[0], r4(H - c[1]), c[2], r4(H - c[3])], Function: fn, Extend: [true, true] }
    : { ShadingType: 3, ColorSpace: cs, Coords: [c[3], r4(H - c[4]), 0, c[0], r4(H - c[1]), c[2]], Function: fn, Extend: [false, true] }
  return ctx.register(ctx.obj(dict))
}

/**
 * paint 1 つ分の PDF の物。流れは全部 register して参照で持つ(直に入れた流れは save7bit の 7 ビットの確かめに落ちる)。
 * 止まりの透明度が止まりごとに違う時だけ、同じ形の灰色の Shading を描く Form(輝度のソフトマスクの元)も作る。
 * Why not: 透明度を色の関数に混ぜる案は選ばなかった。PDF の Shading の色に α の成分は無い。
 * @param {any} ctx @param {NGradient} np @param {number} W @param {number} H
 * @returns {{ patRef: any, shRef: any, maskRef: any | null, bc: number }}
 */
export function buildPaint(ctx, np, W, H) {
  const stops = padStops(np.stops)
  const shRef = shadingRef(ctx, np, H, 'DeviceRGB', functionRef(ctx, stops, (s) => s.rgb))
  const patRef = ctx.register(ctx.obj({ Type: 'Pattern', PatternType: 2, Shading: shRef }))
  let maskRef = null
  if (np.alpha === 'varying') {
    const gray = shadingRef(ctx, np, H, 'DeviceGray', functionRef(ctx, stops, (s) => [r4(s.a)]))
    // BBox は頁全体。Mask の既定の背景は黒で、BBox の外と Shading の外は透明になるため、頁より小さく切ると塗りが消える
    maskRef = ctx.register(ctx.flateStream('/Sm sh', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H], Group: { S: 'Transparency', CS: 'DeviceGray', I: true }, Resources: { Shading: { Sm: gray } },
    }))
  }
  return { patRef, shRef, maskRef, bc: r4(stops[stops.length - 1].a) }
}

// ---------------------------------------------------------------- 角丸の path

/**
 * 角丸の四角を PDF の m l c h の列にする。(x, y) は左上・y は下向きで、H で裏返す。r は呼ぶ側が min(w, h)/2 以下にしておく。
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r @param {number} H @param {(v: number) => string} n
 */
export function roundedRectPath(x, y, w, h, r, H, n) {
  const k = KAPPA * r
  const Y = (/** @type {number} */ v) => n(H - v)
  const b = y + h
  return [
    `${n(x + r)} ${Y(y)} m`, `${n(x + w - r)} ${Y(y)} l`,
    `${n(x + w - r + k)} ${Y(y)} ${n(x + w)} ${Y(y + r - k)} ${n(x + w)} ${Y(y + r)} c`,
    `${n(x + w)} ${Y(b - r)} l`,
    `${n(x + w)} ${Y(b - r + k)} ${n(x + w - r + k)} ${Y(b)} ${n(x + w - r)} ${Y(b)} c`,
    `${n(x + r)} ${Y(b)} l`,
    `${n(x + r - k)} ${Y(b)} ${n(x)} ${Y(b - r + k)} ${n(x)} ${Y(b - r)} c`,
    `${n(x)} ${Y(y + r)} l`,
    `${n(x)} ${Y(y + r - k)} ${n(x + r - k)} ${Y(y)} ${n(x + r)} ${Y(y)} c`,
    'h',
  ].join('\n')
}

// ---------------------------------------------------------------- 影

/**
 * 影の画素。角丸の四角の α(距離関数で縁を 1 画素なめらかに)を描き、箱ぼかし 3 回で σ = blur / 2 のガウスに近づける。
 * σ = blur / 2 は CSS の box-shadow の約束(blur は 2σ)。SVG の feDropShadow に直すなら stdDeviation = blur / 2、読むなら blur = 2 × stdDeviation。
 * Why not: 真のガウスのたたみ込みは選ばなかった。箱ぼかしは画素数に比例(σ に依らない)で 10 倍速く、差は 255 段階で 2〜3。
 * 画素の密度は σ が 3pt 以上なら 1 画素/pt、それより鋭い影は 2 画素/pt。どちらも 100 万画素を超えない所まで下げる。
 * @param {number} w @param {number} h @param {number} r 角丸の半径 pt(0 以上)@param {number} blur pt
 * @returns {{ iw: number, ih: number, sc: number, wpt: number, hpt: number, alpha: Uint8Array }}
 */
export function shadowRaster(w, h, r, blur) {
  const sigma = min(max(blur, 0), BLUR_MAX) / 2
  const pad = ceil(sigma * 3) + 2
  const bw = w + 2 * pad
  const bh = h + 2 * pad
  let sc = sigma >= 3 ? 1 : 2
  let iw = max(1, ceil(bw * sc))
  let ih = max(1, ceil(bh * sc))
  while (iw * ih > SHADOW_PX_MAX) {
    sc *= min(0.97, sqrt(SHADOW_PX_MAX / (iw * ih)))
    iw = max(1, ceil(bw * sc))
    ih = max(1, ceil(bh * sc))
  }
  const cov = new Float32Array(iw * ih)
  const hx = (w * sc) / 2
  const hy = (h * sc) / 2
  const rp = min(max(r, 0), w / 2, h / 2) * sc
  const ex = hx - rp
  const ey = hy - rp
  const ox = iw / 2
  const oy = ih / 2
  for (let py = 0; py < ih; py++) {
    const qy = abs(py + 0.5 - oy) - ey
    const my = qy > 0 ? qy : 0
    const o = py * iw
    for (let px = 0; px < iw; px++) {
      const qx = abs(px + 0.5 - ox) - ex
      const mx = qx > 0 ? qx : 0
      const inner = qx > qy ? qx : qy
      const d = sqrt(mx * mx + my * my) + (inner < 0 ? inner : 0) - rp
      const c = 0.5 - d
      cov[o + px] = c <= 0 ? 0 : c >= 1 ? 1 : c
    }
  }
  const blurred = boxBlur3(cov, iw, ih, sigma * sc)
  const alpha = new Uint8Array(iw * ih)
  for (let i = 0; i < alpha.length; i++) alpha[i] = round(blurred[i] * 255)
  return { iw, ih, sc, wpt: iw / sc, hpt: ih / sc, alpha }
}

/** 3 回の箱ぼかしの半径(Kutskir の boxesForGauss)。標準偏差が σ に近づくよう、幅 wl と wu(= wl + 2)を混ぜる */
export function boxRadii(/** @type {number} */ sigma) {
  const n = 3
  const ideal = sqrt((12 * sigma * sigma) / n + 1)
  let wl = floor(ideal)
  if (wl % 2 === 0) wl -= 1
  const wu = wl + 2
  const m = round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  const out = []
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2)
  return out
}

/** @param {Float32Array} src @param {number} w @param {number} h @param {number} sigma 画素 */
function boxBlur3(src, w, h, sigma) {
  if (!(sigma >= 0.3)) return src
  const radii = boxRadii(sigma)
  let a = src
  let b = new Float32Array(w * h)
  for (const r of radii) {
    if (r <= 0) continue
    boxH(a, b, w, h, r)
    const t = a; a = b; b = t
  }
  for (const r of radii) {
    if (r <= 0) continue
    boxV(a, b, w, h, r)
    const t = a; a = b; b = t
  }
  return a
}

/** 画素の外は 0 として、幅 2r+1 の移動平均(走査の合計を足し引きするので r に依らず画素数に比例) */
function boxH(/** @type {Float32Array} */ src, /** @type {Float32Array} */ dst, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ r) {
  const inv = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const o = y * w
    let acc = 0
    for (let x = 0; x < r && x < w; x++) acc += src[o + x]
    for (let x = 0; x < w; x++) {
      if (x + r < w) acc += src[o + x + r]
      if (x - r - 1 >= 0) acc -= src[o + x - r - 1]
      dst[o + x] = acc * inv
    }
  }
}

function boxV(/** @type {Float32Array} */ src, /** @type {Float32Array} */ dst, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ r) {
  const inv = 1 / (2 * r + 1)
  const acc = new Float64Array(w)
  for (let y = 0; y < r && y < h; y++) {
    const b = y * w
    for (let x = 0; x < w; x++) acc[x] += src[b + x]
  }
  for (let y = 0; y < h; y++) {
    if (y + r < h) {
      const b = (y + r) * w
      for (let x = 0; x < w; x++) acc[x] += src[b + x]
    }
    if (y - r - 1 >= 0) {
      const b = (y - r - 1) * w
      for (let x = 0; x < w; x++) acc[x] -= src[b + x]
    }
    const o = y * w
    for (let x = 0; x < w; x++) dst[o + x] = acc[x] * inv
  }
}

/**
 * 影の画素を、SMask つきの Image XObject にする。下地の画像は影の色の一色で、α は SMask(灰色の画像)。
 * 不透明度は α に掛けずに、描く側の gs(ca)で掛ける。8 ビットの α が薄い影で荒れない。
 * Why not: 下地を 1×1 にして SMask だけ大きくする案は選ばなかった。仕様上は通るが、ビューアーごとの拡大の扱いに頼ることになる。
 * 一色の下地は deflate でほぼ消えるので、同じ大きさにしても PDF は膨らまない。
 * @param {any} ctx @param {{ iw: number, ih: number, alpha: Uint8Array }} ras @param {number[]} rgb 0〜1
 */
export function shadowImage(ctx, ras, rgb) {
  const px = ras.iw * ras.ih
  const sm = ctx.register(ctx.flateStream(ras.alpha, {
    Type: 'XObject', Subtype: 'Image', Width: ras.iw, Height: ras.ih, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Interpolate: true,
  }))
  const base = new Uint8Array(px * 3)
  const r8 = round(rgb[0] * 255)
  const g8 = round(rgb[1] * 255)
  const b8 = round(rgb[2] * 255)
  if (r8 === g8 && g8 === b8) base.fill(r8)
  else for (let i = 0; i < base.length; i += 3) { base[i] = r8; base[i + 1] = g8; base[i + 2] = b8 }
  return ctx.register(ctx.flateStream(base, {
    Type: 'XObject', Subtype: 'Image', Width: ras.iw, Height: ras.ih, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Interpolate: true, SMask: sm,
  }))
}
