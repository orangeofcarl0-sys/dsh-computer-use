/**
 * 维护工具：清理 runner 残留——"进行中"的回合点停止、"等待审批"的点拒绝。
 * 用法：node evals/maintain.mjs "<tokened URL>"
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
if (!url) { console.error('usage: node maintain.mjs <tokened-url>'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  for (let round = 0; round < 12; round++) {
    const next = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div, li, a')];
      for (const el of rows) {
        const t = (el.textContent || '').trim();
        if (t.length < 200 && el.children.length <= 4 && (t.startsWith('进行中') || t.startsWith('等待审批'))) {
          return { kind: t.slice(0, 3), label: t.slice(0, 46) };
        }
      }
      return null;
    })()`)
    if (!next) { console.log('no stuck sessions left'); break }
    console.log('found:', next.kind, next.label)
    await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div, li, a')];
      for (const el of rows) {
        const t = (el.textContent || '').trim();
        if (t.length < 200 && el.children.length <= 4 && (t.startsWith('进行中') || t.startsWith('等待审批'))) { el.click(); return 'clicked'; }
      }
      return 'gone';
    })()`)
    await delay(3500)
    const act = await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled);
      const deny = btns.find(b => (b.textContent || '').trim() === '拒绝');
      if (deny) { deny.click(); return 'denied'; }
      const stop = btns.find(b => /停止|中断/.test(b.getAttribute('aria-label') || ''));
      if (stop) { stop.click(); return 'stopped'; }
      return 'no-action-available';
    })()`)
    console.log('  ->', act)
    await delay(2500)
  }
} finally { await chrome.close() }
