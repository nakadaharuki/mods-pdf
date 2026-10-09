# LICENSES

hooks/vendor/ の束（pdf.mjs・echarts.mjs・text.mjs・d3.mjs）に入った OSS と、fonts/ の書体のライセンス。
ライセンスの全文は `npm/<パッケージ名>/` の下の原本の写し（npm の包みに入っていた LICENSE などを、そのままの名前で写した）。
写した元: `node_modules/<パッケージ名>/`（2026-10-09・scripts/build-vendor.mjs で束を作った時点）。d3 の部品だけは下の「d3」の節のとおり別の置き場から。

## 束ごと（esbuild の metafile で束に入った物）

| 束 | 入った npm の物（版） | ライセンス | 全文（LICENSES からの場所） | 著作権の行（LICENSE の中の記載） |
|---|---|---|---|---|
| hooks/vendor/pdf.mjs | pdf-lib 1.17.1 | MIT | npm/pdf-lib/LICENSE.md | Copyright (c) 2019 Andrew Dillon |
| 同上 | @pdf-lib/standard-fonts 1.0.0 | MIT | npm/@pdf-lib/standard-fonts/LICENSE.md | Copyright (c) 2018 Andrew Dillon |
| 同上 | @pdf-lib/upng 1.0.1 | MIT | npm/@pdf-lib/upng/LICENSE | Copyright (c) 2017 Photopea |
| 同上 | pako 1.0.11 | MIT AND Zlib | npm/pako/LICENSE | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn |
| 同上 | restructure 3.0.2 | MIT | npm/restructure/LICENSE | Copyright (c) 2015-present Devon Govett |
| 同上 | tiny-inflate 1.0.3 | MIT | npm/tiny-inflate/LICENSE | Copyright (c) 2015-present Devon Govett |
| 同上 | unicode-properties 1.4.1 | MIT | npm/unicode-properties/LICENSE | 「Copyright 2018」のみ（著作権者の名は LICENSE に無い） |
| 同上 | unicode-trie 2.0.0 | MIT | npm/unicode-trie/LICENSE | 「Copyright 2018」のみ（著作権者の名は LICENSE に無い） |
| 同上 | base64-js 1.5.1 | MIT | npm/base64-js/LICENSE | Copyright (c) 2014 Jameson Little |
| 同上 | clone 2.1.2 | MIT | npm/clone/LICENSE | Copyright © 2011-2015 Paul Vorbach |
| 同上 | fast-deep-equal 3.1.3 | MIT | npm/fast-deep-equal/LICENSE | Copyright (c) 2017 Evgeny Poberezkin |
| 同上 | tslib 2.3.0 | 0BSD | npm/tslib/LICENSE.txt | Copyright (c) Microsoft Corporation. |
| 同上 | @swc/helpers 0.5.23（fontkit の依存） | Apache-2.0 | npm/@swc/helpers/LICENSE | 本文の付録に「Copyright 2024 SWC contributors」 |
| 同上 | fontkit 2.0.4 | MIT（上流は README と package.json の記載だけ） | npm/fontkit/LICENSE（MIT の標準の文。著作権者は package.json の作者） | Copyright (c) Devon Govett（年は上流に記載なし） |
| 同上 | brotli 1.3.3・dfa 1.2.0（fontkit の依存） | MIT（上流は README と package.json の記載だけ） | npm/brotli/LICENSE・npm/dfa/LICENSE（同上） | Copyright (c) Devon Govett（年は上流に記載なし） |
| hooks/vendor/echarts.mjs | echarts 6.1.0 | Apache-2.0 | npm/echarts/LICENSE・npm/echarts/NOTICE（束の出典は NOTICE の Apache ECharts） | Apache Software Foundation（NOTICE: Copyright 2017-2026 The Apache Software Foundation） |
| 同上 | echarts 内の d3 由来のコード | BSD-3-Clause | npm/echarts/licenses/LICENSE-d3 | Copyright 2010-2016 Mike Bostock（d3.js） |
| 同上 | zrender 6.1.0 | BSD-3-Clause | npm/zrender/LICENSE | Copyright (c) 2017, Baidu Inc. |
| 同上 | tslib 2.3.0（上と同じ） | 0BSD | npm/tslib/LICENSE.txt | Copyright (c) Microsoft Corporation. |
| hooks/vendor/text.mjs | marked 18.0.14 | MIT | npm/marked/LICENSE | Copyright (c) 2018+, MarkedJS・Copyright (c) 2011-2018, Christopher Jeffrey |
| 同上 | budoux 0.9.2（dist の parser と ja のモデル） | Apache-2.0（package.json） | **npm の包みに LICENSE が無い**。Apache-2.0.txt を使う（その本文と付録） | Copyright 2021 Google LLC（ソースの見出し） |
| 同上 | hypher 0.2.5（Liang のパターンで語を割る。英語のハイフン） | BSD-3-Clause | npm/hypher/BSD.txt | Copyright (c) 2011, Bram Stein |
| 同上 | hyphenation.en-us 0.2.1（hyph-en-us のパターン約 4,900 個） | Gerard D.C. Kuiken の許諾文（変更の有無を問わず、著作権表示とこの許諾文を残せば無償で複製・配布してよい） | **npm の包みに LICENSE も license 欄も無い**。npm/hyphenation.en-us/LICENSE は、元の hyph-en-us.tex の見出しの許諾文を写した物 | Copyright (C) 1990, 2004, 2005 Gerard D.C. Kuiken（hyph-en-us.tex の見出し） |

## d3（hooks/vendor/d3.mjs・図の形 looks が使う）

hooks/vendor/d3.mjs は、本人の look Mod の hooks/vendor/d3.mjs と同じ入口（C:/dev/modscode の vendor-src/d3-entry.mjs）・同じ版の d3 の部品を、識別子を縮めずに束ね直した物（縮めると名前が一字になり、hook-env-check の「ドル記号の直後の点」の検査が落ちる）。出典と束ね方は hooks/vendor/d3.manifest.json。
d3 の行の LICENSE は mods-pdf の node_modules でなく、C:/dev/modscode の node_modules（look の LICENSES/ と同じ版）から写した。d3-sankey と d3-hexbin は BSD-3-Clause（著作権表示と条件を LICENSE ごと残す）・robust-predicates は Unlicense・ほかは ISC。

| npm の物（版） | ライセンス | 全文（LICENSES からの場所） | 著作権の行（LICENSE の中の記載） |
|---|---|---|---|
| d3-array 3.2.4 | ISC | npm/d3-array/LICENSE | Copyright 2010-2023 Mike Bostock |
| d3-chord 3.0.1 | ISC | npm/d3-chord/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-color 3.1.0 | ISC | npm/d3-color/LICENSE | Copyright 2010-2022 Mike Bostock |
| d3-contour 4.0.2 | ISC | npm/d3-contour/LICENSE | Copyright 2012-2023 Mike Bostock |
| d3-delaunay 6.0.4 | ISC | npm/d3-delaunay/LICENSE | Copyright 2018-2021 Observable, Inc.・Copyright 2021 Mapbox |
| d3-dispatch 3.0.1 | ISC | npm/d3-dispatch/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-force 3.0.0 | ISC | npm/d3-force/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-format 3.1.0 | ISC | npm/d3-format/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-hexbin 0.2.2 | BSD-3-Clause | npm/d3-hexbin/LICENSE | Copyright Mike Bostock, 2012-2016 |
| d3-hierarchy 3.1.2 | ISC | npm/d3-hierarchy/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-interpolate 3.0.1 | ISC | npm/d3-interpolate/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-path 3.1.0 | ISC | npm/d3-path/LICENSE | Copyright 2015-2022 Mike Bostock |
| d3-polygon 3.0.1 | ISC | npm/d3-polygon/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-quadtree 3.0.1 | ISC | npm/d3-quadtree/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-random 3.0.1 | ISC | npm/d3-random/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-sankey 0.12.3 | BSD-3-Clause | npm/d3-sankey/LICENSE | Copyright 2015, Mike Bostock |
| d3-scale 4.0.2 | ISC | npm/d3-scale/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-shape 3.2.0 | ISC | npm/d3-shape/LICENSE | Copyright 2010-2022 Mike Bostock |
| d3-time 3.1.0 | ISC | npm/d3-time/LICENSE | Copyright 2010-2022 Mike Bostock |
| d3-time-format 4.1.0 | ISC | npm/d3-time-format/LICENSE | Copyright 2010-2021 Mike Bostock |
| d3-timer 3.0.1 | ISC | npm/d3-timer/LICENSE | Copyright 2010-2021 Mike Bostock |
| delaunator 5.1.0 | ISC | npm/delaunator/LICENSE | Copyright (c) 2026, Mapbox |
| internmap 2.0.3 | ISC | npm/internmap/LICENSE | Copyright 2021 Mike Bostock |
| robust-predicates 3.0.3 | Unlicense | npm/robust-predicates/LICENSE | 著作権の主張なし（パブリックドメインへの献呈。LICENSE の冒頭） |

Apache-2.0.txt は node_modules/echarts/LICENSE の 1〜202 行（Apache License 2.0 の本文と付録）の写し。echarts の LICENSE の後ろにある「Apache ECharts Subcomponents」の一覧（d3 など）は含めない（それは npm/echarts/LICENSE に残してある）。
budoux の著作権の行はソースの見出し（dist/parser.js など）から取った。

## 書体（fonts/・LICENSES の外の OFL）

| 書体 | ライセンス | 著作権の行（書体の name 表） | 全文 |
|---|---|---|---|
| Noto Sans JP（fonts/NotoSansJP-JIS-400.ttf・-700.ttf。C:\Windows\Fonts\NotoSansJP-VF.ttf を太さで切り出した物） | SIL Open Font License 1.1 | © 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. | OFL-1.1.txt |
| Zen Old Mincho（fonts/ZenOldMincho-JIS-400.ttf・-700.ttf。C:\dev\kit\files\fonts の Regular と Bold から） | SIL Open Font License 1.1 | Copyright 2021 The Zen Old Mincho Project Authors (https://github.com/googlefonts/zen-oldmincho) | OFL-1.1.txt |

OFL-1.1.txt は C:\dev\kit\files\fonts\OFL.txt の写し。冒頭の著作権の行は Zen Old Mincho のもの。
Noto Sans JP の著作権の行は、書体の name 表（ID 0）と、repo の fonts/NotoSansJP-JIS-400.ttf の name 表から読んだ（両方とも同じ行）。
Reserved Font Name 'Source' は、手を加えた版（subset もこれに当たる）の名前に「Source」を使えないという条件。ModsPDF の subset の名前は Noto Sans JP のままで「Source」を含まないので、条件に合う（OFL 1.1 の 3 条）。
