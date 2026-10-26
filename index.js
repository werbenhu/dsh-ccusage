/**
 * dsh-ccusage —— 把 ccusage 的用量报表能力做成 DeepSeek Harness 插件。
 *
 * Host 侧只做三件事：
 *   1. 把插件配置（timezone/sources/costMode/...）规范化；
 *   2. 用 src/report.js 扫描 Claude Code / Codex / OpenCode / Kimi / Grok / pi 的本地日志并聚合；
 *   3. 通过同源 HTTP 路由把报表暴露给面板（client.js）。
 *
 * 扫描结果按文件 mtime+size 缓存（src/cache.js），报表结果再按查询条件做短 TTL 缓存，
 * 因此面板刷新通常只需要几十毫秒。
 */

import { runReport, SOURCE_NAMES } from './src/report.js'
import { pricingStats } from './src/pricing.js'
import { normalizeTimeZone, systemTimeZone } from './src/time.js'
import { clearFileCache, fileCacheStats } from './src/cache.js'

export const name = 'dsh-ccusage'
export const version = '0.1.0'

const ROUTE_PREFIX = '/api/dsh-ccusage'
const DEFAULT_CACHE_TTL_MS = 30_000

const DEFAULTS = {
  timezone: '',
  sources: [...SOURCE_NAMES],
  costMode: 'auto',
  weekStart: 'monday',
  sessionHours: 5,
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  claudeDirs: [],
  codexDirs: [],
  opencodeDirs: [],
  kimiDirs: [],
  grokDirs: [],
  piDirs: [],
  dshDirs: [],
  pricing: {},
}

function asArray(value) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item !== '')
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter((item) => item !== '')
  return []
}

function asNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

/** 把插件配置（cordis.patch.yml 的 config）规范成 runReport 认识的结构。 */
export function normalizeConfig(rawConfig) {
  const input = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const sources = asArray(input.sources)
  const timezone = typeof input.timezone === 'string' && input.timezone.trim() !== ''
    ? normalizeTimeZone(input.timezone.trim())
    : systemTimeZone()
  return {
    timezone,
    sources: sources.length > 0 ? sources : [...DEFAULTS.sources],
    costMode: ['auto', 'calculate', 'display'].includes(input.costMode) ? input.costMode : DEFAULTS.costMode,
    weekStart: input.weekStart === 'sunday' ? 'sunday' : 'monday',
    sessionHours: asNumber(input.sessionHours, DEFAULTS.sessionHours) || DEFAULTS.sessionHours,
    cacheTtlMs: asNumber(input.cacheTtlMs, DEFAULTS.cacheTtlMs),
    claudeDirs: asArray(input.claudeDirs),
    codexDirs: asArray(input.codexDirs),
    opencodeDirs: asArray(input.opencodeDirs),
    kimiDirs: asArray(input.kimiDirs),
    grokDirs: asArray(input.grokDirs),
    piDirs: asArray(input.piDirs),
    dshDirs: asArray(input.dshDirs),
    pricing: input.pricing !== null && typeof input.pricing === 'object' ? input.pricing : {},
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function originPort(url) {
  if (url.port !== '') return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

/** 只接受 DSH 页面发起的同源请求，避免其它网页借浏览器读本机日志。 */
export function isTrustedRequest(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const url = new URL(origin)
    if (url.protocol === 'dsh-app:') return true
    if (!LOOPBACK_HOSTS.has(url.hostname)) return false
    const hostHeader = req.headers.host
    if (typeof hostHeader !== 'string' || hostHeader === '') return true
    const requestUrl = new URL(`http://${hostHeader}`)
    const requestPort = requestUrl.port === '' ? '80' : requestUrl.port
    return originPort(url) === requestPort
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readQuery(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

function first(query, ...names) {
  for (const name of names) {
    const value = query.get(name)
    if (value !== null && value !== '') return value
  }
  return undefined
}

/** 合并插件配置与本次请求的查询参数。 */
function resolveOptions(config, query) {
  const options = { ...config }
  const timezone = first(query, 'timezone', 'tz')
  if (timezone !== undefined) options.timezone = normalizeTimeZone(timezone)
  const costMode = first(query, 'costMode', 'mode')
  if (costMode !== undefined && ['auto', 'calculate', 'display'].includes(costMode)) options.costMode = costMode
  const sources = first(query, 'sources', 'source')
  if (sources !== undefined) options.sources = asArray(sources)
  const weekStart = first(query, 'weekStart')
  if (weekStart === 'sunday' || weekStart === 'monday') options.weekStart = weekStart
  const sessionHours = first(query, 'sessionHours')
  if (sessionHours !== undefined) options.sessionHours = asNumber(sessionHours, config.sessionHours)
  const last = first(query, 'last')
  if (last !== undefined) options.last = last
  const since = first(query, 'since')
  if (since !== undefined) options.since = since
  const until = first(query, 'until')
  if (until !== undefined) options.until = until
  const project = first(query, 'project')
  if (project !== undefined) options.project = project
  const agent = first(query, 'agent')
  if (agent !== undefined) options.agent = agent
  return options
}

function cacheKey(options) {
  return JSON.stringify({
    timezone: options.timezone,
    sources: options.sources,
    costMode: options.costMode,
    weekStart: options.weekStart,
    sessionHours: options.sessionHours,
    last: options.last ?? null,
    since: options.since ?? null,
    until: options.until ?? null,
    project: options.project ?? null,
    agent: options.agent ?? null,
  })
}

function pickSections(report, query) {
  const raw = first(query, 'sections')
  if (raw === undefined) return report
  const wanted = new Set(asArray(raw).map((item) => item.toLowerCase()))
  if (wanted.size === 0) return report
  const out = { ...report }
  for (const section of ['daily', 'weekly', 'monthly', 'session', 'blocks']) {
    if (!wanted.has(section)) delete out[section]
  }
  return out
}

/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} rawConfig cordis.patch.yml 里的 config
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const logger = ctx.logger ?? undefined
  const reportCache = new Map()

  async function getReport(options) {
    const key = cacheKey(options)
    const now = Date.now()
    const cached = reportCache.get(key)
    if (cached !== undefined && cached.expires > now) return cached.promise
    const promise = runReport(options).catch((error) => {
      reportCache.delete(key)
      throw error
    })
    reportCache.set(key, { expires: now + Math.max(0, options.cacheTtlMs), promise })
    // 清掉过期项，避免查询条件变化时无限增长。
    for (const [cacheKeyValue, entry] of reportCache) {
      if (entry.expires <= now) reportCache.delete(cacheKeyValue)
    }
    return promise
  }

  async function handleReport(req, res) {
    const query = readQuery(req)
    const options = resolveOptions(config, query)
    if (options.sources.length === 0) options.sources = [...config.sources]
    const started = Date.now()
    const report = await getReport(options)
    const body = pickSections(report, query)
    body.metadata = {
      ...body.metadata,
      durationMs: Date.now() - started,
      cache: fileCacheStats(),
      pricing: pricingStats(),
    }
    sendJson(res, 200, body)
  }

  async function handleMeta(req, res) {
    sendJson(res, 200, {
      name,
      version,
      timezone: config.timezone,
      weekStart: config.weekStart,
      sessionHours: config.sessionHours,
      costMode: config.costMode,
      sources: config.sources,
      availableSources: SOURCE_NAMES,
      cacheTtlMs: config.cacheTtlMs,
      cache: fileCacheStats(),
      pricing: pricingStats(),
    })
  }

  async function handleRefresh(req, res) {
    clearFileCache()
    reportCache.clear()
    sendJson(res, 200, { ok: true, clearedAt: new Date().toISOString() })
  }

  async function route(req, res) {
    try {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const action = path.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
      const method = (req.method ?? 'GET').toUpperCase()

      if (action === '' || action === 'report') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        return await handleReport(req, res)
      }
      if (action === 'meta' || action === 'status') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' })
        return await handleMeta(req, res)
      }
      if (action === 'refresh') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
        return await handleRefresh(req, res)
      }
      return sendJson(res, 404, { error: 'not_found', path })
    } catch (error) {
      logger?.warn?.(`[dsh-ccusage] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'report_failed', message: error instanceof Error ? error.message : String(error) })
      } else {
        res.end()
      }
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: route }),
      'ccusage: HTTP 路由',
    )
    logger?.info?.(`[dsh-ccusage] 报表路由已注册：${ROUTE_PREFIX}`)
  })

  // 面板首次打开时预热一次，后续请求直接命中缓存。
  setTimeout(() => {
    getReport(config).catch((error) => {
      logger?.warn?.(`[dsh-ccusage] 预热失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }, 1_500).unref?.()
}

export default { name, version, apply }
