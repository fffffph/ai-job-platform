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
