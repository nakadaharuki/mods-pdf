// @ts-check
// 他人の PDF を pdf-lib に渡す時の守りと、書き出す前の掃除。入るのはバイト列と pdf-lib の物だけで、何も読み書きしない。
// 入力は Claude の道具の引数で、プロンプトに混ぜられた敵意のある PDF かもしれない。フックは 1 回 10 秒で、タイマーも無い。
// 守る物:
//  0. オブジェクトの間の読めない部分: pdf-lib は 1 字ごとに例外を投げて試すので、4 MiB が読めない字だと 30 秒かかる。
//  1. 圧縮の爆弾: ObjStm と XRef の流れは読み込みの時に必ず展開される（1 MB の PDF で 50 MB 以上・5 秒）。
//  2. 木の爆弾: 頁の木と欄の木は、同じ節を 2 回指す（DAG）だけで道が 2^深さ に増え、getPages・getFields が終わらない。
//  3. 親の輪: /Parent がぐるぐる回ると、継承を辿る再帰が積み上がって落ちる。
//  4. 自動で動く物: JavaScript・開いた時の動作・XFA・外へ出る動作は、書き出す PDF に持ち越さない。
// 選ばなかった案:
//  - vendor の pdf.mjs を書き換える案: build:vendor で作り直される物で、直しが消える。
//  - バイト列を字として走査して ObjStm を探す案: 辞書の中の文字列に "obj" を書かれると辞書の頭を見失い、#xx の名前でも外される。
//    pdf-lib が辞書を読み終えて forStream を呼ぶ所に挟めば、pdf-lib が見る物と同じ物を確かめられる。
//  - pako 相当の展開を自作して上限つきで展開する案: 数えるだけなら出力を持たずに済み、メモリを使わない。
import {
  PDFDict, PDFArray, PDFName, PDFRef, PDFNumber, PDFStream, PDFString, PDFHexString,
  PDFObjectStreamParser, PDFXRefStreamParser, PDFParser,
} from '../vendor/pdf.mjs'

export const LIMITS = Object.freeze({
  /** 入力の大きさ（バイト）。fs の読みが 4 MiB までなので、それを超える物は来ない */
  input: 4 * 1024 * 1024,
  /** 1 つの流れの展開後の大きさ */
  streamOut: 12 * 1024 * 1024,
  /** 1 つの PDF の ObjStm・XRef の展開後の合計。pdf-lib は 10〜20 MiB/s で読むので、2 秒前後に収まる */
  totalOut: 16 * 1024 * 1024,
  /** オブジェクトの間の「読めない部分」を調べる仕事の予算。1 字を読み飛ばすのが 1、数字から始まる所で header を試すのが 200
   *  （pdf-lib は例外を投げて確かめるので 1 回 7〜13 µs。3 万回で 0.4 秒）。実物の PDF の隙間は数バイトで、4 MiB の読めない字でも 1 字 1 なら予算に収まる */
  junk: 6_000_000,
  /** deflate の塊の数。塊ごとに符号表を作り直す仕事が増えるので、細かく刻んだ爆弾を止める */
  blocks: 8192,
  /** オブジェクトの数 */
  objects: 1_000_000,
  /** 頁の木で辿る節の数（同じ頁を何度指しても数える） */
  pageNodes: 100_000,
  /** 木の深さ */
  depth: 32,
  /** 欄の木で辿る節の数 */
  fieldNodes: 20_000,
  /** 末端の欄（と widget）の数。updateFieldAppearances は 1 つ 0.4 ms 前後かかるので、6000 個で 2.6 秒 */
  fields: 6000,
  /** 頁の Annots の長さの合計（共有された配列も頁ごとに数える） */
  annots: 200_000,
  /** XRef の幅 /W の 1 つの上限（仕様の実物は 1〜4） */
  xrefWidth: 8,
})

// ---------------------------------------------------------------------------
// 1. 圧縮の爆弾

const LBASE = Uint16Array.of(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258)
const LEXT = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0)
const DEXT = Uint8Array.of(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13)
const CL_ORDER = Uint8Array.of(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15)

/** 数えるのをやめる印（例外の代わりに値で返すと、深い呼び出しの途中から抜けにくい） */
class Stop {
  /** @param {'bad'|'over'} why */
  constructor(why) { this.why = why }
}

/** @param {number} n */
function newHuffman(n) {
  return { count: new Uint16Array(16), symbol: new Uint16Array(n) }
}

/**
 * 符号の表を作る（zlib の puff.c の construct）。0 なら完全な符号、正なら不完全、負なら過剰
 * @param {{ count: Uint16Array, symbol: Uint16Array }} h
 * @param {Uint8Array} lengths @param {number} off @param {number} n
 */
function construct(h, lengths, off, n) {
  const count = h.count
  count.fill(0)
  for (let s = 0; s < n; s++) count[lengths[off + s]]++
  if (count[0] === n) return 0
  let left = 1
  for (let len = 1; len <= 15; len++) {
    left <<= 1
    left -= count[len]
    if (left < 0) return left
  }
  const offs = new Uint16Array(16)
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len]
  for (let s = 0; s < n; s++) if (lengths[off + s] !== 0) h.symbol[offs[lengths[off + s]]++] = s
  return left
}

/** @type {{ lit: ReturnType<typeof newHuffman>, dist: ReturnType<typeof newHuffman> } | null} */
let fixedTables = null

function fixed() {
  if (fixedTables) return fixedTables
  const lengths = new Uint8Array(288)
  lengths.fill(8, 0, 144)
  lengths.fill(9, 144, 256)
  lengths.fill(7, 256, 280)
  lengths.fill(8, 280, 288)
  const lit = newHuffman(288)
  construct(lit, lengths, 0, 288)
  const dist = newHuffman(30)
  construct(dist, new Uint8Array(30).fill(5), 0, 30)
  fixedTables = { lit, dist }
  return fixedTables
}

/**
 * zlib の流れを展開せずに、展開後の大きさだけ数える（zlib の puff.c の写し。出力を持たない）。
 * 数えるだけなので仕事は入力のビット数に比例し、4 MiB の入力でも 0.2 秒に収まる。
 * 壊れた物・仕様の外の物は -1（pdf-lib が読めるかもしれないが、数えられない物は通さない）。上限を超えたら -2。
 * pdf-lib の展開（pdf.js 由来の FlateStream）は zlib の頭（CMF・FLG）を確かめて deflate を読む。同じ物を数える。
 * @param {Uint8Array} b @param {number} start @param {number} limit
 * @returns {number}
 */
export function inflatedSize(b, start, limit) {
  const end = b.length
  let pos = start
  let bitbuf = 0
  let bitcnt = 0
  let total = 0

  /** @param {number} need */
  const bits = (need) => {
    let val = bitbuf
    while (bitcnt < need) {
      if (pos >= end) throw new Stop('bad')
      val |= b[pos++] << bitcnt
      bitcnt += 8
    }
    bitbuf = val >>> need
    bitcnt -= need
    return val & ((1 << need) - 1)
  }

  /** @param {{ count: Uint16Array, symbol: Uint16Array }} h */
  const decode = (h) => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= 15; len++) {
      code |= bits(1)
      const count = h.count[len]
      if (code - count < first) return h.symbol[index + (code - first)]
      index += count
      first += count
      first <<= 1
      code <<= 1
    }
    throw new Stop('bad')
  }

  /** @param {{ count: Uint16Array, symbol: Uint16Array }} lit @param {{ count: Uint16Array, symbol: Uint16Array }} dist */
  const codes = (lit, dist) => {
    for (;;) {
      let sym = decode(lit)
      if (sym < 256) {
        if (++total > limit) throw new Stop('over')
      } else if (sym === 256) {
        return
      } else {
        sym -= 257
        if (sym >= 29) throw new Stop('bad')
        const len = LBASE[sym] + bits(LEXT[sym])
        const d = decode(dist)
        if (d >= 30) throw new Stop('bad')
        bits(DEXT[d])
        total += len
        if (total > limit) throw new Stop('over')
      }
    }
  }

  try {
    if (end - start < 2) return -1
    const cmf = b[start]
    const flg = b[start + 1]
    // 方式 8（deflate）・窓 32 KiB 以下・頭の検査和・辞書なし。pdf-lib の FlateStream も同じ所で断る
    if ((cmf & 0x0f) !== 8 || (cmf >> 4) > 7 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20)) return -1
    pos = start + 2
    const lengths = new Uint8Array(320)
    const lencode = newHuffman(19)
    const lit = newHuffman(288)
    const dist = newHuffman(30)
    let blocks = 0
    let last
    do {
      last = bits(1)
      const type = bits(2)
      if (++blocks > LIMITS.blocks) return -1
      if (type === 0) {
        bitbuf = 0
        bitcnt = 0
        if (pos + 4 > end) return -1
        const len = b[pos] | (b[pos + 1] << 8)
        const nlen = b[pos + 2] | (b[pos + 3] << 8)
        if (len !== (~nlen & 0xffff)) return -1
        pos += 4
        if (pos + len > end) return -1
        pos += len
        total += len
        if (total > limit) return -2
      } else if (type === 1) {
        const f = fixed()
        codes(f.lit, f.dist)
      } else if (type === 2) {
        const nlen = bits(5) + 257
        const ndist = bits(5) + 1
        const ncode = bits(4) + 4
        if (nlen > 286 || ndist > 30) return -1
        let i = 0
        for (; i < ncode; i++) lengths[CL_ORDER[i]] = bits(3)
        for (; i < 19; i++) lengths[CL_ORDER[i]] = 0
        if (construct(lencode, lengths, 0, 19) !== 0) return -1
        let index = 0
        while (index < nlen + ndist) {
          const sym = decode(lencode)
          if (sym < 16) {
            lengths[index++] = sym
          } else {
            let len = 0
            let rep
            if (sym === 16) {
              if (index === 0) return -1
              len = lengths[index - 1]
              rep = 3 + bits(2)
            } else if (sym === 17) {
              rep = 3 + bits(3)
            } else {
              rep = 11 + bits(7)
            }
            if (index + rep > nlen + ndist) return -1
            while (rep--) lengths[index++] = len
          }
        }
        // 塊の終わりの符号が無い塊は、終われない
        if (lengths[256] === 0) return -1
        let err = construct(lit, lengths, 0, nlen)
        if (err < 0 || (err > 0 && nlen - lit.count[0] !== 1)) return -1
        err = construct(dist, lengths, nlen, ndist)
        if (err < 0 || (err > 0 && ndist - dist.count[0] !== 1)) return -1
        codes(lit, dist)
      } else {
        return -1
      }
    } while (!last)
    return total
  } catch (e) {
    if (e instanceof Stop) return e.why === 'over' ? -2 : -1
    throw e
  }
}

/** 読み込みごとの展開の残り・読み飛ばしの予算・最初に断った理由（同じ文脈の ObjStm と XRef で分け合う）。文脈で引くのは、読み込みが重なっても混ざらないため
 *  @type {WeakMap<object, { left: number, junk: number, error: Error | undefined }>} */
const budgets = new WeakMap()

/**
 * 読み込みの前に呼ぶ。この文脈の展開の合計と、読み飛ばしの仕事に上限を付ける
 * @param {object} context
 */
export function limitLoad(context) {
  budgets.set(context, { left: LIMITS.totalOut, junk: LIMITS.junk, error: undefined })
}

/**
 * 読み込みの後（失敗した時も）に呼ぶ。確かめで断った理由があれば返す。
 * pdf-lib は壊れたオブジェクトを「読めなかった物」として飛ばして先へ進むので（throwOnInvalidObject が偽の時）、
 * forStream で投げただけでは断りが握りつぶされ、ObjStm の中身が黙って消えた PDF が返る。覚えておいて読み込みの後に投げ直す
 * @param {object} context
 */
export function inflateError(context) {
  return budgets.get(context)?.error
}

/** @param {any} dict @param {string} key @returns {number | undefined} */
function numberOf(dict, key) {
  const v = dict.lookup(PDFName.of(key))
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

/**
 * ObjStm と XRef の流れが pdf-lib に展開される前に、展開後の大きさと辞書の数を確かめる。
 * 展開は多段（Filter の配列）で重ねられるので、圧縮は FlateDecode が 1 つの時だけ通す。
 * @param {any} raw PDFRawStream（辞書の読みは済んだ後）
 * @param {boolean} isXRef
 */
function checkStream(raw, isXRef) {
  const budget = budgets.get(raw.dict.context)
  try {
    checkStreamOf(raw, isXRef, budget)
  } catch (e) {
    if (budget && !budget.error) budget.error = /** @type {Error} */ (e)
    throw e
  }
}

/**
 * @param {any} raw @param {boolean} isXRef @param {{ left: number } | undefined} budget
 */
function checkStreamOf(raw, isXRef, budget) {
  const dict = raw.dict
  const what = isXRef ? 'XRef' : 'ObjStm'
  const filter = dict.lookup(PDFName.of('Filter'))
  /** @type {unknown[]} */ let names = []
  if (filter instanceof PDFName) names = [filter]
  else if (filter instanceof PDFArray) for (let i = 0; i < filter.size(); i++) names.push(filter.lookup(i))
  else if (filter !== undefined) throw new Error('PDF の ' + what + ' の圧縮の指定を読めません')
  if (names.length > 1) throw new Error('PDF の ' + what + ' が多重に圧縮されています（圧縮爆弾の疑い）')
  if (names.length === 1) {
    // LZW などは展開が 1000 倍を超えうる。ObjStm と XRef に使う作り手はいないので、数えられない物は通さない
    if (names[0] !== PDFName.of('FlateDecode')) throw new Error('PDF の ' + what + ' の圧縮方式に対応していません')
    const limit = Math.min(LIMITS.streamOut, budget ? budget.left : LIMITS.totalOut)
    const size = inflatedSize(raw.contents, 0, limit)
    if (size === -2) throw new Error('PDF の ' + what + ' が展開すると ' + Math.round(limit / 1048576) + ' MiB を超えます（圧縮爆弾の疑い）')
    if (size < 0) throw new Error('PDF の ' + what + ' の圧縮データを確かめられません')
    if (budget) budget.left -= size
  }
  if (isXRef) {
    // 総数が大きいと、entry ごとに表へ入れる仕事が 17 秒かかる（400 バイトの PDF で。/Index [0 2000000000]）
    const size = numberOf(dict, 'Size')
    if (size !== undefined && size > LIMITS.objects) throw new Error('PDF の XRef の /Size が大きすぎます（' + size + '）')
    const index = dict.lookup(PDFName.of('Index'))
    if (index instanceof PDFArray) {
      let sum = 0
      for (let i = 1; i < index.size(); i += 2) {
        const n = index.lookup(i)
        if (n instanceof PDFNumber) sum += n.asNumber()
      }
      if (sum > LIMITS.objects) throw new Error('PDF の XRef の /Index が大きすぎます（' + sum + '）')
    }
    const w = dict.lookup(PDFName.of('W'))
    if (w instanceof PDFArray) {
      for (let i = 0; i < w.size(); i++) {
        const n = w.lookup(i)
        if (!(n instanceof PDFNumber) || n.asNumber() > LIMITS.xrefWidth) throw new Error('PDF の XRef の幅 /W がおかしい')
      }
    }
  }
}

/**
 * pdf-lib の ObjStm・XRef の読み（forStream）の前に確かめを挟む。何度呼んでも 1 枚だけ（読み直しで二重にかけない）。
 * 読み込みの途中で呼ばれる所は、この 2 つしかない: 頁の中身や画像の流れは、読み込みでは展開されない。
 */
export function installStreamGuards() {
  for (const cls of /** @type {any[]} */ ([PDFObjectStreamParser, PDFXRefStreamParser])) {
    const isXRef = cls === PDFXRefStreamParser
    const base = cls.forStream.original ?? cls.forStream
    /** @this {any} @param {any} raw @param {...any} rest */
    const guarded = function (raw, ...rest) {
      checkStream(raw, isXRef)
      return base.call(this, raw, ...rest)
    }
    guarded.original = base
    cls.forStream = guarded
  }
}

installStreamGuards()

// ---------------------------------------------------------------------------
// 0. オブジェクトの間の読めない部分

/** PDF の空白（NUL・タブ・LF・FF・CR・空白）。pdf-lib の表と同じ */
const SPACE = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) SPACE[c] = 1

/**
 * 空白とコメントを読み飛ばした先が数字か（header「12 0 obj」の始まりになりうるか）。進めた数を tally.n に足す。
 * @param {Uint8Array} arr @param {number} at @param {{ n: number }} tally
 */
function digitAhead(arr, at, tally) {
  const len = arr.length
  let p = at
  for (;;) {
    while (p < len && SPACE[arr[p]]) { p++; tally.n++ }
    if (p < len && arr[p] === 37) {
      while (p < len && arr[p] !== 10 && arr[p] !== 13) { p++; tally.n++ }
      continue
    }
    break
  }
  return p < len && arr[p] >= 48 && arr[p] <= 57
}

/** @param {Uint8Array} arr @param {number} at @param {string} word */
function wordAt(arr, at, word) {
  for (let k = 0; k < word.length; k++) if (arr[at + k] !== word.charCodeAt(k)) return false
  return true
}

/**
 * pdf-lib の skipJibberish の置き換え。オブジェクトの間の読めない部分を次の「xref・trailer・startxref・N G obj」まで読み飛ばす。
 * 元の物は印字できる字ごとに matchIndirectObjectHeader を呼び、これが例外を投げて確かめるので 1 字 7 µs 前後かかる
 * （1 MB の読めない字で 7 秒。壊れた stream の長さで実物の PDF でも起きる）。数字が先に無い所では呼ばない。
 * 呼ぶ回数と進める量は読み込みごとの予算で縛る。予算を超えたら壊れた PDF として断る。
 * @this {any}
 */
function skipJibberishBounded() {
  this.skipWhitespaceAndComments()
  const bs = this.bytes
  const arr = bs.bytes
  const budget = budgets.get(this.context)
  const tally = { n: 0 }
  const limit = budget ? budget.junk : LIMITS.junk
  while (!bs.done()) {
    const at = bs.offset()
    const c = arr[at]
    if (c >= 0x20 && c <= 0x7e) {
      if (wordAt(arr, at, 'xref') || wordAt(arr, at, 'trailer') || wordAt(arr, at, 'startxref')) break
      if (digitAhead(arr, at, tally)) {
        tally.n += 200
        if (this.matchIndirectObjectHeader()) { bs.moveTo(at); break }
      }
    }
    bs.next()
    tally.n++
    if (tally.n > limit) {
      const err = new Error('PDF のオブジェクトの間に、読めない部分が多すぎます（壊れた PDF です）')
      if (budget && !budget.error) budget.error = err
      throw err
    }
  }
  if (budget) budget.junk = limit - tally.n
}

/** pdf-lib の読み込みの隙間の読み飛ばしを、上限つきの物に替える。何度呼んでも 1 枚だけ */
export function installParserGuards() {
  const proto = /** @type {any} */ (PDFParser).prototype
  proto.skipJibberish = skipJibberishBounded
}

installParserGuards()

// ---------------------------------------------------------------------------
// 2・3. 木と親の輪

const KIDS = PDFName.of('Kids')
const PARENT = PDFName.of('Parent')
const ANNOTS = PDFName.of('Annots')

/**
 * 木を歩く。節（Kids の配列を持つ辞書）を 2 度指す物は DAG か輪なので断る。
 * 末端を 2 度指すのは数えるだけで通す（道が増えるのは節の共有で、末端の共有は足し算で済む）。
 * 再帰で歩かない: 深い鎖でも積み上がらない。
 * @param {any} ctx @param {PDFArray | undefined} top 最初の節の子の配列 @param {object} o
 * @param {string} o.what @param {number} o.nodesMax @param {(leaf: any) => void} o.onLeaf
 */
function walkTree(ctx, top, { what, nodesMax, onLeaf }) {
  if (!top) return
  /** @type {Set<unknown>} */ const inner = new Set()
  /** @type {{ kids: PDFArray, i: number }[]} */ const stack = [{ kids: top, i: 0 }]
  let visits = 0
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.i >= frame.kids.size()) { stack.pop(); continue }
    const child = frame.kids.get(frame.i++)
    if (++visits > nodesMax) throw new Error(what + 'が多すぎます（' + nodesMax + ' 個まで）')
    const node = child instanceof PDFRef ? ctx.lookup(child) : child
    if (!(node instanceof PDFDict)) continue
    checkParents(node)
    const kids = node.lookup(KIDS)
    if (kids instanceof PDFArray) {
      if (inner.has(node)) throw new Error(what + 'の木が壊れています（同じ節を 2 度指しています。輪か、枝が増える作りです）')
      inner.add(node)
      if (stack.length >= LIMITS.depth) throw new Error(what + 'の木が深すぎます（' + LIMITS.depth + ' 段まで）')
      stack.push({ kids, i: 0 })
    } else {
      onLeaf(node)
    }
  }
}

/** 親の鎖が輪か、深すぎないか。確かめた節は覚えて、二度辿らない */
const parentOk = new WeakSet()

/** @param {any} node */
function checkParents(node) {
  /** @type {any[]} */ const chain = []
  let cur = node
  while (cur instanceof PDFDict && !parentOk.has(cur)) {
    if (chain.includes(cur)) throw new Error('/Parent が輪になっています（壊れた PDF です）')
    if (chain.length > LIMITS.depth + 2) throw new Error('/Parent の鎖が深すぎます')
    chain.push(cur)
    cur = cur.lookup(PARENT)
  }
  for (const c of chain) parentOk.add(c)
}

/**
 * 読み込み済みの文脈（PDFDocument にする前）で、木と数を確かめる。pdf-lib の getPages・getFields を呼ぶ前に通す
 * @param {any} ctx
 */
export function guardStructure(ctx) {
  const count = ctx.indirectObjects?.size ?? ctx.enumerateIndirectObjects().length
  if (count > LIMITS.objects) throw new Error('PDF のオブジェクトが多すぎます（' + count + ' 個。' + LIMITS.objects + ' 個まで）')
  const root = ctx.lookup(ctx.trailerInfo?.Root)
  if (!(root instanceof PDFDict)) return
  checkParents(root)

  // 頁の木。始まりの節も 1 つの節として数える
  const pages = root.lookup(PDFName.of('Pages'))
  if (pages instanceof PDFDict) {
    checkParents(pages)
    const kids = pages.lookup(KIDS)
    let annots = 0
    if (kids instanceof PDFArray) {
      walkTree(ctx, kids, {
        what: '頁',
        nodesMax: LIMITS.pageNodes,
        onLeaf: (leaf) => {
          const a = leaf.lookup(ANNOTS)
          if (a instanceof PDFArray) annots += a.size()
          if (annots > LIMITS.annots) throw new Error('頁の注釈が多すぎます（合計 ' + LIMITS.annots + ' 個まで）')
        },
      })
    }
  }

  // 欄の木
  const form = root.lookup(PDFName.of('AcroForm'))
  if (form instanceof PDFDict) {
    const fields = form.lookup(PDFName.of('Fields'))
    let terminals = 0
    if (fields instanceof PDFArray) {
      walkTree(ctx, fields, {
        what: '記入欄',
        nodesMax: LIMITS.fieldNodes,
        onLeaf: () => {
          if (++terminals > LIMITS.fields) throw new Error('記入欄が多すぎます（' + LIMITS.fields + ' 個まで。頁を絞るか、欄の少ない PDF にしてください）')
        },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 自動で動く物を外す

/** 動かしてよい動作の URI の頭。javascript: や file: を通さない（許す物を数える） */
const URI_OK = /^(?:https?:|mailto:)/i
/** 動作の種類（/S）のうち、辞書ごと消す物。URI は許す物だけ /A の検査で残し、GoTo は同じ文書の中なので残す */
const DROP_KINDS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'Rendition', 'Movie', 'Sound', 'SetOCGState', 'Hide', 'ResetForm', 'Named', 'Thread', 'GoTo3DView', 'RichMediaExecute'])
/** 注釈のうち、動画・音・3D・埋め込みの動く物。画面に出るだけの注釈は残す */
const ACTIVE_SUBTYPES = new Set(['Screen', 'Movie', 'Sound', 'RichMedia', '3D'])

/** @param {any} v */
const nameOf = (v) => (v instanceof PDFName ? v.decodeText() : '')

/**
 * 動作（/A の辞書）を残してよいか。URI（http・https・mailto）と、同じ文書の中を指す GoTo だけ
 * @param {any} action @param {boolean} keepGoTo
 */
function actionOk(action, keepGoTo) {
  const kind = nameOf(action.lookup(PDFName.of('S')))
  if (kind === 'GoTo') return keepGoTo
  if (kind !== 'URI') return false
  const uri = action.lookup(PDFName.of('URI'))
  if (!(uri instanceof PDFString || uri instanceof PDFHexString)) return false
  try {
    return URI_OK.test(uri.decodeText())
  } catch {
    return false
  }
}

/** @typedef {{ aa: number, open: number, xfa: number, javascript: number, actions: number, links: number, media: number, total: number }} Stripped */

/** @returns {Stripped} */
export const noStripped = () => ({ aa: 0, open: 0, xfa: 0, javascript: 0, actions: 0, links: 0, media: 0, total: 0 })

/**
 * 読み込んだ PDF から、自動で動く物を外す。外した数を返す（字は PDF の物を入れない）。
 * - /AA（開く・閉じる・入力の時の動作。文書・頁・欄・注釈のどこにあっても）
 * - /OpenAction・名前の木の /JavaScript・AcroForm の /XFA（動的フォーム。残すと Acrobat は XFA の方を見て、埋めた欄が出ない）
 * - /A のうち URI（http・https・mailto）と GoTo 以外（JavaScript・Launch・SubmitForm・GoToR・Named など）
 * - 外した動作の辞書と /JS・XFA の流れ（参照だけ外しても、pdf-lib は孤児のオブジェクトも書くので字が残る）
 * - 動画・音・3D・RichMedia の注釈
 * keepGoTo が偽（結合）の時は GoTo と /Dest も外す: 結合で選ばなかった頁へ飛ぶ参照を辿って、元の頁がまるごとコピーされる。
 * @param {any} doc PDFDocument
 * @param {{ keepGoTo: boolean }} o
 * @returns {Stripped}
 */
export function stripActive(doc, { keepGoTo }) {
  const ctx = doc.context
  const AA = PDFName.of('AA')
  const OPEN = PDFName.of('OpenAction')
  const XFA = PDFName.of('XFA')
  const JAVASCRIPT = PDFName.of('JavaScript')
  const A = PDFName.of('A')
  const NEXT = PDFName.of('Next')
  const DEST = PDFName.of('Dest')
  const JS = PDFName.of('JS')
  const n = noStripped()
  /** @type {PDFRef[]} */ const drop = []

  /** 外す値が指す物を、消す対象に足す（配列なら中の参照も。直に書かれた辞書の中の /JS の流れも）
   *  @param {any} v */
  const dropRefs = (v) => {
    /** @type {any[]} */ const todo = [v]
    while (todo.length) {
      const x = todo.pop()
      if (x instanceof PDFRef) drop.push(x)
      else if (x instanceof PDFArray) for (let i = 0; i < x.size(); i++) todo.push(x.get(i))
      else if (x instanceof PDFDict) {
        if (x.has(JS)) todo.push(x.get(JS))
        for (const [, y] of x.entries()) if (y instanceof PDFDict || y instanceof PDFArray) todo.push(y)
      }
    }
  }

  /** @type {unknown[]} */ const stack = []
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    // 動作の辞書そのもの（/S が JavaScript・Launch など）は、どこから指されていても消す
    if (obj instanceof PDFDict && DROP_KINDS.has(nameOf(obj.lookup(PDFName.of('S'))))) {
      drop.push(ref)
      if (obj.has(JS)) dropRefs(obj.get(JS))
      continue
    }
    stack.push(obj)
  }

  const seen = new Set()
  while (stack.length) {
    const cur = stack.pop()
    const dict = cur instanceof PDFStream ? cur.dict : cur
    if (dict instanceof PDFArray) {
      for (let i = 0; i < dict.size(); i++) { const x = dict.get(i); if (!(x instanceof PDFRef)) stack.push(x) }
      continue
    }
    if (!(dict instanceof PDFDict) || seen.has(dict)) continue
    seen.add(dict)

    if (dict.has(AA)) { dropRefs(dict.get(AA)); dict.delete(AA); n.aa++ }
    if (dict.has(OPEN)) { dropRefs(dict.get(OPEN)); dict.delete(OPEN); n.open++ }
    if (dict.has(XFA)) { dropRefs(dict.get(XFA)); dict.delete(XFA); n.xfa++ }
    if (dict.has(JAVASCRIPT)) { dropRefs(dict.get(JAVASCRIPT)); dict.delete(JAVASCRIPT); n.javascript++ }
    if (!keepGoTo && dict.has(DEST)) { dict.delete(DEST); n.links++ }
    if (dict.has(A)) {
      const raw = dict.get(A)
      const action = raw instanceof PDFRef ? ctx.lookup(raw) : raw
      if (action instanceof PDFDict && actionOk(action, keepGoTo)) {
        // 動作の鎖（/Next）は、続きに別の動作をつなげられる
        action.delete(NEXT)
      } else {
        // 結合で外す文書内のリンクは、危ない動作とは分けて数える（答えの文が変わる）
        const goTo = action instanceof PDFDict && nameOf(action.lookup(PDFName.of('S'))) === 'GoTo'
        dropRefs(raw)
        dict.delete(A)
        if (goTo) n.links++
        else n.actions++
      }
    }
    for (const [, v] of dict.entries()) {
      if (v instanceof PDFDict || v instanceof PDFArray || v instanceof PDFStream) stack.push(v)
    }
  }

  // 動く注釈は、頁の Annots から外す
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(ANNOTS)
    if (!(annots instanceof PDFArray)) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i)
      if (a instanceof PDFDict && ACTIVE_SUBTYPES.has(nameOf(a.lookup(PDFName.of('Subtype'))))) {
        dropRefs(annots.get(i))
        annots.remove(i)
        n.media++
      }
    }
  }

  for (const ref of drop) ctx.delete(ref)
  n.total = n.aa + n.open + n.xfa + n.javascript + n.actions + n.links + n.media
  return n
}

/**
 * 外した物の警告文（PDF の字は入れない）。何も外していなければ undefined
 * @param {Stripped} n
 */
export function strippedWarning(n) {
  if (!n.total) return undefined
  const parts = []
  if (n.open) parts.push('開いた時の動作')
  if (n.aa) parts.push('欄・頁の自動の動作（計算・入力の確認など）')
  if (n.javascript) parts.push('JavaScript')
  if (n.actions) parts.push('実行・送信・外部を開く動作')
  if (n.xfa) parts.push('XFA（動的フォーム。AcroForm の欄だけ残します）')
  if (n.links) parts.push('文書内のリンク（結合すると飛び先が変わるため）')
  if (n.media) parts.push('動画・音・3D')
  return '安全のため、PDF の自動で動く物を外しました: ' + parts.join('・')
}

/**
 * PDF の字（欄の名前・値など）を Claude に返す前に切る。見えない字の置き換えは本体（visible）の仕事
 * @param {unknown} s @param {number} max
 */
export function clip(s, max) {
  const t = String(s ?? '')
  if (t.length <= max) return t
  // 切り口が代理対の真ん中になると、対の片割れだけが残って文字化けする
  const cut = /[�-�]/.test(t[max - 1]) ? max - 1 : max
  return t.slice(0, cut) + '…'
}
