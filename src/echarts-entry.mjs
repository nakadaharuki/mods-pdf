// @ts-check
// 選ばなかった案: echarts の全部を入れる案（束が 1.5 MB を超える）。Tooltip と AxisPointer は紙に出ないので入れない。
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart, ScatterChart, CandlestickChart } from 'echarts/charts'
import {
  GridComponent, TitleComponent, LegendComponent, DatasetComponent, MarkLineComponent, MarkAreaComponent,
} from 'echarts/components'

echarts.use([
  SVGRenderer,
  BarChart, LineChart, PieChart, ScatterChart, CandlestickChart,
  GridComponent, TitleComponent, LegendComponent, DatasetComponent, MarkLineComponent, MarkAreaComponent,
])

/**
 * ECharts の option を SVG の字にする（描いたら捨てる。アニメーションは切る）
 * @param {object} option
 * @param {{ width: number, height: number }} size
 * @returns {string}
 */
export function renderSvg(option, { width, height }) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    chart.setOption({ ...option, animation: false })
    return chart.renderToSVGString()
  } finally {
    // 選ばなかった案: 描いた物を覚えて使い回す案。束の中に描画の状態を持たせないため、毎回捨てる
    chart.dispose()
  }
}
