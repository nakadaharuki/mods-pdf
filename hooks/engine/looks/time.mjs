// @ts-check
// time の束: 時系列の形（candle・sparks・bars・area-threshold・bump・multi-line・stacked-area・step-line・streamgraph）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の time の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
// time-series.mjs は形ではなく、時系列の形が共有する部品（LOOKS には入らない）。
import candle from './candle.mjs'
import sparks from './sparks.mjs'
import bars from './bars.mjs'
import areaThreshold from './area-threshold.mjs'
import bump from './bump.mjs'
import multiLine from './multi-line.mjs'
import stackedArea from './stacked-area.mjs'
import stepLine from './step-line.mjs'
import streamgraph from './streamgraph.mjs'

export default [candle, sparks, bars, areaThreshold, bump, multiLine, stackedArea, stepLine, streamgraph]
