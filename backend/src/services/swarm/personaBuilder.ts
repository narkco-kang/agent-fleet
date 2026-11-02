import type { SubRole } from '@agentfleet/shared';

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
