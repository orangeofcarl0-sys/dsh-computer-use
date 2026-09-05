/**
 * passwordScan.js —— Windows 结构性密码检测（UIA sidecar）。
 *
 * tools/uia-password-scan.ps1：遍历目标窗口元素，密码 = UIA IsPassword（现代框架 provider）
 * ∨ ES_PASSWORD 样式位（经典 Win32 Edit——两种 UIA 客户端都将其映射为 IsPassword=false，
 * 探针实证；样式位是系统真值）。输出单行 JSON {window, password:[{name,x,y,w,h}]}。
 *
 * 确定性语义：读系统真实属性，不是猜测——PLAN-credential-guard 第二期的结构性根治。
 * 失败语义：任何异常/超时/非零退出 → null（调用方降级启发式，绝不阻塞、绝不伪装成功）。
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'uia-password-scan.ps1')

export const IS_WINDOWS = process.platform === 'win32'

function defaultSpawn(cmd, args, opts) {
  return spawn(cmd, args, opts)
}

/**
 * 扫描目标窗口的密码元素集合。
 * @param {{hwnd?:number, timeoutMs?:number}} opts
 * @param {Function} [spawnFn] - 可注入的 spawn（测试桩）
 * @returns {Promise<{window:{left:number,top:number,width:number,height:number}, password:{name:string,x:number,y:number,w:number,h:number}[]}|null>}
 *   null = 平台不符/失败/超时（调用方降级启发式）
 */
export function scanPasswords({ hwnd, timeoutMs = 3000 } = {}, spawnFn = defaultSpawn) {
  if (!IS_WINDOWS || !hwnd) return Promise.resolve(null)
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    let child = null
    const finish = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* 已退出 */ }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      child = spawnFn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Hwnd', String(hwnd)],
        { windowsHide: true })
    } catch {
      return finish(null)
    }
    child.stdout?.on?.('data', (d) => { out += d })
    child.stderr?.on?.('data', () => { /* 诊断进 stderr，降级即可 */ })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) return finish(null)
      try {
        const v = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop())
        let list = v?.password
        if (list == null) list = []
        else if (!Array.isArray(list)) list = [list] // PS 5.1 单元素数组解包防御
        finish({
          window: {
            left: +v?.window?.left || 0, top: +v?.window?.top || 0,
            width: +v?.window?.width || 0, height: +v?.window?.height || 0,
          },
          password: list.map((p) => ({
            name: String(p?.name ?? ''), x: +p?.x || 0, y: +p?.y || 0, w: +p?.w || 0, h: +p?.h || 0,
          })),
        })
      } catch {
        finish(null)
      }
    })
  })
}

/**
 * 用扫描结果标记元素：元素中心（窗口本地截图 px）+ sidecar 窗口原点 → 屏幕 px，
 * 落入某密码 rect（±tolerance）→ element.is_password = true（cacheSnapshot 转入快照 entry）。
 * 误差方向安全：坐标错配只会"漏标"，不会"误标"。
 * @param {Array<{frame:{x:number,y:number,w:number,h:number}}>} elements - 原始驱动元素
 * @param {{window:{left:number,top:number}, password:{x:number,y:number,w:number,h:number}[]}} scan
 * @param {number} [tolerance]
 * @returns {number} 标记数
 */
export function markElementsFromScan(elements, scan, tolerance = 8) {
  if (!scan || !Array.isArray(elements)) return 0
  const { left, top } = scan.window
  let marked = 0
  for (const e of elements) {
    if (e.is_password) continue
    const f = e.frame
    if (!f) continue
    const sx = left + f.x + f.w / 2
    const sy = top + f.y + f.h / 2
    for (const p of scan.password) {
      if (sx >= p.x - tolerance && sx <= p.x + p.w + tolerance
        && sy >= p.y - tolerance && sy <= p.y + p.h + tolerance) {
        e.is_password = true
        marked++
        break
      }
    }
  }
  return marked
}
