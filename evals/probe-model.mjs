/** 读取当前 app 的模型/推理档，并新建会话后再读一次（确认新会话继承什么）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 9000 })
  await delay(2500)
  const read = () => page.evaluate(`(() => {
    const labels = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
    const model = labels.find(l => l.includes('选择模型')) || null;
    const access = labels.find(l => l.includes('访问模式')) || null;
    const modeTab = [...document.querySelectorAll('div, span')].map(d => (d.textContent || '').trim()).find(t => /^[A-Za-z\\u4e00-\\u9fa5]{1,12}\\s*模式$/.test(t)) || null;
    return JSON.stringify({ model, access, modeTab });
  })()`)
  console.log('current view:', await read())
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(3000)
  console.log('after new session:', await read())
} finally { await chrome.close() }
