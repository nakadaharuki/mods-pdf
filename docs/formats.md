# PDF の新しい形式と添付（2026-10-09 の調べと、今のコード）

実物の確かめは CLI の `claude plugin test`（JavaScriptCore）。veraPDF が無いので、PDF/A・UA・X に「準拠」とは書かない。

## 今のコード

- 版: pdf-lib が書く `%PDF-1.7` のまま。7 ビットの字だけ（save7bit）で、2 進の注釈行は付けない。PDF 2.0 への書き換え・PDF/A の宣言（pdfaid）・OutputIntent は入れていない。
- 添付（render/meta.mjs・render/pdf.mjs）:
  - 入力の `attach` は**真偽だけ**（deck の既定 true・doc の既定 false。真偽以外は既定に戻して警告）。添える物の一覧は入力から決まる（引数で名前や中身を渡す形ではない）。`renderPdf(layout, { fontBytes, source })` の source に make の入力そのものを渡した時だけ、normalize し直して決める。
  - 優先は `source.json`（元の原稿。revise の後は直した後の入力）→ datasets の `data-<id>.json` → `notes.md`（各枚の notes。1 枚も無ければ付けない）→ 表にできる datasets の `.csv`（x と並んだ列・同じ形の行の配列だけ）。
  - 名前は ASCII（英数字と `._-`、重なれば -2・-3）。日本語は説明（Desc）に置く。`rel` は Source・Data・Supplement。名前の木は pdf-lib が並べ替えないので、名前の順に添える。
  - CSV は CRLF と BOM 付き UTF-8（Excel が BOM なしを ANSI と読んで日本語が化けるため）。式に読まれる先頭の字（= + - @ とタブ・復帰）には ' を付ける（CSV インジェクション）。
  - 上限: 元の入力が 200,000 字を超えると source.json は入れない。添える物の元のバイト数の合計 2 MiB（超えた分は後ろから入れず警告）。PDF 全体が 4 MiB を超えたら添付だけ落として警告する。
  - XMP（dc:title・dc:creator・dc:language・xmp:CreatorTool・日付）は catalog の /Metadata に付ける。ASCII のまま流れにして、save7bit が ASCII85 で包む。
- 大きさ: 書き込みは UTF-8 で 4,194,304 バイトまで。ASCII85 と 80 字ごとの改行で、元の 1 バイトが 1.266〜1.268 字になる。書く前に save7bit の後の字数で数えて止める。
- モジュールは 1 ファイル 1 MiB 未満（公式に無い・実測）。vendor/pdf.mjs は 809,487 B。ECharts は 12 ファイルに割ってある（docs/assets.md）。ICC・書体・見本などのデータは JS に埋めず、データのファイルとして読む。

## 調べて決めたが、まだ入れていない物

- PDF 2.0 のヘッダー: 同じ長さの `1.7` を `2.0` に書き換えれば xref はずれない。
- PDF/A-4f（`pdfa: '4f'`）: 頭の 4 つの 0x81 を `U+00E6 U+00DF` に替え、書いた後に読み戻して先頭と startxref を確かめる。trailer の /Info を作らず題などは XMP に書く。/ID は XMP の SHA-256 から。OutputIntent に ICC を埋めるが、sRGB の ICC（ICC 公式の v4）のダウンロードとライセンスの確かめは本人の許可の後（未確認）。JSON・CSV・Markdown を添付するなら 4f を名乗る。
- 図に元のデータを付ける時は、Figure の構造要素と FileAttachment 注釈の `AF` に同じ ref を入れる。CheckSum（MD5）は crypto.subtle に MD5 が無いので書けない。pdf-lib の `AFRelationship.FormData` は 'EncryptedPayload' になる不具合があるので使わない。

## できない物

- PDF/X-4・X-6: 出力の意図に印刷機の ICC（class `prtr`）が要る。配れる物が無い。
- 署名・暗号（ISO/TS 32001〜32004）: crypto.subtle に sign・encrypt が無い。
- PDF/UA-2: 構造の木までは作れるが、検査器が無いので名乗らない。
- 未確認: デスクトップの `$.fs.write` の文字コードと 1 MiB の制限、Acrobat・Preview での見え方。
