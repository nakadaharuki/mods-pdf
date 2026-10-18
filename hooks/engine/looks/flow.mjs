// @ts-check
// flow の束: 流れ（chord・dendrogram・force-graph・sankey）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の flow の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import chord from './chord.mjs'
import dendrogram from './dendrogram.mjs'
import forceGraph from './force-graph.mjs'
import sankey from './sankey.mjs'

export default [chord, dendrogram, forceGraph, sankey]
