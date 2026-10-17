// @ts-check
// samples/portfolio.json（架空の 10 銘柄ポートフォリオの運用報告・横 A4 の 4 枚）を、samples/portfolio-data の 2 つの CSV から作る。
//   node scripts/make-portfolio-sample.mjs
// 公式（Typst など）と同じ条件で比べる時の手本: 同じ CSV と同じ指示（4 枚・図 3〜5 個・要点の文）から、数字を全部計算して原稿にする。
// 文の中の数字も図の数字も、ここで計算した同じ値から書く（食い違いを出さない）。
//
// 選ばなかった案
// - 数字を原稿に手で書く案: CSV を差し替えた時に文と図がずれる。計算を全部ここに置く。
// - 売買を促す語を使う案: 架空の見本なので、騰落と比重の事実だけを書き、評価や助言の語は使わない。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'samples', 'portfolio-data')

/** @param {string} file */
function readCsv(file) {
  const lines = fs.readFileSync(path.join(DATA, file), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])))
}

const holdings = readCsv('holdings.csv').map((r) => ({ ticker: r.ticker, name: r.name, sector: r.sector, weight: Number(r.weight_pct), target: Number(r.target_pct) }))
const rows = readCsv('prices.csv')
const dates = rows.map((r) => r.date)
const N = dates.length
const px = (/** @type {string} */ t) => rows.map((r) => Number(r[t]))
const wsum = holdings.reduce((s, h) => s + h.weight, 0)

// ロゴの印（取引所:コード）。mods-pdf-logos に無い銘柄は印を付けない（付けると「ロゴが無い」の警告が出る）
const LOGO = /** @type {Record<string, string | null>} */ ({
  NVDA: 'NASDAQ:NVDA', MSFT: 'NASDAQ:MSFT', AAPL: 'NASDAQ:AAPL', GOOGL: null, AMZN: 'NASDAQ:AMZN', META: 'NASDAQ:META',
  AVGO: 'NASDAQ:AVGO', TSLA: 'NASDAQ:TSLA', '7203': 'TSE:7203', '6758': 'TSE:6758',
})

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10
const fmt = (/** @type {number} */ n, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const sign = (/** @type {number} */ n, d = 1) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(n), d)}`

// ---- 計算 ----
for (const h of holdings) {
  const p = px(h.ticker)
  Object.assign(h, { p, ret: (p[N - 1] / p[0] - 1) * 100 })
}
/** @type {any[]} */
const H = holdings
// ポートフォリオ = weight_pct の比で各銘柄の指数を足し合わせた物（途中で組み換えない）。期首を 100 に直して比べる
const navRaw = Array.from({ length: N }, (_, i) => H.reduce((s, h) => s + (h.weight / wsum) * h.p[i], 0))
const nav = navRaw.map((v) => (v / navRaw[0]) * 100)
const benchRaw = px('BENCH')
const bench = benchRaw.map((v) => (v / benchRaw[0]) * 100)
const navRet = nav[N - 1] - 100
const benchRet = bench[N - 1] - 100
const diff = navRet - benchRet
let peak = 0
let mdd = 0
let peakAt = 0
let troughAt = 0
let curPeakAt = 0
const dd = nav.map((v, i) => {
  if (v > peak) { peak = v; curPeakAt = i }
  const d = ((peak - v) / peak) * 100
  if (d > mdd) { mdd = d; peakAt = curPeakAt; troughAt = i }
  return d
})
const VALUE0 = 1000
const value = VALUE0 * (nav[N - 1] / 100)

/** 月ごとの騰落: 月末の指数どうし（最初の月は期首から） */
const monthEnd = []
for (let i = 0; i < N; i++) if (i === N - 1 || dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) monthEnd.push(i)
const monthRet = monthEnd.map((end, k) => (nav[end] / (k ? nav[monthEnd[k - 1]] : nav[0]) - 1) * 100)
const monthLabel = monthEnd.map((end) => `${Number(dates[end].slice(5, 7))}月`)
const upMonths = monthRet.filter((v) => v > 0).length

/** 寄与（期首の評価額を 100 とした pt）。銘柄ごとの寄与の合計は全体の騰落に一致する */
const k0 = 100 / H.reduce((s, h) => s + (h.weight / wsum) * h.p[0], 0)
for (const h of H) h.contrib = (h.weight / wsum) * (h.p[N - 1] - h.p[0]) * k0
const sectors = [...new Set(H.map((h) => h.sector))]
const sectorWeight = sectors.map((s) => [s, H.filter((h) => h.sector === s).reduce((a, h) => a + h.weight, 0)]).sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]))

/** 年率の値動き: 日次の騰落率の標準偏差 × √250 */
function annualVol(/** @type {number[]} */ p) {
  const r = p.slice(1).map((v, i) => v / p[i] - 1)
  const m = r.reduce((a, b) => a + b, 0) / r.length
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(250) * 100
}
for (const h of H) h.vol = annualVol(h.p)

/** 四半期ごとの業種別の寄与 */
// 暦の四半期の末（12 月・3 月・6 月）の最後の営業日の添字
const lastIndexTo = (/** @type {string} */ ym) => dates.reduce((acc, d, i) => (d.slice(0, 7) <= ym ? i : acc), 0)
const calEnds = [0, lastIndexTo('2025-12'), lastIndexTo('2026-03'), lastIndexTo('2026-06'), N - 1]
const qLabel = ['10〜12月', '1〜3月', '4〜6月', '7〜9月']
// 業種の比重の円と同じ並び（色は並びの順に付くので、同じ業種が図ごとに違う色にならない）
const qContrib = sectorWeight.map(([s]) => ({
  name: s,
  data: qLabel.map((_, q) => r1(H.filter((h) => h.sector === s).reduce((a, h) => a + (h.weight / wsum) * (h.p[calEnds[q + 1]] - h.p[calEnds[q]]) * k0, 0))),
}))

/** 1 桁に丸めた値の合計が、全体を 1 桁に丸めた値と一致するように、丸めの端数を大きい順に配る（図の合計と文の数字を一致させる） */
function roundToTotal(/** @type {number[]} */ xs) {
  const target = Math.round(xs.reduce((a, b) => a + b, 0) * 10)
  const scaled = xs.map((x) => x * 10)
  const base = scaled.map(Math.floor)
  let rest = target - base.reduce((a, b) => a + b, 0)
  const order = scaled.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (rest <= 0) break
    base[i] += 1
    rest -= 1
  }
  return base.map((v) => v / 10)
}
const byRet = [...H].sort((a, b) => b.ret - a.ret)
const byContrib = [...H].sort((a, b) => b.contrib - a.contrib)
const contribShown = roundToTotal(byContrib.map((h) => h.contrib))
const weightedGap = H.filter((h) => h.weight !== h.target)
const biggestGap = [...H].sort((a, b) => Math.abs(b.weight - b.target) - Math.abs(a.weight - a.target))[0]
const top6 = [...H].sort((a, b) => b.weight - a.weight).slice(0, 6)
const dayRet = nav.slice(1).map((v, i) => (v / nav[i] - 1) * 100)
const lastDate = dates[N - 1]
const dateJa = (/** @type {string} */ d) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const md = (/** @type {string} */ d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

const tableRow = (/** @type {any} */ h) => [LOGO[h.ticker] ? { text: h.ticker, logo: LOGO[h.ticker] } : h.ticker, h.name, h.sector, String(h.weight), String(h.target), sign(h.ret)]
const SRC = '架空の数字（samples/portfolio-data の 2 つの CSV から計算）'
const FAKE = 'すべて架空の数字で、実在の株価ではありません。'
const alt = (/** @type {string} */ s) => s

// ---- 原稿 ----
const slides = [
  {
    layout: 'grid',
    kicker: `仮ポートフォリオ 運用報告 ${dateJa(dates[0])}〜${dateJa(lastDate)}`,
    title: `1 年で ${sign(navRet)}%、比べる指数（BENCH）より ${sign(diff)}pt`,
    lead: `${FAKE}10 銘柄を期首の比重（holdings.csv の weight_pct）のまま持ち続けた場合の計算で、期首の評価額は 1,000 万円。売買の案内ではありません。`,
    arrange: 'rows:1,2|0,1',
    panels: [
      {
        title: '要約',
        note: `${dateJa(lastDate)}時点`,
        kpi: [
          { label: '評価額', value: fmt(value, 0), unit: '万円', delta: `${sign(navRet)}%（1 年）`, trend: navRet >= 0 ? 'up' : 'down', note: '期首 1,000 万円' },
          { label: '1 年の騰落率', value: sign(navRet), unit: '%', delta: `BENCH は ${sign(benchRet)}%`, trend: navRet >= 0 ? 'up' : 'down', note: '期首を 100 とした指数の比' },
          { label: 'BENCH との差', value: sign(diff), unit: 'pt', trend: diff >= 0 ? 'up' : 'down', note: '騰落率の差' },
          { label: '高値からの最大下落', value: `-${fmt(mdd)}`, unit: '%', trend: 'down', note: `${md(dates[peakAt])} の高値から ${md(dates[troughAt])}` },
        ],
        source: SRC,
      },
      {
        title: '10 銘柄の比重と 1 年の騰落',
        note: '比重と目標は holdings.csv の値',
        table: {
          head: ['銘柄', '名前', '業種', '比重（%）', '目標（%）', '1 年の騰落（%）'],
          rows: H.map(tableRow),
          align: ['left', 'left', 'left', 'right', 'right', 'right'],
        },
        source: SRC,
      },
      {
        title: '値動きの大きさと 1 年の騰落',
        note: '円の面積は比重',
        look: {
          kind: 'scatter',
          data: {
            points: H.map((h) => [r1(h.vol), r1(h.ret), h.weight]),
            names: H.map((h) => h.ticker),
            xLabel: '年率の値動き（%）', yLabel: '1 年の騰落（%）', sizeLabel: '比重（%）',
          },
          alt: alt(`銘柄ごとの年率の値動きと 1 年の騰落。最も上げたのは ${byRet[0].ticker} の ${sign(byRet[0].ret)}%`),
        },
        source: SRC,
      },
    ],
  },
  {
    layout: 'grid',
    kicker: '値動き',
    title: `高値からの最大下落は ${fmt(mdd)}%。月ごとでは 12 か月のうち ${upMonths} か月が上昇`,
    lead: `${FAKE}ポートフォリオと BENCH を期首で 100 にそろえて比べた。下落は、その時点までの最高値からの距離。`,
    arrange: 'rows:1,3|1.5,1',
    panels: [
      {
        title: 'ポートフォリオと BENCH',
        note: '期首を 100 とした指数',
        look: {
          kind: 'multi-line',
          data: { x: dates, series: [{ name: 'ポートフォリオ', values: nav.map(r1) }, { name: 'BENCH', values: bench.map(r1) }], highlight: 'ポートフォリオ' },
          alt: alt(`期首を 100 とした指数。期末はポートフォリオが ${fmt(nav[N - 1])}、BENCH が ${fmt(bench[N - 1])}`),
        },
        source: SRC,
      },
      {
        title: '高値からの下落',
        note: '5% を超えた所を色で',
        look: {
          kind: 'area-threshold',
          data: { x: dates, series: [{ name: '下落', values: dd.map(r1) }], unit: '%', threshold: 5 },
          alt: alt(`高値からの下落。最大は ${md(dates[troughAt])} の ${fmt(mdd)}%`),
        },
        source: SRC,
      },
      {
        title: '月ごとの騰落',
        note: '月末の指数どうしの比',
        look: {
          kind: 'bars',
          data: { x: monthLabel, series: [{ name: '騰落', values: monthRet.map(r1) }], unit: '%' },
          alt: alt(`月ごとの騰落率。最も上げた月は ${monthLabel[monthRet.indexOf(Math.max(...monthRet))]}`),
        },
        source: SRC,
      },
      {
        title: '日々の騰落率の散らばり',
        note: `${N - 1} 営業日`,
        look: {
          kind: 'histogram',
          data: { groups: [{ name: '日次', values: dayRet.map((v) => Math.round(v * 100) / 100) }], unit: '%' },
          alt: alt('ポートフォリオの日次の騰落率の分布'),
        },
        source: SRC,
      },
    ],
  },
  {
    layout: 'grid',
    kicker: '中身',
    title: `${sectorWeight[0][0]}と${sectorWeight[1][0]}で比重の ${/** @type {number} */ (sectorWeight[0][1]) + /** @type {number} */ (sectorWeight[1][1])}%。寄与が最も大きいのは ${byContrib[0].ticker}`,
    lead: `${FAKE}寄与は期首の評価額を 100 とした pt で、10 銘柄を足すと全体の騰落（${sign(navRet)}pt）に一致する。`,
    arrange: 'rows:2,2',
    panels: [
      {
        title: '銘柄の比重と 1 年の騰落',
        span: 1.2,
        note: '面積は比重・数字は 1 年の騰落（%）',
        look: {
          kind: 'treemap',
          data: { root: { name: '比重', children: H.map((h) => ({ name: h.ticker, value: h.weight, delta: r1(h.ret) })) }, unit: '%', deltaLabel: '1 年' },
          alt: alt(`銘柄の比重。最大は ${H[0].ticker} の ${H[0].weight}%`),
        },
        source: SRC,
      },
      {
        title: '業種の比重',
        look: {
          kind: 'donut',
          data: { items: sectorWeight.map(([name, value]) => ({ name, value })), unit: '%' },
          alt: alt(`業種の比重。${sectorWeight.map(([n, v]) => `${n} ${v}%`).join('、')}`),
        },
        source: SRC,
      },
      {
        title: '1 年の騰落への寄与',
        span: 1.2,
        note: '期首を 100 とした pt',
        look: {
          kind: 'waterfall',
          data: { items: byContrib.map((h, i) => ({ name: h.ticker, value: contribShown[i] })), unit: 'pt' },
          alt: alt(`銘柄ごとの寄与。最大は ${byContrib[0].ticker} の ${sign(byContrib[0].contrib)}pt`),
        },
        source: SRC,
      },
      {
        title: '業種ごとの寄与（四半期）',
        note: 'pt',
        chart: { example: 'bar-y-category-stack', data: { categories: qLabel, series: qContrib.map((s) => ({ name: s.name, data: s.data })) } },
        source: SRC,
      },
    ],
  },
  {
    layout: 'grid',
    kicker: '比重と目標',
    title: `比重と目標の差が最も大きいのは ${biggestGap.ticker}（${biggestGap.weight}% に対して目標 ${biggestGap.target}%）`,
    lead: `${FAKE}目標は holdings.csv の target_pct。1 年の騰落は期首の指数に対する期末の比。`,
    arrange: 'rows:2,2|1.15,1',
    panels: [
      {
        title: '比重と目標',
        note: '丸は目標と比重',
        look: {
          kind: 'dumbbell',
          data: { items: H.map((h) => ({ name: h.ticker, from: h.target, to: h.weight })), fromLabel: '目標', toLabel: '比重', unit: '%' },
          alt: alt(`比重と目標。${weightedGap.length} 銘柄で比重が目標とずれている`),
        },
        source: SRC,
      },
      {
        title: '銘柄ごとの 1 年の騰落',
        look: {
          kind: 'lollipop',
          data: { items: byRet.map((h) => ({ name: h.ticker, value: r1(h.ret) })), unit: '%', highlight: byRet[0].ticker },
          alt: alt(`銘柄ごとの 1 年の騰落。最大は ${byRet[0].ticker} の ${sign(byRet[0].ret)}%、最小は ${byRet[9].ticker} の ${sign(byRet[9].ret)}%`),
        },
        source: SRC,
      },
      {
        title: '直近 60 日',
        note: '比重の上位 6 銘柄・60 日前を 100',
        look: {
          kind: 'sparks',
          data: { x: dates.slice(-60), series: top6.map((h) => ({ name: h.ticker, values: h.p.slice(-60).map((v) => r1((v / h.p[N - 60]) * 100)) })) },
          alt: alt('比重の上位 6 銘柄の直近 60 日の値動き'),
        },
        source: SRC,
      },
      {
        title: '数字の見方',
        list: [
          `期首の評価額を 1,000 万円とすると、${dateJa(lastDate)}の評価額は ${fmt(value, 0)} 万円（${sign(navRet)}%）。`,
          `BENCH の騰落は ${sign(benchRet)}%。差は ${sign(diff)}pt。`,
          `高値からの最大下落は ${fmt(mdd)}%（${md(dates[troughAt])}）。`,
          `1 年の騰落は ${byRet[0].ticker} が ${sign(byRet[0].ret)}%、${byRet[9].ticker} が ${sign(byRet[9].ret)}%。`,
          '数字はすべて架空で、売買の案内ではありません。',
        ],
        source: SRC,
      },
    ],
  },
]

const out = {
  title: '仮ポートフォリオ 運用報告 2026 年 9 月',
  author: 'ModsPDF の見本（数字はすべて架空）',
  lang: 'ja',
  kind: 'deck',
  theme: 'paper',
  slides,
}
fs.writeFileSync(path.join(ROOT, 'samples', 'portfolio.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`samples/portfolio.json: ${slides.length} 枚・評価額 ${fmt(value, 0)} 万円・騰落 ${sign(navRet)}%・BENCH ${sign(benchRet)}%・最大下落 ${fmt(mdd)}%・寄与の合計 ${sign(H.reduce((s, h) => s + h.contrib, 0))}pt`)
