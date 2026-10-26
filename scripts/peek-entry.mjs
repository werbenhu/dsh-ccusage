import { collectEntries } from '../src/report.js'
const { entries } = await collectEntries({ sources: ['claude'] })
console.log(entries[0])
