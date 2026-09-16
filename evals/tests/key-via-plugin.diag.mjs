/**
 * 走"插件真实路径"的按键送达实验 + 环境干扰排查。
 * 目的：区分「目标是 WinUI3 才失败」与「本机输入环境整体失效」——issue 前必须排除后者。
 * 检查：前台窗口 / 会话是否锁定 / 是否存在置顶(TopMost)窗口干扰 / 用插件 computer_key（带后台→前台升级链）投递。
 * 自动清理本次启动的进程。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { execFileSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default
const { cuaCall } = await import(pathToFileURL(join(root, 'lib/cua.js')).href)

const services = {
  attachments: { imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] }, async saveImage(i) { return { attachmentId: 'sha256:' + '6'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } }, async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } } },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('x') } },
  approval: { async request() { return 'allowed-once' } },
}
const reg = new Map()
plugin.apply({ get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { reg.set(d.name, d); return () => {} } }, toolsRuntime: null }, { ttlMs: 120000, maxElements: 300, deliveryMode: 'auto', passwordScan: 'off' })
const ex = { agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }, signal: new AbortController().signal, get signalSet() { return true } }
const call = (n, a = {}) => reg.get(n).execute(a, ex)

const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()
const listW = async () => ((await cuaCall('list_windows', { on_screen_only: true })).windows || [])
const started = []

// ── 环境排查 ────────────────────────────────────────────────────────
console.log('=== 环境排查 ===')
console.log('会话锁定(输入桌面可开=1 未锁):', ps(`Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(int f, bool i, int a);  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);'; $h=[W.D]::OpenInputDesktop(0,$false,0x0001); if($h -ne [IntPtr]::Zero){[W.D]::CloseDesktop($h)|Out-Null; '1'}else{'0'}`))
console.log('当前前台窗口:', ps(`Add-Type -Namespace W2 -Name F -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int m);'; $h=[W2.F]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 256; [void][W2.F]::GetWindowText($h,$sb,256); $sb.ToString()`))
const topmost = (await listW()).filter((w) => /主机弹出窗口/.test(w.title || ''))
console.log('置顶/宿主弹窗数:', topmost.length)

// ── 目标：经典 Win32（regedit ctrl+f）与 WinUI3（notepad ctrl+s），走插件路径 ──
const marker = 'PLGPATH-' + Date.now().toString().slice(-5)
execFileSync('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath 'regedit.exe'; 'ok'`], { stdio: 'ignore' })
await delay(3000)
let rw = (await listW()).find((w) => /注册表编辑器/.test(w.title || ''))
if (rw) started.push(rw.pid)
console.log('\n=== A. 经典 Win32 / regedit ctrl+f（插件 computer_key）===')
if (!rw) console.log('regedit 未出现')
for (let i = 0; rw && i < 3; i++) {
  await call('screen_observe', { window: '注册表编辑器', mode: 'ax' }).catch(() => {})
  const r = await call('computer_key', { key: 'ctrl+f', foreground: true })
  await delay(1600)
  const dlg = (await listW()).some((w) => /查找|Find/.test(w.title || ''))
  console.log(`  #${i + 1} ok=${r.ok} 效果=${dlg ? '✅ 查找窗口出现' : '❌ 无'} | ${String(r.result).slice(0, 90)}`)
  if (dlg) {
    const d = (await listW()).find((w) => /查找|Find/.test(w.title || ''))
    await call('computer_key', { key: 'escape' }).catch(() => {})
    await delay(600); void d
  }
}

console.log('\n=== B. WinUI3 / notepad ctrl+s（插件 computer_key）===')
execFileSync('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath 'notepad.exe'; 'ok'`], { stdio: 'ignore' })
await delay(2500)
let nw = (await listW()).find((w) => /Notepad|记事本/.test(w.title || ''))
if (nw) started.push(nw.pid)
for (let i = 0; nw && i < 3; i++) {
  await call('screen_observe', { window: 'Notepad', mode: 'ax' }).catch(() => {})
  const r = await call('computer_key', { key: 'ctrl+s', foreground: true })
  await delay(1600)
  const dlg = (await listW()).some((w) => /另存为|Save As/.test(w.title || ''))
  console.log(`  #${i + 1} ok=${r.ok} 效果=${dlg ? '✅ 另存为出现' : '❌ 无'} | ${String(r.result).slice(0, 100)}`)
  if (dlg) { await call('computer_key', { key: 'escape' }).catch(() => {}); await delay(600) }
}

console.log('\n=== 清理 ===')
for (const pid of [...new Set(started)]) { try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' }) } catch {} }
await delay(800)
const left = (await listW()).filter((w) => /注册表编辑器|Notepad|记事本|另存为|查找/.test(w.title || ''))
console.log('残留实验窗口 =', left.length, left.map((w) => (w.title || '').slice(0, 30)).slice(0, 4))
