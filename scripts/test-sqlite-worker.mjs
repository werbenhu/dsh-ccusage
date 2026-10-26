import { Worker } from 'node:worker_threads'

const code = `
const { parentPort } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
const { homedir } = require('node:os')
const { join } = require('node:path')
try {
  const db = new DatabaseSync(join(homedir(), '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true })
  const row = db.prepare('select count(*) as n from message').get()
  parentPort.postMessage({ ok: true, n: row.n })
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error && error.message) })
}
`
const worker = new Worker(code, { eval: true, execArgv: ['--experimental-sqlite'] })
worker.on('message', (message) => {
  console.log('message', message)
  worker.terminate()
})
worker.on('error', (error) => console.log('error', error.message))
