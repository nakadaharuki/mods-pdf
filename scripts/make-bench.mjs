// @ts-check
// 組版の難しい見本（samples/bench-*.json）を、決まった種の乱数で作る。毎回まったく同じ物ができる。
//   node scripts/make-bench.mjs [--out samples]
// 比べるのは scripts/compare-typst.mjs。易しい見本（report・prose・ruby）では ModsPDF も Typst も禁則の破れが 0 で差が出ないので、
// 行の中に「動かさないと揃わない物」を詰め込んだ文を、行長を変えて 3 本作る。
//
// 選ばなかった案:
// - 既存の文章（小説・青空文庫・規格書）を写して難しい所を探す案: 権利の確認が要り、難しい所の密度も上がらない。語句の組み合わせで作る。
// - Math.random: 実行のたびに見本が変わり、数字を前回と比べられない。mulberry32 に種を渡す。
// - 同じ段落を 3 つの行長で組む案: 行長ごとの改行の候補が同じ段落に偏る。種を変えて別々の段落にし、合わせて約 300 段落にする。
// - 行長を compare-typst の中だけで変える案: Doc の paper と size で版面が変わる（makeTheme の chars）ので、見本の側で決める方が ModsPDF の本体の道具（make）でも同じ版面で組める。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeTheme } from '../hooks/engine/theme.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 32 ビットの種から [0, 1) の乱数を返す関数を作る。
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @typedef {{
 *   name: string, seed: number, paper: 'A4' | 'A5' | 'B5' | 'Letter', size: number, chars: number,
 *   title: string, paragraphs: number, headings: string[], bracketRate: number,
 * }} BenchSpec
 */

/**
 * 見本の仕様。chars は makeTheme が出す 1 行の字数（作る時に突き合わせる）。
 * bracketRate は行が長いほど上げる: 行が長いと改行の回数が減り、行頭に来る始め括弧も減る
 * （0.4 で 16 行だった 30 字詰めに対し、53 字詰めは 0.4 で 2 行しか出なかった）。
 * @type {BenchSpec[]}
 */
export const BENCHES = [
  {
    name: 'bench-30', seed: 0x30a5e1, paper: 'A5', size: 11, chars: 30, paragraphs: 100, bracketRate: 0.4,
    title: '組版の難しい見本（30 字詰め）',
    headings: ['1 小書きの仮名と長音', '2 括弧の連なり', '3 欧文と数字', '4 ルビを置く', '5 長い一文'],
  },
  {
    name: 'bench-40', seed: 0x40b7c3, paper: 'A4', size: 12.5, chars: 40, paragraphs: 100, bracketRate: 0.5,
    title: '組版の難しい見本（40 字詰め）',
    headings: ['1 行頭に来られない字', '2 約物の詰め', '3 和欧間の四分', '4 ルビと本文', '5 段落の終わり'],
  },
  {
    name: 'bench-53', seed: 0x53d9f5, paper: 'A4', size: 9.5, chars: 53, paragraphs: 100, bracketRate: 0.7,
    title: '組版の難しい見本（53 字詰め）',
    headings: ['1 禁則の試験', '2 括弧と句読点', '3 欧文の語と数字', '4 ルビの扱い', '5 行末の始め括弧'],
  },
]

// ---------------------------------------------------------------- 言葉の在庫（自分で組んだ語句。既存の作品は写さない）

const MOD = ['新しい', '古い', '小さな', '大きな', '長い', '短い', '細かい', '丁寧な', '手元の', '共有の', '一時的な', '最初の', '最後の', '標準の', '追加の', '余分な', '隠れた', '同じ', '別の', '本番の', '試験用の', '主要な', '重い', '軽い', '不要な', '必要な', '正しい', 'ずれた', '崩れた', '揃った']

const NOUN = [
  '設定ファイル', 'フォルダー', 'キャッシュ', 'ジョブ', 'ショートカット', 'エディター', 'ブラウザー', 'サーバー', 'ユーザー', 'ライブラリー',
  'ファームウェア', 'ステータス', 'チェックリスト', 'プレビュー', 'レイアウト', 'フィルター', 'スクリーンショット', 'メッセージ', 'ウィンドウ', 'ダイアログ',
  'セッション', 'パッケージ', 'ジェネレーター', 'ビューアー', 'コンピューター', 'プリンター', 'スキャナー', 'ヘッダー', 'フッター', 'シミュレーション',
  'ユーティリティー', 'チャンネル', 'マーカー', 'インターフェース', 'パラメーター', 'ダッシュボード', 'ファイル名', 'ログイン画面', 'バックアップ', 'アップデート',
  '帳票', '版面', '行送り', '字間', '余白', '見出し', '段落', '組版', '約物', '書体', '字面', '罫線', '注記', '脚注', '索引', '目次', '表紙', '奥付', '校正刷り', '印刷所', '原稿', '紙面',
  '作業フォルダー', '出力ファイル', '入力の欄', '頁の端', '行の頭', '行の末', '括弧の位置', '句点の後ろ', '中点の幅', '長音の扱い', '小書きの仮名', '促音と拗音', '全角の空き', '半角の空き',
]

const PERSON = ['担当者', '編集者', '印刷所の職人', '利用者', '開発者', '読者', '校正者', '管理者', '新入りの社員', '隣の席の同僚', '古参の職人', '店主', '先生', 'お客さん', '係の人', '知らない人']

const SAY = ['言った', '答えた', 'つぶやいた', '書き込んだ', '頷いた', '笑った', '付け加えた', '説明した', '尋ねた', '言い切った', '続けた', '断った']

const WHEN = ['今朝', '昨日', '先週', '来月', '毎晩', '休みの日', '締め切りの前の晩', '夕方', '年の瀬', '雨の日', '月曜の朝']

const ADV = ['ゆっくり', 'しっかり', 'きっちり', 'ぴったり', 'ちゃんと', 'ずっと', 'もっと', 'ちょっと', 'いっそう', 'やっと', 'すっかり', 'じっくり', 'さっそく', 'きっぱり', 'こっそり', 'たっぷり', 'しばしば', 'ときどき', 'まず', '次に', '最後に', '結局', 'むしろ', 'かえって', 'たとえば', 'つまり']

const CONJ = ['ところが', 'だから', 'それなのに', 'とはいえ', 'そのうえ', 'ただし', 'もっとも', 'ちなみに', 'というのも', 'それでも', 'しかし', 'そこで']

/** 他動詞: 辞書形・過去・て形・ない形 @type {[string, string, string, string][]} */
const VT = [
  ['確かめる', '確かめた', '確かめて', '確かめない'], ['組み直す', '組み直した', '組み直して', '組み直さない'], ['書き出す', '書き出した', '書き出して', '書き出さない'],
  ['読み込む', '読み込んだ', '読み込んで', '読み込まない'], ['並べ替える', '並べ替えた', '並べ替えて', '並べ替えない'], ['切り替える', '切り替えた', '切り替えて', '切り替えない'],
  ['見直す', '見直した', '見直して', '見直さない'], ['取り除く', '取り除いた', '取り除いて', '取り除かない'], ['書き換える', '書き換えた', '書き換えて', '書き換えない'],
  ['写し取る', '写し取った', '写し取って', '写し取らない'], ['数え直す', '数え直した', '数え直して', '数え直さない'], ['整える', '整えた', '整えて', '整えない'],
  ['揃える', '揃えた', '揃えて', '揃えない'], ['詰める', '詰めた', '詰めて', '詰めない'], ['保つ', '保った', '保って', '保たない'],
  ['避ける', '避けた', '避けて', '避けない'], ['調べる', '調べた', '調べて', '調べない'], ['試す', '試した', '試して', '試さない'],
  ['比べる', '比べた', '比べて', '比べない'], ['直す', '直した', '直して', '直さない'], ['つなぐ', 'つないだ', 'つないで', 'つながない'],
  ['分ける', '分けた', '分けて', '分けない'], ['束ねる', '束ねた', '束ねて', '束ねない'], ['閉じる', '閉じた', '閉じて', '閉じない'],
  ['開く', '開いた', '開いて', '開かない'], ['選ぶ', '選んだ', '選んで', '選ばない'], ['決める', '決めた', '決めて', '決めない'],
  ['覚える', '覚えた', '覚えて', '覚えない'], ['消す', '消した', '消して', '消さない'], ['足す', '足した', '足して', '足さない'],
  ['拾う', '拾った', '拾って', '拾わない'], ['打ち切る', '打ち切った', '打ち切って', '打ち切らない'], ['繰り返す', '繰り返した', '繰り返して', '繰り返さない'],
  ['引き継ぐ', '引き継いだ', '引き継いで', '引き継がない'], ['書き留める', '書き留めた', '書き留めて', '書き留めない'],
]

/** 自動詞（辞書形）。「…が V とき」に使う */
const VI = ['届く', '動く', '止まる', '崩れる', 'ずれる', '重なる', '溢れる', '詰まる', '切れる', '揃う', '増える', '減る', '変わる', '戻る', '始まる', '終わる', '遅れる', '失敗する', '成功する', '完了する', '入りきらない', '足りなくなる']

const ADJ = ['難しい', '易しい', '細かい', '重い', '軽い', '美しい', '怪しい', '正しい', '珍しい', '忙しい', '厳しい', '緩い', '頼もしい', 'もどかしい', 'ややこしい']

/** 短い言い回し（かぎ括弧の中の台詞） */
const LINES = [
  'ちょっと見せてください', 'もう一度やり直しましょう', 'これでいいのですか', 'まだ間に合います', 'ぜんぶ書き出してから決めよう', 'ゆっくりで構いません',
  'しっかり確かめたのか', '誰がこれを消したのですか', 'ここまで来たら、最後までやろう', 'きっと大丈夫です', 'どこで切れているのか分からない', 'ぴったり揃うまで直します',
  'ずっとこのままでいいはずがない', 'もっと早く言ってほしかった', 'やっぱり、そこが怪しい', 'ちゃんと読んでから答えて',
]

/** 組版の用語とそのルビ（親字|読み。読みの | はモノルビの区切り） */
const RUBY_TERMS = [
  '組版|くみはん', '禁則|きんそく', '両端|りょうたん', '約物|やくもの', '字間|じま', '版面|はんづら', '行送り|ぎょうおくり', '見出し|みだし', '段落|だんらく', '書体|しょたい',
  '余白|よはく', '調整|ちょうせい', '詰め|つめ', '句読点|く|とう|てん', '行頭|ぎょう|とう', '行末|ぎょう|まつ', '全角|ぜん|かく', '半角|はん|かく', '字形|じ|けい', '濁点|だく|てん',
  '拗音|ようおん', '促音|そくおん', '長音|ちょうおん', '漢字|かん|じ', '平仮名|ひら|がな', '片仮名|かた|かな', '振り仮名|ふ|がな', '明朝|みんちょう', '校正|こうせい', '紙面|しめん',
]

const LATIN = [
  'Claude Code', 'Mods', 'PDF', 'JSON', 'Typst', 'ModsPDF', 'UTF-8', 'A4', 'API', 'CSS', 'SVG', 'JLReq', 'Unicode', 'GitHub', 'hooks.json', 'README', 'OpenType',
  'Zen Old Mincho', 'Noto Sans JP', 'BudouX', 'Knuth-Plass', 'Node.js', 'npm', 'CPU', 'RAM', 'DPI', 'URL', 'PDF/UA', 'TJ', 'HTML', 'Markdown', 'TrueType', 'Windows', 'Linux', 'ECharts', 'Enter', 'Ctrl', 'Shift',
]

/** 数と単位。空白は組むときに入れたり入れなかったりする @type {[string, boolean][]} 真は単位が和字（空白の有無で和欧間が変わる） */
const UNITS = [
  ['MiB', false], ['KiB', false], ['pt', false], ['mm', false], ['em', false], ['ms', false], ['秒', true], ['分', true], ['字', true], ['行', true], ['頁', true], ['倍', true],
  ['%', false], ['件', true], ['桁', true], ['個', true], ['本', true], ['段', true], ['年', true], ['月', true], ['日', true],
]

/** 「未満」に続けられる量の単位 */
const UNITS_SIZE = UNITS.filter(([u]) => ['MiB', 'KiB', 'pt', 'mm', 'em', 'ms', '秒', '分', '字', '行', '頁', '倍', '%', '桁'].includes(u))

/** 文の途中に置く決まり文句（本人の例の形）。種類は 'j'（和文）・'l'（欧文・数字）の列 @type {[string, 'j' | 'l'][][]} */
const FIXED = [
  [['Claude Code', 'l'], ['の', 'j'], ['Mods', 'l']],
  [['PDF', 'l'], ['を', 'j'], ['3 MiB', 'l'], ['未満に', 'j']],
  [['Typst 0.15.1', 'l'], ['と', 'j'], ['ModsPDF', 'l'], ['の', 'j']],
  [['UTF-8', 'l'], ['の', 'j'], ['字を', 'j'], ['4 MiB', 'l'], ['まで', 'j']],
]

// ---------------------------------------------------------------- 文の組み立て

/**
 * @typedef {{ t: string, k: 'j' | 'l' | 'o' | 'c' }} Seg
 * j は和文、l は欧文・数字、o は始め括弧、c は終わり括弧と句読点。欧文と和文の間に空白を入れるかは段落ごとの癖で決める。
 */

/**
 * 文の生成器。乱数の関数を 1 つ持ち、段落ごとに癖（欧文の前後の空白の入れ方）を持つ。
 * @param {() => number} rand
 * @param {number} bracketRate 括弧の連なる文の割合（0〜1）
 */
function makeWriter(rand, bracketRate) {
  /** @template T @param {readonly T[]} a @returns {T} */
  const pick = (a) => a[Math.floor(rand() * a.length)]
  const chance = (/** @type {number} */ p) => rand() < p
  const int = (/** @type {number} */ lo, /** @type {number} */ hi) => lo + Math.floor(rand() * (hi - lo + 1))

  /** 欧文と和文の間の空白の入れ方。0: 入れない・1: 入れる・2: 半々 */
  let spacing = 1
  /** @type {() => string} */
  const gap = () => (spacing === 1 || (spacing === 2 && chance(0.5)) ? ' ' : '')

  /** @param {string} t @returns {Seg} */ const J = (t) => ({ t, k: 'j' })
  /** @param {string} t @returns {Seg} */ const L = (t) => ({ t, k: 'l' })
  /** @param {string} t @returns {Seg} */ const O = (t) => ({ t, k: 'o' })
  /** @param {string} t @returns {Seg} */ const C = (t) => ({ t, k: 'c' })

  /** 欧文との間に空白を入れない字の隣（約物・ダッシュ・三点リーダー・中点） */
  const PUNCT_EDGE = /[、。，．・：；！？…―（）「」『』【】]/u
  /** @param {Seg[]} segs */
  const join = (segs) => {
    let out = ''
    segs.forEach((s, i) => {
      const prev = segs[i - 1]
      if (prev) {
        const edge = PUNCT_EDGE.test(Array.from(prev.t).at(-1) ?? '') || PUNCT_EDGE.test(Array.from(s.t)[0] ?? '')
        if ((prev.k === 'j' && s.k === 'l') || (prev.k === 'l' && s.k === 'j')) out += edge ? '' : gap()
        else if (prev.k === 'l' && s.k === 'l') out += ' '
      }
      out += s.t
    })
    return out
  }

  const noun = () => (chance(0.4) ? pick(MOD) : '') + pick(NOUN)
  const person = () => pick(PERSON)
  const vt = () => pick(VT)
  const term = () => {
    const [base, ...yomi] = pick(RUBY_TERMS).split('|')
    return `{${base}|${yomi.join('|')}}`
  }
  const latin = () => pick(LATIN)
  /** @param {string} unit */
  const num = (unit) => {
    if (unit === '年') return String(int(2020, 2030))
    if (unit === '月') return String(int(1, 12))
    if (unit === '日') return String(int(1, 31))
    const kind = int(0, 4)
    if (kind === 0) return String(int(1, 9))
    if (kind === 1) return String(int(10, 99))
    if (kind === 2) return String(int(100, 9999))
    if (kind === 3) return `${int(0, 3)}.${pick(['25', '5', '75', '05', '15', '1'])}`
    return `${int(1, 9)},${int(100, 999)}`
  }
  /** 数 + 単位。単位が和字なら空白の入れ方も癖に従う @param {readonly [string, boolean][]} [units] @returns {Seg[]} */
  const quantity = (units = UNITS) => {
    const [unit, waji] = pick(units)
    const n = num(unit)
    if (waji) return [L(n), J(unit)]
    return [L(`${n}${unit === '%' || chance(0.4) ? '' : ' '}${unit}`)]
  }
  /** 決まり文句 @returns {Seg[]} */
  const fixed = () => pick(FIXED).map(([t, k]) => (k === 'l' ? L(t) : J(t)))

  /** 名詞句。ときどきルビの付いた語・欧文・数を混ぜる @returns {Seg[]} */
  const np = () => {
    const r = rand()
    if (r < 0.18) return [J(term())]
    if (r < 0.3) return [L(latin()), J('の' + pick(NOUN))]
    if (r < 0.38) return [...quantity(), J('の' + pick(NOUN))]
    if (r < 0.43) return fixed()
    return [J(noun())]
  }

  /** かぎ括弧の台詞（句点と閉じ括弧の連なり） @returns {Seg[]} */
  const quote = () => {
    const r = rand()
    /** @type {Seg[]} */
    let body
    if (r < 0.35) body = [J(pick(LINES))]
    else if (r < 0.6) body = [...np(), J('を' + vt()[2] + 'みましょう')]
    else if (r < 0.8) body = [...np(), J(`は${pick(ADJ)}です`)]
    else body = [J(pick(LINES) + '。'), J(pick(LINES))]
    if (chance(0.2)) body = [J('これを'), O('『'), ...np(), C('』'), J('と呼ぶのです')]
    return [O('「'), ...body, chance(0.35) ? C('。」') : C('」')]
  }

  /** 括弧のない文の型。それぞれ Seg の列（句点まで）を返す @type {(() => Seg[])[]} */
  const plainFrames = [
    // 主語は、副詞 目的語を 動詞。
    () => [...np(), J('は、' + pick(ADV)), ...np(), J('を' + vt()[0]), C('。')],
    // 〜が 自動詞 ときは、〜を 動詞 ことが多い。
    () => [...np(), J('が' + pick(VI) + 'ときは、'), ...np(), J('を' + vt()[0] + 'ことが多い'), C('。')],
    // 時 人は 〜を て形、〜を 過去。
    () => [J(pick(WHEN) + '、' + person() + 'は'), ...np(), J('を' + vt()[2] + '、'), ...np(), J('を' + vt()[1]), C('。')],
    // 欧文と数
    () => [L(latin()), J('を'), ...quantity(UNITS_SIZE), J('未満に' + vt()[0] + 'のは、' + pick(ADJ)), C('。')],
    () => [...quantity(), J('の' + noun() + 'を'), L(latin()), J('で' + vt()[0]), C('。')],
    () => [L(latin()), J('と'), L(latin()), J('の違いを、' + person() + 'は' + pick(ADV) + vt()[1]), C('。')],
    // 逆接や副詞で始める。
    () => [J(pick(CONJ) + '、'), ...np(), J('は' + pick(ADJ)), C('。')],
    () => [J(pick(CONJ) + '、'), ...np(), J('が' + pick(VI) + 'のに、'), ...np(), J('を' + vt()[3]), C('。')],
    // 三点リーダーと二重ダッシュ
    () => [...np(), J('は……'), ...np(), J('だった'), C('。')],
    () => [...np(), J('――つまり'), ...np(), J('――を' + vt()[0]), C('。')],
    // 問い
    () => [J('なぜ'), ...np(), J('は' + vt()[3] + 'のか'), C('？')],
    () => [J('それは'), ...np(), J('のせいか、それとも'), ...np(), J('のせいか'), C('。')],
    // 中点で並べる
    () => [J(noun() + '・' + noun() + '・' + noun() + 'を' + vt()[0]), C('。')],
    // ルビの語を主に
    () => [J(term() + 'と' + term() + 'の間を、' + pick(ADV) + vt()[0]), C('。')],
  ]

  /** 括弧が連なる文の型。段落の途中の行頭に始め括弧が来る機会と、約物どうしの詰めの機会を増やす @type {(() => Seg[])[]} */
  const bracketFrames = [
    // 台詞。
    () => [...quote(), J('と' + person() + 'は' + pick(SAY)), C('。')],
    // 括弧書き。
    () => [...np(), O('（'), ...(chance(0.5) ? [L(latin())] : [J(term())]), C('）'), J('は、' + pick(ADV) + noun() + 'を' + vt()[0]), C('。')],
    // 列挙: 「A」「B」「C」の三つを〜。
    () => [O('「'), ...np(), C('」'), chance(0.5) ? C('、') : J(''), O('「'), ...np(), C('」'), chance(0.5) ? C('、') : J(''), O('「'), ...np(), C('」'), J('の三つを' + vt()[0]), C('。')].filter((s) => s.t !== ''),
    () => [O('（'), J(noun() + '・' + noun()), C('）'), O('（'), L(latin()), C('）'), J('は' + pick(ADJ)), C('。')],
    () => [J(term() + 'に'), O('「'), J(term()), C('」'), J('を' + vt()[2] + '、'), ...np(), J('を' + vt()[0]), C('。')],
    // 閉じ括弧の連なり
    () => [O('「'), J(person() + 'は'), O('『'), ...np(), C('』'), J('と呼んでいた'), C('」'), J('と' + person() + 'は' + pick(SAY)), C('。')],
    () => [...np(), O('（'), ...np(), O('（'), L(latin()), C('））'), J('を' + vt()[0]), C('。')],
    () => [O('「'), ...np(), C('」、'), O('「'), ...np(), C('」、'), O('「'), ...np(), C('」'), J('の順に' + vt()[0]), C('。')],
    // 中点の次の閉じ括弧、閉じ括弧の次の始め括弧
    () => [O('「'), ...np(), O('（'), J(noun() + '・' + noun()), C('・）」'), C('、'), O('「'), ...np(), C('。」'), J(person() + 'は' + pick(SAY)), C('。')],
    () => [O('『'), ...np(), C('』'), O('「'), ...np(), C('」'), O('（'), L(latin()), C('）'), J('を' + vt()[0]), C('。')],
  ]

  /** 一文。bracketRate の割合で括弧の連なる型を選ぶ @returns {Seg[]} */
  const sentence = () => (chance(bracketRate) ? pick(bracketFrames) : pick(plainFrames))()

  /**
   * 段落。n 文を並べる。ときどきかぎ括弧の台詞で始める。
   * @param {number} n
   * @returns {string}
   */
  const paragraph = (n) => {
    spacing = int(0, 2)
    /** @type {Seg[]} */
    const segs = []
    if (chance(0.15)) segs.push(...quote(), J(person() + 'は' + pick(SAY)), C('。'))
    for (let i = 0; i < n; i++) segs.push(...sentence())
    // 空の和文の欠片は結合に影響しないので捨てる
    return join(segs.filter((s) => s.t !== ''))
  }

  return { paragraph, int, chance }
}

/**
 * 1 つの見本の Doc（make の引数の形）を作る。種が同じなら中身は同じ。
 * @param {BenchSpec} spec
 */
export function generateBench(spec) {
  const theme = makeTheme({ paper: spec.paper, size: spec.size })
  if (theme.chars !== spec.chars) throw new Error(`${spec.name}: 1 行の字数が ${theme.chars} 字で、仕様の ${spec.chars} 字と違う`)
  const w = makeWriter(mulberry32(spec.seed), spec.bracketRate)
  /** @type {any[]} */
  const blocks = []
  const perHeading = Math.ceil(spec.paragraphs / spec.headings.length)
  for (let i = 0; i < spec.paragraphs; i++) {
    if (i % perHeading === 0) blocks.push({ type: 'heading', level: 2, text: spec.headings[i / perHeading] })
    // 一文から六文まで。長い段落ほど行が多く、段落の終わりと途中の判断が増える
    const r = w.int(0, 99)
    const n = r < 8 ? 1 : r < 30 ? 2 : r < 58 ? 3 : r < 82 ? 4 : r < 94 ? 5 : 6
    blocks.push({ type: 'para', text: w.paragraph(n) })
  }
  return { title: spec.title, author: 'ModsPDF 見本', lang: 'ja', paper: spec.paper, size: spec.size, blocks }
}

/** @param {string[]} argv */
function main(argv) {
  const i = argv.indexOf('--out')
  const outDir = path.resolve(ROOT, i >= 0 && argv[i + 1] ? argv[i + 1] : 'samples')
  fs.mkdirSync(outDir, { recursive: true })
  let total = 0
  for (const spec of BENCHES) {
    const doc = generateBench(spec)
    const paras = doc.blocks.filter((b) => b.type === 'para').length
    total += paras
    fs.writeFileSync(path.join(outDir, `${spec.name}.json`), JSON.stringify(doc, null, 2) + '\n')
    console.log(`${spec.name}: ${spec.chars} 字詰め（${spec.paper} ${spec.size}pt）・段落 ${paras}`)
  }
  console.log(`段落は合わせて ${total}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2))
