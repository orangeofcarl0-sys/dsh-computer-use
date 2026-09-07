/**
 * S4 发送链路调试探针：新建会话 → 输入 → 发送 → 轮询状态全量 dump。
 * 用法：node evals/probe-send.mjs "<tokened URL>"
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
if (!url) { console.error('usage: node probe-send.mjs <tokened-url>'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  console.log('loaded:', await page.evaluate('location.href'))
  await delay(2000)
  const clicked = await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label="新建会话"]');
    if (!b) return 'no-button';
    b.click(); return 'clicked';
  })()`)
  console.log('newSession:', clicked)
  await delay(2000)
  const st1 = JSON.parse(await page.evaluate(`(() => {
    const roundBtns = [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || '').filter(l => /跳转到第\\s*(\\d+)\\s*轮/.test(l));
    let maxRound = 0;
    for (const l of roundBtns) { const m = l.match(/跳转到第\\s*(\\d+)\\s*轮/); if (m) maxRound = Math.max(maxRound, Number(m[1])); }
    const composer = document.querySelector('[contenteditable="true"]');
    const send = document.querySelector('button[aria-label="发送消息"]');
    return JSON.stringify({ maxRound, hasComposer: !!composer, sendDisabled: send ? send.disabled : null, composerLen: composer ? composer.textContent.length : -1 });
  })()`))
  console.log('state-after-new:', st1)

  const typed = await page.evaluate(`(() => {
    const composer = document.querySelector('[contenteditable="true"]');
    if (!composer) return 'no-composer';
    composer.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, 'S4 调试探针：请回复“收到”两个字，不要做任何其他操作。');
    return 'typed:' + composer.textContent.length;
  })()`)
  console.log('typed:', typed)
  await delay(800)
  const st2 = JSON.parse(await page.evaluate(`(() => {
    const composer = document.querySelector('[contenteditable="true"]');
    const send = document.querySelector('button[aria-label="发送消息"]');
    return JSON.stringify({ composerLen: composer ? composer.textContent.length : -1, composerText: composer ? composer.textContent.slice(0, 80) : null, sendDisabled: send ? send.disabled : null, sendAria: send ? send.getAttribute('aria-label') : null });
  })()`))
  console.log('state-after-type:', st2)

  const sent = await page.evaluate(`(() => {
    const b = document.querySelector('button[aria-label="发送消息"]');
    if (!b) return 'no-send';
    if (b.disabled) return 'send-disabled';
    b.click(); return 'sent';
  })()`)
  console.log('send:', sent)

  for (let i = 0; i < 10; i++) {
    await delay(4000)
    const st = JSON.parse(await page.evaluate(`(() => {
      const roundBtns = [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || '').filter(l => /跳转到第\\s*(\\d+)\\s*轮/.test(l));
      let maxRound = 0;
      for (const l of roundBtns) { const m = l.match(/跳转到第\\s*(\\d+)\\s*轮/); if (m) maxRound = Math.max(maxRound, Number(m[1])); }
      const send = document.querySelector('button[aria-label="发送消息"]');
      const stop = document.querySelector('button[aria-label*="停止"], button[aria-label*="stop" i]');
      const composer = document.querySelector('[contenteditable="true"]');
      return JSON.stringify({ maxRound, sendDisabled: send ? send.disabled : null, hasStop: !!stop, composerLen: composer ? composer.textContent.length : -1 });
    })()`))
    console.log('poll', i, st)
  }
} finally {
  await chrome.close()
}
