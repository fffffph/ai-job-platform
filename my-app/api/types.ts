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
  /** 邮箱（登录标识之一，可能为空） */
  email: string | null;
  /** 手机号（登录标识之一，可能为空） */
  phone: string | null;
  /** 用户名 / 账号（登录标识之一，可能为空） */
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  /** 是否需要强制修改密码（管理员代建账号时由后端置 true） */
  mustChangePassword: boolean;
  /** 最后登录时间（ISO 字符串；从未登录为 null） */
  lastLoginAt: string | null;
  /** 最后登录 IP（可能为空） */
  lastLoginIp: string | null;
  /** 最后登录方式：password / email_otp / sms_otp 等 */
  lastLoginMethod: string | null;
  createdAt: string;
}

/** 更新用户资料请求参数 */
export interface UpdateProfileParams {
  name?: string;
  bio?: string;
}

/**
 * 修改登录标识请求参数（PUT /api/user/identifiers）。
 *
 * 【三个标识的语义（PATCH 风格）】
 * - 不传（undefined）→ 本次不涉及该标识，**保持库中原值**
 * - 传 "" 或 null   → 清空该标识
 * - 传具体值        → 设为该值（后端会归一化：手机号去分隔符、邮箱/用户名转小写）
 *
 * 【必须带 password】
 * 改登录标识是高危操作（可被用来接管账号），后端强制要求当前密码确认。
 * 无密码账号（管理员代建 / 验证码注册）后端会跳过该校验。
 */
export interface UpdateIdentifiersParams {
  /** 当前密码（身份确认） */
  password: string;
  /** 新邮箱 */
  email?: string | null;
  /** 新手机号 */
  phone?: string | null;
  /** 新用户名 */
  username?: string | null;
}

/** 修改登录标识结果 */
export interface UpdateIdentifiersResult {
  /** 更新后的用户资料 */
  profile: UserProfile;
  /**
   * 重新签发的 Token（仅在邮箱变更时返回）。
   * JWT payload 里带 email，邮箱变了要同步替换本地 Token。
   */
  token?: string;
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

/**
 * 登录请求参数（统一登录入口）
 *
 * 推荐只传 identifier：一个输入框，邮箱 / 手机号 / 用户名都能填，
 * 由后端 resolveIdentifier 判定具体类型。
 * loginApi 内部会把 identifier 映射到后端的同名字段。
 */
export interface LoginParams {
  /** 统一账号：邮箱 / 手机号 / 用户名 */
  identifier: string;
  password: string;
}

/** 注册请求参数 */
export interface RegisterParams {
  /**
   * 邮箱地址（可选，登录标识之一）。
   * 三标识体系下仅用户名也能注册，邮箱 / 用户名至少填一个。
   */
  email?: string;
  password: string;
  /**
   * 用户名 / 账号（登录标识）。
   * 注意与 name 区分：username 唯一、只能字母数字下划线中划线，
   * name 是昵称、仅展示、可重复。
   */
  username?: string;
  /** 昵称（可选，仅展示） */
  name?: string;
}

// ========== 统一错误码枚举 ==========

/** 后端预定义的业务错误码，前端根据错误码做不同处理 */
export enum ErrorCode {
  /** 邮箱已被注册（历史错误码，保留兼容） */
  EMAIL_EXISTS = "EMAIL_EXISTS",
  /** 登录标识（邮箱/手机号/用户名）已被占用 */
  IDENTIFIER_EXISTS = "IDENTIFIER_EXISTS",
  /** 登录标识格式不正确，或三个标识全空 */
  IDENTIFIER_INVALID = "IDENTIFIER_INVALID",
  /** 账号或密码错误 */
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  /** 该账号未设置密码（验证码/OAuth 用户、管理员未设密码的代建账号） */
  PASSWORD_NOT_SET = "PASSWORD_NOT_SET",
  /** Token 过期或无效 */
  UNAUTHORIZED = "UNAUTHORIZED",
  /** Token 已被主动吊销（改密码 / 被重置 / 强制下线 / 账号被软删除） */
  TOKEN_REVOKED = "TOKEN_REVOKED",
  /** 服务器内部错误 */
  SERVER_ERROR = "SERVER_ERROR",
  /** 旧密码不正确 */
  WRONG_PASSWORD = "WRONG_PASSWORD",
  /** 未配置 DeepSeek API Key */
  DEEPSEEK_KEY_NOT_CONFIGURED = "DEEPSEEK_KEY_NOT_CONFIGURED",
  /** DeepSeek API Key 格式不正确 */
  INVALID_KEY_FORMAT = "INVALID_KEY_FORMAT",
  /** 账号已被停用（P0-11，登录/请求被拒） */
  USER_DISABLED = "USER_DISABLED",
  /**
   * 必须先修改初始密码才能继续使用（403）。
   *
   * 管理员新建用户时开启「首次登录强制修改密码」后，该账号登录成功
   * 但调用其它接口一律返回此码，直到改完密码。
   * 前端拦截器收到此码应直接跳转 /change-password。
   */
  PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED",
  /** 权限不足（403，无权限执行此操作） */
  FORBIDDEN = "FORBIDDEN",
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

/**
 * 深度思考的一段推理过程（对应后端 SSE 的 reasoning 事件）。
 *
 * ReAct 循环里 agent 会执行多轮，因此一次请求可能产生多段思考；
 * 前端应累积成数组展示，而不是只保留最后一段。
 */
export interface ReasoningEntry {
  /** 产出该段思考的节点名（agent / finalize / generate / analyze / match_assess） */
  nodeName?: string;
  /** 思考过程全文 */
  content: string;
  /** 该轮模型调用耗时（毫秒） */
  reasoningMs: number;
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
  [ErrorCode.IDENTIFIER_EXISTS]: "该账号标识已被占用，请换一个",
  [ErrorCode.IDENTIFIER_INVALID]:
    "账号格式不正确，请输入邮箱、手机号或用户名",
  [ErrorCode.INVALID_CREDENTIALS]: "账号或密码错误，请检查后重试",
  [ErrorCode.PASSWORD_NOT_SET]:
    "该账号未设置密码，请联系管理员或用验证码登录",
  [ErrorCode.UNAUTHORIZED]: "登录已过期，请重新登录",
  [ErrorCode.TOKEN_REVOKED]: "登录状态已失效，请重新登录",
  [ErrorCode.SERVER_ERROR]: "服务器繁忙，请稍后重试",
  [ErrorCode.WRONG_PASSWORD]: "旧密码不正确，请检查后重试",
  [ErrorCode.DEEPSEEK_KEY_NOT_CONFIGURED]:
    "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化",
  [ErrorCode.INVALID_KEY_FORMAT]: "API Key 格式不正确，请检查后重试",
  [ErrorCode.USER_DISABLED]: "账号已被停用，请联系管理员",
  [ErrorCode.PASSWORD_CHANGE_REQUIRED]: "请先修改初始密码后再继续使用",
  [ErrorCode.FORBIDDEN]: "无权限执行此操作",
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

/**
 * 配置分组（与后端 config/schema.ts 的 ConfigGroup 对齐）。
 *
 * - custom：管理员新增的「自定义」动态配置
 * - auth  ：登录与账号（A-P0 新增），其中 auth.login.* / auth.otp.* /
 *           auth.password.min_length 会通过 GET /api/config/public 白名单
 *           透出给未登录的登录页
 */
export type ConfigGroup =
  | "prompt"
  | "llm"
  | "rag"
  | "jobs"
  | "switch"
  | "auth"
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

// ========== RBAC 权限体系：菜单 / 角色 / 用户管理 类型 ==========

/** 菜单节点类型：catalog（目录）| menu（菜单）| button（按钮） */
export type MenuType = "catalog" | "menu" | "button";

/** 启用状态 */
export type MenuStatus = "active" | "disabled";

/** 账号状态 */
export type UserStatus = "active" | "disabled";

/**
 * 菜单树节点（GET /api/menu/my 返回）。
 *
 * 后端按 sort 升序、剔除 button，catalog/menu 两级（或按实际层级）。
 */
export interface MenuTreeNode {
  /** 菜单 id */
  id: string;
  /** 权限码 / 唯一标识 */
  code: string;
  /** 菜单名称 */
  name: string;
  /** 路由路径（catalog 为 null） */
  path: string | null;
  /** 图标名（前端映射到图标组件，可为 null） */
  icon: string | null;
  /** 同级排序值 */
  sort: number;
  /** 子菜单 */
  children?: MenuTreeNode[];
}

/** 当前用户菜单结果（GET /api/menu/my） */
export interface MyMenuResult {
  /** 侧边栏菜单树 */
  menus: MenuTreeNode[];
  /** 用户全部权限码 */
  permissions: string[];
}

/**
 * 菜单项（GET /api/menu/tree 返回的平铺行）。
 *
 * 平铺数组 + parentId，前端自行组装 treeData（主理人拍板 A1）。
 */
export interface MenuItem {
  id: string;
  parentId: string | null;
  type: MenuType;
  code: string;
  name: string;
  path: string | null;
  component: string | null;
  icon: string | null;
  sort: number;
  visible: boolean;
  status: MenuStatus;
  createdAt: string;
  updatedAt: string;
}

/** 新增菜单入参（POST /api/menu） */
export interface CreateMenuParams {
  parentId: string | null;
  type: MenuType;
  code: string;
  name: string;
  path?: string | null;
  component?: string | null;
  icon?: string | null;
  sort?: number;
  visible?: boolean;
  status?: MenuStatus;
}

/** 编辑菜单入参（PUT /api/menu/:id，code 不可修改） */
export type UpdateMenuParams = Partial<CreateMenuParams>;

/** 角色列表项（GET /api/role/list） */
export interface RoleItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** 是否系统内置角色（admin/user=true，不可删除） */
  isSystem: boolean;
  /** 关联用户数 */
  userCount: number;
  /** 绑定菜单数；admin 为 null（全部权限） */
  menuCount: number | null;
}

/** 角色已绑定菜单结果（GET /api/role/:id/menus） */
export interface RoleMenuResult {
  menuIds: string[];
}

/** 新增角色入参 */
export interface CreateRoleParams {
  code: string;
  name: string;
  description?: string;
}

/** 编辑角色入参（code 不可修改） */
export interface UpdateRoleParams {
  name?: string;
  description?: string;
}

/** 保存角色菜单绑定入参（PUT /api/role/:id/menus） */
export interface SetRoleMenusParams {
  menuIds: string[];
}

/** 管理侧用户列表项（GET /api/user/list） */
export interface AdminUserItem {
  id: string;
  /** 邮箱（登录标识之一，可空） */
  email: string | null;
  /** 手机号（登录标识之一，可空） */
  phone: string | null;
  /** 用户名 / 账号（登录标识之一，可空） */
  username: string | null;
  /** 昵称（可空） */
  name: string | null;
  roles: { id: string; code: string; name: string }[];
  status: UserStatus;
  /** 是否需要强制修改密码 */
  mustChangePassword: boolean;
  /** 最后登录时间（ISO 字符串，从未登录为 null） */
  lastLoginAt: string | null;
  createdAt: string;
}

/** 用户列表结果（GET /api/user/list） */
export interface UserListResult {
  items: AdminUserItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 用户列表查询参数 */
export interface UserListQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 分配角色入参（PUT /api/user/:id/roles） */
export interface AssignRolesParams {
  roleIds: string[];
}

/** 设置账号状态入参（PUT /api/user/:id/status） */
export interface SetUserStatusParams {
  status: UserStatus;
}

// ============================================================
// 新增用户（B-P0）
// ============================================================

/** 登录标识字段（与后端 lib/identifier.ts 的 IdentifierField 对齐） */
export type IdentifierField = "email" | "phone" | "username";

/**
 * 新增用户入参（POST /api/user）
 *
 * 【三个登录标识至少填一个】，由后端统一校验。
 */
export interface CreateUserParams {
  /** 邮箱（登录标识，可选） */
  email?: string;
  /** 手机号（登录标识，可选） */
  phone?: string;
  /** 用户名（登录标识，可选） */
  username?: string;
  /** 昵称（可选） */
  name?: string;
  /** 管理员备注（可选） */
  remark?: string;
  /**
   * 密码来源：
   * - "default"：使用系统配置项 auth.user.default_password（推荐，省事且统一）
   * - "custom" ：使用 password 字段传入的密码
   */
  passwordMode: "default" | "custom";
  /** passwordMode === "custom" 时的明文密码 */
  password?: string;
  /** 分配的角色 id 数组；为空表示由后端绑定默认 user 角色 */
  roleIds?: string[];
  /** 账号状态，默认 active */
  status?: UserStatus;
  /** 是否要求首次登录强制改密 */
  mustChangePassword?: boolean;
}

/** 新增用户返回数据（POST /api/user） */
export interface CreateUserResult {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  name: string | null;
  status: UserStatus;
  roles: { id: string; code: string; name: string }[];
  /** 是否使用了系统默认密码（true 时前端提示「密码来自系统配置」） */
  usedDefaultPassword: boolean;
  /** 是否需要首次登录强制改密 */
  mustChangePassword: boolean;
}

/** 标识唯一性校验结果（GET /api/user/check-identity） */
export interface IdentifierCheckResult {
  /** 是否已被占用 */
  exists: boolean;
  /** 被占用时说明是哪个字段冲突 */
  conflictField?: IdentifierField;
}

// ============================================================
// 公开配置（GET /api/config/public）
// ============================================================

/**
 * 公开配置映射（登录页 / 注册页在未登录状态读取）。
 *
 * 只含开关与策略类配置，不含任何敏感值。
 */
export interface PublicConfigMap {
  /** 是否开放自助注册 */
  "auth.register.enabled"?: boolean;
  /** 密码登录总开关 */
  "auth.login.password"?: boolean;
  /** 是否允许用户名登录 */
  "auth.login.username"?: boolean;
  /** 是否允许手机号 + 密码登录 */
  "auth.login.phone"?: boolean;
  /** 邮箱验证码登录开关 */
  "auth.login.email_otp"?: boolean;
  /** 手机短信验证码登录开关 */
  "auth.login.sms_otp"?: boolean;
  /** 验证码登录未注册时是否自动注册 */
  "auth.login.otp_auto_register"?: boolean;
  /** 发验证码前是否强制图形验证 */
  "auth.captcha.required"?: boolean;
  /** 验证码有效期（秒） */
  "auth.otp.ttl_seconds"?: number;
  /** 验证码重发冷却（秒） */
  "auth.otp.resend_seconds"?: number;
  /** 密码最小长度 */
  "auth.password.min_length"?: number;
}
