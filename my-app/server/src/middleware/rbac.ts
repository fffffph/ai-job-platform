/**
 * ============================================
 * RBAC 权限中间件（Role-Based Access Control）
 * ============================================
 *
 * 【职责】
 * 在 JWT 认证（authMiddleware）之后，做「角色级」的权限校验。
 * authMiddleware 负责"验票"（确认你是谁），本模块负责"授权"（确认你能不能做）。
 *
 * 【设计说明】
 * - 角色用「代码 code」判断（admin / user），不用中文名，
 *   避免业务逻辑与展示文案耦合。
 * - 中间件可扩展：后期可细化为 requirePermission("config:write")
 *   等更细粒度的权限点，当前先用角色粒度满足需求。
 *
 * 【使用方式】
 * import { requireRole } from "../middleware/rbac.js";
 * router.put("/config", authMiddleware, requireRole("admin"), handler);
 * // 读接口对所有登录用户开放，只挂 authMiddleware，不挂 requireRole
 *
 * 【错误码约定】
 * - 401 UNAUTHORIZED : 未登录（理论上 authMiddleware 已拦截，这里兜底）
 * - 403 FORBIDDEN    : 已登录但角色不满足，无权限执行此操作
 */

import type { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import { requireUser } from "./auth.js";

/**
 * 系统预置角色代码常量
 *
 * 集中定义，业务代码一律引用这里，避免魔法字符串散落各处。
 */
export const ROLE_CODES = {
  /** 管理员：可增删改查系统配置等管理操作 */
  ADMIN: "admin",
  /** 普通用户：默认角色，使用业务功能 */
  USER: "user",
} as const;

/**
 * 查询指定用户的角色代码列表
 *
 * 通过 user_roles 关联表 join 出角色 code。
 * 一个用户可绑多个角色，返回全部 code 供 any-match 判断。
 *
 * @param userId - 用户 ID（来自 JWT Token 的 sub 字段）
 * @returns 角色代码数组，如 ["admin"] 或 ["user"]
 */
export async function getUserRoleCodes(userId: string): Promise<string[]> {
  // join 查询 user_roles，同时取出 role.code
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: { select: { code: true } },
    },
  });

  return rows.map((row) => row.role.code);
}

/**
 * 角色校验中间件工厂
 *
 * 用法：requireRole("admin") 或 requireRole("admin", "super_admin")
 * 只要用户具备其中任意一个角色即放行。
 *
 * @param codes - 允许通过的角色代码（可变参数）
 * @returns Express 中间件函数
 */
export function requireRole(...codes: string[]) {
  // 返回真正的中间件函数（闭包捕获 codes）
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 兜底：理论上 authMiddleware 已拦截未登录请求，这里防御性校验。
      // requireUser 内部即为「取 ID + 未登录写 401」，全项目统一一份实现。
      const userId = requireUser(req, res);
      if (!userId) return;

      // 查询用户实际角色
      const roles = await getUserRoleCodes(userId);

      // any-match：具备任一允许角色即通过
      const allowed = roles.some((role) => codes.includes(role));

      if (!allowed) {
        res.status(403).json({
          success: false,
          message: "无权限执行此操作",
          code: "FORBIDDEN",
        });
        return;
      }

      // 校验通过，放行到路由处理器
      next();
    } catch (error) {
      // 数据库查询异常等，交给全局错误处理器
      next(error);
    }
  };
}
