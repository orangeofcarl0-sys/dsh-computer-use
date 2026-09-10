/**
 * AC2 oracle 双向独立验证：对每条任务
 *   cleanup → setup → oracle        （空跑必须 FAIL，exit 1）
 *   simulate → oracle → oracle      （成功态必须 PASS ×2，结果一致）
 *   cleanup                          （环境清干净）
 * 退出码 0 = 全部通过。任何 env error(exit 2) 直接记 error。
 */
import { spawn } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)))
const ORACLE_IDS = readdirSync(join(root, 'tasks'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, '').split('-')[0])
  .sort()

const POWERSHELL = process.env.S4_POWERSHELL || 'powershell.exe'

function runPs(script, id, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, id], {
      cwd: root,
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const t = setTimeout(() => {
      try { p.kill('SIGKILL') } catch {}
      resolve({ code: 'TIMEOUT', out, err: (err + '\n[killed by verify timeout]').trim() })
    }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: 'SPAWN_ERR', out, err: String(e) }) })
  })
}

function parseJson(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
  if (lines.length === 0) return null
  try { return JSON.parse(lines[lines.length - 1]) } catch { return null }
}

const results = []
let failed = 0
for (const id of ORACLE_IDS) {
  const s = (k) => join(root, k, `${id}.ps1`)
  const rec = { id, setupOk: false, emptyFail: false, simPass: false, simRepeat: false, cleanupOk: false, envError: null, notes: [] }
  const st = existsSync(s('setup'))
  const steps = [
    ['cleanup', s('cleanup'), 60],
    ...(st ? [['setup', s('setup'), 120]] : []),
    ['oracle-empty', s('oracle'), 120],
    ['simulate', s('simulate'), 120],
    ['oracle-pass', s('oracle'), 120],
    ['oracle-pass-2', s('oracle'), 120],
    ['cleanup', s('cleanup'), 60],
  ]
  let emptyCode = null
  for (const [name, script, to] of steps) {
    if (!existsSync(script)) { rec.notes.push(`${name}: script missing`); continue }
    const r = await runPs(script, id, to * 1000)
    const j = parseJson(r.out)
    if (name === 'oracle-empty') emptyCode = r.code
    if (name === 'setup') rec.setupOk = r.code === 0
    if (name === 'oracle-pass') rec.simPass = r.code === 0
    if (name === 'oracle-pass-2') rec.simRepeat = r.code === 0
    if (name === 'cleanup') rec.cleanupOk = r.code === 0
    if (r.code === 2 || r.code === 'SPAWN_ERR' || r.code === 'TIMEOUT') {
      rec.envError = `${name}: code=${r.code} ${(j?.envError || r.err || '').slice(0, 300)}`
      break
    }
    if (name === 'setup' && r.code !== 0) {
      const jj = j || {}
      rec.notes.push('setup did not reach ok: ' + JSON.stringify(jj.checks || jj.envError || r.code).slice(0, 240))
    }
    if (r.code !== 0 && !['oracle-empty', 'setup', 'cleanup'].includes(name)) {
      rec.notes.push(`${name}: code=${r.code} ${(r.err || '').slice(0, 200)}`)
    }
  }
  rec.emptyFail = emptyCode === 1
  const ok = rec.setupOk && rec.emptyFail && rec.simPass && rec.simRepeat && rec.cleanupOk && !rec.envError
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} setup=${rec.setupOk} emptyFail=${rec.emptyFail} simPass=${rec.simPass} repeat=${rec.simRepeat} cleanup=${rec.cleanupOk}${rec.envError ? ' envError=' + rec.envError : ''}${rec.notes.length ? ' notes=' + rec.notes.join(' ; ') : ''}`)
  results.push(rec)
}

console.log(`\nverify-oracles: ${ORACLE_IDS.length - failed}/${ORACLE_IDS.length} PASS`)
process.exit(failed ? 1 : 0)
