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
export function scanPasswords({ hwnd, timeoutMs = 5000 } = {}, spawnFn = defaultSpawn) {
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
 * 用扫描结果标记元素：元素中心（窗口本地截图 px）+ 候选窗口原点 → 屏幕 px，
 * 任一候选落入某密码 rect（±tolerance）→ element.is_password = true（cacheSnapshot 转入快照 entry）。
 *
 * 双原点消歧：实测同一窗口存在三种矩形（UIA BoundingRectangle 含阴影 ⊃ 驱动 bounds ⊃ 截图），
 * 原点系统差最大 ~18px——候选原点 = [驱动 bounds 原点, sidecar UIA 原点]，任一命中即标记
 * （只在密码 rect 内判定，误标风险不随候选数增加）。
 * 误差方向安全：坐标错配只会"漏标"，不会"误标"。
 * @param {Array<{frame:{x:number,y:number,w:number,h:number}}>} elements - 原始驱动元素
 * @param {{window:{left:number,top:number}, password:{x:number,y:number,w:number,h:number}[]}} scan
 * @param {{tolerance?:number, origins?:{x:number,y:number}[]}} [opts] - origins 缺省用 sidecar 窗口原点
 * @returns {number} 标记数
 */
export function markElementsFromScan(elements, scan, opts = {}) {
  if (!scan || !Array.isArray(elements)) return 0
  const tolerance = opts.tolerance ?? 8
  const origins = (opts.origins && opts.origins.length ? opts.origins : [{ x: scan.window.left, y: scan.window.top }])
    .filter(Boolean)
  let marked = 0
  for (const e of elements) {
    if (e.is_password) continue
    const f = e.frame
    if (!f) continue
    const cx = f.x + f.w / 2
    const cy = f.y + f.h / 2
    for (const o of origins) {
      const sx = o.x + cx
      const sy = o.y + cy
      let hit = false
      for (const p of scan.password) {
        if (sx >= p.x - tolerance && sx <= p.x + p.w + tolerance
          && sy >= p.y - tolerance && sy <= p.y + p.h + tolerance) {
          hit = true
          break
        }
      }
      if (hit) {
        e.is_password = true
        marked++
        break
      }
    }
  }
  return marked
}
