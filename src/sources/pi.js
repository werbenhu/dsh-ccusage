/**
 * pi coding agent 适配器。
 *
 * 数据目录（默认 `~/.pi/agent/sessions`，可用 `PI_AGENT_DIR` 覆盖）下：
 *   sessions/<project>/<timestamp>_<session>.jsonl
 *
 * 每行是一条会话记录，只有 assistant 的 message 带用量：
 *   {"type":"message","timestamp":"ISO","message":{"role":"assistant","model":"k3-256k",
 *    "usage":{"input":561,"output":122,"cacheRead":768,"cacheWrite":0,
 *             "totalTokens":1451,"cost":{"total":0}}}}
 *
 * `totalTokens` 可补齐分项缺失的 output；`cost.total` 是 pi 记录的展示费用。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { cachedByFile } from '../cache.js'
import { emptyUsage, finalizeEntry } from './common.js'

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

/** 解析 pi 数据根（包含 sessions/ 的那一层）。 */
export async function resolvePiRoots(configured) {
  const candidates = []
  for (const raw of Array.isArray(configured) ? configured : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    candidates.push(expandHome(raw.trim()))
  }
  const env = process.env.PI_AGENT_DIR
  if (typeof env === 'string' && env !== '') {
    for (const part of env.split(',')) {
      if (part.trim() !== '') candidates.push(expandHome(part.trim()))
    }
  }
  if (candidates.length === 0) candidates.push(join(homedir(), '.pi', 'agent', 'sessions'))

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
      if (item.isDirectory()) await walk(path)
      else if (item.isFile() && item.name.endsWith('.jsonl')) out.push(path)
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

function sessionIdFromFile(file) {
  const stem = basename(file, '.jsonl')
  const index = stem.indexOf('_')
  return index >= 0 ? stem.slice(index + 1) : stem
}

function projectFromFile(file) {
  const parts = file.split(/[\\/]/)
  const index = parts.lastIndexOf('sessions')
  if (index >= 0 && index + 1 < parts.length) return parts[index + 1]
  return 'pi'
}

function transcriptionGroupFromFile(file) {
  const parts = file.split(/[\\/]/)
  const index = parts.lastIndexOf('sessions')
  if (index >= 0 && index + 2 < parts.length) {
    // 主文件 <session>.jsonl 与目录 <session>/run-0/... 属于同一转写组。
    return `${parts[index + 1]}\u0000${parts[index + 2].replace(/\.jsonl$/, '')}`
  }
  return file
}

/** 读一个 pi 会话文件，返回未计价的原始 entry。 */
async function readSessionFile(file) {
  let content
  try {
    content = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const sessionId = sessionIdFromFile(file)
  const project = projectFromFile(file)
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
    if (record.type !== undefined && record.type !== 'message') continue
    const message = record.message
    if (message === null || typeof message !== 'object') continue
    if (message.role !== 'assistant') continue
    const usageRaw = message.usage
    if (usageRaw === null || typeof usageRaw !== 'object') continue
    const timestamp = timestampMs(record.timestamp) ?? timestampMs(message.timestamp)
    if (timestamp === undefined) continue
    const model = typeof message.model === 'string' && message.model !== '' ? message.model : 'unknown'
    const usage = emptyUsage()
    usage.inputTokens = num(usageRaw.input)
    usage.outputTokens = num(usageRaw.output)
    usage.cacheReadTokens = num(usageRaw.cacheRead)
    usage.cacheCreationTokens = num(usageRaw.cacheWrite)
    const total = num(usageRaw.totalTokens)
    const parts = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
    if (parts === 0) {
      if (total === 0) continue
      usage.outputTokens = total
    } else if (total > parts) {
      usage.outputTokens += total - parts
    }

    const displayCost = typeof usageRaw.cost?.total === 'number' && Number.isFinite(usageRaw.cost.total) && usageRaw.cost.total >= 0
      ? usageRaw.cost.total
      : undefined
    const key = `${timestamp}\u0000${model}\u0000${usage.inputTokens}\u0000${usage.outputTokens}\u0000${usage.cacheReadTokens}\u0000${usage.cacheCreationTokens}`
    if (seen.has(key)) continue
    seen.add(key)

    entries.push({
      source: 'pi',
      agent: 'pi',
      timestamp,
      sessionId,
      project,
      projectPath: project,
      // ccusage 在报表里用 `[pi] ` 前缀区分 pi 与其它 source 的同名模型；
      // 计价仍用原始模型名。
      model: `[pi] ${model}`,
      pricingModel: model,
      provider: message.provider,
      usage,
      storedCost: displayCost,
      messageId: record.id,
      filePath: file,
    })
  }
  return entries
}

export async function scanPi({ roots, costMode, pricing }) {
  const entries = []
  // 同一个会话可能同时出现在 sessions/<project>/<file>.jsonl 与
  // sessions/<project>/<file>/run-0/session.jsonl、subagent-artifacts/ 下；
  // ccusage 按 (timestamp, model, tokens) 全局去重，这里保持一致。
  const seen = new Map()
  let files = 0
  for (const root of roots) {
    const sessionFiles = await collectSessionFiles(root)
    for (const file of sessionFiles) {
      const list = await cachedByFile(file, () => readSessionFile(file), 'pi')
      for (const entry of list) {
        // 同一条用量会同时出现在父会话与 run-0/session.jsonl、subagent-artifacts
        // 的转写里，时间戳可能被重放改写；仅在同一顶层会话的跨文件副本间去重。
        const key = [
          transcriptionGroupFromFile(file),
          entry.pricingModel ?? entry.model,
          entry.usage.inputTokens,
          entry.usage.outputTokens,
          entry.usage.cacheReadTokens,
          entry.usage.cacheCreationTokens,
        ].join('\u0000')
        const owner = seen.get(key)
        if (owner !== undefined && owner !== file) continue
        if (owner === undefined) seen.set(key, file)
        finalizeEntry(entry, costMode, pricing)
        entries.push(entry)
      }
      files += 1
    }
  }
  return { entries, files }
}
