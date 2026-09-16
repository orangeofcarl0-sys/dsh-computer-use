/**
 * 键盘通道对照：在受控记事本上比较 driver 的 hotkey（UIA 加速器路径）与
 * press_key+modifiers（SendInput 路径）谁能把 ctrl+s 送到 Win11 记事本。
 * 判定：未命名文档按 ctrl+s 应弹出"另存为"对话框（新顶层窗口）。
 * 结束时用"能工作的那条通道"关闭自己起的记事本，不留测试窗口。
 * 运行：node evals/tests/key-channel.diag.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const { cuaCall } = await import(pathToFileURL(join(root, 'lib/cua.js')).href)
await cuaCall('start_session', {}).catch(() => {})

const marker = 'KEYCH-' + Date.now().toString().slice(-5)
// 自己起一个受控记事本（带唯一标题标记的临时文件）
const tmpFile = join(process.env.TEMP || '/tmp', `${marker}.txt`)
execFileSync('powershell', ['-NoProfile', '-Command', `Set-Content -LiteralPath '${tmpFile}' -Value 'probe' -Encoding ASCII; Start-Process notepad.exe -ArgumentList '${tmpFile}'; 'ok'`], { stdio: 'ignore' })
await delay(2500)

const findWin = async (needle) => {
  const lw = await cuaCall('list_windows', { on_screen_only: true })
  return (lw.windows || []).find((w) => (w.title || '').includes(needle)) || null
}
const hasDialog = async () => {
  const lw = await cuaCall('list_windows', { on_screen_only: true })
  return (lw.windows || []).some((w) => /另存为|Save As/.test(w.title || ''))
}
const closeDialog = async () => {
  // 取消另存为对话框（esc 走 press_key 无修饰键路径）
  const lw = await cuaCall('list_windows', { on_screen_only: true })
  const dlg = (lw.windows || []).find((w) => /另存为|Save As/.test(w.title || ''))
  if (!dlg) return 'no-dialog'
  try { await cuaCall('press_key', { key: 'escape', pid: dlg.pid, window_id: dlg.window_id }) } catch (e) { return 'esc-failed:' + String(e.message).slice(0, 40) }
  await delay(700)
  return 'esc-sent'
}

try {
  let win = await findWin(marker)
  if (!win) { console.log('受控记事本未出现，放弃'); process.exit(1) }
  console.log('受控窗口:', JSON.stringify({ title: win.title, pid: win.pid, wid: win.window_id, bounds: win.bounds }))

  // 通道 A：hotkey（UIA 加速器路径）
  let aErr = null
  try {
    const r = await cuaCall('hotkey', { keys: ['ctrl', 's'], pid: win.pid, window_id: win.window_id })
    console.log('A hotkey 返回:', JSON.stringify(r).slice(0, 140))
  } catch (e) { aErr = String(e.message) }
  await delay(1500)
  const aDialog = await hasDialog()
  if (aDialog) await closeDialog()
  console.log(`A hotkey → ${aErr ? '❌ 报错: ' + aErr.slice(0, 90) : '✅ 无报错'} | 另存为对话框: ${aDialog ? '出现（按键送达）' : '未出现'}`)

  // 通道 B：press_key + modifiers（SendInput 路径）
  await delay(600)
  let bErr = null
  try {
    const r = await cuaCall('press_key', { key: 's', modifiers: ['ctrl'], pid: win.pid, window_id: win.window_id })
    console.log('B press_key 返回:', JSON.stringify(r).slice(0, 140))
  } catch (e) { bErr = String(e.message) }
  await delay(1500)
  const bDialog = await hasDialog()
  if (bDialog) await closeDialog()
  console.log(`B press_key(modifiers) → ${bErr ? '❌ 报错: ' + bErr.slice(0, 90) : '✅ 无报错'} | 另存为对话框: ${bDialog ? '出现（按键送达）' : '未出现'}`)

  // 结论 + 用能工作的通道关闭我起的窗口
  console.log(`\n结论：hotkey ${aErr ? '失败' : '可用'} / press_key+modifiers ${bErr ? '失败' : '可用'}；另存为可达性 A=${aDialog} B=${bDialog}`)
  try {
    await cuaCall('hotkey', { keys: ['alt', 'f4'], pid: win.pid, window_id: win.window_id })
  } catch {
    try { await cuaCall('press_key', { key: 'f4', modifiers: ['alt'], pid: win.pid, window_id: win.window_id }) } catch {}
  }
  await delay(1200)
  // 若弹出"是否保存"对话框，选"不保存"
  const lw2 = await cuaCall('list_windows', { on_screen_only: true })
  const saveAsk = (lw2.windows || []).find((w) => /记事本|Notepad/.test(w.title || '') && /保存|Save/.test(w.title || ''))
  if (saveAsk) { try { await cuaCall('press_key', { key: 'n', pid: saveAsk.pid, window_id: saveAsk.window_id }) } catch {} }
  await delay(800)
  const still = await findWin(marker)
  console.log('清理：我的受控窗口仍在？', still ? '是（需手动）' : '否（已关闭）')
} finally {
  const left = await findWin(marker).catch(() => null)
  console.log('最终状态：受控窗口', left ? '残留 pid=' + left.pid : '已清理')
}
