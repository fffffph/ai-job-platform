/**
 * ============================================
 * 系统配置模块 API（Config Module）
 * ============================================
 *
 * 【职责】
 * 封装「系统配置中心」的 HTTP 请求（P2/P4）：
 * 1. 读全部配置项的有效状态（所有登录用户，供设置页 + window 单例）；
 * 2. 批量保存 / 单条保存覆盖值（仅管理员）；
 * 3. 单条恢复默认 / 全部恢复默认（仅管理员）。
 *
 * 【权限口径】
 * - 读：所有登录用户可用（GET /api/config）；
 * - 写/删：仅 admin 角色（后端 requireRole("admin") 拦截，非管理员返回 403）。
 *
 * 前端无需在本地判断权限再决定是否发请求，后端会兜底；
 * 但设置页会先读角色（getMyRoles）决定 UI 是否放开编辑，避免无意义的 403 交互。
 */

import client from "../client";
import type {
  ApiResponse,
  EffectiveConfigItem,
  SaveConfigItem,
  CreateConfigParams,
  PublicConfigMap,
} from "../types";

// ============================================================
// API 请求函数
// ============================================================

/**
 * 读取全部配置项的有效状态（一次渲染用）。
 *
 * GET /api/config（需 JWT 认证）
 *
 * @returns 按注册表顺序排列的有效配置项列表（含 value/enabled/overridden 与元数据）
 */
export async function getConfigsApi(): Promise<
  ApiResponse<EffectiveConfigItem[]>
> {
  try {
    return await client.get("/api/config");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取系统配置失败",
      code: err?.code,
    };
  }
}

/**
 * 新增动态配置（自定义 key，仅管理员）。
 *
 * POST /api/config（需 JWT + admin）
 *
 * key 必须全新：注册表内建项与 DB 已有项均冲突即拒绝（不覆盖）。
 *
 * @param params - { key, type, value, label?, description?, enabled? }
 * @returns 成功或失败
 */
export async function createConfigApi(
  params: CreateConfigParams
): Promise<ApiResponse<null>> {
  try {
    return await client.post("/api/config", params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "新增配置失败",
      code: err?.code,
    };
  }
}

/**
 * 批量保存配置覆盖值（仅管理员）。
 *
 * PUT /api/config（需 JWT + admin）
 *
 * @param items - [{ key, value, enabled? }] 数组，整体校验，任一非法则全部不写
 * @returns 成功或失败
 */
export async function saveConfigsApi(
  items: SaveConfigItem[]
): Promise<ApiResponse<null>> {
  try {
    return await client.put("/api/config", { items });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存配置失败",
      code: err?.code,
    };
  }
}

/**
 * 单条保存配置覆盖值（仅管理员）。
 *
 * PUT /api/config/:key（需 JWT + admin）
 *
 * @param key     - 配置键
 * @param value   - 覆盖值
 * @param enabled - 是否启用（默认 true）
 */
export async function saveConfigOneApi(
  key: string,
  value: unknown,
  enabled: boolean = true
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/config/${key}`, { value, enabled });
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存配置失败",
      code: err?.code,
    };
  }
}

/**
 * 单条恢复默认（删除该 key 的覆盖值，仅管理员）。
 *
 * DELETE /api/config/:key（需 JWT + admin）
 */
export async function resetConfigOneApi(
  key: string
): Promise<ApiResponse<null>> {
  try {
    return await client.delete(`/api/config/${key}`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "恢复默认失败",
      code: err?.code,
    };
  }
}

/**
 * 全部恢复默认（清空所有覆盖值，仅管理员）。
 *
 * DELETE /api/config（需 JWT + admin）
 */
export async function resetAllConfigsApi(): Promise<ApiResponse<null>> {
  try {
    return await client.delete("/api/config");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "恢复全部默认失败",
      code: err?.code,
    };
  }
}

// ============================================================
// 公开配置（免登录，供登录页 / 注册页读取）
// ============================================================

/**
 * 读取公开配置白名单（**无需登录**）。
 *
 * GET /api/config/public
 *
 * 【为什么单独一个接口】
 * 登录页在未登录状态下要决定「显示哪些登录方式、验证码倒计时几秒、
 * 密码最短多少位」，而 GET /api/config 需要登录态，登录页拿不到。
 * 后端为此开了一个严格的键白名单接口，只返回开关与策略类配置，
 * 绝不包含 prompt 文案、模型参数或默认密码。
 *
 * @returns 公开配置映射（缺失的键表示读取失败，调用方用默认值兜底）
 */
export async function getPublicConfigsApi(): Promise<
  ApiResponse<PublicConfigMap>
> {
  try {
    return await client.get("/api/config/public");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取登录配置失败",
      code: err?.code,
    };
  }
}
