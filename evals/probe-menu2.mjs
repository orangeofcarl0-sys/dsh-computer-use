/** 点开“模型”子菜单并 dump 条目（再点“推理等级”dump 档位）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
const dumpMenu = (page) => page.evaluate(`(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')];
  if (!menus.length) return 'no-menu';
  const out = [];
  for (const m of menus) {
    for (const b of m.querySelectorAll('[role="menuitem"], [role="menuitemradio"], li, button')) {
      const label = b.querySelector('[class*="cellLabel"]');
      const value = b.querySelector('[class*="cellValue"]');
      const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
      out.push((label ? label.textContent : '') + ' | ' + (value ? value.textContent : '') + ' | ' + t.slice(0, 60));
    }
  }
  return [...new Set(out)].slice(0, 40).join('\\n');
})()`)
const clickLabel = (page, label) => page.evaluate(`(() => {
  const btns = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button')];
  for (const b of btns) {
    const l = b.querySelector('[class*="cellLabel"]');
    if (l && l.textContent.trim() === ${JSON.stringify(label)}) { b.click(); return 'clicked:' + ${JSON.stringify(label)}; }
  }
  return 'not-found:' + ${JSON.stringify(label)};
})()`)

try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  await page.evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型')); if (b) b.click(); })()`)
  await delay(1500)
  console.log('== root menu ==\n' + await dumpMenu(page))
  console.log(await clickLabel(page, '模型'))
  await delay(2000)
  console.log('== model submenu ==\n' + await dumpMenu(page))
} finally { await chrome.close() }
