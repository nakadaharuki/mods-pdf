# 資料（deck）の回の約束（2026-10-09）

担当はまずこの文書、次に docs/design.md（§1〜§3）と docs/looks.md を読む。design.md と違う所はこの文書が正。

本人 2026-10-09: 「横 A4 を標準にしながら、選択できる感じ。印刷できるプレゼン資料って感じのイメージ」「普通に事業計画とか作るものをまずは作って、それが金融系も使える形」「look の形のレパートリーを増やすほうが、ツールを使う時の速さと軽さと洗練さがある」。手本の水準は ARK の Big Ideas 2026（16:9・PowerPoint 製）で、本人は「もっと高いレベル」を求めている。ARK の絵・文・ブランドは写さない。

## 0. この回でやること・やらないこと

この回（v1）:
1. 資料の型（`kind: 'deck'`）: 1 枚 = 1 頁、横 A4 が既定、`paper: 'wide'`（960×540pt・16:9）も選べる、型 11 種、はみ出しは黙って次の頁に流さない
2. 図は `{ kind, data }` で look の形を呼ぶ（文書と資料の両方。共通の `figure.mjs`）
3. 事業計画向けの形を 13 足す（§6）
4. 描画の層: 線形・放射のグラデーション（色の止まりに透明度も）・不透明度・重ね方（blend）・角丸・形で切る（path の clip）・カードの影
5. 事業計画の型（`template: 'bizplan'` と `plan`）。数字は `datasets` の入口から入れる（後で金融のデータを同じ入口に入れる）
6. 道具 `make` の資料対応と、1 枚ずつ直す道具 `revise`。欄は横長の頁を出す
7. 元の原稿とデータを PDF に添付する（第 2 段の担当）

次の回（今は作らない。作り込まない）: ぼかしを JS の画素で作る一般の影（v1 は角丸の四角だけ）・一般のソフトマスク・メッシュと円錐のグラデーション・模様（tiling）・CMYK・特色・オーバープリント・PDF/A-4 と PDF/UA-2 と PDF/X の名乗り（veraPDF が無いので）・縦組み・3D の絵（外の画像モデルは本人が「一旦なし」）。

## 1. 持ち主の表（この回）

自分の行のファイルだけ作る・直す。ほかを直したくなったら直さずに報告に書く。

| 担当 | ファイル |
|---|---|
| deck-layout | hooks/engine/theme.mjs・hooks/engine/layout.mjs・hooks/engine/lay-slide.mjs（新）・hooks/engine/index.mjs・test/theme.test.mjs・test/layout.test.mjs・test/deck-layout.test.mjs（新） |
| schema | hooks/engine/schema.mjs・hooks/engine/inline.mjs・hooks/engine/lay-blocks.mjs・hooks/engine/figure.mjs（新）・hooks/engine/templates/bizplan.mjs（新）・test/schema.test.mjs・test/figure.test.mjs（新）・test/bizplan.test.mjs（新） |
| gfx-pdf | hooks/render/pdf.mjs・hooks/render/paint.mjs（新）・test/render-pdf.test.mjs・test/render-pdf-gfx.test.mjs（新） |
| gfx-svg | hooks/engine/svg.mjs・hooks/engine/chart.mjs・hooks/render/svg.mjs・test/svg.test.mjs・test/chart.test.mjs・test/render-svg.test.mjs・test/svg-gfx.test.mjs（新） |
| host | hooks/mods-pdf.mjs・hooks/lib/*.mjs・hooks/sample.mjs・tests/*.test.ts・scripts/hook-env-check.mjs・.claude-plugin/* |
| biz-forms | hooks/engine/looks/ の新しい 13 形と biz.mjs（新）・hooks/engine/looks/paper.mjs・hooks/engine/looks/index.mjs・test/looks-biz.test.mjs（新） |
| 第 2 段 | samples/**・scripts/deck-preview.mjs（新）・README.md・hooks/render/meta.mjs（新）・scripts/build-vendor.mjs と src/ の d3 の入口 |
| Opus（本会話） | docs/*・package.json・.gitignore |

触らない物: 既存の 43 形のファイル（hooks/engine/looks/<id>.mjs と束）・hooks/vendor/*（作り直しは第 2 段だけ）・fonts/・LICENSES/（足すのは第 2 段だけ）。

全員の決まり:
- Bash は `cd … &&` でつながず、絶対パスで書く（`node C:/dev/mods-pdf/scripts/…`・`git -C C:/dev/mods-pdf …`・`npm --prefix C:/dev/mods-pdf run …`）。python3 は使わない。何も download・install しない。git の commit・push・branch はしない。
- `$` を書くのは hooks/mods-pdf.mjs だけ（design.md §2）。乱数は種つきだけ。
- **日本語の文書の組みを動かさない**: 終わる前に `npm --prefix C:/dev/mods-pdf run snapshot` が 7/7 同じ。資料の型・テーマ・描画を足しても、mono の A4 縦の文書の字の位置は 1 つも動かない（例外は §5 の chart の見た目を look に寄せる所だけ。動いたら、動いたのが図の中の字だけである事を確かめてから `node C:/dev/mods-pdf/scripts/ja-snapshot.mjs --write` し、報告に見本と行数を書く）。
- 試験は振る舞いを名前にする（「横 A4 の資料で 1 枚が 1 頁になる」）。コメントは選ばなかった案と理由だけ。

## 2. Display List に足す物（§3.1 の続き。足すだけで、今の欄の意味は変えない）

```js
/** @typedef {{ at: number, color: Color, opacity?: number }} Stop      // at は 0〜1 の昇順・2〜8 個。opacity の既定 1 */
/** @typedef {{ kind: 'linear', x1: number, y1: number, x2: number, y2: number, stops: Stop[] }
 *         | { kind: 'radial', cx: number, cy: number, r: number, fx?: number, fy?: number, stops: Stop[] }} Paint
 *  座標は頁の pt（左上が原点・y は下向き）。Op の座標と同じ。 */
/** @typedef {'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'} Blend */
/** @typedef {{ dx: number, dy: number, blur: number, color: Color, opacity: number }} Shadow   // blur は pt（ぼかしの半径のめやす） */
```

- `PathOp`・`RectOp`・`TextOp` に `paint?: Paint`（塗りのグラデーション）。**`fill`・`color` は文字列のまま残し、paint を読めない時の色**にする（最初の止まりの色を入れる）。Color の型は広げない。
- `RectOp` に `r?: number`（角丸の半径 pt）・`opacity?: number`・`shadow?: Shadow`。
- `TextOp`・`ImageOp` に `opacity?: number`（本物の不透明度。今の svg.mjs の「紙の色に混ぜる」代用はそのまま残す）。
- `PathOp`・`RectOp`・`TextOp`・`ImageOp` に `blend?: Blend`（無ければ normal）。
- `ClipOp` に `d?: string`（M・L・C・Z の path。あればこの形で切り、x・y・w・h はその外接の四角）。
- 字のグラデーション: `TextOp.paint` があれば、PDF は字を切り抜き（Tr 7）にして塗る。欄は `fill="url(#…)"`。

PDF の書き方（gfx-pdf。手本は試作 `C:\Users\nakada\AppData\Local\Temp\claude\C--dev\6f36e581-51cc-4631-913a-4d34c20517cd\scratchpad\pdf-next\gfx\slide.mjs`。そこで動いた pdf-lib の低い層の呼び方を写す）:
- グラデーションは Pattern type 2 + Shading type 2/3 + Function type 3（止まりの間は type 2）。止まりに opacity < 1 があれば、同じ形の輝度のソフトマスク（Group が DeviceGray の Form XObject に、不透明度を灰色にした同じ Shading を描く）を ExtGState の SMask で掛ける。BBox は頁全体（試作の罠: BC の既定が黒で BBox の外が消える）。
- ExtGState は (ca, CA, BM, SMask) の組ごとに 1 つ作って頁の中で使い回す。不透明度か blend を使った頁は Group（/S /Transparency /CS /DeviceRGB）を持つ。
- Shading・Pattern・ColorSpace は pdf-lib に頁の辞書を足す口が無いので、頁の Resources に手で足す。流れ（stream）は全部 register して参照で持つ（直に入れた流れは save7bit の 7 ビットの確かめに落ちる）。
- 影: 角丸の四角の α を JS の画素（1〜2 px/pt・最大 100 万画素）に描き、箱ぼかし 3 回（真のガウスより 10 倍速く、差は 2.2/255）で SMask つきの画像にする。速さの番人を試験に入れる（20 枚の影で 1 秒以内）。
- vm の中の繰り返しは Math.* を大域から引かない（モジュールの変数に入れる）。

欄（gfx-svg の render/svg.mjs）: グラデーションは `<defs>` の linearGradient・radialGradient（id は頁ごとの頭を付ける）、blend は `style="mix-blend-mode:…"`、path の clip は clipPath、影は `<filter>` の feDropShadow。**欄に base64 の画素を入れない**（131,072 字の上限）。

## 3. Doc に足す物（schema）

```js
/** Doc: { kind: 'doc'|'deck',            // 既定 'doc'。'deck' は 1 枚 = 1 頁
 *   …今の欄…, paper: 'A4'|'A5'|'B5'|'Letter'|'wide', landscape,   // deck で paper が A4 で landscape の指定が無ければ横。'wide' は 960×540 で landscape を見ない
 *   slides?: Slide[],                    // deck の中身（blocks の代わり）
 *   datasets?: { [id: string]: { data: object, source?: string, asOf?: string } },   // 数字の入口。chart の dataset で呼ぶ
 *   attach?: boolean }                   // 元の原稿とデータを PDF に添付する（deck の既定 true・doc の既定 false。第 2 段）
 *
 * Slide: { type: 'slide', layout: Layout, id?, kicker?, title?, lead?, blocks?: Block[], left?: Block[], right?: Block[],
 *   ratio?: '5:7'|'6:6'|'7:5', figure?: Block（chart・svg・image）, side?: Block[], items?: object[], quote?, by?,
 *   notes?: string（話す人の覚え。PDF には出さない・第 2 段で添付に入れる）, sources?: string[] }
 * Layout（型）: 'cover'|'section'|'statement'|'content'|'split'|'figure'|'kpi'|'compare'|'table'|'quote'|'closing'
 *
 * chart の Block を広げる: { type: 'chart', kind?: string, data?: object, dataset?: string, option?: object, height?, caption?, alt? }
 *   kind があれば look の形（drawLook）。dataset があれば datasets[id].data を data に、source を slide の sources に足す。option は今の ECharts。 */
```

- 上限: slides 120 枚・1 枚の blocks 12 個・datasets 40 個（1 つの data は JSON で 200,000 字）。超えたら切って warnings。
- Markdown で資料（`kind: 'deck'` で `markdown`）: 囲み（```）の外の `---` だけの行が 1 枚の区切り（deck の時だけ。doc では今のまま水平線）。1 枚の頭の `# X` は section、`## X` は題名。中身は今の Block。型は中身から決める（図 1 つだけ → figure・題名と 1 行だけ → statement・ほか → content）。囲み ```chart は JSON（kind・data か option）。
- `template: 'bizplan'` と `plan`（§7）があれば、templates/bizplan.mjs が slides に広げる（slides と一緒に来たら、広げた後ろに slides を足す）。

## 4. 資料の頁（deck-layout の lay-slide.mjs）

```js
/** 1 枚を 1 頁の Op にする。はみ出しは §4.3 */
export function laySlide(slide, ctx) → { ops: Op[], warnings: string[], outline: { title: string, level: number, y: number }[] }
/** ctx: { page: { width, height }, index（0 から）, count, theme, metrics, images, phrase, lang, section?（直前の section の題）,
 *        tag: (role, parent, extra?) => number（Layout.tags に足して番号を返す。layout.mjs が作る）, figure: figureOps } */
```
layout.mjs は `doc.kind === 'deck'` の時だけ lay-slide に渡す（doc の組みは 1 字も変えない）。

### 4.1 寸法（A4 横 841.89×595.28 を 1 とし、wide は幅の比 960/841.89 で全部の値を掛ける）
- 余白: 左右 48・上 36・下 30。12 段の格子（段の間 16）。
- 頭の帯: 左に kicker（無ければ section の題）9pt・sub、右に頁番号 8pt・sub。帯の下 14 から題名。
- 字（deck の本文は sans。全部 sansBold・sans）: 表紙の題 40・表紙の副題 16・section の題 36・題名 24（2 行まで）・lead 14（3 行まで・sub）・本文 12（行送り 1.6 倍）・表 10・図の字 7.5〜8（look のまま）・出典 7.5・KPI の数 40〜48。**7pt 未満を作らない**。
- 足: 左に出典（sources を「出典: 」でつなぎ 2 行まで・7.5pt・sub）、右に「n / N」。表紙・section・closing は足なし。

### 4.2 型
- cover: 題・副題・作り手と日付。theme の背景の飾り（§4.4）。
- section: 大きな番号（01）と題と lead。
- statement: 1 つの文を 28〜32pt で（左寄せ・中央の高さ）。下に小さな補足。
- content: 題・lead・blocks（段落・箇条書き・keys・card・表・図）を 1 段で。
- split: 題・left と right（ratio の割合・既定 6:6）。
- figure: 題・lead・figure を本文の幅いっぱい、side があれば右に 4 段分。caption は図の下。
- kpi: 題・items（{ label, value, unit?, delta?, note? } 2〜4 個）を大きな数で横に並べる。delta の正は up・負は down の色。
- compare: 題・items（{ title, points: string[], highlight? } 2〜3 列）をカードで。highlight は accent の縁。
- table: 題・表の Block 1 つ（入らなければ字を 9pt まで下げる）。
- quote: 大きな引用と by。
- closing: 結びの文と次の一歩（items の文）。

### 4.3 はみ出し
1 枚は必ず 1 頁。入らない時は ① 本文の字を 12 → 10.5 → 10、表は 10 → 9 → 8 に下げる ② それでも入らない block は落として、warnings に「n 枚目（題名）に入らない: 何の block」を書く。黙って次の頁に流さない・黙って捨てない。

### 4.4 テーマ（theme.mjs）
今の mono・koma・mergeble はそのまま使える。**白黒にこだわらない**（本人 2026-10-09「白黒こだわって作ってる感じあるけどそれやめて」「カラーじゃないと見にくい」）: 既定は色のテーマ、mono は選べる 1 つ。系列・区分は pal.series の色で分ける（vivid の series: '#6A3DE8'・'#F0562E'・'#0FA3A3'・'#E8A317'・'#3D7DD8'・'#D6336C'・'#5B8C2A'・'#8A5A44'）。足す物:
- `vivid`（資料の既定）: ink #15131D・sub #4B4858・rule #DCD9E3・tint #F4F2F8・accent #6A3DE8・accent2 #F0562E・up #157F3B・down #C0261E・paper #FFFFFF・grad ['#3B2FD9', '#A12BD6', '#F2542D']。表紙と section は grad の大きな放射の光（止まりの透明度で紙に溶かす）と、題名の字のグラデーション。content 系は題名の下に grad の細い帯（幅 48・太さ 3）だけで、地は白。
- mono で資料: grad を ['#111111', '#111111'] にし、光を出さない（黒白の証券会社調のまま）。
- Theme に `deck: { scale, margin, grid, sizes }` と `colors.accent2`・`colors.grad` を足す。`makeTheme({ kind: 'deck', … })`。doc の Theme の値は 1 つも変えない。

タグ: section の題は H1、slide の題は H2、本文は今のまま（P・L・Table・Figure（alt 必須）・Caption）。outline に section（level 1）と題（level 2）。

## 5. 図の入口（schema の figure.mjs）

```js
/** 図の Block（chart の kind・option、svg、image）を、決めた箱に描く Op にする。
 *  height を渡せばその箱に収める。渡さなければ自然な高さ（look の height(width)・viewBox の比）を返す */
export function figureOps(block, { x, y, width, height?, metrics, theme, images, lang }) → { ops: Op[], warnings: string[], height: number, alt: string }
```
- kind → `drawLook(kind, data, { width, height, pal, lang })` → `svgToOps`。pal は theme.colors（accent2・grad も渡す）。
- option → `chartToOps`。ECharts の既定の見た目を look に寄せる（gfx-svg の chart.mjs: 軸の線なし・薄い格子・値は右・色は theme の ink・sub・accent・grad・字 7.5pt 以上）。
- lay-blocks.mjs の図も figureOps を使う（doc でも `{ kind, data }` が使える）。

## 6. 事業計画向けの形（biz-forms・docs/looks.md の約束で作る・category 'biz'）

| id | 用途 | data |
|---|---|---|
| market | 市場規模 TAM・SAM・SOM の入れ子の円 | `{ items: { name, value, note? }[3], unit }` |
| matrix2x2 | 立ち位置（2 軸） | `{ x: [低, 高], y: [低, 高], quadrants?: string[4], points: { name, x: 0..1, y: 0..1, self? }[] }` |
| cycle | 循環（中心と 3〜8 の段） | `{ center?, steps: { name, note? }[] }` |
| process | 段階（矢羽根 2〜7） | `{ steps: { name, note? }[] }` |
| pyramid | 階層（上から） | `{ levels: { name, note? }[] }` |
| milestones | 道のりの節目 | `{ items: { date: 'YYYY-MM' か字, name, done? }[] }` |
| org | 体制図（3 段・30 人まで） | `{ root: { name, role?, children? } }` |
| venn | 重なり（2〜3） | `{ sets: { name, note? }[], overlap? }` |
| mekko | 市場の割合（幅と内訳） | `{ columns: { name, value, parts: { name, value }[] }[], unit? }` |
| compare-table | 機能の比べ（○×と字） | `{ columns: string[], rows: { name, values: (boolean|string)[] }[], highlight?: number }` |
| flowchart | 仕組み・お金とサービスの流れ（左から右の段） | `{ nodes: { id, name, group? }[], links: { from, to, label? }[] }` |
| kpi-hero | 大きな数と小さな線 | `{ items: { name, value, unit?, delta?, spark?: number[] }[] }` |
| pnl | 収支の見通し（売上・費用の棒と利益の線・年平均の伸び） | `{ x: string[], revenue: number[], cost: number[], profit?: number[], unit }` |

- look の決まり（枠と軸の線なし・目立たせるのは 1 つ・値は余白）を守る。pal.grad があれば、目立たせる 1 つと面に `<linearGradient>`・`<radialGradient>` を使ってよい（svg.mjs が読む。mono は grad が墨なので単色になる）。字は 7pt 以上。
- 形は biz.mjs の配列に並べ、index.mjs の LOOK_LIST と CATEGORIES に足す。paper.mjs の cleanPal が accent2 と grad を通すようにする（既存の 43 形の mono の絵は変えない）。
- 試験は test/looks-kit.mjs の共通の確かめ ＋ 形ごとの振る舞い。見本の頁は `node C:/dev/mods-pdf/scripts/looks-preview.mjs` で作り、自分で目で見る。

## 7. 事業計画の型（schema の templates/bizplan.mjs）

```js
/** plan を slides に広げる。足りない項目の頁は作らない（warnings に「plan.xxx が無いので○○の頁を作らなかった」） */
export function expandBizplan(plan, { lang }) → { slides: Slide[], datasets: object, warnings: string[] }
/** plan: { company, tagline?, date?, summary: string[], problem: { points: string[], stat?: { value, label, source? } },
 *   solution: { points: string[] }, market: { tam, sam, som: { value, label? }, unit, source? },
 *   model?: { nodes, links } か { points: string[] }, competition?: { x, y, players: { name, x, y, self? }[] } か { columns, rows },
 *   traction?: { kpis: { name, value, unit?, delta? }[] }, roadmap?: { items: { name, start, end }[] } か { milestones },
 *   financials: { years: string[], revenue: number[], cost: number[], unit, source? }, team?: { members: { name, role, note? }[] },
 *   funding?: { amount, unit, use: { name, value }[] }, risks?: { risk, answer }[], sources?: string[] } */
```
頁の順: cover → summary（statement か kpi）→ problem（content と stat の kpi）→ solution（compare か content）→ market（figure・market）→ model（figure・flowchart）→ competition（figure・matrix2x2 か table）→ traction（kpi）→ roadmap（figure・gantt か milestones）→ financials（figure・pnl と side に要点）→ team（compare か figure・org）→ funding（figure・donut）→ risks（table）→ closing。数字は datasets に入れ、図は dataset で呼ぶ（金融のデータも後で同じ datasets に入れる）。

## 8. 道具（host）

- `make` に kind・slides・template・plan・datasets・attach と paper の 'wide' を足す。description は短く: 資料は `kind: 'deck'`、型の名前、`{ kind, data }` の図、bizplan、`---` の区切り。
- `revise`（新）: `{ path?, ops: { action: 'replace'|'insert'|'delete'|'move', index（1 から）, to?, slide? }[], theme?, paper?, title? }`。store の `pdf:last` の input（資料の物）に当てて組み直し、同じ場所に書いて欄を替える。言葉での直しは Claude がこれで 1 枚ずつ送る（全体を送り直さないので速い）。
- 欄: 横長の頁の比で出す（PANE_SIZE と lib/pane.mjs の縦の決め打ちを直す）。1 枚ずつ・前と次と開く。
- `/pdf sample deck` で事業計画の見本（hooks/sample.mjs。架空の会社）。
- .claude-plugin の version を 0.2.0 に（plugin.json と marketplace.json を同じに）。
- hook-env-check に「資料 15 枚を vm で 3 秒以内に組んで書ける」を足す。

## 9. 確かめ（全部通してから終わる）

`npm --prefix C:/dev/mods-pdf run test:unit`・`run check`・`run snapshot`（7/7）・`run verify:all`・`run validate`・自分の新しい試験。見た目を作る担当（deck-layout・biz-forms・第 2 段）は PNG を作って自分の目で見る（`pdftoppm -r 80 -png`）。良し悪しは目で決める（数字のための調整で見た目を悪くしない）。
