// @ts-check
// work の束: 日付（heatmap・gantt・calendar-month・timeline）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// 元は look の designs/ の work の形（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。ここは束ねるだけで、各ファイルの頭に元のファイルの名前がある。
import heatmap from './heatmap.mjs'
import gantt from './gantt.mjs'
import calendarMonth from './calendar-month.mjs'
import timeline from './timeline.mjs'

export default [heatmap, gantt, calendarMonth, timeline]
