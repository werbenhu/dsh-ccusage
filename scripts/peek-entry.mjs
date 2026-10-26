import { collectEntries } from '../src/report.js'
import { loadPricing } from '../src/pricing.js'
const pricing = await loadPricing()
const { entries } = await collectEntries({ sources: ['claude'] }, pricing)
console.log(entries[0])
