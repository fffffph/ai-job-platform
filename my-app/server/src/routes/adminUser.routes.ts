/**
 * ============================================
 * 用户管理路由（Admin User Routes）
 * ============================================
 *
 * 【挂载】/api/user（与用户自助路由 userRouter 共享前缀，按注册顺序互补）
 *
 * 【API 端点】
 * GET  /api/user/list           → 用户列表（分页 + 关键字，system:user）
 * PUT  /api/user/:id/roles      → 分配角色（system:user:grant）
 * PUT  /api/user/:id/status     → 停用/启用（system:user:disable）
 *
 * 【统一响应格式】
 * 成功 { success:true, message, data }；失败 { success:false, message, code }
 *
 * 【错误约定】
 * MenuValidationError → 400（资源不存在为 404）；requirePermission 未通过 → 403。
 */

import { Router, type IRouter } from "express";
import type { Response, NextFunction } from "express";
import { authMiddleware, requireUser } from "../middleware/auth.js";
import { requirePermission, PERMISSION_CODES } from "../middleware/rbac.js";
import * as userAdminService from "../services/userAdmin.service.js";
import { MenuValidationError } from "../services/menu.service.js";
import type { UserStatus } from "../types/index.js";

const adminUserRouter: IRouter = Router();

/**
 * 统一错误映射：MenuValidationError → 状态码 + code；其余交给全局错误处理器。
 */
function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof MenuValidationError) {
    res.status(error.status).json({
      success: false,
      message: error.message,
      code: error.status === 404 ? "NOT_FOUND" : "INVALID_USER",
    });
    return;
  }
  next(error);
}

// ============================================================
// 用户列表（system:user）
// ============================================================

/**
 * GET /api/user/list?keyword=&page=1&pageSize=10
 *
 * 返回用户列表（含角色、状态、注册时间）。
 */
adminUserRouter.get(
  "/list",
  authMiddleware,
  requirePermission(PERMISSION_CODES.SYSTEM_USER),
  async (req, res, next) => {
    try {
      const keyword = (req.query.keyword as string) || undefined;
      const page = req.query.page ? Number(req.query.page) : undefined;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

      const data = await userAdminService.listUsers({ keyword, page, pageSize });
      res.status(200).json({ success: true, message: "获取成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/user/:id/roles
 *
 * 分配角色（全量重写）。Body: { roleIds: string[] }
 *
 * 【提权防护】操作者 id 从服务端会话（JWT）取，传入 service 校验：
 * 分配 admin 角色者必须是 admin 本人。
 */
adminUserRouter.put(
  "/:id/roles",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_GRANT),
  async (req, res, next) => {
    try {
      // 从服务端会话取操作者 id（绝不信前端传参）
      const operatorId = requireUser(req, res);
      if (!operatorId) return;

      const id = req.params.id as string;
      const roleIds: string[] = Array.isArray(req.body?.roleIds) ? req.body.roleIds : [];
      await userAdminService.assignRoles(operatorId, id, roleIds);
      res.status(200).json({ success: true, message: "保存成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/user/:id/status
 *
 * 停用/启用账号。Body: { status: 'active' | 'disabled' }
 * 不允许停用当前登录的自己。
 */
adminUserRouter.put(
  "/:id/status",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_DISABLE),
  async (req, res, next) => {
    try {
      const operatorId = requireUser(req, res);
      if (!operatorId) return;

      const id = req.params.id as string;
      const status = req.body?.status as UserStatus;
      await userAdminService.setStatus(id, status, operatorId);
      res.status(200).json({ success: true, message: "保存成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

export default adminUserRouter;
