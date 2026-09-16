/** 打开模型菜单后 dump 其 DOM 结构（tag/role/class/text），便于定位“模型”子项。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  await page.evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型')); if (b) b.click(); })()`)
  await delay(2000)
  const dom = await page.evaluate(`(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')];
    if (!menus.length) return 'no-menu';
    const m = menus[menus.length - 1];
    const out = [];
    const walk = (el, depth) => {
      if (depth > 4) return;
      for (const c of el.children) {
        const t = (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
        out.push('  '.repeat(depth) + '<' + c.tagName.toLowerCase() + ' role=' + (c.getAttribute('role') || '-') + ' class=' + (c.className || '').toString().split(' ')[0] + '> ' + t);
        walk(c, depth + 1);
      }
    };
    walk(m, 0);
    return out.slice(0, 60).join('\\n');
  })()`)
  console.log('MENU DOM:\n' + dom)
} finally { await chrome.close() }
