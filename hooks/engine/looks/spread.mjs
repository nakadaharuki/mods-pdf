// @ts-check
// spread の束: 分布と点（box-plot・contour・hexbin・histogram・ridgeline・scatter・violin）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の spread の形（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import boxPlot from './box-plot.mjs'
import contour from './contour.mjs'
import hexbin from './hexbin.mjs'
import histogram from './histogram.mjs'
import ridgeline from './ridgeline.mjs'
import scatter from './scatter.mjs'
import violin from './violin.mjs'

export default [boxPlot, contour, hexbin, histogram, ridgeline, scatter, violin]
