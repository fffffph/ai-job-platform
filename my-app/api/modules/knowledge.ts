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
import type {
  ApiResponse,
  RetrievedChunk,
  UploadResult,
  TraceEvent,
  KnowledgeDocument,
  ImportResult,
  KnowledgeEntry,
} from "../types";

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

// ============================================================
// 文件下载（模板 / 上次文件）与 Excel 导入
// ============================================================

/** 下载结果 */
export interface DownloadResult {
  ok: boolean;
  message?: string;
}

/**
 * 用 fetch 下载后端文件并触发浏览器保存。
 * 从 Content-Disposition 的 filename*（UTF-8 编码）解析真实文件名，兜底用 fallbackName。
 */
async function downloadBlob(
  url: string,
  fallbackName: string
): Promise<DownloadResult> {
  const token = getToken();
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `下载失败 (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // 忽略非 JSON 响应
      }
      return { ok: false, message };
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const nameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = nameMatch ? decodeURIComponent(nameMatch[1]) : fallbackName;

    // 触发浏览器下载
    const anchor = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { ok: true };
  } catch {
    return { ok: false, message: "网络异常，下载失败" };
  }
}

/**
 * 下载知识库导入模板（首次使用时引导用户下载）。
 */
export async function downloadKnowledgeTemplate(): Promise<DownloadResult> {
  return downloadBlob(
    `${API_BASE}/api/ai/knowledge/template`,
    "knowledge-template.xlsx"
  );
}

/**
 * 下载上次上传的原始文件（文件真相源，供继续编辑）。
 */
export async function downloadKnowledgeFile(): Promise<DownloadResult> {
  return downloadBlob(`${API_BASE}/api/ai/knowledge/file`, "knowledge.xlsx");
}

/** 文件元信息（前端据此判断显示「模板引导」还是「文件卡片」） */
export interface KnowledgeFileInfoResult {
  /** 是否上传过文件 */
  hasFile: boolean;
  /** 原始文件名（有文件时返回） */
  filename?: string;
  /** 上次上传时间 ISO 字符串（有文件时返回） */
  updatedAt?: string;
}

/**
 * 查询用户上传文件的元信息（轻量，不含文件字节）。
 */
export async function getKnowledgeFileInfoApi(): Promise<
  ApiResponse<KnowledgeFileInfoResult>
> {
  try {
    return await client.get("/api/ai/knowledge/file-info");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "查询文件信息失败",
      code: err?.code,
    };
  }
}

/**
 * 删除保存的原始文件记录（只删文件真相源，不动已入库的知识）。
 */
export async function deleteKnowledgeFileApi(): Promise<ApiResponse<null>> {
  try {
    return await client.delete("/api/ai/knowledge/file");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "删除失败",
      code: err?.code,
    };
  }
}

/**
 * 上传 Excel 文件批量导入知识库（multipart）。
 *
 * POST /api/ai/knowledge/import（需 JWT 认证）
 *
 * @param file - 用户选择的 .xlsx 文件
 * @param mode - replace（同步替换，默认）/ append（追加合并）
 * @returns 导入结果（documentCount + failed 行号汇总）
 */
export async function importKnowledgeFromFile(
  file: File,
  mode: "replace" | "append"
): Promise<ApiResponse<ImportResult>> {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", mode);

  try {
    // 注意：multipart 不能手动设置 Content-Type，浏览器会自动带 boundary
    const res = await fetch(`${API_BASE}/api/ai/knowledge/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    return (await res.json()) as ApiResponse<ImportResult>;
  } catch {
    return { success: false, message: "网络异常，导入失败" };
  }
}

// ============================================================
// 我的知识列表 / 删除
// ============================================================

/**
 * 列出当前用户的所有知识库文档（我的知识列表）。
 */
export async function listKnowledgeDocuments(): Promise<
  ApiResponse<KnowledgeDocument[]>
> {
  try {
    return await client.get("/api/ai/knowledge/documents");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "查询知识库失败",
      code: err?.code,
    };
  }
}

/**
 * 删除单条知识文档。
 */
export async function deleteKnowledgeDocument(
  id: string
): Promise<ApiResponse<null>> {
  try {
    return await client.delete(`/api/ai/knowledge/documents/${id}`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "删除失败",
      code: err?.code,
    };
  }
}

/** 文本解析结果 */
export interface ParseTextResult {
  /** 解析出的条目列表 */
  entries: KnowledgeEntry[];
  /** 是否建议开启 AI 智能解析（规则解析未命中时） */
  needLLM: boolean;
}

/**
 * 文本解析成知识条目（规则解析 + 可选 LLM 兜底）。
 *
 * POST /api/ai/knowledge/parse-text
 *
 * @param text   - 用户粘贴的文本
 * @param useLLM - 规则解析无结果时是否用 LLM 兜底解析
 */
export async function parseTextToEntriesApi(
  text: string,
  useLLM: boolean
): Promise<ApiResponse<ParseTextResult>> {
  try {
    return await client.post("/api/ai/knowledge/parse-text", { text, useLLM });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "解析失败，请稍后重试",
      code: err?.code,
    };
  }
}

/**
 * JSON 数组批量入库（文本解析确认后调用）。
 *
 * POST /api/ai/knowledge/batch
 */
export async function batchImportEntries(
  entries: KnowledgeEntry[],
  mode: "replace" | "append"
): Promise<ApiResponse<{ documentCount: number; chunkCount: number }>> {
  try {
    return await client.post("/api/ai/knowledge/batch", { entries, mode });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "入库失败，请稍后重试",
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
  /** 节点级 trace 事件（P6 可观测，供 AI Trace 面板展示检索/生成过程） */
  onTrace?: (events: TraceEvent[]) => void;
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

    case "trace":
      // 【P6 新增】节点级 trace 事件，供 AI Trace 面板展示检索/生成过程
      handlers.onTrace?.((payload.events as TraceEvent[]) ?? []);
      break;

    default:
      // 其他事件暂不处理
      break;
  }
}
