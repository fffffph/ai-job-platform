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
 * 支持 streaming（流式）与 function calling。
 * ChatOpenAI 默认请求路径为 {baseURL}/chat/completions，与 DeepSeek 一致。
 *
 * 【深度思考（Thinking Mode）】
 * DeepSeek 的思考能力是「同一模型上的参数」，不需要切换到推理专用模型：
 *   - 开关：请求体 {"thinking": {"type": "enabled" | "disabled"}}
 *   - 强度：{"reasoning_effort": "low" | "high" | "max"}（服务端默认 high）
 * 思考过程通过响应中的 reasoning_content 返回（与 content 同级），
 * LangChain 会把它放进 AIMessage.additional_kwargs.reasoning_content，
 * 用本文件的 readReasoningContent() 读取。
 *
 * ⚠️ 思考模式下 temperature 会被服务端忽略（不报错也不生效），
 * 因此开启思考时本工厂不再下发该参数，避免「调了没反应」的困惑。
 *
 * 【能力边界：思考模式与结构化输出互斥（已实测）】
 * DeepSeek 思考模式**不支持指定 tool_choice**，命中会返回：
 *   400 Thinking mode does not support this tool_choice
 * 而 LangChain 的 withStructuredOutput(schema, { method: "functionCalling" })
 * 是靠强制 tool_choice 来保证「必定走这个工具」的（见其 chat_models/base.js
 * 的 withConfig({ tools, tool_choice: { type: "function", function: { name } } })），
 * 因此两者不能同时使用。
 *
 * 由此得出能力对照表（务必按此分配模型实例）：
 *   ✅ 可开思考：纯文本生成（知识库回答）、bindTools 但由模型自主决定
 *               是否调用（职位发现的 agent ReAct 节点）
 *   ❌ 必须关闭：任何 withStructuredOutput(functionCalling) 的调用
 *               （职位推荐 finalize、简历 analyze/match、文本解析）
 *
 * 【为什么不用「实例状态」记录思考链（一次失败的设计复盘）】
 * 曾尝试在 ChatOpenAI 子类里覆写 _generate，把「本轮思考链 + 耗时」记在
 * 实例上供节点读取。实测发现：bindTools() 返回的是一个独立的 Runnable
 * （其 _generate 并非子类的覆写），因此 Agent 场景下覆写根本不会被调用，
 * 节点读到的恒为空串/0。结论：**不要依赖实例状态，直接从 invoke() 返回的
 * 消息上读**（即 readReasoningContent）。
 *
 * 【已知未决风险：多轮 + tools 的 reasoning_content 回传】
 * DeepSeek 文档要求：带 tools 的请求必须把历史轮次的 reasoning_content
 * 原样回传，否则 400；而 @langchain/openai 的出站转换只转发 name /
 * function_call / tool_calls / tool_call_id / audio，会丢弃该字段。
 * 实测：开启思考连续跑 3 轮 ReAct（每轮都带 tools）**未出现 400**
 * （该次运行也未能拿到思考文本，因此约束可能未被触发）。
 * 若将来真的出现 400，兜底办法：① 关掉 switch.deep_thinking；
 * ② 在 completionWithRetry 发包前按消息下标把思考链补回 assistant 消息。
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
 * 思考强度档位（对应 DeepSeek 的 reasoning_effort）。
 *
 * - low  ：思考较快，适合交互式问答
 * - high ：默认档位，质量与耗时平衡
 * - max  ：思考最充分，耗时与 token 消耗最高
 */
export type DeepSeekReasoningEffort = "low" | "high" | "max";

/**
 * createDeepSeekChat 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到本文件顶部的内置默认值（三级回退的最终兜底）。
 * 调用方（如 buildResumeGraph）从配置中心读取这些值后传入，实现「模型参数可配置」。
 */
export interface DeepSeekChatOptions {
  /** 模型名（默认 deepseek-chat） */
  model?: string;
  /** 采样温度（默认 0.3；开启思考时会被忽略，故不下发） */
  temperature?: number;
  /** 单次最大 token（默认 4096） */
  maxTokens?: number;
  /** 请求超时毫秒（默认 60000） */
  timeout?: number;
  /**
   * 是否开启深度思考。
   *
   * - true  ：显式开启（请求体下发 thinking.type = "enabled"）
   * - false ：显式关闭（请求体下发 thinking.type = "disabled"）
   * - 不传   ：不干预，交由服务端默认策略
   */
  thinking?: boolean;
  /** 思考强度档位（仅在 thinking = true 时下发；缺省由服务端取 high） */
  reasoningEffort?: DeepSeekReasoningEffort;
}

/**
 * 从模型返回的消息里读取思考过程全文。
 *
 * DeepSeek 的思考链通过响应体的 reasoning_content 字段返回（与 content 同级），
 * LangChain 会把它放进 message.additional_kwargs.reasoning_content。
 *
 * 【为什么必须从返回消息上读，而不是把实例当状态容器】
 * bindTools() / withStructuredOutput() 返回的是独立的 Runnable，链路并不会
 * 回到我们可能覆写的实例方法上（详见文件头「设计复盘」）。
 * 把 reasoning_content 挂在返回值上传递，是最稳的传递方式。
 *
 * @param message - llm.invoke() 的返回值（AIMessage / AIMessageChunk）
 * @returns 思考过程全文；未开启思考或模型未返回该字段时为空串
 */
export function readReasoningContent(message: unknown): string {
  const raw = (message as { additional_kwargs?: Record<string, unknown> } | null)
    ?.additional_kwargs?.reasoning_content;
  return typeof raw === "string" ? raw : "";
}

/**
 * 创建一个指向 DeepSeek 的 ChatOpenAI 实例。
 *
 * 每次调用都会用传入的明文 apiKey 新建实例，保证：
 * 1. Key 按用户隔离，不跨请求串用；
 * 2. 实例用完即弃，Key 不长期驻留内存。
 *
 * @param apiKey  - 当前用户的 DeepSeek 明文 Key（由 getDecryptedKey 提供）
 * @param options - 可选参数（模型名/温度/token/超时/思考开关），缺省走内置默认值
 * @returns 配置好的 ChatOpenAI 实例（已开启 streaming）
 * @throws apiKey 为空时抛出错误（应在上游路由层拦截，这里做兜底）
 */
export function createDeepSeekChat(
  apiKey: string,
  options?: DeepSeekChatOptions
): ChatOpenAI {
  if (!apiKey) {
    throw new Error("未提供 DeepSeek API Key，无法创建模型实例");
  }

  // 只有显式传 true 才算开启思考；undefined 表示"不干预，用服务端默认"
  const thinkingEnabled = options?.thinking === true;

  return new ChatOpenAI({
    // 模型名（DeepSeek 的 OpenAI 兼容模型标识），配置项 llm.model 可覆盖
    model: options?.model ?? DEEPSEEK_MODEL,
    // 用户级明文 Key，每次调用动态传入
    apiKey,
    // 覆盖 OpenAI 客户端配置，指向 DeepSeek 服务器
    configuration: {
      baseURL: DEEPSEEK_BASE_URL,
    },
    // 必须开启流式，LangGraph 的 streamMode: "messages" 才能逐 token 产出
    streaming: true,
    maxTokens: options?.maxTokens ?? DEEPSEEK_MAX_TOKENS,
    timeout: options?.timeout ?? DEEPSEEK_TIMEOUT_MS,
    // 思考模式下 temperature 被服务端忽略（不报错也不生效），故此时不下发
    ...(thinkingEnabled
      ? {}
      : { temperature: options?.temperature ?? DEEPSEEK_TEMPERATURE }),
    // DeepSeek 的 thinking 开关不是 OpenAI 标准参数，需经 modelKwargs 透传进请求体；
    // 未显式指定时不发送该字段，保持"由服务端决定默认策略"的行为
    ...(options?.thinking === undefined
      ? {}
      : {
          modelKwargs: {
            thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
          },
        }),
    // 思考强度仅在开启思考时下发（缺省时由服务端按 high 处理）
    ...(thinkingEnabled && options?.reasoningEffort
      ? { reasoningEffort: options.reasoningEffort }
      : {}),
  });
}
