import fs from 'node:fs'
import path from 'node:path'

const root = 'C:/Users/werbe/.claude/projects'
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (p.endsWith('.jsonl')) files.push(p)
  }
}
walk(root)
let sumCC = 0
let sum5 = 0
let sum1 = 0
let sumOther = 0
let n = 0
for (const file of files) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"usage":')) continue
    let data
    try { data = JSON.parse(line) } catch { continue }
    const u = data.message && data.message.usage
    if (!u) continue
    const cc = Number(u.cache_creation_input_tokens) || 0
    const a = Number(u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens) || 0
    const b = Number(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0
    if (cc || a || b) n++
    sumCC += cc
    sum5 += a
    sum1 += b
    if (!(a || b) && cc) sumOther += cc
  }
}
console.log({ files: files.length, n, sumCC, sum5, sum1, sumOther })
