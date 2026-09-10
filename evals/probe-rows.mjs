/** dump 侧栏最近会话行（标题+状态+时间）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  const rows = await page.evaluate(`(() => {
    const seen = new Set(); const out = [];
    for (const el of document.querySelectorAll('div, li, a')) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 120 && /(\\d+)\\s*(分钟|小时)/.test(t) && !seen.has(t)) { seen.add(t); out.push(t.replace(/[\\n\\r]+/g, ' | ')); }
    }
    return JSON.stringify(out.slice(0, 16));
  })()`)
  console.log(rows)
} finally { await chrome.close() }
