// @ts-check
// 道具 pdf_examples の中身（読むだけ）。ECharts の公式見本の目録（assets/echarts/catalog.json）を、語・series の種類・category で引き、
// id を 1 つ渡されたらその option の JSON を返す。Claude が chart の example と option を書く時の手本。
// 純な部品。ファイルは本体が作った read（絶対の場所 → 字）で読む。
//
// 選ばなかった案
// - 全部の見本の option を一度に返す: 数百本で数 MB。目録（題と種類だけ）で選び、id で 1 本だけ option を渡す 2 段にする。
// - 語の一致を全文検索にする: 目録の欄（id・題・中国語の題・category・series・component）だけで足りる。option の中まで見ると、
//   data の数字や色の字に当たって順位が荒れる。
// - 並びを「紙にそのまま出せる」物の先頭固定にする: 語が当たった強さを先にする。同点のときだけ紙に出せる物を前にする。

import { loadChartAssets, chartCatalog, chartExample } from '../engine/chart.mjs'

/** 1 回の答えの上限 */
const LIMIT_MAX = 30
const LIMIT_DEFAULT = 20
/** option の JSON をそのまま返す上限（字）。超える見本は長い配列を切ってある */
const OPTION_CHARS_MAX = 60000
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/

/** 登録は hooks/mods-pdf.mjs の session.start が、この定義をそのまま道具の登録に渡す */
export const EXAMPLES_TOOL = Object.freeze({
  name: 'pdf_examples',
  description:
    'ECharts の公式見本の目録を引く（読むだけ）。chart のブロックを書く前に使う。'
    + ' query に語（例: "stack bar"・"pie"・"heatmap"。題は英語と中国語なので英語で引く。主な日本語（積み上げ・棒・折れ線・円・散布・面など）は英語に直して引く）、series に種類（bar・line・pie・scatter・candlestick・sankey など）、category に分類を渡すと、'
    + ' id・題・種類・注意（flags）を最大 30 件返す。id を渡すと、その見本の option（JSON）を返す。'
    + ' 使い方: chart のブロックに { "type": "chart", "example": "<id>", "data": …, "option": … } と書く。'
    + ' data は dataset の source（[[…], …]）か { "series": [{ "name": "…", "data": […] }] }、option は最後に深く重ねる（配列は丸ごと置き換え）、theme は themes.json の名前。'
    + ' 注意（flags）: needsData は外のデータが要る（data を渡す）・needsMap は地図（描けない）・lostRenderItem は描く関数が無い（軸だけ）・paper は紙にそのまま出せる。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '探す語（空白で区切ると全部を含む物）。id・題・中国語の題・分類・種類・部品の名前を引く' },
      series: { type: 'string', description: 'series の種類（bar・line・pie など）。一致する物だけ' },
      category: { type: 'string', description: '分類（見本の category）。一致する物だけ' },
      paper: { type: 'boolean', description: 'true なら、紙にそのまま出せる見本（paper）だけ' },
      limit: { type: 'number', description: `返す件数（1〜${LIMIT_MAX}。既定 ${LIMIT_DEFAULT}）` },
      id: { type: 'string', description: '見本の id。渡すと、その見本の option（JSON）を返す' },
    },
    additionalProperties: false,
  },
})

/** 目録は英語と中国語の題なので、よく使う日本語の語は英語にして引く（長い語から先に当てる） */
const JA = /** @type {Record<string, string>} */ ({
  積み上げ: 'stack', 積上: 'stack', 横棒: 'bar', 縦棒: 'bar', 棒: 'bar', 折れ線: 'line', 折線: 'line', ドーナツ: 'doughnut', 円: 'pie', 散布: 'scatter', 面: 'area',
  ローソク: 'candlestick', ヒートマップ: 'heatmap', レーダー: 'radar', ゲージ: 'gauge', ファネル: 'funnel', ツリーマップ: 'treemap', ツリー: 'tree', 樹形: 'tree',
  サンキー: 'sankey', サンバースト: 'sunburst', 箱ひげ: 'boxplot', 極座標: 'polar', カレンダー: 'calendar', 並行座標: 'parallel', グラフ: 'graph',
  ウォーターフォール: 'waterfall', 滝: 'waterfall', 対数: 'log', 時系列: 'time', 勾配: 'gradient', ヒストグラム: 'histogram', 回帰: 'regression',
})

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v */
const lower = (v) => String(v ?? '').toLowerCase()

/**
 * 目録の 1 行の旗を短い字にする
 * @param {Record<string, any>} f
 */
function flagText(f) {
  /** @type {string[]} */
  const out = []
  if (f.paper) out.push('paper')
  for (const k of ['needsData', 'needsMap', 'needsGL', 'needsStat', 'lostRenderItem', 'animated', 'skeleton', 'truncated', 'failed', 'empty']) if (f[k]) out.push(k)
  const lossy = Array.isArray(f.lossy) ? f.lossy.length + (typeof f.lossyMore === 'number' ? f.lossyMore : 0) : f.lossy
  if (typeof lossy === 'number') out.push(`lossy${lossy}`)
  return out.join(',')
}

/**
 * 目録を引く
 * @param {any[]} catalog
 * @param {{ query?: string, series?: string, category?: string, paper?: boolean }} q
 * @returns {any[]} 当たった行（強い順。同じ強さは paper を前に、さらに id の順）
 */
export function searchCatalog(catalog, q) {
  const words = lower(q.query).split(/[\s,、]+/).filter(Boolean).map((w) => {
    for (const k of Object.keys(JA)) if (w.includes(k)) return JA[k]
    return w
  })
  const series = q.series ? lower(q.series) : ''
  const category = q.category ? lower(q.category) : ''
  /** @type {{ row: any, score: number }[]} */
  const hit = []
  for (const row of catalog) {
    if (!isObj(row)) continue
    const f = isObj(row.flags) ? row.flags : {}
    if (q.paper && !f.paper) continue
    if (series && !(Array.isArray(row.series) && row.series.some((/** @type {unknown} */ s) => lower(s) === series))) continue
    if (category && !(Array.isArray(row.category) && row.category.some((/** @type {unknown} */ s) => lower(s) === category))) continue
    const id = lower(row.id)
    const title = `${lower(row.title)} ${lower(row.titleCN)}`
    const rest = `${(row.category ?? []).join(' ')} ${(row.series ?? []).join(' ')} ${(row.component ?? []).join(' ')}`.toLowerCase()
    let score = 0
    let all = true
    for (const w of words) {
      const s = (id.includes(w) ? 3 : 0) + (title.includes(w) ? 2 : 0) + (rest.includes(w) ? 1 : 0)
      if (s === 0) {
        all = false
        break
      }
      score += s
    }
    if (all) hit.push({ row, score })
  }
  hit.sort((a, b) => b.score - a.score || Number(!!b.row.flags?.paper) - Number(!!a.row.flags?.paper) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0))
  return hit.map((h) => h.row)
}

/** @param {any[]} catalog 引数が何も無い時の案内（種類と分類の数） */
function overview(catalog) {
  /** @type {Map<string, number>} */
  const series = new Map()
  /** @type {Map<string, number>} */
  const cats = new Map()
  let paper = 0
  for (const r of catalog) {
    if (!isObj(r)) continue
    for (const s of r.series ?? []) series.set(s, (series.get(s) ?? 0) + 1)
    for (const c of r.category ?? []) cats.set(c, (cats.get(c) ?? 0) + 1)
    if (r.flags && r.flags.paper) paper += 1
  }
  const top = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => `${k}(${n})`).join(' ')
  return [
    `見本 ${catalog.length} 本（紙にそのまま出せる物 ${paper} 本）。語・series・category のどれかを渡すと絞れます。`,
    `series: ${top(series)}`,
    `category: ${top(cats)}`,
  ].join('\n')
}

/**
 * 道具の答え。読むだけ
 * @param {unknown} args
 * @param {{ root: string, read: (path: string) => Promise<string> }} io
 * @returns {Promise<{ result: string } | { deny: string }>}
 */
export async function runExamples(args, io) {
  const a = isObj(args) ? args : {}
  const id = typeof a.id === 'string' ? a.id.trim() : ''
  if (id) {
    if (!ID_RE.test(id)) return { deny: 'id は英数字と _ - だけの名前です。pdf_examples を query で引いて id を確かめてください' }
    await loadChartAssets(io, { examples: [id] })
    const ex = chartExample(id)
    if (!ex) return { result: `見本 "${id}" はありません。query・series・category で引き直してください。` }
    let json = JSON.stringify(ex.option)
    let cut = ''
    if (json.length > OPTION_CHARS_MAX) {
      json = json.slice(0, OPTION_CHARS_MAX)
      cut = `\n（option が長いので ${OPTION_CHARS_MAX} 字で切りました。実物は example だけで使えます）`
    }
    const f = isObj(ex.flags) ? flagText(ex.flags) : ''
    return {
      result: [
        `id: ${ex.id}`,
        `題: ${ex.title}${ex.titleCN ? `／${ex.titleCN}` : ''}`,
        `分類: ${(ex.category ?? []).join(', ')}`,
        f ? `flags: ${f}` : 'flags: なし',
        `使い方: { "type": "chart", "example": "${ex.id}" } に data（置き換える数字）か option（重ねる指定）を足す`,
        `option:${cut}`,
        json,
      ].join('\n'),
    }
  }

  await loadChartAssets(io, { catalog: true })
  const { catalog, error } = chartCatalog()
  if (!catalog) return { result: `見本の目録を読めませんでした: ${error ?? '理由不明'}` }
  const q = {
    query: typeof a.query === 'string' ? a.query.slice(0, 200) : '',
    series: typeof a.series === 'string' ? a.series.slice(0, 40) : '',
    category: typeof a.category === 'string' ? a.category.slice(0, 40) : '',
    paper: a.paper === true,
  }
  if (!q.query && !q.series && !q.category && !q.paper) return { result: overview(catalog) }
  const rows = searchCatalog(catalog, q)
  const limit = Math.min(LIMIT_MAX, Math.max(1, Math.floor(typeof a.limit === 'number' && Number.isFinite(a.limit) ? a.limit : LIMIT_DEFAULT)))
  if (!rows.length) return { result: '当たる見本がありません。語を減らすか、series・category を外してください。' }
  const lines = rows.slice(0, limit).map((r) => {
    const f = isObj(r.flags) ? flagText(r.flags) : ''
    return `${r.id}｜${r.title}${r.titleCN ? `／${r.titleCN}` : ''}｜${(r.series ?? []).join(',')}｜${(r.category ?? []).join(',')}${f ? `｜${f}` : ''}`
  })
  return { result: [`${rows.length} 件${rows.length > limit ? `のうち先頭 ${limit} 件` : ''}（id｜題｜series｜category｜flags）`, ...lines].join('\n') }
}
