/**
 * 5 小时会话块（ccusage blocks）：识别连续使用区间、缺口、燃尽率与预测。
 */

import { addUsage, emptyUsage, sumUsage } from './sources/common.js'
import { dateKey, floorToHour } from './time.js'

function sumUsageInto(target, usage) {
  return addUsage(target, usage)
}

export const DEFAULT_SESSION_HOURS = 5

function iso(ms) {
  return new Date(ms).toISOString()
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => a.timestamp - b.timestamp)
}

function createBlock(start, entries, now, duration) {
  const end = start + duration
  const last = entries[entries.length - 1].timestamp
  const tokenCounts = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }
  let cost = 0
  const models = []
  const seen = new Set()
  for (const entry of entries) {
    tokenCounts.inputTokens += entry.usage.inputTokens
    tokenCounts.outputTokens += entry.usage.outputTokens
    tokenCounts.cacheCreationInputTokens += entry.usage.cacheCreationTokens
    tokenCounts.cacheReadInputTokens += entry.usage.cacheReadTokens
    cost += entry.cost
    const model = entry.model ?? 'unknown'
    if (!seen.has(model)) {
      seen.add(model)
      models.push(model)
    }
  }
  return {
    id: iso(start),
    startTime: start,
    endTime: end,
    actualEndTime: last,
    isActive: now - last < duration && now < end,
    isGap: false,
    entries,
    tokenCounts,
    cost,
    models,
  }
}

function createGapBlock(last, next, duration) {
  const start = last + duration
  return {
    id: `gap-${iso(start)}`,
    startTime: start,
    endTime: next,
    actualEndTime: null,
    isActive: false,
    isGap: true,
    entries: [],
    tokenCounts: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    cost: 0,
    models: [],
  }
}

/** 与 ccusage identify_session_blocks 对齐。 */
export function identifySessionBlocks(entries, { sessionHours = DEFAULT_SESSION_HOURS, now = Date.now() } = {}) {
  if (entries.length === 0) return []
  const duration = Math.trunc(sessionHours * 3600 * 1000)
  const sorted = sortEntries(entries)
  const blocks = []
  let currentStart
  let currentEntries = []
  for (const entry of sorted) {
    if (currentStart !== undefined) {
      const lastTime = currentEntries.length > 0 ? currentEntries[currentEntries.length - 1].timestamp : currentStart
      const sinceStart = entry.timestamp - currentStart
      const sinceLast = entry.timestamp - lastTime
      if (sinceStart > duration || sinceLast > duration) {
        blocks.push(createBlock(currentStart, currentEntries, now, duration))
        if (sinceLast > duration) blocks.push(createGapBlock(lastTime, entry.timestamp, duration))
        currentStart = floorToHour(entry.timestamp)
        currentEntries = []
      }
    } else {
      currentStart = floorToHour(entry.timestamp)
    }
    currentEntries.push(entry)
  }
  if (currentStart !== undefined && currentEntries.length > 0) {
    blocks.push(createBlock(currentStart, currentEntries, now, duration))
  }
  return blocks
}

export function calculateBurnRate(block) {
  if (block.entries.length === 0 || block.isGap) return null
  const first = block.entries[0].timestamp
  const last = block.entries[block.entries.length - 1].timestamp
  const minutes = (last - first) / 60000
  if (!(minutes > 0)) return null
  const total = totalTokens(block)
  const nonCache = block.tokenCounts.inputTokens + block.tokenCounts.outputTokens
  return {
    tokensPerMinute: total / minutes,
    tokensPerMinuteForIndicator: nonCache / minutes,
    costPerHour: (block.cost / minutes) * 60,
  }
}

export function totalTokens(block) {
  const c = block.tokenCounts
  return c.inputTokens + c.outputTokens + c.cacheCreationInputTokens + c.cacheReadInputTokens
}

export function projectBlockUsage(block, now = Date.now()) {
  if (!block.isActive || block.isGap) return null
  const burn = calculateBurnRate(block)
  if (burn === null) return null
  const remainingMinutes = Math.round((block.endTime - now) / 60000)
  const tokens = totalTokens(block) + burn.tokensPerMinute * remainingMinutes
  const cost = block.cost + (burn.costPerHour / 60) * remainingMinutes
  return {
    totalTokens: Math.round(tokens),
    totalCost: Math.round(cost * 100) / 100,
    remainingMinutes: Math.max(0, remainingMinutes),
  }
}

function blockJson(block, now) {
  const burnRate = block.isActive ? calculateBurnRate(block) : null
  const projection = block.isActive ? projectBlockUsage(block, now) : null
  return {
    id: block.id,
    startTime: iso(block.startTime),
    endTime: iso(block.endTime),
    actualEndTime: block.actualEndTime === null ? null : iso(block.actualEndTime),
    isActive: block.isActive,
    isGap: block.isGap,
    entries: block.entries.length,
    tokenCounts: { ...block.tokenCounts },
    totalTokens: totalTokens(block),
    costUSD: block.cost,
    models: block.models,
    burnRate,
    projection,
  }
}

/** 按块起始时间的本地日期过滤（与 ccusage filter_blocks_by_date 对齐）。 */
export function filterBlocksByDate(blocks, { since, until, timeZone } = {}) {
  if (since === undefined && until === undefined) return blocks
  return blocks.filter((block) => {
    const key = dateKey(block.startTime, timeZone)
    if (since !== undefined && key < since) return false
    if (until !== undefined && key > until) return false
    return true
  })
}

export function buildBlocks(entries, { timeZone, sessionHours = DEFAULT_SESSION_HOURS, now = Date.now() } = {}) {
  const blocks = identifySessionBlocks(entries, { sessionHours, now })
  return blocks.map((block) => blockJson(block, now))
}

/** 供 UI 使用：附带每块时长与燃尽信息。 */
export function blocksWithMeta(entries, options = {}) {
  const now = options.now ?? Date.now()
  const blocks = identifySessionBlocks(entries, { sessionHours: options.sessionHours, now })
  return blocks.map((block) => {
    const usage = block.entries.reduce((acc, entry) => sumUsageInto(acc, entry.usage), emptyUsage())
    const delta = (block.actualEndTime ?? now) - block.startTime
    return {
      ...blockJson(block, now),
      durationMinutes: Math.max(0, Math.round(delta / 60000)),
      usage,
      tokens: sumUsage(usage),
    }
  })
}
