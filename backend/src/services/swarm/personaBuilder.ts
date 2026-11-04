import type { RoleTeam, SubRole } from '@agentfleet/shared';

/**
 * persona 注入：把子角色的 persona + operation 拼接为一段稳定的 system 上下文。
 *
 * 设备侧 messageHandler 会合并为：`systemPrompt + '\n\n---\n\n任务指令：\n' + prompt`
 * 再派发给对应 adapter 执行。
 */

/** 构建子角色 system 上下文（确定性拼接，便于测试断言稳定） */
export function buildSystemPrompt(subRole: SubRole): string {
  const p = subRole.persona;
  const o = subRole.operation;
  const lines: string[] = [];

  lines.push(`你是「${subRole.name}」角色。`);
  lines.push('');
  if (p.identity) {
    lines.push('【身份】');
    lines.push(p.identity);
    lines.push('');
  }
  if (p.communication) {
    lines.push('【沟通方式】');
    lines.push(p.communication);
    lines.push('');
  }
  if (Array.isArray(p.rules) && p.rules.length > 0) {
    lines.push('【行为准则】');
    for (const rule of p.rules) lines.push(`- ${rule}`);
    lines.push('');
  }
  if (o.mission) {
    lines.push('【任务使命】');
    lines.push(o.mission);
    lines.push('');
  }
  if (Array.isArray(o.workflow) && o.workflow.length > 0) {
    lines.push('【工作流程】');
    for (const [i, step] of o.workflow.entries()) lines.push(`${i + 1}. ${step}`);
    lines.push('');
  }
  if (p.style) {
    lines.push('【风格】');
    lines.push(p.style);
  }

  return lines.join('\n').trim();
}

/**
 * 构建 Leader 子角色的协调 system 上下文（P2-4）。
 *
 * Leader 是团队的「入口协调者」：未指定子角色的任务先到 Leader，
 * 由它评估任务、把工作委派给团队内合适的子角色并汇总结果。
 * 因此 prompt 除 Leader 自身 persona 外，还注入「团队子角色能力清单」。
 */
export function buildLeaderPrompt(leader: SubRole, team: RoleTeam, members: SubRole[]): string {
  const base = buildSystemPrompt(leader);
  const lines: string[] = [base, ''];

  lines.push(`你是「${team.name}」团队的 Leader（协调者）。`);
  lines.push('你的职责不是亲自完成所有工作，而是：评估任务 → 决定委派给哪些子角色 → 明确各子角色的任务与验收标准 → 汇总结果。');
  lines.push('');
  lines.push('【团队成员清单】');
  for (const m of members) {
    const caps = (m.capabilities ?? []).join('、') || '—';
    const mission = m.operation.mission || m.description;
    lines.push(`- ${m.name}（${m.slug}）：${m.description || ''}｜能力：${caps}｜使命：${mission}`);
  }
  lines.push('');
  lines.push('【委派要求】');
  lines.push('1. 先给出一份「委派计划」：每个子角色负责什么、输入输出、验收标准。');
  lines.push('2. 若任务简单，可只委派给单一最合适的子角色，不必强行拆分。');
  lines.push('3. 汇总各子角色的产出为最终交付，并说明哪些由你亲自完成。');

  return lines.join('\n').trim();
}
