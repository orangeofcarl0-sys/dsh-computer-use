/**
 * human.js —— 真人操作模块：像素级虚拟光标（看得见过程）。
 *
 * 坐标语义（cua-driver 0.21+）：click / drag / scroll 的 x,y 均为
 * "窗口本地截图像素"（get_window_state 返回的 PNG 同一空间，左上原点）。
 * 因此坐标不再做任何 ×2 / 窗口偏移换算 —— 模型看到的截图坐标即动作坐标。
 *
 * 点击寻址：
 *   - element 编号模式 → 用引擎官方推荐的 element_token（AX 路径，精确定位，
 *     支持后台/隐藏窗口，无需坐标；引擎文档明确 "Prefer element_token"）
 *   - x/y 坐标模式 → 像素路径（CGEvent），坐标 = 窗口本地截图像素
 */
import { cuaCall, cuaDeliver, CUA_SESSION, withSession } from './cua.js'
import { getSnapshot } from './snapshot.js'

/** 滑行段数（越多越平滑，真人手部轨迹感）。 */
const GLIDE_SEGMENTS = 5
/** 每段间隔 ms。 */
const GLIDE_STEP_MS = 70
/** 弧线高度（px，模拟人手弧线轨迹）。 */
const ARC_HEIGHT = 40

/**
 * 光标滑行：从当前位置平滑移动到目标（分段 + 弧线）。最佳努力：
 * 滑行失败不阻断点击（0.21.0 的 move_cursor 目标形状与旧版不同，逐级尝试）。
 * @param {number} tx - 目标 x（窗口本地截图像素）
 * @param {number} ty - 目标 y
 * @param {object} opts - { pid, windowId } 用于窗口目标
 */
export async function glideCursor(tx, ty, opts = {}) {
  const tryMove = (payload) => cuaCall('move_cursor', payload).catch(() => undefined)
  // 当前光标位置（拿不到就从目标点直线过去）
  let cur = null
  try {
    cur = await cuaCall('get_cursor_position', { session: CUA_SESSION })
  } catch { /* 无光标信息 → 直线 */ }
  const sx = cur?.x != null ? cur.x : tx
  const sy = cur?.y != null ? cur.y : ty

  for (let i = 1; i <= GLIDE_SEGMENTS; i++) {
    const t = i / GLIDE_SEGMENTS
    const x = sx + (tx - sx) * t
    // 弧线：中间点抬高（模拟人手画弧）
    const y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * ARC_HEIGHT
    await tryMove(withSession({ x, y, ...opts }))
    await new Promise((r) => setTimeout(r, GLIDE_STEP_MS))
  }
  await tryMove(withSession({ x: tx, y: ty, ...opts }))
}

/**
 * 窗口本地截图像素 ⇄ 屏幕坐标换算不再需要：0.21.0 直接接受截图像素。
 * 保留函数仅为兼容旧调用（坐标原样返回）。
 */
export function windowLocalOf(x, y, _snap) {
  return { x, y }
}

/**
 * 真人点击：滑行到目标 + 点击。
 * element 模式（带 token）走引擎 AX 路径（element_token，精确定位）；
 * 坐标模式走像素路径（x/y = 窗口本地截图像素，模型直接可见的坐标）。
 * 前后台投递：deliveryMode/forceForeground 交由 cuaDeliver 统一处理
 * （background 默认不抢焦点；auto 后台失败自动前台重试一次）。
 * @param {object} opts - { pid, windowId, x, y, sx, sy, token, count, button, deliveryMode, forceForeground }
 * @returns {Promise<{value:any, escalated:boolean}>}
 */
export async function humanClick(opts) {
  const {
    pid, windowId, x, y, sx, sy, token,
    count = 1, button = 'left',
    deliveryMode = 'background', forceForeground = false,
  } = opts

  // 1. 光标滑行到目标（最佳努力，看得见过程）
  if (sx != null && sy != null) {
    await glideCursor(sx, sy, { target: { kind: 'window', pid, window_id: windowId } })
  }

  // 2. 点击：token 优先（AX 路径），否则像素路径（窗口本地截图像素）
  const payload = { session: CUA_SESSION, pid }
  if (token) {
    payload.element_token = token
    // token 路径同样透传计数/按钮，否则双击/右键会静默退化成单次左键
    payload.count = count
    payload.button = button
  } else {
    if (x == null || y == null) throw new Error('humanClick: 缺少点击坐标（x/y）。')
    payload.window_id = windowId
    payload.x = x
    payload.y = y
    payload.count = count
    payload.button = button
  }
  return cuaDeliver('click', payload, deliveryMode, { forceForeground })
}

/** 快照辅助：解析编号 → token + 坐标（截图像素空间）。 */
export function resolveClickTarget(index, ttlMs) {
  const snap = getSnapshot()
  if (!snap) throw new Error('没有可用的观察快照：请先调用 screen_observe。')
  const entry = snap.entries?.get(index)
  if (!entry) throw new Error(`编号 [${index}] 不在当前快照中。`)
  const pt = screenPointOf(entry, snap)
  const local = windowLocalOf(entry.x, entry.y, snap)
  return {
    pid: snap.pid,
    windowId: snap.windowId,
    token: entry.token || null,
    x: local.x,
    y: local.y,
    sx: pt?.sx,
    sy: pt?.sy,
  }
}

/** 快照辅助：元素坐标（截图像素空间）。 */
export function screenPointOf(entry, _snap) {
  if (!entry || entry.x == null || entry.y == null) return null
  return { sx: entry.x, sy: entry.y }
}