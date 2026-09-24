/**
 * ============================================
 * Embedding 适配层（SiliconFlow / 硅基流动）
 * ============================================
 *
 * 【职责】
 * 封装 SiliconFlow 的 OpenAI 兼容 Embedding 接口，把文本转成向量。
 * 使用模型 BAAI/bge-m3，输出 1024 维向量，供 RAG 检索（pgvector）使用。
 *
 * 【为什么用服务端级 Key 而不是用户级 Key？】
 * Embedding 是"平台能力"，所有用户共享同一个向量模型，不需要按用户
 * 隔离（与 DeepSeek 对话模型的用户级 Key 机制不同）。因此 Key 直接从
 * 服务端环境变量 SILICONFLOW_API_KEY 读取。
 *
 * 【向量维度】
 * bge-m3 固定输出 1024 维，必须与 prisma/schema.prisma 中 Chunk.embedding
 * 的 vector(1024) 严格一致，否则写入 pgvector 时会报维度不匹配。
 */

/** 请求超时（毫秒） */
const EMBEDDING_TIMEOUT_MS = 60_000;

/**
 * embedTexts 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到本文件顶部的内置默认值。
 */
export interface EmbeddingOptions {
  /** 请求超时毫秒（默认 60000，配置项 rag.embedding_timeout_ms） */
  timeoutMs?: number;
}

/** SiliconFlow embedding 接口原始响应结构 */
interface EmbeddingResponse {
  /** 向量结果数组，每个元素含 embedding 与 index */
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model?: string;
  object?: string;
  usage?: unknown;
}

/**
 * 批量文本向量化。
 *
 * 一次性把多条文本用单个 HTTP 请求发给 SiliconFlow（input 支持数组），
 * 比逐条调用更省时、更省钱。返回按 index 排序，保证与输入顺序一致。
 *
 * @param texts  - 待向量化的文本数组
 * @param apiKey - 可选：用户级 SiliconFlow Key（明文，来自 getDecryptedSiliconflowKey）
 *                 传入时优先使用，否则回退到服务端环境变量 SILICONFLOW_API_KEY
 * @param options - 可选参数（超时等），缺省走内置默认值
 * @returns 与输入等长的二维向量数组（每条 1024 维 number[]）
 * @throws 无 Key / 网络失败 / 返回异常时抛出中文错误
 */
export async function embedTexts(
  texts: string[],
  apiKey?: string,
  options?: EmbeddingOptions
): Promise<number[][]> {
  // ---------- 1. 读取并校验 Key（用户级优先，服务端 env 兜底） ----------
  const key = apiKey || process.env.SILICONFLOW_API_KEY || "";
  if (!key) {
    throw new Error(
      "未配置 SiliconFlow API Key，无法向量化文本，请在个人中心配置硅基流动 API Key"
    );
  }

  // ---------- 2. 规范化输入 ----------
  const inputs = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (inputs.length === 0) {
    throw new Error("待向量化的文本列表为空");
  }

  // 服务地址与模型名（环境变量可覆盖，默认指向硅基流动）
  const baseURL =
    process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
  const model = process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3";

  // ---------- 3. 调用 Embedding 接口（带超时保护） ----------
  const timeoutMs = options?.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: inputs,
        // 显式声明浮点输出（而非 base64），拿到 number[]
        encoding_format: "float",
      }),
      signal: controller.signal,
    });

    // 非 2xx 统一转成中文错误
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? "API Key 无效（401）"
          : res.status === 402
            ? "账户余额不足（402）"
            : res.status === 429
              ? "请求过于频繁（429）"
              : `接口返回异常（${res.status}）`;
      throw new Error(
        `调用硅基流动 Embedding 接口失败：${hint}` +
          `${raw ? `，详情：${raw.slice(0, 120)}` : ""}`
      );
    }

    const body = (await res.json()) as EmbeddingResponse;
    const list = body.data ?? [];

    // 返回数量必须与输入一致，否则说明接口异常
    if (list.length !== inputs.length) {
      throw new Error(
        `硅基流动 Embedding 返回数量异常：期望 ${inputs.length} 条，实际 ${list.length} 条`
      );
    }

    // 按 index 升序排序，确保与输入顺序严格对应
    return list
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  } catch (error) {
    // 超时单独给友好提示；其余错误原样抛出（内部已带中文前缀）
    if ((error as Error).name === "AbortError") {
      throw new Error(
        `调用硅基流动 Embedding 接口超时（${timeoutMs / 1000}s）`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 单条文本向量化。
 *
 * @param text   - 待向量化的单条文本
 * @param apiKey - 可选：用户级 SiliconFlow Key，传入时优先使用
 * @param options - 可选参数（超时等），缺省走内置默认值
 * @returns 1024 维向量 number[]
 */
export async function embedText(
  text: string,
  apiKey?: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const results = await embedTexts([text], apiKey, options);
  return results[0];
}
