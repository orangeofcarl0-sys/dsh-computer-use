/**
 * 离线冒烟：三级投递升级链（deliveryMode='auto'）。
 *
 * 通过临时目录复制 lib/ 并以受控 stub 替换 cuaCall，验证：
 *   A. background 拒 → foreground 前台锁拒 → bring_to_front 绕锁 → 成功 → 恢复原前台；
 *   B. hotkey 的 XAML 先验拒绝（非 JSON 抛错）→ 规范化 ok:false，不升级；
 *   C. 正常成功 → 零升级注记。
 *
 * 运行：node tests/delivery-chain.smoke.mjs（无需 cua-driver 在场）。
 */
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'dsh-cu-smoke-'))
cpSync(join(root, 'lib'), join(work, 'lib'), { recursive: true })

// 受控引擎：按调用序列返回 background 拒 / foreground 前台锁拒 / bring_to_front 后成功
writeFileSync(join(work, 'lib', 'cua.js'), `
export const CUA_SESSION = 'smoke'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export const history = []
export async function cuaCall(tool, args = {}) {
  history.push({ tool, args })
  if (tool === 'get_cursor_position') return { x: 0, y: 0 }
  if (tool === 'move_cursor') return {}
  if (tool === 'scroll') {
    if (args.delivery_mode === 'background') return { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
    if (history.filter(c => c.tool === 'bring_to_front').length === 0) return { code: 'foreground_unavailable', reason: 'target window was not foreground' }
    return { effect: 'confirmed', route: 'global_input' }
  }
  if (tool === 'hotkey') {
    if (args.delivery_mode === 'background') return { code: 'background_unavailable', escalation: { recommended: 'foreground' } }
    throw new Error('could not find a UIA AcceleratorKey or (Ctrl+X)-style name hint')
  }
  if (tool === 'bring_to_front') return { previous_fg_hwnd: 111, now_fg_hwnd: 222 }
  if (tool === 'click') return { effect: 'confirmed' }
  return {}
}
export function isBackgroundUnavailable(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /background_unavailable|background unavailable/i.test(s)
}
export function isForegroundUnavailable(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /foreground_unavailable|foreground unavailable/i.test(s)
}
export function isUnverified(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /unverifiable|delivery_failed|delivery failed/i.test(s) && !/background_unavailable/i.test(s)
}
export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) {
  const force = opts.forceForeground || deliveryMode === 'foreground'
  let value = await cuaCall(tool, { ...payload, delivery_mode: force ? 'foreground' : 'background' })
  if (force || deliveryMode !== 'auto') return { value, note: '' }
  if (!isBackgroundUnavailable(value)) {
    if (isForegroundUnavailable(value)) return { value, note: 'fglock' }
    if (isUnverified(value) && payload.pid && ['click', 'scroll', 'drag'].includes(tool)) {
      return escalate(tool, payload)
    }
    return { value, note: '' }
  }
  value = await cuaCall(tool, { ...payload, delivery_mode: 'foreground' }).catch((e) => ({ error: String(e.message || e) }))
  if (!isForegroundUnavailable(value)) {
    if (isUnverified(value) && payload.pid && ['click', 'scroll', 'drag'].includes(tool)) return escalate(tool, payload)
    return { value, note: 'escalated-l2' }
  }
  if (tool === 'hotkey' || !payload.pid) return { value, note: 'fglock' }
  return escalate(tool, payload)
}
async function escalate(tool, payload) {
  const target = { session: payload.session, pid: payload.pid }
  if (payload.window_id !== undefined && payload.window_id !== null) target.window_id = payload.window_id
  const prev = await cuaCall('bring_to_front', target).catch(() => null)
  const value = await cuaCall(tool, { ...payload, delivery_mode: 'foreground' }).catch((e) => ({ error: String(e.message || e) }))
  if (prev && prev.previous_fg_hwnd !== undefined && prev.previous_fg_hwnd !== null) {
    await cuaCall('bring_to_front', { session: payload.session, window_id: prev.previous_fg_hwnd }).catch(() => undefined)
    return { value, note: '\\n（前台锁拦截 → bring_to_front 绕锁后重试完成，已恢复原前台窗口）' }
  }
  return { value, note: '\\n（bring_to_front 未确认成功）' }
}
`)

const libUrl = (name) => pathToFileURL(join(work, 'lib', name)).href

const { scroll, key, click } = await import(libUrl('actions.js'))
const { setSnapshot } = await import(libUrl('snapshot.js'))
const { history } = await import(libUrl('cua.js'))

const cfg = { ttlMs: 60000, maxElements: 200, allowedApps: [], nativeImage: 'auto', visionProvider: 'x', visionModel: 'y', permissionMode: 'standard', deliveryMode: 'auto' }
const snap = () => setSnapshot({ at: Date.now(), ttlMs: cfg.ttlMs, pid: 100, windowId: 7, appName: 'T', snapshotId: 's1', entries: new Map([[5, { token: 't5', role: '按钮', label: '确定', x: 5, y: 5 }]]), elementCount: 1 })

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

snap(); history.length = 0
let r = await scroll({ direction: 'down', x: 10, y: 20 }, cfg)
const chain = history.map(c => c.tool + (c.args.window_id !== undefined ? '@' + c.args.window_id : ''))
check('A: 三级链触发并恢复原前台', /bring_to_front 绕锁/.test(r.result) && /已恢复原前台/.test(r.result), chain.join(' -> '))

snap(); history.length = 0
r = await key({ key: 'ctrl+?' }, cfg)
check('B: hotkey XAML 先验拒绝 → ok:false 且不升级', r.ok === false && /被引擎拒绝/.test(r.result) && !history.some(c => c.tool === 'bring_to_front'), `calls=${history.length}`)

snap(); history.length = 0
r = await click({ element: 5 }, cfg)
check('C: 正常成功零升级注记', r.ok === true && !/绕锁|已前台重试/.test(r.result), `calls=${history.length}`)

process.exit(failures > 0 ? 1 : 0)
