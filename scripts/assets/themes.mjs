// ECharts のテーマ 36 個 ＋ ModsPDF の 4 つ（vivid・mono・koma・mergeble）を assets/echarts/themes.json（名前 → theme の object）に出す。
// build-assets.mjs から呼ぶ。単独でも `node scripts/assets/themes.mjs [--out <dir>]` で動く。
//
// 選ばなかった案
// - テーマを JS（registerTheme の呼び出し）のまま束に入れる: データは JS に埋めず、使う時だけ $.fs.read で読む（docs/assets.md）。
// - テーマの js を正規表現で読む: 中身は UMD の関数で、色の配列を変数に置いて参照するなど書き方が揃わない。stub の echarts で実行して registerTheme の引数を取る。
// - ModsPDF の色をここに写して持つ: 色の正本は hooks/engine/theme.mjs。makeTheme の戻り値から読み、色を変えたら作り直すだけで追いつく。
//   系列色の 8 色は theme.mjs の lookPal(name).series（図の形と同じ色）。lookPal が無い版でも作り直せるよう、下の VIVID_SERIES などは控え。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

/** lookPal が無い版の控え（vivid の 8 色。docs/deck.md の「白黒にこだわらない」の節） */
const VIVID_SERIES = ['#1F55C6', '#E07A2E', '#1E9A8A', '#D2A21C', '#7A5BC0', '#C4466F', '#5B8C2A', '#7D6A5A']
/** mono の系列の色（hooks/engine/chart.mjs の MONO_SERIES）。墨の濃さで分ける */
const MONO_SERIES = ['#111111', '#6B6B6B', '#A3A3A0', '#3D3D3D', '#C9C9C5']
const FONT_FAMILY = 'Noto Sans JP'

/** ECharts の theme/*.js（UMD）を、registerTheme を捕まえる stub で実行して { 名前: theme } を返す */
export function extractEchartsThemes(root) {
  const dir = path.join(root, 'node_modules', 'echarts', 'theme')
  const found = {}
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    const sandbox = {
      echarts: { registerTheme: (name, theme) => { if (name in found) throw new Error(`${n}: テーマ名 ${name} が重なった`); found[name] = theme } },
      console: { error() {}, log() {} },
    }
    const before = Object.keys(found).length
    // UMD の頭は define と exports を見て、無ければ this.echarts を使う。this はこの sandbox
    vm.runInNewContext(fs.readFileSync(path.join(dir, n), 'utf8'), sandbox, { filename: n, timeout: 5000 })
    if (Object.keys(found).length === before) throw new Error(`${n}: registerTheme が呼ばれなかった`)
  }
  // 別の領域で作られた object を、JSON を通して普通の object にする（関数が混じっていたら落ちるので先に止める）
  const noFunction = (v, where) => {
    if (typeof v === 'function') throw new Error(`${where}: 関数が入っている`)
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) noFunction(x, `${where}.${k}`)
  }
  const out = {}
  for (const name of Object.keys(found).sort()) {
    noFunction(found[name], name)
    out[name] = JSON.parse(JSON.stringify(found[name]))
  }
  return out
}

/**
 * ModsPDF の色（Colors）から ECharts の theme を作る。紙に合わせる: 地は透明・字は ink・軸の字は sub・補助線は rule の細い線・軸の線と目盛りは出さない
 * （hooks/engine/chart.mjs の applyDefaults と同じ向き。あちらは option に足すので、これは init に渡す土台）
 * @param {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string }} c
 * @param {string[]} series
 */
function modsTheme(c, series) {
  const axis = {
    axisLine: { show: false, lineStyle: { color: c.sub } },
    axisTick: { show: false, lineStyle: { color: c.sub } },
    axisLabel: { color: c.sub },
    nameTextStyle: { color: c.sub },
    splitLine: { show: true, lineStyle: { color: c.rule, width: 0.5 } },
    splitArea: { show: false },
  }
  return {
    color: series,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT_FAMILY, color: c.ink },
    title: { textStyle: { color: c.ink, fontWeight: 'bold' }, subtextStyle: { color: c.sub } },
    legend: { textStyle: { color: c.ink } },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    line: { lineStyle: { width: 1.8 }, symbolSize: 4 },
    scatter: { symbolSize: 6 },
    bar: { barMaxWidth: 40 },
    pie: { itemStyle: { borderColor: c.paper, borderWidth: 1.5 }, label: { color: c.sub }, labelLine: { lineStyle: { color: c.rule } } },
    candlestick: { itemStyle: { color: c.up, color0: c.down, borderColor: c.up, borderColor0: c.down } },
    visualMap: { color: [c.accent, c.tint] },
    graph: { color: series },
    markLine: { lineStyle: { color: c.sub } },
    toolbox: { iconStyle: { borderColor: c.sub } },
    tooltip: { backgroundColor: c.paper, borderColor: c.rule, textStyle: { color: c.ink } },
  }
}

/** hooks/engine/theme.mjs の makeTheme から色を読み、ModsPDF のテーマを作る（theme.mjs は読むだけ） */
export async function modsThemes(root) {
  const { makeTheme, lookPal } = await import(pathToFileURL(path.join(root, 'hooks', 'engine', 'theme.mjs')).href)
  const colors = (name) => makeTheme({ theme: name }).colors
  const out = {}
  for (const name of ['mono', 'koma', 'mergeble', 'vivid']) {
    const c = colors(name)
    // 系列の色: 色のテーマは図の形（looks）と同じ 8 色（theme.mjs の lookPal の series）。mono は series を持たないので墨の濃さ（末尾に上げ下げ）
    const fromPal = typeof lookPal === 'function' ? lookPal(name).series : undefined
    const series = fromPal ?? (name === 'mono' ? [...MONO_SERIES, c.up, c.down]
      : name === 'vivid' ? VIVID_SERIES
        : [c.accent, c.accent2, c.sub, c.ink, '#A3A3A0', c.up, c.down])
    out[name] = modsTheme(c, series)
  }
  return out
}

/**
 * @param {{ out: string, root: string, log?: (s: string) => void }} o
 * @returns {Promise<{ file: string, count: number, size: number }>}
 */
export async function buildThemes({ out, root, log = console.log }) {
  const echartsThemes = extractEchartsThemes(root)
  const mods = await modsThemes(root)
  for (const k of Object.keys(mods)) if (k in echartsThemes) throw new Error(`テーマ名 ${k} が ECharts の物と重なった`)
  const all = { ...echartsThemes, ...mods }
  const names = Object.keys(all).sort()
  // 1 テーマ 1 行（差分が読める。作り直しても同じ字になる）
  const text = `{\n${names.map((k) => `${JSON.stringify(k)}:${JSON.stringify(all[k])}`).join(',\n')}\n}\n`
  const file = path.join(out, 'assets', 'echarts', 'themes.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  JSON.parse(text)
  const size = Buffer.byteLength(text)
  log(`themes: ${names.length} 個（ECharts ${Object.keys(echartsThemes).length}・ModsPDF ${Object.keys(mods).length}）・${size} B -> assets/echarts/themes.json`)
  return { file: 'assets/echarts/themes.json', count: names.length, size }
}
