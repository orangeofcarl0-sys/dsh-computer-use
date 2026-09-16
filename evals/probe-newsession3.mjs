/**
 * 新会话入口（trusted 点击版）：用 CDP Input.dispatchMouseEvent 在按钮真实坐标上按下/抬起，
 * 对比页面侧 .click() 是否被忽略；随后读取会话新鲜度与侧栏是否出现新行。
 * 用法：node evals/probe-newsession3.mjs "<tokened URL>"
 */
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
    const re = /(\\d+)\\s*轮\\s*(?:·\\s*)?(\\d+)\\s*步/g; let m; let last = null;
    while ((m = re.exec(body)) !== null) last = m;
    if (last) { rounds = Number(last[1]); steps = Number(last[2]); }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = []; while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    return JSON.stringify({ rounds, steps, len: parts.join('\\n').length, title: document.title.slice(0, 40) });
  })()`)
  const box = await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label="新建会话"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height });
  })()`)
  console.log('before:', await read())
  console.log('button box:', box)
  if (!box) { console.log('找不到新建会话按钮'); process.exit(1) }
  const b = JSON.parse(box)
  // trusted 点击：move → down → up
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', {
      type, x: b.x, y: b.y, button: type === 'mouseMoved' ? 'none' : 'left',
      clickCount: type === 'mouseMoved' ? 0 : 1, buttons: type === 'mousePressed' ? 1 : 0,
    })
    await delay(120)
  }
  await delay(3500)
  console.log('after trusted click:', await read())
  // 侧栏是否出现新行（新会话通常标题为“新会话/新对话”或无标题空行）
  const rows = await page.evaluate(`(() => {
    const seen = new Set(); const out = [];
    for (const el of document.querySelectorAll('div, li, a')) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 60 && /新会话|新对话|未分组|刚刚/.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
    }
    return JSON.stringify(out.slice(0, 8));
  })()`)
  console.log('sidebar hints:', rows)
} finally { await chrome.close() }
