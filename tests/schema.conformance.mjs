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
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
// 工作目录放在仓库内（.dsh-test/ 已 gitignore）：index.js 需要 @deepseek-ai/schemastery，
// 在仓库内才能沿目录树解析到仓库的 node_modules。
const workRoot = join(root, '.dsh-test')
mkdirSync(workRoot, { recursive: true })
const work = mkdtempSync(join(workRoot, 'schema-'))
cpSync(join(root, 'lib'), join(work, 'lib'), { recursive: true })
cpSync(join(root, 'index.js'), join(work, 'index.js'))

// ── 可编程引擎桩：由 SCENARIO 决定各驱动工具的行为 ────────────────────
writeFileSync(join(work, 'lib', 'cua.js'), `
export const CUA_BIN = 'stub-cua-driver'
export const CUA_SESSION = 'schema'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable(value) { return Boolean(value && value.ok === false && /后台|background/i.test(String(value.result || ''))) }
export function isForegroundUnavailable(value) { return Boolean(value && value.ok === false && /前台|foreground/i.test(String(value.result || ''))) }
export function isUnverified(value) { return Boolean(value && value.ok === false && /未验证|unverified/i.test(String(value.result || ''))) }
export const calls = []
export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) { return cuaCall(tool, payload) }


const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const WINDOW = { pid: 4242, window_id: 77, app_name: 'Notepad', title: 'untitled - Notepad' }
const ELEMENTS = [
  { index: 0, role: 'Button', label: 'Save', x: 100, y: 200, width: 60, height: 24 },
  { index: 1, role: 'Edit', label: 'text', x: 120, y: 300, width: 200, height: 30, value: 'hello' },
  { index: 2, role: 'AXSecureTextField', label: 'password', x: 120, y: 360, width: 200, height: 30, value: '********' },
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
    case 'verify_state':
      return { satisfied: true, reason: 'label matched (stub)' }
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

const { default: plugin } = await import(pathToFileURL(join(work, 'index.js')).href)

// ── 严格 schema 校验（与 dsh 的 additionalProperties:false 语义对齐）────────
function validate(schema, value, path = 'value', out = []) {
  if (!schema || typeof schema !== 'object') return out
  if (schema.oneOf) {
    const ok = schema.oneOf.some((s) => validate(s, value, path, []).length === 0)
    if (!ok) out.push(`${path}: does not match any oneOf branch`)
    return out
  }
  const t = schema.type
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const typeOk =
    !t ||
    (t === 'object' && kind === 'object') ||
    (t === 'array' && kind === 'array') ||
    (t === 'string' && kind === 'string') ||
    (t === 'boolean' && kind === 'boolean') ||
    (t === 'integer' && kind === 'number' && Number.isInteger(value)) ||
    (t === 'number' && kind === 'number') ||
    (t === 'null' && kind === 'null')
  if (!typeOk) { out.push(`${path}: expected ${t}, got ${kind}`); return out }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: "${value}" not in enum ${JSON.stringify(schema.enum)}`)
  if (t === 'object' && kind === 'object') {
    const props = schema.properties || {}
    for (const req of schema.required || []) {
      if (!(req in value)) out.push(`${path}.${req}: required but missing`)
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) out.push(`${path}.${k}: undeclared property (additionalProperties:false)`)
      }
    }
    for (const [k, s] of Object.entries(props)) {
      if (k in value) validate(s, value[k], `${path}.${k}`, out)
    }
  }
  if (t === 'array' && kind === 'array' && schema.items) {
    value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, out))
  }
  return out
}

// ── ctx 桩（与真实宿主面等价的最小集合）────────────────────────────────
const savedImages = []
const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    async saveImage(input) {
      const ref = { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1, name: input.name }
      savedImages.push(ref)
      return ref
    },
    async validateImage() {},
    async readImage(ref) { return { ref, data: new Uint8Array([1, 2, 3]) } },
  },
  llm: {
    async resolveModelInfo(provider, model) {
      return { provider, id: model, inputModalities: ['text', 'image'] }
    },
    async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') },
  },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
const ctx = {
  get: (n) => services[n],
  logger: { info() {}, error() {} },
  tools: { register(def) { registered.set(def.name, def); return () => registered.delete(def.name) } },
  toolsRuntime: null,
}

plugin.apply(ctx, { ttlMs: 60000, maxElements: 500, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })

const agent = {
  options: { provider: 'p', model: 'm' },
  session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) },
}

async function runTool(name, args) {
  const def = registered.get(name)
  if (!def) return { missing: true }
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  try {
    const value = await def.execute(args, exec)
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
  { name: 'scroll/no-snapshot', stub: 'ok', tool: 'computer_scroll', args: { x: 5, y: 5, direction: 'down', amount: 3 } },
  { name: 'drag/no-snapshot', stub: 'ok', tool: 'computer_drag', args: { from_x: 1, from_y: 1, to_x: 9, to_y: 9 } },
  { name: 'wait/ok', stub: 'ok', tool: 'computer_wait', args: { ms: 50 } },
  { name: 'clipboard/read', stub: 'ok', tool: 'computer_clipboard', args: { action: 'read' } },
  { name: 'clipboard/write', stub: 'ok', tool: 'computer_clipboard', args: { action: 'write', text: 'x' } },
  { name: 'app_list/ok', stub: 'ok', tool: 'app_list', args: {} },
  { name: 'app_launch/ok', stub: 'ok', tool: 'app_launch', args: { app: 'notepad' } },
  { name: 'verify/ok', stub: 'ok', tool: 'computer_verify', args: { window_id: 77, expect: JSON.stringify([{ element: { selector: { role: 'Button', label_contains: 'Save' }, exists: true } }]) } },
  { name: 'verify/unknown', stub: 'ok', tool: 'computer_verify', args: { window_id: 77, expect: '不是json' } },
  { name: 'menu/ok', stub: 'ok', tool: 'computer_menu', args: { window_id: 77, path: 'File' } },
  { name: 'click/driver-error', stub: 'driver-error', tool: 'computer_click', args: { x: 5, y: 5 } },
]

// 让 observe 类工具拥有快照（动作工具需要新鲜快照才走到驱动层）
async function primeSnapshot() {
  await runTool('screen_observe', { window: '4242', mode: 'ax' })
}

let failures = 0
const results = []
for (const sc of scenarios) {
  process.env.CUA_STUB_SCENARIO = sc.stub
  process.env.CUA_STUB_RELOAD = String(Date.now())
  if (sc.tool !== 'screen_observe' && sc.tool !== 'screen_zoom' && !sc.name.startsWith('observe')) {
    await primeSnapshot()
  }
  const r = await runTool(sc.tool, sc.args)
  if (r.missing) { results.push({ sc: sc.name, ok: false, issues: ['tool not registered'] }); failures++; continue }
  if (r.error) { results.push({ sc: sc.name, ok: true, note: 'threw: ' + String(r.error).slice(0, 80) }); continue }
  // 宿主校验的是经 JSON 传输后的值（undefined 键会在序列化时消失）——先往返一次再校验
  const wire = JSON.parse(JSON.stringify(r.value ?? null))
  const issues = validate(r.def.output.schema, wire)
  // render 必须产出内容块数组
  let renderOk = true
  try {
    const blocks = r.def.output.render(sc.args, r.value)
    renderOk = Array.isArray(blocks) && blocks.every((b) => typeof b?.type === 'string')
  } catch (e) { renderOk = false; issues.push('render threw: ' + String(e.message).slice(0, 80)) }
  if (!renderOk) issues.push('render did not return content blocks')
  if (issues.length) failures++
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
