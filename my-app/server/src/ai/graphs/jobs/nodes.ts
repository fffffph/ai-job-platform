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
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { JobsState } from "./state.js";
import { collectTrace } from "../../trace/tracer.js";
import { searchJobsTool } from "../../tools/function-calling/search-jobs.js";

/** 工具注册表：工具名 → 工具实例（Agent 通过 Function Calling 按名调用） */
const TOOL_MAP: Record<string, StructuredToolInterface> = {
  search_jobs: searchJobsTool,
};

/**
 * 创建 Agent 决策节点（工厂函数）。
 *
 * 通过闭包注入已配置好的 DeepSeek 模型实例，并 bindTools 绑定职位搜索工具。
 * 节点内部调用 llm.invoke，返回的 AIMessage 可能携带 tool_calls（决定调工具）
 * 或纯文本内容（决定直接回答/推荐）。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 */
export function createAgentNode(llm: ChatOpenAI) {
  // 绑定工具：让 DeepSeek 支持 Function Calling（自主决定是否调 search_jobs）
  const llmWithTools = llm.bindTools(Object.values(TOOL_MAP));

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
 * 工具执行节点。
 *
 * 读取消息流中最后一条 AIMessage 的 tool_calls，逐个执行对应工具，
 * 把执行结果封装成 ToolMessage 追加回消息流，供 agent 节点下一轮决策。
 *
 * 注意：本节点是无状态的纯分发逻辑，不依赖全局变量，工具按注册表查找。
 */
export async function toolsNode(state: JobsState): Promise<Partial<JobsState>> {
  const startedAt = Date.now();

  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls =
    lastMessage instanceof AIMessage ? (lastMessage.tool_calls ?? []) : [];

  const toolMessages: ToolMessage[] = [];
  const executed: string[] = [];

  for (const call of toolCalls) {
    const toolInstance = TOOL_MAP[call.name];
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
}
