/**
 * snapshot.js —— 观察快照缓存。
 *
 * screen_observe 的结果有 TTL：过期后任何依赖编号/坐标的动作都会被拒绝，
 * 要求重新观察（对应项目书安全设计第 5 条"过期状态拒绝"）。
 * element_token 自带引擎侧 snapshot 校验，双重保险。
 * 快照同时记录 appName（区域限制）与元素 role/label（危险/敏感检测）。
 */

/** 当前快照（单会话单窗口模型，P2 可扩展为多窗口表）。 */
let snapshot = null

/**
 * 保存一次 screen_observe 的快照。
 * @param {object} s
 * @param {Map<number,{token:string,role?:string,label?:string}>} s.entries - 编号 → 元素信息
 */
export function setSnapshot(s) {
  snapshot = s
}

/** 读取当前快照（可能为 null）。 */
export function getSnapshot() {
  return snapshot
}

/** 快照是否新鲜（在 TTL 内）。 */
export function isFresh(ttlMs) {
  return Boolean(snapshot) && Date.now() - snapshot.at <= ttlMs
}

/** 清除快照（例如发生明显环境变化后）。 */
export function clearSnapshot() {
  snapshot = null
}

/**
 * 校验并取回编号对应的元素信息。
 * @param {number} index - screen_observe 输出的编号（= element_index）
 * @param {number} ttlMs - 快照 TTL
 * @returns {{pid:number, token:string, windowId:number, role?:string, label?:string}}
 * @throws 快照缺失 / 过期 / 编号不存在时抛出带指引的错误（[snapshot_missing]/[snapshot_expired]/[index_out_of_range]）
 */
export function resolveToken(index, ttlMs) {
  if (!snapshot) {
    throw new Error('[snapshot_missing] 没有可用的观察快照：请先调用 screen_observe 再执行动作。')
  }
  if (!isFresh(ttlMs)) {
    const expired = snapshot
    clearSnapshot()
    throw new Error(`[snapshot_expired] 观察快照已过期（超过 ${Math.round(ttlMs / 1000)} 秒，快照 ${expired.snapshotId ?? '未知'}）：界面可能已变化，请重新调用 screen_observe。`)
  }
  const entry = snapshot.entries?.get(index)
  if (!entry || !entry.token) {
    throw new Error(`[index_out_of_range] 编号 [${index}] 不在当前快照中：请重新调用 screen_observe 获取最新编号。`)
  }
  return {
    pid: snapshot.pid,
    token: entry.token,
    windowId: snapshot.windowId,
    role: entry.role,
    label: entry.label,
  }
}

/**
 * 取回快照的窗口定位信息（坐标模式使用 window-local 像素）。
 */
export function resolveWindow(ttlMs) {
  if (!snapshot) {
    throw new Error('[snapshot_missing] 没有可用的观察快照：请先调用 screen_observe 再执行动作。')
  }
  if (!isFresh(ttlMs)) {
    const expired = snapshot
    clearSnapshot()
    throw new Error(`[snapshot_expired] 观察快照已过期（超过 ${Math.round(ttlMs / 1000)} 秒，快照 ${expired.snapshotId ?? '未知'}）：界面可能已变化，请重新调用 screen_observe。`)
  }
  return { pid: snapshot.pid, windowId: snapshot.windowId }
}

/**
 * 显式证据基线校验（PLAN-snapshot-freshness §3.4）：动作携带的 snapshot_id 必须与
 * 当前快照一致。无快照时不在此报错（交给 resolveToken/resolveWindow 报 missing）。
 * @throws [snapshot_mismatch]
 */
export function validateSnapshotId(id) {
  if (id === undefined || id === null || id === '') return
  if (!snapshot) return
  if (snapshot.snapshotId !== String(id)) {
    throw new Error(`[snapshot_mismatch] 你引用的快照 ${id} 不存在或已被新观察取代（当前 ${snapshot.snapshotId ?? '无'}）：请以最新 screen_observe 为准。`)
  }
}

/** 标记本快照已被一次动作消费（投递即消费；refused 不算——动作未生效）。 */
export function markConsumed(tool) {
  if (snapshot) snapshot.consumedBy = { tool, at: Date.now() }
}

/** 标记快照状态可疑（上一次动作不可验证：界面状态不确定，含外部干预可能）。 */
export function markSuspect(tool) {
  if (snapshot) snapshot.suspect = { tool, at: Date.now() }
}

/** 是否已被动作消费过（enforce 档判定用）。 */
export function isConsumed() {
  return Boolean(snapshot?.consumedBy)
}

/** 当前快照的新鲜度问题描述（空数组 = 干净）。 */
export function freshnessIssueParts() {
  if (!snapshot) return []
  const parts = []
  if (snapshot.suspect) parts.push(`上一次 ${snapshot.suspect.tool} 不可验证，界面当前状态不确定（含真人或其它程序干预的可能）`)
  if (snapshot.consumedBy) parts.push(`上一次动作（${snapshot.consumedBy.tool}）已基于此快照执行，界面可能已变化`)
  return parts
}

/**
 * 快照新鲜度闸门（PLAN-snapshot-freshness §3.2/3.3）。
 * @param {{supersession?:string}} cfg - off/note/enforce
 * @returns {{note:string}} note 档返回一致性注记（空串 = 干净）；enforce 档对"已消费"直接抛 [snapshot_consumed]
 */
export function freshnessGate(cfg) {
  const mode = cfg?.supersession ?? 'note'
  if (mode === 'off' || !snapshot) return { note: '' }
  if (mode === 'enforce' && snapshot.consumedBy) {
    throw new Error(`[snapshot_consumed] 此快照已被上一次动作（${snapshot.consumedBy.tool}）消费：界面可能已变化。请 screen_observe 获取新快照后再操作。`)
  }
  const parts = freshnessIssueParts()
  if (parts.length === 0) return { note: '' }
  return { note: `（快照一致性提示：${parts.join('；')}。若你确认界面未变可继续；建议以 screen_observe 复核后再做依赖前一步结果的连续操作。）` }
}
