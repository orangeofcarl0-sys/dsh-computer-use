/**
 * S4 轨迹离线分析：从 ~/.dsh/sessions 的 zstd 会话文件提取每条任务的执行画像。
 * 只读。用法：node evals/analyze-sessions.mjs [markerRegex...]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as zlib from 'node:zlib'

const sessionsRoot = join(homedir(), '.dsh', 'sessions')
const wsArg = process.env.S4_WS || ''
const base = wsArg
  ? (wsArg.includes('\\') || wsArg.includes('/') ? wsArg : join(sessionsRoot, wsArg))
  : join(sessionsRoot, '--F-Codex_Work_Space-DSH~0020plugin-dsh-winui--')
const markers = process.argv.slice(2)

function decompressFile(f) {
  const raw = readFileSync(f)
  try {
    const out = zlib.zstdDecompressSync(raw)
    if (out.length > 1000) return out
  } catch {}
  // fallback: zstd CLI (handles multi-frame files)
  const tmp = f + '.dec.tmp'
  try {
    execFileSync('zstd', ['-d', '-f', '-o', tmp, f], { stdio: 'ignore' })
    const out = readFileSync(tmp)
    try { execFileSync('cmd', ['/c', 'del', '/q', tmp], { stdio: 'ignore' }) } catch {}
    return out
  } catch {
    try { execFileSync('cmd', ['/c', 'del', '/q', tmp], { stdio: 'ignore' }) } catch {}
    return null
  }
}

const dirs = readdirSync(base)
  .map((s) => join(base, s))
  .filter((d) => statSync(d).isDirectory())

const files = []
for (const d of dirs) {
  const v3 = join(d, 'session.v3.jsonl.zstd')
  const v1 = join(d, 'session.jsonl.zstd')
  const f = existsSync(v3) ? v3 : (existsSync(v1) ? v1 : null)
  if (!f) continue
  files.push({ f, mt: statSync(f).mtimeMs })
}
files.sort((a, b) => a.mt - b.mt)

for (const { f, mt } of files) {
  const buf = decompressFile(f)
  if (!buf) { console.log('skip (undecompressable):', f.match(/session-[0-9a-f-]{18}/)?.[0]); continue }
  const s = buf.toString('utf8')
  if (markers.length && !markers.some((m) => s.includes(m))) continue
  const lines = s.split('\n').filter((l) => l.trim().startsWith('{'))
  let title = ''
  const toolCounts = new Map()
  let lastAssistant = ''
  let errors = 0
  let guardRejects = 0
  let approveAsks = 0
  let observes = 0
  for (const l of lines) {
    let j
    try { j = JSON.parse(l) } catch { continue }
    const txt = JSON.stringify(j)
    const tm = txt.match(/"(?:toolName|tool_name|name)":"(computer_[a-z_]+|screen_[a-z_]+|app_[a-z_]+)"/)
    if (tm) toolCounts.set(tm[1], (toolCounts.get(tm[1]) || 0) + 1)
    if (/screen_observe/.test(txt) && /"ax"|"native"/.test(txt)) observes++
    if (/快照|snapshot_expired|无快照/.test(txt) && /拒绝/.test(txt)) guardRejects++
    if (/等待审批|"approval"/.test(txt)) approveAsks++
    if (/\[object Object\]|Error:|失败/.test(txt) && txt.length < 3000) errors++
    if (j.type === 'assistant' || j.role === 'assistant') {
      const c = (j.content || j.text || '')
      if (typeof c === 'string' && c.trim()) lastAssistant = c
      else if (Array.isArray(c)) lastAssistant = c.map((b) => b.text || '').join('')
    }
    if (!title && /"title"/.test(txt)) { try { title = JSON.parse(l).title || '' } catch {} }
  }
  console.log('────────────────────────────────────────')
  console.log('session:', f.match(/session-[0-9a-f-]{18}/)?.[0], '| mtime:', new Date(mt).toISOString().slice(5, 16), '| size:', Math.round(buf.length / 1000) + 'KB')
  if (markers.length) console.log('markers hit')
  console.log('tools:', [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ') || '(none)')
  console.log('observe-ish:', observes, '| error-ish lines:', errors, '| guard-rejects:', guardRejects, '| approval-mentions:', approveAsks)
  if (lastAssistant) console.log('last assistant:', lastAssistant.replace(/\s+/g, ' ').slice(0, 400))
}
