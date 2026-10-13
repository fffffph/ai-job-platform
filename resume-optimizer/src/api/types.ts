/**
 * 简历相关 API 类型定义
 */

// ========== 通用 ==========

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
}

export type ApiResponse<T = unknown> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;

// ========== 解析 ==========

export interface ParseResult {
  text: string;
  wordCount: number;
}

// ========== AI 优化 ==========

export interface ResumeTag {
  label: string;
  type: "positive" | "warning" | "negative";
}

export interface ResumeSuggestion {
  category: string;
  original: string;
  suggestion: string;
  improved: string;
}

export interface OptimizeResult {
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  suggestions: ResumeSuggestion[];
  optimized: string;
}

// ========== 对话式修改 ==========

export interface ChangeItem {
  section: string;
  original: string;
  improved: string;
  reason: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * 该条助手消息生成时的深度思考过程。
   *
   * 挂在消息上而不是单独存一份全局状态，是因为多轮对话里每一轮各有自己的
   * 思考链；只有跟着消息走，用户回看历史时才不会张冠李戴。
   * 用户消息与未开启思考的轮次都没有该字段。
   */
  reasoning?: string;
  /** 该轮思考耗时（毫秒），用于展示「已深度思考 N 秒」 */
  reasoningMs?: number;
}

export interface SectionContext {
  section: string;
  originalText: string;
}

export interface ChatResult {
  optimized: string;
  changes: ChangeItem[];
  reply: string;
  conversationId: string;
}

// ========== 请求参数 ==========

export interface OptimizeRequest {
  text: string;
}

export interface ChatRequest {
  resume: string;
  message: string;
  history?: ChatMessage[];
  context?: SectionContext;
}

// ========== DeepSeek API Key 状态 ==========

export interface DeepSeekKeyStatus {
  configured: boolean;
  maskedTail: string;
  updatedAt: string | null;
}

// ========== 岗位匹配度（P2 结构化输出） ==========

/** 匹配度评估结果（来自 POST /api/ai/resume/analyze 带 JD 时） */
export interface MatchResult {
  /** 匹配度评分 0-100 */
  matchScore: number;
  /** 简历已覆盖、与岗位匹配的关键词 */
  matchedKeywords: string[];
  /** 岗位要求但简历缺失的关键词 */
  missingKeywords: string[];
  /** 候选人与岗位的核心差距分析 */
  gapAnalysis: string;
  /** 按优先级排序的改进计划 */
  improvementPlan: Array<{
    action: string;
    priority: "high" | "medium" | "low";
  }>;
}
