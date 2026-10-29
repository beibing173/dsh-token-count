import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { computeStats } from '../index.js'
import { sumBuckets } from '../stats.js'

/** 构造一个最小会话目录：projcache 不必有，只需 sessions/<ws>/<session>/session.v4.jsonl.zstd */
function seedHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-count-'))
  const sessionDir = join(home, 'sessions', 'ws1', 'session-a')
  mkdirSync(sessionDir, { recursive: true })

  // 多帧 zstd：header + 两条 assistant/message
  const events = [
    { type: 'session', version: 4, id: 'session-a', createdAt: Date.now() },
    {
      type: 'assistant/message',
      time: Date.now() - 86_400_000, // 昨天
      data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 170 } },
    },
    {
      type: 'assistant/message',
      time: Date.now(), // 今天
      data: { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, totalTokens: 18 } },
    },
  ]
  const frames = events.map((e) => zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n')))
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.concat(frames))
  return home
}

test('computeStats 从日志聚合 totals 与 daily', () => {
  const home = seedHome()
  try {
    const { totals, daily, sessionCount, logBytes } = computeStats({ DSH_HOME: home })
    assert.equal(sessionCount, 1)
    assert.ok(logBytes > 0)
    assert.equal(totals.inputTokens, 110)
    assert.equal(totals.outputTokens, 25)
    assert.equal(totals.cacheReadTokens, 52)
    assert.equal(totals.cacheWriteTokens, 1)
    assert.equal(sumBuckets(totals), 188)
    assert.equal(Object.keys(daily).length, 2)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('computeStats 缓存生效：二次调用读缓存', () => {
  const home = seedHome()
  try {
    const first = computeStats({ DSH_HOME: home })
    const second = computeStats({ DSH_HOME: home })
    assert.deepEqual(second.totals, first.totals)
    assert.deepEqual(second.daily, first.daily)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('computeStats 空目录返回零值', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-token-count-empty-'))
  try {
    const { totals, daily, sessionCount } = computeStats({ DSH_HOME: home })
    assert.equal(sessionCount, 0)
    assert.equal(sumBuckets(totals), 0)
    assert.deepEqual(daily, {})
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
