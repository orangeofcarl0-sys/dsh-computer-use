/**
 * 定点止损：只停年龄超过阈值的"进行中"回合（不动当前任务）。
 * 用法：node evals/stop-stale.mjs "<tokened URL>" [minAgeMinutes]
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const minAge = Number(process.argv[3] || '18')
if (!url) { console.error('usage: node stop-stale.mjs <tokened-url> [minAge]'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  for (let round = 0; round < 10; round++) {
    const target = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div, li, a')];
      for (const el of rows) {
        const t = (el.textContent || '').trim();
        if (t.length < 200 && el.children.length <= 4 && t.startsWith('进行中')) {
          const m = t.match(/(\\d+)\\s*分钟/);
          if (m && Number(m[1]) >= ${minAge}) return { label: t.slice(0, 46), age: Number(m[1]) };
        }
      }
      return null;
    })()`)
    if (!target) { console.log('no stale running turns >=', minAge, 'min'); break }
    console.log('stopping:', target.label, '(' + target.age + 'min)')
    await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('div, li, a')];
      for (const el of rows) {
        const t = (el.textContent || '').trim();
        if (t.length < 200 && el.children.length <= 4 && t.startsWith('进行中')) {
          const m = t.match(/(\\d+)\\s*分钟/);
          if (m && Number(m[1]) >= ${minAge}) { el.click(); return 'clicked'; }
        }
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
      return 'no-action';
    })()`)
    console.log('  ->', act)
    await delay(2000)
  }
} finally { await chrome.close() }
