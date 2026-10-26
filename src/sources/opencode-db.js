/**
 * 读取 OpenCode 新版 SQLite 数据库（`opencode.db`）。
 *
 * OpenCode 1.x 把消息从 `storage/message/*.json` 迁移到了 SQLite。`node:sqlite`
 * 在 Node 22 需要 `--experimental-sqlite`（22.13 之后默认开启），而宿主进程的
 * 启动参数我们改不了，所以把查询放进一个带 execArgv 的 Worker 里执行。
 */

import { Worker } from 'node:worker_threads'

const WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads')
try {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(workerData.dbPath, { readOnly: true })
  const rows = db.prepare(
    'select m.id as id, m.session_id as sessionId, m.time_created as timeCreated, ' +
    'm.data as data, s.directory as directory, s.title as title ' +
    'from message m left join session s on s.id = m.session_id'
  ).all()
  parentPort.postMessage({ ok: true, rows })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) })
}
`

function runWorker(dbPath, execArgv, timeoutMs) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(WORKER_CODE, { eval: true, execArgv, workerData: { dbPath } })
    } catch (error) {
      reject(error)
      return
    }
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('opencode db timeout'))
    }, timeoutMs)
    worker.on('message', (message) => {
      clearTimeout(timer)
      worker.terminate()
      if (message?.ok === true) resolve(message.rows)
      else reject(new Error(message?.error ?? 'opencode db failed'))
    })
    worker.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`opencode db worker exit ${code}`))
    })
  })
}

/** 返回 message 行（data 是 JSON 字符串）；数据库读取失败时抛错。 */
export async function readOpenCodeDatabase(dbPath, { timeoutMs = 60_000 } = {}) {
  try {
    return await runWorker(dbPath, ['--no-warnings', '--experimental-sqlite'], timeoutMs)
  } catch {
    // Node 24+ 已移除/无需该 flag，第二次不带参数重试。
    return runWorker(dbPath, ['--no-warnings'], timeoutMs)
  }
}
