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
