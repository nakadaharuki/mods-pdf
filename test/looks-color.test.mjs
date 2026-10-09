// @ts-check
// 色のテーマで形が系列・項目を色で分けること、textMin（字の下限）、細い形の 2 行折り返しを確かめる。
// 形ごとの約束は test/looks.test.mjs（testLook）。ここは「色のテーマ」と「資料の字の下限」と「折り返し」だけを見る。
//
// 選ばなかった案
// - 絵の見た目を人が見て確かめる案: 色の分け方は数で言える（使った色の数・字と下の面の明るさの差）ので、直す人が要らないように試験で見る。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook, LOOK_LIST, LOOKS } from '../hooks/engine/looks/index.mjs'
import { PALS, MEASURE, metrics, toOps, flat, colorsOf, bboxOf } from './looks-kit.mjs'

const COLOR_THEMES = ['koma', 'mergeble', 'vivid']

/** 色みのある色（3 つの色の成分の開きが 48 以上）。灰色・墨・sub・rule・tint は入らない @param {string} c */
const chroma = (c) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  return Math.max(r, g, b) - Math.min(r, g, b)
}
/** 描いた面と線の色（字の色を除く） @param {any[]} ops */
const markColors = (ops) => {
  /** @type {Map<string, number>} */
  const out = new Map()
  for (const op of flat(ops)) {
    if (op.t !== 'path' && op.t !== 'rect') continue
    for (const c of [op.fill, op.stroke]) if (typeof c === 'string') out.set(c.toLowerCase(), (out.get(c.toLowerCase()) ?? 0) + 1)
  }
  return out
}
/**
 * 形を描いて Op にする
 * @param {string} id @param {string} themeName @param {Record<string, any>} [opts]
 */
const render = (id, themeName, opts = {}) => {
  const pal = PALS[themeName]
  const r = drawLook(id, opts.data ?? LOOKS[id].sample(), { width: opts.width ?? MEASURE, height: opts.height, pal, textMin: opts.textMin })
  return { r, pal, ops: toOps(r, pal).ops, warnings: toOps(r, pal).warnings }
}

test('色のテーマの donut と treemap は 2 色以上の色みのある面を使い、mono は系列の色を使わない', () => {
  // treemap の見本は前年比（上げ・下げの色）の升。delta の無い data は系列の色で升を分ける
  const plain = { root: { name: '全体', children: ['従業員', '設備', '広告', '研究', '人材', '物流'].map((name, i) => ({ name, value: 60 - i * 7 })) } }
  for (const [id, data] of /** @type {[string, any][]} */ ([['donut', undefined], ['treemap', undefined], ['treemap', plain]])) {
    for (const name of COLOR_THEMES) {
      const { ops } = render(id, name, { data })
      const chromatic = [...markColors(ops).keys()].filter((c) => chroma(c) >= 48)
      assert.ok(chromatic.length >= 2, `${id}（${name}）の色みのある色は ${chromatic.length} 色`)
      if (data) {
        const own = chromatic.filter((c) => c !== PALS[name].up.toLowerCase() && c !== PALS[name].down.toLowerCase())
        assert.ok(own.length >= 2, `${id}（${name}・delta なし）の系列の色は ${own.length} 色`)
      }
    }
    const mono = render(id, 'mono', { data })
    for (const c of colorsOf(mono.ops)) assert.ok(chroma(c) < 48 || c === PALS.mono.up.toLowerCase() || c === PALS.mono.down.toLowerCase(), `${id}（mono）に ${c}`)
  }
})

test('vivid では、灰色だけで描く形が 1 つも無い（上げ・下げの色も色みとして数える）', () => {
  /** @type {string[]} */
  const gray = []
  for (const look of LOOK_LIST) {
    const { ops } = render(look.id, 'vivid')
    const chromatic = [...markColors(ops).keys()].filter((c) => chroma(c) >= 48)
    if (!chromatic.length) gray.push(look.id)
  }
  assert.deepEqual(gray, [])
})

test('項目・系列を色で分ける形は、色のテーマで 3 色以上の色みのある面と線を使う', () => {
  const MANY = ['multi-line', 'stacked-area', 'streamgraph', 'sankey', 'chord', 'polar-area', 'sunburst', 'circle-pack', 'funnel', 'mekko', 'bump', 'parallel-coords', 'sparks', 'violin', 'ridgeline', 'box-plot', 'progress-rings', 'donut']
  for (const id of MANY) {
    for (const name of COLOR_THEMES) {
      const { ops, pal } = render(id, name)
      const chromatic = [...markColors(ops).keys()].filter((c) => chroma(c) >= 48 && c !== pal.up.toLowerCase() && c !== pal.down.toLowerCase())
      assert.ok(chromatic.length >= 3, `${id}（${name}）の色みのある色は ${chromatic.length} 色`)
    }
  }
})

test('目立たせる 1 つは accent・ほかは薄く細く（multi-line と bump の色のテーマ）', () => {
  for (const id of ['multi-line', 'bump']) {
    const { ops, pal } = render(id, 'vivid')
    const lines = flat(ops).filter((o) => o.t === 'path' && o.stroke && !o.fill)
    const hot = lines.filter((o) => o.stroke.toLowerCase() === pal.accent.toLowerCase())
    assert.ok(hot.length >= 1, `${id}: accent の線がある`)
    const hotW = Math.max(...hot.map((o) => o.lw ?? 0))
    const rest = lines.filter((o) => o.stroke.toLowerCase() !== pal.accent.toLowerCase() && chroma(o.stroke) >= 48)
    assert.ok(rest.length >= 1, `${id}: ほかの線は別の色`)
    for (const o of rest) assert.ok((o.lw ?? 0) <= hotW, `${id}: ほかの線は目立たせる線より太くない`)
  }
})

test('textMin を渡すと、どの形でもそれより小さい字が無い（色のテーマも mono も）', () => {
  for (const look of LOOK_LIST) {
    for (const name of ['mono', 'vivid']) {
      for (const width of [300, MEASURE]) {
        const { ops } = render(look.id, name, { width, textMin: 9 })
        for (const op of flat(ops)) if (op.t === 'text') assert.ok(op.size >= 9 - 1e-9, `${look.id}（${name}・幅 ${width}）に ${op.size}pt の字`)
      }
    }
  }
})

test('textMin が無ければ、字の大きさは今までのまま（mono の絵を変えない）', () => {
  const a = drawLook('donut', LOOKS.donut.sample(), { width: MEASURE, pal: PALS.mono })
  const b = drawLook('donut', LOOKS.donut.sample(), { width: MEASURE, pal: PALS.mono, textMin: undefined })
  assert.equal(a.svg, b.svg)
  const sizes = new Set(flat(toOps(a, PALS.mono).ops).filter((o) => o.t === 'text').map((o) => o.size))
  assert.ok([...sizes].some((s) => s < 9), '資料の下限を渡さなければ 9pt 未満の字がある')
})

test('textMin を渡した後に渡さずに描くと、字の大きさが元に戻る（下限が残らない）', () => {
  const before = drawLook('donut', LOOKS.donut.sample(), { width: MEASURE, pal: PALS.mono }).svg
  drawLook('donut', LOOKS.donut.sample(), { width: MEASURE, pal: PALS.mono, textMin: 11 })
  const after = drawLook('donut', LOOKS.donut.sample(), { width: MEASURE, pal: PALS.mono }).svg
  assert.equal(before, after)
})

// 細い形の 2 行折り返し ----------------------------------------------------------------

const CHAIN = {
  nodes: ['受付', '審査', '契約', '入金', '出荷', '検収', '請求'].map((n, i) => ({ id: `n${i}`, name: `${n}の確認と手配` })),
  links: Array.from({ length: 6 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: i % 2 ? '月次' : '' })),
}
const STEPS7 = { steps: ['課題の把握', '試作', '検証', '導入', '拡大', '海外展開', '上場'].map((name) => ({ name: `${name}と見直し`, note: `${name}の中身を数字で確かめる` })) }
const ITEMS7 = { items: ['会社を設立', '試作版を完成', '有料版を開始', '契約 100 社を達成', '黒字に転換', '海外へ展開', '上場の準備'].map((name, i) => ({ date: `${2026 + Math.floor(i / 2)}-${String(1 + (i % 2) * 6).padStart(2, '0')}`, name, done: i < 2 })) }
const SPANS = {
  spans: Array.from({ length: 8 }, (_, i) => ({ lane: i % 2 ? '対応' : '検知', start: `0${i + 1}:00`, end: `0${i + 1}:50`, label: `工程 ${i + 1} の確認作業`, highlight: i === 6 })),
}

/** 箱の外にはみ出した物（字・面・線の外接の四角が、0〜width・0〜height から 1pt を超えて出る物）の数 @param {any[]} ops @param {number} w @param {number} h */
const outside = (ops, w, h) => {
  let n = 0
  for (const op of flat(ops)) {
    if (op.t === 'text') {
      const xs = op.glyphs.map((/** @type {any} */ g) => g.x)
      if (Math.min(...xs) < -1 || Math.max(...xs) + op.size > w + 1 || op.y - op.size < -1 || op.y > h + 1) n++
    } else if (op.t === 'rect' || (op.t === 'path' && !/[AaCcQq]/.test(op.d))) {
      // 円弧・曲線の d は数が座標だけではない（半径・フラグ）ので、直線だけの図形で見る
      const b = bboxOf(op)
      if (b.x0 < -1 || b.x1 > w + 1 || b.y0 < -1 || b.y1 > h + 1) n++
    }
  }
  return n
}

for (const [id, data, width] of /** @type {[string, any, number][]} */ ([['flowchart', CHAIN, 480], ['process', STEPS7, 400], ['milestones', ITEMS7, 400], ['timeline', SPANS, 400]])) {
  test(`${id}: 5 つ以上で箱が自然な高さの 2 倍以上なら 2 行に折り返し、字を「…」で切らず、箱に収まる`, () => {
    const natural = drawLook(id, data, { width, pal: PALS.vivid, textMin: 9 }).height
    const tall = natural * 2.2
    const r = drawLook(id, data, { width, height: tall, pal: PALS.vivid, textMin: 9 })
    assert.equal(r.height, tall)
    assert.equal(r.svg.includes('…'), false, '「…」で切っていない')
    const { ops, warnings } = toOps(r, PALS.vivid)
    assert.deepEqual(warnings, [])
    assert.equal(outside(ops, r.width, r.height), 0, '箱の外にはみ出した物が無い')
    // 2 行にした印: 自然な高さの 1 行の絵より、字のある場所の高さが 2 つの帯に分かれる
    const ys = [...new Set(flat(ops).filter((o) => o.t === 'text').map((o) => Math.round(o.y)))]
    assert.ok(Math.max(...ys) - Math.min(...ys) > natural * 0.8, '字が箱の高い所まで広がる')
  })

  test(`${id}: 自然な高さの箱では 1 行のまま（折り返さない）`, () => {
    const natural = drawLook(id, data, { width, pal: PALS.vivid }).height
    const a = drawLook(id, data, { width, height: natural, pal: PALS.vivid })
    const b = drawLook(id, data, { width, pal: PALS.vivid })
    assert.equal(a.svg, b.svg)
  })
}

test('段が 4 つ以下の形は、高い箱でも折り返さない（process）', () => {
  const data = { steps: STEPS7.steps.slice(0, 4) }
  const natural = drawLook('process', data, { width: 400, pal: PALS.vivid }).height
  const tall = drawLook('process', data, { width: 400, height: natural * 2.5, pal: PALS.vivid })
  const ys = [...new Set(flat(toOps(tall, PALS.vivid).ops).filter((o) => o.t === 'path' && o.fill).map((o) => Math.round(bboxOf(o).y0)))]
  // 矢羽根の帯は 1 行（同じ高さに並ぶ）
  assert.equal(new Set(ys.filter((y) => y > 0)).size >= 1, true)
  const bands = flat(toOps(tall, PALS.vivid).ops).filter((o) => o.t === 'path' && o.fill && bboxOf(o).y1 - bboxOf(o).y0 === 34)
  assert.equal(new Set(bands.map((o) => Math.round(bboxOf(o).y0))).size, 1)
})

test('cycle: 5 つ以上で箱が自然な高さの 2 倍以上なら、札の行を増やして「…」で切らない', () => {
  const data = LOOKS.cycle.sample()
  const natural = drawLook('cycle', data, { width: 320, pal: PALS.vivid, textMin: 9 }).height
  const r = drawLook('cycle', data, { width: 320, height: natural * 2.2, pal: PALS.vivid, textMin: 9 })
  assert.equal(r.svg.includes('…'), false)
  const { ops, warnings } = toOps(r, PALS.vivid)
  assert.deepEqual(warnings, [])
  assert.equal(outside(ops, r.width, r.height), 0)
})

// 字と下の面の明るさの差 ---------------------------------------------------------------

/** @param {string} hex */
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** @param {string} a @param {string} b */
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** 色 over を、不透明度 a で色 under の上に重ねた色 @param {string} over @param {string} under @param {number} a */
const mix = (over, under, a) => {
  const ch = (/** @type {number} */ i) => Math.round(parseInt(over.slice(i, i + 2), 16) * a + parseInt(under.slice(i, i + 2), 16) * (1 - a))
  return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`
}
/** 四角（4 点の閉じた path か rect）か。そうなら外接の四角 @param {any} op */
const boxOf = (op) => {
  if (op.t === 'rect') return bboxOf(op)
  if (op.t !== 'path' || typeof op.d !== 'string') return null
  const pts = (op.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  if (pts.length !== 10 || !/^M[^A-Za-z]*L[^A-Za-z]*L[^A-Za-z]*L[^A-Za-z]*Z$/.test(op.d.replace(/\s+/g, ' ').trim().replace(/ ?([MLZ]) ?/g, '$1'))) return null
  const b = bboxOf(op)
  const area = (b.x1 - b.x0) * (b.y1 - b.y0)
  return area > 0 ? b : null
}

test('色のテーマで、字は四角い面の上に載っても、面との明るさの差が 3 倍以上ある', () => {
  /** @type {string[]} */
  const bad = []
  for (const look of LOOK_LIST) {
    for (const name of COLOR_THEMES) {
      const { ops, pal } = render(look.id, name)
      const list = flat(ops)
      list.forEach((op, i) => {
        if (op.t !== 'text' || !op.glyphs.length) return
        const x0 = op.glyphs[0].x
        const x1 = op.glyphs[op.glyphs.length - 1].x + op.size * 0.5
        const cy = op.y - op.size * 0.35
        let under = pal.paper
        let covered = false
        for (const lower of list.slice(0, i)) {
          if (!lower.fill || lower.paint) continue
          const b = boxOf(lower)
          if (!b || x0 < b.x0 - 0.5 || x1 > b.x1 + 0.5 || cy < b.y0 || cy > b.y1) continue
          under = mix(lower.fill, under, lower.opacity ?? 1)
          covered = true
        }
        if (covered && contrast(op.color, under) < 3) bad.push(`${look.id}（${name}）: 「${op.glyphs.map((/** @type {any} */ g) => g.c).join('').slice(0, 12)}」 ${op.color} on ${under} = ${contrast(op.color, under).toFixed(2)}`)
      })
    }
  }
  assert.deepEqual(bad, [])
})

test('metrics を使う試験の道具が読める（looks-kit の書体）', () => {
  assert.ok(metrics)
})
