/**
 * UIA 加速器超时复现实验（issue 证据用）。
 * 目标：① 稳定复现率（每目标重复 N 次）；② 排除本机问题（对照经典 Win32 应用 vs WinUI3 应用；
 *        并记录同目标上 screen_observe 的 UIA 树扫描是否正常——若观察正常而加速器超时，问题即定位于加速器扫描路径）。
 *
 * 目标应用：
 *   - WinUI3：notepad（ctrl+s → 未命名文档应弹"另存为"）
 *   - 经典 Win32：regedit（ctrl+f → 应弹"查找"窗口）
 * 判定：出现对应对话框 = 送达；抛 UIA 超时 = 加速器路径失败；无报错但无对话框 = 静默不达。
 * 结束时清理自己起的进程（按 PID，仅限本脚本启动的）。
 * 运行：node evals/tests/uia-hotkey.repro.mjs [每目标次数=5]
 */
import { spawn, execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const { cuaCall } = await import(pathToFileURL(join(root, 'lib/cua.js')).href)
const attempts = Number(process.argv[2] || '5')
await cuaCall('start_session', {}).catch(() => {})

const marker = 'REPRO-' + Date.now().toString().slice(-5)
const tmpFile = join(process.env.TEMP || '/tmp', `${marker}.txt`)
const started = []

const listWindows = async () => ((await cuaCall('list_windows', { on_screen_only: true })).windows || [])
const findWin = async (needle) => (await listWindows()).find((w) => (w.title || '').includes(needle)) || null
const hasTitle = async (re) => (await listWindows()).some((w) => re.test(w.title || ''))

function launch(cmd, args) {
  const ps = args && args.length
    ? `Start-Process -FilePath '${cmd}' -ArgumentList ${args.map((a) => `'${a}'`).join(',')}; 'ok'`
    : `Start-Process -FilePath '${cmd}'; 'ok'`
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
}
function killTree(pid) {
  try { execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' }) } catch {}
}

const report = []
async function runTarget(name, { launchFx, winNeedle, combo, effectRe, observeNeedle }) {
  console.log(`\n=== ${name} ===`)
  launchFx()
  await delay(3000)
  let win = await findWin(winNeedle)
  if (!win) { console.log('窗口未出现，跳过'); return { name, note: 'window-missing' } }
  console.log('窗口:', JSON.stringify({ title: win.title, pid: win.pid, wid: win.window_id }))
  started.push(win.pid)

  // 对照项：同目标的 UIA 树扫描（screen_observe）是否正常
  let obsElements = null
  try {
    const lw = await cuaCall('list_windows', { on_screen_only: true })
    const t = (lw.windows || []).find((w) => (w.title || '').includes(observeNeedle || winNeedle))
    const st = await cuaCall('get_window_state', { pid: t.pid, window_id: t.window_id, include_screenshot: false, max_elements: 200 })
    obsElements = Array.isArray(st.elements) ? st.elements.length : 0
  } catch (e) { obsElements = 'ERR:' + String(e.message).slice(0, 60) }
  console.log('对照：同窗口 UIA 树扫描(元素数) =', obsElements)

  let okCount = 0; let uiaTimeout = 0; let silent = 0; let other = 0
  const samples = []
  for (let i = 0; i < attempts; i++) {
    // 每次点击前先确认没有残留对话框
    if (await hasTitle(effectRe)) {
      const dlg = (await listWindows()).find((w) => effectRe.test(w.title || ''))
      try { await cuaCall('press_key', { key: 'escape', pid: dlg.pid, window_id: dlg.window_id }) } catch {}
      await delay(900)
    }
    win = await findWin(winNeedle)
    if (!win) { samples.push('window-gone'); break }
    let err = null
    try { await cuaCall('hotkey', { keys: combo, pid: win.pid, window_id: win.window_id }) } catch (e) { err = String(e.message) }
    await delay(1600)
    const effect = await hasTitle(effectRe)
    if (effect) { okCount++; samples.push('DELIVERED'); }
    else if (err && /UIA accelerator scan exceeded|UIA provider in the target app is likely unresponsive/i.test(err)) { uiaTimeout++; samples.push('UIA-TIMEOUT'); }
    else if (!err) { silent++; samples.push('SILENT'); }
    else { other++; samples.push('ERR:' + err.slice(0, 50)); }
    console.log(`  #${i + 1} → ${samples.at(-1)}${err ? ' | ' + err.slice(0, 70) : ''}`)
  }
  const rec = { name, attempts, okCount, uiaTimeout, silent, other, obsElements, samples }
  report.push(rec)
  return rec
}

try {
  execFileSync('powershell', ['-NoProfile', '-Command', `Set-Content -LiteralPath '${tmpFile}' -Value 'repro' -Encoding ASCII; 'ok'`], { stdio: 'ignore' })
  await runTarget('WinUI3 / notepad  ctrl+s', {
    launchFx: () => launch('notepad.exe', [tmpFile]),
    winNeedle: marker, combo: ['ctrl', 's'], effectRe: /另存为|Save As/,
  })
  await runTarget('Classic Win32 / regedit  ctrl+f', {
    launchFx: () => launch('regedit.exe'),
    winNeedle: '注册表编辑器', combo: ['ctrl', 'f'], effectRe: /查找|Find/,
  })
  // 再测一次 notepad（去掉临时文件，用未命名文档；验证"文件 vs 未命名"无差异）
  await runTarget('WinUI3 / notepad(untitled)  ctrl+s', {
    launchFx: () => launch('notepad.exe'),
    winNeedle: 'Notepad', combo: ['ctrl', 's'], effectRe: /另存为|Save As/,
  })
} finally {
  console.log('\n=== 汇总 ===')
  for (const r of report) {
    console.log(`${r.name}: 送达 ${r.okCount}/${r.attempts} | UIA超时 ${r.uiaTimeout} | 静默 ${r.silent} | 其他 ${r.other} | 同窗口UIA树元素=${r.obsElements}`)
  }
  // 清理：关闭本次实验启动的进程（按 PID）+ 关掉可能残留的对话框
  for (const pid of [...new Set(started)]) {
    try {
      const dlg = (await listWindows()).find((w) => /另存为|Save As|查找|Find/.test(w.title || '') && w.pid === pid)
      if (dlg) await cuaCall('press_key', { key: 'escape', pid: dlg.pid, window_id: dlg.window_id })
    } catch {}
    killTree(pid)
  }
  await delay(800)
  const left = (await listWindows()).filter((w) => new RegExp(marker + '|注册表编辑器').test(w.title || ''))
  console.log('清理复核：残留实验窗口 =', left.length, left.map((w) => w.title).slice(0, 3))
}
