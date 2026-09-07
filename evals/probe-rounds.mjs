/** 轮次文本上下文定位：新会话前后各 dump 一次 "N 轮" 出现位置。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2000)
  const dump = () => page.evaluate(`(() => {
    const b = (document.body.innerText || '');
    const out = [];
    for (const m of b.matchAll(/[\\s\\S]{0,22}\\d+\\s*轮[\\s\\S]{0,22}/g)) out.push(m[0].replace(/[\\n\\r]+/g, '|'));
    return JSON.stringify(out);
  })()`)
  console.log('BEFORE:', await dump())
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(2500)
  console.log('AFTER-NEW:', await dump())
} finally { await chrome.close() }
