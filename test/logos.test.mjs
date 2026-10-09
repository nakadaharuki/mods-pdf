// logos（ティッカーのロゴを読んで表にする部品）の試験。置き場は一時のフォルダーに作り、本物の mods-pdf-logos には頼らない
// （本物の白い行の確かめだけ、置いてある時に行う）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { svgToOps } from '../hooks/engine/svg.mjs'
import { clearLogoCache, collectLogoKeys, loadLogos, logosRoot, lookupLogo, onPill, parseLogoKey, PILL_FILL } from '../hooks/lib/logos.mjs'

const RED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#cc0000"/></svg>'
const WHITE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 12" fill="#fff"><path d="M0 0H30V12H0Z"/></svg>'

/** 一時の置き場を作る。rows は index.json の行、files は { 'svg/NYSE/A.svg': 中身 } */
function fixture(rows, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdf-logos-'))
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(rows))
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
  const reads = []
  const read = async (p) => { reads.push(p); return fs.readFileSync(p, 'utf8') }
  return { dir: dir.replaceAll('\\', '/'), read, reads }
}
const row = (ticker, extra = {}) => {
  const [exchange, code] = ticker.split(':')
  return { ticker, exchange, code, file: `svg/${exchange}/${code}.svg`, white: false, ...extra }
}

test.beforeEach(() => clearLogoCache())

test('logo の字は取引所とコードに読み分け、大文字に直す', () => {
  assert.deepEqual(parseLogoKey('NYSE:IBM'), { exchange: 'NYSE', code: 'IBM', ticker: 'NYSE:IBM' })
  assert.equal(parseLogoKey('tse:7203').ticker, 'TSE:7203')
  assert.equal(parseLogoKey('TSE:130A').ticker, 'TSE:130A')
  assert.equal(parseLogoKey(' NYSE : BRK.B ').ticker, 'NYSE:BRK.B')
  assert.equal(parseLogoKey('TYO:7203').ticker, 'TSE:7203')
  assert.equal(parseLogoKey('NASDAQ:AAPL').ticker, 'NASDAQ:AAPL')
})

test('形の違う logo の字は読まない', () => {
  for (const bad of ['IBM', 'NYSE:', ':IBM', 'NYSE:../x', 'NYSE:IBM/../..', 'NYSE:IB M', '', 'NYSE:' + 'A'.repeat(30), 5, null, undefined, {}]) {
    assert.equal(parseLogoKey(bad), null, String(bad))
  }
})

test('原稿の中の logo の字を、表のセル・要点・箇条書きのどこからでも集め、重複と不正を除く', () => {
  const input = {
    title: 't',
    blocks: [
      { type: 'table', head: [[{ text: 'a' }]], rows: [[[{ text: 'IBM', logo: 'NYSE:IBM' }]], [[{ text: 'again', logo: 'nyse:ibm' }]]] },
      { type: 'keys', items: [{ label: 'x', value: '1', logo: 'TSE:7203' }] },
      { type: 'list', items: [[{ text: 'a', logo: 'NASDAQ:AAPL' }], [{ text: 'b', logo: 'bad' }]] },
    ],
    logo: 5,
  }
  assert.deepEqual(collectLogoKeys(input).sort(), ['NASDAQ:AAPL', 'NYSE:IBM', 'TSE:7203'])
})

test('logo の字の集めは数に上限があり、深すぎる入れ子でも止まる', () => {
  const many = { blocks: Array.from({ length: 500 }, (_, i) => ({ logo: `NYSE:A${i}` })) }
  assert.equal(collectLogoKeys(many, { max: 50 }).length, 50)
  let deep = { logo: 'NYSE:DEEP' }
  for (let i = 0; i < 5000; i++) deep = { x: deep }
  assert.doesNotThrow(() => collectLogoKeys(deep))
})

test('置き場は、プラグインの場所の祖先の .claude の下の mods-pdf-logos', () => {
  assert.equal(logosRoot('C:\\Users\\nakada\\.claude\\plugins\\cache\\x\\mods-pdf\\0.1.0'), 'C:/Users/nakada/.claude/mods-pdf-logos')
  assert.equal(logosRoot('/home/a/.claude/plugins/mods-pdf/'), '/home/a/.claude/mods-pdf-logos')
  assert.equal(logosRoot('C:/dev/mods-pdf'), null)
  assert.equal(logosRoot(undefined), null)
  assert.equal(logosRoot(''), null)
})

test('索引が無い時は投げずに空を返し、警告は 1 行だけ', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdf-logos-empty-')).replaceAll('\\', '/')
  const read = async (p) => fs.readFileSync(p, 'utf8')
  const r = await loadLogos(['NYSE:IBM', 'TSE:7203', 'NASDAQ:AAPL'], { read, dir })
  assert.deepEqual(r.logos, {})
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /index\.json/)
})

test('置き場を決められない時も空を返し、警告は 1 行だけ', async () => {
  const r = await loadLogos(['NYSE:IBM'], { read: async () => '', root: 'C:/dev/mods-pdf' })
  assert.deepEqual(r.logos, {})
  assert.equal(r.warnings.length, 1)
})

test('頼まれたロゴだけを読み、ロゴの表を ticker で返す', async () => {
  const f = fixture([row('NYSE:A'), row('NYSE:B'), row('TSE:7203')], { 'svg/NYSE/A.svg': RED, 'svg/NYSE/B.svg': RED, 'svg/TSE/7203.svg': RED })
  const r = await loadLogos(['NYSE:A', 'tse:7203'], { read: f.read, dir: f.dir })
  assert.deepEqual(Object.keys(r.logos).sort(), ['NYSE:A', 'TSE:7203'])
  assert.equal(r.logos['NYSE:A'], RED)
  assert.deepEqual(r.warnings, [])
  assert.equal(f.reads.some((p) => p.endsWith('B.svg')), false)
})

test('索引に無い ticker は 1 行にまとめて警告し、ほかのロゴは返す', async () => {
  const f = fixture([row('NYSE:A')], { 'svg/NYSE/A.svg': RED })
  const r = await loadLogos(['NYSE:A', 'NYSE:ZZ1', 'NYSE:ZZ2', 'bad'], { read: f.read, dir: f.dir })
  assert.deepEqual(Object.keys(r.logos), ['NYSE:A'])
  assert.equal(r.warnings.length, 2)
  assert.match(r.warnings.join('\n'), /NYSE:ZZ1, NYSE:ZZ2/)
})

test('同じ入力には、読み終わる順にかかわらず同じ答えを返す', async () => {
  const f = fixture([row('NYSE:A'), row('NYSE:B'), row('NYSE:C')], { 'svg/NYSE/A.svg': RED, 'svg/NYSE/B.svg': RED, 'svg/NYSE/C.svg': RED })
  const slow = async (p) => { await new Promise((ok) => setImmediate(ok)); return fs.readFileSync(p, 'utf8') }
  const keys = ['NYSE:Z2', 'NYSE:A', 'NYSE:Z1', 'NYSE:B']
  const a = await loadLogos(keys, { read: f.read, dir: f.dir })
  clearLogoCache()
  const b = await loadLogos(keys, { read: slow, dir: f.dir })
  assert.deepEqual(a, b)
})

test('索引の file が置き場の外や svg/ の外を指す行は、読まずに無い物として扱う', async () => {
  const f = fixture(
    [row('NYSE:A', { file: '../outside.svg' }), row('NYSE:B', { file: '/etc/passwd' }), row('NYSE:C', { file: 'svg/NYSE/../../x.svg' }), row('NYSE:D', { file: 'index.json' })],
    { 'svg/NYSE/A.svg': RED },
  )
  const r = await loadLogos(['NYSE:A', 'NYSE:B', 'NYSE:C', 'NYSE:D'], { read: f.read, dir: f.dir })
  assert.deepEqual(r.logos, {})
  assert.deepEqual(f.reads.filter((p) => !p.endsWith('index.json')), [])
})

test('SVG でない物・大きすぎる物・読めない物は、読めなかった物として 1 行にまとめる', async () => {
  const f = fixture([row('NYSE:A'), row('NYSE:B'), row('NYSE:C'), row('NYSE:D')], {
    'svg/NYSE/A.svg': '<html><body>no</body></html>',
    'svg/NYSE/B.svg': `<svg viewBox="0 0 1 1">${'<g/>'.repeat(60000)}</svg>`,
    'svg/NYSE/D.svg': RED,
  })
  const r = await loadLogos(['NYSE:A', 'NYSE:B', 'NYSE:C', 'NYSE:D'], { read: f.read, dir: f.dir })
  assert.deepEqual(Object.keys(r.logos), ['NYSE:D'])
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /3 件/)
})

test('一度読んだロゴと索引は、次の呼び出しで読み直さない', async () => {
  const f = fixture([row('NYSE:A')], { 'svg/NYSE/A.svg': RED })
  await loadLogos(['NYSE:A'], { read: f.read, dir: f.dir })
  const first = f.reads.length
  await loadLogos(['NYSE:A'], { read: f.read, dir: f.dir })
  assert.equal(f.reads.length, first)
})

test('ロゴの数は上限で切り、警告を書く', async () => {
  const rows = Array.from({ length: 230 }, (_, i) => row(`NYSE:T${i}`))
  const files = Object.fromEntries(rows.map((r) => [r.file, RED]))
  const f = fixture(rows, files)
  const r = await loadLogos(rows.map((x) => x.ticker), { read: f.read, dir: f.dir })
  assert.equal(Object.keys(r.logos).length, 200)
  assert.match(r.warnings[0], /200/)
})

test('lookupLogo は BRK-B と BRK.B を同じ物として探す', () => {
  const logos = { 'NYSE:BRK.B': RED }
  assert.equal(lookupLogo(logos, 'NYSE:BRK-B'), RED)
  assert.equal(lookupLogo(logos, 'nyse:brk.b'), RED)
  assert.equal(lookupLogo(logos, 'NYSE:XXX'), null)
  assert.equal(lookupLogo(undefined, 'NYSE:BRK.B'), null)
})

test('白いロゴは、viewBox を広げた濃い丸い地の上に載せ、中身の色には触らない', () => {
  const out = onPill(WHITE)
  assert.ok(out)
  assert.match(out, /viewBox="-6 -2\.4 42 16\.8"/)
  assert.match(out, new RegExp(`<rect [^>]*fill="${PILL_FILL}"`))
  // 地は根の直後（一番奥）で、白い中身はそのまま後ろにある
  assert.ok(out.indexOf('<rect') < out.indexOf('<path'))
  assert.ok(out.includes('fill="#fff"'))
})

test('白いロゴの地は、描いた時に全面を覆い、ロゴの外へはみ出さない', () => {
  const ops = svgToOps(onPill(WHITE), { x: 0, y: 0, width: 42, height: 16.8 }).ops
  assert.ok(ops.length >= 2)
  const flat = ops.flatMap((o) => (o.t === 'clip' ? o.ops : [o]))
  const ground = flat.find((o) => (o.fill ?? '').toLowerCase() === PILL_FILL)
  assert.ok(ground, '地が描かれる')
  const xs = String(ground.d ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number)
  if (xs) {
    const px = xs.filter((_, i) => i % 2 === 0)
    assert.ok(Math.min(...px) >= -0.01 && Math.max(...px) <= 42.01)
  }
})

test('viewBox が無い白いロゴは width と height から地を作り、どちらも無ければ作らない', () => {
  const sized = '<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="12"><path d="M0 0H30V12H0Z" fill="#fff"/></svg>'
  assert.match(onPill(sized), /viewBox="-6 -2\.4 42 16\.8"/)
  assert.equal(onPill('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H1V1Z" fill="#fff"/></svg>'), null)
  assert.equal(onPill('<svg viewBox="0 0 10 10"/>'), null)
  assert.equal(onPill('not svg'), null)
})

test('索引の white が真の行だけが地に載り、そうでない行はそのまま', async () => {
  const f = fixture([row('NYSE:W', { white: true }), row('NYSE:R')], { 'svg/NYSE/W.svg': WHITE, 'svg/NYSE/R.svg': RED })
  const r = await loadLogos(['NYSE:W', 'NYSE:R'], { read: f.read, dir: f.dir })
  assert.equal(r.logos['NYSE:R'], RED)
  assert.notEqual(r.logos['NYSE:W'], WHITE)
  assert.match(r.logos['NYSE:W'], /<rect /)
})

const REAL = path.join(os.homedir(), '.claude', 'mods-pdf-logos')
test('本物の包みにある白いロゴ（NYSE:KR）が地つきで返り、描ける', { skip: !fs.existsSync(path.join(REAL, 'index.json')) }, async () => {
  const read = async (p) => fs.readFileSync(p, 'utf8')
  const r = await loadLogos(['NYSE:KR', 'NYSE:IBM'], { read, dir: REAL.replaceAll('\\', '/') })
  assert.deepEqual(r.warnings, [])
  assert.match(r.logos['NYSE:KR'], new RegExp(PILL_FILL))
  for (const t of ['NYSE:KR', 'NYSE:IBM']) assert.ok(svgToOps(r.logos[t], { x: 0, y: 0, width: 20, height: 12 }).ops.length > 0, t)
})
