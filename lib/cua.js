/**
 * cua.js —— cua-driver 引擎调用封装。
 *
 * 通过 `cua-driver call <tool> '<json-args>'` 的子进程方式调用引擎。
 * 零外部依赖：不需要 MCP SDK，CLI 即接口。
 *
 * 引擎二进制定位见 resolveBin()：CUA_DRIVER_BIN → PATH → 常见安装路径。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 解析引擎二进制路径（优先级）：
 *   1. 环境变量 CUA_DRIVER_BIN（显式指定）
 *   2. PATH 目录扫描（cua-driver / cua-driver.exe）
 *   3. 常见安装路径：~/.local/bin（cua-driver 官方安装器默认位置）、
 *      /usr/local/bin、/opt/homebrew/bin（Apple Silicon）、Windows %LOCALAPPDATA%
 *   4. 兜底 'cua-driver'（交给 spawn 报 ENOENT，错误信息含自救指引）
 *
 * 说明：GUI 应用（harness-desktop）的 PATH 通常不含 shell 的 ~/.local/bin，
 * 因此必须探测官方安装器的默认位置，否则 macOS 用户开箱即 ENOENT。
 */
function resolveBin() {
  const explicit = process.env.CUA_DRIVER_BIN
  if (explicit) return explicit
  const sep = process.platform === 'win32' ? ';' : ':'
  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue
    try { if (existsSync(join(dir, exe))) return join(dir, exe) } catch { /* 忽略 */ }
  }
  const common = [
    join(homedir(), '.local', 'bin', exe),
    `/usr/local/bin/${exe}`,
    `/opt/homebrew/bin/${exe}`,
    join(homedir(), 'AppData', 'Local', 'cua-driver', exe),
    // cua-driver 官方安装器默认布局：~/.cua-driver/packages/current/<exe>
    join(homedir(), '.cua-driver', 'packages', 'current', exe),
  ]
  for (const p of common) {
    try { if (existsSync(p)) return p } catch { /* 忽略 */ }
  }
  return 'cua-driver'
}

export const CUA_BIN = resolveBin()

/**
 * 插件统一的虚拟光标会话 id：所有动作绑定同一会话，
 * 光标主题/运动参数才能稳定生效（会话级）。
 */
export const CUA_SESSION = process.env.CUA_SESSION || 'dsh-computer-use'

/** 给动作类调用注入统一会话（观察类只读工具不需要）。 */
export function withSession(args = {}) {
  return { session: CUA_SESSION, ...args }
}

/**
 * 调用一个 cua-driver 工具（带会话自愈）。
 * 若会话已结束（daemon 空闲回收/重启导致），自动 start_session 恢复后重试一次，
 * 保证插件长时运行不因会话失效而中断。
 * @param {string} tool - 工具名，如 'get_window_state' / 'click'
 * @param {object} args - 参数对象
 * @returns {Promise<any>} 解析后的 JSON 值（CLI 输出即 structuredContent 形状）
 */
export async function cuaCall(tool, args = {}) {
  try {
    return await rawCall(tool, args)
  } catch (err) {
    if (tool !== 'start_session' && /session '.*' has ended|revive it/.test(err.message)) {
      await rawCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
      return rawCall(tool, args)
    }
    throw err
  }
}

/** 底层单次调用（不含会话自愈）。 */
function rawCall(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CUA_BIN, ['call', tool, JSON.stringify(args)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => {
      const hint = e.code === 'ENOENT'
        ? `未找到 cua-driver：请确保它已安装并在 PATH 中，或设置环境变量 CUA_DRIVER_BIN 指向完整路径（如 CUA_DRIVER_BIN=/path/to/cua-driver）。`
        : ''
      reject(new Error(`cua-driver 无法启动 (${CUA_BIN}): ${e.message}${hint ? ' ' + hint : ''}`))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = (err || out).trim()
        reject(new Error(`cua-driver ${tool} 失败 (exit ${code}): ${msg.slice(0, 800)}`))
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error(`cua-driver ${tool} 返回非 JSON: ${out.slice(0, 500)}`))
      }
    })
  })
}

/**
 * 是否命中"后台投递不可用"的结构化信号（driver 的 delivery_mode 契约）：
 * 目标输入栈静默丢弃后台事件（Chromium/Electron/GTK/VCL/LibreOffice 等）时，
 * driver 返回 code=background_unavailable 而非静默 no-op，等待调用方升级前台。
 */
export function isBackgroundUnavailable(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /background_unavailable|background unavailable/i.test(s)
}

/**
 * 是否命中"前台投递前置失败"信号：driver 在准备 SendInput 前校验目标窗口
 * 前台性失败（Windows 前台锁 + daemon 非 UIAccess），未投递任何输入。
 */
export function isForegroundUnavailable(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /foreground_unavailable|foreground unavailable/i.test(s)
}

/** 是否命中"已送达但未验证"信号（回执型结果，非拒绝）。 */
export function isUnverified(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  return /unverifiable|delivery_failed|delivery failed/i.test(s) && !/background_unavailable/i.test(s)
}

/** 引擎错误的单行摘要（注记用，避免多行噪音）。 */
function firstLine(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value || {})
  const m = s.match(/"reason":"([^"]{0,120})"/)
  return (m ? m[1] : s.split('\n')[0]).slice(0, 120)
}

/**
 * 带投递模式的引擎调用（三级升级链，deliveryMode='auto' 时生效）：
 *   L1 background（UIA / PostMessage，不抢焦点）；
 *   L2 foreground（驱动自带 activate→act→restore）——L1 被拒后自动重试；
 *   L3 bring_to_front（AttachThreadInput 绕 Windows 前台锁）→ L2 重试 → 恢复原前台。
 * L3 触发条件（两类）：
 *   a. L2 明确前置失败（foreground_unavailable——press_key/hotkey 类有前置校验）；
 *   b. L2 返回 unverifiable 回执且工具为指针/滚轮类（click/scroll/drag）——SendInput
 *      已进系统队列但可能打到错误前台（窗口非前台时不报错、静默打空），前置绕锁重试。
 * L3 结束后必须恢复原前台（previous_fg_hwnd 回写）。hotkey 的 XAML 先验拒绝
 * （无 UIA 加速键）不升级——重试同样会被拒绝。
 * 非 auto 模式保持两级：background / foreground（forceForeground）。
 * @returns {Promise<{value:any, note:string}>} note 为升级说明（无升级为 ''）
 */
const UNVERIFIED_ESCALATE_TOOLS = new Set(['click', 'scroll', 'drag'])

export async function cuaDeliver(tool, payload, deliveryMode, opts = {}) {
  const force = opts.forceForeground || deliveryMode === 'foreground'
  let value = await cuaCall(tool, { ...payload, delivery_mode: force ? 'foreground' : 'background' })
  if (force || deliveryMode !== 'auto') return { value, note: '' }
  if (!isBackgroundUnavailable(value)) {
    if (isForegroundUnavailable(value)) {
      return { value, note: `\n（前台投递被 Windows 前台锁拦截：${firstLine(value)}）` }
    }
    if (isUnverified(value) && payload.pid && UNVERIFIED_ESCALATE_TOOLS.has(tool)) {
      return escalateViaBringToFront(tool, payload, value)
    }
    return { value, note: '' }
  }
  // L2: background 被拒 → foreground 重试（驱动自带激活+恢复）。
  // driver 的拒绝可能以非 JSON 退出（rawCall 抛错）表达——规范化为 {error} 参与升级链判定。
  value = await cuaCall(tool, { ...payload, delivery_mode: 'foreground' })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  if (!isForegroundUnavailable(value)) {
    if (isUnverified(value) && payload.pid && UNVERIFIED_ESCALATE_TOOLS.has(tool)) {
      return escalateViaBringToFront(tool, payload, value)
    }
    return { value, note: '\n（后台投递不可用 → 已前台重试一次，驱动已恢复原前台焦点）' }
  }
  // L3: 前台锁拦截 → bring_to_front 绕锁 → 前台重试 → 恢复原前台
  if (tool === 'hotkey' || !payload.pid) {
    // hotkey 的 XAML 先验拒绝重试同样失败；无窗口目标（scope=desktop）无锁可绕
    return { value, note: `\n（前台投递被前台锁拦截：${firstLine(value)}）` }
  }
  return escalateViaBringToFront(tool, payload, value)
}

/**
 * L3：bring_to_front（AttachThreadInput 绕 Windows 前台锁）→ foreground 重试 →
 * 恢复原前台窗口（previous_fg_hwnd 回写；不可恢复时结果注记显式说明）。
 */
async function escalateViaBringToFront(tool, payload, failedValue) {
  const target = { session: payload.session, pid: payload.pid }
  if (payload.window_id !== undefined && payload.window_id !== null) target.window_id = payload.window_id
  const prev = await cuaCall('bring_to_front', target).catch(() => null)
  const value = await cuaCall(tool, { ...payload, delivery_mode: 'foreground' })
    .catch((e) => ({ error: String((e && e.message) || e) }))
  if (prev && prev.previous_fg_hwnd !== undefined && prev.previous_fg_hwnd !== null) {
    await cuaCall('bring_to_front', { session: payload.session, window_id: prev.previous_fg_hwnd })
      .catch(() => undefined)
    return { value, note: '\n（前台锁拦截 → bring_to_front 绕锁后重试完成，已恢复原前台窗口）' }
  }
  return { value, note: '\n（bring_to_front 未确认成功，原前台未恢复，请检查）' }
}

/**
 * 归一化 MCP 形状的返回：若结果带 content 数组（[{type:'text',text}]），
 * 提取文本拼接；否则原样返回。
 */
export function normalizeMcp(value) {
  if (value && Array.isArray(value.content)) {
    const texts = value.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
    if (texts.length > 0) return texts.join('\n')
  }
  return value
}
