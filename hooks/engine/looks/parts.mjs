// @ts-check
// parts の束: 内訳と木（donut・treemap・circle-pack・funnel・icicle・polar-area・sunburst・waterfall）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の parts の形（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import donut from './donut.mjs'
import treemap from './treemap.mjs'
import circlePack from './circle-pack.mjs'
import funnel from './funnel.mjs'
import icicle from './icicle.mjs'
import polarArea from './polar-area.mjs'
import sunburst from './sunburst.mjs'
import waterfall from './waterfall.mjs'

export default [donut, treemap, circlePack, funnel, icicle, polarArea, sunburst, waterfall]
