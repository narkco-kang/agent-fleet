# 21 · 平台 ACP 与调用方式矩阵

> 结论：AgentFleet 调用各 agent 平台时，要区分「**ACP 协议平台**（走 `agent stdio` 调 bot/agent）」与「**非 ACP CLI 平台**（走各自 headless 命令调单轮）」。
> 本文梳理 13 个平台的调用方式与 ACP 支持情况，作为 Adapter 实现的事实依据。

## 1. ACP 是什么

ACP（**Agent Client Protocol**）是由 Zed 主导、Anthropic 与 Google 参与制定的开放协议，类比 LSP，统一「AI Agent」与「客户端（IDE / 编排层）」之间的通信标准。

- 走 ACP 时，agent 以**长期运行的 JSON-RPC 2.0 server**（`<cli> agent stdio`）形态工作，完整 agent 循环：`initialize → authenticate → session/new → session/prompt → session/update 流（思考/工具/文本/计划）→ done`。
- 不走 ACP 时，通常是「单轮 headless 问答」：`<cli> -p "prompt"`，一次性输出后退出——这调用的是「**模型**」而非「**bot/agent**」。

**关键区分**：AgentFleet 要协调的是「已经装好的 agent 平台（bot）」，所以**能走 ACP 的平台应走 ACP**（得到完整 agent 循环 + 工具调用），而非退化成单轮模型问答。

## 2. 13 平台矩阵

| 平台 | headless 单轮方式 | ACP 支持 | 结论 |
|------|------------------|----------|------|
| grok | `grok --single` | ✅ **原生**（`grok agent stdio`） | **走 ACP**（已落地） |
| claude | `claude -p` | ⚠️ 经官方适配器 `@zed-industries/claude-code-acp`（非原生） | 原生走 `claude -p`；ACP 需额外适配器包 |
| codex | `codex exec` | ✅ 支持 | 走 ACP 或 `codex exec` |
| gemini | `gemini` CLI | ✅ 支持 | 走 ACP |
| cursor | `cursor-agent` | ✅ 支持 | 走 ACP 或 CLI |
| kimi | `kimi acp`（npm `@moonshot-ai/kimi-code`） | ✅ 原生（`kimi acp`） | 走 ACP（catalogAdapter acp 模式已落地，待装 CLI+登录实测）；旧 `kimi-cli` 是 PyPI 包已归档 |
| qwen | `qwen -p` | ✅ 支持（`qwen-code --acp`） | 走 ACP 或 `qwen -p` |
| opencode | `opencode` | ❓ 未确认 | 有自己的 SDK/TUI，需实测 |
| windsurf | 无 headless CLI | ❌ 无 | 未接入（GUI/Cascade 为主） |
| aider | `aider --message` | ❌ 无 | 走 `aider --message` |
| cody | 无 headless print 参数 | ❌ 无 | 未接入（IDE 插件为主；`sourcegraph cli` 是代码搜索/批量变更工具，非自主编码 agent CLI） |
| doubao | TRAE CLI（字节 AI 编程命令行） | ❓ 待实测 | **2026-11-05 修正**：字节 TRAE 已发布 CLI（面向终端 AI 编程），headless 非交互（`-p`/`--print`）模式待实测确认后接入；此前「无 headless CLI」结论不准确 |
| dsh | DSH Desktop | ❓ 未确认 | 需实测 |

> 标注原则：已确认的写「✅/⚠️/❌」，未确认的一律写「❓ 需实测」——**不编造**。

## 3. AgentFleet Adapter 分层建议

把 `device-agent` 的 Adapter 按调用方式分为三类：

1. **ACP 协议平台**（grok / codex / gemini / cursor / kimi / qwen / claude）
   - 复用统一的 ACP 客户端（`device-agent/src/runner/acpClient.ts`），只需适配「CLI 命令 + 认证方式」。
   - 优点：完整 agent 循环（思考/工具/计划），输出格式统一。
2. **非 ACP CLI 平台**（aider 等）
   - 用各自的 headless 命令 + 现有 `processRunner.ts`（JSONL / 文本逐行解析）。
   - 优点：零协议依赖，缺点是单轮、无统一 agent 循环。
3. **未确认平台**（opencode / windsurf / cody / doubao / dsh）
   - 逐平台实测其 CLI 的 `--help` 与 headless 参数后再归类，暂保留 `CatalogAdapter` 骨架（探测 + 明确「执行待接入」）。

## 4. grok 已落地（走 ACP）

- 新增 `device-agent/src/runner/acpClient.ts`：ACP 客户端（`grok agent stdio`）。
- `grokAdapter.ts` 的 `run` 由 `grok --single`（单轮模型问答）改为 `runAcpPrompt`（完整 bot 循环）。
- 认证方式：有 `XAI_API_KEY` 走 `xai.api_key`，否则走 `grok login` 本机登录态（`grok login --device-auth` 生成 `XXXX-XXXX` 短码，去浏览器授权）。

## 5. 待办（逐平台实测后补全矩阵）

- [x] claude：实机验证 `claude -p --output-format stream-json` 需 `--verbose`（已补参数）。
- [x] kimi：调研确认 `kimi acp` 走 ACP（新版 npm `@moonshot-ai/kimi-code`），catalogAdapter 已落地 acp 模式。
- [x] cody / windsurf：调研确认无 headless 编码 agent CLI（cody 的 `sourcegraph cli` 是代码搜索工具；windsurf 是 IDE/GUI），维持未接入。
- [x] doubao：**2026-11-05 修正**——字节 TRAE 已发布 CLI（终端 AI 编程），headless 非交互模式待实测。
- [ ] gemini / cursor / qwen：确认 `agent stdio` 的 ACP 入口与认证参数。
- [ ] opencode / dsh：实测 CLI，确定是否支持 ACP / headless 命令。
- [ ] doubao（TRAE CLI）：实测 headless 非交互参数，确认后补 CatalogAdapter 接入。

---

*本矩阵基于 2026-11-02 对 ACP 协议公开资料与 grok CLI 实测；2026-11-04 补充 kimi/cody/doubao/windsurf 调研结论与 claude --verbose 实测；2026-11-05 修正 doubao（TRAE CLI 已发布）。未确认项不臆测。*
