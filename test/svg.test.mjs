// SVG → Op の試験。metrics は作り物（和字 1em・ASCII 0.55em・ascent 0.88・descent -0.12）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { svgToOps, parseFontShorthand } from '../hooks/engine/svg.mjs'

const font = { upm: 1000, ascent: 0.88, descent: -0.12, adv: (cp) => (cp > 0x2e7f ? 1 : 0.55), has: () => true, run: () => ({ width: 0, xs: [] }) }
const metrics = { sans: font, sansBold: font, mincho: font, minchoBold: font }
const BOX = { x: 0, y: 0, width: 100, height: 100, metrics }

const NS = 'xmlns="http://www.w3.org/2000/svg"'
/** viewBox 0 0 100 100 を 100×100 の四角へ（恒等）で読む。はみ出す座標を使う試験のため、ClipOp で包む判定は既定で切る */
const run = (body, attrs = 'viewBox="0 0 100 100"', opts = {}) => svgToOps(`<svg ${NS} ${attrs}>${body}</svg>`, { ...BOX, clip: false, ...opts })
const flat = (ops) => ops.flatMap((o) => (o.t === 'clip' ? [o, ...flat(o.ops)] : [o]))
const near = (a, b, eps = 0.01, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} と ${b} が ${eps} 以内でない`)

/** d を、命令の字は完全一致・数は eps 以内で比べる */
function assertD(actual, expected, eps = 0.01) {
  const a = actual.split(/\s+/)
  const e = expected.split(/\s+/)
  assert.equal(a.length, e.length, `${actual} と ${expected} の長さが違う`)
  a.forEach((tok, i) => {
    if (/^[A-Z]$/.test(e[i])) assert.equal(tok, e[i], `${i} 番目: ${actual}`)
    else near(Number(tok), Number(e[i]), eps, `${i} 番目 (${actual})`)
  })
}
/** d を { c, n } の列に */
const segs = (d) => d.trim().split(/\s+(?=[MLCZ])/).map((s) => { const t = s.split(/\s+/); return { c: t[0], n: t.slice(1).map(Number) } })
const dOf = (body, attrs, opts) => run(`<path d="${body}" stroke="black"/>`, attrs, opts).ops[0].d

// ---- path の d

test('相対の l・h・v と絶対の H・V・L・z が、絶対の M L Z だけになる', () => {
  assertD(dOf('M10 20 l5 5 h10 v-5 H100 V0 z'), 'M 10 20 L 15 25 L 25 25 L 25 20 L 100 20 L 100 0 Z')
})

test('最初の m は絶対で、M や m の後ろの対は L や l になる', () => {
  assertD(dOf('m10 10 l5 5'), 'M 10 10 L 15 15')
  assertD(dOf('M0 0 10 10 20 0'), 'M 0 0 L 10 10 L 20 0')
  assertD(dOf('m0 0 10 10 10 -10'), 'M 0 0 L 10 10 L 20 0')
})

test('数の区切りが無い書き方（符号・小数点・指数）を読む', () => {
  assertD(dOf('M1.5.5L.5.5L1e1 2E1'), 'M 1.5 0.5 L 0.5 0.5 L 10 20')
  assertD(dOf('M-1.5-2.5L3-4'), 'M -1.5 -2.5 L 3 -4')
})

test('C と c と S と s が C になり、S の最初の制御点は前の制御点の反射になる', () => {
  assertD(dOf('M0 0 C10 0 10 10 20 10 S30 20 40 20'), 'M 0 0 C 10 0 10 10 20 10 C 30 10 30 20 40 20')
  assertD(dOf('M0 0 c10 0 10 10 20 10 s10 10 20 10'), 'M 0 0 C 10 0 10 10 20 10 C 30 10 30 20 40 20')
})

test('C の後でない S の最初の制御点は現在の点になる', () => {
  assertD(dOf('M0 0 S5 5 10 0'), 'M 0 0 C 0 0 5 5 10 0')
})

test('Q が 2/3 の位置の制御点を持つ C になる', () => {
  assertD(dOf('M0 0 Q10 0 10 10'), 'M 0 0 C 6.667 0 10 3.333 10 10')
  assertD(dOf('M0 0 q10 0 10 10'), 'M 0 0 C 6.667 0 10 3.333 10 10')
})

test('T が前の Q の制御点を反射した C になり、Q の後でなければ直線に近い C になる', () => {
  // 前の Q の制御点 (10,0) を終点 (10,10) で反射すると (10,20)
  assertD(dOf('M0 0 Q10 0 10 10 T20 20'), 'M 0 0 C 6.667 0 10 3.333 10 10 C 10 16.667 13.333 20 20 20')
  assertD(dOf('M0 0 Q10 0 10 10 t10 10'), 'M 0 0 C 6.667 0 10 3.333 10 10 C 10 16.667 13.333 20 20 20')
  assertD(dOf('M0 0 T30 0'), 'M 0 0 C 0 0 10 0 30 0')
})

test('A の半円が 90 度ずつの 2 本の C になり、通る点と終点が合う', () => {
  const s = segs(dOf('M0 0 A10 10 0 0 1 20 0'))
  assert.deepEqual(s.map((x) => x.c), ['M', 'C', 'C'])
  // 制御点は半径の 0.5523 倍
  near(s[1].n[0], 0, 0.01); near(s[1].n[1], -5.523, 0.01)
  near(s[1].n[4], 10); near(s[1].n[5], -10)
  near(s[2].n[4], 20); near(s[2].n[5], 0)
})

test('A の大きい弧（large-arc=1）は 270 度で、3 本の C の終点が手計算と合う', () => {
  const s = segs(dOf('M0 0 A10 10 0 1 1 10 10'))
  assert.deepEqual(s.map((x) => x.c), ['M', 'C', 'C', 'C'])
  const ends = s.slice(1).map((x) => [x.n[4], x.n[5]])
  near(ends[0][0], 10); near(ends[0][1], -10)
  near(ends[1][0], 20); near(ends[1][1], 0)
  near(ends[2][0], 10); near(ends[2][1], 10)
})

test('A の sweep が逆だと反対側を回る', () => {
  const s = segs(dOf('M0 0 A10 10 0 0 0 20 0'))
  near(s[1].n[4], 10); near(s[1].n[5], 10)
  near(s[2].n[4], 20); near(s[2].n[5], 0)
})

test('A の半径が小さすぎる時は、端点を結ぶ半円まで広げる', () => {
  const s = segs(dOf('M0 0 A1 1 0 0 1 10 0'))
  near(s[1].n[4], 5); near(s[1].n[5], -5)
  near(s[2].n[4], 10); near(s[2].n[5], 0)
})

test('A の旗は次の数と詰めて書ける（a5 5 0 0110 0 は a5 5 0 0 1 10 0）', () => {
  assertD(dOf('M10 10a5 5 0 0110 0'), dOf('M10 10a5 5 0 0 1 10 0'))
})

test('A の半径が 0 なら直線になり、始点と終点が同じなら何も足さない', () => {
  assertD(dOf('M0 0 A0 5 0 0 1 10 10'), 'M 0 0 L 10 10')
  assertD(dOf('M5 5 L6 6 A5 5 0 0 1 6 6'), 'M 5 5 L 6 6')
})

test('Z の後に M なしで続く線は、始点からの M を足して始める', () => {
  assertD(dOf('M10 10 L20 10 L20 20 Z L30 30'), 'M 10 10 L 20 10 L 20 20 Z M 10 10 L 30 30')
})

test('d の途中で読めなくなったら、そこまでを描いて警告する', () => {
  const r = run('<path d="M10 10 L20 20 L x" stroke="black"/>')
  assertD(r.ops[0].d, 'M 10 10 L 20 20')
  assert.ok(r.warnings.some((w) => w.includes('path の d')))
})

test('M で始まらない d や無限大の座標は描かない', () => {
  assert.equal(run('<path d="L10 10" stroke="black"/>').ops.length, 0)
  assert.equal(run('<path d="M0 0 L1e999 5" stroke="black"/>').ops.length, 0)
})

// ---- transform

test('translate と scale が点に効く', () => {
  assertD(run('<g transform="translate(10 20)"><path d="M1 2 L3 4" stroke="black"/></g>').ops[0].d, 'M 11 22 L 13 24')
  assertD(run('<g transform="scale(2 3)"><path d="M1 2 L3 4" stroke="black"/></g>').ops[0].d, 'M 2 6 L 6 12')
  assertD(run('<g transform="scale(2)"><path d="M1 2" stroke="black"/><path d="M1 2 L3 4" stroke="black"/></g>').ops[0].d, 'M 2 4 L 6 8')
})

test('rotate は 90 度で (1,0) を (0,1) に写し、中心つきなら中心のまわりを回る', () => {
  assertD(run('<path transform="rotate(90)" d="M1 0 L0 1" stroke="black"/>').ops[0].d, 'M 0 1 L -1 0')
  assertD(run('<path transform="rotate(90 10 10)" d="M20 10 L10 20" stroke="black"/>').ops[0].d, 'M 10 20 L 0 10')
})

test('translate・rotate・scale の積は左から右へ（点には右の物が先に掛かる）', () => {
  // (1,1) → scale(2) で (2,2) → rotate(90) で (-2,2) → translate(10,0) で (8,2)
  assertD(run('<path transform="translate(10,0) rotate(90) scale(2)" d="M1 1 L1 1 L2 2" stroke="black"/>').ops[0].d, 'M 8 2 L 8 2 L 6 4')
})

test('入れ子の g の変換は外が後から掛かる', () => {
  assertD(run('<g transform="translate(5 5)"><g transform="scale(2)"><path d="M1 1 L2 2" stroke="black"/></g></g>').ops[0].d, 'M 7 7 L 9 9')
})

test('matrix・skewX・skewY', () => {
  assertD(run('<path transform="matrix(2 0 0 3 5 6)" d="M1 1 L2 2" stroke="black"/>').ops[0].d, 'M 7 9 L 9 12')
  assertD(run('<path transform="skewX(45)" d="M0 1 L0 2" stroke="black"/>').ops[0].d, 'M 1 1 L 2 2')
  assertD(run('<path transform="skewY(45)" d="M1 0 L2 0" stroke="black"/>').ops[0].d, 'M 1 1 L 2 2')
})

test('線の太さと破線は行列の sqrt(|det|) 倍になる', () => {
  const op = run('<path transform="scale(2 8)" d="M0 0 L10 0" stroke="black" stroke-width="1" stroke-dasharray="2 1"/>').ops[0]
  near(op.lw, 4)
  assert.deepEqual(op.dash, [8, 4])
})

test('読めない transform は無いものとして描き、警告する', () => {
  const r = run('<path transform="foo(1)" d="M1 1 L2 2" stroke="black"/>')
  assertD(r.ops[0].d, 'M 1 1 L 2 2')
  assert.ok(r.warnings.some((w) => w.includes('transform')))
})

// ---- viewBox

test('横長の viewBox は縦に中央寄せで meet に写る', () => {
  const r = svgToOps(`<svg ${NS} viewBox="0 0 100 50"><path d="M0 0 L100 50" stroke="black"/></svg>`, { ...BOX, x: 10, y: 20, width: 200, height: 200 })
  assertD(r.ops[0].d, 'M 10 70 L 210 170')
})

test('縦長の viewBox は横に中央寄せで meet に写る', () => {
  const r = svgToOps(`<svg ${NS} viewBox="0 0 50 100"><path d="M0 0 L50 100" stroke="black"/></svg>`, { ...BOX, x: 0, y: 0, width: 200, height: 100 })
  assertD(r.ops[0].d, 'M 75 0 L 125 100')
})

test('viewBox の左上が原点でなくても、四角の左上に写る', () => {
  const r = svgToOps(`<svg ${NS} viewBox="10 10 100 100"><path d="M10 10 L110 110" stroke="black"/></svg>`, { ...BOX, width: 200, height: 200 })
  assertD(r.ops[0].d, 'M 0 0 L 200 200')
})

test('viewBox が無ければ width と height（単位つき）から写す', () => {
  const r = svgToOps(`<svg ${NS} width="50" height="25"><path d="M0 0 L50 25" stroke="black"/></svg>`, BOX)
  assertD(r.ops[0].d, 'M 0 25 L 100 75')
  const mm = svgToOps(`<svg ${NS} width="25.4mm" height="25.4mm"><path d="M0 0 L96 96" stroke="black"/></svg>`, BOX)
  assertD(mm.ops[0].d, 'M 0 0 L 100 100')
})

test('入れ子の svg は位置と viewBox を写し、はみ出しは四角で切る', () => {
  const r = run('<svg x="10" y="10" width="50" height="50" viewBox="0 0 10 10"><path d="M0 0 L10 10" stroke="black"/></svg>')
  assert.equal(r.ops.length, 1)
  const clip = r.ops[0]
  assert.equal(clip.t, 'clip')
  assert.deepEqual([clip.x, clip.y, clip.w, clip.h], [10, 10, 50, 50])
  assertD(clip.ops[0].d, 'M 10 10 L 60 60')
})

// ---- 図形

test('rect は M L L L Z の四角になる', () => {
  assertD(run('<rect x="10" y="20" width="30" height="30" fill="red"/>').ops[0].d, 'M 10 20 L 40 20 L 40 50 L 10 50 Z')
})

test('rect の円い角丸（rx のみ・rx = ry）は RectOp の r になり、ry が違う楕円の角は 4 つの C の path になる', () => {
  const rect = run('<rect x="10" y="20" width="30" height="30" rx="5" fill="red"/>').ops
  assert.deepEqual(rect, [{ t: 'rect', x: 10, y: 20, w: 30, h: 30, r: 5, fill: '#FF0000' }])
  assert.equal(run('<rect x="10" y="20" width="30" height="30" rx="5" ry="5" fill="red"/>').ops[0].r, 5)
  const d = run('<rect x="10" y="20" width="30" height="30" rx="5" ry="10" fill="red"/>').ops[0].d
  assert.deepEqual(segs(d).map((s) => s.c), ['M', 'L', 'C', 'L', 'C', 'L', 'C', 'L', 'C', 'Z'])
  const s = segs(d)
  assert.deepEqual(s[0].n, [15, 20])
  assert.deepEqual(s[1].n, [35, 20])
  assert.deepEqual(s[2].n.slice(4), [40, 30])
  near(s[2].n[0], 35 + 0.5523 * 5)
})

test('角丸の半径は辺の半分までに収める', () => {
  const s = segs(run('<rect x="0" y="0" width="30" height="20" rx="100" fill="red"/>').ops[0].d)
  assert.deepEqual(s[0].n, [15, 0])
  assert.deepEqual(s[2].n.slice(4), [30, 10])
})

test('幅か高さが 0 以下の rect は描かない', () => {
  assert.equal(run('<rect width="0" height="10" fill="red"/><rect width="10" height="-1" fill="red"/>').ops.length, 0)
})

test('circle は 4 本の C で、4 つの極の点を通る', () => {
  const s = segs(run('<circle cx="50" cy="50" r="10" fill="red"/>').ops[0].d)
  assert.deepEqual(s.map((x) => x.c), ['M', 'C', 'C', 'C', 'C', 'Z'])
  assert.deepEqual(s[0].n, [60, 50])
  assert.deepEqual(s.slice(1, 5).map((x) => x.n.slice(4)), [[50, 60], [40, 50], [50, 40], [60, 50]])
  near(s[1].n[1], 55.523)
})

test('ellipse は rx と ry の別々の半径で 4 本の C になる', () => {
  const s = segs(run('<ellipse cx="50" cy="50" rx="20" ry="10" fill="red"/>').ops[0].d)
  assert.deepEqual(s[0].n, [70, 50])
  assert.deepEqual(s.slice(1, 5).map((x) => x.n.slice(4)), [[50, 60], [30, 50], [50, 40], [70, 50]])
})

test('polyline は閉じず、polygon は閉じる', () => {
  assertD(run('<polyline points="0,0 10,10 20,0" fill="none" stroke="black"/>').ops[0].d, 'M 0 0 L 10 10 L 20 0')
  assertD(run('<polygon points="0 0 10 10 20 0" fill="black"/>').ops[0].d, 'M 0 0 L 10 10 L 20 0 Z')
})

test('line は線だけを描き、fill を指定しても塗らない', () => {
  const r = run('<line x1="0" y1="0" x2="10" y2="10" stroke="red" fill="blue"/>')
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].fill, undefined)
  assert.equal(r.ops[0].stroke, '#FF0000')
})

// ---- 色と描き方

test('色: #rgb #rrggbb #rrggbbaa rgb() rgba() hsl() 名前 none transparent', () => {
  const fill = (v) => run(`<rect width="10" height="10" fill="${v}"/>`).ops[0]?.fill
  assert.equal(fill('#abc'), '#AABBCC')
  assert.equal(fill('#a1b2c3'), '#A1B2C3')
  assert.equal(fill('rgb(255, 0, 0)'), '#FF0000')
  assert.equal(fill('rgb(100%,0%,50%)'), '#FF0080')
  assert.equal(fill('rgba(0,0,255,0.5)'), '#0000FF')
  assert.equal(fill('hsl(120, 100%, 50%)'), '#00FF00')
  assert.equal(fill('Red'), '#FF0000')
  assert.equal(fill('gray'), '#808080')
  assert.equal(fill('grey'), '#808080')
  assert.equal(fill('white'), '#FFFFFF')
  assert.equal(fill('none'), undefined)
  assert.equal(fill('transparent'), undefined)
  const withA = run('<rect width="10" height="10" fill="#ff000080"/>').ops[0]
  near(withA.opacity, 0.502, 0.001)
})

test('rgba の a は opacity になり、fill-opacity と掛け合わさる', () => {
  assert.equal(run('<rect width="10" height="10" fill="rgba(0,0,255,0.5)"/>').ops[0].opacity, 0.5)
  assert.equal(run('<rect width="10" height="10" fill="rgba(0,0,0,0.5)" fill-opacity="0.5"/>').ops[0].opacity, 0.25)
})

test('fill の既定は黒で、stroke の既定は無し', () => {
  const op = run('<rect width="10" height="10"/>').ops[0]
  assert.equal(op.fill, '#000000')
  assert.equal(op.stroke, undefined)
})

test('currentColor は color オプションの色になり、要素の color 属性が勝つ', () => {
  assert.equal(run('<rect width="10" height="10" fill="currentColor"/>', undefined, { color: '#336699' }).ops[0].fill, '#336699')
  assert.equal(run('<g color="#112233"><rect width="10" height="10" fill="currentColor"/></g>', undefined, { color: '#336699' }).ops[0].fill, '#112233')
})

test('親の fill と stroke を子が継ぎ、子の指定が勝つ', () => {
  const r = run('<g fill="#00f" stroke="#f00" stroke-width="3"><rect width="10" height="10"/><rect width="10" height="10" fill="#0f0"/></g>')
  assert.equal(r.ops[0].fill, '#0000FF')
  assert.equal(r.ops[0].stroke, '#FF0000')
  assert.equal(r.ops[0].lw, 3)
  assert.equal(r.ops[1].fill, '#00FF00')
})

test('style 属性の中の指定は同じ名前の属性より優先される', () => {
  const op = run('<rect width="10" height="10" fill="red" style="fill:#00f; stroke : green; stroke-width:2"/>').ops[0]
  assert.equal(op.fill, '#0000FF')
  assert.equal(op.stroke, '#008000')
  assert.equal(op.lw, 2)
})

test('読めない色は無いものとして親の値を残す', () => {
  assert.equal(run('<g fill="red"><rect width="10" height="10" fill="bogus"/></g>').ops[0].fill, '#FF0000')
})

test('fill と stroke の透明度が違う時は、塗りだけの Op と線だけの Op の 2 つに分ける', () => {
  const r = run('<rect width="10" height="10" fill="red" stroke="blue" stroke-width="2" fill-opacity="0.5" stroke-opacity="0.25"/>')
  assert.equal(r.ops.length, 2)
  assert.deepEqual([r.ops[0].fill, r.ops[0].stroke, r.ops[0].opacity], ['#FF0000', undefined, 0.5])
  assert.deepEqual([r.ops[1].fill, r.ops[1].stroke, r.ops[1].opacity, r.ops[1].lw], [undefined, '#0000FF', 0.25, 2])
})

test('fill と stroke の透明度が同じなら 1 つの Op にまとめる', () => {
  const r = run('<rect width="10" height="10" fill="red" stroke="blue" opacity="0.5"/>')
  assert.equal(r.ops.length, 1)
  assert.deepEqual([r.ops[0].fill, r.ops[0].stroke, r.ops[0].opacity], ['#FF0000', '#0000FF', 0.5])
})

test('グループの opacity は子の opacity に掛かる', () => {
  assert.equal(run('<g opacity="0.5"><rect width="10" height="10" opacity="0.5"/></g>').ops[0].opacity, 0.25)
})

test('透明度 0 の塗りは出さず、太さ 0 の線も出さない', () => {
  const a = run('<rect width="10" height="10" fill="red" fill-opacity="0" stroke="blue"/>')
  assert.equal(a.ops.length, 1)
  assert.equal(a.ops[0].fill, undefined)
  const b = run('<rect width="10" height="10" fill="red" stroke="blue" stroke-width="0"/>')
  assert.equal(b.ops.length, 1)
  assert.equal(b.ops[0].stroke, undefined)
})

test('stroke-linecap・linejoin・fill-rule・dasharray を Op に写し、既定の値は省く', () => {
  const op = run('<path d="M0 0 L10 10 L0 10 Z" fill="red" stroke="black" stroke-linecap="round" stroke-linejoin="bevel" fill-rule="evenodd" stroke-dasharray="4,2,1"/>').ops[0]
  assert.equal(op.cap, 'round')
  assert.equal(op.join, 'bevel')
  assert.equal(op.fillRule, 'evenodd')
  assert.deepEqual(op.dash, [4, 2, 1, 4, 2, 1])
  const plain = run('<path d="M0 0 L10 10" stroke="black" stroke-linecap="butt" stroke-linejoin="miter" stroke-dasharray="none"/>').ops[0]
  for (const k of ['cap', 'join', 'dash', 'fillRule', 'opacity']) assert.equal(plain[k], undefined, k)
})

test('display:none と visibility:hidden の要素は描かず、子で visible に戻せる', () => {
  const r = run('<rect width="10" height="10" display="none"/><g visibility="hidden"><rect width="10" height="10"/><rect width="20" height="20" visibility="visible"/></g><g style="display:none"><rect width="5" height="5"/></g>')
  assert.equal(r.ops.length, 1)
  assert.match(r.ops[0].d, /20/)
})

// ---- clipPath

test('clip-path="url(#id)" が、rect の clipPath の四角を ClipOp にする', () => {
  const r = run('<defs><clipPath id="c"><rect x="10" y="20" width="30" height="40"/></clipPath></defs><g clip-path="url(#c)"><rect width="100" height="100" fill="red"/></g>')
  assert.equal(r.ops.length, 1)
  assert.deepEqual([r.ops[0].t, r.ops[0].x, r.ops[0].y, r.ops[0].w, r.ops[0].h], ['clip', 10, 20, 30, 40])
  assert.equal(r.ops[0].ops.length, 1)
})

test('clipPath の四角は参照した要素の transform と viewBox の写しを受ける', () => {
  const r = svgToOps(`<svg ${NS} viewBox="0 0 50 50"><defs><clipPath id="c"><rect x="10" y="20" width="30" height="40"/></clipPath></defs><g transform="translate(5 5)" clip-path="url(#c)"><rect width="10" height="10" fill="red"/></g></svg>`, BOX)
  // (10+5, 20+5) を 2 倍にして (30, 50)、大きさは 60×80
  assert.deepEqual([r.ops[0].x, r.ops[0].y, r.ops[0].w, r.ops[0].h], [30, 50, 60, 80])
})

test('ECharts のように clipPath の中が四角の path でも、その四角で切る', () => {
  const r = run('<g clip-path="url(#z)"><path d="M10 10L90 10" stroke="black"/></g><defs><clipPath id="z"><path d="M59 64l30 0l0 20l-30 0Z"/></clipPath></defs>')
  assert.deepEqual([r.ops[0].x, r.ops[0].y, r.ops[0].w, r.ops[0].h], [59, 64, 30, 20])
  assert.equal(r.warnings.length, 0)
})

test('clipPath が見つからない、外への参照なら、切らずに描いて警告する', () => {
  const missing = run('<g clip-path="url(#nope)"><rect width="10" height="10"/></g>')
  assert.equal(missing.ops.length, 1)
  assert.equal(missing.ops[0].t, 'path')
  assert.ok(missing.warnings.some((w) => w.includes('clip')))
  const ext = run('<g clip-path="url(http://example.com/a.svg#c)"><rect width="10" height="10"/></g>')
  assert.equal(ext.ops[0].t, 'path')
  assert.ok(ext.warnings.length > 0)
})

test('大きさ 0 の clipPath は何も描かない', () => {
  const r = run('<defs><clipPath id="c"><rect width="0" height="10"/></clipPath></defs><g clip-path="url(#c)"><rect width="10" height="10"/></g>')
  assert.equal(r.ops.length, 0)
})

// ---- text

const glyphXs = (op) => op.glyphs.map((g) => g.x)
const textOf = (op) => op.glyphs.map((g) => g.c).join('')
const texts = (r) => flat(r.ops).filter((o) => o.t === 'text')

test('text-anchor start は x から並ぶ（幅は adv の和）', () => {
  const op = texts(run('<text x="50" y="30" font-size="10">ABCD</text>'))[0]
  assert.equal(op.font, 'sans')
  assert.equal(op.size, 10)
  assert.equal(op.color, '#000000')
  assert.equal(op.y, 30)
  assert.deepEqual(glyphXs(op), [50, 55.5, 61, 66.5])
})

test('text-anchor middle は幅の半分だけ、end は幅だけ左に寄る', () => {
  // 幅は 4 × 0.55 × 10 = 22
  assert.deepEqual(glyphXs(texts(run('<text x="50" y="30" font-size="10" text-anchor="middle">ABCD</text>'))[0]), [39, 44.5, 50, 55.5])
  assert.deepEqual(glyphXs(texts(run('<text x="50" y="30" font-size="10" text-anchor="end">ABCD</text>'))[0]), [28, 33.5, 39, 44.5])
  assert.deepEqual(glyphXs(texts(run('<text x="50" y="30" font-size="10" text-anchor="middle">日本</text>'))[0]), [40, 50])
})

test('text-anchor は親の g から継ぎ、style 属性でも指定できる', () => {
  assert.deepEqual(glyphXs(texts(run('<g text-anchor="end"><text x="50" y="30" font-size="10">AB</text></g>'))[0]), [39, 44.5])
  assert.deepEqual(glyphXs(texts(run('<text x="50" y="30" style="font-size:10px;text-anchor:end">AB</text>'))[0]), [39, 44.5])
})

test('font-weight が bold か 600 以上なら sansBold、それ未満なら sans', () => {
  const font_ = (w) => texts(run(`<text x="0" y="10" font-size="10" font-weight="${w}">A</text>`))[0].font
  assert.equal(font_('bold'), 'sansBold')
  assert.equal(font_('700'), 'sansBold')
  assert.equal(font_('600'), 'sansBold')
  assert.equal(font_('500'), 'sans')
  assert.equal(font_('normal'), 'sans')
})

test('dominant-baseline: central と middle は (ascent+descent)/2 × size だけ下げ、hanging は ascent だけ下げる', () => {
  const y = (b) => texts(run(`<text x="0" y="30" font-size="10" dominant-baseline="${b}">A</text>`))[0].y
  near(y('central'), 33.8)
  near(y('middle'), 33.8)
  near(y('hanging'), 38.8)
  near(y('alphabetic'), 30)
})

test('字の大きさと位置に viewBox の縮尺が掛かる', () => {
  const r = svgToOps(`<svg ${NS} viewBox="0 0 50 50"><text x="10" y="20" font-size="5">AB</text></svg>`, BOX)
  const op = texts(r)[0]
  assert.equal(op.size, 10)
  assert.equal(op.y, 40)
  assert.deepEqual(glyphXs(op), [20, 25.5])
})

test('7pt 未満の字は 7pt に上げ、並びも 7pt の幅で組み、警告する', () => {
  const r = run('<text x="0" y="10" font-size="5">AB</text>')
  const op = texts(r)[0]
  assert.equal(op.size, 7)
  near(op.glyphs[1].x, 3.85)
  assert.ok(r.warnings.some((w) => w.includes('7pt')))
  assert.equal(run('<text x="0" y="10" font-size="7">AB</text>').warnings.length, 0)
})

test('tspan の dy は以降の字の基線を動かし、色の違う字は別の TextOp になる', () => {
  const r = run('<text x="10" y="20" font-size="10">AB<tspan dy="-5" fill="red">C</tspan>D</text>')
  const ops = texts(r)
  assert.deepEqual(ops.map(textOf), ['AB', 'C', 'D'])
  assert.deepEqual(ops.map((o) => o.y), [20, 15, 15])
  assert.deepEqual(ops.map((o) => o.color), ['#000000', '#FF0000', '#000000'])
  assert.deepEqual([glyphXs(ops[0]), glyphXs(ops[1]), glyphXs(ops[2])], [[10, 15.5], [21], [26.5]])
})

test('tspan の x は新しい位置から並べ直し、同じ見た目の tspan は 1 つの TextOp にまとまる', () => {
  const a = texts(run('<text y="20" font-size="10">A<tspan x="50">B</tspan></text>'))
  assert.deepEqual(a.map(textOf), ['A', 'B'])
  assert.deepEqual([glyphXs(a[0]), glyphXs(a[1])], [[0], [50]])
  const b = texts(run('<text x="50" y="20" font-size="10" text-anchor="middle">A<tspan>B</tspan></text>'))
  assert.deepEqual(b.map(textOf), ['AB'])
  assert.deepEqual(glyphXs(b[0]), [44.5, 50])
})

test('text の dx は字の位置をずらし、x の列は字ごとの位置になる', () => {
  assert.deepEqual(glyphXs(texts(run('<text x="10" dx="5" y="20" font-size="10">AB</text>'))[0]), [15, 20.5])
  const per = texts(run('<text x="10 30" y="20" font-size="10">AB</text>'))
  assert.deepEqual(per.map(textOf), ['A', 'B'])
  assert.deepEqual([glyphXs(per[0]), glyphXs(per[1])], [[10], [30]])
})

test('字の中の空白は詰め、前後の空白と改行は捨てる（xml:space="preserve" なら残す）', () => {
  assert.equal(textOf(texts(run('<text x="0" y="10" font-size="10">  A \n   B  </text>'))[0]), 'A B')
  assert.equal(textOf(texts(run('<text x="0" y="10" font-size="10" xml:space="preserve">A  B</text>'))[0]), 'A  B')
})

test('実体参照（名前・10 進・16 進）を展開し、知らない名前はそのまま残す', () => {
  assert.equal(textOf(texts(run('<text x="0" y="10" font-size="10">A&amp;B &lt;&#x41;&#66;&gt; &quot;&apos;</text>'))[0]), `A&B <AB> "'`)
  assert.equal(textOf(texts(run('<text x="0" y="10" font-size="10">&foo;</text>'))[0]), '&foo;')
  assert.equal(run('<rect width="10" height="10" fill="&#35;ff0000"/>').ops[0].fill, '#FF0000')
})

test('CDATA はそのまま字になり、コメントと処理命令と DOCTYPE は読み飛ばす', () => {
  const svg = String.fromCodePoint(0xfeff) + `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [ <!ENTITY x "y>z"> ]><!-- c --><svg ${NS} viewBox="0 0 100 100"><text x="0" y="10" font-size="10"><![CDATA[a<b]]><!-- 無視 --></text></svg>`
  const r = svgToOps(svg, BOX)
  assert.equal(textOf(texts(r)[0]), 'a<b')
  assert.equal(r.warnings.length, 0)
})

test('fill が none の字は描かず、半透明の字は紙の色に混ぜた色になる', () => {
  assert.equal(texts(run('<text x="0" y="10" font-size="10" fill="none">A</text>')).length, 0)
  assert.equal(texts(run('<text x="0" y="10" font-size="10" fill-opacity="0.5">A</text>'))[0].color, '#808080')
  assert.equal(texts(run('<text x="0" y="10" font-size="10" fill="#fff" opacity="0.5">A</text>'), undefined)[0].color, '#FFFFFF')
  assert.equal(texts(run('<text x="0" y="10" font-size="10" fill="#000" opacity="0.5">A</text>', undefined, { paper: '#FFFFFF' }))[0].color, '#808080')
})

test('回った行列の字は向きを無視して横に並べ、警告を 1 度だけ書く', () => {
  const r = run('<text transform="rotate(90 50 50)" x="50" y="50" font-size="10">AB</text><text transform="rotate(45)" x="0" y="0" font-size="10">C</text>')
  const ops = texts(r)
  assert.equal(ops.length, 2)
  assert.equal(r.warnings.filter((w) => w.includes('回転')).length, 1)
  near(ops[0].glyphs[1].x - ops[0].glyphs[0].x, 5.5)
})

test('書体に無い字（adv が NaN）は警告し、見積もりの幅で並べる', () => {
  const holey = { ...font, adv: (cp) => (cp === 0x9f98 ? NaN : 1) }
  const r = svgToOps(`<svg ${NS} viewBox="0 0 100 100"><text x="0" y="10" font-size="10">A龘B</text></svg>`, { ...BOX, metrics: { sans: holey, sansBold: holey } })
  assert.ok(r.warnings.some((w) => w.includes('龘')))
  assert.deepEqual(glyphXs(texts(r)[0]), [0, 10, 20])
})

test('metrics が無くても字は見積もりの幅で描く', () => {
  const op = texts(svgToOps(`<svg ${NS} viewBox="0 0 100 100"><text x="0" y="10" font-size="10">A日</text></svg>`, { x: 0, y: 0, width: 100, height: 100 }))[0]
  assert.deepEqual(glyphXs(op), [0, 5.5])
})

// ---- 読まない物

test('script・foreignObject・image は描かず、警告は 1 種類につき 1 度', () => {
  const r = run(
    '<script>alert(1)</script><foreignObject width="10" height="10"><div>x</div></foreignObject>' +
      '<image href="http://example.com/a.png" width="10" height="10"/><image href="data:image/png;base64,AAAA" width="10" height="10"/>' +
      '<defs><script>x</script></defs><rect width="5" height="5" fill="red"/>',
  )
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].fill, '#FF0000')
  for (const name of ['script', 'foreignObject', 'image']) {
    assert.equal(r.warnings.filter((w) => w.startsWith(name)).length, 1, name)
  }
})

test('on で始まる属性は読まず、警告を 1 度書く（要素は描く）', () => {
  const r = run('<rect width="10" height="10" onclick="alert(1)" onload="x()"/><rect width="5" height="5" onmouseover="y()"/>')
  assert.equal(r.ops.length, 2)
  assert.equal(r.warnings.filter((w) => w.includes('on で始まる')).length, 1)
})

test('style 要素は読まない。警告は quietStyle で消せる', () => {
  const r = run('<style>rect{fill:red}</style><rect width="10" height="10"/>')
  assert.equal(r.ops[0].fill, '#000000')
  assert.equal(r.warnings.filter((w) => w.includes('style')).length, 1)
  assert.equal(run('<style>rect{fill:red}</style><rect width="10" height="10"/>', undefined, { quietStyle: true }).warnings.length, 0)
})

test('外への参照の塗りは塗らない。面の勾配は Paint になり、線の勾配は最初の色の単色にする', () => {
  const ext = run('<rect width="10" height="10" fill="url(http://example.com/x.svg#a)"/>')
  assert.equal(ext.ops.length, 0)
  assert.ok(ext.warnings.length > 0)
  const grad = run('<defs><linearGradient id="g"><stop offset="0" stop-color="#00f"/><stop offset="1" stop-color="#f00"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>')
  assert.equal(grad.ops[0].fill, '#0000FF', '代わりの単色は最初の色')
  assert.deepEqual(grad.ops[0].paint, { kind: 'linear', x1: 0, y1: 0, x2: 10, y2: 0, stops: [{ at: 0, color: '#0000FF' }, { at: 1, color: '#FF0000' }] })
  assert.deepEqual(grad.warnings, [])
  const line = run('<defs><linearGradient id="g"><stop offset="0" stop-color="#00f"/><stop offset="1" stop-color="#f00"/></linearGradient></defs><path d="M0 0 L10 10" stroke="url(#g)" fill="none"/>')
  assert.equal(line.ops[0].stroke, '#0000FF')
  assert.equal(line.ops[0].paint, undefined)
  assert.ok(line.warnings.some((w) => w.includes('グラデーション')))
})

test('defs の中身と、知らない要素は描かない', () => {
  const r = run('<defs><rect width="10" height="10"/></defs><foo><rect width="10" height="10"/></foo><metadata><rect width="10" height="10"/></metadata>')
  assert.equal(r.ops.length, 0)
})

// ---- 壊れた入力・上限

test('XML として壊れていれば Op を作らず、警告に理由を書く（投げない）', () => {
  for (const bad of ['<svg><g></svg>', '<svg viewBox="0 0 1 1"><rect width=10/></svg>', '<svg', '<svg><!-- x </svg>', '']) {
    const r = svgToOps(bad, BOX)
    assert.deepEqual(r.ops, [], bad)
    assert.equal(r.warnings.length, 1, bad)
  }
  assert.equal(svgToOps(/** @type {any} */ (null), BOX).ops.length, 0)
  assert.ok(svgToOps('<html></html>', BOX).warnings[0].includes('svg'))
})

test('Op が 20,000 個を超えたら残りを捨てて警告する', () => {
  const body = Array.from({ length: 25000 }, (_, i) => `<rect x="${i % 90}" y="${i % 90}" width="5" height="5"/>`).join('')
  const r = run(body)
  assert.equal(r.ops.length, 20000)
  assert.ok(r.warnings.some((w) => w.includes('20,000')))
})

test('ClipOp の中の Op も上限に数える', () => {
  const body = '<defs><clipPath id="c"><rect width="50" height="50"/></clipPath></defs><g clip-path="url(#c)">' + Array.from({ length: 25000 }, () => '<rect width="5" height="5"/>').join('') + '</g>'
  const r = run(body)
  assert.ok(flat(r.ops).length <= 20000)
  assert.ok(r.warnings.some((w) => w.includes('20,000')))
})

test('入れ子が 64 段を超えた所から先は描かない', () => {
  const deep = '<g>'.repeat(70) + '<rect width="10" height="10"/>' + '</g>'.repeat(70)
  const r = run(deep)
  assert.equal(r.ops.length, 0)
  assert.ok(r.warnings.some((w) => w.includes('入れ子')))
  assert.equal(run('<g>'.repeat(10) + '<rect width="10" height="10"/>' + '</g>'.repeat(10)).ops.length, 1)
})

// ---- はみ出しの ClipOp

test('描いた物が四角の中に収まっていれば ClipOp で包まず、はみ出す時だけ四角で包む', () => {
  const inside = run('<rect x="0" y="0" width="100" height="100" fill="red" stroke="black" stroke-width="4"/>', undefined, { clip: 'auto' })
  assert.equal(inside.ops[0].t, 'path')
  const over = run('<rect x="-10" y="0" width="50" height="50" fill="red"/>', undefined, { clip: 'auto' })
  assert.equal(over.ops.length, 1)
  assert.deepEqual([over.ops[0].t, over.ops[0].x, over.ops[0].y, over.ops[0].w, over.ops[0].h], ['clip', 0, 0, 100, 100])
  assert.equal(over.ops[0].ops[0].t, 'path')
  const off = run('<rect x="-10" y="0" width="50" height="50" fill="red"/>', undefined, { clip: false })
  assert.equal(off.ops[0].t, 'path')
})

test('右にはみ出す字も四角で包む', () => {
  const r = run('<text x="95" y="50" font-size="10">ABC</text>', undefined, { clip: 'auto' })
  assert.equal(r.ops[0].t, 'clip')
})

test('制御文字・双方向の制御・ゼロ幅の字は描かない', () => {
  const hidden = [0x202e, 0x200b, 0x2066, 0xfeff, 0x01, 0x7f].map((cp) => String.fromCodePoint(cp)).join('')
  const op = texts(run(`<text x="0" y="10" font-size="10">A${hidden}B</text>`))[0]
  assert.equal(textOf(op), 'AB')
  assert.deepEqual(glyphXs(op), [0, 5.5])
})

test('1 つの text は 20000 字までで、超えたら警告する', () => {
  const r = run(`<text x="0" y="10" font-size="10">${'A'.repeat(25000)}</text>`)
  assert.equal(texts(r)[0].glyphs.length, 20000)
  assert.ok(r.warnings.some((w) => w.includes('20000')))
})

test('空白だらけ・閉じないコメントだらけの属性でも一瞬で読み終える', () => {
  const t0 = Date.now()
  run(`<rect width="5" height="5" transform="${' '.repeat(100000)}x"/><rect width="1${' '.repeat(100000)}x" height="5"/><rect width="5" height="5" style="${'/*'.repeat(100000)}"/>`)
  assert.ok(Date.now() - t0 < 1000)
})

test('壊れた入力を混ぜても投げず、座標に NaN や Infinity を出さない', () => {
  const base = `<svg ${NS} viewBox="0 0 100 100"><g transform="rotate(30) translate(5,5)" opacity=".5"><path d="M10 10 A20 10 30 1 0 50 50 Q 1 2 3 4 T 5 6 S 1 2 3 4 z" stroke="blue" stroke-dasharray="1 2"/><text x="1 2 3" y="5" dx="1" dy="2" font-size="4" text-anchor="end">hello<tspan fill="red" dy="3" x="20">world</tspan></text></g></svg>`
  const junk = ['<', '>', '"', '&', '&#', ';', '=', '/', '-', '1e', '.', '(', ')', 'url(', 'M', 'z', 'NaN', 'Infinity', '1e999', '-0']
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let i = 0; i < 400; i++) {
    let s = base
    for (let j = 0; j < 4; j++) {
      const p = Math.floor(rnd() * s.length)
      s = rnd() < 0.5 ? s.slice(0, p) + junk[Math.floor(rnd() * junk.length)] + s.slice(p) : s.slice(0, p) + s.slice(p + 1 + Math.floor(rnd() * 8))
    }
    const r = svgToOps(s, BOX)
    assert.ok(!/NaN|Infinity|null/.test(JSON.stringify(r.ops)), s)
  }
})

// ---- 攻める入力(見直しで足した物)。正規表現の戻りが二乗・三乗になる入力は、直す前は数秒〜数十秒かかった

/** 一瞬(500ms 未満)で返り、投げないこと */
function quick(label, svg) {
  const t0 = performance.now()
  const r = svgToOps(svg, BOX)
  const ms = performance.now() - t0
  assert.ok(ms < 500, `${label}: ${Math.round(ms)}ms`)
  return r
}

test('url( の後ろに空白が 6000 字続いて ) が無い塗りでも一瞬で読み終え、塗らない', () => {
  const r = quick('url 空白', `<svg ${NS} viewBox="0 0 100 100"><rect width="10" height="10" fill="url(${' '.repeat(6000)}x"/></svg>`)
  assert.equal(r.ops.length, 0)
  assert.ok(r.warnings.some((w) => w.includes('外への参照')))
})

test('rgb( の後ろに空白が 20 万字続く色でも一瞬で読み終える(色として読めないので既定の塗りになる)', () => {
  quick('rgb 空白', `<svg ${NS} viewBox="0 0 100 100"><rect width="10" height="10" fill="rgb(${' '.repeat(200000)}x"/><rect width="10" height="10" style="stroke:hsl(${' '.repeat(200000)}"/></svg>`)
})

test('数字が 10 万字続いて最後に外れる長さでも一瞬で読み終える', () => {
  quick('長さ', `<svg ${NS} viewBox="0 0 100 100"><rect width="${'1'.repeat(100000)}x" height="5"/><rect width="5" height="5" transform="translate(${'1'.repeat(100000)}x)"/></svg>`)
  quick('path の数', `<svg ${NS} viewBox="0 0 100 100"><path d="M ${'1'.repeat(100000)}x" stroke="black"/></svg>`)
})

test('url( の後ろの空白・引用符・後ろの色は今まで通り読み、閉じていない引用は外への参照と同じに扱う', () => {
  const fb = run(`<rect width="10" height="10" fill="url( '#nothing' ) #f00"/>`)
  assert.equal(fb.ops[0].fill, '#FF0000', '参照先が無ければ後ろの色')
  const bare = run(`<rect width="10" height="10" fill="url( #nothing ) blue"/>`)
  assert.equal(bare.ops[0].fill, '#0000FF')
  const open = run(`<rect width="10" height="10" fill="url('#a)"/>`)
  assert.equal(open.ops.length, 0)
  assert.ok(open.warnings.some((w) => w.includes('外への参照')))
})

test('桁外れの座標(1e300・1e999)は指数表記や Infinity を出さず、紙の外の大きさに丸める', () => {
  const r = run('<rect x="1e300" y="-1e300" width="1e300" height="1e300" fill="red"/><path d="M 0 0 L 1e300 1e300 L 5 5 Z M 1e999 0 L 1 1" stroke="black"/><circle cx="1e200" cy="3" r="1e250" fill="blue"/>')
  const json = JSON.stringify(r.ops)
  assert.doesNotMatch(json, /[0-9][eE][+-]?[0-9]|Infinity|NaN|null/, json.slice(0, 300))
  for (const op of flat(r.ops)) {
    if (op.t !== 'path') continue
    for (const m of op.d.matchAll(/-?\d+(?:\.\d+)?/g)) assert.ok(Math.abs(Number(m[0])) <= 1e7, `範囲外 ${m[0]}`)
  }
})

test('image・script・foreignObject・style は描かない', () => {
  const r = run([
    '<image href="http://evil.example/x.png" width="10" height="10"/>',
    '<image href="data:image/svg+xml;base64,PHN2Zy8+" width="10" height="10"/>',
    '<script>alert(1)</script>',
    '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
    '<style>rect { fill: url(http://evil.example/a.svg#x) }</style>',
  ].join(''))
  assert.equal(r.ops.length, 0)
  const w = r.warnings.join('\n')
  for (const name of ['image', 'script', 'foreignObject', 'style']) assert.ok(w.includes(name), `${name} の警告が無い: ${w}`)
})

test('CSS の url() は外への参照として塗らない(style 属性・presentation 属性の両方)', () => {
  const r = run('<rect width="10" height="10" style="fill:url(//evil.example/x.svg#a);stroke:url(https://evil.example/y#b)"/><rect width="10" height="10" fill="url(file:///etc/passwd)" stroke="url(&quot;http://evil.example&quot;)"/>')
  assert.equal(r.ops.length, 0)
  assert.ok(r.warnings.some((w) => w.includes('外への参照')))
})

test('入れ子が 20 万段・path が 30 万区間・破線が 10 万個でも、投げずに一瞬で返る', () => {
  quick('深い入れ子', `<svg ${NS} viewBox="0 0 100 100">${'<g>'.repeat(200000)}</svg>`)
  const long = quick('長い path', `<svg ${NS} viewBox="0 0 100 100"><path d="M0 0${' L1 1'.repeat(300000)}" stroke="black"/></svg>`)
  assert.ok(long.ops.length <= 1)
  quick('長い破線', `<svg ${NS} viewBox="0 0 100 100"><path d="M0 0 L50 50" stroke="black" stroke-dasharray="${'1 '.repeat(100000)}"/></svg>`)
})

// ---- font のまとめ書き

const fontOf = (style, extra = '') => texts(run(`<text x="0" y="20" ${extra} style="${style}">AB</text>`))[0]

test('font のまとめ書き（style="font: normal bold 9.5px Noto Sans JP"）から大きさと太さを読む', () => {
  const op = fontOf('font: normal bold 9.5px Noto Sans JP')
  assert.equal(op.size, 9.5)
  assert.equal(op.font, 'sansBold')
  const light = fontOf('font: normal normal 12px Microsoft YaHei')
  assert.equal(light.size, 12)
  assert.equal(light.font, 'sans')
})

test('font のまとめ書きの italic・数字の太さ・line-height・引用符つきの書体名を読む', () => {
  const a = fontOf('font: italic 600 12px/1.2 sans-serif')
  assert.deepEqual([a.size, a.font], [12, 'sansBold'])
  const b = fontOf('font: 400 11px "Noto Sans JP", sans-serif')
  assert.deepEqual([b.size, b.font], [11, 'sans'], '単位の無い 400 は大きさでなく太さ')
  const c = fontOf('font: bold 14px / 1.5 serif')
  assert.deepEqual([c.size, c.font], [14, 'sansBold'])
  assert.equal(fontOf('font: 150% serif').size, 24)
})

test('同じ style の中では、font と font-size・font-weight のうち後ろに書いた方が勝つ', () => {
  assert.equal(fontOf('font-weight: bold; font: 12px X').font, 'sans', 'まとめ書きが前の太さを上書きする')
  assert.equal(fontOf('font: 20px X; font-size: 10px').size, 10, '後ろの font-size が勝つ')
  assert.equal(fontOf('font-size: 10px; font: 20px X').size, 20, '後ろのまとめ書きが勝つ')
  assert.equal(fontOf('font: 20px X; font-weight: bold').font, 'sansBold')
})

test('font 属性（presentation 属性）のまとめ書きも読み、子は親から受け継ぐ', () => {
  const op = texts(run('<g font="bold 14px X"><text x="0" y="20">AB</text></g>'))[0]
  assert.deepEqual([op.size, op.font], [14, 'sansBold'])
})

test('大きさの無い font（caption・menu などのシステム書体）は読まず、今の大きさのまま', () => {
  assert.equal(fontOf('font: menu').size, 16)
  assert.equal(parseFontShorthand('menu'), null)
  assert.equal(parseFontShorthand('bold'), null)
  assert.equal(parseFontShorthand(''), null)
})

test('parseFontShorthand は 4 つの長い名前にばらし、書体名の空白と引用符はそのまま', () => {
  assert.deepEqual(parseFontShorthand('italic bold 9.5px/1.2 "Noto Sans JP", sans-serif'),
    { 'font-style': 'italic', 'font-weight': 'bold', 'font-size': '9.5px', 'font-family': '"Noto Sans JP", sans-serif' })
  assert.deepEqual(parseFontShorthand('large Microsoft YaHei'),
    { 'font-style': 'normal', 'font-weight': 'normal', 'font-size': 'large', 'font-family': 'Microsoft YaHei' })
  assert.deepEqual(parseFontShorthand('normal small-caps condensed 100 8pt X'),
    { 'font-style': 'normal', 'font-weight': '100', 'font-size': '8pt', 'font-family': 'X' })
})

// ---- 入れ子の svg の id

const grad = (id, color) => `<defs><linearGradient id="${id}"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>`
const fills = (r) => flat(r.ops).filter((o) => o.t === 'path' || o.t === 'rect').map((o) => o.fill)

test('並んだ入れ子の svg が同じ id の勾配を持っても、それぞれ自分の勾配で塗る', () => {
  const r = run(
    `<svg x="0" y="0" width="50" height="50" viewBox="0 0 50 50">${grad('g', '#ff0000')}<rect width="50" height="50" fill="url(#g)"/></svg>` +
      `<svg x="50" y="0" width="50" height="50" viewBox="0 0 50 50">${grad('g', '#0000ff')}<rect width="50" height="50" fill="url(#g)"/></svg>`,
  )
  assert.deepEqual(fills(r), ['#FF0000', '#0000FF'])
})

test('同じ id の clipPath も、入れ子の svg ごとに自分の物で切る', () => {
  const part = (x, w) =>
    `<svg x="${x}" y="0" width="50" height="50" viewBox="0 0 50 50"><defs><clipPath id="c"><rect x="0" y="0" width="${w}" height="50"/></clipPath></defs><rect width="50" height="50" fill="red" clip-path="url(#c)"/></svg>`
  const r = run(part(0, 10) + part(50, 30))
  const clips = flat(r.ops).filter((o) => o.t === 'clip' && o.h === 50 && o.w !== 50)
  assert.deepEqual(clips.map((c) => [c.x, c.w]), [[0, 10], [50, 30]])
})

test('内側の svg に無い id は外側の svg から引き、内側に同じ id があれば内側が先', () => {
  const r = run(
    grad('g', '#00ff00') +
      `<svg x="0" y="0" width="50" height="50" viewBox="0 0 50 50"><rect width="50" height="50" fill="url(#g)"/></svg>` +
      `<svg x="50" y="0" width="50" height="50" viewBox="0 0 50 50">${grad('g', '#0000ff')}<rect width="50" height="50" fill="url(#g)"/></svg>` +
      '<rect y="60" width="10" height="10" fill="url(#g)"/>',
  )
  assert.deepEqual(fills(r), ['#00FF00', '#0000FF', '#00FF00'])
})

test('外側から、入れ子の svg の中にしかない id も（文書で先に出た物として）引ける', () => {
  const r = run(`<svg x="0" y="0" width="50" height="50" viewBox="0 0 50 50">${grad('only', '#123456')}</svg><rect width="10" height="10" fill="url(#only)"/>`)
  assert.deepEqual(fills(r), ['#123456'])
})

// ---- use

const shapes = (r) => flat(r.ops).filter((o) => o.t === 'rect' || o.t === 'path')
/** rect か path を [x, y, w, h] に */
const boxOf = (o) => {
  if (o.t === 'rect') return [o.x, o.y, o.w, o.h]
  const n = o.d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  const xs = n.filter((_, i) => i % 2 === 0)
  const ys = n.filter((_, i) => i % 2 === 1)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}

test('use は同じ文書の要素を、use の transform と x・y の移動つきで描く', () => {
  const r = run('<defs><rect id="a" width="10" height="10" fill="red"/></defs><use href="#a" x="20" y="30"/><use href="#a" transform="translate(5 5)" x="1" y="2"/>')
  assert.deepEqual(r.warnings, [])
  const s = shapes(r)
  assert.equal(s.length, 2)
  assert.deepEqual(boxOf(s[0]), [20, 30, 10, 10])
  assert.deepEqual(boxOf(s[1]), [6, 7, 10, 10])
})

test('xlink:href の use も読み、参照先に fill が無ければ use の fill が受け継がれる', () => {
  const r = run('<defs><path id="p" d="M0 0 H10 V10 H0 Z"/></defs><use xlink:href="#p" fill="blue" xmlns:xlink="http://www.w3.org/1999/xlink"/>')
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].fill, '#0000FF')
  const own = run('<defs><path id="p" d="M0 0 H10 V10 H0 Z" fill="green"/></defs><use href="#p" fill="blue"/>')
  assert.equal(own.ops[0].fill, '#008000')
})

test('use の先が g なら中身を全部描き、use の opacity も掛かる', () => {
  const r = run('<defs><g id="g"><rect width="10" height="10" fill="red"/><circle cx="30" cy="5" r="5" fill="blue"/></g></defs><use href="#g" opacity="0.5"/>')
  assert.equal(r.ops.length, 2)
  for (const op of r.ops) assert.equal(op.opacity, 0.5)
})

test('use の先が symbol なら viewBox を use の width・height へ写し、use を通さない symbol は描かない', () => {
  const r = run('<defs><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></symbol></defs><use href="#s" x="10" y="20" width="40" height="40"/>')
  const s = shapes(r)
  assert.equal(s.length, 1)
  assert.deepEqual(boxOf(s[0]), [10, 20, 40, 40])
  assert.equal(run('<symbol id="s"><rect width="10" height="10"/></symbol>').ops.length, 0)
})

test('入れ子の svg の中の use は、外側の defs の勾配を参照先の中から引ける', () => {
  const r = run(grad('g', '#ff00ff') + '<defs><rect id="r" width="20" height="20" fill="url(#g)"/></defs><svg x="0" y="0" width="50" height="50" viewBox="0 0 50 50"><use href="#r" x="5" y="5"/></svg>')
  assert.deepEqual(fills(r), ['#FF00FF'])
})

test('clipPath の中の use も、参照先の形を移動して切り口にする', () => {
  const r = run('<defs><rect id="k" width="10" height="10"/><clipPath id="c"><use href="#k" x="20" y="30"/></clipPath></defs><rect width="100" height="100" fill="red" clip-path="url(#c)"/>')
  const clip = flat(r.ops).find((o) => o.t === 'clip')
  assert.ok(clip, JSON.stringify(r.ops))
  assert.deepEqual([clip.x, clip.y, clip.w, clip.h], [20, 30, 10, 10])
})

test('外のファイルを指す use と、見つからない use は描かず警告する', () => {
  const r = run('<use href="http://evil.example/a.svg#x"/><use href="logo.svg#y"/><use href="data:image/svg+xml;base64,PHN2Zy8+"/><use href="#nothing"/><use/>')
  assert.equal(r.ops.length, 0)
  const w = r.warnings.join('\n')
  assert.ok(w.includes('外のファイル'), w)
  assert.ok(w.includes('#nothing'), w)
  assert.equal(r.warnings.filter((m) => m.includes('外のファイル')).length, 1, '警告は 1 度')
})

test('use が自分・祖先・互いを指す循環は止まり、警告する', () => {
  const self = run('<defs><g id="a"><rect width="10" height="10" fill="red"/><use href="#a"/></g></defs><use href="#a"/>')
  assert.equal(self.ops.length, 1)
  assert.ok(self.warnings.some((w) => w.includes('循環')), self.warnings.join())
  const mutual = run('<defs><g id="a"><rect width="5" height="5"/><use href="#b"/></g><g id="b"><rect width="5" height="5"/><use href="#a"/></g></defs><use href="#a"/>')
  assert.equal(mutual.ops.length, 2)
  assert.ok(mutual.warnings.some((w) => w.includes('循環')))
  const parent = run('<g id="p"><rect width="10" height="10"/><use href="#p"/></g>')
  assert.equal(parent.ops.length, 1, '祖先を指す use は描かない')
  assert.ok(parent.warnings.some((w) => w.includes('循環')))
  assert.equal(run('<defs><use id="u" href="#u"/></defs><use href="#u"/>').ops.length, 0)
})

test('use を入れ子にして指数的に増やしても、一瞬で返り、描く数は上限で止まる', () => {
  let defs = '<g id="l0"><rect width="1" height="1"/></g>'
  for (let i = 1; i <= 12; i++) defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`
  const t0 = Date.now()
  const r = run(`<defs>${defs}</defs><use href="#l12"/>`)
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
  assert.ok(r.ops.length <= 20000)
  assert.ok(r.warnings.length > 0)
})
