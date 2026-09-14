/**
 * ============================================
 * 简历分析图状态定义（ResumeState）
 * ============================================
 *
 * 【职责】
 * 定义 ResumeGraph 在节点间传递的共享状态结构。
 * 使用 LangGraph 的 Annotation.Root 声明式定义，
 * 并为每个字段配置合并规则（reducer）。
 *
 * 【P1 最小字段】
 * - resumeText：简历原文（parse 节点做规范化）
 * - analysis  ：AI 分析结果（analyze 节点产出）
 * - messages  ：对话消息流（analyze 节点追加 AIMessage）
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * 简历分析图的 LangGraph 状态注解。
 *
 * 字段语义：
 * - resumeText：字符串，采用"后写覆盖"（last-value-wins），
 *   parse 节点会将其替换为规范化后的文本。
 * - analysis：字符串，同样后写覆盖，由 analyze 节点写入。
 * - messages：消息数组，采用"追加合并"（concat），
 *   analyze 节点每次追加新的 AI 消息，历史消息得以保留。
 */
export const ResumeStateAnnotation = Annotation.Root({
  // 简单字段：直接用 Annotation<T>（不传参），语义为"后写覆盖"（last-value-wins）。
  // 注意：LangGraph 1.x 中简单字段不能写成 Annotation<string>({ default: ... })，
  // 那样会被当成 SingleReducer 要求提供 reducer/value，导致类型错误。
  resumeText: Annotation<string>,
  analysis: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    // 追加式合并：新返回的消息追加到已有消息之后
    reducer: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    // 默认值为空数组，保证未传入 messages 时字段可用
    default: () => [],
  }),
});

/**
 * 简历分析图状态类型。
 *
 * 从上面的 Annotation 推导而来，实际结构等价于：
 * { resumeText: string; analysis: string; messages: BaseMessage[] }
 * 后续节点、路由均通过该类型读写状态。
 */
export type ResumeState = typeof ResumeStateAnnotation.State;
