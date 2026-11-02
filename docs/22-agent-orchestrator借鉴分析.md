# 22 · agent-orchestrator 借鉴分析

> 调研对象：https://github.com/OrchestratorInc/agent-orchestrator（Apache-2.0，本地桌面工作区编排多编程 agent）。
> 目标：对照 AgentMesh 现状，找出可借鉴/引用的功能与架构。

## 1. 一句话定位

agent-orchestrator 是「本地桌面工作区，编排一整支编程 agent 队伍」——主智能体规划、多个 worker 在独立 git worktree 里并行干活，CI/评审/合并冲突自动闭环，只在需要人时打扰你。

与 AgentMesh 的核心差异：**它管的是「同一台机器的 git 仓库 × 多 agent 协作」；AgentMesh 管的是「多台设备 × 多 agent 蜂群协同」**。两者互补，前者偏"代码协作编排"，后者偏"跨设备调度"。

## 2. 可借鉴点（按价值排序，标注 AgentMesh 现状）

| 借鉴点 | 说明 | AgentMesh 现状 |
|--------|------|----------------|
| **能力矩阵（Worker/Chat/Reviewer）** | 不把 agent 看成单一"执行器"，而是三维能力：干活/对话/评审，每个 agent 标注各自支持度 | 仅有 `capabilities[]`，未区分角色维度 |
| **AI reviewer 前置** | 用评审智能体先审 PR，过滤低级问题再交人工 | 无（无 Git 集成） |
| **Git worktree 物理隔离** | 每个任务独立 worktree + 分支，从机制上避免并发写冲突 | 无 |
| **自动化反馈闭环** | CI 失败/评审意见/合并冲突自动路由回"肇事" worker 修复 | 有任务重试，无 CI 闭环 |
| **执行环境抽象（本地/云端）** | 任务可选本机或云端执行，云端任务合盖后继续跑 | 有中继通道，但无"云端执行工作区" |

## 3. AgentMesh 已具备 / 已落地的对应能力

以下 agent-orchestrator 的核心机制，AgentMesh **已实现**，无需重复造：

| agent-orchestrator | AgentMesh 对应 |
|--------------------|----------------|
| Orchestrator-Worker 主从 | 主 AI agent + 团队模式（A=开发/B=内容） |
| 状态驱动看板（Needs you 置顶） | 「待处理」摘要条 + 神经图 + 任务六态 |
| 跨设备二维码配对 + 远程调度 | 配对码 + 微信网关下发任务 |
| 守护进程 + CLI + 桌面 UI 分层 | backend 协调器 + device-agent 守护 + 前端看板 |
| 插件化智能体接入（30+ 平台） | Adapter 接口 + platformCatalog（13 平台） |

## 4. 建议落地（优先级）

1. **能力矩阵升级**：把 `capabilities[]` 升级为「执行 / 对话 / 评审」三维，agent 平台标注各自支持度，调度与评审按维度选型。→ 与 DSH 借鉴的「角色路由 + 授权」衔接。
2. **评审智能体角色**：引入 reviewer 角色（对齐 DSH 的 `review-verdict` 角色），先于人工评审。
3. **Git worktree 隔离**：AgentMesh 接 Git 仓库后，任务级 worktree 避免多 agent 并发冲突。
4. **执行环境抽象**：任务 target 加 `local|cloud` 维度，复用中继通道做"云端执行"。

## 5. 明确不借鉴

- **桌面 App / 移动 App 形态**：AgentMesh 是 Web 看板 + 微信，不需要 Electron 桌面壳。
- **GitHub PR/CI 强绑定**：AgentMesh 的入口是看板 + 微信，不绑定单一代码托管平台。

---

*分析基于 2026-11-02 对该项目 README.zh-CN 的通读；架构细节（CDC/状态推导/守护边界）在其 docs/architecture.md，如需深入再查。*
