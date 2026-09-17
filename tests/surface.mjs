/**
 * 动态工具面契约测试（PLAN-meta-tool，拍板 2026-09-17）——受控宿主（harness 假 ctx/agent.ctx）。
 *
 * 覆盖：
 *  AC1 折叠态：apply 后模型可见的只有 computer_do + screen_observe
 *  AC2 展开：computer_do(enter) → 19 个工具可调用；回执紧凑且含纪律提醒
 *  AC3 回落：computer_do(exit) → 回到折叠态；重复 enter/exit 幂等
 *  AC4 作用域隔离：一个会话展开不影响另一个会话
 *  AC5 能力兜底：宿主无 agent 作用域注册 → 退化注册到全局并注明 scope=global
 *  AC6 非桌面活动兜底：连续 2 次非桌面工具调用 → 自动回落（拍板阈值）
 *  AC7 清单一致性：surface.js 的两份清单与注册表完全一致（防拼错/漏加新工具）
 *  AC8 注意力预算：computer_do 描述 ≤400 字符（元工具是唯一常驻入口，必须短）
 *  AC9 停止锁存：computer_stop 期间 computer_do 也被拒（同属桌面域），resume 后恢复
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork, repoRoot } from './lib/harness.mjs'

const work = makeWorkCopy('surface')
const plugin = await loadPlugin(work)
const { ALWAYS_VISIBLE, EXPANDED_ONLY, AUTO_COLLAPSE_AFTER, noteToolCall, isExpanded } = await import(
  pathToFileURL(join(work, 'lib', 'surface.js')).href
)

const { check, state } = makeChecks()
const cfgOf = (o = {}) => ({
  ttlMs: 60000, maxElements: 120, observeDedup: 'summary', verboseReceipts: false,
  taskTimeoutMin: 5, maxTaskCalls: 3, supersession: 'note', allowedApps: [], cursorTheme: '',
  nativeImage: 'auto', visionProvider: 'p', visionModel: 'm', extremePatterns: [],
  passwordScan: 'off', deliveryMode: 'auto', ...o,
})

function session(agentId = 'session-a') {
  const { reg, ctx, exec } = makeCtx({ services: makeServices(), agent: { id: agentId } })
  plugin.apply(ctx, cfgOf())
  const call = (name, args = {}) => {
    const def = reg.get(name)
    if (!def) return Promise.resolve({ ok: false, result: `[not-visible] ${name}` })
    return def.execute(args, exec)
  }
  return { reg, ctx, exec, call }
}

// ── AC1 折叠态 ──────────────────────────────────────────────────────
{
  const s = session()
  const names = [...s.reg.keys()].sort()
  check('AC1 折叠态只有 computer_do + screen_observe',
    names.length === 2 && names.includes('computer_do') && names.includes('screen_observe'), names.join(', '))
  const stub = await s.call('computer_click', { x: 1, y: 1 })
  check('AC1 折叠态点不了（不可见工具=不可调用）', /\[not-visible\]/.test(String(stub.result)), String(stub.result).slice(0, 40))
}

// ── AC2 展开 ────────────────────────────────────────────────────────
{
  const s = session()
  const r = await s.call('computer_do', { action: 'enter' })
  check('AC2 展开后 21 个工具可调用', s.reg.size === 21, `reg=${s.reg.size}`)
  check('AC2 回执声明展开态与工具数', r.surface === 'expanded' && (r.tools || []).length === EXPANDED_ONLY.length,
    `surface=${r.surface} tools=${(r.tools || []).length}`)
  check('AC2 回执紧凑（≤600 字符）且含纪律提醒', String(r.result).length <= 600 && /screen_observe|快照/.test(String(r.result)),
    `${String(r.result).length} 字符`)
  const click = await s.call('computer_click', { x: 1, y: 1 })
  check('AC2 展开后动作工具真实可达（走到守卫而非不可见）', !/\[not-visible\]/.test(String(click.result)) && click.ok === false,
    String(click.result).slice(0, 50))
}

// ── AC3 回落与幂等 ──────────────────────────────────────────────────
{
  const s = session()
  await s.call('computer_do', { action: 'enter' })
  const info = await s.call('computer_do', { action: 'status' })
  check('AC3 status 报告展开态', info.surface === 'expanded', String(info.result).slice(0, 40))
  const ex = await s.call('computer_do', { action: 'exit' })
  check('AC3 回落后恢复折叠态（2 个）', s.reg.size === 2 && ex.surface === 'collapsed', `reg=${s.reg.size}`)
  const again = await s.call('computer_do', { action: 'enter' })
  const again2 = await s.call('computer_do', { action: 'enter' })
  check('AC3 重复 enter 幂等且不报错', s.reg.size === 21 && again.ok === true && again2.ok === true && /已是展开/.test(String(again2.result)),
    `reg=${s.reg.size}`)
  await s.call('computer_do', { action: 'exit' })
  const ex2 = await s.call('computer_do', { action: 'exit' })
  check('AC3 重复 exit 幂等', ex2.ok === true && s.reg.size === 2, `reg=${s.reg.size}`)
  const st = await s.call('computer_do', { action: 'status' })
  check('AC3 status 报告折叠态', st.surface === 'collapsed' && (st.tools || []).length === 0, String(st.result).slice(0, 40))
}

// ── AC4 作用域隔离 ──────────────────────────────────────────────────
{
  const a = session('session-a')
  const b = session('session-b')
  await a.call('computer_do', { action: 'enter' })
  check('AC4 A 展开不影响 B（B 仍折叠）', a.reg.size === 21 && b.reg.size === 2, `A=${a.reg.size} B=${b.reg.size}`)
  await a.call('computer_do', { action: 'exit' })
  const c = await b.call('computer_do', { action: 'enter' })
  check('AC4 B 独立展开正常', b.reg.size === 21 && c.surface === 'expanded', `B=${b.reg.size}`)
}

// ── AC5 能力兜底（宿主无 agent 作用域注册）────────────────────────────
{
  const { reg, ctx, exec } = makeCtx({ services: makeServices(), agent: { id: 'no-scope' } })
  delete exec.agent.ctx
  plugin.apply(ctx, cfgOf())
  const r = await reg.get('computer_do').execute({ action: 'enter' }, exec)
  check('AC5 无作用域注册时退化到全局并注明', r.ok === true && r.scope === 'global' && reg.size === 21,
    `scope=${r.scope} reg=${reg.size}`)
}

// ── AC6 非桌面活动兜底 ──────────────────────────────────────────────
{
  const agent = { id: 'auto-collapse' }
  const { reg, ctx, exec } = makeCtx({ services: makeServices(), agent })
  plugin.apply(ctx, cfgOf())
  await reg.get('computer_do').execute({ action: 'enter' }, exec)
  const n1 = noteToolCall(exec, 'bash')
  const n2 = noteToolCall(exec, 'bash')
  check('AC6 连续非桌面调用触发自动回落',
    AUTO_COLLAPSE_AFTER === 2 && n1.collapsed === false && n2.collapsed === true && !isExpanded(agent) && reg.size === 2,
    `streak1=${n1.streak} collapsed2=${n2.collapsed} reg=${reg.size}`)
  await reg.get('computer_do').execute({ action: 'enter' }, exec)
  noteToolCall(exec, 'bash')
  const desktop = noteToolCall(exec, 'computer_click')
  const after = noteToolCall(exec, 'bash')
  check('AC6 桌面工具调用会重置连击计数', desktop.streak === 0 && after.collapsed === false && reg.size === 21,
    `afterDesktop=${desktop.streak} collapsed=${after.collapsed}`)
}

// ── AC7 清单一致性 ─────────────────────────────────────────────────
{
  const { reg, ctx } = makeCtx({ services: makeServices(), agent: { id: 'list-check' } })
  plugin.apply(ctx, cfgOf())
  const defined = new Set([...reg.keys()])
  // 展开一次拿到完整工具名集合
  const { reg: reg2, ctx: ctx2, exec: exec2 } = makeCtx({ services: makeServices(), agent: { id: 'list-check-2' } })
  plugin.apply(ctx2, cfgOf())
  await reg2.get('computer_do').execute({ action: 'enter' }, exec2)
  const all = [...reg2.keys()].filter((n) => n !== 'computer_do')
  const listed = [...ALWAYS_VISIBLE, ...EXPANDED_ONLY].filter((n) => n !== 'computer_do')
  const missing = all.filter((n) => !listed.includes(n))
  const extra = listed.filter((n) => !all.includes(n))
  check('AC7 常驻+展开清单与注册表完全一致', missing.length === 0 && extra.length === 0,
    `未列入=${missing.join(', ') || '无'} 多余=${extra.join(', ') || '无'}`)
  check('AC7 折叠态常驻就是清单里的两个', defined.has('computer_do') && defined.has('screen_observe') && defined.size === 2)
}

// ── AC8 注意力预算 ─────────────────────────────────────────────────
{
  const { reg, ctx } = makeCtx({ services: makeServices(), agent: { id: 'budget' } })
  plugin.apply(ctx, cfgOf())
  const desc = String(reg.get('computer_do').description || '')
  check('AC8 computer_do 描述 ≤400 字符', desc.length <= 400, `${desc.length} 字符`)
  const params = JSON.stringify(reg.get('computer_do').parameters || {})
  check('AC8 computer_do 参数表 ≤200 字符', params.length <= 200, `${params.length} 字符`)
}

// ── AC9 停止锁存 ───────────────────────────────────────────────────
{
  const s = session('latch')
  await s.call('computer_do', { action: 'enter' })
  await s.call('computer_stop', {})
  const denied = await s.call('computer_do', { action: 'enter' })
  check('AC9 锁存期间 computer_do 被拒（同属桌面域）', denied.ok === false && /停止/.test(String(denied.result)),
    String(denied.result).slice(0, 50))
  await s.call('computer_resume', {})
  const back = await s.call('computer_do', { action: 'status' })
  check('AC9 resume 后仍可用', back.ok === true, String(back.result).slice(0, 40))
}

// ── AC10 事件接线（源级）────────────────────────────────────────────
{
  const src = readFileSync(join(repoRoot, 'index.js'), 'utf8')
  check('AC10 用仅观测事件 tools/result（waterfall 会崩主流程）',
    /ctx\.on\?\.\('tools\/result'/.test(src) && /noteToolCall\(/.test(src)
    && !/ctx\.on\?\.\('tools\/post-execute'/.test(src))
}

// ── AC11 宿主强制子集断言（离线守门：真机加载失败类问题）────────────────
// 依据（2026-09-17 实测）：defineTool() 会把作者面 schema 投影成宿主强制子集，注册时必须用它的返回值；
// 直接把原始字面量交给注册表会被 assertSupportedJsonSchema 拒 → 整棵插件树加载失败。
// 假注册表不做这层校验（离线曾经全绿但真机炸），所以这里显式用宿主的断言函数把每个定义过一遍。
{
  const t = await import('@deepseek-ai/dsh-tools')
  const { reg, ctx } = makeCtx({ services: makeServices(), agent: { id: 'subset' } })
  plugin.apply(ctx, cfgOf())
  await reg.get('computer_do').execute({ action: 'enter' }, { agent: { id: 'subset' }, signal: new AbortController().signal, get signalSet() { return true } })
  const bad = []
  for (const [name, def] of reg) {
    try {
      // 只断言 output.schema：它按宿主规则是"原始 JSON Schema"，由 assertSupportedJsonSchema 校验。
      // 参数表在 defineTool 之后已是投影形态（对象根），宿主另有 validateArgs 走作者面 spec，此处不重复断言。
      t.assertSupportedJsonSchema(def.output.schema)
    } catch (e) {
      bad.push(`${name}: ${String(e.message).slice(0, 90)}`)
    }
  }
  check('AC11 每个定义的输出 schema 都通过宿主强制子集断言', bad.length === 0 && reg.size === 21,
    bad.length ? bad.join(' | ') : `${reg.size} 个工具全部通过`)
  // 反向验证：未投影的原始字面量必须被拒（防止回归到"注册原始 def"）
  let rejected = false
  try { t.assertSupportedJsonSchema({ type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }) }
  catch { rejected = true }
  check('AC11 原始（未投影）schema 确实会被宿主拒——证明本断言有区分力', rejected)
}

if (!state.failures) cleanupWork(work)
console.log(`\n结果：${state.failures ? '❌ ' + state.failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(state.failures ? 1 : 0)
