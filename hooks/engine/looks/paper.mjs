// @ts-check
// 紙の上の図（looks）で、形どうしが同じにする物: 色の割り当て・墨の割合の段・点線の形・線の太さ・字の大きさ・数と日付の書き方（小数の桁の決め方）・目盛り（左と下の棒と字）・字の幅のめやす・
// 小さな部品（凡例の札・濃さの凡例・見出しの数・単位の注記・下の x の字・ラベルの押し分けと空き探し・環の一片・札の並べ方）。
// 純な部品（Mods の決まりは docs/design.md の 2 章。ドル記号の直後の点・Node の物・動的な読み込み・タイマーを使わない）。乱数は種つきの seeded だけ。
// 約束は docs/looks.md の 2 章。元は本人の look Mod の designs/（同じ作者の作。look 本体は PolyForm Noncommercial だが、このリポの写しは作者が MIT で出す）。
//
// 形を足す人へ: 墨の割合・点線・線の太さ・字の大きさ・数と日付の書き方は、ここの名前で書く（0.25 や '3 3' や 1.25 や 9 を形のファイルに直に書かない）。
// look の頭の文の数は、下の ALPHA・DASH・LW・字の大きさの表で紙の値に置き換える。ここにある道具（numOf・decimals・axisLeft・hero・shade など）を形のファイルに写して持たない
// （試験 test/looks-family.test.mjs が、ここの名前と同じ名前の定義・線の太さの数・種つき乱数の式の写しを形のファイルに探す）。
//
// 選ばなかった案
// - pal を形ごとに受けて色を直に書く案: 形が 40 を超えると「墨の何 %」が形ごとにずれる。割合は ALPHA に 1 か所で持つ。
// - 字にも fill-opacity を掛けて薄い字を作る案: svg.mjs は半透明の字を紙の色に混ぜた色に直すので、pal の色の外に出る。字は ink か sub の不透明だけ。
// - 目盛りを d3-array の ticks に任せる案: paper を d3 から離しておくため（candle などは d3 を読まない）。同じ考え方を数行で自前に持つ。
// - Intl で 3 桁区切り・日付の名前にする案: フックの環境に Intl があるとは限らない。手で区切り、曜日と月の名前は表で持つ。
// - 字の大きさを look の 9・10・11・13・14・18・22 px ごとに増やす案: 紙では差が見えず、形ごとに大きさが散る。紙は 7.5・8・14・20 の 4 段だけ（docs/looks.md の 2 章）。
// - 束（time-series・spread-kit・parts-kit）ごとに目盛り・桁・見出しを持つ案: 43 を並べた頁で、目盛りの棒の濃さ・字と棒の間・同じ値の桁が束ごとに違って見えた。束には data の読み方だけを残す。

/** @typedef {{ ink: string, sub: string, rule: string, tint: string, accent: string, up: string, down: string, paper: string, accent2?: string, grad?: string[], series?: string[] }} Pal accent2 と grad は資料の vivid だけが持つ（無い紙では単色で描く）。series は色のテーマ（vivid・koma・mergeble）の系列の色（8 色。先頭は accent）で、mono は持たない */
/** @typedef {'ja'|'en'} Lang */
/** @typedef {{ width: number, height: number, pal: Pal, lang: Lang }} DrawOpts 形の draw に渡す。width・height は pt */
// 型は別のファイルから、import の型指定（括弧つき）で引かない: hook-env-check が「動的な読み込み」の字として探すので落ちる。形のファイルは Pal と DrawOpts の typedef を頭に写して書く（candle.mjs のとおり）。

// ---------------------------------------------------------------- 字

/** ModsPDF の svg.mjs が sans に当てる書体名。太字は font-weight="bold"。look の等幅（パス・sha・桁の列）も紙では sans（数字は全部 0.555em の等幅なので、右揃えで桁が揃う） */
export const FONT = 'Noto Sans JP'
/** 紙の字の下限（pt）。これ未満は svg.mjs が持ち上げて警告にする */
export const MIN_PT = 7
/**
 * 字の大きさは 4 段だけ。look の px からの置き換え:
 *   9（目盛り・注記・凡例・灰の字）→ TICK 7.5 / 10（名前）→ LABEL 8 / 11（値）→ VALUE 8 の太字 /
 *   13・14・18（見出しの数・輪の中の %・gauge の中）→ BIG 14 / 22（tiles・waffle の大きな数）→ HUGE 20
 */
export let TICK = 7.5
export let NOTE = 7.5
/** 名前 */
export let LABEL = 8
/** 値（太字にして名前と分ける） */
export let VALUE = 8
/** 大きな数（見出しの数・gauge・progress-rings の中央など） */
export const BIG = 14
/** 特大の数（tiles・waffle） */
export const HUGE = 20
/** 4 段の既定の大きさ。textMin はこれを持ち上げる（withTextMin） */
const BASE_SIZES = Object.freeze({ TICK: 7.5, NOTE: 7.5, LABEL: 8, VALUE: 8 })
/** textMin の上限。BIG（14pt）より大きな下限は段の順（名前 < 大きな数）を壊す */
const TEXT_MIN_MAX = 12
/** 今の下限（pt）。withTextMin の中だけ 0 でない */
let floor = 0

/**
 * 字の大きさの下限 min（pt。資料の図は 9）を掛けて fn を呼ぶ。TICK・NOTE・LABEL・VALUE と text() が min 未満の字を作らなくなり、
 * 字の幅から決める余白・省略（textWidth・clip・gutter）も持ち上げた大きさで量る。fn が終わる（投げる）と元の大きさに戻る。
 * 選ばなかった案:
 *   - 形の draw に textMin を渡し、形が TICK のかわりに Math.max(TICK, textMin) を書く案: 56 の形の字の大きさの箇所すべてに写しが散り、幅の見積もりと実際の字がずれる形が出る。
 *   - 描いた svg の font-size を後で持ち上げる案: 字が太って隣と重なり、「…」で切る幅の見積もりも外れる。描く前に大きさそのものを変える。
 * 段が 1 つ（BIG・HUGE）のものは下限より大きいので動かさない。
 * @template T @param {number | undefined} min @param {() => T} fn @returns {T}
 */
export function withTextMin(min, fn) {
  const m = typeof min === 'number' && Number.isFinite(min) && min > 0 ? Math.min(TEXT_MIN_MAX, min) : 0
  const before = { floor, TICK, NOTE, LABEL, VALUE }
  floor = m
  TICK = Math.max(BASE_SIZES.TICK, m)
  NOTE = Math.max(BASE_SIZES.NOTE, m)
  LABEL = Math.max(BASE_SIZES.LABEL, m)
  VALUE = Math.max(BASE_SIZES.VALUE, m)
  try {
    return fn()
  } finally {
    floor = before.floor
    TICK = before.TICK
    NOTE = before.NOTE
    LABEL = before.LABEL
    VALUE = before.VALUE
  }
}

/**
 * 資料の図の主役の数（事業計画の 13 形の kpi-hero の先頭の 1 つだけ。資料の頁は版面が 745pt あり、20pt の数では主役に見えない）。
 * 43 の形は 4 段のまま。細字で書く（太字は VALUE 以下）
 */
export const HERO = 32

/**
 * 字を縦の中心 y に置く時の基線（text の y は基線）。Noto Sans JP の字面の中心は基線の上 0.35em
 * @param {number} y 置きたい中心 @param {number} size
 */
export function midline(y, size) {
  return y + size * 0.35
}

// ---------------------------------------------------------------- 墨の割合の段（look の頭の文のとおり）

/**
 * 暗い地の「明るい墨の何 %」を、紙では「濃い墨の同じ %」に置く。look の 43 の頭の文に出る段を名前で持つ。
 *   faint 8%: 薄い面（sparks の線の下・ridgeline のふつうの日・funnel の台形・calendar の日・chord の帯・sunburst の外の輪）
 *   quiet 10%: 下に敷く量（candle の出来高・cost-burn の日ごとの額）
 *   grid 12%: 輪・格子・空きの升（radar の輪と軸・waffle の空き・heatmap の空いた日）。紙では線の下限 PRINT.line に持ち上がる
 *   track 14%: 流れの帯・地の道（sankey のつながり・progress-rings の道・tiles の枠）
 *   card 18%: 群の枠・静かな線（circle-pack の群・parallel-coords のほかの線）
 *   edge 22%: 帯の縁・範囲の濃い所（chord の帯の縁・bullet のよくない範囲）
 *   area 25%: 面の塗り（box・violin・scatter の泡・funnel・treemap・polar-area・threshold を超えた所）。
 *             頁を埋める面は body 55% にしない（streamgraph・sunburst・polar-area・funnel の頭の文: 55% の面は candle より目立った）
 *   last・ref 35%: 参照線（candle の最後の値・SLO・目標・p50・回帰の線・つなぎの線）。点線は DASH.ref
 *   dim 42%: 下げた印（週末の日の数・3 番目の種類の点）
 *   body 55%: 量・本体の塗り（candle の本体・bars・sankey の節・waterfall の棒）
 *   strong 65%: 外れ値の点・等高線の芯
 *   wick 80%: ヒゲ・slope の線
 *   heavy 85%: 合計の線・いちばん濃い升
 */
export const ALPHA = Object.freeze({
  faint: 0.08, quiet: 0.1, grid: 0.12, track: 0.14, card: 0.18, edge: 0.22, area: 0.25,
  last: 0.35, ref: 0.35, dim: 0.42, body: 0.55, strong: 0.65, wick: 0.8, heavy: 0.85,
})

/**
 * 印刷で飛ばない下限（紙の白の上の見本の頁で確かめた値。docs/looks.md の 2 章）。
 * 暗い地では 12% の細い線もはっきり見えるが、紙の白の上では 1pt の線は 14% でかすれ、0.5pt は 14% 以下で消える。塗りは 6% で消える。
 *   line: 太さ thin 以下の線の下限 18%（card の段）。fill: 塗りと太い線の下限 8%（faint の段）
 * fillAttr と strokeAttr がこの下限まで自動で持ち上げる。試験（test/looks-kit.mjs）も同じ値で見る。
 * 選ばなかった案: 下限を形ごとに任せる案。radar の輪・tiles の枠・contour の外の線が形ごとに消えたり残ったりする。
 */
export const PRINT = Object.freeze({ line: 0.18, fill: 0.08, thin: 1.5 })

/**
 * 点線の形（pt）。ref: 参照線（candle の最後の値と同じ「3 3」）。series: 系列を線の形で分ける時。dot: 3 つ目の線の形・見込みの線
 */
export const DASH = Object.freeze({ ref: '3 3', series: '4 3', dot: '1 2' })

/**
 * 線の太さの段（pt）。look の線は全部 1px で、目立たせる 1 本は色（Claude の橙）だけで分けていた。mono の紙は色で分けられないので、目立たせる 1 本だけを太くする。
 *   hair 0.75: 札の縁・群の外形・細い格子（印刷の下限 0.5 より上）
 *   line 1: ふつうの線・目盛りの 4pt の棒（look の 1px）
 *   hot 1.5: 目立たせる 1 本（mono で墨 100% の線が、ほかの 55% 以下の線から太さでも分かれる）。今日・最多の升の縁も同じ
 *   ring 2: 色で状態を伝える弧と輪（gauge・progress-rings。look の 2px）
 * 選ばなかった案: 形ごとに 1.2・1.25・1.5 を選ばせる案。並べた頁で、目立たせる線の太さが形ごとに違って見えた（radar・slope は 1.25、bump・multi-line は 1.5 だった）。
 */
export const LW = Object.freeze({ hair: 0.75, line: 1, hot: 1.5, ring: 2 })

/** 系列が 2 つ以上の時は、色でなく墨の濃さと線の形で分ける（青を使わない）。濃い順・実線から */
const SERIES = [
  { a: 1, dash: '' },
  { a: 0.55, dash: '' },
  { a: 0.3, dash: '' },
  { a: 1, dash: DASH.series },
  { a: 0.55, dash: DASH.series },
  { a: 0.3, dash: DASH.series },
  { a: 1, dash: DASH.dot },
  { a: 0.55, dash: DASH.dot },
  { a: 0.3, dash: DASH.dot },
]
/** 目立たせる 1 本がある時のほかの線（100% は目立たせる 1 本に譲る） */
const REST = SERIES.filter((s) => s.a < 1)

/**
 * i 番目の系列の見た目。hasHot（目立たせる 1 本がほかにある）の時は 100% の段を飛ばす。段の数を超えたら最初に戻る（上限 12 の系列でも落ちない）
 * @param {number} i @param {boolean} [hasHot]
 * @returns {{ a: number, dash: string }}
 */
export function seriesStyle(i, hasHot = false) {
  const list = hasHot ? REST : SERIES
  return list[((Math.trunc(i) % list.length) + list.length) % list.length]
}

// ---------------------------------------------------------------- 色

/** theme.mjs の mono の色の写し（accent2 は 2 つ目の系列の灰・grad は墨だけの止まりで、グラデーションにならず単色で描く）。pal が足りない時の代わり（試験が theme.mjs と同じことを確かめる） */
export const MONO = Object.freeze({ ink: '#111111', sub: '#4A4A4A', rule: '#CCCCC9', tint: '#F1F0ED', accent: '#111111', accent2: '#6B6B6B', grad: Object.freeze(['#111111', '#111111']), up: '#176639', down: '#A31F1C', paper: '#FFFFFF' })
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * pal の色を '#rrggbb' の形だけにする。足りない・おかしい色は mono の色。SVG の属性に入るので、字の注入をここで止める
 * @param {any} pal
 * @returns {Pal}
 */
export function cleanPal(pal) {
  /** @type {Record<string, any>} */
  const out = { ...MONO, grad: [...MONO.grad] }
  if (pal && typeof pal === 'object') {
    for (const k of Object.keys(MONO)) if (k !== 'grad' && typeof pal[k] === 'string' && HEX.test(pal[k])) out[k] = pal[k]
    if (Array.isArray(pal.grad) && pal.grad.length >= 2 && pal.grad.length <= 8 && pal.grad.every((/** @type {unknown} */ c) => typeof c === 'string' && HEX.test(c))) out.grad = [...pal.grad]
    if (Array.isArray(pal.series) && pal.series.length >= 2 && pal.series.length <= 12 && pal.series.every((/** @type {unknown} */ c) => typeof c === 'string' && HEX.test(c))) out.series = [...pal.series]
  }
  return /** @type {Pal} */ (out)
}

/** accent が墨と同じ紙（mono）か。そうなら「目立たせる 1 つ」は色でなく墨の濃さで示す @param {Pal} pal */
export function isMono(pal) {
  return pal.accent.toLowerCase() === pal.ink.toLowerCase()
}

// ---------------------------------------------------------------- 系列の色（色のテーマ）

/*
 * 色のテーマ（vivid・koma・mergeble。本人 2026-10-09「白黒こだわるのやめて」「カラーじゃないと見にくい」）では、系列・項目を pal.series の色で分ける。
 * 墨の濃さ（ALPHA）と点線（DASH）で分けるのは mono の時だけ。形は `seriesFill(…) ?? 今までの塗り` のように書き、mono の絵は 1 字も変えない。
 * 目立たせる 1 つ（hot）は series[0]（= accent）の全部の濃さ、ほかは series[1…] を順に薄く（細く）して、差を付ける。
 * 選ばなかった案:
 *   - 目立たせる 1 つに専用の色（accent2 の橙）を使う案: accent2 を持たない紙（koma・mergeble の series）で目立たせる色が系列の色と重なる。accent は series[0] に決めてあるので、目立たせる 1 つは「1 番目の色」で足りる。
 *   - ほかの項目を墨の濃さで退かせる案: 色のテーマで灰色の項目が混じると、凡例の色と絵が合わない。色は保ち、濃さ（TONE）と太さで退かせる。
 */

/**
 * 塗りの濃さ。fill: 目立たせる物（と、目立たせる物が無い時の全部）・fillRest: 目立たせる物があるときのほか・line と lineRest は線の同じ組・under は字を載せる塗り（ink の字が 3 対 1 以上で読める濃さ。試験が確かめる）
 */
export const TONE = Object.freeze({ fill: 0.85, fillRest: 0.5, line: 1, lineRest: 0.7, under: 0.4 })

/** 量の坂（濃さの段）の色。色のテーマは accent の濃さ、mono は墨の濃さ @param {Pal} pal */
export function rampColor(pal) {
  return hasSeries(pal) ? pal.accent : pal.ink
}

/** 色のテーマか（pal.series がある） @param {Pal} pal */
export function hasSeries(pal) {
  return Array.isArray(pal.series) && pal.series.length > 0
}

/**
 * i 番目の系列・項目の色。色のテーマでなければ null。hot（目立たせる物の番号。無ければ -1）があれば、hot は series[0]（accent）、ほかは series[1…] を順に（hot を飛ばして数える）。8 色を超えたら回る
 * @param {Pal} pal @param {number} i @param {number} [hot]
 * @returns {string | null}
 */
export function seriesColor(pal, i, hot = -1) {
  const s = pal.series
  if (!Array.isArray(s) || !s.length) return null
  const k = Math.trunc(i)
  if (hot >= 0) {
    if (k === hot) return s[0]
    const rest = s.length > 1 ? s.slice(1) : s
    const j = k > hot ? k - 1 : k
    return rest[((j % rest.length) + rest.length) % rest.length]
  }
  return s[((k % s.length) + s.length) % s.length]
}

/**
 * 色のテーマの塗り（i 番目の系列・項目）。色のテーマでなければ null（`seriesFill(…) ?? 今までの塗り` と書く）。
 * a は目立たせる物（と hot が無い時の全部）の濃さで、既定 TONE.fill。hot があるとき、ほかは a を TONE.fillRest / TONE.fill の比で薄くする
 * @param {Pal} pal @param {number} i @param {number} [hot] @param {number} [a]
 * @returns {string | null}
 */
export function seriesFill(pal, i, hot = -1, a = TONE.fill) {
  const c = seriesColor(pal, i, hot)
  if (c === null) return null
  return fillAttr(c, hot < 0 || i === hot ? a : a * (TONE.fillRest / TONE.fill))
}

/**
 * 色のテーマの線（i 番目の系列・項目）。色のテーマでなければ null。目立たせる物（と hot が無い時の全部）は TONE.line、ほかは TONE.lineRest。太さ w と点線 dash は呼ぶ側が決める
 * @param {Pal} pal @param {number} i @param {number} [hot] @param {number} [w] @param {string} [dash]
 * @returns {string | null}
 */
export function seriesStroke(pal, i, hot = -1, w = LW.line, dash = '') {
  const c = seriesColor(pal, i, hot)
  if (c === null) return null
  return strokeAttr(c, hot < 0 || i === hot ? TONE.line : TONE.lineRest, w, dash)
}

/** 細い形（flowchart・process・milestones・cycle）を 2 つの行に折り返す下限の段の数 */
export const WRAP_MIN = 5

/**
 * 細い形を 2 つの行に折り返すか。段が WRAP_MIN 以上で、箱の高さ H が自然な高さの 2 倍以上の時だけ true（H が無限・自然な高さを出す時は false）
 * @param {number} steps @param {number} H @param {number} natural
 */
export function wrapsTwoRows(steps, H, natural) {
  return steps >= WRAP_MIN && Number.isFinite(H) && natural > 0 && H >= 2 * natural
}

/** 座標・寸法の字（小数 2 桁まで・余分な 0 を落とす・-0 と指数の書き方を出さない） @param {number} n */
export function f(n) {
  const v = Math.round(n * 100) / 100
  return Number.isFinite(v) ? String(v === 0 ? 0 : v) : '0'
}

/** 不透明度の字（3 桁まで）。 @param {number} a */
const opa = (a) => String(Math.round(Math.min(1, Math.max(0, a)) * 1000) / 1000)

/**
 * 塗りの属性。a が 1 なら不透明度は付けない。0 より大きく PRINT.fill 未満の a は PRINT.fill に持ち上げる（印刷で消えない）
 * @param {string} color @param {number} [a]
 */
export function fillAttr(color, a = 1) {
  const v = a > 0 ? Math.max(a, PRINT.fill) : a
  return v < 1 ? `fill="${color}" fill-opacity="${opa(v)}"` : `fill="${color}"`
}

/**
 * 線の属性。dash は 'a b'（pt）。太さ PRINT.thin 以下の線は PRINT.line、それより太い線は PRINT.fill まで a を持ち上げる
 * @param {string} color @param {number} [a] @param {number} [w] @param {string} [dash]
 */
export function strokeAttr(color, a = 1, w = 1, dash = '') {
  const v = a > 0 ? Math.max(a, w <= PRINT.thin ? PRINT.line : PRINT.fill) : a
  return `stroke="${color}"${v < 1 ? ` stroke-opacity="${opa(v)}"` : ''} stroke-width="${f(w)}"${dash ? ` stroke-dasharray="${dash}"` : ''}`
}

/** 墨の塗り（fill と fill-opacity の組） @param {Pal} pal @param {number} [a] */
export function inkFill(pal, a = 1) {
  return fillAttr(pal.ink, a)
}

/** 墨の線 @param {Pal} pal @param {number} [a] @param {number} [w] @param {string} [dash] */
export function inkStroke(pal, a = 1, w = 1, dash = '') {
  return strokeAttr(pal.ink, a, w, dash)
}

/**
 * 面の帯を分ける紙の色の細い線（look の「1px の stage の線」。stacked-area・streamgraph・treemap の境）
 * @param {Pal} pal @param {number} [w]
 */
export function seam(pal, w = 1) {
  return strokeAttr(pal.paper, 1, w)
}

/**
 * mono で面を目立たせる時の濃さ。look の濃さより 1 段（25%）濃く、ただし 80%（wick）まで。
 * 55% の面（sankey の流れ・waffle の今日）が、同じ 55% の本体（節・使った升）から離れ、黒い板にもならない（見本の頁で 55%・80%・100% を比べた）
 * @param {number} a look の濃さ
 */
export function monoArea(a) {
  return Math.min(ALPHA.wick, a + 0.25)
}

/**
 * 目立たせる 1 つの色と濃さ。色のある紙は accent を look の濃さ a で。mono は accent が墨と同じなので、墨を aMono（既定 100%）で。
 * 選ばなかった案: mono でも a のまま描く案。look では色だけで分けていた物（同じ 55% の本体と目立たせる 1 本）が、mono では見分けられない。
 * @param {Pal} pal @param {number} a look の濃さ @param {number} [aMono]
 * @returns {{ color: string, a: number }}
 */
export function hot(pal, a, aMono = 1) {
  return isMono(pal) ? { color: pal.ink, a: aMono } : { color: pal.accent, a }
}

/**
 * 目立たせる 1 つの塗り。mono の既定は monoArea(a)（面を 100% にすると黒い板になる）。点・小さな印を 100% にしたい時は aMono に 1 を渡す
 * @param {Pal} pal @param {number} a @param {number} [aMono]
 */
export function hotFill(pal, a, aMono = monoArea(a)) {
  const h = hot(pal, a, aMono)
  return fillAttr(h.color, h.a)
}

/**
 * 目立たせる 1 本の線。mono の既定は 100%。ほかの線は seriesStyle(i, true) か ALPHA.ref 以下に下げる（look の 0.9 の線のままだと 100% と見分けられない）。
 * 太い帯（sankey の流れ）は面なので aMono に monoArea(a) を渡す
 * @param {Pal} pal @param {number} a @param {number} [w] @param {number} [aMono] @param {string} [dash]
 */
export function hotStroke(pal, a, w = 1, aMono = 1, dash = '') {
  const h = hot(pal, a, aMono)
  return strokeAttr(h.color, h.a, w, dash)
}

/** 上げ・下げの色（0 は上げ。candle の陽線と同じ） @param {Pal} pal @param {number} delta */
export function trendColor(pal, delta) {
  return delta >= 0 ? pal.up : pal.down
}

// ---------------------------------------------------------------- 字の書き出しと形

// 制御の字・双方向の制御・ゼロ幅の字は SVG に入れない（読み手が字として並べると崩れる）
const BAD = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u{200B}-\u{200F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}]/gu
const LONE_SURROGATE = /[\u{D800}-\u{DFFF}]/gu

/**
 * XML の字に直す（& < > " '）。空白の並びは 1 つにして、制御の字は捨てる
 * @param {unknown} s
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(BAD, '')
    .replace(LONE_SURROGATE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * <text> を 1 つ。y は基線（縦の中心に置く時は midline）。大きさは MIN_PT 未満にしない。
 * fill は pal の ink・sub（と、目立たせる字の accent・上げ下げの up・down）の不透明な色だけを渡す。rule・tint・paper の字は薄すぎて印刷で飛ぶ
 * @param {number} x @param {number} y 基線
 * @param {unknown} s
 * @param {{ size?: number, fill?: string, anchor?: 'start'|'middle'|'end', bold?: boolean }} [o]
 */
export function text(x, y, s, { size = LABEL, fill = 'currentColor', anchor = 'start', bold = false } = {}) {
  const sz = Math.max(MIN_PT, floor, size)
  return `<text x="${f(x)}" y="${f(y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} font-size="${f(sz)}" font-family="${FONT}"${bold ? ' font-weight="bold"' : ''} fill="${fill}">${esc(s)}</text>`
}

/** <line> を 1 本。stroke は strokeAttr・inkStroke の字 @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {string} stroke */
export function line(x1, y1, x2, y2, stroke) {
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${stroke}/>`
}

/** <rect> を 1 つ。fill は fillAttr・inkFill の字。w・h が 0 以下なら空の字（0 の高さの印は line で描く） @param {number} x @param {number} y @param {number} w @param {number} h @param {string} fill @param {string} [extra] */
export function rect(x, y, w, h, fill, extra = '') {
  if (!(w > 0) || !(h > 0)) return ''
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${fill}${extra ? ` ${extra}` : ''}/>`
}

/** <circle> を 1 つ。look の点は r=2（外れ値は 1.5）。attr は fillAttr か strokeAttr の字（枠だけの丸は 'fill="none" ' を前に足す） @param {number} cx @param {number} cy @param {number} r @param {string} attr */
export function circle(cx, cy, r, attr) {
  if (!(r > 0)) return ''
  return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${attr}/>`
}

/** 塗りの <path>。d は d3 の path の字か自前の字 @param {string} d @param {string} fill */
export function fillPath(d, fill) {
  return d ? `<path d="${d}" ${fill}/>` : ''
}

/** 線の <path>（塗りなし） @param {string} d @param {string} stroke */
export function strokePath(d, stroke) {
  return d ? `<path d="${d}" fill="none" ${stroke}/>` : ''
}

/**
 * 上げ下げの三角の d（tiles の変化の印。▲▼ の字は全角 1em で値の字と並ばないので形で描く）。中心 (cx, cy)・幅 s
 * @param {number} cx @param {number} cy @param {number} s @param {boolean} up
 */
export function triangle(cx, cy, s, up) {
  const h = s * 0.8
  return up
    ? `M${f(cx - s / 2)} ${f(cy + h / 2)}L${f(cx + s / 2)} ${f(cy + h / 2)}L${f(cx)} ${f(cy - h / 2)}Z`
    : `M${f(cx - s / 2)} ${f(cy - h / 2)}L${f(cx + s / 2)} ${f(cy - h / 2)}L${f(cx)} ${f(cy + h / 2)}Z`
}

/**
 * 流れや線の上に字を置く時の下敷き（紙の色の 85%）。x・y は字の箱の左上
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {Pal} pal
 */
export function underlay(x, y, w, h, pal) {
  return rect(x, y, w, h, fillAttr(pal.paper, 0.85))
}

/** 図の外側の svg。viewBox は 0 0 w h（pt）で、width・height も同じ値にして縮尺を 1 にする。地は塗らない @param {number} w @param {number} h @param {string} body */
export function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">${body}</svg>`
}

/** data が空の時の図（真ん中に「データがありません」） @param {DrawOpts} o */
export function empty(o) {
  return svgDoc(o.width, o.height, text(o.width / 2, o.height / 2, tr(o.lang, 'データがありません', 'No data'), { size: LABEL, fill: o.pal.sub, anchor: 'middle' }))
}

/** 日本語か英語かで字を選ぶ @param {Lang} lang @param {string} ja @param {string} en */
export function tr(lang, ja, en) {
  return lang === 'en' ? en : ja
}

// ---------------------------------------------------------------- 字の幅のめやす

/** ASCII（0x20〜0x7E）の送り（em の 100 倍）。Noto Sans JP の regular を測った値 */
const ASCII = [
  22, 32, 47, 56, 56, 92, 68, 28, 34, 34, 47, 56, 28, 35, 28, 39, 56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 28, 28, 56, 56, 56, 47,
  95, 61, 66, 64, 69, 59, 55, 69, 73, 29, 54, 65, 54, 81, 72, 74, 63, 74, 64, 60, 60, 72, 57, 88, 57, 53, 60, 34, 39, 34, 56, 56,
  61, 56, 62, 51, 62, 55, 33, 56, 61, 28, 28, 55, 28, 93, 61, 61, 62, 62, 39, 47, 38, 61, 52, 80, 50, 52, 48, 34, 27, 34, 56,
]
/** ASCII の外で、全角（1em）でも数字の幅でもない字の送り（em）。同じく測った値 */
const OTHER = new Map([
  [0xa0, 0.22], [0xa3, 0.56], [0xa5, 0.56], [0xa7, 1], [0xa8, 0.61], [0xa9, 0.83], [0xab, 0.48], [0xae, 0.47], [0xb0, 0.37], [0xb1, 1],
  [0xb4, 0.61], [0xb5, 0.63], [0xb6, 1], [0xbb, 0.48], [0xd7, 1], [0xf7, 1],
  [0x2013, 0.54], [0x2014, 0.89], [0x2018, 0.28], [0x2019, 0.28], [0x201c, 0.47], [0x201d, 0.47], [0x2022, 0.34],
  [0x2032, 0.28], [0x2033, 0.47], [0x20ac, 0.56], [0x2122, 0.71], [0x2212, 0.56],
])
/** 太字の増し。字ごとの比は 0.99〜1.21 で、並びの平均は 1.06 前後。clip がはみ出さない側に寄せる */
const BOLD = 1.08

/**
 * 1 字の幅（em）。ASCII と一部の記号は測った値、和字・全角・省略記号（この書体では全角の幅）は 1、そのほかの欧字は 0.6
 * @param {string} ch
 */
export function charEm(ch) {
  const cp = /** @type {number} */ (ch.codePointAt(0))
  if (cp >= 0x20 && cp <= 0x7e) return ASCII[cp - 0x20] / 100
  const other = OTHER.get(cp)
  if (other !== undefined) return other
  if (cp >= 0xff61 && cp <= 0xff9f) return 0.5
  if (cp >= 0xa0 && cp <= 0x24f) return 0.6
  return 1
}

/**
 * 字の列の幅（pt）。太字は 8% 増しで見積もる
 * @param {string} s @param {number} size @param {boolean} [bold]
 */
export function textWidth(s, size, bold = false) {
  let em = 0
  for (const ch of String(s)) em += charEm(ch)
  return em * size * (bold ? BOLD : 1)
}

/**
 * maxW（pt）に収まるよう、長い字を「…」で切る。収まる字はそのまま
 * @param {string} s @param {number} size @param {number} maxW @param {boolean} [bold]
 */
export function clip(s, size, maxW, bold = false) {
  const str = String(s)
  if (textWidth(str, size, bold) <= maxW) return str
  const ell = textWidth('…', size, bold)
  const chars = Array.from(str)
  let w = 0
  let out = ''
  for (const ch of chars) {
    const cw = charEm(ch) * size * (bold ? BOLD : 1)
    if (w + cw + ell > maxW) break
    out += ch
    w += cw
  }
  return `${out.trimEnd()}…`
}

/**
 * 右の余白（値の字を置く所）の幅。いちばん長い字の幅 + 8pt と min の大きい方（candle の 52pt が min の基準）
 * @param {string[]} labels @param {{ size?: number, bold?: boolean, min?: number }} [o]
 */
export function gutter(labels, { size = VALUE, bold = false, min = 52 } = {}) {
  return Math.max(min, Math.ceil(Math.max(0, ...labels.map((s) => textWidth(s, size, bold)))) + 8)
}

// ---------------------------------------------------------------- 字の置き方

/**
 * 下の x の字（時系列の形が共通で使う）: 最初は left に左揃え・最後は right に右揃え・真ん中は at(真ん中) を中心に、両方から 8pt 離れて収まる時だけ。
 * 軸の線と目盛りの線は引かない（look の決まり）。空の字は置かない
 * @param {unknown[]} labels x の字の列 @param {(i: number) => number} at i 番目の x 座標 @param {number} left @param {number} right @param {number} y 基線 @param {Pal} pal
 */
export function edgeLabels(labels, at, left, right, y, pal) {
  const n = labels.length
  if (!n) return ''
  const maxW = (right - left) / 3
  const str = (/** @type {number} */ i) => clip(labels[i] === undefined || labels[i] === null ? '' : String(labels[i]), TICK, maxW)
  /** @type {{ s: string, a: 'start'|'middle'|'end', x: number, w: number }[]} */
  const marks = []
  const first = str(0)
  if (first) marks.push({ s: first, a: 'start', x: left, w: textWidth(first, TICK) })
  const lastS = n > 1 ? str(n - 1) : ''
  if (lastS) marks.push({ s: lastS, a: 'end', x: right, w: textWidth(lastS, TICK) })
  const mid = Math.floor((n - 1) / 2)
  const midS = n > 4 && first && lastS ? str(mid) : ''
  if (midS) {
    const w = textWidth(midS, TICK)
    const cx = at(mid)
    if (cx - w / 2 > left + marks[0].w + 8 && cx + w / 2 < right - marks[1].w - 8) marks.push({ s: midS, a: 'middle', x: cx, w })
  }
  return marks.map((m) => text(m.x, y, m.s, { size: TICK, fill: pal.sub, anchor: m.a })).join('')
}

/**
 * 縦に並ぶラベル（線の端の名前・値）を、互いに gap 以上離れるよう押し分けた y を返す（並びは ys の順のまま）。
 * 上から順に下へ押し、hi を超えたら下から上へ押し戻す。lo..hi に全部が入らない時は lo から gap ずつ並べる
 * @param {number[]} ys 置きたい y @param {number} gap @param {number} lo @param {number} hi
 * @returns {number[]}
 */
export function dodge(ys, gap, lo, hi) {
  const order = ys.map((y, i) => ({ y: Number.isFinite(y) ? y : lo, i })).sort((a, b) => a.y - b.y || a.i - b.i)
  const out = order.map((o) => Math.min(hi, Math.max(lo, o.y)))
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap)
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap)
    if (out[0] < lo) for (let k = 0; k < out.length; k++) out[k] = lo + k * gap
  }
  /** @type {number[]} */
  const res = []
  order.forEach((o, k) => { res[o.i] = out[k] })
  return res
}

/**
 * 凡例の小さな札を横に並べる。mark は box（7pt の四角・面の系列）・line（12pt の線・線の系列）・dot（r=2 の点）。attr は fillAttr か strokeAttr の字。
 * 字は TICK の sub。anchor が end なら x が右の端。返すのは svg の字と幅
 * @param {number} x @param {number} y 基線
 * @param {{ label: string, mark: 'box'|'line'|'dot', attr: string }[]} keys
 * @param {Pal} pal
 * @param {{ anchor?: 'start'|'end', gap?: number }} [o]
 * @returns {{ svg: string, width: number }}
 */
export function legend(x, y, keys, pal, { anchor = 'start', gap = 10 } = {}) {
  const markW = (/** @type {string} */ m) => (m === 'line' ? 12 : m === 'dot' ? 4 : 7)
  const widths = keys.map((k) => markW(k.mark) + 3 + textWidth(k.label, TICK))
  const width = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, keys.length - 1)
  let cx = anchor === 'end' ? x - width : x
  const cy = y - TICK * 0.35
  /** @type {string[]} */
  const out = []
  keys.forEach((k, i) => {
    const mw = markW(k.mark)
    if (k.mark === 'line') out.push(line(cx, cy, cx + mw, cy, k.attr))
    else if (k.mark === 'dot') out.push(circle(cx + 2, cy, 2, k.attr))
    else out.push(rect(cx, cy - 3.5, 7, 7, k.attr))
    out.push(text(cx + mw + 3, y, k.label, { size: TICK, fill: pal.sub }))
    cx += widths[i] + gap
  })
  return { svg: out.join(''), width }
}

/**
 * 幅 maxW に収まる最初の字を選ぶ（長い説明から短い言い方へ）。どれも収まらなければ、最後の字を「…」で切る
 * @param {string[]} choices 長い順 @param {number} maxW @param {number} [size]
 */
export function fitText(choices, maxW, size = TICK) {
  for (const c of choices) if (textWidth(c, size) <= maxW) return c
  return clip(choices[choices.length - 1] ?? '', size, Math.max(0, maxW))
}

/**
 * 図の上の見出し: 大きな数（BIG・墨）と、その右の説明（TICK・sub）。基線は y。どの形の見出しもこれで書く（大きさ・色・数と説明の間 8pt が形ごとに散らない）。
 * 説明は maxRight（図の右の端）に収まるよう「…」で切り、24pt も残らなければ置かない。
 * 大きな数が図の幅に収まらない時（狭い図に 10 桁の合計）は、字の段を 1 つ下げた太字（VALUE）にして説明を置かず、それでも収まらなければ見出しごと置かない。
 * 選ばなかった案: 数を「…」で切る案。別の数に読める。
 * @param {string} big @param {string} caption @param {Pal} pal @param {number} x @param {number} y 基線 @param {number} maxRight
 */
export function hero(big, caption, pal, x, y, maxRight) {
  const bigW = textWidth(big, BIG)
  if (x + bigW > maxRight) return x + textWidth(big, VALUE, true) > maxRight ? '' : text(x, y, big, { size: VALUE, fill: pal.ink, bold: true })
  const room = maxRight - (x + bigW + 8)
  const cap = room >= 24 ? clip(caption, TICK, room) : ''
  return text(x, y, big, { size: BIG, fill: pal.ink }) + (cap ? text(x + bigW + 8, y, cap, { size: TICK, fill: pal.sub }) : '')
}

/**
 * 「単位: 円」の字（単位が無ければ空）。図の下の左に TICK の sub で置く（look の左下の注記の場所）
 * @param {string} unit @param {Lang} lang
 */
export function unitNote(unit, lang) {
  return unit ? `${tr(lang, '単位', 'Unit')}: ${unit}` : ''
}

/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box 字の囲み（左上と右下） */

/** 2 つの箱が pad より近いか（重なりを含む） @param {Box} a @param {Box} b @param {number} [pad] */
export function overlaps(a, b, pad = 0) {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad
}

/**
 * w × h の箱（字の囲み）を、どの印とも重ならない所に置く。まず cands（箱の左上の候補）を順に試し、だめなら from を中心に広がる格子の上を近い順に試す。見つからなければ null。
 * 選ばなかった案: 字の位置を data の座標でじかに決める案（look の hexbin は「33 秒・0.8k」に置いた）。別の data では印の上に乗る。印の方を調べて空いた所を探す。
 * @param {{ w: number, h: number, from: [number, number], cands?: [number, number][], bounds: Box, points?: [number, number][], pad?: number, boxes?: Box[] }} o
 *   points は避ける印の中心（pad の外に出す）。boxes は避ける四角（置いたほかのラベルなど。2pt 離す）
 * @returns {{ x0: number, y0: number } | null}
 */
export function freeSpot({ w, h, from, cands = [], bounds, points = [], pad = 3, boxes = [] }) {
  const fits = (/** @type {number} */ x0, /** @type {number} */ y0) => {
    if (x0 < bounds.x0 || y0 < bounds.y0 || x0 + w > bounds.x1 || y0 + h > bounds.y1) return false
    for (const [px, py] of points) if (px > x0 - pad && px < x0 + w + pad && py > y0 - pad && py < y0 + h + pad) return false
    const me = { x0, y0, x1: x0 + w, y1: y0 + h }
    for (const b of boxes) if (overlaps(me, b, 2)) return false
    return true
  }
  for (const [x0, y0] of cands) if (fits(x0, y0)) return { x0, y0 }
  const step = 5
  /** @type {[number, number, number][]} */
  const grid = []
  const reachX = Math.ceil((bounds.x1 - bounds.x0) / step)
  const reachY = Math.ceil((bounds.y1 - bounds.y0) / step)
  for (let i = -reachX; i <= reachX; i++) for (let j = -reachY; j <= reachY; j++) grid.push([i * step, j * step, i * i * step * step + j * j * step * step])
  grid.sort((a, b) => a[2] - b[2])
  for (const [dx, dy] of grid.slice(0, 4000)) {
    const x0 = from[0] - w / 2 + dx
    const y0 = from[1] - h / 2 + dy
    if (fits(x0, y0)) return { x0, y0 }
  }
  return null
}

// ---------------------------------------------------------------- data を受ける小さな道具

/** 名前の字（字か数だけ。前後の空白を落とす。ほかは ''） @param {unknown} v */
export function nameOf(v) {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
}

/** 配列ならそのまま、ほかは空の配列 @param {unknown} v @returns {any[]} */
export function arr(v) {
  return Array.isArray(v) ? v : []
}

/**
 * 形が描ける数より多い列を、先頭から max 個に切って warnings に書く（index.mjs の上限は 10 秒を守る物、これは形の見た目の上限）
 * @template T @param {T[]} list @param {number} max @param {string[]} warnings @param {string} what 「ローソク足: 足」のような名前
 * @returns {T[]}
 */
export function keep(list, max, warnings, what) {
  if (list.length <= max) return list
  warnings.push(`${what}は ${num(max)} 個までなので、超えた ${num(list.length - max)} 個を捨てました`)
  return list.slice(0, max)
}

/**
 * d0..d1 を r0..r1 に写す 1 次の関数。d0 と d1 が同じ（幅 0）なら r0 と r1 の真ん中
 * @param {number} d0 @param {number} d1 @param {number} r0 @param {number} r1
 * @returns {(v: number) => number}
 */
export function linear(d0, d1, r0, r1) {
  const span = d1 - d0
  if (!(Math.abs(span) > 0) || !Number.isFinite(span)) return () => (r0 + r1) / 2
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}

// ---------------------------------------------------------------- 数

/** 3 桁ごとに「,」を入れた整数の字 @param {string} digits */
function group3(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 数の字。3 桁ごとに「,」・小数は digits 桁。数でない値（NaN・無限）は「–」
 * @param {unknown} v @param {number} [digits]
 */
export function num(v, digits = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '–'
  const d = Math.min(6, Math.max(0, Math.trunc(digits)))
  if (!(Math.abs(v) < 1e21)) return '–'
  const fixed = Math.abs(v).toFixed(d)
  const [int, dec] = fixed.split('.')
  const body = group3(int) + (dec ? `.${dec}` : '')
  return v < 0 && Number(fixed) !== 0 ? `-${body}` : body
}

/**
 * 符号つきの数の字（変化・差）。正は「+」、負は「-」、0 は符号なし
 * @param {unknown} v @param {number} [digits]
 */
export function signed(v, digits = 0) {
  const s = num(v, digits)
  return typeof v === 'number' && s !== '–' && v > 0 && Number(s.replace(/,/g, '')) !== 0 ? `+${s}` : s
}

/**
 * 割合の字。ratio は 0〜1 の比（0.574 → 「57%」）。digits を省くと、10% 未満は小数 1 桁・それ以上は整数
 * 選ばなかった案: 百分率の数（57.4）を受ける案。data の value / max・count / total をそのまま渡せる比の方が、形の中で 100 を掛け忘れない
 * sign を true にすると、正の値に + を付ける（変化の割合）
 * @param {unknown} ratio @param {number} [digits] @param {boolean} [sign]
 */
export function percent(ratio, digits, sign = false) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '–'
  const p = ratio * 100
  const d = digits ?? (Math.abs(p) < 10 && Math.abs(p) > 0 ? 1 : 0)
  return `${sign ? signed(p, d) : num(p, d)}%`
}

/**
 * 数に直す。数と、数の字（「1,234」「12.5」）だけを受け、それ以外・無限・NaN は NaN。null を 0 にしない
 * @param {unknown} v
 */
export function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/** 値の上限（1,000 兆）。これより大きい値を足すと合計が無限になり、座標が NaN になる（sankey の 1e308 の試験で見つけた）。形はこの上限で値を捨てて warnings に書く */
export const VALUE_MAX = 1e15

/** 数に直し、絶対値が VALUE_MAX を超える値も NaN にする（toNum と同じく、数と数の字だけを受ける） @param {unknown} v */
export function numOf(v) {
  const n = toNum(v)
  return Math.abs(n) <= VALUE_MAX ? n : NaN
}

/*
 * 小数の桁の決め方は 3 つだけ（形のファイルで桁の規則を作らない）。
 *   autoDigits(大きさ): 字の桁の上限（1,000 以上 0・100 以上 1・1 以上 2・0.1 以上 3。有効数字 3〜4 桁）。candle は価格の幅に当てる（「115.08」）
 *   decimals(値の列): data の値が持つ桁（13.000 は 0 桁・2.41 は 2 桁）を、いちばん大きい値の autoDigits まで。並べる値は全部同じ桁
 *   statDigits(幅): 計算で出した値（中央値・平均・傾き）の桁。幅の有効数字 3 桁の粗さ（16.47 を「16.5」）。計算した値は桁がいくらでも続くので、data の値より 1 段粗い
 *   stepDigits(間隔): 目盛りの字の桁（目盛りは切りのよい値なので、間隔の桁で足りる）
 * 選ばなかった案
 * - decimals の上限を値の幅の autoDigits にする案: 幅 0.55 の 2 つの値が「2.414・1.860」と 4 桁になった。大きさで決め、差が上限の桁より細かい時だけ、差が見える桁まで足す（1,234.5 → 1,234.9 を「1,235 → 1,235」と書くと、上がった線の色と字が食い違う）。
 * - 束ごとに桁の規則を持つ案（time は 10 未満 2 桁・1,000 未満 1 桁、parts は値の桁を 2 桁まで、compare は大きさの autoDigits）: 並べた頁で、同じ 12.35 が形によって「12.3」「12.35」になった。
 * - 値ごとに桁を変える案: 縦に並べた値の桁が揃わず、右揃えでも小数点が揃わない。
 */

/** 値の幅（最大 − 最小）から、区別のつく小数の桁を決める @param {number} span */
export function autoDigits(span) {
  const s = Math.abs(span)
  if (!(s > 0) || !Number.isFinite(s)) return 0
  if (s >= 1000) return 0
  if (s >= 100) return 1
  if (s >= 1) return 2
  if (s >= 0.1) return 3
  return 4
}

/**
 * data の値の列を書く小数の桁（0〜max）。値が表せるいちばん少ない桁を、上限まで。上限は、いちばん大きい値の autoDigits と、最大と最小の差が見える桁（stepDigits(差)）の大きい方。
 * 足し算の誤差（18.200000000000003）は上限の桁で丸めて消える。数でない値は見ない
 * @param {number[]} values @param {number} [max]
 */
export function decimals(values, max = 3) {
  let lo = Infinity
  let hi = -Infinity
  let big = 0
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
    big = Math.max(big, Math.abs(v))
  }
  if (!(hi >= lo)) return 0
  const cap = Math.min(Math.max(0, Math.trunc(max)), Math.max(autoDigits(big), hi > lo ? stepDigits(hi - lo) : 0))
  for (let d = 0; d < cap; d++) {
    const k = 10 ** d
    if (values.every((v) => !Number.isFinite(v) || Math.abs(v * k - Math.round(v * k)) < 1e-9 * Math.max(1, Math.abs(v * k)))) return d
  }
  return cap
}

/**
 * 1 つの値を、その値が持つ桁（0〜2 桁）で書いた字。「14.8万円 / 40万円」のような、ほかの値と並ばない字に使う。sign なら正に「+」
 * @param {number} v @param {boolean} [sign]
 */
export function plain(v, sign = false) {
  const d = decimals([v], 2)
  return sign ? signed(v, d) : num(v, d)
}

/**
 * 計算した値（中央値・平均・傾き）の小数の桁。幅 span の有効数字 3 桁（1,600 と 160 は 0 桁・70 と 16 は 1 桁・1.6 は 2 桁。最大 4）
 * @param {number} span
 */
export function statDigits(span) {
  const s = Math.abs(span)
  if (!(s > 0) || !Number.isFinite(s)) return 0
  return Math.min(4, Math.max(0, 2 - Math.floor(Math.log10(s))))
}

/** 目盛りの字の小数の桁（ticks・tickStep の間隔は 1・2・5 の 10 の冪の倍数なので、間隔の位の桁で足りる。0.5 と 0.2 は 1 桁・0.05 は 2 桁。最大 6） @param {number} step */
export function stepDigits(step) {
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(Math.abs(step) || 1) + 1e-9)))
}

/** 3 桁の有効数字にした字（1.23 万・4.5K など） @param {number} x */
const sig3 = (x) => String(Number(x.toPrecision(3)))

/**
 * 大きな数を短く。日本語は万・億・兆、英語は K・M・B・T。千未満（日本語は万未満）はそのまま
 * @param {number} v @param {Lang} [lang]
 */
export function compact(v, lang = 'ja') {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (lang === 'en') {
    if (a >= 1e12) return `${sign}${sig3(a / 1e12)}T`
    if (a >= 1e9) return `${sign}${sig3(a / 1e9)}B`
    if (a >= 1e6) return `${sign}${sig3(a / 1e6)}M`
    if (a >= 1e3) return `${sign}${sig3(a / 1e3)}K`
    return `${sign}${sig3(a)}`
  }
  if (a >= 1e12) return `${sign}${sig3(a / 1e12)}兆`
  if (a >= 1e8) return `${sign}${sig3(a / 1e8)}億`
  if (a >= 1e4) return `${sign}${sig3(a / 1e4)}万`
  return `${sign}${num(a, a < 10 && !Number.isInteger(a) ? 2 : 0)}`
}

const PREFIX_UNITS = new Set(['$', '¥', '€', '£'])
const CJK = /^[\u{3000}-\u{9fff}\u{ff00}-\u{ffef}]/u

/**
 * 値の字に単位を付ける。$ ¥ € £ は前・日本語の単位と % は詰めて後ろ・英字の単位は空けて後ろ
 * @param {string} s @param {unknown} [unit]
 */
export function withUnit(s, unit) {
  if (typeof unit !== 'string' || unit === '') return s
  if (PREFIX_UNITS.has(unit)) return s.startsWith('-') || s.startsWith('+') ? `${s[0]}${unit}${s.slice(1)}` : `${unit}${s}`
  if (unit === '%' || CJK.test(unit)) return `${s}${unit}`
  return `${s} ${unit}`
}

// ---------------------------------------------------------------- 日付と時刻

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土']
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * 'YYYY-MM-DD' を読む。無い日（2 月 30 日など）・形の違う字は null。dow は曜日（0 が日曜）、mon は月曜を 0 にした曜日（look の週は月曜から）。
 * Date.UTC だけを使う（今の時刻は読まない）
 * @param {unknown} s
 * @returns {{ y: number, m: number, d: number, dow: number, mon: number, day: number } | null} day は 1970-01-01 からの日数（日の差を引き算で出す）
 */
export function parseYmd(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  const dow = back.getUTCDay()
  return { y, m: mo, d, dow, mon: (dow + 6) % 7, day: Math.round(t / 86400000) }
}

/** 'YYYY-MM' を読む。形の違う字・無い月は null @param {unknown} s @returns {{ y: number, m: number, days: number, firstMon: number } | null} days は月の日数、firstMon は 1 日の曜日（月曜 0） */
export function parseYm(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})$/.exec(s.trim()) : null
  if (!m) return null
  const [y, mo] = [Number(m[1]), Number(m[2])]
  if (mo < 1 || mo > 12) return null
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { y, m: mo, days, firstMon: (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7 }
}

/**
 * 1970-01-01 からの日数 day の日。iso は 'YYYY-MM-DD'（dateLabel に渡せる）。dow は曜日（0 が日曜）・mon は月曜を 0 にした曜日
 * @param {number} day
 * @returns {{ y: number, m: number, d: number, dow: number, mon: number, day: number, iso: string }}
 */
export function ymdOfDay(day) {
  const t = new Date(Math.round(day) * 86400000)
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth() + 1
  const d = t.getUTCDate()
  const dow = t.getUTCDay()
  return { y, m, d, dow, mon: (dow + 6) % 7, day: Math.round(day), iso: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

/** 曜日の名前（0 が日曜） @param {number} dow @param {Lang} [lang] */
export function weekday(dow, lang = 'ja') {
  const i = ((Math.trunc(dow) % 7) + 7) % 7
  return lang === 'en' ? DOW_EN[i] : DOW_JA[i]
}

/**
 * 日付の字。kind: md「10/9」（en「Oct 9」）・mdw「10/9（金）」（en「Fri Oct 9」）・ymd「2026/10/9」（en「Oct 9, 2026」）・ym「2026年10月」（en「Oct 2026」）・m「10月」（en「Oct」）。
 * 読めない字はそのまま返す（data の x がもともと「7/1」などの時）
 * @param {unknown} s 'YYYY-MM-DD' か 'YYYY-MM' @param {Lang} [lang] @param {'md'|'mdw'|'ymd'|'ym'|'m'} [kind]
 */
export function dateLabel(s, lang = 'ja', kind = 'md') {
  const full = parseYmd(s)
  const ym = full ?? parseYm(s)
  if (!ym) return nameOf(s)
  const { y, m } = ym
  if (kind === 'ym') return lang === 'en' ? `${MONTH_EN[m - 1]} ${y}` : `${y}年${m}月`
  if (kind === 'm') return lang === 'en' ? MONTH_EN[m - 1] : `${m}月`
  if (!full) return lang === 'en' ? `${MONTH_EN[m - 1]} ${y}` : `${y}年${m}月`
  const { d, dow } = full
  if (kind === 'ymd') return lang === 'en' ? `${MONTH_EN[m - 1]} ${d}, ${y}` : `${y}/${m}/${d}`
  if (kind === 'mdw') return lang === 'en' ? `${DOW_EN[dow]} ${MONTH_EN[m - 1]} ${d}` : `${m}/${d}（${DOW_JA[dow]}）`
  return lang === 'en' ? `${MONTH_EN[m - 1]} ${d}` : `${m}/${d}`
}

/** 時刻の字「14:02」。minutes は 0 時からの分（24 時を超えたら次の日の時刻） @param {number} minutes */
export function hm(minutes) {
  if (!Number.isFinite(minutes)) return '–'
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** 長さの字。ja「2時間5分」「45分」、en「2h 05m」「45m」 @param {number} minutes @param {Lang} [lang] */
export function duration(minutes, lang = 'ja') {
  if (!Number.isFinite(minutes)) return '–'
  const t = Math.max(0, Math.round(minutes))
  const h = Math.floor(t / 60)
  const m = t % 60
  if (lang === 'en') return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  return h ? `${h}時間${m}分` : `${m}分`
}

// ---------------------------------------------------------------- 目盛り

/**
 * lo から hi の間の切りのよい値（1・2・5 の 10 の冪の倍数）。count は目安の個数。d3-array の ticks と同じ考え方
 * @param {number} lo @param {number} hi @param {number} [count]
 * @returns {number[]}
 */
export function ticks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  if (lo === hi) return [lo]
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const step = tickStep(a, b, count)
  const first = Math.ceil(a / step - 1e-9)
  const last = Math.floor(b / step + 1e-9)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const out = []
  for (let i = first; i <= last && out.length < 1000; i++) out.push(Number((i * step).toFixed(dec)))
  return lo > hi ? out.reverse() : out
}

/**
 * 目盛りの間隔（切りのよい値）
 * @param {number} lo @param {number} hi @param {number} [count]
 */
export function tickStep(lo, hi, count = 5) {
  const raw = Math.abs(hi - lo) / Math.max(1, count)
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const err = raw / pow
  const mult = err >= Math.sqrt(50) ? 10 : err >= Math.sqrt(10) ? 5 : err >= Math.sqrt(2) ? 2 : 1
  return mult * pow
}

/**
 * lo・hi を目盛りの間隔に揃えた範囲。軸の線は引かないが、値の字が切りのよい所に来る
 * @param {number} lo @param {number} hi @param {number} [count]
 * @returns {[number, number]}
 */
export function niceExtent(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (lo === hi) return [lo - 1, hi + 1]
  const step = tickStep(lo, hi, count)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + 1
  return [Number((Math.floor(lo / step + 1e-9) * step).toFixed(dec)), Number((Math.ceil(hi / step - 1e-9) * step).toFixed(dec))]
}

/**
 * 目盛りの値（1・2・5 の倍数）とその字の書き方（目盛りの間隔で桁を決める）
 * @param {number} lo @param {number} hi @param {number} count 目安の個数
 * @returns {{ values: number[], fmt: (v: number) => string }}
 */
export function tickSet(lo, hi, count) {
  const values = ticks(lo, hi, count)
  const digits = stepDigits(values.length > 1 ? values[1] - values[0] : hi - lo)
  return { values, fmt: (v) => num(v, digits) }
}

/*
 * 目盛りの字と棒。軸の線は引かない（look の決まり）。棒は 4pt の短い線（sub・LW.line）で、字は TICK の sub。左は右揃えで縦の中心に、下は中央揃えで棒の 9pt 下に。
 * 選ばなかった案: 束ごとに目盛りを持つ案（time は棒 1pt・字は棒から 4pt、spread は棒 0.75pt・字は 3pt、cost-burn は棒が墨の 42% だった）。並べた頁で、目盛りの濃さと間が形ごとに違って見えた。
 */

/**
 * 左の目盛り: x は図の左の端。棒は x - gap - 4 から x - gap、字は棒の 4pt 左（stub が false なら、字は x - gap - 4 に右揃え）
 * @param {{ ticks: number[], at: (v: number) => number, x: number, pal: Pal, fmt: (v: number) => string, stub?: boolean, gap?: number }} o
 */
export function axisLeft({ ticks: ts, at, x, pal, fmt, stub = true, gap = 0 }) {
  /** @type {string[]} */
  const out = []
  const end = x - gap
  for (const t of ts) {
    const y = at(t)
    if (stub) out.push(line(end - 4, y, end, y, strokeAttr(pal.sub, 1, LW.line)))
    out.push(text(end - (stub ? 8 : 4), midline(y, TICK), fmt(t), { size: TICK, fill: pal.sub, anchor: 'end' }))
  }
  return out.join('')
}

/**
 * 下の目盛り: y は図の下の端。棒は y + 2 から y + 6、字は y + 15 に中央揃え。unit は unitX（既定は right）に右揃えで置き、そこにかかる目盛りと、左右の端を越える目盛りは置かない
 * @param {{ ticks: number[], at: (v: number) => number, y: number, pal: Pal, fmt: (v: number) => string, unit?: string, left: number, right: number, unitX?: number }} o
 */
export function axisBottom({ ticks: ts, at, y, pal, fmt, unit = '', left, right, unitX = right }) {
  const limit = unit && unitX - textWidth(unit, TICK) - 6 < right ? unitX - textWidth(unit, TICK) - 6 : right
  /** @type {string[]} */
  const out = []
  for (const t of ts) {
    const x = at(t)
    const s = fmt(t)
    const half = textWidth(s, TICK) / 2
    if (x - half < left - 4 || x + half > limit + 1) continue
    out.push(line(x, y + 2, x, y + 6, strokeAttr(pal.sub, 1, LW.line)))
    out.push(text(x, y + 15, s, { size: TICK, fill: pal.sub, anchor: 'middle' }))
  }
  if (unit) out.push(text(unitX, y + 15, unit, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return out.join('')
}

// ---------------------------------------------------------------- 形の d

/**
 * 点の列の折れ線の d。close が true なら閉じる（Z）
 * @param {[number, number][]} points @param {boolean} [close]
 */
export function polyline(points, close = false) {
  if (!points.length) return ''
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}${close ? 'Z' : ''}`
}

/**
 * 環（または扇）の 1 片の d。角度は SVG の角度（ラジアン・3 時の向きが 0 で時計回り。12 時から始めるなら -π/2）。隙間 gap（pt）は半径 rGap（既定は r0 と r1 の真ん中）の円周で測り、
 * 片の両端から半分ずつ削る（隣の片と gap だけ空く。donut・polar-area・sunburst が同じ測り方）。a1 - a0 が 1 周なら隙間なしの環。角度が隙間より小さくて残らなければ空の字
 * @param {number} cx @param {number} cy @param {number} r0 @param {number} r1 @param {number} a0 @param {number} a1 @param {number} [gap] @param {number} [rGap]
 */
export function ringPath(cx, cy, r0, r1, a0, a1, gap = 0, rGap = (r0 + r1) / 2) {
  if (!(r1 > r0) || !(a1 > a0)) return ''
  /** @param {number} r @param {number} a */
  const p = (r, a) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const ring = (/** @type {number} */ r, /** @type {0|1} */ sweep) => `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${sweep} ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 ${sweep} ${f(cx + r)} ${f(cy)}Z`
    return `${ring(r1, 1)}${ring(r0, 0)}`
  }
  const d = rGap > 0 ? gap / rGap / 2 : 0
  const s = a0 + d
  const e = a1 - d
  if (!(e - s > 1e-4)) return ''
  const big = e - s > Math.PI ? 1 : 0
  const inner = r0 > 0 ? `L${p(r0, e)}A${f(r0)} ${f(r0)} 0 ${big} 0 ${p(r0, s)}` : `L${f(cx)} ${f(cy)}`
  return `M${p(r1, s)}A${f(r1)} ${f(r1)} 0 ${big} 1 ${p(r1, e)}${inner}Z`
}

/**
 * n 個の札（gauge・progress-rings・tiles）を、1 行 maxCols 個までで並べる時の列と行。行の数を先に決めて、列は行ごとの数が揃う数にする。
 * 選ばなかった案: 列を maxCols まで詰める案。5 つを 4 列に並べると 4 と 1 になり、2 行目の 1 つが離れて見える（3 と 2 にする）。
 * @param {number} n @param {number} maxCols
 * @returns {{ cols: number, rows: number }}
 */
export function gridOf(n, maxCols) {
  const rows = Math.max(1, Math.ceil(n / Math.max(1, Math.trunc(maxCols))))
  return { cols: Math.max(1, Math.ceil(n / rows)), rows }
}

// ---------------------------------------------------------------- 濃さの尺度（量を墨の濃さで見せる形）

/**
 * n 個を、濃い方 hi から薄い方 lo へ等しく並べた墨の割合。n が 1 なら hi だけ。
 * 元の look の donut の 90・65・42・22% は、n = 4（hi 0.9・lo 0.18）の坂とほぼ同じ
 * @param {number} n @param {number} hi @param {number} lo
 */
export function ramp(n, hi, lo) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => (n < 2 ? hi : hi - ((hi - lo) * i) / (n - 1)))
}

/**
 * 量（0〜1 の比）を墨の濃さにする。look の heatmap の「0.06 + 0.79 × 比」を、紙の下限 PRINT.fill から hi（既定 85%・heavy）までの直線にした。heatmap と hexbin が同じ尺度を使う（look の hexbin は heatmap の坂を写した）。
 * 選ばなかった案: 濃さを 5 段の階段にする案。凡例は 5 つの見本だが、升は比のままの濃さの方が 2 つの近い値の差が残る（look も直線）。
 * @param {number} v 0〜1 @param {number} [hi]
 */
export function shade(v, hi = ALPHA.heavy) {
  return PRINT.fill + (hi - PRINT.fill) * Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}

/**
 * 濃さの凡例「少 ▪▪▪▪▪ 多」を、右の端 right に揃えて基線 y に置く。見本は比 0・0.25・0.5・0.75・1 の 5 つで、mark は box（9pt の四角）か hex（半径 5 の六角形）。返すのは svg の字と左の端
 * @param {number} right @param {number} y 基線 @param {Pal} pal @param {Lang} lang @param {{ mark?: 'box'|'hex', hi?: number }} [o]
 * @returns {{ svg: string, left: number }}
 */
export function shadeLegend(right, y, pal, lang, { mark = 'box', hi = ALPHA.heavy } = {}) {
  const steps = [0, 0.25, 0.5, 0.75, 1]
  const more = tr(lang, '多', 'More')
  const less = tr(lang, '少', 'Less')
  const pitch = 11
  const x0 = right - textWidth(more, TICK) - 4 - steps.length * pitch
  const cy = y - TICK * 0.35
  /** @type {string[]} */
  const out = [text(right, y, more, { size: TICK, fill: pal.sub, anchor: 'end' })]
  steps.forEach((v, i) => {
    const cx = x0 + 5 + i * pitch
    const fill = fillAttr(rampColor(pal), shade(v, hi))
    if (mark === 'hex') out.push(fillPath(polyline(Array.from({ length: 6 }, (_, k) => /** @type {[number, number]} */ ([cx + 5 * Math.cos((Math.PI / 3) * k - Math.PI / 2), cy + 5 * Math.sin((Math.PI / 3) * k - Math.PI / 2)])), true), fill))
    else out.push(rect(cx - 4.5, cy - 4.5, 9, 9, fill))
  })
  const left = x0 - 4
  out.push(text(left, y, less, { size: TICK, fill: pal.sub, anchor: 'end' }))
  return { svg: out.join(''), left: left - textWidth(less, TICK) }
}

// ---------------------------------------------------------------- 見本の乱数

/**
 * 種つきの乱数（0〜1）。look の candle と同じ式なので、同じ種なら look の絵と同じ数が出る（種の無い Math の乱数は使わない。同じ入力で同じ絵にするため）
 * @param {number} seed
 */
export function seeded(seed) {
  let s = seed | 0
  return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff
}

// ---------------------------------------------------------------- 資料の色（グラデーション）

/*
 * 資料の紙（vivid）だけが pal.grad（色の止まり 2〜8）と pal.accent2 を持つ。目立たせる 1 つと面に <linearGradient>・<radialGradient> を使い、svg.mjs が読む。
 * 選ばなかった案
 * - 線（stroke）にグラデーションを使う案: svg.mjs の paint は塗りだけ（deck.md の 2 章）。線は単色で、面にだけ使う。
 * - 座標を objectBoundingBox で書く案: 読み手（svg.mjs と欄）の実装差が出やすい。形の座標（pt）をそのまま渡す userSpaceOnUse にする。
 * - 止まりに透明度（stop-opacity）を入れる案: 面の濃さは fill-opacity で持つ。mono と同じ a の段（ALPHA）で、紙の下限（PRINT.fill）まで自動で上がる。
 */

/** 色の止まり（pal.grad）。無い・全部同じ色（mono の資料の ['#111111', '#111111']）なら null。null の紙は単色で描く @param {Pal} pal @returns {string[] | null} */
export function gradStops(pal) {
  const g = pal.grad
  if (!Array.isArray(g) || g.length < 2) return null
  return new Set(g.map((c) => c.toLowerCase())).size > 1 ? g : null
}

/** 2 つ目の強調色（vivid の橙）。無い紙は accent（mono は墨）。字には使わない（白地で 3.6 対 1 しかない） @param {Pal} pal */
export function accent2Of(pal) {
  return pal.accent2 ?? pal.accent
}

/**
 * グラデーションの面の塗りを作る道具。draw のたびに作る（番号は draw の中で数えるので、同じ入力は同じ svg）。
 * 色のある紙は pal.grad の止まりを等間隔に置いたグラデーション・mono と grad の無い紙は hotFill と同じ単色（a は look の濃さ・aMono は mono の濃さ）。
 * 使い方: const g = paints(pal)・g.linear(…) の返す塗りの属性を path・rect の fill に・最後に g.defs() を svg の頭に置く
 * @param {Pal} pal @param {string} [prefix] id の頭（1 つの svg に paints を 2 つ作る時だけ替える）
 */
export function paints(pal, prefix = 'g') {
  const stops = gradStops(pal)
  /** @type {string[]} */
  const defs = []
  let n = 0
  const stopTags = () => (stops ?? []).map((c, i) => `<stop offset="${f(i / Math.max(1, (stops ?? []).length - 1))}" stop-color="${c}"/>`).join('')
  return {
    /** グラデーションを使えるか（false なら単色） */
    on: stops !== null,
    /**
     * 線形。(x1, y1)→(x2, y2) が止まりの 0→1（図の座標 pt）
     * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} [a] @param {number} [aMono]
     */
    linear(x1, y1, x2, y2, a = 1, aMono = monoArea(a)) {
      if (!stops) return hotFill(pal, a, aMono)
      const id = `${prefix}${++n}`
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stopTags()}</linearGradient>`)
      return fillAttr(`url(#${id})`, a)
    },
    /**
     * 放射。中心 (cx, cy)・半径 r で止まりの 0→1
     * @param {number} cx @param {number} cy @param {number} r @param {number} [a] @param {number} [aMono]
     */
    radial(cx, cy, r, a = 1, aMono = monoArea(a)) {
      if (!stops) return hotFill(pal, a, aMono)
      const id = `${prefix}${++n}`
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">${stopTags()}</radialGradient>`)
      return fillAttr(`url(#${id})`, a)
    },
    /** svg の頭に置く <defs>（使わなければ空の字） */
    defs() {
      return defs.length ? `<defs>${defs.join('')}</defs>` : ''
    },
  }
}

// ---------------------------------------------------------------- 字の折り返しと小さな形（資料の形が共通で使う）

/** 行頭に置かない字（行の幅を 8% までなら越えて、前の行の終わりにぶら下げる） */
const NO_LINE_START = new Set(Array.from('、。，．・）」』】〉》〕］｝！？ー,.)]}!?:;%'))

/**
 * 字を幅 maxW（pt）で折り返す。和字は 1 字ずつ・欧字と数字の続きは語のまま（語が幅より長ければ字で割る）。句読点と閉じ括弧は行頭に置かない。
 * maxLines 行に入らなければ最後の行を「…」で切る。空の字・幅が 0 以下なら空の配列
 * 選ばなかった案: 日本語の禁則を全部持つ案（jlreq.mjs）。図の短い注記には、行頭の約物を止めるだけで足りる。
 * @param {unknown} s @param {number} size @param {number} maxW @param {number} [maxLines] @param {boolean} [bold]
 * @returns {string[]}
 */
export function wrap(s, size, maxW, maxLines = 2, bold = false) {
  const str = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (!str || !(maxW > 0)) return []
  const toks = str.match(/[\x21-\x7e]+|\s|[\s\S]/gu) ?? []
  const w = (/** @type {string} */ t) => textWidth(t, size, bold)
  /** @type {string[]} */
  const lines = []
  let cur = ''
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === ' ') {
      if (cur) cur += ' '
      continue
    }
    if (!cur && w(t) > maxW && Array.from(t).length > 1) {
      toks.splice(i, 1, ...Array.from(t))
      i--
      continue
    }
    const next = cur + t
    if (w(next) <= maxW || !cur || (NO_LINE_START.has(t) && w(next) <= maxW * 1.08)) cur = next
    else {
      lines.push(cur.trimEnd())
      cur = t
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  // 最後の行が 1〜2 字だけになる時は、前の行の終わりの字を送って 3 字にする（「いる」だけの行を作らない）。語の途中（欧字の続き）と、行頭に置けない字は動かさない
  const L = lines.length
  if (L > 1) {
    const prev = Array.from(lines[L - 2])
    const last = Array.from(lines[L - 1])
    while (last.length < 3 && prev.length > 4 && !/[!-~ ]/.test(prev[prev.length - 1]) && !NO_LINE_START.has(prev[prev.length - 1])) last.unshift(/** @type {string} */ (prev.pop()))
    let head = prev.join('')
    let tail = last.join('')
    // 前の行が欧字や数の語で終わっていて字を送れない時は、その語ごと送る（「月額 9,800」「円」を「月額」「9,800 円」にする）
    const sp = head.lastIndexOf(' ')
    if (last.length < 3 && sp > 1 && /[!-~]$/.test(head) && w(`${head.slice(sp + 1)} ${tail}`) <= maxW) {
      tail = `${head.slice(sp + 1)} ${tail}`
      head = head.slice(0, sp)
    }
    lines[L - 2] = head
    lines[L - 1] = tail
  }
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), clip(lines.slice(maxLines - 1).join(''), size, maxW, bold)]
}

/**
 * 折り返した字の列を、1 行ずつの <text> にする。y は 1 行目の基線・leading は行送り（pt）
 * @param {number} x @param {number} y @param {string[]} lines @param {{ size?: number, fill?: string, anchor?: 'start'|'middle'|'end', bold?: boolean, leading?: number }} [o]
 */
export function textLines(x, y, lines, { size = TICK, fill = 'currentColor', anchor = 'start', bold = false, leading = size * 1.35 } = {}) {
  return lines.map((s, i) => text(x, y + i * leading, s, { size, fill, anchor, bold })).join('')
}

/**
 * 矢羽根（chevron）の d。左上 (x, y)・幅 w・高さ h。右は尖り、notch（pt）は尖りの深さ。first が true なら左は平ら、でなければ左に同じ深さの切れ込み（前の羽根の尖りが入る）
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} notch @param {boolean} first
 */
export function chevron(x, y, w, h, notch, first) {
  const n = Math.min(notch, w / 2)
  /** @type {[number, number][]} */
  const pts = [[x, y], [x + w - n, y], [x + w, y + h / 2], [x + w - n, y + h], [x, y + h]]
  if (!first) pts.push([x + n, y + h / 2])
  return polyline(pts, true)
}

/**
 * 矢じりの d。先端 (x, y)・向き ang（ラジアン・3 時の向きが 0 で時計回り）・長さ s・幅は長さの 0.9 倍
 * @param {number} x @param {number} y @param {number} ang @param {number} [s]
 */
export function arrowHead(x, y, ang, s = 6) {
  const bx = x - s * Math.cos(ang)
  const by = y - s * Math.sin(ang)
  const nx = -Math.sin(ang) * s * 0.45
  const ny = Math.cos(ang) * s * 0.45
  return polyline([[x, y], [bx + nx, by + ny], [bx - nx, by - ny]], true)
}

// ---------------------------------------------------------------- 資料の形が data を読む小さな道具

/**
 * 字（と有限の数）の字。字は前後の空白を落とし、有限の数は字にし、それ以外（NaN・無限・真偽・物）は ''。nameOf と違い、NaN を「NaN」という名前にしない
 * @param {unknown} v
 */
export function strOf(v) {
  if (typeof v === 'string') return v.trim()
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

/**
 * 名前つきの行（steps・levels・sets）を { name, note } の列にする。名前の無い行は捨てて数を warnings に書き、max を超えた分も捨てて書く。
 * min 個に満たなければ warnings に書いて空の配列（形は「データがありません」を描く）。行が字だけなら、その字が名前
 * @param {unknown} list @param {string} what 「段階」のような名前 @param {string} key data の欄の名前（warnings に出す） @param {string[]} warnings
 * @param {{ min?: number, max?: number }} [o]
 * @returns {{ name: string, note: string }[]}
 */
export function readNamed(list, what, key, warnings, { min = 1, max = 8 } = {}) {
  if (!Array.isArray(list)) {
    warnings.push(`${what}: ${key}（{ name, note? } の列）がありません`)
    return []
  }
  /** @type {{ name: string, note: string }[]} */
  const rows = []
  let bad = 0
  for (const it of list) {
    const obj = it && typeof it === 'object' && !Array.isArray(it)
    const name = strOf(obj ? /** @type {any} */ (it).name : it)
    if (!name) { bad++; continue }
    rows.push({ name, note: obj ? strOf(/** @type {any} */ (it).note) : '' })
  }
  if (bad) warnings.push(`${what}: 名前の読めない行 ${bad} 個を捨てました`)
  const kept = keep(rows, max, warnings, `${what}: ${key}`)
  if (kept.length < min) {
    warnings.push(`${what}: ${key} は ${min} 個以上要ります`)
    return []
  }
  return kept
}

/**
 * 目立たせる 1 つの位置。want は名前（字）か 0 から数える位置（数）。読めなければ fallback（-1 なら目立たせない）。名前が見つからなければ warnings に書く
 * @param {unknown} want @param {string[]} names @param {number} fallback @param {string[]} warnings @param {string} what
 */
export function hotIndex(want, names, fallback, warnings, what) {
  if (typeof want === 'number' && Number.isInteger(want)) {
    if (want >= 0 && want < names.length) return want
    warnings.push(`${what}: highlight ${want} は 0 〜 ${names.length - 1} の位置でないので使いません`)
    return fallback
  }
  const s = strOf(want)
  if (!s) return fallback
  const i = names.indexOf(s)
  if (i < 0) warnings.push(`${what}: highlight「${s}」の名前がありません`)
  return i < 0 ? fallback : i
}
