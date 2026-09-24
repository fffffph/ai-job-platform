/**
 * ============================================
 * AI 配置装配层（AI Config Assembly）
 * ============================================
 *
 * 【职责】
 * 把「配置中心」的值组装成各个 AI 图/解析器需要的 options 对象，
 * 供路由层一行调用后注入 buildXxxGraph / parseTextWithLLM / ingestDocument。
 *
 * 【为什么需要这一层？】
 * 配置中心的 key 是扁平的字符串（如 "llm.temperature"、"prompt.rag_answer"），
 * 而 AI 图需要的是结构化 options（如 { temperature, ragAnswerPrompt }）。
 * 本层负责「读取配置 → 类型转换 → 组装成 options」，让路由层不感知配置细节，
 * 也避免图/解析器直接依赖配置中心（保持 AI 模块纯函数、可独立测试）。
 *
 * 【装配原则】
 * 1. 只读配置、不写配置；
 * 2. 每个装配函数返回「完整 options 字面量」，缺省字段交由下游 ?? 回退；
 * 3. 多分组并行读取（Promise.all），避免串行查库；
 * 4. 配置读取走 config-service 的内存缓存，热更新即时生效。
 */

import { getConfigGroup } from "./config-service.js";
import type { ResumeGraphOptions } from "../ai/graphs/resume/graph.js";
import type { RagGraphOptions } from "../ai/graphs/rag/graph.js";
import type { JobsGraphOptions } from "../ai/graphs/jobs/graph.js";
import type { IngestOptions } from "../ai/rag/ingestion/indexer.js";
import type { ParseTextLLMOptions } from "../ai/rag/text-parser.js";
import { buildJobAgentPrompt } from "../ai/prompts/system/job-agent.js";

// ============================================================
// 内部工具：从分组映射里按 key 取值的类型安全辅助
// ============================================================

/** 从分组映射读取 llm 组四个模型参数 */
function pickLLMParams(g: Record<string, unknown>): {
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
} {
  return {
    model: g["llm.model"] as string,
    temperature: g["llm.temperature"] as number,
    maxTokens: g["llm.max_tokens"] as number,
    timeout: g["llm.timeout_ms"] as number,
  };
}

// ============================================================
// 各图配置装配函数
// ============================================================

/**
 * 装配「简历分析图」的 options（模型参数 + 三个 Prompt）。
 */
export async function loadResumeGraphOptions(): Promise<ResumeGraphOptions> {
  const [llm, prompt] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("prompt"),
  ]);

  return {
    ...pickLLMParams(llm),
    resumeExpertPrompt: prompt["prompt.resume_expert"] as string,
    analyzeTaskPrompt: prompt["prompt.analyze_task"] as string,
    matchTaskPrompt: prompt["prompt.match_task"] as string,
  };
}

/**
 * 装配「RAG 问答图」的 options（模型参数 + 检索参数 + 回答 Prompt）。
 */
export async function loadRagGraphOptions(): Promise<RagGraphOptions> {
  const [llm, rag, prompt, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("rag"),
    getConfigGroup("prompt"),
    getConfigGroup("switch"),
  ]);

  return {
    ...pickLLMParams(llm),
    topK: rag["rag.top_k"] as number,
    candidateMultiplier: rag["rag.candidate_multiplier"] as number,
    keywordBoost: rag["rag.keyword_boost"] as number,
    embeddingTimeoutMs: rag["rag.embedding_timeout_ms"] as number,
    hybrid: sw["switch.hybrid_search"] as boolean,
    ragAnswerPrompt: prompt["prompt.rag_answer"] as string,
  };
}

/**
 * 装配「职位发现图」的 options，并额外生成模板化的 Agent 系统 Prompt。
 *
 * jobAgentPrompt 在路由层作为第一条 SystemMessage 注入 ReAct 循环，
 * 故单独返回（不走 buildJobsGraph，而是由路由层拼进 initialState.messages）。
 */
export async function loadJobsGraphOptions(): Promise<{
  graph: JobsGraphOptions;
  jobAgentPrompt: string;
}> {
  const [llm, jobs, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("jobs"),
    getConfigGroup("switch"),
  ]);

  // 用配置的「关键词个数 / 候选职位区间」模板化生成 Agent 人设 Prompt
  const jobAgentPrompt = buildJobAgentPrompt({
    skillKeywordsMin: jobs["jobs.skill_keywords_min"] as number,
    skillKeywordsMax: jobs["jobs.skill_keywords_max"] as number,
    candidateMin: jobs["jobs.candidate_min"] as number,
    candidateMax: jobs["jobs.candidate_max"] as number,
  });

  return {
    graph: {
      ...pickLLMParams(llm),
      maxRecommend: jobs["jobs.max_recommend"] as number,
      greetingMaxLen: jobs["jobs.greeting_max_len"] as number,
      useMockJobs: sw["switch.mock_jobs"] as boolean,
    },
    jobAgentPrompt,
  };
}

/**
 * 装配「知识库入库」的 options（分块大小/重叠 + Embedding 超时）。
 */
export async function loadRagIngestOptions(): Promise<IngestOptions> {
  const rag = await getConfigGroup("rag");

  return {
    chunkSize: rag["rag.chunk_size"] as number,
    chunkOverlap: rag["rag.chunk_overlap"] as number,
    embeddingTimeoutMs: rag["rag.embedding_timeout_ms"] as number,
  };
}

/**
 * 装配「文本 LLM 解析」的 options（解析 Prompt + 模型参数）。
 */
export async function loadParseTextOptions(): Promise<ParseTextLLMOptions> {
  const [llm, prompt] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("prompt"),
  ]);

  return {
    prompt: prompt["prompt.parse_text"] as string,
    ...pickLLMParams(llm),
  };
}
