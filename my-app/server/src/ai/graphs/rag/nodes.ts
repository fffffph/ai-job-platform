/**
 * ============================================
 * RAG 问答图节点（RAGGraph Nodes）
 * ============================================
 *
 * 【职责】
 * 实现 RagGraph 的两个执行节点：
 * - retrieveNode ：向量检索（无 LLM，调用 retriever 查 pgvector）
 * - answerNode   ：LLM 增强生成（DeepSeek + 检索上下文，输出带引用回答）
 *
 * 【trace 埋点】
 * 每个节点入口记录开始时间，出口调用 collectTrace 记录
 * { nodeName, input, output, durationMs, timestamp }，供 AI Trace 面板消费。
 */

import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RAGState } from "./state.js";
import { collectTrace } from "../../trace/tracer.js";
import {
  retrieveChunks,
  DEFAULT_TOP_K,
  type RetrievedChunk,
  type RetrieveOptions,
} from "../../rag/retrieval/retriever.js";

/** 回答节点的系统 Prompt：要求模型只依据检索结果、并标注引用来源 */
const RAG_ANSWER_SYSTEM_PROMPT = `你是一个专业的求职知识库助手。请基于下方提供的「知识库检索结果」回答用户问题。

要求：
1. 只依据检索结果回答，不要编造检索结果之外的事实。
2. 回答中必须标注引用来源，用 [1]、[2] 等编号对应检索结果中的分块编号。
3. 若检索结果不足以回答，请明确说明"知识库中未找到相关内容"，不要强行作答。
4. 语言：简体中文。`;

/**
 * 把检索到的分块拼接成带编号的上下文文本。
 * 编号 [1] 对应 chunks[0]，以此类推，与回答中的引用标注一一对应。
 */
function buildContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "（无检索结果）";
  }
  return chunks
    .map((c, i) => {
      const scorePercent = `${(c.score * 100).toFixed(1)}%`;
      return (
        `[${i + 1}] 来源：《${c.documentTitle}》 第 ${c.chunkIndex + 1} 块（相似度 ${scorePercent}）\n` +
        c.content
      );
    })
    .join("\n\n");
}

/**
 * 把 LLM 返回的 content 统一转成字符串。
 * DeepSeek 可能返回 string，也可能返回 content blocks 数组，这里做兼容。
 */
function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof (block as { text: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
        return JSON.stringify(block);
      })
      .join("");
  }
  return String(content ?? "");
}

/**
 * 创建检索节点（工厂函数）。
 *
 * 通过闭包注入 topK 与检索参数，节点内部调用 retriever 做向量检索。
 *
 * @param topK - 检索条数（默认 5）
 * @param retrieveOptions - 可选：候选召回倍数/检索词加权/超时（P3 参数收敛）
 */
export function createRetrieveNode(
  topK: number = DEFAULT_TOP_K,
  retrieveOptions?: RetrieveOptions
) {
  return async function retrieveNode(
    state: RAGState
  ): Promise<Partial<RAGState>> {
    const startedAt = Date.now();

    const chunks = await retrieveChunks(
      state.userId,
      state.question,
      topK,
      retrieveOptions
    );

    const output: Partial<RAGState> = { chunks };

    collectTrace({
      nodeName: "retrieve",
      input: { question: state.question, userId: state.userId },
      output: { chunkCount: chunks.length, chunks },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return output;
  };
}

/**
 * 创建回答节点（工厂函数）。
 *
 * 通过闭包注入 DeepSeek 模型实例。节点内部把检索到的 chunks 作为上下文
 * 拼接进 prompt，要求模型在回答中标注 [1]、[2] 引用来源。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 * @param ragAnswerPrompt - 可选：回答系统 Prompt（P3 参数收敛，缺省用内置默认值）
 */
export function createAnswerNode(
  llm: ChatOpenAI,
  ragAnswerPrompt?: string
) {
  return async function answerNode(
    state: RAGState
  ): Promise<Partial<RAGState>> {
    const startedAt = Date.now();

    const context = buildContext(state.chunks);

    const messages = [
      new SystemMessage(ragAnswerPrompt ?? RAG_ANSWER_SYSTEM_PROMPT),
      new HumanMessage(
        `【知识库检索结果】\n${context}\n\n【用户问题】\n${state.question}\n\n请回答并标注引用来源。`
      ),
    ];

    let answer: string;
    try {
      const res = await llm.invoke(messages);
      answer = normalizeContent(res.content);
    } catch (error) {
      const detail = (error as Error).message || "未知原因";
      throw new Error(`RAG 回答生成失败：${detail}`);
    }

    const output: Partial<RAGState> = { answer };

    collectTrace({
      nodeName: "answer",
      input: { question: state.question, chunkCount: state.chunks.length },
      output: { answer },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return output;
  };
}
