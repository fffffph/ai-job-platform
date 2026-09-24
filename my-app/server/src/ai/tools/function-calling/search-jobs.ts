/**
 * ============================================
 * search_jobs 工具（Function Calling）
 * ============================================
 *
 * 【职责】
 * 把职位搜索能力封装成 LangChain Tool，供职位发现 Agent 在 ReAct
 * 循环中自主调用。Agent 通过 Function Calling 决定搜索什么关键词、
 * 搜几次、是否换关键词重搜，从而体现「自主规划」。
 *
 * 【为什么工具返回 JSON 字符串？】
 * LangChain Tool 的返回值会作为 ToolMessage 的内容交给 LLM，
 * 返回 JSON 字符串便于 LLM 结构化理解职位数据。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { searchJobs, searchRealJobs } from "./job-data.js";

/** search_jobs 工具的参数 Schema（复用给工厂，避免重复定义） */
const searchJobsSchema = z.object({
  keywords: z
    .string()
    .describe("搜索关键词，多个关键词用空格分隔，如 'React 微前端'"),
  city: z.string().optional().describe("城市，如 '西安'，不填则全国搜索"),
  source: z
    .string()
    .optional()
    .describe("数据来源 boss/lagou/liepin，不填则全部来源"),
});

/**
 * 创建搜索职位工具（工厂函数）。
 *
 * 【P5 开关】switch.mock_jobs 决定数据源：
 * - useMock = true（默认）→ 用内置模拟职位库 searchJobs；
 * - useMock = false        → 用真实数据源 searchRealJobs（当前为 stub，返回空 + 提示）。
 *
 * 工厂化让图在构建时按配置注入数据源，工具本体保持纯函数、不读全局状态。
 *
 * @param useMock - 是否使用模拟数据（默认 true，配置项 switch.mock_jobs）
 */
export function createSearchJobsTool(useMock: boolean = true) {
  return tool(
    async ({ keywords, city, source }) => {
      // 按开关选择数据源，返回 JSON 字符串
      return useMock
        ? searchJobs(keywords, city, source)
        : searchRealJobs(keywords, city, source);
    },
    {
      name: "search_jobs",
      description:
        "搜索职位库。按关键词和城市检索职位，返回职位列表（含职位名、公司、城市、薪资、技术标签、要求）。" +
        "可多次调用、组合不同关键词探索更多职位。",
      schema: searchJobsSchema,
    }
  );
}

/**
 * 搜索职位工具（默认单例，使用模拟数据）。
 *
 * 保留导出用于向后兼容；图装配层已改为调用工厂 createSearchJobsTool，
 * 按 switch.mock_jobs 开关动态选择数据源。
 */
export const searchJobsTool = createSearchJobsTool(true);
