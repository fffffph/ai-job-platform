/**
 * ============================================
 * 角色路由（Role Routes）
 * ============================================
 *
 * 【API 端点】
 * GET    /api/role/list        → 角色列表（system:role）
 * POST   /api/role             → 新增角色（system:role:create）
 * PUT    /api/role/:id         → 编辑角色（system:role:update）
 * DELETE /api/role/:id         → 删除角色（system:role:delete）
 * GET    /api/role/:id/menus   → 角色已绑定菜单 id（system:role）
 * PUT    /api/role/:id/menus   → 保存角色菜单绑定（system:role:grant）
 *
 * 【统一响应格式】
 * 成功 { success:true, message, data }；失败 { success:false, message, code }
 *
 * 【错误约定】
 * MenuValidationError → 400（资源不存在为 404）；requirePermission 未通过 → 403。
 */

import { Router, type IRouter } from "express";
import type { Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requirePermission, PERMISSION_CODES } from "../middleware/rbac.js";
import * as roleService from "../services/role.service.js";
import { MenuValidationError } from "../services/menu.service.js";

const roleRouter: IRouter = Router();

/**
 * 统一错误映射：MenuValidationError → 状态码 + code；其余交给全局错误处理器。
 */
function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof MenuValidationError) {
    res.status(error.status).json({
      success: false,
      message: error.message,
      code: error.status === 404 ? "NOT_FOUND" : "INVALID_ROLE",
    });
    return;
  }
  next(error);
}

// ============================================================
// 角色列表
// ============================================================

/**
 * GET /api/role/list
 *
 * 返回角色列表（含关联用户数、绑定菜单数；admin 的 menuCount 为 null）。
 */
roleRouter.get(
  "/list",
  authMiddleware,
  requirePermission(PERMISSION_CODES.SYSTEM_ROLE),
  async (_req, res, next) => {
    try {
      const data = await roleService.listRoles();
      res.status(200).json({ success: true, message: "获取成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * GET /api/role/:id/menus
 *
 * 返回角色已绑定的菜单 id 列表。
 */
roleRouter.get(
  "/:id/menus",
  authMiddleware,
  requirePermission(PERMISSION_CODES.SYSTEM_ROLE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const menuIds = await roleService.getRoleMenuIds(id);
      res.status(200).json({ success: true, message: "获取成功", data: { menuIds } });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * POST /api/role
 *
 * 新增角色。
 */
roleRouter.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSION_CODES.ROLE_CREATE),
  async (req, res, next) => {
    try {
      const { code, name, description } = req.body ?? {};
      const data = await roleService.createRole({ code, name, description });
      res.status(200).json({ success: true, message: "新增成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/role/:id
 *
 * 编辑角色（code 不可修改）。
 */
roleRouter.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.ROLE_UPDATE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const { name, description, code } = req.body ?? {};
      const data = await roleService.updateRole(id, { name, description, code });
      res.status(200).json({ success: true, message: "保存成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * DELETE /api/role/:id
 *
 * 删除角色（内置角色 / 仍有用户的角色拒绝）。
 */
roleRouter.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.ROLE_DELETE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      await roleService.deleteRole(id);
      res.status(200).json({ success: true, message: "删除成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/role/:id/menus
 *
 * 保存角色-菜单绑定（全量重写）。admin 角色拒绝。
 */
roleRouter.put(
  "/:id/menus",
  authMiddleware,
  requirePermission(PERMISSION_CODES.ROLE_GRANT),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const menuIds: string[] = Array.isArray(req.body?.menuIds) ? req.body.menuIds : [];
      await roleService.setRoleMenus(id, menuIds);
      res.status(200).json({ success: true, message: "保存成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

export default roleRouter;
