import { readFile } from 'node:fs/promises'
import { collectEntries } from '../src/report.js'
import { loadPricing } from '../src/pricing.js'
import { buildBlocks } from '../src/blocks.js'

const pricing = await loadPricing()
const { entries } = await collectEntries({ sources: ['claude'] }, pricing)
const blocks = buildBlocks(entries, { timeZone: 'Asia/Shanghai' })
const raw = await readFile(process.env.TEMP + '/ccu-ref/out/blocks.json')
const text = raw[0] === 0xFF && raw[1] === 0xFE ? raw.toString('utf16le') : raw.toString('utf8')
const ref = JSON.parse(text.replace(/^\uFEFF/, '')).blocks
console.log('counts', blocks.length, ref.length)
let bad = 0
for (let i = 0; i < Math.max(blocks.length, ref.length); i++) {
  const a = blocks[i], b = ref[i]
  const fields = ['id','entries','totalTokens','costUSD','isActive','isGap']
  const diffs = fields.filter(f => String(a?.[f]) !== String(b?.[f]))
  if (diffs.length) { bad++; console.log('DIFF', i, diffs.map(f => [f, a?.[f], b?.[f]])) }
}
console.log('bad', bad)
