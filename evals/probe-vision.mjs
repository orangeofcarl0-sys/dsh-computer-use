/**
 * 视觉能力快速测试驱动：新会话 → 钉模型 → 送一条"读图转述 + 报坐标"的提示 → 等回合结束 → 打印回复原文。
 * 用法：node evals/probe-vision.mjs "<tokened URL>" "<prompt>" [modelLabel] [effort]
 */
import { launchChrome } from './lib/cdp.mjs'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const prompt = process.argv[3]
const pinModel = process.argv[4] || ''
const pinEffort = process.argv[5] || ''
if (!url || !prompt) { console.error('usage: probe-vision.mjs <url> <prompt> [model] [effort]'); process.exit(1) }

const chrome = await launchChrome()
try {
  const page = await chrome.newPage(url, { waitMs: 10000 })
  await delay(2500)
  const state = () => page.evaluate(`(() => {
    const body = document.body.innerText || '';
    let rounds = 0; let steps = 0;
    const re = /(\\d+)\\s*轮\\s*(?:·\\s*)?(\\d+)\\s*步/g;
    let m; let last = null;
    while ((m = re.exec(body)) !== null) last = m;
    if (last) { rounds = Number(last[1]); steps = Number(last[2]); }
    const stop = [...document.querySelectorAll('button')].some(b => /停止|中断/.test(b.getAttribute('aria-label') || ''));
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    return JSON.stringify({ rounds, steps, streaming: stop, text: parts.join('\\n') });
  })()`)
  await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="新建会话"]'); if (b) b.click(); })()`)
  await delay(3000)
  let st = JSON.parse(await state())
  console.log('fresh session:', 'rounds=' + st.rounds, 'len=' + st.text.length)

  if (pinModel || pinEffort) {
    const openMenu = `(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型')); if (b) b.click(); return b ? 'ok' : 'no'; })()`
    const clickLabel = (label) => `(() => {
      for (const e of document.querySelectorAll('[role="menuitem"], button, div')) {
        const l = e.querySelector('[class*="cellLabel"]');
        if (l && l.textContent.trim() === ${JSON.stringify(label)}) { e.click(); return 'ok'; }
      }
      return 'no';
    })()`
    const clickItem = (text) => `(() => {
      for (const e of document.querySelectorAll('[role="menuitem"], li, button, div')) {
        const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t === ${JSON.stringify(text)} && e.children.length <= 8) { e.click(); return 'ok'; }
      }
      return 'no';
    })()`
    if (pinModel) { await page.evaluate(openMenu); await delay(1200); await page.evaluate(clickLabel('模型')); await delay(1500); console.log('model click:', await page.evaluate(clickItem(pinModel))); await delay(1200) }
    if (pinEffort) { await page.evaluate(openMenu); await delay(1200); await page.evaluate(clickLabel('推理等级')); await delay(1500); console.log('effort click:', await page.evaluate(clickItem(pinEffort))); await delay(1200) }
    const label = await page.evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型')); return b ? b.getAttribute('aria-label') : null; })()`)
    console.log('picker label:', label)
  }

  const pre = JSON.parse(await state())
  if (pre.rounds !== 0 || pre.text.length > 8000) { console.error('session not fresh, aborting:', pre.rounds, pre.text.length); process.exit(2) }
  await page.evaluate(`(() => { const c = document.querySelector('[contenteditable="true"]'); if (c) { c.focus(); document.execCommand('selectAll', false, null); } })()`)
  await page.send('Input.insertText', { text: prompt })
  await delay(800)
  const clen = await page.evaluate(`(() => { const c = document.querySelector('[contenteditable="true"]'); return c ? c.textContent.length : -1; })()`)
  console.log('composer length:', clen)
  // freshness re-check immediately before send (the view can drift while typing)
  const pre2 = JSON.parse(await state())
  if (pre2.rounds !== 0 || pre2.text.length > 8000) { console.error('session drifted before send, aborting:', pre2.rounds, pre2.text.length); process.exit(3) }
  const sent = await page.evaluate(`(() => { const b = document.querySelector('button[aria-label="发送消息"]'); if (!b || b.disabled) return 'no'; b.click(); return 'sent'; })()`)
  console.log('send:', sent)

  let prev = ''
  for (let i = 0; i < 60; i++) {
    await delay(5000)
    st = JSON.parse(await state())
    if (st.rounds >= 1 && !st.streaming && st.text === prev) {
      console.log('turn end at poll', i, 'steps=' + st.steps)
      break
    }
    prev = st.text
    if (i % 3 === 0) console.log(`poll${i} rounds=${st.rounds} steps=${st.steps} streaming=${st.streaming} len=${st.text.length}`)
  }
  const body = st.text
  // 截取模型回复：取最后一次"发消息或创建任务"（composer 提示）之前的段落
  const cut = body.lastIndexOf('发消息或创建任务')
  const replyPart = cut > 0 ? body.slice(0, cut) : body
  const idx = replyPart.lastIndexOf('指令')
  console.log('\n===== SESSION TEXT (tail) =====\n' + replyPart.slice(Math.max(0, (idx > 0 ? idx : replyPart.length - 2000)), (idx > 0 ? idx : replyPart.length) + 4000))
} finally { await chrome.close() }
