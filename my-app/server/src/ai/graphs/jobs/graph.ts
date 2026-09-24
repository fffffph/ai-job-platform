/**
 * ============================================
 * 职位发现图组装（JobsGraph Builder）
 * ============================================
 *
 * 【职责】
 * 用 LangGraph 的 StateGraph 组装「ReAct 循环 + finalize 结构化」图。
 *
 * 【图结构】
 *   START → agent ⇄ tools（ReAct 循环）
 *           │
 *           └─（无 tool_calls 时）→ finalize → END
 *
 *   agent    ：LLM 决策（bindTools 后 invoke，产出 tool_calls 或结束搜索）
 *   tools    ：执行 search_jobs 工具，结果回填消息流
 *   finalize ：提取搜索到的职位 + 用户画像，结构化生成推荐列表
 *              （含推荐原因 / 自动招呼语 / BOSS直达链接）
 *   条件边   ：agent 之后——若还有 tool_calls 且未超迭代上限 → tools（继续循环）
 *              否则 → finalize（结束搜索，进入结构化推荐）
 *
 * 【自主规划的体现】
 * 循环次数、搜索关键词、是否换词重搜全部由 LLM 自主决定，
 * 代码只提供「决策→执行→观察→再决策」的骨架，不写死搜索流程。
 *
 * 【防失控】
 * maxIterations 限制 agent 节点最大执行轮数，超出后强制进入 finalize。
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { createDeepSeekChat } from "../../llm/deepseek.js";
import { JobsStateAnnotation, type JobsState } from "./state.js";
import {
  createAgentNode,
  createToolsNode,
  createFinalizeNode,
  type FinalizeProfile,
} from "./nodes.js";
import { createSearchJobsTool } from "../../tools/function-calling/search-jobs.js";

/** 条件路由返回的目标（"tools" 继续循环，或 "finalize" 进入结构化推荐） */
type RouteAfterAgent = "tools" | "finalize";

/**
 * buildJobsGraph 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到各模块内置默认值。
 */
export interface JobsGraphOptions {
  // —— 模型参数 ——
  /** 对话模型名（默认 deepseek-chat，配置项 llm.model） */
  model?: string;
  /** 采样温度（默认 0.3，配置项 llm.temperature） */
  temperature?: number;
  /** 单次最大 token（默认 4096，配置项 llm.max_tokens） */
  maxTokens?: number;
  /** 请求超时毫秒（默认 60000，配置项 llm.timeout_ms） */
  timeout?: number;
  // —— 职位推荐参数 ——
  /** 推荐条数上限（默认 8，配置项 jobs.max_recommend） */
  maxRecommend?: number;
  /** 招呼语字数上限（默认 40，配置项 jobs.greeting_max_len） */
  greetingMaxLen?: number;
  /** ReAct 最大迭代轮数（默认 6） */
  maxIterations?: number;
  /** 是否使用模拟职位数据（默认 true，配置项 switch.mock_jobs） */
  useMockJobs?: boolean;
  /** 用户求职画像（供 finalize 节点个性化推荐） */
  profile?: FinalizeProfile;
}

/**
 * 构建并编译职位发现图。
 *
 * @param apiKey  - 当前用户的 DeepSeek 明文 Key（由路由层解密获取）
 * @param options - 可选配置（模型/推荐参数/最大迭代/画像），缺省走内置默认值
 * @returns 编译后的图，可调用 .stream(state, { streamMode: "updates" }) 执行
 */
export function buildJobsGraph(
  apiKey: string,
  options?: JobsGraphOptions
) {
  const llm = createDeepSeekChat(apiKey, {
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeout: options?.timeout,
  });
  const maxIterations = options?.maxIterations ?? 6;
  const profile: FinalizeProfile = options?.profile ?? {
    city: "",
    skills: "",
    expectedSalary: "",
  };

  // 【P5 开关】按 switch.mock_jobs 选择数据源，构建 search_jobs 工具
  const useMockJobs = options?.useMockJobs ?? true;
  const searchTool = createSearchJobsTool(useMockJobs);
  const toolMap = { search_jobs: searchTool };

  // 注入模型实例到 agent 节点与 finalize 节点（闭包），
  // finalize 节点的推荐条数/招呼语字数由配置中心注入
  const agentNode = createAgentNode(llm, [searchTool]);
  const toolsNode = createToolsNode(toolMap);
  const finalizeNode = createFinalizeNode(llm, profile, {
    maxRecommend: options?.maxRecommend,
    greetingMaxLen: options?.greetingMaxLen,
  });

  /**
   * agent 节点之后的条件路由函数。
   *
   * 规则：
   * 1. 最后一条 AIMessage 仍携带 tool_calls 且未超迭代上限 → 继续执行工具；
   * 2. 否则 → 进入 finalize（Agent 已完成搜索，开始结构化推荐）。
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
    return "finalize";
  }

  const graph = new StateGraph(JobsStateAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "agent")
    // agent 之后按「是否继续调工具」分叉：继续 → tools，停止 → finalize
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      finalize: "finalize",
    })
    // 工具执行完回到 agent，形成循环
    .addEdge("tools", "agent")
    // finalize 完成后结束
    .addEdge("finalize", END)
    .compile();

  return graph;
}
