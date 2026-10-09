// @ts-check
// biz の束: 事業計画の 13 形（market・matrix2x2・cycle・process・pyramid・milestones・org・venn・mekko・compare-table・flowchart・kpi-hero・pnl）。形を足す時は import を足して、下の配列に入れる（index.mjs が束を静的に読む）。
// ModsPDF の形（本人の look の決まりに沿って新しく作った物）。決まりの元は look の designs/（本人の作・PolyForm Noncommercial 1.0.0・Required Notice: Copyright 2026 Haruki Nakada）。ここは束ねるだけで、各ファイルの頭に決まりと選ばなかった案がある。
import market from './market.mjs'
import matrix2x2 from './matrix2x2.mjs'
import cycle from './cycle.mjs'
import process from './process.mjs'
import pyramid from './pyramid.mjs'
import milestones from './milestones.mjs'
import org from './org.mjs'
import venn from './venn.mjs'
import mekko from './mekko.mjs'
import compareTable from './compare-table.mjs'
import flowchart from './flowchart.mjs'
import kpiHero from './kpi-hero.mjs'
import pnl from './pnl.mjs'

export default [market, matrix2x2, cycle, process, pyramid, milestones, org, venn, mekko, compareTable, flowchart, kpiHero, pnl]
