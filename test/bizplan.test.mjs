// @ts-check
// 事業計画の型（template: 'bizplan'）の試験。plan から広げた頁の順・数字の入口・足りない項目の扱いを確かめる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandBizplan } from '../hooks/engine/templates/bizplan.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { compose } from '../hooks/engine/index.mjs'
import { metrics } from './looks-kit.mjs'

/** 全部の項目がそろった架空の plan */
const full = () => ({
  company: 'ミズヒキ・ワークス',
  tagline: '町工場の受注を 1 つの画面にそろえる',
  date: '2026年10月',
  summary: ['受注と在庫が散らばっている', '1 画面でそろえるクラウドを作る', '5 年後に売上 24 億円'],
  problem: {
    points: ['受注が紙と表計算に分かれる', '在庫が合わない'],
    stat: { value: '68%', label: '紙と表計算で管理する町工場', source: '架空の調査' },
  },
  solution: { points: ['1 画面：受注から出荷まで', '3 タップ：現場の端末から入力'] },
  market: {
    tam: { value: 5000, label: '全体' },
    sam: { value: 1200, label: '100 人未満' },
    som: { value: 60, label: '5 年で獲得' },
    unit: '億円',
    source: '社内の仮定',
  },
  model: {
    nodes: [{ id: 'a', name: '取引先' }, { id: 'b', name: '工場' }],
    links: [{ from: 'a', to: 'b', label: '発注' }],
  },
  competition: {
    x: ['重い', '軽い'],
    y: '特化',
    players: [{ name: '表計算', x: 0.8, y: 0.1 }, { name: '自社', x: 0.8, y: 0.9, self: true }],
  },
  traction: { kpis: [{ name: '導入工場', value: 30, unit: '社', delta: '+12 社' }, { name: '継続率', value: 97, unit: '%' }] },
  roadmap: { items: [{ name: '受注', start: '2026-04', end: '2026-12' }, { name: '出荷', start: '2026-10', end: '2027-06' }] },
  financials: { years: ['2027', '2028', '2029'], revenue: [2, 4.5, 9], cost: [2.8, 4.8, 8], unit: '億円', source: '社内の仮定' },
  team: { members: [{ name: 'A', role: '代表' }, { name: 'B', role: '技術' }] },
  funding: { amount: 3, unit: '億円', use: [{ name: '開発', value: 2 }, { name: '営業', value: 1 }] },
  risks: [{ risk: '大手が参入', answer: '現場に特化' }],
  sources: ['見本の仮定'],
})

/** @param {Record<string, any>} plan @param {string} [lang] */
const run = (plan, lang = 'ja') => expandBizplan(plan, { lang })
/** @param {{ slides: any[] }} r @param {string} title */
const byTitle = (r, title) => r.slides.find((s) => s.title === title)

test('expandBizplan: 全部の項目があれば、設計どおりの順に 16 枚の頁を作り、警告は出さない', () => {
  const r = run(full())
  assert.deepEqual(
    r.slides.map((s) => s.layout),
    ['cover', 'statement', 'content', 'kpi', 'compare', 'figure', 'figure', 'figure', 'kpi', 'figure', 'figure', 'compare', 'figure', 'table', 'content', 'closing'],
  )
  assert.deepEqual(r.warnings, [])
})

test('expandBizplan: 図はどれも dataset の名前で呼び、数字は datasets に入る', () => {
  const r = run(full())
  const figs = r.slides.filter((s) => s.figure)
  assert.deepEqual(figs.map((s) => s.figure.kind), ['market', 'flowchart', 'matrix2x2', 'gantt', 'pnl', 'donut'])
  for (const s of figs) {
    assert.equal(s.figure.data, undefined)
    assert.ok(Object.hasOwn(r.datasets, s.figure.dataset), s.figure.kind)
    assert.ok(s.figure.alt)
  }
  assert.deepEqual(Object.keys(r.datasets).sort(), ['competition', 'financials', 'funding', 'market', 'model', 'roadmap'])
})

test('expandBizplan: 出典は dataset に持たせ、頁の足には schema が出す', () => {
  const r = run(full())
  assert.equal(r.datasets.market.source, '社内の仮定')
  assert.equal(r.datasets.financials.source, '社内の仮定')
  assert.equal(r.datasets.funding.source, undefined)
  const { doc } = normalize({ title: 't', template: 'bizplan', plan: full() })
  const market = /** @type {any} */ (doc.slides).find((/** @type {any} */ s) => s.figure?.kind === 'market')
  assert.deepEqual(market.sources, ['社内の仮定'])
})

test('expandBizplan: 表紙は会社名を題に・ひとことを lead に・日付を date に持つ', () => {
  const [cover] = run(full()).slides
  assert.deepEqual(cover, { layout: 'cover', kicker: '事業計画', title: 'ミズヒキ・ワークス', lead: '町工場の受注を 1 つの画面にそろえる', date: '2026年10月' })
})

test('expandBizplan: サマリーは最初の文を大きな題に、残りを lead に続ける', () => {
  const s = run(full()).slides[1]
  assert.equal(s.title, '受注と在庫が散らばっている')
  assert.equal(s.lead, '1 画面でそろえるクラウドを作る　5 年後に売上 24 億円')
  assert.equal(s.kicker, 'サマリー')
})

test('expandBizplan: 課題は箇条書きの頁と、数字 1 つの kpi の頁（出典付き）に分ける', () => {
  const r = run(full())
  assert.equal(byTitle(r, '課題').blocks[0].items.length, 2)
  const stat = byTitle(r, '課題の大きさ')
  assert.deepEqual(stat.items, [{ label: '紙と表計算で管理する町工場', value: '68%' }])
  assert.deepEqual(stat.sources, ['架空の調査'])
})

test('expandBizplan: 解決策は「見出し：説明」が 2〜3 個なら比べの頁、そうでなければ箇条書き', () => {
  const r = run(full())
  const cmp = byTitle(r, '解決策')
  assert.equal(cmp.layout, 'compare')
  assert.deepEqual(cmp.items.map((/** @type {any} */ c) => [c.title, c.points]), [['1 画面', ['受注から出荷まで']], ['3 タップ', ['現場の端末から入力']]])
  const plain = run({ ...full(), solution: { points: ['a', 'b', 'c', 'd'] } })
  assert.equal(byTitle(plain, '解決策').layout, 'content')
  const mixed = run({ ...full(), solution: { points: ['1 画面：受注', '説明の無い項目'] } })
  assert.equal(byTitle(mixed, '解決策').layout, 'content')
})

test('expandBizplan: 市場規模は TAM・SAM・SOM の値と、SOM が TAM の何 % かを添える', () => {
  const r = run(full())
  const s = byTitle(r, '市場規模')
  assert.deepEqual(r.datasets.market.data, {
    items: [{ name: 'TAM', value: 5000, note: '全体' }, { name: 'SAM', value: 1200, note: '100 人未満' }, { name: 'SOM', value: 60, note: '5 年で獲得' }],
    unit: '億円',
  })
  assert.match(s.lead, /60億円/)
  assert.match(s.lead, /1\.2%/)
  assert.match(s.figure.alt, /TAM 5,000億円/)
})

test('expandBizplan: 市場の値は数だけでも受け、1 つでも欠ければ頁を作らず warnings に書く', () => {
  const ok = run({ ...full(), market: { tam: 100, sam: '30', som: 5, unit: '億円' } })
  assert.deepEqual(ok.datasets.market.data.items.map((/** @type {any} */ i) => i.value), [100, 30, 5])
  const bad = run({ ...full(), market: { tam: 100, som: 5, unit: '億円' } })
  assert.equal(byTitle(bad, '市場規模'), undefined)
  assert.ok(bad.warnings.some((w) => w.includes('plan.market.sam')))
})

test('expandBizplan: ビジネスモデルは nodes と links があれば流れ図、points だけなら箇条書き', () => {
  const r = run(full())
  assert.deepEqual(r.datasets.model.data, { nodes: [{ id: 'a', name: '取引先' }, { id: 'b', name: '工場' }], links: [{ from: 'a', to: 'b', label: '発注' }] })
  const pts = run({ ...full(), model: { points: ['月額', '導入費'] } })
  assert.equal(byTitle(pts, 'ビジネスモデル').layout, 'content')
  assert.equal(pts.datasets.model, undefined)
})

test('expandBizplan: 競合は立ち位置の 2 軸（札の組か軸の名前）か、機能の比べの表', () => {
  const r = run(full())
  const d = r.datasets.competition.data
  assert.deepEqual(d.x, ['重い', '軽い'])
  assert.deepEqual(d.y, ['特化：低', '特化：高'])
  assert.deepEqual(d.points, [{ name: '表計算', x: 0.8, y: 0.1 }, { name: '自社', x: 0.8, y: 0.9, self: true }])
  const table = run({ ...full(), competition: { columns: ['自社', '他社'], rows: [{ name: '在庫', values: [true, false] }, { name: '価格', values: ['安い', '高い'] }] } })
  const t = byTitle(table, '競合との比較')
  assert.equal(t.layout, 'table')
  assert.deepEqual(t.blocks[0].head, ['', '自社', '他社'])
  assert.deepEqual(t.blocks[0].rows, [['在庫', '○', '×'], ['価格', '安い', '高い']])
})

test('expandBizplan: 立ち位置の x と y が 0〜1 の外なら端に寄せて warnings に書く', () => {
  const r = run({ ...full(), competition: { x: 'a', y: 'b', players: [{ name: 'p', x: 1.5, y: -2 }] } })
  assert.deepEqual(r.datasets.competition.data.points, [{ name: 'p', x: 1, y: 0 }])
  assert.ok(r.warnings.some((w) => w.includes('0 から 1')))
})

test('expandBizplan: 実績は 4 つずつ kpi の頁に分け、続きの頁は題を変える', () => {
  const kpis = Array.from({ length: 5 }, (_, i) => ({ name: `k${i}`, value: i * 1000, delta: i }))
  const r = run({ ...full(), traction: { kpis } })
  const pages = r.slides.filter((s) => s.layout === 'kpi' && s.title.startsWith('実績'))
  assert.deepEqual(pages.map((s) => [s.title, s.items.length]), [['実績', 4], ['実績（続き）', 1]])
  assert.equal(pages[0].items[1].delta, 1)
})

test('expandBizplan: ロードマップは期間があれば工程表にし、YYYY-MM は月の初日と末日の日付にする', () => {
  const r = run({ ...full(), roadmap: { items: [{ name: '二月', start: '2028-02', end: '2028-02' }, { name: '日付', start: '2028-03-05', end: '2028-03-09' }] } })
  assert.deepEqual(r.datasets.roadmap.data.tasks, [
    { name: '二月', start: '2028-02-01', end: '2028-02-29' },
    { name: '日付', start: '2028-03-05', end: '2028-03-09' },
  ])
  const flat = run({ ...full(), roadmap: { items: [{ name: '平年', start: '2027-02', end: '2027-02' }] } })
  assert.equal(flat.datasets.roadmap.data.tasks[0].end, '2027-02-28')
})

test('expandBizplan: 日付が読めない期間は工程表にせず、始めの日で節目の並びにする', () => {
  const r = run({ ...full(), roadmap: { items: [{ name: '初期', start: '今期', end: '来期' }] } })
  assert.equal(r.slides.find((s) => s.figure?.dataset === 'roadmap').figure.kind, 'milestones')
  assert.deepEqual(r.datasets.roadmap.data.items, [{ date: '今期', name: '初期' }])
  const ms = run({ ...full(), roadmap: { milestones: [{ date: '2027-03', name: '公開', done: true }, { date: '2027-09', name: '拡大' }] } })
  assert.deepEqual(ms.datasets.roadmap.data.items, [{ date: '2027-03', name: '公開', done: true }, { date: '2027-09', name: '拡大' }])
})

test('expandBizplan: 収支は利益を引き算で出し、売上の推移・年平均成長率・黒字化の年を要点に書く', () => {
  const r = run(full())
  assert.deepEqual(r.datasets.financials.data, { x: ['2027', '2028', '2029'], revenue: [2, 4.5, 9], cost: [2.8, 4.8, 8], profit: [-0.8, -0.3, 1], unit: '億円' })
  const side = byTitle(r, '収支計画').side[0].items
  assert.equal(side.length, 3)
  assert.match(side[0], /2027 2億円 → 2029 9億円/)
  assert.match(side[1], /年平均成長率\*\* 112%（2 年）/)
  assert.match(side[2], /黒字化\*\* 2029（3 年目）/)
})

test('expandBizplan: 初年度から黒字・最後まで赤字・1 年だけの収支でも要点の文が合う', () => {
  const black = byTitle(run({ ...full(), financials: { years: ['1', '2'], revenue: [5, 6], cost: [1, 1], unit: '円' } }), '収支計画').side[0].items
  assert.match(black[2], /初年度から黒字/)
  const red = byTitle(run({ ...full(), financials: { years: ['1', '2'], revenue: [1, 2], cost: [3, 4], unit: '円' } }), '収支計画').side[0].items
  assert.match(red[2], /期間内は赤字/)
  const one = byTitle(run({ ...full(), financials: { years: ['2027'], revenue: [5], cost: [3], unit: '円' } }), '収支計画').side[0].items
  assert.equal(one.length, 2)
  assert.doesNotMatch(one.join(''), /年平均成長率/)
})

test('expandBizplan: 収支の個数がずれていれば少ない方に合わせ、数でない値があれば頁を作らない', () => {
  const skew = run({ ...full(), financials: { years: ['1', '2', '3'], revenue: [1, 2], cost: [1, 1, 1], unit: '円' } })
  assert.deepEqual(skew.datasets.financials.data.x, ['1', '2'])
  assert.ok(skew.warnings.some((w) => w.includes('個数が違う')))
  const nan = run({ ...full(), financials: { years: ['1'], revenue: ['多い'], cost: [1], unit: '円' } })
  assert.equal(byTitle(nan, '収支計画'), undefined)
  assert.ok(nan.warnings.some((w) => w.includes('数でない')))
})

test('expandBizplan: チームは 3 人までは人ごとの比べ、4 人からは会社を根にした体制図にする', () => {
  const small = byTitle(run(full()), 'チーム')
  assert.equal(small.layout, 'compare')
  assert.deepEqual(small.items[0], { title: 'A', points: ['代表'] })
  const members = Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, role: 'r' }))
  const big = run({ ...full(), team: { members } })
  assert.equal(byTitle(big, 'チーム').figure.kind, 'org')
  assert.equal(big.datasets.team.data.root.name, 'ミズヒキ・ワークス')
  assert.equal(big.datasets.team.data.root.children.length, 5)
})

test('expandBizplan: 体制図は会社を含めて 30 人までで、超えたら warnings に書く', () => {
  const members = Array.from({ length: 40 }, (_, i) => ({ name: `m${i}` }))
  const r = run({ ...full(), team: { members } })
  assert.equal(r.datasets.team.data.root.children.length, 29)
  assert.ok(r.warnings.some((w) => w.includes('29 人')))
})

test('expandBizplan: 資金調達は使い道の円と調達額で、合計が違う時は円の中央の合計を渡さず warnings に書く', () => {
  const ok = run(full())
  assert.deepEqual(ok.datasets.funding.data, { items: [{ name: '開発', value: 2 }, { name: '営業', value: 1 }], unit: '億円', total: 3 })
  assert.deepEqual(byTitle(ok, '資金調達').side, [{ type: 'keys', items: [{ label: '調達額', value: '3億円' }] }])
  const diff = run({ ...full(), funding: { amount: 5, unit: '億円', use: [{ name: '開発', value: 2 }, { name: '営業', value: 1 }] } })
  assert.equal(diff.datasets.funding.data.total, undefined)
  assert.ok(diff.warnings.some((w) => w.includes('合計が amount と違う')))
  assert.deepEqual(byTitle(diff, '資金調達').side[0].items[0].value, '5億円')
})

test('expandBizplan: リスクは「リスク」「対応」の 2 列の表', () => {
  const t = byTitle(run(full()), 'リスクと対応')
  assert.deepEqual(t.blocks[0].head, ['リスク', '対応'])
  assert.deepEqual(t.blocks[0].rows, [['大手が参入', '現場に特化']])
})

test('expandBizplan: 結びは一言と次の一歩で、一言が無ければひとこと・会社名の順に使う', () => {
  const closing = (/** @type {Record<string, any>} */ p) => /** @type {any} */ (run(p).slides.at(-1))
  assert.deepEqual(closing({ ...full(), closing: { message: 'ありがとう', next: ['来週 面談'] } }), { layout: 'closing', title: 'ありがとう', items: ['来週 面談'] })
  assert.equal(closing(full()).title, '町工場の受注を 1 つの画面にそろえる')
  assert.equal(closing({ company: '会社' }).title, '会社')
  assert.equal(closing(full()).items[0], '資金調達 3億円（用途: 開発・営業）')
})

test('expandBizplan: 足りない項目は頁を作らず、plan のどの項目かを warnings に書く', () => {
  const r = run({})
  assert.deepEqual(r.slides, [])
  for (const key of ['plan.company', 'plan.summary', 'plan.problem.points', 'plan.solution.points', 'plan.market', 'plan.model', 'plan.competition', 'plan.traction.kpis', 'plan.roadmap', 'plan.financials', 'plan.team.members', 'plan.funding.use', 'plan.risks']) {
    assert.ok(r.warnings.some((w) => w.startsWith(key)), key)
  }
  assert.ok(r.warnings.every((w) => w.includes('頁を作らなかった')))
})

test('expandBizplan: 1 つの項目が壊れていても、ほかの頁は作る', () => {
  const evil = { name: 'A' }
  Object.defineProperty(evil, 'role', { get() { throw new Error('boom') } })
  const r = run({ ...full(), team: { members: [evil] }, problem: 5, risks: 'x' })
  assert.equal(byTitle(r, 'チーム'), undefined)
  assert.ok(r.warnings.some((w) => w.includes('plan.team') && w.includes('読めなかった')))
  assert.equal(byTitle(r, '課題'), undefined)
  assert.ok(byTitle(r, '市場規模'))
  assert.ok(byTitle(r, '収支計画'))
})

test('expandBizplan: 英語では頁の題と要点の文が英語になる', () => {
  const r = run(full(), 'en')
  for (const title of ['Problem', 'The size of the problem', 'Solution', 'Market size', 'Business model', 'Competition', 'Traction', 'Roadmap', 'Financial plan', 'Team', 'Funding', 'Risks and responses', 'Sources']) {
    assert.ok(byTitle(r, title), title)
  }
  assert.equal(r.slides[0].kicker, 'Business plan')
  assert.equal(r.slides[1].kicker, 'Summary')
  assert.ok(byTitle(r, 'Market size'))
  assert.match(byTitle(r, 'Financial plan').side[0].items[1], /CAGR\*\* 112% \(2 yr\)/)
  assert.match(byTitle(r, 'Financial plan').side[0].items[2], /Break-even\*\* 2029 \(3rd year\)/)
  assert.match(r.slides.at(-1).items[0], /^Raising 3億円 for /)
})

test('expandBizplan: 入力の plan を書き換えず、同じ入力から同じ結果になる', () => {
  const plan = full()
  const before = JSON.stringify(plan)
  const a = run(plan)
  const b = run(plan)
  assert.equal(JSON.stringify(plan), before)
  assert.deepEqual(a, b)
})

test('bizplan: schema を通すと、全部の頁が検査に通って警告なしで資料の Doc になる', () => {
  const { doc, warnings } = normalize({ title: '事業計画', template: 'bizplan', plan: full() })
  assert.deepEqual(warnings, [])
  assert.equal(doc.kind, 'deck')
  assert.equal(doc.slides?.length, 16)
  const fig = /** @type {any} */ (doc.slides).filter((/** @type {any} */ s) => s.figure)
  for (const s of fig) assert.ok(s.figure.data && s.figure.dataset, s.figure.kind)
})

test('bizplan: 組版すると 1 枚が 1 頁になる', () => {
  const { layout } = compose({ title: '事業計画', template: 'bizplan', plan: full() }, { metrics })
  assert.equal(layout.pages.length, 16)
})
