/**
 * ============================================
 * RAG 问答图状态定义（RAGState）
 * ============================================
 *
 * 【职责】
 * 定义 RagGraph 在节点间传递的共享状态结构。
 *
 * 【字段说明】
 * - question ：用户问题（入参）
 * - userId   ：当前用户 ID（检索时按用户隔离知识库）
 * - chunks   ：检索命中的知识库分块（retrieve 节点产出，answer 节点消费）
 * - answer   ：带引用的最终回答（answer 节点产出）
 * - reasoning    ：模型思考过程全文（generate 节点产出；未开启思考时为空串）
 * - reasoningMs  ：模型调用耗时毫秒（generate 节点产出，供前端展示「已思考 N 秒」）
 */

import { Annotation } from "@langchain/langgraph";
import type { RetrievedChunk } from "../../rag/retrieval/retriever.js";

export const RAGStateAnnotation = Annotation.Root({
  // ---------- 简单字段（last-value-wins，后写覆盖） ----------
  // 注意：LangGraph 1.x 中简单字段不能写成 Annotation<string>({ default: ... })，
  // 那样会被当成 SingleReducer 要求提供 reducer/value，导致类型错误。
  question: Annotation<string>,
  userId: Annotation<string>,
  answer: Annotation<string>,

  // ---------- 深度思考（Thinking Mode） ----------
  // 由 generate 节点写入，路由层读取后通过 SSE 的 reasoning 事件推给前端。
  // 放在 state 里是为了让路由层能在「节点完成的那一刻」就拿到结果；
  // 若只写进 trace 事件，则要等整张图执行完才能取到，前端体验会差很多。
  reasoning: Annotation<string>,
  reasoningMs: Annotation<number>,

  // ---------- 数组字段（检索结果整体覆盖，last-write-wins 语义） ----------
  // chunks 只由 retrieve 节点写入一次，answer 节点只读，因此 reducer 直接返回新值即可
  chunks: Annotation<RetrievedChunk[]>({
    reducer: (_current: RetrievedChunk[], update: RetrievedChunk[]) => update,
    default: () => [],
  }),
});

/** RAG 问答图状态类型（由 Annotation 推导） */
export type RAGState = typeof RAGStateAnnotation.State;
