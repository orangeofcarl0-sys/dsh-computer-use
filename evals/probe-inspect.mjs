/** 体检：列出侧栏最近会话 + 打开最近一个 S4 会话看流状态。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  const rows = await page.evaluate(`(() => {
    const out = [];
    const sels = document.querySelectorAll('div, li, a');
    for (const el of sels) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('请把下面两行文字') && el.children.length <= 3 && t.length < 300) out.push(t.slice(0, 80));
    }
    return JSON.stringify([...new Set(out)].slice(0, 5));
  })()`)
  console.log('t01 sessions found:', rows)
  // click the first sidebar row that contains the t01 prompt head
  const clicked = await page.evaluate(`(() => {
    const sels = document.querySelectorAll('div, li, a');
    for (const el of sels) {
      const t = (el.textContent || '');
      if (t.startsWith('请把下面两行文字') && el.children.length <= 3 && t.length < 300) { el.click(); return 'clicked:' + t.slice(0, 40); }
    }
    return 'not-found';
  })()`)
  console.log('open:', clicked)
  await delay(4000)
  const state = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const rounds = (body.match(/(\\d+)\\s*轮(?!\\S)/) || [null])[0] || null;
    const stop = [...document.querySelectorAll('button')].some(b => /停止|中断|stop/i.test(b.getAttribute('aria-label') || ''));
    const errHints = ['错误', '失败', '审批', '等待确认', '超时'].filter(k => body.includes(k));
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    const text = parts.join('\\n');
    const i = text.indexOf('请把下面两行文字');
    return JSON.stringify({ rounds, stop, errHints, streamSlice: i >= 0 ? text.slice(i, i + 1500) : text.slice(0, 800) });
  })()`)
  const j = JSON.parse(state)
  console.log('rounds:', j.rounds, 'stop:', j.stop, 'errHints:', j.errHints)
  console.log('STREAM:\n' + j.streamSlice.replace(/\n{2,}/g, '\n').slice(0, 1500))
} finally { await chrome.close() }
