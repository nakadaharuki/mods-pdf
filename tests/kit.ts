// 試験の道具: claude plugin test の stub を、Mod が触る API（fs・store・ui・process・command・tool）の分だけまとめて入れる。
// 選ばなかった案: 試験ごとに stub を手で並べる案。fs の読み・stat・書きは同じ形が 10 本以上の試験で要り、直す所が散らばる。
// 日本語の文は *.test.ts の側に置く（scripts/build-test-fonts.mjs が *.test.ts の字だけを試験用の書体に残すため）。
import { mock } from 'claude-code/testing'
import { TEST_FONT_FILES, TEST_MANIFEST } from './test-fonts'

/** 作業フォルダーの中のファイル（相対パス → 中身）。size を指定すれば stat の大きさだけ変える。outside は realPath を外へ向ける */
export type FileSpec = { base64: string; size?: number; outside?: boolean }

/** 区切りを / にそろえる（kit は相対パスを絶対にして、Windows では \ を使う） */
const norm = (p: unknown) => String(p).replace(/[\\/]+/g, '/')

/** 文字列を 7 ビットの PDF の base64 にする（PDF の本文は 7 ビットなので btoa が通る） */
export const b64OfText = (text: string) => btoa(text)
export const textOfB64 = (b64: string) => atob(b64)

export type Stubbed = {
  clock: ReturnType<typeof mock.clock>
  files: Record<string, FileSpec>
  /** fs.write で書かれた物（相対パス → 字） */
  written: Record<string, string>
  reads: string[]
  opened: any[]
  ran: { argv: string[]; env?: Record<string, string> }[]
  logs: string[]
  store: Map<string, unknown>
  tools: string[]
  commands: string[]
}

/**
 * Mod が触る API に stub を入れる。$ の最初の呼び出しの前に呼ぶ。
 * files は作業フォルダーの中の読めるファイル。fonts/ の下は試験用の小さな書体を返す。
 */
export function stubAll(on: any, init: { files?: Record<string, FileSpec>; store?: Record<string, unknown> } = {}): Stubbed {
  const s: Stubbed = {
    clock: mock.clock(on),
    files: { ...(init.files ?? {}) },
    written: {},
    reads: [],
    opened: [],
    ran: [],
    logs: [],
    store: new Map(Object.entries(init.store ?? {})),
    tools: [],
    commands: [],
  }
  const keyOf = (p: unknown): string | undefined => {
    const n = norm(p)
    return Object.keys(s.files)
      .sort((a, b) => b.length - a.length)
      .find((k) => n === k || n.endsWith('/' + k))
  }
  on('session.start', () => ({ cwd: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('tool.register', ($: any, e: any) => { s.tools.push(e.name); return { value: undefined } })
  on('command.register', ($: any, e: any) => { s.commands.push(e.name); return { value: undefined } })
  on('store.get', ($: any, e: any) => ({ value: s.store.get(e.key) }))
  on('store.set', ($: any, e: any) => { s.store.set(e.key, e.value); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { s.logs.push(String(e.text)); return { value: undefined } })
  on('ui.open', ($: any, e: any) => { s.opened.push(e); return { value: { isPlaced: true } } })
  on('process.run', ($: any, e: any) => { s.ran.push({ argv: e.argv, env: e.init?.env }); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('fs.stat', ($: any, e: any) => {
    const n = norm(e.path)
    // 作業フォルダー自身。realPath は stub の中で決めた場所（/work）にそろえる
    if (n.endsWith('/work')) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/work' } }
    const key = keyOf(e.path)
    if (key === undefined) return { deny: 'ENOENT: no such file' }
    const f = s.files[key]
    return { value: { kind: 'file', size: f.size ?? Math.ceil((f.base64.length * 3) / 4), mtimeMs: 0, isLink: false, realPath: `${f.outside ? '/elsewhere' : '/work'}/${key}` } }
  })
  on('fs.read', ($: any, e: any) => {
    const n = norm(e.path)
    s.reads.push(n)
    if (n.endsWith('/fonts/fonts.json')) return { value: JSON.stringify(TEST_MANIFEST) }
    const font = Object.keys(TEST_FONT_FILES).find((name) => n.endsWith('/fonts/' + name))
    if (font) return { value: e.as === 'bytes' ? { base64: TEST_FONT_FILES[font] } : atob(TEST_FONT_FILES[font]) }
    const key = keyOf(e.path)
    if (key === undefined) return { deny: 'ENOENT: no such file' }
    const f = s.files[key]
    return { value: e.as === 'bytes' ? { base64: f.base64 } : atob(f.base64) }
  })
  on('fs.write', ($: any, e: any) => {
    const m = norm(e.path).match(/(pdf\/[^/]+)$/)
    const key = m ? m[1] : norm(e.path)
    s.written[key] = String(e.text)
    s.files[key] = { base64: b64OfText(String(e.text)) }
    return { value: undefined }
  })
  return s
}

/** 欄の mount に渡す物（デスクトップの欄。bodyColumns・bodyRows は mods-trade が本人の画面で測った値に近い） */
export const PANE = (surface: 'terminal' | 'desktop' = 'desktop', bodyColumns = 54, bodyRows = 33) => ({
  plugin: 'mods-pdf',
  component: 'Pane' as const,
  requestId: 'mods-pdf',
  surface,
  viewport: { columns: 140, rows: 40 },
  props: { title: 'ModsPDF', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
})

/** 非同期の仕事（stub の答えを待つ読み込みなど）が終わるまで待つ。時計は進めない */
export async function until(cond: () => boolean | Promise<boolean>, what: string, limitMs = 8000) {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > limitMs) throw new Error(`待ちきれなかった: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** 1 秒の時計を n 回進める。書体は 1 回に 1 つ読むので、続けて進める前に今の 1 つが終わるのを待つ */
export async function tickFonts(s: Stubbed, n: number) {
  for (let i = 0; i < n; i++) {
    const before = s.reads.filter((p) => /\/fonts\/[^/]+\.ttf$/.test(p)).length
    await s.clock.advance(1000)
    await until(() => s.reads.filter((p) => /\/fonts\/[^/]+\.ttf$/.test(p)).length > before, `${i + 1} 回目の書体の読み込み`)
    // 読んだあとの寸法づくりと描き直しの頼みまで終わらせる
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
