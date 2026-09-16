/** 定点诊断：记事本文档文本能否被判 satisfied（谓词形状 × 观测面）。 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default
const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png'] },
    async saveImage(i) { return { attachmentId: 'sha256:' + 'c'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } },
    async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } },
  },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('stub') } },
  approval: { async request() { return 'allowed-once' } },
}
const registered = new Map()
plugin.apply({ get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { registered.set(d.name, d); return () => {} } }, toolsRuntime: null },
  { ttlMs: 60000, maxElements: 500, deliveryMode: 'auto', passwordScan: 'off' })
const agent = { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
const call = async (n, a = {}) => (await registered.get(n).execute(a, { agent, signal: new AbortController().signal, get signalSet() { return true } }))

const mark = 'DIAG-' + Date.now().toString().slice(-6)
console.log('launch:', (await call('app_launch', { name: 'Notepad' })).result.split('\n')[0].slice(0, 80))
await delay(1500)
const obs = await call('screen_observe', { app: 'Notepad', mode: 'ax' })
const win = obs.window
console.log('window:', JSON.stringify(win))
console.log('elements:', JSON.stringify((obs.elements || []).map((e) => ({ i: e.index, role: e.role, label: String(e.label).slice(0, 30) }))))
const doc = (obs.elements || []).find((e) => /文档/.test(String(e.role))) || (obs.elements || [])[0]
console.log('type:', (await call('computer_type', { element: doc.index, text: mark })).ok)
await delay(600)
const obs2 = await call('screen_observe', { app: 'Notepad', mode: 'ax' })
console.log('after-type elements:', JSON.stringify((obs2.elements || []).map((e) => ({ i: e.index, role: e.role, label: String(e.label).slice(0, 40) }))))

const shapes = [
  ['window exists', [{ window: { exists: true } }]],
  ['doc label_contains(mark)', [{ element: { selector: { role: '文档', label_contains: mark }, exists: true, enabled: true, selected: null, value_equals: null } }]],
  ['any label_contains(mark)', [{ element: { selector: { label_contains: mark }, exists: true } }]],
  ['title label_contains(Notepad)', [{ element: { selector: { label_contains: 'Notepad' }, exists: true } }]],
]
for (const [name, expect] of shapes) {
  try {
    const v = await call('computer_verify', { window_id: win?.windowId ?? win?.window_id, pid: win?.pid, expect: JSON.stringify(expect) })
    console.log(`verify[${name}] status=${v.status} ok=${v.ok} results=${JSON.stringify((v.results || []).map((r) => ({ s: r.status, u: r.unknownReason, o: String(r.observed || '').slice(0, 60) })))}`)
  } catch (e) {
    console.log(`verify[${name}] threw: ${String(e.message).slice(0, 100)}`)
  }
}
// 清理
const { execFileSync } = await import('node:child_process')
execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Name Notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${mark}*' } | Stop-Process -Force -ErrorAction SilentlyContinue; 'ok'`], { stdio: 'ignore' })
