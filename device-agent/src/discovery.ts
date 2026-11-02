import { Bonjour } from 'bonjour-service';
import { MDNS_SERVICE_TYPE } from '@agentfleet/shared';
import { config } from './config.js';
import { loadRegistry } from './registry.js';

/**
 * mDNS 广播：本机服务 _agentfleet._tcp + TXT(deviceId/name/port/version)。
 * 沙箱受限（mDNS 不可用）时降级为「配置指定协调服务地址直连」。
 */
let bonjour: Bonjour | null = null;

export interface BroadcastHandle {
  stop(): void;
}

/** 开始广播本机服务 */
export function startDiscovery(port: number): BroadcastHandle {
  const { deviceId } = loadRegistry();
  try {
    bonjour = new Bonjour();
    const service = bonjour.publish({
      name: `${config.deviceName}-${deviceId.slice(-4)}`,
      type: MDNS_SERVICE_TYPE,
      port,
      txt: {
        deviceId,
        name: config.deviceName,
        port: String(port),
        version: config.version,
      },
    });
    console.log(`[discovery] mDNS 广播已启动 ${MDNS_SERVICE_TYPE} (port=${port})`);
    return {
      stop: () => {
        service.stop?.();
        bonjour?.destroy?.();
        bonjour = null;
      },
    };
  } catch (err) {
    console.warn(
      '[discovery] mDNS 广播失败，降级为「配置指定协调服务地址直连」:',
      (err as Error).message,
    );
    if (config.coordinatorUrl) {
      console.log(`[discovery] 将直连协调服务 ${config.coordinatorUrl}`);
    }
    return { stop: () => undefined };
  }
}
