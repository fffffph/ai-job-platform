/**
 * ============================================
 * AI 模块统一出口（AI Index）
 * ============================================
 *
 * 【职责】
 * 对外暴露 P1 AI 基建的全部能力，其它模块（路由等）统一从这里导入：
 * - createDeepSeekChat  ：DeepSeek 模型适配工厂
 * - buildResumeGraph     ：简历分析图构建器
 * - collectTrace 等      ：trace 收集 API
 * - createSSEWriter 等   ：SSE 流式通道封装
 * P2 新增：结构化输出 schema、分层 prompt、结构化节点。
 * P3 新增：Embedding 适配、RAG 离线写入/在线查询、RAG 问答图。
 *
 * 【约定】
 * 业务侧不直接 import 深层路径（如 ../ai/llm/deepseek.js），
 * 统一走 ../ai/index.js，降低耦合、方便后续按需替换实现。
 */

// DeepSeek 适配层
export { createDeepSeekChat } from "./llm/deepseek.js";

// 简历分析图
export { buildResumeGraph } from "./graphs/resume/graph.js";
export type { ResumeState } from "./graphs/resume/state.js";

// 简历分析图节点（结构化）
export {
  parseNode,
  createAnalyzeNode,
  createMatchNode,
  suggestNode,
} from "./graphs/resume/nodes.js";

// 结构化输出 Schema
export { ResumeAnalysisSchema } from "./prompts/schemas/resume-analysis.js";
export type { ResumeAnalysis } from "./prompts/schemas/resume-analysis.js";
export { MatchResultSchema } from "./prompts/schemas/match-result.js";
export type { MatchResult } from "./prompts/schemas/match-result.js";

// 分层 Prompt
export { RESUME_EXPERT_SYSTEM_PROMPT } from "./prompts/system/resume-expert.js";
export {
  ANALYZE_TASK_PROMPT,
  buildAnalyzeMessage,
} from "./prompts/tasks/resume/analyze.js";
export {
  MATCH_TASK_PROMPT,
  buildMatchMessage,
} from "./prompts/tasks/resume/match.js";

// Trace 骨架
export { collectTrace, getTrace, clearTrace } from "./trace/tracer.js";
export type { TraceEvent } from "./trace/tracer.js";

// SSE 流式通道
export { createSSEWriter } from "./stream/sse.js";
export type { SSEWriter, SSEMessage } from "./stream/sse.js";

// 【P3 新增】Embedding 适配层（SiliconFlow / bge-m3）
export { embedText, embedTexts } from "./llm/embedding.js";

// 【P3 新增】RAG 离线写入（分块 + 向量化 + 入库）
export { chunkText, CHUNK_SIZE, CHUNK_OVERLAP } from "./rag/ingestion/chunker.js";
export { ingestDocument } from "./rag/ingestion/indexer.js";
export type { IngestResult } from "./rag/ingestion/indexer.js";

// 【P3 新增】RAG 在线查询（向量检索）
export { retrieveChunks, DEFAULT_TOP_K } from "./rag/retrieval/retriever.js";
export type { RetrievedChunk } from "./rag/retrieval/retriever.js";

// 【P3 新增】RAG 问答图
export { buildRagGraph } from "./graphs/rag/graph.js";
export type { RAGState } from "./graphs/rag/state.js";

// 【P4 新增】职位发现 ReAct 图
export { buildJobsGraph } from "./graphs/jobs/graph.js";
export type { JobsState } from "./graphs/jobs/state.js";

// 【P4 新增】职位搜索工具（Function Calling）
export { searchJobsTool } from "./tools/function-calling/search-jobs.js";
export { searchJobs, MOCK_JOBS } from "./tools/function-calling/job-data.js";
export type { JobPosting } from "./tools/function-calling/job-data.js";

// 【P4 新增】职位发现 Agent 系统 Prompt
export { JOB_AGENT_SYSTEM_PROMPT } from "./prompts/system/job-agent.js";

// 【P4 新增】职位推荐结构化输出 Schema（finalize 节点）
export {
  JobRecommendationSchema,
  JobRecommendationItemSchema,
} from "./prompts/schemas/job-recommendation.js";
export type {
  JobRecommendation,
  JobRecommendationItem,
} from "./prompts/schemas/job-recommendation.js";

// 【P5 新增】用户求职画像（Memory 层：结构化记忆）
export { getJobProfile, saveJobProfile } from "./memory/profile.js";
export type { JobProfile } from "./memory/profile.js";
