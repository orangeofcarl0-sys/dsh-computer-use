/**
 * 引擎回执判定（共享）：驱动的"拒绝/失败"回执有多种形态，这里统一识别，
 * 避免各调用点各判一套、把拒绝当成成功上报。
 *
 * 实测依据：
 * - 2026-09-16：invoke_menu 在 Win11 记事本返回 {"refusal":{code:"menu_path_unavailable"}}，
 *   而调用方此前无条件报"已调用菜单路径"成功 → 模型据此继续下一步。
 * - 同一目标上 driver hotkey 的 UIA 加速器扫描 4s 超时（以异常抛出）。
 */

/** @returns {string|null} 拒绝原因文本（null = 正常回执） */
export function engineRefusal(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const effect = value.effect
    if (effect === 'refused' || effect === 'rejected') {
      const code = value.code ? ` (${value.code})` : ''
      const reason = value.escalation?.reason || value.reason || value.message || ''
      return `${effect}${code}${reason ? ' ' + reason : ''}`
    }
    if (typeof value.error === 'string') return value.error.slice(0, 200)
    if (value.refusal && typeof value.refusal === 'object') {
      const rc = value.refusal.code ? ` (${value.refusal.code})` : ''
      const rm = String(value.refusal.message || value.refusal.reason || '').slice(0, 200)
      return `驱动拒绝${rc}${rm ? ' ' + rm : ''}`
    }
    if (value.code === 'invalid_arguments' || value.code === 'unavailable' || value.code === 'not_supported') {
      return `驱动拒绝 (${value.code}) ${String(value.detail || value.message || '').slice(0, 200)}`
    }
  }
  return null
}

/** 驱动的 UIA 加速器扫描超时：目标应用 UIA provider 无响应（该目标上组合键/菜单可能整体不可达）。 */
export function uiaAcceleratorTimeout(msg) {
  return /UIA accelerator scan exceeded|a UIA provider in the target app is likely unresponsive/i.test(String(msg || ''))
}
