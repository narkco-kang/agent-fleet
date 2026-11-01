import { describe, expect, it } from 'vitest';
import {
  mapOp,
  mapOpReverse,
  toChange,
  toSemantic,
} from '../src/adapters/amg-mapper';
import type { SemanticOp } from '../src/adapters/amg-mapper';
import type { Evidence, MemoryNode } from '../src/types/memory';

const evidence: Evidence[] = [
  {
    locator: 'path:/tmp/product.txt',
    content_sha256: 'a'.repeat(64),
    captured_at: '2026-01-01T00:00:00+00:00',
    grade: 4,
  },
];

const node: MemoryNode = {
  id: 'n1',
  type: 'decision',
  label: '采用方案 A',
  status: 'open',
  source: 'path:/tmp/product.txt',
  evidence,
  valid_from: '2026-01-01T00:00:00+00:00',
  valid_until: '2026-12-31T00:00:00+00:00',
};

function base(overrides: Partial<SemanticOp> = {}): SemanticOp {
  return {
    op: 'add-node',
    target: 'n1',
    by: 'amg',
    at: '2026-01-01T00:00:00+00:00',
    rev: 1,
    note: 'type=decision status=open',
    node,
    ...overrides,
  };
}

describe('amg-mapper', () => {
  it('maps add-node to add_node and passes through node payload', () => {
    const change = toChange(base());
    expect(change.op).toBe('add_node');
    expect(change.target).toBe('n1');
    expect(change.node).toEqual(node);
    // evidence / validity 透传。
    expect(change.node!.evidence).toEqual(evidence);
    expect(change.node!.valid_from).toBe('2026-01-01T00:00:00+00:00');
    expect(change.node!.valid_until).toBe('2026-12-31T00:00:00+00:00');
  });

  it('maps import-node to import_node', () => {
    const change = toChange(base({ op: 'import-node' }));
    expect(change.op).toBe('import_node');
    expect(change.node).toEqual(node);
  });

  it('maps set-status to set_status with status payload', () => {
    const change = toChange(
      base({ op: 'set-status', node: undefined, status: 'done' }),
    );
    expect(change.op).toBe('set_status');
    expect(change.status).toBe('done');
  });

  it('maps add-edge to add_edge with edge payload', () => {
    const change = toChange(
      base({
        op: 'add-edge',
        node: undefined,
        target: 'n1->n2',
        edge: { from: 'n1', to: 'n2', kind: 'depends_on' },
      }),
    );
    expect(change.op).toBe('add_edge');
    expect(change.edge).toEqual({ from: 'n1', to: 'n2', kind: 'depends_on' });
  });

  it('maps supersede with old/new ids', () => {
    const change = toChange(
      base({ op: 'supersede', node: undefined, old_id: 'n1', new_id: 'n2' }),
    );
    expect(change.op).toBe('supersede');
    expect(change.supersede).toEqual({ old_id: 'n1', new_id: 'n2' });
  });

  it('maps expire with target only', () => {
    const change = toChange(base({ op: 'expire', node: undefined }));
    expect(change.op).toBe('expire');
    expect(change.target).toBe('n1');
    expect(change.node).toBeUndefined();
    expect(change.status).toBeUndefined();
  });

  it('reconstructs the semantic op from a change', () => {
    const change = toChange(base());
    const sem = toSemantic(change);
    expect(sem.op).toBe('add-node');
    expect(sem.node).toEqual(node);
    expect(sem.target).toBe('n1');
    expect(sem.rev).toBe(1);
  });

  it('round-trips mapOp and mapOpReverse', () => {
    for (const amgOp of [
      'add-node',
      'import-node',
      'set-status',
      'add-edge',
      'supersede',
      'expire',
    ]) {
      expect(mapOpReverse(mapOp(amgOp))).toBe(amgOp);
    }
  });

  it('throws E_BAD_CHANGE for an unknown op', () => {
    expect(() => toChange(base({ op: 'migrate' }))).toThrow(/E_BAD_CHANGE/);
    expect(() => mapOp('nonsense')).toThrow(/E_BAD_CHANGE/);
  });

  it('keeps a stable id for idempotent resubmission', () => {
    const op = base();
    const id = 'fixed-change-id';
    expect(toChange(op, id).id).toBe(id);
    expect(toChange(op, id).id).toBe(id);
  });
});
