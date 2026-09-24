/**
 * ============================================
 * API 统一类型定义
 * ============================================
 *
 * 【设计原则】
 * 所有后端 API 响应都遵循统一的数据结构，
 * 前端通过泛型 `ApiResponse<T>` 约束每个接口的返回类型，
 * 确保类型安全的同时保持代码简洁。
 *
 * 【响应格式】
 * 成功：{ success: true, message: string, data: T }
 * 失败：{ success: false, message: string, code?: string }
 */

// ========== 通用 API 响应 ==========

/** 成功响应（泛型 T 为具体业务数据类型） */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
}

/** 失败响应 */
export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  error?: string;
}

/** 统一的 API 响应类型（联合类型，调用方通过 success 字段区分） */
export type ApiResponse<T = unknown> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;

// ========== 用户资料类型 ==========

/** 用户公开资料（来自 GET /api/user/profile） */
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  createdAt: string;
}

/** 更新用户资料请求参数 */
export interface UpdateProfileParams {
  name?: string;
  bio?: string;
}

/** 修改密码请求参数 */
export interface ChangePasswordParams {
  oldPassword: string;
  newPassword: string;
}

/** 头像上传返回数据 */
export interface AvatarResult {
  avatar: string;
}

// ========== DeepSeek API Key 类型 ==========

/** DeepSeek API Key 状态（脱敏，绝不含明文） */
export interface DeepSeekKeyStatus {
  /** 是否已配置 */
  configured: boolean;
  /** 脱敏尾号，如 "sk-****abcd"，未配置时为空字符串 */
  maskedTail: string;
  /** 最后更新时间（ISO 字符串），未配置时为 null */
  updatedAt: string | null;
}

/** DeepSeek API Key 连通性测试结果 */
export interface DeepSeekKeyTestResult {
  ok: boolean;
  message: string;
}

// ========== SiliconFlow API Key 类型（与 DeepSeek Key 对称） ==========

/** SiliconFlow API Key 状态（结构与 DeepSeekKeyStatus 完全一致，脱敏） */
export type SiliconFlowKeyStatus = DeepSeekKeyStatus;

/** SiliconFlow API Key 连通性测试结果（结构与 DeepSeekKeyTestResult 一致） */
export type SiliconFlowKeyTestResult = DeepSeekKeyTestResult;

// ========== 认证相关类型 ==========

/** 登录/注册成功返回的用户信息和 Token */
export interface AuthResult {
  token: string;
  user: UserProfile;
}

/** 登录请求参数 */
export interface LoginParams {
  email: string;
  password: string;
}

/** 注册请求参数 */
export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
}

// ========== 统一错误码枚举 ==========

/** 后端预定义的业务错误码，前端根据错误码做不同处理 */
export enum ErrorCode {
  /** 邮箱已被注册 */
  EMAIL_EXISTS = "EMAIL_EXISTS",
  /** 邮箱或密码错误 */
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  /** Token 过期或无效 */
  UNAUTHORIZED = "UNAUTHORIZED",
  /** 服务器内部错误 */
  SERVER_ERROR = "SERVER_ERROR",
  /** 旧密码不正确 */
  WRONG_PASSWORD = "WRONG_PASSWORD",
  /** 未配置 DeepSeek API Key */
  DEEPSEEK_KEY_NOT_CONFIGURED = "DEEPSEEK_KEY_NOT_CONFIGURED",
  /** DeepSeek API Key 格式不正确 */
  INVALID_KEY_FORMAT = "INVALID_KEY_FORMAT",
}

// ========== 个人知识库（RAG）类型 ==========

/** 知识库检索命中的单个文档分块 */
export interface RetrievedChunk {
  /** 来源文档 ID（用于关键词命中融合） */
  documentId: string;
  /** 分块文本内容 */
  content: string;
  /** 来源文档标题 */
  documentTitle: string;
  /** 分块序号（从 0 开始，用于溯源定位） */
  chunkIndex: number;
  /** 相似度分数（1 - 余弦距离，越大越相似，范围约 [-1, 1]） */
  score: number;
}

/** 知识库文档入库结果 */
export interface UploadResult {
  /** 新文档 ID */
  documentId: string;
  /** 分块数量 */
  chunkCount: number;
}

/** 知识库文档条目（我的知识列表） */
export interface KnowledgeDocument {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 检索词（逗号分隔，可空） */
  keywords: string | null;
  /** 分类（可空） */
  category: string | null;
  /** 分块数量 */
  chunkCount: number;
  /** 入库时间（ISO 字符串） */
  createdAt: string;
}

/** Excel 批量导入结果 */
export interface ImportResult {
  /** 入库条目数 */
  documentCount: number;
  /** 总的分块数 */
  chunkCount: number;
  /** 有效数据行总数 */
  total: number;
  /** 失败行（行号 + 原因） */
  failed: { row: number; reason: string }[];
}

/** 知识条目（文本解析 / Excel 导入的中间结构） */
export interface KnowledgeEntry {
  /** 条目标题 */
  title: string;
  /** 条目内容 */
  content: string;
  /** 逗号分隔检索词（可选） */
  keywords?: string;
  /** 分类（可选） */
  category?: string;
}

// ========== 求职画像类型（P5 Memory） ==========

/** 用户求职画像（结构化记忆，供职位推荐个性化） */
export interface JobProfile {
  /** 求职方向/岗位 */
  jobTitle: string;
  /** 期望城市 */
  city: string;
  /** 技能栈 */
  skills: string;
  /** 期望薪资 */
  expectedSalary: string;
}

// ========== 职位推荐结构化类型 ==========

/** 单条职位推荐（含推荐原因/自动招呼语/BOSS直达链接） */
export interface JobRecommendationItem {
  /** 职位名称 */
  jobTitle: string;
  /** 公司名称 */
  company: string;
  /** 所在城市 */
  city: string;
  /** 薪资范围 */
  salary: string;
  /** 推荐原因 */
  reason: string;
  /** 自动招呼语（可复制到 BOSS直聘「立即沟通」） */
  greeting: string;
  /** BOSS直聘直达搜索链接 */
  url: string;
}

/** 职位推荐结构化结果 */
export interface JobRecommendation {
  /** 一句话总结 */
  summary: string;
  /** 推荐职位列表 */
  recommendations: JobRecommendationItem[];
}

// ========== AI Trace 类型（P6 可观测） ==========

/** 单个 AI 节点的执行追踪记录 */
export interface TraceEvent {
  /** 节点名称，如 agent / tools / analyze / retrieve */
  nodeName: string;
  /** 节点输入（原始数据，供详情面板展开查看） */
  input: unknown;
  /** 节点输出（原始数据） */
  output: unknown;
  /** 节点耗时（毫秒） */
  durationMs: number;
  /** 事件发生时间（ISO 8601 字符串） */
  timestamp: string;
}

// ========== AI Trace 历史（P6 落库后新增） ==========

/** AI 执行的图类型：简历分析 / 知识库问答 / 职位发现 */
export type TraceRunType = "resume" | "rag" | "jobs";

/** AI 执行状态 */
export type TraceRunStatus = "success" | "error";

/**
 * 历史列表项（不含事件详情，轻量）。
 * 对应后端 GET /api/ai/trace/runs 返回的 data 元素。
 */
export interface TraceRunListItem {
  /** run 唯一 ID */
  id: string;
  /** 图类型：resume / rag / jobs */
  type: string;
  /** 执行状态：success / error */
  status: string;
  /** 节点数量 */
  nodeCount: number;
  /** 总耗时（毫秒，各节点耗时之和） */
  totalDurationMs: number;
  /** 执行创建时间（ISO 8601 字符串） */
  createdAt: string;
}

/**
 * 单次执行的完整详情（含按顺序排列的节点事件）。
 * 对应后端 GET /api/ai/trace/runs/:id 返回的 data。
 *
 * 注意：events 里每个事件相比 TraceEvent 多了 id/runId/order/createdAt
 * 等持久化字段，但前端回放只用到 TraceEvent 的 5 个字段，
 * 结构赋值时多余字段被忽略，因此这里直接复用 TraceEvent。
 */
export interface TraceRunDetail extends TraceRunListItem {
  /** 按执行顺序排列的节点事件 */
  events: TraceEvent[];
}

/** 错误码对应的用户提示文案 */
export const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.EMAIL_EXISTS]: "该邮箱已被注册，请使用其他邮箱或直接登录",
  [ErrorCode.INVALID_CREDENTIALS]: "邮箱或密码错误，请检查后重试",
  [ErrorCode.UNAUTHORIZED]: "登录已过期，请重新登录",
  [ErrorCode.SERVER_ERROR]: "服务器繁忙，请稍后重试",
  [ErrorCode.WRONG_PASSWORD]: "旧密码不正确，请检查后重试",
  [ErrorCode.DEEPSEEK_KEY_NOT_CONFIGURED]:
    "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化",
  [ErrorCode.INVALID_KEY_FORMAT]: "API Key 格式不正确，请检查后重试",
};

// ========== 系统配置（配置中心）类型 ==========

/** 配置值类型（与后端 config/schema.ts 对齐） */
export type ConfigType =
  | "string"
  | "textarea"
  | "number"
  | "boolean"
  | "json"
  | "json-array"
  | "file";

/** 配置分组（与后端对齐，custom 为管理员新增的「自定义」动态配置组） */
export type ConfigGroup =
  | "prompt"
  | "llm"
  | "rag"
  | "jobs"
  | "switch"
  | "custom";

/** string 类型的下拉选项 */
export interface ConfigEnumOption {
  value: string;
  label: string;
}

/**
 * 单个配置项的有效状态（对应后端 GET /api/config 返回的 data 元素）。
 *
 * 后端「三级回退」后给出最终 value + 是否被覆盖 + 是否启用，
 * 并透传 min/max/enum/jsonSchema 等元数据，供前端 schema 驱动渲染控件。
 */
export interface EffectiveConfigItem {
  /** 唯一键，如 "prompt.resume_expert" */
  key: string;
  /** 值类型，决定前端控件 */
  type: ConfigType;
  /** 中文名 */
  label: string;
  /** 说明文字 */
  description?: string;
  /** 分组 */
  group: ConfigGroup;
  /** 内置默认值 */
  defaultValue: unknown;
  /** 是否启用（元开关） */
  enabled: boolean;
  /** 有效值（回退后的最终值） */
  value: unknown;
  /** 是否已被覆盖（DB 存在覆盖值） */
  overridden: boolean;
  /** number 类型：最小值 */
  min?: number;
  /** number 类型：最大值 */
  max?: number;
  /** string 类型：可选下拉选项 */
  enum?: ConfigEnumOption[];
  /** json / json-array 类型：结构说明 */
  jsonSchema?: string;
}

/** 批量保存配置的单项（PUT /api/config 请求体 items 元素） */
export interface SaveConfigItem {
  key: string;
  value: unknown;
  enabled?: boolean;
}

/** 新增动态配置的请求参数（POST /api/config） */
export interface CreateConfigParams {
  /** 配置键（全小写、点分、见名知意，如 "feature.my_flag"，须全局唯一） */
  key: string;
  /** 值类型（决定前端控件与后端校验） */
  type: ConfigType;
  /** 配置值 */
  value: unknown;
  /** 中文名（见名知意展示用） */
  label?: string;
  /** 说明文字 */
  description?: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 当前用户角色查询结果（GET /api/user/roles） */
export interface UserRolesResult {
  /** 角色代码数组，如 ["admin"] / ["user"] */
  roles: string[];
}
