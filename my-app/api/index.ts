/**
 * API 模块统一导出
 *
 * 调用方只需 import { xxx } from "@/api";
 */

// 认证模块
export { loginApi, registerApi } from "./modules/auth";

// 用户模块
export {
  getUserProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
} from "./modules/user";

// Token 工具函数
export { getToken, setToken, removeToken } from "./client";

// 类型导出（使用 type 关键字做类型擦除优化）
export type {
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  AuthResult,
  UserProfile,
  UpdateProfileParams,
  ChangePasswordParams,
  AvatarResult,
  LoginParams,
  RegisterParams,
} from "./types";

// 枚举和常量导出
export { ErrorCode, ERROR_MESSAGES } from "./types";
