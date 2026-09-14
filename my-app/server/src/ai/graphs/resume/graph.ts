/**
 * ============================================
 * 简历分析图组装（ResumeGraph Builder）
 * ============================================
 *
 * 【职责】
 * 用 LangGraph 的 StateGraph 把简历分析流程组装成可流式执行的图。
 *
 * 【P1 图结构（线性）】
 *   START → parse → analyze → END
 *
 * parse    ：纯文本规范化（无 LLM）
 * analyze  ：调用 DeepSeek 流式分析简历（有 LLM）
 *
 * 【为什么 buildResumeGraph 接收 apiKey？】
 * Key 是用户级的，必须在每次请求时根据当前用户动态注入。
 * 因此本函数按请求构建一个"绑定当前用户 Key"的图实例，
 * 用完即弃，保证按用户隔离、不跨请求串用。
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { createDeepSeekChat } from "../../llm/deepseek.js";
import { ResumeStateAnnotation } from "./state.js";
import { parseNode, createAnalyzeNode } from "./nodes.js";

/**
 * 构建并编译简历分析图。
 *
 * @param apiKey - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @returns 编译后的图，可调用 .stream(state, { streamMode: ... }) 流式执行
 */
export function buildResumeGraph(apiKey: string) {
  // 根据当前用户 Key 创建 DeepSeek 模型实例
  const llm = createDeepSeekChat(apiKey);

  // 把模型注入分析节点（闭包），节点函数自身保持无副作用
  const analyzeNode = createAnalyzeNode(llm);

  // 组装线性图：START → parse → analyze → END
  const graph = new StateGraph(ResumeStateAnnotation)
    .addNode("parse", parseNode)
    .addNode("analyze", analyzeNode)
    .addEdge(START, "parse")
    .addEdge("parse", "analyze")
    .addEdge("analyze", END)
    .compile();

  return graph;
}
