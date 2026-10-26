/**
 * Codex 适配器。
 *
 * 数据来源：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`（默认
 * `~/.codex/sessions`）。用量记录在 `event_msg` + `payload.type == "token_count"`：
 * - `last_token_usage` 是本次响应；
 * - `total_token_usage` 是会话累计值，优先用它判断是否有新增。
 *
 * 模型来自同一文件里最近的 `turn_context.payload.model`（旧版事件也可能把
 * model 直接放在 token_count 的 info/payload 里）。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { emptyUsage, finalizeEntry, lastPathSegment, saturatingSub } from './common.js'
import { cachedByFile } from '../cache.js'
import { decompress as zstdDecompress } from '../../vendor/fzstd.mjs'

const MAX_PARALLEL = 6
const ROLLOUT = 'rollout-'

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

/** 允许配置指向 Codex 数据目录本身或它的 sessions 子目录。 */
export async function resolveCodexRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  if (typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME !== '') {
    candidates.push(expandHome(process.env.CODEX_HOME))
  }
  candidates.push(join(homedir(), '.codex'))

  const roots = []
  for (const path of candidates) {
    if (await isDirectory(path)) {
      if (basename(path) === 'sessions') roots.push(path)
      else if (await isDirectory(join(path, 'sessions'))) roots.push(join(path, 'sessions'))
    }
  }
  return [...new Set(roots)]
}

async function collectRollouts(dir) {
  const out = []
  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const path = join(dir, item.name)
    if (item.isDirectory()) out.push(...(await collectRollouts(path)))
    else if (item.isFile() && item.name.startsWith(ROLLOUT) && (item.name.endsWith('.jsonl') || item.name.endsWith('.jsonl.zst'))) {
      out.push(path)
    }
  }
  return out
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function normalizeRawUsage(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const input = num(raw.input_tokens ?? raw.prompt_tokens ?? raw.input)
  const cached = Math.min(input, num(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cached_tokens))
  const cacheCreation = Math.min(
    saturatingSub(input, cached),
    num(raw.cache_write_input_tokens ?? raw.cache_creation_input_tokens),
  )
  const output = num(raw.output_tokens ?? raw.completion_tokens ?? raw.output)
  const reasoning = num(raw.reasoning_output_tokens ?? raw.reasoning_tokens)
  const total = num(raw.total_tokens)
  return { input, cached, cacheCreation, output, reasoning, total }
}

function subtractRawUsage(total, previous) {
  if (previous === undefined) return total
  return {
    input: saturatingSub(total.input, previous.input),
    cached: saturatingSub(total.cached, previous.cached),
    cacheCreation: saturatingSub(total.cacheCreation, previous.cacheCreation),
    output: saturatingSub(total.output, previous.output),
    reasoning: saturatingSub(total.reasoning, previous.reasoning),
    total: saturatingSub(total.total, previous.total),
  }
}

function sameUsage(a, b) {
  return a.input === b.input && a.cached === b.cached && a.cacheCreation === b.cacheCreation &&
    a.output === b.output && a.reasoning === b.reasoning && a.total === b.total
}

function hasTokens(raw) {
  return raw.input > 0 || raw.cached > 0 || raw.cacheCreation > 0 || raw.output > 0 || raw.reasoning > 0
}

function modelFrom(source) {
  if (source === null || typeof source !== 'object') return undefined
  const direct = source.model ?? source.model_name ?? source.metadata?.model
  return typeof direct === 'string' && direct !== '' ? direct : undefined
}

function sessionMeta(payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  const id = payload.id ?? payload.session_id
  if (typeof id !== 'string' || id === '') return undefined
  return {
    id,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
    forkedFrom: typeof payload.forked_from_id === 'string' ? payload.forked_from_id : undefined,
  }
}

async function readRollout(path) {
  const events = []
  let sessionId
  let cwd
  let responseId
  let text
  try {
    const buffer = await readFile(path)
    const bytes = path.endsWith('.zst') ? zstdDecompress(buffer) : buffer
    text = new TextDecoder().decode(bytes)
  } catch {
    return { events, sessionId, cwd }
  }
  let currentModel
  let previousTotals
  for (const line of text.split('\n')) {
    if (line.length === 0 || (!line.includes('token_count') && !line.includes('turn_context') && !line.includes('session_meta'))) {
      continue
    }
    let data
    try {
      data = JSON.parse(line)
    } catch {
      continue
    }
    if (data === null || typeof data !== 'object') continue
    if (data.type === 'session_meta') {
      responseId = undefined
      const meta = sessionMeta(data.payload)
      if (meta !== undefined) {
        sessionId = meta.id
        cwd = meta.cwd ?? cwd
      }
      continue
    }
    if (data.type === 'turn_context') {
      // response_id 只在当前 turn 内有效；缺省 id 的下一 turn 不能沿用上一 turn。
      responseId = undefined
      const model = modelFrom(data.payload)
      if (model !== undefined) currentModel = model
      continue
    }
    if (data.type !== 'event_msg' || data.payload?.type !== 'token_count') continue
    const timestamp = parseTimestamp(data.timestamp ?? data.payload?.timestamp)
    if (timestamp === undefined) continue
    const info = data.payload?.info
    if (info === null || typeof info !== 'object') continue
    const totalUsage = normalizeRawUsage(info.total_token_usage)
    const advanced = totalUsage === undefined || previousTotals === undefined || !sameUsage(totalUsage, previousTotals)
    let raw = advanced ? normalizeRawUsage(info.last_token_usage) : undefined
    if (raw === undefined && totalUsage !== undefined) raw = subtractRawUsage(totalUsage, previousTotals)
    if (totalUsage !== undefined) previousTotals = totalUsage
    if (raw === undefined || !hasTokens(raw)) continue
    const eventResponseId = data.payload?.response_id
    if (typeof eventResponseId === 'string' && eventResponseId !== '') responseId = eventResponseId
    const model = modelFrom(data.payload) ?? modelFrom(info) ?? currentModel
    events.push({ timestamp, model, responseId, raw })
  }
  return { events, sessionId, cwd }
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

/**
 * Codex 的自动评审（auto review）在日志里模型名是 `codex-auto-review`，
 * ccusage 会把它归到实际执行的 `gpt-5.6-luna` 上。
 */
const CODEX_MODEL_ALIASES = {
  'codex-auto-review': 'gpt-5.6-luna',
}

function codexModelName(model) {
  if (typeof model !== 'string' || model === '') return 'unknown'
  return CODEX_MODEL_ALIASES[model] ?? model
}

function eventKey(event, sessionId) {  if (event.responseId !== undefined) return `r:${event.responseId}`
  const r = event.raw
  return `t:${sessionId}:${event.timestamp}:${event.model}:${r.input}:${r.cached}:${r.cacheCreation}:${r.output}:${r.reasoning}:${r.total}`
}

export async function scanCodex({ roots }) {
  const files = []
  for (const root of roots) files.push(...(await collectRollouts(root)))
  files.sort()

  const loaded = await mapLimit(files, MAX_PARALLEL, async (file) => ({
    file,
    ...(await cachedByFile(file, () => readRollout(file))),
  }))

  const entries = []
  const seen = new Set()
  for (const { file, events, sessionId, cwd } of loaded) {
    const fallbackSession = sessionId ?? basename(file).replace(/\.jsonl(\.zst)?$/, '')
    const projectPath = cwd ?? 'Codex'
    for (const event of events) {
      const key = eventKey(event, fallbackSession)
      if (seen.has(key)) continue
      seen.add(key)
      const raw = event.raw
      const usage = emptyUsage()
      usage.inputTokens = saturatingSub(raw.input, raw.cached + raw.cacheCreation)
      usage.cacheReadTokens = raw.cached
      usage.cacheCreationTokens = raw.cacheCreation
      usage.outputTokens = raw.output
      // Codex 的 output_tokens 已包含 reasoning token，标准的 4 个桶之外不再重复计入。
      usage.extraTokens = 0

      const entry = {
        source: 'codex',
        agent: 'codex',
        timestamp: event.timestamp,
        sessionId: fallbackSession,
        projectPath,
        project: projectPath === 'Codex' ? 'codex' : lastPathSegment(projectPath) || 'codex',
        model: codexModelName(event.model),
        messageId: event.responseId,
        requestId: event.responseId,
        usage,
        filePath: file,
      }
      finalizeEntry(entry)
      entries.push(entry)
    }
  }
  return { entries, files: files.length }
}
