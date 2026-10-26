# dsh-ccusage

把 [ccusage](https://github.com/ccusage/ccusage) 的本地用量分析能力做成 **DeepSeek Harness 插件**：读取本机的 Claude Code / Codex / OpenCode / Kimi / Grok / pi 会话记录，以及 **DSH 自身会话**，在侧边栏生成日、周、月、会话和 5 小时计费块报表，并按模型拆分 token 与费用。

- 纯本地读取，不联网、不上传任何数据；价格表随包内置。
- 无前端构建，`client.js` 由 DSH Web shell 直接加载。
- 价格来自 models.dev 快照（`data/models-dev-pricing.json`），可覆盖、可补充；缺价模型会在 UI 中标记为“未定价”。
- 面板只显示 token，不估算费用；费用字段仍保留在 JSON API 里，便于脚本使用。

## 功能

| 视图 | 说明 |
| --- | --- |
| 每日 | 按本地时区聚合每天的四类 token、总费用、模型明细 |
| 每周 | 周一（可配置为周日）开始的周汇总 |
| 每月 | 自然月汇总 |
| 会话 | 每个会话一行，按费用排序，显示最后活动时间 |
| 5 小时块 | 对齐 Claude 订阅计费窗口：从整点开始、5 小时切块、空档标出 gap、活动块显示燃尽率与用量预测。只统计 Claude Code，其它来源不计入（与 ccusage 的 blocks 一致） |

面板顶部是总 Token、输入、输出、缓存读（含命中率）四张卡；下面是 Token 趋势图与来源 Token 占比，最底部是各来源明细。表格默认收起，点某一行会展开该天的模型明细，并在模型旁标出它来自哪个来源。支持来源过滤（Claude / Codex / OpenCode / Kimi / Grok / pi / DSH）和项目名过滤。

## 安装

插件通过本地 link 安装到 DSH profile：

```powershell
cd C:\Users\werbe\.dsh\profiles\desktop
pnpm add link:E:/github/ccusage
```

也可以从 Release 直接装打包好的 tgz（不需要克隆仓库）：

```powershell
cd C:\Users\werbe\.dsh\profiles\desktop
pnpm add https://github.com/werbenhu/dsh-ccusage/releases/download/v0.1.0/dsh-ccusage-0.1.0.tgz
```

同一 Release 里的 `SHA256SUMS.txt` 可用于校验下载内容。

如果系统 pnpm 报 `ERR_PNPM_UNEXPECTED_STORE`（profile 的 `node_modules` 由更新的 store 版本创建），改用 DSH 自带的 pnpm：

```powershell
$node = "D:\soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "D:\soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
& $node $pnpm add "link:E:/github/ccusage"
```

然后把包名加入同目录 `package.json` 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-ccusage"
      ]
    }
  }
}
```

重启 DSH（或修改 profile 的 `cordis.patch.yml` 触发热重载）后，侧边栏会出现 **CCUsage** 入口。Host 侧代码会被热重载；客户端 bundle 需要刷新浏览器（Ctrl+R）才会用上新版本。

> 本仓库路径是 `E:\github\ccusage`；换机器时把 `link:` 指向实际路径即可。

## 配置

所有配置都有默认值，可在 profile 的 `cordis.patch.yml` 里用同 id 覆盖（同 id 的 `config` 会整体替换插件默认值，未写的键仍取默认）：

```yaml
- id: ccusage
  config:
    timezone: Asia/Shanghai      # 空 = 系统时区
    sources: [claude, codex, opencode, kimi, grok, pi, dsh]
    cacheTtlMs: 30000            # 报表缓存时间
    weekStart: monday            # monday | sunday
    sessionHours: 5              # 计费块长度
    claudeDirs: []               # 额外 Claude 配置目录（可指向 projects 本身）
    codexDirs: []                # 额外 ~/.codex 或 sessions 目录
    opencodeDirs: []             # 额外 OpenCode 数据根
    kimiDirs: []                 # 额外 Kimi / Kimi Code 数据根
    grokDirs: []                 # 额外 ~/.grok
    piDirs: []                   # 额外 pi agent 数据根（含 sessions/）
    dshDirs: []                  # 额外 DSH 数据根（含 sessions/；默认 $DSH_HOME 或 ~/.dsh）
    pricing:
      overrides:                 # 每百万 token 的美元价
        my-model:
          input: 1.0
          output: 3.0
          cacheRead: 0.1
          cacheWrite: 1.25
```

### 数据目录

- **Claude Code**：`$CLAUDE_CONFIG_DIR`（逗号分隔）或 `~/.claude/projects/**/*.jsonl`，也支持 `$XDG_CONFIG_HOME/claude`。
- **Codex**：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`，同时支持 zstd 压缩的 `.jsonl.zst`（内置 fzstd 解压，不依赖系统 zstd）。
- **OpenCode**：优先读 `~/.local/share/opencode/opencode.db`（Node 22 通过 `--experimental-sqlite` worker 读取），同时合并 `storage/message/**/*.json`，按 message id 去重。
- **Kimi / Kimi Code**：`$KIMI_DATA_DIR`（逗号分隔）或 `~/.kimi`、`~/.kimi-code` 下的 `sessions/**/wire.jsonl`，兼容旧 `StatusUpdate` 与新 `usage.record` 两种格式。
- **Grok**：`$GROK_HOME` 或 `~/.grok` 下的 `sessions/**/updates.jsonl`（读取同目录 `summary.json` 补模型/项目），按 `turn_completed` 事件计费。
- **pi**：`$PI_AGENT_DIR` 或 `~/.pi/agent/sessions/**/*.jsonl`，只统计 assistant 消息；跨文件重放（父会话与 run 子目录）按 token 签名去重。
- **DSH**：`$DSH_HOME/sessions/**/session*.jsonl.zstd`（默认 `~/.dsh`），读取 `assistant/message` 事件的 `usage`；会话首行的 `session` 事件提供 id 与 cwd，项目名取 cwd 的 basename。DSH 自己的费用是 API 等价价，订阅额度并不按此扣费，只看 token 时可把该来源关掉。

## HTTP API

所有接口同源，前缀 `/api/dsh-ccusage`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/report` | 生成报表；query 支持 `timezone`、`costMode`（仅 API，面板已不展示费用）、`sources`、`weekStart`、`sessionHours`、`last`、`since`、`until`、`project`、`agent`、`sections` |
| GET | `/meta` | 插件版本、支持的数据源、价格表统计 |
| POST | `/refresh` | 清空文件解析缓存与报表缓存，下次请求重新扫描 |

`/report` 返回：

```json
{
  "daily": [], "weekly": [], "monthly": [], "session": [], "blocks": [],
  "totals": { "inputTokens": 0, "outputTokens": 0, "cacheCreationTokens": 0, "cacheReadTokens": 0, "totalTokens": 0, "totalCost": 0 },
  "metadata": { "timeZone": "Asia/Shanghai", "generatedAt": "…", "entries": 0, "durationMs": 0, "cache": { "hit": false } }
}
```

字段命名与 ccusage 的 JSON 输出保持一致：日/周/月/会话行使用 `totalCost`，5 小时块使用 `costUSD` 和 `tokenCounts`。

## 与 ccusage 的差异

- 已覆盖 6 个外部数据源：Claude Code、Codex、OpenCode、Kimi、Grok、pi；ccusage 还支持 zcode / kilo / Copilot 等，本机没有可用数据，暂未移植。
- 额外支持 **DSH 自身会话**（`dsh` source），这是 ccusage 没有的来源；默认开启，可在面板来源 chips 或 `sources` 配置里关掉。
- 价格表是 models.dev 快照，ccusage 原生二进制用的是 LiteLLM 快照。对同一批本机数据，费用差异约 0.1%；个别模型的第三方加价档位在 `src/pricing.js` 的 `RATE_OVERRIDES` 中固定成官方价。
- Codex 的 `codex-auto-review` 会映射到 `gpt-5.6-luna` 计价；其他模型别名可用 `pricing.overrides` 补充。
- 报表顺序、时区处理、去重规则、5 小时块切分均按 ccusage 的 Rust 实现移植。

## 开发

```powershell
cd E:\github\ccusage
node --test test/*.test.mjs
```

测试全部离线：用 Claude / Codex / Kimi / OpenCode / pi / DSH 的 fixture 验证解析、聚合、5 小时块、时区边界、计价和 HTTP 路由；客户端用 React 桩执行 `client.js`，验证 bundle 形状与槽位注册。

### CI / 发布

`.github/workflows/` 下按职责拆分：

- `ci.yml`：`main` 推送和 PR 时跑静态检查与全部测试。矩阵覆盖 ubuntu 的 Node 22 / 24，以及 macOS、Windows 的 Node 22——路径分隔符、大小写、CRLF 这类平台差异只在 Linux 上测是漏的。
- `release.yml`：推送 `v*` tag 时重跑测试，打包 `dsh-ccusage-<tag>.tgz`（附 `SHA256SUMS.txt`）并创建 GitHub Release。tag 必须与 `package.json` 的 `version` 一致，否则直接失败。

失败时 `ci.yml` 会把 TAP 摘要输出成 check annotation：公开仓库的 job 日志要 admin 权限才能匿名取，annotations 可以。

本地发版：

```powershell
git tag -a v0.1.0 -m "dsh-ccusage v0.1.0"
git push origin v0.1.0
```

调试脚本在 `scripts/` 下（对账用，不参与打包）：

- `sum-claude.mjs`：统计 Claude 原始 `cache_creation` 字段
- `inspect-opencode-db.mjs`、`sum-opencode-db.mjs`：检查 OpenCode SQLite 结构与聚合
- `test-sqlite-worker.mjs`：验证 Node 22 的 sqlite worker 方案
- `ref-codex-models.mjs`、`ours-codex-models.mjs`：对比 ccusage 参考输出与插件输出的 Codex 模型费用

## 目录

```
.github/workflows/    CI（ci.yml）与 tag 发布（release.yml）
index.js              Host 入口：配置归一化、同源 HTTP 路由、报表缓存
client.js             Web 客户端：侧边栏入口 + 主面板
src/report.js         扫描、过滤、聚合、报表组装
src/aggregate.js      日/周/月/会话聚合与 totals
src/blocks.js         5 小时计费块
src/pricing.js        价格表加载、模型匹配、费用计算
src/time.js           时区/日期/周边界
src/cache.js          文件级解析缓存
src/sources/          claude.js / codex.js / opencode.js / kimi.js / grok.js / pi.js / dsh.js / common.js
data/                 models.dev 价格快照
locale/               插件元数据（中/英）
test/                 离线测试与 fixture
```

## License

MIT。价格快照来自 models.dev；fzstd 以 MIT 许可 vendored 在 `vendor/`。

- 仓库：<https://github.com/werbenhu/dsh-ccusage>
- 问题反馈：<https://github.com/werbenhu/dsh-ccusage/issues>
