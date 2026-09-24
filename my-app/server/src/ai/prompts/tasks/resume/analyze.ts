/**
 * ============================================
 * 任务级 Prompt：简历分析（Analyze Task）
 * ============================================
 *
 * 【职责】
 * 定义「分析简历」节点的任务指令，与系统级角色 Prompt（resume-expert）组合使用。
 * 提供 buildAnalyzeMessage 将简历原文注入成最终的人类消息。
 */

/** 分析简历的任务指令（不含简历原文，原文由 buildAnalyzeMessage 注入） */
export const ANALYZE_TASK_PROMPT = `请对用户提供的简历原文进行结构化诊断分析，并严格按 JSON Schema 输出。要求：

1. overallScore：给出 0-100 的整体评分，综合评估内容完整度、量化数据、关键词覆盖与排版逻辑；
2. tags：提炼 3-6 个亮点标签（如"量化数据充分""技术栈清晰"）；
3. highlights：列出 3-5 条核心亮点，每条 evidence 必须引用简历原文（可溯源），不得凭空编造；
4. weaknesses：指出 3-5 条主要短板，每条给出具体的 issue 与可执行的 suggestion；
5. summary：用一句话概括整体印象与最需要优先改进的方向。`;

/**
 * 构造「分析简历」节点的人类消息内容。
 *
 * @param resumeText - 规范化后的简历原文
 * @param taskPrompt - 任务指令（可选，缺省用 ANALYZE_TASK_PROMPT；P3 参数收敛后由配置中心注入）
 * @returns 任务指令 + 简历原文拼接后的完整文本
 */
export function buildAnalyzeMessage(
  resumeText: string,
  taskPrompt: string = ANALYZE_TASK_PROMPT
): string {
  return `${taskPrompt}\n\n【简历原文】\n${resumeText}`;
}
