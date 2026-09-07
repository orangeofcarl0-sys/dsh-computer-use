/**
 * S4 UI 探针：headless Chrome 打开 harness web，验证可驱动面。
 * 用法：node evals/probe-ui.mjs "<tokened URL>"
 */
import { launchChrome } from './lib/cdp.mjs'

const url = process.argv[2]
if (!url) { console.error('usage: node probe-ui.mjs <tokened-url>'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 6000 })
  console.log('href:', await page.evaluate('location.href'))
  console.log('title:', await page.evaluate('document.title'))
  await page.evaluate('document.cookie')
  // wait for app render
  for (let i = 0; i < 10; i++) {
    const ready = await page.evaluate(`(() => {
      const btns = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
      const edit = document.querySelector('[contenteditable="true"]');
      const body = document.body.innerText || '';
      const rounds = (body.match(/(\\d+)\\s*轮/) || [null, null])[1];
      return JSON.stringify({ btns: btns.slice(0, 30), hasComposer: !!edit, rounds, len: body.length });
    })()`)
    const j = JSON.parse(ready)
    if (j.hasComposer || j.btns.length > 0) { console.log('probe:', ready); break }
    await new Promise((r) => setTimeout(r, 1500))
  }
  const dump = await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
    const edit = document.querySelector('[contenteditable="true"]');
    const body = document.body.innerText || '';
    return JSON.stringify({
      btns,
      composerTag: edit ? edit.tagName + '.' + (edit.className || '') : null,
      bodyHead: body.slice(0, 600),
    });
  })()`)
  console.log('dump:', dump)
} finally {
  await chrome.close()
}
