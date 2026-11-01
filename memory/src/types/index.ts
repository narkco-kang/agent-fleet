/**
 * 类型统一出口 + 全局错误码（单一事实源）。
 *
 * 错误码 `E_` 前缀，对齐 amg 风格，供 validation / storage / consensus 共用。
 */
export * from './block';
export * from './memory';
export * from './protocol';

/** 全局错误码（E_ 前缀，对齐 amg）。 */
export const ERROR_CODES = {
  E_BAD_GENESIS: 'E_BAD_GENESIS',
  E_BAD_INDEX: 'E_BAD_INDEX',
  E_BAD_HASH: 'E_BAD_HASH',
  E_CHAIN_BREAK: 'E_CHAIN_BREAK',
  E_BAD_MERKLE: 'E_BAD_MERKLE',
  E_BAD_SIG: 'E_BAD_SIG',
  E_STALE_BLOCK: 'E_STALE_BLOCK',
  E_DUP_CHANGE: 'E_DUP_CHANGE',
  E_LOCK_TIMEOUT: 'E_LOCK_TIMEOUT',
  E_BAD_CHANGE: 'E_BAD_CHANGE',
} as const;

/** 错误码字面量联合。 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
