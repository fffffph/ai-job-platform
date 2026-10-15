/**
 * ============================================
 * 用户控制器模块（User Controller）
 * ============================================
 *
 * 【职责】
 * 接收 HTTP 请求 → 参数校验 → 调用 Service → 返回 JSON 响应。
 * 所有需要登录的端点都经过 authMiddleware 保护；
 * 用户 ID 通过 requireUser(req, res) 统一获取（含类型收窄 + 401 兜底），
 * 不再逐个 handler 手写「取 ID + 判空 + 401」。
 */

import type { Request, Response, NextFunction } from "express";
import { requireUser } from "../middleware/auth.js";
import * as userService from "../services/user.service.js";
import * as deepseekKeyService from "../services/deepseekKey.service.js";
import * as siliconflowKeyService from "../services/siliconflowKey.service.js";
import { PasswordPolicyError } from "../lib/password.js";
import {
  IdentifierValidationError,
  IdentifierConflictError,
} from "../lib/identifier.js";

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
    const userId = requireUser(req, res);
    if (!userId) return;

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
    const userId = requireUser(req, res);
    if (!userId) return;

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
 *
 * 【A-P0 新增行为】
 * 改密码会执行 tokenVersion++ 吊销该用户所有旧 Token，
 * 因此响应里会带回一个**新的 Token**，前端必须覆盖本地存储，
 * 否则用户改完密码后下一个请求就会被自己的吊销机制踢下线。
 *
 * 【无密码账号】
 * 管理员代建 / 验证码登录的账号没有密码，此时 oldPassword 可省略，
 * 语义为「首次设置密码」。
 */
export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { oldPassword, newPassword } = req.body;

    // 参数校验：新密码必填；旧密码允许为空（首次设置密码场景）
    if (!newPassword) {
      res.status(400).json({
        success: false,
        message: "新密码为必填项",
        code: "PARAMS_MISSING",
      });
      return;
    }

    // 强度校验统一由 service 层负责（长度下限来自系统配置），此处不重复判断
    const result = await userService.changePassword(
      userId,
      oldPassword ?? "",
      newPassword
    );

    res.status(200).json({
      success: true,
      message: "密码修改成功",
      // 吊销旧 Token 后必须回传新 Token，前端替换本地存储
      data: result,
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
    // 新密码强度不足 → 返回 400
    if (error instanceof PasswordPolicyError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "PASSWORD_WEAK",
      });
      return;
    }
    next(error);
  }
}

// ============================================================
// 修改登录标识（邮箱 / 手机号 / 用户名）
// ============================================================

/**
 * PUT /api/user/identifiers
 *
 * Body: { password: string, email?: string|null, phone?: string|null, username?: string|null }
 *
 * 【为什么单独一个端点，而不是并进 PUT /api/user/profile】
 * profile 是「昵称/简介」这类无风险资料，改标识则是账号劫持的最高危操作，
 * 必须强制校验当前密码。两者安全等级不同，混在一起容易在后续维护中
 * 不小心把密码校验删掉，因此物理隔离成两个端点。
 *
 * 【不传的字段怎么处理】
 * 传 undefined → 本次不涉及该标识（前端表单永远传全量，因此正常流程不出现）
 * 传 "" 或 null → 清空该标识
 *
 * 【响应】
 * data.profile 为更新后的资料；若邮箱发生变更，data.token 为重新签发的 Token，
 * 前端需覆盖本地存储（保持 JWT payload 与库一致）。
 */
export async function updateIdentifiers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { password, email, phone, username } = req.body ?? {};

    const result = await userService.updateIdentifiers(userId, {
      password,
      email,
      phone,
      username,
    });

    res.status(200).json({
      success: true,
      message: "登录标识已更新",
      data: result,
    });
  } catch (error: any) {
    // 标识被他人占用 → 409（前端提示「该邮箱已被占用，请更换」）
    if (error instanceof IdentifierConflictError) {
      res.status(409).json({
        success: false,
        message: error.message,
        code: "IDENTIFIER_EXISTS",
        data: { conflictField: error.field },
      });
      return;
    }
    // 格式非法 / 三个标识全空 → 400
    if (error instanceof IdentifierValidationError) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "IDENTIFIER_INVALID",
      });
      return;
    }
    // 当前密码不正确 / 未填写 → 400
    if (
      error.message?.includes("密码不正确") ||
      error.message?.includes("请输入当前密码")
    ) {
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
// 获取当前用户角色（RBAC）
// ============================================================

/**
 * GET /api/user/roles
 *
 * 返回当前登录用户的角色代码列表（如 ["admin"] / ["user"]）。
 * 前端登录后调用，据此判断是否管理员、控制菜单显示。
 */
export async function getRoles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const roles = await userService.getUserRoles(userId);

    res.status(200).json({
      success: true,
      message: "获取成功",
      data: { roles },
    });
  } catch (error) {
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
    const userId = requireUser(req, res);
    if (!userId) return;

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
    const userId = requireUser(req, res);
    if (!userId) return;

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
    const userId = requireUser(req, res);
    if (!userId) return;

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
    const userId = requireUser(req, res);
    if (!userId) return;

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

// ============================================================
// SiliconFlow API Key 管理（与 DeepSeek Key 对称）
// ============================================================

/**
 * GET /api/user/siliconflow-key
 *
 * 获取当前用户的 SiliconFlow API Key 状态（脱敏，绝不含明文）。
 */
export async function getSiliconFlowKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const status = await siliconflowKeyService.getKeyStatus(userId);
    res.status(200).json({ success: true, message: "获取成功", data: status });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/user/siliconflow-key
 *
 * Body: { apiKey: string }
 * 校验格式后加密存储，返回脱敏状态。
 */
export async function saveSiliconFlowKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ success: false, message: "请输入 SiliconFlow API Key" });
      return;
    }

    try {
      siliconflowKeyService.validateKeyFormat(apiKey);
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message, code: "INVALID_KEY_FORMAT" });
      return;
    }

    const status = await siliconflowKeyService.saveKey(userId, apiKey);
    res.status(200).json({ success: true, message: "API Key 保存成功", data: status });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/user/siliconflow-key
 *
 * 清空当前用户的 SiliconFlow API Key。
 */
export async function deleteSiliconFlowKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    await siliconflowKeyService.deleteKey(userId);
    res.status(200).json({ success: true, message: "API Key 已删除" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/user/siliconflow-key/test
 *
 * Body: { apiKey: string }
 * 测试传入的 Key 是否有效（不落库，仅连通性测试）。
 */
export async function testSiliconFlowKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { apiKey } = req.body;
    if (!apiKey || !apiKey.trim()) {
      res.status(400).json({ success: false, message: "请输入要测试的 API Key" });
      return;
    }

    try {
      siliconflowKeyService.validateKeyFormat(apiKey);
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message, code: "INVALID_KEY_FORMAT" });
      return;
    }

    const result = await siliconflowKeyService.testKey(apiKey);
    res.status(200).json({ success: true, message: result.message, data: result });
  } catch (error) {
    next(error);
  }
}
