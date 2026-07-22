/**
 * ============================================
 * JWT 认证中间件
 * ============================================
 *
 * 【职责】
 * 验证请求中的 JWT Token，提取用户信息挂载到 req.user 上。
 * 所有需要登录才能访问的路由都应使用此中间件保护。
 *
 * 【使用方式】
 * import { authMiddleware } from "../middleware/auth.js";
 * router.get("/profile", authMiddleware, controller.getProfile);
 *
 * 【Token 格式】
 * 前端在 Authorization 头中携带：
 * Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
 *
 * 【工作流程】
 * 1. 从 Authorization 头提取 Bearer Token
 * 2. 使用 jwt.verify() 验证签名和过期时间
 * 3. 校验通过 → 挂载 { id, email } 到 req 上，调用 next() 放行
 * 4. 校验失败 → 返回 401 { success: false, message, code }
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * JWT 签名密钥（与服务层 auth.service.ts 中一致）
 */
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

/**
 * 扩展 Express Request 类型，添加 user 属性
 * 路由处理器可以通过 (req as any).user 或声明合并来访问
 */
export interface AuthUser {
  id: string;
  email: string;
}

/**
 * 认证中间件
 *
 * 必须在所有需要保护的 Controller 之前使用。
 * 中间件只负责"验票"，不关心用户的具体权限（权限逻辑在 Controller/Service 层处理）。
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // ---------- 步骤 1：提取 Token ----------
  const authHeader = req.headers.authorization;

  // 检查 Authorization 头是否存在
  if (!authHeader) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // 提取 Bearer Token（按空格分割，取第二部分）
  // 格式：Bearer eyJhbGciOi...
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({
      success: false,
      message: "Token 格式错误",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = parts[1];

  // ---------- 步骤 2：验证 Token ----------
  try {
    /**
     * jwt.verify(token, secret) 返回解码后的 payload
     * 如果 Token 过期或签名不匹配，会抛出 JsonWebTokenError / TokenExpiredError
     */
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string; // 用户 ID（auth.service.ts 中定义的 subject）
      email: string;
    };

    // ---------- 步骤 3：挂载用户信息 ----------
    // 将用户信息挂载到 req 上，后续 Controller 通过 req.user 访问
    (req as any).user = {
      id: decoded.sub,
      email: decoded.email,
    } satisfies AuthUser;

    // Token 有效，放行到下一个中间件/路由处理器
    next();
  } catch (error: any) {
    // ---------- Token 校验失败 ----------
    // 区分过期和无效两种情况
    if (error.name === "TokenExpiredError") {
      res.status(401).json({
        success: false,
        message: "登录已过期，请重新登录",
        code: "TOKEN_EXPIRED",
      });
      return;
    }

    // 其他校验失败（签名不匹配等）
    res.status(401).json({
      success: false,
      message: "Token 无效，请重新登录",
      code: "UNAUTHORIZED",
    });
    return;
  }
}
