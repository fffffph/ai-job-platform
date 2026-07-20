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
 */

import type { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service.js";
import type { RegisterRequest, LoginRequest } from "../types/index.js";

// ============================================================
// 注册控制器
// ============================================================

/**
 * POST /api/auth/register
 *
 * 【请求体】
 * {
 *   "email": "user@example.com",    // 必填，邮箱
 *   "password": "123456",           // 必填，密码（明文）
 *   "name": "张三"                  // 可选，昵称
 * }
 *
 * 【成功响应】
 * 201 Created
 * {
 *   "success": true,
 *   "message": "注册成功",
 *   "data": {
 *     "token": "eyJhbGciOi...",
 *     "user": { "id": "uuid", "email": "...", "name": "..." }
 *   }
 * }
 *
 * 【失败响应】
 * 400 Bad Request — 参数校验不通过
 * 409 Conflict     — 邮箱已被注册
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ---------- 步骤 1：提取请求参数 ----------
    const { email, password, name } = req.body as RegisterRequest;

    // ---------- 步骤 2：参数校验 ----------
    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: "邮箱和密码为必填项",
      });
      return;
    }

    // 邮箱格式简单校验
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        message: "邮箱格式不正确",
      });
      return;
    }

    // 密码长度校验（至少 6 位）
    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: "密码长度不能少于 6 位",
      });
      return;
    }

    // ---------- 步骤 3：调用 Service 层 ----------
    const result = await authService.register({ email, password, name });

    // ---------- 步骤 4：返回成功响应 ----------
    res.status(201).json({
      success: true,
      message: "注册成功",
      data: result,
    });
  } catch (error: any) {
    // ---------- 错误处理 ----------
    // 如果是"已被注册"错误，返回 409 Conflict
    if (error.message?.includes("已被注册")) {
      res.status(409).json({
        success: false,
        message: error.message,
        code: "EMAIL_EXISTS",
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
 *   "email": "user@example.com",    // 必填，邮箱
 *   "password": "123456"            // 必填，密码（明文）
 * }
 *
 * 【成功响应】
 * 200 OK
 * {
 *   "success": true,
 *   "message": "登录成功",
 *   "data": {
 *     "token": "eyJhbGciOi...",
 *     "user": { "id": "uuid", "email": "...", "name": "..." }
 *   }
 * }
 *
 * 【失败响应】
 * 400 Bad Request — 参数校验不通过
 * 401 Unauthorized — 邮箱或密码错误
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ---------- 步骤 1：提取请求参数 ----------
    const { email, password } = req.body as LoginRequest;

    // ---------- 步骤 2：参数校验 ----------
    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: "邮箱和密码为必填项",
      });
      return;
    }

    // ---------- 步骤 3：调用 Service 层 ----------
    const result = await authService.login({ email, password });

    // ---------- 步骤 4：返回成功响应 ----------
    res.status(200).json({
      success: true,
      message: "登录成功",
      data: result,
    });
  } catch (error: any) {
    // ---------- 错误处理 ----------
    // "邮箱或密码错误" → 返回 401 Unauthorized
    if (error.message?.includes("邮箱或密码错误")) {
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
