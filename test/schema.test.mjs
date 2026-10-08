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
  assert.deepEqual(doc, { title: '題', lang: 'ja', theme: 'mono', body: 'mincho', paper: 'A4', landscape: false, blocks: [] })
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
  const { doc, warnings } = normalize({ title: 't', theme: 'koma', body: 'gothic', paper: 'B5', landscape: true, size: 11, author: '中田', lang: 'en', markdown: 'x' })
  assert.deepEqual(
    { ...doc, blocks: [] },
    { title: 't', author: '中田', lang: 'en', theme: 'koma', body: 'gothic', paper: 'B5', landscape: true, size: 11, blocks: [] },
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
