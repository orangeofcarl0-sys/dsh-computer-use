/**
 * ops.js —— v0.5.0 新工具的驱动包装：确定性验证 / 谓词轮询 / 剪贴板 / 菜单 / 悬停 / 强杀锁存。
 *
 * 立场：验证是确定性谓词（driver verify_state），unknown 永不视为成功（fail-closed）；
 * computer_stop 是真杀开关（锁存），resume 是唯一解锁路径（PLAN-tools-v0.5 §6-D2=B）。
 */
import { cuaCall, withSession, CUA_SESSION } from './cua.js'
import { clearSnapshot } from './snapshot.js'

export function createOpsState() {
  return { stopped: false }
}

/** 锁存闸门：stopped 时除 computer_resume 外全部拒绝。返回拒绝文本或 null。 */
export function gate(state, toolName) {
  if (state.stopped && toolName !== 'computer_resume') {
    return '已停止（computer_stop 锁存中）：全部桌面操作（观察/动作/应用）已拒绝。用户明示继续后调用 computer_resume 解锁。'
  }
  return null
}

/** 强杀：结束驱动会话（光标/录制/清理）+ 清观察快照 + 落锁。 */
export async function stop(state) {
  await cuaCall('end_session', { session: CUA_SESSION }).catch(() => undefined)
  clearSnapshot()
  state.stopped = true
  return { ok: true, result: '已停止：驱动会话结束、观察快照清空、全部桌面操作锁存（观察/动作/应用一律拒绝）。用户明示继续后调用 computer_resume 解锁。' }
}

/** 解锁：清锁存 + 预热会话（下个动作零延迟）。快照已清，首个动作前必须重新观察。 */
export async function resume(state) {
  state.stopped = false
  await cuaCall('start_session', { session: CUA_SESSION }).catch(() => undefined)
  return { ok: true, result: '已解锁：会话已重建。观察快照为空——先 screen_observe 取得新鲜快照再操作。' }
}

/** 解析 expect（JSON 字符串或数组）→ 谓词数组（1-8 条）。 */
export function parseExpect(expect) {
  let list = expect
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch (err) {
      throw new Error(`expect 不是合法 JSON：${err.message}`)
    }
  }
  if (!Array.isArray(list) || list.length === 0) throw new Error('expect 至少需要 1 条谓词。')
  if (list.length > 8) throw new Error('expect 最多 8 条谓词。')
  return list
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * 确定性验证一次：调 driver verify_state 并规范化。
 * @returns {{ok:boolean, status:string, stable:boolean, waitedMs?:number, results:{index:number,status:string,unknownReason:string|null,expect:string,observed:string|null}[]}}
 */
export async function verifyOnce(ctx, args) {
  const expect = parseExpect(args.expect)
  const payload = withSession({ pid: args.pid, window_id: args.window_id, expect })
  const wantShot = Boolean(args.include_screenshot)
  if (args.include_screenshot != null) payload.include_screenshot = wantShot
  const v = await cuaCall('verify_state', payload)
  const preds = Array.isArray(v?.predicates) ? v.predicates : []
  const results = preds.map(p => ({
    index: p.index,
    status: p.status,
    unknownReason: p.unknown_reason ?? null,
    expect: JSON.stringify(expect[p.index] ?? null),
    observed: typeof p.observed_json === 'string' ? p.observed_json : null,
  }))
  const allSatisfied = preds.length > 0 && preds.every(p => p.status === 'satisfied')
  const out = {
    ok: allSatisfied,
    status: v?.status ?? (allSatisfied ? 'satisfied' : 'unknown'),
    stable: Boolean(v?.stable),
    results,
  }
  if (wantShot && v?.screenshot_png_b64) {
    const attachments = ctx?.get?.('attachments')
    if (attachments) {
      try {
        const ref = await attachments.saveImage({
          data: Buffer.from(v.screenshot_png_b64, 'base64'),
          mediaType: v.screenshot_mime_type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
          name: `verify-${args.pid ?? 'x'}.png`,
        })
        out.image = {
          attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes,
          width: ref.width, height: ref.height, name: ref.name,
        }
      } catch { /* 证据图不可存时不阻塞断言结果 */ }
    }
  }
  const brief = results.map(r => `#${r.index} ${r.status === 'satisfied' ? '满足' : r.status === 'unsatisfied' ? '不满足' : `unknown(${r.unknownReason ?? '?'})`}`).join('；')
  out.result = `验证 ${out.status}${out.stable ? '' : '（未稳定）'}：${brief}。${out.ok ? '' : '注意：unknown 表示无法观测/无法证明，不是失败也不是成功。'}`
  return out
}

/** 谓词轮询：verifyOnce 循环直到全部满足或超时。每次验证是一次完整 UIA 走查（秒级），pollMs 为轮询下限。 */
export async function waitFor(ctx, args, cfg) {
  const timeoutMs = Math.max(1000, Math.min(60000, Number(args.timeoutMs) || 10000))
  const pollMs = Math.max(250, Number(args.pollMs) || 1000)
  const started = Date.now()
  let last = null
  let attempts = 0
  for (;;) {
    attempts++
    last = await verifyOnce(ctx, args)
    if (last.ok) {
      return { ...last, ok: true, attempts, waitedMs: Date.now() - started, result: `${last.result}（第 ${attempts} 次验证满足，等待 ${Date.now() - started}ms）` }
    }
    if (Date.now() - started >= timeoutMs) {
      return { ...last, ok: false, attempts, waitedMs: Date.now() - started, result: `${last.result}（等待超时 ${Date.now() - started}ms，共 ${attempts} 次验证）` }
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** 剪贴板读写。粘贴流：write + computer_key('ctrl+v') 是特殊字符/长文本最可靠的输入路径。 */
export async function clipboard(args) {
  if (args.action === 'write') {
    if (!args.text) throw new Error('write 需要 text 参数。')
    await cuaCall('clipboard_write', withSession({ text: String(args.text) }))
    return { ok: true, result: `已写入剪贴板（${String(args.text).length} 字符）。粘贴路径：computer_key('ctrl+v')。` }
  }
  const v = await cuaCall('clipboard_read', withSession({ include_text: true }))
  const text = v?.text ?? v?.plain_text ?? null
  return {
    ok: true,
    text,
    result: text == null || text === ''
      ? '剪贴板无文本内容。'
      : `剪贴板文本：\n${String(text).slice(0, 2000)}\n（隐私注记：以上为系统剪贴板内容，请按需使用后不要再转述。）`,
  }
}

/** 菜单路径直调（驱动 fail-closed：缺失/歧义/禁用/结构不匹配即失败，绝不回退像素）。 */
export async function menu(args) {
  let path = args.path
  if (typeof path === 'string') {
    try {
      path = JSON.parse(path)
    } catch (err) {
      throw new Error(`path 不是合法 JSON：${err.message}`)
    }
  }
  if (!Array.isArray(path) || path.length === 0) throw new Error('path 至少需要 1 级菜单名。')
  const v = await cuaCall('invoke_menu', withSession({ pid: args.pid, window_id: args.window_id, path }))
  const detail = v && typeof v === 'object' ? `（驱动：${JSON.stringify(v).slice(0, 300)}）` : ''
  return { ok: true, result: `已调用菜单路径：${path.join(' › ')}${detail}` }
}

/**
 * 悬停（实验性）：默认 scope=window 移动 agent 虚拟光标到窗口本地截图像素 (x,y)——
 * 能否触发目标应用的真实 hover（工具提示/悬停菜单）取决于应用，未验证。
 * real=true 时 scope=desktop 移动真实 OS 指针，此时 x/y 为屏幕坐标（需自行从窗口坐标换算）。
 */
export async function hover(args) {
  const x = Number(args.x)
  const y = Number(args.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('hover 需要 x/y。')
  const payload = { x, y }
  if (args.real) {
    payload.scope = 'desktop'
  } else {
    payload.scope = 'window'
    if (args.pid != null && args.window_id != null) {
      payload.target = { kind: 'window', pid: args.pid, window_id: args.window_id }
    }
  }
  const v = await cuaCall('move_cursor', withSession(payload))
  return { ok: true, result: `虚拟光标已移至 (${x},${y})${args.real ? '（真实指针，屏幕坐标）' : '（窗口覆盖层）'}。实验性：hover 效果取决于目标应用。` }
}
