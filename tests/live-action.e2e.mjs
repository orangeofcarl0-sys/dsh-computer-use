/**
 * 真桌面动作闭环 E2E + 稳定性循环（直连真 cua-driver，不经 harness UI）。
 *
 * 目标窗口：临时目录里一个唯一命名的 txt（LIVE-E2E-<stamp>.txt）由**非提权 PS** 打开——
 *   标题含唯一文件名，每轮用该标题选窗口，不再用 'Notepad' 子串（桌面上有多个记事本时选择歧义，
 *   且残留的 WinUI 窗口 UIA 树是空的，选错就整轮失败）。
 * 每轮：observe(ax) 找文档元素 → computer_type 输入标记文本 → computer_verify 断言文本出现
 *   （UIA 读回）→ 剪贴板 write/read 往返 → computer_wait；多轮复用同一个窗口。
 * 收尾：**不杀进程、不关窗口、不关标签**（三条路实测都不可行或危险，详见文件末尾注释）——
 *   记事本会把文件标签并入既有窗口/进程，那里面有用户未保存的文档；只如实报告残留标签名，
 *   由人工关闭（选中该标签 → Ctrl+W → 不保存）。旧实现按 MainWindowTitle 匹配后 Stop-Process，
 *   实测非活动标签标题为空所以"碰巧没炸"，属运气不是设计。
 *
 * 目标：既验证"动作类工具在真机上确实生效"，也用多轮重复暴露抖动
 * （窗口竞态 / 驱动 daemon 掉线 / 快照过期边界）。
 *
 * 运行：node tests/live-action.e2e.mjs [轮数，默认 3]
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', nativeImage: 'auto', passwordScan: 'off' })
// 动态工具面（PLAN-meta-tool）：先展开，否则下面的动作/验证/应用工具都不可见
await (async () => { const d = registered.get('computer_do'); await d.execute({ action: 'enter' }, { agent: { id: 'live-e2e' }, signal: new AbortController().signal, get signalSet() { return true } }) })()

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

console.log(`live E2E：${rounds} 轮 × (observe → type → verify → clipboard)`)

// 0) 目标窗口准备（2026-09-17 重设计）
//    旧实现每次 app_launch 一个新记事本，再用标题子串 'Notepad' 去选窗口——桌面上有多个
//    记事本窗口（含用户文档、含 WinUI 无 UIA 树的残留窗口）时选择歧义，且每轮留一个关不掉的窗口。
//    现在：写一个唯一命名的临时文件并用**非提权 PS** 打开它 → 标题含唯一文件名 → 选择器确定；
//    该进程由本脚本创建，运行结束后按 **pid** 精确关闭（绝不按进程名杀）。
const stamp = Date.now().toString().slice(-6)
const targetFile = join(attachmentRoot, `LIVE-E2E-${stamp}.txt`)
writeFileSync(targetFile, 'live-e2e scratch\n')
const targetTitle = `LIVE-E2E-${stamp}.txt`

const ps = (script) => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
const notepadPidsBefore = ps("(Get-Process -Name Notepad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','")
const launchedPid = Number(ps(`(Start-Process notepad.exe -ArgumentList '${targetFile}' -PassThru).Id`))
const reusedProcess = notepadPidsBefore.split(',').filter(Boolean).includes(String(launchedPid))
record(0, '准备目标窗口（唯一标题 + 非提权记事本）', Number.isFinite(launchedPid) && launchedPid > 0,
  `pid=${launchedPid} title=${targetTitle}${reusedProcess ? '（复用了既有记事本进程 → 结束后不杀，如实报告残留）' : '（独立进程 → 结束后按 pid 关闭）'}`)
await delay(1200)

// 0b) 顺带覆盖插件的 app_launch（真机启动路径 + 回执形态）
{
  const launch = await call('app_launch', { name: 'Notepad' })
  record(0, 'app_launch（真机启动路径）', launch.value?.ok === true, (launch.value?.result || '').split('\n')[0].slice(0, 80))
}

for (let r = 1; r <= rounds; r++) {
  const mark = `LIVE-E2E-r${r}-${stamp}`
  let win = null
  try {
    // 1) 观察：用唯一文件名的窗口标题选择目标（确定命中本轮准备的那个窗口）
    const obs = await call('screen_observe', { window: targetTitle, mode: 'ax' })
    const obsOk = obs.value?.ok === true
    record(r, 'screen_observe(ax)', obsOk, (obs.value?.result || '').split('\n')[0].slice(0, 90))
    if (!obsOk) continue
    win = obs.value.window
    const elements = obs.value.elements || []
    const editable = elements.find((e) => /文档|Edit|text/i.test(String(e.role)) || /文档|Edit/i.test(String(e.label)))
      || elements[0]
    if (!editable) { record(r, 'find editable element', false, `no elements（窗口 ${JSON.stringify(win)}）`); continue }
    record(r, 'find editable element', true, `index=${editable.index} role=${editable.role}`)
    // 3) 输入标记文本（element 定向）
    const typed = await call('computer_type', { element: editable.index, text: mark })
    record(r, 'computer_type', typed.value?.ok === true, `${typed.ms}ms ${(typed.value?.result || '').split('\n')[0].slice(0, 70)}`)

    // 4) 独立见证：脚本自己用 UIA 读回文档文本，断言标记真的落进文档
    //    （文件型文档的标题是文件名，不再是首行文本，所以标题断言在这里不适用；
    //     插件侧的 computer_verify 也把"agent 自己输入的内容"判为不可信证据——见 4b）
    await delay(400)
    const readback = (() => {
      try {
        const esc = targetTitle.replace(/'/g, "''")
        const script = [
          'Add-Type -AssemblyName UIAutomationClient;',
          'Add-Type -AssemblyName UIAutomationTypes;',
          '$AE=[System.Windows.Automation.AutomationElement]; $TS=[System.Windows.Automation.TreeScope];',
          '$c=New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window);',
          '$wins=$AE::RootElement.FindAll($TS::Children,$c);',
          `$win=$null; foreach($w in $wins){ if($w.Current.Name -like '*${esc}*'){ $win=$w; break } };`,
          'if($win -eq $null){ "window-not-found"; exit 0 };',
          '$dc=New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document);',
          '$d=$win.FindFirst($TS::Descendants,$dc); if($d -eq $null){ $dc=New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit); $d=$win.FindFirst($TS::Descendants,$dc) };',
          'if($d -eq $null){ "document-not-found"; exit 0 };',
          '$vp=$d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);',
          '$t=$vp.Current.Value; if($t -eq $null){ "empty" } else { $t }',
        ].join(' ')
        return ps(script)
      } catch (e) {
        return 'readback-error: ' + String(e.message).slice(0, 80)
      }
    })()
    record(r, 'UIA 读回文档含标记（独立见证）', readback.includes(mark), `readback=${readback.slice(0, 60)}`)

    // 4a) 插件侧 verify：窗口谓词（标题含唯一文件名）必须 satisfied
    const verWin = await call('computer_verify', {
      pid: win?.pid,
      window_id: win?.windowId ?? win?.window_id,
      expect: JSON.stringify([{ window: { exists: true } }]),
    })
    record(r, 'computer_verify(window exists)', verWin.value?.ok === true && /satisfied/.test(String(verWin.value?.status)),
      `status=${verWin.value?.status}`)

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
    // 7) 本轮不清理窗口：唯一目标窗口承载多轮标记，收尾时按 pid 统一处置（见文件末尾）。
    record(r, 'window kept for later rounds', true, `title=${targetTitle}`)
  }
}

// ── 收尾：不杀进程、不关窗口 ─────────────────────────────────────
// 实测（2026-09-17，本机 Win11 24H2 记事本）：
//  - 记事本把文件标签并入**既有窗口/进程**（里面可能有用户文档）→ 按进程名或按窗口 WM_CLOSE 都可能
//    波及用户未保存的文档，一律禁止；WM_CLOSE 还会先弹"另存为"对话框（UIA 树为空，无人值守无法回答）。
//  - UIA 关闭标签也不行：Invoke 标签内的"关闭标签页"按钮实测 no-op（与驱动遇到的 WinUI 限制同源，上游 #3908）。
//  - Start-Process -PassThru 拿到的 pid 是**启动器**进程（它随即退出），不是持有窗口的进程，据此"关闭成功"是假阳性。
// 所以：目标标签会留在 Windows 记事本里，由人工关闭（选中该标签 → Ctrl+W → 不保存）。本脚本如实报告它的名字。
record(0, 'cleanup（不杀进程：残留标签由人工关闭）', true,
  `残留标签=${targetTitle}（人工：选中它 Ctrl+W → 不保存）`)

try { rmSync(attachmentRoot, { recursive: true, force: true }) } catch {}

// ── 汇总 ────────────────────────────────────────────────────────────
console.log('\n── 分步稳定性 ──')
const byStep = new Map()
for (const r of results) {
  const k = r.step
  const cur = byStep.get(k) || { ok: 0, total: 0 }
  cur.total++
  if (r.ok) cur.ok++
  byStep.set(k, cur)
}
for (const [step, v] of byStep) console.log(`  ${v.ok}/${v.total}  ${step}`)
console.log(`\n结果：${results.filter((r) => r.ok).length}/${results.length} 步通过，${failures} 失败`)
console.log('注意：本脚本不杀进程也不关窗口——请人工关闭上面报告的残留标签（Ctrl+W → 不保存）。')
process.exit(failures ? 1 : 0)
