/**
 * stats.js — token 用量的纯聚合逻辑（无 IO，便于测试）。
 *
 * 输入：一批「事件对象」（来自 session-log.js 的 readSessionEvents）。
 * 输出：
 *   1. totals —— 四大桶累计（与 projcache 的 tokenUsage.totals 口径一致，互斥）
 *   2. daily  —— 按天聚合（本地时区），供热力网格上色
 *
 * 时间口径：按宿主本地时区切「天」。这里只负责把毫秒时间戳归到
 * `YYYY-MM-DD`（本地时区），时区由运行时决定。
 */
import { usageOf, timeOf } from './session-log.js'

/** 四大桶字段名（与 projcache tokenUsage 同义，互不重叠）。 */
export const BUCKETS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/** 把一个毫秒时间戳归到本地时区的 `YYYY-MM-DD`。 */
export function dayKeyOf(ms) {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 空桶。 */
function emptyBuckets() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** 把 usage 累加进目标桶对象（就地修改并返回）。 */
function addInto(target, usage) {
  if (!usage) return target
  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  target.cacheReadTokens += usage.cacheReadTokens || 0
  target.cacheWriteTokens += usage.cacheWriteTokens || 0
  return target
}

/** 四桶合计。 */
export function sumBuckets(buckets) {
  return BUCKETS.reduce((acc, key) => acc + (buckets[key] || 0), 0)
}

/**
 * 聚合一批事件。
 * @param {object[]} events
 * @returns {{ totals: object, daily: Record<string, object> }}
 */
export function aggregateEvents(events) {
  const totals = emptyBuckets()
  const daily = {}

  for (const evt of events || []) {
    const usage = usageOf(evt)
    if (!usage) continue
    addInto(totals, usage)

    const day = dayKeyOf(timeOf(evt))
    if (day) {
      daily[day] = addInto(daily[day] || emptyBuckets(), usage)
    }
  }

  return { totals, daily }
}

/**
 * 把按天聚合转成热力网格可用的区间（过去 N 天，缺的天补 0）。
 * @param {Record<string, object>} daily
 * @param {number} days 要覆盖的天数（从今天往回数）。
 * @param {number} nowMs 当前时间戳（毫秒），默认 Date.now()。
 * @returns {{ date: string, tokens: number, buckets: object }[]} 升序（最旧在前）。
 */
export function dailySeries(daily, days, nowMs = Date.now()) {
  const out = []
  const today = dayKeyOf(nowMs)
  if (!today) return out
  const todayMs = new Date(`${today}T00:00:00`).getTime()
  for (let i = days - 1; i >= 0; i -= 1) {
    const ms = todayMs - i * 86_400_000
    const key = dayKeyOf(ms)
    const buckets = daily[key] || emptyBuckets()
    out.push({ date: key, tokens: sumBuckets(buckets), buckets })
  }
  return out
}
