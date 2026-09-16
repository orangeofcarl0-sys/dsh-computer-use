/** 打开模型选择器并 dump 可选项（找 opencode go / 6649/deepseek-v4.1-flash 与推理档入口）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  const before = await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型'));
    return b ? b.getAttribute('aria-label') : 'no-model-button';
  })()`)
  console.log('model button:', before)
  const clicked = await page.evaluate(`(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型'));
    if (!b) return 'missing';
    b.click(); return 'clicked';
  })()`)
  console.log('click:', clicked)
  await delay(2000)
  const popup = await page.evaluate(`(() => {
    const cands = [...document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [class*="popover" i], [class*="dropdown" i], [class*="menu" i]')];
    const out = [];
    for (const c of cands) {
      const t = (c.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length < 4000) out.push({ cls: (c.className || '').toString().slice(0, 60), role: c.getAttribute('role'), text: t.slice(0, 1500) });
    }
    return JSON.stringify(out.slice(0, 4));
  })()`)
  const arr = JSON.parse(popup)
  if (!arr.length) console.log('no popup found')
  for (const p of arr) console.log('POPUP role=' + p.role + ' cls=' + p.cls + '\\n  ' + p.text.slice(0, 1200))
  // also list generic clickable items mentioning deepseek or opencode
  const items = await page.evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('div, li, button, [role="option"], [cmdk-item]')) {
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length < 120 && /deepseek|opencode|6649|推理|High|Max|Medium/i.test(t) && el.children.length <= 3) out.push(t);
    }
    return JSON.stringify([...new Set(out)].slice(0, 40));
  })()`)
  console.log('items:', items)
} finally { await chrome.close() }
