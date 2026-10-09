// ECharts の option → Op の試験。ECharts 本体（vendor）を実際に動かす。metrics は作り物。
import test from 'node:test'
import assert from 'node:assert/strict'
import { chartToOps } from '../hooks/engine/chart.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'

const font = { upm: 1000, ascent: 0.88, descent: -0.12, adv: (cp) => (cp > 0x2e7f ? 1 : 0.55), has: () => true, run: () => ({ width: 0, xs: [] }) }
const metrics = { sans: font, sansBold: font, mincho: font, minchoBold: font }
const theme = makeTheme({})
const RECT = { x: 40, y: 100, width: 480, height: 240 }
const OPTS = { ...RECT, metrics, theme }

const MONTHS = ['1月', '2月', '3月']
const bar = () => ({ xAxis: { type: 'category', data: MONTHS }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3, 5, 2] }] })
const line = () => ({ xAxis: { type: 'category', data: MONTHS }, yAxis: { type: 'value' }, series: [{ type: 'line', smooth: true, data: [3, 5, 2], areaStyle: {} }] })
const pie = () => ({ legend: {}, series: [{ type: 'pie', data: [{ name: '1月', value: 3 }, { name: '2月', value: 5 }, { name: '東京', value: 2 }] }] })

const flat = (ops) => ops.flatMap((o) => (o.t === 'clip' ? [o, ...flat(o.ops)] : [o]))
const textsOf = (ops) => flat(ops).filter((o) => o.t === 'text')
const stringOf = (op) => op.glyphs.map((g) => g.c).join('')
const pairs = (d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  const out = []
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]])
  return out
}

for (const [name, make] of [['棒', bar], ['折れ線', line], ['円', pie]]) {
  test(`${name}グラフは空でない Op を返し、全体が渡した四角の ClipOp 1 つに包まれる`, () => {
    const r = chartToOps(make(), OPTS)
    assert.equal(r.ops.length, 1)
    const clip = r.ops[0]
    assert.deepEqual([clip.t, clip.x, clip.y, clip.w, clip.h], ['clip', RECT.x, RECT.y, RECT.width, RECT.height])
    assert.ok(clip.ops.length > 3)
    assert.deepEqual(r.warnings, [])
  })

  test(`${name}グラフの Op はどれも渡した四角の中にある`, () => {
    const r = chartToOps(make(), OPTS)
    const x0 = RECT.x - 0.5
    const x1 = RECT.x + RECT.width + 0.5
    const y0 = RECT.y - 0.5
    const y1 = RECT.y + RECT.height + 0.5
    for (const op of flat(r.ops)) {
      if (op.t === 'path') {
        for (const [x, y] of pairs(op.d)) assert.ok(x >= x0 && x <= x1 && y >= y0 && y <= y1, `${op.d} の (${x}, ${y}) が四角の外`)
      } else if (op.t === 'text') {
        assert.ok(op.y >= y0 && op.y <= y1, `字の y ${op.y}`)
        for (const g of op.glyphs) assert.ok(g.x >= x0 && g.x <= x1, `字 ${g.c} の x ${g.x}`)
      }
    }
  })
}

test('棒・折れ線・円のどれでも、字の Op に 1月 が入る（軸の目盛りか凡例の項目名）', () => {
  for (const make of [bar, line, pie]) {
    const strings = textsOf(chartToOps(make(), OPTS).ops).map(stringOf)
    assert.ok(strings.includes('1月'), strings.join(','))
  }
})

test('棒グラフの軸には全ての月が並び、円グラフの凡例には全ての項目名が並ぶ', () => {
  const bars = textsOf(chartToOps(bar(), OPTS).ops).map(stringOf)
  for (const m of MONTHS) assert.ok(bars.includes(m), m)
  const pies = textsOf(chartToOps(pie(), OPTS).ops).map(stringOf)
  for (const n of ['1月', '2月', '東京']) assert.ok(pies.includes(n), n)
})

test('半透明の字は theme.colors.paper の色に混ぜる', () => {
  const mergeble = makeTheme({ theme: 'mergeble' })
  const faint = { ...bar(), xAxis: { type: 'category', data: MONTHS, axisLabel: { color: 'rgba(0,0,0,0.5)' } } }
  const labels = textsOf(chartToOps(faint, { ...OPTS, theme: mergeble }).ops).filter((t) => stringOf(t).endsWith('月'))
  // 黒の 50% を #FAF9F7 に混ぜた色（成分は 125・124.5・123.5 を丸めて 0x7D・0x7D・0x7C）
  assert.deepEqual(labels.map((t) => t.color), ['#7D7D7C', '#7D7D7C', '#7D7D7C'])
})

test('字は全て 7pt 以上で、既定は 8pt・書体は sans', () => {
  for (const make of [bar, line, pie]) {
    const texts = textsOf(chartToOps(make(), OPTS).ops)
    assert.ok(texts.length > 0)
    for (const t of texts) {
      assert.ok(t.size >= 7, `${stringOf(t)} が ${t.size}pt`)
      assert.ok(t.font === 'sans' || t.font === 'sansBold')
    }
  }
  assert.ok(textsOf(chartToOps(bar(), OPTS).ops).every((t) => t.size === 8))
})

test('色の列が無ければ mono の黒と灰の列になり、利用者の color が勝つ', () => {
  const fills = (o) => flat(chartToOps(o, OPTS).ops).filter((p) => p.t === 'path' && p.fill).map((p) => p.fill)
  assert.ok(fills(bar()).includes('#111111'))
  const red = { ...bar(), color: ['#ff0000'] }
  assert.ok(fills(red).includes('#FF0000'))
  assert.ok(!fills(red).includes('#111111'))
  const two = { ...bar(), series: [{ type: 'bar', data: [1, 2, 3] }, { type: 'bar', data: [3, 2, 1] }] }
  const set = new Set(fills(two))
  assert.ok(set.has('#111111') && set.has('#6B6B6B'), [...set].join(','))
})

test('字の色は theme.colors.ink（軸の目盛りは sub）。利用者の textStyle が勝つ', () => {
  const koma = makeTheme({ theme: 'koma' })
  const withLegend = { ...pie() }
  const colors = new Set(textsOf(chartToOps(withLegend, { ...OPTS, theme: koma }).ops).map((t) => t.color))
  assert.ok(colors.has(koma.colors.ink.toUpperCase()), [...colors].join(','))
  const mine = textsOf(chartToOps({ ...bar(), textStyle: { color: '#ff0000' }, xAxis: { type: 'category', data: MONTHS, axisLabel: { color: '#00ff00' } } }, OPTS).ops)
  const xs = mine.filter((t) => stringOf(t).endsWith('月'))
  assert.ok(xs.length === 3 && xs.every((t) => t.color === '#00FF00'))
})

test('背景は塗らず、補助線は rule の色で、軸の線と目盛りの刻みは引かない', () => {
  const paths = flat(chartToOps(bar(), OPTS).ops).filter((o) => o.t === 'path')
  assert.ok(paths.some((p) => p.stroke === theme.colors.rule.toUpperCase()))
  assert.ok(!paths.some((p) => p.stroke === theme.colors.sub.toUpperCase()), '軸の線か目盛りの刻みが sub の色で引かれている')
  // 四角全面を覆う塗りが無い
  assert.ok(!paths.some((p) => p.fill && /^M 40 100 L 520 100/.test(p.d)))
})

test('渡した option を書き換えない（凍結した option でも投げない）', () => {
  const deepFreeze = (o) => { Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v)); return Object.freeze(o) }
  const option = deepFreeze(bar())
  const before = JSON.stringify(option)
  const r = chartToOps(option, OPTS)
  assert.equal(JSON.stringify(option), before)
  assert.ok(r.ops.length > 0)
  assert.equal(option.animation, undefined)
  assert.equal(option.textStyle, undefined)
})

test('四角の位置が違っても、同じ図が x と y の分だけずれる', () => {
  const a = chartToOps(bar(), { ...OPTS, x: 0, y: 0 })
  const b = chartToOps(bar(), { ...OPTS, x: 40, y: 100 })
  const firstPath = (r) => flat(r.ops).find((o) => o.t === 'path').d
  const [ax, ay] = pairs(firstPath(a))[0]
  const [bx, by] = pairs(firstPath(b))[0]
  assert.ok(Math.abs(bx - ax - 40) < 0.01 && Math.abs(by - ay - 100) < 0.01)
})

test('小数の大きさでも、四角に 1:1 に近い縮尺で写る', () => {
  const r = chartToOps(bar(), { ...OPTS, x: 0, y: 0, width: 300.4, height: 150.6 })
  assert.equal(r.ops[0].w, 300.4)
  for (const op of flat(r.ops)) if (op.t === 'path') for (const [x, y] of pairs(op.d)) assert.ok(x <= 301 && y <= 151.5)
})

test('描けない option は ops が空で警告を返し、投げない', () => {
  for (const bad of [null, 'text', 42, [], { series: [{ type: 'nonexistent' }] }, {}]) {
    const r = chartToOps(/** @type {any} */ (bad), OPTS)
    assert.deepEqual(r.ops, [], JSON.stringify(bad))
    assert.ok(r.warnings.length > 0, JSON.stringify(bad))
  }
  assert.ok(chartToOps(bar(), { ...OPTS, width: 0 }).warnings.length > 0)
})

test('ECharts の hover 用の style 要素の警告は出さない', () => {
  assert.equal(chartToOps(bar(), OPTS).warnings.filter((w) => w.includes('style')).length, 0)
})

test('theme が無くても既定の色で描く', () => {
  const r = chartToOps(bar(), { ...RECT, metrics })
  assert.ok(r.ops.length === 1 && r.ops[0].ops.length > 3)
})

test('面グラフの塗りは系列色が下へ向けて透明になる勾配で、利用者の不透明度が勝つ', () => {
  const area = (o, t = OPTS) => flat(chartToOps(o, t).ops).find((p) => p.t === 'path' && p.fill && (p.paint || p.opacity !== undefined) && p.d.includes('C'))
  const a = area(line())
  assert.equal(a.paint.kind, 'linear')
  assert.equal(a.paint.y1 < a.paint.y2, true, '上から下へ向かう')
  assert.equal(a.paint.stops.length, 2)
  assert.ok(a.paint.stops[0].opacity > 0.1 && a.paint.stops[0].opacity < 0.3, `上の濃さ ${a.paint.stops[0].opacity}`)
  assert.equal(a.paint.stops[1].opacity, 0)
  assert.equal(a.opacity, undefined, 'ECharts の面の既定の 0.7 を掛けない')
  const mine = line()
  mine.series[0].areaStyle = { opacity: 0.5 }
  assert.equal(area(mine).opacity, 0.5)
  assert.equal(area(mine).paint, undefined)
  const stacked = line()
  stacked.series[0].stack = 's'
  assert.equal(area(stacked).opacity, 0.15, '積み上げた面は重なるので平らな薄い塗り')
})

test('本文が大きい文書（theme.scale > 1）では軸の字も同じ比で大きくなり、9.5pt 以下では 8pt のまま', () => {
  const axisSize = (t) => {
    const strings = textsOf(chartToOps(bar(), { ...RECT, metrics, theme: t }).ops)
    return strings.find((o) => stringOf(o) === '1月').size
  }
  const base = axisSize(makeTheme({}))
  assert.ok(Math.abs(base - 8) < 0.01, `既定の字 ${base}pt`)
  assert.equal(axisSize(makeTheme({ size: 8 })), base)
  const big = makeTheme({ size: 12.5 })
  assert.ok(Math.abs(axisSize(big) - 8 * big.scale) < 0.01, `本文 12.5pt のグラフの字 ${axisSize(big)}pt`)
})

// ---- look に合わせた既定（余白・値の字・系列の色・棒と円と凡例の形）

const hbar = () => ({ xAxis: { type: 'value' }, yAxis: { type: 'category', data: ['A社', 'B社', 'C社'] }, series: [{ type: 'bar', data: [3, 5, 2] }] })
const twoBars = () => ({ legend: {}, xAxis: { type: 'category', data: MONTHS }, yAxis: { type: 'value' }, series: [{ name: '売上', type: 'bar', data: [3, 5, 2] }, { name: '費用', type: 'bar', data: [1, 2, 3] }] })
const paths = (ops) => flat(ops).filter((o) => o.t === 'path')
const firstX = (t) => t.glyphs[0].x
const bbox = (d) => {
  const p = pairs(d)
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

test('グラフは渡した四角いっぱいに描き、補助線は 0.5pt の rule の色で四角の幅近くまで引く', () => {
  const lines = paths(chartToOps(bar(), OPTS).ops).filter((p) => p.stroke === theme.colors.rule.toUpperCase())
  assert.ok(lines.length >= 4, `補助線 ${lines.length} 本`)
  for (const p of lines) {
    assert.equal(p.lw, 0.5)
    const xs = pairs(p.d).map((q) => q[0])
    assert.ok(Math.min(...xs) <= RECT.x + 8, `左端 ${Math.min(...xs)}`)
    assert.ok(Math.max(...xs) >= RECT.x + RECT.width - 28, `右端 ${Math.max(...xs)}`)
  }
})

test('値の字は右の余白に置き、横棒の名前（カテゴリ軸）は左のまま', () => {
  const right = RECT.x + RECT.width * 0.9
  const left = RECT.x + RECT.width * 0.1
  const column = textsOf(chartToOps(bar(), OPTS).ops).filter((t) => /^\d+$/.test(stringOf(t)))
  assert.ok(column.length >= 4)
  assert.ok(column.every((t) => firstX(t) > right), column.map(firstX).join(','))
  const row = textsOf(chartToOps(hbar(), OPTS).ops).filter((t) => stringOf(t).endsWith('社'))
  assert.equal(row.length, 3)
  assert.ok(row.every((t) => firstX(t) < left), row.map(firstX).join(','))
})

test('利用者が grid か yAxis.position を書けばそれが勝つ', () => {
  const myGrid = { ...bar(), grid: { left: 100, right: 100, top: 20, bottom: 30 } }
  const lines = paths(chartToOps(myGrid, OPTS).ops).filter((p) => p.stroke === theme.colors.rule.toUpperCase())
  assert.ok(lines.every((p) => Math.min(...pairs(p.d).map((q) => q[0])) >= RECT.x + 99), '左の余白 100')
  const mine = { ...bar(), yAxis: { type: 'value', position: 'left' } }
  const nums = textsOf(chartToOps(mine, OPTS).ops).filter((t) => /^\d+$/.test(stringOf(t)))
  assert.ok(nums.length >= 4 && nums.every((t) => firstX(t) < RECT.x + RECT.width * 0.2), nums.map(firstX).join(','))
})

test('利用者が axisLine を書いた軸は、その色の線を引く', () => {
  const mine = { ...bar(), yAxis: { type: 'value', axisLine: { lineStyle: { color: '#ff0000' } } } }
  assert.ok(paths(chartToOps(mine, OPTS).ops).some((p) => p.stroke === '#FF0000' && p.fill === undefined))
})

test('系列の色は mono では墨の濃さ、色のある theme では accent → accent2 の順', () => {
  const fills = (o, t) => paths(chartToOps(o, { ...OPTS, theme: makeTheme({ theme: t }) }).ops).filter((p) => p.fill).map((p) => p.fill)
  const mono = new Set(fills(twoBars(), 'mono'))
  assert.ok(mono.has('#111111') && mono.has('#6B6B6B'), [...mono].join(','))
  const vivid = makeTheme({ theme: 'vivid' })
  const set = new Set(fills(twoBars(), 'vivid'))
  assert.ok(set.has(vivid.colors.accent.toUpperCase()) && set.has(vivid.colors.accent2.toUpperCase()), [...set].join(','))
  assert.ok(!set.has('#111111'))
})

test('棒は幅 40pt を超えず、重ねない棒は上の角だけ丸く、積み上げは四角のまま', () => {
  const one = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3] }] }
  const barPath = paths(chartToOps(one, OPTS).ops).find((p) => p.fill)
  assert.ok(bbox(barPath.d).w <= 40.01, `棒の幅 ${bbox(barPath.d).w}`)
  assert.ok(barPath.d.includes('C'), '上の角が丸い')
  const stacked = { xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', stack: 's', data: [3, 5] }, { type: 'bar', stack: 's', data: [3, 5] }] }
  const bars = paths(chartToOps(stacked, OPTS).ops).filter((p) => p.fill)
  assert.equal(bars.length, 4)
  assert.ok(bars.every((p) => !p.d.includes('C')), '積み上げの棒は角を丸めない')
})

test('凡例の印は 8pt ほどの丸で、系列の色になる', () => {
  const vivid = makeTheme({ theme: 'vivid' })
  const marks = paths(chartToOps(twoBars(), { ...OPTS, theme: vivid }).ops).filter((p) => p.fill && !p.d.includes('L'))
  assert.equal(marks.length, 2)
  assert.deepEqual(marks.map((p) => p.fill), [vivid.colors.accent.toUpperCase(), vivid.colors.accent2.toUpperCase()])
  for (const m of marks) assert.ok(bbox(m.d).w <= 10 && bbox(m.d).h <= 10, m.d)
  const names = textsOf(chartToOps(twoBars(), OPTS).ops).map(stringOf)
  assert.ok(names.includes('売上') && names.includes('費用'))
})

test('円グラフの切れ目は紙の色の線で、字は sub、引き出し線は rule の色', () => {
  const vivid = makeTheme({ theme: 'vivid' })
  const ps = paths(chartToOps(pie(), { ...OPTS, theme: vivid }).ops)
  const slices = ps.filter((p) => p.fill && p.stroke === vivid.colors.paper.toUpperCase() && p.d.includes('C'))
  assert.ok(slices.length >= 3, `切れ目の線を持つ扇 ${slices.length}`)
  assert.ok(ps.some((p) => p.fill === undefined && p.stroke === vivid.colors.rule.toUpperCase()), '引き出し線')
  const label = textsOf(chartToOps(pie(), { ...OPTS, theme: vivid }).ops).find((t) => stringOf(t) === '東京')
  assert.equal(label.color, vivid.colors.sub.toUpperCase())
})

test('図の中の字は、既定でも本文が小さい文書でも 7.5pt 以上', () => {
  for (const t of [makeTheme({}), makeTheme({ size: 8 }), makeTheme({ theme: 'vivid' })]) {
    for (const make of [bar, line, pie, hbar, twoBars]) {
      for (const op of textsOf(chartToOps(make(), { ...OPTS, theme: t }).ops)) assert.ok(op.size >= 7.5, `${stringOf(op)} ${op.size}pt`)
    }
  }
})

test('面グラフの勾配は系列の色で、上端の不透明度が 0 より大きい', () => {
  const vivid = makeTheme({ theme: 'vivid' })
  const a = paths(chartToOps(line(), { ...OPTS, theme: vivid }).ops).find((p) => p.paint)
  assert.ok(a, '勾配の面がある')
  assert.ok(a.paint.stops.every((s) => s.color === vivid.colors.accent.toUpperCase()))
  assert.ok(a.paint.stops[0].opacity > 0 && a.paint.stops[1].opacity === 0)
})
