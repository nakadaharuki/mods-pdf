// @ts-check
// BudouX の index は HTMLProcessor（DOM を触る）と linkedom を引くので、parser と ja のモデルを直接取る。
// 選ばなかった案: budoux の module/ の ESM を使う案。dist/ の CJS を使う（同じ解析器。指定どおり）。
import { lexer } from 'marked'
import { Parser } from '../node_modules/budoux/dist/parser.js'
import { model as jaModel } from '../node_modules/budoux/dist/data/models/ja.js'
import Hypher from 'hypher'
import enUs from 'hyphenation.en-us'

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

/**
 * 英語（en-US）の語を TeX のパターンで割る。パターンは hyph-en-us（Liang の方式・lefthyphenmin 2・righthyphenmin 3）の写しで、
 * 例外の語は hyph-en-us.tex の \hyphenation の 14 語（DEK の hyphen.tex のまま）。区切りの U+2027 は Hypher の例外の書式。
 * 選ばなかった案: hyphen（ISC・全言語で約 9 MB）や Hyphenopoly（wasm）。en-us の 1 言語だけで足りるので、27 KB のパターンと 3 KB の Hypher で済ませる
 */
const EN_US_EXCEPTIONS = 'as‧so‧ciate, as‧so‧ciates, dec‧li‧na‧tion, oblig‧a‧tory, phil‧an‧thropic, present, presents, project, projects, reci‧procity, re‧cog‧ni‧zance, ref‧or‧ma‧tion, ret‧ri‧bu‧tion, ta‧ble'

/** @type {Hypher | null} */
let english = null

/** @type {Map<string, number[]>} */
const hyphenCache = new Map()

/**
 * 英単語（ASCII の英字だけ）を割ってよい位置。語の先頭からの字数で、昇順。左 2 字・右 3 字は割らない。
 * 英字以外が混ざる語、2 字下の位置に収まらない短い語は []。大文字小文字は区別しない（呼び出し側で「大文字で始まる語は割らない」を決める）
 * @param {string} word
 * @returns {number[]}
 */
export function hyphenPoints(word) {
  if (!/^[A-Za-z]+$/.test(word)) return []
  const key = word.toLowerCase()
  const hit = hyphenCache.get(key)
  if (hit) return hit
  english ??= new Hypher({ ...enUs, exceptions: EN_US_EXCEPTIONS })
  const parts = english.hyphenate(word)
  /** @type {number[]} */
  const out = []
  let at = 0
  for (let i = 0; i < parts.length - 1; i++) {
    at += parts[i].length
    out.push(at)
  }
  if (hyphenCache.size >= 20000) hyphenCache.clear()
  hyphenCache.set(key, out)
  return out
}
