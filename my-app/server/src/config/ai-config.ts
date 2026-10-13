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
import type { DeepSeekReasoningEffort } from "../ai/llm/deepseek.js";
import type { ResumeGraphOptions } from "../ai/graphs/resume/graph.js";
import type { RagGraphOptions } from "../ai/graphs/rag/graph.js";
import type { JobsGraphOptions } from "../ai/graphs/jobs/graph.js";
import type { IngestOptions } from "../ai/rag/ingestion/indexer.js";
import type { ParseTextLLMOptions } from "../ai/rag/text-parser.js";
import type { ResumeLlmOptions } from "../services/resume.service.js";
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

/**
 * 简历分析当前是否支持深度思考 —— 固定 false。
 *
 * 【为什么不行】
 * analyze 与 match 两个节点都走 withStructuredOutput(functionCalling)，
 * 该方式靠强制 tool_choice 保证结构化输出，而 DeepSeek 思考模式不支持
 * tool_choice，同时开启会返回：
 *   400 Thinking mode does not support this tool_choice
 *
 * 装配层是思考开关的唯一决策点，把这条约束收敛在这里；
 * 将来若把结构化输出换成 JSON Schema / jsonMode，改本行即可放开。
 */
const RESUME_THINKING_SUPPORTED = false;

/**
 * 开启深度思考时，单次模型调用的超时下限（毫秒）。
 *
 * 思考模式下模型要先推理再作答，耗时常达十几秒到一分钟以上，
 * 若沿用 llm.timeout_ms 的 60s 默认值，容易被超时打断且报错难以归因。
 * 这里只设「下限」：管理员把 timeout_ms 调得更大时以管理员为准。
 * （是否抬升由 withThinkingTimeout 按本次是否思考决定）
 */
const THINKING_TIMEOUT_FLOOR_MS = 180_000;

/**
 * 开启深度思考时，单次调用的输出长度下限（token）。
 *
 * ⚠️ 这是踩过坑的：思考 token **也计入 max_tokens**。用默认的 4096 时，
 * 模型把 4000 左右 token 全花在推理上，正文一个字都吐不出来（实测日志：
 * `content=0chars reasoning=7978chars`），整次优化静默退化成"原文"。
 * 因此开启思考时必须抬到模型上限（deepseek-chat 为 8192），
 * 给推理 + 正文各留出空间。只设「下限」：管理员配得更大时以管理员为准。
 */
const THINKING_MAX_TOKENS_FLOOR = 8192;

/**
 * 从分组映射读取思考强度档位（缺省 high）。
 *
 * 适用于「输出很短」的链路：知识库问答、职位推荐 —— 正文只占几百 token，
 * 推理再长也基本放得下。
 */
function pickReasoningEffort(llm: Record<string, unknown>): DeepSeekReasoningEffort {
  return (llm["llm.reasoning_effort"] as DeepSeekReasoningEffort) ?? "high";
}

/**
 * 简历优化（legacy 链路）的思考强度，与全局档位分开配置，默认 low。
 *
 * 【为什么必须单独一条配置】
 * 该链路的输出是一整份 JSON（score + tags + highlights + suggestions +
 * 完整优化后简历，约 3500 token），而 DeepSeek 的**推理 token 与正文共享
 * 同一个 max_tokens 上限**（deepseek-chat 为 8192）。实测 high 档：
 * 推理独占 13298 字符（≈8000 token），正文写到一半即被截断，JSON 直接非法。
 * low 档把大半预算让给正文，思考过程依然可见。
 *
 * 不直接改全局 llm.reasoning_effort：那会连带把知识库问答/职位推荐的
 * 思考深度一起降下来，属于误伤。
 */
function pickResumeReasoningEffort(
  llm: Record<string, unknown>
): DeepSeekReasoningEffort {
  return (
    (llm["llm.resume_reasoning_effort"] as DeepSeekReasoningEffort) ?? "low"
  );
}

/**
 * 判定本次请求是否真正进入深度思考模式。
 *
 * 规则：全局熔断开关（switch.deep_thinking）必须为真，且请求方显式传了
 * thinking=true——两者缺一不可。管理员关掉全局开关后，会话级无法绕过。
 *
 * 注意返回 false 时下游会**显式**下发 thinking=false（而不是不传）：
 * DeepSeek 服务端默认是开启思考的，不显式关掉就省不下时间与费用。
 */
function resolveThinking(
  globalEnabled: unknown,
  requestThinking?: boolean
): boolean {
  return globalEnabled === true && requestThinking === true;
}

/**
 * 开启思考时给超时兜一个下限。
 *
 * 思考模式下单次调用常达十几秒到一分钟以上，沿用默认 60s 容易被超时打断，
 * 且报错原因难以归因。只设下限：管理员把 timeout_ms 调得更大时以管理员为准。
 */
function withThinkingTimeout(timeout: number, thinkingEnabled: boolean): number {
  return thinkingEnabled
    ? Math.max(timeout, THINKING_TIMEOUT_FLOOR_MS)
    : timeout;
}

// ============================================================
// 各图配置装配函数
// ============================================================

/**
 * 装配「简历分析图」的 options（模型参数 + 三个 Prompt）。
 */
export async function loadResumeGraphOptions(params?: {
  thinking?: boolean;
}): Promise<ResumeGraphOptions> {
  const [llm, prompt, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("prompt"),
    getConfigGroup("switch"),
  ]);

  const llmParams = pickLLMParams(llm);

  // 会话级 + 全局的判定照常做（保留意图，便于将来放开），
  // 但会被下面的硬约束覆盖
  const requested = resolveThinking(sw["switch.deep_thinking"], params?.thinking);
  const thinkingEnabled = requested && RESUME_THINKING_SUPPORTED;

  return {
    ...llmParams,
    thinking: thinkingEnabled,
    reasoningEffort: thinkingEnabled ? pickReasoningEffort(llm) : undefined,
    timeout: withThinkingTimeout(llmParams.timeout, thinkingEnabled),
    resumeExpertPrompt: prompt["prompt.resume_expert"] as string,
    analyzeTaskPrompt: prompt["prompt.analyze_task"] as string,
    matchTaskPrompt: prompt["prompt.match_task"] as string,
  };
}

/**
 * 装配「RAG 问答图」的 options（模型参数 + 检索参数 + 回答 Prompt + 思考开关）。
 *
 * @param params.thinking - 会话级开关（来自请求体 thinking 字段）。
 *   只有显式传 true 才可能开启；未传 / 传 false / 传非法值一律视为不开启。
 *
 * 【深度思考的两层控制】
 * 1. 全局熔断：配置项 switch.deep_thinking，管理员关掉后任何请求都开不了
 *    （防成本失控，会话级无法绕过）；
 * 2. 会话级：用户这次提问有没有勾选「深度思考」。
 *
 * 两层都满足才真正进入思考模式。注意这里是「显式下发 thinking 的布尔值」，
 * 而不是「不传」，因为 DeepSeek 服务端默认是开启思考的——不显式关掉，
 * 用户以为省下了思考的时间与费用，实际上并没有。
 */
export async function loadRagGraphOptions(params?: {
  thinking?: boolean;
}): Promise<RagGraphOptions> {
  const [llm, rag, prompt, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("rag"),
    getConfigGroup("prompt"),
    getConfigGroup("switch"),
  ]);

  const llmParams = pickLLMParams(llm);
  const thinkingEnabled = resolveThinking(
    sw["switch.deep_thinking"],
    params?.thinking
  );

  return {
    ...llmParams,
    // 该链路是「单轮 + 无 tools」，因此可以安全开启思考：
    // 既没有 ReAct 多轮必须回传 reasoning_content 的要求（否则 400），
    // 也没有多轮上下文累积成本。
    thinking: thinkingEnabled,
    reasoningEffort: thinkingEnabled ? pickReasoningEffort(llm) : undefined,
    timeout: withThinkingTimeout(llmParams.timeout, thinkingEnabled),
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
export async function loadJobsGraphOptions(params?: {
  thinking?: boolean;
}): Promise<{
  graph: JobsGraphOptions;
  jobAgentPrompt: string;
}> {
  const [llm, jobs, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("jobs"),
    getConfigGroup("switch"),
  ]);

  const llmParams = pickLLMParams(llm);
  const thinkingEnabled = resolveThinking(
    sw["switch.deep_thinking"],
    params?.thinking
  );

  // 用配置的「关键词个数 / 候选职位区间」模板化生成 Agent 人设 Prompt
  const jobAgentPrompt = buildJobAgentPrompt({
    skillKeywordsMin: jobs["jobs.skill_keywords_min"] as number,
    skillKeywordsMax: jobs["jobs.skill_keywords_max"] as number,
    candidateMin: jobs["jobs.candidate_min"] as number,
    candidateMax: jobs["jobs.candidate_max"] as number,
  });

  return {
    graph: {
      ...llmParams,
      // 该链路是「ReAct 多轮 + tools」，也是 DeepSeek「必须回传
      // reasoning_content，否则 400」这条约束唯一可能命中的场景。
      // 实测开启思考连跑 3 轮未报 400（详见 llm/deepseek.ts 的已知风险小节）；
      // 若将来真出现 400，关掉 switch.deep_thinking 即可立即恢复。
      thinking: thinkingEnabled,
      reasoningEffort: thinkingEnabled ? pickReasoningEffort(llm) : undefined,
      timeout: withThinkingTimeout(llmParams.timeout, thinkingEnabled),
      maxRecommend: jobs["jobs.max_recommend"] as number,
      greetingMaxLen: jobs["jobs.greeting_max_len"] as number,
      useMockJobs: sw["switch.mock_jobs"] as boolean,
    },
    jobAgentPrompt,
  };
}

/**
 * 装配「简历优化（legacy 链路）」的 options。
 *
 * 这条链路走 resume.service.ts 的裸 fetch（不经 LangGraph），历史上把
 * 模型名/温度/token/超时全部写死，导致配置中心管不到它——本函数把它接入。
 *
 * 【为什么这条链路可以开思考】
 * 它的「结构化输出」是靠在 Prompt 里要求模型返回 JSON + 手工 JSON.parse 实现的，
 * **没有使用 functionCalling 的强制 tool_choice**，因此不受「思考模式不支持
 * tool_choice」这条限制（对比 RESUME_THINKING_SUPPORTED 的 LangGraph 链路）。
 */
export async function loadLegacyResumeOptions(params?: {
  thinking?: boolean;
}): Promise<ResumeLlmOptions> {
  const [llm, sw] = await Promise.all([
    getConfigGroup("llm"),
    getConfigGroup("switch"),
  ]);

  const llmParams = pickLLMParams(llm);
  const thinkingEnabled = resolveThinking(
    sw["switch.deep_thinking"],
    params?.thinking
  );

  return {
    ...llmParams,
    thinking: thinkingEnabled,
    // 用简历链路专属档位（默认 low），避免推理挤掉正文的输出长度
    reasoningEffort: thinkingEnabled
      ? pickResumeReasoningEffort(llm)
      : undefined,
    timeout: withThinkingTimeout(llmParams.timeout, thinkingEnabled),
    // 思考 token 计入 max_tokens，必须抬到上限，否则正文会被挤成空串
    maxTokens: thinkingEnabled
      ? Math.max(llmParams.maxTokens, THINKING_MAX_TOKENS_FLOOR)
      : llmParams.maxTokens,
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

  const llmParams = pickLLMParams(llm);

  return {
    prompt: prompt["prompt.parse_text"] as string,
    ...llmParams,
    // 文本解析是纯工具型任务（把粘贴文本整理成结构化条目），
    // 「思考过程」对用户没有价值，且会让本已较慢的兜底解析更慢。
    // 这里显式关闭：既省 token，也避免服务端默认开启思考带来的隐性开销。
    thinking: false,
  };
}
