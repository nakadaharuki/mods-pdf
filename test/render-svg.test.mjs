import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSvg, pageSvgInfo } from '../hooks/render/svg.mjs';

const LIMIT = 131072;
const NOTE = '略図（頁が細かすぎるため）';

/** @param {any[]} ops @param {{ width: number, height: number }} [page] */
function layout(ops, page = { width: 595.28, height: 841.89 }) {
  return { page, pages: [{ ops }] };
}

/** @param {'mincho'|'minchoBold'|'sans'|'sansBold'} font @param {number} size @param {number} y @param {string} str @param {number} [x0] @param {number} [step] */
function text(font, size, y, str, x0 = 56.7, step = size) {
  const glyphs = Array.from(str).map((c, i) => ({ c, x: x0 + i * step }));
  return { t: 'text', font, size, color: '#111111', y, glyphs };
}

/** XML の字を戻す（試験の中だけで使う） */
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** 開きと閉じのタグが同じ順に揃っているか（自己閉じは開きに数えない） */
function wellFormed(svg) {
  /** @type {string[]} */
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const [, close, name, selfClose] = m;
    if (close) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** 1 つ 1 つの <text> の x の列と、中の字（戻したもの） */
function texts(svg) {
  /** @type {{ xs: string[], content: string }[]} */
  const out = [];
  const re = /<text ([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const x = /\sx="([^"]*)"/.exec(m[1]);
    out.push({ xs: x ? x[1].split(' ') : [], content: decode(m[2]) });
  }
  return out;
}

test('白い紙を最初に描き、viewBox は頁の大きさにする', () => {
  const svg = pageSvg(layout([]), 0, { id: 'p1' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 595\.3 841\.9" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect x="0\.25" y="0\.25" width="594\.8" height="841\.4" fill="#FFFFFF" stroke="#D8D8D4" stroke-width="0\.5"\/>/);
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(wellFormed(svg));
});

test('字の行は 1 つの text にし、x の数を字の数と同じにする', () => {
  const svg = pageSvg(layout([text('mincho', 9.5, 100, '東京 ab')]), 0, { id: 'p1' });
  const ts = texts(svg);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].xs.length, Array.from('東京 ab').length);
  assert.equal(ts[0].content, '東京 ab');
  assert.match(svg, /<text xml:space="preserve" x="[^"]*" y="100" font-family="'Noto Serif JP'/);
});

test('字の中の & < > と引用符は逃がし、タグの開きと閉じを揃える', () => {
  const src = '&<>"\'';
  const svg = pageSvg(layout([text('sans', 9.5, 100, src)]), 0, { id: 'p1' });
  assert.ok(svg.includes('&amp;&lt;&gt;&quot;&apos;'));
  assert.equal(texts(svg)[0].content, src);
  assert.ok(wellFormed(svg));
});

test('XML で許されない制御の字と代理の字の片割れは空白にし、字の数を変えない', () => {
  const ctrl = String.fromCodePoint(1);
  const lone = String.fromCharCode(0xD800);
  const svg = pageSvg(layout([{
    t: 'text', font: 'mincho', size: 9.5, color: '#111111', y: 10,
    glyphs: [{ c: 'あ', x: 1 }, { c: ctrl, x: 2 }, { c: 'い', x: 3 }, { c: lone, x: 4 }],
  }]), 0, { id: 'p1' });
  const [t] = texts(svg);
  assert.equal(t.xs.length, 4);
  assert.equal(t.content, 'あ い ');
  assert.ok(!svg.includes(ctrl));
  assert.ok(!svg.includes(lone));
});

test('太字の書体だけ font-weight 700 を付ける', () => {
  const svg = pageSvg(layout([text('minchoBold', 18, 60, '題名'), text('sans', 9.5, 80, '本文')]), 0, { id: 'p1' });
  assert.equal((svg.match(/font-weight="700"/g) || []).length, 1);
});

test('数は小数 1 桁に丸め、末尾の .0 と -0 を消し、有限でない数は 0 にする', () => {
  const svg = pageSvg(layout([
    { t: 'rule', x1: 12.34, y1: 5, x2: 100.06, y2: NaN, w: 0.4, color: '#CCCCC9' },
    { t: 'rule', x1: -0.04, y1: 5.0, x2: 1e-9, y2: 5, w: 0.5, color: '#CCCCC9' },
  ]), 0, { id: 'p1' });
  assert.ok(svg.includes('<line x1="12.3" y1="5" x2="100.1" y2="0" stroke="#CCCCC9" stroke-width="0.4"/>'));
  assert.ok(svg.includes('<line x1="0" y1="5" x2="0" y2="5" stroke="#CCCCC9" stroke-width="0.5"/>'));
});

test('undefined・NaN・null・Infinity の字を出さない', () => {
  const svg = pageSvg({
    page: { width: NaN, height: undefined },
    pages: [{
      ops: [
        { t: 'text', font: 'sans', size: NaN, color: undefined, y: undefined, glyphs: [{ c: 'あ', x: NaN }, { c: 'い', x: undefined }] },
        { t: 'rect', x: Infinity, y: null, w: 1, h: 2, fill: undefined },
        { t: 'path', d: 'M 1 2 L NaN 4', fill: '#000000' },
        { t: 'image', x: 0, y: 0, w: 1, h: 1, kind: 'png', base64: undefined },
        { t: 'field', kind: 'text', name: 'a', x: 0, y: 0, w: 10, h: 5, value: undefined },
      ],
    }],
  }, 0, { id: 'p1' });
  for (const word of ['undefined', 'NaN', 'null', 'Infinity']) assert.ok(!svg.includes(word), word);
  assert.ok(wellFormed(svg));
});

test('クリップの id は頁の中で一意で、参照も同じ id を指す', () => {
  const svg = pageSvg(layout([
    {
      t: 'clip', x: 0, y: 0, w: 100, h: 100, ops: [
        { t: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#F1F0ED' },
        { t: 'clip', x: 0, y: 0, w: 50, h: 50, ops: [{ t: 'path', d: 'M 0 0 L 5 5', stroke: '#111111' }] },
      ],
    },
    { t: 'clip', x: 0, y: 0, w: 9, h: 9, ops: [] },
  ]), 0, { id: 'chart3' });
  const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['chart3-c1', 'chart3-c2', 'chart3-c3']);
  for (const r of svg.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.includes(r[1]), r[1]);
  assert.ok(wellFormed(svg));
});

test('id に英数字と - _ 以外があっても、id の接頭を安全な字にする', () => {
  const svg = pageSvg(layout([{ t: 'clip', x: 0, y: 0, w: 1, h: 1, ops: [] }]), 0, { id: 'a b"c' });
  assert.ok(svg.includes('id="a_b_c-c1"'));
  assert.ok(!svg.includes('"c'));
});

test('小さい画像は data URI で埋め込み、40,000 字以上の画像は灰の四角にする', () => {
  const small = 'iVBORw0KGgo=';
  const big = 'A'.repeat(40000);
  const svg = pageSvg(layout([
    { t: 'image', x: 10, y: 20, w: 100, h: 50, kind: 'png', base64: small },
    { t: 'image', x: 10, y: 80, w: 100, h: 50, kind: 'jpg', base64: small },
    { t: 'image', x: 10, y: 140, w: 100, h: 50, kind: 'png', base64: big },
  ]), 0, { id: 'p1' });
  assert.ok(svg.includes(`<image x="10" y="20" width="100" height="50" href="data:image/png;base64,${small}"/>`));
  assert.ok(svg.includes(`href="data:image/jpeg;base64,${small}"`));
  assert.ok(!svg.includes(big));
  assert.ok(svg.includes('<rect x="10" y="140" width="100" height="50" fill="#F1F0ED"/>'));
});

test('記入欄は灰の枠を描き、値は sans の字で入れ、チェックは true の時だけ線を引く', () => {
  const svg = pageSvg(layout([
    { t: 'field', kind: 'text', name: '氏名', x: 50, y: 100, w: 200, h: 14, value: '山田 太郎' },
    { t: 'field', kind: 'check', name: '同意', x: 50, y: 120, w: 10, h: 10, value: true },
    { t: 'field', kind: 'check', name: '未', x: 70, y: 120, w: 10, h: 10, value: false },
  ]), 0, { id: 'p1' });
  assert.equal((svg.match(/stroke="#8A8A86" stroke-width="0\.6"/g) || []).length, 3);
  assert.ok(texts(svg).some((t) => t.content === '山田 太郎'));
  assert.equal((svg.match(/stroke-linejoin="round"/g) || []).length, 1);
});

test('リンクは描かず、fill の無い path は fill="none" にする', () => {
  const svg = pageSvg(layout([
    { t: 'link', x: 0, y: 0, w: 10, h: 10, url: 'https://example.com' },
    { t: 'path', d: 'M 1 2 L 3 4', stroke: '#111111', lw: 0.5 },
  ]), 0, { id: 'p1' });
  assert.ok(!svg.includes('example.com'));
  assert.ok(svg.includes('<path d="M 1 2 L 3 4" fill="none" stroke="#111111" stroke-width="0.5"/>'));
});

test('頁の番号が範囲の外なら白い紙だけを返す', () => {
  const L = layout([text('mincho', 9.5, 100, 'あ')]);
  for (const i of [-1, 1, 1.5, NaN]) {
    const svg = pageSvg(L, i, { id: 'p1' });
    assert.ok(!svg.includes('<text'), String(i));
    assert.equal((svg.match(/<rect /g) || []).length, 1, String(i));
    assert.ok(wellFormed(svg));
  }
  assert.ok(wellFormed(pageSvg({}, 0, { id: 'p1' })));
});

test('1 頁 60 行 × 53 字の字は段 0 か 1 で 131,072 字に収まる', () => {
  const base = Array.from('日本語の組版を確かめる文字列です。');
  const ops = [];
  for (let r = 0; r < 60; r++) {
    const str = Array.from({ length: 53 }, (_, i) => base[(i + r) % base.length]).join('');
    ops.push(text('mincho', 9.5, 80 + r * 16.6, str));
  }
  const info = pageSvgInfo(layout(ops), 0, { id: 'p1' });
  assert.ok(info.level <= 1, `level ${info.level}`);
  assert.ok(info.chars <= LIMIT);
  const ts = texts(info.svg);
  assert.equal(ts.length, 60);
  assert.ok(ts.every((t) => t.xs.length === 53));
});

test('数千本の線だけの path を持つ頁は段 3 で、131,072 字に収まる', () => {
  const ops = Array.from({ length: 4000 }, (_, i) => ({
    t: 'path', d: `M ${i % 500} 10 L ${i % 300} 90 C 1 2 3 4 5 6 Z`, stroke: '#4A4A4A', lw: 0.5,
  }));
  const info = pageSvgInfo(layout(ops), 0, { id: 'p1' });
  assert.equal(info.level, 3);
  assert.ok(info.chars <= LIMIT);
  assert.ok(!info.svg.includes('<path'));
});

test('塗りの path が多すぎる頁は段 4 の略図にし、右上に注記を書く', () => {
  const ops = Array.from({ length: 6000 }, (_, i) => ({ t: 'path', d: `M ${i} 1 L ${i} 9 L 3 4 Z`, fill: '#176639' }));
  const info = pageSvgInfo(layout(ops), 0, { id: 'p1' });
  assert.equal(info.level, 4);
  assert.ok(info.chars <= LIMIT);
  assert.ok(!info.svg.includes('<path'));
  const note = texts(info.svg).find((t) => t.content === NOTE);
  assert.ok(note, 'note');
  assert.equal(note.xs.length, Array.from(NOTE).length);
});

test('段 2 では太さ 0.3 未満の罫を間引き、0.3 以上の罫は残す', () => {
  const ops = Array.from({ length: 3000 }, (_, i) => ({
    t: 'rule', x1: 56.7, y1: i % 800, x2: 500, y2: i % 800, w: 0.2, color: '#CCCCC9',
  }));
  ops.push({ t: 'rule', x1: 56.7, y1: 700, x2: 500, y2: 700, w: 0.4, color: '#CCCCC9' });
  const info = pageSvgInfo(layout(ops), 0, { id: 'p1' });
  assert.equal(info.level, 2);
  assert.equal((info.svg.match(/<line /g) || []).length, 1);
  assert.ok(info.svg.includes('stroke-width="0.4"'));
});

test('pageSvg は pageSvgInfo の svg と同じ字を返す', () => {
  const L = layout([text('sans', 9.5, 100, 'テスト')]);
  assert.equal(pageSvg(L, 0, { id: 'p1' }), pageSvgInfo(L, 0, { id: 'p1' }).svg);
});

// ---- 勾配・合成・影・角丸・曲線の切り口

const LIN = { kind: 'linear', x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ at: 0, color: '#0000FF' }, { at: 1, color: '#FF0000', opacity: 0.5 }] };
const RAD = { kind: 'radial', cx: 50, cy: 50, r: 30, fx: 40, fy: 45, stops: [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#000000' }] };
const SHADOW = { dx: 1, dy: 3, blur: 8, color: '#000000', opacity: 0.25 };
const GFX_PAGE = { width: 200, height: 100 };
const gfx = (ops, id = 'p1') => pageSvgInfo(layout(ops, GFX_PAGE), 0, { id });
/** svg の中の id="..." の列 */
const idsOf = (svg) => [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);

test('勾配は defs の linearGradient と radialGradient になり、userSpaceOnUse と止まりの不透明度を持つ', () => {
  const svg = gfx([
    { t: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', fill: '#0000FF', paint: LIN },
    { t: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', fill: '#FFFFFF', paint: RAD },
  ]).svg;
  assert.match(svg, /<defs>.*<\/defs>/);
  assert.ok(svg.includes('<linearGradient id="p1-g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">'));
  assert.ok(svg.includes('<stop offset="1" stop-color="#FF0000" stop-opacity="0.5"/>'));
  assert.ok(svg.includes('<radialGradient id="p1-g2" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="30" fx="40" fy="45">'));
  assert.ok(svg.includes('fill="url(#p1-g1)"') && svg.includes('fill="url(#p1-g2)"'));
  assert.ok(wellFormed(svg));
});

test('勾配と影の id は頁ごとの接頭を持ち、同じ勾配は 1 度だけ宣言して使い回す（影の filter は図形ごと）', () => {
  const ops = [
    { t: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', fill: '#0000FF', paint: LIN },
    { t: 'rect', x: 20, y: 0, w: 10, h: 10, fill: '#0000FF', paint: LIN, shadow: SHADOW },
    { t: 'rect', x: 40, y: 0, w: 10, h: 10, fill: '#0000FF', shadow: SHADOW },
  ];
  const a = gfx(ops, 'pageA').svg;
  const b = gfx(ops, 'pageB').svg;
  assert.equal((a.match(/<linearGradient /g) || []).length, 1);
  assert.equal((a.match(/<filter /g) || []).length, 2, '影の filter は範囲が図形ごとに違うので 1 つずつ');
  assert.equal((a.match(/url\(#pageA-g1\)/g) || []).length, 2);
  const idsA = idsOf(a);
  assert.equal(new Set(idsA).size, idsA.length, '頁の中で id が重ならない');
  assert.ok(idsA.every((id) => id.startsWith('pageA-')));
  assert.ok(idsOf(b).every((id) => id.startsWith('pageB-')));
  for (const r of a.matchAll(/url\(#([^)]*)\)/g)) assert.ok(idsA.includes(r[1]), r[1]);
});

test('角丸・透明度・合成・影が RectOp から rect の属性になり、影のぼかしは半分の stdDeviation になる', () => {
  const svg = gfx([{ t: 'rect', x: 10, y: 10, w: 80, h: 40, r: 6, fill: '#0000FF', opacity: 0.5, blend: 'multiply', shadow: SHADOW }]).svg;
  assert.match(svg, /<rect x="10" y="10" width="80" height="40" fill="#0000FF" rx="6" opacity="0\.5" filter="url\(#p1-f1\)" style="mix-blend-mode:multiply"\/>/);
  assert.match(svg, /<filter id="p1-f1" filterUnits="userSpaceOnUse"[^>]*><feDropShadow dx="1" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0\.5"\/><\/filter>/);
  assert.ok(wellFormed(svg));
});

test('影の flood-opacity は RectOp の opacity で割って、重ねた最終の濃さが shadow.opacity になる', () => {
  const half = gfx([{ t: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#FF0000', opacity: 0.5, shadow: { ...SHADOW, opacity: 0.25 } }]).svg;
  assert.ok(half.includes('flood-opacity="0.5"'), half);
  const capped = gfx([{ t: 'rect', x: 10, y: 10, w: 20, h: 20, fill: '#FF0000', opacity: 0.1, shadow: { ...SHADOW, opacity: 0.5 } }]).svg;
  assert.ok(capped.includes('flood-opacity="1"'), '1 を超えない');
});

test('PathOp と TextOp の合成モードは style の mix-blend-mode になり、TextOp の勾配と opacity も付く', () => {
  const svg = gfx([
    { t: 'path', d: 'M 0 0 L 10 0 L 10 10 Z', fill: '#FF0000', blend: 'screen' },
    { t: 'text', font: 'sans', size: 10, color: '#0000FF', y: 40, glyphs: [{ c: 'A', x: 10 }, { c: 'B', x: 20 }], paint: LIN, opacity: 0.8, blend: 'overlay' },
  ]).svg;
  assert.ok(svg.includes('<path d="M 0 0 L 10 0 L 10 10 Z" fill="#FF0000" style="mix-blend-mode:screen"/>'));
  assert.match(svg, /<text [^>]*fill="url\(#p1-g1\)" opacity="0\.8" style="mix-blend-mode:overlay">AB<\/text>/);
});

test('ClipOp に d があれば path で切り、無ければ従来の rect で切る', () => {
  const svg = gfx([
    { t: 'clip', x: 10, y: 10, w: 40, h: 40, d: 'M 10 10 L 50 10 L 30 50 Z', ops: [{ t: 'path', d: 'M 0 0 L 100 0 L 100 100 Z', fill: '#FF0000' }] },
    { t: 'clip', x: 0, y: 0, w: 40, h: 40, ops: [] },
  ]).svg;
  assert.ok(svg.includes('<clipPath id="p1-c1"><path d="M 10 10 L 50 10 L 30 50 Z"/></clipPath>'));
  assert.ok(svg.includes('<clipPath id="p1-c2"><rect x="0" y="0" width="40" height="40"/></clipPath>'));
  assert.ok(wellFormed(svg));
});

test('読めない色・合成モード・影の値は属性に出さず、勾配は代わりの単色で塗る', () => {
  const svg = gfx([{
    t: 'rect', x: 10, y: 10, w: 80, h: 40, fill: '#0000FF', blend: 'bogus',
    paint: { kind: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ at: 0, color: 'red"><script>' }, { at: 1, color: '#FF0000' }] },
    shadow: { dx: 1, dy: 3, blur: 8, color: 'url(#x)', opacity: 5 },
  }]).svg;
  assert.ok(!svg.includes('<script') && !svg.includes('bogus') && !svg.includes('url(#x)'));
  assert.ok(svg.includes('<rect x="10" y="10" width="80" height="40" fill="#0000FF"/>'));
  assert.ok(wellFormed(svg));
});

test('undefined・NaN・Infinity の数は勾配・影・角丸の属性に出ない', () => {
  const svg = gfx([{
    t: 'rect', x: 10, y: 10, w: 80, h: 40, r: Infinity, fill: '#0000FF',
    paint: { kind: 'radial', cx: NaN, cy: 50, r: 30, stops: [{ at: 0, color: '#FFFFFF' }, { at: 1, color: '#000000' }] },
    shadow: { dx: NaN, dy: 3, blur: 8, color: '#000000', opacity: 0.25 },
  }]).svg;
  assert.ok(!/undefined|NaN|Infinity/.test(svg), svg);
  assert.ok(wellFormed(svg));
});

test('段 2 以上では影の filter を外し、角丸と勾配は残す', () => {
  const ops = Array.from({ length: 3000 }, (_, i) => ({ t: 'rule', x1: 56.7, y1: i % 800, x2: 500, y2: i % 800, w: 0.2, color: '#CCCCC9' }));
  ops.push({ t: 'rect', x: 10, y: 10, w: 80, h: 40, r: 6, fill: '#0000FF', paint: LIN, shadow: SHADOW });
  const info = gfx(ops);
  assert.equal(info.level, 2);
  assert.ok(!info.svg.includes('filter'));
  assert.ok(info.svg.includes('rx="6"') && info.svg.includes('fill="url(#p1-g1)"'));
  assert.ok(wellFormed(info.svg));
});

test('段 3 以上では勾配をやめて op の単色で塗る（defs を出さない）', () => {
  const ops = Array.from({ length: 4000 }, (_, i) => ({ t: 'path', d: `M ${i % 500} 10 L ${i % 300} 90 C 1 2 3 4 5 6 Z`, stroke: '#4A4A4A', lw: 0.5 }));
  ops.push({ t: 'rect', x: 10, y: 10, w: 80, h: 40, fill: '#0000FF', paint: LIN, shadow: SHADOW });
  const info = gfx(ops);
  assert.ok(info.level >= 3, `level ${info.level}`);
  assert.ok(info.chars <= LIMIT);
  assert.ok(!info.svg.includes('Gradient') && !info.svg.includes('<defs>') && !info.svg.includes('filter'));
});

test('勾配と影を何百も持つ頁でも 131,072 字に収まる', () => {
  const ops = Array.from({ length: 700 }, (_, i) => ({
    t: 'rect', x: i % 190, y: (i * 7) % 90, w: 8, h: 6, r: 2, fill: '#0000FF',
    paint: { ...LIN, x1: i, x2: i + 100 }, shadow: { ...SHADOW, dy: 1 + (i % 5) }, blend: 'multiply',
  }));
  const info = gfx(ops);
  assert.ok(info.chars <= LIMIT, `${info.chars} 字`);
  assert.ok(wellFormed(info.svg));
  assert.ok(!/undefined|NaN|Infinity/.test(info.svg));
});

test('勾配・影・角丸は画素を埋め込まない', () => {
  const svg = gfx([{ t: 'rect', x: 10, y: 10, w: 80, h: 40, r: 6, fill: '#0000FF', paint: LIN, shadow: SHADOW }]).svg;
  assert.ok(!svg.includes('base64') && !svg.includes('<image') && !svg.includes('data:'));
});
