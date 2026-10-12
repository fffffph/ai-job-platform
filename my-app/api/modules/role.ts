/**
 * ============================================
 * 角色模块 API（Role Module）
 * ============================================
 *
 * 【职责】
 * 封装「角色」相关的 HTTP 请求（RBAC 权限体系）：
 * - 角色列表（含关联用户数、绑定菜单数）；
 * - 角色增删改（code 不可修改、内置角色不可删）；
 * - 角色-菜单绑定查询与保存（admin 角色拒绝修改）。
 *
 * 【错误处理】
 * 每个函数内部 try-catch，返回统一 ApiResponse 结构，调用方判断 success。
 */

import client from "../client";
import type {
  ApiResponse,
  RoleItem,
  RoleMenuResult,
  CreateRoleParams,
  UpdateRoleParams,
  SetRoleMenusParams,
} from "../types";

/** 获取角色列表（GET /api/role/list，需 system:role） */
export async function getRoleListApi(): Promise<ApiResponse<RoleItem[]>> {
  try {
    return await client.get("/api/role/list");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取角色列表失败",
      code: err?.code,
    };
  }
}

/** 新增角色（POST /api/role，需 system:role:create） */
export async function createRoleApi(
  params: CreateRoleParams
): Promise<ApiResponse<RoleItem>> {
  try {
    return await client.post("/api/role", params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "新增角色失败",
      code: err?.code,
    };
  }
}

/** 编辑角色（PUT /api/role/:id，需 system:role:update；code 不可修改） */
export async function updateRoleApi(
  id: string,
  params: UpdateRoleParams
): Promise<ApiResponse<RoleItem>> {
  try {
    return await client.put(`/api/role/${id}`, params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存角色失败",
      code: err?.code,
    };
  }
}

/** 删除角色（DELETE /api/role/:id，需 system:role:delete） */
export async function deleteRoleApi(id: string): Promise<ApiResponse<null>> {
  try {
    return await client.delete(`/api/role/${id}`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "删除角色失败",
      code: err?.code,
    };
  }
}

/** 获取角色已绑定的菜单 id 列表（GET /api/role/:id/menus，需 system:role） */
export async function getRoleMenusApi(
  id: string
): Promise<ApiResponse<RoleMenuResult>> {
  try {
    return await client.get(`/api/role/${id}/menus`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取角色权限失败",
      code: err?.code,
    };
  }
}

/** 保存角色-菜单绑定（PUT /api/role/:id/menus，需 system:role:grant） */
export async function setRoleMenusApi(
  id: string,
  params: SetRoleMenusParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/role/${id}/menus`, params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存权限失败",
      code: err?.code,
    };
  }
}
