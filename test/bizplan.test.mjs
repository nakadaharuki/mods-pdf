// @ts-check
// 事業計画の型（template: 'bizplan'）の試験。plan から広げた枚（表紙・panel を詰めた 3 枚・結び）・数字の入口・足りない項目の扱いを確かめる。
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
/** 全部の panel（枚の順・panel の順） @param {{ slides: any[] }} r @returns {any[]} */
const panelsOf = (r) => r.slides.flatMap((s) => s.panels ?? [])
/** @param {{ slides: any[] }} r @param {string} title */
const panelBy = (r, title) => panelsOf(r).find((p) => p.title === title)
/** 資金調達の panel の題は金額が付く @param {{ slides: any[] }} r */
const fundingOf = (r) => panelsOf(r).find((p) => /^(資金調達|Funding) /.test(p.title))
/** 図の panel の kind の列 @param {{ slides: any[] }} r */
const looks = (r) => panelsOf(r).filter((p) => p.look).map((p) => p.look.kind)

test('expandBizplan: 全部の項目があれば、表紙・panel を詰めた 3 枚・結びの順に 5 枚を作り、警告は出さない', () => {
  const r = run(full())
  assert.deepEqual(r.slides.map((s) => s.layout), ['cover', 'grid', 'grid', 'grid', 'closing'])
  assert.deepEqual(r.slides.filter((s) => s.panels).map((s) => s.panels.length), [5, 4, 4])
  assert.deepEqual(r.warnings, [])
})

test('expandBizplan: 1 枚の panel は 3〜5 個で、行の panel の数と高さの重みを arrange（rows:）で渡す。数は panel の数と合う', () => {
  const grids = run(full()).slides.filter((s) => s.panels)
  assert.deepEqual(grids.map((s) => s.arrange), ['rows:3,2|0.85,1.5', 'rows:1,2,1|1,0.7,1.1', 'rows:1,3|1.15,1'])
  for (const s of grids) {
    const counts = s.arrange.slice('rows:'.length).split('|')[0].split(',').map(Number)
    assert.equal(counts.reduce((a, b) => a + b, 0), s.panels.length, s.arrange)
    assert.ok(s.panels.length >= 3 && s.panels.length <= 5)
  }
  const { doc } = normalize({ title: 't', template: 'bizplan', plan: full() })
  assert.deepEqual(/** @type {any} */ (doc.slides).filter((/** @type {any} */ s) => s.layout === 'grid').map((/** @type {any} */ s) => s.arrange), grids.map((s) => s.arrange))
})

test('expandBizplan: 図はどれも 1 回だけ、dataset の名前で呼び、数字は datasets に入る', () => {
  const r = run(full())
  assert.deepEqual(looks(r), ['market', 'matrix2x2', 'flowchart', 'gantt', 'pnl', 'donut'])
  for (const p of panelsOf(r).filter((x) => x.look)) {
    assert.equal(p.look.data, undefined)
    assert.ok(Object.hasOwn(r.datasets, p.look.dataset), p.look.kind)
    assert.ok(p.look.alt)
  }
  assert.deepEqual(Object.keys(r.datasets).sort(), ['competition', 'financials', 'funding', 'market', 'model', 'roadmap'])
})

test('expandBizplan: 出典は dataset に持たせ、schema が panel の出典（札の下）に出す。課題の大きさの出典は panel に直接ある', () => {
  const r = run(full())
  assert.equal(r.datasets.market.source, '社内の仮定')
  assert.equal(r.datasets.financials.source, '社内の仮定')
  assert.equal(r.datasets.funding.source, undefined)
  const { doc } = normalize({ title: 't', template: 'bizplan', plan: full() })
  const panels = /** @type {any} */ (doc.slides).flatMap((/** @type {any} */ s) => s.panels ?? [])
  assert.equal(panels.find((/** @type {any} */ p) => p.title === '市場規模').source, '社内の仮定')
  assert.equal(panels.find((/** @type {any} */ p) => p.title === '収支計画').source, '社内の仮定')
  assert.equal(panels.find((/** @type {any} */ p) => p.title === '課題の大きさ').source, '架空の調査')
  assert.deepEqual(/** @type {any} */ (doc.slides)[1].sources, ['見本の仮定'], 'plan.sources は最初の枚の足に出る')
})

test('expandBizplan: 表紙は会社名を題に・ひとことを lead に・日付を date に持つ', () => {
  const [cover] = run(full()).slides
  assert.deepEqual(cover, { layout: 'cover', kicker: '事業計画', title: 'ミズヒキ・ワークス', lead: '町工場の受注を 1 つの画面にそろえる', date: '2026年10月' })
})

test('expandBizplan: 概要の枚は summary の最初の文を題に、残りを lead に続ける（題は 1 行）', () => {
  const s = run(full()).slides[1]
  assert.equal(s.title, '受注と在庫が散らばっている')
  assert.equal(s.lead, '1 画面でそろえるクラウドを作る　5 年後に売上 24 億円')
  assert.equal(s.kicker, 'ミズヒキ・ワークス')
  const none = run({ ...full(), summary: undefined })
  assert.equal(none.slides[1].title, '課題・解決策・市場')
  assert.ok(none.warnings.some((w) => w.startsWith('plan.summary')))
})

test('expandBizplan: 課題は箇条書きの panel と、数字 1 つの KPI の panel（出典付き）に分ける', () => {
  const r = run(full())
  assert.deepEqual(panelBy(r, '課題').list, ['受注が紙と表計算に分かれる', '在庫が合わない'])
  const stat = panelBy(r, '課題の大きさ')
  assert.deepEqual(stat.kpi, [{ label: '紙と表計算で管理する町工場', value: '68%' }])
  assert.equal(stat.source, '架空の調査')
  assert.equal(panelBy(run({ ...full(), problem: { points: ['a'] } }), '課題の大きさ'), undefined, '数字が無ければ KPI は載せない')
})

test('expandBizplan: 解決策は箇条書きの panel で、「見出し：説明」の形は見出しを太字にする', () => {
  const r = run(full())
  assert.deepEqual(panelBy(r, '解決策').list, ['**1 画面** 受注から出荷まで', '**3 タップ** 現場の端末から入力'])
  const plain = run({ ...full(), solution: { points: ['a', 'b', 'c', 'd'] } })
  assert.deepEqual(panelBy(plain, '解決策').list, ['a', 'b', 'c', 'd'])
  const mixed = run({ ...full(), solution: { points: ['1 画面：受注', '説明の無い項目'] } })
  assert.deepEqual(panelBy(mixed, '解決策').list, ['**1 画面** 受注', '説明の無い項目'])
})

test('expandBizplan: 市場規模は TAM・SAM・SOM の値を図にし、SOM が TAM の何 % かを panel の注に添える', () => {
  const r = run(full())
  const p = panelBy(r, '市場規模')
  assert.deepEqual(r.datasets.market.data, {
    items: [{ name: 'TAM', value: 5000, note: '全体' }, { name: 'SAM', value: 1200, note: '100 人未満' }, { name: 'SOM', value: 60, note: '5 年で獲得' }],
    unit: '億円',
  })
  assert.match(p.note, /60億円/)
  assert.match(p.note, /1\.2%/)
  assert.match(p.look.alt, /TAM 5,000億円/)
})

test('expandBizplan: 市場の値は数だけでも受け、1 つでも欠ければ panel を作らず warnings に書く', () => {
  const ok = run({ ...full(), market: { tam: 100, sam: '30', som: 5, unit: '億円' } })
  assert.deepEqual(ok.datasets.market.data.items.map((/** @type {any} */ i) => i.value), [100, 30, 5])
  const bad = run({ ...full(), market: { tam: 100, som: 5, unit: '億円' } })
  assert.equal(panelBy(bad, '市場規模'), undefined)
  assert.ok(bad.warnings.some((w) => w.includes('plan.market.sam') && w.includes('載せなかった')))
})

test('expandBizplan: ビジネスモデルは nodes と links があれば流れ図（横に長い帯を取る）、points だけなら箇条書き', () => {
  const r = run(full())
  assert.deepEqual(r.datasets.model.data, { nodes: [{ id: 'a', name: '取引先' }, { id: 'b', name: '工場' }], links: [{ from: 'a', to: 'b', label: '発注' }] })
  assert.ok(panelBy(r, 'ビジネスモデル').span > 1, '流れ図は幅を広く取る')
  const pts = run({ ...full(), model: { points: ['月額', '導入費'] } })
  assert.deepEqual(panelBy(pts, 'ビジネスモデル').list, ['月額', '導入費'])
  assert.equal(pts.datasets.model, undefined)
})

test('expandBizplan: 競合は立ち位置の 2 軸（札の組か軸の名前）か、機能の比べの表', () => {
  const r = run(full())
  const d = r.datasets.competition.data
  assert.deepEqual(d.x, ['重い', '軽い'])
  assert.deepEqual(d.y, ['特化：低', '特化：高'])
  assert.deepEqual(d.points, [{ name: '表計算', x: 0.8, y: 0.1 }, { name: '自社', x: 0.8, y: 0.9, self: true }])
  const table = run({ ...full(), competition: { columns: ['自社', '他社'], rows: [{ name: '在庫', values: [true, false] }, { name: '価格', values: ['安い', '高い'] }] } })
  const t = panelBy(table, '競合との比較')
  assert.deepEqual(t.table.head, ['', '自社', '他社'])
  assert.deepEqual(t.table.rows, [['在庫', '○', '×'], ['価格', '安い', '高い']])
})

test('expandBizplan: 立ち位置の x と y が 0〜1 の外なら端に寄せて warnings に書く', () => {
  const r = run({ ...full(), competition: { x: 'a', y: 'b', players: [{ name: 'p', x: 1.5, y: -2 }] } })
  assert.deepEqual(r.datasets.competition.data.points, [{ name: 'p', x: 1, y: 0 }])
  assert.ok(r.warnings.some((w) => w.includes('0 から 1')))
})

test('expandBizplan: 実績は 1 つの KPI の帯に並べ（枚を分けない）、増減は delta で渡す', () => {
  const kpis = Array.from({ length: 5 }, (_, i) => ({ name: `k${i}`, value: i * 1000, delta: i }))
  const r = run({ ...full(), traction: { kpis } })
  const p = panelBy(r, '実績')
  assert.equal(p.kpi.length, 5)
  assert.equal(p.kpi[1].delta, 1)
  assert.equal(r.slides.filter((s) => s.panels).length, 3)
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
  assert.equal(panelBy(r, 'ロードマップ').look.kind, 'milestones')
  assert.deepEqual(r.datasets.roadmap.data.items, [{ date: '今期', name: '初期' }])
  const ms = run({ ...full(), roadmap: { milestones: [{ date: '2027-03', name: '公開', done: true }, { date: '2027-09', name: '拡大' }] } })
  assert.deepEqual(ms.datasets.roadmap.data.items, [{ date: '2027-03', name: '公開', done: true }, { date: '2027-09', name: '拡大' }])
})

test('expandBizplan: 収支は利益を引き算で出し、売上・費用の推移・年平均成長率・黒字化の年・利益率・累積赤字の最大を要点の panel に書く', () => {
  const r = run(full())
  assert.deepEqual(r.datasets.financials.data, { x: ['2027', '2028', '2029'], revenue: [2, 4.5, 9], cost: [2.8, 4.8, 8], profit: [-0.8, -0.3, 1], unit: '億円' })
  const points = panelBy(r, '数字から言えること').list
  assert.equal(points.length, 6)
  assert.match(points[0], /売上\*\* 2027 2億円 → 2029 9億円/)
  assert.match(points[1], /費用\*\* 2027 2\.8億円 → 2029 8億円/)
  assert.match(points[2], /年平均成長率\*\* 112%（2 年）/)
  assert.match(points[3], /黒字化\*\* 2029（3 年目）/)
  assert.match(points[4], /利益率\*\* 11\.1%/)
  assert.match(points[5], /累積赤字の最大\*\* 1\.1億円（2028）/)
})

test('expandBizplan: 初年度から黒字・最後まで赤字・1 年だけの収支でも要点の文が合う', () => {
  const pointsOf = (/** @type {any} */ fin) => panelBy(run({ ...full(), financials: fin }), '数字から言えること').list.join('\n')
  assert.match(pointsOf({ years: ['1', '2'], revenue: [5, 6], cost: [1, 1], unit: '円' }), /初年度から黒字/)
  assert.match(pointsOf({ years: ['1', '2'], revenue: [1, 2], cost: [3, 4], unit: '円' }), /期間内は赤字/)
  const one = pointsOf({ years: ['2027'], revenue: [5], cost: [3], unit: '円' })
  assert.doesNotMatch(one, /年平均成長率/)
  assert.doesNotMatch(one, /累積赤字/)
})

test('expandBizplan: 収支の個数がずれていれば少ない方に合わせ、数でない値があれば panel を作らない', () => {
  const skew = run({ ...full(), financials: { years: ['1', '2', '3'], revenue: [1, 2], cost: [1, 1, 1], unit: '円' } })
  assert.deepEqual(skew.datasets.financials.data.x, ['1', '2'])
  assert.ok(skew.warnings.some((w) => w.includes('個数が違う')))
  const nan = run({ ...full(), financials: { years: ['1'], revenue: ['多い'], cost: [1], unit: '円' } })
  assert.equal(panelBy(nan, '収支計画'), undefined)
  assert.equal(panelBy(nan, '数字から言えること'), undefined, '図が無ければ要点も載せない')
  assert.ok(nan.warnings.some((w) => w.includes('数でない')))
})

test('expandBizplan: チームは人数によらず「氏名・役割・経歴」の表（体制図は使わない）', () => {
  const small = panelBy(run(full()), 'チーム')
  assert.deepEqual(small.table.head, ['氏名', '役割', '経歴'])
  assert.deepEqual(small.table.rows, [['A', '代表', ''], ['B', '技術', '']])
  const members = Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, role: 'r' }))
  const big = run({ ...full(), team: { members } })
  assert.equal(panelBy(big, 'チーム').table.rows.length, 5)
  assert.equal(big.datasets.team, undefined)
})

test('expandBizplan: 資金調達は使い道の円（題に調達額）で、合計が違う時は円の中央の合計を渡さず warnings に書く', () => {
  const ok = run(full())
  assert.deepEqual(ok.datasets.funding.data, { items: [{ name: '開発', value: 2 }, { name: '営業', value: 1 }], unit: '億円', total: 3 })
  assert.equal(fundingOf(ok).title, '資金調達 3億円')
  assert.equal(fundingOf(ok).look.kind, 'donut')
  const diff = run({ ...full(), funding: { amount: 5, unit: '億円', use: [{ name: '開発', value: 2 }, { name: '営業', value: 1 }] } })
  assert.equal(diff.datasets.funding.data.total, undefined)
  assert.ok(diff.warnings.some((w) => w.includes('合計が amount と違う')))
  assert.equal(fundingOf(diff).title, '資金調達 5億円')
})

test('expandBizplan: リスクは「リスク」「対応」の 2 列の表', () => {
  const t = panelBy(run(full()), 'リスクと対応')
  assert.deepEqual(t.table.head, ['リスク', '対応'])
  assert.deepEqual(t.table.rows, [['大手が参入', '現場に特化']])
})

test('expandBizplan: 結びは一言と次の一歩で、一言が無ければひとこと・会社名の順に使う', () => {
  const closing = (/** @type {Record<string, any>} */ p) => /** @type {any} */ (run(p).slides.at(-1))
  assert.deepEqual(closing({ ...full(), closing: { message: 'ありがとう', next: ['来週 面談'] } }), { layout: 'closing', title: 'ありがとう', items: ['来週 面談'] })
  assert.equal(closing(full()).title, '町工場の受注を 1 つの画面にそろえる')
  assert.equal(closing({ company: '会社' }).title, '会社')
  assert.equal(closing(full()).items[0], '資金調達 3億円（用途: 開発・営業）')
})

test('expandBizplan: 足りない項目は panel を作らず、plan のどの項目かを warnings に書く（panel が 1 つも無い枚は作らない）', () => {
  const r = run({})
  assert.deepEqual(r.slides, [])
  for (const key of ['plan.company', 'plan.summary', 'plan.problem.points', 'plan.solution.points', 'plan.market', 'plan.model', 'plan.competition', 'plan.traction.kpis', 'plan.roadmap', 'plan.financials', 'plan.team.members', 'plan.funding.use', 'plan.risks']) {
    assert.ok(r.warnings.some((w) => w.startsWith(key)), key)
  }
  assert.ok(r.warnings.every((w) => w.includes('載せなかった') || w.includes('作らなかった')))
  const partial = run({ company: '会社', risks: [{ risk: 'r', answer: 'a' }] })
  assert.deepEqual(partial.slides.map((s) => s.layout), ['cover', 'grid', 'closing'], '残った panel だけで枚を作る')
  assert.equal(partial.slides[1].panels.length, 1)
  assert.equal(partial.slides[1].arrange, undefined, '1 行だけなら並べ方は auto')
})

test('expandBizplan: 1 つの項目が壊れていても、ほかの panel は作る', () => {
  const evil = { name: 'A' }
  Object.defineProperty(evil, 'role', { get() { throw new Error('boom') } })
  const r = run({ ...full(), team: { members: [evil] }, problem: 5, risks: 'x' })
  assert.equal(panelBy(r, 'チーム'), undefined)
  assert.ok(r.warnings.some((w) => w.includes('plan.team') && w.includes('読めなかった')))
  assert.equal(panelBy(r, '課題'), undefined)
  assert.ok(panelBy(r, '市場規模'))
  assert.ok(panelBy(r, '収支計画'))
})

test('expandBizplan: 英語では panel の題と要点の文が英語になる', () => {
  const r = run(full(), 'en')
  for (const title of ['Problem', 'The size of the problem', 'Solution', 'Market size', 'Competition', 'Traction', 'Business model', 'Roadmap', 'Team', 'Financial plan', 'What the numbers say', 'Risks and responses']) {
    assert.ok(panelBy(r, title), title)
  }
  assert.equal(r.slides[0].kicker, 'Business plan')
  assert.equal(r.slides[2].title, 'Traction, Business model, Team')
  assert.match(panelBy(r, 'What the numbers say').list[2], /CAGR\*\* 112% \(2 yr\)/)
  assert.match(panelBy(r, 'What the numbers say').list[3], /Break-even\*\* 2029 \(3rd year\)/)
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

test('bizplan: schema を通すと、全部の panel が検査に通って警告なしで資料の Doc になる', () => {
  const { doc, warnings } = normalize({ title: '事業計画', template: 'bizplan', plan: full() })
  assert.deepEqual(warnings, [])
  assert.equal(doc.kind, 'deck')
  assert.equal(doc.slides?.length, 5)
  const panels = /** @type {any} */ (doc.slides).flatMap((/** @type {any} */ s) => s.panels ?? [])
  assert.equal(panels.length, 13)
  for (const p of panels.filter((/** @type {any} */ x) => x.blocks?.[0]?.type === 'chart')) assert.ok(p.blocks[0].data && p.blocks[0].dataset, p.title)
})

test('bizplan: 組版すると 1 枚が 1 頁になる', () => {
  const { layout } = compose({ title: '事業計画', template: 'bizplan', plan: full() }, { metrics })
  assert.equal(layout.pages.length, 5)
})
