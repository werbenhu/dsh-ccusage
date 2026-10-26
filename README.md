# dsh-ccusage

在 DeepSeek Harness 侧边栏看本机的 AI 用量：日、周、月、会话和 5 小时计费块。

数据来自本机的 Claude Code、Codex、OpenCode、Kimi、Grok、pi 会话记录，外加 DSH 自己的会话。全部本地读取，不联网。

## 功能

- 日 / 周 / 月 / 会话四个视图，按本地时区统计，可以按来源和项目过滤。
- 5 小时计费块：对齐 Claude 订阅窗口，标出空档，正在进行的块显示消耗速度和预计用量。只统计 Claude Code。
- 顶部四张卡：总 token、输入、输出、缓存读（带命中率），下面是 token 趋势图和来源占比。
- 表格默认收起，点一行展开当天的模型明细，模型旁边标出它来自哪个来源。
- 面板只看 token，不算钱。费用字段在 JSON 接口里。
- 价格表用 models.dev 快照，缺价格的模型会标成「未定价」，也可以自己补。

## 安装

```powershell
cd C:\Users\werbe\.dsh\profiles\desktop
pnpm add link:E:/github/ccusage
```

也可以直接装打包好的 tgz，不用克隆仓库：

```powershell
pnpm add https://github.com/werbenhu/dsh-ccusage/releases/download/v0.1.0/dsh-ccusage-0.1.0.tgz
```

然后把包名加到 profile 的 `package.json`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["dsh-ccusage"]
    }
  }
}
```

重启 DSH，侧边栏就会出现 CCUsage。改了 host 侧代码会自动热重载，客户端代码要刷新浏览器。

装不上时先看 pnpm 的 store 版本：如果报 `ERR_PNPM_UNEXPECTED_STORE`，改用 DSH 自带的 pnpm（`D:\soft\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`）。

## 配置

所有键都有默认值，一般不用动。要改就写进 profile 的 `cordis.patch.yml`：

```yaml
- id: ccusage
  config:
    timezone: Asia/Shanghai     # 留空用系统时区
    weekStart: monday           # 周视图从周一还是周日开始
    sources: [claude, codex, opencode, kimi, grok, pi, dsh]
    pricing:
      overrides:                # 自定义价格，单位是美元 / 百万 token
        my-model:
          input: 1.0
          output: 3.0
```

各来源也支持追加目录（`claudeDirs`、`codexDirs`、`dshDirs` 等），默认位置：

| 来源 | 默认读取 |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/*.jsonl`，支持 `.zst` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Kimi | `~/.kimi`、`~/.kimi-code` 下的 `sessions/**/wire.jsonl` |
| Grok | `~/.grok/sessions/**/updates.jsonl` |
| pi | `~/.pi/agent/sessions/**/*.jsonl` |
| DSH | `~/.dsh/sessions/**/session*.jsonl.zstd` |

DSH 的费用是 API 等价价，订阅额度不按它扣费。不想看就在来源里关掉。

## JSON 接口

报表也能从 HTTP 拿，路径 `/api/dsh-ccusage/report`，字段和 ccusage 的 JSON 输出一致。`POST /refresh` 清缓存后重新扫描。

## 开发

```powershell
npm test
```

测试全离线，用各个来源的 fixture 跑解析、聚合、时区和计价。

发版：改 `package.json` 的版本号，打同名 tag 推上去，CI 会跑测试并生成 Release 里的 tgz。

```powershell
git tag -a v0.1.1 -m "dsh-ccusage v0.1.1"
git push origin v0.1.1
```

## License

MIT。价格快照来自 models.dev，fzstd 以 MIT 许可放在 `vendor/`。
