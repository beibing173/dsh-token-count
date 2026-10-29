import test from 'node:test'
import assert from 'node:assert/strict'
import { zstdCompressSync } from 'node:zlib'
import { frameOffsets, decompressSessionLog } from '../session-log.js'

test('frameOffsets 找到全部帧魔数', () => {
  const buf = Buffer.concat([
    zstdCompressSync(Buffer.from('{"a":1}\n')),
    zstdCompressSync(Buffer.from('{"b":2}\n')),
  ])
  const offs = frameOffsets(buf)
  assert.equal(offs.length, 2)
  assert.equal(offs[0], 0)
})

test('decompressSessionLog 解压多帧拼接', () => {
  const part1 = '{"type":"session","id":"s1"}\n'
  const part2 = '{"type":"tool/call"}\n{"type":"assistant/message","time":1,"data":{"usage":{"inputTokens":3}}}\n'
  const buf = Buffer.concat([
    zstdCompressSync(Buffer.from(part1)),
    zstdCompressSync(Buffer.from(part2)),
  ])
  const out = decompressSessionLog(buf).toString('utf8')
  assert.ok(out.includes('"id":"s1"'))
  assert.ok(out.includes('"type":"assistant/message"'))
  assert.ok(out.includes('"inputTokens":3'))
})

test('decompressSessionLog 非 zstd 输入原样返回', () => {
  const buf = Buffer.from('{"a":1}\n')
  assert.equal(decompressSessionLog(buf).toString('utf8'), '{"a":1}\n')
})

test('decompressSessionLog 撕裂末帧只贡献完整记录', () => {
  const good = zstdCompressSync(Buffer.from('{"ok":1}\n'))
  // 制造一个被截断的帧（只有魔数 + 半个头）
  const torn = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00])
  const buf = Buffer.concat([good, torn])
  const out = decompressSessionLog(buf).toString('utf8')
  assert.ok(out.includes('{"ok":1}'))
})
