/**
 * ============================================
 * 菜单模块 API（Menu Module）
 * ============================================
 *
 * 【职责】
 * 封装「菜单」相关的 HTTP 请求（RBAC 权限体系）：
 * - 当前用户菜单树 + 权限码（登录后拉取，供侧边栏渲染 + 按钮级权限）；
 * - 全量菜单（菜单管理页）；
 * - 菜单增删改（写操作接口由后端 requirePermission 兜底鉴权）。
 *
 * 【错误处理】
 * 每个函数内部 try-catch，返回统一 ApiResponse 结构，调用方判断 success。
 */

import client from "../client";
import type {
  ApiResponse,
  MyMenuResult,
  MenuItem,
  CreateMenuParams,
  UpdateMenuParams,
} from "../types";

/** 获取当前用户的菜单树与权限码（GET /api/menu/my，需登录） */
export async function getMyMenuApi(): Promise<ApiResponse<MyMenuResult>> {
  try {
    return await client.get("/api/menu/my");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取菜单失败",
      code: err?.code,
    };
  }
}

/** 获取全量菜单（GET /api/menu/tree，需 system:menu） */
export async function getMenuTreeApi(): Promise<ApiResponse<MenuItem[]>> {
  try {
    return await client.get("/api/menu/tree");
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "读取菜单树失败",
      code: err?.code,
    };
  }
}

/** 新增菜单（POST /api/menu，需 system:menu:create） */
export async function createMenuApi(
  params: CreateMenuParams
): Promise<ApiResponse<MenuItem>> {
  try {
    return await client.post("/api/menu", params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "新增菜单失败",
      code: err?.code,
    };
  }
}

/** 编辑菜单（PUT /api/menu/:id，需 system:menu:update；code 不可修改） */
export async function updateMenuApi(
  id: string,
  params: UpdateMenuParams
): Promise<ApiResponse<MenuItem>> {
  try {
    return await client.put(`/api/menu/${id}`, params);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "保存菜单失败",
      code: err?.code,
    };
  }
}

/** 删除菜单（DELETE /api/menu/:id，需 system:menu:delete；含子节点会被拒绝） */
export async function deleteMenuApi(id: string): Promise<ApiResponse<null>> {
  try {
    return await client.delete(`/api/menu/${id}`);
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      message: err?.message || "删除菜单失败",
      code: err?.code,
    };
  }
}
