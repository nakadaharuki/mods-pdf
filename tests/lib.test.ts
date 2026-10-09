// hooks/lib/ の純な部品の試験（ファイルにも $ にも触らない）。
import { expect, test } from 'claude-code/testing'
import { OUT_DIR, READ_LIMIT, baseNameOf, checkReadPath, cleanName, isInside, outPath } from '../hooks/lib/paths.mjs'
import { imageInfo, imagePathsOf } from '../hooks/lib/image.mjs'
import { capList, visible } from '../hooks/lib/visible.mjs'
import { fieldsAnswer, fillAnswer, makeAnswer, mergeAnswer, stampAnswer } from '../hooks/lib/report.mjs'
import { PANE_CELL, fontsLine, paneBox, paneTree } from '../hooks/lib/pane.mjs'

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** IHDR だけの PNG の頭 */
const pngHead = (w: number, h: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 2, 0, 0, 0]
/** APP0 を 1 つ挟んで SOF0 に着く JPEG の頭 */
const jpgHead = (w: number, h: number) => [0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...new Array(14).fill(0), 0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]

test('cleanName は日本語の字を残し、危ない字を - にする', () => {
  expect(cleanName('見積書 2026/10')).toBe('見積書-2026-10')
  expect(cleanName('a:b*c?d')).toBe('a-b-c-d')
})

test('cleanName は拡張子 .pdf と先頭の点を外し、空なら document にする', () => {
  expect(cleanName('報告.pdf')).toBe('報告')
  expect(cleanName('...hidden')).toBe('hidden')
  expect(cleanName('')).toBe('document')
  expect(cleanName(undefined)).toBe('document')
})

test('cleanName は 80 字で切り、Windows の装置名に _ を付ける', () => {
  expect(Array.from(cleanName('あ'.repeat(200))).length).toBe(80)
  expect(cleanName('con')).toBe('_con')
  expect(cleanName('NUL.txt')).toBe('_NUL.txt')
  expect(cleanName('console')).toBe('console')
})

test('outPath は必ず pdf/ の下の .pdf になる', () => {
  expect(outPath('見積書')).toBe(`${OUT_DIR}/見積書.pdf`)
  expect(outPath('../../x')).toMatch(/^pdf\/[^/]+\.pdf$/)
  expect(outPath('../../x').includes('..-')).toBe(true)
})

test('baseNameOf はフォルダーと拡張子を外す', () => {
  expect(baseNameOf('docs/forms/申込書.pdf')).toBe('申込書')
  expect(baseNameOf('a\\b\\c.PDF')).toBe('c')
})

test('checkReadPath は作業フォルダーからの相対の綴りだけを通す', () => {
  expect(checkReadPath('docs/form.pdf', ['pdf'])).toEqual({ ok: true, path: 'docs/form.pdf' })
  expect(checkReadPath('  a.PDF ', ['pdf'])).toEqual({ ok: true, path: 'a.PDF' })
  expect(checkReadPath('img/pic.jpeg', ['png', 'jpg', 'jpeg']).ok).toBe(true)
})

test('checkReadPath は絶対パス・ドライブ・ネットワーク・~・: ・.. ・制御文字を断る', () => {
  const bad = ['/etc/a.pdf', '\\\\server\\share\\a.pdf', 'C:\\a.pdf', 'C:a.pdf', '~/a.pdf', 'a.pdf:stream', '../a.pdf', 'x/../a.pdf', `a${String.fromCodePoint(0)}.pdf`, '', '   ']
  for (const p of bad) {
    const r = checkReadPath(p, ['pdf'])
    expect(r.ok).toBe(false)
    expect((r as any).reason.length > 0).toBe(true)
  }
  expect(checkReadPath(undefined, ['pdf']).ok).toBe(false)
  expect(checkReadPath(42, ['pdf']).ok).toBe(false)
})

test('checkReadPath は拡張子が違う・無いファイルを断り、理由に読める拡張子を書く', () => {
  const r = checkReadPath('notes.txt', ['pdf']) as any
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('pdf')
  expect(checkReadPath('noext', ['pdf']).ok).toBe(false)
})

test('READ_LIMIT は base64 で 4 MiB に収まる 3 MiB', () => {
  expect(READ_LIMIT).toBe(3 * 1024 * 1024)
})

test('isInside は作業フォルダーの下だけを内側とし、同じ頭の別フォルダーは外にする', () => {
  expect(isInside('/work/pdf/a.pdf', '/work')).toBe(true)
  expect(isInside('/work/', '/work')).toBe(false)
  expect(isInside('/work', '/work')).toBe(false)
  expect(isInside('/work2/a.pdf', '/work')).toBe(false)
  expect(isInside('/elsewhere/a.pdf', '/work')).toBe(false)
  expect(isInside(undefined, '/work')).toBe(false)
  expect(isInside('/work/a.pdf', undefined)).toBe(false)
})

test('isInside は Windows のパスでは区切りと大文字小文字を無視し、Linux のパスでは区別する', () => {
  expect(isInside('C:\\Work\\Docs\\A.pdf', 'c:/work')).toBe(true)
  expect(isInside('D:\\Work\\A.pdf', 'c:/work')).toBe(false)
  expect(isInside('/Work/a.pdf', '/work')).toBe(false)
})

test('imageInfo は PNG の幅と高さを IHDR から読む', () => {
  expect(imageInfo(b64(pngHead(640, 480)))).toEqual({ kind: 'png', width: 640, height: 480 })
})

test('imageInfo は JPEG の幅と高さを、APP0 を飛ばして SOF から読む', () => {
  expect(imageInfo(b64(jpgHead(300, 200)))).toEqual({ kind: 'jpg', width: 300, height: 200 })
})

test('imageInfo は画像でない・壊れた・巨大すぎる寸法の物を null にする', () => {
  expect(imageInfo(btoa('これは画像ではない'.replace(/[^\x00-\x7f]/g, 'x') + 'xxxxxxxx'))).toBeNull()
  expect(imageInfo(b64(pngHead(640, 480).slice(0, 20)))).toBeNull()
  expect(imageInfo(b64(pngHead(0, 480)))).toBeNull()
  expect(imageInfo(b64(pngHead(40000, 10)))).toBeNull()
  expect(imageInfo('')).toBeNull()
  expect(imageInfo('***')).toBeNull()
})

test('imagePathsOf は Markdown の画像の path を重複なしで集める', () => {
  const md = '# 題\n\n![一](a.png)\n\n![二](dir/b.jpg)\n\n![三](a.png)\n'
  expect(imagePathsOf({ title: '題', markdown: md })).toEqual(['a.png', 'dir/b.jpg'])
  expect(imagePathsOf({ markdown: md })).toEqual([])
  expect(imagePathsOf(null)).toEqual([])
})

test('visible は見えない字・向きを変える字・改行を <U+XXXX> にして見えるようにする', () => {
  const rlo = String.fromCodePoint(0x202e)
  const zw = String.fromCodePoint(0x200b)
  expect(visible(`氏${rlo}名${zw}`)).toBe('氏<U+202E>名<U+200B>')
  expect(visible('a\nb\tc')).toBe('a<U+000A>b<U+0009>c')
  expect(visible(String.fromCodePoint(0xe0041))).toBe('<U+E0041>')
  expect(visible('氏名 山田')).toBe('氏名 山田')
})

test('visible は長い字を max で切って … を付け、字数は絵文字なども 1 字で数える', () => {
  expect(visible('あ'.repeat(10), 4)).toBe('ああああ…')
  expect(visible('ab', 2)).toBe('ab')
  expect(visible(undefined)).toBe('')
  expect(visible(String.fromCodePoint(0x1f600).repeat(3), 2)).toBe(`${String.fromCodePoint(0x1f600).repeat(2)}…`)
})

test('capList は上限までに絞って ほか n 件 を付ける', () => {
  expect(capList(['a', 'b'], 3)).toEqual(['a', 'b'])
  expect(capList(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a', 'b', 'ほか 3 件'])
})

test('makeAnswer は書いた場所・頁数・組版の数字・警告を短く返す', () => {
  const text = makeAnswer({
    path: 'pdf/a.pdf', pages: 3, bytes: 120_000, warnings: ['最後の頁が 2 行だけです'],
    stats: { lines: 80, justified: 70, maxSpread: 0.234, runts: 1, overfull: 0, missingGlyphs: ['繝'], lastPageFill: 0.4 },
    ms: { compose: 340, render: 1500 },
  })
  expect(text).toContain('書きました: pdf/a.pdf（3 頁・117 KB）')
  expect(text).toContain('行 80')
  expect(text).toContain('字間を開けた最大 0.23 em')
  expect(text).toContain('無い字 繝')
  expect(text).toContain('最後の頁の埋まり 40%')
  expect(text).toContain('組版 340 ms')
  expect(text).toContain('PDF 1.5 秒')
  expect(text).toContain('警告 1 件')
})

test('makeAnswer は警告を 20 件までにして残りを ほか n 件 にまとめる', () => {
  const warnings = Array.from({ length: 25 }, (_, i) => `警告${i}`)
  const text = makeAnswer({ path: 'pdf/a.pdf', pages: 1, bytes: 1000, warnings })
  expect(text).toContain('警告 25 件')
  expect(text).toContain('警告19')
  expect(text).not.toContain('警告20')
  expect(text).toContain('ほか 5 件')
})

test('fieldsAnswer は欄が無ければそう答え、あれば座標の系と名前・値・選択肢を出す', () => {
  expect(fieldsAnswer('a.pdf', [])).toContain('記入欄はありません')
  const text = fieldsAnswer('a.pdf', [
    { name: '氏名', kind: 'text', value: '山田', page: 1, rect: [10.04, 20, 100, 14], readOnly: false },
    { name: '種別', kind: 'choice', value: '法人', options: ['個人', '法人'], page: 1, rect: [0, 0, 1, 1], readOnly: true },
  ])
  expect(text).toContain('記入欄 2 個（a.pdf）')
  expect(text).toContain('PDF の座標（pt・左下が原点）')
  expect(text).toContain('"氏名"')
  expect(text).toContain('rect [10, 20, 100, 14]')
  expect(text).toContain('選択肢 ["個人", "法人"]')
  expect(text).toContain('読み取り専用')
})

test('fieldsAnswer は他人の PDF の字の見えない部分を <U+XXXX> にして返す', () => {
  const rlo = String.fromCodePoint(0x202e)
  const text = fieldsAnswer('a.pdf', [{ name: `名${rlo}前`, kind: 'text', value: `値${rlo}`, page: 1, rect: [0, 0, 1, 1], readOnly: false }])
  expect(text).toContain('<U+202E>')
  expect(text.includes(rlo)).toBe(false)
})

test('fillAnswer は埋めた欄・PDF に無い名前・入れられなかった欄を分けて返す', () => {
  const text = fillAnswer({
    path: 'pdf/a-filled.pdf', bytes: 5000, filled: ['氏名'], missing: ['住所'],
    failed: [{ name: '種別', reason: '選択肢に無い値' }], warnings: [], flatten: true,
  })
  expect(text).toContain('欄を消して字にした')
  expect(text).toContain('埋めた欄 1 個: "氏名"')
  expect(text).toContain('PDF に無い名前 1 個: "住所"（fields で名前を確かめてください）')
  expect(text).toContain('"種別"（選択肢に無い値）')
})

test('mergeAnswer は頁数を答え、記入欄が見た目だけになることを添える', () => {
  const text = mergeAnswer({ path: 'pdf/m.pdf', pages: 5, bytes: 90_000, parts: 2 })
  expect(text).toContain('2 個の PDF から 5 頁')
  expect(text).toContain('見た目だけ')
})

test('stampAnswer は字を書いた数と警告を返す', () => {
  const text = stampAnswer({ path: 'pdf/s.pdf', bytes: 9000, marks: 3, warnings: ['位置が頁の外です'] })
  expect(text).toContain('字を 3 か所')
  expect(text).toContain('位置が頁の外です')
})

test('paneBox は頁の縦横比を保ち、欄の見積もりの中に収める', () => {
  const a4 = paneBox(54, 33, 595.28, 841.89)
  expect(Math.abs(a4.w / a4.h - 595.28 / 841.89) < 0.01).toBe(true)
  expect(a4.w <= 54 * PANE_CELL.w).toBe(true)
  expect(a4.h <= 33 * PANE_CELL.h).toBe(true)
  const wide = paneBox(54, 33, 841.89, 595.28)
  expect(wide.w > wide.h).toBe(true)
  expect(wide.w <= 54 * PANE_CELL.w).toBe(true)
})

test('paneBox は桁・行・頁の大きさが読めない時も既定の値で大きさを返す', () => {
  const box = paneBox(NaN, NaN, 0, 0)
  expect(box.w > 0 && box.h > 0).toBe(true)
  const tiny = paneBox(1, 1, 595.28, 841.89)
  expect(tiny.w >= 160 * 0.5 && tiny.h > 0).toBe(true)
})

test('fontsLine は読めない・読み込み中・読み終えた の 3 つを字にする', () => {
  expect(fontsLine({ loaded: 1, total: 4, ms: null, error: '壊れた' })).toBe('書体を読めません: 壊れた')
  expect(fontsLine({ loaded: 2, total: 4, ms: null, error: null })).toBe('書体を読み込み中 2/4')
  expect(fontsLine({ loaded: 4, total: 4, ms: 1234, error: null })).toBe('書体の読み込み 1.2 秒')
  expect(fontsLine({ loaded: 4, total: 4, ms: null, error: null })).toBe('書体 読み込み済み')
})

// 部品の表の作り物（Box・Text・Button・Svg を { type, props, children } にする）
const comps = Object.fromEntries(['Box', 'Text', 'Button', 'Svg'].map((type) => [type, (props: any = {}) => ({ type, props, children: props.children ?? [] })]))
const walk = (n: any, out: any[] = []) => { if (n && typeof n === 'object') { out.push(n); for (const c of n.children ?? []) walk(c, out) } return out }
const texts = (tree: any) => walk(tree).filter((n) => n.type === 'Text').flatMap((n) => n.children).join('\n')
const noop = () => {}
const MODEL = (over: any = {}) => ({
  surface: 'desktop', cols: 54, rows: 33, doc: { title: '見積書', path: 'pdf/見積書.pdf', pages: 3 }, page: 0,
  svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', pageW: 595.28, pageH: 841.89,
  fonts: { loaded: 4, total: 4, ms: 1000, error: null }, note: null, busy: false, ...over,
})

test('paneTree は文書が無い時に案内と見本ボタンを出し、押すと sample が呼ばれる', () => {
  let called = ''
  const tree = paneTree(comps, MODEL({ doc: null, svg: null }), { prev: noop, next: noop, open: noop, sample: () => { called = 'sample' } })
  expect(texts(tree)).toContain('まだ文書がありません')
  const sample = walk(tree).find((n) => n.type === 'Button' && n.props.key === 'pdf:sample')
  expect(sample).toBeDefined()
  sample.props.onPress()
  expect(called).toBe('sample')
})

test('paneTree はデスクトップで頁の絵を 1 つ置き、alt に題名と頁を書き、前へ・次へ・開くの 3 つのボタンを並べる', () => {
  const tree = paneTree(comps, MODEL(), { prev: noop, next: noop, open: noop, sample: noop })
  const svgs = walk(tree).filter((n) => n.type === 'Svg')
  expect(svgs.length).toBe(1)
  expect(svgs[0].props.alt).toBe('見積書 の 1 / 3 頁')
  expect(svgs[0].props.width > 0 && svgs[0].props.height > 0).toBe(true)
  const keys = walk(tree).filter((n) => n.type === 'Button').map((n) => n.props.key)
  expect(keys).toEqual(['pdf:prev', 'pdf:next', 'pdf:open'])
  expect(texts(tree)).toContain('1 / 3')
})

test('paneTree の最初の頁では前へが、最後の頁では次へが薄くなる', () => {
  const dim = (page: number, key: string) => walk(paneTree(comps, MODEL({ page }), { prev: noop, next: noop, open: noop, sample: noop })).find((n) => n.props?.key === key).props.dimColor
  expect(dim(0, 'pdf:prev')).toBe(true)
  expect(dim(0, 'pdf:next')).toBeUndefined()
  expect(dim(2, 'pdf:next')).toBe(true)
  expect(dim(2, 'pdf:prev')).toBeUndefined()
})

test('paneTree は端末では Svg を置かず、題名と場所を字で出す', () => {
  const tree = paneTree(comps, MODEL({ surface: 'terminal', svg: null }), { prev: noop, next: noop, open: noop, sample: noop })
  expect(walk(tree).some((n) => n.type === 'Svg')).toBe(false)
  expect(texts(tree)).toContain('見積書')
  expect(texts(tree)).toContain('pdf/見積書.pdf')
})

test('paneTree の note は書体の行より先に欄の上の行へ出る', () => {
  const tree = paneTree(comps, MODEL({ note: '開けませんでした' }), { prev: noop, next: noop, open: noop, sample: noop })
  expect(texts(tree)).toContain('開けませんでした')
  expect(texts(tree)).not.toContain('書体の読み込み')
})

test('paneTree のボタンは押すと prev・next・open の処理を呼ぶ', () => {
  const calls: string[] = []
  const tree = paneTree(comps, MODEL({ page: 1 }), { prev: () => calls.push('prev'), next: () => calls.push('next'), open: () => calls.push('open'), sample: noop })
  for (const key of ['pdf:prev', 'pdf:next', 'pdf:open']) walk(tree).find((n) => n.props?.key === key).props.onPress()
  expect(calls).toEqual(['prev', 'next', 'open'])
})
