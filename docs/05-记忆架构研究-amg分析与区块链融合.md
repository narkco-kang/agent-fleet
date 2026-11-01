# 05 · 记忆架构研究：amg 分析与区块链融合洞察

> 目标：全面分析本机自研记忆架构 `agent-memory-graph`（amg），提炼其可融合进 AgentMesh 的能力，并论证「区块链记账机制」如何优化这套记忆架构，作为后续 PRD / 架构设计的输入。

---

## 1. amg 全面分析

### 1.1 定位与设计哲学

`agent-memory-graph`（`amg`，v0.38.7）是**追加式、证据门控的语义记忆图**，面向多智能体工作流。

- 单文件记忆层，**无服务器、无数据库、无第三方依赖**（Python ≥3.10 标准库）。
- 核心主张：长时间运行的多智能体团队会丢失「事实连续性」——哪个决策是最终的、什么被阻塞、哪个产物哈希已验证。聊天历史不是真相源，摘要会漂移。
- 核心哲学：**用代码而非纪律强制不变量**（"we finished it" 在无证据时被机械化地禁止记录）。

### 1.2 数据模型（单文件 `graph.json`）

```json
{
  "schema": "amg/v1",
  "group": "team-name",
  "rev": 12,
  "nodes": [{ "id", "type", "label", "source", "status", "evidence", "valid_from", "valid_until", "superseded_at" }],
  "edges": [{ "from", "to", "kind" }],
  "changes": [{ "op", "rev", "at" }],
  "updatedAt": "ISO-8601"
}
```

| 枚举 | 值 |
|---|---|
| NODE_TYPES | group / member / task / decision / artifact / issue / model / env / question / rule / handoff |
| STATUSES | proposed / open / in_progress / done / blocked / superseded |
| EDGE_KINDS | depends_on / blocks / produced_by / owned_by / decided_by / supersedes / relates_to / part_of |
| CONCLUSION_TYPES | decision / artifact（done 必须带证据） |
| LOCATOR_PREFIXES | path: / cmd: / url: / sha256: |

### 1.3 四大不变量（代码强制）

| ID | 不变量 | 实现 |
|---|---|---|
| IR-1 | 追加式：无 delete API，`changes[]` 只增，`supersede` 保留旧节点 + 有效期窗口 | `memory.py` |
| IR-2 | 每个节点有真实 `source`（拒绝 `unknown`/`manual`） | `protocol.py` |
| IR-3 | 每次变更后跟可验证 check（0/1/2/3 退出码） | `cli.py` |
| IR-4 | conclusion 类型节点无证据对象不能 `done` | `gate.py` |

### 1.4 证据门控（Evidence 是对象，不是字符串）

```json
{"locator": "path:docs/API.md", "content_sha256": "…64 hex…",
 "captured_at": "…", "graph_rev": 12, "grade": 2}
```

- `content_sha256` 是**被引用产物**的哈希，节点 id / graph rev 绝不能替代它。
- 裸字符串（`"path:README.md"`）被拒绝——无法验证。
- `grade` 1–5 记录验证强度（1=落盘复现 / 5=仅声明），与检索质量分离。

### 1.5 有效性（supersede 永不删除 + 事实时间 ≠ 写入时间）

- `supersede` 给旧节点打 `valid_until`/`superseded_at`，保留在图中，加 `supersedes` 边。
- `changes[].at` 是**交易时间**，不是事实时间；事实时间是输入（`valid_from/valid_until`），从不推断（实测：3/10/30 天前才写入的事实会错位）。
- 过期是 opt-in（`amg expire`），只对已知有效期窗口的事实生效，标记 superseded 而非删除。

### 1.6 哈希指纹（tamper evidence，honestly scoped）

`fingerprint.py` 产两个**分离**摘要：

- `state_sha256`：当前 nodes+edges 的规范化（排序后）哈希 → 回答「图现在说了什么」，与顺序无关。
- `history_sha256`：`changes[]` 的**有序**哈希 → 回答「变更记录是否被改」。

分离是关键：直接改一个 node 会动 `state_sha256` 而 `history_sha256` 不动，这个 mismatch 是「文件事实」而非「指控」。**局限（自认）**：指纹存文件内防不了能写文件的人（可重算），价值来自把摘要存在别处（git commit / CI log / ticket）。

> 🔑 **这是区块链「哈希链」的雏形，但还差一步**：它是对 changes 的「一次性整体哈希」，不是「区块与区块之间环环相扣」的链式哈希。这正是区块链机制能补上的。

### 1.7 审计 / 归档 / 交接卡 / 读审计

- **audit**：结构不变式 + 冲突检测（悬空边、回退 rev、cycle、过期未 supersede 等），`--pin` 固定基线。
- **archive（冷归档）**：旧 change 移出活跃文件，每次运行 5 种方式证明移动（快照/重读/余量+指针/状态摘要不变/rev 连续），失败回滚；历史仍可按需检索。
- **handoff（交接卡）**：≤4KB 有界卡，一次一个 active，旧卡 supersede。
- **read audit**：opt-in，只记高风险读（L4/--strict/superseded），有界轮转 `reads.jsonl`。

### 1.8 检索（仅词法，诚实测量）

- 分层 L1-L4；superseded 和未来 `valid_from` 的节点绝不返回。
- 排序 two-key：`(anchor present, score)`，`score_kind`（idf/recency/expansion）防跨层按数值合并。
- IDF 词权重把冻结基线 0.808→0.865；明确「未实现」：向量检索、认证、多租户、TTL 守护、节点归档。

### 1.9 并发与规模（实测）

- 单文件 + 建议锁（fcntl/msvcrt）+ 原子替换（temp + fsync + os.replace）。
- 8 进程 200 写 0 丢 0 重复；1289 节点真实图读取单毫秒级、单写 147–226ms。

---

## 2. 与 AgentMesh 的融合点

### 2.1 现状对比

| 维度 | AgentMesh 现状 | amg |
|---|---|---|
| 记忆模型 | SQLite `sessions/messages/tasks`（扁平消息流） | 语义记忆图（nodes/edges + 证据 + 有效性） |
| 存储 | 中心化（协调后端 SQLite） | 单机单文件 |
| 完整性 | 无（消息可被覆盖） | 追加式 + 双摘要指纹 |
| 证据 | 无 | 证据门控（content_sha256 + grade） |
| 跨设备 | 有（传输层），但记忆不跨设备同步 | 无（单机） |
| 防篡改 | 无 | 指纹（存别处才有效） |

### 2.2 融合目标

把 amg 的「**记忆语义层**」接入 AgentMesh，补上 AgentMesh 缺的「团队事实连续性」：跨设备协同中，哪些决策是最终的、哪个产物已验证、谁在做什么、什么已过期——这些由 amg 的证据门控 + 有效性保证，而非靠聊天记录。

### 2.3 融合架构定位

```
AgentMesh
├── 传输层（局域网直连 + 中继）← 已有
├── 调度层（任务/设备）← 已有
├── 【新增】分布式记忆账本层
│   ├── 记忆语义层 ← 融合 amg（nodes/edges/evidence/validity/supersede/检索/审计）
│   ├── 区块链时序层 ← 新增（哈希链 + Merkle + 分布式账本 + 共识）
│   └── 同步层 ← 复用 AgentMesh 传输层（局域网 gossip + 中继广播）
```

---

## 3. 区块链记账机制借鉴设计

### 3.1 分布式账本 → 跨设备记忆副本

> 区块链：「没有中心服务器，所有节点保存完整账本副本，单节点毁坏/篡改不影响整体。」

**落地**：每个设备（+ 协调后端）保存一份**完整的记忆账本副本**。记忆写入后经局域网 gossip + 中继广播同步到所有设备。单设备离线/损坏不丢记忆，恢复后补同步。这正契合 AgentMesh「跨设备」定位，也解决 amg 单机单文件「坏了就没了」的弱点。

### 3.2 哈希算法 → 区块链式哈希（amg fingerprint 的升级）

> 区块链：「哈希函数把交易数据算成固定长度数字指纹；区块间哈希环环相扣，前一区块改动则哈希巨变、后链断裂。」

**落地**：把 amg 的 `changes[]` 按批次打包成 **block**，每块含 `prev_hash`：

```
block = { index, prev_hash, timestamp, merkle_root, changes[], author, hash }
block.hash = sha256(prev_hash ‖ merkle_root ‖ timestamp ‖ author ‖ changes)
```

- `prev_hash` 环环相扣 → 篡改任意历史块，后续整链哈希全变（比 amg 的一次性 `history_sha256` 更强：能定位到**哪一块**被改）。
- amg 的 `rev`（单调递增）成为 `index`，`changes` 成为区块内交易。

### 3.3 Merkle 树 → 记忆轻量验证

> 区块链：Merkle 树让轻节点无需全量下载即可验证某笔交易在不在账本。

**落地**：每块的 `merkle_root` = 该块所有 change 的 Merkle 根。设备可只凭一条 `merkle proof` 验证「某条记忆确实在某块账本中」，无需下载整链。配合 amg 的 `verify-evidence`（对 `path:` 证据重算哈希），形成「记忆内容 + 记忆时序」双重验证。

### 3.4 共识机制 → 记账权 + 一致性（适配跨设备信任模型）

> 区块链：「谁来记账 + 如何让所有人一致」。

**选型判断**（关键，避免照搬）：

| 机制 | 是否采用 | 理由 |
|---|---|---|
| PoW 工作量证明 | ❌ | 浪费算力，节点可信无需防女巫 |
| PoS 权益证明 | ❌ | 无代币/权益概念 |
| PBFT 拜占庭容错 | ⚠️ 可选 | 需 2/3 节点在线，重 |
| **许可制账本（permissioned）** | ✅ | 节点经配对 token 认证，天然可信 |

**推荐共识**（许可制 + 弱中心，贴合 AgentMesh 已有 leader 架构）：

1. **记账权**：协调后端（leader）作为默认 block producer；可 round-robin 轮转到各设备（后备用）。
2. **出块**：每 N 条记忆 change（或每 T 秒）打包一块，广播全网。
3. **一致性**：最长链原则；同 index 分叉时按 block.hash 字典序**确定性**选主链（无随机性，全网收敛到同一条链）。
4. **内容共识**：amg 的**证据门控**作为语义共识层——无证据不能写 conclusion，等价于「内容合法才进账本」。
5. **验证**：设备收到 block 先验 `prev_hash` 链 + `merkle_root` + 签名，通过才追加本地副本，否则拒收并告警。

---

## 4. 关键设计决策建议（给架构师/PM 的输入）

1. **记忆账本 = amg 语义层 + 区块链时序层**：amg 的 nodes/edges/evidence/validity 作为区块「内容」，区块链的 hash 链/Merkle/账本/共识作为区块「时序与分布」。
2. **传输复用**：局域网 gossip（设备间直连）+ 中继广播（跨网段），不新造传输。
3. **融合方式**：不改造 amg 内部（它已成熟），而是**在其上包一层账本协议**（amg 作为「记账内核」，AgentMesh 提供「分布式传播 + 共识」）。可选：把 amg 作为设备守护的一个 MCP server 接入（amg 已自带 MCP server）。
4. **共识务实**：许可制 + 弱中心 leader + 最长链 + 确定性 tie-break，不引入 PoW/PoS。
5. **诚实边界**：沿用 amg 的「honestly scoped」态度——账本防的是「静默篡改 + 时序伪造」，防不了「持有 token 的节点恶意写入」，威胁模型要写清楚（对表 amg 的 THREAT-MODEL.md §7）。

---

*本文档为 AgentMesh 记忆架构的融合基线，后续 PRD / 架构设计以此为准。*
