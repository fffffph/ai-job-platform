/**
 * ============================================
 * 用户级 AI Key 读取守卫
 * ============================================
 *
 * 【职责】
 * 读取当前登录用户的 DeepSeek 明文 Key，失败时直接写出响应并返回 null，
 * 调用方只需 `if (!apiKey) return;`。
 *
 * 【为什么单独抽出来】
 * 这条逻辑原本在 ai.routes.ts 里复制了 4 份，现在简历的流式接口也要用，
 * 于是收敛成一份：错误码、文案、日志格式都统一。
 *
 * 【两条错误分支】
 * - 读取过程抛异常     → 500 KEY_READ_FAILED
 * - 用户尚未配置 Key   → 403 DEEPSEEK_KEY_NOT_CONFIGURED（文案按场景传入）
 *
 * ⚠️ 必须在写响应头之前调用。SSE 接口要在 createSSEWriter(res) 之前，
 * 否则错误只能通过 SSE 的 error 事件下发，前端拿不到业务错误码。
 */

import type { Response } from "express";
import { getDecryptedKey } from "../services/deepseekKey.service.js";

export async function loadUserKeyOrFail(
  userId: string,
  res: Response,
  noKeyMessage: string
): Promise<string | null> {
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
    return null;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      message: noKeyMessage,
      code: "DEEPSEEK_KEY_NOT_CONFIGURED",
    });
    return null;
  }

  return apiKey;
}
