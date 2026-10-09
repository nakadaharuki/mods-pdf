# 資料（deck）の約束（2026-10-09 の回の結果）

まずこの文書、次に docs/design.md（§1〜§3）と docs/looks.md。design.md と違う所はこの文書が正。

本人 2026-10-09: 「横 A4 を標準にしながら、選択できる感じ。印刷できるプレゼン資料って感じのイメージ」「普通に事業計画とか作るものをまずは作って、それが金融系も使える形」「look の形のレパートリーを増やすほうが、ツールを使う時の速さと軽さと洗練さがある」「修正が入らない構成にしたい」（人が絵を見て直さなくて済む）「白黒こだわるのやめて」。手本の水準は ARK の Big Ideas 2026（16:9）。ARK の絵・文・ブランドは写さない。

## 0. 範囲

できる: 資料の型（`kind: 'deck'`・1 枚 = 1 頁・横 A4 が既定・`paper: 'wide'` は 960×540pt）、図は `{ kind, data }` で look の形を呼ぶ、事業計画の形 13、描画の層（グラデーション・不透明度・blend・角丸・path の clip・RectOp の影）、事業計画の型（`template: 'bizplan'`）、`make` の資料対応と 1 枚ずつ直す `revise`、元の原稿とデータの添付、組んだ後の自動の検査（§4.5）。

まだ・やらない: 一般のぼかしの影（RectOp の角丸の四角だけ）・一般のソフトマスク・メッシュと円錐のグラデーション・模様（tiling）・CMYK・特色・PDF/A・UA・X の名乗り（veraPDF が無い）・縦組み・3D の絵。

## 1. 決まり

全員の決まり（資料の回から今も効く物）:
- `$` を書くのは hooks/mods-pdf.mjs だけ（design.md §2）。乱数は種つきだけ。
- 日本語の文書の組みを動かさない: 直したら `npm --prefix C:/dev/mods-pdf run snapshot` が 7/7 同じ。資料の型・テーマ・描画を足しても、mono の A4 縦の文書の字の位置は 1 つも動かない。
- 試験は振る舞いを名前にする。コメントは選ばなかった案と理由だけ。

## 2. Display List に足した物（§3.1 の続き。今の欄の意味は変えない）

```js
/** @typedef {{ at: number, color: Color, opacity?: number }} Stop      // at は 0〜1 の昇順。opacity の既定 1 */
/** @typedef {{ kind: 'linear', x1, y1, x2, y2, stops: Stop[] } | { kind: 'radial', cx, cy, r, fx?, fy?, stops: Stop[] }} Paint   // 座標は頁の pt */
/** @typedef {'normal'|'multiply'|'screen'|'overlay'|'darken'|'lighten'|'color-dodge'|'color-burn'|'hard-light'|'soft-light'|'difference'|'exclusion'} Blend */
/** @typedef {{ dx: number, dy: number, blur: number, color: Color, opacity: number }} Shadow */
```

- `PathOp`・`RectOp`・`TextOp` に `paint?`。`fill`・`color` は文字列のまま残り、paint を読めない時の色になる。
- `RectOp` に `r?`（角丸 pt）・`opacity?`・`shadow?`。`TextOp`・`ImageOp` に `opacity?`。`PathOp`・`RectOp`・`TextOp`・`ImageOp` に `blend?`。
- `ClipOp` に `d?`（M・L・C・Z の path。あればこの形で切り、x・y・w・h はその外接の四角）。
- `TextOp.paint` があれば PDF は字を切り抜き（Tr 7）にして塗る。欄は `fill="url(#…)"`。

PDF の書き方（render/pdf.mjs・render/paint.mjs）:
- グラデーションは Pattern type 2 + Shading type 2/3 + Function type 3。止まりに opacity < 1 があれば、同じ形の輝度のソフトマスク（DeviceGray の Form XObject）を ExtGState の SMask で掛ける。BBox は頁全体（BC の既定が黒で BBox の外が消えるため）。
- ExtGState は (ca, CA, BM, SMask) の組ごとに 1 つ作って頁の中で使い回す。不透明度か blend を使った頁は Group（/S /Transparency /CS /DeviceRGB）を持つ。
- Shading・Pattern・ColorSpace は pdf-lib に頁の辞書へ足す口が無いので、頁の Resources に手で足す。流れ（stream）は全部 register して参照で持つ（直に入れた流れは save7bit の 7 ビットの確かめに落ちる）。
- 影は角丸の四角の α を JS の画素（最大 100 万画素・1 文書 1,200 万）に描き、箱ぼかし 3 回で SMask つきの画像にする。資料の札は影を使わない（印刷では紙の汚れに見える）。
- vm の中の繰り返しは Math.* を大域から引かない（モジュールの変数に入れる）。

欄（render/svg.mjs）: グラデーションは `<defs>` の linearGradient・radialGradient（id は頁ごとの頭を付ける）、blend は `mix-blend-mode`、path の clip は clipPath、影は feDropShadow。欄に base64 の画素を入れない（131,072 字の上限）。

## 3. Doc に足した物（schema）と添付

```js
/** Doc: { kind: 'doc'|'deck', …今の欄…, paper: 'A4'|'A5'|'B5'|'Letter'|'wide', landscape,   // deck は paper が wide でなく landscape の指定が無ければ横。'wide' は landscape を見ない
 *   slides?: Slide[], datasets?: { [id]: { data: object, source?: string, asOf?: string } },
 *   attach?: boolean }                       // 元の原稿とデータを PDF に添える。deck の既定 true・doc の既定 false
 *
 * Slide: { type: 'slide', layout: Layout, id?, kicker?, title?, lead?, number?, date?, by?, quote?,
 *   blocks?: Block[], left?: Block[], right?: Block[], ratio?: '5:7'|'6:6'|'7:5', figure?: Block, side?: Block[],
 *   items?: object[], panels?: Panel[], arrange?: string, notes?: string, sources?: string[] }
 * Layout: 'cover'|'section'|'statement'|'grid'|'content'|'split'|'figure'|'kpi'|'compare'|'table'|'quote'|'closing'
 * Panel: { title?, note?, source?, span?, emphasis?, kpi?: KpiItem[] | look | chart | table | list | text }
 * KpiItem: { label, value, unit?, delta?, trend?: 'up'|'down'|'flat', note?, logo? }
 *
 * chart の Block: { type: 'chart', kind?, data?, dataset?, example?, theme?, option?, height?, caption?, alt? }
 *   kind があれば look の形（drawLook）。dataset があれば datasets[id].data を data に、source を slide の sources に足す。
 *   example があれば ECharts の見本（docs/assets.md）。kind と example が両方あれば kind を使う。 */
```

- 上限: slides 120 枚・1 枚の blocks 12 個・panels 9 個・datasets 40 個（1 つの data は JSON で 200,000 字）。超えたら切って warnings。
- Markdown で資料（`kind: 'deck'` と `markdown`）: 囲み（```）の外の `---` だけの行が 1 枚の区切り。1 枚の頭の `# X` は section、`## X` は題名。型は中身から決める（図 1 つだけ → figure・題名と 1 行だけ → statement・ほか → content）。囲み ```chart は JSON。
- `template: 'bizplan'` と `plan`（§7）は templates/bizplan.mjs が slides に広げる。slides も来たら、広げた後ろに足す。

### 添付

資料の PDF には元の原稿（source.json）・datasets（JSON と、表にできる形は CSV）・notes.md を添える。形式は docs/formats.md。

## 4. 資料の頁（engine/lay-slide.mjs）

```js
/** 1 枚を 1 頁の Op にする */
export function laySlide(slide, ctx) → { ops, warnings, outline, missing, counts, body? }
/** body: { top, height, used } は本文の区域と、panel の中身が占める高さ。panel の格子で組んだ枚だけが持ち、layout.mjs が頁の body に写し、inspect が空いた枚を数える */
```

layout.mjs は `doc.kind === 'deck'` の時だけ lay-slide に渡す（doc の組みは動かない）。知らない layout は grid で組んで警告する。

### 4.1 寸法（A4 横 841.89pt を 1 とし、wide は幅の比 960/841.89 を掛ける。字には床があり、小さい紙でも 7pt を割らない）

- 余白: 左右 26・上 24・下 22。12 段・段の間 8。本文の行送りは字の 1.6 倍。
- 頭: kicker 8pt（無ければ section の題）・題 18pt（2 行まで。入らなければ 16・14pt）・lead 10pt（2 行まで）。題の下に grad の細い帯。
- 字（A4 横）: 表紙の題 40・副題 16・section の題 36・番号 96・statement 30・KPI の数 30・label 9・note 8・panel の題 9・panel の注 7・出典 7。本文 9.5（→ 9 → 8.5）・表 8.5（→ 8 → 7.5）。
- 足: 左に出典（「出典: 」でつなぎ 1 行・7pt・sub）、右に「n / N」7.5pt。表紙・section・closing は足なし。

### 4.2 型と、panel への写し方

- 表紙・section・statement・quote・closing は専用の組み（余白を広く取る）。
- 本文のある型（grid・content・split・figure・kpi・compare・table）は全部「頭の帯 + panel の格子」に写して組む。写し方（panelsOf）:
  - content・table: blocks を分ける。見出しは次の panel の題、図・表は 1 つずつ panel、字の block は続く限り 1 つの panel、keys は kpi の panel。
  - split: left と right（ratio の割合が span）。figure: figure（side があれば span 2）と side。kpi: items 全部で 1 つの kpi の panel。compare: items 1 つにつき 1 panel（highlight は emphasis）。grid: panels そのまま。
- 並べ方 `arrange`: auto・1+2・2x2・3col・1+3・kpi+3・2x3、または `rows:行ごとの個数|行の高さの重み`（例 `rows:1,2,1|0,1,1.3`。KPI だけの行は自然な高さの帯）。auto は panel の数と先頭の型で決める。panel は 9 個まで・KPI の項目は 1 panel に 6 個まで。
- panel は薄い地の札（題・注・出典つき）。図は札の中の大きさのまま描き、字・表は本文の段（§4.3）から入る段を探す。

### 4.3 はみ出し

1 枚は必ず 1 頁。入らない時は ① 本文の段を 1 つ下げる（本文 9.5 → 9 → 8.5・表 8.5 → 8 → 7.5。panel ごとでなく 1 枚で 1 つの段にそろえる） ② それでも入らない block は落として、warnings に「n 枚目（題名）に入らない: 何の block」を書く。黙って次の頁に流さない・黙って捨てない。

字を上げる段は無い。余白が大きい枚で字を 14〜20pt に上げる案は、3 つの箇条書きが頁の半分を占めて薄く見えるので採らなかった。空きは字の大きさでなく、panel の数と配置で埋める。

### 4.4 テーマ（theme.mjs）

mono・koma・mergeble はそのまま使える。**既定は色のテーマ**（本人「カラーじゃないと見にくい」）で、mono は選べる 1 つ。
- `vivid`（資料の既定）: ink #15131D・sub #4B4858・rule #DCD9E3・tint #F4F2F8・accent #6A3DE8・accent2 #F0562E・up #157F3B・down #C0261E・paper #FFFFFF・grad ['#3B2FD9', '#A12BD6', '#F2542D']。表紙と section は grad の大きな放射の光と題名の字のグラデーション。content 系は題名の下に grad の細い帯（幅 48・太さ 3）だけで、地は白。
- mono で資料: grad が単色（theme.deck.flat）になり、光を出さない。
- Theme の `deck: { scale, margin, grid, flat, sizes }` と `colors.accent2`・`colors.grad`。`makeTheme({ kind: 'deck', … })`。doc の Theme の値は 1 つも変えない。

タグ: section の題は H1、slide の題は H2、本文は今のまま（P・L・Table・Figure（alt 必須）・Caption）。outline に section（level 1）と題（level 2）。

### 4.5 検査（engine/inspect.mjs）

組み上がった後に compose が自動で数える。人が絵を見て直さなくて済むための見張り。
- 字の重なり（縦横とも 1pt を超えて重なる）・箱の外（0.5pt を超えて出る。図の clip の範囲も）・「…」で切れた字・空いた枚（本文の区域の埋まり body.used / height が 0.85 未満）。字の箱は基線から上へ 0.8・下へ 0.15（字の大きさの比）で固定。
- 件数は `layout.meta.checks = { overlaps, outside, truncated, sparse }`。見つけた物は warnings に「n 頁: 字が重なっている …」の文で足す（1 頁 1 種類に字は 3 つまで）。
- make・revise の答えは「検査: 字の重なり a・箱の外 b・「…」の切れ c・空いた枚 d」の 1 行を必ず返し、0 でなければ最初の 10 件を続ける。Claude はこの件数が全部 0 になるまで revise で直す。

## 5. 図の入口（engine/figure.mjs・panel の中の図と、文書の図）

- 紙の文書は look が決めた字の大きさのまま。資料は `textMin = 7.5pt`（それより小さい字を look が描かない。paper.mjs の TICK・NOTE・LABEL・VALUE と text() が下限を持つ）。
- 色は `lookPal(theme)`（theme.mjs）の pal で描く。色のテーマ（vivid・koma・mergeble）は 8 色の `series` で系列・項目を分け、mono は series を持たず墨の濃さで分ける（looks.md）。
- `zoom`（planFigure の引数）は look を幅いっぱいに置いて拡大して描く道具で、字・線・余白が zoom 倍になる。拡大して「…」か字の行が増える時は半分の拡大、それでも増えるなら 1 倍に戻す。lay-slide は zoom を渡さない（panel の枠に自然な字の大きさのまま描く）。
- 描いた直後に検査（§4.5 の inspectSvg）。字の重なり・箱の外・「…」の切れが出て、形が並べるだけ（bars・lollipop・bullet・tiles・gauge・progress-rings・dumbbell・slope・funnel・sparks・bump）なら、後ろの項目を 1 つずつ落として描き直す（元の半分か 3 つまで・8 回まで）。問題が 0 になった時だけ採り、直らなければ全部を描く。減らした時は図の下に右寄せで「上位 n / N」（bars の x を落とす時は「先頭 n / N」）を描き、warnings にも書く。donut・waterfall・treemap・sankey・pnl・waffle は合計や割合が変わるので落とさない。
- 箱が高く、描いた物の上下の幅が箱の 50% 未満の細い図は、箱の縦の中央に置く（返す高さは箱のまま）。
- option は ECharts（chartToOps）。example・theme・data があれば chartBlockToOps（chart.mjs）が見本を土台に重ねる。紙に要らない部品（toolbox・tooltip・brush・axisPointer）は落とす。知らない example・壊れた JSON は投げず warnings に書く。

## 6. 事業計画向けの形（category 'biz'・looks/biz.mjs）

test/looks-biz.test.mjs がこの章の表の id の並びを読む（章の番号と表の形を変えない）。

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
| flowchart | 仕組み・お金とサービスの流れ | `{ nodes: { id, name, group? }[], links: { from, to, label? }[] }` |
| kpi-hero | 大きな数と小さな線 | `{ items: { name, value, unit?, delta?, spark?: number[] }[] }` |
| pnl | 収支の見通し（売上・費用の棒と利益の線・年平均の伸び） | `{ x: string[], revenue: number[], cost: number[], profit?: number[], unit }` |

look の決まり（枠と軸の線なし・目立たせるのは 1 つ・値は余白）を守る。pal.grad があれば、目立たせる 1 つと面に勾配を使ってよい（mono は単色）。見本の頁は `node C:/dev/mods-pdf/scripts/looks-preview.mjs`。

## 7. 事業計画の型（engine/templates/bizplan.mjs）

```js
/** plan を slides に広げる。足りない項目の頁は作らない（warnings に「plan.xxx が無いので○○を載せなかった」） */
export function expandBizplan(plan, { lang }) → { slides, datasets, warnings }
/** plan: { company, tagline?, date?, summary: string[], problem: { points, stat? }, solution: { points },
 *   market: { tam, sam, som: { value, label? }, unit, source? }, model?: { nodes, links } | { points },
 *   competition?: { x, y, players } | { columns, rows }, traction?: { kpis }, roadmap?: { items } | { milestones },
 *   financials: { years, revenue, cost, unit, source? }, team?: { members }, funding?: { amount, unit, use },
 *   risks?: { risk, answer }[], closing?: { message, next }, sources?: string[] } */
```

頁の順は 表紙 → 概要（課題・大きさ・解決策／市場・競合）→ 仕組みと実績（実績の帯／ビジネスモデル・ロードマップ／チーム）→ 収支と資金（収支・要点／資金・使途・リスク）→ 結び。計 5 枚。1 枚に 3〜5 個の panel を詰め、1 つの図は 1 回だけ使う。数字は datasets に入れ、図は dataset の名前で呼ぶ（利用者が同じ名前の datasets を渡せば、そちらが使われる）。体制図（org）は使わず、チームは表。

話題ごとに 1 枚（15 枚前後）にする案は、1 枚に図 1 つと箇条書き 3 本では下半分が空き、証券会社の月次の報告の密度にならないので採らなかった。

## 8. 道具（host）

- `make`: kind・slides・template・plan・datasets・attach・paper 'wide' を受ける。答えに枚の題の一覧と検査の 1 行。
- `revise`: `{ path?, ops: { action: 'replace'|'insert'|'delete'|'move', index（1 から）, to?, slide? }[], theme?, paper?, title? }`。store の `pdf:last` の input に当てて組み直し、同じ場所に書く。1 つでも失敗したら何も書かない。1 回の ops は 60 個まで。
- `pdf_examples`: ECharts の見本の目録を引く（docs/assets.md）。
- 欄: 横長の頁の比で出す。1 枚ずつ・前と次と開く。
- `/pdf sample deck` で事業計画の見本（hooks/sample.mjs。架空の会社）。
- hook-env-check に「資料 15 枚を vm で 3 秒以内に組んで書ける」。

## 9. 確かめ

`npm --prefix C:/dev/mods-pdf run` の `test:unit`・`check`・`snapshot`（7/7）・`verify:all`・`validate`。見た目は `node C:/dev/mods-pdf/scripts/deck-preview.mjs` が samples（bizplan・deck・deck-wide・looks・portfolio）の PDF と頁の絵を out/deck/ に書くので、絵を見て決める（数字のための調整で見た目を悪くしない）。test:unit の時間の上限の試験（layout の 600 ms・svg の 20 万段・guard の 4 MiB）は、全件を並列で流して重い時だけ落ちる（単独では通る）。
