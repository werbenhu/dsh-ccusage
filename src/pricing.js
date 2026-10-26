/**
 * 价格表：把 models.dev 快照（随 ccusage 仓库分发）归一化成「模型名 → 单价」。
 *
 * 快照里同一个模型会有很多带 provider 前缀的副本（`anthropic/claude-...`、
 * `azure/gpt-...`），这里只保留一份规范条目：优先不带前缀的原名，其次按
 * 模型作者的可信度挑选。价格单位是「每百万 token」。
 *
 * ccusage 自带的 LiteLLM 快照拿不到（仓库里只有 models.dev 快照），所以这里
 * 用 models.dev 作为基础价；缺失缓存价时按 ccusage 的默认倍率补：
 *   cache write = input × 1.25，cache read = input × 0.1。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRICING_FILE = join(HERE, '..', 'data', 'models-dev-pricing.json')

/** 作者前缀可信度：这些前缀代表模型原厂或官方托管价。 */
const OWNER_SCORE = new Map([
  ['anthropic', 52],
  ['openai', 52],
  ['google', 50],
  ['deepseek', 50],
  ['xai', 50],
  ['moonshotai', 48],
  ['zai', 46],
  ['zhipuai', 46],
  ['qwen', 44],
  ['alibaba', 44],
  ['minimax', 44],
  ['minimaxai', 44],
  ['mistral', 40],
  ['meta', 40],
  ['cohere', 38],
  ['meta-llama', 38],
  ['nvidia', 34],
  ['amazon', 34],
  ['microsoft', 34],
  ['bytedance', 30],
  ['tencent', 30],
  ['baidu', 30],
])

const PROVIDER_PREFIX_SCORE = new Map([
  ['anthropic', 22],
  ['openai', 22],
  ['google', 20],
  ['deepseek', 20],
  ['xai', 20],
  ['moonshotai', 18],
  ['zai', 18],
  ['alibaba', 16],
  ['minimax', 16],
  ['mistral', 12],
])

/** 这些后缀表示推理强度/服务等级，价格通常仍以基础模型为准。 */
const VARIANT_SUFFIXES = ['-fast', '-flex', '-pro', '-high', '-low', '-thinking', '-reasoning']

let store

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** 只保留小数点后足够精度的中间价，避免把 0.0000001 这类值抹掉。 */
function normalizeName(raw) {
  if (typeof raw !== 'string') return ''
  let name = raw.trim().toLowerCase()
  if (name === '') return ''
  const slash = name.lastIndexOf('/')
  if (slash >= 0) name = name.slice(slash + 1)
  // models.dev 的 Cloudflare 键形如 @cf/zai-org/glm-5.2，上面取最后一段已够；
  // 少数键带版本修饰后缀，归一化时保留，交给查找阶段再降级。
  return name
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return []
  const out = []
  for (const tier of tiers) {
    const size = toNumber(tier?.tier?.size)
    if (!size) continue
    out.push({
      size,
      input: toNumber(tier.input),
      output: toNumber(tier.output),
      cacheRead: toNumber(tier.cache_read),
      cacheWrite: toNumber(tier.cache_write),
    })
  }
  out.sort((a, b) => a.size - b.size)
  return out
}

function makeRate(cost, limit) {
  const input = toNumber(cost?.input)
  const output = toNumber(cost?.output)
  if (input === undefined && output === undefined) return undefined
  return {
    input: input ?? output,
    output: output ?? input,
    cacheRead: toNumber(cost?.cache_read),
    cacheWrite: toNumber(cost?.cache_write),
    tiers: normalizeTiers(cost?.tiers),
    contextLimit: toNumber(limit?.context),
  }
}

/**
 * 给候选条目打分：原名 > 原厂前缀 > 云厂商前缀；缓存价齐全的略优先。
 * 分数相同则保留先出现的（快照顺序稳定）。
 */
function scoreCandidate(key, rate) {
  let score = 0
  if (!key.includes('/')) score += 60
  const parts = key.toLowerCase().split('/')
  if (parts.length > 1) {
    const owner = parts[parts.length - 2]
    score += OWNER_SCORE.get(owner) ?? 0
    score += PROVIDER_PREFIX_SCORE.get(parts[0]) ?? 0
    if (parts[0] === 'auto') score += 8
  }
  if (rate.cacheRead !== undefined) score += 4
  if (rate.cacheWrite !== undefined) score += 3
  if (rate.tiers.length > 0) score += 1
  if (rate.contextLimit !== undefined) score += 1
  return score
}

function buildStore() {
  const raw = JSON.parse(readFileSync(PRICING_FILE, 'utf8'))
  const table = new Map()
  const source = new Map()
  for (const [key, value] of Object.entries(raw)) {
    const rate = makeRate(value?.cost, value?.limit)
    if (rate === undefined) continue
    const name = normalizeName(key)
    if (name === '' || name.length < 2) continue
    const score = scoreCandidate(key, rate)
    const previous = table.get(name)
    if (previous === undefined || score > previous.score) {
      table.set(name, { ...rate, score, id: key })
      source.set(name, key)
    }
  }
  return { table, source, count: table.size, rawCount: Object.keys(raw).length }
}

export function loadPricing() {
  if (store === undefined) store = buildStore()
  return store
}

/** 供测试/诊断：价格表条目数。 */
export function pricingStats() {
  const { count, rawCount } = loadPricing()
  return { models: count, rawEntries: rawCount }
}

function rateFor(name) {
  const { table } = loadPricing()
  return table.get(name)
}

/**
 * 查找模型价格。先精确匹配，再依次尝试：
 *   1. 去掉 `-fast` / `-high` 之类的变体后缀；
 *   2. 去掉 Anthropic 风格的 `-YYYYMMDD` 日期后缀；
 *   3. 前缀模糊匹配（`claude-opus-5-5` → `claude-opus-5-5-20260101`）。
 */
/**
 * models.dev 快照里个别模型只收录了第三方加价版（同一个 key 归一化后价差 2-3 倍），
 * 而 ccusage 用的是 LiteLLM 的官方价。这里固定成参考实现实际使用的单价。
 */
const RATE_OVERRIDES = new Map([
  // Kimi Code 的 kimi-for-coding 走 k2.6 的官方价（0.95/4/0.16），
  // 快照里的 moonshotai/Kimi-K2.6（2.205/5.49/0.441）不是这一档。
  // 用归一化后的短名做 key，这样 moonshot/kimi-k2.6、Kimi-K2.6 都能命中。
  ['kimi-k2.6', { input: 0.95, output: 4, cacheRead: 0.16 }],
])

export function findRate(model) {
  if (typeof model !== 'string' || model.trim() === '') return undefined
  const base = normalizeName(model)
  if (base === '') return undefined

  const overridden = RATE_OVERRIDES.get(base)
  if (overridden !== undefined) {
    return { ...overridden, tiers: [], matched: base, overridden: true }
  }

  // 免费模型（如 glm-4.7-free）在价格快照里通常没有条目；按 0 价处理，
  // 否则会在「未定价模型」里制造噪音，而它们本来就不产生费用。
  if (/-free$/.test(base)) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: [], matched: base, free: true }
  }

  const direct = rateFor(base)
  if (direct !== undefined) return { ...direct, matched: base }

  let stripped = base
  for (const suffix of VARIANT_SUFFIXES) {
    if (stripped.endsWith(suffix)) {
      stripped = stripped.slice(0, -suffix.length)
      const hit = rateFor(stripped)
      if (hit !== undefined) return { ...hit, matched: stripped }
    }
  }

  const dated = stripped.replace(/-20\d{6}$/, '')
  if (dated !== stripped) {
    const hit = rateFor(dated)
    if (hit !== undefined) return { ...hit, matched: dated }
  }

  const { table } = loadPricing()
  let best
  for (const [name, rate] of table) {
    if (!name.startsWith(stripped)) continue
    const rest = name.slice(stripped.length)
    if (rest !== '' && !/^[-.:]/.test(rest)) continue
    if (best === undefined || name.length < best.matched.length) best = { ...rate, matched: name }
  }
  return best
}

/**
 * 按 ccusage 的规则计算一次请求的费用（美元）。
 *
 * @param {object} usage
 * @param {number} usage.inputTokens 未命中缓存的输入 token
 * @param {number} usage.outputTokens 输出 token
 * @param {number} usage.cacheCreation5mTokens 5 分钟缓存写入
 * @param {number} usage.cacheCreation1hTokens 1 小时缓存写入
 * @param {number} usage.cacheReadTokens 缓存读取
 * @param {object} rate findRate 的返回值
 */
export function calculateCost(usage, rate) {
  if (rate === undefined) return 0
  const input = Math.max(0, usage.inputTokens ?? 0)
  // reasoning token 按输出价计费，但不进入 outputTokens 桶。
  const output = Math.max(0, usage.outputTokens ?? 0) + Math.max(0, usage.extraTokens ?? 0)
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0)
  const cc5m = Math.max(0, usage.cacheCreation5mTokens ?? 0)
  const cc1h = Math.max(0, usage.cacheCreation1hTokens ?? 0)
  // 非 Claude 源以及 Claude 未拆 5m/1h 的记录只填 cacheCreationTokens。
  // 已计入 5m/1h 的部分不再重复计价。
  const genericWrite = Math.max(0, (usage.cacheCreationTokens ?? 0) - cc5m - cc1h)

  let rates = rate
  if (rate.tiers !== undefined && rate.tiers.length > 0) {
    const context = input + cacheRead + cc5m + cc1h + genericWrite
    let selected
    for (const tier of rate.tiers) {
      if (context > tier.size) selected = tier
    }
    if (selected !== undefined) rates = selected
  }

  const inputRate = rates.input ?? 0
  const outputRate = rates.output ?? 0
  const cacheReadRate = rates.cacheRead ?? inputRate * 0.1
  const cacheWriteRate = rates.cacheWrite ?? inputRate * 1.25

  const cost =
    (input * inputRate +
      output * outputRate +
      cacheRead * cacheReadRate +
      cc5m * cacheWriteRate +
      // Anthropic 的 1 小时缓存按输入价的 2 倍计。
      cc1h * inputRate * 2 +
      genericWrite * cacheWriteRate) /
    1_000_000

  return Number.isFinite(cost) && cost > 0 ? cost : 0
}

/** 模型名标准化，供聚合层合并大小写/前缀不同的同一模型。 */
export function canonicalModelName(model) {
  if (typeof model !== 'string') return 'unknown'
  const trimmed = model.trim()
  return trimmed === '' ? 'unknown' : trimmed
}

export const __internal = { normalizeName, scoreCandidate, buildStore }
