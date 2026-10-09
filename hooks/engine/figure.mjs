// @ts-check
// 図の Block（chart の kind と option・svg・image）を、決めた箱に描く Op にする。文書（lay-blocks）と資料（lay-slide）の共通の入口。純な部品。
//
// 選ばなかった案:
//   - 高さを知るためだけに、まず y = 0 で描いて捨てる案: look の svg は描くのが先でないと自然な高さが出ない。
//     planFigure が svg の字を持ったまま高さを返し、draw(x, y) は置く場所が決まってから svgToOps を 1 回だけ呼ぶ（組版の途中で Op を作らない決まり）。
//   - look の svg を ClipOp で包む案: svgToOps が「四角からはみ出す時だけ」包む。二重に包むと文書の Op の形が変わる。ECharts（chartToOps）は今までどおり 1 つの ClipOp。
//   - kind と option が両方ある時に option へ寄せる案: kind は「紙の決まりに揃えた形」を呼ぶ明示の指定なので kind を取り、option は使わない（schema が警告する）。
//   - 字が重なった時に、look の側で字を小さくする・間引く案: 形ごとに直す所が増える。並べるだけの形（項目を落としても合計が変わらない物）は、描いた結果を inspectSvg で見て、後ろの項目を 1 つずつ落として描き直す。
//     合計が変わる形（waterfall・donut・treemap・sankey・pnl など）は落とさない。減らした時の注は、呼び出し側の caption に足す案ではなく図の箱の下の細い帯に自分で描く（文書と資料のどちらも同じ入口を使うので、呼ぶ側を直さずに済む）。
//   - 落とす前の全部の描きを捨てて 1 つずつ試す案の回数: 項目が多い図は何十回も描き直す。試すのは 8 回まで（10 秒のフックを守る）。
//   - 問題が少し減った所で止める案: 名前が長い図は「…」が項目の数に比例するので、落とすたびに少しずつ減り、半分まで削っても直らない。
//     問題が 0 になった時だけ採り、直らなければ全部を描いて、残った問題は inspectLayout が数える。項目は図の下限の半分（3 つ以上）までしか落とさない。
//   - 細い図を、look の自然な高さで描き直して中央に置く案: 形は箱の高さで内側の余白を決めるので、箱の高さで描いたまま、描いた物の上下の範囲を測って動かす方が形の決まりを壊さない。
//   - kind の存在をここで確かめて option に落とす案: drawLook が知らない id でも投げず、使える種類を警告に書いて空の図を返す。落とすと原稿の誤りが見えなくなる。

import { chartBlockToOps } from './chart.mjs'
import { svgToOps } from './svg.mjs'
import { drawLook, LOOKS } from './looks/index.mjs'
import { inspectSvg } from './inspect.mjs'
import { lookPal } from './theme.mjs'

/** @typedef {{ t: string, [key: string]: any }} Op */
/** @typedef {any} FigureBlock chart | svg | image の Block（schema.mjs の Block） */
/** @typedef {{ colors: Record<string, any>, scale?: number, kind?: string, name?: string }} FigureTheme kind が 'deck' なら資料（図の字の下限を 9pt にする） */
/**
 * @typedef {{
 *   height: number, alt: string, warnings: string[], trim?: { kept: number, total: number, label: string },
 *   draw: (x: number, y: number) => { ops: Op[], warnings: string[] },
 * }} FigurePlan
 */

/** 高さが読めない svg・option の図は、幅のこの倍（今までの図と同じ） */
const DEFAULT_RATIO = 0.5
/** viewBox の比から出す高さの下限（pt） */
const MIN_HEIGHT = 24

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {v is number} 0 より大きい有限の数 */
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * SVG の縦横比（高さ / 幅）。viewBox を先に、無ければ数値の width・height を見る。読めなければ null。
 * 選ばなかった案: 高さを常に幅の 0.5 倍にする設計書どおりの案。横長の図（流れ図）は viewBox の上下が空白になり、頁に大きな穴が開いた。
 * @param {unknown} source
 * @returns {number | null}
 */
export function svgAspect(source) {
  const open = String(source).match(/<svg\b[^>]*>/i)
  if (!open) return null
  const num = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)'
  const vb = open[0].match(new RegExp(`\\bviewBox\\s*=\\s*["']\\s*${num}[\\s,]+${num}[\\s,]+${num}[\\s,]+${num}\\s*["']`, 'i'))
  let w = vb ? Number(vb[3]) : NaN
  let h = vb ? Number(vb[4]) : NaN
  if (!(w > 0 && h > 0)) {
    const wa = open[0].match(new RegExp(`\\swidth\\s*=\\s*["']\\s*${num}(?:px)?\\s*["']`, 'i'))
    const ha = open[0].match(new RegExp(`\\sheight\\s*=\\s*["']\\s*${num}(?:px)?\\s*["']`, 'i'))
    w = wa ? Number(wa[1]) : NaN
    h = ha ? Number(ha[1]) : NaN
  }
  return w > 0 && h > 0 ? h / w : null
}

/**
 * 図の読み上げ用の字（Figure の Alt）。chart は alt → caption → look の名前 → 「グラフ」、svg・image は alt → 「図」。
 * @param {FigureBlock} b
 * @returns {string}
 */
export function figureAlt(b) {
  if (!b || typeof b !== 'object') return '図'
  if (b.type === 'chart') {
    if (typeof b.alt === 'string' && b.alt) return b.alt
    if (typeof b.caption === 'string' && b.caption) return b.caption
    if (typeof b.kind === 'string' && Object.prototype.hasOwnProperty.call(LOOKS, b.kind)) return LOOKS[b.kind].title
    return 'グラフ'
  }
  return typeof b.alt === 'string' && b.alt ? b.alt : '図'
}

/** 描いた svg の「字が切れた・折り返した」の目安: 「…」の数と <text> の数の合計（折り返すと <text> が増える） @param {string} svg */
const strain = (svg) => (svg.match(/…|<text[\s>]/g) ?? []).length

/** 資料の図で、look の字の大きさの下限（pt）。紙の文書は look が決めた大きさのまま。7pt を割らない決まりの上に 0.5pt 足した（詰めた panel の中で読める最小） */
const DECK_TEXT_MIN = 7.5
/** 減らした時の注の字の大きさの下限（pt）。7pt を割らない */
const NOTE_SIZE = 7.5
/** 項目を落として描き直す回数の上限 */
const MAX_TRIALS = 8
/** 描いた物の上下の幅が箱のこの割合に満たなければ、箱の縦の中央に置く */
const THIN_BELOW = 0.5

/**
 * 並べるだけの形（項目を落としても、残りの見え方が変わらない物）の、落とせる所。合計や割合が変わる形はここに入れない。
 * 'x' は時間や順序の軸で、後ろを落とすと「直近」を失うので注の言い方が違う。
 * @type {Record<string, 'items' | 'series' | 'x'>}
 */
const TRIM_BY = {
  bars: 'x', lollipop: 'items', bullet: 'items', tiles: 'items', gauge: 'items', 'progress-rings': 'items', dumbbell: 'items', slope: 'items', funnel: 'items',
  sparks: 'series', bump: 'series',
}

/**
 * 後ろから k 個に減らした data。元の data は書き換えない（planFigure は 1 つの図で何度も呼ばれる）。
 * @param {Record<string, any>} data @param {string} kind
 * @returns {{ total: number, label: string, cut: (k: number) => Record<string, any> } | null}
 */
export function trimmer(data, kind) {
  const by = Object.prototype.hasOwnProperty.call(TRIM_BY, kind) ? TRIM_BY[kind] : undefined
  if (by === 'x' && Array.isArray(data.items)) return trimmer(data, 'lollipop')
  if (by === 'items' && Array.isArray(data.items)) return { total: data.items.length, label: '上位', cut: (k) => ({ ...data, items: data.items.slice(0, k) }) }
  if (by === 'series' && Array.isArray(data.series)) return { total: data.series.length, label: '上位', cut: (k) => ({ ...data, series: data.series.slice(0, k) }) }
  if (by === 'x' && Array.isArray(data.x) && Array.isArray(data.series)) {
    return {
      total: data.x.length, label: '先頭',
      cut: (k) => ({ ...data, x: data.x.slice(0, k), series: data.series.map((/** @type {any} */ s) => (s && Array.isArray(s.values) ? { ...s, values: s.values.slice(0, k) } : s)) }),
    }
  }
  return null
}

/** 減らした時の注（右寄せの細い帯）の SVG @param {string} text @param {number} w @param {number} h @param {number} size @param {string} color */
const noteSvg = (text, w, h, size, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><text x="${w}" y="${Math.round(size * 1.15 * 10) / 10}" font-family="Noto Sans JP" font-size="${size}" fill="${color}" text-anchor="end">${text}</text></svg>`

/** 検査の問題の数 @param {{ overlaps: unknown[], outside: unknown[], truncated: unknown[] } | null} c */
const problems = (c) => (c ? c.overlaps.length + c.outside.length + c.truncated.length : 0)

/**
 * 図を置く箱の中身を決める。高さが分かり、描く物（Op）は draw(x, y) を呼ぶまで作らない。
 * height を渡せばその箱に収める（look と svg と option はその高さ、image は縦横比を保って収まる大きさ）。無ければ自然な高さ。
 * 描けない時も投げず、空の Op と warnings を返す。
 * @param {FigureBlock} block
 * zoom（既定 1）は look だけに効く。幅 ÷ zoom・高さ ÷ zoom で描いた図を zoom 倍に写す。字・線・余白が zoom 倍になり、箱の大きさは変わらない（資料で look の字を大きく読ませる）。
 * ただし拡大すると描く幅が狭くなり、横に長い図（flowchart・process など）は字を「…」で切ったり折り返したりする。
 * 拡大して描いた図が、拡大しない図より「…」か字の行を増やす時は、半分の拡大、それでも増えるなら拡大しない（zoom 1）にする。
 * 選ばなかった案:
 *   - look ごとに資料用の字の大きさを持たせる案。56 形すべてに第 2 の組を持つことになり、直す所が倍になる。
 *   - 図の縦横比（細長い形は zoom 1）で決める案。細長くても項目が少なければ拡大して収まり、項目が多ければ縦横比が似ていても切れる。切れたかどうかを描いた結果で見る方が確かで、形を足しても直す所が増えない。
 * @param {{ width: number, height?: number, metrics?: Record<string, any>, theme: FigureTheme, images?: Record<string, any>, lang?: string, zoom?: number }} o
 * @returns {FigurePlan}
 */
export function planFigure(block, { width, height, metrics, theme, images, lang, zoom }) {
  const W = width
  const ink = theme.colors.ink
  const paper = theme.colors.paper
  /** @type {string[]} */
  const warnings = []
  const alt = figureAlt(block)
  const asked = positive(height) ? height : positive(block && block.height) ? block.height : undefined

  if (!block || typeof block !== 'object') {
    warnings.push('図の Block がオブジェクトではないので描きません')
    return { height: asked ?? W * DEFAULT_RATIO, alt, warnings, draw: () => ({ ops: [], warnings: [] }) }
  }

  if (block.type === 'chart' && typeof block.kind === 'string') {
    if (!isObj(block.data)) {
      warnings.push(block.dataset !== undefined
        ? `図の dataset "${String(block.dataset).slice(0, 40)}" が data になっていないので描きません`
        : `図 ${JSON.stringify(block.kind.slice(0, 40))} に data が無いので描きません`)
    }
    const data = isObj(block.data) ? block.data : {}
    const pal = lookPal(theme)
    const kind = block.kind
    const textMin = theme.kind === 'deck' ? DECK_TEXT_MIN : undefined
    const noteSize = Math.max(NOTE_SIZE, textMin ?? 0)
    const noteH = Math.round(noteSize * 1.6 * 10) / 10
    // textMin は紙の上の pt。拡大して描くと k 倍に写るので、形には 1/k で渡す
    const at = (/** @type {Record<string, any>} */ d, /** @type {number | undefined} */ box, /** @type {number} */ k) =>
      drawLook(kind, d, { width: W / k, height: box === undefined ? undefined : box / k, pal, lang, textMin: textMin === undefined ? undefined : textMin / k })
    const seen = (/** @type {{ svg: string, height: number }} */ r, /** @type {number} */ k) => (metrics ? inspectSvg(r.svg, { width: W, height: r.height * k, metrics }) : null)

    let z = 1
    let r = at(data, asked, 1)
    if (positive(zoom) && zoom > 1) {
      const base = strain(r.svg)
      for (const k of [zoom, 1 + (zoom - 1) / 2]) {
        const t = at(data, asked, k)
        if (strain(t.svg) <= base) { z = k; r = t; break }
      }
    }
    let found = seen(r, z)

    // 字の重なり・はみ出し・「…」が出たら、並べるだけの形に限り、後ろの項目を 1 つずつ落として描き直す
    /** @type {{ kept: number, total: number, label: string } | undefined} */
    let trim
    const cut = problems(found) > 0 ? trimmer(data, kind) : null
    if (cut && found) {
      const floor = Math.min(cut.total, Math.max(3, Math.ceil(cut.total / 2)))
      const box = asked === undefined ? undefined : Math.max(MIN_HEIGHT, asked - noteH)
      for (let k = cut.total - 1, n = 0; k >= floor && n < MAX_TRIALS; k--, n++) {
        const t = at(cut.cut(k), box, z)
        const c = seen(t, z)
        if (problems(c) === 0) {
          r = t
          found = c
          trim = { kept: k, total: cut.total, label: cut.label }
          break
        }
      }
      if (trim) warnings.push(`図「${LOOKS[kind]?.title ?? kind}」は字が重なるか収まらないので、${trim.label} ${trim.kept} / ${trim.total} に減らして描きました`)
    }
    for (const m of r.warnings) warnings.push(m)

    const lookH = r.height * z
    const noteText = trim ? `${trim.label} ${trim.kept} / ${trim.total}` : ''
    const h = lookH + (trim ? noteH : 0)
    // 箱が高く、描いた物の上下の幅が箱の半分に満たない細い図は、箱の縦の中央に置く
    let shift = 0
    const bb = found && found.bounds
    if (asked !== undefined && bb && bb.y1 - bb.y0 < THIN_BELOW * lookH) {
      const to = (lookH - (bb.y1 - bb.y0)) / 2 - bb.y0
      if (to > 1) shift = to
    }
    return {
      height: h, alt, warnings, trim,
      draw: (x, y) => {
        const o = svgToOps(r.svg, { x, y: y + shift, width: W, height: lookH, metrics, color: ink, paper })
        const ops = o.ops
        const out = [...o.warnings]
        if (trim) {
          const n = svgToOps(noteSvg(noteText, W, noteH, noteSize, pal.sub), { x, y: y + h - noteH, width: W, height: noteH, metrics, color: ink, paper })
          for (const op of n.ops) ops.push(op)
          for (const m of n.warnings) out.push(m)
        }
        return { ops, warnings: out }
      },
    }
  }

  if (block.type === 'chart') {
    const h = asked ?? W * DEFAULT_RATIO
    return {
      height: h, alt, warnings,
      draw: (x, y) => {
        const r = chartBlockToOps(block, { x, y, width: W, height: h, metrics, theme, textMin: theme.kind === 'deck' ? DECK_TEXT_MIN : undefined })
        return { ops: r.ops, warnings: r.warnings }
      },
    }
  }

  if (block.type === 'svg') {
    const aspect = svgAspect(block.source)
    const h = asked ?? (aspect ? Math.max(MIN_HEIGHT, W * aspect) : W * DEFAULT_RATIO)
    return {
      height: h, alt, warnings,
      draw: (x, y) => {
        const r = svgToOps(block.source, { x, y, width: W, height: h, metrics, color: ink, paper })
        return { ops: r.ops, warnings: r.warnings }
      },
    }
  }

  if (block.type === 'image') {
    const im = images ? images[block.path] : undefined
    if (im && im.width > 0 && im.height > 0 && typeof im.base64 === 'string') {
      let w = Math.min(positive(block.width) ? block.width : W, W)
      let h = (w * im.height) / im.width
      // 箱が決まっていれば、縦横比を保ったまま収める
      if (positive(height) && h > height) {
        w = (height * im.width) / im.height
        h = height
      }
      return {
        height: h, alt, warnings,
        draw: (x, y) => ({ ops: [{ t: 'image', x: x + (W - w) / 2, y, w, h, kind: im.kind, base64: im.base64 }], warnings: [] }),
      }
    }
    warnings.push(`画像 ${String(block.path).slice(0, 80)} を読み込めなかったので灰色の四角にしました`)
  } else {
    warnings.push(`図の種類 ${String(block.type).slice(0, 20)} は描けないので灰色の四角にしました`)
  }
  const h = asked ?? W * DEFAULT_RATIO
  return {
    height: h, alt, warnings,
    draw: (x, y) => ({ ops: [{ t: 'rect', x, y, w: W, h, fill: theme.colors.tint, stroke: theme.colors.rule, lw: 0.5 }], warnings: [] }),
  }
}

/**
 * 図の Block を、決めた箱 (x, y, width) に描く Op にする。height を渡せばその箱に収め、無ければ自然な高さ（look の height(width)・viewBox の比・幅の半分）。
 * 返す height は使った高さ。alt は読み上げ用。
 * @param {FigureBlock} block
 * @param {{ x: number, y: number, width: number, height?: number, metrics?: Record<string, any>, theme: FigureTheme, images?: Record<string, any>, lang?: string, zoom?: number }} o
 * @returns {{ ops: Op[], warnings: string[], height: number, alt: string, trim?: { kept: number, total: number, label: string } }}
 */
export function figureOps(block, { x, y, width, height, metrics, theme, images, lang, zoom }) {
  const plan = planFigure(block, { width, height, metrics, theme, images, lang, zoom })
  const drawn = plan.draw(x, y)
  return { ops: drawn.ops, warnings: [...plan.warnings, ...drawn.warnings], height: plan.height, alt: plan.alt, trim: plan.trim }
}
