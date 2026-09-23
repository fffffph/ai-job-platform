/**
 * ============================================
 * AI Trace 历史模块 API（Trace History Module）
 * ============================================
 *
 * 【职责】
 * 封装 AI 决策历史的 HTTP 请求（P6 落库后新增）：
 * 1. 列出当前用户最近的 AI 执行记录（轻量，不含事件详情）；
 * 2. 查询单次执行的完整决策过程（含按顺序排列的节点事件）。
 *
 * 【与 SSE 实时 trace 的关系】
 * SSE 的 trace 事件是「本次执行过程中的实时推送」，
 * 而这里的接口读的是「落库后的历史」，两者互补：
 *   - 实时：边跑边看（AITracePanel + trace 事件）
 *   - 历史：跑完随时回看（AITraceHistory + 落库数据）
 */

import client from "../client";
import type {
  ApiResponse,
  TraceRunListItem,
  TraceRunDetail,
} from "../types";

/**
 * 列出当前用户最近的 AI 执行记录（轻量分页）。
 *
 * GET /api/ai/trace/runs（需 JWT 认证）
 *
 * 后端固定返回最近 20 条（listTraceRuns 默认 limit=20），
 * 按创建时间倒序排列，不含事件详情。
 *
 * @returns 历史列表（时间从新到旧）
 */
export async function listTraceRunsApi(): Promise<
  ApiResponse<TraceRunListItem[]>
> {
  try {
    return await client.get("/api/ai/trace/runs");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取 AI 决策历史失败",
      code: err?.code,
    };
  }
}

/**
 * 查询单次 AI 执行的完整决策过程（含节点事件）。
 *
 * GET /api/ai/trace/runs/:id（需 JWT 认证，只能查自己的）
 *
 * @param runId - run ID
 * @returns run 详情（含 events 数组，按 order 升序）
 */
export async function getTraceRunApi(
  runId: string
): Promise<ApiResponse<TraceRunDetail>> {
  try {
    return await client.get(`/api/ai/trace/runs/${runId}`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取 AI 决策详情失败",
      code: err?.code,
    };
  }
}
