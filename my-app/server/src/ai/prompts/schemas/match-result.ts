/**
 * ============================================
 * 岗位匹配度结构化输出 Schema（MatchResultSchema）
 * ============================================
 *
 * 【职责】
 * 用 Zod 声明「岗位匹配度评估」节点要求模型返回的强类型 JSON 结构。
 * 该节点仅在请求携带岗位描述（JD）时执行。
 */

import { z } from "zod";

/** 岗位匹配度结构化输出 Schema */
export const MatchResultSchema = z.object({
  /** 匹配度评分 0-100 */
  matchScore: z.number().min(0).max(100).describe("匹配度评分 0-100"),
  /** 已匹配的关键词 */
  matchedKeywords: z.array(z.string()).describe("已匹配的关键词"),
  /** 缺失的关键词 */
  missingKeywords: z.array(z.string()).describe("缺失的关键词"),
  /** 差距分析 */
  gapAnalysis: z.string().describe("差距分析"),
  /** 改进计划，按优先级排序 */
  improvementPlan: z
    .array(
      z.object({
        action: z.string().describe("改进动作"),
        priority: z.enum(["high", "medium", "low"]).describe("优先级"),
      })
    )
    .describe("改进计划，按优先级排序"),
});

/** 岗位匹配度结构化输出的 TypeScript 类型（由 Schema 推导） */
export type MatchResult = z.infer<typeof MatchResultSchema>;
