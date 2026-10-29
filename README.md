# dsh-token-count（Token 统计）

DeepSeek Harness 的 **token 用量看板插件**：在设置页单开一页，用绿色热力网格展示按天 token 用量，并用「饼图 / 柱状图」切换展示输入 / 输出 / 缓存读 / 缓存写四大桶占比。

> 灵感来自 [dsh-codex-gpt](https://github.com/beibing173/dsh-codex-gpt) 的用量看板，但这是一个**全新独立插件**，数据源也完全不同。

## 数据来源（全部本机，不调上游 API）

| 数据 | 来源 |
|---|---|
| 累计总量 | 扫描 `~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`，聚合 `assistant/message` 事件的 `usage`（四大互斥桶） |
| 按天热力 | 同上，按事件 `time`（毫秒）归到本地时区 `YYYY-MM-DD` |
| 日志解压 | DSH 会话日志是多帧 zstd 拼接，按魔数 `28 B5 2F FD` 切帧、逐帧解压（`node:zlib` 的 `zstdDecompressSync`） |

## 功能

- **累计总量**：输入 / 输出 / 缓存读 / 缓存写 四大桶 + 总计，覆盖会话数、日志体积。
- **每日用量热力图**：GitHub 贡献图风格，横轴 = 周、纵轴 = 星期几，每格 = 一天，颜色越深用量越高；可切 30 / 90 / 180 / 365 天。
- **用量结构**：饼图 / 柱状图一键切换，展示四大桶占比。

## 缓存策略

按天聚合需要扫描会话日志（较重），所以首次扫描落盘缓存 `~/.dsh/dsh-token-count-cache.json`，之后按文件 `mtime + size` 增量重扫——只有日志文件变化时才全量重算。

## 安装 / 开发

```powershell
# 开发：把本目录软链（Junction）进 profile
# ~/.dsh/profiles/desktop/node_modules/dsh-token-count -> 本目录

# 跑测试
node test/stats.test.mjs
node test/session-log.test.mjs
```

改宿主代码后需「禁用 → 启用」插件重载；改客户端后 `Ctrl+R` 即可。

## 目录结构

```
index.js         宿主入口：扫描 + 增量缓存 + GET /dsh-token-count-api 路由
session-log.js    会话日志读取（zstd 多帧解压 + 逐行解析）
stats.js          纯聚合逻辑（四大桶 / 按天）
client.js         浏览器侧：设置页热力网格 + 饼图/柱状图
```

## License

MIT
