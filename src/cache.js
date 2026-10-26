/**
 * 文件级解析缓存：同一文件（mtime + size 未变）只解析一次。
 *
 * Claude/Codex 的原始日志动辄上百 MB，但绝大多数文件在两次刷新之间不会变化；
 * 缓存解析结果（entry/event 数组）可以把重复查询从数秒降到几十毫秒。
 */

import { stat } from 'node:fs/promises'

const cache = new Map()

/**
 * @template T
 * @param {string} path
 * @param {() => Promise<T>} loader
 * @param {string} [variant] 额外区分维度（例如 Claude 的 root）
 * @returns {Promise<T>}
 */
export async function cachedByFile(path, loader, variant = '') {
  let info
  try {
    info = await stat(path)
  } catch {
    return loader()
  }
  const key = `${path}\u0000${variant}`
  const signature = `${info.mtimeMs}:${info.size}`
  const hit = cache.get(key)
  if (hit !== undefined && hit.signature === signature) return hit.value
  const value = await loader()
  cache.set(key, { signature, value })
  return value
}

export function clearFileCache() {
  cache.clear()
}

export function fileCacheStats() {
  return { files: cache.size }
}
