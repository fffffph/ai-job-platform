/**
 * ============================================
 * 用户控制器模块（User Controller）
 * ============================================
 *
 * 【职责】
 * 接收 HTTP 请求 → 参数校验 → 调用 Service → 返回 JSON 响应。
 * 所有需要登录的端点都经过 authMiddleware 保护，
 * 用户 ID 从 req.user.id 获取（由中间件挂载）。
 */

import type { Request, Response, NextFunction } from "express";
import * as userService from "../services/user.service.js";
import * as deepseekKeyService from "../services/deepseekKey.service.js";

// ============================================================
// 获取用户资料
// ============================================================

/**
 * GET /api/user/profile
 *
 * 返回当前登录用户的公开信息（不含密码）。
 * 需要 JWT 认证（authMiddleware 已挂载用户 ID 到 req.user）。
 */
export async function getProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 从中间件挂载的 user 对象中提取 ID
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "未登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    const profile = await userService.getProfile(userId);

    res.status(200).json({
      success: true,
      message: "获取成功",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

// ============================================================
// 更新用户资料
// ============================================================

/**
 * PUT /api/user/profile
 *
 * Body: { name?: string, bio?: string }
 * 仅更新传入的字段，未传入的保持原值。
 * email 不可通过此接口修改。
 */
export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "未登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    // 提取可更新的字段
    const { name, bio } = req.body;

    // 至少传一个字段
    if (name === undefined && bio === undefined) {
      res.status(400).json({
        success: false,
        message: "请至少提供一个要修改的字段（name 或 bio）",
      });
      return;
    }

    const profile = await userService.updateProfile(userId, {
      name,
      bio,
    });

    res.status(200).json({
      success: true,
      message: "修改成功",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

// ============================================================
// 修改密码
// ============================================================

/**
 * PUT /api/user/password
 *
 * Body: { oldPassword: string, newPassword: string }
 * 验证旧密码后，用 bcrypt 加密新密码并更新数据库。
 */
export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "未登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    const { oldPassword, newPassword } = req.body;

    // 参数校验
    if (!oldPassword || !newPassword) {
      res.status(400).json({
        success: false,
        message: "旧密码和新密码均为必填项",
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        message: "新密码长度不能少于 6 位",
      });
      return;
    }

    await userService.changePassword(userId, oldPassword, newPassword);

    res.status(200).json({
      success: true,
      message: "密码修改成功",
    });
  } catch (error: any) {
    // 旧密码不正确 → 返回 400
    if (error.message?.includes("旧密码不正确")) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "WRONG_PASSWORD",
      });
      return;
    }
    next(error);
  }
}

// ============================================================
// DeepSeek API Key 管理
// ============================================================

/**
 * GET /api/user/deepseek-key
 *
 * 获取当前用户的 DeepSeek API Key 状态（脱敏，绝不含明文）。
 */
export async function getDeepSeekKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
      return;
    }

    const status = await deepseekKeyService.getKeyStatus(userId);
    res.status(200).json({ success: true, message: "获取成功", data: status });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/user/deepseek-key
 *
 * Body: { apiKey: string }
 * 校验格式后加密存储。返回脱敏状态。
 */
export async function saveDeepSeekKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
      return;
    }

    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ success: false, message: "请输入 DeepSeek API Key" });
      return;
    }

    // 格式校验失败（前缀/长度）→ 返回 400 明确提示
    try {
      deepseekKeyService.validateKeyFormat(apiKey);
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message, code: "INVALID_KEY_FORMAT" });
      return;
    }

    const status = await deepseekKeyService.saveKey(userId, apiKey);
    res.status(200).json({ success: true, message: "API Key 保存成功", data: status });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/user/deepseek-key
 *
 * 清空当前用户的 DeepSeek API Key。
 */
export async function deleteDeepSeekKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
      return;
    }

    await deepseekKeyService.deleteKey(userId);
    res.status(200).json({ success: true, message: "API Key 已删除" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/user/deepseek-key/test
 *
 * Body: { apiKey: string }
 * 测试传入的 Key 是否有效（不落库，仅连通性测试）。
 */
export async function testDeepSeekKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
      return;
    }

    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ success: false, message: "请输入要测试的 API Key" });
      return;
    }

    try {
      deepseekKeyService.validateKeyFormat(apiKey);
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message, code: "INVALID_KEY_FORMAT" });
      return;
    }

    const result = await deepseekKeyService.testKey(apiKey);
    res.status(200).json({ success: true, message: result.message, data: result });
  } catch (error) {
    next(error);
  }
}
