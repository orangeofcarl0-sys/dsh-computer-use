/**
 * receipt.js —— 动作回执的统一出口（PLAN-context-budget C，结构治理 P1-6）。
 *
 * 两条立场：
 *  1. 回执随历史每步重发，正常路径只回一行要点（原始 JSON 只在拒绝/未验证/verboseReceipts 时附上）。
 *  2. **"引擎拒绝"只有一个出口**：驱动的拒绝形态有 {effect:'refused'}、{error}、{refusal:{code}}、
 *     {code:'invalid_arguments'} 多种，散落各工具判断必然漏（menu/scroll/drag 都栽过同一坑：
 *     拒绝被上报成功，模型据此继续下一步）。settleAction 把"判拒绝 → 标记快照消费 → 出回执"
 *     收成一处，新工具只要走它就不会再漏。
 */
import { isUnverified, normalizeMcp } from './cua.js'
import { engineRefusal } from './engine.js'
import { markConsumed, markSuspect } from './snapshot.js'

/** 引擎仅"回执未验证"（unverifiable / delivery_failed）时的注记：不得计作成功。 */
export const UNVERIFIED_NOTE = '（引擎只返回了投递回执，未验证目标是否真的响应：请先 screen_observe 确认，必要时对本次动作加 foreground=true 重试。）'

/** 紧凑回执：一行要点（label(+key)完成 · 投递 · 效果）+ 注记；明细仅在必要时附上。 */
export function receipt(label, value, { key = '', note = '', extraNote = '', verbose = false, unverified = false } = {}) {
  const delivery = value && typeof value === 'object' ? value.delivery?.mode : undefined
  const effect = value && typeof value === 'object' ? value.effect : undefined
  const bits = [label + (key ? `(${key})` : '') + '完成']
  if (delivery) bits.push(delivery === 'foreground' ? '前台' : '后台')
  if (effect === 'confirmed') bits.push('已确认')
  else if (effect && effect !== 'unverified') bits.push(String(effect))
  const head = bits.join(' · ')
  const detail = verbose || unverified || !effect
    ? `：${typeof value === 'string' ? value : JSON.stringify(value)}`
    : ''
  return `${head}${detail}${note}${extraNote}`
}

/** 引擎拒绝的统一回执。 */
export function refusalReceipt(label, refusal, note = '') {
  return { ok: false, result: `${label}被引擎拒绝：${refusal}${note}` }
}

/**
 * 动作收尾（所有动作工具共用）：规范化回执 → 判定引擎拒绝 → 成功则标记快照已消费（不可验证另标可疑）。
 * @param {string} tool - 工具名（用于快照消费标记，如 'click' / 'type_text'）
 * @param {any} vRaw - cuaDeliver 返回的原始回执
 * @param {object} o - { label, key?, note?, preNote?, gateNote?, refusalNote?, verbose? }
 *   note：投递注记（成功与拒绝两条路径都附）；preNote/refusalNote：工具专属补充；
 *   gateNote：快照新鲜度注记（成功路径附）。
 * @returns {{ok:boolean, result:string}}
 */
export function settleAction(tool, vRaw, { label, key = '', note = '', preNote = '', gateNote = '', refusalNote = '', verbose = false } = {}) {
  const value = normalizeMcp(vRaw)
  const refusal = engineRefusal(value)
  if (!refusal) {
    markConsumed(tool)
    if (isUnverified(value)) markSuspect(tool)
  }
  if (refusal) return refusalReceipt(label, refusal, note + refusalNote)
  const unverified = isUnverified(value)
  return {
    ok: true,
    result: receipt(label, value, {
      key,
      note,
      extraNote: preNote + (unverified ? UNVERIFIED_NOTE : '') + gateNote,
      unverified,
      verbose,
    }),
  }
}
