/**
 * 结构化原因码（借鉴 dsh-superagent `src/core/reasons.ts`）。
 *
 * 失败/拒绝/决策不再用自由文本，而是 `{ code, values? }`：
 *   - 看板可按 code 本地化、着色、聚合
 *   - 代码可用 `reason.code` 做判定（不再字符串匹配中文）
 *   - values 保留上下文（谁、哪个设备、第几次）供渲染
 *
 * `string & {}` 保留字面量补全，同时允许各模块自带私有 code（DSH 的手法）。
 */

export type ReasonCode =
  | 'timeout'
  | 'policyChanged'
  | 'revalidateDenied'
  | 'authorizationDenied'
  | 'executorMissing'
  | 'effectFailed'
  | 'effectDeferred'
  | 'effectDead'
  | 'deviceOffline'
  | 'tokenInvalid'
  | 'modelUnavailable'
  | 'probeFailed'
  | 'healthDegraded'
  | 'said'
  | (string & {});

export interface Reason {
  code: ReasonCode;
  /** 渲染模板用的上下文值 */
  values?: Record<string, string | number | boolean>;
  /** 可选关联对象，便于批量原因逐条追溯 */
  taskId?: string;
  deviceId?: string;
}

/** 内置码的中文模板；`{name}` 由 values 填充 */
export const REASON_TEXT: Record<string, string> = {
  timeout: '超时（{detail}）',
  policyChanged: '策略版本变更 {from} → {to}，已通知在途工作但不撤销授权',
  revalidateDenied: '授权复检失败：当前策略已禁止该动作（{kind}）',
  authorizationDenied: '授权被拒绝（{detail}）',
  executorMissing: '未注册该动作的执行器（{kind}）',
  effectFailed: '副作用执行失败（第 {attempts} 次）：{detail}',
  effectDeferred: '副作用延期（{detail}），不计失败',
  effectDead: '副作用重试耗尽，已标记待人工处理（{kind}）',
  deviceOffline: '设备离线（{deviceId}）',
  tokenInvalid: '设备 token 校验失败（{deviceId}）',
  modelUnavailable: '模型真实推理探测失败（{model}）',
  probeFailed: '探测失败：{detail}',
  healthDegraded: '连续失败 {failures} 次：{detail}',
  said: '{text}',
};

/** 构造一个原因 */
export function reasonOf(
  code: ReasonCode,
  values?: Reason['values'],
  ref?: Pick<Reason, 'taskId' | 'deviceId'>,
): Reason {
  return { code, ...(values ? { values } : {}), ...(ref ?? {}) };
}

/** 把人/模型写下的话包装成结构化原因（DSH 的 said()） */
export function said(text: string): Reason {
  return { code: 'said', values: { text } };
}

/** 渲染为可读文本；未知 code 直接返回 code（不丢信息） */
export function reasonText(reason: Reason): string {
  const template = REASON_TEXT[reason.code] ?? reason.code;
  const values = reason.values ?? {};
  const text = template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    name in values ? String(values[name]) : `{${name}}`,
  );
  return reason.taskId ? `${text} [task=${reason.taskId}]` : text;
}

/** 序列化为审计字段（DB/日志落盘用） */
export function reasonJson(reason: Reason): string {
  return JSON.stringify(reason);
}

/** 从审计字段还原（兼容历史自由文本） */
export function parseReason(raw: string | null | undefined): Reason {
  if (!raw) return { code: 'said', values: { text: '' } };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'code' in parsed) return parsed as Reason;
  } catch {
    /* 历史自由文本 */
  }
  return said(raw);
}
