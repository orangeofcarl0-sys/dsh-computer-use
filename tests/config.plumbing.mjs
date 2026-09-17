/**
 * 配置接线测试（P0-2）——防"配置项加了但没接线 / 接了但没人读"。
 *
 * 背景：Config schema 每次加键都要在 apply() 里组装进 cfg，再由实现读取。三处任一漏掉，
 * 用户改了配置却毫无效果，且完全无声（默认值把差异吃掉）。这类缺陷靠读 diff 发现不了，
 * 只能靠"键集合比对 + 行为哨兵"两条腿。
 *
 * A. 静态接线（键集合三向比对）
 *    schema 键 → cfg 键（含 extremePatterns→extremeRes 重命名白名单）→ 实际读取点
 * B. 动态哨兵（每个可观测键给一个哨兵值，断言真实行为随之变化）
 *    观测不到的键（passwordScan 需 spawn sidecar、taskTimeoutMin 下限 1 分钟）只做静态接线断言，
 *    并在 STATIC_ONLY 里显式登记——不假装测过。
 *
 * 运行：node tests/config.plumbing.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork, repoRoot } from './lib/harness.mjs'

const work = makeWorkCopy('config')

// 受控引擎：记录每一次驱动调用（delivery_mode / 主题都是可断言的观测点）
writeStubDriver(work, `
export const CUA_BIN = 'stub-cua-driver'
export const CUA_SESSION = 'config'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }

const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const WINDOW = {
  pid: 4242, window_id: 77, app_name: 'Notepad', title: 'untitled - Notepad',
  bounds: { x: 100, y: 100, width: 800, height: 600 },
}
const ELEMENTS = [
  { element_index: 0, element_token: 'tok-0', role: 'Button', label: 'Save', x: 100, y: 200, width: 60, height: 24 },
  { element_index: 1, element_token: 'tok-1', role: 'Button', label: 'Delete forever', x: 100, y: 240, width: 120, height: 24 },
  { element_index: 2, element_token: 'tok-2', role: 'Edit', label: 'body', x: 120, y: 300, width: 200, height: 30, value: 'hello' },
]

export const calls = []
export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) {
  const force = opts.forceForeground || deliveryMode === 'foreground'
  return { value: await cuaCall(tool, { ...payload, delivery_mode: force ? 'foreground' : 'background' }), note: '' }
}

export async function cuaCall(tool, args = {}) {
  calls.push({ tool, args })
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [WINDOW] }
    case 'list_apps': return { apps: [{ name: 'Notepad', pid: 4242, bundle_id: '', active: true }] }
    case 'get_window_state': {
      // 真实驱动按 max_elements 截断（桩也照做，否则测不到 maxElements 的接线）
      const cap = Number(args.max_elements) > 0 ? Number(args.max_elements) : ELEMENTS.length
      const els = ELEMENTS.slice(0, cap)
      return {
        window: WINDOW, elements: els, element_count: els.length,
        screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png',
        screenshot_width: 800, screenshot_height: 600,
      }
    }
    case 'get_desktop_state':
      return { screenshot_png_b64: PNG1x1, screenshot_mime_type: 'image/png', screenshot_width: 2560, screenshot_height: 1600 }
    case 'zoom': return { screenshot_png_b64: PNG1x1, width: 200, height: 150 }
    case 'verify_state':
      return { status: 'satisfied', stable: true, predicates: [{ index: 0, status: 'satisfied', unknown_reason: null, observed_json: '{}' }] }
    case 'clipboard_read': return { text: 'stub-clipboard' }
    case 'get_cursor_position': return { x: 10, y: 20 }
    default: return { ok: true, effect: 'confirmed', delivery: { mode: 'background' } }
  }
}
`)

const plugin = await loadPlugin(work)
const stub = await import(pathToFileURL(join(work, 'lib', 'cua.js')).href)
const { check, state } = makeChecks()

// ── A. 静态接线：schema ↔ cfg ↔ 读取点 ───────────────────────────────
const RENAME = { extremePatterns: 'extremeRes' }   // schema 名 → cfg 名（有意重命名）
// 观测不到动态行为、只做接线断言的键（登记在此，避免"看起来都测过"的错觉）
const STATIC_ONLY = {
  passwordScan: '需 spawn UIA sidecar（Windows 专属、秒级），动态成本高于价值',
  taskTimeoutMin: '下限 1 分钟，动态验证要真等 60s',
}

const indexSrc = readFileSync(join(repoRoot, 'index.js'), 'utf8')
const libSrc = readdirSync(join(repoRoot, 'lib'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(repoRoot, 'lib', f), 'utf8'))
  .join('\n')
const allSrc = indexSrc + '\n' + libSrc

const schemaKeys = Object.keys(plugin.Config?.dict || {})
const cfgBlock = indexSrc.match(/const cfg = \{([\s\S]*?)\n {2}\}/)
const cfgKeys = cfgBlock ? [...cfgBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]) : []

check('A0 Config schema 键可枚举', schemaKeys.length >= 15, `${schemaKeys.length} 键`)
check('A0 apply() 的 cfg 字面量可解析', cfgKeys.length >= 15, `${cfgKeys.length} 键`)

const missingInCfg = schemaKeys.filter((k) => !cfgKeys.includes(RENAME[k] || k))
check('A1 schema 每个键都组装进 cfg', missingInCfg.length === 0, missingInCfg.length ? `缺失: ${missingInCfg.join(', ')}` : `${schemaKeys.length}/${schemaKeys.length}`)

const cfgNotInSchema = cfgKeys.filter((k) => !schemaKeys.includes(k) && !Object.values(RENAME).includes(k))
check('A2 cfg 没有凭空多出的键', cfgNotInSchema.length === 0, cfgNotInSchema.join(', '))

const unread = cfgKeys.filter((k) => !new RegExp(`(?:cfg|config)\\??\\.\\s*${k}\\b`).test(allSrc))
check('A3 cfg 每个键都有读取点（无僵尸配置）', unread.length === 0, unread.length ? `无人读取: ${unread.join(', ')}` : `${cfgKeys.length}/${cfgKeys.length}`)

check('A4 重命名白名单与实际一致', Object.keys(RENAME).every((k) => schemaKeys.includes(k) && cfgKeys.includes(RENAME[k])))
check('A5 静态兜底登记项都是真实存在的键', Object.keys(STATIC_ONLY).every((k) => schemaKeys.includes(k)), Object.keys(STATIC_ONLY).join(', '))

// ── B. 动态哨兵：每个可观测键 → 行为必须随之变化 ──────────────────────
const ctxServices = makeServices({
  llm: {
    async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } },
    async * stream() { yield { type: 'text-delta', text: '（哨兵视觉描述）' } },
  },
})
const { reg: registered, ctx, exec } = makeCtx({
  services: ctxServices,
  agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } },
})

/** schema 默认值（模拟宿主把配置补全后传给 apply） */
function defaultsOf() {
  const full = {}
  for (const [k, v] of Object.entries(plugin.Config?.dict || {})) {
    full[k] = v?.meta?.default !== undefined ? v.meta.default : undefined
  }
  return full
}

async function callTool(name, args) {
  const def = registered.get(name)
  if (!def) throw new Error(`未注册工具：${name}`)
  return def.execute(args, exec)
}

/** 一套全新会话状态（apply 会重置降噪缓存/委派预算/锁存）+ 覆盖配置。 */
async function freshConfig(overrides = {}) {
  plugin.apply(ctx, { ...defaultsOf(), passwordScan: 'off', ...overrides })   // passwordScan:off 保持测试零 spawn
  await callTool('computer_do', { action: 'enter' })   // 展开工具面（B 系列要动 19 个工具）
  return {
    call: callTool,
    raw: (o) => String(o?.result || ''),
  }
}
const stubCalls = () => stub.calls
const lastStubCall = (tool) => [...stubCalls()].reverse().find((c) => c.tool === tool)
const observeArgs = { window: '4242', mode: 'ax' }

// B1 maxElements：观察编号数受 cfg 限制
{
  const t = await freshConfig({ maxElements: 1 })
  const v = await t.call('screen_observe', observeArgs)
  const n = (v.elements || []).length
  const sent = lastStubCall('get_window_state')?.args?.max_elements
  check('B1 maxElements 生效', sent === 1 && n <= 1, `驱动收到 max_elements=${sent}，元素 ${n} 个`)
}

// B2 observeDedup：off 恒全量 / summary 第二次降噪
{
  const off = await freshConfig({ observeDedup: 'off' })
  await off.call('screen_observe', observeArgs)
  const second = await off.call('screen_observe', observeArgs)
  check('B2 observeDedup=off 不降噪', !/状态未变/.test(off.raw(second)), `${off.raw(second).length} 字符`)

  const sum = await freshConfig({ observeDedup: 'summary' })
  await sum.call('screen_observe', observeArgs)
  const secondSum = await sum.call('screen_observe', observeArgs)
  check('B2 observeDedup=summary 第二次降噪', /状态未变/.test(sum.raw(secondSum)), `${sum.raw(secondSum).length} 字符`)
}

// B3 verboseReceipts：只影响回执详略
{
  const terse = await freshConfig({ verboseReceipts: false })
  await terse.call('screen_observe', observeArgs)
  const short = await terse.call('computer_click', { x: 5, y: 5 })
  check('B3 verboseReceipts=false 回执不含原始 JSON', !short.result.includes('{"'), short.result.slice(0, 60))

  const loud = await freshConfig({ verboseReceipts: true })
  await loud.call('screen_observe', observeArgs)
  const long = await loud.call('computer_click', { x: 5, y: 5 })
  check('B3 verboseReceipts=true 回执含原始 JSON', long.result.includes('{"'), long.result.slice(0, 60))
}

// B4 supersession：enforce 时同快照第二次动作被拒
{
  const t = await freshConfig({ supersession: 'enforce' })
  await t.call('screen_observe', observeArgs)
  const first = await t.call('computer_click', { x: 5, y: 5 })
  const second = await t.call('computer_click', { x: 6, y: 6 })
  check('B4 supersession=enforce 第二次动作被拒', first.ok === true && second.ok === false && /snapshot_consumed/.test(second.result), second.result.slice(0, 80))

  const n = await freshConfig({ supersession: 'note' })
  await n.call('screen_observe', observeArgs)
  const n1 = await n.call('computer_click', { x: 5, y: 5 })
  const n2 = await n.call('computer_click', { x: 6, y: 6 })
  check('B4 supersession=note 第二次动作放行', n1.ok === true && n2.ok === true, n2.result.slice(0, 60))
}

// B5 ttlMs：快照过期后动作被拒
{
  const t = await freshConfig({ ttlMs: 1 })
  await t.call('screen_observe', observeArgs)
  await new Promise((r) => setTimeout(r, 15))
  const late = await t.call('computer_click', { x: 5, y: 5 })
  check('B5 ttlMs=1 过期快照动作被拒', late.ok === false && /snapshot_expired/.test(late.result), late.result.slice(0, 80))
}

// B6 deliveryMode：投递给驱动的 delivery_mode 随之变化
{
  const t = await freshConfig({ deliveryMode: 'foreground' })
  await t.call('screen_observe', observeArgs)
  await t.call('computer_click', { x: 5, y: 5 })
  const click = lastStubCall('click')
  check('B6 deliveryMode=foreground 透传驱动', click?.args?.delivery_mode === 'foreground', String(click?.args?.delivery_mode))

  const b = await freshConfig({ deliveryMode: 'background' })
  await b.call('screen_observe', observeArgs)
  await b.call('computer_click', { x: 5, y: 5 })
  const click2 = lastStubCall('click')
  check('B6 deliveryMode=background 透传驱动', click2?.args?.delivery_mode === 'background', String(click2?.args?.delivery_mode))
}

// B7 allowedApps：白名单不含快照窗口 → 操作被拒
{
  const t = await freshConfig({ allowedApps: ['Calculator'] })
  await t.call('screen_observe', observeArgs)
  const denied = await t.call('computer_click', { x: 5, y: 5 })
  check('B7 allowedApps 非空时白名单外被拒', denied.ok === false && /区域限制/.test(denied.result), denied.result.slice(0, 80))

  const ok = await freshConfig({ allowedApps: ['Notepad'] })
  await ok.call('screen_observe', observeArgs)
  const pass = await ok.call('computer_click', { x: 5, y: 5 })
  check('B7 allowedApps 命中白名单放行', pass.ok === true, pass.result.slice(0, 60))
}

// B8 extremePatterns：命中极危清单 → 注记（不阻断）
{
  const t = await freshConfig({ extremePatterns: ['Delete forever'] })
  await t.call('screen_observe', observeArgs)
  const noted = await t.call('computer_click', { element: 1 })
  check('B8 extremePatterns 命中给极危注记', noted.ok === true && /极危/.test(noted.result), noted.result.slice(0, 90))

  const quiet = await freshConfig({ extremePatterns: [] })
  await quiet.call('screen_observe', observeArgs)
  const noNote = await quiet.call('computer_click', { element: 1 })
  check('B8 extremePatterns 为空时零注记', !/极危/.test(noNote.result), noNote.result.slice(0, 60))
}

// B9 cursorTheme：加载时把主题下发给驱动
{
  await freshConfig({ cursorTheme: 'sentinel.theme' })
  await new Promise((r) => setTimeout(r, 20))   // apply 内的下发行是异步 fire-and-forget
  const theme = lastStubCall('set_agent_cursor_theme')
  check('B9 cursorTheme 下发给驱动', theme?.args?.theme_id === 'sentinel.theme', String(theme?.args?.theme_id))
}

// B10 maxTaskCalls：委派预算生效
{
  let started = 0
  const subagents = {
    list: () => ['spawn'],
    async start() {
      started++
      return {
        id: 'child', localAgent: {},
        result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: 's', evidence: ['e'] } }),
        async dispose() {},
      }
    },
  }
  const t = await freshConfig({ maxTaskCalls: 1 })
  ctxServices.subagents = subagents   // 服务面按调用时读取
  const first = await t.call('computer_task', { goal: 'g1' })
  const second = await t.call('computer_task', { goal: 'g2' })
  delete ctxServices.subagents
  check('B10 maxTaskCalls=1 第二次委派被拒', first.ok === true && second.ok === false && /上限/.test(second.result), `started=${started}`)
}

// B11 visionProvider/visionModel/nativeImage：观察者路由与紧凑图标注
{
  const t = await freshConfig({ visionProvider: 'sentinel-provider', visionModel: 'sentinel-model', nativeImage: 'compact' })
  const v = await t.call('screen_observe', { window: '4242', mode: 'vision' })
  const txt = t.raw(v)
  check('B11 visionProvider/visionModel 决定观察者', txt.includes('sentinel-provider/sentinel-model'), txt.slice(0, 80))
  check('B11 nativeImage=compact 走紧凑图', txt.includes('紧凑图'), txt.slice(0, 80))
}

console.log(`\n结果：${state.failures ? '❌ ' + state.failures + ' 项失败' : '✅ 全部通过'}`)
if (!state.failures) cleanupWork(work)
process.exit(state.failures ? 1 : 0)
