/**
 * 聚合：把 entry 按日/周/月/会话分桶，产出与 ccusage JSON 对齐的报表行。
 */

import { addUsage, emptyUsage, sumUsage } from './sources/common.js'
import { dateKey, monthKey, weekStartDay } from './time.js'

function iso(ms) {
  return new Date(ms).toISOString()
}

function modelNameOf(model) {
  return typeof model === 'string' && model !== '' ? model : 'unknown'
}

function tokensOfRow(row) {
  return (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cacheCreationTokens ?? 0) + (row.cacheReadTokens ?? 0)
}

function createBucket(period, agent) {
  const usage = emptyUsage()
  return {
    period,
    agent,
    usage,
    totalTokens: 0,
    models: new Map(),
    agents: new Set(),
    byAgent: new Map(),
    entries: 0,
    firstActivity: undefined,
    lastActivity: undefined,
  }
}

function addToModel(bucket, entry) {
  const name = modelNameOf(entry.model)
  let model = bucket.models.get(name)
  if (model === undefined) {
    model = { usage: emptyUsage() }
    bucket.models.set(name, model)
  }
  addUsage(model.usage, entry.usage)
}

function accumulate(bucket, entry) {
  addUsage(bucket.usage, entry.usage)
  bucket.totalTokens += entry.totalTokens ?? sumUsage(entry.usage)
  bucket.entries += 1
  bucket.agents.add(entry.agent)
  if (bucket.firstActivity === undefined || entry.timestamp < bucket.firstActivity) bucket.firstActivity = entry.timestamp
  if (bucket.lastActivity === undefined || entry.timestamp > bucket.lastActivity) bucket.lastActivity = entry.timestamp
  addToModel(bucket, entry)
}

function addEntry(bucket, entry) {
  accumulate(bucket, entry)
  let sub = bucket.byAgent.get(entry.agent)
  if (sub === undefined) {
    sub = createBucket(bucket.period, entry.agent)
    bucket.byAgent.set(entry.agent, sub)
  }
  accumulate(sub, entry)
}

function modelBreakdown(bucket) {
  return [...bucket.models.entries()]
    .map(([name, model]) => {
      const row = {
        modelName: name,
        inputTokens: model.usage.inputTokens,
        outputTokens: model.usage.outputTokens,
        cacheCreationTokens: model.usage.cacheCreationTokens,
        cacheReadTokens: model.usage.cacheReadTokens,
      }
      if (model.usage.extraTokens > 0) row.reasoningOutputTokens = model.usage.extraTokens
      return row
    })
    .sort((a, b) => tokensOfRow(b) - tokensOfRow(a) || a.modelName.localeCompare(b.modelName))
}

function rowFromBucket(bucket, extra = {}) {
  const row = {
    agent: bucket.agent,
    period: bucket.period,
    inputTokens: bucket.usage.inputTokens,
    outputTokens: bucket.usage.outputTokens,
    cacheCreationTokens: bucket.usage.cacheCreationTokens,
    cacheReadTokens: bucket.usage.cacheReadTokens,
    totalTokens: bucket.totalTokens,
    modelsUsed: [...bucket.models.keys()].sort(),
    modelBreakdowns: modelBreakdown(bucket),
  }
  if (bucket.usage.extraTokens > 0) row.reasoningOutputTokens = bucket.usage.extraTokens
  row.metadata = { ...(extra.metadata ?? {}) }
  if (bucket.agents.size > 0) row.metadata.agents = [...bucket.agents].sort()
  if (bucket.byAgent.size > 0) {
    row.agentBreakdowns = [...bucket.byAgent.values()]
      .map((sub) => {
        const item = {
          agent: sub.agent,
          inputTokens: sub.usage.inputTokens,
          outputTokens: sub.usage.outputTokens,
          cacheCreationTokens: sub.usage.cacheCreationTokens,
          cacheReadTokens: sub.usage.cacheReadTokens,
          totalTokens: sub.totalTokens,
          entries: sub.entries,
          modelsUsed: [...sub.models.keys()].sort(),
          modelBreakdowns: modelBreakdown(sub),
        }
        if (sub.usage.extraTokens > 0) item.reasoningOutputTokens = sub.usage.extraTokens
        return item
      })
      .sort((a, b) => b.totalTokens - a.totalTokens || a.agent.localeCompare(b.agent))
  }
  return { ...row, ...extra.top }
}

/**
 * 按 keyFn 分桶并排序。keyFn 返回 null 表示跳过。
 */
export function summarize(entries, keyFn, { order = 'asc', agent = 'all' } = {}) {
  const buckets = new Map()
  for (const entry of entries) {
    const key = keyFn(entry)
    if (key === null || key === undefined) continue
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = createBucket(key, agent)
      buckets.set(key, bucket)
    }
    addEntry(bucket, entry)
  }
  const rows = [...buckets.values()].map((bucket) => rowFromBucket(bucket))
  if (order === 'asc') rows.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0))
  else rows.sort((a, b) => b.totalTokens - a.totalTokens || (a.period < b.period ? 1 : -1))
  return rows
}

/** 汇总所有 entry 的 totals。 */
export function totalize(entries) {
  const usage = emptyUsage()
  let tokens = 0
  for (const entry of entries) {
    addUsage(usage, entry.usage)
    tokens += entry.totalTokens ?? sumUsage(entry.usage)
  }
  const totals = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    totalTokens: tokens,
  }
  if (usage.extraTokens > 0) totals.reasoningOutputTokens = usage.extraTokens
  return totals
}

/** 会话报表：period 用会话 id（Codex 用相对文件路径），按 token 降序。 */
export function summarizeSessions(entries) {
  const buckets = new Map()
  for (const entry of entries) {
    const period = entry.source === 'codex'
      ? (entry.filePath ?? entry.sessionId).replace(/\\/g, '/').replace(/\.jsonl$/, '').replace(/^sessions\//, '')
      : entry.sessionId
    const key = `${entry.agent}\u0000${period}`
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = createBucket(period, entry.agent)
      bucket.sessionId = entry.sessionId
      buckets.set(key, bucket)
    }
    addEntry(bucket, entry)
  }
  return [...buckets.values()]
    .map((bucket) => {
      const row = rowFromBucket(bucket, {
        top: {
          metadata: {
            lastActivity: bucket.lastActivity === undefined ? undefined : iso(bucket.lastActivity),
          },
        },
      })
      return row
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
}

export function entryDate(entry, timeZone) {
  return dateKey(entry.timestamp, timeZone)
}

export { weekStartDay, monthKey }
