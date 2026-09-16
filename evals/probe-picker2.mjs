/** 钻进模型子菜单 dump 条目（并列出推理等级子菜单）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  await page.evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型')); if (b) b.click(); })()`)
  await delay(1500)
  const drill = async (label) => {
    const r = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('[role="menuitem"], [role="menu"] div, [role="menu"] li, div, span')];
      for (const el of items) {
        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t === ${JSON.stringify(label)} && el.children.length <= 2) { el.click(); return 'clicked:' + t; }
      }
      return 'not-found:' + ${JSON.stringify(label)};
    })()`)
    await delay(1500)
    const dump = await page.evaluate(`(() => {
      const menus = [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')];
      const out = [];
      for (const m of menus) {
        const items = [...m.querySelectorAll('[role="menuitem"], [role="option"], li, div')].map(e => (e.textContent || '').replace(/\\s+/g, ' ').trim()).filter(t => t && t.length < 90);
        out.push([...new Set(items)].slice(0, 40));
      }
      return JSON.stringify(out);
    })()`)
    return { r, dump: JSON.parse(dump) }
  }
  const m = await drill('模型')
  console.log('drill 模型:', m.r)
  for (const menu of m.dump) console.log('  menu items:', JSON.stringify(menu).slice(0, 1500))
} finally { await chrome.close() }
