import { collectEntries, filterEntries } from '../src/report.js'
import { loadPricing } from '../src/pricing.js'
import { buildBlocks } from '../src/blocks.js'

const pricing = await loadPricing()
for (const source of ['claude', 'codex', 'opencode']) {
  const t0 = Date.now()
  const { entries, files } = await collectEntries({ sources: [source] }, pricing)
  const blocks = buildBlocks(entries, { timeZone: 'Asia/Shanghai' })
  const nonGap = blocks.filter(b => !b.isGap)
  const dates = entries.map(e => new Date(e.timestamp).toISOString().slice(0,10)).sort()
  console.log(source, 'files', files?.length, 'entries', entries.length, 'blocks', blocks.length, 'nonGap', nonGap.length,
    'range', dates[0], dates.at(-1), 'ms', Date.now()-t0)
  console.log('  oldest blocks', nonGap.slice(0,2).map(b=>b.startTime), 'newest', nonGap.slice(-2).map(b=>b.startTime))
}
