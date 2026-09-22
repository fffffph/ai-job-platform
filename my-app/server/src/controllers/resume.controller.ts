/**
 * 简历控制器（Resume Controller）
 *
 * POST /api/resume/parse     — 解析简历文件
 * POST /api/resume/optimize  — 首轮 AI 优化
 * POST /api/resume/chat      — 对话式迭代修改
 */

import type { Request, Response, NextFunction } from "express";
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
    const userId = (req as any).user?.id;
    const apiKey = userId ? await deepseekKeyService.getDecryptedKey(userId) : "";

    if (!apiKey) {
      res.status(403).json({
        success: false,
        message: NO_KEY_MESSAGE,
        code: "DEEPSEEK_KEY_NOT_CONFIGURED",
      });
      return;
    }

    const result = await resumeService.optimizeResume(text, apiKey);

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
    const userId = (req as any).user?.id;
    const apiKey = userId ? await deepseekKeyService.getDecryptedKey(userId) : "";

    if (!apiKey) {
      res.status(403).json({
        success: false,
        message: "需先在个人中心配置 DeepSeek API Key 才能使用 AI 对话修改",
        code: "DEEPSEEK_KEY_NOT_CONFIGURED",
      });
      return;
    }

    const result = await resumeService.chatResume(
      resume,
      message,
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
