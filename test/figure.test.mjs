// @ts-check
// 図の入口（figure.mjs）の試験。chart の kind と option・svg・image を、決めた箱に描く Op にする。文書と資料が同じ入口を使う。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { figureAlt, figureOps, planFigure, svgAspect, trimmer } from '../hooks/engine/figure.mjs'
import { drawLook, LOOKS } from '../hooks/engine/looks/index.mjs'
import { inspectLayout, inspectSvg, opsBounds } from '../hooks/engine/inspect.mjs'
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

// ---------------------------------------------------------------- 自動の直し（検査して、並べるだけの形は項目を落とす）

const deck = makeTheme({ kind: 'deck', theme: 'vivid' })
const deckMono = makeTheme({ kind: 'deck', theme: 'mono' })
const names = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `項目 ${i + 1}`)
/** 図の Op を w × h の頁に置いたと見た、検査の結果 @param {any} r @param {number} w @param {number} h */
const problemsOf = (r, w, h) => inspectLayout({ page: { width: w, height: h }, pages: [{ ops: r.ops }] }, { metrics })[0]
const countOf = (/** @type {{ overlaps: unknown[], outside: unknown[], truncated: unknown[] }} */ p) => p.overlaps.length + p.outside.length + p.truncated.length
/** 左上に置いて、箱 w × h に描く */
const inBox = (/** @type {any} */ block, /** @type {number} */ w, /** @type {number} */ h, /** @type {Record<string, any>} */ o = {}) =>
  figureOps(block, { x: 0, y: 0, width: w, height: h, metrics, theme: deck, ...o })

test('並べるだけの形は、字が収まらない時に後ろの項目を落として描き直し、問題が 0 になり、図の注に「上位 n / N」を書く', () => {
  const data = LOOKS.tiles.sample()
  const full = drawLook('tiles', data, { width: 300, height: 200, pal: deck.colors, textMin: 9 })
  assert.ok(countOf(inspectSvg(full.svg, { width: 300, height: full.height, metrics })) > 0, '前提: 全部を描くと収まらない')
  const before = structuredClone(data)
  const r = inBox({ type: 'chart', kind: 'tiles', data }, 300, 200)
  assert.ok(r.trim && r.trim.kept < r.trim.total && r.trim.total === data.items.length, JSON.stringify(r.trim))
  assert.equal(countOf(problemsOf(r, 300, 200)), 0)
  assert.ok(words(r.ops).includes(`上位 ${r.trim.kept} / ${r.trim.total}`), words(r.ops))
  assert.ok(r.warnings.some((w) => w.includes(`${r.trim?.kept} / ${r.trim?.total}`)), r.warnings.join('|'))
  assert.equal(r.height, 200, '箱の高さは変わらない（注の帯は箱の中）')
  assert.deepEqual(data, before, '元の data は書き換えない')
})

test('注は箱の下に右寄せで、資料は 7.5pt 以上・文書は 7pt 以上の字', () => {
  const block = { type: 'chart', kind: 'bullet', data: LOOKS.bullet.sample() }
  const r = inBox(block, 300, 120)
  assert.ok(r.trim)
  const note = flat(r.ops).filter((o) => o.t === 'text').find((o) => textOf(o).startsWith('上位'))
  assert.ok(note, '注の字がある')
  assert.ok(note.size >= 7.5, `資料は 7.5pt 以上: ${note.size}`)
  assert.ok(note.y > 120 - 14 && note.y <= 120, `箱の下: ${note.y}`)
  assert.ok(Math.max(...note.glyphs.map((g) => g.x)) > 300 - 60, '右寄せ')
  const paper = figureOps(block, { x: 0, y: 0, width: 300, height: 120, metrics, theme: mono })
  const pn = flat(paper.ops).filter((o) => o.t === 'text').find((o) => textOf(o).startsWith('上位'))
  if (pn) assert.ok(pn.size >= 7, `文書でも 7pt 以上: ${pn.size}`)
})

test('series の形（sparks・bump）は後ろの系列を落とす', () => {
  const sparks = { x: ['a', 'b', 'c', 'd'], series: names(12).map((name, i) => ({ name, values: [1, 3, 2, 4 + i] })) }
  const r = inBox({ type: 'chart', kind: 'sparks', data: sparks }, 240, 90)
  assert.ok(r.trim && r.trim.label === '上位' && r.trim.kept < 12, JSON.stringify(r.trim))
  assert.equal(countOf(problemsOf(r, 240, 90)), 0)
  assert.equal(sparks.series.length, 12)
})

test('trimmer: items の形は後ろの項目を、bars の x の形は後ろの x と各系列の値を落とす（「先頭 n / N」）。元は書き換えない', () => {
  const items = { items: names(6).map((name, i) => ({ name, value: i })), unit: '%' }
  const a = /** @type {any} */ (trimmer(items, 'lollipop'))
  assert.equal(a.total, 6)
  assert.equal(a.label, '上位')
  assert.deepEqual(a.cut(4).items.map((/** @type {any} */ it) => it.name), ['項目 1', '項目 2', '項目 3', '項目 4'])
  assert.equal(a.cut(4).unit, '%')
  assert.equal(items.items.length, 6)
  const bars = { x: ['1月', '2月', '3月', '4月'], series: [{ name: 'a', values: [1, 2, 3, 4] }, { name: 'b', values: [4, 3, 2, 1] }] }
  const b = /** @type {any} */ (trimmer(bars, 'bars'))
  assert.equal(b.label, '先頭')
  assert.deepEqual(b.cut(2), { x: ['1月', '2月'], series: [{ name: 'a', values: [1, 2] }, { name: 'b', values: [4, 3] }] })
  assert.equal(bars.series[0].values.length, 4)
  assert.equal(/** @type {any} */ (trimmer({ items: names(3).map((name) => ({ name, value: 1 })) }, 'bars')).label, '上位', 'bars でも items があれば items を落とす')
})

test('合計や割合が変わる形（donut・waterfall・treemap・sankey・pnl・waffle）は、収まらなくても落とさない', () => {
  for (const kind of ['donut', 'waterfall', 'treemap', 'sankey', 'pnl', 'waffle']) {
    const data = LOOKS[kind].sample()
    assert.equal(trimmer(data, kind), null, kind)
    const r = inBox({ type: 'chart', kind, data }, 160, 70)
    assert.equal(r.trim, undefined, kind)
    assert.ok(!words(r.ops).includes('上位'), kind)
  }
})

test('問題の無い図は減らさない（箱が十分なら全部の項目を描き、注も付けない）', () => {
  const r = inBox({ type: 'chart', kind: 'tiles', data: LOOKS.tiles.sample() }, 520, 260)
  assert.equal(r.trim, undefined)
  assert.ok(!words(r.ops).includes('上位'))
  assert.equal(countOf(problemsOf(r, 520, 260)), 0)
})

test('落としても問題が 0 にならない図は、全部の項目を描く（半分まで削って直らない物は減らさない）', () => {
  const data = { items: names(12).map((name, i) => ({ name: `${name} の名前がとても長い`, from: i, to: 20 - i })), fromLabel: '前', toLabel: '後' }
  const r = inBox({ type: 'chart', kind: 'slope', data }, 240, 90)
  assert.equal(r.trim, undefined)
})

test('metrics が無い時は検査も中央寄せもせず、今までどおり描く', () => {
  const r = figureOps({ type: 'chart', kind: 'tiles', data: LOOKS.tiles.sample() }, { x: 0, y: 0, width: 300, height: 200, theme: deck })
  assert.equal(r.trim, undefined)
  assert.equal(r.height, 200)
})

test('資料の図の字は 7.5pt 以上（拡大しない箱でも拡大した箱でも）。文書の図も 7pt を割らない', () => {
  for (const kind of ['multi-line', 'lollipop', 'donut', 'bullet', 'funnel', 'treemap', 'flowchart']) {
    for (const zoom of [undefined, 1.35]) {
      const r = inBox({ type: 'chart', kind, data: LOOKS[kind].sample() }, 520, 300, { zoom })
      const sizes = flat(r.ops).filter((o) => o.t === 'text').map((o) => o.size)
      assert.ok(sizes.length > 0, kind)
      assert.ok(Math.min(...sizes) >= 7.5 - 1e-6, `${kind} zoom ${zoom}: ${Math.min(...sizes)}pt`)
    }
  }
  const doc = figureOps({ type: 'chart', kind: 'multi-line', data: LOOKS['multi-line'].sample() }, { x: 0, y: 0, width: 400, metrics, theme: mono })
  assert.ok(Math.min(...flat(doc.ops).filter((o) => o.t === 'text').map((o) => o.size)) >= 7 - 1e-6, '文書の図も 7pt を割らない')
})

test('図の色は lookPal から: 色のテーマ（vivid）の資料は系列を色で分け、mono と既定の paper の資料は墨だけ（paper は accent・up・down を足せる）', () => {
  const chroma = (/** @type {string} */ c) => { const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); return Math.max(...v) - Math.min(...v) }
  // bump は系列を色で分ける形（multi-line は 908190b から目立たせる 1 本だけが accent で、ほかは墨）
  const colorsOf = (/** @type {any} */ theme, kind = 'bump') => new Set(flat(inBox({ type: 'chart', kind, data: LOOKS[kind].sample() }, 520, 300, { theme }).ops).flatMap((o) => [o.stroke, o.fill]).filter((c) => typeof c === 'string' && c.startsWith('#') && chroma(c) > 40).map((c) => c.toLowerCase()))
  assert.ok(colorsOf(deck).size >= 2, [...colorsOf(deck)].join(' '))
  assert.equal(colorsOf(deckMono).size, 0, [...colorsOf(deckMono)].join(' '))
  // 既定（paper）は series を持たない: 色みのある色は accent・up・down だけ（系列の色は 1 つも無い）
  const deckPaper = makeTheme({ kind: 'deck' })
  assert.equal(deckPaper.name, 'paper', '前提: 資料の既定は paper')
  const allowed = new Set([deckPaper.colors.accent, deckPaper.colors.up, deckPaper.colors.down].map((c) => c.toLowerCase()))
  for (const kind of ['bump', 'multi-line', 'donut', 'stacked-area']) {
    const extra = [...colorsOf(deckPaper, kind)].filter((c) => !allowed.has(c))
    assert.deepEqual(extra, [], `${kind}（paper）に系列の色 ${extra.join(' ')}`)
  }
  // multi-line は色のテーマでも目立たせる 1 本（accent）だけに色が付く
  assert.deepEqual([...colorsOf(deck, 'multi-line')], [deck.colors.accent.toLowerCase()])
})

test('箱が高く、描いた物の高さが箱の 50% に満たない図は、箱の縦の中央に置く。50% 以上の図と、箱を渡さない図は動かさない', () => {
  const block = { type: 'chart', kind: 'kpi-hero', data: LOOKS['kpi-hero'].sample() }
  const centered = (/** @type {number} */ h) => {
    const plan = planFigure(block, { width: 520, height: h, metrics, theme: deck })
    const b = /** @type {any} */ (opsBounds(plan.draw(0, 100).ops, metrics))
    return { plan, top: b.y0 - 100, bottom: b.y1 - 100 }
  }
  const tall = centered(700)
  assert.equal(tall.plan.height, 700, '返す高さは箱のまま（頁の組みは動かない）')
  assert.ok(Math.abs((tall.top + tall.bottom) / 2 - 350) <= 2, `中央: ${tall.top}〜${tall.bottom}`)
  const fit = centered(420)
  assert.ok(fit.bottom - fit.top >= 0.5 * 420 && fit.top < 20, `半分以上は動かさない: ${fit.top}〜${fit.bottom}`)
  const natural = planFigure(block, { width: 520, metrics, theme: deck })
  const nb = /** @type {any} */ (opsBounds(natural.draw(0, 0).ops, metrics))
  assert.ok(nb.y0 < 20 && nb.y1 <= natural.height + 1, '箱を渡さなければ自然な高さのまま')
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
