/**
 * 语义向量嵌入（P0-1）：本地小模型 Xenova/all-MiniLM-L6-v2（onnxruntime-web wasm，零外部 API）。
 *
 * 懒加载：首次 embed 时加载模型（约 4.5s），之后复用。模型加载失败返回 null，
 * 调用方降级为 BM25 + Jaccard（不影响核心召回）。仅 leader 侧持有向量，设备端仍 BM25 只读账本。
 */
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (!loading) {
    env.backends.onnx.wasm.numThreads = 1;
    loading = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      .then((p) => {
        extractor = p as FeatureExtractionPipeline;
        return extractor;
      })
      .catch((err) => {
        loading = null; // 失败可重试
        throw err;
      });
  }
  return loading;
}

/** 批量文本 → 归一化向量（384 维）。模型不可用/加载失败时返回 null。 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const nonEmpty = texts.map((t) => t?.trim() || '').filter((t) => t.length > 0);
  if (nonEmpty.length === 0) return null;
  try {
    const ex = await getExtractor();
    const out = await ex(nonEmpty, { pooling: 'mean', normalize: true });
    return out.tolist() as number[][];
  } catch {
    return null;
  }
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  let d = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!;
    nx += a[i]! * a[i]!;
    ny += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(nx) * Math.sqrt(ny);
  return denom > 0 ? d / denom : 0;
}
