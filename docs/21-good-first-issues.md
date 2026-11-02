# Good First Issues 清单（10 个）

> 本文件是 GitHub issue 的文案底稿，供创建与复盘。创建后打 `good first issue` 标签。
> 认领指南见 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [docs/20-适配器开发指南.md](20-适配器开发指南.md)。

---

## Issue 1 · 实现 Claude Code 平台真接 Adapter

**标题**：`[adapter] Implement direct Claude Code adapter (upgrade from scaffold)`

**正文**：
```
## Background
AgentFleet schedules 13+ agent platforms through a unified Adapter interface. Only Grok has a stable direct adapter today (`grokAdapter.ts`). Claude Code is currently a `CatalogAdapter` scaffold — `detect()` works, but `run()` is a placeholder that returns `failed`.

## Task
Implement a real `run()` for Claude Code by copying the Grok adapter as a template.

## Reference files
- Interface: `device-agent/src/adapters/adapter.ts`
- Template: `device-agent/src/adapters/grokAdapter.ts`
- Scaffold: `device-agent/src/adapters/catalogAdapter.ts`
- Catalog: `device-agent/src/adapters/platformCatalog.ts`
- Registry: `device-agent/src/adapters/index.ts`
- Guide: `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
`claude -p "<prompt>"` (non-interactive print mode). Confirm the exact flags with `claude --help`.

## Acceptance
- `detect()` finds a locally installed Claude Code with correct version
- `run()` spawns the headless command and streams `TaskEvent`s (no placeholder `failed`)
- `cancel()` terminates the child process
- Registered in `index.ts`; `npm run build` + `npm run test --workspace device-agent` pass
- PR includes your Claude Code version + the exact command you tested
```

---

## Issue 2 · 实现 Codex 平台真接 Adapter

**标题**：`[adapter] Implement direct Codex adapter (upgrade from scaffold)`

**正文**：
```
## Background
Only Grok has a stable direct adapter. Codex is currently a `CatalogAdapter` scaffold (`run()` returns a placeholder `failed`).

## Task
Implement a real `run()` for Codex, copying `grokAdapter.ts` as the template.

## Reference files
`device-agent/src/adapters/adapter.ts` (interface) · `grokAdapter.ts` (template) · `catalogAdapter.ts` (scaffold) · `platformCatalog.ts` (catalog) · `index.ts` (registry) · `docs/20-适配器开发指南.md` (guide)

## Headless hint (verify against official docs)
`codex exec "<prompt>"`. Confirm exact flags with `codex --help`.

## Acceptance
- `detect()` / `run()` / `cancel()` fully working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Codex version + tested command
```

---

## Issue 3 · 实现 Aider 平台真接 Adapter

**标题**：`[adapter] Implement direct Aider adapter (upgrade from scaffold)`

**正文**：
```
## Background
Aider is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for Aider.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
`aider --message "<prompt>" --yes` (or `--message` for non-interactive). Confirm with `aider --help`.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Aider version + tested command
```

---

## Issue 4 · 实现 Gemini CLI 平台真接 Adapter

**标题**：`[adapter] Implement direct Gemini CLI adapter (upgrade from scaffold)`

**正文**：
```
## Background
Gemini CLI is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for Gemini CLI.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
`gemini -p "<prompt>"`. Confirm exact flags with `gemini --help`.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Gemini CLI version + tested command
```

---

## Issue 5 · 实现 Qwen Code 平台真接 Adapter

**标题**：`[adapter] Implement direct Qwen Code adapter (upgrade from scaffold)`

**正文**：
```
## Background
Qwen Code is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for Qwen Code.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
Qwen Code ships a CLI; find the headless/chat mode (`qwen ... --help`) and confirm flags.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Qwen Code version + tested command
```

---

## Issue 6 · 实现 Kimi CLI 平台真接 Adapter

**标题**：`[adapter] Implement direct Kimi CLI adapter (upgrade from scaffold)`

**正文**：
```
## Background
Kimi CLI is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for Kimi CLI.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
Kimi CLI's chat mode (`kimi ... --help`). Confirm flags and login prerequisites.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Kimi CLI version + tested command
```

---

## Issue 7 · 实现 Cody 平台真接 Adapter

**标题**：`[adapter] Implement direct Cody adapter (upgrade from scaffold)`

**正文**：
```
## Background
Cody is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for Cody.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
`cody chat -m "<prompt>"`. Confirm flags and login prerequisites with `cody --help`.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your Cody version + tested command
```

---

## Issue 8 · 实现 OpenCode 平台真接 Adapter

**标题**：`[adapter] Implement direct OpenCode adapter (upgrade from scaffold)`

**正文**：
```
## Background
OpenCode is currently a `CatalogAdapter` scaffold. Implement a real `run()`.

## Task
Copy `grokAdapter.ts` as the template; implement `run()` for OpenCode.

## Reference files
`device-agent/src/adapters/adapter.ts` · `grokAdapter.ts` · `catalogAdapter.ts` · `platformCatalog.ts` · `index.ts` · `docs/20-适配器开发指南.md`

## Headless hint (verify against official docs)
`opencode run "<prompt>"`. Confirm flags with `opencode --help`.

## Acceptance
- `detect()` / `run()` / `cancel()` working on a real machine
- Registered in `index.ts`; build + tests pass
- PR includes your OpenCode version + tested command
```

---

## Issue 9 · 文档：补充各平台 headless 命令实测矩阵

**标题**：`[docs] Fill the headless-command verification matrix for all platforms`

**正文**：
```
## Background
`docs/20-适配器开发指南.md` has a table of *headless hints* that are mostly unverified. We need real, tested command lines per platform.

## Task
For each platform in `device-agent/src/adapters/platformCatalog.ts`, look up the official CLI docs and fill in the *verified* headless invocation (exact flags), login prerequisite, and output format. Mark unverified entries clearly as "未实测".

## Deliverable
Update the headless table in `docs/20-适配器开发指南.md` (and optionally `docs/17-Agent平台安装卸载与调用矩阵.md`) with verified commands + platform versions.

## Acceptance
- Every entry either has a verified command or is explicitly marked unverified
- PR links the official doc source for each verified command
```

---

## Issue 10 · 前端：神经图 agent 节点聚焦动画增强

**标题**：`[frontend] Improve neural-graph node focus animation`

**正文**：
```
## Background
The d3-force neural graph (`frontend/src/`) has focus/pulse animations. We want a smoother, more pronounced focus animation when a node is selected.

## Task
Enhance the focus animation so that clicking an agent node smoothly zooms/highlights its connected device + task neighbors (not just the node itself).

## Reference files
Search the graph rendering in `frontend/src/` (d3-force topology; node types: device / agent / task / message).

## Acceptance
- Clicking a node highlights its neighbors with a smooth animation
- No visual regression in the existing pulse/flow animations
- `npm run build` passes; describe the change with a screenshot/GIF
```
