// @ts-check
// Mod を「フックと同じ環境」で動かして確かめる。claude plugin test が使えない本物の書体と本物のファイルで、道具・欄・コマンドを端から端まで通す。
// 実行: node --experimental-vm-modules scripts/hook-env-check.mjs .
// 環境: Node も DOM もタイマーも無い・文字列からのコード生成と wasm は禁止。大域は AbortSignal・AbortController・TextEncoder・TextDecoder・URL・URLSearchParams・atob・btoa・structuredClone・crypto・performance だけ。
// $ は作り物（このスクリプトの外の領域で作るので、配列の領域が違う事も再現できる）。ファイルは一時フォルダーに置き、終わったら消す。
// 選ばなかった案: claude plugin test だけで済ませる案。試験の環境は node:fs を import できず本物の書体（14 MB）を読めないので、
// 組版・PDF・欄の実物の通りはここで確かめ、tests/ の側は部品と道具の入口の振る舞いを確かめる。
import vm from 'node:vm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const modDir = path.resolve(process.argv[2] ?? '.')
const hooksDir = path.join(modDir, 'hooks')
const hooksJson = JSON.parse(fs.readFileSync(path.join(hooksDir, 'hooks.json'), 'utf8'))
const entry = path.resolve(hooksDir, hooksJson.modules?.[0] ?? '')

const fails = []
const ok = (name, extra = '') => console.log(`ok   ${name}${extra ? `  ${extra}` : ''}`)
const ng = (name, error) => {
  fails.push(name)
  console.log(`FAIL ${name}: ${error?.stack?.split('\n').slice(0, 3).join(' | ') ?? error}`)
}
/** 確かめて、結果を 1 行に出す */
async function check(name, fn) {
  const t0 = performance.now()
  try {
    const extra = await fn()
    ok(name, `${extra ? `${extra} ` : ''}(${Math.round(performance.now() - t0)} ms)`)
  } catch (error) {
    ng(name, error)
  }
}
const assert = (cond, message) => { if (!cond) throw new Error(message) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MIB4 = 4 * 1024 * 1024

// ---- 静的な点検 ----

/** vendor の外の .mjs（vendor は束ねた物で、Node の語を字として含む。読み込みで確かめる） */
function sourceFiles() {
  const out = []
  for (const rel of fs.readdirSync(hooksDir, { recursive: true })) {
    const file = path.join(hooksDir, String(rel))
    if (!/\.mjs$/.test(String(rel)) || !fs.statSync(file).isFile()) continue
    out.push({ rel: String(rel).replaceAll('\\', '/'), file, text: fs.readFileSync(file, 'utf8') })
  }
  return out
}

await check('hooks の下に Node の語が無い（vendor を除く・コメントも数える）', () => {
  // process は process.env のような使い方（. か [ が続く）と typeof process だけを数える。ファイル名（./process.mjs）の中は除く。
  // 選ばなかった案: 語そのものを数える案。図の形の id・ファイル名（process = 段階の図）や道具の説明の語が、Node とは関係なく落ちる
  const words = /node:|(?<![\w/'"-])process\s*[.[]|typeof\s+process\b|\bBuffer\b|setTimeout|require\(|\beval\(|new Function|\bimport\s*\(/
  const hits = []
  for (const f of sourceFiles()) {
    if (f.rel.startsWith('vendor/')) continue
    const text = f.rel === 'mods-pdf.mjs' ? f.text.replaceAll('$.process.run', '') : f.text
    // 選ばなかった案: JSDoc の @type {import('./x.mjs').T} だけ import( を数えない案。動かない注釈でも、grep で動的な読み込みと見分けられなくなる（型は typedef で足りる）
    text.split('\n').forEach((line, i) => { if (words.test(line)) hits.push(`${f.rel}:${i + 1}`) })
  }
  assert(!hits.length, hits.join(' '))
})

await check('ドル記号の直後に点を書くのは hooks/mods-pdf.mjs だけ', () => {
  const hits = []
  for (const f of sourceFiles()) {
    if (f.rel === 'mods-pdf.mjs') continue
    f.text.split('\n').forEach((line, i) => { if (/\$\./.test(line)) hits.push(`${f.rel}:${i + 1}`) })
  }
  assert(!hits.length, hits.join(' '))
})

await check('import は相対だけ', () => {
  const hits = []
  for (const f of sourceFiles()) {
    for (const m of f.text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)) if (!m[1].startsWith('.')) hits.push(`${f.rel}: ${m[1]}`)
    for (const m of f.text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) if (!m[1].startsWith('.')) hits.push(`${f.rel}: ${m[1]}`)
  }
  assert(!hits.length, hits.join(' / '))
})

await check('自分の .mjs は // @ts-check で始まる', () => {
  const mine = ['mods-pdf.mjs', 'sample.mjs', ...fs.readdirSync(path.join(hooksDir, 'lib')).map((n) => `lib/${n}`)]
  const bad = mine.filter((rel) => !fs.readFileSync(path.join(hooksDir, rel), 'utf8').startsWith('// @ts-check'))
  assert(!bad.length, bad.join(' '))
})

// ---- フックの環境で読み込む ----

/** 新しい環境でモジュールを読み込む（モジュールの変数は環境ごとに別になる） */
async function loadMod() {
  const globals = Object.create(null)
  Object.assign(globals, { AbortSignal, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, atob, btoa, structuredClone, crypto, performance })
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } })
  const cache = new Map()
  const load = (file) => {
    if (cache.has(file)) return cache.get(file)
    const mod = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context })
    cache.set(file, mod)
    return mod
  }
  const link = async (specifier, referencing) => {
    if (!specifier.startsWith('.')) throw new Error(`plugin の外からの import は使えない: ${specifier}`)
    return load(path.resolve(path.dirname(referencing.identifier), specifier))
  }
  const main = load(entry)
  await main.link(link)
  await main.evaluate()
  return main.namespace
}

const isRegExp = (v) => Object.prototype.toString.call(v) === '[object RegExp]'
const matcherKey = (m) => (m === undefined ? '' : JSON.stringify(m, (k, v) => (isRegExp(v) ? `/${v.source}/${v.flags}` : v)))

/** 作り物の $。cwd は一時フォルダー、plugin.root は Mod の置き場 */
function makeDollar(cwd, store) {
  const timers = []
  const log = { written: [], opened: [], ran: [], logs: [], invalidated: 0, tools: [], commands: [] }
  const abs = (p) => (path.isAbsolute(p) ? p : path.join(cwd, p))
  const components = {}
  for (const k of ['Box', 'Text', 'Button', 'Svg']) components[k] = (props = {}) => ({ type: k, props, children: props.children ?? [] })
  const $ = {
    plugin: { root: modDir },
    session: { cwd: async () => cwd },
    fs: {
      read: async (p, o) => {
        const buf = fs.readFileSync(abs(p))
        if (buf.length > MIB4) throw new Error('over 4 MiB')
        return o?.as === 'bytes' ? { base64: buf.toString('base64') } : buf.toString('utf8')
      },
      write: async (p, text) => {
        if (typeof text !== 'string') throw new Error('text 以外は書けない')
        if (text.length > MIB4) throw new Error('over 4 MiB')
        const file = abs(p)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, text, 'utf8')
        log.written.push(p)
      },
      stat: async (p, o) => {
        const file = abs(p)
        const st = fs.statSync(file)
        const out = { kind: st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other', size: st.size, mtimeMs: st.mtimeMs, isLink: fs.lstatSync(file).isSymbolicLink() }
        if (o?.resolve) out.realPath = fs.realpathSync(file)
        return out
      },
    },
    store: { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v) } },
    clock: {
      now: async () => Date.parse('2026-10-09T03:00:00Z'),
      every: (ms, fn) => { const t = { kind: 'every', ms, fn, cancelled: false, cancel() { t.cancelled = true } }; timers.push(t); return t },
      after: (ms, fn) => { const t = { kind: 'after', ms, fn, cancelled: false, cancel() { t.cancelled = true } }; timers.push(t); return t },
    },
    tool: { register: async (spec) => { log.tools.push(spec) } },
    command: { register: async (spec) => { log.commands.push(spec) } },
    ui: {
      log: (text, o) => { log.logs.push({ text, to: o?.to }) },
      invalidate: () => { log.invalidated += 1 },
      open: async (spec) => { log.opened.push(spec); return { isPlaced: true } },
      resolve: () => components,
    },
    process: { run: async (argv, init) => { log.ran.push({ argv, env: init?.env }); return { exitCode: 0, stdout: '', stderr: '' } } },
  }
  return { $, timers, log }
}

/** 環境を作り、register を呼んで、フックを引ける形にする */
async function boot(cwd, store = new Map()) {
  const ns = await loadMod()
  const hooks = []
  ns.register((name, matcher, fn) => {
    const h = typeof matcher === 'function' ? { name, key: '', fn: matcher } : { name, key: matcherKey(matcher), fn }
    hooks.push(h)
    return { catch() {} }
  })
  const { $, timers, log } = makeDollar(cwd, store)
  const find = (name, matcher) => {
    const key = matcherKey(matcher)
    const h = hooks.find((x) => x.name === name && x.key === key)
    if (!h) throw new Error(`フックが無い: ${name} ${key}`)
    return h
  }
  const next = async (e) => e
  const api = {
    hooks, $, timers, log, store,
    start: () => find('session.start').fn($, { surface: 'desktop', isInteractive: true, cwd }, next),
    tool: (name, args) => find('tool.call', { tool: `mcp__mods-pdf__${name}` }).fn($, { tool: `mcp__mods-pdf__${name}`, ...args }, next),
    command: (args) => find('command.run', { command: 'pdf' }).fn($, { command: 'pdf', args }, next),
    render: (surface = 'desktop', cols = 54, rows = 33) => find('ui.render', { component: 'Pane', requestId: 'mods-pdf' }).fn($, {
      plugin: 'mods-pdf', component: 'Pane', requestId: 'mods-pdf', surface, viewport: { columns: 140, rows: 40 },
      props: { title: 'ModsPDF', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
    }, next),
  }
  return api
}

// ---- 木を調べる道具 ----
function walk(node, fn) {
  if (node === null || typeof node !== 'object') return
  fn(node)
  for (const c of node.children ?? []) walk(c, fn)
}
function nodes(tree, type) {
  const out = []
  walk(tree, (n) => { if (n.type === type) out.push(n) })
  return out
}
function allText(tree) {
  const out = []
  walk(tree, (n) => { if (n.type === 'Text') out.push(...(n.children ?? []).filter((c) => typeof c === 'string')) })
  return out.join('\n')
}
const button = (tree, key) => nodes(tree, 'Button').find((b) => b.props.key === key)

/** 時計の every を、止まるまで回す（書体は 1 回に 1 つ） */
async function runFontTimer(app, limitMs = 90_000) {
  const t = app.timers.find((x) => x.kind === 'every')
  assert(t, '書体の時計が始まっていない')
  const t0 = performance.now()
  while (!t.cancelled && performance.now() - t0 < limitMs) {
    t.fn()
    await sleep(150)
  }
  assert(t.cancelled, '書体の時計が止まらない')
}

function pdfOk(text, label) {
  assert(text.startsWith('%PDF-'), `${label}: 頭が %PDF- でない`)
  assert(/%%EOF\s*$/.test(text), `${label}: 終わりに %%EOF が無い`)
  assert(!/[^\x00-\x7f]/.test(text), `${label}: 7 ビットの外の字がある`)
  assert(text.length < MIB4, `${label}: 4 MiB を超える`)
}

const { SAMPLE } = await import(pathToFileURL(path.join(hooksDir, 'sample.mjs')).href)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-pdf-check-'))
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

try {
  // register: 本数・(事象, マッチャー) の重なり
  let probe
  await check('読み込める・register が通る・同じ事象とマッチャーの組は 1 回ずつ', async () => {
    probe = await boot(work)
    const keys = probe.hooks.map((h) => (h.key ? `${h.name} ${h.key}` : h.name))
    assert(new Set(keys).size === keys.length, `重なり: ${keys.join(' / ')}`)
    for (const need of ['session.start', 'command.run', 'tool.call', 'ui.render']) assert(keys.some((k) => k.startsWith(need)), `${need} のフックが無い`)
    for (const k of keys) console.log(`       ${k}`)
    return `${keys.length} 本`
  })
  if (!probe) throw new Error('読み込めなかったので先へ進めない')

  await check('tool.check は握らない（ファイルを書く道具は人の許可の流れに任せる）', () => {
    const hit = probe.hooks.filter((h) => h.name === 'tool.check' || h.name === 'tool.deny')
    assert(!hit.length, hit.map((h) => h.name).join(','))
  })

  await check('session.start で 6 つの道具と /pdf を登録し、書体の時計を始める', async () => {
    const app = await boot(work)
    await app.start()
    const names = app.log.tools.map((t) => t.name).sort().join(',')
    assert(names === 'fields,fill,make,merge,revise,stamp', `道具: ${names}`)
    for (const t of app.log.tools) assert(t.inputSchema?.type === 'object' && t.description.length > 20, `${t.name} の定義が足りない`)
    const cmd = app.log.commands.find((c) => c.name === 'pdf')
    assert(cmd, '/pdf が登録されていない')
    assert(app.timers.some((t) => t.kind === 'every' && t.ms === 1000), '1 秒の時計が無い')
  })

  // 1 つ目の流れ: 時計で書体を読み、欄の「見本を作る」を押す
  const a = await boot(work)
  await a.start()
  await check('書体は時計で 1 つずつ読み、欄の上の行に読み込みの様子と秒が出る', async () => {
    const before = allText(await a.render())
    assert(/書体を読み込み中 0\/4/.test(before), `読む前: ${before}`)
    assert(button(await a.render(), 'pdf:sample'), '見本を作るボタンが無い')
    const t = a.timers.find((x) => x.kind === 'every')
    const inv0 = a.log.invalidated
    t.fn()
    for (let i = 0; i < 400 && a.log.invalidated === inv0; i++) await sleep(50)
    const one = allText(await a.render())
    assert(/書体を読み込み中 1\/4/.test(one), `1 つ読んだ後: ${one}`)
    await runFontTimer(a)
    const done = allText(await a.render())
    assert(/書体の読み込み \d+\.\d 秒/.test(done), `読み終えた後: ${done}`)
    return done.match(/書体の読み込み [\d.]+ 秒/)[0]
  })

  await check('欄の「見本を作る」で見本が組まれ、頁の絵（SVG）が出る', async () => {
    const tree = await a.render()
    button(tree, 'pdf:sample').props.onPress()
    let shown
    for (let i = 0; i < 600; i++) {
      shown = await a.render()
      if (nodes(shown, 'Svg').length) break
      await sleep(100)
    }
    const svgs = nodes(shown, 'Svg')
    assert(svgs.length === 1, `Svg が ${svgs.length} 個`)
    const s = svgs[0].props
    assert(s.source.startsWith('<svg') && s.source.length <= 131072, `SVG の字が不正（${s.source.length}）`)
    assert(s.width > 0 && s.height > 0 && s.alt.includes('1 /'), `Svg の大きさ・alt: ${s.width}×${s.height} ${s.alt}`)
    assert(a.log.written.includes('pdf/sample.pdf'), `書いた場所: ${a.log.written.join(',')}`)
    const text = fs.readFileSync(path.join(work, 'pdf', 'sample.pdf'), 'latin1')
    pdfOk(text, 'sample.pdf')
    assert(text.includes('/Outlines'), 'しおりが無い')
    assert(text.includes('/AcroForm'), '記入欄（AcroForm）が無い')
    return `${text.length} 字・SVG ${s.source.length} 字`
  })

  await check('欄: 頁を送ると 2 / N になり、最後の頁で止まり、戻せる', async () => {
    const pages = Number(allText(await a.render()).match(/1 \/ (\d+)/)?.[1])
    assert(pages >= 2, `頁数 ${pages}`)
    for (let i = 0; i < pages + 2; i++) button(await a.render(), 'pdf:next').props.onPress()
    const last = allText(await a.render())
    assert(last.includes(`${pages} / ${pages}`), `最後の頁: ${last}`)
    button(await a.render(), 'pdf:prev').props.onPress()
    assert(allText(await a.render()).includes(`${pages - 1} / ${pages}`), '戻せない')
    return `${pages} 頁`
  })

  await check('欄: 端末では絵を描かず、題名と場所を字で出す', async () => {
    const tree = await a.render('terminal', 100, 30)
    assert(nodes(tree, 'Svg').length === 0, '端末に Svg がある')
    const t = allText(tree)
    assert(t.includes('ModsPDF の見本') && t.includes('pdf/sample.pdf'), t)
  })

  await check('欄: 開くボタンは時計から PowerShell の Start-Process を呼び、場所は環境変数で渡す', async () => {
    button(await a.render(), 'pdf:open').props.onPress()
    assert(a.log.ran.length === 0, '押した出来事の中で外のプログラムを始めた')
    const t = a.timers.find((x) => x.kind === 'after')
    assert(t, 'after の時計が無い')
    t.fn()
    for (let i = 0; i < 100 && !a.log.ran.length; i++) await sleep(20)
    const r = a.log.ran[0]
    assert(r, 'process.run が呼ばれない')
    const cmdline = r.argv.join(' ')
    if (/^[A-Za-z]:[\\/]/.test(work)) {
      assert(r.argv[0] === 'powershell.exe' && /Start-Process -FilePath \$env:MPDF_FILE/.test(cmdline), `argv: ${cmdline}`)
    }
    assert(r.env?.MPDF_FILE?.endsWith('sample.pdf'), `env: ${JSON.stringify(r.env)}`)
    assert(!cmdline.includes('sample.pdf'), 'コマンドの字に場所が埋まっている')
  })

  // 2 つ目の流れ: 書体を先に読まずに道具を呼ぶ（その場で読む）
  const b = await boot(work)
  await b.start()
  let madeText = ''
  await check('make: 書体を読む前でもその場で読み、./pdf/ に書いて、警告と組版の数字を返す', async () => {
    const out = await b.tool('make', { title: '見積書', markdown: '# 見積\n\n{紫陽花|あじさい}の件です。Claude Code の費用は 12,000 円です。\n\n| 項目 | 金額 |\n|---|---:|\n| 作業 | 10,000 |\n' })
    assert(typeof out.result === 'string' && out.result.startsWith('書きました: pdf/'), String(out.result))
    assert(/組版: 行 \d+/.test(out.result), out.result)
    const file = b.log.written.find((p) => p.startsWith('pdf/'))
    madeText = fs.readFileSync(path.join(work, file), 'latin1')
    pdfOk(madeText, file)
    return file
  })

  await check('make: 画像を作業フォルダーから読んで入れ、読めない画像は警告にして続ける', async () => {
    fs.writeFileSync(path.join(work, 'pic.png'), PNG_1X1)
    fs.writeFileSync(path.join(work, 'fake.png'), 'これは画像ではない')
    const out = await b.tool('make', { title: '画像つき', file: 'img', markdown: '# 画像\n\n![ちいさな絵](pic.png)\n\n![にせもの](fake.png)\n\n![外](../outside.png)\n' })
    assert(out.result.startsWith('書きました: pdf/img.pdf'), out.result)
    assert(out.result.includes('PNG か JPEG として読めなかった'), `にせの画像の警告が無い: ${out.result}`)
    assert(out.result.includes('作業フォルダーの外') || out.result.includes('.. を含む'), `外の画像の警告が無い: ${out.result}`)
    const text = fs.readFileSync(path.join(work, 'pdf', 'img.pdf'), 'latin1')
    pdfOk(text, 'img.pdf')
    assert(text.includes('/Subtype /Image') || text.includes('/Subtype/Image'), '画像が PDF に入っていない')
  })

  await check('make: blocks でも組める（別の領域の配列を作り直して渡す）', async () => {
    const out = await b.tool('make', { title: 'ブロック', file: 'blocks', blocks: [{ type: 'heading', level: 1, text: '見出し' }, { type: 'para', text: '本文です。' }] })
    assert(out.result.startsWith('書きました: pdf/blocks.pdf'), out.result)
  })

  await check('make: title が無い時は投げずに理由を返す', async () => {
    const out = await b.tool('make', { markdown: '# だけ' })
    assert(typeof out.result === 'string' && !out.result.startsWith('書きました'), String(out.result))
    assert(out.deny === undefined, 'deny にしている（Claude が直せない）')
  })

  // 見本を作って、既存 PDF の道具を通す
  await check('/pdf sample: 見本を ./pdf/sample.pdf に書いて欄を開く', async () => {
    const out = await b.command('sample')
    assert(/見本を pdf\/sample\.pdf に書きました（\d+ 頁）/.test(out.text), JSON.stringify(out))
    const open = b.log.opened.at(-1)
    assert(open.id === 'mods-pdf' && open.focus === true && open.closeOnEscape === true, JSON.stringify(open))
  })

  await check('fields: 記入欄の一覧を返し、PDF の字はデータとして読めと context で添える', async () => {
    const out = await b.tool('fields', { path: 'pdf/sample.pdf' })
    assert(/記入欄 4 個/.test(out.result), out.result)
    for (const name of ['氏名', 'メール', '同意', '種別']) assert(out.result.includes(JSON.stringify(name)), `${name} が無い`)
    assert(Array.isArray(out.context) && out.context.length >= 1, 'context が無い')
  })

  await check('fill: 日本語の値を欄に入れ、PDF に無い名前は missing として返す', async () => {
    const out = await b.tool('fill', { path: 'pdf/sample.pdf', values: { 氏名: '山田 太郎', 同意: true, 種別: '法人', 存在しない欄: 'x' } })
    assert(out.result.startsWith('書きました: pdf/sample-filled.pdf'), out.result)
    assert(/埋めた欄 3 個/.test(out.result) && /PDF に無い名前 1 個/.test(out.result), out.result)
    pdfOk(fs.readFileSync(path.join(work, 'pdf', 'sample-filled.pdf'), 'latin1'), 'sample-filled.pdf')
    const back = await b.tool('fields', { path: 'pdf/sample-filled.pdf' })
    assert(back.result.includes('山田 太郎'), `入れた値が読み戻せない: ${back.result}`)
  })

  await check('stamp: スキャン様式に字を書き込む（mm・左上から）', async () => {
    const out = await b.tool('stamp', { path: 'pdf/sample.pdf', marks: [{ page: 1, x: 20, y: 30, text: '山田 太郎' }, { page: 1, x: 20, y: 40, text: 'ABC 123', size: 9 }], file: 'stamped' })
    assert(out.result.startsWith('書きました: pdf/stamped.pdf（字を 2 か所'), out.result)
    pdfOk(fs.readFileSync(path.join(work, 'pdf', 'stamped.pdf'), 'latin1'), 'stamped.pdf')
  })

  await check('stamp: 頁が範囲の外なら投げずに理由を返す', async () => {
    const out = await b.tool('stamp', { path: 'pdf/sample.pdf', marks: [{ page: 99, x: 1, y: 1, text: 'x' }] })
    assert(out.result.includes('stamp に失敗しました') && out.result.includes('範囲の外'), out.result)
  })

  await check('merge: 複数の PDF から頁を選んで結合する', async () => {
    const out = await b.tool('merge', { parts: [{ path: 'pdf/sample.pdf', pages: '1-2' }, { path: 'pdf/stamped.pdf', pages: '1' }], file: 'merged' })
    assert(/書きました: pdf\/merged\.pdf（2 個の PDF から 3 頁/.test(out.result), out.result)
    pdfOk(fs.readFileSync(path.join(work, 'pdf', 'merged.pdf'), 'latin1'), 'merged.pdf')
  })

  await check('読む場所の断り: 絶対パス・.. ・拡張子違い・無いファイル・大きすぎるファイル', async () => {
    fs.writeFileSync(path.join(work, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(work, 'big.pdf'), Buffer.alloc(3 * 1024 * 1024 + 10, 0x20))
    const cases = [
      ['/etc/passwd', '使えません'],
      ['C:\\Windows\\win.ini', '使えません'],
      ['..\\x.pdf', '使えません'],
      ['notes.txt', '読めるのは pdf'],
      ['missing.pdf', 'ファイルがありません'],
      ['big.pdf', '大きすぎます'],
    ]
    for (const [p, want] of cases) {
      const out = await b.tool('fields', { path: p })
      assert(typeof out.result === 'string' && out.result.startsWith('断りました') && out.result.includes(want), `${p} -> ${out.result}`)
      assert(out.deny === undefined, `${p}: deny にしている`)
    }
    return `${cases.length} 件`
  })

  await check('読む場所の断り: 作業フォルダーの外を指すリンクは読まない', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-pdf-outside-'))
    try {
      fs.copyFileSync(path.join(work, 'pdf', 'sample.pdf'), path.join(outside, 'secret.pdf'))
      // Windows は管理者でなくてもフォルダーのジャンクションなら作れる。ファイルのリンクを作れない環境ではこちらで確かめる
      let rel
      try {
        fs.symlinkSync(path.join(outside, 'secret.pdf'), path.join(work, 'link.pdf'), 'file')
        rel = 'link.pdf'
      } catch {
        try {
          fs.symlinkSync(outside, path.join(work, 'linkdir'), 'junction')
          rel = 'linkdir/secret.pdf'
        } catch (error) {
          return `リンクを作れない環境のため省略（${error.code}）`
        }
      }
      const out = await b.tool('fields', { path: rel })
      assert(out.result.startsWith('断りました') && out.result.includes('作業フォルダーの外'), `${rel} -> ${out.result}`)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  await check('書く場所の掃除: 題名の危ない字は - になり、必ず ./pdf/ の下に書く', async () => {
    const out = await b.tool('make', { title: 'x', file: '..\\..\\evil:name', markdown: '# a' })
    const w = b.log.written.at(-1)
    assert(/^pdf\/[^/\\:]+\.pdf$/.test(w), `書いた場所: ${w}`)
    assert(out.result.startsWith('書きました'), out.result)
  })

  // samples/*.json（make の引数）を全部、本体の make を通して組む。OUT=<フォルダー> を付けると、そこへ PDF を書き出す（pdftoppm などで見る）
  const samplesDir = path.join(modDir, 'samples')
  const sampleFiles = fs.existsSync(samplesDir) ? fs.readdirSync(samplesDir).filter((n) => n.endsWith('.json')).sort() : []
  for (const name of sampleFiles) {
    await check(`samples/${name} を組んで PDF にする（7 ビット・4 MiB 未満・しおり）`, async () => {
      const input = JSON.parse(fs.readFileSync(path.join(samplesDir, name), 'utf8'))
      const base = `sample-${name.replace(/\.json$/, '')}`
      const out = await b.tool('make', { ...input, file: base })
      assert(typeof out.result === 'string' && out.result.startsWith(`書きました: pdf/${base}.pdf`), String(out.result))
      const text = fs.readFileSync(path.join(work, 'pdf', `${base}.pdf`), 'latin1')
      pdfOk(text, base)
      assert(text.includes('/Outlines'), `${base}: しおりが無い`)
      if (process.env.OUT) {
        fs.mkdirSync(path.resolve(process.env.OUT), { recursive: true })
        fs.writeFileSync(path.resolve(process.env.OUT, `${base}.pdf`), text, 'latin1')
      }
      const pages = out.result.match(/（(\d+) [頁枚]/)?.[1]
      const time = out.result.match(/時間: (.+)/)?.[1]
      const warns = out.result.match(/警告 (\d+) 件/)?.[1] ?? '0'
      return `${pages} 頁・${text.length} 字・${time ?? ''}・警告 ${warns} 件`
    })
  }

  // 3 つ目の流れ: 読み直しの後に前の文書を組み直す
  await check('読み直しの後、store の記録から前の文書を組み直して欄に出す（書き直さない）', async () => {
    const c = await boot(work, b.store)
    const writtenBefore = c.log.written.length
    await c.start()
    assert(!nodes(await c.render(), 'Svg').length, '組み直す前に文書が出ている')
    await runFontTimer(c)
    const tree = await c.render()
    assert(nodes(tree, 'Svg').length === 1, '組み直した文書が出ない')
    assert(c.log.written.length === writtenBefore, 'PDF を書き直した')
  })

  await check('/pdf: 引数なしで欄を開き、open は文書が無ければ案内する', async () => {
    const fresh = await boot(work)
    await fresh.start()
    const out = await fresh.command('open')
    assert(/開く文書がありません/.test(out.text), JSON.stringify(out))
    const bad = await fresh.command('nonsense')
    assert(/使い方/.test(bad.text), JSON.stringify(bad))
    const plain = await fresh.command('')
    assert(JSON.stringify(plain) === '{}', JSON.stringify(plain))
    assert(fresh.log.opened.at(-1)?.focus === true, '欄を開いていない')
  })

  // ---- 資料（deck）。b は書体を読み終えている。make した資料は store の pdf:last に残り、revise がそれを直す ----
  // slides を手で並べる（template・plan・markdown の --- は schema と bizplan の持ち物で、ここは本体の通りだけを確かめる）。図は形の見本の data をそのまま使う
  const { LOOKS } = await import(pathToFileURL(path.join(hooksDir, 'engine', 'looks', 'index.mjs')).href)
  const figureSlide = (id, title) => ({ type: 'slide', layout: 'figure', title, lead: `形 ${id} の見本`, figure: { type: 'chart', kind: id, data: LOOKS[id].sample() } })
  const point = (n) => ({ type: 'slide', layout: 'content', title: `要点 ${n}`, lead: '数字を先に、理由を後に書く', blocks: [
    { type: 'para', text: `${n} 枚目の本文です。約物の詰め、和欧間の Claude Code 12,000 円、禁則が、資料の中でも同じ規則で組まれます。` },
    { type: 'list', ordered: false, items: ['一つ目の点', '二つ目の点', '三つ目の点'] },
  ] })
  const deck15 = () => [
    { type: 'slide', layout: 'cover', title: '事業計画の見本', lead: '架空の会社', kicker: '2026年10月' },
    { type: 'slide', layout: 'section', title: '市場と課題', lead: '町工場の受注管理' },
    { type: 'slide', layout: 'statement', title: '受注と在庫を 1 つの画面にそろえる' },
    point(4),
    { type: 'slide', layout: 'split', title: '課題と解決', left: [{ type: 'list', ordered: false, items: ['紙と表計算に散らばる', '在庫が合わない'] }], right: [{ type: 'card', label: '解決', text: '現場の端末から 3 タップで入力する' }] },
    figureSlide('donut', '市場の内訳'),
    figureSlide('multi-line', '導入の推移'),
    { type: 'slide', layout: 'kpi', title: '実績', items: [{ label: '導入工場', value: '30', unit: '社' }, { label: '月次経常収益', value: '800', unit: '万円' }, { label: '継続率', value: '97', unit: '%' }] },
    { type: 'slide', layout: 'compare', title: '比べ', items: [{ title: '表計算', points: ['手軽', '在庫が合わない'] }, { title: '本製品', points: ['現場で入力', '会計へ CSV'], highlight: true }] },
    { type: 'slide', layout: 'table', title: '収支の見通し', blocks: [{ type: 'table', head: ['年', '売上', '費用'], rows: [['2027', '2.0', '2.8'], ['2028', '4.5', '4.8'], ['2029', '9.0', '8.0']], align: ['left', 'right', 'right'] }] },
    figureSlide('waterfall', '利益の内訳'),
    { type: 'slide', layout: 'quote', quote: '小さな工場にも、使える道具を。', by: '創業者' },
    figureSlide('bars', '売上の伸び'),
    point(14),
    { type: 'slide', layout: 'closing', title: 'ご清聴ありがとうございました', items: [{ text: '次の一歩: 導入先の工場を 10 社増やす' }] },
  ]
  const readPdf = (name) => fs.readFileSync(path.join(work, 'pdf', name), 'latin1')
  const lastRecord = () => b.store.get('pdf:last')

  await check('資料 15 枚を vm で 3 秒以内に組んで書ける（1 枚 = 1 頁・横 A4）', async () => {
    const t0 = performance.now()
    const out = await b.tool('make', { title: '資料の通し', file: 'deck15', kind: 'deck', slides: deck15() })
    const ms = performance.now() - t0
    assert(typeof out.result === 'string' && out.result.startsWith('書きました: pdf/deck15.pdf（15 枚'), String(out.result))
    assert(ms < 3000, `${Math.round(ms)} ms かかった`)
    const text = readPdf('deck15.pdf')
    pdfOk(text, 'deck15.pdf')
    assert(text.includes('/Outlines'), 'しおりが無い')
    assert(/\/MediaBox\s*\[\s*0\s+0\s+841\.8\d*\s+595\.2\d*\s*\]/.test(text), `横 A4 の MediaBox が無い: ${(text.match(/\/MediaBox[^\]]*\]/) ?? ['なし'])[0]}`)
    assert((text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length === 15, `頁の数が 15 でない`)
    assert(/枚の題: 1 /.test(out.result), `枚の題の一覧が無い: ${out.result}`)
    return `${Math.round(ms)} ms・${text.length} 字・${out.result.match(/時間: (.+)/)?.[1] ?? ''}`
  })

  await check('資料の欄は横長の頁を出し、ボタンは「枚」', async () => {
    const tree = await b.render()
    const svgs = nodes(tree, 'Svg')
    assert(svgs.length === 1, `Svg が ${svgs.length} 個`)
    const s = svgs[0].props
    assert(s.width > s.height, `横長でない: ${s.width}×${s.height}`)
    const view = s.source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
    assert(view && Number(view[1]) > Number(view[2]), `viewBox が横長でない: ${view?.[0]}`)
    assert(allText(tree).includes('1 / 15') && button(tree, 'pdf:next'), '頁送りが無い')
    assert(b.log.opened.at(-1)?.rows < 33, `欄に頼む行が縦のまま: ${b.log.opened.at(-1)?.rows}`)
    return `${Math.round(s.width)}×${Math.round(s.height)}・欄 ${b.log.opened.at(-1)?.rows} 行`
  })

  await check('revise: 差し替え・挿入・削除・移動を同じ場所に書き直し、store の入力に反映する', async () => {
    const titleOf = (rec) => rec.input.slides.map((s) => s.title ?? '')
    let rec = await lastRecord()
    assert(rec.input.slides.length === 15 && rec.path === 'pdf/deck15.pdf', `記録: ${rec.path} ${rec.input.slides.length}`)
    const before = titleOf(rec)
    const called = async (ops, want) => {
      const t0 = performance.now()
      const out = await b.tool('revise', { ops })
      assert(typeof out.result === 'string' && out.result.startsWith(`直して書きました: pdf/deck15.pdf（${want} 枚`), String(out.result))
      pdfOk(readPdf('deck15.pdf'), 'deck15.pdf')
      rec = await lastRecord()
      assert(rec.input.slides.length === want && rec.path === 'pdf/deck15.pdf', `記録: ${rec.path} ${rec.input.slides.length}`)
      return Math.round(performance.now() - t0)
    }
    const ms = []
    ms.push(await called([{ action: 'replace', index: 3, slide: { layout: 'statement', title: '差し替えた 1 枚' } }], 15))
    assert(titleOf(rec)[2] === '差し替えた 1 枚', `差し替え: ${titleOf(rec)[2]}`)
    ms.push(await called([{ action: 'insert', index: 2, slide: { layout: 'section', title: '挿した章' } }], 16))
    assert(titleOf(rec)[1] === '挿した章' && titleOf(rec)[3] === '差し替えた 1 枚', '挿入の位置')
    ms.push(await called([{ action: 'delete', index: 2 }], 15))
    assert(titleOf(rec).join('|') === [before[0], before[1], '差し替えた 1 枚', ...before.slice(3)].join('|'), '削除の後の並び')
    ms.push(await called([{ action: 'move', index: 1, to: 15 }], 15))
    assert(titleOf(rec)[14] === before[0] && titleOf(rec)[0] === before[1], '移動の後の並び')
    ms.push(await called([{ action: 'delete', index: 15 }, { action: 'insert', index: 1, slide: { layout: 'cover', title: '新しい表紙' } }], 15))
    assert(titleOf(rec)[0] === '新しい表紙', '順に当たる 2 つの op')
    return `${ms.join('・')} ms`
  })

  await check('revise: 用紙と色を替えて同じ場所に書き直す（wide は 960×540）', async () => {
    const out = await b.tool('revise', { paper: 'wide', theme: 'mono' })
    assert(out.result.startsWith('直して書きました: pdf/deck15.pdf'), out.result)
    const text = readPdf('deck15.pdf')
    assert(/\/MediaBox\s*\[\s*0\s+0\s+960\s+540\s*\]/.test(text), `wide の MediaBox が無い: ${(text.match(/\/MediaBox[^\]]*\]/) ?? ['なし'])[0]}`)
    const rec = await lastRecord()
    assert(rec.input.paper === 'wide' && rec.input.theme === 'mono', JSON.stringify([rec.input.paper, rec.input.theme]))
  })

  await check('revise: 範囲の外の index・資料でない文書・別の path は、何も書かずに断る', async () => {
    const before = readPdf('deck15.pdf')
    const bad = await b.tool('revise', { ops: [{ action: 'delete', index: 1 }, { action: 'delete', index: 99 }] })
    assert(bad.result.startsWith('断りました') && bad.result.includes('ops[2]'), bad.result)
    assert(bad.deny === undefined, 'deny にしている')
    assert((await lastRecord()).input.slides.length === 15, '失敗したのに記録が変わった')
    assert(readPdf('deck15.pdf') === before, '失敗したのに PDF を書き換えた')
    const other = await b.tool('revise', { path: 'pdf/other.pdf', ops: [{ action: 'delete', index: 1 }] })
    assert(other.result.startsWith('断りました') && other.result.includes('最後に組んだ資料'), other.result)
    await b.tool('make', { title: '文書のまま', file: 'plain-doc', markdown: '# 文書\n\n本文です。' })
    const doc = await b.tool('revise', { ops: [{ action: 'delete', index: 1 }] })
    assert(doc.result.startsWith('断りました') && doc.result.includes('資料'), doc.result)
    assert(!b.log.written.includes('pdf/plain-doc-2.pdf'), '文書への revise が別の名前で書いた')
  })

  await check('/pdf sample deck: 事業計画の見本を ./pdf/sample-deck.pdf に書いて欄を開く', async () => {
    const t0 = performance.now()
    const out = await b.command('sample deck')
    const ms = performance.now() - t0
    assert(/資料の見本を pdf\/sample-deck\.pdf に書きました（\d+ 枚）/.test(out.text), JSON.stringify(out))
    const text = readPdf('sample-deck.pdf')
    pdfOk(text, 'sample-deck.pdf')
    const pages = Number(out.text.match(/（(\d+) 枚）/)[1])
    assert(pages >= 12, `見本が ${pages} 枚しかない`)
    assert(ms < 3000, `${Math.round(ms)} ms かかった`)
    const open = b.log.opened.at(-1)
    assert(open.id === 'mods-pdf' && open.focus === true, JSON.stringify(open))
    return `${pages} 枚・${Math.round(ms)} ms`
  })

  await check('revise: plan から広がった資料（bizplan）にも、広げた並びに直しを当てられる', async () => {
    const made = await b.command('sample deck')
    const n = Number(made.text.match(/（(\d+) 枚）/)?.[1])
    assert(n >= 2, made.text)
    const out = await b.tool('revise', { ops: [{ action: 'delete', index: 2 }] })
    assert(out.result.startsWith(`直して書きました: pdf/sample-deck.pdf（${n - 1} 枚`), out.result)
    const rec = await lastRecord()
    assert(rec.input.template === undefined && rec.input.plan === undefined && rec.input.slides.length === n - 1, `記録: ${Object.keys(rec.input)} ${rec.input.slides?.length}`)
    // 広げた後の並びは、もう一度 revise しても同じように当たる（normalize の出力を normalize に戻せる）
    const again = await b.tool('revise', { ops: [{ action: 'move', index: 1, to: 2 }] })
    assert(again.result.startsWith(`直して書きました: pdf/sample-deck.pdf（${n - 1} 枚`), again.result)
    return `${n} 枚 → ${n - 1} 枚`
  })

  await check('revise: markdown を --- で割った資料にも、広げた並びに直しを当てられる', async () => {
    const markdown = ['# 第一章', '', '---', '', '## 一枚目', '', '本文です。', '', '---', '', '## 二枚目', '', '- 点 A', '- 点 B'].join('\n')
    const made = await b.tool('make', { title: '割った資料', file: 'split-deck', kind: 'deck', markdown })
    const n = Number(made.result.match(/（(\d+) 枚/)?.[1])
    assert(n === 3, made.result)
    const out = await b.tool('revise', { ops: [{ action: 'delete', index: 1 }] })
    assert(out.result.startsWith('直して書きました: pdf/split-deck.pdf（2 枚'), out.result)
    return '3 枚 → 2 枚'
  })

  // フック 1 回は 10 秒（設計書 §2 の 5）。markdown の上限（20 万字）の文書を、フックの環境のまま 3 秒以内に組む。入力が 20 万字を超える make は store に残らないので、store を使う流れの後に置く。
  // vm の文脈は大域の名前（Math など）の参照が遅く、熱い経路で Math.min を字ごとに引くと Node の 5 倍かかる（3.7 秒）。Node で測っても気づけない
  const proseFile = path.join(samplesDir, 'prose.json')
  if (fs.existsSync(proseFile)) {
    await check('20 万字の文書を組んで PDF にするのが 3 秒以内（フックの環境。10 秒の上限に余裕を残す）', async () => {
      const prose = JSON.parse(fs.readFileSync(proseFile, 'utf8'))
      let markdown = ''
      while (markdown.length < 200000) markdown += `${prose.markdown}\n\n`
      const t0 = performance.now()
      const out = await b.tool('make', { title: '二十万字', markdown: markdown.slice(0, 200000), file: 'big-200k' })
      const ms = performance.now() - t0
      assert(typeof out.result === 'string' && out.result.startsWith('書きました'), String(out.result))
      assert(ms < 3000, `${Math.round(ms)} ms かかった`)
      return `${out.result.match(/（(\d+) 頁/)?.[1]} 頁・${out.result.match(/時間: (.+)/)?.[1] ?? ''}`
    })
  }

  // 英語はハイフネーション（語ごとに割れる位置を引き、行ごとに割る候補を足す）の分だけ日本語より重い。日本語の 20 万字だけを見ていると、英語で遅くなっても気づけない
  const enFile = path.join(samplesDir, 'en.json')
  if (fs.existsSync(enFile)) {
    await check('英語の 20 万字の文書（ハイフネーションあり）を組んで PDF にするのが 3 秒以内', async () => {
      const en = JSON.parse(fs.readFileSync(enFile, 'utf8'))
      let markdown = ''
      while (markdown.length < 200000) markdown += `${en.markdown}\n\n`
      const t0 = performance.now()
      const out = await b.tool('make', { title: 'Two hundred thousand', markdown: markdown.slice(0, 200000), lang: 'en', file: 'big-200k-en' })
      const ms = performance.now() - t0
      assert(typeof out.result === 'string' && out.result.startsWith('書きました'), String(out.result))
      assert(ms < 3000, `${Math.round(ms)} ms かかった`)
      return `${out.result.match(/（(\d+) 頁/)?.[1]} 頁・${out.result.match(/時間: (.+)/)?.[1] ?? ''}`
    })
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

if (fails.length) {
  console.log(`\n${fails.length} 件失敗: ${fails.join(' / ')}`)
  process.exitCode = 1
} else {
  console.log('\nすべて通った')
}
