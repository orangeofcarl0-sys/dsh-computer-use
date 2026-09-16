/**
 * actions.js —— 动作工具实现：点击 / 双击 / 右键 / 输入 / 按键 / 滚动 / 拖拽。
 *
 * 每个动作都基于 screen_observe 的快照：
 *  - element 编号模式 → 透传 element_token（引擎校验快照是否过期）
 *  - x/y 坐标模式 → 使用快照窗口的 window-local 像素坐标
 */
import { cuaCall, cuaDeliver, isUnverified, normalizeMcp, withSession } from './cua.js'
import { engineRefusal, uiaAcceleratorTimeout } from './engine.js'
import { freshnessGate, getSnapshot, markConsumed, markSuspect, resolveToken, resolveWindow, validateSnapshotId } from './snapshot.js'
import { humanClick, resolveClickTarget, screenPointOf, windowLocalOf } from './human.js'

/** 引擎仅"回执未验证"（unverifiable / delivery_failed）时的注记：不得计作成功。 */
const UNVERIFIED_NOTE = '（引擎只返回了投递回执，未验证目标是否真的响应：请先 screen_observe 确认，必要时对本次动作加 foreground=true 重试。）'

/**
 * 构造一次"基于编号或坐标"的引擎调用参数。
 * 坐标语义：screen_observe 输出的元素坐标是屏幕 pt（cua-driver 0.19.3 的
 * frame 即屏幕坐标），引擎 click/scroll/drag 需要 window-local，故换算。
 * @returns {object} 传给 cua-driver 的参数字段
 */
function targetArgs(args, cfg, extra = {}) {
  const out = {}
  const snap = getSnapshot()
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    out.pid = pid
    out.element_token = token
  } else if (args.x !== undefined || args.y !== undefined) {
    if (args.x === undefined || args.y === undefined) {
      throw new Error('坐标模式必须同时提供 x 和 y。')
    }
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const local = windowLocalOf(Number(args.x), Number(args.y), snap)
    out.pid = pid
    out.window_id = windowId // 坐标点击需 window_id 定位目标窗口（避免多窗口歧义）
    out.x = local.x
    out.y = local.y
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  return withSession({ ...out, ...extra })
}

/** 通用动作执行：调用引擎并返回统一结果（含前后台投递策略 + 快照新鲜度语义）。
 *  新鲜度（PLAN-snapshot-freshness）：入口校验显式基线 + enforce 闸门；投递即消费（unverifiable 另标可疑）。 */
async function runAction(label, tool, args, cfg, extra = {}) {
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const payload = targetArgs(args, cfg, extra)
  const { value: vRaw, note } = await cuaDeliver(tool, payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  const value = normalizeMcp(vRaw)
  const refusal = engineRefusal(value)
  if (!refusal) {
    markConsumed(tool)
    if (isUnverified(value)) markSuspect(tool)
  }
  if (refusal) {
    return {
      ok: false,
      result: `${label} 被引擎拒绝：${refusal}${note}`,
    }
  }
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    ok: true,
    result: `${label} 完成：${detail}${note}${isUnverified(value) ? UNVERIFIED_NOTE : ''}${gate.note}`,
  }
}

/**
 * 引擎侧拒绝检测：cua-driver 常以 200 + 结构化错误返回（如
 * {code:"off_space_or_ax_unresolved", effect:"refused"}）。这类结果不是"成功"。
 * @returns {string|null} 拒绝原因文本
 */

/**
 * 真人点击：解析目标（编号或坐标）→ 光标滑行 → 像素点击。
 * @returns {Promise<{ok:boolean, result:string}>}
 */
async function humanAction(label, tool, args, cfg, extra = {}) {
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  let target
  const snap = getSnapshot()
  if (args.element !== undefined && args.element !== null) {
    target = resolveClickTarget(Number(args.element), cfg.ttlMs)
  } else if (args.x !== undefined && args.y !== undefined) {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    const sx = Number(args.x)
    const sy = Number(args.y)
    const local = windowLocalOf(sx, sy, snap)
    target = {
      pid,
      windowId,
      x: local.x,
      y: local.y,
      sx,
      sy,
    }
  } else {
    throw new Error('必须提供 element（观察编号）或 x/y 坐标。')
  }
  const { value, note } = await humanClick({
    ...target, ...extra,
    deliveryMode: cfg.deliveryMode,
    forceForeground: args.foreground === true,
  })
  const refusal = engineRefusal(value)
  if (!refusal) {
    markConsumed(tool)
    if (isUnverified(value)) markSuspect(tool)
  }
  if (refusal) {
    return {
      ok: false,
      result: `${label} 被引擎拒绝：${refusal}${note}`
        // element_not_visible 实测有两种情形（2026-09-16 Win11 记事本菜单路径）：确实未生效；或
        // 驱动误报而动作已落地（随后对话框弹出）。两者都无法从回执区分，故只给可执行指引、不做自动重试
        // （曾试过"bring_to_front 后自动重试"，实测无增益且增加复杂度，已按测量驱动原则撤除）。
        + (/element_not_visible/i.test(refusal)
          ? '。该拒绝可能是误报（动作也许已生效）：请先用 screen_observe 或 computer_verify 确认状态再决定是否重试；'
            + '若确需重试，先让目标窗口获得前台（app_launch 带 bring_to_front，或对其点一次）；'
            + '目标是 XAML/WinUI 应用（记事本等）时快捷键不可用，请一律走"点击控件（菜单项/按钮）"路径。'
          : ''),
    }
  }
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    ok: true,
    result: `${label} 完成（虚拟光标滑行+点击）：${detail}${note}${isUnverified(value) ? UNVERIFIED_NOTE : ''}${gate.note}`,
  }
}

/** computer_click —— 真人操作：光标滑行 + 像素点击 */
export async function click(args, cfg) {
  const extra = {}
  if (args.count) extra.count = Number(args.count)
  return humanAction('点击', 'click', args, cfg, extra)
}

/** computer_double_click */
export async function doubleClick(args, cfg) {
  return humanAction('双击', 'double_click', args, cfg, { count: 2 })
}

/** computer_right_click */
export async function rightClick(args, cfg) {
  return humanAction('右键点击', 'right_click', args, cfg, { button: 'right' })
}

/** computer_type —— 文本输入（可指定元素，否则输入到前台应用当前焦点） */
export async function typeText(args, cfg) {
  if (!args.text) throw new Error('computer_type: 缺少 text 参数。')
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const payload = withSession({ text: String(args.text) })
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.element_token = token
  } else {
    // 无指定元素：输入到前台应用（desktop scope）
    payload.scope = 'desktop'
  }
  const { value: vRaw, note } = await cuaDeliver('type_text', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  const value = normalizeMcp(vRaw)
  const refusal = engineRefusal(value)
  if (!refusal) {
    markConsumed('type_text')
    if (isUnverified(value)) markSuspect('type_text')
  }
  if (refusal) return { ok: false, result: `输入被引擎拒绝：${refusal}${note}` }
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `输入完成：${detail}${note}${isUnverified(value) ? UNVERIFIED_NOTE : ''}${gate.note}` }
}

/**
 * computer_key —— 按键 / 快捷键（如 return、cmd+c）。
 *
 * 投递通道按目标自动选择：
 *  - 组合键（带修饰键）：走 driver 的 hotkey（目标感知派发）——现代 XAML/WinUI/UWP
 *    目标自动使用 UIA AcceleratorKey 匹配并 Invoke（无焦点窃取、无需系统输入队列，
 *    解决 PostMessage 键进不了 XAML 树的问题）；传统 Win32 带修饰键走
 *    SendInput + 短暂 SetForegroundWindow（驱动自带激活+恢复）。
 *  - 无修饰键：维持 press_key（PostMessage 后台投递，传统 Win32 窗口即可用；
 *    XAML 目标上该通道不会到达，靠 unverifiable 注记提示换 uia/click）。
 */
export async function key(args, cfg) {
  if (!args.key) throw new Error('computer_key: 缺少 key 参数。')
  validateSnapshotId(args.snapshot_id)
  const gate = freshnessGate(cfg)
  const parts = String(args.key).toLowerCase().split('+').map((s) => s.trim())
  const MODS = new Set(['cmd', 'command', 'ctrl', 'control', 'option', 'alt', 'shift', 'fn'])
  const modifiers = parts.filter((p) => MODS.has(p)).map((p) => {
    if (p === 'command') return 'cmd'
    if (p === 'control') return 'ctrl'
    if (p === 'option') return 'alt'
    return p
  })
  const keyName = parts.filter((p) => !MODS.has(p))[0]
  if (!keyName) throw new Error('computer_key: 无法解析按键（示例: return / cmd+c / shift+tab）。')

  // 窗口寻址：优先快照窗口（pid+window_id 精准），无快照退回桌面作用域
  let windowTarget = null
  try {
    const { pid, windowId } = resolveWindow(cfg.ttlMs)
    windowTarget = { pid, window_id: windowId }
  } catch { /* scope=desktop */ }

  const isCombo = modifiers.length > 0
  const tool = isCombo ? 'hotkey' : 'press_key'
  const payload = withSession(isCombo
    ? { keys: [...modifiers, keyName], ...(windowTarget ?? { scope: 'desktop' }) }
    : { key: keyName, ...(modifiers.length > 0 ? { modifiers } : {}), ...(windowTarget ?? { scope: 'desktop' }) })
  const { value: vRaw, note: deliveryNote } = await cuaDeliver(tool, payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  }).catch((err) => {
    if (tool === 'hotkey' && uiaAcceleratorTimeout(err?.message)) {
      return {
        value: {
          error: `目标应用的 UIA provider 无响应，驱动组合键通道 4s 超时。替代路径：`
            + `① 点击界面菜单/按钮完成同一操作（如保存 → 点"文件 › 保存"或工具栏图标，element 编号点击是可靠通道）；`
            + `② 稍后重试（provider 有时恢复）。原始：${String(err.message).slice(0, 120)}`,
        },
      }
    }
    throw err
  })
  const value = normalizeMcp(vRaw)
  const channelNote = isCombo
    ? '（组合键经 driver hotkey 派发：XAML/WinUI 目标走 UIA 加速器，传统 Win32 走 SendInput 前台交换）'
    : ''
  const refusal = engineRefusal(value)
  if (!refusal) {
    markConsumed(tool)
    if (isUnverified(value)) markSuspect(tool)
  }
  if (refusal) {
    // UIA 加速器超时不可当作普通拒绝：给出可执行的替代路径（该目标上按键整体不可达）
    if (uiaAcceleratorTimeout(refusal)) {
      return {
        ok: false,
        result: `按键未送达：目标应用的 UIA provider 无响应，驱动组合键通道 4s 超时（${refusal.slice(0, 120)}）。`
          + '该目标上组合键暂不可用，请改走替代路径：① 点击界面上的菜单/按钮完成同一操作'
          + '（如保存 → 点击菜单栏"文件 › 保存"或工具栏保存图标；element 编号点击是可靠通道）；'
          + '② 若无对应控件，改用 computer_type 输入文本 + 逐个点击；③ 稍后重试（provider 有时会恢复）。',
      }
    }
    return { ok: false, result: `按键被引擎拒绝：${refusal}${deliveryNote}` }
  }
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return {
    ok: true,
    result: `按键完成 (${String(args.key)})：${detail}${channelNote}${deliveryNote}${isUnverified(value) ? UNVERIFIED_NOTE : ''}${gate.note}`,
  }
}

/** computer_scroll */
export async function scroll(args, cfg) {
  const dir = args.direction || 'down'
  if (!['up', 'down', 'left', 'right'].includes(dir)) {
    throw new Error('computer_scroll: direction 必须是 up/down/left/right。')
  }
  const payload = withSession({ direction: dir })
  if (args.amount) payload.amount = Number(args.amount)
  if (args.element !== undefined && args.element !== null) {
    const { pid, token } = resolveToken(Number(args.element), cfg.ttlMs)
    payload.pid = pid
    payload.element_token = token
  } else {
    const { pid } = resolveWindow(cfg.ttlMs)
    payload.pid = pid
  }
  const { value: vRaw, note } = await cuaDeliver('scroll', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  const value = normalizeMcp(vRaw)
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `滚动完成 (${dir})：${detail}${note}${isUnverified(value) ? UNVERIFIED_NOTE : ''}` }
}

/** computer_drag —— 拖拽（坐标 = 窗口本地截图像素，与观察输出同空间） */
export async function drag(args, cfg) {
  const { pid } = resolveWindow(cfg.ttlMs)
  if ([args.from_x, args.from_y, args.to_x, args.to_y].some((v) => v === undefined)) {
    throw new Error('computer_drag: 需要 from_x/from_y/to_x/to_y。')
  }
  const payload = withSession({
    pid,
    from_x: Number(args.from_x),
    from_y: Number(args.from_y),
    to_x: Number(args.to_x),
    to_y: Number(args.to_y),
  })
  if (args.duration_ms) payload.duration_ms = Number(args.duration_ms)
  const { value: vRaw, note } = await cuaDeliver('drag', payload, cfg.deliveryMode, {
    forceForeground: args.foreground === true,
  })
  const value = normalizeMcp(vRaw)
  const detail = typeof value === 'string' ? value : JSON.stringify(value)
  return { ok: true, result: `拖拽完成：${detail}${note}${isUnverified(value) ? UNVERIFIED_NOTE : ''}` }
}

/** computer_wait —— 本地等待（不调引擎） */
export async function wait(args) {
  const ms = Math.max(0, Math.min(Number(args.ms) || 1000, 60000))
  await new Promise((r) => setTimeout(r, ms))
  return { ok: true, result: `已等待 ${ms}ms。` }
}

/** app_list —— 列出应用 */
export async function listApps() {
  const value = await cuaCall('list_apps')
  const apps = (value.apps || []).filter((a) => a.running)
  const lines = apps.map((a) => {
    const win = a.windows && a.windows.length > 0 ? ` (${a.windows.length} 窗口)` : ''
    return `- ${a.name}${win} [pid=${a.pid}]${a.active ? ' ★活动' : ''}`
  })
  const result = `正在运行的应用（${apps.length} 个）：\n${lines.join('\n')}`
  return { ok: true, result, apps: apps.map((a) => ({ name: a.name, pid: a.pid, active: a.active })) }
}

/** app_launch —— 启动应用（后台），可选前置 */
export async function launchApp(args) {
  if (!args.name && !args.bundle_id) {
    throw new Error('app_launch: 需要 name（应用名）或 bundle_id。')
  }
  const payload = {}
  if (args.bundle_id) payload.bundle_id = String(args.bundle_id)
  else payload.name = String(args.name)
  if (args.creates_new_instance) payload.creates_new_instance = true
  const launched = await cuaCall('launch_app', payload)

  // 若请求前置，找 pid 并 bring_to_front
  let pid = launched?.pid ?? null
  let frontNote = ''
  if (args.bring_to_front && pid) {
    await cuaCall('bring_to_front', { pid })
    frontNote = ' 已前置'
  }

  const detail = typeof launched === 'string' ? launched : JSON.stringify(launched)
  return {
    ok: true,
    result: `应用已启动${frontNote}：${detail}`,
    pid,
  }
}
