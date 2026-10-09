// @ts-check
// 図の入口（figure.mjs）の試験。chart の kind と option・svg・image を、決めた箱に描く Op にする。文書と資料が同じ入口を使う。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { figureAlt, figureOps, planFigure, svgAspect } from '../hooks/engine/figure.mjs'
import { drawLook } from '../hooks/engine/looks/index.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { compose } from '../hooks/engine/index.mjs'
import { flat, metrics, textOf } from './looks-kit.mjs'

const mono = makeTheme({ theme: 'mono' })
const mergeble = makeTheme({ theme: 'mergeble' })
const W = 400
const DONUT = { items: [{ name: '開発', value: 6 }, { name: '営業', value: 4 }], unit: '円' }
const OPTION = { xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3, 5] }] }
const SVG = '<svg viewBox="0 0 200 50" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="50" fill="#333"/></svg>'
const IMG = { width: 200, height: 100, base64: 'AAAA', kind: 'png' }

/** @param {any} block @param {Record<string, any>} [o] */
const fig = (block, o = {}) => figureOps(block, { x: 10, y: 20, width: W, metrics, theme: mono, ...o })
/** 描いた Op の中の字 @param {any[]} ops */
const words = (ops) => flat(ops).filter((o) => o.t === 'text').map(textOf).join(' ')

// ---------------------------------------------------------------- svgAspect・figureAlt

test('svgAspect: viewBox の高さ ÷ 幅を返し、viewBox が無ければ width と height から出す', () => {
  assert.equal(svgAspect(SVG), 0.25)
  assert.equal(svgAspect('<svg width="300" height="150px"></svg>'), 0.5)
  assert.equal(svgAspect('<svg viewBox="0,0,10,40"></svg>'), 4)
})

test('svgAspect: 読めない・0 以下の寸法は null', () => {
  assert.equal(svgAspect('<svg></svg>'), null)
  assert.equal(svgAspect('<svg viewBox="0 0 0 10"></svg>'), null)
  assert.equal(svgAspect('<svg width="50%" height="30%"></svg>'), null)
  assert.equal(svgAspect('文字だけ'), null)
})

test('figureAlt: chart は alt・caption・look の名前・「グラフ」の順で使う', () => {
  assert.equal(figureAlt({ type: 'chart', alt: '売上', caption: 'c', kind: 'donut' }), '売上')
  assert.equal(figureAlt({ type: 'chart', caption: '内訳', kind: 'donut' }), '内訳')
  assert.equal(figureAlt({ type: 'chart', kind: 'donut' }), 'ドーナツ（Donut）')
  assert.equal(figureAlt({ type: 'chart', option: OPTION }), 'グラフ')
  assert.equal(figureAlt({ type: 'chart', kind: 'no-such-look' }), 'グラフ')
})

test('figureAlt: svg と image は alt があればそれ、無ければ「図」', () => {
  assert.equal(figureAlt({ type: 'svg', alt: '構成', source: SVG }), '構成')
  assert.equal(figureAlt({ type: 'image', path: 'a.png' }), '図')
  assert.equal(figureAlt(null), '図')
})

// ---------------------------------------------------------------- chart: kind

test('chart の kind: look を drawLook の高さで描き、字は箱の中に置く', () => {
  const natural = drawLook('donut', DONUT, { width: W, pal: mono.colors })
  const r = fig({ type: 'chart', kind: 'donut', data: DONUT })
  assert.equal(r.height, natural.height)
  assert.deepEqual(r.warnings, [])
  assert.match(words(r.ops), /開発/)
  for (const o of flat(r.ops)) {
    if (o.t !== 'text') continue
    for (const g of o.glyphs) assert.ok(g.x >= 10 - 1 && g.x <= 10 + W + 1, `x=${g.x}`)
    assert.ok(o.y >= 20 - 1 && o.y <= 20 + r.height + 1, `y=${o.y}`)
  }
})

test('chart の kind: height を渡せばその高さの箱に収める', () => {
  const r = fig({ type: 'chart', kind: 'donut', data: DONUT }, { height: 150 })
  assert.equal(r.height, 150)
  const blockH = fig({ type: 'chart', kind: 'donut', data: DONUT, height: 120 })
  assert.equal(blockH.height, 120)
})

test('chart の kind: 置く場所を替えても、Op は同じ形のまま動く', () => {
  const plan = planFigure({ type: 'chart', kind: 'donut', data: DONUT }, { width: W, metrics, theme: mono })
  const a = plan.draw(0, 0).ops.filter((o) => o.t === 'text')
  const b = plan.draw(50, 70).ops.filter((o) => o.t === 'text')
  assert.equal(a.length, b.length)
  assert.ok(a.length > 0)
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(b[i].glyphs[0].x - a[i].glyphs[0].x - 50) < 0.02, 'x')
    assert.ok(Math.abs(b[i].y - a[i].y - 70) < 0.02, 'y')
  }
})

test('chart の kind: 高さは描かずに分かり、draw を呼ぶまで Op を作らない', () => {
  const plan = planFigure({ type: 'chart', kind: 'donut', data: DONUT }, { width: W, metrics, theme: mono })
  assert.ok(plan.height > 0)
  assert.equal(typeof plan.draw, 'function')
  assert.ok(plan.draw(0, 0).ops.length > 0)
})

test('chart の kind: 紙の色（theme.colors）を look に渡すので、紙が違えば色が変わる', () => {
  const fills = (/** @type {any} */ theme) => JSON.stringify(flat(fig({ type: 'chart', kind: 'donut', data: DONUT }, { theme }).ops).map((o) => o.fill ?? o.color ?? null))
  assert.notEqual(fills(mono), fills(mergeble))
})

test('chart の kind の zoom: 箱の幅はそのまま、字が zoom 倍に大きくなり、箱からはみ出さない。1 以下や数でない値は無視する', () => {
  const block = { type: 'chart', kind: 'donut', data: DONUT }
  const size = (/** @type {any} */ r) => Math.min(...flat(r.ops).filter((o) => o.t === 'text').map((o) => o.size))
  const x1 = fig(block)
  const x2 = fig(block, { zoom: 1.5 })
  assert.ok(x2.height > 0)
  assert.ok(Math.abs(size(x2) / size(x1) - 1.5) < 0.05, `${size(x1)} → ${size(x2)}`)
  for (const op of flat(x2.ops)) {
    if (op.t !== 'text') continue
    const xs = op.glyphs.map((g) => g.x)
    assert.ok(Math.min(...xs) >= 10 - 0.5 && Math.max(...xs) <= 10 + W + 0.5, 'x が箱の中')
    assert.ok(op.y <= 20 + x2.height + 0.5, 'y が箱の中')
  }
  for (const z of [1, 0.5, 0, -2, NaN, undefined, /** @type {any} */ ('2')]) assert.deepEqual(fig(block, { zoom: z }).ops, x1.ops, String(z))
  const boxed = fig(block, { zoom: 1.5, height: 200 })
  assert.ok(boxed.height <= 200 + 0.5, `高さを渡せば zoom しても箱に収まる: ${boxed.height}`)
  assert.deepEqual(fig({ type: 'svg', source: SVG }, { zoom: 2 }).ops, fig({ type: 'svg', source: SVG }).ops, 'look 以外には効かない')
})

test('chart の kind の zoom: 拡大して字が切れる（…）・折り返す横長の図は、拡大を弱めるか止める。事業計画の流れ図は 1 行のまま全部読める', () => {
  const FLOW = {
    nodes: [{ id: 'app', name: 'ソラミド' }, { id: 'agent', name: 'ビル管理会社' }, { id: 'owner', name: 'ビルのオーナー' }, { id: 'hvac', name: '既存の空調' }, { id: 'power', name: '電力会社' }],
    links: [{ from: 'agent', to: 'owner', label: '紹介' }, { from: 'owner', to: 'app', label: '月額利用料' }, { from: 'app', to: 'hvac', label: '設定を最適化' }, { from: 'hvac', to: 'power', label: '使う電気が減る' }],
  }
  const block = { type: 'chart', kind: 'flowchart', data: FLOW }
  const natural = fig(block, { width: 746 })
  const zoomed = fig(block, { width: 746, zoom: 1.35 })
  assert.ok(!words(natural.ops).includes('…'), '拡大しない図は切れない（前提）')
  assert.ok(!words(zoomed.ops).includes('…'), words(zoomed.ops))
  assert.ok(words(zoomed.ops).includes('ビルのオーナー') || words(zoomed.ops).replaceAll(' ', '').includes('ビルのオーナー'), words(zoomed.ops))
  const lines = (/** @type {any} */ r) => flat(r.ops).filter((o) => o.t === 'text').length
  assert.ok(lines(zoomed) <= lines(natural), `字の行が増えない: ${lines(natural)} → ${lines(zoomed)}`)
})

test('chart の kind の zoom: どの形でも、拡大した図は拡大しない図より「…」と字の行を増やさない（見本の data・幅 746pt・zoom 1.35）', async () => {
  const { LOOK_LIST } = await import('../hooks/engine/looks/index.mjs')
  const strain = (/** @type {any} */ r) => flat(r.ops).filter((o) => o.t === 'text').length + (words(r.ops).match(/…/g) ?? []).length
  let zoomedCount = 0
  for (const look of LOOK_LIST) {
    const block = { type: 'chart', kind: look.id, data: look.sample() }
    const natural = fig(block, { width: 746 })
    const zoomed = fig(block, { width: 746, zoom: 1.35 })
    assert.ok(strain(zoomed) <= strain(natural), `${look.id}: ${strain(natural)} → ${strain(zoomed)}`)
    if (zoomed.height > natural.height * 1.01) zoomedCount++
  }
  assert.ok(zoomedCount >= 20, `拡大が効く形も多い（全部を止めていない）: ${zoomedCount} 形`)
})

test('chart の kind: kind と option が両方あれば kind を使い、option は読まない', () => {
  const only = fig({ type: 'chart', kind: 'donut', data: DONUT })
  const both = fig({ type: 'chart', kind: 'donut', data: DONUT, option: OPTION })
  assert.deepEqual(both.ops, only.ops)
})

test('chart の kind: 知らない kind は投げず、使える種類を warnings に書いて空の図にする', () => {
  const r = fig({ type: 'chart', kind: 'no-such-look', data: DONUT })
  assert.ok(r.warnings.some((w) => w.includes('no-such-look') && w.includes('使える種類')))
  assert.ok(r.height > 0)
  assert.equal(words(r.ops), '')
})

test('chart の kind: data が無ければ投げず、描けない理由を warnings に書く', () => {
  const none = fig({ type: 'chart', kind: 'donut' })
  assert.ok(none.warnings.some((w) => w.includes('data が無い')))
  const ds = fig({ type: 'chart', kind: 'donut', dataset: 'zz' })
  assert.ok(ds.warnings.some((w) => w.includes('zz')))
})

test('chart の kind: 同じ入力から同じ Op になる', () => {
  const a = fig({ type: 'chart', kind: 'donut', data: DONUT })
  const b = fig({ type: 'chart', kind: 'donut', data: DONUT })
  assert.deepEqual(a, b)
})

// ---------------------------------------------------------------- chart: option・svg・image

test('chart の option: 高さを渡さなければ幅の半分で、ECharts の絵を 1 つの ClipOp にする', () => {
  const r = fig({ type: 'chart', option: OPTION })
  assert.equal(r.height, W / 2)
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].t, 'clip')
  assert.ok(flat(r.ops).length > 5)
})

test('chart の option: block の height と呼び出しの height を使う（呼び出しが先）', () => {
  assert.equal(fig({ type: 'chart', option: OPTION, height: 100 }).height, 100)
  assert.equal(fig({ type: 'chart', option: OPTION, height: 100 }, { height: 160 }).height, 160)
})

test('svg: 高さは viewBox の比から出し、小さすぎる比は 24 に止める', () => {
  assert.equal(fig({ type: 'svg', source: SVG, alt: 'a' }).height, W * 0.25)
  assert.equal(fig({ type: 'svg', source: '<svg viewBox="0 0 1000 10"></svg>', alt: 'a' }).height, 24)
  assert.equal(fig({ type: 'svg', source: '<svg></svg>', alt: 'a' }).height, W / 2)
  assert.equal(fig({ type: 'svg', source: SVG, alt: 'a' }, { height: 77 }).height, 77)
})

test('svg: viewBox 全体の四角は、箱の左上 (x, y) から幅と高さいっぱいに置かれる', () => {
  const r = fig({ type: 'svg', source: SVG, alt: 'a' })
  assert.deepEqual(r.ops, [{ t: 'path', d: 'M 10 20 L 410 20 L 410 120 L 10 120 Z', fill: '#333333' }])
})

test('image: 読み込めた画像は縦横比を保って箱の幅に収め、左右の中央に置く', () => {
  const r = fig({ type: 'image', path: 'p.png', alt: 'a', width: 200 }, { images: { 'p.png': IMG } })
  assert.equal(r.ops.length, 1)
  assert.deepEqual([r.ops[0].w, r.ops[0].h, r.height], [200, 100, 100])
  assert.equal(r.ops[0].x, 10 + (W - 200) / 2)
  assert.equal(r.ops[0].y, 20)
})

test('image: 箱の高さより高ければ、縦横比を保ったまま高さに合わせて小さくする', () => {
  const r = fig({ type: 'image', path: 'p.png', alt: 'a' }, { images: { 'p.png': IMG }, height: 60 })
  assert.deepEqual([r.ops[0].w, r.ops[0].h, r.height], [120, 60, 60])
})

test('image: 箱より広い width を渡しても箱の幅までにする', () => {
  const r = fig({ type: 'image', path: 'p.png', alt: 'a', width: 5000 }, { images: { 'p.png': IMG } })
  assert.equal(r.ops[0].w, W)
})

test('image: 読み込めなければ灰色の四角にして warnings に書く', () => {
  const r = fig({ type: 'image', path: 'missing.png', alt: 'a' }, { images: {} })
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].t, 'rect')
  assert.equal(r.ops[0].fill, mono.colors.tint)
  assert.ok(r.warnings.some((w) => w.includes('missing.png')))
  assert.equal(r.height, W / 2)
})

test('figureOps: 描けない Block は投げず、灰色の四角か空にして warnings に書く', () => {
  const para = fig({ type: 'para', text: [] })
  assert.equal(para.ops[0].t, 'rect')
  assert.ok(para.warnings.some((w) => w.includes('描けない')))
  const nul = fig(null)
  assert.deepEqual(nul.ops, [])
  assert.ok(nul.warnings.length > 0)
})

test('figureOps: alt を一緒に返し、warnings は計画と描画の分をつなぐ', () => {
  const r = fig({ type: 'chart', kind: 'donut', data: DONUT, alt: '内訳' })
  assert.equal(r.alt, '内訳')
  const plan = planFigure({ type: 'image', path: 'x.png', alt: 'y' }, { width: W, metrics, theme: mono, images: {} })
  assert.equal(plan.warnings.length, 1)
})

// ---------------------------------------------------------------- 文書の中の図

/** @param {any} block */
const docWords = (block) => {
  const { layout } = compose({ title: '図の試験', kind: 'doc', blocks: [block] }, { metrics })
  return { layout, text: layout.pages.map((/** @type {any} */ p) => words(p.ops)).join(' ') }
}

test('文書の chart: kind と data の図が頁に描かれ、option の図は今までどおり描かれる', () => {
  const look = docWords({ type: 'chart', kind: 'donut', data: DONUT, alt: '内訳' })
  assert.match(look.text, /開発/)
  const opt = docWords({ type: 'chart', option: OPTION })
  assert.equal(opt.layout.pages.length, 1)
})

test('文書の chart: 知らない kind は warnings に書いて組版を続ける', () => {
  const { warnings } = compose({ title: 't', blocks: [{ type: 'chart', kind: 'no-such-look', data: DONUT }, { type: 'para', text: '続き' }] }, { metrics })
  assert.ok(warnings.some((w) => w.includes('no-such-look')))
})

test('文書の chart: dataset を引いた図の出典が頁の説明に出る', () => {
  const { layout } = compose({
    title: 't',
    datasets: { d: { data: DONUT, source: '官報', asOf: '2026-09' } },
    blocks: [{ type: 'chart', kind: 'donut', dataset: 'd' }],
  }, { metrics })
  assert.match(layout.pages.map((/** @type {any} */ p) => words(p.ops)).join(' '), /出典: 官報/)
})
