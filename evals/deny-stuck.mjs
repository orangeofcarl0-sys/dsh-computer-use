/**
 * 维护工具：把侧栏里所有"等待审批"的会话逐个打开并点"拒绝"，释放 agent 队列。
 * 用法：node evals/deny-stuck.mjs "<tokened URL>"
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
if (!url) { console.error('usage: node deny-stuck.mjs <tokened-url>'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  for (let round = 0; round < 10; round++) {
    const next = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div, li, a')];
      for (const el of rows) {
        const t = (el.textContent || '').trim();
        if (t.startsWith('等待审批') && t.length < 200 && el.children.length <= 4) { el.click(); return t.slice(0, 40); }
      }
      return null;
    })()`)
    if (!next) { console.log('no more pending-approval sessions'); break }
    console.log('open:', next)
    await delay(3500)
    const r = await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled && (b.textContent || '').trim() === '拒绝');
      if (!btns.length) return 'no-deny-button';
      btns[0].click();
      return 'denied';
    })()`)
    console.log('  ->', r)
    await delay(2500)
  }
} finally { await chrome.close() }
