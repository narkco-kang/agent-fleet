/**
 * amg 语义变更 → 账本 MemoryChange 映射（双向）。
 *
 * amg 的 changes[].op 使用连字符（add-node / import-node / set-status / add-edge /
 * supersede / expire），账本 MemoryChange.op 使用下划线。migrate 不进账本。
 * 字段不丢：evidence / validity（valid_from / valid_until）随 node 透传。
 */
import { randomUUID } from 'node:crypto';
import type { ChangeOp, MemoryChange } from '../types/block';
import type { MemoryEdge, MemoryNode } from '../types/memory';
import { ERROR_CODES } from '../types';

/** amg 语义操作（含载荷，MVP 由 TS 语义层或 P1 的 amg MCP 提供）。 */
export interface SemanticOp {
  /** amg 操作名（连字符风格）。 */
  op: string;
  target: string;
  by: string;
  at: string;
  rev: number;
  note: string;
  node?: MemoryNode;
  edge?: MemoryEdge;
  status?: string;
  old_id?: string;
  new_id?: string;
}

/** amg op（连字符）→ 账本 ChangeOp（下划线）。 */
export function mapOp(amgOp: string): ChangeOp {
  switch (amgOp) {
    case 'add-node':
    case 'add_node':
      return 'add_node';
    case 'import-node':
    case 'import_node':
      return 'import_node';
    case 'set-status':
    case 'set_status':
      return 'set_status';
    case 'add-edge':
    case 'add_edge':
      return 'add_edge';
    case 'supersede':
      return 'supersede';
    case 'expire':
      return 'expire';
    default:
      throw new Error(`${ERROR_CODES.E_BAD_CHANGE}: unknown amg op "${amgOp}"`);
  }
}

/** 账本 ChangeOp（下划线）→ amg op（连字符）。 */
export function mapOpReverse(changeOp: ChangeOp): string {
  switch (changeOp) {
    case 'add_node':
      return 'add-node';
    case 'import_node':
      return 'import-node';
    case 'set_status':
      return 'set-status';
    case 'add_edge':
      return 'add-edge';
    case 'supersede':
      return 'supersede';
    case 'expire':
      return 'expire';
  }
}

/** 生成 change 稳定标识（uuid v4）。 */
export function newChangeId(): string {
  return randomUUID();
}

/**
 * amg 语义操作 → 账本 MemoryChange。
 *
 * @param op amg 语义操作（含载荷）。
 * @param id 可选 change.id；缺省时生成 uuid。幂等重试时复用同一 id。
 */
export function toChange(op: SemanticOp, id?: string): MemoryChange {
  const changeOp = mapOp(op.op);
  const change: MemoryChange = {
    id: id ?? newChangeId(),
    op: changeOp,
    target: op.target,
    by: op.by,
    at: op.at,
    rev: op.rev,
    note: op.note ?? '',
  };

  switch (changeOp) {
    case 'add_node':
    case 'import_node':
      if (op.node) change.node = op.node;
      break;
    case 'add_edge':
      if (op.edge) change.edge = op.edge;
      break;
    case 'set_status':
      if (op.status !== undefined) change.status = op.status;
      break;
    case 'supersede':
      if (op.old_id !== undefined && op.new_id !== undefined) {
        change.supersede = { old_id: op.old_id, new_id: op.new_id };
      }
      break;
    case 'expire':
      // target 即节点 id，无额外载荷。
      break;
  }

  return change;
}

/** 账本 MemoryChange → amg 语义操作（反向重建，供 P1 amg 消费）。 */
export function toSemantic(change: MemoryChange): SemanticOp {
  return {
    op: mapOpReverse(change.op),
    target: change.target,
    by: change.by,
    at: change.at,
    rev: change.rev,
    note: change.note,
    node: change.node,
    edge: change.edge,
    status: change.status,
    old_id: change.supersede?.old_id,
    new_id: change.supersede?.new_id,
  };
}
