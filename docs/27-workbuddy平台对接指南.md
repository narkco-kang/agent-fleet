# WorkBuddy 平台对接指南

> 第 14 平台（workbuddy）。核心结论：**WorkBuddy 不是可 headless 调度的 agent 平台，它的 agent 能力锁在桌面应用里**，激活和使用都依赖「WorkBuddy 桌面应用运行 + 从 WorkBuddy 上下文启动 device-agent」。

---

## 一、定位与本质区别

| | grok / codex / claude | workbuddy |
|---|---|---|
| 登录态 | OAuth 后 token **落盘**，CLI 复用 | `$wbEncrypted` 加密，**密钥只在桌面主进程** |
| 进程模型 | 系统守护进程即可 | **必须从 WorkBuddy 上下文启动**（继承密码） |
| 执行入口 | 稳定 CLI（ACP stdio） | gateway「Remote Control」+ daemon 会话 reply |

## 二、架构（逆向还原）

```
WorkBuddy 桌面主进程（用户登录 = 授权，authenticated=true）
  ├─ gateway「CodeBuddy Remote Control」：动态端口 + 动态 password
  │     - 端口每次启动随机（如 52391 → 52087）
  │     - password = randomBytes(32)，不落盘，只注入给主进程 spawn 的子进程
  │     - 认证 Bearer password；CODEBUDDY_GATEWAY_AUTH=password 优先级最高
  └─ daemon 后台执行运行时：模型 deepseek-v4-pro + 全套工具
        - 通过 POST /api/v1/daemon/start 启动，独立端口（如 9527）
```

## 三、正确执行方式（daemon 会话 reply）

`/api/v1/runs` 是死路（只登记 run 不执行，jobs 始终为空）。正确入口：

```
1. 动态发现 gateway 端口   CODEBUDDY_SERVICE_PROXY_URL 环境变量，或 lsof 扫描 Electron 端口探测 /api/v1/health
2. Bearer password 认证     CODEBUDDY_GATEWAY_PASSWORD 环境变量
3. POST /api/v1/daemon/start  启动 daemon（若 stopped）
4. GET  /api/v1/workers        取 kind=daemon 的 sessionId + endpoint
5. POST /api/v1/sessions/{id}/reply  body={text} → delivered=true
6. GET  /api/v1/sessions/{id}/history  轮询 requests[].finalReply
```

实现见 `device-agent/src/adapters/workbuddyAdapter.ts` 的 `runViaReply`。

## 四、激活流程（用户操作）

```
1. 一键部署
   ├─ 装 device-agent + 各平台 CLI
   └─ 装 WorkBuddy 桌面应用（manual，Electron 应用无法自动装）

2. 登录 WorkBuddy（授权，一次性）
   └─ 打开 WorkBuddy → Google/微信登录

3. 从 WorkBuddy 上下文启动 device-agent（关键，每次 WorkBuddy 重启后要重做）
   └─ 方式 A：让 WorkBuddy AI 执行启动命令（其进程继承密码）
      方式 B：WorkBuddy 集成终端里跑

4. 看板验证
   └─ 设备上线 + workbuddy activated

5. 提交任务 → 出结果
```

**为什么第 3 步必须在 WorkBuddy 上下文**：密码动态、不落盘、只在主进程内存 + 注入给其 spawn 的子进程。普通终端启动的 device-agent 拿不到密码。

## 五、踩坑记录（逆向铁律）

1. **50068 不是固定端口**：是某次 sidecar 的临时端口，每次 WorkBuddy 重启变。必须动态发现。
2. **`/api/v1/runs` 只登记不执行**：jobs 永远空、run 永远 active。正确入口是 daemon 会话 reply。
3. **`gateway.auth=none` 无效**：`CODEBUDDY_GATEWAY_AUTH=password` 环境变量优先级更高（主进程显式注入）。
4. **password 无法固定**：主进程 `randomBytes(32)` 每次启动随机，不读 `launchctl setenv` 环境变量。
5. **桥接插件（MCP）不可行**：stdio MCP server 是懒加载的（`defer_loading:false` 不会启动即 spawn，内置 weixinpay/sheetagent 重启后也无进程）；自定义 marketplace 不在 `known_marketplaces.json` 不被加载。
6. **正确消息格式**：`{ id, type, text, source:{platform,sender:{id}} }`，缺 `id`/`type` 报 BAD_REQUEST。
7. **账号身份 header**：`X-User-Id`（但 daemon reply 路径不需要）。

## 六、关键文件

- `device-agent/src/adapters/workbuddyAdapter.ts` — discoverGateway / readBridge / ensureBridgeInstalled / runViaReply
- `device-agent/scripts/workbuddy-bridge.mjs` — 桥接进程（继承密码写文件，手动触发备选）
- `device-agent/scripts/install-workbuddy-bridge.mjs` — 桥接插件安装（MCP 懒加载，已不作为自动方案）
- `shared/src/platformLaunch.ts` — workbuddy 打开方式 `appNames: ['WorkBuddy AI']`
