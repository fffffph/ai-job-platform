/**
 * ============================================
 * 职位发现图节点（JobsGraph Nodes）
 * ============================================
 *
 * 【职责】
 * 实现 ReAct 循环的两个核心节点：
 * - agentNode ：LLM 决策节点（bindTools 后 invoke，可能产出 tool_calls）
 * - toolsNode ：工具执行节点（执行 search_jobs 等工具，产出 ToolMessage）
 *
 * 【ReAct 循环】
 *   agent（思考+决定调工具）→ tools（执行工具拿结果）→ agent（看结果再决策）
 * 如此往复，直到 agent 不再调用工具、直接给出最终推荐。
 *
 * 【trace 埋点】
 * 每个节点入口记录开始时间，出口调用 collectTrace，供 AI Trace 面板消费，
 * 完整还原「Agent 每一步调了什么工具、拿到什么结果」。
 */

import type { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  ToolMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { JobsState } from "./state.js";
import { collectTrace } from "../../trace/tracer.js";
import { searchJobsTool } from "../../tools/function-calling/search-jobs.js";
import type { JobPosting } from "../../tools/function-calling/job-data.js";
import {
  JobRecommendationSchema,
  type JobRecommendation,
} from "../../prompts/schemas/job-recommendation.js";

/**
 * 创建 Agent 决策节点（工厂函数）。
 *
 * 通过闭包注入已配置好的 DeepSeek 模型实例，并 bindTools 绑定职位搜索工具。
 * 节点内部调用 llm.invoke，返回的 AIMessage 可能携带 tool_calls（决定调工具）
 * 或纯文本内容（决定直接回答/推荐）。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 */
export function createAgentNode(
  llm: ChatOpenAI,
  tools?: StructuredToolInterface[]
) {
  // 工具列表：默认用 search_jobs 单例；图装配层可按 switch.mock_jobs 注入
  const toolList = tools ?? [searchJobsTool];
  // 绑定工具：让 DeepSeek 支持 Function Calling（自主决定是否调 search_jobs）
  const llmWithTools = llm.bindTools(toolList);

  return async function agentNode(
    state: JobsState
  ): Promise<Partial<JobsState>> {
    const startedAt = Date.now();

    // 直接以当前消息流为上下文调用模型（system prompt 已由路由层注入为第一条消息）
    const response = await llmWithTools.invoke(state.messages);

    // 提取本次决策的关键信息用于 trace（避免打印完整消息流导致日志过长）
    const toolCalls = (response as AIMessage).tool_calls ?? [];
    const hasToolCalls = toolCalls.length > 0;

    collectTrace({
      nodeName: "agent",
      input: { messageCount: state.messages.length },
      output: hasToolCalls
        ? {
            action: "call_tools",
            toolCalls: toolCalls.map((c) => ({
              name: c.name,
              args: c.args,
            })),
          }
        : { action: "answer", content: String(response.content).slice(0, 200) },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return { messages: [response] };
  };
}

/**
 * 创建工具执行节点（工厂函数）。
 *
 * 读取消息流中最后一条 AIMessage 的 tool_calls，逐个执行对应工具，
 * 把执行结果封装成 ToolMessage 追加回消息流，供 agent 节点下一轮决策。
 *
 * 注意：本节点通过闭包注入工具映射，保持无全局状态、纯分发逻辑。
 * 图装配层按 switch.mock_jobs 开关选择数据源后传入对应的 toolMap。
 *
 * @param toolMap - 工具名 → 工具实例 的映射（如 { search_jobs: searchJobsTool }）
 */
export function createToolsNode(
  toolMap: Record<string, StructuredToolInterface>
) {
  return async function toolsNode(
    state: JobsState
  ): Promise<Partial<JobsState>> {
    const startedAt = Date.now();

    const lastMessage = state.messages[state.messages.length - 1];
    const toolCalls =
      lastMessage instanceof AIMessage ? (lastMessage.tool_calls ?? []) : [];

    const toolMessages: ToolMessage[] = [];
    const executed: string[] = [];

    for (const call of toolCalls) {
      const toolInstance = toolMap[call.name];
      let content: string;

      if (toolInstance) {
        try {
          // 执行工具（args 已由 Function Calling 校验过 schema）
          const result = await toolInstance.invoke(call.args);
          content =
            typeof result === "string" ? result : JSON.stringify(result);
          executed.push(call.name);
        } catch (error) {
          content = `工具 ${call.name} 执行失败：${(error as Error).message}`;
        }
      } else {
        content = `错误：未知工具 ${call.name}`;
      }

      toolMessages.push(
        new ToolMessage({
          content,
          tool_call_id: call.id ?? "",
          name: call.name,
        })
      );
    }

    collectTrace({
      nodeName: "tools",
      input: { toolCalls: executed },
      output: { resultCount: toolMessages.length },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return { messages: toolMessages };
  };
}

// ============================================================
// finalize 节点（ReAct 循环结束后的结构化推荐）
// ============================================================

/** finalize 节点所需的用户求职画像 */
export interface FinalizeProfile {
  city: string;
  skills: string;
  expectedSalary: string;
}

/**
 * 生成 finalize 节点的系统 Prompt（含可调策略数字）。
 *
 * 原 Prompt 里写死的「最多 8 条」「40 字以内」拆成独立配置项，
 * 由配置中心注入后模板化生成。缺省走内置默认值（向后兼容）。
 *
 * @param maxRecommend   - 推荐条数上限（默认 8，配置项 jobs.max_recommend）
 * @param greetingMaxLen - 招呼语字数上限（默认 40，配置项 jobs.greeting_max_len）
 */
function buildFinalizePrompt(
  maxRecommend: number = 8,
  greetingMaxLen: number = 40
): string {
  return `你是资深求职顾问。请从「候选职位列表」中，根据「用户求职意向」选出最匹配的职位（最多 ${maxRecommend} 条），按匹配度从高到低排序，并为每条生成推荐原因和自动招呼语。

要求：
1. reason：一句话说明为什么适合（技能匹配/城市符合/薪资达标等），客观具体；
2. greeting：礼貌的自动招呼语，突出求职者优势，可直接用于 BOSS直聘「立即沟通」，控制在 ${greetingMaxLen} 字以内；
3. url：必须使用候选职位数据中自带的 url 字段（BOSS直达链接），不要自行编造或修改；
4. summary：一句话总结本次推荐的整体情况；
5. 全程简体中文。`;
}

/**
 * 从 ReAct 循环的消息流中提取所有搜索到的职位（按 id 去重）。
 *
 * 遍历消息流，找到所有 search_jobs 工具返回的 ToolMessage，
 * 解析其中的 jobs 数组，按职位 id 去重后返回。
 *
 * @param messages - ReAct 循环的消息流
 * @returns 去重后的职位列表
 */
function extractJobsFromMessages(messages: BaseMessage[]): JobPosting[] {
  const seen = new Set<string>();
  const jobs: JobPosting[] = [];

  for (const msg of messages) {
    if (!(msg instanceof ToolMessage)) continue;
    if (msg.name !== "search_jobs") continue;

    try {
      const parsed = JSON.parse(String(msg.content)) as {
        jobs?: JobPosting[];
      };
      for (const job of parsed.jobs ?? []) {
        if (job?.id && !seen.has(job.id)) {
          seen.add(job.id);
          jobs.push(job);
        }
      }
    } catch {
      // 单条消息解析失败，跳过不影响整体
    }
  }

  return jobs;
}

/**
 * 构造 finalize 节点的人类消息（用户画像 + 候选职位列表）。
 */
function buildFinalizeMessage(
  jobs: JobPosting[],
  profile: FinalizeProfile
): string {
  return (
    `【用户求职意向】\n` +
    `城市：${profile.city || "不限"}\n` +
    `技能栈：${profile.skills || "不限"}\n` +
    `期望薪资：${profile.expectedSalary || "不限"}\n\n` +
    `【候选职位列表】\n${JSON.stringify(jobs, null, 2)}\n\n` +
    `请从上述职位中选出最匹配的，生成结构化推荐。`
  );
}

/**
 * 创建 finalize 节点（工厂函数）。
 *
 * 在 ReAct 循环结束后执行：从消息流提取搜索到的职位，结合用户画像，
 * 用 withStructuredOutput 生成结构化推荐列表（含推荐原因/招呼语/直达链接）。
 *
 * @param llm     - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 * @param profile - 用户求职画像（期望城市/技能/薪资）
 * @param options - 可选：推荐条数上限 / 招呼语字数上限（P3 参数收敛，缺省走默认值）
 */
export function createFinalizeNode(
  llm: ChatOpenAI,
  profile: FinalizeProfile,
  options?: { maxRecommend?: number; greetingMaxLen?: number }
) {
  // DeepSeek 结构化输出必须用 functionCalling（不支持 response_format）
  const structuredLlm = llm.withStructuredOutput(JobRecommendationSchema, {
    method: "functionCalling",
  });

  // 工厂阶段就生成最终 Prompt（闭包捕获），避免每次节点执行重复拼接
  const finalizePrompt = buildFinalizePrompt(
    options?.maxRecommend,
    options?.greetingMaxLen
  );

  return async function finalizeNode(
    state: JobsState
  ): Promise<Partial<JobsState>> {
    const startedAt = Date.now();

    // 1. 提取搜索到的职位（去重）
    const jobs = extractJobsFromMessages(state.messages);

    // 2. 无职位 → 返回空推荐
    if (jobs.length === 0) {
      const empty: JobRecommendation = {
        summary: "未搜索到匹配职位，请调整求职意向后再试",
        recommendations: [],
      };
      collectTrace({
        nodeName: "finalize",
        input: { jobCount: 0 },
        output: { recommendationCount: 0 },
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
      return { recommendations: empty };
    }

    // 3. 结构化生成推荐
    const messages = [
      new SystemMessage(finalizePrompt),
      new HumanMessage(buildFinalizeMessage(jobs, profile)),
    ];

    let result: JobRecommendation;
    try {
      result = (await structuredLlm.invoke(messages)) as JobRecommendation;
    } catch (error) {
      const detail = (error as Error).message || "未知原因";
      throw new Error(`职位推荐结构化生成失败：${detail}`);
    }

    collectTrace({
      nodeName: "finalize",
      input: { jobCount: jobs.length, profile },
      output: { recommendationCount: result.recommendations.length },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return { recommendations: result };
  };
}
