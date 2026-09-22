/**
 * ============================================
 * 任务级 Prompt：岗位匹配度评估（Match Task）
 * ============================================
 *
 * 【职责】
 * 定义「岗位匹配度评估」节点的任务指令，仅在请求携带 JD 时执行。
 * 提供 buildMatchMessage 将 JD 与简历原文注入成最终的人类消息。
 */

/** 评估岗位匹配度的任务指令（不含 JD 与简历原文，由 buildMatchMessage 注入） */
export const MATCH_TASK_PROMPT = `请评估候选人与目标岗位的匹配度，并严格按 JSON Schema 输出。要求：

1. matchScore：给出 0-100 的匹配度评分，综合评估技能、经验年限与关键词覆盖；
2. matchedKeywords：列出简历中已覆盖且与岗位要求匹配的关键词；
3. missingKeywords：列出岗位要求中明确但简历缺失的关键词；
4. gapAnalysis：用 2-4 句话描述候选人与岗位之间的核心差距；
5. improvementPlan：给出按优先级排序的改进动作（priority 取 high / medium / low），每条 action 必须具体可执行。`;

/**
 * 构造「岗位匹配度评估」节点的人类消息内容。
 *
 * @param resumeText - 规范化后的简历原文
 * @param jobDescription - 目标岗位描述（JD），已去除首尾空白
 * @returns 任务指令 + JD + 简历原文拼接后的完整文本
 */
export function buildMatchMessage(
  resumeText: string,
  jobDescription: string
): string {
  return (
    `${MATCH_TASK_PROMPT}\n\n` +
    `【目标岗位描述（JD）】\n${jobDescription}\n\n` +
    `【简历原文】\n${resumeText}`
  );
}
