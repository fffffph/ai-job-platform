/**
 * ============================================
 * 职位发现图状态定义（JobsState）
 * ============================================
 *
 * 【职责】
 * 定义职位发现 Agent（ReAct 循环）在节点间传递的共享状态。
 *
 * 【为什么只有 messages 一个字段？】
 * ReAct 循环的本质是「LLM 与工具之间的消息往返」：
 *   AIMessage（含 tool_calls）→ ToolMessage（工具结果）→ AIMessage ...
 * 所有中间状态（搜索关键词、搜索结果、推荐理由）都编码在消息流里，
 * LLM 通过读取历史消息自主决策下一步，因此无需额外状态字段。
 *
 * 【messages 采用追加合并】
 * 每个节点返回的新消息追加到历史之后，完整保留思考/调用轨迹，
 * 这也是「学习导向」的关键——AI Trace 面板可还原整个决策过程。
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export const JobsStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // 追加合并：新消息追加到已有消息之后
    reducer: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    default: () => [],
  }),
});

/** 职位发现图状态类型（由 Annotation 推导） */
export type JobsState = typeof JobsStateAnnotation.State;
