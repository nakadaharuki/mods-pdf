// @ts-check
// ECharts 公式見本（apache/echarts-examples・Apache-2.0）301 本から option を Node で取り出し、JSON の見本と目録にする。
// 入口は buildExamples({ out, root })。build-assets.mjs から呼ぶ。直に `node examples.mjs [--out 道] [--root 道]` でも流せる。
//
// 作る物（out の下）
//   assets/echarts/examples/<id>.json  { id, title, titleCN, category, option, flags, source }
//   assets/echarts/catalog.json        1 本 1 行（option は入れない）
//   <reportDir>/examples-report.json / .md  取り出しと描画の自動確かめの集計（絵は見ない。時間が入るので毎回違う。既定は <root>/out/assets-report/ で git に入らない）
//
// 選ばなかった案と、決めた振る舞い
// - 見本を人の手で data → option の関数に直す: 301 本あり、コードが 1 MiB を何度も超える。作る時に実行して JSON にする。
// - $.get の callback: 1 回目は呼ばない。外のデータを読んだ見本だけ、2 回目に callback を「何でも受ける空のデータ」(anyData) で呼び、
//   option の骨組み（軸・系列・見た目）を取る。data は空。取れた物は flags.skeleton。途中で投げたら skeletonError。取れなければ 1 回目の結果のまま。
// - setInterval は何もしない（最初の 1 こま＝最初の option を取る）。setTimeout は本体が終わって、global の option を
//   setOption(option, true) の形で適用した後に、1 回ずつ時間順に流す（遊び場の実行順と同じ。再帰は 100 回まで）。
// - Math.random は id から決めた種で固定し、Date は 2026-01-01 に固定する。何度流しても同じ物ができる。
// - lossy に書くのは、関数・循環・有限でない数・配列の中の undefined（null になる）。オブジェクトの undefined の項目は意味が変わらないので黙って落とす。
//   カスタム系列の renderItem が欠けた物は lostRenderItem（描いても軸だけになる）。
// - echarts の純な関数（graphic・number・format・time・util・color）は node_modules の本物を stub に渡す。描くのは別の束（renderer）。
// - 絵は見ない。描けたか・投げたか・svgToOps の警告だけを数える。
// - 実行は 1 本 2 秒で打ち切る（vm の timeout。同期の無限ループだけ止められる）。描画は同じ process で流す（遅い物は report に時間を出す）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_SRC = 'C:/dev/_ref/oss/echarts-examples/public/examples/ts'
// MPDF_TRACE=1 で、どの見本で止まったかを stderr に出す
const TRACE = !!process.env.MPDF_TRACE
// 実行の打ち切りは出力の分岐に使わない。2 秒で切って失敗と記録する案は、機械が混むと candlestick-large のような大きな見本が
// 「失敗」になり、同じ入力から違う catalog.json ができた（2 回の作り直しで違いが出た原因）。長く待ち、それでも終わらない時は作り直しを止める
const RUN_MS = 120000
/** 報告の「遅い見本」の印だけに使う（出力は変えない） */
const SLOW_MS = 1500
// $.fs.read の 1 回の上限（4 MiB）と同じ値にすると境目の見本が読めなくなる。余りを残す
const MAX_JSON = 3.5 * 1024 * 1024
const RENDER_W = 720
const RENDER_H = 450
const ROOT_PATH_VALUE = 'https://echarts.apache.org/examples'
const FIXED_NOW = 1767225600000 // 2026-01-01T00:00:00Z
const MAX_LOSSY = 50

// ---------------------------------------------------------------- 小さな部品

/** @param {string} s */
function hash32(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** @param {unknown} v */
const tagOf = (v) => Object.prototype.toString.call(v)
/** @param {unknown} v */
const isObj = (v) => tagOf(v) === '[object Object]'
const isArr = Array.isArray

/**
 * 何を呼んでも落ちない stub（document・window・myChart の残りの面など）。
 * 呼べて、new できて、反復できて、数にすると 0。then は持たない（await で止まらない）。
 * @param {Record<PropertyKey, unknown>} [overrides]
 * @returns {any}
 */
function loose(overrides = {}) {
  /** @type {Map<PropertyKey, any>} */
  const kids = new Map()
  /** @type {any} */
  let self
  const target = function () {}
  self = new Proxy(target, {
    get(_t, k) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) return overrides[k]
      if (k === Symbol.toPrimitive) return (/** @type {string} */ hint) => (hint === 'number' ? 0 : '')
      if (k === 'then') return undefined
      if (k === Symbol.iterator) return function* () {}
      if (k === 'length') return 0
      if (typeof k === 'symbol') return undefined
      let kid = kids.get(k)
      if (!kid) {
        kid = loose()
        kids.set(k, kid)
      }
      return kid
    },
    set(_t, k, v) {
      overrides[k] = v
      return true
    },
    has: () => true,
    apply: () => loose(),
    construct: () => loose(),
  })
  return self
}

/** feed mode で callback に渡す「何でも受ける空のデータ」。toPlain は [] にする */
const ANY = new WeakSet()
/** @returns {any} */
function anyData() {
  /** @type {Map<string, any>} */
  const kids = new Map()
  const p = new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return (/** @type {string} */ hint) => (hint === 'number' ? 0 : '')
      if (k === Symbol.iterator) return function* () {}
      if (k === 'then' || typeof k === 'symbol') return undefined
      if (k === 'length') return 0
      if (k !== 'constructor' && typeof (/** @type {any} */ (Array.prototype))[k] === 'function') return (/** @type {any[]} */ ...a) => /** @type {any} */ ([])[k](...a)
      let kid = kids.get(k)
      if (!kid) { kid = anyData(); kids.set(k, kid) }
      return kid
    },
    set: () => true,
    has: () => true,
    apply: () => anyData(),
    construct: () => anyData(),
  })
  ANY.add(p)
  return p
}

/** "'line, visualMap'" のような値の引用符を外す */
const unquote = (/** @type {string} */ s) => s.replace(/^(['"])(.*)\1$/, '$2')

/** @param {string} src */
function parseHeader(src) {
  /** @type {Record<string, string>} */
  const h = {}
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(src)
  if (!m) return h
  for (const line of m[1].split('\n')) {
    const mm = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (mm) h[mm[1]] = unquote(mm[2])
  }
  return h
}

// ---------------------------------------------------------------- option の重ね方（setOption の merge の近似）

// 配列を index（または id）で重ねる最上位の鍵。data などの配列は丸ごと置き換える。
const COMPONENT_KEYS = new Set([
  'series', 'xAxis', 'yAxis', 'grid', 'legend', 'title', 'visualMap', 'dataset', 'graphic', 'radar', 'polar', 'angleAxis',
  'radiusAxis', 'geo', 'parallel', 'parallelAxis', 'singleAxis', 'calendar', 'dataZoom', 'toolbox', 'tooltip', 'axisPointer',
  'timeline', 'matrix', 'aria', 'brush',
])

/**
 * 関数・Date・型付き配列などは参照のまま、普通の object と配列だけ複製する（循環は保つ）。
 * @param {any} v
 * @param {WeakMap<object, any>} [seen]
 * @returns {any}
 */
function cloneRaw(v, seen = new WeakMap()) {
  if (isArr(v)) {
    if (seen.has(v)) return seen.get(v)
    const out = new Array(v.length)
    seen.set(v, out)
    for (let i = 0; i < v.length; i++) out[i] = cloneRaw(v[i], seen)
    return out
  }
  if (isObj(v)) {
    if (seen.has(v)) return seen.get(v)
    /** @type {Record<string, any>} */
    const out = {}
    seen.set(v, out)
    for (const k of Object.keys(v)) out[k] = cloneRaw(v[k], seen)
    return out
  }
  return v
}

/** @param {any} b @param {any} n */
function mergeObj(b, n) {
  for (const k of Object.keys(n)) {
    if (n[k] === undefined) continue
    b[k] = isObj(b[k]) && isObj(n[k]) ? mergeObj(b[k], n[k]) : n[k]
  }
  return b
}

/** @param {any} b @param {any} n */
function mergeComponents(b, n) {
  const out = b.slice()
  n.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
    let at = i
    if (isObj(x) && x.id !== undefined) {
      const j = out.findIndex((/** @type {any} */ y) => isObj(y) && y.id === x.id)
      if (j >= 0) at = j
    }
    out[at] = isObj(out[at]) && isObj(x) ? mergeObj(out[at], x) : x
  })
  return out
}

/**
 * state に setOption(opt, a) を重ねる。a が true か notMerge なら置き換え、replaceMerge の鍵は置き換え。
 * @param {any} state @param {any} opt @param {any} a
 */
function applyOption(state, opt, a) {
  if (!isObj(opt)) return state
  const next = cloneRaw(opt)
  const notMerge = a === true || (isObj(a) && a.notMerge)
  if (!state || notMerge) return next
  const replace = new Set(isObj(a) && a.replaceMerge ? [].concat(a.replaceMerge) : [])
  for (const k of Object.keys(next)) {
    if (next[k] === undefined) continue
    const b = state[k]
    if (replace.has(k) || b === undefined) state[k] = next[k]
    else if (COMPONENT_KEYS.has(k) && isArr(b) && isArr(next[k])) state[k] = mergeComponents(b, next[k])
    else if (COMPONENT_KEYS.has(k) && isArr(b) && isObj(next[k])) state[k] = mergeComponents(b, [next[k]])
    else if (isObj(b) && isObj(next[k])) state[k] = mergeObj(b, next[k])
    else state[k] = next[k]
  }
  return state
}

// ---------------------------------------------------------------- JSON にする（落とした道を残す）

/** @typedef {{ up: PathNode | null, k: string | number }} PathNode */
/** @param {PathNode | null} p */
function pathStr(p) {
  /** @type {(string | number)[]} */
  const parts = []
  for (let q = p; q; q = q.up) parts.push(q.k)
  parts.reverse()
  let s = ''
  for (const k of parts) {
    if (typeof k === 'number') s += `[${k}]`
    else if (/^[A-Za-z_$][\w$]*$/.test(k)) s += s ? `.${k}` : k
    else s += `[${JSON.stringify(k)}]`
  }
  return s || '(root)'
}

/**
 * @typedef {{ lossy: string[], lossyCount: number, stack: Set<object> }} PlainState
 * @param {any} v @param {PathNode | null} p @param {PlainState} st
 * @returns {any} undefined は「落とす」
 */
function toPlain(v, p, st) {
  const drop = (/** @type {string} */ note) => {
    st.lossyCount++
    if (st.lossy.length < MAX_LOSSY) st.lossy.push(note ? `${pathStr(p)} (${note})` : pathStr(p))
    return undefined
  }
  if (v === null) return null
  if (ANY.has(v)) return []
  switch (typeof v) {
    case 'string': case 'boolean': return v
    case 'number': return Number.isFinite(v) ? v : (drop(String(v)), null)
    case 'bigint': return Number(v)
    case 'undefined': return undefined
    case 'function': return drop('')
    case 'symbol': return drop('symbol')
  }
  const tag = tagOf(v)
  if (tag === '[object Date]') return Number.isFinite(+v) ? +v : null
  if (ArrayBuffer.isView(v) && tag !== '[object DataView]') {
    return Array.from(/** @type {any} */ (v), (x) => (typeof x === 'bigint' ? Number(x) : Number.isFinite(x) ? x : null))
  }
  if (isArr(v)) {
    if (st.stack.has(v)) return drop('循環')
    st.stack.add(v)
    let undef = 0
    const out = new Array(v.length)
    for (let i = 0; i < v.length; i++) {
      const x = toPlain(v[i], { up: p, k: i }, st)
      if (x === undefined) {
        if (v[i] === undefined) undef++
        out[i] = null
      } else out[i] = x
    }
    st.stack.delete(v)
    if (undef) { st.lossyCount++; if (st.lossy.length < MAX_LOSSY) st.lossy.push(`${pathStr(p)} (undefined→null ×${undef})`) }
    return out
  }
  if (tag === '[object Object]') {
    if (st.stack.has(v)) return drop('循環')
    st.stack.add(v)
    /** @type {Record<string, any>} */
    const out = {}
    for (const k of Object.keys(v)) {
      const x = toPlain(v[k], { up: p, k }, st)
      if (x !== undefined) out[k] = x
    }
    st.stack.delete(v)
    return out
  }
  return drop(tag.slice(8, -1)) // Map・Set・Promise など
}

/** @param {any} option @returns {{ option: any, lossy: string[], lossyCount: number }} */
function plainOption(option) {
  /** @type {PlainState} */
  const st = { lossy: [], lossyCount: 0, stack: new Set() }
  const o = toPlain(option, null, st)
  return { option: o === undefined ? {} : o, lossy: st.lossy, lossyCount: st.lossyCount }
}

// ---------------------------------------------------------------- 目録の欄（series の種類・component・map・GL）

const NON_COMPONENT = new Set([
  'series', 'color', 'backgroundColor', 'textStyle', 'darkMode', 'useUTC', 'blendMode', 'hoverLayerThreshold', 'media',
  'baseOption', 'options', 'stateAnimation', 'universalTransition', 'renderAsImage',
])

/** option（と timeline の baseOption・options[]）の series を全部集める */
function allSeries(/** @type {any} */ option) {
  /** @type {any[]} */
  const out = []
  const take = (/** @type {any} */ o) => {
    if (!isObj(o)) return
    const s = o.series
    if (isArr(s)) out.push(...s.filter(isObj))
    else if (isObj(s)) out.push(s)
  }
  take(option)
  if (isObj(option)) {
    take(option.baseOption)
    if (isArr(option.options)) option.options.forEach(take)
  }
  return out
}

/** @param {any} option */
function describeOption(option) {
  const series = allSeries(option)
  const types = [...new Set(series.map((s) => s.type).filter((t) => typeof t === 'string'))]
  /** @type {Set<string>} */
  const comps = new Set()
  const tops = [option, isObj(option) ? option.baseOption : null, ...(isObj(option) && isArr(option.options) ? option.options : [])]
  for (const o of tops) {
    if (!isObj(o)) continue
    for (const k of Object.keys(o)) if (!NON_COMPONENT.has(k) && !k.startsWith('animation')) comps.add(k)
  }
  for (const s of series) for (const k of ['markPoint', 'markLine', 'markArea']) if (s[k] !== undefined) comps.add(k)
  const hasGeo = [...comps].some((k) => k === 'geo' || k === 'bmap' || k === 'leaflet' || k === 'amap' || k === 'mapbox3D') ||
    types.includes('map') || series.some((s) => s.coordinateSystem === 'geo' || s.geoIndex !== undefined)
  const GL3 = ['grid3D', 'xAxis3D', 'yAxis3D', 'zAxis3D', 'geo3D', 'globe', 'mapbox3D', 'maptalks3D', 'bmap3D']
  const hasGL = types.some((t) => /3D$|GL$/.test(t) || t === 'surface' || t === 'globe') || [...comps].some((k) => GL3.includes(k))
  return { types, components: [...comps], hasGeo, hasGL }
}

// ---------------------------------------------------------------- 大きすぎる物を切る

/** @param {any} v */
const jsonBytes = (v) => Buffer.byteLength(JSON.stringify(v))

/**
 * record を limit（B）以下にする。option の一番大きい長い配列を半分ずつ切る。
 * @param {any} rec @param {number} limit @returns {{ path: string, from: number, to: number }[]}
 */
function truncateToFit(rec, limit) {
  /** @type {Map<string, { path: string, from: number, to: number }>} */
  const cuts = new Map()
  let size = jsonBytes(rec)
  for (let guard = 0; size > limit && guard < 400; guard++) {
    /** @type {{ arr: any[], path: string, bytes: number }[]} */
    const arrays = []
    /** @param {any} v @param {PathNode | null} p */
    const walk = (v, p) => {
      if (isArr(v)) {
        if (v.length >= 16) arrays.push({ arr: v, path: pathStr(p), bytes: JSON.stringify(v).length })
        v.forEach((x, i) => walk(x, { up: p, k: i }))
      } else if (isObj(v)) {
        for (const k of Object.keys(v)) walk(v[k], { up: p, k })
      }
    }
    walk(rec.option, null)
    if (!arrays.length) break
    const best = arrays.reduce((a, b) => (b.bytes > a.bytes ? b : a))
    // 同じ長さの配列（xAxis.data と series.data など、並んで対になる物）は同じ長さに切る
    const len = best.arr.length
    const to = Math.ceil(len / 2)
    for (const a of arrays) {
      if (a.arr.length !== len) continue
      const from = cuts.get(a.path)?.from ?? len
      a.arr.length = to
      cuts.set(a.path, { path: a.path, from, to })
    }
    size = jsonBytes(rec)
  }
  return [...cuts.values()]
}

// ---------------------------------------------------------------- 取り出し（vm で実行）

// context の中で最初に流す。timer の列・乱数・Date の固定。例の code はこれらを大域として見る。
const PRELUDE = `
var __q = [], __id = 0, __now = 0, __flags = { timeout: 0, interval: 0 }, __errors = [];
(function () {
  var s = __seed | 0;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  var D = Date;
  Date = class extends D {
    constructor(...a) { if (a.length) super(...a); else super(${FIXED_NOW}); }
    static now() { return ${FIXED_NOW}; }
  };
})();
function setTimeout(fn, ms) {
  if (typeof fn !== 'function') return 0;
  __flags.timeout++;
  var id = ++__id;
  __q.push({ id: id, t: __now + (+ms || 0), fn: fn, a: Array.prototype.slice.call(arguments, 2) });
  return id;
}
function clearTimeout(id) { __q = __q.filter(function (x) { return x.id !== id; }); }
function setInterval(fn, ms) { __flags.interval++; return ++__id; }
function clearInterval() {}
function requestAnimationFrame(fn) { return setTimeout(fn, 16); }
function cancelAnimationFrame(id) { clearTimeout(id); }
function __runTimers() {
  var n = 0;
  while (__q.length && n < 100) {
    __q.sort(function (a, b) { return a.t - b.t || a.id - b.id; });
    var x = __q.shift(); __now = x.t; n++;
    try { x.fn.apply(null, x.a); } catch (e) { __errors.push(String((e && e.message) || e)); }
  }
  return n;
}
`

/**
 * @param {string} id
 * @param {string} js transpile 済みの JS
 * @param {any} echartsStub
 * @param {boolean} feed true なら $.get などの callback を空のデータ（anyData）で呼ぶ（骨組みを取る 2 回目）
 */
function runExample(id, js, echartsStub, feed, ms = RUN_MS) {
  /** @param {any} err */
  const stuck = (err) => {
    if (/timed out/i.test(String(err?.message))) throw new Error(`見本 ${id} が ${ms / 1000} 秒で終わらない。出力が時間で変わらないよう、作り直しを止める`)
  }
  const t0 = performance.now()
  const st = { data: false, registerMap: false }
  /** @type {Function[]} */
  const pending = []
  const dataFn = (/** @type {any[]} */ ...args) => {
    st.data = true
    const take = (/** @type {any} */ f) => { if (feed && typeof f === 'function') pending.push(f) }
    for (const a of args) { take(a); if (isObj(a)) take(a.success) }
    /** @type {any} */
    const th = { then(/** @type {any} */ f) { take(f); return th }, done(/** @type {any} */ f) { take(f); return th }, fail() { return th }, always() { return th }, catch() { return th }, finally() { return th } }
    return th
  }
  /** @type {any} */
  let state = null
  const myChart = loose({
    setOption: (/** @type {any} */ opt, /** @type {any} */ a) => { state = applyOption(state, opt, a) },
    getWidth: () => RENDER_W,
    getHeight: () => RENDER_H,
    getOption: () => cloneRaw(state ?? {}),
    isDisposed: () => false,
  })
  const echarts = loose({
    ...echartsStub,
    registerMap: () => { st.registerMap = true },
    registerTransform() {},
    registerTheme() {},
    registerLocale() {},
    use() {},
    init: () => myChart,
  })
  const $ = loose({ get: dataFn, getJSON: dataFn, ajax: dataFn, post: dataFn, getScript: dataFn, when: dataFn })
  const mod = { exports: {} }
  /** @type {Record<string, any>} */
  const sandbox = {
    option: undefined, echarts, myChart, $, jQuery: $, ROOT_PATH: ROOT_PATH_VALUE, app: {}, ecStat: loose(),
    document: loose(), window: loose({ innerWidth: RENDER_W, innerHeight: RENDER_H, devicePixelRatio: 1 }),
    structuredClone: (/** @type {any} */ v) => (ANY.has(v) ? v : structuredClone(v)),
    ...(feed ? { d3: anyData(), ecSimpleTransform: anyData(), BMap: anyData() } : {}),
    fetch: (/** @type {any[]} */ ...a) => dataFn(...a),
    CDN_PATH: 'https://fastly.jsdelivr.net/npm/',
    XMLHttpRequest: function () { st.data = true; return loose() },
    Image: function () { return loose() },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {}, table() {}, time() {}, timeEnd() {} },
    require: (/** @type {string} */ n) => (/^echarts/.test(n) ? echarts : loose()),
    module: mod, exports: mod.exports, __seed: hash32(id),
  }
  const ctx = vm.createContext(sandbox, { name: id, codeGeneration: { strings: false, wasm: false } })
  /** @type {string | null} */
  let failed = null
  let timedOut = false
  /** @type {string | null} */
  let timerError = null
  try {
    new vm.Script(PRELUDE, { filename: 'prelude' }).runInContext(ctx, { timeout: ms })
    const body = `(function () {\n${js}\n}).call(this);`
    new vm.Script(body, { filename: `${id}.js` }).runInContext(ctx, { timeout: ms })
  } catch (e) {
    const err = /** @type {any} */ (e)
    stuck(err)
    failed = `${err?.name ?? 'Error'}: ${String(err?.message ?? err).split('\n')[0]}`
  }
  // 遊び場と同じ順: 本体の中の setOption → 大域の option を置き換えで適用 → timer（時間順に 1 回ずつ）
  const g = sandbox.option
  if (isObj(g)) state = applyOption(state, g, true)
  /** @type {string | null} */
  let feedError = null
  let fed = 0
  if (!failed) {
    for (let round = 0; round < 6; round++) {
      try {
        new vm.Script('__runTimers()', { filename: 'timers' }).runInContext(ctx, { timeout: ms })
        const errs = /** @type {string[]} */ (vm.runInContext('__errors', ctx))
        if (errs.length && !timerError) timerError = errs[0]
      } catch (e) {
        stuck(e)
        timerError = `${/** @type {any} */ (e)?.name ?? 'Error'}: ${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}`
      }
      if (!pending.length) break
      // $.get の callback（feed のときだけ）。遊び場では非同期で、大域 option の適用の後に走る
      for (let n = 0; pending.length && n < 50; n++) {
        const cb = /** @type {Function} */ (pending.shift())
        fed++
        sandbox.__f = cb
        sandbox.__a = anyData()
        sandbox.__b = anyData()
        sandbox.__c = anyData()
        try {
          vm.runInContext('__f(__a, __b, __c)', ctx, { timeout: ms })
        } catch (e) {
          const err = /** @type {any} */ (e)
          stuck(err)
          feedError ??= `${err?.name ?? 'Error'}: ${String(err?.message ?? err).split(String.fromCharCode(10))[0]}`
        }
      }
      // callback が大域の option を作り直しただけで setOption しなかった場合も拾う
      if (sandbox.option !== g && isObj(sandbox.option)) state = applyOption(state, sandbox.option, true)
    }
  }
  const flags = /** @type {{ timeout: number, interval: number }} */ (vm.runInContext('__flags', ctx))
  return {
    state, failed, timerError, feedError, fed, dataFetched: st.data, registerMap: st.registerMap,
    timeouts: flags.timeout, intervals: flags.interval, ms: performance.now() - t0,
  }
}

// ---------------------------------------------------------------- 描画の確かめ

/** svgToOps の警告を種類にまとめる（数字・id・字の並びを落とす） */
function bucketWarning(/** @type {string} */ m) {
  return m
    .replace(/書体に無い字があります.*/s, '書体に無い字があります')
    .replace(/#\S+/g, '#id')
    .replace(/[0-9][0-9,.]*/g, 'N')
    .slice(0, 90)
}

// ---------------------------------------------------------------- 入口

/**
 * @param {{ out: string, root: string, src?: string, renderer?: string, maxJson?: number }} p
 *   out: 出力の根（assets/echarts/ と examples-report.* がここに出る）・root: mods-pdf の根
 *   src: 見本の ts の置き場・renderer: 描く束（renderSvg を export する .mjs。既定は同じ作り直しで出した <out>/hooks/vendor/echarts.mjs。無ければ <root> の物）
 *   reportDir: 報告の出す所（既定は <root>/out/assets-report）
 *   maxJson: 1 ファイルの上限（B）。既定 4 MiB。超えた物は同じ長さの長い配列を半分ずつ切り、flags.truncated に書く
 */
export async function buildExamples({ out, root, src = process.env.MODS_PDF_EXAMPLES_SRC || DEFAULT_SRC, renderer, maxJson = MAX_JSON, reportDir = path.join(root, 'out', 'assets-report') }) {
  const T0 = performance.now()
  const tm = { load: 0, transpile: 0, run: 0, render: 0, ops: 0, write: 0 }
  const req = createRequire(path.join(root, 'package.json'))
  const ts = req('typescript')
  const own = path.join(out, 'hooks/vendor/echarts.mjs')
  const rendererPath = renderer ?? (fs.existsSync(own) ? own : path.join(root, 'hooks/vendor/echarts.mjs'))
  const tl = performance.now()
  const full = await import(pathToFileURL(rendererPath).href)
  const { svgToOps } = await import(pathToFileURL(path.join(root, 'hooks/engine/svg.mjs')).href)
  const realEcharts = await import(pathToFileURL(path.join(root, 'node_modules/echarts/index.js')).href)
  const echartsStub = { ...realEcharts }
  tm.load = performance.now() - tl

  const files = fs.readdirSync(src, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(ts|js)$/.test(d.name))
    .map((d) => d.name)
    .sort()
  /** @type {Set<string>} */
  const seenIds = new Set()

  /** @type {any[]} */
  const items = []
  /** @type {{ id: string, error: string }[]} */
  const feedFailed = []
  const warn0 = console.warn
  console.warn = () => {}
  for (const file of files) {
    const ext = path.extname(file)
    const id = path.basename(file, ext)
    if (seenIds.has(id)) throw new Error(`id が重なっています: ${id}`)
    seenIds.add(id)
    if (TRACE) process.stderr.write(`extract ${id}
`)
    const code = fs.readFileSync(path.join(src, file), 'utf8')
    const h = parseHeader(code)

    let t = performance.now()
    let js = code
    if (ext === '.ts') {
      js = ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
        reportDiagnostics: false,
      }).outputText
    }
    js = js.replace(/^\s*export\s*\{\s*\};?\s*$/gm, '')
    tm.transpile += performance.now() - t

    t = performance.now()
    let r = runExample(id, js, echartsStub, false)
    // 外のデータを読む物は、callback を空のデータで流す 2 回目で option の骨組み（軸・系列・見た目）だけ取る
    let skeleton = false
    if (r.dataFetched) {
      const r2 = runExample(id, js, echartsStub, true)
      if (r2.state && Object.keys(r2.state).length) {
        r = r2
        skeleton = true
      } else {
        feedFailed.push({ id, error: r2.feedError ?? r2.failed ?? 'option が空のまま' })
      }
    }
    tm.run += performance.now() - t

    const raw = r.state ?? {}
    const { option, lossy, lossyCount } = plainOption(raw)
    const d = describeOption(option)
    const empty = !isObj(option) || Object.keys(option).length === 0
    const optionJson = JSON.stringify(option)
    const hasExtImage = optionJson.includes(ROOT_PATH_VALUE) || /image:\/\/https?:/.test(optionJson)
    const lostRenderItem = lossy.some((x) => /\.renderItem \(/.test(x + ' (') || /\.renderItem$/.test(x))

    /** @type {Record<string, any>} */
    const flags = {}
    if (lossyCount) { flags.lossy = lossy; if (lossyCount > lossy.length) flags.lossyMore = lossyCount - lossy.length }
    if (lostRenderItem) flags.lostRenderItem = true
    if (r.dataFetched || hasExtImage) flags.needsData = true
    if (d.hasGeo || r.registerMap || /\b(registerMap|getMap)\b/.test(code)) flags.needsMap = true
    if (d.hasGL || /echarts-gl/.test(code)) flags.needsGL = true
    if (/\becStat\b/.test(code)) flags.needsStat = true
    if (r.intervals > 0 || r.timeouts > 0) flags.animated = true
    if (r.failed) flags.failed = r.failed
    if (r.timerError) flags.timerError = r.timerError
    if (skeleton) {
      flags.skeleton = true
      if (r.feedError) flags.skeletonError = r.feedError
    }
    if (empty) {
      flags.empty = true
      if (!flags.failed && !flags.needsData) flags.failed = 'option が取れなかった（setOption も大域の option も無い）'
    }

    const category = (h.category ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    items.push({
      id, ext, file,
      rec: {
        id, title: h.title ?? id, titleCN: h.titleCN ?? '', category, option, flags,
        source: `apache/echarts-examples public/examples/ts/${id}${ext}`,
      },
      d, empty, runMs: r.ms,
      timers: { timeouts: r.timeouts, intervals: r.intervals },
      slow: r.ms > SLOW_MS,
    })
  }

  console.warn = warn0

  // ---- 描けるか（絵は見ない）
  /** @type {Record<string, { status: string, ms: number, ops?: number, warnings?: string[], error?: string, renderLog?: number }>} */
  const render = {}
  const origWarn = console.warn
  const origError = console.error
  for (const it of items) {
    const f = it.rec.flags
    if (f.failed || it.empty) {
      render[it.id] = { status: 'skipped', ms: 0 }
      continue
    }
    if (TRACE) process.stderr.write(`render ${it.id}
`)
    let logCount = 0
    console.warn = () => { logCount++ }
    console.error = () => { logCount++ }
    const t1 = performance.now()
    try {
      const svg = full.renderSvg(it.rec.option, { width: RENDER_W, height: RENDER_H })
      const t2 = performance.now()
      const o = svgToOps(svg, { width: RENDER_W, height: RENDER_H, clip: false, quietStyle: true })
      const t3 = performance.now()
      tm.render += t2 - t1
      tm.ops += t3 - t2
      render[it.id] = { status: 'ok', ms: t3 - t1, ops: o.ops.length, warnings: o.warnings, renderLog: logCount }
    } catch (e) {
      tm.render += performance.now() - t1
      render[it.id] = { status: 'threw', ms: performance.now() - t1, error: (String(/** @type {any} */ (e)?.message ?? e).split(String.fromCharCode(10))[0] || '(メッセージなし。本番の束は Error の字を持たない)'), renderLog: logCount }
    } finally {
      console.warn = origWarn
      console.error = origError
    }
  }

  // ---- paper と書き出し
  const tw = performance.now()
  const exDir = path.join(out, 'assets/echarts/examples')
  fs.mkdirSync(exDir, { recursive: true })
  for (const n of fs.readdirSync(exDir)) if (n.endsWith('.json')) fs.unlinkSync(path.join(exDir, n))

  /** @type {string[]} */
  const catalogLines = []
  /** @type {{ id: string, bytes: number }[]} */
  const sizes = []
  let totalBytes = 0
  for (const it of items) {
    const f = it.rec.flags
    const rd = render[it.id]
    f.paper = rd.status === 'ok' && (rd.warnings?.length ?? 0) === 0 && !f.needsData && !f.needsMap && !f.needsGL && !f.needsStat &&
      !f.failed && !f.empty && !f.lostRenderItem
    const cuts = truncateToFit(it.rec, maxJson)
    if (cuts.length) f.truncated = cuts
    const text = JSON.stringify(it.rec)
    fs.writeFileSync(path.join(exDir, `${it.id}.json`), text)
    const bytes = Buffer.byteLength(text)
    totalBytes += bytes
    sizes.push({ id: it.id, bytes })
    const { lossy, lossyMore, ...rest } = f
    const catFlags = { ...rest, ...(lossy ? { lossy: lossy.length + (lossyMore ?? 0) } : {}) }
    catalogLines.push(JSON.stringify({
      id: it.id, title: it.rec.title, titleCN: it.rec.titleCN, category: it.rec.category,
      series: it.d.types, component: it.d.components, flags: catFlags, bytes,
    }))
  }
  fs.mkdirSync(path.join(out, 'assets/echarts'), { recursive: true })
  fs.writeFileSync(path.join(out, 'assets/echarts/catalog.json'), `[\n${catalogLines.join(',\n')}\n]\n`)
  tm.write = performance.now() - tw

  // ---- 集計
  const count = (/** @type {(it: any) => boolean} */ fn) => items.filter(fn).length
  const rendered = Object.values(render).filter((r) => r.status !== 'skipped')
  const drewOk = rendered.filter((r) => r.status === 'ok')
  /** @type {Map<string, { charts: number, sample: string }>} */
  const wbucket = new Map()
  for (const r of drewOk) {
    for (const k of new Set((r.warnings ?? []).map(bucketWarning))) {
      const e = wbucket.get(k) ?? { charts: 0, sample: '' }
      e.charts++
      wbucket.set(k, e)
    }
  }
  for (const r of drewOk) for (const m of r.warnings ?? []) { const e = wbucket.get(bucketWarning(m)); if (e && !e.sample) e.sample = m.slice(0, 160) }
  const warningsTop = [...wbucket].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.charts - a.charts)
  /** @type {Map<string, string[]>} */
  const threw = new Map()
  for (const it of items) { const r = render[it.id]; if (r.status === 'threw') { const k = (r.error ?? '').slice(0, 100); threw.set(k, [...(threw.get(k) ?? []), it.id]) } }
  /** @type {Map<string, string[]>} */
  const failedBy = new Map()
  for (const it of items) { const k = it.rec.flags.failed; if (k) failedBy.set(k.replace(/\S+ is not defined/, (m) => m), [...(failedBy.get(k) ?? []), it.id]) }
  const biggest = sizes.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 5)
  const slowest = Object.entries(render).filter(([, r]) => r.status !== 'skipped').sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([id, r]) => ({ id, ms: Math.round(r.ms) }))
  const renderLogged = Object.entries(render).filter(([, r]) => (r.renderLog ?? 0) > 0).map(([id]) => id)

  // 外のデータ・地図・3D・統計・欠けた renderItem・失敗のどれでもない物（紙に出せる見込みの母数）
  const candidates = items.filter((it) => {
    const f = it.rec.flags
    return !f.needsData && !f.needsMap && !f.needsGL && !f.needsStat && !f.failed && !f.empty && !f.lostRenderItem
  })
  const summary = {
    total: items.length,
    extracted: count((it) => !it.rec.flags.failed && !it.empty),
    failed: count((it) => it.rec.flags.failed),
    empty: count((it) => it.empty),
    rendered: rendered.length,
    drewOk: drewOk.length,
    threw: rendered.length - drewOk.length,
    drewWithoutWarning: drewOk.filter((r) => (r.warnings?.length ?? 0) === 0).length,
    lossy: count((it) => it.rec.flags.lossy),
    lostRenderItem: count((it) => it.rec.flags.lostRenderItem),
    needsData: count((it) => it.rec.flags.needsData),
    needsMap: count((it) => it.rec.flags.needsMap),
    needsGL: count((it) => it.rec.flags.needsGL),
    needsStat: count((it) => it.rec.flags.needsStat),
    animated: count((it) => it.rec.flags.animated),
    timerError: count((it) => it.rec.flags.timerError),
    skeleton: count((it) => it.rec.flags.skeleton),
    skeletonError: count((it) => it.rec.flags.skeletonError),
    skeletonNotTaken: feedFailed.length,
    truncated: count((it) => it.rec.flags.truncated),
    paper: count((it) => it.rec.flags.paper),
    paperCandidates: candidates.length,
    candidatesDrew: candidates.filter((it) => render[it.id].status === 'ok').length,
    candidatesThrew: candidates.filter((it) => render[it.id].status === 'threw').length,
    candidatesWithWarning: candidates.filter((it) => render[it.id].status === 'ok' && (render[it.id].warnings?.length ?? 0) > 0).length,
    setIntervalUsers: count((it) => it.timers.intervals > 0),
    setTimeoutUsers: count((it) => it.timers.timeouts > 0),
  }
  const totalMs = performance.now() - T0
  const report = {
    generatedBy: 'scripts/assets/examples.mjs',
    renderer: path.relative(root, rendererPath).replace(/\\/g, '/'),
    renderSize: [RENDER_W, RENDER_H],
    choices: {
      setInterval: '何もしない（最初の 1 こま＝最初の option）',
      setTimeout: '本体と大域 option の適用の後に、時間順に 1 回ずつ流す（再帰は 100 回まで）',
      random: 'id から決めた種で固定（mulberry32）',
      date: '2026-01-01T00:00:00Z に固定',
      '$.get など': 'callback を呼ばない（needsData）',
      svgToOps: 'metrics なし（書体に無い字の警告は出ない）・quietStyle',
    },
    summary,
    sizes: { totalBytes, totalMiB: +(totalBytes / 1048576).toFixed(2), biggest },
    timingsMs: Object.fromEntries(Object.entries({ ...tm, total: totalMs }).map(([k, v]) => [k, Math.round(v)])),
    slowestRender: slowest,
    warningsTop,
    renderThrew: [...threw].map(([error, ids]) => ({ error, count: ids.length, ids })),
    failedReasons: [...failedBy].map(([reason, ids]) => ({ reason, count: ids.length, ids })),
    slowRuns: items.filter((it) => it.slow).map((it) => ({ id: it.id, ms: Math.round(it.runMs) })),
    skeletonNotTaken: feedFailed,
    skeletonErrors: items.filter((it) => it.rec.flags.skeletonError).map((it) => ({ id: it.id, error: it.rec.flags.skeletonError })),
    timerErrors: items.filter((it) => it.rec.flags.timerError).map((it) => ({ id: it.id, error: it.rec.flags.timerError })),
    renderLogged,
    items: items.map((it) => {
      const r = render[it.id]
      const f = it.rec.flags
      return {
        id: it.id, paper: f.paper, extract: f.failed ? 'failed' : it.empty ? 'empty' : 'ok', render: r.status,
        ...(r.ops !== undefined ? { ops: r.ops } : {}), ...(r.warnings?.length ? { warnings: r.warnings } : {}),
        ...(r.error ? { error: r.error } : {}),
      }
    }),
  }
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, 'examples-report.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(reportDir, 'examples-report.md'), reportMd(report, items, render))
  return { summary, sizes: report.sizes, timingsMs: report.timingsMs }
}

/** @param {any} rep @param {any[]} items @param {Record<string, any>} render */
function reportMd(rep, items, render) {
  const s = rep.summary
  const L = []
  L.push('# 見本の取り出しと自動確かめ', '')
  L.push(`見本 ${s.total} 本（apache/echarts-examples の public/examples/ts 直下の .ts ${items.filter((i) => i.ext === '.ts').length} 本と .js ${items.filter((i) => i.ext === '.js').length} 本。gl/・archive/・doc-example/ は入れない）。`)
  L.push(`描く束: ${rep.renderer}・大きさ ${rep.renderSize.join('×')}・svgToOps は metrics なし。絵は見ていない。`, '')
  L.push('## 集計', '', '| 項目 | 数 |', '|---|---|')
  const rows = [
    ['全体', s.total], ['option を取り出せた', s.extracted], ['failed（取り出せなかった）', s.failed], ['empty（option が空）', s.empty],
    ['描画を試した', s.rendered], ['描けた', s.drewOk], ['描くのに投げた', s.threw], ['描けて警告なし', s.drewWithoutWarning],
    ['lossy（関数などを落とした）', s.lossy], ['lostRenderItem（カスタム系列の renderItem が無い）', s.lostRenderItem],
    ['needsData', s.needsData], ['needsMap', s.needsMap], ['needsGL', s.needsGL], ['needsStat（ecStat が要る）', s.needsStat],
    ['skeleton（$.get の callback を空データで流して骨組みを取った）', s.skeleton], ['skeletonError（その途中で投げた。骨組みは途中まで）', s.skeletonError],
    ['skeleton を取れず空のまま', s.skeletonNotTaken], ['paper の母数（上の「要る」物と失敗を除いた物）', s.paperCandidates], ['その中で描けた', s.candidatesDrew], ['その中で投げた', s.candidatesThrew],
    ['その中で警告があった', s.candidatesWithWarning], ['animated', s.animated], ['truncated（4 MiB 超で切った）', s.truncated], ['timerError', s.timerError], ['paper（紙にそのまま出せる）', s.paper],
  ]
  for (const [k, v] of rows) L.push(`| ${k} | ${v} |`)
  L.push('', `setInterval を呼ぶ見本 ${s.setIntervalUsers} 本（何もしない）・setTimeout を呼ぶ見本 ${s.setTimeoutUsers} 本（時間順に 1 回ずつ流す）。`, '')
  L.push('## 大きさと時間', '', `JSON の合計 ${rep.sizes.totalBytes.toLocaleString('en-US')} B（${rep.sizes.totalMiB} MiB）。一番大きい物:`, '')
  for (const b of rep.sizes.biggest) L.push(`- ${b.id}: ${b.bytes.toLocaleString('en-US')} B`)
  L.push('', `時間（ms）: ${Object.entries(rep.timingsMs).map(([k, v]) => `${k} ${v}`).join('・')}`)
  L.push(`描画の一番遅い物: ${rep.slowestRender.map((x) => `${x.id} ${x.ms}ms`).join('・')}`, '')
  L.push('## svgToOps の警告（上位）', '')
  if (!rep.warningsTop.length) L.push('なし')
  for (const w of rep.warningsTop.slice(0, 15)) L.push(`- ${w.charts} 本: ${w.sample || w.key}`)
  L.push('', '## 描くのに投げた物', '')
  if (!rep.renderThrew.length) L.push('なし')
  for (const t of rep.renderThrew) L.push(`- ${t.count} 本「${t.error}」: ${t.ids.join('・')}`)
  L.push('', '## 取り出せなかった物（failed）', '')
  if (!rep.failedReasons.length) L.push('なし')
  for (const t of rep.failedReasons) L.push(`- ${t.count} 本「${t.reason}」: ${t.ids.join('・')}`)
  if (rep.skeletonNotTaken.length) {
    L.push('', '## 骨組みを取れず空のまま（外のデータが要る）', '')
    for (const t of rep.skeletonNotTaken) L.push(`- ${t.id}: ${t.error}`)
  }
  if (rep.skeletonErrors.length) {
    L.push('', '## 骨組みの途中で投げた物', '')
    for (const t of rep.skeletonErrors) L.push(`- ${t.id}: ${t.error}`)
  }
  if (rep.timerErrors.length) {
    L.push('', '## timer の中で投げた物（最初の option は取れている）', '')
    for (const t of rep.timerErrors) L.push(`- ${t.id}: ${t.error}`)
  }
  if (rep.renderLogged.length) L.push('', `## ECharts が console に出した物（${rep.renderLogged.length} 本）`, '', rep.renderLogged.join('・'))
  L.push('', '## flags の約束', '',
    '- paper: needsData・needsMap・needsGL・needsStat・failed・empty・lostRenderItem でなく、描けて、svgToOps の警告が無い。',
    '- lossy: 落とした項目の道（最大 50。超えた分は lossyMore に数）。目録では数だけ。',
    '- needsData: $.get などを呼んだ、または ROOT_PATH の画像を指す。',
    '- skeleton: $.get などの callback を空のデータで流して取った option。data は空で、軸・系列・見た目だけが本物。skeletonError は途中で投げた時の理由。',
    '- animated: setInterval か setTimeout を呼んだ。',
    '- empty: option が空。')
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------- 直に実行された時

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (/** @type {string} */ k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }
  let root = arg('--root')
  if (!root) {
    // この script から上へたどって mods-pdf の根（package.json の name が mods-pdf）を探す
    let dir = path.dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++, dir = path.dirname(dir)) {
      try { if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'mods-pdf') { root = dir; break } } catch {}
    }
  }
  if (!root) throw new Error('mods-pdf の根が見つかりません（--root で渡す）')
  const out = arg('--out') ?? root
  const r = await buildExamples({ out, root, renderer: arg('--renderer'), ...(arg('--max-json') ? { maxJson: Number(arg('--max-json')) } : {}) })
  console.log(JSON.stringify(r, null, 1))
}
