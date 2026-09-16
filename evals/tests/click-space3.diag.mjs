/**
 * 收尾诊断：① observe 元素 x/y 属于哪个空间（屏幕物理 vs 窗口矩形相对）；
 * ② 点击空间的边界行为（哪些点会被引擎静默丢弃）。
 * 自动清理探针窗口。
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default
const marker = join(tmpdir(), `cu-click-probe3-${Date.now()}.txt`)
const services = {
  attachments: { imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] }, async saveImage(i) { return { attachmentId: 'sha256:' + '0'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } }, async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } } },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('x') } },
  approval: { async request() { return 'allowed-once' } },
}
const reg = new Map()
plugin.apply({ get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { reg.set(d.name, d); return () => {} } }, toolsRuntime: null }, { ttlMs: 120000, maxElements: 300, deliveryMode: 'auto', passwordScan: 'off' })
const exec = { agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }, signal: new AbortController().signal, get signalSet() { return true } }
const call = (n, a = {}) => reg.get(n).execute(a, exec)

const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'evals', 'tools', 'click-probe2.ps1'), '-Marker', marker, '-AliveSec', '120'], { stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => { out += d })
let probe = null
for (let i = 0; i < 40 && !probe; i++) { await delay(300); const l = out.split('\n').find((x) => x.trim().startsWith('{')); if (l) { try { probe = JSON.parse(l) } catch {} } }
const cleanup = () => { try { child.kill() } catch {}; try { rmSync(marker, { force: true }) } catch {} }
if (!probe) { console.log('probe failed'); cleanup(); process.exit(1) }

try {
  const obs = await call('screen_observe', { window: probe.title, mode: 'ax' })
  const O = obs.screenOrigin
  console.log('driver bounds(物理):', JSON.stringify(O))
  console.log('探针自报 客户区逻辑原点:', probe.clientScreen.l + ',' + probe.clientScreen.t, '| 矩形(客户区逻辑):', JSON.stringify(probe.rect))
  const px = obs.elements || []
  console.log('observe 元素样例(前 6):', JSON.stringify(px.slice(0, 6)))
  // 期望：矩形中心在「屏幕物理」= (132+190*1.5, 826+115*1.5) = (417,998)；在「窗口矩形相对物理」= (417-131, 998-780) = (286,218)
  console.log('参照：矩形中心 屏幕物理≈(417,998) / 窗口矩形相对物理≈(286,218) / 客户区逻辑=(190,115)')

  const pts = [[285, 218], [270, 205], [250, 190], [230, 170], [200, 150]]
  for (const [x, y] of pts) {
    try { rmSync(marker, { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    const r = await call('computer_click', { x, y })
    await delay(450)
    let rec = '(无 down)'
    try { rec = readFileSync(marker, 'utf8').trim() } catch {}
    console.log(`   click(${x},${y}) → ${rec} | ${String(r?.result || '').split('\n')[0].slice(0, 46)}`)
  }
} finally {
  cleanup(); await delay(400)
  const left = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*cu-click-probe*' } | Measure-Object).Count`], { encoding: 'utf8' }).trim()
  console.log('清理复核：残留探针窗口 =', left, '| 标记文件存在 =', existsSync(marker))
}
