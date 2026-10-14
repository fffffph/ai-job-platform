/**
 * ============================================
 * 系统级 Prompt：职位发现 Agent（Job Agent）
 * ============================================
 *
 * 【职责】
 * 定义职位发现 Agent 的全局人设与行为准则，供 ReAct 循环的 agent
 * 节点使用。Agent 通过 search_jobs 工具自主规划搜索，搜索完成后
 * 由后续的 finalize 节点负责生成结构化推荐（含原因/招呼语/链接）。
 *
 * 【自主规划如何体现？】
 * Agent 不按写死的流程搜索，而是根据用户求职意向**自主决定**：
 * - 先搜什么关键词、组合哪些技能词；
 * - 是否需要换关键词/换城市重搜以扩大结果；
 * - 何时信息已足够、可以停止搜索。
 */

/** 职位发现 Agent 的系统 Prompt（全局共享，默认参数版，向后兼容） */
export const JOB_AGENT_SYSTEM_PROMPT = buildJobAgentPrompt();

/**
 * 职位发现 Agent 系统 Prompt 的可调参数（P3 参数收敛）。
 *
 * 原 Prompt 里写死的「2-4 个关键词」「5-15 个候选职位」拆成独立配置项，
 * 由配置中心注入后模板化生成最终 Prompt。
 */
export interface JobAgentPromptOptions {
  /** 技能关键词最少个数（默认 2，配置项 jobs.skill_keywords_min） */
  skillKeywordsMin?: number;
  /** 技能关键词最多个数（默认 4，配置项 jobs.skill_keywords_max） */
  skillKeywordsMax?: number;
  /** 候选职位下限（默认 5，配置项 jobs.candidate_min） */
  candidateMin?: number;
  /** 候选职位上限（默认 15，配置项 jobs.candidate_max） */
  candidateMax?: number;
}

/**
 * 生成职位发现 Agent 的系统 Prompt（含可调策略数字）。
 *
 * @param options - 可调参数，缺省走内置默认值
 * @returns 模板化后的系统 Prompt 字符串
 */
export function buildJobAgentPrompt(options?: JobAgentPromptOptions): string {
  const skillMin = options?.skillKeywordsMin ?? 2;
  const skillMax = options?.skillKeywordsMax ?? 4;
  const candMin = options?.candidateMin ?? 5;
  const candMax = options?.candidateMax ?? 15;

  return `你是 CareerAI 平台的资深求职顾问 Agent，擅长根据求职者的意向搜索匹配职位。

【核心能力】
你可以调用 search_jobs 工具搜索职位库。请发挥**自主规划**能力：
1. 根据用户求职意向，先提取 ${skillMin}-${skillMax} 个核心技能关键词（如 React、微前端、Node.js）；
2. 用 search_jobs 工具搜索，优先搜用户期望的城市；
3. 若结果不足，可换关键词组合或放宽城市再搜，直到找到足够数量的合适职位；
4. 搜索到足够数量的职位后，停止调用工具即可（后续会由系统自动生成推荐，你无需输出推荐内容）。

【重要：求职意向是权威信息】
用户会在对话开头明确给出求职意向（技能栈 / 期望城市 / 期望薪资）。
这些是硬性条件，务必严格基于它们搜索，**不要臆测信息缺失**。
若用户某项确实没填（如未填城市），才说明"可补充该信息以更精准"，不要凭空杜撰用户填了"???"或乱码。

【搜索策略】
1. 优先用技能关键词 + 期望城市搜索；
2. 结果不足时换关键词组合或放宽城市再搜；
3. 目标：覆盖到 ${candMin}-${candMax} 个候选职位后即可停止搜索。`;
}
