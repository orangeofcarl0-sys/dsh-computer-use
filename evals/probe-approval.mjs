/** 打开卡审批的会话，dump 审批卡片的 DOM（按钮/文案）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 8000 })
  await delay(2500)
  const clicked = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('div, li, a')];
    for (const el of rows) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('等待审批') && t.length < 200 && el.children.length <= 4) { el.click(); return 'clicked'; }
    }
    return 'not-found';
  })()`)
  console.log('open approval session:', clicked)
  await delay(4000)
  const dump = await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].map(b => ({ a: b.getAttribute('aria-label'), t: (b.textContent || '').trim().slice(0, 30), d: b.disabled }));
    const rel = btns.filter(x => /允许|拒绝|批准|deny|approve|allow|reject/i.test((x.a || '') + (x.t || '')));
    const body = document.body.innerText || '';
    const i = body.indexOf('等待审批');
    const j = body.indexOf('审批', i + 2);
    const slice = body.slice(Math.max(0, i - 100), i + 900);
    return JSON.stringify({ relBtns: rel, ctxSlice: slice.replace(/[\\n\\r]+/g, ' | ') });
  })()`)
  const j = JSON.parse(dump)
  console.log('approval buttons:', JSON.stringify(j.relBtns))
  console.log('context:', j.ctxSlice.slice(0, 900))
} finally { await chrome.close() }
