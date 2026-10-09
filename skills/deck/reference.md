# 枚の JSON の書き方（Haiku に渡す・make と revise に渡す）

make の引数は `{ title, kind: 'deck', slides: [...], datasets: {...}, theme?, paper?, author?, lang? }`。`theme` は vivid（既定・色）・koma・mergeble・mono（黒白）。`paper` は A4（横。既定）か wide（16:9）。

## 枚（slide）

共通: `layout`（必須）・`kicker`（頭の小さな見出し）・`title`（主張の 1 文・40 字まで）・`lead`（補足 1〜2 文）・`sources`（出典の字の配列）・`notes`（話す人の覚え。頁には出ない）。

| layout | 使う項目 | 使い所 |
|---|---|---|
| cover | title・lead・by（作り手と日付） | 表紙（1 枚目） |
| section | number（"01"）・title・lead | 章の区切り |
| statement | title（1 文）・lead | 1 つの言い切り |
| quote | quote・by | 引用 |
| closing | title・lead・items（字の配列 = 次の一歩） | 結び（最後） |
| grid | panels・arrange | **本文はほぼこれ**。1 枚に 3〜6 個の panel を詰める |
| content | blocks（para・list・table・chart・card・keys） | 文章中心の 1 段 |
| split | left・right（blocks の配列）・ratio（"5:7"・"6:6"・"7:5"） | 左右 2 つ |
| figure | figure（chart か svg）・side（blocks） | 図 1 つが主役 |
| kpi | items `[{ label, value, unit?, delta?, trend?, note?, logo? }]` 2〜4 個 | 大きな数 |
| compare | items `[{ title, points: string[], highlight? }]` 2〜3 列 | 比べ |
| table | blocks に table 1 つ | 表だけ |

本文の枚は grid を基本にする（余白が出ず、検査の「空いた枚」に掛かりにくい）。

## panel（grid の中身）

`{ title?, note?, source?, span?, emphasis?, ＋次のどれか 1 つ }`

- `kpi`: `[{ label, value, unit?, delta?, trend?: 'up'|'down'|'flat', note?, logo? }]`（6 個まで）
- `look`: `{ kind, data | dataset, alt, caption?, height? }`（図の形。下の表）
- `chart`: `{ example, theme?, data?, option?, alt }`（ECharts の見本。pdf_examples で探す）か `{ option, alt }`
- `table`: `{ head: string[], rows: string[][], align?: ('left'|'right'|'center')[], widths?: number[] }`（セルは字か `{ text, logo }`。数字の列は right）
- `list`: `string[]` か `{ items: string[], ordered?: boolean }`
- `text`: 字（段落は空行で分ける）

`span`（重み・既定 1）、`emphasis: true`（accent の縁）、`note`（題の右に小さく）、`source`（札の下に小さく。dataset を使えば自動）。

`arrange`: `auto`（panel の数と先頭の型で決める）・`1+2`・`2x2`・`3col`・`1+3`・`kpi+3`・`2x3`、または `rows:行ごとの個数|行の高さの重み`（例 `rows:1,2,1|0,1.4,1.3` = KPI の帯 1 つ・次に 2 つ・最後に 1 つ。KPI だけの行は重み 0 でよい）。panel の総数と個数の合計が合わないと無視される。

## 数字は datasets に入れる

```json
"datasets": { "nav": { "source": "出典の名前", "asOf": "2026-09-26", "data": { "x": ["7/4","7/11"], "series": [{ "name": "A", "values": [100, 101] }] } } }
```

panel は `"look": { "kind": "multi-line", "dataset": "nav", "alt": "…" }` と dataset の id で呼ぶ。出典は足に自動で出る。**数字を枚の文に直接書き散らさない**（同じ数字が 2 か所で食い違う）。題や lead の数字は datasets の値と同じにする。

## 図の形（kind）と data

時系列 `{ x: string[], series: [{ name, values: number[] }], unit?, threshold?, highlight? }`: multi-line・step-line・stacked-area・streamgraph・bump・bars・sparks・area-threshold
ローソク足 candle `{ x, ohlc: [o,h,l,c][], volume?, unit? }`
量 gauge・progress-rings・bullet・tiles・waffle `{ items: [{ name, value, max?, target?, unit?, delta? }] }`
予算 cost-burn `{ x, actual: number[], budget: number, unit? }`
比べ lollipop `{ items: [{ name, value }], unit?, highlight? }`
前後 dumbbell・slope `{ items: [{ name, from, to }], fromLabel, toLabel, unit? }`
多軸 radar・parallel-coords `{ axes: string[], series: [{ name, values }], max? }`
分布 box-plot・violin・ridgeline・histogram `{ groups: [{ name, values: number[] }], unit? }`
点 scatter・hexbin・contour `{ points: [x,y][], xLabel?, yLabel?, groups? }`
内訳 donut・funnel・polar-area・waterfall `{ items: [{ name, value }], unit?, total? }`
木 treemap・sunburst・icicle・circle-pack・dendrogram `{ root: { name, value?, children? } }`（treemap は `delta` で上げ下げの色）
流れ sankey・chord・force-graph `{ nodes: [{ name, group? }], links: [{ source, target, value }] }`（source・target は名前）
日付 heatmap `{ days: [{ date: 'YYYY-MM-DD', value }] }`・calendar-month `{ month: 'YYYY-MM', events: [{ date, label }] }`・gantt `{ tasks: [{ name, start, end, group? }] }`・timeline `{ spans: [{ lane?, start, end, label }] }`

事業計画の形:
market `{ items: [{ name, value, note? }] ×3, unit }`（TAM・SAM・SOM）・matrix2x2 `{ x: [低,高], y: [低,高], quadrants?, points: [{ name, x: 0..1, y: 0..1, self? }] }`・cycle `{ center?, steps: [{ name, note? }] }`・process `{ steps: [{ name, note? }] }`・pyramid `{ levels: [{ name, note? }] }`・milestones `{ items: [{ date, name, done? }] }`・org `{ root: { name, role?, children? } }`・venn `{ sets: [{ name, note? }], overlap? }`・mekko `{ columns: [{ name, value, parts: [{ name, value }] }], unit? }`・compare-table `{ columns, rows: [{ name, values: (boolean|string)[] }], highlight? }`・flowchart `{ nodes: [{ id, name, group? }], links: [{ from, to, label? }] }`・kpi-hero `{ items: [{ name, value, unit?, delta?, spark?: number[] }] }`・pnl `{ x, revenue, cost, profit?, unit }`

形の選び方: 推移 → multi-line・bars・area-threshold／構成 → donut・treemap・waterfall／順位・比べ → lollipop・dumbbell・bars／分布 → box-plot・histogram／市場の大きさ → market／収支 → pnl／流れ → sankey・flowchart／日程 → gantt・milestones。同じ形を 1 枚に 2 つ置かない。系列は 8 本まで（色が 8 色）。

## ロゴ

表のセル `{ "text": "IBM", "logo": "NYSE:IBM" }`・KPI の項目 `"logo": "TSE:7203"`。形は `取引所:コード`（NYSE・NASDAQ・TSE など）。ロゴが無ければ印なしで警告が出るだけ。

## 字数の目安（収まらないと「…」で切れて検査に掛かる）

題 40 字まで・lead 2 文まで・list は 1 枚の panel に 3〜5 点で 1 点 40 字まで・KPI の label は 12 字まで・表は 6 列 8 行まで・図の name は 8 字まで。
