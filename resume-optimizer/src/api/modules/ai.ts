/**
 * ============================================
 * 简历 AI 分析 API 模块（P2 结构化输出）
 * ============================================
 *
 * 【职责】
 * 封装调用后端「岗位匹配度评估」接口的能力。
 *
 * 【为什么单独建 ai.ts 而不是塞进 resume.ts？】
 * resume.ts 里的 optimize/chat 走的是旧版单次 Prompt 接口（axios），
 * 而本模块的 analyze 走的是新版 LangGraph 结构化接口（SSE 流式），
 * 两者实现方式不同（axios vs fetch），职责也应分离。
 *
 * 【匹配度是"增强能力"，失败不阻断主流程】
 * 简历优化本身仍由 optimize 接口完成（产出优化后的简历全文），
 * 匹配度评估是额外增值。因此本模块的 analyzeResumeMatch 在失败时
 * 静默返回 null，由调用方决定是否展示匹配度卡片，绝不影响核心流程。
 */

import { getToken } from "../../utils/auth";
import { readSSEStream } from "../sse";
import type { MatchResult } from "../types";

/** 后端 API 基础地址（与 client.ts 的 baseURL 逻辑保持一致） */
const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

/**
 * 评估简历与岗位的匹配度（SSE 流式，返回最终 match 结果）。
 *
 * POST /api/ai/resume/analyze（需 JWT 认证，SSE 返回）
 *
 * 后端 SSE 事件流：meta → progress → node(parse) → node(analyze)
 * → node(match_assess 含 match) → node(suggest) → trace → done(含 match)
 *
 * @param text           - 简历文本
 * @param jobDescription - 目标岗位描述（JD）
 * @returns 匹配度结果；失败（网络/无 Key/参数错误）时返回 null
 */
export async function analyzeResumeMatch(
  text: string,
  jobDescription: string
): Promise<MatchResult | null> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/ai/resume/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, jobDescription }),
    });
  } catch {
    // 网络异常 → 静默降级，不阻断简历优化主流程
    console.warn("[resume-optimizer] 匹配度评估网络异常，已跳过");
    return null;
  }

  // 非 200（403 无 Key / 400 参数错误）→ 静默降级
  if (!response.ok) {
    console.warn(
      `[resume-optimizer] 匹配度评估请求失败 (${response.status})，已跳过`
    );
    return null;
  }

  // 逐事件解析，从 done 事件中取最终 match 结果
  let match: MatchResult | null = null;

  try {
    await readSSEStream(response, (evt) => {
      if (evt.event === "done") {
        try {
          const payload = JSON.parse(evt.data) as { match?: MatchResult | null };
          match = payload.match ?? null;
        } catch {
          // done 事件负载解析失败，保持 null
        }
      }
    });
  } catch {
    // 流式读取中断，静默降级
    console.warn("[resume-optimizer] 匹配度评估流式读取中断，已跳过");
    return null;
  }

  return match;
}
