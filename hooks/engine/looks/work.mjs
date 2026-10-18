// @ts-check
// work の束: 日付（heatmap・gantt・calendar-month・timeline）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の work の形（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import heatmap from './heatmap.mjs'
import gantt from './gantt.mjs'
import calendarMonth from './calendar-month.mjs'
import timeline from './timeline.mjs'

export default [heatmap, gantt, calendarMonth, timeline]
