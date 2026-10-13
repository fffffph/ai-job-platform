/**
 * ============================================
 * 简历分析图节点（ResumeGraph Nodes）
 * ============================================
 *
 * 【职责】
 * 实现 ResumeGraph 的四个执行节点：
 * - parseNode   ：纯文本规范化（无 LLM）
 * - analyzeNode ：结构化分析简历（LLM + Function Calling）
 * - matchNode   ：结构化评估岗位匹配度（LLM，仅在有 JD 时执行）
 * - suggestNode ：汇总改进建议（无 LLM，聚合前序节点结果）
 *
 * 【P2 变更】
 * 分析/匹配节点不再输出自由文本，而是通过 withStructuredOutput(zodSchema)
 * 让 DeepSeek 返回强类型 JSON 对象，前端可直接渲染。
 *
 * 【trace 埋点】
 * 每个节点入口记录开始时间，出口调用 collectTrace 记录
 * { nodeName, input, output, durationMs, timestamp }，供 AI Trace 面板消费。
 */

import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ResumeState } from "./state.js";
import { collectTrace } from "../../trace/tracer.js";
import { RESUME_EXPERT_SYSTEM_PROMPT } from "../../prompts/system/resume-expert.js";
import { buildAnalyzeMessage } from "../../prompts/tasks/resume/analyze.js";
import { buildMatchMessage } from "../../prompts/tasks/resume/match.js";
import {
  ResumeAnalysisSchema,
  type ResumeAnalysis,
} from "../../prompts/schemas/resume-analysis.js";
import {
  MatchResultSchema,
  type MatchResult,
} from "../../prompts/schemas/match-result.js";

/**
 * 简历分析节点可注入的 Prompt（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到各 prompt 文件内置默认值。
 */
export interface ResumeNodePrompts {
  /** 简历诊断专家人设（默认 RESUME_EXPERT_SYSTEM_PROMPT，配置项 prompt.resume_expert） */
  resumeExpertPrompt?: string;
  /** 简历分析任务指令（默认 ANALYZE_TASK_PROMPT，配置项 prompt.analyze_task） */
  analyzeTaskPrompt?: string;
  /** 岗位匹配任务指令（默认 MATCH_TASK_PROMPT，配置项 prompt.match_task） */
  matchTaskPrompt?: string;
}

/**
 * 解析节点（纯文本处理，不调用 LLM）。
 *
 * 对简历原文做轻量规范化：
 * 1. 统一换行符（\r\n、\r 统一为 \n）
 * 2. 去掉每行行尾空白
 * 3. 折叠 3 个及以上的连续空行为 1 个空行
 * 4. 去除首尾空白
 */
export function parseNode(state: ResumeState): Partial<ResumeState> {
  const startedAt = Date.now();

  const normalized = state.resumeText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const output: Partial<ResumeState> = { resumeText: normalized };

  collectTrace({
    nodeName: "parse",
    input: { resumeText: state.resumeText },
    output,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  return output;
}

/**
 * 创建分析节点（工厂函数）。
 *
 * 通过闭包注入已配置好的 DeepSeek 模型实例。节点内部使用
 * llm.withStructuredOutput(ResumeAnalysisSchema) 让模型返回强类型的
 * ResumeAnalysis 对象（结构化输出为非流式，故不再逐 token 输出）。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 * @param options - 可选：节点 Prompt（P3 参数收敛，缺省走内置默认值）
 */
export function createAnalyzeNode(llm: ChatOpenAI, options?: ResumeNodePrompts) {
  return async function analyzeNode(
    state: ResumeState
  ): Promise<Partial<ResumeState>> {
    const startedAt = Date.now();

    // 绑定 zod schema 的结构化模型，invoke 返回 ResumeAnalysis 对象。
    // 注意：显式指定 method: "functionCalling"，因为 DeepSeek 不支持 OpenAI 的
    // response_format（jsonMode），必须走 tool calling 方式做结构化输出。
    //
    // ⚠️ functionCalling 会强制 tool_choice，与思考模式互斥（同时用会 400）；
    // 简历链路的模型实例由装配层固定关闭思考（见 config/ai-config.ts 的
    // RESUME_THINKING_SUPPORTED）。
    const structuredLlm = llm.withStructuredOutput(ResumeAnalysisSchema, {
      method: "functionCalling",
    });

    const messages = [
      new SystemMessage(
        options?.resumeExpertPrompt ?? RESUME_EXPERT_SYSTEM_PROMPT
      ),
      new HumanMessage(
        buildAnalyzeMessage(state.resumeText, options?.analyzeTaskPrompt)
      ),
    ];

    let analysis: ResumeAnalysis;
    try {
      analysis = (await structuredLlm.invoke(messages)) as ResumeAnalysis;
    } catch (error) {
      // 结构化输出失败（如模型返回非法 JSON / schema 校验不过），转成中文提示
      const detail = (error as Error).message || "未知原因";
      throw new Error(`简历结构化分析失败：${detail}`);
    }

    collectTrace({
      nodeName: "analyze",
      input: { resumeText: state.resumeText },
      output: { analysis },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    // 本链路固定关闭思考（functionCalling 与思考模式互斥），故不产出思考链
    return { analysis };
  };
}

/**
 * 创建匹配度评估节点（工厂函数）。
 *
 * 有 JD 时把简历 + JD 一起喂给模型，用 withStructuredOutput(MatchResultSchema)
 * 返回强类型 MatchResult。无 JD 时条件路由不会进入本节点，此处保留防御性兜底。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 * @param options - 可选：节点 Prompt（P3 参数收敛，缺省走内置默认值）
 */
export function createMatchNode(llm: ChatOpenAI, options?: ResumeNodePrompts) {
  return async function matchNode(
    state: ResumeState
  ): Promise<Partial<ResumeState>> {
    const startedAt = Date.now();

    const jobDescription = state.jobDescription.trim();

    // 防御性兜底：正常流程条件路由已拦截无 JD 的情况，此处不应进入
    if (!jobDescription) {
      const output: Partial<ResumeState> = { match: null };
      collectTrace({
        nodeName: "match_assess",
        input: { resumeText: state.resumeText, jobDescription },
        output,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
      return output;
    }

    // ⚠️ 同 analyze 节点：functionCalling 强制 tool_choice，与思考模式互斥
    const structuredLlm = llm.withStructuredOutput(MatchResultSchema, {
      method: "functionCalling",
    });

    const messages = [
      new SystemMessage(
        options?.resumeExpertPrompt ?? RESUME_EXPERT_SYSTEM_PROMPT
      ),
      new HumanMessage(
        buildMatchMessage(
          state.resumeText,
          jobDescription,
          options?.matchTaskPrompt
        )
      ),
    ];

    let match: MatchResult;
    try {
      match = (await structuredLlm.invoke(messages)) as MatchResult;
    } catch (error) {
      const detail = (error as Error).message || "未知原因";
      throw new Error(`岗位匹配度评估失败：${detail}`);
    }

    collectTrace({
      nodeName: "match_assess",
      input: { resumeText: state.resumeText, jobDescription },
      output: { match },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    // 同 analyze 节点：functionCalling 与思考模式互斥，本节点不产出思考链
    return { match };
  };
}

/**
 * 建议汇总节点（无 LLM，纯聚合）。
 *
 * 汇总 analysis.weaknesses[].suggestion 与 match.improvementPlan[].action，
 * 去重后输出字符串数组，作为最终改进建议列表。
 */
export function suggestNode(state: ResumeState): Partial<ResumeState> {
  const startedAt = Date.now();

  const suggestions: string[] = [];

  // 汇总分析节点的短板建议
  if (state.analysis) {
    for (const weakness of state.analysis.weaknesses) {
      const suggestion = weakness.suggestion.trim();
      if (suggestion) suggestions.push(suggestion);
    }
  }

  // 汇总匹配度节点的改进计划
  if (state.match) {
    for (const plan of state.match.improvementPlan) {
      const action = plan.action.trim();
      if (action) suggestions.push(action);
    }
  }

  // 去重（保持首次出现顺序），产出最终建议列表
  const uniqueSuggestions = Array.from(new Set(suggestions));

  const output: Partial<ResumeState> = { suggestions: uniqueSuggestions };

  collectTrace({
    nodeName: "suggest",
    input: { analysis: state.analysis, match: state.match },
    output,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  return output;
}
