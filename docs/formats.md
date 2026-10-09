# PDF の新しい形式と添付（2026-10-09 の調べ）

試しの物は scratchpad の pdf-next/fmt・spec・skeptic（このリポの外）。実物の確かめは CLI 2.1.289 の `claude plugin test`（JavaScriptCore）。veraPDF は無いので、PDF/A・UA・X に「準拠」とは書かない（形を合わせたまで）。

## 決めたこと

- 普通の出力は PDF 2.0 の 7 ビットのまま。2 進の注釈行は付けない（ISO 32000-2 の errata 7.5.2: 2 進のデータを含む時だけの決まり）。pdf-lib は `%PDF-1.7` を書くので、同じ長さの `1.7` → `2.0` に書き換える（xref はずれない）。
- PDF/A-4f の型（`pdfa: '4f'`）:
  - 頭の 4 つの 0x81 を `U+00E6 U+00DF`（UTF-8 で 4 バイト）に替える。書いた後に `$.fs.read(p, {as:'bytes'})` で読み戻し、頭のバイトと startxref の先が `xref` かを確かめる（poppler は壊れても黙って直すので、見た目では気づけない）。
  - trailer の `/Info` を作らない（render/pdf.mjs の setTitle・setAuthor・setSubject・setCreator・setProducer を呼ばない）。題などは XMP に書く。
  - XMP（pdfaid part=4・rev=2020・conformance=F・dc:title・日付）は ASCII85 に包んでよい（veraPDF の規則で禁じられているのは LZW だけ）。7 ビットのままで、OUT_MAX の字数の数えも正しいまま。
  - `/ID` は XMP の SHA-256 から。
  - OutputIntent に ICC を埋める。sRGB の ICC は ICC の公式の sRGB v4（変えずに配る条件）を候補にする。ダウンロードとライセンスの確かめは本人の許可の後（未確認）。
  - RGB と CMYK を混ぜる頁は、出力の意図のほかに DefaultRGB か DefaultCMYK の ICC が要る。CMYK の ICC を配れる物が無いうちは、PDF/A では RGB だけにする。
  - JSON・CSV・Markdown を添付するなら 4f を名乗る（素の 4 は PDF/A の物しか添付できず、PDF/A-3 も不可）。
- 添付（`attach: [{ name, path|text, mime, rel, desc }]`）:
  - `doc.attach(bytes, asciiName, { mimeType, description, creationDate, modificationDate, afRelationship })`。`rel` は Data・Source・Supplement・Alternative・Unspecified。pdf-lib の `AFRelationship.FormData` は 'EncryptedPayload' になる不具合があるので使わない。
  - `F` は ASCII の名前（`[A-Za-z0-9._-]`）だけ。日本語の名前は flush の後に `UF` を `PDFHexString.fromText` で上書きする。
  - 名前の木は pdf-lib が並べ替えないので、名前の順に attach する。
  - CheckSum（MD5）は書けない（crypto.subtle は digest だけで MD5 なし）。
  - 図に元のデータを付ける時は、Figure の構造要素と、クリップの注釈（FileAttachment・/AP あり）の `AF` に同じ ref を入れる。
- 大きさ: 書き込みは UTF-8 で 4,194,304 バイトまで。ASCII85 と 80 字ごとの改行で、元の 1 バイトが 1.266〜1.268 字になる。書く前に、save7bit の後の字数（PDF/A は +2）で正確に数えて止める（×1.25 の見積もりで決めない）。300 KB の資料の横に入るのは、圧縮できない物で約 3.0 MB、日本語の Markdown で約 7.4 MB。
- モジュールは 1 ファイル 1 MiB まで（公式に無い・実測）。vendor/pdf.mjs は 809,487 B、vendor/echarts.mjs は 1,040,962 B で、どちらも余りが少ない。足す物は別のファイルに割る。ICC・書体などのデータは JS に埋めず、データのファイルとして bytes で読む。

## できない・まだの物

- PDF/X-4・X-6: 出力の意図に印刷機の ICC（class `prtr`）が要る。配れる物が無いので今はしない。
- 署名・暗号（ISO/TS 32001〜32004）: crypto.subtle に sign・encrypt が無い。
- PDF/UA-2: 構造の木（Document 1 つ・PDF 2.0 の名前空間 `http://iso.org/pdf2/ssn`・Alt・表の Scope）までは作れる。宣言の URI は errata の `http://pdfa.org/declarations/wtpdf#accessibility1.0`。検査器が無いので名乗らない。
- 未確認: デスクトップの `$.fs.write` の文字コードと 1 MiB の制限、Acrobat・Preview での見え方、PDF/A-4 での ICC v4 の扱い。
