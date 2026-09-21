/**
 * ============================================
 * 职位发现图状态定义（JobsState）
 * ============================================
 *
 * 【职责】
 * 定义职位发现 Agent（ReAct 循环 + finalize 结构化）在节点间传递的共享状态。
 *
 * 【字段说明】
 * - messages        ：ReAct 循环的消息流（agent ⇄ tools 的往返历史）
 * - recommendations ：finalize 节点产出的结构化推荐列表（含推荐原因/招呼语/直达链接）
 *
 * 【messages 采用追加合并】
 * 每个节点返回的新消息追加到历史之后，完整保留思考/调用轨迹，
 * 这也是「学习导向」的关键——AI Trace 面板可还原整个决策过程。
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { JobRecommendation } from "../../prompts/schemas/job-recommendation.js";

export const JobsStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    // 追加合并：新消息追加到已有消息之后
    reducer: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    default: () => [],
  }),

  // 结构化推荐结果（finalize 节点写入一次，last-value-wins 语义）
  recommendations: Annotation<JobRecommendation | null>,
});

/** 职位发现图状态类型（由 Annotation 推导） */
export type JobsState = typeof JobsStateAnnotation.State;
