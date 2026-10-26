import test from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, isTrustedRequest, normalizeConfig, name, version } from '../index.js'
import { buildReport, filterEntries, normalizeSources, summarizeSessions } from '../src/report.js'
import { resolveDshRoots, scanDsh } from '../src/sources/dsh.js'
import { loadPricing } from '../src/pricing.js'
import { buildBlocks, DEFAULT_SESSION_HOURS } from '../src/blocks.js'
import { calculateCost, findRate } from '../src/pricing.js'
import { dateKey, resolveRange, systemTimeZone, weekStartDay } from '../src/time.js'
import { finalizeEntry, lastPathSegment } from '../src/sources/common.js'

/**
 * 取 RUNTIME 侧的绝对路径。源码里用 join() 拼路径，join 按运行平台选分隔符，
 * 所以 fixture 路径也必须同源，才能在任何平台上命中。
 * （不能用 '/fixtures/...' 硬编码：Windows 下 join 得到反斜杠，路径对不上。）
 */
const here = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, '')
const FIXTURE_CLAUDE = [here, 'fixtures', 'claude'].join(sep)

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    end(chunk) { this.body += chunk ?? ''; this.writableEnded = true; this.headersSent = true },
    get json() { return JSON.parse(this.body) },
  }
}

function mount(config) {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {} },
    inject(_names, callback) {
      callback({
        webServer: { register(route) { routes.push(route); return () => {} } },
        effect(fn) { return fn() },
      })
    },
  }
  apply(ctx, config)
  assert.equal(routes.length, 1)
  return routes[0]
}

async function request(route, url, { method = 'GET', origin } = {}) {
  const req = { url, method, headers: origin === undefined ? {} : { origin } }
  const res = fakeResponse()
  await route.handler(req, res)
  return res
}

test('filterEntries 未给时区时按系统时区取日期', () => {
  // 只有 01-05T00:30Z 这种“跨日”时刻才能区分时区：UTC 归 01-05，America/Los_Angeles 归 01-04。
  const timestamp = Date.parse('2026-01-05T00:30:00Z')
  const date = dateKey(timestamp, systemTimeZone())
  const entries = [{ agent: 'claude', timestamp }]
  assert.equal(filterEntries(entries, { since: date, until: date }).length, 1)
  const other = date === '2026-01-05' ? '2026-01-04' : '2026-01-05'
  assert.equal(filterEntries(entries, { since: other, until: other }).length, 0)
})

test('inject 不能被重复注册', () => {
  let injected = 0
  const ctx = {
    logger: { info() {}, warn() {} },
    inject(_names, callback) {
      injected += 1
      callback({ webServer: { register() { return () => {} } }, effect(fn) { return fn() } })
    },
  }
  apply(ctx, { sources: ['claude'], cacheTtlMs: 0 })
  assert.equal(injected, 1)
})

test('HTTP：sources=all 与非法 sessionHours 都按未指定处理', async () => {
  // sources=all 会扫真实家目录（耗时且依赖本机数据），这里只验证参数归一化：
  // 非法 sessionHours 回退成配置值，sources 走 normalizeSources 而不是字面量 ['all']。
  assert.deepEqual(normalizeSources('all'), ['claude', 'codex', 'opencode', 'kimi', 'grok', 'pi', 'dsh'])
  const route = mount({ sources: ['claude'], claudeDirs: [FIXTURE_CLAUDE], cacheTtlMs: 0, timezone: 'UTC' })
  const response = await request(route, '/api/dsh-ccusage/report?last=3650&sessionHours=abc')
  assert.equal(response.statusCode, 200)
  const payload = response.json
  assert.equal(payload.metadata.timeZone, 'UTC')
  assert.ok(Array.isArray(payload.daily))
  assert.ok(payload.daily.length >= 1)
  assert.ok(Array.isArray(payload.blocks))
})

test('package metadata', () => {
  assert.equal(name, 'dsh-ccusage')
  assert.match(version, /^\d+\.\d+\.\d+/)
})

test('normalizeSources 接受 all / 逗号列表', () => {
  const all = ['claude', 'codex', 'opencode', 'kimi', 'grok', 'pi', 'dsh']
  assert.deepEqual(normalizeSources('all'), all)
  assert.deepEqual(normalizeSources('claude,codex'), ['claude', 'codex'])
  assert.deepEqual(normalizeSources(['nope']), all)
})

test('normalizeConfig 补齐默认值', () => {
  const config = normalizeConfig({ timezone: 'Asia/Shanghai', sources: 'claude', costMode: 'bad' })
  assert.equal(config.timezone, 'Asia/Shanghai')
  assert.deepEqual(config.sources, ['claude'])
  assert.equal(config.costMode, 'auto')
  assert.equal(config.weekStart, 'monday')
  assert.equal(config.sessionHours, 5)
})

test('isTrustedRequest 拒绝跨站 Origin', () => {
  assert.equal(isTrustedRequest({ headers: {} }), true)
  assert.equal(isTrustedRequest({ headers: { origin: 'http://127.0.0.1:38876' } }), true)
  assert.equal(isTrustedRequest({ headers: { origin: 'dsh-app://app' } }), true)
  assert.equal(isTrustedRequest({ headers: { origin: 'https://evil.example' } }), false)
  assert.equal(isTrustedRequest({ headers: { 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isTrustedRequest({
    headers: { origin: 'http://localhost:9999', host: '127.0.0.1:55477' },
  }), false)
  assert.equal(isTrustedRequest({
    headers: { origin: 'http://127.0.0.1:55477', host: '127.0.0.1:55477' },
  }), true)
  assert.equal(isTrustedRequest({
    headers: { origin: 'http://localhost:55477', host: '127.0.0.1:55477' },
  }), true)
})

test('日期与时区工具', () => {
  const timestamp = Date.parse('2026-01-05T03:00:00Z')
  assert.equal(dateKey(timestamp, 'UTC'), '2026-01-05')
  assert.equal(weekStartDay('2026-01-05', 'monday'), '2026-01-05')
  assert.equal(weekStartDay('2026-01-05', 'sunday'), '2026-01-04')
  const range = resolveRange({ last: '7' }, 'UTC', Date.parse('2026-01-10T12:00:00Z'))
  assert.equal(range.until, '2026-01-10')
  assert.equal(range.since, '2026-01-04')
})

test('价格表能命中本机主力模型', () => {
  assert.ok(findRate('claude-opus-5-5'))
  assert.ok(findRate('gpt-5.5'))
  assert.ok(findRate('qwen3.7-max'))
  const cost = calculateCost(
    { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 },
    findRate('gpt-5.5'),
  )
  assert.ok(cost > 0)
})

test('buildReport 聚合一天的数据', () => {
  const usage = { inputTokens: 60, outputTokens: 40, cacheCreationTokens: 0, cacheReadTokens: 0, extraTokens: 0 }
  const entries = [
    { agent: 'claude', timestamp: Date.parse('2026-01-05T10:00:00Z'), totalTokens: 100, cost: 0.5, usage, model: 'claude-opus-5-5', project: 'demo', projectPath: 'E:/demo', sessionId: 's1' },
    { agent: 'codex', timestamp: Date.parse('2026-01-05T11:00:00Z'), totalTokens: 50, cost: 0.25, usage: { ...usage, inputTokens: 30, outputTokens: 20 }, model: 'gpt-5.5', project: 'demo', projectPath: 'E:/demo', sessionId: 's2' },
  ]
  const report = buildReport(entries, { timeZone: 'UTC', since: '2026-01-05', until: '2026-01-05' })
  assert.equal(report.daily.length, 1)
  assert.equal(report.daily[0].totalTokens, 150)
  assert.equal(report.daily[0].totalCost, 0.75)
  assert.equal(report.daily[0].modelsUsed.length, 2)
  const agentBreakdowns = report.daily[0].agentBreakdowns
  assert.equal(agentBreakdowns.length, 2)
  assert.deepEqual(agentBreakdowns.map((item) => item.agent).sort(), ['claude', 'codex'])
  assert.equal(agentBreakdowns.reduce((sum, item) => sum + item.totalTokens, 0), 150)
  assert.equal(report.totals.totalTokens, 150)
})

test('5 小时块：跨 5 小时切块并插入空档', () => {
  assert.equal(DEFAULT_SESSION_HOURS, 5)
  const usage = { inputTokens: 10, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, extraTokens: 0 }
  const base = Date.parse('2026-01-05T00:10:00Z')
  const entries = [
    { timestamp: base, usage, totalTokens: 10, cost: 0.1 },
    { timestamp: base + 60 * 60 * 1000, usage, totalTokens: 10, cost: 0.1 },
    { timestamp: base + 12 * 60 * 60 * 1000, usage, totalTokens: 10, cost: 0.1 },
  ]
  const blocks = buildBlocks(entries, { timeZone: 'UTC', now: base + 13 * 60 * 60 * 1000 })
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].startTime, '2026-01-05T00:00:00.000Z')
  assert.notEqual(blocks[0].isGap, true)
  assert.equal(blocks[1].isGap, true)
  assert.equal(blocks[2].entries, 1)
})

test('HTTP：report / meta / 404 / 403（离线 fixture）', async () => {
  const route = mount({ sources: ['claude'], claudeDirs: [FIXTURE_CLAUDE], cacheTtlMs: 0, timezone: 'UTC' })
  const report = await request(route, '/api/dsh-ccusage/report?last=3650')
  assert.equal(report.statusCode, 200)
  const payload = report.json
  assert.ok(Array.isArray(payload.daily))
  assert.ok(payload.daily.length >= 1)
  assert.ok(payload.totals)
  assert.equal(typeof payload.metadata.durationMs, 'number')

  const meta = await request(route, '/api/dsh-ccusage/meta')
  assert.equal(meta.statusCode, 200)
  assert.equal(meta.json.name, 'dsh-ccusage')

  const missing = await request(route, '/api/dsh-ccusage/none')
  assert.equal(missing.statusCode, 404)

  const forbidden = await request(route, '/api/dsh-ccusage/report', { origin: 'https://evil.example' })
  assert.equal(forbidden.statusCode, 403)
})

test('session 报表按费用降序', () => {
  const entries = [
    { agent: 'claude', timestamp: 1, totalTokens: 1, cost: 0.1, sessionId: 'a', model: 'x', usage: { inputTokens: 1 }, project: 'p' },
    { agent: 'claude', timestamp: 2, totalTokens: 1, cost: 0.9, sessionId: 'b', model: 'x', usage: { inputTokens: 1 }, project: 'p' },
    { agent: 'claude', timestamp: 3, totalTokens: 1, cost: 0.2, sessionId: 'b', model: 'x', usage: { inputTokens: 1 }, project: 'p' },
  ]
  const session = summarizeSessions(entries)
  assert.equal(session.length, 2)
  assert.equal(session[0].period, 'b')
  assert.equal(session[0].totalCost, 1.1)
})

test('YYYY-MM until 取月末', () => {
  const range = resolveRange({ since: '2026-02', until: '2026-02' }, 'UTC')
  assert.equal(range.since, '2026-02-01')
  assert.equal(range.until, '2026-02-28')
})

test('Kimi k2.6 覆盖价在归一化后命中', () => {
  assert.equal(findRate('kimi-k2.6').input, 0.95)
  assert.equal(findRate('moonshot/kimi-k2.6').input, 0.95)
  assert.equal(findRate('moonshotai/Kimi-K2.6').input, 0.95)
  assert.equal(findRate('kimi-k2.6').output, 4)
  assert.equal(findRate('kimi-k2.6').cacheRead, 0.16)
})

test('cacheCreationTokens 计入费用且不与 5m/1h 重复', () => {
  const rate = { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25, tiers: [] }
  assert.equal(calculateCost({
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 1_000_000,
  }, rate), 1.25)
  assert.equal(calculateCost({
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 1_000_000,
    cacheCreation5mTokens: 1_000_000,
  }, rate), 1.25)
  assert.equal(calculateCost({
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 1_000_000,
    cacheCreation5mTokens: 400_000,
    cacheCreation1hTokens: 600_000,
  }, rate), (400_000 * 1.25 + 600_000 * 2) / 1_000_000)
})

test('覆盖价 0 不算缺价', () => {
  const entry = {
    model: 'free-model',
    usage: { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, extraTokens: 0 },
  }
  finalizeEntry(entry, 'calculate', { overrides: { 'free-model': { input: 0, output: 0 } } })
  assert.equal(entry.cost, 0)
  assert.equal(entry.missingPricing, false)
})

test('monthly 按查询时区的日历月切片', () => {
  const usage = { inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, extraTokens: 0 }
  const entries = [{
    agent: 'claude',
    timestamp: Date.parse('2026-02-01T00:30:00Z'),
    totalTokens: 1,
    cost: 1,
    usage,
    model: 'x',
    project: 'p',
    sessionId: 's',
  }]
  const utc = buildReport(entries, { timeZone: 'UTC' })
  assert.equal(utc.monthly[0].period, '2026-02')
  const pacific = buildReport(entries, { timeZone: 'America/Los_Angeles' })
  assert.equal(pacific.monthly[0].period, '2026-01')
})

test('无效时间戳不进入报表', () => {
  const usage = { inputTokens: 1, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, extraTokens: 0 }
  const report = buildReport([
    { agent: 'claude', timestamp: Number.NaN, totalTokens: 1, cost: 1, usage, model: 'x', sessionId: 's' },
    { agent: 'claude', timestamp: Date.parse('2026-01-05T10:00:00Z'), totalTokens: 2, cost: 2, usage, model: 'x', sessionId: 's' },
  ], { timeZone: 'UTC' })
  assert.equal(report.daily.length, 1)
  assert.equal(report.totals.totalTokens, 2)
})

test('dsh source 解析会话事件并去重', async () => {
  const root = [here, 'fixtures', 'dsh'].join(sep)
  const roots = await resolveDshRoots([root])
  assert.deepEqual(roots, [root])
  const result = await scanDsh({ roots, costMode: 'auto', pricing: loadPricing() })
  assert.equal(result.files, 1)
  assert.equal(result.entries.length, 2)
  const [first, second] = result.entries
  assert.equal(first.sessionId, 'session-dsh-demo')
  assert.equal(first.project, 'ccusage')
  assert.equal(first.model, 'deepseek-flash')
  assert.equal(first.usage.inputTokens, 1000)
  assert.equal(first.usage.cacheReadTokens, 2000)
  assert.equal(second.pricingModel, 'deepseek-v4.1-flash')
  assert.equal(second.usage.cacheCreationTokens, 50)
  assert.equal(second.totalTokens, 200)
})

test('项目名兼容另一平台的路径分隔符', () => {
  // 会话里记录的 cwd 可能来自另一平台的机器，展示用的项目名不能只认本机分隔符。
  assert.equal(lastPathSegment('E:\\repo\\ccusage'), 'ccusage')
  assert.equal(lastPathSegment('E:\\repo\\ccusage\\'), 'ccusage')
  assert.equal(lastPathSegment('/home/me/ccusage'), 'ccusage')
  assert.equal(lastPathSegment('/home/me/ccusage/'), 'ccusage')
  assert.equal(lastPathSegment('ccusage'), 'ccusage')
  assert.equal(lastPathSegment(''), undefined)
  assert.equal(lastPathSegment('/'), undefined)
  assert.equal(lastPathSegment(undefined), undefined)
})
