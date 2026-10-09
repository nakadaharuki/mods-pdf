// @ts-check
// render/meta: PDF に添える物。元の原稿・数字の入口・話す人の覚え(EmbeddedFiles と /AF)と、XMP の metadata。
// 資料を PDF だけで受け取った人(と Claude)が、原稿とグラフの元の数字をそのまま取り出して直せるようにする。
// PDF/A などの準拠は名乗らない(検査器の veraPDF が無い)。pdf.mjs が呼ぶ。`$` は知らない。
//
// 選ばなかった案
// - 添える物を renderPdf の引数にして host が組み立てる案: bizplan の数字(datasets)は normalize の中で作られ、host も layout も
//   持っていない。host の source(make の入力そのもの)を normalize し直せば、make でも revise でも同じ物が取れる(同じ入力は同じ doc になる)。
//   render が engine/schema を読む向きの依存は増えるが、compose が doc を返すようになれば外せる。
// - CSV を LF・BOM なしにする案: 表計算(Excel)は BOM が無い UTF-8 の CSV を ANSI と読んで日本語が化ける。RFC 4180 の CRLF に合わせる。
//   BOM を嫌う読み手(素の UTF-8 で読むスクリプト)は先頭の 1 字を捨てれば足りるが、化けた日本語は取り戻せない。
// - 全部の dataset を CSV にする案: 階層(root)・流れ(nodes と links)・点の組は 1 枚の表にならない。表にできる 2 つの形
//   (x と並んだ列・同じ形の行の配列)だけ CSV にして、残りは JSON だけにする。
// - 名前に日本語を使う案: F は PDFString で ASCII しか書けず、UF だけ日本語にしても受け手の保存先で化ける。名前は ASCII にして、日本語は説明(Desc)に置く。
import { PDFName, AFRelationship } from '../vendor/pdf.mjs'
import { normalize } from '../engine/schema.mjs'

/** @typedef {{ name: string, bytes: Uint8Array, mime: string, rel: 'Source' | 'Data' | 'Supplement', desc: string }} AttachFile */
/** @typedef {{ attach: boolean, files: AttachFile[], warnings: string[] }} AttachPlan */
/** @typedef {{ title?: string, author?: string, subject?: string, lang?: string, created?: number }} Meta */

/** Info の /Creator と /Producer と同じ字(XMP と食い違わないよう、pdf.mjs もここから読む) */
export const CREATOR_TOOL = 'ModsPDF'
export const PRODUCER = 'ModsPDF (pdf-lib 1.17.1)'

/** 元の原稿(make の入力を JSON にした字)をこの字数より大きい時は入れない。host が store に残す上限と同じ */
export const SOURCE_JSON_MAX = 200000
/** 添える物の元のバイト数の合計。JSON と CSV は flate で 1/3 ほどになり、ASCII85 で 1.27 倍になる。PDF 全体の 4 MiB の上限は renderPdf が最後に確かめる */
export const ATTACH_RAW_MAX = 2 * 1024 * 1024
const CSV_ROWS_MAX = 50000
const CSV_COLS_MAX = 100
const CSV_TABLES_MAX = 4

const enc = new TextEncoder()
/** 外の領域の TextEncoder の答えを、この束の領域の Uint8Array に写す(pdf-lib は instanceof で見て、別の領域の物を字として読んで落ちる) */
const bytesOf = (/** @type {string} */ s) => new Uint8Array(enc.encode(s))

const isScalar = (/** @type {unknown} */ v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const isPlain = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ---- CSV ----

/** 数として読める字は、式と間違えられない */
const NUMBERISH = /^[-+]?\d[\d,]*(?:\.\d+)?%?$/

/**
 * CSV の 1 つのセル。表計算で式として動く先頭の字(= + - @ とタブ・復帰)は ' を前に付けて字にする(CSV インジェクション。OWASP の対策)
 * @param {unknown} v
 */
function cell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s) && !NUMBERISH.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 見出しが重なったら _2 _3 を付ける @param {string[]} names */
function uniqueHeads(names) {
  const seen = new Map()
  return names.map((n) => {
    const c = (seen.get(n) ?? 0) + 1
    seen.set(n, c)
    return c === 1 ? n : `${n}_${c}`
  })
}

/** 数の列(数か null だけで、数が 1 つはある) @param {unknown} v */
const isNumbers = (v) => Array.isArray(v) && v.length > 0 && v.every((n) => n === null || typeof n === 'number') && v.some((n) => typeof n === 'number')

/**
 * data から表にできる物を取る。表にできるのは次の 2 つの形だけ(ほかは JSON だけ)
 * - x か axes(字か数の配列)と、同じ長さの数の列(revenue・cost など)・series[{ name, values }]・ohlc[[始値, 高値, 安値, 終値]]。数の列が 1 つも無ければ表にしない
 *   (2 軸の図の x: [低, 高] と y: [低, 高] は、軸の名前であって 1 つの表ではない)
 * - 同じ形の行の配列(items・rows・tasks・links など)。配列ごとに 1 つの表。字や数でない項目は表に入れない(JSON には残る)
 * @param {unknown} data
 * @returns {{ key: string, head: string[], rows: unknown[][] }[]} key は表の元の欄の名前(x の表は '')
 */
export function tablesOf(data) {
  if (!isPlain(data)) return []
  const d = /** @type {Record<string, any>} */ (data)
  /** @type {{ key: string, head: string[], rows: unknown[][] }[]} */
  const out = []

  // 行の見出しになる列: 時系列などの x、radar などの axes
  const labelKey = ['x', 'axes'].find((k) => Array.isArray(d[k]) && d[k].length > 0 && d[k].length <= CSV_ROWS_MAX && d[k].every(isScalar))
  if (labelKey) {
    const labels = /** @type {unknown[]} */ (d[labelKey])
    const n = labels.length
    /** @type {{ name: string, values: unknown[] }[]} */
    const cols = []
    for (const [k, v] of Object.entries(d)) {
      if (k !== labelKey && k !== 'series' && k !== 'ohlc' && isNumbers(v) && /** @type {unknown[]} */ (v).length === n) cols.push({ name: k, values: /** @type {unknown[]} */ (v) })
    }
    if (Array.isArray(d.series)) {
      d.series.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
        if (isPlain(s) && isNumbers(s.values) && s.values.length === n) cols.push({ name: typeof s.name === 'string' && s.name ? s.name : `series${i + 1}`, values: s.values })
      })
    }
    if (Array.isArray(d.ohlc) && d.ohlc.length === n && d.ohlc.every((/** @type {any} */ r) => isNumbers(r) && r.length === 4)) {
      ;['open', 'high', 'low', 'close'].forEach((name, j) => cols.push({ name, values: d.ohlc.map((/** @type {any} */ r) => r[j]) }))
    }
    if (cols.length > 0 && cols.length < CSV_COLS_MAX) {
      out.push({ key: '', head: uniqueHeads([labelKey, ...cols.map((c) => c.name)]), rows: labels.map((v, i) => [v, ...cols.map((c) => c.values[i])]) })
    }
  }

  for (const [key, v] of Object.entries(d)) {
    // series と ohlc は上の表で扱った。{ name, values: [...] } の行は名前だけの表になって意味が無い
    if (key === 'series' || key === 'ohlc' || !Array.isArray(v) || v.length === 0 || v.length > CSV_ROWS_MAX || !v.every(isPlain)) continue
    /** @type {string[]} */
    const keys = []
    let nested = false
    for (const r of v) {
      for (const [k, val] of Object.entries(r)) {
        if (!isScalar(val)) nested = true
        else if (!keys.includes(k) && keys.length < CSV_COLS_MAX) keys.push(k)
      }
    }
    // 字や数でない項目を持つ行は、字や数の列が 2 つ以上ある時だけ表にする(groups: [{ name, values: [...] }] を名前だけの 1 列にしない)
    if (keys.length >= (nested ? 2 : 1)) out.push({ key, head: keys, rows: v.map((r) => keys.map((k) => (isScalar(r[k]) ? r[k] : null))) })
  }
  return out.slice(0, CSV_TABLES_MAX)
}

/** 先頭の BOM(U+FEFF)。ソースに字のまま書くと見えなくなるので、コードで作る */
const BOM = String.fromCharCode(0xfeff)

/**
 * 表を CSV の字にする。先頭に BOM、行の区切りは CRLF
 * @param {{ head: string[], rows: unknown[][] }} t
 */
export function csvText(t) {
  const lines = [t.head.map(cell).join(','), ...t.rows.map((r) => r.map(cell).join(','))]
  return `${BOM}${lines.join('\r\n')}\r\n`
}

// ---- 話す人の覚え ----

/** 題の字から、Markdown の印(** と {親字|るび})と改行を取る @param {unknown} s */
const plain = (s) => String(s ?? '').replace(/\{([^|｜}]+)[|｜][^}]*\}/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)

/**
 * 資料の各枚の notes を 1 つの Markdown にする(notes が 1 枚も無ければ null)
 * @param {{ title: string, lang?: string, slides?: any[] }} doc
 * @returns {string | null}
 */
export function notesMarkdown(doc) {
  const slides = Array.isArray(doc.slides) ? doc.slides : []
  const en = doc.lang === 'en'
  const out = [`# ${plain(doc.title)}${en ? ' - speaker notes' : '（話す人の覚え）'}`, '']
  let any = false
  slides.forEach((s, i) => {
    const text = typeof s?.notes === 'string' ? s.notes.trim() : ''
    if (!text) return
    any = true
    out.push(`## ${i + 1}. ${plain(s.title || s.quote || s.lead) || String(s.layout ?? '')}`, '', text, '')
  })
  return any ? out.join('\n') : null
}

// ---- 添える物の計画 ----

/** F(ファイル名)は ASCII だけ。使えない字は _ にまとめ、頭と尻の _ と . を取る。何も残らなければ fallback @param {string} id @param {string} fallback */
function safeStem(id, fallback) {
  const s = String(id).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 40)
  return s || fallback
}

const byName = (/** @type {AttachFile} */ a, /** @type {AttachFile} */ b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/**
 * make の入力から、PDF に添える物を決める。入力を normalize し直して、attach・datasets・slides の notes を読む
 * (bizplan の数字の入口は normalize の中で作られる)。attach が false なら何も添えず attach: false を返す。
 * 優先は 元の原稿 → 数字の入口の JSON → 話す人の覚え → CSV。合計が ATTACH_RAW_MAX を超える分は後ろから入れず、warnings に書く。
 * @param {unknown} source make の入力
 * @param {{ lang?: string }} [o] lang は説明の言語(ja-JP か en-US。省けば入力の lang)
 * @returns {AttachPlan}
 */
export function planAttachments(source, o = {}) {
  /** @type {string[]} */
  const warnings = []
  /** @type {any} */
  let doc
  try {
    doc = normalize(source).doc
  } catch (e) {
    return { attach: false, files: [], warnings: [`原稿を読み直せなかったので、元の原稿と数字を添付しなかった: ${e instanceof Error ? e.message : String(e)}`] }
  }
  if (!doc.attach) return { attach: false, files: [], warnings }
  const en = typeof o.lang === 'string' ? o.lang.toLowerCase().startsWith('en') : doc.lang === 'en'

  /** @type {AttachFile[]} */
  const first = []
  /** @type {AttachFile[]} */
  const csvs = []

  try {
    const compact = JSON.stringify(source)
    if (compact.length > SOURCE_JSON_MAX) warnings.push(`元の原稿が ${SOURCE_JSON_MAX} 字を超えるので、添付しなかった`)
    else first.push({ name: 'source.json', bytes: bytesOf(JSON.stringify(source, null, 2)), mime: 'application/json', rel: 'Source', desc: en ? 'Source manuscript (input of make, JSON)' : '元の原稿（make の入力・JSON）' })
  } catch {
    warnings.push('元の原稿を JSON にできなかったので、添付しなかった')
  }

  // 名前は全部で重ならない(重なったら -2 -3 を付ける)。source.json と notes.md は先に取っておく
  const taken = new Set(['source.json', 'notes.md'])
  const claim = (/** @type {string} */ stem, /** @type {string} */ ext) => {
    let name = `${stem}.${ext}`
    for (let k = 2; taken.has(name); k++) name = `${stem}-${k}.${ext}`
    taken.add(name)
    return name
  }
  Object.entries(doc.datasets ?? {}).forEach(([id, entry], i) => {
    const e = /** @type {any} */ (entry)
    const stem = `data-${safeStem(id, `d${i + 1}`)}`
    const label = plain(id)
    const body = { id, ...(e.source ? { source: e.source } : {}), ...(e.asOf ? { asOf: e.asOf } : {}), data: e.data }
    first.push({ name: claim(stem, 'json'), bytes: bytesOf(JSON.stringify(body, null, 2)), mime: 'application/json', rel: 'Data', desc: en ? `Dataset ${label} (JSON)` : `数字の入口 ${label}（JSON）` })
    const tables = tablesOf(e.data)
    for (const t of tables) {
      const part = tables.length > 1 ? `${stem}-${safeStem(t.key, 'table')}` : stem
      const which = tables.length > 1 ? ` ${plain(t.key || 'x')}` : ''
      csvs.push({ name: claim(part, 'csv'), bytes: bytesOf(csvText(t)), mime: 'text/csv', rel: 'Data', desc: en ? `Dataset ${label}${which} (CSV, for spreadsheets)` : `数字の入口 ${label}${which}（CSV・表計算用）` })
    }
  })

  const notes = notesMarkdown(doc)
  const notesFile = notes === null ? [] : [{ name: 'notes.md', bytes: bytesOf(notes), mime: 'text/markdown', rel: /** @type {const} */ ('Supplement'), desc: en ? 'Speaker notes (Markdown)' : '話す人の覚え（Markdown）' }]

  /** @type {AttachFile[]} */
  const kept = []
  /** @type {string[]} */
  const dropped = []
  let total = 0
  for (const f of [...first, ...notesFile, ...csvs]) {
    if (total + f.bytes.length > ATTACH_RAW_MAX) { dropped.push(f.name); continue }
    total += f.bytes.length
    kept.push(f)
  }
  if (dropped.length) warnings.push(`添付の合計が ${ATTACH_RAW_MAX / 1048576} MiB を超えるので、入れなかった物: ${dropped.slice(0, 6).join('・')}${dropped.length > 6 ? ' ほか' : ''}`)
  // pdf-lib は名前の木を並べ替えない。名前の順に添える(木の鍵は昇順の決まり)
  kept.sort(byName)
  return { attach: true, files: kept, warnings }
}

/**
 * 計画の物を PDF に添える。/Names の EmbeddedFiles・各 Filespec の AFRelationship と UF と Desc・/Params の Size と日付・catalog の /AF は pdf-lib の attach が作る
 * @param {any} pdfDoc @param {AttachFile[]} files @param {number | undefined} created 作った時刻(ms)。無ければ日付を書かない
 */
export async function embedAttachments(pdfDoc, files, created) {
  const when = typeof created === 'number' && Number.isFinite(created) ? new Date(created) : undefined
  for (const f of files) {
    await pdfDoc.attach(f.bytes, f.name, { mimeType: f.mime, description: f.desc, creationDate: when, modificationDate: when, afRelationship: AFRelationship[f.rel] })
  }
}

// ---- XMP ----

/**
 * XML に入れる字を ASCII にする。& < > " ' は実体、ASCII の外は &#x…; の文字参照(サロゲートの対は 1 つの字にまとめる)。
 * XML 1.0 で使えない制御字と孤立したサロゲートは捨て、改行とタブは空白にする
 * @param {unknown} s
 */
export function xmlText(s) {
  let out = ''
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0x9 || cp === 0xa || cp === 0xd) out += ' '
    else if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) continue
    else if (ch === '&') out += '&amp;'
    else if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else if (ch === '"') out += '&quot;'
    else if (ch === "'") out += '&apos;'
    else if (cp < 0x7f) out += ch
    else out += `&#x${cp.toString(16).toUpperCase()};`
  }
  return out
}

/** ms の時刻を XMP の日付(UTC・秒まで)に。数でなければ null @param {unknown} ms */
function xmpDate(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 19)}Z`
}

/**
 * XMP の packet(ASCII だけ)。dc:title・dc:creator(author があれば)・dc:language・xmp:CreatorTool・日付。
 * begin は空: BOM の字(U+FEFF)を入れると ASCII でなくなる。PDF/A の宣言(pdfaid)は書かない。
 * @param {Meta} m
 */
export function xmpPacket(m) {
  const date = xmpDate(m.created)
  const lang = m.lang === 'en-US' ? 'en-US' : 'ja-JP'
  const li = (/** @type {string} */ tag, /** @type {string} */ inner) => `   <${tag}>${inner}</${tag}>`
  const rows = [
    li('dc:format', 'application/pdf'),
    li('dc:title', `<rdf:Alt><rdf:li xml:lang="x-default">${xmlText(m.title ?? '')}</rdf:li></rdf:Alt>`),
    ...(m.author ? [li('dc:creator', `<rdf:Seq><rdf:li>${xmlText(m.author)}</rdf:li></rdf:Seq>`)] : []),
    ...(m.subject ? [li('dc:description', `<rdf:Alt><rdf:li xml:lang="x-default">${xmlText(m.subject)}</rdf:li></rdf:Alt>`)] : []),
    li('dc:language', `<rdf:Bag><rdf:li>${lang}</rdf:li></rdf:Bag>`),
  ]
  const xmp = [li('xmp:CreatorTool', xmlText(CREATOR_TOOL)), ...(date ? [li('xmp:CreateDate', date), li('xmp:ModifyDate', date), li('xmp:MetadataDate', date)] : [])]
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    ...rows,
    '  </rdf:Description>',
    '  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    ...xmp,
    '  </rdf:Description>',
    '  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    li('pdf:Producer', xmlText(PRODUCER)),
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
    '',
  ].join('\n')
}

/**
 * XMP を catalog の /Metadata に付ける。字のまま(ASCII)の流れで、save7bit が ASCII85 で包む(解く読み手は pdfjs・poppler で確かめた)
 * @param {any} pdfDoc @param {Meta} m
 */
export function addXmp(pdfDoc, m) {
  const ctx = pdfDoc.context
  pdfDoc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(xmpPacket(m), { Type: 'Metadata', Subtype: 'XML' })))
}
