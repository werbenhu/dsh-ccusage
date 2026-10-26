import { collectEntries } from '../src/report.js'
const { entries } = await collectEntries({ sources: ['opencode'] })
const e = entries.find(x => x.model.includes('glm-4.7-free'))
console.log(e)
