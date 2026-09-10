/** 诊断：点新建会话后视图是否切换、有无弹层。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 9000 })
  await delay(3000)
  const before = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const m = body.match(/(\\d+)\\s*轮\\s*·\\s*\\d+\\s*步/);
    const btns = [...document.querySelectorAll('button[aria-label="新建会话"]')];
    return JSON.stringify({ rounds: m ? m[0] : null, newBtns: btns.length, composer: !!document.querySelector('[contenteditable="true"]') });
  })()`)
  console.log('before:', before)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); b && b.click(); })()`)
  await delay(2500)
  const after = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const m = body.match(/(\\d+)\\s*轮\\s*·\\s*\\d+\\s*步/);
    const dlg = document.querySelector('[role="dialog"], .modal, [class*="overlay" i], [class*="dialog" i]');
    return JSON.stringify({
      rounds: m ? m[0] : null,
      dialog: dlg ? (dlg.textContent || '').slice(0, 200) : null,
      composer: !!document.querySelector('[contenteditable="true"]'),
      bodyHead: body.slice(0, 260).replace(/[\\n\\r]+/g, ' | '),
    });
  })()`)
  console.log('after-click:', after)
  // try clicking again and also the 2nd button
  await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[aria-label="新建会话"]')];
    (btns[1] || btns[0]) && (btns[1] || btns[0]).click();
  })()`)
  await delay(2500)
  const after2 = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const m = body.match(/(\\d+)\\s*轮\\s*·\\s*\\d+\\s*步/);
    return JSON.stringify({ rounds: m ? m[0] : null, composer: !!document.querySelector('[contenteditable="true"]') });
  })()`)
  console.log('after-click-2:', after2)
} finally { await chrome.close() }
