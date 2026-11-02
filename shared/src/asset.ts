import type { AssetContentType, AssetKind, DeliveryStatus } from './status.js';

/**
 * 资产协议：规则 / 资料库 / skills 统一 Asset 模型，复用传输层分发。
 */

/** 资产来源：manual 手动创建 / github GitHub 抓取导入 / imported 文件批量导入 */
export type AssetSource = 'manual' | 'github' | 'imported';

/** 统一资产 */
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** 概述/注释（显示在资产列表，说明该 skill/规则的作用） */
  description: string;
  /** 概述的中文翻译（空则前端按需回退显示 description 英文原文） */
  descriptionZh: string;
  /** 来源：manual / github / imported */
  source: AssetSource;
  /** text 内容；contentType=file 时为路径/引用 */
  content: string;
  contentType: AssetContentType;
  /** 单调递增版本 */
  version: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** 资产分发记录 */
export interface AssetDelivery {
  id: string;
  assetId: string;
  assetVersion: number;
  deviceId: string;
  status: DeliveryStatus;
  error?: string;
  createdAt: number;
  deliveredAt?: number;
}

/** 资产下发 payload（asset.deliver，协调 → 设备） */
export interface AssetDeliver {
  deliveryId: string;
  assetId: string;
  kind: AssetKind;
  name: string;
  content: string;
  contentType: AssetContentType;
  version: number;
}

/** 资产落盘结果（asset.deliver_ack，设备 → 协调） */
export interface AssetDeliverAck {
  deliveryId: string;
  assetId: string;
  deviceId: string;
  version: number;
  status: 'delivered' | 'failed';
  error?: string;
  /** 落盘绝对路径（成功时返回，便于排查） */
  path?: string;
}
