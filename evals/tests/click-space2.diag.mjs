/**
 * 点击坐标空间标定 v2：自绘矩形探针 + 表单级 MouseDown 记录。
 * 扫描多个点击点 → 每个点都有"客户区逻辑坐标 + 是否落在矩形内"，据此解出精确仿射映射，
 * 再用解出的映射反算矩形中心做确认点击。
 * 运行：node evals/tests/click-space2.diag.mjs [DPI=1.5]
 * 结束时关闭探针并清理标记文件（不留下测试窗口）。
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default
const dpi = Number(process.argv[2] || '1.5')
const marker = join(tmpdir(), `cu-click-probe2-${Date.now()}.txt`)
try { rmSync(marker, { force: true }) } catch {}

const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg'] },
    async saveImage(i) { return { attachmentId: 'sha256:' + 'f'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } },
    async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } },
  },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('stub') } },
  approval: { async request() { return 'allowed-once' } },
}
const reg = new Map()
plugin.apply({ get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { reg.set(d.name, d); return () => {} } }, toolsRuntime: null },
  { ttlMs: 120000, maxElements: 300, deliveryMode: 'auto', passwordScan: 'off' })
const exec = { agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }, signal: new AbortController().signal, get signalSet() { return true } }
const call = (n, a = {}) => reg.get(n).execute(a, exec)

const ps = join(root, 'evals', 'tools', 'click-probe2.ps1')
const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Marker', marker, '-AliveSec', '150'], { stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => { out += d })
let probe = null
for (let i = 0; i < 40 && !probe; i++) {
  await delay(300)
  const line = out.split('\n').find((l) => l.trim().startsWith('{'))
  if (line) { try { probe = JSON.parse(line) } catch {} }
}
const cleanup = () => {
  try { child.kill() } catch {}
  try { rmSync(marker, { force: true }) } catch {}
}
if (!probe) { console.log('probe failed:', out.slice(0, 200)); cleanup(); process.exit(1) }
console.log('probe:', JSON.stringify(probe))
console.log('dpi:', dpi, '| 客户区逻辑原点:', probe.clientScreen.l + ',' + probe.clientScreen.t, '| 矩形(客户区逻辑):', JSON.stringify(probe.rect))

try {
  const obs = await call('screen_observe', { window: probe.title, mode: 'ax' })
  console.log('driver bounds(物理):', JSON.stringify(obs.screenOrigin), '| window:', JSON.stringify(obs.window))

  const sweep = []
  for (const p of [[100, 80], [160, 80], [100, 140], [160, 140], [220, 200], [140, 110]]) sweep.push(p)
  const samples = []
  for (const [x, y] of sweep) {
    try { rmSync(marker, { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    const r = await call('computer_click', { x, y })
    await delay(450)
    let rec = null
    try {
      const t = readFileSync(marker, 'utf8').trim().split('\n').pop() || ''
      const m = t.match(/(INSIDE|outside)\s+client=(-?\d+),(-?\d+)/)
      if (m) rec = { inside: m[1] === 'INSIDE', cx: Number(m[2]), cy: Number(m[3]) }
    } catch {}
    samples.push({ click: { x, y }, ...rec, note: String(r?.result || '').split('\n')[0].slice(0, 40) })
    console.log(`   click(${x},${y}) → ${rec ? `client(${rec.cx},${rec.cy}) ${rec.inside ? 'INSIDE' : 'outside'}` : '无 down 记录'} | ${samples.at(-1).note}`)
  }

  const pts = samples.filter((s) => s.cx !== undefined)
  if (pts.length >= 2) {
    const fitAxis = (k) => {
      // 最小二乘：client = k*click + b
      const n = pts.length
      const sx = pts.reduce((a, p) => a + p.click[k === 'cx' ? 'x' : 'y'], 0)
      const sy = pts.reduce((a, p) => a + p[k], 0)
      const sxy = pts.reduce((a, p) => a + p.click[k === 'cx' ? 'x' : 'y'] * p[k], 0)
      const sxx = pts.reduce((a, p) => a + p.click[k === 'cx' ? 'x' : 'y'] ** 2, 0)
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
      const inter = (sy - slope * sx) / n
      const err = pts.map((p) => p[k] - (slope * p.click[k === 'cx' ? 'x' : 'y'] + inter))
      const maxErr = Math.max(...err.map(Math.abs))
      return { slope: +slope.toFixed(4), inter: +inter.toFixed(2), maxErr: +maxErr.toFixed(2) }
    }
    const fx = fitAxis('cx')
    const fy = fitAxis('cy')
    console.log(`\n映射（最小二乘）：client.x = ${fx.slope}·click.x + ${fx.inter}（残差≤${fx.maxErr}）`)
    console.log(`               client.y = ${fy.slope}·click.y + ${fy.inter}（残差≤${fy.maxErr}）`)
    console.log(`反解（click = (client - b)/k）：click 空间 = 客户区逻辑 × ${(1 / fx.slope).toFixed(3)} − (${(fx.inter / fx.slope).toFixed(1)}, ${(fy.inter / fy.slope).toFixed(1)})`)

    const want = { x: Math.round((probe.rect.cx - fx.inter) / fx.slope), y: Math.round((probe.rect.cy - fy.inter) / fy.slope) }
    try { rmSync(marker, { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    await call('computer_click', { x: want.x, y: want.y })
    await delay(500)
    let hit = false; let raw = '(无记录)'
    try { raw = readFileSync(marker, 'utf8').trim(); hit = /INSIDE/.test(raw) } catch {}
    console.log('   确认点击的 down 记录:', raw)
    console.log(`确认点击 click(${want.x},${want.y}) → 目标矩形中心(客户区逻辑 ${probe.rect.cx},${probe.rect.cy}) = ${hit ? '✅ INSIDE' : '❌ outside'}`)
  } else {
    console.log('\n采样不足（有 down 记录的点数 = ' + pts.length + '）')
  }
} finally {
  cleanup()
  await delay(500)
  const left = execFileSync('powershell', ['-NoProfile', '-Command',
    `(Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*cu-click-probe*' } | Measure-Object).Count`], { encoding: 'utf8' }).trim()
  console.log('清理复核：残留探针窗口 =', left, '| 标记文件存在 =', existsSync(marker))
}
