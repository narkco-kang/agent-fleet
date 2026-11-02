# 19 · dsh-superagent 借鉴分析与 AgentMesh 落地

> 调研对象：https://github.com/deepseek-ai/dsh-superagent-prototype（DeepSeek Harness 的主动编码 agent 原型，MIT）。
> 目标：找出适合优化/完善 AgentMesh 的功能与架构，并标注「已落地 / 建议落地 / 暂缓」。

## 0. 一句话结论

dsh-superagent 最有价值的部分**不是某个功能，而是两条原则与两套机制**：

1. **原则 A ——「只把需要人的东西摆到人面前」**（面板优先展示待人工项，健康态不占空间）。这直接催生了本次 AgentMesh 的「点神经元 → 弹平台应用 → 登录激活」功能。
2. **原则 B ——「尽可能少占用人的注意力」**（只在必须人行动时开口，诚实报告）。
3. **机制 A —— 单写者 + 事务 + 持久副作用队列**（领域核心纯同步，副作用在提交后幂等执行）。
4. **机制 B —— 分层授权/激活模型**（allowed list + 准入表 + accept mode + Mandate + strength）。

## 1. 可借鉴清单（按价值排序）

### 1.1 面板「只展示需要人」+ 诚实状态 / 安静默认 ✅ 已部分落地

- DSH 的 Panel 回答三个问题：① 现在有事需要我吗？② 系统健康、在做对的事吗？③ 某件工作的完整历史？
- 每个面板元素要么回答这三个问题之一，否则删除；健康态不占空间；数字只在能改变操作者行为时出现；需要人的行直接给操作入口。

**AgentMesh 现状**：神经图/看板主要展示拓扑与状态，缺少「哪些平台待登录激活」「哪些动作待人工确认」的第一优先级视图。
**已落地（本次）**：点击神经图 agent 神经元 → 详情抽屉「打开平台应用登录激活」按钮，把「需要人登录」这个动作直接接到节点上。
**建议进一步**：在看板/设备页顶部增加一个「待处理」摘要条（待激活平台数、待确认动作数、告警数），健康态折叠。

### 1.2 分层授权 / 激活模型 ⭐ 最值得借鉴

DSH 的授权是**分层且可版本化**的：

| 概念 | 含义 | 对应 AgentMesh |
|------|------|----------------|
| allowed list | 谁可以发起工作 | 设备/用户白名单 |
| admission table | 按接收范围 × 发送者 × 是否 @ 决定准入 | 平台激活准入 |
| accept mode | `off` / `observe` / `auto` | 部署/路由放行策略 |
| Mandate | 授权范围 + 强度 + 依赖的策略版本 | 平台激活态 + 绑定模型 |
| strength | `explicit` / `inferred` | 显式 vs 推断激活 |

**对 AgentMesh 的启示**：目前 agent 只有 `available/busy/error` 三态，缺少「**已安装但未登录激活**」这一关键态。建议引入：
- agent 新增 `needs_login`（已探测但未激活）状态；
- 只有 `available`（已激活）的平台才能接任务；
- 「打开平台应用登录」是激活动作（本次已做），登录成功后由设备守护重新探测并上报，状态从 `needs_login` → `available`。

### 1.3 单写者 + 事务 + 端口/适配器分离

- `Engine` 是 Triggers/Threads/Decisions/Tickets/Assignments 的**唯一写入者**，所有方法同步、每命令一个事务。
- 端口在事务内排队外部工作，adapter 在 `afterCommit` 后执行 → 领域一致性与副作用彻底分离。
- 调用方只拿到最小权限的 `Pick` 接口（`EngineForSources` / `EngineForMainSession` / `EngineForPeople` / `EngineForExecutor`）。

**AgentMesh 现状**：后端已有 repo 层与 actionGuard，但副作用（部署、资产分发、loop 触发）与领域逻辑交织在 service 里，缺统一的事务边界与「单一写入者」约束。
**建议**：借鉴「命令（祈使式，可拒绝）vs 报告（过去式，记录已发生）」命名与「每个状态一个写入者」约束，收敛 scheduler/deploy/asset 的写入路径。

### 1.4 持久 Effects 副作用队列 ⭐ 建议落地

- 幂等 key（`kind/key` 唯一）+ 重试替换 payload（coalescing）+ 指数退避 + `Later` 延期不计失败 + drain 时保留 pending。
- 六类 effect：assessment / launch / delivery / relay / notice / reply，各自独立并发与重试策略。

**对 AgentMesh 的启示**：`deploy`/`uninstall`/`asset_deliver`/`loop_start` 目前是「确认即同步执行」。若进程在执行中崩溃，会丢状态。建议引入持久副作用队列（SQLite `effect` 表），保证：
- 幂等（同 key 不重复执行）；
- 崩溃恢复（重启后 drain pending）；
- 重试退避（SSH 部署/资产分发失败重试）。

### 1.5 域模型：授权(Mandate) 与上下文(Subscription) 分离

- Mandate（授权范围）与 Subscription（订阅线程作上下文）是两个独立概念；「谁有权做」与「做什么事」分离。
- 命名约定：请求式命令 `stopTicket` / 事实式过去式 `assignmentStarted` / 名词查询 `candidate`。

**对 AgentMesh 的启示**：任务下发目前是「目标（设备/agent/角色/团队）+ 提示词」单一模型，可借鉴「授权（谁能接、范围到哪）与上下文（参考哪些历史/线程）分离」，为后续多轮协作/记忆注入铺路。

### 1.6 诚实报告 / 最小注意力哲学

- 「agent 代表团队账户发言，每条消息都在消耗同事的注意力，你要为它负责」。
- 从不绕过限制来回避提问；草稿标未完成；失败如实报告。

**对 AgentMesh 的启示**：微信网关/看板通知应遵循「只在必须人行动或能用上结果时说话」，避免刷屏。任务失败原因要结构化（`code + values`），而非自由文本。

### 1.7 HealthBoard（健康看板）

- 每部分一个健康条目、**一个写入者**、拒绝二次声明；失败三次报错、成功清除。

**对 AgentMesh 的启示**：内置 modelgateway / 中继 / 设备守护 / 免费源各挂一个健康条目，网关健康页统一展示（现有「网关健康」tab 可扩展为全系统健康看板）。

### 1.8 版本化配置 + 幂等 ID + 生成列优化

- Settings/Prompts 用 `Versions` 编号快照 + `policyVersion` 哈希；schema 版本只增。
- `key(id)` 从输入派生 id，相等输入产生相等 id → 天然幂等。
- SQLite 生成列（active/open/subscribed/dropped）+ 索引 → pass 只读活跃工作。

**对 AgentMesh 的启示**：角色路由表 / 付费 Provider 配置可加版本化与哈希指纹；Trigger/资产 id 可从内容派生保证幂等；schema 已有生成列经验可继续复用。

## 2. 本次已落地（对应 DSH 的「面板优先展示需要人 + 激活」）

实现了「点击神经图神经元 → 弹出平台应用 → 登录激活」：

- **协议层**（`shared`）：新增 `device.platform_open` / `device.platform_open_ack` 消息类型与 `PlatformOpen`/`PlatformOpenAck`；新增纯函数 `launchCommandFor(platform, os)` 生成 OS 自适应启动命令（GUI 应用 `open -a` / CLI `osascript` 终端 / `start cmd /k` / `x-terminal-emulator`）。
- **设备层**（`device-agent`）：`handleEnvelope` 处理 `platform_open` → detach spawn 启动应用 → 回传 ack。
- **协调层**（`backend`）：`POST /api/devices/:id/platforms/:agentType/open` 下发指令；wsServer 记录 ack 日志。
- **前端**：神经图 agent 神经元点击 → 详情抽屉「打开平台应用登录激活」按钮（loading/成功/失败态）；新手引导新增「登录激活平台」步骤（版本号升级到 v2 以重新展示）。

## 3. 建议下一步（优先级排序）

1. **agent `needs_login` 状态**：把「已探测未激活」显式化，仅 `available` 可接任务；登录后守护重探测上报转 active（落地 1.2）。
2. **看板「待处理」摘要条**：顶部聚合「待激活平台 / 待确认动作 / 告警」，健康态折叠（落地 1.1）。
3. **持久副作用队列**：为 deploy/asset/loop 引入 `effect` 表，幂等 + 崩溃恢复 + 重试退避（落地 1.4）。
4. **全系统健康看板**：扩展网关健康页为各组件健康条目聚合（落地 1.7）。
5. **版本化配置**：角色路由/Provider 配置加版本与哈希（落地 1.8）。

## 4. 明确不借鉴的

- **GitHub/Feishu Source 插件体系**：AgentMesh 的入口是神经图看板 + 微信网关，不需要通用 Source 插件层。
- **DeepSeek Harness 专属 bundle/cordis 打包**：与 AgentMesh 的 monorepo npm workspaces 无关。
- **Ticket/Eval/Assignment 完整状态机**：AgentMesh 任务模型更轻，避免过度设计；仅借鉴「授权与上下文分离」的思想。

---

*分析基于 2026-11-02 对仓库 README、docs/000~008（哲学/域模型/授权/执行/提示词/面板/部署/架构/厨艺书）的通读。*
