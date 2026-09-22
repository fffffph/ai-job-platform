/**
 * 简历 API 模块
 */

import client from "../client";
import type {
  ApiResponse,
  ParseResult,
  OptimizeResult,
  ChatResult,
  OptimizeRequest,
  ChatRequest,
  DeepSeekKeyStatus,
} from "../types";

/** 解析简历文件 */
export async function parseResumeApi(
  file: File
): Promise<ApiResponse<ParseResult>> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    return await client.post("/api/resume/parse", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "文件解析失败",
      code: error?.code,
    };
  }
}

/** 首轮 AI 优化 */
export async function optimizeResumeApi(
  params: OptimizeRequest
): Promise<ApiResponse<OptimizeResult>> {
  try {
    return await client.post("/api/resume/optimize", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "AI 优化失败",
      code: error?.code,
    };
  }
}

/** 对话式迭代修改 */
export async function chatResumeApi(
  params: ChatRequest
): Promise<ApiResponse<ChatResult>> {
  try {
    return await client.post("/api/resume/chat", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "对话请求失败",
      code: error?.code,
    };
  }
}

/** 获取当前用户 DeepSeek API Key 状态（用于入口拦截） */
export async function getDeepSeekKeyStatusApi(): Promise<
  ApiResponse<DeepSeekKeyStatus>
> {
  try {
    return await client.get("/api/user/deepseek-key");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取 API Key 状态失败",
      code: error?.code,
    };
  }
}
