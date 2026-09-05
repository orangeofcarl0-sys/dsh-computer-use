/**
 * 离线冒烟：无感自治姿态（0.4.0）。
 *
 * 通过临时目录复制 lib/ 并以受控 stub 替换 cuaCall，验证：
 *   A. 危险词动作零审批直通（守卫无 approval 依赖，空极危清单零注记）；
 *   B. 凭据硬保护：密码框 type 硬拒绝 / 其余动作放行 + 凭据注记；
 *   C. 极危注记：extremePatterns 命中 → 注记警告且不阻断；
 *   D. 观测常开：get_window_state 失败自动降级桌面级采集（不再受模式开关控制）；
 *   E. 姿态结构断言：permissionMode 已删除、默认值翻转、无 approval 残留。
 *
 * 运行：node tests/posture.smoke.mjs（无需 cua-driver 在场）。
 */
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const work = mkdtempSync(join(tmpdir(), 'dsh-cu-posture-'))
cpSync(join(root, 'lib'), join(work, 'lib'), { recursive: true })

// 受控引擎：get_window_state 恒失败（触发观测降级），其余按调用名返回
writeFileSync(join(work, 'lib', 'cua.js'), `
export const CUA_SESSION = 'smoke'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export const history = []
export async function cuaCall(tool, args = {}) {
  history.push({ tool, args })
  if (tool === 'list_windows') return { windows: [{ pid: 1, window_id: 2, title: 'T', app_name: 'A', z_index: 1 }] }
  if (tool === 'get_window_state') {
    // screen_zoom 用 max_elements:1 取窗口尺寸（不降级）；其余路径恒失败以测观测降级
    if (args.max_elements === 1) return { screenshot_width: 2560, screenshot_height: 1610, elements: [], element_count: 0, total_element_count: 0 }
    throw new Error('access denied (integrity level)')
  }
  if (tool === 'get_desktop_state') return { screenshot_width: 100, screenshot_height: 100 }
  if (tool === 'check_permissions') return { elevated: false, integrity_level: 'Medium', uia: true, post_message: false }
  if (tool === 'zoom') return { screenshot_png_b64: 'aGVsbG8=', width: 50, height: 40, mime_type: 'image/jpeg' }
  return {}
}
export function isBackgroundUnavailable() { return false }
export function isForegroundUnavailable() { return false }
export function isUnverified() { return false }
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }
`)

const libUrl = (name) => pathToFileURL(join(work, 'lib', name)).href

const { guard } = await import(libUrl('guard.js'))
const { setSnapshot } = await import(libUrl('snapshot.js'))
const { screenObserve } = await import(libUrl('observe.js'))
const { isActionableRole, isMaskedValue } = await import(libUrl('roles.js'))

const cfg = { ttlMs: 60000, maxElements: 500, allowedApps: [], extremeRes: [], deliveryMode: 'auto' }
const cfgExtreme = { ...cfg, extremeRes: [/永久删除/] }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

// A. 危险词直通（旧版会在此请求审批；现在零打断、空清单零注记）
setSnapshot({ at: Date.now(), ttlMs: cfg.ttlMs, pid: 1, windowId: 2, appName: 'A', snapshotId: 's1',
  entries: new Map([[1, { token: 't1', role: 'AXButton', label: '永久删除所有项目' }]]) })
let g = guard(cfg, 'computer_click', { element: 1 })
check('A1: 危险词标签零审批直通', g.ok === true)
check('A2: 空极危清单零注记', g.note === undefined, `note=${JSON.stringify(g.note)}`)
check('A3: 守卫无 approval/ctx 依赖（签名 = cfg, toolName, args）', guard.length === 3)

// B. 凭据硬保护
setSnapshot({ at: Date.now(), ttlMs: cfg.ttlMs, pid: 1, windowId: 2, appName: 'A', snapshotId: 's1',
  entries: new Map([[2, { token: 't2', role: 'AXSecureTextField', label: '密码' }]]) })
g = guard(cfg, 'computer_type', { element: 2, text: 'secret' })
check('B1: 密码框自动输入硬拒绝', g.ok === false && /密码框拒绝自动输入/.test(g.reason || ''))
g = guard(cfg, 'computer_click', { element: 2 })
check('B2: 密码框点击放行 + 凭据注记', g.ok === true && /凭据保护注记/.test(g.note || ''))

// G. 跨平台凭据硬保护（Windows UIA 命名 + 掩码值，0.5.2）：修复前 Windows 上保护静默失效
const winEntries = new Map([
  [10, { token: 't10', role: 'Edit', label: '密码', value: '' }],
  [11, { token: 't11', role: 'Edit', label: '账号', value: '●●●●●●' }],
  [12, { token: 't12', role: 'Edit', label: '用户名', value: '' }],
  [13, { token: 't13', role: 'Button', label: '显示密码', value: '' }],
])
setSnapshot({ at: Date.now(), ttlMs: cfg.ttlMs, pid: 1, windowId: 2, appName: 'A', snapshotId: 's1', entries: winEntries })
g = guard(cfg, 'computer_type', { element: 10, text: 'x' })
check('G1: Windows 形态硬拒（Edit × 密码词）', g.ok === false && /密码框拒绝自动输入/.test(g.reason || ''))
g = guard(cfg, 'computer_type', { element: 11, text: 'x' })
check('G2: 掩码值硬拒（Edit × ●●●●）', g.ok === false && isMaskedValue('●●●●●●'))
g = guard(cfg, 'computer_type', { element: 12, text: 'x' })
check('G3: 普通输入框放行（零误拒）', g.ok === true && !g.note)
g = guard(cfg, 'computer_click', { element: 13 })
check('G4: 非输入类命中 → 仅注记不硬拒', g.ok === true && /疑似密码相关/.test(g.note || ''))
check('G5: 可交互角色跨平台（UIA Button / AXButton）', isActionableRole('Button') && isActionableRole('AXButton') && isActionableRole('AXSecureTextField'))

// C. 极危注记（不阻断）
setSnapshot({ at: Date.now(), ttlMs: cfg.ttlMs, pid: 1, windowId: 2, appName: 'A', snapshotId: 's1',
  entries: new Map([[1, { token: 't1', role: 'AXButton', label: '永久删除所有项目' }]]) })
g = guard(cfgExtreme, 'computer_click', { element: 1 })
check('C: 极危命中 → 注记警告且不阻断', g.ok === true && /极危警告/.test(g.note || ''))

// D. 观测常开：窗口级失败自动降级桌面级采集（旧版 standard 模式在此直接抛错）
const ctxStub = { get: () => null }
const r = await screenObserve(ctxStub, {}, cfg, null)
check('D1: 观测失败自动降级桌面级采集', r.ok === true && r.mode === 'desktop-visual' && /观测降级/.test(r.result))
check('D2: 降级结果标注 visualOnly + driverAccess', r.visualOnly === true && r.driverAccess !== undefined && r.driverAccess !== null)

// F. 定位原语：screen_zoom 返回 crop 元数据（原点/尺寸/换算比例），支撑树空目标定位环
const { screenZoom } = await import(libUrl('observe.js'))
const fakeAtt = {
  imageLimits: { maxImageBytes: 5 * 1024 * 1024 },
  saveImage: async (o) => ({ attachmentId: 'a1', mediaType: o.mediaType, bytes: o.data.length, width: 50, height: 40, name: o.name }),
}
const fakeLlm = { resolveModelInfo: async () => ({ inputModalities: ['image', 'text'] }) }
const ctxZoom = { get: (k) => (k === 'attachments' ? fakeAtt : k === 'llm' ? fakeLlm : null) }
const execZoom = { agent: { options: { provider: 'p', model: 'm' } } }
const z = await screenZoom(ctxZoom, { pid: 1, window_id: 2, x1: 100, y1: 200, x2: 200, y2: 280 }, cfg, execZoom)
check('F1: zoom 返回 crop 元数据（原点+尺寸）', z.ok === true && z.crop?.x === 100 && z.crop?.y === 200 && z.crop?.w === 100 && z.crop?.h === 80)
check('F2: crop.scale = 裁剪宽/返回图宽 = 2', z.crop?.scale === 2 && /定位环/.test(z.result || ''))

// E. 姿态结构断言（源码级：无 permissionMode 残留、默认值翻转、无 approval 残留）
const yml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const idxSrc = readFileSync(join(root, 'index.js'), 'utf8')
const guardSrc = readFileSync(join(root, 'lib', 'guard.js'), 'utf8')
check('E1: index.js 无 permissionMode 残留', !idxSrc.includes('permissionMode'))
check('E2: guard.js 无 approval 残留', !guardSrc.includes('approval'))
check('E3: Config 默认 deliveryMode=auto / ttlMs=60000',
  /deliveryMode: z\.union\(\['background', 'auto', 'foreground'\]\)\.default\('auto'\)/.test(idxSrc)
  && /ttlMs: z\.number\(\)\.default\(60000\)/.test(idxSrc))
check('E4: cordis.patch.yml 翻转且无 permissionMode',
  yml.includes('ttlMs: 60000') && yml.includes('deliveryMode: auto') && !yml.includes('permissionMode'))

process.exit(failures > 0 ? 1 : 0)
