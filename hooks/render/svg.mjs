// @ts-check
// 欄（Pane）に出す 1 頁の SVG。PDF と同じ Display List を読み、欄の中で読める字の SVG にする。
// 字は行（TextOp）ごとに 1 つの <text> にして、字ごとの x を空白でつなぐ。
// 字を 1 字 1 要素にすると、60 行 × 53 字でもう 131,072 字を超えるため。
// xml:space="preserve" は、空白の字が畳まれて x の数と字の数がずれるのを防ぐため。
// import しない（フックの環境で読める形を保つため）。

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** @typedef {{ c: string, x: number }} Glyph */
/** @typedef {{ t: 'text', font: FontId, size: number, color: string, y: number, glyphs: Glyph[], tag?: number, actual?: string }} TextOp */
/** @typedef {{ t: 'rule', x1: number, y1: number, x2: number, y2: number, w: number, color: string, dash?: number[], tag?: number }} RuleOp */
/** @typedef {{ t: 'rect', x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw?: number, tag?: number }} RectOp */
/** @typedef {{ t: 'path', d: string, fill?: string, stroke?: string, lw?: number, opacity?: number, fillRule?: 'nonzero'|'evenodd', cap?: 'butt'|'round'|'square', join?: 'miter'|'round'|'bevel', dash?: number[], tag?: number }} PathOp */
/** @typedef {{ t: 'clip', x: number, y: number, w: number, h: number, ops: Op[] }} ClipOp */
/** @typedef {{ t: 'image', x: number, y: number, w: number, h: number, kind: 'png'|'jpg', base64: string, tag?: number }} ImageOp */
/** @typedef {{ t: 'field', kind: 'text'|'multiline'|'check'|'choice', name: string, x: number, y: number, w: number, h: number, value?: string|boolean, options?: string[], size?: number, tag?: number }} FieldOp */
/** @typedef {{ t: 'link', x: number, y: number, w: number, h: number, url: string }} LinkOp */
/** @typedef {TextOp|RuleOp|RectOp|PathOp|ClipOp|ImageOp|FieldOp|LinkOp} Op */
/** @typedef {{ page?: { width: number, height: number }, pages: { ops: Op[] }[] }} LayoutLike */
/** @typedef {{ id: string, n: number, level: number, digits: number, sketch: boolean, stage: number }} Ctx */

const LIMIT = 131072;
const A4 = [595.28, 841.89];
// 欄の字は書体の名前を並べる。PDF の書体は使えないので、無い時は次の名前を使う。
const MINCHO = "'Zen Old Mincho','Yu Mincho','Hiragino Mincho ProN',serif";
const SANS = "'Noto Sans JP','Yu Gothic','Hiragino Sans',sans-serif";
/** @type {Record<string, string>} */
const FAMILY = { mincho: MINCHO, minchoBold: MINCHO, sans: SANS, sansBold: SANS };
/** @type {Record<string, boolean>} */
const BOLD = { minchoBold: true, sansBold: true };
const INK = '#111111';
const SUB = '#4A4A4A';
const PAPER_RULE = '#D8D8D4';
const FIELD_FRAME = '#8A8A86';
const EMPTY_IMAGE = '#F1F0ED';
const BAR = '#B0B0AC';
const NOTE = '略図（頁が細かすぎるため）';
const COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const BASE64_RE = /^[A-Za-z0-9+\/]*={0,2}$/;
// d は絶対座標の M L C Z と数だけ（design §3.1）。ほかの字が混じった path は描かない。
const PATH_TOKEN = /\s*([MLCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/y;
const LINECAP = ['butt', 'round', 'square'];
const LINEJOIN = ['miter', 'round', 'bevel'];
/** @type {Record<string, string>} */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * 数を小数 digits 桁に丸めて字にする。有限でない数は 0 にする（NaN を字に出さない）。
 * 末尾の .0 は String が消す。-0 は 0 にして "-0" と出さない。
 * @param {unknown} v
 * @param {number} digits
 * @returns {string}
 */
function num(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '0';
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return String(r === 0 ? 0 : r);
}

/** @param {unknown} v */
function finite0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// 線の太さは整数にしない（0.4pt が 0 になって消えるのを防ぐ）。
/** @param {unknown} v */
function strokeW(v) {
  return num(typeof v === 'number' && Number.isFinite(v) ? Math.max(0.1, v) : 0.5, 1);
}

// 色は #rgb・#rrggbb・none だけを通す。字を XML の属性に入れる前の検査も兼ねる。
/** @param {unknown} c @param {string} fallback */
function paint(c, fallback) {
  return typeof c === 'string' && (c === 'none' || COLOR_RE.test(c)) ? c : fallback;
}

/** @param {unknown} o @param {unknown} k */
function hasOwn(o, k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
}

/** @param {string} s */
function esc(s) {
  return s.replace(/[&<>"']/g, (ch) => ESC[ch]);
}

/**
 * 字 1 つを XML の字にする。XML で許されない制御の字と、ひとりの代理の字は空白にする。
 * 空白にするのは、字の数（x の数）を変えないため。消すと後ろの字がずれる。
 * @param {unknown} c
 */
function glyphText(c) {
  if (typeof c !== 'string' || c.length === 0) return ' ';
  let s = '';
  for (const ch of c) {
    const cp = ch.codePointAt(0) || 0;
    const ok = (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
    s += ok ? ch : ' ';
  }
  return esc(s);
}

/** 字の送り幅の見積もり（欄の字の x を作るため。PDF の字幅とは一致しない）。全角は 1 字分。 */
/** @param {string} ch @param {number} size */
function advance(ch, size) {
  return (ch.codePointAt(0) || 0) >= 0x2E80 ? size : size * 0.5;
}

/**
 * パスの d を、M L C Z と 1 桁（またはその桁）の数だけにし直す。
 * 知らない字が 1 つでもあれば null（その path は描かない）。
 * @param {unknown} d
 * @param {number} digits
 * @returns {string|null}
 */
function cleanPath(d, digits) {
  if (typeof d !== 'string') return null;
  /** @type {string[]} */
  const out = [];
  let pos = 0;
  while (pos < d.length) {
    PATH_TOKEN.lastIndex = pos;
    const m = PATH_TOKEN.exec(d);
    if (m === null) return /^\s*$/.test(d.slice(pos)) ? out.join(' ') : null;
    pos = PATH_TOKEN.lastIndex;
    const t = m[1];
    if (t === 'M' || t === 'L' || t === 'C' || t === 'Z') {
      out.push(t);
    } else {
      const v = Number(t);
      if (!Number.isFinite(v)) return null;
      out.push(num(v, digits));
    }
  }
  return out.join(' ');
}

/** @param {number[]|undefined} dash */
function dashAttr(dash) {
  if (!Array.isArray(dash) || dash.length === 0) return '';
  if (!dash.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return '';
  return ` stroke-dasharray="${dash.map((v) => num(v, 1)).join(' ')}"`;
}

/**
 * 字の行（TextOp）を 1 つの <text> にする。x は字ごとに空白でつなぐ。
 * @param {TextOp} op
 * @param {Ctx} ctx
 */
function textEl(op, ctx) {
  const gs = Array.isArray(op.glyphs) ? op.glyphs : [];
  if (gs.length === 0) return '';
  let content = '';
  let xs = '';
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    content += glyphText(g ? g.c : undefined);
    xs += (i === 0 ? '' : ' ') + num(g ? g.x : NaN, ctx.digits);
  }
  const family = hasOwn(FAMILY, op.font) ? FAMILY[op.font] : MINCHO;
  const weight = hasOwn(BOLD, op.font) ? ' font-weight="700"' : '';
  return `<text xml:space="preserve" x="${xs}" y="${num(op.y, ctx.digits)}" font-family="${family}" font-size="${num(op.size, 1)}" fill="${paint(op.color, INK)}"${weight}>${content}</text>`;
}

/** 灰の細い四角。略図で字の行と欄の字の代わりにする。 */
/** @param {number} x @param {number} baseline @param {number} size @param {number} width @param {number} digits */
function barEl(x, baseline, size, width, digits) {
  const w = Math.max(width, size * 0.5);
  return `<rect x="${num(x, digits)}" y="${num(baseline - size * 0.62, digits)}" width="${num(w, digits)}" height="${num(size * 0.4, digits)}" fill="${BAR}"/>`;
}

/** @param {TextOp} op @param {Ctx} ctx */
function textBar(op, ctx) {
  const gs = Array.isArray(op.glyphs) ? op.glyphs : [];
  if (gs.length === 0) return '';
  const first = finite0(gs[0] ? gs[0].x : 0);
  const last = finite0(gs[gs.length - 1] ? gs[gs.length - 1].x : first);
  return barEl(first, finite0(op.y), finite0(op.size), last - first + finite0(op.size) * 0.9, ctx.digits);
}

/** @param {RuleOp} op @param {Ctx} ctx */
function ruleEl(op, ctx) {
  // 太さ 0.3 未満の罫は 2 段目から間引く（頁が細かい時の逃がし）。
  if (ctx.level >= 2 && op.w < 0.3) return '';
  return `<line x1="${num(op.x1, ctx.digits)}" y1="${num(op.y1, ctx.digits)}" x2="${num(op.x2, ctx.digits)}" y2="${num(op.y2, ctx.digits)}" stroke="${paint(op.color, INK)}" stroke-width="${strokeW(op.w)}"${dashAttr(op.dash)}/>`;
}

/** @param {RectOp} op @param {Ctx} ctx */
function rectEl(op, ctx) {
  // 枠だけの四角（fill が無い）は 2 段目から間引く。
  if (ctx.level >= 2 && op.fill === undefined) return '';
  const fill = op.fill === undefined ? 'none' : paint(op.fill, 'none');
  let stroke = '';
  if (op.stroke !== undefined) {
    stroke = ` stroke="${paint(op.stroke, INK)}"`;
    if (op.lw !== undefined) stroke += ` stroke-width="${strokeW(op.lw)}"`;
  }
  return `<rect x="${num(op.x, ctx.digits)}" y="${num(op.y, ctx.digits)}" width="${num(op.w, ctx.digits)}" height="${num(op.h, ctx.digits)}" fill="${fill}"${stroke}/>`;
}

/** @param {PathOp} op @param {Ctx} ctx */
function pathEl(op, ctx) {
  const frame = op.fill === undefined || op.fill === 'none';
  // 3 段目で線だけの path（チャートの細い線）を外す。間引く代わりに全部外すのは、
  // 一本おきに残すと数千本の頁で 131,072 字に届かず、結局略図になるため。
  if (ctx.level >= 3 && frame) return '';
  const d = cleanPath(op.d, ctx.digits);
  if (d === null || d.length === 0) return '';
  let s = `<path d="${d}" fill="${op.fill === undefined ? 'none' : paint(op.fill, 'none')}"`;
  if (op.stroke !== undefined) {
    s += ` stroke="${paint(op.stroke, INK)}"`;
    if (op.lw !== undefined) s += ` stroke-width="${strokeW(op.lw)}"`;
  }
  if (typeof op.opacity === 'number' && Number.isFinite(op.opacity) && op.opacity < 1) {
    s += ` opacity="${num(op.opacity, 2)}"`;
  }
  if (op.fillRule === 'evenodd') s += ' fill-rule="evenodd"';
  if (op.cap !== undefined && LINECAP.includes(op.cap)) s += ` stroke-linecap="${op.cap}"`;
  if (op.join !== undefined && LINEJOIN.includes(op.join)) s += ` stroke-linejoin="${op.join}"`;
  return `${s}${dashAttr(op.dash)}/>`;
}

/** @param {ClipOp} op @param {Ctx} ctx */
function clipEl(op, ctx) {
  ctx.n += 1;
  const cid = `${ctx.id}-c${ctx.n}`;
  const inner = bodyOf(op.ops, ctx);
  return `<clipPath id="${cid}"><rect x="${num(op.x, ctx.digits)}" y="${num(op.y, ctx.digits)}" width="${num(op.w, ctx.digits)}" height="${num(op.h, ctx.digits)}"/></clipPath><g clip-path="url(#${cid})">${inner}</g>`;
}

/** @param {ImageOp} op @param {Ctx} ctx */
function imageEl(op, ctx) {
  const box = `x="${num(op.x, ctx.digits)}" y="${num(op.y, ctx.digits)}" width="${num(op.w, ctx.digits)}" height="${num(op.h, ctx.digits)}"`;
  const b = op.base64;
  // 40,000 字未満の小さい画像だけ埋め込む。大きい物は欄の字数を食うので灰の四角にする。
  const embed = !ctx.sketch && typeof b === 'string' && b.length > 0 && b.length < 40000 && BASE64_RE.test(b);
  if (embed) {
    const mime = op.kind === 'jpg' ? 'image/jpeg' : 'image/png';
    return `<image ${box} href="data:${mime};base64,${b}"/>`;
  }
  if (ctx.stage >= 2) return '';
  return `<rect ${box} fill="${EMPTY_IMAGE}"/>`;
}

/** 欄の字は書体の sans。1 字ずつの x を作る（字の送りは見積もり）。 */
/** @param {string} text @param {number} x0 @param {number} baseline @param {number} size @param {number} digits */
function sansRun(text, x0, baseline, size, digits) {
  let xs = '';
  let content = '';
  let x = x0;
  for (const ch of text) {
    xs += (xs.length === 0 ? '' : ' ') + num(x, digits);
    content += glyphText(ch);
    x += advance(ch, size);
  }
  return `<text xml:space="preserve" x="${xs}" y="${num(baseline, digits)}" font-family="${SANS}" font-size="${num(size, 1)}" fill="${INK}">${content}</text>`;
}

/** @param {FieldOp} op @param {Ctx} ctx */
function fieldEl(op, ctx) {
  if (ctx.stage >= 2) return '';
  const frame = `<rect x="${num(op.x, ctx.digits)}" y="${num(op.y, ctx.digits)}" width="${num(op.w, ctx.digits)}" height="${num(op.h, ctx.digits)}" fill="none" stroke="${FIELD_FRAME}" stroke-width="0.6"/>`;
  if (op.kind === 'check') {
    if (op.value !== true) return frame;
    const p = (/** @type {number} */ fx, /** @type {number} */ fy) =>
      `${num(op.x + op.w * fx, ctx.digits)} ${num(op.y + op.h * fy, ctx.digits)}`;
    return `${frame}<path d="M ${p(0.2, 0.5)} L ${p(0.42, 0.74)} L ${p(0.8, 0.26)}" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (typeof op.value !== 'string' || op.value.length === 0) return frame;
  const size = typeof op.size === 'number' && Number.isFinite(op.size) && op.size > 0 ? op.size : 10;
  const multi = op.kind === 'multiline';
  const lines = multi ? op.value.split(/\r?\n/) : [op.value.replace(/[\r\n]+/g, ' ')];
  let s = frame;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const baseline = multi ? op.y + 2 + size * (0.85 + 1.4 * i) : op.y + op.h / 2 + size * 0.35;
    const x0 = op.x + 2;
    if (ctx.sketch) {
      let width = 0;
      for (const ch of line) width += advance(ch, size);
      s += barEl(x0, baseline, size, width, ctx.digits);
    } else {
      s += sansRun(line, x0, baseline, size, ctx.digits);
    }
  }
  return s;
}

/** @param {Op} op @param {Ctx} ctx @returns {string} */
function opSvg(op, ctx) {
  if (!op || typeof op !== 'object') return '';
  switch (op.t) {
    case 'text':
      if (!ctx.sketch) return textEl(op, ctx);
      return ctx.stage >= 2 ? '' : textBar(op, ctx);
    case 'rule':
      return ctx.stage >= 1 ? '' : ruleEl(op, ctx);
    case 'rect':
      return ctx.stage >= 1 ? '' : rectEl(op, ctx);
    case 'path':
      if (ctx.sketch || ctx.stage >= 2) return '';
      return pathEl(op, ctx);
    case 'clip':
      return ctx.stage >= 2 ? '' : clipEl(op, ctx);
    case 'image':
      return imageEl(op, ctx);
    case 'field':
      return fieldEl(op, ctx);
    default:
      // LinkOp は欄に描かない（クリックできる欄ではない）。知らない物も描かない。
      return '';
  }
}

/** @param {Op[]} ops @param {Ctx} ctx */
function bodyOf(ops, ctx) {
  if (!Array.isArray(ops)) return '';
  let s = '';
  for (const op of ops) s += opSvg(op, ctx);
  return s;
}

/** @param {[number, number]} size @param {string} body */
function wrap(size, body) {
  const w = size[0];
  const h = size[1];
  // 白い紙を先に描く。枠の線は紙の内側に入れて、viewBox の端で切れないようにする。
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(w, 1)} ${num(h, 1)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="0.25" y="0.25" width="${num(w - 0.5, 1)}" height="${num(h - 0.5, 1)}" fill="#FFFFFF" stroke="${PAPER_RULE}" stroke-width="0.5"/>` +
    `${body}</svg>`;
}

/** 略図の注記（右上）。字ごとの x を付ける（字の数と x の数を揃えるため）。 */
/** @param {number} w */
function noteEl(w) {
  const size = 8;
  const chars = Array.from(NOTE);
  const x0 = w - 12 - size * chars.length;
  let xs = '';
  for (let i = 0; i < chars.length; i++) xs += (i === 0 ? '' : ' ') + num(x0 + size * i, 0);
  return `<text xml:space="preserve" x="${xs}" y="16" font-family="${SANS}" font-size="${num(size, 1)}" fill="${SUB}">${esc(NOTE)}</text>`;
}

/** @param {unknown} v */
function positive(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** @param {LayoutLike} layout */
function pageSize(layout) {
  const p = layout ? layout.page : undefined;
  if (p && positive(p.width) && positive(p.height)) return /** @type {[number, number]} */ ([p.width, p.height]);
  return /** @type {[number, number]} */ ([A4[0], A4[1]]);
}

/** 頁の描く物の列。範囲の外（負・大きすぎ・整数でない・pages が無い）なら null。 */
/** @param {LayoutLike} layout @param {number} pageIndex */
function pageOps(layout, pageIndex) {
  const pages = layout && Array.isArray(layout.pages) ? layout.pages : null;
  if (!pages || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) return null;
  const page = pages[pageIndex];
  return page && Array.isArray(page.ops) ? page.ops : [];
}

/** id は SVG の中で使うので、英数字・_・- だけにする（url(#…) の中に特別な字を入れないため）。 */
/** @param {unknown} v */
function safeId(v) {
  const s = typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '_') : '';
  return s.length > 0 ? s : 'mp';
}

/**
 * @param {string} id
 * @param {number} level
 * @param {number} stage 略図の中の段（0 は全部、1 は罫と枠を外す、2 は紙と注記だけ）
 * @returns {Ctx}
 */
function newCtx(id, level, stage) {
  return { id, n: 0, level, digits: level >= 1 ? 0 : 1, sketch: level >= 4, stage };
}

/**
 * Layout の 1 頁を欄の SVG にする。
 * opts.width・opts.height は使わない（欄の大きさは width・height の 100% に任せ、頁の大きさは layout.page から取る）。
 * @param {LayoutLike} layout
 * @param {number} pageIndex
 * @param {{ width?: number, height?: number, id: string }} opts
 * @returns {{ svg: string, level: number, chars: number }}
 */
export function pageSvgInfo(layout, pageIndex, opts) {
  const id = safeId(opts ? opts.id : undefined);
  const size = pageSize(layout);
  const ops = pageOps(layout, pageIndex);
  if (ops === null) {
    const svg = wrap(size, '');
    return { svg, level: 0, chars: svg.length };
  }
  // 段は順に上げる。段の 0 から 3 は、直前の段の処理を全部含む（同じ数の丸めを残す）。
  for (let level = 0; level <= 3; level++) {
    const svg = wrap(size, bodyOf(ops, newCtx(id, level, 0)));
    if (svg.length <= LIMIT) return { svg, level, chars: svg.length };
  }
  // 段 4 は略図。字を灰の四角にし、紙と注記で収まらないなら罫と枠を外す。
  for (let stage = 0; stage < 2; stage++) {
    const svg = wrap(size, bodyOf(ops, newCtx(id, 4, stage)) + noteEl(size[0]));
    if (svg.length <= LIMIT) return { svg, level: 4, chars: svg.length };
  }
  const svg = wrap(size, noteEl(size[0]));
  return { svg, level: 4, chars: svg.length };
}

/**
 * Layout の 1 頁を、欄に出す SVG の字にする（131,072 字まで）。
 * @param {LayoutLike} layout
 * @param {number} pageIndex
 * @param {{ width?: number, height?: number, id: string }} opts
 * @returns {string}
 */
export function pageSvg(layout, pageIndex, opts) {
  return pageSvgInfo(layout, pageIndex, opts).svg;
}
