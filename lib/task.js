/**
 * computer_task —— 把一段桌面操作委派给一次性子 agent，主上下文只吃一条紧凑结果。
 *
 * 动机（PLAN-context-budget §8，拍板 D1/D2）：
 * - 观察树/截图/动作回执在操作完成后毫无用处，却会随历史每一步重发并挤占主上下文；
 *   实测一次未完成任务的回合输入可达 8.5M tok（S4 基线 t08）。
 * - dsh 宿主已提供 `ctx.subagents`：`start(name, request)` 支持
 *   `toolFilter`（限定子 agent 工具集：bash/文件类在子上下文既不可见也拒绝执行）、
 *   `outputSchema`（子 agent 必须返回经校验的结构化结果）、`agentOptions`（可降档）、
 *   `maxDepth`（禁止再派生）。子上下文随运行结束整体丢弃。
 * - 拍板：默认**继承**父 agent 的 provider/model/effort，调用方可显式降档；
 *   宿主无 subagents 服务时本工具**不执行委派**，而是回"委派配方"（指导主 agent 用宿主自带子任务工具）。
 *
 * 诚实边界：本工具不必然"更省钱"（同样的步数在子上下文里发生），它买的是
 * ①主上下文不被 UI 噪声挤爆；②失败隔离（50 次按错键不再污染主线）；③主 agent 推理不被噪声干扰。
 */

/** 子 agent 可见的工具白名单：只有桌面观察/动作/验证，杜绝命令行或文件直写绕过 GUI。 */
export const GUI_ONLY_TOOLS = [
  'screen_observe', 'screen_zoom',
  'computer_click', 'computer_double_click', 'computer_right_click', 'computer_type', 'computer_key',
  'computer_scroll', 'computer_drag', 'computer_wait',
  'computer_verify', 'computer_wait_for',
  'computer_clipboard', 'computer_menu', 'computer_hover', 'computer_stop', 'computer_resume',
  'app_list', 'app_launch',
]

/** 子 agent 必须交付的结构化结果（宿主按 schema 校验）。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'summary'],
}

/** 宿主缺失 subagents 服务时的配方（模型可据此让宿主自带子任务工具做同构委派）。 */
export const DELEGATION_RECIPE =
  '本宿主未提供 subagents 服务，computer_task 无法执行委派。替代做法：用宿主自带的子任务/子 agent 工具（如 task/agent 类工具）'
  + '发起一次子任务，并在子任务指令里写明三条：①只允许使用电脑操作类工具（禁止命令行/终端/文件写入）；'
  + '②任务目标与完成判据（含绝对路径等具体信息）；③结束时必须以 JSON 收尾：{"ok":true|false,"summary":"≤300字","evidence":["可核验的证据"]}。'
  + '拿到子任务结果后，用 computer_verify 或 screen_observe 做一次廉价复核再决定下一步。'

function buildPrompt(args) {
  const lines = [
    '你负责在真实桌面上完成下面这项操作，只通过图形界面完成（点击/拖拽/键盘输入）。',
    '禁止使用命令行、终端或任何文件写入工具；如果某条路径不可用（工具会说明原因），改用界面上等效的控件。',
    '',
    `目标：${String(args.goal || '').trim()}`,
  ]
  if (args.success_criteria) lines.push(`完成判据：${String(args.success_criteria).trim()}`)
  if (args.constraints) lines.push(`附加约束：${String(args.constraints).trim()}`)
  lines.push(
    '',
    '收尾要求：任务结束（无论成败）时，你的最后一条消息必须只包含一个 JSON 对象，字段为',
    '{"ok": boolean, "summary": "≤300 字的中文简述", "evidence": ["可被外部核验的证据", ...]}。',
    'evidence 要写可验证的事实（如"文件 C:\\path\\x.txt 已存在且内容为 …"、"窗口标题为 …"、"computer_verify 返回 satisfied"），',
    '不要写"我做到了"这类自述。未完成或不确定就如实 ok=false。',
  )
  return lines.join('\n')
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * 每会话委派计数（防委托风暴 / 反复超时导致重复劳动）。
 * 实测（2026-09-16）：一次子 agent 超时（10 分钟跑满）后，父 agent 又自己从头做了一遍——
 * 一次委托把成本付了两遍。故设默认上限 3 次，超限时明确要求改用内联操作。
 */
let taskCalls = 0
export function resetTaskCalls() { taskCalls = 0 }

/**
 * @param {object} ctx 插件上下文（取 'subagents' 服务）
 * @param {object} args {goal, success_criteria?, constraints?, timeout_min?, model?, model_effort?}
 * @param {object} cfg  插件配置
 * @param {object} exec 工具执行上下文（提供 agent 与 signal）
 */
export async function runComputerTask(ctx, args, cfg, exec) {
  if (!args.goal || !String(args.goal).trim()) throw new Error('computer_task: 缺少 goal 参数。')

  // 委派预算：超限时不再开新子 agent，明确要求内联操作或先观察当前状态
  const budget = Number(cfg?.maxTaskCalls) > 0 ? Number(cfg.maxTaskCalls) : 3
  if (taskCalls >= budget) {
    return {
      ok: false,
      result: `✗ 本会话委派次数已达上限（${budget} 次，配置 maxTaskCalls 可调）。`
        + '请改为内联操作：直接 screen_observe 目标窗口，按界面实际状态一步步完成；'
        + '若之前的委派是超时结束，子任务可能已部分完成——先观察确认，别从头重做。',
    }
  }

  const svc = ctx?.get?.('subagents')
  if (!svc || typeof svc.start !== 'function' || typeof svc.list !== 'function') {
    return { ok: false, result: `✗ ${DELEGATION_RECIPE}` }
  }
  const providers = (() => { try { return svc.list() || [] } catch { return [] } })()
  if (!providers.length) return { ok: false, result: `✗ ${DELEGATION_RECIPE}` }
  const provider = providers.find((n) => /spawn|in-process/i.test(n)) || providers[0]

  const timeoutMin = clamp(Number(args.timeout_min) || cfg.taskTimeoutMin || 10, 1, 60)
  // 拍板 D2：默认继承父档；仅当调用方显式给 model/model_effort 时才覆盖
  const agentOptions = {}
  if (args.model) agentOptions.model = String(args.model)
  if (args.model_effort) agentOptions.reasoningEffort = String(args.model_effort)

  const base = {
    label: `computer_task：${String(args.goal).slice(0, 40)}`,
    prompt: [{ type: 'text', text: buildPrompt(args) }],
    parent: exec?.agent,
    signal: exec?.signal,
    toolFilter: { allow: GUI_ONLY_TOOLS },
    outputSchema: OUTPUT_SCHEMA,
    maxDepth: 1,
  }
  if (Object.keys(agentOptions).length) base.agentOptions = agentOptions

  taskCalls += 1
  let run = null
  let degraded = ''
  // 能力降级阶梯（2026-09-17 实测修正）：宿主各能力是**独立**的，不能一次全丢。
  // 实测：`toolFilter` 在宿主内部实现为 scoped `tools.restrict()`，而 restrict 的名字校验**只认全局层**——
  // 动态工具面把 19 个工具注册在会话作用域后，toolFilter 必然被拒（"names unknown global tools"），
  // 但 `outputSchema`/`maxDepth` 仍然可用。旧实现把三者一起丢掉，于是"结构化结果"也没了、回执还误报 ✗。
  // 阶梯：全量 → 去 toolFilter（保住结构化与深度限制）→ 再去 outputSchema（最后手段，如实报告）。
  const firstErr = (e) => String(e?.message || e).slice(0, 160)
  try {
    run = await svc.start(provider, base)
  } catch (err1) {
    const { toolFilter, ...noFilter } = base
    try {
      run = await svc.start(provider, noFilter)
      degraded = `（已降级：本宿主无法把子 agent 限制在桌面工具（toolFilter 被拒：${firstErr(err1)}）——子 agent 拥有与父会话同级的能力；结构化输出仍生效。）`
    } catch (err2) {
      const { outputSchema, ...bare } = noFilter
      try {
        run = await svc.start(provider, bare)
        degraded = `（已降级：本宿主既不支持子 agent 工具限制也不支持结构化输出（${firstErr(err2)}）——子 agent 能力未受限，结果未结构化。）`
      } catch (err3) {
        return { ok: false, result: `✗ 子 agent 启动失败（provider=${provider}）：${firstErr(err3)}` }
      }
    }
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try { run.dispose() } catch {}
  }, timeoutMin * 60000)

  try {
    const res = await run.result
    const structured = res?.structured
    const stop = res?.stopReason
    if (timedOut) return { ok: false, result: `✗ computer_task 超时（${timeoutMin} 分钟，已取消子任务）${degraded}
`
      + '子任务可能已部分完成——先 screen_observe 看目标窗口当前状态，再决定继续/自己接手，别从头重做（实测盲目重做会把成本付两遍）。' }
    if (!structured) {
      const text = Array.isArray(res?.output)
        ? res.output.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('').trim()
        : ''
      return {
        ok: false,
        result: `✗ 子 agent 未返回结构化结果（stopReason=${stop || '?'}）${degraded}`
          + (text ? `\n子 agent 最后输出：${text.slice(0, 400)}` : ''),
      }
    }
    const summary = String(structured.summary || '').slice(0, 300)
    const evidence = Array.isArray(structured.evidence) ? structured.evidence.slice(0, 5).map((e) => String(e).slice(0, 200)) : []
    const ok = structured.ok === true
    return {
      ok,
      result: `${ok ? '✅' : '❌'} computer_task ${ok ? '完成' : '未完成'}：${summary}`
        + (evidence.length ? `\n证据：${evidence.join('；')}` : '')
        + (degraded ? `\n${degraded}` : '')
        + (ok ? '\n（建议：用 computer_verify / screen_observe 廉价复核后再继续）' : ''),
      structured: { ok, summary, evidence },
    }
  } catch (err) {
    return { ok: false, result: `✗ 子 agent 运行失败：${String(err?.message || err).slice(0, 200)}${degraded}` }
  } finally {
    clearTimeout(timer)
    try { await run.dispose() } catch {}
  }
}
