# Orca 与 AgentMemory 借鉴分析 + Phase 1 规划

> 调研日期：2026-11-02。两项目均为实时访问 GitHub 所得。
> 一句话结论：**Orca 与我们定位撞车但方向不同，其「agent 进程生命周期状态机」最值得借鉴；AgentMemory 印证了「区块链记忆账本在单机场景过度设计」的判断，我们只剩「可审计防篡改」一个差异化点，语义检索必须补。**

---

## 一、Orca（stablyai/orca）：借鉴「调用 agent 的方法」

### 定位：撞车但不冲突

| | Orca | AgentFleet |
|---|---|---|
| 定位 | 「Agent 舰队」工作台，用自己的订阅在一处运行多编码 Agent | 「多设备智能体舰队」，跨设备统一调度已装 agent |
| 范围 | 单用户、单设备（桌面/移动/远程运行时） | 多设备 = 多蜂群协同 + 分布式调度 |
| 差异 | 偏「个人工作台」，BYO 订阅，不转售 token | 偏「跨设备编排」，含记忆账本 + 模型网关 + 角色路由 |

**注意**：Orca 也用了「fleet」这个词，说明「agent 舰队」心智正在被多家抢占（此前已发现 Cindy 用「跨设备」、CodeBee 用「码蜂」）。我们的差异化必须更清晰——**「多设备蜂群协同 + 可审计记忆 + 内置模型网关」**，而非单设备多 agent 工作台。

### 可借鉴的 agent 调用方法（重点）

Orca 直接 spawn CLI agent（Codex 走 `codex-fetcher.ts` + Windows `cmd.exe /c` 路由），**未用 ACP**，但建模了比我们更完整的生命周期：

1. **统一 agent 进程生命周期状态机**（最值得借鉴）
   Orca 对 Claude（native-chat）和 Codex 都建模了 `acquisition → initialize → resume → send/turn/result → failure attribution` 的完整状态机，把「启动失败 / 发送失败 / 结果丢失」精确归属到具体会话与消息。
   - 我们现状：grok 走 ACP 有生命周期，但 12 个骨架平台（CatalogAdapter）没有统一的生命周期抽象。
   - 借鉴动作：为所有适配器定义统一的生命周期接口（detect → start → send → stream → result → failure attribution），错误事件精确归属。

2. **进程生成的平台安全层**
   `getSpawnArgsForWindows()`、`cmd.exe /c` 路由、`/d` 禁 AutoRun、`windowsHide: true`、EPERM 重试。
   - 我们部署脚本已有 OS 自适应，但**运行时**进程生成（adapter 层）可借鉴这些 Windows 细节。

3. **cell / director 模型**（cloud/）
   `reserve cell` + `director` + `load balancer` + `dead-man boot grace`（刚重启的单元有宽限期，不立即调度）。
   - 与我们「设备 = 蜂群、调度器 = 指挥」异曲同工，可借鉴「健康检查 + 启动宽限期」防止刚上线的设备被过早派发。

4. **NDJSON 事件流供 agent 消费**
   插件 `dev watch --json` 输出 NDJSON 事件流，机器可读。
   - 我们已有 TaskEvent 流，可强化为「可对外发布的标准事件流」（与 A2A 结合）。

5. **给 agent 自身提供代码智能（LSP 桥）**
   `agent-typescript-lsp.mjs` 把 pull-only diagnostics 转成 push 式 `publishDiagnostics`。
   - 若让 agent 操作多设备代码，诊断推送会显著影响工作质量。

### 是否引用

- 设计思路（生命周期状态机、cell/director、Windows 进程安全层）可借鉴，需确认 Orca 协议（README 未明确 license，引用前查）。
- **不可照抄**：定位不同（我们是跨设备编排，不是单设备工作台）。

---

## 二、AgentMemory（rohitg00/agentmemory）：对比我们的记忆系统

### 它是什么

30.1k stars 的「AI 编码 agent 持久记忆系统」，Apache-2.0。跨 Claude Code/Cursor/Codex/Gemini CLI 等共享记忆，0 外部 DB、keyless 可用。

### 核心设计

- **4 层记忆整合**（模仿人脑）：Working（原始观察）→ Episodic（会话摘要）→ Semantic（事实模式）→ Procedural（工作流）
- **三重混合检索**：BM25（关键词，始终开启）+ 向量（需 embedding）+ 图（知识图谱），RRF 融合
- **记忆生命周期**：衰减（艾宾浩斯遗忘曲线）、增强、自动驱逐、矛盾检测、版本化取代
- **可审计**：审计追踪、溯源（citation provenance）、版本链、Git 快照、治理删除
- **隐私/合规**：secret scrubbing（API key 自动脱敏）、遗忘权（GDPR）
- **深度集成**：54 个 MCP 工具、12 个 hooks、17 个 skills

### 对比结论：我们的优势只剩一个维度

| 维度 | AgentMemory | 我们的区块链记忆账本 |
|---|---|---|
| 语义检索 | ✅ BM25+向量+图，keyless 84.7% 召回 | ❌ 结构化查询，无语义检索 |
| 易用性 | ✅ `npx` 一次启动，0 DB | ❌ 需跑节点/同步 |
| 性能 | ✅ 毫秒级 | ❌ 共识写入慢 |
| 隐私/遗忘权 | ✅ secret scrubbing + 可删除（GDPR） | ❌ 公开账本，不可删 |
| 编码工作流集成 | ✅ 54 MCP 工具 | ❌ 无 |
| **防篡改可审计** | ❌ 本地文件可改，应用层日志 | ✅ 哈希链 + 共识，密码学可验证 |

**结论**：
- 我们**不是**「有优势」，而是「有一个狭窄但真实的差异化点」——**可审计防篡改**（哈希链 + 梅克尔树 + 共识），适合对抗性/合规场景（医疗、金融 AI 决策留痕）。
- 在「语义召回、易用性、工作流集成」上，我们被 AgentMemory **全面碾压**。
- 这**再次印证**了竞争报告与护城河报告的判断：「区块链记忆账本在单机场景过度设计，应轻量化降级」。

### 我们的正确路线（记忆系统）

1. **轻量化**：砍掉「共识」（单机/小团队不需要拜占庭容错），保留「哈希链 + 签名」做防篡改（tamper-evident log，参考 Google Trillian 思路）。
2. **补语义检索**：借鉴 AgentMemory 的 BM25 + 本地向量（Xenova/all-MiniLM-L6-v2 免费本地推理），给记忆账本加「语义召回层」——这是当前最大短板。
3. **差异化定位**：对外说「**可审计的跨设备团队记忆**」，不说「区块链」，也不跟 AgentMemory 比「语义检索工具」。
4. **借鉴具体点**：4 层整合模型、RRF 融合、记忆衰减/矛盾检测、eventId 幂等去重、secret scrubbing。

---

## 三、Phase 1 规划（剩余三件事）

### 1. MCP client + A2A 端点（策略 6：放大器）

| 项 | 方向 | 优先级 | 说明 |
|---|---|---|---|
| A2A server 端点 | 让 AgentFleet 蜂群被外部 agent 调用 | P0 | 放大杠杆：别的系统能派任务进我们的蜂群 |
| MCP client | 让 AgentFleet 调度器调用外部 MCP 工具 | P1 | 让蜂群能访问外部工具/数据源 |

- A2A 优先：先做「被调用」（对外暴露调度能力），再做「调用」（消费外部工具）。
- 参考 A2A 规范（agentprotocol.ai），端点设计复用现有 ws/HTTP 调度链路。

### 2. 12 平台骨架补齐（good first issue #1~#10）

- 把 12 个 CatalogAdapter 骨架升级为「真接」（参考 grokAdapter.ts 模板，docs/20）。
- 优先顺序：有 headless 能力的平台（codex/gemini/cursor/kimi/qwen 支持 ACP/CLI）优先，aider 无 headless（`aider --message`）最后。
- 关键：用 Orca 借鉴的「统一生命周期状态机」重构 adapter 接口，让 13 平台走同一套生命周期。

### 3. benchmark 数据对外沉淀成「度量标准」

- 落盘一份 `docs/24-benchmark报告.md`（或独立 benchmark 报告），含：
  - 调度内核 benchmark 数据（200 任务约 300 tasks/s、1000 任务约 347 tasks/s，一次性优化约 30 倍；原始记录见 `backend/benchmark-results/runs.jsonl`）
  - 真实多设备 benchmark 数据（2 设备 158、4 设备 193 tasks/s，completed=100%）
  - 故障转移 / 断连迁移数据（lost=0）
  - 可复现命令（`npm run benchmark` / `npm run benchmark:multi`）
- 对外发布：README 加「性能」章节 + 独立 benchmark 页，抢占「跨设备能力」度量标准定义权。

---

## 四、本轮行动项

- [x] Orca 调研 + 借鉴分析
- [x] AgentMemory 调研 + 记忆系统对比
- [x] Phase 1 规划（MCP/A2A + 12 平台 + benchmark 对外）
- [ ] （下一步，待定）从 A2A 端点 / adapter 生命周期重构 / benchmark 报告 中选一个启动
