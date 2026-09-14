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
 *  P2 接口：
 * - POST /api/ai/resume/analyze — AI 结构化分析简历（需认证，SSE 返回）
 *   请求体新增可选字段 jobDescription，用于岗位匹配度评估。
 *
 * 【SSE 事件流（P2）】
 *   meta     → 开始执行（含 hasJobDescription 标记）
 *   progress → 提示当前阶段（正在分析 / 正在匹配）
 *   node     → 节点完成，携带该节点的结构化结果
 *   trace    → 节点级 trace 事件（供 AI Trace 面板）
 *   done     → 完成（含 analysis / match / suggestions）
 *   error    → 出错
 *   （P2 去掉了纯文本 token 逐字流，结构化输出改为节点完成时推送）
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
import { authMiddleware } from "../middleware/auth.js";
import { getDecryptedKey } from "../services/deepseekKey.service.js";
import {
  buildResumeGraph,
  createSSEWriter,
  getTrace,
  clearTrace,
} from "../ai/index.js";
import type {
  ResumeState,
  ResumeAnalysis,
  MatchResult,
} from "../ai/index.js";

/** 路由实例 */
const aiRouter: IRouter = Router();

/** 无 Key 时的统一错误提示（与现有 resume 模块文案保持一致） */
const NO_KEY_MESSAGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历分析";

/** 节点名称 → 中文提示的映射，用于 SSE 的 node 事件 */
const NODE_LABELS: Record<string, string> = {
  parse: "简历解析完成",
  analyze: "AI 结构化分析完成",
  match_assess: "岗位匹配度评估完成",
  suggest: "改进建议汇总完成",
};

/**
 * POST /api/ai/resume/analyze
 *
 * 结构化分析简历（可携带 JD 做匹配度评估），通过 SSE 返回。
 *
 * 请求体：{ "text": "简历文本", "jobDescription": "可选岗位描述" }
 */
aiRouter.post("/resume/analyze", authMiddleware, analyzeResume);

/**
 * 简历结构化分析处理器。
 *
 * 分成两个阶段：
 * 1. 校验阶段（尚未写响应头）：参数 / 登录 / Key 校验失败时直接返回 JSON 错误；
 * 2. 流式阶段（已写响应头）：错误只能通过 SSE 的 error 事件告知客户端。
 */
async function analyzeResume(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：参数校验 ----------
  const body = (req.body ?? {}) as {
    text?: unknown;
    jobDescription?: unknown;
  };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const jobDescription =
    typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";

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
      jobDescription,
      analysis: null,
      match: null,
      suggestions: [],
      messages: [],
    };

    // 通知客户端开始执行 + 当前阶段提示
    sse.send("meta", {
      type: "start",
      message: "开始分析简历",
      hasJobDescription: Boolean(jobDescription),
    });
    sse.send("progress", {
      stage: "analyze",
      message: jobDescription
        ? "正在分析简历并评估岗位匹配度…"
        : "正在分析简历…",
    });

    // 结构化输出为非流式，只用 updates 模式取节点完成时的结构化结果
    const stream = await graph.stream(initialState, {
      streamMode: "updates",
    });

    // 记录最终完整结果（从各节点 update 中取）
    let finalAnalysis: ResumeAnalysis | null = null;
    let finalMatch: MatchResult | null = null;
    let finalSuggestions: string[] = [];

    for await (const updates of stream) {
      const updateMap = updates as Record<string, Partial<ResumeState>>;

      for (const [nodeName, update] of Object.entries(updateMap)) {
        // 组装 node 事件，携带该节点的结构化结果
        const nodeData: Record<string, unknown> = {
          nodeName,
          done: true,
          message: NODE_LABELS[nodeName] ?? `节点 ${nodeName} 完成`,
        };

        if (nodeName === "analyze") {
          nodeData.analysis = update.analysis ?? null;
          finalAnalysis = update.analysis ?? null;
        } else if (nodeName === "match_assess") {
          nodeData.match = update.match ?? null;
          finalMatch = update.match ?? null;
        } else if (nodeName === "suggest") {
          nodeData.suggestions = update.suggestions ?? [];
          finalSuggestions = update.suggestions ?? [];
        }

        sse.send("node", nodeData);
      }
    }

    // 附带节点级 trace 事件 + 完成事件（含完整结构化结果）
    sse.send("trace", { events: getTrace() });
    sse.send("done", {
      success: true,
      message: "分析完成",
      analysis: finalAnalysis,
      match: finalMatch,
      suggestions: finalSuggestions,
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
