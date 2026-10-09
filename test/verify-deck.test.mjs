// @ts-check
// scripts/verify-pdf.mjs の資料（deck）対応: 1 枚 = 1 頁・枚のブロックの数・しおり・往復照合を、本物の書体で組んだ資料の PDF で確かめる。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyPdf, expectedText } from '../scripts/verify-pdf.mjs'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { compose, FONT_IDS } from '../hooks/engine/index.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { renderPdf } from '../hooks/render/pdf.mjs'
import { phraseBoundaries } from '../hooks/vendor/text.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts/fonts.json'), 'utf8'))
const fontBytes = await loadFontBytes(FONT_IDS, manifest, async (rel) => fs.readFileSync(path.join(ROOT, 'fonts', rel)).toString('base64'))
const metrics = makeMetrics(fontBytes)
const NOW = Date.UTC(2026, 9, 9)

const DECK = {
  title: '資料の検査（試験）',
  author: '試験者',
  lang: 'ja',
  kind: 'deck',
  slides: [
    { layout: 'cover', title: '**現場**の判断を三倍速く', lead: '建設・製造の現場データを、その日のうちに意思決定へ', by: '株式会社ミライ工房' },
    { layout: 'section', title: '市場と課題' },
    { layout: 'content', title: '承認は紙とメールで止まる', blocks: [{ type: 'para', text: '承認の流れが人に依存しており、{不在|ふざい}や出張で案件が数日止まる。' }, { type: 'list', items: ['待ち時間は平均 2.4 日', '差し戻しの 63% は資料の不足'] }] },
    { layout: 'kpi', title: '導入先は 1 年で 4 倍', items: [{ label: '導入企業数', value: '41', unit: '社', delta: '+310%' }, { label: '解約率', value: '0.4', unit: '%', delta: '-0.3pt' }] },
    { layout: 'closing', title: 'まず 1 現場で試してください', items: ['現場を 1 か所選ぶ', '2 週間の試用を始める'] },
  ],
}

/** @param {any} input */
async function pdfOf(input) {
  const { layout } = compose(input, { metrics, images: {}, phrase: phraseBoundaries, now: NOW })
  const r = await renderPdf(layout, { fontBytes })
  return Uint8Array.from(Buffer.from(r.text, 'latin1'))
}

test('資料の PDF は検査が 1 つも落ちず、「1 枚 = 1 頁」「構造」「しおり」「往復照合」が数えられる', async () => {
  const res = await verifyPdf(await pdfOf(DECK), DECK)
  assert.deepEqual(res.results.filter((x) => x.ok === false), [])
  assert.ok(res.pass >= 10, `通りは ${res.pass} 個`)
  const one = res.results.find((x) => x.text.includes('1 枚 = 1 頁'))
  assert.ok(one && one.ok === true && one.text.includes(`${DECK.slides.length} 枚`), one?.text)
  assert.ok(res.results.some((x) => x.ok === true && x.text.includes('入力の字が全部 PDF にある')), '往復照合が通る')
})

test('枚の数と頁の数が違う PDF は「1 枚 = 1 頁」で落ちる（枚を足した原稿に古い PDF を当てる）', async () => {
  const bytes = await pdfOf(DECK)
  const more = { ...DECK, slides: [...DECK.slides, { layout: 'statement', title: '追加した一枚' }] }
  const res = await verifyPdf(bytes, more)
  const bad = res.results.find((x) => x.ok === false && x.text.includes('頁の数'))
  assert.ok(bad, res.results.filter((x) => x.ok === false).map((x) => x.text).join('\n'))
  assert.ok(res.results.some((x) => x.ok === false && x.text.includes('PDF に足りない') && x.text.includes('追')), '往復照合も足りない字を挙げる')
})

test('別の資料の PDF を当てると、往復照合が足りない字の名前を挙げて落ちる', async () => {
  const other = { ...DECK, slides: DECK.slides.map((s, i) => (i === 2 ? { ...s, title: '全く別の題の枚' } : s)) }
  const res = await verifyPdf(await pdfOf(other), DECK)
  assert.ok(res.fail >= 1)
  assert.ok(res.results.some((x) => x.ok === false && x.text.includes('PDF に足りない') && x.text.includes('承')), res.results.map((x) => x.text).join('\n'))
})

test('expectedText（資料）: 題・本文・項目の字を枚の順に集め、** と {親字|るび} の印は外して親字とルビの読みにする', () => {
  const { doc } = normalize(DECK)
  const t = expectedText(doc)
  for (const s of ['現場の判断を三倍速く', '市場と課題', '不在', 'ふざい', '待ち時間は平均 2.4 日', '導入企業数', '41', '+310%', '2 週間の試用を始める']) assert.ok(t.replaceAll(' ', '').includes(s.replaceAll(' ', '')), s)
  assert.ok(!/[*{}]/.test(t), t)
  assert.ok(t.indexOf('市場と課題') < t.indexOf('承認は紙とメールで止まる'), '枚の順')
})
