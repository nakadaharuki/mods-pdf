// @ts-check
// 事業計画の型（template: 'bizplan'）。plan を資料の slides に広げる。純な部品。
// 並びは 表紙 → 概要（課題・大きさ・解決策／市場・競合）→ 仕組みと実績（実績の帯／ビジネスモデル・ロードマップ／チーム）→ 収支と資金（収支・要点／資金・使途・リスク）→ 結び。
// 1 枚に 3〜5 個の panel を詰め、1 つの図は 1 回だけ使う。数字は datasets に入れ、図は dataset の名前で呼ぶ（金融のデータも後で同じ入口に入れる。利用者が同じ名前の datasets を渡せば、そちらが使われる）。
//
// 選ばなかった案:
//   - 話題ごとに 1 枚（15〜16 枚）にする案: 1 枚に図 1 つと箇条書き 3 本では下半分が空き、証券会社の月次の報告のような密度にならない。panel で詰め、行の高さの比（rows:）で、字の行を低く図の行を高くする。
//   - 頁ごとに「題は主張の文」を求める案: plan に主張の文は無い。題は話題の札を並べ、概要だけ summary の最初の文を題にする。数字から言える事実（成長率・黒字化の年）だけを要点に添える。
//   - 数字を頁の文に直接書く案: 金融のデータを後で差し込めなくなる。図は dataset で呼び、要点の文だけ plan の数字から作る。
//   - 欠けた欄を空の枠で残す案: 見る人に「後で埋める」欄を渡すことになる。欄を作らず、warnings に「plan.xxx が無いので○○を載せなかった」と書く。
//   - 体制図（org）を残す案: 並べ方が 1 枚を占めて詰められず、3 人前後のチームは表で足りる。人数が多くても表の行は切って警告する。

import { formatNumber } from '../inline.mjs'

/** 欄の札と文。warnings は言語に関わらず日本語（Claude に返す物なので） */
const TEXT = {
  ja: {
    plan: '事業計画', problem: '課題', problemStat: '課題の大きさ', solution: '解決策', market: '市場規模',
    model: 'ビジネスモデル', competition: '競合との比較', traction: '実績', roadmap: 'ロードマップ',
    financials: '収支計画', financialsPoints: '数字から言えること', team: 'チーム', funding: '資金調達', risks: 'リスクと対応',
    riskCol: 'リスク', answerCol: '対応', nameCol: '氏名', roleCol: '役割', noteCol: '経歴',
    overview: '課題・解決策・市場', operation: '実績・仕組み・チーム', money: '収支・資金・リスク', sep: '・',
    low: '：低', high: '：高', lowDefault: '低', highDefault: '高', join: '　',
    revenue: '売上', cost: '費用', cagr: '年平均成長率', years: '年', blackFirst: '収支', blackFromStart: '初年度から黒字', blackIn: '黒字化', deficit: '収支', deficitAll: '期間内は赤字', margin: '利益率', cumLow: '累積赤字の最大',
    lastYear: '最終年', som: '狙う市場（SOM）は', somTail: 'TAM の', somEnd: 'にあたる。',
    raise: '資金調達', usePrefix: '用途', raising: '調達', marketAlt: '市場規模', flowAlt: '仕組みの図', matrixAlt: '競合の立ち位置', roadmapAlt: 'ロードマップ', pnlAlt: '売上と費用の見通し', donutAlt: '資金の使い道',
  },
  en: {
    plan: 'Business plan', problem: 'Problem', problemStat: 'The size of the problem', solution: 'Solution', market: 'Market size',
    model: 'Business model', competition: 'Competition', traction: 'Traction', roadmap: 'Roadmap',
    financials: 'Financial plan', financialsPoints: 'What the numbers say', team: 'Team', funding: 'Funding', risks: 'Risks and responses',
    riskCol: 'Risk', answerCol: 'Response', nameCol: 'Name', roleCol: 'Role', noteCol: 'Background',
    overview: 'Problem, solution and market', operation: 'Traction, model and team', money: 'Financials, funding and risks', sep: ', ',
    low: ': low', high: ': high', lowDefault: 'Low', highDefault: 'High', join: ' ',
    revenue: 'Revenue', cost: 'Cost', cagr: 'CAGR', years: 'yr', blackFirst: 'Profit', blackFromStart: 'profitable from the first year', blackIn: 'Break-even', deficit: 'Profit', deficitAll: 'a loss throughout the period', margin: 'Margin', cumLow: 'Peak cumulative loss',
    lastYear: 'final year', som: 'Our obtainable market (SOM) is', somTail: 'about', somEnd: 'of TAM.',
    raise: 'Raising', usePrefix: 'for', raising: 'Raising', marketAlt: 'Market size', flowAlt: 'How the business works', matrixAlt: 'Competitive positioning', roadmapAlt: 'Roadmap', pnlAlt: 'Revenue and cost outlook', donutAlt: 'Use of funds',
  },
}

/** 解決策を「見出し：説明」と見なす時の、見出しの字数の上限 */
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
 * plan を slides に広げる。足りない欄は作らず、warnings に「plan.xxx が無いので○○を載せなかった」と書く。
 * 返す slides は schema の cleanSlide が検査する前の形（字は字のまま、図は dataset の名前で呼ぶ）。
 * @param {Record<string, any>} plan
 * @param {{ lang?: string }} [opts]
 * @returns {{ slides: Record<string, any>[], datasets: Record<string, { data: Record<string, any>, source?: string }>, warnings: string[] }}
 */
export function expandBizplan(plan, opts = {}) {
  const en = opts.lang === 'en'
  const t = en ? TEXT.en : TEXT.ja
  const p = isObj(plan) ? plan : {}
  /** @type {Record<string, any>[]} */
  const slides = []
  /** @type {Record<string, { data: Record<string, any>, source?: string }>} */
  const datasets = {}
  /** @type {string[]} */
  const warnings = []
  const company = str(p.company)
  const tagline = str(p.tagline)

  /** @param {string} path @param {string} what */
  const skip = (path, what) => warnings.push(`plan.${path} が無いので${what}を載せなかった`)
  /**
   * 欄を 1 つ作る。読めない形で投げても、ほかの欄は作る
   * @param {string} path @param {string} what @param {() => Record<string, any> | null} fn
   * @returns {Record<string, any> | null}
   */
  const panel = (path, what, fn) => {
    try {
      return fn()
    } catch {
      warnings.push(`plan.${path} を読めなかったので${what}を載せなかった`)
      return null
    }
  }
  /** 数字の入口を足して、その名前を返す @param {string} id @param {Record<string, any>} data @param {unknown} [source] */
  const dataset = (id, data, source) => {
    datasets[id] = { data }
    const s = str(source)
    if (s) datasets[id].source = s
    return id
  }
  /** 図の欄 @param {string} title @param {string} kind @param {string} id @param {string} alt @param {Record<string, any>} [rest] */
  const look = (title, kind, id, alt, rest = {}) => ({ title, look: { kind, dataset: id, alt }, ...rest })
  /**
   * 行（panel の並び）から、1 枚の grid の slide を作る。空の欄と空の行は省く。
   * 行の重みは字の行を低く図の行を高くするためのもの。KPI だけの行は、重みを使わず KPI の自然な高さの帯になる。
   * @param {string} title @param {string | undefined} lead @param {{ w: number, panels: (Record<string, any> | null)[] }[]} rows @param {Record<string, any>} [rest]
   */
  const grid = (title, lead, rows, rest = {}) => {
    const kept = rows.map((r) => ({ w: r.w, panels: r.panels.filter((x) => x !== null) })).filter((r) => r.panels.length)
    const panels = kept.flatMap((r) => r.panels)
    if (!panels.length) return false
    const arrange = kept.length > 1 ? `rows:${kept.map((r) => r.panels.length).join(',')}|${kept.map((r) => r.w).join(',')}` : undefined
    slides.push({ layout: 'grid', ...(company ? { kicker: company } : {}), title, ...(lead ? { lead } : {}), panels, ...(arrange ? { arrange } : {}), ...rest })
    return true
  }

  // 表紙
  if (company) slides.push({ layout: 'cover', kicker: t.plan, title: company, ...(tagline ? { lead: tagline } : {}), ...(str(p.date) ? { date: str(p.date) } : {}) })
  else warnings.push('plan.company が無いので表紙を作らなかった')

  // ---- 1 枚目: 課題・課題の大きさ・解決策 ／ 市場・競合
  const summary = strs(p.summary)
  if (!summary.length) skip('summary', '概要の題と要点')

  const problem = panel('problem', t.problem, () => {
    const points = isObj(p.problem) ? strs(p.problem.points) : []
    if (!points.length) {
      skip('problem.points', t.problem)
      return null
    }
    return { title: t.problem, list: points }
  })
  const stat = panel('problem.stat', t.problemStat, () => {
    const s = isObj(p.problem) ? p.problem.stat : null
    if (!isObj(s) || str(s.value) === '') return null
    return { title: t.problemStat, kpi: [{ label: str(s.label), value: typeof s.value === 'number' ? s.value : str(s.value) }], ...(str(s.source) ? { source: str(s.source) } : {}) }
  })
  const solution = panel('solution', t.solution, () => {
    const points = isObj(p.solution) ? strs(p.solution.points) : []
    if (!points.length) {
      skip('solution.points', t.solution)
      return null
    }
    // 「見出し：説明」の形は見出しを太くする
    const items = points.map((s) => {
      const h = splitHead(s)
      return h ? `**${h.head}** ${h.body}` : s
    })
    return { title: t.solution, list: items }
  })
  const market = panel('market', t.market, () => {
    const m = p.market
    if (!isObj(m)) {
      skip('market', t.market)
      return null
    }
    const names = /** @type {const} */ (['tam', 'sam', 'som'])
    const vals = names.map((k) => num(isObj(m[k]) ? m[k].value : m[k]))
    const missing = names.find((_, i) => !(vals[i] >= 0))
    if (missing) {
      skip(`market.${missing}`, t.market)
      return null
    }
    const unit = str(m.unit)
    const items = names.map((k, i) => {
      const label = isObj(m[k]) ? str(m[k].label) : ''
      return { name: k.toUpperCase(), value: vals[i], ...(label ? { note: label } : {}) }
    })
    const id = dataset('market', { items, unit }, m.source)
    const note = vals[0] > 0 ? `SOM ${formatNumber(vals[2])}${unit}${en ? ', ' : '、'}TAM ${en ? 'share' : 'の'} ${pct(vals[2] / vals[0])}%` : ''
    return look(t.market, 'market', id, `${t.marketAlt}: TAM ${formatNumber(vals[0])}${unit}, SAM ${formatNumber(vals[1])}${unit}, SOM ${formatNumber(vals[2])}${unit}`, note ? { note } : {})
  })
  const competition = panel('competition', t.competition, () => {
    const co = p.competition
    if (!isObj(co)) {
      skip('competition', t.competition)
      return null
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
      return look(t.competition, 'matrix2x2', id, t.matrixAlt)
    }
    const columns = strs(co.columns)
    const rows = list(co.rows).filter(isObj).filter((r) => str(r.name))
    if (columns.length && rows.length) {
      const cell = (/** @type {unknown} */ v) => (v === true ? String.fromCodePoint(0x25cb) : v === false ? String.fromCodePoint(0xd7) : str(v))
      return { title: t.competition, table: { head: ['', ...columns], rows: rows.map((r) => [str(r.name), ...columns.map((_, i) => cell(list(r.values)[i]))]), align: ['left', ...columns.map(() => 'center')] } }
    }
    skip('competition.players か competition.columns と competition.rows', t.competition)
    return null
  })
  const sources = strs(p.sources)
  grid(summary[0] ?? t.overview, summary.length > 1 ? summary.slice(1).join(t.join) : undefined, [
    { w: 0.85, panels: [problem, stat, solution] },
    { w: 1.5, panels: [market, competition] },
  ], sources.length ? { sources } : {})

  // ---- 2 枚目: 実績の帯 ／ ビジネスモデル・ロードマップ ／ チーム
  const traction = panel('traction', t.traction, () => {
    const tr = p.traction
    const kpis = isObj(tr) ? list(tr.kpis).filter(isObj).filter((k) => str(k.name) && (typeof k.value === 'number' || str(k.value))) : []
    if (!kpis.length) {
      skip('traction.kpis', t.traction)
      return null
    }
    return {
      title: t.traction,
      kpi: kpis.map((k) => ({
        label: str(k.name),
        value: typeof k.value === 'number' ? k.value : str(k.value),
        ...(str(k.unit) ? { unit: str(k.unit) } : {}),
        ...(k.delta !== undefined && k.delta !== null && str(k.delta) !== '' ? { delta: typeof k.delta === 'number' ? k.delta : str(k.delta) } : {}),
      })),
    }
  })
  const model = panel('model', t.model, () => {
    const mo = p.model
    if (!isObj(mo)) {
      skip('model', t.model)
      return null
    }
    const nodes = list(mo.nodes)
      .map((n) => (isObj(n) ? n : { id: n }))
      .map((n) => ({ id: str(n.id) || str(n.name), name: str(n.name) || str(n.id), ...(str(n.group) ? { group: str(n.group) } : {}) }))
      .filter((n) => n.id)
    const links = list(mo.links)
      .filter(isObj)
      .map((l) => ({ from: str(l.from), to: str(l.to), ...(str(l.label) ? { label: str(l.label) } : {}) }))
      .filter((l) => l.from && l.to)
    if (nodes.length && links.length) return look(t.model, 'flowchart', dataset('model', { nodes, links }), t.flowAlt, { span: 1.7 })
    const points = strs(mo.points)
    if (points.length) return { title: t.model, list: points }
    skip('model.nodes と model.links か model.points', t.model)
    return null
  })
  const roadmap = panel('roadmap', t.roadmap, () => {
    const ro = p.roadmap
    if (!isObj(ro)) {
      skip('roadmap', t.roadmap)
      return null
    }
    const spans = list(ro.items).filter(isObj).map((i) => ({ name: str(i.name), start: str(i.start), end: str(i.end) })).filter((i) => i.name && i.start && i.end)
    // gantt は YYYY-MM-DD だけ読む。YYYY-MM は月の初日と末日にする。読めない日付が 1 つでもあれば工程表にせず、節目の並びに回す
    const tasks = spans.map((s) => ({ name: s.name, start: ymd(s.start, false), end: ymd(s.end, true) }))
    if (tasks.length && tasks.every((s) => s.start && s.end)) return look(t.roadmap, 'gantt', dataset('roadmap', { tasks }), t.roadmapAlt)
    const fromMs = list(ro.milestones)
      .filter(isObj)
      .map((m) => ({ date: str(m.date), name: str(m.name), ...(m.done === true ? { done: true } : {}) }))
    const items = (fromMs.length ? fromMs : spans.map((s) => ({ date: s.start, name: s.name }))).filter((m) => m.date && m.name)
    if (items.length) return look(t.roadmap, 'milestones', dataset('roadmap', { items }), t.roadmapAlt)
    skip('roadmap.items か roadmap.milestones', t.roadmap)
    return null
  })
  const team = panel('team', t.team, () => {
    const tm = p.team
    const members = isObj(tm) ? list(tm.members).filter(isObj).filter((m) => str(m.name)) : []
    if (!members.length) {
      skip('team.members', t.team)
      return null
    }
    return { title: t.team, table: { head: [t.nameCol, t.roleCol, t.noteCol], rows: members.map((m) => [str(m.name), str(m.role), str(m.note)]), widths: [2, 3, 6] } }
  })
  grid(`${t.traction}${t.sep}${t.model}${t.sep}${t.team}`, undefined, [
    { w: 1, panels: [traction] },
    { w: 0.7, panels: [model, team] },
    { w: 1.1, panels: [roadmap] },
  ])

  // ---- 3 枚目: 収支・要点 ／ 資金・使い道・リスク
  /** @type {string} */
  let raiseNote = ''
  /** @type {string[]} */
  let pnlPoints = []
  const pnl = panel('financials', t.financials, () => {
    const f = p.financials
    if (!isObj(f)) {
      skip('financials', t.financials)
      return null
    }
    const years = list(f.years).map(str)
    const revenue = list(f.revenue).map(num)
    const cost = list(f.cost).map(num)
    const n = Math.min(years.length, revenue.length, cost.length)
    if (n < 1) {
      skip('financials.years と revenue と cost', t.financials)
      return null
    }
    if (years.length !== revenue.length || years.length !== cost.length) {
      warnings.push(`plan.financials の years・revenue・cost の個数が違うので、少ない方の ${n} 年分だけ使った`)
    }
    const rv = revenue.slice(0, n)
    const co = cost.slice(0, n)
    if (rv.some((v) => !Number.isFinite(v)) || co.some((v) => !Number.isFinite(v))) {
      warnings.push('plan.financials の revenue か cost に数でない値があるので収支計画を載せなかった')
      return null
    }
    const ys = years.slice(0, n)
    const unit = str(f.unit)
    const profit = rv.map((v, i) => Math.round((v - co[i]) * 1e6) / 1e6)
    const id = dataset('financials', { x: ys, revenue: rv, cost: co, profit, unit }, f.source)
    const fmt = (/** @type {number} */ v) => `${formatNumber(v)}${unit}`
    /** @type {string[]} */
    const points = []
    /** 補足の括弧。英語は半角 @param {string} x */
    const paren = (x) => (en ? ` (${x})` : `（${x}）`)
    points.push(n > 1 ? `**${t.revenue}** ${ys[0]} ${fmt(rv[0])} → ${ys[n - 1]} ${fmt(rv[n - 1])}` : `**${t.revenue}** ${ys[0]} ${fmt(rv[0])}`)
    if (n > 1) points.push(`**${t.cost}** ${ys[0]} ${fmt(co[0])} → ${ys[n - 1]} ${fmt(co[n - 1])}`)
    if (n > 1 && rv[0] > 0 && rv[n - 1] > 0) {
      points.push(`**${t.cagr}** ${pct(Math.pow(rv[n - 1] / rv[0], 1 / (n - 1)) - 1)}%${paren(`${n - 1} ${t.years}`)}`)
    }
    const k = profit.findIndex((v) => v >= 0)
    if (k === 0) points.push(`**${t.blackFirst}** ${t.blackFromStart}${paren(ys[0])}`)
    else if (k > 0) points.push(`**${t.blackIn}** ${ys[k]}${paren(en ? ordinalYear(k + 1) : `${k + 1} 年目`)}`)
    else points.push(`**${t.deficit}** ${t.deficitAll}${paren(`${t.lastYear} ${fmt(profit[n - 1])}`)}`)
    if (rv[n - 1] > 0) points.push(`**${t.margin}** ${pct(profit[n - 1] / rv[n - 1])}%${paren(`${t.lastYear} ${ys[n - 1]}`)}`)
    // 累積の赤字の底は、資金調達の額と見比べる数
    let run = 0
    let low = 0
    let lowAt = -1
    profit.forEach((v, i) => {
      run += v
      if (run < low) {
        low = run
        lowAt = i
      }
    })
    if (lowAt >= 0) points.push(`**${t.cumLow}** ${fmt(Math.round(-low * 1e6) / 1e6)}${paren(ys[lowAt])}`)
    pnlPoints = points
    return look(t.financials, 'pnl', id, `${t.pnlAlt}: ${ys[0]}–${ys[n - 1]}`)
  })
  const points = pnl && pnlPoints.length ? { title: t.financialsPoints, list: pnlPoints, span: 0.8 } : null

  /** @type {Record<string, any> | null} */
  let fundingPanel = null
  panel('funding', t.funding, () => {
    const fu = p.funding
    const use = isObj(fu) ? list(fu.use).filter(isObj).map((u) => ({ name: str(u.name), value: num(u.value) })).filter((u) => u.name && u.value >= 0) : []
    if (!use.length) {
      skip('funding.use', t.funding)
      return null
    }
    const sum = use.reduce((a, u) => a + u.value, 0)
    const amount = num(fu.amount)
    const total = Number.isFinite(amount) ? amount : sum
    const unit = str(fu.unit)
    const matches = Number.isFinite(amount) && Math.abs(sum - amount) <= 1e-6 * Math.max(1, Math.abs(amount))
    if (Number.isFinite(amount) && !matches) warnings.push('plan.funding の use の合計が amount と違う')
    const id = dataset('funding', { items: use, unit, ...(matches ? { total: amount } : {}) })
    const names = use.map((u) => u.name).join(en ? ', ' : '・')
    fundingPanel = look(`${t.funding} ${formatNumber(total)}${unit}`, 'donut', id, `${t.donutAlt}: ${names}`, { span: 1.9 })
    raiseNote = en ? `${t.raise} ${formatNumber(total)}${unit} ${t.usePrefix} ${names}` : `${t.raise} ${formatNumber(total)}${unit}（${t.usePrefix}: ${names}）`
    return null
  })
  const risks = panel('risks', t.risks, () => {
    const rows = list(p.risks).filter(isObj).filter((r) => str(r.risk))
    if (!rows.length) {
      skip('risks', t.risks)
      return null
    }
    return { title: t.risks, table: { head: [t.riskCol, t.answerCol], rows: rows.map((r) => [str(r.risk), str(r.answer)]), widths: [2, 3] }, span: 1.5 }
  })
  grid(`${t.financials}${t.sep}${t.funding}${t.sep}${t.risks}`, undefined, [
    { w: 1.15, panels: [pnl] },
    { w: 1, panels: [fundingPanel, points, risks] },
  ])

  // ---- 結び: 一言（plan.closing.message か tagline か会社名）と、次の一歩（plan.closing.next か資金調達の一文）
  const closing = isObj(p.closing) ? p.closing : {}
  const next = strs(closing.next)
  if (!next.length && raiseNote) next.push(raiseNote)
  const closingTitle = str(closing.message) || tagline || company
  if (closingTitle || next.length) slides.push({ layout: 'closing', ...(closingTitle ? { title: closingTitle } : {}), ...(next.length ? { items: next } : {}) })

  return { slides, datasets, warnings }
}
