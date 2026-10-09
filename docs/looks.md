# 図の形（looks）の約束

本人の look Mod（`~/.claude/local-mods/nakada-mods/look/hooks/designs/`・modscode.com/look/ に載せた 60 の欄のデザイン）を、紙の上の図として ModsPDF に移す。本人 2026-10-09「Chart の部分とかもっといい感じにできないの？ modscode のギャラリーにも出したデザイン、それなんで使わないの？」。

選ばなかった案
- ECharts の option に look の見た目を寄せるだけ: 軸・凡例・余白の決まりが ECharts の物に縛られ、sankey・ridgeline・waffle などの形も無い。ECharts の `chart`（option・見本）は残し、字・格子・色だけ look に寄せる（engine/chart.mjs）。
- look の SVG（380 px の欄・暗い地）をそのまま縮めて貼る: 字が版面の幅に比例して 13pt にも 5pt にもなり、暗い地は紙に合わない。幅を pt で受けて、字の大きさを pt で決めて描き直す。

## 1. 置き場と形

- `hooks/engine/looks/<id>.mjs` に 1 つの形。`$` を使わない純な部品（Mods の決まりは design.md §2）。乱数は種つきだけ。Date.now・Math.random を使わない。
- `hooks/engine/looks/paper.mjs`: 紙の色・字・目盛り・数の書き方・esc など、形どうしで同じ物。
- `hooks/engine/looks/index.mjs`: `LOOKS`（id → 形）と `drawLook`。静的な import だけ（フックに動的な import は無い）。
- `hooks/vendor/d3.mjs`: look の `hooks/vendor/d3.mjs` を写す（d3 の ISC・BSD など。LICENSES/ に元の LICENSE と出典を足す）。

1 つの形の export:

```js
export default {
  id: 'sankey', title: '流れ図（Sankey）', category: 'flow',
  /** 原稿の data を確かめて整える。おかしい値は捨てて warnings に書く（投げない） */
  normalize(data) { return { data, warnings: [] } },
  /** 描く。o = { width, height, pal, lang }。width・height は pt。返すのは viewBox="0 0 width height" の SVG の字 */
  draw(data, o) { return '<svg …>' },
  /** 既定の高さ（幅から） */
  height(width, data) { return width * 0.68 },
  /** 見本の data（試験と見本の頁に使う。本人の look の見本の数を、紙の文書に合う日本語の題に直した物） */
  sample() { return {} },
}
```

`drawLook(id, data, { width, height?, pal, lang }) → { svg, width, height, warnings }`。知らない id・壊れた data でも投げず、空の svg と warnings を返す。

## 2. 紙の見た目（look の決まりを紙に写す）

look の決まり（candle の頭の文が基準）をそのまま守る: 枠と軸の線を引かない・値の字は右の余白に置く・最後の値は 35% の墨の点線で余白まで伸ばす・量は 55% の塗り・下の量（出来高など）は 10% の墨・目立たせるのは 1 つだけ（look の Claude の橙の所）。各 design の頭の文にある割合と理由も写す。

色は ModsPDF の theme の色（`pal`）から取る。暗い地の「明るい墨の何 %」は、紙では「濃い墨の同じ %」に置き換える。

| look | 紙 |
|---|---|
| STAGE（地 #1F1E1D） | 塗らない（地は紙の白のまま。本人「地を黒く塗らない」） |
| INK #ECEAE6 | `pal.ink`（mono は #111111） |
| MUTED #85827C（字） | `pal.sub`（#4A4A4A）。字にこれより薄い色を使わない（印刷で飛ぶ） |
| 線・目盛りの薄い墨 | `pal.ink` の不透明度、または `pal.rule` |
| UP #4EBA65・DOWN #FF6B80 | `pal.up`（#176639）・`pal.down`（#A31F1C） |
| CLAUDE #D77757（目立たせる 1 つ） | `pal.accent`。mono では accent が墨なので、目立たせる物は墨 100%、ほかは look の track の % |
| 系列が 2 つ以上 | **色のテーマ（vivid など・既定）では pal.series の色で分ける**（本人 2026-10-09「白黒こだわるのやめて」「カラーじゃないと見にくい」）。墨の濃さ（100%・55%・30%）と線の形（実線・点線）で分けるのは mono の時だけ |

**色のテーマの系列（pal.series）。** 図の入口は `lookPal(theme)`（theme.mjs）で pal を作る。色のテーマ（vivid・koma・mergeble）の pal は `series`（8 色・先頭は accent と同じ）を持ち、mono は持たない。形は `seriesFill / seriesStroke / seriesColor`（paper.mjs）を `... ?? 今までの墨の描き方` の形で使うので、mono の絵は 1 字も変わらない（試験が確かめる）。
- 項目・系列を色で分ける形（donut・treemap・sunburst・icicle・circle-pack・waffle・polar-area・funnel・stacked-area・streamgraph・multi-line・bump・radar・parallel-coords・sankey・chord・mekko・market・pnl・sparks・violin・ridgeline・box-plot・scatter・pyramid・cycle・process・venn・progress-rings・calendar-month など）は、色のテーマで series の色を使う。
- 目立たせる 1 つの決まりは変えない: 目立たせる物は series[0]（accent）の濃い色、ほかは series[1…]（目立たせる物を飛ばして数える）の薄く細い色（面 50%・線 70%）。目立たせる物が無い形は series[0] から順に。
- 字が載る面の濃さは `TONE.under`（40%）以下。字と下の四角い面の明るさの差が 3 倍以上あることを試験（test/looks-color.test.mjs）が確かめる。
- 上げ・下げの色（pal.up・pal.down）は系列の色にしない。量の坂（heatmap・hexbin・contour）は色のテーマで accent の濃さ。
- 資料（deck）は `textMin`（pt。figure.mjs が 7.5 を渡す）を渡し、それより小さい字を描かない（paper の TICK・NOTE・LABEL・VALUE と text() が下限を持ち、12pt まで）。textMin が無ければ今までの大きさ。
- 細い形（flowchart・process・milestones・timeline・cycle）は、段・印が 5 つ以上で箱の高さが自然な高さの 2 倍以上なら、2 行に折り返して「…」で切らない（flowchart・process・milestones は前半・後半の 2 行、timeline は時間を前半・後半の 2 本の軸、cycle の輪は折り返せないので札の行数を増やす）。そうでなければ今までの 1 行。

字: `font-family="Noto Sans JP"`（ModsPDF の svg.mjs が sans に当てる）、太字は `font-weight="bold"`。大きさは pt で、目盛りと注記 7.5、値と名前 8、大きな数（tiles・gauge の中央）は 14〜20。**7pt 未満を使わない**。数は 3 桁ごとに「,」。単位は data の unit。日本語の名前が長い時は省略記号「…」で切る（幅は pal の字の送りのめやすで量る）。

大きさ: 幅は呼ぶ側が版面の幅（pt）で渡す。高さは各形の `height(width, data)`（look の縦横の比が基準）か、原稿の height。内側の余白は look の PAD を pt に写す（380 px の欄の値を、そのまま pt として使ってよい。欄の 1 px ≒ 紙の 1 pt の大きさで look は作られている）。

## 3. data の形（形の種類ごとに、同じ物は同じ名前）

| 種類 | data |
|---|---|
| 時系列（multi-line・step-line・stacked-area・streamgraph・bump・bars・sparks・area-threshold） | `{ x: string[], series: { name, values: number[] }[], unit?, threshold?, highlight? }` |
| ローソク足（candle） | `{ x: string[], ohlc: [o, h, l, c][], volume?: number[], unit? }` |
| 量（gauge・progress-rings・bullet・tiles・waffle） | `{ items: { name, value, max?, target?, unit?, delta? }[] }` |
| 予算（cost-burn） | `{ x: string[], actual: number[], budget: number, unit? }` |
| 比べ（lollipop） | `{ items: { name, value }[], unit?, highlight? }` |
| 前後（dumbbell・slope） | `{ items: { name, from, to }[], fromLabel, toLabel, unit? }` |
| 多軸（radar・parallel-coords） | `{ axes: string[], series: { name, values: number[] }[], max? }` |
| 分布（box-plot・violin・ridgeline・histogram） | `{ groups: { name, values: number[] }[], unit? }` |
| 点（scatter・hexbin・contour） | `{ points: [x, y][], xLabel?, yLabel?, groups?: string[] }` |
| 内訳（donut・funnel・polar-area・waterfall） | `{ items: { name, value }[], unit?, total? }` |
| 木（treemap・sunburst・icicle・circle-pack・dendrogram） | `{ root: { name, value?, children? } }` |
| 流れ（sankey・chord・force-graph） | `{ nodes: { name, group? }[], links: { source, target, value }[] }`（source・target は名前） |
| 日付（heatmap・calendar-month・gantt・timeline） | heatmap `{ days: { date: 'YYYY-MM-DD', value }[] }`・calendar-month `{ month: 'YYYY-MM', events: { date, label }[] }`・gantt `{ tasks: { name, start, end, group? }[] }`・timeline `{ spans: { lane?, start, end, label }[] }` |

上限（10 秒のフックの中で描くため）: 点 5,000・系列 12・1 系列の値 2,000・木の節 2,000・流れの節 200・つながり 1,000・ラベルの字 80。超えた分は捨てて warnings に書く。

## 4. 移す形（43）と事業計画の形（13）

事業計画の形（market・matrix2x2・cycle・process・pyramid・milestones・org・venn・mekko・compare-table・flowchart・kpi-hero・pnl）は category 'biz'。data と決まりは docs/deck.md §6。合わせて 56 形。

time: candle・sparks・bars・area-threshold・bump・multi-line・stacked-area・step-line・streamgraph
usage: gauge・tiles・bullet・progress-rings・waffle・cost-burn
compare: radar・dumbbell・lollipop・parallel-coords・slope
spread: box-plot・contour・hexbin・histogram・ridgeline・scatter・violin
parts: donut・treemap・circle-pack・funnel・icicle・polar-area・sunburst・waterfall
flow: chord・dendrogram・force-graph・sankey
work: heatmap・gantt・calendar-month・session-timeline（id は timeline）

移さない物（欄のための物で、紙の文書の図ではない）: context-window・token-turns・usage-limits・ci-pipeline・dependency-graph・diff-view・file-tree・git-graph・log-tail・test-grid・kanban・activity-feed・agent-lanes・incident-board・notify-stack・shortcut-card・table（表は ModsPDF の table）。

## 5. 確かめ

- 形ごとの試験（test/looks.test.mjs）: sample を描くと svgToOps が警告なしで Op にする・字は全部 7pt 以上・色は pal の物だけ（青が無い）・同じ入力は同じ字・壊れた data は投げずに warnings・上限を超えた data は切って warnings・幅 300 と 500 pt で字の大きさが変わらない。
- 見本の頁: `node scripts/looks-preview.mjs` が全部の形を A4 に 2 つずつ並べた PDF（out/looks/looks.pdf）と頁の絵（pdftoppm）を作る。目で見て、look の欄の絵（modscode の site/assets/look/<id>.png）と同じ決まりで描けているかを比べる。
- 出典: 各ファイルの頭に「元は look の designs/<id>.mjs（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）」と書く。d3 を使う形は d3 の出典も。
