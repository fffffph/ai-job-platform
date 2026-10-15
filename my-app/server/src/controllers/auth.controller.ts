/**
 * ============================================
 * 认证控制器模块（Auth Controller）
 * ============================================
 *
 * 【职责】
 * 作为 HTTP 请求和业务逻辑之间的桥梁：
 * - 接收 HTTP 请求，提取请求参数
 * - 参数校验（格式、必填项检查）
 * - 调用 Service 层执行业务逻辑
 * - 返回统一格式的 JSON 响应
 *
 * 【分层原则】
 * Controller 层不包含业务逻辑！
 * 所有数据处理、密码加密、Token 生成都在 Service 层完成。
 * Controller 只负责参数的"接"和结果的"传"。
 *
 * 【错误映射约定（A-P0 起）】
 * - IdentifierValidationError（标识格式非法/全空）→ 400 IDENTIFIER_INVALID
 * - PasswordPolicyError（密码强度不足）           → 400 PASSWORD_WEAK
 * - "已被注册 / 已被占用"                          → 409 IDENTIFIER_EXISTS
 * - "账号或密码错误"                               → 401 INVALID_CREDENTIALS
 * - "该账号未设置密码"                             → 400 PASSWORD_NOT_SET
 * - "账号已被停用"                                 → 403 USER_DISABLED
 */

import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import { assertPasswordStrength, PasswordPolicyError } from "../lib/password.js";
import { IdentifierValidationError } from "../lib/identifier.js";
import type { RegisterRequest, LoginRequest } from "../types/index.js";

/**
 * 取客户端 IP（用于登录审计）。
 *
 * 依次尝试：
 * 1. X-Forwarded-For 首个地址（生产环境经 nginx 反代时真实来源在此）；
 * 2. Express 解析出的 req.ip；
 * 3. 兜底 null（不写审计字段）。
 *
 * @param req - Express 请求对象
 * @returns IP 字符串或 null
 */
function getClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim() || null;
  }
  return req.ip || null;
}

// ============================================================
// 注册控制器
// ============================================================

/**
 * POST /api/auth/register
 *
 * 【请求体】
 * {
 *   "email": "user@example.com",   // 可选，登录标识之一
 *   "password": "123456ab",        // 必填，密码（明文）
 *   "username": "zhangsan",        // 可选，登录账号（3-20 位，禁止纯数字）
 *   "name": "张三"                  // 可选，昵称（仅展示）
 * }
 * 注意：email / username 至少填一个，否则账号无法登录（Service 层校验）。
 *
 * 【成功响应】201 Created
 * { "success": true, "message": "注册成功", "data": { token, user } }
 *
 * 【失败响应】
 * 400 Bad Request — 参数校验不通过 / 标识格式非法 / 密码强度不足
 * 409 Conflict    — 邮箱或用户名已被占用
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ---------- 步骤 1：提取请求参数 ----------
    const { email, password, username, name } = req.body as RegisterRequest;

    // ---------- 步骤 2：必填项校验 ----------
    // 邮箱已改为可选（三标识体系下用户名也能登录），这里只强制密码；
    // 「标识至少一个」由 Service 层 normalizeAndValidateIdentifiers 统一校验。
    if (!password) {
      res.status(400).json({
        success: false,
        message: "密码为必填项，且至少需要填写一项登录标识（邮箱 / 用户名）",
      });
      return;
    }

    // ---------- 步骤 3：密码强度校验（长度下限来自系统配置） ----------
    // 规则集中在 lib/password.ts，与「管理员新增用户」「修改密码」共用同一套。
    await assertPasswordStrength(password);

    // ---------- 步骤 4：调用 Service 层 ----------
    // 邮箱/用户名的格式校验与唯一性校验都在 Service 层完成，
    // 保证「标识规则」只有 identifier.ts 一个事实源。
    const result = await authService.register({
      email,
      password,
      username,
      name,
    });

    // ---------- 步骤 5：返回成功响应 ----------
    res.status(201).json({
      success: true,
      message: "注册成功",
      data: result,
    });
  } catch (error: any) {
    // 密码强度不足
    if (error instanceof PasswordPolicyError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "PASSWORD_WEAK",
      });
      return;
    }

    // 邮箱/用户名格式非法，或标识全空
    if (error instanceof IdentifierValidationError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "IDENTIFIER_INVALID",
      });
      return;
    }

    // 标识已被占用 → 409 Conflict
    if (error.message?.includes("已被注册") || error.message?.includes("已被占用")) {
      res.status(409).json({
        success: false,
        message: error.message,
        code: "IDENTIFIER_EXISTS",
      });
      return;
    }

    // 其他错误交给全局错误处理中间件
    next(error);
  }
}

// ============================================================
// 登录控制器
// ============================================================

/**
 * POST /api/auth/login
 *
 * 【请求体】
 * {
 *   "identifier": "user@example.com",  // 推荐：邮箱 / 手机号 / 用户名 三合一
 *   "email": "user@example.com",       // 兼容旧前端（identifier 缺省时使用）
 *   "password": "123456ab"             // 必填，密码（明文）
 * }
 *
 * 【成功响应】200 OK
 * { "success": true, "message": "登录成功", "data": { token, user } }
 *
 * 【失败响应】
 * 400 Bad Request  — 参数校验不通过 / 账号格式不正确 / 该账号未设置密码
 * 401 Unauthorized — 账号或密码错误
 * 403 Forbidden    — 账号已被停用（code: USER_DISABLED）
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ---------- 步骤 1：提取请求参数 ----------
    const { identifier, email, password } = req.body as LoginRequest;

    // 统一账号：优先 identifier，缺省回退 email（向后兼容旧前端）
    const account = identifier ?? email;

    // ---------- 步骤 2：参数校验 ----------
    if (!account || !password) {
      res.status(400).json({
        success: false,
        message: "账号和密码为必填项",
        code: "PARAMS_MISSING",
      });
      return;
    }

    // ---------- 步骤 3：调用 Service 层 ----------
    const result = await authService.login(
      { identifier: account, password },
      { ip: getClientIp(req) }
    );

    // ---------- 步骤 4：返回成功响应 ----------
    res.status(200).json({
      success: true,
      message: "登录成功",
      data: result,
    });
  } catch (error: any) {
    // 账号格式不正确（既不是邮箱也不是手机号也不是合法用户名）
    if (error instanceof IdentifierValidationError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "IDENTIFIER_INVALID",
      });
      return;
    }

    // 账号已被停用 → 403 Forbidden（P0-11，前端据此提示"请联系管理员"）
    if (error.message?.includes("账号已被停用")) {
      res.status(403).json({
        success: false,
        message: error.message,
        code: "USER_DISABLED",
      });
      return;
    }

    // 该账号没有密码（验证码/OAuth 用户、管理员未设密码的账号）
    if (error.message?.includes("未设置密码")) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "PASSWORD_NOT_SET",
      });
      return;
    }

    // "账号或密码错误" → 401 Unauthorized
    // 兼容旧文案「邮箱或密码错误」，避免遗漏
    if (
      error.message?.includes("账号或密码错误") ||
      error.message?.includes("邮箱或密码错误")
    ) {
      res.status(401).json({
        success: false,
        message: error.message,
        code: "INVALID_CREDENTIALS",
      });
      return;
    }

    // 其他错误交给全局错误处理中间件
    next(error);
  }
}
