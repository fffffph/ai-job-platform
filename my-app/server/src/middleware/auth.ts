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
 * 3. 校验载荷完整性（必须有 sub），挂载 { id, email } 到 req.user 后 next()
 * 4. 校验失败 → 返回 401 { success: false, message, code }
 *
 * 【配套】
 * - req.user 的类型由 src/types/express.d.ts 通过声明合并补上，
 *   本文件因此不需要 (req as any) 断言；
 * - 业务侧取用户 ID 一律用本文件导出的 requireUser(req, res)，
 *   不要各自重复写 401 判断。
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * JWT 签名密钥（与服务层 auth.service.ts 中一致）
 */
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

/**
 * 认证用户信息
 *
 * 类型增强声明见 src/types/express.d.ts：
 * req.user 的类型就是 AuthUser | undefined。
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
      sub?: string; // 用户 ID（auth.service.ts 中定义的 subject）
      email?: string;
    };

    // ---------- 步骤 3：校验载荷完整性 ----------
    /**
     * 签名有效 ≠ 载荷可用。
     * 若 Token 缺少 sub，就无法定位用户，必须在这里直接拒绝；
     * 否则下游会拿到空 userId 继续执行业务逻辑（越权读写他人数据）。
     */
    if (typeof decoded.sub !== "string" || !decoded.sub) {
      res.status(401).json({
        success: false,
        message: "Token 无效，请重新登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    // ---------- 步骤 4：挂载用户信息 ----------
    // 将用户信息挂载到 req 上，后续 Controller 通过 req.user 访问
    req.user = {
      id: decoded.sub,
      email: decoded.email ?? "",
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

/**
 * 读取当前用户 ID（不写响应）
 *
 * 仅做读取，未登录时返回 null。
 * 适合「拿不到用户也不算错误」的场景（如日志、可选的画像读取）。
 */
export function getUserId(req: Request): string | null {
  // 空字符串同样视为未登录，避免下游拿到 "" 去查库
  return req.user?.id || null;
}

/**
 * 保证「已登录」的统一守卫：取出用户 ID，未登录时直接写出 401 响应。
 *
 * 【使用方式】（必须是守卫式调用，才能拿到收窄后的 string）
 * ```ts
 * const userId = requireUser(req, res);
 * if (!userId) return;   // 未登录：401 已写出，直接结束
 * ```
 *
 * 【为什么 authMiddleware 之后还需要它】
 * 1. 类型收窄：req.user?.id 是 string | undefined，而下游服务要求 string；
 * 2. 防御兜底：万一某条路由漏挂 authMiddleware，或 Token 载荷缺 sub，
 *    这里能统一拦住，而不是带着空 userId 继续查库；
 * 3. 收敛重复：401 的响应体全项目只此一份，改文案只改这里。
 *
 * 【注意】
 * 它必须在写响应头之前调用。SSE 场景（如 ai.routes.ts）要在
 * createSSEWriter(res) 之前使用，否则 401 只能通过 error 事件下发。
 *
 * @returns 已登录返回 userId；未登录时已写出 401 并返回 null
 */
export function requireUser(req: Request, res: Response): string | null {
  const userId = getUserId(req);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return null;
  }

  return userId;
}
