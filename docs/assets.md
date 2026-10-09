# 素材（ECharts の全部・見本・テーマ・ロゴ）の約束

本人 2026-10-09「EChartsのテンプレとかすべてを導入してよ」「ティッカーロゴのSVGをできるだけカラーのやつ集めなよ」「そこまでチェックしなくていい、とにかく全部入れて、全体で最適化する構成を一つ作れば」。

## 1. 形の決まり

- **コードは 1 ファイル 1 MiB（1,048,576 B）未満に割る**（フックのモジュールの上限・実測・docs/formats.md）。
- **データはファイルに置き、使う時だけ `$.fs.read` で読む**（1 回 4 MiB まで）。見本・テーマ・ロゴは JS に埋めない。読んだ物はモジュールの変数に覚える（見本は新しい 24 本まで）。読めなかった物は理由を覚えて描く時に warnings に書き、次の組みでもう一度読む。
- **作り直しは 1 本の手順で**: `npm run build:assets`（= `node scripts/build-assets.mjs`。ECharts の束・テーマ・見本・目録。何度流しても同じ物ができる。時間切れは build を止める）。ロゴは別のリポ mods-pdf-logos の `node build.mjs`。
- 確かめは自動だけ（`npm run check:assets` = scripts/assets/verify-echarts.mjs。大きさ・フックと同じ vm で読めるか・series の種類ごとに描けるか・`$.` の字が無いか）。1 本ずつ目で見る審査はしない。

選ばなかった案
- 見本を JS の関数（data → option）に書き直す: 300 本を人の手で直す事になり、コードが 1 MiB を何度も超える。作る時に Node で option を取り出して JSON にする（関数の項目は落ちる。lossy と書く）。
- ロゴを ModsPDF の中に入れる: 数十 MB になり、商標の物を本体と一緒に配る事になる。別のリポにして、あれば使う。
- ECharts を 1 本の束のまま持つ: 1,040,962 B で上限に余りが無かった。esbuild の splitting で割る。

## 2. 置き場

| 物 | 場所 | 作り方 |
|---|---|---|
| ECharts の全部の series と component（地図 geo・map は除く。GeoJSON が無い） | `hooks/vendor/echarts.mjs`（入口・`renderSvg`）＋ `hooks/vendor/echarts-*.mjs`（11 ファイル。各 1 MiB 未満・計 12） | build-assets.mjs。全ファイルの頭に shim（process・setTimeout） |
| テーマ 40 個（ECharts の 38 ＋ ModsPDF の vivid・mono） | `assets/echarts/themes.json`（名前 → theme の object） | node_modules/echarts/theme/*.js を stub の echarts で実行して取り出す。vivid・mono は hooks/engine/theme.mjs の色から |
| 見本 297 本 | `assets/echarts/examples/<id>.json`（1 本 1 ファイル） | echarts-examples の public/examples/ts を JS にし、Node の vm で stub（setOption を捕まえる・`$.get` と ROOT_PATH は空・setInterval は何もしない）で実行して option を取る |
| 見本の目録 | `assets/echarts/catalog.json`（配列） | id・title・titleCN・category・series・component・flags・bytes |
| ロゴ | 別リポ `mods-pdf-logos`。置く場所は `~/.claude/mods-pdf-logos/`（`index.json` と `svg/<取引所>/<名前>.svg`） | mods-pdf-logos の build.mjs |

見本の flags（件数は目録の数）: `paper`（紙にそのまま出せる）・`lossy`（落とした関数の項目がある）・`needsData`（外のデータを読む。option は空か一部。原稿の data で埋めて使う）・`needsMap`（地図。描けない）・`animated`（setInterval などの動き。最初の 1 こまを取る）・`lostRenderItem`（描く関数が無く、軸だけ）・`needsStat`・`truncated`（長い配列を切ってある）・`skeleton`・`empty`。

## 3. 原稿での使い方

```js
{ type: 'chart', example: 'bar-stack', theme: 'vivid', data: …, option: { … } }
```

- `example`: 見本の id（`^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`）。その option を土台にする。`theme` も英数字と `_ -` の名前だけ。
- `data`: 土台の dataset（`dataset.source`）か、series の data を置き換える。形は ECharts の物のまま（`[[...], ...]` または `{ series: [{ name, data }] }`）。文字列の JSON も受ける。
- `option`: 最後に深く重ねる（配列は丸ごと置き換え）。
- `theme`: themes.json の名前。既定は文書の theme。
- `kind` と `example` が両方あれば kind（look の形）を使う。
- 紙に要らない部品は落とす: toolbox・tooltip・brush・axisPointer。dataZoom の slider は inside に、visualMap は動かせなく、timeline の自動再生は止める。円グラフの名前には `overflow: 'none'` を付ける。字は資料で textMin 以上（ECharts の既定の字と題だけ。見本が小さい字を明示している所は 7pt まで上げるだけ）。
- 知らない example・壊れた JSON は投げず、warnings に書いて今の chart の描き方に戻る。
- 本体は組む前に `chartAssetNeeds(input)` で要る見本とテーマを数え、`loadChartAssets` で読んでおく（組版は同期なので、読み込みは組む前に済ませる）。

## 4. 道具 pdf_examples（読むだけ）

- 引数: `query`（語。空白で区切ると全部を含む物。id・題・中国語の題・分類・series・部品の名前を引く）・`series`・`category`・`paper`（true なら paper の旗の物だけ）・`limit`（1〜30・既定 20）・`id`。
- 語で引くと id・題・種類・旗を返す。題は英語と中国語なので、主な日本語（積み上げ・棒・折れ線・円・散布・面など）は英語に直して引く。語が当たった強さの順で、同点なら paper の物を前に。
- `id` を 1 つ渡すと、その見本の option（JSON・60,000 字まで）を返す。Claude が chart のブロックを書く時の手本。形の違う id は断る。
- 目録を先に引き、option は id で 1 本だけ読む 2 段にする（全部で 13 MB あり、一度に返せない）。

## 5. ロゴ

- 表のセル・KPI の項目の `logo: 'NYSE:IBM'`（箇条書きの `logos` は schema が通すが、組む側がまだ描かない）（`TSE:7203` の形。取引所は大文字にし、TYO・JPX は TSE に直す）。
- 本体は原稿から logo の字を集め（collectLogoKeys）、`~/.claude/mods-pdf-logos/index.json` の `file`（`svg/<取引所>/<名前>.svg` の形だけ）から読んで compose に `logos` として渡す。置き場は `$.plugin.root` から上にたどって最も近い `.claude` の下。無ければ（開発中の直読みなど）印なしで警告 1 行。
- 白いロゴ（index.json の white）は、viewBox を広げた #333333 の丸い地の上に載せる。色を ink に塗り替える案は、白に見える色の書き方が多く、採らなかった。
- 置き場の index.json は 319 行。SVG の実物の取得（fetch-commons）はダウンロードに本人の許可が要る。
- 読み込みの時間: ECharts の 12 ファイルを parse 約 130・link 約 150・evaluate 約 50 ms で読む（verify-echarts の測定で合計約 200 ms）。Mod 全体（vendor 15 本）は vm で約 500 ms（以前の 377 ms から約 100 ms 増。フックの 10 秒には十分な余裕がある）。増やすなら束の遅延読み込みを考える。
- 未確認: `$.fs.read` で見本・テーマ・ロゴを読む経路を、実機（`claude plugin test`）の中の本物のファイルで確かめたか。tests/ の試験は読み込みを差し替えて確かめている。

## 6. ライセンス

- ECharts（Apache-2.0）・zrender（BSD-3-Clause）・見本（apache/echarts-examples・Apache-2.0）・テーマ（echarts・Apache-2.0）は LICENSES/ に元の LICENSE と出典。
- ロゴは各社の商標。mods-pdf-logos の README と index.json の 1 行ごとに出典・ライセンス・作者を書き、本人の資料のためだけに使う。ModsPDF を公開する時もロゴの包みは同梱しない。
