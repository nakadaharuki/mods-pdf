// @ts-check
// 図の形（looks）の試験を作る道具。形ごとの試験は testLook('<id>') を呼ぶだけ（test/looks.test.mjs が LOOK_LIST の全部に呼ぶ）。
// 約束は docs/looks.md の 5 章（と、5 章が指す 2 章の色と字・3 章の上限・1 章の出典）。書体は本物（fonts/）を 1 回だけ読むので、「書体に無い字」の警告も拾える。
//
// 選ばなかった案
// - 形ごとの試験を各形のファイルに書かせる案: 40 を超える形で同じ確かめが少しずつずれる。確かめは 1 か所に持ち、形に固有の振る舞いだけ形ごとの試験に足す。
// - 字の色を「sub より暗い」の明るさで確かめる案: pal.up・pal.down（#176639・#A31F1C）は sub（#4A4A4A）より明るく、上げ下げの値の字が落ちる。字に使ってよい色を名前で決める。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFontBytes, makeMetrics } from '../hooks/engine/fonts.mjs'
import { svgToOps } from '../hooks/engine/svg.mjs'
import { makeTheme, lookPal } from '../hooks/engine/theme.mjs'
import { drawLook, LOOKS, CATEGORIES } from '../hooks/engine/looks/index.mjs'
import { PRINT } from '../hooks/engine/looks/paper.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontsDir = path.join(ROOT, 'fonts')
const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'fonts.json'), 'utf8'))
const readBase64 = async (/** @type {string} */ rel) => fs.readFileSync(path.join(fontsDir, rel)).toString('base64')
const bytes = await loadFontBytes(['sans', 'sansBold'], manifest, readBase64, new Map())
export const metrics = /** @type {any} */ (makeMetrics(/** @type {any} */ (bytes)))

/** 紙の色 4 つ（mono は青を使わない紙で series を持たない・koma と mergeble と vivid は accent が墨と違い、系列の 8 色を持つ紙。図の入口 figure.mjs と同じ lookPal で作る） */
export const PALS = Object.fromEntries(['mono', 'koma', 'mergeble', 'vivid'].map((n) => [n, lookPal(makeTheme({ theme: n }))]))
/** 版面の幅（A4 の mono） */
export const MEASURE = makeTheme({}).measure

/** docs/looks.md の 4 章: 移す 43 の形の id と種類。形の category はこの表と同じでなければならない */
export const CATEGORY_OF = Object.freeze(Object.fromEntries(Object.entries({
  time: 'candle sparks bars area-threshold bump multi-line stacked-area step-line streamgraph',
  usage: 'gauge tiles bullet progress-rings waffle cost-burn',
  compare: 'radar dumbbell lollipop parallel-coords slope',
  spread: 'box-plot contour hexbin histogram ridgeline scatter violin',
  parts: 'donut treemap circle-pack funnel icicle polar-area sunburst waterfall',
  flow: 'chord dendrogram force-graph sankey',
  work: 'heatmap gantt calendar-month timeline',
}).flatMap(([cat, ids]) => ids.split(' ').map((id) => [id, cat]))))
/** 事業計画の 13 形（docs/deck.md の 6 章。43 の外・category は 'biz'）。出典の行は「ModsPDF の形（…）」で、元の designs/ のファイルが無い */
export const BIZ_OF = Object.freeze(Object.fromEntries('market matrix2x2 cycle process pyramid milestones org venn mekko compare-table flowchart kpi-hero pnl'.split(' ').map((id) => [id, 'biz'])))
/** biz の形のファイルの頭にある出典の行 */
export const BIZ_NOTE = 'ModsPDF の形（本人の look の決まりに沿って新しく作った物）'
/** 形の id と、元の look の designs/ のファイルの名前が違う物（4 章の「session-timeline（id は timeline）」） */
export const SOURCE_OF = Object.freeze({ timeline: 'session-timeline' })

/** @param {any[]} ops @returns {any[]} */
export const flat = (ops) => ops.flatMap((o) => (o.t === 'clip' ? [o, ...flat(o.ops)] : [o]))
/** @param {any} op */
export const textOf = (op) => op.glyphs.map((/** @type {{ c: string }} */ g) => g.c).join('')

/**
 * 描いた svg を、版面と同じ縮尺（viewBox の幅 = 四角の幅）で Op にする
 * @param {{ svg: string, width: number, height: number }} r
 * @param {{ ink: string, paper: string }} pal
 */
export function toOps(r, pal) {
  return svgToOps(r.svg, { x: 0, y: 0, width: r.width, height: r.height, metrics, color: pal.ink, paper: pal.paper })
}

/** @param {Record<string, string>} pal */
const palSet = (pal) => new Set(Object.values(pal).flat().map((c) => c.toLowerCase()))
/** 字に使ってよい色（docs/looks.md の 2 章「字に pal.sub より薄い色を使わない」。rule・tint・paper は薄すぎて印刷で飛ぶ） @param {Record<string, string>} pal */
const textPalSet = (pal) => new Set(['ink', 'sub', 'accent', 'up', 'down'].map((k) => pal[k].toLowerCase()))

/** Op が使う色（塗り・線・字）。角丸の四角は RectOp で来るので、path と同じに見る @param {any[]} ops */
export function colorsOf(ops) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const op of flat(ops)) {
    if (op.t === 'path' || op.t === 'rect') {
      if (op.fill) out.add(op.fill.toLowerCase())
      if (op.stroke) out.add(op.stroke.toLowerCase())
    } else if (op.t === 'text') out.add(op.color.toLowerCase())
  }
  return out
}

/** path の Op の外接の四角（d の数を x・y の組として読む）。rect の Op は x・y・w・h そのまま @param {any} op */
export function bboxOf(op) {
  if (op.t === 'rect') return { x0: op.x, x1: op.x + op.w, y0: op.y, y1: op.y + op.h }
  const n = (String(op.d).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number)
  const xs = n.filter((_, i) => i % 2 === 0)
  const ys = n.filter((_, i) => i % 2 === 1)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** 字の大きさの集まり（小さい順・重ねなし） @param {any[]} ops */
export const sizesOf = (ops) => [...new Set(flat(ops).filter((o) => o.t === 'text').map((o) => o.size))].sort((a, b) => a - b)

/** data の数を全部 f で置き換えた写し（数・字の葉だけ。形は残す） @param {any} v @param {(leaf: number|string) => any} f @returns {any} */
export function mapLeaves(v, f) {
  if (typeof v === 'number' || typeof v === 'string') return f(v)
  if (Array.isArray(v)) return v.map((x) => mapLeaves(x, f))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapLeaves(x, f)]))
  return v
}

/**
 * 上限（点 5,000・系列 12・値 2,000・節 200・つながり 1,000・木の節 2,000）を超える data を作る。
 * 一番上の配列を 6,000 個に伸ばし、系列・群の中の 1 つ目の配列も 6,000 に伸ばし、木は 3,000 個の葉を足す
 * @param {any} sample
 */
export function inflate(sample) {
  const grow = (/** @type {any[]} */ a) => Array.from({ length: 6000 }, (_, i) => a[i % a.length])
  /** @type {Record<string, any>} */
  const out = { ...sample }
  for (const [k, v] of Object.entries(sample)) {
    if (Array.isArray(v) && v.length) {
      out[k] = grow(v)
      const first = v[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const wide = { ...first }
        for (const [k2, v2] of Object.entries(first)) if (Array.isArray(v2) && v2.length) wide[k2] = grow(v2)
        out[k][0] = wide
      }
    }
  }
  if (sample.root) out.root = { ...sample.root, children: Array.from({ length: 3000 }, (_, i) => ({ name: `葉${i}`, value: 1 })) }
  return out
}

/** どの形でも投げてはいけない、どの形の data の形でもない壊れた data（どれも warnings を出さなければならない） */
const JUNK = [undefined, null, 0, 1, true, 'x', [], {}, [[]], [null], { x: 'x' }, { items: {} }, { nodes: 3, links: 'a' }, { series: [null, 1, { values: 'v' }] }, { root: { children: 5 } }, { points: [[1], 'a', null] }]
/** 上限を超えた data を描く時間の上限（ms）。フックは 10 秒で、1 つの文書に図がいくつも入る */
const INFLATED_MS = 1000

/**
 * 1 つの形の確かめを全部 test に登録する
 * @param {string} id
 */
export function testLook(id) {
  const look = LOOKS[id]
  const name = (/** @type {string} */ s) => `${id}: ${s}`
  const sample = () => (look ? look.sample() : undefined)

  test(name('形の約束（id・題・4 章の種類・関数）を満たし、見本は JSON の値だけで直さなくても通る'), () => {
    assert.ok(look, `LOOKS に ${id} が無い`)
    assert.equal(look.id, id)
    assert.match(look.id, /^[a-z][a-z0-9-]*$/)
    assert.ok(look.title.length > 0)
    assert.ok(CATEGORIES.includes(look.category), `種類 ${look.category}`)
    assert.equal(look.category, CATEGORY_OF[id] ?? BIZ_OF[id], `docs/looks.md の 4 章では ${id} は ${CATEGORY_OF[id] ?? BIZ_OF[id] ?? '（移す形の表に無い）'}`)
    for (const k of /** @type {const} */ (['normalize', 'draw', 'height', 'sample'])) assert.equal(typeof look[k], 'function', k)
    const s = look.sample()
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, '見本に JSON にならない値（関数・Date・NaN・undefined）がある')
    const n = look.normalize(s)
    assert.deepEqual(n.warnings, [], '見本が warnings を出す')
    for (const w of [300, MEASURE, 1000]) {
      const h = look.height(w, n.data)
      assert.ok(Number.isFinite(h) && h > 40, `幅 ${w} の高さ ${h}`)
    }
  })

  test(name('ファイルの頭に出典（43 の形は look の designs/ の名指し・biz の形は ModsPDF の形の行と look の決まりの出典）があり、d3 を使うなら d3 の出典もある'), () => {
    const file = path.join(ROOT, 'hooks/engine/looks', `${id}.mjs`)
    assert.ok(fs.existsSync(file), `${id} は hooks/engine/looks/${id}.mjs に置く（docs/looks.md の 1 章）`)
    const src = fs.readFileSync(file, 'utf8')
    const from = /** @type {Record<string, string>} */ (SOURCE_OF)[id] ?? id
    if (id in BIZ_OF) assert.ok(src.includes(BIZ_NOTE) && src.includes('（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）'), 'biz の形の出典の行（docs/deck.md の 6 章）が無い')
    else assert.ok(src.includes(`元は look の designs/${from}.mjs（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）`), '出典の行（docs/looks.md の 5 章）が無い')
    if (/from\s*['"]\.\.\/\.\.\/vendor\/d3\.mjs['"]/.test(src)) {
      assert.ok(/hooks\/vendor\/d3\.mjs/.test(src) && /LICENSES\//.test(src) && /ISC|BSD/.test(src), 'd3 を使うのに、d3 の部品の名前・ライセンス・出典（hooks/vendor/d3.mjs と LICENSES/）が頭に無い')
    }
  })

  for (const [palName, pal] of Object.entries(PALS)) {
    test(name(`見本を描くと svgToOps が警告なしで Op にし、版面の中に収まる（${palName}）`), () => {
      const r = drawLook(id, sample(), { width: MEASURE, pal })
      assert.deepEqual(r.warnings, [])
      assert.equal(r.width, MEASURE)
      assert.match(r.svg, new RegExp(`^<svg [^>]*viewBox="0 0 ${MEASURE} ${r.height}"`))
      const { ops, warnings } = toOps(r, pal)
      assert.deepEqual(warnings, [])
      assert.ok(ops.length > 5)
      assert.notEqual(ops[0].t, 'clip', '描いた物が四角からはみ出した（svgToOps が ClipOp で包んだ）')
    })

    test(name(`字は全部 7pt 以上の sans で ink・sub・accent・up・down の色、塗りと線は pal の色だけ（${palName}）`), () => {
      const { ops } = toOps(drawLook(id, sample(), { width: MEASURE, pal }), pal)
      const texts = flat(ops).filter((o) => o.t === 'text')
      assert.ok(texts.length > 0, '字が無い')
      const textOk = textPalSet(pal)
      for (const t of texts) {
        assert.ok(t.size >= 7 - 1e-9, `${textOf(t)} が ${t.size}pt`)
        assert.ok(t.font === 'sans' || t.font === 'sansBold', t.font)
        assert.ok(textOk.has(t.color.toLowerCase()), `「${textOf(t)}」の色 ${t.color} は字に使えない（半透明の字・rule・tint・paper の字は印刷で飛ぶ）`)
      }
      const allowed = palSet(pal)
      for (const c of colorsOf(ops)) assert.ok(allowed.has(c), `${c} は pal の色でない`)
    })
  }

  test(name('mono の絵に青みの色が無い'), () => {
    const { ops } = toOps(drawLook(id, sample(), { width: MEASURE, pal: PALS.mono }), PALS.mono)
    for (const c of colorsOf(ops)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      assert.ok(b <= Math.max(r, g) + 12, `${c} が青み`)
    }
  })

  test(name('印刷で飛ぶ薄さが無く（細い線 18%・塗り 8% 以上）、地を塗らない'), () => {
    for (const w of [300, MEASURE]) {
      const r = drawLook(id, sample(), { width: w, pal: PALS.mono })
      for (const op of flat(toOps(r, PALS.mono).ops).filter((o) => o.t === 'path' || o.t === 'rect')) {
        const a = op.opacity ?? 1
        if (op.stroke) {
          const floor = op.lw <= PRINT.thin ? PRINT.line : PRINT.fill
          assert.ok(a >= floor - 1e-9, `幅 ${w}: 太さ ${op.lw}pt の線が ${a}（${floor} 以上にする。paper の strokeAttr を使えば持ち上がる）`)
          assert.ok(op.lw >= 0.5 - 1e-9, `幅 ${w}: ${op.lw}pt の線は細すぎて印刷で消える`)
        }
        if (op.fill) {
          assert.ok(a >= PRINT.fill - 1e-9, `幅 ${w}: 塗りが ${a}（${PRINT.fill} 以上にする）`)
          // 地の塗りは四角（svg.mjs は rect を M・L・L・L・Z の 5 つにする）。面の形（線の下の面・1 つだけの升）は数えない
          const b = bboxOf(op)
          const boxy = op.t === 'rect' || (String(op.d).match(/[MLCZ]/g) ?? []).length <= 6
          assert.ok(!(boxy && b.x1 - b.x0 >= r.width * 0.9 && b.y1 - b.y0 >= r.height * 0.9), `幅 ${w}: 図のほぼ全部を覆う四角の塗りがある（地は塗らない）`)
        }
      }
    }
  })

  test(name('同じ入力は同じ svg と同じ字を返す'), () => {
    const a = drawLook(id, sample(), { width: MEASURE, pal: PALS.mono })
    const b = drawLook(id, sample(), { width: MEASURE, pal: PALS.mono })
    assert.equal(a.svg, b.svg)
    assert.deepEqual(toOps(a, PALS.mono).ops, toOps(b, PALS.mono).ops)
  })

  test(name('幅 300 と 500 pt で字の大きさが同じ（図の字は pt のまま）'), () => {
    const sizes = [300, 500].map((w) => {
      const r = drawLook(id, sample(), { width: w, pal: PALS.mono })
      assert.equal(r.width, w)
      const { ops, warnings } = toOps(r, PALS.mono)
      assert.deepEqual(warnings, [], `幅 ${w}`)
      assert.notEqual(ops[0].t, 'clip', `幅 ${w} ではみ出した`)
      return sizesOf(ops)
    })
    assert.deepEqual(sizes[0], sizes[1])
  })

  test(name('高さを渡すとその高さで、描いた物はその中に収まる'), () => {
    const r = drawLook(id, sample(), { width: 400, height: 240, pal: PALS.mono })
    assert.equal(r.height, 240)
    assert.match(r.svg, /viewBox="0 0 400 240"/)
    const { ops, warnings } = toOps(r, PALS.mono)
    assert.deepEqual(warnings, [])
    assert.notEqual(ops[0].t, 'clip')
  })

  test(name('英語（lang en）でも警告なしで描ける'), () => {
    const r = drawLook(id, sample(), { width: MEASURE, pal: PALS.mono, lang: 'en' })
    assert.deepEqual(r.warnings, [])
    assert.deepEqual(toOps(r, PALS.mono).warnings, [])
  })

  test(name('壊れた data でも投げず、warnings を書き、svgToOps が警告なしで読める svg を返す'), () => {
    const broken = [...JUNK, mapLeaves(sample(), () => NaN)]
    const odd = [
      mapLeaves(sample(), (v) => (typeof v === 'number' ? Infinity : v)),
      mapLeaves(sample(), (v) => (typeof v === 'number' ? -v - 1 : v)),
      mapLeaves(sample(), (v) => (typeof v === 'number' ? 1e308 : v)),
      mapLeaves(sample(), (v) => (typeof v === 'number' ? 0 : v)),
      mapLeaves(sample(), (v) => (typeof v === 'string' ? `<b onclick="x">&'"${'長'.repeat(200)}` : v)),
      mapLeaves(sample(), (v) => (typeof v === 'number' ? String(v) : v)),
    ]
    for (const [i, data] of [...broken, ...odd].entries()) {
      const label = JSON.stringify(data)?.slice(0, 80) ?? String(data)
      const r = drawLook(id, data, { width: MEASURE, pal: PALS.mono })
      assert.ok(r.svg.startsWith('<svg'), label)
      assert.ok(Array.isArray(r.warnings) && r.warnings.every((w) => typeof w === 'string'))
      if (i < broken.length) assert.ok(r.warnings.length > 0, `${label} を黙って描いた（読めない data は warnings に書く）`)
      assert.ok(!/<b onclick|<script/.test(r.svg), '入れた字が svg の中で要素になった')
      assert.deepEqual(toOps(r, PALS.mono).warnings, [], label)
    }
  })

  test(name(`上限を超えた data は切って警告にし、${INFLATED_MS} ms 以内に描ける`), () => {
    const data = inflate(sample())
    const t0 = performance.now()
    const r = drawLook(id, data, { width: MEASURE, pal: PALS.mono })
    const ms = performance.now() - t0
    assert.ok(r.warnings.length > 0, '警告が無い')
    assert.ok(r.svg.startsWith('<svg') && r.svg.length < 2_000_000, `svg ${r.svg.length} 字`)
    assert.ok(ms < INFLATED_MS, `${Math.round(ms)} ms かかった`)
    assert.doesNotThrow(() => toOps(r, PALS.mono))
  })
}
