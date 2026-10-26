/**
 * OpenCode 适配器。
 *
 * 新版本把消息放进 SQLite：`~/.local/share/opencode/opencode.db`（message 表，
 * data 列是 JSON）。旧版本/未迁移的数据仍在
 * `storage/message/<sessionID>/<messageID>.json`。
 *
 * 只有 assistant 消息带 tokens：`tokens.input/output/reasoning/cache.read/cache.write`，
 * `cost` 是 OpenCode 自己算好的费用（>0 时优先采用）。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { emptyUsage, finalizeEntry, lastPathSegment } from './common.js'
import { readOpenCodeDatabase } from './opencode-db.js'

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

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * 解析 OpenCode 数据根目录（包含 opencode.db 或 storage/message 的那一层）。
 * 配置里可以写 message / storage / 数据根任意一种。
 */
export async function resolveOpenCodeRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  if (typeof process.env.OPENCODE_DATA_DIR === 'string' && process.env.OPENCODE_DATA_DIR !== '') {
    candidates.push(expandHome(process.env.OPENCODE_DATA_DIR))
  }
  candidates.push(join(homedir(), '.local', 'share', 'opencode'))

  const roots = []
  for (const path of candidates) {
    if (!(await isDirectory(path))) continue
    let root = resolve(path)
    if (basename(root) === 'message') root = resolve(root, '..', '..')
    else if (basename(root) === 'storage') root = resolve(root, '..')
    if (
      (await isFile(join(root, 'opencode.db'))) ||
      (await isDirectory(join(root, 'storage', 'message'))) ||
      (await isDirectory(join(root, 'message')))
    ) {
      roots.push(root)
    }
  }
  return [...new Set(roots)]
}

async function collectJsonFiles(dir) {
  const out = []
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const path = join(dir, item.name)
    if (item.isDirectory()) out.push(...(await collectJsonFiles(path)))
    else if (item.isFile() && item.name.endsWith('.json')) out.push(path)
  }
  return out
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function timestampOf(value) {
  const created = value?.time?.created ?? value?.time?.completed
  if (typeof created === 'number' && Number.isFinite(created) && created > 0) {
    return created < 1e12 ? created * 1000 : created
  }
  if (typeof created === 'string') {
    const ms = Date.parse(created)
    return Number.isFinite(ms) ? ms : undefined
  }
  return undefined
}

function projectOf(value) {
  const cwd = value?.path?.cwd ?? value?.path?.root
  if (typeof cwd === 'string' && cwd !== '') {
    const name = lastPathSegment(cwd)
    return name === undefined ? 'opencode' : name
  }
  return 'opencode'
}

function entryFromMessage(value, { sessionId, filePath, directory, messageId, timestamp }) {
  if (value === null || typeof value !== 'object') return undefined
  if (value.role !== undefined && value.role !== 'assistant') return undefined
  const tokens = value.tokens
  if (tokens === null || typeof tokens !== 'object') return undefined
  const created = timestamp ?? timestampOf(value)
  if (created === undefined) return undefined
  const model = value.modelID ?? value.model?.modelID ?? value.model?.id
  if (typeof model !== 'string' || model === '') return undefined

  const usage = emptyUsage()
  usage.inputTokens = num(tokens.input)
  usage.outputTokens = num(tokens.output)
  usage.cacheReadTokens = num(tokens.cache?.read)
  usage.cacheCreationTokens = num(tokens.cache?.write)
  usage.extraTokens = num(tokens.reasoning)
  const total = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens +
    usage.cacheCreationTokens + usage.extraTokens
  if (total === 0) return undefined

  const entry = {
    source: 'opencode',
    agent: 'opencode',
    timestamp: created,
    sessionId: sessionId ?? value.sessionID ?? value.sessionId ?? 'opencode',
    projectPath: value.path?.cwd ?? value.path?.root ?? directory ?? 'OpenCode',
    project: projectOf(value),
    model,
    provider: value.providerID,
    messageId: messageId ?? value.id,
    usage,
    filePath,
  }
  return entry
}

async function scanDatabase(root) {
  const dbPath = join(root, 'opencode.db')
  if (!(await isFile(dbPath))) return undefined
  const rows = await readOpenCodeDatabase(dbPath)
  const entries = []
  for (const row of rows) {
    let value
    try {
      value = JSON.parse(row.data)
    } catch {
      continue
    }
    const entry = entryFromMessage(value, {
      sessionId: row.sessionId,
      filePath: dbPath,
      directory: row.directory,
      messageId: row.id,
      timestamp: typeof row.timeCreated === 'number' ? row.timeCreated : undefined,
    })
    if (entry !== undefined) {
      finalizeEntry(entry)
      entries.push(entry)
    }
  }
  return entries
}

async function scanJsonStorage(root) {
  const dir = (await isDirectory(join(root, 'storage', 'message')))
    ? join(root, 'storage', 'message')
    : join(root, 'message')
  const files = await collectJsonFiles(dir)
  files.sort()
  const entries = []
  for (const file of files) {
    let value
    try {
      value = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      continue
    }
    const entry = entryFromMessage(value, {
      sessionId: value?.sessionID ?? value?.sessionId ?? basename(dirname(file)),
      filePath: file,
      messageId: value?.id ?? basename(file, '.json'),
    })
    if (entry !== undefined) {
      finalizeEntry(entry)
      entries.push(entry)
    }
  }
  return { entries, files: files.length }
}

/**
 * ccusage 的 OpenCode 数据 = SQLite 里的新消息 + storage/message 里的旧消息。
 * 两路可能包含同一条消息（迁移后旧 JSON 还在），按 messageId 去重并以 DB 为准。
 */
export async function scanOpenCode({ roots }) {
  const entries = []
  let files = 0
  for (const root of roots) {
    const seen = new Set()
    const merged = []
    // 数据库存在但读取失败时必须显式失败，不能把不完整的 legacy 结果伪装成完整扫描。
    const database = await scanDatabase(root)
    if (database !== undefined) {
      for (const entry of database) {
        merged.push(entry)
        if (entry.messageId) seen.add(entry.messageId)
      }
      files += 1
    }
    const storage = await scanJsonStorage(root)
    files += storage.files
    for (const entry of storage.entries) {
      if (entry.messageId && seen.has(entry.messageId)) continue
      merged.push(entry)
    }
    entries.push(...merged)
  }
  return { entries, files }
}
