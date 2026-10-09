// 出典: C:/dev/modscode の vendor-src/d3-entry.mjs（本人の look Mod の hooks/vendor/d3.mjs と同じ入口）。名前を並べて esbuild に不要な物を落とさせる。
// 選ばなかった案: d3 全部を入れる案（d3-selection・d3-dsv などは DOM と new Function を要り、フックの環境で動かない）。
// The d3 names the look designs may import from hooks/vendor/d3.mjs. Listing them by name lets
// esbuild drop the rest. Left out on purpose: d3-selection, transition, zoom, brush, drag and axis
// (they need a DOM), d3-dsv (csvParse builds a new Function), d3-geo (bake its paths at build time),
// and the time scales (a design never reads the clock).
export { bin, extent, max, min, sum, mean, median, quantile, quantileSorted, deviation, variance, range, ticks, tickStep, nice, bisector, group, rollup, rollups, groups, cumsum, least, greatest, pairs, zip, shuffler } from 'd3-array'
export { path } from 'd3-path'
export {
  arc, area, line, pie, stack, lineRadial, areaRadial, link, linkHorizontal, linkVertical, linkRadial, symbol,
  symbolCircle, symbolSquare, symbolTriangle, symbolDiamond, symbolCross, symbolStar, symbolWye, symbolsFill,
  stackOffsetNone, stackOffsetExpand, stackOffsetSilhouette, stackOffsetWiggle, stackOffsetDiverging,
  stackOrderNone, stackOrderAscending, stackOrderDescending, stackOrderInsideOut, stackOrderReverse,
  curveLinear, curveLinearClosed, curveMonotoneX, curveMonotoneY, curveStep, curveStepAfter, curveStepBefore,
  curveBasis, curveBasisClosed, curveBumpX, curveBumpY, curveCardinal, curveCardinalClosed, curveCatmullRom,
  curveCatmullRomClosed, curveNatural,
} from 'd3-shape'
export { hierarchy, stratify, treemap, treemapSquarify, treemapBinary, treemapSlice, treemapDice, treemapSliceDice, treemapResquarify, partition, pack, packSiblings, packEnclose, tree, cluster } from 'd3-hierarchy'
export { chord, chordDirected, chordTranspose, ribbon, ribbonArrow } from 'd3-chord'
export { sankey, sankeyLinkHorizontal, sankeyLeft, sankeyRight, sankeyCenter, sankeyJustify } from 'd3-sankey'
export { hexbin } from 'd3-hexbin'
export { contours, contourDensity } from 'd3-contour'
export { Delaunay, Voronoi } from 'd3-delaunay'
export { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY, forceRadial } from 'd3-force'
export { quadtree } from 'd3-quadtree'
export { polygonHull, polygonCentroid, polygonArea, polygonContains, polygonLength } from 'd3-polygon'
export { randomLcg, randomUniform, randomInt, randomNormal, randomLogNormal, randomExponential, randomBates, randomIrwinHall, randomPoisson, randomBinomial } from 'd3-random'
export { scaleLinear, scaleSqrt, scalePow, scaleLog, scaleSymlog, scaleBand, scalePoint, scaleQuantize, scaleQuantile, scaleThreshold, scaleOrdinal } from 'd3-scale'
export { interpolateNumber, interpolateRound } from 'd3-interpolate'
export { format, formatPrefix, precisionFixed } from 'd3-format'
