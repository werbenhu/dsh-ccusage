/**
 * 时区与日期工具。不引第三方依赖，全部走 Intl。
 *
 * ccusage 的所有分组（daily/weekly/monthly/block 的整点对齐）都按使用
 * `--timezone` 指定的本地日历算，而不是 UTC；这里把同样的语义做成纯函数。
 */

export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 校验 IANA 时区名；非法值回退到系统时区。 */
export function normalizeTimeZone(value) {
  if (typeof value !== 'string' || value.trim() === '') return systemTimeZone()
  const zone = value.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
    return zone
  } catch {
    return systemTimeZone()
  }
}

const formatterCache = new Map()

function formatter(timeZone) {
  let cached = formatterCache.get(timeZone)
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, cached)
  }
  return cached
}

/**
 * 某个时间点在指定时区里的日历字段。
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number}}
 */
export function zonedParts(timestampMs, timeZone) {
  const parts = formatter(timeZone).formatToParts(new Date(timestampMs))
  const bag = {}
  for (const part of parts) {
    if (part.type !== 'literal') bag[part.type] = Number(part.value)
  }
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: bag.hour,
    minute: bag.minute,
    second: bag.second,
  }
}

const pad = (value, width = 2) => String(value).padStart(width, '0')

/** 本地日历日键：YYYY-MM-DD。 */
export function dateKey(timestampMs, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

/** 本地月份键：YYYY-MM。 */
export function monthKey(timestampMs, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  return `${pad(p.year, 4)}-${pad(p.month)}`
}

/** 本地时间：HH:MM。 */
export function timeKey(timestampMs, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

const DAY_MS = 86_400_000

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function validDateParts(year, month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function representedAsUtc(timestampMs, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    + new Date(timestampMs).getUTCMilliseconds()
}

/**
 * 本地墙钟时间（先伪装成 UTC 的 naive 值）转真实时间戳。
 * 重叠时刻取较早的一次；不存在的时刻按 DST gap 向后移动，与 Temporal compatible 一致。
 */
function localToUtc(naive, timeZone) {
  const offsets = new Set()
  for (const delta of [-DAY_MS, 0, DAY_MS]) {
    const sample = naive + delta
    offsets.add(representedAsUtc(sample, timeZone) - sample)
  }

  let exact
  let next
  for (const offset of offsets) {
    const candidate = naive - offset
    const represented = representedAsUtc(candidate, timeZone)
    if (represented === naive) {
      if (exact === undefined || candidate < exact) exact = candidate
    } else if (
      represented > naive &&
      (next === undefined || represented < next.represented ||
        (represented === next.represented && candidate < next.candidate))
    ) {
      next = { candidate, represented }
    }
  }
  if (exact !== undefined) return exact
  if (next !== undefined) return next.candidate
  return naive
}

/** 把本地日历日期（YYYY-MM-DD）转成该日 00:00 的 UTC 毫秒。 */
export function zonedDayStart(dayString, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayString)
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!validDateParts(year, month, day)) return undefined
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0)
  return localToUtc(guess, timeZone)
}

/** 本地日历日加天数，返回 YYYY-MM-DD。 */
export function addDays(dayString, amount) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayString)
  if (match === null) return dayString
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() + amount)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 两个日历日之间相差的天数。 */
export function dayDiff(from, to) {
  const a = zonedDayStart(from, 'UTC')
  const b = zonedDayStart(to, 'UTC')
  if (a === undefined || b === undefined) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * 某一周的开始日（默认周一）。输入输出都是 YYYY-MM-DD。
 */
export function weekStartDay(dayString, weekStartsOn = 'monday') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayString)
  if (match === null) return dayString
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const weekday = date.getUTCDay() // 0=Sunday
  const target = weekStartsOn === 'sunday' ? 0 : 1
  const delta = (weekday - target + 7) % 7
  date.setUTCDate(date.getUTCDate() - delta)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 周一/周日的短标签。 */
export function weekdayLabel(dayString, locale = 'zh-CN') {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayString)
  if (match === null) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(date)
  } catch {
    return ''
  }
}

/** 把时间戳对齐到指定时区的整点（ccusage 的 5 小时块起点）。 */
export function floorToHour(timestampMs, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  return timestampMs - p.minute * 60_000 - p.second * 1000 - new Date(timestampMs).getUTCMilliseconds()
}

/** 5 小时块结束时间：本地整点 + 小时数。DST 切换时按日历推进。 */
export function addHours(timestampMs, hours, timeZone) {
  const p = zonedParts(timestampMs, timeZone)
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) + hours * 3_600_000
  return localToUtc(naive, timeZone)
}

/** 解析用户传的 YYYY-MM-DD；非法返回 undefined。 */
export function parseDay(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!validDateParts(year, month, day)) return undefined
  return `${match[1]}-${match[2]}-${match[3]}`
}

/** 解析 `YYYY-MM` 或 `YYYY-MM-DD`；月份上界可取月末。 */
export function parseBound(value, endOfMonth = false) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed)
  if (monthMatch !== null) {
    const year = Number(monthMatch[1])
    const month = Number(monthMatch[2])
    if (month < 1 || month > 12) return undefined
    const day = endOfMonth ? daysInMonth(year, month) : 1
    return `${monthMatch[1]}-${monthMatch[2]}-${pad(day)}`
  }
  return parseDay(trimmed)
}

/**
 * 根据前端选择计算查询窗口。
 *
 * @param {{last?:number|string, since?:string, until?:string}} filter
 * @param {string} timeZone
 * @param {number} [now]
 */
export function resolveRange(filter, timeZone, now = Date.now()) {
  const today = dateKey(now, timeZone)
  let since
  let until

  if (typeof filter?.since === 'string' && filter.since !== '') since = parseBound(filter.since)
  if (typeof filter?.until === 'string' && filter.until !== '') until = parseBound(filter.until, true)

  const last = Number(filter?.last)
  if (Number.isFinite(last) && last > 0) {
    since = addDays(today, -(Math.trunc(last) - 1))
    until = today
  }
  if (since !== undefined && until !== undefined && since > until) {
    const swap = since
    since = until
    until = swap
  }
  return { since, until, today }
}

/**
 * 判断日历日是否落在窗口内（闭区间）。窗口边界为空表示不限。
 */
export function dayInRange(day, since, until) {
  if (since !== undefined && day < since) return false
  if (until !== undefined && day > until) return false
  return true
}
