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
import { searchJobs } from "./job-data.js";

/**
 * 搜索职位工具。
 *
 * Agent 可多次调用本工具，通过组合不同关键词（如先搜 "React"，
 * 再搜 "微前端 Node.js"）逐步探索职位库，模拟多源抓取 + 智能检索。
 */
export const searchJobsTool = tool(
  async ({ keywords, city, source }) => {
    // 调用 mock 数据源的搜索函数，返回 JSON 字符串
    return searchJobs(keywords, city, source);
  },
  {
    name: "search_jobs",
    description:
      "搜索职位库。按关键词和城市检索职位，返回职位列表（含职位名、公司、城市、薪资、技术标签、要求）。" +
      "可多次调用、组合不同关键词探索更多职位。",
    schema: z.object({
      keywords: z
        .string()
        .describe("搜索关键词，多个关键词用空格分隔，如 'React 微前端'"),
      city: z.string().optional().describe("城市，如 '西安'，不填则全国搜索"),
      source: z
        .string()
        .optional()
        .describe("数据来源 boss/lagou/liepin，不填则全部来源"),
    }),
  }
);
