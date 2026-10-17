// @ts-check
// 速さの試験の測り方。1 回の壁時計は並列の試験・JIT・GC の巻き添えで 2〜3 倍に伸びるので、
// 同じ処理を n 回流して「いちばん速かった 1 回」を見る（負荷は時間を伸ばす方にしか働かない。最良は処理そのものの速さに近い）。
// 閾値は緩めない。最初の 1 回も捨てない（最良を見るので、初回の最適化前の値は自然に外れる）。
// 選ばなかった案:
// - process.cpuUsage() で CPU 時間を測る案: 同時に走る別のプロセスとの取り合い（ハイパースレッド・キャッシュ）で CPU 時間も伸びる。壁時計の最良のほうが安定した。
// - 閾値を 2 倍にする案: 本物の退化（2 倍遅くなる）を見逃す。

/**
 * fn を n 回流し、最良の時間（ms）と最後の返り値を返す。
 * @template T
 * @param {() => T} fn
 * @param {number} [n]
 * @returns {{ ms: number, value: T, times: number[] }}
 */
export function fastest(fn, n = 3) {
  /** @type {number[]} */
  const times = []
  /** @type {T} */
  let value
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    value = fn()
    times.push(performance.now() - t0)
  }
  // @ts-ignore n は 1 以上
  return { ms: Math.min(...times), value, times }
}

/**
 * 非同期の fn を n 回流し、最良の時間（ms）と最後の返り値を返す。
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [n]
 * @returns {Promise<{ ms: number, value: T, times: number[] }>}
 */
export async function fastestAsync(fn, n = 3) {
  /** @type {number[]} */
  const times = []
  /** @type {T} */
  let value
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    value = await fn()
    times.push(performance.now() - t0)
  }
  // @ts-ignore n は 1 以上
  return { ms: Math.min(...times), value, times }
}

/** 「12・8・9ms」の形 @param {number[]} times */
export const fmtTimes = (times) => `${times.map((t) => Math.round(t)).join('・')}ms`
