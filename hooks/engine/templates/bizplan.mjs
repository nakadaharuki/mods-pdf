// @ts-check
// 事業計画の型（template: 'bizplan'）。plan を資料の slides に広げる。純な部品。
// 頁の順は docs/deck.md の 7 章: 表紙 → サマリー → 課題 → 解決策 → 市場規模 → ビジネスモデル → 競合 → 実績 → ロードマップ → 収支 → チーム → 資金調達 → リスク → 結び。
// 数字は datasets に入れ、図は dataset の名前で呼ぶ（金融のデータも後で同じ入口に入れる。利用者が同じ名前の datasets を渡せば、そちらが使われる）。
//
// 選ばなかった案:
//   - 頁ごとに「題は主張の文」を求める案: plan に主張の文は無い。題は話題の札（課題・市場規模…）にして、数字から言える事実（成長率・黒字化の年）だけを要点に添える。
//   - 数字を頁の文に直接書く案: 金融のデータを後で差し込めなくなる。図は dataset で呼び、要点の文だけ plan の数字から作る。
//   - 欠けた頁を空の枠で残す案: 見る人に「後で埋める」頁を渡すことになる。頁を作らず、warnings に「plan.xxx が無いので○○の頁を作らなかった」と書く。
//   - サマリーを複数の箇条書きの頁にする案: 型は statement か kpi。最初の文を大きく出し、残りを補足にする（箇条書きは課題と解決策の頁が受ける）。
//   - 体制図の根を最初のメンバーにする案: 平らな名簿から上下の関係は読めない。根は会社名にして、全員を同じ段に置く。

import { formatNumber } from '../inline.mjs'

/** 頁の札と文。warnings は言語に関わらず日本語（Claude に返す物なので） */
const TEXT = {
  ja: {
    plan: '事業計画', summary: 'サマリー', problem: '課題', problemStat: '課題の大きさ', solution: '解決策', market: '市場規模',
    model: 'ビジネスモデル', competition: '競合との比較', traction: '実績', tractionMore: '実績（続き）', roadmap: 'ロードマップ',
    financials: '収支計画', team: 'チーム', funding: '資金調達', fundingAmount: '調達額', risks: 'リスクと対応', riskCol: 'リスク', answerCol: '対応',
    sources: '出典', next: '次の一歩', low: '：低', high: '：高', lowDefault: '低', highDefault: '高', join: '　',
    revenue: '売上', cagr: '年平均成長率', years: '年', blackFirst: '収支', blackFromStart: '初年度から黒字', blackIn: '黒字化', deficit: '収支', deficitAll: '期間内は赤字',
    lastYear: '最終年', som: '狙う市場（SOM）は', somTail: 'TAM の', somEnd: 'にあたる。',
    raise: '資金調達', usePrefix: '用途', marketAlt: '市場規模', flowAlt: '仕組みの図', matrixAlt: '競合の立ち位置', roadmapAlt: 'ロードマップ', pnlAlt: '売上と費用の見通し', orgAlt: '体制図', donutAlt: '資金の使い道',
  },
  en: {
    plan: 'Business plan', summary: 'Summary', problem: 'Problem', problemStat: 'The size of the problem', solution: 'Solution', market: 'Market size',
    model: 'Business model', competition: 'Competition', traction: 'Traction', tractionMore: 'Traction (continued)', roadmap: 'Roadmap',
    financials: 'Financial plan', team: 'Team', funding: 'Funding', fundingAmount: 'Raising', risks: 'Risks and responses', riskCol: 'Risk', answerCol: 'Response',
    sources: 'Sources', next: 'Next steps', low: ': low', high: ': high', lowDefault: 'Low', highDefault: 'High', join: ' ',
    revenue: 'Revenue', cagr: 'CAGR', years: 'yr', blackFirst: 'Profit', blackFromStart: 'profitable from the first year', blackIn: 'Break-even', deficit: 'Profit', deficitAll: 'a loss throughout the period',
    lastYear: 'final year', som: 'Our obtainable market (SOM) is', somTail: 'about', somEnd: 'of TAM.',
    raise: 'Raising', usePrefix: 'for', marketAlt: 'Market size', flowAlt: 'How the business works', matrixAlt: 'Competitive positioning', roadmapAlt: 'Roadmap', pnlAlt: 'Revenue and cost outlook', orgAlt: 'Organization chart', donutAlt: 'Use of funds',
  },
}

/** 体制図の人数の上限（根の会社を含めて 30 人まで） */
const ORG_MAX = 30
/** KPI の頁 1 枚に並べる数 */
const KPI_PER_PAGE = 4
/** 解決策を比べのカードにする時の、見出しの字数の上限 */
const HEAD_MAX = 24

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {string} */
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
/** 数か、桁区切り付きの数の字。読めなければ NaN @param {unknown} v @returns {number} */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}
/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : [])
/** @param {unknown} v @returns {string[]} 空でない字だけ */
const strs = (v) => list(v).map(str).filter((s) => s !== '')
/** 小数の割合を、% の字（1 桁）にする @param {number} x */
const pct = (x) => formatNumber(Math.round(x * 1000) / 10)

/**
 * 「見出し：説明」の形なら分ける（比べのカードにする時だけ使う）
 * @param {string} s
 * @returns {{ head: string, body: string } | null}
 */
function splitHead(s) {
  const at = [s.indexOf('：'), s.indexOf(': ')].filter((i) => i > 0 && i <= HEAD_MAX)
  if (!at.length) return null
  const i = Math.min(...at)
  const head = s.slice(0, i).trim()
  const body = s.slice(i + (s[i] === '：' ? 1 : 2)).trim()
  return head && body ? { head, body } : null
}

/**
 * 軸の名前から、軸の両端の札を作る。[低, 高] の組なら、そのまま
 * @param {unknown} v
 * @param {typeof TEXT.ja} t
 * @returns {[string, string]}
 */
function axisPair(v, t) {
  if (Array.isArray(v) && v.length >= 2 && str(v[0]) && str(v[1])) return [str(v[0]), str(v[1])]
  const s = str(v)
  return s ? [`${s}${t.low}`, `${s}${t.high}`] : [t.lowDefault, t.highDefault]
}

/** 月の日数（うるう年を入れる）。Date を使わず数で出す @param {number} y @param {number} m 1〜12 */
const daysIn = (y, m) => (m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31)

/**
 * 日付の字を YYYY-MM-DD にする。YYYY-MM（/ も可）は月の初日か末日。読めなければ空
 * @param {string} s
 * @param {boolean} last 月だけの時に末日にするか
 * @returns {string}
 */
function ymd(s, last) {
  const m = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(s.trim())
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return ''
  const d = m[3] !== undefined ? Number(m[3]) : last ? daysIn(y, mo) : 1
  if (d < 1 || d > daysIn(y, mo)) return ''
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 英語の「n 年目」: 1st year・2nd year @param {number} n */
const ordinalYear = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10 < 4 ? n % 10 : 0]} year`

/** @param {string[]} items @returns {Record<string, any>} 箇条書きの Block */
const bullets = (items) => ({ type: 'list', ordered: false, items })

/**
 * plan を slides に広げる。足りない項目の頁は作らず、warnings に「plan.xxx が無いので○○の頁を作らなかった」と書く。
 * 返す slides は schema の cleanSlide が検査する前の形（字は字のまま、図は dataset の名前で呼ぶ）。
 * @param {Record<string, any>} plan
 * @param {{ lang?: string }} [opts]
 * @returns {{ slides: Record<string, any>[], datasets: Record<string, { data: Record<string, any>, source?: string }>, warnings: string[] }}
 */
export function expandBizplan(plan, opts = {}) {
  const t = opts.lang === 'en' ? TEXT.en : TEXT.ja
  const p = isObj(plan) ? plan : {}
  /** @type {Record<string, any>[]} */
  const slides = []
  /** @type {Record<string, { data: Record<string, any>, source?: string }>} */
  const datasets = {}
  /** @type {string[]} */
  const warnings = []
  const company = str(p.company)
  const tagline = str(p.tagline)

  /** @param {string} path @param {string} page */
  const skip = (path, page) => warnings.push(`plan.${path} が無いので${page}の頁を作らなかった`)
  /**
   * 頁を 1 つ作る。読めない形で投げても、ほかの頁は作る
   * @param {string} path @param {string} page @param {() => void} fn
   */
  const page = (path, page, fn) => {
    try {
      fn()
    } catch {
      warnings.push(`plan.${path} を読めなかったので${page}の頁を作らなかった`)
    }
  }
  /** 数字の入口を足して、その名前を返す @param {string} id @param {Record<string, any>} data @param {unknown} [source] */
  const dataset = (id, data, source) => {
    datasets[id] = { data }
    const s = str(source)
    if (s) datasets[id].source = s
    return id
  }
  /** 頁の頭: kicker は会社名（走る見出し） @param {string} title @param {Record<string, any>} rest */
  const slide = (title, rest) => ({ layout: 'content', ...(company ? { kicker: company } : {}), title, ...rest })

  // 表紙
  if (company) slides.push({ layout: 'cover', kicker: t.plan, title: company, ...(tagline ? { lead: tagline } : {}), ...(str(p.date) ? { date: str(p.date) } : {}) })
  else skip('company', '表紙')

  // サマリー: 最初の文を大きく、残りを補足に
  const summary = strs(p.summary)
  if (summary.length) {
    slides.push({ layout: 'statement', kicker: t.summary, title: summary[0], ...(summary.length > 1 ? { lead: summary.slice(1).join(t.join) } : {}) })
  } else skip('summary', 'サマリー')

  // 課題: 箇条書きと、数字の頁
  page('problem', '課題', () => {
    const pr = p.problem
    const points = isObj(pr) ? strs(pr.points) : []
    if (points.length) slides.push(slide(t.problem, { layout: 'content', blocks: [bullets(points)] }))
    else skip('problem.points', '課題')
    if (isObj(pr) && isObj(pr.stat) && str(pr.stat.value) !== '') {
      const stat = pr.stat
      slides.push(slide(t.problemStat, {
        layout: 'kpi',
        items: [{ label: str(stat.label), value: typeof stat.value === 'number' ? stat.value : str(stat.value) }],
        ...(str(stat.source) ? { sources: [str(stat.source)] } : {}),
      }))
    }
  })

  // 解決策: 「見出し：説明」の形が 2〜3 個なら比べのカード、そうでなければ箇条書き
  page('solution', '解決策', () => {
    const points = isObj(p.solution) ? strs(p.solution.points) : []
    if (!points.length) {
      skip('solution.points', '解決策')
      return
    }
    const heads = points.map(splitHead)
    if (points.length >= 2 && points.length <= 3 && heads.every((h) => h)) {
      slides.push(slide(t.solution, {
        layout: 'compare',
        items: heads.map((h) => ({ title: /** @type {{ head: string, body: string }} */ (h).head, points: [/** @type {{ head: string, body: string }} */ (h).body] })),
      }))
    } else {
      slides.push(slide(t.solution, { layout: 'content', blocks: [bullets(points)] }))
    }
  })

  // 市場規模: 入れ子の円
  page('market', '市場規模', () => {
    const m = p.market
    if (!isObj(m)) {
      skip('market', '市場規模')
      return
    }
    const names = /** @type {const} */ (['tam', 'sam', 'som'])
    const vals = names.map((k) => num(isObj(m[k]) ? m[k].value : m[k]))
    const missing = names.find((_, i) => !(vals[i] >= 0))
    if (missing) {
      skip(`market.${missing}`, '市場規模')
      return
    }
    const unit = str(m.unit)
    const items = names.map((k, i) => {
      const label = isObj(m[k]) ? str(m[k].label) : ''
      return { name: k.toUpperCase(), value: vals[i], ...(label ? { note: label } : {}) }
    })
    const id = dataset('market', { items, unit }, m.source)
    const lead = vals[0] > 0 ? `${t.som} ${formatNumber(vals[2])}${unit}${opts.lang === 'en' ? ', ' : '、'}${t.somTail} ${pct(vals[2] / vals[0])}%${opts.lang === 'en' ? ' ' : ''}${t.somEnd}` : ''
    slides.push(slide(t.market, {
      layout: 'figure',
      ...(lead ? { lead } : {}),
      figure: { type: 'chart', kind: 'market', dataset: id, alt: `${t.marketAlt}: TAM ${formatNumber(vals[0])}${unit}, SAM ${formatNumber(vals[1])}${unit}, SOM ${formatNumber(vals[2])}${unit}` },
    }))
  })

  // ビジネスモデル: お金とサービスの流れ、無ければ箇条書き
  page('model', 'ビジネスモデル', () => {
    const mo = p.model
    if (!isObj(mo)) {
      skip('model', 'ビジネスモデル')
      return
    }
    const nodes = list(mo.nodes)
      .map((n) => (isObj(n) ? n : { id: n }))
      .map((n) => ({ id: str(n.id) || str(n.name), name: str(n.name) || str(n.id), ...(str(n.group) ? { group: str(n.group) } : {}) }))
      .filter((n) => n.id)
    const links = list(mo.links)
      .filter(isObj)
      .map((l) => ({ from: str(l.from), to: str(l.to), ...(str(l.label) ? { label: str(l.label) } : {}) }))
      .filter((l) => l.from && l.to)
    if (nodes.length && links.length) {
      const id = dataset('model', { nodes, links })
      slides.push(slide(t.model, { layout: 'figure', figure: { type: 'chart', kind: 'flowchart', dataset: id, alt: t.flowAlt } }))
      return
    }
    const points = strs(mo.points)
    if (points.length) slides.push(slide(t.model, { layout: 'content', blocks: [bullets(points)] }))
    else skip('model.nodes と model.links か model.points', 'ビジネスモデル')
  })

  // 競合: 立ち位置の 2 軸、無ければ機能の比べの表
  page('competition', '競合との比較', () => {
    const co = p.competition
    if (!isObj(co)) {
      skip('competition', '競合との比較')
      return
    }
    const players = list(co.players)
      .filter(isObj)
      .map((q) => ({ name: str(q.name), x: num(q.x), y: num(q.y), self: q.self === true }))
      .filter((q) => q.name && Number.isFinite(q.x) && Number.isFinite(q.y))
    if (players.length) {
      if (players.some((q) => q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1)) {
        warnings.push('plan.competition.players の x と y は 0 から 1 の数なので、範囲の外は端に寄せた')
      }
      const clamp = (/** @type {number} */ v) => Math.min(1, Math.max(0, v))
      const points = players.map((q) => ({ name: q.name, x: clamp(q.x), y: clamp(q.y), ...(q.self ? { self: true } : {}) }))
      const id = dataset('competition', { x: axisPair(co.x, t), y: axisPair(co.y, t), points })
      slides.push(slide(t.competition, { layout: 'figure', figure: { type: 'chart', kind: 'matrix2x2', dataset: id, alt: t.matrixAlt } }))
      return
    }
    const columns = strs(co.columns)
    const rows = list(co.rows).filter(isObj).filter((r) => str(r.name))
    if (columns.length && rows.length) {
      const cell = (/** @type {unknown} */ v) => (v === true ? String.fromCodePoint(0x25cb) : v === false ? String.fromCodePoint(0xd7) : str(v))
      slides.push(slide(t.competition, {
        layout: 'table',
        blocks: [{
          type: 'table',
          head: ['', ...columns],
          rows: rows.map((r) => [str(r.name), ...columns.map((_, i) => cell(list(r.values)[i]))]),
          align: ['left', ...columns.map(() => 'center')],
        }],
      }))
      return
    }
    skip('competition.players か competition.columns と competition.rows', '競合との比較')
  })

  // 実績: 数字の頁（4 つずつ）
  page('traction', '実績', () => {
    const tr = p.traction
    const kpis = isObj(tr) ? list(tr.kpis).filter(isObj).filter((k) => str(k.name) && (typeof k.value === 'number' || str(k.value))) : []
    if (!kpis.length) {
      skip('traction.kpis', '実績')
      return
    }
    for (let i = 0; i < kpis.length; i += KPI_PER_PAGE) {
      slides.push(slide(i === 0 ? t.traction : t.tractionMore, {
        layout: 'kpi',
        items: kpis.slice(i, i + KPI_PER_PAGE).map((k) => ({
          label: str(k.name),
          value: typeof k.value === 'number' ? k.value : str(k.value),
          ...(str(k.unit) ? { unit: str(k.unit) } : {}),
          ...(k.delta !== undefined && k.delta !== null && str(k.delta) !== '' ? { delta: typeof k.delta === 'number' ? k.delta : str(k.delta) } : {}),
        })),
      }))
    }
  })

  // ロードマップ: 期間なら gantt、節目なら milestones
  page('roadmap', 'ロードマップ', () => {
    const ro = p.roadmap
    if (!isObj(ro)) {
      skip('roadmap', 'ロードマップ')
      return
    }
    const spans = list(ro.items).filter(isObj).map((i) => ({ name: str(i.name), start: str(i.start), end: str(i.end) })).filter((i) => i.name && i.start && i.end)
    // gantt は YYYY-MM-DD だけ読む。YYYY-MM は月の初日と末日にする。読めない日付が 1 つでもあれば工程表にせず、節目の並びに回す
    const tasks = spans.map((s) => ({ name: s.name, start: ymd(s.start, false), end: ymd(s.end, true) }))
    if (tasks.length && tasks.every((s) => s.start && s.end)) {
      const id = dataset('roadmap', { tasks })
      slides.push(slide(t.roadmap, { layout: 'figure', figure: { type: 'chart', kind: 'gantt', dataset: id, alt: t.roadmapAlt } }))
      return
    }
    const fromMs = list(ro.milestones)
      .filter(isObj)
      .map((m) => ({ date: str(m.date), name: str(m.name), ...(m.done === true ? { done: true } : {}) }))
    const items = (fromMs.length ? fromMs : spans.map((s) => ({ date: s.start, name: s.name })))
      .filter((m) => m.date && m.name)
    if (items.length) {
      const id = dataset('roadmap', { items })
      slides.push(slide(t.roadmap, { layout: 'figure', figure: { type: 'chart', kind: 'milestones', dataset: id, alt: t.roadmapAlt } }))
      return
    }
    skip('roadmap.items か roadmap.milestones', 'ロードマップ')
  })

  // 収支計画: 売上と費用の棒・利益の線と、数字から言える要点
  page('financials', '収支計画', () => {
    const f = p.financials
    if (!isObj(f)) {
      skip('financials', '収支計画')
      return
    }
    const years = list(f.years).map(str)
    const revenue = list(f.revenue).map(num)
    const cost = list(f.cost).map(num)
    const n = Math.min(years.length, revenue.length, cost.length)
    if (n < 1) {
      skip('financials.years と revenue と cost', '収支計画')
      return
    }
    if (years.length !== revenue.length || years.length !== cost.length) {
      warnings.push(`plan.financials の years・revenue・cost の個数が違うので、少ない方の ${n} 年分だけ使った`)
    }
    const rv = revenue.slice(0, n)
    const co = cost.slice(0, n)
    if (rv.some((v) => !Number.isFinite(v)) || co.some((v) => !Number.isFinite(v))) {
      warnings.push('plan.financials の revenue か cost に数でない値があるので収支計画の頁を作らなかった')
      return
    }
    const ys = years.slice(0, n)
    const unit = str(f.unit)
    const profit = rv.map((v, i) => Math.round((v - co[i]) * 1e6) / 1e6)
    const id = dataset('financials', { x: ys, revenue: rv, cost: co, profit, unit }, f.source)
    const fmt = (/** @type {number} */ v) => `${formatNumber(v)}${unit}`
    /** @type {string[]} */
    const points = []
    const en = opts.lang === 'en'
    /** 補足の括弧。英語は半角 @param {string} x */
    const paren = (x) => (en ? ` (${x})` : `（${x}）`)
    points.push(n > 1 ? `**${t.revenue}** ${ys[0]} ${fmt(rv[0])} → ${ys[n - 1]} ${fmt(rv[n - 1])}` : `**${t.revenue}** ${ys[0]} ${fmt(rv[0])}`)
    if (n > 1 && rv[0] > 0 && rv[n - 1] > 0) {
      points.push(`**${t.cagr}** ${pct(Math.pow(rv[n - 1] / rv[0], 1 / (n - 1)) - 1)}%${paren(`${n - 1} ${t.years}`)}`)
    }
    const k = profit.findIndex((v) => v >= 0)
    if (k === 0) points.push(`**${t.blackFirst}** ${t.blackFromStart}${paren(ys[0])}`)
    else if (k > 0) points.push(`**${t.blackIn}** ${ys[k]}${paren(en ? ordinalYear(k + 1) : `${k + 1} 年目`)}`)
    else points.push(`**${t.deficit}** ${t.deficitAll}${paren(`${t.lastYear} ${fmt(profit[n - 1])}`)}`)
    slides.push(slide(t.financials, {
      layout: 'figure',
      figure: { type: 'chart', kind: 'pnl', dataset: id, alt: `${t.pnlAlt}: ${ys[0]}–${ys[n - 1]}` },
      side: [bullets(points)],
    }))
  })

  // チーム: 3 人までは人ごとのカード、それ以上は体制図（根は会社名）
  page('team', 'チーム', () => {
    const tm = p.team
    const members = isObj(tm) ? list(tm.members).filter(isObj).filter((m) => str(m.name)) : []
    if (!members.length) {
      skip('team.members', 'チーム')
      return
    }
    if (members.length <= 3) {
      slides.push(slide(t.team, {
        layout: 'compare',
        items: members.map((m) => ({ title: str(m.name), points: [str(m.role), str(m.note)].filter((s) => s !== '') })),
      }))
      return
    }
    const kids = members.slice(0, ORG_MAX - 1)
    if (members.length > kids.length) warnings.push(`plan.team.members が ${ORG_MAX - 1} 人を超えたので、体制図には先頭の ${ORG_MAX - 1} 人だけ載せた`)
    const id = dataset('team', { root: { name: company || t.team, children: kids.map((m) => ({ name: str(m.name), ...(str(m.role) ? { role: str(m.role) } : {}) })) } })
    slides.push(slide(t.team, { layout: 'figure', figure: { type: 'chart', kind: 'org', dataset: id, alt: t.orgAlt } }))
  })

  // 資金調達: 使い道の円と、調達額
  /** @type {string} */
  let raiseNote = ''
  page('funding', '資金調達', () => {
    const fu = p.funding
    const use = isObj(fu) ? list(fu.use).filter(isObj).map((u) => ({ name: str(u.name), value: num(u.value) })).filter((u) => u.name && u.value >= 0) : []
    if (!use.length) {
      skip('funding.use', '資金調達')
      return
    }
    const sum = use.reduce((a, u) => a + u.value, 0)
    const amount = num(fu.amount)
    const total = Number.isFinite(amount) ? amount : sum
    const unit = str(fu.unit)
    if (Number.isFinite(amount) && Math.abs(sum - amount) > 1e-6 * Math.max(1, Math.abs(amount))) {
      warnings.push('plan.funding の use の合計が amount と違う')
    }
    const id = dataset('funding', { items: use, unit, ...(Number.isFinite(amount) && Math.abs(sum - amount) <= 1e-6 * Math.max(1, Math.abs(amount)) ? { total: amount } : {}) })
    slides.push(slide(t.funding, {
      layout: 'figure',
      figure: { type: 'chart', kind: 'donut', dataset: id, alt: `${t.donutAlt}: ${use.map((u) => u.name).join(opts.lang === 'en' ? ', ' : '・')}` },
      side: [{ type: 'keys', items: [{ label: t.fundingAmount, value: `${formatNumber(total)}${unit}` }] }],
    }))
    const names = use.map((u) => u.name).join(opts.lang === 'en' ? ', ' : '・')
    raiseNote = opts.lang === 'en' ? `${t.raise} ${formatNumber(total)}${unit} ${t.usePrefix} ${names}` : `${t.raise} ${formatNumber(total)}${unit}（${t.usePrefix}: ${names}）`
  })

  // リスク: 表
  page('risks', 'リスクと対応', () => {
    const rows = list(p.risks).filter(isObj).filter((r) => str(r.risk))
    if (!rows.length) {
      skip('risks', 'リスクと対応')
      return
    }
    slides.push(slide(t.risks, {
      layout: 'table',
      blocks: [{ type: 'table', head: [t.riskCol, t.answerCol], rows: rows.map((r) => [str(r.risk), str(r.answer)]), widths: [2, 3] }],
    }))
  })

  // 出典（plan に書かれていれば、結びの前に 1 枚）
  const sources = strs(p.sources)
  if (sources.length) slides.push(slide(t.sources, { layout: 'content', blocks: [bullets(sources)] }))

  // 結び: 一言（plan.closing.message か tagline か会社名）と、次の一歩（plan.closing.next か資金調達の一文）
  const closing = isObj(p.closing) ? p.closing : {}
  const next = strs(closing.next)
  if (!next.length && raiseNote) next.push(raiseNote)
  const closingTitle = str(closing.message) || tagline || company
  if (closingTitle || next.length) slides.push({ layout: 'closing', ...(closingTitle ? { title: closingTitle } : {}), ...(next.length ? { items: next } : {}) })

  return { slides, datasets, warnings }
}
