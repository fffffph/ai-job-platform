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

// Trace 骨架
export { collectTrace, getTrace, clearTrace } from "./trace/tracer.js";
export type { TraceEvent } from "./trace/tracer.js";

// SSE 流式通道
export { createSSEWriter } from "./stream/sse.js";
export type { SSEWriter, SSEMessage } from "./stream/sse.js";
