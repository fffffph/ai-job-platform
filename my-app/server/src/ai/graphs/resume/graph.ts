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
import {
  createDeepSeekChat,
  type DeepSeekReasoningEffort,
} from "../../llm/deepseek.js";
import { ResumeStateAnnotation, type ResumeState } from "./state.js";
import {
  parseNode,
  createAnalyzeNode,
  createMatchNode,
  suggestNode,
  type ResumeNodePrompts,
} from "./nodes.js";

/** 条件路由返回的合法目标节点名 */
type RouteAfterAnalyze = "match_assess" | "suggest";

/**
 * buildResumeGraph 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到各模块内置默认值。
 */
export interface ResumeGraphOptions extends ResumeNodePrompts {
  /** 对话模型名（默认 deepseek-chat，配置项 llm.model） */
  model?: string;
  /** 采样温度（默认 0.3，配置项 llm.temperature） */
  temperature?: number;
  /** 单次最大 token（默认 4096，配置项 llm.max_tokens） */
  maxTokens?: number;
  /** 请求超时毫秒（默认 60000，配置项 llm.timeout_ms） */
  timeout?: number;
  /**
   * 是否开启深度思考（Thinking Mode）。
   *
   * 由装配层按「全局熔断 ∩ 会话级开关」判定后传入；显式传 false 会向模型
   * 下发关闭指令（服务端默认开启思考，不显式关掉就省不下时间与费用）。
   */
  thinking?: boolean;
  /** 思考强度档位（仅在 thinking 为 true 时下发） */
  reasoningEffort?: DeepSeekReasoningEffort;
}

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
 * @param options - 可选参数（模型/温度/Prompt 等），缺省走内置默认值
 * @returns 编译后的图，可调用 .stream(state, { streamMode: ... }) 执行
 */
export function buildResumeGraph(
  apiKey: string,
  options?: ResumeGraphOptions
) {
  // 根据当前用户 Key 创建 DeepSeek 模型实例（模型参数可由配置中心覆盖）
  const llm = createDeepSeekChat(apiKey, {
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeout: options?.timeout,
    thinking: options?.thinking,
    reasoningEffort: options?.reasoningEffort,
  });

  // 注入模型实例到 LLM 节点（闭包），节点函数保持无副作用；
  // Prompt 由配置中心注入，节点内部 ?? 回退默认值
  const nodePrompts: ResumeNodePrompts = {
    resumeExpertPrompt: options?.resumeExpertPrompt,
    analyzeTaskPrompt: options?.analyzeTaskPrompt,
    matchTaskPrompt: options?.matchTaskPrompt,
  };
  const analyzeNode = createAnalyzeNode(llm, nodePrompts);
  const matchNode = createMatchNode(llm, nodePrompts);

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
