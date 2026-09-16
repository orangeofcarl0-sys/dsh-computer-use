/**
 * 换算基准诊断：窗口 bounds（屏幕物理像素）↔ 截图尺寸 ↔ zoom 图尺寸 三者对齐关系。
 * 结论决定"图内坐标 → 屏幕坐标"能否用 bounds 直接算。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { cuaCall } = await import(pathToFileURL(join(root, 'lib/cua.js')).href)

await cuaCall('start_session', {}).catch(() => {})
const launch = await cuaCall('launch_app', { name: 'Notepad' }).catch((e) => ({ error: e.message }))
console.log('launch:', JSON.stringify(launch).slice(0, 160))
await delay(1800)

const wins = await cuaCall('list_windows', { on_screen_only: true })
const np = (wins.windows || []).find((w) => /notepad/i.test(w.app_name || ''))
if (!np) { console.log('no notepad window'); process.exit(1) }
console.log('bounds(物理屏幕):', JSON.stringify(np.bounds), '| title:', np.title)

const st = await cuaCall('get_window_state', { pid: np.pid, window_id: np.window_id, include_screenshot: true, max_elements: 200 })
console.log('截图尺寸:', st.screenshot_width + 'x' + st.screenshot_height)
console.log('对比：bounds', np.bounds.width + 'x' + np.bounds.height, 'vs 截图', st.screenshot_width + 'x' + st.screenshot_height)

// 元素矩形：是否已经是屏幕物理像素（A6 结论复核）
const el = (st.elements || []).find((e) => e.x !== undefined && e.y !== undefined)
console.log('样例元素:', JSON.stringify(el).slice(0, 200))

// zoom：请求截图坐标系内的一块，看返回尺寸与 1.2 常数
const z = await cuaCall('zoom', { pid: np.pid, window_id: np.window_id, x1: 0, y1: 0, x2: 200, y2: 150 })
console.log('zoom 200x150 ->', z.width + 'x' + z.height, '| 比例 =', (200 / z.width).toFixed(4))

const { execFileSync } = await import('node:child_process')
execFileSync('powershell', ['-NoProfile', '-Command', "Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; 'ok'"], { stdio: 'ignore' })
