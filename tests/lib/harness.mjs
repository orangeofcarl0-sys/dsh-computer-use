/**
 * 测试共享脚手架（P0-1，2026-09-17）。
 *
 * 三套测试（schema.conformance / observe.dedup / task.tool）此前各自复制同一段
 * "临时工作副本 + 覆盖 lib/cua.js 桩 + 假 ctx/exec" 约 30 行 → 抽到这里统一维护。
 *
 * 约定：
 * - 工作副本放在仓库内 `.dsh-test/`（index.js 需沿目录树解析 @deepseek-ai/schemastery）。
 * - 桩驱动通过 writeStubDriver(work, source) 写入；source 是完整的 lib/cua.js 源码。
 * - Schema 校验器 validateSchema 与 dsh 的严格语义对齐（additionalProperties:false、
 *   required、type、oneOf、enum、items 递归），且按"经 JSON 传输后的值"校验。
 */
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const workRoot = join(repoRoot, '.dsh-test')

/** 建一份插件工作副本（lib/ + index.js）。prefix 用于人读区分。 */
export function makeWorkCopy(prefix = 't') {
  mkdirSync(workRoot, { recursive: true })
  const work = mkdtempSync(join(workRoot, `${prefix}-`))
  cpSync(join(repoRoot, 'lib'), join(work, 'lib'), { recursive: true })
  cpSync(join(repoRoot, 'index.js'), join(work, 'index.js'))
  return work
}

/** 用给定源码覆盖工作副本里的 lib/cua.js（受控引擎桩）。 */
export function writeStubDriver(work, source) {
  writeFileSync(join(work, 'lib', 'cua.js'), source)
}

/** 载入工作副本里的插件（返回 plugin.default）。 */
export async function loadPlugin(work) {
  return (await import(pathToFileURL(join(work, 'index.js')).href)).default
}

/** 假服务面（attachments / llm / approval），可注入 subagents 等。 */
export function makeServices(overrides = {}) {
  return {
    attachments: {
      imageLimits: {
        maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20,
        maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      async saveImage(i) {
        return { attachmentId: 'sha256:' + '0'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: i.width ?? 1, height: i.height ?? 1, name: i.name }
      },
      async validateImage() {},
      async readImage(ref) { return { ref, data: new Uint8Array([1]) } },
    },
    llm: {
      async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } },
      async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') },
    },
    approval: { async request() { return 'allowed-once' } },
    ...overrides,
  }
}

/**
 * 假 ctx + 执行上下文：注册被捕获到 reg（name → def）。
 * @returns {{reg: Map, ctx: object, exec: object, call: (name, args) => Promise<any>}}
 */
export function makeCtx({ services = makeServices(), config = {}, agent = { id: 'test-parent' } } = {}) {
  const reg = new Map()
  const register = (d) => { reg.set(d.name, d); return () => reg.delete(d.name) }
  // 会话作用域注册表：模拟宿主的 agent.ctx.tools（动态工具面的展开走这条路径）。
  // 与全局共同写入同一张 reg，便于测试沿用"按名字取工具"的写法；作用域隔离由不同 makeCtx 实例验证。
  const scopeReg = new Map()
  const scopeTools = {
    register(d) { scopeReg.set(d.name, d); reg.set(d.name, d); return () => { scopeReg.delete(d.name); reg.delete(d.name) } },
  }
  if (agent && typeof agent === 'object' && !agent.ctx) agent.ctx = { tools: scopeTools }
  const ctx = {
    get: (n) => services[n],
    logger: { info() {}, error() {} },
    tools: { register },
    toolsRuntime: null,
    on() { return () => {} },
  }
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  return { reg, scopeReg, ctx, exec }
}

/** 严格 schema 校验（与 dsh 语义对齐；值先做 JSON 往返，模拟传输后形态）。 */
export function validateSchema(schema, rawValue, path = 'value', out = []) {
  const value = rawValue === undefined ? undefined : JSON.parse(JSON.stringify(rawValue ?? null))
  return validate(schema, value, path, out)
}

function validate(schema, value, path, out) {
  if (!schema || typeof schema !== 'object') return out
  if (schema.oneOf) {
    const ok = schema.oneOf.some((s) => validate(s, value, path, []).length === 0)
    if (!ok) out.push(`${path}: does not match any oneOf branch`)
    return out
  }
  const t = schema.type
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const typeOk =
    !t ||
    (t === 'object' && kind === 'object') ||
    (t === 'array' && kind === 'array') ||
    (t === 'string' && kind === 'string') ||
    (t === 'boolean' && kind === 'boolean') ||
    (t === 'integer' && kind === 'number' && Number.isInteger(value)) ||
    (t === 'number' && kind === 'number') ||
    (t === 'null' && kind === 'null')
  if (!typeOk) { out.push(`${path}: expected ${t}, got ${kind}`); return out }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: "${value}" not in enum`)
  if (t === 'object' && kind === 'object') {
    const props = schema.properties || {}
    for (const req of schema.required || []) if (!(req in value)) out.push(`${path}.${req}: required but missing`)
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) out.push(`${path}.${k}: undeclared property (additionalProperties:false)`)
    }
    for (const [k, s] of Object.entries(props)) if (k in value) validate(s, value[k], `${path}.${k}`, out)
  }
  if (t === 'array' && kind === 'array' && schema.items) {
    value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, out))
  }
  return out
}

/** 小测试记录器：返回 {check, failures}。 */
export function makeChecks() {
  const state = { failures: 0 }
  const check = (name, ok, detail = '') => {
    if (!ok) state.failures++
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  }
  return { check, state }
}

/** 清理工作副本（默认全清 .dsh-test 下的副本）。 */
export function cleanupWork(work) {
  try { if (work && existsSync(work)) rmSync(work, { recursive: true, force: true }) } catch {}
}
