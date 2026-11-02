# 记忆架构决策：是否用 AgentMemory 方案替代区块链账本

> 触发：评估是否引入 AgentMemory 的「四层记忆整合 / 三重检索流 / 审计+溯源+Git快照」来**替代**我们的区块链账本。
> 结论一句话：**不「替代」，而是「轻量化融合」——保留哈希链+Ed25519签名（防篡改核心），砍掉从未被引用的共识/同步死代码（约 38%），引入检索层与衰减权重。**

---

## 一、现状盘点（有代码依据）

backend 只引用了 `@agentfleet/memory` 的 6 个符号：`BlockProducer`、`LedgerStore`、`Mempool`、`TrustStore`、`generateKeyPair`、`verifyChainSigned`。

| 模块 | 文件 | 状态 |
|---|---|---|
| crypto | hash / ed25519 / canonical | ✅ 活核心（哈希 + 签名） |
| core | block / chain / merkle | ✅ 活核心（哈希链 + Merkle） |
| storage | ledger / lock | ✅ 活核心（append-only 账本） |
| validation | verifier / tamper | ✅ 活核心（整链校验 + 篡改定位） |
| consensus | mempool / producer | ✅ 活（**单 leader 出块**机制，非分布式共识） |
| consensus | **fork** | ❌ 死代码（从未被引用） |
| sync | **gossip / catchup / messages** | ❌ 死代码（从未被引用） |

死代码约 350 行，占 memory 921 行的 **38%**。这些是「分布式共识 + P2P 同步」的实现，但 backend 是**固定单 leader 出块**，从没走过多节点共识路径。

**这印证了此前报告反复出现的判断：区块链共识在单机/单 leader 场景是纯冗余。**

---

## 二、逐条决策

### 1. 四层记忆整合 + 衰减/加强/驱逐

AgentMemory 四层：Working（原始观察）→ Episodic（会话摘要）→ Semantic（事实模式）→ Procedural（决策模式）。

| 项 | 决策 | 理由 |
|---|---|---|
| 四层整合 | **部分引入（轻量版）** | 我们的场景是「任务终态账本」，不是「会话记忆」。账本本身 = Working（原始事件）+ Episodic（任务结果）；检索层 = Semantic（可召回）。完整的 Semantic/Procedural 提炼需 LLM 压缩，是重依赖 → 做成**可选**，不默认引入。 |
| 衰减/加强 | **引入到检索层** | 作为检索排序权重（旧记忆/少访问降权），不影响账本本身。 |
| 驱逐 | **不引入** | 与 append-only 防篡改**根本矛盾**（驱逐=删除，防篡改=不可删）。我们的「可审计」价值正在于不可删。 |

### 2. 三重检索流（BM25 + 向量 + 知识图谱，RRF 融合）

| 流 | 决策 | 理由 |
|---|---|---|
| BM25 | ✅ 已做 | keyless 关键词召回 |
| 知识图谱 | **引入（图检索）** | 我们已有 `MemoryNode`/`MemoryEdge` 语义图（amg 对齐），但只用于「语义操作」，没用图检索。可加「实体匹配 → 图遍历」。 |
| 向量 | **可选，暂缓** | 需 embedding 模型（@huggingface/transformers + 90MB 模型下载），与「零依赖」冲突；AgentMemory 自己也是「可选」。 |
| RRF 融合 | **引入** | 轻量（Reciprocal Rank Fusion），把 BM25 + 图 结果融合排序。 |

### 3. 审计轨迹 + 写入溯源 + Git 快照 + 密钥清洗

**这是用户问题的核心：这些能否替代区块链的「防篡改审计」？**

| 能力 | 能否替代区块链防篡改 | 判断 |
|---|---|---|
| 密钥清洗 | — | ✅ 已做（scrub） |
| 写入溯源（provenance） | 部分 | change 已有 `by/at/note`，可补「源观察」完整链路 |
| 审计轨迹（memory_audit） | 部分 | 我们的 append-only 账本本身就是审计轨迹 |
| **Git 快照** | **大部分能** | Git commit 链本质是哈希链（parent hash 环环相扣），天然防篡改；且提供 version/diff/回滚 |

**关键结论**：Git 快照 + 溯源 + 审计，能覆盖「防篡改审计」约 **80%** 需求，且更轻量。**但有一个维度它覆盖不了**：

- 我们的 **Ed25519 签名** 是「**密码学可验证**的防篡改」——任何人可离线验证「这条记录确实是 coordinator 写的、自写入后未被改动」。
- Git 快照的哈希链**默认不强制签名**，篡改者改完历史重算 hash 即可伪造（除非强制 GPG 签名）。
- 所以「用 AgentMemory 替代」会**失去强可验证性**——这是我们对医疗/金融合规留痕的差异化价值。

---

## 三、最终方案：轻量化融合（不是替代）

```
保留（活核心，约 570 行）：
  哈希链 + Merkle + Ed25519 签名 + append-only 账本 + 整链校验

砍掉（死代码，约 350 行 / 38%）：
  fork + gossip + catchup + messages（分布式共识 + P2P 同步）

引入（AgentMemory 优势，轻量）：
  ✅ BM25 召回（已做）
  ✅ secret 脱敏（已做）
  ✅ 相似检测/近重复（已做）
  ➕ 图检索（实体匹配 + 图遍历，复用现有 MemoryNode/MemoryEdge）
  ➕ RRF 融合（BM25 + 图）
  ➕ 衰减/加强（检索排序权重）
  ➕ 写入溯源强化（provenance 链）
  可选：本地向量（embedding 模型）、LLM 摘要（四层整合的 Semantic/Procedural）
```

**为什么不是「替代」而是「融合」**：
1. 我们的 Ed25519 签名是 Git 快照没有的「密码学可验证防篡改」——这是差异化护城河，不能丢。
2. 我们的「双层账本 local/team」是 AgentMemory 没有的「跨设备团队账本」概念。
3. AgentMemory 的检索/四层/衰减是「召回质量」优势，叠加到我们的账本之上即可，无需二选一。

---

## 四、落地清单（按优先级）

1. **砍死代码**：删 fork/gossip/catchup/messages + 对应测试（fork.test / sync.test），memory 从「区块链」降为「可审计记忆账本」。**收益：-38% 代码，-350 行，概念澄清。**
2. **图检索 + RRF**：给 MemorySearchIndex 加「实体匹配 → 图遍历」+ RRF 融合（BM25 + 图），补齐「三重检索」里缺失的两流。
3. **衰减/加强**：检索层加「访问频率 + 时间」排序权重。
4. **写入溯源强化**：change 补 provenance（源任务/源观察链接）。
5. 可选：本地向量、LLM 摘要（四层整合 Semantic/Procedural）。

> 注意：第 1 步「砍死代码」涉及删除测试文件（fork.test.ts 等），会改变 memory 测试数。需同步处理，确保不误删活核心的测试。
