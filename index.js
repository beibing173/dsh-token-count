/**
 * dsh-token-count — DeepSeek Harness 的 token 用量看板插件（Host 侧）。
 *
 * 数据来源：扫描 `~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`，
 * 从 assistant/message 事件的 time + usage 聚合出：
 *   - totals：四大互斥桶累计（inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens）
 *   - daily ：按天聚合（本地时区），供热力网格上色
 *
 * 说明：
 *   - DSH 的 assistant/message 事件里 usage 字段即为「未缓存输入 + 输出 + 缓存读 + 缓存写」，
 *     与 projcache 的 tokenUsage 四大桶同义（只是 projcache 用 `uncachedInputTokens` 命名）。
 *   - 这里统一用日志扫描一个数据源，保证「累计总量 / 热力网格 / 饼图」三处数字一致；
 *     不读 projcache，因为它是检查点语义（含 compaction 裁剪），累计值会偏小。
 *
 * 缓存策略：首次扫描落盘 `~/.dsh/dsh-token-count-cache.json`，之后按文件 mtime+size 增量重扫。
 *
 * 路由：GET /dsh-token-count-api —— 返回聚合结果，仅本机可读。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { readSessionEvents } from './session-log.js'
import { aggregateEvents, dailySeries, sumBuckets, BUCKETS } from './stats.js'

export const name = 'dsh-token-count'

export const PLUGIN_VERSION = (() => {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
})()

export const ENTRY_ID = 'dsh-token-count'

export const inject = ['webServer']

export const ROUTE = '/dsh-token-count-api'

/** 热力网格默认覆盖天数。 */
const DEFAULT_DAYS = 90
/** 热力网格允许的最大天数。 */
const MAX_DAYS = 400
/** 聚合缓存文件名。 */
const CACHE_FILE = 'dsh-token-count-cache.json'

// ────────────────────────────── 工具 ──────────────────────────────

function dshHome(env) {
  return env.DSH_HOME || join(homedir(), '.dsh')
}

function warn(message, error) {
  try {
    console.warn(`[dsh-token-count] ${message}`, error ?? '')
  } catch {
    // 日志失败不影响功能
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function isLoopback(req) {
  const headers = (req && req.headers) || {}
  if (headers['x-forwarded-for'] || headers['x-real-ip'] || headers['forwarded'] || headers['cf-connecting-ip']) {
    return false
  }
  const address = (req && req.socket && req.socket.remoteAddress) || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

// ────────────────────────────── 扫描 ──────────────────────────────

/** 枚举所有会话日志文件（绝对路径）。 */
function listSessionLogs(sessionsRoot) {
  const logs = []
  let workspaces = []
  try {
    workspaces = readdirSync(sessionsRoot)
  } catch {
    return logs
  }
  for (const ws of workspaces) {
    const wsPath = join(sessionsRoot, ws)
    let sessions = []
    try {
      sessions = readdirSync(wsPath)
    } catch {
      continue
    }
    for (const session of sessions) {
      const file = join(wsPath, session, 'session.v4.jsonl.zstd')
      try {
        statSync(file)
        logs.push(file)
      } catch {
        // 无日志则跳过
      }
    }
  }
  return logs
}

function fingerprintOf(filePath) {
  try {
    const stat = statSync(filePath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return ''
  }
}

// ────────────────────────────── 缓存 ──────────────────────────────

function readCache(cachePath) {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeCache(cachePath, payload) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    const tmp = `${cachePath}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    renameSync(tmp, cachePath)
  } catch (error) {
    warn('缓存写入失败（不影响本次使用）', error)
  }
}

// ────────────────────────────── 聚合 ──────────────────────────────

const emptyBuckets = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

/**
 * 汇总全部会话：totals + daily，带增量缓存。
 * @returns {{ totals, daily, sessionCount, logBytes }}
 */
export function computeStats(env) {
  const root = dshHome(env)
  const sessionsRoot = join(root, 'sessions')
  const cachePath = join(root, CACHE_FILE)

  const logs = listSessionLogs(sessionsRoot)
  const cache = readCache(cachePath)
  const cachedLogs = (cache && cache.logs) || {}

  // 判断是否有日志变化（新文件 / 指纹变化 / 文件消失）。
  let dirty = false
  const currentSet = new Set(logs)
  for (const file of logs) {
    if (cachedLogs[file] !== fingerprintOf(file)) {
      dirty = true
      break
    }
  }
  if (!dirty && Object.keys(cachedLogs).length !== logs.length) dirty = true

  let totals = (cache && cache.totals) || emptyBuckets()
  let daily = (cache && cache.daily) || {}
  let sessionCount = 0
  let logBytes = 0

  if (dirty || !cache || !cache.totals) {
    totals = emptyBuckets()
    daily = {}
    for (const file of logs) {
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        continue
      }
      logBytes += size
      sessionCount += 1
      const agg = aggregateEvents(readSessionEvents(file))
      for (const key of BUCKETS) totals[key] += agg.totals[key]
      for (const [day, buckets] of Object.entries(agg.daily)) {
        const cell = daily[day] || (daily[day] = emptyBuckets())
        for (const key of BUCKETS) cell[key] += buckets[key]
      }
    }
    const logsFp = {}
    for (const file of logs) logsFp[file] = fingerprintOf(file)
    writeCache(cachePath, { at: Date.now(), totals, daily, logs: logsFp })
  } else {
    for (const file of logs) {
      try {
        logBytes += statSync(file).size
      } catch {}
      sessionCount += 1
    }
  }

  return { totals, daily, sessionCount, logBytes }
}

// ────────────────────────────── 入口 ──────────────────────────────

export function apply(ctx, config) {
  const env = (typeof process !== 'undefined' && process.env) || {}

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => {
          try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              return sendJson(res, 405, { ok: false, error: 'method', message: '仅支持 GET' })
            }
            if (!isLoopback(req)) {
              return sendJson(res, 403, { ok: false, error: 'forbidden', message: '仅允许本机访问' })
            }

            const url = req.url || ''
            const q = url.indexOf('?')
            const kv = q === -1 ? [] : url.slice(q + 1).split('&')
            let days = DEFAULT_DAYS
            for (const item of kv) {
              const m = /^days=(\d+)$/.exec(item)
              if (m) {
                const n = Number(m[1])
                if (Number.isFinite(n) && n >= 1 && n <= MAX_DAYS) days = Math.floor(n)
              }
            }

            const { totals, daily, sessionCount, logBytes } = computeStats(env)
            const series = dailySeries(daily, days)

            sendJson(res, 200, {
              ok: true,
              pluginVersion: PLUGIN_VERSION,
              totals,
              totalTokens: sumBuckets(totals),
              series,
              sessionCount,
              logBytes,
              days,
              generatedAt: Date.now(),
            })
          } catch (error) {
            warn('请求失败', error)
            sendJson(res, 502, { ok: false, error: 'internal', message: '插件内部错误' })
          }
        },
      }),
    'dsh-token-count: route',
  )
}
