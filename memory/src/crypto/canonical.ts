/**
 * 确定性 JSON 序列化 —— 账本一致性的根基。
 *
 * 与 Python `json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`
 * 语义一致，TS 侧实现规则（C1-C7）：
 *   C1 对象 key 按 Unicode 码点升序递归排序（与插入顺序无关）
 *   C2 字符串 UTF-8，不转义非 ASCII（中文原样）
 *   C3 无多余空白
 *   C4 数字：整数十进制、禁止科学计数法、无前导零、无小数点
 *   C5 数组保持元素顺序
 *   C6 布尔 true/false、null 标准 JSON
 *   C7 对象内不保留 undefined（一律不序列化）
 */

/** 序列化任意值（递归）。 */
function serialize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      // JSON.stringify 默认不转义非 ASCII，仅转义引号/反斜杠/控制字符，
      // 与 Python ensure_ascii=False 语义一致。
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map((item) => serialize(item)).join(',') + ']';
      }
      return serializeObject(value as Record<string, unknown>);
    default:
      throw new Error(
        `canonicalize: unsupported type ${typeof value} (undefined 应在上层省略)`,
      );
  }
}

/** 对象 key 升序递归序列化，跳过 undefined 值。 */
function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined) continue;
    parts.push(JSON.stringify(key) + ':' + serialize(value));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * 数字序列化：整数走十进制、无科学计数法；-0 归一为 0。
 *
 * 注：Number 的十进制字面量在 |n| < 1e21 时无需科学计数法；账本域内的整数
 * （timestamp 毫秒 / rev / index / grade）均远小于该上界，因此 String(n) 即满足 C4。
 */
function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`canonicalize: cannot serialize non-finite number ${value}`);
  }
  if (Object.is(value, -0)) return '0';
  return String(value);
}

/**
 * 确定性序列化入口：返回与跨语言约定一致的规范 JSON 字符串。
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}
