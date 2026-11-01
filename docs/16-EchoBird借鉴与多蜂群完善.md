# 16 · EchoBird 借鉴与多蜂群完善

## 1. 核心定位修正

AgentMesh 可以明确描述为：

> 每台设备是一支本地蜂群，设备上已安装的 Codex / Claude / Gemini / Aider / Cursor 等 agent 平台是该蜂群内的工蜂；整个 AgentMesh 是多设备、多蜂群协同系统，由协调器、模型路由网关和记忆账本统一调度。

这个表述比“跨设备超级智能体团队”更利于用户理解：
- 设备 = 蜂群边界（本地资源、账号、CLI、网络环境）
- agent 平台 = 蜂群内工蜂（可独立执行任务）
- backend = 蜂群调度中枢
- modelgateway = 蜂群共享的模型花蜜/能量路由
- memory ledger = 多蜂群的共享记忆账本

## 2. EchoBird 可借鉴点

调研 EchoBird 后，AgentMesh 本轮采纳以下产品模式：

| EchoBird 模式 | AgentMesh 对应落点 |
|---|---|
| Model Nexus：模型配置一次，到处使用 | 路由网关新增“付费 Provider”批量配置，集中管理 OpenAI/DeepSeek/自建 Router 等模型源 |
| Smart Router：本地统一 API + failover | 内置 `modelgateway/` workspace，提供 OpenAI 兼容 `/v1/chat/completions` 和 `/v1/models` |
| Install & Repair Agent | 新手引导把部署、网关、Provider、平台模型绑定串成一条启动路径 |
| App/Tool Manager | AgentMesh 的部署管理页负责 13 平台安装/卸载 + 协调器组件启停 |
| Quota / Usage 可视化 | 路由网关页保留 token 台账、免费源探测、签到审计 |
| 一键切模型 | 平台模型页支持设备+agent 主模型、兜底模型、手动切换/重置 |

## 3. 本轮新增/完善

### 3.1 付费 Provider 批量配置 UI

新增 `路由网关 → 付费 Provider`：
- 支持 JSON 数组批量粘贴配置：`id / label / baseUrl / apiKey / models`
- API Key 只保存到本机 `.workbuddy-ai/modelgateway-providers.json`
- 仓库 `.gitignore` 已忽略 `.workbuddy-ai/`
- 前端读取时只脱敏回显
- 保存后重启 modelgateway 生效
- `MG_PAID_PROVIDERS` 环境变量仍可用，且同 id 优先级高于 UI 文件配置

### 3.2 modelgateway 读取 UI Provider 配置

`modelgateway/src/config.ts` 现在合并两路 Provider：
1. 本机 `.workbuddy-ai/modelgateway-providers.json`
2. 环境变量 `MG_PAID_PROVIDERS`

同 id 冲突时环境变量优先，便于 CI/容器/高级用户覆盖。

### 3.3 新手引导

首次进入前端会弹出五步引导：
1. 设备即蜂群
2. 启动内置 modelgateway
3. 配置免费源与付费 Provider
4. 一键部署并自动绑定平台模型
5. 查看自动/手动故障切换

用户可随时在顶栏点击“新手引导”重新打开。

### 3.4 自动签到增强

`startCheckinLoop()` 增加：
- `FREE_CHECKIN_ENABLED=1`：默认启用定时签到
- `FREE_CHECKIN_ON_START=1`：启动后延迟执行一次
- `FREE_CHECKIN_START_DELAY_MS=5000`：启动延迟
- `FREE_CHECKIN_INTERVAL_MS=21600000`：默认 6 小时

免费源页新增“自动签到源”状态卡，展示是否启用、最近签到结果和审计信息。

## 4. 已确认链路

### 4.1 部署完成直接可用

一键部署 Excel/JSON 支持以下字段：
- `deviceId`
- `platforms`
- `models` / `modelConfigs`

部署成功后 `deployService.runTarget()` 调用 `bindPlatformModels()`，自动为该设备 agent 平台绑定网关模型。

### 4.2 免费源评级只保留优/中

`freeSourceService.probeAllFreeSources()` 综合探测：
- modelgateway 免费线路
- shared 直连免费源目录（Kilo/OpenCode）

评级为优/中/差；最终 `ranked/usable` 只保留优和中，差仅保留在原始探测结果中用于诊断。

### 4.3 模型故障自动/手动切换

- 自动：scheduler 执行平台模型绑定任务时，主模型失败会调用 `markModelFailed()` 并尝试下一个 fallback；全部失败则把绑定标为 `degraded` 并降级本地 agent。
- 手动：`/api/routing/platform-models/:deviceId/:agentType/switch` 切换到指定已知模型；`reset` 清空排除表并恢复健康。

## 5. 安全边界

- 部署 SSH 密码仍只在内存中保存，执行后清除。
- 付费 Provider API Key 不进数据库、不进 Git、不明文回显；仅写入本机 `.workbuddy-ai/modelgateway-providers.json`。
- 若用户希望容器化/CI 部署，推荐使用 `MG_PAID_PROVIDERS` 环境变量覆盖。
