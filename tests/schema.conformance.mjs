/**
 * 输出 schema 一致性测试（dsh 0.1.5 起对工具输出做严格校验，additionalProperties:false）。
 *
 * 背景：2026-09-16 实测发现 screen_zoom 的降级回执（desktopFallback 的
 * window/elementCount/mode/elements/visualOnly/driverAccess）未在 output schema 声明，
 * dsh 严格校验下整次调用直接报 invalid output——工具等于不可用。这类 bug 只有把
 * "实现可能返回的每一种形态" 都对着 schema 校验一遍才能防住。
 *
 * 方法：受控引擎（复制 lib/ + index.js 到临时目录，替换 lib/cua.js 为可编程桩），
 * 对每个注册工具跑多组场景（正常/拒绝/降级/驱动错误），把返回值对着该工具声明的
 * output.schema 做严格校验（additionalProperties:false、required、type、oneOf、
 * enum、items 递归），并校验 render() 产出内容块数组。
 *
 * 运行：node tests/schema.conformance.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, validateSchema } from './lib/harness.mjs'

const work = makeWorkCopy('schema')

// ── 可编程引擎桩：由 SCENARIO 决定各驱动工具的行为 ────────────────────
writeStubDriver(work, `
export const CUA_BIN = 'stub-cua-driver'
export const CUA_SESSION = 'schema'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable(value) { return Boolean(value && value.ok === false && /后台|background/i.test(String(value.result || ''))) }
export function isForegroundUnavailable(value) { return Boolean(value && value.ok === false && /前台|foreground/i.test(String(value.result || ''))) }
export function isUnverified(value) { return Boolean(value && value.ok === false && /未验证|unverified/i.test(String(value.result || ''))) }
export const calls = []
// 与真实 lib/cua.js 同形：动作链解构 { value, note }，桩返回裸值会让"引擎拒绝"形态测不到
export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) { return { value: await cuaCall(tool, payload), note: '' } }


const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const WINDOW = {
  pid: 4242, window_id: 77, app_name: 'Notepad', title: 'untitled - Notepad',
  bounds: { x: 100, y: 100, width: 800, height: 600 },   // 坐标换算需要（屏幕原点）
}
// 驱动真实字段名是 element_index（observe 据此建快照编号）
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Button', label: 'Save', x: 100, y: 200, width: 60, height: 24 },
  { element_index: 1, element_token: 'tok-1', role: 'Edit', label: 'text', x: 120, y: 300, width: 200, height: 30, value: 'hello' },
  { element_index: 2, element_token: 'tok-2', role: 'AXSecureTextField', label: 'password', x: 120, y: 360, width: 200, height: 30, value: '********' },
]

export async function cuaCall(tool, args = {}) {
  // 每次调用读取场景（测试会在场景之间切换它）
  const SCENARIO = process.env.CUA_STUB_SCENARIO || 'ok'
  calls.push({ tool, args })
  if (SCENARIO === 'driver-error') {
    const err = new Error('cua-driver: engine refused (stub)')
    err.code = 'ENGINE_REFUSED'
    throw err
  }
  // 驱动以"结构化拒绝"表达的动作失败（真实形态：refusal 是对象，见 lib/engine.js）
  if (SCENARIO === 'engine-refusal') {
    if (tool === 'invoke_menu') return { refusal: { code: 'menu_path_unavailable', message: 'no such menu path (stub)' } }
    return { refusal: { code: 'element_not_visible' }, delivery: { mode: 'background' } }
  }
  // 动作成功：真实驱动带 effect/delivery 字段（回执据此走紧凑形态）
  if (['click', 'type_text', 'hotkey', 'press_key', 'scroll', 'drag', 'move_cursor'].includes(tool)) {
    return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
  }
  if (SCENARIO === 'window-denied' && (tool === 'get_window_state' || tool === 'zoom')) {
    throw new Error('window-level observation denied (stub)')
  }
  switch (tool) {
    case 'check_permissions':
      return SCENARIO === 'perms-null' ? null : { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows':
      return { windows: [WINDOW] }
    case 'list_apps':
      return { apps: [{ name: 'Notepad', pid: 4242, bundle_id: '' }] }
    case 'get_window_state':
      return {
        window: WINDOW, elements: ELEMENTS, element_count: ELEMENTS.length,
        screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png',
        screenshot_width: 800, screenshot_height: 600,
      }
    case 'get_desktop_state':
      return { screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png', screenshot_width: 2560, screenshot_height: 1600 }
    case 'zoom':
      return { screenshot_png_b64: PNG1x1, width: 200, height: 150 }
    case 'verify_state': {
      // 驱动真实形态：status + stable + predicates[]（插件按 predicates 规范化，不看 satisfied 布尔）
      const want = process.env.CUA_STUB_PREDICATE || 'satisfied'
      return {
        status: want,
        stable: want === 'satisfied',
        predicates: [{ index: 0, status: want, unknown_reason: want === 'unknown' ? 'element_not_found' : null, observed_json: JSON.stringify({ found: want === 'satisfied' }) }],
      }
    }
    case 'clipboard_read':
      return { text: 'stub-clipboard' }
    case 'get_cursor_position':
      return { x: 10, y: 20 }
    case 'invoke_menu':
      return { ok: true }
    default:
      return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)

// ── ctx 桩：走共享脚手架（tests/lib/harness.mjs）────────────────────────
// computer_task 需要一个可用的 subagents 服务：按 subagentMode 返回三种形态。
//   stub        正常：子会话返回结构化结果
//   unstructured 子会话结束但没有结构化结果（应报失败并附末尾输出）
//   none        宿主不提供 subagents 服务（应返回委派配方）
let subagentMode = 'stub'
const fakeSubagents = {
  list: () => ['spawn'],
  async start() {
    const structured = subagentMode === 'unstructured' ? null : { ok: true, summary: 'stub 完成', evidence: ['stub 证据'] }
    return {
      id: 'child-stub',
      localAgent: {},
      result: Promise.resolve({ stopReason: 'completed', structured, text: '子 agent 末尾输出（stub）' }),
      async dispose() {},
    }
  },
}

// 服务面按场景挂/摘（插件在调用时用 ctx.get 取服务，删键即为"宿主无此能力"）。
const ctxServices = makeServices({ subagents: fakeSubagents })
const { reg: registered, ctx, exec: baseExec } = makeCtx({
  services: ctxServices,
  agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } },
})

function setServices(mode) {
  subagentMode = mode
  if (mode === 'none') delete ctxServices.subagents
  else ctxServices.subagents = fakeSubagents
}

plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })

async function runTool(name, args) {
  const def = registered.get(name)
  if (!def) return { missing: true }
  try {
    const value = await def.execute(args, baseExec)
    return { value, def }
  } catch (err) {
    return { error: err.message, def }
  }
}

// ── 场景矩阵：每个工具 × 会被真实触发的形态 ───────────────────────────
const W = { pid: 4242, window_id: 77 }
const scenarios = [
  // 观察组：正常 + 降级（窗口级被拒 → desktopFallback）+ 驱动错误
  { name: 'observe/ax-ok', stub: 'ok', tool: 'screen_observe', args: { window: '4242', mode: 'ax' } },
  { name: 'observe/native-ok', stub: 'ok', tool: 'screen_observe', args: { window: '4242', mode: 'native' } },
  { name: 'observe/desktop-fallback', stub: 'window-denied', tool: 'screen_observe', args: { window: '4242', mode: 'native' } },
  { name: 'observe/driver-error', stub: 'driver-error', tool: 'screen_observe', args: { window: '4242' } },
  { name: 'observe/perms-null', stub: 'perms-null', tool: 'screen_observe', args: { window: '4242' } },
  { name: 'zoom/ok', stub: 'ok', tool: 'screen_zoom', args: { ...W, x1: 0, y1: 0, x2: 100, y2: 80 } },
  { name: 'zoom/desktop-fallback', stub: 'window-denied', tool: 'screen_zoom', args: { ...W, x1: 0, y1: 0, x2: 100, y2: 80 } },
  { name: 'zoom/driver-error', stub: 'driver-error', tool: 'screen_zoom', args: { ...W } },
  // 动作组：无快照拒绝（守卫路径）
  { name: 'click/no-snapshot', stub: 'ok', tool: 'computer_click', args: { x: 5, y: 5 } },
  { name: 'type/no-snapshot', stub: 'ok', tool: 'computer_type', args: { text: 'hi' } },
  { name: 'key/no-snapshot', stub: 'ok', tool: 'computer_key', args: { key: 'return' } },
  { name: 'scroll/no-snapshot', stub: 'ok', tool: 'computer_scroll', args: { element: 0, direction: 'down', amount: 3 } },
  { name: 'drag/no-snapshot', stub: 'ok', tool: 'computer_drag', args: { from_x: 1, from_y: 1, to_x: 9, to_y: 9 } },
  { name: 'wait/ok', stub: 'ok', tool: 'computer_wait', args: { ms: 50 } },
  { name: 'clipboard/read', stub: 'ok', tool: 'computer_clipboard', args: { action: 'read' } },
  { name: 'clipboard/write', stub: 'ok', tool: 'computer_clipboard', args: { action: 'write', text: 'x' } },
  { name: 'app_list/ok', stub: 'ok', tool: 'app_list', args: {} },
  { name: 'app_launch/ok', stub: 'ok', tool: 'app_launch', args: { app: 'notepad' } },
  { name: 'verify/ok', stub: 'ok', tool: 'computer_verify', args: { window_id: 77, expect: JSON.stringify([{ element: { selector: { role: 'Button', label_contains: 'Save' }, exists: true } }]) } },
  { name: 'verify/unknown', stub: 'ok', tool: 'computer_verify', args: { window_id: 77, expect: '不是json' } },
  { name: 'menu/ok', stub: 'ok', tool: 'computer_menu', args: { window_id: 77, path: JSON.stringify(['Save']) } },
  { name: 'click/driver-error', stub: 'driver-error', tool: 'computer_click', args: { x: 5, y: 5 } },
  // 补齐覆盖：剩余 7 个工具（此前 22 场景只盖到 13 个工具）
  { name: 'double_click/no-snapshot', stub: 'ok', tool: 'computer_double_click', args: { x: 5, y: 5 } },
  { name: 'double_click/element', stub: 'ok', tool: 'computer_double_click', args: { element: 1 } },
  { name: 'right_click/no-snapshot', stub: 'ok', tool: 'computer_right_click', args: { x: 5, y: 5 } },
  { name: 'right_click/driver-error', stub: 'driver-error', tool: 'computer_right_click', args: { x: 5, y: 5 } },
  { name: 'wait_for/satisfied', stub: 'ok', tool: 'computer_wait_for', args: { window_id: 77, timeoutMs: 300, expect: JSON.stringify([{ element: { selector: { role: 'Button', label_contains: 'Save' }, exists: true } }]) } },
  { name: 'wait_for/timeout', stub: 'ok', predicate: 'unsatisfied', tool: 'computer_wait_for', args: { window_id: 77, timeoutMs: 200, pollMs: 100, expect: JSON.stringify([{ element: { selector: { role: 'Button', label_contains: 'Save' }, exists: true } }]) } },
  { name: 'wait_for/bad-predicate', stub: 'ok', tool: 'computer_wait_for', args: { window_id: 77, timeoutMs: 200, expect: '不是json' } },
  { name: 'hover/ok', stub: 'ok', tool: 'computer_hover', args: { x: 5, y: 5 } },
  { name: 'hover/driver-error', stub: 'driver-error', tool: 'computer_hover', args: { x: 5, y: 5 } },
  // 结构化拒绝（引擎以 {ok:false, refusal} 表达，回执必须报失败而不是成功）
  { name: 'click/engine-refusal', stub: 'engine-refusal', tool: 'computer_click', args: { x: 5, y: 5 } },
  { name: 'type/engine-refusal', stub: 'engine-refusal', tool: 'computer_type', args: { text: 'hi' } },
  { name: 'key/engine-refusal', stub: 'engine-refusal', tool: 'computer_key', args: { key: 'return' } },
  { name: 'scroll/engine-refusal', stub: 'engine-refusal', tool: 'computer_scroll', args: { element: 0, direction: 'down', amount: 3 } },
  { name: 'drag/engine-refusal', stub: 'engine-refusal', tool: 'computer_drag', args: { from_x: 1, from_y: 1, to_x: 9, to_y: 9 } },
  { name: 'menu/refusal', stub: 'engine-refusal', tool: 'computer_menu', args: { window_id: 77, path: JSON.stringify(['Save']) } },
  // computer_task：三种返回形态（结构化成功 / 未返回结构化 / 宿主无 subagents 服务）
  { name: 'stop/hit', stub: 'ok', tool: 'computer_stop', args: {} },
  { name: 'resume/hit', stub: 'ok', tool: 'computer_resume', args: {} },
  { name: 'task/structured', stub: 'ok', tool: 'computer_task', args: { goal: '打开记事本' }, subagents: 'stub' },
  { name: 'task/no-structured', stub: 'ok', tool: 'computer_task', args: { goal: '打开记事本' }, subagents: 'unstructured' },
  { name: 'task/no-service', stub: 'ok', tool: 'computer_task', args: { goal: '打开记事本' }, subagents: 'none' },
]

// 让 observe 类工具拥有快照（动作工具需要新鲜快照才走到驱动层）
// force=true：观察降噪默认开，重复观察会返回"状态未变"桩（元素集合为空）→ 编号查找会失败
async function primeSnapshot() {
  await runTool('screen_observe', { window: '4242', mode: 'ax', force: true })
}

let failures = 0
const results = []
for (const sc of scenarios) {
  process.env.CUA_STUB_SCENARIO = sc.stub
  process.env.CUA_STUB_RELOAD = String(Date.now())
  setServices(sc.subagents || 'stub')
  process.env.CUA_STUB_PREDICATE = sc.predicate || 'satisfied'
  if (sc.tool !== 'screen_observe' && sc.tool !== 'screen_zoom' && !sc.name.startsWith('observe')) {
    await primeSnapshot()
  }
  const r = await runTool(sc.tool, sc.args)
  if (r.missing) { results.push({ sc: sc.name, ok: false, issues: ['tool not registered'] }); failures++; continue }
  if (r.error) { results.push({ sc: sc.name, ok: true, note: 'threw: ' + String(r.error).slice(0, 80) }); continue }
  // 宿主校验的是经 JSON 传输后的值（undefined 键会在序列化时消失）——先往返一次再校验
  const wire = JSON.parse(JSON.stringify(r.value ?? null))
  const issues = validateSchema(r.def.output.schema, wire)
  // render 必须产出内容块数组
  let renderOk = true
  try {
    const blocks = r.def.output.render(sc.args, r.value)
    renderOk = Array.isArray(blocks) && blocks.every((b) => typeof b?.type === 'string')
  } catch (e) { renderOk = false; issues.push('render threw: ' + String(e.message).slice(0, 80)) }
  if (!renderOk) issues.push('render did not return content blocks')
  if (issues.length) failures++
  if (process.env.CUA_SCHEMA_DUMP) console.log('   → ' + sc.name + ': ' + String(wire?.result || '').slice(0, 120).replace(/\n/g, ' ⏎ '))
  results.push({ sc: sc.name, ok: issues.length === 0, issues })
}

// ── 汇总 ──────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log('工具数:', registered.size, '| 场景数:', scenarios.length)
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${pad(r.sc, 28)}${r.note ? r.note : ''}`)
  for (const i of r.issues || []) console.log('   - ' + i)
}
console.log(`\n结果：${results.filter((r) => r.ok).length}/${results.length} 场景通过`)
process.exit(failures ? 1 : 0)
