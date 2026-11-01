# AgentMesh Memory — 跨设备分布式记忆账本

纯 TypeScript 自实现的「许可制分布式记忆账本」：amg 提供记忆的**语义与内容**
（决策/任务/产物/证据/有效期），本账本提供记忆的**时序与分布**
（哈希链 + Merkle + 副本 + 同步 + 共识）。

运行期零第三方依赖（仅 `node:crypto` / `node:fs` / `node:os`）。

## 快速开始

```bash
# Node >= 20（建议 v24.22.1）
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"

npm install --registry=https://registry.npmmirror.com
npm run typecheck   # tsc --noEmit strict
npm test            # vitest 单元测试
npm run build       # 产出 dist/
```

## 目录结构

```
src/
├── index.ts            # 公共入口
├── types/              # 类型单一事实源（block / memory / protocol）
├── crypto/             # canonical / sha256 / ed25519（零第三方依赖）
├── core/               # block / chain / merkle（纯函数）
├── storage/            # 建议锁 + 单文件账本（原子替换）
├── validation/         # 验证层 + 篡改定位
├── consensus/          # mempool / 出块 / 最长链分叉
├── sync/               # 消息编解码 + gossip + 断线补同步
└── adapters/           # amg 语义 ↔ 账本 change 映射 + MCP 骨架
tests/                  # 12 个单元测试文件
```

## 关键约定

- 哈希输出 64 位小写 hex；签名 base64；JSON 字段 snake_case。
- 区块哈希 = `sha256Hex(canonicalize({prev_hash, merkle_root, timestamp, author, changes}))`。
- Merkle 叶子 = `sha256Hex(canonicalize(change))`；内节点 = `sha256Hex(left‖right)`；奇数复制末叶。
- GENESIS：index=0、prev_hash=64 个 `0`、timestamp=0、author="genesis"、空签名（验签放行）。
- 幂等键：`change.id`（mempool）、`block.hash`（gossip）；`appendBlock` 仅接受 `index == tip+1`。
