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
import { DEFAULT_TOP_K } from "../../rag/retrieval/retriever.js";

/**
 * 构建并编译 RAG 问答图。
 *
 * @param apiKey - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @param options - 可选配置（topK 检索条数）
 * @returns 编译后的图，可调用 .stream(state, { streamMode: "updates" }) 执行
 */
export function buildRagGraph(apiKey: string, options?: { topK?: number }) {
  // 根据当前用户 Key 创建 DeepSeek 模型实例
  const llm = createDeepSeekChat(apiKey);

  // 注入模型实例与 topK 到节点（闭包），节点函数保持无副作用
  const retrieveNode = createRetrieveNode(options?.topK ?? DEFAULT_TOP_K);
  const answerNode = createAnswerNode(llm);

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
