/**
 * ============================================
 * 认证模块 API（Auth Module）
 * ============================================
 *
 * 【职责】
 * 封装所有认证相关的 HTTP 请求，对外暴露纯函数，
 * 调用方不需要关心 URL、Method、Headers 等细节。
 *
 * 【使用示例】
 * ```ts
 * import { loginApi, registerApi } from "@/api/modules/auth";
 * const result = await loginApi({ email, password });
 * ```
 *
 * 【错误处理】
 * 每个函数内部都 try-catch 网络错误，
 * 返回统一的 ApiResponse 格式，调用方直接判断 success 字段。
 */

import client from "../client";
import type { ApiResponse, AuthResult, LoginParams, RegisterParams } from "../types";

// ============================================================
// API 请求函数
// ============================================================

/**
 * 用户登录（统一入口）
 *
 * POST /api/auth/login
 *
 * 【统一登录入口】
 * 前端只有一个「账号」输入框，用户填邮箱 / 手机号 / 用户名都行，
 * 这里原样以 identifier 发给后端，由后端 resolveIdentifier 判定具体类型。
 * 前端不做类型判定后再拆成不同字段——避免前后端判定规则漂移。
 *
 * @param params - { identifier, password }
 * @returns 成功返回 token + 用户信息，失败返回错误信息
 */
export async function loginApi(
  params: LoginParams
): Promise<ApiResponse<AuthResult>> {
  try {
    return await client.post("/api/auth/login", params);
  } catch (error: any) {
    // 网络/超时错误在拦截器中已处理，这里兜底返回友好错误
    return {
      success: false,
      message: error?.message || "登录失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 用户注册
 *
 * POST /api/auth/register
 *
 * @param params - 邮箱、密码、可选用户名（登录账号）、可选昵称
 * @returns 成功返回 token + 用户信息，失败返回错误信息
 */
export async function registerApi(
  params: RegisterParams
): Promise<ApiResponse<AuthResult>> {
  try {
    return await client.post("/api/auth/register", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "注册失败，请稍后重试",
      code: error?.code,
    };
  }
}
