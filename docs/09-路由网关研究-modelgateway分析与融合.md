# 09 · 路由网关研究：ModelGateway 分析与 AgentFleet 融合

> 目标：全面分析本机自研智能体路由网关 `modelgateway`，提炼其可融合进 AgentFleet 的能力，并为 6 个新功能（Excel 部署 / 规则 / 资料库 / skills / 专家团队 / loop）给出设计思路。
> 约束：不额外新造系统，融合进 AgentFleet 项目（结合进 `agent-fleet/`）。modelgateway 原目录只读参考。

---

## 1. ModelGateway 全面分析

### 1.1 定位

`modelgateway`（本地模型网关 + 观测面板，Node 24 原生零依赖，对标 CC Switch）：回答三个问题——**现在哪条路是通的、钱花在哪、谁连了谁**。

### 1.2 五大能力（README 自述）

| # | 能力 | 实现 |
|---|---|---|
| 1 | 识别并自动切换坏 API | `Health` 类 TCP 状态机；401/403 永久禁用，429/5xx 降权退避尊重 Retry-After；两级探针（L1 `/models` + L2 `max_tokens=1` 最小 chat 拦「列表通但推理挂」）；转发失败立即 failover |
| 2 | 自动采集免费模型 | 定时抓公开模型表 → 并发池(8)+60s 预算探针 → 入库 |
| 3 | token 消耗与额度 | `ledger.jsonl` 台账 + `/api/usage` + `/api/quota`（OpenRouter / ModelScope 官方口径，其余标 unknown） |
| 4 | hermes 智能体拓扑 | `hosts.mjs` 宿主适配器（DSH Desktop Bot / Grok Bot agent / hermes profiles），三层图 **host→agent→provider→model** |
| 5 | 桌面启动 + 自启 | LaunchAgent 开机自启 + 崩溃拉起 |

### 1.3 统一协议与路由

- `/v1/chat/completions` 对外统一 OpenAI 协议（支持 stream），响应头 `x-mg-provider` 标明命中 provider。
- 上游双协议：`openai` 直通；`anthropic` 自动转换（system 提顶层、max_tokens 默认、token 映射、SSE 转译）。
- 分组（groups.json）+ 组内三级兜底（primary/fallback）。

### 1.4 智能体角色路由（agent-role-routes.json · 关键）

CEO 主控，按「角色」路由到具体模型/组/bot，每个角色有 `primary + fallback + capability + bots`：

| 角色 | primary | bots | 用途 |
|---|---|---|---|
| research | kimi/k3.1-pro-highspeed | Kimi仔 | 研究取证 |
| execution | mgs-tiered/group/mini-tiered | Mini仔 | 执行（含三级兜底） |
| reasoning | mgs-glm/group/strong | Glm仔 | 极长上下文推理 |
| review-verdict | jev-ai/jev-latest | Jev仔 | 决策引擎（decision-only） |
| external-claude | mgs-claude/group/strong | Claude仔 | 外部 claude-code |
| external-hermes | mgs-hermes/group/long-context | Hermes仔 | 长上下文专属 |
| external-codex | gpt/gpt-6.1-sol | Codex仔 | 网关无 gpt 线路，暂直连 |
| free-tier | free-models/kilo-auto/free | Free仔 | 免费体验档 |

### 1.5 其他关键模块（server/）

| 模块 | 职责 |
|---|---|
| `gateway.mjs`（6455 行） | 主网关：健康/路由/台账/额度/拓扑/agent 入驻/委托 |
| `hosts.mjs` | 宿主适配器（DSH/Grok/hermes 拓扑） |
| `capability.mjs` | 能力探测（区分「未知」与「上游明确报 0」） |
| `free-tier.mjs` / `b16.mjs` / `idle-budget.mjs` | 免费层 / 收编开关 / 空闲预算 |
| `command-window.mjs` | 命令窗口 |
| `pin-trace.mjs` / `request-normalize.mjs` / `sse-*` | 固定追踪 / 请求归一化 / SSE 方言 |

### 1.6 数据文件（data/）

`providers.json`（供应商注册表）、`ledger.jsonl`（请求台账）、`free-sources.json`（免费源）、`events.jsonl`（事件流）、`groups.json`（分组）、`agent-role-routes.json`（角色路由）、`agent-directory.json` / `agent-ledger.jsonl` / `agent-onboard.jsonl` / `agent-delegate.jsonl`（agent 目录/账本/入驻/委托）、`capabilities.json`（能力）。

---

## 2. 与 AgentFleet 的融合点

### 2.1 分层互补（核心洞察）

两个系统在不同层级，融合是自然的分层叠加：

```
AgentFleet（已有）          ModelGateway（融合）
─────────────────────      ──────────────────────────
设备网格层（mDNS 发现）     宿主层 host（DSH/Grok/hermes）
Agent 平台层（Codex/Claude  agent 层（Bot/agent 定义）
           /DSH/Grok）
任务调度层（状态机/路由）    ← 融合点 →  角色路由 + 故障转移 + 台账额度
记忆账本层（区块链式）       模型层 provider→model
```

**融合定位**：AgentFleet 调度「设备上的 agent 平台」，agent 平台背后经 ModelGateway 做「模型级路由 + 角色路由 + 故障转移 + 台账」。即 AgentFleet 管「谁在哪个设备执行」，ModelGateway 管「执行时用哪个模型/角色、坏了怎么切、花了多少」。

### 2.2 可复用的能力（直接借鉴）

1. **健康状态机 + 两级探针 + failover**：AgentFleet 的 agent 平台探测/健康检查可借鉴（现在是静态探测，可升级为动态健康 + 故障转移）。
2. **角色路由**：AgentFleet 的「专家团队」= 一组角色路由（复用 modelgateway 的 role→bot→model 模型）。
3. **台账/额度**：AgentFleet 的任务执行可接入 token 台账（复用 ledger.jsonl 思路）。
4. **统一协议**：AgentFleet 的 agent 适配器可借鉴「统一 OpenAI 协议 + anthropic 转换」的思路。

### 2.3 融合方式（约束：不新造系统）

不移植 modelgateway 代码，而是：**AgentFleet 新增「路由网关适配层」**，通过协议对接 modelgateway（modelgateway 作为可选后端，AgentFleet 的 agent 执行时可经其路由）。MVP 阶段：定义「角色路由表」数据结构（对齐 agent-role-routes.json），AgentFleet 的任务可指定角色（role）而非具体 agent，由路由层决策。

---

## 3. 六个新功能设计思路

### F1 · Excel 批量部署 AI agent 平台

上传/输入 Excel（设备 IP、账号、密码）→ 一键在目标设备部署 agent 平台。
- 数据模型：`DeploymentTarget{ ip, user, auth, os, platforms[] }`
- 流程：解析 Excel → 校验 → SSH 连接（node ssh2）→ 探测 OS → 安装平台（codex/claude/dsh/grok 的安装脚本）→ 验证 → 回报
- 安全：密码不落库明文（或用设备配对 token 替代密码）；康的红线——批量部署属「对外动作」，需人工确认开关。

### F2/F3/F4 · 规则 / 资料库 / skills 分发

设定或上传「规则 / 资料库 / skills」，批量或单设备下发。
- 统一「资产（Asset）分发」模型：`Asset{ id, kind: rule|knowledge|skill, name, content/url, version }`
- 分发：`asset.deploy { assetIds[], targets: [deviceId...] }` → 推送到目标设备守护 → 设备落盘到对应目录（rules/knowledge/skills）
- 复用 AgentFleet 传输层（局域网 + 中继），设备守护新增「资产接收 + 落盘」能力。

### F5 · 专家团队分配（参考 WorkBuddy）

为单设备 ai agent 团队或跨设备分配专家团队、建立自定义团队。
- 数据模型：`Team{ id, name, members: [{ role, deviceId?, agentType? }], routes: role→模型路由 }`
- 复用 modelgateway 的「角色路由」概念：一个「专家团队」= 一组角色（research/reasoning/execution/review...）映射到具体设备+agent+模型。
- 分配：单设备团队（成员都在一台设备）或跨设备团队（成员分布多台设备）。

### F6 · Loop 编排

创建单/批量设备或跨设备批量的 loop（循环任务编排）。
- 数据模型：`Loop{ id, name, steps: [任务模板], schedule/trigger, targets, state }`
- loop = 一组任务模板按顺序/条件循环执行，可绑定单设备或跨设备批量。
- 复用 AgentFleet 任务调度状态机，新增「loop 编排器」：调度 loop 的各 step 到目标设备，跟踪每轮状态。

---

## 4. 关键设计决策建议

1. **融合分层**：AgentFleet（设备+agent 平台+任务+记忆）+ 新增「路由网关适配层」（角色路由 + 故障转移 + 台账，对接 modelgateway 协议）+ 新增「资产管理层」（规则/资料库/skills）+ 新增「部署层」（SSH 批量部署）+ 新增「编排层」（专家团队 + loop）。
2. **专家团队复用角色路由**：不新造团队概念，而是把 modelgateway 的 role→bot→model 泛化为 role→device+agent+model。
3. **资产分发复用传输层**：规则/资料库/skills 都是「资产」，统一 Asset 模型 + 传输层下发。
4. **安全红线**：Excel 部署、资产下发、loop 编排都涉及「对外动作」，需康人工开关控制（对齐康的项目铁律）。

---

*本文档为融合基线，后续 PRD / 架构设计以此为准。*
