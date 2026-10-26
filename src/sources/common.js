/**
 * 适配器共享的小工具：token 桶与聚合时的累加。
 *
 * 所有 source 最终都产出同一种 entry 结构（见 README 的“数据模型”），
 * 聚合/报表层只认这个结构。
 */

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

/** 给出 entry 的去重 token 总数（各桶之和）。 */
export function finalizeEntry(entry) {
  entry.totalTokens = sumUsage(entry.usage)
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
