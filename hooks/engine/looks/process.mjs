// @ts-check
// process（段階）: 左から右へ進む矢羽根の帯。番号は帯の上・名前と説明は帯の下に置き、帯の中に字を入れない（濃い面の上に置ける字の色が無いため）。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 決まり: 枠と軸の線なし・目立たせるのは 1 つだけ・字は 7.5・8・20pt の段・墨の割合は paper の ALPHA。
// - 矢羽根は墨の薄い坂（左が薄く、右へ少しずつ濃く）。目立たせる 1 つ（既定は最後の段）だけが、色のある紙では grad のグラデーション・mono では墨 100%。
// - 帯の高さは 34pt・矢の尖りは 14pt・羽根どうしの隙間は 3pt。説明は幅に合わせて折り返し、入る行数まで。
// 選ばなかった案
// - 帯の中に番号と名前を入れる案: 墨 100% やグラデーションの面の上に置ける字の色が pal に無い（字は ink・sub・accent・up・down だけ）。
// - 全部の羽根を 1 本のグラデーションで通す案: 目立たせる 1 つが無くなる。進み具合は薄い坂で見せ、グラデーションは最後の 1 つだけ。
import { TICK, LABEL, HUGE, inkFill, seriesFill, paints, chevron, fillPath, text, textLines, wrap, svgDoc, empty, clip, readNamed, hotIndex, ramp, wrapsTwoRows } from './paper.mjs'

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[] }} Pal */
/** @typedef {{ width: number, height: number, pal: Pal, lang: 'ja'|'en' }} DrawOpts */
/** @typedef {{ steps: { name: string, note: string }[], hot: number }} ProcessData */

const MAX_STEPS = 7
const BAND = 34
const NOTCH = 14
const GAP = 3
const MARGIN = 8

/**
 * @param {unknown} data { steps: { name, note? }[2..7], highlight?: 名前か 0 からの位置 }
 * @returns {{ data: ProcessData, warnings: string[] }}
 */
function normalize(data) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  const src = data && typeof data === 'object' ? data : {}
  const steps = readNamed(src.steps, '段階', 'steps', warnings, { min: 2, max: MAX_STEPS })
  const hot = steps.length ? hotIndex(src.highlight, steps.map((s) => s.name), steps.length - 1, warnings, '段階') : -1
  return { data: { steps, hot }, warnings }
}

/**
 * 並べ方と折り返し。roomH が有限なら、高さに合わせて説明の行数を決める（1 行は必ず残す）。無限なら 5 行まで全部（自然な高さを出す）
 * @param {ProcessData} data @param {number} W @param {number} roomH
 */
function plan(data, W, roomH, cols = data.steps.length) {
  const n = data.steps.length
  const pitch = (W - 2 * MARGIN - NOTCH + GAP) / cols
  const colW = Math.max(24, pitch - 10)
  const names = data.steps.map((s) => wrap(s.name, LABEL, colW, 2, true))
  const notes = data.steps.map((s) => (s.note ? wrap(s.note, TICK, colW, 5) : []))
  const nameRows = Math.max(1, ...names.map((l) => l.length))
  const fixed = 26 + BAND + 20 + (nameRows - 1) * 11
  const want = Math.max(0, ...notes.map((l) => l.length))
  const fit = Number.isFinite(roomH) ? Math.max(1, Math.floor((roomH - 12 - fixed - 4) / 11.5)) : 5
  const noteRows = Math.min(want, fit)
  return { n, cols, pitch, cw: pitch + NOTCH - GAP, colW, names, notes, nameRows, noteRows, need: fixed + (noteRows ? 4 + noteRows * 11.5 : 0) }
}

/** 1 行に並べた時の自然な高さ @param {ProcessData} data @param {number} width */
function naturalHeight(data, width) {
  return Math.max(Math.round(width * 0.3), data.steps.length >= 2 ? Math.ceil(plan(data, width, Infinity).need + 12) : 0)
}

/**
 * @param {ProcessData} data
 * @param {DrawOpts} o
 */
function draw(data, o) {
  const { width: W, height: H, pal } = o
  if (data.steps.length < 2) return empty(o)
  // 段が 5 つ以上で箱が自然な高さの 2 倍以上なら、前半・後半の 2 つの行に折り返す（幅が倍になり、名前を「…」で切らない）
  const two = wrapsTwoRows(data.steps.length, H, naturalHeight(data, W))
  const rowH = two ? H / 2 : H
  const { n, cols, pitch, cw, colW, names, notes, nameRows, noteRows, need } = plan(data, W, rowH, two ? Math.ceil(data.steps.length / 2) : data.steps.length)
  const g = paints(pal)

  /** @type {string[]} */
  const parts = []
  const soft = ramp(Math.max(1, n - 1), 0.1, 0.4)
  data.steps.forEach((_, i) => {
    const x = MARGIN + (i % cols) * pitch
    const row = two ? Math.floor(i / cols) : 0
    const top = row * rowH + Math.max(4, (rowH - need) / 2)
    const bandY = top + 26
    const isHot = i === data.hot
    const fill = isHot ? g.linear(x, bandY, x + cw, bandY, 1, 1) : seriesFill(pal, i, data.hot) ?? inkFill(pal, soft[Math.min(i, soft.length - 1)])
    parts.push(fillPath(chevron(x, bandY, cw, BAND, NOTCH, i % cols === 0), fill))
    parts.push(text(x, top + 16, String(i + 1).padStart(2, '0'), { size: HUGE, fill: isHot ? pal.accent : pal.sub }))
    parts.push(textLines(x, bandY + BAND + 16, names[i].map((l) => clip(l, LABEL, colW + 6, true)), { size: LABEL, fill: pal.ink, bold: true, leading: 11 }))
    if (noteRows) parts.push(textLines(x, bandY + BAND + 16 + (nameRows - 1) * 11 + 15, notes[i].slice(0, noteRows), { size: TICK, fill: pal.sub, leading: 11.5 }))
  })
  return svgDoc(W, H, g.defs() + parts.join(''))
}

/** 事業の立ち上げの段階（見本）。目立たせる 1 つは最後の「拡大」 */
function sample() {
  return {
    steps: [
      { name: '課題の把握', note: '10 社に話を聞き、困りごとを 3 つに絞る' },
      { name: '試作', note: '2 か月で動く試作版を作る' },
      { name: '検証', note: '5 社が実際の仕事で 1 か月使う' },
      { name: '導入', note: '有料版を始め、初期の 30 社を獲得する' },
      { name: '拡大', note: '紹介と提携で 100 社へ広げる' },
    ],
  }
}

export default {
  id: 'process',
  title: '段階（Process）',
  category: 'biz',
  normalize,
  draw,
  height: (/** @type {number} */ width, /** @type {any} */ data) => naturalHeight(data, width),
  sample,
}
