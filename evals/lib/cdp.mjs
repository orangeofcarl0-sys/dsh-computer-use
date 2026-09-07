/**
 * 零依赖 Chrome DevTools Protocol 客户端（Node >= 22 原生 WebSocket）。
 * 用法：
 *   const chrome = await launchChrome()            // headless, 独立 user-data-dir
 *   const page = await chrome.newPage('http://...') // 新 tab + attach + navigate
 *   await page.evaluate('1+1')                     // Runtime.evaluate (returnByValue)
 *   await chrome.close()
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const CHROME_CANDIDATES = [
  process.env.S4_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  throw new Error('chrome.exe not found (set S4_CHROME)')
}

export async function launchChrome({ headless = true } = {}) {
  const exe = findChrome()
  const userDir = mkdtempSync(join(tmpdir(), 's4-chrome-'))
  const args = [
    headless ? '--headless=new' : '',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1440,900',
    'about:blank',
  ].filter(Boolean)
  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chrome devtools not announced in 20s: ' + stderr.slice(-400))), 20000)
    child.stderr.on('data', (d) => {
      stderr += d.toString()
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) { clearTimeout(timer); resolve(m[1]) }
    })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('chrome exited early code=' + code + ' stderr=' + stderr.slice(-400))) })
  })
  return new Chrome({ wsUrl, child, userDir })
}

class Chrome {
  constructor({ wsUrl, child, userDir }) {
    this.wsBrowserUrl = wsUrl
    this.child = child
    this.userDir = userDir
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.waiters = []
  }

  async connect() {
    if (this.ws) return
    const ws = new WebSocket(this.wsBrowserUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('chrome ws error'))
      ws.onclose = () => {
        for (const { reject: rj } of this.pending.values()) rj(new Error('chrome ws closed'))
        this.pending.clear()
      }
    })
    ws.onmessage = (ev) => this.#onMessage(ev.data)
    this.ws = ws
  }

  #onMessage(data) {
    const msg = JSON.parse(data)
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].match(msg)) {
          const w = this.waiters.splice(i, 1)[0]
          w.resolve(msg)
        }
      }
      this.events.push(msg)
      if (this.events.length > 500) this.events.splice(0, 100)
    }
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try { this.ws.send(JSON.stringify(payload)) } catch (e) { this.pending.delete(id); reject(e) }
    })
  }

  async newPage(url, { waitMs = 1500 } = {}) {
    await this.connect()
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(this, sessionId, targetId)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    if (url && url !== 'about:blank') {
      await page.send('Page.navigate', { url })
      await delay(waitMs)
    }
    return page
  }

  async close() {
    try { if (this.ws) { this.ws.close(); this.ws = null } } catch {}
    try { this.child.kill('SIGKILL') } catch {}
    try { rmSync(this.userDir, { recursive: true, force: true, maxRetries: 3 }) } catch {}
  }
}

export class Page {
  constructor(chrome, sessionId, targetId) {
    this.chrome = chrome
    this.sessionId = sessionId
    this.targetId = targetId
  }

  send(method, params = {}) {
    return this.chrome.send(method, params, this.sessionId)
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      const text = d.exception?.description || d.text || 'evaluate error'
      throw new Error('page evaluate failed: ' + String(text).slice(0, 500))
    }
    return r.result?.value
  }
}
