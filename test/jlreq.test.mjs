// @ts-check
import test from 'node:test'
import assert from 'node:assert/strict'
import { CL, classOf, effectiveBlank, halfSpace, inseparable, noBreakAfter, noBreakBefore, spaceBetween, spaceGlue } from '../hooks/engine/jlreq.mjs'

/** 字を並べた文字列の全部が、そのクラスになる */
const allClass = (/** @type {number} */ cls, /** @type {string} */ chars) => {
  for (const ch of chars) assert.equal(classOf(ch), cls, `${ch} (U+${ch.codePointAt(0)?.toString(16)}) はクラス ${cls}`)
}

test('始め括弧類はクラス 1、終わり括弧類はクラス 2 に分かれる', () => {
  allClass(1, '‘“（〔［｛〈《「『【｟〘〖〝«')
  allClass(2, '’”）〕］｝〉》」』】｠〙〗〟»')
})

test('ハイフン・区切り約物・中点・句点・読点・分離禁止の字を分ける', () => {
  allClass(3, '‐〜゠–')
  allClass(4, '！？‼⁇⁈⁉')
  allClass(5, '・：；')
  allClass(6, '。．')
  allClass(7, '、，')
  allClass(8, '—…‥〳〴〵')
})

test('繰返し記号・長音・小書きの仮名を分ける', () => {
  allClass(9, 'ヽヾゝゞ々〻')
  allClass(10, 'ー')
  allClass(11, 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ')
})

test('前置・後置省略記号と和字間隔と等号・演算記号を分ける', () => {
  allClass(12, '￥＄￡＃€№')
  allClass(13, '°′″℃￠％‰')
  assert.equal(classOf(String.fromCodePoint(0x3000)), 14)
  allClass(17, '＝≠≦≧＜＞')
  allClass(18, '＋−×÷±')
})

test('平仮名・片仮名・漢字・欧文用文字・欧文間隔を分ける', () => {
  allClass(15, 'あいうえおかきくけこ')
  allClass(16, 'アイウエオカキクケコ')
  allClass(19, '漢字〆〇')
  assert.equal(classOf('𠮷'), CL.IDEOGRAPHIC, 'サロゲート対の漢字は 1 字として 19')
  assert.equal(classOf(String.fromCodePoint(0x3400)), 19, '拡張 A')
  assert.equal(classOf(String.fromCodePoint(0xf900)), 19, '互換漢字')
  assert.equal(classOf('Ａ'), 19, '全角英数字は 19 と同じ')
  assert.equal(classOf('５'), 19)
  allClass(27, 'aZ09@#$!?()[]{}.,:;%é')
  assert.equal(classOf(' '), 26)
  assert.equal(classOf('\n'), 26)
})

test('字の形が似た別の字も、コードポイントで見て正しいクラスになる', () => {
  assert.equal(classOf(String.fromCodePoint(0x301c)), 3, '波ダッシュ')
  assert.equal(classOf(String.fromCodePoint(0xff5e)), 3, '全角チルダも波ダッシュと同じ扱い')
  assert.equal(classOf(String.fromCodePoint(0x2212)), 18, '数学のマイナス')
  assert.equal(classOf(String.fromCodePoint(0x00d7)), 18)
  assert.equal(classOf(String.fromCodePoint(0x2015)), 8, '水平線も日本語のダッシュとして分離禁止')
  assert.equal(classOf(String.fromCodePoint(0x30fb)), 5, '中点')
  assert.equal(classOf(String.fromCodePoint(0xff0e)), 6, '全角ピリオドは句点類')
  assert.equal(classOf(String.fromCodePoint(0xff0c)), 7, '全角コンマは読点類')
})

test('行頭禁則は終わり括弧・ハイフン・区切り約物・中点・句読点・繰返し記号・長音・小書き仮名・後置省略記号と ASCII の閉じ約物', () => {
  for (const ch of '’”）」』！？・：。、々ーぁっゃァッ°％℃‐〜') assert.equal(noBreakBefore(ch), true, ch)
  for (const ch of ')]},.:;?!%') assert.equal(noBreakBefore(ch), true, ch)
  for (const ch of '漢あアa「（—…￥ 1') assert.equal(noBreakBefore(ch), false, ch)
})

test('行末禁則は始め括弧と前置省略記号と ASCII の開き括弧', () => {
  for (const ch of '「（『【‘“￥＄№') assert.equal(noBreakAfter(ch), true, ch)
  for (const ch of '([{') assert.equal(noBreakAfter(ch), true, ch)
  for (const ch of '」）。、漢あaー') assert.equal(noBreakAfter(ch), false, ch)
})

test('分離禁止は同じ分離禁止の字が並んだ間と欧文の語の中だけ', () => {
  assert.equal(inseparable('—', '—'), true)
  assert.equal(inseparable('…', '…'), true)
  assert.equal(inseparable('‥', '‥'), true)
  assert.equal(inseparable('a', 'b'), true)
  assert.equal(inseparable('1', '2'), true)
  assert.equal(inseparable('—', '。'), false)
  assert.equal(inseparable('漢', '字'), false)
  assert.equal(inseparable('a', '漢'), false)
})

test('約物の半分の空き: 始め括弧は前、終わり括弧と句読点は後に二分、中点は両側に四分、それ以外は 0', () => {
  assert.deepEqual({ ...halfSpace('「') }, { before: 0.5, after: 0 })
  assert.deepEqual({ ...halfSpace('（') }, { before: 0.5, after: 0 })
  assert.deepEqual({ ...halfSpace('」') }, { before: 0, after: 0.5 })
  assert.deepEqual({ ...halfSpace('。') }, { before: 0, after: 0.5 })
  assert.deepEqual({ ...halfSpace('、') }, { before: 0, after: 0.5 })
  assert.deepEqual({ ...halfSpace('・') }, { before: 0.25, after: 0.25 })
  assert.deepEqual({ ...halfSpace('漢') }, { before: 0, after: 0 })
  assert.deepEqual({ ...halfSpace('！') }, { before: 0, after: 0 })
  assert.deepEqual({ ...halfSpace('(') }, { before: 0, after: 0 }, 'ASCII の括弧に空きは無い')
})

test('「。」」の間は 0、「」「」の間は二分、「、「」は二分で、両方の半分を足さない', () => {
  assert.equal(spaceBetween('。', '」').natural, 0)
  assert.equal(spaceBetween('」', '」').natural, 0)
  assert.equal(spaceBetween('、', '」').natural, 0)
  assert.equal(spaceBetween('」', '。').natural, 0)
  assert.equal(spaceBetween('」', '、').natural, 0)
  assert.equal(spaceBetween('」', '「').natural, 0.5)
  assert.equal(spaceBetween('。', '「').natural, 0.5)
  assert.equal(spaceBetween('、', '「').natural, 0.5)
  assert.equal(spaceBetween('「', '「').natural, 0)
  assert.equal(spaceBetween('「', '」').natural, 0)
})

test('中点の空き: 閉じ・句読点の後は四分、中点の後の始め括弧は二分、和字との間は四分', () => {
  assert.equal(spaceBetween('」', '・').natural, 0.25)
  assert.equal(spaceBetween('。', '・').natural, 0.25)
  assert.equal(spaceBetween('、', '・').natural, 0.25)
  assert.equal(spaceBetween('・', '「').natural, 0.5)
  assert.equal(spaceBetween('漢', '・').natural, 0.25)
  assert.equal(spaceBetween('・', '漢').natural, 0.25)
})

test('括弧と和字・欧文の間は括弧の半分の空きだけで、約物の空きは縮められる', () => {
  const a = spaceBetween('漢', '「')
  assert.equal(a.natural, 0.5)
  assert.equal(a.min, 0)
  assert.equal(a.max, 0.5, '約物の空きは伸ばさない')
  assert.equal(a.priority, 1)
  assert.equal(spaceBetween('「', '漢').natural, 0)
  assert.equal(spaceBetween('」', '漢').natural, 0.5)
  assert.equal(spaceBetween('漢', '」').natural, 0)
  assert.equal(spaceBetween('漢', '漢').natural, 0)
  assert.equal(spaceBetween('漢', 'あ').natural, 0)
})

test('和字と欧文の間は四分（下限は八分・上限は二分）', () => {
  for (const [x, y] of [['漢', 'a'], ['a', '漢'], ['あ', 'A'], ['ア', '1'], ['1', 'ア'], ['ー', 'a'], ['ぁ', 'a'], ['々', 'x']]) {
    const s = spaceBetween(x, y)
    assert.equal(s.natural, 0.25, `${x}${y}`)
    assert.equal(s.min, 0.125, `${x}${y}`)
    assert.equal(s.max, 0.5, `${x}${y}`)
    assert.equal(s.priority, 2, `${x}${y}`)
  }
})

test('括弧と欧字の間には和欧間を入れず、括弧の半分の空きだけが残る', () => {
  assert.equal(spaceBetween('「', 'a').natural, 0)
  assert.equal(spaceBetween('a', '」').natural, 0)
  assert.equal(spaceBetween('」', 'a').natural, 0.5)
  assert.equal(spaceBetween('a', '「').natural, 0.5)
  assert.equal(spaceBetween('（', '1').natural, 0)
  assert.equal(spaceBetween('。', 'a').natural, 0.5)
  assert.equal(spaceBetween('、', 'a').kind, 'punct')
})

test('欧文の閉じ約物や開き括弧が字に付く側では和欧間を入れない', () => {
  assert.equal(spaceBetween('漢', ')').natural, 0)
  assert.equal(spaceBetween('漢', ',').natural, 0)
  assert.equal(spaceBetween('(', '漢').natural, 0)
  assert.equal(spaceBetween('漢', '(').natural, 0.25, '字の後の開き括弧は離す')
  assert.equal(spaceBetween(')', '漢').natural, 0.25, '閉じ括弧の後の字は離す')
})

test('欧文間隔は書体の空白の幅を natural、その 0.8 倍を下限、1.5 倍を上限にする', () => {
  const s = spaceBetween(' ', 'a', { spaceWidth: 0.3 })
  assert.ok(Math.abs(s.natural - 0.3) < 1e-12)
  assert.ok(Math.abs(s.min - 0.24) < 1e-12)
  assert.ok(Math.abs(s.max - 0.45) < 1e-12)
  assert.equal(s.priority, 3)
  assert.deepEqual(spaceBetween('a', ' ', { spaceWidth: 0.3 }), s)
  assert.deepEqual(spaceGlue(0.3), s)
})

test('送り幅が 1em に満たない引用符は、字面の無い側の空きを減らして重ならないようにする', () => {
  assert.equal(effectiveBlank(0.5, 1), 0.5)
  assert.equal(effectiveBlank(0.5, 0.474), 0, '欧文の幅の “ には二分の空きは無い')
  assert.equal(effectiveBlank(0.5, 0.75), 0.25)
  assert.equal(effectiveBlank(0.25, 1), 0.25)
  assert.equal(effectiveBlank(0, 1), 0)
  assert.equal(spaceBetween('漢', '“', { advB: 0.474 }).natural, 0, '細い “ の前に二分を足さない')
  assert.equal(spaceBetween('漢', '“').natural, 0.5, '全角の “ なら二分')
  assert.equal(spaceBetween('」', '“', { advB: 0.474 }).natural, 0.5, '表の前提が崩れる時は足しただけ')
})
