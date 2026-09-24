/**
 * 简历 API 模块
 */

import client from "../client";
import { readSSEStream } from "../sse";
import { getToken } from "../../utils/auth";
import type {
  ApiResponse,
  ParseResult,
  OptimizeResult,
  ChatResult,
  ChatMessage,
  SectionContext,
  OptimizeRequest,
  ChatRequest,
  DeepSeekKeyStatus,
} from "../types";

/** 后端 API 基础地址（与 client.ts 的 baseURL 逻辑保持一致） */
const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

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

/** /resume/*-stream 的 meta 事件负载 */
export interface ResumeStreamMeta {
  /** 后端判定的深度思考配置（缺省表示未开启该能力） */
  thinking?: { enabled: boolean; effort: string };
}

/** 首轮优化（SSE 流式版）的事件回调 */
export interface OptimizeStreamHandlers {
  /** 开始执行（含后端判定的思考开关状态） */
  onStart?: (meta: ResumeStreamMeta) => void;
  /** 思考过程的增量片段（逐字到达，调用方必须「追加」而不是替换） */
  onReasoningDelta?: (delta: string) => void;
  /** 完成（结果结构与 JSON 版完全一致） */
  onDone?: (result: OptimizeResult) => void;
  /**
   * 出错。
   *
   * code 用于区分业务错误（如 DEEPSEEK_KEY_NOT_CONFIGURED → 引导去配置），
   * 只有 HTTP 阶段的错误才带得出来（SSE 一旦开始写响应头，状态码就固定为 200）。
   */
  onError?: (message: string, code?: string) => void;
}

/**
 * 首轮 AI 优化（SSE 流式版）。
 *
 * POST /api/resume/optimize-stream
 *
 * 与 optimizeResumeApi 结果相同，但把深度思考过程逐字实时回调，
 * 解决长思考期间界面完全静止的问题。
 *
 * 后端事件流：meta → reasoning（多次，增量）→ done → （异常时 error）
 *
 * @param text     - 简历文本
 * @param handlers - 各阶段回调
 * @param options  - thinking 为会话级开关；signal 用于用户取消
 */
export async function optimizeResumeStream(
  text: string,
  handlers: OptimizeStreamHandlers,
  options?: { thinking?: boolean; signal?: AbortSignal }
): Promise<void> {
  // 显式传布尔值：后端只认 === true，显式 false 语义更清晰也便于抓包
  return postResumeStream<OptimizeResult>(
    "/api/resume/optimize-stream",
    { text, thinking: options?.thinking === true },
    handlers,
    options
  );
}

/** 对话修改（SSE 流式版）的事件回调 */
export interface ChatStreamHandlers {
  /** 开始执行（含后端判定的思考开关状态） */
  onStart?: (meta: ResumeStreamMeta) => void;
  /** 思考过程的增量片段（逐字到达，调用方必须「追加」而不是替换） */
  onReasoningDelta?: (delta: string) => void;
  /** 完成（结果结构与 JSON 版完全一致） */
  onDone?: (result: ChatResult) => void;
  /** 出错（code 用于区分业务错误，如未配置 Key） */
  onError?: (message: string, code?: string) => void;
}

/**
 * 多轮对话修改（SSE 流式版）。
 *
 * POST /api/resume/chat-stream
 *
 * 与 chatResumeApi 结果相同，但把深度思考过程逐字实时回调。
 * 每发送一次就产生一轮独立的思考，调用方应把思考内容与对应的助手消息绑定。
 */
export async function chatResumeStream(
  params: {
    resume: string;
    message: string;
    history?: ChatMessage[];
    context?: SectionContext;
  },
  handlers: ChatStreamHandlers,
  options?: { thinking?: boolean; signal?: AbortSignal }
): Promise<void> {
  return postResumeStream<ChatResult>(
    "/api/resume/chat-stream",
    {
      resume: params.resume,
      message: params.message,
      history: params.history,
      context: params.context,
      thinking: options?.thinking === true,
    },
    handlers,
    options
  );
}

/**
 * 两个 /resume/*-stream 端点的公共实现。
 *
 * 它们的事件协议完全一致（meta → reasoning* → done | error），
 * 差别只有 URL、请求体、以及 done 负载的类型 —— 因此只在这里维护一份
 * 「fetch + 错误处理 + SSE 分发」，避免两处逻辑各自漂移。
 *
 * @param path     - 后端路径（含 /api 前缀）
 * @param body     - 请求体（thinking 由调用方显式给出布尔值）
 * @param handlers - 事件回调
 */
async function postResumeStream<TDone>(
  path: string,
  body: Record<string, unknown>,
  handlers: {
    onStart?: (meta: ResumeStreamMeta) => void;
    onReasoningDelta?: (delta: string) => void;
    onDone?: (result: TDone) => void;
    onError?: (message: string, code?: string) => void;
  },
  options?: { signal?: AbortSignal }
): Promise<void> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (error) {
    // 用户主动取消 → 静默退出，不当作错误提示
    if ((error as Error).name === "AbortError") return;
    handlers.onError?.("网络异常，请检查网络连接");
    return;
  }

  // 非 200（401 未登录 / 403 无 Key / 400 参数错误）→ 读 JSON 错误体
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    let code: string | undefined;
    try {
      const errBody = (await response.json()) as {
        message?: string;
        code?: string;
      };
      if (errBody.message) {
        message = errBody.message;
      }
      code = errBody.code;
    } catch {
      // 忽略解析失败，保留默认提示
    }
    handlers.onError?.(message, code);
    return;
  }

  await readSSEStream(response, (evt) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(evt.data) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (evt.event) {
      case "meta":
        handlers.onStart?.({
          thinking: payload.thinking as ResumeStreamMeta["thinking"],
        });
        break;
      case "reasoning":
        handlers.onReasoningDelta?.((payload.content as string) ?? "");
        break;
      case "done":
        handlers.onDone?.(payload.data as TDone);
        break;
      case "error":
        handlers.onError?.((payload.message as string) ?? "AI 请求失败");
        break;
      default:
        break;
    }
  });
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
