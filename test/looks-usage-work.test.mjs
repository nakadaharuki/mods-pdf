// @ts-check
// usage の束（gauge・tiles・bullet・progress-rings・waffle・cost-burn）と work の束（heatmap・gantt・calendar-month・timeline）の試験。
// 全部の形に掛ける共通の確かめ（test/looks-kit.mjs の testLook）は test/looks.test.mjs が LOOK_LIST の全部に掛けるので、ここでは重ねない。
// ここは形ごとに「その形の大事な振る舞い」を 1 つ以上。試験名は保証する振る舞いを書く。
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawLook, LOOKS, LOOK_LIST } from '../hooks/engine/looks/index.mjs'
import { toOps, flat, textOf, PALS, MEASURE, CATEGORY_OF } from './looks-kit.mjs'

const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)

const USAGE = ['gauge', 'tiles', 'bullet', 'progress-rings', 'waffle', 'cost-burn']
const WORK = ['heatmap', 'gantt', 'calendar-month', 'timeline']

/** svg の要素（rect・circle・line・path）の属性を { 名前: 値 } にして並べる @param {string} svg @param {string} tag */
function elements(svg, tag) {
  return [...svg.matchAll(new RegExp(`<${tag} ([^>]*?)/?>`, 'g'))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
}

/** 形を描き、後の確かめに要る物をまとめる @param {string} id @param {any} data @param {'mono'|'koma'|'mergeble'} [palName] @param {any} [opts] */
function look(id, data, palName = 'mono', opts = {}) {
  const pal = PALS[palName]
  const r = drawLook(id, data, { width: MEASURE, pal, ...opts })
  const ops = flat(toOps(r, pal).ops)
  const texts = ops.filter((o) => o.t === 'text')
  return {
    r,
    pal,
    texts,
    words: texts.map(textOf),
    /** その字の色（小文字） @param {string} s */
    colorOf: (s) => texts.find((o) => textOf(o) === s)?.color.toLowerCase(),
    rects: elements(r.svg, 'rect').map((e) => ({ x: Number(e.x), y: Number(e.y), w: Number(e.width), h: Number(e.height), fill: e.fill, op: e['fill-opacity'] === undefined ? undefined : Number(e['fill-opacity']), stroke: e.stroke })),
    circles: elements(r.svg, 'circle'),
    /** 日付けの字など、svg の字の x・y（版面の座標）。size で絞る @param {number} size */
    placed: (size) => [...r.svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter((m) => Number(m[3]) === size).map((m) => ({ x: Number(m[1]), y: Number(m[2]), s: m[4] })),
  }
}

// ---------------------------------------------------------------- 束

test('usage の 6 つと work の 4 つは、決まった種類（usage・work）の形として LOOKS に入っている', () => {
  for (const id of USAGE) assert.equal(LOOKS[id]?.category, 'usage', id)
  for (const id of WORK) assert.equal(LOOKS[id]?.category, 'work', id)
  for (const id of [...USAGE, ...WORK]) {
    assert.equal(CATEGORY_OF[id], LOOKS[id].category, id)
    assert.ok(LOOK_LIST.some((l) => l.id === id), id)
  }
})

// ---------------------------------------------------------------- gauge

test('gauge: 60% 未満は up・85% までは accent・85% 超は down の色で、針の読み（数字）が同じ色になる', () => {
  const g = look('gauge', { items: [{ name: 'a', value: 42 }, { name: 'b', value: 71 }, { name: 'c', value: 91 }] }, 'koma')
  assert.equal(g.colorOf('42%'), g.pal.up.toLowerCase())
  assert.equal(g.colorOf('71%'), g.pal.accent.toLowerCase())
  assert.equal(g.colorOf('91%'), g.pal.down.toLowerCase())
})

test('gauge: max が 100 でない時は割合に直して読み、「値 / max」を添える', () => {
  const g = look('gauge', { items: [{ name: 'a', value: 30, max: 200, unit: '台' }] })
  assert.ok(g.words.includes('15%'), g.words.join(' '))
  assert.ok(g.words.includes('30台 / 200台'), g.words.join(' '))
})

// ---------------------------------------------------------------- progress-rings

test('progress-rings: 満ちた輪だけが up の閉じた円と色つきの数字になり、max を渡した輪にだけ「値 / max」が付く', () => {
  const rings = look('progress-rings', LOOKS['progress-rings'].sample(), 'koma')
  assert.equal(rings.colorOf('100%'), rings.pal.up.toLowerCase())
  for (const s of ['82%', '64%', '37%']) assert.equal(rings.colorOf(s), rings.pal.ink.toLowerCase(), s)
  const closed = rings.circles.filter((c) => c.stroke?.toLowerCase() === rings.pal.up.toLowerCase())
  assert.equal(closed.length, 1)
  assert.ok(rings.words.includes('164箱 / 200箱'))
  const bare = look('progress-rings', { items: [{ name: 'a', value: 40 }] })
  assert.deepEqual(bare.words, ['40%', 'a'])
})

// ---------------------------------------------------------------- waffle

test('waffle: 100 マスは最大剰余法で配り（足して必ず 100）、残りは枠だけの空きマスになる', () => {
  const grid = (/** @type {ReturnType<typeof look>} */ w) => w.rects.filter((r) => r.x < 215 && r.y >= 0 && (r.w === 11 || r.w === 10))
  const sample = look('waffle', LOOKS.waffle.sample())
  const filled = grid(sample).filter((r) => r.fill !== 'none')
  const free = grid(sample).filter((r) => r.fill === 'none')
  assert.equal(filled.length, 70)
  assert.equal(free.length, 30)
  assert.equal(filled.filter((r) => r.op === 0.8).length, 7, '最後の項目（今月）だけが目立つ濃さ')
  // 3 等分の total なしは 34・33・33 のように配って、空きは 0
  const thirds = look('waffle', { items: [{ name: 'a', value: 1 }, { name: 'b', value: 1 }, { name: 'c', value: 1 }] })
  assert.equal(grid(thirds).filter((r) => r.fill !== 'none').length, 100)
  assert.equal(grid(thirds).filter((r) => r.fill === 'none').length, 0)
})

// ---------------------------------------------------------------- bullet

test('bullet: 目標に届けば up・最初の範囲より下なら down・その間は ink の色で値を読む', () => {
  const b = look('bullet', LOOKS.bullet.sample(), 'koma')
  assert.equal(b.colorOf('96.4%'), b.pal.up.toLowerCase())
  assert.equal(b.colorOf('58%'), b.pal.down.toLowerCase())
  assert.equal(b.colorOf('71%'), b.pal.ink.toLowerCase())
  assert.ok(b.words.includes('目標 95%'))
})

// ---------------------------------------------------------------- tiles

test('tiles: 前より増えた差は up・減った差は down の色で出て、符号が字に残る（色だけに頼らない）', () => {
  const t = look('tiles', LOOKS.tiles.sample(), 'koma')
  assert.equal(t.colorOf('+2.4%'), t.pal.up.toLowerCase())
  assert.equal(t.colorOf('-4.1%'), t.pal.down.toLowerCase())
  assert.equal(t.colorOf('-0.8pt'), t.pal.down.toLowerCase())
  assert.ok(t.words.includes('1,248万円'))
})

// ---------------------------------------------------------------- cost-burn

test('cost-burn: 見本は累計の傾きから 27 日目に予算を超えると予測し、超えない時は「超過」の字を出さない', () => {
  const over = look('cost-burn', LOOKS['cost-burn'].sample())
  assert.ok(over.words.includes('27 日目に予算超過'), over.words.join(' '))
  assert.ok(over.words.includes('11.80万円'), '月末の予測値')
  const days = Array.from({ length: 31 }, (_, i) => `10/${i + 1}`)
  const under = look('cost-burn', { x: days, actual: [1, 1, 1], budget: 100, unit: '万円' })
  assert.ok(!under.words.some((s) => s.includes('超過')), under.words.join(' '))
})

test('cost-burn: 予算が 0 以下なら警告して、予測も予算の線も描かず「データがありません」だけにする', () => {
  const g = look('cost-burn', { x: ['1', '2'], actual: [1], budget: 0 })
  assert.equal(g.r.warnings.length, 1)
  assert.match(g.r.warnings[0], /budget/)
  assert.deepEqual(g.words, ['データがありません'])
})

// ---------------------------------------------------------------- heatmap

test('heatmap: 濃さは値の最大に対する比で、最後の日は外側の枠で示し、その週の残りの日は枠だけの升になる', () => {
  // 月・火・水の 3 日（水曜が最後の日）。同じ日の値は合計される（10 + 0）
  const h = look('heatmap', { days: [{ date: '2026-10-05', value: 0 }, { date: '2026-10-06', value: 5 }, { date: '2026-10-07', value: 10 }, { date: '2026-10-07', value: 0 }] })
  assert.match(h.r.warnings.join(' '), /合計/)
  const cells = h.rects.filter((r) => r.w === 14 && r.fill !== 'none')
  // 濃さは paper の shade（8% から 85% の直線。hexbin と同じ尺度）
  assert.deepEqual(cells.map((r) => r.op), [0.08, 0.465, 0.85])
  assert.equal(h.rects.filter((r) => r.w === 13 && r.fill === 'none').length, 4, '木〜日の 4 日は枠だけ')
  const today = h.rects.find((r) => r.w === 16)
  assert.ok(today, '今日の外枠')
  near(today?.y ?? NaN, cells[2].y - 1)
})

test('heatmap: 53 週を超える日は古い週から捨てて警告し、月の名前は 1 日を含む週の列の上に置く', () => {
  const day = (/** @type {number} */ i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)
  const h = look('heatmap', { days: Array.from({ length: 800 }, (_, i) => ({ date: day(i), value: i % 9 })) })
  assert.match(h.r.warnings.join(' '), /53/)
  const months = h.words.filter((s) => /^\d+月$/.test(s))
  assert.ok(months.length >= 10 && months.length <= 13, months.join(' '))
})

// ---------------------------------------------------------------- gantt

test('gantt: done の割合だけ濃い棒が伸び、after のあるタスクは前のタスクから肘の線でつながる', () => {
  const g = look('gantt', LOOKS.gantt.sample())
  // 試作（done 0.6）: 薄い全体の棒の上に、幅 0.6 の濃い棒
  const tracks = g.rects.filter((r) => r.h === 8 && r.op === 0.14)
  const bodies = g.rects.filter((r) => r.h === 8 && r.op === 0.55)
  assert.equal(tracks.length, 7, 'タスクは 7 件')
  assert.equal(bodies.length, 5, 'done が 0 の 2 件は濃い棒が無い')
  const trial = tracks.find((t) => bodies.some((b) => b.x === t.x && b.y === t.y && Math.abs(b.w / t.w - 0.6) < 0.01))
  assert.ok(trial, 'done 0.6 の棒')
  const links = elements(g.r.svg, 'path').filter((p) => p['stroke-opacity'] === '0.35' && /H.*V.*H/.test(p.d))
  assert.equal(links.length, 5, 'after は 5 本')
  assert.ok(g.words.includes('今日'))
})

test('gantt: after に無いタスクの名前を書くと警告し、線は引かない', () => {
  const g = look('gantt', { tasks: [{ name: 'a', start: '2026-10-01', end: '2026-10-03' }, { name: 'b', start: '2026-10-04', end: '2026-10-05', after: '存在しない' }] })
  assert.ok(g.r.warnings.length >= 1, '警告')
  assert.equal(elements(g.r.svg, 'path').filter((p) => /H.*V.*H/.test(p.d)).length, 0)
})

// ---------------------------------------------------------------- calendar-month

test('calendar-month: 月曜から始まる格子で、2026-10-01（木）は 4 列目・5 日（月）は次の週の 1 列目に置かれる', () => {
  const c = look('calendar-month', { month: '2026-10', events: [] }, 'koma')
  const at = (/** @type {string} */ s) => /** @type {{ x: number, y: number }} */ (c.placed(8).find((p) => p.s === s))
  assert.ok(at('1').x > at('5').x, '木曜は月曜より右')
  assert.ok(at('4').x > at('1').x, '日曜は木曜より右')
  assert.equal(at('4').y, at('1').y, '同じ週')
  assert.ok(at('5').y > at('1').y, '次の週は下')
  assert.equal(c.colorOf('4'), c.pal.sub.toLowerCase(), '週末の日付は sub')
  assert.equal(c.colorOf('1'), c.pal.ink.toLowerCase(), '平日の日付は ink')
})

test('calendar-month: 同じ日の同じ種類は点が 1 つで件数は凡例に数え、月の外の日付は捨てて警告する', () => {
  const ev = (/** @type {string} */ date, /** @type {string} */ label) => ({ date, label })
  const c = look('calendar-month', { month: '2026-10', events: [ev('2026-10-09', 'A'), ev('2026-10-09', 'A'), ev('2026-10-09', 'B'), ev('2026-11-09', 'B')] })
  assert.match(c.r.warnings.join(' '), /month の外/)
  assert.ok(c.words.includes('A 2') && c.words.includes('B 1') && c.words.includes('3 件'), c.words.join(' '))
  // 升の中の点は 2 つ（A と B の決まった位置）。凡例の点は上の行
  const dots = c.circles.filter((d) => Number(d.cy) > 40)
  assert.equal(dots.length, 2)
  near(Number(dots[1].cx) - Number(dots[0].cx), 7)
})

test('calendar-month: today を渡した日だけ accent の太字の日付と外枠になり、渡さなければ印は無い', () => {
  const c = look('calendar-month', { month: '2026-10', events: [], today: '2026-10-09' }, 'koma')
  assert.equal(c.colorOf('9'), c.pal.accent.toLowerCase())
  const plain = look('calendar-month', { month: '2026-10', events: [] }, 'koma')
  assert.equal(plain.colorOf('9'), plain.pal.ink.toLowerCase())
})

// ---------------------------------------------------------------- timeline

test('timeline: 同じ段で重なる印は別の段に分け、終わりと始まりが接する印は同じ段に並べる', () => {
  const span = (/** @type {string} */ start, /** @type {string} */ end, /** @type {string} */ label) => ({ lane: 'A', start, end, label })
  const t = look('timeline', { spans: [span('10:00', '11:00', 'p'), span('10:30', '11:30', 'q'), span('11:30', '12:00', 'r')] })
  const bars = t.rects.filter((r) => r.h === 9).sort((a, b) => a.x - b.x)
  assert.equal(bars.length, 3)
  const [p, q, r] = bars
  assert.notEqual(p.y, q.y, '重なる p と q は別の段')
  assert.equal(p.y, r.y, '11:30 に始まる r は p と同じ段')
})

test('timeline: highlight の印は目立つ棒・破線の縦線・太字の ink にし、見本の長さは 1時間6分', () => {
  const t = look('timeline', LOOKS.timeline.sample())
  assert.ok(t.words.includes('1時間6分'))
  const dashed = elements(t.r.svg, 'line').filter((l) => l['stroke-dasharray'] === '3 3')
  assert.equal(dashed.length, 1)
  assert.ok(t.rects.some((r) => r.h === 9 && r.op === 0.8), '目立つ棒')
  assert.match(t.r.svg, /font-weight="bold"[^>]*>復旧を確認</, '見出しの印の字は太字')
})

test('timeline: 日付の印と時刻の印を混ぜると最初の印の種類に揃えて捨て、警告する', () => {
  const t = look('timeline', { spans: [{ start: '10:00', end: '11:00', label: 'x' }, { start: '2026-10-01', end: '2026-10-02', label: 'y' }] })
  assert.match(t.r.warnings.join(' '), /種類/)
})
