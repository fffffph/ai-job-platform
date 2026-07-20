/**
 * ============================================
 * 全局类型定义
 * ============================================
 *
 * 统一管理项目中所有 TypeScript 类型定义，
 * 确保请求/响应数据结构一致，降低维护成本。
 */

// ========== 认证相关类型 ==========

/**
 * 注册请求体
 *
 * 客户端 POST /api/auth/register 时发送的 JSON 数据。
 * name 字段可选，email 和 password 必填。
 */
export interface RegisterRequest {
  /** 邮箱地址，用于登录和身份识别 */
  email: string;
  /** 明文密码，服务端收到后通过 bcrypt 加密存储 */
  password: string;
  /** 用户昵称/姓名（可选） */
  name?: string;
}

/**
 * 登录请求体
 *
 * 客户端 POST /api/auth/login 时发送的 JSON 数据。
 */
export interface LoginRequest {
  /** 邮箱地址 */
  email: string;
  /** 明文密码，服务端通过 bcrypt.compare() 比对数据库中的密文 */
  password: string;
}

// ========== 统一 API 响应类型 ==========

/**
 * 成功响应
 *
 * 所有成功（2xx）的 API 响应都使用此格式。
 * data 字段类型根据具体接口变化。
 */
export interface ApiSuccessResponse<T = unknown> {
  /** 固定为 true，表示请求成功 */
  success: true;
  /** 给用户的友好提示信息 */
  message: string;
  /** 业务数据，类型由泛型 T 决定 */
  data: T;
}

/**
 * 失败响应
 *
 * 所有失败（4xx/5xx）的 API 响应都使用此格式。
 * error 字段包含具体的错误详情。
 */
export interface ApiErrorResponse {
  /** 固定为 false，表示请求失败 */
  success: false;
  /** 给用户的错误提示信息 */
  message: string;
  /** 详细错误信息（开发环境返回，生产环境可隐藏） */
  error?: string;
  /** 错误码，便于前端根据不同的错误码做不同处理 */
  code?: string;
}

/**
 * 认证成功响应数据
 *
 * 登录/注册成功后返回的数据结构，
 * 包含 JWT token 和用户基本信息。
 */
export interface AuthResponseData {
  /** JWT 访问令牌，后续请求需在 Authorization header 中携带 */
  token: string;
  /** 用户信息（不包含密码） */
  user: {
    id: string;
    email: string;
    name: string | null;
    createdAt: Date;
  };
}
