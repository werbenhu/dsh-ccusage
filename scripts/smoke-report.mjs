import { runReport } from '../src/report.js'

const started = Date.now()
const report = await runReport({ timezone: 'Asia/Shanghai', sources: ['claude', 'codex', 'opencode'] })
console.log(JSON.stringify({
  ms: Date.now() - started,
  entries: report.metadata.entries,
  totals: report.totals,
  daily: report.daily.length,
  weekly: report.weekly.length,
  monthly: report.monthly.length,
  sessions: report.session.length,
  blocks: report.blocks.length,
  warnings: report.metadata.warnings,
}, null, 2))
