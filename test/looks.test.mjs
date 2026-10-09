// @ts-check
// 図の形（looks）の試験: 共通の部品（paper）・入口（index の drawLook と上限）・手本の 2 つ（candle・sankey）。
// 形ごとの共通の確かめは test/looks-kit.mjs の testLook。形に固有の振る舞いはこのファイル（形が増えたら test/looks-<種類>.test.mjs に分ける）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTheme } from '../hooks/engine/theme.mjs'
import { drawLook, drawWith, capData, LOOKS, LOOK_LIST, CATEGORIES } from '../hooks/engine/looks/index.mjs'
import * as P from '../hooks/engine/looks/paper.mjs'
import candle from '../hooks/engine/looks/candle.mjs'
import sankey from '../hooks/engine/looks/sankey.mjs'
import { testLook, toOps, flat, textOf, metrics, PALS, MEASURE, CATEGORY_OF } from './looks-kit.mjs'

const MONO = PALS.mono
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)

// ---------------------------------------------------------------- 全部の形に共通の確かめ

for (const look of LOOK_LIST) testLook(look.id)

// ---------------------------------------------------------------- 入口

test('LOOKS は束の形の全部を id で引け、id は重ならず、種類は決まった 7 つのどれか', () => {
  assert.equal(Object.keys(LOOKS).length, LOOK_LIST.length)
  assert.deepEqual(LOOK_LIST.map((l) => l.id).filter((id, i, a) => a.indexOf(id) !== i), [])
  for (const l of LOOK_LIST) assert.ok(CATEGORIES.includes(l.category), l.id)
  assert.ok(LOOKS.candle && LOOKS.sankey)
})

test('移す形の表（docs/looks.md の 4 章）は 43 で、種類は決まった 7 つのどれか', () => {
  assert.equal(Object.keys(CATEGORY_OF).length, 43)
  for (const [id, cat] of Object.entries(CATEGORY_OF)) assert.ok(CATEGORIES.includes(/** @type {any} */ (cat)), id)
})

test('知らない id・id でない物は、投げずに空の svg と使える種類の一覧を返す', () => {
  for (const id of ['nope', '', undefined, null, 5, {}, '__proto__', 'constructor']) {
    const r = drawLook(/** @type {any} */ (id), { x: [] }, { width: 300 })
    assert.match(r.svg, /^<svg [^>]*viewBox="0 0 300 180"[^>]*><\/svg>$/)
    assert.equal(r.warnings.length, 1)
    assert.match(r.warnings[0], /知らない図の種類/)
    // 形が増えると並びが変わるので、一覧に入っていることだけを見る
    for (const known of ['candle', 'sankey']) assert.ok(r.warnings[0].includes(known), r.warnings[0])
  }
})

test('幅・高さ・pal・lang のおかしい値は範囲か既定に直し、svg の viewBox は返した大きさと同じ', () => {
  const cases = /** @type {any[]} */ ([
    [{}, 480],
    [{ width: NaN }, 480],
    [{ width: 50 }, 100],
    [{ width: 99999 }, 1600],
    [{ width: '320' }, 320],
    [null, 480],
  ])
  for (const [opts, w] of cases) {
    const r = drawLook('candle', candle.sample(), opts)
    assert.equal(r.width, w)
    assert.match(r.svg, new RegExp(`viewBox="0 0 ${w} ${r.height}"`))
  }
  assert.equal(drawLook('candle', candle.sample(), { width: 300, height: 5 }).height, 40)
  assert.equal(drawLook('candle', candle.sample(), { width: 300, height: 99999 }).height, 1600)
  // pal の字は SVG の属性に入る。属性を壊す字は mono の色に直す
  const evil = drawLook('candle', candle.sample(), { width: 300, pal: { ink: '"/><script>', up: 'red' } })
  assert.ok(!evil.svg.includes('<script'))
  assert.ok(evil.svg.includes(MONO.ink) && evil.svg.includes(MONO.up))
  assert.deepEqual(toOps(evil, MONO).warnings, [])
})

test('形が投げても drawWith は投げず、その形の名前つきの warnings と空の svg を返す', () => {
  /** @type {any} */
  const boom = { ...candle, id: 'boom', title: 'こわれる形', draw: () => { throw new Error('ここで落ちた') } }
  const r = drawWith(boom, candle.sample(), { width: 300 })
  assert.match(r.svg, /^<svg [^>]*><\/svg>$/)
  assert.deepEqual(r.warnings, ['図「こわれる形」を描けませんでした: ここで落ちた'])
  const notSvg = drawWith(/** @type {any} */ ({ ...candle, draw: () => 'x' }), candle.sample(), { width: 300 })
  assert.match(notSvg.warnings[0], /svg の字を返しませんでした/)
  const badHeight = drawWith(/** @type {any} */ ({ ...candle, height: () => { throw new Error('高さが出ない') } }), candle.sample(), { width: 300 })
  assert.match(badHeight.warnings[0], /高さが出ない/)
})

test('形の height が数でない値を返しても、幅の 0.6 倍の高さで描き、viewBox を壊さない', () => {
  for (const bad of [() => NaN, () => 'x', () => undefined, () => -5]) {
    const r = drawWith(/** @type {any} */ ({ ...candle, height: bad }), candle.sample(), { width: 300 })
    assert.equal(r.height, 180)
    assert.match(r.svg, /viewBox="0 0 300 180"/)
    assert.deepEqual(r.warnings, [])
  }
})

test('高さを渡さなければ形の height(width, data) を使う', () => {
  assert.equal(drawLook('candle', candle.sample(), { width: 500 }).height, Math.round(500 * 0.658))
  assert.equal(drawLook('candle', candle.sample(), { width: 500, height: 200 }).height, 200)
})

// ---------------------------------------------------------------- 上限

test('capData: 文字は 80 字・系列は 12・値は 2,000・点は 5,000・節は 200・つながりは 1,000 で切り、warnings に書く', () => {
  /** @type {string[]} */
  const w = []
  const out = /** @type {any} */ (capData({
    name: 'あ'.repeat(200),
    series: Array.from({ length: 20 }, () => ({ name: 'a', values: Array.from({ length: 2500 }, (_, i) => i) })),
    points: Array.from({ length: 5200 }, (_, i) => [i, i]),
    nodes: Array.from({ length: 250 }, (_, i) => ({ name: String(i) })),
    links: Array.from({ length: 1100 }, () => ({ source: 'a', target: 'b', value: 1 })),
  }, w))
  assert.equal(Array.from(out.name).length, 80)
  assert.ok(out.name.endsWith('…'))
  assert.equal(out.series.length, 12)
  assert.equal(out.series[0].values.length, 2000)
  assert.equal(out.points.length, 5000)
  assert.equal(out.nodes.length, 200)
  assert.equal(out.links.length, 1000)
  assert.equal(w.length, 6)
  assert.ok(w.some((m) => m.includes('系列') && m.includes('12') && m.includes('8')))
  assert.ok(w.some((m) => m.includes('5,000') && m.includes('200')))
  assert.ok(w.some((m) => m.includes('80 字')))
})

test('capData: 木（root）は 2,000 節まで・関数と記号は捨て・__proto__ は写さず・元の data は書き換えない', () => {
  /** @type {string[]} */
  const w = []
  const src = { root: { name: 'r', children: Array.from({ length: 3000 }, (_, i) => ({ name: `n${i}`, value: 1 })) }, fn: () => 1, sym: Symbol('s'), keep: 1 }
  const frozen = JSON.stringify(src)
  const out = /** @type {any} */ (capData(src, w))
  assert.equal(out.root.children.length, 1999)
  assert.equal(out.fn, undefined)
  assert.equal(out.sym, undefined)
  assert.equal(out.keep, 1)
  assert.ok(w.some((m) => m.includes('木') && m.includes('2,000')))
  assert.equal(JSON.stringify(src), frozen)
  const polluted = /** @type {any} */ (capData(JSON.parse('{"__proto__":{"x":1},"a":1}'), []))
  assert.equal(Object.getPrototypeOf(polluted), Object.prototype)
  assert.equal(polluted.x, undefined)
  assert.equal(polluted.a, 1)
})

test('capData: 自分を指す data は深さで止め、枝分かれで巨大になる data は描かずに warnings にする', () => {
  /** @type {any} */
  const loop = { a: 1 }
  loop.self = loop
  assert.doesNotThrow(() => capData(loop, []))
  /** @type {any} */
  const bomb = {}
  bomb.x = bomb
  bomb.y = bomb
  const r = drawLook('candle', bomb, { width: 300 })
  assert.ok(r.warnings.some((m) => m.includes('data が大きすぎます')), r.warnings.join('|'))
  assert.ok(r.svg.startsWith('<svg'))
})

// ---------------------------------------------------------------- paper

test('paper: MONO は theme.mjs の mono の色と同じ', () => {
  assert.deepEqual({ ...P.MONO }, { ...makeTheme({ theme: 'mono' }).colors })
})

test('paper: 字の大きさの定数は決まりの値で、7pt 未満は text が持ち上げる', () => {
  assert.deepEqual([P.TICK, P.NOTE, P.LABEL, P.VALUE, P.BIG, P.HUGE, P.MIN_PT], [7.5, 7.5, 8, 8, 14, 20, 7])
  assert.equal(P.FONT, 'Noto Sans JP')
  assert.match(P.text(1, 2, 'x', { size: 5 }), /font-size="7"/)
  assert.match(P.text(1, 2, 'x', { bold: true, anchor: 'end', fill: '#111111' }), /text-anchor="end".*font-weight="bold".*fill="#111111"/)
})

test('paper: 墨の割合の段は look の頭の文のとおり（8・10・12・14・18・22・25・35・42・55・65・80・85%）', () => {
  assert.deepEqual({ ...P.ALPHA }, {
    faint: 0.08, quiet: 0.1, grid: 0.12, track: 0.14, card: 0.18, edge: 0.22, area: 0.25,
    last: 0.35, ref: 0.35, dim: 0.42, body: 0.55, strong: 0.65, wick: 0.8, heavy: 0.85,
  })
  assert.deepEqual({ ...P.DASH }, { ref: '3 3', series: '4 3', dot: '1 2' })
  assert.equal(P.inkFill(MONO, 1), 'fill="#111111"')
  assert.equal(P.inkFill(MONO, 0.55), 'fill="#111111" fill-opacity="0.55"')
  assert.equal(P.inkStroke(MONO, 0.35, 1, P.DASH.ref), 'stroke="#111111" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 3"')
})

test('paper: 印刷で飛ぶ薄さは持ち上げる（1.5pt 以下の線は 18%・塗りと太い線は 8%・0 はそのまま）', () => {
  assert.deepEqual({ ...P.PRINT }, { line: 0.18, fill: 0.08, thin: 1.5 })
  assert.equal(P.inkStroke(MONO, P.ALPHA.grid, 1), 'stroke="#111111" stroke-opacity="0.18" stroke-width="1"')
  assert.equal(P.inkStroke(MONO, P.ALPHA.track, 1.5), 'stroke="#111111" stroke-opacity="0.18" stroke-width="1.5"')
  assert.equal(P.inkStroke(MONO, P.ALPHA.track, 3), 'stroke="#111111" stroke-opacity="0.14" stroke-width="3"')
  assert.equal(P.inkStroke(MONO, 0.02, 3), 'stroke="#111111" stroke-opacity="0.08" stroke-width="3"')
  assert.equal(P.inkFill(MONO, 0.06), 'fill="#111111" fill-opacity="0.08"')
  assert.equal(P.inkFill(MONO, 0), 'fill="#111111" fill-opacity="0"')
  assert.equal(P.seam(MONO), 'stroke="#FFFFFF" stroke-width="1"')
})

test('paper: 目立たせる 1 つは、色のある紙では accent を look の濃さで・mono の線は墨 100%・mono の面は 1 段濃く 80% まで', () => {
  assert.equal(P.isMono(PALS.mono), true)
  assert.equal(P.isMono(PALS.koma), false)
  assert.deepEqual(P.hot(PALS.koma, 0.55), { color: PALS.koma.accent, a: 0.55 })
  assert.deepEqual(P.hot(PALS.mono, 0.55), { color: MONO.ink, a: 1 })
  assert.deepEqual(P.hot(PALS.mono, 0.55, 0.7), { color: MONO.ink, a: 0.7 })
  assert.match(P.hotStroke(PALS.mergeble, 0.55, 2), new RegExp(`stroke="${PALS.mergeble.accent}" stroke-opacity="0.55" stroke-width="2"`))
  assert.equal(P.hotStroke(PALS.mono, 0.55, 1), 'stroke="#111111" stroke-width="1"')
  assert.deepEqual([0.08, 0.25, 0.55, 0.9].map(P.monoArea), [0.33, 0.5, 0.8, 0.8])
  assert.equal(P.hotFill(PALS.mono, 0.55), 'fill="#111111" fill-opacity="0.8"')
  assert.equal(P.hotFill(PALS.mono, 0.55, 1), 'fill="#111111"')
  assert.equal(P.hotFill(PALS.koma, 0.55), `fill="${PALS.koma.accent}" fill-opacity="0.55"`)
  assert.equal(P.trendColor(MONO, 0), MONO.up)
  assert.equal(P.trendColor(MONO, -1), MONO.down)
})

test('paper: 系列の見た目は 100・55・30% を実線・破線・点線で 9 段、10 番目から戻り、目立たせる 1 本があればほかは 100% を使わない（青を使わない）', () => {
  assert.deepEqual([0, 1, 2].map((i) => P.seriesStyle(i).a), [1, 0.55, 0.3])
  assert.deepEqual([3, 4, 5].map((i) => P.seriesStyle(i).dash), ['4 3', '4 3', '4 3'])
  assert.deepEqual([6, 7, 8].map((i) => P.seriesStyle(i).dash), ['1 2', '1 2', '1 2'])
  assert.deepEqual(P.seriesStyle(9), P.seriesStyle(0))
  assert.deepEqual(P.seriesStyle(-1), P.seriesStyle(8))
  const rest = Array.from({ length: 6 }, (_, i) => P.seriesStyle(i, true))
  assert.ok(rest.every((s) => s.a < 1))
  assert.equal(new Set(rest.map((s) => `${s.a}/${s.dash}`)).size, 6)
  assert.deepEqual(P.seriesStyle(6, true), P.seriesStyle(0, true))
})

test('paper: cleanPal は足りない・おかしい色を mono の色にする', () => {
  assert.deepEqual(P.cleanPal(undefined), { ...P.MONO })
  assert.deepEqual(P.cleanPal({ ink: '#abc', sub: 'red', rule: 5, up: '#ABCDEF' }), { ...P.MONO, ink: '#abc', up: '#ABCDEF' })
  assert.deepEqual(P.cleanPal(PALS.koma), { ...PALS.koma })
})

test('paper: esc は記号を直し、制御の字・双方向の制御・ゼロ幅の字を捨て、改行を空白にする', () => {
  assert.equal(P.esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  assert.equal(P.esc(`あ${String.fromCharCode(0, 8, 0x202e, 0x200b, 0xfeff)}い`), 'あい')
  assert.equal(P.esc('a\nb\t\tc'), 'a b c')
  assert.equal(P.esc('x' + String.fromCharCode(0xd800) + 'y'), 'xy')
  assert.equal(P.esc(undefined), '')
})

test('paper: 数の字は 3 桁ごとの「,」・小数の桁・負の 0 を出さず・数でない値は「–」', () => {
  assert.equal(P.num(1234567.891, 2), '1,234,567.89')
  assert.equal(P.num(0), '0')
  assert.equal(P.num(-1234.5, 1), '-1,234.5')
  assert.equal(P.num(-0.001, 2), '0.00')
  assert.equal(P.num(999, 0), '999')
  assert.equal(P.num(1000, 0), '1,000')
  for (const v of [NaN, Infinity, '5', null, undefined, 1e30]) assert.equal(P.num(/** @type {any} */ (v)), '–')
  assert.equal(P.f(-0), '0')
  assert.equal(P.f(1.005), '1')
  assert.equal(P.f(12.3456), '12.35')
  assert.equal(P.f(1e-9), '0')
  assert.equal(P.toNum('1,234.5'), 1234.5)
  assert.ok(Number.isNaN(P.toNum(null)) && Number.isNaN(P.toNum('')) && Number.isNaN(P.toNum('x')) && Number.isNaN(P.toNum(Infinity)))
})

test('paper: compact は日本語で万・億・兆、英語で K・M・B・T、3 桁の有効数字', () => {
  assert.equal(P.compact(999), '999')
  assert.equal(P.compact(12345), '1.23万')
  assert.equal(P.compact(123456789), '1.23億')
  assert.equal(P.compact(-45000), '-4.5万')
  assert.equal(P.compact(3e12), '3兆')
  assert.equal(P.compact(1500, 'en'), '1.5K')
  assert.equal(P.compact(2_500_000, 'en'), '2.5M')
  assert.equal(P.compact(NaN), '–')
})

test('paper: withUnit は $ ¥ は前・日本語の単位と % は詰めて後ろ・英字の単位は空けて後ろ', () => {
  assert.equal(P.withUnit('1,234', '円'), '1,234円')
  assert.equal(P.withUnit('5', '$'), '$5')
  assert.equal(P.withUnit('-5', '$'), '-$5')
  assert.equal(P.withUnit('12', '%'), '12%')
  assert.equal(P.withUnit('12', 'ms'), '12 ms')
  assert.equal(P.withUnit('12', ''), '12')
  assert.equal(P.withUnit('12', undefined), '12')
  assert.equal(P.autoDigits(16), 2)
  assert.equal(P.autoDigits(1500), 0)
  assert.equal(P.autoDigits(0.05), 4)
  assert.equal(P.withUnit('+5', '$'), '+$5')
})

test('paper: signed は正に「+」・負に「-」・0 は符号なし、percent は比を % にして 10% 未満だけ小数 1 桁', () => {
  assert.equal(P.signed(12.34, 1), '+12.3')
  assert.equal(P.signed(-3.8, 1), '-3.8')
  assert.equal(P.signed(0), '0')
  assert.equal(P.signed(0.001, 1), '0.0')
  assert.equal(P.signed(1234), '+1,234')
  assert.equal(P.signed(NaN), '–')
  assert.equal(P.percent(0.574), '57%')
  assert.equal(P.percent(0.093), '9.3%')
  assert.equal(P.percent(0), '0%')
  assert.equal(P.percent(1), '100%')
  assert.equal(P.percent(0.574, 1), '57.4%')
  assert.equal(P.percent(0.57, 0, true), '+57%')
  assert.equal(P.percent(-0.12, 0, true), '-12%')
  assert.equal(P.percent(/** @type {any} */ ('x')), '–')
})

test('paper: 日付は YYYY-MM-DD を読み、無い日を null にし、ja は「10/9」「10/9（金）」「2026年10月」・en は「Oct 9」で書く', () => {
  assert.deepEqual(P.parseYmd('2026-10-09'), { y: 2026, m: 10, d: 9, dow: 5, mon: 4, day: P.parseYmd('2026-10-08')?.day + 1 })
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-9', '10/9', '', null, 20261009]) assert.equal(P.parseYmd(bad), null, String(bad))
  assert.equal(P.parseYmd('2026-10-31')?.day - P.parseYmd('2026-10-01')?.day, 30)
  assert.deepEqual(P.parseYm('2026-10'), { y: 2026, m: 10, days: 31, firstMon: 3 })
  assert.equal(P.parseYm('2028-02')?.days, 29)
  assert.equal(P.parseYm('2026-00'), null)
  assert.equal(P.dateLabel('2026-10-09'), '10/9')
  assert.equal(P.dateLabel('2026-10-09', 'ja', 'mdw'), '10/9（金）')
  assert.equal(P.dateLabel('2026-10-09', 'ja', 'ymd'), '2026/10/9')
  assert.equal(P.dateLabel('2026-10-09', 'ja', 'ym'), '2026年10月')
  assert.equal(P.dateLabel('2026-10', 'ja', 'm'), '10月')
  assert.equal(P.dateLabel('2026-10-09', 'en'), 'Oct 9')
  assert.equal(P.dateLabel('2026-10-09', 'en', 'mdw'), 'Fri Oct 9')
  assert.equal(P.dateLabel('2026-10-09', 'en', 'ymd'), 'Oct 9, 2026')
  assert.equal(P.dateLabel('7/1'), '7/1', '読めない字はそのまま')
  assert.deepEqual([0, 1, 6, 7, -1].map((d) => P.weekday(d)), ['日', '月', '土', '日', '土'])
  assert.equal(P.weekday(5, 'en'), 'Fri')
})

test('paper: 時刻は「14:02」、長さは ja「2時間5分」・en「2h 05m」', () => {
  assert.equal(P.hm(14 * 60 + 2), '14:02')
  assert.equal(P.hm(0), '0:00')
  assert.equal(P.hm(1440 + 61), '1:01')
  assert.equal(P.hm(NaN), '–')
  assert.equal(P.duration(125), '2時間5分')
  assert.equal(P.duration(45), '45分')
  assert.equal(P.duration(120, 'en'), '2h 00m')
  assert.equal(P.duration(45, 'en'), '45m')
})

test('paper: dodge はラベルを gap 以上に押し分け、元の順のまま・範囲の中に返す', () => {
  assert.deepEqual(P.dodge([10, 50, 90], 12, 0, 100), [10, 50, 90])
  assert.deepEqual(P.dodge([40, 40, 41], 12, 0, 100), [40, 52, 64])
  assert.deepEqual(P.dodge([95, 99], 12, 0, 100), [88, 100])
  const ys = P.dodge([30, 10, 20, 15], 12, 0, 100)
  const sorted = [...ys].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 12 - 1e-9)
  assert.ok(ys[1] < ys[3] && ys[3] < ys[2] && ys[2] < ys[0], '元の上下の順を保つ')
  assert.deepEqual(P.dodge([5, 5, 5], 12, 0, 10), [0, 12, 24], '入らない時は lo から gap ずつ')
  assert.deepEqual(P.dodge([], 12, 0, 10), [])
})

test('paper: legend は札（四角・線・点）と字を横に並べ、幅を返し、end なら x が右の端', () => {
  const keys = /** @type {const} */ ([
    { label: '使った', mark: 'box', attr: P.inkFill(MONO, P.ALPHA.body) },
    { label: '見込み', mark: 'line', attr: P.inkStroke(MONO, P.ALPHA.ref, 1, P.DASH.ref) },
    { label: '今日', mark: 'dot', attr: P.inkFill(MONO) },
  ])
  const a = P.legend(10, 20, [...keys], MONO)
  assert.match(a.svg, /<rect [^>]*fill-opacity="0.55"/)
  assert.match(a.svg, /<line [^>]*stroke-dasharray="3 3"/)
  assert.match(a.svg, /<circle [^>]*r="2"/)
  assert.equal((a.svg.match(/<text /g) ?? []).length, 3)
  assert.ok(a.svg.includes(`fill="${MONO.sub}"`))
  const b = P.legend(300, 20, [...keys], MONO, { anchor: 'end' })
  assert.equal(b.width, a.width)
  const firstX = Number(/x="([\d.]+)"/.exec(b.svg)?.[1])
  near(firstX, 300 - b.width, 0.01)
})

test('paper: edgeLabels は最初を左端・最後を右端に置き、真ん中は離れて収まる時だけ置く', () => {
  const labels = Array.from({ length: 21 }, (_, i) => `${i + 1}日`)
  const at = (/** @type {number} */ i) => 10 + i * 20
  const wide = P.edgeLabels(labels, at, 0, 420, 100, MONO)
  assert.deepEqual([...wide.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]), ['1日', '21日', '11日'])
  assert.match(wide, /text-anchor="end"/)
  const narrow = P.edgeLabels(labels, (i) => i * 2, 0, 50, 100, MONO)
  assert.ok(!narrow.includes('>11日<'))
  assert.equal(P.edgeLabels([], at, 0, 100, 10, MONO), '')
  assert.ok(!P.edgeLabels(['', 'b'], at, 0, 100, 10, MONO).includes('middle'))
})

test('paper: linear・keep・gutter・nameOf・empty・triangle の小さな道具', () => {
  const s = P.linear(0, 10, 100, 0)
  assert.equal(s(0), 100)
  assert.equal(s(5), 50)
  assert.equal(P.linear(3, 3, 0, 10)(99), 5)
  /** @type {string[]} */
  const w = []
  assert.deepEqual(P.keep([1, 2, 3], 5, w, '形: 行'), [1, 2, 3])
  assert.deepEqual(P.keep([1, 2, 3, 4, 5, 6], 4, w, '形: 行'), [1, 2, 3, 4])
  assert.deepEqual(w, ['形: 行は 4 個までなので、超えた 2 個を捨てました'])
  assert.equal(P.gutter(['1']), 52)
  assert.ok(P.gutter(['1,234,567.89円'], { bold: true }) > 52)
  assert.equal(P.nameOf('  a '), 'a')
  assert.equal(P.nameOf(5), '5')
  assert.equal(P.nameOf({}), '')
  assert.deepEqual(P.arr('x'), [])
  assert.match(P.empty({ width: 200, height: 100, pal: MONO, lang: 'ja' }), /データがありません/)
  assert.match(P.triangle(10, 10, 6, true), /^M7 12.4L13 12.4L10 7.6Z$/)
  assert.equal(P.midline(100, 10), 103.5)
  assert.equal(P.circle(1, 2, 0, 'fill="#000000"'), '')
  assert.equal(P.strokePath('', 'x'), '')
})

test('paper: 目盛りは 1・2・5 の倍数で、範囲の中に収まり、小数の誤差を出さない', () => {
  assert.deepEqual(P.ticks(0, 100, 5), [0, 20, 40, 60, 80, 100])
  assert.deepEqual(P.ticks(0.12, 0.48, 3), [0.2, 0.3, 0.4])
  assert.deepEqual(P.ticks(3, 3), [3])
  assert.deepEqual(P.ticks(NaN, 1), [])
  assert.deepEqual(P.ticks(100, 0, 5), [100, 80, 60, 40, 20, 0])
  assert.equal(P.tickStep(0, 1000, 5), 200)
  assert.deepEqual(P.niceExtent(3.2, 97.5, 5), [0, 100])
  assert.deepEqual(P.niceExtent(5, 5), [4, 6])
  assert.ok(P.ticks(-1e6, 1e6, 7).length <= 20)
})

test('paper: 字の幅のめやすは、本物の書体（Noto Sans JP）の送りの合計と 12% 以内', () => {
  for (const [s, bold] of /** @type {[string, boolean][]} */ ([['115.08', true], ['1,234,567', false], ['キャッシュ読み', false], ['Total 2,660 units', false], ['出来高 Volume', false], ['MMWW iijl', false],
    ['POST /tools/run', false], ['GET /repos', true], ['±3.5 × 2 ÷ 4', false], ['R&D § 2 ©', false], ['first-try rate', false], ['p95 latency (ms)', true]])) {
    const font = metrics[bold ? 'sansBold' : 'sans']
    const real = [...s].reduce((sum, ch) => sum + font.adv(ch.codePointAt(0)), 0) * 8
    const est = P.textWidth(s, 8, bold)
    assert.ok(Math.abs(est / real - 1) < (bold ? 0.12 : 0.03), `${s}: めやす ${est.toFixed(1)} と実際 ${real.toFixed(1)}`)
  }
})

test('paper: clip は収まる字をそのまま・収まらない字を「…」で切って幅に収める', () => {
  assert.equal(P.clip('短い', 8, 100), '短い')
  const s = P.clip('とても長い名前のラベルです', 8, 50)
  assert.ok(s.endsWith('…') && s.length < 13, s)
  assert.ok(P.textWidth(s, 8) <= 50)
  assert.equal(P.clip('abc', 8, 3), '…')
})

test('paper: seeded は同じ種で同じ列・0 以上 1 未満（Math.random を使わない）', () => {
  const a = P.seeded(20261009)
  const b = P.seeded(20261009)
  const xs = Array.from({ length: 50 }, () => a())
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()))
  assert.ok(xs.every((v) => v >= 0 && v < 1))
  // look の candle と同じ式（種 20261009 の最初の値）
  near(xs[0], ((Math.imul(20261009, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
})

// ---------------------------------------------------------------- candle

/** 見本の絵の Op を、役割ごとに分ける */
function candleParts(/** @type {any} */ data, /** @type {any} */ pal = MONO, /** @type {number} */ width = MEASURE) {
  const r = drawLook('candle', data, { width, pal })
  const ops = flat(toOps(r, pal).ops)
  const paths = ops.filter((o) => o.t === 'path')
  const texts = ops.filter((o) => o.t === 'text')
  return {
    r, ops, texts,
    bodies: paths.filter((o) => o.fill && o.fill !== pal.ink.toUpperCase() && o.opacity === 0.55),
    wicks: paths.filter((o) => o.stroke && o.opacity === 0.8),
    volume: paths.filter((o) => o.fill?.toLowerCase() === pal.ink.toLowerCase() && o.opacity === 0.1),
    dashed: paths.filter((o) => o.dash),
    strokes: paths.filter((o) => o.stroke),
  }
}

test('candle: 足ごとに本体（55%）・ヒゲ（80%・1pt）・出来高（墨の 10%）があり、上げ下げの色は pal.up・pal.down', () => {
  const c = candleParts(candle.sample())
  assert.equal(c.bodies.length, 48)
  assert.equal(c.wicks.length, 48)
  assert.equal(c.volume.length, 48)
  const colors = new Set(c.bodies.map((o) => o.fill.toLowerCase()))
  assert.deepEqual([...colors].sort(), [MONO.down.toLowerCase(), MONO.up.toLowerCase()].sort())
  for (const w of c.wicks) near(w.lw, 1)
  const data = candle.sample()
  const upBars = data.ohlc.filter((/** @type {number[]} */ b) => b[3] >= b[0]).length
  assert.equal(c.bodies.filter((o) => o.fill.toLowerCase() === MONO.up.toLowerCase()).length, upBars)
})

test('candle: 枠と軸の線は無く、線は足のヒゲと最後の値の点線（墨の 35%・3 3）だけ', () => {
  const c = candleParts(candle.sample())
  assert.equal(c.strokes.length, 48 + 1)
  assert.equal(c.dashed.length, 1)
  assert.deepEqual(c.dashed[0].dash, [3, 3])
  near(c.dashed[0].opacity, 0.35)
  assert.equal(c.dashed[0].stroke.toLowerCase(), MONO.ink.toLowerCase())
})

test('candle: 値の字は右の余白に右揃えで、最後の値は太字・点線はその余白の入口まで伸びる', () => {
  const c = candleParts(candle.sample())
  const last = c.texts.find((t) => textOf(t) === '115.08円')
  assert.ok(last, c.texts.map(textOf).join(','))
  assert.equal(last.font, 'sansBold')
  const right = (/** @type {any} */ t) => t.glyphs[t.glyphs.length - 1].x + metrics.sans.adv(t.glyphs[t.glyphs.length - 1].c.codePointAt(0)) * t.size
  near(right(last), MEASURE - 4, 0.6)
  const lastBodyRight = Math.max(...c.bodies.map((o) => Math.max(...o.d.match(/-?\d+(?:\.\d+)?/g).filter((_, i) => i % 2 === 0).map(Number))))
  for (const t of c.texts.filter((t) => ['115.08円', '99.37円'].includes(textOf(t)))) assert.ok(t.glyphs[0].x > lastBodyRight, `${textOf(t)} が足に重なる`)
  const dashEnd = Math.max(...c.dashed[0].d.match(/-?\d+(?:\.\d+)?/g).filter((/** @type {string} */ _, /** @type {number} */ i) => i % 2 === 0).map(Number))
  near(dashEnd, MEASURE - 4, 0.01)
})

test('candle: 最高値の字は最後の値がその高さにある時に退き、最安値は残る', () => {
  const rising = { x: ['a', 'b', 'c'], ohlc: [[1, 2, 1, 2], [2, 3, 2, 3]], unit: '' }
  const c = candleParts(rising)
  const strings = c.texts.map(textOf)
  assert.equal(strings.filter((s) => s === '3.00').length, 1, strings.join(','))
  assert.ok(strings.includes('1.00'))
  assert.ok(candleParts(candle.sample()).texts.map(textOf).includes('99.37円'))
})

test('candle: 下の字は最初・最後（と離れていれば真ん中）の x、出来高の帯の右に「出来高」と最大の値が出る', () => {
  const strings = candleParts(candle.sample()).texts.map(textOf)
  for (const s of ['7/1', '8/3', '9/4', '出来高', '1,254']) assert.ok(strings.includes(s), `${s} が無い: ${strings.join(',')}`)
  const narrow = candleParts(candle.sample(), MONO, 100).texts.map(textOf)
  assert.ok(narrow.includes('7/1') && narrow.includes('9/4'))
  assert.ok(!narrow.includes('8/3'), '狭い図で真ん中の字が端の字と近すぎる')
})

test('candle: 出来高が無ければ帯も字も出さず、価格が下まで使う', () => {
  const { x, ohlc } = candle.sample()
  const c = candleParts({ x, ohlc })
  assert.equal(c.volume.length, 0)
  assert.ok(!c.texts.map(textOf).includes('出来高'))
  assert.equal(c.bodies.length, 48)
})

test('candle: 単位は値の字に付く（円は後ろ・$ は前）', () => {
  const { x, ohlc } = candle.sample()
  assert.ok(candleParts({ x, ohlc, unit: '$' }).texts.map(textOf).includes('$115.08'))
  assert.ok(candleParts({ x, ohlc, unit: '' }).texts.map(textOf).includes('115.08'))
})

test('candle: 数でない足は捨て、高値・安値が外れた足は広げ、出来高の負は 0 にして、それぞれ warnings に書く', () => {
  const n = candle.normalize({ x: ['a', 'b', 'c', 'd'], ohlc: [[1, 2, 0.5, 1.5], ['x', 2, 1, 1], [1, 1.2, 1.1, 1.3], null, [3, 4]], volume: [10, 20, -5, 'v', 1] })
  assert.equal(n.data.rows.length, 2)
  assert.deepEqual(n.data.rows.map((/** @type {any} */ r) => [r.h, r.l]), [[2, 0.5], [1.3, 1]])
  assert.equal(n.data.rows[1].v, 0)
  assert.equal(n.warnings.length, 3)
  assert.ok(n.warnings.some((m) => m.includes('3 本')) && n.warnings.some((m) => m.includes('1 本')))
  assert.ok(candle.normalize({ ohlc: [['1', '2', '0.5', '1.5']] }).data.rows.length === 1, '数の字は数に直す')
})

test('candle: 足が 200 本を超えたら、k 本ずつ（始値は最初・終値は最後・高値は最大・安値は最小・出来高は合計）にまとめる', () => {
  const ohlc = Array.from({ length: 500 }, (_, i) => [i, i + 2, i - 1, i + 1])
  const volume = Array.from({ length: 500 }, () => 2)
  const n = candle.normalize({ ohlc, volume })
  assert.equal(n.data.rows.length, 167)
  assert.deepEqual(n.data.rows[0], { x: '', o: 0, h: 4, l: -1, c: 3, v: 6 })
  assert.equal(n.data.rows[166].v, 2 * (500 - 166 * 3))
  assert.ok(n.warnings.some((m) => m.includes('500 本') && m.includes('3 本ずつ')))
  assert.equal(candleParts({ ohlc, volume }).bodies.length, 167)
})

test('candle: 全部が同じ値・1 本だけ・空でも描ける（空は「データがありません」）', () => {
  assert.equal(candleParts({ x: ['a', 'b'], ohlc: [[5, 5, 5, 5], [5, 5, 5, 5]] }).bodies.length, 2)
  const one = candleParts({ x: ['10/1'], ohlc: [[1, 2, 0, 1.5]], volume: [3] })
  assert.equal(one.bodies.length, 1)
  assert.ok(one.texts.map(textOf).includes('10/1'))
  const empty = candleParts({ ohlc: [] })
  assert.deepEqual(empty.texts.map(textOf), ['データがありません'])
  assert.equal(drawLook('candle', { ohlc: [] }, { lang: 'en' }).svg.includes('No data'), true)
})

test('candle: 値の字の幅に合わせて右の余白が広がり、足と重ならない', () => {
  const big = { x: ['a', 'b', 'c'], ohlc: [[1234567.5, 1234999.5, 1230000, 1234000], [1234000, 1236000, 1233000, 1235500]], unit: '円' }
  const c = candleParts(big)
  const lastBodyRight = Math.max(...c.bodies.map((o) => Math.max(...o.d.match(/-?\d+(?:\.\d+)?/g).filter((/** @type {string} */ _, /** @type {number} */ i) => i % 2 === 0).map(Number))))
  for (const t of c.texts.filter((t) => /^\d[\d,]*円$/.test(textOf(t)))) assert.ok(t.glyphs[0].x > lastBodyRight + 3, `${textOf(t)}`)
})

// ---------------------------------------------------------------- sankey

function sankeyParts(/** @type {any} */ data, /** @type {any} */ pal = MONO, /** @type {number} */ width = MEASURE) {
  const r = drawLook('sankey', data, { width, pal })
  const ops = flat(toOps(r, pal).ops)
  const paths = ops.filter((o) => o.t === 'path')
  const ink = pal.ink.toLowerCase()
  return {
    r, ops, paths, texts: ops.filter((o) => o.t === 'text'),
    nodes: paths.filter((o) => o.fill?.toLowerCase() === ink && o.opacity === 0.55),
    links: paths.filter((o) => o.stroke && !o.fill),
  }
}

test('sankey: 見本は節 9 本（墨の 55%）とつながり 14 本があり、つながりの太さは値に比例する', () => {
  const s = sankeyParts(sankey.sample())
  assert.equal(s.nodes.length, 9)
  assert.equal(s.links.length, 14)
  const ratio = s.links.map((o) => o.lw).sort((a, b) => b - a)
  // 値の大きい順 820・520・260・240・210・130・90・80・70・70・60・50・40・20 と太さの比が同じ（svg の太さは 0.01pt の位まで・1pt 未満は下限で止まる）
  const values = [820, 520, 260, 240, 210, 130, 90, 80, 70, 70, 60, 50, 40, 20]
  const k = ratio[0] / 820
  values.forEach((v, i) => { if (v * k >= 1) near(ratio[i], v * k, 0.011) })
  assert.ok(ratio.at(-1) >= 1)
})

/** 目立たせない流れ: 墨の 14%（1.5pt 以下の細い流れは印刷の下限 18% に持ち上がる） @param {any} o */
const quietLink = (o) => o.opacity <= P.PRINT.line + 1e-9
/** @param {any} o */
const hotLink = (o) => !quietLink(o)

test('sankey: つながりは墨の 14% の線で、目立たせる 1 本（いちばん太い物）だけが濃く（mono は 80%）、最後に描かれる', () => {
  const s = sankeyParts(sankey.sample())
  const quiet = s.links.filter(quietLink)
  const hot = s.links.filter(hotLink)
  assert.equal(quiet.length, 13)
  assert.equal(hot.length, 1)
  assert.equal(hot[0].lw, Math.max(...s.links.map((o) => o.lw)))
  assert.equal(s.links.at(-1), hot[0])
  near(hot[0].opacity, 0.8)
  for (const o of quiet) near(o.opacity, o.lw <= P.PRINT.thin ? 0.18 : 0.14)
})

test('sankey: 1.5pt 以下の細いつながりは 18%・それより太いつながりは 14% のまま', () => {
  const data = { nodes: ['A', 'B', 'C'].map((name) => ({ name })), links: [{ source: 'A', target: 'B', value: 1000 }, { source: 'A', target: 'C', value: 1 }] }
  const s = sankeyParts(data)
  const thin = s.links.filter((o) => o.lw <= P.PRINT.thin)
  assert.equal(thin.length, 1)
  near(thin[0].opacity, 0.18)
})

test('sankey: 色のある紙では目立たせる流れが accent の 55%（mono は墨の 80%）', () => {
  for (const name of ['koma', 'mergeble']) {
    const pal = PALS[name]
    const s = sankeyParts(sankey.sample(), pal)
    const hot = s.links.filter(hotLink)
    assert.equal(hot.length, 1)
    assert.equal(hot[0].stroke.toLowerCase(), pal.accent.toLowerCase())
    near(hot[0].opacity, 0.55)
  }
})

test('sankey: highlight（[source, target]）で目立たせる流れを替えられ、無い名前は無視して最大に戻る', () => {
  const base = sankey.sample()
  const s = sankeyParts({ ...base, highlight: ['入力', '検索'] })
  const hot = s.links.filter(hotLink)
  assert.equal(hot.length, 1)
  assert.ok(hot[0].lw < Math.max(...s.links.map((o) => o.lw)) / 5, '70 の流れは 820 の流れより細い')
  const ignored = sankeyParts({ ...base, highlight: ['入力', 'ない名前'] })
  assert.equal(ignored.links.filter(hotLink)[0].lw, Math.max(...ignored.links.map((o) => o.lw)))
})

test('sankey: 名前と値の字は両側の列にあり、流れの上（始まりの値以外）に字を置かない', () => {
  const s = sankeyParts(sankey.sample())
  const strings = s.texts.map(textOf)
  for (const name of ['入力', 'キャッシュ読み', 'キャッシュ書き', '出力', '読み取り', '編集', 'コマンド', '検索', '返答']) assert.ok(strings.includes(name), name)
  for (const v of ['260', '1,840', '420', '140', '1,120', '710', '210', '330', '290']) assert.ok(strings.includes(v), v)
  assert.ok(strings.includes('合計 2,660') && strings.includes('単位: 千トークン'))
  const hotValue = s.texts.filter((t) => textOf(t) === '820')
  assert.equal(hotValue.length, 1)
  assert.equal(hotValue[0].font, 'sansBold')
  // 左の列の字は節より左・右の列の字は節より右
  const xs = s.nodes.map((o) => Math.min(...o.d.match(/-?\d+(?:\.\d+)?/g).filter((/** @type {string} */ _, /** @type {number} */ i) => i % 2 === 0).map(Number)))
  const leftNode = Math.min(...xs)
  const rightNode = Math.max(...xs)
  for (const t of s.texts.filter((t) => ['入力', 'キャッシュ読み'].includes(textOf(t)))) assert.ok(t.glyphs.at(-1).x < leftNode, textOf(t))
  for (const t of s.texts.filter((t) => ['編集', '検索'].includes(textOf(t)))) assert.ok(t.glyphs[0].x > rightNode, textOf(t))
})

test('sankey: 循環・自分へのつながり・無い名前・値が正でない（か 1,000 兆を超える）つながり・同名の節・つながりの無い節を捨てて warnings に書く', () => {
  const n = sankey.normalize({
    nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'A' }, { name: 'Z' }, { name: '' }, 'D'],
    links: [
      { source: 'A', target: 'B', value: 5 }, { source: 'B', target: 'C', value: 3 }, { source: 'C', target: 'A', value: 2 },
      { source: 'A', target: 'A', value: 1 }, { source: 'A', target: 'Q', value: 1 }, { source: 'B', target: 'C', value: 0 },
      { source: 'B', target: 'C', value: -2 }, { source: 'A', target: 'C', value: 'x' }, { source: 'A', target: 'C', value: '2' },
      { source: 'A', target: 'C', value: 1e308 },
    ],
  })
  assert.deepEqual(n.data.links.map((/** @type {any} */ l) => `${l.source}>${l.target}:${l.value}`), ['A>B:5', 'B>C:3', 'A>C:2'])
  assert.deepEqual(n.data.nodes.map((/** @type {any} */ x) => x.name), ['A', 'B', 'C'])
  const text = n.warnings.join('|')
  for (const part of ['同じ名前の節 1 個', '循環になるつながり 1 本', '自分から自分へ', '無い名前を指す', '0 より大きく 1,000 兆以下の数でないつながり 4 本', 'つながりの無い節 2 個']) assert.ok(text.includes(part), `${part} が無い: ${text}`)
  const r = drawLook('sankey', { nodes: [{ name: 'A' }, { name: 'B' }, { name: 'A' }], links: [{ source: 'A', target: 'B', value: 1 }, { source: 'B', target: 'A', value: 1 }] }, { width: 300 })
  assert.ok(r.warnings.some((m) => m.includes('循環')))
  assert.deepEqual(toOps(r, MONO).warnings, [])
})

test('sankey: 長い名前は「…」で切って外の列の幅に収め、はみ出さない', () => {
  const long = 'とても長いとても長いとても長い節の名前です'
  const r = drawLook('sankey', { nodes: [{ name: long }, { name: '行き先の名前もとても長いとても長い' }], links: [{ source: long, target: '行き先の名前もとても長いとても長い', value: 3 }] }, { width: 300, pal: MONO })
  const { ops, warnings } = toOps(r, MONO)
  assert.deepEqual(warnings, [])
  assert.notEqual(ops[0].t, 'clip')
  const strings = flat(ops).filter((o) => o.t === 'text').map(textOf)
  assert.ok(strings.some((s) => s.endsWith('…') && s.startsWith('とても')), strings.join(','))
})

test('sankey: 3 列の途中の節の名前には紙の白の 85% の下敷きが付き、1 列に多くの節があっても収まる', () => {
  const three = { nodes: ['A', 'B', 'C', 'D'].map((name) => ({ name })), links: [{ source: 'A', target: 'B', value: 4 }, { source: 'A', target: 'C', value: 2 }, { source: 'B', target: 'D', value: 3 }, { source: 'C', target: 'D', value: 2 }] }
  const s = sankeyParts(three)
  assert.equal(s.paths.filter((o) => o.fill?.toLowerCase() === MONO.paper.toLowerCase() && o.opacity === 0.85).length, 2)
  assert.deepEqual(s.r.warnings, [])
  const many = { nodes: [...Array.from({ length: 40 }, (_, i) => ({ name: `元${i}` })), { name: '先' }], links: Array.from({ length: 40 }, (_, i) => ({ source: `元${i}`, target: '先', value: i + 1 })) }
  const m = sankeyParts(many)
  assert.deepEqual(toOps(m.r, MONO).warnings, [])
  assert.notEqual(toOps(m.r, MONO).ops[0].t, 'clip')
  assert.equal(m.nodes.length, 41)
})

test('sankey: つながりが無ければ「データがありません」・小数の値は桁をそろえる', () => {
  assert.deepEqual(sankeyParts({ nodes: [{ name: 'A' }], links: [] }).texts.map(textOf), ['データがありません'])
  const s = sankeyParts({ nodes: [{ name: 'A' }, { name: 'B' }], links: [{ source: 'A', target: 'B', value: 2.5 }] })
  const strings = s.texts.map(textOf)
  assert.ok(strings.includes('2.50'), strings.join(','))
})

// ---------------------------------------------------------------- フックの環境で読めること（hook-env-check が見る事の静的な部分）

test('looks と d3 の束は、hook-env-check が探す字（ドル記号の直後の点・Node の語・動的な読み込み）と、種の無い乱数・今の時刻（Math.random・Date.now・引数なしの new Date）を含まず、import は相対だけ', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const dir = path.join(root, 'hooks/engine/looks')
  const words = /node:|\bprocess\b|\bBuffer\b|setTimeout|setInterval|setImmediate|require\(|\beval\(|new Function|\bimport\s*\(|Math\.random|Date\.now|new Date\(\s*\)/
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))
  assert.ok(files.length >= 10)
  for (const n of files) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8')
    assert.ok(text.startsWith('// @ts-check'), `${n} が // @ts-check で始まらない`)
    assert.ok(!/\$\./.test(text), `${n} にドル記号の直後の点がある`)
    text.split('\n').forEach((line, i) => assert.ok(!words.test(line), `${n}:${i + 1} に Node の語`))
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)) assert.ok(m[1].startsWith('.'), `${n}: ${m[1]}`)
  }
  const d3 = fs.readFileSync(path.join(root, 'hooks/vendor/d3.mjs'), 'utf8')
  assert.ok(!/\$\./.test(d3), 'd3.mjs にドル記号の直後の点がある')
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d3), 'd3.mjs に生の制御の字がある')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'hooks/vendor/d3.manifest.json'), 'utf8'))
  assert.equal(manifest.bundles[0].packages.length, 24)
  for (const p of manifest.bundles[0].packages) assert.ok(fs.existsSync(path.join(root, p.license)), `${p.name} の LICENSE が無い: ${p.license}`)
})
