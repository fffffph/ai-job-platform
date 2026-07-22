/**
 * ============================================
 * 用户模块 API（User Module）
 * ============================================
 *
 * 【职责】
 * 封装所有用户资料相关的 HTTP 请求。
 * 所有需要认证的接口，Token 由 client.ts 的请求拦截器自动注入。
 *
 * 【使用示例】
 * import { getUserProfile, updateProfile } from "@/api";
 * const res = await getUserProfile();
 * if (res.success) { console.log(res.data.name); }
 */

import client from "../client";
import type {
  ApiResponse,
  UserProfile,
  UpdateProfileParams,
  ChangePasswordParams,
  AvatarResult,
} from "../types";

// ============================================================
// API 请求函数
// ============================================================

/**
 * 获取当前用户资料
 *
 * GET /api/user/profile（需 JWT 认证）
 *
 * @returns 用户资料（不含密码）
 */
export async function getUserProfile(): Promise<ApiResponse<UserProfile>> {
  try {
    return await client.get("/api/user/profile");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取用户信息失败",
      code: error?.code,
    };
  }
}

/**
 * 更新用户资料
 *
 * PUT /api/user/profile（需 JWT 认证）
 *
 * @param params - 要更新的字段（{ name?, bio? }）
 * @returns 更新后的用户资料
 */
export async function updateProfile(
  params: UpdateProfileParams
): Promise<ApiResponse<UserProfile>> {
  try {
    return await client.put("/api/user/profile", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "保存失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 修改密码
 *
 * PUT /api/user/password（需 JWT 认证）
 *
 * @param params - { oldPassword, newPassword }
 * @returns 成功或失败
 */
export async function changePassword(
  params: ChangePasswordParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put("/api/user/password", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "密码修改失败",
      code: error?.code,
    };
  }
}

/**
 * 上传头像
 *
 * POST /api/user/avatar（需 JWT 认证）
 *
 * 前端以 multipart/form-data 格式发送，字段名为 avatar。
 * Token 和 Content-Type 由 axios 自动处理。
 *
 * @param file - 用户选择的图片文件
 * @returns { avatar: "/uploads/avatars/xxx.jpg" }
 */
export async function uploadAvatar(
  file: File
): Promise<ApiResponse<AvatarResult>> {
  try {
    const formData = new FormData();
    formData.append("avatar", file);

    return await client.post("/api/user/avatar", formData, {
      // 上传文件需要设置正确的 Content-Type（multipart/form-data）
      // axios 会自动根据 FormData 设置正确的 Content-Type 和 boundary
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "头像上传失败",
      code: error?.code,
    };
  }
}
