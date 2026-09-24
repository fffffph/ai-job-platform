/**
 * ============================================
 * RAG 问答图组装（RAGGraph Builder）
 * ============================================
 *
 * 【职责】
 * 用 LangGraph 的 StateGraph 把知识库问答流程组装成可流式执行的图。
 *
 * 【图结构（线性）】
 *   START → retrieve → generate → END
 *
 * retrieve ：向量检索（无 LLM，查 pgvector Top-K）
 * generate ：LLM 增强生成（DeepSeek + 检索上下文，带引用）
 *
 * 【P3 修正】节点名用 generate 而非 answer：
 * RAGState 中已有 answer 字段（state channel），LangGraph 不允许
 * 节点名与 state 字段重名，否则报 "already being used as a state attribute"。
 *
 * 【为什么 buildRagGraph 接收 apiKey？】
 * 回答节点用 DeepSeek，Key 是用户级的，必须在每次请求时按用户动态注入，
 * 用完即弃，保证按用户隔离、不跨请求串用。
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { createDeepSeekChat } from "../../llm/deepseek.js";
import { RAGStateAnnotation } from "./state.js";
import { createRetrieveNode, createAnswerNode } from "./nodes.js";
import {
  DEFAULT_TOP_K,
  type RetrieveOptions,
} from "../../rag/retrieval/retriever.js";

/**
 * buildRagGraph 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到各模块内置默认值。
 */
export interface RagGraphOptions {
  // —— 模型参数 ——
  /** 对话模型名（默认 deepseek-chat，配置项 llm.model） */
  model?: string;
  /** 采样温度（默认 0.3，配置项 llm.temperature） */
  temperature?: number;
  /** 单次最大 token（默认 4096，配置项 llm.max_tokens） */
  maxTokens?: number;
  /** 请求超时毫秒（默认 60000，配置项 llm.timeout_ms） */
  timeout?: number;
  // —— 检索参数 ——
  /** 检索条数（默认 5，配置项 rag.top_k） */
  topK?: number;
  /** 候选召回倍数（默认 3，配置项 rag.candidate_multiplier） */
  candidateMultiplier?: number;
  /** 检索词加权分（默认 0.15，配置项 rag.keyword_boost） */
  keywordBoost?: number;
  /** 向量化接口超时毫秒（默认 60000，配置项 rag.embedding_timeout_ms） */
  embeddingTimeoutMs?: number;
  /** 是否启用混合检索（默认 true，配置项 switch.hybrid_search） */
  hybrid?: boolean;
  // —— Prompt ——
  /** 回答系统 Prompt（默认内置，配置项 prompt.rag_answer） */
  ragAnswerPrompt?: string;
}

/**
 * 构建并编译 RAG 问答图。
 *
 * @param apiKey - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @param options - 可选配置（模型/检索参数/Prompt），缺省走内置默认值
 * @returns 编译后的图，可调用 .stream(state, { streamMode: "updates" }) 执行
 */
export function buildRagGraph(apiKey: string, options?: RagGraphOptions) {
  // 根据当前用户 Key 创建 DeepSeek 模型实例（模型参数可由配置中心覆盖）
  const llm = createDeepSeekChat(apiKey, {
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeout: options?.timeout,
  });

  // 检索参数（候选召回倍数/检索词加权/超时/混合检索开关）由配置中心注入
  const retrieveOptions: RetrieveOptions = {
    candidateMultiplier: options?.candidateMultiplier,
    keywordBoost: options?.keywordBoost,
    embeddingTimeoutMs: options?.embeddingTimeoutMs,
    hybrid: options?.hybrid,
  };

  // 注入模型实例与 topK/检索参数到节点（闭包），节点函数保持无副作用
  const retrieveNode = createRetrieveNode(
    options?.topK ?? DEFAULT_TOP_K,
    retrieveOptions
  );
  const answerNode = createAnswerNode(llm, options?.ragAnswerPrompt);

  const graph = new StateGraph(RAGStateAnnotation)
    .addNode("retrieve", retrieveNode)
    // 【P3 修正】节点名 generate（避免与 state 字段 answer 冲突）
    .addNode("generate", answerNode)
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile();

  return graph;
}
