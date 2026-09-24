/**
 * ============================================
 * 系统配置注册表（Config Schema）—— 唯一事实源
 * ============================================
 *
 * 【职责】
 * 集中登记系统所有「可配置项」的元数据与默认值。
 * - 后端 config-service 据此做校验、回退、读取；
 * - 前端「系统设置」页面据此自动渲染表格与编辑控件（schema 驱动，无需改前端代码）。
 *
 * 【单一事实源原则】
 * 新增/修改一个配置项，只动本文件：往 CONFIG_SCHEMA 加一条即可，
 * 前端表格/弹窗、后端校验/回退都会自动生效。
 *
 * 【三级回退链】（在 config-service.ts 中实现）
 * 数据库覆盖值（system_configs.value）→ 环境变量（部分项）→ 本文件 defaultValue
 *
 * 【关于 enabled（是否启用）】
 * 每个配置项都有一个 enabled 开关：
 * - true（默认）：该配置项的「覆盖值」生效；
 * - false：覆盖值被临时禁用，读取时回退到 defaultValue（保留覆盖值，方便重新启用）。
 * 注意：enabled 是「元开关」（控制覆盖是否生效），与 boolean 类型的
 * 「功能开关配置项」（如 switch.hybrid_search 的 value）是两个不同维度。
 */

// ============================================================
// 类型定义
// ============================================================

/**
 * 配置值类型枚举 —— 决定前端用什么控件渲染、后端如何校验。
 *
 * - string      : 单行文本（模型名、URL 等）
 * - textarea    : 多行文本（prompt 文案）
 * - number      : 数字（温度、topK、超时等，配 min/max）
 * - boolean     : 开关（混合检索等，value 本身即功能开关）
 * - json        : JSON 对象（映射表等）
 * - json-array  : JSON 数组（关键词列表等）
 * - file        : 文件（模板、资源，预留；当前无实际项）
 */
export type ConfigType =
  | "string"
  | "textarea"
  | "number"
  | "boolean"
  | "json"
  | "json-array"
  | "file";

/**
 * 配置分组 —— 前端「系统设置」页面按此分组展示。
 *
 * custom 为「自定义」分组：管理员在设置页新增的「动态配置」统一归入此组，
 * 与注册表内建项（prompt/llm/rag/jobs/switch）区分开。
 */
export type ConfigGroup = "prompt" | "llm" | "rag" | "jobs" | "switch" | "custom";

/**
 * 单个配置项的定义（元数据 + 默认值）。
 */
export interface ConfigFieldDef {
  /** 唯一键，如 "prompt.resume_expert" */
  key: string;
  /** 值类型，决定前端控件与后端校验 */
  type: ConfigType;
  /** 中文名 */
  label: string;
  /** 说明文字 */
  description?: string;
  /** 分组 */
  group: ConfigGroup;
  /** 内置默认值（三级回退的最终兜底，永不为空） */
  defaultValue: unknown;
  /** 是否启用（默认 true） */
  enabled: boolean;
  /** number 类型：最小值 */
  min?: number;
  /** number 类型：最大值 */
  max?: number;
  /** string 类型：可选下拉选项 */
  enum?: Array<{ value: string; label: string }>;
  /** json / json-array 类型：结构说明（给编辑者看的示例） */
  jsonSchema?: string;
  /** file 类型：接受的文件扩展名 */
  fileAccept?: string;
}

// ============================================================
// 分组中文名映射（前端展示用）
// ============================================================

export const GROUP_LABELS: Record<ConfigGroup, string> = {
  prompt: "Prompt 文案",
  llm: "模型参数",
  rag: "知识库检索",
  jobs: "职位发现",
  switch: "功能开关",
  custom: "自定义",
};

// ============================================================
// 内置默认值常量（从现有硬编码值提取，P3 参数收敛后成为唯一来源）
// ============================================================

/** 职位发现 Agent 系统人设（原 prompts/system/job-agent.ts） */
const JOB_AGENT_PROMPT = `你是 CareerAI 平台的资深求职顾问 Agent，擅长根据求职者的意向搜索匹配职位。

【核心能力】
你可以调用 search_jobs 工具搜索职位库。请发挥**自主规划**能力：
1. 根据用户求职意向，先提取 2-4 个核心技能关键词（如 React、微前端、Node.js）；
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
3. 目标：覆盖到 5-15 个候选职位后即可停止搜索。`;

/** 简历诊断专家系统人设（原 prompts/system/resume-expert.ts） */
const RESUME_EXPERT_PROMPT = `你是 CareerAI 平台的资深 HR 与简历优化专家，拥有 10 年以上互联网/技术类岗位招聘经验。

【全局规则（所有任务都必须遵守）】
1. 全程使用简体中文输出；
2. 客观、具体、可量化，避免空泛套话（如"工作认真负责"）；
3. 不虚构、不编造简历中不存在的信息，所有判断必须基于简历原文，引用原文作为证据；
4. 建议必须可落地、可执行，尽量给出量化指标或改写示例；
5. 输出必须严格符合给定的 JSON Schema，字段类型与取值范围不得偏差；
6. 评分统一使用 0-100 的整数，并给出评分依据。`;

/** 简历分析任务指令（原 prompts/tasks/resume/analyze.ts） */
const ANALYZE_TASK_PROMPT = `请对用户提供的简历原文进行结构化诊断分析，并严格按 JSON Schema 输出。要求：

1. overallScore：给出 0-100 的整体评分，综合评估内容完整度、量化数据、关键词覆盖与排版逻辑；
2. tags：提炼 3-6 个亮点标签（如"量化数据充分""技术栈清晰"）；
3. highlights：列出 3-5 条核心亮点，每条 evidence 必须引用简历原文（可溯源），不得凭空编造；
4. weaknesses：指出 3-5 条主要短板，每条给出具体的 issue 与可执行的 suggestion；
5. summary：用一句话概括整体印象与最需要优先改进的方向。`;

/** 岗位匹配度任务指令（原 prompts/tasks/resume/match.ts） */
const MATCH_TASK_PROMPT = `请评估候选人与目标岗位的匹配度，并严格按 JSON Schema 输出。要求：

1. matchScore：给出 0-100 的匹配度评分，综合评估技能、经验年限与关键词覆盖；
2. matchedKeywords：列出简历中已覆盖且与岗位要求匹配的关键词；
3. missingKeywords：列出岗位要求中明确但简历缺失的关键词；
4. gapAnalysis：用 2-4 句话描述候选人与岗位之间的核心差距；
5. improvementPlan：给出按优先级排序的改进动作（priority 取 high / medium / low），每条 action 必须具体可执行。`;

/** 知识库回答系统 Prompt（原 graphs/rag/nodes.ts 内联） */
const RAG_ANSWER_PROMPT = `你是一个专业的求职知识库助手。请基于下方提供的「知识库检索结果」回答用户问题。

要求：
1. 只依据检索结果回答，不要编造检索结果之外的事实。
2. 回答中必须标注引用来源，用 [1]、[2] 等编号对应检索结果中的分块编号。
3. 若检索结果不足以回答，请明确说明"知识库中未找到相关内容"，不要强行作答。
4. 语言：简体中文。`;

/** 职位推荐 finalize 系统 Prompt（原 graphs/jobs/nodes.ts 内联） */
const FINALIZE_PROMPT = `你是资深求职顾问。请从「候选职位列表」中，根据「用户求职意向」选出最匹配的职位（最多 8 条），按匹配度从高到低排序，并为每条生成推荐原因和自动招呼语。

要求：
1. reason：一句话说明为什么适合（技能匹配/城市符合/薪资达标等），客观具体；
2. greeting：礼貌的自动招呼语，突出求职者优势，可直接用于 BOSS直聘「立即沟通」，控制在 40 字以内；
3. url：必须使用候选职位数据中自带的 url 字段（BOSS直达链接），不要自行编造或修改；
4. summary：一句话总结本次推荐的整体情况；
5. 全程简体中文。`;

/** 文本解析 LLM 兜底 Prompt（原 rag/text-parser.ts 内联） */
const PARSE_TEXT_PROMPT = `你是知识库整理助手。请把用户粘贴的文本解析成结构化的知识条目列表。

要求：
1. 识别文本中的多个知识点（通常以标题、问题、编号或空行分隔），每条拆成一个条目；
2. 每个条目提取：标题（一句话概括）、内容（详细正文）、检索词（用户可能怎么提问，逗号分隔）、分类（可选）；
3. 若文本只是单一知识点，则只返回一条；
4. 检索词要覆盖该知识点的核心关键词，方便后续语义检索命中；
5. 分类可依据内容推断（如「前端/React」「后端/Node」「小程序」等），无法判断则留空。`;

// ============================================================
// 配置项注册表（唯一事实源）
// ============================================================

export const CONFIG_SCHEMA: ConfigFieldDef[] = [
  // ---------- Prompt 组（textarea） ----------
  {
    key: "prompt.job_agent",
    type: "textarea",
    label: "职位发现 Agent 人设",
    description: "职位发现 ReAct Agent 的系统人设与搜索策略",
    group: "prompt",
    defaultValue: JOB_AGENT_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.resume_expert",
    type: "textarea",
    label: "简历诊断专家人设",
    description: "简历分析/匹配任务共享的全局角色与铁律",
    group: "prompt",
    defaultValue: RESUME_EXPERT_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.analyze_task",
    type: "textarea",
    label: "简历分析任务指令",
    description: "「分析简历」节点的任务指令（结构化诊断输出要求）",
    group: "prompt",
    defaultValue: ANALYZE_TASK_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.match_task",
    type: "textarea",
    label: "岗位匹配任务指令",
    description: "「岗位匹配度评估」节点的任务指令",
    group: "prompt",
    defaultValue: MATCH_TASK_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.rag_answer",
    type: "textarea",
    label: "知识库回答 Prompt",
    description: "知识库问答的回答生成 Prompt（要求标注引用来源）",
    group: "prompt",
    defaultValue: RAG_ANSWER_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.finalize",
    type: "textarea",
    label: "职位推荐 Prompt",
    description: "职位发现 finalize 节点的结构化推荐 Prompt",
    group: "prompt",
    defaultValue: FINALIZE_PROMPT,
    enabled: true,
  },
  {
    key: "prompt.parse_text",
    type: "textarea",
    label: "文本解析 Prompt",
    description: "知识文本 LLM 兜底解析的 Prompt",
    group: "prompt",
    defaultValue: PARSE_TEXT_PROMPT,
    enabled: true,
  },

  // ---------- 模型参数组（llm） ----------
  {
    key: "llm.model",
    type: "string",
    label: "对话模型名",
    description: "DeepSeek 对话模型标识",
    group: "llm",
    defaultValue: "deepseek-chat",
    enabled: true,
    enum: [
      { value: "deepseek-chat", label: "deepseek-chat（通用对话）" },
      { value: "deepseek-reasoner", label: "deepseek-reasoner（推理增强）" },
    ],
  },
  {
    key: "llm.max_tokens",
    type: "number",
    label: "最大 token 数",
    description: "单次生成的最大 token（deepseek-chat 上限 8192）",
    group: "llm",
    defaultValue: 4096,
    enabled: true,
    min: 1,
    max: 8192,
  },
  {
    key: "llm.temperature",
    type: "number",
    label: "采样温度",
    description: "取值越低输出越稳定（0-2）",
    group: "llm",
    defaultValue: 0.3,
    enabled: true,
    min: 0,
    max: 2,
  },
  {
    key: "llm.timeout_ms",
    type: "number",
    label: "LLM 超时(ms)",
    description: "对话模型请求超时，避免上游无响应时连接挂起",
    group: "llm",
    defaultValue: 60000,
    enabled: true,
    min: 5000,
    max: 300000,
  },

  // ---------- 知识库检索组（rag） ----------
  {
    key: "rag.top_k",
    type: "number",
    label: "检索条数 Top-K",
    description: "向量检索返回的最相关分块数",
    group: "rag",
    defaultValue: 5,
    enabled: true,
    min: 1,
    max: 20,
  },
  {
    key: "rag.candidate_multiplier",
    type: "number",
    label: "候选召回倍数",
    description: "先召回 Top-K×N 候选再融合重排，避免关键词命中文档被漏掉",
    group: "rag",
    defaultValue: 3,
    enabled: true,
    min: 1,
    max: 10,
  },
  {
    key: "rag.keyword_boost",
    type: "number",
    label: "检索词加权分",
    description: "单个检索词命中在融合打分中的加权（0-1）",
    group: "rag",
    defaultValue: 0.15,
    enabled: true,
    min: 0,
    max: 1,
  },
  {
    key: "rag.chunk_size",
    type: "number",
    label: "分块大小(字)",
    description: "文档分块的目标字数",
    group: "rag",
    defaultValue: 512,
    enabled: true,
    min: 100,
    max: 2000,
  },
  {
    key: "rag.chunk_overlap",
    type: "number",
    label: "分块重叠(字)",
    description: "相邻分块的重叠字数，保证跨块语义连续",
    group: "rag",
    defaultValue: 128,
    enabled: true,
    min: 0,
    max: 500,
  },
  {
    key: "rag.embedding_timeout_ms",
    type: "number",
    label: "Embedding 超时(ms)",
    description: "向量化接口请求超时",
    group: "rag",
    defaultValue: 60000,
    enabled: true,
    min: 5000,
    max: 300000,
  },

  // ---------- 职位发现组（jobs） ----------
  {
    key: "jobs.max_recommend",
    type: "number",
    label: "推荐条数上限",
    description: "单次职位推荐的职位数量上限",
    group: "jobs",
    defaultValue: 8,
    enabled: true,
    min: 1,
    max: 20,
  },
  {
    key: "jobs.greeting_max_len",
    type: "number",
    label: "招呼语字数上限",
    description: "自动招呼语的最大字数（BOSS 直聘立即沟通用）",
    group: "jobs",
    defaultValue: 40,
    enabled: true,
    min: 10,
    max: 100,
  },
  {
    key: "jobs.candidate_min",
    type: "number",
    label: "候选职位下限",
    description: "Agent 搜索停止前需覆盖的最少候选职位数",
    group: "jobs",
    defaultValue: 5,
    enabled: true,
    min: 1,
    max: 100,
  },
  {
    key: "jobs.candidate_max",
    type: "number",
    label: "候选职位上限",
    description: "Agent 搜索停止前覆盖的候选职位数上限",
    group: "jobs",
    defaultValue: 15,
    enabled: true,
    min: 1,
    max: 100,
  },
  {
    key: "jobs.skill_keywords_min",
    type: "number",
    label: "技能关键词最少个数",
    description: "Agent 从求职意向中提取技能关键词的最少个数",
    group: "jobs",
    defaultValue: 2,
    enabled: true,
    min: 1,
    max: 10,
  },
  {
    key: "jobs.skill_keywords_max",
    type: "number",
    label: "技能关键词最多个数",
    description: "Agent 从求职意向中提取技能关键词的最多个数",
    group: "jobs",
    defaultValue: 4,
    enabled: true,
    min: 1,
    max: 20,
  },

  // ---------- 功能开关组（switch，boolean 类型） ----------
  {
    key: "switch.hybrid_search",
    type: "boolean",
    label: "混合检索",
    description: "关闭后知识库检索退化为纯向量检索（忽略检索词融合）",
    group: "switch",
    defaultValue: true,
    enabled: true,
  },
  {
    key: "switch.llm_parse",
    type: "boolean",
    label: "文本解析 LLM 兜底",
    description: "关闭后文本解析只走规则解析，不调用 LLM（省 token）",
    group: "switch",
    defaultValue: true,
    enabled: true,
  },
  {
    key: "switch.mock_jobs",
    type: "boolean",
    label: "职位模拟数据",
    description: "当前职位库为模拟数据，将来接真实数据源时关闭",
    group: "switch",
    defaultValue: true,
    enabled: true,
  },
];

// ============================================================
// 辅助查询函数
// ============================================================

/** 按 key 查找配置项定义（不存在返回 undefined） */
export function findConfig(key: string): ConfigFieldDef | undefined {
  return CONFIG_SCHEMA.find((c) => c.key === key);
}

/** 按分组过滤配置项（保持注册表顺序） */
export function getConfigsByGroup(group: ConfigGroup): ConfigFieldDef[] {
  return CONFIG_SCHEMA.filter((c) => c.group === group);
}

/** 全部配置项的 key 列表（用于校验非法 key） */
export const ALL_CONFIG_KEYS: string[] = CONFIG_SCHEMA.map((c) => c.key);

// ============================================================
// 配置 key 命名规范（动态配置「见名知意」校验用）
// ============================================================

/**
 * 配置 key 的命名规则（正则）：
 * - 全小写；
 * - 以字母开头，段内可用小写字母 / 数字 / 下划线；
 * - 用点 `.` 分隔「分组.语义名」，如 `switch.hybrid_search`、`llm.model`；
 * - 至少一段（允许单段，但 UI 建议点分多段以见名知意）。
 *
 * 例：`feature.my_flag` ✅ / `Feature.MyFlag` ❌ / `feature my flag` ❌ / `feature-1` ❌（中划线不在此列）
 */
export const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/**
 * 校验配置 key 是否符合命名规范。
 *
 * @param key - 待校验的 key
 * @returns 是否合法
 */
export function isValidConfigKey(key: string): boolean {
  return CONFIG_KEY_PATTERN.test(key);
}
