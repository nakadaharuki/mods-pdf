// @ts-check
// 図の形（looks）の試験: 事業計画の 13 形（biz。market・matrix2x2・cycle・process・pyramid・milestones・org・venn・mekko・compare-table・flowchart・kpi-hero・pnl）と、
// 資料の回に paper へ足した道具（accent2・grad・paints・wrap の寡婦・readNamed・hotIndex）。
// 全部の形に共通の確かめは test/looks-kit.mjs の testLook（mono・koma・mergeble の 3 つの紙）。ここでは資料の紙（vivid: accent と違う 3 色のグラデーション）で、
// 色と字の大きさと「グラデーションは目立たせる 1 つと面だけ」を 13 形に掛け、そのあとに形ごとの大事な振る舞いを確かめる。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawLook, LOOKS, LOOK_LIST } from '../hooks/engine/looks/index.mjs'
import * as P from '../hooks/engine/looks/paper.mjs'
import { testLook, toOps, flat, textOf, colorsOf, sizesOf, PALS, MEASURE, BIZ_OF, BIZ_NOTE } from './looks-kit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'hooks/engine/looks')
const IDS = Object.keys(BIZ_OF)
const MONO = PALS.mono
/** 資料の紙（docs/deck.md の vivid）: accent・accent2 と、3 色のグラデーション */
const VIVID = Object.freeze({
  ink: '#15131D', sub: '#4B4858', rule: '#DCD9E3', tint: '#F4F2F8', accent: '#6A3DE8', accent2: '#F0562E', up: '#157F3B', down: '#C0261E', paper: '#FFFFFF', grad: ['#3B2FD9', '#A12BD6', '#F2542D'],
})
const NOTE = '（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）'
for (const id of IDS) testLook(id)

// ---------------------------------------------------------------- 道具

/** @param {string} svg @param {string} name @returns {Record<string, string>[]} */
function tagsOf(svg, name) {
  return [...svg.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'g'))].map((m) => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
}
/** @param {string} svg @returns {{ x: number, y: number, s: string, size: number, fill: string, anchor: string, bold: boolean }[]} */
function textsOf(svg) {
  return [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((p) => [p[1], p[2]]))
    return { x: Number(a.x), y: Number(a.y), s: m[2].replace(/&amp;/g, '&'), size: Number(a['font-size']), fill: a.fill, anchor: a['text-anchor'] ?? 'start', bold: a['font-weight'] === 'bold' }
  })
}
/** 字の枠が重なる字の組 @param {ReturnType<typeof textsOf>} texts */
function collisions(texts) {
  const box = (/** @type {ReturnType<typeof textsOf>[number]} */ t) => {
    const w = P.textWidth(t.s, t.size, t.bold)
    const x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x
    return [x0, t.y - t.size * 0.8, x0 + w, t.y + t.size * 0.2]
  }
  /** @type {string[]} */
  const out = []
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = box(texts[i])
      const b = box(texts[j])
      if (a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01) out.push(`${texts[i].s}|${texts[j].s}`)
    }
  }
  return out
}
const draw = (/** @type {string} */ id, /** @type {unknown} */ data, opts = {}) => drawLook(id, data, { width: MEASURE, pal: VIVID, ...opts })
const norm = (/** @type {string} */ id, /** @type {unknown} */ data) => LOOKS[id].normalize(data)
const sample = (/** @type {string} */ id) => LOOKS[id].sample()
const near = (/** @type {number} */ a, /** @type {number} */ b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} と ${b} が ${eps} 以内でない`)
const empties = (/** @type {{ svg: string, warnings: string[] }} */ r) => r.svg.includes('データがありません')
const textOfName = (/** @type {string} */ svg, /** @type {string} */ s) => textsOf(svg).find((t) => t.s === s)

// ---------------------------------------------------------------- 13 形の並びと出典

test('biz の 13 形は docs/deck.md の 6 章の表と同じ id の並びで、種類は biz', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/deck.md'), 'utf8')
  const sec = doc.split(/^## /m).find((s) => s.startsWith('6.')) ?? ''
  const ids = [...sec.matchAll(/^\| ([\w-]+) \|/gm)].map((m) => m[1]).filter((id) => id !== 'id')
  assert.deepEqual(LOOK_LIST.filter((l) => l.category === 'biz').map((l) => l.id), ids)
  assert.equal(ids.length, 13)
  assert.deepEqual(ids, IDS)
})

test('biz の形のファイルは、頭に「ModsPDF の形」の行と look の決まりの出典があり、biz.mjs の束に入っている', () => {
  const bundle = fs.readFileSync(path.join(DIR, 'biz.mjs'), 'utf8')
  for (const id of IDS) {
    const src = fs.readFileSync(path.join(DIR, `${id}.mjs`), 'utf8')
    const head = src.slice(0, src.search(/^(?:import|export) /m))
    assert.ok(head.includes(BIZ_NOTE) && head.includes(NOTE), `${id}.mjs の頭に出典が無い`)
    assert.match(head, /選ばなかった案/, `${id}.mjs の頭に選ばなかった案が無い`)
    assert.ok(bundle.includes(`./${id}.mjs`), `${id}.mjs が biz.mjs に無い`)
  }
})

// ---------------------------------------------------------------- 資料の紙（vivid）で 13 形に掛ける確かめ

for (const id of IDS) {
  test(`${id}: 資料の紙で、色は pal（グラデーションの止まりを含む）だけ・字の色は ink・sub・accent・up・down だけ・字の大きさは 7.5・8・14・20・32 だけ`, () => {
    const r = draw(id, sample(id))
    assert.deepEqual(r.warnings, [])
    const { ops, warnings } = toOps(r, VIVID)
    assert.deepEqual(warnings, [])
    const allowed = new Set(Object.values(VIVID).flat().map((c) => c.toLowerCase()))
    for (const c of colorsOf(ops)) assert.ok(allowed.has(c), `${c} は pal の色でない`)
    const textOk = new Set(['ink', 'sub', 'accent', 'up', 'down'].map((k) => /** @type {any} */ (VIVID)[k].toLowerCase()))
    for (const t of flat(ops).filter((o) => o.t === 'text')) assert.ok(textOk.has(t.color.toLowerCase()), `「${textOf(t)}」の色 ${t.color}`)
    for (const s of sizesOf(ops)) assert.ok([7.5, 8, 14, 20, 32].includes(s), `字の大きさ ${s}`)
  })

  test(`${id}: 太字は 8pt 以下だけ・32pt の大きな数は kpi-hero だけ`, () => {
    const ts = textsOf(draw(id, sample(id)).svg)
    for (const t of ts) if (t.bold) assert.ok(t.size <= 8, `「${t.s}」の太字が ${t.size}pt`)
    assert.equal(ts.some((t) => t.size === P.HERO), id === 'kpi-hero')
  })

  test(`${id}: 資料の紙ではグラデーションの面が入り（目立たせる 1 つと面）、mono の紙では 1 つも入らず単色になる`, () => {
    const vivid = draw(id, sample(id))
    assert.match(vivid.svg, /<linearGradient|<radialGradient/)
    assert.ok(flat(toOps(vivid, VIVID).ops).some((o) => o.paint), 'Op にグラデーションが無い')
    const mono = draw(id, sample(id), { pal: MONO })
    assert.doesNotMatch(mono.svg, /Gradient/)
    // グラデーションの止まりは pal.grad の色だけ
    for (const c of vivid.svg.matchAll(/stop-color="([^"]+)"/g)) assert.ok(VIVID.grad.includes(c[1]), c[1])
  })

  test(`${id}: 英語（lang en）でも、幅 300・500・751 のどれでも警告なしで描け、描く物が高さに収まる`, () => {
    for (const width of [300, 500, 751]) {
      const r = draw(id, sample(id), { width, lang: 'en' })
      assert.deepEqual(r.warnings, [], `幅 ${width}`)
      const { ops } = toOps(r, VIVID)
      assert.notEqual(ops[0].t, 'clip', `幅 ${width} ではみ出した`)
    }
  })
}

// ---------------------------------------------------------------- paper に足した資料向けの道具

test('cleanPal は accent2 と grad（2〜8 個の色）を通し、読めない値は mono に戻す。mono の 43 形の絵（色）は変えない', () => {
  assert.deepEqual(P.cleanPal({}), { ...P.MONO, grad: [...P.MONO.grad] })
  const v = P.cleanPal(VIVID)
  assert.equal(v.accent2, '#F0562E')
  assert.deepEqual(v.grad, VIVID.grad)
  assert.deepEqual(P.cleanPal({ grad: ['#fff'] }).grad, P.MONO.grad, '止まりが 1 つの grad は使わない')
  assert.deepEqual(P.cleanPal({ grad: ['#111111', 'red'] }).grad, P.MONO.grad, '色でない止まりがあれば使わない')
  assert.deepEqual(P.cleanPal({ grad: Array.from({ length: 9 }, () => '#111111') }).grad, P.MONO.grad, '9 個以上は使わない')
  assert.equal(P.cleanPal({ accent2: 'javascript:1' }).accent2, P.MONO.accent2)
  assert.deepEqual(PALS.mono.grad, [...P.MONO.grad], 'mono の MONO は theme.mjs の mono と同じ止まり')
  assert.equal(PALS.mono.accent2, P.MONO.accent2)
})

test('paints は、止まりが 2 色以上違う紙では url の塗りと <defs> を作り（番号は 1 から数えて同じ入力で同じ）、mono では単色の塗りを返して <defs> を作らない', () => {
  const a = P.paints(VIVID)
  const f1 = a.linear(0, 0, 10, 0, 0.5)
  const f2 = a.radial(5, 5, 4)
  assert.match(f1, /fill="url\(#g1\)" fill-opacity="0.5"/)
  assert.match(f2, /fill="url\(#g2\)"/)
  const d = a.defs()
  assert.equal([...d.matchAll(/<stop /g)].length, 6)
  assert.ok(d.includes('gradientUnits="userSpaceOnUse"'))
  assert.equal(P.paints(VIVID).linear(0, 0, 10, 0), P.paints(VIVID).linear(0, 0, 10, 0))
  assert.equal(P.paints(VIVID, 'h').linear(0, 0, 1, 0).includes('#h1'), true, 'prefix を替えられる')
  const m = P.paints(PALS.mono)
  assert.equal(m.on, false)
  assert.match(m.linear(0, 0, 10, 0, 1, 1), /^fill="#111111"$/)
  assert.equal(m.defs(), '')
  assert.equal(P.gradStops(PALS.mono), null)
  assert.deepEqual(P.gradStops(VIVID), VIVID.grad)
})

test('wrap は、最後の行が 1〜2 字だけになる時に前の行の字を送って 3 字にし、行頭に「、」「。」を置かず、語の途中を割らない', () => {
  const lines = P.wrap('請求と入金の確認に、毎月 20 時間かかっている', P.TICK, 150, 3)
  assert.ok(lines.length >= 2)
  for (const l of lines) assert.ok(!/^[、。）」]/.test(l), l)
  assert.ok(Array.from(lines[lines.length - 1]).length >= 3, lines.join('|'))
  assert.equal(lines.join('').replace(/\s/g, ''), '請求と入金の確認に、毎月20時間かかっている')
  // 英語の語は割らない
  for (const l of P.wrap('revenue growth planning notes', P.TICK, 60, 5)) assert.ok(!/\bgrowt$|\brevenu$/.test(l), l)
  assert.deepEqual(P.wrap('', P.TICK, 100), [])
  assert.deepEqual(P.wrap('あ', P.TICK, 0), [])
  // 行数を超えたら最後の行を「…」で切る
  const cut = P.wrap('あ'.repeat(60), P.TICK, 40, 2)
  assert.equal(cut.length, 2)
  assert.ok(cut[1].endsWith('…'))
})

test('readNamed は名前の無い行を捨て・最大を超えた行を捨て・最小に満たなければ空にして、そのたびに warnings に書く。字だけの行は名前になる', () => {
  /** @type {string[]} */
  const w = []
  assert.deepEqual(P.readNamed([{ name: 'a', note: 'x' }, 'b', { note: 'n' }, 3, null], '段', 'steps', w, { min: 2, max: 3 }), [{ name: 'a', note: 'x' }, { name: 'b', note: '' }, { name: '3', note: '' }])
  assert.ok(w.some((m) => m.includes('名前の読めない行 2 個')), w.join('|'))
  /** @type {string[]} */
  const w2 = []
  assert.deepEqual(P.readNamed(['a'], '段', 'steps', w2, { min: 2 }), [])
  assert.ok(w2.some((m) => m.includes('2 個以上')))
  /** @type {string[]} */
  const w3 = []
  assert.deepEqual(P.readNamed('x', '段', 'steps', w3), [])
  assert.ok(w3.some((m) => m.includes('がありません')))
  /** @type {string[]} */
  const w4 = []
  assert.equal(P.readNamed(['a', 'b', 'c', 'd'], '段', 'steps', w4, { max: 3 }).length, 3)
  assert.ok(w4.some((m) => m.includes('1 個を捨てました')))
})

test('hotIndex は名前か 0 からの位置で目立たせる 1 つを選び、範囲外・無い名前は fallback に戻して warnings に書く', () => {
  /** @type {string[]} */
  const w = []
  assert.equal(P.hotIndex('b', ['a', 'b'], 0, w, '段'), 1)
  assert.equal(P.hotIndex(0, ['a', 'b'], 1, w, '段'), 0)
  assert.equal(P.hotIndex(undefined, ['a', 'b'], 1, w, '段'), 1)
  assert.deepEqual(w, [])
  assert.equal(P.hotIndex('zzz', ['a', 'b'], 1, w, '段'), 1)
  assert.equal(P.hotIndex(9, ['a', 'b'], 1, w, '段'), 1)
  assert.equal(P.hotIndex(-1, ['a', 'b'], 0, w, '段'), 0)
  assert.equal(w.length, 3)
})

// ---------------------------------------------------------------- market

test('market: 値が大きい順でなければ大きい順に直して warnings に書き、1 つしか無ければ描かない', () => {
  const r = norm('market', { items: [{ name: '取る', value: 10 }, { name: '全体', value: 100 }, { name: '狙う', value: 40 }] })
  assert.deepEqual(r.data.items.map((/** @type {any} */ i) => i.name), ['全体', '狙う', '取る'])
  assert.ok(r.warnings.some((m) => m.includes('大きい順')))
  const one = draw('market', { items: [{ name: '全体', value: 100 }] })
  assert.ok(empties(one))
  assert.ok(one.warnings.some((m) => m.includes('2 個以上')))
})

test('market: 内側の円が点にならないよう半径に下限を置いた時だけ、図の下に「円の大きさは目安です」と書く', () => {
  assert.ok(textOfName(draw('market', sample('market')).svg, '円の大きさは目安です（面積の比ではありません）'))
  const flatData = { items: [{ name: 'A', value: 100 }, { name: 'B', value: 90 }, { name: 'C', value: 80 }] }
  assert.equal(textsOf(draw('market', flatData).svg).some((t) => t.s.includes('目安')), false)
})

test('market: 目立たせるのは一番内側の円（SOM）だけで、グラデーションは 1 つ。値は右の列に 20pt で置き、全体に対する割合を書く', () => {
  const r = draw('market', sample('market'))
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 1)
  const ts = textsOf(r.svg)
  assert.equal(ts.filter((t) => t.size === P.HUGE).length, 3)
  assert.ok(ts.some((t) => t.s === '全体の 25%'), '3,100 / 12,400 = 25%')
  assert.ok(ts.some((t) => t.s === '全体の 2.5%'), '310 / 12,400 = 2.5%')
  const som = ts.find((t) => t.s.startsWith('SOM'))
  assert.equal(som?.fill, VIVID.accent)
})

// ---------------------------------------------------------------- matrix2x2

test('matrix2x2: x・y が 0〜1 の外の点は端に寄せて warnings に書き、名前か座標の読めない点は捨てる。self は 1 つだけ', () => {
  const r = norm('matrix2x2', { x: ['低', '高'], y: ['低', '高'], points: [{ name: 'A', x: 1.5, y: -2 }, { name: '', x: 0.5, y: 0.5 }, { name: 'B', x: 'x', y: 0.5 }, { name: 'S1', x: 0.2, y: 0.2, self: true }, { name: 'S2', x: 0.3, y: 0.3, self: true }] })
  assert.deepEqual(r.data.points.map((/** @type {any} */ p) => [p.name, p.x, p.y, p.self]), [['A', 1, 0, false], ['S1', 0.2, 0.2, true], ['S2', 0.3, 0.3, false]])
  assert.ok(r.warnings.some((m) => m.includes('端に寄せ')))
  assert.ok(r.warnings.some((m) => m.includes('読めない点 2 個')))
})

test('matrix2x2: 自社の点は accent の太字の名前と、色のある紙ではグラデーションの丸・その象限だけの薄い地を持つ。点の名前どうしは重ならない', () => {
  const r = draw('matrix2x2', sample('matrix2x2'))
  const self = textOfName(r.svg, '自社')
  assert.equal(self?.fill, VIVID.accent)
  assert.equal(self?.bold, true)
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 2, '自社の丸と、自社の象限の地')
  const names = ['自社', 'A 社', 'B 社', 'C 社', 'D 社', 'E 社']
  assert.deepEqual(collisions(textsOf(r.svg).filter((t) => names.includes(t.s))), [])
  assert.equal(names.every((n) => textOfName(r.svg, n)), true)
})

test('matrix2x2: 点が中央に集まっても名前は重ならず、描いた物は図の中に収まる', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ name: `社${i}`, x: 0.45 + (i % 4) * 0.03, y: 0.45 + Math.floor(i / 4) * 0.03 }))
  const r = draw('matrix2x2', { x: ['低', '高'], y: ['低', '高'], points })
  assert.deepEqual(collisions(textsOf(r.svg).filter((t) => t.s.startsWith('社'))), [])
  assert.notEqual(toOps(r, VIVID).ops[0].t, 'clip')
})

test('matrix2x2: 点が 1 つも読めなければ「データがありません」を描いて warnings に書く', () => {
  const r = draw('matrix2x2', { points: [] })
  assert.ok(empties(r))
  assert.ok(r.warnings.some((m) => m.includes('空です')))
})

// ---------------------------------------------------------------- cycle

test('cycle: 段は 3〜8 個で、2 個以下は描かず・9 個目からは捨てて、warnings に書く', () => {
  const two = draw('cycle', { steps: [{ name: 'a' }, { name: 'b' }] })
  assert.ok(empties(two))
  assert.ok(two.warnings.some((m) => m.includes('3 個以上')))
  const many = norm('cycle', { steps: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}` })) })
  assert.equal(many.data.steps.length, 8)
  assert.ok(many.warnings.some((m) => m.includes('2 個を捨てました')))
})

test('cycle: 既定は最初の段が目立ち（accent の太字）、highlight に名前か位置を渡すとその段が目立つ。段は番号つきで時計回りに並ぶ', () => {
  const r = draw('cycle', sample('cycle'))
  assert.equal(textOfName(r.svg, '見つけてもらう')?.fill, VIVID.accent)
  assert.equal(textOfName(r.svg, '試してもらう')?.fill, VIVID.ink)
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 1)
  const named = draw('cycle', { ...sample('cycle'), highlight: '成果を出す' })
  assert.equal(textOfName(named.svg, '成果を出す')?.fill, VIVID.accent)
  assert.equal(textOfName(named.svg, '見つけてもらう')?.fill, VIVID.ink)
  assert.equal(textOfName(draw('cycle', { ...sample('cycle'), highlight: 3 }).svg, '続けてもらう')?.fill, VIVID.accent)
  assert.deepEqual(textsOf(r.svg).filter((t) => /^0\d$/.test(t.s)).map((t) => t.s), ['01', '02', '03', '04', '05'])
})

test('cycle: 真ん中の字は輪の中心に置き、1 つ目から時計回りに右の列・左の列へ分かれる', () => {
  const r = draw('cycle', sample('cycle'))
  const mid = textsOf(r.svg).filter((t) => t.anchor === 'middle')
  assert.equal(mid.map((t) => t.s).join(''), '顧客が増え続ける仕組み', '真ん中の字は幅に合わせて折り返す')
  for (const t of mid) near(t.x, MEASURE / 2)
  const x = (/** @type {string} */ s) => textOfName(r.svg, s)?.x ?? NaN
  assert.ok(x('見つけてもらう') > MEASURE / 2 && x('試してもらう') > MEASURE / 2 && x('成果を出す') > MEASURE / 2, '右の半分は 1・2・3')
  assert.ok(x('続けてもらう') < MEASURE / 2 && x('広めてもらう') < MEASURE / 2, '左の半分は 4・5')
})

// ---------------------------------------------------------------- process

test('process: 既定は最後の段が目立ち、highlight が名前か位置ならその段。範囲外・無い名前は最後の段に戻して warnings に書く', () => {
  const hotOf = (/** @type {unknown} */ extra) => norm('process', { ...sample('process'), ...(extra && typeof extra === 'object' ? extra : {}) })
  assert.equal(hotOf(undefined).data.hot, 4)
  assert.equal(hotOf({ highlight: '試作' }).data.hot, 1)
  assert.equal(hotOf({ highlight: 2 }).data.hot, 2)
  const bad = hotOf({ highlight: 'どこにもない' })
  assert.equal(bad.data.hot, 4)
  assert.ok(bad.warnings.some((m) => m.includes('名前がありません')))
  assert.equal(hotOf({ highlight: 9 }).data.hot, 4)
})

test('process: 段は 2〜7 個で、番号は 2 桁の 20pt。段は左から右へ等間隔に並び、説明は段の幅に合わせて折り返す', () => {
  const r = draw('process', sample('process'))
  const nums = textsOf(r.svg).filter((t) => /^0\d$/.test(t.s))
  assert.deepEqual(nums.map((t) => t.s), ['01', '02', '03', '04', '05'])
  assert.ok(nums.every((t) => t.size === P.HUGE))
  const gaps = nums.slice(1).map((t, i) => t.x - nums[i].x)
  for (const g of gaps) near(g, gaps[0], 0.1)
  const note = textsOf(r.svg).filter((t) => t.x === nums[0].x && t.size === P.TICK).map((t) => t.s)
  assert.ok(note.length >= 2, '説明は 2 行以上に折り返す')
  assert.equal(note.join(''), '10 社に話を聞き、困りごとを 3 つに絞る')
  assert.ok(empties(draw('process', { steps: [{ name: 'a' }] })))
  assert.equal(norm('process', { steps: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}` })) }).data.steps.length, 7)
})

// ---------------------------------------------------------------- pyramid

test('pyramid: 段は上ほど狭く（頂点の段が最も狭い）、段の高さは同じで、段の間に水平の隙間がある', () => {
  const r = draw('pyramid', sample('pyramid'), { height: 300 })
  const faces = [...r.svg.matchAll(/<path d="([^"]+)"/g)].map((m) => (m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number))
  assert.equal(faces.length, 5)
  const widths = faces.map((n) => Math.max(...n.filter((_, i) => i % 2 === 0)) - Math.min(...n.filter((_, i) => i % 2 === 0)))
  const heights = faces.map((n) => Math.max(...n.filter((_, i) => i % 2 === 1)) - Math.min(...n.filter((_, i) => i % 2 === 1)))
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] > widths[i - 1], widths.join(','))
  for (let i = 2; i < heights.length - 1; i++) near(heights[i], heights[1], 0.1)
  // 隣の段の間は 3pt の隙間
  const ys = faces.map((n) => [Math.min(...n.filter((_, i) => i % 2 === 1)), Math.max(...n.filter((_, i) => i % 2 === 1))])
  for (let i = 1; i < ys.length; i++) near(ys[i][0] - ys[i - 1][1], 3, 0.1)
})

test('pyramid: 既定は頂点の段が目立ち（accent の太字の名前）、名前と説明は右の列に置く。段は 2〜6 個', () => {
  const r = draw('pyramid', sample('pyramid'))
  assert.equal(textOfName(r.svg, '使命')?.fill, VIVID.accent)
  assert.equal(textOfName(r.svg, '戦略')?.fill, VIVID.ink)
  const x = textOfName(r.svg, '使命')?.x ?? 0
  assert.equal(textOfName(r.svg, '基盤')?.x, x, '名前の左端がそろう')
  assert.equal(norm('pyramid', { levels: Array.from({ length: 9 }, (_, i) => ({ name: `l${i}` })) }).data.levels.length, 6)
  assert.ok(empties(draw('pyramid', { levels: [{ name: 'a' }] })))
})

test('pyramid: 狭い高さでは、段の説明の行数と名前の行数を減らして、隣の段の字と重ならない', () => {
  const data = { levels: Array.from({ length: 6 }, (_, i) => ({ name: `とても長い名前の段 ${i} 番目の見出し`, note: '説明の字がかなり長くて 2 行に割れるくらいの長さがあります。' })) }
  for (const height of [200, 260]) assert.deepEqual(collisions(textsOf(draw('pyramid', data, { height }).svg)), [], `高さ ${height}`)
})

// ---------------------------------------------------------------- milestones

test('milestones: 次の節目は終わっていない最初の節目で、全部終わっていれば最後・1 つも終わっていなければ最初。日付は accent の大きな字', () => {
  const hotOf = (/** @type {boolean[]} */ done) => norm('milestones', { items: done.map((d, i) => ({ date: `2026-0${i + 1}`, name: `m${i}`, done: d })) }).data.hot
  assert.equal(hotOf([true, true, false, false]), 2)
  assert.equal(hotOf([true, true, true]), 2)
  assert.equal(hotOf([false, false]), 0)
  assert.equal(hotOf([false, true, false]), 0, '飛び飛びなら最初の未達')
  const r = draw('milestones', sample('milestones'))
  const next = textOfName(r.svg, '2026年10月')
  assert.equal(next?.fill, VIVID.accent)
  assert.equal(next?.size, P.BIG)
  assert.equal(textOfName(r.svg, '2026年4月')?.fill, VIVID.ink, '終わった節目の日付は ink')
  assert.equal(textOfName(r.svg, '2027年3月')?.fill, VIVID.sub, 'これからの節目の日付は sub')
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 1)
})

test('milestones: 節目は左から右へ等間隔に並び、旗は道の上と下に互い違いに置く。最後の日付も年月の書式のままで、右端からはみ出さない', () => {
  const r = draw('milestones', sample('milestones'))
  const dates = textsOf(r.svg).filter((t) => t.size === P.BIG)
  assert.equal(dates.length, 6)
  const gaps = dates.slice(1).map((t, i) => t.x - dates[i].x)
  for (const g of gaps) near(g, gaps[0], 0.1)
  const mid = LOOKS.milestones.height(MEASURE, norm('milestones', sample('milestones')).data) / 2
  dates.forEach((t, i) => assert.equal(t.y < mid, i % 2 === 0, `${t.s} は ${i % 2 === 0 ? '上' : '下'}`))
  assert.equal(dates[5].s, '2028年4月', '最後の日付だけ縮めない')
  for (const t of textsOf(r.svg)) assert.ok(t.x + P.textWidth(t.s, t.size, t.bold) <= MEASURE, `「${t.s}」が右端を超える`)
})

test('milestones: 年月でない日付はそのまま書き、YYYY-MM-DD は年月にし、日付が無い節目も名前は書く。節目は 2〜8 個', () => {
  const r = draw('milestones', { items: [{ date: '来期', name: '最初', done: true }, { name: '次' }, { date: '2027-02-03', name: '三' }] })
  assert.ok(textOfName(r.svg, '来期'))
  assert.ok(textOfName(r.svg, '次'))
  assert.ok(textOfName(r.svg, '2027年2月'))
  assert.ok(empties(draw('milestones', { items: [{ name: 'a' }] })))
  assert.equal(norm('milestones', { items: Array.from({ length: 10 }, (_, i) => ({ name: `m${i}` })) }).data.items.length, 8)
})

// ---------------------------------------------------------------- org

test('org: 3 段まで描き、4 段目以降・8 つ目の部門・31 人目以降は捨てて、そのたびに warnings に書く', () => {
  let n = 0
  const node = (/** @type {number} */ depth) => {
    const me = { name: `n${++n}`, children: /** @type {any[]} */ ([]) }
    const kids = depth === 0 ? 8 : depth === 1 ? 5 : 1
    for (let i = 0; i < kids && depth < 3; i++) me.children.push(node(depth + 1))
    return me
  }
  const r = norm('org', { root: node(0) })
  /** @type {string[]} */
  const names = []
  const walk = (/** @type {any} */ x) => { names.push(x.name); x.children.forEach(walk) }
  walk(r.data.root)
  assert.ok(names.length <= 30, `${names.length} 人`)
  assert.equal(r.data.root.children.length <= 7, true)
  assert.ok(r.warnings.some((m) => m.includes('4 段目')))
  assert.ok(r.warnings.some((m) => m.includes('30 人まで')))
  const depth = (/** @type {any} */ x) => 1 + Math.max(0, ...x.children.map(depth))
  assert.equal(depth(r.data.root), 3)
})

test('org: 代表は accent の BIG と grad の短い棒・部門は太字・担当は細字で、名前が読めない人は捨てる。root が読めなければ描かない', () => {
  const r = draw('org', sample('org'))
  const root = textOfName(r.svg, '中田 榛希')
  assert.equal(root?.fill, VIVID.accent)
  assert.equal(root?.size, P.BIG)
  assert.equal(textOfName(r.svg, '開発')?.bold, true)
  assert.equal(textOfName(r.svg, '山田 花')?.bold, false)
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 1)
  const bad = norm('org', { root: { name: 'R', children: [{ name: '' }, { name: 'U', children: [{ role: 'x' }, { name: 'M' }] }] } })
  assert.deepEqual(bad.data.root.children.map((/** @type {any} */ c) => c.name), ['U'])
  assert.deepEqual(bad.data.root.children[0].children.map((/** @type {any} */ c) => c.name), ['M'])
  assert.ok(bad.warnings.some((m) => m.includes('名前の読めない人 2 人')))
  const none = draw('org', { root: { children: [] } })
  assert.ok(empties(none))
  assert.ok(none.warnings.some((m) => m.includes('root')))
})

test('org: 担当は名前と役割が同じ行に入れば 1 行・入らなければ役割を下の行に置く。部門は幅いっぱいに均等に並び、全体は左右の真ん中', () => {
  const r = draw('org', sample('org'))
  const yamada = textOfName(r.svg, '山田 花')
  const role = textOfName(r.svg, 'アプリ')
  assert.equal(role?.y, yamada?.y, '同じ行')
  const narrow = draw('org', { root: { name: 'R', children: [{ name: 'U', children: [{ name: 'とても長い担当者の名前です', role: 'とても長い役割' }] }] } }, { width: 200 })
  const n = textOfName(narrow.svg, 'とても長い担当者の名前です')
  const ro = textOfName(narrow.svg, 'とても長い役割')
  assert.ok(n && ro && ro.y > n.y, '入らなければ下の行')
  const xs = ['開発', '営業', '顧客支援', '経理・総務'].map((s) => textOfName(r.svg, s)?.x ?? NaN)
  const gaps = xs.slice(1).map((x, i) => x - xs[i])
  for (const g of gaps) near(g, gaps[0], 0.1)
})

// ---------------------------------------------------------------- venn

test('venn: 2〜3 の円で、全部の重なりは円の共通部分の形（頂点が全部の円の中）。1 つしか無ければ描かない', () => {
  for (const sets of [2, 3]) {
    const r = draw('venn', { sets: sample('venn').sets.slice(0, sets), overlap: '重なり' }, { height: 300 })
    const circles = tagsOf(r.svg, 'circle').filter((c) => Number(c.r) > 20).map((c) => ({ x: Number(c.cx), y: Number(c.cy), r: Number(c.r) }))
    assert.equal(circles.length, sets)
    const lens = [...r.svg.matchAll(/<path d="([^"]+)" fill="url/g)].map((m) => (m[1].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number))
    assert.equal(lens.length, 1)
    const pts = lens[0].reduce((/** @type {number[][]} */ a, v, i) => (i % 2 ? (a[a.length - 1].push(v), a) : [...a, [v]]), [])
    assert.ok(pts.length >= 60)
    for (const [x, y] of pts) for (const c of circles) assert.ok(Math.hypot(x - c.x, y - c.y) <= c.r + 0.1, `共通部分の頂点が円の外 ${x},${y}`)
  }
  const one = draw('venn', { sets: [{ name: 'a' }] })
  assert.ok(empties(one))
  assert.ok(one.warnings.some((m) => m.includes('2 個以上')))
  assert.equal(norm('venn', { sets: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }).data.sets.length, 3)
})

test('venn: 重なりの説明があれば accent の太字で図の下に置き、重なりの中心から線を引く。無ければ線も字も置かない', () => {
  const r = draw('venn', sample('venn'))
  const o = textOfName(r.svg, 'ここが事業の中心になる')
  assert.equal(o?.fill, VIVID.accent)
  assert.equal(o?.bold, true)
  assert.equal(o?.anchor, 'middle')
  const circles = tagsOf(r.svg, 'circle').filter((c) => Number(c.r) > 20)
  const bottom = Math.max(...circles.map((c) => Number(c.cy) + Number(c.r)))
  assert.ok((o?.y ?? 0) > bottom, '説明は円の下')
  assert.ok(tagsOf(r.svg, 'line').some((l) => l.x1 === l.x2), '縦の線')
  const without = draw('venn', { sets: sample('venn').sets })
  assert.equal(tagsOf(without.svg, 'line').length, 0)
  assert.equal(textsOf(without.svg).some((t) => t.fill === VIVID.accent), false, 'accent の字は無い')
})

test('venn: 円の名前は 1 つ目が左・2 つ目以降が右の列で、右の列の札どうしは重ならない', () => {
  const r = draw('venn', sample('venn'))
  const [a, b, c] = ['顧客が困っている', '私たちが作れる', '続けて稼げる'].map((s) => textOfName(r.svg, s))
  assert.equal(a?.anchor, 'end')
  assert.equal(b?.anchor, 'start')
  assert.ok((c?.y ?? 0) > (b?.y ?? 0))
  assert.deepEqual(collisions(textsOf(r.svg)), [])
})

// ---------------------------------------------------------------- mekko

test('mekko: 列の幅は列の値に比例し、列の中の高さは内訳の割合に比例する', () => {
  const r = draw('mekko', sample('mekko'), { height: 315 })
  const cells = tagsOf(r.svg, 'rect').map((t) => ({ x: Number(t.x), y: Number(t.y), w: Number(t.width), h: Number(t.height) })).filter((c) => c.w > 9 && c.h > 9)
  const cols = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b)
  assert.equal(cols.length, 4)
  const w = cols.map((x) => /** @type {number} */ (cells.find((c) => c.x === x)?.w))
  const values = [2400, 4600, 3100, 2300]
  for (let i = 1; i < 4; i++) near(w[i] / w[0], values[i] / values[0], 0.01)
  const second = cells.filter((c) => c.x === cols[1]).sort((a, b) => a.y - b.y)
  const parts = [1500, 1700, 900, 500]
  const total = second.reduce((s, c) => s + c.h, 0)
  parts.forEach((p, i) => near(second[i].h / total, p / 4600, 0.005))
})

test('mekko: 面積が最大の区画（列の値 x 割合）だけが accent の太字の割合と縁を持ち、区分の濃さは凡例の順に濃くなる', () => {
  const r = draw('mekko', sample('mekko'))
  const hot = textsOf(r.svg).filter((t) => t.bold && t.fill === VIVID.accent)
  assert.deepEqual(hot.map((t) => t.s), ['37%'], '10〜49 人の請求 1,700 / 4,600')
  assert.equal(tagsOf(r.svg, 'rect').filter((t) => t['stroke-width'] === '1.5').length, 1)
  const keys = tagsOf(r.svg, 'rect').filter((t) => t.width === '7' && t.height === '7').map((t) => Number(t['fill-opacity'] ?? 1))
  assert.equal(keys.length, 4)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] > keys[i - 1], keys.join(','))
})

test('mekko: 区分は 6 個まで・列は 8 個まで・列は 2 個以上で、超えた分は捨てる。同じ区分の重なりは足す。値が 0 以下・名前の無い内訳は捨てる', () => {
  const cols = Array.from({ length: 2 }, (_, j) => ({ name: `c${j}`, value: 10, parts: Array.from({ length: 8 }, (_, k) => ({ name: `p${k}`, value: 1 })) }))
  const r = norm('mekko', { columns: cols })
  assert.deepEqual(r.data.names, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
  assert.ok(r.warnings.some((m) => m.includes('区分は 6 個まで')))
  assert.equal(norm('mekko', { columns: Array.from({ length: 10 }, (_, j) => ({ name: `c${j}`, parts: [{ name: 'a', value: 1 }] })) }).data.columns.length, 8)
  const merged = norm('mekko', { columns: [{ name: 'x', parts: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }, { name: 'b', value: 0 }, { name: '', value: 3 }] }, { name: 'y', parts: [{ name: 'a', value: 1 }] }] })
  assert.deepEqual(merged.data.columns[0].parts, [{ name: 'a', value: 3 }])
  assert.equal(merged.data.columns[0].value, 3, '列の値が無ければ内訳の合計')
  const one = draw('mekko', { columns: [{ name: 'x', parts: [{ name: 'a', value: 1 }] }] })
  assert.ok(empties(one))
  assert.ok(one.warnings.some((m) => m.includes('2 個以上')))
})

test('mekko: 列の順は入力のまま（並べ替えない）で、列ごとの区分は全体の区分の順に積む', () => {
  const r = norm('mekko', { columns: [{ name: 'A', parts: [{ name: 'x', value: 1 }, { name: 'y', value: 1 }] }, { name: 'B', parts: [{ name: 'y', value: 3 }, { name: 'x', value: 1 }] }] })
  assert.deepEqual(r.data.columns.map((/** @type {any} */ c) => c.name), ['A', 'B'])
  assert.deepEqual(r.data.columns[1].parts.map((/** @type {any} */ p) => p.name), ['x', 'y'])
})

// ---------------------------------------------------------------- compare-table

test('compare-table: できる・できないは字（○ ×）でなく描いた形で、できるは丸・できないは 2 本の線', () => {
  const data = sample('compare-table')
  const r = draw('compare-table', data, { pal: MONO })
  const cells = data.rows.flatMap((/** @type {any} */ row) => row.values)
  const trues = cells.filter((/** @type {unknown} */ v) => v === true).length
  const falses = cells.filter((/** @type {unknown} */ v) => v === false).length
  assert.equal(tagsOf(r.svg, 'circle').length, trues)
  const ruleLines = tagsOf(r.svg, 'line').filter((l) => l.y1 === l.y2).length
  assert.equal(tagsOf(r.svg, 'line').length, ruleLines + falses * 2)
  for (const t of textsOf(r.svg)) assert.ok(!/[○×✓✔]/.test(t.s), t.s)
})

test('compare-table: highlight の列だけに上の棒と薄い地と accent の太字の名前・できるは grad の丸。highlight が無ければ目立たせる列は無い', () => {
  const r = draw('compare-table', sample('compare-table'))
  assert.equal(textOfName(r.svg, '自社')?.fill, VIVID.accent)
  assert.equal(textOfName(r.svg, '自社')?.bold, true)
  assert.equal(textOfName(r.svg, 'A 社')?.fill, VIVID.ink)
  const grads = [...r.svg.matchAll(/<linearGradient/g)].length
  const trueInHot = sample('compare-table').rows.filter((/** @type {any} */ row) => row.values[0] === true).length
  assert.equal(grads, 2 + trueInHot, '地と棒と、できるの丸')
  assert.equal(textOfName(r.svg, '1 週間')?.bold, true, '自社の列の字は太字')
  const none = norm('compare-table', { columns: ['a', 'b'], rows: [{ name: 'r', values: [true, false] }] })
  assert.equal(none.data.hot, -1)
  assert.doesNotMatch(draw('compare-table', { columns: ['a', 'b'], rows: [{ name: 'r', values: [true, false] }] }).svg, /Gradient/)
  const bad = norm('compare-table', { columns: ['a', 'b'], highlight: 5, rows: [{ name: 'r', values: [true, false] }] })
  assert.equal(bad.data.hot, -1)
  assert.ok(bad.warnings.some((m) => m.includes('highlight')))
})

test('compare-table: 値の数が列の数と違う行は足りない所を空にして余りを捨て、warnings に書く。列は 2〜6・行は 10 まで', () => {
  const r = norm('compare-table', { columns: ['a', 'b', 'c'], rows: [{ name: 'x', values: [true] }, { name: 'y', values: [true, false, 'z', 'w'] }] })
  assert.deepEqual(r.data.rows.map((/** @type {any} */ row) => row.values), [[true, '', ''], [true, false, 'z']])
  assert.ok(r.warnings.some((m) => m.includes('値の数が列の数と違う行 2 個')))
  assert.equal(norm('compare-table', { columns: Array.from({ length: 9 }, (_, i) => `c${i}`), rows: [{ name: 'r', values: [] }] }).data.columns.length, 6)
  assert.equal(norm('compare-table', { columns: ['a', 'b'], rows: Array.from({ length: 12 }, (_, i) => ({ name: `r${i}`, values: [] })) }).data.rows.length, 10)
  const one = draw('compare-table', { columns: ['a'], rows: [{ name: 'r', values: [true] }] })
  assert.ok(empties(one))
  assert.ok(draw('compare-table', { columns: ['a', 'b'], rows: [] }).svg.includes('データがありません'))
})

// ---------------------------------------------------------------- flowchart

test('flowchart: 段は矢印をたどった最長の長さで決まり、左から右へ進む。同じ箱の名前は 1 度だけ書く', () => {
  const r = draw('flowchart', sample('flowchart'))
  const x = (/** @type {string} */ s) => textOfName(r.svg, s)?.x ?? NaN
  assert.ok(x('広告・紹介') < x('利用企業') && x('利用企業') < x('自社サービス') && x('自社サービス') < x('銀行'), '左から右')
  assert.equal(x('銀行'), x('会計ソフト'), '同じ段の箱は同じ x')
  assert.equal(textsOf(r.svg).filter((t) => t.s === '自社サービス').length, 1)
})

test('flowchart: 戻る（循環する）矢印と、箱の id を指さない矢印・同じ向きの重なり・自分への矢印は捨てて warnings に書く', () => {
  const r = norm('flowchart', {
    nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'a', to: 'zzz' }, { from: 'a', to: 'b' }, { from: 'b', to: 'b' }],
  })
  assert.deepEqual(r.data.links.map((/** @type {any} */ l) => [l.from, l.to]), [[0, 1], [1, 2]])
  assert.ok(r.warnings.some((m) => m.includes('戻る')))
  assert.ok(r.warnings.some((m) => m.includes('指さない')))
  assert.ok(r.warnings.some((m) => m.includes('重なる矢印 1 本')))
})

test('flowchart: 目立たせる箱は矢印が最も多くつながる箱で（accent の太字）、その箱につながる矢印だけが accent', () => {
  const r = draw('flowchart', sample('flowchart'))
  assert.equal(textOfName(r.svg, '自社サービス')?.fill, VIVID.accent)
  assert.equal(textOfName(r.svg, '自社サービス')?.bold, true)
  assert.equal(textOfName(r.svg, '銀行')?.fill, VIVID.ink)
  const strokes = tagsOf(r.svg, 'path').filter((p) => p.fill === 'none')
  const accent = strokes.filter((p) => p.stroke === VIVID.accent)
  assert.equal(accent.length, 3, '利用企業→自社・自社→銀行・自社→会計ソフト')
  assert.equal(strokes.length, 4)
  assert.equal(norm('flowchart', { nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], links: [] }).data.hot, -1)
})

test('flowchart: group があれば帯に分け、帯の名前を左に置く。矢印の字は箱と重ならない', () => {
  const r = draw('flowchart', sample('flowchart'))
  const lanes = ['顧客側', '自社', '連携先'].map((s) => textOfName(r.svg, s))
  for (const l of lanes) assert.equal(l?.x, 12)
  assert.ok((lanes[0]?.y ?? 0) < (lanes[1]?.y ?? 0) && (lanes[1]?.y ?? 0) < (lanes[2]?.y ?? 0), '帯は出てきた順に上から')
  const nodes = tagsOf(r.svg, 'rect').filter((t) => t.rx === '4').map((t) => ({ x0: Number(t.x), y0: Number(t.y), x1: Number(t.x) + Number(t.width), y1: Number(t.y) + Number(t.height) }))
  const labels = textsOf(r.svg).filter((t) => t.size === P.TICK && t.anchor === 'middle')
  assert.equal(labels.map((t) => t.s).join('').replace(/ /g, ''), '14日間の無料体験月額9,800円入金の確認仕訳データ', '矢印の字は 4 本ぶん（2 行に折ってよい）')
  for (const t of labels) {
    const w = P.textWidth(t.s, P.TICK)
    const box = { x0: t.x - w / 2, x1: t.x + w / 2, y0: t.y - 6, y1: t.y + 2 }
    for (const n of nodes) assert.ok(box.x1 <= n.x0 || box.x0 >= n.x1 || box.y1 <= n.y0 || box.y0 >= n.y1, `「${t.s}」が箱にかかる`)
  }
  const none = draw('flowchart', { nodes: [{ id: 'a', name: 'A' }], links: [] })
  assert.ok(empties(none))
  assert.ok(none.warnings.some((m) => m.includes('2 個以上')))
})

// ---------------------------------------------------------------- kpi-hero

test('kpi-hero: 先頭の数だけ 32pt の細字・ほかの数は 20pt で、単位は 14pt の sub。変化は tiles と同じ（既定 %・正は up・負は down）', () => {
  const r = draw('kpi-hero', sample('kpi-hero'))
  const ts = textsOf(r.svg)
  const big = ts.filter((t) => t.size === P.HERO)
  assert.deepEqual(big.map((t) => t.s), ['4,820'])
  assert.equal(big[0].bold, false)
  assert.equal(ts.filter((t) => t.size === P.HUGE).length, 5)
  const units = ts.filter((t) => t.size === P.BIG)
  assert.ok(units.length >= 6 && units.every((t) => t.fill === VIVID.sub))
  assert.equal(ts.find((t) => t.s === '+12.4%')?.fill, VIVID.up)
  assert.equal(ts.find((t) => t.s === '-0.3pt')?.fill, VIVID.down)
  assert.equal(ts.find((t) => t.s === '-1か月')?.fill, VIVID.down)
})

test('kpi-hero: 広い版面は先頭が左・残りが右の格子、狭い版面は先頭が上・残りが下の格子', () => {
  const pos = (/** @type {number} */ width) => {
    const ts = textsOf(draw('kpi-hero', sample('kpi-hero'), { width }).svg)
    return { hero: /** @type {any} */ (ts.find((t) => t.size === P.HERO)), others: ts.filter((t) => t.size === P.HUGE) }
  }
  const wide = pos(751)
  for (const o of wide.others) assert.ok(o.x > wide.hero.x + 200, '広い版面: 残りは先頭の右')
  const narrow = pos(500)
  for (const o of narrow.others) assert.ok(o.y > narrow.hero.y + 10, '狭い版面: 残りは先頭の下')
})

test('kpi-hero: 先頭の推移は accent の線・grad の面・終わりの点（面だけグラデーション）。推移が 1 点以下の指標は線を描かない。値が数でない項目は捨てる', () => {
  const r = draw('kpi-hero', sample('kpi-hero'))
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 2, '面と終わりの点')
  assert.ok(tagsOf(r.svg, 'path').some((p) => p.fill === 'none' && p.stroke === VIVID.accent && p['stroke-width'] === '1.5'))
  const sparkless = draw('kpi-hero', { items: [{ name: 'a', value: 1, spark: [1] }, { name: 'b', value: 2, spark: [] }] })
  assert.equal(tagsOf(sparkless.svg, 'path').filter((p) => p.fill === 'none').length, 0)
  const bad = norm('kpi-hero', { items: [{ name: 'a', value: 'x' }, { name: 'b', value: 1, delta: 'x' }, { name: 'c', value: 2, delta: 1 }] })
  assert.equal(bad.data.items.length, 2)
  assert.equal(bad.data.items[0].delta, null)
  assert.ok(bad.warnings.some((m) => m.includes('value が数')))
  assert.ok(bad.warnings.some((m) => m.includes('delta が数でない')))
  assert.equal(norm('kpi-hero', { items: Array.from({ length: 9 }, (_, i) => ({ name: `k${i}`, value: i })) }).data.items.length, 7)
  assert.ok(empties(draw('kpi-hero', { items: [] })))
})

// ---------------------------------------------------------------- pnl

test('pnl: 売上の年平均の伸び（最後 / 最初の売上の年数乗根 - 1）を見出しの数に書く。最初か最後の売上が 0 なら書かない', () => {
  const r = draw('pnl', sample('pnl'))
  const cagr = Math.pow(780 / 42, 1 / 4) - 1
  assert.equal(P.percent(cagr, undefined, true), '+108%')
  const head = textsOf(r.svg).find((t) => t.size === P.BIG)
  assert.equal(head?.s, '+108%')
  assert.ok(textsOf(r.svg).some((t) => t.s === '売上の年平均の伸び（2026〜2030）'))
  const zero = draw('pnl', { x: ['1', '2'], revenue: [0, 5], cost: [1, 1], unit: '円' })
  assert.equal(textsOf(zero.svg).some((t) => t.size === P.BIG), false)
})

test('pnl: 売上の棒は 1 本の左から右のグラデーション・費用は薄い墨・利益は線（紙の色の太い線を下に敷く）。profit を省くと売上 - 費用', () => {
  const r = draw('pnl', sample('pnl'))
  assert.equal([...r.svg.matchAll(/<linearGradient/g)].length, 1)
  const bars = tagsOf(r.svg, 'rect').filter((t) => Number(t.width) > 7)
  assert.equal(bars.filter((t) => t.fill?.startsWith('url(')).length, 5)
  assert.equal(bars.filter((t) => t.fill === VIVID.ink && t['fill-opacity'] === '0.18').length, 5)
  const lines = tagsOf(r.svg, 'path').filter((p) => p.fill === 'none')
  assert.deepEqual(lines.map((p) => p.stroke), [VIVID.paper, VIVID.ink])
  const profits = textsOf(r.svg).filter((t) => t.size === P.LABEL && t.bold).map((t) => t.s)
  assert.deepEqual(profits, ['-54', '-34', '22', '98', '220'])
  assert.equal(textOfName(r.svg, '-54')?.fill, VIVID.down)
  assert.equal(textOfName(r.svg, '220')?.fill, VIVID.ink)
})

test('pnl: 0 の点線は利益が負の年がある時だけ。与えた profit は使い、数でなければ売上 - 費用にして warnings に書く', () => {
  assert.match(draw('pnl', sample('pnl')).svg, /stroke-dasharray="3 3"/)
  const allPositive = draw('pnl', { x: ['a', 'b'], revenue: [10, 20], cost: [5, 6], unit: '円' })
  assert.doesNotMatch(allPositive.svg, /stroke-dasharray/)
  const given = norm('pnl', { x: ['a', 'b', 'c'], revenue: [10, 20, 30], cost: [5, 6, 7], profit: [1, 'x', 3], unit: '円' })
  assert.deepEqual(given.data.profit, [1, 14, 3])
  assert.ok(given.warnings.some((m) => m.includes('売上 - 費用')))
})

test('pnl: 年の字・売上・費用（0 以上）が読めない年は捨てて warnings に書き、年は 8 個まで・2 個以上要る。年の数と列の数が違えば短い方に合わせる', () => {
  const r = norm('pnl', { x: ['a', 'b', '', 'd', 'e'], revenue: [1, 2, 3, -4, 5], cost: [1, 1, 1, 1, 'x'], unit: '円' })
  assert.deepEqual(r.data.x, ['a', 'b'])
  assert.ok(r.warnings.some((m) => m.includes('3 個を捨てました')))
  assert.ok(empties(draw('pnl', { x: ['a'], revenue: [1], cost: [1] })))
  const many = norm('pnl', { x: Array.from({ length: 10 }, (_, i) => `y${i}`), revenue: Array(10).fill(1), cost: Array(10).fill(1) })
  assert.equal(many.data.x.length, 8)
  assert.equal(many.data.revenue.length, 8)
  const short = norm('pnl', { x: ['a', 'b', 'c'], revenue: [1, 2], cost: [1, 1, 1] })
  assert.deepEqual(short.data.x, ['a', 'b'])
})

test('pnl: 下に年の字と、売上・費用・利益の 3 行の数を置く。数は同じ桁にそろえ、単位は左下に書く', () => {
  const r = draw('pnl', { x: ['a', 'b'], revenue: [10.5, 20], cost: [5, 6.25], unit: '億円' })
  const ts = textsOf(r.svg)
  const row = (/** @type {string} */ name) => ts.filter((t) => t.y === ts.find((u) => u.s === name && u.anchor === 'start' && u.x === 12)?.y && t.anchor === 'middle').map((t) => t.s)
  assert.deepEqual(row('売上'), ['10.50', '20.00'])
  assert.deepEqual(row('費用'), ['5.00', '6.25'])
  assert.ok(ts.some((t) => t.s === '単位: 億円' && t.x === 12))
})
