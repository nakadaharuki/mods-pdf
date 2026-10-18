// @ts-check
// compare の束: 比べ（radar・dumbbell・lollipop・parallel-coords・slope）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の compare の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import radar from './radar.mjs'
import dumbbell from './dumbbell.mjs'
import lollipop from './lollipop.mjs'
import parallelCoords from './parallel-coords.mjs'
import slope from './slope.mjs'

export default [radar, dumbbell, lollipop, parallelCoords, slope]
