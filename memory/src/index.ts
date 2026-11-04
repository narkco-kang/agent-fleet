/**
 * AgentFleet Memory —— 公共入口：聚合导出所有模块。
 */
// 类型与错误码
export * from './types';

// 密码学原语
export * from './crypto/canonical';
export * from './crypto/hash';
export * from './crypto/ed25519';

// 核心算法
export * from './core/block';
export { verifyChain, isLinked } from './core/chain';
export type { ChainError, VerificationReport } from './core/chain';
export * from './core/merkle';

// 存储
export * from './storage/lock';
export * from './storage/ledger';

// 验证层（verifyChain 与 core/chain 同名，别名导出避免冲突）
export {
  verifyBlock,
  verifySignature,
  verifyChain as verifyChainSigned,
  isGenesis,
} from './validation/verifier';
export type { VerificationResult } from './validation/verifier';
export * from './validation/tamper';

// 共识
export * from './consensus/mempool';
export * from './consensus/producer';

// 同步（中心广播 + 补同步；多 leader 共识的 fork/gossip 已移除——backend 固定单 leader 出块）
export * from './sync/messages';
export * from './sync/catchup';

// amg 适配
export * from './adapters/amg-mapper';
export * from './adapters/amg-mcp';

// 语义检索层（借鉴 AgentMemory：BM25 召回 + secret 脱敏）
export * from './search';
