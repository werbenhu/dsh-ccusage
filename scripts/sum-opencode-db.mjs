import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const db = new DatabaseSync(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true })
const rows = db.prepare("select data from message where json_extract(data,'$.role')='assistant'").all()
let input = 0, output = 0, reasoning = 0, read = 0, write = 0, cost = 0, total = 0, n = 0, zero = 0
const models = new Map()
for (const row of rows) {
  const d = JSON.parse(row.data)
  const t = d.tokens ?? {}
  const i = Number(t.input) || 0
  const o = Number(t.output) || 0
  const r = Number(t.reasoning) || 0
  const cr = Number(t.cache?.read) || 0
  const cw = Number(t.cache?.write) || 0
  if (i + o + r + cr + cw === 0) { zero++; continue }
  n++
  input += i; output += o; reasoning += r; read += cr; write += cw
  cost += Number(d.cost) || 0
  total += Number(t.total) || 0
  const key = d.modelID
  const m = models.get(key) ?? { n: 0, input: 0, output: 0, reasoning: 0, read: 0, write: 0, cost: 0 }
  m.n++; m.input += i; m.output += o; m.reasoning += r; m.read += cr; m.write += cw; m.cost += Number(d.cost) || 0
  models.set(key, m)
}
console.log({ n, zero, input, output, reasoning, read, write, cost, total })
console.log([...models.entries()].sort((a, b) => b[1].cost - a[1].cost))
