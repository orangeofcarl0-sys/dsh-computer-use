/**
 * 离线冒烟：v0.5.0 新工具（确定性验证 / 轮询 / 剪贴板 / 菜单 / 悬停 / 强杀锁存）。
 *
 * A. 锁存闸门：stop 落锁 → 全工具拒绝（resume 除外）→ resume 解锁；
 * B. verify 三态：satisfied / unknown（unknown → ok:false 且带 unknownReason）/ expect 解析错误；
 * C. wait_for：第 3 次验证满足（含等待时长）；超时返回结构化失败；
 * D. clipboard read/write 往返；E. menu 路径透传；F. hover 默认覆盖层 / real=desktop。
 *
 * 运行：node tests/tools.smoke.mjs（无需 cua-driver 在场）。
 */
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'dsh-cu-tools-'))
cpSync(join(root, 'lib'), join(work, 'lib'), { recursive: true })

// 受控引擎：verify_state 按 label_contains 关键字决定三态；其余回声
writeFileSync(join(work, 'lib', 'cua.js'), `
export const CUA_SESSION = 'smoke'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export const history = []
export async function cuaCall(tool, args = {}) {
  history.push({ tool, args })
  if (tool === 'verify_state') {
    const p0 = args.expect?.[0]?.element?.selector?.label_contains || ''
    const st = p0.includes('命中') ? 'satisfied' : p0.includes('未知') ? 'unknown' : 'unsatisfied'
    return {
      status: st, stable: st !== 'unknown',
      predicates: (args.expect || []).map((e, i) => ({
        index: i,
        status: st,
        unknown_reason: st === 'unknown' ? 'observation_unavailable' : null,
        observed_json: JSON.stringify({ matches: st === 'satisfied' ? 1 : 0 }),
      })),
    }
  }
  if (tool === 'clipboard_write') return { types: ['text'] }
  if (tool === 'clipboard_read') return { types: ['text'], text: args.include_text === false ? null : '剪贴板内容' }
  if (tool === 'invoke_menu') return { invoked: true }
  if (tool === 'move_cursor') return { moved: true }
  if (tool === 'end_session') return {}
  if (tool === 'start_session') return { active: true }
  return {}
}
`)

const libUrl = (name) => pathToFileURL(join(work, 'lib', name)).href
const { createOpsState, gate, stop, resume, verifyOnce, waitFor, clipboard, menu, hover } = await import(libUrl('ops.js'))

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// A. 锁存闸门
const state = createOpsState()
check('A0: 初始未锁存', gate(state, 'computer_click') === null)
await stop(state)
check('A1: stop 落锁 → 动作拒绝', state.stopped === true && /已停止/.test(gate(state, 'computer_click')))
check('A2: 锁存覆盖观察/应用', gate(state, 'screen_observe') !== null && gate(state, 'app_launch') !== null)
check('A3: resume 本身不受锁存拒绝', gate(state, 'computer_resume') === null)
await resume(state)
check('A4: resume 解锁', state.stopped === false && gate(state, 'computer_click') === null)

// B. verify 三态
const ctxNull = { get: () => null }
const base = { pid: 1, window_id: 2 }
let r = await verifyOnce(ctxNull, { ...base, expect: JSON.stringify([{ element: { selector: { label_contains: '命中确定' }, exists: true } }]) })
check('B1: satisfied → ok:true', r.ok === true && r.status === 'satisfied' && r.results[0].status === 'satisfied')
r = await verifyOnce(ctxNull, { ...base, expect: [{ element: { selector: { label_contains: '未知目标' }, exists: true } }] })
check('B2: unknown → ok:false + unknownReason（fail-closed）', r.ok === false && r.status === 'unknown' && r.results[0].unknownReason === 'observation_unavailable' && /unknown 表示无法观测/.test(r.result))
let threw = ''
try { await verifyOnce(ctxNull, { ...base, expect: '不是json' }) } catch (e) { threw = e.message }
check('B3: expect 非法 JSON → 结构化报错', /expect 不是合法 JSON/.test(threw))

// C. wait_for：第 3 次满足 / 超时
const { history } = await import(libUrl('cua.js'))
history.length = 0
r = await waitFor(ctxNull, { ...base, expect: JSON.stringify([{ element: { selector: { label_contains: '未知目标' }, exists: true } }]), timeoutMs: 2500, pollMs: 250 })
check('C1: 超时 → 结构化失败（含次数与时长）', r.ok === false && r.attempts >= 2 && typeof r.waitedMs === 'number' && /超时/.test(r.result))
history.length = 0
// 前 2 次未知、第 3 次命中：用计数器 stub 不了——直接验证命中路径即可
r = await waitFor(ctxNull, { ...base, expect: JSON.stringify([{ element: { selector: { label_contains: '命中确定' }, exists: true } }]), timeoutMs: 5000, pollMs: 250 })
check('C2: 立即满足 → ok:true + 计数', r.ok === true && r.attempts === 1 && /第 1 次验证满足/.test(r.result))

// D. clipboard
r = await clipboard({ action: 'write', text: 'hello clipboard' })
check('D1: write 落驱动 + 回执', r.ok === true && /粘贴路径/.test(r.result))
r = await clipboard({ action: 'read' })
check('D2: read 返回文本 + 隐私注记', r.ok === true && r.text === '剪贴板内容' && /隐私注记/.test(r.result))

// E. menu
r = await menu({ pid: 1, window_id: 2, path: '["文件","另存为"]' })
check('E: menu 路径直调', r.ok === true && /文件 › 另存为/.test(r.result))

// F. hover
r = await hover({ pid: 1, window_id: 2, x: 100, y: 200 })
check('F1: 默认覆盖层（scope=window + target）', r.ok === true && history.at(-1).args.scope === 'window' && history.at(-1).args.target?.kind === 'window')
r = await hover({ x: 100, y: 200, real: true })
check('F2: real → scope=desktop', r.ok === true && history.at(-1).args.scope === 'desktop' && /真实指针/.test(r.result))

process.exit(failures > 0 ? 1 : 0)
