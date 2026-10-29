/**
 * session-log.js — 读取 DSH 会话日志（session.v4.jsonl.zstd）。
 *
 * DSH 把每个会话存成「仅追加 JSONL 日志」，默认以带校验和的 Zstandard 帧存储：
 * 一帧仅含 header 行，其后每个持久 append 批次各一帧。文件本质是「多帧拼接」，
 * 而 Node 的 zstdDecompressSync 只解第一帧，因此必须按魔数 `28 B5 2F FD` 切帧、
 * 逐帧解压后拼接，才是完整日志。
 *
 * 本模块只做「解压 + 逐行吐出原始事件对象」，不做任何聚合；聚合在 stats.js。
 * 兼容无压缩（纯文本 JSONL）的旧日志：直接按行读。
 */
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'

/** zstd 帧魔数（4 字节，小端）。 */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/**
 * 按魔数切出所有 zstd 帧的起始偏移。
 * @param {Buffer} buf
 * @returns {number[]} 每帧起始偏移，升序。
 */
export function frameOffsets(buf) {
  const offs = []
  for (let i = 0; i < buf.length - 3; i += 1) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) {
      offs.push(i)
    }
  }
  return offs
}

/**
 * 解压整份多帧 zstd 会话日志。
 * 逐帧解压、拼接，忽略撕裂的末帧（DSH 官方口径：不完整的最终帧只贡献完整记录）。
 * @param {Buffer} buf
 * @returns {Buffer} 解压后的完整 JSONL 文本。
 */
export function decompressSessionLog(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('decompressSessionLog: 需要 Buffer')
  const offs = frameOffsets(buf)
  if (offs.length === 0) {
    // 不是 zstd（可能是无压缩的纯 JSONL）：原样返回。
    return buf
  }
  const parts = []
  for (let i = 0; i < offs.length; i += 1) {
    const start = offs[i]
    const end = offs[i + 1] ?? buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(start, end)))
    } catch {
      // 撕裂帧跳过：只贡献完整记录。
    }
  }
  return Buffer.concat(parts)
}

/**
 * 读取并解压一个会话日志文件，逐行解析成事件对象数组。
 * @param {string} filePath 会话日志绝对路径。
 * @returns {object[]} 事件对象数组（JSONL 每行一个；解析失败的行跳过）。
 */
export function readSessionEvents(filePath) {
  if (!existsSync(filePath)) return []
  const buf = readFileSync(filePath)
  const text = decompressSessionLog(buf).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const evt = JSON.parse(trimmed)
      if (evt && typeof evt === 'object') events.push(evt)
    } catch {
      // 撕裂的末行或脏数据：跳过。
    }
  }
  return events
}

/**
 * 提取一条事件的 token 用量（四桶）。只有 assistant/message 事件才带 usage。
 * @param {object} evt 事件对象。
 * @returns {object|null} { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens } 或 null。
 */
export function usageOf(evt) {
  if (!evt || evt.type !== 'assistant/message') return null
  const usage = evt && evt.data && evt.data.usage
  if (!usage || typeof usage !== 'object') return null
  const num = (v) => (Number.isFinite(v) ? v : 0)
  return {
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    cacheReadTokens: num(usage.cacheReadTokens),
    cacheWriteTokens: num(usage.cacheWriteTokens),
    totalTokens: num(usage.totalTokens),
  }
}

/**
 * 提取一条事件的时间戳（毫秒）。优先 `time`，其次 data.time。
 * @param {object} evt
 * @returns {number} 毫秒时间戳；非法返回 NaN。
 */
export function timeOf(evt) {
  if (!evt || typeof evt !== 'object') return NaN
  const t = typeof evt.time === 'number' ? evt.time : evt.data && typeof evt.data.time === 'number' ? evt.data.time : NaN
  return Number.isFinite(t) ? t : NaN
}

/**
 * 提取一条事件的来源模型（provider / model）。
 * DSH 会话日志里模型信息在 `data.message.source`（不是 `data.source`）。
 * @param {object} evt
 * @returns {{ provider: string, model: string } | null}
 */
export function sourceOf(evt) {
  if (!evt || evt.type !== 'assistant/message') return null
  const source = evt && evt.data && evt.data.message && evt.data.message.source
  if (!source || typeof source !== 'object') return null
  return {
    provider: typeof source.provider === 'string' ? source.provider : '',
    model: typeof source.model === 'string' ? source.model : '',
  }
}
