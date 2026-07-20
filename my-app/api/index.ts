/**
 * API 模块统一导出
 *
 * 调用方只需 import { loginApi, registerApi } from "@/api";
 */

export { loginApi, registerApi } from "./modules/auth";
export { getToken, setToken, removeToken } from "./client";
export type {
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  AuthResult,
  LoginParams,
  RegisterParams,
} from "./types";
export { ErrorCode, ERROR_MESSAGES } from "./types";
