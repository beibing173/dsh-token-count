import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateEvents, dailySeries, sumBuckets, dayKeyOf, BUCKETS } from '../stats.js'
import { usageOf, timeOf } from '../session-log.js'

function msgEvt(time, usage) {
  return { type: 'assistant/message', time, data: { usage } }
}

test('dayKeyOf 按本地时区归天', () => {
  const d = new Date(2026, 0, 15, 12, 0, 0) // 本地 2026-01-15 12:00
  assert.equal(dayKeyOf(d.getTime()), '2026-01-15')
})

test('aggregateEvents 聚合四大桶与按天', () => {
  const events = [
    msgEvt(new Date(2026, 0, 15, 10, 0).getTime(), { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 170 }),
    msgEvt(new Date(2026, 0, 15, 11, 0).getTime(), { inputTokens: 200, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5, totalTokens: 245 }),
    msgEvt(new Date(2026, 0, 16, 9, 0).getTime(), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 }),
  ]
  const { totals, daily } = aggregateEvents(events)

  assert.equal(totals.inputTokens, 301)
  assert.equal(totals.outputTokens, 52)
  assert.equal(totals.cacheReadTokens, 63)
  assert.equal(totals.cacheWriteTokens, 9)
  assert.equal(sumBuckets(totals), 425)

  assert.equal(daily['2026-01-15'].inputTokens, 300)
  assert.equal(daily['2026-01-16'].cacheWriteTokens, 4)
})

test('aggregateEvents 忽略非 assistant/message 与缺 usage 的事件', () => {
  const events = [
    { type: 'tool/call', time: 123, data: { usage: { inputTokens: 999 } } },
    { type: 'assistant/message', time: 124, data: { usage: null } },
  ]
  const { totals } = aggregateEvents(events)
  assert.equal(sumBuckets(totals), 0)
})

test('dailySeries 补零并按升序返回', () => {
  const now = new Date(2026, 0, 20, 12, 0).getTime()
  const daily = { '2026-01-18': { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  const series = dailySeries(daily, 5, now)
  assert.equal(series.length, 5)
  assert.equal(series[0].date, '2026-01-16')
  assert.equal(series[0].tokens, 0)
  assert.equal(series[2].date, '2026-01-18')
  assert.equal(series[2].tokens, 5)
  assert.equal(series[4].date, '2026-01-20')
})

test('usageOf / timeOf 提取', () => {
  const evt = msgEvt(1793238314548, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 })
  assert.deepEqual(usageOf(evt), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 })
  assert.equal(timeOf(evt), 1793238314548)
  assert.equal(usageOf({ type: 'tool/call' }), null)
})

test('BUCKETS 覆盖四桶', () => {
  assert.deepEqual(BUCKETS, ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
})
