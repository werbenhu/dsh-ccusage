/**
 * Claude Code 适配器。
 *
 * 数据来源：`<config>/projects/<project>/<session>.jsonl` 以及
 * `projects/<project>/<session>/subagents/agent-*.jsonl`。每个 assistant 行的
 * `message.usage` 就是一次 API 响应；Claude Code 会为同一次响应写多行（每个
 * content block 一行），所以必须按 message/request 去重。
 */

import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'

import { emptyUsage, finalizeEntry, sumUsage } from './common.js'
import { cachedByFile } from '../cache.js'

const JSONL = '.jsonl'
const MAX_PARALLEL = 8
const USAGE_MARKER = '"usage":'
const ADVISOR_MARKER = 'advisor_message'

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

/** 解析 Claude 数据根目录；每项都要包含 projects/。 */
export async function resolveClaudeRoots(configured) {
  const explicit = []
  const fromConfig = Array.isArray(configured) ? configured : []
  const fromEnv = typeof process.env.CLAUDE_CONFIG_DIR === 'string' ? process.env.CLAUDE_CONFIG_DIR.split(',') : []
  for (const raw of [...fromConfig, ...fromEnv]) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    let path = expandHome(raw.trim())
    if (basename(path) === 'projects' && (await isDirectory(path))) path = dirname(path)
    if (await isDirectory(join(path, 'projects'))) explicit.push(path)
  }
  if (explicit.length > 0) return [...new Set(explicit)]

  const candidates = []
  const xdg = process.env.XDG_CONFIG_HOME
  if (typeof xdg === 'string' && xdg !== '') candidates.push(join(xdg, 'claude'))
  else candidates.push(join(homedir(), '.config', 'claude'))
  candidates.push(join(homedir(), '.claude'))
  const roots = []
  for (const path of candidates) {
    if (await isDirectory(join(path, 'projects'))) roots.push(path)
  }
  return roots
}

async function collectJsonl(dir) {
  const out = []
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const path = join(dir, item.name)
    if (item.isDirectory()) {
      out.push(...(await collectJsonl(path)))
    } else if (item.isFile() && item.name.endsWith(JSONL)) {
      out.push(path)
    }
  }
  return out
}

/** 从路径里取 projects/ 之后的第一段作为项目目录名。 */
function projectOf(path) {
  const parts = path.split(sep)
  const index = parts.lastIndexOf('projects')
  if (index >= 0 && index + 1 < parts.length) return parts[index + 1]
  return 'unknown'
}

/** 会话 id 与项目路径，与 ccusage 的 extract_session_parts 对齐。 */
function sessionPartsOf(path) {
  const parts = path.split(sep)
  const index = parts.lastIndexOf('projects')
  const relativeParts = index >= 0 ? parts.slice(index + 1) : parts
  const fileName = relativeParts.at(-1) ?? ''
  const fileSession = fileName.endsWith(JSONL) ? fileName.slice(0, -JSONL.length) : ''
  if (relativeParts.length === 2 && fileSession !== '') {
    return { sessionId: fileSession, projectPath: relativeParts[0] }
  }
  if (relativeParts.length >= 4 && relativeParts.at(-2) === 'subagents') {
    const sessionId = relativeParts.at(-3)
    const projectPath = relativeParts.slice(0, -3).join(sep) || 'Unknown Project'
    return { sessionId, projectPath }
  }
  const sessionId = relativeParts.at(-2) ?? 'unknown'
  const projectPath = relativeParts.length > 2 ? relativeParts.slice(0, -2).join(sep) : 'Unknown Project'
  return { sessionId, projectPath }
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function isAnthropicMessageId(messageId) {
  return typeof messageId === 'string' && (messageId.startsWith('msg_') || messageId.startsWith('resp_'))
}

function isSemverPrefix(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)
}

function validEntry(entry) {
  if (entry.version !== undefined && !isSemverPrefix(entry.version)) return false
  if (entry.sessionId === '') return false
  if (entry.requestId === '') return false
  if (entry.messageId === '') return false
  if (entry.rawModel === '') return false
  return true
}

function usageFromRaw(raw) {
  const usage = emptyUsage()
  usage.inputTokens = Number(raw?.input_tokens) || 0
  usage.outputTokens = Number(raw?.output_tokens) || 0
  usage.cacheReadTokens = Number(raw?.cache_read_input_tokens) || 0
  const fiveMinute = Number(raw?.cache_creation?.ephemeral_5m_input_tokens) || 0
  const oneHour = Number(raw?.cache_creation?.ephemeral_1h_input_tokens) || 0
  usage.cacheCreation5mTokens = fiveMinute
  usage.cacheCreation1hTokens = oneHour
  // 与 ccusage 的 cache_creation_token_count 一致：只要日志给了 cache_creation 明细，
  // 就只用 5m+1h（哪怕都是 0）；没有明细时才回退到 cache_creation_input_tokens。
  usage.cacheCreationTokens = raw?.cache_creation !== null && typeof raw?.cache_creation === 'object'
    ? fiveMinute + oneHour
    : Number(raw?.cache_creation_input_tokens) || 0
  return usage
}

function buildEntry(data, file, root) {
  if (data === null || typeof data !== 'object') return undefined
  const message = data.message
  if (message === null || typeof message !== 'object' || message.usage === null || typeof message.usage !== 'object') {
    return undefined
  }
  const timestamp = parseTimestamp(data.timestamp)
  if (timestamp === undefined) return undefined
  const model = typeof message.model === 'string' ? message.model : undefined
  if (model === '<synthetic>' || model === undefined) return undefined
  const usage = usageFromRaw(message.usage)
  if (usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens === 0) return undefined
  const sessionId = typeof data.session_id === 'string' ? data.session_id : data.sessionId
  const parts = sessionPartsOf(file)
  const entry = {
    source: 'claude',
    agent: 'claude',
    timestamp,
    sessionId: sessionId ?? parts.sessionId,
    projectPath: parts.projectPath,
    project: projectOf(file),
    model: data.message?.usage?.speed === 'fast' ? `${model}-fast` : model,
    rawModel: model,
    messageId: typeof message.id === 'string' ? message.id : undefined,
    requestId: typeof data.requestId === 'string' ? data.requestId : undefined,
    version: typeof data.version === 'string' ? data.version : undefined,
    isSidechain: data.isSidechain === true,
    speed: message.usage.speed === 'fast' ? 'fast' : undefined,
    storedCost: typeof data.costUSD === 'number' && Number.isFinite(data.costUSD) && data.costUSD >= 0 ? data.costUSD : undefined,
    usage,
    filePath: relative(root, file),
  }
  return validEntry(entry) ? entry : undefined
}

function advisorEntries(data, base) {
  const iterations = data?.message?.usage?.iterations
  if (!Array.isArray(iterations) || !JSON.stringify(data.message.usage).includes(ADVISOR_MARKER)) return []
  const out = []
  iterations.forEach((iteration, index) => {
    if (iteration?.type !== 'advisor_message') return
    if (typeof iteration.model !== 'string' || iteration.model === '') return
    const usage = usageFromRaw(iteration)
    if (usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens === 0) return
    out.push({
      ...base,
      model: iteration.model,
      rawModel: iteration.model,
      messageId: base.messageId === undefined ? undefined : `${base.messageId}:advisor:${index}`,
      storedCost: undefined,
      usage,
    })
  })
  return out
}

async function readFileEntries(path, root) {
  const entries = []
  let stream
  try {
    stream = createReadStream(path)
  } catch {
    return entries
  }
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      if (line.length === 0 || !line.includes(USAGE_MARKER)) continue
      let data
      try {
        data = JSON.parse(line)
      } catch {
        continue
      }
      const entry = buildEntry(data, path, root)
      if (entry === undefined) continue
      entries.push(entry)
      entries.push(...advisorEntries(data, entry))
    }
  } finally {
    reader.close()
    stream.destroy()
  }
  return entries
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function exactDedupeKey(entry) {
  const parts = [entry.messageId ?? '', entry.requestId ?? '']
  if (entry.requestId === undefined) {
    parts.push(entry.sessionId)
    if (!isAnthropicMessageId(entry.messageId)) parts.push(String(entry.timestamp))
  }
  return parts.join('\u0000')
}

function tokenTotal(entry) {
  return sumUsage(entry.usage)
}

function shouldReplace(candidate, existing) {
  if (candidate.isSidechain !== existing.isSidechain) return existing.isSidechain
  const candidateTotal = tokenTotal(candidate)
  const existingTotal = tokenTotal(existing)
  if (candidateTotal !== existingTotal) return candidateTotal > existingTotal
  return candidate.speed !== undefined && existing.speed === undefined
}

function replayKey(entry) {
  return `${entry.messageId ?? ''}\u0000${entry.sessionId}`
}

function matchesReplay(existing, candidate) {
  if (existing.messageId !== candidate.messageId) return false
  const requestless = candidate.requestId === undefined && existing.requestId === undefined
  if (!requestless && existing.timestamp !== candidate.timestamp) return false
  return candidate.isSidechain || existing.isSidechain
}

/** 去重：精确匹配 message/request，另加 sidechain replay 的跨 requestId 折叠。 */
function dedupe(entries) {
  const exact = new Map()
  const replay = new Map()
  const kept = []
  for (const entry of entries) {
    const key = exactDedupeKey(entry)
    const bucket = exact.get(key)
    // exact 的索引也是被折叠记录的身份别名；替换保留记录后，旧别名仍然有效。
    let existingIndex = bucket?.[0]
    if (existingIndex === undefined && entry.messageId !== undefined) {
      const replays = replay.get(replayKey(entry)) ?? []
      existingIndex = replays.find((index) => matchesReplay(kept[index], entry))
    }
    if (existingIndex !== undefined) {
      if (shouldReplace(entry, kept[existingIndex])) {
        kept[existingIndex] = entry
        // replay 命中时，replacement 可能有新的 exact key；把它也指向同一槽位。
        if (bucket === undefined) exact.set(key, [existingIndex])
        else if (!bucket.includes(existingIndex)) bucket.push(existingIndex)
      }
      continue
    }
    const index = kept.length
    kept.push(entry)
    if (bucket === undefined) exact.set(key, [index])
    else if (!bucket.includes(index)) bucket.push(index)
    if (entry.messageId !== undefined) {
      const key2 = replayKey(entry)
      const list = replay.get(key2)
      if (list === undefined) replay.set(key2, [index])
      else list.push(index)
    }
  }
  return kept
}

/**
 * 扫描所有 Claude 会话文件。
 * @returns {Promise<{entries:object[], files:number}>}
 */
export async function scanClaude({ roots, costMode, pricing }) {
  const files = []
  for (const root of roots) files.push(...(await collectJsonl(join(root, 'projects'))))
  files.sort()
  const loaded = await mapLimit(files, MAX_PARALLEL, async (file) => {
    const root = roots.find((candidate) => file.startsWith(candidate)) ?? roots[0] ?? ''
    try {
      return await cachedByFile(file, () => readFileEntries(file, root), root)
    } catch {
      // 遍历后文件可能被删除或变得不可读；失败不写入缓存，下次扫描会重试。
      return []
    }
  })
  const entries = dedupe(loaded.flat())
  for (const entry of entries) {
    finalizeEntry(entry, costMode, pricing)
  }
  return { entries, files: files.length }
}
