// @ts-check
// 組んだ PDF を、紙として正しいかどうか確かめる。
//   node scripts/verify-pdf.mjs <pdf> [入力の json]
// 各項目を ✓（通った）・✗（落ちた）で 1 行ずつ出し、最後に「--- n 通り・m 落ち」。落ちが 1 つでもあれば終了の符号は 1。
// 入力の json が無い項目（往復照合・欄の数・しおりの数など）は － で出し、通り・落ちに数えない。
//
// 選ばなかった案:
// - 字の位置を pdf.js の getTextContent で読む案: 字ごとの位置が取れず、余白の判定ができない。
//   字の読みは lib-pdftext、しおり・メタ・記入欄は pdf.js に任せる。
// - 構造の要素の数を pdf.js の getStructTree で数える案: 頁ごとの木なので、頁をまたぐ段落が二重に数えられる。
//   pdf-lib で StructTreeRoot を直に歩く。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFBool } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readPdfChars, groupLines, inkRight, lastPageFill } from './lib-pdftext.mjs'
import { normalize } from '../hooks/engine/schema.mjs'
import { makeTheme } from '../hooks/engine/theme.mjs'

/** @typedef {{ ok: boolean | null, text: string }} Result ok が null の行は「－」で、通り・落ちに数えない */
/** @typedef {import('../hooks/engine/schema.mjs').Doc} Doc */
/** @typedef {import('../hooks/engine/schema.mjs').Block} Block */

const MIN_SIZE = 7
/** 数の丸めで 6.9999 が落ちないように */
const EPS = 0.01
const FOUR_MIB = 4 * 1024 * 1024
/** 最後の頁がこれより空なら落とす（本人の決まり: 最後の頁が数行だけで終わらない） */
const MIN_LAST_FILL = 0.12
/** 構造の要素（ブロック級）が本文の行の数のこの割合を超えたら「行ごとの要素」とみなして落とす */
const STRUCT_LINE_RATIO = 0.7

const BLOCK_ROLES = new Set(['H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'L', 'Table', 'Figure', 'BlockQuote', 'Note', 'Form', 'Caption', 'TOC'])

/** @param {boolean | null} ok @param {string} text @returns {Result} */
const r = (ok, text) => ({ ok, text })

// ---------------------------------------------------------------- 入力の字

/**
 * Inline の列を字にする。ルビは読みも足す（PDF の中に RT として出るはず）。ルビの読みの区切り（| ｜）は字ではない。
 * @param {any[]} inl
 */
function inlineChars(inl) {
  let s = ''
  for (const it of inl ?? []) {
    s += it.text ?? ''
    if (it.ruby) s += String(it.ruby).replace(/[|｜]/g, '')
  }
  return s
}

/**
 * Doc の本文の字（PDF に出るはずの字）。Markdown の印・JSON の囲みの中身（chart・svg の元）は外す。
 * 題名は題名の塊として出るかが組版しだいなので入れない（Title は別の項目で確かめる）。
 * @param {Doc} doc
 * @returns {string}
 */
export function expectedText(doc) {
  let s = ''
  /** @param {any} item */
  const listItem = (item) => {
    if (Array.isArray(item)) s += inlineChars(item)
    else if (item) {
      s += inlineChars(item.text)
      for (const sub of item.items ?? []) s += inlineChars(sub)
    }
  }
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
      case 'para':
      case 'quote':
        s += inlineChars(b.text)
        break
      case 'list':
        for (const it of b.items) listItem(it)
        break
      case 'table':
        for (const c of b.head) s += inlineChars(c)
        for (const row of b.rows) for (const c of row) s += inlineChars(c)
        break
      case 'keys':
        for (const k of b.items) s += k.label + k.value + (k.note ?? '')
        break
      case 'card':
        s += b.label + inlineChars(b.text)
        break
      case 'fields':
        for (const f of b.items) s += f.label
        break
      case 'chart':
      case 'svg':
      case 'image':
        s += b.caption ?? ''
        break
      default:
        break
    }
  }
  return s
}

/** 空白と制御の字を外した字の数え。サロゲート対は 1 字 @param {string} text @returns {Map<string, number>} */
function countChars(text) {
  /** @type {Map<string, number>} */
  const m = new Map()
  for (const ch of text) {
    if (/[\s\p{Cc}\p{Cf}]/u.test(ch)) continue
    m.set(ch, (m.get(ch) ?? 0) + 1)
  }
  return m
}

// ---------------------------------------------------------------- PDF の中身

/** @param {any} o @returns {string} */
function textOf(o) {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText()
  return ''
}

/**
 * StructTreeRoot を歩いて、構造の要素（/S を持つ辞書）を数える。
 * @param {PDFDocument} doc
 * @returns {{ root: boolean, total: number, block: number, roles: Record<string, number> }}
 */
export function countStructure(doc) {
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'))
  /** @type {Record<string, number>} */
  const roles = {}
  if (!(root instanceof PDFDict)) return { root: false, total: 0, block: 0, roles }
  const seen = new Set()
  let total = 0
  let block = 0
  /** @param {any} node */
  const walk = (node) => {
    if (node instanceof PDFArray) {
      for (let i = 0; i < node.size(); i++) walk(node.lookup(i))
      return
    }
    if (!(node instanceof PDFDict) || seen.has(node)) return
    seen.add(node)
    const s = node.lookup(PDFName.of('S'))
    if (s instanceof PDFName) {
      const role = s.decodeText()
      total++
      roles[role] = (roles[role] ?? 0) + 1
      if (BLOCK_ROLES.has(role)) block++
    }
    walk(node.lookup(PDFName.of('K')))
  }
  walk(root.lookup(PDFName.of('K')))
  return { root: true, total, block, roles }
}

/** @param {any[]} items @returns {number} */
function countOutline(items) {
  let n = 0
  for (const it of items ?? []) n += 1 + countOutline(it.items)
  return n
}

/** 7 ビットでない最初の位置（無ければ -1） @param {Uint8Array} bytes */
function firstHighByte(bytes) {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return i
  return -1
}

/** 一番多い字の大きさ（本文の大きさの見当）。7pt 以上だけ数える @param {import('./lib-pdftext.mjs').PageChars[]} pages */
function modalSize(pages) {
  /** @type {Map<number, number>} */
  const m = new Map()
  for (const pg of pages) for (const c of pg.chars) if (c.size >= MIN_SIZE - 0.5) m.set(Math.round(c.size * 10) / 10, (m.get(Math.round(c.size * 10) / 10) ?? 0) + 1)
  let best = 0
  let size = 0
  for (const [k, v] of m) if (v > best) { best = v; size = k }
  return size
}

const fmt = (/** @type {number} */ v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString()

// ---------------------------------------------------------------- 本体

/**
 * @param {Uint8Array} bytes PDF
 * @param {unknown} [input] make の引数と同じ形の json。あれば版面・往復照合・欄・しおりの数も確かめる
 * @returns {Promise<{ results: Result[], pass: number, fail: number }>}
 */
export async function verifyPdf(bytes, input) {
  /** @type {Result[]} */
  const out = []

  // 入力。おかしければ json 無しとして進める（この道具は組んだ PDF を確かめるのが仕事）
  /** @type {Doc | null} */
  let doc = null
  if (input !== undefined && input !== null) {
    try { doc = normalize(input).doc } catch (e) { out.push(r(false, `入力の json を読めない: ${e instanceof Error ? e.message : e}`)) }
  }
  const theme = doc ? makeTheme({ theme: doc.theme, body: doc.body, paper: doc.paper, landscape: doc.landscape, size: doc.size }) : null

  const { pages, warnings } = await readPdfChars(bytes)
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 })
  const pdfjs = await task.promise
  const W = pages[0]?.width ?? 0
  const body = theme ? theme.size : modalSize(pages)

  // 1. 字の大きさ
  {
    let min = Infinity
    let rubyShort = 0
    /** @type {string[]} */
    const bad = []
    let nBad = 0
    for (const pg of pages) {
      for (const c of pg.chars) {
        if (/\s/.test(c.c)) continue
        // ルビは親字の 0.5 倍が決まり（JLReq）なので、役割 RT の字は 7pt の対象から外す
        if (c.role === 'RT') {
          if (c.size < MIN_SIZE - EPS) rubyShort++
          continue
        }
        if (c.size < min) min = c.size
        if (c.size < MIN_SIZE - EPS) {
          nBad++
          if (bad.length < 3) bad.push(`「${c.c}」${fmt(c.size)}pt（${pg.index + 1} 頁）`)
        }
      }
    }
    const note = rubyShort ? `・ルビ ${rubyShort} 字は 0.5 倍の決まりなので除く` : ''
    if (min === Infinity) out.push(r(false, '字が 1 つも読めなかった'))
    else if (nBad === 0) out.push(r(true, `字の大きさは全部 ${MIN_SIZE}pt 以上（最小 ${fmt(min)}pt${note}）`))
    else out.push(r(false, `${MIN_SIZE}pt 未満の字が ${nBad} 字（最小 ${fmt(min)}pt・例 ${bad.join(' ')}）`))
  }

  // 2. 余白の内側
  {
    let nBad = 0
    /** @type {string[]} */
    const bad = []
    let total = 0
    for (const pg of pages) {
      const left = theme ? theme.left : pg.width * 0.05
      const right = theme ? theme.left + theme.measure : pg.width * 0.95
      for (const c of pg.chars) {
        if (/\s/.test(c.c)) continue
        total++
        const lo = theme ? left - 0.5 * c.size : left
        const hi = theme ? right + 0.05 * c.size : right
        if (c.x < lo - EPS || inkRight(c) > hi + EPS) {
          nBad++
          if (bad.length < 3) bad.push(`「${c.c}」x=${fmt(c.x)}〜${fmt(inkRight(c))}（${pg.index + 1} 頁）`)
        }
      }
    }
    const range = theme
      ? `版面 ${fmt(theme.left)}〜${fmt(theme.left + theme.measure)}pt（左は 0.5em・右は 0.05em まで）`
      : `頁の幅の 5%〜95%（${fmt(W * 0.05)}〜${fmt(W * 0.95)}pt）`
    if (nBad === 0) out.push(r(true, `字は全部 左右の余白の内側（${total} 字・${range}）`))
    else out.push(r(false, `余白にはみ出した字が ${nBad} 字（${range}・例 ${bad.join(' ')}）`))
  }

  // 3. 往復照合
  if (doc) {
    const want = countChars(expectedText(doc))
    const have = countChars(
      pages
        .map((pg) => {
          // 足（フッター）の字は題名と頁数で、本文の字の落ちを隠すので外す
          const footTop = theme ? pg.height - theme.bottom + 1 : Infinity
          return pg.chars.filter((c) => pg.height - c.y <= footTop).map((c) => c.c).join('')
        })
        .join(''),
    )
    /** @type {string[]} */
    const missing = []
    let nMissing = 0
    for (const [ch, n] of want) {
      const lack = n - (have.get(ch) ?? 0)
      if (lack > 0) {
        nMissing += lack
        if (missing.length < 20) missing.push(lack > 1 ? `${ch}×${lack}` : ch)
      }
    }
    const total = [...want.values()].reduce((a, v) => a + v, 0)
    if (nMissing === 0) out.push(r(true, `入力の字が全部 PDF にある（${total} 字）`))
    else out.push(r(false, `入力の字が PDF に足りない（${nMissing} / ${total} 字・足りない字 ${missing.join(' ')}${nMissing > missing.length ? ' ほか' : ''}）`))
  } else out.push(r(null, '入力の字の往復照合は入力の json が無いので省いた'))

  // 4. 言語・題名・タグ
  {
    const lang = textOf(pdfDoc.catalog.lookup(PDFName.of('Lang')))
    const wantLang = doc ? (doc.lang === 'en' ? 'en-US' : 'ja-JP') : null
    if (!lang) out.push(r(false, 'Lang（文書の言語）が無い'))
    else if (wantLang && lang !== wantLang) out.push(r(false, `Lang が ${lang}（入力は ${wantLang}）`))
    else out.push(r(true, `Lang ${lang}`))

    const info = (await pdfjs.getMetadata()).info
    const title = String(/** @type {any} */ (info).Title ?? '')
    const vp = pdfDoc.catalog.lookup(PDFName.of('ViewerPreferences'))
    const dt = vp instanceof PDFDict ? vp.lookup(PDFName.of('DisplayDocTitle')) : undefined
    const shown = dt instanceof PDFBool && dt.asBoolean()
    if (!title) out.push(r(false, 'Title（題名）が無い'))
    else if (doc && title !== doc.title) out.push(r(false, `Title「${title}」が入力の題名「${doc.title}」と違う`))
    else out.push(r(true, `Title「${title}」${shown ? '（タイトルバーに出す）' : '（DisplayDocTitle なし）'}`))
  }

  // 5. 構造
  {
    const st = countStructure(pdfDoc)
    const bodyLines = groupLines(pages, { sizeMin: body - 0.2, sizeMax: body + 0.2 }).length
    const blocks = doc ? doc.blocks.filter((b) => b.type !== 'pagebreak' && b.type !== 'rule').length : null
    if (!st.root) out.push(r(false, 'StructTreeRoot（タグ）が無い'))
    else {
      /** @type {string[]} */
      const why = []
      if (st.total === 0) why.push('要素が 0 個')
      // 入力があればブロックの数を物差しにする（短い段落や表の多い文書では、本文の行の数が物差しにならない）。
      // 入力が無い時は、ブロック級の要素が本文の行の数に迫るのを「行ごとの要素」とみなす
      if (blocks !== null) {
        if (st.block > blocks * 2 + 5) why.push(`ブロックの数 ${blocks} に比べて要素が多すぎる（行ごとの要素か）`)
        else if (blocks >= 1 && st.block < Math.max(1, Math.ceil(blocks * 0.5))) why.push(`ブロックの数 ${blocks} に比べて要素が少なすぎる`)
      } else if (bodyLines >= 8 && st.block >= STRUCT_LINE_RATIO * bodyLines) why.push('ブロック級の要素が本文の行の数に近い（行ごとの要素か）')
      const sum = `構造の要素 ${st.total} 個（ブロック級 ${st.block}・本文の行 ${bodyLines}${blocks !== null ? `・入力のブロック ${blocks}` : ''}）`
      out.push(why.length ? r(false, `${sum}: ${why.join('・')}`) : r(true, `StructTreeRoot あり・${sum}`))
    }
  }

  // 6. しおり
  {
    const outline = await pdfjs.getOutline()
    const n = countOutline(/** @type {any[]} */ (outline ?? []))
    if (doc) {
      const heads = doc.blocks.filter((b) => b.type === 'heading' && b.level <= 3).length
      // 文書の最初の h1 は題名の塊として出るので、しおりは見出しの数か、それより 1 つ多い
      if (heads === 0 && n === 0) out.push(r(true, 'しおり なし（見出しが無い）'))
      else if (n >= heads && n <= heads + 1 && n > 0) out.push(r(true, `しおり ${n} 件（見出し h1〜h3 は ${heads}）`))
      else out.push(r(false, `しおり ${n} 件（見出し h1〜h3 は ${heads}）`))
    } else out.push(n > 0 ? r(true, `しおり ${n} 件`) : r(false, 'しおりが無い'))
  }

  // 7. 記入欄
  {
    /** @type {any[]} */
    const widgets = []
    for (let i = 1; i <= pdfjs.numPages; i++) {
      const page = await pdfjs.getPage(i)
      for (const a of await page.getAnnotations()) if (a.subtype === 'Widget') widgets.push(a)
    }
    const wantFields = doc ? doc.blocks.flatMap((b) => (b.type === 'fields' ? b.items : [])) : null
    if (!wantFields) out.push(r(null, `記入欄 ${widgets.length} 個（入力の json が無いので値は照らさない）`))
    else if (wantFields.length === 0 && widgets.length === 0) out.push(r(true, '記入欄 なし（入力にも無い）'))
    else {
      /** @type {string[]} */
      const bad = []
      if (widgets.length !== wantFields.length) bad.push(`数が違う（PDF ${widgets.length}・入力 ${wantFields.length}）`)
      for (const f of wantFields) {
        const w = widgets.find((x) => x.fieldName === f.name)
        if (!w) { bad.push(`「${f.name}」が無い`); continue }
        if (f.value === undefined) continue
        const v = w.fieldValue
        if (f.kind === 'check') {
          const on = v !== undefined && v !== null && v !== '' && v !== 'Off'
          if (on !== (f.value === true)) bad.push(`「${f.name}」のチェックが ${on ? '入' : '切'}（入力は ${f.value === true ? '入' : '切'}）`)
        } else {
          const got = Array.isArray(v) ? v.join(',') : String(v ?? '')
          if (got !== String(f.value)) bad.push(`「${f.name}」の値が「${got}」（入力は「${f.value}」）`)
        }
      }
      const kinds = widgets.map((w) => w.fieldType + (w.checkBox ? '(check)' : '')).join(' ')
      out.push(bad.length ? r(false, `記入欄: ${bad.join('・')}`) : r(true, `記入欄 ${widgets.length} 個・値も一致（${kinds}）`))
    }
  }

  // 8. 7 ビットと大きさ
  {
    const at = firstHighByte(bytes)
    out.push(at < 0 ? r(true, `全部 7 ビット（${bytes.length} バイト）`) : r(false, `7 ビットでない字がある（${at} バイト目が 0x${bytes[at].toString(16)}）`))
    out.push(bytes.length < FOUR_MIB ? r(true, `4 MiB 未満（${fmt(bytes.length / 1048576)} MiB）`) : r(false, `4 MiB 以上（${fmt(bytes.length / 1048576)} MiB）`))
  }

  // 9. 最後の頁の埋まり
  {
    if (pages.length <= 1) out.push(r(true, '1 頁だけなので最後の頁の埋まりは問わない'))
    else {
      const last = pages[pages.length - 1]
      const fill = lastPageFill(pages, { top: theme ? theme.top : last.height * 0.06, bottom: theme ? theme.bottom : last.height * 0.08, minSize: MIN_SIZE })
      out.push(fill >= MIN_LAST_FILL ? r(true, `最後の頁の埋まり ${fmt(fill)}（${pages.length} 頁）`) : r(false, `最後の頁が ${fmt(fill)} しか埋まっていない（${MIN_LAST_FILL} 未満・数行だけで終わる）`))
    }
  }

  for (const w of warnings) out.push(r(null, `読み取りの注意: ${w}`))
  await task.destroy()
  const pass = out.filter((x) => x.ok === true).length
  const fail = out.filter((x) => x.ok === false).length
  return { results: out, pass, fail }
}

/** @param {Result} x */
export function formatResult(x) {
  return `${x.ok === true ? '✓' : x.ok === false ? '✗' : '－'} ${x.text}`
}

// ---------------------------------------------------------------- コマンド

/**
 * samples/*.json を全部、`OUT=out npm run check` が書いた out/sample-<名前>.pdf と照らす。落ちた項目だけ出して、見本ごとに 1 行にまとめる。
 * 1 本ずつ `node scripts/verify-pdf.mjs out/sample-x.pdf samples/x.json` と打つのを毎回繰り返さないため
 * @param {string} dir PDF の置き場
 * @returns {Promise<number>} 終了の符号
 */
async function verifyAll(dir) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const names = fs.readdirSync(path.join(root, 'samples')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort()
  let bad = 0
  for (const name of names) {
    const pdf = path.resolve(root, dir, `sample-${name}.pdf`)
    if (!fs.existsSync(pdf)) {
      console.log(`✗ ${name}: ${path.relative(root, pdf)} が無い（先に OUT=${dir} npm run check）`)
      bad++
      continue
    }
    const input = JSON.parse(fs.readFileSync(path.join(root, 'samples', `${name}.json`), 'utf8'))
    const { results, pass, fail } = await verifyPdf(new Uint8Array(fs.readFileSync(pdf)), input)
    console.log(`${fail ? '✗' : '✓'} ${name}: ${pass} 通り・${fail} 落ち`)
    for (const x of results) if (x.ok === false) console.log(`    ${formatResult(x)}`)
    if (fail) bad++
  }
  console.log(`--- ${names.length} 本・落ちた見本 ${bad} 本`)
  return bad ? 1 : 0
}

async function main() {
  const [pdfPath, jsonPath] = process.argv.slice(2)
  if (pdfPath === '--all') process.exit(await verifyAll(jsonPath ?? 'out'))
  if (!pdfPath) {
    console.error('使い方: node scripts/verify-pdf.mjs <pdf> [入力の json]（全部の見本は --all [PDF の置き場。既定 out]）')
    process.exit(2)
  }
  const bytes = new Uint8Array(fs.readFileSync(pdfPath))
  const input = jsonPath ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : undefined
  const { results, pass, fail } = await verifyPdf(bytes, input)
  console.log(`${path.basename(pdfPath)}${jsonPath ? `  ←  ${path.basename(jsonPath)}` : ''}`)
  for (const x of results) console.log(formatResult(x))
  console.log(`--- ${pass} 通り・${fail} 落ち`)
  process.exit(fail > 0 ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
