/**
 * ============================================
 * 职位发现模块 API（Jobs Module）
 * ============================================
 *
 * 【职责】
 * 封装职位发现 Agent 的 HTTP 请求，走 SSE 流式：
 * - 发起推荐：前端传求职意向（城市/技能/期望薪资）
 * - 实时回调：Agent 的决策过程（搜索/回答）+ 最终推荐文本
 *
 * 【为什么走 SSE？】
 * 职位发现 Agent 是 ReAct 循环（LLM 多次调用工具探索职位库），
 * 耗时较长且过程可观测，用 SSE 实时推送「Agent 正在做什么」，
 * 让用户看到搜索过程而非干等。
 */

import client, { getToken } from "../client";
import { readSSEStream, type SSEEvent } from "../sse";
import type { ApiResponse, JobProfile, TraceEvent } from "../types";

/** 后端 API 基础地址（与 api/client.ts 的 baseURL 逻辑保持一致） */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** 求职意向（用户输入的搜索条件） */
export interface JobIntent {
  /** 期望城市，如 "西安"，可为空 */
  city: string;
  /** 技能栈，如 "React,TypeScript,微前端,Node.js"，可为空 */
  skills: string;
  /** 期望薪资，如 "12k-18k"，可为空 */
  expectedSalary: string;
}

/** 职位推荐 SSE 事件的回调集合 */
export interface JobRecommendHandlers {
  /** 开始执行 */
  onStart?: () => void;
  /** Agent 完成一轮决策（action=call_tools 表示继续搜，answer 表示给出推荐） */
  onAgentAction?: (action: "call_tools" | "answer", message: string) => void;
  /** 工具执行完成（已获取一批职位数据） */
  onToolsDone?: () => void;
  /** 节点级 trace 事件（P6 可观测，供 AI Trace 面板展示决策过程） */
  onTrace?: (events: TraceEvent[]) => void;
  /** 整个过程结束，返回最终推荐文本 */
  onDone?: (answer: string) => void;
  /** 出错 */
  onError?: (message: string) => void;
}

/**
 * 发起职位发现 Agent 推荐（SSE 流式）。
 *
 * POST /api/ai/jobs/recommend（需 JWT 认证，SSE 返回）
 *
 * @param intent   - 求职意向（城市/技能/期望薪资）
 * @param handlers - 各阶段回调
 */
export async function recommendJobsStream(
  intent: JobIntent,
  handlers: JobRecommendHandlers
): Promise<void> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/ai/jobs/recommend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(intent),
    });
  } catch {
    handlers.onError?.("网络异常，请检查网络连接");
    return;
  }

  // 非 200（如 403 无 Key）→ 读取 JSON 错误体
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) {
        message = errBody.message;
      }
    } catch {
      // 忽略解析失败
    }
    handlers.onError?.(message);
    return;
  }

  // 逐事件解析并分发
  await readSSEStream(response, (evt: SSEEvent) => {
    dispatchJobsEvent(evt, handlers);
  });
}

/**
 * 把单个 SSE 事件分发到对应回调。
 *
 * 后端事件类型（见 server/src/routes/ai.routes.ts 的 recommendJobs）：
 *   meta  → 开始
 *   node  → agent（action=call_tools/answer）/ tools
 *   trace → 节点级 trace（P4 前端暂不展示，可后续接入 AI Trace 面板）
 *   done  → 完成（含 answer 推荐文本）
 *   error → 出错
 */
function dispatchJobsEvent(
  evt: SSEEvent,
  handlers: JobRecommendHandlers
): void {
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
      if (nodeName === "agent") {
        const action = payload.action as "call_tools" | "answer" | undefined;
        handlers.onAgentAction?.(
          action ?? "answer",
          (payload.message as string) ?? ""
        );
      } else if (nodeName === "tools") {
        handlers.onToolsDone?.();
      }
      break;
    }

    case "done":
      handlers.onDone?.((payload.answer as string) ?? "");
      break;

    case "trace":
      // 【P6 新增】节点级 trace 事件，供 AI Trace 面板展示决策过程
      handlers.onTrace?.((payload.events as TraceEvent[]) ?? []);
      break;

    case "error":
      handlers.onError?.((payload.message as string) ?? "职位推荐失败");
      break;

    default:
      break;
  }
}

// ============================================================
// 求职画像 API（P5 Memory）
// ============================================================

/**
 * 读取当前用户的求职画像。
 *
 * GET /api/ai/profile（需 JWT 认证）
 *
 * @returns 画像对象；未设置过时为 null
 */
export async function getJobProfileApi(): Promise<
  ApiResponse<JobProfile | null>
> {
  try {
    return await client.get("/api/ai/profile");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取求职画像失败",
      code: err?.code,
    };
  }
}

/**
 * 保存当前用户的求职画像（合并更新）。
 *
 * PUT /api/ai/profile（需 JWT 认证）
 *
 * @param profile - 要保存的画像字段（可只传部分字段）
 */
export async function saveJobProfileApi(
  profile: Partial<JobProfile>
): Promise<ApiResponse<JobProfile>> {
  try {
    return await client.put("/api/ai/profile", profile);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存求职画像失败",
      code: err?.code,
    };
  }
}
