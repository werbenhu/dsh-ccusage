import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const ref = JSON.parse(read(process.env.TEMP + '/ccu-ref/out/daily-by-agent.json'))
const models = new Map()
for (const row of ref.daily) {
  for (const agent of row.agents ?? []) {
    if (agent.agent !== 'codex') continue
    for (const b of agent.modelBreakdowns ?? []) {
      const m = models.get(b.modelName) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 }
      m.input += b.inputTokens; m.output += b.outputTokens
      m.cacheRead += b.cacheReadTokens; m.cacheCreation += b.cacheCreationTokens
      m.cost += b.cost
      models.set(b.modelName, m)
    }
  }
}
console.log([...models.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => [k, v]))
