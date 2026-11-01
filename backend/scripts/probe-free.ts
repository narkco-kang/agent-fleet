/**
 * 免费源真实探测脚本（手动运行，不依赖数据库/后端）。
 *
 * 用法（Node 24）：
 *   npm run probe:free --workspace backend
 *   npm run probe:free --workspace backend -- --timeout=20000
 *
 * 输出：
 * - modelgateway 角色路由里的免费线路（需 MODELGATEWAY_URL 可达）
 * - 直连公开免密源（Kilo / OpenCode）真实 chat 探测结果
 */
import { probeAllFreeSources } from '../src/services/routing/freeSourceService.js';

const timeoutArg = process.argv.find((a) => a.startsWith('--timeout='));
const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) : 15_000;

const report = await probeAllFreeSources({ timeoutMs, autoCheckin: true });

console.log('\n=== 免费源真实探测 ===');
console.log(`modelgateway 已配置: ${report.gateway.configured}`);
console.log(`网关免费线路: ${report.gateway.sources.join(', ') || '(无)'}`);
for (const r of report.gateway.results) {
  console.log(
    `  [gateway] ${r.model} → ${r.ok ? 'OK' : 'FAIL'}${r.status ? ` (${r.status})` : ''} ${r.latencyMs}ms` +
      `${r.checkinAttempted ? ` checkin=${r.checkinOk}` : ''}${r.error ? ` err=${String(r.error).slice(0, 120)}` : ''}`,
  );
}
console.log('\n直连公开免费源:');
for (const r of report.direct) {
  console.log(
    `  [${r.sourceId}] ${r.model} → ${r.ok ? 'OK' : 'FAIL'}${r.status ? ` (${r.status})` : ''} ${r.latencyMs}ms` +
      `${r.quotaLimited ? ' quota-limited' : ''}${r.authRequired ? ' auth-required' : ''}` +
      `${r.text ? ` text=${JSON.stringify(r.text.slice(0, 40))}` : ''}${r.error ? ` err=${String(r.error).slice(0, 120)}` : ''}`,
  );
}
console.log(`\n可用源: ${report.usable.length ? report.usable.join(', ') : '(全部不可用)'}`);
console.log('评级保留清单（仅优/中）:');
for (const r of report.ranked) {
  console.log(`  [${r.ratingLabel}] ${r.key} (${r.latencyMs}ms)${r.quotaLimited ? ' quota-limited' : ''}`);
}
console.log('');

process.exit(report.usable.length > 0 ? 0 : 2);
