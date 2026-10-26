/**
 * Grok CLI 适配器。
 *
 * 数据目录（默认 `~/.grok`，可用 `GROK_HOME` 覆盖）下：
 *   sessions/<project>/<session>/updates.jsonl
 *   sessions/<project>/<session>/summary.json   （可选，补项目路径与默认模型）
 *
 * 只有 `params.update.sessionUpdate === "turn_completed"` 的事件带用量：
 *   usage.inputTokens 是含缓存的总输入，要减去 cachedReadTokens / cacheCreationTokens；
 *   usage.outputTokens 已含 reasoningTokens，不再单列。
 * 一行可能同时包含多个模型（modelUsage），每个模型各出一条 entry。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { cachedByFile } from '../cache.js'
import { emptyUsage, finalizeEntry, lastPathSegment, saturatingSub } from './common.js'

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

/** 解析 Grok 数据根（包含 sessions/ 的那一层）。 */
export async function resolveGrokRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  if (typeof process.env.GROK_HOME === 'string' && process.env.GROK_HOME !== '') {
    candidates.push(expandHome(process.env.GROK_HOME))
  }
  if (candidates.length === 0) candidates.push(join(homedir(), '.grok'))

  const roots = []
  for (const path of candidates) {
    if (!(await isDirectory(path))) continue
    let root = resolve(path)
    if (basename(root) === 'sessions') root = dirname(root)
    if (await isDirectory(join(root, 'sessions'))) roots.push(root)
  }
  return [...new Set(roots)]
}

async function collectUpdateFiles(root) {
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
      if (item.isDirectory()) await walk(path)
      else if (item.isFile() && item.name === 'updates.jsonl') out.push(path)
    }
  }
  await walk(sessions)
  out.sort()
  return out
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function timestampMs(envelope, params) {
  const agent = num(params?._meta?.agentTimestampMs)
  if (agent > 0) return Math.trunc(agent)
  const envelopeSeconds = num(envelope)
  if (envelopeSeconds > 0) return Math.trunc(envelopeSeconds * 1000)
  return 0
}

function urlDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function projectFromPath(file) {
  const parts = file.split(/[\\/]/)
  const index = parts.lastIndexOf('sessions')
  if (index >= 0 && index + 1 < parts.length) return urlDecode(parts[index + 1])
  return 'grok'
}

async function readSummary(file) {
  try {
    return JSON.parse(await readFile(join(dirname(file), 'summary.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function entryFromTurn(record, file, summary, model, usageRaw) {
  const params = record.params ?? {}
  const update = params.update ?? {}
  const envelopeTimestamp = record.timestamp
  const timestamp = timestampMs(envelopeTimestamp, params)
  if (!(timestamp > 0)) return undefined
  const inputRaw = num(usageRaw.inputTokens)
  const cached = num(usageRaw.cachedReadTokens)
  const cacheCreation = num(usageRaw.cacheCreationTokens)
  const output = num(usageRaw.outputTokens)
  if (inputRaw + cached + cacheCreation + output === 0) return undefined

  const usage = emptyUsage()
  usage.inputTokens = saturatingSub(inputRaw, cached + cacheCreation)
  usage.cacheReadTokens = cached
  usage.cacheCreationTokens = cacheCreation
  usage.outputTokens = output

  const sessionId =
    (typeof params.sessionId === 'string' && params.sessionId !== '' ? params.sessionId : undefined) ??
    (typeof summary?.info?.id === 'string' && summary.info.id !== '' ? summary.info.id : undefined) ??
    basename(dirname(file))

  const cwd = typeof summary?.info?.cwd === 'string' && summary.info.cwd !== '' ? summary.info.cwd : projectFromPath(file)
  const displayModel = typeof model === 'string' && model !== '' ? model : 'unknown'

  return {
    source: 'grok',
    agent: 'grok',
    timestamp,
    sessionId,
    project: lastPathSegment(cwd) || 'grok',
    projectPath: cwd,
    model: displayModel,
    usage,
    filePath: file,
  }
}

/** 读一个 updates.jsonl，返回未计价的原始 entry。 */
async function readUpdatesFile(file, summary) {
  let content
  try {
    content = await readFile(file, 'utf8')
  } catch {
    return []
  }
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
    const update = record.params?.update
    if (update?.sessionUpdate !== 'turn_completed') continue
    const usage = update.usage
    if (usage === null || typeof usage !== 'object') continue
    const eventId = record.params?._meta?.eventId
    const modelUsage = usage.modelUsage !== null && typeof usage.modelUsage === 'object' ? usage.modelUsage : undefined
    const produced = []
    if (modelUsage !== undefined && Object.keys(modelUsage).length > 0) {
      for (const [model, value] of Object.entries(modelUsage)) {
        if (value === null || typeof value !== 'object') continue
        const entry = entryFromTurn(record, file, summary, model, value)
        if (entry !== undefined) produced.push(entry)
      }
    } else {
      const fallbackModel = summary?.current_model_id ?? 'unknown'
      const entry = entryFromTurn(record, file, summary, fallbackModel, usage)
      if (entry !== undefined) produced.push(entry)
    }

    for (const entry of produced) {
      const key = typeof eventId === 'string' && eventId !== ''
        ? `e\u0000${eventId}\u0000${entry.model}`
        : `c\u0000${entry.timestamp}\u0000${entry.model}\u0000${entry.usage.inputTokens}\u0000${entry.usage.outputTokens}\u0000${entry.usage.cacheReadTokens}\u0000${entry.usage.cacheCreationTokens}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(entry)
    }
  }
  return entries
}

export async function scanGrok({ roots }) {
  const entries = []
  let files = 0
  for (const root of roots) {
    const updateFiles = await collectUpdateFiles(root)
    for (const file of updateFiles) {
      const summary = await readSummary(file)
      // summary 是 entry 的输入之一；updates 未变时也要让相关元数据变化触发重读。
      const cacheVariant = `grok:${JSON.stringify([
        summary?.info?.id,
        summary?.info?.cwd,
        summary?.current_model_id,
      ])}`
      const list = await cachedByFile(file, () => readUpdatesFile(file, summary), cacheVariant)
      for (const entry of list) {
        finalizeEntry(entry)
        entries.push(entry)
      }
      files += 1
    }
  }
  return { entries, files }
}
