/**
 * ============================================
 * 职位推荐结构化输出 Schema（JobRecommendationSchema）
 * ============================================
 *
 * 【职责】
 * 定义职位发现 Agent 最终输出（finalize 节点）的强类型 JSON 结构。
 * 在 ReAct 循环搜索完成后，finalize 节点把搜索到的职位 + 用户画像
 * 交给 LLM，用 withStructuredOutput 生成结构化推荐列表。
 *
 * 【为什么要有 url 和 greeting？】
 * - url     ：BOSS直聘直达搜索链接，用户点击跳转真实职位页投递
 * - greeting：一键生成的自动招呼语，用户复制后粘贴到 BOSS直聘「立即沟通」
 */

import { z } from "zod";

/** 单条职位推荐 */
export const JobRecommendationItemSchema = z.object({
  /** 职位名称 */
  jobTitle: z.string().describe("职位名称"),
  /** 公司名称 */
  company: z.string().describe("公司名称"),
  /** 所在城市 */
  city: z.string().describe("所在城市"),
  /** 薪资范围，如 "12k-18k" */
  salary: z.string().describe("薪资范围"),
  /** 推荐原因：说明该职位为什么适合这位求职者（技能/城市/薪资匹配等） */
  reason: z
    .string()
    .describe("推荐原因，说明该职位为什么适合这位求职者"),
  /** 自动招呼语：可复制粘贴到 BOSS直聘「立即沟通」的打招呼文本 */
  greeting: z
    .string()
    .describe("自动招呼语，可复制粘贴到 BOSS直聘立即沟通，礼貌且突出个人优势"),
  /** BOSS直聘直达搜索链接 */
  url: z.string().describe("BOSS直聘直达搜索链接"),
});

/** 单条职位推荐类型（由 Schema 推导） */
export type JobRecommendationItem = z.infer<typeof JobRecommendationItemSchema>;

/** 职位推荐结构化输出 */
export const JobRecommendationSchema = z.object({
  /** 一句话总结本次推荐的整体情况 */
  summary: z.string().describe("一句话总结本次推荐的总体情况"),
  /** 推荐职位列表，按匹配度从高到低排序，最多 8 条 */
  recommendations: z
    .array(JobRecommendationItemSchema)
    .describe("推荐职位列表，按匹配度从高到低排序"),
});

/** 职位推荐结构化输出类型（由 Schema 推导） */
export type JobRecommendation = z.infer<typeof JobRecommendationSchema>;
