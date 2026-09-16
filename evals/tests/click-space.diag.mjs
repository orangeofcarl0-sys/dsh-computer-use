/**
 * 点击坐标空间标定：用可控探针窗口（按钮位置已知、点中会写标记文件）
 * 按各假设各点一次，看哪个假设命中，从而把 computer_click(x,y) 的坐标契约钉死。
 *
 * 假设（按钮中心，屏幕物理像素 S，窗口 origin O，DPI 缩放 d=1.5）：
 *   H1 window-local-physical : (S - O)
 *   H2 screen-physical       : S
 *   H3 window-local-logical  : (S - O) / d
 *   H4 screen-logical        : S / d
 *   H5 window-local-x12      : (S - O) * 1.2      （驱动 zoom 的恒定上采样因子）
 *
 * 运行：node evals/tests/click-space.diag.mjs [DPI]
 * 结束时自动关闭探针窗口并清理标记文件。
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const plugin = (await import(pathToFileURL(join(root, 'index.js')).href)).default
const dpi = Number(process.argv[2] || '1.5')

const marker = join(tmpdir(), `cu-click-probe-hit-${Date.now()}.txt`)
try { rmSync(marker, { force: true }); rmSync(marker + '.form', { force: true }) } catch {}

// ── 插件宿主桩 ────────────────────────────────────────────────────────
const services = {
  attachments: {
    imageLimits: { maxImageBytes: 5e6, maxImagePixels: 4e7, maxImagesPerMessage: 20, maxMessageImageBytes: 1e8, mediaTypes: ['image/png', 'image/jpeg'] },
    async saveImage(i) { return { attachmentId: 'sha256:' + 'e'.repeat(64), mediaType: i.mediaType, bytes: i.data.byteLength, width: 1, height: 1, name: i.name } },
    async validateImage() {}, async readImage(r) { return { ref: r, data: new Uint8Array([1]) } },
  },
  llm: { async resolveModelInfo(p, m) { return { provider: p, id: m, inputModalities: ['text', 'image'] } }, async * stream() { throw new Error('stub') } },
  approval: { async request() { return 'allowed-once' } },
}
const reg = new Map()
plugin.apply({ get: (n) => services[n], logger: { info() {}, error() {} }, tools: { register(d) { reg.set(d.name, d); return () => {} } }, toolsRuntime: null },
  { ttlMs: 60000, maxElements: 300, deliveryMode: 'auto', passwordScan: 'off' })
const exec = { agent: { options: { provider: 'p', model: 'm' }, session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }, signal: new AbortController().signal, get signalSet() { return true } }
const call = (n, a = {}) => reg.get(n).execute(a, exec)

// ── 启动探针窗口 ──────────────────────────────────────────────────────
const ps = join(root, 'evals', 'tools', 'click-probe.ps1')
const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Marker', marker, '-AliveSec', '150'], { stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => { out += d })
let probe = null
for (let i = 0; i < 40 && !probe; i++) {
  await delay(300)
  const line = out.split('\n').find((l) => l.trim().startsWith('{'))
  if (line) { try { probe = JSON.parse(line) } catch {} }
}
if (!probe) { console.log('probe launch failed:', out.slice(0, 300)); try { child.kill() } catch {}; process.exit(1) }
console.log('probe:', JSON.stringify({ title: probe.title, window: probe.window, button: probe.button }))

const cleanup = () => {
  try { child.kill() } catch {}
  try { rmSync(marker, { force: true }); rmSync(marker + '.form', { force: true }) } catch {}
}

try {
  // ── 观察一次以取得快照（动作需要新鲜快照）并核对 bounds ──────────────
  const obs = await call('screen_observe', { window: probe.title, mode: 'ax' })
  console.log('observe ok=', obs.ok, '| window=', JSON.stringify(obs.window), '| origin=', JSON.stringify(obs.screenOrigin))
  const O = { x: probe.window.l, y: probe.window.t }   // 探针自报的客户区原点（物理）
  const S = { x: probe.button.cx, y: probe.button.cy } // 按钮中心（屏幕物理）
  console.log('真值：按钮中心(屏幕物理) =', S.x + ',' + S.y)

  const hyp = [
    ['H1 window-local-physical', { x: Math.round(S.x - O.x), y: Math.round(S.y - O.y) }],
    ['H2 screen-physical', { x: S.x, y: S.y }],
    ['H3 window-local-logical', { x: Math.round((S.x - O.x) / dpi), y: Math.round((S.y - O.y) / dpi) }],
    ['H4 screen-logical', { x: Math.round(S.x / dpi), y: Math.round(S.y / dpi) }],
    ['H5 window-local-x1.2', { x: Math.round((S.x - O.x) * 1.2), y: Math.round((S.y - O.y) * 1.2) }],
  ]

  const hits = []
  for (const [name, pt] of hyp) {
    try { rmSync(marker, { force: true }); rmSync(marker + '.form', { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    let res = ''
    try {
      const c = await call('computer_click', { x: pt.x, y: pt.y })
      res = String(c?.result || '').split('\n')[0].slice(0, 70)
    } catch (e) { res = 'threw: ' + String(e.message).slice(0, 60) }
    await delay(600)
    const hit = existsSync(marker)
    const formDown = existsSync(marker + '.form')
    if (hit) hits.push(name)
    console.log(`${hit ? '✅' : '❌'} ${name.padEnd(26)} click(${pt.x},${pt.y}) → ${hit ? 'hit' : 'miss'}${formDown ? ' (form 收到 down)' : ''} | ${res}`)
  }

  // ── 精确解映射：对多个点击点，读回表单级 WM_LBUTTONDOWN 的客户区坐标 ──
  // 变换假设为线性： client_logical = k * click + b（每轴独立）
  const sweep = [[100, 100], [200, 100], [100, 200], [300, 200], [260, 260]]
  const samples = []
  for (const [cx, cy] of sweep) {
    try { rmSync(marker + '.form', { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    await call('computer_click', { x: cx, y: cy })
    await delay(500)
    let down = null
    try {
      const t = readFileSync(marker + '.form', 'utf8').trim().split('\n').pop() || ''
      const m = t.match(/down\s+(-?\d+),(-?\d+)/)
      if (m) down = { x: Number(m[1]), y: Number(m[2]) }
    } catch {}
    samples.push({ click: { x: cx, y: cy }, down })
    console.log(`   sweep click(${cx},${cy}) → 客户区逻辑(${down ? down.x + ',' + down.y : '无 down 记录'})`)
  }
  const pts = samples.filter((s) => s.down)
  if (pts.length >= 2) {
    const fit = (getX, getY) => {
      const a = pts[0], b = pts[pts.length - 1]
      const dx = (getX(b) - getX(a)) || 1
      const k = (b.down[getY === 'x' ? 'x' : 'y'] - a.down[getY === 'x' ? 'x' : 'y']) / dx
      const off = a.down[getY === 'x' ? 'x' : 'y'] - k * getX(a)
      return { k: +k.toFixed(4), off: +off.toFixed(2) }
    }
    const kx = fit((p) => p.click.x, 'x')
    const ky = fit((p) => p.click.y, 'y')
    console.log(`\n映射拟合：客户区逻辑x = ${kx.k} × click.x + ${kx.off} ；客户区逻辑y = ${ky.k} × click.y + ${ky.off}`)
    console.log(`（即 click 空间 = 客户区逻辑 × ${(1 / kx.k).toFixed(3)}，偏移 ${(-kx.off / kx.k).toFixed(1)},${(-ky.off / ky.k).toFixed(1)}）`)
    // 用解出的映射反算按钮中心，做一次确认性点击
    const targetDown = { x: probe.button.screenL - (probe.window.l) + 130, y: probe.button.screenT - (probe.window.t) + 55 } // 客户区逻辑坐标
    const want = { x: Math.round((targetDown.x - kx.off) / kx.k), y: Math.round((targetDown.y - ky.off) / ky.k) }
    try { rmSync(marker, { force: true }) } catch {}
    await call('screen_observe', { window: probe.title, mode: 'ax' })
    const cc = await call('computer_click', { x: want.x, y: want.y })
    await delay(600)
    const hit = existsSync(marker)
    console.log(`确认点击 click(${want.x},${want.y}) 目标客户区逻辑(${targetDown.x},${targetDown.y}) → ${hit ? '✅ hit' : '❌ miss'} | ${String(cc?.result || '').split('\n')[0].slice(0, 60)}`)
  } else {
    console.log('\n采样不足，无法拟合（down 记录数 = ' + pts.length + '）')
  }

  console.log('\n命中假设:', hits.length ? hits.join(' , ') : '（全部未命中）')
  if (!hits.length) {
    // 兜底：把 form 级 down 记录打出来，判断是否"点到了窗口但不是按钮"
    try { console.log('form-level downs:', readFileSync(marker + '.form', 'utf8').slice(0, 200)) } catch { console.log('form-level downs: (none)') }
  }
} finally {
  cleanup()
  await delay(500)
  // 复核：探针窗口是否已消失、标记文件是否清理
  const left = execFileSync('powershell', ['-NoProfile', '-Command',
    `(Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*cu-click-probe*' } | Measure-Object).Count`], { encoding: 'utf8' }).trim()
  console.log('清理复核：残留探针窗口 =', left, '| 标记文件存在 =', existsSync(marker))
}
