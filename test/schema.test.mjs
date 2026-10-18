// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, plainText } from '../hooks/engine/inline.mjs'
import { fromMarkdown, normalize, LIMITS } from '../hooks/engine/schema.mjs'

/** 逃がしの字は数で作る（ツールを通る間に化けない） */
const BS = String.fromCodePoint(0x5c)
const FENCE = '```'

/** @param {string} s */
const t = (s) => [{ text: s }]

// ---------------------------------------------------------------- parseInline

test('parseInline: **太字** は bold の Inline になる', () => {
  assert.deepEqual(parseInline('前**太**後'), [{ text: '前' }, { text: '太', bold: true }, { text: '後' }])
})

test('parseInline: {親字|るび} は ruby になる', () => {
  assert.deepEqual(parseInline('{漢字|かんじ}です'), [{ text: '漢字', ruby: 'かんじ' }, { text: 'です' }])
})

test('parseInline: 2 つ目からの縦棒はモノルビの区切りとして ruby の字に残る', () => {
  assert.deepEqual(parseInline('{漢字|かん|じ}'), [{ text: '漢字', ruby: 'かん|じ' }])
})

test('parseInline: https・http・mailto のリンクだけ link になる', () => {
  assert.deepEqual(parseInline('[a](https://example.com/x)'), [{ text: 'a', link: 'https://example.com/x' }])
  assert.deepEqual(parseInline('[b](http://example.com)'), [{ text: 'b', link: 'http://example.com' }])
  assert.deepEqual(parseInline('[c](mailto:a@example.com)'), [{ text: 'c', link: 'mailto:a@example.com' }])
  assert.deepEqual(parseInline('[d](HTTPS://EXAMPLE.COM)'), [{ text: 'd', link: 'HTTPS://EXAMPLE.COM' }])
})

test('parseInline: javascript: と data: と相対パスは link にせず字のまま残す', () => {
  for (const src of ['[x](javascript:alert(1))', '[x](data:text/html;base64,AAAA)', '[x](./local.pdf)', '[x](ftp://example.com)', '[x](file:///etc/passwd)', '[x](JaVaScRiPt:alert(1))']) {
    const out = parseInline(src)
    assert.equal(
      out.some((i) => 'link' in i),
      false,
      src,
    )
    assert.equal(plainText(out), src)
  }
})

test('parseInline: リンクの url の空白や制御の字を含む物は link にしない', () => {
  assert.equal(
    parseInline('[x](https://a.example/b c)').some((i) => i.link),
    false,
  )
  assert.equal(
    parseInline('[x](https://a.example/' + String.fromCodePoint(0x202e) + 'b)').some((i) => i.link),
    false,
  )
})

test('parseInline: url の後ろの "題" は捨ててリンクにする', () => {
  assert.deepEqual(parseInline('[x](https://a.example "題")'), [{ text: 'x', link: 'https://a.example' }])
})

test('parseInline: url の中の括弧は釣り合いを数える', () => {
  assert.deepEqual(parseInline('[w](https://en.wikipedia.org/wiki/A_(b))後'), [{ text: 'w', link: 'https://en.wikipedia.org/wiki/A_(b)' }, { text: '後' }])
})

test('parseInline: リンクの字が空なら url を字にする', () => {
  assert.deepEqual(parseInline('[](https://a.example)'), [{ text: 'https://a.example', link: 'https://a.example' }])
})

test('parseInline: `コード` は code になり、中の印を読まない', () => {
  assert.deepEqual(parseInline('a `**x** {y|z}` b'), [{ text: 'a ' }, { text: '**x** {y|z}', code: true }, { text: ' b' }])
})

test('parseInline: バックスラッシュの後の * { } [ ] ` | は字そのもの', () => {
  assert.deepEqual(parseInline(`${BS}*a${BS}* ${BS}{b${BS}} ${BS}[c${BS}] ${BS}\`d${BS}\` e${BS}|f`), [{ text: '*a* {b} [c] `d` e|f' }])
})

test('parseInline: 逃がしで印が働かなくなる（太字・ルビ・リンク）', () => {
  assert.deepEqual(parseInline(`${BS}**x**`), [{ text: '**x**' }])
  assert.deepEqual(parseInline(`${BS}{a|b}`), [{ text: '{a|b}' }])
  assert.deepEqual(parseInline(`${BS}[a](https://x.example)`), [{ text: '[a](https://x.example)' }])
})

test('parseInline: 逃がしの対象でない字の前のバックスラッシュはそのまま残る', () => {
  assert.deepEqual(parseInline(`C:${BS}dir${BS}file ${BS}`), [{ text: `C:${BS}dir${BS}file ${BS}` }])
})

test('parseInline: 閉じていない印は字のまま', () => {
  assert.deepEqual(parseInline('**閉じない'), [{ text: '**閉じない' }])
  assert.deepEqual(parseInline('{漢字|かん'), [{ text: '{漢字|かん' }])
  assert.deepEqual(parseInline('[字](https://x.example'), [{ text: '[字](https://x.example' }])
  assert.deepEqual(parseInline('[字'), [{ text: '[字' }])
  assert.deepEqual(parseInline('`閉じない'), [{ text: '`閉じない' }])
})

test('parseInline: 縦棒のない {} は字のまま・親字かるびが空でも字のまま', () => {
  assert.deepEqual(parseInline('{abc}'), [{ text: '{abc}' }])
  assert.deepEqual(parseInline('{|かん}'), [{ text: '{|かん}' }])
  assert.deepEqual(parseInline('{漢字|}'), [{ text: '{漢字|}' }])
  assert.deepEqual(parseInline('{漢字| }'), [{ text: '{漢字| }' }])
})

test('parseInline: 途中に別の { が来たら始めの { は字のままで、後ろのルビは読む', () => {
  assert.deepEqual(parseInline('{ {漢|かん}'), [{ text: '{ ' }, { text: '漢', ruby: 'かん' }])
})

test('parseInline: 空白に挟まれた ** は太字にしない', () => {
  assert.deepEqual(parseInline('2 ** 3 ** 4'), [{ text: '2 ** 3 ** 4' }])
})

test('parseInline: 空の ** と `` は字のまま', () => {
  assert.deepEqual(parseInline('a****b'), [{ text: 'a****b' }])
  assert.deepEqual(parseInline('a``b'), [{ text: 'a``b' }])
})

test('parseInline: 太字の中のルビとリンクを読む', () => {
  assert.deepEqual(parseInline('**{漢|かん}と[橋](https://a.example)**'), [
    { text: '漢', bold: true, ruby: 'かん' },
    { text: 'と', bold: true },
    { text: '橋', bold: true, link: 'https://a.example' },
  ])
})

test('parseInline: リンクの中の太字とルビとコードを読む', () => {
  assert.deepEqual(parseInline('[**強**{漢|かん}`c`](https://a.example)'), [
    { text: '強', bold: true, link: 'https://a.example' },
    { text: '漢', ruby: 'かん', link: 'https://a.example' },
    { text: 'c', link: 'https://a.example', code: true },
  ])
})

test('parseInline: 隣り合う同じ形の Inline はつなぐ', () => {
  assert.deepEqual(parseInline(`あ${BS}*い${BS}*う`), [{ text: 'あ*い*う' }])
  assert.deepEqual(parseInline('**a****b**'), [{ text: 'ab', bold: true }])
  assert.deepEqual(parseInline('**太**と**太**'), [{ text: '太', bold: true }, { text: 'と' }, { text: '太', bold: true }])
})

test('parseInline: ルビ付きの Inline はつながない（モノルビの意味が変わる）', () => {
  assert.deepEqual(parseInline('{甲|こう}{乙|こう}'), [
    { text: '甲', ruby: 'こう' },
    { text: '乙', ruby: 'こう' },
  ])
})

test('parseInline: 空の text の Inline を作らない', () => {
  for (const src of ['', '**a**', '{a|b}', `${BS}*`, '[](https://a.example)', 'x`y`']) {
    for (const it of parseInline(src)) assert.notEqual(it.text, '', src)
  }
  assert.deepEqual(parseInline(''), [])
})

test('parseInline: ほかの Markdown の印は字のまま', () => {
  assert.deepEqual(parseInline('*斜体* _下線_ ~~取消~~ # 見出し'), [{ text: '*斜体* _下線_ ~~取消~~ # 見出し' }])
})

test('parseInline: 閉じが無い印が何万回続いても時間がかからない', () => {
  const start = Date.now()
  parseInline('**a '.repeat(5000))
  parseInline('{a'.repeat(9000))
  parseInline('[a'.repeat(9000))
  parseInline('`'.repeat(1) + 'a'.repeat(19000))
  assert.ok(Date.now() - start < 3000)
})

// ---------------------------------------------------------------- fromMarkdown

test('fromMarkdown: 見出しは level 1〜3 で、4 以上は 3 にして warnings に書く', () => {
  const { blocks, warnings } = fromMarkdown('# 一\n\n## 二\n\n### 三\n\n#### 四\n\n###### 六')
  assert.deepEqual(
    blocks.map((b) => (b.type === 'heading' ? b.level : 0)),
    [1, 2, 3, 3, 3],
  )
  assert.ok(warnings.some((w) => w.includes('見出し')))
})

test('fromMarkdown: 段落の中の印を読む', () => {
  const { blocks } = fromMarkdown('これは**大事**で{漢字|かんじ}と[リンク](https://a.example)と`code`です')
  assert.deepEqual(blocks, [
    {
      type: 'para',
      text: [{ text: 'これは' }, { text: '大事', bold: true }, { text: 'で' }, { text: '漢字', ruby: 'かんじ' }, { text: 'と' }, { text: 'リンク', link: 'https://a.example' }, { text: 'と' }, { text: 'code', code: true }, { text: 'です' }],
    },
  ])
})

test('fromMarkdown: 段落の中の改行は、和字のそばなら消え、欧文どうしなら空白になる', () => {
  const { blocks } = fromMarkdown('日本語の行を\n折り返した文。\n\nfirst line\nsecond line\n\nPDFを\nつくる')
  assert.deepEqual(
    blocks.map((b) => (b.type === 'para' ? plainText(b.text) : '')),
    ['日本語の行を折り返した文。', 'first line second line', 'PDFをつくる'],
  )
})

test('fromMarkdown: 箇条書きと番号付きの箇条書き', () => {
  const { blocks } = fromMarkdown('- あ\n- い\n\n1. 一\n2. 二')
  assert.deepEqual(blocks, [
    { type: 'list', ordered: false, items: [t('あ'), t('い')] },
    { type: 'list', ordered: true, items: [t('一'), t('二')] },
  ])
})

test('fromMarkdown: 箇条書きの入れ子は 2 段目まで読む', () => {
  const { blocks, warnings } = fromMarkdown('- 親\n  - 子1\n  - 子2\n- 次')
  assert.deepEqual(blocks, [
    {
      type: 'list',
      ordered: false,
      items: [{ text: t('親'), items: [t('子1'), t('子2')], ordered: false }, t('次')],
    },
  ])
  assert.deepEqual(warnings, [])
})

test('fromMarkdown: 2 段目の番号付きは ordered を持つ', () => {
  const { blocks } = fromMarkdown('- 親\n  1. 子1\n  2. 子2')
  const list = /** @type {any} */ (blocks[0])
  assert.equal(list.items[0].ordered, true)
})

test('fromMarkdown: 3 段目以降は 2 段目に平らにして warnings に書く', () => {
  const { blocks, warnings } = fromMarkdown('- 一\n  - 二\n    - 三\n      - 四\n  - 五')
  assert.deepEqual(blocks, [
    {
      type: 'list',
      ordered: false,
      items: [{ text: t('一'), items: [t('二'), t('三'), t('四'), t('五')], ordered: false }],
    },
  ])
  assert.ok(warnings.some((w) => w.includes('3 段目')))
})

test('fromMarkdown: 箇条書きの項目の中の印を読み、タスクの印は四角の字にする', () => {
  const { blocks } = fromMarkdown('- **太**項目\n- [ ] 未\n- [x] 済')
  const list = /** @type {any} */ (blocks[0])
  assert.deepEqual(list.items[0], [{ text: '太', bold: true }, { text: '項目' }])
  assert.equal(plainText(list.items[1]), '□ 未')
  assert.equal(plainText(list.items[2]), '■ 済')
})

test('fromMarkdown: 表（GFM）の align を left・right・center にする', () => {
  const { blocks } = fromMarkdown('| 名 | 数 | 中 |\n|:---|---:|:---:|\n| あ | 1 | x |\n| い | **2** | y |')
  assert.deepEqual(blocks, [
    {
      type: 'table',
      head: [t('名'), t('数'), t('中')],
      rows: [
        [t('あ'), t('1'), t('x')],
        [t('い'), [{ text: '2', bold: true }], t('y')],
      ],
      align: ['left', 'right', 'center'],
    },
  ])
})

test('fromMarkdown: 表で align の指定が 1 つも無ければ align を付けない', () => {
  const { blocks } = fromMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
  assert.equal('align' in blocks[0], false)
})

test('fromMarkdown: 表のセルの中の縦棒の逃がしを字にする', () => {
  const { blocks } = fromMarkdown(`| a | b |\n|---|---|\n| x ${BS}| y | \`p${BS}|q\` |`)
  const table = /** @type {any} */ (blocks[0])
  assert.equal(plainText(table.rows[0][0]), 'x | y')
  assert.deepEqual(table.rows[0][1], [{ text: 'p|q', code: true }])
})

test('fromMarkdown: 引用の中の段落をつないで quote 1 つにする', () => {
  const { blocks } = fromMarkdown('> 一つ目の段落。\n>\n> 二つ目の段落。')
  assert.deepEqual(blocks, [{ type: 'quote', text: t('一つ目の段落。二つ目の段落。') }])
})

test('fromMarkdown: 水平線は rule になる', () => {
  assert.deepEqual(fromMarkdown('あ\n\n---\n\nい').blocks.map((b) => b.type), ['para', 'rule', 'para'])
})

test('fromMarkdown: ```chart は JSON の option を chart の Block にする', () => {
  const opt = { xAxis: { type: 'category', data: ['a', 'b'] }, series: [{ type: 'bar', data: [1, 2] }] }
  const { blocks, warnings } = fromMarkdown(`${FENCE}chart\n${JSON.stringify(opt)}\n${FENCE}`)
  assert.deepEqual(blocks, [{ type: 'chart', option: opt }])
  assert.deepEqual(warnings, [])
})

test('fromMarkdown: ```chart は { option, height, caption } の形でも読む', () => {
  const opt = { series: [{ type: 'line', data: [1] }] }
  const { blocks } = fromMarkdown(`${FENCE}chart\n${JSON.stringify({ option: opt, height: 180, caption: '図の説明' })}\n${FENCE}`)
  assert.deepEqual(blocks, [{ type: 'chart', option: opt, height: 180, caption: '図の説明' }])
})

test('fromMarkdown: ```keys は要点の Block になる', () => {
  const items = [
    { label: '売上', value: '1,200', note: '前年比 +5%' },
    { label: '利益', value: '300' },
  ]
  assert.deepEqual(fromMarkdown(`${FENCE}keys\n${JSON.stringify(items)}\n${FENCE}`).blocks, [{ type: 'keys', items }])
  assert.deepEqual(fromMarkdown(`${FENCE}keys\n${JSON.stringify({ items })}\n${FENCE}`).blocks, [{ type: 'keys', items }])
})

test('fromMarkdown: ```card は label と text（印を読む）の Block になる', () => {
  const { blocks } = fromMarkdown(`${FENCE}card\n{"label":"理由","text":"**重要**です"}\n${FENCE}`)
  assert.deepEqual(blocks, [{ type: 'card', label: '理由', text: [{ text: '重要', bold: true }, { text: 'です' }] }])
})

test('fromMarkdown: ```fields は記入欄の Block になる', () => {
  const items = [
    { kind: 'text', name: 'shimei', label: '氏名', value: '山田' },
    { kind: 'check', name: 'agree', label: '同意する', value: true },
    { kind: 'choice', name: 'kind', label: '種別', options: ['A', 'B'] },
  ]
  assert.deepEqual(fromMarkdown(`${FENCE}fields\n${JSON.stringify(items)}\n${FENCE}`).blocks, [{ type: 'fields', items }])
})

test('fromMarkdown: ```svg は字のまま svg の Block にし、alt は最初の title、無ければ「図」', () => {
  const withTitle = '<svg viewBox="0 0 10 10"><title>丸の図</title><circle cx="5" cy="5" r="3"/></svg>'
  const plain = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>'
  assert.deepEqual(fromMarkdown(`${FENCE}svg\n${withTitle}\n${FENCE}`).blocks, [{ type: 'svg', source: withTitle, alt: '丸の図' }])
  assert.deepEqual(fromMarkdown(`${FENCE}svg\n${plain}\n${FENCE}`).blocks, [{ type: 'svg', source: plain, alt: '図' }])
})

test('fromMarkdown: 壊れた JSON の囲みは段落にして warnings に書く', () => {
  for (const lang of ['chart', 'keys', 'card', 'fields']) {
    const { blocks, warnings } = fromMarkdown(`${FENCE}${lang}\n{壊れ\n${FENCE}`)
    assert.deepEqual(blocks, [{ type: 'para', text: t('{壊れ') }], lang)
    assert.ok(warnings.some((w) => w.includes(lang)), lang)
  }
})

test('fromMarkdown: JSON は読めても形がおかしい囲みは段落にして warnings に書く', () => {
  const { blocks, warnings } = fromMarkdown(`${FENCE}keys\n"文字だけ"\n${FENCE}`)
  assert.equal(blocks[0].type, 'para')
  assert.ok(warnings.length > 0)
})

test('fromMarkdown: ほかの言語の囲みは等幅にせず、本文の書体の段落にする（印は読まない）', () => {
  const { blocks } = fromMarkdown(`${FENCE}js\nconst a = **1**\nlet b = {x|y}\n${FENCE}`)
  assert.deepEqual(blocks, [
    { type: 'para', text: t('const a = **1**') },
    { type: 'para', text: t('let b = {x|y}') },
  ])
})

test('fromMarkdown: 言語名なしの囲みと字下げのコードも段落にする', () => {
  assert.deepEqual(fromMarkdown(`${FENCE}\nplain\n${FENCE}`).blocks, [{ type: 'para', text: t('plain') }])
  assert.deepEqual(fromMarkdown('    indented').blocks, [{ type: 'para', text: t('indented') }])
})

test('fromMarkdown: HTML の塊はタグを消した段落にし、コメントと script は字にしない', () => {
  assert.deepEqual(fromMarkdown('<div>見て <b>ください</b></div>').blocks, [{ type: 'para', text: t('見て ください') }])
  assert.deepEqual(fromMarkdown('<!-- 隠し -->').blocks, [])
  assert.deepEqual(fromMarkdown('<script>alert(1)</script>').blocks, [])
})

test('fromMarkdown: 閉じない < や <!-- が何万個並んでも時間がかからない', () => {
  const start = Date.now()
  fromMarkdown('<div>\n' + '<a '.repeat(40000))
  fromMarkdown('<div>\n' + '<script>'.repeat(20000))
  fromMarkdown('<!-- x -->\n' + '<!-- '.repeat(20000))
  assert.ok(Date.now() - start < 3000)
})

test('fromMarkdown: <!-- pagebreak --> と ' + BS + 'pagebreak だけの段落は pagebreak になる', () => {
  const md = `前\n\n<!-- pagebreak -->\n\n中\n\n${BS}pagebreak\n\n後\n\n<!--   PageBreak   -->`
  assert.deepEqual(fromMarkdown(md).blocks.map((b) => b.type), ['para', 'pagebreak', 'para', 'pagebreak', 'para', 'pagebreak'])
})

test('fromMarkdown: 空行（space）は Block にしない', () => {
  assert.deepEqual(fromMarkdown('\n\n\n').blocks, [])
  assert.deepEqual(fromMarkdown('').blocks, [])
})

test('fromMarkdown: marked が逃がした実体参照（&amp; &lt; &gt; &quot; &#39;）を戻す', () => {
  const { blocks } = fromMarkdown('# 見&amp;出\n\nA &amp; B &lt;c&gt; &quot;d&quot; it&#39;s\n\n`&lt;tag&gt;`')
  assert.equal(plainText(/** @type {any} */ (blocks[0]).text), '見&出')
  assert.equal(plainText(/** @type {any} */ (blocks[1]).text), `A & B <c> "d" it's`)
  assert.deepEqual(/** @type {any} */ (blocks[2]).text, [{ text: '<tag>', code: true }])
})

test('fromMarkdown: 実体参照は 1 回しか戻さない（&amp;lt; は &lt; のまま）', () => {
  const { blocks } = fromMarkdown('&amp;lt;')
  assert.equal(plainText(/** @type {any} */ (blocks[0]).text), '&lt;')
})

test('fromMarkdown: Markdown の逃がしがパーサーを通っても印は字のまま残る', () => {
  const { blocks } = fromMarkdown(`${BS}{a|b${BS}} と ${BS}*${BS}*x${BS}*${BS}*`)
  assert.equal(plainText(/** @type {any} */ (blocks[0]).text), '{a|b} と **x**')
})

test('fromMarkdown: 斜体と取り消し線の印は消して字だけ残す', () => {
  const { blocks } = fromMarkdown('*斜*と~~消~~と _下_ です')
  assert.equal(plainText(/** @type {any} */ (blocks[0]).text), '斜と消と 下 です')
})

test('fromMarkdown: 危ない url のリンクは link にせず、字だけ残す', () => {
  const { blocks } = fromMarkdown('[押す](javascript:alert(1)) と [安全](https://a.example)')
  const text = /** @type {any} */ (blocks[0]).text
  assert.deepEqual(text, [{ text: '押す と ' }, { text: '安全', link: 'https://a.example' }])
})

test('fromMarkdown: 自動リンクと <> のリンクを link にする', () => {
  const { blocks } = fromMarkdown('見て https://a.example/x と <https://b.example> を')
  const links = /** @type {any} */ (blocks[0]).text.filter((/** @type {any} */ i) => i.link).map((/** @type {any} */ i) => i.link)
  assert.deepEqual(links, ['https://a.example/x', 'https://b.example'])
})

test('fromMarkdown: 画像だけの段落は相対パスの png・jpg なら image の Block にする', () => {
  assert.deepEqual(fromMarkdown('![売上の図](img/sales.png)').blocks, [{ type: 'image', path: 'img/sales.png', alt: '売上の図' }])
  const remote = fromMarkdown('![x](https://a.example/x.png)')
  assert.equal(remote.blocks[0].type, 'para')
  assert.ok(remote.warnings.length > 0)
})

test('fromMarkdown: 空の見出しと空の段落を作らない', () => {
  assert.deepEqual(fromMarkdown('#\n\n<br>').blocks.filter((b) => b.type === 'heading'), [])
})

test('fromMarkdown: 全部の Block の種類を 1 つの文書から作れる', () => {
  const md = [
    '# 題',
    '段落',
    '- 項',
    '| a |\n|---|\n| 1 |',
    '> 引',
    '---',
    FENCE + 'chart\n{"series":[]}\n' + FENCE,
    FENCE + 'keys\n[{"label":"a","value":"1"}]\n' + FENCE,
    FENCE + 'card\n{"label":"l","text":"t"}\n' + FENCE,
    FENCE + 'fields\n[{"kind":"text","name":"n","label":"l"}]\n' + FENCE,
    FENCE + 'svg\n<svg></svg>\n' + FENCE,
    '<!-- pagebreak -->',
  ].join('\n\n')
  const types = fromMarkdown(md).blocks.map((b) => b.type)
  assert.deepEqual(types, ['heading', 'para', 'list', 'table', 'quote', 'rule', 'chart', 'keys', 'card', 'fields', 'svg', 'pagebreak'])
})

// ---------------------------------------------------------------- normalize

test('normalize: title だけなら既定値の空の文書になり、warnings に空と書く', () => {
  const { doc, warnings } = normalize({ title: '題' })
  assert.deepEqual(doc, { kind: 'doc', title: '題', lang: 'ja', theme: 'mono', body: 'mincho', paper: 'A4', landscape: false, blocks: [], attach: false })
  assert.equal(warnings.length, 1)
})

test('normalize: title が無い・空・字でないなら投げる', () => {
  assert.throws(() => normalize({}), /title/)
  assert.throws(() => normalize({ title: '' }), /title/)
  assert.throws(() => normalize({ title: '   ' }), /title/)
  assert.throws(() => normalize({ title: 3 }), /title/)
  assert.throws(() => normalize(null), /オブジェクト/)
  assert.throws(() => normalize('x'), /オブジェクト/)
})

test('normalize: title は 200 字で切り、改行と制御の字を空白にして warnings に書く', () => {
  const long = normalize({ title: 'あ'.repeat(300), markdown: 'x' })
  assert.equal(long.doc.title.length, 200)
  assert.ok(long.warnings.some((w) => w.includes('title')))
  assert.equal(normalize({ title: '一行目' + String.fromCodePoint(0) + '\n二行目 abc', markdown: 'x' }).doc.title, '一行目二行目 abc')
  assert.equal(normalize({ title: 'a\nb', markdown: 'x' }).doc.title, 'a b')
})

test('normalize: 使える theme・body・paper・lang・landscape・size・author をそのまま取る', () => {
  const { doc, warnings } = normalize({ title: 't', theme: 'koma', body: 'gothic', paper: 'B5', landscape: true, size: 11, author: '森田', lang: 'en', markdown: 'x' })
  assert.deepEqual(
    { ...doc, blocks: [] },
    { kind: 'doc', title: 't', author: '森田', lang: 'en', theme: 'koma', body: 'gothic', paper: 'B5', landscape: true, size: 11, blocks: [], attach: false },
  )
  assert.deepEqual(warnings, [])
})

test('normalize: 大文字小文字の違いは直して受ける（a4・Letter・MONO）', () => {
  const { doc, warnings } = normalize({ title: 't', paper: 'a4', theme: 'MONO', markdown: 'x' })
  assert.equal(doc.paper, 'A4')
  assert.equal(doc.theme, 'mono')
  assert.deepEqual(warnings, [])
  assert.equal(normalize({ title: 't', paper: 'letter', markdown: 'x' }).doc.paper, 'Letter')
})

test('normalize: 使えない theme は mono にして warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', theme: 'neon', markdown: 'x' })
  assert.equal(doc.theme, 'mono')
  assert.ok(warnings.some((w) => w.includes('theme')))
})

test('normalize: 使えない body・paper・lang・landscape は既定に直して warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', body: 'serif', paper: 'A3', lang: 'fr', landscape: 'yes', markdown: 'x' })
  assert.equal(doc.body, 'mincho')
  assert.equal(doc.paper, 'A4')
  assert.equal(doc.lang, 'ja')
  assert.equal(doc.landscape, false)
  for (const key of ['body', 'paper', 'lang', 'landscape']) assert.ok(warnings.some((w) => w.includes(key)), key)
})

test('normalize: size は 8〜14 の端に寄せ、数でなければ捨てる', () => {
  assert.equal(normalize({ title: 't', size: 4, markdown: 'x' }).doc.size, 8)
  assert.equal(normalize({ title: 't', size: 40, markdown: 'x' }).doc.size, 14)
  assert.equal(normalize({ title: 't', size: 9.5, markdown: 'x' }).doc.size, 9.5)
  const bad = normalize({ title: 't', size: 'big', markdown: 'x' })
  assert.equal('size' in bad.doc, false)
  assert.ok(bad.warnings.some((w) => w.includes('size')))
  assert.ok(normalize({ title: 't', size: 4, markdown: 'x' }).warnings.some((w) => w.includes('size')))
})

test('normalize: lang は ja-JP・en-US の書き方も ja・en に直す', () => {
  assert.equal(normalize({ title: 't', lang: 'ja-JP', markdown: 'x' }).doc.lang, 'ja')
  assert.equal(normalize({ title: 't', lang: 'en-US', markdown: 'x' }).doc.lang, 'en')
})

test('normalize: author は 100 字で切り、空なら付けない', () => {
  const long = normalize({ title: 't', author: 'あ'.repeat(150), markdown: 'x' })
  assert.equal(long.doc.author?.length, 100)
  assert.ok(long.warnings.some((w) => w.includes('author')))
  assert.equal('author' in normalize({ title: 't', author: '  ', markdown: 'x' }).doc, false)
})

test('normalize: markdown と blocks の両方があれば、blocks を後ろにつなぐ', () => {
  const { doc } = normalize({ title: 't', markdown: '前の段落', blocks: [{ type: 'para', text: '後の段落' }] })
  assert.deepEqual(
    doc.blocks.map((b) => (b.type === 'para' ? plainText(b.text) : '')),
    ['前の段落', '後の段落'],
  )
})

test('normalize: markdown も blocks も無ければ空の文書にして warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't' })
  assert.deepEqual(doc.blocks, [])
  assert.ok(warnings.some((w) => w.includes('markdown も blocks も無い')))
})

test('normalize: blocks のおかしい要素は捨てて、何個目の何かを warnings に書く', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [{ type: 'para', text: 'ok' }, { type: 'nazo' }, 'ただの字', { type: 'heading', level: 2, text: '' }, { type: 'list', items: [] }, null],
  })
  assert.equal(doc.blocks.length, 1)
  assert.ok(warnings.some((w) => w.includes('2 個目') && w.includes('nazo')))
  assert.ok(warnings.some((w) => w.includes('3 個目')))
  assert.ok(warnings.some((w) => w.includes('4 個目') && w.includes('heading')))
  assert.ok(warnings.some((w) => w.includes('5 個目') && w.includes('list')))
  assert.ok(warnings.some((w) => w.includes('6 個目')))
})

test('normalize: blocks が配列でなければ無視して warnings に書く（JSON の字なら読む）', () => {
  const bad = normalize({ title: 't', blocks: { type: 'para' } })
  assert.deepEqual(bad.doc.blocks, [])
  assert.ok(bad.warnings.some((w) => w.includes('blocks')))
  const asText = normalize({ title: 't', blocks: JSON.stringify([{ type: 'para', text: '読める' }]) })
  assert.equal(asText.doc.blocks.length, 1)
  assert.ok(normalize({ title: 't', blocks: '[壊れ' }).warnings.some((w) => w.includes('blocks')))
})

test('normalize: Inline の配列の代わりに字が来たら parseInline する', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'para', text: '**太**と{漢|かん}' }, { type: 'heading', level: 1, text: '見出し' }] })
  assert.deepEqual(/** @type {any} */ (doc.blocks[0]).text, [{ text: '太', bold: true }, { text: 'と' }, { text: '漢', ruby: 'かん' }])
})

test('normalize: Inline の配列は字のまま使い、印を読み直さない（安全でないリンクは落とす）', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [{ type: 'para', text: ['**そのまま**', { text: '**太**', bold: true }, { text: 'x', link: 'javascript:alert(1)' }, { text: 'y', link: 'https://a.example' }, { text: '' }, 5] }],
  })
  const text = /** @type {any} */ (doc.blocks[0]).text
  // 字の要素は parseInline を通る。Inline の形の要素は字のまま。同じ形（太字）になった 2 つはつながる
  assert.deepEqual(text, [{ text: 'そのまま**太**', bold: true }, { text: 'x' }, { text: 'y', link: 'https://a.example' }])
  assert.ok(warnings.some((w) => w.includes('リンク')))
  assert.ok(warnings.some((w) => w.includes('Inline')))
})

test('normalize: heading の level は 1〜3 に収め、数でなければ 2 にする', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'heading', level: 9, text: 'a' }, { type: 'heading', level: 0, text: 'b' }, { type: 'heading', text: 'c' }] })
  assert.deepEqual(
    doc.blocks.map((b) => (b.type === 'heading' ? b.level : 0)),
    [3, 1, 2],
  )
  assert.ok(warnings.some((w) => w.includes('level')))
})

test('normalize: list の入れ子は 2 段までで、blocks の形でも markdown と同じ形になる', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [
      {
        type: 'list',
        ordered: true,
        items: ['一', ['二', { text: '強', bold: true }], { text: '親', items: ['子', { text: '子2', items: ['孫'] }] }],
      },
    ],
  })
  assert.deepEqual(/** @type {any} */ (doc.blocks[0]).items, [
    t('一'),
    [{ text: '二' }, { text: '強', bold: true }],
    { text: t('親'), items: [t('子'), t('子2'), t('孫')], ordered: true },
  ])
  assert.ok(warnings.some((w) => w.includes('3 段目')))
})

test('normalize: table は列の数を頭の行に揃え、500 行 12 列を超えたら切る', () => {
  const head = Array.from({ length: 15 }, (_, k) => `h${k}`)
  const rows = Array.from({ length: 600 }, (_, k) => Array.from({ length: 15 }, (_, c) => `${k}-${c}`))
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'table', head, rows }] })
  const table = /** @type {any} */ (doc.blocks[0])
  assert.equal(table.head.length, LIMITS.tableCols)
  assert.equal(table.rows.length, LIMITS.tableRows)
  assert.ok(table.rows.every((/** @type {any[]} */ r) => r.length === LIMITS.tableCols))
  assert.ok(warnings.some((w) => w.includes('500')))
  assert.ok(warnings.some((w) => w.includes('12')))
})

test('normalize: table の短い行は空のセルで埋め、余った所は切って warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'table', head: ['a', 'b'], rows: [['1'], ['1', '2', '3']] }] })
  const table = /** @type {any} */ (doc.blocks[0])
  assert.deepEqual(table.rows, [[t('1'), []], [t('1'), t('2')]])
  assert.ok(warnings.some((w) => w.includes('列の数')))
})

test('normalize: table に head が無ければ 1 行目を頭の行にする', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'table', rows: [['a', 'b'], ['1', '2']] }] })
  const table = /** @type {any} */ (doc.blocks[0])
  assert.deepEqual(table.head, [t('a'), t('b')])
  assert.deepEqual(table.rows, [[t('1'), t('2')]])
  assert.ok(warnings.some((w) => w.includes('head')))
})

test('normalize: table の align は列の数に揃え、widths は合計 1 の割合にする', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'table', head: ['a', 'b', 'c'], rows: [], align: ['right', 'zzz'], widths: [1, 1, 2] }] })
  const table = /** @type {any} */ (doc.blocks[0])
  assert.deepEqual(table.align, ['right', 'left', 'left'])
  assert.deepEqual(table.widths, [0.25, 0.25, 0.5])
  assert.deepEqual(warnings, [])
  const bad = normalize({ title: 't', blocks: [{ type: 'table', head: ['a', 'b'], rows: [], widths: [1] }] })
  assert.equal('widths' in bad.doc.blocks[0], false)
  assert.ok(bad.warnings.some((w) => w.includes('widths')))
})

test('normalize: 字 1 つの段落は 20,000 字で切って warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'para', text: 'あ'.repeat(25000) }] })
  assert.equal(plainText(/** @type {any} */ (doc.blocks[0]).text).length, LIMITS.text)
  assert.ok(warnings.some((w) => w.includes('20000')))
})

test('normalize: markdown は 200,000 字で切って warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', markdown: ('あ'.repeat(90) + '\n\n').repeat(3000) })
  assert.ok(warnings.some((w) => w.includes('markdown') && w.includes('200000')))
  const chars = doc.blocks.reduce((n, b) => n + (b.type === 'para' ? plainText(b.text).length : 0), 0)
  assert.ok(chars <= LIMITS.markdown)
})

test('normalize: blocks は 2,000 個で切って warnings に書く', () => {
  const blocks = Array.from({ length: 2500 }, () => ({ type: 'rule' }))
  const { doc, warnings } = normalize({ title: 't', blocks })
  assert.equal(doc.blocks.length, LIMITS.blocks)
  assert.ok(warnings.some((w) => w.includes('2000')))
})

test('normalize: chart の option は JSON で 200,000 字までで、超えたら捨てて warnings に書く', () => {
  const ok = normalize({ title: 't', blocks: [{ type: 'chart', option: { series: [{ type: 'bar', data: [1, 2, 3] }] }, height: 200, caption: '図' }] })
  assert.deepEqual(ok.doc.blocks, [{ type: 'chart', option: { series: [{ type: 'bar', data: [1, 2, 3] }] }, height: 200, caption: '図' }])
  const big = normalize({ title: 't', blocks: [{ type: 'chart', option: { series: [{ data: 'x'.repeat(LIMITS.chartJson) }] } }] })
  assert.deepEqual(big.doc.blocks, [])
  assert.ok(big.warnings.some((w) => w.includes('chart') && w.includes('200000')))
})

test('normalize: chart の option が JSON の字でも読み、壊れていれば捨てる', () => {
  const asText = normalize({ title: 't', blocks: [{ type: 'chart', option: '{"series":[]}' }] })
  assert.deepEqual(asText.doc.blocks, [{ type: 'chart', option: { series: [] } }])
  const bad = normalize({ title: 't', blocks: [{ type: 'chart', option: '{壊れ' }, { type: 'chart', option: [1] }, { type: 'chart' }] })
  assert.deepEqual(bad.doc.blocks, [])
  assert.equal(bad.warnings.length >= 3, true)
})

test('normalize: chart の option の循環参照と関数は JSON の素の物にする', () => {
  /** @type {any} */
  const loop = { a: 1 }
  loop.self = loop
  assert.deepEqual(normalize({ title: 't', blocks: [{ type: 'chart', option: loop }] }).doc.blocks, [])
  const withFn = normalize({ title: 't', blocks: [{ type: 'chart', option: { a: 1, f: () => 1 } }] })
  assert.deepEqual(withFn.doc.blocks, [{ type: 'chart', option: { a: 1 } }])
})

test('normalize: image は path が字であればよく、alt が無ければ代わりを入れて warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'image', path: 'img/a.png', width: 300, caption: '写真' }, { type: 'image', path: 42 }, { type: 'image', path: '' }] })
  assert.deepEqual(doc.blocks, [{ type: 'image', path: 'img/a.png', alt: '写真', width: 300, caption: '写真' }])
  assert.ok(warnings.some((w) => w.includes('alt')))
  assert.ok(warnings.some((w) => w.includes('2 個目')))
})

test('normalize: svg は <svg> を含む字だけ受け、alt が無ければ title か「図」', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'svg', source: '<svg><title>丸</title></svg>' }, { type: 'svg', source: '<svg/>', alt: '手動' }, { type: 'svg', source: 'ただの字' }] })
  assert.deepEqual(
    doc.blocks.map((b) => (b.type === 'svg' ? b.alt : '')),
    ['丸', '手動'],
  )
  assert.ok(warnings.some((w) => w.includes('3 個目')))
})

test('normalize: fields の name は字・数字・_ - だけにして、ほかは _ に直す', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [
      {
        type: 'fields',
        items: [
          { kind: 'text', name: 'a b.c/d', label: 'L1' },
          { kind: 'text', name: 'ok_name-1', label: 'L2' },
          { kind: 'text', name: '氏名', label: 'L3' },
          { kind: 'text', name: '', label: 'L4' },
        ],
      },
    ],
  })
  const names = /** @type {any} */ (doc.blocks[0]).items.map((/** @type {any} */ f) => f.name)
  assert.deepEqual(names, ['a_b_c_d', 'ok_name-1', '氏名', 'field'])
  assert.ok(warnings.some((w) => w.includes('a_b_c_d')))
})

test('normalize: fields の name が重複したら _2 _3 を付ける（blocks をまたいでも）', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [
      { type: 'fields', items: [{ kind: 'text', name: 'x', label: 'a' }, { kind: 'text', name: 'x', label: 'b' }] },
      { type: 'fields', items: [{ kind: 'text', name: 'x', label: 'c' }, { kind: 'text', name: 'x_2', label: 'd' }] },
    ],
  })
  const all = doc.blocks.flatMap((b) => (b.type === 'fields' ? b.items.map((f) => f.name) : []))
  assert.equal(new Set(all).size, 4)
  assert.deepEqual(all.slice(0, 3), ['x', 'x_2', 'x_3'])
  assert.ok(warnings.some((w) => w.includes('重複')))
})

test('normalize: markdown の fields と blocks の fields の name も重複しない', () => {
  const md = `${FENCE}fields\n[{"kind":"text","name":"n","label":"a"}]\n${FENCE}`
  const { doc } = normalize({ title: 't', markdown: md, blocks: [{ type: 'fields', items: [{ kind: 'text', name: 'n', label: 'b' }] }] })
  const all = doc.blocks.flatMap((b) => (b.type === 'fields' ? b.items.map((f) => f.name) : []))
  assert.deepEqual(all, ['n', 'n_2'])
})

test('normalize: fields の kind・options・value・width を検査する', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [
      {
        type: 'fields',
        items: [
          { kind: 'check', name: 'c', label: 'C', value: 'yes' },
          { kind: 'choice', name: 'ch', label: 'CH' },
          { kind: 'choice', name: 'ch2', label: 'CH2', options: ['A', 'B'], value: 'A', width: 120 },
          { kind: 'radio', name: 'r', label: 'R' },
          { kind: 'text', name: 't', label: 'T', value: 5, width: -1 },
        ],
      },
    ],
  })
  assert.deepEqual(/** @type {any} */ (doc.blocks[0]).items, [
    { kind: 'check', name: 'c', label: 'C' },
    { kind: 'choice', name: 'ch2', label: 'CH2', value: 'A', options: ['A', 'B'], width: 120 },
    { kind: 'text', name: 't', label: 'T', value: '5' },
  ])
  assert.ok(warnings.some((w) => w.includes('options')))
  assert.ok(warnings.some((w) => w.includes('radio')))
  assert.ok(warnings.some((w) => w.includes('width')))
})

test('normalize: choice の value が options に無ければ外して warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'fields', items: [{ kind: 'choice', name: 'c', label: 'C', options: ['A', 'B'], value: 'Z' }] }] })
  assert.deepEqual(/** @type {any} */ (doc.blocks[0]).items, [{ kind: 'choice', name: 'c', label: 'C', options: ['A', 'B'] }])
  assert.ok(warnings.some((w) => w.includes('options')))
})

test('normalize: keys は 4 個を超えたら偏らないように割って複数の keys にする', () => {
  const items = Array.from({ length: 5 }, (_, k) => ({ label: `L${k}`, value: `${k}` }))
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'keys', items, id: 'k' }] })
  assert.deepEqual(
    doc.blocks.map((b) => (b.type === 'keys' ? b.items.length : 0)),
    [3, 2],
  )
  assert.equal(doc.blocks[0].id, 'k')
  assert.ok(warnings.some((w) => w.includes('keys')))
})

test('normalize: keys の value に数が来ても字にして受ける', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'keys', items: [{ label: '件数', value: 12 }] }] })
  assert.deepEqual(/** @type {any} */ (doc.blocks[0]).items, [{ label: '件数', value: '12' }])
})

test('normalize: card は label と text を持つ（text は印を読む）', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'card', label: '補足', text: '**注意**' }] })
  assert.deepEqual(doc.blocks, [{ type: 'card', label: '補足', text: [{ text: '注意', bold: true }] }])
})

test('normalize: 文書の最初の Block が title と同じ level 1 の見出しなら消す', () => {
  const same = normalize({ title: '月次報告', markdown: '# 月次報告\n\n本文' })
  assert.deepEqual(
    same.doc.blocks.map((b) => b.type),
    ['para'],
  )
  const full = normalize({ title: 'ABC　報告', markdown: '# ＡＢＣ 報告\n\n本文' })
  assert.deepEqual(
    full.doc.blocks.map((b) => b.type),
    ['para'],
  )
})

test('normalize: 見出しが title と違う・level 2・最初でない時は消さない', () => {
  assert.equal(normalize({ title: '月次報告', markdown: '# 別の題\n\n本文' }).doc.blocks.length, 2)
  assert.equal(normalize({ title: '月次報告', markdown: '## 月次報告\n\n本文' }).doc.blocks.length, 2)
  assert.equal(normalize({ title: '月次報告', markdown: '前置き\n\n# 月次報告' }).doc.blocks.length, 2)
})

test('normalize: blocks で渡した最初の level 1 の見出しも title と同じなら消す', () => {
  const { doc } = normalize({ title: '題', blocks: [{ type: 'heading', level: 1, text: '題' }, { type: 'para', text: 'x' }] })
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['para'],
  )
})

test('normalize: 頭と末の改ページと、続く改ページは 1 つにまとめる', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'pagebreak' }, { type: 'para', text: 'a' }, { type: 'pagebreak' }, { type: 'pagebreak' }, { type: 'para', text: 'b' }, { type: 'pagebreak' }] })
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['para', 'pagebreak', 'para'],
  )
})

test('normalize: Block の id は字なら残す', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'para', text: 'a', id: 'p1' }, { type: 'rule', id: 7 }] })
  assert.equal(doc.blocks[0].id, 'p1')
  assert.equal('id' in doc.blocks[1], false)
})

test('normalize: 入力を書き換えない', () => {
  const input = { title: 't', blocks: [{ type: 'table', head: ['a'], rows: [['1']], align: ['right'] }, { type: 'list', items: ['x', { text: 'y', items: ['z'] }] }] }
  const before = JSON.stringify(input)
  normalize(input)
  assert.equal(JSON.stringify(input), before)
})

test('normalize: 制御の字とゼロ幅・双方向制御の字は本文から消す', () => {
  const rlo = String.fromCodePoint(0x202e)
  const zwsp = String.fromCodePoint(0x200b)
  const { doc } = normalize({ title: 't', blocks: [{ type: 'para', text: `a${rlo}b${zwsp}c${String.fromCodePoint(0)}d\te` }] })
  assert.equal(plainText(/** @type {any} */ (doc.blocks[0]).text), 'abcd e')
})

test('normalize: 同じ入力から同じ結果になる', () => {
  const input = { title: 't', blocks: Array.from({ length: 5 }, () => ({ type: 'nazo' })) }
  assert.deepEqual(normalize(input), normalize(input))
})

test('normalize: 場所が同じで文言も同じ warnings は 1 回だけ積む', () => {
  const md = Array.from({ length: 4 }, () => `- 項目\n  ${FENCE}\n  コード\n  ${FENCE}`).join('\n\n')
  const { warnings } = normalize({ title: 't', markdown: md })
  assert.equal(warnings.filter((w) => w.includes('囲み')).length, 1)
})

test('normalize: Markdown の見出し・表・囲みを含む文書が整った Doc になる', () => {
  const md = [
    '# 月次報告',
    '',
    '## 要点',
    '',
    FENCE + 'keys',
    '[{"label":"売上","value":"1,200"},{"label":"利益","value":"300"}]',
    FENCE,
    '',
    '| 月 | 売上 |',
    '|---|---:|',
    '| 1 | 100 |',
    '',
    '{漢字|かん|じ}の**説明**。',
  ].join('\n')
  const { doc, warnings } = normalize({ title: '月次報告', markdown: md })
  assert.deepEqual(warnings, [])
  assert.deepEqual(
    doc.blocks.map((b) => b.type),
    ['heading', 'keys', 'table', 'para'],
  )
})

// ---------------------------------------------------------------- 攻める入力（見直しで足した物）
// 直す前は、下の入力が数秒〜数分かかった。上限は 10 秒のフックの中で、組版と描画の時間を残せる値にしてある。

/** @template T @param {string} label @param {() => T} f @param {number} [limitMs] @returns {T} */
function within(label, f, limitMs = 1500) {
  const t0 = performance.now()
  const r = f()
  const ms = performance.now() - t0
  assert.ok(ms < limitMs, `${label}: ${Math.round(ms)}ms`)
  return r
}

test('parseInline: [ や [a]( が 20 万字並んでも 1 秒以内に読み終える（直す前は 27〜47 秒）', () => {
  within('[a](', () => parseInline('[a]('.repeat(50000)))
  within('[[](', () => parseInline('['.repeat(100000) + ']('.repeat(50000)))
  within('[', () => parseInline('['.repeat(200000)))
  within('入れ子の (', () => parseInline('[a](' + '(['.repeat(60000)))
})

test('parseInline: 入れ子の括弧を持つ正当なリンクは今まで通り読め、長すぎる () の先はリンクにしない', () => {
  assert.deepEqual(parseInline('[w](https://ja.wikipedia.org/wiki/Foo_(bar))'), [{ text: 'w', link: 'https://ja.wikipedia.org/wiki/Foo_(bar)' }])
  assert.deepEqual(parseInline('[a [b] c](https://example.com/x "題")'), [{ text: 'a [b] c', link: 'https://example.com/x' }])
  const longDest = `[x](https://example.com/${'a'.repeat(3000)})`
  assert.equal(parseInline(longDest).some((i) => 'link' in i), false)
})

test('cleanText: 空白だけが 6 万字続いて改行が来る字でも一瞬で整える（直す前は 20 秒）', () => {
  const { doc } = within('空白', () => normalize({ title: 't', blocks: [{ type: 'para', text: ' '.repeat(60000) + 'x\ny' }, { type: 'para', text: '\t \n'.repeat(20000) + 'z' }] }))
  assert.ok(doc.blocks.length >= 1)
})

test('cleanText: 改行の前後の空白は消え、和字の隣なら詰め、欧文どうしなら空白 1 つにする', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'para', text: 'あ \t\n \n  い' }, { type: 'para', text: 'a  \n\n  b' }, { type: 'para', text: '\n先頭と末尾\n' }] })
  assert.deepEqual(doc.blocks.map((b) => plainText(/** @type {any} */ (b).text)), ['あい', 'a b', '先頭と末尾'])
})

test('markdown: 閉じない * _ ~ [ が並ぶ 20 万字でも 2 秒以内に読み終え、超えた印は字になる（直す前は 40 秒以上）', () => {
  for (const unit of ['**a ', '*a ', '_a ', '~~a ', '[a](', '![a](', '<?=']) {
    const md = unit.repeat(Math.floor(200000 / unit.length))
    const { doc, warnings } = within(JSON.stringify(unit), () => normalize({ title: 't', markdown: md }), 2000)
    assert.equal(doc.blocks.length, 1, unit)
    assert.ok(warnings.some((w) => w.includes('印')), `${unit}: ${warnings.join(' / ')}`)
    // 印が字として残る（段落の上限 20,000 字までは字が残る）
    assert.ok(plainText(/** @type {any} */ (doc.blocks[0]).text).length > LIMITS.text / 2, unit)
  }
})

test('markdown: 印の多い正当な文書（太字・強調・リンクを含む 2,000 段落、箇条書き 5,000 行、表 5,000 行）は何も変えず警告もしない', () => {
  const para = ('これは**太字**と*強調*と[リンク](https://example.com/a)と_下線風_を含む、ふつうの段落です。\n\n').repeat(2000)
  const a = within('段落', () => normalize({ title: 't', markdown: para }))
  assert.deepEqual(a.warnings, [])
  assert.equal(a.doc.blocks.length, 2000)
  assert.equal(/** @type {any} */ (a.doc.blocks[0]).text.filter((/** @type {any} */ i) => i.bold).length, 1)
  const list = within('箇条書き', () => normalize({ title: 't', markdown: '- **a** _b_ [c](https://x.example)\n'.repeat(5000) }))
  assert.deepEqual(list.warnings, [])
  const table = within('表', () => normalize({ title: 't', markdown: '|h1|h2|\n|-|-|\n' + '|**a**|*b*|\n'.repeat(5000) }))
  assert.ok(!table.warnings.some((w) => w.includes('印')), table.warnings.join(' / '))
})

test('markdown: 引用の入れ子が数千段の行は 16 段に浅くして、2 秒以内に読み終える', () => {
  const md = ('>'.repeat(3000) + ' a\n').repeat(60)
  const { warnings } = within('引用', () => normalize({ title: 't', markdown: md }), 2000)
  assert.ok(warnings.some((w) => w.includes('引用')), warnings.join(' / '))
})

test('svg の title が 7 万個並ぶ source でも alt を一瞬で決める（直す前は 2.3 秒）', () => {
  const source = '<svg>' + '<title>'.repeat(70000) + '</svg>'
  const { doc } = within('title', () => normalize({ title: 't', blocks: [{ type: 'svg', source }] }))
  assert.equal(/** @type {any} */ (doc.blocks[0]).alt, '図')
  const ok = normalize({ title: 't', blocks: [{ type: 'svg', source: '<svg><TITLE lang="ja">丸&amp;四角</TITLE></svg>' }] })
  assert.equal(/** @type {any} */ (ok.doc.blocks[0]).alt, '丸&四角')
})

test('table: セルは 2,000 字・表全体は 50,000 字で切って warnings に書く', () => {
  const big = 'あ'.repeat(LIMITS.cell + 500)
  const one = normalize({ title: 't', blocks: [{ type: 'table', head: ['a', 'b'], rows: [[big, 'x']] }] })
  const cell = /** @type {any} */ (one.doc.blocks[0]).rows[0][0]
  assert.equal(plainText(cell).length, LIMITS.cell)
  assert.ok(one.warnings.some((w) => w.includes(String(LIMITS.cell))))
  const rows = Array.from({ length: 60 }, () => Array.from({ length: 12 }, () => 'い'.repeat(LIMITS.cell)))
  const many = within('表', () => normalize({ title: 't', blocks: [{ type: 'table', head: Array.from({ length: 12 }, (_, k) => `h${k}`), rows }] }))
  const t = /** @type {any} */ (many.doc.blocks[0])
  const chars = [t.head, ...t.rows].flat().reduce((/** @type {number} */ n, /** @type {any} */ c) => n + plainText(c).length, 0)
  assert.ok(chars <= LIMITS.tableChars, `${chars}`)
  assert.ok(many.warnings.some((w) => w.includes(String(LIMITS.tableChars))), many.warnings.join(' / '))
})

test('文書全体の本文は 400,000 字まで。blocks で 1 つ 20,000 字の段落を 100 個送っても、超えた分は切って warnings に書く', () => {
  const blocks = Array.from({ length: 100 }, () => ({ type: 'para', text: 'あ'.repeat(LIMITS.text) }))
  const { doc, warnings } = within('本文', () => normalize({ title: 't', blocks }), 3000)
  const total = doc.blocks.reduce((n, b) => n + plainText(/** @type {any} */ (b).text).length, 0)
  assert.ok(total <= LIMITS.docText, `${total}`)
  assert.ok(warnings.some((w) => w.includes('文書全体')), warnings.join(' / '))
})

test('字の列の要素が 5,000 を超えたら切る・字は上限の 4 倍で切ってから印を読む', () => {
  const many = normalize({ title: 't', blocks: [{ type: 'para', text: Array.from({ length: 9000 }, () => 'a') }] })
  assert.ok(many.warnings.some((w) => w.includes('5000')), many.warnings.join(' / '))
  const { doc } = within('長い字', () => normalize({ title: 't', blocks: [{ type: 'para', text: '[a]('.repeat(2_000_000) }] }))
  assert.ok(plainText(/** @type {any} */ (doc.blocks[0]).text).length <= LIMITS.text)
})

test('fields: 文書全体で 300 欄まで・値は 2,000 字まで・同じ名前の欄が数百あっても一意にする', () => {
  const items = Array.from({ length: LIMITS.fieldItems }, () => ({ kind: 'text', name: 'n', label: 'l', value: 'あ'.repeat(5000) }))
  const blocks = Array.from({ length: 5 }, () => ({ type: 'fields', items }))
  const { doc, warnings } = within('欄', () => normalize({ title: 't', blocks }))
  const all = doc.blocks.flatMap((b) => (b.type === 'fields' ? b.items : []))
  assert.equal(all.length, LIMITS.fieldsTotal)
  assert.ok(all.every((f) => String(f.value).length === LIMITS.fieldValue))
  assert.equal(new Set(all.map((f) => f.name)).size, all.length, '名前は一意')
  assert.ok(warnings.some((w) => w.includes(String(LIMITS.fieldsTotal))), warnings.join(' / '))
  // 上限に達した後の fields の Block は空になるので捨てる
  assert.equal(doc.blocks.length, 2)
  // markdown の fields の囲みでも同じ
  const md = fromMarkdown(Array.from({ length: 4 }, () => FENCE + 'fields\n' + JSON.stringify(items) + '\n' + FENCE).join('\n\n'))
  assert.equal(md.blocks.flatMap((b) => (b.type === 'fields' ? b.items : [])).length, LIMITS.fieldsTotal)
})

test('blocks: 配列が 10 万個でも 2,000 個で読むのをやめ、JSON の字が 2,000,000 を超えれば無視する', () => {
  const rules = Array.from({ length: 100000 }, () => ({ type: 'rule' }))
  const a = within('10 万個', () => normalize({ title: 't', blocks: rules }))
  assert.equal(a.doc.blocks.length, LIMITS.blocks)
  const asJson = JSON.stringify([{ type: 'para', text: 'あ'.repeat(LIMITS.blocksJson) }])
  const b = normalize({ title: 't', blocks: asJson })
  assert.deepEqual(b.doc.blocks, [])
  assert.ok(b.warnings.some((w) => w.includes('blocks') && w.includes(String(LIMITS.blocksJson))), b.warnings.join(' / '))
})

test('入れ子が 10 万段の箇条書き・5,000 を超える項目でも投げず、warnings に書く', () => {
  /** @type {any} */
  let deep = { text: '底' }
  for (let i = 0; i < 100000; i++) deep = { text: '段', items: [deep] }
  const r = within('深い入れ子', () => normalize({ title: 't', blocks: [{ type: 'list', items: [deep] }] }))
  assert.ok(r.warnings.some((w) => w.includes('入れ子')), r.warnings.join(' / '))
  const flat = Array.from({ length: 6000 }, (_, k) => `項目${k}`)
  const f = normalize({ title: 't', blocks: [{ type: 'list', items: flat }] })
  assert.ok(f.warnings.some((w) => w.includes('5000')), f.warnings.join(' / '))
  assert.equal(/** @type {any} */ (f.doc.blocks[0]).items.length, 5000)
})

test('生の HTML（script・on イベント・iframe・style）は字にならず、タグだけが消えて本文が残る', () => {
  const md = [
    '<script>alert("xss")</script>',
    '',
    '<img src=x onerror=alert(1)>本文1',
    '',
    '<iframe src="https://evil.example"></iframe>本文2',
    '',
    '<style>body{background:url(https://evil.example)}</style>本文3',
    '',
    '<!-- ' + 'x'.repeat(10) + ' -->本文4',
  ].join('\n')
  const { doc } = normalize({ title: 't', markdown: md })
  const text = doc.blocks.map((b) => plainText(/** @type {any} */ (b).text)).join('\n')
  assert.doesNotMatch(text, /alert|evil|onerror|background|<|>/)
  assert.match(text, /本文1/)
})

test('制御文字・双方向の制御・ゼロ幅の字は title・本文・欄の値・名前から消える', () => {
  const evil = '\u0000\u0007‮​﻿⁦'
  const { doc } = normalize({
    title: `題${evil}名`,
    author: `著${evil}者`,
    blocks: [{ type: 'para', text: `本${evil}文` }, { type: 'fields', items: [{ kind: 'text', name: `n${evil}m`, label: `l${evil}`, value: `v${evil}` }] }],
  })
  assert.equal(doc.title, '題名')
  assert.equal(doc.author, '著者')
  assert.equal(plainText(/** @type {any} */ (doc.blocks[0]).text), '本文')
  const f = /** @type {any} */ (doc.blocks[1]).items[0]
  assert.deepEqual([f.name, f.label, f.value], ['nm', 'l', 'v'])
})

// ---------------------------------------------------------------- 資料（kind・slides・datasets・wide・attach）

/** 資料の最小の入力 @param {Record<string, any>} [more] */
const deckOf = (more = {}) => ({ title: '題', kind: 'deck', ...more })
/** @param {Record<string, any>} input */
const slidesOf = (input) => normalize(deckOf(input)).doc.slides ?? []

test('normalize: kind を渡さなくても、slides か template があれば資料になる', () => {
  assert.equal(normalize({ title: 't', slides: [{ layout: 'statement', title: 'x' }] }).doc.kind, 'deck')
  assert.equal(normalize({ title: 't', template: 'bizplan', plan: { company: 'a' } }).doc.kind, 'deck')
  assert.equal(normalize({ title: 't', markdown: 'x' }).doc.kind, 'doc')
})

test('normalize: kind が doc なら slides と template は読まず、warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', kind: 'doc', slides: [{ title: 'x' }], markdown: 'x' })
  assert.equal(doc.kind, 'doc')
  assert.equal(doc.slides, undefined)
  assert.ok(warnings.some((w) => w.includes('kind が doc')))
})

test('normalize: 使えない kind は doc にして warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', kind: 'book', markdown: 'x' })
  assert.equal(doc.kind, 'doc')
  assert.ok(warnings.some((w) => w.includes('kind')))
})

test('normalize: 資料の既定は paper・gothic・A4 横・attach で、blocks は空', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'statement', title: 'x' }] }))
  assert.equal(doc.theme, 'paper')
  assert.equal(doc.body, 'gothic')
  assert.equal(doc.paper, 'A4')
  assert.equal(doc.landscape, true)
  assert.equal(doc.attach, true)
  assert.deepEqual(doc.blocks, [])
  assert.equal(doc.slides?.length, 1)
  assert.deepEqual(warnings, [])
})

test('normalize: 資料でも、指定した theme・body・landscape は上書きしない', () => {
  const { doc } = normalize(deckOf({ slides: [{ title: 'x' }], theme: 'mono', body: 'mincho', landscape: false }))
  assert.deepEqual([doc.theme, doc.body, doc.landscape], ['mono', 'mincho', false])
})

test('normalize: 資料を横にするのは A4 だけで、B5 は縦のまま', () => {
  assert.equal(normalize(deckOf({ slides: [{ title: 'x' }], paper: 'B5' })).doc.landscape, false)
  assert.equal(normalize(deckOf({ slides: [{ title: 'x' }], paper: 'A4' })).doc.landscape, true)
})

test('normalize: paper の wide は横しか無いので、landscape を false で渡しても横にする', () => {
  assert.equal(normalize({ title: 't', paper: 'wide', markdown: 'x' }).doc.paper, 'wide')
  assert.equal(normalize({ title: 't', paper: 'wide', landscape: false, markdown: 'x' }).doc.landscape, true)
  assert.equal(normalize(deckOf({ slides: [{ title: 'x' }], paper: 'WIDE' })).doc.landscape, true)
})

test('normalize: attach は真偽だけ受け、文書は false・資料は true が既定', () => {
  assert.equal(normalize({ title: 't', markdown: 'x' }).doc.attach, false)
  assert.equal(normalize({ title: 't', markdown: 'x', attach: true }).doc.attach, true)
  assert.equal(normalize(deckOf({ slides: [{ title: 'x' }], attach: false })).doc.attach, false)
  const bad = normalize({ title: 't', markdown: 'x', attach: 'yes' })
  assert.equal(bad.doc.attach, false)
  assert.ok(bad.warnings.some((w) => w.includes('attach')))
})

test('normalize: 資料に blocks を渡しても読まず、warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ title: 'x' }], blocks: [{ type: 'para', text: 'a' }] }))
  assert.deepEqual(doc.blocks, [])
  assert.ok(warnings.some((w) => w.includes('blocks')))
})

test('normalize: 資料に中身が何も無ければ空の資料にして warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf())
  assert.deepEqual(doc.slides, [])
  assert.ok(warnings.some((w) => w.includes('空の資料')))
})

test('slide: layout を渡さなければ中身から決める（図・左右・引用・items・blocks・題だけ）', () => {
  const fig = { type: 'chart', kind: 'donut', data: { items: [{ name: 'a', value: 1 }] } }
  const s = slidesOf({
    slides: [
      { figure: fig },
      { left: [{ type: 'para', text: 'l' }] },
      { quote: '引用' },
      { items: [{ label: 'a', value: 1 }] },
      { items: [{ title: 'A', points: ['p'] }] },
      { items: ['次の一歩'] },
      { blocks: [{ type: 'para', text: 'p' }] },
      { title: '一文' },
    ],
  })
  assert.deepEqual(s.map((x) => x.layout), ['figure', 'split', 'quote', 'kpi', 'compare', 'closing', 'content', 'statement'])
})

test('slide: 使えない layout は中身から決め直して warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'poster', title: '一文' }] }))
  assert.equal(doc.slides?.[0].layout, 'statement')
  assert.ok(warnings.some((w) => w.includes('layout')))
})

test('slide: 中身がまったく無い 1 枚は捨てて warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{}, { title: '残る' }, 7, null] }))
  assert.equal(doc.slides?.length, 1)
  assert.ok(warnings.length >= 3)
})

test('slide: その型に要る物が無ければ、題か本文を残して content に落とす', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'kpi', title: '数字' }, { layout: 'figure', title: '図' }, { layout: 'compare' }] }))
  assert.deepEqual(doc.slides?.map((s) => s.layout), ['content', 'content'])
  assert.ok(warnings.some((w) => w.includes('items') && w.includes('content にした')))
  assert.ok(warnings.some((w) => w.includes('捨てた')))
})

test('slide: その型で使わない項目は捨てて warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'statement', title: '一文', blocks: [{ type: 'para', text: 'a' }], number: '03' }] }))
  const s = /** @type {any} */ (doc.slides?.[0])
  assert.equal(s.blocks, undefined)
  assert.equal(s.number, undefined)
  assert.ok(warnings.some((w) => w.includes('blocks') && w.includes('statement')))
})

test('slide: 字の項目は印を読まず字のまま持つ', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'statement', title: '**強い**{漢字|かんじ}', lead: '補足', kicker: '札' }] })[0])
  assert.equal(s.title, '**強い**{漢字|かんじ}')
  assert.equal(s.lead, '補足')
  assert.equal(s.kicker, '札')
})

test('slide: 日本語どうしの改行は詰め、英語の改行は空白にする', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'statement', title: '一行目\n二行目', lead: 'two\nwords' }] })[0])
  assert.equal(s.title, '一行目二行目')
  assert.equal(s.lead, 'two words')
})

test('slide: 表紙に題が無ければ文書の題を使う', () => {
  assert.equal(/** @type {any} */ (slidesOf({ slides: [{ layout: 'cover' }] })[0]).title, '題')
})

test('slide: 表紙の by が空なら文書の author で埋め、section の番号は 01 から数える', () => {
  const s = /** @type {any[]} */ (slidesOf({ author: '森田', slides: [{ layout: 'cover', title: 'c' }, { layout: 'section', title: 'a' }, { layout: 'section', title: 'b', number: '07' }, { layout: 'section', title: 'c' }] }))
  assert.equal(s[0].by, '森田')
  assert.deepEqual(s.slice(1).map((x) => x.number), ['01', '07', '03'])
})

test('grid: panels を読み、panel の中身は look・chart・table・kpi・list・text のちょうど 1 つ。図と表は 1 つの block、字は段落ごとの block になる', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'grid', title: '題', panels: [
    { title: '図', note: '単位', look: { kind: 'donut', data: { items: [{ name: 'a', value: 1 }] }, alt: '説明' } },
    { title: '表', table: { head: ['a', 'b'], rows: [['1', '2']] } },
    { title: '数', kpi: [{ label: 'l', value: 3, delta: '+1' }] },
    { title: '箇条', list: ['x', 'y'] },
    { title: '文', text: '一つ目\n\n二つ目' },
  ] }] })[0])
  assert.equal(s.layout, 'grid')
  const [fig, tab, kpi, list, text] = s.panels
  assert.equal(fig.note, '単位')
  assert.deepEqual([fig.blocks.length, fig.blocks[0].type, fig.blocks[0].kind, fig.blocks[0].alt], [1, 'chart', 'donut', '説明'])
  assert.deepEqual([tab.blocks.length, tab.blocks[0].type], [1, 'table'])
  assert.deepEqual(kpi.kpi, [{ label: 'l', value: '3', delta: '+1', trend: 'up' }])
  assert.equal(kpi.blocks, undefined)
  assert.deepEqual([list.blocks[0].type, list.blocks[0].items.length], ['list', 2])
  assert.deepEqual(text.blocks.map((/** @type {any} */ b) => b.type), ['para', 'para'])
})

test('grid: panel の中身が 2 つ以上なら最初の 1 つだけ使い、1 つも無い・読めない panel は捨てて warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'grid', title: '題', panels: [
    { title: 'a', list: ['x'], text: 'y' }, { title: 'b' }, 5, { title: 'c', kpi: [] }, { title: 'd', table: 'x' },
  ] }] }))
  const s = /** @type {any} */ (doc.slides?.[0])
  assert.deepEqual(s.panels.map((/** @type {any} */ p) => p.title), ['a'])
  assert.equal(s.panels[0].blocks[0].type, 'list')
  assert.ok(warnings.some((w) => w.includes('list を使い') && w.includes('text')))
  assert.equal(warnings.filter((w) => w.includes('捨てた') && !w.includes('を使い')).length, 4, warnings.join('\n'))
})

test('grid: panel は 9 個まで、KPI の panel は 6 項目まで。超えた分は切って warnings に書く', () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ title: `p${i}`, list: ['x'] }))
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'grid', title: '題', panels: many }] })[0])
  assert.equal(s.panels.length, 9)
  const k = /** @type {any} */ (slidesOf({ slides: [{ layout: 'grid', title: '題', panels: [{ kpi: Array.from({ length: 8 }, (_, i) => ({ label: `k${i}`, value: i })) }] }] })[0])
  assert.equal(k.panels[0].kpi.length, 6)
})

test('grid: 数字の入口（dataset）を引いた図の出典は、panel に出典が無ければ panel の出典にする（panel の出典が勝つ）', () => {
  const datasets = { d: { source: '出所A', data: { items: [{ name: 'a', value: 1 }] } } }
  const s = /** @type {any} */ (slidesOf({ datasets, slides: [{ layout: 'grid', title: '題', panels: [
    { title: '図', look: { kind: 'donut', dataset: 'd' } },
    { title: '自分の出典', source: '自社調べ', look: { kind: 'donut', dataset: 'd' } },
  ] }] })[0])
  assert.equal(s.panels[0].source, '出所A')
  assert.equal(s.panels[1].source, '自社調べ')
  assert.equal(s.panels[0].blocks[0].alt, '図', 'alt が無ければ panel の題')
})

test('grid: arrange は名前か rows:（行の panel の数|高さの重み）だけ。auto は持たず、知らない書き方は捨てて warnings に書く', () => {
  const arrangeOf = (/** @type {any} */ a) => normalize(deckOf({ slides: [{ layout: 'grid', title: '題', arrange: a, panels: [{ list: ['x'] }] }] }))
  for (const a of ['1+2', '2x2', '3col', '1+3', 'kpi+3', '2x3', 'rows:2,3', 'rows:1,2,2|0.4,1,1.3', ' ROWS:1 | 1 ']) {
    const { doc, warnings } = arrangeOf(a)
    assert.equal(/** @type {any} */ (doc.slides?.[0]).arrange, a.trim().toLowerCase().replace(/\s+/g, ''), a)
    assert.deepEqual(warnings, [], a)
  }
  assert.equal(/** @type {any} */ (arrangeOf('auto').doc.slides?.[0]).arrange, undefined)
  for (const bad of ['4x4', 'rows:5', 'rows:', 'rows:1,2|', 'rows:1|a', 7]) {
    const { doc, warnings } = arrangeOf(bad)
    assert.equal(/** @type {any} */ (doc.slides?.[0]).arrange, undefined, String(bad))
    assert.ok(warnings.some((w) => w.includes('arrange')), String(bad))
  }
})

test('grid: layout を渡さなくても panels があれば grid になり、panels が無い grid は題か本文を残して content に落とす', () => {
  assert.equal(/** @type {any} */ (slidesOf({ slides: [{ title: '題', panels: [{ list: ['x'] }] }] })[0]).layout, 'grid')
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'grid', title: '題だけ' }] }))
  assert.equal(doc.slides?.[0].layout, 'content')
  assert.ok(warnings.length > 0)
  const other = normalize(deckOf({ slides: [{ layout: 'statement', title: '一文', panels: [{ list: ['x'] }], arrange: '2x2' }] }))
  assert.ok(other.warnings.some((w) => w.includes('panels') && w.includes('使わない')), other.warnings.join('\n'))
})

test('slide: kpi の value に数が来たら桁区切りの字にし、delta は符号から向きを決める', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'kpi', items: [{ label: '売上', value: 1234567, unit: '円', delta: 5 }, { label: '解約', value: '2%', delta: '-0.3pt' }, { label: '横ばい', value: 9, delta: '0' }, { label: '名前', name: 'x', value: 'v' }] }] })[0])
  assert.deepEqual(s.items[0], { label: '売上', value: '1,234,567', unit: '円', delta: '+5', trend: 'up' })
  assert.equal(s.items[1].trend, 'down')
  assert.equal(s.items[2].trend, 'flat')
  const over = /** @type {any} */ (slidesOf({ slides: [{ layout: 'kpi', items: [{ label: '解約率', value: '1.8', delta: '+0.3pt', trend: 'down' }, { label: 'x', value: '1', delta: '+1', trend: 'sideways' }] }] })[0])
  assert.equal(over.items[0].trend, 'down', '渡した trend が符号に勝つ')
  assert.equal(over.items[1].trend, 'up', '知らない trend は符号から決める')
})

test('slide: kpi は 4 個までで、value の無い項目と超えた分は捨てて warnings に書く', () => {
  const items = [1, 2, 3, 4, 5].map((v) => ({ label: `k${v}`, value: v }))
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'kpi', items }, { layout: 'kpi', title: '残る', items: [{ label: '値なし' }] }] }))
  assert.equal(/** @type {any} */ (doc.slides?.[0]).items.length, LIMITS.kpiItems)
  assert.equal(doc.slides?.[1].layout, 'content')
  assert.ok(warnings.some((w) => w.includes('超えた')))
  assert.ok(warnings.some((w) => w.includes('value')))
})

test('slide: compare は 3 列までで、highlight は最初の 1 つだけ残す', () => {
  const items = [1, 2, 3, 4].map((n) => ({ title: `T${n}`, points: ['a', 'b'], highlight: true }))
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'compare', items }] }))
  const out = /** @type {any} */ (doc.slides?.[0]).items
  assert.equal(out.length, LIMITS.compareItems)
  assert.deepEqual(out.map((/** @type {any} */ c) => c.highlight === true), [true, false, false])
  assert.ok(warnings.some((w) => w.includes('highlight')))
})

test('slide: closing の items は字かオブジェクトの text を受け、6 個で切る', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'closing', title: 'ありがとう', items: ['a', { text: 'b' }, '', 3, 'c', 'd', 'e', 'f'] }] })[0])
  assert.equal(s.items.length, LIMITS.closingItems)
  assert.deepEqual(s.items.slice(0, 3), ['a', 'b', '3'])
})

test('slide: split は left・right・ratio を持ち、使えない ratio は捨てる', () => {
  const ok = /** @type {any} */ (slidesOf({ slides: [{ layout: 'split', left: [{ type: 'para', text: 'l' }], right: [{ type: 'para', text: 'r' }], ratio: '5:7' }] })[0])
  assert.equal(ok.ratio, '5:7')
  assert.equal(ok.left.length, 1)
  const bad = normalize(deckOf({ slides: [{ layout: 'split', left: [{ type: 'para', text: 'l' }], ratio: '1:9' }] }))
  assert.equal(/** @type {any} */ (bad.doc.slides?.[0]).ratio, undefined)
  assert.ok(bad.warnings.some((w) => w.includes('ratio')))
})

test('slide: figure は chart・svg・image だけを受け、段落などは捨てる', () => {
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'figure', title: '図', figure: { type: 'para', text: 'x' } }, { layout: 'figure', figure: { type: 'svg', source: '<svg></svg>' } }] }))
  assert.equal(doc.slides?.[0].layout, 'content')
  assert.equal(/** @type {any} */ (doc.slides?.[1]).figure.type, 'svg')
  assert.ok(warnings.some((w) => w.includes('figure は chart・svg・image だけ')))
})

test('slide: figure の型で figure が無くても、blocks の最初の図を figure に引き上げる', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'figure', blocks: [{ type: 'para', text: 'a' }, { type: 'svg', source: '<svg></svg>' }] }] })[0])
  assert.equal(s.figure.type, 'svg')
  assert.equal(s.blocks, undefined)
})

test('slide: blocks・left・right・side は 12 個までで、頁の区切りと記入欄は資料の頁に置かない', () => {
  const many = Array.from({ length: 20 }, () => ({ type: 'para', text: 'p' }))
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'content', blocks: many }, { layout: 'content', blocks: [{ type: 'para', text: 'a' }, { type: 'pagebreak' }, { type: 'fields', items: [{ kind: 'text', name: 'n', label: 'l' }] }] }] }))
  assert.equal(/** @type {any} */ (doc.slides?.[0]).blocks.length, LIMITS.slideBlocks)
  assert.equal(/** @type {any} */ (doc.slides?.[1]).blocks.length, 1)
  assert.ok(warnings.some((w) => w.includes('pagebreak')))
  assert.ok(warnings.some((w) => w.includes('fields')))
})

test('slide: table の型は表 1 つだけを置く', () => {
  const t = { type: 'table', head: ['a'], rows: [['1']] }
  const { doc, warnings } = normalize(deckOf({ slides: [{ layout: 'table', title: '表', blocks: [{ type: 'para', text: 'x' }, t, t] }] }))
  assert.deepEqual(/** @type {any} */ (doc.slides?.[0]).blocks.map((/** @type {any} */ b) => b.type), ['table'])
  assert.ok(warnings.some((w) => w.includes('table の型')))
})

test('slide: sources は字 1 つでも列でも受け、同じ文は 1 回・8 本まで', () => {
  const one = /** @type {any} */ (slidesOf({ slides: [{ title: 'x', sources: '官報' }] })[0])
  assert.deepEqual(one.sources, ['官報'])
  const many = /** @type {any} */ (slidesOf({ slides: [{ title: 'x', sources: ['a', 'a', ...'bcdefghij'.split('')] }] })[0])
  assert.equal(many.sources.length, LIMITS.slideSources)
  assert.equal(new Set(many.sources).size, many.sources.length)
})

test('slide: notes は改行を残し、4000 字で切って warnings に書く', () => {
  const kept = /** @type {any} */ (slidesOf({ slides: [{ title: 'x', notes: '一行目\n二行目' }] })[0])
  assert.equal(kept.notes, '一行目\n二行目')
  const cut = normalize(deckOf({ slides: [{ title: 'x', notes: 'あ'.repeat(LIMITS.slideNotes + 10) }] }))
  assert.equal(/** @type {any} */ (cut.doc.slides?.[0]).notes.length, LIMITS.slideNotes)
  assert.ok(cut.warnings.some((w) => w.includes('notes')))
})

test('slide: 120 枚を超えたら切って warnings に書く', () => {
  const slides = Array.from({ length: LIMITS.slides + 5 }, (_, i) => ({ title: `s${i}` }))
  const { doc, warnings } = normalize(deckOf({ slides }))
  assert.equal(doc.slides?.length, LIMITS.slides)
  assert.ok(warnings.some((w) => w.includes(String(LIMITS.slides))))
})

test('slide: slides が JSON の字で届いても読み、配列でも JSON でもなければ無視する', () => {
  assert.equal(normalize(deckOf({ slides: JSON.stringify([{ title: 'x' }]) })).doc.slides?.length, 1)
  const bad = normalize(deckOf({ slides: '{壊れ' }))
  assert.deepEqual(bad.doc.slides, [])
  assert.ok(bad.warnings.some((w) => w.includes('slides')))
  assert.ok(normalize(deckOf({ slides: { title: 'x' } })).warnings.some((w) => w.includes('slides は配列')))
})

test('slide: 入力の slides を書き換えない', () => {
  const input = deckOf({ slides: [{ layout: 'kpi', items: [{ label: 'a', value: 1000 }], sources: ['a', 'a'] }], datasets: { d: { data: { x: 1 } } } })
  const before = JSON.stringify(input)
  normalize(input)
  assert.equal(JSON.stringify(input), before)
})

// ---------------------------------------------------------------- 資料の Markdown

/** @param {string[]} lines */
const mdDeck = (lines) => normalize(deckOf({ markdown: lines.join('\n') }))

test('Markdown の資料: --- だけの行で 1 枚ずつに割り、空の 1 枚は捨てる', () => {
  const { doc } = mdDeck(['## 一', '', '- a', '', '---', '', '---', '', '## 二', '', '- b'])
  assert.deepEqual(doc.slides?.map((s) => s.title), ['一', '二'])
})

test('Markdown の資料: コードの囲みの中の --- では割らない', () => {
  const { doc } = mdDeck(['## コード', '', FENCE, 'a', '---', 'b', FENCE, '', '---', '', '## 次', '', '- x'])
  assert.equal(doc.slides?.length, 2)
  const first = /** @type {any} */ (doc.slides?.[0]).blocks.map((/** @type {any} */ x) => plainText(x.text)).join('\n')
  assert.match(first, /---/)
})

test('Markdown の資料: 字の直後の --- は見出しにせず、1 枚の区切りにする', () => {
  const { doc } = mdDeck(['## 一', '', '- a', '---', '## 二', '', '- b'])
  assert.deepEqual(doc.slides?.map((s) => s.title), ['一', '二'])
})

test('Markdown の文書: --- は今までどおり rule の Block になる', () => {
  const { doc } = normalize({ title: 't', markdown: '前\n\n---\n\n後' })
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para', 'rule', 'para'])
})

test('Markdown の資料: 文書の題と同じ頭の # は表紙になり、最初の段落が lead になる', () => {
  const s = /** @type {any[]} */ (mdDeck(['# 題', '', '副題の段落', '', '---', '', '# 第一部', '', '---', '', '# 題', '', '二度目']).doc.slides)
  assert.deepEqual(s.map((x) => x.layout), ['cover', 'section', 'section'])
  assert.equal(s[0].lead, '副題の段落')
  assert.equal(s[1].number, '01')
  assert.equal(s[2].number, '02')
})

test('Markdown の資料: ## と短い 1 文だけの 1 枚は statement で、1 文を大きく・題を kicker にする', () => {
  const s = /** @type {any} */ (mdDeck(['## 結論', '', '導入すれば納期の返事が半日から 10 分になる']).doc.slides?.[0])
  assert.equal(s.layout, 'statement')
  assert.equal(s.title, '導入すれば納期の返事が半日から 10 分になる')
  assert.equal(s.kicker, '結論')
})

test('Markdown の資料: 100 字を超える 1 段落は statement にせず content にする', () => {
  const s = /** @type {any} */ (mdDeck(['## 長い', '', 'あ'.repeat(101)]).doc.slides?.[0])
  assert.equal(s.layout, 'content')
  assert.equal(s.title, '長い')
})

test('Markdown の資料: 見出しだけの 1 枚は statement、引用だけの 1 枚は quote、図 1 つだけの 1 枚は figure', () => {
  const chart = FENCE + 'chart\n{"kind":"donut","data":{"items":[{"name":"a","value":1}]}}\n' + FENCE
  const s = /** @type {any[]} */ (mdDeck(['## 見出しだけ', '', '---', '', '> 引用の本文', '', '---', '', chart]).doc.slides)
  assert.deepEqual(s.map((x) => x.layout), ['statement', 'quote', 'figure'])
  assert.equal(s[1].quote, '引用の本文')
  assert.equal(s[2].figure.kind, 'donut')
})

test('Markdown の資料: 箇条書きや表を含む 1 枚は content になり、頁の区切りは捨てる', () => {
  const { doc, warnings } = mdDeck(['## 内訳', '', '- a', '- b', '', '| x | y |', '| - | - |', '| 1 | 2 |', '', '<!-- pagebreak -->'])
  assert.deepEqual(/** @type {any} */ (doc.slides?.[0]).blocks.map((/** @type {any} */ b) => b.type), ['list', 'table'])
  assert.ok(warnings.some((w) => w.includes('pagebreak')))
})

test('Markdown の資料: 日本語の 1 枚の題と lead は印を残したまま渡す', () => {
  const s = /** @type {any} */ (mdDeck(['## **要点**', '', '{漢字|かんじ}を読む']).doc.slides?.[0])
  assert.equal(s.kicker, '**要点**')
  assert.equal(s.title, '{漢字|かんじ}を読む')
})

// ---------------------------------------------------------------- 数字の入口（datasets）と図の kind

const DONUT = { items: [{ name: 'a', value: 1 }, { name: 'b', value: 3 }], unit: '円' }

test('chart: kind と data で look の図になる', () => {
  const b = /** @type {any} */ (normalize({ title: 't', blocks: [{ type: 'chart', kind: 'Donut', data: DONUT }] }).doc.blocks[0])
  assert.deepEqual(b, { type: 'chart', kind: 'donut', data: DONUT })
})

test('chart: dataset を引くと data になり、文書の図には出典が説明として付く', () => {
  const { doc } = normalize({
    title: 't',
    datasets: { d: { data: DONUT, source: '官報', asOf: '2026-09' } },
    blocks: [{ type: 'chart', kind: 'donut', dataset: 'd' }, { type: 'chart', kind: 'donut', dataset: 'd', caption: '内訳' }],
  })
  const [a, b] = /** @type {any[]} */ (doc.blocks)
  assert.deepEqual(a.data, DONUT)
  assert.equal(a.dataset, 'd')
  assert.equal(a.caption, '出典: 官報（2026-09 時点）')
  assert.equal(b.caption, '内訳（出典: 官報（2026-09 時点））')
  assert.deepEqual(Object.keys(/** @type {any} */ (doc).datasets), ['d'])
})

test('chart: 資料の図の出典は説明でなく、その 1 枚の sources に入る', () => {
  const { doc } = normalize(deckOf({
    datasets: { d: { data: DONUT, source: '官報' } },
    slides: [{ layout: 'figure', title: '内訳', figure: { type: 'chart', kind: 'donut', dataset: 'd' }, sources: ['自社調べ'] }],
  }))
  const s = /** @type {any} */ (doc.slides?.[0])
  assert.deepEqual(s.sources, ['自社調べ', '官報'])
  assert.equal(s.figure.caption, undefined)
})

test('chart: 英語の資料の出典には as of を添える', () => {
  const { doc } = normalize(deckOf({ lang: 'en', datasets: { d: { data: DONUT, source: 'Census', asOf: '2026' } }, slides: [{ layout: 'figure', figure: { type: 'chart', kind: 'donut', dataset: 'd' } }] }))
  assert.deepEqual(/** @type {any} */ (doc.slides?.[0]).sources, ['Census (as of 2026)'])
})

test('chart: datasets に無い dataset だけで data も option も無ければ、図を捨てて warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'donut', dataset: 'zz' }, { type: 'para', text: '残る' }] })
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para'])
  assert.ok(warnings.some((w) => w.includes('"zz"')))
})

test('chart: kind の data が無くても option があれば option で描き、warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'donut', option: { series: [] } }] })
  assert.deepEqual(doc.blocks[0], { type: 'chart', option: { series: [] } })
  assert.ok(warnings.some((w) => w.includes('option で描く')))
})

test('chart: kind と option が両方ある時は kind を使い、option は捨てて warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'donut', data: DONUT, option: { series: [] } }] })
  assert.equal(/** @type {any} */ (doc.blocks[0]).option, undefined)
  assert.equal(/** @type {any} */ (doc.blocks[0]).kind, 'donut')
  assert.ok(warnings.some((w) => w.includes('kind を使う')))
})

test('chart: kind の名前の形が合わない時は使わず、知らない名前の確かめは描く時に任せる', () => {
  const bad = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'Bad Name!', data: DONUT, option: { series: [] } }] })
  assert.deepEqual(bad.doc.blocks[0], { type: 'chart', option: { series: [] } })
  assert.ok(bad.warnings.some((w) => w.includes('kind は')))
  const unknown = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'no-such-look', data: DONUT }] })
  assert.equal(/** @type {any} */ (unknown.doc.blocks[0]).kind, 'no-such-look')
})

test('chart: option だけの図は今までどおり option のまま', () => {
  const { doc } = normalize({ title: 't', blocks: [{ type: 'chart', option: { series: [{ type: 'bar', data: [1] }] } }] })
  assert.deepEqual(doc.blocks[0], { type: 'chart', option: { series: [{ type: 'bar', data: [1] }] } })
})

test('datasets: 壊れた入口だけ捨てて、ほかは使う', () => {
  const { doc, warnings } = normalize({
    title: 't',
    markdown: 'x',
    datasets: { ok: { data: DONUT, source: 's' }, noData: { source: 'x' }, str: 'x', arr: { data: [1, 2] } },
  })
  assert.deepEqual(Object.keys(/** @type {any} */ (doc).datasets), ['ok'])
  assert.ok(warnings.length >= 3)
})

test('datasets: JSON の字で届いても読み、読めない字は無視する', () => {
  const ok = normalize({ title: 't', markdown: 'x', datasets: JSON.stringify({ d: { data: DONUT } }) })
  assert.deepEqual(Object.keys(/** @type {any} */ (ok.doc).datasets), ['d'])
  const bad = normalize({ title: 't', markdown: 'x', datasets: '{壊れ' })
  assert.equal(/** @type {any} */ (bad.doc).datasets, undefined)
  assert.ok(bad.warnings.some((w) => w.includes('datasets')))
})

test('datasets: 40 個を超えたら切り、1 つの data が 200,000 字を超えたら捨てる', () => {
  const many = Object.fromEntries(Array.from({ length: LIMITS.datasets + 5 }, (_, i) => [`d${i}`, { data: { v: i } }]))
  const { doc, warnings } = normalize({ title: 't', markdown: 'x', datasets: many })
  assert.equal(Object.keys(/** @type {any} */ (doc).datasets).length, LIMITS.datasets)
  assert.ok(warnings.some((w) => w.includes(String(LIMITS.datasets))))
  const big = normalize({ title: 't', markdown: 'x', datasets: { big: { data: { s: 'a'.repeat(LIMITS.datasetJson) } } } })
  assert.equal(/** @type {any} */ (big.doc).datasets, undefined)
})

test('datasets: 無ければ Doc に datasets の項目を作らない', () => {
  assert.equal('datasets' in normalize({ title: 't', markdown: 'x' }).doc, false)
})

// ---------------------------------------------------------------- 事業計画の型（template）

test('template: bizplan に plan が無ければ、頁を作らず warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ template: 'bizplan' }))
  assert.deepEqual(doc.slides, [])
  assert.ok(warnings.some((w) => w.includes('plan が無い')))
})

test('template: 知らない型は無視して warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', template: 'poster', markdown: 'x' })
  assert.equal(doc.kind, 'doc')
  assert.ok(warnings.some((w) => w.includes('template')))
})

test('template: bizplan の頁の後ろに Markdown の頁、その後ろに slides の頁が並ぶ', () => {
  const { doc } = normalize(deckOf({
    template: 'bizplan',
    plan: { company: '会社', tagline: 'ひとこと' },
    markdown: '## 追加の頁\n\n- a',
    slides: [{ layout: 'quote', quote: '最後' }],
  }))
  const layouts = /** @type {any[]} */ (doc.slides).map((s) => s.layout)
  assert.equal(layouts[0], 'cover')
  assert.deepEqual(layouts.slice(-3), ['closing', 'content', 'quote'])
})

test('template: plan が JSON の字で届いても読む', () => {
  const { doc } = normalize(deckOf({ template: 'bizplan', plan: JSON.stringify({ company: '会社' }) }))
  assert.equal(/** @type {any} */ (doc.slides?.[0]).title, '会社')
})

test('template: plan が配列などオブジェクトでなければ無視して warnings に書く', () => {
  const { doc, warnings } = normalize(deckOf({ template: 'bizplan', plan: [1, 2] }))
  assert.deepEqual(doc.slides, [])
  assert.ok(warnings.some((w) => w.includes('plan')))
})

test('template: 利用者が同じ名前の datasets を渡していれば、plan から作った数字より優先する', () => {
  const mine = { items: [{ name: 'TAM', value: 1 }, { name: 'SAM', value: 1 }, { name: 'SOM', value: 1 }], unit: '円' }
  const { doc } = normalize(deckOf({
    template: 'bizplan',
    plan: { company: '会社', market: { tam: 100, sam: 30, som: 5, unit: '億円' } },
    datasets: { market: { data: mine, source: '金融データ' } },
  }))
  const panels = (doc.slides ?? []).flatMap((s) => /** @type {any} */ (s).panels ?? [])
  const fig = panels.find((p) => p.title === '市場規模').blocks[0]
  assert.deepEqual(fig.data, mine)
  assert.deepEqual(/** @type {any} */ (doc).datasets.market.data, mine)
})

// ---------------------------------------------------------------- 素材（ECharts の見本・テーマ・ロゴ）

test('chart: example・theme・data を素通しし、option は無くてもよい', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [{ type: 'chart', example: 'bar-stack', theme: 'macarons', data: [['p', 'a'], ['x', 1]], option: { title: { text: '題' } }, caption: '図1', height: 200 }],
  })
  assert.deepEqual(doc.blocks[0], { type: 'chart', option: { title: { text: '題' } }, example: 'bar-stack', theme: 'macarons', data: [['p', 'a'], ['x', 1]], caption: '図1', height: 200 })
  assert.deepEqual(warnings, [])
  const only = normalize({ title: 't', blocks: [{ type: 'chart', example: 'pie-simple' }] })
  assert.deepEqual(only.doc.blocks[0], { type: 'chart', example: 'pie-simple' })
  assert.deepEqual(only.warnings, [])
})

test('chart: data は { series } の object でも JSON の字でも受け、壊れた字や大きすぎる data は捨てて warnings に書く', () => {
  const obj = normalize({ title: 't', blocks: [{ type: 'chart', example: 'bar-simple', data: { series: [{ name: 'a', data: [1, 2] }] } }] })
  assert.deepEqual(/** @type {any} */ (obj.doc.blocks[0]).data, { series: [{ name: 'a', data: [1, 2] }] })
  const text = normalize({ title: 't', blocks: [{ type: 'chart', example: 'bar-simple', data: '[[1,2]]' }] })
  assert.deepEqual(/** @type {any} */ (text.doc.blocks[0]).data, [[1, 2]])
  const broken = normalize({ title: 't', blocks: [{ type: 'chart', example: 'bar-simple', data: '{ oops' }] })
  assert.equal(/** @type {any} */ (broken.doc.blocks[0]).data, undefined)
  assert.ok(broken.warnings.some((w) => w.includes('data')))
  const huge = normalize({ title: 't', blocks: [{ type: 'chart', example: 'bar-simple', data: [Array.from({ length: LIMITS.datasetJson }, () => 1)] }] })
  assert.equal(/** @type {any} */ (huge.doc.blocks[0]).data, undefined)
  assert.ok(huge.warnings.some((w) => w.includes(String(LIMITS.datasetJson))))
})

test('chart: example と theme は英数字と _ - だけの名前で、形が合わなければ捨てて warnings に書く（パスを通さない）', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'chart', example: '../secret', theme: 'a b', option: { series: [] } }] })
  const b = /** @type {any} */ (doc.blocks[0])
  assert.equal(b.example, undefined)
  assert.equal(b.theme, undefined)
  assert.deepEqual(b.option, { series: [] })
  assert.equal(warnings.filter((w) => w.includes('example') || w.includes('theme')).length, 2)
  const gone = normalize({ title: 't', blocks: [{ type: 'chart', example: '..\\x' }] })
  assert.equal(gone.doc.blocks.length, 0)
})

test('chart: kind と example が両方ある時は kind を使い、example は使わない', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'chart', kind: 'donut', example: 'pie-simple', data: { items: [{ name: 'a', value: 1 }] } }] })
  const b = /** @type {any} */ (doc.blocks[0])
  assert.equal(b.kind, 'donut')
  assert.equal(b.example, undefined)
  assert.ok(warnings.some((w) => w.includes('kind') && w.includes('example')))
})

test('chart: Markdown の ```chart に example と data を書ける（option を持たなくてよい）', () => {
  const md = `# h\n\n${FENCE}chart\n{ "example": "line-simple", "theme": "vivid", "data": { "categories": ["a"], "series": [{ "data": [1] }] }, "caption": "図" }\n${FENCE}\n`
  const { blocks, warnings } = fromMarkdown(md)
  assert.deepEqual(blocks.find((b) => b.type === 'chart'), { type: 'chart', example: 'line-simple', theme: 'vivid', data: { categories: ['a'], series: [{ data: [1] }] }, caption: '図' })
  assert.deepEqual(warnings, [])
  const plain = fromMarkdown(`${FENCE}chart\n{ "xAxis": {}, "series": [] }\n${FENCE}\n`)
  assert.deepEqual(plain.blocks[0], { type: 'chart', option: { xAxis: {}, series: [] } })
})

test('logo: 要点（kpi）の項目の logo は大文字にそろえて素通しし、形が違えば warnings に書いて捨てる', () => {
  const s = /** @type {any} */ (slidesOf({ slides: [{ layout: 'kpi', items: [{ label: 'IBM', value: '1', logo: 'nyse:ibm' }, { label: 'トヨタ', value: '2', logo: 'TSE:7203' }, { label: '悪', value: '3', logo: 'IBM' }, { label: '無', value: '4' }] }] })[0])
  assert.deepEqual(s.items.map((/** @type {any} */ i) => i.logo), ['NYSE:IBM', 'TSE:7203', undefined, undefined])
})

test('logo: 表のセルは { text, logo } でもよく、logo はセルの最初の Inline に載る（logo が無いセルの形は変わらない）', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [{ type: 'table', head: ['社名', '株価'], rows: [[{ text: 'IBM', logo: 'NYSE:IBM' }, '200'], ['トヨタ', '3000'], [{ text: '', logo: 'nyse:brk.b' }, '400']] }],
  })
  const tb = /** @type {any} */ (doc.blocks[0])
  assert.deepEqual(tb.rows.map((/** @type {any} */ r) => r.map(plainText)), [['IBM', '200'], ['トヨタ', '3000'], ['', '400']])
  assert.deepEqual(tb.rows.map((/** @type {any} */ r) => r.map((/** @type {any} */ c) => c[0]?.logo ?? null)), [['NYSE:IBM', null], [null, null], ['NYSE:BRK.B', null]])
  assert.equal(tb.logos, undefined)
  assert.deepEqual(warnings, [])
})

test('logo: 表の頭のセルの logo と、形の違う logo は使わず warnings に書く', () => {
  const { doc, warnings } = normalize({ title: 't', blocks: [{ type: 'table', head: [{ text: '社名', logo: 'NYSE:IBM' }], rows: [[{ text: 'x', logo: 'bad' }]] }] })
  const tb = /** @type {any} */ (doc.blocks[0])
  assert.equal(JSON.stringify(tb).includes('logo'), false)
  assert.ok(warnings.some((w) => w.includes('頭の行')))
  assert.ok(warnings.some((w) => w.includes('logo は')))
})

test('logo: 箇条書きの項目は { text, logo } でもよく、logo は items と同じ並びの logos に分けて持つ', () => {
  const { doc, warnings } = normalize({
    title: 't',
    blocks: [{ type: 'list', ordered: false, items: ['無印', { text: 'IBM', logo: 'NYSE:IBM' }, { text: '入れ子', logo: 'TSE:7203', items: ['子'] }] }],
  })
  const li = /** @type {any} */ (doc.blocks[0])
  assert.deepEqual(li.logos, [null, 'NYSE:IBM', 'TSE:7203'])
  assert.equal(li.items.length, 3)
  assert.deepEqual(warnings, [])
  const none = /** @type {any} */ (normalize({ title: 't', blocks: [{ type: 'list', ordered: true, items: ['a', 'b'] }] }).doc.blocks[0])
  assert.equal(none.logos, undefined)
})
