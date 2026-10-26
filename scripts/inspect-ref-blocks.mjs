import { readFile } from 'node:fs/promises'
const raw = await readFile(process.env.TEMP + '/ccu-ref/out/blocks.json')
const text = raw[0] === 0xFF && raw[1] === 0xFE ? raw.toString('utf16le') : raw.toString('utf8')
const data = JSON.parse(text.replace(/^\uFEFF/, ''))
console.log(data.blocks.length)
for (const b of data.blocks) console.log(b.id, b.startTime, b.endTime, b.isActive, b.isGap, b.entries, b.totalTokens, b.costUSD)
