/**
 * 简历控制器（Resume Controller）
 *
 * POST /api/resume/parse     — 解析简历文件
 * POST /api/resume/optimize  — 首轮 AI 优化
 * POST /api/resume/chat      — 对话式迭代修改
 */

import type { Request, Response, NextFunction } from "express";
import { requireUser } from "../middleware/auth.js";
import { loadUserKeyOrFail } from "../middleware/userKey.js";
import { createSSEWriter } from "../ai/index.js";
import { loadLegacyResumeOptions } from "../config/ai-config.js";
import * as resumeService from "../services/resume.service.js";
import * as deepseekKeyService from "../services/deepseekKey.service.js";

/** 无 Key 时的统一错误提示（与子应用提示文案保持一致） */
const NO_KEY_MESSAGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化";

/**
 * 解析简历文件
 *
 * 常见错误及原因：
 * - "不支持的文件格式"    → 上传了 PDF/DOCX/TXT 以外的文件
 * - "未能从文件中提取到文本内容" → 文件为空或无法解析
 * - "PDF 解析失败"        → PDF 文件损坏或加密
 * - "文件解析失败"        → mammoth/pdf2json 运行时错误
 */
export async function parseResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        success: false,
        message: "请上传简历文件（PDF、DOCX 或 TXT）",
      });
      return;
    }

    console.log(`[resume] 解析文件: ${file.originalname} (${file.mimetype}, ${(file.size / 1024).toFixed(1)}KB)`);

    const result = await resumeService.parseResume(
      file.buffer,
      file.mimetype
    );

    console.log(`[resume] 解析成功: ${result.wordCount} 词`);

    res.status(200).json({
      success: true,
      message: "文件解析成功",
      data: result,
    });
  } catch (error: any) {
    // 返回明确的错误信息，不让 next(error) 吞掉真实原因
    console.error("[resume] 解析失败:", error.message);
    res.status(400).json({
      success: false,
      message: error.message || "文件解析失败",
    });
  }
}

/**
 * 首轮 AI 优化
 */
export async function optimizeResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({
        success: false,
        message: "请提供简历文本内容",
      });
      return;
    }

    // 从当前登录用户配置中读取密钥（按用户隔离）
    const userId = requireUser(req, res);
    if (!userId) return;

    const apiKey = await deepseekKeyService.getDecryptedKey(userId);

    if (!apiKey) {
      res.status(403).json({
        success: false,
        message: NO_KEY_MESSAGE,
        code: "DEEPSEEK_KEY_NOT_CONFIGURED",
      });
      return;
    }

    // 模型参数 / 思考开关由配置中心注入（此前这些值硬编码在 service 里）
    const options = await loadLegacyResumeOptions({
      thinking: req.body?.thinking === true,
    });
    const result = await resumeService.optimizeResume(text, options, apiKey);

    console.log(`[resume] 优化完成: score=${result.score}, tags=${result.tags.length}, suggestions=${result.suggestions.length}`);

    res.status(200).json({
      success: true,
      message: "AI 优化完成",
      data: result,
    });
  } catch (error: any) {
    console.error("[resume] 优化失败:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "AI 优化失败",
    });
  }
}

/**
 * 对话式迭代修改
 */
export async function chatResume(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { resume, message, history, context } = req.body;

    if (!resume || !message) {
      res.status(400).json({
        success: false,
        message: "请提供当前简历文本和修改消息",
      });
      return;
    }

    // 从当前登录用户配置中读取密钥
    const userId = requireUser(req, res);
    if (!userId) return;

    const apiKey = await deepseekKeyService.getDecryptedKey(userId);

    if (!apiKey) {
      res.status(403).json({
        success: false,
        message: "需先在个人中心配置 DeepSeek API Key 才能使用 AI 对话修改",
        code: "DEEPSEEK_KEY_NOT_CONFIGURED",
      });
      return;
    }

    // 同上：模型参数与思考开关由配置中心注入
    const options = await loadLegacyResumeOptions({
      thinking: req.body?.thinking === true,
    });
    const result = await resumeService.chatResume(
      resume,
      message,
      options,
      history,
      context,
      apiKey
    );

    console.log(`[resume] 对话完成: changes=${result.changes.length}`);

    res.status(200).json({
      success: true,
      message: "修改完成",
      data: result,
    });
  } catch (error: any) {
    console.error("[resume] 对话失败:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "对话请求失败",
    });
  }
}

// ============================================================
// 首轮优化（SSE 流式版）
// ============================================================

/**
 * POST /api/resume/optimize-stream（SSE）
 *
 * 与 optimizeResume 输出相同的结果，但把「深度思考过程」逐字实时推给前端，
 * 解决长思考期间界面完全静止的问题（简历优化单次可跑十几秒）。
 *
 * 请求体：{ "text": "简历文本", "thinking"?: true }
 *
 * SSE 事件流：
 *   meta      → 开始执行（含 thinking 标记）
 *   reasoning → 思考过程增量片段（delta=true，前端应追加而非替换）
 *   done      → 完成（data 为 OptimizeResult，与旧接口结构一致）
 *   error     → 出错
 *
 * 【为什么正文不能逐字】
 * 本链路的输出是 JSON（optimized 字段才是简历全文），JSON 必须完整才能解析，
 * 因此正文仍是一次性返回；思考过程是独立的流，可以逐字下发。
 */
export async function streamOptimize(
  req: Request,
  res: Response
): Promise<void> {
  // ---------- 阶段 1：参数 / 登录 / Key 校验（必须在写响应头之前） ----------
  const body = (req.body ?? {}) as { text?: unknown; thinking?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    res.status(400).json({
      success: false,
      message: "请提供简历文本内容",
      code: "INVALID_RESUME_TEXT",
    });
    return;
  }

  // 会话级思考开关：严格等于 true 才算开启（传错值不报 400）
  const requestThinking = body.thinking === true;

  const userId = requireUser(req, res);
  if (!userId) return;

  const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE);
  if (!apiKey) return;

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  try {
    // 思考开关的最终判定（全局熔断 ∩ 会话级）在装配层完成
    const options = await loadLegacyResumeOptions({
      thinking: requestThinking,
    });

    sse.send("meta", {
      type: "start",
      message: "开始优化简历",
      // 前端据此决定是否点亮思考面板（后端判定为准，避免前后端不一致）
      thinking: {
        enabled: options.thinking,
        effort: options.reasoningEffort ?? "high",
      },
    });

    const result = await resumeService.streamOptimizeResume(
      text,
      options,
      apiKey,
      // 思考过程逐字下发：delta=true 表示增量片段，前端追加即可
      (delta) => sse.send("reasoning", { content: delta, delta: true })
    );

    sse.send("done", {
      success: true,
      message: "优化完成",
      data: result,
    });
  } catch (error) {
    const message = (error as Error).message || "优化失败";
    console.error("[resume] 流式优化失败:", message);
    sse.send("error", { success: false, message });
  } finally {
    // 无论成功失败都关闭 SSE 流，避免连接挂起
    sse.close();
  }
}

// ============================================================
// 多轮对话修改（SSE 流式版）
// ============================================================

/**
 * POST /api/resume/chat-stream（SSE）
 *
 * 与 chatResume 输出相同的结果，但把深度思考过程逐字实时推给前端。
 * 每次发送都是一轮独立的思考，前端把思考挂在对应的助手消息上回看。
 *
 * 请求体：{ resume, message, history?, context?, thinking? }
 *
 * SSE 事件流：meta → reasoning（多次，增量）→ done → （异常时 error）
 */
export async function streamChat(
  req: Request,
  res: Response
): Promise<void> {
  // ---------- 阶段 1：参数 / 登录 / Key 校验（必须在写响应头之前） ----------
  const body = (req.body ?? {}) as {
    resume?: unknown;
    message?: unknown;
    history?: unknown;
    context?: unknown;
    thinking?: unknown;
  };

  const resume = typeof body.resume === "string" ? body.resume.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!resume || !message) {
    res.status(400).json({
      success: false,
      message: "请提供当前简历内容与修改要求",
      code: "INVALID_CHAT_INPUT",
    });
    return;
  }

  const requestThinking = body.thinking === true;

  const userId = requireUser(req, res);
  if (!userId) return;

  const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE);
  if (!apiKey) return;

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  try {
    const options = await loadLegacyResumeOptions({
      thinking: requestThinking,
    });

    sse.send("meta", {
      type: "start",
      message: "开始修改简历",
      thinking: {
        enabled: options.thinking,
        effort: options.reasoningEffort ?? "high",
      },
    });

    const history = Array.isArray(body.history)
      ? (body.history as { role: string; content: string }[])
      : undefined;
    const context = body.context as
      | { section: string; originalText: string }
      | undefined;

    const result = await resumeService.streamChatResume(
      resume,
      message,
      options,
      apiKey,
      // 思考过程逐字下发：delta=true 表示增量片段，前端追加即可
      (delta) => sse.send("reasoning", { content: delta, delta: true }),
      history,
      context
    );

    sse.send("done", {
      success: true,
      message: "修改完成",
      data: result,
    });
  } catch (error) {
    const msg = (error as Error).message || "修改失败";
    console.error("[resume] 流式对话失败:", msg);
    sse.send("error", { success: false, message: msg });
  } finally {
    sse.close();
  }
}
