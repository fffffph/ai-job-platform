/**
 * ============================================
 * 简历分析图状态定义（ResumeState）
 * ============================================
 *
 * 【职责】
 * 定义 ResumeGraph 在节点间传递的共享状态结构。
 * P2 从「文本分析」升级为「结构化输出」，状态字段随之扩展。
 *
 * 【字段说明】
 * - resumeText     ：简历原文（parse 节点做规范化）
 * - jobDescription ：可选岗位描述 JD（无 JD 时为空字符串）
 * - analysis       ：结构化简历分析结果（analyze 节点产出，对象或 null）
 * - match          ：结构化匹配度结果（match_assess 节点产出，无 JD 时为 null）
 * - suggestions    ：改进建议汇总（suggest 节点产出，字符串数组）
 * - messages       ：对话消息流（P2 结构化输出不产生消息，预留用于未来多轮）
 * - reasoning      ：该节点模型思考过程全文（未开启深度思考时为空串）
 * - reasoningMs    ：该节点模型调用耗时毫秒（供前端展示「已思考 N 秒」）
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ResumeAnalysis } from "../../prompts/schemas/resume-analysis.js";
import type { MatchResult } from "../../prompts/schemas/match-result.js";

export const ResumeStateAnnotation = Annotation.Root({
  // ---------- 简单字段（last-value-wins，后写覆盖） ----------
  // 注意：LangGraph 1.x 中简单字段不能写成 Annotation<string>({ default: ... })，
  // 那样会被当成 SingleReducer 要求提供 reducer/value，导致类型错误。
  resumeText: Annotation<string>,
  jobDescription: Annotation<string>,
  analysis: Annotation<ResumeAnalysis | null>,
  match: Annotation<MatchResult | null>,

  // ---------- 数组字段（追加合并，concat reducer） ----------
  suggestions: Annotation<string[]>({
    reducer: (current: string[], update: string[]) => current.concat(update),
    default: () => [],
  }),

  // ---------- 消息数组（追加合并，P2 预留） ----------
  messages: Annotation<BaseMessage[]>({
    reducer: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    default: () => [],
  }),

  // ---------- 深度思考（每个 LLM 节点各写各的，随该节点的 update 传给路由层） ----------
  // last-value-wins：路由层在处理某个节点的 updates 时读到的是该节点刚写入的值
  reasoning: Annotation<string>,
  reasoningMs: Annotation<number>,
});

/** 简历分析图状态类型（由 Annotation 推导） */
export type ResumeState = typeof ResumeStateAnnotation.State;
