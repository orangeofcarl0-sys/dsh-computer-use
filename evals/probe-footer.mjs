/** 新建会话后，定位“N 轮 M 步”文本的真实来源（含上下文与所属容器）。 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(3500)
  const dump = await page.evaluate(`(() => {
    const body = document.body.innerText || '';
    const out = [];
    for (const m of body.matchAll(/[\\s\\S]{0,60}\\d+\\s*轮[\\s\\S]{0,60}/g)) out.push(m[0].replace(/[\\n\\r]+/g, '|'));
    const composer = document.querySelector('[contenteditable="true"]');
    let block = '';
    if (composer) {
      let el = composer;
      for (let i = 0; i < 5 && el.parentElement; i++) el = el.parentElement;
      block = (el.innerText || '').replace(/[\\n\\r]+/g, '|').slice(0, 400);
    }
    return JSON.stringify({ matches: out, composerBlock: block, visibleLen: body.length });
  })()`)
  const j = JSON.parse(dump)
  console.log('round/step matches:', JSON.stringify(j.matches, null, 1).slice(0, 900))
  console.log('composer block:', j.composerBlock)
} finally { await chrome.close() }
