/**
 * 适配器共享的小工具：token 桶、去重用的 token 总数、统一计费。
 *
 * 所有 source 最终都产出同一种 entry 结构（见 README 的“数据模型”），
 * 聚合/报表层只认这个结构。
 */

import { calculateCost, findRate } from '../pricing.js'

export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    // Codex 的 reasoning token 不属于 4 个标准桶，但计入 total 与输出价。
    extraTokens: 0,
  }
}

export function sumUsage(usage) {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.extraTokens ?? 0)
  )
}

export function saturatingSub(value, amount) {
  return Math.max(0, value - amount)
}

export function roundCost(value) {
  return Math.round(value * 1e12) / 1e12
}

/**
 * 解析单价：优先用配置里的覆盖价（单位同样是每百万 token），否则查内置价格表。
 * @param {string} model
 * @param {{overrides?:Record<string,object>}|undefined} pricing
 */
function overrideNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function rateFor(model, pricing) {
  const override = pricing?.overrides?.[model]
  if (override !== undefined && override !== null && typeof override === 'object') {
    const input = overrideNumber(override.input)
    const output = overrideNumber(override.output)
    if (input !== undefined || output !== undefined) {
      return {
        input: input ?? 0,
        output: output ?? 0,
        cacheRead: overrideNumber(override.cacheRead),
        cacheWrite: overrideNumber(override.cacheWrite),
        tiers: [],
        matched: model,
        overridden: true,
      }
    }
  }
  return findRate(model)
}

/**
 * 给 entry 补上费用与缺价标记。
 *
 * costMode 与 ccusage 一致：
 *   display   —— 只用日志里存的 costUSD，没有就是 0；
 *   auto      —— 有存价用存价，否则按 token 现算（默认）；
 *   calculate —— 一律按 token 现算。
 */
export function finalizeEntry(entry, costMode, pricing) {
  // pricingModel 用于「显示名 ≠ 价格表 key」的 source（如 Kimi 的 kimi-for-coding → moonshot/kimi-k2.6）。
  const rate = rateFor(entry.pricingModel ?? entry.model, pricing)
  const usage = entry.usage
  const computed = rate === undefined ? 0 : calculateCost(usage, rate)
  let cost
  if (costMode === 'display') cost = entry.storedCost ?? 0
  else if (costMode === 'calculate') cost = computed
  else cost = entry.storedCost ?? computed

  entry.cost = roundCost(cost)
  entry.totalTokens = sumUsage(usage)
  const hasTokens = entry.totalTokens > 0
  // 「缺价」指价格表里找不到模型，而不是费用刚好为 0：免费模型（-free）
  // 或 0 单价覆盖价都算已定价，不该出现在 unpricedModels 里。
  const priced = rate !== undefined
  entry.missingPricing =
    !priced &&
    hasTokens &&
    !(costMode === 'display') &&
    !(costMode === 'auto' && entry.storedCost !== undefined)
  return entry
}

/** 聚合时把多个 usage 累加到一个目标对象。 */
export function addUsage(target, usage) {
  target.inputTokens += usage.inputTokens ?? 0
  target.outputTokens += usage.outputTokens ?? 0
  target.cacheCreationTokens += usage.cacheCreationTokens ?? 0
  target.cacheReadTokens += usage.cacheReadTokens ?? 0
  target.cacheCreation5mTokens += usage.cacheCreation5mTokens ?? 0
  target.cacheCreation1hTokens += usage.cacheCreation1hTokens ?? 0
  target.extraTokens += usage.extraTokens ?? 0
  return target
}

/** 按时间升序排序（稳定排序，时间相同保留输入顺序）。 */
export function sortByTimestamp(entries) {
  return entries.slice().sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * 取路径的最后一段，同时兼容 `/` 与 `\` 两种分隔符。
 *
 * 会话里记录的 cwd 来自产生它的那台机器，可能是另一平台的写法
 * （例如在 POSIX 上读取 Windows 记录的 `E:\repo\ccusage`）。此时
 * `node:path` 的 `basename` 只认当前平台的分隔符，会返回整串路径；
 * 展示用的项目名因此需要自己切分。
 */
export function lastPathSegment(path) {
  if (typeof path !== 'string') return undefined
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '')
  if (segments.length === 0) return undefined
  return segments[segments.length - 1]
}
