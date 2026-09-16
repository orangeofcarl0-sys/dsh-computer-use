/**
 * S4 评测运行器：逐任务 setup → harness 真实会话执行 → oracle → cleanup → 报告。
 * spec: 工作区 PLAN-s4-eval-regression.md（E2=harness 真实会话唯一通道，E3=基线 1 次/任务）。
 *
 * 用法：
 *   node evals/run.mjs --tasks t01,t02
 *   node evals/run.mjs --group authored|waa|all
 *   node evals/run.mjs --tasks t01 --dsh-url "<tokened URL>" --model-label dsv4fv
 *   node evals/run.mjs --tasks t01 --dry-setup   # 只跑 setup/oracle 链，不发会话（调试）
 *
 * 安全姿态（HARDOFF §4-7 教训）：每次发送前必须校验当前会话为 0 轮新会话，
 * 否则跳过发送并记 error —— 绝不向已有历史的会话注入任务。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchChrome } from './lib/cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(ROOT)
const POWERSHELL = process.env.S4_POWERSHELL || 'powershell.exe'

// ---------- args ----------
const args = process.argv.slice(2)
const arg = (name, dflt = undefined) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const hasFlag = (name) => args.includes(`--${name}`)
const tasksArg = arg('tasks', '')
const groupArg = arg('group', 'all')
const tierArg = arg('tier', 'all')
const modelLabel = arg('model-label', 'dsv4fv')
const dshUrlArg = arg('dsh-url', '')
const timeoutMin = Number(arg('timeout-min', '15'))
const maxSteps = Number(arg('max-steps', '0'))   // 0 = disabled; step budget for fast-fail runs
const pinModel = arg('pin-model', '')            // e.g. "DeepSeek V4.1 Flash (OpenCode)"
const pinEffort = arg('pin-effort', '')          // e.g. "High"
const drySetup = hasFlag('dry-setup')
const keepChrome = hasFlag('keep-chrome')

// GUI-only constraint PREPENDED to every task prompt (single enforcement point).
// Rationale: dsv4fv routes file tasks straight to the file-write tool, then burns
// the turn in sandbox-escalation approval loops (S4 first live finding, 2026-09-07).
// Prepend (not append): models weight the top of the prompt; the constraint must
// be read before the task. Sandbox dir is intentionally OUTSIDE the session
// workspace so direct writes get denied -> denial feedback pushes back to GUI.
const COMMON_CONSTRAINT = '【重要约束】本任务必须只通过图形界面完成（在屏幕上点击、拖拽、键盘输入）。禁止使用命令行、终端、文件写入工具或任何绕过屏幕的方式。不要向用户提问；自主完成任务后直接结束回合。'
  // 目标应用上某条操作路径可能被引擎挡住（工具会返回明确提示，如快捷键不可用需改用控件）：
  // 要求 agent 换用界面上等效的控件继续，而不是卡死在同一路径——这本身就是要测的能力。
  + '若某条操作路径不可用（工具会说明原因），请改用界面上等效的控件或通道完成同一操作，不要反复重试同一条失败路径。\n\n'

// ---------- task discovery ----------
function discoverTasks() {
  const ids = []
  for (const f of readdirSync(join(ROOT, 'tasks')).filter((f) => f.endsWith('.md')).sort()) {
    const id = f.replace(/\.md$/, '').split('-')[0]
    if (tasksArg && !tasksArg.split(',').map((s) => s.trim().toLowerCase()).includes(id.toLowerCase())) continue
    const md = readFileSync(join(ROOT, 'tasks', f), 'utf8')
    const group = /^wa/.test(id) ? 'waa' : 'authored'
    if (groupArg !== 'all' && group !== groupArg) continue
    const m = md.match(/<<<PROMPT\n([\s\S]*?)\nPROMPT>>>/)
    if (!m) throw new Error(`task ${id}: no <<<PROMPT block`)
    const waaId = (md.match(/waaId:\s*`([^`]+)`/) || [])[1] || null
    const tier = (md.match(/\*\*tier:\s*(\w+)\*\*/) || [])[1] || 'core'
    if (tierArg !== 'all' && tier !== tierArg) continue
    const taskDir = join(homedir(), '.dsh', 's4-evals', id)
    const prompt = m[1].replaceAll('{task_dir}', taskDir)
    ids.push({ id, group, tier, waaId, prompt, taskDir })
  }
  return ids
}

// ---------- ps helpers ----------
function runPs(kind, id, timeoutMs = 120000) {
  const script = join(ROOT, kind, `${id}.ps1`)
  return new Promise((resolve) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, id], { cwd: ROOT, windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {}; resolve({ code: 'TIMEOUT', out, err }) }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 'SPAWN_ERR', out, err: String(e) }) })
  })
}
function parseJsonTail(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
  if (!lines.length) return null
  try { return JSON.parse(lines[lines.length - 1]) } catch { return null }
}

// ---------- dsh url ----------
async function resolveDshUrl() {
  if (dshUrlArg) return dshUrlArg
  const log = join(homedir(), '.dsh', 'web-latest.log')
  if (existsSync(log)) {
    const txt = readFileSync(log, 'utf8')
    const hits = txt.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+/g)
    if (hits?.length) {
      const url = hits[hits.length - 1]
      try {
        const r = await fetch(url, { redirect: 'manual' })
        if (r.status !== 401) return url
      } catch {}
    }
  }
  // stale/absent: restart harness with capture
  const ps = join(homedir(), '.dsh', 'restart-dsh-capture.ps1')
  const r = await new Promise((resolve) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', (code) => resolve({ code, out }))
    p.on('error', () => resolve({ code: 'SPAWN_ERR', out: '' }))
  })
  const m = r.out.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+/)
  if (!m) throw new Error('cannot obtain dsh url (restart-dsh-capture failed)')
  return m[0]
}

// ---------- page driving ----------
const JS = {
  clickNewSession: `(() => {
    const b = document.querySelector('button[aria-label="新建会话"]');
    if (!b) return 'no-button';
    b.click(); return 'clicked';
  })()`,
  // rounds: stats footer "N 轮" (present even for 1-round sessions; absent when 0).
  // jump buttons ("跳转到第 N 轮") only exist in multi-round sessions; max() covers both.
  // rounds/steps: stats footer "N 轮 M 步" (dsh 0.1.5 dropped the middle dot; older
  // builds render "N 轮 · M 步"). Take the LAST match in body text - sidebar rows of
  // other sessions also contain round counts, and the footer is last in DOM order.
  sessionState: `(() => {
    const body = document.body.innerText || '';
    let rounds = 0; let steps = 0;
    const re = /(\\d+)\\s*轮\\s*(?:·\\s*)?(\\d+)\\s*步/g;
    let m; let last = null;
    while ((m = re.exec(body)) !== null) last = m;
    if (last) { rounds = Number(last[1]); steps = Number(last[2]); }
    else {
      const singles = [...body.matchAll(/(\\d+)\\s*轮(?![^\\n]{0,8}步)/g)];
      if (singles.length) rounds = Number(singles[singles.length - 1][1]);
    }
    const roundBtns = [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || '');
    for (const l of roundBtns) { const mm = l.match(/跳转到第\\s*(\\d+)\\s*轮/); if (mm) rounds = Math.max(rounds, Number(mm[1])); }
    const composer = document.querySelector('[contenteditable="true"]');
    const model = (body.match(/选择模型，当前\\s*([^，,]+)/) || [])[1] || null;
    const stop = [...document.querySelectorAll('button')].some(b => /停止|中断|stop/i.test(b.getAttribute('aria-label') || ''));
    return JSON.stringify({ rounds, steps, hasComposer: !!composer, model, streaming: stop });
  })()`,
  focusComposer: `(() => {
    const c = document.querySelector('[contenteditable="true"]');
    if (!c) return 'no-composer';
    c.focus();
    document.execCommand('selectAll', false, null);
    return 'focused';
  })()`,
  composerLen: `(() => {
    const c = document.querySelector('[contenteditable="true"]');
    return JSON.stringify({ clen: c ? c.textContent.length : -1 });
  })()`,
  typePrompt: (text) => `(() => {
    const composer = document.querySelector('[contenteditable="true"]');
    if (!composer) return 'no-composer';
    composer.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return 'typed:' + composer.textContent.length;
  })()`,
  // approval card: text-only buttons 拒绝 / 允许一次 (no aria-labels)
  pendingApproval: `(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled && (b.textContent || '').trim() === '拒绝');
    return JSON.stringify({ pending: btns.length > 0 });
  })()`,
  denyApproval: `(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled && (b.textContent || '').trim() === '拒绝');
    if (!btns.length) return 'none';
    btns[0].click();
    return 'denied';
  })()`,
  clickSend: `(() => {
    const b = document.querySelector('button[aria-label="发送消息"]');
    if (!b) return 'no-send';
    if (b.disabled) return 'send-disabled';
    b.click(); return 'sent';
  })()`,
  // transcript = message-stream text; bottom panel (文件变动 etc.) is constant noise,
  // cut at its tab bar for a cleaner tail. Best-effort only (scoring uses oracle).
  transcript: `(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walk.nextNode()) { const t = walk.currentNode.textContent; if (t && t.trim()) parts.push(t); }
    const text = parts.join('\\n');
    const cut = text.lastIndexOf('侧边对话(beta)');
    return JSON.stringify({ len: text.length, tail: (cut > 0 ? text.slice(0, cut) : text).slice(-500) });
  })()`,
  // the just-created session is the most recent sidebar row (title is agent-generated)
  sessionRef: `(() => {
    const seen = new Set();
    for (const el of document.querySelectorAll('div, li, a')) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 120 && /(\\d+)\\s*(分钟|小时)/.test(t) && !seen.has(t)) return t.replace(/[\\n\\r]+/g, ' ');
    }
    return null;
  })()`,
}

async function waitComposerReady(page, timeoutMs = 75000) {
  const deadline = Date.now() + timeoutMs
  let reloaded = false
  while (Date.now() < deadline) {
    let st
    try { st = JSON.parse(await page.evaluate(JS.sessionState)) } catch { st = null }
    if (st && st.hasComposer) return st
    // app not hydrated yet: retry navigation once after 20s (post-restart boots can be slow)
    if (!reloaded && Date.now() > deadline - timeoutMs + 20000) {
      reloaded = true
      try { await page.send('Page.reload', {}) } catch {}
    }
    await delay(1200)
  }
  throw new Error('composer never appeared')
}

/**
 * Type into the composer. dsh 0.1.5 broke document.execCommand('insertText') on the
 * composer (verified 2026-09-16: insertText yields textContent.length 0), so the
 * primary path is CDP Input.insertText after focusing; execCommand stays as fallback.
 */
async function typePromptIntoComposer(page, text) {
  const focused = await page.evaluate(JS.focusComposer)
  if (focused !== 'focused') return 'no-composer'
  try {
    await page.send('Input.insertText', { text })
  } catch (e) {
    await page.evaluate(JS.typePrompt(text))
  }
  await delay(500)
  let { clen } = JSON.parse(await page.evaluate(JS.composerLen))
  if (clen < 20) {
    await page.evaluate(JS.typePrompt(text))   // legacy fallback
    await delay(500)
    clen = JSON.parse(await page.evaluate(JS.composerLen)).clen
  }
  return 'typed:' + clen
}

async function newFreshSession(page) {
  const clicked = await page.evaluate(JS.clickNewSession)
  if (clicked !== 'clicked') throw new Error('new session click failed: ' + clicked)
  await delay(1200)
  await waitComposerReady(page)
  // SAFETY GATE: fresh session must have 0 rounds; refuse to send into a session with history
  let lastState = null
  for (let i = 0; i < 5; i++) {
    lastState = JSON.parse(await page.evaluate(JS.sessionState))
    if (lastState.rounds === 0) return lastState
    await page.evaluate(JS.clickNewSession)
    await delay(1800)
  }
  const ctx = await page.evaluate(`(() => {
    const b = (document.body.innerText || '');
    const out = [];
    for (const m of b.matchAll(/[\\s\\S]{0,25}\\d+\\s*轮[\\s\\S]{0,25}/g)) out.push(m[0].replace(/[\\n\\r]+/g, '|'));
    return JSON.stringify(out.slice(0, 6));
  })()`)
  throw new Error(`fresh session check failed: rounds=${lastState?.rounds} ctx=${ctx}`)
}

/**
 * Pin model + reasoning effort for this session via the picker menu
 * (dsh 0.1.5 UI: menu -> "模型" submenu -> entry; menu -> "推理等级" -> entry).
 * Returns the resulting picker label for the record.
 */
async function ensureModel(page, modelText, effortText) {
  if (!modelText && !effortText) return null
  const openMenu = `(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型'));
    if (!b) return 'no-btn';
    b.click(); return 'opened';
  })()`
  const clickLabel = (label) => `(() => {
    const els = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button, div')];
    for (const e of els) {
      const l = e.querySelector('[class*="cellLabel"]');
      if (l && l.textContent.trim() === ${JSON.stringify(label)}) { e.click(); return 'clicked'; }
    }
    return 'not-found';
  })()`
  const clickItem = (text) => `(() => {
    const els = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], li, button, div')];
    for (const e of els) {
      const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t === ${JSON.stringify(text)} && e.children.length <= 8) { e.click(); return 'clicked'; }
    }
    return 'not-found';
  })()`
  const readLabel = `(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label').includes('选择模型'));
    return b ? b.getAttribute('aria-label') : null;
  })()`

  if (modelText) {
    await page.evaluate(openMenu); await delay(1200)
    await page.evaluate(clickLabel('模型')); await delay(1600)
    const r = await page.evaluate(clickItem(modelText))
    if (r !== 'clicked') console.log('   ! model entry not found:', modelText)
    await delay(1500)
  }
  if (effortText) {
    await page.evaluate(openMenu); await delay(1200)
    await page.evaluate(clickLabel('推理等级')); await delay(1600)
    let items = []
    try { items = JSON.parse(await page.evaluate(`(() => {
      const out = [];
      for (const m of document.querySelectorAll('[role="menu"]')) for (const e of m.querySelectorAll('[role="menuitem"], [role="menuitemradio"], li, button')) {
        const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t && t.length < 40) out.push(t);
      }
      return JSON.stringify([...new Set(out)]);
    })()`)) } catch {}
    const target = items.find((t) => t.toLowerCase() === effortText.toLowerCase())
      || items.find((t) => t.toLowerCase().includes(effortText.toLowerCase()))
    if (target) { await page.evaluate(clickItem(target)); await delay(1200) }
    else console.log('   ! effort entry not found among', JSON.stringify(items).slice(0, 160))
    if (!target) await page.evaluate(openMenu) // close if we left it open
  }
  await delay(600)
  return page.evaluate(readLabel)
}

async function runTaskInSession(page, task, timeoutMin) {
  const wallStart = Date.now()
  const st0 = await newFreshSession(page)
  await delay(800)
  const st0b = JSON.parse(await page.evaluate(JS.sessionState))
  if (st0b.rounds !== 0) throw new Error(`fresh session drifted: rounds=${st0b.rounds} (refusing to send)`)
  if (pinModel || pinEffort) {
    const label = await ensureModel(page, pinModel, pinEffort)
    console.log('   pinned model:', label)
    task.pinnedLabel = label
  }
  // Re-verify right before typing: the app can re-navigate to another session while the
  // picker menus are open (observed 2026-09-16: a poll read the user's session stats).
  const preSend = JSON.parse(await page.evaluate(JS.sessionState))
  const preLen = JSON.parse(await page.evaluate(JS.transcript)).len
  if (preSend.rounds !== 0 || preLen > 12000) {
    throw new Error(`session view drifted before send: rounds=${preSend.rounds} len=${preLen} (refusing)`)
  }
  const sendState = await typePromptIntoComposer(page, COMMON_CONSTRAINT + task.prompt)
  if (!String(sendState).startsWith('typed:')) throw new Error('typing into composer failed: ' + sendState)
  await delay(600)
  const typed2 = JSON.parse(await page.evaluate(JS.composerLen))
  if (typed2.clen < 20) throw new Error('composer lost typed text: ' + JSON.stringify(typed2))
  const sent = await page.evaluate(JS.clickSend)
  if (sent !== 'sent') throw new Error('send failed: ' + sent)
  // Phase 0: wait for the turn to actually START (streaming / steps / transcript growth).
  // Without this, a briefly-idle DOM right after send looks like a finished turn and the
  // oracle runs before the agent does anything (observed 2026-09-16 on the dsh 0.1.5 UI).
  let baselineLen = -1
  try { baselineLen = JSON.parse(await page.evaluate(JS.transcript)).len } catch {}
  let started = false
  const startDeadline = Date.now() + 60000
  while (Date.now() < startDeadline) {
    await delay(2500)
    let s = null
    try { s = JSON.parse(await page.evaluate(JS.sessionState)) } catch {}
    let len = baselineLen
    try { len = JSON.parse(await page.evaluate(JS.transcript)).len } catch {}
    if (s && (s.streaming || s.steps >= 1 || len > baselineLen + 300)) { started = true; break }
  }
  // poll turn end: rounds>=1 and message-stream quiet; auto-deny pending approvals
  // (agent tried a non-GUI path -> denial feedback pushes it back to GUI)
  const deadline = Date.now() + timeoutMin * 60000
  let lastLen = -1
  let lastTail = ''
  let quiet = 0
  let denials = 0
  let stepCapHit = false
  let st = st0b
  const ring = []
  while (Date.now() < deadline) {
    await delay(3000)
    st = JSON.parse(await page.evaluate(JS.sessionState))
    const tr = JSON.parse(await page.evaluate(JS.transcript))
    const ap = JSON.parse(await page.evaluate(JS.pendingApproval))
    if (ap.pending) {
      await page.evaluate(JS.denyApproval)
      denials += 1
      if (denials > 4) throw new Error(`approval loop (${denials} denials) - agent keeps leaving GUI path`)
      quiet = 0
      continue
    }
    if (ring.length > 40) ring.shift()
    ring.push(`r=${st.rounds},s=${st.streaming},len=${tr.len},st=${st.steps}`)
    if (maxSteps > 0 && st.steps >= maxSteps) { stepCapHit = true; break }
    if (st.rounds >= 1 && tr.len === lastLen && tr.tail === lastTail) quiet += 1
    else { quiet = 0; lastLen = tr.len; lastTail = tr.tail }
    if (quiet >= 4 && !st.streaming) break
  }
  const wallMs = Date.now() - wallStart
  // deny sweep: release the worker if the turn ended (or timed out) with a pending approval
  for (let i = 0; i < 6; i++) {
    const ap = JSON.parse(await page.evaluate(JS.pendingApproval))
    if (!ap.pending) break
    await page.evaluate(JS.denyApproval)
    await delay(1500)
  }
  if (quiet < 4 || st.streaming) {
    // budget exhausted: STOP the turn server-side, otherwise it keeps burning tokens (leak)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => /停止|中断/.test(x.getAttribute('aria-label') || ''));
        if (b && !b.disabled) { b.click(); return 'stopping'; }
        return 'no-stop';
      })()`)
      await delay(2000)
      const cur = JSON.parse(await page.evaluate(JS.sessionState))
      if (!cur.streaming) break
    }
  }
  const completed = quiet >= 4 && !st.streaming && st.rounds >= 1
  // identity check: our prompt marker must be in the active session transcript
  let inSession = null
  try {
    inSession = await page.evaluate(`(() => (document.body.innerText || '').includes('重要约束'))()`)
  } catch {}
  return { rounds: st.rounds, steps: st.steps, wallMs, model: task.pinnedLabel || st.model, replyTail: lastTail.slice(-400), completed, started, inSession, stepCapHit, ring: ring.join(' '), denials }
}

// ---------- metadata ----------
function readJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}
function pluginVersion() {
  const p = readJsonSafe(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-computer-use', 'package.json'))
  return p?.version || 'unknown'
}
function dshVersion() {
  const p = readJsonSafe(join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return p?.version || 'unknown'
}

// ---------- main ----------
const tasks = discoverTasks()
if (!tasks.length) { console.error('no tasks matched'); process.exit(1) }
console.log(`S4 run: ${tasks.length} tasks, group=${groupArg}, model=${modelLabel}`)

const report = {
  date: new Date().toISOString(),
  model: modelLabel,
  dshVersion: dshVersion(),
  pluginVersion: pluginVersion(),
  tasks: [],
  passRate: null,
}
const passCount = { authored: [0, 0], waa: [0, 0], all: [0, 0] }

let chrome = null
let page = null
try {
  if (!drySetup) {
    const url = await resolveDshUrl()
    console.log('dsh url:', url.replace(/token=\S+/, 'token=***'))
    chrome = await launchChrome()
    page = await chrome.newPage(url, { waitMs: 8000 })
    await waitComposerReady(page)
  }

  for (const task of tasks) {
    console.log(`\n== ${task.id} (${task.group}${task.waaId ? ' · ' + task.waaId.slice(0, 8) : ''})`)
    const rec = { id: task.id, group: task.group, tier: task.tier, waaId: task.waaId, sessionId: null, verdict: 'error', steps: 0, wallMs: 0, oracleDetail: null, notes: [] }
    const t0 = Date.now()
    try {
      const cl = await runPs('cleanup', task.id, 90000)
      const su = await runPs('setup', task.id, 120000)
      if (su.code !== 0) throw new Error('setup failed: ' + (parseJsonTail(su.out)?.envError || su.err || su.code))
      if (drySetup) {
        const orc = await runPs('oracle', task.id, 120000)
        rec.verdict = 'dry-oracle-' + (orc.code === 0 ? 'unexpected-pass' : orc.code === 1 ? 'expected-fail' : String(orc.code))
        rec.oracleDetail = parseJsonTail(orc.out)
      } else {
        const run = await runTaskInSession(page, task, timeoutMin)
        rec.steps = run.steps || run.rounds
        rec.wallMs = run.wallMs
        rec.model = run.model
        rec.replyTail = run.replyTail
        rec.denials = run.denials
        try { rec.sessionId = await page.evaluate(JS.sessionRef) } catch {}
        if (run.inSession === false) {
          rec.verdict = 'error'
          rec.notes.push('prompt marker not found in active session transcript - message may have landed elsewhere')
        } else if (!run.completed) {
          // budget exhausted (wall clock or step cap) without a quiet turn end:
          // timeout, oracle is meaningless mid-flight
          rec.verdict = 'timeout'
          const why = !run.started ? 'turn never started (provider/model?)'
            : run.stepCapHit ? `step cap ${maxSteps} hit`
            : `turn not finished in ${timeoutMin}min`
          rec.notes.push(why + '; ring=' + (run.ring || '').slice(0, 400))
        } else {
          const orc = await runPs('oracle', task.id, 120000)
          rec.verdict = orc.code === 0 ? 'pass' : orc.code === 1 ? 'fail' : 'error'
          rec.oracleDetail = parseJsonTail(orc.out)
        }
      }
      const cl2 = await runPs('cleanup', task.id, 90000)
      if (cl2.code !== 0) rec.notes.push('cleanup code=' + cl2.code)
    } catch (e) {
      rec.verdict = 'error'
      rec.notes.push(String(e.message || e).slice(0, 400))
    }
    rec.wallMs = rec.wallMs || (Date.now() - t0)
    report.tasks.push(rec)
    if (rec.verdict === 'pass') {
      passCount[task.group][0]++
      passCount.all[0]++
    }
    passCount[task.group][1]++
    passCount.all[1]++
    console.log(`   -> ${rec.verdict} steps=${rec.steps} wall=${Math.round(rec.wallMs / 1000)}s`)
    writeFileSync(join(ROOT, 'report-last.json'), JSON.stringify(report, null, 2))
  }
} finally {
  if (chrome && !keepChrome) await chrome.close()
}

report.passRate = {
  authored: `${passCount.authored[0]}/${passCount.authored[1]}`,
  waa: `${passCount.waa[0]}/${passCount.waa[1]}`,
  all: `${passCount.all[0]}/${passCount.all[1]}`,
}
// scored report: error/timeout excluded from denominator per spec §5
const scored = report.tasks.filter((t) => t.verdict === 'pass' || t.verdict === 'fail')
report.scoredPassRate = {
  all: scored.length ? `${scored.filter((t) => t.verdict === 'pass').length}/${scored.length}` : '0/0',
}
writeFileSync(join(ROOT, 'report-last.json'), JSON.stringify(report, null, 2))
console.log(`\nreport -> ${join(ROOT, 'report-last.json')}`)
console.log(`passRate: authored=${report.passRate.authored} waa=${report.passRate.waa} all=${report.passRate.all}`)
