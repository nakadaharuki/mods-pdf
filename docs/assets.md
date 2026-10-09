# 素材（ECharts の全部・見本・テーマ・ロゴ）の約束

本人 2026-10-09「EChartsのテンプレとかすべてを導入してよ」「ティッカーロゴのSVGをできるだけカラーのやつ集めなよ」「そこまでチェックしなくていい、とにかく全部入れて、全体で最適化する構成を一つ作れば」。

## 1. 形の決まり

- **コードは 1 ファイル 1 MiB（1,048,576 B）未満に割る**（フックのモジュールの上限・実測・docs/formats.md）。
- **データはファイルに置き、使う時だけ `$.fs.read` で読む**（1 回 4 MiB まで）。見本・テーマ・ロゴは JS に埋めない。読んだ物はモジュールの変数に覚える。
- **作り直しは 1 本の手順で**: `node scripts/build-assets.mjs`（ECharts の束・テーマ・見本・目録）。ロゴは別のリポ mods-pdf-logos の `node build.mjs`。何度流しても同じ物ができる。
- 確かめは自動だけ（大きさ・読めるか・描けるか・`$.` の字が無いか）。1 本ずつ目で見る審査はしない。

選ばなかった案
- 見本を JS の関数（data → option）に書き直す: 301 本を人の手で直す事になり、コードが 1 MiB を何度も超える。作る時に Node で option を取り出して JSON にする（関数の項目は落ちる。lossy と書く）。
- ロゴを ModsPDF の中に入れる: 数十 MB になり、商標の物を本体と一緒に配る事になる。別のリポにして、あれば使う。

## 2. 置き場

| 物 | 場所 | 作り方 |
|---|---|---|
| ECharts の全部の series と component（地図 geo・map は除く。GeoJSON が無い） | `hooks/vendor/echarts.mjs`（入口・`renderSvg`）＋ `hooks/vendor/echarts-*.mjs`（esbuild の splitting で割った物。各 1 MiB 未満） | build-assets.mjs。頭に shim（process・setTimeout）を全部のファイルに |
| テーマ 36 個 ＋ ModsPDF の vivid・mono | `assets/echarts/themes.json`（名前 → theme の object） | node_modules/echarts/theme/*.js を stub の echarts で実行して取り出す。vivid・mono は hooks/engine/theme.mjs の色から |
| 見本 301 本 | `assets/echarts/examples/<id>.json`（1 本 1 ファイル） | C:/dev/_ref/oss/echarts-examples/public/examples/ts を typescript で JS にし、Node の vm で stub（setOption を捕まえる・`$.get` と ROOT_PATH は空・setInterval は何もしない）で実行して option を取る |
| 見本の目録 | `assets/echarts/catalog.json` | id・title・titleCN・series の種類・component・category・flags |
| ロゴ | 別リポ `mods-pdf-logos`。置く場所は `~/.claude/mods-pdf-logos/`（`index.json` と `svg/<exchange>/<code>.svg`） | mods-pdf-logos の build.mjs |

見本の flags: `lossy`（落とした関数の項目の名前）・`needsData`（外のデータを読む。data/ は落としていないので、option は空か一部。原稿の data で埋めて使う）・`needsMap`・`animated`（setInterval などの動き。最初の 1 こまを取る）・`failed`（取り出せなかった。理由）。

## 3. 原稿での使い方

```js
{ type: 'chart', example: 'bar-stack', theme: 'vivid', data: …, option: { … } }
```

- `example`: 見本の id。その option を土台にする。
- `data`: 土台の dataset（`dataset.source`）か、series の data を置き換える。形は ECharts の物のまま（`[[...], ...]` または `{ series: [{ name, data }] }`）。
- `option`: 最後に深く重ねる（配列は丸ごと置き換え）。
- `theme`: themes.json の名前。既定は文書の theme（vivid）。
- 知らない example・壊れた JSON は投げず、warnings に書いて今の chart の描き方に戻る。

## 4. 道具

- `pdf_examples`（読むだけ）: 語・series の種類・category で目録を引き、id・題・flags を返す。id を 1 つ渡すと、その option の JSON を返す（Claude が原稿を書く時の手本）。
- ロゴ: 表と図の `logo: 'NYSE:IBM'`（`TSE:7203` の形）。`~/.claude/mods-pdf-logos/index.json` が無ければ黙って描かない（warnings に 1 行）。`~/.claude` の場所は `$.plugin.root` から上にたどって決める。

## 5. 組み込みの回で直す物（10-09 の試しの PDF で見つけた）

- svg.mjs が CSS の `font` のまとめ書き（`style="font: normal bold 9.5px Noto Sans JP"`）を読まない。ECharts は副題・時間の軸・rich の字にこれを使うので、字が既定の大きさで大きく出る。`font-style`・`font-weight`・`font-size`・`font-family` にばらして読む。
- ECharts の円グラフの名前は SSR で幅を見積もって「…」で切る。既定の theme に `pie.label.overflow: 'none'` を入れる。
- 入れ子の svg ごとに id がぶつかる（clipPath・勾配）。図を並べる時は id に前置きを付ける。

## 6. ライセンス

- ECharts（Apache-2.0）・zrender（BSD-3-Clause）・見本（apache/echarts-examples・Apache-2.0）・テーマ（echarts・Apache-2.0）は LICENSES/ に元の LICENSE と出典。
- ロゴは各社の商標。mods-pdf-logos の README と index.json の 1 行ごとに出典・ライセンス・作者を書き、本人の資料のためだけに使う。ModsPDF を公開する時もロゴの包みは同梱しない。
