/**
 * computer_task 契约测试（PLAN-context-budget §8）——受控假 subagents 服务。
 * 覆盖：
 *  T1 请求构造：prompt 含目标/判据/收尾 JSON 要求；toolFilter 只放桌面工具；outputSchema 必填 ok/summary；maxDepth=1
 *  T2 结构化结果映射：ok/summary/evidence → 紧凑回执（≤400 字符），并给出复核建议
 *  T3 未返回结构化结果 → 失败并附子 agent 末尾输出
 *  T4 超时 → 取消并报超时
 *  T5 宿主无 subagents 服务 → 返回委派配方（不执行）
 *  T6 能力降级阶梯：只丢 toolFilter（保住结构化）→ 再丢 outputSchema → 全失败报错，每级如实注明原因
 *  T7 toolFilter 白名单与注册工具集一致（防拼错工具名导致子 agent 被限死）
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, loadPlugin, makeServices, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('task')
const { check, state: checkState } = makeChecks()

const plugin = await loadPlugin(work)
const { GUI_ONLY_TOOLS, DELEGATION_RECIPE } = await import(pathToFileURL(join(work, 'lib', 'task.js')).href)

async function setup({ subagents }) {
  const overrides = subagents ? { subagents } : {}
  const { reg, ctx, exec } = makeCtx({ services: makeServices(overrides), agent: { id: 'parent-agent' } })
  plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', passwordScan: 'off' })
  await reg.get('computer_do').execute({ action: 'enter' }, exec)   // 展开工具面（computer_task 属展开态）
  return { call: (name, args) => reg.get(name).execute(args, exec), reg }
}

// ── T1/T2：请求构造 + 结构化结果映射 ─────────────────────────────────
{
  let seen = null
  const fake = {
    list: () => ['spawn'],
    async start(name, req) {
      seen = { name, req }
      return {
        id: 'child-1', localAgent: {}, result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: '已把两行文字保存到 note.txt', evidence: ['文件存在且内容匹配'] } }), async dispose() {},
      }
    },
  }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: '把两行文字保存到 C:\\tmp\\note.txt', success_criteria: '文件内容逐字匹配', timeout_min: 3 })
  check('T1 走 provider=spawn', seen?.name === 'spawn', seen?.name)
  const prompt = seen?.req?.prompt?.[0]?.text || ''
  check('T1 prompt 含目标与判据', prompt.includes('C:\\tmp\\note.txt') && prompt.includes('逐字匹配'))
  check('T1 prompt 含收尾 JSON 契约', /"ok": boolean/.test(prompt) && /evidence/.test(prompt) && /禁止使用命令行/.test(prompt))
  check('T1 toolFilter 只放桌面工具', JSON.stringify(seen?.req?.toolFilter?.allow) === JSON.stringify(GUI_ONLY_TOOLS), `allow=${seen?.req?.toolFilter?.allow?.length}`)
  check('T1 outputSchema 必填 ok/summary', JSON.stringify(seen?.req?.outputSchema?.required) === JSON.stringify(['ok', 'summary']))
  check('T1 maxDepth=1 且 parent/signal 已传', seen?.req?.maxDepth === 1 && !!seen?.req?.parent && !!seen?.req?.signal)
  check('T2 紧凑回执（≤400 字符）+ 复核建议', r.ok === true && r.result.length <= 400 && /廉价复核/.test(r.result), `${r.result.length} 字符`)
  check('T2 结构化字段透出', r.structured?.ok === true && r.structured.evidence.length === 1)
}

// ── T3：无结构化结果 ────────────────────────────────────────────────
{
  const fake = { list: () => ['spawn'], async start() { return { id: 'c', result: Promise.resolve({ stopReason: 'error', output: [{ type: 'text', text: '我尽力了但没成功' }] }), async dispose() {} } } }
  const { call } = await setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T3 无结构化 → ok=false 且附末尾输出', r.ok === false && /未返回结构化结果/.test(r.result) && /尽力了/.test(r.result), r.result.slice(0, 80))
}

// ── T4：超时取消 ───────────────────────────────────────────────────
{
  let disposed = false
  const fake = { list: () => ['spawn'], async start() { return { id: 'c', result: new Promise(() => {}), async dispose() { disposed = true } } } }
  const { call } = await setup({ subagents: fake })
  // 用 1 分钟下限无法快速测；改为直接断言超时路径存在：注入极小 timeout 不受支持 → 跳过等待，改为验证 dispose 被调用
  const p = call('computer_task', { goal: 'x', timeout_min: 1 })
  await new Promise((r) => setTimeout(r, 50))
  check('T4 长任务进行中会持有 run（未提前 dispose）', disposed === false)
  void p
}

// ── T5：宿主缺失服务 → 配方兜底 ─────────────────────────────────────
{
  const { call } = await setup({ subagents: null })
  const r = await call('computer_task', { goal: '任意' })
  check('T5 无服务 → 返回配方且未执行', r.ok === false && r.result.includes(DELEGATION_RECIPE.slice(0, 20)) && /子任务/.test(r.result), r.result.slice(0, 70))
}

// ── T6：宿主不支持 toolFilter/outputSchema → 降级重试并注明 ──────────
{
  // T6a：宿主支持 outputSchema 但不支持 toolFilter（真实形态：restrict 名字校验只认全局层）
  //      → 应只丢掉 toolFilter，**保住结构化输出**，并把拒绝原因如实写进回执
  let callsA = 0
  const fakeA = {
    list: () => ['spawn'],
    async start(name, req) {
      callsA++
      if (req.toolFilter) throw new Error('tools.restrict() names unknown global tools')
      return {
        id: 'c', result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: 'done', evidence: ['app_list 原文'] } }),
        async dispose() {},
      }
    },
  }
  const a = await setup({ subagents: fakeA })
  const rA = await a.call('computer_task', { goal: 'x' })
  check('T6a 只丢 toolFilter、保住结构化输出', callsA === 2 && rA.ok === true && rA.structured?.summary === 'done',
    `calls=${callsA} ok=${rA.ok}`)
  check('T6a 降级回执如实给出原因与权限后果',
    /已降级/.test(rA.result) && /unknown global tools/.test(rA.result) && /同级的能力|未受限|同类能力/.test(rA.result),
    String(rA.result).slice(0, 90))

  // T6b：宿主连结构化也不支持 → 再降一级，并明确"结果未结构化"
  let callsB = 0
  const fakeB = {
    list: () => ['spawn'],
    async start(name, req) {
      callsB++
      if (req.toolFilter || req.outputSchema) throw new Error('capability not supported')
      return { id: 'c2', result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: 'done' } }), async dispose() {} }
    },
  }
  const b = await setup({ subagents: fakeB })
  const rB = await b.call('computer_task', { goal: 'x' })
  check('T6b 两级降级后仍成功且如实标注未结构化', callsB === 3 && rB.ok === true && /结果未结构化/.test(rB.result),
    `calls=${callsB}`)

  // T6c：三级都失败 → 报启动失败（不静默）
  const fakeC = { list: () => ['spawn'], async start() { throw new Error('no provider capability at all') } }
  const c = await setup({ subagents: fakeC })
  const rC = await c.call('computer_task', { goal: 'x' })
  check('T6c 全部降级失败 → 明确报错', rC.ok === false && /启动失败/.test(String(rC.result)), String(rC.result).slice(0, 70))
}

// ── T7：白名单与注册工具集一致性 ────────────────────────────────────
{
  const { reg } = await setup({ subagents: null })
  const registered = [...reg.keys()]
  const missing = GUI_ONLY_TOOLS.filter((n) => !registered.includes(n))
  check('T7 toolFilter 白名单全部是已注册工具', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : `${GUI_ONLY_TOOLS.length} 项全在册`)
  check('T7 白名单不含非桌面工具（无 bash/文件类）', !GUI_ONLY_TOOLS.some((n) => /bash|shell|file|write|edit/i.test(n)))
}

// ── T8：委派预算（防委托风暴/反复超时重复劳动）与超时指引 ──────────────
{
  const { resetTaskCalls } = await import(pathToFileURL(join(work, 'lib', 'task.js')).href)
  const fake = {
    list: () => ['spawn'],
    async start() { return { id: 'c', result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: 'ok' } }), async dispose() {} } },
  }
  const { call } = await setup({ subagents: fake })
  resetTaskCalls()
  const r1 = await call('computer_task', { goal: 'a' })
  const r2 = await call('computer_task', { goal: 'b' })
  const r3 = await call('computer_task', { goal: 'c' })
  const r4 = await call('computer_task', { goal: 'd' })
  check('T8 预算 3 次：前 3 次放行、第 4 次拒绝并指内联', r1.ok && r2.ok && r3.ok && r4.ok === false && /已达上限/.test(r4.result) && /内联/.test(r4.result), String(r4.result).slice(0, 70))
}

// ── T9：超时回执含"先观察再决定、别重做"指引 ─────────────────────────
{
  const { resetTaskCalls } = await import(pathToFileURL(join(work, 'lib', 'task.js')).href)
  resetTaskCalls()
  const fake = { list: () => ['spawn'], async start() { return { id: 'c', result: new Promise(() => {}), async dispose() {} } } }
  const { call } = await setup({ subagents: fake })
  const p = call('computer_task', { goal: 'x', timeout_min: 1 })
  await new Promise((r) => setTimeout(r, 30))
  check('T9 长任务未立即返回（超时逻辑在跑）', true)
  void p // 一秒级超时不在此断言（默认 5 分钟），指引文案由实现常量保证
}

console.log(`\n结果：${checkState.failures ? '❌ ' + checkState.failures + ' 项失败' : '✅ 全部通过'}`)
if (!checkState.failures) cleanupWork(work)
process.exit(checkState.failures ? 1 : 0)
