/** 打开最近 S4 会话 dump 尾部（通用：按 prompt 头或会话标题匹配）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const needle = process.argv[3] || '请把下面两行文字'
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  const clicked = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('div, li, a')];
    for (const el of rows) {
      const t = (el.textContent || '').trim();
      if (t.includes(${JSON.stringify(needle)}) && t.length < 200 && el.children.length <= 4) { el.click(); return t.slice(0, 40); }
    }
    return 'not-found';
  })()`)
  console.log('open:', clicked)
  await delay(4500)
  const st = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const stop = [...document.querySelectorAll('button')].some(b => /停止|中断|stop/i.test(b.getAttribute('aria-label') || ''));
    const rounds = (body.match(/(\\d+)\\s*轮(?!\\S)/) || [null])[0] || null;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    const text = parts.join('\\n');
    const i = text.lastIndexOf('约束：整个任务');
    return JSON.stringify({ stop, rounds, tail: i >= 0 ? text.slice(i, i + 1600) : text.slice(-1600) });
  })()`)
  const j = JSON.parse(st)
  console.log('stop:', j.stop, 'rounds:', j.rounds)
  console.log('TAIL:', j.tail.replace(/\n{2,}/g, '\n').slice(0, 1500))
} finally { await chrome.close() }
