// @ts-check
// 組版の入口: 道具の引数 → Doc → 頁（Layout）。本体（hooks/mods-pdf.mjs）はここだけを呼ぶ。
import { normalize } from './schema.mjs'
import { makeTheme } from './theme.mjs'
import { layoutDoc } from './layout.mjs'
import { inspectLayout, summarizeChecks } from './inspect.mjs'

/** 組版で使う書体の名前（fonts.mjs の FONT_FILES と同じ並び） */
export const FONT_IDS = ['mincho', 'minchoBold', 'sans', 'sansBold']

/**
 * normalize → makeTheme → layoutDoc → inspectLayout を 1 つに。warnings は検査と組版のものをつなぎ、同じ文は 1 回だけ。
 * 検査の件数は layout.meta.checks（{ overlaps, outside, truncated, sparse }）に入れ、見つけた物は warnings に文で足す。
 * 投げるのは title が無い時だけ（normalize の約束）。
 * logos は { 'NYSE:IBM': svgText }（hooks/lib/logos.mjs の loadLogos の答え）。組版の側は中身を見ず、素通しする。
 * @param {unknown} input 道具 make の引数
 * @param {{ metrics: Record<string, any>, images?: Record<string, any>, phrase?: (text: string) => number[], now?: number, logos?: Record<string, string> }} o
 * checks は検査の件数と文（warnings の中にも同じ文が入る。答えで分けて出すために別に返す）。
 * @returns {{ layout: any, warnings: string[], checks: { counts: { overlaps: number, outside: number, truncated: number, sparse: number }, warnings: string[] } }}
 */
export function compose(input, { metrics, images = {}, phrase, now, logos }) {
  const { doc, warnings: first } = normalize(input)
  const deck = doc.kind === 'deck'
  // 資料の向き・色の既定（A4 は横・vivid）は schema が決めて doc に入れている。ここでは写すだけ
  const theme = makeTheme({ kind: deck ? 'deck' : 'doc', theme: doc.theme, body: doc.body, paper: doc.paper, landscape: doc.landscape, size: doc.size })
  const layout = layoutDoc(doc, { metrics, theme, images, phrase, now, logos })
  const checked = summarizeChecks(inspectLayout(layout, { metrics }))
  layout.meta.checks = checked.counts
  /** @type {string[]} */
  const warnings = []
  for (const w of [...first, ...layout.warnings, ...checked.warnings]) if (!warnings.includes(w)) warnings.push(w)
  return { layout, warnings, checks: checked }
}
