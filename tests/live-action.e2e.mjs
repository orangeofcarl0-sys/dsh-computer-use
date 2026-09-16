/**
 * 真桌面动作闭环 E2E + 稳定性循环（直连真 cua-driver，不经 harness UI）。
 *
 * 每轮：app_launch 记事本 → observe(ax) 找文档元素 → computer_type 输入标记文本
 *      → computer_verify 断言文本出现（UIA 读回）→ 剪贴板 write/read 往返
 *      → computer_wait → 清理该窗口 → 下一轮。
 * 目标：既验证"动作类工具在真机上确实生效"，也用多轮重复暴露抖动
 * （窗口竞态 / 驱动 daemon 掉线 / 快照过期边界）。
 *
 * 运行：node tests/live-action.e2e.mjs [轮数，默认 3]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const rounds = Number(process.argv[2] || '3')
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default

const attachmentRoot = mkdtempSync(join(tmpdir(), 'cu-live-att-'))
const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    async saveImage(input) {
      return { attachmentId: 'sha256:' + 'b'.repeat(64), mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1, name: input.name }
    },
    async validateImage() {},
    async readImage(ref) { return { ref, data: new Uint8Array([1]) } },
  },
  llm: {
    async resolveModelInfo(provider, model) { return { provider, id: model, inputModalities: ['text', 'image'] } },
    async * stream() { throw new Error('MISSING_CREDENTIAL (stub)') },
  },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
const ctx = {
  get: (n) => services[n],
  logger: { info() {}, error() {} },
  tools: { register(def) { registered.set(def.name, def); return () => registered.delete(def.name) } },
  toolsRuntime: null,
}
// passwordScan off：本轮不需要 sidecar spawn
plugin.apply(ctx, { ttlMs: 60000, maxElements: 500, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })

const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
async function call(name, args = {}) {
  const def = registered.get(name)
  if (!def) throw new Error('tool not registered: ' + name)
  const exec = { agent, signal: new AbortController().signal, get signalSet() { return true } }
  const t0 = Date.now()
  const value = await def.execute(args, exec)
  return { value, ms: Date.now() - t0 }
}

const results = []
let failures = 0
const record = (round, step, ok, detail = '') => {
  results.push({ round, step, ok, detail })
  if (!ok) failures++
  console.log(`  ${ok ? '✅' : '❌'} [r${round}] ${step}${detail ? ' — ' + detail : ''}`)
}

console.log(`live E2E：${rounds} 轮 × (launch → observe → type → verify → clipboard → cleanup)`)
for (let r = 1; r <= rounds; r++) {
  const mark = `LIVE-E2E-r${r}-${Date.now().toString().slice(-5)}`
  let win = null
  try {
    // 1) 启动记事本（绑定窗口）
    const launch = await call('app_launch', { name: 'Notepad' })
    const launchOk = launch.value?.ok === true
    record(r, 'app_launch', launchOk, (launch.value?.result || '').split('\n')[0].slice(0, 90))
    if (!launchOk) continue
    const m = String(launch.value.result).match(/window_id[=:]?\s*(\d+)|pid[=:]?\s*(\d+)/g) || []
    // 从列表里取记事本窗口（避免解析 launch 文案）
    const wins = await call('app_list', {})
    void wins

    // 2) 观察：按标题子串选目标窗口（screen_observe 的参数是 window，不是 app）
    const obs = await call('screen_observe', { window: 'Notepad', mode: 'ax' })
    const obsOk = obs.value?.ok === true
    record(r, 'screen_observe(ax)', obsOk, (obs.value?.result || '').split('\n')[0].slice(0, 90))
    if (!obsOk) continue
    win = obs.value.window
    const elements = obs.value.elements || []
    const editable = elements.find((e) => /文档|Edit|text/i.test(String(e.role)) || /文档|Edit/i.test(String(e.label)))
      || elements[0]
    if (!editable) { record(r, 'find editable element', false, 'no elements'); continue }
    record(r, 'find editable element', true, `index=${editable.index} role=${editable.role}`)

    // 3) 输入标记文本（element 定向）
    const typed = await call('computer_type', { element: editable.index, text: mark })
    record(r, 'computer_type', typed.value?.ok === true, `${typed.ms}ms ${(typed.value?.result || '').split('\n')[0].slice(0, 70)}`)

    // 4) verify：断言标记出现在窗口（记事本标题=首行文本，故 label_contains 可命中）
    await delay(400)
    const ver = await call('computer_verify', {
      pid: win?.pid,
      window_id: win?.windowId ?? win?.window_id,
      expect: JSON.stringify([{ element: { selector: { label_contains: mark }, exists: true } }]),
    })
    const vOk = ver.value?.ok === true && /satisfied/.test(String(ver.value?.status))
    record(r, 'computer_verify(title contains mark)', vOk, `status=${ver.value?.status}`)

    // 4b) 安全语义断言：文档元素（agent 自己输入的内容）不得作为自证据 → unknown/untrusted_source
    const verDoc = await call('computer_verify', {
      pid: win?.pid,
      window_id: win?.windowId ?? win?.window_id,
      expect: JSON.stringify([{ element: { selector: { role: '文档', label_contains: mark }, exists: true, enabled: true, selected: null, value_equals: null } }]),
    })
    const uReason = String(verDoc.value?.results?.[0]?.unknownReason || '')
    record(r, 'verify(自输入文本=不可信证据)', verDoc.value?.status === 'unknown' && /untrusted/.test(uReason),
      `status=${verDoc.value?.status} reason=${uReason}`)

    // 4c) 未知参数必须被拒（防止参数名写错静默回退到最前窗口）
    const badArg = await call('screen_observe', { app: 'Notepad' })
    record(r, '未知参数拒绝(app=…)', badArg.value?.ok === false && /未知参数/.test(String(badArg.value?.result || '')),
      String(badArg.value?.result || '').slice(0, 80))

    // 5) 剪贴板往返
    const cw = await call('computer_clipboard', { action: 'write', text: mark })
    const cr = await call('computer_clipboard', { action: 'read' })
    const cOk = cw.value?.ok === true && String(cr.value?.text || '').includes(mark)
    record(r, 'clipboard write→read', cOk, `read=${String(cr.value?.text || '').slice(0, 24)}`)

    // 6) wait（短）
    const w = await call('computer_wait', { ms: 120 })
    record(r, 'computer_wait', w.value?.ok === true, `${w.ms}ms`)
  } catch (err) {
    record(r, 'exception', false, String(err.message || err).slice(0, 140))
  } finally {
    // 7) 清理：关掉本轮记事本（标题含本轮标记）；驱动 spawn 的窗口可能杀不掉，如实记录
    try {
      const { execFileSync } = await import('node:child_process')
      const ps = [
        'Get-Process -Name Notepad -ErrorAction SilentlyContinue |',
        `Where-Object { $_.MainWindowTitle -like '*${mark}*' } |`,
        'Stop-Process -Force -ErrorAction SilentlyContinue;',
        "'ok'",
      ].join(' ')
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
      record(r, 'cleanup windows', true, 'issued')
    } catch (e) {
      record(r, 'cleanup windows', false, String(e.message).slice(0, 80))
    }
  }
}

try { rmSync(attachmentRoot, { recursive: true, force: true }) } catch {}

const byStep = {}
for (const x of results) {
  byStep[x.step] = byStep[x.step] || { ok: 0, n: 0 }
  byStep[x.step].n++
  if (x.ok) byStep[x.step].ok++
}
console.log('\n── 分步稳定性 ──')
for (const [step, s] of Object.entries(byStep)) console.log(`  ${s.ok}/${s.n}  ${step}`)
console.log(`\n结果：${results.filter((x) => x.ok).length}/${results.length} 步通过，${failures} 失败`)
process.exit(failures ? 1 : 0)
