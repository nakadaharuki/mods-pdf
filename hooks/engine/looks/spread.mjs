// @ts-check
// spread の束: 分布と点（box-plot・contour・hexbin・histogram・ridgeline・scatter・violin）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の spread の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import boxPlot from './box-plot.mjs'
import contour from './contour.mjs'
import hexbin from './hexbin.mjs'
import histogram from './histogram.mjs'
import ridgeline from './ridgeline.mjs'
import scatter from './scatter.mjs'
import violin from './violin.mjs'

export default [boxPlot, contour, hexbin, histogram, ridgeline, scatter, violin]
