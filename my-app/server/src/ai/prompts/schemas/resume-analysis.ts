/**
 * ============================================
 * 简历分析结构化输出 Schema（ResumeAnalysisSchema）
 * ============================================
 *
 * 【职责】
 * 用 Zod 声明「简历分析」节点要求模型返回的强类型 JSON 结构。
 * DeepSeek 通过 Function Calling（withStructuredOutput）严格按此结构输出，
 * 前端拿到的是可预测、可直接渲染的对象，而非需要解析的自由文本。
 *
 * 【使用方式】
 * llm.withStructuredOutput(ResumeAnalysisSchema).invoke(messages)
 * 返回对象的类型即下方的 ResumeAnalysis。
 */

import { z } from "zod";

/** 简历分析结构化输出 Schema */
export const ResumeAnalysisSchema = z.object({
  /** 简历整体评分 0-100 */
  overallScore: z.number().min(0).max(100).describe("简历整体评分 0-100"),
  /** 简历亮点标签，如 ['量化数据充分','技术栈清晰'] */
  tags: z
    .array(z.string())
    .describe("简历亮点标签，如 ['量化数据充分','技术栈清晰']"),
  /** 核心亮点，需可溯源（evidence 必须引用简历原文） */
  highlights: z
    .array(
      z.object({
        point: z.string().describe("亮点描述"),
        evidence: z.string().describe("引用简历原文作为证据"),
      })
    )
    .describe("核心亮点，需可溯源"),
  /** 主要短板与建议 */
  weaknesses: z
    .array(
      z.object({
        issue: z.string().describe("问题描述"),
        suggestion: z.string().describe("改进建议"),
      })
    )
    .describe("主要短板与建议"),
  /** 一句话总评 */
  summary: z.string().describe("一句话总评"),
});

/** 简历分析结构化输出的 TypeScript 类型（由 Schema 推导） */
export type ResumeAnalysis = z.infer<typeof ResumeAnalysisSchema>;
