import { collectEntries } from '../src/report.js'
import { loadPricing } from '../src/pricing.js'
const pricing = await loadPricing()
const { entries } = await collectEntries({ sources: ['opencode'] }, pricing)
const e = entries.find(x => x.model.includes('glm-4.7-free'))
console.log(e)
