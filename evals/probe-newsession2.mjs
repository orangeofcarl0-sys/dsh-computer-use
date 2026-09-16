/** 试探可靠的“新会话”入口：逐个点候选按钮并读取会话新鲜度。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(3000)
  const read = () => page.evaluate(`(() => {
    const body = document.body.innerText || '';
    let rounds = 0; let steps = 0;
    const re = /(\\d+)\\s*轮\\s*(?:·\\s*)?(\\d+)\\s*步/g;
    let m; let last = null;
    while ((m = re.exec(body)) !== null) last = m;
    if (last) { rounds = Number(last[1]); steps = Number(last[2]); }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    const model = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).find(l => l.includes('选择模型')) || null;
    return JSON.stringify({ rounds, steps, len: parts.join('\\n').length, model });
  })()`)
  console.log('initial:', await read())
  const candidates = [
    'button[aria-label="新建会话"]',
    null, // workspace-scoped buttons resolved by text below
  ]
  // 1) header button
  console.log('click header 新建会话:', await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (!b) return 'missing'; b.click(); return 'clicked'; })()`))
  await delay(3000)
  console.log('  ->', await read())
  // 2) workspace-scoped button (未分组)
  const wsClick = await page.evaluate(`(() => {
    for (const b of document.querySelectorAll('button, [role="menuitem"], div[role="button"]')) {
      const l = b.getAttribute('aria-label') || '';
      if (l.includes('新建会话') && l.includes('未分组')) { b.click(); return 'clicked:' + l; }
    }
    return 'not-found';
  })()`)
  console.log('click workspace-scoped:', wsClick)
  await delay(3000)
  console.log('  ->', await read())
} finally { await chrome.close() }
