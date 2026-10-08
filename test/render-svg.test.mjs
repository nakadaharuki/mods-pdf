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
  assert.match(svg, /<text xml:space="preserve" x="[^"]*" y="100" font-family="'Zen Old Mincho'/);
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
