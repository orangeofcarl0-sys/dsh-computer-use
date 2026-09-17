/**
 * observe 降噪专项测试（PLAN-observe-noise AC1-AC5）。
 * 受控引擎（stub 驱动）：可精确控制"界面是否变化"与"是否出现时间类噪声"。
 *
 * AC1 同一未变窗口：第 2 次起回执 ≤ 首次 20%，且含"状态未变"+ 快照 id
 * AC2 变化必全量：元素集合变化 / 标题变化 → 完整树（不许 stub）
 * AC3 force=true 恒全量
 * AC4 动作消费过快照 → 下一次观察全量（不许用陈旧哈希 stub）
 * AC5 observeDedup=off 恒全量；brief 形态为单行（无摘要行）
 * 附加 D2 口径：仅时间类文本变化（"行 1，列 1" / 12:34）不触发全量
 *
 * 运行：node tests/observe.dedup.mjs
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeWorkCopy, writeStubDriver, loadPlugin, makeCtx, makeChecks, cleanupWork } from './lib/harness.mjs'

const work = makeWorkCopy('dedup')

// 受控引擎：元素集合由环境变量驱动，可注入"标题变化"/"元素变化"/"仅时间文本变化"
writeStubDriver(work, `
export const CUA_BIN = 'stub'
export const CUA_SESSION = 'dedup'
export const withSession = (a = {}) => a
export function normalizeMcp(v) { return v }
export function isBackgroundUnavailable(v) { return false }
export function isForegroundUnavailable(v) { return false }
export function isUnverified(v) { return Boolean(v && v.effect === 'unverifiable') }
export async function cuaDeliver(tool, payload) { return { value: await cuaCall(tool, payload), note: '' } }

let n = 0
export async function cuaCall(tool, args = {}) {
  const mutate = process.env.CUA_STUB_MUTATE || 'none'   // none | elements | title | time
  switch (tool) {
    case 'check_permissions': return { elevated: false, integrity_level: 'Medium', uia: true, postmessage: true }
    case 'list_windows': return { windows: [{ pid: 42, window_id: 7, app_name: 'Stub', title: mutate === 'title' ? 'Stub - v' + (++n) : 'Stub', bounds: { x: 100, y: 100, width: 800, height: 600 }, z_index: 5 }] }
    case 'get_window_state': {
      const base = [
        { element_index: 0, role: 'Button', label: 'Save', x: 140, y: 160, width: 60, height: 24 },
        { element_index: 1, role: 'Edit', label: 'text', x: 200, y: 300, width: 200, height: 30, value: 'x' },
        { element_index: 2, role: 'Text', label: mutate === 'time' ? 'Line 1, Col ' + (++n) : 'status', x: 200, y: 360, width: 100, height: 20 },
      ]
      const filler = Array.from({ length: 27 }, (_, k) => ({ element_index: 10 + k, role: 'Button', label: '工具栏按钮 ' + k + ' （设置项）', x: 300 + k * 4, y: 500, width: 40, height: 20 }))
      const els = mutate === 'elements'
        ? base.concat(filler, [{ element_index: 99, role: 'Button', label: 'New', x: 400, y: 400, width: 40, height: 24 }])
        : base.concat(filler)
      return {
        window: { pid: 42, window_id: 7, app_name: 'Stub', title: 'Stub' },
        elements: els, element_count: els.length,
        screenshot_width: 800, screenshot_height: 600,
        snapshot_id: 's' + String(++n).padStart(6, '0'),
      }
    }
    case 'get_desktop_state': return { screenshot_width: 800, screenshot_height: 600 }
    default: return { ok: true }
  }
}
`)

const plugin = await loadPlugin(work)

const { check, state: checkState } = makeChecks()
const raw = (o) => o.result || ''
const isStub = (o) => /状态未变/.test(raw(o))

async function fresh(cfgExtra = {}) {
  const { reg, ctx, exec } = makeCtx()
  plugin.apply(ctx, { ttlMs: 60000, maxElements: 120, deliveryMode: 'auto', passwordScan: 'off', ...cfgExtra })
  await reg.get('computer_do').execute({ action: 'enter' }, exec)   // 展开工具面（AC4 需要 computer_key）
  return (name, args = {}) => reg.get(name).execute(args, exec)
}

// ── AC1 + AC5：形态与降幅 ───────────────────────────────────────────
for (const [form, expectBrief] of [['summary', false], ['brief', true]]) {
  process.env.CUA_STUB_MUTATE = 'none'
  const call = await fresh({ observeDedup: form })
  const o1 = await call('screen_observe', { window: 'Stub' })
  const o2 = await call('screen_observe', { window: 'Stub' })
  const drop = 1 - raw(o2).length / raw(o1).length
  check(`AC1(${form}) 未变第2次为 stub 且降幅≥80%`, isStub(o2) && drop >= 0.8,
    `${raw(o1).length}→${raw(o2).length} (${Math.round(drop * 100)}%)`)
  check(`AC1(${form}) stub 含快照 id 且声明编号有效`, /快照 s\d+/.test(raw(o2)) && /编号仍有效/.test(raw(o2)))
  check(`AC5(${form}) ${expectBrief ? 'brief 无摘要行' : 'summary 含摘要行'}`,
    expectBrief ? !/上次观察摘要/.test(raw(o2)) : /上次观察摘要/.test(raw(o2)))
}

// ── AC5：off 恒全量 ────────────────────────────────────────────────
{
  process.env.CUA_STUB_MUTATE = 'none'
  const call = await fresh({ observeDedup: 'off' })
  const a = await call('screen_observe', { window: 'Stub' })
  const b = await call('screen_observe', { window: 'Stub' })
  check('AC5(off) 永不降噪', !isStub(b) && raw(a).length === raw(b).length, `${raw(a).length}/${raw(b).length}`)
}

// ── AC2：变化必全量（元素集合变化 / 标题变化）────────────────────────
for (const [mode, label] of [['elements', '元素集合变化'], ['title', '标题变化']]) {
  process.env.CUA_STUB_MUTATE = 'none'
  const call = await fresh()
  await call('screen_observe', { window: 'Stub' })
  const o2 = await call('screen_observe', { window: 'Stub' })
  process.env.CUA_STUB_MUTATE = mode
  const o3 = await call('screen_observe', { window: 'Stub' })
  check(`AC2 ${label} → 全量`, isStub(o2) && !isStub(o3), `第3次 len=${raw(o3).length}`)
}

// ── D2：只有时间/行列噪声变化 → 仍判未变（这是降噪的价值所在）────────
{
  process.env.CUA_STUB_MUTATE = 'time'
  const call = await fresh()
  const a = await call('screen_observe', { window: 'Stub' })
  const b = await call('screen_observe', { window: 'Stub' })
  check('D2 仅时间/行列文本变化 → 仍 stub', !isStub(a) && isStub(b), `len ${raw(a).length}→${raw(b).length}`)
}

// ── AC3：force 恒全量 ──────────────────────────────────────────────
{
  process.env.CUA_STUB_MUTATE = 'none'
  const call = await fresh()
  await call('screen_observe', { window: 'Stub' })
  const s = await call('screen_observe', { window: 'Stub' })
  const f = await call('screen_observe', { window: 'Stub', force: true })
  check('AC3 force=true 恒全量', isStub(s) && !isStub(f), `stub=${isStub(s)} forceLen=${raw(f).length}`)
}

// ── AC4：动作消费快照后必全量 ──────────────────────────────────────
{
  process.env.CUA_STUB_MUTATE = 'none'
  const call = await fresh()
  await call('screen_observe', { window: 'Stub' })
  const kr = await call('computer_key', { key: 'return' })
  check('AC4 前置：动作成功', kr.ok === true, String(kr.result || '').slice(0, 60))
  const o3 = await call('screen_observe', { window: 'Stub' })
  const o4 = await call('screen_observe', { window: 'Stub' })
  check('AC4 动作后第一次观察全量、之后恢复降噪', !isStub(o3) && isStub(o4),
    `动作后 len=${raw(o3).length} 再观察 len=${raw(o4).length}`)
}

console.log(`\n结果：${checkState.failures ? '❌ ' + checkState.failures + ' 项失败' : '✅ 全部通过'}`)
if (!checkState.failures) cleanupWork(work)
process.exit(checkState.failures ? 1 : 0)
