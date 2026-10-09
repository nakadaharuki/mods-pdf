// 出典: Apache ECharts 6.1.0（https://echarts.apache.org・Apache-2.0）・zrender（BSD-3-Clause）
const process = { env: { NODE_ENV: 'production' }, nextTick: (f, ...a) => Promise.resolve().then(() => f(...a)) }, setTimeout = (f) => { Promise.resolve().then(f); return 0 }, clearTimeout = () => {}, setImmediate = (f) => Promise.resolve().then(f);
// 元は scripts/assets/echarts.mjs の entry。scripts/build-assets.mjs で作る。手で直さない。LICENSE は ../../LICENSES/
import{install2 as install3,install3 as install4,install4 as install5,install5 as install6,install6 as install7}from"./echarts-c-WQRKJF73.mjs";import{install,install2}from"./echarts-c-KTTBGBHO.mjs";import"./echarts-c-LDSGYSI5.mjs";import{use}from"./echarts-c-BHQNKAUK.mjs";use([install3,install4,install,install5,install2,install6,install7]);
