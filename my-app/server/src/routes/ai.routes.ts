/**
 * ============================================
 * AI 路由（AI Routes）
 * ============================================
 *
 * 【职责】
 * 暴露 AI 相关的 HTTP 接口。
 *
 * P1 接口：
 * - POST /api/ai/resume/analyze — AI 流式分析简历（需认证，SSE 返回）
 *
 * 【认证】
 * 使用 authMiddleware 保护，只有登录用户才能调用。
 *
 * 【Key 机制】
 * 通过 getDecryptedKey(userId) 按用户隔离读取明文 Key，
 * 无 Key 时返回 403，提示用户先在个人中心配置。
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import type { AIMessageChunk } from "@langchain/core/messages";
import { authMiddleware } from "../middleware/auth.js";
import { getDecryptedKey } from "../services/deepseekKey.service.js";
import {
  buildResumeGraph,
  createSSEWriter,
  getTrace,
  clearTrace,
} from "../ai/index.js";
import type { ResumeState } from "../ai/index.js";

/** 路由实例 */
const aiRouter: IRouter = Router();

/** 无 Key 时的统一错误提示（与现有 resume 模块文案保持一致） */
const NO_KEY_MESSAGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历分析";

/** 节点名称 → 中文提示的映射，用于 SSE 的 node 事件 */
const NODE_LABELS: Record<string, string> = {
  parse: "简历解析完成",
  analyze: "AI 分析完成",
};

/**
 * POST /api/ai/resume/analyze
 *
 * 流式分析简历，通过 SSE 逐 token 返回分析结果。
 *
 * 请求体：{ "text": "简历文本" }
 * 响应：  text/event-stream，事件类型包括：
 *   - meta   ：开始执行
 *   - node   ：节点完成
 *   - token  ：逐 token 的分析文本
 *   - trace  ：节点级 trace 事件（供 AI Trace 面板）
 *   - done   ：分析完成（含完整 analysis）
 *   - error  ：出错
 */
aiRouter.post("/resume/analyze", authMiddleware, analyzeResume);

/**
 * 简历流式分析处理器。
 *
 * 注意：本处理器分成两个阶段——
 * 1. 校验阶段（尚未写响应头）：参数校验、Key 校验失败时直接返回 JSON 错误；
 * 2. 流式阶段（已写响应头）：错误只能通过 SSE 的 error 事件告知客户端。
 */
async function analyzeResume(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：参数校验 ----------
  const body = (req.body ?? {}) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    res.status(400).json({
      success: false,
      message: "请提供简历文本内容",
      code: "INVALID_RESUME_TEXT",
    });
    return;
  }

  // ---------- 阶段 1：读取当前用户 ----------
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // ---------- 阶段 1：读取用户级 Key ----------
  let apiKey = "";
  try {
    apiKey = await getDecryptedKey(userId);
  } catch (error) {
    console.error("[AI] 读取 API Key 失败:", (error as Error).message);
    res.status(500).json({
      success: false,
      message: "读取 API Key 失败，请稍后重试",
      code: "KEY_READ_FAILED",
    });
    return;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      message: NO_KEY_MESSAGE,
      code: "DEEPSEEK_KEY_NOT_CONFIGURED",
    });
    return;
  }

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  // P1 的 trace 是全局内存单例，开始前清空，避免混入上一轮残留
  clearTrace();

  try {
    // 根据当前用户 Key 构建图（按请求构建，保证 Key 隔离）
    const graph = buildResumeGraph(apiKey);

    const initialState: ResumeState = {
      resumeText: text,
      analysis: "",
      messages: [],
    };

    // 通知客户端开始执行
    sse.send("meta", { type: "start", message: "开始分析简历" });

    // 流式执行：messages（token 级） + updates（节点级）双模式
    const stream = await graph.stream(initialState, {
      streamMode: ["messages", "updates"] as const,
    });

    // 记录最终完整分析结果（从 updates 的 analyze 节点输出中取）
    let finalAnalysis = "";

    for await (const chunk of stream) {
      // 多模式流式下，每个 chunk 是 [mode, payload] 二元组
      const [mode, payload] = chunk as unknown as [string, unknown];

      if (mode === "messages") {
        // messages 模式：payload = [AIMessageChunk, metadata]
        const [messageChunk] = payload as [AIMessageChunk, unknown];
        const content = messageChunk.content;
        const token = typeof content === "string" ? content : "";

        if (token) {
          sse.send("token", { token });
        }
      } else if (mode === "updates") {
        // updates 模式：payload = { [nodeName]: partialUpdate }
        const updates = payload as Record<string, Partial<ResumeState>>;

        for (const [nodeName, update] of Object.entries(updates)) {
          sse.send("node", {
            nodeName,
            done: true,
            message: NODE_LABELS[nodeName] ?? `节点 ${nodeName} 完成`,
          });

          if (nodeName === "analyze" && typeof update.analysis === "string") {
            finalAnalysis = update.analysis;
          }
        }
      }
    }

    // 附带节点级 trace 事件 + 完成事件（含完整分析结果）
    sse.send("trace", { events: getTrace() });
    sse.send("done", {
      success: true,
      message: "分析完成",
      analysis: finalAnalysis,
    });
  } catch (error) {
    const message = (error as Error).message || "AI 分析失败";
    console.error("[AI] 简历分析失败:", message);
    sse.send("error", { success: false, message });
  } finally {
    // 无论成功失败都关闭 SSE 流，避免连接挂起
    sse.close();
  }
}

export default aiRouter;
