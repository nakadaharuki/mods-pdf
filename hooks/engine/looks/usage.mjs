// @ts-check
// usage の束: 量（gauge・tiles・bullet・progress-rings・waffle・cost-burn）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の usage の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import gauge from './gauge.mjs'
import tiles from './tiles.mjs'
import bullet from './bullet.mjs'
import progressRings from './progress-rings.mjs'
import waffle from './waffle.mjs'
import costBurn from './cost-burn.mjs'

export default [gauge, tiles, bullet, progressRings, waffle, costBurn]
