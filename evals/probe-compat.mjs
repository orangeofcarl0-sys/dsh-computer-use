/**
 * 插件兼容性快速探针（dsh 0.1.5+）：
 *   新建会话 → 送一条只依赖 computer-use 工具的最小指令 → 轮询 90s
 *   打印：轮次/步数、是否 streaming、transcript 增量（看有无 assistant 文本与工具调用/报错）
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const PROMPT = '请用可用的电脑操作工具观察当前屏幕（不要用命令行），然后用一句话告诉我：你看到的第一个窗口标题是什么。'
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  const st0 = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const f = body.match(/(\\d+)\\s*轮\\s*(?:·)?\\s*(\\d+)\\s*步/);
    return JSON.stringify({ rounds: f ? Number(f[1]) : 0, steps: f ? Number(f[2]) : 0 });
  })()`)
  console.log('before new session:', st0)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(2500)
  const st1 = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const f = body.match(/(\\d+)\\s*轮\\s*(?:·)?\\s*(\\d+)\\s*步/);
    const c = document.querySelector('[contenteditable="true"]');
    return JSON.stringify({ rounds: f ? Number(f[1]) : 0, steps: f ? Number(f[2]) : 0, composer: !!c });
  })()`)
  console.log('fresh session:', st1)
  const typed = await page.evaluate(`(() => {
    const c = document.querySelector('[contenteditable="true"]');
    if (!c) return 'no-composer';
    c.focus();
    document.execCommand('insertText', false, ${JSON.stringify(PROMPT)});
    return 'typed:' + c.textContent.length;
  })()`)
  console.log('typed:', typed)
  await delay(600)
  const sent = await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label="发送消息"]');
    if (!b) return 'no-send-button';
    if (b.disabled) return 'send-disabled';
    b.click(); return 'sent';
  })()`)
  console.log('send:', sent)
  let prev = ''
  for (let i = 0; i < 18; i++) {
    await delay(5000)
    const st = await page.evaluate(`(() => {
      const body = document.body.innerText || '';
      const f = body.match(/(\\d+)\\s*轮\\s*(?:·)?\\s*(\\d+)\\s*步/);
      const stop = [...document.querySelectorAll('button')].some(b => /停止|中断/.test(b.getAttribute('aria-label') || ''));
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
      return JSON.stringify({ rounds: f ? Number(f[1]) : 0, steps: f ? Number(f[2]) : 0, streaming: stop, text: parts.join('\\n') });
    })()`)
    const j = JSON.parse(st)
    const delta = j.text.length - prev.length
    const tail = j.text.slice(-260).replace(/\s+/g, ' ')
    console.log(`poll${String(i).padStart(2)} rounds=${j.rounds} steps=${j.steps} streaming=${j.streaming} len=${j.text.length} (${delta >= 0 ? '+' : ''}${delta})`)
    if (delta !== 0 || i < 3) console.log('    tail:', tail)
    prev = j.text
  }
} finally { await chrome.close() }
