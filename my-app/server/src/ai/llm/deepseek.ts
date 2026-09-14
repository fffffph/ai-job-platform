/**
 * ============================================
 * DeepSeek 模型适配层（LLM Adapter）
 * ============================================
 *
 * 【职责】
 * 封装 @langchain/openai 的 ChatOpenAI 类，将其指向 DeepSeek 的
 * OpenAI 兼容接口，并支持"每次调用动态传入用户级 API Key"。
 *
 * 【为什么 Key 要动态传入？】
 * 本平台的 DeepSeek API Key 是"用户级"的：每个登录用户可以在
 * 个人中心配置自己的 Key。因此不能在模块加载时用环境变量写死一个
 * 全局实例，而必须在每次请求时根据当前用户解密出 Key 后新建实例。
 *
 * 【DeepSeek 兼容性说明】
 * DeepSeek 官方提供 OpenAI 兼容接口：
 *   baseURL = https://api.deepseek.com
 * 模型名 = deepseek-chat，支持 streaming（流式）与 function calling。
 * ChatOpenAI 默认请求路径为 {baseURL}/chat/completions，与 DeepSeek 一致。
 */

import { ChatOpenAI } from "@langchain/openai";

/** DeepSeek OpenAI 兼容接口地址（官方推荐写法，无需 /v1 后缀） */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** DeepSeek 对话模型名 */
const DEEPSEEK_MODEL = "deepseek-chat";

/** 单次生成最大 token 数（deepseek-chat 上限 8192，这里保守取 4096） */
const DEEPSEEK_MAX_TOKENS = 4096;

/** 分析类任务采样温度，取值越低输出越稳定 */
const DEEPSEEK_TEMPERATURE = 0.3;

/** 请求超时（毫秒），避免上游无响应时连接永久挂起 */
const DEEPSEEK_TIMEOUT_MS = 60_000;

/**
 * 创建一个指向 DeepSeek 的 ChatOpenAI 实例。
 *
 * 每次调用都会用传入的明文 apiKey 新建实例，保证：
 * 1. Key 按用户隔离，不跨请求串用；
 * 2. 实例用完即弃，Key 不长期驻留内存。
 *
 * @param apiKey - 当前用户的 DeepSeek 明文 Key（由 getDecryptedKey 提供）
 * @returns 配置好的 ChatOpenAI 实例（已开启 streaming）
 * @throws apiKey 为空时抛出错误（应在上游路由层拦截，这里做兜底）
 */
export function createDeepSeekChat(apiKey: string): ChatOpenAI {
  if (!apiKey) {
    throw new Error("未提供 DeepSeek API Key，无法创建模型实例");
  }

  return new ChatOpenAI({
    // 模型名（DeepSeek 的 OpenAI 兼容模型标识）
    model: DEEPSEEK_MODEL,
    // 用户级明文 Key，每次调用动态传入
    apiKey,
    // 覆盖 OpenAI 客户端配置，指向 DeepSeek 服务器
    configuration: {
      baseURL: DEEPSEEK_BASE_URL,
    },
    // 必须开启流式，LangGraph 的 streamMode: "messages" 才能逐 token 产出
    streaming: true,
    temperature: DEEPSEEK_TEMPERATURE,
    maxTokens: DEEPSEEK_MAX_TOKENS,
    timeout: DEEPSEEK_TIMEOUT_MS,
  });
}
