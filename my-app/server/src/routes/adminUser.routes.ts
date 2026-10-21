/**
 * ============================================
 * 用户管理路由（Admin User Routes）
 * ============================================
 *
 * 【挂载】/api/user（与用户自助路由 userRouter 共享前缀，按注册顺序互补）
 *
 * 【API 端点】
 * GET  /api/user/list            → 用户列表（分页 + 关键字，system:user）
 * GET  /api/user/check-identity  → 标识唯一性即时校验（system:user）
 * POST /api/user                 → 新增用户（system:user:create）
 * PUT  /api/user/:id/roles       → 分配角色（system:user:grant）
 * PUT  /api/user/:id/status      → 停用/启用（system:user:disable）
 *
 * 【路由顺序说明】
 * `/check-identity` 这类「字面量路径」必须写在 `/:id` 形式的动态路由之前，
 * 否则会被 :id 捕获。当前本文件没有 GET /:id，仍保持此约定以防后续新增时踩坑。
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
 * GET /api/user/check-identity?field=email&value=xxx[&excludeUserId=yyy]
 *
 * 登录标识唯一性即时校验（供「新增用户」表单在输入框失焦时提示）。
 *
 * 【excludeUserId 的用途】
 * 编辑用户时前端传入目标用户自己的 id，让后端在查重时排除自己，
 * 否则「未改动」的标识会命中自己、被误判为已占用。
 *
 * 【为什么不给这个接口做免登录】
 * 免登录的唯一性查询等价于一个「账号是否存在」的探测接口，
 * 可被用来批量枚举系统里的用户，因此必须要求 system:user 权限。
 */
adminUserRouter.get(
  "/check-identity",
  authMiddleware,
  requirePermission(PERMISSION_CODES.SYSTEM_USER),
  async (req, res, next) => {
    try {
      const field = (req.query.field as string) || "";
      const value = (req.query.value as string) || "";
      const excludeUserId = (req.query.excludeUserId as string) || undefined;

      if (!["email", "phone", "username"].includes(field)) {
        res.status(400).json({
          success: false,
          message: "field 仅支持 email / phone / username",
          code: "INVALID_USER",
        });
        return;
      }

      const data = await userAdminService.checkIdentifier(
        field as "email" | "phone" | "username",
        value,
        excludeUserId
      );
      res.status(200).json({ success: true, message: "获取成功", data });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * POST /api/user
 *
 * 新增用户（B-P0）。
 *
 * Body: {
 *   email?, phone?, username?,   // 三个登录标识至少填一个
 *   name?, remark?,
 *   passwordMode?: 'default' | 'custom',   // 默认 default（用系统默认密码）
 *   password?,                             // passwordMode='custom' 时必填
 *   roleIds?: string[],                    // 为空则默认绑定 user 角色
 *   status?: 'active' | 'disabled',
 *   mustChangePassword?: boolean
 * }
 *
 * 【提权防护】操作者 id 从服务端会话（JWT）取，传入 service 校验：
 * 分配 admin 角色者必须是 admin 本人。
 *
 * 【返回】绝不包含 password 哈希；使用系统默认密码时返回
 * usedDefaultPassword=true，前端据此提示管理员。
 */
adminUserRouter.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_CREATE),
  async (req, res, next) => {
    try {
      const operatorId = requireUser(req, res);
      if (!operatorId) return;

      const body = (req.body ?? {}) as Record<string, unknown>;

      const data = await userAdminService.createUser(operatorId, {
        email: (body.email as string) ?? null,
        phone: (body.phone as string) ?? null,
        username: (body.username as string) ?? null,
        name: (body.name as string) ?? null,
        remark: (body.remark as string) ?? null,
        passwordMode: body.passwordMode as "default" | "custom" | undefined,
        password: (body.password as string) ?? null,
        roleIds: Array.isArray(body.roleIds) ? (body.roleIds as string[]) : [],
        status: body.status as UserStatus | undefined,
        mustChangePassword:
          typeof body.mustChangePassword === "boolean"
            ? body.mustChangePassword
            : undefined,
      });

      res.status(201).json({
        success: true,
        message: "用户创建成功",
        data,
      });
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

/**
 * PUT /api/user/:id
 *
 * 编辑用户（B-P1）。Body: { email?, phone?, name?, remark?, mustChangePassword? }
 *
 * 【边界】
 * - 不含角色（走 /:id/roles）、不含状态（走 /:id/status）；
 * - 邮箱/手机号 PATCH 语义：undefined=保持，""/null=清空（至少保留一个）；
 * - username 仅在目标用户尚未设置时允许提交（验证码自动注册账号补设一次）；
 *   已有用户名的用户即使传了也会被 service 层强制沿用现值（不可修改）。
 */
adminUserRouter.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_UPDATE),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const body = (req.body ?? {}) as Record<string, unknown>;

      await userAdminService.updateUser(id, {
        username:
          body.username === undefined
            ? undefined
            : (body.username as string | null),
        email: body.email === undefined ? undefined : (body.email as string | null),
        phone: body.phone === undefined ? undefined : (body.phone as string | null),
        name: body.name === undefined ? undefined : (body.name as string | null),
        remark:
          body.remark === undefined ? undefined : (body.remark as string | null),
        mustChangePassword:
          typeof body.mustChangePassword === "boolean"
            ? body.mustChangePassword
            : undefined,
      });

      res.status(200).json({ success: true, message: "保存成功", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * PUT /api/user/:id/reset-password
 *
 * 重置密码（B-P1）。Body: { passwordMode?: 'default'|'custom', password? }
 * 重置后该账号 tokenVersion++（踢下线）+ mustChangePassword=true。
 */
adminUserRouter.put(
  "/:id/reset-password",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_RESET_PASSWORD),
  async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const body = (req.body ?? {}) as Record<string, unknown>;

      await userAdminService.resetPassword(id, {
        passwordMode: body.passwordMode as "default" | "custom" | undefined,
        password: (body.password as string) ?? null,
      });

      res.status(200).json({ success: true, message: "密码已重置", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

/**
 * DELETE /api/user/:id
 *
 * 删除用户（B-P1，软删除）。
 * 禁止删除当前登录的自己；禁止删除最后一个 admin。
 */
adminUserRouter.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSION_CODES.USER_DELETE),
  async (req, res, next) => {
    try {
      const operatorId = requireUser(req, res);
      if (!operatorId) return;

      const id = req.params.id as string;
      await userAdminService.softDeleteUser(id, operatorId);
      res.status(200).json({ success: true, message: "用户已删除", data: null });
    } catch (error) {
      handleError(error, res, next);
    }
  }
);

export default adminUserRouter;
