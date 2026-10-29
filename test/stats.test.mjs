import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateEvents, dailySeries, sumBuckets, dayKeyOf, BUCKETS, modelKeyOf } from '../stats.js'
import { usageOf, timeOf, sourceOf } from '../session-log.js'

function msgEvt(time, usage, provider = 'deepseek-account', model = 'deepseek-flash') {
  return { type: 'assistant/message', time, data: { message: { source: { provider, model } }, usage } }
}

test('dayKeyOf 按本地时区归天', () => {
  const d = new Date(2026, 0, 15, 12, 0, 0) // 本地 2026-01-15 12:00
  assert.equal(dayKeyOf(d.getTime()), '2026-01-15')
})

test('aggregateEvents 聚合四大桶、按天、按模型', () => {
  const events = [
    msgEvt(new Date(2026, 0, 15, 10, 0).getTime(), { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 170 }),
    msgEvt(new Date(2026, 0, 15, 11, 0).getTime(), { inputTokens: 200, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5, totalTokens: 245 }, 'p', 'm1'),
    msgEvt(new Date(2026, 0, 16, 9, 0).getTime(), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 }),
  ]
  const { totals, daily, byModel } = aggregateEvents(events)

  assert.equal(totals.inputTokens, 301)
  assert.equal(totals.outputTokens, 52)
  assert.equal(totals.cacheReadTokens, 63)
  assert.equal(totals.cacheWriteTokens, 9)
  assert.equal(sumBuckets(totals), 425)

  assert.equal(daily['2026-01-15'].inputTokens, 300)
  assert.equal(daily['2026-01-16'].cacheWriteTokens, 4)

  assert.equal(byModel['deepseek-account/deepseek-flash'].count, 2)
  assert.equal(byModel['p/m1'].outputTokens, 30)
})

test('aggregateEvents 忽略非 assistant/message 与缺 usage 的事件', () => {
  const events = [
    { type: 'tool/call', time: 123, data: { usage: { inputTokens: 999 } } },
    { type: 'assistant/message', time: 124, data: { message: { source: {} }, usage: null } },
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

test('usageOf / timeOf / sourceOf / modelKeyOf 提取', () => {
  const evt = msgEvt(1793238314548, { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 }, 'deepseek-account', 'deepseek-chat')
  assert.deepEqual(usageOf(evt), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 10 })
  assert.equal(timeOf(evt), 1793238314548)
  assert.deepEqual(sourceOf(evt), { provider: 'deepseek-account', model: 'deepseek-chat' })
  assert.equal(modelKeyOf(sourceOf(evt)), 'deepseek-account/deepseek-chat')
  assert.equal(usageOf({ type: 'tool/call' }), null)
  assert.equal(sourceOf({ type: 'other' }), null)
  assert.equal(modelKeyOf(null), '(unknown)')
})

test('BUCKETS 覆盖四桶', () => {
  assert.deepEqual(BUCKETS, ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
})
