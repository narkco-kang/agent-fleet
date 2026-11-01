import Fastify from 'fastify';
import { config } from './config.js';
import { verifyUrl, decryptMessage, buildReply } from './gateway/wecomGateway.js';
import { personalDegradeHint } from './gateway/personalGateway.js';
import { llmParser } from './parser/llmParser.js';
import { submitToBackend, fetchQueueSummary, cancelTaskOnBackend } from './bridge.js';

/**
 * 微信网关入口：企业微信回调（验签/解密）+ 降级提示 + 任务桥接。
 */
async function main(): Promise<void> {
  const app = Fastify({ logger: false });

  // 解析 XML 请求体（text/xml）
  app.addContentTypeParser('text/xml', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body as string);
  });

  /** 健康检查 */
  app.get('/wechat/health', async () => ({ ok: true, service: 'agentmesh-wechat' }));

  /** 企业微信回调 URL 验证（GET） */
  app.get<{
    Querystring: { msg_signature: string; timestamp: string; nonce: string; echostr: string };
  }>('/wechat/callback', async (req, reply) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    const plain = verifyUrl(msg_signature ?? '', timestamp ?? '', nonce ?? '', echostr ?? '');
    if (plain === null) {
      return reply.code(403).send('verify failed');
    }
    return reply.type('text/plain').send(plain);
  });

  /** 企业微信回调解密 + 处理 + 被动回复 */
  app.post<{
    Querystring: { msg_signature: string; timestamp: string; nonce: string };
    Body: string;
  }>('/wechat/callback', async (req, reply) => {
    const { msg_signature, timestamp, nonce } = req.query;
    const encryptBody = extractEncrypt(String(req.body ?? ''));
    if (!encryptBody) {
      return reply.code(400).send('bad request');
    }

    const inbound = decryptMessage(msg_signature ?? '', timestamp ?? '', nonce ?? '', encryptBody);
    if (!inbound) {
      // 未配置企微密钥或验签失败 → 降级提示（不静默）
      const hint = '企业微信未正确配置（token/aesKey）或验签失败。' + personalDegradeHint();
      return reply.type('text/plain').send(hint);
    }

    const replyText = await processMessage(inbound.fromUser, inbound.content, 'wechat_work');
    const encrypted = buildReply(inbound.fromUser, replyText, timestamp ?? String(Date.now()), nonce ?? 'agentmesh');
    if (encrypted) {
      return reply.type('application/xml').send(encrypted);
    }
    return reply.type('text/plain').send(replyText);
  });

  await app.listen({ host: config.host, port: config.port });
  console.log(`[wechat] 微信网关已启动 http://${config.host}:${config.port}`);
  console.log(`[wechat] 企业微信回调地址: http://<host>:${config.port}/wechat/callback`);
  if (!config.token || !config.encodingAESKey) {
    console.warn('[wechat] 未配置 WECOM_TOKEN/WECOM_ENCODING_AES_KEY，企微回调将降级为提示');
  }
}

/** 处理一条消息 → 返回回复文案 */
async function processMessage(fromUser: string, content: string, origin: 'wechat_personal' | 'wechat_work'): Promise<string> {
  const cmd = await llmParser.parse(content, origin);
  switch (cmd.kind) {
    case 'help':
      return 'AgentMesh 命令：\n/status 查看队列\n/cancel #任务ID 取消任务\n直接发文本即可下发任务\n@agent类型 指定平台（如 @grok 修复bug）';
    case 'status': {
      try {
        return await fetchQueueSummary();
      } catch {
        return '查询失败：协调服务不可达';
      }
    }
    case 'cancel': {
      if (!cmd.taskId) return '用法：/cancel #任务ID';
      const ok = await cancelTaskOnBackend(cmd.taskId);
      return ok ? `任务 ${cmd.taskId} 已取消` : `取消失败：任务 ${cmd.taskId} 不存在或不可取消`;
    }
    case 'task': {
      if (!cmd.prompt) return '请提供任务描述';
      try {
        const r = await submitToBackend(cmd);
        return `已接收 · 任务 ${r.taskId.slice(0, 8)}（${r.status}）。执行结果将自动回推，长结果附看板链接。`;
      } catch (e) {
        return `下发失败：${(e as Error).message}`;
      }
    }
    default:
      return '未识别的命令，输入 /help 查看帮助';
  }
}

/** 从 XML 请求体提取 <Encrypt> */
function extractEncrypt(xml: string): string {
  const m = xml.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/) ?? xml.match(/<Encrypt>([\s\S]*?)<\/Encrypt>/);
  return m ? m[1] : '';
}

main().catch((err) => {
  console.error('[wechat] 启动失败:', err);
  process.exit(1);
});
