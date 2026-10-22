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
import type {
  ApiResponse,
  AuthResult,
  LoginParams,
  RegisterParams,
  SendCodeParams,
  SendCodeResult,
  LoginByCodeParams,
  ForgotPasswordParams,
  CaptchaResult,
  CaptchaStatusResult,
} from "../types";

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

/**
 * 获取图形验证码。
 *
 * GET /api/auth/captcha
 *
 * @returns { captchaId, svg }
 */
export async function getCaptchaApi(): Promise<ApiResponse<CaptchaResult>> {
  try {
    return await client.get("/api/auth/captcha");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取图形验证码失败",
      code: error?.code,
    };
  }
}

/**
 * 预检下一次发送验证码是否需要图形验证码。
 *
 * GET /api/auth/captcha-status
 *
 * 【用途】
 * 进入验证码表单时调用：required=true 就提前展示图形验证码输入区，
 * 让用户「先完成人机验证、再点获取验证码」，而不是点了获取才被拦截。
 *
 * @returns { required } 是否需要图形验证码
 */
export async function getCaptchaStatusApi(): Promise<
  ApiResponse<CaptchaStatusResult>
> {
  try {
    return await client.get("/api/auth/captcha-status");
  } catch (error: any) {
    // 预检失败不阻塞主流程：按「不需要」处理，发送时后端仍会兜底校验
    return {
      success: false,
      message: error?.message || "预检图形验证码失败",
      code: error?.code,
    };
  }
}

/**
 * 发送验证码（登录 / 找回密码）。
 *
 * POST /api/auth/send-code
 *
 * @param params - { identifier, scene, captchaId?, captchaText? }
 * @returns { expiresIn } 秒
 */
export async function sendCodeApi(
  params: SendCodeParams
): Promise<ApiResponse<SendCodeResult>> {
  try {
    return await client.post("/api/auth/send-code", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "发送验证码失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 验证码登录。
 *
 * POST /api/auth/login-by-code
 *
 * @param params - { identifier, code }
 * @returns 成功返回 token + 用户信息
 */
export async function loginByCodeApi(
  params: LoginByCodeParams
): Promise<ApiResponse<AuthResult>> {
  try {
    return await client.post("/api/auth/login-by-code", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "登录失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 忘记密码：验证码 + 新密码。
 *
 * POST /api/auth/reset-password
 *
 * @param params - { identifier, code, newPassword }
 */
export async function resetPasswordApi(
  params: ForgotPasswordParams
): Promise<ApiResponse<null>> {
  try {
    return await client.post("/api/auth/reset-password", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "重置密码失败，请稍后重试",
      code: error?.code,
    };
  }
}
