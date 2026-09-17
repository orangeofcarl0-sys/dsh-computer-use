/**
 * surface.js —— 动态工具面（两态）状态机：折叠态 / 展开态。
 *
 * 立场（PLAN-meta-tool，拍板 2026-09-17）：诉求不是省 token，而是**避免过长的工具上下文造成注意力负担**——
 * 平时只有元工具（+ 精简版 screen_observe），进入后才把 19 个细粒度工具投影给模型，完成后回落。
 *
 * 机制依据（dsh-tools 0.1.5-rc.2，README + types）：
 *  - 注册表在作用域层持有 ToolDefinition，**在请求时**投影为面向模型的 ToolSchema → 中途注册从下一请求起可见；
 *  - `agent.ctx` 承载 effect（"calling through agent.ctx scopes EFFECTS"）→ 只把工具注册进**该会话**的层；
 *  - `register()` 返回精确 disposer → 回落 = dispose 那批注册；
 *  - 可见集合变化会让 prompt 前缀缓存从第一个变化的 schema token 起失效 → 进出要少（见 AUTO_COLLAPSE_AFTER）。
 *
 * 能力兜底（不是兼容层）：宿主若不提供 agent 作用域注册（例如测试用的最小 ctx），进入时退化为注册到全局面并在
 * 回执里注明——语义等价于 v0.5.4 的扁平工具面。
 */

/** 非桌面活动兜底：连续这么多次"非桌面工具"调用即自动回落（拍板：2）。 */
export const AUTO_COLLAPSE_AFTER = 2

/** 折叠态常驻的工具（元工具自身 + 精简版观察）。 */
export const ALWAYS_VISIBLE = ['computer_do', 'screen_observe']

/** 展开态新增的工具（= v0.5.4 的 20 个工具减去常驻的 screen_observe，共 19 个）。 */
export const EXPANDED_ONLY = [
  'screen_zoom',
  'computer_click', 'computer_double_click', 'computer_right_click',
  'computer_type', 'computer_key', 'computer_scroll', 'computer_drag', 'computer_wait',
  'app_list', 'app_launch',
  'computer_verify', 'computer_wait_for',
  'computer_clipboard', 'computer_menu', 'computer_hover',
  'computer_stop', 'computer_resume', 'computer_task',
]

/** 按会话（agent id）维护的展开状态。 */
const SESSIONS = new Map()

function keyOf(agent) {
  // 无 agent（宿主未传）时退化到单一作用域键，避免各会话互相串台
  return agent?.id != null ? String(agent.id) : '<no-agent>'
}

function stateOf(agent) {
  const k = keyOf(agent)
  let st = SESSIONS.get(k)
  if (!st) {
    st = { expanded: false, disposers: [], scope: 'none', nonDesktopStreak: 0 }
    SESSIONS.set(k, st)
  }
  return st
}

/** 会话结束/重启时清状态（apply 调用，避免陈旧状态被复用）。 */
export function surfaceReset() { SESSIONS.clear() }

/** 当前是否展开（供测试与 computer_do 的 status 用）。 */
export function isExpanded(agent) { return stateOf(agent).expanded }

/** 展开来源：agent 作用域（首选）/ global 兜底（宿主不支持作用域注册）。 */
function scopeFor(exec, ctx) {
  const scoped = exec?.agent?.ctx?.tools
  if (scoped && typeof scoped.register === 'function') return { tools: scoped, scope: 'agent' }
  return { tools: ctx?.tools, scope: 'global' }
}

/**
 * 进入展开态：把 EXPANDED_ONLY 注册进该会话的层（幂等）。
 * @returns {{ok:boolean, scope:string, count:number, note:string}}
 */
export function enterSurface(ctx, exec, defs) {
  const st = stateOf(exec?.agent)
  if (st.expanded) {
    return { ok: true, scope: st.scope, count: st.disposers.length, note: 'already-expanded' }
  }
  const { tools, scope } = scopeFor(exec, ctx)
  if (!tools || typeof tools.register !== 'function') {
    return { ok: false, scope: 'none', count: 0, note: 'host-has-no-tool-registry' }
  }
  const disposers = []
  const failed = []
  for (const name of EXPANDED_ONLY) {
    const def = defs.get(name)
    if (!def) { failed.push(name); continue }
    try {
      disposers.push(tools.register(def))
    } catch (err) {
      // 已注册（例如另一路已展开）→ 记录但不致命
      failed.push(`${name}(${String(err?.message || err).slice(0, 40)})`)
    }
  }
  st.expanded = true
  st.disposers = disposers
  st.scope = scope
  st.nonDesktopStreak = 0
  return { ok: true, scope, count: disposers.length, note: failed.length ? `未注册: ${failed.join(', ')}` : '' }
}

/**
 * 回落折叠态：dispose 展开时注册的那批（幂等）。
 * @returns {{ok:boolean, count:number}}
 */
export function exitSurface(exec) {
  const st = stateOf(exec?.agent)
  if (!st.expanded) return { ok: true, count: 0 }
  let n = 0
  for (const d of st.disposers) {
    try { d(); n++ } catch { /* 单个取消失败不影响其余 */ }
  }
  st.expanded = false
  st.disposers = []
  st.scope = 'none'
  st.nonDesktopStreak = 0
  return { ok: true, count: n }
}

/**
 * 非桌面活动兜底：模型连续多次调用非桌面工具 → 认为它离开桌面任务，自动回落。
 * 由 tools/post-execute 管线事件驱动（每个工具调用事后一次）。
 * @param {string} toolName - 被调用的工具名
 * @returns {{collapsed:boolean, streak:number}}
 */
export function noteToolCall(exec, toolName) {
  const st = stateOf(exec?.agent)
  if (!st.expanded) return { collapsed: false, streak: 0 }
  if (DESKTOP_NAMES.has(String(toolName))) {
    st.nonDesktopStreak = 0
    return { collapsed: false, streak: 0 }
  }
  st.nonDesktopStreak += 1
  if (st.nonDesktopStreak >= AUTO_COLLAPSE_AFTER) {
    exitSurface(exec)
    return { collapsed: true, streak: 0 }
  }
  return { collapsed: false, streak: st.nonDesktopStreak }
}

/** 本插件的全部工具名（= 桌面工作域）；用于"非桌面活动"判定。 */
export const DESKTOP_NAMES = new Set([...ALWAYS_VISIBLE, ...EXPANDED_ONLY])

/** 折叠态回执：紧凑列出进入后可用什么（注意力最小化，≤600 字符）。 */
export function expandedReceipt(scope, count) {
  const groups = [
    '观察 screen_zoom',
    '动作 click/double_click/right_click/type/key/scroll/drag/wait',
    '验证 verify/wait_for',
    '其它 clipboard/menu/hover/stop/resume',
    '应用 app_list/app_launch',
    '委派 computer_task',
  ]
  return `已展开桌面工具面（${count} 个新增可见；本会话作用域=${scope}）：${groups.join(' · ')}。`
    + '纪律：动作前先 screen_observe 取新鲜快照（同一快照内可连续动作）；完成后调 computer_do({action:"exit"}) 收起。'
    + '（切换工具面会使 prompt 前缀缓存失效一次，故不要频繁进出。）'
}
