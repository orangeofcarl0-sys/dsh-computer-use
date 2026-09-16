/**
 * 语法检查（跨平台）：index.js + lib/*.js 逐个 node --check；
 * install.sh / uninstall.sh 有 bash 时跑 bash -n。
 * 运行：node tests/syntax.check.mjs（npm run check）
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
let failed = 0

const jsFiles = ['index.js', ...readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => join('lib', f))]
for (const rel of jsFiles) {
  const abs = join(root, rel)
  if (!existsSync(abs)) { console.log(`❌ missing: ${rel}`); failed++; continue }
  try {
    execFileSync(node, ['--check', abs], { stdio: 'pipe' })
  } catch (e) {
    console.log(`❌ ${rel}: ${String(e.stderr || e.message).split('\n')[0]}`)
    failed++
  }
}
console.log(`${failed ? '❌' : '✅'} 语法检查：${jsFiles.length - failed}/${jsFiles.length} 个 JS 文件通过`)

for (const sh of ['install.sh', 'uninstall.sh']) {
  const abs = join(root, sh)
  if (!existsSync(abs)) continue
  try {
    execFileSync('bash', ['-n', abs], { stdio: 'pipe' })
    console.log(`✅ bash -n ${sh}`)
  } catch (e) {
    const msg = String(e.message || '')
    if (/ENOENT/.test(msg)) { console.log(`⚠️  跳过 ${sh}（本机无 bash）`); continue }
    console.log(`❌ bash -n ${sh}: ${msg.split('\n')[0]}`)
    failed++
  }
}

process.exit(failed ? 1 : 0)
