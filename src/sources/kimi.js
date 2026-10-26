/**
 * Kimi CLI / Kimi Code 适配器。
 *
 * 数据目录（默认 `~/.kimi`、`~/.kimi-code`，可用 `KIMI_DATA_DIR` 覆盖）下拉：
 *   sessions/<group>/<session>/wire.jsonl                    旧版
 *   sessions/<workspace>/<session>/agents/<agent>/wire.jsonl 新版 Kimi Code
 *
 * wire.jsonl 是混合事件流，只有两种行带用量：
 *   - 旧版：{"timestamp": <秒>, "message": {"type": "StatusUpdate", "payload": {"token_usage": {...}, "message_id": ...}}}
 *   - 新版：{"type": "usage.record", "usageScope": "turn", "time": <毫秒>, "model": "...", "usage": {...}}
 *
 * Token 语义：input_other 是未命中缓存的输入，input_cache_read / input_cache_creation
 * 各自独立成桶，output 已含 reasoning，不再单列。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { cachedByFile } from '../cache.js'
import { emptyUsage, finalizeEntry } from './common.js'

const DEFAULT_MODEL = 'kimi-for-coding'

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

/** 解析 Kimi 数据根（包含 sessions/ 的那一层）。 */
export async function resolveKimiRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  const env = process.env.KIMI_DATA_DIR
  if (typeof env === 'string' && env !== '') {
    for (const part of env.split(',')) {
      if (part.trim() !== '') candidates.push(expandHome(part.trim()))
    }
  }
  if (candidates.length === 0) {
    candidates.push(join(homedir(), '.kimi'), join(homedir(), '.kimi-code'))
  }

  const roots = []
  for (const path of candidates) {
    if (!(await isDirectory(path))) continue
    let root = resolve(path)
    if (basename(root) === 'sessions') root = dirname(root)
    if (await isDirectory(join(root, 'sessions'))) roots.push(root)
  }
  return [...new Set(roots)]
}

async function collectWireFiles(root) {
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
      } else if (item.isFile() && item.name === 'wire.jsonl') {
        // 只接受 sessions/<group>/<session>/wire.jsonl（3 段）或
        // sessions/<workspace>/<session>/agents/<agent>/wire.jsonl（5 段）。
        const relative = path.slice(sessions.length + 1).split(/[\\/]/)
        if (relative.length === 3 || relative.length === 5) out.push(path)
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

async function readRootModel(root) {
  try {
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
    if (typeof config?.model === 'string' && config.model !== '') return config.model
  } catch {
    // 没装 config.json 时 Kimi Code 的默认模型就是 kimi-for-coding。
  }
  return DEFAULT_MODEL
}

function sessionIdFromPath(file) {
  const parent = dirname(file)
  // 新版路径的上一级是 agents 下的 agent 目录，再上两级才是 session。
  if (basename(dirname(parent)) === 'agents') return basename(dirname(dirname(parent)))
  return basename(parent)
}

/** 读一个 wire.jsonl，返回未计价的原始 entry。 */
async function readWireFile(file, configuredModel) {
  let content
  let mtime
  try {
    content = await readFile(file, 'utf8')
    mtime = (await stat(file)).mtimeMs
  } catch {
    return []
  }
  const sessionId = sessionIdFromPath(file)
  const entries = []
  const seen = new Set()
  for (const line of content.split('\n')) {
    if (line === '') continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record === null || typeof record !== 'object') continue

    let model
    let usageRaw
    let timestamp
    let messageId
    if (record.type === 'usage.record') {
      if (record.usageScope !== 'turn') continue
      model = typeof record.model === 'string' && record.model !== '' ? record.model : DEFAULT_MODEL
      model = model.replace(/^kimi-code\//, '')
      usageRaw = record.usage
      timestamp = timestampMs(record.time) ?? Math.trunc(mtime)
    } else if (record.message?.type === 'StatusUpdate') {
      const payload = record.message.payload
      if (payload === null || typeof payload !== 'object') continue
      usageRaw = payload.token_usage
      model = configuredModel
      timestamp = timestampMs(record.timestamp) ?? Math.trunc(mtime)
      messageId = typeof payload.message_id === 'string' ? payload.message_id : undefined
    } else {
      continue
    }
    if (usageRaw === null || typeof usageRaw !== 'object') continue

    const usage = emptyUsage()
    usage.inputTokens = num(usageRaw.input_other ?? usageRaw.inputOther)
    usage.outputTokens = num(usageRaw.output)
    usage.cacheCreationTokens = num(usageRaw.input_cache_creation ?? usageRaw.inputCacheCreation)
    usage.cacheReadTokens = num(usageRaw.input_cache_read ?? usageRaw.inputCacheRead)
    const total = num(usageRaw.total)
    const parts = usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
    if (parts === 0 && total === 0) continue
    // 旧格式偶尔只给 total，缺的部分按 output 计（与 ccusage 的 total fallback 一致）。
    if (total > parts) {
      usage.outputTokens += total - parts
    }

    const key = `${sessionId}\u0000${messageId ?? ''}\u0000${timestamp}\u0000${model}\u0000${usage.inputTokens}\u0000${usage.outputTokens}\u0000${usage.cacheCreationTokens}\u0000${usage.cacheReadTokens}`
    if (seen.has(key)) continue
    seen.add(key)

    entries.push({
      source: 'kimi',
      agent: 'kimi',
      timestamp,
      sessionId,
      project: 'kimi',
      projectPath: 'Kimi',
      model,
      messageId,
      usage,
      filePath: file,
    })
  }
  return entries
}

export async function scanKimi({ roots }) {
  const entries = []
  // 新版 wire 里同一条 usage.record 会同时出现在 agents/<agent>/wire.jsonl，
  // 也可能被多个 root 覆盖；按 ccusage 的 kimi_entry_key 做扫描级去重。
  const seen = new Set()
  let files = 0
  for (const root of roots) {
    const wireFiles = await collectWireFiles(root)
    if (wireFiles.length === 0) continue
    const configuredModel = await readRootModel(root)
    const cacheVariant = `kimi:${JSON.stringify(configuredModel)}`
    for (const file of wireFiles) {
      const list = await cachedByFile(file, () => readWireFile(file, configuredModel), cacheVariant)
      for (const entry of list) {
        const key = [
          entry.sessionId,
          entry.messageId ?? '',
          entry.timestamp,
          entry.model,
          entry.usage.inputTokens,
          entry.usage.outputTokens,
          entry.usage.cacheCreationTokens,
          entry.usage.cacheReadTokens,
        ].join('\u0000')
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
