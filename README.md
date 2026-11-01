# AgentMesh · Cross-Device Super-Agent Collaboration System

Orchestrate the **AI agent platforms already installed on each device** (Codex / Claude Code / DSH / Grok bot / Cursor / Aider / Gemini / Qwen …) into a cross-device **"super-agent team"**. A dynamic neural-graph dashboard visualizes device → agent → task invocation topology in real time, and WeChat (personal + enterprise) acts as a task entry point.

[中文说明](README.zh-CN.md) · English

## ✨ Features

| Capability | Description |
|---|---|
| **Cross-device orchestration** | Auto-detect 13+ AI agent platforms per device via a data-driven adapter catalog; unified task protocol (submit / stream / cancel) |
| **Dynamic neural graph** | d3-force topology: 4 node types (device / agent / task / message flow) + 4 link types (call / return / stream / belongs), with pulse / flow / focus animations |
| **Blockchain-style memory ledger** | Append-only hash chain (`prev_hash` ring) + Merkle tree + distributed ledger + consensus (longest chain + deterministic tie-break) — tamper-evident team memory |
| **Smart routing gateway** | Role-based routing (role → device + agent + model) with failover and token ledger, protocol-compatible with a local model gateway |
| **Excel batch deployment** | Upload an Excel sheet (device IP / account / password) to one-click deploy agent platforms over SSH |
| **Asset distribution** | Unified Asset model for rules / knowledge / skills, delivered to one device or a whole batch |
| **Expert teams & loops** | Assign expert teams (role routing) to single/cross-device agent teams; orchestrate single/batch/cross-device loops |
| **Primary AI agent** | Set a primary AI agent per device or in batch — auto-routing prefers it |
| **WeChat assistant** | Enterprise WeChat (official API) + personal WeChat (interface reserved) as a chat-based task entry |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Entry:  Web Dashboard (neural graph)  ·  WeChat assistant   │
├─────────────────────────────────────────────────────────────┤
│  Backend (coordinator):  device registry · task scheduler    │
│                          role routing · asset · deploy       │
│                          teams · loops · memory ledger       │
├─────────────────────────────────────────────────────────────┤
│  Transport:  LAN first (mDNS + direct) + cloud relay fallback│
├─────────────────────────────────────────────────────────────┤
│  Device agents:  daemon + adapter catalog (13+ platforms)    │
│                  memory ledger replica (catch-up sync)       │
└─────────────────────────────────────────────────────────────┘
```

Monorepo workspaces:

```
agent-mesh/
├── shared/         # protocol (single source of truth)
├── backend/        # coordinator + relay + memory ledger + routing + deploy
├── frontend/       # adaptive dashboard (dynamic neural graph)
├── device-agent/   # per-device daemon + adapters + asset receiver
├── wechat/         # WeChat gateway (enterprise + personal)
├── memory/         # blockchain-style memory ledger core (hash chain + Merkle)
└── docs/           # 13 design / architecture documents
```

## 🚀 Quick Start

**Prerequisites**: Node.js v24 (e.g. `nvm use 24`). On some systems `better-sqlite3` is built against a specific Node version — make sure `node -v` prints v24.

```bash
npm install

# coordinator :4173
npm run dev:backend

# dashboard :5173 (opens in demo mode even with zero devices)
npm run dev:frontend

# per-device daemon (set COORDINATOR_URL=ws://127.0.0.1:4173 if mDNS is blocked)
npm run dev:agent

# cloud relay :4174 · WeChat gateway :4175
npm run dev:relay
npm run dev:wechat

# full build + tests
npm run build
npm run test --workspace memory
```

**Demo mode**: with no devices connected, the dashboard automatically plays a live cross-device simulation — tasks flow through `queued → running → completed`, stream particles animate, device load updates, and a phone node toggles online/offline.

## 📚 Documentation

See [`docs/`](docs/) for 13 documents: reverse-engineering of Grok's orchestration, PRD, architecture, UI design, the blockchain memory ledger design, and the routing-gateway fusion design.

## 🔒 Safety

- Deployment passwords are **never persisted** (in-memory only, cleared after use).
- Deploy / asset-deliver / loop-start all require an explicit **human confirmation gate** before any outbound action.

## 📄 License

[MIT](LICENSE)
