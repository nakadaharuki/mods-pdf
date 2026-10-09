// @ts-check
// 図の形（looks）の 43 が 1 つの家族であることの試験: docs/looks.md の 4 章の表と LOOKS が揃う・全部のファイルに出典がある・d3 のライセンスの写しがある・
// 形と束のファイルが paper.mjs の道具を写さずに使う（線の太さ・字の大きさ・桁・目盛り・濃さの尺度が形ごとに散らない）。
// 形ごとの確かめは test/looks-kit.mjs の testLook（looks.test.mjs が回す）。ここは形を横に並べて比べる物と、paper に上げた道具の振る舞い。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawLook, LOOK_LIST, CATEGORIES } from '../hooks/engine/looks/index.mjs'
import * as P from '../hooks/engine/looks/paper.mjs'
import { BIZ_OF } from './looks-kit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'hooks/engine/looks')
const FILES = fs.readdirSync(DIR).filter((n) => n.endsWith('.mjs')).sort()
const read = (/** @type {string} */ n) => fs.readFileSync(path.join(DIR, n), 'utf8')
/** 形でないファイル（入口・束・共有の部品） */
const NOT_SHAPES = new Set(['index.mjs', 'paper.mjs', 'time-series.mjs', 'spread-kit.mjs', 'parts-kit.mjs', ...CATEGORIES.map((c) => `${c}.mjs`)])
const NOTE = '（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）'
/** 資料の回に足した事業計画の形（category が biz）。docs/looks.md の 4 章の 43 の外で、出典は「ModsPDF の形（…）」の行（test/looks-biz.test.mjs が見る） */
const BIZ = LOOK_LIST.filter((l) => l.category === 'biz').map((l) => l.id)
/** 43 の形（4 章の表に載る形） */
const CORE = LOOK_LIST.filter((l) => l.category !== 'biz')
const MONO = P.MONO
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)

/** ファイルの頭（最初の import か export より前のコメント） @param {string} src */
const headOf = (src) => src.slice(0, src.search(/^(?:import|export) /m))

/**
 * docs/looks.md の 4 章の表を読む: 種類の行「time: candle・sparks・…」の並び。「session-timeline（id は timeline）」は id と元のファイルの名前が違う
 * @returns {{ id: string, category: string, source: string }[]}
 */
function docTable() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/looks.md'), 'utf8')
  const sec = doc.split(/^## /m).find((s) => s.startsWith('4.')) ?? ''
  /** @type {{ id: string, category: string, source: string }[]} */
  const out = []
  for (const row of sec.split('\n')) {
    const m = /^(\w+): (.+)$/.exec(row.trim())
    if (!m || !CATEGORIES.includes(/** @type {any} */ (m[1]))) continue
    for (const item of m[2].split('・')) {
      const alias = /^(\S+?)（id は (\S+?)）$/.exec(item.trim())
      out.push(alias ? { id: alias[2], category: m[1], source: alias[1] } : { id: item.trim(), category: m[1], source: item.trim() })
    }
  }
  return out
}

/** call の開き括弧の次から、トップレベルの引数の字の列を読む（括弧・字の中の「,」で切らない） @param {string} s @param {number} start */
function argsAt(s, start) {
  /** @type {string[]} */
  const out = []
  let depth = 0
  let from = start
  let q = ''
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth === 0) { out.push(s.slice(from, i).trim()); return out }
      depth--
    } else if (c === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1 }
  }
  return out
}

/** svg の要素の属性を読む @param {string} svg @param {string} tag */
const tags = (svg, tag) => [...svg.matchAll(new RegExp(`<${tag} ([^>]*?)/?>`, 'g'))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
/** svg の字（大きさ・色・揃え） @param {string} svg */
const texts = (svg) => [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
  const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
  return { s: m[2], x: Number(a.x), y: Number(a.y), size: Number(a['font-size']), fill: a.fill, anchor: a['text-anchor'] ?? 'start', bold: a['font-weight'] === 'bold' }
})

// ---------------------------------------------------------------- 43 の形と docs の表

test('LOOKS は docs/looks.md の 4 章の 43 の形と、同じ id・同じ種類・同じ順で揃い、形のファイルは表の形だけ', () => {
  const want = docTable()
  assert.equal(want.length, 43, '4 章の表の形の数')
  assert.deepEqual(CORE.map((l) => ({ id: l.id, category: l.category })), want.map(({ id, category }) => ({ id, category })))
  const shapeFiles = FILES.filter((n) => !NOT_SHAPES.has(n)).map((n) => n.replace(/\.mjs$/, '')).filter((id) => !BIZ.includes(id)).sort()
  assert.deepEqual(shapeFiles, want.map((w) => w.id).sort(), 'hooks/engine/looks/ の形のファイル（<id>.mjs）が表と違う')
})

test('形は 43 + 事業計画の 13 の 56 で、13 は looks-kit の表と同じ id（形の数が変わったら表を直す）', () => {
  assert.equal(CORE.length, 43)
  assert.equal(BIZ.length, 13)
  assert.deepEqual([...BIZ].sort(), Object.keys(BIZ_OF).sort())
  assert.equal(LOOK_LIST.length, 56)
})

// ---------------------------------------------------------------- 出典とライセンス

test('looks の全部のファイルの頭に look の出典（本人の作・PolyForm Noncommercial 1.0.0）があり、形のファイルは元の designs/<名前>.mjs を名指す', () => {
  const source = Object.fromEntries(docTable().map((w) => [w.id, w.source]))
  for (const n of FILES) {
    const head = headOf(read(n))
    assert.ok(head.includes(NOTE), `${n} の頭に出典（docs/looks.md の 5 章）が無い`)
    const id = n.replace(/\.mjs$/, '')
    if (!NOT_SHAPES.has(n) && !BIZ.includes(id)) assert.ok(head.includes(`元は look の designs/${source[id]}.mjs${NOTE}`), `${n} の頭に「元は look の designs/${source[id]}.mjs…」が無い`)
  }
})

test('d3 を読むファイルは、読む関数の部品（d3-shape など）・hooks/vendor/d3.mjs・LICENSES/ を頭に書き、d3 の束の部品のライセンスの写しは LICENSES/ に全部ある', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/vendor/d3.manifest.json'), 'utf8'))
  /** @type {Map<string, string>} 関数の名前 → 部品の名前 */
  const owner = new Map()
  for (const b of manifest.bundles) {
    for (const p of b.packages) {
      const file = path.join(ROOT, p.license)
      assert.ok(fs.existsSync(file), `${p.name} のライセンスの写し ${p.license} が無い`)
      assert.ok(fs.readFileSync(file, 'utf8').length > 200, `${p.license} が短すぎる`)
      // d3 の部品は ISC と BSD-3-Clause、d3-delaunay が読む robust-predicates は Unlicense
      assert.match(p.spdx, /^(ISC|BSD-3-Clause|Unlicense)$/, `${p.name} の spdx ${p.spdx}`)
      for (const e of p.exports) owner.set(e, p.name)
    }
  }
  let readers = 0
  for (const n of FILES) {
    const src = read(n)
    const m = /^import \{([^}]*)\} from '\.\.\/\.\.\/vendor\/d3\.mjs'/m.exec(src)
    if (!m) continue
    readers++
    const head = headOf(src)
    assert.ok(head.includes('hooks/vendor/d3.mjs') && head.includes('LICENSES/') && /ISC|BSD/.test(head), `${n}: d3 の出典（hooks/vendor/d3.mjs と LICENSES/・ISC か BSD）が頭に無い`)
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      const pkg = owner.get(name)
      assert.ok(pkg, `${n}: ${name} は d3 の束の manifest に無い`)
      assert.ok(head.includes(/** @type {string} */ (pkg)), `${n}: ${name} の部品 ${pkg} の名前が頭に無い`)
    }
  }
  assert.ok(readers >= 15, `d3 を読むファイルが ${readers}`)
})

// ---------------------------------------------------------------- paper の道具を写さない

test('形と束のファイルは paper.mjs の道具を写して持たない（同じ名前の定義・種つき乱数の式・「単位:」の字・線の太さの数）', () => {
  const names = Object.keys(P)
  const strokeFns = ['inkStroke(', 'hotStroke(', 'strokeAttr(']
  for (const n of FILES.filter((x) => x !== 'paper.mjs')) {
    const src = read(n)
    // 一番外の定義だけを見る（関数の中の hot・line のような局所の名前は、paper の道具の写しではない）
    for (const k of names) assert.ok(!new RegExp(`^(?:export\\s+)?(?:const|let|function)\\s+${k}\\b`, 'm').test(src), `${n} が paper の ${k} を自分で定義している（paper から読む）`)
    assert.ok(!src.includes('1103515245'), `${n} が種つき乱数の式を写している（paper の seeded を使う）`)
    assert.ok(!src.includes("'単位', 'Unit'"), `${n} が「単位:」の字を自分で作っている（paper の unitNote を使う）`)
    assert.ok(!/stroke-width="/.test(src), `${n} が stroke-width を字で書いている（paper の strokeAttr と LW を使う）`)
    for (const fn of strokeFns) {
      for (let at = src.indexOf(fn); at >= 0; at = src.indexOf(fn, at + 1)) {
        if (/[\w.]/.test(src[at - 1] ?? '')) continue
        const w = argsAt(src, at + fn.length)[2]
        assert.ok(w === undefined || !/^\d+(?:\.\d+)?$/.test(w), `${n}: ${fn}… の太さ ${w} を数で書いている（LW.hair・line・hot・ring のどれか）`)
      }
    }
  }
})

test('43 の形の見本の字の大きさは paper の 4 段（7.5・8・14・20pt）だけで、太字は値の段（8pt）と目立たせる名前だけ', () => {
  const allowed = new Set([P.TICK, P.LABEL, P.VALUE, P.BIG, P.HUGE])
  /** @type {Set<string>} */
  const odd = new Set()
  for (const look of CORE) {
    for (const lang of /** @type {const} */ (['ja', 'en'])) {
      const r = drawLook(look.id, look.sample(), { width: 503.5, pal: MONO, lang })
      for (const t of texts(r.svg)) {
        if (!allowed.has(t.size)) odd.add(`${look.id}: 「${t.s}」 ${t.size}pt`)
        if (t.bold && t.size > P.VALUE) odd.add(`${look.id}: 「${t.s}」 ${t.size}pt の太字（大きな数は細字）`)
      }
    }
  }
  assert.deepEqual([...odd], [])
})

test('43 の形の見本の線の太さは LW の段（0.75・1・1.5・2pt）だけ（値に比例する太さの sankey のつながりは除く）', () => {
  const steps = new Set(Object.values(P.LW))
  /** @type {Set<string>} */
  const odd = new Set()
  for (const look of CORE) {
    if (look.id === 'sankey') continue
    const r = drawLook(look.id, look.sample(), { width: 503.5, pal: MONO })
    for (const tag of ['line', 'path', 'rect', 'circle', 'polygon', 'polyline']) {
      for (const a of tags(r.svg, tag)) if (a['stroke-width'] !== undefined && !steps.has(Number(a['stroke-width']))) odd.add(`${look.id}: <${tag}> ${a['stroke-width']}pt`)
    }
  }
  assert.deepEqual([...odd], [])
})

// ---------------------------------------------------------------- paper に上げた道具

test('paper: 線の太さの段は細い順に hair 0.75・line 1・hot 1.5・ring 2 で、hair は印刷で消える 0.5pt より太い', () => {
  assert.deepEqual({ ...P.LW }, { hair: 0.75, line: 1, hot: 1.5, ring: 2 })
  assert.ok(Object.isFrozen(P.LW))
  assert.ok(P.LW.hair > 0.5 && P.LW.hot <= P.PRINT.thin, '目立たせる線も細い線の下限（18%）の側')
})

test('paper: decimals は値が持つ桁を、大きさの桁（autoDigits）まで・差が見える桁は足して、並べる値を同じ桁にする', () => {
  assert.equal(P.decimals([5053.7351, 13.00012]), 0)
  assert.equal(P.decimals([2.4137, 1.8602]), 2)
  assert.equal(P.decimals([12.3456, 87.6543]), 2)
  assert.equal(P.decimals([84, 96, 312]), 0)
  assert.equal(P.decimals([14.8, 40]), 1)
  // 大きな値の小さな差は、差が見える桁まで（1,235 → 1,235 にしない）
  assert.equal(P.decimals([1234.5, 1234.9]), 1)
  // 足し算の誤差は消える
  assert.equal(P.decimals([18.200000000000003]), 1)
  assert.equal(P.decimals([0.125]), 3)
  assert.equal(P.decimals([0.125], 2), 2)
  assert.equal(P.decimals([NaN, 3, Infinity]), 0)
  assert.equal(P.decimals([]), 0)
})

test('paper: plain は 1 つの値をその値の桁（2 桁まで）で書き、sign なら正に「+」', () => {
  assert.equal(P.plain(14.8), '14.8')
  assert.equal(P.plain(40), '40')
  assert.equal(P.plain(1248), '1,248')
  assert.equal(P.plain(2.4, true), '+2.4')
  assert.equal(P.plain(-0.8, true), '-0.8')
  assert.equal(P.plain(0, true), '0')
})

test('paper: statDigits は計算した値の幅の有効数字 3 桁・stepDigits は目盛りの間隔の位の桁', () => {
  assert.deepEqual([1600, 160, 70, 16, 1.6, 0.16, 0].map(P.statDigits), [0, 0, 1, 1, 2, 3, 0])
  assert.deepEqual([10, 5, 1, 0.5, 0.2, 0.05, 0.001].map(P.stepDigits), [0, 0, 0, 1, 1, 2, 3])
  const t = P.tickSet(0, 1, 5)
  assert.deepEqual(t.values, [0, 0.2, 0.4, 0.6, 0.8, 1])
  assert.deepEqual(t.values.map(t.fmt), ['0.0', '0.2', '0.4', '0.6', '0.8', '1.0'])
  assert.deepEqual(P.tickSet(0, 300, 3).values.map(P.tickSet(0, 300, 3).fmt), ['0', '100', '200', '300'])
})

test('paper: numOf は数と数の字だけを受け、1,000 兆を超える値は NaN', () => {
  assert.equal(P.numOf('1,234'), 1234)
  assert.equal(P.numOf(P.VALUE_MAX), P.VALUE_MAX)
  assert.ok(Number.isNaN(P.numOf(P.VALUE_MAX * 10)))
  assert.ok(Number.isNaN(P.numOf(null)))
  assert.ok(Number.isNaN(P.numOf('x')))
})

test('paper: 左の目盛りは x の 4pt 左までの sub の棒と、棒の 4pt 左に右揃えの字。下の目盛りは棒の 9pt 下に中央揃えの字', () => {
  const at = (/** @type {number} */ v) => 100 - v
  const svg = P.axisLeft({ ticks: [0, 50], at, x: 60, pal: MONO, fmt: (v) => `${v}` })
  const stubs = tags(svg, 'line')
  assert.equal(stubs.length, 2)
  assert.deepEqual(stubs.map((l) => [l.x1, l.x2, l.y1, l['stroke-width'], l.stroke]), [['56', '60', '100', '1', MONO.sub], ['56', '60', '50', '1', MONO.sub]])
  const ts = texts(svg)
  assert.deepEqual(ts.map((t) => [t.s, t.x, t.anchor, t.fill, t.size]), [['0', 52, 'end', MONO.sub, P.TICK], ['50', 52, 'end', MONO.sub, P.TICK]])
  near(ts[0].y, P.midline(100, P.TICK), 0.01)
  // 棒の無い左の目盛りと、図から離す gap
  const bare = P.axisLeft({ ticks: [0], at, x: 60, pal: MONO, fmt: String, stub: false, gap: 3 })
  assert.equal(tags(bare, 'line').length, 0)
  assert.equal(texts(bare)[0].x, 53)
  const bottom = P.axisBottom({ ticks: [0, 10], at: (v) => 20 + v * 10, y: 200, pal: MONO, fmt: String, left: 20, right: 300, unit: '分' })
  assert.deepEqual(tags(bottom, 'line').map((l) => [l.y1, l.y2, l['stroke-width']]), [['202', '206', '1'], ['202', '206', '1']])
  assert.deepEqual(texts(bottom).map((t) => [t.s, t.y, t.anchor]), [['0', 215, 'middle'], ['10', 215, 'middle'], ['分', 215, 'end']])
})

test('paper: 見出しは大きな数（14pt の墨）と説明（7.5pt の sub）、狭ければ 8pt の太字だけ、それも入らなければ置かない', () => {
  const wide = texts(P.hero('3.42万円', '累計・予算 10.00万円', MONO, 4, 18, 400))
  assert.deepEqual(wide.map((t) => [t.s, t.size, t.fill, t.bold]), [['3.42万円', P.BIG, MONO.ink, false], ['累計・予算 10.00万円', P.TICK, MONO.sub, false]])
  near(wide[1].x, 4 + P.textWidth('3.42万円', P.BIG) + 8, 0.01)
  const narrow = texts(P.hero('123,456,789円', '説明', MONO, 4, 18, 4 + P.textWidth('123,456,789円', P.BIG) - 1))
  assert.deepEqual(narrow.map((t) => [t.size, t.bold]), [[P.VALUE, true]])
  assert.equal(P.hero('123,456,789円', '説明', MONO, 4, 18, 20), '')
})

test('paper: unitNote は「単位: 円」（en は Unit）で、単位が無ければ空', () => {
  assert.equal(P.unitNote('円', 'ja'), '単位: 円')
  assert.equal(P.unitNote('ms', 'en'), 'Unit: ms')
  assert.equal(P.unitNote('', 'ja'), '')
})

test('paper: shade は比を紙の下限 8% から 85%（hi）までの直線の濃さにし、凡例は「少」から「多」へ 5 つの見本を同じ濃さで並べる', () => {
  assert.equal(P.shade(0), P.PRINT.fill)
  assert.equal(P.shade(1), P.ALPHA.heavy)
  near(P.shade(0.5), 0.465)
  assert.equal(P.shade(2), P.ALPHA.heavy)
  assert.equal(P.shade(NaN), P.PRINT.fill)
  assert.equal(P.shade(1, 0.75), 0.75)
  for (const mark of /** @type {const} */ (['box', 'hex'])) {
    const g = P.shadeLegend(300, 50, MONO, 'ja', { mark })
    const shapes = mark === 'box' ? tags(g.svg, 'rect') : tags(g.svg, 'path')
    assert.deepEqual(shapes.map((s) => Number(s['fill-opacity'] ?? 1)), [0, 0.25, 0.5, 0.75, 1].map((v) => Math.round(P.shade(v) * 1000) / 1000))
    const ts = texts(g.svg)
    assert.deepEqual(ts.map((t) => t.s).sort(), ['多', '少'])
    assert.ok(g.left < Math.min(...ts.map((t) => t.x)) && Math.max(...ts.map((t) => t.x)) <= 300)
  }
  assert.deepEqual(texts(P.shadeLegend(300, 50, MONO, 'en').svg).map((t) => t.s).sort(), ['Less', 'More'])
})

test('paper: gridOf は 1 行の上限から行の数を決め、列は行ごとの数が揃う数（5 つを 4 列なら 3 と 2）', () => {
  assert.deepEqual(P.gridOf(5, 4), { cols: 3, rows: 2 })
  assert.deepEqual(P.gridOf(3, 4), { cols: 3, rows: 1 })
  assert.deepEqual(P.gridOf(12, 5), { cols: 4, rows: 3 })
  assert.deepEqual(P.gridOf(0, 4), { cols: 1, rows: 1 })
  assert.deepEqual(P.gridOf(4, 0), { cols: 1, rows: 4 })
})

test('paper: ymdOfDay は 1970-01-01 からの日数を年・月・日・曜日と YYYY-MM-DD に戻し、parseYmd と往復する', () => {
  const d = /** @type {NonNullable<ReturnType<typeof P.parseYmd>>} */ (P.parseYmd('2026-10-09'))
  assert.deepEqual(P.ymdOfDay(d.day), { y: 2026, m: 10, d: 9, dow: 5, mon: 4, day: d.day, iso: '2026-10-09' })
  for (const s of ['1970-01-01', '2024-02-29', '2024-12-31', '2026-01-01', '1999-12-31']) {
    const p = /** @type {NonNullable<ReturnType<typeof P.parseYmd>>} */ (P.parseYmd(s))
    const back = P.ymdOfDay(p.day)
    assert.equal(back.iso, s)
    assert.equal(back.dow, p.dow)
    assert.equal(back.mon, p.mon)
  }
})

test('paper: polyline は点の列の d（close なら Z）、ringPath は隙間を真ん中の円周で測った環の一片・1 周は穴のある環', () => {
  assert.equal(P.polyline([[0, 0], [1.234, 2]], true), 'M0 0L1.23 2Z')
  assert.equal(P.polyline([]), '')
  const piece = P.ringPath(0, 0, 10, 20, 0, Math.PI / 2, 2)
  assert.match(piece, /^M[\d. -]+A20 20 0 0 1 [\d. -]+L[\d. -]+A10 10 0 0 0 [\d. -]+Z$/)
  // 隙間 2pt を半径 15 の円周で測ると、片の両端から 1/15 ラジアンずつ削る
  const start = /^M([\d.]+) ([\d.]+)/.exec(piece)
  near(Math.atan2(Number(start?.[2]), Number(start?.[1])), 1 / 15, 0.002)
  assert.equal((P.ringPath(0, 0, 10, 20, 0, Math.PI * 2).match(/A/g) ?? []).length, 4)
  assert.equal(P.ringPath(0, 0, 10, 20, 0, 0.01, 2), '')
})

test('paper: fitText は収まる最初の言い方、freeSpot は印と置いた箱を避けた空き（無ければ null）', () => {
  assert.equal(P.fitText(['とても長い説明の字', '短い'], P.textWidth('短い', P.TICK) + 1), '短い')
  assert.match(P.fitText(['とても長い説明の字'], 20), /…$/)
  const bounds = { x0: 0, y0: 0, x1: 100, y1: 100 }
  const spot = P.freeSpot({ w: 20, h: 10, from: [50, 50], bounds, points: [[50, 50]], boxes: [{ x0: 0, y0: 0, x1: 100, y1: 30 }] })
  assert.ok(spot)
  const box = { x0: spot.x0, y0: spot.y0, x1: spot.x0 + 20, y1: spot.y0 + 10 }
  assert.ok(!P.overlaps(box, { x0: 0, y0: 0, x1: 100, y1: 30 }, 2))
  assert.ok(!(50 > box.x0 - 3 && 50 < box.x1 + 3 && 50 > box.y0 - 3 && 50 < box.y1 + 3))
  assert.equal(P.freeSpot({ w: 200, h: 10, from: [50, 50], bounds }), null)
})
