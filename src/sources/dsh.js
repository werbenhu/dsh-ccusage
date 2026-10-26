/**
 * DeepSeek Harness 自身会话的适配器。
 *
 * DSH 把每个会话写成 `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.v4.jsonl.zstd`，
 * 每行一个事件；其中 `assistant/message` 事件带完整用量：
 *
 *   {"type":"assistant/message","time":1793004009523,
 *    "data":{"turn":1,"step":1,
 *      "message":{"role":"assistant","id":"...","source":{"provider":"ollama",
 *        "model":"deepseek-v4.1-flash:1017-cloud"}},
 *      "usage":{"inputTokens":14141,"outputTokens":376,"totalTokens":15073,
 *               "cacheReadTokens":556}}}
 *
 * 语义与 Anthropic 一致：`inputTokens` 是不含缓存命中的新增输入，
 * `cacheReadTokens` / `cacheWriteTokens` 单列；`totalTokens` 是四项之和。
 * 会话首行的 `session` 事件给出 `id` 与 `cwd`。
 *
 * 同一条 assistant 消息可能在会话文件被重写/恢复后重复出现，因此按
 * `sessionId + message.id` 全局去重。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { decompress } from '../../vendor/fzstd.mjs'
import { cachedByFile } from '../cache.js'
import { emptyUsage, finalizeEntry, lastPathSegment } from './common.js'

function expandHome(value) {
  if (typeof value !== 'string') return value
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 解析 DSH 数据根（返回包含 sessions/ 的那一层）。 */
export async function resolveDshRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  if (candidates.length === 0) {
    const env = process.env.DSH_HOME
    if (typeof env === 'string' && env !== '') candidates.push(expandHome(env))
  }
  if (candidates.length === 0) candidates.push(join(homedir(), '.dsh'))

  const roots = []
  for (const path of candidates) {
    if (!(await isDirectory(path))) continue
    let root = resolve(path)
    if (basename(root) === 'sessions') root = dirname(root)
    if (await isDirectory(join(root, 'sessions'))) roots.push(root)
  }
  return [...new Set(roots)]
}

async function collectSessionFiles(root) {
  const sessions = join(root, 'sessions')
  const out = []
  async function walk(dir) {
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      const path = join(dir, item.name)
      if (item.isDirectory()) {
        await walk(path)
      } else if (item.isFile()) {
        // v4 会话是 session.v4.jsonl.zstd；旧版本是 session.jsonl.zstd / .jsonl。
        if (/^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(item.name)) out.push(path)
      }
    }
  }
  await walk(sessions)
  out.sort()
  return out
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value)
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : undefined
  }
  return undefined
}

function projectFromCwd(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  return lastPathSegment(cwd) || cwd
}

async function readSessionFile(file) {
  let buffer
  let mtime
  try {
    buffer = await readFile(file)
    mtime = (await stat(file)).mtimeMs
  } catch {
    return []
  }
  let content
  try {
    content = file.endsWith('.zstd')
      ? new TextDecoder().decode(decompress(new Uint8Array(buffer)))
      : buffer.toString('utf8')
  } catch {
    return []
  }

  const records = []
  for (const line of content.split('\n')) {
    if (line === '') continue
    try {
      const record = JSON.parse(line)
      if (record !== null && typeof record === 'object') records.push(record)
    } catch {
      // 会话尾部可能正在写入，跳过半行。
    }
  }

  const header = records.find((record) => record.type === 'session')
  const sessionId = typeof header?.id === 'string' && header.id !== ''
    ? header.id
    : basename(dirname(file))
  const projectPath = typeof header?.cwd === 'string' ? header.cwd : undefined
  const project = projectFromCwd(projectPath) ?? basename(dirname(dirname(file)))

  const entries = []
  for (const record of records) {
    if (record.type !== 'assistant/message') continue
    const usageRaw = record.data?.usage
    if (usageRaw === null || typeof usageRaw !== 'object') continue
    const message = record.data?.message
    const model = typeof message?.source?.model === 'string' && message.source.model !== ''
      ? message.source.model
      : 'unknown'
    const timestamp = timestampMs(record.time) ?? timestampMs(record.data?.time) ?? Math.trunc(mtime)

    const usage = emptyUsage()
    usage.inputTokens = num(usageRaw.inputTokens)
    usage.outputTokens = num(usageRaw.outputTokens)
    usage.cacheReadTokens = num(usageRaw.cacheReadTokens)
    usage.cacheCreationTokens = num(usageRaw.cacheWriteTokens)
    let parts = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
    // 少数记录没有 totalTokens；有些 provider 只给 total，差额补进 output。
    const total = num(usageRaw.totalTokens)
    if (parts === 0 && total > 0) {
      usage.outputTokens = total
      parts = total
    } else if (total > parts) {
      usage.outputTokens += total - parts
    }
    if (parts === 0) continue

    entries.push({
      source: 'dsh',
      agent: 'dsh',
      timestamp,
      sessionId,
      projectPath,
      project,
      model,
      provider: message?.source?.provider,
      messageId: typeof message?.id === 'string' ? message.id : undefined,
      usage,
      filePath: file,
    })
  }
  return entries
}

export async function scanDsh({ roots }) {
  const entries = []
  const seen = new Set()
  let files = 0
  for (const root of roots) {
    const sessionFiles = await collectSessionFiles(root)
    for (const file of sessionFiles) {
      const list = await cachedByFile(file, () => readSessionFile(file), 'dsh')
      for (const entry of list) {
        const key = entry.messageId
          ? `${entry.sessionId}\u0000${entry.messageId}`
          : `${entry.sessionId}\u0000${entry.timestamp}\u0000${entry.model}\u0000${entry.usage.inputTokens}\u0000${entry.usage.outputTokens}\u0000${entry.usage.cacheReadTokens}\u0000${entry.usage.cacheCreationTokens}`
        if (seen.has(key)) continue
        seen.add(key)
        finalizeEntry(entry)
        entries.push(entry)
      }
      files += 1
    }
  }
  return { entries, files }
}
