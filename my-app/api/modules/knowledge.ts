/**
 * ============================================
 * 个人知识库模块 API（Knowledge Module）
 * ============================================
 *
 * 【职责】
 * 封装工作台「个人知识库」RAG 相关的 HTTP 请求：
 * - 上传文档（分块 + 向量化 + 入库）→ 普通 JSON，走 axios
 * - 智能问答（检索 + 增强生成）→ SSE 流式，走 fetch
 *
 * 【为什么问答要走 fetch 而不是 axios？】
 * 后端 /api/ai/knowledge/ask 返回 text/event-stream（SSE 流式），
 * axios 会等整个响应结束才返回，无法实时渲染"检索 → 生成"过程。
 * 因此这里用原生 fetch + readSSEStream 逐事件处理。
 *
 * 【baseURL 与 client 保持一致】
 * fetch 不走 axios，需要手动拼接 baseURL，规则与 api/client.ts 完全一致：
 *   开发环境 → http://localhost:4000（直连后端，靠 CORS）
 *   生产环境 → ""（相对路径，由 nginx 反代）
 */

import client, { getToken } from "../client";
import { readSSEStream, type SSEEvent } from "../sse";
import type { ApiResponse, RetrievedChunk, UploadResult } from "../types";

/** 后端 API 基础地址（与 api/client.ts 的 baseURL 逻辑保持一致） */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ============================================================
// API 请求函数
// ============================================================

/**
 * 上传知识库文档（分块 + 向量化 + 入库）。
 *
 * POST /api/ai/knowledge/upload（需 JWT 认证）
 *
 * @param title   - 文档标题
 * @param content - 文档全文（P3 仅支持纯文本）
 * @returns 入库结果（documentId + chunkCount）
 */
export async function uploadKnowledgeApi(
  title: string,
  content: string
): Promise<ApiResponse<UploadResult>> {
  try {
    return await client.post("/api/ai/knowledge/upload", { title, content });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "文档上传失败",
      code: err?.code,
    };
  }
}

/**
 * 知识库问答事件回调的参数结构。
 *
 * 每次收到一个 SSE 事件时调用，携带：
 * - event：事件类型（meta / node / trace / done / error）
 * - data ：事件负载（node 事件里含 chunks 或 answer，done 事件里含完整结果）
 */
export interface KnowledgeAskHandlers {
  /** 检索完成，返回命中的分块（node: retrieve） */
  onRetrieve?: (chunks: RetrievedChunk[]) => void;
  /** 回答生成完成，返回带引用的回答文本（node: generate） */
  onAnswer?: (answer: string) => void;
  /** 整个过程结束（done 事件，含完整 answer + chunks） */
  onDone?: (result: { answer: string; chunks: RetrievedChunk[] }) => void;
  /** 出错（error 事件或网络异常） */
  onError?: (message: string) => void;
  /** 开始执行（meta 事件） */
  onStart?: () => void;
}

/**
 * 知识库智能问答（SSE 流式）。
 *
 * POST /api/ai/knowledge/ask（需 JWT 认证，SSE 返回）
 *
 * 实时回调检索结果和生成回答，实现"先看到检索命中了什么，再看到 AI 回答"。
 *
 * @param question - 用户问题
 * @param handlers - 各阶段回调
 */
export async function askKnowledgeStream(
  question: string,
  handlers: KnowledgeAskHandlers
): Promise<void> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/ai/knowledge/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question }),
    });
  } catch {
    handlers.onError?.("网络异常，请检查网络连接");
    return;
  }

  // 非 200（如 403 无 Key / 400 参数错误）→ 读取 JSON 错误体并回调
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) {
        message = errBody.message;
      }
    } catch {
      // 忽略 JSON 解析失败，保留默认提示
    }
    handlers.onError?.(message);
    return;
  }

  // 逐事件解析并分发
  await readSSEStream(response, (evt: SSEEvent) => {
    dispatchKnowledgeEvent(evt, handlers);
  });
}

/**
 * 把单个 SSE 事件分发到对应回调。
 *
 * 后端事件类型（见 server/src/routes/ai.routes.ts 的 askKnowledge）：
 *   meta   → 开始
 *   node   → retrieve（chunks）/ generate（answer）
 *   trace  → 节点级 trace（P3 前端暂不展示）
 *   done   → 完成（answer + chunks）
 *   error  → 出错
 */
function dispatchKnowledgeEvent(
  evt: SSEEvent,
  handlers: KnowledgeAskHandlers
): void {
  // 先尝试解析 JSON 负载，失败时当作空对象处理
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(evt.data) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  switch (evt.event) {
    case "meta":
      handlers.onStart?.();
      break;

    case "node": {
      const nodeName = payload.nodeName as string | undefined;
      if (nodeName === "retrieve") {
        handlers.onRetrieve?.((payload.chunks as RetrievedChunk[]) ?? []);
      } else if (nodeName === "generate") {
        handlers.onAnswer?.((payload.answer as string) ?? "");
      }
      break;
    }

    case "done": {
      handlers.onDone?.({
        answer: (payload.answer as string) ?? "",
        chunks: (payload.chunks as RetrievedChunk[]) ?? [],
      });
      break;
    }

    case "error":
      handlers.onError?.((payload.message as string) ?? "知识库问答失败");
      break;

    default:
      // trace / 其他事件暂不处理
      break;
  }
}
