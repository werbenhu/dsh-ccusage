import { collectEntries } from '../src/report.js'

const { entries } = await collectEntries({ sources: ['codex'] })
const models = new Map()
for (const entry of entries) {
  const m = models.get(entry.model) ?? { n: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
  m.n++
  m.input += entry.usage.inputTokens
  m.output += entry.usage.outputTokens
  m.cacheRead += entry.usage.cacheReadTokens
  m.cacheCreation += entry.usage.cacheCreationTokens
  m.total += entry.totalTokens
  models.set(entry.model, m)
}
console.log([...models.entries()].sort((a, b) => b[1].total - a[1].total))
