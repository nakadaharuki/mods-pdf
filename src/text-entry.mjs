// @ts-check
// BudouX の index は HTMLProcessor（DOM を触る）と linkedom を引くので、parser と ja のモデルを直接取る。
// 選ばなかった案: budoux の module/ の ESM を使う案。dist/ の CJS を使う（同じ解析器。指定どおり）。
import { lexer } from 'marked'
import { Parser } from '../node_modules/budoux/dist/parser.js'
import { model as jaModel } from '../node_modules/budoux/dist/data/models/ja.js'

/** 解析器は作るのに時間がかかるので、最初の 1 回だけ作って使い回す */
/** @type {Parser | null} */
let parser = null

/** @returns {Parser} */
function japaneseParser() {
  if (parser === null) parser = new Parser(jaModel)
  return parser
}

/**
 * 選ばなかった案: marked の既定（gfm: false）。表の行が段落になり、表の組版ができないので GFM を入れる
 * @param {string} md
 * @returns {ReturnType<typeof lexer>}
 */
export function lex(md) {
  return lexer(md, { gfm: true })
}

/**
 * 日本語の文節の切れ目の位置を、字（コードポイント）の数で返す。0 と末尾は入れない。
 * 選ばなかった案: UTF-16 の位置で返す案。サロゲート対の字（拡張漢字など）で位置がずれるので、字の数で返す。
 * @param {string} text
 * @returns {number[]}
 */
export function phraseBoundaries(text) {
  if (!text) return []
  const chunks = japaneseParser().parse(text)
  /** @type {number[]} */
  const out = []
  let at = 0
  for (let i = 0; i < chunks.length - 1; i++) {
    at += [...chunks[i]].length
    if (at > 0) out.push(at)
  }
  return out
}
