/** 用 t01 真实 prompt 复现发送，追踪消息是否入流、轮次是否出现。 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { launchChrome } from './lib/cdp.mjs'

const url = process.argv[2]
const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tasks', 't01-notepad-save.md'), 'utf8')
const prompt = md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/)[1]
  .replaceAll('{task_dir}', join(homedir(), '.dsh', 's4-evals', 't01'))

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2000)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(2500)
  const typed = await page.evaluate(`(() => {
    const c = document.querySelector('[contenteditable="true"]');
    if (!c) return 'no-composer';
    c.focus();
    document.execCommand('insertText', false, ${JSON.stringify(prompt)});
    return 'typed:' + c.textContent.length;
  })()`)
  console.log('typed:', typed, '(prompt chars:', prompt.length + ')')
  await delay(800)
  const pre = await page.evaluate(`(() => {
    const c = document.querySelector('[contenteditable="true"]');
    const b = document.querySelector('button[aria-label="发送消息"]');
    return JSON.stringify({ clen: c ? c.textContent.length : -1, hasBr: c ? !!c.querySelector('br') : null, childTags: c ? [...c.children].map(x => x.tagName).slice(0, 5) : null, sendDisabled: b ? b.disabled : null });
  })()`)
  console.log('pre-send composer:', pre)
  const sent = await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="发送消息"]'); if (!b || b.disabled) return 'no:' + (b ? 'disabled' : 'missing'); b.click(); return 'sent'; })()`)
  console.log('send:', sent)
  for (let i = 0; i < 12; i++) {
    await delay(5000)
    const st = await page.evaluate(`(() => {
      const body = document.body.innerText || '';
      const hasPrompt = body.includes('S4-T01 line one');
      const rounds = (body.match(/(\\d+)\\s*轮(?!\\S)/) || [null])[0] || null;
      const stop = [...document.querySelectorAll('button')].some(b => /停止|中断|stop/i.test(b.getAttribute('aria-label') || ''));
      const c = document.querySelector('[contenteditable="true"]');
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
      const text = parts.join('\\n');
      return JSON.stringify({ hasPrompt, rounds, stop, clen: c ? c.textContent.length : -1, len: text.length });
    })()`)
    console.log('poll', i, st)
  }
} finally { await chrome.close() }
