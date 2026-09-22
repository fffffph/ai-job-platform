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
 * 
 *  【P2 图结构（带条件路由）】
 *   START → parse → analyze → 条件路由 → match_assess（有 JD）/ suggest（无 JD）
 *                        └──────────────────┘
 *   match_assess → suggest → END
 *
 * - parse       ：纯文本规范化（无 LLM）
 * - analyze     ：结构化分析简历（LLM + Function Calling）
 * - match_assess：结构化评估岗位匹配度（仅在有 JD 时，LLM）
 * - suggest     ：汇总改进建议（无 LLM）
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { createDeepSeekChat } from "../../llm/deepseek.js";
import { ResumeStateAnnotation, type ResumeState } from "./state.js";
import {
  parseNode,
  createAnalyzeNode,
  createMatchNode,
  suggestNode,
} from "./nodes.js";

/** 条件路由返回的合法目标节点名 */
type RouteAfterAnalyze = "match_assess" | "suggest";

/**
 * analyze 节点之后的条件路由函数。
 *
 * 规则：请求携带 JD（jobDescription 非空）→ 进入匹配度评估；
 *       否则跳过匹配度，直接进入建议汇总。
 */
function routeAfterAnalyze(state: ResumeState): RouteAfterAnalyze {
  const hasJobDescription = state.jobDescription.trim().length > 0;
  return hasJobDescription ? "match_assess" : "suggest";
}

/**
 * 构建并编译简历分析图。
 *
 * @param apiKey - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @returns 编译后的图，可调用 .stream(state, { streamMode: ... }) 执行
 */
export function buildResumeGraph(apiKey: string) {
  // 根据当前用户 Key 创建 DeepSeek 模型实例
  const llm = createDeepSeekChat(apiKey);

  // 注入模型实例到 LLM 节点（闭包），节点函数保持无副作用
  const analyzeNode = createAnalyzeNode(llm);
  const matchNode = createMatchNode(llm);

  const graph = new StateGraph(ResumeStateAnnotation)
    .addNode("parse", parseNode)
    .addNode("analyze", analyzeNode)
    .addNode("match_assess", matchNode)
    .addNode("suggest", suggestNode)
    .addEdge(START, "parse")
    .addEdge("parse", "analyze")
    // analyze 之后按是否有 JD 分叉
    .addConditionalEdges("analyze", routeAfterAnalyze, {
      match_assess: "match_assess",
      suggest: "suggest",
    })
    .addEdge("match_assess", "suggest")
    .addEdge("suggest", END)
    .compile();

  return graph;
}
