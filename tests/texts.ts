// PDF に組まれる日本語の文を集めた物。scripts/build-test-fonts.mjs は、このファイルの字だけを試験用の書体に残す。
// 試験の名前や期待値の字は PDF に載らないので、ここに入れない（入れると書体が太る。漢字 1 字が 400 バイト前後）。

const REPORT_MD = ['# 見積書', '', '{紫陽花|あじさい}の件です。Claude Code の費用は 12,000 円です。', '', '- 作業', '- 納品'].join('\n')

const FORM_MD = ['# 申込書', '', '```fields', JSON.stringify([
  { kind: 'text', name: '氏名', label: '氏名' },
  { kind: 'check', name: '同意', label: '同意する' },
  { kind: 'choice', name: '種別', label: '種別', options: ['個人', '法人'] },
]), '```'].join('\n')

export const D = {
  report: '見積書',
  reportMd: REPORT_MD,
  form: '申込書',
  formMd: FORM_MD,
  nameField: '氏名',
  agreeField: '同意',
  noSuchField: '存在しない欄',
  person: '山田 太郎',
  stampFile: '押印',
  first: '一冊目',
  firstMd: '# 一冊目\n\n本文\n\n<!-- pagebreak -->\n\n# 二頁目',
  second: '二冊目',
  secondMd: '# 二冊目\n\n本文',
  merged: '合本',
  pic: '画像',
  picMd: '# 画像\n\n![ちいさな絵](pic.png)\n\n![にせもの](fake.png)\n',
  fakeContent: 'これは画像ではない',
  three: '三頁',
  threeMd: '# 一\n\n<!-- pagebreak -->\n\n# 二\n\n<!-- pagebreak -->\n\n# 三',
  prev: '前の文書',
  prevMd: '# 前の文書\n\n本文です。',
  big: '大きな文書',
  noTitleMd: '# 題名なし',
  weird: '名前',
  weirdMd: '# 見出し',
}
