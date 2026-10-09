// @ts-check
// 組版の入口: 道具の引数 → Doc → 頁（Layout）。本体（hooks/mods-pdf.mjs）はここだけを呼ぶ。
import { normalize } from './schema.mjs'
import { makeTheme } from './theme.mjs'
import { layoutDoc } from './layout.mjs'

/** 組版で使う書体の名前（fonts.mjs の FONT_FILES と同じ並び） */
export const FONT_IDS = ['mincho', 'minchoBold', 'sans', 'sansBold']

/**
 * normalize → makeTheme → layoutDoc を 1 つに。warnings は検査と組版のものをつなぎ、同じ文は 1 回だけ。
 * 投げるのは title が無い時だけ（normalize の約束）。
 * @param {unknown} input 道具 make の引数
 * @param {{ metrics: Record<string, any>, images?: Record<string, any>, phrase?: (text: string) => number[], now?: number }} o
 * @returns {{ layout: any, warnings: string[] }}
 */
export function compose(input, { metrics, images = {}, phrase, now }) {
  const { doc, warnings: first } = normalize(input)
  const deck = doc.kind === 'deck'
  // 資料の向き・色の既定（A4 は横・vivid）は schema が決めて doc に入れている。ここでは写すだけ
  const theme = makeTheme({ kind: deck ? 'deck' : 'doc', theme: doc.theme, body: doc.body, paper: doc.paper, landscape: doc.landscape, size: doc.size })
  const layout = layoutDoc(doc, { metrics, theme, images, phrase, now })
  /** @type {string[]} */
  const warnings = []
  for (const w of [...first, ...layout.warnings]) if (!warnings.includes(w)) warnings.push(w)
  return { layout, warnings }
}
