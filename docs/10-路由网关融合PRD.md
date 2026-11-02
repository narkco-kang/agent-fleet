# 10 · PRD — 路由网关融合 + 六大新功能

> 版本 v0.2 · 产品经理：许清楚 · 状态：待架构评审
> 上游基线：《09-路由网关研究-modelgateway分析与融合》《01-PRD》《modelgateway README》

---

## 1. 项目信息

| 项 | 值 |
|---|---|
| 项目名 | `agent_mesh`（融合进现有 AgentFleet，不新造系统） |
| 语言 | 中文 |
| 技术栈 | Vite + React + MUI + Tailwind CSS（沿用）+ 设备守护进程 + modelgateway 协议对接 |
| 原始需求复述 | 在现有 AgentFleet「设备+agent 平台+任务+记忆」基础上，融合本机自研路由网关 `modelgateway`，并新增六大功能：Excel 批量部署、共享规则、共享资料库、共享 skills、专家团队、Loop 编排 |

---

## 2. 产品定位与目标

**定位**：AgentFleet 从「跨设备智能体调度层」升级为「跨设备超级智能体团队的**完整管理平台**」，新增四层能力——**路由网关适配 + 资产分发 + 批量部署 + 编排**。

| 层 | 能力 | 说明 |
|---|---|---|
| 既有 | 设备网格 + Agent 平台调度 + 任务状态机 + 记忆账本 | 01-PRD 已定义，不变 |
| 新增① | 路由网关适配 | 对接 modelgateway，获得「角色路由 + 故障转移 + 台账额度」 |
| 新增② | 资产分发 | 规则 / 资料库 / skills 统一 Asset 模型，批量/单设备下发 |
| 新增③ | 批量部署 | Excel（IP/账号/密码）一键在目标设备部署 agent 平台 |
| 新增④ | 编排 | 专家团队（角色路由泛化）+ Loop 循环任务编排 |

**产品目标（3 个，正交）**

| # | 目标 | 衡量标准 |
|---|---|---|
| G1 | 闭环管理：从「发现设备」延伸到「部署平台→下发资产→编排任务→角色路由执行」 | 新增设备到可下发任务 ≤ 单次 Excel 部署流程完成 |
| G2 | 资产一次定义、多处复用：规则/资料库/skills 统一模型，批量下发 | 单个 Asset 下发到 N 台设备 ≤ 一次操作；落盘一致性 ≥99% |
| G3 | 编排可控：专家团队按角色路由、loop 循环任务全程可监控可中断 | loop 每轮状态可追踪；角色路由故障自动 failover |

---

## 3. 用户故事

| # | As a… | I want… | So that… |
|---|---|---|---|
| US1 融合·角色路由 | 用户 | 下发任务时只指定「角色」（research/execution/reasoning…），由路由层决定落到哪台设备的哪个 agent/模型 | 我不用记住每台设备的模型配置，坏线路自动切 |
| US2 融合·故障转移 | 用户 | 某条模型线路 401/429/5xx 时自动降级到 fallback | 任务不因单条 API 挂掉而中断 |
| US3 融合·台账额度 | 用户 | 看到每次任务执行消耗的 token 与额度 | 清楚「钱花在哪」，超出预算能预警 |
| US4 Excel 部署 | 用户 | 上传一份含「设备 IP、账号、密码」的 Excel，一键在多台目标设备部署 AI agent 平台 | 批量开荒新设备，不用逐台手动装 |
| US5 Excel 部署·校验 | 用户 | 部署前系统校验 Excel 字段、IP 可达性、OS 类型 | 提前发现坏行，避免半路失败 |
| US6 共享规则 | 用户 | 设定/上传一份规则，批量或单设备下发 | 团队行为规范一致，不用逐台改 |
| US7 共享资料库 | 用户 | 设定/上传资料库，批量或单设备下发 | 各设备 agent 有统一知识底座 |
| US8 共享 skills | 用户 | 设定/上传 skills，批量或单设备下发 | 能力即插即用，统一版本 |
| US9 专家团队·单设备 | 用户 | 为一台设备的 agent 团队分配/建立专家团队（角色分工） | 一台设备内也能组出研究+执行+评审分工 |
| US10 专家团队·跨设备 | 用户 | 建立跨设备专家团队（成员分布多台设备） | 用最强设备干最匹配的活 |
| US11 Loop 编排 | 用户 | 创建单设备/批量设备/跨设备的 loop（循环任务模板） | 周期性重复任务自动跑，无需手动重复下发 |
| US12 Loop 监控 | 用户 | 实时看到 loop 每轮/每步在各设备的状态，可暂停/取消 | 循环任务可控、可追责 |

---

## 4. 需求池

**优先级**：P0 = MVP 必须 · P1 = 快速迭代 · P2 = 长期演进

### 4.1 融合：路由网关适配层

| ID | 优先级 | 需求 | 说明 / 验收 |
|---|---|---|---|
| RG-1 | P0 | 角色路由表数据结构 | 对齐 modelgateway `agent-role-routes.json`：role → primary/fallback/bots；AgentFleet 任务可指定 role 而非具体 agent |
| RG-2 | P0 | 角色路由决策 | 任务指定 role 时，路由层按 role 表决策到「设备+agent+模型」 |
| RG-3 | P0 | modelgateway 协议对接 | 经 `/v1/chat/completions`（OpenAI 协议）对接 modelgateway 作为可选后端 |
| RG-4 | P1 | 故障转移 | 接入 Health 状态机：401/403 禁用、429/5xx 退避 + failover 到 fallback |
| RG-5 | P1 | 台账额度接入 | 复用 ledger.jsonl 思路，任务执行记 token 台账，展示 `/api/usage` |
| RG-6 | P2 | 健康两级探针 | 借鉴 L1 `/models` + L2 最小 chat 探针，升级 AgentFleet 现有静态探测为动态健康 |

### 4.2 F1 · Excel 批量部署

| ID | 优先级 | 需求 | 说明 / 验收 |
|---|---|---|---|
| DEP-1 | P0 | Excel 解析与校验 | 支持上传/输入（设备 IP、账号、密码）；字段校验 + IP 可达性预检 |
| DEP-2 | P0 | SSH 连接与 OS 探测 | node ssh2 连接目标设备，探测 OS 类型（Mac/PC） |
| DEP-3 | P0 | 平台安装脚本执行 | 按 OS 执行 codex/claude/dsh/grok 安装脚本 |
| DEP-4 | P0 | 部署结果回报 | 每台设备成功/失败回报；失败原因可查看 |
| DEP-5 | P0 | 人工确认开关 | 批量部署属「对外动作」，触发前需人工确认开关（安全红线） |
| DEP-6 | P1 | 部署进度实时展示 | 逐设备进度条、失败重试 |
| DEP-7 | P2 | 设备配对 token 替代密码 | 避免密码落库，改用配对 token |

### 4.3 F2/F3/F4 · 资产分发（规则 / 资料库 / skills 统一 Asset 模型）

| ID | 优先级 | 需求 | 说明 / 验收 |
|---|---|---|---|
| AST-1 | P0 | 统一 Asset 模型 | `Asset{ id, kind: rule\|knowledge\|skill, name, content/url, version }` |
| AST-2 | P0 | 资产 CRUD | 设定/上传规则、资料库、skills；版本管理 |
| AST-3 | P0 | 资产分发 | `asset.deploy { assetIds[], targets[] }` 批量或单设备下发 |
| AST-4 | P0 | 设备侧接收落盘 | 设备守护新增「资产接收 + 落盘」，落到 rules/knowledge/skills 目录 |
| AST-5 | P0 | 人工确认开关 | 资产下发对外动作，需人工确认 |
| AST-6 | P1 | 下发状态追踪 | 每设备接收/落盘成功/失败状态回传 |
| AST-7 | P1 | 资产版本比对 | 目标设备版本落后时提示升级 |
| AST-8 | P2 | 资产模板/市场 | 规则、skills 模板库 |

### 4.4 F5 · 专家团队（角色路由泛化）

| ID | 优先级 | 需求 | 说明 / 验收 |
|---|---|---|---|
| TM-1 | P0 | 团队数据模型 | `Team{ id, name, members: [{ role, deviceId?, agentType? }], routes }` |
| TM-2 | P0 | 自定义团队建立 | 建立单设备团队 / 跨设备团队 |
| TM-3 | P0 | 角色路由复用 | 一个「专家团队」= 一组 role→设备+agent+模型 映射（复用 RG-1 概念，不新造） |
| TM-4 | P1 | 团队分配 | 将团队分配给单设备 agent 团队或跨设备批量 |
| TM-5 | P2 | 团队模板（参考 WorkBuddy） | 预置常见团队角色组合 |

### 4.5 F6 · Loop 编排

| ID | 优先级 | 需求 | 说明 / 验收 |
|---|---|---|---|
| LP-1 | P0 | Loop 数据模型 | `Loop{ id, name, steps: [任务模板], schedule/trigger, targets, state }` |
| LP-2 | P0 | Loop 创建 | 单设备 / 批量设备 / 跨设备批量 loop |
| LP-3 | P0 | Loop 调度 | 复用 AgentFleet 任务状态机，新增 loop 编排器按序/条件循环执行 steps |
| LP-4 | P0 | 每轮状态追踪 | 每轮/每步在各设备状态可查看 |
| LP-5 | P0 | 人工确认开关 | loop 触发对外动作需人工确认 |
| LP-6 | P1 | 暂停/取消/重跑 | loop 运行中可暂停、取消、从某步重跑 |
| LP-7 | P2 | 定时/事件触发 | schedule 定时 + 事件触发（如文件变化） |

---

## 5. 核心功能模块清单

| 模块 | 职责 | 关键点 |
|---|---|---|
| 路由网关适配层 | 角色路由 + 故障转移 + 台账额度，对接 modelgateway | 角色路由表对齐 `agent-role-routes.json`；任务指定 role；`/v1/chat/completions` 协议对接；ledger 台账 |
| 资产管理层 | 规则 + 资料库 + skills 统一 Asset 模型与版本 | 统一 `Asset{ kind, version }`；CRUD + 版本管理；下发命令 |
| 批量部署层 | SSH + Excel 批量部署 agent 平台 | Excel 解析校验 → SSH → OS 探测 → 安装脚本 → 回报；人工确认开关 |
| 专家团队层 | 角色路由泛化为团队 | `Team{ members[{role, deviceId, agentType}] }`；单/跨设备团队；复用角色路由不新造 |
| Loop 编排层 | 循环任务编排 | `Loop{ steps, trigger, targets, state }`；复用任务状态机 + 编排器；每轮状态追踪 |

**分层关系**

```
AgentFleet（既有）         新增
─────────────────────     ──────────────────────────
设备网格层 / Agent 平台层   批量部署层（SSH+Excel）
任务调度状态机   ←融合→    路由网关适配层（角色路由/故障转移/台账）
记忆账本层                资产管理层（规则/资料库/skills）
                          编排层（专家团队 + Loop）
```

---

## 6. 关键决策点

| # | 决策 | 结论 |
|---|---|---|
| D1 | 融合方式 | 不移植 modelgateway 代码；AgentFleet 新增「路由网关适配层」，modelgateway 作为可选后端协议对接。**AgentFleet 管「谁在哪个设备执行」，modelgateway 管「用哪个模型/角色、坏了怎么切、花了多少」** |
| D2 | 专家团队 | 专家团队 = 角色路由的泛化（role→device+agent+model），不新造团队概念，复用 modelgateway 的 role 模型 |
| D3 | 资产 | 规则/资料库/skills 统一为 Asset 模型（kind 区分），复用传输层下发 |
| D4 | 安全红线 | Excel 部署、资产下发、loop 编排均属「对外动作」，一律需人工确认开关（对齐项目铁律） |
| D5 | 部署安全 | 密码不落库明文，优先设备配对 token 替代密码（P2），MVP 先最小可用 |

---

## 7. 待确认问题清单

| # | 问题 | 影响 | 建议默认 |
|---|---|---|---|
| Q1 | Excel 密码字段明文还是加密？ | 安全、落库方式 | MVP 不落库明文，仅内存使用；后续转配对 token |
| Q2 | SSH 用密码还是密钥认证？ | 部署连通性、安全 | MVP 密码（对齐 Excel 输入），P1 支持密钥 |
| Q3 | 专家团队是否复用 modelgateway 的 role 概念（research/execution/reasoning/review…）？ | 数据模型一致性 | 复用 role 概念 + 可自定义扩展角色 |
| Q4 | Loop 的触发方式：手动 / 定时 / 事件？ | 编排复杂度 | MVP 手动触发，P2 定时+事件 |
| Q5 | modelgateway 是否必须在线才可用角色路由？还是 AgentFleet 本地兜底角色表？ | 架构可靠性 | AgentFleet 本地存角色路由表副本，modelgateway 在线时增强故障转移/台账 |
| Q6 | 资产下发目标设备离线时如何补偿？ | 一致性 | 离线排队，上线后补发（对齐断线降级策略） |
| Q7 | Excel 部署支持哪些 OS 范围（Mac/Windows/Linux）？ | 安装脚本适配工作量 | MVP 先 Mac + Windows |
| Q8 | 专家团队是否支持「一台设备多个团队 / 一个团队跨设备」并存？ | 模型复杂度 | 支持，Team.members 的 deviceId 可空（表示路由时再定） |

---

*本文档为融合 PRD 基线，架构设计以本文 +《09-路由网关研究》为准。*
