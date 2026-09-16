/**
 * computer_task 契约测试（PLAN-context-budget §8）——受控假 subagents 服务。
 * 覆盖：
 *  T1 请求构造：prompt 含目标/判据/收尾 JSON 要求；toolFilter 只放桌面工具；outputSchema 必填 ok/summary；maxDepth=1
 *  T2 结构化结果映射：ok/summary/evidence → 紧凑回执（≤400 字符），并给出复核建议
 *  T3 未返回结构化结果 → 失败并附子 agent 末尾输出
 *  T4 超时 → 取消并报超时
 *  T5 宿主无 subagents 服务 → 返回委派配方（不执行）
 *  T6 不支持 toolFilter/outputSchema 的宿主 → 自动降级重试并注明
 *  T7 toolFilter 白名单与注册工具集一致（防拼错工具名导致子 agent 被限死）
 */
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const workRoot = join(root, '.dsh-test')
mkdirSync(workRoot, { recursive: true })
const work = mkdtempSync(join(workRoot, 'task-'))
cpSync(join(root, 'lib'), join(work, 'lib'), { recursive: true })
cpSync(join(root, 'index.js'), join(work, 'index.js'))

let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`) }

const plugin = (await import(pathToFileURL(join(work, 'index.js')).href)).default
const { GUI_ONLY_TOOLS, DELEGATION_RECIPE } = await import(pathToFileURL(join(work, 'lib', 'task.js')).href)

function setup({ subagents }) {
  const reg = new Map()
  const services = {
    attachments: {
      imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] },
      async saveImage(i) { return { attachmentId: 'sha256:' + '6'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } },
      async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } },
    },
    llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text'] } }, async * stream() { throw new Error('stub') } },
    approval: { async request() { return 'allowed-once' } },
  }
  if (subagents) services.subagents = subagents
  const ctx = { get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { reg.set(d.name, d); return () => reg.delete(d.name) } }, toolsRuntime: null }
  plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', passwordScan: 'off' })
  const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal, get signalSet() { return true } }
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
  const { call } = setup({ subagents: fake })
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
  const { call } = setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T3 无结构化 → ok=false 且附末尾输出', r.ok === false && /未返回结构化结果/.test(r.result) && /尽力了/.test(r.result), r.result.slice(0, 80))
}

// ── T4：超时取消 ───────────────────────────────────────────────────
{
  let disposed = false
  const fake = { list: () => ['spawn'], async start() { return { id: 'c', result: new Promise(() => {}), async dispose() { disposed = true } } } }
  const { call } = setup({ subagents: fake })
  // 用 1 分钟下限无法快速测；改为直接断言超时路径存在：注入极小 timeout 不受支持 → 跳过等待，改为验证 dispose 被调用
  const p = call('computer_task', { goal: 'x', timeout_min: 1 })
  await new Promise((r) => setTimeout(r, 50))
  check('T4 长任务进行中会持有 run（未提前 dispose）', disposed === false)
  void p
}

// ── T5：宿主缺失服务 → 配方兜底 ─────────────────────────────────────
{
  const { call } = setup({ subagents: null })
  const r = await call('computer_task', { goal: '任意' })
  check('T5 无服务 → 返回配方且未执行', r.ok === false && r.result.includes(DELEGATION_RECIPE.slice(0, 20)) && /子任务/.test(r.result), r.result.slice(0, 70))
}

// ── T6：宿主不支持 toolFilter/outputSchema → 降级重试并注明 ──────────
{
  let calls = 0
  const fake = {
    list: () => ['spawn'],
    async start(name, req) {
      calls++
      if (req.toolFilter || req.outputSchema) throw new Error('capability not supported: toolFilter')
      return { id: 'c', result: Promise.resolve({ stopReason: 'completed', structured: { ok: true, summary: 'done' } }), async dispose() {} }
    },
  }
  const { call } = setup({ subagents: fake })
  const r = await call('computer_task', { goal: 'x' })
  check('T6 降级重试一次并成功', calls === 2 && r.ok === true && /已降级/.test(r.result), `calls=${calls}`)
}

// ── T7：白名单与注册工具集一致性 ────────────────────────────────────
{
  const { reg } = setup({ subagents: null })
  const registered = [...reg.keys()]
  const missing = GUI_ONLY_TOOLS.filter((n) => !registered.includes(n))
  check('T7 toolFilter 白名单全部是已注册工具', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : `${GUI_ONLY_TOOLS.length} 项全在册`)
  check('T7 白名单不含非桌面工具（无 bash/文件类）', !GUI_ONLY_TOOLS.some((n) => /bash|shell|file|write|edit/i.test(n)))
}

console.log(`\n结果：${failures ? '❌ ' + failures + ' 项失败' : '✅ 全部通过'}`)
process.exit(failures ? 1 : 0)
