/**
 * S4 回合周期观察探针：发送后 90s 内轮询全量信号（轮次文本、停止按钮、transcript 增长）。
 * 用法：node evals/probe-turn.mjs "<tokened URL>"
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
if (!url) { console.error('usage: node probe-turn.mjs <tokened-url>'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2000)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(2000)
  await page.evaluate(`(() => {
    const c = document.querySelector('[contenteditable="true"]');
    if (!c) return 'no-composer';
    c.focus(); document.execCommand('insertText', false, 'S4 回合周期探针：请只回复“收到”，不要调用任何工具。');
  })()`)
  await delay(500)
  const sent = await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="发送消息"]'); if (!b || b.disabled) return 'no'; b.click(); return 'sent'; })()`)
  console.log('send:', sent)

  let prevLen = -1
  for (let i = 0; i < 18; i++) {
    await delay(5000)
    const st = JSON.parse(await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].map(b => ({ a: b.getAttribute('aria-label') || '', d: b.disabled }));
      const stopLike = btns.filter(x => /停止|中断|stop/i.test(x.a));
      const body = document.body.innerText || '';
      const roundMatches = [...body.matchAll(/第\\s*\\d+\\s*轮|\\d+\\s*轮/g)].map(m => m[0]);
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
      const text = parts.join('\\n');
      const composer = document.querySelector('[contenteditable="true"]');
      return JSON.stringify({ stopLike, roundMatches: [...new Set(roundMatches)].slice(0, 8), len: text.length, tail: text.slice(-250), composerLen: composer ? composer.textContent.length : -1 });
    })()`))
    const delta = prevLen < 0 ? '?' : st.len - prevLen
    console.log(`poll${String(i).padStart(2)} len=${st.len} (${delta > 0 ? '+' : ''}${delta}) roundTxt=${JSON.stringify(st.roundMatches)} stop=${JSON.stringify(st.stopLike)} clen=${st.composerLen}`)
    console.log('    tail:', st.tail.replaceAll('\\n', ' | ').slice(-200))
    prevLen = st.len
  }
} finally {
  await chrome.close()
}
