/**
 * ============================================
 * 系统配置路由（Config Routes）
 * ============================================
 *
 * 【API 端点与权限】
 * 读接口 —— 对所有登录用户开放（authMiddleware）：
 *   GET    /api/config        → 全部配置项的有效状态（一次渲染用）
 *   GET    /api/config/:key   → 单读某配置项的有效值
 *
 * 写接口 —— 仅管理员（authMiddleware + requireRole("admin")）：
 *   POST   /api/config        → 新增动态配置 { key, type, value, label?, description?, enabled? }
 *   PUT    /api/config        → 批量保存覆盖值 { items: [{ key, value, enabled? }] }
 *   PUT    /api/config/:key   → 单条保存 { value, enabled? }
 *   DELETE /api/config        → 清空全部覆盖值（恢复默认）
 *   DELETE /api/config/:key   → 单条恢复默认
 *
 * 【权限口径】（用户确认）
 * - 配置「读」开放给所有登录用户（供前端 window 单例与菜单渲染）；
 * - 配置「写/删」严格限管理员，非管理员返回 403。
 *
 * 【错误约定】
 * - ConfigValidationError（key 未注册/类型不符/范围越界）→ 400
 * - requireRole 未通过 → 403 FORBIDDEN
 * - 其余系统错误 → 走全局 errorHandler（500）
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, ROLE_CODES } from "../middleware/rbac.js";
import {
  getEffectiveConfigs,
  getConfig,
  setConfig,
  setConfigs,
  createConfig,
  resetConfig,
  resetAllConfigs,
  ConfigValidationError,
} from "../config/config-service.js";

const configRouter: IRouter = Router();

// ============================================================
// 读接口（所有登录用户）
// ============================================================

/**
 * GET /api/config
 *
 * 返回全部配置项的有效状态列表（含默认值、当前值、是否覆盖、是否启用），
 * 前端「系统设置」页一次拉取后渲染，登录后的 window 单例也用它。
 */
configRouter.get("/", authMiddleware, async (_req, res, next) => {
  try {
    const items = await getEffectiveConfigs();
    res.status(200).json({
      success: true,
      message: "获取成功",
      data: items,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/config/:key
 *
 * 单读某配置项的有效值。
 */
configRouter.get("/:key", authMiddleware, async (req, res, next) => {
  try {
    const key = req.params.key as string;
    const value = await getConfig(key);
    res.status(200).json({
      success: true,
      message: "获取成功",
      data: { key, value },
    });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "INVALID_CONFIG",
      });
      return;
    }
    next(error);
  }
});

// ============================================================
// 写接口（仅管理员）
// ============================================================

/**
 * POST /api/config
 *
 * Body: { key, type, value, label?, description?, enabled? }
 * 新增动态配置（自定义 key）。key 必须全新（注册表内建项与 DB 已有项均冲突即拒绝），
 * 不允许覆盖已存在的 key。校验 key 命名格式 + 类型白名单 + 值类型。
 */
configRouter.post(
  "/",
  authMiddleware,
  requireRole(ROLE_CODES.ADMIN),
  async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      const { key, type, value, label, description, enabled } = req.body ?? {};

      if (!key || typeof key !== "string") {
        res.status(400).json({
          success: false,
          message: "请提供配置键 key",
          code: "INVALID_CONFIG",
        });
        return;
      }
      if (value === undefined) {
        res.status(400).json({
          success: false,
          message: "请提供配置值 value",
          code: "INVALID_CONFIG",
        });
        return;
      }

      await createConfig({ key, type, value, label, description, enabled }, userId);
      res.status(200).json({ success: true, message: "新增成功" });
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: "INVALID_CONFIG",
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * PUT /api/config
 *
 * Body: { items: [{ key, value, enabled? }] }
 * 批量保存覆盖值。整体校验，任一非法则全部不写（事务）。
 */
configRouter.put(
  "/",
  authMiddleware,
  requireRole(ROLE_CODES.ADMIN),
  async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      // 前端约定传 { items: [...] }，兼容直接传数组
      const items = req.body?.items ?? req.body;

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          success: false,
          message: "请提供要保存的配置项数组 { items: [{ key, value, enabled? }] }",
          code: "INVALID_CONFIG",
        });
        return;
      }

      await setConfigs(items, userId);
      res.status(200).json({ success: true, message: "保存成功" });
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: "INVALID_CONFIG",
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * PUT /api/config/:key
 *
 * Body: { value, enabled? }
 * 单条保存覆盖值。
 */
configRouter.put(
  "/:key",
  authMiddleware,
  requireRole(ROLE_CODES.ADMIN),
  async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      const key = req.params.key as string;
      const { value, enabled } = req.body;

      if (value === undefined) {
        res.status(400).json({
          success: false,
          message: "请提供要保存的值 value",
          code: "INVALID_CONFIG",
        });
        return;
      }

      await setConfig(key, value, enabled ?? true, userId);
      res.status(200).json({ success: true, message: "保存成功" });
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: "INVALID_CONFIG",
        });
        return;
      }
      next(error);
    }
  }
);

/**
 * DELETE /api/config
 *
 * 清空全部覆盖值（全部恢复默认）。
 */
configRouter.delete(
  "/",
  authMiddleware,
  requireRole(ROLE_CODES.ADMIN),
  async (_req, res, next) => {
    try {
      await resetAllConfigs();
      res.status(200).json({ success: true, message: "已恢复全部默认值" });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/config/:key
 *
 * 单条恢复默认（删除该 key 的覆盖行）。
 */
configRouter.delete(
  "/:key",
  authMiddleware,
  requireRole(ROLE_CODES.ADMIN),
  async (req, res, next) => {
    try {
      const key = req.params.key as string;
      await resetConfig(key);
      res.status(200).json({ success: true, message: "已恢复默认值" });
    } catch (error) {
      next(error);
    }
  }
);

export default configRouter;
