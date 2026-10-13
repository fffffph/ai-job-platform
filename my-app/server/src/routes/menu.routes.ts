/**
 * ============================================
 * 菜单路由（Menu Routes）
 * ============================================
 *
 * 【API 端点】
 * GET    /api/menu/my     → 当前用户菜单树 + 权限码（登录）
 * GET    /api/menu/tree   → 全量菜单（平铺数组 + parentId，system:menu）
 * POST   /api/menu        → 新增菜单（system:menu:create）
 * PUT    /api/menu/:id    → 编辑菜单（system:menu:update）
 * DELETE /api/menu/:id    → 删除菜单（system:menu:delete）
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
import { requirePermission, getUserRoleCodes, PERMISSION_CODES } from "../middleware/rbac.js";
import * as menuService from "../services/menu.service.js";
import { MenuValidationError } from "../services/menu.service.js";

const menuRouter: IRouter = Router();

/**
 * 统一错误映射：MenuValidationError → 状态码 + code；其余交给全局错误处理器。
 */
function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof MenuValidationError) {
    res.status(error.status).json({
      success: false,
      message: error.message,
      code: error.status === 404 ? "NOT_FOUND" : "INVALID_MENU",
    });
    return;
  }
  next(error);
}

// ============================================================
// 当前用户菜单（登录即可）
// ============================================================

/**
 * GET /api/menu/my
 *
 * 返回当前用户可见的侧边栏菜单树（catalog/menu，剔除 button，按 sort 升序）
 * 与其全部权限码；admin 短路返回全量。
 */
menuRouter.get("/my", authMiddleware, async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const roleCodes = await getUserRoleCodes(userId);
    const data = await menuService.getMyMenus(userId, roleCodes);

    res.status(200).json({ success: true, message: "获取成功", data });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// 菜单管理（system:menu）
// ============================================================

/**
 * GET /api/menu/tree
 *
 * 返回全量菜单（平铺数组 + parentId，含 button 与停用项），供菜单管理页使用。
 */
menuRouter.get(
  "/tree",
  authMiddleware,
  requirePermission(PERMISSION_CODES.SYSTEM_MENU),
  async (_req, res, next) => {
    try {
      const data = await menuService.getFullTree();
      res.status(200).json({ success: true, message: "获取成功", data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/menu
 *
 * 新增菜单（目录/菜单/按钮）。
 */
menuRouter.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSION_CODES.MENU_CREATE),
  async (req, res, next) => {
    try {
      const data = await menuService.createMenu(req.body);
      res.status(200).json({ success: true, message: "新增成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/menu/:id
 *
 * 编辑菜单（权限码不可修改）。
 */
menuRouter.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.MENU_UPDATE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const data = await menuService.updateMenu(id, req.body);
      res.status(200).json({ success: true, message: "保存成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * DELETE /api/menu/:id
 *
 * 删除菜单（含子节点时拒绝）。
 */
menuRouter.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.MENU_DELETE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      await menuService.deleteMenu(id);
      res.status(200).json({ success: true, message: "删除成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

export default menuRouter;
