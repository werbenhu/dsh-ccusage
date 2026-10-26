/**
 * 报表编排：扫描 sources → 过滤 → daily/weekly/monthly/session/blocks 五张表。
 */

import { loadPricing } from './pricing.js'
import { resolveClaudeRoots, scanClaude } from './sources/claude.js'
import { resolveCodexRoots, scanCodex } from './sources/codex.js'
import { resolveOpenCodeRoots, scanOpenCode } from './sources/opencode.js'
import { resolveKimiRoots, scanKimi } from './sources/kimi.js'
import { resolveGrokRoots, scanGrok } from './sources/grok.js'
import { resolvePiRoots, scanPi } from './sources/pi.js'
import { resolveDshRoots, scanDsh } from './sources/dsh.js'
import { summarize, summarizeSessions, totalize } from './aggregate.js'
import { buildBlocks, filterBlocksByDate, DEFAULT_SESSION_HOURS } from './blocks.js'
import { dateKey, normalizeTimeZone, resolveRange, weekStartDay } from './time.js'

export const SOURCE_NAMES = ['claude', 'codex', 'opencode', 'kimi', 'grok', 'pi', 'dsh']

const SCANNERS = {
  claude: { resolve: resolveClaudeRoots, scan: scanClaude, key: 'claudeDirs' },
  codex: { resolve: resolveCodexRoots, scan: scanCodex, key: 'codexDirs' },
  opencode: { resolve: resolveOpenCodeRoots, scan: scanOpenCode, key: 'opencodeDirs' },
  kimi: { resolve: resolveKimiRoots, scan: scanKimi, key: 'kimiDirs' },
  grok: { resolve: resolveGrokRoots, scan: scanGrok, key: 'grokDirs' },
  pi: { resolve: resolvePiRoots, scan: scanPi, key: 'piDirs' },
  dsh: { resolve: resolveDshRoots, scan: scanDsh, key: 'dshDirs' },
}

/** 把配置里的 sources 规范成数组；'all' 展开为全部。 */
export function normalizeSources(value) {
  if (value === undefined || value === null) return [...SOURCE_NAMES]
  const list = Array.isArray(value) ? value : String(value).split(',')
  const out = []
  for (const raw of list) {
    const name = String(raw).trim().toLowerCase()
    if (name === '' || name === 'all') {
      if (name === 'all') return [...SOURCE_NAMES]
      continue
    }
    if (SOURCE_NAMES.includes(name) && !out.includes(name)) out.push(name)
  }
  return out.length > 0 ? out : [...SOURCE_NAMES]
}

/**
 * 扫描所有选中的 source。
 * @returns {Promise<{entries:Array, sources:Record<string,{entries:number,roots:string[]}>, warnings:string[]}>}
 */
export async function collectEntries(config = {}, pricing = loadPricing()) {
  const sources = normalizeSources(config.sources)
  const entries = []
  const scanned = {}
  const warnings = []
  for (const name of sources) {
    const scanner = SCANNERS[name]
    let roots = []
    try {
      roots = await scanner.resolve(config[scanner.key])
      const result = await scanner.scan({ roots, costMode: config.costMode ?? 'auto', pricing })
      const list = Array.isArray(result) ? result : (result.entries ?? [])
      entries.push(...list)
      scanned[name] = { entries: list.length, files: result.files, roots }
    } catch (error) {
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      scanned[name] = { entries: 0, roots }
    }
  }
  entries.sort((a, b) => a.timestamp - b.timestamp)
  return { entries, sources: scanned, warnings }
}

const MAX_SESSION_HOURS = 1_000_000

/** 校验计费块时长，避免极大有限数在 Date/时长换算中变成 Infinity。 */
export function normalizeSessionHours(value, fallback = DEFAULT_SESSION_HOURS) {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_SESSION_HOURS ? hours : fallback
}

/** 过滤：时间范围（本地日期）、项目名、agent。 */
export function filterEntries(entries, { since, until, project, agent, timeZone } = {}) {
  const projectQuery = typeof project === 'string' && project.trim() !== '' ? project.trim().toLowerCase() : undefined
  const agents = Array.isArray(agent) ? agent : typeof agent === 'string' && agent !== '' ? agent.split(',') : undefined
  return entries.filter((entry) => {
    if (since !== undefined || until !== undefined) {
      // 显式时区必须优先于其他调用者留下的 date；未指定时区时保留原有快速路径。
      const day = timeZone === undefined
        ? (entry.date ?? dateKey(entry.timestamp))
        : dateKey(entry.timestamp, timeZone)
      if (since !== undefined && day < since) return false
      if (until !== undefined && day > until) return false
    }
    if (projectQuery !== undefined) {
      const haystack = `${entry.projectPath ?? ''} ${entry.project ?? ''}`.toLowerCase()
      if (!haystack.includes(projectQuery)) return false
    }
    if (agents !== undefined && !agents.includes(entry.agent)) return false
    return true
  })
}

/**
 * 生成完整报表。
 * @param {Array} entries 已 finalize 的 entry
 * @param {{timeZone?:string, weekStart?:'monday'|'sunday', sessionHours?:number, since?:string, until?:string, now?:number, sources?:string[], warnings?:string[]}} options
 */
export function buildReport(entries, options = {}) {
  const timeZone = normalizeTimeZone(options.timeZone)
  const weekStart = options.weekStart === 'sunday' ? 'sunday' : 'monday'
  const now = options.now ?? Date.now()
  const since = options.since
  const until = options.until

  // entry 会被缓存并跨查询复用，不能把本次查询的派生日期写回原对象。
  // 每次只计算一次本地日期，过滤和三种分组共享同一个值。
  const datedEntries = []
  for (const entry of entries) {
    if (!Number.isFinite(entry.timestamp)) continue
    let date
    try {
      date = dateKey(entry.timestamp, timeZone)
    } catch {
      continue
    }
    datedEntries.push(entry.date === date ? entry : { ...entry, date })
  }
  const filtered = filterEntries(datedEntries, { since, until, project: options.project, agent: options.agent })

  const daily = summarize(filtered, (entry) => entry.date)
  const weekly = summarize(filtered, (entry) => weekStartDay(entry.date, weekStart))
  const monthly = summarize(filtered, (entry) => entry.date.slice(0, 7))
  const session = summarizeSessions(filtered)
  // ccusage 的 blocks 报表只统计 Claude Code —— 5 小时计费窗口是 Claude 订阅的概念。
  // 若把 Codex/OpenCode 也算进来，历史块会膨胀到几百个且与 ccusage 输出不一致。
  const claudeEntries = filtered.filter((entry) => entry.agent === 'claude')
  const blocks = filterBlocksByDate(
    buildBlocks(claudeEntries, { timeZone, sessionHours: normalizeSessionHours(options.sessionHours ?? DEFAULT_SESSION_HOURS), now }),
    { since, until, timeZone },
  )

  return {
    daily,
    weekly,
    monthly,
    session,
    blocks,
    totals: totalize(filtered),
    metadata: {
      timeZone,
      weekStart,
      generatedAt: new Date(now).toISOString(),
      entries: filtered.length,
      sources: options.sources ?? SOURCE_NAMES,
      since,
      until,
      warnings: options.warnings ?? [],
    },
  }
}

/** 一次性执行：扫描 + 生成报表。 */
export async function runReport(config = {}) {
  const timeZone = normalizeTimeZone(config.timezone)
  const range = resolveRange(config, timeZone, config.now ?? Date.now())
  const basePricing = loadPricing()
  const pricing = config.pricing !== null && typeof config.pricing === 'object'
    ? { ...basePricing, ...config.pricing }
    : basePricing
  const collected = await collectEntries(config, pricing)
  const report = buildReport(collected.entries, {
    timeZone,
    weekStart: config.weekStart,
    sessionHours: config.sessionHours,
    since: range.since,
    until: range.until,
    now: config.now,
    sources: normalizeSources(config.sources),
    warnings: collected.warnings,
    project: config.project,
    agent: config.agent,
  })
  report.metadata.sourcesDetail = collected.sources
  return report
}

export { summarize, summarizeSessions, totalize }
