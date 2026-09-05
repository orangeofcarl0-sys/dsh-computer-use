/**
 * guard.js —— 动作前置守卫（无感自治姿态，0.4.0）。
 *
 * 立场（PLAN-usability-first §1）：易用无感、自动提权、极危敏感警告、仅作基本兜底。
 *   1. 区域限制：allowedApps 白名单（默认空 = 关闭），仍属"作用域"而非审批。
 *   2. 凭据硬保护：密码框永不让模型自动输入——computer_type 硬拒绝（唯一硬块）；
 *      其余动作放行并附凭据注记。
 *   3. 极危注记层：extremePatterns 配置命中 → 结果附注记警告，不阻断（默认空 = 零差异）。
 *   4. 快照 TTL / 无快照拒绝：snapshot.js（不变）。
 *
 * 0.4.0 变更：危险词审批网关整体删除（零打断）；归因改为注记 + harness 会话日志。
 */
import { getSnapshot } from './snapshot.js'
import { isPasswordCandidate } from './roles.js'

/** 区域限制只约束"操作类"工具；观察/列表/启动为只读或无害，不受限。 */
const OPERATION_TOOLS = new Set([
  'computer_click', 'computer_double_click', 'computer_right_click',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_drag',
])

/**
 * 统一动作前置守卫。
 * @param {object} cfg - 插件配置（allowedApps / extremeRes）
 * @param {string} toolName - 当前工具名
 * @param {object} args - 工具参数
 * @returns {{ok:boolean, reason?:string, note?:string}} 不通过给 reason；通过可附 note（注记，不阻断）
 */
export function guard(cfg, toolName, args) {
  const snap = getSnapshot()

  // 1. 区域限制：allowedApps 非空时，操作类工具的快照窗口应用必须在白名单内
  if (OPERATION_TOOLS.has(toolName) && cfg.allowedApps && cfg.allowedApps.length > 0) {
    if (!snap) {
      return { ok: false, reason: '区域限制：先调用 screen_observe 建立快照才能操作。' }
    }
    if (!cfg.allowedApps.includes(snap.appName)) {
      return {
        ok: false,
        reason: `区域限制：应用 "${snap.appName}" 不在允许操作列表（${cfg.allowedApps.join(' / ')}）中，已拒绝。`,
      }
    }
  }

  // 2/3. 元素级检测（仅 element 编号模式可预知目标；坐标模式无法预知，靠快照 TTL 兜底）
  if (args.element !== undefined && args.element !== null && snap) {
    const info = snap.entries?.get(Number(args.element))
    const role = info?.role || ''
    const label = info?.label || ''
    const value = info?.value || ''

    // 凭据硬保护：跨平台三态判定（结构位 > 启发式；AX 结构化 / Windows UIA 启发式 / sidecar 结构位）
    const verdict = info?.is_password === true
      ? 'hard'
      : isPasswordCandidate({ role, label, value })
    if (verdict === 'hard') {
      if (toolName === 'computer_type') {
        return { ok: false, reason: '敏感输入保护：密码框拒绝自动输入——密码/密钥必须由用户本人输入。' }
      }
      return { ok: true, note: `（凭据保护注记：目标"${label || role}"为密码输入框，自动输入已被硬性禁止；本次 ${toolName} 放行。）` }
    }
    if (verdict === 'note') {
      return { ok: true, note: `（凭据保护注记：目标"${label || role}"疑似密码相关控件；涉及自动输入的操作请格外谨慎。）` }
    }

    // 极危注记（不阻断）：extremePatterns 命中 → 附加警告
    const extreme = extremeNote(cfg, label)
    if (extreme) return { ok: true, note: extreme }
  }

  return { ok: true }
}

/** 极危清单注记：命中返回警告字符串（附到结果，不阻断），未命中返回 null。 */
export function extremeNote(cfg, label) {
  const s = String(label || '')
  if (!s) return null
  const hit = (cfg.extremeRes || []).some((re) => re.test(s))
  return hit
    ? `（极危警告：目标"${s.slice(0, 60)}"命中极危清单（不可逆/高敏感），已照常执行——请核对结果。）`
    : null
}
