/**
 * ============================================
 * 职位发现图组装（JobsGraph Builder）
 * ============================================
 *
 * 【职责】
 * 用 LangGraph 的 StateGraph 组装 ReAct 循环图。
 *
 * 【图结构（ReAct 循环）】
 *   START → agent ⇄ tools
 *
 *   agent  ：LLM 决策（bindTools 后 invoke，产出 tool_calls 或最终回答）
 *   tools  ：执行 search_jobs 工具，结果回填消息流
 *   条件边 ：agent 之后——若还有 tool_calls 且未超迭代上限 → tools（继续循环）
 *            否则 → END（停止，最终回答即推荐结果）
 *
 * 【自主规划的体现】
 * 循环次数、搜索关键词、是否换词重搜全部由 LLM 自主决定，
 * 代码只提供「决策→执行→观察→再决策」的骨架，不写死搜索流程。
 *
 * 【防失控】
 * maxIterations 限制 agent 节点最大执行轮数，超出后强制结束，
 * 避免 LLM 陷入无限调用工具的循环。
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { createDeepSeekChat } from "../../llm/deepseek.js";
import { JobsStateAnnotation, type JobsState } from "./state.js";
import { createAgentNode, toolsNode } from "./nodes.js";

/** 条件路由返回的目标（"tools" 继续循环，或 "end" 结束） */
type RouteAfterAgent = "tools" | "end";

/**
 * 构建并编译职位发现图。
 *
 * @param apiKey  - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @param options - 可选配置（maxIterations 最大迭代轮数）
 * @returns 编译后的图，可调用 .stream(state, { streamMode: "updates" }) 执行
 */
export function buildJobsGraph(
  apiKey: string,
  options?: { maxIterations?: number }
) {
  const llm = createDeepSeekChat(apiKey);
  const maxIterations = options?.maxIterations ?? 6;

  // 注入模型实例到 agent 节点（闭包）
  const agentNode = createAgentNode(llm);

  /**
   * agent 节点之后的条件路由函数。
   *
   * 规则：
   * 1. 最后一条 AIMessage 仍携带 tool_calls 且未超迭代上限 → 继续执行工具；
   * 2. 否则 → 结束循环（此时 agent 已给出最终推荐）。
   */
  function routeAfterAgent(state: JobsState): RouteAfterAgent {
    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls =
      lastMessage instanceof AIMessage ? (lastMessage.tool_calls ?? []) : [];

    // 统计已发生的 agent 决策轮数（每个 AIMessage 代表一轮）
    const agentTurns = state.messages.filter(
      (m) => m.getType() === "ai"
    ).length;

    if (toolCalls.length > 0 && agentTurns < maxIterations) {
      return "tools";
    }
    return "end";
  }

  const graph = new StateGraph(JobsStateAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    // agent 之后按「是否继续调工具」分叉：继续 → tools，停止 → END
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      end: END,
    })
    // 工具执行完回到 agent，形成循环
    .addEdge("tools", "agent")
    .compile();

  return graph;
}
