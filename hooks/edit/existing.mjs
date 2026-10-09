// @ts-check
// 既存の PDF の書き換え: 記入欄の一覧と記入・頁の結合と抜き出し・字の書き込み。
// 入るのも出るのもバイト列と字だけ。ファイルの読み書きは本体（io）の仕事で、ここは何も読まない。
import {
  PDFDocument, PDFParser, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFButton, PDFSignature,
  PDFRef, PDFDict, PDFName, ParseSpeeds, degrees, rgb, fontkit, save7bit,
} from '../vendor/pdf.mjs'
import { LIMITS, limitLoad, inflateError, guardStructure, stripActive, strippedWarning, noStripped, clip } from './guard.mjs'

/** @typedef {'mincho'|'minchoBold'|'sans'|'sansBold'} FontId */
/** 書体のバイト列。engine/fonts の loadFontBytes の答え（{ sans, sansBold, … }）。素のバイト列は sans として受ける。
 *  @typedef {Uint8Array | Partial<Record<FontId, Uint8Array>>} FontBytes */
/** @typedef {{ name: string, kind: 'text'|'check'|'choice'|'radio'|'button'|'signature'|'other', value: string|boolean|string[],
 *   options?: string[], multiple?: boolean, page: number, rect: [number, number, number, number], readOnly: boolean }} FieldInfo
 *  page は 1 から（頁が分からない欄は 0）。rect は PDF の座標（pt・左下が原点）のまま。 */

const MAX_TEXT = 4 * 1024 * 1024
const MM = 72 / 25.4
const LINE_GAP = 1.4

// 入力の大きさの上限。道具の引数は Claude が書く物で、敵意のある PDF や値が混ざりうる。フックは 10 秒で切られるので、
// 切られる前に理由つきで断る。数は実測から: fillFields は欄 1 つ 0.4 ms、mergePages は頁数の 2 乗（5000 頁で 0.45 秒・2 万頁で 6.8 秒）
const MERGE_PARTS_MAX = 100
/** 結合の答えの頁数。addPage が頁の数を数え直すので 2 乗に増える */
const MERGE_PAGES_MAX = 5000
const FILL_VALUES_MAX = LIMITS.fields
const FILL_TEXT_MAX = 20000
const FILL_CHOICES_MAX = 500
const MARKS_MAX = 2000
const MARK_TEXT_MAX = 10000
const MARK_LINES_MAX = 500
const MARK_SIZE_MAX = 1000
const MARK_POS_MAX = 100000
const SPEC_MAX = 20000
/** 速報を返せる時間の目安。pdf-lib の中は割り込めないので、仕事の区切りで見る */
const BUDGET_MS = 8000
// 返す字の上限（PDF の作り手が書いた物は長くできる。Claude の文脈を食わせない）
const NAME_MAX = 500
const VALUE_MAX = 5000
const OPTIONS_MAX = 500
const OPTION_MAX = 300

/** @param {unknown} x @returns {Uint8Array} */
function asBytes(x) {
  if (x instanceof Uint8Array) return x
  // 別の領域で作られた Uint8Array は instanceof を通らず、pdf-lib が弾く。同じ領域の見え方に包み直す（写さない）。
  // 型付き配列かどうかを byteLength で見るのは、静的な検査が Node の物の名前を字で探すので、名前に触れる書き方を避けるため
  const v = /** @type {any} */ (x)
  if (v && typeof v === 'object' && typeof v.byteLength === 'number') return v.buffer ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v)
  throw new Error('PDF はバイト列（Uint8Array）で渡してください')
}

/**
 * 暗号化は pdf-lib が復号できないので、ここで断る。ignoreEncryption で読み進めると
 * 暗号化された流れを壊したまま書き戻してしまう。
 * @param {unknown} bytes
 * @param {string} [where] 何番目の入力か（結合の時の目印）
 */
async function loadPdf(bytes, where = '') {
  const data = asBytes(bytes)
  if (data.length > LIMITS.input) throw new Error('PDF が大きすぎます' + where + '（' + Math.round(data.length / 1048576 * 10) / 10 + ' MiB。' + LIMITS.input / 1048576 + ' MiB まで）')
  try {
    // PDFDocument.load と同じ手順を自分で踏む: 読んだ後・PDFDocument にする前に、木の爆弾を確かめるため。
    // Fastest は途中の待ち（タイマー）を挟まない。updateMetadata を切るのは、元の作成者・更新日を勝手に書き換えないため。
    // capNumbers は桁の多い数を丸める（pdf-lib の任意の設定。数の読みで長く掛からない）
    const parser = PDFParser.forBytesWithOptions(data, ParseSpeeds.Fastest, false, true)
    limitLoad(parser.context)
    let context
    try {
      context = await parser.parseDocument()
    } catch (e) {
      throw inflateError(parser.context) ?? e
    }
    const refused = inflateError(parser.context)
    if (refused) throw refused
    guardStructure(context)
    return new PDFDocument(context, false, false)
  } catch (e) {
    // EncryptedPDFError に instanceof は使えない: pdf-lib の独自の例外は ES5 流に Error を継承していて、投げられるのは素の Error。文面で見分ける
    if (/is encrypted|ignoreEncryption/.test(reasonOf(e))) throw new Error('暗号化された PDF は扱えません' + where)
    // pdf-lib は壊れた部分を読み飛ばす時に console.warn で知らせる。フックの環境に console は無く、ここで落ちる
    if (e instanceof ReferenceError && /console/.test(reasonOf(e))) throw new Error('PDF の壊れた部分を読み飛ばす必要があり、読めませんでした' + where)
    throw new Error('PDF を読めません' + where + ': ' + reasonOf(explain(e)))
  }
}

/**
 * pdf-lib の中の再帰が積み上がった時の RangeError を、直せる文にする。ほかの例外はそのまま
 * @param {unknown} e
 */
function explain(e) {
  return e instanceof RangeError ? new Error('入れ子が深すぎて扱えない PDF です') : e
}

/**
 * @template T @param {() => Promise<T>} f @returns {Promise<T>}
 */
async function guarded(f) {
  try {
    return await f()
  } catch (e) {
    throw explain(e)
  }
}

/** @param {number} t0 @param {string} what */
function checkTime(t0, what) {
  if (performance.now() - t0 > BUDGET_MS) throw new Error(what + 'に時間がかかりすぎました（フックの上限 10 秒に近づいたので止めました）。頁や欄を絞ってください')
}

/** @param {unknown} e */
function reasonOf(e) {
  return e instanceof Error ? e.message : String(e)
}

/** @param {string} text */
function finish(text) {
  if (text.length > MAX_TEXT) throw new Error('書き換えた PDF が 4 MiB を超えます（' + Math.round(text.length / 1048576 * 10) / 10 + ' MiB）。頁を絞ってください')
  return text
}

/**
 * @param {FontBytes | undefined} fontBytes
 * @param {string} id
 * @returns {{ key: string, bytes: Uint8Array } | undefined}
 */
function pickFont(fontBytes, id) {
  if (!fontBytes) return undefined
  if (typeof (/** @type {any} */ (fontBytes)).byteLength === 'number') return { key: 'sans', bytes: asBytes(fontBytes) }
  const table = /** @type {Record<string, Uint8Array | undefined>} */ (fontBytes)
  // 指定の書体が無ければ sans。黙って落とすより、字が出る方を選ぶ
  const key = table[id] ? id : 'sans'
  const b = table[key]
  return b ? { key, bytes: asBytes(b) } : undefined
}

/** @param {any} doc @param {Uint8Array} bytes */
function embedSubset(doc, bytes) {
  doc.registerFontkit(fontkit)
  // 丸ごと埋め込むと数 MB で 4 MiB の上限に当たる。書き込む字だけの subset にする
  return doc.embedFont(bytes, { subset: true })
}

/** 書体に無い字（.notdef の四角で出てしまう）を拾う
 * @param {any} font @param {Iterable<string>} texts */
function missingChars(font, texts) {
  const have = new Set(font.getCharacterSet())
  const out = new Set()
  for (const t of texts) for (const ch of t) {
    const cp = /** @type {number} */ (ch.codePointAt(0))
    if (cp > 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0) && !have.has(cp)) out.add(ch)
  }
  return [...out]
}

/** @param {string} s */
function hasWide(s) {
  for (const ch of s) if (/** @type {number} */ (ch.codePointAt(0)) > 0xff) return true
  return false
}

// ---------------------------------------------------------------------------
// 欄の一覧

/** 欄の widget がどの頁にあるかを引く表。widget の /P を信用せず、各頁の Annots にもあたる（/P の無い PDF が多い）
 * @param {any} doc */
function buildPageIndex(doc) {
  /** @type {Map<number, number>} */ const byPage = new Map()
  /** @type {Map<number, number>} */ const byAnnot = new Map()
  doc.getPages().forEach((/** @type {any} */ page, /** @type {number} */ i) => {
    byPage.set(page.ref.objectNumber, i + 1)
    const annots = page.node.Annots()
    if (!annots) return
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.get(k)
      if (a instanceof PDFRef) byAnnot.set(a.objectNumber, i + 1)
    }
  })
  return { byPage, byAnnot }
}

/** 欄の widget ごとの ref（親と widget が 1 つの辞書なら欄そのもの）
 * @param {any} field @returns {any[]} PDFRef か undefined（vendor は縮めた束で型が付かないので any） */
function widgetRefs(field) {
  const kids = field.acroField.Kids()
  if (!kids) return [field.ref]
  const refs = []
  for (let k = 0; k < kids.size(); k++) {
    const o = kids.get(k)
    refs.push(o instanceof PDFRef ? o : undefined)
  }
  return refs
}

/** @param {any} field @returns {FieldInfo['kind']} */
function kindOf(field) {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'check'
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return 'choice'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFButton) return 'button'
  if (field instanceof PDFSignature) return 'signature'
  return 'other'
}

/** 壊れた値で一覧ごと落ちないよう、読めなかった値は空にする
 * @template T @param {() => T} f @param {T} fallback @returns {T} */
function safe(f, fallback) {
  try { return f() } catch { return fallback }
}

/** @param {any} field @returns {string|boolean|string[]} */
function valueOf(field) {
  if (field instanceof PDFTextField) return safe(() => field.getText() ?? '', '')
  if (field instanceof PDFCheckBox) return safe(() => field.isChecked(), false)
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const sel = safe(() => field.getSelected(), /** @type {string[]} */ ([]))
    // 複数選べる欄は 1 つ選んでいても配列で返す。形が選んだ数で変わると、読む側が分岐を増やすことになる
    return field instanceof PDFOptionList && safe(() => field.isMultiselect(), false) ? sel : (sel[0] ?? '')
  }
  if (field instanceof PDFRadioGroup) return safe(() => field.getSelected() ?? '', '')
  return ''
}

/**
 * 既存の PDF（バイト列）の記入欄の一覧。
 * 複数の widget を持つ欄（ラジオなど）の page・rect は最初の widget のもの。
 * 名前・値・選び肢は PDF の作り手が書いた字なので、長すぎる物は切る（呼ぶ側は「データとして読む」扱いにする）。
 * @param {Uint8Array} bytes
 * @returns {Promise<FieldInfo[]>}
 */
export function listFields(bytes) {
  return guarded(() => listFieldsOf(bytes))
}

/** @param {string | boolean | string[]} v @returns {string | boolean | string[]} */
function clipValue(v) {
  if (typeof v === 'string') return clip(v, VALUE_MAX)
  if (Array.isArray(v)) return v.slice(0, OPTIONS_MAX).map((x) => clip(x, OPTION_MAX))
  return v
}

/** @param {Uint8Array} bytes */
async function listFieldsOf(bytes) {
  const doc = await loadPdf(bytes)
  const index = buildPageIndex(doc)
  return doc.getForm().getFields().map((field) => {
    /** @type {FieldInfo} */
    const info = { name: clip(field.getName(), NAME_MAX), kind: kindOf(field), value: clipValue(valueOf(field)), page: 0, rect: [0, 0, 0, 0], readOnly: safe(() => field.isReadOnly(), false) }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
      info.options = /** @type {string[]} */ (clipValue(safe(() => field.getOptions(), [])))
    }
    if (field instanceof PDFOptionList) info.multiple = safe(() => field.isMultiselect(), false)
    safe(() => {
      const w = field.acroField.getWidgets()[0]
      if (!w) return
      const r = w.getRectangle()
      // 左右・上下が逆に書かれた Rect でも、幅と高さを正にそろえる
      info.rect = [Math.min(r.x, r.x + r.width), Math.min(r.y, r.y + r.height), Math.abs(r.width), Math.abs(r.height)]
      /** @type {any} */ const p = w.P()
      const ref = widgetRefs(field)[0]
      info.page = (p && index.byPage.get(p.objectNumber)) || (ref && index.byAnnot.get(ref.objectNumber)) || 0
    }, undefined)
    return info
  })
}

// ---------------------------------------------------------------------------
// 欄を埋める

const TRUE_WORDS = new Set(['true', 'on', 'yes', 'y', '1', 'checked', 'はい', 'オン', '○', '〇', '✓', '✔', '済'])
const FALSE_WORDS = new Set(['false', 'off', 'no', 'n', '0', 'unchecked', 'いいえ', 'オフ', '×', ''])

/** @param {unknown} v */
function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  // 曖昧な字を真と決めつけない（「不要」を チェック済みにしてしまう）
  throw new Error('チェック欄には true か false を渡してください（受け取った値: ' + clip(v, 40) + '）')
}

/** 選び肢の一覧を、答えの文に入れられる長さにする（PDF の物なので切る）
 * @param {string[]} options */
function optionsText(options) {
  const shown = options.slice(0, 20).map((o) => clip(o, 40)).join('・')
  return options.length > 20 ? shown + '・…（ほか ' + (options.length - 20) + '）' : shown
}

/** 値の大きさの上限を超えているか（Claude の引数なので、巨大な値で pdf-lib の組みを長引かせない）
 * @param {unknown} raw @returns {string | undefined} 断る理由 */
function tooBigValue(raw) {
  if (Array.isArray(raw)) {
    if (raw.length > FILL_CHOICES_MAX) return '選ぶ数が多すぎます（' + FILL_CHOICES_MAX + ' 個まで）'
    return raw.some((x) => String(x).length > FILL_TEXT_MAX) ? '値が長すぎます（' + FILL_TEXT_MAX + ' 字まで）' : undefined
  }
  return typeof raw === 'string' && raw.length > FILL_TEXT_MAX ? '値が長すぎます（' + FILL_TEXT_MAX + ' 字まで。' + raw.length + ' 字）' : undefined
}

/**
 * 欄 1 つに値を入れる。入れた字（書体の字の確認に使う）を返す。
 * @param {any} field @param {unknown} raw @returns {string[]}
 */
function setValue(field, raw) {
  if (field instanceof PDFTextField) {
    if (raw == null) { field.setText(undefined); return [] }
    let s = String(raw)
    // 1 行の欄に改行を入れると、見た目の組みが崩れる（改行の字形が出る）
    if (!safe(() => field.isMultiline(), false)) s = s.replace(/\r\n|[\r\n]/g, ' ')
    const max = safe(() => field.getMaxLength(), undefined)
    if (max !== undefined && s.length > max) throw new Error('最大 ' + max + ' 字の欄です（' + s.length + ' 字）')
    field.setText(s)
    return [s]
  }
  if (field instanceof PDFCheckBox) {
    if (toBool(raw)) field.check(); else field.uncheck()
    return []
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const list = raw == null ? [] : (Array.isArray(raw) ? raw : [raw]).map(String).filter((v) => v !== '')
    if (!list.length) { field.clear(); return [] }
    const multi = field instanceof PDFOptionList && field.isMultiselect()
    if (list.length > 1 && !multi) throw new Error('1 つしか選べない欄です')
    const options = field.getOptions()
    // 選び肢に無い値を pdf-lib に渡すと、黙って入力可の欄に変えてしまう。編集できる欄でなければ断る
    const editable = field instanceof PDFDropdown && field.isEditable()
    for (const v of list) {
      if (!editable && !options.includes(v)) throw new Error('選び肢にありません: ' + clip(v, 40) + '（選べるのは ' + optionsText(options) + '）')
    }
    field.select(multi ? list : list[0])
    return list
  }
  if (field instanceof PDFRadioGroup) {
    if (raw == null || raw === '') { field.clear(); return [] }
    const v = String(raw)
    const options = field.getOptions()
    if (!options.includes(v)) throw new Error('選び肢にありません: ' + clip(v, 40) + '（選べるのは ' + optionsText(options) + '）')
    field.select(v)
    return [v]
  }
  throw new Error('押しボタンと署名の欄には値を入れられません')
}

/** 今ある値に Latin-1 の外の字が入っている欄か（その欄の見た目を作り直す時に日本語の書体が要る）
 * @param {any} field */
function fieldHasWide(field) {
  const v = valueOf(field)
  return typeof v === 'string' ? hasWide(v) : Array.isArray(v) && v.some(hasWide)
}

/**
 * 記入欄を埋める。values は { 名前: 字 | 真偽 | 字の配列（複数選べる欄）}。
 * missing は PDF に無い名前、failed は在るが入れられなかった欄（理由つき）。
 * flatten は欄を消して見た目の字だけにする（見た目を持たない署名欄などは先に外す）。
 * @param {Uint8Array} bytes
 * @param {Record<string, string | boolean | number | null | string[]>} values
 * @param {{ flatten?: boolean, fontBytes?: FontBytes }} [opts]
 * @returns {Promise<{ text: string, filled: string[], missing: string[], failed: { name: string, reason: string }[], warnings: string[] }>}
 */
export function fillFields(bytes, values, opts = {}) {
  return guarded(() => fillFieldsOf(bytes, values, opts))
}

/**
 * @param {Uint8Array} bytes
 * @param {Record<string, string | boolean | number | null | string[]>} values
 * @param {{ flatten?: boolean, fontBytes?: FontBytes }} opts
 */
async function fillFieldsOf(bytes, values, { flatten = false, fontBytes } = {}) {
  const t0 = performance.now()
  const entries = Object.entries(values ?? {})
  if (entries.length > FILL_VALUES_MAX) throw new Error('values が多すぎます（' + entries.length + ' 個。' + FILL_VALUES_MAX + ' 個まで）')
  const doc = await loadPdf(bytes)
  // 自動で動く物（JavaScript・開いた時の動作・XFA ほか）は持ち越さない。XFA が残ると、Acrobat は XFA の方を見て埋めた欄が出ない
  const stripped = stripActive(doc, { keepGoTo: true })
  const form = doc.getForm()
  const fields = form.getFields()
  // form.getField は呼ぶたびに全部の欄を作り直すので、名前の表を 1 回だけ作る
  const byName = new Map(fields.map((f) => [f.getName(), f]))
  const sans = pickFont(fontBytes, 'sans')
  const wide = entries.some(([, v]) => (Array.isArray(v) ? v.some((x) => hasWide(String(x))) : typeof v === 'string' && hasWide(v)))
  if (wide && !sans) throw new Error('日本語など Latin-1 の外の字を入れるには fontBytes（書体のバイト列）が要ります')

  /** @type {string[]} */ const filled = []
  /** @type {string[]} */ const missing = []
  /** @type {{ name: string, reason: string }[]} */ const failed = []
  /** @type {string[]} */ const written = []
  for (const [name, raw] of entries) {
    const field = byName.get(name)
    if (!field) { missing.push(name); continue }
    const big = tooBigValue(raw)
    if (big) { failed.push({ name, reason: big }); continue }
    try {
      written.push(...setValue(field, raw))
      filled.push(name)
    } catch (e) {
      failed.push({ name, reason: clip(reasonOf(e), 300) })
    }
  }
  checkTime(t0, '欄を埋める途中')

  /** @type {string[]} */ const warnings = []
  const note = strippedWarning(stripped)
  if (note) warnings.push(note)
  // 既存の欄に日本語の値があり外観が無い時も、Helvetica で作ると投げる。書体があるなら使う
  const useFont = !!sans && (wide || fields.some((f) => safe(() => fieldHasWide(f), false)))
  try {
    if (useFont && sans) {
      const font = await embedSubset(doc, sans.bytes)
      form.updateFieldAppearances(font)
      // NeedAppearances が真のままだと、見る側が欄の既定の書体で見た目を作り直し、日本語が消える
      form.acroForm.dict.delete(PDFName.of('NeedAppearances'))
      const miss = missingChars(font, written)
      if (miss.length) warnings.push('書体に無い字があり、四角で出ます: ' + clip(miss.join(''), 100))
    } else {
      form.updateFieldAppearances()
    }
  } catch (e) {
    throw new Error('欄の見た目を作れませんでした: ' + clip(reasonOf(e), 300) + (sans ? '' : '（日本語の欄には fontBytes が要ります）'))
  }
  checkTime(t0, '欄の見た目を作る途中')

  if (flatten) flattenForm(doc, warnings)
  // 書き出した物の印。pdf/ に同じ名前があった時、自分が前に書いた物か（上書きしてよいか）を中身で見分ける
  doc.setProducer('ModsPDF')
  return { text: finish(await save7bit(doc)), filled, missing, failed, warnings }
}

/**
 * pdf-lib の flatten は、見た目の無い widget（署名欄など）に出会うと全体を投げる。
 * 先にその欄だけ外す。removeField も見た目を探して投げるので使えず、頁の注釈と欄の登録を直接外す。
 * @param {any} doc @param {string[]} warnings
 */
function flattenForm(doc, warnings) {
  const form = doc.getForm()
  const index = buildPageIndex(doc)
  const pages = doc.getPages()
  for (const field of form.getFields()) {
    // getNormalAppearance は /AP が無いと undefined を返さず投げる
    if (field.acroField.getWidgets().every((/** @type {any} */ w) => safe(() => w.getNormalAppearance(), undefined))) continue
    for (const ref of [...widgetRefs(field), field.ref]) {
      const at = ref && index.byAnnot.get(ref.objectNumber)
      if (at) pages[at - 1].node.removeAnnot(ref)
    }
    form.acroForm.removeField(field.acroField)
    warnings.push('見た目の無い欄を外しました: ' + clip(field.getName(), 80))
  }
  // updateFieldAppearances は呼び出し側が日本語の書体で済ませている。ここで既定の書体にやり直させると日本語で投げる
  form.flatten({ updateFieldAppearances: false })
}

// ---------------------------------------------------------------------------
// 頁の結合と抜き出し

// 範囲の区切りは、ハイフン・各種のダッシュ・マイナス・波線。字を直に書くと見分けが付かないので、番号で作る
const DASH = '[-' + String.fromCodePoint(0x2010, 0x2013, 0x2014, 0x2212, 0x7e, 0x301c) + ']'
const RANGE = new RegExp('^(\\d+)\\s*' + DASH + '\\s*(\\d+)$')
const RANGE_TAIL = new RegExp('^(\\d+)\\s*' + DASH + '$')

/**
 * '1-3,5' の形の頁の指定を、0 から始まる頁の並びにする。書いた順に並べ、同じ頁を2回書けば2回入る。
 * '3-' は 3 頁から最後まで。空の指定は全部。
 * @param {string | undefined} spec @param {number} total
 * @returns {number[]}
 */
export function parsePageSpec(spec, total) {
  const all = () => Array.from({ length: total }, (_, i) => i)
  if (spec == null) return all()
  if (typeof spec !== 'string') throw new Error('頁の指定は文字で渡してください（例 1-3,5）')
  if (spec.length > SPEC_MAX) throw new Error('頁の指定が長すぎます（' + SPEC_MAX + ' 字まで）')
  // 全角の数字・コンマを半角に。Claude が日本語の文脈で全角のまま渡すことがある
  const s = spec.normalize('NFKC').trim()
  if (!s) return all()
  /** @type {number[]} */ const out = []
  /** @param {number} n */
  const check = (n) => {
    if (n < 1 || n > total) throw new Error('頁 ' + n + ' は範囲の外です（この PDF は ' + total + ' 頁）')
  }
  // 1-5000 を何千回も書くと配列が数億になる。選べる頁の数に上限を付ける
  /** @param {number} add */
  const room = (add) => {
    if (out.length + add > MERGE_PAGES_MAX) throw new Error('頁の指定が多すぎます（一度に ' + MERGE_PAGES_MAX + ' 頁まで）')
  }
  for (const item of s.split(/[,、]/)) {
    const t = item.trim()
    const one = t.match(/^(\d+)$/)
    const range = t.match(RANGE)
    const tail = t.match(RANGE_TAIL)
    if (one) {
      const n = Number(one[1]); check(n); room(1); out.push(n - 1)
    } else if (range) {
      const a = Number(range[1]), b = Number(range[2])
      check(a); check(b)
      if (a > b) throw new Error('頁の範囲 "' + clip(t, 40) + '" は始めが終わりより後ろです')
      room(b - a + 1)
      for (let n = a; n <= b; n++) out.push(n - 1)
    } else if (tail) {
      const a = Number(tail[1]); check(a)
      room(total - a + 1)
      for (let n = a; n <= total; n++) out.push(n - 1)
    } else {
      throw new Error('頁の指定 "' + clip(spec, 40) + '" を読めません（例 1-3,5）')
    }
  }
  return out
}

/**
 * 頁の結合と抜き出し。欄（AcroForm）は引き継がず、見た目だけが残る（pdf-lib の copyPages の制約）。
 * 自動で動く物（JavaScript・開いた時の動作・実行や送信の動作・XFA ほか）は持ち越さず、外した事を warnings に書く。
 * @param {{ bytes: Uint8Array, pages?: string }[]} parts
 * @returns {Promise<{ text: string, pages: number, warnings: string[] }>}
 */
export function mergePages(parts) {
  return guarded(() => mergePagesOf(parts))
}

/** @param {{ bytes: Uint8Array, pages?: string }[]} parts */
async function mergePagesOf(parts) {
  const t0 = performance.now()
  if (!Array.isArray(parts) || !parts.length) throw new Error('結合する PDF がありません（parts が空です）')
  if (parts.length > MERGE_PARTS_MAX) throw new Error('parts が多すぎます（' + parts.length + ' 個。' + MERGE_PARTS_MAX + ' 個まで）')
  const out = await PDFDocument.create({ updateMetadata: false })
  out.setProducer('ModsPDF')
  const stripped = noStripped()
  let picked = 0
  for (const [i, part] of parts.entries()) {
    if (!part || typeof part !== 'object') throw new Error('parts[' + i + '] は { bytes, pages? } で渡してください')
    const src = await loadPdf(part.bytes, '（parts[' + i + ']）')
    // 元の PDF の写しの上で外す（ファイルは書き換えない）。copyPages は頁の辞書をそのまま写すので、先に外す
    const n = stripActive(src, { keepGoTo: false })
    for (const k of /** @type {const} */ (['aa', 'open', 'xfa', 'javascript', 'actions', 'links', 'media', 'total'])) stripped[k] += n[k]
    let pick
    try {
      pick = parsePageSpec(part.pages, src.getPageCount())
    } catch (e) {
      throw new Error('parts[' + i + ']: ' + reasonOf(e))
    }
    if (!pick.length) continue
    picked += pick.length
    // addPage は頁の数を数え直すので、頁数の 2 乗の時間がかかる（2 万頁で 6.8 秒）
    if (picked > MERGE_PAGES_MAX) throw new Error('結合する頁が多すぎます（' + MERGE_PAGES_MAX + ' 頁まで。頁を絞ってください）')
    stripAnnotParents(src, pick)
    for (const page of await out.copyPages(src, pick)) out.addPage(page)
    checkTime(t0, '頁を結合する途中')
  }
  const pages = out.getPageCount()
  if (!pages) throw new Error('結合する頁がありません')
  const note = strippedWarning(stripped)
  return { text: finish(await save7bit(out)), pages, warnings: note ? [note] : [] }
}

/**
 * 注釈の /P（その頁への参照）を外す。残すと copyPages が参照を辿って元の頁を丸ごともう1枚コピーし、
 * 記入欄のある PDF の大きさが倍になる。/P は省いてよい項目で、見た目は変わらない。
 * @param {any} src @param {number[]} indices
 */
function stripAnnotParents(src, indices) {
  const P = PDFName.of('P')
  for (const idx of new Set(indices)) {
    const annots = src.getPage(idx).node.Annots()
    if (!annots) continue
    for (let k = 0; k < annots.size(); k++) {
      const o = annots.get(k)
      const dict = o instanceof PDFRef ? src.context.lookup(o) : o
      if (dict instanceof PDFDict) dict.delete(P)
    }
  }
}

// ---------------------------------------------------------------------------
// 字の書き込み

/**
 * 見える頁（回転後）の左上を原点にした (u, v)（pt・v は下向き）を、PDF の頁の座標に直す。
 * 頁の回転は表示だけの指定なので、/Rotate のある頁に素直に座標を打つと字が90度ずれた所に出る。
 * @param {any} page @param {number} u @param {number} v
 */
function toPageSpace(page, u, v) {
  const box = page.getCropBox()
  const turn = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360
  if (turn === 90) return { x: box.x + v, y: box.y + u, turn, w: box.height, h: box.width }
  if (turn === 180) return { x: box.x + box.width - u, y: box.y + v, turn, w: box.width, h: box.height }
  if (turn === 270) return { x: box.x + box.width - v, y: box.y + box.height - u, turn, w: box.height, h: box.width }
  return { x: box.x + u, y: box.y + box.height - v, turn: 0, w: box.width, h: box.height }
}

/**
 * スキャンした様式などに字を書き込む。x・y は mm で、見える頁（回転後）の左上から。y は字の基線。
 * @param {Uint8Array} bytes
 * @param {{ page: number, x: number, y: number, text: string, size?: number, font?: FontId }[]} marks
 * @param {{ fontBytes?: FontBytes }} [opts]
 * @returns {Promise<{ text: string, warnings: string[] }>}
 */
export function stampText(bytes, marks, opts = {}) {
  return guarded(() => stampTextOf(bytes, marks, opts))
}

/**
 * @param {Uint8Array} bytes
 * @param {{ page: number, x: number, y: number, text: string, size?: number, font?: FontId }[]} marks
 * @param {{ fontBytes?: FontBytes }} opts
 */
async function stampTextOf(bytes, marks, { fontBytes } = {}) {
  const t0 = performance.now()
  if (marks != null && !Array.isArray(marks)) throw new Error('marks は配列で渡してください')
  if ((marks ?? []).length > MARKS_MAX) throw new Error('marks が多すぎます（' + marks.length + ' 個。' + MARKS_MAX + ' 個まで）')
  const doc = await loadPdf(bytes)
  const stripped = stripActive(doc, { keepGoTo: true })
  const pages = doc.getPages()
  /** @type {Map<string, any>} */ const fonts = new Map()
  /** @type {Set<string>} */ const lost = new Set()
  /** @type {string[]} */ const warnings = []
  const note = strippedWarning(stripped)
  if (note) warnings.push(note)

  for (const [i, m] of (marks ?? []).entries()) {
    const at = 'marks[' + i + ']: '
    if (!m || typeof m !== 'object') throw new Error(at + '{ page, x, y, text } の形で渡してください')
    if (!Number.isInteger(m.page) || m.page < 1 || m.page > pages.length) {
      throw new Error(at + '頁 ' + m.page + ' は範囲の外です（この PDF は ' + pages.length + ' 頁）')
    }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) throw new Error(at + 'x と y は mm の数字で渡してください')
    // 桁の巨大な座標は、PDF の中で数百桁の数になる
    if (Math.abs(m.x) > MARK_POS_MAX || Math.abs(m.y) > MARK_POS_MAX) throw new Error(at + 'x と y は mm で ±' + MARK_POS_MAX + ' 以内にしてください')
    const size = m.size ?? 10.5
    if (!Number.isFinite(size) || size <= 0) throw new Error(at + 'size は 0 より大きい数字（pt）です')
    if (size > MARK_SIZE_MAX) throw new Error(at + 'size は ' + MARK_SIZE_MAX + ' pt までです')
    const text = String(m.text ?? '')
    if (text.length > MARK_TEXT_MAX) throw new Error(at + 'text が長すぎます（' + MARK_TEXT_MAX + ' 字まで）')
    if (!text.trim()) continue
    checkTime(t0, '字を書き込む途中')

    const pick = pickFont(fontBytes, m.font ?? 'sans')
    if (!pick) throw new Error(at + 'fontBytes に書体がありません')
    let font = fonts.get(pick.key)
    if (!font) { font = await embedSubset(doc, pick.bytes); fonts.set(pick.key, font) }
    for (const ch of missingChars(font, [text])) lost.add(ch)

    // 元の内容が拡大・移動を戻さず終わる PDF でも、足した字は影響を受けない: pdf-lib が頁の最初の描き込みの前に
    // 元の内容を q … Q で囲む（PDFPageLeaf.normalize）。自前で囲むと二重になる。試験で拡大が漏れる頁を確かめている
    const page = pages[m.page - 1]
    const u = m.x * MM, v = m.y * MM
    const probe = toPageSpace(page, u, v)
    if (u < 0 || v < 0 || u > probe.w || v > probe.h) warnings.push(at + '位置（' + m.x + ', ' + m.y + ' mm）が頁の外です。mm で渡しているか確かめてください')

    // 改行は drawText 任せにせず1行ずつ描く。回転した頁でも、行ごとの座標変換が同じ式で済む
    const lines = text.split(/\r\n|\r|\n/)
    if (lines.length > MARK_LINES_MAX) throw new Error(at + '行が多すぎます（' + MARK_LINES_MAX + ' 行まで）')
    lines.forEach((line, row) => {
      if (!line) return
      const p = toPageSpace(page, u, v + row * size * LINE_GAP)
      page.drawText(line, { x: p.x, y: p.y, size, font, rotate: degrees(p.turn), color: rgb(0, 0, 0) })
    })
  }
  if (lost.size) warnings.push('書体に無い字があり、四角で出ます: ' + clip([...lost].join(''), 100))
  doc.setProducer('ModsPDF')
  return { text: finish(await save7bit(doc)), warnings }
}
