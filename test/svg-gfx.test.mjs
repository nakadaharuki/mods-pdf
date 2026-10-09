// SVG の勾配・合成・切り口・角丸・影 → Op の試験。metrics は作り物（和字 1em・ASCII 0.55em）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { svgToOps } from '../hooks/engine/svg.mjs'

const font = { upm: 1000, ascent: 0.88, descent: -0.12, adv: (cp) => (cp > 0x2e7f ? 1 : 0.55), has: () => true, run: () => ({ width: 0, xs: [] }) }
const metrics = { sans: font, sansBold: font, mincho: font, minchoBold: font }
const BOX = { x: 0, y: 0, width: 100, height: 100, metrics }
const NS = 'xmlns="http://www.w3.org/2000/svg"'
const run = (body, attrs = 'viewBox="0 0 100 100"', opts = {}) => svgToOps(`<svg ${NS} ${attrs}>${body}</svg>`, { ...BOX, clip: false, ...opts })
const near = (a, b, eps = 0.01, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} と ${b} が ${eps} 以内でない`)

const STOPS = '<stop offset="0" stop-color="#00f"/><stop offset="1" stop-color="#f00"/>'
const RECT = '<rect x="20" y="10" width="40" height="30" fill="url(#g)"/>'
/** id="g" の勾配（要素名・属性・中身）を defs に置いて、RECT を塗って読む */
const grad = (tag, attrs = '', inner = STOPS, svgAttrs, shape = RECT) => run(`<defs><${tag} id="g" ${attrs}>${inner}</${tag}></defs>${shape}`, svgAttrs)
const paintOf = (r) => r.ops[0].paint

const defs = (inner) => `<defs>${inner}</defs>`
const clipped = (clipInner, extra = '') => run(`${defs(`<clipPath id="c">${clipInner}</clipPath>`)}<rect width="100" height="100" fill="red" clip-path="url(#c)" ${extra}/>`)
const shadowOf = (filter, shape = '<rect x="10" y="10" width="30" height="20" fill="red" filter="url(#f)"/>', svgAttrs) =>
  run(`${defs(`<filter id="f">${filter}</filter>`)}${shape}`, svgAttrs)

// ---- 勾配（Paint）

test('既定の勾配は四角の左端から右端へ水平に走り、op の色は最初の止まりになる', () => {
  const r = grad('linearGradient')
  assert.deepEqual(r.warnings, [])
  assert.deepEqual(paintOf(r), { kind: 'linear', x1: 20, y1: 10, x2: 60, y2: 10, stops: [{ at: 0, color: '#0000FF' }, { at: 1, color: '#FF0000' }] })
  assert.equal(r.ops[0].fill, '#0000FF', 'paint を読めない出力先が使う代わりの単色')
})

test('objectBoundingBox の勾配は x1 y1 x2 y2 を図形の四角の割合として読む（% も同じ）', () => {
  const v = paintOf(grad('linearGradient', 'x1="0" y1="0" x2="0" y2="1"'))
  assert.deepEqual([v.x1, v.y1, v.x2, v.y2], [20, 10, 20, 40])
  const p = paintOf(grad('linearGradient', 'x1="0%" y1="0%" x2="0%" y2="100%"'))
  assert.deepEqual([p.x1, p.y1, p.x2, p.y2], [20, 10, 20, 40])
})

test('縦横の比が違う四角の斜めの勾配は、四角の隅で ちょうど 0 と 1 になる軸に直す', () => {
  const p = paintOf(grad('linearGradient', 'x1="0" y1="0" x2="1" y2="1"'))
  const t = (x, y) => ((x - p.x1) * (p.x2 - p.x1) + (y - p.y1) * (p.y2 - p.y1)) / ((p.x2 - p.x1) ** 2 + (p.y2 - p.y1) ** 2)
  near(t(20, 10), 0, 1e-3, '左上')
  near(t(60, 40), 1, 1e-3, '右下')
  near(t(60, 10) + t(20, 40), 1, 1e-3, '右上と左下は 1 を挟んで対になる')
})

test('userSpaceOnUse の勾配は座標をそのまま使い、viewBox の倍率だけ掛かる', () => {
  const user = paintOf(grad('linearGradient', 'gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"'))
  assert.deepEqual([user.x1, user.y1, user.x2, user.y2], [0, 0, 100, 0])
  const scaled = paintOf(grad('linearGradient', 'gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="50" y2="0"', STOPS, 'viewBox="0 0 50 50"'))
  assert.deepEqual([scaled.x1, scaled.y1, scaled.x2, scaled.y2], [0, 0, 100, 0], '50 の viewBox を 100 の四角へ')
})

test('gradientTransform が勾配の軸に掛かる（回転・拡大）', () => {
  const rot = paintOf(grad('linearGradient', 'gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0" gradientTransform="rotate(90)"'))
  near(rot.x2, 0); near(rot.y2, 100)
  const big = paintOf(grad('linearGradient', 'gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="50" y2="0" gradientTransform="scale(2)"'))
  near(big.x2, 100); near(big.y2, 0)
})

test('図形の transform も勾配の軸に掛かる', () => {
  const r = grad('linearGradient', 'gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="50" y2="0"', STOPS, undefined,
    '<rect x="0" y="0" width="10" height="10" fill="url(#g)" transform="translate(10 20) scale(2)"/>')
  const p = paintOf(r)
  near(p.x1, 10); near(p.y1, 20); near(p.x2, 110); near(p.y2, 20)
})

test('href（xlink:href も）でつないだ勾配は、止まりと属性を引き継ぎ、自分で書いた属性が勝つ', () => {
  const inherited = run(`${defs(`<linearGradient id="a">${STOPS}</linearGradient><linearGradient id="g" href="#a" x2="0" y2="1"/>`)}${RECT}`)
  const p = paintOf(inherited)
  assert.equal(p.stops.length, 2)
  assert.deepEqual([p.x1, p.y1, p.x2, p.y2], [20, 10, 20, 40])
  const xlink = run(`${defs(`<linearGradient id="a">${STOPS}</linearGradient><linearGradient id="g" xlink:href="#a" xmlns:xlink="http://www.w3.org/1999/xlink" x2="0" y2="1"/>`)}${RECT}`)
  assert.deepEqual(paintOf(xlink).stops, p.stops)
  const own = run(`${defs(`<linearGradient id="a" x2="0" y2="1">${STOPS}</linearGradient><linearGradient id="g" href="#a" x2="1" y2="0"/>`)}${RECT}`)
  const q = paintOf(own)
  assert.deepEqual([q.x2, q.y2], [60, 10], '子の x2 y2 が親に勝つ')
})

test('href が輪になっていても投げない', () => {
  const r = run(`${defs('<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>')}<rect width="10" height="10" fill="url(#a)"/>`)
  assert.ok(Array.isArray(r.ops))
})

test('止まりの offset・stop-opacity（属性と style）が読まれ、図形の fill-opacity は op の opacity に残る', () => {
  const r = run(`${defs('<linearGradient id="g"><stop offset="0" stop-color="#00f" stop-opacity="0.2"/><stop offset="50%" stop-color="#0a0"/><stop offset="1" stop-color="#f00" style="stop-opacity:0"/></linearGradient>')}<rect x="20" y="10" width="40" height="30" fill="url(#g)" fill-opacity="0.5"/>`)
  assert.deepEqual(paintOf(r).stops, [
    { at: 0, color: '#0000FF', opacity: 0.2 },
    { at: 0.5, color: '#00AA00' },
    { at: 1, color: '#FF0000', opacity: 0 },
  ])
  assert.equal(r.ops[0].opacity, 0.5)
})

test('spreadMethod の pad 以外は pad で描き、警告する', () => {
  const r = grad('linearGradient', 'spreadMethod="reflect"')
  assert.equal(paintOf(r).kind, 'linear')
  assert.ok(r.warnings.some((w) => w.includes('spreadMethod')))
  assert.deepEqual(grad('linearGradient', 'spreadMethod="pad"').warnings, [])
})

test('止まりが 8 個を超える勾配は 8 個に間引き、両端は残して警告する', () => {
  const many = Array.from({ length: 12 }, (_, i) => `<stop offset="${i / 11}" stop-color="#${(i * 20).toString(16).padStart(2, '0')}0000"/>`).join('')
  const r = grad('linearGradient', '', many)
  const stops = paintOf(r).stops
  assert.equal(stops.length, 8)
  assert.equal(stops[0].at, 0)
  assert.equal(stops[7].at, 1)
  assert.ok(stops.every((s, i) => i === 0 || s.at > stops[i - 1].at), 'offset は増える順')
  assert.ok(r.warnings.some((w) => w.includes('8')))
})

test('止まりが 1 個の勾配は paint を付けずその色の単色になり、0 個なら塗らない', () => {
  const one = grad('linearGradient', '', '<stop offset="0.5" stop-color="#0a0"/>')
  assert.equal(one.ops[0].fill, '#00AA00')
  assert.equal(one.ops[0].paint, undefined)
  assert.equal(grad('linearGradient', '', '').ops.length, 0)
})

test('放射の勾配は円の中心と半径に、焦点は fx fy になる', () => {
  const r = grad('radialGradient', 'cx="0.5" cy="0.5" r="0.5" fx="0.75" fy="0.5"', STOPS, undefined, '<rect x="0" y="0" width="40" height="40" fill="url(#g)"/>')
  const p = paintOf(r)
  assert.equal(p.kind, 'radial')
  assert.deepEqual([p.cx, p.cy, p.r], [20, 20, 20])
  assert.deepEqual([p.fx, p.fy], [30, 20])
  assert.deepEqual(r.warnings, [])
})

test('焦点が円の外にあっても、円の内側（半径の 0.999 倍）へ寄せる', () => {
  const r = grad('radialGradient', 'cx="0.5" cy="0.5" r="0.5" fx="2" fy="0.5"', STOPS, undefined, '<rect x="0" y="0" width="40" height="40" fill="url(#g)"/>')
  const p = paintOf(r)
  assert.ok(Math.hypot(p.fx - p.cx, p.fy - p.cy) < p.r)
})

test('userSpaceOnUse の放射の勾配は円のまま、縦横の比が違う四角の bbox 勾配は円で近似して警告する', () => {
  const user = grad('radialGradient', 'gradientUnits="userSpaceOnUse" cx="50" cy="50" r="30"', STOPS, undefined, '<circle cx="50" cy="50" r="30" fill="url(#g)"/>')
  assert.deepEqual([paintOf(user).cx, paintOf(user).cy, paintOf(user).r], [50, 50, 30])
  assert.deepEqual(user.warnings, [])
  const ellipse = grad('radialGradient', 'cx="0.5" cy="0.5" r="0.5"')
  assert.equal(paintOf(ellipse).kind, 'radial')
  assert.ok(ellipse.warnings.some((w) => w.includes('円で近似')))
})

test('文字の勾配は TextOp の paint になり、四角は文字の箱になる', () => {
  const r = grad('linearGradient', '', STOPS, undefined, '<text x="10" y="40" font-size="10" fill="url(#g)">Hello</text>')
  const t = r.ops[0]
  assert.equal(t.t, 'text')
  assert.equal(t.color, '#0000FF')
  assert.equal(t.paint.kind, 'linear')
  near(t.paint.x1, 10); near(t.paint.x2, 37.5)
  assert.deepEqual(r.warnings, [])
})

test('線の勾配は最初の色の単色で描き、警告する（paint は付けない）', () => {
  const r = run(`${defs(`<linearGradient id="g">${STOPS}</linearGradient>`)}<path d="M0 0 L10 10" stroke="url(#g)" fill="none"/>`)
  assert.equal(r.ops[0].stroke, '#0000FF')
  assert.equal(r.ops[0].paint, undefined)
  assert.ok(r.warnings.some((w) => w.includes('グラデーション')))
})

test('存在しない id の勾配参照は塗らない', () => {
  const r = run('<rect width="10" height="10" fill="url(#none)"/>')
  assert.equal(r.ops.length, 0)
})

// ---- mix-blend-mode

test('mix-blend-mode は属性でも style でも blend になり、normal と知らない値は付けない', () => {
  assert.equal(run('<rect width="10" height="10" fill="red" mix-blend-mode="screen"/>').ops[0].blend, 'screen')
  assert.equal(run('<rect width="10" height="10" fill="red" style="mix-blend-mode:multiply"/>').ops[0].blend, 'multiply')
  assert.equal(run('<rect width="10" height="10" fill="red" style="mix-blend-mode:normal"/>').ops[0].blend, undefined)
  const unknown = run('<rect width="10" height="10" fill="red" style="mix-blend-mode:plus-lighter"/>')
  assert.equal(unknown.ops[0].blend, undefined)
  assert.ok(unknown.warnings.some((w) => w.includes('plus-lighter')))
})

test('normal 以外の 11 種類の合成モードを全部読む', () => {
  const modes = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion']
  for (const m of modes) assert.equal(run(`<rect width="10" height="10" fill="red" style="mix-blend-mode:${m}"/>`).ops[0].blend, m, m)
})

test('グループの mix-blend-mode は中の全ての Op に付き、子が自分で書けば子が勝つ', () => {
  const g = run('<g style="mix-blend-mode:multiply"><rect width="10" height="10" fill="red"/><circle cx="50" cy="50" r="5" fill="blue"/></g>')
  assert.deepEqual(g.ops.map((o) => o.blend), ['multiply', 'multiply'])
  const own = run('<g style="mix-blend-mode:multiply"><rect width="10" height="10" fill="red" style="mix-blend-mode:screen"/></g>')
  assert.equal(own.ops[0].blend, 'screen')
})

test('文字にも合成モードが付く', () => {
  const r = run('<text x="0" y="10" font-size="10" style="mix-blend-mode:overlay">AB</text>')
  assert.equal(r.ops[0].blend, 'overlay')
})

// ---- clip-path の形

test('circle・ellipse・polygon・path の切り口は ClipOp の d になり、x y w h はその外接の四角になる', () => {
  const circle = clipped('<circle cx="50" cy="50" r="20"/>').ops[0]
  assert.equal(circle.t, 'clip')
  assert.deepEqual([circle.x, circle.y, circle.w, circle.h], [30, 30, 40, 40])
  assert.ok(circle.d.startsWith('M 70 50 C'))
  const ellipse = clipped('<ellipse cx="50" cy="50" rx="30" ry="10"/>').ops[0]
  assert.deepEqual([ellipse.x, ellipse.y, ellipse.w, ellipse.h], [20, 40, 60, 20])
  const poly = clipped('<polygon points="10,10 90,10 50,90"/>').ops[0]
  assert.equal(poly.d, 'M 10 10 L 90 10 L 50 90 Z')
  assert.deepEqual([poly.x, poly.y, poly.w, poly.h], [10, 10, 80, 80])
  assert.equal(clipped('<path d="M10 10 L90 10 L50 90 Z"/>').ops[0].d, 'M 10 10 L 90 10 L 50 90 Z')
})

test('座標軸に揃った角の四角の切り口は d を付けず、外接の四角だけで切る', () => {
  const c = clipped('<rect x="10" y="10" width="50" height="40"/>').ops[0]
  assert.deepEqual([c.x, c.y, c.w, c.h], [10, 10, 50, 40])
  assert.equal(c.d, undefined)
})

test('角丸の四角・回転した四角の切り口は d で切る', () => {
  const round = clipped('<rect x="10" y="10" width="50" height="40" rx="8"/>').ops[0]
  assert.ok(round.d.includes('C'))
  const rot = clipped('<rect x="10" y="10" width="50" height="40" transform="rotate(30 30 30)"/>').ops[0]
  assert.equal(rot.d.split(' ').filter((t) => t === 'L').length, 3)
  assert.ok(rot.w > 50 && rot.h > 40, '外接の四角は元の四角より大きい')
})

test('clipPath の子が複数ならそれらの和で切る（M をつなげた d）', () => {
  const c = clipped('<circle cx="30" cy="30" r="10"/><circle cx="70" cy="70" r="10"/>').ops[0]
  assert.equal(c.d.split(' ').filter((t) => t === 'M').length, 2)
  assert.deepEqual([c.x, c.y, c.w, c.h], [20, 20, 60, 60])
})

test('clipPath の中の rect・path・polygon・circle・ellipse 以外の子は切り口に入れず警告する', () => {
  const r = clipped('<text x="0" y="10">A</text>')
  assert.ok(r.warnings.some((w) => w.includes('clipPath')))
  assert.equal(r.ops[0].t, 'path', '切り口が空なら切らずに描く')
})

// ---- 角丸の四角

test('rx だけの rect は RectOp の r になり、辺の半分を超える rx は半分に収まる', () => {
  assert.deepEqual(run('<rect x="10" y="20" width="30" height="30" rx="5" fill="red"/>').ops[0], { t: 'rect', x: 10, y: 20, w: 30, h: 30, r: 5, fill: '#FF0000' })
  assert.equal(run('<rect x="0" y="0" width="30" height="20" rx="8" ry="8" fill="red"/>').ops[0].r, 8)
  assert.equal(run('<rect x="0" y="0" width="20" height="20" rx="100" fill="red"/>').ops[0].r, 10)
})

test('角丸の rect の枠線と透明度は RectOp に載る', () => {
  const r = run('<rect x="10" y="10" width="30" height="20" rx="4" fill="red" stroke="blue" stroke-width="2" opacity="0.5"/>').ops[0]
  assert.equal(r.t, 'rect')
  assert.equal(r.stroke, '#0000FF')
  assert.equal(r.lw, 2)
  assert.equal(r.opacity, 0.5)
})

test('回転した角丸の rect と、ry が rx と違う角は、RectOp でなく path になる', () => {
  assert.equal(run('<rect x="10" y="10" width="30" height="20" rx="4" fill="red" transform="rotate(10)"/>').ops[0].t, 'path')
  assert.equal(run('<rect x="10" y="10" width="30" height="20" rx="4" ry="8" fill="red"/>').ops[0].t, 'path')
})

test('角丸のない rect は今までどおり path のまま', () => {
  const r = run('<rect x="10" y="20" width="30" height="30" fill="red"/>').ops[0]
  assert.equal(r.t, 'path')
  assert.equal(r.d, 'M 10 20 L 40 20 L 40 50 L 10 50 Z')
})

test('角丸の rect の勾配は RectOp の paint になる', () => {
  const r = grad('linearGradient', '', STOPS, undefined, '<rect x="20" y="10" width="40" height="30" rx="6" fill="url(#g)"/>')
  assert.equal(r.ops[0].t, 'rect')
  assert.equal(r.ops[0].paint.kind, 'linear')
})

// ---- 影

test('feDropShadow は rect の shadow になり、blur は stdDeviation の 2 倍（CSS の半径）になる', () => {
  const r = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.4"/>')
  assert.deepEqual(r.ops, [{ t: 'rect', x: 10, y: 10, w: 30, h: 20, fill: '#FF0000', shadow: { dx: 1, dy: 2, blur: 6, color: '#000000', opacity: 0.4 } }])
  assert.deepEqual(r.warnings, [])
})

test('feGaussianBlur と feOffset（と feFuncA の slope）の組みも影になる', () => {
  const r = shadowOf('<feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="0" dy="3" result="o"/><feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>')
  assert.deepEqual(r.ops[0].shadow, { dx: 0, dy: 3, blur: 4, color: '#000000', opacity: 0.5 })
  assert.deepEqual(r.warnings, [])
})

test('影の距離とぼかしは viewBox の倍率で変わる', () => {
  const r = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="#00f" flood-opacity="0.4"/>', undefined, 'viewBox="0 0 50 50"')
  const o = r.ops[0]
  assert.deepEqual([o.x, o.y, o.w, o.h], [20, 20, 60, 40])
  assert.deepEqual(o.shadow, { dx: 2, dy: 4, blur: 12, color: '#0000FF', opacity: 0.4 })
})

test('影の濃さは flood-opacity と塗りの透明度の積で、RectOp の opacity は図形の透明度のまま', () => {
  const r = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3" flood-opacity="0.5"/>', '<rect x="10" y="10" width="30" height="20" fill="red" fill-opacity="0.5" filter="url(#f)"/>')
  assert.equal(r.ops[0].opacity, 0.5)
  assert.equal(r.ops[0].shadow.opacity, 0.25)
})

test('角丸と枠線のある rect の影は、枠線も同じ RectOp に載せる', () => {
  const r = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3"/>', '<rect x="10" y="10" width="30" height="20" rx="4" fill="red" stroke="blue" stroke-width="2" filter="url(#f)"/>')
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].r, 4)
  assert.equal(r.ops[0].stroke, '#0000FF')
  assert.ok(r.ops[0].shadow)
})

test('rect 以外・回転した rect・グループの filter は影を付けず警告する', () => {
  const circle = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3"/>', '<circle cx="50" cy="50" r="10" fill="red" filter="url(#f)"/>')
  assert.equal(circle.ops[0].shadow, undefined)
  assert.ok(circle.warnings.some((w) => w.includes('filter')))
  const rotated = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3"/>', '<rect x="10" y="10" width="30" height="20" fill="red" filter="url(#f)" transform="rotate(10)"/>')
  assert.equal(rotated.ops[0].shadow, undefined)
  assert.equal(rotated.ops[0].t, 'path')
  assert.ok(rotated.warnings.length > 0)
  const group = shadowOf('<feDropShadow dx="1" dy="2" stdDeviation="3"/>', '<g filter="url(#f)"><rect x="10" y="10" width="30" height="20" fill="red"/></g>')
  assert.equal(group.ops[0].shadow, undefined)
  assert.ok(group.warnings.length > 0)
})

test('影以外の filter は付いていないものとして描き、警告する', () => {
  const r = shadowOf('<feColorMatrix type="saturate" values="0"/>')
  assert.equal(r.ops.length, 1)
  assert.equal(r.ops[0].shadow, undefined)
  assert.ok(r.warnings.some((w) => w.includes('filter')))
})

// ---- 形の決まり

test('全部の機能を使った図でも、どの Op にも undefined の値は入らず、座標は有限の数になる', () => {
  const r = run(`${defs(`<linearGradient id="g">${STOPS}</linearGradient><radialGradient id="rg"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
    <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath><filter id="f"><feDropShadow dx="1" dy="2" stdDeviation="3"/></filter>`)}
    <g clip-path="url(#c)" style="mix-blend-mode:multiply">
      <rect x="10" y="10" width="40" height="30" rx="4" fill="url(#g)" filter="url(#f)"/>
      <circle cx="60" cy="60" r="20" fill="url(#rg)"/>
      <text x="10" y="90" font-size="8" fill="url(#g)">日本語 abc</text>
    </g>`)
  const check = (o) => {
    for (const [k, v] of Object.entries(o)) {
      assert.notEqual(v, undefined, `${o.t}.${k}`)
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${o.t}.${k}`)
      if (k === 'ops') v.forEach(check)
      if (k === 'paint') v.stops.forEach((s) => Object.entries(s).forEach(([sk, sv]) => assert.notEqual(sv, undefined, `stop.${sk}`)))
    }
  }
  assert.ok(r.ops.length > 0)
  r.ops.forEach(check)
  JSON.parse(JSON.stringify(r.ops))
})

test('mask は付いていないものとして描き、警告する', () => {
  const r = run(`${defs('<mask id="m"><rect width="10" height="10" fill="white"/></mask>')}<rect width="10" height="10" fill="red" mask="url(#m)"/>`)
  assert.equal(r.ops.length, 1)
  assert.ok(r.warnings.some((w) => w.includes('mask')))
})
